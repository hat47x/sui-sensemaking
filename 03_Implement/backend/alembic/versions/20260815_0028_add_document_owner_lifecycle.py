"""add document creator and lifecycle state (ADR-0073 D1=C / D2=A / D3=A)

Revision ID: 20260815_0028
Revises: 20260813_0027

第2反復（作業の器）の起点として、`documents` に作成者とライフサイクル状態を足す。
- `created_by`（nullable、不変事実。既存文書は D3=A で NULL = 「不明」のまま）
- `lifecycle_state`（既定 active、active/archived のみ。ADR-0033 の削除UI非標準と整合）

作成者・ライフサイクルは payloadから推測しない（server-owned列）。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260815_0028"
down_revision: str | None = "20260813_0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("created_by", sa.Text(), nullable=True))
    op.add_column(
        "documents",
        sa.Column(
            "lifecycle_state",
            # Bounded (PERSISTENT_TEXT_SPECS: 16) so MySQL accepts the
            # server_default -- a TEXT column cannot have a DEFAULT there.
            sa.String(length=16),
            nullable=False,
            server_default="active",
        ),
    )


def downgrade() -> None:
    # lifecycle_state carries a server_default; on SQL Server the default
    # constraint must be dropped before the column (see 0014 pattern).
    op.drop_column("documents", "lifecycle_state", mssql_drop_default=True)
    op.drop_column("documents", "created_by")
