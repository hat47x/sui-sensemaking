import { describe, expect, it } from "vitest";

import {
  buildBulkConfirmIntents,
  buildEpistemicHealthPresentation,
  buildEpistemicReviewIntent,
  buildEpistemicReviewQueue,
  buildEpistemicUiItems,
  type EpistemicProjectionInput,
} from "./epistemic_review_model";

function projection(): EpistemicProjectionInput {
  return {
    contract: "tei.epistemic-projection/v0",
    schema: "tei.reference.epistemic-assessment/v0",
    assessments: [
      {
        assertionId: "user-premise",
        meaningFingerprint: "sha256:0101010101010101010101010101010101010101010101010101010101010101",
        reviewSubjectFingerprint: "sha256:1515151515151515151515151515151515151515151515151515151515151515",
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
      },
      {
        assertionId: "ai-candidate",
        meaningFingerprint: "sha256:0202020202020202020202020202020202020202020202020202020202020202",
        reviewSubjectFingerprint: "sha256:1616161616161616161616161616161616161616161616161616161616161616",
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
      },
      {
        assertionId: "confirmed",
        meaningFingerprint: "sha256:0303030303030303030303030303030303030303030303030303030303030303",
        reviewSubjectFingerprint: "sha256:1717171717171717171717171717171717171717171717171717171717171717",
        reviewLogSequence: 1,
        contentOrigin: "external",
        metadataState: "complete",
        statementKind: "fact",
        confirmationState: "confirmed",
        targetBinding: "exact",
        contextCompatibility: "compatible",
        freshness: "current",
        lifecycleState: "active",
        conflict: "none",
        useState: "premise",
      },
      {
        assertionId: "confirmed-hypothesis",
        meaningFingerprint: "sha256:0404040404040404040404040404040404040404040404040404040404040404",
        reviewSubjectFingerprint: "sha256:1818181818181818181818181818181818181818181818181818181818181818",
        reviewLogSequence: 1,
        contentOrigin: "user",
        metadataState: "complete",
        statementKind: "hypothesis",
        confirmationState: "confirmed",
        targetBinding: "exact",
        contextCompatibility: "compatible",
        freshness: "current",
        lifecycleState: "active",
        conflict: "none",
        useState: "candidate-only",
      },
      {
        assertionId: "reanchored",
        meaningFingerprint: "sha256:0505050505050505050505050505050505050505050505050505050505050505",
        reviewSubjectFingerprint: "sha256:1919191919191919191919191919191919191919191919191919191919191919",
        reviewLogSequence: 0,
        contentOrigin: "user",
        metadataState: "complete",
        statementKind: "decision",
        confirmationState: "unreviewed",
        targetBinding: "reanchored",
        contextCompatibility: "compatible",
        freshness: "unknown",
        lifecycleState: "active",
        conflict: "none",
        useState: "premise",
      },
      {
        assertionId: "ambiguous",
        meaningFingerprint: "sha256:0606060606060606060606060606060606060606060606060606060606060606",
        reviewSubjectFingerprint: "sha256:1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a",
        reviewLogSequence: 0,
        contentOrigin: "ai",
        metadataState: "complete",
        statementKind: "fact",
        confirmationState: "unreviewed",
        targetBinding: "ambiguous",
        contextCompatibility: "compatible",
        freshness: "unknown",
        lifecycleState: "active",
        conflict: "none",
        useState: "review-required",
        reasons: ["TARGET_ANCHOR_AMBIGUOUS"],
      },
      {
        assertionId: "partial",
        meaningFingerprint: "sha256:0707070707070707070707070707070707070707070707070707070707070707",
        reviewSubjectFingerprint: "sha256:1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b",
        reviewLogSequence: 1,
        contentOrigin: "external",
        metadataState: "partial",
        statementKind: "fact",
        confirmationState: "confirmed",
        targetBinding: "exact",
        contextCompatibility: "compatible",
        freshness: "current",
        lifecycleState: "active",
        conflict: "none",
        useState: "review-required",
        reasons: ["EPISTEMIC_METADATA_INCOMPLETE"],
      },
      {
        assertionId: "conflict",
        meaningFingerprint: "sha256:0808080808080808080808080808080808080808080808080808080808080808",
        reviewSubjectFingerprint: "sha256:1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c",
        reviewLogSequence: 1,
        contentOrigin: "external",
        metadataState: "complete",
        statementKind: "fact",
        confirmationState: "confirmed",
        targetBinding: "exact",
        contextCompatibility: "compatible",
        freshness: "current",
        lifecycleState: "active",
        conflict: "present",
        useState: "review-required",
        reasons: ["CONFLICT_PRESENT"],
      },
    ],
    health: {
      level: "attention",
      viewMetadataState: "complete",
      coverage: {
        areas: [
          {
            areaId: "release-assumptions",
            criticality: "critical",
            state: "gap",
            reasons: ["COVERAGE_UNMAPPED"],
          },
        ],
      },
    },
    reviewRequests: [
      {
        assertionId: "conflict",
        targetBinding: "exact",
        reasons: ["CONFLICT_PRESENT"],
        downstreamImpact: ["release decision (critical)"],
        reviewerCandidates: ["design-owner"],
      },
    ],
    authorityLimits: [
      "assessment-does-not-assert-objective-truth",
      "target-anchor-resolution-does-not-prove-semantic-identity",
      "coverage-mapping-is-input-not-semantic-completeness-proof",
      "partial-transport-health-is-not-project-wide-health",
      "review-history-is-bounded-by-context-as-of",
      "reviewer-candidate-is-not-review-authority",
    ],
  };
}

