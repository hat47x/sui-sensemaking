"""ADR-0101 Option A: control-plane exposure of local TEI Reference artifacts.

The endpoints stay fail-closed by default (`SUI_TEI_REFERENCE_DIR` unset), are
authorized only by the control plane (ADR-0072), and never answer a failure
with artifact content.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sui_sensemaking_api import control_plane_auth
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import Base
from sui_sensemaking_api.settings import settings

_BASE = "/admin/tei-epistemic/artifacts"
_ADMIN_KEY = "tei-epistemic-admin-key"
_ASSESSMENT_FIXTURE = {
    "contract": "tei.epistemic-projection/v0",
    "schema": "tei.reference.epistemic-assessment/v0",
    "assessments": [],
}


@contextmanager
def _client(tmp_path: Path) -> Iterator[TestClient]:
    engine = create_engine(f"sqlite:///{tmp_path / 'tei_epistemic.sqlite3'}")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    def _get_test_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[control_plane_auth.get_db] = _get_test_db
    try:
        with TestClient(app) as client:
            client.app.state.admin_audit_session_factory = session_local
            yield client
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _artifacts_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "tei-reference"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _write_artifact(directory: Path, name: str, payload: object) -> None:
    (directory / name).write_text(json.dumps(payload), encoding="utf-8")


def _headers() -> dict[str, str]:
    return {"X-Admin-Api-Key": _ADMIN_KEY}


@pytest.fixture(autouse=True)
def _admin_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "admin_api_key", _ADMIN_KEY)


def test_unconfigured_directory_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "tei_reference_dir", None)
    with _client(tmp_path) as client:
        response = client.get(f"{_BASE}/epistemic-assessment", headers=_headers())
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unconfigured"
    assert "assessments" not in response.text
    assert "tei.reference" not in response.text


def test_valid_artifact_is_returned_verbatim(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "tei_reference_dir", str(_artifacts_dir(tmp_path)))
    _write_artifact(tmp_path / "tei-reference", "epistemic-assessment.json", _ASSESSMENT_FIXTURE)
    with _client(tmp_path) as client:
        response = client.get(f"{_BASE}/epistemic-assessment", headers=_headers())
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.json() == {"ok": True, "artifact": _ASSESSMENT_FIXTURE}


def test_unknown_artifact_kind_returns_404_without_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "tei_reference_dir", str(_artifacts_dir(tmp_path)))
    _write_artifact(tmp_path / "tei-reference", "epistemic-assessment.json", _ASSESSMENT_FIXTURE)
    with _client(tmp_path) as client:
        response = client.get(f"{_BASE}/epistemic-detail-query", headers=_headers())
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_tei_artifact"
    assert "epistemic-assessment/v0" not in response.text
    assert "assessments" not in response.text


def test_unreadable_artifacts_fail_closed_without_content(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    directory = _artifacts_dir(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(directory))
    (directory / "epistemic-context.json").write_bytes(b"{not json")
    (directory / "epistemic-detail.json").write_text("[]", encoding="utf-8")
    with _client(tmp_path) as client:
        for kind in ("epistemic-context", "epistemic-detail", "epistemic-assessment"):
            response = client.get(f"{_BASE}/{kind}", headers=_headers())
            assert response.status_code == 503, kind
            assert response.json()["detail"]["code"] == "tei_reference_unavailable"
            assert "assessments" not in response.text
            assert "tei.reference" not in response.text


def test_control_plane_credential_is_required(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "tei_reference_dir", str(_artifacts_dir(tmp_path)))
    _write_artifact(tmp_path / "tei-reference", "epistemic-assessment.json", _ASSESSMENT_FIXTURE)
    with _client(tmp_path) as client:
        anonymous = client.get(f"{_BASE}/epistemic-assessment")
        business_plane = client.get(
            f"{_BASE}/epistemic-assessment",
            headers={"X-Api-Key": "business-plane-key"},
        )
        wrong_key = client.get(
            f"{_BASE}/epistemic-assessment",
            headers={"X-Admin-Api-Key": "wrong-key"},
        )
    assert anonymous.status_code == 401
    assert business_plane.status_code == 401
    assert wrong_key.status_code == 401
    for response in (anonymous, business_plane, wrong_key):
        assert response.json()["detail"]["code"] == "control_plane_unauthorized"
        assert "assessments" not in response.text
        assert "tei.reference" not in response.text
