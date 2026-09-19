from __future__ import annotations

import copy
import unittest

from build_cognitive_assoc_affinity_ablation_plan import (
    CHANNELS,
    PLAN_SCHEMA,
    SOURCE_SCHEMA,
    build_plan,
    canonical_json_bytes,
)
from build_cognitive_assoc_learned_sparse_gate import (
    DECISION_SCHEMA,
    EVIDENCE_SCHEMA,
    sha256_bytes,
)


def t5_fixture(decision: str = "Proceed"):
    artifact = {
        "schema": DECISION_SCHEMA,
        "benchmarkId": "synthetic-v0",
        "state": "learned_sparse_gate_frozen",
        "sourceGatePacketSha256": "1" * 64,
        "decision": decision,
        "drivers": ["e_recall_advantage", "compact_representation_value"],
        "rationale": "synthetic",
        "productionAdoptionAuthorized": False,
        "nextStep": "synthetic",
    }
    raw = canonical_json_bytes(artifact)
    evidence = {
        "schema": EVIDENCE_SCHEMA,
        "benchmarkId": "synthetic-v0",
        "state": "learned_sparse_gate_frozen",
        "sourceGatePacketSha256": "1" * 64,
        "decisionArtifactSha256": sha256_bytes(raw),
        "decision": decision,
        "automaticDecision": False,
        "singleCompositeScore": False,
        "winnerSelected": False,
    }
    return raw, artifact, evidence


def source_fixture():
    return {
        "schema": SOURCE_SCHEMA,
        "benchmarkId": "synthetic-v0",
        "semanticReference": {
            "id": "D",
            "artifactSha256": "2" * 64,
        },
        "targetBoundary": {
            "targetSnapshotId": "target-snapshot-1",
            "onlyEventsStrictlyBeforeTarget": True,
            "targetSnapshotDerivedFeaturesAllowed": False,
        },
        "channels": {
            channel: {
                "status": "available",
                "targetDerived": False,
                "onlyPreTargetEvents": True,
                "evidenceRefs": [f"history:{channel}:1"],
            }
            for channel in CHANNELS
        },
    }


class AffinityAblationPlanTests(unittest.TestCase):
    def build(self, source=None, decision="Proceed"):
        decision_raw, artifact, evidence = t5_fixture(decision)
        source = source or source_fixture()
        source_raw = canonical_json_bytes(source)
        return build_plan(decision_raw, artifact, evidence, source_raw, source)

    def test_full_plan_has_fixed_sixteen_variants(self):
        plan = self.build()
        self.assertEqual(plan["schema"], PLAN_SCHEMA)
        self.assertEqual(plan["state"], "ready_for_bounded_research")
        self.assertIs(plan["executionAuthorized"], True)
        self.assertEqual(plan["availableChannels"], list(CHANNELS))
        self.assertEqual(plan["missingChannels"], [])
        self.assertEqual(len(plan["variants"]), 16)
        self.assertEqual(plan["variants"][0]["id"], "F0_semantic_reference")
        self.assertIn("F_all", [v["id"] for v in plan["variants"]])
        for channel in CHANNELS:
            self.assertIn(f"F_plus_{channel}", [v["id"] for v in plan["variants"]])
            self.assertIn(f"F_minus_{channel}", [v["id"] for v in plan["variants"]])
        self.assertIs(plan["automaticChannelSelection"], False)
        self.assertIs(plan["channelRankingProduced"], False)
        self.assertIs(plan["singleCompositeScoreProduced"], False)

    def test_missing_channel_holds_instead_of_synthesizing_it(self):
        source = source_fixture()
        source["channels"]["history"] = {"status": "unavailable"}
        plan = self.build(source)
        self.assertEqual(plan["state"], "hold_missing_channels")
        self.assertIs(plan["executionAuthorized"], False)
        self.assertEqual(plan["missingChannels"], ["history"])
        self.assertNotIn("history", plan["availableChannels"])
        self.assertEqual(len(plan["variants"]), 14)

    def test_non_proceed_t5_cannot_start_t6(self):
        with self.assertRaisesRegex(ValueError, "requires a frozen T5 Proceed"):
            self.build(decision="Hold")

    def test_target_derived_global_boundary_fails_closed(self):
        source = source_fixture()
        source["targetBoundary"]["targetSnapshotDerivedFeaturesAllowed"] = True
        with self.assertRaisesRegex(ValueError, "target-derived"):
            self.build(source)

    def test_channel_target_derived_fails_closed(self):
        source = source_fixture()
        source["channels"]["space"]["targetDerived"] = True
        with self.assertRaisesRegex(ValueError, "space channel"):
            self.build(source)

    def test_channel_must_be_pre_target(self):
        source = source_fixture()
        source["channels"]["group"]["onlyPreTargetEvents"] = False
        with self.assertRaisesRegex(ValueError, "group channel"):
            self.build(source)

    def test_available_channel_requires_evidence_refs(self):
        source = source_fixture()
        source["channels"]["critique"]["evidenceRefs"] = []
        with self.assertRaisesRegex(ValueError, "critique channel requires"):
            self.build(source)

    def test_semantic_reference_must_be_d(self):
        source = source_fixture()
        source["semanticReference"]["id"] = "E"
        with self.assertRaisesRegex(ValueError, "requires completed learned-sparse"):
            self.build(source)

    def test_t5_sha_mismatch_fails_closed(self):
        decision_raw, artifact, evidence = t5_fixture()
        evidence["decisionArtifactSha256"] = "0" * 64
        source = source_fixture()
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            build_plan(
                decision_raw,
                artifact,
                evidence,
                canonical_json_bytes(source),
                source,
            )

    def test_unknown_channel_fails_closed(self):
        source = source_fixture()
        source["channels"]["mystery"] = {
            "status": "available",
            "targetDerived": False,
            "onlyPreTargetEvents": True,
            "evidenceRefs": ["x"],
        }
        with self.assertRaisesRegex(ValueError, "unknown affinity channels"):
            self.build(source)


if __name__ == "__main__":
    unittest.main()
