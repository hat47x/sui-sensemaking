"""Tenant boundary for the SUI reference route (M6 first step).

`test_docs_tenant_isolation_surfaces.py` fixes the tenant boundary for the
list / export-audit / merge-decision-log / import surfaces. The TEI epistemic
surfaces have their own boundary tests. The SUI reference route
(`GET /docs/{doc_id}/tei/sui-reference`) reads a bound artifact from
`tenants/<tenantId>/<docId>/`, so the same doc id existing in two tenants is
the sharpest case: tenant-b must not receive tenant-a's reference, and the
fail-closed reason must not reveal whether tenant-b has its own artifact.

This test is intentionally about the *route* boundary, not the artifact
schema. It uses a real SQLite schema, the real router, and a mutable tenant
resolver, so a regression that drops the tenant from the binding lookup fails
here instead of only in the transport unit tests.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.access_control import AccessDecision
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import Base, DocumentRow, TenantRow
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tenant_context import TenantContext

_ROUTE = "/docs/{doc_id}/tei/sui-reference"
_TIMESTAMP = "2026-11-11T00:00:00Z"


def _artifact(*, doc_id: str, marker: str) -> dict:
    return {
        "schema": "tai.reference.tei-documentv1-projection/v0",
        "contract": {"id": "sui.documentv1.projection", "version": "1"},
        "source": {"teiCommit": "boundary-fixture", "status": "active"},
        "reference": {
            "contract": "sui.tei.sensemaking-reference/v0alpha1",
            "revision": {"document": "rev-1"},
            "source": {"status": "active"},
            "disclosure": {
                "scope": "internal",
                "textVisible": True,
                "identifiersVisible": True,
            },
            "coverage": {
                "cards": "complete",
                "islands": "complete",
                "relations": "complete",
                "reviews": "complete",
            },
        },
        "document": {
            "document": {"id": doc_id, "title": marker},
            "cards": [
                {
                    "id": f"card-{marker}",
                    "text": f"card-text-{marker}",
                    "x": 0,
                    "y": 0,
                    "textReviewed": True,
                }
            ],
            "islands": [],
            "edges": [],
            "affiliations": [],
        },
    }


def _document_payload(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": f"tenant-doc-{doc_id}",
        "createdAt": _TIMESTAMP,
        "updatedAt": _TIMESTAMP,
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [],
        "edges": [],
        "islands": [],
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
def _tenant_client(
    tmp_path: Path,
    *,
    artifacts_dir: Path | None = None,
) -> Iterator[tuple[TestClient, _MutableTenantResolver]]:
    engine = create_engine(f"sqlite:///{tmp_path}/sui-reference-tenant-boundary.sqlite3")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    with session_local() as db:
        for tenant_id in ("tenant-a", "tenant-b"):
            db.add(
                TenantRow(
                    id=tenant_id,
                    display_name=tenant_id,
                    lifecycle_state="active",
                    created_at=_TIMESTAMP,
                    updated_at=_TIMESTAMP,
                )
            )
            # The same doc id exists in both tenants. This is the cross-tenant
            # case: a route that dropped the tenant would serve the wrong one.
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id="shared-doc",
                    version=1,
                    updated_at=_TIMESTAMP,
                    payload_json=json.dumps(_document_payload("shared-doc")),
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
    if artifacts_dir is not None:
        settings.tei_reference_dir = str(artifacts_dir)
    try:
        with TestClient(app) as client:
            client.app.state.tenant_context_resolver = resolver
            client.app.state.access_control_adapter = _AllowAllAdapter()
            yield client, resolver
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _install_binding(artifacts_dir: Path, *, tenant_id: str, doc_id: str, marker: str) -> None:
    bound = artifacts_dir / "tenants" / tenant_id / doc_id
    bound.mkdir(parents=True, exist_ok=True)
    (bound / "documentv1-projection.json").write_text(
        json.dumps(_artifact(doc_id=doc_id, marker=marker)), encoding="utf-8"
    )
    registry = artifacts_dir / "epistemic-bindings.json"
    entries = []
    if registry.is_file():
        entries = json.loads(registry.read_text(encoding="utf-8")).get("bindings", [])
    entries.append(
        {"tenantId": tenant_id, "docId": doc_id, "artifactKind": "documentv1-projection"}
    )
    registry.write_text(json.dumps({"bindings": entries}), encoding="utf-8")


def test_reference_route_serves_only_the_active_tenants_artifact(tmp_path, monkeypatch):
    artifacts = tmp_path / "tei-reference"
    artifacts.mkdir()
    _install_binding(artifacts, tenant_id="tenant-a", doc_id="shared-doc", marker="a")
    _install_binding(artifacts, tenant_id="tenant-b", doc_id="shared-doc", marker="b")
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))

    with _tenant_client(tmp_path) as (client, resolver):
        resolver.tenant_id = "tenant-a"
        a_response = client.get(_ROUTE.format(doc_id="shared-doc"))
        resolver.tenant_id = "tenant-b"
        b_response = client.get(_ROUTE.format(doc_id="shared-doc"))

    assert a_response.status_code == 200
    assert b_response.status_code == 200
    a_body = a_response.json()["reference"]
    b_body = b_response.json()["reference"]
    assert [card["ref"]["id"] for card in a_body["cards"]] == ["card-a"]
    assert [card["ref"]["id"] for card in b_body["cards"]] == ["card-b"]
    # The tenant-a markers must not appear in tenant-b's body, and vice versa.
    assert "card-a" not in json.dumps(b_body, ensure_ascii=False)
    assert "card-b" not in json.dumps(a_body, ensure_ascii=False)


def test_reference_route_does_not_serve_another_tenants_binding(tmp_path, monkeypatch):
    artifacts = tmp_path / "tei-reference"
    artifacts.mkdir()
    # Only tenant-a has an artifact for shared-doc.
    _install_binding(artifacts, tenant_id="tenant-a", doc_id="shared-doc", marker="a")
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))

    with _tenant_client(tmp_path) as (client, resolver):
        resolver.tenant_id = "tenant-b"
        response = client.get(_ROUTE.format(doc_id="shared-doc"))

    # tenant-b has its own document row, but no binding. The route must fail
    # closed and must not fall back to tenant-a's artifact.
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "epistemic_binding_not_found"
    assert "card-a" not in response.text
    assert "card-a" not in response.text


def test_reference_route_fails_closed_without_reference_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "tei_reference_dir", "")

    with _tenant_client(tmp_path) as (client, _resolver):
        response = client.get(_ROUTE.format(doc_id="shared-doc"))

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unconfigured"
    assert "card-" not in response.text


def test_reference_route_event_does_not_carry_artifact_content(tmp_path, monkeypatch):
    """A permitted read returns identifiers and state, never tenant text.

    The route is close to the agent-facing boundary; a change that starts
    carrying card text here would leak unreviewed content without #3369's
    owner decision.
    """

    artifacts = tmp_path / "tei-reference"
    artifacts.mkdir()
    _install_binding(artifacts, tenant_id="tenant-a", doc_id="shared-doc", marker="a")
    monkeypatch.setattr(settings, "tei_reference_dir", str(artifacts))

    with _tenant_client(tmp_path) as (client, resolver):
        resolver.tenant_id = "tenant-a"
        response = client.get(_ROUTE.format(doc_id="shared-doc"))

    assert response.status_code == 200
    body = response.json()["reference"]
    assert body["acceptedMeaning"] is False
    assert body["disclosure"]["textIncluded"] is False
    # Identifiers are carried (that is the point of the reference), but the
    # card text is not. A regression that starts shipping text fails here.
    assert body["cards"][0]["content"]["status"] == "not-carried"
    assert "card-text-a" not in response.text
