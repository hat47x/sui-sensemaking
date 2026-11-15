from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Literal, Protocol, cast
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import HTTPException

from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tenant_context import TenantContext
from sui_sensemaking_api.trusted_http import open_trusted_http

logger = logging.getLogger(__name__)

AccessAction = Literal["read", "write", "export", "share"]
Visibility = Literal["Public", "Unlisted", "Org", "Restricted"]
FailSafeMode = Literal["deny", "read_only"]
FailSafeReason = Literal[
    "safe_mode",
    "read_only",
    "tenant_context_missing",
    "resource_tenant_missing",
    "tenant_mismatch",
    "policy_ref_missing",
    "policy_ref_unreachable",
    "policy_ref_invalid",
    "adapter_error",
    "adapter_missing",
]
MAX_ACCESS_CONTROL_RESPONSE_BYTES = 64 * 1024
MAX_ACCESS_CONTROL_REQUEST_BYTES = 64 * 1024
MAX_ACCESS_CONTROL_REASON_LENGTH = 512
MAX_ACCESS_CONTROL_IDENTIFIER_LENGTH = 256
MAX_ACCESS_CONTROL_POLICY_REF_LENGTH = 2048
MAX_ACCESS_CONTROL_ATTRIBUTE_COUNT = 64
_ACCESS_CONTROL_RESPONSE_FIELDS = {"allow", "readOnly", "reason"}


@dataclass(frozen=True)
class AuthContext:
    actor_ref: str | None
    user_id: str | None = None
    provider: str | None = None
    external_uid: str | None = None
    roles: tuple[str, ...] = ()
    groups: tuple[str, ...] = ()
    trace_id: str | None = None
    amr: str | None = None
    acr: str | None = None
    aal: str | None = None
    auth_time: str | None = None


@dataclass(frozen=True)
class AccessSubject:
    """Public API alias for AuthContext-compatible subject reference."""
    actor_ref: str | None = None
    roles: tuple[str, ...] = ()
    groups: tuple[str, ...] = ()


@dataclass(frozen=True)
class AccessResource:
    doc_id: str
    visibility: Visibility | None = None
    policy_ref: str | None = None
    tenant_id: str | None = None
    kind: str = "document"


@dataclass(frozen=True)
class AccessRequest:
    action: AccessAction
    auth: AuthContext | None = None
    resource: AccessResource | None = None
    tenant: TenantContext | None = None
    safe_mode: bool = False
    read_only: bool = False
    subject: AccessSubject | None = None


@dataclass(frozen=True)
class AccessDecision:
    allow: bool
    read_only: bool = False
    reason: FailSafeReason | str | None = None


class AccessControlAdapter(Protocol):
    """Externalized authorization adapter contract.

    The adapter can call external RBAC/ABAC engines. Application core must not
    embed role/group/policy evaluation logic.
    """

    name: str

    def authorize(self, request: AccessRequest) -> AccessDecision:
        ...


class AccessControlUnreachableError(RuntimeError):
    """External policy endpoint is unreachable (timeout/DNS/network)."""


class AccessControlInvalidPolicyError(ValueError):
    """Policy ref is invalid/expired/failed verification."""


class AccessControlInvalidRequestError(ValueError):
    """Server-composed policy request is unsafe to transmit."""


class NoopAccessControlAdapter:
    name = "noop"

    def authorize(self, request: AccessRequest) -> AccessDecision:  # noqa: ARG002
        return AccessDecision(allow=True)


class MockAccessControlAdapter:
    """Deterministic adapter for contract/integration tests.

    This adapter is intentionally simple and only exists to validate the
    AccessControlAdapter I/F wiring. Production RBAC/ABAC logic must remain
    external.
    """

    name = "mock"

    def __init__(self, *, mock_allow: bool = True, mock_reason: str = "mock") -> None:
        self._mock_allow = mock_allow
        self._mock_reason = mock_reason

    def authorize(self, request: AccessRequest) -> AccessDecision:
        if not self._mock_allow:
            return AccessDecision(allow=False, reason=self._mock_reason)
        token = request.resource.policy_ref
        if token == "mock:deny":
            return AccessDecision(allow=False, reason="mock_deny")
        if token == "mock:read_only":
            return AccessDecision(allow=True, read_only=True, reason="mock_read_only")
        return AccessDecision(allow=True)


