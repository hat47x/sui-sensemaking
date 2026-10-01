#!/usr/bin/env python3
"""Characterize deterministic cognitive candidates against existing islands.

This is a provider-free structural measurement for ADR-0090. It answers only
whether the current deterministic cluster candidates repeat existing island
membership or cross boundaries that the current island structure does not
already co-locate.

It does NOT measure human cognitive increment, semantic correctness, candidate
importance, or a winner. Internal cluster scores are deliberately omitted from
the output. Card text is also omitted so the report can be inspected without
copying qualitative material into a separate result artifact.

By default the script uses the repository's synthetic KJ fixture. A local
DocumentV1 JSON may be supplied with --document. Results are printed to stdout;
the script does not maintain a result ledger.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from itertools import combinations
from pathlib import Path
from typing import Any

from sui_sensemaking_api.llm_input_ir import (
    build_llm_input_ir,
    source_from_document,
)
from sui_sensemaking_api.models import DocumentV1


REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_FIXTURE = (
    REPO_ROOT
    / "03_Implement"
    / "backend"
    / "tests"
    / "fixtures"
    / "ai_eval_kj_document.json"
)
MEASUREMENT_ID = "deterministic-candidate-island-novelty-v1"


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _island_sets(document: DocumentV1) -> dict[str, frozenset[str]]:
    return {
        island.id: frozenset(island.cardIds)
        for island in document.islands
    }


def _co_island_pairs(
    islands: dict[str, frozenset[str]],
) -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for members in islands.values():
        for left, right in combinations(sorted(members), 2):
            pairs.add((left, right))
    return pairs


def _measure_candidate(
    candidate: dict[str, Any],
    *,
    islands: dict[str, frozenset[str]],
    co_island_pairs: set[tuple[str, str]],
) -> dict[str, Any]:
    card_ids = sorted(str(card_id) for card_id in candidate["card_ids"])
    members = frozenset(card_ids)

    exact = sorted(
        island_id
        for island_id, island_members in islands.items()
        if island_members == members
    )
    containing = sorted(
        island_id
        for island_id, island_members in islands.items()
        if members <= island_members
    )
    touched = sorted(
        island_id
        for island_id, island_members in islands.items()
        if members & island_members
    )
    assigned = set().union(
        *(islands[island_id] for island_id in touched)
    ) if touched else set()
    unassigned = sorted(members - assigned)

    candidate_pairs = {
        pair
        for pair in combinations(card_ids, 2)
    }
    novel_pairs = sorted(candidate_pairs - co_island_pairs)

    return {
        "clusterId": candidate["cluster_id"],
        "basis": candidate["basis"],
        "cardIds": card_ids,
        "exactExistingIslandIds": exact,
        "containingExistingIslandIds": containing,
        "touchedExistingIslandIds": touched,
        "crossesExistingIslandBoundary": len(touched) >= 2,
        "unassignedCardIds": unassigned,
        "novelCoMembershipPairs": [
            {"left": left, "right": right}
            for left, right in novel_pairs
        ],
    }


def measure_document(
    document: DocumentV1,
    *,
    source_sha256: str,
    include_spatial: bool = False,
) -> dict[str, Any]:
    ir = build_llm_input_ir(
        source_from_document(document),
        include_coordinates=include_spatial,
        safe_mode=True,
        allow_unreviewed_text=False,
    )
    islands = _island_sets(document)
    co_island_pairs = _co_island_pairs(islands)

    candidates = [
        _measure_candidate(
            candidate,
            islands=islands,
            co_island_pairs=co_island_pairs,
        )
        for candidate in ir.get("cluster_candidates", [])
    ]

    return {
        "measurement": MEASUREMENT_ID,
        "source": {
            "documentId": document.id,
            "sha256": source_sha256,
            "cardCount": len(document.cards),
            "islandCount": len(document.islands),
        },
        "mode": {
            "includeSpatial": include_spatial,
            "providerCalled": False,
            "cardTextEmitted": False,
            "internalScoreEmitted": False,
        },
        "projection": {
            "truncated": bool(ir.get("truncation", {}).get("truncated")),
            "reasonCodes": list(ir.get("truncation", {}).get("reason_codes", [])),
        },
        "summary": {
            "candidateCount": len(candidates),
            "exactExistingIslandCandidateCount": sum(
                bool(item["exactExistingIslandIds"]) for item in candidates
            ),
            "crossIslandCandidateCount": sum(
                bool(item["crossesExistingIslandBoundary"]) for item in candidates
            ),
            "candidatesWithNovelCoMembershipCount": sum(
                bool(item["novelCoMembershipPairs"]) for item in candidates
            ),
            "novelCoMembershipPairCount": sum(
                len(item["novelCoMembershipPairs"]) for item in candidates
            ),
        },
        "candidates": candidates,
        "interpretationBoundary": (
            "Structural characterization only. Cross-island or novel co-membership "
            "means the deterministic candidate is not already represented by one "
            "existing island membership; it does not establish semantic correctness, "
            "human cognitive increment, importance, ranking, or product adoption."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Measure structural novelty of deterministic cognitive candidates."
    )
    parser.add_argument(
        "--document",
        type=Path,
        default=DEFAULT_FIXTURE,
        help="Local DocumentV1 JSON (default: synthetic ai_eval_kj_document fixture).",
    )
    parser.add_argument(
        "--include-spatial",
        action="store_true",
        help="Also derive spatial candidates. Default matches suggest-card-groups.",
    )
    args = parser.parse_args()

    try:
        raw = args.document.read_bytes()
        document = DocumentV1.model_validate_json(raw)
        result = measure_document(
            document,
            source_sha256=sha256_bytes(raw),
            include_spatial=args.include_spatial,
        )
    except (OSError, ValueError) as exc:
        print(f"FAIL: {exc}")
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
