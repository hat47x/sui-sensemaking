"""add server-verified roles to users (SEC-AUTH-ATTRIB-01)

Revision ID: 20260815_0029
Revises: 20260815_0028

`users.roles`（カンマ区切りのロール識別子）を追加。admin provisioning が
この列へ書き込み、identity 解決がここから読み出す — クライアントヘッダ由来
ではないserver-verifiedな認可属性（SEC-AUTH-ATTRIB-01 D-a）。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260815_0029"
down_revision: str | None = "20260815_0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("roles", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "roles")
