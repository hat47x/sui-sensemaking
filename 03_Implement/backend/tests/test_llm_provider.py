from __future__ import annotations

import io
import json
import socket
from urllib import error

import pytest
from fastapi.testclient import TestClient

from sui_sensemaking_api.llm.provider import (
    LLMRequest,
    LLMCallMetadata,
    LLMResponse,
    DeepSeekProvider,
    LargeScaleProvider,
    LocalProvider,
    MAX_LLM_PROVIDER_REQUEST_BYTES,
    MAX_LLM_PROVIDER_RESPONSE_BYTES,
    NoOpProvider,
    NoneProvider,
    ProviderDisabledError,
    ProviderRequestError,
    generate_with_fallback,
    get_provider,
)
from sui_sensemaking_api.main import app
from sui_sensemaking_api.settings import Settings, settings


class _StubHTTPResponse:
    def __init__(self, body: str | bytes):
        self._buffer = io.BytesIO(
            body.encode("utf-8") if isinstance(body, str) else body
        )

    def read(self, size: int = -1) -> bytes:
        return self._buffer.read(size)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_get_provider_supports_none_local_and_large_scale() -> None:
    original = settings.llm_provider
    try:
        settings.llm_provider = "none"
        assert isinstance(get_provider(), NoneProvider)

        settings.llm_provider = "local"
        assert isinstance(get_provider(), LocalProvider)

        settings.llm_provider = "large-scale"
        assert isinstance(get_provider(), LargeScaleProvider)
    finally:
        settings.llm_provider = original


@pytest.mark.parametrize(
    ("provider_name", "expected_type"),
    [
        ("local_http", LocalProvider),
        ("external", LargeScaleProvider),
    ],
)
def test_get_provider_backward_compatible_aliases(provider_name: str, expected_type: type) -> None:
    original = settings.llm_provider
    try:
        settings.llm_provider = provider_name
        assert isinstance(get_provider(), expected_type)
    finally:
        settings.llm_provider = original


def test_none_provider_is_disabled() -> None:
    provider = NoneProvider()
    with pytest.raises(ProviderDisabledError):
        provider.generate(LLMRequest(task="x", prompt="y"))


def test_local_provider_returns_trace_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    original_url = settings.local_llm_base_url
    original_model = settings.local_llm_model
    settings.local_llm_base_url = "http://local-llm.test"
    settings.local_llm_model = "test-model"

    def _fake_urlopen(req, timeout_seconds=60):
        assert req.full_url == "http://local-llm.test/generate"
        payload = json.loads(req.data.decode("utf-8"))
        assert payload["model"] == "test-model"
        return _StubHTTPResponse('{"text":"ok"}')

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        response = LocalProvider().generate(LLMRequest(task="check_narrative", prompt="prompt"))
        assert response.raw_text == "ok"
        assert response.provider == "local"
        assert response.metadata.provider_kind == "local"
        assert response.metadata.model_id == "test-model"
        assert response.transport == "http"
        assert response.trace_id.startswith("llm-")
        assert response.metadata.requested_at
    finally:
        settings.local_llm_base_url = original_url
        settings.local_llm_model = original_model


