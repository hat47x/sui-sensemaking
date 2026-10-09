from __future__ import annotations

import json
import logging
import math
import os
import re
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse
from typing import Any, Callable, Literal, Protocol
from urllib import error, request
from uuid import uuid4

from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.settings import _validate_trusted_http_endpoint
from sui_sensemaking_api.trusted_http import open_trusted_http

logger = logging.getLogger(__name__)

MAX_LLM_PROVIDER_REQUEST_BYTES = 1024 * 1024
MAX_LLM_PROVIDER_RESPONSE_BYTES = 1024 * 1024
MAX_LLM_TASK_LENGTH = 128
MAX_LLM_OUTPUT_TOKENS = 32_768
_LLM_TASK = re.compile(r"^[a-z][a-z0-9_-]{0,127}$")

# OPS-LLM-COST-01 (段階2): in-process LLM call counter. Counts every request
# that reaches a provider, keyed by provider kind ("none" / "local" /
# "large-scale" / "fixture"). Single-process deploy only; a shared store is a
# 段階3 decision (hard/soft limits + auto-downgrade). Exposed read-only via
# /ai/provider-status.
_LLM_CALL_COUNTS: dict[str, int] = {}
# OPS-LLM-COST-01 (段階2): in-process input/output token totals, keyed by the
# same provider kind + "total". Filled only from provider-reported usage. A
# missing/partial provider report still contributes 0 for the absent side to
# preserve the historical numeric totals, while _LLM_TOKEN_USAGE_COVERAGE makes
# that absence distinguishable from a genuine provider-reported zero.
_LLM_TOKEN_USAGE: dict[str, dict[str, int]] = {}
_LLM_TOKEN_USAGE_COVERAGE: dict[str, dict[str, int]] = {}


def _record_llm_call(provider_kind: str) -> None:
    _LLM_CALL_COUNTS[provider_kind] = _LLM_CALL_COUNTS.get(provider_kind, 0) + 1
    _LLM_CALL_COUNTS["total"] = _LLM_CALL_COUNTS.get("total", 0) + 1


