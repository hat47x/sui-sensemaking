"""R2 internal Source read path: request, Source metadata, policy, Raw bytes.

Tests use a real loopback HTTP policy exchange and synthetic trusted metadata;
there is no Product Source endpoint, trusted storage registry, or real PDP.
"""
from __future__ import annotations

import json
import threading
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, replace
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

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
from sui_sensemaking_api.content_store import ContentBlob
from sui_sensemaking_api.database_content_store import DatabaseDocumentContentStore
from sui_sensemaking_api.document_access_resource import ServerOwnedDocumentResourceResolver
from sui_sensemaking_api.models import (
    Base,
    CanvasRevisionHeadRow,
    DocumentAccessMetadataRow,
    DocumentRow,
    TenantRow,
)
from sui_sensemaking_api.source_snapshot_read_gate import (
    AuthorizedCardSourceSelection,
    RawSelectionContentCheckpoint,
    SourceSnapshotReadAuthority,
    SourceSnapshotReadUnavailable,
    read_pinned_card_source_selection_for_member,
    read_source_selection_for_member,
    read_source_snapshot_for_member,
)
from sui_sensemaking_api.tenant_context import TenantContext

RAW = b"\xef\xbb\xbf" + "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊".encode("utf-8")
DIGEST = sha256(RAW).hexdigest()
# Independently fixed in frontend/src/source/raw_utf8_selection_reference.test.ts
SECOND_TEXT = "同じ言葉。🌊"
SECOND_SPAN_START = 38
SECOND_SPAN_END = 57
SECOND_SHA256 = "6b39ef0ed8a5f5771807dc348b88b79fc716b3ec6cdf541b24fbd6f4b0f53df7"
assert DIGEST == "0d92d8f8852fffe376d1af5655ffea572b4989de7a77de64b182ee47a8ff20cf"
assert RAW[SECOND_SPAN_START:SECOND_SPAN_END] == SECOND_TEXT.encode("utf-8")
assert sha256(RAW[SECOND_SPAN_START:SECOND_SPAN_END]).hexdigest() == SECOND_SHA256
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
        self.document_allowed = True
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
                and resource["docId"] == "doc-a"
                and resource["tenantId"] == "tenant-a"
                and body["auth"]["actorRef"] == "member-a"
                and policy.document_allowed
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
    after_read: Callable[[], None] | None = None

    def read(self, *, tenant_id: str, capture_id: str, expected_sha256: str):
        self.calls += 1
        data = self.store.read(
            tenant_id=tenant_id,
            capture_id=capture_id,
            expected_sha256=expected_sha256,
        )
        # Model a concurrent Document or policy change during Raw retrieval.
        if self.after_read is not None:
            self.after_read()
        return data


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


@dataclass
class _AuthorizedSavedCard:
    row: AuthorizedCardSourceSelection | None
    calls: int = 0
    denied: bool = False
    unavailable: bool = False

    def resolve_authorized(
        self, *, member, document_id: str, card_id: str,
    ) -> AuthorizedCardSourceSelection | None:
        self.calls += 1
        if self.unavailable:
            raise RuntimeError("private saved selection store")
        if self.denied:
            return None
        assert member.principal.actor_ref == "member-a"
        assert member.tenant.tenant_id == "tenant-a"
        return self.row


