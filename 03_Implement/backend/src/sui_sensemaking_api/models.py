from datetime import datetime
from typing import Literal

# DX-CI-BACKEND-DT-01: the ~19 Pydantic `datetime` fields below (createdAt,
# reviewedAt, auditRecordedAt, occurredAt, decidedAt, shelvedAt, generatedAt,
# updatedAt) are deliberately plain `datetime`, not `AwareDatetime`. Nothing in
# this codebase compares or arithmetic-operates on two of these fields, or on
# one of these against an aware value such as `datetime.now(timezone.utc)`
# (confirmed by repository-wide audit); every current use is round-trip
# storage of a client-supplied ISO string. `AwareDatetime` would newly reject
# offset-less ("naive") input, and whether any already-stored payload_json
# contains such values is unconfirmed -- changing the type without that
# compatibility check first could turn currently-accepted data into a
# validation failure. Revisit if code that compares or computes across these
# fields is ever added; that is the point at which naive/aware mixing would
# actually produce wrong results rather than accepted-but-unenforced data.

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import Boolean, CheckConstraint, Index, Integer, String, Text, text
from sqlalchemy import ForeignKey, ForeignKeyConstraint, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from sui_sensemaking_api.persistence_shapes import apply_persistent_text_shapes, portable_binary_lob_type


RELATION_SUMMARY_TEXT_MAX_LENGTH = 4000
# DOMAIN-CARD-TEXT-01: content-field bounds. Chosen to preserve legitimate
# long-quote/minutes use while bounding transfer/audit growth. Card.text
# aligns with RefineCardTextRequest.cardText (2000). Narrative.text is large
# to allow verbatim minutes.
CARD_TEXT_MAX_LENGTH = 2000
# DOMAIN-CARD-TEXT-01 sync: the frontend validate_doc.ts bounds the document
# title to 500; the backend was unbounded (verified 2026-08-13 — a 501-char
# title was accepted with 200). Bound it here to keep the contract aligned.
DOCUMENT_TITLE_MAX_LENGTH = 500
# DOMAIN-CARD-TEXT-01 sync (R2 symmetry, 2026-08-13): frontend bounds
# card/island critique to 2000; backend Card.critique / Island.critique were
# unbounded. Bound here to keep read/write + frontend/backend symmetric.
CRITIQUE_MAX_LENGTH = 2000
ISLAND_TITLE_MAX_LENGTH = 500
ISLAND_SUMMARY_MAX_LENGTH = 2000
NARRATIVE_TITLE_MAX_LENGTH = 500
NARRATIVE_TEXT_MAX_LENGTH = 20000
EVIDENCE_NOTE_MAX_LENGTH = 2000
MERGE_DRAFT_MAX_LENGTH = 4000
DOCUMENT_V1_MOCK_SCHEMA_VERSION = "mock-2026-05-19-dv1"
LOCAL_DEFAULT_TENANT_ID = "local-default"


def _supports_case_insensitive_expression_index(_ddl, _target, bind, **_kwargs: object) -> bool:
    return bind.dialect.name not in {"mysql", "mariadb"}


class Base(DeclarativeBase):
    pass


class TenantRow(Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    lifecycle_state: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class ContentBlobRow(Base):
    __tablename__ = "content_blobs"
    __table_args__ = (
        CheckConstraint(
            "storage_backend IN ('database', 'nas', 's3', 'git')",
            name="ck_content_blobs_backend",
        ),
        CheckConstraint(
            "representation IN ('full_json', 'gzip_json', 'gzip_delta')",
            name="ck_content_blobs_representation",
        ),
        CheckConstraint(
            "(representation = 'gzip_delta' AND base_digest IS NOT NULL AND delta_depth > 0) "
            "OR (representation != 'gzip_delta' AND base_digest IS NULL AND delta_depth = 0)",
            name="ck_content_blobs_delta_shape",
        ),
        CheckConstraint(
            "storage_state IN ('pending', 'ready', 'deleting', 'failed')",
            name="ck_content_blobs_state",
        ),
        CheckConstraint("byte_size >= 0", name="ck_content_blobs_byte_size"),
        CheckConstraint("stored_byte_size >= 0", name="ck_content_blobs_stored_byte_size"),
        CheckConstraint("length(content_digest) = 64", name="ck_content_blobs_digest_length"),
        CheckConstraint(
            "(storage_backend = 'database' AND locator IS NULL "
            "AND (storage_state != 'ready' OR payload_bytes IS NOT NULL)) OR "
            "(storage_backend IN ('nas', 's3', 'git') AND locator IS NOT NULL "
            "AND length(trim(locator)) > 0 AND payload_bytes IS NULL)",
            name="ck_content_blobs_payload_location",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "base_digest"],
            ["content_blobs.tenant_id", "content_blobs.content_digest"],
            name="fk_content_blobs_base",
            ondelete="NO ACTION",
        ),
        Index("ix_content_blobs_tenant_state", "tenant_id", "storage_state"),
    )

    tenant_id: Mapped[str] = mapped_column(
        Text, ForeignKey("tenants.id", ondelete="NO ACTION"), primary_key=True
    )
    content_digest: Mapped[str] = mapped_column(Text, primary_key=True)
    storage_backend: Mapped[str] = mapped_column(Text, nullable=False)
    locator: Mapped[str | None] = mapped_column(Text, nullable=True)
    representation: Mapped[str] = mapped_column(Text, nullable=False)
    base_digest: Mapped[str | None] = mapped_column(Text, nullable=True)
    delta_depth: Mapped[int] = mapped_column(Integer, nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    stored_byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_state: Mapped[str] = mapped_column(Text, nullable=False)
    schema_version: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    payload_bytes: Mapped[bytes | None] = mapped_column(portable_binary_lob_type(), nullable=True)


class AiGenerationRunRow(Base):
    __tablename__ = "ai_generation_runs"
    __table_args__ = (
        CheckConstraint("length(trim(task)) > 0", name="ck_ai_generation_runs_task"),
        CheckConstraint("length(input_ir_digest) = 64", name="ck_ai_generation_runs_input_digest"),
        CheckConstraint("length(output_digest) = 64", name="ck_ai_generation_runs_output_digest"),
        CheckConstraint("safe_mode IS TRUE", name="ck_ai_generation_runs_safe_mode"),
        ForeignKeyConstraint(
            ["tenant_id", "output_digest"],
            ["content_blobs.tenant_id", "content_blobs.content_digest"],
            name="fk_ai_generation_runs_output_blob",
            ondelete="NO ACTION",
        ),
        Index("ix_ai_generation_runs_tenant_created", "tenant_id", "created_at"),
    )

    tenant_id: Mapped[str] = mapped_column(
        Text, ForeignKey("tenants.id", ondelete="NO ACTION"), primary_key=True
    )
    ai_run_id: Mapped[str] = mapped_column(Text, primary_key=True)
    task: Mapped[str] = mapped_column(Text, nullable=False)
    trace_id: Mapped[str] = mapped_column(Text, nullable=False)
    input_ir_digest: Mapped[str] = mapped_column(Text, nullable=False)
    output_digest: Mapped[str] = mapped_column(Text, nullable=False)
    policy_version: Mapped[str] = mapped_column(Text, nullable=False)
    safe_mode: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    retention_expires_at: Mapped[str | None] = mapped_column(Text, nullable=True)


class CanvasRevisionRow(Base):
    __tablename__ = "canvas_revisions"
    __table_args__ = (
        CheckConstraint(
            "generation_tier IN ('ephemeral', 'checkpoint', 'governed')",
            name="ck_canvas_revisions_tier",
        ),
        CheckConstraint(
            "generation_origin IN ('human', 'ai_proposal', 'system', 'import')",
            name="ck_canvas_revisions_origin",
        ),
        CheckConstraint(
            "(generation_origin = 'ai_proposal' AND ai_run_ref IS NOT NULL) OR "
            "(generation_origin != 'ai_proposal' AND ai_run_ref IS NULL)",
            name="ck_canvas_revisions_ai_proposal",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_canvas_revisions_document",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "content_digest"],
            ["content_blobs.tenant_id", "content_blobs.content_digest"],
            name="fk_canvas_revisions_blob",
            ondelete="NO ACTION",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "source_revision_id"],
            ["canvas_revisions.tenant_id", "canvas_revisions.revision_id"],
            name="fk_canvas_revisions_source",
            ondelete="NO ACTION",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "ai_run_ref"],
            ["ai_generation_runs.tenant_id", "ai_generation_runs.ai_run_id"],
            name="fk_canvas_revisions_ai_run",
            ondelete="NO ACTION",
        ),
        Index("ix_canvas_revisions_tenant_doc_created", "tenant_id", "doc_id", "created_at"),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    revision_id: Mapped[str] = mapped_column(Text, primary_key=True)
    doc_id: Mapped[str] = mapped_column(Text, nullable=False)
    content_digest: Mapped[str] = mapped_column(Text, nullable=False)
    generation_tier: Mapped[str] = mapped_column(Text, nullable=False)
    generation_reason: Mapped[str] = mapped_column(Text, nullable=False)
    generation_origin: Mapped[str] = mapped_column(Text, nullable=False)
    actor_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_run_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_revision_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)


