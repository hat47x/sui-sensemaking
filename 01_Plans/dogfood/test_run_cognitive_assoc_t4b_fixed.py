from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import run_cognitive_assoc_t4b_fixed as mod


class FixedT4bRunnerTests(unittest.TestCase):
    def test_e_probe_command_pins_only_fixed_provider(self) -> None:
        root = Path("/repo")
        model_input = Path("/tmp/model-input.jsonl")

        a = mod.build_probe_command(
            root,
            baseline="A",
            model_input=model_input,
            output=Path("/tmp/a.json"),
            encoder_timeout=123.0,
        )
        e = mod.build_probe_command(
            root,
            baseline="E",
            model_input=model_input,
            output=Path("/tmp/e.json"),
            encoder_timeout=123.0,
        )

        self.assertNotIn("--encoder-command", a)
        self.assertIn("--encoder-command", e)
        at = e.index("--encoder-command")
        self.assertIn("run_cognitive_assoc_e_provider.py", e[at + 1])
        self.assertEqual(e[e.index("--encoder-timeout") + 1], "123.0")

    def test_clean_checkout_rejects_source_sha_drift(self) -> None:
        with mock.patch.object(
            mod,
            "git_output",
            side_effect=["actual-sha"],
        ):
            with self.assertRaisesRegex(mod.FixedT4bError, "source Git SHA drift"):
                mod.require_clean_checkout(Path("/repo"), "expected-sha")

    def test_clean_checkout_rejects_tracked_changes(self) -> None:
        with mock.patch.object(
            mod,
            "git_output",
            side_effect=["same-sha", " M tracked.py"],
        ):
            with self.assertRaisesRegex(mod.FixedT4bError, "tracked working tree"):
                mod.require_clean_checkout(Path("/repo"), "same-sha")

    def test_verify_model_input_matches_generation_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            evidence_path = root / mod.GENERATION_EVIDENCE_REL
            evidence_path.parent.mkdir(parents=True)
            model_input = root / "model-input.jsonl"
            model_input.write_text('{"documentId":"d","cardId":"c","text":"x"}\n')
            digest = mod.sha256_file(model_input)
            evidence_path.write_text(
                json.dumps({"sha256": {"ephemeralModelInput": digest}})
            )
            self.assertEqual(
                mod.verify_model_input(root, model_input),
                digest,
            )

    def test_verify_model_input_fails_closed_on_drift(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            evidence_path = root / mod.GENERATION_EVIDENCE_REL
            evidence_path.parent.mkdir(parents=True)
            model_input = root / "model-input.jsonl"
            model_input.write_text("actual")
            evidence_path.write_text(
                json.dumps({"sha256": {"ephemeralModelInput": "0" * 64}})
            )
            with self.assertRaisesRegex(mod.FixedT4bError, "model-input SHA-256 drift"):
                mod.verify_model_input(root, model_input)

    def test_preflight_does_not_claim_model_execution(self) -> None:
        with mock.patch.object(
            mod,
            "require_clean_checkout",
            return_value="abc",
        ), mock.patch.object(
            mod,
            "load_json",
            return_value={
                "id": mod.BENCHMARK_ID,
                "status": "pre_adjudication_frozen",
                "sources": [{"blobSha": "1" * 40}],
            },
        ), mock.patch.object(
            mod,
            "require_frozen_blobs",
        ), mock.patch.object(
            mod,
            "require_python_runtime",
            return_value={"python": "3.x"},
        ):
            result = mod.preflight(Path("/repo"), expected_source_git_sha=None)

        self.assertEqual(result["status"], "ready")
        self.assertFalse(result["claims"]["modelLoaded"])
        self.assertFalse(result["claims"]["inferenceExecuted"])
        self.assertFalse(result["claims"]["productionAdoptionAuthorized"])


if __name__ == "__main__":
    unittest.main()
