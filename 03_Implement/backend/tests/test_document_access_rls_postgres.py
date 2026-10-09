from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, select, text, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from sui_sensemaking_api.db import _normalize_database_url
# These late-defined ORM modules must be imported explicitly so Base.metadata
# is complete even when this contract test is run in isolation.
from sui_sensemaking_api.agent_credential_models import (  # noqa: F401
    AgentCredentialIndexRow,
    AgentCredentialRow,
    AgentDocumentGrantRow,
    AgentOAuthBindingRow,
)
from sui_sensemaking_api.guest_admission_models import GuestDocumentGrantRow, GuestPrincipalRow  # noqa: F401
from sui_sensemaking_api.guest_auth_session_models import GuestAuthSessionRow  # noqa: F401
from sui_sensemaking_api.guest_redeem_state_models import GuestRedeemStateRow  # noqa: F401
from sui_sensemaking_api.models import (
    Base,
    DocumentAccessAdminAuditEventRow,
    DocumentAccessMetadataRow,
    DocumentRow,
    MergeDecisionLogRow,
    TenantRow,
)
from sui_sensemaking_api.tenant_context import TenantContext
from sui_sensemaking_api.tenant_db_guard import apply_database_tenant_context
from tests.database_portability_contracts import verify_revision_dag_contract


RUN_RLS_TESTS_ENV = "SUI_RUN_PG_RLS_TESTS"
ADMIN_DATABASE_URL_ENV = "SUI_DATABASE_URL"
RUNTIME_DATABASE_URL_ENV = "SUI_TEST_POSTGRES_RUNTIME_DATABASE_URL"
BACKEND_DIR = Path(__file__).resolve().parents[1]
RLS_EXEMPT_TENANT_TABLES = {
    # Control-plane mappings are resolved before a workspace tenant context
    # exists. They are protected by the identity provisioning boundary rather
    # than the workspace data-plane RLS policy.
    "tenant_identity_providers": "control-plane identity-to-tenant resolution",
    "tenant_memberships": "control-plane user-to-tenant resolution",
    # SEC-ADMIN-PLANE-03: the control-plane audit trail is read exclusively via
    # control-plane auth (GET /admin/provision/audit), never under a tenant
    # context, and pre-tenant bootstrap rows carry a NULL tenant_id. Applying
    # data-plane RLS would hide those rows from the control-plane reader.
    "admin_audit_events": "control-plane audit trail (bootstrap rows have NULL tenant)",
    # ADR-0080: these rows are looked up by opaque keyed hashes before the
    # tenant is known. They establish authentication context only; after
    # resolution, principal/grant/document access returns to FORCE-RLS tables.
    "guest_auth_sessions": "pre-tenant guest authentication session lookup",
    "guest_redeem_states": "pre-tenant one-time guest invitation state lookup",
    # ADR-0093: looked up by a keyed hash of the opaque agent credential before
    # the tenant is known. It yields (tenant, agent, version) only; status,
    # expiry and grants are re-read from the FORCE-RLS tables on every request.
    "agent_credential_index": "pre-tenant agent credential lookup by keyed token hash",
    # ADR-0094: looked up by a verified (identity provider, subject) pair after JWT
    # verification and before the tenant is known. Status, expiry and grants are
    # re-read from the FORCE-RLS tables on every request.
    "agent_oauth_bindings": "pre-tenant agent lookup by verified OAuth principal",
}


def _rls_protected_table_names() -> set[str]:
    tenant_scoped_tables = {
        table.name for table in Base.metadata.sorted_tables if "tenant_id" in table.c
    }
    unknown_exemptions = RLS_EXEMPT_TENANT_TABLES.keys() - tenant_scoped_tables
    assert not unknown_exemptions, f"stale RLS exemptions: {sorted(unknown_exemptions)}"
    return tenant_scoped_tables - RLS_EXEMPT_TENANT_TABLES.keys()


def test_rls_scope_is_derived_from_every_tenant_scoped_model() -> None:
    assert _rls_protected_table_names() == {
        "agent_credentials",
        "agent_document_grants",
        "ai_generation_runs",
        "ai_proposal_decision_events",
        "ai_proposal_decision_states",
        "ai_proposals",
        "canvas_revision_heads",
        "canvas_revision_parents",
        "canvas_revision_pins",
        "canvas_revisions",
        "content_blobs",
        "document_access_admin_audit_events",
        "document_access_metadata",
        "documents",
        "external_agent_tasks",
        "generation_deletion_audit_events",
        "guest_document_grants",
        "guest_principals",
        "inquiry_bundle_deletion_audit_events",
        "inquiry_bundles",
        "merge_decision_logs",
        "tenant_model_allowlist",
    }


