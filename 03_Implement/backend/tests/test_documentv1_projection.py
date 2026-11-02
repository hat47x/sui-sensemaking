import unittest

from sui_sensemaking_api.documentv1_projection import (
    ProjectionError,
    from_artifact,
)

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


if __name__ == "__main__":
    unittest.main()
