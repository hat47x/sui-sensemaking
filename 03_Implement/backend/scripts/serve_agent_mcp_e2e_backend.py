#!/usr/bin/env python3
"""agent資格情報 x MCP実プロセスの結合検証（#3283）のための、使い捨てバックエンド。

`mcp/scripts/verify_agent_credential_e2e.ts` が子プロセスとして起動する。単独では使わない。

- 一時のSQLite（`SUI_DATABASE_URL`）に、テナントA/Bと合成の文書を作る。実在の資料は使わない。
- 本物のFastAPIアプリ（`sui_sensemaking_api.main.app`）をuvicornで、loopbackの空きポートに立てる。
- 管理APIの認証は、固定のテナント管理者（tenant-a）に差し替える。資格情報の登録・失効は、
  本物の `/tenant-admin/agent-credentials` をHTTPで呼ぶ。IdPやPostgresは使わない。
- 監査eventは、JSON Linesで一時ファイルへ書く。

標準出力の最初の行に `READY {"port": ..., "auditLog": ...}` を出す。標準入力が閉じられたら終了する。

使い方（backendで。PYTHONPATH=src が要る）:
    python scripts/serve_agent_mcp_e2e_backend.py --workdir <空のディレクトリ>
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

TIMESTAMP = "2026-10-09T00:00:00Z"
HASH_KEY = bytes.fromhex("cd" * 32)

REVIEWED_ISLAND_TITLE = "E2E-REVIEWED-ISLAND-TITLE"
SECRET_PREFIX = "E2E-SECRET-"


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _document_payload(doc_id: str, *, rich: bool) -> str:
    body: dict[str, object] = {
        "version": 1,
        "id": doc_id,
        "title": f"{SECRET_PREFIX}DOC-TITLE-{doc_id}",
        "createdAt": TIMESTAMP,
        "updatedAt": TIMESTAMP,
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [],
        "edges": [],
        "islands": [],
    }
    if rich:
        body["cards"] = [
            {"id": "c-reviewed", "text": "E2E-REVIEWED-TEXT", "x": 0, "y": 0, "textReviewed": True},
            {"id": "c-reviewed-2", "text": "E2E-REVIEWED-TEXT-2", "x": 1, "y": 0, "textReviewed": True},
            {"id": "c-unreviewed", "text": f"{SECRET_PREFIX}UNREVIEWED-TEXT", "x": 2, "y": 0, "textReviewed": False},
        ]
        body["islands"] = [
            {
                "id": "i-reviewed",
                "cardIds": ["c-reviewed", "c-reviewed-2"],
                "title": REVIEWED_ISLAND_TITLE,
                "titleReviewed": True,
                "summaryText": f"{SECRET_PREFIX}ISLAND-SUMMARY",
            },
            {
                "id": "i-unreviewed",
                "cardIds": ["c-unreviewed"],
                "title": f"{SECRET_PREFIX}UNREVIEWED-ISLAND-TITLE",
                "titleReviewed": False,
            },
        ]
        body["evidenceLinks"] = [
            {
                "id": "e-both-reviewed",
                "type": "supports",
                "fromCardId": "c-reviewed",
                "toCardId": "c-reviewed-2",
                "note": f"{SECRET_PREFIX}LINK-NOTE",
                "createdAt": TIMESTAMP,
            },
            {
                "id": "e-to-unreviewed",
                "type": "supports",
                "fromCardId": "c-reviewed",
                "toCardId": "c-unreviewed",
                "note": f"{SECRET_PREFIX}LINK-NOTE-2",
                "createdAt": TIMESTAMP,
            },
        ]
    return json.dumps(body)


def _seed(db) -> None:  # noqa: ANN001
    from sui_sensemaking_api.models import (
        DocumentRow,
        TenantMembershipRow,
        TenantRow,
        UserRow,
    )

    db.add(
        UserRow(
            id="admin-1",
            display_name="Admin",
            email="admin@example.invalid",
            lifecycle_state="active",
            created_at=TIMESTAMP,
            updated_at=TIMESTAMP,
        )
    )
    for tenant_id in ("tenant-a", "tenant-b"):
        db.add(
            TenantRow(
                id=tenant_id,
                display_name=tenant_id,
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            )
        )
        db.add(
            TenantMembershipRow(
                tenant_id=tenant_id,
                user_id="admin-1",
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            )
        )
    documents = (
        ("tenant-a", "doc-granted", True),
        ("tenant-a", "doc-ungranted", True),
        # テナントBに同じdocIdを置き、テナント越境で内容が混ざらないことを確かめる。
        ("tenant-b", "doc-granted", False),
        ("tenant-b", "doc-b-only", False),
    )
    for tenant_id, doc_id, rich in documents:
        db.add(
            DocumentRow(
                tenant_id=tenant_id,
                id=doc_id,
                version=1,
                updated_at=TIMESTAMP,
                payload_json=_document_payload(doc_id, rich=rich),
                created_by="owner",
                lifecycle_state="active",
            )
        )
    db.commit()


class _JsonlAuditDispatcher:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()

    def emit(self, event: object, *, dedup_key=None):  # noqa: ANN001, ARG002
        line = json.dumps(event.model_dump(mode="json"), ensure_ascii=False)  # type: ignore[attr-defined]
        with self._lock, self._path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workdir", required=True, help="一時のDBと監査ログを置く空のディレクトリ")
    args = parser.parse_args()
    workdir = Path(args.workdir).resolve()
    workdir.mkdir(parents=True, exist_ok=True)

    # アプリの読み込み前に、DBと動作の設定を決める。
    os.environ["SUI_DATABASE_URL"] = f"sqlite:///{(workdir / 'e2e.sqlite3').as_posix()}"
    os.environ["SUI_LLM_PROVIDER"] = "none"
    os.environ.pop("SUI_RUNTIME_PROFILE", None)

    import uvicorn
    from fastapi import Request

    from sui_sensemaking_api.access_control import AccessDecision, AccessRequest, AuthContext
    from sui_sensemaking_api.auth_context import ResolvedIdentity
    from sui_sensemaking_api.db import SessionLocal, engine
    from sui_sensemaking_api.main import app
    from sui_sensemaking_api.models import Base
    from sui_sensemaking_api.session_context import CapabilitySnapshot
    from sui_sensemaking_api.tenant_context import select_active_tenant_context

    @dataclass
    class _Identity:
        def resolve(self, *, db, request: Request) -> ResolvedIdentity:  # noqa: ANN001, ARG002
            return ResolvedIdentity(
                user_id="admin-1",
                reviewer_ref="user:admin-1",
                owner_ref="user:admin-1",
                auth_context=AuthContext(actor_ref="user:admin-1", user_id="admin-1", trace_id=None),
            )

    @dataclass
    class _Tenant:
        def resolve(self, *, db, user_id, claim=None):  # noqa: ANN001, ARG002
            return select_active_tenant_context(
                db=db, user_id=user_id or "", tenant_id="tenant-a", resolved_by="verified_claim"
            )

    @dataclass
    class _Capabilities:
        def resolve(self, *, db, principal_id, tenant):  # noqa: ANN001, ARG002
            return CapabilitySnapshot(
                effective_capabilities=("agent.register", "agent.revoke"), capability_version="v1"
            )

    class _AllowReadAdapter:
        """登録者の文書読み取り判定。外部PDPの代わりに、すべて許可する（判定の経路は通る）。"""

        name = "e2e-allow"

        def authorize(self, request: AccessRequest) -> AccessDecision:  # noqa: ARG002
            return AccessDecision(allow=True)

    class _SessionPersister:
        def current_version(self, **_: object) -> str:
            return "session-v1"

        def persist(self, **_: object) -> str:
            return "session-v2"

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 60
    while not server.started:
        if not thread.is_alive() or time.monotonic() > deadline:
            print("backend did not start", file=sys.stderr)
            return 1
        time.sleep(0.05)

    # lifespan が既定の部品を入れたあとで、結合検証用の部品へ差し替える
    # （test_agent_credential_admin_routes.py と同じ構成。実装の経路は変えない）。
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        _seed(db)
    audit_log = workdir / "audit.jsonl"
    app.state.runtime_profile = "saas-multitenant"
    app.state.saas_identity_context_resolver = _Identity()
    app.state.tenant_context_resolver = _Tenant()
    app.state.tenant_capability_resolver = _Capabilities()
    app.state.active_tenant_session_persister = _SessionPersister()
    app.state.agent_credential_hash_key = HASH_KEY
    app.state.access_control_adapter = _AllowReadAdapter()
    app.state.audit_dispatcher = _JsonlAuditDispatcher(audit_log)

    print("READY " + json.dumps({"port": port, "auditLog": str(audit_log)}), flush=True)
    try:
        sys.stdin.read()  # 親プロセスが閉じるまで待つ
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
