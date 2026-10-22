import { describe, expect, it } from "vitest";

import {
  buildEpistemicDetailPresentation,
  type EpistemicDetailOutcome,
} from "./epistemic_detail_presentation";
import {
  buildEpistemicUiItems,
  resolveEpistemicDetailForInspection,
  type EpistemicDetailInspection,
  type EpistemicProjectionInput,
  type EpistemicUiItem,
  type TeiEpistemicDetailResult,
} from "./epistemic_review_model";

// Fixtures mirror `epistemic_review_model.test.ts`; the detail drift must stay
// consistent with `expectedDetailDrift` or the consumer model fails closed.
function assessmentInput() {
  return {
    assertionId: "user-premise",
    meaningFingerprint:
      "sha256:0101010101010101010101010101010101010101010101010101010101010101",
    reviewSubjectFingerprint:
      "sha256:1515151515151515151515151515151515151515151515151515151515151515",
    reviewLogSequence: 0,
    contentOrigin: "user",
    metadataState: "complete",
    statementKind: "requirement",
    confirmationState: "unreviewed",
    targetBinding: "not-required",
    contextCompatibility: "compatible",
    freshness: "unknown",
    lifecycleState: "active",
    conflict: "none",
    useState: "premise",
  } as const;
}

function projection(): EpistemicProjectionInput {
  return {
    contract: "tei.epistemic-projection/v0",
    schema: "tei.reference.epistemic-assessment/v0",
    assessments: [assessmentInput()],
    health: {
      level: "normal",
      viewMetadataState: "complete",
      coverage: { areas: [] },
    },
    reviewRequests: [],
    authorityLimits: [
      "assessment-does-not-assert-objective-truth",
      "content-fingerprint-does-not-restore-review-history",
      "meaning-fingerprint-is-input-not-semantic-proof",
      "assessment-does-not-grant-write-or-runtime-authority",
      "assessment-does-not-grant-canonical-acceptance",
      "target-anchor-resolution-does-not-prove-semantic-identity",
      "coverage-mapping-is-input-not-semantic-completeness-proof",
      "resolution-coverage-is-operational-readiness-not-truth-ratio",
      "partial-transport-health-is-not-project-wide-health",
      "review-history-is-bounded-by-context-as-of",
      "review-binding-includes-context-kind-and-target-identity",
      "review-binding-includes-validity-window",
      "checked-at-is-bound-to-current-subject",
      "reviewer-candidate-is-not-review-authority",
    ],
  };
}

function observedItem(): EpistemicUiItem {
  const items = buildEpistemicUiItems(projection());
  const item = items.find((value) => value.assertionId === "user-premise");
  if (!item) {
    throw new Error("fixture item missing");
  }
  return item;
}

function detailResultFor(
  item: EpistemicUiItem,
  overrides: Partial<TeiEpistemicDetailResult["assessment"]> = {},
): TeiEpistemicDetailResult {
  const current = assessmentInput();
  const assessment = { ...current, ...overrides };
  const metadataAware = (
    equal: boolean,
  ): "same" | "changed" | "indeterminate" => {
    if (equal) return "same";
    if (
      item.metadataState === "complete" &&
      assessment.metadataState === "complete"
    ) {
      return "changed";
    }
    return "indeterminate";
  };
  return {
    contract: "tei.epistemic-detail/v0",
    schema: "tei.reference.epistemic-detail/v0",
    assessment,
    drift: {
      meaning:
        assessment.meaningFingerprint === item.meaningFingerprint
          ? "same"
          : "changed",
      subject: metadataAware(
        assessment.reviewSubjectFingerprint === item.reviewSubjectFingerprint,
      ),
      reviewHistory: metadataAware(
        assessment.reviewLogSequence === item.reviewLogSequence,
      ),
      targetBinding:
        assessment.targetBinding === item.targetBinding ? "same" : "changed",
    },
    content: {
      text: "resolved detail",
    },
    contentRole: "epistemic-data",
    controlAuthority: false,
    authorityLimits: [
      "detail-access-context-is-not-part-of-semantic-query",
      "detail-access-refs-are-opaque-input-not-authorization-authority",
      "detail-query-does-not-broaden-source-access",
      "detail-observed-receipts-report-drift-not-mutation-preconditions",
      "detail-drift-indeterminate-does-not-prove-semantic-change",
      "detail-query-is-bounded-by-context-as-of",
      "detail-result-does-not-change-confirmation-or-use-state",
      "detail-result-does-not-assert-objective-truth",
      "detail-result-does-not-grant-canonical-acceptance",
      "detail-result-omits-access-refs",
      "detail-content-is-data-not-prompt-control-authority",
    ],
  };
}

