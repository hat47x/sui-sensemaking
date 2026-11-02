from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import AIProposalDecisionEventRow, AIProposalRow, Base
from sui_sensemaking_api.model_registry_repository import register_model, register_provider
from sui_sensemaking_api.models_ai import ProposalEnvelope
from sui_sensemaking_api.routes import ai
from sui_sensemaking_api.settings import settings as _settings


@pytest.fixture()
def sqlite_client(tmp_path) -> Iterator[tuple[TestClient, sessionmaker]]:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'ce2.sqlite3'}", connect_args={"check_same_thread": False}
    )
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    def _get_test_db():
        with session_local() as db:
            yield db

    app.dependency_overrides[get_db] = _get_test_db
    # SEC-RATE-LIMIT-01: this suite drives header-originated users via JIT
    # provisioning; pin it True so the tests are independent of the runtime
    # default (which is under review to become fail-closed/False).
    _original_allow_jit = _settings.allow_jit_provisioning
    _settings.allow_jit_provisioning = True
    # AI-MODEL-GOVERNANCE-02: _assert_model_allowed requires the model's
    # registered provider to match the runtime provider. The fixture registers
    # "default" under provider "local", so pin the runtime provider to "local"
    # (same alignment as test_ai_safemode/test_ai_eval_pipeline etc.).
    _original_llm_provider = _settings.llm_provider
    _settings.llm_provider = "local"
    try:
        with TestClient(app) as client:
            client.headers.update({"x-forwarded-user": "ce2-reviewer", "x-auth-provider": "oidc"})
            assert client.put("/docs/doc-1", json=_payload()["doc"]).status_code == 200
            with session_local() as db:
                # AI-MODEL-GOVERNANCE-02: the proposal route resolves the default
                # model and _assert_model_allowed now requires an active registered
                # model, so register the provider + default model (as env seed does).
                register_provider(
                    db,
                    provider_id="local",
                    provider_kind="local",
                    display_name="Local LLM (test)",
                    base_url="http://127.0.0.1:11434",
                    api_key_ref=None,
                    occurred_at="2026-08-11T00:00:00Z",
                )
                register_model(db, model_id="default", provider_id="local", display_name="default", capabilities="intermediate,generate", occurred_at="2026-08-11T00:00:00Z")
                db.commit()
                db.add(
                    AIProposalRow(
                        tenant_id="local-default",
                        doc_id="doc-1",
                        proposal_id="proposal-1",
                        proposal_kind="island_summary",
                        source_bundle_hash="a" * 64,
                        created_at="2026-08-11T00:00:00Z",
                    )
                )
                db.commit()
            yield client, session_local
    finally:
        _settings.allow_jit_provisioning = _original_allow_jit
        _settings.llm_provider = _original_llm_provider
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _payload() -> dict:
    return {
        "doc": {
            "version": 1,
            "id": "doc-1",
            "createdAt": "2026-02-11T00:00:00Z",
            "updatedAt": "2026-02-11T00:00:00Z",
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": [
                {"id": "c1", "text": "alpha", "x": 0, "y": 0, "textReviewed": True},
                {"id": "c2", "text": "beta", "x": 10, "y": 10, "textReviewed": True},
            ],
            "edges": [],
            "islands": [{"id": "i1", "cardIds": ["c1", "c2"], "summaryText": "old summary"}],
        },
        "islandId": "i1",
        "sourceBundleHash": "a" * 64,
    }


def test_propose_island_summary_returns_proposal_without_auto_apply(sqlite_client) -> None:
    client, session_local = sqlite_client
    original_generate = ai.generate_with_fallback

    class _StubResponse:
        raw_text = '{"candidates":[{"summaryText":"new summary","groundingIds":["c1"]}]}'

    ai.generate_with_fallback = lambda _: _StubResponse()
    try:
        response = client.post("/ai/proposals/island-summary", json=_payload())
    finally:
        ai.generate_with_fallback = original_generate
    assert response.status_code == 200
    body = response.json()
    assert body["proposalId"].startswith("proposal-")
    assert body["status"] == "proposed"
    assert body["reviewState"] == "unreviewed"
    assert body["sourceBundleHash"] == "a" * 64
    assert body["diff"]["before"] == "old summary"
    assert isinstance(body["diff"]["after"], str) and body["diff"]["after"].strip() != ""
    assert body["diff"]["candidates"][0]["summaryText"] == "new summary"
    assert body["diff"]["candidates"][0]["groundingIds"] == ["c1"]
    with session_local() as db:
        registered = db.get(AIProposalRow, ("local-default", "doc-1", body["proposalId"]))
        assert registered is not None
        assert registered.source_bundle_hash == "a" * 64


def test_ai_proposal_envelope_rejects_review_promotion() -> None:
    body = {
        "proposalId": "proposal-1",
        "type": "island_summary",
        "status": "proposed",
        "reviewState": "reviewed",
        "sourceBundleHash": "a" * 64,
        "diff": {
            "entityType": "island_summary",
            "targetId": "i1",
            "field": "summaryText",
            "before": "old",
            "after": "new",
            "groundingIds": ["c1"],
        },
        "rationale": "AI proposal",
    }

    with pytest.raises(ValidationError):
        ProposalEnvelope.model_validate(body)


