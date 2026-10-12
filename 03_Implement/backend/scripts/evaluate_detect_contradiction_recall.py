#!/usr/bin/env python3
"""`detect-contradiction` が、人間が残した矛盾を「矛盾なし」と答えずに検出できるかを評価する。

価値への寄与（意味の保全）: 人間が図に残した異論（矛盾する2枚）を、AI 支援が黙って
「矛盾なし」と答えると、異論が落ちる。プロバイダ・モデル・思考モードを変えたとき、
検出率が下がっていないかを、同じ合成ケースで再確認できるようにする。

このルートは文書全体から矛盾を探すのではなく、`cardA` と `cardB` の2枚を比べて
`{"hasContradiction": bool, "explanation": str}` を返す。応答はカードIDを参照しないため、
「計画した組に `hasContradiction=true` を返したか」で検出を数える。

ケースは `representative_document()`（300カード・30島）から作る合成データだけである
（利用者の実データは使わない）。

- 矛盾ケース: 異なる2つの島のレビュー済みカードに、主張とその否定を置く。
- 対照ケース: 同じ位置・同じ題材で、矛盾しない記述（別の側面、または否定形で言い換えた同意）を置く。
  `hasContradiction=true` は誤検出（偽陽性）として数える。

プロンプトとIRは、本番ルートの `_detect_contradiction_ir` / `_build_detect_contradiction_prompt`
で作る。リクエスト設定（task、`FINAL_JUDGEMENT_MAX_TOKENS`、`inputs`）も本番と同じにする。

既定はドライラン（ネットワークなし）。送信には `--execute` と
`SUI_TOKEN_MEASUREMENT_OPT_IN=1` の両方が必要で、現在設定されているプロバイダ名・
モデルIDの一致も確認する。応答の内容は保存せず、件数だけを集計する（内容へのスコアは作らない）。
標本が小さいときの過信を避けるため、Wilson 95% 下限を基準と比べる。
"""

from __future__ import annotations

import argparse
import json
from typing import Any, Protocol

from sui_sensemaking_api.llm.provider import (
    FINAL_JUDGEMENT_MAX_TOKENS,
    LLMRequest,
    LLMResponse,
    ProviderError,
    get_provider,
    resolve_model_for_task,
)
from sui_sensemaking_api.llm_input_ir import adjudicated_contradiction
from sui_sensemaking_api.models_ai import DetectContradictionRequest
from sui_sensemaking_api.routes.ai import (
    _build_detect_contradiction_prompt,
    _detect_contradiction_ir,
    _parse_detect_contradiction_response,
    _reject_unreviewed_cards,
)

try:
    from scripts import evaluate_check_narrative_omission as narrative_eval
    from scripts.measure_ai_route_prompt_coverage import representative_document
except ModuleNotFoundError as exc:
    if exc.name != "scripts":
        raise
    import evaluate_check_narrative_omission as narrative_eval
    from measure_ai_route_prompt_coverage import representative_document

OPT_IN_ENV = narrative_eval.OPT_IN_ENV
wilson_lower_bound = narrative_eval.wilson_lower_bound

# DeepSeek（deepseek-flash）のピーク時の上限見積もり。他のプロバイダでは引数で上書きする。
DEFAULT_USD_PER_MILLION_INPUT = 0.30
DEFAULT_USD_PER_MILLION_OUTPUT = 1.20

CONTROL_KINDS = ("different_aspect", "negated_paraphrase")

