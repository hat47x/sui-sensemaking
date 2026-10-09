from sqlalchemy import String, Text
from sqlalchemy.dialects import mssql, mysql, oracle
from sqlalchemy.schema import CreateTable

from sui_sensemaking_api.agent_credential_models import (
    AgentCredentialIndexRow,
    AgentCredentialRow,
    AgentDocumentGrantRow,
)
from sui_sensemaking_api.guest_admission_models import GuestDocumentGrantRow, GuestPrincipalRow
from sui_sensemaking_api.guest_auth_session_models import GuestAuthSessionRow
from sui_sensemaking_api.models import Base
from sui_sensemaking_api.persistence_shapes import (
    OIDC_AUDIENCE_MAX_CHARS,
    OIDC_ISSUER_MAX_CHARS,
    DataShape,
    PERSISTENT_TEXT_SPECS,
    portable_check_constraint_sql,
)


def test_every_persistent_string_column_has_an_explicit_data_shape() -> None:
    actual = {
        f"{table.name}.{column.name}"
        for table in Base.metadata.sorted_tables
        for column in table.columns
        if isinstance(column.type, String)
    }

    # The catalog intentionally retains entries needed by downgrade and historical
    # create-table migrations.  Current ORM metadata must be fully covered, while
    # retired table entries are allowed to remain in that compatibility catalog.
    assert PERSISTENT_TEXT_SPECS.keys() - actual == {
        "content_object_references.content_id",
        "content_object_references.tenant_id",
        "content_object_references.storage_backend",
        "content_object_references.locator",
        "content_object_references.storage_state",
        "content_object_references.sha256_digest",
        "content_object_references.schema_version",
        "content_object_references.created_at",
        "content_object_references.updated_at",
    }


def test_only_content_objects_are_unbounded_by_character_count() -> None:
    unbounded = {
        name for name, spec in PERSISTENT_TEXT_SPECS.items() if spec.proposed_max_chars is None
    }

    assert unbounded == {
        "documents.payload_json",
        "inquiry_bundles.payload_json",
        "merge_decision_logs.payload_json",
    }
    assert all(
        spec.shape is DataShape.CONTENT_OBJECT
        for name, spec in PERSISTENT_TEXT_SPECS.items()
        if name in unbounded
    )


def test_identifier_and_bounded_text_proposals_have_positive_limits() -> None:
    for spec in PERSISTENT_TEXT_SPECS.values():
        if spec.shape is not DataShape.CONTENT_OBJECT:
            assert spec.proposed_max_chars is not None
            assert spec.proposed_max_chars > 0


def test_catalog_drives_physical_bounded_types_without_bounding_content() -> None:
    for qualified_name, spec in PERSISTENT_TEXT_SPECS.items():
        table_name, column_name = qualified_name.split(".", 1)
        if table_name not in Base.metadata.tables:
            continue
        column_type = Base.metadata.tables[table_name].columns[column_name].type
        if spec.shape is DataShape.CONTENT_OBJECT:
            assert isinstance(column_type, Text)
            assert column_type.length is None
        else:
            assert isinstance(column_type, String)
            assert not isinstance(column_type, Text)
            assert column_type.length == spec.proposed_max_chars


def test_journey_identifier_preserves_the_existing_api_limit() -> None:
    assert PERSISTENT_TEXT_SPECS["inquiry_bundles.journey_id"].proposed_max_chars == 256


def test_oidc_lookup_key_bounds_fit_mysql_utf8mb4_composite_index() -> None:
    assert (
        PERSISTENT_TEXT_SPECS["identity_providers.issuer"].proposed_max_chars
        == OIDC_ISSUER_MAX_CHARS
    )
    assert (
        PERSISTENT_TEXT_SPECS["identity_providers.audience"].proposed_max_chars
        == OIDC_AUDIENCE_MAX_CHARS
    )
    assert (OIDC_ISSUER_MAX_CHARS + OIDC_AUDIENCE_MAX_CHARS) * 4 <= 3072


