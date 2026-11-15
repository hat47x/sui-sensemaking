"""R2 internal Source read path: request, Source metadata, policy, Raw bytes.

Tests use a real loopback HTTP policy exchange and synthetic trusted metadata;
there is no Product Source endpoint, trusted storage registry, or real PDP.
"""
from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from dataclasses import dataclass, replace
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from experiments.r2_immutable_snapshot_reference import LocalImmutableSnapshotReference
from sui_sensemaking_api.access_control import (
    AccessDecision,
    AccessRequest,
    AccessResource,
    AuthContext,
    ExternalPolicyAccessControlAdapter,
    ExternalPolicyAdapterConfig,
    NoopAccessControlAdapter,
)
from sui_sensemaking_api.auth_context import ResolvedIdentity
from sui_sensemaking_api.source_snapshot_read_gate import (
    SourceSnapshotReadAuthority,
    SourceSnapshotReadUnavailable,
    read_source_snapshot_for_member,
)
from sui_sensemaking_api.tenant_context import TenantContext

RAW = b"\xef\xbb\xbf" + "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊".encode("utf-8")
DIGEST = sha256(RAW).hexdigest()
TENANT = TenantContext(
    tenant_id="tenant-a", membership_id="membership-a",
    resolved_by="verified_claim",
)
IDENTITY = ResolvedIdentity(
    user_id="member-a",
    reviewer_ref=None,
    owner_ref=None,
    auth_context=AuthContext(
        actor_ref="member-a", user_id="member-a", provider="oidc"
    ),
)
VERSION_HEADER = "Sui-Sensemaking-Tenant-Session-Version"


class _PolicyServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _Handler)
        self.source_allowed = False
        self.mode = "normal"
        self.requests: list[dict] = []


class _Handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        policy = self.server
        assert isinstance(policy, _PolicyServer)
        length = int(self.headers["Content-Length"])
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        policy.requests.append(body)
        if policy.mode == "unavailable":
            status, response = 503, b"unavailable"
        elif policy.mode == "invalid":
            status, response = 200, b'{"allow":"true"}'
        else:
            resource = body["resource"]
            grant_is_source = (
                resource["kind"] == "source_snapshot"
                and resource["docId"] == "capture-a"
                and resource["tenantId"] == "tenant-a"
                and resource["policyRef"] == "source-only-policy"
                and body["tenant"]["tenantId"] == "tenant-a"
                and body["auth"]["actorRef"] == "member-a"
                and body["action"] == "read"
            )
            grant_is_document = (
                resource["kind"] == "document"
                and resource["policyRef"] == "document-policy"
            )
            response = json.dumps({
                "allow": grant_is_document or (grant_is_source and policy.source_allowed)
            }).encode("utf-8")
            status = 200
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format: str, *args: object) -> None:
        return


@contextmanager
def _policy_server():
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
class _Metadata:
    row: SourceSnapshotReadAuthority | None
    calls: int = 0
    error: bool = False

    def resolve(self, *, tenant: TenantContext, capture_id: str):
        self.calls += 1
        if self.error:
            raise RuntimeError("raw source registry secret")
        return self.row


@dataclass
class _SourcePolicy:
    policy_ref: str | None = "source-only-policy"
    calls: int = 0
    error: bool = False

    def resolve(
        self, *, tenant: TenantContext, capture_id: str,
        binding_id: str, policy_version: str,
    ):
        self.calls += 1
        if self.error:
            raise RuntimeError("private policy endpoint secret")
        assert (tenant.tenant_id, capture_id, binding_id, policy_version) == (
            "tenant-a", "capture-a", "source-binding-a", "policy-v1",
        )
        return self.policy_ref


@dataclass
class _RawReader:
    store: LocalImmutableSnapshotReference
    calls: int = 0

    def read(self, *, tenant_id: str, capture_id: str, expected_sha256: str):
        self.calls += 1
        return self.store.read(
            tenant_id=tenant_id,
            capture_id=capture_id,
            expected_sha256=expected_sha256,
        )


def _authority(**changes) -> SourceSnapshotReadAuthority:
    values = {
        "tenant_id": "tenant-a",
        "capture_id": "capture-a",
        "byte_size": len(RAW),
        "sha256_digest": DIGEST,
        "policy_binding_id": "source-binding-a",
        "policy_version": "policy-v1",
    }
    values.update(changes)
    return SourceSnapshotReadAuthority(**values)


