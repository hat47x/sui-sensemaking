import type {
  Card,
  CardKa,
  CardMeta,
  ContradictionSignalDecision,
  ContradictionSignalReviewStatus,
  DeterministicTieBreak,
  DocumentV1,
  EvidenceLink,
  Island,
  MergeSuggestionDecision,
  MergeSuggestionDecisionEntry,
  Narrative,
  NarrativeCheck,
  NarrativeCheckCounts,
  NarrativeCheckDirection,
  NarrativeCheckIssue,
  NarrativeCheckReference,
  PatchApplyLogEntry,
  PatchApplyStats,
  PatchConflictMeta,
  RelationSummary,
  RelationSummaryHistoryEntry,
  RepresentativeVisualCue,
  ShelfEntry,
  SummaryHistoryEntry,
  Transform,
  VoidEntry,
  VoidKind,
} from "./types";
import { VOID_KINDS } from "./types";
import { KNOWN_EDGE_TYPES } from "./types";
import { canUsePolygonPoints } from "./geometry/polygon_edit";
import {
  validateHilRsCritiqueInput,
  validateHilRsRediffPayload,
  validateHilRsReviewAttribution,
} from "./hil_rs_contract";

type ValidateResult =
  | {
      ok: true;
      document: DocumentV1;
    }
  | {
      ok: false;
      error: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTransform(value: unknown): Transform | null {
  if (!isRecord(value)) {
    return null;
  }

  const panX = toNumber(value.panX);
  const panY = toNumber(value.panY);
  const zoom = toNumber(value.zoom);

  if (panX === null || panY === null || zoom === null) {
    return null;
  }

  return { panX, panY, zoom };
}



function parseClaimType(value: unknown): "fact" | "claim" | "hypothesis" | "unknown" | undefined {
  if (value === "fact" || value === "claim" || value === "hypothesis" || value === "unknown") {
    return value;
  }

  return undefined;
}

function parseCritiqueTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const critiqueTags = value.filter((tag): tag is string => typeof tag === "string");
  if (critiqueTags.length === 0) {
    return undefined;
  }

  return critiqueTags;
}

// DOMAIN-TRACE-01 (schemas.md §15.3): only the KNOWN keys seq/source are
// accepted; unknown meta keys are dropped fail-closed (deliberately the
// OPPOSITE of DOMAIN-KJ-01's unknown-edge-type preservation) so that
// subject/provenance metadata cannot slip in via import before
// CARD-META-UI-01's decision queue settles.
function parseCardMeta(value: unknown): CardMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const seq = typeof value.seq === "number" && Number.isFinite(value.seq) ? value.seq : undefined;
  const source = typeof value.source === "string" && value.source.length > 0 ? value.source : undefined;
  if (seq === undefined && source === undefined) {
    return undefined;
  }

  return {
    ...(seq !== undefined ? { seq } : {}),
    ...(source !== undefined ? { source } : {}),
  };
}

// DOMAIN-KA-01 (schemas.md §17.2): fail-closed to known keys (voice/value),
// mirroring parseCardMeta above. Both empty/missing => omit the whole field.
function parseCardKa(value: unknown): CardKa | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const voice = typeof value.voice === "string" && value.voice.length > 0 ? value.voice : undefined;
  const cardValue = typeof value.value === "string" && value.value.length > 0 ? value.value : undefined;
  if (voice === undefined && cardValue === undefined) {
    return undefined;
  }

  return {
    ...(voice !== undefined ? { voice } : {}),
    ...(cardValue !== undefined ? { value: cardValue } : {}),
  };
}

function parseCards(value: unknown): Card[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const cards: Card[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      return null;
    }

    const x = toNumber(item.x);
    const y = toNumber(item.y);

    if (typeof item.id !== "string" || typeof item.text !== "string" || x === null || y === null) {
      return null;
    }

    cards.push({
      id: item.id,
      text: item.text,
      x,
      y,
      mergedIntoCardId: typeof item.mergedIntoCardId === "string" ? item.mergedIntoCardId : undefined,
      claimType: parseClaimType(item.claimType),
      repOf:
        Array.isArray(item.repOf) && item.repOf.every((cardId) => typeof cardId === "string")
          ? item.repOf
          : undefined,
      canonicalId: typeof item.canonicalId === "string" ? item.canonicalId : undefined,
      sources:
        Array.isArray(item.sources) && item.sources.every((sourceId) => typeof sourceId === "string")
          ? item.sources
          : undefined,
      critique: typeof item.critique === "string" ? item.critique : undefined,
      critiqueTags: parseCritiqueTags(item.critiqueTags),
      textReviewed: typeof item.textReviewed === "boolean" ? item.textReviewed : undefined,
      holdState:
        item.holdState === "held" || item.holdState === "pending" || item.holdState === "shelved"
          ? item.holdState
          : undefined,
      meta: parseCardMeta(item.meta),
      ka: parseCardKa(item.ka),
    });
  }

  return cards;
}


