"""Signing in with Google, and what registration now asks for.

Google's own signing keys are never fetched. Every test here replaces
verify_google_id_token with a stand-in, because what is being tested is what
Forkast does with an identity once it believes it, and reaching out to
accounts.google.com would make the suite depend on the network to answer a
question about our own routing. The verifier itself is tested separately below,
against tokens built and signed in this file.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Iterator

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import User
from app.services import google as google_service
from app.services.google import GoogleAuthError, GoogleIdentity

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
GOOGLE = "/api/v1/auth/google"
ME = "/api/v1/me"


@pytest.fixture(autouse=True)
def google_configured() -> Iterator[None]:
    """Give the whole file a deployment that has Google switched on.

    get_settings is lru_cached, so the value is poked onto the cached instance
    and put back afterwards. Without this every test here would hit the 503 that
    an unconfigured server correctly answers.
    """
    settings = get_settings()
    original = settings.google_client_ids
    object.__setattr__(settings, "google_client_ids", "forkast-web.apps.googleusercontent.com")
    yield
    object.__setattr__(settings, "google_client_ids", original)


def fake_google(identity: GoogleIdentity | Exception):
    """A stand-in verifier that answers with one identity, or raises."""

    async def _verify(token: str) -> GoogleIdentity:
        if isinstance(identity, Exception):
            raise identity
        return identity

    return _verify


def identity(
    *,
    subject: str = "google-sub-1",
    email: str = "sara@gmail.com",
    first: str | None = "Sara",
    last: str | None = "Khan",
) -> GoogleIdentity:
    return GoogleIdentity(subject=subject, email=email, first_name=first, last_name=last)


# --------------------------------------------------------------------------
# Registration now asks for a name
# --------------------------------------------------------------------------


async def test_register_stores_the_name_it_was_given(
    client: AsyncClient, session: AsyncSession
) -> None:
    response = await client.post(
        REGISTER,
        json={
            "first_name": "  Sara  ",
            "last_name": "  Khan  ",
            "email": "named@forkast.app",
            "password": "password123",
        },
    )
    assert response.status_code == 201

    stored = await session.scalar(select(User).where(User.email == "named@forkast.app"))
    assert stored is not None
    # Trimmed on the way in, so a stray space from a phone keyboard is not part
    # of somebody's name forever.
    assert (stored.first_name, stored.last_name) == ("Sara", "Khan")


@pytest.mark.parametrize(
    "payload",
    [
        {"last_name": "Khan", "email": "a@forkast.app", "password": "password123"},
        {"first_name": "Sara", "email": "b@forkast.app", "password": "password123"},
        {
            "first_name": "   ",
            "last_name": "Khan",
            "email": "c@forkast.app",
            "password": "password123",
        },
        {
            "first_name": "Sara",
            "last_name": "",
            "email": "d@forkast.app",
            "password": "password123",
        },
    ],
    ids=["no-first", "no-last", "blank-first", "empty-last"],
)
async def test_register_refuses_a_missing_or_blank_name(client: AsyncClient, payload: dict) -> None:
    """A field holding one space is not a name.

    min_length alone would let the third and fourth cases through and store a
    value that renders as an empty line everywhere the account is shown.
    """
    response = await client.post(REGISTER, json=payload)
    assert response.status_code == 422


async def test_me_reports_the_name_and_that_there_is_a_password(auth_client: AsyncClient) -> None:
    body = (await auth_client.get(ME)).json()
    assert body["first_name"] == "Test"
    assert body["last_name"] == "User"
    assert body["has_password"] is True


# --------------------------------------------------------------------------
# Continue with Google
# --------------------------------------------------------------------------


async def test_google_creates_an_account_and_says_it_created_one(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))

    response = await client.post(GOOGLE, json={"id_token": "whatever"})

    # 201, not 200. The client reads this to decide whether to ask the one time
    # setup questions, and asking a returning user again overwrites their goal.
    assert response.status_code == 201
    assert response.json()["access_token"]

    stored = await session.scalar(select(User).where(User.google_sub == "google-sub-1"))
    assert stored is not None
    assert stored.email == "sara@gmail.com"
    assert (stored.first_name, stored.last_name) == ("Sara", "Khan")
    # The whole point of the nullable column: this account has no password and
    # never had one.
    assert stored.password_hash is None


async def test_google_a_second_time_signs_in_rather_than_creating_again(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))

    first = await client.post(GOOGLE, json={"id_token": "whatever"})
    second = await client.post(GOOGLE, json={"id_token": "whatever"})

    assert first.status_code == 201
    # 200: found, not created. A returning user must not be sent back through
    # setup, where "Skip for now" would overwrite their real goal with Maintain.
    assert second.status_code == 200

    count = len((await session.scalars(select(User))).all())
    assert count == 1


async def test_google_follows_the_sub_when_the_address_has_changed(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Keyed on Google's `sub`, never on the address.

    Somebody who changes their Gmail address keeps their meals. Keying on the
    address instead would quietly start them a second account.
    """
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))
    await client.post(GOOGLE, json={"id_token": "whatever"})

    monkeypatch.setattr(
        "app.api.v1.auth.verify_google_id_token",
        fake_google(identity(email="sara.khan@gmail.com")),
    )
    again = await client.post(GOOGLE, json={"id_token": "whatever"})

    assert again.status_code == 200
    assert len((await session.scalars(select(User))).all()) == 1