def test_local_provider_keeps_structured_inputs_internal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ADR-0090: audit IR may retain structural scores, HTTP transport may not."""
    original_url = settings.local_llm_base_url
    original_model = settings.local_llm_model
    settings.local_llm_base_url = "http://local-llm.test"
    settings.local_llm_model = "test-model"

    def _fake_urlopen(req, timeout_seconds=60):
        payload = json.loads(req.data.decode("utf-8"))
        assert set(payload) == {
            "task",
            "prompt",
            "temperature",
            "max_tokens",
            "model",
        }
        assert "inputs" not in payload
        assert "cluster_candidates" not in req.data.decode("utf-8")
        assert '"score"' not in req.data.decode("utf-8")
        return _StubHTTPResponse('{"text":"ok"}')

    monkeypatch.setattr(
        "sui_sensemaking_api.llm.provider.open_trusted_http",
        _fake_urlopen,
    )

    try:
        response = LocalProvider().generate(
            LLMRequest(
                task="suggest_card_groups",
                prompt="structural observation without numeric score",
                inputs={
                    "cluster_candidates": [
                        {
                            "cluster_id": "cc-0001",
                            "card_ids": ["c1", "c2"],
                            "basis": "relation",
                            "score": 0.9,
                        }
                    ]
                },
            )
        )
        assert response.raw_text == "ok"
    finally:
        settings.local_llm_base_url = original_url
        settings.local_llm_model = original_model


def test_local_provider_handles_http_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    original_url = settings.local_llm_base_url
    settings.local_llm_base_url = "http://local-llm.test"

    def _fake_urlopen(req, timeout_seconds=60):
        raise error.URLError("offline")

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        with pytest.raises(ProviderRequestError):
            LocalProvider().generate(LLMRequest(task="check_narrative", prompt="prompt"))
    finally:
        settings.local_llm_base_url = original_url



def test_local_provider_maps_timeout_error_code(monkeypatch: pytest.MonkeyPatch) -> None:
    original_url = settings.local_llm_base_url
    settings.local_llm_base_url = "http://local-llm.test"

    def _fake_urlopen(req, timeout_seconds=60):
        raise error.URLError(socket.timeout("timed out"))

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        with pytest.raises(ProviderRequestError) as exc_info:
            LocalProvider().generate(LLMRequest(task="check_narrative", prompt="prompt"))
        assert exc_info.value.code == "provider_timeout"
    finally:
        settings.local_llm_base_url = original_url


def test_local_provider_maps_validation_error_code(monkeypatch: pytest.MonkeyPatch) -> None:
    original_url = settings.local_llm_base_url
    settings.local_llm_base_url = "http://local-llm.test"

    def _fake_urlopen(req, timeout_seconds=60):
        return _StubHTTPResponse('{"text":123}')

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        with pytest.raises(ProviderRequestError) as exc_info:
            LocalProvider().generate(LLMRequest(task="check_narrative", prompt="prompt"))
        assert exc_info.value.code == "provider_validation"
    finally:
        settings.local_llm_base_url = original_url


@pytest.mark.parametrize(
    "response_body",
    [
        b"[]",
        b'{"text":"ok","token":"response-secret"}',
        b"\xff",
        b"x" * (MAX_LLM_PROVIDER_RESPONSE_BYTES + 1),
    ],
    ids=["array", "extra-field", "invalid-utf8", "oversized"],
)
def test_local_provider_rejects_unbounded_or_noncanonical_response_without_reflection(
    monkeypatch: pytest.MonkeyPatch,
    response_body: bytes,
) -> None:
    original_url = settings.local_llm_base_url
    settings.local_llm_base_url = "http://local-llm.test"
    monkeypatch.setattr(
        "sui_sensemaking_api.llm.provider.open_trusted_http",
        lambda request, timeout_seconds: _StubHTTPResponse(response_body),  # noqa: ARG005
    )
    try:
        with pytest.raises(ProviderRequestError) as exc_info:
            LocalProvider().generate(
                LLMRequest(task="check_narrative", prompt="tenant prompt")
            )
        assert exc_info.value.code == "provider_validation"
        assert "response-secret" not in str(exc_info.value)
    finally:
        settings.local_llm_base_url = original_url


@pytest.mark.parametrize(
    "invalid_request",
    [
        LLMRequest(task="", prompt="prompt"),
        LLMRequest(task="Bad Task", prompt="prompt"),
        LLMRequest(task="x", prompt=""),
        LLMRequest(task="x", prompt="prompt", temperature=float("nan")),
        LLMRequest(task="x", prompt="prompt", temperature=-0.1),
        LLMRequest(task="x", prompt="prompt", temperature=2.1),
        LLMRequest(task="x", prompt="prompt", max_tokens=0),
        LLMRequest(task="x", prompt="prompt", max_tokens=32_769),
    ],
    ids=[
        "empty-task",
        "noncanonical-task",
        "empty-prompt",
        "nonfinite-temperature",
        "negative-temperature",
        "excessive-temperature",
        "zero-max-tokens",
        "excessive-max-tokens",
    ],
)
def test_local_provider_rejects_invalid_request_before_transport(
    monkeypatch: pytest.MonkeyPatch,
    invalid_request: LLMRequest,
) -> None:
    original_url = settings.local_llm_base_url
    settings.local_llm_base_url = "http://local-llm.test"
    transport_called = False

    def _unexpected_transport(request, timeout_seconds):  # noqa: ANN001, ARG001
        nonlocal transport_called
        transport_called = True
        raise AssertionError("transport must not be called")

    monkeypatch.setattr(
        "sui_sensemaking_api.llm.provider.open_trusted_http",
        _unexpected_transport,
    )
    try:
        with pytest.raises(ProviderRequestError) as exc_info:
            LocalProvider().generate(invalid_request)
        assert exc_info.value.code == "provider_validation"
        assert transport_called is False
    finally:
        settings.local_llm_base_url = original_url


def test_local_provider_rejects_oversized_request_before_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_url = settings.local_llm_base_url
    settings.local_llm_base_url = "http://local-llm.test"
    transport_called = False

    def _unexpected_transport(request, timeout_seconds):  # noqa: ANN001, ARG001
        nonlocal transport_called
        transport_called = True
        raise AssertionError("transport must not be called")

    monkeypatch.setattr(
        "sui_sensemaking_api.llm.provider.open_trusted_http",
        _unexpected_transport,
    )
    try:
        with pytest.raises(ProviderRequestError) as exc_info:
            LocalProvider().generate(
                LLMRequest(
                    task="check_narrative",
                    prompt="x" * MAX_LLM_PROVIDER_REQUEST_BYTES,
                )
            )
        assert exc_info.value.code == "provider_validation"
        assert "x" * 64 not in str(exc_info.value)
        assert transport_called is False
    finally:
        settings.local_llm_base_url = original_url

def test_generate_with_fallback_to_none_when_enabled() -> None:
    original_provider = settings.llm_provider
    original_fallback = settings.llm_fallback_to_none
    original_url = settings.local_llm_base_url
    settings.llm_provider = "local"
    settings.llm_fallback_to_none = True
    settings.local_llm_base_url = None

    try:
        with pytest.raises(ProviderDisabledError) as exc_info:
            generate_with_fallback(LLMRequest(task="check_narrative", prompt="prompt"))
        assert exc_info.value.metadata.provider_name == "none"
        assert exc_info.value.metadata.fallback_to_none is True
        assert exc_info.value.metadata.execution_path == "local->none"
    finally:
        settings.llm_provider = original_provider
        settings.llm_fallback_to_none = original_fallback
        settings.local_llm_base_url = original_url


def test_generate_with_fallback_keeps_original_error_when_disabled() -> None:
    original_provider = settings.llm_provider
    original_fallback = settings.llm_fallback_to_none
    original_url = settings.local_llm_base_url
    settings.llm_provider = "local"
    settings.llm_fallback_to_none = False
    settings.local_llm_base_url = None

    try:
        with pytest.raises(ProviderRequestError):
            generate_with_fallback(LLMRequest(task="check_narrative", prompt="prompt"))
    finally:
        settings.llm_provider = original_provider
        settings.llm_fallback_to_none = original_fallback
        settings.local_llm_base_url = original_url


def test_generate_with_fallback_never_masks_validation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_provider = settings.llm_provider
    original_fallback = settings.llm_fallback_to_none
    original_url = settings.local_llm_base_url
    settings.llm_provider = "local"
    settings.llm_fallback_to_none = True
    settings.local_llm_base_url = "http://local-llm.test"
    monkeypatch.setattr(
        "sui_sensemaking_api.llm.provider.open_trusted_http",
        lambda request, timeout_seconds: _StubHTTPResponse(b"[]"),  # noqa: ARG005
    )

    try:
        with pytest.raises(ProviderRequestError) as exc_info:
            generate_with_fallback(
                LLMRequest(task="check_narrative", prompt="prompt")
            )
        assert exc_info.value.code == "provider_validation"
        assert exc_info.value.metadata.fallback_to_none is False
    finally:
        settings.llm_provider = original_provider
        settings.llm_fallback_to_none = original_fallback
        settings.local_llm_base_url = original_url


def test_large_scale_provider_fails_closed_without_endpoint() -> None:
    original_base_url = settings.large_scale_llm_base_url
    original_model = settings.large_scale_llm_model
    settings.large_scale_llm_base_url = None
    settings.large_scale_llm_model = None

    try:
        with pytest.raises(ProviderRequestError):
            LargeScaleProvider().generate(LLMRequest(task="generate_narrative", prompt="prompt"))
    finally:
        settings.large_scale_llm_base_url = original_base_url
        settings.large_scale_llm_model = original_model


def test_large_scale_provider_requires_escalation_opt_in() -> None:
    original_enabled = settings.llm_escalation_enabled
    original_opt_in = settings.llm_large_scale_opt_in
    original_base_url = settings.large_scale_llm_base_url
    original_model = settings.large_scale_llm_model

    settings.llm_large_scale_opt_in = True
    settings.llm_escalation_enabled = False
    settings.large_scale_llm_base_url = "https://allowed.example/api"
    settings.large_scale_llm_model = "gpt-x"

    try:
        with pytest.raises(ProviderRequestError) as exc_info:
            LargeScaleProvider().generate(LLMRequest(task="generate_narrative", prompt="prompt"))
        assert exc_info.value.code == "provider_unavailable"
    finally:
        settings.llm_escalation_enabled = original_enabled
        settings.llm_large_scale_opt_in = original_opt_in
        settings.large_scale_llm_base_url = original_base_url
        settings.large_scale_llm_model = original_model


def test_large_scale_provider_rejects_non_allowlisted_destination() -> None:
    original_enabled = settings.llm_escalation_enabled
    original_opt_in = settings.llm_large_scale_opt_in
    original_base_url = settings.large_scale_llm_base_url
    original_model = settings.large_scale_llm_model
    original_allowlist = settings.large_scale_llm_allowlist

    settings.llm_large_scale_opt_in = True
    settings.llm_escalation_enabled = True
    settings.large_scale_llm_base_url = "https://blocked.example/api"
    settings.large_scale_llm_model = "gpt-x"
    settings.large_scale_llm_allowlist = "allowed.example"

    try:
        with pytest.raises(ProviderRequestError) as exc_info:
            LargeScaleProvider().generate(LLMRequest(task="generate_narrative", prompt="prompt"))
        assert exc_info.value.code == "provider_unavailable"
    finally:
        settings.llm_escalation_enabled = original_enabled
        settings.llm_large_scale_opt_in = original_opt_in
        settings.large_scale_llm_base_url = original_base_url
        settings.large_scale_llm_model = original_model
        settings.large_scale_llm_allowlist = original_allowlist


def test_api_does_not_expose_decision_finalization_routes() -> None:
    forbidden_paths = {"/ai/decision", "/ai/decisions", "/ai/finalize-decision", "/ai/confirm-decision"}
    defined_paths = {route.path for route in app.routes}
    assert forbidden_paths.isdisjoint(defined_paths)


def test_suggest_merges_contract_is_stable_across_provider_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
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

    original_api_key = settings.api_key
    original_provider = settings.llm_provider
    original_local_url = settings.local_llm_base_url
    original_local_model = settings.local_llm_model
    original_escalation = settings.llm_escalation_enabled
    original_opt_in = settings.llm_large_scale_opt_in
    original_allowlist = settings.large_scale_llm_allowlist
    original_large_url = settings.large_scale_llm_base_url
    original_large_model = settings.large_scale_llm_model

    def _fake_local_urlopen(req, timeout_seconds=60):
        body = json.dumps(
            {
                "text": '{"suggestions":[{"groupId":"g1","cardIds":["c1","c2"],"mergedTextDraft":"merged","mergeMethod":"near_duplicate"}]}'
            }
        )
        return _StubHTTPResponse(body)

    def _fake_large_scale_generate(self, req: LLMRequest) -> LLMResponse:
        return LLMResponse(
            raw_text='{"suggestions":[{"groupId":"g1","cardIds":["c1","c2"],"mergedTextDraft":"merged","mergeMethod":"near_duplicate"}]}',
            metadata=LLMCallMetadata(
                provider_kind="large-scale",
                provider_name="large-scale",
                model_id="mock-large",
                transport="mock",
                requested_at="2026-01-01T00:00:00+00:00",
                trace_id="llm-test",
            ),
        )

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_local_urlopen)
    monkeypatch.setattr("sui_sensemaking_api.llm.provider.LargeScaleProvider.generate", _fake_large_scale_generate)

    try:
        settings.api_key = None
        settings.local_llm_base_url = "http://local-llm.test"
        settings.local_llm_model = "local-model"

        with TestClient(app) as client:
            settings.llm_provider = "local"
            local_response = client.post("/ai/suggest-merges", json=payload)
            assert local_response.status_code == 200

            settings.llm_provider = "large-scale"
            settings.llm_large_scale_opt_in = True
            settings.llm_escalation_enabled = True
            settings.large_scale_llm_allowlist = "allowed.example"
            settings.large_scale_llm_base_url = "https://allowed.example/api"
            settings.large_scale_llm_model = "mock-large"
            large_response = client.post("/ai/suggest-merges", json=payload)
            assert large_response.status_code == 200

        assert local_response.json() == large_response.json()
        assert list(local_response.json().keys()) == ["suggestions"]
        assert local_response.json()["suggestions"][0]["mergeMethod"] == "near_duplicate"
    finally:
        settings.api_key = original_api_key
        settings.llm_provider = original_provider
        settings.local_llm_base_url = original_local_url
        settings.local_llm_model = original_local_model
        settings.llm_escalation_enabled = original_escalation
        settings.llm_large_scale_opt_in = original_opt_in
        settings.large_scale_llm_allowlist = original_allowlist
        settings.large_scale_llm_base_url = original_large_url
        settings.large_scale_llm_model = original_large_model


def test_default_registry_maps_none_to_noop_provider() -> None:
    original = settings.llm_provider
    try:
        settings.llm_provider = "none"
        assert isinstance(get_provider(), NoOpProvider)
    finally:
        settings.llm_provider = original


def test_response_audit_fields_include_provider_and_execution_metadata() -> None:
    metadata = LLMCallMetadata(
        provider_kind="local",
        provider_name="local",
        model_id="model-a",
        transport="http",
        requested_at="2026-01-01T00:00:00+00:00",
        trace_id="llm-trace",
        fallback_to_none=False,
    )
    response = LLMResponse(raw_text="{}", metadata=metadata)

    assert response.as_audit_fields() == {
        "provider": "local",
        "provider_kind": "local",
        "model_id": "model-a",
        "transport": "http",
        "requested_at": "2026-01-01T00:00:00+00:00",
        "fallback_to_none": False,
        "execution_path": "primary",
        "trace_id": "llm-trace",
    }


def test_provider_error_contract_mapping_is_consistent() -> None:
    metadata = LLMCallMetadata(
        provider_kind="local",
        provider_name="local",
        model_id="model-a",
        transport="http",
        requested_at="2026-01-01T00:00:00+00:00",
        trace_id="llm-trace",
        fallback_to_none=False,
    )
    timeout_error = ProviderRequestError.timeout("timeout", metadata)
    validation_error = ProviderRequestError.validation("invalid", metadata)
    unavailable_error = ProviderRequestError.unavailable("down", metadata)

    assert timeout_error.to_contract()["code"] == "provider_timeout"
    assert validation_error.to_contract()["code"] == "provider_validation"
    assert unavailable_error.to_contract()["code"] == "provider_unavailable"


def test_settings_reject_large_scale_without_explicit_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUI_LLM_PROVIDER", "large-scale")
    monkeypatch.setenv("SUI_LLM_ESCALATION_ENABLED", "true")

    with pytest.raises(ValueError, match="SUI_LLM_LARGE_SCALE_OPT_IN"):
        Settings()


def test_settings_accept_large_scale_with_opt_in_and_escalation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUI_LLM_PROVIDER", "large-scale")
    monkeypatch.setenv("SUI_LLM_LARGE_SCALE_OPT_IN", "true")
    monkeypatch.setenv("SUI_LLM_ESCALATION_ENABLED", "true")
    monkeypatch.setenv(
        "SUI_LARGE_SCALE_LLM_BASE_URL",
        "https://llm.example.invalid/v1",
    )
    monkeypatch.setenv("SUI_LARGE_SCALE_LLM_MODEL", "model-v1")
    monkeypatch.setenv("SUI_LARGE_SCALE_LLM_ALLOWLIST", "llm.example.invalid")

    loaded = Settings()
    assert loaded.llm_provider == "large-scale"
    assert loaded.llm_large_scale_opt_in is True
    assert loaded.llm_escalation_enabled is True


# ---------------------------------------------------------------------------
# DeepSeek provider tests
# ---------------------------------------------------------------------------


def test_get_provider_supports_deepseek() -> None:
    original = settings.llm_provider
    original_key = settings.deepseek_api_key
    try:
        settings.llm_provider = "deepseek"
        settings.deepseek_api_key = "sk-test-key"
        assert isinstance(get_provider(), DeepSeekProvider)
    finally:
        settings.llm_provider = original
        settings.deepseek_api_key = original_key


def test_deepseek_provider_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUI_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("SUI_DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    monkeypatch.delenv("SUI_DEEPSEEK_API_KEY", raising=False)

    with pytest.raises(ValueError, match="SUI_DEEPSEEK_API_KEY"):
        Settings()


def test_deepseek_settings_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUI_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("SUI_DEEPSEEK_API_KEY", "sk-test-key")

    loaded = Settings()
    assert loaded.llm_provider == "deepseek"
    assert loaded.deepseek_base_url == "https://api.deepseek.com"
    assert loaded.deepseek_model == "deepseek-v4-flash"
    assert loaded.deepseek_thinking_mode == "disabled"
    assert loaded.deepseek_api_key == "sk-test-key"


def test_deepseek_settings_custom_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUI_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("SUI_DEEPSEEK_API_KEY", "sk-test-key")
    monkeypatch.setenv("SUI_DEEPSEEK_MODEL", "deepseek-v4-pro")
    monkeypatch.setenv("SUI_DEEPSEEK_THINKING_MODE", "enabled")

    loaded = Settings()
    assert loaded.deepseek_model == "deepseek-v4-pro"
    assert loaded.deepseek_thinking_mode == "enabled"


def test_deepseek_provider_returns_openai_chat_response(monkeypatch: pytest.MonkeyPatch) -> None:
    original_key = settings.deepseek_api_key
    original_url = settings.deepseek_base_url
    original_model = settings.deepseek_model
    settings.deepseek_api_key = "sk-test-key"
    settings.deepseek_base_url = "https://api.deepseek.com"
    settings.deepseek_model = "deepseek-v4-flash"

    def _fake_urlopen(req, timeout_seconds=120):
        assert req.full_url == "https://api.deepseek.com/v1/chat/completions"
        assert req.headers["Authorization"] == "Bearer sk-test-key"
        payload = json.loads(req.data.decode("utf-8"))
        assert payload["model"] == "deepseek-v4-flash"
        assert payload["thinking"] == {"type": "disabled"}
        assert len(payload["messages"]) == 2
        assert payload["messages"][0]["role"] == "system"
        assert payload["messages"][1]["role"] == "user"
        assert payload["stream"] is False
        response = {
            "choices": [{"message": {"content": "提案タイトル：地域ヒアリングの構造化"}}]
        }
        return _StubHTTPResponse(json.dumps(response))

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        response = DeepSeekProvider().generate(
            LLMRequest(task="suggest_document_title", prompt="test prompt")
        )
        assert response.raw_text == "提案タイトル：地域ヒアリングの構造化"
        assert response.provider == "deepseek"
        assert response.metadata.provider_kind == "deepseek"
        assert response.metadata.model_id == "deepseek-v4-flash"
        assert response.metadata.thinking_mode == "disabled"
        assert response.transport == "http"
        assert response.trace_id.startswith("llm-")
    finally:
        settings.deepseek_api_key = original_key
        settings.deepseek_base_url = original_url
        settings.deepseek_model = original_model




def test_deepseek_provider_maps_official_v4_usage_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_key = settings.deepseek_api_key
    original_url = settings.deepseek_base_url
    original_model = settings.deepseek_model
    settings.deepseek_api_key = "sk-test-key"
    settings.deepseek_base_url = "https://api.deepseek.com"
    settings.deepseek_model = "deepseek-v4-flash"

    def _fake_urlopen(req, timeout_seconds=120):
        response = {
            "choices": [{"message": {"content": "ok"}}],
            "usage": {
                "prompt_tokens": 321,
                "completion_tokens": 1,
                "prompt_cache_hit_tokens": 100,
                "prompt_cache_miss_tokens": 221,
                "total_tokens": 322,
            },
        }
        return _StubHTTPResponse(json.dumps(response))

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        response = DeepSeekProvider().generate(
            LLMRequest(
                task="suggest_document_title",
                prompt="test prompt",
                max_tokens=1,
            )
        )
        # DeepSeek V4 Chat Completions reports input/output usage using the
        # OpenAI-compatible prompt_tokens/completion_tokens fields. Cache split
        # fields are diagnostics; the provider-reported prompt total is the
        # measurement source of truth.
        assert response.input_tokens == 321
        assert response.output_tokens == 1
    finally:
        settings.deepseek_api_key = original_key
        settings.deepseek_base_url = original_url
        settings.deepseek_model = original_model

def test_deepseek_task_model_map_override(monkeypatch: pytest.MonkeyPatch) -> None:
    original_key = settings.deepseek_api_key
    original_url = settings.deepseek_base_url
    original_model = settings.deepseek_model
    original_map = settings.llm_task_model_map
    settings.deepseek_api_key = "sk-test-key"
    settings.deepseek_base_url = "https://api.deepseek.com"
    settings.deepseek_model = "deepseek-v4-flash"
    settings.llm_task_model_map = "suggest_document_title=deepseek-v4-pro"

    def _fake_urlopen(req, timeout_seconds=120):
        payload = json.loads(req.data.decode("utf-8"))
        # Task-model map should override the default model
        assert payload["model"] == "deepseek-v4-pro"
        assert payload["thinking"] == {"type": "disabled"}
        return _StubHTTPResponse(
            '{"choices":[{"message":{"content":"ok"}}]}'
        )

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        response = DeepSeekProvider().generate(
            LLMRequest(task="suggest_document_title", prompt="test")
        )
        assert response.metadata.model_id == "deepseek-v4-pro"
    finally:
        settings.deepseek_api_key = original_key
        settings.deepseek_base_url = original_url
        settings.deepseek_model = original_model
        settings.llm_task_model_map = original_map


def test_deepseek_settings_reject_invalid_thinking_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUI_LLM_PROVIDER", "deepseek")
    monkeypatch.setenv("SUI_DEEPSEEK_API_KEY", "sk-test-key")
    monkeypatch.setenv("SUI_DEEPSEEK_THINKING_MODE", "auto")

    with pytest.raises(ValueError, match="SUI_DEEPSEEK_THINKING_MODE"):
        Settings()


def test_deepseek_auth_error_401(monkeypatch: pytest.MonkeyPatch) -> None:
    original_key = settings.deepseek_api_key
    original_url = settings.deepseek_base_url
    settings.deepseek_api_key = "sk-invalid"
    settings.deepseek_base_url = "https://api.deepseek.com"

    def _fake_urlopen(req, timeout_seconds=120):
        raise error.HTTPError(
            req.full_url, 401, "Unauthorized", {}, io.BytesIO(b"{}")
        )

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        with pytest.raises(ProviderRequestError, match="authentication failed"):
            DeepSeekProvider().generate(
                LLMRequest(task="suggest_document_title", prompt="test")
            )
    finally:
        settings.deepseek_api_key = original_key
        settings.deepseek_base_url = original_url


def test_deepseek_empty_choices_error(monkeypatch: pytest.MonkeyPatch) -> None:
    original_key = settings.deepseek_api_key
    original_url = settings.deepseek_base_url
    settings.deepseek_api_key = "sk-test-key"
    settings.deepseek_base_url = "https://api.deepseek.com"

    def _fake_urlopen(req, timeout_seconds=120):
        return _StubHTTPResponse('{"choices":[]}')

    monkeypatch.setattr("sui_sensemaking_api.llm.provider.open_trusted_http", _fake_urlopen)

    try:
        with pytest.raises(ProviderRequestError, match="missing choices"):
            DeepSeekProvider().generate(
                LLMRequest(task="suggest_document_title", prompt="test")
            )
    finally:
        settings.deepseek_api_key = original_key
        settings.deepseek_base_url = original_url


# --- AI-ROUTE-01 MMR routing tests ---

def test_routing_stage_classification() -> None:
    from sui_sensemaking_api.llm.provider import routing_stage_for_task

    assert routing_stage_for_task("refine_card_text") == "intermediate"
    assert routing_stage_for_task("suggest_document_title") == "intermediate"
    assert routing_stage_for_task("check_narrative") == "final_judgement"
    assert routing_stage_for_task("detect_contradiction") == "final_judgement"
    assert routing_stage_for_task("unknown_task") == "unknown"


def test_final_judgement_routes_to_high_reasoning_model(monkeypatch: pytest.MonkeyPatch) -> None:
    from sui_sensemaking_api.settings import settings

    original_high = settings.llm_high_reasoning_model
    original_local = settings.local_llm_model
    original_map = settings.llm_task_model_map
    try:
        settings.llm_high_reasoning_model = "high-reasoning-model"
        settings.local_llm_model = "default-model"
        settings.llm_task_model_map = ""
        from sui_sensemaking_api.llm.provider import resolve_model_for_task

        # final_judgement task → high-reasoning model
        assert resolve_model_for_task("check_narrative") == "high-reasoning-model"
        # intermediate task → default model
        assert resolve_model_for_task("refine_card_text") == "default-model"
    finally:
        settings.llm_high_reasoning_model = original_high
        settings.local_llm_model = original_local
        settings.llm_task_model_map = original_map
