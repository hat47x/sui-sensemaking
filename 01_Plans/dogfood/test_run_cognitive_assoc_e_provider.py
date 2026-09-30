from __future__ import annotations

import json
import math
import sys
import types
import unittest
from pathlib import Path
from unittest import mock

from run_cognitive_assoc_e_provider import (
    EXPECTED_DIMENSION,
    EXPECTED_PACKAGE_VERSIONS,
    EXPECTED_PYTHON_MAJOR_MINOR,
    MODEL_ID,
    MODEL_REF,
    MODEL_REVISION,
    REQUEST_SCHEMA,
    RESPONSE_SCHEMA,
    build_response,
    load_model,
    normalize_vectors,
    validate_request,
    validate_runtime_versions,
)


class FakeModel:
    def __init__(self) -> None:
        self.calls = []

    def encode(self, texts, **kwargs):
        self.calls.append((list(texts), dict(kwargs)))
        return [
            [float(index + 1)] * EXPECTED_DIMENSION
            for index, _text in enumerate(texts)
        ]


class CognitiveAssocEProviderTests(unittest.TestCase):
    def test_model_revision_is_pinned(self) -> None:
        self.assertEqual(
            MODEL_ID,
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        )
        self.assertEqual(
            MODEL_REVISION,
            "e8f8c211226b894fcb81acc59f3b34ba3efd5f42",
        )
        self.assertEqual(MODEL_REF, f"{MODEL_ID}@{MODEL_REVISION}")

    def test_runtime_versions_are_pinned_and_match_config(self) -> None:
        observed = validate_runtime_versions(
            version_getter=EXPECTED_PACKAGE_VERSIONS.__getitem__,
            python_version=EXPECTED_PYTHON_MAJOR_MINOR,
        )
        self.assertEqual(observed["pythonMajorMinor"], "3.12")
        self.assertEqual(observed["packages"], EXPECTED_PACKAGE_VERSIONS)

        config = json.loads(
            (
                Path(__file__).with_name(
                    "cognitive-assoc-baseline-E-provider-v0.json"
                )
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(config["runtimeFreeze"]["pythonMajorMinor"], "3.12")
        self.assertEqual(
            config["runtimeFreeze"]["packages"],
            EXPECTED_PACKAGE_VERSIONS,
        )

    def test_runtime_version_drift_fails_closed(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "requires Python 3.12"):
            validate_runtime_versions(
                version_getter=EXPECTED_PACKAGE_VERSIONS.__getitem__,
                python_version=(3, 13),
            )

        versions = dict(EXPECTED_PACKAGE_VERSIONS)
        versions["transformers"] = "0.0.0"
        with self.assertRaisesRegex(
            RuntimeError,
            "requires transformers==5.17.0",
        ):
            validate_runtime_versions(
                version_getter=versions.__getitem__,
                python_version=EXPECTED_PYTHON_MAJOR_MINOR,
            )

    def test_load_model_pins_revision_and_cpu(self) -> None:
        calls = []

        class FakeSentenceTransformer:
            def __init__(self, model_id, **kwargs):
                calls.append((model_id, dict(kwargs)))

        module = types.SimpleNamespace(
            SentenceTransformer=FakeSentenceTransformer
        )
        with mock.patch(
            "run_cognitive_assoc_e_provider.validate_runtime_versions"
        ) as runtime_check, mock.patch.dict(
            sys.modules, {"sentence_transformers": module}
        ):
            model = load_model()

        runtime_check.assert_called_once_with()
        self.assertIsInstance(model, FakeSentenceTransformer)
        self.assertEqual(
            calls,
            [
                (
                    MODEL_ID,
                    {"revision": MODEL_REVISION, "device": "cpu"},
                )
            ],
        )

    def test_request_accepts_only_schema_and_texts(self) -> None:
        texts = validate_request(
            {"schema": REQUEST_SCHEMA, "texts": ["一枚目", "二枚目"]}
        )
        self.assertEqual(texts, ["一枚目", "二枚目"])

        with self.assertRaisesRegex(ValueError, "only schema/texts"):
            validate_request(
                {
                    "schema": REQUEST_SCHEMA,
                    "texts": ["card"],
                    "candidateId": "forbidden",
                }
            )

    def test_build_response_uses_cpu_contract_without_normalization(self) -> None:
        model = FakeModel()
        with mock.patch(
            "run_cognitive_assoc_e_provider.peak_rss_bytes",
            return_value=123456,
        ), mock.patch(
            "run_cognitive_assoc_e_provider.time.perf_counter",
            side_effect=[10.0, 10.025],
        ):
            response = build_response(
                {"schema": REQUEST_SCHEMA, "texts": ["a", "b"]},
                model_factory=lambda: model,
            )

        self.assertEqual(response["schema"], RESPONSE_SCHEMA)
        self.assertEqual(response["model"], MODEL_REF)
        self.assertEqual(len(response["vectors"]), 2)
        self.assertEqual(len(response["vectors"][0]), EXPECTED_DIMENSION)
        runtime = response["runtimeEvidence"]
        self.assertAlmostEqual(runtime["wallMilliseconds"], 25.0)
        self.assertEqual(runtime["peakRssBytes"], 123456)
        self.assertEqual(runtime["memoryScope"], "provider-process-peak-rss")
        self.assertIs(runtime["includesModelLoad"], True)
        self.assertIs(runtime["includesEncode"], True)

        texts, kwargs = model.calls[0]
        self.assertEqual(texts, ["a", "b"])
        self.assertIs(kwargs["convert_to_numpy"], True)
        self.assertIs(kwargs["normalize_embeddings"], False)
        self.assertIs(kwargs["show_progress_bar"], False)

    def test_wrong_dimension_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "dimension must be"):
            normalize_vectors([[0.0] * (EXPECTED_DIMENSION - 1)], 1)

    def test_non_finite_value_fails_closed(self) -> None:
        vector = [0.0] * EXPECTED_DIMENSION
        vector[-1] = math.inf
        with self.assertRaisesRegex(ValueError, "non-finite"):
            normalize_vectors([vector], 1)

    def test_wrong_vector_count_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "wrong vector count"):
            normalize_vectors([], 1)


if __name__ == "__main__":
    unittest.main()