async def test_google_links_to_an_account_that_registered_with_a_password(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The same person, arriving by the other door.

    Without this branch the unique index on the address refuses the insert and
    "Continue with Google" fails forever for anybody who once used the form.
    """
    await client.post(
        REGISTER,
        json={
            "first_name": "Sara",
            "last_name": "Khan",
            "email": "both@forkast.app",
            "password": "password123",
        },
    )
    monkeypatch.setattr(
        "app.api.v1.auth.verify_google_id_token",
        fake_google(identity(email="both@forkast.app")),
    )

    response = await client.post(GOOGLE, json={"id_token": "whatever"})

    # 200: the account already existed and has simply gained a second way in,
    # so it must not be treated as new.
    assert response.status_code == 200
    assert len((await session.scalars(select(User))).all()) == 1

    linked = await session.scalar(select(User).where(User.email == "both@forkast.app"))
    assert linked is not None
    assert linked.google_sub == "google-sub-1"
    # Both doors still open it. Linking must not take the password away.
    assert linked.password_hash is not None
    login = await client.post(LOGIN, json={"email": "both@forkast.app", "password": "password123"})
    assert login.status_code == 200


async def test_google_does_not_overwrite_a_name_the_account_already_has(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Google is not the authority on what somebody is called here."""
    await client.post(
        REGISTER,
        json={
            "first_name": "Sara",
            "last_name": "Khan",
            "email": "keepname@forkast.app",
            "password": "password123",
        },
    )
    monkeypatch.setattr(
        "app.api.v1.auth.verify_google_id_token",
        fake_google(identity(email="keepname@forkast.app", first="Sarah", last="K")),
    )

    await client.post(GOOGLE, json={"id_token": "whatever"})

    stored = await session.scalar(select(User).where(User.email == "keepname@forkast.app"))
    assert stored is not None
    assert (stored.first_name, stored.last_name) == ("Sara", "Khan")


async def test_google_fills_in_a_name_the_account_never_had(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An account from before names existed gains one for free."""
    await client.post(
        REGISTER,
        json={
            "first_name": "Sara",
            "last_name": "Khan",
            "email": "noname@forkast.app",
            "password": "password123",
        },
    )
    unnamed = await session.scalar(select(User).where(User.email == "noname@forkast.app"))
    assert unnamed is not None
    unnamed.first_name = None
    unnamed.last_name = None
    await session.commit()

    monkeypatch.setattr(
        "app.api.v1.auth.verify_google_id_token",
        fake_google(identity(email="noname@forkast.app")),
    )
    await client.post(GOOGLE, json={"id_token": "whatever"})

    await session.refresh(unnamed)
    assert (unnamed.first_name, unnamed.last_name) == ("Sara", "Khan")


async def test_google_survives_a_token_carrying_no_name(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """given_name and family_name are optional claims, and an account without
    them is an ordinary account rather than a failed one."""
    monkeypatch.setattr(
        "app.api.v1.auth.verify_google_id_token",
        fake_google(identity(first=None, last=None)),
    )

    response = await client.post(GOOGLE, json={"id_token": "whatever"})

    assert response.status_code == 201
    stored = await session.scalar(select(User).where(User.google_sub == "google-sub-1"))
    assert stored is not None
    assert stored.first_name is None and stored.last_name is None


async def test_google_rejects_a_token_it_cannot_believe(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.api.v1.auth.verify_google_id_token",
        fake_google(GoogleAuthError("That Google sign in could not be verified.")),
    )

    response = await client.post(GOOGLE, json={"id_token": "forged"})

    assert response.status_code == 401
    assert "could not be verified" in response.json()["detail"]


async def test_google_answers_503_when_the_server_has_no_client_ids(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Unconfigured is refused outright rather than verified against nothing.

    With no client ids there is no audience to check, and a token whose audience
    nobody checks is one anybody can mint for their own Google client.
    """
    settings = get_settings()
    object.__setattr__(settings, "google_client_ids", "")

    response = await client.post(GOOGLE, json={"id_token": "whatever"})

    assert response.status_code == 503


async def test_a_google_account_cannot_be_opened_with_a_password(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The password login path must not trip over a null hash.

    Passing None to the verifier raises, so before this guard existed the answer
    was a 500 that also announced the account existed.
    """
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))
    await client.post(GOOGLE, json={"id_token": "whatever"})

    response = await client.post(
        LOGIN, json={"email": "sara@gmail.com", "password": "anything-at-all"}
    )

    assert response.status_code == 401
    # The same words an unknown address gets. Saying "this one signs in with
    # Google" would confirm the address is registered.
    assert response.json()["detail"] == "Incorrect email or password"


async def test_me_reports_a_google_account_as_having_no_password(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))
    tokens = (await client.post(GOOGLE, json={"id_token": "whatever"})).json()

    body = (
        await client.get(ME, headers={"Authorization": f"Bearer {tokens['access_token']}"})
    ).json()

    assert body["has_password"] is False


# --------------------------------------------------------------------------
# Deleting and changing the password on an account that has none
# --------------------------------------------------------------------------


async def test_a_google_account_is_deleted_by_proving_google_again(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))
    tokens = (await client.post(GOOGLE, json={"id_token": "whatever"})).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    monkeypatch.setattr("app.api.v1.insights.verify_google_id_token", fake_google(identity()))
    response = await client.request(
        "DELETE", "/api/v1/me", headers=headers, json={"id_token": "fresh"}
    )

    assert response.status_code == 204
    assert (await session.scalar(select(User).where(User.google_sub == "google-sub-1"))) is None


async def test_a_google_token_for_a_different_account_deletes_nothing(
    client: AsyncClient, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Verifying the signature is not the same as checking whose it is.

    Without the subject comparison, anybody holding any Google account could
    delete whichever Forkast account the phone happened to be signed in to.
    """
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))
    tokens = (await client.post(GOOGLE, json={"id_token": "whatever"})).json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    monkeypatch.setattr(
        "app.api.v1.insights.verify_google_id_token",
        fake_google(identity(subject="somebody-else", email="thief@gmail.com")),
    )
    response = await client.request(
        "DELETE", "/api/v1/me", headers=headers, json={"id_token": "someone-elses"}
    )

    assert response.status_code == 403
    assert (await session.scalar(select(User).where(User.google_sub == "google-sub-1"))) is not None


async def test_deleting_a_google_account_with_a_password_is_refused(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))
    tokens = (await client.post(GOOGLE, json={"id_token": "whatever"})).json()

    response = await client.request(
        "DELETE",
        "/api/v1/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
        json={"password": "guessing"},
    )

    assert response.status_code == 403
    assert "no password" in response.json()["detail"]


