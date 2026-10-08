import { serializeInquiryBundle, type InquiryBundleIoError } from "./inquiry_bundle_io";
import {
  type CardAddressV1,
  type CardLineageEdgeV1,
  type FieldworkOutcomeV1,
  type FieldworkRequestV1,
  type InquiryBundleV1,
  type InquiryJourneyV1,
  type RoundArtifactRefV1,
  type RoundHandoffV1,
  type RoundRecordV1,
  type RoundSnapshotV1,
} from "./inquiry_journey";
import { SafeModePolicy } from "./policy/safe_mode";
import { canonicalizeJson } from "./patch/patch_fingerprint";
import {
  resolveKnownEdgeType,
  type Card,
  type CardKa,
  type CardMeta,
  type CritiqueInput,
  type DeterministicTieBreak,
  type DocumentV1,
  type Edge,
  type EvidenceLink,
  type Island,
  type IslandGeometry,
  type IslandShape,
  type IslandShapeGeneratedFrom,
  type MergeSuggestionDecisionEntry,
  type Narrative,
  type NarrativeCheck,
  type NarrativeCheckIssue,
  type NarrativeCheckReference,
  type PatchApplyLogEntry,
  type PatchApplyStats,
  type PatchConflictMeta,
  type RelationSummary,
  type RelationSummaryHistoryEntry,
  type RepresentativeVisualCue,
  type ReviewAttribution,
  type ShelfEntry,
  type SummaryHistoryEntry,
  type Transform,
  type VoidEntry,
} from "./types";

type FieldPolicy = "preserve" | "redact" | "omit" | "rebuild";

// These maps are intentionally exhaustive. A new persisted field must receive a
// deliberate SafeMode policy before this module compiles again.
const BUNDLE_FIELDS = {
  schemaVersion: "preserve",
  journey: "rebuild",
  snapshots: "rebuild",
  cardLineage: "rebuild",
  exportInfo: "preserve",
} satisfies Record<keyof InquiryBundleV1, FieldPolicy>;

const JOURNEY_FIELDS = {
  schemaVersion: "preserve",
  journeyId: "preserve",
  title: "redact",
  originSnapshotIds: "preserve",
  roundRecords: "rebuild",
  headRoundIds: "preserve",
  defaultHeadRoundId: "preserve",
  createdAt: "preserve",
  updatedAt: "preserve",
} satisfies Record<keyof InquiryJourneyV1, FieldPolicy>;

const ROUND_FIELDS = {
  roundId: "preserve",
  createdAt: "preserve",
  updatedAt: "preserve",
  stage: "preserve",
  iteration: "preserve",
  parentRoundIds: "preserve",
  status: "preserve",
  theme: "redact",
  inputSnapshotIds: "preserve",
  outputSnapshotId: "preserve",
  handoff: "rebuild",
} satisfies Record<keyof RoundRecordV1, FieldPolicy>;

const HANDOFF_FIELDS = {
  carryoverRefs: "rebuild",
  heldRefs: "rebuild",
  unresolvedQuestions: "redact",
  fieldworkRequests: "rebuild",
  understandingDelta: "redact",
} satisfies Record<keyof RoundHandoffV1, FieldPolicy>;

const FIELDWORK_REQUEST_FIELDS = {
  requestId: "preserve",
  question: "redact",
  outcome: "rebuild",
} satisfies Record<keyof FieldworkRequestV1, FieldPolicy>;

const FIELDWORK_OUTCOME_FIELDS = {
  kind: "preserve",
  responseCardRefs: "rebuild",
  note: "redact",
} satisfies Record<keyof FieldworkOutcomeV1, FieldPolicy>;

const SNAPSHOT_FIELDS = {
  schemaVersion: "preserve",
  snapshotId: "preserve",
  createdAt: "preserve",
  canonicalDigest: "rebuild",
  document: "rebuild",
} satisfies Record<keyof RoundSnapshotV1, FieldPolicy>;

const CARD_ADDRESS_FIELDS = {
  snapshotId: "preserve",
  cardId: "preserve",
} satisfies Record<keyof CardAddressV1, FieldPolicy>;

const ARTIFACT_REF_FIELDS = {
  snapshotId: "preserve",
  kind: "preserve",
  entityId: "preserve",
} satisfies Record<keyof RoundArtifactRefV1, FieldPolicy>;

type OneToOneLineage = Extract<CardLineageEdgeV1, { kind: "carried" | "edited" }>;
type DerivedLineage = Extract<CardLineageEdgeV1, { kind: "derived" }>;
type SplitLineage = Extract<CardLineageEdgeV1, { kind: "split" }>;
type MergedLineage = Extract<CardLineageEdgeV1, { kind: "merged" }>;
type NewLineage = Extract<CardLineageEdgeV1, { kind: "new" }>;
type RetiredLineage = Extract<CardLineageEdgeV1, { kind: "retired" }>;

const ONE_TO_ONE_LINEAGE_FIELDS = {
  lineageId: "preserve",
  kind: "preserve",
  from: "rebuild",
  to: "rebuild",
} satisfies Record<keyof OneToOneLineage, FieldPolicy>;

const DERIVED_LINEAGE_FIELDS = {
  lineageId: "preserve",
  kind: "preserve",
  from: "rebuild",
  to: "rebuild",
} satisfies Record<keyof DerivedLineage, FieldPolicy>;

