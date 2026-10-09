"""ADR-0094: トークン交換で得たOAuthトークンによる agent の認証。

backend が交換後のトークンを自分で検証し、(IdP登録簿のid, sub) から agent を引く。
tenant は対応付けの行から決まり、トークンの claim や MCP の申告では決まらない。
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
from sui_sensemaking_api.models import Base, DocumentRow, IdentityProviderRow, TenantRow
from sui_sensemaking_api.routes.ai import router as ai_router
from sui_sensemaking_api.routes.docs import router as docs_router

TIMESTAMP = "2026-10-09T00:00:00+00:00"
HASH_KEY = b"agent-oauth-test-key-0123456789ab"
ISSUER = "https://idp.invalid/realm"
AGENT_AUDIENCE = "sui-sensemaking-agents"  # backend 宛て。MCP 宛てのaudienceとは別。
MCP_AUDIENCE = "https://mcp.invalid/mcp"
KID = "agent-oauth-key"
PROVIDER_ID = "idp-agents"


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
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "iss": issuer,
            "aud": audience,
            "sub": subject,
            "iat": now - 60,
            "exp": now - 3600 if expired else now + 300,
            "jti": str(uuid4()),
            # 交換を行った MCP サーバー自身のクライアント。同定には使わない。
            "azp": "mcp-server",
        },
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
    b = client.get("/docs/shared-doc", headers=_bearer(_token(key, subject="agent-client-2")))
    ungranted = client.get("/docs/a-ungranted", headers=_bearer(_token(key)))
    listed = client.get("/docs", headers=_bearer(_token(key)))

    assert a.status_code == 200 and b.status_code == 200
    assert ungranted.status_code == 404
    assert [item["id"] for item in listed.json()] == ["shared-doc"]


def test_unreviewed_text_is_withheld_on_the_oauth_path_too(env) -> None:
    body = env["client"].get("/docs/shared-doc", headers=_bearer(_token(env["key"]))).json()

    assert {card["id"]: card["text"] for card in body["cards"]} == {"c1": "REVIEWED", "c2": ""}
    assert "SECRET" not in json.dumps(body)


def test_the_tenant_comes_from_the_binding_not_from_the_token(env) -> None:
    """tenant-b 用のクライアントのトークンに tenant-a を名乗る claim を足しても、tenant-b のまま。"""
    client, key = env["client"], env["key"]
    now = int(time.time())
    forged = jwt.encode(
        {
            "iss": ISSUER,
            "aud": AGENT_AUDIENCE,
            "sub": "agent-client-2",
            "iat": now - 60,
            "exp": now + 300,
            "tenant_id": "tenant-a",
            "tenant_ref": "tenant-a",
        },
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode(),
        algorithm="RS256",
        headers={"kid": KID},
    )
    own = client.get("/docs/shared-doc", headers=_bearer(forged))
    other = client.get("/docs/a-ungranted", headers=_bearer(forged))

    assert own.status_code == 200
    assert other.status_code == 404


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


def test_a_principal_can_be_bound_to_only_one_agent(env) -> None:
    from sui_sensemaking_api.agent_credentials import AgentCredentialError

    with env["factory"]() as db:
        repo = AgentCredentialRepository(db, tenant_id="tenant-b")
        with pytest.raises(AgentCredentialError):
            repo.bind_oauth_principal(
                agent_id="agent-b",
                identity_provider_id=PROVIDER_ID,
                subject="agent-client-1",  # tenant-a が結んでいる
                created_by="admin",
                now=datetime.now(timezone.utc),
            )
        with pytest.raises(AgentCredentialError):
            repo.bind_oauth_principal(
                agent_id="agent-b",
                identity_provider_id="no-such-provider",
                subject="x",
                created_by="admin",
                now=datetime.now(timezone.utc),
            )
