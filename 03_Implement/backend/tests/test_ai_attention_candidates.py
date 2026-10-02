"""Product-boundary tests for deterministic attention candidates (ADR-0090)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sui_sensemaking_api.main import app
from sui_sensemaking_api.routes import ai
from sui_sensemaking_api.settings import settings


@pytest.fixture(autouse=True)
def _no_provider(monkeypatch: pytest.MonkeyPatch):
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("attention candidates must not call an LLM provider")

    monkeypatch.setattr(ai, "generate_with_fallback", fail_if_called)
    monkeypatch.setattr(settings, "allow_unreviewed_ai_text", False)


def _doc(*, held: str | None = None, edges: list[dict] | None = None, islands: list[dict] | None = None) -> dict:
    cards = [
        {"id": "c1", "text": "観察一を確認する", "x": 0, "y": 0, "textReviewed": True},
        {"id": "c2", "text": "観察二を確認する", "x": 10, "y": 0, "textReviewed": True},
        {"id": "c3", "text": "観察三を確認する", "x": 20, "y": 0, "textReviewed": True},
        {"id": "c4", "text": "観察四を確認する", "x": 30, "y": 0, "textReviewed": True},
    ]
    if held is not None:
        cards[2]["holdState"] = held
    return {
        "version": 1,
        "id": "attention-doc",
        "createdAt": "2026-10-02T00:00:00Z",
        "updatedAt": "2026-10-02T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": cards,
        "edges": edges if edges is not None else [
            {"id": "e12", "fromId": "c1", "toId": "c2", "type": "related"},
            {"id": "e23", "fromId": "c2", "toId": "c3", "type": "related"},
        ],
        "islands": islands if islands is not None else [
            {"id": "i12", "cardIds": ["c1", "c2"], "title": "既存の島", "titleReviewed": True},
            {"id": "i3", "cardIds": ["c3"], "title": "別の島", "titleReviewed": True},
        ],
        "evidenceLinks": [],
    }


def test_transitive_relation_exposes_attention_without_score_or_provider() -> None:
    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": _doc()})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "candidates": [
            {
                "candidateId": "cc-0001",
                "cardIds": ["c1", "c2", "c3"],
                "focusPairs": [["c1", "c3"]],
                "basis": "relation",
                "cue": "indirect_relation",
            }
        ],
        "excludedCardIds": [],
        "truncated": False,
    }
    assert "score" not in response.text


def test_direct_relation_that_only_repeats_existing_structure_is_suppressed() -> None:
    doc = _doc(
        edges=[{"id": "e12", "fromId": "c1", "toId": "c2", "type": "related"}],
        islands=[
            {"id": "i12", "cardIds": ["c1", "c2"], "title": "既存の島", "titleReviewed": True}
        ],
    )
    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": doc})

    assert response.status_code == 200, response.text
    assert response.json()["candidates"] == []


@pytest.mark.parametrize("state", ["held", "pending", "shelved"])
def test_human_hold_suppresses_candidate(state: str) -> None:
    with TestClient(app) as client:
        response = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": _doc(held=state)},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["candidates"] == []
    assert body["excludedCardIds"] == ["c3"]


def test_unreviewed_text_stays_fail_closed() -> None:
    doc = _doc()
    doc["cards"][0]["textReviewed"] = False
    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": doc})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unreviewed_text_not_allowed"


def test_large_relation_component_fails_quiet_instead_of_dumping_pair_explosion() -> None:
    cards = [
        {
            "id": f"c{index:02d}",
            "text": f"観察{index:02d}を確認する",
            "x": index * 10,
            "y": 0,
            "textReviewed": True,
        }
        for index in range(1, 7)
    ]
    edges = [
        {
            "id": f"e{index:02d}",
            "fromId": f"c{index:02d}",
            "toId": f"c{index + 1:02d}",
            "type": "related",
        }
        for index in range(1, 6)
    ]
    doc = {
        "version": 1,
        "id": "attention-large-component",
        "createdAt": "2026-10-02T00:00:00Z",
        "updatedAt": "2026-10-02T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": cards,
        "edges": edges,
        "islands": [
            {"id": "i-left", "cardIds": ["c01", "c02", "c03"], "title": "左側", "titleReviewed": True},
            {"id": "i-right", "cardIds": ["c04", "c05", "c06"], "title": "右側", "titleReviewed": True},
        ],
        "evidenceLinks": [],
    }

    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": doc})

    assert response.status_code == 200, response.text
    assert response.json()["candidates"] == []


def test_focus_pair_budget_keeps_small_actionable_candidate_visible() -> None:
    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": _doc()})

    assert response.status_code == 200, response.text
    candidates = response.json()["candidates"]
    assert len(candidates) == 1
    assert len(candidates[0]["focusPairs"]) <= ai.MAX_ATTENTION_FOCUS_PAIRS
