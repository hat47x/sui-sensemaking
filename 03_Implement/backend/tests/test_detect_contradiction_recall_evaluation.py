from __future__ import annotations

import json
import sys

import pytest

from scripts import evaluate_detect_contradiction_recall as ev
from sui_sensemaking_api.llm.provider import (
    FINAL_JUDGEMENT_MAX_TOKENS,
    LLMCallMetadata,
    LLMRequest,
    LLMResponse,
    ProviderRequestError,
)
from sui_sensemaking_api.routes import ai as ai_routes


def _case(*, islands: int = 6, index: int = 0, contradicting: bool = True) -> dict:
    spec = ev.plan(islands=islands, trials=index + 1)[index]
    return ev.build_case(islands=islands, spec=spec, contradicting=contradicting)


def _island_of(payload, card_id: str) -> str:
    owners = [island.id for island in payload.doc.islands if card_id in island.cardIds]
    assert len(owners) == 1
    return owners[0]


def test_plan_varies_positions_and_never_puts_both_cards_in_one_island() -> None:
    specs = ev.plan(islands=30, trials=20)
    assert all(spec["claim_island"] != spec["other_island"] for spec in specs)
    assert len({(spec["claim_island"], spec["other_island"]) for spec in specs}) == 20
    assert {spec["swap"] for spec in specs} == {True, False}
    assert {spec["topic"] for spec in specs} == set(range(len(ev.TOPICS)))
    assert {spec["control_kind"] for spec in specs} == set(ev.CONTROL_KINDS)
    # 島が2つしかなくても、2枚は異なる島に置かれる。
    assert all(spec["claim_island"] != spec["other_island"] for spec in ev.plan(islands=2, trials=9))
    # どの題材も、2巡すれば両方のA/B順序で現れる。
    orders: dict[int, set[bool]] = {}
    for spec in ev.plan(islands=30, trials=2 * len(ev.TOPICS)):
        orders.setdefault(spec["topic"], set()).add(spec["swap"])
    assert all(seen == {True, False} for seen in orders.values())


def test_planted_pair_spans_two_islands_and_differs_from_control_only_in_one_text() -> None:
    spec = ev.plan(islands=6, trials=1)[0]
    planted = ev.build_case(islands=6, spec=spec, contradicting=True)
    control = ev.build_case(islands=6, spec=spec, contradicting=False)
    topic = ev.TOPICS[spec["topic"]]

    def texts(case: dict) -> dict[str, str]:
        payload = case["payload"]
        return {payload.cardA.id: payload.cardA.text, payload.cardB.id: payload.cardB.text}

    planted_texts, control_texts = texts(planted), texts(control)
    assert set(planted_texts) == set(control_texts) == set(planted["planted_card_ids"])
    assert planted["payload"].cardA.id == control["payload"].cardA.id  # 同じ順序
    assert topic["claim"] in planted_texts.values() and topic["claim"] in control_texts.values()
    assert topic["negation"] in planted_texts.values()
    assert topic["negation"] not in control_texts.values()
    assert topic[spec["control_kind"]] in control_texts.values()
    differing = [card for card in planted_texts if planted_texts[card] != control_texts[card]]
    assert len(differing) == 1
    # 2枚は、異なる島のレビュー済みカード。
    islands = {_island_of(planted["payload"], card) for card in planted_texts}
    assert len(islands) == 2 and sorted(islands) == planted["planted_island_ids"]
    assert planted["payload"].cardA.textReviewed and planted["payload"].cardB.textReviewed
    assert control["control_kind"] == spec["control_kind"] and planted["control_kind"] is None


def test_prompt_is_exactly_what_the_production_route_builders_render() -> None:
    case = _case(islands=6, index=3, contradicting=True)
    payload = case["payload"]
    ir = ai_routes._detect_contradiction_ir(payload)
    assert case["prompt"] == ai_routes._build_detect_contradiction_prompt(payload, ir)
    assert f"Card A (id={payload.cardA.id}): {payload.cardA.text}" in case["prompt"]
    assert f"Card B (id={payload.cardB.id}): {payload.cardB.text}" in case["prompt"]
    for island_id in case["planted_island_ids"]:
        assert f'- {island_id} "' in case["prompt"]
    # 人間が記録した確定・保留の矛盾はない。モデルが呼ばれる経路である。
    assert "Evidence links the human has already recorded" not in case["prompt"]


def test_control_prompt_carries_no_negation_of_the_claim() -> None:
    negations = {topic["negation"] for topic in ev.TOPICS}
    for index in range(len(ev.TOPICS)):
        planted = _case(islands=6, index=index, contradicting=True)["prompt"]
        control = _case(islands=6, index=index, contradicting=False)["prompt"]
        assert sum(negation in planted for negation in negations) == 1
        assert not any(negation in control for negation in negations)