# 合成の題材。claim と negation は同時に成り立たない。compatible は claim と両立する。
#   different_aspect: 同じ題材の別の側面を述べる。
#   negated_paraphrase: 否定形の語を含むが、claim と同じことを言い換える。
TOPICS: tuple[dict[str, str], ...] = (
    {
        "claim": "窓口の待ち時間は、いつも10分以内に収まっている。",
        "negation": "窓口の待ち時間が10分以内に収まったことは、一度もない。",
        "different_aspect": "窓口の案内表示は、文字が小さくて読みにくい。",
        "negated_paraphrase": "窓口で待たされても、10分を超えることはない。",
    },
    {
        "claim": "新しい申請フォームを導入してから、入力ミスは減った。",
        "negation": "新しい申請フォームを導入しても、入力ミスは減っていない。",
        "different_aspect": "新しい申請フォームは、スマートフォンでも開くことができる。",
        "negated_paraphrase": "新しい申請フォームを導入してから、入力ミスが増えたとは言えない。",
    },
    {
        "claim": "参加者の全員が、事前の資料を読んでから会議に臨んだ。",
        "negation": "事前の資料を読んでから会議に臨んだ参加者は、一人もいなかった。",
        "different_aspect": "会議は、予定していた時刻に始まった。",
        "negated_paraphrase": "事前の資料に目を通していない参加者は、一人もいなかった。",
    },
    {
        "claim": "この地域では、夜間の移動手段が足りていない。",
        "negation": "この地域では、夜間の移動手段が十分に足りている。",
        "different_aspect": "この地域では、昼間の路線バスの本数が多い。",
        "negated_paraphrase": "この地域の夜間は、移動手段が十分とは言えない。",
    },
    {
        "claim": "担当者は、利用者の要望を最後まで聞いてから回答した。",
        "negation": "担当者は、利用者の要望を最後まで聞かずに回答した。",
        "different_aspect": "担当者は、回答の内容を書面でも利用者に渡した。",
        "negated_paraphrase": "担当者は、利用者の要望を途中でさえぎらずに回答した。",
    },
    {
        "claim": "試作品の操作は、初めての人が全員、迷わずにできた。",
        "negation": "試作品の操作では、初めての人が全員、途中で迷っていた。",
        "different_aspect": "試作品の外観は、落ち着いた色合いだった。",
        "negated_paraphrase": "試作品の操作で、初めての人が途中で迷うことはなかった。",
    },
    {
        "claim": "この制度の利用者は、この1年で増えている。",
        "negation": "この制度の利用者は、この1年で減っている。",
        "different_aspect": "この制度の申請窓口は、平日にだけ開いている。",
        "negated_paraphrase": "この制度の利用者は、この1年で減ってはいない。",
    },
    {
        "claim": "現場の担当者は、新しい手順を負担に感じている。",
        "negation": "現場の担当者は、新しい手順を負担に感じていない。",
        "different_aspect": "新しい手順の説明会は、先月に開かれた。",
        "negated_paraphrase": "現場の担当者にとって、新しい手順は軽い負担ではない。",
    },
)


class _Provider(Protocol):
    provider_name: str
    provider_kind: str

    def generate(self, req: LLMRequest) -> LLMResponse:
        ...


class SpendCapError(ValueError):
    """最悪ケースの見積もりが、指定した支出上限を超える。"""


