"""add ADR-0093 agent credentials

Revision ID: 20261009_0036
Revises: 20260907_0035

外部agentの資格情報と、明示した文書への読み取り付与を追加する。tenant従属の2表は
同じmigrationでRLSを有効にし、tenantガードの外に新しい表が載らないようにする。
トークンのハッシュ索引はtenant確定前に引くため、guest_auth_sessionsと同様にRLSを掛けない。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261009_0036"
down_revision: str | None = "20260907_0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enable_rls(table_name: str, policy_name: str) -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(sa.text(f'ALTER TABLE "{table_name}" ENABLE ROW LEVEL SECURITY'))
    op.execute(sa.text(f'ALTER TABLE "{table_name}" FORCE ROW LEVEL SECURITY'))
    op.execute(
        sa.text(
            f'CREATE POLICY "{policy_name}" ON "{table_name}" '
            "USING (tenant_id = NULLIF(current_setting('sui_sensemaking.tenant_id', true), '')) "
            "WITH CHECK (tenant_id = NULLIF(current_setting('sui_sensemaking.tenant_id', true), ''))"
        )
    )


def upgrade() -> None:
    op.create_table(
        "agent_credentials",
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("label", sa.String(256), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("credential_version", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(512), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
        sa.Column("revoked_at", sa.String(40), nullable=True),
        sa.PrimaryKeyConstraint("tenant_id", "agent_id", name="pk_agent_credentials"),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            name="fk_agent_credentials_tenant",
            ondelete="NO ACTION",
        ),
        sa.CheckConstraint("status IN ('active', 'revoked')", name="ck_agent_credentials_status"),
        sa.CheckConstraint(
            "(status = 'active' AND revoked_at IS NULL) OR "
            "(status = 'revoked' AND revoked_at IS NOT NULL)",
            name="ck_agent_credentials_lifecycle_shape",
        ),
    )
    op.create_table(
        "agent_document_grants",
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("doc_id", sa.String(128), nullable=False),
        sa.Column("granted_by", sa.String(512), nullable=False),
        sa.Column("granted_at", sa.String(40), nullable=False),
        sa.Column("revoked_at", sa.String(40), nullable=True),
        sa.PrimaryKeyConstraint("tenant_id", "agent_id", "doc_id", name="pk_agent_document_grants"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agent_credentials.tenant_id", "agent_credentials.agent_id"],
            name="fk_agent_document_grants_credential",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_agent_document_grants_document",
            ondelete="CASCADE",
        ),
    )
    op.create_table(
        "agent_credential_index",
        sa.Column("token_hash", sa.String(256), nullable=False),
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("credential_version", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("token_hash", name="pk_agent_credential_index"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agent_credentials.tenant_id", "agent_credentials.agent_id"],
            name="fk_agent_credential_index_credential",
            ondelete="CASCADE",
        ),
    )
    _enable_rls("agent_credentials", "agent_credentials_tenant_isolation")
    _enable_rls("agent_document_grants", "agent_document_grants_tenant_isolation")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            sa.text(
                "DROP POLICY IF EXISTS agent_document_grants_tenant_isolation "
                "ON agent_document_grants"
            )
        )
        op.execute(
            sa.text("DROP POLICY IF EXISTS agent_credentials_tenant_isolation ON agent_credentials")
        )
    op.drop_table("agent_credential_index")
    op.drop_table("agent_document_grants")
    op.drop_table("agent_credentials")
