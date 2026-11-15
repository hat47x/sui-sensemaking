"""R2 F0-S: actual loopback HTTP policy transport + local Raw byte reader.

The HTTP policy server, principal/tenant, binding resolver and local storage
root are TEST DOUBLES. This is not the Product Auth Edge, a real PDP's policy,
a public Raw API, Card Binding, or a completed IG1 browser roundtrip.
"""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator, cast

import pytest

from experiments.r2_immutable_snapshot_reference import LocalImmutableSnapshotReference
from experiments.r2_source_read_grant_reference import (
    SnapshotPolicyBinding,
    SourceReadNotQualified,
    read_authorized_snapshot_reference,
)
from sui_sensemaking_api.access_control import (
    AccessRequest,
    AccessResource,
    AuthContext,
    ExternalPolicyAccessControlAdapter,
    ExternalPolicyAdapterConfig,
)
from sui_sensemaking_api.tenant_context import TenantContext

TENANT = TenantContext(
    tenant_id="tenant-a",
    membership_id="member-a",
    resolved_by="verified_claim",
)
PRINCIPAL = AuthContext(
    actor_ref="reviewer-a",
    user_id="reviewer-a",
    provider="oidc",
)
CAPTURE = "capture-a"
POLICY_REF = "source-policy-a"
RAW = b"\xef\xbb\xbf" + "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊".encode("utf-8")
DIGEST = sha256(RAW).hexdigest()


class _PolicyServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _PolicyHandler)
        self.requests: list[dict] = []
        self.source_allowed = False
        self.mode = "normal"


class _PolicyHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        server = cast(_PolicyServer, self.server)
        size = int(self.headers["Content-Length"])
        request = json.loads(self.rfile.read(size).decode("utf-8"))
        server.requests.append(request)

        if server.mode == "unavailable":
            status, response = 503, b"temporarily unavailable"
        elif server.mode == "invalid":
            status, response = 200, b'{"allow":"yes"}'
        else:
            resource = request["resource"]
            tenant = request["tenant"]
            auth = request["auth"]
            is_document = (
                resource["kind"] == "document"
                and resource["policyRef"] == "document-policy-a"
            )
            is_source = (
                resource["kind"] == "source_snapshot"
                and resource["docId"] == CAPTURE
                and resource["tenantId"] == "tenant-a"
                and resource["policyRef"] == POLICY_REF
                and tenant["tenantId"] == "tenant-a"
                and tenant["membershipId"] == "member-a"
                and auth["actorRef"] == "reviewer-a"
                and auth["provider"] == "oidc"
                and request["action"] == "read"
            )
            permitted = is_document or (is_source and server.source_allowed)
            status = 200
            response = json.dumps({"allow": permitted}).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format: str, *args: object) -> None:
        pass


@contextmanager
def _policy_server() -> Iterator[_PolicyServer]:
    server = _PolicyServer()
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
        assert not worker.is_alive()


@dataclass
class _BindingResolver:
    binding: SnapshotPolicyBinding | None = SnapshotPolicyBinding(
        tenant_id="tenant-a", capture_id=CAPTURE, policy_ref=POLICY_REF
    )
    calls: int = 0

    def resolve(
        self, *, tenant: TenantContext, capture_id: str
    ) -> SnapshotPolicyBinding | None:
        self.calls += 1
        return self.binding


@dataclass
class _RecordingReader:
    store: LocalImmutableSnapshotReference
    calls: int = 0

    def read(
        self, *, tenant_id: str, capture_id: str, expected_sha256: str
    ) -> bytes:
        self.calls += 1
        return self.store.read(
            tenant_id=tenant_id,
            capture_id=capture_id,
            expected_sha256=expected_sha256,
        )


def _setup(tmp_path: Path) -> _RecordingReader:
    store = LocalImmutableSnapshotReference(tmp_path / "nas")
    observation = store.put_once(
        tenant_id=TENANT.tenant_id, capture_id=CAPTURE, raw=RAW
    )
    assert observation.sha256_digest == DIGEST
    return _RecordingReader(LocalImmutableSnapshotReference(tmp_path / "nas"))