async def test_deleting_refuses_a_body_with_both_proofs_or_neither(
    auth_client: AsyncClient,
) -> None:
    both = await auth_client.request(
        "DELETE", "/api/v1/me", json={"password": "x", "id_token": "y"}
    )
    neither = await auth_client.request("DELETE", "/api/v1/me", json={})

    assert both.status_code == 422
    assert neither.status_code == 422


async def test_a_google_account_has_no_password_to_change(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("app.api.v1.auth.verify_google_id_token", fake_google(identity()))
    tokens = (await client.post(GOOGLE, json={"id_token": "whatever"})).json()

    response = await client.put(
        "/api/v1/me/password",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
        json={"current_password": "anything", "new_password": "newpassword123"},
    )

    # 409 rather than 403: the request is not wrong about a value, it is wrong
    # about the account. The app never shows the row, so this is the guard for a
    # request that arrives anyway.
    assert response.status_code == 409


# --------------------------------------------------------------------------
# The verifier itself, against tokens signed here
# --------------------------------------------------------------------------

AUDIENCE = "forkast-web.apps.googleusercontent.com"


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    """One key for the module. Generating RSA is slow enough to notice."""
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def sign(key: rsa.RSAPrivateKey, **overrides) -> str:
    now = dt.datetime.now(dt.UTC)
    claims = {
        "iss": "https://accounts.google.com",
        "aud": AUDIENCE,
        "sub": "google-sub-1",
        "email": "sara@gmail.com",
        "email_verified": True,
        "given_name": "Sara",
        "family_name": "Khan",
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(hours=1)).timestamp()),
    }
    claims.update(overrides)
    return jwt.encode(claims, key, algorithm="RS256")