def test_dry_run_reports_plan_and_worst_case_cost_without_a_provider() -> None:
    report = ev.evaluate(model="m", expected_provider="p", islands=4, trials=3)
    assert report["executed"] is False
    assert "detected" not in report
    assert report["trials_per_arm"] == 3 and report["planned_calls"] == 6
    assert report["worst_case_spend_usd"] > 0
    assert report["worst_case_exceeds_cap"] is False
    capped = ev.evaluate(model="m", expected_provider="p", islands=4, trials=3, max_spend_usd=0.0001)
    assert capped["worst_case_exceeds_cap"] is True


def test_dry_run_says_when_the_bar_cannot_be_reached_with_so_few_trials() -> None:
    def reachable(trials: int) -> bool:
        return ev.evaluate(
            model="m", expected_provider="p", islands=3, trials=trials
        )["bar_reachable_with_trials"]

    # 全件検出でも Wilson 下限が 0.8 に届くのは 16 回から。
    assert reachable(10) is False
    assert reachable(15) is False
    assert reachable(16) is True


def test_parse_has_contradiction_uses_the_route_parser_and_flags_unreadable() -> None:
    assert ev.parse_has_contradiction('{"hasContradiction": true, "explanation": "e"}') is True
    assert ev.parse_has_contradiction('{"hasContradiction": false}') is False
    assert ev.parse_has_contradiction('{"has_contradiction": true}') is True
    assert ev.parse_has_contradiction("") is None  # 推論で出力上限を使い切った空応答
    assert ev.parse_has_contradiction("not json") is None
    assert ev.parse_has_contradiction("[true]") is None


class _FakeProvider:
    provider_name = "fake"
    provider_kind = "deepseek"

    def __init__(
        self,
        *,
        mode: str = "oracle",
        model_id: str = "m",
        input_tokens: int | None = 300,
        output_tokens: int | None = 900,
    ) -> None:
        self.mode = mode
        self.model_id = model_id
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.requests: list[LLMRequest] = []

    def _metadata(self) -> LLMCallMetadata:
        return LLMCallMetadata(
            provider_kind="deepseek",
            provider_name="fake",
            model_id=self.model_id,
            transport="http",
            requested_at="2026-10-12T00:00:00+00:00",
            trace_id="t",
            thinking_mode="enabled",
        )

    def generate(self, req: LLMRequest) -> LLMResponse:
        self.requests.append(req)
        assert req.task == "detect_contradiction"
        planted = any(topic["negation"] in req.prompt for topic in ev.TOPICS)
        call_index = len(self.requests) - 1
        if self.mode == "mixed" and call_index == 1:
            raise ProviderRequestError.unavailable("down", self._metadata())
        if self.mode == "garbled" or (self.mode == "mixed" and call_index == 0):
            raw = "not json"
        elif self.mode == "never":
            raw = json.dumps({"hasContradiction": False, "explanation": "x"})
        elif self.mode == "always":
            raw = json.dumps({"hasContradiction": True, "explanation": "x"})
        else:
            raw = json.dumps({"hasContradiction": planted, "explanation": "x"})
        return LLMResponse(
            raw_text=raw,
            metadata=self._metadata(),
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
        )


def _run(provider: _FakeProvider, **overrides) -> dict:
    params = {
        "model": "m",
        "expected_provider": "fake",
        "islands": 6,
        "trials": 20,
        "execute": True,
        "provider": provider,
    }
    params.update(overrides)
    return ev.evaluate(**params)


def test_execute_passes_when_every_pair_is_found_and_controls_are_clean() -> None:
    provider = _FakeProvider()
    report = _run(provider)
    assert report["detected"] == 20 and report["control_false_positives"] == 0
    assert report["unreadable_responses"] == 0 and report["provider_errors"] == 0
    assert report["thinking_modes_seen"] == ["enabled"]
    assert report["meets_minimum"] is True
    assert report["calls_made"] == report["planned_calls"] == 40
    assert report["input_tokens_reported_total"] == 40 * 300
    assert report["output_tokens_reported_total"] == 40 * 900
    assert report["max_output_tokens_reported"] == 900
    assert report["output_budget_exhausted_calls"] == 0
    assert report["estimated_spend_usd"] == pytest.approx(40 * (300 * 0.30 + 900 * 1.20) / 1e6, abs=1e-4)
    # 本番ルートと同じリクエスト設定で送る。
    assert all(req.max_tokens == FINAL_JUDGEMENT_MAX_TOKENS for req in provider.requests)
    assert all(req.model == "m" and req.inputs and "cards" in req.inputs for req in provider.requests)


def test_execute_fails_when_the_model_silently_answers_no_contradiction() -> None:
    report = _run(_FakeProvider(mode="never"))
    assert report["detected"] == 0 and report["control_false_positives"] == 0
    assert report["detection_wilson_lower_bound"] == 0.0
    assert report["meets_minimum"] is False


def test_execute_counts_false_positives_per_control_kind() -> None:
    report = _run(_FakeProvider(mode="always"))
    assert report["detected"] == 20
    assert report["control_false_positives"] == 20
    assert report["control_false_positives_by_kind"] == report["control_trials_by_kind"]
    assert sum(report["control_trials_by_kind"].values()) == 20
    assert report["control_false_positive_wilson_upper_bound"] == 1.0


