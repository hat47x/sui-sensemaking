from dataclasses import dataclass
from enum import Enum

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    LargeBinary,
    MetaData,
    String,
    Table,
    Text,
    event,
    text,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.mysql import LONGBLOB, LONGTEXT
from sqlalchemy.dialects.mssql import VARBINARY as MSSQL_VARBINARY
from sqlalchemy.dialects.mssql import VARCHAR as MSSQL_VARCHAR


@compiles(ForeignKeyConstraint, "oracle")
def _compile_oracle_foreign_key(element, compiler, **kwargs: object) -> str:
    """Omit Oracle's unsupported explicit NO ACTION while retaining its semantics."""
    original_ondelete = element.ondelete
    if original_ondelete != "NO ACTION":
        return compiler.visit_foreign_key_constraint(element, **kwargs)
    element.ondelete = None
    try:
        return compiler.visit_foreign_key_constraint(element, **kwargs)
    finally:
        element.ondelete = original_ondelete


class DataShape(str, Enum):
    IDENTIFIER = "identifier"
    BOUNDED_TEXT = "bounded_text"
    CONTENT_OBJECT = "content_object"


@dataclass(frozen=True)
class PersistentTextSpec:
    shape: DataShape
    proposed_max_chars: int | None
    rationale: str


def _identifier(max_chars: int, rationale: str) -> PersistentTextSpec:
    return PersistentTextSpec(DataShape.IDENTIFIER, max_chars, rationale)


def _bounded(max_chars: int, rationale: str) -> PersistentTextSpec:
    return PersistentTextSpec(DataShape.BOUNDED_TEXT, max_chars, rationale)


CONTENT_OBJECT = PersistentTextSpec(
    DataShape.CONTENT_OBJECT,
    None,
    "opaque versioned content; enforce byte-size policy separately from DB column length",
)
INTERNAL_ID = _identifier(128, "application identifier and composite-index component")
EXTERNAL_ID = _identifier(512, "externally issued identifier with a product acceptance bound")
VERSION_ID = _identifier(128, "version, digest prefix, or policy identifier")
TIMESTAMP = _bounded(40, "canonical RFC 3339 timestamp with timezone and fractional seconds")
STATE = _bounded(32, "closed-set lifecycle, action, decision, or protocol discriminator")
OIDC_ISSUER_MAX_CHARS = 512
OIDC_AUDIENCE_MAX_CHARS = 255
URI_MAX_CHARS = 2048


def portable_binary_lob_type() -> LargeBinary:
    """Unbounded binary payload type for every Verified relational backend."""
    return (
        LargeBinary()
        .with_variant(LONGBLOB(), "mysql")
        .with_variant(LONGBLOB(), "mariadb")
        .with_variant(MSSQL_VARBINARY(None), "mssql")
    )


def portable_check_constraint_sql(sql: str, backend: str) -> str:
    """Normalize the small closed set of raw check-expression differences."""
    if backend != "mssql":
        return sql
    return sql.replace("length(", "len(").replace(" IS TRUE", " = 1").replace(" IS FALSE", " = 0")


