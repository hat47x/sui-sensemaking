#!/usr/bin/env python3
"""Build a preregistered, counterbalanced T7 cognitive-dogfood plan.

The plan compares candidate assistance with an unaided control without using
benchmark results to assign conditions. It is research-only and never
authorizes automatic application of a candidate or production adoption.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any


MANIFEST_SCHEMA = "sui.cognitive-assoc-dogfood-study-source/v1"
PLAN_SCHEMA = "sui.cognitive-assoc-dogfood-plan/v1"

CONDITIONS = ("control", "candidate_assisted")
REQUIRED_PHASES = ("unaided", "intervention", "origin_blind_review")


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        + "\n"
    ).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def stable_bit(study_id: str, pair_id: str) -> int:
    digest = hashlib.sha256(f"{study_id}|{pair_id}".encode("utf-8")).digest()
    return digest[0] & 1


def validate_task(task: dict[str, Any], seen_ids: set[str]) -> None:
    task_id = task.get("taskId")
    if not isinstance(task_id, str) or not task_id:
        raise ValueError("taskId is required")
    if task_id in seen_ids:
        raise ValueError(f"duplicate taskId: {task_id}")
    seen_ids.add(task_id)

    snapshot_sha = task.get("snapshotSha256")
    if not isinstance(snapshot_sha, str) or len(snapshot_sha) != 64:
        raise ValueError(f"{task_id}: snapshotSha256 is required")
    card_count = task.get("cardCount")
    if not isinstance(card_count, int) or card_count < 30:
        raise ValueError(f"{task_id}: cardCount must be at least 30")
    if task.get("textReviewedOnly") is not True:
        raise ValueError(f"{task_id}: only reviewed text is allowed")
    if task.get("selfReferentialToSui") is not False:
        raise ValueError(f"{task_id}: self-referential SUI tasks are forbidden")
    if task.get("seenByParticipantBeforeStudy") is not False:
        raise ValueError(f"{task_id}: previously seen tasks are forbidden")
    difficulty = task.get("difficultyBand")
    if difficulty not in ("low", "medium", "high"):
        raise ValueError(f"{task_id}: invalid difficultyBand")


def validate_manifest(source: dict[str, Any]) -> None:
    if source.get("schema") != MANIFEST_SCHEMA:
        raise ValueError(f"manifest schema must be {MANIFEST_SCHEMA}")
    study_id = source.get("studyId")
    if not isinstance(study_id, str) or not study_id:
        raise ValueError("studyId is required")
    if source.get("participantRole") != "Maintainer":
        raise ValueError("v0 dogfood participantRole must be Maintainer")

    layer = source.get("candidateLayer")
    if not isinstance(layer, dict):
        raise ValueError("candidateLayer is required")
    digest = layer.get("artifactSha256")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ValueError("candidateLayer.artifactSha256 is required")
    if not isinstance(layer.get("variantId"), str) or not layer.get("variantId"):
        raise ValueError("candidateLayer.variantId is required")
    if layer.get("productionAdoptionAuthorized") is not False:
        raise ValueError("dogfood candidate layer must remain research-only")
    if layer.get("autoApply") is not False:
        raise ValueError("candidate layer may not auto-apply suggestions")
    if layer.get("scoreOrRankingVisible") is not False:
        raise ValueError("candidate layer may not expose score/ranking")

    phases = source.get("phaseSeconds")
    if not isinstance(phases, dict) or set(phases) != set(REQUIRED_PHASES):
        raise ValueError(f"phaseSeconds must define exactly {REQUIRED_PHASES}")
    for phase in REQUIRED_PHASES:
        value = phases[phase]
        if not isinstance(value, int) or value <= 0:
            raise ValueError(f"phaseSeconds.{phase} must be a positive integer")

    pairs = source.get("taskPairs")
    if not isinstance(pairs, list) or len(pairs) < 2:
        raise ValueError("at least two taskPairs are required for counterbalancing")

    seen_pair_ids: set[str] = set()
    seen_task_ids: set[str] = set()
    for pair in pairs:
        if not isinstance(pair, dict):
            raise ValueError("taskPair must be an object")
        pair_id = pair.get("pairId")
        if not isinstance(pair_id, str) or not pair_id:
            raise ValueError("pairId is required")
        if pair_id in seen_pair_ids:
            raise ValueError(f"duplicate pairId: {pair_id}")
        seen_pair_ids.add(pair_id)

        tasks = pair.get("tasks")
        if not isinstance(tasks, list) or len(tasks) != 2:
            raise ValueError(f"{pair_id}: exactly two tasks are required")
        for task in tasks:
            validate_task(task, seen_task_ids)

        if tasks[0]["difficultyBand"] != tasks[1]["difficultyBand"]:
            raise ValueError(f"{pair_id}: paired tasks must share difficultyBand")
        larger = max(tasks[0]["cardCount"], tasks[1]["cardCount"])
        smaller = min(tasks[0]["cardCount"], tasks[1]["cardCount"])
        if larger > smaller * 1.25:
            raise ValueError(
                f"{pair_id}: paired cardCount difference exceeds 25 percent"
            )
        if tasks[0]["snapshotSha256"] == tasks[1]["snapshotSha256"]:
            raise ValueError(f"{pair_id}: paired tasks must be distinct snapshots")


def build_plan(source_raw: bytes, source: dict[str, Any]) -> dict[str, Any]:
    validate_manifest(source)
    study_id = source["studyId"]

    sessions: list[dict[str, Any]] = []
    control_first = 0
    assisted_first = 0
    for pair in sorted(source["taskPairs"], key=lambda item: item["pairId"]):
        pair_id = pair["pairId"]
        tasks = sorted(pair["tasks"], key=lambda item: item["taskId"])
        bit = stable_bit(study_id, pair_id)

        if bit == 0:
            assignment = [
                (tasks[0], "control", 1),
                (tasks[1], "candidate_assisted", 2),
            ]
            control_first += 1
        else:
            assignment = [
                (tasks[0], "candidate_assisted", 1),
                (tasks[1], "control", 2),
            ]
            assisted_first += 1

        for task, condition, order in assignment:
            sessions.append(
                {
                    "sessionId": f"{pair_id}:{task['taskId']}:{condition}",
                    "pairId": pair_id,
                    "taskId": task["taskId"],
                    "snapshotSha256": task["snapshotSha256"],
                    "condition": condition,
                    "orderWithinPair": order,
                    "phaseSeconds": source["phaseSeconds"],
                    "candidateVisibility": (
                        {
                            "unaided": False,
                            "intervention": True,
                            "origin_blind_review": False,
                        }
                        if condition == "candidate_assisted"
                        else {
                            "unaided": False,
                            "intervention": False,
                            "origin_blind_review": False,
                        }
                    ),
                }
            )

    return {
        "schema": PLAN_SCHEMA,
        "studyId": study_id,
        "sourceManifestSha256": sha256_bytes(source_raw),
        "participantRole": "Maintainer",
        "candidateLayer": source["candidateLayer"],
        "assignmentMethod": "sha256(studyId|pairId)-bit deterministic crossover",
        "sessions": sessions,
        "counterbalance": {
            "pairCount": len(source["taskPairs"]),
            "controlFirstPairs": control_first,
            "candidateAssistedFirstPairs": assisted_first,
        },
        "measurementPolicy": {
            "singleCompositeScore": False,
            "winnerSelected": False,
            "candidateRankingVisible": False,
            "autoApply": False,
            "axes": [
                "newly_considered_material",
                "structure_revision",
                "residual_and_hold_transitions",
                "attention_redistribution",
                "candidate_adopt_reject_hold",
                "origin_blind_retention",
                "time_and_interaction_cost",
            ],
            "interpretation": [
                "More grouping is not automatically better.",
                "Fewer residuals are not automatically better.",
                "Candidate adoption is not automatically success.",
                "Rejection or hold of a candidate is valid cognitive work.",
                "Origin-blind review is used to inspect anchoring risk, not to score the human.",
            ],
        },
        "carryoverBoundary": {
            "sameTaskInBothConditions": False,
            "previouslySeenTasksAllowed": False,
            "selfReferentialSuiTasksAllowed": False,
        },
        "productionAdoptionAuthorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the preregistered T7 cognitive-dogfood session plan."
    )
    parser.add_argument("source_manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    try:
        raw = args.source_manifest.read_bytes()
        source = json.loads(raw.decode("utf-8"))
        plan = build_plan(raw, source)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical_json_bytes(plan))
        print(f"WROTE_T7_PLAN: {args.output}")
        print(f"PAIR_COUNT: {plan['counterbalance']['pairCount']}")
        print(f"SESSION_COUNT: {len(plan['sessions'])}")
        print("SINGLE_COMPOSITE_SCORE: false")
        print("WINNER_SELECTED: false")
        print("PRODUCTION_ADOPTION_AUTHORIZED: false")
        return 0
    except (OSError, UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
