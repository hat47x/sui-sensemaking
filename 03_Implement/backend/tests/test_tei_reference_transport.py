"""Contract tests for the TEI Reference local-I/O transport (ADR-0101 Option A).

The transport is pinned as fail-closed: it never returns partial file content
and never interprets the artifact. Semantic validation stays in the frontend
consumer (`epistemic_review_model.ts` / `epistemic_projection_adapter.ts`).
"""

from __future__ import annotations

import json
from pathlib import Path

from sui_sensemaking_api.tei_reference_transport import (
    TeiReferenceArtifact,
    TeiReferenceReadFailure,
    read_tei_reference_artifact,
)


def _write_artifact(directory: Path, name: str, payload: object) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_unconfigured_directory_stays_unavailable() -> None:
    for artifacts_dir in (None, ""):
        result = read_tei_reference_artifact(artifacts_dir, "epistemic-assessment")
        assert isinstance(result, TeiReferenceReadFailure)
        assert result.reason == "unconfigured"


def test_unknown_artifact_kind_is_rejected_without_file_access(tmp_path: Path) -> None:
    _write_artifact(
        tmp_path,
        "epistemic-assessment.json",
        {"contract": "tei.epistemic-projection/v0"},
    )
    for kind in ("secret", "epistemic-detail-query", "../outside", "epistemic-context/../../x"):
        result = read_tei_reference_artifact(tmp_path, kind)
        assert isinstance(result, TeiReferenceReadFailure)
        assert result.reason == "unknown-artifact"


def test_missing_or_non_file_artifact_never_exposes_content(tmp_path: Path) -> None:
    (tmp_path / "epistemic-assessment.json").unlink(missing_ok=True)
    result = read_tei_reference_artifact(tmp_path, "epistemic-assessment")
    assert isinstance(result, TeiReferenceReadFailure)
    assert result.reason == "not-a-file"

    (tmp_path / "epistemic-context.json").mkdir()
    result = read_tei_reference_artifact(tmp_path, "epistemic-context")
    assert isinstance(result, TeiReferenceReadFailure)
    assert result.reason == "not-a-file"


def test_invalid_json_and_non_object_never_expose_content(tmp_path: Path) -> None:
    directory = tmp_path / "broken"
    directory.mkdir()
    (directory / "epistemic-assessment.json").write_bytes(b"{not json")
    result = read_tei_reference_artifact(directory, "epistemic-assessment")
    assert isinstance(result, TeiReferenceReadFailure)
    assert result.reason == "invalid-json"

    array_path = directory / "epistemic-detail.json"
    array_path.write_text("[]", encoding="utf-8")
    result = read_tei_reference_artifact(directory, "epistemic-detail")
    assert isinstance(result, TeiReferenceReadFailure)
    assert result.reason == "not-an-object"


def test_valid_artifact_is_returned_verbatim(tmp_path: Path) -> None:
    payload = {
        "contract": "tei.epistemic-projection/v0",
        "schema": "tei.reference.epistemic-assessment/v0",
        "assessments": [],
    }
    _write_artifact(tmp_path, "epistemic-assessment.json", payload)

    result = read_tei_reference_artifact(tmp_path, "epistemic-assessment")
    assert isinstance(result, TeiReferenceArtifact)
    assert result.payload == payload


def test_artifact_payload_does_not_escape_directory(tmp_path: Path) -> None:
    secret = tmp_path / "secret.json"
    secret.write_text(json.dumps({"secret": "sensitive"}), encoding="utf-8")
    nested = tmp_path / "artifacts"
    _write_artifact(nested, "epistemic-assessment.json", {"schema": "ok"})

    result = read_tei_reference_artifact(nested, "epistemic-assessment")
    assert isinstance(result, TeiReferenceArtifact)
    assert result.payload == {"schema": "ok"}