class CanvasRevisionParentRow(Base):
    __tablename__ = "canvas_revision_parents"
    __table_args__ = (
        CheckConstraint(
            "revision_id != parent_revision_id",
            name="ck_canvas_revision_parents_not_self",
        ),
        CheckConstraint("parent_order >= 0", name="ck_canvas_revision_parents_order"),
        ForeignKeyConstraint(
            ["tenant_id", "revision_id"],
            ["canvas_revisions.tenant_id", "canvas_revisions.revision_id"],
            name="fk_canvas_revision_parents_revision",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "parent_revision_id"],
            ["canvas_revisions.tenant_id", "canvas_revisions.revision_id"],
            name="fk_canvas_revision_parents_parent",
            ondelete="NO ACTION",
        ),
        UniqueConstraint(
            "tenant_id",
            "revision_id",
            "parent_order",
            name="uq_canvas_revision_parents_order",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    revision_id: Mapped[str] = mapped_column(Text, primary_key=True)
    parent_revision_id: Mapped[str] = mapped_column(Text, primary_key=True)
    parent_order: Mapped[int] = mapped_column(Integer, nullable=False)


class CanvasRevisionHeadRow(Base):
    __tablename__ = "canvas_revision_heads"
    __table_args__ = (
        CheckConstraint("length(trim(head_name)) > 0", name="ck_canvas_revision_heads_name"),
        CheckConstraint("head_version > 0", name="ck_canvas_revision_heads_version"),
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_canvas_revision_heads_document",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "revision_id"],
            ["canvas_revisions.tenant_id", "canvas_revisions.revision_id"],
            name="fk_canvas_revision_heads_revision",
            ondelete="NO ACTION",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    doc_id: Mapped[str] = mapped_column(Text, primary_key=True)
    head_name: Mapped[str] = mapped_column(Text, primary_key=True)
    revision_id: Mapped[str] = mapped_column(Text, nullable=False)
    head_version: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class CanvasRevisionPinRow(Base):
    __tablename__ = "canvas_revision_pins"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "revision_id"],
            ["canvas_revisions.tenant_id", "canvas_revisions.revision_id"],
            name="fk_canvas_revision_pins_revision",
            ondelete="CASCADE",
        ),
        CheckConstraint("length(trim(pin_reason)) > 0", name="ck_canvas_revision_pins_reason"),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    revision_id: Mapped[str] = mapped_column(Text, primary_key=True)
    pin_reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)


class GenerationDeletionAuditEventRow(Base):
    """Content-free evidence for revision and physical blob GC decisions."""

    __tablename__ = "generation_deletion_audit_events"
    __table_args__ = (
        CheckConstraint(
            "action IN ('revision_gc.delete', 'blob_gc.delete')",
            name="ck_generation_deletion_audit_action",
        ),
        CheckConstraint(
            "outcome IN ('deleted', 'not_found', 'failed')",
            name="ck_generation_deletion_audit_outcome",
        ),
        CheckConstraint(
            "target_kind IN ('revision', 'blob')",
            name="ck_generation_deletion_audit_target_kind",
        ),
        CheckConstraint(
            "(target_kind = 'revision' AND action = 'revision_gc.delete' "
            "AND storage_backend IS NULL) OR "
            "(target_kind = 'blob' AND action = 'blob_gc.delete' "
            "AND storage_backend IS NOT NULL)",
            name="ck_generation_deletion_audit_target_shape",
        ),
        Index(
            "ix_generation_deletion_audit_tenant_occurred",
            "tenant_id",
            "occurred_at",
        ),
    )

    event_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        Text, ForeignKey("tenants.id", ondelete="NO ACTION"), nullable=False
    )
    target_kind: Mapped[str] = mapped_column(Text, nullable=False)
    target_ref: Mapped[str] = mapped_column(Text, nullable=False)
    storage_backend: Mapped[str | None] = mapped_column(Text, nullable=True)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    executor_ref: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_at: Mapped[str] = mapped_column(Text, nullable=False)


