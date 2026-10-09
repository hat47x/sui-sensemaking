from __future__ import annotations

import pytest

from sui_sensemaking_api.audit import (
    AuditDispatcher,
    AuditEvent,
    HttpAuditTransport,
    MAX_AUDIT_EVENT_BYTES,
    build_audit_dispatcher,
    build_event,
    sanitize_metadata,
)


class RecordingTransport:
    name = "recording"

    def __init__(self) -> None:
        self.events: list[AuditEvent] = []

    def send(self, event: AuditEvent) -> None:
        self.events.append(event)


class FailingTransport:
    name = "failing"

    def __init__(self) -> None:
        self.calls = 0

    def send(self, event: AuditEvent) -> None:  # noqa: ARG002
        self.calls += 1
        raise RuntimeError("boom")


def test_build_event_has_minimum_common_schema() -> None:
    event = build_event(
        event_type="view",
        tenant_id="tenant-a",
        doc_id="doc-1",
        safe_mode=True,
        actor_ref="alice@example.com",
        metadata={"route": "/docs/doc-1", "method": "GET"},
    )

    assert event.schemaVersion == 1
    assert event.eventType == "view"
    assert event.tenantId == "tenant-a"
    assert event.docId == "doc-1"
    assert event.safeMode is True
    assert event.actorRefHash is not None
    assert len(event.actorRefHash) == 24


@pytest.mark.parametrize("tenant_id", ["", " tenant-a", "tenant-a\n"])
def test_build_event_rejects_missing_or_noncanonical_tenant_id(tenant_id: str) -> None:
    with pytest.raises(ValueError):
        build_event(
            event_type="view",
            tenant_id=tenant_id,
            doc_id="doc-1",
            safe_mode=True,
        )


def test_sanitize_metadata_masks_sensitive_keys() -> None:
    sanitized = sanitize_metadata(
        {
            "route": "/docs/doc-1",
            "email": "alice@example.com",
            "token": "secret-token",
            "client_secret": "client-secret",
            "tenantId": "tenant-b",
            "nested": {"unsafe": True},
        }
    )

    assert sanitized["route"] == "/docs/doc-1"
    assert sanitized["email"] == "[REDACTED]"
    assert sanitized["token"] == "[REDACTED]"
    assert sanitized["client_secret"] == "[REDACTED]"
    assert "tenantId" not in sanitized
    assert sanitized["nested"] == "[REDACTED]"


def test_sanitize_metadata_bounds_keys_values_and_field_count() -> None:
    sanitized = sanitize_metadata(
        {
            "oversized": "x" * 1025,
            "nonfinite": float("inf"),
            "bad\nkey": "not retained",
            **{f"field{index}": index for index in range(40)},
        }
    )

    assert sanitized["oversized"] == "[TRUNCATED]"
    assert sanitized["nonfinite"] == "[REDACTED]"
    assert "bad\nkey" not in sanitized
    assert len(sanitized) == 32


def test_dispatcher_off_is_side_effect_free() -> None:
    transport = RecordingTransport()
    dispatcher = AuditDispatcher(
        enabled=False,
        allow_in_safe_mode=False,
        transport=transport,
        queue_size=10,
    )
    event = build_event(
        event_type="view",
        tenant_id="tenant-a",
        doc_id="doc-1",
        safe_mode=True,
    )

    result = dispatcher.emit(event)

    assert result.sent is False
    assert result.reason == "disabled"
    assert transport.events == []


def test_dispatcher_fail_open_on_transport_failure() -> None:
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=FailingTransport(),
        queue_size=2,
    )
    event = build_event(
        event_type="export",
        tenant_id="tenant-a",
        doc_id="doc-2",
        safe_mode=False,
    )

    result = dispatcher.emit(event)

    assert result.sent is False
    assert result.reason == "send_failed"


def _emit_event(dispatcher: AuditDispatcher, *, key: tuple[str, ...], event_type: str = "export") -> object:
    event = build_event(
        event_type=event_type,
        tenant_id="tenant-a",
        doc_id="doc-2",
        safe_mode=False,
    )
    return dispatcher.emit(event, dedup_key=key)


def test_dispatcher_dedups_repeated_logical_operation() -> None:
    # SEC-AUDIT-DUP-01: the same logical operation emitted twice within the
    # window (client retry / double-click) reaches the sink only once.
    transport = RecordingTransport()
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=transport,
        queue_size=10,
    )

    first = _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-2", "json"))
    second = _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-2", "json"))

    assert first.sent is True
    assert second.sent is False
    assert second.reason == "duplicate"
    assert len(transport.events) == 1


