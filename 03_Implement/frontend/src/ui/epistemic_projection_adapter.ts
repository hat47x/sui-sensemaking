import {
  TEI_EPISTEMIC_PROJECTION_CONTRACT,
  TEI_EPISTEMIC_PROJECTION_SCHEMA,
} from "./epistemic_review_model";
import type {
  EpistemicAssessmentInput,
  EpistemicContextCompatibility,
  EpistemicCoverageAreaInput,
  EpistemicConflict,
  EpistemicFreshness,
  EpistemicMetadataState,
  EpistemicProjectionInput,
  EpistemicResolutionCoverageInput,
  EpistemicReviewRequestInput,
  EpistemicTargetBinding,
  EpistemicUseState,
} from "./epistemic_review_model";

/**
 * Adapter from the TEI reference representation
 * (`tei.reference.epistemic-assessment/v0`) to the SUI consumer view-model
 * input. The semantic contract and representation schema are validated
 * independently and the function fails closed on unsupported values; it never
 * infers a missing signal or grants review authority.
 */
export class TeiEpistemicProjectionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeiEpistemicProjectionParseError";
  }
}

const METADATA_STATES = new Set<EpistemicMetadataState>(["complete", "partial", "absent"]);
const TARGET_BINDINGS = new Set<EpistemicTargetBinding>([
  "not-required",
  "exact",
  "reanchored",
  "ambiguous",
  "detached",
]);
const CONTEXT_COMPATIBILITIES = new Set<EpistemicContextCompatibility>([
  "compatible",
  "unknown",
  "incompatible",
]);
const FRESHNESS_STATES = new Set<EpistemicFreshness>(["current", "unknown", "stale", "not-yet-valid"]);
const CONFLICT_STATES = new Set<EpistemicConflict>(["none", "inactive", "present"]);
const USE_STATES = new Set<EpistemicUseState>(["premise", "candidate-only", "review-required", "blocked"]);
const COVERAGE_STATES = new Set<EpistemicResolutionCoverageInput["state"]>([
  "not-configured",
  "unknown",
  "insufficient-sample",
  "healthy",
  "attention",
]);
const COVERAGE_AREA_STATES = new Set<EpistemicCoverageAreaInput["state"]>(["mapped", "gap"]);
const CRITICALITIES = new Set(["low", "normal", "high", "critical"]);

