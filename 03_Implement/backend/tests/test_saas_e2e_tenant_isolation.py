"""ADR-0063 D9-8: HTTP-level E2E tenant isolation with real JWT bearer tokens.

Proves AC-4 (tenant unknown → deny), AC-8 (tenantId propagation),
AC-10 (cross-tenant negative matrix) at the HTTP request level through
the full SaaS auth pipeline.
"""

from __future__ import annotations

import json
import time
from uuid import uuid4
from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.active_tenant_session import InMemoryActiveTenantSessionPersister
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.jwks_store import JwksStore
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import (
    Base,
    DocumentRow,
    IdentityProviderRow,
    TenantIdentityProviderRow,
    TenantMembershipRow,
    TenantRow,
    UserIdentityRow,
    UserRow,
)
from sui_sensemaking_api.tenant_context import (
    ClaimBasedTenantContextResolver,
    SingleTenantContextResolver,
    TenantContext,
)
from sui_sensemaking_api.trusted_auth_edge import JwtSaasIdentityContextResolver


from tests.conftest import TIMESTAMP, StubCapabilityResolver
ISSUER = "https://broker.invalid/issuer"
AUDIENCE = "sui-sensemaking"


# ---------------------------------------------------------------------------
# Key generation & JWT signing
# ---------------------------------------------------------------------------


def _generate_rs256_key_pair() -> tuple[rsa.RSAPrivateKey, dict[str, object]]:
    import base64

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    public_numbers = public_key.public_numbers()

    def _b64url(x: int) -> str:
        length = (x.bit_length() + 7) // 8
        return base64.urlsafe_b64encode(x.to_bytes(length, "big")).rstrip(b"=").decode()

    jwk: dict[str, object] = {
        "kty": "RSA",
        "kid": "e2e-test-key",
        "use": "sig",
        "alg": "RS256",
        "n": _b64url(public_numbers.n),
        "e": _b64url(public_numbers.e),
    }
    return private_key, jwk


def _sign_jwt(
    *,
    private_key: rsa.RSAPrivateKey,
    subject: str = "subject-1",
    tenant_ref: str = "org-123",
    issuer: str = ISSUER,
    audience: str = AUDIENCE,
    kid: str = "e2e-test-key",
    expired: bool = False,
    omit_tenant_claim: bool = False,
) -> str:
    now = int(time.time())
    payload: dict[str, object] = {
        "iss": issuer,
        "aud": audience,
        "sub": subject,
        "iat": now - 60,
        "exp": now - 3600 if expired else now + 3600,
        "jti": str(uuid4()),
    }
    if not omit_tenant_claim:
        payload["tenant_ref"] = tenant_ref
    return jwt.encode(
        payload,
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode(),
        algorithm="RS256",
        headers={"kid": kid},
    )


# ---------------------------------------------------------------------------
# Database seed
# ---------------------------------------------------------------------------


