"""ADR-0093: Tenant Adminによる agent 資格情報の登録・一覧・失効。"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.access_control import AuthContext
from sui_sensemaking_api.agent_credential_models import (
    AgentCredentialIndexRow,
    AgentCredentialRow,
)
from sui_sensemaking_api.agent_credentials import AGENT_CREDENTIAL_HEADER
from sui_sensemaking_api.auth_context import ResolvedIdentity
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import (
    Base,
    DocumentRow,
    TenantMembershipRow,
    TenantRow,
    UserRow,
)
from sui_sensemaking_api.session_context import CapabilitySnapshot
from sui_sensemaking_api.tenant_context import (
    SingleTenantContextResolver,
    TenantContext,
    select_active_tenant_context,
)

TIMESTAMP = "2026-10-09T00:00:00Z"
HASH_KEY = bytes.fromhex("ab" * 32)
BASE = "/tenant-admin/agent-credentials"


def _expiry(days: float = 7) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _body(**overrides: object) -> dict[str, object]:
    return {
        "agentId": "agent-1",
        "label": "Claude collaborator",
        "expiresAt": _expiry(),
        "docIds": ["shared-doc"],
        **overrides,
    }


@dataclass
class StaticIdentityResolver:
    def resolve(self, *, db: Session, request: Request) -> ResolvedIdentity:  # noqa: ARG002
        return ResolvedIdentity(
            user_id="admin-1",
            reviewer_ref="user:admin-1",
            owner_ref="user:admin-1",
            auth_context=AuthContext(actor_ref="user:admin-1", user_id="admin-1", trace_id=None),
        )


@dataclass
class MutableTenantResolver:
    tenant_id: str = "tenant-a"

    def resolve(self, *, db: Session, user_id: str | None, claim: object = None) -> TenantContext:  # noqa: ARG002
        return select_active_tenant_context(
            db=db, user_id=user_id or "", tenant_id=self.tenant_id, resolved_by="verified_claim"
        )


@dataclass
class MutableCapabilityResolver:
    capabilities: tuple[str, ...] = ("agent.register", "agent.revoke")

    def resolve(
        self, *, db: Session, principal_id: str, tenant: TenantContext
    ) -> CapabilitySnapshot:  # noqa: ARG002
        return CapabilitySnapshot(effective_capabilities=self.capabilities, capability_version="v1")


class StaticTenantSessionPersister:
    def current_version(self, **_: object) -> str:
        return "session-v1"

    def persist(self, **_: object) -> str:
        return "session-v2"


def _payload(doc_id: str, title: str) -> str:
    return json.dumps(
        {
            "version": 1,
            "id": doc_id,
            "title": title,
            "createdAt": TIMESTAMP,
            "updatedAt": TIMESTAMP,
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": [{"id": "c1", "text": "t", "x": 0, "y": 0, "textReviewed": True}],
            "edges": [],
            "islands": [],
        }
    )


def _seed(db: Session) -> None:
    db.add(
        UserRow(
            id="admin-1",
            display_name="Admin",
            email="admin@example.invalid",
            lifecycle_state="active",
            created_at=TIMESTAMP,
            updated_at=TIMESTAMP,
        )
    )
    for tenant_id in ("tenant-a", "tenant-b"):
        db.add(
            TenantRow(
                id=tenant_id,
                display_name=tenant_id,
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            )
        )
        db.add(
            TenantMembershipRow(
                tenant_id=tenant_id,
                user_id="admin-1",
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            )
        )
    for tenant_id, doc_id in (
        ("tenant-a", "shared-doc"),
        ("tenant-a", "a-second"),
        ("tenant-b", "shared-doc"),
        ("tenant-b", "b-only"),
    ):
        db.add(
            DocumentRow(
                tenant_id=tenant_id,
                id=doc_id,
                version=1,
                updated_at=TIMESTAMP,
                payload_json=_payload(doc_id, f"{tenant_id}-{doc_id}"),
                created_by="owner",
                lifecycle_state="active",
            )
        )
    db.commit()


@contextmanager
def _client(
    tmp_path,
) -> Iterator[tuple[TestClient, sessionmaker, MutableTenantResolver, MutableCapabilityResolver]]:
    engine = create_engine(f"sqlite:///{tmp_path / 'agent-admin.sqlite3'}")
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)
    with factory() as db:
        _seed(db)

    def _get_test_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    tenant_resolver = MutableTenantResolver()
    capability_resolver = MutableCapabilityResolver()
    app.dependency_overrides[get_db] = _get_test_db
    try:
        with TestClient(app) as client:
            client.app.state.saas_identity_context_resolver = StaticIdentityResolver()
            client.app.state.tenant_context_resolver = tenant_resolver
            client.app.state.tenant_capability_resolver = capability_resolver
            client.app.state.active_tenant_session_persister = StaticTenantSessionPersister()
            client.app.state.agent_credential_hash_key = HASH_KEY
            client.app.state.access_control_adapter = None
            yield client, factory, tenant_resolver, capability_resolver
    finally:
        app.dependency_overrides.clear()
        app.state.saas_identity_context_resolver = None
        app.state.tenant_capability_resolver = None
        app.state.active_tenant_session_persister = None
        app.state.agent_credential_hash_key = None
        app.state.tenant_context_resolver = SingleTenantContextResolver()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _agent_get(client: TestClient, token: str, doc_id: str = "shared-doc"):
    return client.get(f"/docs/{doc_id}", headers={AGENT_CREDENTIAL_HEADER: token})


def test_registered_credential_is_returned_once_and_reads_only_granted_documents(tmp_path) -> None:
    with _client(tmp_path) as (client, factory, _, _):
        created = client.post(BASE, json=_body())
        token = created.json()["credential"]
        listed = client.get(BASE)
        granted = _agent_get(client, token)
        ungranted = _agent_get(client, token, "a-second")
        with factory() as db:
            stored = " ".join(
                str(value)
                for model in (AgentCredentialRow, AgentCredentialIndexRow)
                for row in db.scalars(select(model)).all()
                for value in row.__dict__.values()
            )

    assert created.status_code == 201, created.text
    assert token.startswith("suiag_")
    assert created.headers["cache-control"] == "no-store"
    assert listed.status_code == 200 and listed.headers["cache-control"] == "no-store"
    assert token not in listed.text and "credential" not in listed.json()["items"][0]
    assert listed.json()["items"][0]["docIds"] == ["shared-doc"]
    assert granted.status_code == 200
    assert ungranted.status_code == 404
    assert token not in stored


def test_registration_and_revocation_need_their_own_capabilities(tmp_path) -> None:
    with _client(tmp_path) as (client, _, _, capabilities):
        capabilities.capabilities = ("agent.revoke", "document.policy.manage")
        register = client.post(BASE, json=_body())
        capabilities.capabilities = ("agent.register",)
        created = client.post(BASE, json=_body())
        revoke = client.post(f"{BASE}/agent-1/revoke")
        grant_revoke = client.delete(f"{BASE}/agent-1/documents/shared-doc")
        capabilities.capabilities = ("document.read", "document.policy.manage")
        listed = client.get(BASE)

    assert register.status_code == 403
    assert register.json()["detail"]["code"] == "agent_credential_manage_required"
    assert created.status_code == 201
    assert revoke.status_code == 403 and grant_revoke.status_code == 403
    assert listed.status_code == 403


def test_management_is_closed_without_a_trusted_saas_identity(tmp_path) -> None:
    with _client(tmp_path) as (client, _, _, _):
        client.app.state.saas_identity_context_resolver = None
        response = client.get(BASE)

    assert response.status_code == 503


def test_tenant_admins_cannot_see_or_change_another_tenants_credentials(tmp_path) -> None:
    with _client(tmp_path) as (client, _, tenants, _):
        token_a = client.post(BASE, json=_body()).json()["credential"]
        tenants.tenant_id = "tenant-b"
        listed_b = client.get(BASE)
        revoke_b = client.post(f"{BASE}/agent-1/revoke")
        grant_b = client.delete(f"{BASE}/agent-1/documents/shared-doc")
        tenants.tenant_id = "tenant-a"
        still_works = _agent_get(client, token_a)

    assert listed_b.json() == {"items": []}
    assert revoke_b.status_code == 404 and grant_b.status_code == 404
    assert still_works.status_code == 200


def test_a_document_of_another_tenant_cannot_be_granted(tmp_path) -> None:
    with _client(tmp_path) as (client, _, _, _):
        response = client.post(BASE, json=_body(docIds=["b-only"]))
        listed = client.get(BASE)

    assert response.status_code == 404
    assert listed.json() == {"items": []}


def test_revocation_applies_to_the_next_agent_request_and_is_idempotent(tmp_path) -> None:
    with _client(tmp_path) as (client, _, _, _):
        token = client.post(BASE, json=_body(docIds=["shared-doc", "a-second"])).json()[
            "credential"
        ]
        assert _agent_get(client, token, "a-second").status_code == 200
        grant_revoked = client.delete(f"{BASE}/agent-1/documents/a-second")
        after_grant = _agent_get(client, token, "a-second")
        still_other = _agent_get(client, token)
        revoked = client.post(f"{BASE}/agent-1/revoke")
        revoked_again = client.post(f"{BASE}/agent-1/revoke")
        after_revoke = _agent_get(client, token)
        unknown = client.post(f"{BASE}/nobody/revoke")
        listed = client.get(BASE).json()["items"][0]

    assert grant_revoked.status_code == 204 and after_grant.status_code == 404
    assert still_other.status_code == 200
    assert revoked.status_code == 204 and revoked_again.status_code == 204
    assert after_revoke.status_code == 401
    assert unknown.status_code == 404
    assert listed["status"] == "revoked" and listed["revokedAt"] is not None


@pytest.mark.parametrize(
    "expires_at",
    [
        lambda: _expiry(-1),
        lambda: _expiry(91),
        lambda: "2099-01-01T00:00:00",  # タイムゾーンなし
    ],
)
def test_expiry_must_be_future_bounded_and_timezone_aware(tmp_path, expires_at) -> None:
    with _client(tmp_path) as (client, _, _, _):
        response = client.post(BASE, json=_body(expiresAt=expires_at()))
        listed = client.get(BASE)

    assert response.status_code == 422
    assert listed.json() == {"items": []}


@pytest.mark.parametrize(
    "overrides",
    [
        {"docIds": []},
        {"docIds": ["shared-doc", "shared-doc"]},
        {"agentId": "bad id/with space"},
        {"label": ""},
        {"unexpected": "field"},
    ],
)
def test_invalid_requests_are_rejected_without_creating_anything(tmp_path, overrides) -> None:
    with _client(tmp_path) as (client, _, _, _):
        response = client.post(BASE, json=_body(**overrides))
        listed = client.get(BASE)

    assert response.status_code == 422
    assert listed.json() == {"items": []}


def test_an_agent_id_cannot_be_registered_twice(tmp_path) -> None:
    with _client(tmp_path) as (client, _, _, _):
        first = client.post(BASE, json=_body())
        second = client.post(BASE, json=_body(label="other"))
        client.post(f"{BASE}/agent-1/revoke")
        after_revoke = client.post(BASE, json=_body(label="reuse"))

    assert first.status_code == 201
    assert second.status_code == 409 and after_revoke.status_code == 409


def test_issuance_is_unavailable_without_a_hash_key(tmp_path) -> None:
    with _client(tmp_path) as (client, _, _, _):
        client.app.state.agent_credential_hash_key = None
        response = client.post(BASE, json=_body())

    assert response.status_code == 503