function parseEdges(value: unknown): DocumentV1["edges"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const edges: DocumentV1["edges"] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    // DOMAIN-KJ-01 (schemas.md §3.3.2): an UNKNOWN type string must not cause
    // the edge to be discarded — it is preserved verbatim for round-trip
    // safety and resolved to "related" at display time only. Only a missing/
    // non-string/empty type still drops the edge (structurally invalid).
    if (
      typeof item.id !== "string" ||
      typeof item.fromId !== "string" ||
      typeof item.toId !== "string" ||
      typeof item.type !== "string" ||
      item.type.length === 0
    ) {
      continue;
    }

    edges.push({
      id: item.id,
      fromId: item.fromId,
      toId: item.toId,
      fromKind: item.fromKind === "island" ? "island" : "card",
      toKind: item.toKind === "island" ? "island" : "card",
      type: item.type,
    });
  }

  return edges;
}

function parseIslandGeometry(value: unknown): Island["geometry"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (value.type === "rect") {
    const x = toNumber(value.x);
    const y = toNumber(value.y);
    const w = toNumber(value.w);
    const h = toNumber(value.h);
    return {
      type: "rect",
      x: x ?? undefined,
      y: y ?? undefined,
      w: w ?? undefined,
      h: h ?? undefined,
    };
  }

  if (value.type === "polygon") {
    const rawPoints = Array.isArray(value.points)
      ? value.points
      : isRecord(value.polygon) && Array.isArray(value.polygon.points)
        ? value.polygon.points
        : [];

    const points = rawPoints
      .filter((point): point is { x: number; y: number } => isRecord(point) && toNumber(point.x) !== null && toNumber(point.y) !== null)
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }));

    if (canUsePolygonPoints(points)) {
      return { type: "polygon", points };
    }
  }

  return undefined;
}

function parseSummaryHistory(value: unknown): SummaryHistoryEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries: SummaryHistoryEntry[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.id !== "string"
      || typeof item.createdAt !== "string"
      || (item.fromText !== null && typeof item.fromText !== "string")
      || (item.toText !== null && typeof item.toText !== "string")
      || (item.fromReviewed !== null && typeof item.fromReviewed !== "boolean")
      || (item.toReviewed !== null && typeof item.toReviewed !== "boolean")
      || (item.changeKind !== "manual" && item.changeKind !== "ai" && item.changeKind !== "import" && item.changeKind !== "unknown")
    ) {
      continue;
    }

    entries.push({
      id: item.id,
      createdAt: item.createdAt,
      fromText: item.fromText,
      toText: item.toText,
      fromReviewed: item.fromReviewed,
      toReviewed: item.toReviewed,
      changeKind: item.changeKind,
      ...(typeof item.note === "string" ? { note: item.note } : {}),
      ...(Array.isArray(item.groundingIds)
        ? { groundingIds: item.groundingIds.filter((id): id is string => typeof id === "string") }
        : {}),
    });
  }

  return entries.length > 0 ? entries : undefined;
}

// DOMAIN-VISUAL-CUE-01 (schemas.md §19.3 / §19.6): fail-closed to known keys
// (kind/cueId/altText/imageRef). A cue is invalid as a whole (not just its imageRef)
// when imageRef is present but not a string, regardless of kind; this matches
// models.py RepresentativeVisualCue, which validates before dropping. null is
// treated as an absent imageRef, as models.py does. imageRef is ignored outside
// hand_drawn/user_image (mirrors Card.meta/Card.ka empty-value omission).
function parseRepresentativeCue(value: unknown): RepresentativeVisualCue | undefined {
  if (
    !isRecord(value)
    || (value.kind !== "hand_drawn" && value.kind !== "user_image" && value.kind !== "preset_svg" && value.kind !== "emoji")
    || typeof value.cueId !== "string"
    || typeof value.altText !== "string"
    || (value.imageRef !== undefined && value.imageRef !== null && typeof value.imageRef !== "string")
  ) {
    return undefined;
  }

  const canHaveImageRef = value.kind === "hand_drawn" || value.kind === "user_image";
  return {
    kind: value.kind,
    cueId: value.cueId,
    altText: value.altText,
    ...(canHaveImageRef && typeof value.imageRef === "string" ? { imageRef: value.imageRef } : {}),
  };
}