def plan(*, islands: int, trials: int) -> list[dict[str, Any]]:
    """各試行で、島・島内の位置・A/Bの順序・題材・対照の種類をずらす。

    矛盾ケースと対照ケースは同じ計画を共有する。違いは第2のカードの本文だけになり、
    結果の差を矛盾の有無へ帰属できる。
    """
    specs: list[dict[str, Any]] = []
    for index in range(trials):
        topic = index % len(TOPICS)
        round_index = index // len(TOPICS)
        claim_island = (index * 7 + 2) % islands
        # 1〜islands-1 だけずらすので、2枚は必ず異なる島に置かれる。
        other_island = (claim_island + 1 + (index * 5 + 3) % (islands - 1)) % islands
        specs.append(
            {
                "claim_island": claim_island,
                "other_island": other_island,
                "claim_member": (index * 3) % 10,
                "other_member": (index * 7 + 4) % 10,
                "swap": (topic + round_index) % 2 == 1,
                "topic": topic,
                "control_kind": CONTROL_KINDS[(topic // 2 + round_index) % 2],
            }
        )
    return specs


def build_case(*, islands: int, spec: dict[str, Any], contradicting: bool) -> dict[str, Any]:
    """合成ケースを作る。`contradicting=False` は矛盾のない対照ケース。"""
    doc = representative_document(include_evidence=False)
    doc["islands"] = doc["islands"][:islands]
    keep = {card_id for island in doc["islands"] for card_id in island["cardIds"]}
    doc["cards"] = [card for card in doc["cards"] if card["id"] in keep]
    doc["edges"] = [
        edge for edge in doc.get("edges", []) if edge["fromId"] in keep and edge["toId"] in keep
    ]
    doc.pop("readingOrder", None)

    topic = TOPICS[spec["topic"]]
    claim_island = doc["islands"][spec["claim_island"]]
    other_island = doc["islands"][spec["other_island"]]
    claim_id = claim_island["cardIds"][spec["claim_member"]]
    other_id = other_island["cardIds"][spec["other_member"]]
    if claim_island["id"] == other_island["id"]:
        raise ValueError("2枚のカードは、異なる島に置く必要があります")
    other_text = topic["negation"] if contradicting else topic[spec["control_kind"]]
    texts = {claim_id: topic["claim"], other_id: other_text}
    for card in doc["cards"]:
        if card["id"] in texts:
            card["text"] = texts[card["id"]]

    first, second = (other_id, claim_id) if spec["swap"] else (claim_id, other_id)
    payload = DetectContradictionRequest.model_validate(
        {
            "cardA": {"id": first, "text": texts[first], "textReviewed": True},
            "cardB": {"id": second, "text": texts[second], "textReviewed": True},
            "doc": doc,
        }
    )
    # 本番ルートと同じ順序: SafeModeの検査 → IR → 確定済み矛盾の抑止判定 → プロンプト。
    _reject_unreviewed_cards([payload.cardA, payload.cardB], payload.allowUnreviewedText)
    ir = _detect_contradiction_ir(payload)
    if adjudicated_contradiction(ir, first, second) is not None:
        raise ValueError("確定・保留済みの矛盾があると、本番ルートはモデルを呼びません")
    return {
        "prompt": _build_detect_contradiction_prompt(payload, ir),
        "ir": ir,
        "payload": payload,
        "contradicting": contradicting,
        "control_kind": None if contradicting else spec["control_kind"],
        "planted_card_ids": sorted(texts),
        "planted_island_ids": sorted([claim_island["id"], other_island["id"]]),
    }


def parse_has_contradiction(raw_text: str) -> bool | None:
    """本番ルートのパーサで `hasContradiction` を読む。読めなければ None。

    本番ルートは読めない応答をエラーにする。ここでは「読めない応答」として分けて数える。
    """
    try:
        return _parse_detect_contradiction_response(raw_text).hasContradiction
    except (ValueError, TypeError, AttributeError):
        return None


def worst_case_call_usd(
    prompt_utf8_bytes: int, *, usd_per_million_input: float, usd_per_million_output: float
) -> float:
    """1回あたりの最悪ケース。入力トークン数はUTF-8バイト数（上限側）、出力は出力上限とみなす。"""
    return (
        prompt_utf8_bytes * usd_per_million_input
        + FINAL_JUDGEMENT_MAX_TOKENS * usd_per_million_output
    ) / 1_000_000


def evaluate(
    *,
    model: str,
    expected_provider: str,
    islands: int = 30,
    trials: int = 20,
    min_detection: float = 0.8,
    execute: bool = False,
    provider: _Provider | None = None,
    max_spend_usd: float | None = None,
    usd_per_million_input: float = DEFAULT_USD_PER_MILLION_INPUT,
    usd_per_million_output: float = DEFAULT_USD_PER_MILLION_OUTPUT,
) -> dict[str, Any]:
    if not model.strip() or not expected_provider.strip():
        raise ValueError("`model` と `expected_provider` は必須です")
    if not 2 <= islands <= 30 or trials < 1:
        raise ValueError("islands は2〜30、trials は1以上にしてください")
    if usd_per_million_input < 0 or usd_per_million_output < 0:
        raise ValueError("単価は0以上にしてください")
    if max_spend_usd is not None and max_spend_usd <= 0:
        raise ValueError("max_spend_usd は0より大きくしてください")

    specs = plan(islands=islands, trials=trials)
    # 矛盾と対照を交互に並べる。支出上限で途中停止しても、両群の件数が大きくずれない。
    cases = [
        build_case(islands=islands, spec=spec, contradicting=contradicting)
        for spec in specs
        for contradicting in (True, False)
    ]
    prompt_bytes = max(len(case["prompt"].encode("utf-8")) for case in cases)
    per_call_worst = worst_case_call_usd(
        prompt_bytes,
        usd_per_million_input=usd_per_million_input,
        usd_per_million_output=usd_per_million_output,
    )
    worst_case_total = per_call_worst * len(cases)
    control_trials_by_kind = {
        kind: sum(1 for spec in specs if spec["control_kind"] == kind) for kind in CONTROL_KINDS
    }
    report: dict[str, Any] = {
        "evaluation": "detect-contradiction-planted-pair-recall",
        "islands": islands,
        "trials_per_arm": trials,
        "min_detection_wilson_lower_bound": min_detection,
        # 全件検出でも下限が基準に届かない試行数では、`meets_minimum` は常に false になる。
        "bar_reachable_with_trials": wilson_lower_bound(trials, trials) >= min_detection,
        "prompt_utf8_bytes_max": prompt_bytes,
        "ir_truncated_cases": sum(
            1 for case in cases if (case["ir"].get("truncation") or {}).get("truncated")
        ),
        "planned_calls": len(cases),
        "worst_case_spend_usd": round(worst_case_total, 4),
        "max_spend_usd": max_spend_usd,
        "executed": execute,
        "boundary": (
            "合成データだけを使う。件数は `hasContradiction` の集計であり、"
            "利用者の内容に対するスコアではない。2枚を比べる経路であり、文書全体からの探索ではない。"
        ),
    }
    if not execute:
        report["worst_case_exceeds_cap"] = (
            max_spend_usd is not None and worst_case_total > max_spend_usd
        )
        return report
    if provider is None:
        raise ValueError("`execute=True` の場合はプロバイダーが必要です")
    if provider.provider_name != expected_provider:
        raise ValueError("現在設定されているプロバイダー名が、指定した名前と一致しません")
    if max_spend_usd is not None and worst_case_total > max_spend_usd:
        raise SpendCapError(
            f"最悪ケースの見積もり {worst_case_total:.4f} USD が上限 {max_spend_usd} USD を超えます"
        )

    detected = false_positive = unreadable = errors = exhausted = no_usage = 0
    false_positive_by_kind = {kind: 0 for kind in CONTROL_KINDS}
    thinking_modes: set[str | None] = set()
    input_total = output_total = 0
    max_output = 0
    spent = 0.0
    calls_made = 0
    stopped_for_budget = False
    for case in cases:
        if max_spend_usd is not None and spent + per_call_worst > max_spend_usd:
            stopped_for_budget = True
            break
        calls_made += 1
        try:
            response = provider.generate(
                LLMRequest(
                    task="detect_contradiction",
                    prompt=case["prompt"],
                    max_tokens=FINAL_JUDGEMENT_MAX_TOKENS,
                    inputs=case["ir"],
                    model=model,
                )
            )
        except ProviderError:
            errors += 1
            spent += per_call_worst  # 失敗した呼び出しの課金は分からないので、最悪ケースで数える。
            continue
        if response.metadata.model_id != model:
            raise ValueError("実際に使われたモデルIDが、指定したモデルIDと一致しません")
        thinking_modes.add(response.metadata.thinking_mode)
        if response.input_tokens is None or response.output_tokens is None:
            no_usage += 1
            spent += per_call_worst
        else:
            input_total += response.input_tokens
            output_total += response.output_tokens
            max_output = max(max_output, response.output_tokens)
            spent += (
                response.input_tokens * usd_per_million_input
                + response.output_tokens * usd_per_million_output
            ) / 1_000_000
            exhausted += response.output_tokens >= FINAL_JUDGEMENT_MAX_TOKENS
        flag = parse_has_contradiction(response.raw_text)
        if flag is None:
            unreadable += 1
        elif case["contradicting"]:
            detected += flag
        elif flag:
            false_positive += 1
            false_positive_by_kind[case["control_kind"]] += 1

    lower = wilson_lower_bound(detected, trials)
    # 誤検出率の Wilson 95% 上限。0件でも、試行数が少ないあいだは上限が大きいままになる。
    fp_upper = 1 - wilson_lower_bound(trials - false_positive, trials)
    report.update(
        {
            "calls_made": calls_made,
            "detected": detected,
            "planted_trials": trials,
            "detection_wilson_lower_bound": round(lower, 3),
            "control_false_positives": false_positive,
            "control_trials": trials,
            "control_false_positive_wilson_upper_bound": round(fp_upper, 3),
            "control_false_positives_by_kind": false_positive_by_kind,
            "control_trials_by_kind": control_trials_by_kind,
            "unreadable_responses": unreadable,
            "provider_errors": errors,
            "thinking_modes_seen": sorted(mode or "unreported" for mode in thinking_modes),
            "input_tokens_reported_total": input_total,
            "output_tokens_reported_total": output_total,
            "max_output_tokens_reported": max_output or None,
            "output_budget_exhausted_calls": exhausted,
            "calls_without_usage_report": no_usage,
            "estimated_spend_usd": round(spent, 4),
            "stopped_for_budget": stopped_for_budget,
            "meets_minimum": (
                lower >= min_detection
                and errors == 0
                and unreadable == 0
                and not stopped_for_budget
            ),
        }
    )
    return report


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", required=True, help="期待する `provider_name`（例: deepseek）。")
    parser.add_argument("--model", required=True, help="使用する正確なモデルID。")
    parser.add_argument("--islands", type=int, default=30, help="島の数（2〜30、30島は300カード）。")
    parser.add_argument("--trials", type=int, default=20, help="矛盾ケースと対照ケースそれぞれの回数。")
    parser.add_argument("--min-detection", type=float, default=0.8, help="検出率の Wilson 下限の基準。")
    parser.add_argument(
        "--max-spend-usd",
        type=float,
        default=None,
        help="支出の上限（USD）。最悪ケースの見積もりが超えるなら送信しない。",
    )
    parser.add_argument(
        "--usd-per-million-input",
        type=float,
        default=DEFAULT_USD_PER_MILLION_INPUT,
        help="入力100万トークンあたりの単価（USD）。既定はDeepSeekの上限見積もり。",
    )
    parser.add_argument(
        "--usd-per-million-output",
        type=float,
        default=DEFAULT_USD_PER_MILLION_OUTPUT,
        help="出力100万トークンあたりの単価（USD）。既定はDeepSeekの上限見積もり。",
    )
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
        "max_spend_usd": args.max_spend_usd,
        "usd_per_million_input": args.usd_per_million_input,
        "usd_per_million_output": args.usd_per_million_output,
    }
    if not args.execute:
        print(json.dumps(evaluate(**common), ensure_ascii=False, indent=2))
        return 0
    if not narrative_eval._opted_in():
        print(json.dumps({"status": "external-execution-not-opted-in", "required_env": OPT_IN_ENV}))
        return 2
    try:
        # 本番ルートが、この設定で選ぶモデルと同じものを測る。
        configured = resolve_model_for_task("detect_contradiction")
        if configured != args.model:
            raise ValueError("本番ルートが選ぶモデルIDが、指定したモデルIDと一致しません")
        report = evaluate(**common, execute=True, provider=get_provider())
    except SpendCapError as exc:
        print(json.dumps({"status": "spend-cap-would-be-exceeded", "message": str(exc)}, ensure_ascii=False))
        return 2
    except ValueError as exc:
        print(json.dumps({"status": "configuration-mismatch", "message": str(exc)}, ensure_ascii=False))
        return 2
    except ProviderError as exc:
        print(json.dumps({"status": "provider-unavailable", "message": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["meets_minimum"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