def _record_llm_usage(
    provider_kind: str,
    *,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> None:
    """Accumulate provider-reported usage and its reporting completeness.

    Call counting remains separate because failed provider attempts have no
    successful response to settle. Numeric totals remain backward-compatible:
    an absent side contributes 0, but coverage records whether that 0 was a
    complete provider report, a partial report, or no usage report at all.
    """
    used_input = max(int(input_tokens or 0), 0)
    used_output = max(int(output_tokens or 0), 0)
    if input_tokens is None and output_tokens is None:
        coverage_key = "missingCalls"
    elif input_tokens is None or output_tokens is None:
        coverage_key = "partialCalls"
    else:
        coverage_key = "completeCalls"

    for key in (provider_kind, "total"):
        bucket = _LLM_TOKEN_USAGE.setdefault(key, {"input": 0, "output": 0})
        bucket["input"] += used_input
        bucket["output"] += used_output
        coverage = _LLM_TOKEN_USAGE_COVERAGE.setdefault(
            key,
            {"completeCalls": 0, "partialCalls": 0, "missingCalls": 0},
        )
        coverage[coverage_key] += 1


def llm_call_counts() -> dict[str, int]:
    """Snapshot of the in-process LLM call counter (copied, never the live dict)."""
    return dict(_LLM_CALL_COUNTS)


def llm_token_usage() -> dict[str, dict[str, int]]:
    """Snapshot of provider-reported token totals for the current process."""
    return {key: dict(value) for key, value in _LLM_TOKEN_USAGE.items()}


def llm_token_usage_coverage() -> dict[str, dict[str, int]]:
    """Snapshot of complete/partial/missing provider usage reports.

    This deliberately carries no prompt/response content, raw tokens, model,
    task, tenant, or user identity. The aggregation key remains provider kind
    plus total in the current process.
    """
    return {key: dict(value) for key, value in _LLM_TOKEN_USAGE_COVERAGE.items()}


def reset_llm_call_counts() -> None:
    """Clear the process-local observability counters. Ops/tests only."""
    _LLM_CALL_COUNTS.clear()
    _LLM_TOKEN_USAGE.clear()
    _LLM_TOKEN_USAGE_COVERAGE.clear()


@dataclass(frozen=True, slots=True)
class RegisteredProviderConfig:
    """Non-secret registry projection used to select one request transport."""

    provider_id: str
    provider_kind: str
    base_url: str | None
    api_key_ref: str | None
    model_id: str


@dataclass(frozen=True)
class LLMRequest:
    task: str
    prompt: str
    temperature: float = 0.2
    max_tokens: int = 2000
    # ADR-0065: optional model override (highest priority).
    model: str | None = None
    # AI-MODEL-GOVERNANCE-03: server-resolved registry dispatch target. This is
    # internal-only and contains a credential reference, never the secret.
    registered_provider: RegisteredProviderConfig | None = None
    # AI-IR-PROJECTION-01 (ADR-0069 D4=A): the LLM input IR this prompt was
    # rendered from (`llm_input_ir_spec.md` §4). The schema version it carries is
    # `llm_input_ir.IR_VERSION` -- do not restate the number here, it drifts.
    # Providers do not read it -- transports still send `prompt` -- but carrying
    # it on the request keeps the IR the auditable input of record, and lets a
    # test assert what actually reached the boundary. Only routes migrated to
    # the IR path populate it; it stays None for the rest.
    inputs: dict[str, Any] | None = None


# AI-ROUTE-01 MMR-01: tasks that are pure transformation (never a human
# judgement). These are safe on cheaper (intermediate) tiers.
_INTERMEDIATE_TASKS = frozenset({
    "refine_card_text",
    "suggest_card_groups",
    "re_layout",
    "suggest_merges",
    "suggest_island_summary",
    "summarize_island_relation",
    "generate_narrative",
    "suggest_document_title",
})
# AI-ROUTE-01 MMR-04: tasks that feed a human final judgement (accept/reject/
# merge/finalize). These route to a high-reasoning tier by default.
_FINAL_JUDGEMENT_TASKS = frozenset({
    "check_narrative",
    "detect_contradiction",
})


def resolve_thinking_mode_for_task(task: str) -> str:
    """DeepSeek thinking mode for a task.

    Priority: SUI_DEEPSEEK_THINKING_TASK_MAP > final_judgement default (enabled)
    > SUI_DEEPSEEK_THINKING_MODE.
    """
    from sui_sensemaking_api.settings import settings

    for pair in settings.deepseek_thinking_task_map.split(","):
        name, _, mode = pair.partition("=")
        if name.strip() == task and mode.strip():
            return mode.strip()
    if task in _FINAL_JUDGEMENT_TASKS:
        return "enabled"
    return settings.deepseek_thinking_mode


def resolve_model_for_task(task: str, request: LLMRequest | None = None) -> str:
    """ADR-0065 / AI-ROUTE-01 (MMR-01/02/03/04): resolve the model for a task.

    Priority: request.model > SUI_LLM_TASK_MODEL_MAP > task-class model
    (intermediate vs final_judgement) > default model.

    - intermediate tasks (transformation only) never accept/reject/merge,
      so they may use a cheaper tier.
    - final_judgement tasks route to the high-reasoning tier model when no
      explicit override is set.
    """
    from sui_sensemaking_api.settings import settings

    # 1. Request-level override (highest priority)
    if request and request.model:
        return request.model

    # 2. Task-model map from settings
    raw_map = settings.llm_task_model_map.strip()
    if raw_map:
        for pair in raw_map.split(","):
            pair = pair.strip()
            if "=" in pair:
                t, m = pair.split("=", 1)
                if t.strip() == task and m.strip():
                    return m.strip()

    # 3. Task-class model (MMR-04: final_judgement → high-reasoning tier)
    if task in _FINAL_JUDGEMENT_TASKS and settings.llm_high_reasoning_model:
        return settings.llm_high_reasoning_model

    # 4. Provider default. Resolve this before model-governance checks run in
    # the route layer. DeepSeekProvider used to translate "default" only after
    # that gate, so an otherwise valid DeepSeek default-model registration was rejected
    # as model_not_registered whenever the caller omitted `model`.
    if settings.llm_provider.strip().lower() == "deepseek":
        return settings.deepseek_model

    # 5. Default model
    return settings.local_llm_model or "default"


def routing_stage_for_task(task: str) -> str:
    """AI-ROUTE-01 MMR-01/MMR-05: classify a task's routing stage.

    Returns "intermediate" | "final_judgement" | "unknown".
    """
    if task in _INTERMEDIATE_TASKS:
        return "intermediate"
    if task in _FINAL_JUDGEMENT_TASKS:
        return "final_judgement"
    return "unknown"


@dataclass(frozen=True)
class LLMCallMetadata:
    provider_kind: str
    provider_name: str
    model_id: str
    transport: str
    requested_at: str
    trace_id: str
    fallback_to_none: bool = False
    execution_path: str = "primary"
    # DeepSeek V4 request mode. Kept separate from generic audit fields because
    # it is a provider-specific generation setting, not prompt/token content.
    thinking_mode: str | None = None

    def as_audit_fields(self) -> dict[str, object]:
        return {
            "provider": self.provider_name,
            "provider_kind": self.provider_kind,
            "model_id": self.model_id,
            "transport": self.transport,
            "requested_at": self.requested_at,
            "fallback_to_none": self.fallback_to_none,
            "execution_path": self.execution_path,
            "trace_id": self.trace_id,
        }


@dataclass(frozen=True)
class LLMResponse:
    raw_text: str
    metadata: LLMCallMetadata
    # OPS-LLM-COST-01: provider-reported token usage, when available.
    # None means that side was not reported; numeric aggregation preserves the
    # historical 0 contribution while tokenUsageCoverage records the absence.
    input_tokens: int | None = None
    output_tokens: int | None = None

    @property
    def provider(self) -> str:
        return self.metadata.provider_name

    @property
    def transport(self) -> str:
        return self.metadata.transport

    @property
    def trace_id(self) -> str:
        return self.metadata.trace_id

    def as_audit_fields(self) -> dict[str, object]:
        return self.metadata.as_audit_fields()


class LLMProvider(Protocol):
    provider_name: str
    provider_kind: str

    def generate(self, req: LLMRequest) -> LLMResponse:
        ...


class ProviderError(RuntimeError):
    def __init__(self, message: str, metadata: LLMCallMetadata):
        super().__init__(message)
        self.metadata = metadata

    def to_contract(self) -> dict[str, object]:
        return {
            "code": "provider_unavailable",
            "message": str(self),
            "provider": self.metadata.provider_name,
            "provider_kind": self.metadata.provider_kind,
            "model_id": self.metadata.model_id,
            "transport": self.metadata.transport,
            "requested_at": self.metadata.requested_at,
            "trace_id": self.metadata.trace_id,
            "fallback_to_none": self.metadata.fallback_to_none,
            "execution_path": self.metadata.execution_path,
        }


class ProviderDisabledError(ProviderError):
    def to_contract(self) -> dict[str, object]:
        base = super().to_contract()
        base["disabled_reason"] = "provider_disabled_or_none_default"
        return base


ProviderErrorCode = Literal[
    "provider_timeout",
    "provider_validation",
    "provider_unavailable",
    "provider_request_too_large",
]


class ProviderRequestError(ProviderError):
    def __init__(self, message: str, metadata: LLMCallMetadata, *, code: ProviderErrorCode):
        super().__init__(message, metadata)
        self.code = code

    def to_contract(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": str(self),
            "provider": self.metadata.provider_name,
            "provider_kind": self.metadata.provider_kind,
            "model_id": self.metadata.model_id,
            "transport": self.metadata.transport,
            "requested_at": self.metadata.requested_at,
            "trace_id": self.metadata.trace_id,
            "fallback_to_none": self.metadata.fallback_to_none,
            "execution_path": self.metadata.execution_path,
        }

    @classmethod
    def unavailable(cls, message: str, metadata: LLMCallMetadata) -> "ProviderRequestError":
        return cls(message, metadata, code="provider_unavailable")

    @classmethod
    def timeout(cls, message: str, metadata: LLMCallMetadata) -> "ProviderRequestError":
        return cls(message, metadata, code="provider_timeout")

    @classmethod
    def validation(cls, message: str, metadata: LLMCallMetadata) -> "ProviderRequestError":
        return cls(message, metadata, code="provider_validation")

    @classmethod
    def request_too_large(cls, message: str, metadata: LLMCallMetadata) -> "ProviderRequestError":
        # Raised before any transport: the document was not sent. Kept distinct from
        # provider_validation so the UI does not blame the AI's response.
        return cls(message, metadata, code="provider_request_too_large")


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_metadata(*, provider_kind: str, provider_name: str, model_id: str, transport: str, fallback_to_none: bool = False, thinking_mode: str | None = None) -> LLMCallMetadata:
    return LLMCallMetadata(
        provider_kind=provider_kind,
        provider_name=provider_name,
        model_id=model_id,
        transport=transport,
        requested_at=_now_utc_iso(),
        trace_id=f"llm-{uuid4()}",
        fallback_to_none=fallback_to_none,
        thinking_mode=thinking_mode,
    )


class NoneProvider:
    provider_name = "none"
    provider_kind = "none"

    def generate(self, req: LLMRequest) -> LLMResponse:
        metadata = _new_metadata(
            provider_kind=self.provider_kind,
            provider_name=self.provider_name,
            model_id="none",
            transport="none",
        )
        raise ProviderDisabledError(
            "AI is disabled. Set SUI_LLM_PROVIDER to local or large-scale.",
            metadata,
        )


class LocalProvider:
    provider_name = "local"
    provider_kind = "local"

    def generate(self, req: LLMRequest) -> LLMResponse:
        # ADR-0065: resolve model per task + request override.
        model_id = resolve_model_for_task(req.task, req)
        return _generate_via_http(
            req,
            base_url=settings.local_llm_base_url,
            model_id=model_id,
            provider_kind=self.provider_kind,
            provider_name=self.provider_name,
            missing_base_url_message="SUI_LOCAL_LLM_BASE_URL is not set",
            missing_model_message=None,
        )


class LargeScaleProvider:
    provider_name = "large-scale"
    provider_kind = "large-scale"

    def generate(self, req: LLMRequest) -> LLMResponse:
        if not settings.llm_large_scale_opt_in:
            metadata = _new_metadata(
                provider_kind=self.provider_kind,
                provider_name=self.provider_name,
                model_id=settings.large_scale_llm_model or "unknown",
                transport="http",
            )
            raise ProviderRequestError.unavailable("Large-scale provider requires explicit opt-in", metadata)

        if not settings.llm_escalation_enabled:
            metadata = _new_metadata(
                provider_kind=self.provider_kind,
                provider_name=self.provider_name,
                model_id=settings.large_scale_llm_model or "unknown",
                transport="http",
            )
            raise ProviderRequestError.unavailable("Large-scale provider disabled by local-first policy", metadata)

        _ensure_large_scale_allowlist()
        return _generate_via_http(
            req,
            base_url=settings.large_scale_llm_base_url,
            model_id=settings.large_scale_llm_model,
            provider_kind=self.provider_kind,
            provider_name=self.provider_name,
            missing_base_url_message="SUI_LARGE_SCALE_LLM_BASE_URL is not set",
            missing_model_message="SUI_LARGE_SCALE_LLM_MODEL is not set",
        )


def _normalize_allowlist(raw_allowlist: str | None) -> set[str]:
    if not raw_allowlist:
        return set()
    return {item.strip().lower() for item in raw_allowlist.split(",") if item.strip()}


def _ensure_large_scale_allowlist() -> None:
    base_url = settings.large_scale_llm_base_url
    allowlist = _normalize_allowlist(settings.large_scale_llm_allowlist)
    metadata = _new_metadata(
        provider_kind="large-scale",
        provider_name="large-scale",
        model_id=settings.large_scale_llm_model or "unknown",
        transport="http",
    )

    if not base_url:
        raise ProviderRequestError.unavailable("SUI_LARGE_SCALE_LLM_BASE_URL is not set", metadata)

    hostname = (urlparse(base_url).hostname or "").lower()
    if hostname == "":
        raise ProviderRequestError.validation("SUI_LARGE_SCALE_LLM_BASE_URL is invalid", metadata)
    if hostname not in allowlist:
        raise ProviderRequestError.unavailable("Large-scale destination is not allowlisted", metadata)


def _parse_http_provider_response(
    response_body: bytes,
    *,
    provider_name: str,
    metadata: LLMCallMetadata,
) -> str:
    if len(response_body) > MAX_LLM_PROVIDER_RESPONSE_BYTES:
        raise ProviderRequestError.validation(
            f"{provider_name} response exceeded the size limit",
            metadata,
        )
    try:
        body = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProviderRequestError.validation(
            f"{provider_name} response was not valid JSON",
            metadata,
        ) from None
    if not isinstance(body, dict) or set(body) != {"text"}:
        raise ProviderRequestError.validation(
            f"{provider_name} response had an invalid shape",
            metadata,
        )
    text = body["text"]
    if not isinstance(text, str):
        raise ProviderRequestError.validation(
            f"{provider_name} response missing text field",
            metadata,
        )
    return text


def _serialize_http_provider_request(
    req: LLMRequest,
    *,
    model_id: str | None,
    provider_name: str,
    metadata: LLMCallMetadata,
) -> bytes:
    if (
        not isinstance(req.task, str)
        or len(req.task) > MAX_LLM_TASK_LENGTH
        or not _LLM_TASK.fullmatch(req.task)
    ):
        raise ProviderRequestError.validation(
            f"{provider_name} request had an invalid task",
            metadata,
        )
    if not isinstance(req.prompt, str) or not req.prompt:
        raise ProviderRequestError.validation(
            f"{provider_name} request had an invalid prompt",
            metadata,
        )
    if (
        not isinstance(req.temperature, (int, float))
        or isinstance(req.temperature, bool)
        or not math.isfinite(req.temperature)
        or not 0 <= req.temperature <= 2
        or not isinstance(req.max_tokens, int)
        or isinstance(req.max_tokens, bool)
        or not 1 <= req.max_tokens <= MAX_LLM_OUTPUT_TOKENS
    ):
        raise ProviderRequestError.validation(
            f"{provider_name} request had invalid generation parameters",
            metadata,
        )
    try:
        serialized = json.dumps(
            {
                "task": req.task,
                "prompt": req.prompt,
                "temperature": req.temperature,
                "max_tokens": req.max_tokens,
                "model": model_id,
            },
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError):
        raise ProviderRequestError.validation(
            f"{provider_name} request could not be serialized",
            metadata,
        ) from None
    if len(serialized) > MAX_LLM_PROVIDER_REQUEST_BYTES:
        raise ProviderRequestError.request_too_large(
            f"{provider_name} request exceeded the size limit",
            metadata,
        )
    return serialized


def _generate_via_http(
    req: LLMRequest,
    *,
    base_url: str | None,
    model_id: str | None,
    provider_kind: str,
    provider_name: str,
    missing_base_url_message: str,
    missing_model_message: str | None,
) -> LLMResponse:
    resolved_model = model_id or "unknown"
    metadata = _new_metadata(
        provider_kind=provider_kind,
        provider_name=provider_name,
        model_id=resolved_model,
        transport="http",
    )

    if not base_url:
        raise ProviderRequestError.unavailable(missing_base_url_message, metadata)
    if missing_model_message is not None and not model_id:
        raise ProviderRequestError.unavailable(missing_model_message, metadata)

    endpoint = f"{base_url.rstrip('/')}/generate"
    payload = _serialize_http_provider_request(
        req,
        model_id=model_id,
        provider_name=provider_name,
        metadata=metadata,
    )
    req_obj = request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with open_trusted_http(req_obj, timeout_seconds=60) as resp:
            response_body = resp.read(MAX_LLM_PROVIDER_RESPONSE_BYTES + 1)
    except error.HTTPError as exc:
        if exc.code in (408, 504):
            raise ProviderRequestError.timeout(f"{provider_name} request timed out with status {exc.code}", metadata) from exc
        raise ProviderRequestError.unavailable(f"{provider_name} request failed with status {exc.code}", metadata) from exc
    except error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, socket.timeout):
            raise ProviderRequestError.timeout(f"{provider_name} request timed out", metadata) from exc
        logger.warning("%s request failed: %s", provider_name, reason, exc_info=True)
        raise ProviderRequestError.unavailable(f"{provider_name} request failed", metadata) from exc
    except TimeoutError as exc:
        raise ProviderRequestError.timeout(
            f"{provider_name} request timed out",
            metadata,
        ) from exc
    except OSError as exc:
        raise ProviderRequestError.unavailable(
            f"{provider_name} request failed",
            metadata,
        ) from exc

    text = _parse_http_provider_response(
        response_body,
        provider_name=provider_name,
        metadata=metadata,
    )
    return LLMResponse(raw_text=text, metadata=metadata)


