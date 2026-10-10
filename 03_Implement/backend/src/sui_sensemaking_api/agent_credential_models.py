from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKeyConstraint, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from sui_sensemaking_api.models import Base
from sui_sensemaking_api.persistence_shapes import apply_persistent_text_shapes


class AgentCredentialRow(Base):
    """ADR-0093 外部agentの資格情報。tenantのmembershipとは無関係の主体。"""

    __tablename__ = "agent_credentials"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'revoked')",
            name="ck_agent_credentials_status",
        ),
        CheckConstraint(
            "(status = 'active' AND revoked_at IS NULL) OR "
            "(status = 'revoked' AND revoked_at IS NOT NULL)",
            name="ck_agent_credentials_lifecycle_shape",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    credential_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_by: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[str] = mapped_column(Text, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(Text, nullable=True)


class AgentDocumentGrantRow(Base):
    """明示した文書だけの読み取り付与。行が無ければ見えない。"""

    __tablename__ = "agent_document_grants"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agent_credentials.tenant_id", "agent_credentials.agent_id"],
            name="fk_agent_document_grants_credential",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "doc_id"],
            ["documents.tenant_id", "documents.id"],
            name="fk_agent_document_grants_document",
            ondelete="CASCADE",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(Text, primary_key=True)
    doc_id: Mapped[str] = mapped_column(Text, primary_key=True)
    granted_by: Mapped[str] = mapped_column(Text, nullable=False)
    granted_at: Mapped[str] = mapped_column(Text, nullable=False)
    revoked_at: Mapped[str | None] = mapped_column(Text, nullable=True)


class AgentCredentialIndexRow(Base):
    """トークンのハッシュから(tenant, agent)を引く、tenant確定前の索引。

    ``guest_auth_sessions`` と同じ理由でtenant RLSを掛けない。この行が決めるのは
    (tenant, agent, 版)だけで、状態・期限・付与は毎要求でRLS付きの表を引き直す。
    """

    __tablename__ = "agent_credential_index"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agent_credentials.tenant_id", "agent_credentials.agent_id"],
            name="fk_agent_credential_index_credential",
            ondelete="CASCADE",
        ),
    )

    token_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(Text, nullable=False)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    credential_version: Mapped[int] = mapped_column(Integer, nullable=False)


class AgentOAuthBindingRow(Base):
    """ADR-0094: 検証済みのOAuth主体を agent に結ぶ対応付け。

    キーに tenant_id を含める。同じ (IdP, sub) を別のtenantが結んでも互いに見えず、
    先取りによる妨害や存在の oracle にならない。実行時は、トークンの tenant claim を
    ``tenant_identity_providers`` 経由で確定した tenant の行だけを引く。
    トークンの検証後、agentの状態を引く前に参照するので RLS は掛けないが、決めるのは
    agent_id だけで、状態・期限・付与は毎要求でRLS付きの表を引き直す。
    """

    __tablename__ = "agent_oauth_bindings"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "agent_id"],
            ["agent_credentials.tenant_id", "agent_credentials.agent_id"],
            name="fk_agent_oauth_bindings_credential",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["identity_provider_id"],
            ["identity_providers.id"],
            name="fk_agent_oauth_bindings_identity_provider",
            ondelete="NO ACTION",
        ),
    )

    tenant_id: Mapped[str] = mapped_column(Text, primary_key=True)
    identity_provider_id: Mapped[str] = mapped_column(Text, primary_key=True)
    subject: Mapped[str] = mapped_column(Text, primary_key=True)
    agent_id: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)


apply_persistent_text_shapes(Base.metadata)
