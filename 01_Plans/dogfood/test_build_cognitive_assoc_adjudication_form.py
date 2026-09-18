from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from build_cognitive_assoc_adjudication_form import (
    FORBIDDEN_PAYLOAD_KEYS,
    build_form_payload,
    render_html,
)
from freeze_cognitive_assoc_adjudication import ALLOWED_LABELS


def selected_fixture() -> dict:
    allowed = list(ALLOWED_LABELS)
    return {
        "benchmarkId": "synthetic-v0",
        "status": "pending_human",
        "semanticBaselineGate": "closed",
        "modelOutputsAllowed": False,
        "pairCandidates": [
            {
                "id": "doc:pair:c01+c02",
                "documentId": "doc",
                "cardIds": ["c01", "c02"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["U"],
            }
        ],
        "twoPlusOneCandidates": [
            {
                "id": "doc:2plus1:g1:c01+c02+c03",
                "documentId": "doc",
                "cardIds": ["c01", "c02", "c03"],
                "label": "pending_human",
                "allowedLabels": allowed,
                "selectionStrata": ["L"],
            }
        ],
    }


def selected_bytes(value: dict) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


class CognitiveAssocAdjudicationFormTests(unittest.TestCase):
    def setUp(self) -> None:
        self.selected = selected_fixture()
        self.raw = selected_bytes(self.selected)
        self.cards = {
            ("doc", "c01"): "制度と責任",
            ("doc", "c02"): "責任主体を問う",
            ("doc", "c03"): "外部との接続",
        }

    def test_payload_contains_only_blind_human_review_fields(self) -> None:
        payload = build_form_payload(self.selected, self.raw, self.cards)
        self.assertEqual(payload["benchmarkId"], "synthetic-v0")
        self.assertEqual(payload["semanticBaselineGate"], "closed")
        self.assertIs(payload["modelOutputsAllowed"], False)
        self.assertEqual(len(payload["cases"]), 2)

        encoded = json.dumps(payload, ensure_ascii=False)
        for key in FORBIDDEN_PAYLOAD_KEYS:
            self.assertNotIn(f'"{key}"', encoded)

        self.assertEqual(
            [case["candidateId"] for case in payload["cases"]],
            sorted(case["candidateId"] for case in payload["cases"]),
        )
        self.assertEqual(
            set(payload["cases"][0]),
            {"candidateId", "documentId", "cards"},
        )

    def test_html_is_self_contained_and_has_no_external_urls(self) -> None:
        payload = build_form_payload(self.selected, self.raw, self.cards)
        page = render_html(payload)
        self.assertIn("Content-Security-Policy", page)
        self.assertIn("default-src 'none'", page)
        self.assertNotIn("http://", page)
        self.assertNotIn("https://", page)
        self.assertNotIn("<script src=", page)
        self.assertNotIn("<link ", page)
        self.assertIn("human-adjudication-response.json", page)

    def test_html_contains_all_four_labels(self) -> None:
        payload = build_form_payload(self.selected, self.raw, self.cards)
        page = render_html(payload)
        for label in ALLOWED_LABELS:
            self.assertIn(label, page)

    def test_selection_strata_do_not_leak_into_html(self) -> None:
        payload = build_form_payload(self.selected, self.raw, self.cards)
        page = render_html(payload)
        self.assertNotIn("selectionStrata", page)
        self.assertNotIn('"U"', page)
        self.assertNotIn('"L"', page)

    def test_missing_blind_card_fails_closed(self) -> None:
        cards = dict(self.cards)
        cards.pop(("doc", "c03"))
        with self.assertRaisesRegex(ValueError, "missing blind card"):
            build_form_payload(self.selected, self.raw, cards)

    def test_prelabelled_candidate_fails_closed(self) -> None:
        selected = selected_fixture()
        selected["pairCandidates"][0]["label"] = "hard_negative"
        with self.assertRaisesRegex(ValueError, "already labelled"):
            build_form_payload(selected, selected_bytes(selected), self.cards)

    def test_open_gate_fails_closed(self) -> None:
        selected = selected_fixture()
        selected["semanticBaselineGate"] = "open"
        with self.assertRaisesRegex(ValueError, "must remain closed"):
            build_form_payload(selected, selected_bytes(selected), self.cards)

    def test_model_outputs_allowed_fails_closed(self) -> None:
        selected = selected_fixture()
        selected["modelOutputsAllowed"] = True
        with self.assertRaisesRegex(ValueError, "must remain forbidden"):
            build_form_payload(selected, selected_bytes(selected), self.cards)

    def test_wrong_card_count_fails_closed(self) -> None:
        selected = selected_fixture()
        selected["pairCandidates"][0]["cardIds"] = ["c01"]
        with self.assertRaisesRegex(ValueError, "must contain 2 cards"):
            build_form_payload(selected, selected_bytes(selected), self.cards)


if __name__ == "__main__":
    unittest.main()
