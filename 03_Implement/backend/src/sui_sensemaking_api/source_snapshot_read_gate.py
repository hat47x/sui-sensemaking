"""Internal R2 Source Snapshot read path; no public route or accepted schema.

A trusted Host must supply a server-owned Source capture metadata resolver and
Source-specific policy binding resolver. This module cannot authenticate the
origin of those injected resolvers; absent/invalid inputs therefore deny.
Neither Document's policy metadata nor an opaque Raw digest proves a Grant.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Protocol

from fastapi import Request
from sqlalchemy.orm import Session

from sui_sensemaking_api.access_control import (
    AccessControlAdapter,
    AccessRequest,
    AccessResource,
    ExternalPolicyAccessControlAdapter,
    resolve_access_decision,
)
from sui_sensemaking_api.source_member_context import resolve_source_member_context
from sui_sensemaking_api.tenant_context import TenantContext

_DIGEST_RE = re.compile(r"[0-9a-f]{64}\Z")
_CAPTURE_MAX_LENGTH = 128
_POLICY_KEY_MAX_LENGTH = 128
_POLICY_REF_MAX_LENGTH = 2048


class SourceSnapshotReadUnavailable(RuntimeError):
    """A deliberately non-disclosing Source read failure."""


@dataclass(frozen=True, slots=True)
class SourceSnapshotReadAuthority:
    """Candidate internal lookup result, NOT a deployed DB or API schema.

    The record binds one capture occurrence to Raw bytes and a Source-only
    policy binding. The raw policy reference is resolved at read time.
    """

    tenant_id: str
    capture_id: str
    byte_size: int
    sha256_digest: str
    policy_binding_id: str
    policy_version: str


class SourceSnapshotAuthorityResolver(Protocol):
    """Trusted Host lookup; client headers cannot supply these fields."""

    def resolve(
        self, *, tenant: TenantContext, capture_id: str
    ) -> SourceSnapshotReadAuthority | None: ...


class SourceSnapshotPolicyResolver(Protocol):
    """Resolve a Source policy; Document policy binding is not sufficient."""

    def resolve(
        self, *, tenant: TenantContext, capture_id: str,
        binding_id: str, policy_version: str,
    ) -> str | None: ...


class SourceRawReader(Protocol):
    def read(
        self, *, tenant_id: str, capture_id: str, expected_sha256: str
    ) -> bytes: ...


def _canonical(value: object, limit: int) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= limit
        and value.strip() == value
        and all(character.isprintable() for character in value)
    )


def _qualified_authority(
    authority: object, *, tenant: TenantContext, capture_id: str
) -> bool:
    return (
        isinstance(authority, SourceSnapshotReadAuthority)
        and authority.tenant_id == tenant.tenant_id
        and authority.capture_id == capture_id
        and _canonical(authority.policy_binding_id, _POLICY_KEY_MAX_LENGTH)
        and _canonical(authority.policy_version, _POLICY_KEY_MAX_LENGTH)
        and type(authority.byte_size) is int
        and authority.byte_size > 0
        and isinstance(authority.sha256_digest, str)
        and _DIGEST_RE.fullmatch(authority.sha256_digest) is not None
    )


def read_source_snapshot_for_member(
    *,
    request: Request,
    db: Session,
    capture_id: str,
    authority_resolver: SourceSnapshotAuthorityResolver,
    source_policy_resolver: SourceSnapshotPolicyResolver,
    policy_adapter: AccessControlAdapter,
    raw_reader: SourceRawReader,
) -> bytes:
    """Current one-request check: member -> Source metadata -> PDP -> bytes.

    Nothing here is a bearer capability or a cached Grant. A subsequent read
    must repeat the decision. Export/disclosure are separate operations.
    """
    if not _canonical(capture_id, _CAPTURE_MAX_LENGTH):
        raise SourceSnapshotReadUnavailable("source unavailable")
    # Authenticate before even looking up Source existence.
    member = resolve_source_member_context(request=request, db=db)
    # Name-only matching permits a mock to impersonate an HTTP PDP. Until a
    # trusted pluggable policy-provider contract is admitted, require the exact
    # production HTTP adapter rather than a name-matched substitute/subclass.
    if type(policy_adapter) is not ExternalPolicyAccessControlAdapter:
        raise SourceSnapshotReadUnavailable("source unavailable")

    try:
        authority = authority_resolver.resolve(
            tenant=member.tenant, capture_id=capture_id,
        )
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None
    if not _qualified_authority(
        authority, tenant=member.tenant, capture_id=capture_id,
    ):
        raise SourceSnapshotReadUnavailable("source unavailable")

    try:
        policy_ref = source_policy_resolver.resolve(
            tenant=member.tenant,
            capture_id=capture_id,
            binding_id=authority.policy_binding_id,
            policy_version=authority.policy_version,
        )
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None
    if not _canonical(policy_ref, _POLICY_REF_MAX_LENGTH):
        raise SourceSnapshotReadUnavailable("source unavailable")

    decision = resolve_access_decision(
        adapter=policy_adapter,
        request=AccessRequest(
            action="read",
            auth=member.principal,
            tenant=member.tenant,
            resource=AccessResource(
                doc_id=capture_id,  # Existing policy transport field name.
                kind="source_snapshot",
                tenant_id=member.tenant.tenant_id,
                visibility="Restricted",
                policy_ref=policy_ref,
            ),
        ),
        fail_safe_mode="deny",
        require_tenant_scope=True,
    )
    if not decision.allow:
        raise SourceSnapshotReadUnavailable("source unavailable")

    try:
        raw = raw_reader.read(
            tenant_id=member.tenant.tenant_id,
            capture_id=capture_id,
            expected_sha256=authority.sha256_digest,
        )
        if (
            not isinstance(raw, bytes)
            or len(raw) != authority.byte_size
            or sha256(raw).hexdigest() != authority.sha256_digest
        ):
            raise SourceSnapshotReadUnavailable("source unavailable")
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None
    return raw
