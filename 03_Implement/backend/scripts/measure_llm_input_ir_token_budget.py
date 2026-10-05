#!/usr/bin/env python3
"""AI-IR-PROJECTION-01 AC-10 の代表規模トークン計測。

300カード・30島の決定論的な文書を作り、Stage 1〜4でIR経由になった
4エンドポイントについて、IR導入前のプロンプトと現在のIR経路のプロンプト量を
同じ参照トークナイザで比較する。

## 「IR導入前」の3系列

本スクリプトは各エンドポイントについて3つの値を出す。

- `preIr`: **IR移行コミットの親**（`dd690559^` / `677fe0de^` / `dcd54d50^` /
  `eaaf21f0^`）の `_build_..._prompt` が出していたプロンプト。真の旧値。
- `legacyFallback`: 現行関数を `ir=None` で呼んだプロンプト。**旧値そのものでは
  ない** — `detect-contradiction` と `suggest-layout` では、IR移行コミット自身が
  共有ヘッダへ1行ずつ加えており、その行は `ir=None` 側にも乗る。
- `irPath`: 現在の実経路（ルートが組んだIRを渡した描画）。

`preIr` は `legacyFallback` から `_PRE_IR_HEADER_ADDITIONS` の行を取り除いて
再現する。除去対象が実在しない場合は失敗させ、行の書き換えに気づけるようにした
（履歴からの再構成をスクリプト内で固定してあるため、`git` を呼ばない）。
2026-09-05 時点で `git show <commit>^` から抽出した当時の関数を実行し、この
再現が4エンドポイントとも byte 単位で一致することを確認済み。

## トークン数の意味

ここで得るトークン数はproviderの課金値ではない。モデルごとにトークナイザが
異なるため、回帰比較用の参照値としてtiktokenの `o200k_base` を用いる。
UTF-8バイト数も併記し、特定providerのトークナイザへ判断を固定しない。
named provider の実測は `AI-IR-SCALE-01` R20（`measure_ai_route_provider_tokens.py`）
の担当であり、本スクリプトはそれを代替しない。
"""

from __future__ import annotations

import argparse
import json
from importlib.metadata import version as package_version
from typing import Any

from sui_sensemaking_api import llm_input_ir
from sui_sensemaking_api.llm_input_ir import canonical_ir_json
from sui_sensemaking_api.models import DocumentV1, SuggestLayoutRequest
from sui_sensemaking_api.models_ai import (
    DetectContradictionRequest,
    GenerateNarrativeRequest,
    SuggestCardGroupsRequest,
)
from sui_sensemaking_api.routes import ai

CARD_COUNT = 300
ISLAND_COUNT = 30
CARDS_PER_ISLAND = CARD_COUNT // ISLAND_COUNT
REFERENCE_ENCODING = "o200k_base"

#: 島境界をまたぐ弦。`+37` / `+70` はいずれも `CARDS_PER_ISLAND` の倍数ではない
#: ので、必ず別の島へ着地する。リング299本と合わせて `MAX_RELATIONS=400` を
#: 超えさせ、関係側の切り詰めも観測対象にするための密度である。
CHORD_OFFSETS = (37, 70)

#: リング辺の関係型。`index + index // CARDS_PER_ISLAND` で引くので、島境界の辺
#: （`index ≡ 9 (mod 10)`）にも `causal` / `negate` が回ってくる。単純な `index % 5`
#: だと境界辺が常に同じ型になり、「島をまたぐ因果・対立」を1本も含まない代表入力
#: になってしまう。5本に1本を骨格（`causal` / `negate`）とする配分は、KJの関係線が
#: `related` 優位である実感に合わせた。
RING_PATTERN = (
    "related",
    "related",
    "related",
    "related",
    "related",
    "causal",
    "related",
    "negate",
    "mutual",
    "equivalence",
)

#: 弦の関係型は無方向3種に限る。`generate-narrative` は `causal` / `negate` の
#: 両端を `required_card_ids` として予約するため（`AI-IR-NARRATIVE-SPINE-01`）、
#: 弦にも骨格型を混ぜると必須集合が `MAX_CARDS` を越えて 422 になり、
#: 4エンドポイントを同一入力で比較できなくなる。骨格が上限を越える側の挙動は
#: 上限判断の材料として別に測る（issue AC-10 の記録を参照）。
CHORD_PATTERN = ("related", "mutual", "equivalence")