def _tenant(tenant_id: str) -> TenantContext:
    return TenantContext(
        tenant_id=tenant_id,
        membership_id=f"membership-{tenant_id}",
        resolved_by="verified_claim",
    )


@pytest.fixture(scope="module")
def postgres_rls_engines() -> Iterator[tuple[Engine, Engine]]:
    if os.getenv(RUN_RLS_TESTS_ENV) != "1":
        pytest.skip(
            f"set {RUN_RLS_TESTS_ENV}=1 with separate admin/runtime PostgreSQL URLs",
            allow_module_level=False,
        )

    admin_url = os.getenv(ADMIN_DATABASE_URL_ENV, "")
    runtime_url = os.getenv(RUNTIME_DATABASE_URL_ENV, "")
    if not admin_url.startswith("postgresql") or not runtime_url.startswith("postgresql"):
        pytest.fail(
            f"{ADMIN_DATABASE_URL_ENV} and {RUNTIME_DATABASE_URL_ENV} must be PostgreSQL URLs"
        )
    if admin_url == runtime_url:
        pytest.fail("RLS verification requires distinct migration and runtime credentials")

    migration_env = os.environ.copy()
    migration_env[ADMIN_DATABASE_URL_ENV] = admin_url
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=migration_env,
        check=True,
    )

    admin_engine = create_engine(_normalize_database_url(admin_url))
    runtime_engine = create_engine(
        _normalize_database_url(runtime_url),
        pool_size=1,
        max_overflow=0,
    )
    try:
        with runtime_engine.connect() as connection:
            posture = connection.execute(
                text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
            ).one()
            assert posture.rolsuper is False, "runtime role must not be a superuser"
            assert posture.rolbypassrls is False, "runtime role must not have BYPASSRLS"
            assert connection.execute(text("SHOW row_security")).scalar_one() == "on"
        yield admin_engine, runtime_engine
    finally:
        runtime_engine.dispose()
        admin_engine.dispose()


@pytest.mark.postgres
def test_every_tenant_data_plane_table_has_forced_write_checked_rls(
    postgres_rls_engines: tuple[Engine, Engine],
) -> None:
    admin_engine, runtime_engine = postgres_rls_engines
    expected_tables = _rls_protected_table_names()

    with admin_engine.connect() as connection:
        table_posture = {
            row.relname: (row.relrowsecurity, row.relforcerowsecurity)
            for row in connection.execute(
                text(
                    "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity "
                    "FROM pg_class AS c "
                    "JOIN pg_namespace AS n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'public' AND c.relkind = 'r'"
                )
            )
            if row.relname in expected_tables
        }
        policy_rows = [
            row
            for row in connection.execute(
                text(
                    "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check "
                    "FROM pg_policies "
                    "WHERE schemaname = 'public'"
                )
            )
            if row.tablename in expected_tables
        ]

    assert set(table_posture) == expected_tables
    assert all(enabled and forced for enabled, forced in table_posture.values())
    assert {row.tablename for row in policy_rows} == expected_tables
    assert len(policy_rows) == len(expected_tables), "each protected table must have one policy"
    for policy in policy_rows:
        assert policy.permissive == "PERMISSIVE", policy.policyname
        assert policy.roles == ["public"], policy.policyname
        assert policy.cmd == "ALL", policy.policyname
        assert "current_setting('sui_sensemaking.tenant_id'" in policy.qual, policy.policyname
        assert "current_setting('sui_sensemaking.tenant_id'" in policy.with_check, policy.policyname

    # A missing tenant context must fail closed for every protected table,
    # including newly introduced storage and revision-lineage tables.
    with runtime_engine.connect() as connection:
        for table_name in sorted(expected_tables):
            visible_rows = connection.execute(
                text(f'SELECT count(*) FROM "{table_name}"')
            ).scalar_one()
            assert visible_rows == 0, table_name


@pytest.mark.postgres
def test_postgres_revision_dag_portability_contract(
    postgres_rls_engines: tuple[Engine, Engine],
) -> None:
    admin_engine, _runtime_engine = postgres_rls_engines
    verify_revision_dag_contract(admin_engine)