# This catalog is intentionally explicit. A coverage test rejects every new SQLAlchemy
# Text column until its product meaning is classified here.
PERSISTENT_TEXT_SPECS: dict[str, PersistentTextSpec] = {
    "external_agent_tasks.tenant_id": INTERNAL_ID,
    "external_agent_tasks.task_id": INTERNAL_ID,
    "external_agent_tasks.doc_id": INTERNAL_ID,
    "external_agent_tasks.base_doc_signature": EXTERNAL_ID,
    "external_agent_tasks.source_bundle_hash": _bounded(64, "lowercase SHA-256 digest"),
    "external_agent_tasks.query_canonical_hash": _bounded(64, "lowercase SHA-256 digest"),
    "external_agent_tasks.task_kind": STATE,
    "external_agent_tasks.provenance_level": STATE,
    "external_agent_tasks.created_at": TIMESTAMP,
    "ai_proposals.tenant_id": INTERNAL_ID,
    "ai_proposals.doc_id": INTERNAL_ID,
    "ai_proposals.proposal_id": INTERNAL_ID,
    "ai_proposals.proposal_kind": STATE,
    "ai_proposals.source_bundle_hash": _bounded(64, "lowercase SHA-256 digest"),
    "ai_proposals.origin": STATE,
    "ai_proposals.task_id": INTERNAL_ID,
    "ai_proposals.base_doc_signature": EXTERNAL_ID,
    "ai_proposals.query_canonical_hash": _bounded(64, "lowercase SHA-256 digest"),
    "ai_proposals.proposal_fingerprint": _bounded(64, "lowercase SHA-256 digest"),
    "ai_proposals.provenance_level": STATE,
    "ai_proposals.created_at": TIMESTAMP,
    "ai_proposal_decision_states.tenant_id": INTERNAL_ID,
    "ai_proposal_decision_states.doc_id": INTERNAL_ID,
    "ai_proposal_decision_states.proposal_id": INTERNAL_ID,
    "ai_proposal_decision_states.source_bundle_hash": _bounded(64, "lowercase SHA-256 digest"),
    "ai_proposal_decision_states.status": STATE,
    "ai_proposal_decision_states.updated_at": TIMESTAMP,
    "ai_proposal_decision_events.event_id": INTERNAL_ID,
    "ai_proposal_decision_events.tenant_id": INTERNAL_ID,
    "ai_proposal_decision_events.doc_id": INTERNAL_ID,
    "ai_proposal_decision_events.proposal_id": INTERNAL_ID,
    "ai_proposal_decision_events.source_bundle_hash": _bounded(64, "lowercase SHA-256 digest"),
    "ai_proposal_decision_events.idempotency_key": EXTERNAL_ID,
    "ai_proposal_decision_events.decision": STATE,
    "ai_proposal_decision_events.reviewer_ref": EXTERNAL_ID,
    "ai_proposal_decision_events.proposal_origin": STATE,
    "ai_proposal_decision_events.provenance_level": STATE,
    "ai_proposal_decision_events.reason_sha256": _bounded(64, "lowercase SHA-256 digest"),
    "ai_proposal_decision_events.recorded_at": TIMESTAMP,
    "ai_generation_runs.tenant_id": INTERNAL_ID,
    "ai_generation_runs.ai_run_id": INTERNAL_ID,
    "ai_generation_runs.task": _identifier(128, "provider-neutral LLM task discriminator"),
    "ai_generation_runs.trace_id": INTERNAL_ID,
    "ai_generation_runs.input_ir_digest": _identifier(64, "lowercase SHA-256 input IR identity"),
    "ai_generation_runs.output_digest": _identifier(
        64, "lowercase SHA-256 output content identity"
    ),
    "ai_generation_runs.policy_version": VERSION_ID,
    "ai_generation_runs.created_at": TIMESTAMP,
    "ai_generation_runs.retention_expires_at": TIMESTAMP,
    "content_blobs.tenant_id": INTERNAL_ID,
    "content_blobs.content_digest": _identifier(64, "lowercase SHA-256 content identity"),
    "content_blobs.storage_backend": STATE,
    "content_blobs.locator": _bounded(2048, "server-managed physical blob locator"),
    "content_blobs.representation": STATE,
    "content_blobs.base_digest": _identifier(64, "base blob SHA-256 for a delta"),
    "content_blobs.storage_state": STATE,
    "content_blobs.schema_version": VERSION_ID,
    "content_blobs.created_at": TIMESTAMP,
    "canvas_revisions.tenant_id": INTERNAL_ID,
    "canvas_revisions.revision_id": INTERNAL_ID,
    "canvas_revisions.doc_id": INTERNAL_ID,
    "canvas_revisions.content_digest": _identifier(64, "referenced content blob SHA-256"),
    "canvas_revisions.generation_tier": STATE,
    "canvas_revisions.generation_reason": STATE,
    "canvas_revisions.generation_origin": STATE,
    "canvas_revisions.actor_ref": EXTERNAL_ID,
    "canvas_revisions.ai_run_ref": INTERNAL_ID,
    "canvas_revisions.source_revision_id": INTERNAL_ID,
    "canvas_revisions.created_at": TIMESTAMP,
    "canvas_revision_parents.tenant_id": INTERNAL_ID,
    "canvas_revision_parents.revision_id": INTERNAL_ID,
    "canvas_revision_parents.parent_revision_id": INTERNAL_ID,
    "canvas_revision_heads.tenant_id": INTERNAL_ID,
    "canvas_revision_heads.doc_id": INTERNAL_ID,
    "canvas_revision_heads.head_name": _identifier(128, "server-managed branch or channel name"),
    "canvas_revision_heads.revision_id": INTERNAL_ID,
    "canvas_revision_heads.updated_at": TIMESTAMP,
    "canvas_revision_pins.tenant_id": INTERNAL_ID,
    "canvas_revision_pins.revision_id": INTERNAL_ID,
    "canvas_revision_pins.pin_reason": STATE,
    "canvas_revision_pins.created_at": TIMESTAMP,
    "generation_deletion_audit_events.event_id": INTERNAL_ID,
    "generation_deletion_audit_events.tenant_id": INTERNAL_ID,
    "generation_deletion_audit_events.target_kind": STATE,
    "generation_deletion_audit_events.target_ref": INTERNAL_ID,
    "generation_deletion_audit_events.storage_backend": STATE,
    "generation_deletion_audit_events.action": STATE,
    "generation_deletion_audit_events.outcome": STATE,
    "generation_deletion_audit_events.executor_ref": EXTERNAL_ID,
    "generation_deletion_audit_events.occurred_at": TIMESTAMP,
    "content_object_references.content_id": INTERNAL_ID,
    "content_object_references.tenant_id": INTERNAL_ID,
    "content_object_references.storage_backend": STATE,
    "content_object_references.locator": _bounded(2048, "server-managed NAS path or S3 object key"),
    "content_object_references.storage_state": STATE,
    "content_object_references.sha256_digest": _bounded(64, "lowercase SHA-256 digest"),
    "content_object_references.schema_version": VERSION_ID,
    "content_object_references.created_at": TIMESTAMP,
    "content_object_references.updated_at": TIMESTAMP,
    "identity_providers.id": INTERNAL_ID,
    "identity_providers.issuer": _bounded(
        OIDC_ISSUER_MAX_CHARS, "OIDC issuer URI acceptance bound"
    ),
    "identity_providers.audience": _bounded(
        OIDC_AUDIENCE_MAX_CHARS, "OIDC audience acceptance bound"
    ),
    "identity_providers.lifecycle_state": STATE,
    "identity_providers.protocol": STATE,
    "identity_providers.jwks_uri": _bounded(URI_MAX_CHARS, "JWKS URI"),
    "identity_providers.created_at": TIMESTAMP,
    "identity_providers.updated_at": TIMESTAMP,
    "saas_auth_sessions.session_key_hash": _bounded(
        256, "server-owned keyed hash of the opaque session cookie value"
    ),
    "saas_auth_sessions.principal_id": EXTERNAL_ID,
    "saas_auth_sessions.issuer": _bounded(
        OIDC_ISSUER_MAX_CHARS, "OIDC issuer URI acceptance bound"
    ),
    "saas_auth_sessions.subject": EXTERNAL_ID,
    "saas_auth_sessions.active_tenant_id": INTERNAL_ID,
    "saas_auth_sessions.tenant_session_version": VERSION_ID,
    "saas_auth_sessions.created_at": TIMESTAMP,
    "saas_auth_sessions.last_used_at": TIMESTAMP,
    "saas_auth_sessions.absolute_expires_at": TIMESTAMP,
    "saas_auth_sessions.revoked_at": TIMESTAMP,
    "saas_tenant_sessions.principal_id": EXTERNAL_ID,
    "saas_tenant_sessions.session_version": VERSION_ID,
    "saas_tenant_sessions.updated_at": TIMESTAMP,
    "tenants.id": INTERNAL_ID,
    "tenants.display_name": _bounded(255, "human-readable tenant label"),
    "tenants.lifecycle_state": STATE,
    "tenants.created_at": TIMESTAMP,
    "tenants.updated_at": TIMESTAMP,
    "users.id": INTERNAL_ID,
    "users.display_name": _bounded(255, "human-readable user label"),
    "users.email": _bounded(320, "email address acceptance bound"),
    "users.lifecycle_state": STATE,
    "users.roles": _bounded(255, "comma-separated server-verified role identifiers (SEC-AUTH-ATTRIB-01)"),
    "users.created_at": TIMESTAMP,
    "users.updated_at": TIMESTAMP,
    "documents.tenant_id": INTERNAL_ID,
    "documents.id": INTERNAL_ID,
    "documents.updated_at": TIMESTAMP,
    "documents.payload_json": CONTENT_OBJECT,
    # ADR-0073 D1=C / D2=A: creator is an immutable external id (nullable for
    # migrated docs); lifecycle_state is the two-state vocabulary.
    "documents.created_by": EXTERNAL_ID,
    "documents.lifecycle_state": _bounded(16, "active/archived lifecycle state (ADR-0073 D2=A)"),
    "inquiry_bundle_deletion_audit_events.event_id": INTERNAL_ID,
    "inquiry_bundle_deletion_audit_events.tenant_id": INTERNAL_ID,
    "inquiry_bundle_deletion_audit_events.journey_id": _identifier(
        256, "journey identifier; matches the existing API acceptance contract"
    ),
    "inquiry_bundle_deletion_audit_events.principal_id": EXTERNAL_ID,
    "inquiry_bundle_deletion_audit_events.action": STATE,
    "inquiry_bundle_deletion_audit_events.outcome": STATE,
    "inquiry_bundle_deletion_audit_events.occurred_at": TIMESTAMP,
    "inquiry_bundles.tenant_id": INTERNAL_ID,
    "inquiry_bundles.journey_id": _identifier(
        256, "journey identifier; matches the existing API acceptance contract"
    ),
    "inquiry_bundles.payload_json": CONTENT_OBJECT,
    "inquiry_bundles.updated_at": TIMESTAMP,
    # SEC-INQUIRY-BOUND-01: same shape as documents.created_by -- an
    # immutable external id, nullable for bundles that predate this column.
    "inquiry_bundles.created_by": EXTERNAL_ID,
    # ADR-0080: guest identity is tenant-scoped but deliberately not a TenantMembership.
    # Keep every persisted guest string under the same portable shape catalog as existing SaaS state.
    "guest_auth_sessions.session_key_hash": _bounded(
        256, "server-owned keyed hash of the opaque guest session cookie value"
    ),
    "guest_auth_sessions.tenant_id": INTERNAL_ID,
    "guest_auth_sessions.guest_principal_id": INTERNAL_ID,
    "guest_auth_sessions.issuer": _bounded(
        OIDC_ISSUER_MAX_CHARS, "verified guest session issuer acceptance bound"
    ),
    "guest_auth_sessions.subject": EXTERNAL_ID,
    "guest_auth_sessions.created_at": TIMESTAMP,
    "guest_auth_sessions.last_used_at": TIMESTAMP,
    "guest_auth_sessions.absolute_expires_at": TIMESTAMP,
    "guest_auth_sessions.revoked_at": TIMESTAMP,
    "guest_redeem_states.state_key_hash": _bounded(
        256, "keyed hash of a one-time guest invitation redeem handle"
    ),
    "guest_redeem_states.tenant_id": INTERNAL_ID,
    "guest_redeem_states.guest_principal_id": INTERNAL_ID,
    "guest_redeem_states.created_at": TIMESTAMP,
    "guest_redeem_states.expires_at": TIMESTAMP,
    "guest_redeem_states.consumed_at": TIMESTAMP,
    "guest_principals.tenant_id": INTERNAL_ID,
    "guest_principals.guest_principal_id": INTERNAL_ID,
    "guest_principals.invited_email": _bounded(320, "email address acceptance bound"),
    "guest_principals.status": STATE,
    "guest_principals.verification_method": STATE,
    "guest_principals.verified_issuer": _bounded(
        OIDC_ISSUER_MAX_CHARS, "verified guest identity issuer acceptance bound"
    ),
    "guest_principals.verified_subject": EXTERNAL_ID,
    "guest_principals.created_by": EXTERNAL_ID,
    "guest_principals.created_at": TIMESTAMP,
    "guest_principals.expires_at": TIMESTAMP,
    "guest_principals.redeemed_at": TIMESTAMP,
    "guest_principals.revoked_at": TIMESTAMP,
    "guest_document_grants.tenant_id": INTERNAL_ID,
    "guest_document_grants.guest_principal_id": INTERNAL_ID,
    "guest_document_grants.doc_id": INTERNAL_ID,
    "guest_document_grants.granted_by": EXTERNAL_ID,
    "guest_document_grants.granted_at": TIMESTAMP,
    "guest_document_grants.revoked_at": TIMESTAMP,
    # ADR-0093: agent credentials. The raw token is never stored; only its keyed hash.
    "agent_credentials.tenant_id": INTERNAL_ID,
    "agent_credentials.agent_id": INTERNAL_ID,
    "agent_credentials.label": _bounded(256, "operator-chosen display label for the agent"),
    "agent_credentials.status": STATE,
    "agent_credentials.created_by": EXTERNAL_ID,
    "agent_credentials.created_at": TIMESTAMP,
    "agent_credentials.expires_at": TIMESTAMP,
    "agent_credentials.revoked_at": TIMESTAMP,
    "agent_document_grants.tenant_id": INTERNAL_ID,
    "agent_document_grants.agent_id": INTERNAL_ID,
    "agent_document_grants.doc_id": INTERNAL_ID,
    "agent_document_grants.granted_by": EXTERNAL_ID,
    "agent_document_grants.granted_at": TIMESTAMP,
    "agent_document_grants.revoked_at": TIMESTAMP,
    "agent_credential_index.token_hash": _bounded(
        256, "server-owned keyed hash of the opaque agent credential"
    ),
    "agent_credential_index.tenant_id": INTERNAL_ID,
    "agent_credential_index.agent_id": INTERNAL_ID,
    "tenant_identity_providers.tenant_id": INTERNAL_ID,
    "tenant_identity_providers.identity_provider_id": INTERNAL_ID,
    "tenant_identity_providers.external_tenant_ref": EXTERNAL_ID,
    "tenant_identity_providers.lifecycle_state": STATE,
    "tenant_identity_providers.created_at": TIMESTAMP,
    "tenant_identity_providers.updated_at": TIMESTAMP,
    "tenant_memberships.tenant_id": INTERNAL_ID,
    "tenant_memberships.user_id": INTERNAL_ID,
    "tenant_memberships.lifecycle_state": STATE,
    "tenant_memberships.created_at": TIMESTAMP,
    "tenant_memberships.updated_at": TIMESTAMP,
    "user_identities.user_id": INTERNAL_ID,
    "user_identities.provider": _bounded(64, "normalized identity-provider discriminator"),
    "user_identities.external_uid": EXTERNAL_ID,
    "user_identities.identity_provider_id": INTERNAL_ID,
    "user_identities.subject": EXTERNAL_ID,
    "user_identities.created_at": TIMESTAMP,
    "document_access_admin_audit_events.event_id": INTERNAL_ID,
    "document_access_admin_audit_events.tenant_id": INTERNAL_ID,
    "document_access_admin_audit_events.principal_id": EXTERNAL_ID,
    "document_access_admin_audit_events.doc_id": INTERNAL_ID,
    "document_access_admin_audit_events.action": STATE,
    "document_access_admin_audit_events.decision": STATE,
    "document_access_admin_audit_events.policy_version": VERSION_ID,
    "document_access_admin_audit_events.capability_version": VERSION_ID,
    "document_access_admin_audit_events.correlation_id": INTERNAL_ID,
    "document_access_admin_audit_events.occurred_at": TIMESTAMP,
    "admin_audit_events.event_id": INTERNAL_ID,
    "admin_audit_events.tenant_id": INTERNAL_ID,
    "admin_audit_events.actor_ref_hash": INTERNAL_ID,
    "admin_audit_events.route": _bounded(256, "control-plane route path"),
    "admin_audit_events.operation": STATE,
    "admin_audit_events.target": INTERNAL_ID,
    "admin_audit_events.result": STATE,
    "admin_audit_events.request_id": INTERNAL_ID,
    "admin_audit_events.occurred_at": TIMESTAMP,
    "llm_provider_registry.id": INTERNAL_ID,
    "llm_provider_registry.provider_kind": STATE,
    "llm_provider_registry.display_name": _bounded(256, "provider display name"),
    "llm_provider_registry.base_url": _bounded(2048, "server-managed provider endpoint locator"),
    "llm_provider_registry.api_key_ref": _bounded(256, "secret-manager key reference (never a plaintext key)"),
    "llm_provider_registry.lifecycle_state": STATE,
    "llm_provider_registry.created_at": TIMESTAMP,
    "llm_provider_registry.updated_at": TIMESTAMP,
    "llm_model_registry.id": _bounded(256, "canonical model_id"),
    "llm_model_registry.provider_id": INTERNAL_ID,
    "llm_model_registry.display_name": _bounded(256, "model display name"),
    "llm_model_registry.capabilities": _bounded(256, "comma-separated tier tags"),
    "llm_model_registry.lifecycle_state": STATE,
    "llm_model_registry.created_at": TIMESTAMP,
    "llm_model_registry.updated_at": TIMESTAMP,
    "tenant_model_allowlist.tenant_id": INTERNAL_ID,
    "tenant_model_allowlist.model_id": _bounded(256, "canonical model_id"),
    "tenant_model_allowlist.lifecycle_state": STATE,
    "tenant_model_allowlist.created_at": TIMESTAMP,
    "tenant_model_allowlist.updated_at": TIMESTAMP,
    "document_access_metadata.tenant_id": INTERNAL_ID,
    "document_access_metadata.doc_id": INTERNAL_ID,
    "document_access_metadata.visibility": STATE,
    "document_access_metadata.policy_binding_id": EXTERNAL_ID,
    "document_access_metadata.policy_version": VERSION_ID,
    "document_access_metadata.updated_at": TIMESTAMP,
    "merge_decision_logs.tenant_id": INTERNAL_ID,
    "merge_decision_logs.doc_id": INTERNAL_ID,
    "merge_decision_logs.decision_id": INTERNAL_ID,
    "merge_decision_logs.group_id": INTERNAL_ID,
    "merge_decision_logs.snapshot_version": VERSION_ID,
    "merge_decision_logs.decided_at": TIMESTAMP,
    "merge_decision_logs.payload_json": CONTENT_OBJECT,
}


