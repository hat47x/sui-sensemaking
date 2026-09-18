#!/usr/bin/env python3
"""T4 evaluation probes and descriptive comparison for COGNITIVE-ASSOC-01.

This module intentionally separates evaluation-only ranking from product
behaviour. Retrieval ranks are used only to measure preregistered challenge
positive recall after the model-blind human adjudication gate is frozen.

No single composite score, winner, or production recommendation is emitted.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
import time
import tracemalloc
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from run_cognitive_assoc_baselines import (
    RUN_SCHEMA,
    build_representations,
    canonical_json_bytes,
    dense_centroid,
    dense_cosine,
    load_model_input,
    load_json,
    score_candidates,
    sha256_bytes,
    sparse_centroid,
    sparse_cosine,
    validate_frozen_gate,
    validate_selected_review_set,
)


PROBE_SCHEMA = "sui.cognitive-assoc-evaluation-probes/v1"
SUMMARY_SCHEMA = "sui.cognitive-assoc-evaluation-summary/v1"
ALLOWED_BASELINES = ("A", "C", "E")
RECALL_K = (1, 3, 5)


def validate_manifest_reference(
    manifest: dict[str, Any],
    selected: dict[str, Any],
    cards: dict[tuple[str, str], str],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    if manifest.get("id") != selected.get("benchmarkId"):
        raise ValueError("source manifest benchmark id does not match selected review set")
    if manifest.get("status") != "pre_adjudication_frozen":
        raise ValueError("source manifest must remain the frozen v0 manifest")

    challenge_sets: list[dict[str, Any]] = []
    singleton_islands: list[dict[str, str]] = []
    seen_challenges: set[str] = set()
    seen_singletons: set[tuple[str, str]] = set()

    for source in manifest.get("sources", []):
        document_id = source.get("documentId")
        if not isinstance(document_id, str) or not document_id:
            raise ValueError("manifest source is missing documentId")

        observed_groups = [
            set(item.get("cardIds", []))
            for item in source.get("observedPositiveSets", [])
        ]
        for index, raw_ids in enumerate(source.get("challengePositiveSets", []), 1):
            if not isinstance(raw_ids, list) or len(raw_ids) not in (2, 3):
                raise ValueError(
                    f"challengePositiveSet must contain 2 or 3 cards: {document_id}"
                )
            if len(set(raw_ids)) != len(raw_ids):
                raise ValueError(f"challengePositiveSet repeats cards: {document_id}")
            missing = [
                card_id
                for card_id in raw_ids
                if (document_id, card_id) not in cards
            ]
            if missing:
                raise ValueError(
                    f"challengePositiveSet references missing blind cards: "
                    f"{document_id}:{missing}"
                )
            challenge = set(raw_ids)
            if not any(challenge.issubset(group) for group in observed_groups):
                raise ValueError(
                    f"challengePositiveSet is not contained in an observed positive set: "
                    f"{document_id}:{raw_ids}"
                )
            challenge_id = (
                f"{document_id}:challenge-positive:{index}:"
                + "+".join(sorted(raw_ids))
            )
            if challenge_id in seen_challenges:
                raise ValueError(f"duplicate challenge id: {challenge_id}")
            seen_challenges.add(challenge_id)
            challenge_sets.append(
                {
                    "id": challenge_id,
                    "documentId": document_id,
                    "cardIds": sorted(raw_ids),
                }
            )

        grouped = set().union(*observed_groups) if observed_groups else set()
        for raw in source.get("observedSingletonIslands", []):
            card_id = raw.get("cardId")
            if not isinstance(card_id, str) or not card_id:
                raise ValueError("observedSingletonIsland is missing cardId")
            key = (document_id, card_id)
            if key not in cards:
                raise ValueError(
                    f"observedSingletonIsland references missing blind card: {key}"
                )
            if card_id in grouped:
                raise ValueError(
                    f"singleton also belongs to observed positive set: {key}"
                )
            if key in seen_singletons:
                raise ValueError(f"duplicate singleton: {key}")
            seen_singletons.add(key)
            singleton_islands.append(
                {"documentId": document_id, "cardId": card_id}
            )

    if not challenge_sets:
        raise ValueError("source manifest has no challenge positive sets")
    if not singleton_islands:
        raise ValueError("source manifest has no singleton islands")

    return challenge_sets, singleton_islands


def similarity(baseline: str, a: Any, b: Any) -> float:
    return dense_cosine(a, b) if baseline == "E" else sparse_cosine(a, b)


def centroid(baseline: str, vectors: list[Any]) -> Any:
    return dense_centroid(vectors) if baseline == "E" else sparse_centroid(vectors)


def challenge_probe(
    baseline: str,
    challenge: dict[str, Any],
    cards: dict[tuple[str, str], str],
    representations: dict[tuple[str, str], Any],
) -> dict[str, Any]:
    document_id = challenge["documentId"]
    member_ids = list(challenge["cardIds"])
    member_set = set(member_ids)

    within_document = sorted(
        card_id
        for (doc_id, card_id) in cards
        if doc_id == document_id
    )
    if len(within_document) < 2:
        raise ValueError(f"document has too few cards for retrieval: {document_id}")

    anchor_results: list[dict[str, Any]] = []
    for anchor_id in member_ids:
        anchor_key = (document_id, anchor_id)
        ranked: list[tuple[str, float]] = []
        for candidate_id in within_document:
            if candidate_id == anchor_id:
                continue
            candidate_key = (document_id, candidate_id)
            ranked.append(
                (
                    candidate_id,
                    similarity(
                        baseline,
                        representations[anchor_key],
                        representations[candidate_key],
                    ),
                )
            )
        ranked.sort(key=lambda item: (-item[1], item[0]))
        rank_by_id = {
            candidate_id: index + 1
            for index, (candidate_id, _) in enumerate(ranked)
        }
        targets = sorted(member_set - {anchor_id})
        target_ranks = {target: rank_by_id[target] for target in targets}
        recall = {
            str(k): sum(1 for rank in target_ranks.values() if rank <= k)
            / len(target_ranks)
            for k in RECALL_K
        }
        anchor_results.append(
            {
                "anchorCardId": anchor_id,
                "targetRanks": target_ranks,
                "recallAt": recall,
            }
        )

    vectors = [
        representations[(document_id, card_id)]
        for card_id in member_ids
    ]
    if len(vectors) == 2:
        member_scores = [similarity(baseline, vectors[0], vectors[1])]
    else:
        member_scores = []
        for index, vector in enumerate(vectors):
            others = [v for i, v in enumerate(vectors) if i != index]
            member_scores.append(
                similarity(baseline, vector, centroid(baseline, others))
            )

    return {
        "id": challenge["id"],
        "documentId": document_id,
        "cardIds": member_ids,
        "retrieval": anchor_results,
        "setCoherence": {
            "memberCount": len(member_ids),
            "mean": statistics.fmean(member_scores),
            "minimum": min(member_scores),
            "memberScores": member_scores,
        },
    }


def singleton_probe(
    baseline: str,
    singleton: dict[str, str],
    cards: dict[tuple[str, str], str],
    representations: dict[tuple[str, str], Any],
) -> dict[str, Any]:
    document_id = singleton["documentId"]
    card_id = singleton["cardId"]
    key = (document_id, card_id)

    candidates: list[tuple[str, float]] = []
    for (doc_id, other_id), _text in cards.items():
        if doc_id != document_id or other_id == card_id:
            continue
        candidates.append(
            (
                other_id,
                similarity(
                    baseline,
                    representations[key],
                    representations[(document_id, other_id)],
                ),
            )
        )
    if not candidates:
        raise ValueError(f"singleton has no within-document neighbours: {key}")
    candidates.sort(key=lambda item: (-item[1], item[0]))
    nearest_id, nearest_score = candidates[0]
    return {
        "documentId": document_id,
        "cardId": card_id,
        "nearestCardId": nearest_id,
        "maximumSimilarity": nearest_score,
    }


def contrast_probe(
    selected: dict[str, Any],
    raw_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    strata: dict[str, list[str]] = {}
    for collection in ("pairCandidates", "twoPlusOneCandidates"):
        for item in selected.get(collection, []):
            value = item.get("selectionStrata")
            if not isinstance(value, list) or not value:
                raise ValueError(
                    f"selected candidate missing selectionStrata: {item.get('id')}"
                )
            strata[item["id"]] = sorted(value)

    out: list[dict[str, Any]] = []
    for item in raw_results:
        candidate_id = item["candidateId"]
        if candidate_id not in strata:
            raise ValueError(f"run result is not in selected review set: {candidate_id}")
        out.append(
            {
                "candidateId": candidate_id,
                "candidateType": item["candidateType"],
                "metric": item["metric"],
                "score": item["score"],
                "referenceLabel": item["referenceLabel"],
                "selectionStrata": strata[candidate_id],
            }
        )
    return out


def build_probe_artifact(
    *,
    baseline: str,
    manifest_path: Path,
    selected_path: Path,
    model_input_path: Path,
    adjudicated_path: Path,
    evidence_path: Path,
    encoder_command: str | None,
    encoder_timeout: float,
) -> dict[str, Any]:
    started = time.perf_counter()
    tracemalloc.start()
    try:
        selected_raw = selected_path.read_bytes()
        selected = json.loads(selected_raw.decode("utf-8"))
        adjudicated_raw = adjudicated_path.read_bytes()
        adjudicated = json.loads(adjudicated_raw.decode("utf-8"))
        evidence = load_json(evidence_path)
        labels = validate_frozen_gate(
            selected_raw,
            selected,
            adjudicated_raw,
            adjudicated,
            evidence,
        )
        candidates = validate_selected_review_set(selected)
        cards = load_model_input(model_input_path)
        manifest_raw = manifest_path.read_bytes()
        manifest = json.loads(manifest_raw.decode("utf-8"))
        challenges, singletons = validate_manifest_reference(
            manifest, selected, cards
        )

        representations, baseline_metadata = build_representations(
            baseline, cards, encoder_command, encoder_timeout
        )
        raw_contrast = score_candidates(
            baseline,
            candidates,
            labels,
            cards,
            representations,
        )
        contrast = contrast_probe(selected, raw_contrast)
        challenge_results = [
            challenge_probe(baseline, item, cards, representations)
            for item in challenges
        ]
        singleton_results = [
            singleton_probe(baseline, item, cards, representations)
            for item in singletons
        ]
        _current, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    return {
        "schema": PROBE_SCHEMA,
        "benchmarkId": selected.get("benchmarkId"),
        "baseline": baseline_metadata,
        "source": {
            "manifestSha256": sha256_bytes(manifest_raw),
            "selectedReviewSetSha256": sha256_bytes(selected_raw),
            "adjudicatedArtifactSha256": sha256_bytes(adjudicated_raw),
            "modelInputSha256": sha256_bytes(model_input_path.read_bytes()),
        },
        "evaluationOnly": True,
        "productRankingProduced": False,
        "singleCompositeScoreProduced": False,
        "contrast": contrast,
        "challengePositive": challenge_results,
        "singleton": singleton_results,
        "runtimeEvidence": {
            "wallMilliseconds": (time.perf_counter() - started) * 1000.0,
            "pythonHarnessPeakBytes": peak,
            "memoryScope": "python-harness-process-only",
            "externalProviderMemoryIncluded": False,
        },
    }


def _finite_scores(items: Iterable[float]) -> list[float]:
    values = [float(value) for value in items]
    if not all(math.isfinite(value) for value in values):
        raise ValueError("evaluation artifact contains non-finite score")
    return values


def score_stats(values: Iterable[float]) -> dict[str, Any]:
    data = sorted(_finite_scores(values))
    if not data:
        return {"count": 0, "mean": None, "median": None, "minimum": None, "maximum": None}
    return {
        "count": len(data),
        "mean": statistics.fmean(data),
        "median": statistics.median(data),
        "minimum": data[0],
        "maximum": data[-1],
    }


def summarize_probe(probe: dict[str, Any]) -> dict[str, Any]:
    if probe.get("schema") != PROBE_SCHEMA:
        raise ValueError("invalid probe schema")
    baseline = probe.get("baseline", {}).get("id")
    if baseline not in ALLOWED_BASELINES:
        raise ValueError("probe baseline id is invalid")

    challenge = probe.get("challengePositive")
    singleton = probe.get("singleton")
    contrast = probe.get("contrast")
    if not all(isinstance(value, list) for value in (challenge, singleton, contrast)):
        raise ValueError("probe collections are invalid")

    recall_values: dict[int, list[float]] = {k: [] for k in RECALL_K}
    set_mean: list[float] = []
    set_min: list[float] = []
    for item in challenge:
        coherence = item.get("setCoherence", {})
        set_mean.append(float(coherence["mean"]))
        set_min.append(float(coherence["minimum"]))
        for anchor in item.get("retrieval", []):
            recall = anchor.get("recallAt", {})
            for k in RECALL_K:
                recall_values[k].append(float(recall[str(k)]))

    contrast_groups: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    for item in contrast:
        label = item.get("referenceLabel")
        if label == "exclude":
            continue
        candidate_type = item.get("candidateType")
        for stratum in item.get("selectionStrata", []):
            contrast_groups[(label, candidate_type, stratum)].append(
                float(item["score"])
            )

    contrast_summary = [
        {
            "referenceLabel": label,
            "candidateType": candidate_type,
            "selectionStratum": stratum,
            "scoreStats": score_stats(values),
        }
        for (label, candidate_type, stratum), values in sorted(contrast_groups.items())
    ]

    return {
        "baselineId": baseline,
        "R1_deepSemanticCandidateRecall": {
            f"recallAt{k}": score_stats(recall_values[k]) for k in RECALL_K
        },
        "R2_surfaceDecoyContrast": contrast_summary,
        "R3_singletonPreservation": {
            "maximumSimilarity": score_stats(
                item["maximumSimilarity"] for item in singleton
            ),
            "caseCount": len(singleton),
            "interpretation": (
                "descriptive absorption-pressure signal only; no universal "
                "threshold is preregistered in v0"
            ),
        },
        "R4_setLevelCoherence": {
            "meanMemberCoherence": score_stats(set_mean),
            "minimumMemberCoherence": score_stats(set_min),
            "caseCount": len(challenge),
        },
        "R5_wordingStability": {
            "status": "not_measured_in_v0",
            "reason": "benchmark v0 has no preregistered paraphrase cases",
        },
        "R7_continuousLocalBudget": probe.get("runtimeEvidence"),
        "notMeasuredHere": {
            "R6_affinityFeedbackIncrement": "requires T6 affinity-specific extension",
            "R8_cognitiveControlIncrement": "requires T7 cognitive dogfood",
        },
    }


def build_summary(probes: list[dict[str, Any]]) -> dict[str, Any]:
    if not probes:
        raise ValueError("at least one probe artifact is required")

    benchmark_ids = {probe.get("benchmarkId") for probe in probes}
    source_keys = {
        canonical_json_bytes(probe.get("source", {}))
        for probe in probes
    }
    baseline_ids = [probe.get("baseline", {}).get("id") for probe in probes]
    if len(benchmark_ids) != 1:
        raise ValueError("probe benchmark ids do not match")
    if len(source_keys) != 1:
        raise ValueError("probe source digests do not match")
    if len(set(baseline_ids)) != len(baseline_ids):
        raise ValueError("duplicate baseline probe")
    if not set(baseline_ids).issubset(ALLOWED_BASELINES):
        raise ValueError("unknown baseline probe")

    return {
        "schema": SUMMARY_SCHEMA,
        "benchmarkId": next(iter(benchmark_ids)),
        "comparisonPolicy": {
            "singleCompositeScore": False,
            "winnerSelected": False,
            "baselineRankingProduced": False,
            "UAndLReportedSeparately": True,
            "pairAndTwoPlusOneReportedSeparately": True,
        },
        "baselines": [
            summarize_probe(probe)
            for probe in sorted(
                probes, key=lambda item: item["baseline"]["id"]
            )
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run gated T4 probes or summarize completed A/C/E probe artifacts."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    probe_parser = subparsers.add_parser("probe")
    probe_parser.add_argument("--baseline", choices=ALLOWED_BASELINES, required=True)
    probe_parser.add_argument("--manifest", type=Path, required=True)
    probe_parser.add_argument("--selected-review-set", type=Path, required=True)
    probe_parser.add_argument("--model-input", type=Path, required=True)
    probe_parser.add_argument("--adjudicated", type=Path, required=True)
    probe_parser.add_argument("--adjudication-evidence", type=Path, required=True)
    probe_parser.add_argument("--output", type=Path, required=True)
    probe_parser.add_argument("--encoder-command")
    probe_parser.add_argument("--encoder-timeout", type=float, default=30.0)

    summary_parser = subparsers.add_parser("summarize")
    summary_parser.add_argument("probes", nargs="+", type=Path)
    summary_parser.add_argument("--output", type=Path, required=True)

    args = parser.parse_args()
    try:
        if args.command == "probe":
            value = build_probe_artifact(
                baseline=args.baseline,
                manifest_path=args.manifest,
                selected_path=args.selected_review_set,
                model_input_path=args.model_input,
                adjudicated_path=args.adjudicated,
                evidence_path=args.adjudication_evidence,
                encoder_command=args.encoder_command,
                encoder_timeout=args.encoder_timeout,
            )
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(canonical_json_bytes(value))
            print(f"WROTE_PROBE: {args.output}")
            print(f"BASELINE: {args.baseline}")
            print(f"CHALLENGE_CASES: {len(value['challengePositive'])}")
            print(f"SINGLETON_CASES: {len(value['singleton'])}")
            print("PRODUCT_RANKING_PRODUCED: false")
            print("SINGLE_COMPOSITE_SCORE_PRODUCED: false")
            return 0

        probes = [load_json(path) for path in args.probes]
        value = build_summary(probes)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical_json_bytes(value))
        print(f"WROTE_SUMMARY: {args.output}")
        print(f"BASELINE_COUNT: {len(value['baselines'])}")
        print("WINNER_SELECTED: false")
        print("SINGLE_COMPOSITE_SCORE: false")
        return 0
    except (
        OSError,
        UnicodeDecodeError,
        ValueError,
        json.JSONDecodeError,
    ) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
