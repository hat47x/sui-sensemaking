"""Product-boundary tests for deterministic attention candidates (ADR-0090)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sui_sensemaking_api.attention_candidates import (
    ATTENTION_METHOD_ID,
    MAX_ATTENTION_CANDIDATES,
    MAX_ATTENTION_FOCUS_PAIRS,
    build_attention_ir,
)
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import DocumentV1
from sui_sensemaking_api.routes import ai
from sui_sensemaking_api.settings import settings


@pytest.fixture(autouse=True)
def _no_provider(monkeypatch: pytest.MonkeyPatch):
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("attention candidates must not call an LLM provider")

    monkeypatch.setattr(ai, "generate_with_fallback", fail_if_called)
    monkeypatch.setattr(settings, "allow_unreviewed_ai_text", False)


def _doc(
    *,
    held: str | None = None,
    edges: list[dict] | None = None,
    islands: list[dict] | None = None,
    affiliations: list[dict] | None = None,
) -> dict:
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
        **({"affiliations": affiliations} if affiliations is not None else {}),
        "evidenceLinks": [],
    }


def test_transitive_relation_exposes_attention_without_score_or_provider() -> None:
    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": _doc()})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body.pop("methodId") == ATTENTION_METHOD_ID
    source_digest = body.pop("sourceDigest")
    assert len(source_digest) == 64
    assert set(source_digest) <= set("0123456789abcdef")
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
        "complexitySuppressed": False,
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
        for index in range(1, 8)
    ]
    edges = [
        {
            "id": f"e{index:02d}",
            "fromId": f"c{index:02d}",
            "toId": f"c{index + 1:02d}",
            "type": "related",
        }
        for index in range(1, 7)
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
            {"id": "i-right", "cardIds": ["c04", "c05", "c06", "c07"], "title": "右側", "titleReviewed": True},
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
    assert len(candidates[0]["focusPairs"]) <= MAX_ATTENTION_FOCUS_PAIRS


def test_source_digest_tracks_candidate_relevant_projection() -> None:
    base = _doc()

    with TestClient(app) as client:
        first = client.post("/ai/suggest-attention-candidates", json={"doc": base})
        repeated = client.post("/ai/suggest-attention-candidates", json={"doc": base})

        moved = _doc()
        moved["cards"][0]["x"] = 999
        non_spatial_move = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": moved},
        )

        changed_text = _doc()
        changed_text["cards"][0]["text"] = "観察一を別の内容として確認する"
        text_edit = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": changed_text},
        )

        held = _doc(held="held")
        held_edit = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": held},
        )

        spatial_before = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": base, "includeSpatial": True},
        )
        spatial_after = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": moved, "includeSpatial": True},
        )

    responses = [
        first,
        repeated,
        non_spatial_move,
        text_edit,
        held_edit,
        spatial_before,
        spatial_after,
    ]
    assert all(response.status_code == 200 for response in responses)
    assert first.json()["sourceDigest"] == repeated.json()["sourceDigest"]
    assert first.json()["sourceDigest"] == non_spatial_move.json()["sourceDigest"]
    assert first.json()["sourceDigest"] == text_edit.json()["sourceDigest"]
    assert first.json()["sourceDigest"] != held_edit.json()["sourceDigest"]
    assert spatial_before.json()["sourceDigest"] != spatial_after.json()["sourceDigest"]


def test_truncated_projection_never_exposes_partial_candidates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    truncated_ir = {
        "ir_version": "1.2",
        "cards": [
            {"id": "c1", "text": "一", "text_norm": "一", "char_len": 1},
            {"id": "c2", "text": "二", "text_norm": "二", "char_len": 1},
            {"id": "c3", "text": "三", "text_norm": "三", "char_len": 1},
        ],
        "relations": [
            {"id": "related:c1:c2", "from": "c1", "to": "c2", "type": "related"},
            {"id": "related:c2:c3", "from": "c2", "to": "c3", "type": "related"},
        ],
        "islands": [
            {"id": "i12", "card_ids": ["c1", "c2"]},
            {"id": "i3", "card_ids": ["c3"]},
        ],
        "cluster_candidates": [
            {
                "cluster_id": "cc-partial",
                "card_ids": ["c1", "c2", "c3"],
                "basis": "relation",
                "score": 1.0,
            }
        ],
        "meta": {"doc_id": "attention-doc", "doc_version": 1},
        "truncation": {"truncated": True, "reason_codes": ["MAX_CARDS"]},
    }
    monkeypatch.setattr(ai, "build_attention_ir", lambda *_args, **_kwargs: truncated_ir)

    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": _doc()})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["truncated"] is True
    assert body["candidates"] == []


@pytest.mark.parametrize(
    ("candidate_count", "expected_visible", "expected_suppressed"),
    [
        (MAX_ATTENTION_CANDIDATES, MAX_ATTENTION_CANDIDATES, False),
        (MAX_ATTENTION_CANDIDATES + 1, 0, True),
    ],
)
def test_product_candidate_budget_is_all_or_none(
    monkeypatch: pytest.MonkeyPatch,
    candidate_count: int,
    expected_visible: int,
    expected_suppressed: bool,
) -> None:
    cards = []
    relations = []
    islands = []
    clusters = []
    for index in range(1, candidate_count + 1):
        a = f"g{index}-a"
        b = f"g{index}-b"
        c = f"g{index}-c"
        cards.extend(
            [
                {"id": a, "text": a, "text_norm": a, "char_len": len(a)},
                {"id": b, "text": b, "text_norm": b, "char_len": len(b)},
                {"id": c, "text": c, "text_norm": c, "char_len": len(c)},
            ]
        )
        relations.extend(
            [
                {"id": f"r{index}-ab", "from": a, "to": b, "type": "related"},
                {"id": f"r{index}-bc", "from": b, "to": c, "type": "related"},
            ]
        )
        islands.extend(
            [
                {"id": f"i{index}-ab", "card_ids": [a, b]},
                {"id": f"i{index}-c", "card_ids": [c]},
            ]
        )
        clusters.append(
            {
                "cluster_id": f"cc-{index:04d}",
                "card_ids": [a, b, c],
                "basis": "relation",
                "score": 1.0,
            }
        )

    candidate_ir = {
        "ir_version": "1.2",
        "cards": cards,
        "relations": relations,
        "islands": islands,
        "cluster_candidates": clusters,
        "meta": {"doc_id": "candidate-budget", "doc_version": 1},
        "truncation": {"truncated": False, "reason_codes": []},
    }
    monkeypatch.setattr(
        ai,
        "build_attention_ir",
        lambda *_args, **_kwargs: candidate_ir,
    )

    with TestClient(app) as client:
        response = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": _doc()},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["methodId"] == ATTENTION_METHOD_ID
    assert len(body["candidates"]) == expected_visible
    assert body["complexitySuppressed"] is expected_suppressed
    assert body["truncated"] is False


def test_attention_candidates_reject_overlapping_visual_island_membership() -> None:
    document = _doc(
        islands=[
            {
                "id": "i-left",
                "cardIds": ["c1", "c2"],
                "title": "左",
                "titleReviewed": True,
            },
            {
                "id": "i-right",
                "cardIds": ["c1", "c3"],
                "title": "右",
                "titleReviewed": True,
            },
        ]
    )

    with TestClient(app) as client:
        response = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": document},
        )

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "ambiguous_island_membership"
    assert "lossy projection" in detail["message"]


def test_cross_cutting_affiliation_is_preserved_without_duplicate_containment() -> None:
    document = _doc(
        islands=[
            {"id": "i-left", "cardIds": ["c1"], "title": "左", "titleReviewed": True},
            {"id": "i-right", "cardIds": ["c2"], "title": "右", "titleReviewed": True},
        ],
        affiliations=[
            {"id": "a1", "cardId": "c3", "islandId": "i-left"},
            {"id": "a2", "cardId": "c3", "islandId": "i-right"},
        ],
    )

    ir = build_attention_ir(DocumentV1.model_validate(document))

    assert ir["affiliations"] == [
        {"id": "a1", "card_id": "c3", "island_id": "i-left"},
        {"id": "a2", "card_id": "c3", "island_id": "i-right"},
    ]


def test_affiliation_prevents_reproposing_an_existing_human_group() -> None:
    document = _doc(
        affiliations=[
            {"id": "a-c3-i12", "cardId": "c3", "islandId": "i12"},
        ],
    )

    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": document})

    assert response.status_code == 200, response.text
    assert response.json()["methodId"] == ATTENTION_METHOD_ID
    assert response.json()["candidates"] == []


def test_affiliation_changes_attention_source_digest() -> None:
    with TestClient(app) as client:
        base = client.post("/ai/suggest-attention-candidates", json={"doc": _doc()})
        affiliated = client.post(
            "/ai/suggest-attention-candidates",
            json={
                "doc": _doc(
                    affiliations=[
                        {"id": "a-c3-i12", "cardId": "c3", "islandId": "i12"},
                    ]
                )
            },
        )

    assert base.status_code == 200
    assert affiliated.status_code == 200
    assert base.json()["sourceDigest"] != affiliated.json()["sourceDigest"]


def test_affiliation_identifier_does_not_change_attention_source_digest() -> None:
    first = _doc(
        affiliations=[
            {"id": "a-first", "cardId": "c3", "islandId": "i12"},
        ],
    )
    renamed = _doc(
        affiliations=[
            {"id": "a-renamed", "cardId": "c3", "islandId": "i12"},
        ],
    )

    with TestClient(app) as client:
        first_response = client.post("/ai/suggest-attention-candidates", json={"doc": first})
        renamed_response = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": renamed},
        )

    assert first_response.status_code == 200
    assert renamed_response.status_code == 200
    assert first_response.json()["sourceDigest"] == renamed_response.json()["sourceDigest"]

def test_invalid_affiliation_references_are_rejected_by_document_contract() -> None:
    document = _doc(
        affiliations=[
            {"id": "a-invalid", "cardId": "missing-card", "islandId": "missing-island"},
        ],
    )

    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": document})

    assert response.status_code == 422


def test_duplicate_affiliation_pair_is_rejected_by_document_contract() -> None:
    document = _doc(
        affiliations=[
            {"id": "a1", "cardId": "c3", "islandId": "i12"},
            {"id": "a2", "cardId": "c3", "islandId": "i12"},
        ],
    )

    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": document})

    assert response.status_code == 422

def test_affiliation_cannot_duplicate_visual_containment() -> None:
    document = _doc(
        affiliations=[
            {"id": "a-redundant", "cardId": "c1", "islandId": "i12"},
        ],
    )

    with TestClient(app) as client:
        response = client.post("/ai/suggest-attention-candidates", json={"doc": document})

    assert response.status_code == 422

def test_empty_affiliation_list_is_digest_equivalent_to_absence() -> None:
    absent = _doc()
    explicit_empty = _doc(affiliations=[])

    with TestClient(app) as client:
        absent_response = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": absent},
        )
        empty_response = client.post(
            "/ai/suggest-attention-candidates",
            json={"doc": explicit_empty},
        )

    assert absent_response.status_code == 200
    assert empty_response.status_code == 200
    assert absent_response.json()["sourceDigest"] == empty_response.json()["sourceDigest"]
