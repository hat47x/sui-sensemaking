"""The shared access decision must never relax Source Snapshot reads.

This is a runtime guard independent of the R2 Reference wrapper. The test
does not establish trusted principal provenance, Source policy provenance,
real Product Source endpoints, or genuine external PDP enforcement.
"""
from __future__ import annotations

from dataclasses import replace

import pytest

from sui_sensemaking_api.access_control import (
    AccessControlInvalidPolicyError,
    AccessControlUnreachableError,
    AccessDecision,
    AccessRequest,
    AccessResource,
    AuthContext,
    MockAccessControlAdapter,
    NoopAccessControlAdapter,
    resolve_access_decision,
)
from sui_sensemaking_api.tenant_context import TenantContext

TENANT = TenantContext(
    tenant_id="tenant-a",
    membership_id="member-a",
    resolved_by="verified_claim",
)
PRINCIPAL = AuthContext(actor_ref="member-a", user_id="member-a", provider="oidc")


class RecordingPolicy:
    name = "external-policy-test-double"

    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error
        self.calls = 0

    def authorize(self, request: AccessRequest) -> AccessDecision:  # noqa: ARG002
        self.calls += 1
        if self.error is not None:
            raise self.error
        return AccessDecision(allow=True)


def _source_request() -> AccessRequest:
    return AccessRequest(
        action="read",
        tenant=TENANT,
        auth=PRINCIPAL,
        resource=AccessResource(
            doc_id="capture-a",
            tenant_id="tenant-a",
            kind="source_snapshot",
            visibility="Restricted",
            policy_ref="source-policy",
        ),
    )


@pytest.mark.parametrize("error", [
    AccessControlUnreachableError("PDP unreachable"),
    AccessControlInvalidPolicyError("PDP rejected Source"),
    RuntimeError("PDP raised unexpectedly"),
])
def test_source_never_inherits_document_read_only_fallback(error: Exception) -> None:
    adapter = RecordingPolicy(error=error)
    decision = resolve_access_decision(
        adapter=adapter, request=_source_request(),
        fail_safe_mode="read_only",
        require_tenant_scope=False,
    )
    assert not decision.allow
    assert adapter.calls == 1


def test_document_read_only_compatibility_is_unchanged() -> None:
    adapter = RecordingPolicy(error=AccessControlUnreachableError("PDP down"))
    doc = replace(
        _source_request(),
        resource=replace(_source_request().resource, kind="document"),
    )
    decision = resolve_access_decision(
        adapter=adapter, request=doc,
        fail_safe_mode="read_only",
        require_tenant_scope=False,
    )
    assert decision.allow and decision.read_only
    assert adapter.calls == 1


@pytest.mark.parametrize("adapter", [
    NoopAccessControlAdapter(),
    MockAccessControlAdapter(),
])
def test_source_never_accepts_built_in_allow_all_or_mock_adapter(adapter) -> None:
    decision = resolve_access_decision(
        adapter=adapter, request=_source_request(),
        fail_safe_mode="read_only",
        require_tenant_scope=False,
    )
    assert not decision.allow
    assert decision.reason == "source_grant_unavailable"


@pytest.mark.parametrize("change", [
    {"auth": None},
    {"auth": AuthContext(actor_ref=None, provider="oidc")},
    {"auth": AuthContext(actor_ref="member-a", provider=None)},
    {"resource": AccessResource(
        doc_id="capture-a", tenant_id="tenant-a",
        kind="source_snapshot", visibility="Restricted", policy_ref=None,
    )},
])
def test_source_missing_identity_or_policy_fails_before_adapter(change: dict) -> None:
    adapter = RecordingPolicy()
    request = replace(_source_request(), **change)
    decision = resolve_access_decision(
        adapter=adapter, request=request,
        fail_safe_mode="read_only",
        require_tenant_scope=False,
    )
    assert not decision.allow
    assert adapter.calls == 0


@pytest.mark.parametrize("scope", [
    None,
    TenantContext(
        tenant_id="tenant-b",
        membership_id="member-b",
        resolved_by="verified_claim",
    ),
])
def test_source_tenant_scope_is_required_even_if_caller_forgets(scope) -> None:
    adapter = RecordingPolicy()
    request = replace(_source_request(), tenant=scope)
    decision = resolve_access_decision(
        adapter=adapter, request=request,
        fail_safe_mode="read_only",
        require_tenant_scope=False,
    )
    assert not decision.allow
    assert adapter.calls == 0


@pytest.mark.parametrize("action", ["write", "export", "share"])
def test_source_other_actions_are_not_implicitly_granted(action: str) -> None:
    adapter = RecordingPolicy()
    request = replace(_source_request(), action=action)
    decision = resolve_access_decision(
        adapter=adapter, request=request,
        fail_safe_mode="read_only",
        require_tenant_scope=False,
    )
    assert not decision.allow
    assert adapter.calls == 0


def test_explicit_source_policy_allow_still_reaches_adapter() -> None:
    adapter = RecordingPolicy()
    decision = resolve_access_decision(
        adapter=adapter, request=_source_request(),
        fail_safe_mode="read_only",
        require_tenant_scope=False,
    )
    assert decision.allow
    assert adapter.calls == 1
