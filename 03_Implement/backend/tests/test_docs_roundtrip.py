from __future__ import annotations

import json
import os
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from sui_sensemaking_api.content_store import ContentBlob
from sui_sensemaking_api.database_content_store import DatabaseDocumentContentStore
from sui_sensemaking_api.db import _normalize_database_url, get_db
from sui_sensemaking_api.main import app
from sui_sensemaking_api.models import Base, DocumentV1
from sui_sensemaking_api.routes.docs import _action_preserves_stored_fields
from sui_sensemaking_api.tenant_context import LOCAL_DEFAULT_TENANT_CONTEXT

RUN_PG_TESTS_ENV = "SUI_RUN_PG_TESTS"
DATABASE_URL_ENV = "SUI_DATABASE_URL"
BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture()
def sqlite_client(tmp_path) -> Iterator[TestClient]:
    db_path = tmp_path / "docs_roundtrip.sqlite3"
    database_url = f"sqlite:///{db_path}"
    yield from _client_for_database_url(database_url, use_create_drop_tables=True)


@pytest.fixture()
def postgres_client() -> Iterator[TestClient]:
    postgres_url = os.getenv(DATABASE_URL_ENV, "")
    should_run_pg_tests = os.getenv(RUN_PG_TESTS_ENV) == "1" or postgres_url.startswith(
        "postgresql"
    )

    if not should_run_pg_tests or not postgres_url.startswith("postgresql"):
        pytest.skip(
            f"set {RUN_PG_TESTS_ENV}=1 and {DATABASE_URL_ENV}=postgresql://... to run PostgreSQL docs roundtrip tests",
            allow_module_level=False,
        )

    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=True,
        cwd=BACKEND_DIR,
    )

    yield from _client_for_database_url(postgres_url, use_create_drop_tables=False)


def _client_for_database_url(
    database_url: str, *, use_create_drop_tables: bool
) -> Iterator[TestClient]:
    engine = create_engine(_normalize_database_url(database_url))
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    if use_create_drop_tables:
        Base.metadata.create_all(bind=engine)

    def _get_test_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_test_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        if use_create_drop_tables:
            Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _sample_payload(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 10, "panY": -5, "zoom": 1.25},
        "cards": [
            {
                "id": "card-1",
                "text": "alpha",
                "x": 12.5,
                "y": -9.0,
                "critique": None,
            }
        ],
        "edges": [],
        "islands": [],
    }


def _sample_payload_v1_with_collapsed(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {
                "id": "card-1",
                "text": "alpha",
                "x": 12.5,
                "y": -9.0,
            },
            {
                "id": "card-2",
                "text": "beta",
                "x": 212.5,
                "y": 91.0,
            },
        ],
        "edges": [
            {
                "id": "edge-1",
                "fromId": "card-1",
                "toId": "card-2",
                "type": "related",
            }
        ],
        "islands": [
            {
                "id": "parent-island",
                "cardIds": ["card-1"],
                "placardCardId": "card-1",
                "collapsed": True,
                "title": "Parent",
            },
            {
                "id": "child-island",
                "cardIds": ["card-2"],
                "parentIslandId": "parent-island",
                "placardCardId": "card-2",
                "collapsed": False,
                "title": "Child",
            },
        ],
    }


def _sample_payload_v1_with_canonical(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-canonical",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {
                "id": "card-canonical",
                "text": "alpha",
                "x": 12.5,
                "y": -9.0,
                "sources": ["card-source"],
            },
            {
                "id": "card-source",
                "text": "alpha (duplicate)",
                "x": 212.5,
                "y": 91.0,
                "canonicalId": "card-canonical",
            },
        ],
        "edges": [],
        "islands": [],
    }


def _sample_payload_v1_with_shelf(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-shelf",
        "createdAt": "2026-06-21T00:00:00Z",
        "updatedAt": "2026-06-21T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {
                "id": "card-shelved",
                "text": "revisit later",
                "x": 42.5,
                "y": -18.0,
                "holdState": "shelved",
            },
            {
                "id": "card-active",
                "text": "keep visible",
                "x": 200.0,
                "y": 100.0,
            },
        ],
        "edges": [],
        "islands": [],
        "shelf": [
            {
                "cardId": "card-shelved",
                "shelvedAt": "2026-06-21T01:23:45Z",
                "reason": "Needs another interview",
            }
        ],
    }


def _sample_payload_v1_with_merge_suggestion_decisions(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-merge-decisions",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {"id": "card-1", "text": "alpha", "x": 12.5, "y": -9.0},
            {"id": "card-2", "text": "Alpha", "x": 212.5, "y": 91.0},
        ],
        "edges": [],
        "islands": [],
        "mergeSuggestionDecisions": [
            {
                "id": "decision-1",
                "groupId": "heuristic-alpha-card-1-card-2",
                "decision": "defer",
                "decidedAt": "2026-02-11T00:03:00Z",
                "cardIds": ["card-1", "card-2"],
                "mergedTextDraft": "alpha",
                "editedText": "alpha",
                "rationale": "heuristic:normalized-text",
            }
        ],
    }


def _sample_merge_decision_record(
    *, decision_id: str, group_id: str, snapshot_version: str, action: str = "defer"
) -> dict:
    return {
        "decisionId": decision_id,
        "groupId": group_id,
        "action": action,
        "selectedCardIds": ["card-1", "card-2"],
        "note": "manual assisted decision",
        "decidedBy": "reviewer:opaque-1",
        "decidedAt": "2026-02-11T00:03:00Z",
        "snapshotVersion": snapshot_version,
    }


def _sample_payload_v1_with_representative_cue(doc_id: str) -> dict:
    # DOMAIN-VISUAL-CUE-01 (schemas.md §19): Island.representativeCue must survive PUT -> GET.
    # island-invalid-kind carries an out-of-enum kind. schemas.md §19.3 / §19.6 say only that
    # cue is omitted; the island and the document are still accepted.
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-representative-cue",
        "createdAt": "2026-07-29T00:00:00Z",
        "updatedAt": "2026-07-29T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {"id": "card-1", "text": "alpha", "x": 12.5, "y": -9.0},
            {"id": "card-2", "text": "beta", "x": 212.5, "y": 91.0},
            {"id": "card-3", "text": "gamma", "x": 412.5, "y": 191.0},
            {"id": "card-4", "text": "delta", "x": 612.5, "y": 291.0},
        ],
        "edges": [],
        "islands": [
            {
                "id": "island-hand",
                "cardIds": ["card-1"],
                "representativeCue": {
                    "kind": "hand_drawn",
                    "cueId": "hand-cue-1",
                    "altText": "hand drawn arrow",
                    "imageRef": "idb-hand-1",
                },
            },
            {
                "id": "island-preset",
                "cardIds": ["card-2"],
                "representativeCue": {
                    "kind": "preset_svg",
                    "cueId": "place",
                    "altText": "place",
                    "imageRef": "stray-ref-dropped",
                },
            },
            {
                "id": "island-emoji",
                "cardIds": ["card-3"],
                "representativeCue": {"kind": "emoji", "cueId": "📍", "altText": "location"},
            },
            {
                "id": "island-invalid-kind",
                "cardIds": ["card-4"],
                "title": "invalid cue island",
                "representativeCue": {"kind": "external_url", "cueId": "x", "altText": "y"},
            },
        ],
    }


def _sample_payload_v1_with_relation_summaries(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-relations",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {"id": "card-1", "text": "alpha", "x": 12.5, "y": -9.0},
            {"id": "card-2", "text": "beta", "x": 212.5, "y": 91.0},
        ],
        "edges": [{"id": "edge-1", "fromId": "card-1", "toId": "card-2", "type": "related"}],
        "islands": [
            {"id": "island-1", "cardIds": ["card-1"]},
            {"id": "island-2", "cardIds": ["card-2"]},
        ],
        "relationSummaries": [
            {
                "id": "rs-1",
                "createdAt": "2026-02-11T00:01:00Z",
                "islandAId": "island-1",
                "islandBId": "island-2",
                "relationType": "related",
                "derived": False,
                "text": "alpha supports beta",
                "reviewed": True,
                "groundingCardIds": ["card-1", "card-2"],
                "groundingEdgeIds": ["edge-1"],
                "warnings": ["reviewed by user"],
                "sourceSignature": "edge:edge-1",
                "history": [
                    {
                        "id": "h-ai",
                        "createdAt": "2026-02-11T00:01:00Z",
                        "changeKind": "ai",
                        "fromText": None,
                        "toText": "alpha and beta are related",
                        "fromReviewed": None,
                        "toReviewed": False,
                        "warningsSnapshot": ["initial draft"],
                        "groundingCardIdsSnapshot": ["card-1", "card-2"],
                        "groundingEdgeIdsSnapshot": ["edge-1"],
                    },
                    {
                        "id": "h-manual",
                        "createdAt": "2026-02-11T00:02:00Z",
                        "changeKind": "manual",
                        "fromText": "alpha and beta are related",
                        "toText": "alpha supports beta",
                        "fromReviewed": False,
                        "toReviewed": True,
                        "warningsSnapshot": ["reviewed by user"],
                        "groundingCardIdsSnapshot": ["card-1", "card-2"],
                        "groundingEdgeIdsSnapshot": ["edge-1"],
                    },
                ],
            }
        ],
    }