const SPLIT_LINEAGE_FIELDS = {
  lineageId: "preserve",
  kind: "preserve",
  from: "rebuild",
  to: "rebuild",
} satisfies Record<keyof SplitLineage, FieldPolicy>;

const MERGED_LINEAGE_FIELDS = {
  lineageId: "preserve",
  kind: "preserve",
  from: "rebuild",
  to: "rebuild",
} satisfies Record<keyof MergedLineage, FieldPolicy>;

const NEW_LINEAGE_FIELDS = {
  lineageId: "preserve",
  kind: "preserve",
  to: "rebuild",
} satisfies Record<keyof NewLineage, FieldPolicy>;

const RETIRED_LINEAGE_FIELDS = {
  lineageId: "preserve",
  kind: "preserve",
  from: "rebuild",
} satisfies Record<keyof RetiredLineage, FieldPolicy>;

const DOCUMENT_FIELDS = {
  version: "preserve",
  id: "preserve",
  title: "redact",
  createdAt: "preserve",
  updatedAt: "preserve",
  transform: "rebuild",
  cards: "rebuild",
  edges: "rebuild",
  islands: "rebuild",
  affiliations: "omit",
  readingOrder: "preserve",
  narratives: "rebuild",
  relationSummaries: "rebuild",
  evidenceLinks: "rebuild",
  patchApplyLog: "rebuild",
  mergeSuggestionDecisions: "rebuild",
  critiqueInputs: "rebuild",
  reproposalDiffs: "omit",
  reviewAttribution: "rebuild",
  deterministicTieBreak: "rebuild",
  shelf: "rebuild",
  contradictionSignalDecisions: "omit",
  voids: "rebuild",
} satisfies Record<keyof DocumentV1, FieldPolicy>;

const CARD_FIELDS = {
  id: "preserve",
  text: "redact",
  x: "preserve",
  y: "preserve",
  claimType: "preserve",
  mergedIntoCardId: "preserve",
  repOf: "preserve",
  canonicalId: "preserve",
  sources: "preserve",
  critique: "redact",
  critiqueTags: "redact",
  textReviewed: "preserve",
  holdState: "preserve",
  meta: "rebuild",
  ka: "rebuild",
} satisfies Record<keyof Card, FieldPolicy>;

const CARD_META_FIELDS = {
  seq: "preserve",
  source: "rebuild",
} satisfies Record<keyof CardMeta, FieldPolicy>;

const CARD_KA_FIELDS = {
  voice: "redact",
  value: "redact",
} satisfies Record<keyof CardKa, FieldPolicy>;

const TRANSFORM_FIELDS = {
  panX: "preserve",
  panY: "preserve",
  zoom: "preserve",
} satisfies Record<keyof Transform, FieldPolicy>;

const EDGE_FIELDS = {
  id: "preserve",
  fromId: "preserve",
  toId: "preserve",
  fromKind: "preserve",
  toKind: "preserve",
  type: "rebuild",
} satisfies Record<keyof Edge, FieldPolicy>;

const ISLAND_FIELDS = {
  id: "preserve",
  cardIds: "preserve",
  parentIslandId: "preserve",
  placardCardId: "preserve",
  collapsed: "preserve",
  title: "redact",
  titleReviewed: "preserve",
  summaryText: "redact",
  summaryReviewed: "preserve",
  summaryGrounding: "preserve",
  summaryHistory: "rebuild",
  imageUrl: "omit",
  imageReviewed: "omit",
  critique: "redact",
  critiqueTags: "redact",
  geometry: "rebuild",
  shape: "rebuild",
  shapeStale: "preserve",
  representativeCue: "rebuild",
} satisfies Record<keyof Island, FieldPolicy>;

type RectGeometry = Extract<IslandGeometry, { type: "rect" }>;
type PolygonGeometry = Extract<IslandGeometry, { type: "polygon" }>;
type RectShape = Extract<IslandShape, { kind: "rect" }>;
type PolygonShape = Extract<IslandShape, { kind: "polygon" }>;

const RECT_GEOMETRY_FIELDS = {
  type: "preserve",
  x: "preserve",
  y: "preserve",
  w: "preserve",
  h: "preserve",
} satisfies Record<keyof RectGeometry, FieldPolicy>;

const POLYGON_GEOMETRY_FIELDS = {
  type: "preserve",
  points: "rebuild",
} satisfies Record<keyof PolygonGeometry, FieldPolicy>;

const RECT_SHAPE_FIELDS = {
  kind: "preserve",
  generatedFrom: "rebuild",
} satisfies Record<keyof RectShape, FieldPolicy>;

const POLYGON_SHAPE_FIELDS = {
  kind: "preserve",
  points: "rebuild",
  generatedFrom: "rebuild",
} satisfies Record<keyof PolygonShape, FieldPolicy>;

const SHAPE_GENERATED_FROM_FIELDS = {
  cardIds: "preserve",
  versionToken: "redact",
} satisfies Record<keyof IslandShapeGeneratedFrom, FieldPolicy>;

const SUMMARY_HISTORY_FIELDS = {
  id: "preserve",
  createdAt: "preserve",
  fromText: "redact",
  toText: "redact",
  fromReviewed: "preserve",
  toReviewed: "preserve",
  changeKind: "preserve",
  note: "redact",
  groundingIds: "preserve",
} satisfies Record<keyof SummaryHistoryEntry, FieldPolicy>;

const EVIDENCE_FIELDS = {
  id: "preserve",
  type: "preserve",
  fromCardId: "preserve",
  toCardId: "preserve",
  note: "redact",
  createdAt: "preserve",
  contradictionState: "preserve",
} satisfies Record<keyof EvidenceLink, FieldPolicy>;