def test_execute_separates_unreadable_responses_and_provider_errors() -> None:
    report = _run(_FakeProvider(mode="mixed"))
    # 1回目（矛盾ケース）は読めない応答、2回目（対照ケース）は提供元エラー。
    assert report["unreadable_responses"] == 1
    assert report["provider_errors"] == 1
    assert report["detected"] == 19 and report["control_false_positives"] == 0
    assert report["meets_minimum"] is False


def test_execute_reports_when_reasoning_exhausts_the_output_budget() -> None:
    report = _run(
        _FakeProvider(mode="garbled", output_tokens=FINAL_JUDGEMENT_MAX_TOKENS), trials=3
    )
    assert report["unreadable_responses"] == 6
    assert report["output_budget_exhausted_calls"] == 6
    assert report["max_output_tokens_reported"] == FINAL_JUDGEMENT_MAX_TOKENS


def test_execute_counts_calls_without_a_usage_report_at_worst_case() -> None:
    report = _run(_FakeProvider(input_tokens=None, output_tokens=None), trials=3)
    assert report["calls_without_usage_report"] == 6
    assert report["estimated_spend_usd"] == pytest.approx(report["worst_case_spend_usd"], abs=1e-3)


def test_execute_refuses_before_sending_when_worst_case_exceeds_the_cap() -> None:
    provider = _FakeProvider()
    with pytest.raises(ev.SpendCapError):
        _run(provider, max_spend_usd=0.001)
    assert provider.requests == []


def test_execute_stops_when_reported_usage_runs_past_the_cap() -> None:
    provider = _FakeProvider(output_tokens=FINAL_JUDGEMENT_MAX_TOKENS * 10)
    report = _run(provider, trials=20, max_spend_usd=0.8)
    assert report["stopped_for_budget"] is True
    assert report["calls_made"] < report["planned_calls"] == 40
    assert len(provider.requests) == report["calls_made"]
    assert report["meets_minimum"] is False


def test_execute_rejects_provider_or_model_mismatch() -> None:
    with pytest.raises(ValueError, match="プロバイダー名"):
        ev.evaluate(model="m", expected_provider="other", islands=4, trials=1, execute=True,
                    provider=_FakeProvider())
    with pytest.raises(ValueError, match="モデルID"):
        ev.evaluate(model="m", expected_provider="fake", islands=4, trials=1, execute=True,
                    provider=_FakeProvider(model_id="other"))
    with pytest.raises(ValueError, match="プロバイダー"):
        ev.evaluate(model="m", expected_provider="fake", islands=4, trials=1, execute=True)


def test_evaluate_rejects_out_of_range_arguments() -> None:
    with pytest.raises(ValueError):
        ev.evaluate(model="m", expected_provider="p", islands=1, trials=1)
    with pytest.raises(ValueError):
        ev.evaluate(model="m", expected_provider="p", islands=4, trials=0)
    with pytest.raises(ValueError):
        ev.evaluate(model="m", expected_provider="p", islands=4, trials=1, max_spend_usd=0)


def test_report_never_carries_response_text_or_card_text() -> None:
    report = _run(_FakeProvider(), trials=2)
    serialized = json.dumps(report, ensure_ascii=False)
    for topic in ev.TOPICS:
        assert not any(text in serialized for text in topic.values())
    assert "explanation" not in serialized


def test_main_dry_run_prints_the_plan_and_returns_zero(monkeypatch, capsys) -> None:
    monkeypatch.setattr(
        sys, "argv", ["x", "--provider", "p", "--model", "m", "--islands", "4", "--trials", "2"]
    )
    assert ev.main() == 0
    out = json.loads(capsys.readouterr().out)
    assert out["executed"] is False and out["planned_calls"] == 4


def test_main_refuses_execute_without_opt_in(monkeypatch, capsys) -> None:
    monkeypatch.delenv(ev.OPT_IN_ENV, raising=False)
    monkeypatch.setattr(sys, "argv", ["x", "--provider", "p", "--model", "m", "--execute"])
    monkeypatch.setattr(ev, "get_provider", lambda: pytest.fail("provider must not be resolved"))
    assert ev.main() == 2
    assert json.loads(capsys.readouterr().out)["status"] == "external-execution-not-opted-in"


def test_main_refuses_a_model_the_production_route_would_not_use(monkeypatch, capsys) -> None:
    monkeypatch.setenv(ev.OPT_IN_ENV, "1")
    monkeypatch.setattr(ev, "resolve_model_for_task", lambda task: "configured-model")
    monkeypatch.setattr(ev, "get_provider", lambda: pytest.fail("provider must not be resolved"))
    monkeypatch.setattr(sys, "argv", ["x", "--provider", "p", "--model", "other", "--execute"])
    assert ev.main() == 2
    assert json.loads(capsys.readouterr().out)["status"] == "configuration-mismatch"