def _seed_tenant_documents(
    *,
    admin_engine: Engine,
    runtime_engine: Engine,
    tenant_ids: tuple[str, str],
    doc_ids: tuple[str, str],
) -> None:
    with Session(admin_engine) as db:
        for tenant_id in tenant_ids:
            db.add(
                TenantRow(
                    id=tenant_id,
                    display_name=tenant_id,
                    lifecycle_state="active",
                    created_at="2026-07-17T00:00:00Z",
                    updated_at="2026-07-17T00:00:00Z",
                )
            )
        db.commit()

    for index, (tenant_id, doc_id) in enumerate(zip(tenant_ids, doc_ids, strict=True)):
        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_id))
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id=doc_id,
                    version=1,
                    updated_at="2026-07-17T00:00:00Z",
                    payload_json="{}",
                )
            )
            # Force the documents row to be physically inserted (and thus
            # visible to the FK check of the dependent rows below) before
            # they are added to the same flush. PostgreSQL FK checks bypass
            # RLS, but SQLAlchemy's automatic dependency sort across 3
            # sibling tables sharing the same (tenant_id, doc_id) composite
            # FK to `documents` is not reliable enough to trust implicitly.
            db.flush()
            db.add(
                DocumentAccessMetadataRow(
                    tenant_id=tenant_id,
                    doc_id=doc_id,
                    visibility="Public",
                    policy_binding_id=None,
                    policy_version=f"policy-v{index + 1}",
                    updated_at="2026-07-17T00:00:00Z",
                )
            )
            db.add(
                MergeDecisionLogRow(
                    tenant_id=tenant_id,
                    doc_id=doc_id,
                    decision_id=f"decision-{index + 1}",
                    group_id=f"group-{index + 1}",
                    snapshot_version=f"snapshot-v{index + 1}",
                    decided_at="2026-07-17T00:00:00Z",
                    payload_json="{}",
                )
            )
            db.add(
                DocumentAccessAdminAuditEventRow(
                    event_id=f"audit-{uuid4()}",
                    tenant_id=tenant_id,
                    principal_id=f"principal-{index + 1}",
                    doc_id=doc_id,
                    action="document.policy.update",
                    decision="allowed",
                    policy_version=f"policy-v{index + 1}",
                    capability_version="capability-v1",
                    correlation_id=f"correlation-{uuid4()}",
                    occurred_at="2026-07-17T00:00:00Z",
                )
            )
            db.commit()


def _cleanup(
    *,
    admin_engine: Engine,
    tenant_ids: tuple[str, str],
) -> None:
    for tenant_id in tenant_ids:
        with Session(admin_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_id))
            db.execute(
                delete(DocumentAccessAdminAuditEventRow).where(
                    DocumentAccessAdminAuditEventRow.tenant_id == tenant_id
                )
            )
            db.execute(
                delete(DocumentAccessMetadataRow).where(
                    DocumentAccessMetadataRow.tenant_id == tenant_id
                )
            )
            db.execute(
                delete(MergeDecisionLogRow).where(MergeDecisionLogRow.tenant_id == tenant_id)
            )
            db.execute(delete(DocumentRow).where(DocumentRow.tenant_id == tenant_id))
            db.commit()
    with Session(admin_engine) as db:
        db.execute(delete(TenantRow).where(TenantRow.id.in_(tenant_ids)))
        db.commit()


