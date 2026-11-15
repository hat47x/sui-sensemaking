"""R2 F0 source-read grant reference, NOT a Product API or verified Host Grant.

A real Host must supply the authenticated principal, tenant, source policy
binding and suitable policy adapter. Document authorization does not qualify.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from sui_sensemaking_api.access_control import (
    AccessControlAdapter,
    AccessRequest,
    AccessResource,
    AuthContext,
    resolve_access_decision,
)
from sui_sensemaking_api.tenant_context import TenantContext


class SourceReadNotQualified(RuntimeError):
    """One non-disclosing error for absent, mismatched or denied Source grant."""


@dataclass(frozen=True)
class SnapshotPolicyBinding:
    tenant_id: str
    capture_id: str
    policy_ref: str


class SnapshotPolicyBindingResolver(Protocol):
    """Server-owned Source-specific policy binding, never a client header."""

    def resolve(
        self, *, tenant: TenantContext, capture_id: str
    ) -> SnapshotPolicyBinding | None: ...


class SnapshotReader(Protocol):
    def read(
        self, *, tenant_id: str, capture_id: str, expected_sha256: str
    ) -> bytes: ...


def read_authorized_snapshot_reference(
    *,
    tenant: TenantContext,
    principal: AuthContext,
    capture_id: str,
    expected_sha256: str,
    policy_binding_resolver: SnapshotPolicyBindingResolver,
    adapter: AccessControlAdapter,
    reader: SnapshotReader,
) -> bytes:
    """Test-only composition around existing access_control decision logic.

    A caller-provided TenantContext or AuthContext is NOT intrinsically
    trusted. The Product must acquire both from its validated auth edge.
    """
    if (
        not capture_id
        or len(capture_id) > 128
        or not principal.actor_ref
        or not principal.provider
        or getattr(adapter, "name", None) == "noop"
    ):
        raise SourceReadNotQualified("source read unavailable")

    try:
        binding = policy_binding_resolver.resolve(
            tenant=tenant, capture_id=capture_id
        )
    except Exception:
        raise SourceReadNotQualified("source read unavailable") from None

    if (
        binding is None
        or binding.tenant_id != tenant.tenant_id
        or binding.capture_id != capture_id
        or not binding.policy_ref
    ):
        raise SourceReadNotQualified("source read unavailable")

    # Existing AccessResource has a document-named ID field; its distinct kind
    # makes this a Source request. The external PDP must enforce this kind.
    request = AccessRequest(
        action="read",
        auth=principal,
        tenant=tenant,
        resource=AccessResource(
            doc_id=capture_id,
            kind="source_snapshot",
            visibility="Restricted",
            tenant_id=binding.tenant_id,
            policy_ref=binding.policy_ref,
        ),
    )
    decision = resolve_access_decision(
        adapter=adapter,
        request=request,
        fail_safe_mode="deny",
        require_tenant_scope=True,
    )
    if not decision.allow:
        raise SourceReadNotQualified("source read unavailable")

    return reader.read(
        tenant_id=tenant.tenant_id,
        capture_id=capture_id,
        expected_sha256=expected_sha256,
    )