@pytest.fixture
def local_jwks(monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey) -> None:
    """Point the verifier at our own key instead of Google's.

    Only the key lookup is replaced. Every other check -- signature, audience,
    issuer, expiry, required claims -- runs exactly as it does in production,
    which is the whole point of testing it this way rather than mocking
    jwt.decode.
    """

    class _Key:
        key = signing_key.public_key()

    class _Client:
        def get_signing_key_from_jwt(self, token: str) -> _Key:
            return _Key()

    monkeypatch.setattr(google_service, "_client", lambda: _Client())


async def test_verifier_accepts_a_well_formed_token(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    result = await google_service.verify_google_id_token(sign(signing_key))

    assert result.subject == "google-sub-1"
    assert result.email == "sara@gmail.com"
    assert (result.first_name, result.last_name) == ("Sara", "Khan")


async def test_verifier_refuses_a_token_minted_for_another_app(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    """The check that makes a public client id safe to ship in a bundle."""
    with pytest.raises(GoogleAuthError):
        await google_service.verify_google_id_token(
            sign(signing_key, aud="someone-elses.apps.googleusercontent.com")
        )


async def test_verifier_refuses_a_token_from_another_issuer(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    with pytest.raises(GoogleAuthError):
        await google_service.verify_google_id_token(sign(signing_key, iss="https://evil.example"))


async def test_verifier_refuses_an_expired_token(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    past = dt.datetime.now(dt.UTC) - dt.timedelta(hours=2)
    with pytest.raises(GoogleAuthError):
        await google_service.verify_google_id_token(
            sign(signing_key, exp=int(past.timestamp()), iat=int(past.timestamp()))
        )


async def test_verifier_refuses_an_unverified_email(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    """The check the account linking branch rests on.

    Without it, anybody able to put another person's address into a Google
    profile would be handed that person's Forkast account.
    """
    with pytest.raises(GoogleAuthError):
        await google_service.verify_google_id_token(sign(signing_key, email_verified=False))


async def test_verifier_accepts_the_string_spelling_of_email_verified(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    """Google has sent this as the string "true" historically."""
    result = await google_service.verify_google_id_token(sign(signing_key, email_verified="true"))
    assert result.email == "sara@gmail.com"


async def test_verifier_refuses_a_token_with_no_email(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    with pytest.raises(GoogleAuthError):
        await google_service.verify_google_id_token(sign(signing_key, email=None))


async def test_verifier_refuses_an_unsigned_token(local_jwks: None) -> None:
    """alg=none is the oldest JWT hole there is, and naming RS256 explicitly is
    what closes it."""
    unsigned = jwt.encode(
        {
            "iss": "https://accounts.google.com",
            "aud": AUDIENCE,
            "sub": "google-sub-1",
            "email": "sara@gmail.com",
            "email_verified": True,
            "exp": int((dt.datetime.now(dt.UTC) + dt.timedelta(hours=1)).timestamp()),
            "iat": int(dt.datetime.now(dt.UTC).timestamp()),
        },
        key="",
        algorithm="none",
    )

    with pytest.raises(GoogleAuthError):
        await google_service.verify_google_id_token(unsigned)


async def test_verifier_trims_and_truncates_a_name(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    """The column is String(80). A long surname is cut rather than refused,
    because turning somebody away over the length of their name would be
    absurd."""
    result = await google_service.verify_google_id_token(
        sign(signing_key, given_name="  Sara  ", family_name="K" * 200)
    )

    assert result.first_name == "Sara"
    assert result.last_name is not None
    assert len(result.last_name) == 80


async def test_verifier_reads_an_empty_name_as_no_name(
    local_jwks: None, signing_key: rsa.RSAPrivateKey
) -> None:
    """Null and "" must not become two ways of saying the same thing in a column
    that means "nobody has told us"."""
    result = await google_service.verify_google_id_token(
        sign(signing_key, given_name="   ", family_name="")
    )

    assert result.first_name is None
    assert result.last_name is None


async def test_the_database_refuses_an_account_with_no_way_in(session: AsyncSession) -> None:
    """ck_users_has_a_way_in, the constraint that pays for the nullable
    password. A row with neither a password nor a Google identity is an account
    that exists and that nobody, its owner included, can ever open."""
    session.add(User(email=f"orphan-{uuid.uuid4()}@forkast.app"))

    with pytest.raises(Exception) as caught:
        await session.commit()

    assert "has_a_way_in" in str(caught.value)
    await session.rollback()