function parseIslands(value: unknown): Island[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const islands: Island[] = [];

  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || !Array.isArray(item.cardIds)) {
      continue;
    }

    const cardIds = item.cardIds.filter((cardId): cardId is string => typeof cardId === "string");
    let shape: Island["shape"] | undefined;
    const geometry = parseIslandGeometry(item.geometry);
    if (isRecord(item.shape)) {
      const kind = item.shape.kind;
      let generatedFrom: { cardIds: string[]; versionToken: string } | undefined;

      if (isRecord(item.shape.generatedFrom) && Array.isArray(item.shape.generatedFrom.cardIds)) {
        const generatedFromCardIds = item.shape.generatedFrom.cardIds.filter(
          (cardId): cardId is string => typeof cardId === "string"
        );

        if (typeof item.shape.generatedFrom.versionToken === "string") {
          generatedFrom = {
            cardIds: generatedFromCardIds,
            versionToken: item.shape.generatedFrom.versionToken,
          };
        }
      }

      if (kind === "rect") {
        shape = { kind: "rect", generatedFrom };
      } else if (kind === "polygon" && Array.isArray(item.shape.points)) {
        const points = item.shape.points
          .filter((point): point is { x: number; y: number } => {
            return isRecord(point) && toNumber(point.x) !== null && toNumber(point.y) !== null;
          })
          .map((point) => ({ x: Number(point.x), y: Number(point.y) }));

        if (canUsePolygonPoints(points)) {
          shape = { kind: "polygon", points, generatedFrom };
        }
      }
    }

    if (!shape && geometry?.type === "polygon") {
      shape = {
        kind: "polygon",
        points: geometry.points,
      };
    }

    if (!shape && geometry?.type === "rect") {
      shape = { kind: "rect" };
    }

    if (!shape && !geometry) {
      shape = { kind: "rect" };
    }

    const normalizedGeometry = geometry
      ?? (shape?.kind === "polygon"
        ? { type: "polygon", points: shape.points }
        : shape?.kind === "rect"
          ? { type: "rect" }
          : undefined);
    islands.push({
      id: item.id,
      cardIds,
      parentIslandId: typeof item.parentIslandId === "string" ? item.parentIslandId : undefined,
      placardCardId: typeof item.placardCardId === "string" ? item.placardCardId : undefined,
      collapsed: typeof item.collapsed === "boolean" ? item.collapsed : false,
      title: typeof item.title === "string" ? item.title : undefined,
      titleReviewed: typeof item.titleReviewed === "boolean" ? item.titleReviewed : undefined,
      summaryText: typeof item.summaryText === "string" ? item.summaryText : undefined,
      summaryReviewed: typeof item.summaryReviewed === "boolean" ? item.summaryReviewed : undefined,
      summaryGrounding: Array.isArray(item.summaryGrounding)
        ? item.summaryGrounding.filter((id): id is string => typeof id === "string")
        : undefined,
      summaryHistory: parseSummaryHistory(item.summaryHistory),
      imageUrl: typeof item.imageUrl === "string" ? item.imageUrl : undefined,
      imageReviewed: typeof item.imageReviewed === "boolean" ? item.imageReviewed : undefined,
      critique: typeof item.critique === "string" ? item.critique : undefined,
      critiqueTags: parseCritiqueTags(item.critiqueTags),
      geometry: normalizedGeometry,
      shape,
      shapeStale: typeof item.shapeStale === "boolean" ? item.shapeStale : undefined,
      representativeCue: parseRepresentativeCue(item.representativeCue),
    });
  }

  const islandsById = new Map(islands.map((island) => [island.id, island]));

  const resolveParentIslandId = (islandId: string, parentIslandId: string | undefined): string | undefined => {
    if (!parentIslandId) {
      return undefined;
    }

    const visited = new Set<string>([islandId]);
    let cursor: string | undefined = parentIslandId;

    while (cursor) {
      if (visited.has(cursor)) {
        return undefined;
      }

      const parent = islandsById.get(cursor);
      if (!parent) {
        return undefined;
      }

      visited.add(cursor);
      cursor = parent.parentIslandId;
    }

    return parentIslandId;
  };

  return islands.map((island) => {
    const parentIslandId = resolveParentIslandId(island.id, island.parentIslandId);
    if (parentIslandId === island.parentIslandId) {
      return island;
    }

    return {
      ...island,
      parentIslandId,
    };
  });
}


