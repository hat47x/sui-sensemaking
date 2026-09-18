#!/usr/bin/env python3
"""Offline A/C/E baseline harness for COGNITIVE-ASSOC-01.

The fixed benchmark may not be scored until model-blind human adjudication is
frozen. This module therefore separates:

- plan: describe the A/C/E interface without reading benchmark data;
- run: validate the frozen adjudication artifact/evidence first, then score.

A and C use only the Python standard library. E is a transport-neutral local
vector-provider command that receives card texts only. Human labels and
selection strata are never sent to the provider.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shlex
import subprocess
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any


RUN_SCHEMA = "sui.cognitive-assoc-baseline-run/v1"
ADJUDICATION_SCHEMA = "sui.cognitive-assoc-adjudication/v1"
ADJUDICATION_EVIDENCE_SCHEMA = (
    "sui.cognitive-assoc-adjudication-freeze-evidence/v1"
)
EMBEDDING_REQUEST_SCHEMA = "sui.cognitive-assoc-embedding-request/v1"
EMBEDDING_RESPONSE_SCHEMA = "sui.cognitive-assoc-embedding-response/v1"

BASELINES = {
    "A": {
        "id": "A",
        "name": "char-ngram-tfidf",
        "implementation": "unicode-char-ngram-tfidf-v1",
        "description": "NFKC alphanumeric char 2-4gram TF-IDF cosine",
    },
    "C": {
        "id": "C",
        "name": "flyhash-like-sparse-expansion",
        "implementation": "tfidf-sparse-expansion-wta-v1",
        "description": "A-features -> fixed-seed sparse expansion -> k-WTA",
        "dimensions": 4096,
        "fanout": 8,
        "active": 64,
        "seed": 47,
    },
    "E": {
        "id": "E",
        "name": "local-sentence-encoder",
        "implementation": "external-local-vector-provider-v1",
        "description": "stdin/stdout local vector provider; card texts only",
    },
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


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return "".join(ch.lower() for ch in normalized if ch.isalnum())


def char_ngrams(text: str, min_n: int = 2, max_n: int = 4) -> Counter[str]:
    normalized = normalize_text(text)
    features: Counter[str] = Counter()
    for n in range(min_n, max_n + 1):
        for i in range(0, max(0, len(normalized) - n + 1)):
            features[normalized[i : i + n]] += 1
    return features


def load_model_input(path: Path) -> dict[tuple[str, str], str]:
    cards: dict[tuple[str, str], str] = {}
    for line_no, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        value = json.loads(raw)
        if set(value) != {"documentId", "cardId", "text"}:
            raise ValueError(
                f"model-input line {line_no} must contain only "
                "documentId/cardId/text"
            )
        document_id = value["documentId"]
        card_id = value["cardId"]
        text = value["text"]
        if not all(isinstance(item, str) and item for item in (document_id, card_id)):
            raise ValueError(f"model-input line {line_no} has invalid ids")
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f"model-input line {line_no} has empty text")
        key = (document_id, card_id)
        if key in cards:
            raise ValueError(f"duplicate model-input card: {key}")
        cards[key] = text
    if not cards:
        raise ValueError("model-input is empty")
    return cards


def validate_selected_review_set(selected: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if selected.get("status") != "pending_human":
        raise ValueError("selected review set status must remain pending_human")
    if selected.get("semanticBaselineGate") != "closed":
        raise ValueError("selected review set must preserve the original closed gate")
    if selected.get("modelOutputsAllowed") is not False:
        raise ValueError("selected review set must preserve modelOutputsAllowed=false")

    candidates: dict[str, dict[str, Any]] = {}
    for collection, candidate_type, size in (
        ("pairCandidates", "pair", 2),
        ("twoPlusOneCandidates", "two_plus_one", 3),
    ):
        items = selected.get(collection)
        if not isinstance(items, list):
            raise ValueError(f"selected review set missing {collection}")
        for item in items:
            candidate_id = item.get("id")
            if not isinstance(candidate_id, str) or not candidate_id:
                raise ValueError(f"candidate without id in {collection}")
            if candidate_id in candidates:
                raise ValueError(f"duplicate selected candidate: {candidate_id}")
            card_ids = item.get("cardIds")
            if not isinstance(card_ids, list) or len(card_ids) != size:
                raise ValueError(f"candidate {candidate_id} must have {size} cards")
            document_id = item.get("documentId")
            if not isinstance(document_id, str) or not document_id:
                raise ValueError(f"candidate {candidate_id} missing documentId")
            candidates[candidate_id] = {
                "candidateId": candidate_id,
                "candidateType": candidate_type,
                "documentId": document_id,
                "cardIds": list(card_ids),
            }
    if not candidates:
        raise ValueError("selected review set has no candidates")
    return candidates


def validate_frozen_gate(
    selected_raw: bytes,
    selected: dict[str, Any],
    adjudicated_raw: bytes,
    adjudicated: dict[str, Any],
    evidence: dict[str, Any],
) -> dict[str, str]:
    candidates = validate_selected_review_set(selected)

    if adjudicated.get("schema") != ADJUDICATION_SCHEMA:
        raise ValueError("adjudicated artifact schema is invalid")
    if adjudicated.get("state") != "human_adjudication_frozen":
        raise ValueError("human adjudication is not frozen")
    if adjudicated.get("modelBlind") is not True:
        raise ValueError("adjudicated artifact must be modelBlind")
    selected_sha = sha256_bytes(selected_raw)
    if adjudicated.get("sourceSelectedReviewSetSha256") != selected_sha:
        raise ValueError("adjudicated artifact selected-review-set SHA mismatch")

    if evidence.get("schema") != ADJUDICATION_EVIDENCE_SCHEMA:
        raise ValueError("adjudication evidence schema is invalid")
    if evidence.get("state") != "human_adjudication_frozen":
        raise ValueError("adjudication evidence is not frozen")
    if evidence.get("semanticBaselineGate") != "eligible_for_explicit_open":
        raise ValueError("semantic baseline gate is not eligible for explicit open")
    if evidence.get("modelBlind") is not True:
        raise ValueError("adjudication evidence must be modelBlind")
    if evidence.get("sourceSelectedReviewSetSha256") != selected_sha:
        raise ValueError("adjudication evidence selected-review-set SHA mismatch")
    if evidence.get("adjudicatedArtifactSha256") != sha256_bytes(adjudicated_raw):
        raise ValueError("adjudicated artifact SHA-256 does not match evidence")

    if adjudicated.get("benchmarkId") != selected.get("benchmarkId"):
        raise ValueError("adjudicated benchmarkId mismatch")
    if evidence.get("benchmarkId") != selected.get("benchmarkId"):
        raise ValueError("adjudication evidence benchmarkId mismatch")

    labels: dict[str, str] = {}
    judgements = adjudicated.get("judgements")
    if not isinstance(judgements, list):
        raise ValueError("adjudicated artifact judgements must be a list")
    for item in judgements:
        candidate_id = item.get("candidateId")
        label = item.get("label")
        if candidate_id in labels:
            raise ValueError(f"duplicate adjudicated candidate: {candidate_id}")
        if candidate_id not in candidates:
            raise ValueError(f"unknown adjudicated candidate: {candidate_id}")
        if not isinstance(label, str) or not label:
            raise ValueError(f"candidate {candidate_id} has invalid human label")
        labels[candidate_id] = label
    if set(labels) != set(candidates):
        raise ValueError("adjudicated candidate set does not match selected review set")
    return labels


def tfidf_vectors(
    cards: dict[tuple[str, str], str]
) -> dict[tuple[str, str], dict[str, float]]:
    raw = {key: char_ngrams(text) for key, text in cards.items()}
    df: Counter[str] = Counter()
    for features in raw.values():
        for feature in features:
            df[feature] += 1
    n_docs = len(raw)
    vectors: dict[tuple[str, str], dict[str, float]] = {}
    for key, counts in raw.items():
        vector: dict[str, float] = {}
        for feature, count in counts.items():
            tf = 1.0 + math.log(float(count))
            idf = math.log((1.0 + n_docs) / (1.0 + df[feature])) + 1.0
            vector[feature] = tf * idf
        vectors[key] = vector
    return vectors


def flyhash_like_vector(
    features: dict[str, float],
    *,
    dimensions: int,
    fanout: int,
    active: int,
    seed: int,
) -> dict[int, float]:
    scores: dict[int, float] = {}
    for feature, weight in features.items():
        for i in range(fanout):
            payload = f"{seed}|{feature}|{i}".encode("utf-8")
            digest = hashlib.sha256(payload).digest()
            dimension = int.from_bytes(digest[:8], "big") % dimensions
            scores[dimension] = scores.get(dimension, 0.0) + weight
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    winners = sorted(dimension for dimension, _ in ranked[:active])
    return {dimension: 1.0 for dimension in winners}


def sparse_cosine(a: dict[Any, float], b: dict[Any, float]) -> float:
    if not a or not b:
        return 0.0
    if len(a) > len(b):
        a, b = b, a
    dot = sum(value * b.get(key, 0.0) for key, value in a.items())
    norm_a = math.sqrt(sum(value * value for value in a.values()))
    norm_b = math.sqrt(sum(value * value for value in b.values()))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def dense_cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        raise ValueError("dense vectors must have the same non-zero dimension")
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def sparse_centroid(
    vectors: list[dict[Any, float]]
) -> dict[Any, float]:
    out: dict[Any, float] = {}
    if not vectors:
        return out
    scale = 1.0 / len(vectors)
    for vector in vectors:
        for key, value in vector.items():
            out[key] = out.get(key, 0.0) + value * scale
    return out


def dense_centroid(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []
    dimension = len(vectors[0])
    if dimension == 0 or any(len(vector) != dimension for vector in vectors):
        raise ValueError("dense vectors must share a non-zero dimension")
    scale = 1.0 / len(vectors)
    return [
        sum(vector[index] for vector in vectors) * scale
        for index in range(dimension)
    ]


def run_external_encoder(
    command: str,
    ordered_cards: list[tuple[tuple[str, str], str]],
    timeout_seconds: float,
) -> tuple[dict[tuple[str, str], list[float]], str]:
    argv = shlex.split(command)
    if not argv:
        raise ValueError("encoder command is empty")
    request = {
        "schema": EMBEDDING_REQUEST_SCHEMA,
        "texts": [text for _, text in ordered_cards],
    }
    completed = subprocess.run(
        argv,
        input=canonical_json_bytes(request),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_seconds,
        check=False,
    )
    if completed.returncode != 0:
        diagnostic = completed.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(
            f"local encoder failed with exit {completed.returncode}: {diagnostic}"
        )
    try:
        response = json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"local encoder returned invalid JSON: {exc}") from exc
    if response.get("schema") != EMBEDDING_RESPONSE_SCHEMA:
        raise ValueError("local encoder response schema is invalid")
    model = response.get("model")
    if not isinstance(model, str) or not model:
        raise ValueError("local encoder response must identify model")
    vectors = response.get("vectors")
    if not isinstance(vectors, list) or len(vectors) != len(ordered_cards):
        raise ValueError("local encoder returned wrong vector count")
    normalized: dict[tuple[str, str], list[float]] = {}
    dimension: int | None = None
    for (key, _), raw_vector in zip(ordered_cards, vectors):
        if not isinstance(raw_vector, list) or not raw_vector:
            raise ValueError("local encoder returned an empty/non-list vector")
        vector: list[float] = []
        for value in raw_vector:
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ValueError("local encoder vector contains a non-number")
            numeric = float(value)
            if not math.isfinite(numeric):
                raise ValueError("local encoder vector contains non-finite value")
            vector.append(numeric)
        if dimension is None:
            dimension = len(vector)
        elif len(vector) != dimension:
            raise ValueError("local encoder vectors have inconsistent dimensions")
        normalized[key] = vector
    return normalized, model


def build_representations(
    baseline: str,
    cards: dict[tuple[str, str], str],
    encoder_command: str | None,
    encoder_timeout: float,
) -> tuple[dict[tuple[str, str], Any], dict[str, Any]]:
    tfidf = tfidf_vectors(cards)
    if baseline == "A":
        return tfidf, dict(BASELINES["A"])
    if baseline == "C":
        config = BASELINES["C"]
        vectors = {
            key: flyhash_like_vector(
                features,
                dimensions=int(config["dimensions"]),
                fanout=int(config["fanout"]),
                active=int(config["active"]),
                seed=int(config["seed"]),
            )
            for key, features in tfidf.items()
        }
        return vectors, dict(config)
    if baseline == "E":
        if not encoder_command:
            raise ValueError("baseline E requires --encoder-command")
        ordered = sorted(cards.items(), key=lambda item: item[0])
        vectors, model = run_external_encoder(
            encoder_command, ordered, encoder_timeout
        )
        metadata = dict(BASELINES["E"])
        metadata["model"] = model
        return vectors, metadata
    raise ValueError(f"unsupported baseline: {baseline}")


def score_candidates(
    baseline: str,
    candidates: dict[str, dict[str, Any]],
    labels: dict[str, str],
    cards: dict[tuple[str, str], str],
    representations: dict[tuple[str, str], Any],
) -> list[dict[str, Any]]:
    dense = baseline == "E"
    results: list[dict[str, Any]] = []
    for candidate_id in sorted(candidates):
        candidate = candidates[candidate_id]
        keys = [
            (candidate["documentId"], card_id)
            for card_id in candidate["cardIds"]
        ]
        missing = [key for key in keys if key not in cards]
        if missing:
            raise ValueError(
                f"candidate {candidate_id} references missing model-input cards: {missing}"
            )
        vectors = [representations[key] for key in keys]
        if candidate["candidateType"] == "pair":
            score = (
                dense_cosine(vectors[0], vectors[1])
                if dense
                else sparse_cosine(vectors[0], vectors[1])
            )
            metric = "cosine_pair"
        else:
            pair_bundle = (
                dense_centroid(vectors[:2])
                if dense
                else sparse_centroid(vectors[:2])
            )
            score = (
                dense_cosine(pair_bundle, vectors[2])
                if dense
                else sparse_cosine(pair_bundle, vectors[2])
            )
            metric = "cosine_outsider_to_pair_centroid"
        results.append(
            {
                "candidateId": candidate_id,
                "candidateType": candidate["candidateType"],
                "metric": metric,
                "score": score,
                "referenceLabel": labels[candidate_id],
            }
        )
    return results


def run_baseline(
    baseline: str,
    selected_path: Path,
    model_input_path: Path,
    adjudicated_path: Path,
    evidence_path: Path,
    encoder_command: str | None,
    encoder_timeout: float,
) -> dict[str, Any]:
    selected_raw = selected_path.read_bytes()
    selected = json.loads(selected_raw.decode("utf-8"))
    adjudicated_raw = adjudicated_path.read_bytes()
    adjudicated = json.loads(adjudicated_raw.decode("utf-8"))
    evidence = load_json(evidence_path)

    labels = validate_frozen_gate(
        selected_raw,
        selected,
        adjudicated_raw,
        adjudicated,
        evidence,
    )
    candidates = validate_selected_review_set(selected)
    cards = load_model_input(model_input_path)

    representations, baseline_metadata = build_representations(
        baseline,
        cards,
        encoder_command,
        encoder_timeout,
    )
    results = score_candidates(
        baseline,
        candidates,
        labels,
        cards,
        representations,
    )

    return {
        "schema": RUN_SCHEMA,
        "benchmarkId": selected.get("benchmarkId"),
        "baseline": baseline_metadata,
        "sourceSelectedReviewSetSha256": sha256_bytes(selected_raw),
        "sourceAdjudicatedArtifactSha256": sha256_bytes(adjudicated_raw),
        "candidateCount": len(results),
        "rankingProduced": False,
        "aggregateMetricProduced": False,
        "results": results,
    }


def plan_payload() -> dict[str, Any]:
    return {
        "schema": "sui.cognitive-assoc-baseline-plan/v1",
        "baselines": [BASELINES[key] for key in ("A", "C", "E")],
        "fixedBenchmarkRunGate": {
            "requiredAdjudicationState": "human_adjudication_frozen",
            "requiredEvidenceGate": "eligible_for_explicit_open",
            "artifactSha256MustMatchEvidence": True,
            "selectedReviewSetSha256MustMatch": True,
        },
        "evaluationSeparation": {
            "pairMetric": "cosine_pair",
            "twoPlusOneMetric": "cosine_outsider_to_pair_centroid",
            "rankingProduced": False,
            "aggregateMetricProduced": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Plan or run gated COGNITIVE-ASSOC-01 A/C/E baselines."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan_parser = subparsers.add_parser(
        "plan", help="Print baseline interface/configuration without benchmark access."
    )
    plan_parser.add_argument("--output", type=Path)

    run_parser = subparsers.add_parser(
        "run", help="Run one baseline after frozen human adjudication is validated."
    )
    run_parser.add_argument("--baseline", choices=("A", "C", "E"), required=True)
    run_parser.add_argument("--selected-review-set", type=Path, required=True)
    run_parser.add_argument("--model-input", type=Path, required=True)
    run_parser.add_argument("--adjudicated", type=Path, required=True)
    run_parser.add_argument("--adjudication-evidence", type=Path, required=True)
    run_parser.add_argument("--output", type=Path, required=True)
    run_parser.add_argument("--encoder-command")
    run_parser.add_argument("--encoder-timeout", type=float, default=30.0)

    args = parser.parse_args()

    try:
        if args.command == "plan":
            payload = plan_payload()
            encoded = canonical_json_bytes(payload)
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_bytes(encoded)
                print(f"WROTE_PLAN: {args.output}")
            else:
                print(encoded.decode("utf-8"), end="")
            print("FIXED_BENCHMARK_SEMANTIC_RUN: NOT_EXECUTED")
            return 0

        result = run_baseline(
            args.baseline,
            args.selected_review_set,
            args.model_input,
            args.adjudicated,
            args.adjudication_evidence,
            args.encoder_command,
            args.encoder_timeout,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(canonical_json_bytes(result))
        print(f"WROTE_BASELINE_RUN: {args.output}")
        print(f"BASELINE: {args.baseline}")
        print(f"CANDIDATE_COUNT: {result['candidateCount']}")
        print("RANKING_PRODUCED: false")
        print("AGGREGATE_METRIC_PRODUCED: false")
        return 0
    except (
        OSError,
        UnicodeDecodeError,
        ValueError,
        json.JSONDecodeError,
        subprocess.TimeoutExpired,
    ) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