AdapterAuthMode = Literal["none", "oidc", "saml"]


@dataclass(frozen=True)
class ExternalPolicyAdapterConfig:
    endpoint: str
    timeout_seconds: float = 1.5
    auth_mode: AdapterAuthMode = "none"
    static_bearer_token: str | None = None
    idp_issuer: str | None = None


def _parse_external_policy_response(response_body: bytes) -> AccessDecision:
    if len(response_body) > MAX_ACCESS_CONTROL_RESPONSE_BYTES:
        raise AccessControlInvalidPolicyError(
            "policy adapter response exceeds the size limit"
        )
    try:
        decoded = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise AccessControlInvalidPolicyError(
            "policy adapter response is not valid JSON"
        ) from None
    if (
        not isinstance(decoded, dict)
        or "allow" not in decoded
        or not set(decoded).issubset(_ACCESS_CONTROL_RESPONSE_FIELDS)
    ):
        raise AccessControlInvalidPolicyError(
            "policy adapter response has an invalid shape"
        )

    allow = decoded["allow"]
    if not isinstance(allow, bool):
        raise AccessControlInvalidPolicyError(
            "policy adapter response missing boolean allow"
        )

    read_only = decoded.get("readOnly", False)
    if not isinstance(read_only, bool):
        raise AccessControlInvalidPolicyError(
            "policy adapter readOnly must be boolean"
        )

    reason = decoded.get("reason")
    if reason is not None and (
        not isinstance(reason, str)
        or len(reason) > MAX_ACCESS_CONTROL_REASON_LENGTH
        or any(not character.isprintable() for character in reason)
    ):
        raise AccessControlInvalidPolicyError(
            "policy adapter reason must be a bounded plain string"
        )

    return AccessDecision(allow=allow, read_only=read_only, reason=reason)


def _validate_policy_request_string(
    value: object,
    *,
    max_length: int = MAX_ACCESS_CONTROL_IDENTIFIER_LENGTH,
    optional: bool = True,
) -> None:
    if value is None and optional:
        return
    if (
        not isinstance(value, str)
        or not value
        or len(value) > max_length
        or value.strip() != value
        or any(not character.isprintable() for character in value)
    ):
        raise AccessControlInvalidRequestError(
            "policy adapter request contains an invalid server-composed value"
        )


def _validate_policy_attributes(values: object) -> None:
    if not isinstance(values, tuple) or len(values) > MAX_ACCESS_CONTROL_ATTRIBUTE_COUNT:
        raise AccessControlInvalidRequestError(
            "policy adapter request contains an invalid attribute set"
        )
    for value in values:
        _validate_policy_request_string(value, optional=False)
    if len(set(values)) != len(values):
        raise AccessControlInvalidRequestError(
            "policy adapter request contains an invalid attribute set"
        )


