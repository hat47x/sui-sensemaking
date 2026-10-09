"""ADR-0093: Tenant Adminによる、外部agent資格情報の登録・一覧・失効。

registerとrevokeは、それぞれ独立したcapability（``agent.register`` / ``agent.revoke``）を
要求する。トークン平文は登録の応答で一度だけ返し、保存しない。一覧はトークンもそのハッシュ
も返さない。
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sui_sensemaking_api.agent_credentials import (
    AgentCredentialError,
    AgentCredentialRepository,
)
from sui_sensemaking_api.auth_context import ResolvedIdentity
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.saas_request_context import resolve_trusted_saas_request_session
from sui_sensemaking_api.tenant_context import TenantContext
from sui_sensemaking_api.tenant_session_precondition import (
    require_tenant_session_request_precondition,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tenant-admin/agent-credentials", tags=["tenant-admin"])

AGENT_REGISTER_CAPABILITY = "agent.register"
AGENT_REVOKE_CAPABILITY = "agent.revoke"
MAX_CREDENTIAL_LIFETIME = timedelta(days=90)
MAX_GRANTED_DOCUMENTS = 50
_OPAQUE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class AgentCredentialCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agentId: str = Field(min_length=1, max_length=128)
    label: str = Field(min_length=1, max_length=256)
    expiresAt: datetime
    docIds: list[str] = Field(min_length=1, max_length=MAX_GRANTED_DOCUMENTS)

    @field_validator("agentId")
    @classmethod
    def _agent_id_is_opaque(cls, value: str) -> str:
        if not _OPAQUE_ID.fullmatch(value):
            raise ValueError("agentId must be an opaque canonical identifier")
        return value

    @field_validator("docIds")
    @classmethod
    def _doc_ids_are_unique(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("docIds must not repeat")
        return value


class AgentOAuthPrincipal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    identityProviderId: str = Field(min_length=1, max_length=128)
    subject: str = Field(min_length=1, max_length=512)


class AgentCredentialSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")

    agentId: str
    label: str
    status: str
    createdAt: str
    expiresAt: str
    revokedAt: str | None
    docIds: list[str]
    oauthBindings: list[AgentOAuthPrincipal] = Field(default_factory=list)


class AgentCredentialCreated(AgentCredentialSummary):
    # 平文は、この応答でだけ返す。保存せず、再取得もできない。
    credential: str


class AgentCredentialListResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AgentCredentialSummary]


def _error(*, status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _authorize(
    *,
    request: Request,
    db: Session,
    any_of: tuple[str, ...],
) -> tuple[ResolvedIdentity, TenantContext]:
    trusted_session = resolve_trusted_saas_request_session(request=request, db=db)
    require_tenant_session_request_precondition(
        request=request,
        current_version=trusted_session.session.tenant_session_version,
    )
    if not set(any_of) & set(trusted_session.session.effective_capabilities):
        raise _error(
            status_code=403,
            code="agent_credential_manage_required",
            message="Agent credential management capability is required.",
        )
    return trusted_session.identity, trusted_session.tenant


def _summary(
    row,  # noqa: ANN001
    doc_ids: tuple[str, ...],
    bindings: tuple[tuple[str, str], ...] = (),
) -> dict[str, object]:
    return {
        "agentId": row.agent_id,
        "label": row.label,
        "status": row.status,
        "createdAt": row.created_at,
        "expiresAt": row.expires_at,
        "revokedAt": row.revoked_at,
        "docIds": list(doc_ids),
        "oauthBindings": [
            {"identityProviderId": provider_id, "subject": subject}
            for provider_id, subject in bindings
        ],
    }


@router.post("", response_model=AgentCredentialCreated, status_code=201)
def register_agent_credential(
    payload: AgentCredentialCreateRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AgentCredentialCreated:
    identity, tenant = _authorize(request=request, db=db, any_of=(AGENT_REGISTER_CAPABILITY,))
    hash_key = getattr(request.app.state, "agent_credential_hash_key", None)
    if hash_key is None:
        raise _error(
            status_code=503,
            code="agent_credential_unavailable",
            message="Agent credential issuance is unavailable.",
        )
    now = datetime.now(timezone.utc)
    if payload.expiresAt.tzinfo is None or payload.expiresAt.utcoffset() is None:
        raise _error(
            status_code=422,
            code="agent_credential_expiry_invalid",
            message="expiresAt must include a timezone.",
        )
    expires_at = payload.expiresAt.astimezone(timezone.utc)
    if expires_at <= now or expires_at - now > MAX_CREDENTIAL_LIFETIME:
        raise _error(
            status_code=422,
            code="agent_credential_expiry_invalid",
            message=f"expiresAt must be in the future and within {MAX_CREDENTIAL_LIFETIME.days} days.",
        )
    repo = AgentCredentialRepository(db, tenant_id=tenant.tenant_id)
    try:
        token = repo.register(
            agent_id=payload.agentId,
            label=payload.label,
            created_by=identity.user_id or "unknown",
            expires_at=expires_at.isoformat(),
            doc_ids=tuple(payload.docIds),
            hash_key=hash_key,
            now=now,
        )
        db.commit()
    except AgentCredentialError as error:
        db.rollback()
        message = str(error)
        if "already exists" in message:
            raise _error(
                status_code=409, code="agent_credential_exists", message=message
            ) from error
        if "doc_id does not exist" in message:
            # 他tenantの文書と存在しない文書を区別しない。
            raise _error(
                status_code=404, code="document_not_found", message="Document not found."
            ) from error
        raise _error(
            status_code=422, code="agent_credential_invalid_request", message=message
        ) from error
    except IntegrityError as error:
        db.rollback()
        raise _error(
            status_code=409, code="agent_credential_exists", message="agentId already exists."
        ) from error

    logger.info(
        "agent credential registered",
        extra={
            "tenantId": tenant.tenant_id,
            "agentId": payload.agentId,
            "docCount": len(payload.docIds),
        },
    )
    response.headers["Cache-Control"] = "no-store"
    created_row = next(row for row, _ in repo.list_credentials() if row.agent_id == payload.agentId)
    return AgentCredentialCreated(
        **_summary(created_row, tuple(payload.docIds)),
        credential=token,
    )


@router.get("", response_model=AgentCredentialListResponse)
def list_agent_credentials(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AgentCredentialListResponse:
    _, tenant = _authorize(
        request=request,
        db=db,
        any_of=(AGENT_REGISTER_CAPABILITY, AGENT_REVOKE_CAPABILITY),
    )
    response.headers["Cache-Control"] = "no-store"
    repo = AgentCredentialRepository(db, tenant_id=tenant.tenant_id)
    return AgentCredentialListResponse(
        items=[
            AgentCredentialSummary(
                **_summary(row, ids, repo.list_oauth_bindings(agent_id=row.agent_id))
            )
            for row, ids in repo.list_credentials()
        ]
    )


@router.post("/{agent_id}/revoke", status_code=204)
def revoke_agent_credential(
    agent_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    _, tenant = _authorize(request=request, db=db, any_of=(AGENT_REVOKE_CAPABILITY,))
    repo = AgentCredentialRepository(db, tenant_id=tenant.tenant_id)
    try:
        repo.revoke_credential(agent_id=agent_id, now=datetime.now(timezone.utc))
        db.commit()
    except AgentCredentialError as error:
        db.rollback()
        raise _error(
            status_code=404,
            code="agent_credential_not_found",
            message="Agent credential not found.",
        ) from error
    logger.info(
        "agent credential revoked", extra={"tenantId": tenant.tenant_id, "agentId": agent_id}
    )
    return Response(status_code=204)


@router.delete("/{agent_id}/documents/{doc_id}", status_code=204)
def revoke_agent_document_grant(
    agent_id: str,
    doc_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    _, tenant = _authorize(request=request, db=db, any_of=(AGENT_REVOKE_CAPABILITY,))
    repo = AgentCredentialRepository(db, tenant_id=tenant.tenant_id)
    try:
        repo.revoke_document_grant(agent_id=agent_id, doc_id=doc_id, now=datetime.now(timezone.utc))
        db.commit()
    except AgentCredentialError as error:
        db.rollback()
        raise _error(
            status_code=404, code="agent_grant_not_found", message="Agent grant not found."
        ) from error
    return Response(status_code=204)


@router.post("/{agent_id}/oauth-bindings", status_code=201)
def bind_agent_oauth_principal(
    agent_id: str,
    payload: AgentOAuthPrincipal,
    request: Request,
    db: Session = Depends(get_db),
) -> AgentOAuthPrincipal:
    """ADR-0094: agent に、IdP登録簿のidと sub で表すOAuth主体を結ぶ。"""
    identity, tenant = _authorize(request=request, db=db, any_of=(AGENT_REGISTER_CAPABILITY,))
    repo = AgentCredentialRepository(db, tenant_id=tenant.tenant_id)
    try:
        repo.bind_oauth_principal(
            agent_id=agent_id,
            identity_provider_id=payload.identityProviderId,
            subject=payload.subject,
            created_by=identity.user_id or "unknown",
            now=datetime.now(timezone.utc),
        )
        db.commit()
    except AgentCredentialError as error:
        db.rollback()
        message = str(error)
        if "already bound" in message:
            raise _error(
                status_code=409,
                code="agent_oauth_principal_bound",
                message="The OAuth principal is already bound.",
            ) from error
        if "identity provider does not exist" in message:
            raise _error(
                status_code=404,
                code="identity_provider_not_found",
                message="Identity provider not found.",
            ) from error
        raise _error(
            status_code=404,
            code="agent_credential_not_found",
            message="Agent credential not found.",
        ) from error
    except IntegrityError as error:
        db.rollback()
        raise _error(
            status_code=409,
            code="agent_oauth_principal_bound",
            message="The OAuth principal is already bound.",
        ) from error
    logger.info(
        "agent oauth principal bound",
        extra={"tenantId": tenant.tenant_id, "agentId": agent_id},
    )
    return payload


@router.post("/{agent_id}/oauth-bindings/remove", status_code=204)
def unbind_agent_oauth_principal(
    agent_id: str,
    payload: AgentOAuthPrincipal,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    _, tenant = _authorize(request=request, db=db, any_of=(AGENT_REVOKE_CAPABILITY,))
    repo = AgentCredentialRepository(db, tenant_id=tenant.tenant_id)
    try:
        repo.unbind_oauth_principal(
            agent_id=agent_id,
            identity_provider_id=payload.identityProviderId,
            subject=payload.subject,
        )
        db.commit()
    except AgentCredentialError as error:
        db.rollback()
        raise _error(
            status_code=404, code="agent_binding_not_found", message="Agent binding not found."
        ) from error
    return Response(status_code=204)
