"""Tenant-plane TEI epistemic projection endpoint (案B, ADR-0102 採択済み).

The endpoint reuses the document read authorization path and the fail-closed
local-I/O transport. It never returns artifact content on a failure and never
writes to confirmation / use state / `human_reviewed`.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.access_control import AccessDecision
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import Base, DocumentRow, TenantRow
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tenant_context import TenantContext

_BASE = "/docs/{doc_id}/epistemic/projection"


def _sample_payload(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "epistemic-tenant-test",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1.0},
        "cards": [],
        "edges": [],
        "islands": [],
    }


@contextmanager
def _client(tmp_path: Path) -> Iterator[TestClient]:
    db_path = tmp_path / "tei_tenant.sqlite3"
    engine = create_engine(f"sqlite:///{db_path}")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    def _get_test_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_test_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _artifacts_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "tei-reference"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _write_artifact(directory: Path, name: str, payload: object) -> None:
    (directory / name).write_text(json.dumps(payload), encoding="utf-8")


def _write_bound_artifact(directory: Path, tenant_id: str, doc_id: str, name: str, payload: object) -> None:
    bound = directory / "tenants" / tenant_id / doc_id
    bound.mkdir(parents=True, exist_ok=True)
    _write_artifact(bound, name, payload)


def _write_bindings(directory: Path, bindings: list[dict]) -> None:
    (directory / "epistemic-bindings.json").write_text(
        json.dumps({"bindings": bindings}), encoding="utf-8"
    )


_ASSESSMENT = {
    "contract": "tei.epistemic-projection/v0",
    "schema": "tei.reference.epistemic-assessment/v0",
    "assessments": [],
}


@dataclass
class _MutableTenantResolver:
    tenant_id: str

    def resolve(self, *, db: Session, user_id: str | None, claim: object = None) -> TenantContext:  # noqa: ARG002
        return TenantContext(
            tenant_id=self.tenant_id,
            membership_id=f"membership-{self.tenant_id}",
            resolved_by="verified_claim",
        )


class _AllowAllAdapter:
    name = "allow-all"

    def authorize(self, request):  # noqa: ANN001, ARG002
        return AccessDecision(allow=True)


@contextmanager
def _tenant_client(tmp_path: Path) -> Iterator[tuple[TestClient, _MutableTenantResolver]]:
    engine = create_engine(f"sqlite:///{tmp_path}/tei-tenant-isolation.sqlite3")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    with session_local() as db:
        for tenant_id in ("tenant-a", "tenant-b"):
            db.add(
                TenantRow(
                    id=tenant_id,
                    display_name=tenant_id,
                    lifecycle_state="active",
                    created_at="2026-02-11T00:00:00Z",
                    updated_at="2026-02-11T00:00:00Z",
                )
            )
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id="doc-1",
                    version=1,
                    updated_at="2026-02-11T00:00:00Z",
                    payload_json=json.dumps(_sample_payload("doc-1")),
                )
            )
        db.commit()

    def _get_test_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    resolver = _MutableTenantResolver(tenant_id="tenant-a")
    app.dependency_overrides[get_db] = _get_test_db
    try:
        with TestClient(app) as client:
            client.app.state.tenant_context_resolver = resolver
            client.app.state.access_control_adapter = _AllowAllAdapter()
            yield client, resolver
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture(autouse=True)
def _admin_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", "tei-epistemic-admin-key")


def test_unconfigured_directory_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "tei_reference_dir", None)
    with _client(tmp_path) as client:
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unconfigured"


def test_no_binding_returns_404(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    _write_bindings(artifacts, [])
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "epistemic_binding_not_found"


def test_bound_artifact_returned_verbatim(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    _write_bound_artifact(artifacts, "local-default", "doc-1", "epistemic-assessment.json", _ASSESSMENT)
    _write_bindings(
        artifacts,
        [{"tenantId": "local-default", "docId": "doc-1", "artifactKind": "epistemic-assessment"}],
    )
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {"ok": True, "artifact": _ASSESSMENT}


def test_missing_bound_artifact_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    _write_bindings(
        artifacts,
        [{"tenantId": "local-default", "docId": "doc-1", "artifactKind": "epistemic-assessment"}],
    )
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unavailable"


def test_invalid_binding_registry_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    (artifacts / "epistemic-bindings.json").write_text("{not json", encoding="utf-8")
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unavailable"


def test_ambiguous_binding_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    _write_bindings(
        artifacts,
        [
            {"tenantId": "local-default", "docId": "doc-1", "artifactKind": "epistemic-assessment"},
            {"tenantId": "local-default", "docId": "doc-1", "artifactKind": "epistemic-context"},
        ],
    )
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "epistemic_binding_not_found"


def test_unknown_bound_artifact_kind_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    _write_bindings(
        artifacts,
        [{"tenantId": "local-default", "docId": "doc-1", "artifactKind": "secret"}],
    )
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "epistemic_binding_not_found"


def test_missing_binding_registry_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unavailable"

def test_operator_corpus_artifact_is_not_served_to_the_tenant_plane(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # A binding names only the artifact kind. The operator-level corpus file at
    # the top of the directory must not be handed to a tenant through it.
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    _write_artifact(artifacts, "epistemic-assessment.json", _ASSESSMENT)
    _write_bindings(
        artifacts,
        [{"tenantId": "local-default", "docId": "doc-1", "artifactKind": "epistemic-assessment"}],
    )
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unavailable"
    assert "artifact" not in response.json()


def test_binding_of_another_tenant_is_not_served(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    _write_bound_artifact(artifacts, "tenant-a", "doc-1", "epistemic-assessment.json", _ASSESSMENT)
    _write_bindings(
        artifacts,
        [{"tenantId": "tenant-a", "docId": "doc-1", "artifactKind": "epistemic-assessment"}],
    )
    with _tenant_client(tmp_path) as (client, resolver):
        resolver.tenant_id = "tenant-a"
        own = client.get("/docs/doc-1/epistemic/projection")
        resolver.tenant_id = "tenant-b"
        other = client.get("/docs/doc-1/epistemic/projection")

    assert own.status_code == 200
    assert other.status_code == 404
    assert other.json()["detail"]["code"] == "epistemic_binding_not_found"


def test_artifact_bound_to_another_tenant_or_document_is_not_served(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    artifacts = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))
    _write_bound_artifact(artifacts, "other-tenant", "doc-1", "epistemic-assessment.json", _ASSESSMENT)
    _write_bound_artifact(artifacts, "local-default", "doc-2", "epistemic-assessment.json", _ASSESSMENT)
    _write_bindings(
        artifacts,
        [{"tenantId": "local-default", "docId": "doc-1", "artifactKind": "epistemic-assessment"}],
    )
    with _client(tmp_path) as client:
        client.put("/docs/doc-1", json=_sample_payload("doc-1"))
        response = client.get("/docs/doc-1/epistemic/projection")
    assert response.status_code == 503
    assert "artifact" not in response.json()
