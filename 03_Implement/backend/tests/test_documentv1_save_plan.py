import unittest

from sui_sensemaking_api.documentv1_projection import from_artifact
from sui_sensemaking_api.documentv1_save_plan import plan_save

ARTIFACT = {
    "schema": "tai.reference.tei-documentv1-projection/v0",
    "contract": {"id": "sui.documentv1.projection", "version": "1"},
    "source": {"teiCommit": "abc", "contracts": {}},
    "document": {
        "document": {"id": "doc-1"},
        "cards": [
            {"id": "card-1", "text": "hello", "x": 1, "y": 2},
            {"id": "card-2", "text": "world", "x": 3, "y": 4},
        ],
        "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
        "edges": [],
        "affiliations": [{"id": "aff-1", "cardId": "card-2", "islandId": "island-1"}],
    },
}

TRANSFORM = {"panX": 0.0, "panY": 0.0, "zoom": 1.0}


def _plan(existing=None):
    return plan_save(
        from_artifact(ARTIFACT),
        transform=TRANSFORM,
        created_at="2026-11-03T00:00:00Z",
        updated_at="2026-11-03T00:00:00Z",
        existing=existing,
    )


class PlanSaveTest(unittest.TestCase):
    def test_creates_when_no_existing_document(self):
        plan = _plan()
        self.assertEqual(plan.action, "create")
        self.assertEqual(plan.cards_added, ("card-1", "card-2"))
        self.assertEqual(plan.warnings, ())

    def test_updates_with_added_removed_changed(self):
        existing = {
            "id": "doc-1",
            "cards": [
                {"id": "card-1", "text": "old", "x": 1, "y": 2},
                {"id": "card-3", "text": "gone", "x": 0, "y": 0},
            ],
            "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
        }
        plan = _plan(existing)
        self.assertEqual(plan.action, "update")
        self.assertEqual(plan.cards_added, ("card-2",))
        self.assertEqual(plan.cards_removed, ("card-3",))
        self.assertEqual(plan.cards_changed, ("card-1",))
        self.assertTrue(any("cards would be removed" in warning for warning in plan.warnings))

    def test_warns_about_unprojected_existing_fields(self):
        existing = {
            "id": "doc-1",
            "cards": [{"id": "card-1", "text": "hello", "x": 1, "y": 2}],
            "islands": [{"id": "island-1", "cardIds": ["card-1"]}],
            "critiqueInputs": [{"id": "crit-1"}],
        }
        plan = _plan(existing)
        self.assertTrue(any("critiqueInputs" in warning for warning in plan.warnings))

    def test_rejects_mismatched_document_id(self):
        with self.assertRaises(ValueError):
            _plan({"id": "doc-2", "cards": [], "islands": []})


if __name__ == "__main__":
    unittest.main()
