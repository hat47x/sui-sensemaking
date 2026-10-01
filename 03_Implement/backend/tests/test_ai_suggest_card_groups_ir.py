"""Integration tests for `/ai/suggest-card-groups` on the LLM input IR path.

Stage 2 of the `ADR-0069` rollout (`AI-IR-PROJECTION-01`). Three things are
being proven here:

1. AC-2 -- the endpoint receives the confirmed islands, their `parentIslandId`
   hierarchy and each card's `holdState`, and a card the human has set aside
   never turns up inside a suggested group. The enforcement is in code, not in
   the prompt: the stub model below is deliberately made to answer with the held
   card, and the response must still not contain it.
2. The pre-existing SafeMode gate (`_reject_unreviewed_cards`, shipped by
   `SEC-AI-SAFEMODE-01` / ADR-0068) is UNCHANGED. The IR's own check is an
   additional layer, not a replacement -- so both must be observable.
3. The flat card-list request shape that shipped before still works (AC-11).
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from sui_sensemaking_api.llm_input_ir import IR_VERSION
from sui_sensemaking_api.main import app
from sui_sensemaking_api.routes import ai
from sui_sensemaking_api.settings import settings

_CAPTURED: list = []
#: Mutated by the tests that need the model to answer with a specific grouping.
_RESPONSE: dict = {}


def _stub_generate(req):
    _CAPTURED.append(req)
    return type("R", (), {"raw_text": json.dumps(_RESPONSE)})()


@pytest.fixture(autouse=True)
def _stub_llm(monkeypatch: pytest.MonkeyPatch):
    _CAPTURED.clear()
    _RESPONSE.clear()
    _RESPONSE["groups"] = [
        {"label": "働き方の見立て", "cardIds": ["c-remote", "c-office"], "rationale": "r"}
    ]
    monkeypatch.setattr(ai, "generate_with_fallback", _stub_generate)
    # This module exercises the IR projection, not registry availability
    # (AI-MODEL-GOVERNANCE-02); `test_ai_model_governance.py` owns that gate.
    monkeypatch.setattr(ai, "_assert_model_allowed", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(settings, "allow_unreviewed_ai_text", False)
    yield
    _CAPTURED.clear()
    _RESPONSE.clear()


_TEXTS = {
    "c-remote": "チームは在宅勤務でも成果を出せると考えている",
    "c-office": "対面でないと設計の議論が浅くなると感じている",
    "c-parked": "評価制度の見直しはまだ着手していない",
}


def _doc(*, hold_state: str | None = "held", islands: list[dict] | None = None) -> dict:
    parked = {
        "id": "c-parked",
        "text": _TEXTS["c-parked"],
        "x": 80,
        "y": 0,
        "textReviewed": True,
    }
    if hold_state is not None:
        parked["holdState"] = hold_state
    return {
        "version": 1,
        "id": "card-groups-doc",
        "createdAt": "2026-08-30T00:00:00Z",
        "updatedAt": "2026-08-30T00:00:00Z",
        "transform": {"panX": 0, "panY": 0, "zoom": 1},
        "cards": [
            {
                "id": "c-remote",
                "text": _TEXTS["c-remote"],
                "x": 0,
                "y": 0,
                "textReviewed": True,
            },
            {
                "id": "c-office",
                "text": _TEXTS["c-office"],
                "x": 40,
                "y": 0,
                "textReviewed": True,
            },
            parked,
        ],
        "edges": [
            {"id": "e1", "fromId": "c-remote", "toId": "c-office", "type": "negate"}
        ],
        "islands": [
            {
                "id": "isl-work",
                "cardIds": ["c-remote", "c-office"],
                "title": "働く場所をめぐる見立てが割れている",
                "titleReviewed": True,
            },
            {
                "id": "isl-detail",
                "cardIds": [],
                "title": "その下位の論点",
                "parentIslandId": "isl-work",
            },
        ]
        if islands is None
        else islands,
        "evidenceLinks": [],
    }


def _payload(doc: dict | None = None, card_ids: list[str] | None = None) -> dict:
    ids = card_ids or ["c-remote", "c-office", "c-parked"]
    body: dict = {
        "cards": [
            {"id": card_id, "text": _TEXTS[card_id], "textReviewed": True}
            for card_id in ids
        ]
    }
    if doc is not None:
        body["doc"] = doc
    return body


# ---------------------------------------------------------------------------
# AC-2: a held card never lands in a suggested group
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("state", ["held", "pending", "shelved"])
def test_held_card_is_never_offered_or_returned(state: str) -> None:
    """The core AC-2 invariant, against a model that ignores the instruction."""
    _RESPONSE["groups"] = [
        # The stub answers with the held card deliberately: prompt compliance is
        # not the guarantee, the code path is.
        {"label": "全部まとめて", "cardIds": ["c-remote", "c-office", "c-parked"]},
    ]
    with TestClient(app) as client:
        resp = client.post(
            "/ai/suggest-card-groups", json=_payload(_doc(hold_state=state))
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    grouped = {card_id for group in body["groups"] for card_id in group["cardIds"]}
    assert "c-parked" not in grouped
    assert grouped == {"c-remote", "c-office"}
    assert body["excludedCardIds"] == ["c-parked"]

    # ...and it was never offered as groupable in the first place.
    prompt = _CAPTURED[0].prompt
    assert 'id="c-parked"' not in prompt
    assert f"holdState={state}" in prompt


def test_active_card_with_no_hold_state_is_grouped_normally() -> None:
    _RESPONSE["groups"] = [
        {"label": "全部まとめて", "cardIds": ["c-remote", "c-office", "c-parked"]},
    ]
    with TestClient(app) as client:
        resp = client.post(
            "/ai/suggest-card-groups", json=_payload(_doc(hold_state=None))
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["groups"][0]["cardIds"] == ["c-remote", "c-office", "c-parked"]
    assert body["excludedCardIds"] == []
    assert 'id="c-parked"' in _CAPTURED[0].prompt


def test_a_group_left_empty_by_the_filter_is_dropped_not_emitted() -> None:
    _RESPONSE["groups"] = [
        {"label": "働き方", "cardIds": ["c-remote", "c-office"]},
        {"label": "保留のみの束", "cardIds": ["c-parked"]},
    ]
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload(_doc()))
    body = resp.json()
    assert [group["label"] for group in body["groups"]] == ["働き方"]


def test_all_cards_held_short_circuits_without_calling_the_model() -> None:
    doc = _doc()
    for card in doc["cards"]:
        card["holdState"] = "shelved"
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload(doc))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["groups"] == []
    assert body["excludedCardIds"] == ["c-remote", "c-office", "c-parked"]
    # The decision is answered from the IR; the model is never asked.
    assert _CAPTURED == []


def test_a_hallucinated_card_id_is_dropped_from_the_answer() -> None:
    """The candidate filter is a whitelist, so an id that was never offered --
    held, unknown, or invented -- cannot enter a group."""
    _RESPONSE["groups"] = [
        {"label": "捏造混じり", "cardIds": ["c-remote", "c-office", "c-ghost"]},
    ]
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload(_doc()))
    assert resp.json()["groups"][0]["cardIds"] == ["c-remote", "c-office"]


# ---------------------------------------------------------------------------
# The IR actually reaches the LLM boundary
# ---------------------------------------------------------------------------


def test_request_carries_the_ir_and_the_prompt_shows_the_context() -> None:
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload(_doc()))
    assert resp.status_code == 200, resp.text

    llm_request = _CAPTURED[0]
    ir = llm_request.inputs
    assert ir is not None
    assert ir["ir_version"] == IR_VERSION
    # ADR-0069 D1=B / spec §2.2.1: this endpoint does not request coordinates.
    assert "coordinates" not in ir
    by_id = {card["id"]: card for card in ir["cards"]}
    assert by_id["c-parked"]["hold_state"] == "held"
    assert "hold_state" not in by_id["c-remote"]
    by_island = {island["id"]: island for island in ir["islands"]}
    assert by_island["isl-work"]["card_ids"] == ["c-office", "c-remote"]
    assert by_island["isl-detail"]["parent_island_id"] == "isl-work"

    prompt = llm_request.prompt
    assert "isl-work" in prompt
    assert "reviewState=human_reviewed" in prompt
    assert "parentIslandId=isl-work" in prompt
    assert "negate: c-remote -> c-office" in prompt


def test_structural_cluster_score_stays_internal_to_ir() -> None:
    """ADR-0090: structural score is audit evidence, not semantic guidance."""
    doc = _doc()
    doc["edges"] = [
        {
            "id": "e1",
            "fromId": "c-remote",
            "toId": "c-office",
            "type": "related",
        }
    ]

    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload(doc))

    assert resp.status_code == 200, resp.text
    llm_request = _CAPTURED[0]
    clusters = llm_request.inputs["cluster_candidates"]
    assert clusters == [
        {
            "cluster_id": "cc-0001",
            "card_ids": ["c-office", "c-remote"],
            "basis": "relation",
            "score": 0.5,
        }
    ]

    prompt = llm_request.prompt
    assert "cc-0001: c-office,c-remote (basis=relation)" in prompt
    assert "score=" not in prompt
    assert '"score"' not in prompt


def test_candidate_card_lines_keep_the_mock_adapter_format() -> None:
    """`deploy/tools/mock_local_llm.py` parses the prompt with
    `^\\s*- id="([^"]+)", text="([^"]*)"`; the business-flow E2E depends on it."""
    with TestClient(app) as client:
        client.post("/ai/suggest-card-groups", json=_payload(_doc()))
    prompt = _CAPTURED[0].prompt
    assert f'  - id="c-remote", text="{_TEXTS["c-remote"]}"' in prompt


def test_flat_card_list_request_without_doc_still_works() -> None:
    """AC-11 (narrowed): the shipped request shape keeps working."""
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["groups"][0]["cardIds"] == ["c-remote", "c-office"]
    assert body["excludedCardIds"] == []
    assert body["truncated"] is False

    ir = _CAPTURED[0].inputs
    assert ir["ir_version"] == IR_VERSION
    assert [card["id"] for card in ir["cards"]] == ["c-office", "c-parked", "c-remote"]
    assert "islands" not in ir
    assert "created_at" not in ir["meta"]  # never invented (spec §2.4 rule 5)


def test_truncation_is_reported_rather_than_silent() -> None:
    """The IR caps the projection at `MAX_CARDS` (spec §5.1) while the request
    accepts up to 1000 cards (DOGFOOD-31). Sizing that cap is AC-10 and is
    deferred; a caller must at least be able to see that it bit."""
    from sui_sensemaking_api.llm_input_ir import MAX_CARDS

    ids = [f"k-{index:03d}" for index in range(MAX_CARDS + 1)]
    _RESPONSE["groups"] = [{"label": "先頭2枚", "cardIds": ["k-000", "k-001"]}]
    with TestClient(app) as client:
        resp = client.post(
            "/ai/suggest-card-groups",
            json={
                "cards": [
                    {"id": card_id, "text": f"観察{card_id}", "textReviewed": True}
                    for card_id in ids
                ]
            },
        )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["truncated"] is True
    assert body["groups"][0]["cardIds"] == ["k-000", "k-001"]
    # The dropped card was never offered, and is not reported as human-withheld.
    assert body["excludedCardIds"] == []
    assert f'id="{ids[-1]}"' not in _CAPTURED[0].prompt


def test_response_shape_is_backward_compatible() -> None:
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload())
    body = resp.json()
    assert set(body) == {"groups", "excludedCardIds", "truncated"}
    assert set(body["groups"][0]) == {"label", "cardIds", "rationale"}


def test_cards_absent_from_the_document_are_still_projected() -> None:
    doc = _doc()
    doc["cards"] = [card for card in doc["cards"] if card["id"] != "c-parked"]
    doc["islands"] = []
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload(doc))
    assert resp.status_code == 200, resp.text
    # No holdState is known for it, so it stays a candidate.
    assert 'id="c-parked"' in _CAPTURED[0].prompt
    assert resp.json()["excludedCardIds"] == []


# ---------------------------------------------------------------------------
# SafeMode: layer 1 unchanged, layer 2 added
# ---------------------------------------------------------------------------


def test_existing_reject_unreviewed_cards_behaviour_is_unchanged() -> None:
    """Regression proof for SEC-AI-SAFEMODE-01/02: the shipped 422 still fires,
    with the same code, and still fires BEFORE any LLM call."""
    with TestClient(app) as client:
        # unspecified textReviewed -> fail-closed (ADR-0068 D3=A)
        resp = client.post(
            "/ai/suggest-card-groups",
            json={"cards": [{"id": "c1", "text": "alpha"}, {"id": "c2", "text": "beta"}]},
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "unreviewed_text_not_allowed"

        # a single unreviewed card still poisons the request
        resp = client.post(
            "/ai/suggest-card-groups",
            json={
                "cards": [
                    {"id": "c1", "text": "alpha", "textReviewed": True},
                    {"id": "c2", "text": "beta", "textReviewed": False},
                ]
            },
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "unreviewed_text_not_allowed"
    assert _CAPTURED == []


def test_route_level_gate_fires_even_when_the_document_is_clean() -> None:
    """The doc cards are reviewed but a request card is not: layer 1 rejects."""
    body = _payload(_doc())
    body["cards"][0]["textReviewed"] = False
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=body)
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "unreviewed_text_not_allowed"
    assert _CAPTURED == []


def test_ir_layer_rejects_unreviewed_document_text_the_route_gate_cannot_see() -> None:
    """Layer 2 catches what layer 1 structurally cannot.

    `_reject_unreviewed_cards` only inspects `payload.cards`. An unreviewed card
    that arrives inside `doc` is invisible to it -- and the IR builder refuses it
    (llm_input_ir_spec.md §7.1).
    """
    doc = _doc()
    doc["cards"].append(
        {"id": "c-draft", "text": "まだ確認していない下書き", "x": 120, "y": 0}
    )
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=_payload(doc))
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "unreviewed_text_not_allowed"
    assert _CAPTURED == []


def test_ir_layer_rejects_pii_in_document_text() -> None:
    doc = _doc()
    doc["cards"][0]["text"] = "連絡先は contact@example.com である"
    body = _payload(doc)
    body["cards"][0]["text"] = "連絡先は contact@example.com である"
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=body)
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["code"] == "pii_detected"
    # SEC-VALIDATION-LEAK-01: the rejected value is not reflected back.
    assert "contact@example.com" not in json.dumps(detail, ensure_ascii=False)
    assert _CAPTURED == []


def test_duplicate_card_id_in_the_request_is_rejected() -> None:
    body = _payload()
    body["cards"][1] = dict(body["cards"][0])
    with TestClient(app) as client:
        resp = client.post("/ai/suggest-card-groups", json=body)
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "duplicate_card_id"
    assert _CAPTURED == []