@pytest.mark.postgres
def test_all_rls_protected_document_tables_fail_closed_across_pool_reuse(
    postgres_rls_engines: tuple[Engine, Engine],
) -> None:
    admin_engine, runtime_engine = postgres_rls_engines
    suffix = uuid4().hex
    tenant_ids = (f"rls-a-{suffix}", f"rls-b-{suffix}")
    doc_ids = (f"doc-a-{suffix}", f"doc-b-{suffix}")

    _seed_tenant_documents(
        admin_engine=admin_engine,
        runtime_engine=runtime_engine,
        tenant_ids=tenant_ids,
        doc_ids=doc_ids,
    )
    try:
        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[0]))
            documents = db.scalars(select(DocumentRow)).all()
            merge_decisions = db.scalars(select(MergeDecisionLogRow)).all()
            metadata = db.scalars(select(DocumentAccessMetadataRow)).all()
            audit_events = db.scalars(select(DocumentAccessAdminAuditEventRow)).all()
            assert [(row.tenant_id, row.id) for row in documents] == [(tenant_ids[0], doc_ids[0])]
            assert [(row.tenant_id, row.doc_id) for row in merge_decisions] == [
                (tenant_ids[0], doc_ids[0])
            ]
            assert [(row.tenant_id, row.doc_id) for row in metadata] == [
                (tenant_ids[0], doc_ids[0])
            ]
            assert [(row.tenant_id, row.doc_id) for row in audit_events] == [
                (tenant_ids[0], doc_ids[0])
            ]
            assert (
                db.scalars(select(DocumentRow).where(DocumentRow.tenant_id == tenant_ids[1])).all()
                == []
            )
            db.commit()

        # The pool has one connection. Transaction-local tenant state must not leak
        # into its next checkout when no context is applied.
        with Session(runtime_engine) as db:
            assert db.scalars(select(DocumentRow)).all() == []
            assert db.scalars(select(MergeDecisionLogRow)).all() == []
            assert db.scalars(select(DocumentAccessMetadataRow)).all() == []
            assert db.scalars(select(DocumentAccessAdminAuditEventRow)).all() == []

        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[0]))
            document_update = db.execute(
                update(DocumentRow)
                .where(DocumentRow.tenant_id == tenant_ids[1])
                .values(payload_json='{"crossTenantWrite":true}')
            )
            merge_decision_update = db.execute(
                update(MergeDecisionLogRow)
                .where(MergeDecisionLogRow.tenant_id == tenant_ids[1])
                .values(group_id="cross-tenant-write")
            )
            metadata_update = db.execute(
                update(DocumentAccessMetadataRow)
                .where(DocumentAccessMetadataRow.tenant_id == tenant_ids[1])
                .values(
                    policy_version="cross-tenant-write",
                    updated_at="2026-07-17T00:00:01Z",
                )
            )
            audit_update = db.execute(
                update(DocumentAccessAdminAuditEventRow)
                .where(DocumentAccessAdminAuditEventRow.tenant_id == tenant_ids[1])
                .values(decision="cross-tenant-write")
            )
            assert document_update.rowcount == 0
            assert merge_decision_update.rowcount == 0
            assert metadata_update.rowcount == 0
            assert audit_update.rowcount == 0
            db.commit()

        reassignment_doc_id = f"reassign-{suffix}"
        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[0]))
            db.add(
                DocumentRow(
                    tenant_id=tenant_ids[0],
                    id=reassignment_doc_id,
                    version=1,
                    updated_at="2026-07-17T00:00:00Z",
                    payload_json="{}",
                )
            )
            db.commit()

        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[0]))
            with pytest.raises(SQLAlchemyError):
                db.execute(
                    update(DocumentRow)
                    .where(DocumentRow.id == reassignment_doc_id)
                    .values(tenant_id=tenant_ids[1])
                )
                db.commit()
            db.rollback()

        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[0]))
            with pytest.raises(SQLAlchemyError):
                db.execute(
                    update(DocumentAccessAdminAuditEventRow)
                    .where(DocumentAccessAdminAuditEventRow.tenant_id == tenant_ids[0])
                    .values(tenant_id=tenant_ids[1])
                )
                db.commit()
            db.rollback()

        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[0]))
            reassignment_document = db.scalar(
                select(DocumentRow).where(DocumentRow.id == reassignment_doc_id)
            )
            tenant_a_audit_events = db.scalars(select(DocumentAccessAdminAuditEventRow)).all()
            assert reassignment_document is not None
            assert reassignment_document.tenant_id == tenant_ids[0]
            assert tenant_a_audit_events
            assert all(row.tenant_id == tenant_ids[0] for row in tenant_a_audit_events)

        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[1]))
            tenant_b_document = db.scalar(select(DocumentRow))
            tenant_b_merge_decision = db.scalar(select(MergeDecisionLogRow))
            tenant_b_metadata = db.scalar(select(DocumentAccessMetadataRow))
            tenant_b_audit_event = db.scalar(select(DocumentAccessAdminAuditEventRow))
            assert tenant_b_document is not None
            assert tenant_b_document.payload_json == "{}"
            assert tenant_b_merge_decision is not None
            assert tenant_b_merge_decision.group_id == "group-2"
            assert tenant_b_metadata is not None
            assert tenant_b_metadata.policy_version == "policy-v2"
            assert tenant_b_audit_event is not None
            assert tenant_b_audit_event.decision == "allowed"

        with Session(runtime_engine) as db:
            db.add(
                DocumentAccessAdminAuditEventRow(
                    event_id=f"audit-{uuid4()}",
                    tenant_id=tenant_ids[0],
                    principal_id="principal-missing-context",
                    doc_id=doc_ids[0],
                    action="document.policy.update",
                    decision="allowed",
                    policy_version="policy-v1",
                    capability_version="capability-v1",
                    correlation_id=f"correlation-{uuid4()}",
                    occurred_at="2026-07-17T00:00:01Z",
                )
            )
            with pytest.raises(SQLAlchemyError):
                db.commit()
            db.rollback()
    finally:
        _cleanup(admin_engine=admin_engine, tenant_ids=tenant_ids)


