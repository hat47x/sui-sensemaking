from __future__ import annotations

import json
from pathlib import Path

from scripts.measure_cognitive_candidate_novelty import (
    DEFAULT_FIXTURE,
    MEASUREMENT_ID,
    measure_document,
    sha256_bytes,
)
from sui_sensemaking_api.models import DocumentV1


def test_synthetic_fixture_exposes_cross_island_structure_without_scores_or_text() -> None:
    raw = DEFAULT_FIXTURE.read_bytes()
    document = DocumentV1.model_validate_json(raw)

    result = measure_document(
        document,
        source_sha256=sha256_bytes(raw),
        include_spatial=False,
    )

    assert result["measurement"] == MEASUREMENT_ID
    assert result["source"]["documentId"] == "doc_ai_eval_kj"
    assert result["mode"] == {
        "includeSpatial": False,
        "providerCalled": False,
        "cardTextEmitted": False,
        "internalScoreEmitted": False,
    }
    assert result["projection"] == {
        "truncated": False,
        "reasonCodes": [],
    }
    assert result["summary"] == {
        "candidateCount": 2,
        "exactExistingIslandCandidateCount": 0,
        "crossIslandCandidateCount": 2,
        "candidatesWithNovelCoMembershipCount": 2,
        "novelCoMembershipPairCount": 8,
    }

    by_cards = {
        tuple(item["cardIds"]): item
        for item in result["candidates"]
    }
    first = by_cards[("c01", "c02", "c03", "c10")]
    assert first["basis"] == "relation"
    assert first["touchedExistingIslandIds"] == ["i1", "i4"]
    assert first["crossesExistingIslandBoundary"] is True
    assert len(first["novelCoMembershipPairs"]) == 3

    second = by_cards[("c04", "c06", "c09", "c12")]
    assert second["touchedExistingIslandIds"] == ["i2", "i3", "i4"]
    assert len(second["novelCoMembershipPairs"]) == 5

    serialized = json.dumps(result, ensure_ascii=False)
    assert '"score"' not in serialized
    for card in document.cards:
        assert card.text not in serialized


def test_candidate_equal_to_existing_island_is_not_structurally_novel() -> None:
    value = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
    value["edges"] = [
        {"id": "r1", "fromId": "c01", "toId": "c02", "type": "related"},
        {"id": "r2", "fromId": "c02", "toId": "c03", "type": "related"},
    ]
    document = DocumentV1.model_validate(value)

    result = measure_document(
        document,
        source_sha256="synthetic",
        include_spatial=False,
    )

    assert result["summary"]["candidateCount"] == 1
    candidate = result["candidates"][0]
    assert candidate["cardIds"] == ["c01", "c02", "c03"]
    assert candidate["exactExistingIslandIds"] == ["i1"]
    assert candidate["containingExistingIslandIds"] == ["i1"]
    assert candidate["crossesExistingIslandBoundary"] is False
    assert candidate["novelCoMembershipPairs"] == []
