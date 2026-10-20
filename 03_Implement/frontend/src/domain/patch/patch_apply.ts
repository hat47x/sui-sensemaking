import type { Card, DocumentV1, Edge, Island, PatchApplyStats, PatchConflictMeta, RelationSummary } from "../types";
import { KNOWN_EDGE_TYPES } from "../types";
import type { PatchOp, PatchOpKind, PatchV1 } from "./patch_types";
import { detectPatchConflicts } from "./conflict_detect";
import type { PatchLintResult } from "./patch_lint";

export type PatchDocument = PatchV1;
export type { PatchOp, PatchOpKind } from "./patch_types";

export type PatchResolution = "yours" | "theirs" | "skip";

export type ApplyResultMeta = {
  appliedOpIds: string[];
  stats: PatchApplyStats;
  conflictMeta?: PatchConflictMeta;
  patchTitle?: string;
  baseDocSignature?: string;
  note?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCritiqueHistory(value: unknown): boolean {
  return Array.isArray(value) && value.every((entry) => (
    isRecord(entry)
    && typeof entry.id === "string"
    && typeof entry.createdAt === "string"
    && (entry.fromCritique === null || typeof entry.fromCritique === "string")
    && (entry.toCritique === null || typeof entry.toCritique === "string")
    && (entry.fromTags === null || isStringArray(entry.fromTags))
    && (entry.toTags === null || isStringArray(entry.toTags))
    && (entry.changeKind === "manual"
      || entry.changeKind === "import"
      || entry.changeKind === "rollback"
      || entry.changeKind === "unknown")
    && (entry.note === undefined || typeof entry.note === "string")
  ));
}

function parseCard(value: unknown): Card | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string" || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return null;
  }

  if (value.canonicalId !== undefined && typeof value.canonicalId !== "string") return null;
  if (value.sources !== undefined && !isStringArray(value.sources)) return null;
  if (value.critique !== undefined && typeof value.critique !== "string") return null;
  if (value.critiqueTags !== undefined && !isStringArray(value.critiqueTags)) return null;
  if (value.critiqueHistory !== undefined && !isCritiqueHistory(value.critiqueHistory)) return null;
  if (value.textReviewed !== undefined && typeof value.textReviewed !== "boolean") return null;

  // DOMAIN-TRACE-01 (schemas.md §15.3) / DOMAIN-KA-01 (schemas.md §17.2):
  // `value as Card` would smuggle raw meta/ka objects (including unknown
  // keys) straight through this patch path, so both are explicitly rebuilt
  // from known keys only whenever present.
  let sanitized: Record<string, unknown> = value;

  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) return null;
    const seq = typeof value.meta.seq === "number" && isFiniteNumber(value.meta.seq) ? value.meta.seq : undefined;
    const source = typeof value.meta.source === "string" && value.meta.source.length > 0 ? value.meta.source : undefined;
    const sanitizedMeta =
      seq === undefined && source === undefined
        ? undefined
        : { ...(seq !== undefined ? { seq } : {}), ...(source !== undefined ? { source } : {}) };
    const { meta: _rawMeta, ...restAfterMeta } = sanitized;
    sanitized = sanitizedMeta ? { ...restAfterMeta, meta: sanitizedMeta } : restAfterMeta;
  }

  if (value.ka !== undefined) {
    if (!isRecord(value.ka)) return null;
    const voice = typeof value.ka.voice === "string" && value.ka.voice.length > 0 ? value.ka.voice : undefined;
    const kaValue = typeof value.ka.value === "string" && value.ka.value.length > 0 ? value.ka.value : undefined;
    const sanitizedKa =
      voice === undefined && kaValue === undefined
        ? undefined
        : { ...(voice !== undefined ? { voice } : {}), ...(kaValue !== undefined ? { value: kaValue } : {}) };
    const { ka: _rawKa, ...restAfterKa } = sanitized;
    sanitized = sanitizedKa ? { ...restAfterKa, ka: sanitizedKa } : restAfterKa;
  }

  return sanitized as Card;
}

function parseEdge(value: unknown): Edge | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.fromId !== "string" || typeof value.toId !== "string") {
    return null;
  }

  // DOMAIN-KJ-01 (schemas.md §3.3.2): unknown type strings are PRESERVED,
  // not rejected — same rule as validate.ts. Only a missing/non-string/empty
  // type invalidates the edge.
  if (typeof value.type !== "string" || value.type.length === 0) return null;
  if (value.fromKind !== undefined && value.fromKind !== "card" && value.fromKind !== "island") return null;
  if (value.toKind !== undefined && value.toKind !== "card" && value.toKind !== "island") return null;

  return value as Edge;
}