def _serialize_external_policy_request(
    request: AccessRequest,
    *,
    auth_source: AuthContext,
    subject_key: str,
) -> bytes:
    if (
        request.action not in {"read", "write", "export", "share"}
        or not isinstance(request.safe_mode, bool)
        or not isinstance(request.read_only, bool)
    ):
        raise AccessControlInvalidRequestError(
            "policy adapter request has invalid control fields"
        )
    _validate_policy_request_string(auth_source.actor_ref)
    _validate_policy_request_string(auth_source.user_id)
    _validate_policy_request_string(auth_source.provider)
    _validate_policy_request_string(auth_source.external_uid)
    _validate_policy_request_string(auth_source.trace_id)
    _validate_policy_request_string(auth_source.amr)
    _validate_policy_request_string(auth_source.acr)
    _validate_policy_request_string(auth_source.aal)
    _validate_policy_request_string(auth_source.auth_time)
    _validate_policy_attributes(auth_source.roles)
    _validate_policy_attributes(auth_source.groups)

    resource_source = request.resource
    if resource_source is None:
        raise AccessControlInvalidRequestError(
            "policy adapter request requires a resource"
        )
    _validate_policy_request_string(resource_source.doc_id, optional=False)
    if resource_source.visibility not in {
        None,
        "Public",
        "Unlisted",
        "Org",
        "Restricted",
    }:
        raise AccessControlInvalidRequestError(
            "policy adapter request has invalid resource visibility"
        )
    _validate_policy_request_string(
        resource_source.policy_ref,
        max_length=MAX_ACCESS_CONTROL_POLICY_REF_LENGTH,
    )
    _validate_policy_request_string(resource_source.tenant_id)
    _validate_policy_request_string(resource_source.kind, optional=False)

    auth_payload: dict[str, object] = {
        "actorRef": auth_source.actor_ref,
        "roles": list(auth_source.roles),
        "groups": list(auth_source.groups),
    }
    for key, value in (
        ("traceId", auth_source.trace_id),
        ("userId", auth_source.user_id),
        ("provider", auth_source.provider),
        ("externalUid", auth_source.external_uid),
        ("amr", auth_source.amr),
        ("acr", auth_source.acr),
        ("aal", auth_source.aal),
        ("authTime", auth_source.auth_time),
    ):
        if value is not None:
            auth_payload[key] = value

    resource_payload: dict[str, object] = {
        "docId": resource_source.doc_id,
        "visibility": resource_source.visibility,
        "policyRef": resource_source.policy_ref,
    }
    if resource_source.tenant_id is not None:
        resource_payload["tenantId"] = resource_source.tenant_id
        resource_payload["kind"] = resource_source.kind

    payload: dict[str, object] = {
        "action": request.action,
        subject_key: auth_payload,
        "resource": resource_payload,
        "safeMode": request.safe_mode,
        "readOnly": request.read_only,
    }
    if request.tenant is not None:
        _validate_policy_request_string(request.tenant.tenant_id, optional=False)
        _validate_policy_request_string(request.tenant.membership_id)
        _validate_policy_request_string(request.tenant.resolved_by, optional=False)
        payload["tenant"] = {
            "tenantId": request.tenant.tenant_id,
            "membershipId": request.tenant.membership_id,
            "resolvedBy": request.tenant.resolved_by,
        }
    try:
        body = json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise AccessControlInvalidRequestError(
            "policy adapter request could not be serialized"
        ) from None
    if len(body) > MAX_ACCESS_CONTROL_REQUEST_BYTES:
        raise AccessControlInvalidRequestError(
            "policy adapter request exceeds the size limit"
        )
    return body