function resolvedInspection(
  item: EpistemicUiItem,
  result: TeiEpistemicDetailResult,
): EpistemicDetailInspection {
  return resolveEpistemicDetailForInspection(item, result);
}

describe("buildEpistemicDetailPresentation", () => {
  it("presents a current detail as readable with reusable actions", () => {
    const item = observedItem();
    const inspection = resolvedInspection(item, detailResultFor(item));

    const presentation = buildEpistemicDetailPresentation({
      ok: true,
      inspection,
    });

    expect(presentation.statusKey).toBe("epistemic.detail.status.current");
    expect(presentation.unavailable).toBe(false);
    expect(presentation.readable).toBe(true);
    expect(presentation.projectionRefreshRequired).toBe(false);
    expect(presentation.actionReuseAllowed).toBe(true);
    expect(presentation.reusableActionCount).toBe(
      inspection.reusableActions.length,
    );
    expect(presentation.driftIndeterminate).toBe(false);
    expect(presentation.driftChanged).toBe(false);
  });

  it("presents a contradicted detail as refresh required without reusing actions", () => {
    const item = observedItem();
    const inspection = resolvedInspection(
      item,
      detailResultFor(item, {
        meaningFingerprint:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      }),
    );

    const presentation = buildEpistemicDetailPresentation({
      ok: true,
      inspection,
    });

    expect(presentation.statusKey).toBe(
      "epistemic.detail.status.refresh_required_changed",
    );
    expect(presentation.readable).toBe(true);
    expect(presentation.projectionRefreshRequired).toBe(true);
    expect(presentation.actionReuseAllowed).toBe(false);
    expect(presentation.reusableActionCount).toBe(0);
    expect(presentation.driftChanged).toBe(true);
    expect(presentation.driftIndeterminate).toBe(false);
  });

  it("presents drift indeterminate without reading it as a semantic change", () => {
    const item = observedItem();
    // Model fixture pattern: partial metadata across the reference makes the
    // subject/review-history receipts indeterminate instead of "changed".
    const inspection = resolvedInspection(
      item,
      detailResultFor(item, {
        metadataState: "partial",
        reviewSubjectFingerprint:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        reviewLogSequence: 1,
      }),
    );

    const presentation = buildEpistemicDetailPresentation({
      ok: true,
      inspection,
    });

    expect(presentation.statusKey).toBe(
      "epistemic.detail.status.refresh_required_indeterminate",
    );
    expect(presentation.readable).toBe(true);
    expect(presentation.projectionRefreshRequired).toBe(true);
    expect(presentation.actionReuseAllowed).toBe(false);
    expect(presentation.driftIndeterminate).toBe(true);
    expect(presentation.driftChanged).toBe(false);
  });

  it("presents a fail-closed detail as unavailable and never exposes content", () => {
    const rejected = buildEpistemicDetailPresentation({
      ok: false,
      unavailableReason: "rejected",
    });
    expect(rejected.statusKey).toBe(
      "epistemic.detail.status.unavailable_rejected",
    );
    expect(rejected.unavailable).toBe(true);
    expect(rejected.readable).toBe(false);
    expect(rejected.actionReuseAllowed).toBe(false);
    expect(rejected.reusableActionCount).toBe(0);

    const providerOutage = buildEpistemicDetailPresentation({
      ok: false,
      unavailableReason: "provider-unavailable",
    });
    expect(providerOutage.statusKey).toBe(
      "epistemic.detail.status.unavailable_provider",
    );
    expect(providerOutage.unavailable).toBe(true);
    expect(providerOutage.readable).toBe(false);
  });

  it("keeps a tampered detail result unrecoverable as rejected output", () => {
    const item = observedItem();
    const tampered = {
      ...detailResultFor(item),
      contract: "tei.epistemic-detail/v1",
    };
    let failedExpectedly = false;
    let outcome: EpistemicDetailOutcome = {
      ok: false,
      unavailableReason: "rejected",
    };
    try {
      resolvedInspection(item, tampered);
    } catch {
      failedExpectedly = true;
    }
    expect(failedExpectedly).toBe(true);

    const presentation = buildEpistemicDetailPresentation(outcome);
    expect(presentation.statusKey).toBe(
      "epistemic.detail.status.unavailable_rejected",
    );
    expect(presentation.readable).toBe(false);
    // The presentation type carries no content field for unsuccessful
    // outcomes; the unreachable inspection object stays out of the display.
    expect(Object.keys(presentation)).not.toContain("content");
  });
});
