export const TEI_EPISTEMIC_PROJECTION_CONTRACT = "tei.epistemic-projection/v0" as const;
export const TEI_EPISTEMIC_PROJECTION_SCHEMA = "tei.reference.epistemic-assessment/v0" as const;
export const TEI_EPISTEMIC_REVIEW_COMMAND_CONTRACT = "tei.epistemic-review-command/v0" as const;
export const TEI_EPISTEMIC_REVIEW_COMMAND_SCHEMA = "tei.reference.epistemic-review-command/v0" as const;

const REQUIRED_AUTHORITY_LIMITS = new Set([
  "assessment-does-not-assert-objective-truth",
  "target-anchor-resolution-does-not-prove-semantic-identity",
  "coverage-mapping-is-input-not-semantic-completeness-proof",
  "resolution-coverage-is-operational-readiness-not-truth-ratio",
  "partial-transport-health-is-not-project-wide-health",
  "review-history-is-bounded-by-context-as-of",
  "review-binding-includes-context-kind-and-target-identity",
  "review-binding-includes-validity-window",
  "reviewer-candidate-is-not-review-authority",
]);

const METADATA_STATES = new Set(["complete", "partial", "absent"]);
const TARGET_BINDINGS = new Set(["not-required", "exact", "reanchored", "ambiguous", "detached"]);
const USE_STATES = new Set(["premise", "candidate-only", "review-required", "blocked"]);
const CONTEXT_COMPATIBILITY = new Set(["compatible", "unknown", "incompatible"]);
const FRESHNESS_STATES = new Set(["current", "unknown", "stale", "not-yet-valid"]);
const CONFLICT_STATES = new Set(["none", "inactive", "present"]);
const CONFIRMATION_STATES = new Set(["unreviewed", "confirmed", "rejected"]);

export type EpistemicMetadataState = "complete" | "partial" | "absent";
export type EpistemicTargetBinding =
  | "not-required"
  | "exact"
  | "reanchored"
  | "ambiguous"
  | "detached";
export type EpistemicUseState = "premise" | "candidate-only" | "review-required" | "blocked";
export type EpistemicContextCompatibility = "compatible" | "unknown" | "incompatible";
export type EpistemicFreshness = "current" | "unknown" | "stale" | "not-yet-valid";
export type EpistemicConflict = "none" | "inactive" | "present";

export type EpistemicAssessmentInput = {
  assertionId: string;
  meaningFingerprint: string;
  reviewSubjectFingerprint: string;
  reviewLogSequence: number;
  contentOrigin: string;
  ingestedBy?: string;
  metadataState: EpistemicMetadataState;
  statementKind: string;
  confirmationState: string;
  reviewBinding?: string;
  targetBinding: EpistemicTargetBinding;
  contextCompatibility: EpistemicContextCompatibility;
  freshness: EpistemicFreshness;
  lifecycleState: string;
  conflict: EpistemicConflict;
  useState: EpistemicUseState;
  inferredContextUsed?: boolean;
  reasons?: string[];
};

export type EpistemicReviewRequestInput = {
  assertionId: string;
  targetBinding?: EpistemicTargetBinding;
  reasons?: string[];
  downstreamImpact?: string[];
  reviewerCandidates?: string[];
};

export type EpistemicCoverageAreaInput = {
  areaId: string;
  criticality?: "low" | "normal" | "high" | "critical";
  state: "mapped" | "gap";
  reasons?: string[];
};

export type EpistemicResolutionCoverageInput = {
  eligible: number;
  resolved: number;
  confirmed: number;
  nativePremise: number;
  rejected: number;
  unresolved: number;
  ratio: number;
  minimumRatio?: number;
  minimumEligibleAssertions?: number;
  requiredResolutions?: number;
  state: "not-configured" | "unknown" | "insufficient-sample" | "healthy" | "attention";
  reasons?: string[];
};

export type EpistemicProjectionInput = {
  contract: string;
  schema: string;
  assessments: EpistemicAssessmentInput[];
  health: {
    level: string;
    viewMetadataState: EpistemicMetadataState;
    resolutionCoverage?: EpistemicResolutionCoverageInput;
    coverage?: {
      areas?: EpistemicCoverageAreaInput[];
    };
  };
  reviewRequests?: EpistemicReviewRequestInput[];
  authorityLimits?: string[];
};

