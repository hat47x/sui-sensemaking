#!/usr/bin/env python3
"""`check-narrative` が、物語から欠けた島を「問題なし」と答えずに検出できるかを評価する。

価値への寄与（意味の保全）: AI 支援が、保留や異論を持つ島の欠落を黙って見逃すと、
人間が残した判断が落ちる。プロバイダ・モデル・思考モードを変えたとき、検出率が
下がっていないかを、同じ合成ケースで再確認できるようにする。

ケースは `representative_document()` から作る合成データだけである（利用者の実データは使わない）。

- 欠落ケース: 物語から島を1つだけ除く。除いた島、またはその島のカードを参照する指摘があれば検出。
- 対照ケース: 物語を欠かさない。除外した島への指摘が出れば誤検出（偽陽性）として数える。

既定はドライラン（ネットワークなし）。送信には `--execute` と
`SUI_TOKEN_MEASUREMENT_OPT_IN=1` の両方が必要で、現在設定されているプロバイダ名・
モデルIDの一致も確認する。指摘の有無だけを集計し、利用者向けのスコアは作らない。
標本が小さいときの過信を避けるため、Wilson 95% 下限を基準と比べる。
"""

from __future__ import annotations

import argparse
import json
import math
import os
from typing import Any, Protocol

from sui_sensemaking_api.llm.provider import (
    LLMRequest,
    LLMResponse,
    FINAL_JUDGEMENT_MAX_TOKENS,
    ProviderError,
    get_provider,
)
from sui_sensemaking_api.models_ai import CheckNarrativeRequest
from sui_sensemaking_api.routes.ai import _build_narrative_check_prompt

try:
    from scripts.measure_ai_route_prompt_coverage import representative_document
except ModuleNotFoundError as exc:
    if exc.name != "scripts":
        raise
    from measure_ai_route_prompt_coverage import representative_document

OPT_IN_ENV = "SUI_TOKEN_MEASUREMENT_OPT_IN"
_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})


class _Provider(Protocol):
    provider_name: str
    provider_kind: str

    def generate(self, req: LLMRequest) -> LLMResponse:
        ...


def build_case(*, islands: int, drop_index: int | None) -> dict[str, Any]:
    """合成ケースを作る。`drop_index=None` は欠落のない対照ケース。"""
    doc = representative_document(include_evidence=False)
    doc["islands"] = doc["islands"][:islands]
    keep = {card_id for island in doc["islands"] for card_id in island["cardIds"]}
    doc["cards"] = [card for card in doc["cards"] if card["id"] in keep]
    doc["edges"] = [
        edge for edge in doc.get("edges", []) if edge["fromId"] in keep and edge["toId"] in keep
    ]
    doc.pop("readingOrder", None)
    cards = {card["id"]: card for card in doc["cards"]}
    # 各島の全カードに言及する。先頭カードだけだと、島内の他のカードが
    # 「言及されていない」のは正しい指摘になり、島単位の欠落と区別できない。
    lines = [
        island["title"] + ": " + " ".join(cards[card_id]["text"] for card_id in island["cardIds"])
        for island in doc["islands"]
    ]
    omitted: dict[str, Any] | None = None
    if drop_index is not None:
        omitted = doc["islands"][drop_index]
        del lines[drop_index]
    request = CheckNarrativeRequest.model_validate(
        {"doc": doc, "narrativeText": "\n".join(lines)}
    )
    return {
        "prompt": _build_narrative_check_prompt(request),
        "omitted_island_id": omitted["id"] if omitted else None,
        "omitted_card_ids": sorted(omitted["cardIds"]) if omitted else [],
        "island_ids": [island["id"] for island in doc["islands"]],
    }


def referenced_ids(raw_text: str) -> set[str] | None:
    """応答 JSON の指摘が参照する id 集合。JSON として読めなければ None。"""
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    ids: set[str] = set()
    for issue in parsed.get("issues") or []:
        for reference in (issue.get("references") or []) if isinstance(issue, dict) else []:
            if isinstance(reference, dict) and isinstance(reference.get("id"), str):
                ids.add(reference["id"])
    return ids


def omission_claims(raw_text: str) -> int | None:
    """「島が物語にない」（a_missing_in_b）と主張する指摘の件数。読めなければ None。"""
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    return sum(
        1
        for issue in parsed.get("issues") or []
        if isinstance(issue, dict) and issue.get("direction") == "a_missing_in_b"
    )


def is_detected(case: dict[str, Any], ids: set[str] | None) -> bool:
    if ids is None or case["omitted_island_id"] is None:
        return False
    return case["omitted_island_id"] in ids or bool(ids & set(case["omitted_card_ids"]))


def wilson_lower_bound(successes: int, trials: int, z: float = 1.96) -> float:
    if trials == 0:
        return 0.0
    p = successes / trials
    denominator = 1 + z * z / trials
    centre = p + z * z / (2 * trials)
    margin = z * math.sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials))
    return max(0.0, (centre - margin) / denominator)