const CRITIQUE_INPUT_FIELDS = {
  schemaVersion: "preserve",
  critiqueId: "preserve",
  targetRef: "preserve",
  critiqueType: "preserve",
  createdAt: "preserve",
  iteration: "preserve",
  comment: "redact",
  constraintHints: "redact",
} satisfies Record<keyof CritiqueInput, FieldPolicy>;

const REVIEW_ATTRIBUTION_FIELDS = {
  schemaVersion: "preserve",
  reviewState: "preserve",
  reviewedAt: "preserve",
  reviewerRef: "redact",
  auditRecordedAt: "preserve",
  overridePolicy: "preserve",
  reviewContext: "redact",
  ownerRef: "omit",
} satisfies Record<keyof ReviewAttribution, FieldPolicy>;

const NARRATIVE_FIELDS = {
  id: "preserve",
  title: "redact",
  text: "redact",
  createdAt: "preserve",
  basedOnReadingOrder: "preserve",
  reviewed: "preserve",
  checks: "rebuild",
} satisfies Record<keyof Narrative, FieldPolicy>;

const NARRATIVE_CHECK_FIELDS = {
  id: "preserve",
  createdAt: "preserve",
  kind: "preserve",
  issues: "rebuild",
  // A/B cross-check totals are structural (no text), safe to project.
  counts: "preserve",
} satisfies Record<keyof NarrativeCheck, FieldPolicy>;

const NARRATIVE_ISSUE_FIELDS = {
  severity: "preserve",
  message: "redact",
  references: "rebuild",
  // A/B cross-check direction is a structural classification (no text).
  direction: "preserve",
} satisfies Record<keyof NarrativeCheckIssue, FieldPolicy>;

const NARRATIVE_REFERENCE_FIELDS = {
  id: "preserve",
  kind: "preserve",
} satisfies Record<keyof NarrativeCheckReference, FieldPolicy>;

const RELATION_SUMMARY_FIELDS = {
  id: "preserve",
  createdAt: "preserve",
  islandAId: "preserve",
  islandBId: "preserve",
  relationType: "preserve",
  derived: "preserve",
  text: "redact",
  reviewed: "preserve",
  groundingCardIds: "preserve",
  groundingEdgeIds: "preserve",
  warnings: "redact",
  sourceSignature: "redact",
  history: "rebuild",
} satisfies Record<keyof RelationSummary, FieldPolicy>;

const RELATION_HISTORY_FIELDS = {
  id: "preserve",
  createdAt: "preserve",
  changeKind: "preserve",
  fromText: "redact",
  toText: "redact",
  fromReviewed: "preserve",
  toReviewed: "preserve",
  warningsSnapshot: "redact",
  groundingCardIdsSnapshot: "preserve",
  groundingEdgeIdsSnapshot: "preserve",
  note: "redact",
} satisfies Record<keyof RelationSummaryHistoryEntry, FieldPolicy>;

const MERGE_DECISION_FIELDS = {
  id: "preserve",
  decisionId: "preserve",
  groupId: "preserve",
  decision: "preserve",
  action: "preserve",
  decidedAt: "preserve",
  decidedBy: "omit",
  cardIds: "preserve",
  selectedCardIds: "preserve",
  mergedTextDraft: "redact",
  editedText: "redact",
  note: "redact",
  snapshotVersion: "redact",
  rationale: "redact",
  mergeMethod: "preserve",
  // R3-tier-1: decision-time provenance snapshot. Same category as cardIds/
  // selectedCardIds/decision/action above — structural ids and an enum, not free text.
  representativeCardId: "preserve",
  representativeResolvedBy: "preserve",
  sourceCardIds: "preserve",
  missingSourceCardIds: "preserve",
} satisfies Record<keyof MergeSuggestionDecisionEntry, FieldPolicy>;

const PATCH_LOG_FIELDS = {
  id: "preserve",
  createdAt: "preserve",
  patchVersion: "preserve",
  patchTitle: "redact",
  baseDocSignature: "omit",
  patchSourceSignature: "omit",
  appliedOpIds: "preserve",
  stats: "rebuild",
  conflictMeta: "rebuild",
  note: "redact",
} satisfies Record<keyof PatchApplyLogEntry, FieldPolicy>;

const PATCH_STATS_FIELDS = {
  upsertCards: "preserve",
  deleteCards: "preserve",
  upsertIslands: "preserve",
  deleteIslands: "preserve",
  upsertEdges: "preserve",
  deleteEdges: "preserve",
  upsertRelationSummaries: "preserve",
  deleteRelationSummaries: "preserve",
  upsertEvidenceLinks: "preserve",
  deleteEvidenceLinks: "preserve",
} satisfies Record<keyof PatchApplyStats, FieldPolicy>;

const PATCH_CONFLICT_FIELDS = {
  totalConflicts: "preserve",
  chosenYours: "preserve",
  chosenTheirs: "preserve",
  chosenSkip: "preserve",
} satisfies Record<keyof PatchConflictMeta, FieldPolicy>;

const TIE_BREAK_FIELDS = {
  schemaVersion: "preserve",
  order: "preserve",
} satisfies Record<keyof DeterministicTieBreak, FieldPolicy>;

const SHELF_FIELDS = {
  cardId: "preserve",
  shelvedAt: "preserve",
  reason: "redact",
} satisfies Record<keyof ShelfEntry, FieldPolicy>;