function parseEvidenceLinks(value: unknown): EvidenceLink[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const evidenceLinks: EvidenceLink[] = [];
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    if (typeof item.id !== "string" || typeof item.fromCardId !== "string" || typeof item.toCardId !== "string") {
      continue;
    }

    if (item.type !== "supports" && item.type !== "contradicts") {
      continue;
    }

    if (item.fromCardId === item.toCardId || seenIds.has(item.id)) {
      continue;
    }

    const duplicateKey = `${item.fromCardId}:${item.toCardId}:${item.type}`;
    if (seenKeys.has(duplicateKey)) {
      continue;
    }

    seenIds.add(item.id);
    seenKeys.add(duplicateKey);
    evidenceLinks.push({
      id: item.id,
      type: item.type,
      fromCardId: item.fromCardId,
      toCardId: item.toCardId,
      note: typeof item.note === "string" ? item.note : undefined,
      createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
      ...(item.contradictionState === "unconfirmed"
        || item.contradictionState === "confirmed"
        || item.contradictionState === "held"
        || item.contradictionState === "resolved"
        ? { contradictionState: item.contradictionState }
        : {}),
    });
  }

  return evidenceLinks;
}

function parseCritiqueInputs(value: unknown): DocumentV1["critiqueInputs"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter(validateHilRsCritiqueInput);
}

function parseShelf(value: unknown, cardIds: Set<string>): ShelfEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const shelf: ShelfEntry[] = [];
  const seenCardIds = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.cardId !== "string"
      || !cardIds.has(item.cardId)
      || seenCardIds.has(item.cardId)
      || typeof item.shelvedAt !== "string"
      || Number.isNaN(Date.parse(item.shelvedAt))
      || (item.reason !== undefined && typeof item.reason !== "string")
    ) {
      continue;
    }

    seenCardIds.add(item.cardId);
    shelf.push({
      cardId: item.cardId,
      shelvedAt: new Date(item.shelvedAt).toISOString(),
      ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
    });
  }

  return shelf.length > 0 ? shelf : undefined;
}

function parseVoids(value: unknown): VoidEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const voids: VoidEntry[] = [];
  const seenIds = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.id !== "string"
      || seenIds.has(item.id)
      || typeof item.title !== "string"
      || typeof item.detail !== "string"
      || !VOID_KINDS.includes(item.kind as VoidKind)
      || typeof item.createdAt !== "string"
      || Number.isNaN(Date.parse(item.createdAt))
    ) {
      continue;
    }

    seenIds.add(item.id);
    voids.push({
      id: item.id,
      kind: item.kind as VoidKind,
      title: item.title,
      detail: item.detail,
      ...(Array.isArray(item.cardIds)
        ? { cardIds: item.cardIds.filter((ref): ref is string => typeof ref === "string") }
        : {}),
      ...(Array.isArray(item.islandIds)
        ? { islandIds: item.islandIds.filter((ref): ref is string => typeof ref === "string") }
        : {}),
      ...(typeof item.resolved === "boolean" ? { resolved: item.resolved } : {}),
      createdAt: new Date(item.createdAt).toISOString(),
    });
  }

  return voids.length > 0 ? voids : undefined;
}

function parseReproposalDiffs(value: unknown): DocumentV1["reproposalDiffs"] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter(validateHilRsRediffPayload);
}

function parseReviewAttribution(value: unknown): DocumentV1["reviewAttribution"] | undefined {
  return validateHilRsReviewAttribution(value) ? value : undefined;
}