def plan(*, islands: int, trials: int) -> list[int | None]:
    """欠落させる島の位置を等間隔にずらした `trials` 件と、対照 `trials` 件。"""
    drops: list[int | None] = [(index * 7 + 2) % islands for index in range(trials)]
    return [*drops, *([None] * trials)]


def evaluate(
    *,
    model: str,
    expected_provider: str,
    islands: int = 30,
    trials: int = 20,
    min_detection: float = 0.8,
    execute: bool = False,
    provider: _Provider | None = None,
) -> dict[str, Any]:
    if not model.strip() or not expected_provider.strip():
        raise ValueError("`model` と `expected_provider` は必須です")
    if not 2 <= islands <= 30 or trials < 1:
        raise ValueError("islands は2〜30、trials は1以上にしてください")
    cases = [build_case(islands=islands, drop_index=drop) for drop in plan(islands=islands, trials=trials)]
    report: dict[str, Any] = {
        "evaluation": "check-narrative-omitted-island-detection",
        "islands": islands,
        "trials_per_arm": trials,
        "min_detection_wilson_lower_bound": min_detection,
        "prompt_utf8_bytes": len(cases[0]["prompt"].encode("utf-8")),
        "executed": execute,
        "boundary": "合成データだけを使う。件数は指摘の有無の集計であり、利用者の内容に対するスコアではない。",
    }
    if not execute:
        return report
    if provider is None:
        raise ValueError("`execute=True` の場合はプロバイダーが必要です")
    if provider.provider_name != expected_provider:
        raise ValueError("現在設定されているプロバイダー名が、指定した名前と一致しません")

    detected = false_positive = unreadable = errors = 0
    thinking_modes: set[str | None] = set()
    input_tokens: list[int] = []
    for case in cases:
        try:
            response = provider.generate(
                LLMRequest(
                    task="check_narrative",
                    prompt=case["prompt"],
                    model=model,
                    max_tokens=FINAL_JUDGEMENT_MAX_TOKENS,
                )
            )
        except ProviderError:
            errors += 1
            continue
        if response.metadata.model_id != model:
            raise ValueError("実際に使われたモデルIDが、指定したモデルIDと一致しません")
        thinking_modes.add(response.metadata.thinking_mode)
        if response.input_tokens is not None:
            input_tokens.append(response.input_tokens)
        ids = referenced_ids(response.raw_text)
        if ids is None:
            unreadable += 1
        elif case["omitted_island_id"] is None:
            # 対照ケースは、どの島も欠けていない。「島が物語にない」という指摘は誤検出とみなす。
            false_positive += bool(omission_claims(response.raw_text))
        else:
            detected += is_detected(case, ids)

    lower = wilson_lower_bound(detected, trials)
    report.update(
        {
            "detected": detected,
            "omitted_trials": trials,
            "detection_wilson_lower_bound": round(lower, 3),
            "control_false_positives": false_positive,
            "control_trials": trials,
            "unreadable_responses": unreadable,
            "provider_errors": errors,
            "thinking_modes_seen": sorted(mode or "unreported" for mode in thinking_modes),
            "max_input_tokens_reported": max(input_tokens) if input_tokens else None,
            "meets_minimum": lower >= min_detection and errors == 0 and unreadable == 0,
        }
    )
    return report


def _opted_in() -> bool:
    return os.environ.get(OPT_IN_ENV, "").strip().lower() in _TRUE_VALUES


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", required=True, help="期待する `provider_name`（例: deepseek）。")
    parser.add_argument("--model", required=True, help="使用する正確なモデルID。")
    parser.add_argument("--islands", type=int, default=30, help="島の数（2〜30、30島は300カード）。")
    parser.add_argument("--trials", type=int, default=20, help="欠落ケースと対照ケースそれぞれの回数。")
    parser.add_argument("--min-detection", type=float, default=0.8, help="検出率の Wilson 下限の基準。")
    parser.add_argument(
        "--execute",
        action="store_true",
        help=f"合成プロンプトを実際に送信する。{OPT_IN_ENV}=1 も必要。",
    )
    return parser


def main() -> int:
    args = _parser().parse_args()
    common = {
        "model": args.model,
        "expected_provider": args.provider,
        "islands": args.islands,
        "trials": args.trials,
        "min_detection": args.min_detection,
    }
    if not args.execute:
        print(json.dumps(evaluate(**common), ensure_ascii=False, indent=2))
        return 0
    if not _opted_in():
        print(json.dumps({"status": "external-execution-not-opted-in", "required_env": OPT_IN_ENV}))
        return 2
    try:
        report = evaluate(**common, execute=True, provider=get_provider())
    except ValueError as exc:
        print(json.dumps({"status": "configuration-mismatch", "message": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["meets_minimum"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
