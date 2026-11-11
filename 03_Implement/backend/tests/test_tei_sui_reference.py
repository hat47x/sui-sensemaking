import json

import pytest

from sui_sensemaking_api.models import DocumentV1
from sui_sensemaking_api.tei_sui_reference import (
    REFERENCE_SCHEMA,
    SuiReferenceError,
    build_sui_reference,
    reference_digest,
    reference_to_json,
)


def artifact(**document_changes):
    payload = {
        "schema": "tai.reference.tei-documentv1-projection/v0",
        "contract": {"id": "sui.documentv1.projection", "version": "1"},
        "source": {
            "teiCommit": "tei-main-b8cbd432a",
            "documentRevision": "rev-1",
            "completeness": "partial",
        },
        "document": {
            "document": {"id": "doc-1", "title": "Sensitive document title"},
            "cards": [
                {
                    "id": "card-1",
                    "text": "same name",
                    "x": 10,
                    "y": 20,
                    "claimType": "claim",
                    "textReviewed": True,
                },
                {
                    "id": "card-2",
                    "text": "same name",
                    "x": 30,
                    "y": 40,
                    "claimType": "hypothesis",
                    "textReviewed": True,
                },
                {
                    "id": "card-3",
                    "text": "unreviewed draft",
                    "x": 50,
                    "y": 60,
                    "textReviewed": False,
                    "holdState": "pending",
                },
                {
                    "id": "card-4",
                    "text": "private text",
                    "x": 0,
                    "y": 0,
                    "textReviewed": True,
                    "visibility": "private",
                },
                {
                    "id": "card-5",
                    "text": "reviewed",
                    "x": 70,
                    "y": 80,
                    "textReviewed": True,
                },
            ],
            "islands": [
                {
                    "id": "island-1",
                    "cardIds": ["card-1", "card-2"],
                    "title": "Island one",
                    "titleReviewed": True,
                },
                {
                    "id": "island-2",
                    "cardIds": ["card-5"],
                    "title": "Unreviewed island title",
                    "titleReviewed": False,
                },
                {"id": "island-3", "cardIds": []},
            ],
            "edges": [
                {
                    "id": "edge-1",
                    "fromId": "card-1",
                    "toId": "card-2",
                    "type": "related",
                    "fromKind": "card",
                    "toKind": "card",
                },
                {
                    "id": "edge-2",
                    "fromId": "card-1",
                    "toId": "card-2",
                    "type": "negate",
                    "fromKind": "card",
                    "toKind": "card",
                },
                {
                    "id": "edge-3",
                    "fromId": "island-3",
                    "toId": "island-1",
                    "type": "supports",
                    "fromKind": "island",
                    "toKind": "island",
                },
            ],
            "affiliations": [
                {"id": "aff-1", "cardId": "card-1", "islandId": "island-3"},
                {"id": "aff-2", "cardId": "card-2", "islandId": "island-3"},
            ],
        },
    }
    payload["document"].update(document_changes)
    return payload


def test_reference_is_typed_references_only_and_not_accepted_meaning():
    reference = build_sui_reference(artifact())
    body = reference_to_json(reference)

    assert body["schema"] == REFERENCE_SCHEMA
    assert body["authority"] == "sui-document"
    assert body["acceptedMeaning"] is False
    assert body["semanticStatus"] == "reference-only"
    assert body["disclosure"]["textIncluded"] is False
    assert body["disclosure"]["unreviewedContent"] == "withheld"
    assert reference.document_ref.id == "doc-1"


def test_same_name_cards_keep_distinct_identities():
    reference = build_sui_reference(artifact())
    refs = [card.ref.id for card in reference.cards]

    assert refs.count("card-1") == 1
    assert refs.count("card-2") == 1
    assert "card-1" != "card-2"
    assert len(reference.cards) == 4


def test_multi_island_membership_distinguishes_containment_from_affiliation():
    reference = build_sui_reference(artifact())
    card = next(item for item in reference.cards if item.ref.id == "card-1")

    assert [(item["kind"], item["islandRef"]["id"]) for item in card.memberships] == [
        ("containment", "island-1"),
        ("affiliation", "island-3"),
    ]
    relation_kinds = {relation.relation_kind for relation in reference.relations}
    assert relation_kinds == {"containment", "affiliation", "directed"}


def test_directed_relations_and_multi_edges_are_preserved():
    reference = build_sui_reference(artifact())
    edges = [item for item in reference.relations if item.relation_kind == "directed"]

    assert len(edges) == 3
    assert {edge.ref.id for edge in edges} == {"edge-1", "edge-2", "edge-3"}
    first, second = [
        edge for edge in edges if edge.ref.id in {"edge-1", "edge-2"}
    ]
    assert (first.from_ref.id, second.from_ref.id) == ("card-1", "card-1")
    assert (first.to_ref.id, second.to_ref.id) == ("card-2", "card-2")
    assert {first.relation_type, second.relation_type} == {"related", "negate"}


def test_unreviewed_is_kept_as_withheld_reference():
    reference = build_sui_reference(artifact())
    card = next(item for item in reference.cards if item.ref.id == "card-3")

    assert card.text_review == "unreviewed"
    assert card.content_status == "withheld-unreviewed"
    serialized = json.dumps(reference_to_json(reference), ensure_ascii=False)
    assert "unreviewed draft" not in serialized
    assert "same name" not in serialized
    assert "Sensitive document title" not in serialized
    assert "Island one" not in serialized


