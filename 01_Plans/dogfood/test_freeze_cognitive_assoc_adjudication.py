from __future__ import annotations

import copy
import hashlib
import json
import unittest

from freeze_cognitive_assoc_adjudication import (
    ALLOWED_LABELS,
    ARTIFACT_SCHEMA,
    EVIDENCE_SCHEMA,
    TEMPLATE_SCHEMA,
    build_frozen_artifact,
    build_response_template,
)


def selected_fixture() -> dict:
    allowed = list(ALLOWED_LABELS)
    return {
        "benchmarkId": "cognitive-assoc-benchmark-v0",
        "status": "pending_human",
        "semanticBaselineGate": "closed",
        "modelOutputsAllowed": False,
        "pairCandidates": [
            {
                "id": "doc:pair:c01+c02",
                "documentId": "doc",
                "cardIds": ["c01", "c02"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["U"],
            },
            {
                "id": "doc:pair:c03+c04",
                "documentId": "doc",
                "cardIds": ["c03", "c04"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["L"],
            },
        ],
        "twoPlusOneCandidates": [
            {
                "id": "doc:2plus1:g1:c01+c02+c05",
                "documentId": "doc",
                "cardIds": ["c01", "c02", "c05"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["U", "L"],
            }
        ],
    }


def selected_bytes(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def completed_response(selected: dict, raw: bytes) -> dict:
    response = build_response_template(selected, raw)
    response["status"] = "complete"
    response["attestation"]["semanticModelOutputsViewedBeforeCompletion"] = False
    labels = [
        "hard_negative",
        "related_but_separate",
        "ambiguous_or_held",
    ]
    for judgement, label in zip(response["judgements"], labels):
        judgement["label"] = label
        judgement["reason"] = ""
    return response


class CognitiveAssocAdjudicationFreezeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.selected = selected_fixture()
        self.raw = selected_bytes(self.selected)

    def test_template_is_model_blind_and_exactly_covers_selected_ids(self) -> None:
        template = build_response_template(self.selected, self.raw)
        self.assertEqual(template["schema"], TEMPLATE_SCHEMA)
        self.assertEqual(template["status"], "in_progress")
        self.assertEqual(template["semanticBaselineGate"], "closed")
        self.assertIs(template["modelOutputsAllowed"], False)
        self.assertIsNone(
            template["attestation"]["semanticModelOutputsViewedBeforeCompletion"]
        )
        self.assertEqual(
            [item["candidateId"] for item in template["judgements"]],
            [
                "doc:2plus1:g1:c01+c02+c05",
                "doc:pair:c01+c02",
                "doc:pair:c03+c04",
            ],
        )
        rendered = json.dumps(template, ensure_ascii=False)
        self.assertNotIn("selectionStrata", rendered)
        self.assertNotIn("similarity", rendered)
        self.assertNotIn("score", rendered)

    def test_complete_response_freezes_deterministically(self) -> None:
        response = completed_response(self.selected, self.raw)
        artifact, evidence = build_frozen_artifact(
            self.selected, self.raw, response
        )
        artifact2, evidence2 = build_frozen_artifact(
            self.selected, self.raw, copy.deepcopy(response)
        )

        self.assertEqual(artifact, artifact2)
        self.assertEqual(evidence, evidence2)
        self.assertEqual(artifact["schema"], ARTIFACT_SCHEMA)
        self.assertEqual(evidence["schema"], EVIDENCE_SCHEMA)
        self.assertEqual(artifact["candidateCounts"], {
            "total": 3,
            "pair": 2,
            "twoPlusOne": 1,
        })
        self.assertEqual(
            artifact["labelCounts"],
            {
                "hard_negative": 1,
                "related_but_separate": 1,
                "ambiguous_or_held": 1,
                "exclude": 0,
            },
        )
        self.assertEqual(
            evidence["semanticBaselineGate"], "eligible_for_explicit_open"
        )
        self.assertRegex(evidence["adjudicatedArtifactSha256"], r"^[0-9a-f]{64}$")

    def test_incomplete_label_fails_closed(self) -> None:
        response = completed_response(self.selected, self.raw)
        response["judgements"][0]["label"] = ""
        with self.assertRaisesRegex(ValueError, "label must be one of"):
            build_frozen_artifact(self.selected, self.raw, response)

    def test_missing_candidate_fails_closed(self) -> None:
        response = completed_response(self.selected, self.raw)
        response["judgements"].pop()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            build_frozen_artifact(self.selected, self.raw, response)

    def test_duplicate_candidate_fails_closed(self) -> None:
        response = completed_response(self.selected, self.raw)
        response["judgements"][1]["candidateId"] = response["judgements"][0]["candidateId"]
        with self.assertRaisesRegex(ValueError, "duplicate human judgement"):
            build_frozen_artifact(self.selected, self.raw, response)

    def test_unknown_candidate_fails_closed(self) -> None:
        response = completed_response(self.selected, self.raw)
        response["judgements"][0]["candidateId"] = "unknown"
        with self.assertRaisesRegex(ValueError, "unknown human judgement"):
            build_frozen_artifact(self.selected, self.raw, response)

    def test_selected_digest_drift_fails_closed(self) -> None:
        response = completed_response(self.selected, self.raw)
        response["sourceSelectedReviewSetSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256 does not match"):
            build_frozen_artifact(self.selected, self.raw, response)

    def test_model_blind_attestation_is_required(self) -> None:
        response = completed_response(self.selected, self.raw)
        response["attestation"]["semanticModelOutputsViewedBeforeCompletion"] = True
        with self.assertRaisesRegex(ValueError, "must attest"):
            build_frozen_artifact(self.selected, self.raw, response)

    def test_forbidden_model_field_fails_closed(self) -> None:
        response = completed_response(self.selected, self.raw)
        response["judgements"][0]["score"] = 0.9
        with self.assertRaisesRegex(ValueError, "forbidden fields"):
            build_frozen_artifact(self.selected, self.raw, response)

    def test_response_must_be_marked_complete(self) -> None:
        response = completed_response(self.selected, self.raw)
        response["status"] = "in_progress"
        with self.assertRaisesRegex(ValueError, "status must be complete"):
            build_frozen_artifact(self.selected, self.raw, response)

    def test_source_digest_matches_raw_bytes_not_reformatted_json(self) -> None:
        template = build_response_template(self.selected, self.raw)
        self.assertEqual(
            template["sourceSelectedReviewSetSha256"],
            hashlib.sha256(self.raw).hexdigest(),
        )
        reformatted = json.dumps(self.selected, ensure_ascii=False).encode("utf-8")
        self.assertNotEqual(
            template["sourceSelectedReviewSetSha256"],
            hashlib.sha256(reformatted).hexdigest(),
        )


if __name__ == "__main__":
    unittest.main()