class DeepSeekProvider:
    provider_name = "deepseek"
    provider_kind = "deepseek"

    def generate(self, req: LLMRequest) -> LLMResponse:
        from sui_sensemaking_api.settings import settings

        if not settings.deepseek_api_key:
            metadata = _new_metadata(
                provider_kind=self.provider_kind,
                provider_name=self.provider_name,
                model_id=settings.deepseek_model,
                transport="http",
            )
            raise ProviderRequestError.unavailable(
                "SUI_DEEPSEEK_API_KEY is required for deepseek provider",
                metadata,
            )

        model_id = resolve_model_for_task(req.task, req)
        # If the resolved model doesn't look like a DeepSeek model, use the default.
        if model_id == settings.local_llm_model or model_id == "default":
            model_id = settings.deepseek_model

        return _generate_via_openai_chat(
            req,
            base_url=settings.deepseek_base_url.rstrip("/"),
            model_id=model_id,
            api_key=settings.deepseek_api_key,
            provider_name=self.provider_name,
            provider_kind=self.provider_kind,
            thinking_mode=resolve_thinking_mode_for_task(req.task),
        )


class RegisteredHTTPProvider:
    """Registry-bound local/large-scale provider for a single model."""

    def __init__(self, config: RegisteredProviderConfig, *, provider_kind: str) -> None:
        self.provider_name = config.provider_id
        self.provider_kind = provider_kind
        self._base_url = config.base_url
        self._model_id = config.model_id

    def generate(self, req: LLMRequest) -> LLMResponse:
        return _generate_via_http(
            req,
            base_url=self._base_url,
            model_id=self._model_id,
            provider_kind=self.provider_kind,
            provider_name=self.provider_name,
            missing_base_url_message="Registered provider destination is unavailable",
            missing_model_message="Registered provider model is unavailable",
        )


