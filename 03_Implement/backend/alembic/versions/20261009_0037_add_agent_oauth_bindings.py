"""add ADR-0094 agent OAuth bindings

Revision ID: 20261009_0037
Revises: 20261009_0036

検証済みのOAuth主体を agent に結ぶ対応付けを追加する。キーは (tenant_id, IdP登録簿のid, sub)。
トークンの検証後、agentの状態を引く前に参照するので、RLSは掛けない（agent_credential_index と
同じ理由）。tenantは、トークンのclaimを tenant_identity_providers で確定した値を使う。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261009_0037"
down_revision: str | None = "20261009_0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "agent_oauth_bindings",
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("identity_provider_id", sa.String(128), nullable=False),
        sa.Column("subject", sa.String(512), nullable=False),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("created_by", sa.String(512), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.PrimaryKeyConstraint(
            "tenant_id", "identity_provider_id", "subject", name="pk_agent_oauth_bindings"
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agent_credentials.tenant_id", "agent_credentials.agent_id"],
            name="fk_agent_oauth_bindings_credential",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["identity_provider_id"],
            ["identity_providers.id"],
            name="fk_agent_oauth_bindings_identity_provider",
            ondelete="NO ACTION",
        ),
    )
    op.create_index(
        "ix_agent_oauth_bindings_agent",
        "agent_oauth_bindings",
        ["tenant_id", "agent_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_agent_oauth_bindings_agent", table_name="agent_oauth_bindings")
    op.drop_table("agent_oauth_bindings")
