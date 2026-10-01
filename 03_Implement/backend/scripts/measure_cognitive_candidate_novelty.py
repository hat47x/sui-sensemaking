#!/usr/bin/env python3
"""Characterize deterministic cognitive candidates against existing islands.

This is a provider-free structural measurement for ADR-0090. It answers only
whether the current deterministic cluster candidates repeat existing island
membership, merely re-present an already explicit direct relation, or expose a
transitive regrouping cue that is not already co-islanded or directly linked.

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
    held_card_ids,
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
MEASUREMENT_ID = "deterministic-candidate-island-regrouping-v2"


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
    direct_relation_pairs: set[tuple[str, str]],
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

    candidate_pairs = set(combinations(card_ids, 2))
    not_co_islanded_pairs = sorted(candidate_pairs - co_island_pairs)
    indirect_regrouping_pairs = (
        sorted(set(not_co_islanded_pairs) - direct_relation_pairs)
        if candidate["basis"] == "relation"
        else []
    )

    return {
        "clusterId": candidate["cluster_id"],
        "basis": candidate["basis"],
        "cardIds": card_ids,
        "exactExistingIslandIds": exact,
        "containingExistingIslandIds": containing,
        "touchedExistingIslandIds": touched,
        "crossesExistingIslandBoundary": len(touched) >= 2,
        "unassignedCardIds": unassigned,
        "notAlreadyCoIslandedPairs": [
            {"left": left, "right": right}
            for left, right in not_co_islanded_pairs
        ],
        "indirectRegroupingPairs": [
            {"left": left, "right": right}
            for left, right in indirect_regrouping_pairs
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
    direct_relation_pairs = {
        tuple(sorted((relation["from"], relation["to"])))
        for relation in ir.get("relations", [])
        if relation["type"] in {"related", "causal"}
        and relation["from"] != relation["to"]
    }

    withheld = set(held_card_ids(ir))
    raw_candidates = list(ir.get("cluster_candidates", []))
    eligible_candidates = [
        candidate
        for candidate in raw_candidates
        if not (set(candidate["card_ids"]) & withheld)
    ]
    candidates = [
        _measure_candidate(
            candidate,
            islands=islands,
            co_island_pairs=co_island_pairs,
            direct_relation_pairs=direct_relation_pairs,
        )
        for candidate in eligible_candidates
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
            "withheldCardIds": sorted(withheld),
            "rawClusterCandidateCount": len(raw_candidates),
        },
        "summary": {
            "candidateCount": len(candidates),
            "exactExistingIslandCandidateCount": sum(
                bool(item["exactExistingIslandIds"]) for item in candidates
            ),
            "crossIslandCandidateCount": sum(
                bool(item["crossesExistingIslandBoundary"]) for item in candidates
            ),
            "candidatesWithNotAlreadyCoIslandedPairsCount": sum(
                bool(item["notAlreadyCoIslandedPairs"]) for item in candidates
            ),
            "notAlreadyCoIslandedPairCount": sum(
                len(item["notAlreadyCoIslandedPairs"]) for item in candidates
            ),
            "candidatesWithIndirectRegroupingCount": sum(
                bool(item["indirectRegroupingPairs"]) for item in candidates
            ),
            "indirectRegroupingPairCount": sum(
                len(item["indirectRegroupingPairs"]) for item in candidates
            ),
        },
        "candidates": candidates,
        "interpretationBoundary": (
            "Structural characterization only. Candidates containing a held/pending/"
            "shelved card are withheld to match the suggest-card-groups boundary. "
            "Cross-island and notAlreadyCoIslandedPairs only show that a grouping is "
            "not already represented by one existing island. For relation-based "
            "candidates, indirectRegroupingPairs further excludes card pairs already "
            "connected by a direct related/causal edge, exposing only transitive "
            "regrouping cues. None of these establish semantic correctness, human "
            "cognitive increment, importance, ranking, or product adoption."
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