function parseDeterministicTieBreak(value: unknown): DeterministicTieBreak | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const expectedOrder: DeterministicTieBreak["order"] = [
    "padding_compliance",
    "self_intersection_avoidance",
    "minimum_area_delta",
    "minimum_vertex_count",
  ];
  const order = value.order;
  if (
    value.schemaVersion !== "1.0.0"
    || !Array.isArray(order)
    || expectedOrder.some((entry, index) => order[index] !== entry)
  ) {
    return undefined;
  }

  return {
    schemaVersion: "1.0.0",
    order: expectedOrder,
  };
}

function parseReadingOrder(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ids = value.filter((id): id is string => typeof id === "string");
  return ids.length > 0 ? ids : undefined;
}

function parseNarrativeCheckReference(value: unknown): NarrativeCheckReference | null {
  if (!isRecord(value) || typeof value.id !== "string" || (value.kind !== "card" && value.kind !== "island")) {
    return null;
  }

  return { id: value.id, kind: value.kind };
}

function parseNarrativeCheckDirection(value: unknown): NarrativeCheckDirection | null {
  return value === "b_missing_in_a" || value === "a_missing_in_b" ? value : null;
}

function parseNarrativeCheckCounts(value: unknown): NarrativeCheckCounts | null {
  if (
    !isRecord(value)
    || typeof value.bMissingInA !== "number"
    || !Number.isInteger(value.bMissingInA)
    || value.bMissingInA < 0
    || typeof value.aMissingInB !== "number"
    || !Number.isInteger(value.aMissingInB)
    || value.aMissingInB < 0
  ) {
    return null;
  }
  return { bMissingInA: value.bMissingInA, aMissingInB: value.aMissingInB };
}

function parseNarrativeCheckIssue(value: unknown): NarrativeCheckIssue | null {
  if (
    !isRecord(value)
    || (value.severity !== "info" && value.severity !== "warn" && value.severity !== "error")
    || typeof value.message !== "string"
  ) {
    return null;
  }

  const direction = parseNarrativeCheckDirection(value.direction);

  return {
    severity: value.severity,
    message: value.message,
    ...(Array.isArray(value.references)
      ? { references: value.references.map(parseNarrativeCheckReference).filter((ref): ref is NarrativeCheckReference => ref !== null) }
      : {}),
    ...(direction ? { direction } : {}),
  };
}

function parseNarrativeCheck(value: unknown): NarrativeCheck | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.createdAt !== "string"
    || value.kind !== "consistency"
    || !Array.isArray(value.issues)
  ) {
    return null;
  }

  const counts = parseNarrativeCheckCounts(value.counts);

  return {
    id: value.id,
    createdAt: value.createdAt,
    kind: "consistency",
    issues: value.issues.map(parseNarrativeCheckIssue).filter((issue): issue is NarrativeCheckIssue => issue !== null),
    ...(counts ? { counts } : {}),
  };
}

function parseRelationSummaryHistoryEntry(value: unknown): RelationSummaryHistoryEntry | null {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.createdAt !== "string"
    || (value.changeKind !== "ai" && value.changeKind !== "manual" && value.changeKind !== "rollback" && value.changeKind !== "import" && value.changeKind !== "unknown")
    || !(typeof value.fromText === "string" || value.fromText === null)
    || !(typeof value.toText === "string" || value.toText === null)
    || !(typeof value.fromReviewed === "boolean" || value.fromReviewed === null)
    || !(typeof value.toReviewed === "boolean" || value.toReviewed === null)
  ) {
    return null;
  }

  return {
    id: value.id,
    createdAt: value.createdAt,
    changeKind: value.changeKind,
    fromText: value.fromText,
    toText: value.toText,
    fromReviewed: value.fromReviewed,
    toReviewed: value.toReviewed,
    ...(Array.isArray(value.warningsSnapshot)
      ? { warningsSnapshot: value.warningsSnapshot.filter((w): w is string => typeof w === "string") }
      : {}),
    ...(Array.isArray(value.groundingCardIdsSnapshot)
      ? { groundingCardIdsSnapshot: value.groundingCardIdsSnapshot.filter((id): id is string => typeof id === "string") }
      : {}),
    ...(Array.isArray(value.groundingEdgeIdsSnapshot)
      ? { groundingEdgeIdsSnapshot: value.groundingEdgeIdsSnapshot.filter((id): id is string => typeof id === "string") }
      : {}),
  };
}

