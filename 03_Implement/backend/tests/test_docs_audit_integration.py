from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sui_sensemaking_api import cli
from sui_sensemaking_api.audit import AuditDispatcher, resolve_ce4_query_hash
from sui_sensemaking_api.access_control import AccessDecision
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import Base
from sui_sensemaking_api.routes.docs import (
    _ce4_audit_event_tracker,
    _evict_stale_ce4_tracker_entries,
    _record_ce4_event_and_validate_completeness,
    reset_ce4_audit_event_tracker,
)
from sui_sensemaking_api.settings import settings


class SpyAuditDispatcher:
    def __init__(self) -> None:
        self.events: list[object] = []

    def emit(self, event: object, *, dedup_key=None):  # noqa: ANN001
        self.events.append(event)
        return None


class RecordingAuditTransport:
    name = "recording"

    def __init__(self) -> None:
        self.events: list[object] = []

    def send(self, event: object) -> None:
        self.events.append(event)


class AllowAllAdapter:
    name = "allow-all"

    def authorize(self, request):  # noqa: ANN001
        return AccessDecision(allow=True)


@pytest.fixture(autouse=True)
def _reset_ce4_tracker() -> Iterator[None]:
    reset_ce4_audit_event_tracker()
    yield
    reset_ce4_audit_event_tracker()



def _sample_payload(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "audit-test",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [{"id": "card-1", "text": "alpha", "x": 0, "y": 0}],
        "edges": [],
        "islands": [],
    }



@contextmanager
def _sqlite_client(tmp_path) -> Iterator[TestClient]:
    db_path = tmp_path / "docs_audit.sqlite3"
    engine = create_engine(f"sqlite:///{db_path}")
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    Base.metadata.create_all(bind=engine)

    def _get_test_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_test_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()



def test_get_document_emits_view_audit_event(tmp_path) -> None:
    spy = SpyAuditDispatcher()
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = spy
        client.app.state.access_control_adapter = AllowAllAdapter()
        payload = _sample_payload("doc-view")
        put_resp = client.put("/docs/doc-view", json=payload)
        assert put_resp.status_code == 200

        get_resp = client.get(
            "/docs/doc-view",
            headers={
                "x-actor-ref": "user-1",
                "x-auth-roles": "admin",
                "x-auth-groups": "team-a",
                "x-policy-ref": "secret-policy-v1",
                "x-doc-visibility": "Org",
                "x-trace-id": "trace-view-1",
                "x-auth-amr": "pwd,webauthn",
                "x-auth-aal": "aal2",
                "x-auth-time": "2026-02-11T00:00:00Z",
            },
        )
        assert get_resp.status_code == 200

    assert len(spy.events) == 1
    event = spy.events[0]
    assert event.eventType == "view"
    assert event.docId == "doc-view"
    assert event.metadata["decision_allow"] is True
    assert event.metadata["decision_read_only"] is False
    assert event.metadata["decision_reason"] is None
    assert event.metadata["policyRefPresent"] is True
    assert event.metadata["adapterName"] == "allow-all"
    assert event.metadata["visibility"] == "Org"
    assert event.metadata["traceId"] == "trace-view-1"
    assert event.tenantId == "local-default"
    assert "tenantId" not in event.metadata
    assert event.metadata["hasStepUp"] is True
    assert event.metadata["amrClass"] == "multi_factor"
    assert event.metadata["assuranceLevel"] == "substantial"
    assert event.metadata["authAgeBucket"] in {"fresh", "stale"}
    metadata_json = str(event.metadata)
    assert "secret-policy-v1" not in metadata_json
    assert "team-a" not in metadata_json
    assert "admin" not in metadata_json



