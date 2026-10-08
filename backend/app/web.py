"""App Links / Universal Links: the two /.well-known verification files, and
the plain web pages a reset or verification link opens to when nothing
intercepts it as a deep link.

Why this exists at all: a `forkast://` link only opens the app if something
on the device already knows to claim that scheme, which on Android any
installed app can register for and on both platforms most mail clients
simply refuse to linkify. An `https://` link on a domain the OS has
independently verified against these two files does not have that gap: the
OS opens the app directly for a verified domain, and falls through to an
ordinary browser hit on this page for everyone else -- a user who has not
installed the app yet, or opened the link on a desktop. `forkast://` stays
wired in the mobile client as what these pages hand off to when they *are*
opened inside a mobile browser, not as the primary channel any more.

Served from app root, not under /api/v1: both the well-known paths and the
App Links path list below are dictated by the platforms' own conventions,
not by anything this project would choose.
"""

from __future__ import annotations

import html
import json
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Response
from fastapi.responses import HTMLResponse, JSONResponse

from app.config import get_settings

router = APIRouter(tags=["web"])


@router.get("/.well-known/apple-app-site-association")
async def apple_app_site_association() -> Response:
    """Tells iOS which paths on this domain open the app instead of Safari.

    Served with no file extension, which is why this returns a Response
    built by hand rather than declaring response_model=... and letting
    FastAPI infer a content type from a suffix that does not exist here --
    Apple requires it be served as application/json regardless.
    """
    settings = get_settings()
    if not settings.app_domain or not settings.apple_app_id_prefix:
        # An empty or placeholder file is not a lesser version of a working
        # one, it is a file that tells iOS this domain verified and then
        # names an app that does not exist -- worse than the 404 a domain
        # with no Universal Links support would otherwise return.
        return JSONResponse(status_code=404, content={"detail": "App Links not configured"})

    app_id = f"{settings.apple_app_id_prefix}.com.forkast.app"
    return JSONResponse(
        content={
            "applinks": {
                "apps": [],
                "details": [
                    {
                        "appID": app_id,
                        "paths": ["/reset-password", "/check-email"],
                    }
                ],
            }
        }
    )


@router.get("/.well-known/assetlinks.json")
async def asset_links() -> Response:
    """The Android equivalent: which app this domain vouches for, and by
    which signing certificate, so App Links auto-verifies without an APK on
    the device to ask."""
    settings = get_settings()
    if not settings.app_domain or not settings.android_sha256_cert_fingerprint:
        return JSONResponse(status_code=404, content={"detail": "App Links not configured"})

    return JSONResponse(
        content=[
            {
                "relation": ["delegate_permission/common.handle_all_urls"],
                "target": {
                    "namespace": "android_app",
                    "package_name": "com.forkast.app",
                    "sha256_cert_fingerprints": [settings.android_sha256_cert_fingerprint],
                },
            }
        ]
    )


def _fallback_page(*, heading: str, deep_link: str) -> HTMLResponse:
    """One shared shell for both fallback pages.

    Both do the same job: try the custom scheme once, immediately, for a
    browser that opened this page on the phone with the app installed but
    somehow missed the App Link (an in-app browser inside another app is the
    common case), and otherwise just say plainly that this is a link meant
    for the Forkast app.

    `deep_link` is built from a caller-supplied query string (a reset or
    verification token, an email address), so it is untrusted the same way
    any query parameter is. It goes into this page twice -- once in an href
    attribute, once inside a <script> block -- and each of those needs its
    own escaping, not one shared between them: html.escape() defuses it as
    HTML, json.dumps() defuses it as a JS string literal. Neither is
    optional, and neither substitutes for the other.

    Returns a real Response, not a bare string, because this page needs its
    own Content-Security-Policy: SECURITY_HEADERS' blanket "default-src
    'none'" (right for the rest of the API, which serves nothing but JSON)
    blocks this page's own inline <style> and <script> outright, so the page
    rendered unstyled and the auto-redirect into the app never ran. A nonce
    scoped to this one response is what lets exactly this inline style and
    script run without reopening inline script generally -- the middleware's
    `setdefault` leaves a header a route already set alone, so this is the
    only route whose CSP differs from the default.
    """
    nonce = secrets.token_urlsafe(18)
    safe_href = html.escape(deep_link, quote=True)
    # json.dumps escapes quotes and backslashes but not "</", so a token
    # containing a literal "</script>" would otherwise close this block early
    # and inject whatever HTML followed it. Standard mitigation: escape the
    # forward slash in that one sequence so the substring never appears.
    safe_js_string = json.dumps(deep_link).replace("</", "<\\/")
    body = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Forkast</title>
<style nonce="{nonce}">
  body {{
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0A0908;
    color: #FAF7F2;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    text-align: center;
    padding: 24px;
  }}
  .card {{ max-width: 360px; }}
  h1 {{ font-size: 20px; margin: 0 0 12px; }}
  p {{ color: #BCB5AC; line-height: 1.5; margin: 0 0 24px; }}
  a {{
    display: inline-block;
    background: #F5A524;
    color: #0E0E10;
    text-decoration: none;
    font-weight: 600;
    padding: 12px 24px;
    border-radius: 999px;
  }}
</style>
</head>
<body>
  <div class="card">
    <h1>{heading}</h1>
    <p>This link opens in the Forkast app. If it did not open automatically,
       tap below.</p>
    <a href="{safe_href}">Open Forkast</a>
  </div>
  <script nonce="{nonce}">
    // One immediate, silent attempt. If the app is installed and simply
    // wasn't offered the App Link (common inside another app's in-app
    // browser), this is what actually opens it; if it is not installed the
    // tab just stays here on the fallback with nothing to clean up.
    window.location.replace({safe_js_string});
  </script>
</body>
</html>"""
    return HTMLResponse(
        content=body,
        headers={
            "Content-Security-Policy": (
                f"default-src 'none'; style-src 'nonce-{nonce}'; "
                f"script-src 'nonce-{nonce}'; frame-ancestors 'none'"
            )
        },
    )


@router.get("/reset-password")
async def reset_password_fallback(token: str | None = None) -> HTMLResponse:
    # urlencode, not an f-string: a token or email containing "&", "=" or any
    # other reserved query character would otherwise corrupt the query string
    # it lands in (or, for "#", truncate it outright) instead of round-
    # tripping to the app untouched. services/auth.py's own deep_link()
    # already does this; this page builds the same kind of link by hand and
    # has to follow the same rule.
    query = f"?{urlencode({'token': token})}" if token else ""
    return _fallback_page(
        heading="Reset your password", deep_link=f"forkast://reset-password{query}"
    )


@router.get("/check-email")
async def check_email_fallback(token: str | None = None, email: str | None = None) -> HTMLResponse:
    pairs = {k: v for k, v in (("token", token), ("email", email)) if v}
    query = f"?{urlencode(pairs)}" if pairs else ""
    return _fallback_page(heading="Verify your email", deep_link=f"forkast://check-email{query}")
