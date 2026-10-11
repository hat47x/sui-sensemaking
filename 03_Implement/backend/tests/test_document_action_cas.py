"""Cross-path conditional Document claims for TEI #993 / SUI-native Actions.

These tests establish the SQL predicate's stale-read and scope behavior.
They do NOT substitute for true overlapping-transaction stress tests on
SQLite/PostgreSQL or an actual TEI Host -> SUI E2E scenario.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sui_sensemaking_api.content_store import ContentBlob
from sui_sensemaking_api.database_content_store import DatabaseDocumentContentStore
from sui_sensemaking_api.generation_repository import RevisionHeadConflict
from sui_sensemaking_api.models import Base, CanvasRevisionHeadRow, TenantRow
from sui_sensemaking_api.tenant_context import TenantContext


def _tenant(name: str) -> TenantContext:
    return TenantContext(
        tenant_id=name, membership_id=f"member-{name}", resolved_by="verified_claim",
    )


def test_intervening_document_write_rejects_stale_conditional_save(tmp_path) -> None:
    """Simulate old GET -> different committed writer -> stale PUT/Action."""
    engine = create_engine(f"sqlite:///{tmp_path / 'document-claim.sqlite3'}")
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)
    tenant = _tenant("tenant-a")
    started = "2026-10-11T00:00:00Z"
    original = '{"version":1,"seq":1}'
    later = '{"version":1,"seq":2}'
    try:
        with factory() as db:
            db.add(TenantRow(
                id="tenant-a", display_name="A", lifecycle_state="active",
                created_at=started, updated_at=started,
            ))
            db.commit()
            store = DatabaseDocumentContentStore(db)
            store.save(
                tenant=tenant, doc_id="doc", version=1, updated_at=started,
                content=ContentBlob.from_text(original),
            )
            db.commit()

        # A previous web/CLI caller captured this payload/ETag.
        with factory() as db:
            store = DatabaseDocumentContentStore(db)
            prior = store.load(tenant=tenant, doc_id="doc")
            assert prior is not None
            stale_json = prior.row.payload_json
            db.rollback()

        # A different writer commits first. It uses the *same* claim path
        # used by the Action endpoint and all conditional PUTs.
        with factory() as db:
            store = DatabaseDocumentContentStore(db)
            store.save(
                tenant=tenant, doc_id="doc", version=1,
                updated_at="2026-10-11T00:01:00Z",
                content=ContentBlob.from_text(later),
                expected_payload_json=stale_json,
            )
            db.commit()

        with factory() as db:
            store = DatabaseDocumentContentStore(db)
            with pytest.raises(RevisionHeadConflict):
                store.save(
                    tenant=tenant, doc_id="doc", version=1,
                    updated_at="2026-10-11T00:02:00Z",
                    content=ContentBlob.from_text('{"version":1,"seq":999}'),
                    expected_payload_json=stale_json,
                )
            db.rollback()

        with factory() as db:
            store = DatabaseDocumentContentStore(db)
            current = store.load(tenant=tenant, doc_id="doc")
            assert current is not None and current.content.text == later
            head = db.get(CanvasRevisionHeadRow, ("tenant-a", "doc", "main"))
            assert head is not None and head.head_version == 2
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_document_claim_is_tenant_scoped_archived_safe_and_nonmutating(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'claim-scope.sqlite3'}")
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)
    tenant = _tenant("tenant-a")
    other = _tenant("tenant-b")
    started = "2026-10-11T00:00:00Z"
    raw = '{"version":1,"seq":1}'
    try:
        with factory() as db:
            db.add_all([
                TenantRow(id=name, display_name=name, lifecycle_state="active",
                          created_at=started, updated_at=started)
                for name in ("tenant-a", "tenant-b")
            ])
            db.commit()
            store = DatabaseDocumentContentStore(db)
            store.save(
                tenant=tenant, doc_id="doc", version=1, updated_at=started,
                content=ContentBlob.from_text(raw),
            )
            db.commit()

        with factory() as db:
            store = DatabaseDocumentContentStore(db)
            assert not store.claim_existing_payload(
                tenant=other, doc_id="doc", expected_payload_json=raw,
            )
            assert not store.claim_existing_payload(
                tenant=tenant, doc_id="missing", expected_payload_json=raw,
            )
            assert not store.claim_existing_payload(
                tenant=tenant, doc_id="doc", expected_payload_json='{"seq":100}',
            )
            assert store.claim_existing_payload(
                tenant=tenant, doc_id="doc", expected_payload_json=raw,
            )
            db.commit()
            unchanged = store.load(tenant=tenant, doc_id="doc")
            assert unchanged is not None and unchanged.content.text == raw
            head = db.get(CanvasRevisionHeadRow, ("tenant-a", "doc", "main"))
            assert head is not None and head.head_version == 1
            assert store.set_lifecycle_state(tenant=tenant, doc_id="doc", state="archived")
            db.commit()
            assert not store.claim_existing_payload(
                tenant=tenant, doc_id="doc", expected_payload_json=raw,
            )
            db.rollback()
            persisted = store.load(tenant=tenant, doc_id="doc")
            assert persisted is not None and persisted.row.lifecycle_state == "archived"
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()
