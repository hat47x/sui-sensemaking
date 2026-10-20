import { describe, expect, it } from "vitest";
import {
  TeiEpistemicProjectionParseError,
  parseTeiEpistemicProjection,
} from "./epistemic_projection_adapter";
import {
  TEI_EPISTEMIC_PROJECTION_CONTRACT,
  TEI_EPISTEMIC_PROJECTION_SCHEMA,
} from "./epistemic_review_model";

function validProjection(): Record<string, unknown> {
  return {
    contract: TEI_EPISTEMIC_PROJECTION_CONTRACT,
    schema: TEI_EPISTEMIC_PROJECTION_SCHEMA,
    context: {
      schema: "tei.reference.epistemic-context/v0",
      bindings: [{ dimension: "project", value: "sui", provenance: "declared" }],
      asOf: "2026-10-21T00:00:00Z",
    },
    assessments: [
      {
        assertionId: "a1",
        meaningFingerprint: "sha256:1111",
        reviewSubjectFingerprint: "sha256:2222",
        contentOrigin: "ai",
        ingestedBy: "user",
        metadataState: "complete",
        statementKind: "hypothesis",
        confirmationState: "unreviewed",
        reviewBinding: "none",
        reviewEventCount: 0,
        reviewLogSequence: 0,
        targetBinding: "exact",
        contextCompatibility: "compatible",
        freshness: "current",
        lifecycleState: "active",
        conflict: "none",
        supersededBy: [],
        useState: "candidate-only",
        inferredContextUsed: false,
        reasons: ["AI_ORIGIN_UNREVIEWED"],
      },
    ],
    health: {
      level: "healthy",
      viewMetadataState: "complete",
      counts: { total: 1, premise: 0, candidateOnly: 1, reviewRequired: 0, blocked: 0 },
      resolutionCoverage: {
        eligible: 1,
        resolved: 0,
        confirmed: 0,
        nativePremise: 0,
        rejected: 0,
        unresolved: 1,
        ratio: 0,
        minimumRatio: 0.8,
        minimumEligibleAssertions: 1,
        requiredResolutions: 1,
        state: "attention",
        reasons: ["BELOW_MIN_RESOLVED_RATIO"],
      },
      issues: [],
      coverage: {
        counts: { mapped: 1, gap: 0 },
        areas: [
          { areaId: "area-1", criticality: "high", state: "mapped", reasons: [] },
        ],
      },
    },
    reviewRequests: [
      {
        assertionId: "a1",
        target: { kind: "design-claim", id: "target-1" },
        confirmationState: "unreviewed",
        reviewBinding: "none",
        targetBinding: "exact",
        reasons: ["AI_ORIGIN_UNREVIEWED"],
        downstreamImpact: ["release decision"],
        reviewerCandidates: ["release-owner"],
        authorityLimit: "reviewer-candidate-is-not-review-authority",
      },
    ],
    authorityLimits: ["assessment-does-not-grant-canonical-acceptance"],
    futureTeiField: { accepted: true },
  };
}

describe("parseTeiEpistemicProjection", () => {
  it("maps the TEI representation into the SUI consumer input", () => {
    const parsed = parseTeiEpistemicProjection(validProjection());

    expect(parsed.contract).toBe(TEI_EPISTEMIC_PROJECTION_CONTRACT);
    expect(parsed.schema).toBe(TEI_EPISTEMIC_PROJECTION_SCHEMA);
    expect(parsed.assessments[0]).toMatchObject({
      assertionId: "a1",
      contentOrigin: "ai",
      ingestedBy: "user",
      metadataState: "complete",
      targetBinding: "exact",
      useState: "candidate-only",
      reviewLogSequence: 0,
      inferredContextUsed: false,
    });
    expect(parsed.health.viewMetadataState).toBe("complete");
    expect(parsed.health.resolutionCoverage?.requiredResolutions).toBe(1);
    expect(parsed.health.coverage?.areas?.[0]).toMatchObject({
      areaId: "area-1",
      criticality: "high",
      state: "mapped",
    });
    expect(parsed.reviewRequests?.[0]).toMatchObject({
      assertionId: "a1",
      targetBinding: "exact",
      reviewerCandidates: ["release-owner"],
    });
    expect(parsed.authorityLimits).toEqual(["assessment-does-not-grant-canonical-acceptance"]);
  });

  it("validates semantic contract and representation schema independently", () => {
    const wrongContract = validProjection();
    wrongContract.contract = "tei.epistemic-projection/v1";
    expect(() => parseTeiEpistemicProjection(wrongContract)).toThrow(
      /contract: unsupported semantic contract/
    );

    const wrongSchema = validProjection();
    wrongSchema.schema = "tei.reference.epistemic-assessment/v1";
    expect(() => parseTeiEpistemicProjection(wrongSchema)).toThrow(
      /schema: unsupported representation schema/
    );
  });

  it("fails closed on duplicate assertion ids and unsupported state values", () => {
    const duplicate = validProjection();
    duplicate.assessments = [
      ...(duplicate.assessments as unknown[]),
      ...(duplicate.assessments as unknown[]),
    ];
    expect(() => parseTeiEpistemicProjection(duplicate)).toThrow(/duplicate assertion id: a1/);

    const badState = validProjection();
    (badState.assessments as Array<Record<string, unknown>>)[0].useState = "confirmed";
    expect(() => parseTeiEpistemicProjection(badState)).toThrow(/assessments\[0\]\.useState/);

    const badMetadata = validProjection();
    (badMetadata.assessments as Array<Record<string, unknown>>)[0].metadataState = "unknown";
    expect(() => parseTeiEpistemicProjection(badMetadata)).toThrow(/assessments\[0\]\.metadataState/);
  });

  it("fails closed on malformed health coverage and missing authority limits", () => {
    const badCoverage = validProjection();
    const health = badCoverage.health as Record<string, unknown>;
    (health.coverage as Record<string, unknown>).areas = [
      { areaId: "area-1", criticality: "urgent", state: "mapped" },
    ];
    expect(() => parseTeiEpistemicProjection(badCoverage)).toThrow(
      /health\.coverage\.areas\[0\]\.criticality/
    );

    const missingLimits = validProjection();
    delete missingLimits.authorityLimits;
    expect(() => parseTeiEpistemicProjection(missingLimits)).toThrow(/authorityLimits/);
  });

  it("accepts an empty assessment list and a partial health view", () => {
    const projection = validProjection();
    projection.assessments = [];
    (projection.health as Record<string, unknown>).viewMetadataState = "partial";
    delete (projection.health as Record<string, unknown>).resolutionCoverage;

    const parsed = parseTeiEpistemicProjection(projection);
    expect(parsed.assessments).toEqual([]);
    expect(parsed.health.viewMetadataState).toBe("partial");
    expect(parsed.health.resolutionCoverage).toBeUndefined();
  });

  it("throws a typed parse error that callers can distinguish", () => {
    expect(() => parseTeiEpistemicProjection({})).toThrow(TeiEpistemicProjectionParseError);
  });
});
