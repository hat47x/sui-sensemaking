#!/usr/bin/env python3
"""Run a bounded AI-operation smoke/quality probe on the synthetic KJ fixture.

The script exercises real FastAPI routes. --dry-run replaces only the provider
call with a deterministic stub and is contract smoke evidence, not content-quality
evidence. A real provider run still uses a synthetic fixture: it is neither
ADR-0089 T1/T2 evidence nor evidence of human cognitive increment.

Results are printed to stdout. This script does not maintain a result ledger or
turn qualitative observations into a composite pass/fail score.

Usage:
  # Contract/pipeline smoke without an API key
  python run_ai_eval.py --dry-run

  # Provider quality probe on the same synthetic fixture
  # Configure any supported provider/model first, then:
  python run_ai_eval.py
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from sui_sensemaking_api.llm.provider import (
    LLMCallMetadata,
    LLMRequest,
    LLMResponse,
    ProviderRequestError,
)
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import DocumentV1

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
FIXTURE = REPO_ROOT / "03_Implement" / "backend" / "tests" / "fixtures" / "ai_eval_kj_document.json"

# Evaluation rubric (qualitative, anti-scoring)
REFINE_AXES = ("名詞止め解除", "元意味保持", "過剰言い換えなし")
SUMMARY_AXES = ("別島に載せても成立しない", "代弁性", "名詞止め解除")


def _stub_generate(req: LLMRequest) -> LLMResponse:
    """Stub provider for --dry-run (returns canned but schema-valid output).

    For suggest_island_summary, echoes the requested island's own member
    card as groundingId so the backend member-card validation passes.
    """
    metadata = LLMCallMetadata(
        provider_kind="fixture",
        provider_name="fixture",
        model_id="ai-eval-dryrun-fixture",
        transport="in-process",
        requested_at="2026-08-12T00:00:00Z",
        trace_id="llm-eval-dryrun",
    )
    if req.task == "refine_card_text":
        return LLMResponse(raw_text='{"refinedText": "改善されたカード文（dry-run）", "reasoning": "dry-run"}', metadata=metadata)
    if req.task == "suggest_island_summary":
        # The prompt (built by the real route) lists member cards after
        # "Member cards:"; pick those ids as grounding so the backend's
        # member-card validation passes.
        import re as _re

        member_section = req.prompt.split("Member cards:", 1)[1] if "Member cards:" in req.prompt else req.prompt
        ids = _re.findall(r'id="([^"]+)"', member_section)
        grounding = ids[:1] if ids else ["c01"]
        return LLMResponse(
            raw_text=json.dumps(
                {"summaryText": "島の表札候補（dry-run）", "groundingIds": grounding, "warnings": []},
                ensure_ascii=False,
            ),
            metadata=metadata,
        )
    raise ProviderRequestError.validation(f"unexpected task {req.task}", metadata)


def main() -> int:
    """Run evaluation through the REAL FastAPI endpoints (TestClient).

    Uses the actual /ai/* routes so the real prompt builders
    (_build_refine_card_text_prompt etc.) are exercised — the same
    prompt instructions a production client receives.
    """
    parser = argparse.ArgumentParser(description="Synthetic KJ AI-operation smoke/quality probe")
    parser.add_argument("--dry-run", action="store_true", help="Use stub provider (no API key needed)")
    parser.add_argument("--refine-count", type=int, default=10, help="Number of cards to refine (default 10)")
    args = parser.parse_args()

    if not FIXTURE.exists():
        print(f"Error: fixture not found: {FIXTURE}", file=sys.stderr)
        return 1

    doc = DocumentV1.model_validate(json.loads(FIXTURE.read_text(encoding="utf-8")))
    mode = "DRY-RUN (fixture)" if args.dry_run else "CONFIGURED PROVIDER"
    print(f"=== AI Operation Probe ({mode}) ===")
    print(f"Document: {doc.id} ({len(doc.cards)} cards, {len(doc.islands)} islands)")
    print(
        "Evidence boundary: synthetic fixture; not ADR-0089 T1/T2 and "
        "not evidence of human cognitive increment."
    )
    if args.dry_run:
        print("Dry-run boundary: contract/pipeline smoke only; content quality is not evaluated.")

    # Dry-run: swap the routes' generate_with_fallback with a stub so the
    # real endpoint flow is exercised without calling the API.
    original_generate = None
    if args.dry_run:
        from sui_sensemaking_api.routes import ai

        original_generate = ai.generate_with_fallback
        ai.generate_with_fallback = _stub_generate

    try:
        _run_eval(client_app=app, doc=doc, refine_count=args.refine_count)
    finally:
        if original_generate is not None:
            from sui_sensemaking_api.routes import ai

            ai.generate_with_fallback = original_generate
    return 0


def _run_eval(client_app, doc: DocumentV1, refine_count: int) -> None:
    """Run evaluation through the real endpoints via TestClient."""
    with TestClient(client_app) as client:
        # --- refine_card_text (10 samples) via real endpoint ---
        print("\n## 評価1: refine_card_text（POST /ai/refine-card-text）")
        print("定性軸: " + " / ".join(REFINE_AXES))
        print("| # | 入力 | 出力 | 定性判定 |")
        print("|---|------|------|---------|")
        passed = 0
        for i, card in enumerate(doc.cards[: refine_count], start=1):
            resp = client.post(
                "/ai/refine-card-text",
                json={"cardText": card.text, "textReviewed": True},
            )
            if resp.status_code == 200:
                body = resp.json()
                refined = body.get("refinedText", "(missing refinedText)")
                passed += 1
            else:
                refined = f"(HTTP {resp.status_code})"
            print(f"| {i} | {card.text[:30]} | {refined[:50]} | 要確認 |")
        print(f"\nHTTP成功: {passed}/{refine_count}（内容の定性判定とは別）")

        # --- suggest_island_summary (4 islands) via real endpoint ---
        print("\n## 評価2: suggest_island_summary（POST /ai/suggest-island-summary）")
        print("定性軸: " + " / ".join(SUMMARY_AXES))
        print("| # | 島 | 出力表札 | 定性判定 |")
        print("|---|----|---------|---------|")
        summary_passed = 0
        for i, island in enumerate(doc.islands, start=1):
            resp = client.post(
                "/ai/suggest-island-summary",
                json={"doc": doc.model_dump(mode="json"), "islandId": island.id},
            )
            if resp.status_code == 200:
                body = resp.json()
                summary = body.get("summaryText", "(missing summaryText)")
                summary_passed += 1
            else:
                summary = f"(HTTP {resp.status_code})"
            print(f"| {i} | {island.id} ({len(island.cardIds)}枚) | {summary[:60]} | 要確認 |")
        print(f"\nHTTP成功: {summary_passed}/{len(doc.islands)}（内容の定性判定とは別）")

    print("\n=== 解釈境界 ===")
    print("1. 各出力は定性軸ごとに観察し、単一scoreやwinnerへ畳まない")
    print("2. 必要なEvidenceはPR/commitの理由へ要約し、別の結果台帳は作らない")
    print("3. このfixtureだけで一次利用価値や認知増分、製品既定への昇格を主張しない")
    return 0


if __name__ == "__main__":
    sys.exit(main())
