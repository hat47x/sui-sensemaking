from __future__ import annotations

import hashlib
import json
import pathlib
import sys
import tempfile
import textwrap
import unittest

from freeze_cognitive_assoc_adjudication import (
    ALLOWED_LABELS,
    build_frozen_artifact,
    build_response_template,
    canonical_json_bytes,
)
from run_cognitive_assoc_baselines import (
    EMBEDDING_REQUEST_SCHEMA,
    EMBEDDING_RESPONSE_SCHEMA,
    RUN_SCHEMA,
    plan_payload,
    run_baseline,
    validate_provider_runtime_evidence,
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
                "id": "doc:pair:c01+c02",
                "documentId": "doc",
                "cardIds": ["c01", "c02"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["U"],
            }
        ],
        "twoPlusOneCandidates": [
            {
                "id": "doc:2plus1:g1:c01+c02+c03",
                "documentId": "doc",
                "cardIds": ["c01", "c02", "c03"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["L"],
            }
        ],
    }


def selected_bytes(selected: dict) -> bytes:
    return (json.dumps(selected, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


class CognitiveAssocBaselineHarnessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.selected = selected_fixture()
        self.selected_raw = selected_bytes(self.selected)

        response = build_response_template(self.selected, self.selected_raw)
        response["status"] = "complete"
        response["attestation"]["semanticModelOutputsViewedBeforeCompletion"] = False
        response["judgements"][0]["label"] = "hard_negative"
        response["judgements"][1]["label"] = "related_but_separate"
        artifact, evidence = build_frozen_artifact(
            self.selected, self.selected_raw, response
        )

        self.selected_path = self.root / "selected.json"
        self.selected_path.write_bytes(self.selected_raw)
        self.adjudicated_path = self.root / "adjudicated.json"
        self.adjudicated_path.write_bytes(canonical_json_bytes(artifact))
        self.evidence_path = self.root / "evidence.json"
        self.evidence_path.write_bytes(canonical_json_bytes(evidence))
        self.model_input_path = self.root / "model-input.jsonl"
        cards = [
            {"documentId": "doc", "cardId": "c01", "text": "制度と責任を見直す"},
            {"documentId": "doc", "cardId": "c02", "text": "責任と制度の境界を考える"},
            {"documentId": "doc", "cardId": "c03", "text": "海辺で花を眺める"},
        ]
        self.model_input_path.write_text(
            "".join(json.dumps(card, ensure_ascii=False) + "\n" for card in cards),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_plan_declares_same_interface_without_running_benchmark(self) -> None:
        plan = plan_payload()
        self.assertEqual([b["id"] for b in plan["baselines"]], ["A", "C", "E"])
        self.assertEqual(
            set(plan["fixedBenchmarkRunGate"]["acceptedAdjudicationStates"]),
            {"human_adjudication_frozen", "ai_proxy_adjudication_frozen"},
        )
        self.assertIs(
            plan["fixedBenchmarkRunGate"]["aiProxyRequiresUserAuthorization"],
            True,
        )
        self.assertIs(plan["evaluationSeparation"]["rankingProduced"], False)
        self.assertIs(plan["evaluationSeparation"]["aggregateMetricProduced"], False)

    def test_ai_proxy_gate_is_explicit_and_user_authorized(self) -> None:
        selected_sha = hashlib.sha256(self.selected_raw).hexdigest()
        artifact = {
            "schema": "sui.cognitive-assoc-adjudication/v2",
            "benchmarkId": self.selected["benchmarkId"],
            "state": "ai_proxy_adjudication_frozen",
            "adjudicationMode": "generative_ai_proxy",
            "humanAdjudicationObserved": False,
            "userAuthorizedHumanSubstitution": True,
            "semanticBaselineBlind": True,
            "strictModelBlind": False,
            "contaminationDisclosed": True,
            "sourceSelectedReviewSetSha256": selected_sha,
            "candidateCounts": {"total": 2, "pair": 1, "twoPlusOne": 1},
            "judgements": [
                {
                    "candidateId": "doc:2plus1:g1:c01+c02+c03",
                    "label": "related_but_separate",
                    "reason": "synthetic",
                },
                {
                    "candidateId": "doc:pair:c01+c02",
                    "label": "hard_negative",
                    "reason": "synthetic",
                },
            ],
        }
        artifact_raw = canonical_json_bytes(artifact)
        evidence = {
            "schema": "sui.cognitive-assoc-adjudication-freeze-evidence/v2",
            "benchmarkId": self.selected["benchmarkId"],
            "state": "ai_proxy_adjudication_frozen",
            "semanticBaselineGate": "eligible_for_explicit_open",
            "referenceAuthority": "user_authorized_ai_proxy",
            "humanAdjudicationObserved": False,
            "aiProxyAdjudicationObserved": True,
            "userAuthorizedHumanSubstitution": True,
            "semanticBaselineBlind": True,
            "contaminationDisclosed": True,
            "sourceSelectedReviewSetSha256": selected_sha,
            "adjudicatedArtifactSha256": hashlib.sha256(artifact_raw).hexdigest(),
            "candidateCounts": {"total": 2, "pair": 1, "twoPlusOne": 1},
        }
        self.adjudicated_path.write_bytes(artifact_raw)
        self.evidence_path.write_bytes(canonical_json_bytes(evidence))

        result = run_baseline(
            "A",
            self.selected_path,
            self.model_input_path,
            self.adjudicated_path,
            self.evidence_path,
            None,
            5.0,
        )
        self.assertEqual(result["candidateCount"], 2)
        self.assertEqual(
            result["referenceAdjudication"]["authority"],
            "user_authorized_ai_proxy",
        )
        self.assertIs(
            result["referenceAdjudication"]["humanAdjudicationObserved"],
            False,
        )
        self.assertIs(
            result["referenceAdjudication"]["strictModelBlind"],
            False,
        )

        artifact["userAuthorizedHumanSubstitution"] = False
        self.adjudicated_path.write_bytes(canonical_json_bytes(artifact))
        with self.assertRaisesRegex(ValueError, "not user-authorized"):
            run_baseline(
                "A",
                self.selected_path,
                self.model_input_path,
                self.adjudicated_path,
                self.evidence_path,
                None,
                5.0,
            )

    def test_a_runs_after_frozen_gate_and_preserves_candidate_order(self) -> None:
        result = run_baseline(
            "A",
            self.selected_path,
            self.model_input_path,
            self.adjudicated_path,
            self.evidence_path,
            None,
            5.0,
        )
        self.assertEqual(result["schema"], RUN_SCHEMA)
        self.assertEqual(result["baseline"]["id"], "A")
        self.assertEqual(result["candidateCount"], 2)
        self.assertEqual(
            result["referenceAdjudication"]["authority"],
            "human_model_blind",
        )
        self.assertIs(result["rankingProduced"], False)
        self.assertIs(result["aggregateMetricProduced"], False)
        self.assertEqual(
            [item["candidateId"] for item in result["results"]],
            sorted(item["candidateId"] for item in result["results"]),
        )
        self.assertGreater(result["results"][1]["score"], 0.0)

    def test_c_is_deterministic(self) -> None:
        first = run_baseline(
            "C",
            self.selected_path,
            self.model_input_path,
            self.adjudicated_path,
            self.evidence_path,
            None,
            5.0,
        )
        second = run_baseline(
            "C",
            self.selected_path,
            self.model_input_path,
            self.adjudicated_path,
            self.evidence_path,
            None,
            5.0,
        )
        self.assertEqual(first, second)
        self.assertEqual(first["baseline"]["seed"], 47)

    def write_fake_encoder(self) -> pathlib.Path:
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
                    vectors.append([
                        float(len(text)),
                        float(sum(ord(ch) for ch in text) % 97),
                        1.0,
                    ])
                json.dump({{
                    "schema": {EMBEDDING_RESPONSE_SCHEMA!r},
                    "model": "synthetic-local-encoder",
                    "vectors": vectors,
                    "runtimeEvidence": {{
                        "wallMilliseconds": 9.5,
                        "peakRssBytes": 65536,
                        "memoryScope": "provider-process-peak-rss",
                        "includesModelLoad": True,
                        "includesEncode": True,
                    }},
                }}, sys.stdout)
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )
        return path

    def test_e_uses_text_only_external_provider(self) -> None:
        encoder = self.write_fake_encoder()
        result = run_baseline(
            "E",
            self.selected_path,
            self.model_input_path,
            self.adjudicated_path,
            self.evidence_path,
            f"{sys.executable} {encoder}",
            5.0,
        )
        self.assertEqual(result["baseline"]["id"], "E")
        self.assertEqual(result["baseline"]["model"], "synthetic-local-encoder")
        self.assertEqual(
            result["baseline"]["providerRuntimeEvidence"],
            {
                "wallMilliseconds": 9.5,
                "peakRssBytes": 65536,
                "memoryScope": "provider-process-peak-rss",
                "includesModelLoad": True,
                "includesEncode": True,
            },
        )
        self.assertEqual(result["candidateCount"], 2)

    def test_provider_runtime_evidence_is_optional_and_can_report_unavailable_rss(self) -> None:
        self.assertIsNone(validate_provider_runtime_evidence(None))
        self.assertEqual(
            validate_provider_runtime_evidence(
                {
                    "wallMilliseconds": 7.25,
                    "peakRssBytes": None,
                    "memoryScope": "provider-process-peak-rss-unavailable",
                    "includesModelLoad": True,
                    "includesEncode": True,
                }
            ),
            {
                "wallMilliseconds": 7.25,
                "peakRssBytes": None,
                "memoryScope": "provider-process-peak-rss-unavailable",
                "includesModelLoad": True,
                "includesEncode": True,
            },
        )

    def test_e_requires_encoder_command(self) -> None:
        with self.assertRaisesRegex(ValueError, "requires --encoder-command"):
            run_baseline(
                "E",
                self.selected_path,
                self.model_input_path,
                self.adjudicated_path,
                self.evidence_path,
                None,
                5.0,
            )

    def test_gate_refuses_unfrozen_adjudication(self) -> None:
        value = json.loads(self.adjudicated_path.read_text(encoding="utf-8"))
        value["state"] = "draft"
        self.adjudicated_path.write_bytes(canonical_json_bytes(value))
        with self.assertRaisesRegex(ValueError, "not frozen"):
            run_baseline(
                "A",
                self.selected_path,
                self.model_input_path,
                self.adjudicated_path,
                self.evidence_path,
                None,
                5.0,
            )

    def test_gate_refuses_evidence_sha_mismatch(self) -> None:
        value = json.loads(self.evidence_path.read_text(encoding="utf-8"))
        value["adjudicatedArtifactSha256"] = "0" * 64
        self.evidence_path.write_bytes(canonical_json_bytes(value))
        with self.assertRaisesRegex(ValueError, "SHA-256 does not match"):
            run_baseline(
                "A",
                self.selected_path,
                self.model_input_path,
                self.adjudicated_path,
                self.evidence_path,
                None,
                5.0,
            )

    def test_gate_refuses_noneligible_evidence(self) -> None:
        value = json.loads(self.evidence_path.read_text(encoding="utf-8"))
        value["semanticBaselineGate"] = "closed"
        self.evidence_path.write_bytes(canonical_json_bytes(value))
        with self.assertRaisesRegex(ValueError, "not eligible"):
            run_baseline(
                "A",
                self.selected_path,
                self.model_input_path,
                self.adjudicated_path,
                self.evidence_path,
                None,
                5.0,
            )

    def test_model_input_must_remain_blind(self) -> None:
        self.model_input_path.write_text(
            json.dumps(
                {
                    "documentId": "doc",
                    "cardId": "c01",
                    "text": "x",
                    "islandId": "leak",
                }
            )
            + "\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "must contain only"):
            run_baseline(
                "A",
                self.selected_path,
                self.model_input_path,
                self.adjudicated_path,
                self.evidence_path,
                None,
                5.0,
            )

    def test_external_encoder_bad_vector_count_fails_closed(self) -> None:
        path = self.root / "bad_encoder.py"
        path.write_text(
            textwrap.dedent(
                f"""
                import json
                import sys
                json.load(sys.stdin)
                json.dump({{
                    "schema": {EMBEDDING_RESPONSE_SCHEMA!r},
                    "model": "bad",
                    "vectors": [[1.0]],
                }}, sys.stdout)
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "wrong vector count"):
            run_baseline(
                "E",
                self.selected_path,
                self.model_input_path,
                self.adjudicated_path,
                self.evidence_path,
                f"{sys.executable} {path}",
                5.0,
            )


    def test_external_encoder_bad_runtime_evidence_fails_closed(self) -> None:
        path = self.root / "bad_runtime_encoder.py"
        path.write_text(
            textwrap.dedent(
                f"""
                import json
                import sys
                request = json.load(sys.stdin)
                json.dump({{
                    "schema": {EMBEDDING_RESPONSE_SCHEMA!r},
                    "model": "bad-runtime",
                    "vectors": [[1.0, 0.0, 0.0] for _ in request["texts"]],
                    "runtimeEvidence": {{
                        "wallMilliseconds": 1.0,
                        "peakRssBytes": -1,
                        "memoryScope": "provider-process-peak-rss",
                        "includesModelLoad": True,
                        "includesEncode": True,
                    }},
                }}, sys.stdout)
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "peakRssBytes is invalid"):
            run_baseline(
                "E",
                self.selected_path,
                self.model_input_path,
                self.adjudicated_path,
                self.evidence_path,
                f"{sys.executable} {path}",
                5.0,
            )


if __name__ == "__main__":
    unittest.main()
