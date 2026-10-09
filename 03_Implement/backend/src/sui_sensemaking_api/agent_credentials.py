"""ADR-0093: 外部agent（MCPなど）向けの、tenantと文書へ束縛した資格情報。

agentはmembershipを持たない別種の主体で、Tenant Adminが登録した資格情報と、
明示した文書への読み取り付与だけで読める。tenantも付与も、トークンのclaimや
リクエストのheader・path・bodyからは決めず、サーバー側の行から決める。
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from sui_sensemaking_api.agent_credential_models import (
    AgentCredentialIndexRow,
    AgentCredentialRow,
    AgentDocumentGrantRow,
    AgentOAuthBindingRow,
)
from sui_sensemaking_api.auth_session_hash import derive_session_key_hash
from sui_sensemaking_api.models import DocumentRow, IdentityProviderRow
from sui_sensemaking_api.tenant_db_guard import apply_database_tenant_id
from sui_sensemaking_api.trusted_auth_edge import JwtIdentityError, verify_configured_oidc_token

AGENT_CREDENTIAL_HEADER = "Sui-Sensemaking-Agent-Credential"
# ADR-0094: トークン交換で得た、backend宛ての短命のOAuthトークン。
AGENT_BEARER_HEADER = "Sui-Sensemaking-Agent-Bearer"
_MAX_BEARER_LENGTH = 8192
AGENT_TOKEN_PREFIX = "suiag_"
_MAX_TOKEN_LENGTH = 256
_HASH_DOMAIN = "agent-credential:"


class AgentCredentialError(ValueError):
    """信頼できる呼び出し元が渡した値、または状態遷移が不正。"""


@dataclass(frozen=True, slots=True)
class AgentRequestPrincipal:
    tenant_id: str
    agent_id: str
    credential_version: int


def _required(value: str, *, field: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise AgentCredentialError(f"{field} must be non-empty")
    return normalized


def _parse_aware(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def _aware_utc(now: datetime) -> datetime:
    if now.tzinfo is None or now.utcoffset() is None:
        raise AgentCredentialError("now must be timezone-aware")
    return now.astimezone(timezone.utc)


def derive_agent_token_hash(raw_token: str, *, key: bytes) -> str:
    """生トークンを保存しないための、領域分離した鍵付きハッシュ。"""
    return derive_session_key_hash(_HASH_DOMAIN + raw_token, key=key)


class AgentCredentialRepository:
    """tenant確定後の操作。毎回、transaction局所のtenantガードを設定し直す。"""

    def __init__(self, db: Session, *, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = _required(tenant_id, field="tenant_id")

    def _scope(self) -> None:
        apply_database_tenant_id(db=self._db, tenant_id=self._tenant_id)

    def register(
        self,
        *,
        agent_id: str,
        label: str,
        created_by: str,
        expires_at: str,
        doc_ids: tuple[str, ...],
        hash_key: bytes,
        now: datetime,
    ) -> str:
        """資格情報を作り、生トークンを一度だけ返す。保存するのはハッシュだけ。"""
        self._scope()
        current = _aware_utc(now)
        agent = _required(agent_id, field="agent_id")
        expiry = _parse_aware(expires_at)
        if expiry is None or expiry <= current:
            raise AgentCredentialError("expires_at must be a future aware timestamp")
        if not doc_ids:
            raise AgentCredentialError("doc_ids must name at least one document")
        if self._db.get(AgentCredentialRow, (self._tenant_id, agent)) is not None:
            raise AgentCredentialError("agent_id already exists")
        timestamp = current.isoformat()
        self._db.add(
            AgentCredentialRow(
                tenant_id=self._tenant_id,
                agent_id=agent,
                label=_required(label, field="label"),
                status="active",
                credential_version=1,
                created_by=_required(created_by, field="created_by"),
                created_at=timestamp,
                expires_at=expires_at,
                revoked_at=None,
            )
        )
        self._db.flush()
        for doc_id in doc_ids:
            self._grant(agent_id=agent, doc_id=doc_id, granted_by=created_by, granted_at=timestamp)
        raw_token = AGENT_TOKEN_PREFIX + secrets.token_urlsafe(32)
        self._db.add(
            AgentCredentialIndexRow(
                token_hash=derive_agent_token_hash(raw_token, key=hash_key),
                tenant_id=self._tenant_id,
                agent_id=agent,
                credential_version=1,
            )
        )
        self._db.flush()
        return raw_token

    def _grant(self, *, agent_id: str, doc_id: str, granted_by: str, granted_at: str) -> None:
        document_id = _required(doc_id, field="doc_id")
        if self._db.get(DocumentRow, (self._tenant_id, document_id)) is None:
            raise AgentCredentialError("doc_id does not exist in this tenant")
        self._db.add(
            AgentDocumentGrantRow(
                tenant_id=self._tenant_id,
                agent_id=agent_id,
                doc_id=document_id,
                granted_by=_required(granted_by, field="granted_by"),
                granted_at=granted_at,
                revoked_at=None,
            )
        )
        self._db.flush()

    def revoke_credential(self, *, agent_id: str, now: datetime) -> None:
        self._scope()
        row = self._db.get(
            AgentCredentialRow, (self._tenant_id, _required(agent_id, field="agent_id"))
        )
        if row is None:
            raise AgentCredentialError("agent_id does not exist")
        if row.status == "revoked":
            return
        row.status = "revoked"
        row.revoked_at = _aware_utc(now).isoformat()
        self._db.flush()

    def revoke_document_grant(self, *, agent_id: str, doc_id: str, now: datetime) -> None:
        self._scope()
        grant = self._db.get(
            AgentDocumentGrantRow,
            (
                self._tenant_id,
                _required(agent_id, field="agent_id"),
                _required(doc_id, field="doc_id"),
            ),
        )
        if grant is None:
            raise AgentCredentialError("grant does not exist")
        if grant.revoked_at is None:
            grant.revoked_at = _aware_utc(now).isoformat()
            self._db.flush()

    def bind_oauth_principal(
        self,
        *,
        agent_id: str,
        identity_provider_id: str,
        subject: str,
        created_by: str,
        now: datetime,
    ) -> None:
        """検証済みのOAuth主体を agent に結ぶ。同じ主体は、全体で一つの agent にしか結べない。"""
        self._scope()
        agent = _required(agent_id, field="agent_id")
        if self._db.get(AgentCredentialRow, (self._tenant_id, agent)) is None:
            raise AgentCredentialError("agent_id does not exist")
        provider_id = _required(identity_provider_id, field="identity_provider_id")
        provider = self._db.get(IdentityProviderRow, provider_id)
        if provider is None or provider.lifecycle_state != "active":
            raise AgentCredentialError("identity provider does not exist")
        key = (provider_id, _required(subject, field="subject"))
        if self._db.get(AgentOAuthBindingRow, key) is not None:
            raise AgentCredentialError("oauth principal is already bound")
        self._db.add(
            AgentOAuthBindingRow(
                identity_provider_id=key[0],
                subject=key[1],
                tenant_id=self._tenant_id,
                agent_id=agent,
                created_by=_required(created_by, field="created_by"),
                created_at=_aware_utc(now).isoformat(),
            )
        )
        self._db.flush()

    def unbind_oauth_principal(
        self, *, agent_id: str, identity_provider_id: str, subject: str
    ) -> None:
        self._scope()
        row = self._db.get(AgentOAuthBindingRow, (identity_provider_id, subject))
        # 他tenantの対応付けは、存在しないものと区別しない。
        if row is None or row.tenant_id != self._tenant_id or row.agent_id != agent_id:
            raise AgentCredentialError("binding does not exist")
        self._db.delete(row)
        self._db.flush()

    def list_oauth_bindings(self, *, agent_id: str) -> tuple[tuple[str, str], ...]:
        self._scope()
        return tuple(
            (row.identity_provider_id, row.subject)
            for row in self._db.scalars(
                select(AgentOAuthBindingRow)
                .where(AgentOAuthBindingRow.tenant_id == self._tenant_id)
                .where(AgentOAuthBindingRow.agent_id == agent_id)
                .order_by(AgentOAuthBindingRow.identity_provider_id, AgentOAuthBindingRow.subject)
            ).all()
        )

    def list_credentials(self) -> list[tuple[AgentCredentialRow, tuple[str, ...]]]:
        """tenantの資格情報と、有効な付与の docId。秘密（トークン・ハッシュ）は返さない。"""
        self._scope()
        rows = self._db.scalars(
            select(AgentCredentialRow)
            .where(AgentCredentialRow.tenant_id == self._tenant_id)
            .order_by(AgentCredentialRow.agent_id.asc())
        ).all()
        return [(row, self.list_readable_document_ids(agent_id=row.agent_id)) for row in rows]

    def can_read_document(self, *, agent_id: str, doc_id: str) -> bool:
        self._scope()
        grant = self._db.get(AgentDocumentGrantRow, (self._tenant_id, agent_id, doc_id))
        return grant is not None and grant.revoked_at is None

    def list_readable_document_ids(self, *, agent_id: str) -> tuple[str, ...]:
        self._scope()
        return tuple(
            self._db.scalars(
                select(AgentDocumentGrantRow.doc_id)
                .where(AgentDocumentGrantRow.tenant_id == self._tenant_id)
                .where(AgentDocumentGrantRow.agent_id == agent_id)
                .where(AgentDocumentGrantRow.revoked_at.is_(None))
                .order_by(AgentDocumentGrantRow.doc_id.asc())
            ).all()
        )


def _invalid() -> HTTPException:
    # 失効・期限切れ・不一致・未知を区別しない。区別が応答の差として観測できると、
    # 資格情報の存在や状態を探る手掛かりになる。
    return HTTPException(
        status_code=401,
        detail={"code": "agent_credential_invalid", "message": "Agent credential is invalid."},
    )


def request_has_agent_credential(request: Request) -> bool:
    return (
        request.headers.get(AGENT_CREDENTIAL_HEADER) is not None
        or request.headers.get(AGENT_BEARER_HEADER) is not None
    )


def _active_principal(
    *, db: Session, tenant_id: str, agent_id: str, expected_version: int | None
) -> AgentRequestPrincipal:
    """tenantを確定し、資格情報の状態・期限・版を、RLS付きの表で確認する。"""
    apply_database_tenant_id(db=db, tenant_id=tenant_id)
    credential = db.get(AgentCredentialRow, (tenant_id, agent_id))
    if (
        credential is None
        or credential.status != "active"
        or credential.revoked_at is not None
        or (expected_version is not None and credential.credential_version != expected_version)
    ):
        raise _invalid()
    expiry = _parse_aware(credential.expires_at)
    if expiry is None or expiry <= datetime.now(timezone.utc):
        raise _invalid()
    return AgentRequestPrincipal(
        tenant_id=credential.tenant_id,
        agent_id=credential.agent_id,
        credential_version=credential.credential_version,
    )


def _resolve_opaque_credential(
    *, request: Request, db: Session, raw_token: str
) -> AgentRequestPrincipal:
    if (
        not raw_token
        or len(raw_token) > _MAX_TOKEN_LENGTH
        or not raw_token.startswith(AGENT_TOKEN_PREFIX)
    ):
        raise _invalid()
    hash_key = getattr(request.app.state, "agent_credential_hash_key", None)
    if hash_key is None:
        raise _unavailable()
    index = db.get(AgentCredentialIndexRow, derive_agent_token_hash(raw_token, key=hash_key))
    if index is None:
        raise _invalid()
    return _active_principal(
        db=db,
        tenant_id=index.tenant_id,
        agent_id=index.agent_id,
        expected_version=index.credential_version,
    )


def _resolve_oauth_bearer(
    *, request: Request, db: Session, raw_value: str
) -> AgentRequestPrincipal:
    """ADR-0094: 交換後のトークンを自分で検証し、(IdP登録簿のid, sub) から agent を引く。"""
    token = raw_value.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token or len(token) > _MAX_BEARER_LENGTH:
        raise _invalid()
    jwks_store = getattr(request.app.state, "agent_jwks_store", None)
    if jwks_store is None:
        raise _unavailable()
    try:
        verified = verify_configured_oidc_token(db=db, token=token, jwks_store=jwks_store)
    except JwtIdentityError as error:
        if error.status_code == 503:
            raise _unavailable() from None
        raise _invalid() from None
    binding = db.get(AgentOAuthBindingRow, (verified.provider.id, verified.subject))
    if binding is None:
        raise _invalid()
    return _active_principal(
        db=db, tenant_id=binding.tenant_id, agent_id=binding.agent_id, expected_version=None
    )


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "agent_credential_unavailable",
            "message": "Agent credential verification is unavailable.",
        },
    )


def resolve_agent_request(*, request: Request, db: Session) -> AgentRequestPrincipal | None:
    """ヘッダーが無ければNone。あれば、不正・失効・期限切れは401で閉じる。

    存在は決定的である。不正な資格情報を、通常の利用者の経路へ落とさない。
    不透明な資格情報（ADR-0093）と交換後のOAuthトークン（ADR-0094）は、どちらか一方だけ。
    """
    raw_token = request.headers.get(AGENT_CREDENTIAL_HEADER)
    raw_bearer = request.headers.get(AGENT_BEARER_HEADER)
    if raw_token is None and raw_bearer is None:
        return None
    if raw_token is not None and raw_bearer is not None:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "agent_credential_conflict",
                "message": "Send either an agent credential or an agent bearer, not both.",
            },
        )
    if raw_token is not None:
        return _resolve_opaque_credential(request=request, db=db, raw_token=raw_token)
    assert raw_bearer is not None
    return _resolve_oauth_bearer(request=request, db=db, raw_value=raw_bearer)
