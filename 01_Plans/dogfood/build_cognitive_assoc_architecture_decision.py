#!/usr/bin/env python3
"""Preregister and freeze the T8 architecture decision.

This utility does not choose an architecture automatically. It validates the
research-evidence manifest, emits a compact decision packet, and freezes a
Maintainer decision among the four preregistered outcomes.

No numeric composite score, model ranking, or automatic production adoption is
created.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


MANIFEST_SCHEMA = "sui.cognitive-assoc-architecture-evidence/v1"
PACKET_SCHEMA = "sui.cognitive-assoc-architecture-decision-packet/v1"
RESPONSE_SCHEMA = "sui.cognitive-assoc-architecture-decision-response/v1"
DECISION_SCHEMA = "sui.cognitive-assoc-architecture-decision/v1"
EVIDENCE_SCHEMA = "sui.cognitive-assoc-architecture-decision-evidence/v1"

DECISIONS = (
    "no_adoption",
    "retrieval_only",
    "candidate_cognition_layer",
    "adr_trigger",
)

DRIVERS = {
    "no_adoption": {
        "no_useful_semantic_increment",
        "local_budget_unacceptable",
        "anchoring_risk_unacceptable",
        "evidence_inconclusive",
        "complexity_exceeds_observed_value",
    },
    "retrieval_only": {
        "retrieval_signal_useful",
        "affinity_increment_unproven",
        "cognitive_control_unproven",
        "simple_local_retrieval_value",
        "keep_authority_outside_kernel",
    },
    "candidate_cognition_layer": {
        "semantic_signal_useful",
        "affinity_increment_observed",
        "cognitive_control_increment_observed",
        "anchoring_acceptable",
        "local_budget_acceptable",
        "proposal_only_boundary_sufficient",
    },
    "adr_trigger": {
        "persistent_state_needed",
        "production_api_needed",
        "provider_boundary_change_needed",
        "safety_boundary_change_needed",
        "performance_budget_norm_needed",
        "cross_repo_contract_needed",
    },
}
ALL_DRIVERS = set().union(*DRIVERS.values())


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _digest(value: Any, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64:
        raise ValueError(f"{field} must be a 64-char SHA-256")
    return value


def validate_stage(
    stages: dict[str, Any],
    name: str,
    *,
    required: bool,
) -> dict[str, Any]:
    stage = stages.get(name)
    if not isinstance(stage, dict):
        raise ValueError(f"stage {name} is required")
    status = stage.get("status")
    if status not in ("completed", "not_applicable"):
        raise ValueError(f"stage {name} status is invalid")
    if required and status != "completed":
        raise ValueError(f"stage {name} must be completed")
    if status == "completed":
        _digest(stage.get("artifactSha256"), f"stages.{name}.artifactSha256")
    else:
        reason = stage.get("reasonCode")
        if not isinstance(reason, str) or not reason:
            raise ValueError(f"stage {name} not_applicable requires reasonCode")
    return stage


def validate_manifest(manifest: dict[str, Any]) -> None:
    if manifest.get("schema") != MANIFEST_SCHEMA:
        raise ValueError(f"manifest schema must be {MANIFEST_SCHEMA}")
    benchmark_id = manifest.get("benchmarkId")
    if not isinstance(benchmark_id, str) or not benchmark_id:
        raise ValueError("benchmarkId is required")

    stages = manifest.get("stages")
    if not isinstance(stages, dict):
        raise ValueError("stages are required")
    validate_stage(stages, "T2", required=True)
    validate_stage(stages, "T4", required=True)
    t5 = validate_stage(stages, "T5", required=True)
    t6 = validate_stage(stages, "T6", required=False)
    t7 = validate_stage(stages, "T7", required=False)

    t5_decision = t5.get("decision")
    if t5_decision not in ("Proceed", "Reject"):
        raise ValueError("final T8 decision is blocked while T5 is Hold/unresolved")
    if t5_decision == "Reject":
        if t6["status"] != "not_applicable" or t7["status"] != "not_applicable":
            raise ValueError("T5 Reject requires T6/T7 to remain not_applicable")

    observations = manifest.get("observations")
    if not isinstance(observations, dict):
        raise ValueError("observations are required")
    allowed = {
        "semanticCandidateSignal": {"observed", "not_observed", "mixed"},
        "affinityIncrement": {"observed", "not_observed", "mixed", "not_measured"},
        "cognitiveControlIncrement": {
            "observed",
            "not_observed",
            "mixed",
            "not_measured",
        },
        "anchoringRisk": {
            "acceptable",
            "unacceptable",
            "uncertain",
            "not_measured",
        },
        "localBudget": {"acceptable", "unacceptable", "uncertain"},
    }
    for key, values in allowed.items():
        if observations.get(key) not in values:
            raise ValueError(f"observations.{key} is invalid")

    if t6["status"] == "completed" and observations["affinityIncrement"] == "not_measured":
        raise ValueError("completed T6 cannot have affinityIncrement=not_measured")
    if t6["status"] == "not_applicable" and observations["affinityIncrement"] != "not_measured":
        raise ValueError("T6 not_applicable requires affinityIncrement=not_measured")
    if t7["status"] == "completed" and observations["cognitiveControlIncrement"] == "not_measured":
        raise ValueError(
            "completed T7 cannot have cognitiveControlIncrement=not_measured"
        )
    if t7["status"] == "not_applicable" and observations["cognitiveControlIncrement"] != "not_measured":
        raise ValueError(
            "T7 not_applicable requires cognitiveControlIncrement=not_measured"
        )

    boundary = manifest.get("researchBoundary")
    if not isinstance(boundary, dict):
        raise ValueError("researchBoundary is required")
    for key in (
        "productionSchemaChanged",
        "productionApiChanged",
        "autoApplyObserved",
        "userFacingScoreOrRankingObserved",
    ):
        if boundary.get(key) is not False:
            raise ValueError(f"researchBoundary.{key} must remain false")

    future = manifest.get("requiredFutureBoundaryChanges")
    if not isinstance(future, list) or not all(
        isinstance(item, str) and item for item in future
    ):
        raise ValueError("requiredFutureBoundaryChanges must be a string list")


def build_packet(manifest_raw: bytes, manifest: dict[str, Any]) -> dict[str, Any]:
    validate_manifest(manifest)
    stages = manifest["stages"]
    return {
        "schema": PACKET_SCHEMA,
        "benchmarkId": manifest["benchmarkId"],
        "sourceEvidenceManifestSha256": sha256_bytes(manifest_raw),
        "decisionAuthority": "Maintainer",
        "automaticDecision": False,
        "singleCompositeScore": False,
        "winnerSelected": False,
        "observations": manifest["observations"],
        "stageStatus": {
            name: {
                key: value
                for key, value in stage.items()
                if key in ("status", "decision", "reasonCode", "artifactSha256")
            }
            for name, stage in stages.items()
        },
        "requiredFutureBoundaryChanges": manifest[
            "requiredFutureBoundaryChanges"
        ],
        "decisionSemantics": {
            "no_adoption": (
                "Do not carry the cognition layer forward from this research line."
            ),
            "retrieval_only": (
                "Keep only bounded retrieval/candidate recall; do not claim an "
                "affinity-specific cognitive-control layer."
            ),
            "candidate_cognition_layer": (
                "Carry a proposal-only candidate cognition layer forward; no "
                "automatic island/label/relation authority is granted."
            ),
            "adr_trigger": (
                "Do not finalize production adoption in this issue; open ADR work "
                "because durable production boundaries must change."
            ),
        },
        "allowedDrivers": {
            key: sorted(values) for key, values in DRIVERS.items()
        },
    }


def build_response_template(packet: dict[str, Any], packet_raw: bytes) -> dict[str, Any]:
    if packet.get("schema") != PACKET_SCHEMA:
        raise ValueError("invalid architecture decision packet")
    return {
        "schema": RESPONSE_SCHEMA,
        "benchmarkId": packet.get("benchmarkId"),
        "status": "in_progress",
        "sourceDecisionPacketSha256": sha256_bytes(packet_raw),
        "decision": "",
        "drivers": [],
        "rationale": "",
        "completedByRole": "Maintainer",
    }


def validate_decision(
    packet: dict[str, Any],
    decision: str,
    drivers: list[str],
) -> None:
    if decision not in DECISIONS:
        raise ValueError(f"decision must be one of {DECISIONS}")
    if not drivers:
        raise ValueError("at least one decision driver is required")
    if len(drivers) != len(set(drivers)):
        raise ValueError("decision drivers must not contain duplicates")
    unknown = set(drivers) - ALL_DRIVERS
    if unknown:
        raise ValueError(f"unknown decision drivers: {sorted(unknown)}")
    if not (set(drivers) & DRIVERS[decision]):
        raise ValueError(f"{decision} requires at least one matching driver")

    observations = packet["observations"]
    stage_status = packet["stageStatus"]

    if decision == "retrieval_only":
        if observations["semanticCandidateSignal"] == "not_observed":
            raise ValueError("retrieval_only requires some semantic candidate signal")

    if decision == "candidate_cognition_layer":
        if stage_status["T6"]["status"] != "completed":
            raise ValueError("candidate_cognition_layer requires completed T6")
        if stage_status["T7"]["status"] != "completed":
            raise ValueError("candidate_cognition_layer requires completed T7")
        if observations["affinityIncrement"] not in ("observed", "mixed"):
            raise ValueError(
                "candidate_cognition_layer requires affinity increment evidence"
            )
        if observations["cognitiveControlIncrement"] not in ("observed", "mixed"):
            raise ValueError(
                "candidate_cognition_layer requires cognitive-control evidence"
            )
        if observations["anchoringRisk"] != "acceptable":
            raise ValueError(
                "candidate_cognition_layer requires acceptable anchoring risk"
            )
        if observations["localBudget"] != "acceptable":
            raise ValueError(
                "candidate_cognition_layer requires acceptable local budget"
            )

    if decision == "adr_trigger":
        if not packet.get("requiredFutureBoundaryChanges"):
            raise ValueError("adr_trigger requires a future production boundary change")
        if not (set(drivers) & DRIVERS["adr_trigger"]):
            raise ValueError("adr_trigger requires an ADR-boundary driver")


def freeze_decision(
    packet_raw: bytes,
    packet: dict[str, Any],
    response: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    if packet.get("schema") != PACKET_SCHEMA:
        raise ValueError("invalid architecture decision packet")
    if response.get("schema") != RESPONSE_SCHEMA:
        raise ValueError("invalid architecture decision response")
    if response.get("benchmarkId") != packet.get("benchmarkId"):
        raise ValueError("response benchmarkId does not match packet")
    if response.get("status") != "complete":
        raise ValueError("response status must be complete")
    if response.get("sourceDecisionPacketSha256") != sha256_bytes(packet_raw):
        raise ValueError("response packet SHA-256 does not match")
    if response.get("completedByRole") != "Maintainer":
        raise ValueError("architecture decision must be completed by Maintainer")

    decision = response.get("decision")
    drivers = response.get("drivers")
    if not isinstance(drivers, list) or not all(
        isinstance(item, str) and item for item in drivers
    ):
        raise ValueError("drivers must be a string list")
    validate_decision(packet, decision, drivers)

    rationale = response.get("rationale")
    if not isinstance(rationale, str) or not rationale.strip():
        raise ValueError("architecture decision requires a rationale")

    artifact = {
        "schema": DECISION_SCHEMA,
        "benchmarkId": packet.get("benchmarkId"),
        "state": "architecture_decision_frozen",
        "sourceDecisionPacketSha256": sha256_bytes(packet_raw),
        "decision": decision,
        "drivers": sorted(drivers),
        "rationale": rationale.strip(),
        "automaticDecision": False,
        "integrationDirectionSelected": decision
        in ("retrieval_only", "candidate_cognition_layer"),
        "productionAdoptionAuthorized": False,
        "automaticSemanticAuthorityAuthorized": False,
        "nextStep": {
            "no_adoption": "Close the research line and preserve evidence.",
            "retrieval_only": (
                "Plan bounded retrieval integration without semantic authority."
            ),
            "candidate_cognition_layer": (
                "Plan proposal-only candidate cognition integration; production "
                "changes still require normal architecture/change controls."
            ),
            "adr_trigger": (
                "Open ADR/design work before any production integration."
            ),
        }[decision],
    }
    artifact_raw = canonical_json_bytes(artifact)
    evidence = {
        "schema": EVIDENCE_SCHEMA,
        "benchmarkId": packet.get("benchmarkId"),
        "state": "architecture_decision_frozen",
        "sourceDecisionPacketSha256": sha256_bytes(packet_raw),
        "decisionArtifactSha256": sha256_bytes(artifact_raw),
        "decision": decision,
        "automaticDecision": False,
        "singleCompositeScore": False,
        "winnerSelected": False,
        "automaticSemanticAuthorityAuthorized": False,
    }
    return artifact, evidence


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build or freeze the preregistered T8 architecture decision."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    packet_parser = sub.add_parser("packet")
    packet_parser.add_argument("evidence_manifest", type=Path)
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
            manifest_raw = args.evidence_manifest.read_bytes()
            manifest = json.loads(manifest_raw.decode("utf-8"))
            packet = build_packet(manifest_raw, manifest)
            packet_raw = canonical_json_bytes(packet)
            response = build_response_template(packet, packet_raw)
            args.packet_output.parent.mkdir(parents=True, exist_ok=True)
            args.response_output.parent.mkdir(parents=True, exist_ok=True)
            args.packet_output.write_bytes(packet_raw)
            args.response_output.write_bytes(canonical_json_bytes(response))
            print(f"WROTE_T8_PACKET: {args.packet_output}")
            print(f"WROTE_T8_RESPONSE: {args.response_output}")
            print("AUTOMATIC_DECISION: false")
            print("SINGLE_COMPOSITE_SCORE: false")
            return 0

        packet_raw = args.packet.read_bytes()
        packet = json.loads(packet_raw.decode("utf-8"))
        response = load_json(args.response)
        decision, evidence = freeze_decision(packet_raw, packet, response)
        decision_raw = canonical_json_bytes(decision)
        args.decision_output.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_output.parent.mkdir(parents=True, exist_ok=True)
        args.decision_output.write_bytes(decision_raw)
        args.evidence_output.write_bytes(canonical_json_bytes(evidence))
        print(f"WROTE_T8_DECISION: {args.decision_output}")
        print(f"WROTE_T8_EVIDENCE: {args.evidence_output}")
        print(f"DECISION: {decision['decision']}")
        print("AUTOMATIC_SEMANTIC_AUTHORITY_AUTHORIZED: false")
        return 0
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
