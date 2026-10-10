"""ADR-0094: トークン交換で得たOAuthトークンによる agent の認証。

backend が交換後のトークンを自分で検証し、(tenant, IdP登録簿のid, sub) から agent を引く。
audience は設定値 (SUI_AGENT_OAUTH_AUDIENCE) に固定する。tenant はトークンの tenant claim を
``tenant_identity_providers`` の対応で確定し（claim は要求であって権限ではない）、MCP の申告
では決まらない。
"""

from __future__ import annotations

import base64
import json
import time
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.agent_credentials import (
    AGENT_BEARER_HEADER,
    AGENT_CREDENTIAL_HEADER,
    AgentCredentialRepository,
)
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.jwks_store import JwksStore
from sui_sensemaking_api.models import (
    Base,
    DocumentRow,
    IdentityProviderRow,
    TenantIdentityProviderRow,
    TenantRow,
)
from sui_sensemaking_api.routes.ai import router as ai_router
from sui_sensemaking_api.routes.docs import router as docs_router
from sui_sensemaking_api.settings import settings

TIMESTAMP = "2026-10-09T00:00:00+00:00"
HASH_KEY = b"agent-oauth-test-key-0123456789ab"
ISSUER = "https://idp.invalid/realm"
AGENT_AUDIENCE = "sui-sensemaking-agents"  # backend 宛て。MCP 宛てのaudienceとは別。
MCP_AUDIENCE = "https://mcp.invalid/mcp"
KID = "agent-oauth-key"
PROVIDER_ID = "idp-agents"
TENANT_REFS = {"tenant-a": "org-a", "tenant-b": "org-b"}  # IdP側のtenant claimの値


def _keypair() -> tuple[rsa.RSAPrivateKey, dict[str, object]]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    numbers = private_key.public_key().public_numbers()

    def b64(value: int) -> str:
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return private_key, {
        "kty": "RSA",
        "kid": KID,
        "use": "sig",
        "alg": "RS256",
        "n": b64(numbers.n),
        "e": b64(numbers.e),
    }


def _token(
    key: rsa.RSAPrivateKey,
    *,
    subject: str = "agent-client-1",
    audience: str = AGENT_AUDIENCE,
    issuer: str = ISSUER,
    expired: bool = False,
    tenant_ref: str | None = "org-a",
) -> str:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": issuer,
        "aud": audience,
        "sub": subject,
        "iat": now - 60,
        "exp": now - 3600 if expired else now + 300,
        "jti": str(uuid4()),
        # 交換を行った MCP サーバー自身のクライアント。同定には使わない。
        "azp": "mcp-server",
    }
    if tenant_ref is not None:
        claims[settings.tenant_claim_name] = tenant_ref
    return jwt.encode(
        claims,
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode(),
        algorithm="RS256",
        headers={"kid": KID},
    )


def _document(doc_id: str, title: str) -> str:
    return json.dumps(
        {
            "version": 1,
            "id": doc_id,
            "title": title,
            "createdAt": TIMESTAMP,
            "updatedAt": TIMESTAMP,
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": [
                {"id": "c1", "text": "REVIEWED", "x": 0, "y": 0, "textReviewed": True},
                {"id": "c2", "text": "SECRET", "x": 1, "y": 1, "textReviewed": False},
            ],
            "edges": [],
            "islands": [],
        }
    )


