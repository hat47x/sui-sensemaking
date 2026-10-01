from __future__ import annotations

import json

from scripts.measure_cognitive_candidate_novelty import DEFAULT_FIXTURE
from scripts.review_cognitive_candidate_t2 import (
    render_baseline,
    render_candidates,
)
from sui_sensemaking_api.models import DocumentV1


def _document() -> DocumentV1:
    return DocumentV1.model_validate_json(DEFAULT_FIXTURE.read_bytes())


def test_baseline_does_not_reveal_machine_candidates() -> None:
    document = _document()

    rendered = render_baseline(document)

    assert "# Cognitive T2 review — baseline" in rendered
    assert "## Current islands" in rendered
    assert "候補を見る前に" in rendered
    assert "cc-0001" not in rendered
    assert "indirectRegrouping" not in rendered


def test_candidate_phase_shows_text_without_score_or_ranking() -> None:
    document = _document()

    rendered = render_candidates(
        document,
        source_sha256="synthetic",
    )

    assert "# Cognitive T2 review — deterministic candidates" in rendered
    assert "cc-0001" in rendered
    assert "高齢者は一人で買い物に行けない" in rendered
    assert "直接relationでもない間接再構成" in rendered
    assert "score" not in rendered.lower()
    assert "rank" not in rendered.lower()
    assert "最適" not in rendered


def test_candidate_phase_excludes_held_cluster() -> None:
    value = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
    held = next(card for card in value["cards"] if card["id"] == "c10")
    held["holdState"] = "held"
    document = DocumentV1.model_validate(value)

    rendered = render_candidates(
        document,
        source_sha256="synthetic-held",
    )

    assert "c10:" not in rendered
    assert "c01:" not in rendered
    assert "c04:" in rendered


def test_baseline_marks_unassigned_hold_without_promoting_it() -> None:
    value = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
    held = next(card for card in value["cards"] if card["id"] == "c10")
    held["holdState"] = "pending"
    for island in value["islands"]:
        island["cardIds"] = [
            card_id
            for card_id in island["cardIds"]
            if card_id != "c10"
        ]
    document = DocumentV1.model_validate(value)

    rendered = render_baseline(document)

    assert "c10 [hold=pending]" in rendered
    assert "買い物弱者を支える仕組みが十分でない" in rendered
