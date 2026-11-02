import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from sui_sensemaking_api.routes import tei_epistemic
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


def _install(tmp_path):
    bound = tmp_path / "tenants" / "tenant-a" / "doc-1"
    bound.mkdir(parents=True)
    (bound / "documentv1-projection.json").write_text(json.dumps(ARTIFACT), encoding="utf-8")
    (tmp_path / "epistemic-bindings.json").write_text(
        json.dumps(
            {
                "bindings": [
                    {"tenantId": "tenant-a", "docId": "doc-1", "artifactKind": "documentv1-projection"}
                ]
            }
        ),
        encoding="utf-8",
    )


def _access(provider="session"):
    return (
        SimpleNamespace(auth=SimpleNamespace(provider=provider)),
        SimpleNamespace(),
        SimpleNamespace(tenant_id="tenant-a"),
    )


def test_tenant_route_returns_bound_projection(tmp_path, monkeypatch):
    _install(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))
    monkeypatch.setattr(tei_epistemic, "_authorize_request", lambda **kwargs: _access())

    app = FastAPI()
    app.include_router(tei_epistemic.router)
    with TestClient(app) as client:
        response = client.get("/docs/doc-1/epistemic/projection")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"ok": True, "artifact": ARTIFACT}


def test_tenant_route_denies_agent_credentials(tmp_path, monkeypatch):
    _install(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))
    monkeypatch.setattr(
        tei_epistemic, "_authorize_request", lambda **kwargs: _access("agent_credential")
    )

    app = FastAPI()
    app.include_router(tei_epistemic.router)
    with TestClient(app) as client:
        response = client.get("/docs/doc-1/epistemic/projection")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "agent_route_not_enabled"


def test_tenant_route_requires_binding(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))
    monkeypatch.setattr(tei_epistemic, "_authorize_request", lambda **kwargs: _access())

    app = FastAPI()
    app.include_router(tei_epistemic.router)
    with TestClient(app) as client:
        response = client.get("/docs/doc-1/epistemic/projection")

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unavailable"
