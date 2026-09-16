"""Transport-level hardening that applies to every route.

Both of these belong in front of a reverse proxy in production, not instead of
one. They live here because the API is also run bare during development and on
a LAN address a phone can reach, where there is no proxy to rely on, and because
a limit the application enforces itself cannot be lost by a misconfigured one.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.status import HTTP_413_CONTENT_TOO_LARGE

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


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add the headers above, plus HSTS when the request actually arrived over TLS.

    HSTS is conditional on purpose. Sending it over plain HTTP is meaningless at
    best, and on a shared development host it pins a browser to HTTPS for an
    origin that does not serve it.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers.setdefault(header, value)

        forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
        if request.url.scheme == "https" or forwarded_proto == "https":
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject oversized request bodies with a 413.

    Checks the declared Content-Length first so an obvious offender is refused
    before a single byte of it is read, then counts the bytes actually received,
    because Content-Length can be absent (chunked transfer) or simply a lie.
    """

    def __init__(self, app, *, max_bytes: int) -> None:
        super().__init__(app)
        self._max_bytes = max_bytes

    def _too_large(self) -> JSONResponse:
        return JSONResponse(
            status_code=HTTP_413_CONTENT_TOO_LARGE,
            content={"detail": f"Request body exceeds the {self._max_bytes} byte limit"},
        )

    async def dispatch(self, request: Request, call_next) -> Response:
        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                if int(declared) > self._max_bytes:
                    return self._too_large()
            except ValueError:
                # A malformed Content-Length is the client's problem, and the
                # byte counter below still bounds what we read.
                pass

        received = 0
        too_large = False

        async def counted_receive():
            nonlocal received, too_large
            message = await request.receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self._max_bytes:
                    too_large = True
                    # Hand the app an empty final chunk rather than the rest of
                    # the payload. The route will fail its own validation, and
                    # the response is replaced below regardless.
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        request = Request(request.scope, counted_receive)
        response = await call_next(request)
        return self._too_large() if too_large else response