def test_post_export_audit_emits_export_event(tmp_path) -> None:
    spy = SpyAuditDispatcher()
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = spy
        client.app.state.access_control_adapter = AllowAllAdapter()
        response = client.post(
            "/docs/doc-export/export-audit",
            json={"safeMode": False, "exportKind": "bundle"},
            headers={
                "x-actor-ref": "user-2",
                "x-trace-id": "trace-export-1",
                "x-auth-amr": "pwd",
                "x-auth-acr": "aal1",
                "x-auth-time": "bad-timestamp",
            },
        )
        assert response.status_code == 200
        assert response.json() == {"status": "accepted"}

    assert len(spy.events) == 1
    event = spy.events[0]
    assert event.eventType == "export"
    assert event.docId == "doc-export"
    assert event.safeMode is False
    assert event.metadata["action"] == "export"
    assert event.metadata["decision_allow"] is True
    assert event.metadata["decision_read_only"] is False
    assert event.metadata["decision_reason"] is None
    assert event.metadata["adapterName"] == "allow-all"
    assert event.metadata["traceId"] == "trace-export-1"
    assert event.tenantId == "local-default"
    assert "tenantId" not in event.metadata
    assert event.metadata["hasStepUp"] is False
    assert event.metadata["amrClass"] == "single_factor"
    assert event.metadata["assuranceLevel"] == "low"
    assert event.metadata["authAgeBucket"] == "unknown"


def test_post_export_audit_safe_mode_is_refused_and_not_recorded(tmp_path) -> None:
    # api.md §8.3 rule 1 (safeMode=true の export は常に拒否) and §2.13 (export-audit は
    # 書き出し境界を通過した場合のみ記録) together mean a declared safeMode=true export
    # is refused with 403 and emits no audit event. Pinned so that changing this
    # needs an explicit spec decision (see the ADR-0049 D2 vs §8.3 conflict).
    spy = SpyAuditDispatcher()
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = spy
        client.app.state.access_control_adapter = AllowAllAdapter()
        response = client.post(
            "/docs/doc-export/export-audit",
            json={"safeMode": True, "exportKind": "agent-task"},
            headers={"x-actor-ref": "user-2"},
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "Access denied: safe_mode"}
    assert spy.events == []


def test_export_audit_double_post_reaches_sink_once(tmp_path) -> None:
    # SEC-AUDIT-DUP-01: the route passes a logical dedup_key, so a client
    # retry / double-click of the identical export is not double-counted at
    # the external sink. Both HTTP responses stay 200 (accepted).
    transport = RecordingAuditTransport()
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=transport,
        queue_size=10,
    )
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = dispatcher
        client.app.state.access_control_adapter = AllowAllAdapter()

        body = {"safeMode": False, "exportKind": "bundle"}
        first = client.post(
            "/docs/doc-export/export-audit",
            json=body,
            headers={"x-actor-ref": "user-2", "x-trace-id": "trace-export-1"},
        )
        second = client.post(
            "/docs/doc-export/export-audit",
            json=body,
            headers={"x-actor-ref": "user-2", "x-trace-id": "trace-export-1"},
        )

        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json() == {"status": "accepted"}
        assert second.json() == {"status": "accepted"}

    assert len(transport.events) == 1
    assert transport.events[0].docId == "doc-export"


def test_export_audit_distinct_kinds_both_reach_sink(tmp_path) -> None:
    # SEC-AUDIT-DUP-01: different logical exports (exportKind) are not deduped.
    transport = RecordingAuditTransport()
    dispatcher = AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=transport,
        queue_size=10,
    )
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = dispatcher
        client.app.state.access_control_adapter = AllowAllAdapter()

        for export_kind in ("bundle", "json"):
            response = client.post(
                "/docs/doc-export/export-audit",
                json={"safeMode": False, "exportKind": export_kind},
                headers={"x-actor-ref": "user-2"},
            )
            assert response.status_code == 200

    assert len(transport.events) == 2


