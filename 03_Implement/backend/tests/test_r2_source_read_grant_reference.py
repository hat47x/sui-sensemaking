"""Read-only R2 Source grant Fit/Gap; no real Source authority is installed."""
from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256

import pytest

from experiments.r2_source_read_grant_reference import (
    SnapshotPolicyBinding,
    SourceReadNotQualified,
    read_authorized_snapshot_reference,
)
from sui_sensemaking_api.access_control import (
    AccessControlUnreachableError,
    AccessDecision,
    AccessRequest,
    AccessResource,
    AuthContext,
    NoopAccessControlAdapter,
    resolve_access_decision,
)
from sui_sensemaking_api.tenant_context import TenantContext

TENANT = TenantContext(
    tenant_id="tenant-a", membership_id="membership-a",
    resolved_by="verified_claim",
)
PRINCIPAL = AuthContext(actor_ref="actor-a", provider="oidc")
RAW = "原資料。".encode("utf-8")
DIGEST = sha256(RAW).hexdigest()


@dataclass
class BindingResolver:
    binding: SnapshotPolicyBinding | None = SnapshotPolicyBinding(
        tenant_id="tenant-a", capture_id="capture-a", policy_ref="source-policy"
    )
    fail: bool = False
    calls: int = 0

    def resolve(self, *, tenant: TenantContext, capture_id: str):
        self.calls += 1
        if self.fail:
            raise RuntimeError("private binding unexpectedly inaccessible")
        return self.binding


@dataclass
class RecordingReader:
    calls: int = 0

    def read(self, *, tenant_id: str, capture_id: str, expected_sha256: str):
        self.calls += 1
        assert (tenant_id, capture_id, expected_sha256) == (
            "tenant-a", "capture-a", DIGEST
        )
        return RAW


@dataclass
class KindAwarePolicy:
    name: str = "test-policy"
    allow_document: bool = True
    allow_source: bool = False
    unavailable: bool = False
    seen: list[AccessRequest] = field(default_factory=list)

    def authorize(self, request: AccessRequest) -> AccessDecision:
        self.seen.append(request)
        if self.unavailable:
            raise AccessControlUnreachableError("policy endpoint unavailable")
        if request.resource.kind == "source_snapshot":
            return AccessDecision(allow=self.allow_source)
        return AccessDecision(allow=self.allow_document)


def _read(*, policy=None, binding=None, reader=None, principal=PRINCIPAL, capture="capture-a"):
    return read_authorized_snapshot_reference(
        tenant=TENANT,
        principal=principal,
        capture_id=capture,
        expected_sha256=DIGEST,
        policy_binding_resolver=binding if binding is not None else BindingResolver(),
        adapter=policy if policy is not None else KindAwarePolicy(),
        reader=reader if reader is not None else RecordingReader(),
    )


def test_document_allow_does_not_grant_source_read() -> None:
    policy = KindAwarePolicy(allow_document=True, allow_source=False)
    assert policy.authorize(
        AccessRequest(action="read", tenant=TENANT, auth=PRINCIPAL,
                      resource=AccessResource(doc_id="document-a", kind="document"))
    ).allow
    reader = RecordingReader()
    with pytest.raises(SourceReadNotQualified, match="source read unavailable"):
        _read(policy=policy, reader=reader)
    assert reader.calls == 0
    assert [req.resource.kind for req in policy.seen] == [
        "document", "source_snapshot"
    ]


def test_specific_source_allow_reads_only_its_scope() -> None:
    policy = KindAwarePolicy(allow_source=True)
    reader = RecordingReader()
    assert _read(policy=policy, reader=reader) == RAW
    assert reader.calls == 1
    req = policy.seen[0]
    assert req.resource.kind == "source_snapshot"
    assert req.resource.policy_ref == "source-policy"
    assert req.resource.doc_id == "capture-a"
    assert req.tenant == TENANT and req.auth == PRINCIPAL


@pytest.mark.parametrize("source_binding", [
    None,
    SnapshotPolicyBinding("tenant-b", "capture-a", "source-policy"),
    SnapshotPolicyBinding("tenant-a", "different-capture", "source-policy"),
    SnapshotPolicyBinding("tenant-a", "capture-a", ""),
])
def test_missing_or_mismatched_binding_fails_before_read(source_binding) -> None:
    resolver = BindingResolver(binding=source_binding)
    policy = KindAwarePolicy(allow_source=True)
    reader = RecordingReader()
    with pytest.raises(SourceReadNotQualified):
        _read(policy=policy, binding=resolver, reader=reader)
    assert resolver.calls == 1
    assert not policy.seen and reader.calls == 0


def test_unavailable_binding_and_missing_principal_are_denied() -> None:
    resolver = BindingResolver(fail=True)
    policy = KindAwarePolicy(allow_source=True)
    reader = RecordingReader()
    with pytest.raises(SourceReadNotQualified) as error:
        _read(policy=policy, binding=resolver, reader=reader)
    assert "private binding" not in str(error.value)
    with pytest.raises(SourceReadNotQualified):
        _read(policy=policy, binding=resolver, reader=reader,
              principal=AuthContext(actor_ref=None, provider="oidc"))
    assert resolver.calls == 1
    assert not policy.seen and reader.calls == 0


def test_noop_document_compatibility_never_qualifies_source() -> None:
    noop = NoopAccessControlAdapter()
    assert noop.authorize(AccessRequest(
        action="read", resource=AccessResource(doc_id="document-a")
    )).allow
    resolver = BindingResolver()
    reader = RecordingReader()
    with pytest.raises(SourceReadNotQualified):
        _read(policy=noop, binding=resolver, reader=reader)
    assert resolver.calls == 0 and reader.calls == 0


def test_source_policy_outage_never_inherits_document_read_only_fallback() -> None:
    policy = KindAwarePolicy(unavailable=True)
    document = resolve_access_decision(
        adapter=policy,
        request=AccessRequest(action="read", tenant=TENANT, auth=PRINCIPAL,
                              resource=AccessResource(
                                  doc_id="document-a", tenant_id="tenant-a",
                                  kind="document", visibility="Restricted",
                                  policy_ref="document-policy",
                              )),
        fail_safe_mode="read_only", require_tenant_scope=True,
    )
    assert document.allow and document.read_only
    reader = RecordingReader()
    with pytest.raises(SourceReadNotQualified):
        _read(policy=policy, reader=reader)
    assert reader.calls == 0
    assert policy.seen[-1].resource.kind == "source_snapshot"


def test_invalid_capture_or_identity_rejected_before_binding_lookup() -> None:
    resolver = BindingResolver()
    policy = KindAwarePolicy(allow_source=True)
    reader = RecordingReader()
    with pytest.raises(SourceReadNotQualified):
        _read(policy=policy, binding=resolver, reader=reader, capture="")
    with pytest.raises(SourceReadNotQualified):
        _read(policy=policy, binding=resolver, reader=reader,
              principal=AuthContext(actor_ref="actor-a", provider=None))
    assert resolver.calls == 0
    assert not policy.seen and reader.calls == 0