def _adapter(server: _PolicyServer) -> ExternalPolicyAccessControlAdapter:
    return ExternalPolicyAccessControlAdapter(
        config=ExternalPolicyAdapterConfig(
            endpoint=f"http://127.0.0.1:{server.server_port}/decide",
            timeout_seconds=2.0,
        )
    )


def _read(
    *,
    adapter: ExternalPolicyAccessControlAdapter,
    reader: _RecordingReader,
    binding: _BindingResolver | None = None,
    principal: AuthContext = PRINCIPAL,
) -> bytes:
    return read_authorized_snapshot_reference(
        tenant=TENANT,
        principal=principal,
        capture_id=CAPTURE,
        expected_sha256=DIGEST,
        policy_binding_resolver=binding or _BindingResolver(),
        adapter=adapter,
        reader=reader,
    )


def test_http_source_allow_reads_exact_local_snapshot_and_second_span(
    tmp_path: Path,
) -> None:
    reader = _setup(tmp_path)
    repeated = "同じ言葉。🌊".encode("utf-8")
    second = RAW.index(repeated, RAW.index(repeated) + len(repeated))
    with _policy_server() as server:
        server.source_allowed = True
        raw = _read(adapter=_adapter(server), reader=reader)
        assert raw == RAW
        assert raw[second:second + len(repeated)] == repeated
        assert reader.calls == 1
        assert len(server.requests) == 1
        payload = server.requests[0]
        assert payload["resource"] == {
            "docId": CAPTURE,
            "visibility": "Restricted",
            "policyRef": POLICY_REF,
            "tenantId": TENANT.tenant_id,
            "kind": "source_snapshot",
        }
        assert payload["tenant"]["membershipId"] == "member-a"
        assert payload["auth"]["provider"] == "oidc"


def test_document_allow_over_http_does_not_authorize_raw_bytes(
    tmp_path: Path,
) -> None:
    reader = _setup(tmp_path)
    with _policy_server() as server:
        adapter = _adapter(server)
        document = adapter.authorize(
            AccessRequest(
                action="read",
                tenant=TENANT,
                auth=PRINCIPAL,
                resource=AccessResource(
                    doc_id="document-a",
                    tenant_id=TENANT.tenant_id,
                    kind="document",
                    policy_ref="document-policy-a",
                    visibility="Restricted",
                ),
            )
        )
        assert document.allow
        with pytest.raises(SourceReadNotQualified, match="source read unavailable"):
            _read(adapter=adapter, reader=reader)
        assert reader.calls == 0
        assert [r["resource"]["kind"] for r in server.requests] == [
            "document", "source_snapshot"
        ]


def test_source_read_is_rechecked_after_policy_revocation(tmp_path: Path) -> None:
    reader = _setup(tmp_path)
    with _policy_server() as server:
        adapter = _adapter(server)
        server.source_allowed = True
        assert _read(adapter=adapter, reader=reader) == RAW
        server.source_allowed = False
        with pytest.raises(SourceReadNotQualified):
            _read(adapter=adapter, reader=reader)
        assert reader.calls == 1
        assert len(server.requests) == 2


@pytest.mark.parametrize("mode", ["unavailable", "invalid"])
def test_http_policy_failure_never_falls_back_to_raw_read(
    tmp_path: Path, mode: str,
) -> None:
    reader = _setup(tmp_path)
    with _policy_server() as server:
        server.mode = mode
        with pytest.raises(SourceReadNotQualified) as exc:
            _read(adapter=_adapter(server), reader=reader)
        assert str(exc.value) == "source read unavailable"
        assert reader.calls == 0
        assert len(server.requests) == 1


def test_absent_or_cross_tenant_binding_never_calls_policy_or_reader(
    tmp_path: Path,
) -> None:
    reader = _setup(tmp_path)
    with _policy_server() as server:
        adapter = _adapter(server)
        server.source_allowed = True
        for binding in (
            None,
            SnapshotPolicyBinding(
                tenant_id="tenant-b", capture_id=CAPTURE, policy_ref=POLICY_REF
            ),
        ):
            resolver = _BindingResolver(binding=binding)
            with pytest.raises(SourceReadNotQualified):
                _read(adapter=adapter, reader=reader, binding=resolver)
            assert resolver.calls == 1
        assert reader.calls == 0
        assert server.requests == []