class RegisteredDeepSeekProvider:
    """Registry-bound DeepSeek transport without persisting or exposing its key."""

    provider_kind = "deepseek"

    def __init__(self, config: RegisteredProviderConfig, *, api_key: str) -> None:
        self.provider_name = config.provider_id
        self._base_url = config.base_url
        self._model_id = config.model_id
        self._api_key = api_key

    def generate(self, req: LLMRequest) -> LLMResponse:
        if not self._base_url:
            metadata = _new_metadata(
                provider_kind=self.provider_kind,
                provider_name=self.provider_name,
                model_id=self._model_id,
                transport="http",
            )
            raise ProviderRequestError.unavailable(
                "Registered provider destination is unavailable",
                metadata,
            )
        return _generate_via_openai_chat(
            req,
            base_url=self._base_url,
            model_id=self._model_id,
            api_key=self._api_key,
            provider_name=self.provider_name,
            provider_kind=self.provider_kind,
            thinking_mode=resolve_thinking_mode_for_task(req.task),
        )


_REGISTERED_PROVIDER_KIND_ALIASES = {
    "local_http": "local",
    "large_scale": "large-scale",
    "external": "large-scale",
}
_REGISTERED_ENV_API_KEY_REFS = frozenset({"SUI_DEEPSEEK_API_KEY"})


