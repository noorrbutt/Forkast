"""Transport-level hardening that applies to every route.

Both of these belong in front of a reverse proxy in production, not instead of
one. They live here because the API is also run bare during development and on
a LAN address a phone can reach, where there is no proxy to rely on, and because
a limit the application enforces itself cannot be lost by a misconfigured one.
"""

from __future__ import annotations

import logging

from app.config import get_settings
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import HTTP_413_CONTENT_TOO_LARGE
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Sent on every response. Deliberately short: this serves JSON to a native app,
# not HTML to a browser, so the headers that matter are the ones that stop a
# response being reinterpreted as something executable.
SECURITY_HEADERS = {
    # Stops a browser sniffing a JSON error body as HTML and running it.
    "X-Content-Type-Options": "nosniff",
    # Nothing here is meant to be framed.
    "X-Frame-Options": "DENY",
    # Do not leak the API path back to third-party sites.
    "Referrer-Policy": "no-referrer",
    # The API returns no markup, so the strictest policy costs nothing and
    # covers the error pages FastAPI renders as HTML.
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    # Browsers have no business asking this origin for hardware.
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
}

logger = logging.getLogger(__name__)
_WARNED_ABOUT_X_FORWARDED_FOR = False


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add the headers above, plus HSTS when the request actually arrived over TLS.

    HSTS is conditional on purpose. Sending it over plain HTTP is meaningless at
    best, and on a shared development host it pins a browser to HTTPS for an
    origin that does not serve it.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        global _WARNED_ABOUT_X_FORWARDED_FOR

        if request.headers.get("x-forwarded-for") and not get_settings().trust_proxy_headers:
            if not _WARNED_ABOUT_X_FORWARDED_FOR:
                logger.warning(
                    "X-Forwarded-For arrived while TRUST_PROXY_HEADERS is false; "
                    "proxy headers are being ignored and the rate-limit identity is "
                    "based on the direct peer address only."
                )
                _WARNED_ABOUT_X_FORWARDED_FOR = True

        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)

        forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
        if request.url.scheme == "https" or forwarded_proto == "https":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response


class _BodyTooLarge(HTTPException):
    """Raised out of the receive channel once the body passes the limit.

    An HTTPException rather than a bare one, and that detail is load bearing.
    FastAPI wraps body parsing in `except Exception: raise HTTPException(400)`,
    so anything else raised from inside receive() is swallowed and reported to
    the caller as "there was an error parsing the body" -- a 400 that blames the
    payload's syntax for what is actually a size limit. HTTPException is the one
    type that clause re-raises untouched, so it reaches Starlette's handler and
    is rendered as the 413 it is, on its way back out through CORS and the
    security headers.
    """

    def __init__(self, max_bytes: int) -> None:
        super().__init__(
            status_code=HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Request body exceeds the {max_bytes} byte limit",
        )


class BodySizeLimitMiddleware:
    """Reject oversized request bodies with a 413.

    Checks the declared Content-Length first so an obvious offender is refused
    before a single byte of it is read, then counts the bytes actually received,
    because Content-Length can be absent (chunked transfer) or simply a lie.

    Written as raw ASGI rather than as a BaseHTTPMiddleware, and that is the
    whole point of it. BaseHTTPMiddleware builds the downstream receive channel
    from the callable it was handed and never reads the Request passed to
    call_next -- `async def call_next(request)` shadows the name and drops it --
    so a counting receive installed that way is simply never invoked. The
    counter stayed at zero, the flag stayed False, and the only surviving check
    was the declared Content-Length, which a client omits by sending the body
    with Transfer-Encoding: chunked. That left an unauthenticated caller able to
    make the server buffer a body of any size, which is precisely what this
    class exists to prevent.
    """

    def __init__(self, app: ASGIApp, *, max_bytes: int) -> None:
        self.app = app
        self._max_bytes = max_bytes

    def _too_large(self) -> JSONResponse:
        return JSONResponse(
            status_code=HTTP_413_CONTENT_TOO_LARGE,
            content={"detail": f"Request body exceeds the {self._max_bytes} byte limit"},
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            try:
                if int(declared) > self._max_bytes:
                    await self._too_large()(scope, receive, send)
                    return
            except ValueError:
                # A malformed Content-Length is the client's problem, and the
                # byte counter below still bounds what we read.
                pass

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self._max_bytes:
                    # Raised rather than truncated. Handing the app a short body
                    # would let it answer 422 on its own terms and the caller
                    # would never learn the real reason.
                    raise _BodyTooLarge(self._max_bytes)
            return message

        async def watched_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, watched_send)
        except _BodyTooLarge:
            if response_started:
                # Headers are already on the wire, so the status cannot be
                # replaced. Letting it propagate closes the connection, which is
                # the only honest option left.
                raise
            await self._too_large()(scope, receive, send)