const VOID_FIELDS = {
  id: "preserve",
  kind: "preserve",
  // title/detail can quote card text — redact, keep the structural refs.
  title: "redact",
  detail: "redact",
  cardIds: "preserve",
  islandIds: "preserve",
  resolved: "preserve",
  createdAt: "preserve",
} satisfies Record<keyof VoidEntry, FieldPolicy>;

// Keep the compile-time policy declarations live without using them as a
// second runtime source of truth.
void [
  BUNDLE_FIELDS,
  JOURNEY_FIELDS,
  ROUND_FIELDS,
  HANDOFF_FIELDS,
  FIELDWORK_REQUEST_FIELDS,
  FIELDWORK_OUTCOME_FIELDS,
  SNAPSHOT_FIELDS,
  CARD_ADDRESS_FIELDS,
  ARTIFACT_REF_FIELDS,
  ONE_TO_ONE_LINEAGE_FIELDS,
  DERIVED_LINEAGE_FIELDS,
  SPLIT_LINEAGE_FIELDS,
  MERGED_LINEAGE_FIELDS,
  NEW_LINEAGE_FIELDS,
  RETIRED_LINEAGE_FIELDS,
  DOCUMENT_FIELDS,
  CARD_FIELDS,
  CARD_META_FIELDS,
  CARD_KA_FIELDS,
  TRANSFORM_FIELDS,
  EDGE_FIELDS,
  ISLAND_FIELDS,
  RECT_GEOMETRY_FIELDS,
  POLYGON_GEOMETRY_FIELDS,
  RECT_SHAPE_FIELDS,
  POLYGON_SHAPE_FIELDS,
  SHAPE_GENERATED_FROM_FIELDS,
  SUMMARY_HISTORY_FIELDS,
  EVIDENCE_FIELDS,
  CRITIQUE_INPUT_FIELDS,
  REVIEW_ATTRIBUTION_FIELDS,
  NARRATIVE_FIELDS,
  NARRATIVE_CHECK_FIELDS,
  NARRATIVE_ISSUE_FIELDS,
  NARRATIVE_REFERENCE_FIELDS,
  RELATION_SUMMARY_FIELDS,
  RELATION_HISTORY_FIELDS,
  MERGE_DECISION_FIELDS,
  PATCH_LOG_FIELDS,
  PATCH_STATS_FIELDS,
  PATCH_CONFLICT_FIELDS,
  TIE_BREAK_FIELDS,
  SHELF_FIELDS,
  VOID_FIELDS,
];

export type InquirySafeModeBundleResult =
  | { ok: true; bundle: InquiryBundleV1; safeModeApplied: true }
  | { ok: false; errors: InquiryBundleIoError[] };

export type DocumentSafeModeProjectionOptions = Readonly<{
  /**
   * Source references have their own explicit share opt-in (schemas.md §15.4).
   * Inquiry bundles do not expose that opt-in and therefore keep the default.
   */
  includeSourceReferences?: boolean;
}>;

function redact(value: string): string {
  if (/^\[REDACTED\](?: \(len:\d+\))?$/.test(value)) {
    return value;
  }
  return SafeModePolicy.redactText(value, true);
}

function redactNullable(value: string | null): string | null {
  return value === null ? null : redact(value);
}

function cloneAddress(address: CardAddressV1): CardAddressV1 {
  return { snapshotId: address.snapshotId, cardId: address.cardId };
}

function sanitizeLineage(edge: CardLineageEdgeV1): CardLineageEdgeV1 {
  if (edge.kind === "new") {
    return { lineageId: edge.lineageId, kind: edge.kind, to: cloneAddress(edge.to) };
  }
  if (edge.kind === "retired") {
    return { lineageId: edge.lineageId, kind: edge.kind, from: cloneAddress(edge.from) };
  }
  if (edge.kind === "derived") {
    return {
      lineageId: edge.lineageId,
      kind: edge.kind,
      from: [cloneAddress(edge.from[0]), ...edge.from.slice(1).map(cloneAddress)],
      to: cloneAddress(edge.to),
    };
  }
  if (edge.kind === "merged") {
    return {
      lineageId: edge.lineageId,
      kind: edge.kind,
      from: [
        cloneAddress(edge.from[0]),
        cloneAddress(edge.from[1]),
        ...edge.from.slice(2).map(cloneAddress),
      ],
      to: cloneAddress(edge.to),
    };
  }
  if (edge.kind === "split") {
    return {
      lineageId: edge.lineageId,
      kind: edge.kind,
      from: cloneAddress(edge.from),
      to: [
        cloneAddress(edge.to[0]),
        cloneAddress(edge.to[1]),
        ...edge.to.slice(2).map(cloneAddress),
      ],
    };
  }
  return {
    lineageId: edge.lineageId,
    kind: edge.kind,
    from: cloneAddress(edge.from),
    to: cloneAddress(edge.to),
  };
}

function cloneArtifactRef(ref: RoundArtifactRefV1): RoundArtifactRefV1 {
  return { snapshotId: ref.snapshotId, kind: ref.kind, entityId: ref.entityId };
}

function sanitizeFieldworkOutcome(outcome: FieldworkOutcomeV1): FieldworkOutcomeV1 {
  return {
    kind: outcome.kind,
    responseCardRefs: outcome.responseCardRefs.map(cloneAddress),
    ...(outcome.note !== undefined ? { note: redact(outcome.note) } : {}),
  };
}