def test_context_audit_rejects_stale_session_before_tracker_mutation(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tracker_called = False

    def _unexpected_tracker_mutation(**_: object) -> None:
        nonlocal tracker_called
        tracker_called = True

    monkeypatch.setattr(
        "sui_sensemaking_api.routes.docs.resolve_trusted_saas_request_session",
        lambda **_: SimpleNamespace(
            session=SimpleNamespace(tenant_session_version="session-v2")
        ),
    )
    monkeypatch.setattr(
        "sui_sensemaking_api.routes.docs._record_ce4_event_and_validate_completeness",
        _unexpected_tracker_mutation,
    )

    with _sqlite_client(tmp_path) as client:
        original_runtime_profile = client.app.state.runtime_profile
        try:
            client.app.state.runtime_profile = "saas-multitenant"
            response = client.post(
                "/docs/doc-context/context-audit",
                headers={"Sui-Sensemaking-Tenant-Session-Version": "session-v1"},
                json={
                    "operation": "query",
                    "safeMode": True,
                    "equivalenceKey": "a" * 64,
                    "bundleHash": "b" * 64,
                    "queryHash": "a" * 64,
                    "dryRun": True,
                    "sideEffect": "none",
                    "command": "context-query",
                    "channel": "api",
                    "schemaVersion": "ce4.audit.v1",
                },
            )
        finally:
            client.app.state.runtime_profile = original_runtime_profile

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "tenant_session_changed"
    assert tracker_called is False


def test_context_audit_tracker_does_not_share_progress_between_tenants() -> None:
    common = {
        "doc_id": "shared-doc",
        "equivalence_key": "a" * 64,
        "bundle_hash": "b" * 64,
        "source_bundle_hash": None,
    }
    _record_ce4_event_and_validate_completeness(
        tenant_id="tenant-a",
        operation="query",
        **common,
    )

    with pytest.raises(HTTPException) as captured:
        _record_ce4_event_and_validate_completeness(
            tenant_id="tenant-b",
            operation="apply",
            **common,
        )

    assert captured.value.status_code == 409
    assert captured.value.detail["code"] == "missing_event"
    assert captured.value.detail["missingEvents"] == ["bundle", "proposal", "query"]


def test_context_audit_tracker_does_not_share_progress_between_documents() -> None:
    common = {
        "tenant_id": "tenant-a",
        "equivalence_key": "a" * 64,
        "bundle_hash": "b" * 64,
        "source_bundle_hash": None,
    }
    _record_ce4_event_and_validate_completeness(
        doc_id="doc-a",
        operation="query",
        **common,
    )

    with pytest.raises(HTTPException) as captured:
        _record_ce4_event_and_validate_completeness(
            doc_id="doc-b",
            operation="apply",
            **common,
        )

    assert captured.value.status_code == 409
    assert captured.value.detail["code"] == "missing_event"
    assert captured.value.detail["missingEvents"] == ["bundle", "proposal", "query"]


def test_context_audit_endpoint_emits_four_operation_events(tmp_path) -> None:
    spy = SpyAuditDispatcher()
    operation_to_command = {
        "query": "context-query",
        "bundle": "context-bundle",
        "proposal": "proposal-diff",
        "apply": "apply --dry-run",
    }
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = spy
        client.app.state.access_control_adapter = AllowAllAdapter()
        for operation in ("query", "bundle", "proposal", "apply"):
            response = client.post(
                "/docs/doc-context/context-audit",
                json={
                    "operation": operation,
                    "safeMode": True,
                    "equivalenceKey": "a" * 64,
                    "bundleHash": "b" * 64,
                    "sourceBundleHash": "mock:" + ("c" * 64),
                    "queryHash": "a" * 64,
                    "dryRun": True,
                    "sideEffect": "none",
                    "rejectReasonCode": "none",
                    "command": operation_to_command[operation],
                    "channel": "api",
                    "schemaVersion": "ce4.audit.v1",
                },
                headers={"x-trace-id": f"trace-{operation}"},
            )
            assert response.status_code == 200
            assert response.json() == {"status": "accepted"}

    assert [event.eventType for event in spy.events] == ["query", "bundle", "proposal", "apply"]
    for event in spy.events:
        assert set(event.metadata) >= {
            "operation",
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
        }
        assert event.tenantId == "local-default"
        assert "tenantId" not in event.metadata


def test_context_audit_endpoint_accepts_mcp_channel(tmp_path) -> None:
    # The read-only MCP server (03_Implement/mcp) audits its projections through
    # this CE-4 endpoint with channel=mcp. The enum must accept the slot and the
    # emitted audit event must carry it through unchanged so an MCP-originated
    # read is traceable in the same audit trail as api/cli/gui callers.
    spy = SpyAuditDispatcher()
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = spy
        client.app.state.access_control_adapter = AllowAllAdapter()
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "query",
                "safeMode": True,
                "equivalenceKey": "a" * 64,
                "bundleHash": "b" * 64,
                "queryHash": "a" * 64,
                "dryRun": True,
                "sideEffect": "none",
                "rejectReasonCode": "none",
                "command": "context-query",
                "channel": "mcp",
                "schemaVersion": "ce4.audit.v1",
            },
            headers={"x-trace-id": "trace-mcp"},
        )
        assert response.status_code == 200
        assert response.json() == {"status": "accepted"}

    assert [event.eventType for event in spy.events] == ["query"]
    assert spy.events[0].metadata["channel"] == "mcp"
    assert spy.events[0].metadata["command"] == "context-query"


