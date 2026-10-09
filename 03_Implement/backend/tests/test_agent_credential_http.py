"""ADR-0093: 外部agent資格情報の HTTP 境界。

同じ docId を持つ tenant A/B と、付与外の文書を使い、越境・失効・書き込み拒否・
未レビュー本文・監査・トークンの非保存を固定する。MCP の saas-multitenant 起動拒否は、
これらに加えて島や要約など他の本文の扱いが閉じるまで解除しない。
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from hashlib import sha256

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.agent_credential_models import (
    AgentCredentialIndexRow,
    AgentCredentialRow,
)
from sui_sensemaking_api.agent_credentials import (
    AGENT_CREDENTIAL_HEADER,
    AgentCredentialRepository,
)
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.models import Base, DocumentRow, TenantRow
from sui_sensemaking_api.routes.ai import router as ai_router
from sui_sensemaking_api.routes.docs import router as docs_router

TIMESTAMP = "2026-10-09T00:00:00+00:00"
HASH_KEY = b"agent-credential-test-key-0123456789"
NOW = datetime.now(timezone.utc)
FUTURE = (NOW + timedelta(days=7)).isoformat()


def _payload(doc_id: str, title: str, cards: list[dict] | None = None) -> dict[str, object]:
    rich = cards is not None
    body: dict[str, object] = {
        "version": 1,
        "id": doc_id,
        "title": title,
        "createdAt": TIMESTAMP,
        "updatedAt": TIMESTAMP,
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": cards or [],
        "edges": [],
        "islands": [],
    }
    if rich:
        # カード本文以外にも本文を含む項目。確認済みの題名だけが agent へ出る。
        body["islands"] = [
            {
                "id": "i-reviewed",
                "cardIds": ["c-reviewed"],
                "title": "REVIEWED-ISLAND-TITLE",
                "titleReviewed": True,
                "summaryText": "SECRET-ISLAND-SUMMARY",
                "critique": "SECRET-ISLAND-CRITIQUE",
            },
            {
                "id": "i-unreviewed",
                "cardIds": ["c-unreviewed"],
                "title": "SECRET-UNREVIEWED-ISLAND-TITLE",
                "titleReviewed": False,
            },
        ]
        body["evidenceLinks"] = [
            {
                "id": "e1",
                "type": "supports",
                "fromCardId": "c-reviewed",
                "toCardId": "c-unreviewed",
                "note": "SECRET-LINK-NOTE",
                "createdAt": TIMESTAMP,
            }
        ]
        body["voids"] = [
            {
                "id": "v1",
                "kind": "unreviewed_content",
                "title": "SECRET-VOID-TITLE",
                "detail": "SECRET-VOID-DETAIL",
                "cardIds": ["c-reviewed"],
                "createdAt": TIMESTAMP,
            }
        ]
        body["narratives"] = [
            {
                "id": "n1",
                "title": "SECRET-NARRATIVE-TITLE",
                "text": "SECRET-NARRATIVE-TEXT",
                "reviewed": False,
                "checks": [
                    {
                        "id": "chk1",
                        "createdAt": TIMESTAMP,
                        "kind": "consistency",
                        "issues": [
                            {
                                "severity": "warn",
                                "message": "SECRET-CHECK-MESSAGE",
                                "direction": "a_missing_in_b",
                            }
                        ],
                    }
                ],
            }
        ]
        body["relationSummaries"] = [
            {
                "id": "r1",
                "createdAt": TIMESTAMP,
                "islandAId": "i-reviewed",
                "islandBId": "i-unreviewed",
                "relationType": "related",
                "derived": False,
                "text": "SECRET-RELATION-TEXT",
                "reviewed": False,
                "groundingCardIds": [],
                "groundingEdgeIds": [],
                "sourceSignature": "sig",
            }
        ]
    return body


class SpyDispatcher:
    def __init__(self) -> None:
        self.events: list[object] = []

    def emit(self, event: object, *, dedup_key=None):  # noqa: ANN001
        self.events.append(event)


CARDS = [
    {"id": "c-reviewed", "text": "REVIEWED-TEXT", "x": 0, "y": 0, "textReviewed": True},
    {"id": "c-unreviewed", "text": "SECRET-UNREVIEWED-TEXT", "x": 1, "y": 1, "textReviewed": False},
    {"id": "c-unknown", "text": "SECRET-UNFLAGGED-TEXT", "x": 2, "y": 2},
]


@pytest.fixture
def env(tmp_path) -> Iterator[dict]:
    engine = create_engine(f"sqlite:///{tmp_path}/agent-http.db")
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(engine)
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
        rows = (
            ("tenant-a", "shared-doc", "A shared", CARDS),
            ("tenant-a", "a-ungranted", "A ungranted", None),
            ("tenant-b", "shared-doc", "B shared", None),
            ("tenant-b", "b-only", "B only", None),
        )
        for tenant_id, doc_id, title, cards in rows:
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id=doc_id,
                    version=1,
                    updated_at=TIMESTAMP,
                    payload_json=json.dumps(_payload(doc_id, title, cards)),
                    created_by="owner",
                    lifecycle_state="active",
                )
            )
        db.commit()
        token_a = AgentCredentialRepository(db, tenant_id="tenant-a").register(
            agent_id="agent-a",
            label="Agent A",
            created_by="tenant-admin-a",
            expires_at=FUTURE,
            doc_ids=("shared-doc",),
            hash_key=HASH_KEY,
            now=NOW,
        )
        token_b = AgentCredentialRepository(db, tenant_id="tenant-b").register(
            agent_id="agent-b",
            label="Agent B",
            created_by="tenant-admin-b",
            expires_at=FUTURE,
            doc_ids=("shared-doc",),
            hash_key=HASH_KEY,
            now=NOW,
        )
        db.commit()

    # 既定の /docs（Swagger UI）が一覧routeと衝突しないようにする。
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(docs_router)
    app.include_router(ai_router)
    spy = SpyDispatcher()
    app.state.agent_credential_hash_key = HASH_KEY
    app.state.access_control_adapter = None
    app.state.audit_dispatcher = spy

    def _test_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = _test_db
    with TestClient(app) as client:
        yield {
            "client": client,
            "factory": factory,
            "token_a": token_a,
            "token_b": token_b,
            "spy": spy,
        }
    engine.dispose()


def _h(token: str, **extra: str) -> dict[str, str]:
    return {AGENT_CREDENTIAL_HEADER: token, **extra}


def test_same_doc_id_resolves_only_inside_the_credentials_tenant(env) -> None:
    client = env["client"]
    a = client.get("/docs/shared-doc", headers=_h(env["token_a"]))
    b = client.get("/docs/shared-doc", headers=_h(env["token_b"]))
    a_to_b_only = client.get("/docs/b-only", headers=_h(env["token_a"]))
    b_to_a_only = client.get("/docs/a-ungranted", headers=_h(env["token_b"]))

    # 文書の題名は agent へ返さない。同じ docId でも、tenant ごとの内容で区別する。
    assert a.json()["title"] is None and b.json()["title"] is None
    assert len(a.json()["cards"]) == 3
    assert b.json()["cards"] == []
    assert a_to_b_only.status_code == 404
    assert b_to_a_only.status_code == 404


def test_ungranted_documents_look_the_same_as_missing_ones(env) -> None:
    client = env["client"]
    ungranted = client.get("/docs/a-ungranted", headers=_h(env["token_a"]))
    missing = client.get("/docs/does-not-exist", headers=_h(env["token_a"]))
    other_tenant = client.get("/docs/b-only", headers=_h(env["token_a"]))

    assert ungranted.status_code == missing.status_code == other_tenant.status_code == 404
    assert ungranted.json() == missing.json() == other_tenant.json()


def test_tenant_hints_in_the_request_are_never_trusted(env) -> None:
    response = env["client"].get(
        "/docs/b-only",
        headers=_h(
            env["token_a"],
            **{"x-tenant-id": "tenant-b", "x-actor-ref": "someone-else", "x-policy-ref": "p"},
        ),
        params={"tenantId": "tenant-b"},
    )
    assert response.status_code == 404


@pytest.mark.parametrize(
    "token",
    ["", "suiag_" + "x" * 300, "not-an-agent-token", "suiag_unknown-token"],
)
def test_malformed_or_unknown_credentials_fail_closed_with_one_response(env, token) -> None:
    response = env["client"].get("/docs/shared-doc", headers=_h(token))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "agent_credential_invalid"


def test_list_returns_only_granted_documents(env) -> None:
    client = env["client"]
    a = client.get("/docs", headers=_h(env["token_a"]))
    b = client.get("/docs", headers=_h(env["token_b"]))

    assert a.status_code == 200, a.text
    assert [item["id"] for item in a.json()] == ["shared-doc"]
    assert [item["id"] for item in b.json()] == ["shared-doc"]
    assert a.json()[0]["title"] is None and b.json()[0]["title"] is None


def test_credential_revocation_applies_to_the_next_request(env) -> None:
    client = env["client"]
    assert client.get("/docs/shared-doc", headers=_h(env["token_a"])).status_code == 200
    with env["factory"]() as db:
        AgentCredentialRepository(db, tenant_id="tenant-a").revoke_credential(
            agent_id="agent-a", now=datetime.now(timezone.utc)
        )
        db.commit()

    revoked = client.get("/docs/shared-doc", headers=_h(env["token_a"]))
    assert revoked.status_code == 401
    assert revoked.json()["detail"]["code"] == "agent_credential_invalid"
    # 別tenantのagentには影響しない。
    assert client.get("/docs/shared-doc", headers=_h(env["token_b"])).status_code == 200


def test_document_grant_revocation_applies_to_the_next_request(env) -> None:
    client = env["client"]
    with env["factory"]() as db:
        AgentCredentialRepository(db, tenant_id="tenant-a").revoke_document_grant(
            agent_id="agent-a", doc_id="shared-doc", now=datetime.now(timezone.utc)
        )
        db.commit()

    assert client.get("/docs/shared-doc", headers=_h(env["token_a"])).status_code == 404
    assert client.get("/docs", headers=_h(env["token_a"])).json() == []


def test_expired_and_version_mismatched_credentials_are_rejected(env) -> None:
    client = env["client"]
    with env["factory"]() as db:
        credential = db.get(AgentCredentialRow, ("tenant-a", "agent-a"))
        credential.expires_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        index = db.scalars(
            select(AgentCredentialIndexRow).where(AgentCredentialIndexRow.tenant_id == "tenant-b")
        ).one()
        index.credential_version = 2
        db.commit()

    assert client.get("/docs/shared-doc", headers=_h(env["token_a"])).status_code == 401
    assert client.get("/docs/shared-doc", headers=_h(env["token_b"])).status_code == 401


def test_agent_credentials_never_write_export_or_change_state(env) -> None:
    client = env["client"]
    headers = _h(env["token_a"])
    before = client.get("/docs/shared-doc", headers=headers).json()

    responses = [
        client.put("/docs/shared-doc", headers=headers, json=_payload("shared-doc", "changed")),
        client.post(
            "/docs/shared-doc/export-audit",
            headers=headers,
            json={"safeMode": False, "exportKind": "bundle"},
        ),
        client.post("/docs/shared-doc/archive", headers=headers),
        client.post("/docs/shared-doc/unarchive", headers=headers),
    ]

    assert [r.status_code for r in responses] == [403, 403, 403, 403]
    assert {r.json()["detail"]["code"] for r in responses} == {"agent_write_not_enabled"}
    assert client.get("/docs/shared-doc", headers=headers).json() == before


def test_derived_read_routes_stay_closed_to_agents(env) -> None:
    client = env["client"]
    headers = _h(env["token_a"])
    closed = [
        client.get("/docs/shared-doc/merge-decision-logs/by-group/group-1", headers=headers),
        client.get("/docs/shared-doc/merge-decision-logs/restore/v1", headers=headers),
        client.get("/docs/shared-doc/similar-candidate-groups", headers=headers),
    ]

    assert [r.status_code for r in closed] == [403, 403, 403]
    assert {r.json()["detail"]["code"] for r in closed} == {"agent_route_not_enabled"}


def test_unreviewed_card_text_is_withheld_from_agents(env) -> None:
    body = env["client"].get("/docs/shared-doc", headers=_h(env["token_a"])).json()
    texts = {card["id"]: card["text"] for card in body["cards"]}

    assert texts == {"c-reviewed": "REVIEWED-TEXT", "c-unreviewed": "", "c-unknown": ""}
    assert "SECRET" not in json.dumps(body)


def test_only_reviewed_text_and_allowed_structure_reach_agents(env) -> None:
    response = env["client"].get("/docs/shared-doc", headers=_h(env["token_a"]))
    body = response.json()
    serialized = json.dumps(body)

    assert response.status_code == 200, response.text
    # 本文を含む他の項目は、許可リストに無いので出ない。
    for withheld in (
        "SECRET-ISLAND-SUMMARY",
        "SECRET-ISLAND-CRITIQUE",
        "SECRET-UNREVIEWED-ISLAND-TITLE",
        "SECRET-LINK-NOTE",
        "SECRET-VOID-TITLE",
        "SECRET-VOID-DETAIL",
        "SECRET-NARRATIVE-TITLE",
        "SECRET-NARRATIVE-TEXT",
        "SECRET-CHECK-MESSAGE",
        "SECRET-RELATION-TEXT",
        "A shared",  # 文書の題名
    ):
        assert withheld not in serialized, withheld
    assert "relationSummaries" not in body
    # 確認済みの本文と構造は出る。
    titles = {island["id"]: island.get("title") for island in body["islands"]}
    assert titles == {"i-reviewed": "REVIEWED-ISLAND-TITLE", "i-unreviewed": None}
    assert [link["id"] for link in body["evidenceLinks"]] == ["e1"]
    assert body["narratives"][0]["checks"][0]["issues"][0]["direction"] == "a_missing_in_b"


def test_proposal_status_and_context_audit_are_scoped_to_the_grant(env) -> None:
    client = env["client"]
    status_ok = client.get(
        "/ai/proposals/status", params={"docId": "shared-doc"}, headers=_h(env["token_a"])
    )
    status_denied = client.get(
        "/ai/proposals/status", params={"docId": "a-ungranted"}, headers=_h(env["token_a"])
    )
    audit_body = {
        "operation": "query",
        "safeMode": True,
        "equivalenceKey": "a" * 64,
        "bundleHash": "b" * 64,
        "command": "context-query",
        "channel": "mcp",
    }
    audit_ok = client.post(
        "/docs/shared-doc/context-audit", json=audit_body, headers=_h(env["token_a"])
    )
    audit_denied = client.post(
        "/docs/a-ungranted/context-audit", json=audit_body, headers=_h(env["token_a"])
    )

    assert status_ok.status_code == 200 and status_ok.json()["proposals"] == []
    assert status_denied.status_code == 404
    assert audit_ok.status_code == 200, audit_ok.text
    assert audit_denied.status_code == 404


def test_audit_event_carries_tenant_and_agent_but_no_content_or_token(env) -> None:
    # x-actor-ref を偽装しても、監査の主体は検証済みの agent になる。
    env["client"].get(
        "/docs/shared-doc", headers=_h(env["token_a"], **{"x-actor-ref": "spoofed-user"})
    )
    event = env["spy"].events[-1]

    assert event.tenantId == "tenant-a"
    assert event.actorRefHash == sha256(b"agent:agent-a").hexdigest()[:24]
    assert event.actorRefHash != sha256(b"spoofed-user").hexdigest()[:24]
    assert env["token_a"] not in repr(event)
    assert "REVIEWED-TEXT" not in repr(event)


def test_the_raw_token_is_never_persisted_or_echoed(env) -> None:
    with env["factory"]() as db:
        index = db.scalars(
            select(AgentCredentialIndexRow).where(AgentCredentialIndexRow.tenant_id == "tenant-a")
        ).one()
        stored = " ".join(
            str(value)
            for row in db.execute(select(AgentCredentialRow)).all()
            for value in row[0].__dict__.values()
        )
    rejected = env["client"].get("/docs/shared-doc", headers=_h(env["token_a"] + "x"))

    assert env["token_a"] not in stored
    assert env["token_a"] != index.token_hash
    assert env["token_a"] not in index.token_hash
    assert env["token_a"] not in rejected.text


def test_registration_requires_an_explicit_existing_grant_and_a_future_expiry(env) -> None:
    from sui_sensemaking_api.agent_credentials import AgentCredentialError

    with env["factory"]() as db:
        repo = AgentCredentialRepository(db, tenant_id="tenant-a")
        common = {
            "label": "x",
            "created_by": "admin",
            "hash_key": HASH_KEY,
            "now": datetime.now(timezone.utc),
        }
        with pytest.raises(AgentCredentialError):
            repo.register(agent_id="a1", expires_at=FUTURE, doc_ids=(), **common)
        with pytest.raises(AgentCredentialError):
            repo.register(agent_id="a2", expires_at=FUTURE, doc_ids=("b-only",), **common)
        with pytest.raises(AgentCredentialError):
            repo.register(
                agent_id="a3",
                expires_at=(datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
                doc_ids=("shared-doc",),
                **common,
            )