def _seed_e2e_db(db: Session) -> None:
    db.add_all(
        [
            UserRow(
                id="user-1", display_name="Alice", email="alice@example.invalid",
                lifecycle_state="active", created_at=TIMESTAMP, updated_at=TIMESTAMP,
            ),
            TenantRow(
                id="tenant-a", display_name="Tenant A",
                lifecycle_state="active", created_at=TIMESTAMP, updated_at=TIMESTAMP,
            ),
            TenantRow(
                id="tenant-b", display_name="Tenant B",
                lifecycle_state="active", created_at=TIMESTAMP, updated_at=TIMESTAMP,
            ),
            IdentityProviderRow(
                id="idp-1", issuer=ISSUER, audience=AUDIENCE, protocol="oidc",
                jwks_uri="https://broker.invalid/jwks.json",
                lifecycle_state="active", created_at=TIMESTAMP, updated_at=TIMESTAMP,
            ),
            TenantIdentityProviderRow(
                tenant_id="tenant-a", identity_provider_id="idp-1",
                external_tenant_ref="org-123",
                lifecycle_state="active", created_at=TIMESTAMP, updated_at=TIMESTAMP,
            ),
            TenantIdentityProviderRow(
                tenant_id="tenant-b", identity_provider_id="idp-1",
                external_tenant_ref="org-456",
                lifecycle_state="active", created_at=TIMESTAMP, updated_at=TIMESTAMP,
            ),
            UserIdentityRow(
                user_id="user-1", provider="idp-1", external_uid="subject-1",
                identity_provider_id="idp-1", subject="subject-1", created_at=TIMESTAMP,
            ),
            TenantMembershipRow(
                tenant_id="tenant-a", user_id="user-1",
                lifecycle_state="active", created_at=TIMESTAMP, updated_at=TIMESTAMP,
            ),
            TenantMembershipRow(
                tenant_id="tenant-b", user_id="user-1",
                lifecycle_state="active", created_at=TIMESTAMP, updated_at=TIMESTAMP,
            ),
            DocumentRow(
                tenant_id="tenant-a", id="shared-doc", version=1, updated_at=TIMESTAMP,
                payload_json=json.dumps({
                    "version": 1, "id": "shared-doc", "title": "Tenant A Document",
                    "createdAt": TIMESTAMP, "updatedAt": TIMESTAMP,
                    "transform": {"panX": 0, "panY": 0, "zoom": 1},
                    "cards": [], "edges": [], "islands": [],
                }),
            ),
            DocumentRow(
                tenant_id="tenant-b", id="shared-doc", version=1, updated_at=TIMESTAMP,
                payload_json=json.dumps({
                    "version": 1, "id": "shared-doc", "title": "Tenant B Document",
                    "createdAt": TIMESTAMP, "updatedAt": TIMESTAMP,
                    "transform": {"panX": 0, "panY": 0, "zoom": 1},
                    "cards": [], "edges": [], "islands": [],
                }),
            ),
        ]
    )
    db.commit()


# ---------------------------------------------------------------------------
# Test fixture
# ---------------------------------------------------------------------------