function parseIsland(value: unknown): Island | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isStringArray(value.cardIds)) {
    return null;
  }

  if (value.parentIslandId !== undefined && typeof value.parentIslandId !== "string") return null;
  if (value.placardCardId !== undefined && typeof value.placardCardId !== "string") return null;
  if (value.collapsed !== undefined && typeof value.collapsed !== "boolean") return null;
  if (value.title !== undefined && typeof value.title !== "string") return null;
  if (value.titleReviewed !== undefined && typeof value.titleReviewed !== "boolean") return null;
  if (value.summaryText !== undefined && typeof value.summaryText !== "string") return null;
  if (value.summaryReviewed !== undefined && typeof value.summaryReviewed !== "boolean") return null;
  if (value.summaryGrounding !== undefined && !isStringArray(value.summaryGrounding)) return null;
  if (value.imageUrl !== undefined && typeof value.imageUrl !== "string") return null;
  if (value.imageReviewed !== undefined && typeof value.imageReviewed !== "boolean") return null;
  if (value.critique !== undefined && typeof value.critique !== "string") return null;
  if (value.critiqueTags !== undefined && !isStringArray(value.critiqueTags)) return null;
  if (value.shapeStale !== undefined && typeof value.shapeStale !== "boolean") return null;

  return value as Island;
}

function parseRelationSummary(value: unknown): RelationSummary | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.islandAId !== "string" ||
    typeof value.islandBId !== "string" ||
    (value.relationType !== "unknown" &&
      !(typeof value.relationType === "string" && (KNOWN_EDGE_TYPES as readonly string[]).includes(value.relationType))) ||
    typeof value.derived !== "boolean" ||
    typeof value.text !== "string" ||
    typeof value.reviewed !== "boolean" ||
    !isStringArray(value.groundingCardIds) ||
    !isStringArray(value.groundingEdgeIds) ||
    typeof value.sourceSignature !== "string"
  ) {
    return null;
  }

  if (value.warnings !== undefined && !isStringArray(value.warnings)) return null;

  return value as RelationSummary;
}

export function parsePatchOp(item: unknown): PatchOp | null {
  if (!isRecord(item) || typeof item.id !== "string" || typeof item.kind !== "string") {
    return null;
  }

  if (item.kind === "upsert_card") {
    const card = parseCard(item.card);
    if (!card) return null;
    return { id: item.id, kind: item.kind, card };
  }

  if (item.kind === "delete_card" && typeof item.cardId === "string") {
    return { id: item.id, kind: item.kind, cardId: item.cardId };
  }

  if (item.kind === "upsert_island") {
    const island = parseIsland(item.island);
    if (!island) return null;
    return { id: item.id, kind: item.kind, island };
  }

  if (item.kind === "delete_island" && typeof item.islandId === "string") {
    return { id: item.id, kind: item.kind, islandId: item.islandId };
  }

  if (item.kind === "upsert_edge") {
    const edge = parseEdge(item.edge);
    if (!edge) return null;
    return { id: item.id, kind: item.kind, edge };
  }

  if (item.kind === "delete_edge" && typeof item.edgeId === "string") {
    return { id: item.id, kind: item.kind, edgeId: item.edgeId };
  }

  if (item.kind === "upsert_relation_summary") {
    const relationSummary = parseRelationSummary(item.relationSummary);
    if (!relationSummary) return null;
    return { id: item.id, kind: item.kind, relationSummary };
  }

  if (item.kind === "delete_relation_summary" && typeof item.sourceSignature === "string") {
    return { id: item.id, kind: item.kind, sourceSignature: item.sourceSignature };
  }

  if (item.kind === "upsert_evidence_link") {
    const evidenceLink = parseEvidenceLink(item.evidenceLink);
    if (!evidenceLink) return null;
    return { id: item.id, kind: item.kind, evidenceLink };
  }

  if (item.kind === "delete_evidence_link" && typeof item.evidenceLinkId === "string") {
    return { id: item.id, kind: item.kind, evidenceLinkId: item.evidenceLinkId };
  }

  return null;
}