#: IR移行コミット自身が共有ヘッダへ加えた行。`ir=None` の描画にも乗るため、
#: 真の旧プロンプトを得るにはここを差し引く（上の docstring を参照）。
_PRE_IR_HEADER_ADDITIONS: dict[str, tuple[str, ...]] = {
    # dd690559 `feat(ai): route detect-contradiction through the LLM input IR`.
    # 移行前のheaderは末尾に改行を持たなかったため、`"\n".join(...)` が入れる
    # 1行分もあわせて差し引く。
    "detect-contradiction": ("A mere difference of opinion is not a contradiction.\n\n",),
    # eaaf21f0 `feat(ai): route suggest-layout through the LLM input IR`
    "suggest-layout": (
        "Place cards and islands that stand in a logical relation nearer, and keep "
        "the two sides of a 'negate' relation visibly apart.\n",
    ),
}

_THEMES = (
    "利用者の作業手順",
    "根拠への戻りやすさ",
    "異論を残す方法",
    "判断を保留する条件",
    "後から訂正する経路",
    "共同作業での責任範囲",
    "情報を外へ出す境界",
    "AI提案の採否",
    "画面上の認知負荷",
    "次に確認すべき空白",
)

#: `schemas.md` §14.1 の3値。人間が「いま扱いを決めていない」と印を付けた状態。
_HOLD_STATES = ("held", "pending", "shelved")


def _card_id(index: int) -> str:
    return f"c{index:04d}"