def test_mysql_uses_longtext_only_for_content_objects() -> None:
    documents_ddl = str(
        CreateTable(Base.metadata.tables["documents"]).compile(dialect=mysql.dialect())
    )
    assert "payload_json LONGTEXT" in documents_ddl
    assert "tenant_id VARCHAR(128)" in documents_ddl
    assert (
        PERSISTENT_TEXT_SPECS["inquiry_bundle_deletion_audit_events.journey_id"].proposed_max_chars
        == 256
    )


def test_mssql_uses_varchar_max_and_portable_check_expressions() -> None:
    documents_ddl = str(
        CreateTable(Base.metadata.tables["documents"]).compile(dialect=mssql.dialect())
    )
    assert "payload_json VARCHAR(max)" in documents_ddl
    assert "tenant_id VARCHAR(128)" in documents_ddl
    assert portable_check_constraint_sql("length(trim(task)) > 0", "mssql") == (
        "len(trim(task)) > 0"
    )
    assert portable_check_constraint_sql("safe_mode IS TRUE", "mssql") == "safe_mode = 1"
    assert portable_check_constraint_sql("safe_mode IS TRUE", "postgresql") == ("safe_mode IS TRUE")


def test_oracle_uses_clob_and_omits_only_explicit_no_action() -> None:
    documents_ddl = str(
        CreateTable(Base.metadata.tables["documents"]).compile(dialect=oracle.dialect())
    )
    identities_ddl = str(
        CreateTable(Base.metadata.tables["user_identities"]).compile(dialect=oracle.dialect())
    )

    assert "payload_json CLOB" in documents_ddl
    assert "tenant_id VARCHAR2(128 CHAR)" in documents_ddl
    assert "NO ACTION" not in documents_ddl
    assert "ON DELETE CASCADE" in identities_ddl


def test_guest_admission_shapes_are_centrally_governed() -> None:
    assert GuestPrincipalRow.__table__.metadata is Base.metadata
    assert GuestDocumentGrantRow.__table__.metadata is Base.metadata
    expected = {
        "guest_principals.tenant_id": 128,
        "guest_principals.guest_principal_id": 128,
        "guest_principals.invited_email": 320,
        "guest_principals.verified_issuer": 512,
        "guest_principals.verified_subject": 512,
        "guest_document_grants.tenant_id": 128,
        "guest_document_grants.guest_principal_id": 128,
        "guest_document_grants.doc_id": 128,
    }
    for qualified_name, max_chars in expected.items():
        assert PERSISTENT_TEXT_SPECS[qualified_name].proposed_max_chars == max_chars
        table_name, column_name = qualified_name.split(".", 1)
        assert Base.metadata.tables[table_name].columns[column_name].type.length == max_chars


def test_guest_auth_session_shapes_are_centrally_governed() -> None:
    assert GuestAuthSessionRow.__table__.metadata is Base.metadata
    expected = {
        "guest_auth_sessions.session_key_hash": 256,
        "guest_auth_sessions.tenant_id": 128,
        "guest_auth_sessions.guest_principal_id": 128,
        "guest_auth_sessions.issuer": 512,
        "guest_auth_sessions.subject": 512,
    }
    for qualified_name, max_chars in expected.items():
        assert PERSISTENT_TEXT_SPECS[qualified_name].proposed_max_chars == max_chars
        table_name, column_name = qualified_name.split(".", 1)
        assert Base.metadata.tables[table_name].columns[column_name].type.length == max_chars


def test_agent_credential_shapes_are_centrally_governed() -> None:
    for model in (AgentCredentialRow, AgentDocumentGrantRow, AgentCredentialIndexRow):
        assert model.__table__.metadata is Base.metadata
    expected = {
        "agent_credentials.tenant_id": 128,
        "agent_credentials.agent_id": 128,
        "agent_credentials.created_by": 512,
        "agent_document_grants.doc_id": 128,
        "agent_credential_index.token_hash": 256,
    }
    for qualified_name, max_chars in expected.items():
        assert PERSISTENT_TEXT_SPECS[qualified_name].proposed_max_chars == max_chars
        table_name, column_name = qualified_name.split(".", 1)
        assert Base.metadata.tables[table_name].columns[column_name].type.length == max_chars
