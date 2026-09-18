#!/usr/bin/env python3
"""Freeze completed model-blind human adjudication for COGNITIVE-ASSOC-01.

This tool does not perform any judgement. It only validates that a Maintainer
completed the preregistered review set without semantic-model leakage, then
writes a deterministic adjudicated artifact and a separate SHA-256 evidence
record.

The semantic baseline gate must remain closed while the response is being
completed. A successful freeze only makes the benchmark eligible for the next
explicit step; it does not execute or score any semantic model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


TEMPLATE_SCHEMA = "sui.cognitive-assoc-human-adjudication/v1"
ARTIFACT_SCHEMA = "sui.cognitive-assoc-adjudication/v1"
EVIDENCE_SCHEMA = "sui.cognitive-assoc-adjudication-freeze-evidence/v1"

ALLOWED_LABELS = (
    "hard_negative",
    "related_but_separate",
    "ambiguous_or_held",
    "exclude",
)

FORBIDDEN_KEYS = {
    "selectionStrata",
    "sourceIslandId",
    "islandId",
    "islandTitle",
    "x",
    "y",
    "geometry",
    "edges",
    "score",
    "similarity",
    "distance",
    "activation",
    "confidence",
    "ranking",
    "modelOutput",
    "modelExplanation",
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def assert_no_forbidden_keys(value: Any, path: str = "root") -> None:
    if isinstance(value, dict):
        forbidden = FORBIDDEN_KEYS.intersection(value)
        if forbidden:
            raise ValueError(
                f"human adjudication input leaks forbidden fields at {path}: "
                f"{sorted(forbidden)}"
            )
        for key, child in value.items():
            assert_no_forbidden_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            assert_no_forbidden_keys(child, f"{path}[{index}]")


def selected_candidates(selected: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if selected.get("status") != "pending_human":
        raise ValueError("selected review set must remain pending_human")
    if selected.get("semanticBaselineGate") != "closed":
        raise ValueError("selected review set semantic baseline gate must be closed")
    if selected.get("modelOutputsAllowed") is not False:
        raise ValueError("selected review set must forbid model outputs")

    candidates: dict[str, dict[str, Any]] = {}
    for collection_name, expected_size in (
        ("pairCandidates", 2),
        ("twoPlusOneCandidates", 3),
    ):
        collection = selected.get(collection_name)
        if not isinstance(collection, list):
            raise ValueError(f"missing selected collection: {collection_name}")
        for item in collection:
            candidate_id = item.get("id")
            if not isinstance(candidate_id, str) or not candidate_id:
                raise ValueError(f"candidate without id in {collection_name}")
            if candidate_id in candidates:
                raise ValueError(f"duplicate selected candidate: {candidate_id}")
            if item.get("label") != "pending_human":
                raise ValueError(
                    f"selected candidate must remain pending_human: {candidate_id}"
                )
            if tuple(item.get("allowedLabels", ())) != ALLOWED_LABELS:
                raise ValueError(f"allowedLabels drift: {candidate_id}")
            card_ids = item.get("cardIds")
            if not isinstance(card_ids, list) or len(card_ids) != expected_size:
                raise ValueError(
                    f"candidate {candidate_id} must contain {expected_size} cardIds"
                )
            if len(set(card_ids)) != expected_size:
                raise ValueError(f"candidate repeats cardIds: {candidate_id}")
            document_id = item.get("documentId")
            if not isinstance(document_id, str) or not document_id:
                raise ValueError(f"candidate missing documentId: {candidate_id}")
            candidates[candidate_id] = {
                "candidateId": candidate_id,
                "candidateType": (
                    "pair" if collection_name == "pairCandidates" else "two_plus_one"
                ),
                "documentId": document_id,
                "cardIds": list(card_ids),
            }

    if not candidates:
        raise ValueError("selected review set has no candidates")
    return candidates


def build_response_template(
    selected: dict[str, Any], selected_raw: bytes
) -> dict[str, Any]:
    candidates = selected_candidates(selected)
    return {
        "schema": TEMPLATE_SCHEMA,
        "benchmarkId": selected.get("benchmarkId"),
        "status": "in_progress",
        "sourceSelectedReviewSetSha256": sha256_bytes(selected_raw),
        "semanticBaselineGate": "closed",
        "modelOutputsAllowed": False,
        "attestation": {
            "completedByRole": "Maintainer",
            "semanticModelOutputsViewedBeforeCompletion": None,
        },
        "judgements": [
            {
                "candidateId": candidate_id,
                "label": "",
                "reason": "",
            }
            for candidate_id in sorted(candidates)
        ],
    }


def validate_response(
    selected: dict[str, Any],
    selected_raw: bytes,
    response: dict[str, Any],
) -> tuple[list[dict[str, str]], dict[str, dict[str, Any]]]:
    assert_no_forbidden_keys(response)
    candidates = selected_candidates(selected)

    if response.get("schema") != TEMPLATE_SCHEMA:
        raise ValueError(f"response schema must be {TEMPLATE_SCHEMA}")
    if response.get("benchmarkId") != selected.get("benchmarkId"):
        raise ValueError("response benchmarkId does not match selected review set")
    if response.get("status") != "complete":
        raise ValueError("response status must be complete before freeze")
    if response.get("sourceSelectedReviewSetSha256") != sha256_bytes(selected_raw):
        raise ValueError("response selected review set SHA-256 does not match")
    if response.get("semanticBaselineGate") != "closed":
        raise ValueError("response semantic baseline gate must remain closed")
    if response.get("modelOutputsAllowed") is not False:
        raise ValueError("response must keep model outputs forbidden")

    attestation = response.get("attestation")
    if not isinstance(attestation, dict):
        raise ValueError("response attestation is required")
    if attestation.get("completedByRole") != "Maintainer":
        raise ValueError("response must be attested by Maintainer role")
    if attestation.get("semanticModelOutputsViewedBeforeCompletion") is not False:
        raise ValueError(
            "Maintainer must attest that semantic model outputs were not viewed "
            "before completing adjudication"
        )

    judgements = response.get("judgements")
    if not isinstance(judgements, list):
        raise ValueError("response judgements must be a list")

    seen: set[str] = set()
    normalized: list[dict[str, str]] = []
    for index, item in enumerate(judgements):
        if not isinstance(item, dict):
            raise ValueError(f"judgement {index} must be an object")
        allowed_keys = {"candidateId", "label", "reason"}
        if set(item) != allowed_keys:
            raise ValueError(
                f"judgement {index} fields must be exactly {sorted(allowed_keys)}"
            )
        candidate_id = item.get("candidateId")
        if not isinstance(candidate_id, str) or not candidate_id:
            raise ValueError(f"judgement {index} has invalid candidateId")
        if candidate_id in seen:
            raise ValueError(f"duplicate human judgement: {candidate_id}")
        seen.add(candidate_id)
        if candidate_id not in candidates:
            raise ValueError(f"unknown human judgement candidate: {candidate_id}")

        label = item.get("label")
        if label not in ALLOWED_LABELS:
            raise ValueError(
                f"candidate {candidate_id} label must be one of {ALLOWED_LABELS}"
            )
        reason = item.get("reason")
        if not isinstance(reason, str):
            raise ValueError(f"candidate {candidate_id} reason must be a string")
        normalized.append(
            {
                "candidateId": candidate_id,
                "label": label,
                "reason": reason,
            }
        )

    missing = set(candidates) - seen
    if missing:
        raise ValueError(
            f"human adjudication is incomplete; missing {len(missing)} candidates"
        )
    extra = seen - set(candidates)
    if extra:
        raise ValueError(f"human adjudication has unknown candidates: {sorted(extra)}")
    if len(seen) != len(candidates):
        raise ValueError("human adjudication candidate count mismatch")

    normalized.sort(key=lambda item: item["candidateId"])
    return normalized, candidates


def build_frozen_artifact(
    selected: dict[str, Any],
    selected_raw: bytes,
    response: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    judgements, candidates = validate_response(selected, selected_raw, response)
    label_counts = Counter(item["label"] for item in judgements)
    pair_count = sum(
        1 for candidate in candidates.values() if candidate["candidateType"] == "pair"
    )
    triple_count = len(candidates) - pair_count

    artifact = {
        "schema": ARTIFACT_SCHEMA,
        "benchmarkId": selected.get("benchmarkId"),
        "state": "human_adjudication_frozen",
        "modelBlind": True,
        "sourceSelectedReviewSetSha256": sha256_bytes(selected_raw),
        "candidateCounts": {
            "total": len(candidates),
            "pair": pair_count,
            "twoPlusOne": triple_count,
        },
        "labelCounts": {
            label: label_counts.get(label, 0) for label in ALLOWED_LABELS
        },
        "judgements": judgements,
    }
    artifact_bytes = canonical_json_bytes(artifact)

    evidence = {
        "schema": EVIDENCE_SCHEMA,
        "benchmarkId": selected.get("benchmarkId"),
        "state": "human_adjudication_frozen",
        "semanticBaselineGate": "eligible_for_explicit_open",
        "modelBlind": True,
        "sourceSelectedReviewSetSha256": sha256_bytes(selected_raw),
        "adjudicatedArtifactSha256": sha256_bytes(artifact_bytes),
        "candidateCounts": artifact["candidateCounts"],
        "labelCounts": artifact["labelCounts"],
        "nextAllowedStep": (
            "T3/T4 may consume semantic baselines only after this frozen "
            "adjudication artifact is committed as the benchmark v0 reference."
        ),
    }
    return artifact, evidence


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and freeze completed model-blind human adjudication."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    template_parser = subparsers.add_parser(
        "template", help="Generate an empty human adjudication response template."
    )
    template_parser.add_argument("selected_review_set", type=Path)
    template_parser.add_argument("output", type=Path)

    freeze_parser = subparsers.add_parser(
        "freeze", help="Validate a completed response and write frozen artifacts."
    )
    freeze_parser.add_argument("selected_review_set", type=Path)
    freeze_parser.add_argument("response", type=Path)
    freeze_parser.add_argument("artifact_output", type=Path)
    freeze_parser.add_argument("evidence_output", type=Path)

    args = parser.parse_args()

    try:
        selected_raw = args.selected_review_set.read_bytes()
        selected = json.loads(selected_raw.decode("utf-8"))

        if args.command == "template":
            template = build_response_template(selected, selected_raw)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(canonical_json_bytes(template))
            print(f"WROTE_TEMPLATE: {args.output}")
            print(f"CANDIDATE_COUNT: {len(template['judgements'])}")
            print("SEMANTIC_BASELINE_GATE: CLOSED")
            return 0

        response = load_json(args.response)
        artifact, evidence = build_frozen_artifact(
            selected, selected_raw, response
        )
        artifact_bytes = canonical_json_bytes(artifact)
        args.artifact_output.parent.mkdir(parents=True, exist_ok=True)
        args.evidence_output.parent.mkdir(parents=True, exist_ok=True)
        args.artifact_output.write_bytes(artifact_bytes)
        args.evidence_output.write_bytes(canonical_json_bytes(evidence))
        print(f"WROTE_ADJUDICATION: {args.artifact_output}")
        print(f"WROTE_EVIDENCE: {args.evidence_output}")
        print(f"CANDIDATE_COUNT: {artifact['candidateCounts']['total']}")
        print(f"ADJUDICATED_SHA256: {evidence['adjudicatedArtifactSha256']}")
        print("SEMANTIC_BASELINE_GATE: ELIGIBLE_FOR_EXPLICIT_OPEN")
        return 0
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