def _hold_state_for(index: int) -> str | None:
    """25枚に1枚へholdを置く（300枚中12枚）。3値を巡回させる。"""
    if index % 25 != 7:
        return None
    return _HOLD_STATES[(index // 25) % len(_HOLD_STATES)]


def build_representative_document() -> DocumentV1:
    """300カード・30島の、決定論的でPIIを含まない代表文書を作る。

    AC-10 が求める「代表規模」を、単なる件数ではなく**切り詰めが実際に起きる**
    形で満たす。

    - 300カード（`MAX_CARDS=200` を超える）
    - 30島・10枚ずつ。`i10`〜`i29` の20島は `parentIslandId` で階層を持ち、
      全島が `placardCardId` を持つ
    - リング299本＋弦600本の計899関係（`MAX_RELATIONS=400` を超える）。
      リングは5語彙すべてを巡回し `causal` / `negate` が島境界をまたぐ。
      弦は無方向3種のみ（`CHORD_PATTERN` の注記を参照）
    - 30件の evidence link（`supports` / `contradicts` を交互に）
    - 12枚の hold card（`held` / `pending` / `shelved`）
    """
    cards: list[dict[str, Any]] = []
    for index in range(CARD_COUNT):
        theme = _THEMES[index % len(_THEMES)]
        card: dict[str, Any] = {
            "id": _card_id(index),
            "text": f"{theme}について、現場の観察と反対意見を分け、未確認事項を保留した。",
            "x": float((index % 20) * 120),
            "y": float((index // 20) * 90),
            "textReviewed": True,
        }
        hold_state = _hold_state_for(index)
        if hold_state is not None:
            card["holdState"] = hold_state
        cards.append(card)

    edges = [
        {
            "id": f"e{index:04d}",
            "fromId": _card_id(index),
            "toId": _card_id(index + 1),
            "type": RING_PATTERN[(index + index // CARDS_PER_ISLAND) % len(RING_PATTERN)],
        }
        for index in range(CARD_COUNT - 1)
    ]
    # 島境界をまたぐ長距離の関係。リングだけだと関係が隣接カードに閉じ、
    # 島間の派生関係（Stage 4 の `derived_island_relations()`）が
    # 「隣り合う島の対」しか生まないため、代表性を欠く。
    for offset in CHORD_OFFSETS:
        for index in range(CARD_COUNT):
            edges.append(
                {
                    "id": f"x{offset:02d}{index:04d}",
                    "fromId": _card_id(index),
                    "toId": _card_id((index + offset) % CARD_COUNT),
                    "type": CHORD_PATTERN[(index + offset) % len(CHORD_PATTERN)],
                }
            )

    islands: list[dict[str, Any]] = []
    for island_index in range(ISLAND_COUNT):
        start = island_index * CARDS_PER_ISLAND
        members = [_card_id(index) for index in range(start, start + CARDS_PER_ISLAND)]
        islands.append(
            {
                "id": f"i{island_index:02d}",
                "cardIds": members,
                "title": f"観察群{island_index + 1}",
                "titleReviewed": True,
                "placardCardId": members[0],
                "parentIslandId": None if island_index < 10 else f"i{island_index % 10:02d}",
            }
        )

    evidence_links = [
        {
            "id": f"ev{index:03d}",
            "type": "contradicts" if index % 2 else "supports",
            "fromCardId": _card_id(index * 10),
            "toCardId": _card_id(index * 10 + 1),
            "contradictionState": "unconfirmed" if index % 2 else None,
        }
        for index in range(ISLAND_COUNT)
    ]

    return DocumentV1.model_validate(
        {
            "version": 1,
            "id": "ai-ir-ac10-representative",
            "title": "LLM投入IR代表規模計測",
            "createdAt": "2026-09-02T00:00:00Z",
            "updatedAt": "2026-09-02T00:00:00Z",
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": cards,
            "edges": edges,
            "islands": islands,
            "readingOrder": [island["id"] for island in islands],
            "narratives": [],
            "evidenceLinks": evidence_links,
        }
    )


def _text_metrics(text: str, encoding: Any) -> dict[str, int]:
    return {
        "referenceTokens": len(encoding.encode(text)),
        "utf8Bytes": len(text.encode("utf-8")),
        "unicodeChars": len(text),
    }


def _ir_metrics(ir: dict[str, Any], encoding: Any) -> dict[str, Any]:
    serialized = canonical_ir_json(ir)
    metrics: dict[str, Any] = _text_metrics(serialized, encoding)
    islands = ir.get("islands", [])
    metrics.update(
        {
            "cards": len(ir.get("cards", [])),
            "relations": len(ir.get("relations", [])),
            "islands": len(islands),
            "emptyIslands": sum(1 for island in islands if not island["card_ids"]),
            "evidenceLinks": len(ir.get("evidence_links", [])),
            "coordinates": len(ir.get("coordinates", [])),
            "clusterCandidates": len(ir.get("cluster_candidates", [])),
            "truncated": bool(ir.get("truncation", {}).get("truncated")),
            "reasonCodes": list(ir.get("truncation", {}).get("reason_codes", [])),
        }
    )
    return metrics


def _pre_ir_prompt(endpoint: str, legacy_fallback: str) -> str:
    """`ir=None` 描画から、IR移行コミットが足したヘッダ行を差し引く。"""
    prompt = legacy_fallback
    for line in _PRE_IR_HEADER_ADDITIONS.get(endpoint, ()):
        if line not in prompt:
            raise SystemExit(
                f"{endpoint}: 期待したヘッダ行が現行プロンプトに無い。"
                "_PRE_IR_HEADER_ADDITIONS を履歴に対して取り直すこと。"
            )
        prompt = prompt.replace(line, "", 1)
    return prompt


def _prompt_metrics(
    endpoint: str, legacy_fallback: str, current: str, encoding: Any
) -> dict[str, Any]:
    pre_ir = _pre_ir_prompt(endpoint, legacy_fallback)
    pre_ir_metrics = _text_metrics(pre_ir, encoding)
    legacy_metrics = _text_metrics(legacy_fallback, encoding)
    current_metrics = _text_metrics(current, encoding)
    base = pre_ir_metrics["referenceTokens"]
    return {
        "preIr": pre_ir_metrics,
        "legacyFallback": legacy_metrics,
        "irPath": current_metrics,
        "deltaReferenceTokens": current_metrics["referenceTokens"] - base,
        "ratioToPreIr": (
            round(current_metrics["referenceTokens"] / base, 4) if base else None
        ),
    }


def build_report(
    *,
    max_cards: int | None = None,
    max_relations: int | None = None,
    max_text_chars: int | None = None,
) -> dict[str, Any]:
    """代表文書を4エンドポイントへ通す。

    `max_cards` / `max_relations` / `max_text_chars` は**計測時だけの上書き**で
    あり、production の定数は変更しない。上限を引き上げた場合の入力コストを実数で
    出すために使う（`AI-IR-SCALE-01` 方式A2の判断材料）。
    """
    try:
        import tiktoken
    except ImportError as exc:  # pragma: no cover - 実行環境への案内
        raise SystemExit(
            "tiktoken が必要です。計測時だけ `pip install tiktoken==0.14.0` を実行してください。"
        ) from exc

    encoding = tiktoken.get_encoding(REFERENCE_ENCODING)
    document = build_representative_document()

    original_limits = (
        llm_input_ir.MAX_CARDS,
        llm_input_ir.MAX_RELATIONS,
        llm_input_ir.MAX_TEXT_CHARS,
    )
    if max_cards is not None:
        llm_input_ir.MAX_CARDS = max_cards
    if max_relations is not None:
        llm_input_ir.MAX_RELATIONS = max_relations
    if max_text_chars is not None:
        llm_input_ir.MAX_TEXT_CHARS = max_text_chars
    try:
        return _build_report_with_current_limits(document, encoding)
    finally:
        (
            llm_input_ir.MAX_CARDS,
            llm_input_ir.MAX_RELATIONS,
            llm_input_ir.MAX_TEXT_CHARS,
        ) = original_limits


def _build_report_with_current_limits(
    document: DocumentV1, encoding: Any
) -> dict[str, Any]:
    group_payload = SuggestCardGroupsRequest(
        cards=[
            {"id": card.id, "text": card.text, "textReviewed": True}
            for card in document.cards
        ],
        doc=document,
    )
    group_ir = ai._suggest_card_groups_ir(group_payload)
    candidate_ids, withheld_ids = ai._card_group_candidates(group_payload, group_ir)

    narrative_payload = GenerateNarrativeRequest(
        doc=document,
        narrativeTitle="代表規模の叙述",
    )
    narrative_ir = ai._generate_narrative_ir(narrative_payload)

    layout_payload = SuggestLayoutRequest(doc=document)
    layout_ir = ai._suggest_layout_ir(layout_payload)

    contradiction_payload = DetectContradictionRequest(
        cardA={
            "id": _card_id(149),
            "text": document.cards[149].text,
            "textReviewed": True,
        },
        cardB={
            "id": _card_id(150),
            "text": document.cards[150].text,
            "textReviewed": True,
        },
        doc=document,
    )
    contradiction_ir = ai._detect_contradiction_ir(contradiction_payload)

    prompts = {
        "detect-contradiction": _prompt_metrics(
            "detect-contradiction",
            ai._build_detect_contradiction_prompt(contradiction_payload),
            ai._build_detect_contradiction_prompt(contradiction_payload, contradiction_ir),
            encoding,
        ),
        "suggest-card-groups": _prompt_metrics(
            "suggest-card-groups",
            ai._build_suggest_card_groups_prompt(group_payload),
            ai._build_suggest_card_groups_prompt(
                group_payload,
                group_ir,
                candidate_ids=candidate_ids,
            ),
            encoding,
        ),
        "generate-narrative": _prompt_metrics(
            "generate-narrative",
            ai._build_generate_narrative_prompt(narrative_payload),
            ai._build_generate_narrative_prompt(narrative_payload, narrative_ir),
            encoding,
        ),
        "suggest-layout": _prompt_metrics(
            "suggest-layout",
            ai._build_prompt(layout_payload),
            ai._build_prompt(layout_payload, layout_ir),
            encoding,
        ),
    }

    hold_cards = [card for card in document.cards if card.holdState]
    normalized_text_chars = sum(
        len(" ".join(card.text.split())) for card in document.cards
    )
    return {
        "schemaVersion": 2,
        "purpose": "AI-IR-PROJECTION-01 AC-10 reference token budget",
        "tokenizer": {
            "library": "tiktoken",
            "libraryVersion": package_version("tiktoken"),
            "encoding": REFERENCE_ENCODING,
            "meaning": "回帰比較用の参照値。providerの課金トークン数ではない。",
        },
        "representativeDocument": {
            "cards": len(document.cards),
            "islands": len(document.islands),
            "relations": len(document.edges),
            "evidenceLinks": len(document.evidenceLinks or []),
            "holdCards": len(hold_cards),
            "normalizedTextChars": normalized_text_chars,
        },
        "limits": {
            "MAX_CARDS": llm_input_ir.MAX_CARDS,
            "MAX_RELATIONS": llm_input_ir.MAX_RELATIONS,
            "MAX_TEXT_CHARS": llm_input_ir.MAX_TEXT_CHARS,
        },
        "cardGroups": {
            "requested": len(group_payload.cards),
            "candidates": len(candidate_ids),
            "withheldByHold": len(withheld_ids),
            "lostToTruncation": len(group_payload.cards)
            - len(candidate_ids)
            - len(withheld_ids),
        },
        "ir": {
            "detectContradiction": _ir_metrics(contradiction_ir, encoding),
            "suggestCardGroups": _ir_metrics(group_ir, encoding),
            "generateNarrative": _ir_metrics(narrative_ir, encoding),
            "suggestLayout": _ir_metrics(layout_ir, encoding),
        },
        "prompts": prompts,
    }


def _print_markdown(report: dict[str, Any]) -> None:
    doc = report["representativeDocument"]
    tokenizer = report["tokenizer"]
    limits = report["limits"]
    print("# LLM投入IR 代表規模トークン計測")
    print()
    print(
        f"- 代表文書: {doc['cards']}カード / {doc['islands']}島 / "
        f"{doc['relations']}関係 / {doc['evidenceLinks']}証拠リンク / "
        f"{doc['holdCards']}hold / 正規化本文 {doc['normalizedTextChars']}文字"
    )
    print(
        f"- 上限: MAX_CARDS={limits['MAX_CARDS']} / "
        f"MAX_RELATIONS={limits['MAX_RELATIONS']} / "
        f"MAX_TEXT_CHARS={limits['MAX_TEXT_CHARS']}"
    )
    print(
        f"- 参照トークナイザ: {tokenizer['library']} {tokenizer['libraryVersion']} / "
        f"{tokenizer['encoding']}"
    )
    print("- 注記: 参照トークン数はproviderの課金値ではなく、同一条件での回帰比較用。")
    print()
    groups = report["cardGroups"]
    print(
        f"- suggest-card-groups 候補: 要求{groups['requested']} → 候補{groups['candidates']} "
        f"（hold除外{groups['withheldByHold']} / 切り詰めで消失{groups['lostToTruncation']}）"
    )
    print()
    print("## IR本体（エンドポイント別）")
    print()
    print(
        "| エンドポイント | 参照トークン | UTF-8 bytes | cards | relations | islands"
        " | 空島 | evidence | coords | truncation |"
    )
    print("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |")
    for label, key in (
        ("`detect-contradiction`", "detectContradiction"),
        ("`suggest-card-groups`", "suggestCardGroups"),
        ("`generate-narrative`", "generateNarrative"),
        ("`suggest-layout`", "suggestLayout"),
    ):
        row = report["ir"][key]
        reasons = ",".join(row["reasonCodes"]) or "none"
        print(
            f"| {label} | {row['referenceTokens']} | {row['utf8Bytes']} | {row['cards']} | "
            f"{row['relations']} | {row['islands']} | {row['emptyIslands']} | "
            f"{row['evidenceLinks']} | {row['coordinates']} | {reasons} |"
        )
    print()
    print("## 実際のプロンプト")
    print()
    print(
        "| エンドポイント | IR導入前（履歴） | `ir=None` 描画 | 現在のIR経路 | 差分 | 倍率 |"
    )
    print("| --- | ---: | ---: | ---: | ---: | ---: |")
    for endpoint, row in report["prompts"].items():
        ratio = "-" if row["ratioToPreIr"] is None else f"{row['ratioToPreIr']:.2f}x"
        print(
            f"| `{endpoint}` | {row['preIr']['referenceTokens']} | "
            f"{row['legacyFallback']['referenceTokens']} | "
            f"{row['irPath']['referenceTokens']} | "
            f"{row['deltaReferenceTokens']:+d} | {ratio} |"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown")
    parser.add_argument(
        "--max-cards",
        type=int,
        default=None,
        help="計測時だけMAX_CARDSを上書きする（production定数は変更しない）",
    )
    parser.add_argument(
        "--max-relations",
        type=int,
        default=None,
        help="計測時だけMAX_RELATIONSを上書きする（production定数は変更しない）",
    )
    parser.add_argument(
        "--max-text-chars",
        type=int,
        default=None,
        help="計測時だけMAX_TEXT_CHARSを上書きする（production定数は変更しない）",
    )
    args = parser.parse_args()

    report = build_report(
        max_cards=args.max_cards,
        max_relations=args.max_relations,
        max_text_chars=args.max_text_chars,
    )
    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2))
    else:
        _print_markdown(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