def apply_persistent_text_shapes(metadata: MetaData) -> None:
    """Apply the catalog's bounded types to current ORM metadata in place."""
    actual_text_columns = {
        f"{table.name}.{column.name}"
        for table in metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, Text)
    }
    missing = actual_text_columns - PERSISTENT_TEXT_SPECS.keys()
    if missing:
        raise RuntimeError(f"persistent text columns lack a data shape: {sorted(missing)}")
    for qualified_name, spec in PERSISTENT_TEXT_SPECS.items():
        table_name, column_name = qualified_name.split(".", 1)
        table = metadata.tables.get(table_name)
        if table is None or column_name not in table.columns:
            continue
        if spec.proposed_max_chars is not None:
            table.columns[column_name].type = String(spec.proposed_max_chars)
        else:
            table.columns[column_name].type = (
                Text()
                .with_variant(LONGTEXT(), "mysql")
                .with_variant(LONGTEXT(), "mariadb")
                .with_variant(MSSQL_VARCHAR(None), "mssql")
            )


def install_portable_text_ddl_hook() -> None:
    """Make historical create-table migrations use the same portable type catalog."""
    if getattr(install_portable_text_ddl_hook, "_installed", False):
        return

    @event.listens_for(Table, "before_create", propagate=True)
    def _apply_before_create(table: Table, _connection, **_kwargs: object) -> None:
        if _connection.dialect.name == "mssql":
            for constraint in table.constraints:
                if isinstance(constraint, CheckConstraint):
                    constraint.sqltext = text(
                        portable_check_constraint_sql(
                            str(constraint.sqltext), _connection.dialect.name
                        )
                    )
        for column in table.columns:
            spec = PERSISTENT_TEXT_SPECS.get(f"{table.name}.{column.name}")
            if (
                spec is not None
                and spec.proposed_max_chars is None
                and _connection.dialect.name in {"mysql", "mariadb"}
                and isinstance(column.type, Text)
            ):
                column.type = LONGTEXT()
                continue
            if (
                spec is not None
                and spec.proposed_max_chars is None
                and _connection.dialect.name == "mssql"
                and isinstance(column.type, Text)
            ):
                column.type = MSSQL_VARCHAR(None)
                continue
            if (
                spec is not None
                and spec.proposed_max_chars is not None
                and isinstance(column.type, Text)
            ):
                collation = None
                if (
                    table.name == "user_identities"
                    and column.name in {"provider", "external_uid"}
                    and _connection.dialect.name in {"mysql", "mariadb"}
                ):
                    collation = "utf8mb4_unicode_ci"
                column.type = String(spec.proposed_max_chars, collation=collation)

    @event.listens_for(Table, "after_create", propagate=True)
    def _unlock_cockroach_schema(table: Table, _connection, **_kwargs: object) -> None:
        if _connection.dialect.name != "cockroachdb":
            return
        quote = _connection.dialect.identifier_preparer.quote
        _connection.execute(text(f"ALTER TABLE {quote(table.name)} SET (schema_locked = false)"))

    setattr(install_portable_text_ddl_hook, "_installed", True)