class ExternalPolicyAccessControlAdapter:
    """HTTP bridge to enterprise policy engines behind OIDC/SAML SSO.

    RBAC/ABAC evaluation remains external; this adapter only forwards
    AccessRequest and validates the AccessDecision contract.
    """

    name = "external_http"

    def __init__(self, *, config: ExternalPolicyAdapterConfig):
        self._config = config

    def authorize(self, request: AccessRequest) -> AccessDecision:
        auth_source = request.auth
        subject_key = "auth"
        if auth_source is None and request.subject is not None:
            auth_source = AuthContext(
                actor_ref=request.subject.actor_ref,
                roles=request.subject.roles,
                groups=request.subject.groups,
            )
            subject_key = "subject"

        if auth_source is None:
            raise AccessControlInvalidRequestError(
                "policy adapter request requires an authenticated subject"
            )
        body = _serialize_external_policy_request(
            request,
            auth_source=auth_source,
            subject_key=subject_key,
        )

        headers = {
            "content-type": "application/json",
            "accept": "application/json",
            "x-acl-auth-mode": self._config.auth_mode,
        }
        if auth_source.trace_id:
            headers["x-trace-id"] = auth_source.trace_id
        if self._config.idp_issuer:
            headers["x-idp-issuer"] = self._config.idp_issuer
        if self._config.static_bearer_token:
            headers["authorization"] = f"Bearer {self._config.static_bearer_token}"

        outbound = urllib_request.Request(
            self._config.endpoint,
            data=body,
            headers=headers,
            method="POST",
        )

        try:
            with open_trusted_http(
                outbound,
                timeout_seconds=self._config.timeout_seconds,
            ) as response:
                response_body = response.read(MAX_ACCESS_CONTROL_RESPONSE_BYTES + 1)
        except urllib_error.HTTPError as exc:
            if exc.code in {400, 401, 403, 422}:
                raise AccessControlInvalidPolicyError("policy adapter rejected request") from exc
            raise AccessControlUnreachableError("policy adapter returned retryable error") from exc
        except urllib_error.URLError as exc:
            raise AccessControlUnreachableError("policy adapter unreachable") from exc
        except TimeoutError as exc:
            raise AccessControlUnreachableError("policy adapter timeout") from exc
        except OSError as exc:
            raise AccessControlUnreachableError("policy adapter unreachable") from exc

        return _parse_external_policy_response(response_body)


def _read_only_fallback(reason: FailSafeReason, *, action: AccessAction) -> AccessDecision:
    if action == "read":
        return AccessDecision(allow=True, read_only=True, reason=reason)
    return AccessDecision(allow=False, read_only=True, reason=reason)


def apply_local_failsafe(request: AccessRequest, mode: FailSafeMode) -> AccessDecision | None:
    """Local guardrails that do not interpret RBAC logic.

    Priority: safe_mode -> read_only -> policy_ref fail-safe.
    """

    if request.safe_mode and request.action in {"export", "share"}:
        return AccessDecision(allow=False, reason="safe_mode")

    if request.read_only and request.action in {"write", "export", "share"}:
        return AccessDecision(allow=False, read_only=True, reason="read_only")

    visibility = request.resource.visibility
    if visibility not in {"Org", "Restricted"}:
        return None

    if request.resource.policy_ref:
        return None

    if mode == "deny":
        return AccessDecision(allow=False, reason="policy_ref_missing")
    return _read_only_fallback("policy_ref_missing", action=request.action)


def apply_tenant_boundary_guard(
    request: AccessRequest,
    *,
    required: bool,
) -> AccessDecision | None:
    """Deny an unresolved or cross-tenant request before consulting a PDP.

    The guard is opt-in so existing single-tenant adapter contract callers remain
    compatible. Tenant-scoped API surfaces enable it after resolving both the
    trusted subject context and server-owned resource scope.
    """

    if not required:
        return None
    if request.tenant is None:
        return AccessDecision(allow=False, reason="tenant_context_missing")
    if request.resource is None or not request.resource.tenant_id:
        return AccessDecision(allow=False, reason="resource_tenant_missing")
    if request.tenant.tenant_id != request.resource.tenant_id:
        return AccessDecision(allow=False, reason="tenant_mismatch")
    return None


def apply_adapter_failsafe(
    *,
    request: AccessRequest,
    mode: FailSafeMode,
    reason: Literal["policy_ref_unreachable", "policy_ref_invalid", "adapter_error"],
) -> AccessDecision:
    if mode == "deny":
        return AccessDecision(allow=False, reason=reason)
    return _read_only_fallback(reason, action=request.action)


