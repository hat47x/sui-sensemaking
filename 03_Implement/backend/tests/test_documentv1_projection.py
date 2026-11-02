import json
import unittest

from pydantic import ValidationError

from sui_sensemaking_api.documentv1_projection import (
    ProjectionError,
    from_artifact,
    to_documentv1_payload,
)
from sui_sensemaking_api.models import DocumentV1

ARTIFACT = {
    "schema": "tai.reference.tei-documentv1-projection/v0",
    "contract": {"id": "sui.documentv1.projection", "version": "1"},
    "source": {"teiCommit": "abc", "contracts": {}},
    "document": {
        "document": {"id": "doc-1", "title": "Notes"},
        "cards": [
            {"id": "card-1", "text": "hello", "x": 1, "y": 2},
            {"id": "card-2", "text": "", "x": 0, "y": 0, "textReviewed": True},
        ],
        "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
        "edges": [
            {
                "id": "edge-1",
                "fromId": "card-1",
                "toId": "island-1",
                "type": "contains",
                "fromKind": "card",
                "toKind": "island",
            }
        ],
        "affiliations": [{"id": "aff-1", "cardId": "card-1", "islandId": "island-1"}],
    },
}

TRANSFORM = {"panX": 0, "panY": 0, "zoom": 1}


def artifact(**document_changes):
    payload = {key: value for key, value in ARTIFACT.items()}
    document = {key: value for key, value in ARTIFACT["document"].items()}
    document.update(document_changes)
    payload["document"] = document
    return payload


class FromArtifactTest(unittest.TestCase):
    def test_reads_typed_document(self):
        document = from_artifact(ARTIFACT)
        self.assertEqual(document.id, "doc-1")
        self.assertEqual(len(document.cards), 2)
        self.assertEqual(document.cards[1].text, "")
        self.assertTrue(document.cards[1].text_reviewed)
        self.assertEqual(document.edges[0].to_kind, "island")
        self.assertEqual(document.affiliations[0].island_id, "island-1")

    def test_rejects_wrong_schema(self):
        payload = dict(ARTIFACT, schema="other")
        with self.assertRaises(ProjectionError):
            from_artifact(payload)

    def test_rejects_empty_cards(self):
        with self.assertRaises(ProjectionError):
            from_artifact(artifact(cards=[]))

    def test_rejects_unknown_edge_endpoint(self):
        edges = [dict(ARTIFACT["document"]["edges"][0], toId="island-9")]
        with self.assertRaises(ProjectionError):
            from_artifact(artifact(edges=edges))

    def test_rejects_unknown_island_card(self):
        islands = [{"id": "island-1", "cardIds": ["card-9"]}]
        with self.assertRaises(ProjectionError):
            from_artifact(artifact(islands=islands))

    def test_rejects_affiliation_to_unknown_island(self):
        affiliations = [{"id": "aff-1", "cardId": "card-1", "islandId": "island-9"}]
        with self.assertRaises(ProjectionError):
            from_artifact(artifact(affiliations=affiliations))

    def test_rejects_unknown_claim_type(self):
        cards = [dict(ARTIFACT["document"]["cards"][0], claimType="opinion")]
        with self.assertRaises(ProjectionError):
            from_artifact(artifact(cards=cards))

    def test_rejects_unknown_hold_state(self):
        cards = [dict(ARTIFACT["document"]["cards"][0], holdState="done")]
        with self.assertRaises(ProjectionError):
            from_artifact(artifact(cards=cards))

    def test_rejects_non_boolean_text_reviewed(self):
        cards = [dict(ARTIFACT["document"]["cards"][0], textReviewed="yes")]
        with self.assertRaises(ProjectionError):
            from_artifact(artifact(cards=cards))

    def test_rejects_non_string_island_title(self):
        islands = [{"id": "island-1", "cardIds": ["card-1"], "title": 3}]
        with self.assertRaises(ProjectionError):
            from_artifact(artifact(islands=islands))

    def test_accepts_every_allowed_claim_type_and_hold_state(self):
        cards = [
            {"id": f"card-{i}", "text": "t", "x": 0, "y": 0, "claimType": c, "holdState": h}
            for i, (c, h) in enumerate(
                zip(("fact", "claim", "hypothesis", "unknown"), ("held", "pending", "shelved", None))
            )
        ]
        document = from_artifact(artifact(cards=cards, islands=[], edges=[], affiliations=[]))
        self.assertEqual(document.cards[2].claim_type, "hypothesis")
        self.assertIsNone(document.cards[3].hold_state)