function parseNarratives(value: unknown): Narrative[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const narratives: Narrative[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.id !== "string"
      || typeof item.title !== "string"
      || typeof item.text !== "string"
      || typeof item.reviewed !== "boolean"
    ) {
      continue;
    }

    narratives.push({
      id: item.id,
      title: item.title,
      text: item.text,
      reviewed: item.reviewed,
      ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
      ...(Array.isArray(item.basedOnReadingOrder)
        ? { basedOnReadingOrder: item.basedOnReadingOrder.filter((id): id is string => typeof id === "string") }
        : {}),
      ...(Array.isArray(item.checks)
        ? { checks: item.checks.map(parseNarrativeCheck).filter((check): check is NarrativeCheck => check !== null) }
        : {}),
    });
  }

  return narratives.length > 0 ? narratives : undefined;
}

function parseRelationSummaries(value: unknown): RelationSummary[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const summaries: RelationSummary[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.id !== "string"
      || typeof item.createdAt !== "string"
      || typeof item.islandAId !== "string"
      || typeof item.islandBId !== "string"
      || typeof item.relationType !== "string"
      || typeof item.derived !== "boolean"
      || typeof item.text !== "string"
      || typeof item.reviewed !== "boolean"
      || !Array.isArray(item.groundingCardIds)
      || !Array.isArray(item.groundingEdgeIds)
      || typeof item.sourceSignature !== "string"
    ) {
      continue;
    }

    // DOMAIN-KJ-01: unknown relationType no longer drops the whole summary —
    // it is normalized to "unknown" (the row is regenerable derived data, so
    // unlike Edge.type the original string need not be preserved verbatim).
    const relationType: RelationSummary["relationType"] =
      (KNOWN_EDGE_TYPES as readonly string[]).includes(item.relationType) || item.relationType === "unknown"
        ? (item.relationType as RelationSummary["relationType"])
        : "unknown";

    summaries.push({
      id: item.id,
      createdAt: item.createdAt,
      islandAId: item.islandAId,
      islandBId: item.islandBId,
      relationType,
      derived: item.derived,
      text: item.text,
      reviewed: item.reviewed,
      groundingCardIds: item.groundingCardIds.filter((id): id is string => typeof id === "string"),
      groundingEdgeIds: item.groundingEdgeIds.filter((id): id is string => typeof id === "string"),
      sourceSignature: item.sourceSignature,
      ...(Array.isArray(item.warnings)
        ? { warnings: item.warnings.filter((w): w is string => typeof w === "string") }
        : {}),
      ...(Array.isArray(item.history)
        ? { history: item.history.map(parseRelationSummaryHistoryEntry).filter((entry): entry is RelationSummaryHistoryEntry => entry !== null) }
        : {}),
    });
  }

  return summaries.length > 0 ? summaries : undefined;
}

function parsePatchApplyStats(value: unknown): PatchApplyStats | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const keys = [
    "upsertCards",
    "deleteCards",
    "upsertIslands",
    "deleteIslands",
    "upsertEdges",
    "deleteEdges",
    "upsertRelationSummaries",
    "deleteRelationSummaries",
    "upsertEvidenceLinks",
    "deleteEvidenceLinks",
  ] as const;

  if (keys.some((key) => typeof value[key] !== "number" || !Number.isFinite(value[key]))) {
    return undefined;
  }

  const stats = {} as PatchApplyStats;
  for (const key of keys) {
    stats[key] = value[key] as number;
  }
  return stats;
}

function parsePatchConflictMeta(value: unknown): PatchConflictMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const keys = ["totalConflicts", "chosenYours", "chosenTheirs", "chosenSkip"] as const;
  if (keys.some((key) => typeof value[key] !== "number" || !Number.isFinite(value[key]))) {
    return undefined;
  }

  const meta = {} as PatchConflictMeta;
  for (const key of keys) {
    meta[key] = value[key] as number;
  }
  return meta;
}