def test_private_entity_is_omitted_without_id_or_count():
    reference = build_sui_reference(artifact())
    serialized = json.dumps(reference_to_json(reference), ensure_ascii=False)

    assert "card-4" not in serialized
    assert "private text" not in serialized
    assert reference.disclosure["hasRestrictedContent"] is True
    assert reference.disclosure["restrictedKinds"] == ["card"]
    assert "private-entities-omitted" in reference.completeness["reasons"]
    assert reference.completeness["status"] == "partial"


def test_tree_is_unsupported_and_canvas_is_partial():
    reference = build_sui_reference(artifact())
    losses = {item["feature"]: item["status"] for item in reference.losses}

    assert losses["tree-forest"] == "unsupported"
    assert losses["canvas-transform"] == "partial"
    assert reference.revision.revision_status == "observed"


def test_reference_digest_is_stable_for_same_payload():
    first = build_sui_reference(artifact())
    second = build_sui_reference(artifact())

    assert reference_digest(first) == reference_digest(second)
    assert first.revision.change == "initial"


def test_reference_change_and_re_reference_invalidate_prior_reference():
    first = build_sui_reference(artifact())
    unchanged = build_sui_reference(
        artifact(),
        previous_digest=first.revision.document_digest,
        previous_source_revision=first.revision.source_revision,
    )
    changed_payload = artifact(
        cards=[
            dict(artifact()["document"]["cards"][0], text="changed"),
            *artifact()["document"]["cards"][1:],
        ]
    )
    changed = build_sui_reference(
        changed_payload,
        previous_digest=first.revision.document_digest,
        previous_source_revision=first.revision.source_revision,
    )

    assert unchanged.revision.change == "unchanged"
    assert unchanged.revision.previous_reference_invalidated is False
    assert changed.revision.change == "content-changed"
    assert changed.revision.previous_reference_invalidated is True
    assert changed.revision.document_digest != first.revision.document_digest


def test_source_revision_change_is_distinct_from_content_change():
    first = build_sui_reference(artifact())
    payload = artifact()
    payload["source"] = dict(payload["source"], documentRevision="rev-2")
    changed = build_sui_reference(
        payload,
        previous_digest=first.revision.document_digest,
        previous_source_revision=first.revision.source_revision,
    )

    assert changed.revision.change == "source-revision-changed"
    assert changed.revision.document_digest == first.revision.document_digest
    assert changed.revision.source_revision == "rev-2"
    assert changed.revision.previous_reference_invalidated is True


def test_missing_source_revision_is_unknown_not_invented():
    payload = artifact()
    payload["source"] = {"teiCommit": "tei-main-b8cbd432a"}
    reference = build_sui_reference(payload)

    assert reference.revision.revision_status == "unknown"
    assert reference.revision.source_revision is None
    assert any(
        item["feature"] == "source-revision" and item["status"] == "unresolved"
        for item in reference.losses
    )


def test_non_projection_schema_is_rejected():
    payload = artifact()
    payload["schema"] = "other"

    with pytest.raises(SuiReferenceError):
        build_sui_reference(payload)


def _documentv1_from_fixture():
    document = artifact()["document"]
    return DocumentV1.model_validate(
        {
            "version": 1,
            "id": document["document"]["id"],
            "createdAt": "2026-11-11T00:00:00Z",
            "updatedAt": "2026-11-11T00:00:00Z",
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": document["cards"],
            "edges": document["edges"],
            "islands": document["islands"],
            "affiliations": document["affiliations"],
        }
    )


def test_allowed_subset_matches_native_identities_and_topology():
    document = _documentv1_from_fixture()
    reference = build_sui_reference(artifact())

    native_cards = {card.id for card in document.cards}
    native_islands = {island.id for island in document.islands}
    native_edges = {edge.id for edge in document.edges}
    native_memberships = {
        ("containment", island.id, card_id)
        for island in document.islands
        for card_id in island.cardIds
    } | {
        ("affiliation", affiliation.islandId, affiliation.cardId)
        for affiliation in document.affiliations
    }

    referenced_cards = {card.ref.id for card in reference.cards}
    referenced_islands = {island.ref.id for island in reference.islands}
    referenced_edges = {
        relation.ref.id
        for relation in reference.relations
        if relation.relation_kind == "directed"
    }
    referenced_memberships = {
        (
            relation.relation_kind,
            relation.to_ref.id
            if relation.relation_kind == "affiliation"
            else relation.from_ref.id,
            relation.from_ref.id
            if relation.relation_kind == "affiliation"
            else relation.to_ref.id,
        )
        for relation in reference.relations
        if relation.relation_kind in {"containment", "affiliation"}
    }

    assert referenced_cards == native_cards - {"card-4"}
    assert referenced_islands == native_islands
    assert referenced_edges == native_edges
    assert referenced_memberships == native_memberships

    # The native DocumentV1 carries text; the reference path does not. Both
    # preserve identity and topology, but only the reference states that a
    # readable Card is not an accepted meaning.
    assert "same name" in json.dumps(
        [card.model_dump() for card in document.cards], ensure_ascii=False
    )
    assert "same name" not in json.dumps(reference_to_json(reference), ensure_ascii=False)
    assert reference.as_json()["acceptedMeaning"] is False
    assert reference.as_json()["losses"]
