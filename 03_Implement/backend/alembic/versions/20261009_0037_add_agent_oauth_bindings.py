"""add ADR-0094 agent OAuth bindings

Revision ID: 20261009_0037
Revises: 20261009_0036

検証済みのOAuth主体 (IdP登録簿のid, sub) から agent を引く索引を追加する。トークンの
検証後、tenantが確定する前に引くので、agent_credential_index と同じ理由でRLSを掛けない。
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
        sa.Column("identity_provider_id", sa.String(128), nullable=False),
        sa.Column("subject", sa.String(512), nullable=False),
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("agent_id", sa.String(128), nullable=False),
        sa.Column("created_by", sa.String(512), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.PrimaryKeyConstraint("identity_provider_id", "subject", name="pk_agent_oauth_bindings"),
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
