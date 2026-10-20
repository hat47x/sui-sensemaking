from __future__ import annotations

import pytest
from pydantic import ValidationError

from sui_sensemaking_api.models import Card, Island, StructureDecisionRecord


def _card_payload() -> dict[str, object]:
    return {
        "id": "c1",
        "text": "A",
        "x": 0,
        "y": 0,
        "critique": "later view",
        "critiqueTags": ["feels_off"],
        "critiqueHistory": [
            {
                "id": "critique-history-1",
                "createdAt": "2026-10-20T00:00:00Z",
                "fromCritique": "first doubt",
                "toCritique": "later view",
                "fromTags": ["no_articulable_reason"],
                "toTags": ["feels_off"],
                "changeKind": "manual",
                "note": "new material",
            }
        ],
    }


def test_card_critique_history_roundtrips() -> None:
    card = Card.model_validate(_card_payload())

    dumped = card.model_dump(mode="json", exclude_none=True)

    assert dumped["critiqueHistory"][0]["id"] == "critique-history-1"
    assert dumped["critiqueHistory"][0]["fromCritique"] == "first doubt"
    assert dumped["critiqueHistory"][0]["toTags"] == ["feels_off"]
    assert dumped["critiqueHistory"][0]["changeKind"] == "manual"
    assert dumped["critiqueHistory"][0]["note"] == "new material"


def test_island_critique_history_roundtrips() -> None:
    payload = {
        "id": "i1",
        "cardIds": ["c1"],
        "critique": "later island view",
        "critiqueTags": ["feels_off"],
        "critiqueHistory": _card_payload()["critiqueHistory"],
    }

    island = Island.model_validate(payload)

    dumped = island.model_dump(mode="json", exclude_none=True)
    assert dumped["critiqueHistory"][0]["id"] == "critique-history-1"
    assert dumped["critiqueHistory"][0]["toCritique"] == "later view"


def test_structure_decision_roundtrips() -> None:
    decision = StructureDecisionRecord.model_validate(
        {
            "id": "structure-1",
            "createdAt": "2026-10-21T00:00:00Z",
            "action": "hold_state_changed",
            "cardIds": ["c1"],
            "fromValue": "active",
            "toValue": "held",
            "rationale": "needs more evidence",
        }
    )

    dumped = decision.model_dump(mode="json", exclude_none=True)
    assert dumped["cardIds"] == ["c1"]
    assert dumped["fromValue"] == "active"
    assert dumped["toValue"] == "held"
    assert dumped["rationale"] == "needs more evidence"


def test_structure_decision_rejects_unknown_action_and_empty_cards() -> None:
    base = {
        "id": "structure-1",
        "createdAt": "2026-10-21T00:00:00Z",
        "action": "island_create",
        "cardIds": ["c1"],
    }

    with pytest.raises(ValidationError):
        StructureDecisionRecord.model_validate({**base, "action": "bogus"})
    with pytest.raises(ValidationError):
        StructureDecisionRecord.model_validate({**base, "cardIds": []})


@pytest.mark.parametrize(
    "mutate",
    [
        lambda entry: entry.update({"changeKind": "bogus"}),
        lambda entry: entry.update({"unknown": True}),
        lambda entry: entry.update({"createdAt": "not-a-date"}),
    ],
)
def test_card_critique_history_rejects_malformed_entries(mutate) -> None:
    payload = _card_payload()
    mutate(payload["critiqueHistory"][0])

    with pytest.raises(ValidationError):
        Card.model_validate(payload)