def _sample_payload_v1_without_relation_summary_history(doc_id: str) -> dict:
    payload = _sample_payload_v1_with_relation_summaries(doc_id)
    payload["relationSummaries"][0].pop("history", None)
    return payload


def _sample_payload_v1_with_evidence_links(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-evidence",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {"id": "fact-1", "text": "Observed fact", "x": 0, "y": 0, "claimType": "fact"},
            {"id": "claim-1", "text": "Working claim", "x": 160, "y": 0, "claimType": "claim"},
        ],
        "edges": [
            {
                "id": "edge-claim-1",
                "fromId": "fact-1",
                "toId": "claim-1",
                "fromKind": "card",
                "toKind": "card",
                "type": "related",
            }
        ],
        "islands": [],
        "evidenceLinks": [
            {
                "id": "evidence-1",
                "type": "supports",
                "fromCardId": "fact-1",
                "toCardId": "claim-1",
                "note": "manual link",
                "createdAt": "2026-02-11T00:01:00Z",
            }
        ],
        "patchApplyLog": [
            {
                "id": "patch-log-1",
                "createdAt": "2026-02-11T00:02:00Z",
                "patchVersion": "1",
                "appliedOpIds": ["op-evidence-1"],
                "stats": {
                    "upsertCards": 0,
                    "deleteCards": 0,
                    "upsertIslands": 0,
                    "deleteIslands": 0,
                    "upsertEdges": 0,
                    "deleteEdges": 0,
                    "upsertRelationSummaries": 0,
                    "deleteRelationSummaries": 0,
                    "upsertEvidenceLinks": 1,
                    "deleteEvidenceLinks": 0,
                },
            }
        ],
    }


