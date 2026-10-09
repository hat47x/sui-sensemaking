from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from typing import Literal, Protocol

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from sui_sensemaking_api.models import (
    LOCAL_DEFAULT_TENANT_ID,
    IdentityProviderRow,
    TenantIdentityProviderRow,
    TenantMembershipRow,
    TenantRow,
    UserIdentityRow,
    UserRow,
)


TenantResolutionMethod = Literal[
    "single_tenant_adapter",
    "verified_claim",
    "trusted_host_mapping",
    "guest_session",
    "agent_credential",
]


@dataclass(frozen=True, slots=True)
class TenantContext:
    tenant_id: str
    membership_id: str | None
    resolved_by: TenantResolutionMethod


@dataclass(frozen=True, slots=True)
class VerifiedTenantClaim:
    """Tenant evidence after signature, issuer and audience validation at the auth edge."""

    tenant_id: str
    identity_provider_id: str
    issuer: str
    audience: str
    subject: str


@dataclass(frozen=True, slots=True)
class TenantSummary:
    tenant_id: str
    display_name: str


class TenantContextResolver(Protocol):
    # ADR-0063 D7: claim is optional for backward compatibility with single-tenant
    # profile. SaaS profile must pass a VerifiedTenantClaim.
    def resolve(
        self,
        *,
        db: Session,
        user_id: str | None,
        claim: VerifiedTenantClaim | None = None,
    ) -> TenantContext:
        ...


class SingleTenantContextResolver:
    def resolve(
        self,
        *,
        db: Session,
        user_id: str | None,
        claim: VerifiedTenantClaim | None = None,
    ) -> TenantContext:
        return resolve_single_tenant_context(db=db, user_id=user_id)


class ClaimBasedTenantContextResolver:
    """ADR-0063 D9-4: SaaS tenant resolver that delegates to
    resolve_verified_claim_tenant_context() with the auth-edge claim."""

    def resolve(
        self,
        *,
        db: Session,
        user_id: str | None,
        claim: VerifiedTenantClaim | None = None,
    ) -> TenantContext:
        if claim is None:
            _deny_untrusted_tenant_context()
        return resolve_verified_claim_tenant_context(
            db=db,
            user_id=user_id,
            claim=claim,
        )


LOCAL_DEFAULT_TENANT_CONTEXT = TenantContext(
    tenant_id=LOCAL_DEFAULT_TENANT_ID,
    membership_id=None,
    resolved_by="single_tenant_adapter",
)


def _opaque_membership_id(*, tenant_id: str, user_id: str) -> str:
    digest = sha256(f"{tenant_id}\x00{user_id}".encode("utf-8")).hexdigest()[:24]
    return f"membership-{digest}"


def _deny_inactive_membership() -> None:
    raise HTTPException(
        status_code=403,
        detail={
            "code": "tenant_membership_inactive",
            "message": "Active tenant membership is required.",
        },
    )


def _deny_untrusted_tenant_context() -> None:
    raise HTTPException(
        status_code=403,
        detail={
            "code": "tenant_context_untrusted",
            "message": "Verified tenant context is required.",
        },
    )


def _active_membership_context(
    *,
    db: Session,
    user_id: str,
    tenant_id: str,
    resolved_by: TenantResolutionMethod,
    # SEC-HTTP-02: intentional anti-enumeration asymmetry (api.md §10.2):
    # - Current tenant membership inactive → 403 tenant_membership_inactive
    # - Switch target not available → 404 tenant_not_available
    # Unknown tenants must not be distinguishable from forbidden ones.
    unavailable_status: Literal["forbidden", "not_found"],
) -> TenantContext:
    user = db.get(UserRow, user_id)
    tenant = db.get(TenantRow, tenant_id)
    membership = db.get(TenantMembershipRow, (tenant_id, user_id))
    active = (
        user is not None
        and user.lifecycle_state == "active"
        and tenant is not None
        and tenant.lifecycle_state == "active"
        and membership is not None
        and membership.lifecycle_state == "active"
    )
    if not active:
        if unavailable_status == "not_found":
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "tenant_not_available",
                    "message": "Requested tenant is not available.",
                },
            )
        _deny_inactive_membership()

    return TenantContext(
        tenant_id=tenant_id,
        membership_id=_opaque_membership_id(tenant_id=tenant_id, user_id=user_id),
        resolved_by=resolved_by,
    )