def canonical_registered_provider_kind(raw_kind: str) -> str:
    normalized = raw_kind.strip().lower()
    return _REGISTERED_PROVIDER_KIND_ALIASES.get(normalized, normalized)


def registered_api_key_ref_supported(api_key_ref: str | None) -> bool:
    return (
        api_key_ref is None
        or api_key_ref in _REGISTERED_ENV_API_KEY_REFS
        or bool(api_key_ref.startswith("secret:"))
    )


def _resolve_registered_api_key(api_key_ref: str | None) -> str | None:
    if (
        api_key_ref is None
        or api_key_ref.startswith("secret:")
        or api_key_ref not in _REGISTERED_ENV_API_KEY_REFS
    ):
        # Secret-manager integration is deliberately not guessed. Until an
        # adapter is configured, a secret: reference remains unavailable.
        return None
    value = os.environ.get(api_key_ref)
    if value is None and api_key_ref == "SUI_DEEPSEEK_API_KEY":
        # Pydantic settings may have loaded this from an env file before a test
        # or embedding host normalised process.environ.
        value = settings.deepseek_api_key
    if (
        value is None
        or not value
        or any(character.isspace() for character in value)
        or any(not character.isprintable() for character in value)
    ):
        return None
    return value


def build_registered_provider(config: RegisteredProviderConfig) -> LLMProvider:
    """Resolve registry providerId -> transport, failing closed on bad config."""
    kind = canonical_registered_provider_kind(config.provider_kind)
    base_url = config.base_url
    if base_url is None and kind == "local" and canonical_registered_provider_kind(
        settings.llm_provider
    ) == "local":
        base_url = settings.local_llm_base_url
    if base_url is None and kind == "deepseek" and canonical_registered_provider_kind(
        settings.llm_provider
    ) == "deepseek":
        base_url = settings.deepseek_base_url
    effective_config = RegisteredProviderConfig(
        provider_id=config.provider_id,
        provider_kind=config.provider_kind,
        base_url=base_url,
        api_key_ref=config.api_key_ref,
        model_id=config.model_id,
    )
    metadata = _new_metadata(
        provider_kind=kind or "unknown",
        provider_name=config.provider_id,
        model_id=config.model_id,
        transport="none" if kind not in {"local", "large-scale", "deepseek"} else "http",
    )
    if kind not in {"local", "large-scale", "deepseek"}:
        raise ProviderRequestError.unavailable(
            "Registered provider kind is unsupported",
            metadata,
        )
    if base_url is None:
        raise ProviderRequestError.unavailable(
            "Registered provider destination is unavailable",
            metadata,
        )
    try:
        _validate_trusted_http_endpoint(
            endpoint=base_url,
            endpoint_key="registered provider base URL",
        )
    except ValueError:
        raise ProviderRequestError.unavailable(
            "Registered provider destination is unavailable",
            metadata,
        ) from None

    if kind == "deepseek":
        api_key = _resolve_registered_api_key(config.api_key_ref)
        if api_key is None:
            raise ProviderRequestError.unavailable(
                "Registered provider credential is unavailable",
                metadata,
            )
        return RegisteredDeepSeekProvider(effective_config, api_key=api_key)

    if kind == "large-scale":
        if not settings.llm_large_scale_opt_in or not settings.llm_escalation_enabled:
            raise ProviderRequestError.unavailable(
                "Registered large-scale provider is disabled by policy",
                metadata,
            )
        hostname = (urlparse(base_url).hostname or "").lower()
        if hostname not in _normalize_allowlist(settings.large_scale_llm_allowlist):
            raise ProviderRequestError.unavailable(
                "Registered large-scale destination is not allowlisted",
                metadata,
            )

    return RegisteredHTTPProvider(effective_config, provider_kind=kind)


