from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import AIProposalDecisionEventRow, AIProposalRow, Base
from sui_sensemaking_api.settings import settings as _settings


@pytest.fixture()
def sqlite_client(tmp_path) -> Iterator[tuple[TestClient, sessionmaker]]:
    engine = create_engine(
        f"sqlite:///{tmp_path / 'external-proposal.sqlite3'}",
        connect_args={"check_same_thread": False},
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
    try:
        with TestClient(app) as client:
            client.headers.update(
                {"x-forwarded-user": "external-reviewer", "x-auth-provider": "oidc"}
            )
            document = {
                "version": 1,
                "id": "doc-1",
                "createdAt": "2026-08-11T00:00:00Z",
                "updatedAt": "2026-08-11T00:00:00Z",
                "transform": {"panX": 0, "panY": 0, "zoom": 1},
                "cards": [],
                "edges": [],
                "islands": [],
            }
            assert client.put("/docs/doc-1", json=document).status_code == 200
            yield client, session_local
    finally:
        _settings.allow_jit_provisioning = _original_allow_jit
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _registration(**overrides) -> dict:
    return {
        "docId": "doc-1",
        "taskId": "task-1",
        "baseDocSignature": "doc-1:2026-08-11T00:00:00Z",
        "sourceBundleHash": "a" * 64,
        "queryCanonicalHash": "b" * 64,
        "proposalId": "proposal-1",
        "proposalKind": "critique",
        "proposalFingerprint": "c" * 64,
        "provenanceLevel": "user_presented_unsigned",
        **overrides,
    }


def _task_registration(**overrides) -> dict:
    return {
        "docId": "doc-1",
        "taskId": "task-1",
        "baseDocSignature": "doc-1:2026-08-11T00:00:00Z",
        "sourceBundleHash": "a" * 64,
        "queryCanonicalHash": "b" * 64,
        "taskKind": "critique_suggestions",
        "provenanceLevel": "user_presented_unsigned",
        **overrides,
    }


def _decision(**overrides) -> dict:
    return {
        "docId": "doc-1",
        "proposalId": "proposal-1",
        "sourceBundleHash": "a" * 64,
        "idempotencyKey": "decision-1",
        "decision": "adopt",
        "provenanceLevel": "user_presented_unsigned",
        **overrides,
    }


def test_registers_content_free_unsigned_provenance_and_records_decision(sqlite_client) -> None:
    client, session_local = sqlite_client
    assert client.post("/ai/external-tasks/register", json=_task_registration()).status_code == 200
    registered = client.post("/ai/external-proposals/register", json=_registration())
    assert registered.status_code == 200
    assert registered.json()["provenanceLevel"] == "user_presented_unsigned"

    decided = client.post("/ai/external-proposals/audit", json=_decision())
    assert decided.status_code == 200
    assert decided.json()["status"] == "accepted"

    with session_local() as db:
        proposal = db.get(AIProposalRow, ("local-default", "doc-1", "proposal-1"))
        assert proposal is not None
        assert proposal.origin == "external_agent"
        assert proposal.provenance_level == "user_presented_unsigned"
        assert proposal.proposal_fingerprint == "c" * 64
        assert "rationale" not in repr(proposal.__dict__)
        event = db.scalar(select(AIProposalDecisionEventRow))
        assert event is not None
        assert event.proposal_origin == "external_agent"
        assert event.provenance_level == "user_presented_unsigned"


def test_registration_is_idempotent_but_rejects_task_or_hash_reuse(sqlite_client) -> None:
    client, _ = sqlite_client
    assert client.post("/ai/external-tasks/register", json=_task_registration()).status_code == 200
    first = client.post("/ai/external-proposals/register", json=_registration())
    retry = client.post("/ai/external-proposals/register", json=_registration())
    mismatch = client.post(
        "/ai/external-proposals/register",
        json=_registration(proposalFingerprint="d" * 64),
    )
    assert first.status_code == retry.status_code == 200
    assert mismatch.status_code == 409


def test_registration_rejects_stale_document_and_invalid_provenance(sqlite_client) -> None:
    client, _ = sqlite_client
    stale = client.post(
        "/ai/external-proposals/register",
        json=_registration(baseDocSignature="doc-1:old"),
    )
    invalid = client.post(
        "/ai/external-proposals/register",
        json=_registration(provenanceLevel="verified_agent"),
    )
    assert stale.status_code == 409
    assert invalid.status_code == 422


def test_internal_and_external_decision_endpoints_cannot_cross_origins(sqlite_client) -> None:
    client, _ = sqlite_client
    assert client.post("/ai/external-tasks/register", json=_task_registration()).status_code == 200
    assert client.post("/ai/external-proposals/register", json=_registration()).status_code == 200
    crossed = client.post(
        "/ai/proposals/audit",
        json={key: value for key, value in _decision().items() if key != "provenanceLevel"},
    )
    assert crossed.status_code == 409


def test_external_decision_is_idempotent_and_rejects_changed_decision(sqlite_client) -> None:
    client, _ = sqlite_client
    assert client.post("/ai/external-tasks/register", json=_task_registration()).status_code == 200
    assert client.post("/ai/external-proposals/register", json=_registration()).status_code == 200
    first = client.post("/ai/external-proposals/audit", json=_decision())
    retry = client.post("/ai/external-proposals/audit", json=_decision())
    changed = client.post(
        "/ai/external-proposals/audit",
        json=_decision(decision="reject"),
    )
    assert first.status_code == retry.status_code == 200
    assert first.json() == retry.json()
    assert changed.status_code == 409


def test_registration_is_content_free_and_rejects_body_fields(sqlite_client) -> None:
    client, _ = sqlite_client
    assert "content" not in AIProposalRow.__table__.columns

    response = client.post(
        "/ai/external-proposals/register",
        json=_registration(content="unreviewed external proposal text"),
    )
    assert response.status_code == 422


def test_task_registration_is_idempotent_and_rejects_reuse(sqlite_client) -> None:
    client, _ = sqlite_client
    first = client.post("/ai/external-tasks/register", json=_task_registration())
    retry = client.post("/ai/external-tasks/register", json=_task_registration())
    reused = client.post(
        "/ai/external-tasks/register",
        json=_task_registration(sourceBundleHash="d" * 64),
    )
    assert first.status_code == retry.status_code == 200
    assert reused.status_code == 409