export type EpistemicUiAction =
  | "confirm"
  | "mark-hypothesis"
  | "reject"
  | "withdraw-confirmation"
  | "inspect-details"
  | "resolve-target"
  | "request-access"
  | "request-review"
  | "refresh-source";

export type EpistemicUiState =
  | "working-premise"
  | "candidate"
  | "review-required"
  | "blocked"
  | "metadata-incomplete"
  | "target-ambiguous"
  | "target-detached";

export type EpistemicConfirmationState = "unreviewed" | "confirmed" | "rejected" | "unknown";

export type EpistemicStateLabelKey =
  | "epistemic.state.working_premise"
  | "epistemic.state.candidate"
  | "epistemic.state.review_required"
  | "epistemic.state.blocked"
  | "epistemic.state.metadata_incomplete"
  | "epistemic.state.target_ambiguous"
  | "epistemic.state.target_detached";

export type EpistemicConfirmationLabelKey =
  | "epistemic.confirmation.unreviewed"
  | "epistemic.confirmation.confirmed"
  | "epistemic.confirmation.rejected"
  | "epistemic.confirmation.unknown";

export type EpistemicUiItem = {
  assertionId: string;
  meaningFingerprint: string;
  reviewSubjectFingerprint: string;
  reviewLogSequence: number;
  state: EpistemicUiState;
  labelKey: EpistemicStateLabelKey;
  tone: "neutral" | "info" | "warning" | "danger";
  sourceConfirmationState: string;
  confirmationState: EpistemicConfirmationState;
  confirmationLabelKey: EpistemicConfirmationLabelKey;
  confirmationTone: "neutral" | "warning" | "danger";
  statementKind: string;
  targetBinding: EpistemicTargetBinding;
  targetReanchored: boolean;
  inferredContextUsed: boolean;
  detailsRecommended: boolean;
  actions: EpistemicUiAction[];
  reasons: string[];
};

export type EpistemicIntentBinding = {
  assertionId: string;
  source: "human-ui";
  expectedMeaningFingerprint: string;
  expectedReviewSubjectFingerprint: string;
  expectedTargetBinding: EpistemicTargetBinding;
  expectedReviewLogSequence: number;
};

export type EpistemicReviewEventIntent = EpistemicIntentBinding & {
  kind: "review-event";
  operation: "confirm" | "reject" | "withdraw";
};

export type EpistemicClassificationIntent = EpistemicIntentBinding & {
  kind: "classification-change";
  statementKind: "hypothesis";
};

export type EpistemicReviewRequestIntent = EpistemicIntentBinding & {
  kind: "review-request";
};

export type EpistemicUiIntent =
  | EpistemicReviewEventIntent
  | EpistemicClassificationIntent
  | EpistemicReviewRequestIntent;

export type TeiEpistemicReviewCommand = {
  contract: typeof TEI_EPISTEMIC_REVIEW_COMMAND_CONTRACT;
  schema: typeof TEI_EPISTEMIC_REVIEW_COMMAND_SCHEMA;
  assertionId: string;
  operation: EpistemicReviewEventIntent["operation"];
  reviewer: string;
  eventId: string;
  occurredAt: string;
  expectedMeaningFingerprint: string;
  expectedReviewSubjectFingerprint: string;
  expectedTargetBinding: EpistemicTargetBinding;
  expectedLastSequence: number;
};

export type BulkConfirmResult =
  | { ok: true; intents: EpistemicReviewEventIntent[] }
  | {
      ok: false;
      blocked: Array<{
        assertionId: string;
        state: EpistemicUiState;
        reasons: string[];
      }>;
    };

export type EpistemicReviewQueueItem =
  | {
      kind: "assertion-review";
      id: string;
      assertionId: string;
      targetBinding?: EpistemicTargetBinding;
      reasons: string[];
      downstreamImpact: string[];
      reviewerCandidates: string[];
      reviewerCandidateIsAuthority: false;
    }
  | {
      kind: "coverage-gap";
      id: string;
      areaId: string;
      criticality: "low" | "normal" | "high" | "critical";
      reasons: string[];
      reviewerCandidateIsAuthority: false;
    };

export type EpistemicHealthLabelKey =
  | "epistemic.health.partial"
  | "epistemic.health.critical"
  | "epistemic.health.attention"
  | "epistemic.health.normal";

