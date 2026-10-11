from __future__ import annotations

from fastapi.testclient import TestClient

from sui_sensemaking_api.main import app
from sui_sensemaking_api.request_body_safety import MAX_JSON_BODY_NESTING_DEPTH, MAX_NATIVE_ACTION_JSON_BYTES
from sui_sensemaking_api.settings import settings


def _nested_json(depth: int) -> str:
    return '{"value":' + ("[" * depth) + "0" + ("]" * depth) + "}"


def test_rejects_over_deep_json_before_route_parsing() -> None:
    original_api_key = settings.api_key
    settings.api_key = None
    try:
        with TestClient(app) as client:
            for path in ("/context/query", "/docs/deep-json"):
                response = client.post(
                    path,
                    content=_nested_json(MAX_JSON_BODY_NESTING_DEPTH + 1),
                    headers={"content-type": "application/json"},
                )

                assert response.status_code == 400
                assert response.json() == {"detail": {"code": "json_nesting_too_deep"}}
                assert response.headers["x-content-type-options"] == "nosniff"
                assert response.headers["x-frame-options"] == "DENY"
    finally:
        settings.api_key = original_api_key


def test_json_depth_scanner_ignores_brackets_inside_strings_and_accepts_vendor_json() -> None:
    original_api_key = settings.api_key
    settings.api_key = None
    try:
        with TestClient(app) as client:
            ordinary = client.post(
                "/not-found",
                content='{"value":"[[{{ still text }}]]"}',
                headers={"content-type": "application/json"},
            )
            over_deep = client.post(
                "/not-found",
                content=_nested_json(MAX_JSON_BODY_NESTING_DEPTH + 1),
                headers={"content-type": "application/problem+json; charset=utf-8"},
            )

            assert ordinary.status_code == 404
            assert over_deep.status_code == 400
            assert over_deep.json()["detail"]["code"] == "json_nesting_too_deep"
    finally:
        settings.api_key = original_api_key


def test_api_key_rejection_precedes_json_body_inspection() -> None:
    original_api_key = settings.api_key
    settings.api_key = "test-secret"
    try:
        with TestClient(app) as client:
            response = client.post(
                "/context/query",
                content=_nested_json(MAX_JSON_BODY_NESTING_DEPTH + 1),
                headers={"content-type": "application/json"},
            )

            assert response.status_code == 401
            # OPS-OBSERV-01 AC-2: the 401 body additionally carries a requestId
            # (same value as the X-Request-Id header) for log correlation.
            assert response.json()["detail"] == "Unauthorized"
            assert response.json()["requestId"] == response.headers.get("X-Request-Id")
    finally:
        settings.api_key = original_api_key


def test_native_action_json_size_is_bounded_before_route_execution() -> None:
    original_api_key = settings.api_key
    settings.api_key = None
    try:
        with TestClient(app) as client:
            response = client.post(
                "/docs/native-action-probe/action-commit",
                content='{"payload":"' + ("x" * MAX_NATIVE_ACTION_JSON_BYTES) + '"}',
                headers={
                    "content-type": "application/json",
                    "X-TEI-Action": "commit",
                },
            )
            assert response.status_code == 413, response.text
            assert response.json() == {
                "protocolVersion": "1",
                "error": "invalid_action",
            }
            assert response.headers["Cache-Control"] == "no-store"
    finally:
        settings.api_key = original_api_key
