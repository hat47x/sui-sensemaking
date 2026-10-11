from __future__ import annotations

from copy import deepcopy
from math import inf, nan

import pytest

from sui_sensemaking_api.card_move_command import InvalidCardMove, apply_card_move
from sui_sensemaking_api.models import DocumentV1


def sample() -> DocumentV1:
    return DocumentV1.model_validate({
        "version": 1, "id": "doc", "createdAt": "2026-10-10T00:00:00Z",
        "updatedAt": "2026-10-10T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {"id": "a", "text": "source", "x": 0, "y": 0,
             "meta": {"source": "interview-1"}, "holdState": "held"},
            {"id": "b", "text": "target", "x": 400, "y": 0, "textReviewed": True},
        ],
        "edges": [{"id": "unknown", "fromId": "a", "toId": "b",
                   "type": "future-edge-kind"}],
        "islands": [{"id": "old", "cardIds": ["a"]},
                    {"id": "new", "cardIds": ["b"]}],
        "affiliations": [{"id": "association", "cardId": "b", "islandId": "old"}],
    })


def test_move_is_immutable_and_keeps_unrelated_data() -> None:
    before = sample()
    after = apply_card_move(before, card_id="a", x=400, y=0)
    assert before.cards[0].x == 0
    assert before.islands[0].cardIds == ["a"]
    assert after.cards[0].x == 400
    assert [i.cardIds for i in after.islands] == [[], ["b", "a"]]
    assert after.cards[0].holdState == "held"
    assert after.cards[0].meta.source == "interview-1"
    assert after.cards[1] == before.cards[1]
    assert after.edges == before.edges
    assert after.affiliations == before.affiliations
    assert after.updatedAt > before.updatedAt


def test_polygon_bounds_match_native_canvas_selection() -> None:
    document = sample()
    document.islands[1].geometry = None
    document.islands[1].shape = None
    from sui_sensemaking_api.models import IslandGeometry
    document.islands[1].geometry = IslandGeometry.model_validate({
        "type": "polygon", "points": [
            {"x": 380, "y": -40}, {"x": 600, "y": -40},
            {"x": 600, "y": 120}, {"x": 380, "y": 120},
        ]
    })
    next_doc = apply_card_move(document, card_id="a", x=400, y=0)
    assert next_doc.islands[1].cardIds == ["b", "a"]


@pytest.mark.parametrize("x,y", [(nan, 0), (inf, 0), (0, -inf)])
def test_nonfinite_target_is_rejected(x: float, y: float) -> None:
    with pytest.raises(InvalidCardMove):
        apply_card_move(sample(), card_id="a", x=x, y=y)


def test_unknown_card_and_noop_are_rejected() -> None:
    for card, x in [("missing", 5), ("a", 0)]:
        with pytest.raises(InvalidCardMove):
            apply_card_move(sample(), card_id=card, x=x, y=0)


def test_duplicate_card_and_island_identity_are_rejected() -> None:
    original = sample()
    duplicate_card = original.model_copy(deep=True)
    duplicate_card.cards.append(duplicate_card.cards[0].model_copy(deep=True))
    with pytest.raises(InvalidCardMove):
        apply_card_move(duplicate_card, card_id="a", x=400, y=0)
    duplicate_island = original.model_copy(deep=True)
    duplicate_island.islands[1].id = duplicate_island.islands[0].id
    with pytest.raises(InvalidCardMove):
        apply_card_move(duplicate_island, card_id="a", x=400, y=0)


def test_affiliation_conflict_fails_without_deleting_provenance() -> None:
    original = sample()
    original.affiliations = [
        original.affiliations[0].model_copy(update={"cardId": "a", "islandId": "new"})
    ]
    with pytest.raises(InvalidCardMove, match="affiliation"):
        apply_card_move(original, card_id="a", x=400, y=0)
    assert original.affiliations[0].islandId == "new"
    assert original.islands[0].cardIds == ["a"]


def test_motion_without_island_join_preserves_membership() -> None:
    original = sample()
    after = apply_card_move(original, card_id="a", x=5, y=0)
    assert [i.cardIds for i in after.islands] == [["a"], ["b"]]


def test_all_input_document_fields_are_retained() -> None:
    original = sample()
    original.title = "inquiry"
    original.readingOrder = ["a", "b"]
    after = apply_card_move(original, card_id="a", x=20, y=30)
    assert after.title == "inquiry"
    assert after.readingOrder == ["a", "b"]
    assert after.transform == original.transform
    assert after.cards[0].text == original.cards[0].text

def test_cross_runtime_parity_fixture_matches_server_command() -> None:
    """The TS native-drag test reads the same fixture (snap is UI-owned)."""
    import json
    from pathlib import Path

    fixture_path = (
        Path(__file__).resolve().parents[2] /
        "frontend/src/domain/fixtures/card_move_parity_v1.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    assert fixture["schemaVersion"] == "sui-card-move-parity-v1"
    for case in fixture["cases"]:
        raw = deepcopy(fixture["document"])
        if points := case.get("newIslandPolygon"):
            raw["islands"][1]["shape"] = {"kind": "polygon", "points": points}
        before = DocumentV1.model_validate(raw)
        result = apply_card_move(
            before, card_id="a", x=case["expectedX"], y=case["expectedY"]
        )
        assert result.cards[0].x == case["expectedX"], case["name"]
        assert result.cards[0].y == case["expectedY"], case["name"]
        assert [island.cardIds for island in result.islands] == case["expectedIslands"], case["name"]
        assert result.edges == before.edges, case["name"]
        assert result.affiliations == before.affiliations, case["name"]
        assert result.cards[0].holdState == before.cards[0].holdState
        assert result.cards[0].meta == before.cards[0].meta
