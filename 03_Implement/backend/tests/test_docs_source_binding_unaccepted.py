"""R2 pre-adoption boundary: reject candidate typed Source fields rather than lose them.

No Source storage, Root, Grant, Reader, or Schema adoption is introduced here.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, update
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.content_store import ContentBlob
from sui_sensemaking_api.database_content_store import DatabaseDocumentContentStore
from sui_sensemaking_api.db import _normalize_database_url, get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.routes.docs import _agent_document_view
from sui_sensemaking_api.models import Base, DocumentRow
from sui_sensemaking_api.tenant_context import LOCAL_DEFAULT_TENANT_CONTEXT


@pytest.fixture()
def sqlite_client(tmp_path) -> Iterator[TestClient]:
    engine = create_engine(
        _normalize_database_url(f"sqlite:///{tmp_path / 'source_binding_unaccepted.sqlite3'}")
    )
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


def _document(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "Source-binding preflight",
        "createdAt": "2026-11-14T00:00:00Z",
        "updatedAt": "2026-11-14T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {
                "id": "card-1",
                "text": "Card meaning must not be confused with Source authority.",
                "x": 0,
                "y": 0,
            }
        ],
        "edges": [],
        "islands": [],
    }


@pytest.mark.parametrize("location", ["card", "card-meta", "card-plural", "card-meta-plural", "document"])
def test_put_rejects_unaccepted_typed_source_fields_without_saving_or_leaking(
    sqlite_client: TestClient, location: str,
) -> None:
    doc_id = f"r2-unaccepted-{location}"
    payload = _document(doc_id)
    private_locator = "private://root/internal/source-that-must-not-be-echoed"
    proposed_binding = {
        "qualifiedSourceRef": private_locator,
        "startByte": 38,
        "endByte": 57,
        "rawSha256": "0" * 64,
    }
    if location == "card":
        payload["cards"][0]["sourceBinding"] = proposed_binding
    elif location == "card-meta":
        payload["cards"][0]["meta"] = {"sourceBinding": proposed_binding}
    elif location == "card-plural":
        payload["cards"][0]["sourceBindings"] = [proposed_binding]
    elif location == "card-meta-plural":
        payload["cards"][0]["meta"] = {"sourceBindings": [proposed_binding]}
    else:
        payload["sourceBindings"] = {"card-1": proposed_binding}

    response = sqlite_client.put(f"/docs/{doc_id}", json=payload)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail == {
        "code": "source_binding_contract_unavailable",
        "message": "Typed Source selection is not supported by this DocumentV1 contract.",
    }
    assert private_locator not in response.text
    assert "card-1" not in response.text
    assert sqlite_client.get(f"/docs/{doc_id}").status_code == 404


def test_legacy_free_text_meta_source_remains_supported(
    sqlite_client: TestClient,
) -> None:
    doc_id = "r2-legacy-free-text"
    payload = _document(doc_id)
    payload["cards"][0]["meta"] = {"source": "human note", "seq": 1}
    result = sqlite_client.put(f"/docs/{doc_id}", json=payload)
    assert result.status_code == 200
    cards = result.json()["cards"]
    assert cards[0]["meta"]["source"] == "human note"
    readback = sqlite_client.get(f"/docs/{doc_id}")
    assert readback.status_code == 200
    assert readback.json()["cards"][0]["meta"]["source"] == "human note"


def test_rejects_source_selection_plural_alias_at_document_and_card(
    sqlite_client: TestClient,
) -> None:
    for doc_id, placement in [
        ("r2-doc-selection", "document"),
        ("r2-card-selection", "card"),
    ]:
        payload = _document(doc_id)
        if placement == "document":
            payload["sourceSelections"] = []
        else:
            payload["cards"][0]["sourceSelections"] = []
        response = sqlite_client.put(f"/docs/{doc_id}", json=payload)
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "source_binding_contract_unavailable"


def test_rejected_binding_update_keeps_prior_card_hold_and_critique(
    sqlite_client: TestClient,
) -> None:
    doc_id = "r2-existing-hold"
    original = _document(doc_id)
    original["cards"][0]["holdState"] = "held"
    original["cards"][0]["critique"] = "An unresolved human objection"
    saved = sqlite_client.put(f"/docs/{doc_id}", json=original)
    assert saved.status_code == 200
    previous_etag = saved.headers["ETag"]

    attempted = _document(doc_id)
    attempted["cards"][0]["text"] = "unaccepted replacement"
    attempted["cards"][0]["sourceBinding"] = {
        "qualifiedSourceRef": "private://must-not-be-saved",
        "startByte": 38,
        "endByte": 57,
    }
    rejected = sqlite_client.put(
        f"/docs/{doc_id}",
        json=attempted,
        headers={"If-Match": previous_etag},
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "source_binding_contract_unavailable"

    reread = sqlite_client.get(f"/docs/{doc_id}")
    assert reread.status_code == 200
    assert reread.headers["ETag"] == previous_etag
    card = reread.json()["cards"][0]
    assert card["text"] == original["cards"][0]["text"]
    assert card["holdState"] == "held"
    assert card["critique"] == "An unresolved human objection"
    assert "sourceBinding" not in card


def test_agent_projection_does_not_expose_reserved_source_candidates() -> None:
    """Projection-only negative case, not a real agent credential or Grant."""
    doc = _document("r2-agent-projection")
    secret = "private://raw-location-secret"
    doc["sourceBindings"] = {"card-1": {"locator": secret}}
    doc["cards"][0]["textReviewed"] = True
    doc["cards"][0]["sourceBinding"] = {"locator": secret, "startByte": 38}
    doc["cards"][0]["meta"] = {"source": secret, "sourceSelection": {"locator": secret}}

    projected = _agent_document_view(doc)
    assert [card["id"] for card in projected["cards"]] == ["card-1"]
    assert projected["cards"][0]["text"] == doc["cards"][0]["text"]
    as_json = json.dumps(projected, ensure_ascii=False)
    assert secret not in as_json
    assert "sourceBindings" not in projected
    assert "sourceBinding" not in projected["cards"][0]
    assert "meta" not in projected["cards"][0]


def test_existing_stored_unadopted_source_binding_get_is_rejected_without_reflection(
    sqlite_client: TestClient, tmp_path,
) -> None:
    """Migration/old-store negative: Document read is not a Source-read grant.

    This seeds an out-of-contract revision via the internal store; no public API permits writing
    this shape. The GET must not return a scrubbed success or secret locator.
    """
    doc_id = "r2-old-row-unsupported-source"
    base = _document(doc_id)
    stored = sqlite_client.put(f"/docs/{doc_id}", json=base)
    assert stored.status_code == 200

    secret = "private://root/old-locator-must-not-be-reflected"
    with_binding = _document(doc_id)
    with_binding["cards"][0]["sourceBinding"] = {
        "qualifiedSourceRef": secret,
        "startByte": 38,
        "endByte": 57,
        "rawSha256": "a" * 64,
    }
    # Keep the revision head, stored blob and materialized projection
    # consistent. Altering only DocumentRow.payload_json would correctly
    # trip the revision-integrity guard (503) BEFORE Source preflight.
    path = tmp_path / "source_binding_unaccepted.sqlite3"
    engine = create_engine(_normalize_database_url(f"sqlite:///{path}"))
    try:
        with Session(engine) as db:
            DatabaseDocumentContentStore(db).save(
                tenant=LOCAL_DEFAULT_TENANT_CONTEXT,
                doc_id=doc_id,
                version=1,
                updated_at=with_binding["updatedAt"],
                content=ContentBlob.from_text(json.dumps(with_binding, ensure_ascii=False)),
            )
            db.commit()
    finally:
        engine.dispose()

    class AuditSpy:
        def __init__(self) -> None:
            self.events: list[object] = []

        def emit(self, event: object, *, dedup_key=None):  # noqa: ANN001
            self.events.append(event)

    spy = AuditSpy()
    old_dispatcher = getattr(sqlite_client.app.state, "audit_dispatcher", None)
    sqlite_client.app.state.audit_dispatcher = spy
    try:
        response = sqlite_client.get(f"/docs/{doc_id}")
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "source_binding_contract_unavailable"
        assert secret not in response.text
        assert "card-1" not in response.text
        assert "sourceBinding" not in response.text
        # A refused read must not be reported as an actual Document view.
        assert [event.eventType for event in spy.events if event.eventType == "view"] == []

        # Restoring a valid payload allows the reader to view again. This is
        # a local-mode fixture, not Source access or multi-client CAS proof.
        repaired = sqlite_client.put(f"/docs/{doc_id}", json=base)
        assert repaired.status_code == 200
        readback = sqlite_client.get(f"/docs/{doc_id}")
        assert readback.status_code == 200
        assert len([event for event in spy.events if event.eventType == "view"]) == 1
    finally:
        sqlite_client.app.state.audit_dispatcher = old_dispatcher


def test_tampered_revision_projection_returns_503_without_view_audit(
    sqlite_client: TestClient, tmp_path,
) -> None:
    """Revision divergence and unsupported fields are different failure gates.

    Directly modifying a materialized row without updating the immutable
    revision must fail at integrity verification, not report Source 422.
    """
    doc_id = "r2-diverged-revision"
    payload = _document(doc_id)
    created = sqlite_client.put(f"/docs/{doc_id}", json=payload)
    assert created.status_code == 200
    original_etag = created.headers["ETag"]

    path = tmp_path / "source_binding_unaccepted.sqlite3"
    engine = create_engine(_normalize_database_url(f"sqlite:///{path}"))
    secret = "private://must-not-escape-on-revision-divergence"
    changed = _document(doc_id)
    changed["cards"][0]["sourceBinding"] = {"qualifiedSourceRef": secret}
    try:
        with engine.begin() as conn:
            before = conn.execute(
                select(DocumentRow.payload_json).where(DocumentRow.id == doc_id)
            ).scalar_one()
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.id == doc_id)
                .values(payload_json=json.dumps(changed, ensure_ascii=False))
            )

        class AuditSpy:
            def __init__(self) -> None:
                self.events: list[object] = []

            def emit(self, event: object, *, dedup_key=None):  # noqa: ANN001
                self.events.append(event)

        spy = AuditSpy()
        old_dispatcher = getattr(sqlite_client.app.state, "audit_dispatcher", None)
        sqlite_client.app.state.audit_dispatcher = spy
        try:
            rejected = sqlite_client.get(f"/docs/{doc_id}")
            assert rejected.status_code == 503
            assert secret not in rejected.text
            assert [event.eventType for event in spy.events if event.eventType == "view"] == []
        finally:
            sqlite_client.app.state.audit_dispatcher = old_dispatcher

        # Repair the projection only in this synthetic fixture; it is not a
        # migration or product recovery procedure.
        with engine.begin() as conn:
            conn.execute(
                update(DocumentRow)
                .where(DocumentRow.id == doc_id)
                .values(payload_json=before)
            )
        recovered = sqlite_client.get(f"/docs/{doc_id}")
        assert recovered.status_code == 200
        assert recovered.headers["ETag"] == original_etag
    finally:
        engine.dispose()
