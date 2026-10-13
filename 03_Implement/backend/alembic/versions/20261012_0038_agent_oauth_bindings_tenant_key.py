"""agent OAuth bindings: tenant を主キーに含める（適用済みDBの補正）

Revision ID: 20261012_0038
Revises: 20261009_0037

0037 は、レビューの反映で「主キーに tenant_id を含める」形へ書き換えた。書き換え前の 0037 を
すでに適用したDBには、旧い主キー (identity_provider_id, subject) が残る。その形では、別の
tenant が同じ (IdP, sub) を結ぶと競合して、存在の手掛かりと先取りによる妨害が生じる。
旧い主キーのときだけ、(tenant_id, identity_provider_id, subject) に作り直す（冪等）。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261012_0038"
down_revision: str | None = "20261009_0037"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "agent_oauth_bindings"
_PK_NAME = "pk_agent_oauth_bindings"


def upgrade() -> None:
    columns = sa.inspect(op.get_bind()).get_pk_constraint(_TABLE).get("constrained_columns") or []
    if "tenant_id" in columns:
        return
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_constraint(_PK_NAME, type_="primary")
        batch.create_primary_key(_PK_NAME, ["tenant_id", "identity_provider_id", "subject"])


def downgrade() -> None:
    # 旧い主キーは、tenant を跨ぐ競合を生むので、戻さない（0037 の形を保つ）。
    pass
