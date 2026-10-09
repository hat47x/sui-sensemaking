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
)
from sui_sensemaking_api.auth_session_hash import derive_session_key_hash
from sui_sensemaking_api.models import DocumentRow
from sui_sensemaking_api.tenant_db_guard import apply_database_tenant_id

AGENT_CREDENTIAL_HEADER = "Sui-Sensemaking-Agent-Credential"
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
    return request.headers.get(AGENT_CREDENTIAL_HEADER) is not None


def resolve_agent_request(*, request: Request, db: Session) -> AgentRequestPrincipal | None:
    """header が無ければNone。あれば、不正・失効・期限切れは401で閉じる。

    存在は決定的である。不正なagent資格情報を、通常の利用者の経路へ落とさない。
    """
    raw_token = request.headers.get(AGENT_CREDENTIAL_HEADER)
    if raw_token is None:
        return None
    if (
        not raw_token
        or len(raw_token) > _MAX_TOKEN_LENGTH
        or not raw_token.startswith(AGENT_TOKEN_PREFIX)
    ):
        raise _invalid()
    hash_key = getattr(request.app.state, "agent_credential_hash_key", None)
    if hash_key is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "agent_credential_unavailable",
                "message": "Agent credential verification is unavailable.",
            },
        )
    index = db.get(AgentCredentialIndexRow, derive_agent_token_hash(raw_token, key=hash_key))
    if index is None:
        raise _invalid()
    apply_database_tenant_id(db=db, tenant_id=index.tenant_id)
    credential = db.get(AgentCredentialRow, (index.tenant_id, index.agent_id))
    if (
        credential is None
        or credential.status != "active"
        or credential.revoked_at is not None
        or credential.credential_version != index.credential_version
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