@contextmanager
def _environment(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *, authority: SourceSnapshotReadAuthority | None = None,
    identity: ResolvedIdentity = IDENTITY,
    runtime_profile: str = "saas-multitenant",
):
    store = LocalImmutableSnapshotReference(tmp_path / "raw")
    store.put_once(tenant_id="tenant-a", capture_id="capture-a", raw=RAW)
    reader = _RawReader(LocalImmutableSnapshotReference(tmp_path / "raw"))
    metadata = _Metadata(row=authority if authority is not None else _authority())
    source_policy = _SourcePolicy()
    trusted_calls: list[str] = []

    def trusted(*, request: Request, db: object):
        trusted_calls.append("trusted")
        return SimpleNamespace(
            identity=identity, tenant=TENANT,
            session=SimpleNamespace(tenant_session_version="version-2"),
        )

    monkeypatch.setattr(
        "sui_sensemaking_api.source_member_context.resolve_trusted_saas_request_session",
        trusted,
    )
    with _policy_server() as server:
        adapter = ExternalPolicyAccessControlAdapter(
            config=ExternalPolicyAdapterConfig(
                endpoint=f"http://127.0.0.1:{server.server_port}/decide",
                timeout_seconds=2.0,
            )
        )
        app = FastAPI()
        app.state.runtime_profile = runtime_profile
        context = {
            "metadata": metadata, "policy": source_policy, "raw": reader,
            "server": server, "adapter": adapter, "trusted_calls": trusted_calls,
        }

        @app.get("/_r2_test_read")
        def read(request: Request, capture_id: str = "capture-a"):
            try:
                raw = read_source_snapshot_for_member(
                    request=request, db=object(),
                    capture_id=capture_id,
                    authority_resolver=metadata,
                    source_policy_resolver=source_policy,
                    policy_adapter=context["adapter"],
                    raw_reader=reader,
                )
            except SourceSnapshotReadUnavailable:
                raise HTTPException(
                    status_code=404, detail="source unavailable"
                ) from None
            return {"rawHex": raw.hex()}

        with TestClient(app) as client:
            yield client, context


def _request(client: TestClient, **kwargs):
    return client.get(
        "/_r2_test_read", headers={VERSION_HEADER: "version-2"}, **kwargs,
    )