def test_cli_context_query_emits_same_audit_fields_as_api(tmp_path, monkeypatch) -> None:
    spy = SpyAuditDispatcher()
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = spy
        client.app.state.access_control_adapter = AllowAllAdapter()

        api_response = client.post(
            "/docs/doc-cli/context-audit",
            json={
                "operation": "query",
                "safeMode": True,
                "equivalenceKey": "d" * 64,
                "bundleHash": "e" * 64,
                "sourceBundleHash": "mock:" + ("f" * 64),
                "queryHash": "d" * 64,
                "dryRun": True,
                "sideEffect": "none",
                "rejectReasonCode": None,
                "command": "context-query",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
            headers={"x-trace-id": "trace-api"},
        )
        assert api_response.status_code == 200

        def _fake_post(url, json, headers, timeout):  # noqa: ANN001
            path = url.removeprefix("http://127.0.0.1:8000")
            response = client.post(path, json=json, headers=headers)
            return httpx.Response(
                status_code=response.status_code,
                content=response.content,
                request=httpx.Request("POST", url),
            )

        monkeypatch.setattr(cli.httpx, "post", _fake_post)

        input_file = tmp_path / "context_query.json"
        input_file.write_text(
            '{"docId":"doc-cli","equivalenceKey":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","bundleHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","sourceBundleHash":"mock:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}',
            encoding="utf-8",
        )
        result = cli.main(
            [
                "--api-base-url",
                "http://127.0.0.1:8000",
                "--trace-id",
                "trace-cli",
                "context-query",
                "--input",
                str(input_file),
                "--dry-run",
            ]
        )
        assert result == 0

    assert len(spy.events) == 2
    api_event = spy.events[0]
    cli_event = spy.events[1]
    assert api_event.eventType == cli_event.eventType == "query"
    assert set(api_event.metadata.keys()) == set(cli_event.metadata.keys())
    assert cli_event.metadata["channel"] == "cli"


def test_cli_apply_forces_dry_run_true_even_when_input_requests_side_effect(tmp_path, monkeypatch) -> None:
    spy = SpyAuditDispatcher()
    with _sqlite_client(tmp_path) as client:
        client.app.state.audit_dispatcher = spy
        client.app.state.access_control_adapter = AllowAllAdapter()
        for operation, command in (
            ("query", "context-query"),
            ("bundle", "context-bundle"),
            ("proposal", "proposal-diff"),
        ):
            response = client.post(
                "/docs/doc-cli/context-audit",
                json={
                    "operation": operation,
                    "safeMode": True,
                    "equivalenceKey": "d" * 64,
                    "bundleHash": "e" * 64,
                    "sourceBundleHash": "mock:" + ("f" * 64),
                    "queryHash": "d" * 64,
                    "dryRun": True,
                    "sideEffect": "none",
                    "command": command,
                    "channel": "api",
                    "schemaVersion": "ce4.audit.v1",
                },
            )
            assert response.status_code == 200

        def _fake_post(url, json, headers, timeout):  # noqa: ANN001
            path = url.removeprefix("http://127.0.0.1:8000")
            response = client.post(path, json=json, headers=headers)
            return httpx.Response(
                status_code=response.status_code,
                content=response.content,
                request=httpx.Request("POST", url),
            )

        monkeypatch.setattr(cli.httpx, "post", _fake_post)

        input_file = tmp_path / "apply.json"
        input_file.write_text(
            '{"docId":"doc-cli","equivalenceKey":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","bundleHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","sourceBundleHash":"mock:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","dryRun":false,"sideEffect":"write"}',
            encoding="utf-8",
        )
        result = cli.main(
            [
                "--api-base-url",
                "http://127.0.0.1:8000",
                "apply",
                "--input",
                str(input_file),
            ]
        )
        assert result == 0

    assert len(spy.events) == 4
    event = spy.events[-1]
    assert event.eventType == "apply"
    assert event.metadata["dryRun"] is True
    assert event.metadata["sideEffect"] == "none"
    assert event.metadata["command"] == "apply --dry-run"


def test_context_audit_rejects_invalid_source_bundle_hash(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "proposal",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "sourceBundleHash": "mock:not-hex",
                "dryRun": True,
                "sideEffect": "none",
                "command": "proposal-diff",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 422


def test_context_audit_rejects_mock_source_bundle_hash_when_disabled(tmp_path) -> None:
    original = settings.ce4_source_bundle_hash_allow_mock
    settings.ce4_source_bundle_hash_allow_mock = False
    try:
        with _sqlite_client(tmp_path) as client:
            response = client.post(
                "/docs/doc-context/context-audit",
                json={
                    "operation": "proposal",
                    "safeMode": True,
                    "equivalenceKey": "1" * 64,
                    "bundleHash": "2" * 64,
                    "sourceBundleHash": "mock:" + ("3" * 64),
                    "dryRun": True,
                    "sideEffect": "none",
                    "command": "proposal-diff",
                    "channel": "api",
                    "schemaVersion": "ce4.audit.v1",
                },
            )
    finally:
        settings.ce4_source_bundle_hash_allow_mock = original

    assert response.status_code == 422


def test_context_audit_rejects_proposal_without_source_bundle_hash(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "proposal",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "dryRun": True,
                "sideEffect": "none",
                "command": "proposal-diff",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "missing_source_bundle_hash"
    assert response.json()["detail"]["message"] == "sourceBundleHash is required for proposal/apply operations"


def test_context_audit_rejects_apply_without_source_bundle_hash(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "apply",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "dryRun": True,
                "sideEffect": "none",
                "command": "apply --dry-run",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "missing_source_bundle_hash"
    assert response.json()["detail"]["message"] == "sourceBundleHash is required for proposal/apply operations"


def test_context_audit_rejects_dry_run_side_effect(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "apply",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "sourceBundleHash": "mock:" + ("3" * 64),
                "dryRun": True,
                "sideEffect": "write",
                "command": "apply --dry-run",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 422


def test_context_audit_rejects_apply_without_dry_run(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "apply",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "sourceBundleHash": "mock:" + ("3" * 64),
                "dryRun": False,
                "sideEffect": "none",
                "command": "apply --dry-run",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "apply_requires_dry_run"


def test_context_audit_rejects_apply_when_required_events_missing(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "apply",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "sourceBundleHash": "mock:" + ("3" * 64),
                "dryRun": True,
                "sideEffect": "none",
                "command": "apply --dry-run",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "missing_event"
    assert response.json()["detail"]["missingEvents"] == ["bundle", "proposal", "query"]


def test_resolve_ce4_query_hash_prefers_canonical() -> None:
    metadata = {"queryHash": "a" * 64, "queryCanonicalHash": "b" * 64}
    assert resolve_ce4_query_hash(metadata) == "b" * 64


def test_context_audit_rejects_apply_when_bundle_hash_differs_from_prior_events(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        for operation, command in (
            ("query", "context-query"),
            ("bundle", "context-bundle"),
            ("proposal", "proposal-diff"),
        ):
            response = client.post(
                "/docs/doc-context/context-audit",
                json={
                    "operation": operation,
                    "safeMode": True,
                    "equivalenceKey": "1" * 64,
                    "bundleHash": "2" * 64,
                    "sourceBundleHash": "mock:" + ("3" * 64),
                    "dryRun": True,
                    "sideEffect": "none",
                    "command": command,
                    "channel": "api",
                    "schemaVersion": "ce4.audit.v1",
                },
            )
            assert response.status_code == 200

        apply_response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "apply",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "4" * 64,
                "sourceBundleHash": "mock:" + ("3" * 64),
                "dryRun": True,
                "sideEffect": "none",
                "command": "apply --dry-run",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert apply_response.status_code == 409
    assert apply_response.json()["detail"]["code"] == "missing_event"
    assert apply_response.json()["detail"]["missingEvents"] == ["bundle", "proposal", "query"]


def test_context_audit_rejects_apply_when_source_bundle_hash_differs_from_proposal(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        for operation, command in (
            ("query", "context-query"),
            ("bundle", "context-bundle"),
            ("proposal", "proposal-diff"),
        ):
            response = client.post(
                "/docs/doc-context/context-audit",
                json={
                    "operation": operation,
                    "safeMode": True,
                    "equivalenceKey": "1" * 64,
                    "bundleHash": "2" * 64,
                    "sourceBundleHash": "mock:" + ("3" * 64),
                    "dryRun": True,
                    "sideEffect": "none",
                    "command": command,
                    "channel": "api",
                    "schemaVersion": "ce4.audit.v1",
                },
            )
            assert response.status_code == 200

        apply_response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "apply",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "sourceBundleHash": "mock:" + ("4" * 64),
                "dryRun": True,
                "sideEffect": "none",
                "command": "apply --dry-run",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert apply_response.status_code == 409
    assert apply_response.json()["detail"]["code"] == "equivalence_mismatch"


def test_context_audit_rejects_operation_command_mismatch(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "bundle",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "sourceBundleHash": "mock:" + ("3" * 64),
                "dryRun": True,
                "sideEffect": "none",
                "command": "proposal-diff",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "operation_command_mismatch"


def test_context_audit_rejects_missing_command(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "bundle",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "queryHash": "1" * 64,
                "dryRun": True,
                "sideEffect": "none",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 422


def test_context_audit_rejects_query_hash_mismatch(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "bundle",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "queryHash": "3" * 64,
                "dryRun": True,
                "sideEffect": "none",
                "command": "context-bundle",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
            },
        )

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "query_hash_mismatch"


def test_context_audit_accepts_fixed_reject_reason_code(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        for operation, command in (
            ("query", "context-query"),
            ("bundle", "context-bundle"),
            ("proposal", "proposal-diff"),
            ("apply", "apply --dry-run"),
        ):
            response = client.post(
                "/docs/doc-context/context-audit",
                json={
                    "operation": operation,
                    "safeMode": True,
                    "equivalenceKey": "1" * 64,
                    "bundleHash": "2" * 64,
                    "sourceBundleHash": "mock:" + ("3" * 64),
                    "dryRun": True,
                    "sideEffect": "none",
                    "command": command,
                    "channel": "api",
                    "schemaVersion": "ce4.audit.v1",
                    "rejectReasonCode": "none",
                },
            )
            assert response.status_code == 200


def test_context_audit_rejects_unknown_reject_reason_code(tmp_path) -> None:
    with _sqlite_client(tmp_path) as client:
        response = client.post(
            "/docs/doc-context/context-audit",
            json={
                "operation": "query",
                "safeMode": True,
                "equivalenceKey": "1" * 64,
                "bundleHash": "2" * 64,
                "dryRun": True,
                "sideEffect": "none",
                "command": "context-query",
                "channel": "api",
                "schemaVersion": "ce4.audit.v1",
                "rejectReasonCode": "unexpected_code",
            },
        )

    assert response.status_code == 422


def test_cli_apply_forces_dry_run(tmp_path, monkeypatch) -> None:
    captured_payload: dict[str, object] = {}

    def _fake_post(url, json, headers, timeout):  # noqa: ANN001
        captured_payload.update(json)
        return httpx.Response(200, content=b'{"status":"accepted"}', request=httpx.Request("POST", url))

    monkeypatch.setattr(cli.httpx, "post", _fake_post)

    input_file = tmp_path / "apply.json"
    input_file.write_text(
        '{"docId":"doc-cli","equivalenceKey":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","bundleHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","sourceBundleHash":"mock:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}',
        encoding="utf-8",
    )
    result = cli.main(
        [
            "--api-base-url",
            "http://127.0.0.1:8000",
            "apply",
            "--input",
            str(input_file),
        ]
    )
    assert result == 0
    assert captured_payload["operation"] == "apply"
    assert captured_payload["dryRun"] is True
    assert captured_payload["command"] == "apply --dry-run"


def test_ce4_tracker_evicts_entries_stale_beyond_ttl(monkeypatch) -> None:
    # DX-BACKEND-CE4-01: entries untouched for > TTL are evicted so the tracker
    # cannot grow for the process lifetime.
    reset_ce4_audit_event_tracker()
    now = [1_000_000.0]
    monkeypatch.setattr("sui_sensemaking_api.routes.docs.time.time", lambda: now[0])

    for doc_id in ("d1", "d2"):
        _record_ce4_event_and_validate_completeness(
            tenant_id="t",
            doc_id=doc_id,
            equivalence_key="k1",
            bundle_hash="b1",
            operation="query",
            source_bundle_hash=None,
        )
    assert len(_ce4_audit_event_tracker) == 2

    # Advance well past the 24h TTL and sweep.
    now[0] = 1_000_000.0 + 24 * 3600 + 1
    _evict_stale_ce4_tracker_entries(now[0])

    assert len(_ce4_audit_event_tracker) == 0


def test_ce4_tracker_caps_at_max_entries_keeping_newest(monkeypatch) -> None:
    # DX-BACKEND-CE4-01: the LRU cap drops the oldest entries once the tracker
    # exceeds the bound.
    reset_ce4_audit_event_tracker()
    now = [1_000_000.0]
    monkeypatch.setattr("sui_sensemaking_api.routes.docs.time.time", lambda: now[0])
    monkeypatch.setattr("sui_sensemaking_api.routes.docs._CE4_TRACKER_MAX_ENTRIES", 3)

    for index in range(5):
        now[0] += 1.0  # each new entry is strictly newer
        _record_ce4_event_and_validate_completeness(
            tenant_id="t",
            doc_id=f"d{index}",
            equivalence_key="k1",
            bundle_hash="b1",
            operation="query",
            source_bundle_hash=None,
        )

    # Cap to the 3 newest (d2/d3/d4); d0/d1 are evicted.
    _evict_stale_ce4_tracker_entries(now[0])
    remaining = {key[1] for key in _ce4_audit_event_tracker}
    assert remaining == {"d2", "d3", "d4"}
