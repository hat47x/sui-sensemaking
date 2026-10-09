"""ADR-0093: agent資格情報の表が、PostgreSQLのFORCE RLSでtenantごとに閉じていること。

実行には、migration所有者とは別の、superuserでもBYPASSRLSでもない実行用ロールが要る
（README「テナントRLSの実地のテスト行列」と同じ前提）。
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from sui_sensemaking_api.agent_credential_models import (  # noqa: F401
    AgentCredentialIndexRow,
    AgentCredentialRow,
    AgentDocumentGrantRow,
)
from sui_sensemaking_api.agent_credentials import AgentCredentialRepository, derive_agent_token_hash
from sui_sensemaking_api.db import _normalize_database_url
from sui_sensemaking_api.models import DocumentRow, TenantRow
from sui_sensemaking_api.tenant_db_guard import apply_database_tenant_id

RUN_RLS_TESTS_ENV = "SUI_RUN_PG_RLS_TESTS"
ADMIN_DATABASE_URL_ENV = "SUI_DATABASE_URL"
RUNTIME_DATABASE_URL_ENV = "SUI_TEST_POSTGRES_RUNTIME_DATABASE_URL"
BACKEND_DIR = Path(__file__).resolve().parents[1]
TS = "2026-10-09T12:00:00Z"
HASH_KEY = b"agent-credential-rls-test-key-01234"


@pytest.fixture(scope="module")
def postgres_agent_engines() -> Iterator[tuple[Engine, Engine]]:
    if os.getenv(RUN_RLS_TESTS_ENV) != "1":
        pytest.skip(f"set {RUN_RLS_TESTS_ENV}=1 to exercise PostgreSQL agent credential RLS")
    admin_url = os.getenv(ADMIN_DATABASE_URL_ENV, "")
    runtime_url = os.getenv(RUNTIME_DATABASE_URL_ENV, "")
    if not admin_url.startswith("postgresql") or not runtime_url.startswith("postgresql"):
        pytest.fail("agent credential RLS verification requires PostgreSQL admin and runtime URLs")
    if admin_url == runtime_url:
        pytest.fail("agent credential RLS verification requires distinct admin/runtime credentials")

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
        _normalize_database_url(runtime_url), pool_size=1, max_overflow=0
    )
    try:
        with runtime_engine.connect() as connection:
            posture = connection.execute(
                text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
            ).one()
            assert posture.rolsuper is False
            assert posture.rolbypassrls is False
        yield admin_engine, runtime_engine
    finally:
        runtime_engine.dispose()
        admin_engine.dispose()


def _seed(admin_engine: Engine, suffix: str) -> dict[str, str]:
    """tenant A/B に同名の文書を作り、それぞれにagentを登録して、生トークンを返す。"""
    tokens: dict[str, str] = {}
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(days=1)).isoformat()
    with Session(admin_engine) as db:
        for tenant in ("a", "b"):
            db.add(
                TenantRow(
                    id=f"agent-{tenant}-{suffix}",
                    display_name=tenant,
                    lifecycle_state="active",
                    created_at=TS,
                    updated_at=TS,
                )
            )
        db.commit()
    for tenant in ("a", "b"):
        tenant_id = f"agent-{tenant}-{suffix}"
        with Session(admin_engine) as db:
            apply_database_tenant_id(db=db, tenant_id=tenant_id)
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id="shared-doc",
                    version=1,
                    updated_at=TS,
                    payload_json="{}",
                )
            )
            db.flush()
            tokens[tenant] = AgentCredentialRepository(db, tenant_id=tenant_id).register(
                agent_id=f"agent-{tenant}",
                label=tenant,
                created_by="admin",
                expires_at=expires,
                doc_ids=("shared-doc",),
                hash_key=HASH_KEY,
                now=now,
            )
            db.commit()
    return tokens


@pytest.mark.postgres
def test_agent_tables_are_forced_rls_and_fail_closed_without_context(
    postgres_agent_engines: tuple[Engine, Engine],
) -> None:
    admin_engine, runtime_engine = postgres_agent_engines
    protected = ("agent_credentials", "agent_document_grants")
    with admin_engine.connect() as connection:
        posture = {
            row.relname: (row.relrowsecurity, row.relforcerowsecurity)
            for row in connection.execute(
                text(
                    "SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity "
                    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname = 'public' AND c.relname IN "
                    "('agent_credentials', 'agent_document_grants', 'agent_credential_index')"
                )
            )
        }
    assert set(posture) == {*protected, "agent_credential_index"}
    assert all(posture[name] == (True, True) for name in protected)
    # 索引表はtenant確定前に引くためRLSを掛けない。ただし値はハッシュだけを持つ。
    assert posture["agent_credential_index"] == (False, False)

    suffix = uuid4().hex
    _seed(admin_engine, suffix)
    with runtime_engine.connect() as connection:
        for table in protected:
            assert connection.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0


@pytest.mark.postgres
def test_agent_rows_are_tenant_isolated_and_cross_tenant_write_is_blocked(
    postgres_agent_engines: tuple[Engine, Engine],
) -> None:
    admin_engine, runtime_engine = postgres_agent_engines
    suffix = uuid4().hex
    tokens = _seed(admin_engine, suffix)
    tenant_a, tenant_b = f"agent-a-{suffix}", f"agent-b-{suffix}"

    with Session(runtime_engine) as db:
        # tenant確定前の索引だけが、トークンのハッシュから引ける。
        index = db.get(AgentCredentialIndexRow, derive_agent_token_hash(tokens["a"], key=HASH_KEY))
        assert index is not None and index.tenant_id == tenant_a

        apply_database_tenant_id(db=db, tenant_id=tenant_a)
        assert db.get(AgentCredentialRow, (tenant_a, "agent-a")) is not None
        assert db.get(AgentCredentialRow, (tenant_b, "agent-b")) is None
        repo_a = AgentCredentialRepository(db, tenant_id=tenant_a)
        assert repo_a.can_read_document(agent_id="agent-a", doc_id="shared-doc") is True
        assert repo_a.list_readable_document_ids(agent_id="agent-a") == ("shared-doc",)
        # 同じdocIdでも、tenant Aの範囲ではBのagentの付与は見えない。
        assert repo_a.can_read_document(agent_id="agent-b", doc_id="shared-doc") is False
        db.rollback()

    with Session(runtime_engine) as db:
        apply_database_tenant_id(db=db, tenant_id=tenant_a)
        with pytest.raises(SQLAlchemyError):
            db.add(
                AgentDocumentGrantRow(
                    tenant_id=tenant_b,
                    agent_id="agent-b",
                    doc_id="shared-doc",
                    granted_by="attacker",
                    granted_at=TS,
                    revoked_at=None,
                )
            )
            db.flush()
        db.rollback()

    with Session(runtime_engine) as db:
        # 接続プールを再利用しても、前のtenantの設定が残らない。
        assert db.execute(text("SELECT count(*) FROM agent_credentials")).scalar_one() == 0