def test_explicit_current_source_allow_reads_exact_raw_and_second_span(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        response = _request(client)
        assert response.status_code == 200
        recovered = bytes.fromhex(response.json()["rawHex"])
        repeated = "同じ言葉。🌊".encode("utf-8")
        second = RAW.index(repeated, RAW.index(repeated) + len(repeated))
        assert recovered == RAW
        assert recovered[second:second + len(repeated)] == repeated
        assert data["trusted_calls"] == ["trusted"]
        assert data["metadata"].calls == 1
        assert data["policy"].calls == 1
        assert data["raw"].calls == 1
        assert len(data["server"].requests) == 1


def test_document_read_allow_is_not_a_source_grant(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        adapter = data["adapter"]
        document = adapter.authorize(AccessRequest(
            action="read",
            auth=IDENTITY.auth_context,
            tenant=TENANT,
            resource=AccessResource(
                doc_id="doc-a", kind="document", tenant_id="tenant-a",
                visibility="Restricted", policy_ref="document-policy",
            ),
        ))
        assert document.allow
        response = _request(client)
        assert response.status_code == 404
        assert data["raw"].calls == 0
        assert [r["resource"]["kind"] for r in data["server"].requests] == [
            "document", "source_snapshot",
        ]


def test_revocation_is_rechecked_on_every_request(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        assert _request(client).status_code == 200
        data["server"].source_allowed = False
        assert _request(client).status_code == 404
        assert data["raw"].calls == 1
        assert len(data["server"].requests) == 2


@pytest.mark.parametrize("changes", [
    {"tenant_id": "tenant-b"},
    {"capture_id": "other-capture"},
    {"sha256_digest": "not-a-digest"},
    {"byte_size": 0},
    {"policy_binding_id": ""},
    {"policy_version": ""},
])
def test_invalid_source_authority_never_contacts_pdp_or_raw(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, changes: dict,
) -> None:
    with _environment(monkeypatch, tmp_path, authority=_authority(**changes)) as (client, data):
        response = _request(client)
        assert response.status_code == 404
        assert response.text.find("source-binding-a") == -1
        assert data["metadata"].calls == 1
        assert data["policy"].calls == 0
        assert data["server"].requests == []
        assert data["raw"].calls == 0


@pytest.mark.parametrize("mode", ["unavailable", "invalid"])
def test_source_pdp_error_does_not_fall_back_to_raw(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, mode: str,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].mode = mode
        response = _request(client)
        assert response.status_code == 404
        assert data["raw"].calls == 0
        assert "secret" not in response.text


def test_source_policy_binding_missing_or_unavailable_does_not_read(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["policy"].policy_ref = None
        assert _request(client).status_code == 404
        data["policy"].error = True
        response = _request(client)
        assert response.status_code == 404
        assert "private policy" not in response.text
        assert data["server"].requests == []
        assert data["raw"].calls == 0


def test_source_authority_failure_does_not_expose_source_identity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["metadata"].error = True
        response = _request(client)
        assert response.status_code == 404
        assert "registry secret" not in response.text
        assert data["raw"].calls == 0


def test_bad_raw_byte_or_metadata_digest_is_not_returned(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        stored = data["raw"].store._target("tenant-a", "capture-a")
        stored.write_bytes(b"tampered")
        response = _request(client)
        assert response.status_code == 404
        assert "tampered" not in response.text
        assert data["raw"].calls == 1


def test_missing_session_denies_before_source_metadata(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        response = client.get("/_r2_test_read")
        assert response.status_code == 409
        assert data["metadata"].calls == 0
        assert data["server"].requests == []
        assert data["raw"].calls == 0


def test_noop_adapter_is_rejected_without_source_lookup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["adapter"] = NoopAccessControlAdapter()
        response = _request(client)
        assert response.status_code == 404
        assert data["metadata"].calls == 0
        assert data["raw"].calls == 0


def test_source_metadata_absence_fails_before_binding_or_policy(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["metadata"].row = None
        response = _request(client)
        assert response.status_code == 404
        assert data["metadata"].calls == 1
        assert data["policy"].calls == 0
        assert data["server"].requests == []
        assert data["raw"].calls == 0


@pytest.mark.parametrize("principal", [
    AuthContext(actor_ref="different-member", user_id="member-a", provider="oidc"),
    AuthContext(actor_ref="member-a", user_id="different-member", provider="oidc"),
    AuthContext(actor_ref="member-a", user_id=None, provider="oidc"),
])
def test_wrong_principal_disallows_source_lookup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, principal: AuthContext,
) -> None:
    # Even a server-provided session object must not send an unrelated
    # actorRef to Source PDP or expose whether a capture exists.
    identity = replace(IDENTITY, auth_context=principal)
    with _environment(monkeypatch, tmp_path, identity=identity) as (client, data):
        response = _request(client)
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "source_member_context_unavailable"
        assert data["trusted_calls"] == ["trusted"]
        assert data["metadata"].calls == 0
        assert data["policy"].calls == 0
        assert data["server"].requests == []
        assert data["raw"].calls == 0


@pytest.mark.parametrize("imposter", ["same-name", "subclass", "fake-class"])
def test_policy_adapter_name_or_subclass_cannot_impersonate_http_pdp(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, imposter: str,
) -> None:
    class NameMatchedImposter:
        name = "external_http"

        def authorize(self, request: AccessRequest) -> AccessDecision:
            _ = request
            return AccessDecision(allow=True)

    class InheritedImposter(ExternalPolicyAccessControlAdapter):
        def authorize(self, request: AccessRequest) -> AccessDecision:
            _ = request
            return AccessDecision(allow=True)

    class FakeClassImposter:
        name = "external_http"

        @property
        def __class__(self) -> type[ExternalPolicyAccessControlAdapter]:
            return ExternalPolicyAccessControlAdapter

        def authorize(self, request: AccessRequest) -> AccessDecision:
            _ = request
            return AccessDecision(allow=True)

    with _environment(monkeypatch, tmp_path) as (client, data):
        if imposter == "same-name":
            data["adapter"] = NameMatchedImposter()
        elif imposter == "fake-class":
            data["adapter"] = FakeClassImposter()
        else:
            data["adapter"] = InheritedImposter(config=data["adapter"]._config)
        response = _request(client)
        assert response.status_code == 404
        assert data["trusted_calls"] == ["trusted"]
        assert data["metadata"].calls == 0
        assert data["policy"].calls == 0
        assert data["server"].requests == []
        assert data["raw"].calls == 0
