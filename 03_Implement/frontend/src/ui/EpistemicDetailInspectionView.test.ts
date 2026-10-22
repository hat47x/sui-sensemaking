import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { EpistemicDetailInspectionView } from "./EpistemicDetailInspectionView";
import {
  buildEpistemicUiItems,
  resolveEpistemicDetailForInspection,
  type EpistemicDetailInspection,
  type EpistemicProjectionInput,
  type EpistemicUiItem,
  type TeiEpistemicDetailResult,
} from "./epistemic_review_model";
import type { EpistemicDetailOutcome } from "./epistemic_detail_presentation";
import { setActiveLocale } from "../i18n/translate";

// Fixtures mirror `epistemic_detail_presentation.test.ts` so the display
// contract is fixed against the same outcomes the consumer model accepts.
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

function outcomeFor(
  item: EpistemicUiItem,
  result: TeiEpistemicDetailResult,
): { ok: true; inspection: EpistemicDetailInspection } {
  return {
    ok: true,
    inspection: resolveEpistemicDetailForInspection(item, result),
  };
}

describe("EpistemicDetailInspectionView", () => {
  beforeEach(() => {
    setActiveLocale("ja");
  });

  it("shows a current detail as matching with reusable actions", () => {
    const item = observedItem();
    const html = renderToStaticMarkup(
      createElement(EpistemicDetailInspectionView, {
        outcome: outcomeFor(item, detailResultFor(item)),
      }),
    );

    expect(html).toContain("詳細は現在の見立てと一致しています");
    expect(html).toContain("再利用できます");
    expect(html).toContain("判断の承認や操作の権限を持ちません");
    expect(html).toContain('aria-label="詳細参照の表示"');
  });

  it("shows a changed detail as refresh required without reusing actions", () => {
    const item = observedItem();
    const html = renderToStaticMarkup(
      createElement(EpistemicDetailInspectionView, {
        outcome: outcomeFor(
          item,
          detailResultFor(item, {
            meaningFingerprint:
              "sha256:2222222222222222222222222222222222222222222222222222222222222222",
          }),
        ),
      }),
    );

    expect(html).toContain("投影が変化しています");
    expect(html).toContain("再利用は止めています");
  });

  it("shows an indeterminate detail without claiming a semantic change", () => {
    const item = observedItem();
    const html = renderToStaticMarkup(
      createElement(EpistemicDetailInspectionView, {
        outcome: outcomeFor(
          item,
          detailResultFor(item, {
            metadataState: "partial",
            reviewSubjectFingerprint:
              "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            reviewLogSequence: 1,
          }),
        ),
      }),
    );

    expect(html).toContain("確認できません（indeterminate）");
    expect(html).toContain("変化と断定せず");
    expect(html).toContain("再利用は止めています");
  });

  it("shows fail-closed outcomes without any detail content", () => {
    const rejected = renderToStaticMarkup(
      createElement(EpistemicDetailInspectionView, {
        outcome: {
          ok: false,
          unavailableReason: "rejected",
        } satisfies EpistemicDetailOutcome,
      }),
    );
    expect(rejected).toContain("安全条件を満たさない");
    expect(rejected).toContain("部分的にも表示しません");
    expect(rejected).not.toContain("resolved detail");

    const outage = renderToStaticMarkup(
      createElement(EpistemicDetailInspectionView, {
        outcome: {
          ok: false,
          unavailableReason: "provider-unavailable",
        } satisfies EpistemicDetailOutcome,
      }),
    );
    expect(outage).toContain("取得元を利用できない");
    expect(outage).not.toContain("resolved detail");
  });
});
