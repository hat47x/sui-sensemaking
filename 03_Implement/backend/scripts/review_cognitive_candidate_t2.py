#!/usr/bin/env python3
"""Render a two-phase local review for ADR-0090 cognitive-assistance T2 work.

The tool never writes a result ledger. It reads a local DocumentV1 JSON and
prints either the current human-authored structure (baseline phase) or eligible
deterministic regrouping candidates (candidates phase).

Run the baseline phase first, record the current interpretation without machine
candidates in a local note, then pass both the printed baseline receipt and that
note to the candidates phase. Candidate output includes card text because a
human must judge whether attention actually moved, but neither the source note
nor its contents are reprinted; only its digest and byte count are shown.

This tool does not turn a run into ADR-0089 T2 evidence by itself. T2 requires
the Maintainer's own non-SUI practical use and qualitative observation.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from typing import Literal

from sui_sensemaking_api.attention_candidates import (
    ATTENTION_METHOD_ID,
    attention_candidates_from_ir,
    attention_source_digest,
    build_attention_ir,
)
from sui_sensemaking_api.llm_input_ir import IRGenerationError, held_card_ids
from sui_sensemaking_api.models import DocumentV1


Phase = Literal["baseline", "candidates"]


class IncompleteAttentionProjectionError(ValueError):
    """T2 cannot interpret an attention projection that lost source material."""


class BaselineGateError(ValueError):
    """Candidate reveal requires a bound baseline snapshot and human note."""


def _require_complete_attention_projection(ir: dict) -> None:
    truncation = ir.get("truncation", {})
    if not truncation.get("truncated"):
        return
    reasons = truncation.get("reason_codes", [])
    detail = ", ".join(str(reason) for reason in reasons) or "unknown"
    raise IncompleteAttentionProjectionError(
        f"attention projection was truncated ({detail}); T2 review is invalid"
    )


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _baseline_receipt(
    source_sha256: str,
    product_digest: str,
    *,
    method_id: str = ATTENTION_METHOD_ID,
) -> str:
    payload = (
        "sui-cognitive-t2-baseline-v2\0"
        + source_sha256
        + "\0"
        + product_digest
        + "\0"
        + method_id
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _require_baseline_gate(
    *,
    expected_receipt: str,
    provided_receipt: str | None,
    observation_raw: bytes | None,
) -> tuple[str, int]:
    if provided_receipt != expected_receipt:
        raise BaselineGateError(
            "candidate phase requires the Baseline receipt from the same snapshot"
        )
    if observation_raw is None or not observation_raw.strip():
        raise BaselineGateError(
            "candidate phase requires a non-empty baseline observation file"
        )
    return _sha256(observation_raw), len(observation_raw)


def _card_text_by_id(document: DocumentV1) -> dict[str, str]:
    return {card.id: card.text for card in document.cards}


def render_baseline(
    document: DocumentV1,
    *,
    source_sha256: str | None = None,
) -> str:
    ir = build_attention_ir(document)
    _require_complete_attention_projection(ir)
    product_digest = attention_source_digest(ir)
    by_id = _card_text_by_id(document)
    hold_by_id = {
        card.id: getattr(card, "holdState", None)
        for card in document.cards
    }
    lines = [
        "# Cognitive T2 review — baseline",
        "",
        "候補を見る前に、現在の構造から自分が重要だと見ている論点・違和感・保留を記録する。",
        "この出力自体はT2 Evidenceではない。",
        "",
        f"Document: {document.title or document.id}",
    ]
    if source_sha256 is not None:
        lines.append(f"Source SHA-256: {source_sha256}")
        lines.append(
            "Baseline receipt: "
            + _baseline_receipt(source_sha256, product_digest)
        )
    lines.append(f"Attention methodId: {ATTENTION_METHOD_ID}")
    lines.append(f"Attention sourceDigest: {product_digest}")
    lines.extend(
        [
            "",
            "## Current islands",
        ]
    )

    island_card_ids: set[str] = set()
    for island in document.islands:
        lines.append(f"- {island.id}: {island.title or '(untitled)'}")
        for card_id in island.cardIds:
            island_card_ids.add(card_id)
            text = by_id.get(card_id, "(missing card)")
            hold = hold_by_id.get(card_id)
            hold_note = f" [hold={hold}]" if hold else ""
            lines.append(f"  - {card_id}{hold_note}: {text}")

    unassigned = [
        card
        for card in document.cards
        if card.id not in island_card_ids
    ]
    if unassigned:
        lines.extend(["", "## Cards outside current islands"])
        for card in unassigned:
            hold = getattr(card, "holdState", None)
            hold_note = f" [hold={hold}]" if hold else ""
            lines.append(f"- {card.id}{hold_note}: {card.text}")

    lines.extend(
        [
            "",
            "## Before revealing candidates",
            "- いま注意している材料は何か",
            "- いまの島分けを見直したい箇所はあるか",
            "- 保留・異論として残したいものは何か",
            "",
            "この3点をローカルのメモへ記録してから候補フェーズへ進む。",
        ]
    )
    return "\n".join(lines)


def render_candidates(
    document: DocumentV1,
    *,
    source_sha256: str,
    baseline_receipt: str | None,
    baseline_observation: bytes | None,
) -> str:
    ir = build_attention_ir(document)
    _require_complete_attention_projection(ir)
    product_digest = attention_source_digest(ir)
    expected_receipt = _baseline_receipt(source_sha256, product_digest)
    observation_sha256, observation_bytes = _require_baseline_gate(
        expected_receipt=expected_receipt,
        provided_receipt=baseline_receipt,
        observation_raw=baseline_observation,
    )
    candidates = attention_candidates_from_ir(ir)
    by_id = _card_text_by_id(document)

    lines = [
        "# Cognitive T2 review — deterministic candidates",
        "",
        "候補は製品APIと同じ決定論ロジックから得た提案であり、採用・順位・確信度を表さない。",
        "held/pending/shelved を含む候補は表示しない。",
        f"Source SHA-256: {source_sha256}",
        f"Attention methodId: {ATTENTION_METHOD_ID}",
        f"Attention sourceDigest: {product_digest}",
        f"Baseline receipt: {expected_receipt}",
        f"Baseline observation SHA-256: {observation_sha256}",
        f"Baseline observation bytes: {observation_bytes}",
        "Excluded hold card IDs: "
        + (", ".join(held_card_ids(ir)) if held_card_ids(ir) else "none"),
        "",
    ]

    if not candidates:
        lines.append("Eligible deterministic candidates: none")
    else:
        for candidate in candidates:
            lines.append(
                f"## {candidate.candidateId} ({candidate.basis} / {candidate.cue})"
            )
            for card_id in candidate.cardIds:
                lines.append(f"- {card_id}: {by_id[card_id]}")
            lines.append(
                "注目組: "
                + ", ".join(
                    f"{left}↔{right}"
                    for left, right in candidate.focusPairs
                )
            )
            lines.append("")

    lines.extend(
        [
            "## After revealing candidates",
            "- 候補を見る前には注意していなかった材料へ注意が移ったか",
            "- 既存の島・関係・見立てを見直したくなったか",
            "- 保留・異論はそのまま保持できたか",
            "- 候補がノイズ、先入観、早すぎる収束を生んだか",
            "- 候補が無くても同じ見直しに到達したと思うか",
            "",
            "判定境界: この観察を単一の数値評価へ畳まない。"
            "T2で認知増分が再現しなければ製品候補へ昇格しない。",
        ]
    )
    return "\n".join(lines)


def render_review(
    document: DocumentV1,
    *,
    phase: Phase,
    source_sha256: str,
    baseline_receipt: str | None = None,
    baseline_observation: bytes | None = None,
) -> str:
    if phase == "baseline":
        return render_baseline(
            document,
            source_sha256=source_sha256,
        )
    return render_candidates(
        document,
        source_sha256=source_sha256,
        baseline_receipt=baseline_receipt,
        baseline_observation=baseline_observation,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Render a local two-phase cognitive-assistance T2 review."
    )
    parser.add_argument(
        "--document",
        type=Path,
        required=True,
        help="Local non-SUI practical-work DocumentV1 JSON.",
    )
    parser.add_argument(
        "--phase",
        choices=("baseline", "candidates"),
        required=True,
        help="Run baseline first, then candidates after recording the baseline.",
    )
    parser.add_argument(
        "--baseline-receipt",
        help="Receipt printed by the baseline phase for the same snapshot.",
    )
    parser.add_argument(
        "--baseline-observation",
        type=Path,
        help="Local non-empty note recorded before revealing candidates.",
    )
    args = parser.parse_args()

    try:
        raw = args.document.read_bytes()
        document = DocumentV1.model_validate_json(raw)
    except (OSError, ValueError) as exc:
        print(f"FAIL: {exc}")
        return 1

    observation_raw: bytes | None = None
    if args.phase == "candidates" and args.baseline_observation is not None:
        try:
            observation_raw = args.baseline_observation.read_bytes()
        except OSError as exc:
            print(f"FAIL: {exc}")
            return 1

    try:
        rendered = render_review(
            document,
            phase=args.phase,
            source_sha256=_sha256(raw),
            baseline_receipt=args.baseline_receipt,
            baseline_observation=observation_raw,
        )
    except IRGenerationError as exc:
        print(f"FAIL: {exc.to_contract()}")
        return 1
    except (IncompleteAttentionProjectionError, BaselineGateError) as exc:
        print(f"FAIL: {exc}")
        return 1

    print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
