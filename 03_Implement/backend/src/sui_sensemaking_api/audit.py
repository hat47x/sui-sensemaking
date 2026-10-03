from __future__ import annotations

import logging
import math
import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from typing import Literal, Protocol
from urllib import error, request
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator

from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.trusted_http import open_trusted_http

logger = logging.getLogger(__name__)

AuditEventType = Literal["view", "export", "query", "bundle", "proposal", "apply", "llm"]
MAX_AUDIT_EVENT_BYTES = 64 * 1024
MAX_AUDIT_METADATA_FIELDS = 32
MAX_AUDIT_METADATA_KEY_LENGTH = 128
MAX_AUDIT_METADATA_STRING_LENGTH = 1024
MAX_AUDIT_IDENTIFIER_LENGTH = 256
MAX_AUDIT_METADATA_NUMBER_ABS = 10**15
_REDACTED_VALUE = "[REDACTED]"
_TRUNCATED_VALUE = "[TRUNCATED]"
_RESERVED_METADATA_KEYS = frozenset({"tenantid"})


class AuditEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal[1] = 1
    eventId: str = Field(min_length=1, max_length=128)
    occurredAt: str = Field(min_length=1, max_length=64)
    eventType: AuditEventType
    tenantId: str = Field(min_length=1, max_length=MAX_AUDIT_IDENTIFIER_LENGTH)
    docId: str = Field(min_length=1, max_length=MAX_AUDIT_IDENTIFIER_LENGTH)
    safeMode: bool
    actorRefHash: str | None = Field(default=None, pattern=r"^[0-9a-f]{24}$")
    metadata: dict[str, str | int | float | bool | None] = Field(
        default_factory=dict,
        max_length=MAX_AUDIT_METADATA_FIELDS,
    )

    @field_validator("tenantId", "docId")
    @classmethod
    def _validate_identifier(cls, value: str) -> str:
        if value.strip() != value or any(
            ord(character) < 32 or ord(character) == 127 for character in value
        ):
            raise ValueError("audit identifiers must be canonical")
        return value

    @field_validator("metadata")
    @classmethod
    def _validate_metadata(
        cls,
        value: dict[str, str | int | float | bool | None],
    ) -> dict[str, str | int | float | bool | None]:
        for key, item in value.items():
            if _normalized_metadata_key(key) in _RESERVED_METADATA_KEYS:
                raise ValueError("audit tenantId must use the event envelope")
            if (
                not key
                or len(key) > MAX_AUDIT_METADATA_KEY_LENGTH
                or key.strip() != key
                or any(ord(character) < 32 or ord(character) == 127 for character in key)
            ):
                raise ValueError("audit metadata keys must be canonical")
            if isinstance(item, str) and len(item) > MAX_AUDIT_METADATA_STRING_LENGTH:
                raise ValueError("audit metadata strings exceed the size limit")
            if (
                isinstance(item, (int, float))
                and not isinstance(item, bool)
                and (
                    (isinstance(item, float) and not math.isfinite(item))
                    or abs(item) > MAX_AUDIT_METADATA_NUMBER_ABS
                )
            ):
                raise ValueError("audit metadata numbers exceed the supported range")
        return value


class AuditTransport(Protocol):
    name: str

    def send(self, event: AuditEvent) -> None:
        ...


class NoopAuditTransport:
    name = "noop"

    def send(self, event: AuditEvent) -> None:  # noqa: ARG002
        return


