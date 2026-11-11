import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from sui_sensemaking_api.routes import tei_epistemic
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tei_sui_reference import REFERENCE_SCHEMA

ARTIFACT = {
    "schema": "tai.reference.tei-documentv1-projection/v0",
    "contract": {"id": "sui.documentv1.projection", "version": "1"},
    "source": {"teiCommit": "abc", "documentRevision": "rev-1"},
    "document": {
        "document": {"id": "doc-1", "title": "Secret title"},
        "cards": [
            {"id": "card-1", "text": "hello", "x": 1, "y": 2, "textReviewed": True},
            {"id": "card-2", "text": "not reviewed", "x": 3, "y": 4},
        ],
        "islands": [{"id": "island-1", "cardIds": ["card-1"], "title": "secret"}],
        "edges": [],
        "affiliations": [],
    },
}


def _install(tmp_path, kind="documentv1-projection"):
    bound = tmp_path / "tenants" / "tenant-a" / "doc-1"
    bound.mkdir(parents=True)
    (bound / f"{kind}.json").write_text(json.dumps(ARTIFACT), encoding="utf-8")
    (tmp_path / "epistemic-bindings.json").write_text(
        json.dumps(
            {
                "bindings": [
                    {"tenantId": "tenant-a", "docId": "doc-1", "artifactKind": kind}
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


def _client(monkeypatch):
    monkeypatch.setattr(tei_epistemic, "_authorize_request", lambda **kwargs: _access())
    app = FastAPI()
    app.include_router(tei_epistemic.router)
    return TestClient(app)


def test_route_returns_typed_reference_without_content(tmp_path, monkeypatch):
    _install(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))

    with _client(monkeypatch) as client:
        response = client.get("/docs/doc-1/tei/sui-reference")

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["reference"]["schema"] == REFERENCE_SCHEMA
    assert body["reference"]["acceptedMeaning"] is False
    assert body["reference"]["disclosure"]["textIncluded"] is False
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-sui-reference-schema"] == REFERENCE_SCHEMA
    assert response.headers["etag"].startswith('"')
    serialized = response.text
    for content in ("hello", "not reviewed", "Secret title", "secret"):
        assert content not in serialized


def test_route_denies_agent_credentials(tmp_path, monkeypatch):
    _install(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))
    monkeypatch.setattr(
        tei_epistemic, "_authorize_request", lambda **kwargs: _access("agent_credential")
    )
    app = FastAPI()
    app.include_router(tei_epistemic.router)

    with TestClient(app) as client:
        response = client.get("/docs/doc-1/tei/sui-reference")

    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "agent_route_not_enabled"


def test_route_requires_binding(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))

    with _client(monkeypatch) as client:
        response = client.get("/docs/doc-1/tei/sui-reference")

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "tei_reference_unavailable"


def test_route_rejects_non_sui_binding_without_revealing_kind(tmp_path, monkeypatch):
    _install(tmp_path, kind="epistemic-assessment")
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))

    with _client(monkeypatch) as client:
        response = client.get("/docs/doc-1/tei/sui-reference")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "sui_reference_binding_not_found"
    assert "epistemic-assessment" not in response.text


def test_route_reports_invalid_reference_source_as_unavailable(tmp_path, monkeypatch):
    _install(tmp_path)
    bound = tmp_path / "tenants" / "tenant-a" / "doc-1" / "documentv1-projection.json"
    bound.write_text(json.dumps({"schema": "other"}), encoding="utf-8")
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))

    with _client(monkeypatch) as client:
        response = client.get("/docs/doc-1/tei/sui-reference")

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "sui_reference_unavailable"


def test_route_source_disappearance_fails_closed(tmp_path, monkeypatch):
    _install(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))
    bound = tmp_path / "tenants" / "tenant-a" / "doc-1" / "documentv1-projection.json"

    with _client(monkeypatch) as client:
        assert client.get("/docs/doc-1/tei/sui-reference").status_code == 200
        bound.unlink()
        stale = client.get("/docs/doc-1/tei/sui-reference")

    assert stale.status_code == 503
    assert stale.json()["detail"]["code"] == "tei_reference_unavailable"
    assert "card-1" not in stale.text


def test_route_re_reference_marks_change(tmp_path, monkeypatch):
    _install(tmp_path)
    monkeypatch.setattr(settings, "tei_reference_dir", str(tmp_path))

    with _client(monkeypatch) as client:
        first = client.get("/docs/doc-1/tei/sui-reference")
        digest = first.json()["reference"]["revision"]["documentDigest"]
        second = client.get(
            "/docs/doc-1/tei/sui-reference",
            params={"previous_digest": digest, "previous_source_revision": "rev-1"},
        )

    assert second.status_code == 200
    assert second.json()["reference"]["revision"]["change"] == "unchanged"
    assert (
        second.json()["reference"]["revision"]["previousReferenceInvalidated"]
        is False
    )
