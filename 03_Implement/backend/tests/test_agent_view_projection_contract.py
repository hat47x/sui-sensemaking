"""agent向け文書の許可リスト出力を、MCP側の契約テストと共有する固定ファイルで確かめる（#3277）。

`mcp/src/fixtures/agent_view_contract.json` の `agentView` は、`source` を `_agent_document_view`
に通した結果である。MCPの `context_projection_digest_contract.test.ts` は同じファイルを
入力に使う。バックエンドの許可リストが変わると、このテストが落ちる。そのときは固定ファイルを
作り直し、MCP側の期待値（島の題名など）を確認する。
"""

from __future__ import annotations

import json
from pathlib import Path

from sui_sensemaking_api.routes.docs import _agent_document_view

FIXTURE = (
    Path(__file__).resolve().parents[2] / "mcp" / "src" / "fixtures" / "agent_view_contract.json"
)


def _load() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_agent_view_matches_shared_fixture() -> None:
    data = _load()
    assert _agent_document_view(data["source"]) == data["agentView"]


def test_agent_view_drops_unreviewed_island_title_key() -> None:
    """未レビューの題名と題名なしの島は、どちらも `title` キーを持たない（MCP投影では「(無題)」になる）。"""
    islands = {island["id"]: island for island in _load()["agentView"]["islands"]}
    assert "title" not in islands["i-unreviewed"]
    assert "title" not in islands["i-untitled"]
    assert islands["i-reviewed"]["title"] == "reviewed island title"


def test_agent_view_does_not_contain_secret_values() -> None:
    assert "SECRET-" not in json.dumps(_load()["agentView"])
