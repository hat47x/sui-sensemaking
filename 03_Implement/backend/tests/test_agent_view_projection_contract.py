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


def test_agent_view_does_not_return_contradiction_state() -> None:
    """人が付けた確認状態 `contradictionState` は、agent向けの文書表示に出さない（ADR-0104、#3418）。"""
    data = _load()
    sources = [link for link in data["source"]["evidenceLinks"] if "contradictionState" in link]
    assert sources, "fixtureに contradictionState を持つ根拠リンクが必要"
    for link in data["agentView"]["evidenceLinks"]:
        assert "contradictionState" not in link


def test_agent_view_drops_unreviewed_island_title_key() -> None:
    """未レビューの題名と題名なしの島は、どちらも `title` キーを持たない（MCP投影では「(無題)」になる）。"""
    islands = {island["id"]: island for island in _load()["agentView"]["islands"]}
    assert "title" not in islands["i-unreviewed"]
    assert "title" not in islands["i-untitled"]
    assert islands["i-reviewed"]["title"] == "reviewed island title"


def test_agent_view_does_not_contain_secret_values() -> None:
    assert "SECRET-" not in json.dumps(_load()["agentView"])


def test_agent_view_drops_edges_with_island_endpoints() -> None:
    """島を端点とする関係線は、agent向けの文書表示に出さない（#3402、方針B）。

    島のidは `islands` に残るが、島と島、カードと島を結ぶ関係線は返さない。方針を変える
    場合は、api.md、mcp_agent_connection.md、mcp/README.md と、フロントエンドの
    `context_bundle_projection.test.ts` を同時に改める。
    """
    source = {
        "version": 1,
        "id": "doc_island_edges",
        "cards": [
            {"id": "c1", "text": "one", "x": 0, "y": 0, "textReviewed": True},
            {"id": "c2", "text": "two", "x": 1, "y": 0, "textReviewed": True},
        ],
        "edges": [
            {"id": "e1", "fromId": "c1", "toId": "c2", "type": "related"},
            {"id": "e-ii", "fromId": "i1", "toId": "i2", "fromKind": "island", "toKind": "island", "type": "related"},
            {"id": "e-ci", "fromId": "c1", "toId": "i2", "fromKind": "card", "toKind": "island", "type": "related"},
            {"id": "e-ic", "fromId": "i1", "toId": "c2", "fromKind": "island", "toKind": "card", "type": "related"},
        ],
        "islands": [
            {"id": "i1", "cardIds": ["c1"], "titleReviewed": True, "title": "A"},
            {"id": "i2", "cardIds": ["c2"], "titleReviewed": True, "title": "B"},
        ],
    }
    view = _agent_document_view(source)
    assert [edge["id"] for edge in view["edges"]] == ["e1"]
    assert [island["id"] for island in view["islands"]] == ["i1", "i2"]