def registered_provider_available(config: RegisteredProviderConfig) -> bool:
    try:
        build_registered_provider(config)
    except ProviderRequestError:
        return False
    return True


def _openai_chat_messages(req: LLMRequest) -> list[dict[str, str]]:
    """Build the exact system+user message content sent by chat transports."""
    system_prompt = (
        f"You are performing the task: {req.task}. "
        "Respond with only the requested output, no preamble."
    )
    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": req.prompt},
    ]


def _generate_via_openai_chat(
    req: LLMRequest,
    *,
    base_url: str,
    model_id: str,
    api_key: str,
    provider_name: str,
    provider_kind: str,
    thinking_mode: str,
) -> LLMResponse:
    metadata = _new_metadata(
        provider_kind=provider_kind,
        provider_name=provider_name,
        model_id=model_id,
        transport="http",
        thinking_mode=thinking_mode,
    )

    if (
        not isinstance(req.task, str)
        or len(req.task) > MAX_LLM_TASK_LENGTH
        or not _LLM_TASK.fullmatch(req.task)
    ):
        raise ProviderRequestError.validation(
            f"{provider_name} request had an invalid task",
            metadata,
        )
    if not isinstance(req.prompt, str) or not req.prompt:
        raise ProviderRequestError.validation(
            f"{provider_name} request had an invalid prompt",
            metadata,
        )
    if (
        not isinstance(req.temperature, (int, float))
        or isinstance(req.temperature, bool)
        or not math.isfinite(req.temperature)
        or not 0 <= req.temperature <= 2
    ):
        raise ProviderRequestError.validation(
            f"{provider_name} request had invalid temperature",
            metadata,
        )
    if (
        not isinstance(req.max_tokens, int)
        or isinstance(req.max_tokens, bool)
        or not 1 <= req.max_tokens <= MAX_LLM_OUTPUT_TOKENS
    ):
        raise ProviderRequestError.validation(
            f"{provider_name} request had invalid max_tokens",
            metadata,
        )

    payload = {
        "model": model_id,
        "messages": _openai_chat_messages(req),
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
        "stream": False,
        "thinking": {"type": thinking_mode},
    }
    serialized = json.dumps(payload, allow_nan=False, ensure_ascii=False).encode("utf-8")
    if len(serialized) > MAX_LLM_PROVIDER_REQUEST_BYTES:
        raise ProviderRequestError.request_too_large(
            f"{provider_name} request exceeded the size limit",
            metadata,
        )

    endpoint = f"{base_url.rstrip('/')}/v1/chat/completions"
    req_obj = request.Request(
        endpoint,
        data=serialized,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with open_trusted_http(req_obj, timeout_seconds=120) as resp:
            response_body = resp.read(MAX_LLM_PROVIDER_RESPONSE_BYTES + 1)
    except error.HTTPError as exc:
        if exc.code == 401 or exc.code == 403:
            raise ProviderRequestError.unavailable(
                f"{provider_name} authentication failed (HTTP {exc.code})",
                metadata,
            ) from exc
        if exc.code in (408, 504):
            raise ProviderRequestError.timeout(
                f"{provider_name} request timed out with status {exc.code}",
                metadata,
            ) from exc
        raise ProviderRequestError.unavailable(
            f"{provider_name} request failed with status {exc.code}",
            metadata,
        ) from exc
    except error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, socket.timeout):
            raise ProviderRequestError.timeout(
                f"{provider_name} request timed out",
                metadata,
            ) from exc
        logger.warning("%s request failed: %s", provider_name, reason, exc_info=True)
        raise ProviderRequestError.unavailable(
            f"{provider_name} request failed",
            metadata,
        ) from exc
    except TimeoutError as exc:
        raise ProviderRequestError.timeout(
            f"{provider_name} request timed out",
            metadata,
        ) from exc
    except OSError as exc:
        raise ProviderRequestError.unavailable(
            f"{provider_name} request failed",
            metadata,
        ) from exc

    if len(response_body) > MAX_LLM_PROVIDER_RESPONSE_BYTES:
        raise ProviderRequestError.validation(
            f"{provider_name} response exceeded the size limit",
            metadata,
        )
    try:
        body = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProviderRequestError.validation(
            f"{provider_name} response was not valid JSON",
            metadata,
        ) from None

    if not isinstance(body, dict):
        raise ProviderRequestError.validation(
            f"{provider_name} response had an invalid shape",
            metadata,
        )

    # OpenAI chat completions format: {"choices": [{"message": {"content": "..."}}]}
    choices = body.get("choices")
    if not isinstance(choices, list) or len(choices) == 0:
        raise ProviderRequestError.validation(
            f"{provider_name} response missing choices",
            metadata,
        )
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ProviderRequestError.validation(
            f"{provider_name} response missing message",
            metadata,
        )
    content = message.get("content")
    if not isinstance(content, str):
        raise ProviderRequestError.validation(
            f"{provider_name} response missing content",
            metadata,
        )

    # OPS-LLM-COST-01 (段階2): OpenAI chat-completions `usage` carries the
    # actual input/output tokens. Tolerate a missing/odd-shaped usage — the
    # response is still valid; the counter then records 0 tokens for this call.
    usage = body.get("usage")
    input_tokens: int | None = None
    output_tokens: int | None = None
    if isinstance(usage, dict):
        raw_in = usage.get("prompt_tokens")
        raw_out = usage.get("completion_tokens")
        if isinstance(raw_in, int) and raw_in >= 0:
            input_tokens = raw_in
        if isinstance(raw_out, int) and raw_out >= 0:
            output_tokens = raw_out

    return LLMResponse(
        raw_text=content,
        metadata=metadata,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


class NoOpProvider(NoneProvider):
    """Explicit no-op provider for adapter registry wiring."""


ProviderFactory = Callable[[], LLMProvider]


class ProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, ProviderFactory] = {}
        self._aliases: dict[str, str] = {}

    def register(self, provider_name: str, factory: ProviderFactory, *, aliases: tuple[str, ...] = ()) -> None:
        normalized_name = provider_name.lower().strip()
        self._providers[normalized_name] = factory
        self._aliases[normalized_name] = normalized_name
        for alias in aliases:
            self._aliases[alias.lower().strip()] = normalized_name

    def resolve(self, raw_provider_name: str) -> LLMProvider:
        normalized = raw_provider_name.lower().strip()
        provider_name = self._aliases.get(normalized)
        if provider_name is None:
            metadata = _new_metadata(
                provider_kind="unknown",
                provider_name=normalized or "unknown",
                model_id="unknown",
                transport="none",
            )
            raise ProviderRequestError.unavailable(f"Unsupported SUI_LLM_PROVIDER: {raw_provider_name}", metadata)
        return self._providers[provider_name]()