class IdentityProviderRow(Base):
    __tablename__ = "identity_providers"
    __table_args__ = (
        UniqueConstraint("issuer", "audience", name="uq_identity_providers_issuer_audience"),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    issuer: Mapped[str] = mapped_column(Text, nullable=False)
    audience: Mapped[str] = mapped_column(Text, nullable=False)
    lifecycle_state: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    # ADR-0063 D3: protocol discriminator. v1 accepts {'oidc'} only; unknown is fail-closed.
    protocol: Mapped[str] = mapped_column(Text, nullable=False, default="oidc")
    # ADR-0063 D4: JWKS endpoint for this provider. Nullable (not all providers use JWKS).
    jwks_uri: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class SaasTenantSessionRow(Base):
    """Shared auth-session version used by every SaaS API worker.

    ADR-0074 / SAAS-TENANT-SESSION-BINDING-01: this table is principal-keyed,
    so independent authenticated sessions of the same principal share one
    active-tenant generation -- violating ADR-0061's "1 auth session = 1
    active tenant". SaasAuthSessionRow below is its server-owned-session
    successor. This table remains the active persister (via
    DatabaseActiveTenantSessionPersister) until BFF cookie issuance and
    cutover land; expand-only for now.
    """

    __tablename__ = "saas_tenant_sessions"
    __table_args__ = (
        UniqueConstraint("session_version", name="uq_saas_tenant_sessions_version"),
    )

    principal_id: Mapped[str] = mapped_column(Text, primary_key=True)
    session_version: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class SaasAuthSessionRow(Base):
    """ADR-0074 decision 3: server-owned auth session bound to one BFF login.

    Row identity is the login session (``session_key_hash``), not the
    principal, so independent logins of the same principal never share an
    ``active_tenant_id`` / ``tenant_session_version`` generation (ADR-0061).
    ``session_key_hash`` stores a keyed hash of the opaque session cookie
    value, never the raw value (decision 2) -- the hashing key and its
    rotation are implemented where the cookie itself is issued, not here.
    ``issuer`` + ``subject`` are stored redundantly (also reachable via
    ``principal_id`` -> ``user_identities``) because decision 6's
    back-channel-logout fallback revokes by issuer+subject directly, without
    a join.

    Written by ``DatabaseSaasAuthSessionStore`` on BFF login (oauth_bff.py),
    read by the cookie fallback in trusted_auth_edge.py, and revoked on
    logout (oauth_bff.revoke_auth_session_cookie). ``rotate_active_tenant``
    CAS-updates ``active_tenant_id``/``tenant_session_version`` on this same
    row (AC-2), but no request-handling code calls it yet. Still outstanding
    SAAS-TENANT-SESSION-BINDING-01 work: wiring switch/context resolution to
    this row instead of SaasTenantSessionRow (AC-3), anti-CSRF (AC-9), and
    the cutover itself.
    """

    __tablename__ = "saas_auth_sessions"
    __table_args__ = (
        Index("ix_saas_auth_sessions_principal_id", "principal_id"),
        # MySQL/MariaDB key-length limit: composite index over two TEXT
        # columns exceeds 3072 bytes, so index issuer alone (see migration
        # 0027); subject is filtered in the row set.
        Index("ix_saas_auth_sessions_issuer", "issuer"),
    )

    session_key_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    principal_id: Mapped[str] = mapped_column(Text, nullable=False)
    issuer: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    active_tenant_id: Mapped[str | None] = mapped_column(
        Text, ForeignKey("tenants.id", ondelete="SET NULL"), nullable=True
    )
    tenant_session_version: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    last_used_at: Mapped[str] = mapped_column(Text, nullable=False)
    absolute_expires_at: Mapped[str] = mapped_column(Text, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(Text, nullable=True)


class TenantIdentityProviderRow(Base):
    __tablename__ = "tenant_identity_providers"
    __table_args__ = (
        UniqueConstraint(
            "identity_provider_id",
            "external_tenant_ref",
            name="uq_tenant_identity_providers_idp_ref",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    identity_provider_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("identity_providers.id", ondelete="CASCADE"),
        primary_key=True,
    )
    # ADR-0063 D8: external organization reference from the IdP claim.
    # Maps into tenants.id; nullable when the row expresses membership only.
    external_tenant_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    lifecycle_state: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class TenantMembershipRow(Base):
    __tablename__ = "tenant_memberships"
    __table_args__ = (Index("ix_tenant_memberships_user_id", "user_id"),)

    tenant_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    lifecycle_state: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class DocumentRow(Base):
    __tablename__ = "documents"

    tenant_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("tenants.id", name="fk_documents_tenant_id", ondelete="NO ACTION"),
        primary_key=True,
        nullable=False,
        default=LOCAL_DEFAULT_TENANT_ID,
        server_default=LOCAL_DEFAULT_TENANT_ID,
    )
    id: Mapped[str] = mapped_column(Text, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    # ADR-0073 D1=C: the creator is an immutable fact (nullable for migrated docs,
    # D3=A); the document belongs to the tenant; management rights are a
    # capability. Never mixed into a single mutable owner column.
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ADR-0073 D2=A: lifecycle is active/archived only — no trash/purge
    # (consistent with ADR-0033 which excludes a delete UI as standard).
    lifecycle_state: Mapped[str] = mapped_column(
        String(16), nullable=False, default="active", server_default="active"
    )


class DocumentListItem(BaseModel):
    """Row metadata for a tenant's document (GET /docs list; 第2反復 canvas-list foundation).

    Payload-independent: never card content, only identity/lifecycle metadata.
    """

    id: str
    title: str | None = None
    created_by: str | None = Field(default=None, exclude_if=lambda value: value is None)
    lifecycle_state: str = "active"
    updated_at: str


class DocumentAccessMetadataRow(Base):
    __tablename__ = "document_access_metadata"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_document_access_metadata_tenant_document",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "visibility IN ('Public', 'Unlisted', 'Org', 'Restricted')",
            name="ck_document_access_metadata_visibility",
        ),
        CheckConstraint(
            "visibility IN ('Public', 'Unlisted') "
            "OR (policy_binding_id IS NOT NULL AND length(trim(policy_binding_id)) > 0)",
            name="ck_document_access_metadata_policy_binding",
        ),
        CheckConstraint(
            "length(trim(policy_version)) > 0",
            name="ck_document_access_metadata_policy_version",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    doc_id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=False)
    visibility: Mapped[str] = mapped_column(Text, nullable=False)
    policy_binding_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    policy_version: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class DocumentAccessAdminAuditEventRow(Base):
    __tablename__ = "document_access_admin_audit_events"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_document_access_admin_audit_tenant_document",
            ondelete="NO ACTION",
        ),
        CheckConstraint(
            "action = 'document.policy.update'",
            name="ck_document_access_admin_audit_action",
        ),
        CheckConstraint(
            "decision = 'allowed'",
            name="ck_document_access_admin_audit_decision",
        ),
        Index(
            "ix_document_access_admin_audit_tenant_occurred",
            "tenant_id",
            "occurred_at",
        ),
    )

    event_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("tenants.id", ondelete="NO ACTION"),
        nullable=False,
    )
    principal_id: Mapped[str] = mapped_column(Text, nullable=False)
    doc_id: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    policy_version: Mapped[str] = mapped_column(Text, nullable=False)
    capability_version: Mapped[str] = mapped_column(Text, nullable=False)
    correlation_id: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_at: Mapped[str] = mapped_column(Text, nullable=False)


