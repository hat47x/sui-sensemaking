"""0038: 書き換え前の 0037 を適用済みのDBでも、主キーに tenant_id が入る（冪等）。"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/20261012_0038_agent_oauth_bindings_tenant_key.py"
)


def _upgrade(engine: sa.Engine) -> None:
    spec = importlib.util.spec_from_file_location("migration_0038", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()


def _pk(engine: sa.Engine) -> list[str]:
    return sa.inspect(engine).get_pk_constraint("agent_oauth_bindings")["constrained_columns"]


def _create(engine: sa.Engine, *, primary_key: str) -> None:
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "CREATE TABLE agent_oauth_bindings ("
                "tenant_id VARCHAR(128) NOT NULL, identity_provider_id VARCHAR(128) NOT NULL, "
                "subject VARCHAR(512) NOT NULL, agent_id VARCHAR(128) NOT NULL, "
                "created_by VARCHAR(512) NOT NULL, created_at VARCHAR(40) NOT NULL, "
                f"CONSTRAINT pk_agent_oauth_bindings PRIMARY KEY ({primary_key}))"
            )
        )


def test_an_old_primary_key_is_rebuilt_with_the_tenant_and_keeps_rows() -> None:
    engine = sa.create_engine("sqlite://")
    _create(engine, primary_key="identity_provider_id, subject")
    with engine.begin() as connection:
        connection.execute(
            sa.text(
                "INSERT INTO agent_oauth_bindings VALUES ('t-a','idp','sub','agent','admin','2026')"
            )
        )

    _upgrade(engine)

    assert _pk(engine) == ["tenant_id", "identity_provider_id", "subject"]
    with engine.begin() as connection:  # 別 tenant が同じ (IdP, sub) を結べる
        connection.execute(
            sa.text(
                "INSERT INTO agent_oauth_bindings VALUES ('t-b','idp','sub','agent','admin','2026')"
            )
        )
        count = connection.execute(sa.text("SELECT count(*) FROM agent_oauth_bindings")).scalar()
    assert count == 2


def test_an_already_hardened_table_is_left_alone() -> None:
    engine = sa.create_engine("sqlite://")
    _create(engine, primary_key="tenant_id, identity_provider_id, subject")

    _upgrade(engine)

    assert _pk(engine) == ["tenant_id", "identity_provider_id", "subject"]