def _decision_payload(*, decision: str, key: str = "operation-1") -> dict:
    return {
        "docId": "doc-1",
        "proposalId": "proposal-1",
        "sourceBundleHash": "a" * 64,
        "idempotencyKey": key,
        "decision": decision,
    }


@pytest.mark.parametrize(
    ("decision", "expected_status"),
    [("adopt", "accepted"), ("reject", "rejected"), ("hold", "held")],
)
def test_record_proposal_decision_maps_to_lifecycle_status_without_review_promotion(
    sqlite_client, decision: str, expected_status: str
) -> None:
    client, _ = sqlite_client
    response = client.post("/ai/proposals/audit", json=_decision_payload(decision=decision))
    assert response.status_code == 200
    assert response.json()["recorded"] is True
    assert response.json()["status"] == expected_status
    assert response.json()["reviewState"] == "unreviewed"


def test_record_proposal_decision_rejects_lifecycle_vocab(sqlite_client) -> None:
    client, _ = sqlite_client
    for decision in ("accepted", "rejected", "held"):
        response = client.post(
            "/ai/proposals/audit", json=_decision_payload(decision=decision, key=decision)
        )
        assert response.status_code == 422


def test_proposal_status_reads_lifecycle_without_mutation(sqlite_client) -> None:
    """GET /ai/proposals/status is read-only: it reports the proposal lifecycle
    (proposal-only -> decided) without writing anything -- the read API that a
    generative-AI MCP verifier consumes."""
    client, _ = sqlite_client
    # 1. Before any decision: the fixture-registered proposal is proposal-only.
    before = client.get("/ai/proposals/status", params={"docId": "doc-1"})
    assert before.status_code == 200, before.text
    items = before.json()["proposals"]
    assert any(
        p["proposalId"] == "proposal-1"
        and p["status"] == "proposed"
        and p["decidedAt"] is None
        and p["sourceBundleHash"] == "a" * 64
        for p in items
    )
    # 2. A human decision flips the status (CE4 proposal-only -> decided).
    decision = client.post("/ai/proposals/audit", json=_decision_payload(decision="adopt"))
    assert decision.status_code == 200, decision.text
    after = client.get("/ai/proposals/status", params={"docId": "doc-1"})
    assert after.status_code == 200, after.text
    decided = next(p for p in after.json()["proposals"] if p["proposalId"] == "proposal-1")
    assert decided["status"] == "accepted"
    assert decided["decidedAt"] is not None
    assert decided["proposalKind"] == "island_summary"


def test_propose_island_summary_rejects_invalid_source_bundle_hash() -> None:
    payload = _payload()
    payload["sourceBundleHash"] = "invalid-hash"
    with TestClient(app) as client:
        response = client.post("/ai/proposals/island-summary", json=payload)
    assert response.status_code == 422


def test_record_proposal_decision_rejects_unknown_fields_via_schema_validation(
    sqlite_client,
) -> None:
    client, _ = sqlite_client
    response = client.post(
        "/ai/proposals/audit",
        json={**_decision_payload(decision="adopt"), "unexpected": True},
    )
    assert response.status_code == 422


def test_record_proposal_decision_is_idempotent_and_does_not_store_reason(
    sqlite_client,
    caplog,
) -> None:
    client, session_local = sqlite_client
    payload = {**_decision_payload(decision="hold"), "reason": "private explanation"}
    first = client.post("/ai/proposals/audit", json=payload)
    second = client.post("/ai/proposals/audit", json=payload)
    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()

    with session_local() as db:
        rows = list(db.scalars(select(AIProposalDecisionEventRow)))
        assert len(rows) == 1
        assert rows[0].reason_sha256 is not None
        assert rows[0].reason_utf8_bytes == len("private explanation".encode("utf-8"))
        assert "private explanation" not in repr(rows[0].__dict__)
    assert "private explanation" not in caplog.text


def test_record_proposal_decision_allows_held_then_terminal_and_rejects_later_change(
    sqlite_client,
) -> None:
    client, _ = sqlite_client
    held = client.post("/ai/proposals/audit", json=_decision_payload(decision="hold", key="hold-1"))
    accepted = client.post(
        "/ai/proposals/audit", json=_decision_payload(decision="adopt", key="adopt-1")
    )
    rejected = client.post(
        "/ai/proposals/audit", json=_decision_payload(decision="reject", key="reject-1")
    )
    assert held.status_code == 200
    assert accepted.status_code == 200
    assert rejected.status_code == 409

    status = client.get("/ai/proposals/status", params={"docId": "doc-1"})
    assert status.status_code == 200, status.text
    item = next(p for p in status.json()["proposals"] if p["proposalId"] == "proposal-1")
    assert item["status"] == "accepted"
    assert item["decidedAt"] is not None
    assert item["sourceBundleHash"] == "a" * 64


def test_record_proposal_decision_requires_existing_document(sqlite_client) -> None:
    client, _ = sqlite_client
    response = client.post(
        "/ai/proposals/audit",
        json={**_decision_payload(decision="adopt"), "docId": "missing"},
    )
    assert response.status_code == 404


def test_record_proposal_decision_rejects_unregistered_proposal(sqlite_client) -> None:
    client, _ = sqlite_client
    response = client.post(
        "/ai/proposals/audit",
        json={**_decision_payload(decision="adopt"), "proposalId": "not-generated"},
    )
    assert response.status_code == 404