export function parsePatchDocument(value: unknown): PatchDocument | null {
  if (!isRecord(value) || value.kind !== "sui-sensemaking-patch" || value.version !== 1 || !Array.isArray(value.ops)) {
    return null;
  }

  if (value.author !== undefined && typeof value.author !== "string") return null;
  if (value.authorNote !== undefined && typeof value.authorNote !== "string") return null;
  if (value.sourceApp !== undefined && typeof value.sourceApp !== "string") return null;
  if (value.patchFingerprint !== undefined && typeof value.patchFingerprint !== "string") return null;
  if (value.patchId !== undefined && typeof value.patchId !== "string") return null;

  const ops: PatchOp[] = [];

  for (const item of value.ops) {
    const op = parsePatchOp(item);
    if (!op) return null;
    ops.push(op);
  }

  return {
    kind: "sui-sensemaking-patch",
    version: 1,
    baseDocSignature: typeof value.baseDocSignature === "string" ? value.baseDocSignature : undefined,
    author: typeof value.author === "string" ? value.author : undefined,
    authorNote: typeof value.authorNote === "string" ? value.authorNote : undefined,
    sourceApp: typeof value.sourceApp === "string" ? value.sourceApp : undefined,
    patchFingerprint: typeof value.patchFingerprint === "string" ? value.patchFingerprint : undefined,
    patchId: typeof value.patchId === "string" ? value.patchId : undefined,
    ops,
  };
}

function parseEvidenceLink(value: unknown): NonNullable<DocumentV1["evidenceLinks"]>[number] | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.fromCardId !== "string" || typeof value.toCardId !== "string") return null;
  if (value.type !== "supports" && value.type !== "contradicts") return null;
  if (value.fromCardId === value.toCardId) return null;

  return {
    id: value.id,
    type: value.type,
    fromCardId: value.fromCardId,
    toCardId: value.toCardId,
    note: typeof value.note === "string" ? value.note : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
  };
}

export function shouldBlockPatchApplyByLint(lintResult: PatchLintResult | null): boolean {
  if (!lintResult) {
    return false;
  }

  return lintResult.issues.some((issue) => issue.severity === "error");
}

export function getPatchOpEntityKey(op: PatchOp): string {
  switch (op.kind) {
    case "upsert_card":
      return `card:${op.card.id}`;
    case "delete_card":
      return `card:${op.cardId}`;
    case "upsert_island":
      return `island:${op.island.id}`;
    case "delete_island":
      return `island:${op.islandId}`;
    case "upsert_edge":
      return `edge:${op.edge.id}`;
    case "delete_edge":
      return `edge:${op.edgeId}`;
    case "upsert_relation_summary":
      return `relSummary:${op.relationSummary.sourceSignature}`;
    case "delete_relation_summary":
      return `relSummary:${op.sourceSignature}`;
    case "upsert_evidence_link":
      return `evidenceLink:${op.evidenceLink.id}`;
    case "delete_evidence_link":
      return `evidenceLink:${op.evidenceLinkId}`;
  }
}

function upsertById<T extends { id: string }>(items: T[], value: T): T[] {
  const index = items.findIndex((item) => item.id === value.id);
  if (index < 0) {
    return [...items, value];
  }

  const next = [...items];
  next[index] = value;
  return next;
}

function applyPatchOp(currentDoc: DocumentV1, op: PatchOp): DocumentV1 {
  switch (op.kind) {
    case "upsert_card":
      return { ...currentDoc, cards: upsertById(currentDoc.cards, op.card) };
    case "delete_card":
      return {
        ...currentDoc,
        cards: currentDoc.cards.filter((card) => card.id !== op.cardId),
        evidenceLinks: (currentDoc.evidenceLinks ?? []).filter((link) => link.fromCardId !== op.cardId && link.toCardId !== op.cardId),
      };
    case "upsert_island":
      return { ...currentDoc, islands: upsertById(currentDoc.islands, op.island) };
    case "delete_island":
      return { ...currentDoc, islands: currentDoc.islands.filter((island) => island.id !== op.islandId) };
    case "upsert_edge":
      return { ...currentDoc, edges: upsertById(currentDoc.edges, op.edge) };
    case "delete_edge":
      return { ...currentDoc, edges: currentDoc.edges.filter((edge) => edge.id !== op.edgeId) };
    case "upsert_relation_summary": {
      const existing = currentDoc.relationSummaries ?? [];
      const index = existing.findIndex((summary) => summary.sourceSignature === op.relationSummary.sourceSignature);
      if (index < 0) {
        return { ...currentDoc, relationSummaries: [...existing, op.relationSummary] };
      }

      const next = [...existing];
      next[index] = op.relationSummary;
      return { ...currentDoc, relationSummaries: next };
    }
    case "delete_relation_summary":
      return {
        ...currentDoc,
        relationSummaries: (currentDoc.relationSummaries ?? []).filter((summary) => summary.sourceSignature !== op.sourceSignature),
      };
    case "upsert_evidence_link":
      return { ...currentDoc, evidenceLinks: upsertById(currentDoc.evidenceLinks ?? [], op.evidenceLink) };
    case "delete_evidence_link":
      return { ...currentDoc, evidenceLinks: (currentDoc.evidenceLinks ?? []).filter((link) => link.id !== op.evidenceLinkId) };
  }
}