@pytest.fixture
def env(tmp_path) -> Iterator[dict]:
    key, jwk = _keypair()
    engine = create_engine(f"sqlite:///{tmp_path}/agent-oauth.db")
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(engine)
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(days=7)).isoformat()
    with factory() as db:
        for tenant_id in ("tenant-a", "tenant-b"):
            db.add(
                TenantRow(
                    id=tenant_id,
                    display_name=tenant_id,
                    lifecycle_state="active",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                )
            )
        db.add_all(
            [
                IdentityProviderRow(
                    id=PROVIDER_ID,
                    issuer=ISSUER,
                    audience=AGENT_AUDIENCE,
                    lifecycle_state="active",
                    protocol="oidc",
                    jwks_uri="https://idp.invalid/realm/jwks",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                ),
                # MCP 宛てのaudienceは、agent の経路では登録しない（パススルーさせない）。
            ]
        )
        for tenant_id, ref in TENANT_REFS.items():
            db.add(
                TenantIdentityProviderRow(
                    tenant_id=tenant_id,
                    identity_provider_id=PROVIDER_ID,
                    external_tenant_ref=ref,
                    lifecycle_state="active",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                )
            )
        for tenant_id, doc_id in (
            ("tenant-a", "shared-doc"),
            ("tenant-a", "a-ungranted"),
            ("tenant-b", "shared-doc"),
        ):
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id=doc_id,
                    version=1,
                    updated_at=TIMESTAMP,
                    payload_json=_document(doc_id, f"{tenant_id}-{doc_id}"),
                    created_by="owner",
                    lifecycle_state="active",
                )
            )
        db.commit()
        for tenant_id, agent_id, subject in (
            ("tenant-a", "agent-a", "agent-client-1"),
            ("tenant-b", "agent-b", "agent-client-2"),
        ):
            repo = AgentCredentialRepository(db, tenant_id=tenant_id)
            repo.register(
                agent_id=agent_id,
                label=agent_id,
                created_by="admin",
                expires_at=expires,
                doc_ids=("shared-doc",),
                hash_key=HASH_KEY,
                now=now,
            )
            repo.bind_oauth_principal(
                agent_id=agent_id,
                identity_provider_id=PROVIDER_ID,
                subject=subject,
                created_by="admin",
                now=now,
            )
        db.commit()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(docs_router)
    app.include_router(ai_router)
    app.state.agent_credential_hash_key = HASH_KEY
    app.state.agent_oauth_audience = AGENT_AUDIENCE
    app.state.agent_jwks_store = JwksStore()
    app.state.access_control_adapter = None
    app.state.audit_dispatcher = None

    def _test_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = _test_db
    with patch("sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[jwk]):
        with TestClient(app) as client:
            yield {"client": client, "factory": factory, "key": key, "app": app}
    engine.dispose()


def _bearer(token: str) -> dict[str, str]:
    return {AGENT_BEARER_HEADER: f"Bearer {token}"}


def test_a_bound_oauth_principal_reads_only_its_granted_documents(env) -> None:
    client, key = env["client"], env["key"]
    a = client.get("/docs/shared-doc", headers=_bearer(_token(key, subject="agent-client-1")))
    b = client.get(
        "/docs/shared-doc",
        headers=_bearer(_token(key, subject="agent-client-2", tenant_ref="org-b")),
    )
    ungranted = client.get("/docs/a-ungranted", headers=_bearer(_token(key)))
    listed = client.get("/docs", headers=_bearer(_token(key)))

    assert a.status_code == 200 and b.status_code == 200
    assert ungranted.status_code == 404
    assert [item["id"] for item in listed.json()] == ["shared-doc"]


def test_unreviewed_text_is_withheld_on_the_oauth_path_too(env) -> None:
    body = env["client"].get("/docs/shared-doc", headers=_bearer(_token(env["key"]))).json()

    assert {card["id"]: card["text"] for card in body["cards"]} == {"c1": "REVIEWED", "c2": ""}
    assert "SECRET" not in json.dumps(body)


def test_the_tenant_is_the_one_the_idp_attests_not_one_the_caller_names(env) -> None:
    """tenant-b 用のクライアントが tenant-a を名乗る claim で来ても、tenant-a の文書は読めない。"""
    client, key = env["client"], env["key"]
    claiming_a = _token(key, subject="agent-client-2", tenant_ref="org-a")
    claiming_b = _token(key, subject="agent-client-2", tenant_ref="org-b")

    assert client.get("/docs/shared-doc", headers=_bearer(claiming_a)).status_code == 401
    assert client.get("/docs/a-ungranted", headers=_bearer(claiming_a)).status_code == 401
    assert client.get("/docs/shared-doc", headers=_bearer(claiming_b)).status_code == 200
    assert client.get("/docs/a-ungranted", headers=_bearer(claiming_b)).status_code == 404


def test_the_same_subject_can_be_bound_in_two_tenants_without_seeing_each_other(env) -> None:
    """(tenant, IdP, sub) がキー。他tenantが先に結んでいても、競合も存在の手掛かりも生じない。"""
    now = datetime.now(timezone.utc)
    with env["factory"]() as db:
        # tenant-b が、tenant-a のクライアントと同じ sub を、自分の agent に結ぶ。
        AgentCredentialRepository(db, tenant_id="tenant-b").bind_oauth_principal(
            agent_id="agent-b",
            identity_provider_id=PROVIDER_ID,
            subject="agent-client-1",
            created_by="admin",
            now=now,
        )
        db.commit()
    client, key = env["client"], env["key"]
    a = client.get(
        "/docs", headers=_bearer(_token(key, subject="agent-client-1", tenant_ref="org-a"))
    )
    b = client.get(
        "/docs", headers=_bearer(_token(key, subject="agent-client-1", tenant_ref="org-b"))
    )

    assert a.status_code == 200 and b.status_code == 200
    # どちらのtenantでも、そのtenantの agent の付与だけが見える（互いのtenantの文書は混ざらない）。
    assert [item["id"] for item in a.json()] == ["shared-doc"]
    assert [item["id"] for item in b.json()] == ["shared-doc"]


def test_a_token_without_a_tenant_claim_is_rejected(env) -> None:
    response = env["client"].get(
        "/docs/shared-doc", headers=_bearer(_token(env["key"], tenant_ref=None))
    )

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "agent_credential_invalid"


def test_the_oauth_path_is_unavailable_without_a_configured_audience(env) -> None:
    env["app"].state.agent_oauth_audience = None
    response = env["client"].get("/docs/shared-doc", headers=_bearer(_token(env["key"])))

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "agent_credential_unavailable"


@pytest.mark.parametrize(
    "make",
    [
        lambda key: _token(key, subject="unbound-client"),
        lambda key: _token(key, expired=True),
        lambda key: _token(key, audience=MCP_AUDIENCE),  # MCP 宛てのトークンは受け付けない
        lambda key: _token(key, issuer="https://other.invalid/realm"),
        lambda key: _token(_keypair()[0]),  # 別の鍵による署名
        lambda key: "not-a-jwt",
        lambda key: "",
    ],
)
def test_invalid_or_unbound_tokens_fail_closed_with_one_response(env, make) -> None:
    response = env["client"].get("/docs/shared-doc", headers=_bearer(make(env["key"])))

    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "agent_credential_invalid"


def test_revoking_the_credential_stops_the_oauth_path_at_the_next_request(env) -> None:
    client, key = env["client"], env["key"]
    token = _token(key)
    assert client.get("/docs/shared-doc", headers=_bearer(token)).status_code == 200
    with env["factory"]() as db:
        AgentCredentialRepository(db, tenant_id="tenant-a").revoke_credential(
            agent_id="agent-a", now=datetime.now(timezone.utc)
        )
        db.commit()

    assert client.get("/docs/shared-doc", headers=_bearer(token)).status_code == 401


def test_sending_both_credential_forms_is_rejected(env) -> None:
    response = env["client"].get(
        "/docs/shared-doc",
        headers={**_bearer(_token(env["key"])), AGENT_CREDENTIAL_HEADER: "suiag_x"},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "agent_credential_conflict"


def test_an_unavailable_key_source_is_503_not_a_pass(env) -> None:
    env["app"].state.agent_jwks_store = JwksStore()
    with patch("sui_sensemaking_api.trusted_auth_edge._fetch_jwks", side_effect=OSError("down")):
        response = env["client"].get("/docs/shared-doc", headers=_bearer(_token(env["key"])))

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "agent_credential_unavailable"


def test_the_oauth_path_is_read_only_and_does_not_open_other_routes(env) -> None:
    client, headers = env["client"], _bearer(_token(env["key"]))
    document = _document_payload()

    assert client.put("/docs/shared-doc", headers=headers, json=document).status_code == 403
    assert client.post("/docs/shared-doc/archive", headers=headers).status_code == 403
    assert (
        client.get("/docs/shared-doc/similar-candidate-groups", headers=headers).status_code == 403
    )
    assert (
        client.get(
            "/ai/proposals/status", params={"docId": "shared-doc"}, headers=headers
        ).status_code
        == 200
    )


def _document_payload() -> dict:
    return json.loads(_document("shared-doc", "x"))


def test_a_principal_can_be_bound_to_only_one_agent_within_a_tenant(env) -> None:
    from sui_sensemaking_api.agent_credentials import AgentCredentialError

    now = datetime.now(timezone.utc)
    with env["factory"]() as db:
        repo = AgentCredentialRepository(db, tenant_id="tenant-a")
        repo.register(
            agent_id="agent-a2",
            label="second",
            created_by="admin",
            expires_at=(now + timedelta(days=7)).isoformat(),
            doc_ids=("shared-doc",),
            hash_key=HASH_KEY,
            now=now,
        )
        with pytest.raises(AgentCredentialError, match="already bound"):
            repo.bind_oauth_principal(
                agent_id="agent-a2",
                identity_provider_id=PROVIDER_ID,
                subject="agent-client-1",  # 同じtenantの agent-a が結んでいる
                created_by="admin",
                now=now,
            )
        with pytest.raises(AgentCredentialError, match="identity provider does not exist"):
            repo.bind_oauth_principal(
                agent_id="agent-a2",
                identity_provider_id="no-such-provider",
                subject="x",
                created_by="admin",
                now=now,
            )
