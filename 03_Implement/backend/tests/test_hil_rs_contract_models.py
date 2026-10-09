from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from sui_sensemaking_api.models import CritiqueInput, ReproposalDiff, ReviewAttribution


def _now() -> datetime:
    return datetime.now(timezone.utc)


def test_critique_input_requires_schema_version_1_0_0() -> None:
    with pytest.raises(ValidationError):
        CritiqueInput(
            schemaVersion="2.0.0",
            critiqueId="crit-1",
            targetRef="card:c1",
            critiqueType="too_close",
            createdAt=_now(),
            iteration=1,
        )


def test_reproposal_diff_requires_schema_version_1_0_0() -> None:
    with pytest.raises(ValidationError):
        ReproposalDiff(
            schemaVersion="2.0.0",
            proposalId="p1",
            basedOnIteration=1,
            traceKey="crit-1:p1",
            diffOps=[
                {
                    "opId": "op-1",
                    "opType": "move",
                    "targetRef": "card:c1",
                    "before": {"x": 0, "y": 0},
                    "after": {"x": 1, "y": 1},
                }
            ],
        )


def test_reproposal_diff_requires_before_and_after_for_each_diff_op() -> None:
    with pytest.raises(ValidationError):
        ReproposalDiff(
            schemaVersion="1.0.0",
            proposalId="p1",
            basedOnIteration=1,
            traceKey="crit-1:p1",
            diffOps=[
                {
                    "opId": "op-1",
                    "opType": "move",
                    "targetRef": "card:c1",
                    "after": {"x": 1, "y": 1},
                }
            ],
        )


def test_reproposal_diff_op_accepts_optional_rationale() -> None:
    validated = ReproposalDiff(
        schemaVersion="1.0.0",
        proposalId="p4",
        basedOnIteration=1,
        traceKey="crit-4:p4",
        diffOps=[
            {
                "opId": "op-with-rationale",
                "opType": "relabel",
                "targetRef": "card:c4",
                "before": {"text": "old"},
                "after": {"text": "new"},
                "rationale": "表記を揃えるため",
            },
            {
                "opId": "op-without-rationale",
                "opType": "relabel",
                "targetRef": "card:c5",
                "before": {"text": "old"},
                "after": {"text": "new"},
            },
        ],
    )
    assert validated.diffOps[0].rationale == "表記を揃えるため"
    assert validated.diffOps[1].rationale is None
    dumped_ops = validated.model_dump(mode="json")["diffOps"]
    assert dumped_ops[0]["rationale"] == "表記を揃えるため"
    assert "rationale" not in dumped_ops[1]


def test_review_attribution_requires_review_fields_for_human_reviewed() -> None:
    with pytest.raises(ValidationError):
        ReviewAttribution(
            schemaVersion="1.0.0",
            reviewState="human_reviewed",
            auditRecordedAt=_now(),
        )


def test_review_attribution_requires_reviewer_fields_even_when_unreviewed() -> None:
    with pytest.raises(ValidationError):
        ReviewAttribution(
            schemaVersion="1.0.0",
            reviewState="unreviewed",
            auditRecordedAt=_now(),
        )


def test_critique_input_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        CritiqueInput(
            schemaVersion="1.0.0",
            critiqueId="crit-2",
            targetRef="card:c2",
            critiqueType="too_far",
            createdAt=_now(),
            iteration=2,
            unexpectedField="not-allowed",
        )


def test_reproposal_diff_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        ReproposalDiff(
            schemaVersion="1.0.0",
            proposalId="p2",
            basedOnIteration=2,
            traceKey="crit-2:p2",
            diffOps=[
                {
                    "opId": "op-2",
                    "opType": "add",
                    "targetRef": "card:c2",
                    "after": {"x": 10, "y": 20},
                }
            ],
            unexpectedField="not-allowed",
        )


def test_review_attribution_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        ReviewAttribution(
            schemaVersion="1.0.0",
            reviewState="unreviewed",
            auditRecordedAt=_now(),
            unexpectedField="not-allowed",
        )


def test_critique_input_rejects_unknown_target_ref_kind() -> None:
    with pytest.raises(ValidationError):
        CritiqueInput(
            schemaVersion="1.0.0",
            critiqueId="crit-3",
            targetRef="topic:i1",
            critiqueType="feels_off",
            createdAt=_now(),
            iteration=1,
        )


def test_critique_input_accepts_island_target_ref_kind() -> None:
    validated = CritiqueInput(
        schemaVersion="1.0.0",
        critiqueId="crit-4",
        targetRef="island:i1",
        critiqueType="feels_off",
        createdAt=_now(),
        iteration=1,
    )
    assert validated.targetRef == "island:i1"


def test_reproposal_diff_allows_one_sided_reversible_add_remove_ops() -> None:
    validated = ReproposalDiff(
        schemaVersion="1.0.0",
        proposalId="p3",
        basedOnIteration=1,
        traceKey="crit-3:p3",
        diffOps=[
            {
                "opId": "op-add",
                "opType": "add",
                "targetRef": "card:c3",
                "before": None,
                "after": {"id": "c3", "text": "gamma"},
            },
            {
                "opId": "op-remove",
                "opType": "remove",
                "targetRef": "card:c2",
                "before": {"id": "c2", "text": "beta"},
                "after": None,
            },
        ],
    )
    assert validated.diffOps[0].before is None
    assert validated.diffOps[1].after is None


def test_review_attribution_rejects_email_like_reviewer_ref() -> None:
    with pytest.raises(ValidationError):
        ReviewAttribution(
            schemaVersion="1.0.0",
            reviewState="human_reviewed",
            reviewedAt=_now(),
            reviewerRef="alice@example.com",
            auditRecordedAt=_now(),
        )

def test_review_attribution_defaults_override_policy() -> None:
    validated = ReviewAttribution(
        schemaVersion="1.0.0",
        reviewState="unreviewed",
        reviewedAt=None,
        reviewerRef="user:u-1",
        auditRecordedAt=_now(),
    )
    assert validated.overridePolicy == "human_dual_control_only"


def test_review_attribution_rejects_email_like_owner_ref() -> None:
    with pytest.raises(ValidationError):
        ReviewAttribution(
            schemaVersion="1.0.0",
            reviewState="human_reviewed",
            reviewedAt=_now(),
            reviewerRef="user:u-1",
            ownerRef="owner@example.com",
            auditRecordedAt=_now(),
        )



def test_deterministic_tie_break_defaults_to_fixed_order() -> None:
    from sui_sensemaking_api.models import DeterministicTieBreak

    validated = DeterministicTieBreak(schemaVersion="1.0.0")
    assert validated.order == (
        "padding_compliance",
        "self_intersection_avoidance",
        "minimum_area_delta",
        "minimum_vertex_count",
    )


def test_deterministic_tie_break_rejects_reordered_values() -> None:
    from sui_sensemaking_api.models import DeterministicTieBreak

    with pytest.raises(ValidationError):
        DeterministicTieBreak(
            schemaVersion="1.0.0",
            order=(
                "self_intersection_avoidance",
                "padding_compliance",
                "minimum_area_delta",
                "minimum_vertex_count",
            ),
        )
