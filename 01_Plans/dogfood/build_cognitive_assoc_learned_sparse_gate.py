#!/usr/bin/env python3
"""Build and freeze the preregistered T5 learned-sparse decision gate.

This gate does not rank A/C/E or automatically decide whether baseline D should
be implemented. It turns a completed T4 summary into a compact, model-free
decision packet and validates a Maintainer Proceed/Hold/Reject response against
predeclared rationale categories.

The purpose is to prevent post-result criteria drift while preserving human
judgement over a small observational benchmark.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any


SUMMARY_SCHEMA = "sui.cognitive-assoc-evaluation-summary/v1"
PACKET_SCHEMA = "sui.cognitive-assoc-learned-sparse-gate-packet/v1"
RESPONSE_SCHEMA = "sui.cognitive-assoc-learned-sparse-gate-response/v1"
DECISION_SCHEMA = "sui.cognitive-assoc-learned-sparse-gate-decision/v1"
EVIDENCE_SCHEMA = "sui.cognitive-assoc-learned-sparse-gate-evidence/v1"

DECISIONS = ("Proceed", "Hold", "Reject")

DRIVER_GROUPS = {
    "semantic_gap": {
        "e_recall_advantage",
        "e_set_coherence_advantage",
        "general_semantic_signal_needed",
    },
    "sparse_value": {
        "e_runtime_or_memory_pressure",
        "compact_representation_value",
        "incremental_index_value",
        "offline_or_edge_value",
        "representation_diversity_value",
    },
    "hold": {
        "e_provider_memory_missing",
        "runtime_not_comparable",
        "evidence_mixed",
        "contrast_risk_unresolved",
        "singleton_risk_unresolved",
        "benchmark_too_small",
        "t4_evidence_incomplete",
    },
    "reject": {
        "no_independent_semantic_gap",
        "a_or_c_sufficient_for_current_scope",
        "e_does_not_show_useful_semantic_signal",
        "sparse_complexity_without_target_deficit",
    },
}

ALL_DRIVERS = set().union(*DRIVER_GROUPS.values())


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _finite(value: Any, field: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{field} must be numeric")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{field} must be finite")
    return number


def _baseline_map(summary: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if summary.get("schema") != SUMMARY_SCHEMA:
        raise ValueError(f"summary schema must be {SUMMARY_SCHEMA}")
    policy = summary.get("comparisonPolicy")
    if not isinstance(policy, dict):
        raise ValueError("summary comparisonPolicy is required")
    required_false = (
        "singleCompositeScore",
        "winnerSelected",
        "baselineRankingProduced",
    )
    for key in required_false:
        if policy.get(key) is not False:
            raise ValueError(f"summary comparisonPolicy.{key} must remain false")
    if policy.get("UAndLReportedSeparately") is not True:
        raise ValueError("summary must keep U/L separate")
    if policy.get("pairAndTwoPlusOneReportedSeparately") is not True:
        raise ValueError("summary must keep pair and 2+1 separate")

    baselines = summary.get("baselines")
    if not isinstance(baselines, list):
        raise ValueError("summary baselines must be a list")
    mapped: dict[str, dict[str, Any]] = {}
    for item in baselines:
        if not isinstance(item, dict):
            raise ValueError("baseline summary must be an object")
        baseline_id = item.get("baselineId")
        if baseline_id not in ("A", "C", "E"):
            raise ValueError(f"unexpected baseline id: {baseline_id!r}")
        if baseline_id in mapped:
            raise ValueError(f"duplicate baseline summary: {baseline_id}")
        wording = item.get("R5_wordingStability", {})
        if wording.get("status") != "not_measured_in_v0":
            raise ValueError("R5 must remain not_measured_in_v0 for benchmark v0")
        mapped[baseline_id] = item
    if set(mapped) != {"A", "C", "E"}:
        raise ValueError("T5 requires completed A/C/E summaries")
    return mapped


def _stat_mean(
    baseline: dict[str, Any], section: str, metric: str, field: str = "mean"
) -> float:
    node = baseline.get(section, {}).get(metric, {})
    return _finite(node.get(field), f"{section}.{metric}.{field}")


def _runtime(baseline: dict[str, Any], key: str) -> Any:
    runtime = baseline.get("R7_continuousLocalBudget")
    if not isinstance(runtime, dict):
        raise ValueError("R7 runtime evidence is required")
    return runtime.get(key)


def _hard_negative_map(baseline: dict[str, Any]) -> dict[tuple[str, str], float]:
    rows = baseline.get("R2_surfaceDecoyContrast")
    if not isinstance(rows, list):
        raise ValueError("R2_surfaceDecoyContrast must be a list")
    out: dict[tuple[str, str], float] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("R2 row must be an object")
        if row.get("referenceLabel") != "hard_negative":
            continue
        candidate_type = row.get("candidateType")
        stratum = row.get("selectionStratum")
        if candidate_type not in ("pair", "two_plus_one"):
            raise ValueError(f"unexpected R2 candidateType: {candidate_type!r}")
        if stratum not in ("U", "L"):
            raise ValueError(f"unexpected R2 selectionStratum: {stratum!r}")
        stats = row.get("scoreStats", {})
        count = stats.get("count")
        if not isinstance(count, int) or count < 0:
            raise ValueError("R2 scoreStats.count must be a non-negative integer")
        if count == 0:
            continue
        key = (candidate_type, stratum)
        if key in out:
            raise ValueError(f"duplicate hard-negative R2 group: {key}")
        out[key] = _finite(stats.get("mean"), f"R2 hard-negative {key} mean")
    return out


def _delta(value: float, baseline: float) -> float:
    return value - baseline


def build_gate_packet(summary: dict[str, Any], summary_raw: bytes) -> dict[str, Any]:
    mapped = _baseline_map(summary)
    a, c, e = mapped["A"], mapped["C"], mapped["E"]

    r1_metric = "recallAt3"
    r1 = {
        baseline_id: _stat_mean(item, "R1_deepSemanticCandidateRecall", r1_metric)
        for baseline_id, item in mapped.items()
    }
    r4 = {
        baseline_id: _stat_mean(item, "R4_setLevelCoherence", "minimumMemberCoherence")
        for baseline_id, item in mapped.items()
    }
    r3 = {
        baseline_id: _stat_mean(item, "R3_singletonPreservation", "maximumSimilarity")
        for baseline_id, item in mapped.items()
    }

    hard_negative = {
        baseline_id: _hard_negative_map(item)
        for baseline_id, item in mapped.items()
    }
    common_r2_keys = sorted(
        set(hard_negative["A"])
        & set(hard_negative["C"])
        & set(hard_negative["E"])
    )
    r2_deltas = [
        {
            "candidateType": candidate_type,
            "selectionStratum": stratum,
            "A": hard_negative["A"][(candidate_type, stratum)],
            "C": hard_negative["C"][(candidate_type, stratum)],
            "E": hard_negative["E"][(candidate_type, stratum)],
            "EminusA": _delta(
                hard_negative["E"][(candidate_type, stratum)],
                hard_negative["A"][(candidate_type, stratum)],
            ),
            "EminusC": _delta(
                hard_negative["E"][(candidate_type, stratum)],
                hard_negative["C"][(candidate_type, stratum)],
            ),
        }
        for candidate_type, stratum in common_r2_keys
    ]

    missing_evidence: list[str] = []
    for baseline_id, item in mapped.items():
        runtime = item.get("R7_continuousLocalBudget")
        if not isinstance(runtime, dict):
            missing_evidence.append(f"{baseline_id}:runtime_missing")
            continue
        if baseline_id == "E" and runtime.get("externalProviderMemoryIncluded") is not True:
            missing_evidence.append("E:external_provider_memory_not_measured")

    observations = {
        "R1_recallAt3Mean": r1,
        "R1_EminusA": _delta(r1["E"], r1["A"]),
        "R1_EminusC": _delta(r1["E"], r1["C"]),
        "R4_minimumMemberCoherenceMean": r4,
        "R4_EminusA": _delta(r4["E"], r4["A"]),
        "R4_EminusC": _delta(r4["E"], r4["C"]),
        "R3_singletonMaximumSimilarityMean": r3,
        "R3_EminusA": _delta(r3["E"], r3["A"]),
        "R3_EminusC": _delta(r3["E"], r3["C"]),
        "R2_hardNegativeMeanComparisons": r2_deltas,
        "R7_wallMilliseconds": {
            baseline_id: _finite(
                _runtime(item, "wallMilliseconds"),
                f"{baseline_id}.R7.wallMilliseconds",
            )
            for baseline_id, item in mapped.items()
        },
        "R7_externalProviderMemoryIncluded": {
            baseline_id: bool(_runtime(item, "externalProviderMemoryIncluded"))
            for baseline_id, item in mapped.items()
        },
    }

    return {
        "schema": PACKET_SCHEMA,
        "benchmarkId": summary.get("benchmarkId"),
        "sourceT4SummarySha256": sha256_bytes(summary_raw),
        "decisionAuthority": "Maintainer",
        "automaticDecision": False,
        "singleCompositeScore": False,
        "winnerSelected": False,
        "purpose": (
            "Decide whether learned sparse semantic baseline D has an independent "
            "research reason after A/C/E, without turning T4 into a winner ranking."
        ),
        "observations": observations,
        "missingEvidence": missing_evidence,
        "decisionSemantics": {
            "Proceed": (
                "Implement a bounded D experiment only when the Maintainer can cite "
                "both a semantic-gap reason and an independent sparse-value reason."
            ),
            "Hold": (
                "Do not implement D yet when evidence is incomplete, mixed, or a "
                "relevant risk/budget comparison remains unresolved."
            ),
            "Reject": (
                "Do not implement D for benchmark v0 when no independent learned-"
                "sparse question remains after A/C/E."
            ),
        },
        "allowedDrivers": {
            key: sorted(values) for key, values in DRIVER_GROUPS.items()
        },
        "notes": [
            "No numeric threshold is retrofitted to benchmark v0.",
            "Positive deltas are descriptive observations, not automatic wins.",
            "R2 lower hard-negative similarity may be desirable, but no universal "
            "similarity threshold is defined.",
            "R3 is descriptive absorption pressure; singleton does not mean held.",
            "R5 is not measured in benchmark v0.",
            "Proceed does not adopt D into production; it only authorizes a bounded "
            "research implementation.",
        ],
    }


def build_response_template(packet: dict[str, Any], packet_raw: bytes) -> dict[str, Any]:
    if packet.get("schema") != PACKET_SCHEMA:
        raise ValueError("invalid T5 gate packet schema")
    return {
        "schema": RESPONSE_SCHEMA,
        "benchmarkId": packet.get("benchmarkId"),
        "status": "in_progress",
        "sourceGatePacketSha256": sha256_bytes(packet_raw),
        "decision": "",
        "drivers": [],
        "rationale": "",
        "completedByRole": "Maintainer",
    }


def _validate_drivers(decision: str, drivers: list[str]) -> None:
    if len(drivers) != len(set(drivers)):
        raise ValueError("decision drivers must not contain duplicates")
    unknown = set(drivers) - ALL_DRIVERS
    if unknown:
        raise ValueError(f"unknown decision drivers: {sorted(unknown)}")

    driver_set = set(drivers)
    if decision == "Proceed":
        if not (driver_set & DRIVER_GROUPS["semantic_gap"]):
            raise ValueError("Proceed requires at least one semantic_gap driver")
        if not (driver_set & DRIVER_GROUPS["sparse_value"]):
            raise ValueError("Proceed requires at least one sparse_value driver")
        forbidden = DRIVER_GROUPS["reject"] & driver_set
        if forbidden:
            raise ValueError("Proceed cannot include reject drivers")
    elif decision == "Hold":
        if not (driver_set & DRIVER_GROUPS["hold"]):
            raise ValueError("Hold requires at least one hold driver")
    elif decision == "Reject":
        if not (driver_set & DRIVER_GROUPS["reject"]):
            raise ValueError("Reject requires at least one reject driver")
        forbidden = DRIVER_GROUPS["semantic_gap"] & driver_set
        if forbidden:
            raise ValueError("Reject cannot include semantic_gap drivers")


def freeze_decision(
    packet: dict[str, Any],
    packet_raw: bytes,
    response: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    if packet.get("schema") != PACKET_SCHEMA:
        raise ValueError("invalid T5 gate packet schema")
    if response.get("schema") != RESPONSE_SCHEMA:
        raise ValueError("invalid T5 gate response schema")
    if response.get("benchmarkId") != packet.get("benchmarkId"):
        raise ValueError("response benchmarkId does not match gate packet")
    if response.get("status") != "complete":
        raise ValueError("T5 response status must be complete")
    if response.get("sourceGatePacketSha256") != sha256_bytes(packet_raw):
        raise ValueError("T5 response gate packet SHA-256 does not match")
    if response.get("completedByRole") != "Maintainer":
        raise ValueError("T5 decision must be completed by Maintainer role")

    decision = response.get("decision")
    if decision not in DECISIONS:
        raise ValueError(f"T5 decision must be one of {DECISIONS}")
    drivers = response.get("drivers")
    if not isinstance(drivers, list) or not all(
        isinstance(item, str) and item for item in drivers
    ):
        raise ValueError("T5 drivers must be a non-empty string list")
    if not drivers:
        raise ValueError("T5 decision requires at least one driver")
    _validate_drivers(decision, drivers)

    rationale = response.get("rationale")
    if not isinstance(rationale, str) or not rationale.strip():
        raise ValueError("T5 decision requires a non-empty rationale")

    decision_artifact = {
        "schema": DECISION_SCHEMA,
        "benchmarkId": packet.get("benchmarkId"),
        "state": "learned_sparse_gate_frozen",
        "sourceGatePacketSha256": sha256_bytes(packet_raw),
        "decision": decision,
        "drivers": sorted(drivers),
        "rationale": rationale.strip(),
        "productionAdoptionAuthorized": False,
        "nextStep": {
            "Proceed": "T6 may implement a bounded learned-sparse D experiment.",
            "Hold": "Do not implement D until the cited hold evidence is resolved.",
            "Reject": "Do not implement D for benchmark v0; preserve the evidence.",
        }[decision],
    }
    decision_raw = canonical_json_bytes(decision_artifact)
    evidence = {
        "schema": EVIDENCE_SCHEMA,
        "benchmarkId": packet.get("benchmarkId"),
        "state": "learned_sparse_gate_frozen",
        "sourceGatePacketSha256": sha256_bytes(packet_raw),
        "decisionArtifactSha256": sha256_bytes(decision_raw),
        "decision": decision,
        "automaticDecision": False,
        "singleCompositeScore": False,
        "winnerSelected": False,
    }
    return decision_artifact, evidence


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build or freeze the preregistered T5 learned-sparse gate."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    packet_parser = sub.add_parser("packet")
    packet_parser.add_argument("t4_summary", type=Path)
    packet_parser.add_argument("packet_output", type=Path)
    packet_parser.add_argument("response_output", type=Path)

    freeze_parser = sub.add_parser("freeze")
    freeze_parser.add_argument("packet", type=Path)
    freeze_parser.add_argument("response", type=Path)
    freeze_parser.add_argument("decision_output", type=Path)
    freeze_parser.add_argument("evidence_output", type=Path)

    args = parser.parse_args()
    try:
        if args.command == "packet":
            summary_raw = args.t4_summary.read_bytes()
            summary = json.loads(summary_raw.decode("utf-8"))
            packet = build_gate_packet(summary, summary_raw)
            packet_raw = canonical_json_bytes(packet)
            response = build_response_template(packet, packet_raw)
            args.packet_output.parent.mkdir(parents=True, exist_ok=True)
            args.response_output.parent.mkdir(parents=True, exist_ok=True)
            args.packet_output.write_bytes(packet_raw)
            args.response_output.write_bytes(canonical_json_bytes(response))
            print(f"WROTE_GATE_PACKET: {args.packet_output}")
            print(f"WROTE_GATE_RESPONSE_TEMPLATE: {args.response_output}")
            print("AUTOMATIC_DECISION: false")
            print("SINGLE_COMPOSITE_SCORE: false")
            return 0

        packet_raw = args.packet.read_bytes()
        packet = json.loads(packet_raw.decode("utf-8"))
        response = load_json(args.response)
        decision, evidence = freeze_decision(packet, packet_raw, response)
        decision_raw = canonical_json_bytes(decision)
        args.decision_output.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_output.parent.mkdir(parents=True, exist_ok=True)
        args.decision_output.write_bytes(decision_raw)
        args.evidence_output.write_bytes(canonical_json_bytes(evidence))
        print(f"WROTE_T5_DECISION: {args.decision_output}")
        print(f"WROTE_T5_EVIDENCE: {args.evidence_output}")
        print(f"DECISION: {decision['decision']}")
        print("PRODUCTION_ADOPTION_AUTHORIZED: false")
        return 0
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
