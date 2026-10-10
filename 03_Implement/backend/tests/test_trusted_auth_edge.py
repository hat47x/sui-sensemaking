"""ADR-0063 D9-3: unit tests for JwtSaasIdentityContextResolver.

Uses real RS256 signing via the cryptography library to verify the full
JWT → JWKS → subject → tenant claim pipeline.
"""

from __future__ import annotations

import time as _time_module
from uuid import uuid4
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from sui_sensemaking_api.jwks_store import JwksStore
from sui_sensemaking_api.models import (
    Base,
    IdentityProviderRow,
    TenantIdentityProviderRow,
    TenantMembershipRow,
    TenantRow,
    UserIdentityRow,
    UserRow,
)
from sui_sensemaking_api.trusted_auth_edge import (
    JwtIdentityError,
    JwtSaasIdentityContextResolver,
    _verify_jwt,
)

TIMESTAMP = "2026-08-07T00:00:00Z"


def _generate_rs256_key_pair() -> tuple[rsa.RSAPrivateKey, dict[str, object]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    public_numbers = public_key.public_numbers()

    # Serialize to JWK format
    import base64

    def _b64url(x: int) -> str:
        length = (x.bit_length() + 7) // 8
        return base64.urlsafe_b64encode(x.to_bytes(length, "big")).rstrip(b"=").decode()

    jwk: dict[str, object] = {
        "kty": "RSA",
        "kid": "test-key-1",
        "use": "sig",
        "alg": "RS256",
        "n": _b64url(public_numbers.n),
        "e": _b64url(public_numbers.e),
    }
    return private_key, jwk


def _private_key_pem(private_key: rsa.RSAPrivateKey) -> str:
    return private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


def _build_token(
    *,
    private_key: rsa.RSAPrivateKey,
    issuer: str = "https://broker.invalid/issuer",
    audience: str = "sui-sensemaking",
    subject: str = "subject-1",
    tenant_ref: str = "org-123",
    kid: str = "test-key-1",
    expired: bool = False,
    jti: str | None = None,
    include_jti: bool = True,
) -> str:
    import time

    now = int(time.time())
    payload: dict[str, object] = {
        "iss": issuer,
        "aud": audience,
        "sub": subject,
        "tenant_ref": tenant_ref,
        "iat": now - 60,
        "exp": now - 3600 if expired else now + 3600,
    }
    if include_jti:
        payload["jti"] = jti or str(uuid4())
    headers: dict[str, object] = {"kid": kid}
    return jwt.encode(
        payload,
        _private_key_pem(private_key),
        algorithm="RS256",
        headers=headers,
    )


def _seed(db: Session) -> None:
    db.add_all(
        [
            UserRow(
                id="user-1",
                display_name="User 1",
                email=None,
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            ),
            TenantRow(
                id="tenant-a",
                display_name="Tenant A",
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            ),
            IdentityProviderRow(
                id="idp-1",
                issuer="https://broker.invalid/issuer",
                audience="sui-sensemaking",
                protocol="oidc",
                jwks_uri="https://broker.invalid/jwks.json",
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            ),
            TenantIdentityProviderRow(
                tenant_id="tenant-a",
                identity_provider_id="idp-1",
                external_tenant_ref="org-123",
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            ),
            UserIdentityRow(
                user_id="user-1",
                provider="idp-1",
                external_uid="subject-1",
                identity_provider_id="idp-1",
                subject="subject-1",
                created_at=TIMESTAMP,
            ),
            TenantMembershipRow(
                tenant_id="tenant-a",
                user_id="user-1",
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            ),
        ]
    )
    db.commit()


@pytest.fixture
def key_pair() -> tuple[rsa.RSAPrivateKey, dict[str, object]]:
    return _generate_rs256_key_pair()


@pytest.fixture
def db() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        _seed(session)
        yield session


def _request_with_token(token: str | None) -> Request:
    """Build a mock FastAPI Request with the JWT header."""
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [],
    }
    if token is not None:
        scope["headers"].append(
            (b"x-sui-sensemaking-authorization", f"Bearer {token}".encode())
        )
    return Request(scope=scope)


