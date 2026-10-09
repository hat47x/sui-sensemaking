"""AI-MODEL-GOVERNANCE-01 R1/R3: model/provider registry + tenant allowlist.

Covers dynamic provider/model registration, listing, disable, the tenant
allowlist set/get, env-provider seeding, and control-plane auth on the admin
surface.
"""

from __future__ import annotations

import io
import json
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import (
    Base,
    LLMModelRegistryRow,
    LLMProviderRegistryRow,
    TenantRow,
)
from sui_sensemaking_api.settings import settings

_ADMIN_KEY = "control-plane-model-key"
_BUSINESS_KEY = "business-plane-key"
_NOW = "2026-08-15T00:00:00+00:00"


@contextmanager
def _client(tmp_path) -> Iterator[tuple[TestClient, sessionmaker]]:
    engine = create_engine(f"sqlite:///{tmp_path / 'model_governance.sqlite3'}")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)
    with session_local() as db:
        db.add(TenantRow(id="local-default", display_name="Local Default", lifecycle_state="active", created_at=_NOW, updated_at=_NOW))
        db.add(TenantRow(id="tenant-a", display_name="Tenant A", lifecycle_state="active", created_at=_NOW, updated_at=_NOW))
        db.commit()

    def _get_test_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_test_db
    try:
        with TestClient(app) as client:
            # Point the admin-audit recording middleware at the test DB.
            client.app.state.admin_audit_session_factory = session_local
            yield client, session_local
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_register_list_disable_model_flow(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)

    with _client(tmp_path) as (client, session_local):
        # Register a provider.
        resp = client.post(
            "/admin/provision/models/providers",
            json={"id": "deepseek", "providerKind": "deepseek", "displayName": "DeepSeek", "baseUrl": "https://api.deepseek.com", "apiKeyRef": "SUI_DEEPSEEK_API_KEY"},
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert resp.status_code == 201, resp.text

        # Register two models under it.
        for model_id, caps in (("deepseek-v4-flash", "intermediate,generate"), ("deepseek-v4-pro", "final_judgement")):
            resp = client.post(
                "/admin/provision/models",
                json={"id": model_id, "providerId": "deepseek", "displayName": model_id, "capabilities": caps},
                headers={"X-Admin-Api-Key": _ADMIN_KEY},
            )
            assert resp.status_code == 201, resp.text

        # List.
        registry = client.get("/admin/provision/models", headers={"X-Admin-Api-Key": _ADMIN_KEY}).json()
        assert [p["id"] for p in registry["providers"]] == ["deepseek"]
        assert {m["id"] for m in registry["models"]} == {"deepseek-v4-flash", "deepseek-v4-pro"}

        # Disable a model -> fail-closed lifecycle.
        resp = client.patch(
            "/admin/provision/models/deepseek-v4-pro",
            json={"lifecycleState": "disabled"},
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert resp.status_code == 200, resp.text
        with session_local() as db:
            assert db.get(LLMModelRegistryRow, "deepseek-v4-pro").lifecycle_state == "disabled"


def test_provider_api_key_ref_never_exposed_to_api_or_audit(tmp_path, monkeypatch) -> None:
    """AI-MODEL-GOVERNANCE-03 AC-4: apiKeyRef is a reference (env/secret-manager
    key), never a plaintext key, and it must not surface in the registry API
    response or the control-plane audit trail."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)

    from sui_sensemaking_api.models import AdminAuditEventRow

    with _client(tmp_path) as (client, session_local):
        api_key_ref = "SUI_DEEPSEEK_API_KEY"
        resp = client.post(
            "/admin/provision/models/providers",
            json={"id": "deepseek", "providerKind": "deepseek", "displayName": "DeepSeek",
                  "baseUrl": "https://api.deepseek.com", "apiKeyRef": api_key_ref},
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert resp.status_code == 201, resp.text

        # 1. The registry list response never echoes apiKeyRef (key or value).
        registry_text = client.get("/admin/provision/models", headers={"X-Admin-Api-Key": _ADMIN_KEY}).text
        assert "apiKeyRef" not in registry_text
        assert api_key_ref not in registry_text

        # 2. The control-plane audit records metadata only -- never the
        #    registration payload (which would carry the secret reference).
        with session_local() as db:
            events = db.query(AdminAuditEventRow).all()
        assert events, "expected at least one admin audit event"
        for ev in events:
            for field in (ev.route or "", ev.operation or "", ev.target or ""):
                assert api_key_ref not in field


def test_provider_api_key_ref_rejects_plaintext_at_registration(tmp_path, monkeypatch) -> None:
    """AI-MODEL-GOVERNANCE-03 AC-4 (DB side): apiKeyRef must be a reference --
    a plaintext secret or an arbitrary env-var name is rejected at the API
    boundary so it is never stored in the registry column."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)

    with _client(tmp_path) as (client, _session_local):
        base = {"id": "p", "providerKind": "external", "displayName": "P", "baseUrl": "https://example.test"}
        # Plaintext secret (looks like an API key) -> 422, nothing stored.
        resp = client.post(
            "/admin/provision/models/providers",
            json={**base, "apiKeyRef": "sk-this-is-a-plaintext-secret-12345"},
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert resp.status_code == 422, resp.text
        # Arbitrary env-var name (not SUI_*) -> 422.
        resp = client.post(
            "/admin/provision/models/providers",
            json={**base, "apiKeyRef": "MY_RANDOM_API_KEY"},
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert resp.status_code == 422, resp.text
        # A different SUI_ secret is still forbidden: prefix matching must
        # never let a model provider retrieve the control-plane credential.
        resp = client.post(
            "/admin/provision/models/providers",
            json={**base, "apiKeyRef": "SUI_ADMIN_API_KEY"},
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert resp.status_code == 422, resp.text
        # Valid allowlisted SUI_* ref -> 201.
        resp = client.post(
            "/admin/provision/models/providers",
            json={**base, "id": "p2", "apiKeyRef": "SUI_DEEPSEEK_API_KEY"},
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert resp.status_code == 201, resp.text
        # Valid secret-manager ref -> 201.
        resp = client.post(
            "/admin/provision/models/providers",
            json={**base, "id": "p3", "apiKeyRef": "secret:prod/deepseek-key"},
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert resp.status_code == 201, resp.text


def test_tenant_allowlist_set_get(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)

    with _client(tmp_path) as (client, _session_local):
        headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post("/admin/provision/models/providers", json={"id": "p", "providerKind": "external", "displayName": "P"}, headers=headers)
        for model_id in ("m1", "m2", "m3"):
            client.post("/admin/provision/models", json={"id": model_id, "providerId": "p", "displayName": model_id}, headers=headers)

        initial = client.get("/admin/provision/models/tenants/tenant-a/allowlist", headers=headers).json()
        resp = client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["m1", "m3"], "expectedRevision": initial["revision"]},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text

        got = client.get("/admin/provision/models/tenants/tenant-a/allowlist", headers=headers).json()
        assert got["modelIds"] == ["m1", "m3"]
        assert len(got["revision"]) == 64


def test_registry_create_rejects_duplicate_ids_without_overwriting(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)

    with _client(tmp_path) as (client, session_local):
        headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        first_provider = client.post(
            "/admin/provision/models/providers",
            json={"id": "p", "providerKind": "local", "displayName": "Original"},
            headers=headers,
        )
        assert first_provider.status_code == 201
        duplicate_provider = client.post(
            "/admin/provision/models/providers",
            json={"id": "p", "providerKind": "deepseek", "displayName": "Replacement"},
            headers=headers,
        )
        assert duplicate_provider.status_code == 409
        assert duplicate_provider.json()["detail"]["code"] == "provider_already_exists"

        client.post(
            "/admin/provision/models/providers",
            json={"id": "p2", "providerKind": "local", "displayName": "P2"},
            headers=headers,
        )
        first_model = client.post(
            "/admin/provision/models",
            json={"id": "m", "providerId": "p", "displayName": "Original Model"},
            headers=headers,
        )
        assert first_model.status_code == 201
        duplicate_model = client.post(
            "/admin/provision/models",
            json={"id": "m", "providerId": "p2", "displayName": "Replacement Model"},
            headers=headers,
        )
        assert duplicate_model.status_code == 409
        assert duplicate_model.json()["detail"]["code"] == "model_already_exists"

        with session_local() as db:
            assert db.get(LLMProviderRegistryRow, "p").provider_kind == "local"
            assert db.get(LLMProviderRegistryRow, "p").display_name == "Original"
            assert db.get(LLMModelRegistryRow, "m").provider_id == "p"
            assert db.get(LLMModelRegistryRow, "m").display_name == "Original Model"


def test_tenant_allowlist_rejects_stale_revision_without_lost_update(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)

    with _client(tmp_path) as (client, _session_local):
        headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post(
            "/admin/provision/models/providers",
            json={"id": "p", "providerKind": "local", "displayName": "P"},
            headers=headers,
        )
        for model_id in ("m1", "m2"):
            client.post(
                "/admin/provision/models",
                json={"id": model_id, "providerId": "p", "displayName": model_id},
                headers=headers,
            )

        initial = client.get(
            "/admin/provision/models/tenants/tenant-a/allowlist", headers=headers
        ).json()
        first_write = client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["m1"], "expectedRevision": initial["revision"]},
            headers=headers,
        )
        assert first_write.status_code == 200

        stale_write = client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["m2"], "expectedRevision": initial["revision"]},
            headers=headers,
        )
        assert stale_write.status_code == 409
        assert stale_write.json()["detail"]["code"] == "model_allowlist_conflict"
        assert stale_write.json()["detail"]["currentRevision"] == first_write.json()["revision"]

        current = client.get(
            "/admin/provision/models/tenants/tenant-a/allowlist", headers=headers
        ).json()
        assert current["modelIds"] == ["m1"]


def test_tenant_allowlist_put_without_expected_revision_is_rejected_428(tmp_path, monkeypatch) -> None:
    """OPS-ADMIN-CONCURRENCY-01 AC-4: the compatibility window for an
    unconditional PUT is over (Maintainer decision, 2026-08-26). A direct API
    caller that omits expectedRevision must be rejected with 428 Precondition
    Required and must NOT mutate the allowlist -- mirroring
    inquiry_bundles.py's If-Match requirement for its update/delete routes.
    A PUT with a correct expectedRevision must still succeed (unaffected by
    this change), and a PUT with a stale expectedRevision must still 409
    (unchanged conflict behavior, proven separately above)."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)

    with _client(tmp_path) as (client, _session_local):
        headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post(
            "/admin/provision/models/providers",
            json={"id": "p", "providerKind": "local", "displayName": "P"},
            headers=headers,
        )
        for model_id in ("m1", "m2"):
            client.post(
                "/admin/provision/models",
                json={"id": model_id, "providerId": "p", "displayName": model_id},
                headers=headers,
            )

        # Missing expectedRevision -> 428, and the allowlist is NOT mutated.
        missing_revision = client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["m1"]},
            headers=headers,
        )
        assert missing_revision.status_code == 428, missing_revision.text
        assert missing_revision.json()["detail"] == {
            "code": "model_allowlist_expected_revision_required",
            "message": "expectedRevision is required to update the tenant model allowlist.",
        }
        untouched = client.get(
            "/admin/provision/models/tenants/tenant-a/allowlist", headers=headers
        ).json()
        assert untouched["modelIds"] == []

        # Correct expectedRevision -> still succeeds (428 guard does not
        # interfere with the already-proven happy path).
        correct_write = client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["m1"], "expectedRevision": untouched["revision"]},
            headers=headers,
        )
        assert correct_write.status_code == 200, correct_write.text

        # Stale expectedRevision -> still 409 model_allowlist_conflict, not 428
        # and not a silent overwrite (unchanged behavior).
        stale_write = client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["m2"], "expectedRevision": untouched["revision"]},
            headers=headers,
        )
        assert stale_write.status_code == 409, stale_write.text
        assert stale_write.json()["detail"]["code"] == "model_allowlist_conflict"

        final = client.get(
            "/admin/provision/models/tenants/tenant-a/allowlist", headers=headers
        ).json()
        assert final["modelIds"] == ["m1"]


def test_tenant_allowlist_rejects_invalid_targets_without_partial_write(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)

    with _client(tmp_path) as (client, _session_local):
        headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post(
            "/admin/provision/models/providers",
            json={"id": "p", "providerKind": "external", "displayName": "P"},
            headers=headers,
        )
        for model_id in ("m1", "m2"):
            client.post(
                "/admin/provision/models",
                json={"id": model_id, "providerId": "p", "displayName": model_id},
                headers=headers,
            )
        client.patch(
            "/admin/provision/models/m2",
            json={"lifecycleState": "disabled"},
            headers=headers,
        )

        missing_tenant = client.put(
            "/admin/provision/models/tenants/missing/allowlist",
            json={"modelIds": ["m1"]},
            headers=headers,
        )
        assert missing_tenant.status_code == 404
        assert missing_tenant.json()["detail"]["code"] == "tenant_not_found"

        expected_revision = client.get(
            "/admin/provision/models/tenants/tenant-a/allowlist", headers=headers
        ).json()["revision"]

        invalid_models = client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["missing-model", "m2"], "expectedRevision": expected_revision},
            headers=headers,
        )
        assert invalid_models.status_code == 422
        assert invalid_models.json()["detail"] == {
            "code": "invalid_model_allowlist",
            "message": "Every allowlisted model must be registered and active.",
            "unknownModelIds": ["missing-model"],
            "inactiveModelIds": ["m2"],
        }

        duplicate_models = client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["m1", "m1"], "expectedRevision": expected_revision},
            headers=headers,
        )
        assert duplicate_models.status_code == 422
        assert duplicate_models.json()["detail"]["code"] == "duplicate_model_ids"

        current = client.get(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            headers=headers,
        )
        assert current.status_code == 200
        assert current.json()["modelIds"] == []


def test_admin_surface_requires_control_plane(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)

    with _client(tmp_path) as (client, _session_local):
        resp = client.get("/admin/provision/models", headers={"X-API-Key": _BUSINESS_KEY})
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "control_plane_unauthorized"


def test_env_seeding_registers_provider_and_model(tmp_path, monkeypatch) -> None:
    """U4: the env-configured provider/model is seeded into the registry."""
    monkeypatch.setattr(settings, "llm_provider", "deepseek")
    monkeypatch.setattr(settings, "deepseek_model", "deepseek-v4-flash")
    from sui_sensemaking_api.model_registry_seed import seed_registry_from_env

    engine = create_engine(f"sqlite:///{tmp_path / 'seed.sqlite3'}")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    seed_registry_from_env(session_factory=session_local)

    with session_local() as db:
        assert db.get(LLMProviderRegistryRow, "deepseek") is not None
        assert db.get(LLMModelRegistryRow, "deepseek-v4-flash") is not None


def test_allowlist_repository_semantics(tmp_path, monkeypatch) -> None:
    """R3: the allowlist repository stores/clears tenant model ids."""
    monkeypatch.setattr(settings, "llm_provider", "none")
    from sui_sensemaking_api.model_registry_repository import (
        list_tenant_allowed_model_ids,
        register_model,
        register_provider,
        set_tenant_model_allowlist,
    )

    engine = create_engine(f"sqlite:///{tmp_path / 'repo.sqlite3'}")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)
    with session_local() as db:
        db.add(TenantRow(id="t1", display_name="T1", lifecycle_state="active", created_at=_NOW, updated_at=_NOW))
        db.commit()

    with session_local() as db:
        register_provider(db, provider_id="p", provider_kind="external", display_name="P", occurred_at=_NOW)
        register_model(db, model_id="m1", provider_id="p", display_name="M1", occurred_at=_NOW)
        set_tenant_model_allowlist(db, tenant_id="t1", model_ids=["m1"], occurred_at=_NOW)
        db.commit()
        assert list_tenant_allowed_model_ids(db, tenant_id="t1") == {"m1"}
        set_tenant_model_allowlist(db, tenant_id="t1", model_ids=[], occurred_at=_NOW)
        db.commit()
        assert list_tenant_allowed_model_ids(db, tenant_id="t1") == set()


def test_allowlist_enforced_on_ai_route(tmp_path, monkeypatch) -> None:
    """R3: a disallowed model override is rejected 403 before any LLM call."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    monkeypatch.setattr(settings, "llm_provider", "local")

    doc = {
        "version": 1,
        "id": "allow-doc",
        "title": "allowlist test",
        "createdAt": "2026-08-15T00:00:00Z",
        "updatedAt": "2026-08-15T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [{"id": "c1", "text": "alpha", "x": 0, "y": 0, "textReviewed": True}],
        "edges": [],
        "islands": [{"id": "i1", "cardIds": ["c1"]}],
        "readingOrder": ["i1"],
    }

    with _client(tmp_path) as (client, _session_local):
        admin_headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post(
            "/admin/provision/models/providers",
            json={
                "id": "p",
                "providerKind": "local",
                "displayName": "P",
                "baseUrl": "http://127.0.0.1:11434",
            },
            headers=admin_headers,
        )
        for model_id in ("m1", "m2"):
            client.post("/admin/provision/models", json={"id": model_id, "providerId": "p", "displayName": model_id}, headers=admin_headers)
        initial_revision = client.get(
            "/admin/provision/models/tenants/local-default/allowlist", headers=admin_headers
        ).json()["revision"]
        client.put(
            "/admin/provision/models/tenants/local-default/allowlist",
            json={"modelIds": ["m1"], "expectedRevision": initial_revision},
            headers=admin_headers,
        )

        # Disallowed override -> 403 model_not_allowed (fail-closed, no LLM call).
        denied = client.post("/ai/suggest-island-summary", json={"doc": doc, "islandId": "i1", "model": "m2"}, headers={"X-API-Key": _BUSINESS_KEY})
        assert denied.status_code == 403, denied.text
        assert denied.json()["detail"]["code"] == "model_not_allowed"
        assert denied.json()["detail"]["allowedModels"] == ["m1"]

        # Allowed override passes the allowlist gate (then fails only because no
        # local LLM base URL is configured -> 503 provider_unavailable, NOT 403).
        allowed = client.post("/ai/suggest-island-summary", json={"doc": doc, "islandId": "i1", "model": "m1"}, headers={"X-API-Key": _BUSINESS_KEY})
        assert allowed.status_code == 503, allowed.text
        assert allowed.json()["detail"]["code"] != "model_not_allowed"


def test_unregistered_model_rejected_under_platform_default(tmp_path, monkeypatch) -> None:
    """AI-MODEL-GOVERNANCE-02: even with an empty tenant allowlist
    (platform-default = "all active registered models allowed"), an unregistered
    or inactive model id must fail closed (403 model_not_registered) before any
    LLM call. The registry, not the allowlist, is the source of truth for what
    is callable."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    monkeypatch.setattr(settings, "llm_provider", "local")

    doc = {
        "version": 1,
        "id": "platform-default-doc",
        "title": "platform default",
        "createdAt": "2026-08-15T00:00:00Z",
        "updatedAt": "2026-08-15T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [{"id": "c1", "text": "alpha", "x": 0, "y": 0, "textReviewed": True}],
        "edges": [],
        "islands": [{"id": "i1", "cardIds": ["c1"]}],
        "readingOrder": ["i1"],
    }

    with _client(tmp_path) as (client, _session_local):
        client.post("/admin/provision/models/providers", json={"id": "p", "providerKind": "local", "displayName": "P"}, headers={"X-Admin-Api-Key": _ADMIN_KEY})
        client.post("/admin/provision/models", json={"id": "m1", "providerId": "p", "displayName": "M1"}, headers={"X-Admin-Api-Key": _ADMIN_KEY})

        # No allowlist set -> platform-default. Unregistered id -> 403 model_not_registered.
        denied = client.post(
            "/ai/suggest-island-summary",
            json={"doc": doc, "islandId": "i1", "model": "totally-bogus-model"},
            headers={"X-API-Key": _BUSINESS_KEY},
        )
        assert denied.status_code == 403, denied.text
        assert denied.json()["detail"]["code"] == "model_not_registered"

        # Registered active model passes the gate (then fails only because no
        # local LLM base URL is configured -> 503 provider_unavailable, NOT 403).
        allowed = client.post(
            "/ai/suggest-island-summary",
            json={"doc": doc, "islandId": "i1", "model": "m1"},
            headers={"X-API-Key": _BUSINESS_KEY},
        )
        assert allowed.status_code == 503, allowed.text
        assert allowed.json()["detail"]["code"] != "model_not_registered"


def test_model_crud_and_allowlist_changes_are_audited(tmp_path, monkeypatch) -> None:
    """R4: model/provider CRUD and allowlist changes land in the admin audit trail."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)

    with _client(tmp_path) as (client, _session_local):
        admin_headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post("/admin/provision/models/providers", json={"id": "p", "providerKind": "external", "displayName": "P"}, headers=admin_headers)
        client.post("/admin/provision/models", json={"id": "m1", "providerId": "p", "displayName": "M1"}, headers=admin_headers)
        initial_revision = client.get(
            "/admin/provision/models/tenants/tenant-a/allowlist", headers=admin_headers
        ).json()["revision"]
        client.put(
            "/admin/provision/models/tenants/tenant-a/allowlist",
            json={"modelIds": ["m1"], "expectedRevision": initial_revision},
            headers=admin_headers,
        )

        audit = client.get("/admin/provision/audit", headers=admin_headers).json()
        routes = {event["route"] for event in audit["events"]}
        assert "/admin/provision/models/providers" in routes
        assert "/admin/provision/models" in routes
        assert "/admin/provision/models/tenants/tenant-a/allowlist" in routes


def test_available_models_reflects_tenant_allowlist(tmp_path, monkeypatch) -> None:
    """R2: GET /ai/available-models returns the tenant's allowed active models."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    monkeypatch.setattr(settings, "llm_provider", "local")

    with _client(tmp_path) as (client, _session_local):
        admin_headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post(
            "/admin/provision/models/providers",
            json={
                "id": "p",
                "providerKind": "local",
                "displayName": "P",
                "baseUrl": "http://127.0.0.1:11434",
            },
            headers=admin_headers,
        )
        for model_id, state in (("m1", "active"), ("m2", "active"), ("m3", "disabled")):
            client.post("/admin/provision/models", json={"id": model_id, "providerId": "p", "displayName": model_id}, headers=admin_headers)
        client.patch("/admin/provision/models/m3", json={"lifecycleState": "disabled"}, headers=admin_headers)

        # No allowlist -> platform-default: m1 + m2 (m3 disabled excluded).
        default_models = client.get("/ai/available-models", headers={"X-API-Key": _BUSINESS_KEY}).json()["models"]
        assert {m["id"] for m in default_models} == {"m1", "m2"}

        # Allowlist [m2] -> only m2 offered.
        initial_revision = client.get(
            "/admin/provision/models/tenants/local-default/allowlist", headers=admin_headers
        ).json()["revision"]
        client.put(
            "/admin/provision/models/tenants/local-default/allowlist",
            json={"modelIds": ["m2"], "expectedRevision": initial_revision},
            headers=admin_headers,
        )
        filtered = client.get("/ai/available-models", headers={"X-API-Key": _BUSINESS_KEY}).json()["models"]
        assert [m["id"] for m in filtered] == ["m2"]


def test_available_models_explains_empty_registry_without_leaking_details(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    monkeypatch.setattr(settings, "llm_provider", "local")

    with _client(tmp_path) as (client, _session_local):
        response = client.get("/ai/available-models", headers={"X-API-Key": _BUSINESS_KEY})
        assert response.status_code == 200
        assert response.json() == {
            "models": [],
            "unavailableReason": "no_active_models",
        }


def test_available_models_explains_tenant_policy_and_selectable_capability(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    monkeypatch.setattr(settings, "llm_provider", "local")

    with _client(tmp_path) as (client, _session_local):
        admin_headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post(
            "/admin/provision/models/providers",
            json={
                "id": "p",
                "providerKind": "local",
                "displayName": "P",
                "baseUrl": "http://127.0.0.1:11434",
            },
            headers=admin_headers,
        )
        for model_id, capabilities in (
            ("allowed-disabled", "intermediate,generate"),
            ("judgement-only", "final_judgement"),
        ):
            client.post(
                "/admin/provision/models",
                json={
                    "id": model_id,
                    "providerId": "p",
                    "displayName": model_id,
                    "capabilities": capabilities,
                },
                headers=admin_headers,
            )
        first_revision = client.get(
            "/admin/provision/models/tenants/local-default/allowlist", headers=admin_headers
        ).json()["revision"]
        client.put(
            "/admin/provision/models/tenants/local-default/allowlist",
            json={"modelIds": ["allowed-disabled"], "expectedRevision": first_revision},
            headers=admin_headers,
        )
        client.patch(
            "/admin/provision/models/allowed-disabled",
            json={"lifecycleState": "disabled"},
            headers=admin_headers,
        )

        policy_empty = client.get(
            "/ai/available-models", headers={"X-API-Key": _BUSINESS_KEY}
        ).json()
        assert policy_empty == {
            "models": [],
            "unavailableReason": "tenant_policy_excludes_all",
        }

        second_revision = client.get(
            "/admin/provision/models/tenants/local-default/allowlist", headers=admin_headers
        ).json()["revision"]
        client.put(
            "/admin/provision/models/tenants/local-default/allowlist",
            json={"modelIds": ["judgement-only"], "expectedRevision": second_revision},
            headers=admin_headers,
        )
        not_selectable = client.get(
            "/ai/available-models", headers={"X-API-Key": _BUSINESS_KEY}
        ).json()
        assert not_selectable == {
            "models": [],
            "unavailableReason": "no_user_selectable_models",
        }


def test_available_models_excludes_final_judgement_only(tmp_path, monkeypatch) -> None:
    """MMR-04: final_judgement-only models are not offered for user selection."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    monkeypatch.setattr(settings, "llm_provider", "local")

    with _client(tmp_path) as (client, _session_local):
        client.post(
            "/admin/provision/models/providers",
            json={
                "id": "p",
                "providerKind": "local",
                "displayName": "P",
                "baseUrl": "http://127.0.0.1:11434",
            },
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        for model_id, caps in (
            ("intermediate-model", "intermediate,generate"),
            ("judgement-only", "final_judgement"),
            ("mixed-model", "intermediate,final_judgement"),
        ):
            client.post("/admin/provision/models", json={"id": model_id, "providerId": "p", "displayName": model_id, "capabilities": caps}, headers={"X-Admin-Api-Key": _ADMIN_KEY})

        available = client.get("/ai/available-models", headers={"X-API-Key": _BUSINESS_KEY}).json()["models"]
        ids = {m["id"] for m in available}
        assert "intermediate-model" in ids
        assert "mixed-model" in ids  # intermediate tier present -> selectable
        assert "judgement-only" not in ids  # final_judgement-only -> excluded (MMR-04)


def test_model_provider_must_match_runtime_transport(tmp_path, monkeypatch) -> None:
    """AI-MODEL-GOVERNANCE-03 short-term fail-closed boundary.

    Registry metadata must not cause a local-runtime process to send a model
    registered under the DeepSeek transport to the local endpoint (or vice
    versa). The UI list and API execution gate use the same intersection.
    """
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    monkeypatch.setattr(settings, "llm_provider", "local")

    doc = {
        "version": 1,
        "id": "provider-drift-doc",
        "title": "provider drift",
        "createdAt": "2026-08-16T00:00:00Z",
        "updatedAt": "2026-08-16T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [{"id": "c1", "text": "alpha", "x": 0, "y": 0, "textReviewed": True}],
        "edges": [],
        "islands": [{"id": "i1", "cardIds": ["c1"]}],
        "readingOrder": ["i1"],
    }

    with _client(tmp_path) as (client, _session_local):
        admin_headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        client.post(
            "/admin/provision/models/providers",
            json={"id": "deepseek", "providerKind": "deepseek", "displayName": "DeepSeek"},
            headers=admin_headers,
        )
        client.post(
            "/admin/provision/models",
            json={
                "id": "deepseek-v4-flash",
                "providerId": "deepseek",
                "displayName": "DeepSeek V4 Flash",
                "capabilities": "intermediate,generate",
            },
            headers=admin_headers,
        )

        listed = client.get("/ai/available-models", headers={"X-API-Key": _BUSINESS_KEY})
        assert listed.status_code == 200
        assert listed.json()["models"] == []
        assert listed.json()["unavailableReason"] == "provider_unavailable"

        attempted = client.post(
            "/ai/suggest-island-summary",
            json={"doc": doc, "islandId": "i1", "model": "deepseek-v4-flash"},
            headers={"X-API-Key": _BUSINESS_KEY},
        )
        assert attempted.status_code == 503
        assert attempted.json()["detail"] == {
            "code": "model_provider_unavailable",
            "message": "The model's registered provider is not available in this runtime.",
        }


def test_registered_local_and_deepseek_models_dispatch_to_their_own_transports(
    tmp_path, monkeypatch
) -> None:
    """AI-MODEL-GOVERNANCE-03 AC-5: providerId selects transport per model."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    # The process must not be `none` here: `none` is the stop switch and rejects
    # every registry dispatch (see the stop-switch test below). `local` keeps the
    # cross-kind case this test covers: the deepseek model runs although the
    # process-wide SUI_LLM_PROVIDER is local.
    monkeypatch.setattr(settings, "llm_provider", "local")
    monkeypatch.setattr(settings, "llm_fallback_to_none", False)
    monkeypatch.setenv("SUI_DEEPSEEK_API_KEY", "integration-secret")

    destinations: list[tuple[str, str, str | None]] = []

    class _Response:
        def __init__(self, body: dict[str, object]) -> None:
            self._body = io.BytesIO(json.dumps(body).encode("utf-8"))

        def read(self, size: int = -1) -> bytes:
            return self._body.read(size)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def _fake_http(req, timeout_seconds):  # noqa: ANN001
        payload = json.loads(req.data.decode("utf-8"))
        destinations.append(
            (req.full_url, payload["model"], req.headers.get("Authorization"))
        )
        if req.full_url == "http://127.0.0.1:11434/generate":
            return _Response(
                {"text": '{"refinedText":"local result","reasoning":"ok"}'}
            )
        if req.full_url == "https://api.deepseek.example/v1/chat/completions":
            return _Response(
                {
                    "choices": [
                        {
                            "message": {
                                "content": '{"refinedText":"deepseek result","reasoning":"ok"}'
                            }
                        }
                    ]
                }
            )
        raise AssertionError(f"unexpected destination: {req.full_url}")

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_http)

    with _client(tmp_path) as (client, _session_local):
        admin_headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        for provider in (
            {
                "id": "local-a",
                "providerKind": "local",
                "displayName": "Local A",
                "baseUrl": "http://127.0.0.1:11434",
            },
            {
                "id": "deepseek-a",
                "providerKind": "deepseek",
                "displayName": "DeepSeek A",
                "baseUrl": "https://api.deepseek.example",
                "apiKeyRef": "SUI_DEEPSEEK_API_KEY",
            },
        ):
            response = client.post(
                "/admin/provision/models/providers",
                json=provider,
                headers=admin_headers,
            )
            assert response.status_code == 201, response.text
        for model_id, provider_id in (
            ("local-model", "local-a"),
            ("deepseek-model", "deepseek-a"),
        ):
            response = client.post(
                "/admin/provision/models",
                json={
                    "id": model_id,
                    "providerId": provider_id,
                    "displayName": model_id,
                    "capabilities": "intermediate,generate",
                },
                headers=admin_headers,
            )
            assert response.status_code == 201, response.text

        available = client.get(
            "/ai/available-models",
            headers={"X-API-Key": _BUSINESS_KEY},
        )
        assert available.status_code == 200
        assert {item["id"] for item in available.json()["models"]} == {
            "local-model",
            "deepseek-model",
        }

        for model_id, expected_text in (
            ("local-model", "local result"),
            ("deepseek-model", "deepseek result"),
        ):
            response = client.post(
                "/ai/refine-card-text",
                json={
                    "cardText": "alpha",
                    "textReviewed": True,
                    "model": model_id,
                },
                headers={"X-API-Key": _BUSINESS_KEY},
            )
            assert response.status_code == 200, response.text
            assert response.json()["refinedText"] == expected_text

    assert destinations == [
        ("http://127.0.0.1:11434/generate", "local-model", None),
        (
            "https://api.deepseek.example/v1/chat/completions",
            "deepseek-model",
            "Bearer integration-secret",
        ),
    ]


def test_stop_switch_none_rejects_registered_model_without_outbound_request(
    tmp_path, monkeypatch
) -> None:
    """SUI_LLM_PROVIDER=none is an unconditional stop switch (api.md
    AI-MODEL-GOVERNANCE-03): a registered local model whose own configuration is
    complete is refused with 503 by the generation route, and no outbound request
    is opened."""
    from sui_sensemaking_api.llm import provider as llm_provider

    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)
    monkeypatch.setattr(settings, "llm_provider", "none")
    monkeypatch.setattr(settings, "llm_fallback_to_none", False)

    def _outbound_must_not_open(req, timeout_seconds):  # noqa: ANN001
        raise AssertionError(f"outbound request must not be sent: {req.full_url}")

    monkeypatch.setattr(llm_provider, "open_trusted_http", _outbound_must_not_open)

    with _client(tmp_path) as (client, _session_local):
        admin_headers = {"X-Admin-Api-Key": _ADMIN_KEY}
        response = client.post(
            "/admin/provision/models/providers",
            json={
                "id": "local-a",
                "providerKind": "local",
                "displayName": "Local A",
                "baseUrl": "http://127.0.0.1:11434",
            },
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text
        response = client.post(
            "/admin/provision/models",
            json={
                "id": "local-model",
                "providerId": "local-a",
                "displayName": "local-model",
                "capabilities": "intermediate,generate",
            },
            headers=admin_headers,
        )
        assert response.status_code == 201, response.text

        response = client.post(
            "/ai/refine-card-text",
            json={
                "cardText": "alpha",
                "textReviewed": True,
                "model": "local-model",
            },
            headers={"X-API-Key": _BUSINESS_KEY},
        )

    assert response.status_code == 503, response.text
    detail = response.json()["detail"]
    assert detail["provider_kind"] == "none"
    assert detail["disabled_reason"] == "provider_disabled_or_none_default"


def test_provider_registration_rejects_unsafe_destination_and_unknown_kind(
    tmp_path, monkeypatch
) -> None:
    """SEC-AI-PROVIDER-DEST-01: registry values cannot create a new SSRF sink."""
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)
    monkeypatch.setattr(settings, "api_key", _BUSINESS_KEY)

    with _client(tmp_path) as (client, session_local):
        unsafe = "http://169.254.169.254/latest"
        response = client.post(
            "/admin/provision/models/providers",
            json={
                "id": "unsafe",
                "providerKind": "local",
                "displayName": "Unsafe",
                "baseUrl": unsafe,
            },
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert response.status_code == 422
        assert unsafe not in response.text

        response = client.post(
            "/admin/provision/models/providers",
            json={
                "id": "unknown",
                "providerKind": "shell",
                "displayName": "Unknown",
            },
            headers={"X-Admin-Api-Key": _ADMIN_KEY},
        )
        assert response.status_code == 422

        with session_local() as db:  # type: ignore[attr-defined]
            assert db.get(LLMProviderRegistryRow, "unsafe") is None
            assert db.get(LLMProviderRegistryRow, "unknown") is None
