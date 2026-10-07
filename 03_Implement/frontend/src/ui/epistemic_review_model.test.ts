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
      expectedTargetBinding: "not-required",
    });
    expect(input).toEqual(original);
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
