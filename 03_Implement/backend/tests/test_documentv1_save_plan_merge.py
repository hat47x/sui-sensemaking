import unittest

from sui_sensemaking_api.documentv1_projection import from_artifact
from sui_sensemaking_api.documentv1_save_plan import plan_save

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

EXISTING = {
    "id": "doc-1",
    "cards": [
        {"id": "card-1", "text": "old", "x": 1, "y": 2, "critique": "keep"},
        {"id": "card-9", "text": "extra", "x": 0, "y": 0},
    ],
    "islands": [{"id": "island-1", "cardIds": ["card-1"]}, {"id": "island-9", "cardIds": ["card-9"]}],
    "critiqueInputs": [{"id": "crit-1"}],
}


def _plan(preserve):
    return plan_save(
        from_artifact(ARTIFACT),
        transform=TRANSFORM,
        created_at="2026-11-03T00:00:00Z",
        updated_at="2026-11-03T00:00:00Z",
        existing=EXISTING,
        preserve_existing=preserve,
    )


class PreservePlanTest(unittest.TestCase):
    def test_preserve_keeps_extra_cards_and_islands_without_warnings(self):
        plan = _plan(True)
        self.assertEqual(plan.cards_added, ())
        self.assertEqual(plan.cards_removed, ())
        self.assertEqual(plan.preserved_cards, ("card-9",))
        self.assertEqual(plan.preserved_islands, ("island-9",))
        self.assertEqual(plan.warnings, ())
        self.assertEqual({card["id"] for card in plan.payload["cards"]}, {"card-1", "card-9"})
        self.assertEqual(plan.payload["critiqueInputs"], [{"id": "crit-1"}])
        self.assertEqual(plan.payload["cards"][0]["critique"], "keep")

    def test_without_preserve_reports_removals_and_warnings(self):
        plan = _plan(False)
        self.assertEqual(plan.cards_removed, ("card-9",))
        self.assertEqual(plan.preserved_cards, ())
        self.assertTrue(any("critiqueInputs" in warning for warning in plan.warnings))


if __name__ == "__main__":
    unittest.main()
