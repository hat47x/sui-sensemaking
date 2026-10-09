from __future__ import annotations

import json

import pytest

from scripts import evaluate_check_narrative_omission as ev
from sui_sensemaking_api.llm.provider import LLMCallMetadata, LLMRequest, LLMResponse


def test_omitted_island_is_absent_from_narrative_only_in_the_omission_case() -> None:
    omitted = ev.build_case(islands=5, drop_index=2)
    control = ev.build_case(islands=5, drop_index=None)
    title = "Narrative text:\n"
    omitted_narrative = omitted["prompt"].split(title)[1].split("\nReading order:")[0]
    control_narrative = control["prompt"].split(title)[1].split("\nReading order:")[0]
    assert len(omitted_narrative.splitlines()) == 4
    assert len(control_narrative.splitlines()) == 5
    assert omitted["omitted_island_id"] == "i02"
    assert omitted["omitted_card_ids"] and control["omitted_island_id"] is None


def test_detection_counts_island_or_member_card_references_only() -> None:
    case = ev.build_case(islands=5, drop_index=1)
    card = case["omitted_card_ids"][0]
    assert ev.is_detected(case, ev.referenced_ids(json.dumps({"issues": [{"references": [{"id": "i01"}]}]})))
    assert ev.is_detected(case, ev.referenced_ids(json.dumps({"issues": [{"references": [{"id": card}]}]})))
    assert not ev.is_detected(case, ev.referenced_ids(json.dumps({"issues": [{"references": [{"id": "i04"}]}]})))
    assert not ev.is_detected(case, ev.referenced_ids('{"issues":[],"counts":{"bMissingInA":0,"aMissingInB":0}}'))
    assert ev.referenced_ids("not json") is None
    assert not ev.is_detected(case, None)


def test_wilson_lower_bound_penalizes_small_samples() -> None:
    assert ev.wilson_lower_bound(0, 0) == 0.0
    assert ev.wilson_lower_bound(6, 6) < 0.65
    assert ev.wilson_lower_bound(20, 20) > 0.83
    assert ev.wilson_lower_bound(10, 20) < 0.5


def test_dry_run_reports_plan_without_a_provider() -> None:
    report = ev.evaluate(model="m", expected_provider="p", islands=4, trials=3)
    assert report["executed"] is False
    assert "detected" not in report
    assert report["trials_per_arm"] == 3


class _FakeProvider:
    provider_name = "fake"
    provider_kind = "deepseek"

    def __init__(self, *, finds_omission: bool, model_id: str = "m") -> None:
        self.finds_omission = finds_omission
        self.model_id = model_id

    def generate(self, req: LLMRequest) -> LLMResponse:
        assert req.task == "check_narrative"
        omitted = None
        for line in req.prompt.splitlines():
            if line.startswith("- id=\"i") and "cardTexts=" in line:
                island_id = line.split('"')[1]
                narrative = req.prompt.split("Narrative text:\n")[1].split("\nReading order:")[0]
                title = line.split("title=")[1].split(",")[0].strip('"')
                if title not in narrative:
                    omitted = island_id
        issues = [{"severity": "warn", "message": "x", "direction": "a_missing_in_b", "references": [{"id": omitted, "kind": "island"}]}] if (
            self.finds_omission and omitted
        ) else []
        return LLMResponse(
            raw_text=json.dumps({"issues": issues}),
            metadata=LLMCallMetadata(
                provider_kind="deepseek",
                provider_name="fake",
                model_id=self.model_id,
                transport="http",
                requested_at="2026-10-09T00:00:00+00:00",
                trace_id="t",
                thinking_mode="enabled",
            ),
            input_tokens=100,
        )


def test_execute_passes_when_every_omission_is_found_and_controls_are_clean() -> None:
    report = ev.evaluate(
        model="m", expected_provider="fake", islands=6, trials=20, execute=True,
        provider=_FakeProvider(finds_omission=True),
    )
    assert report["detected"] == 20 and report["control_false_positives"] == 0
    assert report["thinking_modes_seen"] == ["enabled"]
    assert report["meets_minimum"] is True


def test_execute_fails_when_the_model_says_no_issues_for_omissions() -> None:
    report = ev.evaluate(
        model="m", expected_provider="fake", islands=6, trials=20, execute=True,
        provider=_FakeProvider(finds_omission=False),
    )
    assert report["detected"] == 0 and report["meets_minimum"] is False


def test_execute_rejects_provider_or_model_mismatch() -> None:
    with pytest.raises(ValueError, match="プロバイダー名"):
        ev.evaluate(model="m", expected_provider="other", islands=4, trials=1, execute=True,
                    provider=_FakeProvider(finds_omission=True))
    with pytest.raises(ValueError, match="モデルID"):
        ev.evaluate(model="m", expected_provider="fake", islands=4, trials=1, execute=True,
                    provider=_FakeProvider(finds_omission=True, model_id="other"))


def test_omission_claims_counts_only_a_missing_in_b_issues() -> None:
    raw = json.dumps(
        {"issues": [{"direction": "a_missing_in_b"}, {"direction": "b_missing_in_a"}, {"severity": "info"}]}
    )
    assert ev.omission_claims(raw) == 1
    assert ev.omission_claims(json.dumps({"issues": []})) == 0
    assert ev.omission_claims("not json") is None
