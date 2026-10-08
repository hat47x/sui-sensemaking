import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEpistemicUiItems,
  type EpistemicAssessmentInput,
  type EpistemicProjectionInput,
} from "./epistemic_review_model";
import { setActiveLocale } from "../i18n/translate";
import { EpistemicReviewStatus } from "./EpistemicReviewStatus";

const authorityLimits = [
  "assessment-does-not-assert-objective-truth",
  "target-anchor-resolution-does-not-prove-semantic-identity",
  "coverage-mapping-is-input-not-semantic-completeness-proof",
  "partial-transport-health-is-not-project-wide-health",
  "review-history-is-bounded-by-context-as-of",
  "review-binding-includes-context-kind-and-target-identity",
  "review-binding-includes-validity-window",
  "reviewer-candidate-is-not-review-authority",
];

function item(overrides: Partial<EpistemicAssessmentInput>) {
  const assessment: EpistemicAssessmentInput = {
    assertionId: "a1",
    meaningFingerprint: "sha256:" + "1".repeat(64),
    reviewSubjectFingerprint: "sha256:" + "2".repeat(64),
    reviewLogSequence: 0,
    contentOrigin: "ai",
    metadataState: "complete",
    statementKind: "fact",
    confirmationState: "unreviewed",
    targetBinding: "not-required",
    contextCompatibility: "compatible",
    freshness: "unknown",
    lifecycleState: "active",
    conflict: "none",
    useState: "candidate-only",
    ...overrides,
  };
  const projection: EpistemicProjectionInput = {
    contract: "tei.epistemic-projection/v0",
    schema: "tei.reference.epistemic-assessment/v0",
    assessments: [assessment],
    health: {
      level: "healthy",
      viewMetadataState: "complete",
      coverage: { areas: [] },
    },
    authorityLimits,
  };
  return buildEpistemicUiItems(projection)[0];
}

function render(overrides: Partial<EpistemicAssessmentInput>, compact = false): string {
  return renderToStaticMarkup(
    createElement(EpistemicReviewStatus, {
      item: item(overrides),
      onAction: vi.fn(),
      compact,
    }),
  );
}

describe("EpistemicReviewStatus", () => {
  beforeEach(() => {
    setActiveLocale("ja");
  });
  it("renders direct user premise and human confirmation as separate axes", () => {
    const html = render({
      contentOrigin: "user",
      statementKind: "requirement",
      useState: "premise",
    });
    expect(html).toContain("作業前提");
    expect(html).toContain("未確認");
    expect(html).toContain(">確認<");
  });

  it("renders a confirmed hypothesis as candidate plus confirmed", () => {
    const html = render({
      statementKind: "hypothesis",
      confirmationState: "confirmed",
      useState: "candidate-only",
      reviewLogSequence: 1,
    });
    expect(html).toContain("候補");
    expect(html).toContain("確認済み");
    expect(html).toContain("確認を撤回");
    expect(html).not.toContain(">確認<");
  });

  it("never renders partial confirmation metadata as confirmed", () => {
    const html = render({
      metadataState: "partial",
      confirmationState: "confirmed",
      useState: "review-required",
    });
    expect(html).toContain("情報不足");
    expect(html).toContain("確認状態不明");
    expect(html).not.toContain(">確認済み<");
  });

  it("makes ambiguous targets visibly resolvable instead of confirmable", () => {
    const html = render({
      targetBinding: "ambiguous",
      useState: "review-required",
      reasons: ["TARGET_ANCHOR_AMBIGUOUS"],
    });
    expect(html).toContain("対象を確認");
    expect(html).toContain("対象を選び直す");
    expect(html).not.toContain(">確認<");
  });

  it("keeps compact mode to the four fast review actions", () => {
    const html = render({}, true);
    expect(html).toContain(">確認<");
    expect(html).toContain(">仮説<");
    expect(html).toContain(">否定<");
    expect(html).not.toContain("詳細");
    expect(html).not.toContain("確認を依頼");
  });

  it("renders English copy through the shared catalog", () => {
    setActiveLocale("en");
    const html = render({
      contentOrigin: "user",
      statementKind: "requirement",
      useState: "premise",
    });
    expect(html).toContain("Working premise");
    expect(html).toContain("Unreviewed");
    expect(html).toContain(">Confirm<");
  });

  it("exposes an accessible group label", () => {
    const html = render({});
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="認識状態: a1"');
  });
});
