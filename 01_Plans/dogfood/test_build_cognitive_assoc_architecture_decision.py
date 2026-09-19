from __future__ import annotations

import copy
import unittest

from build_cognitive_assoc_architecture_decision import (
    DECISION_SCHEMA,
    EVIDENCE_SCHEMA,
    MANIFEST_SCHEMA,
    PACKET_SCHEMA,
    RESPONSE_SCHEMA,
    build_packet,
    build_response_template,
    canonical_json_bytes,
    freeze_decision,
)


def manifest_fixture():
    return {
        "schema": MANIFEST_SCHEMA,
        "benchmarkId": "synthetic-v0",
        "stages": {
            "T2": {"status": "completed", "artifactSha256": "1" * 64},
            "T4": {"status": "completed", "artifactSha256": "2" * 64},
            "T5": {
                "status": "completed",
                "artifactSha256": "3" * 64,
                "decision": "Proceed",
            },
            "T6": {"status": "completed", "artifactSha256": "4" * 64},
            "T7": {"status": "completed", "artifactSha256": "5" * 64},
        },
        "observations": {
            "semanticCandidateSignal": "observed",
            "affinityIncrement": "observed",
            "cognitiveControlIncrement": "observed",
            "anchoringRisk": "acceptable",
            "localBudget": "acceptable",
        },
        "researchBoundary": {
            "productionSchemaChanged": False,
            "productionApiChanged": False,
            "autoApplyObserved": False,
            "userFacingScoreOrRankingObserved": False,
        },
        "requiredFutureBoundaryChanges": [],
    }


def manifest_bytes(value):
    return canonical_json_bytes(value)