function sanitizeFieldworkRequest(request: FieldworkRequestV1): FieldworkRequestV1 {
  return {
    requestId: request.requestId,
    question: redact(request.question),
    ...(request.outcome !== undefined ? { outcome: sanitizeFieldworkOutcome(request.outcome) } : {}),
  };
}

function sanitizeHandoff(handoff: RoundHandoffV1): RoundHandoffV1 {
  return {
    carryoverRefs: handoff.carryoverRefs.map(cloneArtifactRef),
    heldRefs: handoff.heldRefs.map(cloneArtifactRef),
    unresolvedQuestions: handoff.unresolvedQuestions.map(redact),
    fieldworkRequests: handoff.fieldworkRequests.map(sanitizeFieldworkRequest),
    ...(handoff.understandingDelta !== undefined
      ? { understandingDelta: redact(handoff.understandingDelta) }
      : {}),
  };
}

function sanitizeRound(round: RoundRecordV1): RoundRecordV1 {
  return {
    roundId: round.roundId,
    createdAt: round.createdAt,
    updatedAt: round.updatedAt,
    stage: round.stage,
    iteration: round.iteration,
    parentRoundIds: [...round.parentRoundIds],
    status: round.status,
    theme: redact(round.theme),
    inputSnapshotIds: [...round.inputSnapshotIds],
    ...(round.outputSnapshotId !== undefined ? { outputSnapshotId: round.outputSnapshotId } : {}),
    ...(round.handoff !== undefined ? { handoff: sanitizeHandoff(round.handoff) } : {}),
  };
}

function sanitizeJourney(journey: InquiryJourneyV1): InquiryJourneyV1 {
  return {
    schemaVersion: journey.schemaVersion,
    journeyId: journey.journeyId,
    title: redact(journey.title),
    originSnapshotIds: [...journey.originSnapshotIds],
    roundRecords: journey.roundRecords.map(sanitizeRound),
    headRoundIds: [...journey.headRoundIds],
    ...(journey.defaultHeadRoundId !== undefined ? { defaultHeadRoundId: journey.defaultHeadRoundId } : {}),
    createdAt: journey.createdAt,
    updatedAt: journey.updatedAt,
  };
}

function cloneTransform(transform: Transform): Transform {
  return { panX: transform.panX, panY: transform.panY, zoom: transform.zoom };
}

function sanitizeCardMeta(
  meta: CardMeta,
  includeSourceReferences: boolean,
): CardMeta | undefined {
  const sanitized: CardMeta = {
    ...(meta.seq !== undefined ? { seq: meta.seq } : {}),
    ...(includeSourceReferences && meta.source !== undefined
      ? { source: meta.source }
      : {}),
  };
  return Object.keys(sanitized).length === 0 ? undefined : sanitized;
}

function sanitizeCardKa(ka: CardKa): CardKa {
  return {
    ...(ka.voice !== undefined ? { voice: redact(ka.voice) } : {}),
    ...(ka.value !== undefined ? { value: redact(ka.value) } : {}),
  };
}

function sanitizeCard(card: Card, includeSourceReferences: boolean): Card {
  const meta = card.meta === undefined
    ? undefined
    : sanitizeCardMeta(card.meta, includeSourceReferences);
  return {
    id: card.id,
    text: redact(card.text),
    x: card.x,
    y: card.y,
    ...(card.claimType !== undefined ? { claimType: card.claimType } : {}),
    ...(card.mergedIntoCardId !== undefined ? { mergedIntoCardId: card.mergedIntoCardId } : {}),
    ...(card.repOf !== undefined ? { repOf: [...card.repOf] } : {}),
    ...(card.canonicalId !== undefined ? { canonicalId: card.canonicalId } : {}),
    ...(card.sources !== undefined ? { sources: [...card.sources] } : {}),
    ...(card.critique !== undefined ? { critique: redact(card.critique) } : {}),
    ...(card.critiqueTags !== undefined ? { critiqueTags: card.critiqueTags.map(redact) } : {}),
    ...(card.textReviewed !== undefined ? { textReviewed: card.textReviewed } : {}),
    ...(card.holdState !== undefined ? { holdState: card.holdState } : {}),
    ...(meta !== undefined ? { meta } : {}),
    ...(card.ka !== undefined ? { ka: sanitizeCardKa(card.ka) } : {}),
  };
}

function sanitizeEdge(edge: Edge): Edge {
  return {
    id: edge.id,
    fromId: edge.fromId,
    toId: edge.toId,
    ...(edge.fromKind !== undefined ? { fromKind: edge.fromKind } : {}),
    ...(edge.toKind !== undefined ? { toKind: edge.toKind } : {}),
    type: resolveKnownEdgeType(edge.type),
  };
}

function cloneGeometry(geometry: IslandGeometry): IslandGeometry {
  if (geometry.type === "polygon") {
    return { type: "polygon", points: geometry.points.map((point) => ({ x: point.x, y: point.y })) };
  }
  return {
    type: "rect",
    ...(geometry.x !== undefined ? { x: geometry.x } : {}),
    ...(geometry.y !== undefined ? { y: geometry.y } : {}),
    ...(geometry.w !== undefined ? { w: geometry.w } : {}),
    ...(geometry.h !== undefined ? { h: geometry.h } : {}),
  };
}