export function applyPatchWithResolutions(
  currentDoc: DocumentV1,
  patch: PatchDocument,
  resolutions: Record<string, PatchResolution>,
  baselineDoc?: DocumentV1,
  selectedOpIds?: Set<string>
): DocumentV1 {
  return applyPatchWithResolutionsDetailed(currentDoc, patch, resolutions, baselineDoc, selectedOpIds).document;
}

function createEmptyApplyStats(): PatchApplyStats {
  return {
    upsertCards: 0,
    deleteCards: 0,
    upsertIslands: 0,
    deleteIslands: 0,
    upsertEdges: 0,
    deleteEdges: 0,
    upsertRelationSummaries: 0,
    deleteRelationSummaries: 0,
    upsertEvidenceLinks: 0,
    deleteEvidenceLinks: 0,
  };
}

function incrementApplyStats(stats: PatchApplyStats, kind: PatchOpKind): void {
  switch (kind) {
    case "upsert_card":
      stats.upsertCards += 1;
      break;
    case "delete_card":
      stats.deleteCards += 1;
      break;
    case "upsert_island":
      stats.upsertIslands += 1;
      break;
    case "delete_island":
      stats.deleteIslands += 1;
      break;
    case "upsert_edge":
      stats.upsertEdges += 1;
      break;
    case "delete_edge":
      stats.deleteEdges += 1;
      break;
    case "upsert_relation_summary":
      stats.upsertRelationSummaries += 1;
      break;
    case "delete_relation_summary":
      stats.deleteRelationSummaries += 1;
      break;
    case "upsert_evidence_link":
      stats.upsertEvidenceLinks += 1;
      break;
    case "delete_evidence_link":
      stats.deleteEvidenceLinks += 1;
      break;
  }
}

export function applyPatchWithResolutionsDetailed(
  currentDoc: DocumentV1,
  patch: PatchDocument,
  resolutions: Record<string, PatchResolution>,
  baselineDoc?: DocumentV1,
  selectedOpIds?: Set<string>
): { document: DocumentV1; meta: ApplyResultMeta } {
  const conflictReport = baselineDoc ? detectPatchConflicts(baselineDoc, currentDoc, patch) : null;
  const conflictOpIdSet = new Set(conflictReport ? conflictReport.conflicts.map((item) => item.opId) : []);

  let nextDoc = currentDoc;
  const appliedOpIds: string[] = [];
  const stats = createEmptyApplyStats();
  const chosenConflictCounts: PatchConflictMeta = {
    totalConflicts: conflictReport?.conflicts.length ?? 0,
    chosenYours: 0,
    chosenTheirs: 0,
    chosenSkip: 0,
  };

  for (const op of patch.ops) {
    if (selectedOpIds && !selectedOpIds.has(op.id)) {
      continue;
    }

    if (conflictOpIdSet.has(op.id)) {
      const resolution = resolutions[op.id] ?? "skip";
      if (resolution === "theirs") {
        chosenConflictCounts.chosenTheirs += 1;
        nextDoc = applyPatchOp(nextDoc, op);
        appliedOpIds.push(op.id);
        incrementApplyStats(stats, op.kind);
        continue;
      }
      if (resolution === "yours") {
        chosenConflictCounts.chosenYours += 1;
      } else {
        chosenConflictCounts.chosenSkip += 1;
      }
      continue;
    }

    nextDoc = applyPatchOp(nextDoc, op);
    appliedOpIds.push(op.id);
    incrementApplyStats(stats, op.kind);
  }

  return {
    document: nextDoc,
    meta: {
      appliedOpIds,
      stats,
      conflictMeta: conflictReport ? chosenConflictCounts : undefined,
    },
  };
}
