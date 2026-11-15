"""Member-only preflight for a future Source Snapshot read path.

This prepares an authenticated SaaS member context; it does NOT authorize a
Source, resolve a Source policy binding, read bytes, or expose an HTTP route.
Guest/Agent Document grants cannot be used as Source authority.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from sui_sensemaking_api.access_control import AuthContext
from sui_sensemaking_api.agent_credentials import (
    reject_mixed_credentials,
    request_has_agent_credential,
)
from sui_sensemaking_api.guest_request_auth import GUEST_AUTH_SESSION_COOKIE
from sui_sensemaking_api.saas_request_context import resolve_trusted_saas_request_session
from sui_sensemaking_api.tenant_context import TenantContext
from sui_sensemaking_api.tenant_session_precondition import (
    require_tenant_session_request_precondition,
    tenant_session_precondition_required,
)


@dataclass(frozen=True, slots=True)
class SourceMemberContext:
    """Authenticated scope only, never a Source-read grant or disclosure right."""

    principal: AuthContext
    tenant: TenantContext


def _source_member_unavailable() -> HTTPException:
    # Do not reveal Source existence, identifiers, or credential class.
    return HTTPException(
        status_code=403,
        detail={
            "code": "source_member_context_unavailable",
            "message": "Source read context is unavailable.",
        },
    )


def resolve_source_member_context(
    *, request: Request, db: Session
) -> SourceMemberContext:
    """Reuse the actual SaaS session resolver, not a Document read decision.

    Source reads remain disabled in local/header-only profiles until a distinct
    trusted-host capability is accepted. Presence of a guest credential denies
    even if it is malformed; an Agent credential never falls through to member.
    The real Product caller must still resolve a server-owned Source binding
    and obtain a distinct, current external-policy approval.
    """
    reject_mixed_credentials(request)
    if (
        request_has_agent_credential(request)
        or request.cookies.get(GUEST_AUTH_SESSION_COOKIE) is not None
    ):
        raise _source_member_unavailable()

    if not tenant_session_precondition_required(request):
        raise _source_member_unavailable()

    trusted = resolve_trusted_saas_request_session(request=request, db=db)
    require_tenant_session_request_precondition(
        request=request,
        current_version=trusted.session.tenant_session_version,
    )
    principal = trusted.identity.auth_context
    tenant = trusted.tenant
    if (
        trusted.identity.user_id is None
        # SaaS JWT and authenticated cookie both bind actor_ref and user_id to
        # the same provisioned user; do not send a different actor to Source PDP.
        or principal.actor_ref != trusted.identity.user_id
        or principal.user_id != trusted.identity.user_id
        or not principal.provider
        or principal.provider in {"header", "guest_session", "agent_credential"}
        or not tenant.tenant_id
        or not tenant.membership_id
        or tenant.resolved_by not in {"verified_claim", "trusted_host_mapping"}
    ):
        raise _source_member_unavailable()
    return SourceMemberContext(principal=principal, tenant=tenant)