function parsePatchApplyLog(value: unknown): PatchApplyLogEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries: PatchApplyLogEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.createdAt !== "string" || item.patchVersion !== "1" || !Array.isArray(item.appliedOpIds)) {
      continue;
    }

    const stats = parsePatchApplyStats(item.stats);
    if (!stats) {
      continue;
    }

    const conflictMeta = item.conflictMeta !== undefined ? parsePatchConflictMeta(item.conflictMeta) : undefined;

    entries.push({
      id: item.id,
      createdAt: item.createdAt,
      patchVersion: "1",
      appliedOpIds: item.appliedOpIds.filter((id): id is string => typeof id === "string"),
      stats,
      ...(typeof item.patchTitle === "string" ? { patchTitle: item.patchTitle } : {}),
      ...(typeof item.baseDocSignature === "string" ? { baseDocSignature: item.baseDocSignature } : {}),
      ...(typeof item.patchSourceSignature === "string" ? { patchSourceSignature: item.patchSourceSignature } : {}),
      ...(conflictMeta ? { conflictMeta } : {}),
      ...(typeof item.note === "string" ? { note: item.note } : {}),
    });
  }

  return entries.length > 0 ? entries : undefined;
}

function isMergeSuggestionDecision(value: unknown): value is MergeSuggestionDecision {
  return value === "accept" || value === "partial" || value === "reject" || value === "defer";
}

function isRepresentativeResolvedBy(
  value: unknown
): value is "repOf" | "mergedIntoCardId" | "fallback" | "unresolved" {
  return value === "repOf" || value === "mergedIntoCardId" || value === "fallback" || value === "unresolved";
}

function parseMergeSuggestionDecisions(value: unknown): MergeSuggestionDecisionEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries: MergeSuggestionDecisionEntry[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.id !== "string"
      || typeof item.groupId !== "string"
      || !isMergeSuggestionDecision(item.decision)
      || typeof item.decidedAt !== "string"
      || !Array.isArray(item.cardIds)
      || typeof item.mergedTextDraft !== "string"
      || typeof item.editedText !== "string"
    ) {
      continue;
    }

    entries.push({
      id: item.id,
      groupId: item.groupId,
      decision: item.decision,
      decidedAt: item.decidedAt,
      cardIds: item.cardIds.filter((id): id is string => typeof id === "string"),
      mergedTextDraft: item.mergedTextDraft,
      editedText: item.editedText,
      ...(typeof item.decisionId === "string" ? { decisionId: item.decisionId } : {}),
      ...(item.action !== undefined && isMergeSuggestionDecision(item.action) ? { action: item.action } : {}),
      ...(typeof item.decidedBy === "string" ? { decidedBy: item.decidedBy } : {}),
      ...(Array.isArray(item.selectedCardIds)
        ? { selectedCardIds: item.selectedCardIds.filter((id): id is string => typeof id === "string") }
        : {}),
      ...(typeof item.note === "string" ? { note: item.note } : {}),
      ...(typeof item.snapshotVersion === "string" ? { snapshotVersion: item.snapshotVersion } : {}),
      ...(typeof item.rationale === "string" ? { rationale: item.rationale } : {}),
      ...((item.mergeMethod === "near_duplicate" || item.mergeMethod === "kernel_fusion")
        ? { mergeMethod: item.mergeMethod }
        : {}),
      ...(typeof item.representativeCardId === "string" ? { representativeCardId: item.representativeCardId } : {}),
      ...(isRepresentativeResolvedBy(item.representativeResolvedBy)
        ? { representativeResolvedBy: item.representativeResolvedBy }
        : {}),
      ...(Array.isArray(item.sourceCardIds)
        ? { sourceCardIds: item.sourceCardIds.filter((id): id is string => typeof id === "string") }
        : {}),
      ...(Array.isArray(item.missingSourceCardIds)
        ? { missingSourceCardIds: item.missingSourceCardIds.filter((id): id is string => typeof id === "string") }
        : {}),
    });
  }

  return entries.length > 0 ? entries : undefined;
}

function isContradictionSignalReviewStatus(value: unknown): value is ContradictionSignalReviewStatus {
  return value === "accepted" || value === "held" || value === "rejected";
}

// DOMAIN-EXPR-04 (schemas.md §16.2/16.6): fail-closed on malformed entries,
// preserving the rest — mirrors parseMergeSuggestionDecisions above.
function parseContradictionSignalDecisions(value: unknown): ContradictionSignalDecision[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const entries: ContradictionSignalDecision[] = [];
  for (const item of value) {
    if (
      !isRecord(item)
      || typeof item.signatureKey !== "string"
      || item.signatureKey.length === 0
      || !isContradictionSignalReviewStatus(item.status)
      || typeof item.decidedAt !== "string"
    ) {
      continue;
    }

    entries.push({
      signatureKey: item.signatureKey,
      status: item.status,
      decidedAt: item.decidedAt,
    });
  }

  return entries.length > 0 ? entries : undefined;
}

