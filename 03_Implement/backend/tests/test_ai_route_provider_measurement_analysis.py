from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import analyze_ai_route_provider_measurement as analysis
from scripts import measure_ai_route_provider_tokens as token_measure


def _row(
    tokens: int,
    *,
    task: str,
    prompt_sha256: str,
    prompt_bytes: int = 999_999,
) -> dict:
    return {
        "task": task,
        "prompt": {
            "unicode_chars": 123_456,
            "utf8_bytes": prompt_bytes,
            "sha256": prompt_sha256,
        },
        "provider_reported": {"input_tokens": tokens, "output_tokens": 1},
        "actual_provider": "named-provider",
        "actual_provider_kind": "test",
        "actual_model": "named-model",
        "provider_call": {
            "provider": "named-provider",
            "provider_kind": "test",
            "model_id": "named-model",
            "transport": "http",
            "requested_at": "2026-09-05T00:00:00+00:00",
            "trace_id": "trace-fixture",
            "fallback_to_none": False,
            "execution_path": "primary",
        },
        "status": "measured",
    }


def _core_report() -> dict:
    requests = token_measure.build_representative_requests("named-model")
    values = {
        "suggest-card-groups": 4_000,
        "suggest-card-groups-route-b": 5_000,
        "suggest-layout": 7_000,
        "suggest-layout-route-b": 8_000,
        "generate-narrative": 6_000,
        "check-narrative": 11_000,
    }
    return {
        "measurement": analysis.MEASUREMENT_NAME,
        "scenario": analysis.SCENARIO_NAME,
        "expected_provider": "named-provider",
        "expected_model": "named-model",
        "executed": True,
        "measurement_complete": True,
        "prompt_fingerprint": analysis.PROMPT_FINGERPRINT.copy(),
        "provider_call_provenance": analysis.PROVIDER_CALL_PROVENANCE.copy(),
        "routes": {
            name: _row(
                tokens,
                task=analysis.CORE_ROUTE_TASKS[name],
                prompt_sha256=token_measure._prompt_sha256(requests[name].prompt),
            )
            for name, tokens in values.items()
        },
        "layout_c_summary": {"included": False, "requests": 0},
    }


def _add_complete_layout_c(report: dict) -> None:
    requests = token_measure.build_representative_requests(
        "named-model", include_layout_c=True
    )
    for index in range(1, 31):
        name = f"suggest-layout-c-local-{index:02d}"
        report["routes"][name] = _row(
            100 + index,
            task="re_layout",
            prompt_sha256=token_measure._prompt_sha256(requests[name].prompt),
        )
    name = "suggest-layout-c-global"
    report["routes"][name] = _row(
        900,
        task="re_layout",
        prompt_sha256=token_measure._prompt_sha256(requests[name].prompt),
    )


def test_complete_core_report_is_ready_and_uses_only_provider_usage() -> None:
    report = _core_report()
    # Deliberately make byte diagnostics unrelated and non-monotonic. Token deltas
    # below must still come solely from provider_reported.input_tokens.
    report["routes"]["suggest-card-groups"]["prompt"]["utf8_bytes"] = 900_000
    report["routes"]["suggest-card-groups-route-b"]["prompt"]["utf8_bytes"] = 1
    report["routes"]["suggest-layout"]["prompt"]["utf8_bytes"] = 2_000_000
    report["routes"]["suggest-layout-route-b"]["prompt"]["utf8_bytes"] = 2

    result = analysis.analyze(report)

    assert result["decision_ready"] is True
    assert result["core_ready"] is True
    assert result["groups_a2_ready"] is False
    assert result["layout_c_ready"] is False
    assert result["errors"] == []
    assert result["observations"]["groups"] == {
        "current_input_tokens": 4_000,
        "route_b_input_tokens": 5_000,
        "a2_input_tokens": None,
        "a2_measured": False,
        "route_b_minus_current_input_tokens": 1_000,
        "a2_minus_route_b_input_tokens": None,
    }
    assert result["observations"]["layout"]["route_b_minus_current_input_tokens"] == 1_000
    assert result["observations"]["whole_document"]["check_minus_generate_input_tokens"] == 5_000



def test_context_budget_separates_measurement_cap_from_production_output_reserve() -> None:
    result = analysis.analyze(_core_report())

    budget = result["context_budget"]
    assert budget["measurement_request_max_tokens"] == 1
    assert budget["current_production_output_reserve_tokens"] == 2_000
    assert budget["output_reserve_source"].startswith("LLMRequest.default.max_tokens")
    assert budget["production_output_reserve_tokens_by_task"]["check_narrative"] == 16_000
    assert budget["context_window_tokens"] is None
    assert budget["core_hard_context_fit"] is None
    assert budget["sufficient_headroom_policy"] is None
    check = budget["route_requirements"]["check-narrative"]
    assert check == {
        "provider_reported_input_tokens": 11_000,
        "output_reserve_tokens": 16_000,
        "minimum_context_tokens": 27_000,
        "remaining_context_tokens": None,
        "hard_context_fit": None,
    }