def _build_default_registry() -> ProviderRegistry:
    registry = ProviderRegistry()
    registry.register("none", NoOpProvider)
    registry.register("local", LocalProvider, aliases=("local_http",))
    registry.register("large-scale", LargeScaleProvider, aliases=("large_scale", "external"))
    registry.register("deepseek", DeepSeekProvider)
    return registry


_DEFAULT_REGISTRY = _build_default_registry()




def build_audit_fields(llm_response: object) -> dict[str, object]:
    if hasattr(llm_response, "as_audit_fields"):
        return getattr(llm_response, "as_audit_fields")()

    metadata = getattr(llm_response, "metadata", None)
    return {
        "provider": getattr(llm_response, "provider", getattr(metadata, "provider_name", "unknown")),
        "provider_kind": getattr(metadata, "provider_kind", "unknown"),
        "model_id": getattr(metadata, "model_id", "unknown"),
        "transport": getattr(llm_response, "transport", getattr(metadata, "transport", "unknown")),
        "requested_at": getattr(metadata, "requested_at", "unknown"),
        "fallback_to_none": getattr(metadata, "fallback_to_none", False),
        "execution_path": getattr(metadata, "execution_path", "primary"),
        "trace_id": getattr(llm_response, "trace_id", getattr(metadata, "trace_id", "unknown")),
    }


