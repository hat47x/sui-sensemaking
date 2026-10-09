from fastapi.testclient import TestClient

from sui_sensemaking_api.llm.provider import LLMCallMetadata, ProviderDisabledError, ProviderRequestError
from sui_sensemaking_api.main import app
from sui_sensemaking_api.routes import ai, ai_relations
from sui_sensemaking_api.settings import settings


def _merge_payload() -> dict:
    return {
        "doc": {
            "version": 1,
            "id": "doc-1",
            "createdAt": "2026-02-11T00:00:00Z",
            "updatedAt": "2026-02-11T00:00:00Z",
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": [
                {"id": "c1", "text": "alpha", "x": 0, "y": 0, "textReviewed": True},
                {"id": "c2", "text": "beta", "x": 10, "y": 10, "textReviewed": True},
            ],
            "edges": [{"id": "e1", "fromId": "c1", "toId": "c2", "type": "related"}],
            "islands": [{"id": "i1", "cardIds": ["c1", "c2"]}],
        }
    }


def _relation_payload() -> dict:
    return {
        "doc": {
            "version": 1,
            "id": "doc-1",
            "createdAt": "2026-02-11T00:00:00Z",
            "updatedAt": "2026-02-11T00:00:00Z",
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": [
                {"id": "c1", "text": "alpha", "x": 0, "y": 0, "textReviewed": True},
                {"id": "c2", "text": "beta", "x": 10, "y": 10, "textReviewed": True},
            ],
            "edges": [{"id": "e1", "fromId": "c1", "toId": "c2", "type": "related"}],
            "islands": [
                {"id": "i1", "cardIds": ["c1"]},
                {"id": "i2", "cardIds": ["c2"]},
            ],
        },
        "islandAId": "i1",
        "islandBId": "i2",
        "relationType": "related",
        "derived": False,
        "groundingCardIds": ["c1", "c2"],
        "groundingEdgeIds": ["e1"],
        "cardTexts": [
            {"id": "c1", "text": "alpha"},
            {"id": "c2", "text": "beta"},
        ],
    }


def _metadata() -> LLMCallMetadata:
    return LLMCallMetadata(
        provider_kind="local",
        provider_name="local",
        model_id="model-a",
        transport="http",
        requested_at="2026-01-01T00:00:00+00:00",
        trace_id="llm-trace",
        fallback_to_none=False,
    )


def test_ai_routes_map_provider_timeout_to_504_with_common_contract() -> None:
    original_api_key = settings.api_key
    original_generate = ai.generate_with_fallback

    def _raise_timeout(_):
        raise ProviderRequestError.timeout("timed out", _metadata())

    settings.api_key = None
    ai.generate_with_fallback = _raise_timeout

    try:
        with TestClient(app) as client:
            response = client.post("/ai/suggest-merges", json=_merge_payload())
        assert response.status_code == 504
        detail = response.json()["detail"]
        assert detail["code"] == "provider_timeout"
        assert detail["model_id"] == "model-a"
        assert detail["transport"] == "http"
    finally:
        settings.api_key = original_api_key
        ai.generate_with_fallback = original_generate


def test_ai_relations_route_maps_provider_unavailable_to_503_with_common_contract() -> None:
    original_api_key = settings.api_key
    original_generate = ai_relations.generate_with_fallback

    def _raise_unavailable(_):
        raise ProviderRequestError.unavailable("offline", _metadata())

    settings.api_key = None
    ai_relations.generate_with_fallback = _raise_unavailable

    try:
        with TestClient(app) as client:
            response = client.post("/ai/summarize-island-relation", json=_relation_payload())
        assert response.status_code == 503
        detail = response.json()["detail"]
        assert detail["code"] == "provider_unavailable"
        assert detail["model_id"] == "model-a"
        assert detail["transport"] == "http"
    finally:
        settings.api_key = original_api_key
        ai_relations.generate_with_fallback = original_generate


def test_ai_routes_map_provider_disabled_to_503_with_common_contract() -> None:
    original_api_key = settings.api_key
    original_generate = ai.generate_with_fallback

    def _raise_disabled(_):
        raise ProviderDisabledError("disabled", _metadata())

    settings.api_key = None
    ai.generate_with_fallback = _raise_disabled

    try:
        with TestClient(app) as client:
            response = client.post("/ai/suggest-merges", json=_merge_payload())
        assert response.status_code == 503
        detail = response.json()["detail"]
        assert detail["code"] == "provider_unavailable"
        assert detail["disabled_reason"] == "provider_disabled_or_none_default"
    finally:
        settings.api_key = original_api_key
        ai.generate_with_fallback = original_generate


def test_ai_routes_map_provider_request_too_large_to_413_without_blaming_the_response() -> None:
    original_api_key = settings.api_key
    original_generate = ai.generate_with_fallback

    def _raise_too_large(_):
        raise ProviderRequestError.request_too_large("request exceeded the size limit", _metadata())

    settings.api_key = None
    ai.generate_with_fallback = _raise_too_large

    try:
        with TestClient(app) as client:
            response = client.post("/ai/suggest-merges", json=_merge_payload())
        assert response.status_code == 413
        detail = response.json()["detail"]
        assert detail["code"] == "provider_request_too_large"
        assert detail["model_id"] == "model-a"
    finally:
        settings.api_key = original_api_key
        ai.generate_with_fallback = original_generate
