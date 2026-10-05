from __future__ import annotations

import json
from typing import Literal
from urllib.parse import unquote
from uuid import uuid4

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from sui_sensemaking_api.content_store import (
    AppendOnlyLogContent,
    ContentBlob,
    ReplaceableBundleContent,
    VersionedDocumentContent,
)
from sui_sensemaking_api.generation_codec import canonical_json_bytes, encode_generation
from sui_sensemaking_api.generation_repository import (
    advance_revision_head,
    load_database_generation_blob,
    save_database_generation_blob,
)
from sui_sensemaking_api.models import (
    CanvasRevisionHeadRow,
    CanvasRevisionParentRow,
    CanvasRevisionRow,
    DocumentAccessMetadataRow,
    DocumentListItem,
    DocumentRow,
    InquiryBundleRow,
    MergeDecisionLogRow,
)
from sui_sensemaking_api.tenant_context import TenantContext
from sui_sensemaking_api.tenant_db_guard import apply_database_tenant_context


class DocumentRevisionDivergence(RuntimeError):
    pass


class DatabaseDocumentContentStore:
    def __init__(self, db: Session) -> None:
        self._db = db

    def load(self, *, tenant: TenantContext, doc_id: str) -> VersionedDocumentContent | None:
        apply_database_tenant_context(db=self._db, tenant=tenant)
        row = self._db.scalar(
            select(DocumentRow).where(
                DocumentRow.tenant_id == tenant.tenant_id,
                DocumentRow.id == doc_id,
            )
        )
        if row is None:
            return None
        restored = self._verify_revision_projection(tenant=tenant, row=row)
        content_text = row.payload_json if restored is None else restored.decode("utf-8")
        return VersionedDocumentContent(row=row, content=ContentBlob.from_text(content_text))

    def _verify_revision_projection(
        self, *, tenant: TenantContext, row: DocumentRow
    ) -> bytes | None:
        head = self._db.get(CanvasRevisionHeadRow, (tenant.tenant_id, row.id, "main"))
        if head is None:
            return None
        revision = self._db.get(CanvasRevisionRow, (tenant.tenant_id, head.revision_id))
        if revision is None:
            raise DocumentRevisionDivergence("document revision head is missing")
        restored = load_database_generation_blob(
            self._db,
            tenant=tenant,
            content_digest=revision.content_digest,
        )
        try:
            projected = canonical_json_bytes(json.loads(row.payload_json))
        except (TypeError, ValueError, json.JSONDecodeError) as error:
            raise DocumentRevisionDivergence("document projection is invalid JSON") from error
        if restored != projected:
            raise DocumentRevisionDivergence("document projection differs from revision head")
        return restored

    def _materialize_revision(
        self,
        *,
        tenant: TenantContext,
        row: DocumentRow,
        content: ContentBlob,
        created_at: str,
    ) -> None:
        try:
            value = json.loads(content.text)
        except json.JSONDecodeError as error:
            raise DocumentRevisionDivergence("document content is invalid JSON") from error
        encoded = encode_generation(value)
        head = self._db.get(CanvasRevisionHeadRow, (tenant.tenant_id, row.id, "main"))
        if head is not None:
            current_revision = self._db.get(
                CanvasRevisionRow,
                (tenant.tenant_id, head.revision_id),
            )
            if current_revision is None:
                raise DocumentRevisionDivergence("document revision head is missing")
            if current_revision.content_digest == encoded.content_digest:
                return

        save_database_generation_blob(
            self._db,
            tenant=tenant,
            blob=encoded,
            schema_version=f"document-v{row.version}",
            created_at=created_at,
        )
        self._db.flush()
        revision_id = uuid4().hex
        revision = CanvasRevisionRow(
            tenant_id=tenant.tenant_id,
            revision_id=revision_id,
            doc_id=row.id,
            content_digest=encoded.content_digest,
            generation_tier="checkpoint",
            generation_reason="manual_save",
            generation_origin="human",
            actor_ref=None,
            ai_run_ref=None,
            source_revision_id=None,
            created_at=created_at,
        )
        self._db.add(revision)
        self._db.flush()
        if head is None:
            self._db.add(
                CanvasRevisionHeadRow(
                    tenant_id=tenant.tenant_id,
                    doc_id=row.id,
                    head_name="main",
                    revision_id=revision_id,
                    head_version=1,
                    updated_at=created_at,
                )
            )
            return
        self._db.add(
            CanvasRevisionParentRow(
                tenant_id=tenant.tenant_id,
                revision_id=revision_id,
                parent_revision_id=head.revision_id,
                parent_order=0,
            )
        )
        self._db.flush()
        advance_revision_head(
            self._db,
            tenant=tenant,
            doc_id=row.id,
            head_name="main",
            expected_version=head.head_version,
            new_revision_id=revision_id,
            updated_at=created_at,
        )

    def save(
        self,
        *,
        tenant: TenantContext,
        doc_id: str,
        version: int,
        updated_at: str,
        content: ContentBlob,
        created_by: str | None = None,
    ) -> VersionedDocumentContent:
        stored = self.load(tenant=tenant, doc_id=doc_id)
        if stored is None:
            row = DocumentRow(
                tenant_id=tenant.tenant_id,
                id=doc_id,
                version=version,
                updated_at=updated_at,
                payload_json=content.text,
                # ADR-0073 D1=C / D3=A: the creator is an immutable creation-time
                # fact; nullable for migrated/legacy docs.
                created_by=created_by,
            )
            self._db.add(row)
            self._db.flush()
            self._materialize_revision(
                tenant=tenant,
                row=row,
                content=content,
                created_at=updated_at,
            )
        else:
            row = stored.row
            head = self._db.get(CanvasRevisionHeadRow, (tenant.tenant_id, doc_id, "main"))
            if row.payload_json == content.text:
                row.version = version
                row.updated_at = updated_at
                if head is None:
                    self._materialize_revision(
                        tenant=tenant,
                        row=row,
                        content=content,
                        created_at=updated_at,
                    )
                return VersionedDocumentContent(row=row, content=content)
            # Preserve the legacy projection as the initial parent before replacing it.
            if head is None:
                self._materialize_revision(
                    tenant=tenant,
                    row=row,
                    content=stored.content,
                    created_at=row.updated_at,
                )
                self._db.flush()
            row.version = version
            row.updated_at = updated_at
            row.payload_json = content.text
            self._materialize_revision(
                tenant=tenant,
                row=row,
                content=content,
                created_at=updated_at,
            )
        return VersionedDocumentContent(row=row, content=content)

    def list_documents(
        self,
        *,
        tenant: TenantContext,
        created_by: str | None = None,
        cursor: str | None = None,
        limit: int = 500,
        requesting_user_id: str | None = None,
        apply_visibility_filter: bool = False,
    ) -> tuple[list[DocumentListItem], bool]:
        """List the tenant's document metadata (第2反復: キャンバス一覧の基礎).

        SafeMode-independent — only row metadata is exposed (id, title from the
        payload snapshot, creator, lifecycle state, updated_at). Never the card
        content, which the caller must fetch per-document through the normal
        SafeMode-scoped read path. `created_by` filters to one creator ("my
        documents"); NULL rows are never matched (migrated docs are "unknown").

        SEC-DOC-BOUND-06: `Restricted` documents — and documents with no
        `document_access_metadata` row at all, which defaults to Restricted
        the same way `ServerOwnedDocumentResourceResolver` does — are excluded
        unless `requesting_user_id` matches `created_by`. This is a local
        filter on the already-stored `visibility` column, not a per-grantee
        PDP query: it is a conservative approximation, not precise
        authorization. `Public`/`Unlisted`/`Org` pass unconditionally; `Org`'s
        meaning ("visible within the tenant") is already satisfied by the
        tenant scoping below. When `requesting_user_id` is None (no
        authenticated identity resolved), the filter degrades to "only
        Public/Unlisted/Org", matching the same fail-closed default.

        SEC-DOC-BOUND-05: keyset pagination. Ordered by (updated_at DESC, id
        ASC); `cursor` is the opaque `"{updated_at}:{id}"` of the previous
        page's last row. Returns (items, has_more) — has_more is True when a
        `limit + 1`th row existed, so the caller can emit a next-cursor.
        """
        apply_database_tenant_context(db=self._db, tenant=tenant)
        query = select(DocumentRow).where(DocumentRow.tenant_id == tenant.tenant_id)
        if apply_visibility_filter:
            query = query.outerjoin(
                DocumentAccessMetadataRow,
                (DocumentAccessMetadataRow.tenant_id == DocumentRow.tenant_id)
                & (DocumentAccessMetadataRow.doc_id == DocumentRow.id),
            )
            visible_without_ownership = DocumentAccessMetadataRow.visibility.in_(
                ("Public", "Unlisted", "Org")
            )
            if requesting_user_id is not None:
                query = query.where(
                    or_(visible_without_ownership, DocumentRow.created_by == requesting_user_id)
                )
            else:
                query = query.where(visible_without_ownership)
        if created_by is not None:
            query = query.where(DocumentRow.created_by == created_by)
        if cursor is not None:
            # "{urlencoded(updated_at)}:{id}" — the previous page's last row.
            # The ISO updated_at contains colons (time + tz offset), so the
            # updated_at half is URL-encoded; the raw ":" separator is the last
            # one (ids have no colons). Comparing the updated_at string works
            # for the ISO formats the app's clients persist; an inconsistent
            # client format still bounds the response.
            cursor_updated_enc, _, cursor_id = cursor.rpartition(":")
            cursor_updated = unquote(cursor_updated_enc)
            query = query.where(
                (DocumentRow.updated_at < cursor_updated)
                | (
                    (DocumentRow.updated_at == cursor_updated)
                    & (DocumentRow.id > cursor_id)
                )
            )
        query = query.order_by(
            DocumentRow.updated_at.desc(), DocumentRow.id.asc()
        ).limit(limit + 1)
        rows = self._db.execute(query).scalars().all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        items: list[DocumentListItem] = []
        for row in rows:
            try:
                title = json.loads(row.payload_json).get("title")
                if not isinstance(title, str):
                    title = None
            except (json.JSONDecodeError, TypeError):
                title = None
            items.append(
                DocumentListItem(
                    id=row.id,
                    title=title,
                    created_by=row.created_by,
                    lifecycle_state=row.lifecycle_state,
                    updated_at=row.updated_at,
                )
            )
        return items, has_more

    def set_lifecycle_state(
        self, *, tenant: TenantContext, doc_id: str, state: Literal["active", "archived"]
    ) -> bool:
        """ADR-0073 D2=A: transition a document between active / archived.

        Tenant-scoped single UPDATE (apply_database_tenant_context + row guard).
        Returns False when the document does not exist for this tenant.
        """
        apply_database_tenant_context(db=self._db, tenant=tenant)
        result = self._db.execute(
            update(DocumentRow)
            .where(
                DocumentRow.tenant_id == tenant.tenant_id,
                DocumentRow.id == doc_id,
            )
            .values(lifecycle_state=state)
        )
        return result.rowcount > 0


