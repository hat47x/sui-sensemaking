#!/usr/bin/env python3
"""Pinned local sentence-encoder provider for COGNITIVE-ASSOC-01 baseline E.

This command implements the stdin/stdout transport contract consumed by
run_cognitive_assoc_baselines.py. Only card texts are accepted. Candidate IDs,
reference labels, U/L strata, islands, coordinates, and relations are outside
the request schema and therefore rejected.
"""

from __future__ import annotations

import json
import math
import sys
import time
from typing import Any, Callable


REQUEST_SCHEMA = "sui.cognitive-assoc-embedding-request/v1"
RESPONSE_SCHEMA = "sui.cognitive-assoc-embedding-response/v1"
MODEL_ID = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MODEL_REVISION = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
MODEL_REF = f"{MODEL_ID}@{MODEL_REVISION}"
EXPECTED_DIMENSION = 384


def peak_rss_bytes() -> int | None:
    """Return this provider process peak RSS in bytes when the OS exposes it."""
    try:
        import resource
    except ImportError:
        return None

    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    numeric = float(value)
    if not math.isfinite(numeric) or numeric < 0:
        return None

    # Darwin reports bytes; Linux and the target CPU job hosts report KiB.
    multiplier = 1 if sys.platform == "darwin" else 1024
    return int(numeric * multiplier)


def validate_request(value: Any) -> list[str]:
    if not isinstance(value, dict) or set(value) != {"schema", "texts"}:
        raise ValueError("request must contain only schema/texts")
    if value.get("schema") != REQUEST_SCHEMA:
        raise ValueError("embedding request schema is invalid")
    texts = value.get("texts")
    if not isinstance(texts, list) or not texts:
        raise ValueError("texts must be a non-empty list")
    if any(not isinstance(text, str) or not text.strip() for text in texts):
        raise ValueError("texts must contain non-empty strings")
    return texts


def load_model():
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise RuntimeError(
            "sentence-transformers is required for baseline E"
        ) from exc
    return SentenceTransformer(
        MODEL_ID,
        revision=MODEL_REVISION,
        device="cpu",
    )


def normalize_vectors(raw: Any, expected_count: int) -> list[list[float]]:
    if hasattr(raw, "tolist"):
        raw = raw.tolist()
    if not isinstance(raw, list) or len(raw) != expected_count:
        raise ValueError("encoder returned wrong vector count")

    vectors: list[list[float]] = []
    for raw_vector in raw:
        if hasattr(raw_vector, "tolist"):
            raw_vector = raw_vector.tolist()
        if (
            not isinstance(raw_vector, list)
            or len(raw_vector) != EXPECTED_DIMENSION
        ):
            raise ValueError(
                f"encoder vector dimension must be {EXPECTED_DIMENSION}"
            )
        vector: list[float] = []
        for value in raw_vector:
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise ValueError("encoder vector contains a non-number")
            numeric = float(value)
            if not math.isfinite(numeric):
                raise ValueError("encoder vector contains non-finite value")
            vector.append(numeric)
        vectors.append(vector)
    return vectors


def build_response(
    request: Any,
    *,
    model_factory: Callable[[], Any] = load_model,
) -> dict[str, Any]:
    texts = validate_request(request)
    started = time.perf_counter()
    model = model_factory()
    raw_vectors = model.encode(
        texts,
        convert_to_numpy=True,
        normalize_embeddings=False,
        show_progress_bar=False,
    )
    vectors = normalize_vectors(raw_vectors, len(texts))
    peak_rss = peak_rss_bytes()
    runtime_evidence = {
        "wallMilliseconds": (time.perf_counter() - started) * 1000.0,
        "peakRssBytes": peak_rss,
        "memoryScope": (
            "provider-process-peak-rss"
            if peak_rss is not None
            else "provider-process-peak-rss-unavailable"
        ),
        "includesModelLoad": True,
        "includesEncode": True,
    }
    return {
        "schema": RESPONSE_SCHEMA,
        "model": MODEL_REF,
        "vectors": vectors,
        "runtimeEvidence": runtime_evidence,
    }


def main() -> int:
    try:
        request = json.load(sys.stdin)
        response = build_response(request)
    except Exception as exc:
        print(f"baseline E provider failed: {exc}", file=sys.stderr)
        return 2
    json.dump(
        response,
        sys.stdout,
        ensure_ascii=False,
        separators=(",", ":"),
        allow_nan=False,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