function sanitizeShapeGeneratedFrom(generatedFrom: IslandShapeGeneratedFrom): IslandShapeGeneratedFrom {
  return {
    cardIds: [...generatedFrom.cardIds],
    versionToken: redact(generatedFrom.versionToken),
  };
}

function sanitizeShape(shape: IslandShape): IslandShape {
  const generatedFrom = shape.generatedFrom === undefined
    ? undefined
    : sanitizeShapeGeneratedFrom(shape.generatedFrom);
  if (shape.kind === "polygon") {
    return {
      kind: "polygon",
      points: shape.points.map((point) => ({ x: point.x, y: point.y })),
      ...(generatedFrom !== undefined ? { generatedFrom } : {}),
    };
  }
  return {
    kind: "rect",
    ...(generatedFrom !== undefined ? { generatedFrom } : {}),
  };
}

function sanitizeSummaryHistory(entry: SummaryHistoryEntry): SummaryHistoryEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    fromText: redactNullable(entry.fromText),
    toText: redactNullable(entry.toText),
    fromReviewed: entry.fromReviewed,
    toReviewed: entry.toReviewed,
    changeKind: entry.changeKind,
    ...(entry.note !== undefined ? { note: redact(entry.note) } : {}),
    ...(entry.groundingIds !== undefined ? { groundingIds: [...entry.groundingIds] } : {}),
  };
}

// DOMAIN-VISUAL-CUE-01 (schemas.md §19.5): altText is human-authored
// descriptive text (same redaction channel as title/critique). kind/cueId
// are structural identifiers (preset id or emoji character), imageRef is an
// opaque IndexedDB key — none of these three carry human free-text content.
function sanitizeRepresentativeCue(cue: RepresentativeVisualCue): RepresentativeVisualCue {
  return {
    kind: cue.kind,
    cueId: cue.cueId,
    altText: redact(cue.altText),
    ...(cue.imageRef !== undefined ? { imageRef: cue.imageRef } : {}),
  };
}

function sanitizeIsland(island: Island): Island {
  return {
    id: island.id,
    cardIds: [...island.cardIds],
    ...(island.parentIslandId !== undefined ? { parentIslandId: island.parentIslandId } : {}),
    ...(island.placardCardId !== undefined ? { placardCardId: island.placardCardId } : {}),
    ...(island.collapsed !== undefined ? { collapsed: island.collapsed } : {}),
    ...(island.title !== undefined ? { title: redact(island.title) } : {}),
    ...(island.titleReviewed !== undefined ? { titleReviewed: island.titleReviewed } : {}),
    ...(island.summaryText !== undefined ? { summaryText: redact(island.summaryText) } : {}),
    ...(island.summaryReviewed !== undefined ? { summaryReviewed: island.summaryReviewed } : {}),
    ...(island.summaryGrounding !== undefined ? { summaryGrounding: [...island.summaryGrounding] } : {}),
    ...(island.summaryHistory !== undefined
      ? { summaryHistory: island.summaryHistory.map(sanitizeSummaryHistory) }
      : {}),
    ...(island.critique !== undefined ? { critique: redact(island.critique) } : {}),
    ...(island.critiqueTags !== undefined ? { critiqueTags: island.critiqueTags.map(redact) } : {}),
    ...(island.geometry !== undefined ? { geometry: cloneGeometry(island.geometry) } : {}),
    ...(island.shape !== undefined ? { shape: sanitizeShape(island.shape) } : {}),
    ...(island.shapeStale !== undefined ? { shapeStale: island.shapeStale } : {}),
    ...(island.representativeCue !== undefined
      ? { representativeCue: sanitizeRepresentativeCue(island.representativeCue) }
      : {}),
  };
}

function sanitizeEvidenceLink(link: EvidenceLink): EvidenceLink {
  return {
    id: link.id,
    type: link.type,
    fromCardId: link.fromCardId,
    toCardId: link.toCardId,
    ...(link.note !== undefined ? { note: redact(link.note) } : {}),
    ...(link.createdAt !== undefined ? { createdAt: link.createdAt } : {}),
    ...(link.contradictionState !== undefined ? { contradictionState: link.contradictionState } : {}),
  };
}

function sanitizeCritiqueInput(input: CritiqueInput): CritiqueInput {
  return {
    schemaVersion: input.schemaVersion,
    critiqueId: input.critiqueId,
    targetRef: input.targetRef,
    critiqueType: input.critiqueType,
    createdAt: input.createdAt,
    iteration: input.iteration,
    ...(input.comment !== undefined ? { comment: redact(input.comment) } : {}),
    ...(input.constraintHints !== undefined
      ? { constraintHints: input.constraintHints.map(redact) }
      : {}),
  };
}

function sanitizeReviewAttribution(attribution: ReviewAttribution): ReviewAttribution {
  return {
    schemaVersion: attribution.schemaVersion,
    reviewState: attribution.reviewState,
    reviewedAt: attribution.reviewedAt,
    reviewerRef: redact(attribution.reviewerRef),
    auditRecordedAt: attribution.auditRecordedAt,
    overridePolicy: attribution.overridePolicy,
    ...(attribution.reviewContext !== undefined
      ? { reviewContext: redact(attribution.reviewContext) }
      : {}),
  };
}

function cloneNarrativeReference(reference: NarrativeCheckReference): NarrativeCheckReference {
  return { id: reference.id, kind: reference.kind };
}

function sanitizeNarrativeIssue(issue: NarrativeCheckIssue): NarrativeCheckIssue {
  return {
    severity: issue.severity,
    message: redact(issue.message),
    ...(issue.references !== undefined
      ? { references: issue.references.map(cloneNarrativeReference) }
      : {}),
  };
}