def test_context_window_option_reports_hard_fit_without_inventing_margin() -> None:
    result = analysis.analyze(
        _core_report(),
        context_window_tokens=10_000,
        context_window_source=" https://provider.example/models/named-model ",
    )

    budget = result["context_budget"]
    assert result["decision_ready"] is True
    assert budget["context_window_tokens"] == 10_000
    assert budget["context_window_source"] == "https://provider.example/models/named-model"
    assert budget["context_window_source_kind"] == "operator-supplied-document-reference"
    assert budget["core_hard_context_fit"] is False
    assert budget["route_requirements"]["suggest-layout-route-b"]["minimum_context_tokens"] == 10_000
    assert budget["route_requirements"]["suggest-layout-route-b"]["remaining_context_tokens"] == 0
    assert budget["route_requirements"]["suggest-layout-route-b"]["hard_context_fit"] is True
    assert budget["route_requirements"]["check-narrative"]["remaining_context_tokens"] == -17_000
    assert budget["route_requirements"]["check-narrative"]["hard_context_fit"] is False
    assert budget["sufficient_headroom_policy"] is None


def test_layout_c_context_budget_uses_max_single_request_not_aggregate() -> None:
    report = _core_report()
    _add_complete_layout_c(report)

    result = analysis.analyze(
        report,
        context_window_tokens=3_000,
        context_window_source="provider-doc: named-model context window",
    )

    budget = result["context_budget"]
    assert result["layout_c_ready"] is True
    assert budget["layout_c_max_single_minimum_context_tokens"] == 2_900
    assert budget["layout_c_hard_context_fit"] is True
    # Aggregate C input usage is a cost/throughput observation, not one context window.
    assert result["observations"]["layout"]["layout_c_aggregate_input_tokens"] > 3_000


def test_context_window_tokens_require_documentation_source() -> None:
    with pytest.raises(
        ValueError,
        match="context_window_source is required",
    ):
        analysis.analyze(_core_report(), context_window_tokens=10_000)


def test_context_window_source_cannot_exist_without_token_value() -> None:
    with pytest.raises(
        ValueError,
        match="context_window_source requires context_window_tokens",
    ):
        analysis.analyze(
            _core_report(),
            context_window_source="https://provider.example/models/named-model",
        )


def test_groups_a2_adds_only_provider_reported_comparison() -> None:
    report = _core_report()
    requests = token_measure.build_representative_requests(
        "named-model", include_groups_a2=True
    )
    report["routes"][analysis.GROUPS_A2_ROUTE] = _row(
        5_750,
        task="suggest_card_groups",
        prompt_sha256=token_measure._prompt_sha256(
            requests[analysis.GROUPS_A2_ROUTE].prompt
        ),
        prompt_bytes=56_047,
    )

    result = analysis.analyze(report)

    assert result["decision_ready"] is True
    assert result["groups_a2_ready"] is True
    groups = result["observations"]["groups"]
    assert groups["a2_input_tokens"] == 5_750
    assert groups["a2_minus_route_b_input_tokens"] == 750
    assert groups["a2_input_tokens"] != 56_047


def test_layout_c_requires_exact_canonical_31_provider_rows() -> None:
    report = _core_report()
    _add_complete_layout_c(report)

    result = analysis.analyze(report)

    assert result["decision_ready"] is True
    assert result["layout_c_ready"] is True
    layout = result["observations"]["layout"]
    assert layout["layout_c_requests"] == 31
    assert layout["layout_c_max_single_input_tokens"] == 900
    assert layout["layout_c_aggregate_input_tokens"] == sum(
        [100 + index for index in range(1, 31)] + [900]
    )
    assert layout["a2_reuses_route_b_observation"] is True


def test_partial_layout_c_fails_closed_instead_of_aggregating() -> None:
    report = _core_report()
    requests = token_measure.build_representative_requests(
        "named-model", include_layout_c=True
    )
    name = "suggest-layout-c-local-01"
    report["routes"][name] = _row(
        101,
        task="re_layout",
        prompt_sha256=token_measure._prompt_sha256(requests[name].prompt),
    )

    result = analysis.analyze(report)

    assert result["decision_ready"] is False
    assert result["layout_c_ready"] is False
    assert "layout-c-missing-route:suggest-layout-c-global" in result["errors"]
    layout = result["observations"]["layout"]
    assert layout["layout_c_max_single_input_tokens"] is None
    assert layout["layout_c_aggregate_input_tokens"] is None


def test_layout_c_wrong_route_name_cannot_pass_by_count_alone() -> None:
    report = _core_report()
    _add_complete_layout_c(report)
    del report["routes"]["suggest-layout-c-local-30"]
    report["routes"]["suggest-layout-c-local-99"] = _row(
        199,
        task="re_layout",
        prompt_sha256="0" * 64,
    )

    result = analysis.analyze(report)

    assert len(
        [name for name in report["routes"] if name.startswith(analysis.LAYOUT_C_PREFIX)]
    ) == 31
    assert result["decision_ready"] is False
    assert result["layout_c_ready"] is False
    assert "layout-c-missing-route:suggest-layout-c-local-30" in result["errors"]
    assert "layout-c-unexpected-route:suggest-layout-c-local-99" in result["errors"]


