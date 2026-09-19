from __future__ import annotations

import copy
import unittest

from build_cognitive_assoc_cognitive_dogfood_plan import (
    MANIFEST_SCHEMA,
    PLAN_SCHEMA,
    build_plan,
    canonical_json_bytes,
)


def task(task_id: str, sha_char: str, card_count: int = 40, difficulty: str = "medium"):
    return {
        "taskId": task_id,
        "snapshotSha256": sha_char * 64,
        "cardCount": card_count,
        "textReviewedOnly": True,
        "selfReferentialToSui": False,
        "seenByParticipantBeforeStudy": False,
        "difficultyBand": difficulty,
    }


def source_fixture():
    return {
        "schema": MANIFEST_SCHEMA,
        "studyId": "synthetic-dogfood-v0",
        "participantRole": "Maintainer",
        "candidateLayer": {
            "artifactSha256": "a" * 64,
            "variantId": "F_all",
            "productionAdoptionAuthorized": False,
            "autoApply": False,
            "scoreOrRankingVisible": False,
        },
        "phaseSeconds": {
            "unaided": 600,
            "intervention": 480,
            "origin_blind_review": 300,
        },
        "taskPairs": [
            {
                "pairId": "p1",
                "tasks": [
                    task("task-a", "1", 40),
                    task("task-b", "2", 44),
                ],
            },
            {
                "pairId": "p2",
                "tasks": [
                    task("task-c", "3", 36),
                    task("task-d", "4", 40),
                ],
            },
        ],
    }


class CognitiveDogfoodPlanTests(unittest.TestCase):
    def build(self, source=None):
        source = source or source_fixture()
        raw = canonical_json_bytes(source)
        return build_plan(raw, source)

    def test_two_pairs_create_four_sessions_and_balance_order(self):
        plan = self.build()
        self.assertEqual(plan["schema"], PLAN_SCHEMA)
        self.assertEqual(len(plan["sessions"]), 4)
        self.assertEqual(plan["counterbalance"]["pairCount"], 2)
        self.assertEqual(
            plan["counterbalance"]["controlFirstPairs"]
            + plan["counterbalance"]["candidateAssistedFirstPairs"],
            2,
        )
        self.assertEqual(
            abs(
                plan["counterbalance"]["controlFirstPairs"]
                - plan["counterbalance"]["candidateAssistedFirstPairs"]
            ),
            0,
        )
        self.assertIs(plan["measurementPolicy"]["singleCompositeScore"], False)
        self.assertIs(plan["measurementPolicy"]["winnerSelected"], False)
        self.assertIs(plan["productionAdoptionAuthorized"], False)

    def test_candidate_visibility_only_during_treatment_intervention(self):
        plan = self.build()
        for session in plan["sessions"]:
            visibility = session["candidateVisibility"]
            self.assertIs(visibility["unaided"], False)
            self.assertIs(visibility["origin_blind_review"], False)
            if session["condition"] == "candidate_assisted":
                self.assertIs(visibility["intervention"], True)
            else:
                self.assertIs(visibility["intervention"], False)

    def test_each_task_appears_once_and_never_in_both_conditions(self):
        plan = self.build()
        seen = {}
        for session in plan["sessions"]:
            self.assertNotIn(session["taskId"], seen)
            seen[session["taskId"]] = session["condition"]
        self.assertEqual(set(seen), {"task-a", "task-b", "task-c", "task-d"})

    def test_duplicate_task_id_fails_closed(self):
        source = source_fixture()
        source["taskPairs"][1]["tasks"][0]["taskId"] = "task-a"
        with self.assertRaisesRegex(ValueError, "duplicate taskId"):
            self.build(source)

    def test_seen_task_fails_closed(self):
        source = source_fixture()
        source["taskPairs"][0]["tasks"][0]["seenByParticipantBeforeStudy"] = True
        with self.assertRaisesRegex(ValueError, "previously seen"):
            self.build(source)

    def test_self_referential_task_fails_closed(self):
        source = source_fixture()
        source["taskPairs"][0]["tasks"][0]["selfReferentialToSui"] = True
        with self.assertRaisesRegex(ValueError, "self-referential"):
            self.build(source)

    def test_candidate_score_visibility_fails_closed(self):
        source = source_fixture()
        source["candidateLayer"]["scoreOrRankingVisible"] = True
        with self.assertRaisesRegex(ValueError, "score/ranking"):
            self.build(source)

    def test_candidate_auto_apply_fails_closed(self):
        source = source_fixture()
        source["candidateLayer"]["autoApply"] = True
        with self.assertRaisesRegex(ValueError, "auto-apply"):
            self.build(source)

    def test_pair_difficulty_must_match(self):
        source = source_fixture()
        source["taskPairs"][0]["tasks"][1]["difficultyBand"] = "high"
        with self.assertRaisesRegex(ValueError, "share difficultyBand"):
            self.build(source)

    def test_pair_card_count_must_be_within_25_percent(self):
        source = source_fixture()
        source["taskPairs"][0]["tasks"][1]["cardCount"] = 60
        with self.assertRaisesRegex(ValueError, "25 percent"):
            self.build(source)

    def test_at_least_two_pairs_are_required(self):
        source = source_fixture()
        source["taskPairs"] = source["taskPairs"][:1]
        with self.assertRaisesRegex(ValueError, "at least two taskPairs"):
            self.build(source)

    def test_plan_is_deterministic(self):
        first = self.build()
        second = self.build(copy.deepcopy(source_fixture()))
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
