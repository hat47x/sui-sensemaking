#!/usr/bin/env python3
"""Preregister and validate the T6 affinity-specific ablation plan.

This utility does not implement affinity-specific cognition. It validates that
T6 is actually allowed to start, checks that research features are derived only
from pre-target history, and emits a fixed add-one / leave-one-out ablation
matrix.

It never ranks channels, chooses a winner, or authorizes production adoption.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


T5_DECISION_SCHEMA = "sui.cognitive-assoc-learned-sparse-gate-decision/v1"
T5_EVIDENCE_SCHEMA = "sui.cognitive-assoc-learned-sparse-gate-evidence/v1"
SOURCE_SCHEMA = "sui.cognitive-assoc-affinity-ablation-source/v1"
PLAN_SCHEMA = "sui.cognitive-assoc-affinity-ablation-plan/v1"

CHANNELS = (
    "group",
    "separate",
    "critique",
    "hold",
    "graph",
    "space",
    "history",
)

CHANNEL_SEMANTICS = {
    "group": "prior intentional co-grouping/adoption events only",
    "separate": "prior intentional split/remove/not-same actions only",
    "critique": "prior critique signals such as too_close/too_far/not_the_same/feels_off",
    "hold": "prior explicit hold/unresolved/open states",
    "graph": "typed relations that existed before the evaluation target",
    "space": "prior relative neighbourhood/layout topology, never target-final geometry",
    "history": "temporal/order/frequency features from prior interaction events",
}


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_t5_proceed(
    decision_raw: bytes,
    decision: dict[str, Any],
    evidence: dict[str, Any],
) -> None:
    if decision.get("schema") != T5_DECISION_SCHEMA:
        raise ValueError("T5 decision schema is invalid")
    if decision.get("state") != "learned_sparse_gate_frozen":
        raise ValueError("T5 decision is not frozen")
    if decision.get("decision") != "Proceed":
        raise ValueError("T6 requires a frozen T5 Proceed decision")
    if decision.get("productionAdoptionAuthorized") is not False:
        raise ValueError("T5 Proceed must not authorize production adoption")

    if evidence.get("schema") != T5_EVIDENCE_SCHEMA:
        raise ValueError("T5 evidence schema is invalid")
    if evidence.get("state") != "learned_sparse_gate_frozen":
        raise ValueError("T5 evidence is not frozen")
    if evidence.get("decision") != "Proceed":
        raise ValueError("T5 evidence decision must be Proceed")
    if evidence.get("decisionArtifactSha256") != sha256_bytes(decision_raw):
        raise ValueError("T5 decision artifact SHA-256 does not match evidence")
    if evidence.get("automaticDecision") is not False:
        raise ValueError("T5 decision must remain human-authorized")
    if evidence.get("singleCompositeScore") is not False:
        raise ValueError("T5 evidence must not contain a composite decision score")
    if evidence.get("winnerSelected") is not False:
        raise ValueError("T5 evidence must not select a baseline winner")


def validate_source_manifest(
    source: dict[str, Any],
    benchmark_id: str,
) -> tuple[list[str], list[str]]:
    if source.get("schema") != SOURCE_SCHEMA:
        raise ValueError(f"source manifest schema must be {SOURCE_SCHEMA}")
    if source.get("benchmarkId") != benchmark_id:
        raise ValueError("source manifest benchmarkId does not match T5 decision")

    semantic = source.get("semanticReference")
    if not isinstance(semantic, dict):
        raise ValueError("semanticReference is required")
    if semantic.get("id") != "D":
        raise ValueError("T6 v0 requires completed learned-sparse semantic reference D")
    digest = semantic.get("artifactSha256")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ValueError("semanticReference.artifactSha256 is required")

    boundary = source.get("targetBoundary")
    if not isinstance(boundary, dict):
        raise ValueError("targetBoundary is required")
    if boundary.get("onlyEventsStrictlyBeforeTarget") is not True:
        raise ValueError("T6 requires strictly pre-target interaction history")
    if boundary.get("targetSnapshotDerivedFeaturesAllowed") is not False:
        raise ValueError("target-derived affinity features are forbidden")
    if not isinstance(boundary.get("targetSnapshotId"), str) or not boundary.get(
        "targetSnapshotId"
    ):
        raise ValueError("targetBoundary.targetSnapshotId is required")

    channels = source.get("channels")
    if not isinstance(channels, dict):
        raise ValueError("channels map is required")
    unknown = set(channels) - set(CHANNELS)
    if unknown:
        raise ValueError(f"unknown affinity channels: {sorted(unknown)}")

    available: list[str] = []
    missing: list[str] = []
    for channel in CHANNELS:
        spec = channels.get(channel)
        if not isinstance(spec, dict):
            missing.append(channel)
            continue
        status = spec.get("status")
        if status not in ("available", "unavailable"):
            raise ValueError(f"{channel}.status must be available or unavailable")
        if status == "unavailable":
            missing.append(channel)
            continue

        if spec.get("targetDerived") is not False:
            raise ValueError(f"{channel} channel may not use target-derived state")
        if spec.get("onlyPreTargetEvents") is not True:
            raise ValueError(f"{channel} channel must use only pre-target events")
        refs = spec.get("evidenceRefs")
        if not isinstance(refs, list) or not refs or not all(
            isinstance(ref, str) and ref for ref in refs
        ):
            raise ValueError(f"{channel} channel requires non-empty evidenceRefs")
        available.append(channel)

    return available, missing


def build_variants(available: list[str]) -> list[dict[str, Any]]:
    ordered = [channel for channel in CHANNELS if channel in available]
    variants: list[dict[str, Any]] = [
        {
            "id": "F0_semantic_reference",
            "channels": [],
            "comparisonRole": "semantic-reference",
        }
    ]
    for channel in ordered:
        variants.append(
            {
                "id": f"F_plus_{channel}",
                "channels": [channel],
                "comparisonRole": "add-one",
                "compareAgainst": "F0_semantic_reference",
            }
        )
    variants.append(
        {
            "id": "F_all",
            "channels": ordered,
            "comparisonRole": "all-available-affinity-channels",
        }
    )
    for channel in ordered:
        variants.append(
            {
                "id": f"F_minus_{channel}",
                "channels": [item for item in ordered if item != channel],
                "comparisonRole": "leave-one-out",
                "compareAgainst": "F_all",
            }
        )
    return variants


def build_plan(
    decision_raw: bytes,
    decision: dict[str, Any],
    evidence: dict[str, Any],
    source_raw: bytes,
    source: dict[str, Any],
) -> dict[str, Any]:
    validate_t5_proceed(decision_raw, decision, evidence)
    benchmark_id = decision.get("benchmarkId")
    available, missing = validate_source_manifest(source, benchmark_id)

    all_channels_available = not missing
    return {
        "schema": PLAN_SCHEMA,
        "benchmarkId": benchmark_id,
        "state": (
            "ready_for_bounded_research"
            if all_channels_available
            else "hold_missing_channels"
        ),
        "executionAuthorized": all_channels_available,
        "productionAdoptionAuthorized": False,
        "automaticChannelSelection": False,
        "channelRankingProduced": False,
        "singleCompositeScoreProduced": False,
        "source": {
            "t5DecisionArtifactSha256": sha256_bytes(decision_raw),
            "affinitySourceManifestSha256": sha256_bytes(source_raw),
            "semanticReferenceId": "D",
            "semanticReferenceArtifactSha256": source["semanticReference"][
                "artifactSha256"
            ],
            "targetSnapshotId": source["targetBoundary"]["targetSnapshotId"],
        },
        "channelSemantics": CHANNEL_SEMANTICS,
        "availableChannels": available,
        "missingChannels": missing,
        "variants": build_variants(available),
        "evaluation": {
            "reuseAxes": ["R1", "R2", "R3", "R4", "R7"],
            "newAxis": "R6_affinityFeedbackIncrement",
            "R6Observations": [
                "add-one delta versus F0 for each available channel",
                "leave-one-out delta versus F_all for each available channel",
                "interaction/disagreement notes without causal attribution",
            ],
            "R5": "not_measured_in_v0",
            "R8": "reserved_for_T7_cognitive_dogfood",
            "winnerSelection": False,
            "channelRanking": False,
            "singleCompositeScore": False,
        },
        "leakageBoundary": {
            "onlyEventsStrictlyBeforeTarget": True,
            "targetSnapshotDerivedFeaturesAllowed": False,
            "forbiddenExamples": [
                "final target island membership",
                "final target layout coordinates/topology",
                "T2d human adjudication labels",
                "A/C/E/D model outputs for the evaluated candidate",
            ],
        },
        "notes": [
            "Channel deltas are contribution signals, not causal effects.",
            "Correlated channels may share information; add-one and leave-one-out are both retained.",
            "Missing channels are reported as unmeasured, never synthesized from target state.",
            "No affinity-specific feature may auto-confirm an island, label, or relation.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the preregistered T6 affinity-channel ablation plan."
    )
    parser.add_argument("t5_decision", type=Path)
    parser.add_argument("t5_evidence", type=Path)
    parser.add_argument("affinity_source_manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    try:
        decision_raw = args.t5_decision.read_bytes()
        decision = json.loads(decision_raw.decode("utf-8"))
        evidence = load_json(args.t5_evidence)
        source_raw = args.affinity_source_manifest.read_bytes()
        source = json.loads(source_raw.decode("utf-8"))
        plan = build_plan(decision_raw, decision, evidence, source_raw, source)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical_json_bytes(plan))
        print(f"WROTE_T6_PLAN: {args.output}")
        print(f"STATE: {plan['state']}")
        print(f"EXECUTION_AUTHORIZED: {str(plan['executionAuthorized']).lower()}")
        print(f"AVAILABLE_CHANNELS: {len(plan['availableChannels'])}")
        print(f"MISSING_CHANNELS: {len(plan['missingChannels'])}")
        print("CHANNEL_RANKING_PRODUCED: false")
        return 0
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