function sanitizeNarrativeCheck(check: NarrativeCheck): NarrativeCheck {
  return {
    id: check.id,
    createdAt: check.createdAt,
    kind: check.kind,
    issues: check.issues.map(sanitizeNarrativeIssue),
  };
}

function sanitizeNarrative(narrative: Narrative): Narrative {
  return {
    id: narrative.id,
    title: redact(narrative.title),
    text: redact(narrative.text),
    ...(narrative.createdAt !== undefined ? { createdAt: narrative.createdAt } : {}),
    ...(narrative.basedOnReadingOrder !== undefined
      ? { basedOnReadingOrder: [...narrative.basedOnReadingOrder] }
      : {}),
    reviewed: narrative.reviewed,
    ...(narrative.checks !== undefined
      ? { checks: narrative.checks.map(sanitizeNarrativeCheck) }
      : {}),
  };
}

function sanitizeRelationHistory(entry: RelationSummaryHistoryEntry): RelationSummaryHistoryEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    changeKind: entry.changeKind,
    fromText: redactNullable(entry.fromText),
    toText: redactNullable(entry.toText),
    fromReviewed: entry.fromReviewed,
    toReviewed: entry.toReviewed,
    ...(entry.warningsSnapshot !== undefined
      ? { warningsSnapshot: entry.warningsSnapshot.map(redact) }
      : {}),
    ...(entry.groundingCardIdsSnapshot !== undefined
      ? { groundingCardIdsSnapshot: [...entry.groundingCardIdsSnapshot] }
      : {}),
    ...(entry.groundingEdgeIdsSnapshot !== undefined
      ? { groundingEdgeIdsSnapshot: [...entry.groundingEdgeIdsSnapshot] }
      : {}),
    ...(entry.note !== undefined ? { note: redact(entry.note) } : {}),
  };
}

function sanitizeRelationSummary(summary: RelationSummary): RelationSummary {
  return {
    id: summary.id,
    createdAt: summary.createdAt,
    islandAId: summary.islandAId,
    islandBId: summary.islandBId,
    relationType: summary.relationType,
    derived: summary.derived,
    text: redact(summary.text),
    reviewed: summary.reviewed,
    groundingCardIds: [...summary.groundingCardIds],
    groundingEdgeIds: [...summary.groundingEdgeIds],
    ...(summary.warnings !== undefined ? { warnings: summary.warnings.map(redact) } : {}),
    sourceSignature: redact(summary.sourceSignature),
    ...(summary.history !== undefined
      ? { history: summary.history.map(sanitizeRelationHistory) }
      : {}),
  };
}

function clonePatchStats(stats: PatchApplyStats): PatchApplyStats {
  return {
    upsertCards: stats.upsertCards,
    deleteCards: stats.deleteCards,
    upsertIslands: stats.upsertIslands,
    deleteIslands: stats.deleteIslands,
    upsertEdges: stats.upsertEdges,
    deleteEdges: stats.deleteEdges,
    upsertRelationSummaries: stats.upsertRelationSummaries,
    deleteRelationSummaries: stats.deleteRelationSummaries,
    upsertEvidenceLinks: stats.upsertEvidenceLinks,
    deleteEvidenceLinks: stats.deleteEvidenceLinks,
  };
}

function clonePatchConflictMeta(meta: PatchConflictMeta): PatchConflictMeta {
  return {
    totalConflicts: meta.totalConflicts,
    chosenYours: meta.chosenYours,
    chosenTheirs: meta.chosenTheirs,
    chosenSkip: meta.chosenSkip,
  };
}

function sanitizePatchLog(entry: PatchApplyLogEntry): PatchApplyLogEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    patchVersion: entry.patchVersion,
    ...(entry.patchTitle !== undefined ? { patchTitle: redact(entry.patchTitle) } : {}),
    appliedOpIds: [...entry.appliedOpIds],
    stats: clonePatchStats(entry.stats),
    ...(entry.conflictMeta !== undefined
      ? { conflictMeta: clonePatchConflictMeta(entry.conflictMeta) }
      : {}),
    ...(entry.note !== undefined ? { note: redact(entry.note) } : {}),
  };
}

function sanitizeMergeDecision(entry: MergeSuggestionDecisionEntry): MergeSuggestionDecisionEntry {
  return {
    id: entry.id,
    ...(entry.decisionId !== undefined ? { decisionId: entry.decisionId } : {}),
    groupId: entry.groupId,
    decision: entry.decision,
    ...(entry.action !== undefined ? { action: entry.action } : {}),
    decidedAt: entry.decidedAt,
    cardIds: [...entry.cardIds],
    ...(entry.selectedCardIds !== undefined ? { selectedCardIds: [...entry.selectedCardIds] } : {}),
    mergedTextDraft: redact(entry.mergedTextDraft),
    editedText: redact(entry.editedText),
    ...(entry.note !== undefined ? { note: redact(entry.note) } : {}),
    ...(entry.snapshotVersion !== undefined ? { snapshotVersion: redact(entry.snapshotVersion) } : {}),
    ...(entry.rationale !== undefined ? { rationale: redact(entry.rationale) } : {}),
    ...(entry.representativeCardId !== undefined
      ? { representativeCardId: entry.representativeCardId }
      : {}),
    ...(entry.representativeResolvedBy !== undefined
      ? { representativeResolvedBy: entry.representativeResolvedBy }
      : {}),
    ...(entry.sourceCardIds !== undefined ? { sourceCardIds: [...entry.sourceCardIds] } : {}),
    ...(entry.missingSourceCardIds !== undefined
      ? { missingSourceCardIds: [...entry.missingSourceCardIds] }
      : {}),
  };
}

