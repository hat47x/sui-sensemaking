import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from sui_sensemaking_api.control_plane_auth import require_control_plane_authorization
from sui_sensemaking_api.routes import tei_epistemic_admin
from sui_sensemaking_api.settings import settings

ARTIFACT = {
    "schema": "tai.reference.tei-documentv1-projection/v0",
    "contract": {"id": "sui.documentv1.projection", "version": "1"},
    "source": {"teiCommit": "abc", "contracts": {}},
    "document": {
        "document": {"id": "doc-1"},
        "cards": [{"id": "card-1", "text": "hello", "x": 1, "y": 2}],
        "islands": [],
        "edges": [],
        "affiliations": [],
    },
}


def test_admin_route_serves_projection(tmp_path, monkeypatch):
    (tmp_path / "documentv1-projection.json").write_text(
        json.dumps(ARTIFACT), encoding="utf-8"
    )
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))

    app = FastAPI()
    app.include_router(tei_epistemic_admin.router)
    app.dependency_overrides[require_control_plane_authorization] = lambda: None

    with TestClient(app) as client:
        response = client.get("/admin/tei-epistemic/artifacts/documentv1-projection")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["ok"] is True
    assert body["artifact"] == ARTIFACT


def test_admin_route_rejects_unknown_kind(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))

    app = FastAPI()
    app.include_router(tei_epistemic_admin.router)
    app.dependency_overrides[require_control_plane_authorization] = lambda: None

    with TestClient(app) as client:
        response = client.get("/admin/tei-epistemic/artifacts/unknown-kind")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_tei_artifact"