class AdminAuditEventRow(Base):
    """SEC-ADMIN-PLANE-03: control-plane operation audit trail.

    Records who (credential fingerprint), what (route / operation / target),
    when, and the result (allowed / denied) for /admin/* requests. Fail-open:
    recording must never block the operation. `tenant_id` is NULL for the
    pre-tenant bootstrap stage (static control-plane credential); tenant-scoped
    admin operations record the tenant. Never stores request bodies, secrets,
    raw IdP identifiers, or raw policy references (ADR-0035).
    """

    __tablename__ = "admin_audit_events"
    __table_args__ = (
        Index("ix_admin_audit_events_occurred", "occurred_at"),
        # MySQL/MariaDB key-length limit: composite index over two TEXT
        # columns exceeds 3072 bytes, so index route alone (see migration
        # 0030); result is filtered in the row set.
        Index("ix_admin_audit_events_route", "route"),
    )

    event_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_ref_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    route: Mapped[str] = mapped_column(Text, nullable=False)
    operation: Mapped[str | None] = mapped_column(Text, nullable=True)
    target: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str] = mapped_column(Text, nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    request_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[str] = mapped_column(Text, nullable=False)


class InquiryBundleRow(Base):
    """Tenant-scoped opaque InquiryBundleV1 storage.

    The backend deliberately does not interpret the bundle contract.  This keeps
    Inquiry lifecycle persistence independent of DocumentV1 and lets the client
    retain ownership of the bundle schema.
    """

    __tablename__ = "inquiry_bundles"

    tenant_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("tenants.id", ondelete="NO ACTION"),
        primary_key=True,
    )
    journey_id: Mapped[str] = mapped_column(Text, primary_key=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)
    # SEC-INQUIRY-BOUND-01: server-owned creation-time fact (ADR-0073's
    # documents.created_by pattern). NULL for bundles created before this
    # column existed -- deliberately never backfilled (same reasoning as
    # ADR-0073), and the owner check enforces only against a non-NULL value,
    # so pre-migration bundles keep today's tenant-wide access unchanged.
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    # DATA-INQUIRY-CONCURRENCY-01 (案A): server-owned monotonic revision for
    # optimistic-concurrency (If-Match) on update/delete. Client-agnostic.
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")


class InquiryBundleDeletionAuditEventRow(Base):
    """Minimal durable deletion evidence; bundle contents are never copied here."""

    __tablename__ = "inquiry_bundle_deletion_audit_events"
    __table_args__ = (
        CheckConstraint(
            "action = 'inquiry_bundle.delete'",
            name="ck_inquiry_bundle_deletion_audit_action",
        ),
        CheckConstraint(
            "outcome = 'deleted'",
            name="ck_inquiry_bundle_deletion_audit_outcome",
        ),
        Index(
            "ix_inquiry_bundle_deletion_audit_tenant_occurred",
            "tenant_id",
            "occurred_at",
        ),
    )

    event_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("tenants.id", ondelete="NO ACTION"),
        nullable=False,
    )
    journey_id: Mapped[str] = mapped_column(Text, nullable=False)
    principal_id: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    occurred_at: Mapped[str] = mapped_column(Text, nullable=False)


class UserRow(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    email: Mapped[str | None] = mapped_column(Text, nullable=True)
    lifecycle_state: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    # SEC-AUTH-ATTRIB-01: server-verified roles (comma-separated identifiers),
    # set via admin provisioning and read from THIS row — never from client
    # headers. The authorization service receives server-derived roles.
    roles: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class UserIdentityRow(Base):
    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint(
            "provider",
            "external_uid",
            name="uq_user_identities_provider_external_uid",
        ),
        UniqueConstraint(
            "identity_provider_id",
            "subject",
            name="uq_user_identities_identity_provider_subject",
        ),
        Index(
            "uq_user_identities_provider_lower_external_uid",
            text("lower(provider)"),
            text("lower(external_uid)"),
            unique=True,
        ).ddl_if(callable_=_supports_case_insensitive_expression_index),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(
        Text, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    external_uid: Mapped[str] = mapped_column(Text, nullable=False)
    identity_provider_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("identity_providers.id", ondelete="NO ACTION"),
        nullable=True,
    )
    subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)


