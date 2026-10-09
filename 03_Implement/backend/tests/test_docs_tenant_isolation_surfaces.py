"""Tenant isolation for the list, export-audit and merge-decision-log surfaces.

Complements test_docs_tenant_isolation.py (GET/PUT). The same doc id exists in
tenant-a and tenant-b; the active tenant is switched through the resolver.
ADR-0059 implementation gate 5.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.access_control import AccessDecision
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.document_access_resource import ServerOwnedDocumentResourceResolver
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import Base, DocumentAccessMetadataRow, DocumentRow, TenantRow
from sui_sensemaking_api.tenant_context import TenantContext


TIMESTAMP = "2026-07-17T00:00:00Z"


@dataclass
class MutableTenantResolver:
    tenant_id: str

    def resolve(self, *, db: Session, user_id: str | None, claim: object = None) -> TenantContext:  # noqa: ARG002
        return TenantContext(
            tenant_id=self.tenant_id,
            membership_id=f"membership-{self.tenant_id}",
            resolved_by="verified_claim",
        )


class AllowAllAdapter:
    """Stand-in PDP: only the tenant boundary and local guards may deny."""

    name = "allow-all"

    def authorize(self, request):  # noqa: ANN001
        return AccessDecision(allow=True)


class SpyAuditDispatcher:
    def __init__(self) -> None:
        self.events: list[object] = []
        self._seen: set[object] = set()

    def emit(self, event: object, *, dedup_key=None):  # noqa: ANN001
        # Mirror the real dispatcher's suppression contract: an identical
        # dedup_key is dropped. A key that omits the tenant would drop the
        # second tenant's event, which is what these tests must catch.
        if dedup_key is not None:
            if dedup_key in self._seen:
                return None
            self._seen.add(dedup_key)
        self.events.append(event)
        return None


def _payload(*, doc_id: str, title: str) -> dict[str, object]:
    return {
        "version": 1,
        "id": doc_id,
        "title": title,
        "createdAt": TIMESTAMP,
        "updatedAt": TIMESTAMP,
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [],
        "edges": [],
        "islands": [],
    }


def _decision(decision_id: str) -> dict[str, object]:
    return {
        "record": {
            "decisionId": decision_id,
            "groupId": "group-1",
            "action": "accept",
            "selectedCardIds": [],
            "note": "",
            "decidedBy": "reviewer",
            "decidedAt": "2026-07-17T00:00:00Z",
            "snapshotVersion": "v1",
        }
    }


@contextmanager
def _tenant_client(
    tmp_path,
    *,
    server_owned_resources: bool = False,
) -> Iterator[tuple[TestClient, MutableTenantResolver, SpyAuditDispatcher]]:
    engine = create_engine(f"sqlite:///{tmp_path / 'surfaces.sqlite3'}")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    with session_local() as db:
        for tenant_id in ("tenant-a", "tenant-b", "tenant-c"):
            db.add(
                TenantRow(
                    id=tenant_id,
                    display_name=tenant_id,
                    lifecycle_state="active",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                )
            )
        for tenant_id, doc_id, title in (
            ("tenant-a", "shared-doc", "A shared"),
            ("tenant-a", "only-a", "A only"),
            ("tenant-b", "shared-doc", "B shared"),
            ("tenant-b", "only-b", "B only"),
        ):
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id=doc_id,
                    version=1,
                    updated_at=TIMESTAMP,
                    payload_json=json.dumps(_payload(doc_id=doc_id, title=title)),
                )
            )
        db.flush()
        if server_owned_resources:
            for tenant_id in ("tenant-a", "tenant-b"):
                db.add(
                    DocumentAccessMetadataRow(
                        tenant_id=tenant_id,
                        doc_id="shared-doc",
                        visibility="Public",
                        policy_version="policy-v1",
                        updated_at=TIMESTAMP,
                    )
                )
        db.commit()

    def _get_test_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    resolver = MutableTenantResolver(tenant_id="tenant-a")
    spy = SpyAuditDispatcher()
    app.dependency_overrides[get_db] = _get_test_db
    try:
        with TestClient(app) as client:
            client.app.state.tenant_context_resolver = resolver
            client.app.state.audit_dispatcher = spy
            if server_owned_resources:
                # SaaS-representative wiring: the resource and its tenant come
                # from the server's own rows, never from request headers.
                client.app.state.access_control_adapter = AllowAllAdapter()
                client.app.state.document_access_resource_resolver = (
                    ServerOwnedDocumentResourceResolver()
                )
            yield client, resolver, spy
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_list_returns_only_the_active_tenants_documents(tmp_path) -> None:
    with _tenant_client(tmp_path) as (client, resolver, _):
        listed: dict[str, list[str]] = {}
        for tenant_id in ("tenant-a", "tenant-b", "tenant-c"):
            resolver.tenant_id = tenant_id
            response = client.get("/docs")
            assert response.status_code == 200
            listed[tenant_id] = sorted(item["id"] for item in response.json())

    assert listed["tenant-a"] == ["only-a", "shared-doc"]
    assert listed["tenant-b"] == ["only-b", "shared-doc"]
    assert listed["tenant-c"] == []


def test_list_cursor_from_another_tenant_does_not_reveal_rows(tmp_path) -> None:
    with _tenant_client(tmp_path) as (client, resolver, _):
        resolver.tenant_id = "tenant-a"
        first = client.get("/docs", params={"limit": 1})
        assert first.status_code == 200
        cursor = first.headers.get("X-Next-Cursor")
        assert cursor, "tenant-a has two documents, so a next cursor is expected"

        resolver.tenant_id = "tenant-c"
        replay = client.get("/docs", params={"cursor": cursor})

    assert replay.status_code == 200
    assert replay.json() == []


def test_export_audit_of_another_tenants_document_is_not_found_and_not_recorded(
    tmp_path,
) -> None:
    with _tenant_client(tmp_path, server_owned_resources=True) as (client, resolver, spy):
        # only-a exists in tenant-a alone.
        resolver.tenant_id = "tenant-b"
        response = client.post(
            "/docs/only-a/export-audit",
            json={"safeMode": False, "exportKind": "bundle"},
        )

    assert response.status_code == 404
    assert spy.events == []


def test_export_audit_events_carry_the_active_tenant_and_are_not_deduplicated_across_tenants(
    tmp_path,
) -> None:
    with _tenant_client(tmp_path, server_owned_resources=True) as (client, resolver, spy):
        for tenant_id in ("tenant-a", "tenant-b"):
            resolver.tenant_id = tenant_id
            response = client.post(
                "/docs/shared-doc/export-audit", json={"safeMode": False, "exportKind": "bundle"}
            )
            assert response.status_code == 200

    assert [event.tenantId for event in spy.events] == ["tenant-a", "tenant-b"]


def test_merge_decision_logs_are_scoped_to_the_active_tenant(tmp_path) -> None:
    with _tenant_client(tmp_path) as (client, resolver, _):
        resolver.tenant_id = "tenant-a"
        created = client.post("/docs/shared-doc/merge-decision-logs", json=_decision("d-a"))
        assert created.status_code == 201

        resolver.tenant_id = "tenant-b"
        b_view = client.get("/docs/shared-doc/merge-decision-logs/by-group/group-1")
        # The same decision id may be used independently in another tenant.
        b_created = client.post("/docs/shared-doc/merge-decision-logs", json=_decision("d-a"))

        resolver.tenant_id = "tenant-a"
        a_view = client.get("/docs/shared-doc/merge-decision-logs/by-group/group-1")

        resolver.tenant_id = "tenant-c"
        c_view = client.get("/docs/shared-doc/merge-decision-logs/by-group/group-1")

    assert b_view.status_code == 200
    assert b_view.json() == []
    assert b_created.status_code == 201
    assert [entry["decisionId"] for entry in a_view.json()] == ["d-a"]
    assert c_view.status_code == 404