def resolve_access_decision(
    *,
    adapter: AccessControlAdapter,
    request: AccessRequest,
    fail_safe_mode: FailSafeMode,
    require_tenant_scope: bool = False,
) -> AccessDecision:
    # A Source Snapshot must not inherit the Document read_only fallback.
    # This guard is intentionally in the shared decision entrypoint, so a
    # future Source caller cannot bypass it by omitting the Reference wrapper.
    # It does NOT verify that principal or policy_ref came from a trusted Host.
    if request.resource is not None and request.resource.kind == "source_snapshot":
        require_tenant_scope = True
        fail_safe_mode = "deny"
        if (
            request.action != "read"
            or request.auth is None
            or not request.auth.actor_ref
            or not request.auth.provider
            or not request.resource.policy_ref
            or getattr(adapter, "name", None) in {"noop", "mock"}
        ):
            return AccessDecision(allow=False, reason="source_grant_unavailable")

    tenant_boundary = apply_tenant_boundary_guard(
        request,
        required=require_tenant_scope,
    )
    if tenant_boundary is not None:
        return tenant_boundary

    local = apply_local_failsafe(request, fail_safe_mode)
    if local is not None:
        return local

    try:
        decision = adapter.authorize(request)
    except AccessControlUnreachableError:
        return apply_adapter_failsafe(request=request, mode=fail_safe_mode, reason="policy_ref_unreachable")
    except AccessControlInvalidPolicyError:
        return apply_adapter_failsafe(request=request, mode=fail_safe_mode, reason="policy_ref_invalid")
    except AccessControlInvalidRequestError:
        return apply_adapter_failsafe(request=request, mode=fail_safe_mode, reason="adapter_error")
    except Exception:
        logger.warning("access control adapter raised an unexpected error; failing safe", exc_info=True)
        return apply_adapter_failsafe(request=request, mode=fail_safe_mode, reason="adapter_error")

    if not isinstance(decision, AccessDecision):
        return apply_adapter_failsafe(request=request, mode=fail_safe_mode, reason="adapter_error")

    return decision


def enforce_access(decision: AccessDecision, *, action: AccessAction) -> None:  # noqa: ARG001
    if decision.allow:
        return

    detail = "Access denied"
    if decision.reason:
        detail = f"Access denied: {decision.reason}"
    raise HTTPException(status_code=403, detail=detail)


def parse_csv_header(value: str | None) -> tuple[str, ...]:
    if value is None:
        return ()
    items = [item.strip() for item in value.split(",")]
    return tuple(item for item in items if item and item.lower() != "null")


def normalize_policy_ref(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized or normalized.lower() == "null":
        return None
    return normalized


def parse_visibility(value: str | None) -> Visibility | None:
    if value is None:
        return None
    normalized = value.strip()
    if normalized in {"Public", "Unlisted", "Org", "Restricted"}:
        return cast(Visibility, normalized)
    return None


def build_access_control_adapter(*, adapter_name: str, mock_allow: bool | None = None, mock_reason: str | None = None, http_endpoint: str | None = None, http_api_key: str | None = None, http_timeout_seconds: float | None = None) -> AccessControlAdapter:
    if adapter_name == "noop":
        return NoopAccessControlAdapter()
    if adapter_name in ("mock", "http", "external_http", "external"):
        pass  # handled below
    else:
        return NoopAccessControlAdapter()

    if adapter_name == "mock":
        return MockAccessControlAdapter(
            mock_allow=mock_allow if mock_allow is not None else True,
            mock_reason=mock_reason if mock_reason is not None else "mock",
        )

    endpoint = http_endpoint or _get_configured_endpoint()
    if endpoint is None:
        raise RuntimeError(
            "SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT is required "
            "for the external HTTP access-control adapter"
        )
    return ExternalPolicyAccessControlAdapter(
        config=ExternalPolicyAdapterConfig(
            endpoint=endpoint,
            timeout_seconds=http_timeout_seconds or settings.access_control_external_http_timeout_seconds,
            auth_mode=cast(AdapterAuthMode, settings.access_control_external_http_auth_mode),
            static_bearer_token=http_api_key or settings.access_control_external_http_static_bearer_token,
            idp_issuer=settings.access_control_external_http_idp_issuer,
        )
    )


def _get_configured_endpoint() -> str | None:
    return settings.access_control_external_http_endpoint