def _saved_card(**changes) -> AuthorizedCardSourceSelection:
    values = {
        "tenant_id": "tenant-a",
        "document_id": "doc-a",
        "card_id": "card-a",
        "capture_id": "capture-a",
        "document_version": 1,
        "document_head_version": 1,
        "document_revision_id": "unbound-test-only",
        "checkpoint": RawSelectionContentCheckpoint(
            raw_sha256=DIGEST, selected_sha256=SECOND_SHA256,
            start_byte=SECOND_SPAN_START, end_byte=SECOND_SPAN_END,
        ),
    }
    values.update(changes)
    return AuthorizedCardSourceSelection(**values)


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
        saved = _AuthorizedSavedCard(row=_saved_card())
        context = {
            "metadata": metadata, "policy": source_policy, "raw": reader,
            "server": server, "adapter": adapter, "trusted_calls": trusted_calls,
            "saved": saved,
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

        @app.get("/_r2_test_span")
        def span(
            request: Request,
            start_byte: int = SECOND_SPAN_START,
            end_byte: int = SECOND_SPAN_END,
            raw_sha256: str = DIGEST,
            selected_sha256: str = SECOND_SHA256,
            capture_id: str = "capture-a",
        ):
            # Test-only route; the Product does not yet persist a Source
            # selection or expose a Source endpoint.
            checkpoint = RawSelectionContentCheckpoint(
                raw_sha256=raw_sha256,
                selected_sha256=selected_sha256,
                start_byte=start_byte,
                end_byte=end_byte,
            )
            try:
                observed = read_source_selection_for_member(
                    request=request,
                    db=object(),
                    capture_id=capture_id,
                    checkpoint=checkpoint,
                    authority_resolver=metadata,
                    source_policy_resolver=source_policy,
                    policy_adapter=context["adapter"],
                    raw_reader=reader,
                )
            except SourceSnapshotReadUnavailable:
                raise HTTPException(
                    status_code=404, detail="source unavailable",
                ) from None
            return {
                "startByte": observed.start_byte,
                "endByte": observed.end_byte,
                "selectedText": observed.selected_text,
            }


        @app.get("/_r2_test_pinned_card")
        def pinned_card(
            request: Request,
            document_id: str = "doc-a",
            card_id: str = "card-a",
        ):
            # An internal test-only endpoint. This does not implement a
            # Product Document read decision or accepted Card Binding schema.
            try:
                observed = read_pinned_card_source_selection_for_member(
                    request=request,
                    db=context.get("doc_db", object()),
                    document_id=document_id,
                    card_id=card_id,
                    selection_resolver=saved,
                    document_resource_resolver=context.get("doc_resource_resolver"),
                    authority_resolver=metadata,
                    source_policy_resolver=source_policy,
                    policy_adapter=context["adapter"],
                    raw_reader=reader,
                )
            except SourceSnapshotReadUnavailable:
                raise HTTPException(
                    status_code=404, detail="source unavailable",
                ) from None
            return {
                "startByte": observed.start_byte,
                "endByte": observed.end_byte,
                "selectedText": observed.selected_text,
            }

        with TestClient(app) as client:
            yield client, context


@dataclass
class _DocumentPolicyBinding:
    calls: int = 0

    def resolve(
        self, *, tenant: TenantContext, binding_id: str, policy_version: str,
    ) -> str | None:
        self.calls += 1
        if (tenant.tenant_id, binding_id, policy_version) == (
            "tenant-a", "doc-binding-a", "doc-policy-v1",
        ):
            return "document-policy"
        return None


@contextmanager
def _pinned_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    # Unlike the saved Card resolver (still a test double), Document metadata
    # is loaded through the actual tenant-scoped SQLAlchemy repository.
    engine = create_engine(
        f"sqlite:///{tmp_path / 'pinned-doc.sqlite3'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    try:
        with Session(engine) as db:
            timestamp = "2026-11-15T00:00:00Z"
            db.add(TenantRow(
                id="tenant-a", display_name="Tenant A",
                lifecycle_state="active", created_at=timestamp,
                updated_at=timestamp,
            ))
            db.flush()
            DatabaseDocumentContentStore(db).save(
                tenant=TENANT, doc_id="doc-a", version=1,
                updated_at=timestamp, content=ContentBlob.from_text("{}"),
            )
            db.add(DocumentAccessMetadataRow(
                tenant_id="tenant-a", doc_id="doc-a",
                visibility="Restricted", policy_binding_id="doc-binding-a",
                policy_version="doc-policy-v1", updated_at=timestamp,
            ))
            db.commit()
            head = db.get(CanvasRevisionHeadRow, ("tenant-a", "doc-a", "main"))
            assert head is not None

            def saved_at_current_revision(**changes) -> AuthorizedCardSourceSelection:
                values = {
                    "document_version": 1,
                    "document_head_version": head.head_version,
                    "document_revision_id": head.revision_id,
                }
                values.update(changes)
                return _saved_card(**values)

            binding = _DocumentPolicyBinding()
            doc_resolver = ServerOwnedDocumentResourceResolver(
                policy_binding_resolver=binding,
            )
            with _environment(monkeypatch, tmp_path) as (client, data):
                data["doc_db"] = db
                data["doc_resource_resolver"] = doc_resolver
                data["doc_binding"] = binding
                data["saved_at_current_revision"] = saved_at_current_revision
                data["saved"].row = saved_at_current_revision()
                yield client, data
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


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


def _span_request(client: TestClient, **params):
    return client.get(
        "/_r2_test_span",
        headers={VERSION_HEADER: "version-2"},
        params=params,
    )


def test_authorized_second_ordinal_utf8_span_matches_frontend_checkpoint(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        response = _span_request(client)
        assert response.status_code == 200
        assert response.json() == {
            "startByte": 38,
            "endByte": 57,
            "selectedText": "同じ言葉。🌊",
        }
        assert data["trusted_calls"] == ["trusted"]
        assert len(data["server"].requests) == 1
        assert data["server"].requests[0]["resource"]["kind"] == "source_snapshot"
        assert data["raw"].calls == 1


@pytest.mark.parametrize("params", [
    {"start_byte": 39},  # inside the first UTF-8 byte of the second span
    {"end_byte": 56},    # inside the last Unicode scalar
    {"start_byte": 0, "end_byte": 3},  # leading BOM is not a UI text selection
    {"start_byte": 38, "end_byte": 38},
    {"start_byte": 57, "end_byte": 58},
    {"raw_sha256": "0" * 64},
    {"selected_sha256": "0" * 64},
])
def test_recheck_rejects_invalid_span_digest_or_bom_without_echo(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, params: dict,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        response = _span_request(client, **params)
        assert response.status_code == 404
        assert response.json() == {"detail": "source unavailable"}
        assert "同じ言葉" not in response.text
        assert data["raw"].calls == 1


@pytest.mark.parametrize("start,end", [(39, 57), (38, 56)])
def test_utf8_boundary_is_checked_even_when_selected_digest_matches_invalid_bytes(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, start: int, end: int,
) -> None:
    forged_digest = sha256(RAW[start:end]).hexdigest()
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        response = _span_request(
            client,
            start_byte=start,
            end_byte=end,
            selected_sha256=forged_digest,
        )
        assert response.status_code == 404
        assert data["server"].requests
        assert data["raw"].calls == 1


def test_recheck_rejects_content_drift_outside_selection(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        # A new current Authority and Raw with a changed prefix can authorize
        # Raw bytes, but must NOT validate the older UI selection checkpoint.
        mutated = RAW.replace("前文".encode("utf-8"), "新文".encode("utf-8"))
        changed_digest = sha256(mutated).hexdigest()
        assert len(mutated) == len(RAW)
        data["raw"].store._target("tenant-a", "capture-a").write_bytes(mutated)
        data["metadata"].row = _authority(sha256_digest=changed_digest)
        response = _span_request(client)
        assert response.status_code == 404
        assert data["raw"].calls == 1
        assert "新文" not in response.text


def test_recheck_against_current_grant_revocation_preserves_no_raw_projection(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        assert _span_request(client).status_code == 200
        data["server"].source_allowed = False
        response = _span_request(client)
        assert response.status_code == 404
        assert data["raw"].calls == 1
        assert len(data["server"].requests) == 2


def test_document_only_policy_cannot_recover_selection(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _environment(monkeypatch, tmp_path) as (client, data):
        response = _span_request(client)
        assert response.status_code == 404
        assert data["metadata"].calls == 1
        assert data["raw"].calls == 0


def test_source_checkpoint_does_not_establish_historical_occurrence(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    # Two identical phrases intentionally have the same selected digest.
    # Changing the byte start/end changes the *selection identity* even when
    # a content-only check succeeds. A trusted saved Card binding must fix the
    # original range; this internal helper cannot prove it from bytes alone.
    first = RAW.index(SECOND_TEXT.encode("utf-8"))
    last = RAW.index(SECOND_TEXT.encode("utf-8"), first + 1)
    assert (first, last) == (11, 38)
    with _environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        second = _span_request(client)
        first_response = _span_request(
            client, start_byte=first, end_byte=first + 19,
        )
        assert first_response.status_code == 200
        assert first_response.json()["startByte"] == 11
        assert second.status_code == 200
        assert second.json()["startByte"] == 38
        assert first_response.json()["selectedText"] == second.json()["selectedText"]
        assert data["raw"].calls == 2


def test_pinned_card_selection_preserves_second_same_text_position(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    first = RAW.index(SECOND_TEXT.encode("utf-8"))
    assert first != SECOND_SPAN_START
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        # A client cannot replace a server-saved span by supplying the first
        # position, even though both selections have the same selected digest.
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
            params={"start_byte": first, "end_byte": first + 19},
        )
        assert response.status_code == 200
        assert response.json() == {
            "startByte": SECOND_SPAN_START,
            "endByte": SECOND_SPAN_END,
            "selectedText": SECOND_TEXT,
        }
        assert data["saved"].calls == 2
        assert data["trusted_calls"] == ["trusted"]
        assert data["raw"].calls == 1
        assert [item["resource"]["kind"] for item in data["server"].requests] == [
            "document", "source_snapshot", "document",
        ]


@pytest.mark.parametrize("change", [
    {"tenant_id": "tenant-b"},
    {"document_id": "other-doc"},
    {"card_id": "other-card"},
    {"capture_id": ""},
])
def test_pinned_card_scope_mismatch_never_contacts_source_or_pdp(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, change: dict,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["saved"].row = data["saved_at_current_revision"](**change)
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 1
        assert data["metadata"].calls == 0
        assert data["policy"].calls == 0
        assert [item["resource"]["kind"] for item in data["server"].requests] == ["document"]
        assert data["raw"].calls == 0


@pytest.mark.parametrize("state", ["absent", "denied", "error"])
def test_pinned_card_resolver_missing_denied_or_failed_is_non_disclosing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, state: str,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        if state == "absent":
            data["saved"].row = None
        elif state == "denied":
            data["saved"].denied = True
        else:
            data["saved"].unavailable = True
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert "capture-a" not in response.text
        assert data["saved"].calls == 1
        assert data["metadata"].calls == 0
        assert [item["resource"]["kind"] for item in data["server"].requests] == ["document"]
        assert data["raw"].calls == 0


def test_pinned_card_denies_unauthenticated_before_saved_lookup(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        response = client.get("/_r2_test_pinned_card")
        assert response.status_code == 409
        assert data["saved"].calls == 0
        assert data["metadata"].calls == 0
        assert data["server"].requests == []
        assert data["raw"].calls == 0


def test_pinned_card_rechecks_source_revocation_and_preserves_saved_binding(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        headers = {VERSION_HEADER: "version-2"}
        assert client.get("/_r2_test_pinned_card", headers=headers).status_code == 200
        data["server"].source_allowed = False
        denied = client.get("/_r2_test_pinned_card", headers=headers)
        assert denied.status_code == 404
        assert "同じ言葉" not in denied.text
        assert data["saved"].row == data["saved_at_current_revision"]()
        assert data["saved"].calls == 3
        assert data["trusted_calls"] == ["trusted", "trusted"]
        assert data["raw"].calls == 1
        assert [item["resource"]["kind"] for item in data["server"].requests] == [
            "document", "source_snapshot", "document",
            "document", "source_snapshot",
        ]


def test_pinned_card_wrong_capture_does_not_retarget_to_equal_digest(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        data["saved"].row = data["saved_at_current_revision"](capture_id="another-capture")
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["metadata"].calls == 1
        assert data["policy"].calls == 0
        assert [item["resource"]["kind"] for item in data["server"].requests] == ["document"]
        assert data["raw"].calls == 0


def test_pinned_card_rejects_drifted_checkpoint_after_fresh_source_read(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        data["saved"].row = data["saved_at_current_revision"](checkpoint=RawSelectionContentCheckpoint(
            raw_sha256=DIGEST, selected_sha256=SECOND_SHA256,
            start_byte=SECOND_SPAN_START - 1, end_byte=SECOND_SPAN_END,
        ))
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["raw"].calls == 1
        assert [item["resource"]["kind"] for item in data["server"].requests] == ["document", "source_snapshot"]


def test_document_denial_stops_before_saved_card_or_source_grant(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        data["server"].document_allowed = False
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 0
        assert data["metadata"].calls == 0
        assert data["policy"].calls == 0
        assert data["raw"].calls == 0
        assert [item["resource"]["kind"] for item in data["server"].requests] == [
            "document",
        ]


def test_document_policy_unavailable_does_not_use_read_only_fallback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        data["server"].mode = "unavailable"
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 0
        assert data["raw"].calls == 0
        assert len(data["server"].requests) == 1
        assert data["server"].requests[0]["resource"]["kind"] == "document"


def test_document_policy_binding_removed_in_database_stops_at_document_gate(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        db = data["doc_db"]
        row = db.get(DocumentAccessMetadataRow, ("tenant-a", "doc-a"))
        assert row is not None
        row.policy_version = "unresolved-v2"
        db.commit()
        response = client.get(
            "/_r2_test_pinned_card",
            headers={
                VERSION_HEADER: "version-2",
                "x-doc-visibility": "Public",
                "x-policy-ref": "document-policy",
            },
        )
        assert response.status_code == 404
        assert data["saved"].calls == 0
        assert data["metadata"].calls == 0
        assert data["server"].requests == []
        assert data["raw"].calls == 0


def test_document_missing_row_is_non_disclosing_even_with_source_grant(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        db = data["doc_db"]
        db.query(DocumentAccessMetadataRow).delete()
        db.query(DocumentRow).delete()
        db.commit()
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 0
        assert data["metadata"].calls == 0
        assert data["server"].requests == []
        assert data["raw"].calls == 0


def test_pinned_card_rejects_same_content_after_document_version_advance(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    # A no-op save can advance DocumentRow.version without changing the
    # generation revision. The original Card selection is still versioned.
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        db = data["doc_db"]
        original = data["saved"].row
        assert original is not None
        DatabaseDocumentContentStore(db).save(
            tenant=TENANT, doc_id="doc-a", version=2,
            updated_at="2026-11-15T01:00:00Z",
            content=ContentBlob.from_text("{}"),
        )
        db.commit()
        head = db.get(CanvasRevisionHeadRow, ("tenant-a", "doc-a", "main"))
        assert head is not None
        assert head.revision_id == original.document_revision_id
        assert head.head_version == original.document_head_version
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 1
        assert data["metadata"].calls == 0
        assert data["raw"].calls == 0
        assert [r["resource"]["kind"] for r in data["server"].requests] == ["document"]


def test_pinned_card_rejects_a_b_a_even_when_document_version_reused(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    # Content digest and even a reused client version are insufficient: a
    # persistent revision-head identity/version distinguishes this return.
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        db = data["doc_db"]
        original = data["saved"].row
        assert original is not None
        store = DatabaseDocumentContentStore(db)
        store.save(
            tenant=TENANT, doc_id="doc-a", version=2,
            updated_at="2026-11-15T02:00:00Z",
            content=ContentBlob.from_text('{"changed":true}'),
        )
        db.commit()
        store.save(
            tenant=TENANT, doc_id="doc-a", version=1,
            updated_at="2026-11-15T03:00:00Z",
            content=ContentBlob.from_text("{}"),
        )
        db.commit()
        head = db.get(CanvasRevisionHeadRow, ("tenant-a", "doc-a", "main"))
        row = db.get(DocumentRow, ("tenant-a", "doc-a"))
        assert head is not None and row is not None
        assert row.version == original.document_version
        assert row.payload_json == "{}"
        assert head.revision_id != original.document_revision_id
        assert head.head_version > original.document_head_version
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 1
        assert data["metadata"].calls == 0
        assert data["server"].requests[0]["resource"]["kind"] == "document"
        assert len(data["server"].requests) == 1
        assert data["raw"].calls == 0


@pytest.mark.parametrize("mismatch", [
    {"document_version": 2},
    {"document_version": True},
    {"document_head_version": 2},
    {"document_head_version": True},
    {"document_revision_id": "not-the-current-revision"},
    {"document_revision_id": ""},
])
def test_pinned_card_rejects_noncurrent_or_invalid_revision_receipt(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, mismatch: dict,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        data["saved"].row = data["saved_at_current_revision"](**mismatch)
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 1
        assert data["metadata"].calls == 0
        assert data["policy"].calls == 0
        assert data["raw"].calls == 0
        assert [r["resource"]["kind"] for r in data["server"].requests] == ["document"]


def test_pinned_card_rejects_document_without_revision_head(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        db = data["doc_db"]
        head = db.get(CanvasRevisionHeadRow, ("tenant-a", "doc-a", "main"))
        assert head is not None
        db.delete(head)
        db.commit()
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 1
        assert data["metadata"].calls == 0
        assert data["raw"].calls == 0
        assert len(data["server"].requests) == 1


def test_pinned_card_rejects_document_generation_projection_drift(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    # A raw DB overwrite that bypasses the generation head must not allow
    # the Card selection just because old saved Head IDs still match.
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        db = data["doc_db"]
        row = db.get(DocumentRow, ("tenant-a", "doc-a"))
        assert row is not None
        row.payload_json = '{"tampered":true}'
        db.commit()
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 0
        assert data["metadata"].calls == 0
        assert data["raw"].calls == 0
        assert data["server"].requests == []


def test_pinned_card_rejects_revision_from_other_document_same_tenant(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    # The revision head FK binds tenant+revision, so a same-tenant revision
    # with identical JSON bytes but belonging to doc-b is not a valid doc-a
    # receipt. A matching saved head ID/version must still fail closed.
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        db = data["doc_db"]
        DatabaseDocumentContentStore(db).save(
            tenant=TENANT, doc_id="doc-b", version=1,
            updated_at="2026-11-15T04:00:00Z",
            content=ContentBlob.from_text("{}"),
        )
        db.commit()
        head_a = db.get(CanvasRevisionHeadRow, ("tenant-a", "doc-a", "main"))
        head_b = db.get(CanvasRevisionHeadRow, ("tenant-a", "doc-b", "main"))
        assert head_a is not None and head_b is not None
        assert head_a.revision_id != head_b.revision_id
        head_a.revision_id = head_b.revision_id
        db.commit()
        data["saved"].row = data["saved_at_current_revision"](
            document_revision_id=head_b.revision_id,
        )
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert data["saved"].calls == 1
        assert data["metadata"].calls == 0
        assert data["policy"].calls == 0
        assert data["raw"].calls == 0
        assert [r["resource"]["kind"] for r in data["server"].requests] == ["document"]


@pytest.mark.parametrize("change_during_raw", [
    "document_grant_revoked",
    "document_policy_binding_changed",
    "document_same_bytes_resaved",
    "document_a_b_a",
    "saved_card_rebound",
])
def test_pinned_card_final_validation_rejects_changes_during_raw_read(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
    change_during_raw: str,
) -> None:
    # The first Document and Source PDP requests may both allow. Changes
    # *after* Source authorization but *before* returning Raw still fail.
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        original = data["saved"].row
        assert original is not None

        def change_in_flight() -> None:
            db = data["doc_db"]
            if change_during_raw == "document_grant_revoked":
                data["server"].document_allowed = False
            elif change_during_raw == "document_policy_binding_changed":
                row = db.get(DocumentAccessMetadataRow, ("tenant-a", "doc-a"))
                assert row is not None
                row.policy_version = "revoked-after-source-check"
                db.commit()
            elif change_during_raw == "document_same_bytes_resaved":
                DatabaseDocumentContentStore(db).save(
                    tenant=TENANT, doc_id="doc-a", version=2,
                    updated_at="2026-11-15T05:00:00Z",
                    content=ContentBlob.from_text("{}"),
                )
                db.commit()
            elif change_during_raw == "document_a_b_a":
                store = DatabaseDocumentContentStore(db)
                store.save(
                    tenant=TENANT, doc_id="doc-a", version=2,
                    updated_at="2026-11-15T06:00:00Z",
                    content=ContentBlob.from_text('{"intermediate":true}'),
                )
                db.commit()
                store.save(
                    tenant=TENANT, doc_id="doc-a", version=1,
                    updated_at="2026-11-15T07:00:00Z",
                    content=ContentBlob.from_text("{}"),
                )
                db.commit()
            else:
                data["saved"].row = data["saved_at_current_revision"](
                    capture_id="other-capture",
                )
            data["raw"].after_read = None

        data["raw"].after_read = change_in_flight
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 404
        assert SECOND_TEXT not in response.text
        assert "capture-a" not in response.text
        # Source bytes were fetched and locally verified, but never returned.
        assert data["raw"].calls == 1
        kinds = [r["resource"]["kind"] for r in data["server"].requests]
        assert kinds[:2] == ["document", "source_snapshot"]
        assert all(kind == "document" for kind in kinds[2:])
        assert len(kinds) in {2, 3}
        assert data["saved"].calls in {1, 2}


def test_pinned_card_final_read_preserves_original_on_unmodified_session(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    with _pinned_environment(monkeypatch, tmp_path) as (client, data):
        data["server"].source_allowed = True
        response = client.get(
            "/_r2_test_pinned_card",
            headers={VERSION_HEADER: "version-2"},
        )
        assert response.status_code == 200
        assert response.json() == {
            "startByte": SECOND_SPAN_START,
            "endByte": SECOND_SPAN_END,
            "selectedText": SECOND_TEXT,
        }
        assert data["raw"].calls == 1
        assert data["saved"].calls == 2
        assert data["trusted_calls"] == ["trusted"]
        assert [r["resource"]["kind"] for r in data["server"].requests] == [
            "document", "source_snapshot", "document",
        ]
