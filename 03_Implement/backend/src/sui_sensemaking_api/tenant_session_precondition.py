from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from sui_sensemaking_api.active_tenant_session import (
    require_current_tenant_session_version,
)
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.runtime_bootstrap import resolve_tenant_session_bootstrap_mode
from sui_sensemaking_api.saas_request_context import resolve_trusted_saas_request_session


TENANT_SESSION_VERSION_HEADER = "Sui-Sensemaking-Tenant-Session-Version"


def tenant_session_precondition_required(request: Request) -> bool:
    """Return whether tenant-scoped APIs require an active-session version."""
    try:
        runtime_profile = request.app.state.runtime_profile
        mode = resolve_tenant_session_bootstrap_mode(runtime_profile)
    except (AttributeError, RuntimeError):
        raise HTTPException(
            status_code=503,
            detail={
                "code": "runtime_policy_unavailable",
                "message": "Runtime policy is unavailable.",
            },
        ) from None
    return mode == "tenant-session-required"


def require_tenant_session_request_precondition(
    *,
    request: Request,
    current_version: str,
) -> None:
    """Check the opaque request version without exposing trusted session state.

    The caller must resolve the trusted identity and active tenant session before
    invoking this guard, and must invoke it before any tenant resource lookup.
    """
    if not tenant_session_precondition_required(request):
        return

    expected_versions = request.headers.getlist(TENANT_SESSION_VERSION_HEADER)
    expected_version = expected_versions[0] if len(expected_versions) == 1 else ""
    require_current_tenant_session_version(
        current_version=current_version,
        expected_version=expected_version,
    )


async def require_tenant_scoped_api_precondition(
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    """Guard tenant-scoped routes that do not otherwise resolve a resource.

    Local profiles remain compatible. SaaS requests resolve the trusted session
    first and reject a missing or stale version before endpoint processing.

    OPS-OBSERV-01: `async def`, not `def`, is deliberate -- see
    `control_plane_auth.require_control_plane_authorization`'s docstring for
    why. This is the *only* place several routes (ai_relations.py, context.py,
    and a number of ai.py routes) resolve a principal at all; if this ran in a
    thread-pool worker, `resolve_trusted_saas_request_session`'s
    `bind_actor_ref_hash` call would set a copied context that the route
    handler's own logging never sees, and those routes' logs would silently
    stay anonymous even for an authenticated SaaS caller.
    """
    if not tenant_session_precondition_required(request):
        return
    trusted_session = resolve_trusted_saas_request_session(
        request=request,
        db=db,
    )
    require_tenant_session_request_precondition(
        request=request,
        current_version=trusted_session.session.tenant_session_version,
    )


async def require_tenant_scoped_api_precondition_unless_agent(
    request: Request,
    db: Session = Depends(get_db),
) -> None:
    """agent資格情報を持つ読み取り専用routeだけで使う。ADR-0093。

    agentは対話的なsession（tenantSessionVersion）を持たない。この関数は
    session検査を省くだけで、認証はしない。handlerが ``_authorize_request`` で
    資格情報・付与・tenantを必ず検証し、不正な資格情報は401で閉じる。
    """
    from sui_sensemaking_api.agent_credentials import (
        reject_mixed_credentials,
        request_has_agent_credential,
    )

    if request_has_agent_credential(request):
        # ゲスト/メンバーの資格情報と同乗させて、session検査だけを外させない。
        reject_mixed_credentials(request)
        return
    await require_tenant_scoped_api_precondition(request, db)