class DatabaseBundleContentStore:
    def __init__(self, db: Session) -> None:
        self._db = db

    def load(self, *, tenant: TenantContext, journey_id: str) -> ReplaceableBundleContent | None:
        apply_database_tenant_context(db=self._db, tenant=tenant)
        row = self._db.scalar(
            select(InquiryBundleRow).where(
                InquiryBundleRow.tenant_id == tenant.tenant_id,
                InquiryBundleRow.journey_id == journey_id,
            )
        )
        if row is None:
            return None
        return ReplaceableBundleContent(row=row, content=ContentBlob.from_text(row.payload_json))

    def replace(
        self,
        *,
        tenant: TenantContext,
        journey_id: str,
        updated_at: str,
        content: ContentBlob,
    ) -> ReplaceableBundleContent:
        # Legacy unconditional upsert (kept for any non-CAS caller).
        stored = self.load(tenant=tenant, journey_id=journey_id)
        if stored is None:
            row = InquiryBundleRow(
                tenant_id=tenant.tenant_id,
                journey_id=journey_id,
                payload_json=content.text,
                updated_at=updated_at,
            )
            self._db.add(row)
        else:
            row = stored.row
            row.payload_json = content.text
            row.updated_at = updated_at
        return ReplaceableBundleContent(row=row, content=content)

    def create(
        self,
        *,
        tenant: TenantContext,
        journey_id: str,
        updated_at: str,
        content: ContentBlob,
        created_by: str | None = None,
    ) -> ReplaceableBundleContent:
        """DATA-INQUIRY-CONCURRENCY-01 (案A): create with revision 1. The caller
        must guarantee the row does not already exist (If-None-Match: *).

        SEC-INQUIRY-BOUND-01: created_by is a creation-time fact (ADR-0073
        pattern) -- never set or changed on update_cas/delete_cas."""
        apply_database_tenant_context(db=self._db, tenant=tenant)
        row = InquiryBundleRow(
            tenant_id=tenant.tenant_id,
            journey_id=journey_id,
            payload_json=content.text,
            updated_at=updated_at,
            revision=1,
            created_by=created_by,
        )
        self._db.add(row)
        return ReplaceableBundleContent(row=row, content=content)

    def update_cas(
        self,
        *,
        tenant: TenantContext,
        journey_id: str,
        expected_revision: int,
        updated_at: str,
        content: ContentBlob,
    ) -> bool:
        """DATA-INQUIRY-CONCURRENCY-01 (案A): atomic compare-and-swap update.
        Single UPDATE ... WHERE revision == expected, incrementing to +1, so a
        concurrent writer with the same expected_revision loses without a
        read-then-write race."""
        apply_database_tenant_context(db=self._db, tenant=tenant)
        result = self._db.execute(
            update(InquiryBundleRow)
            .where(
                InquiryBundleRow.tenant_id == tenant.tenant_id,
                InquiryBundleRow.journey_id == journey_id,
                InquiryBundleRow.revision == expected_revision,
            )
            .values(
                payload_json=content.text,
                updated_at=updated_at,
                revision=expected_revision + 1,
            )
        )
        return result.rowcount == 1

    def delete_cas(
        self,
        *,
        tenant: TenantContext,
        journey_id: str,
        expected_revision: int,
    ) -> bool:
        """DATA-INQUIRY-CONCURRENCY-01 (案A): atomic compare-and-swap delete."""
        apply_database_tenant_context(db=self._db, tenant=tenant)
        result = self._db.execute(
            delete(InquiryBundleRow).where(
                InquiryBundleRow.tenant_id == tenant.tenant_id,
                InquiryBundleRow.journey_id == journey_id,
                InquiryBundleRow.revision == expected_revision,
            )
        )
        return result.rowcount == 1

    def delete(self, *, tenant: TenantContext, journey_id: str) -> bool:
        apply_database_tenant_context(db=self._db, tenant=tenant)
        result = self._db.execute(
            delete(InquiryBundleRow).where(
                InquiryBundleRow.tenant_id == tenant.tenant_id,
                InquiryBundleRow.journey_id == journey_id,
            )
        )
        return result.rowcount == 1