function parseIsoDate(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return fallback;
  }

  return new Date(timestamp).toISOString();
}

export function validateImportedDocument(value: unknown): ValidateResult {
  if (!isRecord(value)) {
    return { ok: false, error: "Imported data must be a JSON object." };
  }

  if (!("version" in value)) {
    return { ok: false, error: "Document version is required." };
  }

  if (value.version !== 1) {
    return { ok: false, error: "Unsupported document version. Only numeric version 1 is supported." };
  }

  if (!("id" in value) || !("transform" in value) || !("cards" in value) || !("edges" in value) || !("islands" in value)) {
    return { ok: false, error: "Document must include id, transform, cards, edges, and islands." };
  }

  if (typeof value.id !== "string") {
    return { ok: false, error: "Document id must be a string." };
  }

  const transform = parseTransform(value.transform);
  if (!transform) {
    return { ok: false, error: "Document transform must include numeric panX, panY, and zoom." };
  }

  const cards = parseCards(value.cards);
  if (!cards) {
    return { ok: false, error: "Document cards must be an array of {id, text, x, y}." };
  }

  if (!Array.isArray(value.edges)) {
    return { ok: false, error: "Document edges must be an array." };
  }

  if (!Array.isArray(value.islands)) {
    return { ok: false, error: "Document islands must be an array." };
  }

  const now = new Date().toISOString();
  const createdAt = parseIsoDate(value.createdAt, now);
  const updatedAt = parseIsoDate(value.updatedAt, now);
  const critiqueInputs = parseCritiqueInputs(value.critiqueInputs);
  const reproposalDiffs = parseReproposalDiffs(value.reproposalDiffs);
  const reviewAttribution = parseReviewAttribution(value.reviewAttribution);
  const deterministicTieBreak = parseDeterministicTieBreak(value.deterministicTieBreak);
  const readingOrder = parseReadingOrder(value.readingOrder);
  const narratives = parseNarratives(value.narratives);
  const relationSummaries = parseRelationSummaries(value.relationSummaries);
  const patchApplyLog = parsePatchApplyLog(value.patchApplyLog);
  const mergeSuggestionDecisions = parseMergeSuggestionDecisions(value.mergeSuggestionDecisions);
  const contradictionSignalDecisions = parseContradictionSignalDecisions(value.contradictionSignalDecisions);
  const shelf = parseShelf(value.shelf, new Set(cards.map((card) => card.id)));
  const voids = parseVoids(value.voids);
  const shelvedCardIds = new Set((shelf ?? []).map((entry) => entry.cardId));
  const normalizedCards = shelvedCardIds.size === 0
    ? cards
    : cards.map((card) => shelvedCardIds.has(card.id) ? { ...card, holdState: "shelved" as const } : card);

  return {
    ok: true,
    document: {
      version: 1,
      id: value.id,
      title: typeof value.title === "string" ? value.title : undefined,
      createdAt,
      updatedAt,
      transform,
      cards: normalizedCards,
      edges: parseEdges(value.edges),
      islands: parseIslands(value.islands),
      evidenceLinks: parseEvidenceLinks(value.evidenceLinks) ?? [],
      ...(critiqueInputs !== undefined ? { critiqueInputs } : {}),
      ...(reproposalDiffs !== undefined ? { reproposalDiffs } : {}),
      ...(reviewAttribution !== undefined ? { reviewAttribution } : {}),
      ...(deterministicTieBreak !== undefined ? { deterministicTieBreak } : {}),
      ...(readingOrder !== undefined ? { readingOrder } : {}),
      ...(narratives !== undefined ? { narratives } : {}),
      ...(relationSummaries !== undefined ? { relationSummaries } : {}),
      ...(patchApplyLog !== undefined ? { patchApplyLog } : {}),
      ...(mergeSuggestionDecisions !== undefined ? { mergeSuggestionDecisions } : {}),
      ...(contradictionSignalDecisions !== undefined ? { contradictionSignalDecisions } : {}),
      ...(shelf !== undefined ? { shelf } : {}),
      ...(voids !== undefined ? { voids } : {}),
    },
  };
}