class HttpAuditTransport:
    name = "http"

    def __init__(self, endpoint: str, api_key: str | None = None, timeout_seconds: float = 2.0):
        self._endpoint = endpoint
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    def send(self, event: AuditEvent) -> None:
        payload = event.model_dump_json().encode("utf-8")
        if len(payload) > MAX_AUDIT_EVENT_BYTES:
            raise RuntimeError("audit event exceeds the outbound size limit")
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        req_obj = request.Request(
            self._endpoint,
            data=payload,
            headers=headers,
            method="POST",
        )
        try:
            with open_trusted_http(req_obj, timeout_seconds=self._timeout_seconds):
                return
        except error.HTTPError as exc:
            raise RuntimeError(f"audit transport failed with status {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"audit transport failed: {exc.reason}") from exc




CE4_AUDIT_SCHEMA_VERSION = "ce4.audit.v1"
CE4_AUDIT_REQUIRED_FIELDS: tuple[str, ...] = (
    "operation",
    "safeMode",
    "equivalenceKey",
    "bundleHash",
    "sourceBundleHash",
    "queryHash",
    "dryRun",
    "sideEffect",
    "rejectReasonCode",
    "command",
    "channel",
    "schemaVersion",
)


def normalize_ce4_audit_metadata(raw: dict[str, object]) -> dict[str, object]:
    """Return CE4 audit metadata with the stable contract fields only."""
    normalized: dict[str, object] = {}
    for key in CE4_AUDIT_REQUIRED_FIELDS:
        normalized[key] = raw.get(key)
    normalized["schemaVersion"] = CE4_AUDIT_SCHEMA_VERSION
    return normalized
SENSITIVE_EXACT_KEYS = {
    "text",
    "content",
    "name",
}
SENSITIVE_KEY_PARTS = {
    "prompt",
    "email",
    "token",
    "secret",
    "authorization",
    "cookie",
    "password",
    "credential",
    "assertion",
    "apikey",
    "clientsecret",
}


def resolve_ce4_query_hash(metadata: dict[str, object]) -> str | None:
    """Return CE4 query hash in canonical priority order."""
    canonical = metadata.get("queryCanonicalHash")
    if isinstance(canonical, str) and canonical:
        return canonical
    legacy = metadata.get("queryHash")
    if isinstance(legacy, str) and legacy:
        return legacy
    return None


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _mask_value(value: object) -> str | int | float | bool | None:
    if isinstance(value, str):
        if len(value) > MAX_AUDIT_METADATA_STRING_LENGTH:
            return _TRUNCATED_VALUE
        return value
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        if (
            (isinstance(value, float) and not math.isfinite(value))
            or abs(value) > MAX_AUDIT_METADATA_NUMBER_ABS
        ):
            return _REDACTED_VALUE
        return value
    return _REDACTED_VALUE


def _normalized_metadata_key(key: str) -> str:
    return "".join(character for character in key.lower() if character.isalnum())


def sanitize_metadata(raw: dict[str, object]) -> dict[str, str | int | float | bool | None]:
    sanitized: dict[str, str | int | float | bool | None] = {}
    for key, value in raw.items():
        if len(sanitized) >= MAX_AUDIT_METADATA_FIELDS:
            break
        if (
            not key
            or len(key) > MAX_AUDIT_METADATA_KEY_LENGTH
            or key.strip() != key
            or any(ord(character) < 32 or ord(character) == 127 for character in key)
        ):
            continue
        normalized_key = _normalized_metadata_key(key)
        if normalized_key in _RESERVED_METADATA_KEYS:
            continue
        if normalized_key in SENSITIVE_EXACT_KEYS or any(
            part in normalized_key for part in SENSITIVE_KEY_PARTS
        ):
            sanitized[key] = _REDACTED_VALUE
            continue
        sanitized[key] = _mask_value(value)
    return sanitized


def build_event(
    *,
    event_type: AuditEventType,
    tenant_id: str,
    doc_id: str,
    safe_mode: bool,
    actor_ref: str | None = None,
    metadata: dict[str, object] | None = None,
) -> AuditEvent:
    actor_ref_hash: str | None = None
    if actor_ref:
        actor_ref_hash = sha256(actor_ref.encode("utf-8")).hexdigest()[:24]

    return AuditEvent(
        eventId=f"audit-{uuid4()}",
        occurredAt=_now_utc_iso(),
        eventType=event_type,
        tenantId=tenant_id,
        docId=doc_id,
        safeMode=safe_mode,
        actorRefHash=actor_ref_hash,
        metadata=sanitize_metadata(metadata or {}),
    )


@dataclass
class AuditDispatchResult:
    sent: bool
    reason: str | None = None


class AuditDispatcher:
    """Fail-open dispatcher.

    方針は次のとおり。
    - 無効化時: 完全no-op（副作用ゼロ）
    - 送信失敗時: 本体処理は継続（fail-open）
    - 失敗イベントはメモリ内キューへ退避し、次回送信時にbest-effortでflush
    - キュー上限超過時は最古イベントをdrop
    """

    def __init__(
        self,
        *,
        enabled: bool,
        allow_in_safe_mode: bool,
        transport: AuditTransport,
        queue_size: int,
        dedup_window_seconds: float = 5.0,
    ):
        self._enabled = enabled
        self._allow_in_safe_mode = allow_in_safe_mode
        self._transport = transport
        # (event, dedup_key) pairs so a flush can release the pending key.
        self._queue: deque[tuple[AuditEvent, tuple[str, ...] | None]] = deque(maxlen=max(queue_size, 0))
        # SEC-AUDIT-DUP-01: bounded recent-emit dedup keyed on a caller-supplied
        # logical identity (tenant/doc/operation/hash). A client retry or
        # double-click that repeats the SAME logical operation within the window
        # is suppressed so the external audit sink is not double-counted.
        # Bounded (LRU) so it can never grow without limit (DX-BACKEND-CE4-01
        # concern applied); the window is short, so legitimately distinct events
        # are unaffected.
        self._dedup_window_seconds = max(dedup_window_seconds, 0.0)
        self._recent_emit_keys: OrderedDict[tuple[str, ...], float] = OrderedDict()
        self._recent_emit_max = 4096
        # Logical keys of events still pending delivery in the fail-open queue.
        # Mirrors the bounded queue (never grows beyond queue_size distinct keys),
        # so a retry of an as-yet-undelivered operation flushes the pending copy
        # instead of sending a second one.
        self._queued_dedup_keys: set[tuple[str, ...]] = set()

    @property
    def enabled(self) -> bool:
        return self._enabled

    def _is_recent_duplicate(self, key: tuple[str, ...]) -> bool:
        if self._dedup_window_seconds <= 0:
            return False
        now = time.time()
        # Opportunistically drop expired entries while we are here.
        expired = [k for k, at in self._recent_emit_keys.items() if now - at >= self._dedup_window_seconds]
        for k in expired:
            del self._recent_emit_keys[k]
        for seen_key, seen_at in self._recent_emit_keys.items():
            if seen_key == key and now - seen_at < self._dedup_window_seconds:
                self._recent_emit_keys.move_to_end(seen_key)
                return True
        return False

    def _record_emitted_key(self, key: tuple[str, ...]) -> None:
        self._recent_emit_keys[key] = time.time()
        self._recent_emit_keys.move_to_end(key)
        while len(self._recent_emit_keys) > self._recent_emit_max:
            self._recent_emit_keys.popitem(last=False)

    def emit(self, event: AuditEvent, *, dedup_key: tuple[str, ...] | None = None) -> AuditDispatchResult:
        if not self._enabled:
            return AuditDispatchResult(sent=False, reason="disabled")

        if event.safeMode and not self._allow_in_safe_mode:
            return AuditDispatchResult(sent=False, reason="safe_mode_blocked")

        # SEC-AUDIT-DUP-01: suppress a repeat of the SAME logical operation.
        # A retry whose key is still pending in the fail-open queue means the
        # first attempt never reached the sink: flush delivers that pending
        # copy instead of sending a second one. Otherwise a key emitted
        # successfully within the window is a duplicate (client retry /
        # double-click). Only successful sends record the key, so a failed
        # first attempt is not falsely deduped away.
        if dedup_key is not None and dedup_key in self._queued_dedup_keys:
            self._flush_queue()
            return AuditDispatchResult(sent=True, reason="queued_pending")
        if dedup_key is not None and self._is_recent_duplicate(dedup_key):
            return AuditDispatchResult(sent=False, reason="duplicate")

        if self._queue:
            self._flush_queue()

        try:
            self._transport.send(event)
        except Exception as exc:  # fail-open
            self._enqueue(event, dedup_key)
            logger.warning(
                "audit event send failed; keep fail-open",
                extra={
                    "eventType": event.eventType,
                    "tenantId": event.tenantId,
                    "docId": event.docId,
                    "transport": self._transport.name,
                    "queueLength": len(self._queue),
                    "error": str(exc),
                },
            )
            return AuditDispatchResult(sent=False, reason="send_failed")

        # Only a SUCCESSFUL send counts for dedup: a failed first attempt must
        # be retryable (the fail-open flush path is the recovery route).
        if dedup_key is not None:
            self._record_emitted_key(dedup_key)
        return AuditDispatchResult(sent=True)

    def _flush_queue(self) -> None:
        pending = list(self._queue)
        self._queue.clear()
        for queued, queued_key in pending:
            try:
                self._transport.send(queued)
                if queued_key is not None:
                    self._queued_dedup_keys.discard(queued_key)
            except Exception as exc:  # fail-open
                self._enqueue(queued, queued_key)
                logger.warning(
                    "audit event flush failed; keep fail-open",
                    extra={
                        "eventType": queued.eventType,
                        "tenantId": queued.tenantId,
                        "docId": queued.docId,
                        "transport": self._transport.name,
                        "queueLength": len(self._queue),
                        "error": str(exc),
                    },
                )
                break

    def _enqueue(self, event: AuditEvent, dedup_key: tuple[str, ...] | None = None) -> None:
        if dedup_key is not None:
            self._queued_dedup_keys.add(dedup_key)
        before = len(self._queue)
        self._queue.append((event, dedup_key))
        after = len(self._queue)
        dropped = before == after and after > 0
        if dropped:
            # The oldest event was evicted; drop any pending key it carried so
            # the pending-key set stays aligned with the bounded queue.
            current_keys = {key for _, key in self._queue if key is not None}
            self._queued_dedup_keys.intersection_update(current_keys)
            logger.warning(
                "audit queue is full; dropped oldest event",
                extra={
                    "queueSize": after,
                    "eventType": event.eventType,
                    "tenantId": event.tenantId,
                    "docId": event.docId,
                },
            )


def build_audit_dispatcher() -> AuditDispatcher:
    enabled = settings.audit_export_enabled
    allow_in_safe_mode = settings.audit_allow_in_safe_mode
    queue_size = settings.audit_queue_size
    dedup_window_seconds = settings.audit_dedup_window_seconds
    endpoint = settings.audit_http_endpoint

    if settings.audit_transport == "http" and endpoint is None:
        raise RuntimeError(
            "SUI_AUDIT_HTTP_ENDPOINT is required for the HTTP audit transport"
        )

    if not enabled:
        return AuditDispatcher(
            enabled=False,
            allow_in_safe_mode=allow_in_safe_mode,
            transport=NoopAuditTransport(),
            queue_size=queue_size,
            dedup_window_seconds=dedup_window_seconds,
        )

    if settings.audit_transport == "http":
        transport: AuditTransport = HttpAuditTransport(
            endpoint=endpoint,
            api_key=settings.audit_http_api_key,
            timeout_seconds=settings.audit_http_timeout_seconds,
        )
    else:
        transport = NoopAuditTransport()

    return AuditDispatcher(
        enabled=enabled,
        allow_in_safe_mode=allow_in_safe_mode,
        transport=transport,
        queue_size=queue_size,
        dedup_window_seconds=dedup_window_seconds,
    )
