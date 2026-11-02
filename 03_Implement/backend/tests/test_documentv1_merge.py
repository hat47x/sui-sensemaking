import unittest

from sui_sensemaking_api.documentv1_merge import merge_preserving_existing
from sui_sensemaking_api.documentv1_projection import from_artifact

ARTIFACT = {
    "schema": "tai.reference.tei-documentv1-projection/v0",
    "contract": {"id": "sui.documentv1.projection", "version": "1"},
    "source": {"teiCommit": "abc", "contracts": {}},
    "document": {
        "document": {"id": "doc-1"},
        "cards": [{"id": "card-1", "text": "new", "x": 1, "y": 2}],
        "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
        "edges": [],
        "affiliations": [],
    },
}

TRANSFORM = {"panX": 0.0, "panY": 0.0, "zoom": 1.0}


def _merge(existing):
    return merge_preserving_existing(
        from_artifact(ARTIFACT),
        transform=TRANSFORM,
        created_at="2026-11-03T00:00:00Z",
        updated_at="2026-11-03T00:00:00Z",
        existing=existing,
    )


class MergePreservingExistingTest(unittest.TestCase):
    def test_updates_projected_fields_and_keeps_card_extras(self):
        existing = {
            "id": "doc-1",
            "createdAt": "2026-01-01T00:00:00Z",
            "cards": [{"id": "card-1", "text": "old", "x": 1, "y": 2, "critique": "keep me"}],
            "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
        }
        merged = _merge(existing)
        card = merged["cards"][0]
        self.assertEqual(card["text"], "new")
        self.assertEqual(card["critique"], "keep me")
        self.assertEqual(merged["createdAt"], "2026-01-01T00:00:00Z")

    def test_keeps_existing_cards_not_in_projection(self):
        existing = {
            "id": "doc-1",
            "cards": [
                {"id": "card-1", "text": "old", "x": 1, "y": 2},
                {"id": "card-9", "text": "extra", "x": 0, "y": 0},
            ],
            "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
        }
        merged = _merge(existing)
        self.assertEqual({card["id"] for card in merged["cards"]}, {"card-1", "card-9"})

    def test_keeps_document_level_unprojected_fields(self):
        existing = {
            "id": "doc-1",
            "cards": [{"id": "card-1", "text": "old", "x": 1, "y": 2}],
            "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
            "critiqueInputs": [{"id": "crit-1"}],
        }
        merged = _merge(existing)
        self.assertEqual(merged["critiqueInputs"], [{"id": "crit-1"}])

    def test_keeps_island_extras(self):
        existing = {
            "id": "doc-1",
            "cards": [{"id": "card-1", "text": "old", "x": 1, "y": 2}],
            "islands": [
                {
                    "id": "island-1",
                    "cardIds": ["card-1"],
                    "summaryText": "keep",
                    "geometry": {"x": 0, "y": 0, "w": 1, "h": 1},
                }
            ],
        }
        merged = _merge(existing)
        self.assertEqual(merged["islands"][0]["summaryText"], "keep")

    def test_rejects_mismatched_document_id(self):
        with self.assertRaises(ValueError):
            _merge({"id": "doc-2", "cards": [], "islands": []})


if __name__ == "__main__":
    unittest.main()