class TestJwtSaasIdentityContextResolver:
    def test_resolve_with_valid_token_returns_identity(
        self, db: Session, key_pair: tuple[rsa.RSAPrivateKey, dict[str, object]]
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key)

        store = JwksStore()
        store.set("idp-1", [jwk])

        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            identity = resolver.resolve(
                db=db, request=_request_with_token(token)
            )

        assert identity.user_id == "user-1"
        assert identity.verified_tenant_claim is not None
        assert identity.verified_tenant_claim.tenant_id == "tenant-a"
        assert identity.verified_tenant_claim.identity_provider_id == "idp-1"
        assert identity.auth_context.provider == "idp-1"
        assert identity.auth_context.external_uid == "subject-1"

    def test_resolve_rejects_missing_token(self, db: Session) -> None:
        store = JwksStore()
        resolver = JwtSaasIdentityContextResolver(jwks_store=store)
        with pytest.raises(JwtIdentityError) as exc:
            resolver.resolve(db=db, request=_request_with_token(None))
        assert exc.value.status_code == 401
        assert exc.value.code == "missing_token"

    def test_resolve_rejects_expired_token(
        self, db: Session, key_pair: tuple[rsa.RSAPrivateKey, dict[str, object]]
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key, expired=True)

        store = JwksStore()
        store.set("idp-1", [jwk])

        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            with pytest.raises(JwtIdentityError) as exc:
                resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 401
        assert exc.value.code == "token_expired"

    def test_resolve_rejects_unknown_provider(
        self, db: Session, key_pair: tuple[rsa.RSAPrivateKey, dict[str, object]]
    ) -> None:
        private_key, _ = key_pair
        token = _build_token(
            private_key=private_key,
            issuer="https://unknown.invalid/issuer",
        )

        store = JwksStore()
        resolver = JwtSaasIdentityContextResolver(jwks_store=store)
        with pytest.raises(JwtIdentityError) as exc:
            resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 401
        assert exc.value.code == "unknown_provider"

    def test_resolve_rejects_unprovisioned_subject(
        self, db: Session, key_pair: tuple[rsa.RSAPrivateKey, dict[str, object]]
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key, subject="unknown-subject")

        store = JwksStore()
        store.set("idp-1", [jwk])

        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            with pytest.raises(JwtIdentityError) as exc:
                resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 403
        assert exc.value.code == "identity_not_provisioned"

    def test_resolve_rejects_missing_tenant_claim(
        self, db: Session, key_pair: tuple[rsa.RSAPrivateKey, dict[str, object]]
    ) -> None:
        private_key, jwk = key_pair
        # Build token without tenant_ref claim
        import time

        now = int(time.time())
        payload: dict[str, object] = {
            "iss": "https://broker.invalid/issuer",
            "aud": "sui-sensemaking",
            "sub": "subject-1",
            "iat": now - 60,
            "exp": now + 3600,
            "jti": str(uuid4()),
        }
        token = jwt.encode(
            payload,
            _private_key_pem(private_key),
            algorithm="RS256",
            headers={"kid": "test-key-1"},
        )

        store = JwksStore()
        store.set("idp-1", [jwk])

        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            with pytest.raises(JwtIdentityError) as exc:
                resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 401
        assert exc.value.code == "missing_tenant_claim"

    def test_resolve_rejects_unknown_external_tenant_ref(
        self, db: Session, key_pair: tuple[rsa.RSAPrivateKey, dict[str, object]]
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key, tenant_ref="unknown-org")

        store = JwksStore()
        store.set("idp-1", [jwk])

        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            with pytest.raises(JwtIdentityError) as exc:
                resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 401
        assert exc.value.code == "unknown_tenant"

    def test_resolve_rejects_wrong_signature(
        self, db: Session, key_pair: tuple[rsa.RSAPrivateKey, dict[str, object]]
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key)

        # Use a different key pair for JWKS — signature won't match.
        other_key, other_jwk = _generate_rs256_key_pair()

        store = JwksStore()
        store.set("idp-1", [other_jwk])

        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[other_jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            with pytest.raises(JwtIdentityError) as exc:
                resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 401
        assert exc.value.code == "invalid_signature"

    def test_resolve_populates_auth_context_correctly(
        self, db: Session, key_pair: tuple[rsa.RSAPrivateKey, dict[str, object]]
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key)

        store = JwksStore()
        store.set("idp-1", [jwk])

        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            identity = resolver.resolve(
                db=db, request=_request_with_token(token)
            )

        assert identity.user_id == "user-1"
        assert identity.reviewer_ref == "user-1"
        assert identity.owner_ref == "user-1"
        assert identity.auth_context.actor_ref == "user-1"


# ---------------------------------------------------------------------------
# Bearer access-token jti compatibility tests
# ---------------------------------------------------------------------------


class TestBearerTokenJtiHandling:
    def test_first_use_of_jti_is_accepted(
        self, db: Session, key_pair: tuple,
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token_with_jti(private_key, jti="unique-jti-1")

        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            identity = resolver.resolve(
                db=db, request=_request_with_token(token),
            )
        assert identity.user_id == "user-1"

    def test_same_valid_access_token_can_be_used_for_multiple_requests(
        self, db: Session, key_pair: tuple,
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token_with_jti(private_key, jti="replay-jti-1")

        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            first = resolver.resolve(db=db, request=_request_with_token(token))
            second = resolver.resolve(db=db, request=_request_with_token(token))
        assert first.user_id == second.user_id == "user-1"

    def test_different_jtis_are_accepted(
        self, db: Session, key_pair: tuple,
    ) -> None:
        private_key, jwk = key_pair
        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            for i in range(5):
                token = _build_token_with_jti(
                    private_key, jti=f"multi-jti-{i}",
                )
                identity = resolver.resolve(
                    db=db, request=_request_with_token(token),
                )
                assert identity.user_id == "user-1"

    def test_token_without_jti_is_accepted(
        self, db: Session, key_pair: tuple,
    ) -> None:
        """RFC 7519 defines jti as optional for an ordinary bearer JWT."""
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key, include_jti=False)

        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            identity = resolver.resolve(db=db, request=_request_with_token(token))
        assert identity.user_id == "user-1"


# ---------------------------------------------------------------------------
# ADR-0064: aud array support tests
# ---------------------------------------------------------------------------


class TestAudArraySupport:
    def test_aud_as_single_string_is_accepted(
        self, db: Session, key_pair: tuple,
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key, audience="sui-sensemaking")

        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            identity = resolver.resolve(
                db=db, request=_request_with_token(token),
            )
        assert identity.user_id == "user-1"

    def test_aud_as_array_is_accepted(
        self, db: Session, key_pair: tuple,
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token_with_aud_array(
            private_key, audience=["other-app", "sui-sensemaking"],
        )

        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            identity = resolver.resolve(
                db=db, request=_request_with_token(token),
            )
        assert identity.user_id == "user-1"

    def test_aud_array_without_matching_value_is_rejected(
        self, db: Session, key_pair: tuple,
    ) -> None:
        private_key, jwk = key_pair
        token = _build_token_with_aud_array(
            private_key, audience=["other-app", "different-app"],
        )

        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            with pytest.raises(JwtIdentityError) as exc:
                resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 401


class TestExpectedAudienceIsChosenByTheCaller:
    """呼び出し元が指定した audience だけを許す。トークン自身の aud を代わりに信用しない。"""

    ISSUER = "https://broker.invalid/issuer"

    def test_a_token_minted_for_another_audience_is_rejected(self, key_pair: tuple) -> None:
        private_key, jwk = key_pair
        token = _build_token(private_key=private_key, audience="https://mcp.invalid/mcp")

        with pytest.raises(JwtIdentityError) as exc:
            _verify_jwt(token, [jwk], self.ISSUER, "sui-sensemaking-agents")

        assert exc.value.status_code == 401
        assert exc.value.code == "invalid_audience"

    def test_an_aud_array_is_accepted_only_when_it_contains_the_expected_audience(
        self, key_pair: tuple
    ) -> None:
        private_key, jwk = key_pair
        with_expected = _build_token_with_aud_array(
            private_key, audience=["https://mcp.invalid/mcp", "sui-sensemaking-agents"]
        )
        without_expected = _build_token_with_aud_array(
            private_key, audience=["https://mcp.invalid/mcp", "another-app"]
        )

        claims = _verify_jwt(with_expected, [jwk], self.ISSUER, "sui-sensemaking-agents")
        with pytest.raises(JwtIdentityError) as exc:
            _verify_jwt(without_expected, [jwk], self.ISSUER, "sui-sensemaking-agents")

        assert claims["sub"] == "subject-1"
        assert exc.value.code == "invalid_audience"


# ---------------------------------------------------------------------------
# ADR-0064: kid-less token support tests
# ---------------------------------------------------------------------------


class TestKidLessTokens:
    def test_single_key_jwks_without_kid_is_accepted(
        self, db: Session, key_pair: tuple,
    ) -> None:
        private_key, jwk = key_pair
        # Remove kid from JWKS and token header.
        jwk_no_kid = {k: v for k, v in jwk.items() if k != "kid"}
        token = _build_token_without_kid(private_key)

        store = JwksStore()
        store.set("idp-1", [jwk_no_kid])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[jwk_no_kid],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            identity = resolver.resolve(
                db=db, request=_request_with_token(token),
            )
        assert identity.user_id == "user-1"

    def test_multi_key_jwks_without_kid_is_rejected(
        self, db: Session, key_pair: tuple,
    ) -> None:
        private_key, jwk = key_pair
        other_key, other_jwk = _generate_rs256_key_pair()
        token = _build_token_without_kid(private_key)

        store = JwksStore()
        store.set("idp-1", [jwk, other_jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks",
            return_value=[jwk, other_jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            with pytest.raises(JwtIdentityError) as exc:
                resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# ADR-0064: iat / nbf verification tests
# ---------------------------------------------------------------------------


class TestTimeVerification:
    def test_future_iat_is_rejected(
        self, db: Session, key_pair: tuple,
    ) -> None:
        """Tokens issued in the future (iat > now + skew) are rejected."""
        private_key, jwk = key_pair
        token = _build_token_with_custom_time(
            private_key, iat_offset=+7200,  # 2 hours in the future
        )
        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            with pytest.raises(JwtIdentityError) as exc:
                resolver.resolve(db=db, request=_request_with_token(token))
        assert exc.value.status_code == 401

    def test_past_nbf_is_accepted(
        self, db: Session, key_pair: tuple,
    ) -> None:
        """Tokens with nbf in the past are accepted."""
        private_key, jwk = key_pair
        token = _build_token_with_custom_time(
            private_key, nbf_offset=-3600,  # 1 hour in the past
        )
        store = JwksStore()
        store.set("idp-1", [jwk])
        with patch(
            "sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk],
        ):
            resolver = JwtSaasIdentityContextResolver(jwks_store=store)
            identity = resolver.resolve(
                db=db, request=_request_with_token(token),
            )
        assert identity.user_id == "user-1"


# ---------------------------------------------------------------------------
# Helpers for new tests
# ---------------------------------------------------------------------------


def _build_token_with_custom_time(
    private_key, *, iat_offset: int = 0, nbf_offset: int = 0,
) -> str:
    now = int(_time_module.time())
    payload: dict[str, object] = {
        "iss": "https://broker.invalid/issuer",
        "aud": "sui-sensemaking", "sub": "subject-1",
        "tenant_ref": "org-123",
        "iat": now + iat_offset,
        "exp": now + 7200,
        "jti": str(uuid4()),
    }
    if nbf_offset != 0:
        payload["nbf"] = now + nbf_offset
    return jwt.encode(
        payload,
        _private_key_pem(private_key),
        algorithm="RS256",
        headers={"kid": "test-key-1"},
    )


def _build_token_with_jti(
    private_key,
    *,
    jti: str,
    issuer: str = "https://broker.invalid/issuer",
    audience: str = "sui-sensemaking",
) -> str:
    now = int(_time_module.time())
    payload: dict[str, object] = {
        "iss": issuer, "aud": audience, "sub": "subject-1",
        "tenant_ref": "org-123", "iat": now - 60, "exp": now + 3600,
        "jti": jti,
    }
    return jwt.encode(
        payload,
        _private_key_pem(private_key),
        algorithm="RS256",
        headers={"kid": "test-key-1"},
    )


def _build_token_with_aud_array(
    private_key,
    *,
    audience: list[str],
) -> str:
    now = int(_time_module.time())
    payload: dict[str, object] = {
        "iss": "https://broker.invalid/issuer",
        "aud": audience, "sub": "subject-1",
        "tenant_ref": "org-123", "iat": now - 60, "exp": now + 3600,
        "jti": str(uuid4()),
    }
    return jwt.encode(
        payload,
        _private_key_pem(private_key),
        algorithm="RS256",
        headers={"kid": "test-key-1"},
    )


def _build_token_without_kid(private_key) -> str:
    now = int(_time_module.time())
    payload: dict[str, object] = {
        "iss": "https://broker.invalid/issuer",
        "aud": "sui-sensemaking", "sub": "subject-1",
        "tenant_ref": "org-123", "iat": now - 60, "exp": now + 3600,
        "jti": str(uuid4()),
    }
    return jwt.encode(
        payload,
        _private_key_pem(private_key),
        algorithm="RS256",
    )