def test_dispatcher_logs_info_when_duplicate_is_suppressed(caplog) -> None:  # type: ignore[no-untyped-def]
    # SEC-AUDIT-DUP-01: the silent drop of a repeat is visible in the log
    # (identity fields only), while the dispatch result stays "duplicate".
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=RecordingTransport(),
        queue_size=10,
    )
    key = ("export-audit", "tenant-a", "doc-2", "json")
    _emit_event(dispatcher, key=key)
    caplog.clear()

    with caplog.at_level("INFO", logger="sui_sensemaking_api.audit"):
        second = _emit_event(dispatcher, key=key)

    assert second.reason == "duplicate"
    suppressed = [
        record for record in caplog.records
        if record.getMessage() == "audit event suppressed as a duplicate within the dedup window"
    ]
    assert len(suppressed) == 1
    assert suppressed[0].levelname == "INFO"
    assert suppressed[0].eventType == "export"
    assert suppressed[0].tenantId == "tenant-a"
    assert suppressed[0].docId == "doc-2"
    assert suppressed[0].dedupKind == "export-audit"
    assert suppressed[0].transport == "recording"


def test_dispatcher_does_not_log_suppression_for_normal_sends(caplog) -> None:  # type: ignore[no-untyped-def]
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=RecordingTransport(),
        queue_size=10,
    )
    no_key_event = build_event(
        event_type="export",
        tenant_id="tenant-a",
        doc_id="doc-2",
        safe_mode=False,
    )

    with caplog.at_level("INFO", logger="sui_sensemaking_api.audit"):
        first = _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-2", "json"))
        distinct = _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-3", "json"))
        dispatcher.emit(no_key_event)
        dispatcher.emit(no_key_event)

    assert first.sent is True
    assert distinct.sent is True
    suppressed = [
        record for record in caplog.records
        if "suppressed as a duplicate" in record.getMessage()
    ]
    assert suppressed == []


def test_dispatcher_distinct_logical_operations_both_dispatch() -> None:
    transport = RecordingTransport()
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=transport,
        queue_size=10,
    )

    _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-2", "json"))
    _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-3", "json"))

    assert len(transport.events) == 2


def test_dispatcher_dedup_disabled_when_window_is_zero() -> None:
    transport = RecordingTransport()
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=transport,
        queue_size=10,
        dedup_window_seconds=0,
    )

    _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-2", "json"))
    _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-2", "json"))

    assert len(transport.events) == 2


def test_dispatcher_failed_send_retry_is_not_falsely_deduped() -> None:
    # SEC-AUDIT-DUP-01: a first attempt that FAILED is not recorded, so a
    # retry of the same logical operation is allowed (fail-open recovery).
    class FlakyTransport:
        name = "flaky"

        def __init__(self) -> None:
            self.calls = 0
            self.events: list[AuditEvent] = []

        def send(self, event: AuditEvent) -> None:
            self.calls += 1
            if self.calls == 1:
                raise RuntimeError("boom")
            self.events.append(event)

    transport = FlakyTransport()
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=transport,
        queue_size=10,
    )

    first = _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-2", "json"))
    assert first.sent is False
    assert first.reason == "send_failed"

    # The retry is NOT a duplicate; the flush delivers the pending copy, and no
    # second copy is sent (the logical operation reaches the sink exactly once).
    second = _emit_event(dispatcher, key=("export-audit", "tenant-a", "doc-2", "json"))
    assert second.sent is True
    assert second.reason == "queued_pending"
    assert len(transport.events) == 1


def test_dispatcher_no_dedup_key_bypasses_dedup() -> None:
    transport = RecordingTransport()
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=transport,
        queue_size=10,
    )

    event = build_event(
        event_type="export",
        tenant_id="tenant-a",
        doc_id="doc-2",
        safe_mode=False,
    )
    dispatcher.emit(event)
    dispatcher.emit(event)

    assert len(transport.events) == 2