class DatabaseAppendOnlyLogContentStore:
    def __init__(self, db: Session) -> None:
        self._db = db

    def append(
        self,
        *,
        tenant: TenantContext,
        doc_id: str,
        decision_id: str,
        group_id: str,
        snapshot_version: str,
        decided_at: str,
        content: ContentBlob,
    ) -> AppendOnlyLogContent:
        apply_database_tenant_context(db=self._db, tenant=tenant)
        row = MergeDecisionLogRow(
            tenant_id=tenant.tenant_id,
            doc_id=doc_id,
            decision_id=decision_id,
            group_id=group_id,
            snapshot_version=snapshot_version,
            decided_at=decided_at,
            payload_json=content.text,
        )
        self._db.add(row)
        return AppendOnlyLogContent(row=row, content=content)

    def list_by_group(
        self, *, tenant: TenantContext, doc_id: str, group_id: str
    ) -> list[AppendOnlyLogContent]:
        rows = self._list(
            tenant=tenant,
            clauses=(
                MergeDecisionLogRow.doc_id == doc_id,
                MergeDecisionLogRow.group_id == group_id,
            ),
        )
        return [
            AppendOnlyLogContent(row=row, content=ContentBlob.from_text(row.payload_json))
            for row in rows
        ]

    def list_by_snapshot(
        self, *, tenant: TenantContext, doc_id: str, snapshot_version: str
    ) -> list[AppendOnlyLogContent]:
        rows = self._list(
            tenant=tenant,
            clauses=(
                MergeDecisionLogRow.doc_id == doc_id,
                MergeDecisionLogRow.snapshot_version == snapshot_version,
            ),
        )
        return [
            AppendOnlyLogContent(row=row, content=ContentBlob.from_text(row.payload_json))
            for row in rows
        ]

    def _list(
        self, *, tenant: TenantContext, clauses: tuple[object, ...]
    ) -> list[MergeDecisionLogRow]:
        apply_database_tenant_context(db=self._db, tenant=tenant)
        return list(
            self._db.scalars(
                select(MergeDecisionLogRow)
                .where(MergeDecisionLogRow.tenant_id == tenant.tenant_id, *clauses)
                .order_by(MergeDecisionLogRow.id.asc())
            ).all()
        )