def test_wrong_task_identity_fails_closed() -> None:
    report = _core_report()
    report["routes"]["suggest-layout"]["task"] = "suggest_card_groups"

    result = analysis.analyze(report)

    assert result["decision_ready"] is False
    assert result["core_ready"] is False
    assert "task-mismatch:suggest-layout" in result["errors"]


def test_changed_prompt_fingerprint_fails_closed() -> None:
    report = _core_report()
    report["routes"]["suggest-layout-route-b"]["prompt"]["sha256"] = "0" * 64

    result = analysis.analyze(report)

    assert result["decision_ready"] is False
    assert result["core_ready"] is False
    assert "prompt-fingerprint-mismatch:suggest-layout-route-b" in result["errors"]


def test_legacy_report_without_fingerprint_contract_fails_closed() -> None:
    report = _core_report()
    del report["prompt_fingerprint"]

    result = analysis.analyze(report)

    assert result["decision_ready"] is False
    assert "unsupported-or-missing-prompt-fingerprint" in result["errors"]


def test_missing_usage_and_provider_mismatch_fail_closed() -> None:
    report = _core_report()
    missing = report["routes"]["suggest-card-groups-route-b"]
    missing["provider_reported"]["input_tokens"] = None
    missing["status"] = "provider-did-not-report-usage"
    mismatch = report["routes"]["suggest-layout"]
    mismatch["actual_provider"] = "unexpected-provider"

    result = analysis.analyze(report)

    assert result["decision_ready"] is False
    assert result["core_ready"] is False
    assert any(
        error.startswith("route-not-measured:suggest-card-groups-route-b")
        for error in result["errors"]
    )
    assert "provider-mismatch:suggest-layout" in result["errors"]


def test_dry_run_is_not_promoted_to_measurement_evidence() -> None:
    report = _core_report()
    report["executed"] = False
    report["measurement_complete"] = False
    for row in report["routes"].values():
        row["status"] = "dry-run"
        row["provider_reported"]["input_tokens"] = None
        row.pop("actual_provider")
        row.pop("actual_model")

    result = analysis.analyze(report)

    assert result["decision_ready"] is False
    assert "report-not-executed" in result["errors"]
    assert result["core_ready"] is False


def test_false_measurement_complete_claim_is_detected_even_when_rows_are_measured() -> None:
    report = _core_report()
    report["measurement_complete"] = False

    result = analysis.analyze(report)

    assert result["decision_ready"] is False
    assert result["core_ready"] is True
    assert "measurement-complete-claim-false" in result["errors"]


def test_cli_reads_saved_json_and_returns_machine_readable_summary(tmp_path: Path) -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    report_path = tmp_path / "measurement.json"
    report_path.write_text(json.dumps(_core_report()), encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            "scripts/analyze_ai_route_provider_measurement.py",
            str(report_path),
        ],
        cwd=backend_dir,
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)

    assert result["decision_ready"] is True
    assert result["provider"] == "named-provider"
    assert result["model"] == "named-model"
    assert result["context_budget"]["context_window_tokens"] is None



def test_cli_accepts_explicit_context_window_for_hard_fit_only(tmp_path: Path) -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    report_path = tmp_path / "measurement.json"
    report_path.write_text(json.dumps(_core_report()), encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            "scripts/analyze_ai_route_provider_measurement.py",
            str(report_path),
            "--context-window-tokens",
            "10000",
            "--context-window-source",
            "https://provider.example/models/named-model",
        ],
        cwd=backend_dir,
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)

    assert result["decision_ready"] is True
    assert result["context_budget"]["context_window_tokens"] == 10_000
    assert result["context_budget"]["context_window_source"] == (
        "https://provider.example/models/named-model"
    )
    assert result["context_budget"]["core_hard_context_fit"] is False
    assert result["context_budget"]["sufficient_headroom_policy"] is None



def test_cli_rejects_context_window_without_source(tmp_path: Path) -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    report_path = tmp_path / "measurement.json"
    report_path.write_text(json.dumps(_core_report()), encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            "scripts/analyze_ai_route_provider_measurement.py",
            str(report_path),
            "--context-window-tokens",
            "10000",
        ],
        cwd=backend_dir,
        check=False,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)

    assert completed.returncode == 2
    assert result["decision_ready"] is False
    assert result["errors"] == [
        "context-window-argument-error:context_window_source is required when "
        "context_window_tokens is supplied"
    ]


def test_cli_returns_nonzero_for_incomplete_report(tmp_path: Path) -> None:
    backend_dir = Path(__file__).resolve().parents[1]
    report = _core_report()
    del report["routes"]["check-narrative"]
    report_path = tmp_path / "measurement.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")

    completed = subprocess.run(
        [
            sys.executable,
            "scripts/analyze_ai_route_provider_measurement.py",
            str(report_path),
        ],
        cwd=backend_dir,
        check=False,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)

    assert completed.returncode == 2
    assert result["decision_ready"] is False
    assert "missing-core-route:check-narrative" in result["errors"]