export type EpistemicHealthPresentation = {
  scope: "project" | "partial-view";
  severity: "normal" | "attention" | "critical";
  labelKey: EpistemicHealthLabelKey;
  mayClaimProjectHealthy: boolean;
  coverageGapCount: number;
  criticalCoverageGapCount: number;
  resolutionCoverageState?: EpistemicResolutionCoverageInput["state"];
  resolvedRatio?: number;
  minimumResolvedRatio?: number;
  requiredResolutions?: number;
};

export const EPISTEMIC_QUICK_KEYS: Readonly<Record<string, EpistemicUiAction>> = Object.freeze({
  v: "confirm",
  h: "mark-hypothesis",
  x: "reject",
  r: "request-review",
});

function unique(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])].sort();
}

function assertKnown(value: string, allowed: Set<string>, field: string): void {
  if (!allowed.has(value)) {
    throw new Error(`unsupported ${field}: ${value}`);
  }
}

function assertProjectionShape(projection: EpistemicProjectionInput): void {
  if (projection.contract !== TEI_EPISTEMIC_PROJECTION_CONTRACT) {
    throw new Error(`unsupported epistemic projection contract: ${projection.contract}`);
  }
  if (projection.schema !== TEI_EPISTEMIC_PROJECTION_SCHEMA) {
    throw new Error(`unsupported epistemic projection schema: ${projection.schema}`);
  }
  if (!Array.isArray(projection.authorityLimits)) {
    throw new Error("epistemic projection authorityLimits are required");
  }
  const limits = new Set(projection.authorityLimits);
  for (const required of REQUIRED_AUTHORITY_LIMITS) {
    if (!limits.has(required)) {
      throw new Error(`missing epistemic authority limit: ${required}`);
    }
  }
  if (!Array.isArray(projection.assessments)) {
    throw new Error("epistemic projection assessments must be an array");
  }
  if (!projection.health || typeof projection.health !== "object") {
    throw new Error("epistemic projection health is required");
  }
  assertKnown(projection.health.viewMetadataState, METADATA_STATES, "health.viewMetadataState");
  const resolutionCoverage = projection.health.resolutionCoverage;
  if (resolutionCoverage !== undefined) {
    const counts = [
      resolutionCoverage.eligible,
      resolutionCoverage.resolved,
      resolutionCoverage.confirmed,
      resolutionCoverage.nativePremise,
      resolutionCoverage.rejected,
      resolutionCoverage.unresolved,
      resolutionCoverage.requiredResolutions ?? 0,
      resolutionCoverage.minimumEligibleAssertions ?? 0,
    ];
    if (counts.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error("epistemic resolutionCoverage counts must be non-negative integers");
    }
    if (
      resolutionCoverage.ratio < 0 ||
      resolutionCoverage.ratio > 1 ||
      (resolutionCoverage.minimumRatio !== undefined &&
        (resolutionCoverage.minimumRatio < 0 || resolutionCoverage.minimumRatio > 1))
    ) {
      throw new Error("epistemic resolutionCoverage ratio must be between 0 and 1");
    }
    if (
      resolutionCoverage.resolved > resolutionCoverage.eligible ||
      resolutionCoverage.unresolved > resolutionCoverage.eligible ||
      resolutionCoverage.resolved + resolutionCoverage.unresolved !== resolutionCoverage.eligible
    ) {
      throw new Error("epistemic resolutionCoverage counts are inconsistent");
    }
    const allowedStates = new Set([
      "not-configured",
      "unknown",
      "insufficient-sample",
      "healthy",
      "attention",
    ]);
    assertKnown(resolutionCoverage.state, allowedStates, "health.resolutionCoverage.state");
  }

  const seen = new Set<string>();
  for (const assessment of projection.assessments) {
    if (!assessment.assertionId) {
      throw new Error("epistemic assessment requires assertionId");
    }
    if (seen.has(assessment.assertionId)) {
      throw new Error(`duplicate epistemic assertionId: ${assessment.assertionId}`);
    }
    seen.add(assessment.assertionId);
    if (!/^sha256:[0-9a-f]{64}$/.test(assessment.meaningFingerprint)) {
      throw new Error(`invalid meaningFingerprint for ${assessment.assertionId}`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(assessment.reviewSubjectFingerprint)) {
      throw new Error(`invalid reviewSubjectFingerprint for ${assessment.assertionId}`);
    }
    if (!Number.isInteger(assessment.reviewLogSequence) || assessment.reviewLogSequence < 0) {
      throw new Error(`invalid reviewLogSequence for ${assessment.assertionId}`);
    }
    assertKnown(assessment.metadataState, METADATA_STATES, "metadataState");
    assertKnown(assessment.targetBinding, TARGET_BINDINGS, "targetBinding");
    assertKnown(assessment.useState, USE_STATES, "useState");
    assertKnown(assessment.contextCompatibility, CONTEXT_COMPATIBILITY, "contextCompatibility");
    assertKnown(assessment.freshness, FRESHNESS_STATES, "freshness");
    assertKnown(assessment.conflict, CONFLICT_STATES, "conflict");
    assertKnown(assessment.confirmationState, CONFIRMATION_STATES, "confirmationState");
  }

  for (const request of projection.reviewRequests ?? []) {
    if (!request.assertionId) {
      throw new Error("epistemic review request requires assertionId");
    }
    if (request.targetBinding !== undefined) {
      assertKnown(request.targetBinding, TARGET_BINDINGS, "reviewRequest.targetBinding");
    }
  }

  for (const area of projection.health.coverage?.areas ?? []) {
    if (!area.areaId) {
      throw new Error("epistemic coverage area requires areaId");
    }
    if (area.state !== "mapped" && area.state !== "gap") {
      throw new Error(`unsupported coverage state: ${area.state}`);
    }
  }
}

function baseActions(assessment: EpistemicAssessmentInput): EpistemicUiAction[] {
  const actions: EpistemicUiAction[] = ["inspect-details"];
  if (assessment.useState !== "blocked") {
    actions.push("request-review");
  }
  return actions;
}

function deriveState(assessment: EpistemicAssessmentInput): EpistemicUiState {
  if (assessment.useState === "blocked" || assessment.lifecycleState !== "active") {
    return "blocked";
  }
  if (assessment.metadataState !== "complete") {
    return "metadata-incomplete";
  }
  if (assessment.targetBinding === "ambiguous") {
    return "target-ambiguous";
  }
  if (assessment.targetBinding === "detached") {
    return "target-detached";
  }
  if (assessment.useState === "review-required" || assessment.conflict === "present") {
    return "review-required";
  }
  if (assessment.useState === "premise") {
    return "working-premise";
  }
  return "candidate";
}

function confirmationPresentation(
  assessment: EpistemicAssessmentInput,
): Pick<EpistemicUiItem, "sourceConfirmationState" | "confirmationState" | "confirmationLabelKey" | "confirmationTone"> {
  if (assessment.metadataState !== "complete") {
    return {
      sourceConfirmationState: assessment.confirmationState,
      confirmationState: "unknown",
      confirmationLabelKey: "epistemic.confirmation.unknown",
      confirmationTone: "warning",
    };
  }
  switch (assessment.confirmationState) {
    case "confirmed":
      return {
        sourceConfirmationState: assessment.confirmationState,
        confirmationState: "confirmed",
        confirmationLabelKey: "epistemic.confirmation.confirmed",
        confirmationTone: "neutral",
      };
    case "rejected":
      return {
        sourceConfirmationState: assessment.confirmationState,
        confirmationState: "rejected",
        confirmationLabelKey: "epistemic.confirmation.rejected",
        confirmationTone: "danger",
      };
    default:
      return {
        sourceConfirmationState: assessment.confirmationState,
        confirmationState: "unreviewed",
        confirmationLabelKey: "epistemic.confirmation.unreviewed",
        confirmationTone: "neutral",
      };
  }
}

function statePresentation(state: EpistemicUiState): Pick<EpistemicUiItem, "labelKey" | "tone"> {
  switch (state) {
    case "working-premise":
      return { labelKey: "epistemic.state.working_premise", tone: "info" };
    case "candidate":
      return { labelKey: "epistemic.state.candidate", tone: "neutral" };
    case "review-required":
      return { labelKey: "epistemic.state.review_required", tone: "warning" };
    case "blocked":
      return { labelKey: "epistemic.state.blocked", tone: "danger" };
    case "metadata-incomplete":
      return { labelKey: "epistemic.state.metadata_incomplete", tone: "warning" };
    case "target-ambiguous":
      return { labelKey: "epistemic.state.target_ambiguous", tone: "warning" };
    case "target-detached":
      return { labelKey: "epistemic.state.target_detached", tone: "warning" };
  }
}

function allowedActions(
  assessment: EpistemicAssessmentInput,
  state: EpistemicUiState,
): EpistemicUiAction[] {
  const actions = baseActions(assessment);
  switch (state) {
    case "blocked":
      return ["inspect-details"];
    case "metadata-incomplete":
      return unique([...actions, "request-access", "refresh-source"]) as EpistemicUiAction[];
    case "target-ambiguous":
    case "target-detached":
      return unique([...actions, "resolve-target"]) as EpistemicUiAction[];
    case "review-required":
      return actions;
    case "working-premise":
    case "candidate":
      if (assessment.confirmationState === "confirmed") {
        return unique([...actions, "reject", "withdraw-confirmation"]) as EpistemicUiAction[];
      }
      return unique([...actions, "confirm", "mark-hypothesis", "reject"]) as EpistemicUiAction[];
  }
}

export function buildEpistemicUiItems(projection: EpistemicProjectionInput): EpistemicUiItem[] {
  assertProjectionShape(projection);
  return projection.assessments
    .map((assessment): EpistemicUiItem => {
      const state = deriveState(assessment);
      const presentation = statePresentation(state);
      const confirmation = confirmationPresentation(assessment);
      return {
        assertionId: assessment.assertionId,
        meaningFingerprint: assessment.meaningFingerprint,
        reviewSubjectFingerprint: assessment.reviewSubjectFingerprint,
        reviewLogSequence: assessment.reviewLogSequence,
        state,
        ...presentation,
        ...confirmation,
        statementKind: assessment.statementKind,
        targetBinding: assessment.targetBinding,
        targetReanchored: assessment.targetBinding === "reanchored",
        inferredContextUsed: Boolean(assessment.inferredContextUsed),
        detailsRecommended:
          assessment.targetBinding === "reanchored"
          || Boolean(assessment.inferredContextUsed)
          || assessment.metadataState !== "complete",
        actions: allowedActions(assessment, state),
        reasons: unique(assessment.reasons),
      };
    })
    .sort((left, right) => left.assertionId.localeCompare(right.assertionId));
}

function intentBinding(item: EpistemicUiItem): EpistemicIntentBinding {
  return {
    assertionId: item.assertionId,
    source: "human-ui",
    expectedMeaningFingerprint: item.meaningFingerprint,
    expectedReviewSubjectFingerprint: item.reviewSubjectFingerprint,
    expectedTargetBinding: item.targetBinding,
    expectedReviewLogSequence: item.reviewLogSequence,
  };
}

export function buildEpistemicReviewIntent(
  item: EpistemicUiItem,
  operation: EpistemicReviewEventIntent["operation"],
): EpistemicReviewEventIntent {
  const requiredAction: EpistemicUiAction =
    operation === "withdraw" ? "withdraw-confirmation" : operation;
  if (!item.actions.includes(requiredAction)) {
    throw new Error(`${operation} is not allowed for ${item.assertionId} in state ${item.state}`);
  }
  return {
    ...intentBinding(item),
    kind: "review-event",
    operation,
  };
}

export function buildEpistemicClassificationIntent(
  item: EpistemicUiItem,
): EpistemicClassificationIntent {
  if (!item.actions.includes("mark-hypothesis")) {
    throw new Error(`mark-hypothesis is not allowed for ${item.assertionId} in state ${item.state}`);
  }
  return {
    ...intentBinding(item),
    kind: "classification-change",
    statementKind: "hypothesis",
  };
}

export function buildEpistemicReviewRequestIntent(
  item: EpistemicUiItem,
): EpistemicReviewRequestIntent {
  if (!item.actions.includes("request-review")) {
    throw new Error(`request-review is not allowed for ${item.assertionId} in state ${item.state}`);
  }
  return {
    ...intentBinding(item),
    kind: "review-request",
  };
}

export function buildTeiEpistemicReviewCommand(
  intent: EpistemicReviewEventIntent,
  input: { reviewer: string; eventId: string; occurredAt: string },
): TeiEpistemicReviewCommand {
  const reviewer = input.reviewer.trim();
  const eventId = input.eventId.trim();
  const occurredAt = input.occurredAt.trim();
  if (!reviewer || !eventId || !occurredAt) {
    throw new Error("reviewer, eventId, and occurredAt are required");
  }
  return {
    contract: TEI_EPISTEMIC_REVIEW_COMMAND_CONTRACT,
    schema: TEI_EPISTEMIC_REVIEW_COMMAND_SCHEMA,
    assertionId: intent.assertionId,
    operation: intent.operation,
    reviewer,
    eventId,
    occurredAt,
    expectedMeaningFingerprint: intent.expectedMeaningFingerprint,
    expectedReviewSubjectFingerprint: intent.expectedReviewSubjectFingerprint,
    expectedTargetBinding: intent.expectedTargetBinding,
    expectedLastSequence: intent.expectedReviewLogSequence,
  };
}

export function buildBulkConfirmIntents(items: EpistemicUiItem[]): BulkConfirmResult {
  const blocked = items
    .filter((item) => !item.actions.includes("confirm"))
    .map((item) => ({
      assertionId: item.assertionId,
      state: item.state,
      reasons: item.reasons,
    }));
  if (blocked.length > 0) {
    return { ok: false, blocked };
  }
  return {
    ok: true,
    intents: items.map((item) => buildEpistemicReviewIntent(item, "confirm")),
  };
}

export function buildEpistemicReviewQueue(
  projection: EpistemicProjectionInput,
): EpistemicReviewQueueItem[] {
  assertProjectionShape(projection);
  const items: EpistemicReviewQueueItem[] = [];

  for (const request of projection.reviewRequests ?? []) {
    items.push({
      kind: "assertion-review",
      id: `assertion:${request.assertionId}`,
      assertionId: request.assertionId,
      targetBinding: request.targetBinding,
      reasons: unique(request.reasons),
      downstreamImpact: unique(request.downstreamImpact),
      reviewerCandidates: unique(request.reviewerCandidates),
      reviewerCandidateIsAuthority: false,
    });
  }

  for (const area of projection.health.coverage?.areas ?? []) {
    if (area.state !== "gap") {
      continue;
    }
    items.push({
      kind: "coverage-gap",
      id: `coverage:${area.areaId}`,
      areaId: area.areaId,
      criticality: area.criticality ?? "normal",
      reasons: unique(area.reasons),
      reviewerCandidateIsAuthority: false,
    });
  }

  const rank = { critical: 4, high: 3, normal: 2, low: 1 } as const;
  return items.sort((left, right) => {
    const leftRank = left.kind === "coverage-gap" ? rank[left.criticality] : 5;
    const rightRank = right.kind === "coverage-gap" ? rank[right.criticality] : 5;
    if (leftRank !== rightRank) {
      return rightRank - leftRank;
    }
    return left.id.localeCompare(right.id);
  });
}

export function buildEpistemicHealthPresentation(
  projection: EpistemicProjectionInput,
): EpistemicHealthPresentation {
  assertProjectionShape(projection);
  const gaps = (projection.health.coverage?.areas ?? []).filter((area) => area.state === "gap");
  const criticalGaps = gaps.filter((area) => area.criticality === "critical" || area.criticality === "high");
  const partial = projection.health.viewMetadataState !== "complete";

  let severity: EpistemicHealthPresentation["severity"] = "normal";
  if (projection.health.level === "critical" || criticalGaps.some((area) => area.criticality === "critical")) {
    severity = "critical";
  } else if (projection.health.level !== "healthy" || partial || criticalGaps.length > 0) {
    severity = "attention";
  }

  return {
    scope: partial ? "partial-view" : "project",
    severity,
    labelKey: partial
      ? "epistemic.health.partial"
      : severity === "critical"
        ? "epistemic.health.critical"
        : severity === "attention"
          ? "epistemic.health.attention"
          : "epistemic.health.normal",
    mayClaimProjectHealthy: !partial && severity === "normal",
    coverageGapCount: gaps.length,
    criticalCoverageGapCount: criticalGaps.length,
    resolutionCoverageState: projection.health.resolutionCoverage?.state,
    resolvedRatio: projection.health.resolutionCoverage?.ratio,
    minimumResolvedRatio: projection.health.resolutionCoverage?.minimumRatio,
    requiredResolutions: projection.health.resolutionCoverage?.requiredResolutions,
  };
}
