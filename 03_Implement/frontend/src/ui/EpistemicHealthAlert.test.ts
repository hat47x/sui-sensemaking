import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setActiveLocale } from "../i18n/translate";
import type { EpistemicProjectionInput } from "./epistemic_review_model";
import { EpistemicHealthAlert } from "./EpistemicHealthAlert";

const authorityLimits = [
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
  "reviewer-candidate-is-not-review-authority",
];

function projection(): EpistemicProjectionInput {
  return {
    contract: "tei.epistemic-projection/v0",
    schema: "tei.reference.epistemic-assessment/v0",
    assessments: [
      {
        assertionId: "ai-candidate",
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
        reasons: ["ASSERTION_UNREVIEWED"],
      },
    ],
    health: {
      level: "attention",
      viewMetadataState: "complete",
      resolutionCoverage: {
        eligible: 4,
        resolved: 3,
        confirmed: 1,
        nativePremise: 2,
        rejected: 0,
        unresolved: 1,
        ratio: 0.75,
        minimumRatio: 0.8,
        minimumEligibleAssertions: 4,
        requiredResolutions: 1,
        state: "attention",
        reasons: ["PROJECT_RESOLUTION_RATIO_BELOW_POLICY"],
      },
      coverage: { areas: [] },
    },
    reviewRequests: [
      {
        assertionId: "ai-candidate",
        targetBinding: "not-required",
        reasons: ["PROJECT_RESOLUTION_RATIO_BELOW_POLICY"],
        downstreamImpact: ["release decision (high)"],
        reviewerCandidates: ["release-owner"],
      },
    ],
    authorityLimits,
  };
}

describe("EpistemicHealthAlert", () => {
  beforeEach(() => {
    setActiveLocale("ja");
  });

  it("shows low resolution coverage and a stakeholder review path", () => {
    const html = renderToStaticMarkup(
      createElement(EpistemicHealthAlert, {
        projection: projection(),
        onOpenReview: vi.fn(),
      }),
    );
    expect(html).toContain("75%");
    expect(html).toContain("80%");
    expect(html).toContain("追加確認の目安: 1件");
    expect(html).toContain("release-owner");
    expect(html).toContain("release decision (high)");
    expect(html).toContain("確認する");
    expect(html).toContain("承認権限を意味しません");
    expect(html).toContain("真偽の割合ではありません");
  });

  it("supports the shared English locale", () => {
    setActiveLocale("en");
    const html = renderToStaticMarkup(createElement(EpistemicHealthAlert, {
      projection: projection(),
    }));
    expect(html).toContain("75%");
    expect(html).toContain("80%");
    expect(html).toContain("Suggested additional reviews: 1");
    expect(html).toContain("Reviewer candidates: release-owner");
    expect(html).toContain("not a truth ratio");
  });

  it("does not present an unknown resolution ratio as a determinate percentage", () => {
    const input = projection();
    input.health.viewMetadataState = "partial";
    input.health.resolutionCoverage = {
      eligible: 4,
      resolved: 3,
      confirmed: 1,
      nativePremise: 2,
      rejected: 0,
      unresolved: 1,
      ratio: 0.75,
      minimumRatio: 0.8,
      minimumEligibleAssertions: 4,
      state: "unknown",
      reasons: ["RESOLUTION_COVERAGE_METADATA_INCOMPLETE"],
    };
    const html = renderToStaticMarkup(createElement(EpistemicHealthAlert, { projection: input }));
    expect(html).toContain("確定状態の比率は判定できません");
    expect(html).not.toContain("75%");
    expect(html).not.toContain("80%");
  });

  it("does not present an insufficient sample as a health ratio decision", () => {
    const input = projection();
    input.health.resolutionCoverage = {
      eligible: 2,
      resolved: 1,
      confirmed: 0,
      nativePremise: 1,
      rejected: 0,
      unresolved: 1,
      ratio: 0.5,
      minimumRatio: 0.8,
      minimumEligibleAssertions: 4,
      state: "insufficient-sample",
      reasons: ["RESOLUTION_COVERAGE_SAMPLE_TOO_SMALL"],
    };
    const html = renderToStaticMarkup(createElement(EpistemicHealthAlert, { projection: input }));
    expect(html).toContain("サンプルが少ないため比率で判定しません");
    expect(html).not.toContain("50%");
    expect(html).not.toContain("80%");
  });

  it("renders nothing for normal health with no review queue", () => {
    const input = projection();
    input.health.level = "healthy";
    input.health.resolutionCoverage = {
      eligible: 4,
      resolved: 4,
      confirmed: 2,
      nativePremise: 2,
      rejected: 0,
      unresolved: 0,
      ratio: 1,
      minimumRatio: 0.8,
      minimumEligibleAssertions: 4,
      state: "healthy",
    };
    input.reviewRequests = [];
    const html = renderToStaticMarkup(createElement(EpistemicHealthAlert, { projection: input }));
    expect(html).toBe("");
  });
});