def _assert_v1_canonical_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-canonical"
    payload = _sample_payload_v1_with_canonical(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_json = put_response.json()
    put_cards_by_id = {card["id"]: card for card in put_json["cards"]}
    assert put_cards_by_id["card-source"]["canonicalId"] == "card-canonical"
    assert put_cards_by_id["card-canonical"]["sources"] == ["card-source"]

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_json = get_response.json()
    get_cards_by_id = {card["id"]: card for card in get_json["cards"]}
    assert get_cards_by_id["card-source"]["canonicalId"] == "card-canonical"
    assert get_cards_by_id["card-canonical"]["sources"] == ["card-source"]


def _assert_v1_shelf_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-shelf"
    payload = _sample_payload_v1_with_shelf(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_json = put_response.json()
    put_card = next(card for card in put_json["cards"] if card["id"] == "card-shelved")
    assert put_card["holdState"] == "shelved"
    assert put_card["x"] == 42.5
    assert put_card["y"] == -18.0
    assert put_json["shelf"][0]["cardId"] == "card-shelved"
    assert put_json["shelf"][0]["reason"] == "Needs another interview"

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_json = get_response.json()
    get_card = next(card for card in get_json["cards"] if card["id"] == "card-shelved")
    assert get_card["holdState"] == "shelved"
    assert get_card["x"] == 42.5
    assert get_card["y"] == -18.0
    assert get_json["shelf"][0]["cardId"] == "card-shelved"
    assert get_json["shelf"][0]["reason"] == "Needs another interview"


def _assert_v1_collapsed_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-collapsed"
    payload = _sample_payload_v1_with_collapsed(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_json = put_response.json()
    assert put_json["version"] == 1
    assert put_json["id"] == doc_id

    put_islands_by_id = {island["id"]: island for island in put_json["islands"]}
    assert put_islands_by_id["parent-island"]["collapsed"] is True
    assert put_islands_by_id["child-island"]["collapsed"] is False
    assert put_islands_by_id["child-island"]["parentIslandId"] == "parent-island"
    assert "parentIslandId" not in put_islands_by_id["parent-island"]
    assert put_islands_by_id["parent-island"]["placardCardId"] == "card-1"
    assert put_islands_by_id["child-island"]["placardCardId"] == "card-2"

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_json = get_response.json()

    get_islands_by_id = {island["id"]: island for island in get_json["islands"]}
    assert get_islands_by_id["parent-island"]["collapsed"] is True
    assert get_islands_by_id["child-island"]["collapsed"] is False
    assert get_islands_by_id["child-island"]["parentIslandId"] == "parent-island"
    assert "parentIslandId" not in get_islands_by_id["parent-island"]
    assert get_islands_by_id["parent-island"]["placardCardId"] == "card-1"
    assert get_islands_by_id["child-island"]["placardCardId"] == "card-2"


def _assert_v1_merge_suggestion_decisions_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-merge-decisions"
    payload = _sample_payload_v1_with_merge_suggestion_decisions(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_json = put_response.json()
    assert put_json["mergeSuggestionDecisions"][0]["decision"] == "defer"

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_json = get_response.json()
    assert get_json["mergeSuggestionDecisions"][0]["id"] == "decision-1"
    assert get_json["mergeSuggestionDecisions"][0]["groupId"] == "heuristic-alpha-card-1-card-2"


def _assert_v1_representative_cue_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-representative-cue"
    payload = _sample_payload_v1_with_representative_cue(doc_id)
    expected_cues = {
        "island-hand": {
            "kind": "hand_drawn",
            "cueId": "hand-cue-1",
            "altText": "hand drawn arrow",
            "imageRef": "idb-hand-1",
        },
        # imageRef is meaningful only for hand_drawn / user_image (schemas.md §19.3).
        "island-preset": {"kind": "preset_svg", "cueId": "place", "altText": "place"},
        "island-emoji": {"kind": "emoji", "cueId": "📍", "altText": "location"},
    }

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200

    for response in (put_response, get_response):
        islands_by_id = {island["id"]: island for island in response.json()["islands"]}
        for island_id, cue in expected_cues.items():
            assert islands_by_id[island_id]["representativeCue"] == cue
        invalid_island = islands_by_id["island-invalid-kind"]
        assert "representativeCue" not in invalid_island
        assert invalid_island["title"] == "invalid cue island"


def _assert_merge_decision_logs_contract_roundtrip(client: TestClient) -> None:
    doc_id = "doc-merge-decision-log"
    payload = _sample_payload_v1_with_merge_suggestion_decisions(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200

    first_record = _sample_merge_decision_record(
        decision_id="decision-1",
        group_id="group-1",
        snapshot_version="snap-1",
        action="accept",
    )
    second_record = _sample_merge_decision_record(
        decision_id="decision-2",
        group_id="group-1",
        snapshot_version="snap-1",
        action="partial",
    )

    append_first = client.post(f"/docs/{doc_id}/merge-decision-logs", json={"record": first_record})
    assert append_first.status_code == 201
    assert append_first.json()["action"] == "accept"

    append_second = client.post(
        f"/docs/{doc_id}/merge-decision-logs", json={"record": second_record}
    )
    assert append_second.status_code == 201
    assert append_second.json()["action"] == "partial"

    by_group_response = client.get(f"/docs/{doc_id}/merge-decision-logs/by-group/group-1")
    assert by_group_response.status_code == 200
    by_group_json = by_group_response.json()
    assert [entry["decisionId"] for entry in by_group_json] == ["decision-1", "decision-2"]

    restore_response = client.get(f"/docs/{doc_id}/merge-decision-logs/restore/snap-1")
    assert restore_response.status_code == 200
    restore_json = restore_response.json()
    assert [entry["action"] for entry in restore_json] == ["accept", "partial"]


def _assert_merge_decision_logs_contract_validation(client: TestClient) -> None:
    doc_id = "doc-merge-decision-log-validation"
    payload = _sample_payload_v1_with_merge_suggestion_decisions(doc_id)
    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200

    invalid_record = _sample_merge_decision_record(
        decision_id="decision-invalid",
        group_id="group-invalid",
        snapshot_version="snap-invalid",
        action="auto",
    )
    invalid_response = client.post(
        f"/docs/{doc_id}/merge-decision-logs", json={"record": invalid_record}
    )
    assert invalid_response.status_code == 422

    first_record = _sample_merge_decision_record(
        decision_id="decision-dup",
        group_id="group-dup",
        snapshot_version="snap-dup",
    )
    second_record = _sample_merge_decision_record(
        decision_id="decision-dup",
        group_id="group-dup",
        snapshot_version="snap-dup-2",
    )
    first_response = client.post(
        f"/docs/{doc_id}/merge-decision-logs", json={"record": first_record}
    )
    assert first_response.status_code == 201
    duplicate_response = client.post(
        f"/docs/{doc_id}/merge-decision-logs", json={"record": second_record}
    )
    assert duplicate_response.status_code == 409


def _assert_similar_candidate_groups_contract_default(client: TestClient) -> None:
    doc_id = "doc-similar-candidate-groups"
    payload = _sample_payload_v1_with_merge_suggestion_decisions(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200

    response = client.get(f"/docs/{doc_id}/similar-candidate-groups")
    assert response.status_code == 200
    response_json = response.json()
    assert response_json["totalGroupCount"] == 1
    assert len(response_json["groups"]) == 1

    group = response_json["groups"][0]
    assert group["targetCardId"] == "card-1"
    assert group["candidateCardIds"] == ["card-2"]
    assert group["reasonCodes"] == ["normalized_text", "token_signature"]
    assert group["scoreSummary"] == {"min": 1.0, "max": 1.0, "avg": 1.0}
    assert group["groupId"].startswith("heuristic-normalized_text-")
    assert len(group["snapshotVersion"]) == 12


def _assert_similar_candidate_groups_excludes_non_eligible_cards(client: TestClient) -> None:
    doc_id = "doc-similar-candidate-groups-filter"
    payload = _sample_payload_v1_with_merge_suggestion_decisions(doc_id)
    payload["cards"] = [
        {"id": "card-1", "text": "gamma delta", "x": 0, "y": 0},
        {"id": "card-2", "text": "delta gamma", "x": 10, "y": 10},
        {
            "id": "card-merged",
            "text": "gamma delta",
            "x": 20,
            "y": 20,
            "mergedIntoCardId": "card-1",
        },
        {"id": "card-source", "text": "gamma delta", "x": 30, "y": 30, "sources": ["raw-1"]},
    ]

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200

    response = client.get(f"/docs/{doc_id}/similar-candidate-groups")
    assert response.status_code == 200
    response_json = response.json()

    assert response_json["totalGroupCount"] == 1
    group = response_json["groups"][0]
    assert group["targetCardId"] == "card-1"
    assert group["candidateCardIds"] == ["card-2"]
    assert group["reasonCodes"] == ["token_signature"]
    assert group["scoreSummary"] == {"min": 0.75, "max": 0.75, "avg": 0.75}


def _assert_similar_candidate_groups_missing_doc(client: TestClient) -> None:
    response = client.get("/docs/not-found/similar-candidate-groups")
    assert response.status_code == 404


def _assert_similar_candidate_groups_deterministic_order_contract(client: TestClient) -> None:
    doc_id = "doc-similar-candidate-groups-order"
    payload = _sample_payload_v1_with_merge_suggestion_decisions(doc_id)
    payload["cards"] = [
        {"id": "card-c", "text": "left right", "x": 0, "y": 0},
        {"id": "card-a", "text": "alpha beta", "x": 10, "y": 10},
        {"id": "card-d", "text": "right left", "x": 20, "y": 20},
        {"id": "card-b", "text": "beta alpha", "x": 30, "y": 30},
    ]

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200

    response = client.get(f"/docs/{doc_id}/similar-candidate-groups")
    assert response.status_code == 200
    response_json = response.json()

    assert response_json["totalGroupCount"] == 2
    assert [group["targetCardId"] for group in response_json["groups"]] == ["card-a", "card-c"]
    assert [group["candidateCardIds"] for group in response_json["groups"]] == [
        ["card-b"],
        ["card-d"],
    ]

    for group in response_json["groups"]:
        assert set(group.keys()) == {
            "groupId",
            "targetCardId",
            "candidateCardIds",
            "scoreSummary",
            "reasonCodes",
            "snapshotVersion",
        }
        assert group["reasonCodes"] == ["token_signature"]
        assert group["scoreSummary"] == {"min": 0.75, "max": 0.75, "avg": 0.75}
        assert len(group["snapshotVersion"]) == 12


def _assert_v1_relation_summary_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-relations"
    payload = _sample_payload_v1_with_relation_summaries(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_json = put_response.json()
    put_relation_summary = put_json["relationSummaries"][0]
    assert put_relation_summary["id"] == "rs-1"
    assert put_relation_summary["history"][0]["changeKind"] == "ai"
    assert put_relation_summary["history"][1]["changeKind"] == "manual"

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_json = get_response.json()
    get_relation_summary = get_json["relationSummaries"][0]
    assert get_relation_summary["text"] == "alpha supports beta"
    assert get_relation_summary["reviewed"] is True
    assert len(get_relation_summary["history"]) == 2
    assert get_relation_summary["history"][1]["toText"] == "alpha supports beta"


def _assert_v1_relation_summary_without_history_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-relations-no-history"
    payload = _sample_payload_v1_without_relation_summary_history(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_json = put_response.json()
    put_relation_summary = put_json["relationSummaries"][0]
    assert "history" not in put_relation_summary

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_json = get_response.json()
    get_relation_summary = get_json["relationSummaries"][0]
    assert get_relation_summary["id"] == "rs-1"
    assert "history" not in get_relation_summary


def _assert_v1_evidence_links_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-evidence"
    payload = _sample_payload_v1_with_evidence_links(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_json = put_response.json()
    assert put_json["cards"][0]["claimType"] == "fact"
    assert put_json["cards"][1]["claimType"] == "claim"
    assert put_json["edges"][0]["fromKind"] == "card"
    assert put_json["edges"][0]["toKind"] == "card"
    assert put_json["evidenceLinks"] == payload["evidenceLinks"]
    assert put_json["patchApplyLog"][0]["stats"]["upsertEvidenceLinks"] == 1

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_json = get_response.json()
    assert get_json["cards"][0]["claimType"] == "fact"
    assert get_json["edges"][0]["toKind"] == "card"
    assert get_json["evidenceLinks"][0]["id"] == "evidence-1"
    assert get_json["patchApplyLog"][0]["stats"]["deleteEvidenceLinks"] == 0


def _assert_v1_polygon_geometry_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-polygon"
    payload = {
        "version": 1,
        "id": doc_id,
        "title": "polygon-roundtrip",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [{"id": "card-1", "text": "alpha", "x": 12.5, "y": -9.0}],
        "edges": [],
        "islands": [
            {
                "id": "poly-island",
                "cardIds": ["card-1"],
                "geometry": {
                    "type": "polygon",
                    "points": [
                        {"x": 0, "y": 0},
                        {"x": 100, "y": 0},
                        {"x": 80, "y": 70},
                    ],
                },
            }
        ],
    }

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_island = put_response.json()["islands"][0]
    assert put_island["geometry"] == payload["islands"][0]["geometry"]

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_island = get_response.json()["islands"][0]
    assert get_island["geometry"] == payload["islands"][0]["geometry"]


def _sample_payload_v1_with_card_meta(doc_id: str) -> dict:
    # DOMAIN-TRACE-01 (schemas.md §15): seq/source round-trip, and an UNKNOWN
    # meta key (subject metadata) that the server must DROP fail-closed
    # (§15.3) instead of persisting before CARD-META-UI-01 settles.
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-card-meta",
        "createdAt": "2026-07-08T00:00:00Z",
        "updatedAt": "2026-07-08T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {
                "id": "card-traced",
                "text": "utterance about onboarding",
                "x": 0,
                "y": 0,
                "meta": {
                    "seq": 42,
                    "source": "interview-A line 12",
                    "createdBy": "alice@example.com",
                },
            },
            {"id": "card-plain", "text": "no meta", "x": 300, "y": 0},
        ],
        "edges": [],
        "islands": [],
    }


def _assert_v1_card_meta_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-card-meta"
    payload = _sample_payload_v1_with_card_meta(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_cards = {card["id"]: card for card in put_response.json()["cards"]}
    assert put_cards["card-traced"]["meta"]["seq"] == 42
    assert put_cards["card-traced"]["meta"]["source"] == "interview-A line 12"
    assert "createdBy" not in put_cards["card-traced"]["meta"]
    assert "meta" not in put_cards["card-plain"]

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_cards = {card["id"]: card for card in get_response.json()["cards"]}
    assert get_cards["card-traced"]["meta"]["seq"] == 42
    assert get_cards["card-traced"]["meta"]["source"] == "interview-A line 12"
    assert "createdBy" not in get_cards["card-traced"]["meta"]
    assert "meta" not in get_cards["card-plain"]


def _sample_payload_v1_with_card_ka(doc_id: str) -> dict:
    # DOMAIN-KA-01 (schemas.md §17): voice/value round-trip, and an UNKNOWN
    # ka key that the server must DROP fail-closed instead of persisting.
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-card-ka",
        "createdAt": "2026-07-09T00:00:00Z",
        "updatedAt": "2026-07-09T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {
                "id": "card-ka",
                "text": "event: waited 40 minutes at the counter",
                "x": 0,
                "y": 0,
                "ka": {
                    "voice": "honestly it felt exhausting",
                    "value": "the relief of not waiting",
                    "authorRating": 5,
                },
            },
            {"id": "card-plain", "text": "no ka", "x": 300, "y": 0},
        ],
        "edges": [],
        "islands": [],
    }


def _assert_v1_card_ka_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-card-ka"
    payload = _sample_payload_v1_with_card_ka(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_cards = {card["id"]: card for card in put_response.json()["cards"]}
    assert put_cards["card-ka"]["ka"]["voice"] == "honestly it felt exhausting"
    assert put_cards["card-ka"]["ka"]["value"] == "the relief of not waiting"
    assert "authorRating" not in put_cards["card-ka"]["ka"]
    assert put_cards["card-ka"]["text"] == "event: waited 40 minutes at the counter"
    assert "ka" not in put_cards["card-plain"]

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_cards = {card["id"]: card for card in get_response.json()["cards"]}
    assert get_cards["card-ka"]["ka"]["voice"] == "honestly it felt exhausting"
    assert get_cards["card-ka"]["ka"]["value"] == "the relief of not waiting"
    assert "authorRating" not in get_cards["card-ka"]["ka"]
    assert "ka" not in get_cards["card-plain"]


def _sample_payload_v1_with_contradiction_signal_decisions(doc_id: str) -> dict:
    # DOMAIN-EXPR-04 (schemas.md §16): human review decisions on
    # analyzeContradictions() signals round-trip verbatim; a malformed entry
    # (invalid status, "proposed" is not a persistable value) is dropped
    # fail-closed while the valid entry is kept (§16.6).
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-contradiction-signal-decisions",
        "createdAt": "2026-07-08T00:00:00Z",
        "updatedAt": "2026-07-08T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [],
        "edges": [],
        "islands": [],
        "contradictionSignalDecisions": [
            {
                "signatureKey": "C001:island:a|island:b",
                "status": "accepted",
                "decidedAt": "2026-07-08T00:00:00Z",
            },
        ],
    }


def _assert_v1_contradiction_signal_decisions_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-contradiction-signal-decisions"
    payload = _sample_payload_v1_with_contradiction_signal_decisions(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_decisions = put_response.json()["contradictionSignalDecisions"]
    assert put_decisions == [
        {
            "signatureKey": "C001:island:a|island:b",
            "status": "accepted",
            "decidedAt": "2026-07-08T00:00:00Z",
        },
    ]

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_decisions = get_response.json()["contradictionSignalDecisions"]
    assert get_decisions == [
        {
            "signatureKey": "C001:island:a|island:b",
            "status": "accepted",
            "decidedAt": "2026-07-08T00:00:00Z",
        },
    ]


def _assert_v1_contradiction_signal_decision_invalid_status_rejected(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-contradiction-signal-decision-invalid"
    payload = _sample_payload_v1_with_contradiction_signal_decisions(doc_id)
    payload["contradictionSignalDecisions"][0]["status"] = "proposed"

    response = client.put(f"/docs/{doc_id}", json=payload)
    assert response.status_code == 422


def _sample_payload_v1_with_edge_vocabulary(doc_id: str) -> dict:
    # DOMAIN-KJ-01 (schemas.md §3.3): the five known relation types plus an
    # UNKNOWN type string that the server must accept and round-trip verbatim
    # instead of rejecting the whole document with 422.
    edge_types = ["related", "negate", "causal", "mutual", "equivalence", "future-vocab-2030"]
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-edge-vocabulary",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {"id": "card-1", "text": "alpha", "x": 0, "y": 0},
            {"id": "card-2", "text": "beta", "x": 300, "y": 0},
        ],
        "edges": [
            {"id": f"edge-{index}", "fromId": "card-1", "toId": "card-2", "type": edge_type}
            for index, edge_type in enumerate(edge_types)
        ],
        "islands": [],
    }


def _assert_v1_edge_vocabulary_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-edge-vocabulary"
    payload = _sample_payload_v1_with_edge_vocabulary(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    put_types = [edge["type"] for edge in put_response.json()["edges"]]
    assert put_types == [
        "related",
        "negate",
        "causal",
        "mutual",
        "equivalence",
        "future-vocab-2030",
    ]

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_types = [edge["type"] for edge in get_response.json()["edges"]]
    assert get_types == [
        "related",
        "negate",
        "causal",
        "mutual",
        "equivalence",
        "future-vocab-2030",
    ]


def _assert_v1_edge_empty_type_rejected(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-edge-empty-type"
    payload = _sample_payload_v1_with_edge_vocabulary(doc_id)
    payload["edges"] = [{"id": "edge-1", "fromId": "card-1", "toId": "card-2", "type": ""}]

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 422


def _assert_put_get_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip"
    payload = _sample_payload(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    assert put_response.json() == payload

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    assert get_response.json() == payload


def _assert_etag_optimistic_locking(client: TestClient) -> None:
    doc_id = "doc-etag"
    payload = _sample_payload(doc_id)

    put_response = client.put(f"/docs/{doc_id}", json=payload)
    assert put_response.status_code == 200
    first_etag = put_response.headers.get("etag")
    assert first_etag

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    assert get_response.headers.get("etag") == first_etag

    stale_payload = {**payload, "updatedAt": "2026-02-11T00:01:00Z", "title": "stale update"}
    stale_put = client.put(
        f"/docs/{doc_id}",
        json=stale_payload,
        headers={"If-Match": '"definitely-stale-etag"'},
    )
    assert stale_put.status_code == 409

    fresh_payload = {**payload, "updatedAt": "2026-02-11T00:02:00Z", "title": "fresh update"}
    fresh_put = client.put(f"/docs/{doc_id}", json=fresh_payload, headers={"If-Match": first_etag})
    assert fresh_put.status_code == 200
    second_etag = fresh_put.headers.get("etag")
    assert second_etag
    assert second_etag != first_etag


def test_sui_native_action_v1_is_inert_without_explicit_host_opt_in(
    sqlite_client: TestClient,
) -> None:
    """New write route must not activate merely because the plugin was imported."""
    response = sqlite_client.post(
        "/docs/unconfigured-action/action-commit",
        headers={"X-TEI-Action": "commit"},
        json={"protocolVersion": "1"},
    )
    assert response.status_code == 404, response.text
    assert response.json() == {"protocolVersion": "1", "error": "action_denied"}


def test_sui_native_action_v1_uses_authorized_store_and_cas(
    sqlite_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Opted-in FastAPI SUI receiver + SQLite; Go TEI Host remains unconnected."""
    # The default deployment is inert; this test enables only its own fixture.
    monkeypatch.setattr(app.state, "sui_native_action_v1_enabled", True, raising=False)
    doc_id = "native-action-envelope-probe"
    initial = _sample_payload_v1_with_collapsed(doc_id)
    initial["edges"][0]["type"] = "future-edge-kind"
    initial["cards"][0]["meta"] = {"source": "interview-1"}
    initial["cards"][0]["holdState"] = "held"
    initial["islands"][0].pop("placardCardId", None)
    initial["islands"][1].pop("placardCardId", None)
    seeded = sqlite_client.put(f"/docs/{doc_id}", json=initial)
    assert seeded.status_code == 200, seeded.text
    etag = seeded.headers["ETag"].strip('"')

    intent = {
        "protocolVersion": "1",
        "applicationID": "sui",
        "resourceID": doc_id,
        "actionID": "sui.move",
        "expectedRevision": etag,
        "payload": {"cardId": "card-1", "x": 212.5, "y": 91},
    }
    endpoint = f"/docs/{doc_id}/action-commit"
    headers = {"X-TEI-Action": "commit"}

    # Strict outer envelope; unknown fields and wrong application rejected.
    for rejected in (
        {**intent, "applicationID": "inventory"},
        {**intent, "resourceID": "other"},
        {**intent, "expectedRevision": etag + "\n"},
        {**intent, "expectedRevision": etag[:63] + "\n"},
        {**intent, "authority": "caller-asserted"},
        {**intent, "payload": {**intent["payload"], "admin": True}},
        {**intent, "payload": {"cardId": "card-1", "x": "212.5", "y": 91}},
    ):
        resp = sqlite_client.post(endpoint, json=rejected, headers=headers)
        assert resp.status_code in (400, 403), resp.text
        assert resp.json()["protocolVersion"] == "1"
        assert resp.json()["error"] in ("invalid_action", "action_denied")
    missing_action_header = sqlite_client.post(endpoint, json=intent)
    assert missing_action_header.status_code == 403
    assert missing_action_header.json() == {
        "protocolVersion": "1", "error": "request_origin_denied",
    }

    # Browser-supplied Origin must match the trusted Host/scheme. This check
    # is independent of whether a session cookie was supplied for BFF CSRF.
    for origin in ("https://attacker.example", "null", "http://testserver",
                   "http://testserver/other", "http://testserver@evil.test"):
        denied_origin = sqlite_client.post(
            endpoint, json=intent, headers={**headers, "Origin": origin},
        )
        assert denied_origin.status_code == 403, denied_origin.text
        assert denied_origin.json() == {
            "protocolVersion": "1", "error": "request_origin_denied",
        }

    # No implied CORS trust: a matching explicit Origin is acceptable.
    allowed_origin = sqlite_client.post(
        endpoint,
        json={**intent, "applicationID": "inventory"},
        headers={**headers, "Origin": "http://testserver"},
    )
    assert allowed_origin.status_code == 400
    assert allowed_origin.json() == {"protocolVersion": "1", "error": "invalid_action"}

    # Python's default decoder is last-key-wins. This boundary instead
    # rejects duplicate keys at every nesting level before Pydantic runs.
    serialized = __import__("json").dumps(intent, separators=(",", ":"))
    duplicate_outer = serialized.replace(
        '"applicationID":"sui",', '"applicationID":"sui","applicationID":"sui",',
    )
    duplicate_nested = serialized.replace(
        '"x":212.5,', '"x":212.5,"x":212.5,',
    )
    for body in (duplicate_outer, duplicate_nested):
        malformed = sqlite_client.post(
            endpoint, content=body,
            headers={**headers, "Content-Type": "application/json"},
        )
        assert malformed.status_code == 400, malformed.text
        assert malformed.json() == {"protocolVersion": "1", "error": "invalid_action"}

    oversized = sqlite_client.post(
        endpoint,
        content=serialized + (" " * 65536),
        headers={**headers, "Content-Type": "application/json"},
    )
    assert oversized.status_code == 413, oversized.text
    assert oversized.json() == {"protocolVersion": "1", "error": "invalid_action"}

    bad_media = sqlite_client.post(
        endpoint, content=serialized,
        headers={**headers, "Content-Type": "text/plain"},
    )
    assert bad_media.status_code == 415
    assert bad_media.json() == {
        "protocolVersion": "1", "error": "unsupported_content_type",
    }

    read_only = sqlite_client.post(
        endpoint, json=intent, headers={**headers, "X-Read-Only": "1"},
    )
    assert read_only.status_code == 403, read_only.text
    assert read_only.json() == {"protocolVersion": "1", "error": "action_denied"}

    # Capture application-owned audit events; rejected requests must never
    # emit a committed-apply event.
    audit_events = []
    class ActionAuditProbe:
        def emit(self, event):
            # Ordinary GET /docs/{id} emits separate "view" audits. Count
            # only committed native Action events, never confuse a view with
            # a second successful write.
            if event.eventType == "apply":
                audit_events.append(event)
    monkeypatch.setattr(app.state, "audit_dispatcher", ActionAuditProbe(), raising=False)

    accepted = sqlite_client.post(endpoint, json=intent, headers=headers)
    assert accepted.status_code == 200, accepted.text
    assert len(audit_events) == 1
    assert audit_events[0].eventType == "apply"
    assert audit_events[0].docId == doc_id
    assert audit_events[0].metadata["actionId"] == "sui.move"
    assert audit_events[0].metadata["result"] == "committed"
    assert "interview-1" not in str(audit_events[0].metadata)
    assert accepted.json()["protocolVersion"] == "1"
    revision = accepted.json()["revision"]
    assert revision and revision != etag
    assert accepted.headers["ETag"] == f'"{revision}"'
    assert accepted.headers["Cache-Control"] == "no-store"

    stored = sqlite_client.get(f"/docs/{doc_id}")
    assert stored.status_code == 200, stored.text
    assert stored.headers["ETag"] == f'"{revision}"'
    doc = stored.json()
    assert [island["cardIds"] for island in doc["islands"]] == [
        [], ["card-2", "card-1"],
    ]
    assert doc["cards"][0]["x"] == 212.5
    assert doc["cards"][0]["y"] == 91
    assert doc["cards"][0]["meta"]["source"] == "interview-1"
    assert doc["cards"][0]["holdState"] == "held"
    assert doc["edges"][0]["type"] == "future-edge-kind"

    # Conditional Web PUT shares the same ETag/CAS boundary as Action.
    # Even if it was constructed from an old Document snapshot it must not
    # roll back a newer Action, and no new revision should be materialized.
    stale_put = sqlite_client.put(
        f"/docs/{doc_id}",
        json={**initial, "updatedAt": "2026-10-11T00:05:00Z"},
        headers={"If-Match": f'"{etag}"'},
    )
    assert stale_put.status_code == 409, stale_put.text
    assert sqlite_client.get(f"/docs/{doc_id}").headers["ETag"] == f'"{revision}"'

    # A previously acknowledged Action is NOT repeated with its stale ETag.
    conflict = sqlite_client.post(endpoint, json=intent, headers=headers)
    assert conflict.status_code == 409, conflict.text
    assert conflict.json() == {"protocolVersion": "1", "error": "revision_conflict"}
    assert sqlite_client.get(f"/docs/{doc_id}").headers["ETag"] == f'"{revision}"'

    invalid = sqlite_client.post(
        endpoint,
        json={**intent, "expectedRevision": revision, "payload": {
            "cardId": "missing", "x": 1, "y": 2,
        }},
        headers=headers,
    )
    assert invalid.status_code == 400
    assert invalid.json() == {"protocolVersion": "1", "error": "invalid_payload"}
    assert sqlite_client.get(f"/docs/{doc_id}").headers["ETag"] == f'"{revision}"'

    archived = sqlite_client.post(f"/docs/{doc_id}/archive")
    assert archived.status_code == 204, archived.text
    denied = sqlite_client.post(
        endpoint, json={**intent, "expectedRevision": revision}, headers=headers,
    )
    assert denied.status_code == 423
    assert denied.json() == {"protocolVersion": "1", "error": "action_denied"}
    # Replays, malformed input, missing Cards and archived writes do not
    # produce another successful-commit audit event.
    assert len(audit_events) == 1


def test_native_action_refuses_silent_loss_of_existing_extension_fields() -> None:
    """A Card move must not re-save a stripped Pydantic DocumentV1."""
    stored = _sample_payload("doc-action-unknown-meta")
    stored["cards"][0]["meta"] = {
        "source": "interview:known",
        "futureAuditHint": {"reason": "preserve this future extension"},
    }
    # CardMeta (intentionally) ignores extra fields. PUT may have canonicalized
    # an older resource, but an Action cannot silently wipe its stored extras.
    projected = DocumentV1.model_validate(stored).model_dump(
        mode="json", exclude_none=True,
    )
    assert projected["cards"][0]["meta"]["source"] == "interview:known"
    assert "futureAuditHint" not in projected["cards"][0]["meta"]
    assert not _action_preserves_stored_fields(stored, projected)

    # Known source/hold fields, null optionals and Pydantic defaults remain
    # safe to move. Null-vs-omitted is not loss of a concrete field.
    clean = _sample_payload("doc-action-known-meta")
    clean["cards"][0]["meta"] = {"source": "interview:known", "seq": None}
    clean["cards"][0]["holdState"] = "held"
    normal = DocumentV1.model_validate(clean).model_dump(
        mode="json", exclude_none=True,
    )
    assert _action_preserves_stored_fields(clean, normal)

    # Nested unknown fields and shortened arrays cannot bypass the guard.
    assert not _action_preserves_stored_fields(
        {"cards": [{"id": "one", "meta": {"source": "original"}}]},
        {"cards": [{"id": "one", "meta": {}}]},
    )
    assert not _action_preserves_stored_fields(
        {"islands": [{"id": "a"}, {"id": "b"}]},
        {"islands": [{"id": "a"}]},
    )


def test_sui_action_does_not_erase_old_unknown_fields_on_sqlite_resave(
    sqlite_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An old stored extension is retained even if Pydantic would ignore it."""
    monkeypatch.setattr(app.state, "sui_native_action_v1_enabled", True, raising=False)
    doc_id = "action-legacy-extra-fields"
    created = sqlite_client.put(f"/docs/{doc_id}", json=_sample_payload(doc_id))
    assert created.status_code == 200, created.text

    # Emulate an older stored Document or another forward-compatible
    # importer using the existing content store. Do not go through PUT:
    # ordinary PUT deliberately normalizes to the current Pydantic schema.
    legacy = created.json()
    legacy["cards"][0]["meta"] = {
        "source": "original-interview",
        "futureTrace": {"owner": "retain-me"},
    }
    legacy_payload = json.dumps(legacy, ensure_ascii=False, separators=(",", ":"))
    open_db = app.dependency_overrides[get_db]()
    db = next(open_db)
    try:
        store = DatabaseDocumentContentStore(db)
        store.save(
            tenant=LOCAL_DEFAULT_TENANT_CONTEXT,
            doc_id=doc_id,
            version=1,
            updated_at=legacy["updatedAt"],
            content=ContentBlob.from_text(legacy_payload),
        )
        db.commit()
    finally:
        open_db.close()

    current = sqlite_client.get(f"/docs/{doc_id}")
    assert current.status_code == 200
    revision = current.headers["ETag"].strip('"')

    rejected = sqlite_client.post(
        f"/docs/{doc_id}/action-commit",
        headers={"X-TEI-Action": "commit"},
        json={
            "protocolVersion": "1",
            "applicationID": "sui",
            "resourceID": doc_id,
            "actionID": "sui.move",
            "expectedRevision": revision,
            "payload": {"cardId": "card-1", "x": 90.0, "y": 65.0},
        },
    )
    assert rejected.status_code == 500, rejected.text
    assert rejected.json() == {
        "protocolVersion": "1", "error": "execution_failed",
    }

    verify_db = app.dependency_overrides[get_db]()
    db = next(verify_db)
    try:
        stored = DatabaseDocumentContentStore(db).load(
            tenant=LOCAL_DEFAULT_TENANT_CONTEXT, doc_id=doc_id,
        )
        assert stored is not None
        assert json.loads(stored.content.text) == legacy
    finally:
        verify_db.close()
    assert sqlite_client.get(f"/docs/{doc_id}").headers["ETag"] == f'"{revision}"'


def test_sui_action_preserves_review_by_another_authorized_writer(
    sqlite_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Moving a Card is not an assertion of the existing reviewer's identity."""
    monkeypatch.setattr(app.state, "sui_native_action_v1_enabled", True, raising=False)
    doc_id = "action-preserves-another-reviewer"
    original = _sample_payload_v1_with_hil_rs_contract_fields(
        doc_id, reviewer_ref="reviewer:original",
    )
    created = sqlite_client.put(
        f"/docs/{doc_id}",
        json=original,
        headers={"x-actor-ref": "reviewer:original"},
    )
    assert created.status_code == 200, created.text
    initial_revision = created.headers["ETag"].strip('"')

    # This actor is not the original reviewer, but is an authorized writer.
    moved = sqlite_client.post(
        f"/docs/{doc_id}/action-commit",
        headers={
            "X-TEI-Action": "commit",
            "x-actor-ref": "reviewer:other",
        },
        json={
            "protocolVersion": "1",
            "applicationID": "sui",
            "resourceID": doc_id,
            "actionID": "sui.move",
            "expectedRevision": initial_revision,
            "payload": {"cardId": "card-1", "x": 60.0, "y": 80.0},
        },
    )
    assert moved.status_code == 200, moved.text
    loaded = sqlite_client.get(f"/docs/{doc_id}")
    assert loaded.status_code == 200, loaded.text
    doc = loaded.json()
    assert doc["cards"][0]["x"] == 60.0
    assert doc["reviewAttribution"] == created.json()["reviewAttribution"]
    assert doc["critiqueInputs"] == created.json()["critiqueInputs"]
    assert doc["reproposalDiffs"] == created.json()["reproposalDiffs"]
    assert loaded.headers["ETag"] == f'"{moved.json()["revision"]}"'


def test_native_action_domain_rejection_releases_claim_and_keeps_revision(
    sqlite_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed domain move must not leak the conditional DB row lock."""
    monkeypatch.setattr(app.state, "sui_native_action_v1_enabled", True, raising=False)
    doc_id = "action-claim-domain-rejection"
    seeded = sqlite_client.put(f"/docs/{doc_id}", json=_sample_payload(doc_id))
    assert seeded.status_code == 200, seeded.text
    old_revision = seeded.headers["ETag"].strip('"')
    envelope = {
        "protocolVersion": "1",
        "applicationID": "sui",
        "resourceID": doc_id,
        "actionID": "sui.move",
        "expectedRevision": old_revision,
        "payload": {"cardId": "card-does-not-exist", "x": 80.0, "y": 50.0},
    }
    route = f"/docs/{doc_id}/action-commit"
    refused = sqlite_client.post(
        route, headers={"X-TEI-Action": "commit"}, json=envelope,
    )
    assert refused.status_code == 400, refused.text
    assert refused.json() == {"protocolVersion": "1", "error": "invalid_payload"}
    assert sqlite_client.get(f"/docs/{doc_id}").headers["ETag"] == f'"{old_revision}"'

    # A new valid Action with the SAME expected revision can still claim
    # and commit. There was no partial write on the failed attempt.
    accepted = sqlite_client.post(
        route, headers={"X-TEI-Action": "commit"},
        json={**envelope, "payload": {"cardId": "card-1", "x": 80.0, "y": 50.0}},
    )
    assert accepted.status_code == 200, accepted.text
    updated = sqlite_client.get(f"/docs/{doc_id}")
    assert updated.headers["ETag"] == f'"{accepted.json()["revision"]}"'
    assert updated.json()["cards"][0]["x"] == 80.0


def test_sui_action_audit_sink_failure_does_not_misreport_committed_write(
    sqlite_client: TestClient, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app.state, "sui_native_action_v1_enabled", True, raising=False)
    doc_id = "action-audit-sink-failure"
    initial = _sample_payload(doc_id)
    seeded = sqlite_client.put(f"/docs/{doc_id}", json=initial)
    assert seeded.status_code == 200, seeded.text
    previous_revision = seeded.headers["ETag"].strip('"')

    class BrokenAuditSink:
        def emit(self, event):
            # Only Action apply emission is broken; the subsequent ordinary
            # GET still emits its separate view event through the fixture.
            if event.eventType == "apply":
                raise RuntimeError("audit sink unavailable")

    monkeypatch.setattr(app.state, "audit_dispatcher", BrokenAuditSink(), raising=False)
    sent = sqlite_client.post(
        f"/docs/{doc_id}/action-commit",
        headers={"X-TEI-Action": "commit"},
        json={
            "protocolVersion": "1",
            "applicationID": "sui",
            "resourceID": doc_id,
            "actionID": "sui.move",
            "expectedRevision": previous_revision,
            "payload": {"cardId": "card-1", "x": 25.0, "y": 30.0},
        },
    )
    assert sent.status_code == 200, sent.text
    revision = sent.json()["revision"]
    assert revision != previous_revision
    stored = sqlite_client.get(f"/docs/{doc_id}")
    assert stored.status_code == 200
    assert stored.headers["ETag"] == f'"{revision}"'
    assert stored.json()["cards"][0]["x"] == 25.0


def test_sui_card_move_command_with_existing_sqlite_document_cas(sqlite_client: TestClient) -> None:
    """SUI-owned command -> native PUT/GET CAS; NOT a TEI Go Host route."""
    from sui_sensemaking_api.card_move_command import apply_card_move
    from sui_sensemaking_api.models import DocumentV1

    doc_id = "native-action-cas-probe"
    initial = _sample_payload_v1_with_collapsed(doc_id)
    initial["edges"][0]["type"] = "future-kind"
    initial["cards"][0]["holdState"] = "held"
    initial["cards"][0]["meta"] = {"source": "interview-1"}
    initial["islands"][0].pop("placardCardId", None)
    initial["islands"][1].pop("placardCardId", None)

    first = sqlite_client.put(f"/docs/{doc_id}", json=initial)
    assert first.status_code == 200, first.text
    initial_etag = first.headers["ETag"]

    before = sqlite_client.get(f"/docs/{doc_id}")
    assert before.status_code == 200, before.text
    assert before.headers["ETag"] == initial_etag

    moved = apply_card_move(
        DocumentV1.model_validate(before.json()),
        card_id="card-1", x=212.5, y=91,
    )
    assert [island.cardIds for island in moved.islands] == [[], ["card-2", "card-1"]]

    saved = sqlite_client.put(
        f"/docs/{doc_id}", json=moved.model_dump(mode="json"),
        headers={"If-Match": initial_etag},
    )
    assert saved.status_code == 200, saved.text
    committed_etag = saved.headers["ETag"]
    assert committed_etag != initial_etag

    reloaded = sqlite_client.get(f"/docs/{doc_id}")
    assert reloaded.status_code == 200, reloaded.text
    assert reloaded.headers["ETag"] == committed_etag
    assert reloaded.json()["cards"][0]["x"] == 212.5
    assert reloaded.json()["cards"][0]["meta"]["source"] == "interview-1"
    assert reloaded.json()["cards"][0]["holdState"] == "held"
    assert reloaded.json()["edges"][0]["type"] == "future-kind"
    assert [island["cardIds"] for island in reloaded.json()["islands"]] == [
        [], ["card-2", "card-1"],
    ]

    # Repeating with the old revision cannot persist another mutation.
    stale = sqlite_client.put(
        f"/docs/{doc_id}", json=moved.model_dump(mode="json"),
        headers={"If-Match": initial_etag},
    )
    assert stale.status_code == 409
    unchanged = sqlite_client.get(f"/docs/{doc_id}")
    assert unchanged.headers["ETag"] == committed_etag


def test_docs_put_get_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_put_get_roundtrip(sqlite_client)


@pytest.mark.parametrize("retired_version", [2, "v1", "v2"])
def test_docs_rejects_retired_document_versions(
    sqlite_client: TestClient,
    retired_version: object,
) -> None:
    payload = {**_sample_payload("doc-retired-version"), "version": retired_version}

    response = sqlite_client.put("/docs/doc-retired-version", json=payload)

    assert response.status_code == 422


def test_docs_rejects_retired_minimal_v1_shape(sqlite_client: TestClient) -> None:
    payload = _sample_payload("doc-retired-minimal-v1")
    payload.pop("islands")

    response = sqlite_client.put("/docs/doc-retired-minimal-v1", json=payload)

    assert response.status_code == 422


def test_docs_etag_sqlite(sqlite_client: TestClient) -> None:
    _assert_etag_optimistic_locking(sqlite_client)


@pytest.mark.postgres
def test_docs_put_get_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_put_get_roundtrip(postgres_client)


@pytest.mark.postgres
def test_docs_etag_postgres(postgres_client: TestClient) -> None:
    _assert_etag_optimistic_locking(postgres_client)


def test_docs_v1_collapsed_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_collapsed_roundtrip(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_collapsed_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_collapsed_roundtrip(postgres_client)


def test_docs_v1_canonical_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_canonical_roundtrip(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_canonical_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_canonical_roundtrip(postgres_client)


def test_docs_v1_shelf_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_shelf_roundtrip(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_shelf_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_shelf_roundtrip(postgres_client)


def test_docs_v1_merge_suggestion_decisions_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_merge_suggestion_decisions_roundtrip(sqlite_client)


def test_docs_v1_representative_cue_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_representative_cue_roundtrip(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_representative_cue_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_representative_cue_roundtrip(postgres_client)


def test_docs_merge_decision_logs_contract_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_merge_decision_logs_contract_roundtrip(sqlite_client)


def test_docs_merge_decision_logs_contract_validation_sqlite(sqlite_client: TestClient) -> None:
    _assert_merge_decision_logs_contract_validation(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_merge_suggestion_decisions_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_merge_suggestion_decisions_roundtrip(postgres_client)


def test_docs_merge_decision_logs_contract_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_merge_decision_logs_contract_roundtrip(postgres_client)


def test_docs_merge_decision_logs_contract_validation_postgres(postgres_client: TestClient) -> None:
    _assert_merge_decision_logs_contract_validation(postgres_client)


def test_docs_similar_candidate_groups_contract_default_sqlite(sqlite_client: TestClient) -> None:
    _assert_similar_candidate_groups_contract_default(sqlite_client)


def test_docs_similar_candidate_groups_missing_doc_sqlite(sqlite_client: TestClient) -> None:
    _assert_similar_candidate_groups_missing_doc(sqlite_client)


def test_docs_similar_candidate_groups_excludes_non_eligible_cards_sqlite(
    sqlite_client: TestClient,
) -> None:
    _assert_similar_candidate_groups_excludes_non_eligible_cards(sqlite_client)


def test_docs_similar_candidate_groups_deterministic_order_contract_sqlite(
    sqlite_client: TestClient,
) -> None:
    _assert_similar_candidate_groups_deterministic_order_contract(sqlite_client)


@pytest.mark.postgres
def test_docs_similar_candidate_groups_contract_default_postgres(
    postgres_client: TestClient,
) -> None:
    _assert_similar_candidate_groups_contract_default(postgres_client)


@pytest.mark.postgres
def test_docs_similar_candidate_groups_missing_doc_postgres(postgres_client: TestClient) -> None:
    _assert_similar_candidate_groups_missing_doc(postgres_client)


@pytest.mark.postgres
def test_docs_similar_candidate_groups_excludes_non_eligible_cards_postgres(
    postgres_client: TestClient,
) -> None:
    _assert_similar_candidate_groups_excludes_non_eligible_cards(postgres_client)


@pytest.mark.postgres
def test_docs_similar_candidate_groups_deterministic_order_contract_postgres(
    postgres_client: TestClient,
) -> None:
    _assert_similar_candidate_groups_deterministic_order_contract(postgres_client)


def test_docs_v1_relation_summary_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_relation_summary_roundtrip(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_relation_summary_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_relation_summary_roundtrip(postgres_client)


def test_docs_v1_relation_summary_without_history_roundtrip_sqlite(
    sqlite_client: TestClient,
) -> None:
    _assert_v1_relation_summary_without_history_roundtrip(sqlite_client)


def test_docs_v1_evidence_links_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_evidence_links_roundtrip(sqlite_client)


def test_docs_v1_polygon_geometry_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_polygon_geometry_roundtrip(sqlite_client)


def test_docs_v1_edge_vocabulary_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_edge_vocabulary_roundtrip(sqlite_client)


def test_docs_v1_card_meta_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_card_meta_roundtrip(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_card_meta_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_card_meta_roundtrip(postgres_client)


def test_docs_v1_card_ka_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_card_ka_roundtrip(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_card_ka_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_card_ka_roundtrip(postgres_client)


def test_docs_v1_contradiction_signal_decisions_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_contradiction_signal_decisions_roundtrip(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_contradiction_signal_decisions_roundtrip_postgres(
    postgres_client: TestClient,
) -> None:
    _assert_v1_contradiction_signal_decisions_roundtrip(postgres_client)


def test_docs_v1_contradiction_signal_decision_invalid_status_rejected_sqlite(
    sqlite_client: TestClient,
) -> None:
    _assert_v1_contradiction_signal_decision_invalid_status_rejected(sqlite_client)


def test_docs_v1_edge_empty_type_rejected_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_edge_empty_type_rejected(sqlite_client)


@pytest.mark.postgres
def test_docs_v1_edge_vocabulary_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_edge_vocabulary_roundtrip(postgres_client)


@pytest.mark.postgres
def test_docs_v1_relation_summary_without_history_roundtrip_postgres(
    postgres_client: TestClient,
) -> None:
    _assert_v1_relation_summary_without_history_roundtrip(postgres_client)


@pytest.mark.postgres
def test_docs_v1_evidence_links_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_evidence_links_roundtrip(postgres_client)


@pytest.mark.postgres
def test_docs_v1_polygon_geometry_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_polygon_geometry_roundtrip(postgres_client)


def _sample_payload_v1_with_hil_rs_contract_fields(
    doc_id: str, *, reviewer_ref: str = "user:u-1"
) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "roundtrip-v1-hil-rs",
        "createdAt": "2026-02-11T00:00:00Z",
        "updatedAt": "2026-02-11T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [{"id": "card-1", "text": "alpha", "x": 0, "y": 0}],
        "edges": [],
        "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
        "critiqueInputs": [
            {
                "schemaVersion": "1.0.0",
                "critiqueId": "crit-1",
                "targetRef": "card:card-1",
                "critiqueType": "too_close",
                "createdAt": "2026-02-11T00:01:00Z",
                "iteration": 1,
            }
        ],
        "reproposalDiffs": [
            {
                "schemaVersion": "1.0.0",
                "proposalId": "proposal-1",
                "basedOnIteration": 1,
                "traceKey": "crit-1:proposal-1",
                "diffOps": [
                    {
                        "opId": "op-1",
                        "opType": "move",
                        "targetRef": "card:card-1",
                        "before": {"x": 0, "y": 0},
                        "after": {"x": 12.5, "y": 9.0},
                    }
                ],
            }
        ],
        "reviewAttribution": {
            "schemaVersion": "1.0.0",
            "reviewState": "human_reviewed",
            "reviewedAt": "2026-02-11T00:02:00Z",
            "reviewerRef": reviewer_ref,
            "auditRecordedAt": "2026-02-11T00:02:00Z",
        },
        "deterministicTieBreak": {
            "schemaVersion": "1.0.0",
            "order": [
                "padding_compliance",
                "self_intersection_avoidance",
                "minimum_area_delta",
                "minimum_vertex_count",
            ],
        },
    }


def _assert_v1_hil_rs_contract_fields_roundtrip(client: TestClient) -> None:
    doc_id = "doc-roundtrip-v1-hil-rs"
    payload = _sample_payload_v1_with_hil_rs_contract_fields(
        doc_id, reviewer_ref="reviewer:opaque-1"
    )

    put_response = client.put(
        f"/docs/{doc_id}",
        json=payload,
        headers={"x-actor-ref": "reviewer:opaque-1"},
    )
    assert put_response.status_code == 200
    put_json = put_response.json()
    assert put_json["critiqueInputs"][0]["schemaVersion"] == "1.0.0"

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_json = get_response.json()
    assert get_json["reproposalDiffs"][0]["traceKey"] == "crit-1:proposal-1"
    assert get_json["reviewAttribution"]["reviewState"] == "human_reviewed"
    assert get_json["deterministicTieBreak"]["order"] == [
        "padding_compliance",
        "self_intersection_avoidance",
        "minimum_area_delta",
        "minimum_vertex_count",
    ]


def test_docs_v1_hil_rs_contract_fields_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_hil_rs_contract_fields_roundtrip(sqlite_client)


def test_docs_v1_hil_rs_contract_fields_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_hil_rs_contract_fields_roundtrip(postgres_client)


def test_docs_v1_hil_rs_contract_fields_reject_spoofed_reviewer_sqlite(
    sqlite_client: TestClient,
) -> None:
    doc_id = "doc-roundtrip-v1-hil-rs-spoofed"
    payload = _sample_payload_v1_with_hil_rs_contract_fields(doc_id, reviewer_ref="reviewer:other")

    put_response = sqlite_client.put(
        f"/docs/{doc_id}",
        json=payload,
        headers={"x-actor-ref": "reviewer:opaque-1"},
    )
    assert put_response.status_code == 403
    assert put_response.json()["detail"] == "reviewerRef must match authenticated identity"


def _assert_v1_reproposal_rationale_roundtrip(client: TestClient, doc_id: str) -> None:
    payload = _sample_payload_v1_with_hil_rs_contract_fields(
        doc_id, reviewer_ref="reviewer:opaque-1"
    )
    diff_rationale = "crit-1の指摘を受けて、card-1だけを動かす再提案"
    op_rationale = "card-1の位置だけを変え、近すぎる配置を解消する"
    reproposal = payload["reproposalDiffs"][0]
    reproposal["rationale"] = diff_rationale
    reproposal["diffOps"][0]["rationale"] = op_rationale

    put_response = client.put(
        f"/docs/{doc_id}",
        json=payload,
        headers={"x-actor-ref": "reviewer:opaque-1"},
    )
    assert put_response.status_code == 200, put_response.text

    get_response = client.get(f"/docs/{doc_id}")
    assert get_response.status_code == 200
    get_reproposal = get_response.json()["reproposalDiffs"][0]
    assert get_reproposal["rationale"] == diff_rationale
    assert get_reproposal["diffOps"][0]["rationale"] == op_rationale


def test_docs_v1_reproposal_rationale_roundtrip_sqlite(sqlite_client: TestClient) -> None:
    _assert_v1_reproposal_rationale_roundtrip(sqlite_client, "doc-roundtrip-v1-repropos-rationale")


@pytest.mark.postgres
def test_docs_v1_reproposal_rationale_roundtrip_postgres(postgres_client: TestClient) -> None:
    _assert_v1_reproposal_rationale_roundtrip(
        postgres_client, "doc-roundtrip-v1-repropos-rationale-pg"
    )


def test_docs_creation_records_lifecycle_and_creator(
    sqlite_client: TestClient, tmp_path
) -> None:
    """ADR-0073 D1=C / D2=A: a new document row carries lifecycle_state 'active'
    and the creator (when an identity is present)."""
    doc_id = "doc-lifecycle-probe"
    resp = sqlite_client.put(f"/docs/{doc_id}", json=_sample_payload(doc_id))
    assert resp.status_code in (200, 201), resp.text

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from sui_sensemaking_api.models import DocumentRow

    engine = create_engine(f"sqlite:///{tmp_path / 'docs_roundtrip.sqlite3'}")
    session_local = sessionmaker(bind=engine)
    with session_local() as db:
        row = db.get(DocumentRow, ("local-default", doc_id))
        assert row is not None
        assert row.lifecycle_state == "active"
        # created_by is NULL when the request carries no identity (D3=A); the
        # column exists and never crashes the write path.
        assert hasattr(row, "created_by")


def test_document_lifecycle_migration_roundtrip(tmp_path) -> None:
    """ADR-0073 D1=C/D2=A/D3=A: upgrade adds created_by/lifecycle_state,
    downgrade removes them, upgrade re-adds (migration round-trip)."""
    import os
    import sqlite3
    import subprocess
    import sys

    db_path = tmp_path / "doc-lifecycle-migration.sqlite3"
    env = {**os.environ, "SUI_DATABASE_URL": f"sqlite:///{db_path}"}

    def alembic(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND_DIR,
            env=env,
            check=False,
            text=True,
            capture_output=True,
        )

    upgrade = alembic("upgrade", "head")
    assert upgrade.returncode == 0, upgrade.stderr

    with sqlite3.connect(db_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info('documents')")}
        assert "created_by" in columns
        assert "lifecycle_state" in columns

    downgrade = alembic("downgrade", "20260813_0027")
    assert downgrade.returncode == 0, downgrade.stderr
    with sqlite3.connect(db_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info('documents')")}
        assert "created_by" not in columns
        assert "lifecycle_state" not in columns

    re_upgrade = alembic("upgrade", "head")
    assert re_upgrade.returncode == 0, re_upgrade.stderr
    with sqlite3.connect(db_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info('documents')")}
        assert "created_by" in columns
        assert "lifecycle_state" in columns


def test_docs_list_returns_tenant_metadata(sqlite_client: TestClient) -> None:
    """第2反復: GET /docs lists the tenant's document metadata (id/title/
    lifecycle/updated_at), never card content, sorted updated_at descending."""
    for index, doc_id in enumerate(("list-a", "list-b")):
        payload = _sample_payload(doc_id)
        payload["title"] = f"List {index}"
        payload["updatedAt"] = f"2026-08-15T00:00:0{index}Z"
        resp = sqlite_client.put(f"/docs/{doc_id}", json=payload)
        assert resp.status_code in (200, 201), resp.text

    resp = sqlite_client.get("/docs")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_id = {entry["id"]: entry for entry in body}
    assert by_id["list-a"]["title"] == "List 0"
    assert by_id["list-b"]["title"] == "List 1"
    assert by_id["list-a"]["lifecycle_state"] == "active"
    # List is sorted updated_at descending (list-b is newest).
    ids = [entry["id"] for entry in body]
    assert ids.index("list-b") < ids.index("list-a")
    # No card content leaks into the list.
    serialized = resp.text
    assert "alpha" not in serialized


def test_docs_list_keyset_pagination(sqlite_client: TestClient) -> None:
    """SEC-DOC-BOUND-05: GET /docs?limit= bounds the response and X-Next-Cursor
    pages the rest, without overlap or loss (ordered updated_at DESC, id ASC)."""
    for index, doc_id in enumerate(("p1", "p2", "p3", "p4")):
        payload = _sample_payload(doc_id)
        payload["updatedAt"] = f"2026-08-15T00:00:{index:02d}Z"
        resp = sqlite_client.put(f"/docs/{doc_id}", json=payload)
        assert resp.status_code in (200, 201), resp.text

    # Page 1: limit 2 -> 2 rows + a next cursor.
    page1 = sqlite_client.get("/docs?limit=2")
    assert page1.status_code == 200
    body1 = page1.json()
    assert len(body1) == 2
    next_cursor = page1.headers.get("X-Next-Cursor")
    assert next_cursor, "expected X-Next-Cursor on a non-final page"

    # Page 2 via the cursor -> the remaining rows, no next cursor (final page).
    page2 = sqlite_client.get("/docs?limit=2&cursor=" + next_cursor)
    assert page2.status_code == 200
    body2 = page2.json()
    assert len(body2) == 2
    assert page2.headers.get("X-Next-Cursor") is None

    ids = [entry["id"] for entry in body1 + body2]
    # No overlap, no loss, newest first.
    assert len(set(ids)) == 4
    assert ids[0] == "p4"  # updatedAt 00:03 (newest) first
    assert ids[3] == "p1"  # updatedAt 00:00 (oldest) last

    # A `limit` above the row count returns everything without a cursor.
    page_all = sqlite_client.get("/docs?limit=500")
    assert len(page_all.json()) == 4
    assert page_all.headers.get("X-Next-Cursor") is None


def test_docs_archive_lifecycle(sqlite_client: TestClient) -> None:
    """ADR-0073 D2=A: archive/unarchive transitions lifecycle_state; the list
    reflects it; a missing doc is 404."""
    doc_id = "arch-lifecycle-probe"
    resp = sqlite_client.put(f"/docs/{doc_id}", json=_sample_payload(doc_id))
    assert resp.status_code in (200, 201), resp.text

    # Archive.
    resp = sqlite_client.post(f"/docs/{doc_id}/archive")
    assert resp.status_code == 204, resp.text

    resp = sqlite_client.get("/docs")
    entry = next((item for item in resp.json() if item["id"] == doc_id), None)
    assert entry is not None and entry["lifecycle_state"] == "archived"

    # Unarchive.
    resp = sqlite_client.post(f"/docs/{doc_id}/unarchive")
    assert resp.status_code == 204, resp.text
    resp = sqlite_client.get("/docs")
    entry = next((item for item in resp.json() if item["id"] == doc_id), None)
    assert entry is not None and entry["lifecycle_state"] == "active"

    # Missing doc.
    assert sqlite_client.post("/docs/missing-archive/archive").status_code == 404


def test_docs_archived_write_blocked(sqlite_client: TestClient) -> None:
    """ADR-0073 D2=A enforcement: an archived document is read-only. PUT on an
    archived doc -> 423 Locked (code document_archived) even with a correct
    ETag; GET stays 200 (still reviewable); unarchive restores writability."""
    doc_id = "arch-write-block-probe"
    payload = _sample_payload(doc_id)
    resp = sqlite_client.put(f"/docs/{doc_id}", json=payload)
    assert resp.status_code in (200, 201), resp.text
    etag = resp.headers.get("ETag")
    assert etag, "initial PUT must return an ETag"

    resp = sqlite_client.post(f"/docs/{doc_id}/archive")
    assert resp.status_code == 204, resp.text

    # PUT on archived is locked (fail-closed), even with a current ETag.
    mutated = _sample_payload(doc_id)
    mutated["title"] = "should not persist"
    resp = sqlite_client.put(f"/docs/{doc_id}", json=mutated, headers={"If-Match": etag})
    assert resp.status_code == 423, resp.text
    assert resp.json()["detail"]["code"] == "document_archived"

    # Content unchanged after the rejected write.
    resp = sqlite_client.get(f"/docs/{doc_id}")
    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "roundtrip"

    # Unarchive restores writability.
    resp = sqlite_client.post(f"/docs/{doc_id}/unarchive")
    assert resp.status_code == 204, resp.text
    resp = sqlite_client.get(f"/docs/{doc_id}")
    etag = resp.headers.get("ETag")
    resp = sqlite_client.put(f"/docs/{doc_id}", json=mutated, headers={"If-Match": etag})
    assert resp.status_code == 200, resp.text
    assert resp.json()["title"] == "should not persist"


def test_docs_list_filters_by_creator(sqlite_client: TestClient, tmp_path) -> None:
    """第2反復: GET /docs?createdBy= filters to one creator ("my documents");
    migrated docs with NULL created_by are never matched."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from sui_sensemaking_api.models import DocumentRow

    engine = create_engine(f"sqlite:///{tmp_path / 'docs_roundtrip.sqlite3'}")
    session_local = sessionmaker(bind=engine)
    with session_local() as db:
        db.add_all(
            [
                DocumentRow(tenant_id="local-default", id="creator-a", version=1,
                            updated_at="2026-08-15T00:00:00Z", payload_json="{}", created_by="user-a"),
                DocumentRow(tenant_id="local-default", id="creator-b", version=1,
                            updated_at="2026-08-15T00:00:01Z", payload_json="{}", created_by="user-b"),
                DocumentRow(tenant_id="local-default", id="creator-null", version=1,
                            updated_at="2026-08-15T00:00:02Z", payload_json="{}", created_by=None),
            ]
        )
        db.commit()

    mine = sqlite_client.get("/docs", params={"createdBy": "user-a"}).json()
    assert {entry["id"] for entry in mine} == {"creator-a"}
    all_docs = sqlite_client.get("/docs").json()
    assert {entry["id"] for entry in all_docs} == {"creator-a", "creator-b", "creator-null"}
