from __future__ import annotations

import json
import pathlib
import sys
import tempfile
import textwrap
import unittest

from evaluate_cognitive_assoc_baselines import (
    PROBE_SCHEMA,
    SUMMARY_SCHEMA,
    build_probe_artifact,
    build_summary,
)
from freeze_cognitive_assoc_adjudication import (
    ALLOWED_LABELS,
    build_frozen_artifact,
    build_response_template,
    canonical_json_bytes,
)
from run_cognitive_assoc_baselines import (
    EMBEDDING_REQUEST_SCHEMA,
    EMBEDDING_RESPONSE_SCHEMA,
)


def selected_fixture() -> dict:
    allowed = list(ALLOWED_LABELS)
    return {
        "benchmarkId": "synthetic-cognitive-assoc-v0",
        "status": "pending_human",
        "semanticBaselineGate": "closed",
        "modelOutputsAllowed": False,
        "pairCandidates": [
            {
                "id": "doc:pair:c01+c04",
                "documentId": "doc",
                "cardIds": ["c01", "c04"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["U"],
            },
            {
                "id": "doc:pair:c02+c04",
                "documentId": "doc",
                "cardIds": ["c02", "c04"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["L"],
            },
        ],
        "twoPlusOneCandidates": [
            {
                "id": "doc:2plus1:g1:c01+c02+c04",
                "documentId": "doc",
                "cardIds": ["c01", "c02", "c04"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["U", "L"],
            }
        ],
    }


def manifest_fixture() -> dict:
    return {
        "id": "synthetic-cognitive-assoc-v0",
        "status": "pre_adjudication_frozen",
        "sources": [
            {
                "documentId": "doc",
                "observedPositiveSets": [
                    {"sourceIslandId": "i1", "cardIds": ["c01", "c02", "c03"]}
                ],
                "observedSingletonIslands": [
                    {"sourceIslandId": "i2", "cardId": "c04"}
                ],
                "challengePositiveSets": [["c01", "c02", "c03"]],
            }
        ],
    }


class CognitiveAssocEvaluationHarnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

        selected = selected_fixture()
        self.selected_path = self.root / "selected.json"
        selected_raw = (json.dumps(selected, ensure_ascii=False, indent=2) + "\n").encode(
            "utf-8"
        )
        self.selected_path.write_bytes(selected_raw)

        response = build_response_template(selected, selected_raw)
        response["status"] = "complete"
        response["attestation"]["semanticModelOutputsViewedBeforeCompletion"] = False
        labels = ["hard_negative", "related_but_separate", "hard_negative"]
        for judgement, label in zip(response["judgements"], labels):
            judgement["label"] = label
        artifact, evidence = build_frozen_artifact(selected, selected_raw, response)

        self.adjudicated_path = self.root / "adjudicated.json"
        self.adjudicated_path.write_bytes(canonical_json_bytes(artifact))
        self.evidence_path = self.root / "evidence.json"
        self.evidence_path.write_bytes(canonical_json_bytes(evidence))

        self.manifest_path = self.root / "manifest.json"
        self.manifest_path.write_text(
            json.dumps(manifest_fixture(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        self.model_input_path = self.root / "model-input.jsonl"
        cards = [
            {"documentId": "doc", "cardId": "c01", "text": "制度と責任の境界"},
            {"documentId": "doc", "cardId": "c02", "text": "責任と制度を見直す"},
            {"documentId": "doc", "cardId": "c03", "text": "制度の責任主体を問う"},
            {"documentId": "doc", "cardId": "c04", "text": "海辺の花と風景"},
        ]
        self.model_input_path.write_text(
            "".join(json.dumps(card, ensure_ascii=False) + "\n" for card in cards),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def fake_encoder(self) -> pathlib.Path:
        path = self.root / "fake_encoder.py"
        path.write_text(
            textwrap.dedent(
                f"""
                import json
                import sys

                request = json.load(sys.stdin)
                assert request["schema"] == {EMBEDDING_REQUEST_SCHEMA!r}
                assert set(request) == {{"schema", "texts"}}
                vectors = []
                for text in request["texts"]:
                    if "海辺" in text:
                        vectors.append([0.0, 1.0, 0.0])
                    else:
                        vectors.append([1.0, 0.0, float(len(text) % 3) / 10.0])
                json.dump({{
                    "schema": {EMBEDDING_RESPONSE_SCHEMA!r},
                    "model": "synthetic-semantic",
                    "vectors": vectors,
                }}, sys.stdout)
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )
        return path

    def build_probe(self, baseline: str):
        command = None
        if baseline == "E":
            command = f"{sys.executable} {self.fake_encoder()}"
        return build_probe_artifact(
            baseline=baseline,
            manifest_path=self.manifest_path,
            selected_path=self.selected_path,
            model_input_path=self.model_input_path,
            adjudicated_path=self.adjudicated_path,
            evidence_path=self.evidence_path,
            encoder_command=command,
            encoder_timeout=5.0,
        )

    def test_a_probe_covers_contrast_challenge_and_singleton(self) -> None:
        probe = self.build_probe("A")
        self.assertEqual(probe["schema"], PROBE_SCHEMA)
        self.assertEqual(probe["baseline"]["id"], "A")
        self.assertEqual(len(probe["contrast"]), 3)
        self.assertEqual(len(probe["challengePositive"]), 1)
        self.assertEqual(len(probe["singleton"]), 1)
        self.assertIs(probe["evaluationOnly"], True)
        self.assertIs(probe["productRankingProduced"], False)
        self.assertIs(probe["singleCompositeScoreProduced"], False)

        challenge = probe["challengePositive"][0]
        self.assertEqual(challenge["setCoherence"]["memberCount"], 3)
        self.assertEqual(len(challenge["retrieval"]), 3)
        for anchor in challenge["retrieval"]:
            self.assertEqual(set(anchor["recallAt"]), {"1", "3", "5"})
            self.assertTrue(anchor["targetRanks"])

    def test_c_probe_is_deterministic_except_runtime_evidence(self) -> None:
        first = self.build_probe("C")
        second = self.build_probe("C")
        first.pop("runtimeEvidence")
        second.pop("runtimeEvidence")
        self.assertEqual(first, second)

    def test_e_probe_uses_local_text_encoder(self) -> None:
        probe = self.build_probe("E")
        self.assertEqual(probe["baseline"]["model"], "synthetic-semantic")
        self.assertGreater(
            probe["challengePositive"][0]["setCoherence"]["mean"],
            probe["singleton"][0]["maximumSimilarity"],
        )

    def test_summary_does_not_choose_winner_or_composite_score(self) -> None:
        summary = build_summary([self.build_probe("A"), self.build_probe("C")])
        self.assertEqual(summary["schema"], SUMMARY_SCHEMA)
        self.assertIs(summary["comparisonPolicy"]["singleCompositeScore"], False)
        self.assertIs(summary["comparisonPolicy"]["winnerSelected"], False)
        self.assertIs(summary["comparisonPolicy"]["baselineRankingProduced"], False)
        self.assertTrue(summary["comparisonPolicy"]["UAndLReportedSeparately"])
        self.assertEqual(
            [item["baselineId"] for item in summary["baselines"]], ["A", "C"]
        )
        for baseline in summary["baselines"]:
            self.assertEqual(
                baseline["R5_wordingStability"]["status"], "not_measured_in_v0"
            )
            strata = {
                (
                    item["candidateType"],
                    item["selectionStratum"],
                    item["referenceLabel"],
                )
                for item in baseline["R2_surfaceDecoyContrast"]
            }
            self.assertIn(("pair", "U", "hard_negative"), strata)
            self.assertIn(("pair", "L", "related_but_separate"), strata)

    def test_summary_refuses_mismatched_source_digests(self) -> None:
        left = self.build_probe("A")
        right = self.build_probe("C")
        right["source"]["modelInputSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "source digests do not match"):
            build_summary([left, right])

    def test_manifest_challenge_must_be_observed_positive_subset(self) -> None:
        manifest = manifest_fixture()
        manifest["sources"][0]["challengePositiveSets"] = [["c01", "c04"]]
        self.manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False), encoding="utf-8"
        )
        with self.assertRaisesRegex(ValueError, "not contained"):
            self.build_probe("A")

    def test_probe_refuses_unfrozen_human_gate(self) -> None:
        evidence = json.loads(self.evidence_path.read_text(encoding="utf-8"))
        evidence["semanticBaselineGate"] = "closed"
        self.evidence_path.write_bytes(canonical_json_bytes(evidence))
        with self.assertRaisesRegex(ValueError, "not eligible"):
            self.build_probe("A")

    def test_runtime_scope_does_not_claim_provider_memory(self) -> None:
        probe = self.build_probe("E")
        runtime = probe["runtimeEvidence"]
        self.assertEqual(runtime["memoryScope"], "python-harness-process-only")
        self.assertIs(runtime["externalProviderMemoryIncluded"], False)
        self.assertGreaterEqual(runtime["wallMilliseconds"], 0.0)
        self.assertGreater(runtime["pythonHarnessPeakBytes"], 0)


if __name__ == "__main__":
    unittest.main()