function fail(path: string, detail: string): never {
  throw new TeiEpistemicProjectionParseError(`${path}: ${detail}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, "must be a non-empty string");
  }
  return value;
}

function readNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(path, "must be a finite number");
  }
  return value;
}

function readStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    fail(path, "must be an array of strings");
  }
  return [...value];
}

function readOptionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readStringArray(value, path);
}

function readEnum<T extends string>(value: unknown, allowed: Set<T>, path: string): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    fail(path, `unsupported value: ${String(value)}`);
  }
  return value as T;
}

function parseAssessment(value: unknown, index: number): EpistemicAssessmentInput {
  const path = `assessments[${index}]`;
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  const assessment: EpistemicAssessmentInput = {
    assertionId: readString(value.assertionId, `${path}.assertionId`),
    meaningFingerprint: readString(value.meaningFingerprint, `${path}.meaningFingerprint`),
    reviewSubjectFingerprint: readString(
      value.reviewSubjectFingerprint,
      `${path}.reviewSubjectFingerprint`
    ),
    reviewLogSequence: readNumber(value.reviewLogSequence, `${path}.reviewLogSequence`),
    contentOrigin: readString(value.contentOrigin, `${path}.contentOrigin`),
    metadataState: readEnum(value.metadataState, METADATA_STATES, `${path}.metadataState`),
    statementKind: readString(value.statementKind, `${path}.statementKind`),
    confirmationState: readString(value.confirmationState, `${path}.confirmationState`),
    targetBinding: readEnum(value.targetBinding, TARGET_BINDINGS, `${path}.targetBinding`),
    contextCompatibility: readEnum(
      value.contextCompatibility,
      CONTEXT_COMPATIBILITIES,
      `${path}.contextCompatibility`
    ),
    freshness: readEnum(value.freshness, FRESHNESS_STATES, `${path}.freshness`),
    lifecycleState: readString(value.lifecycleState, `${path}.lifecycleState`),
    conflict: readEnum(value.conflict, CONFLICT_STATES, `${path}.conflict`),
    useState: readEnum(value.useState, USE_STATES, `${path}.useState`),
    ...(value.ingestedBy !== undefined
      ? { ingestedBy: readString(value.ingestedBy, `${path}.ingestedBy`) }
      : {}),
    ...(value.reviewBinding !== undefined
      ? { reviewBinding: readString(value.reviewBinding, `${path}.reviewBinding`) }
      : {}),
    ...(value.inferredContextUsed !== undefined
      ? {
          inferredContextUsed: (() => {
            if (typeof value.inferredContextUsed !== "boolean") {
              fail(`${path}.inferredContextUsed`, "must be a boolean");
            }
            return value.inferredContextUsed;
          })(),
        }
      : {}),
    ...(value.reasons !== undefined
      ? { reasons: readStringArray(value.reasons, `${path}.reasons`) }
      : {}),
  };

  return assessment;
}

function parseCoverageArea(value: unknown, index: number): EpistemicCoverageAreaInput {
  const path = `health.coverage.areas[${index}]`;
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  let criticality: EpistemicCoverageAreaInput["criticality"];
  if (value.criticality !== undefined) {
    if (typeof value.criticality !== "string" || !CRITICALITIES.has(value.criticality)) {
      fail(`${path}.criticality`, `unsupported value: ${String(value.criticality)}`);
    }
    criticality = value.criticality as EpistemicCoverageAreaInput["criticality"];
  }

  return {
    areaId: readString(value.areaId, `${path}.areaId`),
    state: readEnum(value.state, COVERAGE_AREA_STATES, `${path}.state`),
    ...(criticality !== undefined ? { criticality } : {}),
    ...(value.reasons !== undefined ? { reasons: readStringArray(value.reasons, `${path}.reasons`) } : {}),
  };
}

function parseResolutionCoverage(value: unknown): EpistemicResolutionCoverageInput {
  const path = "health.resolutionCoverage";
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  const state = readEnum(value.state, COVERAGE_STATES, `${path}.state`);
  const maybeNumber = (field: string): number | undefined => {
    if (value[field] === undefined) {
      return undefined;
    }
    return readNumber(value[field], `${path}.${field}`);
  };

  const minimumRatio = maybeNumber("minimumRatio");
  const minimumEligibleAssertions = maybeNumber("minimumEligibleAssertions");
  const requiredResolutions = maybeNumber("requiredResolutions");

  return {
    eligible: readNumber(value.eligible, `${path}.eligible`),
    resolved: readNumber(value.resolved, `${path}.resolved`),
    confirmed: readNumber(value.confirmed, `${path}.confirmed`),
    nativePremise: readNumber(value.nativePremise, `${path}.nativePremise`),
    rejected: readNumber(value.rejected, `${path}.rejected`),
    unresolved: readNumber(value.unresolved, `${path}.unresolved`),
    ratio: readNumber(value.ratio, `${path}.ratio`),
    state,
    ...(minimumRatio !== undefined ? { minimumRatio } : {}),
    ...(minimumEligibleAssertions !== undefined ? { minimumEligibleAssertions } : {}),
    ...(requiredResolutions !== undefined ? { requiredResolutions } : {}),
    ...(value.reasons !== undefined ? { reasons: readStringArray(value.reasons, `${path}.reasons`) } : {}),
  };
}

function parseHealth(value: unknown): EpistemicProjectionInput["health"] {
  const path = "health";
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  const health: EpistemicProjectionInput["health"] = {
    level: readString(value.level, `${path}.level`),
    viewMetadataState: readEnum(
      value.viewMetadataState,
      METADATA_STATES,
      `${path}.viewMetadataState`
    ),
    ...(value.resolutionCoverage !== undefined
      ? { resolutionCoverage: parseResolutionCoverage(value.resolutionCoverage) }
      : {}),
  };

  if (value.coverage !== undefined) {
    if (!isRecord(value.coverage)) {
      fail(`${path}.coverage`, "must be an object");
    }
    if (value.coverage.areas !== undefined) {
      if (!Array.isArray(value.coverage.areas)) {
        fail(`${path}.coverage.areas`, "must be an array");
      }
      health.coverage = {
        areas: value.coverage.areas.map((area, index) => parseCoverageArea(area, index)),
      };
    }
  }

  return health;
}

function parseReviewRequest(value: unknown, index: number): EpistemicReviewRequestInput {
  const path = `reviewRequests[${index}]`;
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  let targetBinding: EpistemicTargetBinding | undefined;
  if (value.targetBinding !== undefined) {
    targetBinding = readEnum(value.targetBinding, TARGET_BINDINGS, `${path}.targetBinding`);
  }

  return {
    assertionId: readString(value.assertionId, `${path}.assertionId`),
    ...(targetBinding !== undefined ? { targetBinding } : {}),
    ...(value.reasons !== undefined ? { reasons: readStringArray(value.reasons, `${path}.reasons`) } : {}),
    ...(value.downstreamImpact !== undefined
      ? { downstreamImpact: readStringArray(value.downstreamImpact, `${path}.downstreamImpact`) }
      : {}),
    ...(value.reviewerCandidates !== undefined
      ? { reviewerCandidates: readStringArray(value.reviewerCandidates, `${path}.reviewerCandidates`) }
      : {}),
  };
}

export function parseTeiEpistemicProjection(value: unknown): EpistemicProjectionInput {
  if (!isRecord(value)) {
    fail("projection", "must be an object");
  }

  if (value.contract !== TEI_EPISTEMIC_PROJECTION_CONTRACT) {
    fail("contract", `unsupported semantic contract: ${String(value.contract)}`);
  }
  if (value.schema !== TEI_EPISTEMIC_PROJECTION_SCHEMA) {
    fail("schema", `unsupported representation schema: ${String(value.schema)}`);
  }
  if (!Array.isArray(value.assessments)) {
    fail("assessments", "must be an array");
  }

  const assessments = value.assessments.map((assessment, index) => parseAssessment(assessment, index));
  const seen = new Set<string>();
  for (const assessment of assessments) {
    if (seen.has(assessment.assertionId)) {
      fail("assessments", `duplicate assertion id: ${assessment.assertionId}`);
    }
    seen.add(assessment.assertionId);
  }

  if (!Array.isArray(value.authorityLimits)) {
    fail("authorityLimits", "must be an array of strings");
  }

  return {
    contract: TEI_EPISTEMIC_PROJECTION_CONTRACT,
    schema: TEI_EPISTEMIC_PROJECTION_SCHEMA,
    assessments,
    health: parseHealth(value.health),
    ...(value.reviewRequests !== undefined
      ? {
          reviewRequests: (() => {
            if (!Array.isArray(value.reviewRequests)) {
              fail("reviewRequests", "must be an array");
            }
            return value.reviewRequests.map((request, index) => parseReviewRequest(request, index));
          })(),
        }
      : {}),
    authorityLimits: readStringArray(value.authorityLimits, "authorityLimits"),
  };
}