class ArchitectureDecisionTests(unittest.TestCase):
    def setUp(self):
        self.manifest = manifest_fixture()
        self.manifest_raw = manifest_bytes(self.manifest)
        self.packet = build_packet(self.manifest_raw, self.manifest)
        self.packet_raw = canonical_json_bytes(self.packet)

    def response(self, decision, drivers):
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

    def test_packet_is_human_decision_only(self):
        self.assertEqual(self.packet["schema"], PACKET_SCHEMA)
        self.assertIs(self.packet["automaticDecision"], False)
        self.assertIs(self.packet["singleCompositeScore"], False)
        self.assertIs(self.packet["winnerSelected"], False)
        self.assertEqual(self.packet["decisionAuthority"], "Maintainer")
        self.assertEqual(
            set(self.packet["decisionSemantics"]),
            {
                "no_adoption",
                "retrieval_only",
                "candidate_cognition_layer",
                "adr_trigger",
            },
        )

    def test_response_template_is_uncommitted(self):
        response = build_response_template(self.packet, self.packet_raw)
        self.assertEqual(response["schema"], RESPONSE_SCHEMA)
        self.assertEqual(response["status"], "in_progress")
        self.assertEqual(response["decision"], "")
        self.assertEqual(response["drivers"], [])
        self.assertEqual(response["completedByRole"], "Maintainer")

    def test_candidate_cognition_layer_requires_full_evidence(self):
        response = self.response(
            "candidate_cognition_layer",
            [
                "semantic_signal_useful",
                "affinity_increment_observed",
                "cognitive_control_increment_observed",
                "anchoring_acceptable",
                "local_budget_acceptable",
                "proposal_only_boundary_sufficient",
            ],
        )
        artifact, evidence = freeze_decision(
            self.packet_raw, self.packet, response
        )
        self.assertEqual(artifact["schema"], DECISION_SCHEMA)
        self.assertEqual(artifact["decision"], "candidate_cognition_layer")
        self.assertIs(artifact["integrationDirectionSelected"], True)
        self.assertIs(artifact["productionAdoptionAuthorized"], False)
        self.assertIs(artifact["automaticSemanticAuthorityAuthorized"], False)
        self.assertEqual(evidence["schema"], EVIDENCE_SCHEMA)

    def test_candidate_cognition_layer_rejects_missing_t6(self):
        manifest = manifest_fixture()
        manifest["stages"]["T6"] = {
            "status": "not_applicable",
            "reasonCode": "history_unavailable",
        }
        manifest["observations"]["affinityIncrement"] = "not_measured"
        packet = build_packet(manifest_bytes(manifest), manifest)
        packet_raw = canonical_json_bytes(packet)
        response = build_response_template(packet, packet_raw)
        response.update(
            {
                "status": "complete",
                "decision": "candidate_cognition_layer",
                "drivers": ["semantic_signal_useful"],
                "rationale": "synthetic",
            }
        )
        with self.assertRaisesRegex(ValueError, "requires completed T6"):
            freeze_decision(packet_raw, packet, response)

    def test_retrieval_only_requires_some_semantic_signal(self):
        response = self.response(
            "retrieval_only",
            ["retrieval_signal_useful", "keep_authority_outside_kernel"],
        )
        artifact, _ = freeze_decision(self.packet_raw, self.packet, response)
        self.assertEqual(artifact["decision"], "retrieval_only")
        self.assertIs(artifact["productionAdoptionAuthorized"], False)

        manifest = manifest_fixture()
        manifest["observations"]["semanticCandidateSignal"] = "not_observed"
        packet = build_packet(manifest_bytes(manifest), manifest)
        packet_raw = canonical_json_bytes(packet)
        bad = build_response_template(packet, packet_raw)
        bad.update(
            {
                "status": "complete",
                "decision": "retrieval_only",
                "drivers": ["simple_local_retrieval_value"],
                "rationale": "synthetic",
            }
        )
        with self.assertRaisesRegex(ValueError, "semantic candidate signal"):
            freeze_decision(packet_raw, packet, bad)

    def test_no_adoption_can_freeze_without_integration(self):
        response = self.response(
            "no_adoption",
            ["complexity_exceeds_observed_value"],
        )
        artifact, _ = freeze_decision(self.packet_raw, self.packet, response)
        self.assertEqual(artifact["decision"], "no_adoption")
        self.assertIs(artifact["integrationDirectionSelected"], False)
        self.assertIs(artifact["productionAdoptionAuthorized"], False)

    def test_adr_trigger_requires_future_boundary_change(self):
        response = self.response(
            "adr_trigger",
            ["production_api_needed"],
        )
        with self.assertRaisesRegex(ValueError, "future production boundary change"):
            freeze_decision(self.packet_raw, self.packet, response)

        manifest = manifest_fixture()
        manifest["requiredFutureBoundaryChanges"] = ["production_api"]
        packet = build_packet(manifest_bytes(manifest), manifest)
        packet_raw = canonical_json_bytes(packet)
        response = build_response_template(packet, packet_raw)
        response.update(
            {
                "status": "complete",
                "decision": "adr_trigger",
                "drivers": ["production_api_needed"],
                "rationale": "synthetic",
            }
        )
        artifact, _ = freeze_decision(packet_raw, packet, response)
        self.assertEqual(artifact["decision"], "adr_trigger")
        self.assertIs(artifact["productionAdoptionAuthorized"], False)

    def test_t5_reject_requires_t6_t7_not_applicable(self):
        manifest = manifest_fixture()
        manifest["stages"]["T5"]["decision"] = "Reject"
        with self.assertRaisesRegex(ValueError, "T5 Reject requires T6/T7"):
            build_packet(manifest_bytes(manifest), manifest)

        manifest["stages"]["T6"] = {
            "status": "not_applicable",
            "reasonCode": "t5_reject",
        }
        manifest["stages"]["T7"] = {
            "status": "not_applicable",
            "reasonCode": "t5_reject",
        }
        manifest["observations"]["affinityIncrement"] = "not_measured"
        manifest["observations"]["cognitiveControlIncrement"] = "not_measured"
        packet = build_packet(manifest_bytes(manifest), manifest)
        self.assertEqual(packet["stageStatus"]["T5"]["decision"], "Reject")

    def test_t5_hold_blocks_t8(self):
        manifest = manifest_fixture()
        manifest["stages"]["T5"]["decision"] = "Hold"
        with self.assertRaisesRegex(ValueError, "blocked while T5 is Hold"):
            build_packet(manifest_bytes(manifest), manifest)

    def test_packet_sha_drift_fails_closed(self):
        response = self.response("no_adoption", ["evidence_inconclusive"])
        response["sourceDecisionPacketSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            freeze_decision(self.packet_raw, self.packet, response)

    def test_research_boundary_must_remain_clean(self):
        manifest = manifest_fixture()
        manifest["researchBoundary"]["productionApiChanged"] = True
        with self.assertRaisesRegex(ValueError, "productionApiChanged"):
            build_packet(manifest_bytes(manifest), manifest)

    def test_not_applicable_stage_requires_matching_not_measured_observation(self):
        manifest = manifest_fixture()
        manifest["stages"]["T7"] = {
            "status": "not_applicable",
            "reasonCode": "t6_unavailable",
        }
        with self.assertRaisesRegex(ValueError, "requires cognitiveControlIncrement"):
            build_packet(manifest_bytes(manifest), manifest)


if __name__ == "__main__":
    unittest.main()