def resolve_single_tenant_context(
    *,
    db: Session,
    user_id: str | None,
) -> TenantContext:
    """Resolve the compatibility tenant without accepting client tenant input."""
    if user_id is None:
        return LOCAL_DEFAULT_TENANT_CONTEXT

    return _active_membership_context(
        db=db,
        user_id=user_id,
        tenant_id=LOCAL_DEFAULT_TENANT_ID,
        resolved_by="single_tenant_adapter",
        unavailable_status="forbidden",
    )


def resolve_verified_claim_tenant_context(
    *,
    db: Session,
    user_id: str | None,
    claim: VerifiedTenantClaim,
) -> TenantContext:
    """Resolve a tenant only from pre-verified identity evidence and DB bindings."""
    if user_id is None:
        _deny_untrusted_tenant_context()

    provider = db.get(IdentityProviderRow, claim.identity_provider_id)
    tenant_provider = db.get(
        TenantIdentityProviderRow,
        (claim.tenant_id, claim.identity_provider_id),
    )
    identities = db.scalars(
        select(UserIdentityRow)
        .where(UserIdentityRow.identity_provider_id == claim.identity_provider_id)
        .where(UserIdentityRow.subject == claim.subject)
        .limit(2)
    ).all()
    if (
        provider is None
        or provider.lifecycle_state != "active"
        or provider.issuer != claim.issuer
        or provider.audience != claim.audience
        or tenant_provider is None
        or tenant_provider.lifecycle_state != "active"
        or len(identities) != 1
        or identities[0].user_id != user_id
    ):
        _deny_untrusted_tenant_context()

    return _active_membership_context(
        db=db,
        user_id=user_id,
        tenant_id=claim.tenant_id,
        resolved_by="verified_claim",
        unavailable_status="forbidden",
    )


def list_active_tenant_summaries(
    *,
    db: Session,
    user_id: str,
    limit: int | None = None,
) -> tuple[TenantSummary, ...]:
    """Return only active membership tenants; this is not a tenant search API."""
    if limit is not None and limit < 1:
        raise ValueError("tenant summary limit must be positive")
    user = db.get(UserRow, user_id)
    if user is None or user.lifecycle_state != "active":
        return ()
    statement = (
        select(TenantRow.id, TenantRow.display_name)
        .join(
            TenantMembershipRow,
            TenantMembershipRow.tenant_id == TenantRow.id,
        )
        .where(TenantMembershipRow.user_id == user_id)
        .where(TenantMembershipRow.lifecycle_state == "active")
        .where(TenantRow.lifecycle_state == "active")
        .order_by(TenantRow.id.asc())
    )
    if limit is not None:
        statement = statement.limit(limit)
    rows = db.execute(statement).all()
    return tuple(
        TenantSummary(tenant_id=tenant_id, display_name=display_name)
        for tenant_id, display_name in rows
    )


def select_active_tenant_context(
    *,
    db: Session,
    user_id: str,
    tenant_id: str,
    resolved_by: Literal["verified_claim", "trusted_host_mapping"],
) -> TenantContext:
    """Validate a requested switch against the authenticated user's allowlist."""
    return _active_membership_context(
        db=db,
        user_id=user_id,
        tenant_id=tenant_id,
        resolved_by=resolved_by,
        unavailable_status="not_found",
    )


def recheck_trusted_tenant_context(
    *,
    db: Session,
    user_id: str,
    tenant: TenantContext,
) -> TenantContext:
    """Rebuild membership evidence and reject stale or substituted resolver output."""
    if tenant.resolved_by not in {"verified_claim", "trusted_host_mapping"}:
        _deny_untrusted_tenant_context()
    try:
        rechecked = _active_membership_context(
            db=db,
            user_id=user_id,
            tenant_id=tenant.tenant_id,
            resolved_by=tenant.resolved_by,
            unavailable_status="forbidden",
        )
    except HTTPException:
        _deny_untrusted_tenant_context()
    if tenant.membership_id != rechecked.membership_id:
        _deny_untrusted_tenant_context()
    return rechecked