@pytest.mark.postgres
def test_identical_doc_id_across_tenants_stays_isolated_under_rls(
    postgres_rls_engines: tuple[Engine, Engine],
) -> None:
    """SAAS-TENANT-01 AC-10 names this scenario explicitly: two tenants each
    holding a document under the same `id`. The test above always scopes its
    queries by `tenant_id` in addition to `id`/`doc_id`, so it cannot tell
    RLS-enforced isolation apart from the query's own WHERE clause doing the
    filtering. This test omits `tenant_id` from every query and write below,
    so only the database's row-level security policy - not application code
    remembering to filter - can be what keeps the two tenants' same-`id`
    rows apart.
    """
    admin_engine, runtime_engine = postgres_rls_engines
    suffix = uuid4().hex
    tenant_ids = (f"rls-shared-a-{suffix}", f"rls-shared-b-{suffix}")
    shared_doc_id = f"shared-doc-{suffix}"

    _seed_tenant_documents(
        admin_engine=admin_engine,
        runtime_engine=runtime_engine,
        tenant_ids=tenant_ids,
        doc_ids=(shared_doc_id, shared_doc_id),
    )
    try:
        for owner_index in (0, 1):
            owner_tenant_id = tenant_ids[owner_index]
            with Session(runtime_engine) as db:
                apply_database_tenant_context(db=db, tenant=_tenant(owner_tenant_id))

                documents = db.scalars(
                    select(DocumentRow).where(DocumentRow.id == shared_doc_id)
                ).all()
                merge_decisions = db.scalars(
                    select(MergeDecisionLogRow).where(MergeDecisionLogRow.doc_id == shared_doc_id)
                ).all()
                metadata = db.scalars(
                    select(DocumentAccessMetadataRow).where(
                        DocumentAccessMetadataRow.doc_id == shared_doc_id
                    )
                ).all()
                audit_events = db.scalars(
                    select(DocumentAccessAdminAuditEventRow).where(
                        DocumentAccessAdminAuditEventRow.doc_id == shared_doc_id
                    )
                ).all()
                assert [(row.tenant_id, row.id) for row in documents] == [
                    (owner_tenant_id, shared_doc_id)
                ]
                assert [(row.tenant_id, row.doc_id) for row in merge_decisions] == [
                    (owner_tenant_id, shared_doc_id)
                ]
                assert [(row.tenant_id, row.doc_id) for row in metadata] == [
                    (owner_tenant_id, shared_doc_id)
                ]
                assert [(row.tenant_id, row.doc_id) for row in audit_events] == [
                    (owner_tenant_id, shared_doc_id)
                ]

                # id-only write, no tenant_id in the WHERE clause: must touch
                # exactly the caller's own row, never the other tenant's.
                update_result = db.execute(
                    update(DocumentRow)
                    .where(DocumentRow.id == shared_doc_id)
                    .values(payload_json=f'{{"touchedBy":"{owner_tenant_id}"}}')
                )
                assert update_result.rowcount == 1
                db.commit()

        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[0]))
            tenant_a_doc = db.scalar(select(DocumentRow).where(DocumentRow.id == shared_doc_id))
            assert tenant_a_doc is not None
            assert tenant_a_doc.payload_json == f'{{"touchedBy":"{tenant_ids[0]}"}}'

        with Session(runtime_engine) as db:
            apply_database_tenant_context(db=db, tenant=_tenant(tenant_ids[1]))
            tenant_b_doc = db.scalar(select(DocumentRow).where(DocumentRow.id == shared_doc_id))
            assert tenant_b_doc is not None
            assert tenant_b_doc.payload_json == f'{{"touchedBy":"{tenant_ids[1]}"}}'
    finally:
        _cleanup(admin_engine=admin_engine, tenant_ids=tenant_ids)