describe("epistemic review UI model", () => {
  it("shows direct user input as a working premise, not as human-confirmed", () => {
    const item = buildEpistemicUiItems(projection()).find((value) => value.assertionId === "user-premise");
    expect(item).toMatchObject({
      state: "working-premise",
      label: "作業前提",
      confirmationState: "unreviewed",
      confirmationLabel: "未確認",
    });
    expect(item?.actions).toContain("confirm");
  });

  it("keeps AI-generated unreviewed information visually unreviewed", () => {
    const item = buildEpistemicUiItems(projection()).find((value) => value.assertionId === "ai-candidate");
    expect(item).toMatchObject({
      state: "candidate",
      label: "候補",
      confirmationState: "unreviewed",
      confirmationLabel: "未確認",
    });
    expect(item?.actions).toContain("confirm");
    expect(item?.actions).toContain("mark-hypothesis");
  });

  it("keeps confirmation separate from candidate use state", () => {
    const item = buildEpistemicUiItems(projection()).find((value) => value.assertionId === "confirmed-hypothesis");
    expect(item).toMatchObject({
      state: "candidate",
      label: "候補",
      confirmationState: "confirmed",
      confirmationLabel: "確認済み",
    });
    expect(item?.actions).not.toContain("confirm");
    expect(item?.actions).toContain("reject");
  });

  it("does not claim reanchoring proves semantic identity", () => {
    const item = buildEpistemicUiItems(projection()).find((value) => value.assertionId === "reanchored");
    expect(item).toMatchObject({
      state: "working-premise",
      targetReanchored: true,
      detailsRecommended: true,
    });
  });

  it("requires target resolution before ambiguous target can be confirmed", () => {
    const item = buildEpistemicUiItems(projection()).find((value) => value.assertionId === "ambiguous");
    expect(item).toMatchObject({
      state: "target-ambiguous",
      label: "対象を確認",
    });
    expect(item?.actions).toContain("resolve-target");
    expect(item?.actions).not.toContain("confirm");
  });

  it("does not show partial confirmed metadata as confirmed", () => {
    const item = buildEpistemicUiItems(projection()).find((value) => value.assertionId === "partial");
    expect(item).toMatchObject({
      state: "metadata-incomplete",
      label: "情報不足",
    });
    expect(item?.actions).toContain("request-access");
    expect(item?.actions).not.toContain("confirm");
  });

  it("keeps conflict in review and does not offer one-click confirmation", () => {
    const item = buildEpistemicUiItems(projection()).find((value) => value.assertionId === "conflict");
    expect(item).toMatchObject({ state: "review-required" });
    expect(item?.actions).not.toContain("confirm");
  });

  it("creates human review intent without mutating the projection", () => {
    const input = projection();
    const original = structuredClone(input);
    const item = buildEpistemicUiItems(input).find((value) => value.assertionId === "ai-candidate");
    if (!item) throw new Error("fixture item missing");
    expect(buildEpistemicReviewIntent(item, "confirm")).toEqual({
      assertionId: "ai-candidate",
      operation: "confirm",
      source: "human-ui",
      expectedMeaningFingerprint: item.meaningFingerprint,
      expectedReviewSubjectFingerprint: item.reviewSubjectFingerprint,
      expectedTargetBinding: "not-required",
      expectedReviewLogSequence: 0,
    });
    expect(input).toEqual(original);
  });

  it("carries optimistic review preconditions into human intent", () => {
    const item = buildEpistemicUiItems(projection()).find((value) => value.assertionId === "confirmed");
    if (!item) throw new Error("fixture item missing");
    const intent = buildEpistemicReviewIntent(item, "reject");
    expect(intent.expectedMeaningFingerprint).toBe(item.meaningFingerprint);
    expect(intent.expectedReviewSubjectFingerprint).toBe(item.reviewSubjectFingerprint);
    expect(intent.expectedReviewLogSequence).toBe(1);
    expect(intent.expectedTargetBinding).toBe("exact");
  });

  it("fails closed for mixed bulk confirmation instead of over-approving eligible subset", () => {
    const items = buildEpistemicUiItems(projection()).filter((value) =>
      ["user-premise", "ai-candidate", "ambiguous"].includes(value.assertionId)
    );
    const result = buildBulkConfirmIntents(items);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.blocked.map((value) => value.assertionId)).toEqual(["ambiguous"]);
  });

  it("allows bulk confirmation only when every selected item is eligible", () => {
    const items = buildEpistemicUiItems(projection()).filter((value) =>
      ["user-premise", "ai-candidate"].includes(value.assertionId)
    );
    const result = buildBulkConfirmIntents(items);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.intents.map((value) => value.assertionId).sort()).toEqual([
      "ai-candidate",
      "user-premise",
    ]);
  });

  it("keeps reviewer candidate separate from authority and preserves impact", () => {
    const queue = buildEpistemicReviewQueue(projection());
    const review = queue.find((value) => value.kind === "assertion-review");
    expect(review).toMatchObject({
      kind: "assertion-review",
      assertionId: "conflict",
      reviewerCandidateIsAuthority: false,
    });
    if (!review || review.kind !== "assertion-review") return;
    expect(review.downstreamImpact).toEqual(["release decision (critical)"]);
    expect(review.reviewerCandidates).toEqual(["design-owner"]);
  });

  it("places critical coverage gaps in the review queue without calling them assertions", () => {
    const queue = buildEpistemicReviewQueue(projection());
    expect(queue).toContainEqual({
      kind: "coverage-gap",
      id: "coverage:release-assumptions",
      areaId: "release-assumptions",
      criticality: "critical",
      reasons: ["COVERAGE_UNMAPPED"],
      reviewerCandidateIsAuthority: false,
    });
  });

  it("never claims project-wide health for a partial transport view", () => {
    const input = projection();
    input.health.level = "healthy";
    input.health.viewMetadataState = "partial";
    input.health.coverage = { areas: [] };
    expect(buildEpistemicHealthPresentation(input)).toMatchObject({
      scope: "partial-view",
      mayClaimProjectHealthy: false,
      severity: "attention",
    });
  });

  it("rejects invalid meaning binding receipts", () => {
    const invalidFingerprint = projection();
    invalidFingerprint.assessments[0].meaningFingerprint = "sha256:not-a-digest";
    expect(() => buildEpistemicUiItems(invalidFingerprint)).toThrow(/invalid meaningFingerprint/);

    const invalidSubject = projection();
    invalidSubject.assessments[0].reviewSubjectFingerprint = "sha256:not-a-digest";
    expect(() => buildEpistemicUiItems(invalidSubject)).toThrow(/invalid reviewSubjectFingerprint/);

    const invalidSequence = projection();
    invalidSequence.assessments[0].reviewLogSequence = -1;
    expect(() => buildEpistemicUiItems(invalidSequence)).toThrow(/invalid reviewLogSequence/);
  });

  it("rejects unknown runtime enum values instead of silently making them confirmable", () => {
    const input = projection();
    (input.assessments[0] as unknown as { useState: string }).useState = "future-premise";
    expect(() => buildEpistemicUiItems(input)).toThrow(/unsupported useState/);
  });

  it("requires authority stop-lines from the TEI projection", () => {
    const input = projection();
    input.authorityLimits = input.authorityLimits?.filter(
      (value) => value !== "reviewer-candidate-is-not-review-authority",
    );
    expect(() => buildEpistemicReviewQueue(input)).toThrow(/missing epistemic authority limit/);
  });

  it("rejects unsupported semantic contract, schema, and duplicate assertion ids", () => {
    const unsupportedContract = projection();
    unsupportedContract.contract = "tei.epistemic-projection/v999";
    expect(() => buildEpistemicUiItems(unsupportedContract)).toThrow(/unsupported epistemic projection contract/);

    const unsupportedSchema = projection();
    unsupportedSchema.schema = "tei.reference.epistemic-assessment/v999";
    expect(() => buildEpistemicUiItems(unsupportedSchema)).toThrow(/unsupported epistemic projection schema/);

    const duplicate = projection();
    duplicate.assessments.push(structuredClone(duplicate.assessments[0]));
    expect(() => buildEpistemicUiItems(duplicate)).toThrow(/duplicate epistemic assertionId/);
  });
});