def test_build_audit_dispatcher_http_rejects_missing_endpoint(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr("sui_sensemaking_api.audit.settings.audit_transport", "http")
    monkeypatch.setattr("sui_sensemaking_api.audit.settings.audit_http_endpoint", None)

    with pytest.raises(RuntimeError) as exc_info:
        build_audit_dispatcher()

    assert "SUI_AUDIT_HTTP_ENDPOINT" in str(exc_info.value)


def test_build_audit_dispatcher_http_uses_configured_transport(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    captured: dict[str, object] = {}

    def recording_http_transport(
        endpoint: str,
        api_key: str | None,
        timeout_seconds: float,
    ) -> RecordingTransport:
        captured.update(
            endpoint=endpoint,
            api_key=api_key,
            timeout_seconds=timeout_seconds,
        )
        return RecordingTransport()

    monkeypatch.setattr("sui_sensemaking_api.audit.settings.audit_export_enabled", True)
    monkeypatch.setattr("sui_sensemaking_api.audit.settings.audit_transport", "http")
    monkeypatch.setattr(
        "sui_sensemaking_api.audit.settings.audit_http_endpoint",
        "https://audit.example.invalid/events",
    )
    monkeypatch.setattr("sui_sensemaking_api.audit.settings.audit_http_api_key", "test-key")
    monkeypatch.setattr("sui_sensemaking_api.audit.settings.audit_http_timeout_seconds", 1.5)
    monkeypatch.setattr("sui_sensemaking_api.audit.HttpAuditTransport", recording_http_transport)

    dispatcher = build_audit_dispatcher()

    assert dispatcher.enabled is True
    assert captured == {
        "endpoint": "https://audit.example.invalid/events",
        "api_key": "test-key",
        "timeout_seconds": 1.5,
    }


def test_dispatcher_logs_a_warning_when_queue_flush_itself_fails(caplog) -> None:  # type: ignore[no-untyped-def]
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=FailingTransport(),
        queue_size=2,
    )
    first_event = build_event(
        event_type="export",
        tenant_id="tenant-a",
        doc_id="doc-2",
        safe_mode=False,
    )
    second_event = build_event(
        event_type="view",
        tenant_id="tenant-a",
        doc_id="doc-3",
        safe_mode=False,
    )
    dispatcher.emit(first_event)
    caplog.clear()

    with caplog.at_level("WARNING", logger="sui_sensemaking_api.audit"):
        dispatcher.emit(second_event)

    flush_records = [
        record for record in caplog.records
        if record.getMessage() == "audit event flush failed; keep fail-open"
    ]
    assert len(flush_records) == 1
    assert flush_records[0].docId == "doc-2"
    assert flush_records[0].tenantId == "tenant-a"
    assert flush_records[0].transport == "failing"


def test_http_transport_rejects_oversized_serialized_event(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    event = build_event(
        event_type="view",
        tenant_id="tenant-a",
        doc_id="doc-1",
        safe_mode=True,
    )
    monkeypatch.setattr(
        AuditEvent,
        "model_dump_json",
        lambda self: "x" * (MAX_AUDIT_EVENT_BYTES + 1),
    )

    transport = HttpAuditTransport(endpoint="http://127.0.0.1:9000/audit")

    try:
        transport.send(event)
    except RuntimeError as exc:
        assert str(exc) == "audit event exceeds the outbound size limit"
    else:
        assert False, "Expected oversized audit event to be rejected"


def test_audit_llm_trace_emits_llm_event_via_dispatcher() -> None:
    """SEC-LLM-AUDIT-01 AC-1/AC-3: LLM calls reach the audit dispatcher with
    CE2-C5 fields (task/routingStage/provider/model/trace_id) and never
    prompt/card text."""
    import json

    from sui_sensemaking_api.routes.ai import _audit_llm_trace
    from sui_sensemaking_api.tenant_context import LOCAL_DEFAULT_TENANT_CONTEXT

    class Recorder:
        def __init__(self) -> None:
            self.events: list[AuditEvent] = []

        def emit(self, event: AuditEvent) -> None:
            self.events.append(event)

    recorder = Recorder()
    state = type("State", (), {"audit_dispatcher": recorder})
    app = type("App", (), {"state": state})
    request = type("Request", (), {"app": app})

    class FakeLLMResponse:
        def as_audit_fields(self) -> dict[str, object]:
            return {"provider": "mock", "model_id": "mock-model", "trace_id": "trace-1"}

    _audit_llm_trace(request, LOCAL_DEFAULT_TENANT_CONTEXT, "doc-1", "re_layout", FakeLLMResponse())

    assert len(recorder.events) == 1
    event = recorder.events[0]
    assert event.eventType == "llm"
    assert event.docId == "doc-1"
    assert event.tenantId == LOCAL_DEFAULT_TENANT_CONTEXT.tenant_id
    assert event.metadata["task"] == "re_layout"
    assert "routingStage" in event.metadata
    assert event.metadata["provider"] == "mock"
    assert event.metadata["model_id"] == "mock-model"
    assert event.metadata["trace_id"] == "trace-1"

    # AC-3: no prompt text, card text, or unreviewed info in the audit event.
    serialized = json.dumps(event.metadata).lower()
    assert "prompt" not in serialized
    assert '"text"' not in serialized
    assert "unreviewed" not in serialized
