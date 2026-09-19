from __future__ import annotations

import copy
import json
import unittest

from build_cognitive_assoc_learned_sparse_gate import (
    DECISION_SCHEMA,
    EVIDENCE_SCHEMA,
    PACKET_SCHEMA,
    RESPONSE_SCHEMA,
    build_gate_packet,
    build_response_template,
    canonical_json_bytes,
    freeze_decision,
)


def stats(mean: float) -> dict:
    return {
        "count": 4,
        "mean": mean,
        "median": mean,
        "minimum": mean - 0.05,
        "maximum": mean + 0.05,
    }


def baseline(
    baseline_id: str,
    *,
    recall3: float,
    min_coherence: float,
    singleton: float,
    hard_u: float,
    hard_l: float,
    wall_ms: float,
    provider_memory: bool,
) -> dict:
    return {
        "baselineId": baseline_id,
        "R1_deepSemanticCandidateRecall": {
            "recallAt1": stats(max(0.0, recall3 - 0.2)),
            "recallAt3": stats(recall3),
            "recallAt5": stats(min(1.0, recall3 + 0.1)),
        },
        "R2_surfaceDecoyContrast": [
            {
                "referenceLabel": "hard_negative",
                "candidateType": "pair",
                "selectionStratum": "U",
                "scoreStats": stats(hard_u),
            },
            {
                "referenceLabel": "hard_negative",
                "candidateType": "pair",
                "selectionStratum": "L",
                "scoreStats": stats(hard_l),
            },
            {
                "referenceLabel": "related_but_separate",
                "candidateType": "pair",
                "selectionStratum": "U",
                "scoreStats": stats(hard_u + 0.2),
            },
        ],
        "R3_singletonPreservation": {
            "maximumSimilarity": stats(singleton),
            "caseCount": 2,
            "interpretation": "descriptive only",
        },
        "R4_setLevelCoherence": {
            "meanMemberCoherence": stats(min_coherence + 0.1),
            "minimumMemberCoherence": stats(min_coherence),
            "caseCount": 6,
        },
        "R5_wordingStability": {
            "status": "not_measured_in_v0",
            "reason": "no preregistered paraphrase cases",
        },
        "R7_continuousLocalBudget": {
            "wallMilliseconds": wall_ms,
            "pythonHarnessPeakBytes": 4096,
            "memoryScope": "python-harness-process-only",
            "externalProviderMemoryIncluded": provider_memory,
        },
        "notMeasuredHere": {
            "R6_affinityFeedbackIncrement": "requires T6",
            "R8_cognitiveControlIncrement": "requires T7",
        },
    }


def summary_fixture() -> dict:
    return {
        "schema": "sui.cognitive-assoc-evaluation-summary/v1",
        "benchmarkId": "synthetic-v0",
        "comparisonPolicy": {
            "singleCompositeScore": False,
            "winnerSelected": False,
            "baselineRankingProduced": False,
            "UAndLReportedSeparately": True,
            "pairAndTwoPlusOneReportedSeparately": True,
        },
        "baselines": [
            baseline(
                "A",
                recall3=0.40,
                min_coherence=0.35,
                singleton=0.25,
                hard_u=0.30,
                hard_l=0.55,
                wall_ms=3.0,
                provider_memory=False,
            ),
            baseline(
                "C",
                recall3=0.45,
                min_coherence=0.40,
                singleton=0.22,
                hard_u=0.28,
                hard_l=0.50,
                wall_ms=5.0,
                provider_memory=False,
            ),
            baseline(
                "E",
                recall3=0.75,
                min_coherence=0.70,
                singleton=0.32,
                hard_u=0.35,
                hard_l=0.58,
                wall_ms=18.0,
                provider_memory=False,
            ),
        ],
    }


def summary_bytes(value: dict) -> bytes:
    return canonical_json_bytes(value)


class LearnedSparseGateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.summary = summary_fixture()
        self.raw = summary_bytes(self.summary)
        self.packet = build_gate_packet(self.summary, self.raw)
        self.packet_raw = canonical_json_bytes(self.packet)

    def test_packet_is_descriptive_and_does_not_choose_winner(self) -> None:
        self.assertEqual(self.packet["schema"], PACKET_SCHEMA)
        self.assertIs(self.packet["automaticDecision"], False)
        self.assertIs(self.packet["singleCompositeScore"], False)
        self.assertIs(self.packet["winnerSelected"], False)
        self.assertAlmostEqual(self.packet["observations"]["R1_EminusA"], 0.35)
        self.assertAlmostEqual(self.packet["observations"]["R1_EminusC"], 0.30)
        self.assertAlmostEqual(self.packet["observations"]["R4_EminusC"], 0.30)
        self.assertIn(
            "E:external_provider_memory_not_measured",
            self.packet["missingEvidence"],
        )
        self.assertIn("Proceed", self.packet["decisionSemantics"])
        self.assertIn("Hold", self.packet["decisionSemantics"])
        self.assertIn("Reject", self.packet["decisionSemantics"])

    def test_response_template_is_uncommitted(self) -> None:
        response = build_response_template(self.packet, self.packet_raw)
        self.assertEqual(response["schema"], RESPONSE_SCHEMA)
        self.assertEqual(response["status"], "in_progress")
        self.assertEqual(response["decision"], "")
        self.assertEqual(response["drivers"], [])
        self.assertEqual(response["rationale"], "")
        self.assertEqual(response["completedByRole"], "Maintainer")

    def complete(self, decision: str, drivers: list[str]) -> dict:
        response = build_response_template(self.packet, self.packet_raw)
        response.update(
            {
                "status": "complete",
                "decision": decision,
                "drivers": drivers,
                "rationale": f"synthetic rationale for {decision}",
            }
        )
        return response

    def test_proceed_requires_semantic_and_sparse_value_drivers(self) -> None:
        response = self.complete(
            "Proceed",
            ["e_recall_advantage", "compact_representation_value"],
        )
        decision, evidence = freeze_decision(
            self.packet, self.packet_raw, response
        )
        self.assertEqual(decision["schema"], DECISION_SCHEMA)
        self.assertEqual(decision["decision"], "Proceed")
        self.assertIs(decision["productionAdoptionAuthorized"], False)
        self.assertEqual(evidence["schema"], EVIDENCE_SCHEMA)
        self.assertIs(evidence["automaticDecision"], False)

    def test_proceed_without_sparse_value_fails_closed(self) -> None:
        response = self.complete("Proceed", ["e_recall_advantage"])
        with self.assertRaisesRegex(ValueError, "sparse_value"):
            freeze_decision(self.packet, self.packet_raw, response)

    def test_proceed_without_semantic_gap_fails_closed(self) -> None:
        response = self.complete("Proceed", ["compact_representation_value"])
        with self.assertRaisesRegex(ValueError, "semantic_gap"):
            freeze_decision(self.packet, self.packet_raw, response)

    def test_hold_requires_explicit_blocker(self) -> None:
        response = self.complete("Hold", ["e_provider_memory_missing"])
        decision, _ = freeze_decision(self.packet, self.packet_raw, response)
        self.assertEqual(decision["decision"], "Hold")

        bad = self.complete("Hold", ["e_recall_advantage"])
        with self.assertRaisesRegex(ValueError, "hold driver"):
            freeze_decision(self.packet, self.packet_raw, bad)

    def test_reject_requires_reject_reason_and_conflicts_with_semantic_gap(self) -> None:
        response = self.complete(
            "Reject", ["sparse_complexity_without_target_deficit"]
        )
        decision, _ = freeze_decision(self.packet, self.packet_raw, response)
        self.assertEqual(decision["decision"], "Reject")

        bad = self.complete(
            "Reject", ["no_independent_semantic_gap", "e_recall_advantage"]
        )
        with self.assertRaisesRegex(ValueError, "cannot include semantic_gap"):
            freeze_decision(self.packet, self.packet_raw, bad)

    def test_packet_sha_drift_fails_closed(self) -> None:
        response = self.complete(
            "Proceed",
            ["e_recall_advantage", "offline_or_edge_value"],
        )
        response["sourceGatePacketSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            freeze_decision(self.packet, self.packet_raw, response)

    def test_summary_with_winner_fails_closed(self) -> None:
        summary = copy.deepcopy(self.summary)
        summary["comparisonPolicy"]["winnerSelected"] = True
        with self.assertRaisesRegex(ValueError, "winnerSelected"):
            build_gate_packet(summary, summary_bytes(summary))

    def test_summary_requires_a_c_e(self) -> None:
        summary = copy.deepcopy(self.summary)
        summary["baselines"] = summary["baselines"][:2]
        with self.assertRaisesRegex(ValueError, "A/C/E"):
            build_gate_packet(summary, summary_bytes(summary))

    def test_r5_must_remain_unmeasured_in_v0(self) -> None:
        summary = copy.deepcopy(self.summary)
        summary["baselines"][0]["R5_wordingStability"]["status"] = "measured"
        with self.assertRaisesRegex(ValueError, "R5"):
            build_gate_packet(summary, summary_bytes(summary))


if __name__ == "__main__":
    unittest.main()