def get_provider() -> LLMProvider:
    return _DEFAULT_REGISTRY.resolve(settings.llm_provider)


def _llm_provider_stop_switch_engaged() -> bool:
    """SUI_LLM_PROVIDER=none is an unconditional stop switch for LLM calls.

    A registry-selected model must not reach its transport while the process
    is set to `none`, even when that model's own providerKind is fully
    configured. The contract is fixed in api.md (AI-MODEL-GOVERNANCE-03) and
    llm_provider_spec.md (none is an unconditional kill switch).
    """
    return settings.llm_provider.strip().lower() == "none"


def generate_with_fallback(
    req: LLMRequest,
    *,
    provider: LLMProvider | None = None,
) -> LLMResponse:
    if provider is None:
        if req.registered_provider is not None and not _llm_provider_stop_switch_engaged():
            provider = build_registered_provider(req.registered_provider)
        else:
            # Under the stop switch this resolves to NoOpProvider, whose generate()
            # raises ProviderDisabledError before any transport is built, any
            # credential is resolved, or any request leaves the process.
            provider = get_provider()
    # OPS-LLM-COST-01 (段階2): count every request that reaches a provider so an
    # operator can see external (large-scale) call volume; counting the attempt
    # (before any provider error) is what cost control needs. Token usage is
    # recorded after a successful generate; reporting coverage distinguishes a
    # genuine provider-reported zero from partial/missing usage metadata.
    _record_llm_call(provider.provider_kind)
    try:
        response = provider.generate(req)
    except ProviderRequestError as exc:
        if exc.code in ("provider_validation", "provider_request_too_large") or not settings.llm_fallback_to_none:
            raise
        fallback_metadata = LLMCallMetadata(
            provider_kind="none",
            provider_name="none",
            model_id="none",
            transport="none",
            requested_at=_now_utc_iso(),
            trace_id=exc.metadata.trace_id,
            fallback_to_none=True,
            execution_path=f"{exc.metadata.provider_name}->none",
        )
        raise ProviderDisabledError(
            f"LLM provider '{exc.metadata.provider_name}' failed ({exc.code}) and fallbacked to none",
            fallback_metadata,
        ) from exc
    _record_llm_usage(
        provider.provider_kind,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
    )
    return response