class ToDocumentV1PayloadTest(unittest.TestCase):
    def test_builds_documentv1_shape(self):
        document = from_artifact(ARTIFACT)
        payload = to_documentv1_payload(
            document,
            transform=TRANSFORM,
            created_at="2026-11-02T00:00:00Z",
            updated_at="2026-11-02T00:00:00Z",
        )
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["id"], "doc-1")
        self.assertEqual(payload["cards"][1]["textReviewed"], True)
        self.assertEqual(payload["edges"][0]["toKind"], "island")
        self.assertEqual(payload["affiliations"][0]["islandId"], "island-1")

    def test_requires_transform(self):
        document = from_artifact(ARTIFACT)
        with self.assertRaises(ProjectionError):
            to_documentv1_payload(document, transform={}, created_at="t", updated_at="t")

    def test_requires_timestamps(self):
        document = from_artifact(ARTIFACT)
        with self.assertRaises(ProjectionError):
            to_documentv1_payload(document, transform=TRANSFORM, created_at="", updated_at="t")


    def test_scn001_shaped_payload_validates_as_documentv1(self):
        # 5 card / 3 island / 1 edge。affiliationは、islandのcardIdsと重ならないカードだけに付ける。
        cards = [
            {"id": f"card-{n}", "text": f"text {n}", "x": n, "y": n, "claimType": "hypothesis",
             "holdState": "pending", "textReviewed": n % 2 == 0}
            for n in range(1, 6)
        ]
        islands = [
            {"id": "island-1", "cardIds": ["card-1", "card-2"], "title": "A"},
            {"id": "island-2", "cardIds": ["card-3"]},
            {"id": "island-3", "cardIds": ["card-4"]},
        ]
        edges = [
            {"id": "edge-1", "fromId": "island-1", "toId": "island-2", "type": "supports",
             "fromKind": "island", "toKind": "island"}
        ]
        affiliations = [{"id": "aff-1", "cardId": "card-5", "islandId": "island-3"}]
        document = from_artifact(
            artifact(cards=cards, islands=islands, edges=edges, affiliations=affiliations)
        )
        payload = to_documentv1_payload(
            document,
            transform=TRANSFORM,
            created_at="2026-11-02T00:00:00Z",
            updated_at="2026-11-02T00:00:00Z",
        )
        model = DocumentV1.model_validate(payload)
        self.assertEqual(
            (len(model.cards), len(model.islands), len(model.edges)), (5, 3, 1)
        )
        self.assertEqual(model.cards[0].claimType, "hypothesis")
        self.assertEqual(model.cards[0].holdState, "pending")
        self.assertEqual([c.textReviewed for c in model.cards], [False, True, False, True, False])

    def test_affiliation_duplicating_containment_is_not_a_documentv1(self):
        # 投影の読み込みは通るが、DocumentV1はisland.cardIdsと同じ組のaffiliationを拒否する。
        document = from_artifact(ARTIFACT)
        payload = to_documentv1_payload(
            document,
            transform=TRANSFORM,
            created_at="2026-11-02T00:00:00Z",
            updated_at="2026-11-02T00:00:00Z",
        )
        with self.assertRaises(ValidationError):
            DocumentV1.model_validate(payload)

    def test_non_sui_transform_is_not_a_documentv1(self):
        document = from_artifact(ARTIFACT)
        payload = to_documentv1_payload(
            document,
            transform={"kind": "test"},
            created_at="2026-11-02T00:00:00Z",
            updated_at="2026-11-02T00:00:00Z",
        )
        with self.assertRaises(ValidationError):
            DocumentV1.model_validate(payload)


class SaveContractTest(unittest.TestCase):
    def _payload(self):
        valid = json.loads(json.dumps(ARTIFACT))
        valid["document"]["affiliations"][0]["cardId"] = "card-2"
        return to_documentv1_payload(
            from_artifact(valid),
            transform=TRANSFORM,
            created_at="2026-11-02T00:00:00Z",
            updated_at="2026-11-02T00:00:00Z",
        )

    def test_payload_passes_the_save_contract_adapter(self):
        from sui_sensemaking_api.routes.docs import _validate_document_payload_with_a1_contract

        validated = _validate_document_payload_with_a1_contract(self._payload())
        self.assertEqual(validated.id, "doc-1")


class SourcesTest(unittest.TestCase):
    def _artifact(self):
        artifact = json.loads(json.dumps(ARTIFACT))
        artifact["document"]["affiliations"][0]["cardId"] = "card-2"
        artifact["document"]["cards"][0]["sources"] = ["src-1", "src-2"]
        return artifact

    def test_reads_sources(self):
        document = from_artifact(self._artifact())
        self.assertEqual(document.cards[0].sources, ("src-1", "src-2"))
        self.assertEqual(document.cards[1].sources, ())

    def test_payload_carries_sources(self):
        payload = to_documentv1_payload(
            from_artifact(self._artifact()),
            transform=TRANSFORM,
            created_at="2026-11-02T00:00:00Z",
            updated_at="2026-11-02T00:00:00Z",
        )
        self.assertEqual(payload["cards"][0]["sources"], ["src-1", "src-2"])
        self.assertNotIn("sources", payload["cards"][1])

    def test_rejects_non_array_sources(self):
        artifact = self._artifact()
        artifact["document"]["cards"][0]["sources"] = "src-1"
        with self.assertRaises(ValueError):
            from_artifact(artifact)


class ReadingOrderTest(unittest.TestCase):
    def _artifact(self):
        artifact = json.loads(json.dumps(ARTIFACT))
        artifact["document"]["document"]["readingOrder"] = ["card-1", "card-2"]
        return artifact

    def test_reads_reading_order(self):
        document = from_artifact(self._artifact())
        self.assertEqual(document.reading_order, ("card-1", "card-2"))

    def test_payload_carries_reading_order(self):
        payload = to_documentv1_payload(
            from_artifact(self._artifact()),
            transform=TRANSFORM,
            created_at="2026-11-02T00:00:00Z",
            updated_at="2026-11-02T00:00:00Z",
        )
        self.assertEqual(payload["readingOrder"], ["card-1", "card-2"])

    def test_rejects_non_array_reading_order(self):
        artifact = self._artifact()
        artifact["document"]["document"]["readingOrder"] = "card-1"
        with self.assertRaises(ValueError):
            from_artifact(artifact)


if __name__ == "__main__":
    unittest.main()