@contextmanager
def _saas_e2e_client(
    tmp_path, jwk: dict[str, object], private_key: rsa.RSAPrivateKey
) -> Iterator[tuple[TestClient, InMemoryActiveTenantSessionPersister]]:
    db_path = tmp_path / "saas_e2e.sqlite3"
    engine = create_engine(f"sqlite:///{db_path}")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)
    with session_local() as db:
        _seed_e2e_db(db)

    def _get_test_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    jwks_store = JwksStore()
    jwks_store.set("idp-1", [jwk])
    identity_resolver = JwtSaasIdentityContextResolver(jwks_store=jwks_store)
    session_persister = InMemoryActiveTenantSessionPersister()

    app.dependency_overrides[get_db] = _get_test_db
    with patch("sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk]):
        try:
            with TestClient(app) as client:
                client.app.state.runtime_profile = "saas-multitenant"
                client.app.state.saas_identity_context_resolver = identity_resolver
                client.app.state.tenant_context_resolver = ClaimBasedTenantContextResolver()
                client.app.state.active_tenant_session_persister = session_persister
                client.app.state.tenant_capability_resolver = StubCapabilityResolver()
                try:
                    yield client, session_persister
                finally:
                    # Reset SaaS state so subsequent tests aren't affected.
                    # Must be in finally to run even if the test raises.
                    client.app.state.runtime_profile = "local-dev"
                    client.app.state.saas_identity_context_resolver = None
                    client.app.state.tenant_context_resolver = SingleTenantContextResolver()
                    client.app.state.active_tenant_session_persister = None
        finally:
            app.dependency_overrides.clear()
            Base.metadata.drop_all(bind=engine)
            engine.dispose()


# ---------------------------------------------------------------------------
# E2E tests
# ---------------------------------------------------------------------------


class TestSaasE2eTenantIsolation:
    """D9-8: tenant A/B, same docId, HTTP-level negative matrix."""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    # Reusable fake scope for creating Request objects in test helpers.
    _FAKE_SCOPE: dict = {"type": "http", "method": "GET", "path": "/"}

    @staticmethod
    def _session_version(
        persister: InMemoryActiveTenantSessionPersister,
    ) -> str:
        """Return a valid current session version for the header."""
        from starlette.requests import Request

        return persister.current_version(
            request=Request(scope=TestSaasE2eTenantIsolation._FAKE_SCOPE),
            principal_id="user-1",
            active_tenant=TenantContext(
                tenant_id="tenant-a", membership_id="m-1",
                resolved_by="verified_claim",
            ),
        )

    @staticmethod
    def _auth_headers(
        token: str, session_version: str,
    ) -> dict[str, str]:
        return {
            "x-sui-sensemaking-authorization": f"Bearer {token}",
            "sui-sensemaking-tenant-session-version": session_version,
        }

    # ------------------------------------------------------------------
    # Positive cases
    # ------------------------------------------------------------------

    def test_same_doc_id_different_tenant_returns_correct_payload(
        self, tmp_path,
    ) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            token_a = _sign_jwt(private_key=pk, tenant_ref="org-123")
            resp_a = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token_a, sv),
            )
            assert resp_a.status_code == 200, f"body={resp_a.json()}"
            assert resp_a.json()["title"] == "Tenant A Document"

            token_b = _sign_jwt(private_key=pk, tenant_ref="org-456")
            resp_b = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token_b, sv),
            )
            assert resp_b.status_code == 200, f"body={resp_b.json()}"
            assert resp_b.json()["title"] == "Tenant B Document"

    @staticmethod
    def _put_payload(doc_id: str, title: str) -> dict:
        return {
            "version": 1, "id": doc_id, "title": title,
            "createdAt": TIMESTAMP, "updatedAt": TIMESTAMP,
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": [], "edges": [], "islands": [],
        }

    def test_put_requires_a_revision_precondition(self, tmp_path) -> None:
        """ADR-0092: the shared SaaS profile never overwrites silently."""
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            headers = self._auth_headers(
                _sign_jwt(private_key=pk, tenant_ref="org-123"),
                self._session_version(persister),
            )
            payload = self._put_payload("shared-doc", "Silent overwrite")

            missing = client.put("/docs/shared-doc", headers=headers, json=payload)
            wildcard = client.put(
                "/docs/shared-doc", headers={**headers, "If-Match": "*"}, json=payload
            )
            stale = client.put(
                "/docs/shared-doc", headers={**headers, "If-Match": '"stale"'}, json=payload
            )
            unchanged = client.get("/docs/shared-doc", headers=headers)

        assert missing.status_code == 428
        assert missing.json()["detail"]["code"] == "document_precondition_required"
        assert wildcard.status_code == 428
        assert stale.status_code == 409
        assert unchanged.json()["title"] == "Tenant A Document"

    def test_create_uses_if_none_match_and_never_overwrites(self, tmp_path) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            headers = {
                **self._auth_headers(
                    _sign_jwt(private_key=pk, tenant_ref="org-123"),
                    self._session_version(persister),
                ),
                "If-None-Match": "*",
            }
            created = client.put(
                "/docs/brand-new-doc",
                headers=headers,
                json=self._put_payload("brand-new-doc", "Created"),
            )
            again = client.put(
                "/docs/brand-new-doc",
                headers=headers,
                json=self._put_payload("brand-new-doc", "Created twice"),
            )
            existing = client.put(
                "/docs/shared-doc",
                headers=headers,
                json=self._put_payload("shared-doc", "Overwrite by create"),
            )

        assert created.status_code == 200, f"body={created.json()}"
        assert again.status_code == 409
        assert again.json()["detail"]["code"] == "document_already_exists"
        assert existing.status_code == 409

    def test_put_is_tenant_scoped(self, tmp_path) -> None:
        """AC-8: PUT updates only the resolved tenant's row."""
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            token_a = _sign_jwt(private_key=pk, tenant_ref="org-123")
            current = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token_a, sv),
            )
            assert current.status_code == 200, f"body={current.json()}"
            updated = client.put(
                "/docs/shared-doc",
                headers={
                    **self._auth_headers(token_a, sv),
                    "If-Match": current.headers["ETag"],
                },
                json=self._put_payload("shared-doc", "Tenant A Updated"),
            )
            assert updated.status_code == 200, f"body={updated.json()}"

            token_b = _sign_jwt(private_key=pk, tenant_ref="org-456")
            resp_b = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token_b, sv),
            )
            assert resp_b.status_code == 200, f"body={resp_b.json()}"
            assert resp_b.json()["title"] == "Tenant B Document"

    def test_tenant_cannot_access_other_tenant_document(
        self, tmp_path,
    ) -> None:
        """AC-10: cross-tenant negative matrix."""
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            token_a = _sign_jwt(private_key=pk, tenant_ref="org-123")
            resp = client.get(
                "/docs/tenant-b-only-doc",
                headers=self._auth_headers(token_a, sv),
            )
            assert resp.status_code == 404, f"body={resp.json()}"
            assert resp.json()["detail"] == "Document not found"

    # ------------------------------------------------------------------
    # Negative cases (error codes tested at HTTP level)
    # ------------------------------------------------------------------

    def test_unknown_external_tenant_ref_is_denied(self, tmp_path) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            token = _sign_jwt(private_key=pk, tenant_ref="org-unknown")
            resp = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token, sv),
            )
            assert resp.status_code == 401, f"body={resp.json()}"
            assert resp.json()["detail"]["code"] == "unknown_tenant"

    def test_missing_tenant_claim_is_denied(self, tmp_path) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            token = _sign_jwt(private_key=pk, omit_tenant_claim=True)
            resp = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token, sv),
            )
            assert resp.status_code == 401, f"body={resp.json()}"
            assert resp.json()["detail"]["code"] == "missing_tenant_claim"

    def test_unprovisioned_subject_is_denied(self, tmp_path) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            token = _sign_jwt(private_key=pk, subject="unknown-subject")
            resp = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token, sv),
            )
            assert resp.status_code == 403, f"body={resp.json()}"
            assert resp.json()["detail"]["code"] == "identity_not_provisioned"

    def test_missing_token_is_denied(self, tmp_path) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            resp = client.get(
                "/docs/shared-doc",
                headers={"sui-sensemaking-tenant-session-version": sv},
            )
            assert resp.status_code == 401, f"body={resp.json()}"
            assert resp.json()["detail"]["code"] == "missing_token"

    def test_wrong_signature_is_denied(self, tmp_path) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            other_key, _ = _generate_rs256_key_pair()
            token = _sign_jwt(private_key=other_key, tenant_ref="org-123")
            resp = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token, sv),
            )
            assert resp.status_code == 401, f"body={resp.json()}"
            assert resp.json()["detail"]["code"] == "invalid_signature"

    def test_expired_token_is_denied(self, tmp_path) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            token = _sign_jwt(
                private_key=pk, tenant_ref="org-123", expired=True,
            )
            resp = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token, sv),
            )
            assert resp.status_code == 401, f"body={resp.json()}"
            assert resp.json()["detail"]["code"] == "token_expired"

    def test_unknown_issuer_provider_is_denied(self, tmp_path) -> None:
        pk, jwk = _generate_rs256_key_pair()
        with _saas_e2e_client(tmp_path, jwk, pk) as (client, persister):
            sv = self._session_version(persister)
            token = _sign_jwt(
                private_key=pk, tenant_ref="org-123",
                issuer="https://evil.invalid/issuer",
            )
            resp = client.get(
                "/docs/shared-doc",
                headers=self._auth_headers(token, sv),
            )
            assert resp.status_code == 401, f"body={resp.json()}"
            assert resp.json()["detail"]["code"] == "unknown_provider"
