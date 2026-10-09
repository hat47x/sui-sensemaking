from __future__ import annotations

import ast
import inspect
import textwrap
from collections.abc import Callable

from sui_sensemaking_api.llm.provider import LLMRequest
from sui_sensemaking_api.routes import ai
from scripts import analyze_ai_route_provider_measurement as analysis


# AI-IR-SCALE-01 R43: R39's hard-context arithmetic assumes that every
# production task represented by the provider-token harness uses the same
# LLMRequest output reserve. Keep that assumption tied to the actual production
# call sites rather than to prose or a copied literal.
_PRODUCTION_TASK_FUNCTIONS: dict[str, Callable[..., object]] = {
    "suggest_card_groups": ai.suggest_card_groups,
    "re_layout": ai.suggest_layout,
    "generate_narrative": ai.generate_narrative,
    "check_narrative": ai.check_narrative,
}


def _llm_request_calls(function: Callable[..., object]) -> list[ast.Call]:
    tree = ast.parse(textwrap.dedent(inspect.getsource(function)))
    return [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "LLMRequest"
    ]


def _string_keyword(call: ast.Call, name: str) -> str | None:
    matches = [keyword.value for keyword in call.keywords if keyword.arg == name]
    assert len(matches) <= 1
    if not matches:
        return None
    value = matches[0]
    assert isinstance(value, ast.Constant)
    assert isinstance(value.value, str)
    return value.value


def test_measured_production_tasks_share_the_analyzer_output_reserve_contract() -> None:
    production_default = LLMRequest(task="r43_probe", prompt="probe").max_tokens

    # CORE_ROUTE_TASKS contains current/B measurement variants, so compare its
    # unique production task identities with the actual route functions.
    assert set(analysis.CORE_ROUTE_TASKS.values()) == set(_PRODUCTION_TASK_FUNCTIONS)
    assert analysis.CURRENT_PRODUCTION_OUTPUT_RESERVE_TOKENS == production_default

    for expected_task, function in _PRODUCTION_TASK_FUNCTIONS.items():
        calls = _llm_request_calls(function)
        assert len(calls) == 1, (
            f"{function.__name__} changed its LLMRequest construction shape; "
            "re-evaluate AI-IR-SCALE-01 context-budget accounting"
        )
        call = calls[0]
        assert _string_keyword(call, "task") == expected_task

        # A route may override max_tokens only when the analyzer declares that task's
        # reserve. The override must be the named FINAL_JUDGEMENT_MAX_TOKENS constant
        # and must equal the analyzer's reserve for that task (R39/R43 accounting).
        max_tokens = [keyword.value for keyword in call.keywords if keyword.arg == "max_tokens"]
        if not max_tokens:
            assert (
                analysis.PRODUCTION_OUTPUT_RESERVE_TOKENS_BY_TASK[expected_task]
                == production_default
            ), f"{function.__name__} uses the default cap; analyzer reserve must match it"
            continue
        assert len(max_tokens) == 1
        assert isinstance(max_tokens[0], ast.Name)
        assert max_tokens[0].id == "FINAL_JUDGEMENT_MAX_TOKENS", (
            f"{function.__name__} overrides max_tokens with an undeclared value"
        )
        assert analysis.PRODUCTION_OUTPUT_RESERVE_TOKENS_BY_TASK[expected_task] == ai.FINAL_JUDGEMENT_MAX_TOKENS
