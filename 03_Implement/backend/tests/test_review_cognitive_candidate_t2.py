from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from scripts.review_cognitive_candidate_t2 import (
    AttentionComplexityError,
    BaselineGateError,
    CandidateGateError,
    IncompleteAttentionProjectionError,
    PostObservationError,
    _baseline_receipt,
    _candidate_receipt,
    render_baseline,
    render_candidates,
    render_outcome,
    render_review,
)
from sui_sensemaking_api.attention_candidates import (
    ATTENTION_METHOD_ID,
    attention_candidates_from_ir,
    attention_source_digest,
    build_attention_ir,
)
from sui_sensemaking_api.models import DocumentV1


DEFAULT_FIXTURE = Path(__file__).parent / "fixtures" / "ai_eval_kj_document.json"


def _document() -> DocumentV1:
    return DocumentV1.model_validate_json(DEFAULT_FIXTURE.read_bytes())


def _gate(document: DocumentV1, source_sha256: str) -> tuple[str, bytes]:
    digest = attention_source_digest(build_attention_ir(document))
    return _baseline_receipt(source_sha256, digest), "事前判断を記録した".encode("utf-8")


def _sha256_for_test(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _post_observation(**overrides: object) -> bytes:
    value: dict[str, object] = {
        "attentionShift": {
            "assessment": "yes",
            "note": "候補なしでは見ていなかった材料へ注意が移った",
        },
        "structureReconsideration": {
            "assessment": "yes",
            "note": "既存の島分けを見直すきっかけになった",
        },
        "holdDissentPreserved": {
            "assessment": "yes",
            "note": "保留はそのまま残した",
        },
        "noiseOrNarrowing": {
            "assessment": "no",
            "note": "探索が狭まったとは感じなかった",
        },
        "counterfactualWithoutCandidate": {
            "assessment": "unlikely",
            "note": "候補なしでは同じ見直しに到達しにくかった",
        },
        "complexityBudget": {
            "assessment": "within",
            "note": "表示量と確認負荷は許容範囲だった",
        },
    }
    value.update(overrides)
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def test_baseline_does_not_reveal_machine_candidates() -> None:
    document = _document()

    rendered = render_baseline(document)

    assert "# Cognitive T2 review — baseline" in rendered
    assert "## Current islands" in rendered
    assert "候補を見る前に" in rendered
    assert "cc-0001" not in rendered
    assert "注目組:" not in rendered
    assert "indirect_relation" not in rendered


def test_two_phases_expose_the_same_source_digest() -> None:
    document = _document()

    baseline = render_review(
        document,
        phase="baseline",
        source_sha256="same-source",
    )
    receipt, observation = _gate(document, "same-source")
    assert f"Baseline receipt: {receipt}" in baseline
    candidates = render_review(
        document,
        phase="candidates",
        source_sha256="same-source",
        baseline_receipt=receipt,
        baseline_observation=observation,
    )

    assert "Source SHA-256: same-source" in baseline
    assert "Source SHA-256: same-source" in candidates
    digest = attention_source_digest(build_attention_ir(document))
    assert f"Attention methodId: {ATTENTION_METHOD_ID}" in baseline
    assert f"Attention methodId: {ATTENTION_METHOD_ID}" in candidates
    assert f"Attention sourceDigest: {digest}" in baseline
    assert f"Attention sourceDigest: {digest}" in candidates


def test_candidate_phase_shows_text_without_score_or_ranking() -> None:
    document = _document()

    receipt, observation = _gate(document, "synthetic")
    rendered = render_candidates(
        document,
        source_sha256="synthetic",
        baseline_receipt=receipt,
        baseline_observation=observation,
    )

    assert "# Cognitive T2 review — deterministic candidates" in rendered
    assert "cc-0002" in rendered
    assert "宅配サービスを利用する高齢者が増えている" in rendered
    assert "注目組: c04↔c09, c06↔c09" in rendered
    assert "score" not in rendered.lower()
    assert "rank" not in rendered.lower()
    assert "最適" not in rendered


def test_candidate_phase_excludes_held_cluster() -> None:
    value = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
    held = next(card for card in value["cards"] if card["id"] == "c09")
    held["holdState"] = "held"
    document = DocumentV1.model_validate(value)

    receipt, observation = _gate(document, "synthetic-held")
    rendered = render_candidates(
        document,
        source_sha256="synthetic-held",
        baseline_receipt=receipt,
        baseline_observation=observation,
    )

    assert "Eligible deterministic candidates: none" in rendered
    assert "c09:" not in rendered
    assert "Excluded hold card IDs: c09" in rendered


def test_baseline_marks_hold_inside_existing_island() -> None:
    value = json.loads(DEFAULT_FIXTURE.read_text(encoding="utf-8"))
    held = next(card for card in value["cards"] if card["id"] == "c10")
    held["holdState"] = "held"
    document = DocumentV1.model_validate(value)

    rendered = render_baseline(document)

    assert "c10 [hold=held]" in rendered
    assert "買い物弱者を支える仕組みが十分でない" in rendered


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


def test_candidate_phase_matches_product_candidate_contract() -> None:
    document = _document()
    ir = build_attention_ir(document)
    expected = attention_candidates_from_ir(ir)

    receipt, observation = _gate(document, "product-contract")
    rendered = render_candidates(
        document,
        source_sha256="product-contract",
        baseline_receipt=receipt,
        baseline_observation=observation,
    )

    assert expected
    for candidate in expected:
        assert candidate.candidateId in rendered
        assert candidate.cue in rendered
        for left, right in candidate.focusPairs:
            assert f"{left}↔{right}" in rendered


def test_t2_rejects_truncated_attention_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = _document()
    truncated_ir = build_attention_ir(document)
    truncated_ir["truncation"] = {
        "truncated": True,
        "reason_codes": ["MAX_CARDS"],
    }
    monkeypatch.setattr(
        "scripts.review_cognitive_candidate_t2.build_attention_ir",
        lambda _document: truncated_ir,
    )

    with pytest.raises(IncompleteAttentionProjectionError, match="MAX_CARDS"):
        render_baseline(document, source_sha256="truncated")

    with pytest.raises(IncompleteAttentionProjectionError, match="MAX_CARDS"):
        render_candidates(
            document,
            source_sha256="truncated",
            baseline_receipt=None,
            baseline_observation=None,
        )


def test_candidate_phase_requires_same_snapshot_receipt_and_nonempty_note() -> None:
    document = _document()
    receipt, observation = _gate(document, "gated-source")

    with pytest.raises(BaselineGateError, match="Baseline receipt"):
        render_candidates(
            document,
            source_sha256="gated-source",
            baseline_receipt=None,
            baseline_observation=observation,
        )

    with pytest.raises(BaselineGateError, match="Baseline receipt"):
        render_candidates(
            document,
            source_sha256="gated-source",
            baseline_receipt="0" * 64,
            baseline_observation=observation,
        )

    with pytest.raises(BaselineGateError, match="non-empty baseline observation"):
        render_candidates(
            document,
            source_sha256="gated-source",
            baseline_receipt=receipt,
            baseline_observation=b"   \n",
        )


def test_candidate_phase_hashes_baseline_note_without_reprinting_it() -> None:
    document = _document()
    receipt, _ = _gate(document, "private-note")
    observation = "まだMK-CとMK-Dは保留したい".encode("utf-8")

    rendered = render_candidates(
        document,
        source_sha256="private-note",
        baseline_receipt=receipt,
        baseline_observation=observation,
    )

    assert f"Baseline receipt: {receipt}" in rendered
    assert f"Baseline observation SHA-256: {_sha256_for_test(observation)}" in rendered
    assert f"Baseline observation bytes: {len(observation)}" in rendered
    assert "まだMK-CとMK-Dは保留したい" not in rendered


def test_baseline_receipt_binds_candidate_method_version() -> None:
    source_sha256 = "same-source"
    product_digest = "a" * 64

    current = _baseline_receipt(
        source_sha256,
        product_digest,
        method_id="deterministic-structural-attention-v1",
    )
    changed = _baseline_receipt(
        source_sha256,
        product_digest,
        method_id="deterministic-structural-attention-v2",
    )

    assert current != changed


def test_candidate_phase_rejects_receipt_from_different_method_version() -> None:
    document = _document()
    digest = attention_source_digest(build_attention_ir(document))
    wrong_method_receipt = _baseline_receipt(
        "method-mismatch",
        digest,
        method_id="deterministic-structural-attention-v3",
    )

    with pytest.raises(BaselineGateError, match="Baseline receipt"):
        render_candidates(
            document,
            source_sha256="method-mismatch",
            baseline_receipt=wrong_method_receipt,
            baseline_observation="事前判断".encode("utf-8"),
        )


def test_candidate_receipt_binds_exact_candidate_payload() -> None:
    document = _document()
    source_sha256 = "candidate-payload"
    ir = build_attention_ir(document)
    digest = attention_source_digest(ir)
    baseline_receipt, _ = _gate(document, source_sha256)
    candidates = attention_candidates_from_ir(ir)

    actual = _candidate_receipt(
        source_sha256=source_sha256,
        product_digest=digest,
        baseline_receipt=baseline_receipt,
        baseline_observation_sha256=_sha256_for_test("事前判断を記録した".encode("utf-8")),
        candidates=candidates,
    )
    empty = _candidate_receipt(
        source_sha256=source_sha256,
        product_digest=digest,
        baseline_receipt=baseline_receipt,
        baseline_observation_sha256=_sha256_for_test("事前判断を記録した".encode("utf-8")),
        candidates=[],
    )

    assert actual != empty


def test_candidate_phase_prints_receipt_and_six_axis_template() -> None:
    document = _document()
    source_sha256 = "candidate-template"
    receipt, observation = _gate(document, source_sha256)

    rendered = render_candidates(
        document,
        source_sha256=source_sha256,
        baseline_receipt=receipt,
        baseline_observation=observation,
    )

    assert "Candidate receipt: " in rendered
    assert "## Post-observation JSON template" in rendered
    for axis in (
        "attentionShift",
        "structureReconsideration",
        "holdDissentPreserved",
        "noiseOrNarrowing",
        "counterfactualWithoutCandidate",
        "complexityBudget",
    ):
        assert f'"{axis}"' in rendered


def test_outcome_requires_exact_candidate_receipt() -> None:
    document = _document()
    source_sha256 = "outcome-gate"
    baseline_receipt, baseline_observation = _gate(document, source_sha256)

    with pytest.raises(CandidateGateError, match="Candidate receipt"):
        render_outcome(
            document,
            source_sha256=source_sha256,
            baseline_receipt=baseline_receipt,
            baseline_observation=baseline_observation,
            candidate_receipt="0" * 64,
            post_observation=_post_observation(),
        )


def test_outcome_requires_all_six_independent_axes() -> None:
    document = _document()
    source_sha256 = "outcome-schema"
    baseline_receipt, baseline_observation = _gate(document, source_sha256)
    ir = build_attention_ir(document)
    candidate_receipt = _candidate_receipt(
        source_sha256=source_sha256,
        product_digest=attention_source_digest(ir),
        baseline_receipt=baseline_receipt,
        baseline_observation_sha256=_sha256_for_test(baseline_observation),
        candidates=attention_candidates_from_ir(ir),
    )

    incomplete = json.loads(_post_observation())
    incomplete.pop("complexityBudget")
    with pytest.raises(PostObservationError, match="six required axes"):
        render_outcome(
            document,
            source_sha256=source_sha256,
            baseline_receipt=baseline_receipt,
            baseline_observation=baseline_observation,
            candidate_receipt=candidate_receipt,
            post_observation=json.dumps(incomplete).encode("utf-8"),
        )

    invalid = json.loads(_post_observation())
    invalid["attentionShift"]["assessment"] = 5
    with pytest.raises(PostObservationError, match="attentionShift.assessment"):
        render_outcome(
            document,
            source_sha256=source_sha256,
            baseline_receipt=baseline_receipt,
            baseline_observation=baseline_observation,
            candidate_receipt=candidate_receipt,
            post_observation=json.dumps(invalid).encode("utf-8"),
        )


def test_outcome_keeps_axes_separate_without_reprinting_notes() -> None:
    document = _document()
    source_sha256 = "outcome-valid"
    baseline_receipt, baseline_observation = _gate(document, source_sha256)
    ir = build_attention_ir(document)
    candidate_receipt = _candidate_receipt(
        source_sha256=source_sha256,
        product_digest=attention_source_digest(ir),
        baseline_receipt=baseline_receipt,
        baseline_observation_sha256=_sha256_for_test(baseline_observation),
        candidates=attention_candidates_from_ir(ir),
    )
    post = _post_observation()

    rendered = render_outcome(
        document,
        source_sha256=source_sha256,
        baseline_receipt=baseline_receipt,
        baseline_observation=baseline_observation,
        candidate_receipt=candidate_receipt,
        post_observation=post,
    )

    assert "# Cognitive T2 review — outcome" in rendered
    assert "- attentionShift: yes" in rendered
    assert "- structureReconsideration: yes" in rendered
    assert "- holdDissentPreserved: yes" in rendered
    assert "- noiseOrNarrowing: no" in rendered
    assert "- counterfactualWithoutCandidate: unlikely" in rendered
    assert "- complexityBudget: within" in rendered
    assert "総合scoreや自動昇格判定を生成しない" in rendered
    assert "候補なしでは見ていなかった材料へ注意が移った" not in rendered
    assert "表示量と確認負荷は許容範囲だった" not in rendered


def test_candidate_receipt_binds_baseline_observation_content() -> None:
    document = _document()
    source_sha256 = "baseline-note-binding"
    ir = build_attention_ir(document)
    digest = attention_source_digest(ir)
    baseline_receipt, baseline_observation = _gate(document, source_sha256)
    candidates = attention_candidates_from_ir(ir)

    original = _candidate_receipt(
        source_sha256=source_sha256,
        product_digest=digest,
        baseline_receipt=baseline_receipt,
        baseline_observation_sha256=_sha256_for_test(baseline_observation),
        candidates=candidates,
    )
    changed = _candidate_receipt(
        source_sha256=source_sha256,
        product_digest=digest,
        baseline_receipt=baseline_receipt,
        baseline_observation_sha256=_sha256_for_test("別の事前判断".encode("utf-8")),
        candidates=candidates,
    )

    assert original != changed


def test_outcome_rejects_changed_baseline_observation() -> None:
    document = _document()
    source_sha256 = "changed-baseline-note"
    baseline_receipt, baseline_observation = _gate(document, source_sha256)
    ir = build_attention_ir(document)
    candidate_receipt = _candidate_receipt(
        source_sha256=source_sha256,
        product_digest=attention_source_digest(ir),
        baseline_receipt=baseline_receipt,
        baseline_observation_sha256=_sha256_for_test(baseline_observation),
        candidates=attention_candidates_from_ir(ir),
    )

    with pytest.raises(CandidateGateError, match="Candidate receipt"):
        render_outcome(
            document,
            source_sha256=source_sha256,
            baseline_receipt=baseline_receipt,
            baseline_observation="後から書き換えた事前判断".encode("utf-8"),
            candidate_receipt=candidate_receipt,
            post_observation=_post_observation(),
        )


def test_t2_rejects_candidate_set_over_product_complexity_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = _document()
    cards = []
    relations = []
    islands = []
    clusters = []
    for index in range(1, 6):
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
    over_budget_ir = {
        "ir_version": "1.2",
        "cards": cards,
        "relations": relations,
        "islands": islands,
        "cluster_candidates": clusters,
        "meta": {"doc_id": "over-budget", "doc_version": 1},
        "truncation": {"truncated": False, "reason_codes": []},
    }
    monkeypatch.setattr(
        "scripts.review_cognitive_candidate_t2.build_attention_ir",
        lambda _document: over_budget_ir,
    )
    source_sha256 = "over-budget"
    receipt = _baseline_receipt(
        source_sha256,
        attention_source_digest(over_budget_ir),
    )

    with pytest.raises(AttentionComplexityError, match="complexity budget"):
        render_candidates(
            document,
            source_sha256=source_sha256,
            baseline_receipt=receipt,
            baseline_observation="事前判断".encode("utf-8"),
        )
