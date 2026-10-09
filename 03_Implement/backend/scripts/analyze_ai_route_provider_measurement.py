#!/usr/bin/env python3
"""Validate and summarize AI route provider-token measurement JSON.

This analyzer is intentionally downstream of ``measure_ai_route_provider_tokens.py``.
It never estimates tokens from prompt bytes/chars and never chooses A2/B/C. Its job is
to answer a narrower question: is a saved measurement report internally complete enough
for the next architecture comparison, and which provider-reported observations are
actually available?

Usage::

    python scripts/analyze_ai_route_provider_measurement.py measurement.json
    cat measurement.json | python scripts/analyze_ai_route_provider_measurement.py -

A dry-run report is valid JSON but is not decision-ready. Missing provider usage,
provider/model mismatches, partial layout-C batches, and malformed route rows are
reported as explicit validation errors rather than being filled from diagnostic bytes.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from sui_sensemaking_api.llm.provider import FINAL_JUDGEMENT_MAX_TOKENS, LLMRequest

try:
    from scripts.measure_ai_route_provider_tokens import (
        _openai_chat_messages_sha256,
        _prompt_sha256,
        build_representative_requests,
    )
except ModuleNotFoundError as exc:
    if exc.name != "scripts":
        raise
    from measure_ai_route_provider_tokens import (
        _openai_chat_messages_sha256,
        _prompt_sha256,
        build_representative_requests,
    )

MEASUREMENT_NAME = "ai-route-provider-reported-input-tokens"
SCENARIO_NAME = "300-cards-30-islands-ring"
PROMPT_FINGERPRINT = {"algorithm": "sha256", "encoding": "utf-8"}
PROVIDER_CALL_PROVENANCE = {"version": 1}
PROVIDER_INPUT_PROVENANCE = {
    "version": 1,
    "deepseek_kind": "openai-chat-messages-v1",
    "algorithm": "sha256",
    "encoding": "utf-8",
}
PROVIDER_GENERATION_PROVENANCE = {
    "version": 1,
    "deepseek_field": "thinking.type",
}
_DEEPSEEK_THINKING_MODES = frozenset({"disabled", "enabled"})
CORE_ROUTE_TASKS = {
    "suggest-card-groups": "suggest_card_groups",
    "suggest-card-groups-route-b": "suggest_card_groups",
    "suggest-layout": "re_layout",
    "suggest-layout-route-b": "re_layout",
    "generate-narrative": "generate_narrative",
    "check-narrative": "check_narrative",
}
CORE_ROUTES = tuple(CORE_ROUTE_TASKS)
GROUPS_A2_ROUTE = "suggest-card-groups-a2-lower-bound"
LAYOUT_C_PREFIX = "suggest-layout-c-"
LAYOUT_C_ROUTES = tuple(
    [f"suggest-layout-c-local-{index:02d}" for index in range(1, 31)]
    + ["suggest-layout-c-global"]
)
LAYOUT_C_REQUESTS = len(LAYOUT_C_ROUTES)
MEASUREMENT_REQUEST_MAX_TOKENS = 1
# Production output reserve per measured task. Three tasks use LLMRequest's default
# cap; check_narrative declares FINAL_JUDGEMENT_MAX_TOKENS because its reasoning tokens
# count against max_tokens. test_ai_route_production_output_budget_contract pins that
# each route's LLMRequest uses exactly the constant listed here.
# Measurement requests deliberately use max_tokens=1 only to minimize external cost.
DEFAULT_PRODUCTION_OUTPUT_RESERVE_TOKENS = LLMRequest(
    task="context_budget_probe", prompt="probe"
).max_tokens
PRODUCTION_OUTPUT_RESERVE_TOKENS_BY_TASK = {
    "suggest_card_groups": DEFAULT_PRODUCTION_OUTPUT_RESERVE_TOKENS,
    "re_layout": DEFAULT_PRODUCTION_OUTPUT_RESERVE_TOKENS,
    "generate_narrative": DEFAULT_PRODUCTION_OUTPUT_RESERVE_TOKENS,
    "check_narrative": FINAL_JUDGEMENT_MAX_TOKENS,
}
# Kept as the default-cap value for continuity with earlier reports.
CURRENT_PRODUCTION_OUTPUT_RESERVE_TOKENS = DEFAULT_PRODUCTION_OUTPUT_RESERVE_TOKENS


def production_task_for_route(name: str) -> str:
    if name in CORE_ROUTE_TASKS:
        return CORE_ROUTE_TASKS[name]
    if name == GROUPS_A2_ROUTE:
        return "suggest_card_groups"
    if name.startswith(LAYOUT_C_PREFIX):
        return "re_layout"
    raise ValueError(f"unknown measured route: {name}")


def output_reserve_for_route(name: str) -> int:
    return PRODUCTION_OUTPUT_RESERVE_TOKENS_BY_TASK[production_task_for_route(name)]


def _int_token(row: dict[str, Any]) -> int | None:
    value = (row.get("provider_reported") or {}).get("input_tokens")
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _validate_measured_route(
    *,
    name: str,
    row: Any,
    expected_task: str,
    expected_provider: str,
    expected_model: str,
    expected_prompt_sha256: str | None,
    expected_deepseek_input_sha256: str | None,
    expected_deepseek_thinking_mode: str | None,
    errors: list[str],
) -> int | None:
    if not isinstance(row, dict):
        errors.append(f"route-not-object:{name}")
        return None
    if row.get("task") != expected_task:
        errors.append(f"task-mismatch:{name}")
        return None
    prompt = row.get("prompt")
    if not isinstance(prompt, dict):
        errors.append(f"prompt-diagnostics-missing:{name}")
        return None
    if expected_prompt_sha256 is None:
        errors.append(f"canonical-prompt-missing:{name}")
        return None
    if prompt.get("sha256") != expected_prompt_sha256:
        errors.append(f"prompt-fingerprint-mismatch:{name}")
        return None
    if row.get("status") != "measured":
        errors.append(f"route-not-measured:{name}:{row.get('status')}")
        return None
    if row.get("actual_provider") != expected_provider:
        errors.append(f"provider-mismatch:{name}")
        return None
    if row.get("actual_model") != expected_model:
        errors.append(f"model-mismatch:{name}")
        return None

    provider_call = row.get("provider_call")
    if not isinstance(provider_call, dict):
        errors.append(f"provider-call-metadata-missing:{name}")
        return None
    if provider_call.get("provider") != expected_provider:
        errors.append(f"provider-call-provider-mismatch:{name}")
        return None
    if provider_call.get("provider_kind") != row.get("actual_provider_kind"):
        errors.append(f"provider-call-kind-mismatch:{name}")
        return None
    if provider_call.get("model_id") != expected_model:
        errors.append(f"provider-call-model-mismatch:{name}")
        return None
    for field in ("transport", "requested_at", "trace_id"):
        value = provider_call.get(field)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"provider-call-{field}-missing:{name}")
            return None
    if provider_call.get("fallback_to_none") is not False:
        errors.append(f"provider-call-fallback-detected:{name}")
        return None
    if provider_call.get("execution_path") != "primary":
        errors.append(f"provider-call-non-primary-path:{name}")
        return None

    if row.get("actual_provider_kind") == "deepseek":
        provider_input = row.get("provider_input")
        if not isinstance(provider_input, dict):
            errors.append(f"provider-input-fingerprint-missing:{name}")
            return None
        if provider_input.get("kind") != "openai-chat-messages-v1":
            errors.append(f"provider-input-kind-mismatch:{name}")
            return None
        if (
            expected_deepseek_input_sha256 is None
            or provider_input.get("sha256") != expected_deepseek_input_sha256
        ):
            errors.append(f"provider-input-fingerprint-mismatch:{name}")
            return None
        provider_generation = row.get("provider_generation")
        if not isinstance(provider_generation, dict):
            errors.append(f"provider-generation-metadata-missing:{name}")
            return None
        if provider_generation.get("thinking_mode") != expected_deepseek_thinking_mode:
            errors.append(f"provider-generation-mode-mismatch:{name}")
            return None

    token = _int_token(row)
    if token is None:
        errors.append(f"input-usage-missing:{name}")
        return None
    return token



def _context_budget_summary(
    tokens: dict[str, int],
    *,
    layout_c_tokens: list[int],
    context_window_tokens: int | None,
    context_window_source: str | None,
) -> dict[str, Any]:
    """Separate measured input usage from the current production output reserve.

    This is a hard context-fit calculation only. It intentionally does not invent
    an architectural headroom percentage or choose A2/B/C.
    """
    if context_window_tokens is not None and (
        isinstance(context_window_tokens, bool)
        or not isinstance(context_window_tokens, int)
        or context_window_tokens <= 0
    ):
        raise ValueError("context_window_tokens must be a positive integer")
    if context_window_tokens is None:
        if context_window_source is not None:
            raise ValueError(
                "context_window_source requires context_window_tokens"
            )
        normalized_context_window_source = None
    else:
        if not isinstance(context_window_source, str) or not context_window_source.strip():
            raise ValueError(
                "context_window_source is required when context_window_tokens is supplied"
            )
        normalized_context_window_source = context_window_source.strip()

    route_requirements: dict[str, dict[str, Any]] = {}
    for name in sorted(tokens):
        input_tokens = tokens[name]
        reserve = output_reserve_for_route(name)
        minimum = input_tokens + reserve
        remaining = (
            None
            if context_window_tokens is None
            else context_window_tokens - minimum
        )
        route_requirements[name] = {
            "provider_reported_input_tokens": input_tokens,
            "output_reserve_tokens": reserve,
            "minimum_context_tokens": minimum,
            "remaining_context_tokens": remaining,
            "hard_context_fit": None if remaining is None else remaining >= 0,
        }

    core_requirements = [
        route_requirements[name]
        for name in CORE_ROUTES
        if name in route_requirements
    ]
    layout_c_minimum_context = (
        max(layout_c_tokens) + PRODUCTION_OUTPUT_RESERVE_TOKENS_BY_TASK["re_layout"]
        if len(layout_c_tokens) == LAYOUT_C_REQUESTS
        else None
    )
    groups_a2_requirement = route_requirements.get(GROUPS_A2_ROUTE)

    def _all_fit(rows: list[dict[str, Any]], *, complete: bool) -> bool | None:
        if context_window_tokens is None or not complete:
            return None
        return all(row["hard_context_fit"] is True for row in rows)

    return {
        "measurement_request_max_tokens": MEASUREMENT_REQUEST_MAX_TOKENS,
        "current_production_output_reserve_tokens": (
            CURRENT_PRODUCTION_OUTPUT_RESERVE_TOKENS
        ),
        "production_output_reserve_tokens_by_task": dict(
            PRODUCTION_OUTPUT_RESERVE_TOKENS_BY_TASK
        ),
        "output_reserve_source": (
            "LLMRequest.default.max_tokens; check_narrative uses FINAL_JUDGEMENT_MAX_TOKENS"
        ),
        "context_window_tokens": context_window_tokens,
        "context_window_source": normalized_context_window_source,
        "context_window_source_kind": (
            "operator-supplied-document-reference"
            if normalized_context_window_source is not None
            else None
        ),
        "route_requirements": route_requirements,
        "core_hard_context_fit": _all_fit(
            core_requirements, complete=len(core_requirements) == len(CORE_ROUTES)
        ),
        "groups_a2_hard_context_fit": (
            None
            if context_window_tokens is None or groups_a2_requirement is None
            else groups_a2_requirement["hard_context_fit"]
        ),
        "layout_c_hard_context_fit": (
            None
            if context_window_tokens is None or layout_c_minimum_context is None
            else layout_c_minimum_context <= context_window_tokens
        ),
        "layout_c_max_single_minimum_context_tokens": layout_c_minimum_context,
        "sufficient_headroom_policy": None,
        "interpretation": (
            "minimum_context_tokens = provider-reported input_tokens + the current "
            "production LLMRequest output reserve. A supplied context window only "
            "answers hard fit and must carry an operator-supplied documentation reference; "
            "the analyzer records but does not verify that reference. It does not define a "
            "safety-margin percentage."
        ),
    }


def analyze(
    report: Any,
    *,
    context_window_tokens: int | None = None,
    context_window_source: str | None = None,
) -> dict[str, Any]:
    """Return a fail-closed comparison-readiness summary for one saved report."""
    errors: list[str] = []
    if not isinstance(report, dict):
        return {
            "analysis": "ai-route-provider-measurement-readiness",
            "decision_ready": False,
            "errors": ["report-not-object"],
        }

    if report.get("measurement") != MEASUREMENT_NAME:
        errors.append("unexpected-measurement-kind")
    if report.get("scenario") != SCENARIO_NAME:
        errors.append("unexpected-scenario")
    if report.get("prompt_fingerprint") != PROMPT_FINGERPRINT:
        errors.append("unsupported-or-missing-prompt-fingerprint")
    if report.get("provider_call_provenance") != PROVIDER_CALL_PROVENANCE:
        errors.append("unsupported-or-missing-provider-call-provenance")

    expected_provider = report.get("expected_provider")
    expected_model = report.get("expected_model")
    if not isinstance(expected_provider, str) or not expected_provider.strip():
        errors.append("missing-expected-provider")
        expected_provider = ""
    if not isinstance(expected_model, str) or not expected_model.strip():
        errors.append("missing-expected-model")
        expected_model = ""

    executed = report.get("executed") is True
    if not executed:
        errors.append("report-not-executed")

    routes = report.get("routes")
    if not isinstance(routes, dict):
        errors.append("routes-not-object")
        routes = {}

    include_groups_a2 = GROUPS_A2_ROUTE in routes
    include_layout_c = any(name.startswith(LAYOUT_C_PREFIX) for name in routes)
    canonical_requests = (
        build_representative_requests(
            expected_model,
            include_groups_a2=include_groups_a2,
            include_layout_c=include_layout_c,
        )
        if expected_model
        else {}
    )
    canonical_prompt_hashes = {
        name: _prompt_sha256(req.prompt) for name, req in canonical_requests.items()
    }
    for name, req in canonical_requests.items():
        if req.max_tokens != MEASUREMENT_REQUEST_MAX_TOKENS:
            errors.append(
                f"measurement-max-tokens-drift:{name}:{req.max_tokens}"
            )
    canonical_deepseek_input_hashes = {
        name: _openai_chat_messages_sha256(req)
        for name, req in canonical_requests.items()
    }
    has_deepseek_measurement = any(
        isinstance(row, dict) and row.get("actual_provider_kind") == "deepseek"
        for row in routes.values()
    )
    expected_deepseek_thinking_mode = report.get("expected_deepseek_thinking_mode")
    if has_deepseek_measurement:
        if report.get("provider_input_provenance") != PROVIDER_INPUT_PROVENANCE:
            errors.append("unsupported-or-missing-provider-input-provenance")
        if (
            report.get("provider_generation_provenance")
            != PROVIDER_GENERATION_PROVENANCE
        ):
            errors.append("unsupported-or-missing-provider-generation-provenance")
        if expected_deepseek_thinking_mode not in _DEEPSEEK_THINKING_MODES:
            errors.append("missing-or-invalid-expected-deepseek-thinking-mode")
            expected_deepseek_thinking_mode = None
    for unexpected in sorted(set(routes) - set(canonical_requests)):
        errors.append(f"unexpected-route:{unexpected}")

    tokens: dict[str, int] = {}
    for name, expected_task in CORE_ROUTE_TASKS.items():
        if name not in routes:
            errors.append(f"missing-core-route:{name}")
            continue
        token = _validate_measured_route(
            name=name,
            row=routes[name],
            expected_task=expected_task,
            expected_provider=expected_provider,
            expected_model=expected_model,
            expected_prompt_sha256=canonical_prompt_hashes.get(name),
            expected_deepseek_input_sha256=canonical_deepseek_input_hashes.get(name),
            expected_deepseek_thinking_mode=expected_deepseek_thinking_mode,
            errors=errors,
        )
        if token is not None:
            tokens[name] = token

    groups_a2_present = GROUPS_A2_ROUTE in routes
    if groups_a2_present:
        token = _validate_measured_route(
            name=GROUPS_A2_ROUTE,
            row=routes[GROUPS_A2_ROUTE],
            expected_task="suggest_card_groups",
            expected_provider=expected_provider,
            expected_model=expected_model,
            expected_prompt_sha256=canonical_prompt_hashes.get(GROUPS_A2_ROUTE),
            expected_deepseek_input_sha256=canonical_deepseek_input_hashes.get(
                GROUPS_A2_ROUTE
            ),
            expected_deepseek_thinking_mode=expected_deepseek_thinking_mode,
            errors=errors,
        )
        if token is not None:
            tokens[GROUPS_A2_ROUTE] = token

    layout_c_names = sorted(name for name in routes if name.startswith(LAYOUT_C_PREFIX))
    layout_c_present = bool(layout_c_names)
    expected_layout_c = set(LAYOUT_C_ROUTES)
    actual_layout_c = set(layout_c_names)
    layout_c_tokens: list[int] = []
    if layout_c_present:
        for missing in sorted(expected_layout_c - actual_layout_c):
            errors.append(f"layout-c-missing-route:{missing}")
        for unexpected in sorted(actual_layout_c - expected_layout_c):
            errors.append(f"layout-c-unexpected-route:{unexpected}")
        for name in layout_c_names:
            token = _validate_measured_route(
                name=name,
                row=routes[name],
                expected_task="re_layout",
                expected_provider=expected_provider,
                expected_model=expected_model,
                expected_prompt_sha256=canonical_prompt_hashes.get(name),
                expected_deepseek_input_sha256=canonical_deepseek_input_hashes.get(name),
                expected_deepseek_thinking_mode=expected_deepseek_thinking_mode,
                errors=errors,
            )
            if token is not None and name in expected_layout_c:
                layout_c_tokens.append(token)

    core_ready = all(name in tokens for name in CORE_ROUTES)
    groups_a2_ready = groups_a2_present and GROUPS_A2_ROUTE in tokens
    layout_c_ready = (
        layout_c_present
        and actual_layout_c == expected_layout_c
        and len(layout_c_tokens) == LAYOUT_C_REQUESTS
    )

    groups: dict[str, Any] = {
        "current_input_tokens": tokens.get("suggest-card-groups"),
        "route_b_input_tokens": tokens.get("suggest-card-groups-route-b"),
        "a2_input_tokens": tokens.get(GROUPS_A2_ROUTE),
        "a2_measured": groups_a2_ready,
        "route_b_minus_current_input_tokens": None,
        "a2_minus_route_b_input_tokens": None,
    }
    if {
        "suggest-card-groups",
        "suggest-card-groups-route-b",
    }.issubset(tokens):
        groups["route_b_minus_current_input_tokens"] = (
            tokens["suggest-card-groups-route-b"] - tokens["suggest-card-groups"]
        )
    if groups_a2_ready and "suggest-card-groups-route-b" in tokens:
        groups["a2_minus_route_b_input_tokens"] = (
            tokens[GROUPS_A2_ROUTE] - tokens["suggest-card-groups-route-b"]
        )

    layout: dict[str, Any] = {
        "current_input_tokens": tokens.get("suggest-layout"),
        "route_b_input_tokens": tokens.get("suggest-layout-route-b"),
        "route_b_minus_current_input_tokens": None,
        "a2_reuses_route_b_observation": True,
        "a2_reuse_reason": (
            "R29 fixed the representative layout A2 and route-B rendered prompts as "
            "identical under the same task/model/max_tokens contract; no duplicate "
            "provider request is required."
        ),
        "layout_c_measured": layout_c_ready,
        "layout_c_requests": len(layout_c_names),
        "layout_c_max_single_input_tokens": (
            max(layout_c_tokens) if layout_c_ready else None
        ),
        "layout_c_aggregate_input_tokens": (
            sum(layout_c_tokens) if layout_c_ready else None
        ),
    }
    if {"suggest-layout", "suggest-layout-route-b"}.issubset(tokens):
        layout["route_b_minus_current_input_tokens"] = (
            tokens["suggest-layout-route-b"] - tokens["suggest-layout"]
        )

    whole_document = {
        "generate_narrative_input_tokens": tokens.get("generate-narrative"),
        "check_narrative_input_tokens": tokens.get("check-narrative"),
        "check_minus_generate_input_tokens": None,
    }
    if {"generate-narrative", "check-narrative"}.issubset(tokens):
        whole_document["check_minus_generate_input_tokens"] = (
            tokens["check-narrative"] - tokens["generate-narrative"]
        )

    # ``measurement_complete`` is useful evidence but is not trusted by itself:
    # every route row is revalidated above. Conversely, a complete six-route core
    # report remains usable even when optional A2/C observations were not requested.
    measurement_complete_claim = report.get("measurement_complete") is True
    if executed and core_ready and not measurement_complete_claim:
        errors.append("measurement-complete-claim-false")

    context_budget = _context_budget_summary(
        tokens,
        layout_c_tokens=layout_c_tokens,
        context_window_tokens=context_window_tokens,
        context_window_source=context_window_source,
    )

    return {
        "analysis": "ai-route-provider-measurement-readiness",
        "scenario": report.get("scenario"),
        "provider": expected_provider or None,
        "model": expected_model or None,
        "executed": executed,
        "core_ready": core_ready,
        "groups_a2_ready": groups_a2_ready,
        "layout_c_ready": layout_c_ready,
        "decision_ready": executed and core_ready and not errors,
        "errors": errors,
        "observations": {
            "groups": groups,
            "layout": layout,
            "whole_document": whole_document,
        },
        "context_budget": context_budget,
        "interpretation_boundary": (
            "All token observations and deltas come only from provider_reported.input_tokens. "
            "Prompt/provider-input SHA-256 values are identity/provenance only; bytes, chars, "
            "and hashes are never converted into tokens. DeepSeek measurements additionally bind "
            "the exact current OpenAI-chat system+user message content and record the explicit "
            "thinking.type used by the transport. That generation mode is provenance, not a token "
            "estimate. Context minimums add the "
            "current production LLMRequest output reserve to provider-reported input usage; an "
            "operator-supplied context window can establish hard fit only when its documentation "
            "reference is recorded. The reference is provenance, not independently verified by "
            "this analyzer. No safety-margin percentage is invented and this analyzer does not "
            "choose A2/B/C."
        ),
    }


def _load(path: str) -> Any:
    if path == "-":
        return json.load(sys.stdin)
    with Path(path).open(encoding="utf-8") as handle:
        return json.load(handle)


def _positive_token_count(raw: str) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be an integer") from exc
    if value <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return value


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", help="measurement JSON path, or '-' to read stdin")
    parser.add_argument(
        "--context-window-tokens",
        type=_positive_token_count,
        default=None,
        help=(
            "Optional documented context-window size for the named model. "
            "Used only for hard-fit arithmetic; it does not change measurement readiness "
            "or define an architectural safety-margin percentage."
        ),
    )
    parser.add_argument(
        "--context-window-source",
        default=None,
        help=(
            "Required with --context-window-tokens: provider/model documentation URL, "
            "document identifier, or equivalent audit reference for that context-window value."
        ),
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        result = analyze(
            _load(args.report),
            context_window_tokens=args.context_window_tokens,
            context_window_source=args.context_window_source,
        )
    except (OSError, json.JSONDecodeError) as exc:
        result = {
            "analysis": "ai-route-provider-measurement-readiness",
            "decision_ready": False,
            "errors": [f"measurement-report-read-error:{type(exc).__name__}"],
        }
    except ValueError as exc:
        result = {
            "analysis": "ai-route-provider-measurement-readiness",
            "decision_ready": False,
            "errors": [f"context-window-argument-error:{exc}"],
        }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("decision_ready") else 2


if __name__ == "__main__":
    raise SystemExit(main())