function cloneTieBreak(tieBreak: DeterministicTieBreak): DeterministicTieBreak {
  return {
    schemaVersion: tieBreak.schemaVersion,
    order: [...tieBreak.order],
  };
}

function sanitizeShelfEntry(entry: ShelfEntry): ShelfEntry {
  return {
    cardId: entry.cardId,
    shelvedAt: entry.shelvedAt,
    ...(entry.reason !== undefined ? { reason: redact(entry.reason) } : {}),
  };
}

function sanitizeVoidEntry(entry: VoidEntry): VoidEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    title: redact(entry.title),
    detail: redact(entry.detail),
    ...(entry.cardIds !== undefined ? { cardIds: entry.cardIds } : {}),
    ...(entry.islandIds !== undefined ? { islandIds: entry.islandIds } : {}),
    ...(typeof entry.resolved === "boolean" ? { resolved: entry.resolved } : {}),
    createdAt: entry.createdAt,
  };
}

/**
 * Builds a structurally importable SafeMode projection without changing the
 * working Document. The exhaustive field maps above make newly persisted
 * fields a compile-time decision instead of silently copying future free text.
 */
export function deriveDocumentSafeModeProjection(
  document: DocumentV1,
  options: DocumentSafeModeProjectionOptions = {},
): DocumentV1 {
  const includeSourceReferences = options.includeSourceReferences ?? false;
  return {
    version: document.version,
    id: document.id,
    ...(document.title !== undefined ? { title: redact(document.title) } : {}),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    transform: cloneTransform(document.transform),
    cards: document.cards.map((card) =>
      sanitizeCard(card, includeSourceReferences)
    ),
    edges: document.edges.map(sanitizeEdge),
    islands: document.islands.map(sanitizeIsland),
    ...(document.readingOrder !== undefined ? { readingOrder: [...document.readingOrder] } : {}),
    ...(document.narratives !== undefined
      ? { narratives: document.narratives.map(sanitizeNarrative) }
      : {}),
    ...(document.relationSummaries !== undefined
      ? { relationSummaries: document.relationSummaries.map(sanitizeRelationSummary) }
      : {}),
    ...(document.evidenceLinks !== undefined
      ? { evidenceLinks: document.evidenceLinks.map(sanitizeEvidenceLink) }
      : {}),
    ...(document.patchApplyLog !== undefined
      ? { patchApplyLog: document.patchApplyLog.map(sanitizePatchLog) }
      : {}),
    ...(document.mergeSuggestionDecisions !== undefined
      ? { mergeSuggestionDecisions: document.mergeSuggestionDecisions.map(sanitizeMergeDecision) }
      : {}),
    ...(document.critiqueInputs !== undefined
      ? { critiqueInputs: document.critiqueInputs.map(sanitizeCritiqueInput) }
      : {}),
    ...(document.reviewAttribution !== undefined
      ? { reviewAttribution: sanitizeReviewAttribution(document.reviewAttribution) }
      : {}),
    ...(document.deterministicTieBreak !== undefined
      ? { deterministicTieBreak: cloneTieBreak(document.deterministicTieBreak) }
      : {}),
    ...(document.shelf !== undefined ? { shelf: document.shelf.map(sanitizeShelfEntry) } : {}),
    ...(document.voids !== undefined ? { voids: document.voids.map(sanitizeVoidEntry) } : {}),
  };
}

function sanitizeSnapshot(snapshot: RoundSnapshotV1): RoundSnapshotV1 {
  return {
    schemaVersion: snapshot.schemaVersion,
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    canonicalDigest: snapshot.canonicalDigest,
    document: deriveDocumentSafeModeProjection(snapshot.document),
  };
}

function sanitizeBundleContents(bundle: InquiryBundleV1): InquiryBundleV1 {
  return {
    schemaVersion: bundle.schemaVersion,
    journey: sanitizeJourney(bundle.journey),
    snapshots: bundle.snapshots.map(sanitizeSnapshot),
    cardLineage: bundle.cardLineage.map(sanitizeLineage),
    ...(bundle.exportInfo
      ? { exportInfo: structuredClone(bundle.exportInfo) }
      : {}),
  };
}

export function isInquirySafeModeBundle(bundle: InquiryBundleV1): boolean {
  return canonicalizeJson(sanitizeBundleContents(bundle)) === canonicalizeJson(bundle);
}

/**
 * Builds an external-use SafeMode projection without changing the source bundle.
 *
 * The first serialization validates every source field and reference. The second
 * one validates the projection and recomputes snapshot digests after redaction.
 * The returned `safeModeApplied` flag is deliberately out-of-band until the
 * InquiryBundle contract has versioned export metadata.
 */
export async function deriveInquirySafeModeBundle(
  source: InquiryBundleV1
): Promise<InquirySafeModeBundleResult> {
  const validated = await serializeInquiryBundle(source);
  if (!validated.ok) return validated;

  const sanitized = sanitizeBundleContents(validated.bundle);

  const serialized = await serializeInquiryBundle(sanitized);
  if (!serialized.ok) return serialized;
  return { ok: true, bundle: serialized.bundle, safeModeApplied: true };
}
