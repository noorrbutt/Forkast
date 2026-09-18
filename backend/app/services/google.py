"""Verifying a Google ID token.

The phone runs the OAuth dance itself and ends up holding an ID token, which is
a JWT Google signed. It posts that here, and this module decides whether to
believe it. Nothing else in the app may read a claim out of that token without
going through verify_google_id_token first: an ID token is a string the client
handed us, and an unverified JWT is a payload an attacker wrote.

Verified locally against Google's published keys rather than by calling
Google's tokeninfo endpoint on every sign in. tokeninfo is documented as a
debugging aid, it puts a network round trip inside the login path, and it turns
Google being slow into Forkast being unable to sign anybody in. The keys are
fetched once and cached, so the steady state costs no network at all.
"""

from __future__ import annotations

from dataclasses import dataclass

import jwt
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientError
from starlette.concurrency import run_in_threadpool

from app.config import get_settings

# Google's JWKS. The discovery document at
# https://accounts.google.com/.well-known/openid-configuration names this as
# jwks_uri, and it has been this URL for years; hardcoding it saves a second
# round trip on the first sign in after a restart.
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"

# Both spellings are legal and Google still issues the bare-host one, so a
# verifier that accepts only the https form rejects real tokens.
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

# RS256 only, named explicitly. Passing the algorithms PyJWT finds in the header
# instead is the classic JWT hole: a token can claim alg=none, or claim HS256
# and be verified with the public key as an HMAC secret, and a public key is
# public.
GOOGLE_ALGORITHMS = ["RS256"]


class GoogleAuthError(Exception):
    """The token could not be believed. Carries a message fit to show a user."""


@dataclass(frozen=True)
class GoogleIdentity:
    """The parts of a verified token Forkast actually uses."""

    # Google's stable identifier for the account. This, never the address, is
    # what a Forkast row is keyed on.
    subject: str
    email: str
    first_name: str | None
    last_name: str | None


# One client, kept for the process, because it caches the signing keys. A new
# one per request would refetch the JWKS on every sign in, which is both slow
# and a good way to get rate limited by Google.
_jwks_client: PyJWKClient | None = None


def _client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True)
    return _jwks_client


def _verify(token: str, audiences: list[str]) -> dict:
    """The blocking half: fetch the signing key if needed, then check the token.

    PyJWKClient uses urllib, so this blocks. It is called through a threadpool
    by the async wrapper below for the same reason password hashing is: one
    sign in must not stall every other request in flight.
    """
    try:
        signing_key = _client().get_signing_key_from_jwt(token)
    except PyJWKClientError as exc:
        # Reaching Google failed, or it had no key matching this token's kid.
        # Not the caller's fault and not something they can fix by retyping
        # anything, so it is worth telling apart from a bad token.
        raise GoogleAuthError("Could not reach Google to check that sign in.") from exc
    except InvalidTokenError as exc:
        raise GoogleAuthError("That Google sign in could not be verified.") from exc

    try:
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=GOOGLE_ALGORITHMS,
            # A list is allowed here and is what makes one deployment serve all
            # three platforms: the token is good if its `aud` is any client id
            # we own, and no good if it belongs to somebody else's app.
            audience=audiences,
            issuer=list(GOOGLE_ISSUERS),
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except InvalidTokenError as exc:
        raise GoogleAuthError("That Google sign in could not be verified.") from exc


async def verify_google_id_token(token: str) -> GoogleIdentity:
    """Check a Google ID token and return who it says this is.

    Raises GoogleAuthError, never anything else, so callers turn one exception
    type into one status code.
    """
    settings = get_settings()
    audiences = settings.google_client_id_list
    if not audiences:
        # Reachable only if a caller forgot to check google_enabled first. An
        # empty audience list would make PyJWT skip the `aud` check entirely,
        # which is exactly the check that stops a token minted for somebody
        # else's Google client being accepted here.
        raise GoogleAuthError("Google sign in is not configured on this server.")

    claims = await run_in_threadpool(_verify, token, audiences)

    email = claims.get("email")
    if not email:
        # Forkast has no other way to name an account, and the email scope is
        # requested by the client, so this means the token was minted for a
        # different purpose.
        raise GoogleAuthError("That Google account did not share an email address.")

    # An unverified address is one Google has not proved belongs to this person,
    # and accepting it would let somebody register a Google account claiming
    # another person's address and be handed their Forkast account by the
    # linking step. Google sends this as a real bool, but it has historically
    # also appeared as the string "true", so both are accepted and nothing else.
    verified = claims.get("email_verified")
    if verified is not True and verified != "true":
        raise GoogleAuthError("Google has not verified the email on that account.")

    return GoogleIdentity(
        subject=str(claims["sub"]),
        email=str(email),
        # Optional claims: they arrive with the profile scope and a Google
        # account is not obliged to carry either.
        first_name=_clean(claims.get("given_name")),
        last_name=_clean(claims.get("family_name")),
    )


def _clean(value: object) -> str | None:
    """A trimmed name, or None. Never the empty string, because null and "" would
    then be two ways of saying the same thing in a column that means "nobody has
    told us this person's name"."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    # The column is String(80); a longer name is cut rather than rejected,
    # because refusing a sign in over the length of somebody's surname would be
    # absurd.
    return trimmed[:80] or None