class ExternalAgentTaskRow(Base):
    __tablename__ = "external_agent_tasks"
    __table_args__ = (
        CheckConstraint(
            "length(source_bundle_hash) = 64 AND length(query_canonical_hash) = 64",
            name="ck_external_agent_tasks_hash_lengths",
        ),
        CheckConstraint(
            "provenance_level = 'user_presented_unsigned'",
            name="ck_external_agent_tasks_provenance",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_external_agent_tasks_tenant_document",
            ondelete="CASCADE",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    task_id: Mapped[str] = mapped_column(Text, primary_key=True)
    doc_id: Mapped[str] = mapped_column(Text, nullable=False)
    base_doc_signature: Mapped[str] = mapped_column(Text, nullable=False)
    source_bundle_hash: Mapped[str] = mapped_column(Text, nullable=False)
    query_canonical_hash: Mapped[str] = mapped_column(Text, nullable=False)
    task_kind: Mapped[str] = mapped_column(Text, nullable=False)
    provenance_level: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)


class AIProposalRow(Base):
    __tablename__ = "ai_proposals"
    __table_args__ = (
        CheckConstraint(
            "length(source_bundle_hash) = 64",
            name="ck_ai_proposals_bundle_hash_length",
        ),
        CheckConstraint("origin IN ('internal', 'external_agent')", name="ck_ai_proposals_origin"),
        CheckConstraint(
            "(origin = 'internal' AND task_id IS NULL AND base_doc_signature IS NULL "
            "AND query_canonical_hash IS NULL AND proposal_fingerprint IS NULL "
            "AND provenance_level IS NULL) OR "
            "(origin = 'external_agent' AND task_id IS NOT NULL "
            "AND base_doc_signature IS NOT NULL AND length(query_canonical_hash) = 64 "
            "AND length(proposal_fingerprint) = 64 "
            "AND provenance_level = 'user_presented_unsigned')",
            name="ck_ai_proposals_external_provenance",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_ai_proposals_tenant_document",
            ondelete="CASCADE",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    doc_id: Mapped[str] = mapped_column(Text, primary_key=True)
    proposal_id: Mapped[str] = mapped_column(Text, primary_key=True)
    proposal_kind: Mapped[str] = mapped_column(Text, nullable=False)
    source_bundle_hash: Mapped[str] = mapped_column(Text, nullable=False)
    origin: Mapped[str] = mapped_column(Text, nullable=False, default="internal", server_default="internal")
    task_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_doc_signature: Mapped[str | None] = mapped_column(Text, nullable=True)
    query_canonical_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposal_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    provenance_level: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)


class AIProposalDecisionStateRow(Base):
    __tablename__ = "ai_proposal_decision_states"
    __table_args__ = (
        CheckConstraint(
            "status IN ('accepted', 'rejected', 'held')",
            name="ck_ai_proposal_decision_states_status",
        ),
        CheckConstraint(
            "length(source_bundle_hash) = 64",
            name="ck_ai_proposal_decision_states_bundle_hash_length",
        ),
        CheckConstraint("version >= 1", name="ck_ai_proposal_decision_states_version"),
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_ai_proposal_decision_states_tenant_document",
            ondelete="CASCADE",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    doc_id: Mapped[str] = mapped_column(Text, primary_key=True)
    proposal_id: Mapped[str] = mapped_column(Text, primary_key=True)
    source_bundle_hash: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class AIProposalDecisionEventRow(Base):
    __tablename__ = "ai_proposal_decision_events"
    __table_args__ = (
        CheckConstraint(
            "decision IN ('accepted', 'rejected', 'held')",
            name="ck_ai_proposal_decision_events_decision",
        ),
        CheckConstraint(
            "length(source_bundle_hash) = 64",
            name="ck_ai_proposal_decision_events_bundle_hash_length",
        ),
        CheckConstraint(
            "reason_utf8_bytes >= 0",
            name="ck_ai_proposal_decision_events_reason_size",
        ),
        CheckConstraint(
            "proposal_origin IN ('internal', 'external_agent')",
            name="ck_ai_proposal_decision_events_origin",
        ),
        CheckConstraint(
            "(proposal_origin = 'internal' AND provenance_level IS NULL) OR "
            "(proposal_origin = 'external_agent' "
            "AND provenance_level = 'user_presented_unsigned')",
            name="ck_ai_proposal_decision_events_provenance",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_ai_proposal_decision_events_tenant_document",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "tenant_id",
            "doc_id",
            "idempotency_key",
            name="uq_ai_proposal_decision_events_idempotency",
        ),
        Index(
            "ix_ai_proposal_decision_events_proposal_order",
            "tenant_id",
            "doc_id",
            "proposal_id",
            "recorded_at",
            "event_id",
        ),
    )

    event_id: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(Text, nullable=False)
    doc_id: Mapped[str] = mapped_column(Text, nullable=False)
    proposal_id: Mapped[str] = mapped_column(Text, nullable=False)
    source_bundle_hash: Mapped[str] = mapped_column(Text, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(Text, nullable=False)
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    reviewer_ref: Mapped[str] = mapped_column(Text, nullable=False)
    proposal_origin: Mapped[str] = mapped_column(Text, nullable=False, default="internal", server_default="internal")
    provenance_level: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason_sha256: Mapped[str | None] = mapped_column(Text, nullable=True)
    reason_utf8_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    recorded_at: Mapped[str] = mapped_column(Text, nullable=False)


class MergeDecisionLogRow(Base):
    __tablename__ = "merge_decision_logs"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "doc_id",
            "decision_id",
            name="uq_merge_decision_logs_tenant_doc_decision",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_merge_decision_logs_tenant_document",
            ondelete="CASCADE",
        ),
        Index("ix_merge_decision_logs_doc_group_id", "doc_id", "group_id", "id"),
        Index("ix_merge_decision_logs_doc_snapshot_id", "doc_id", "snapshot_version", "id"),
        Index(
            "ix_merge_decision_logs_tenant_doc_group_id",
            "tenant_id",
            "doc_id",
            "group_id",
            "id",
        ),
        Index(
            "ix_merge_decision_logs_tenant_doc_snapshot_id",
            "tenant_id",
            "doc_id",
            "snapshot_version",
            "id",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default=LOCAL_DEFAULT_TENANT_ID,
        server_default=LOCAL_DEFAULT_TENANT_ID,
    )
    doc_id: Mapped[str] = mapped_column(Text, nullable=False)
    decision_id: Mapped[str] = mapped_column(Text, nullable=False)
    group_id: Mapped[str] = mapped_column(Text, nullable=False)
    snapshot_version: Mapped[str] = mapped_column(Text, nullable=False)
    decided_at: Mapped[str] = mapped_column(Text, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)


class Transform(BaseModel):
    panX: float
    panY: float
    zoom: float


class CardBase(BaseModel):
    id: str
    text: str = Field(max_length=CARD_TEXT_MAX_LENGTH)
    x: float
    y: float
    claimType: Literal["fact", "claim", "hypothesis", "unknown"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    mergedIntoCardId: str | None = Field(default=None, exclude_if=lambda value: value is None)
    repOf: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    canonicalId: str | None = Field(default=None, exclude_if=lambda value: value is None)
    sources: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    critique: str | None = Field(default=None, max_length=CRITIQUE_MAX_LENGTH)
    critiqueTags: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)


class CardMeta(BaseModel):
    # DOMAIN-TRACE-01 (schemas.md §15): non-subject trace metadata only.
    # Pydantic's default extra="ignore" implements §15.3's fail-closed rule
    # for unknown meta keys — subject/provenance keys (author, owner...)
    # are dropped rather than persisted until CARD-META-UI-01 settles.
    seq: float | None = Field(default=None, exclude_if=lambda value: value is None)
    source: str | None = Field(default=None, exclude_if=lambda value: value is None)


class CardKa(BaseModel):
    # DOMAIN-KA-01 (schemas.md §17): KA-method fields, separate from
    # Card.text (which stays the event-of-record). extra="ignore" (default)
    # drops unknown keys, matching CardMeta's fail-closed handling.
    voice: str | None = Field(default=None, exclude_if=lambda value: value is None)
    value: str | None = Field(default=None, exclude_if=lambda value: value is None)


class Card(CardBase):
    textReviewed: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    holdState: Literal["held", "pending", "shelved"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    meta: CardMeta | None = Field(default=None, exclude_if=lambda value: value is None)
    ka: CardKa | None = Field(default=None, exclude_if=lambda value: value is None)


class Edge(BaseModel):
    id: str
    fromId: str
    toId: str
    fromKind: Literal["card", "island"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    toKind: Literal["card", "island"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    # DOMAIN-KJ-01 (schemas.md §3.3.2): known values are
    # related/negate/causal/mutual/equivalence, but the server accepts any
    # non-empty string so that documents carrying an UNKNOWN (future/foreign)
    # edge type round-trip through save without a 422 rejection. Rejecting
    # here was the second data-loss vector alongside the frontend validator.
    type: str = Field(min_length=1)


class Affiliation(BaseModel):
    """Non-containment card -> island membership that is reversible and many-to-many."""

    id: str = Field(min_length=1)
    cardId: str = Field(min_length=1)
    islandId: str = Field(min_length=1)


class Point(BaseModel):
    x: float
    y: float


class ShapeGeneratedFrom(BaseModel):
    cardIds: list[str]
    versionToken: str


class IslandShape(BaseModel):
    kind: Literal["rect", "polygon"]
    points: list[Point] | None = Field(default=None, exclude_if=lambda value: value is None)
    generatedFrom: ShapeGeneratedFrom | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def ensure_shape_points(self) -> "IslandShape":
        if self.kind == "polygon":
            if self.points is None or len(self.points) < 3:
                raise ValueError("polygon shape requires at least 3 points")
        elif self.points is not None:
            raise ValueError("rect shape must not include points")
        return self


class IslandGeometry(BaseModel):
    type: Literal["rect", "polygon"]
    x: float | None = Field(default=None, exclude_if=lambda value: value is None)
    y: float | None = Field(default=None, exclude_if=lambda value: value is None)
    w: float | None = Field(default=None, exclude_if=lambda value: value is None)
    h: float | None = Field(default=None, exclude_if=lambda value: value is None)
    points: list[Point] | None = Field(default=None, exclude_if=lambda value: value is None)
    polygon: dict[str, list[Point]] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @model_validator(mode="after")
    def ensure_geometry_polygon(self) -> "IslandGeometry":
        if self.type == "polygon":
            legacy_points = self.polygon.get("points") if self.polygon else None
            resolved_points = self.points if self.points is not None else legacy_points
            if resolved_points is None or len(resolved_points) < 3:
                raise ValueError("polygon geometry requires at least 3 points")
            self.points = resolved_points
            self.polygon = None
        else:
            if self.points is not None or self.polygon is not None:
                raise ValueError("rect geometry must not include polygon points")
        return self


class SummaryHistoryEntry(BaseModel):
    id: str
    createdAt: datetime
    fromText: str | None = Field(default=None, exclude_if=lambda value: value is None)
    toText: str | None = Field(default=None, exclude_if=lambda value: value is None)
    fromReviewed: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    toReviewed: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    changeKind: Literal["manual", "ai", "import", "unknown"]
    note: str | None = Field(default=None, exclude_if=lambda value: value is None)
    groundingIds: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)


class Island(BaseModel):
    id: str
    cardIds: list[str]
    parentIslandId: str | None = Field(default=None, exclude_if=lambda value: value is None)
    placardCardId: str | None = Field(default=None, exclude_if=lambda value: value is None)
    collapsed: bool = False
    title: str | None = Field(default=None, max_length=ISLAND_TITLE_MAX_LENGTH)
    titleReviewed: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    summaryText: str | None = Field(default=None, max_length=ISLAND_SUMMARY_MAX_LENGTH)
    summaryReviewed: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    summaryGrounding: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    summaryHistory: list[SummaryHistoryEntry] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    imageUrl: str | None = None
    imageReviewed: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    critique: str | None = Field(default=None, max_length=CRITIQUE_MAX_LENGTH)
    critiqueTags: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    geometry: IslandGeometry | None = Field(default=None, exclude_if=lambda value: value is None)
    shape: IslandShape | None = Field(default=None, exclude_if=lambda value: value is None)
    shapeStale: bool | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def normalize_geometry_shape(self) -> "Island":
        if self.geometry is None and self.shape is not None:
            if self.shape.kind == "polygon" and self.shape.points is not None:
                self.geometry = IslandGeometry(type="polygon", points=self.shape.points)
            elif self.shape.kind == "rect":
                self.geometry = IslandGeometry(type="rect")
        elif self.shape is None and self.geometry is not None:
            if self.geometry.type == "polygon":
                points = self.geometry.points
                if points is not None:
                    self.shape = IslandShape(kind="polygon", points=points)
            else:
                self.shape = IslandShape(kind="rect")
        return self

    @model_validator(mode="after")
    def ensure_summary_review_default(self) -> "Island":
        if self.summaryText is not None and self.summaryReviewed is None:
            self.summaryReviewed = False
        return self


class EvidenceLink(BaseModel):
    id: str
    type: Literal["supports", "contradicts"]
    fromCardId: str
    toCardId: str
    note: str | None = Field(
        default=None, max_length=EVIDENCE_NOTE_MAX_LENGTH, exclude_if=lambda value: value is None
    )
    createdAt: datetime | None = Field(default=None, exclude_if=lambda value: value is None)
    # DOMAIN-EXPR-04 (2026-06-27): reversible contradiction review state
    contradictionState: Literal["unconfirmed", "confirmed", "held", "resolved"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class NarrativeCheckReference(BaseModel):
    id: str
    kind: Literal["card", "island"]


#: A/B cross-check direction (sensemaking_technique.md §5): whether the mismatch is a
#: narrative claim with no diagram counterpart (b_missing_in_a) or a diagram
#: island the narrative never mentions (a_missing_in_b).
NarrativeCheckDirection = Literal["b_missing_in_a", "a_missing_in_b"]


class NarrativeCheckCounts(BaseModel):
    bMissingInA: int = Field(ge=0)
    aMissingInB: int = Field(ge=0)


class NarrativeCheckIssue(BaseModel):
    severity: Literal["info", "warn", "error"]
    message: str
    references: list[NarrativeCheckReference] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    # A/B cross-check classification when this issue is an A/B mismatch
    # (sensemaking_technique.md §5, 優先3).
    direction: NarrativeCheckDirection | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class NarrativeCheck(BaseModel):
    id: str
    createdAt: datetime
    kind: Literal["consistency"]
    issues: list[NarrativeCheckIssue]
    # A/B cross-check totals per direction. A zero is a VALID, reportable value:
    # sensemaking_technique.md:185 treats a zero as "the cross-check did not actually run",
    # so omitting counts vs reporting 0/0 is a meaningful distinction.
    counts: NarrativeCheckCounts | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class Narrative(BaseModel):
    id: str
    title: str = Field(max_length=NARRATIVE_TITLE_MAX_LENGTH)
    text: str = Field(max_length=NARRATIVE_TEXT_MAX_LENGTH)
    createdAt: datetime | None = Field(default=None, exclude_if=lambda value: value is None)
    basedOnReadingOrder: list[str] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    reviewed: bool
    checks: list[NarrativeCheck] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class RelationSummaryHistoryEntry(BaseModel):
    id: str
    createdAt: datetime
    changeKind: Literal["ai", "manual", "rollback", "import", "unknown"]
    fromText: str | None = Field(default=None, exclude_if=lambda value: value is None)
    toText: str | None = Field(default=None, exclude_if=lambda value: value is None)
    fromReviewed: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    toReviewed: bool | None = Field(default=None, exclude_if=lambda value: value is None)
    warningsSnapshot: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    groundingCardIdsSnapshot: list[str] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    groundingEdgeIdsSnapshot: list[str] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    note: str | None = Field(default=None, exclude_if=lambda value: value is None)


class RelationSummary(BaseModel):
    id: str
    createdAt: datetime
    islandAId: str
    islandBId: str
    relationType: Literal["related", "negate", "causal", "mutual", "equivalence", "unknown"]
    derived: bool
    text: str = Field(max_length=RELATION_SUMMARY_TEXT_MAX_LENGTH)
    reviewed: bool = False
    groundingCardIds: list[str]
    groundingEdgeIds: list[str]
    warnings: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    sourceSignature: str
    history: list[RelationSummaryHistoryEntry] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class PatchApplyStats(BaseModel):
    upsertCards: int
    deleteCards: int
    upsertIslands: int
    deleteIslands: int
    upsertEdges: int
    deleteEdges: int
    upsertRelationSummaries: int
    deleteRelationSummaries: int
    upsertEvidenceLinks: int = 0
    deleteEvidenceLinks: int = 0


class PatchApplyConflictMeta(BaseModel):
    totalConflicts: int
    chosenYours: int
    chosenTheirs: int
    chosenSkip: int


class PatchApplyLogEntry(BaseModel):
    id: str
    createdAt: datetime
    patchVersion: Literal["1"]
    patchTitle: str | None = Field(default=None, exclude_if=lambda value: value is None)
    baseDocSignature: str | None = Field(default=None, exclude_if=lambda value: value is None)
    patchSourceSignature: str | None = Field(default=None, exclude_if=lambda value: value is None)
    appliedOpIds: list[str]
    stats: PatchApplyStats
    conflictMeta: PatchApplyConflictMeta | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    note: str | None = Field(default=None, exclude_if=lambda value: value is None)


class MergeSuggestionDecision(BaseModel):
    # No explicit extra= override here previously meant Pydantic's default
    # extra="ignore" applied — decisionId/action/selectedCardIds/note/snapshotVersion
    # were already being silently dropped on every server round-trip, the same F-1
    # pattern (Island.representativeCue) applied to this type. Fixed alongside adding
    # the R3-tier-1 snapshot fields below rather than left half-mirrored.
    model_config = ConfigDict(extra="forbid")

    id: str
    decisionId: str | None = Field(default=None, exclude_if=lambda value: value is None)
    groupId: str
    decision: Literal["accept", "partial", "reject", "defer"]
    action: Literal["accept", "partial", "reject", "defer"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    decidedAt: datetime
    decidedBy: str | None = Field(default=None, exclude_if=lambda value: value is None)
    cardIds: list[str]
    selectedCardIds: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    mergedTextDraft: str = Field(max_length=MERGE_DRAFT_MAX_LENGTH)
    editedText: str
    note: str | None = Field(default=None, exclude_if=lambda value: value is None)
    snapshotVersion: str | None = Field(default=None, exclude_if=lambda value: value is None)
    rationale: str | None = Field(default=None, exclude_if=lambda value: value is None)
    # R20: new decisions preserve the proposal's method; optional here only so
    # documents saved before the field existed continue to round-trip unchanged.
    mergeMethod: Literal["near_duplicate", "kernel_fusion"] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    # R3-tier-1 (functional-dependency-integrity-2026-08-06.html §08, F-9): decision-time
    # provenance snapshot. Optional for back-compat with entries persisted before this
    # field existed.
    representativeCardId: str | None = Field(default=None, exclude_if=lambda value: value is None)
    representativeResolvedBy: (
        Literal["repOf", "mergedIntoCardId", "fallback", "unresolved"] | None
    ) = Field(default=None, exclude_if=lambda value: value is None)
    sourceCardIds: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    missingSourceCardIds: list[str] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )


class MergeDecisionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decisionId: str
    groupId: str
    action: Literal["accept", "partial", "reject", "defer"]
    selectedCardIds: list[str]
    note: str
    decidedBy: str
    decidedAt: datetime
    snapshotVersion: str


class SimilarCandidateScoreSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: float
    max: float
    avg: float


class SimilarCandidateGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")

    groupId: str
    targetCardId: str
    candidateCardIds: list[str]
    scoreSummary: SimilarCandidateScoreSummary
    reasonCodes: list[str]
    snapshotVersion: str


class CandidateListViewModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    generatedAt: datetime
    groups: list[SimilarCandidateGroup]
    totalGroupCount: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_total_group_count(self) -> "CandidateListViewModel":
        if self.totalGroupCount != len(self.groups):
            raise ValueError("totalGroupCount must equal len(groups)")
        return self


class CritiqueInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["1.0.0"]
    critiqueId: str
    targetRef: str
    critiqueType: Literal[
        "too_close", "too_far", "not_the_same", "feels_off", "no_articulable_reason"
    ]
    createdAt: datetime
    iteration: int = Field(ge=1)
    comment: str | None = Field(default=None, exclude_if=lambda value: value is None)
    constraintHints: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)

    @field_validator("targetRef")
    @classmethod
    def validate_target_ref_kind(cls, value: str) -> str:
        allowed_prefixes = ("card:", "island:", "cluster:", "edge:", "proposal:")
        if not value.startswith(allowed_prefixes):
            raise ValueError(
                "targetRef must start with card:, island:, cluster:, edge:, or proposal:"
            )
        return value


class ReproposalDiffOp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    opId: str
    opType: Literal["add", "remove", "move", "regroup", "relabel"]
    targetRef: str
    before: dict[str, object] | None
    after: dict[str, object] | None

    @model_validator(mode="after")
    def validate_reversible_payload(self) -> "ReproposalDiffOp":
        if self.before is None and self.after is None:
            raise ValueError("before or after must be provided")
        return self


class ReproposalDiff(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["1.0.0"]
    proposalId: str
    basedOnIteration: int = Field(ge=1)
    diffOps: list[ReproposalDiffOp] = Field(min_length=1)
    traceKey: str
    rationale: str | None = Field(default=None, exclude_if=lambda value: value is None)


class ReviewAttribution(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["1.0.0"]
    reviewState: Literal["unreviewed", "human_reviewed"]
    reviewedAt: datetime | None
    reviewerRef: str = Field(min_length=1)
    auditRecordedAt: datetime
    overridePolicy: Literal["human_dual_control_only"] = "human_dual_control_only"
    reviewContext: str | None = Field(default=None, exclude_if=lambda value: value is None)
    ownerRef: str | None = Field(default=None, exclude_if=lambda value: value is None)

    @field_validator("reviewerRef")
    @classmethod
    def validate_reviewer_ref_opaque(cls, value: str) -> str:
        if "@" in value or value.startswith(("sso:", "oidc:", "saml:", "provider:")):
            raise ValueError(
                "reviewerRef must be opaque and must not contain email-like/provider identifiers"
            )
        return value

    @field_validator("ownerRef")
    @classmethod
    def validate_owner_ref_opaque(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if "@" in value or value.startswith(("sso:", "oidc:", "saml:", "provider:")):
            raise ValueError(
                "ownerRef must be opaque and must not contain email-like/provider identifiers"
            )
        return value

    @model_validator(mode="after")
    def validate_human_review_transition(self) -> "ReviewAttribution":
        if self.reviewState == "human_reviewed" and self.reviewedAt is None:
            raise ValueError("reviewedAt is required when reviewState is human_reviewed")
        if self.reviewState == "unreviewed" and self.reviewedAt is not None:
            raise ValueError("reviewedAt must be null when reviewState is unreviewed")
        return self


class DeterministicTieBreak(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["1.0.0"]
    order: tuple[
        Literal["padding_compliance"],
        Literal["self_intersection_avoidance"],
        Literal["minimum_area_delta"],
        Literal["minimum_vertex_count"],
    ] = (
        "padding_compliance",
        "self_intersection_avoidance",
        "minimum_area_delta",
        "minimum_vertex_count",
    )


class A1ErrorEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    errorCode: Literal[
        "A1_SCHEMA_VERSION_MISMATCH",
        "A1_REQUIRED_FIELD_MISSING",
        "A1_TRACE_KEY_MISSING",
        "A1_OVERRIDE_POLICY_VIOLATION",
        "A1_PII_POLICY_VIOLATION",
    ]
    message: str
    contractId: Literal["A1-CRITIQUE-IF", "A1-REDIFF-IF", "A1-ATTR-IF"]
    retryable: bool
    occurredAt: datetime


class A1ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["1.0.0"]
    errorEnvelope: A1ErrorEnvelope


class A2A3GateValidationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    freezeContractId: Literal["HIL-RS-02-A1-CONTRACT-FREEZE-v1"]
    schemaVersion: Literal["1.0.0"]
    overridePolicy: Literal["human_dual_control_only"]
    contractLinkLocked: Literal[True]
    sharedResourceFreeze: Literal[True]
    a1Status: Literal["Done"]
    pendingDecisionQueueCount: Literal[0]
    hasUndefinedContractChangeRequest: Literal[False]
    hasSafeModeRegressionRequest: Literal[False]
    hasShareExportLeakageRelaxationRequest: Literal[False]


class A2A3GateValidationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    go: Literal[True] = True
    schemaVersion: Literal["1.0.0"] = "1.0.0"
    freezeContractId: Literal["HIL-RS-02-A1-CONTRACT-FREEZE-v1"] = "HIL-RS-02-A1-CONTRACT-FREEZE-v1"


class PolygonHandoffInputContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    gateApprovalRef: str
    a2VerifyRef: str
    inputHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    deterministicTieBreakOrder: tuple[
        Literal["padding_compliance"],
        Literal["self_intersection_avoidance"],
        Literal["minimum_area_delta"],
        Literal["minimum_vertex_count"],
    ] = (
        "padding_compliance",
        "self_intersection_avoidance",
        "minimum_area_delta",
        "minimum_vertex_count",
    )


class PolygonHandoffExpectedOutputContract(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outputPolygonHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    paddingViolationCount: int = Field(ge=0)
    tieBreakOrder: (
        list[
            Literal[
                "padding_compliance",
                "self_intersection_avoidance",
                "minimum_area_delta",
                "minimum_vertex_count",
            ]
        ]
        | None
    ) = Field(default=None, min_length=4, max_length=4)
    tieBreakOrderChanged: bool = False


class PolygonHandoffContractVerificationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: PolygonHandoffInputContract
    expectedOutput: PolygonHandoffExpectedOutputContract


class PolygonHandoffContractVerificationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "rollback_required"]
    rollbackRequired: bool
    failureReasons: list[str] = Field(default_factory=list)
    verificationKey: str

    @model_validator(mode="after")
    def ensure_status_consistency(self) -> "PolygonHandoffContractVerificationResponse":
        expected_rollback = self.status == "rollback_required"
        has_failures = len(self.failureReasons) > 0

        if self.rollbackRequired != expected_rollback:
            raise ValueError("rollbackRequired must match status")
        if has_failures != expected_rollback:
            raise ValueError("failureReasons must be non-empty iff status is rollback_required")

        return self


class ShelfEntry(BaseModel):
    cardId: str
    shelvedAt: datetime
    reason: str | None = Field(default=None, exclude_if=lambda value: value is None)


class ContradictionSignalDecision(BaseModel):
    """DOMAIN-EXPR-04 (schemas.md §16.2): human review decision on an
    analyzeContradictions() signal. Reuses CE2-PROPOSAL-IF's ProposalStatus
    vocabulary — not a new AI-authority grant (ADR-0041 CVI-2/CVI-3)."""

    signatureKey: str
    status: Literal["accepted", "held", "rejected"]
    decidedAt: datetime


class VoidEntry(BaseModel):
    id: str
    kind: Literal[
        "unintegrated_card",
        "orphaned_island",
        "unspoken_island",
        "unexplained_relation",
        "unreviewed_content",
    ]
    title: str = Field(min_length=1)
    detail: str = Field(min_length=1)
    cardIds: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    islandIds: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    resolved: bool = False
    createdAt: datetime


class DocumentV1(BaseModel):
    version: Literal[1]
    id: str
    title: str | None = Field(default=None, max_length=DOCUMENT_TITLE_MAX_LENGTH)
    createdAt: datetime
    updatedAt: datetime
    transform: Transform
    cards: list[Card]
    edges: list[Edge]
    islands: list[Island]
    affiliations: list[Affiliation] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    readingOrder: list[str] | None = Field(default=None, exclude_if=lambda value: value is None)
    narratives: list[Narrative] | None = Field(default=None, exclude_if=lambda value: value is None)
    relationSummaries: list[RelationSummary] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    evidenceLinks: list[EvidenceLink] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    patchApplyLog: list[PatchApplyLogEntry] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    mergeSuggestionDecisions: list[MergeSuggestionDecision] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    contradictionSignalDecisions: list[ContradictionSignalDecision] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    # sensemaking_technique.md §4 (優先3-1): enumerated structural gaps. Optional; stored
    # only when the user runs void detection.
    voids: list[VoidEntry] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    critiqueInputs: list[CritiqueInput] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    reproposalDiffs: list[ReproposalDiff] | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    reviewAttribution: ReviewAttribution | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    deterministicTieBreak: DeterministicTieBreak | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    shelf: list[ShelfEntry] | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def validate_affiliations(self) -> "DocumentV1":
        if not self.affiliations:
            return self

        card_ids = {card.id for card in self.cards}
        island_ids = {island.id for island in self.islands}
        seen_ids: set[str] = set()
        seen_pairs: set[tuple[str, str]] = set()
        for affiliation in self.affiliations:
            if affiliation.id in seen_ids:
                raise ValueError(f"duplicate affiliation id: {affiliation.id}")
            seen_ids.add(affiliation.id)

            pair = (affiliation.cardId, affiliation.islandId)
            if pair in seen_pairs:
                raise ValueError(
                    "duplicate affiliation pair: "
                    f"{affiliation.cardId} -> {affiliation.islandId}"
                )
            seen_pairs.add(pair)

            if affiliation.cardId not in card_ids:
                raise ValueError(
                    f"affiliation references unknown card: {affiliation.cardId}"
                )
            if affiliation.islandId not in island_ids:
                raise ValueError(
                    f"affiliation references unknown island: {affiliation.islandId}"
                )
        return self


DocumentPayload = DocumentV1


class SuggestLayoutRequest(BaseModel):
    doc: DocumentV1
    instruction: str | None = None
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): explicit relaxation request,
    # optional and fail-closed (None = unreviewed text is rejected).
    allowUnreviewedText: bool | None = None


class SuggestLayoutResponse(BaseModel):
    suggestionId: str
    suggestedDoc: DocumentV1
    notes: str | None = None


class MergeSuggestion(BaseModel):
    groupId: str
    cardIds: list[str]
    mergedTextDraft: str = Field(max_length=MERGE_DRAFT_MAX_LENGTH)
    mergeMethod: Literal["near_duplicate", "kernel_fusion"]
    rationale: str | None = None


class SuggestMergesRequest(BaseModel):
    doc: DocumentV1
    instruction: str | None = None
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): see SuggestLayoutRequest.
    allowUnreviewedText: bool | None = None


class SuggestMergesResponse(BaseModel):
    suggestions: list[MergeSuggestion]


# AI-MODEL-GOVERNANCE-01 (R1): dynamic model/provider registry. A provider is a
# service/credential boundary; a model is a callable destination owned by a
# provider. Platform-shared assets (NOT tenant-scoped): tenants only restrict
# WHICH models they may use via tenant_model_allowlist (R3). Secrets are stored
# as references only (api_key_ref -> env/secret manager), never plaintext.
class LLMProviderRegistryRow(Base):
    __tablename__ = "llm_provider_registry"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    provider_kind: Mapped[str] = mapped_column(Text, nullable=False)  # local|external|deepseek
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    base_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_key_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    lifecycle_state: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class LLMModelRegistryRow(Base):
    __tablename__ = "llm_model_registry"
    __table_args__ = (
        ForeignKeyConstraint(
            ["provider_id"],
            ["llm_provider_registry.id"],
            name="fk_llm_model_registry_provider",
            ondelete="CASCADE",
        ),
    )

    id: Mapped[str] = mapped_column(Text, primary_key=True)  # canonical model_id (<=256)
    provider_id: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    # Comma-separated tier tags, e.g. "intermediate,generate" / "final_judgement".
    capabilities: Mapped[str | None] = mapped_column(Text, nullable=True)
    lifecycle_state: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


class TenantModelAllowlistRow(Base):
    """R3: a tenant's allowed models (fail-closed allowlist). Empty = the
    platform-default set resolved by the effective-model resolver. Tenant-scoped
    (two-layer defense: app WHERE + RLS)."""

    __tablename__ = "tenant_model_allowlist"

    tenant_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    model_id: Mapped[str] = mapped_column(
        Text,
        ForeignKey("llm_model_registry.id", ondelete="CASCADE"),
        primary_key=True,
    )
    lifecycle_state: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[str] = mapped_column(Text, nullable=False)


apply_persistent_text_shapes(Base.metadata)
