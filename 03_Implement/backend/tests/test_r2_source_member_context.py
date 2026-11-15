"""R2 Source member preflight: request-bound authentication, NOT Source Grant.

The trusted SaaS resolver is a test double here; Product OIDC verification
and Source Policy/Reader remain separate acceptance steps.
"""
from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from sui_sensemaking_api.access_control import AuthContext
from sui_sensemaking_api.auth_context import ResolvedIdentity
from sui_sensemaking_api.source_member_context import resolve_source_member_context
from sui_sensemaking_api.tenant_context import TenantContext

HEADER = "Sui-Sensemaking-Tenant-Session-Version"
TENANT = TenantContext(
    tenant_id="tenant-a",
    membership_id="membership-a",
    resolved_by="verified_claim",
)
IDENTITY = ResolvedIdentity(
    user_id="member-a",
    reviewer_ref=None,
    owner_ref=None,
    auth_context=AuthContext(
        actor_ref="member-a", user_id="member-a", provider="oidc"
    ),
)


def _test_client(
    monkeypatch: pytest.MonkeyPatch,
    *,
    runtime_profile: str = "saas-multitenant",
    identity: ResolvedIdentity = IDENTITY,
    tenant: TenantContext = TENANT,
    fail: bool = False,
) -> tuple[TestClient, list[str]]:
    app = FastAPI()
    app.state.runtime_profile = runtime_profile
    calls: list[str] = []

    def trusted_resolver(*, request: Request, db: object):
        _ = (request, db)
        calls.append("trusted-session")
        if fail:
            raise HTTPException(
                status_code=503,
                detail={"code": "tenant_admin_auth_unavailable"},
            )
        return SimpleNamespace(
            identity=identity,
            tenant=tenant,
            session=SimpleNamespace(tenant_session_version="version-2"),
        )

    monkeypatch.setattr(
        "sui_sensemaking_api.source_member_context.resolve_trusted_saas_request_session",
        trusted_resolver,
    )

    @app.get("/source-preflight")
    def preflight(request: Request):
        context = resolve_source_member_context(request=request, db=object())
        # Never expose this as a Product route. Only enough data for unit tests.
        return {
            "principal": context.principal.actor_ref,
            "tenant": context.tenant.tenant_id,
        }

    return TestClient(app), calls


def test_trusted_saas_member_with_current_session_prepares_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, calls = _test_client(monkeypatch)
    with client:
        response = client.get(
            "/source-preflight",
            headers={HEADER: "version-2"},
        )
    assert response.status_code == 200
    assert response.json() == {
        "principal": "member-a",
        "tenant": "tenant-a",
    }
    assert calls == ["trusted-session"]


@pytest.mark.parametrize("headers", [
    {},
    {HEADER: "stale-version"},
    [(HEADER, "version-2"), (HEADER, "version-2")],
])
def test_missing_stale_or_ambiguous_active_session_fails_closed(
    monkeypatch: pytest.MonkeyPatch, headers,
) -> None:
    client, calls = _test_client(monkeypatch)
    with client:
        response = client.get("/source-preflight", headers=headers)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "tenant_session_changed"
    assert calls == ["trusted-session"]


@pytest.mark.parametrize("profile", ["enterprise-production", "unknown"])
def test_non_saas_or_unknown_profile_never_uses_header_identity(
    monkeypatch: pytest.MonkeyPatch, profile: str,
) -> None:
    client, calls = _test_client(monkeypatch, runtime_profile=profile)
    with client:
        response = client.get(
            "/source-preflight",
            headers={HEADER: "version-2", "X-Forwarded-User": "member-a"},
        )
    assert response.status_code == (503 if profile == "unknown" else 403)
    assert calls == []


@pytest.mark.parametrize("header", [
    "Sui-Sensemaking-Agent-Credential",
    "Sui-Sensemaking-Agent-Bearer",
])
def test_agent_credentials_cannot_be_promoted_from_document_grant(
    monkeypatch: pytest.MonkeyPatch, header: str,
) -> None:
    client, calls = _test_client(monkeypatch)
    with client:
        response = client.get(
            "/source-preflight",
            headers={HEADER: "version-2", header: "agent-token"},
        )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "source_member_context_unavailable"
    assert calls == []


def test_mixed_agent_member_credentials_rejected_before_session_lookup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, calls = _test_client(monkeypatch)
    with client:
        response = client.get(
            "/source-preflight",
            headers={
                HEADER: "version-2",
                "Sui-Sensemaking-Agent-Credential": "agent-token",
                "X-Sui-Sensemaking-Authorization": "member-token",
            },
        )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "agent_credential_conflict"
    assert calls == []


def test_guest_cookie_cannot_be_promoted_from_document_grant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, calls = _test_client(monkeypatch)
    with client:
        response = client.get(
            "/source-preflight",
            headers={HEADER: "version-2"},
            cookies={"Sui-Sensemaking-Guest-Session": "guest-token"},
        )
    assert response.status_code == 403
    assert calls == []


@pytest.mark.parametrize("identity,tenant", [
    (replace(IDENTITY, user_id=None), TENANT),
    (replace(IDENTITY, auth_context=AuthContext(actor_ref=None, provider="oidc")), TENANT),
    (replace(IDENTITY, auth_context=AuthContext(actor_ref="member-a", provider="header")), TENANT),
    # Both SaaS JWT and authenticated BFF cookie bind these to one user.
    (replace(IDENTITY, auth_context=AuthContext(
        actor_ref="other-member", user_id="member-a", provider="oidc",
    )), TENANT),
    (replace(IDENTITY, auth_context=AuthContext(
        actor_ref="member-a", user_id="other-member", provider="oidc",
    )), TENANT),
    (replace(IDENTITY, auth_context=AuthContext(
        actor_ref="member-a", user_id=None, provider="oidc",
    )), TENANT),
    (IDENTITY, replace(TENANT, membership_id=None)),
    (IDENTITY, replace(TENANT, resolved_by="single_tenant_adapter")),
])
def test_unqualified_member_or_tenant_does_not_become_source_context(
    monkeypatch: pytest.MonkeyPatch,
    identity: ResolvedIdentity,
    tenant: TenantContext,
) -> None:
    client, calls = _test_client(monkeypatch, identity=identity, tenant=tenant)
    with client:
        response = client.get(
            "/source-preflight",
            headers={HEADER: "version-2"},
        )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "source_member_context_unavailable"
    assert calls == ["trusted-session"]


def test_unavailable_trusted_resolver_never_falls_back_to_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, calls = _test_client(monkeypatch, fail=True)
    with client:
        response = client.get(
            "/source-preflight",
            headers={HEADER: "version-2", "X-Forwarded-User": "member-a"},
        )
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tenant_admin_auth_unavailable"
    assert calls == ["trusted-session"]
