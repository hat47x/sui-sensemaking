import type {
  Affiliation,
  ContradictionSignalDecision,
  ContradictionSignalReviewStatus,
  CritiqueInput,
  DeterministicTieBreak,
  DocumentV1,
  EdgeType,
  EvidenceLink,
  Island,
  MergeSuggestionDecision,
  MergeSuggestionDecisionEntry,
  Narrative,
  PatchApplyLogEntry,
  ReproposalDiff,
  ReviewAttribution,
  RelationSummary,
} from "./types";
import { DOCUMENT_DETERMINISTIC_TIE_BREAK_ORDER, KNOWN_EDGE_TYPES } from "./types";
import { canUsePolygonPoints } from "./geometry/polygon_edit";

type ValidationSuccess = {
  ok: true;
  document: DocumentV1;
};

type ValidationFailure = {
  ok: false;
  errors: string[];
};

export type ValidateDocumentV1StrictResult = ValidationSuccess | ValidationFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[], path: string, errors: string[]) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${path}: unknown field '${key}'`);
    }
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateStringArray(value: unknown, path: string, errors: string[]): value is string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}: must be an array of strings`);
    return false;
  }

  let valid = true;
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      errors.push(`${path}[${index}]: must be a string`);
      valid = false;
    }
  });

  return valid;
}

function validateEdgeType(value: unknown): value is EdgeType {
  // DOMAIN-KJ-01 (schemas.md §3.3.2): strict mode also PRESERVES unknown
  // type strings — any non-empty string is structurally valid; unknown
  // values resolve to "related" at display time. Rejecting them here would
  // reintroduce the round-trip data loss the contract forbids.
  return typeof value === "string" && value.length > 0;
}

function validateClaimType(value: unknown): value is "fact" | "claim" | "hypothesis" | "unknown" {
  return value === "fact" || value === "claim" || value === "hypothesis" || value === "unknown";
}

// DOMAIN-CARD-TEXT-01: content-field bounds mirroring backend models.py.
// Keep in sync with the *_MAX_LENGTH constants there.
const DOCUMENT_TITLE_MAX_LENGTH = 500;
const CARD_TEXT_MAX_LENGTH = 2000;
const CRITIQUE_MAX_LENGTH = 2000;
const ISLAND_TITLE_MAX_LENGTH = 500;
const ISLAND_SUMMARY_MAX_LENGTH = 2000;
const NARRATIVE_TITLE_MAX_LENGTH = 500;
const NARRATIVE_TEXT_MAX_LENGTH = 20000;
const EVIDENCE_NOTE_MAX_LENGTH = 2000;
const A1_TARGET_REF_PATTERN = /^(card|island|cluster|edge|proposal):[^:\s][^\s]*$/;
// Mirrors ReviewAttribution.validate_reviewer_ref_opaque/validate_owner_ref_opaque
// in backend models.py -- keep this prefix list in sync with that validator.
const NON_OPAQUE_REF_PREFIXES = ["sso:", "oidc:", "saml:", "provider:"] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOpaqueRef(value: string): boolean {
  return !value.includes("@") && !NON_OPAQUE_REF_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPlainPayloadObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}

function validateA1TargetRef(value: unknown): boolean {
  return typeof value === "string" && A1_TARGET_REF_PATTERN.test(value);
}

function validateCard(item: unknown, index: number, errors: string[]): item is DocumentV1["cards"][number] {
  const path = `cards[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["id", "text", "x", "y", "claimType", "mergedIntoCardId", "repOf", "canonicalId", "sources", "critique", "critiqueTags", "textReviewed", "holdState", "meta", "ka"], path, errors);

  let valid = true;
  if (typeof item.id !== "string") {
    errors.push(`${path}.id: must be a string`);
    valid = false;
  }
  if (typeof item.text !== "string") {
    errors.push(`${path}.text: must be a string`);
    valid = false;
  } else if (item.text.length > CARD_TEXT_MAX_LENGTH) {
    errors.push(`${path}.text: must be ≤ ${CARD_TEXT_MAX_LENGTH} chars`);
    valid = false;
  }
  if (typeof item.critique === "string" && item.critique.length > CRITIQUE_MAX_LENGTH) {
    errors.push(`${path}.critique: must be ≤ ${CRITIQUE_MAX_LENGTH} chars`);
    valid = false;
  }
  if (!isFiniteNumber(item.x)) {
    errors.push(`${path}.x: must be a finite number`);
    valid = false;
  }
  if (!isFiniteNumber(item.y)) {
    errors.push(`${path}.y: must be a finite number`);
    valid = false;
  }
  if (item.canonicalId !== undefined && typeof item.canonicalId !== "string") {
    errors.push(`${path}.canonicalId: must be a string when provided`);
    valid = false;
  }
  if (item.mergedIntoCardId !== undefined && typeof item.mergedIntoCardId !== "string") {
    errors.push(`${path}.mergedIntoCardId: must be a string when provided`);
    valid = false;
  }
  if (item.claimType !== undefined && !validateClaimType(item.claimType)) {
    errors.push(`${path}.claimType: must be 'fact' | 'claim' | 'hypothesis' | 'unknown' when provided`);
    valid = false;
  }
  if (item.repOf !== undefined && !validateStringArray(item.repOf, `${path}.repOf`, errors)) {
    valid = false;
  }
  if (item.sources !== undefined && !validateStringArray(item.sources, `${path}.sources`, errors)) {
    valid = false;
  }
  if (item.critique !== undefined && typeof item.critique !== "string") {
    errors.push(`${path}.critique: must be a string when provided`);
    valid = false;
  }
  if (item.critiqueTags !== undefined && !validateStringArray(item.critiqueTags, `${path}.critiqueTags`, errors)) {
    valid = false;
  }
  if (item.textReviewed !== undefined && typeof item.textReviewed !== "boolean") {
    errors.push(`${path}.textReviewed: must be a boolean when provided`);
    valid = false;
  }
  if (
    item.holdState !== undefined
    && item.holdState !== "held"
    && item.holdState !== "pending"
    && item.holdState !== "shelved"
  ) {
    errors.push(`${path}.holdState: must be 'held' | 'pending' | 'shelved' when provided`);
    valid = false;
  }
  if (item.meta !== undefined) {
    // DOMAIN-TRACE-01 (schemas.md §15.3): strict mode rejects unknown meta
    // keys outright (fail-closed contract enforcement) — subject/provenance
    // metadata must not enter Card.meta before CARD-META-UI-01 settles.
    if (!isRecord(item.meta)) {
      errors.push(`${path}.meta: must be an object when provided`);
      valid = false;
    } else {
      hasOnlyKeys(item.meta, ["seq", "source"], `${path}.meta`, errors);
      if (item.meta.seq !== undefined && !isFiniteNumber(item.meta.seq)) {
        errors.push(`${path}.meta.seq: must be a finite number when provided`);
        valid = false;
      }
      if (item.meta.source !== undefined && typeof item.meta.source !== "string") {
        errors.push(`${path}.meta.source: must be a string when provided`);
        valid = false;
      }
    }
  }
  if (item.ka !== undefined) {
    // DOMAIN-KA-01 (schemas.md §17.2): strict mode rejects unknown ka keys.
    if (!isRecord(item.ka)) {
      errors.push(`${path}.ka: must be an object when provided`);
      valid = false;
    } else {
      hasOnlyKeys(item.ka, ["voice", "value"], `${path}.ka`, errors);
      if (item.ka.voice !== undefined && typeof item.ka.voice !== "string") {
        errors.push(`${path}.ka.voice: must be a string when provided`);
        valid = false;
      }
      if (item.ka.value !== undefined && typeof item.ka.value !== "string") {
        errors.push(`${path}.ka.value: must be a string when provided`);
        valid = false;
      }
    }
  }

  return valid;
}

function validateShelfEntry(item: unknown, index: number, errors: string[]): item is NonNullable<DocumentV1["shelf"]>[number] {
  const path = `shelf[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["cardId", "shelvedAt", "reason"], path, errors);
  let valid = true;
  if (!isNonEmptyString(item.cardId)) {
    errors.push(`${path}.cardId: must be a non-empty string`);
    valid = false;
  }
  if (!isIsoTimestamp(item.shelvedAt)) {
    errors.push(`${path}.shelvedAt: must be an ISO timestamp`);
    valid = false;
  }
  if (item.reason !== undefined && typeof item.reason !== "string") {
    errors.push(`${path}.reason: must be a string when provided`);
    valid = false;
  }
  return valid;
}

function validateEdge(item: unknown, index: number, errors: string[]): item is DocumentV1["edges"][number] {
  const path = `edges[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["id", "fromId", "toId", "fromKind", "toKind", "type"], path, errors);

  let valid = true;
  if (typeof item.id !== "string") {
    errors.push(`${path}.id: must be a string`);
    valid = false;
  }
  if (typeof item.fromId !== "string") {
    errors.push(`${path}.fromId: must be a string`);
    valid = false;
  }
  if (typeof item.toId !== "string") {
    errors.push(`${path}.toId: must be a string`);
    valid = false;
  }
  if (item.fromKind !== undefined && item.fromKind !== "card" && item.fromKind !== "island") {
    errors.push(`${path}.fromKind: must be 'card' or 'island' when provided`);
    valid = false;
  }
  if (item.toKind !== undefined && item.toKind !== "card" && item.toKind !== "island") {
    errors.push(`${path}.toKind: must be 'card' or 'island' when provided`);
    valid = false;
  }
  if (!validateEdgeType(item.type)) {
    errors.push(`${path}.type: must be a non-empty string`);
    valid = false;
  }

  return valid;
}


function validateAffiliation(item: unknown, index: number, errors: string[]): item is Affiliation {
  const path = `affiliations[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["id", "cardId", "islandId"], path, errors);

  let valid = true;
  for (const key of ["id", "cardId", "islandId"] as const) {
    if (typeof item[key] !== "string" || item[key].trim().length === 0) {
      errors.push(`${path}.${key}: must be a non-empty string`);
      valid = false;
    }
  }
  return valid;
}


function validateIslandGeometry(value: unknown, path: string, errors: string[]): value is Island["geometry"] {
  if (!isRecord(value)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(value, ["type", "x", "y", "w", "h", "points", "polygon"], path, errors);

  if (value.type !== "rect" && value.type !== "polygon") {
    errors.push(`${path}.type: must be 'rect' or 'polygon'`);
    return false;
  }

  if (value.type === "polygon") {
    const points = Array.isArray(value.points)
      ? value.points
      : isRecord(value.polygon) && Array.isArray(value.polygon.points)
        ? value.polygon.points
        : null;

    if (!points || points.length < 3) {
      errors.push(`${path}.points: must contain at least 3 points for polygon`);
      return false;
    }

    let valid = true;
    points.forEach((point, index) => {
      const pointPath = `${path}.points[${index}]`;
      if (!isRecord(point)) {
        errors.push(`${pointPath}: must be an object`);
        valid = false;
        return;
      }
      hasOnlyKeys(point, ["x", "y"], pointPath, errors);
      if (!isFiniteNumber(point.x)) {
        errors.push(`${pointPath}.x: must be a finite number`);
        valid = false;
      }
      if (!isFiniteNumber(point.y)) {
        errors.push(`${pointPath}.y: must be a finite number`);
        valid = false;
      }
    });
    if (valid && !canUsePolygonPoints(points as { x: number; y: number }[])) {
      errors.push(`${path}.points: polygon must not self-intersect`);
      return false;
    }

    return valid;
  }

  let valid = true;
  if (value.points !== undefined || value.polygon !== undefined) {
    errors.push(`${path}.points: rect geometry must not include polygon points`);
    valid = false;
  }

  for (const [key, entry] of Object.entries({ x: value.x, y: value.y, w: value.w, h: value.h })) {
    if (entry !== undefined && !isFiniteNumber(entry)) {
      errors.push(`${path}.${key}: must be a finite number when provided`);
      valid = false;
    }
  }

  return valid;
}
function validateIslandShape(value: unknown, path: string, errors: string[]): value is Island["shape"] {
  if (!isRecord(value)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(value, ["kind", "points", "generatedFrom"], path, errors);

  if (value.kind !== "rect" && value.kind !== "polygon") {
    errors.push(`${path}.kind: must be 'rect' or 'polygon'`);
    return false;
  }

  let valid = true;

  if (value.kind === "polygon") {
    if (!Array.isArray(value.points) || value.points.length < 3) {
      errors.push(`${path}.points: must contain at least 3 points for polygon`);
      valid = false;
    } else {
      value.points.forEach((point, pointIndex) => {
        const pointPath = `${path}.points[${pointIndex}]`;
        if (!isRecord(point)) {
          errors.push(`${pointPath}: must be an object`);
          valid = false;
          return;
        }

        hasOnlyKeys(point, ["x", "y"], pointPath, errors);

        if (!isFiniteNumber(point.x)) {
          errors.push(`${pointPath}.x: must be a finite number`);
          valid = false;
        }
        if (!isFiniteNumber(point.y)) {
          errors.push(`${pointPath}.y: must be a finite number`);
          valid = false;
        }
      });

      if (valid && !canUsePolygonPoints(value.points as { x: number; y: number }[])) {
        errors.push(`${path}.points: polygon must not self-intersect`);
        valid = false;
      }
    }
  } else if (value.points !== undefined) {
    errors.push(`${path}.points: rect shape must not include points`);
    valid = false;
  }

  if (value.generatedFrom !== undefined) {
    if (!isRecord(value.generatedFrom)) {
      errors.push(`${path}.generatedFrom: must be an object`);
      valid = false;
    } else {
      hasOnlyKeys(value.generatedFrom, ["cardIds", "versionToken"], `${path}.generatedFrom`, errors);

      if (!validateStringArray(value.generatedFrom.cardIds, `${path}.generatedFrom.cardIds`, errors)) {
        valid = false;
      }
      if (typeof value.generatedFrom.versionToken !== "string") {
        errors.push(`${path}.generatedFrom.versionToken: must be a string`);
        valid = false;
      }
    }
  }

  return valid;
}

function validateIsland(item: unknown, index: number, errors: string[]): item is Island {
  const path = `islands[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(
    item,
    [
      "id",
      "cardIds",
      "parentIslandId",
      "placardCardId",
      "collapsed",
      "title",
      "titleReviewed",
      "summaryText",
      "summaryReviewed",
      "summaryGrounding",
      "summaryHistory",
      "imageUrl",
      "imageReviewed",
      "critique",
      "critiqueTags",
      "geometry",
      "shape",
      "shapeStale",
      "representativeCue",
    ],
    path,
    errors
  );

  let valid = true;
  if (typeof item.id !== "string") {
    errors.push(`${path}.id: must be a string`);
    valid = false;
  }
  if (!validateStringArray(item.cardIds, `${path}.cardIds`, errors)) {
    valid = false;
  }
  if (item.parentIslandId !== undefined && typeof item.parentIslandId !== "string") {
    errors.push(`${path}.parentIslandId: must be a string when provided`);
    valid = false;
  }
  if (item.placardCardId !== undefined && typeof item.placardCardId !== "string") {
    errors.push(`${path}.placardCardId: must be a string when provided`);
    valid = false;
  }
  if (typeof item.title === "string" && item.title.length > ISLAND_TITLE_MAX_LENGTH) {
    errors.push(`${path}.title: must be ≤ ${ISLAND_TITLE_MAX_LENGTH} chars`);
    valid = false;
  }
  if (typeof item.summaryText === "string" && item.summaryText.length > ISLAND_SUMMARY_MAX_LENGTH) {
    errors.push(`${path}.summaryText: must be ≤ ${ISLAND_SUMMARY_MAX_LENGTH} chars`);
    valid = false;
  }
  if (item.collapsed !== undefined && typeof item.collapsed !== "boolean") {
    errors.push(`${path}.collapsed: must be a boolean when provided`);
    valid = false;
  }
  if (item.title !== undefined && typeof item.title !== "string") {
    errors.push(`${path}.title: must be a string when provided`);
    valid = false;
  }
  if (item.titleReviewed !== undefined && typeof item.titleReviewed !== "boolean") {
    errors.push(`${path}.titleReviewed: must be a boolean when provided`);
    valid = false;
  }
  if (item.summaryText !== undefined && typeof item.summaryText !== "string") {
    errors.push(`${path}.summaryText: must be a string when provided`);
    valid = false;
  }
  if (item.summaryReviewed !== undefined && typeof item.summaryReviewed !== "boolean") {
    errors.push(`${path}.summaryReviewed: must be a boolean when provided`);
    valid = false;
  }
  if (item.summaryGrounding !== undefined && !validateStringArray(item.summaryGrounding, `${path}.summaryGrounding`, errors)) {
    valid = false;
  }
  if (item.imageUrl !== undefined && typeof item.imageUrl !== "string") {
    errors.push(`${path}.imageUrl: must be a string when provided`);
    valid = false;
  }
  if (item.imageReviewed !== undefined && typeof item.imageReviewed !== "boolean") {
    errors.push(`${path}.imageReviewed: must be a boolean when provided`);
    valid = false;
  }
  if (item.critique !== undefined && typeof item.critique !== "string") {
    errors.push(`${path}.critique: must be a string when provided`);
    valid = false;
  }
  if (item.critiqueTags !== undefined && !validateStringArray(item.critiqueTags, `${path}.critiqueTags`, errors)) {
    valid = false;
  }
  if (item.geometry !== undefined && !validateIslandGeometry(item.geometry, `${path}.geometry`, errors)) {
    valid = false;
  }
  if (item.shape !== undefined && !validateIslandShape(item.shape, `${path}.shape`, errors)) {
    valid = false;
  }
  if (item.shapeStale !== undefined && typeof item.shapeStale !== "boolean") {
    errors.push(`${path}.shapeStale: must be a boolean when provided`);
    valid = false;
  }
  if (item.representativeCue !== undefined) {
    // DOMAIN-VISUAL-CUE-01 (schemas.md §19.3): strict mode rejects unknown
    // keys and out-of-enum kind outright (fail-closed contract enforcement).
    if (!isRecord(item.representativeCue)) {
      errors.push(`${path}.representativeCue: must be an object when provided`);
      valid = false;
    } else {
      const cue = item.representativeCue;
      hasOnlyKeys(cue, ["kind", "cueId", "altText", "imageRef"], `${path}.representativeCue`, errors);
      if (cue.kind !== "hand_drawn" && cue.kind !== "user_image" && cue.kind !== "preset_svg" && cue.kind !== "emoji") {
        errors.push(`${path}.representativeCue.kind: must be 'hand_drawn' | 'user_image' | 'preset_svg' | 'emoji'`);
        valid = false;
      }
      if (typeof cue.cueId !== "string") {
        errors.push(`${path}.representativeCue.cueId: must be a string`);
        valid = false;
      }
      if (typeof cue.altText !== "string") {
        errors.push(`${path}.representativeCue.altText: must be a string`);
        valid = false;
      }
      if (cue.imageRef !== undefined && typeof cue.imageRef !== "string") {
        errors.push(`${path}.representativeCue.imageRef: must be a string when provided`);
        valid = false;
      }
    }
  }

  return valid;
}

function validateRelationSummary(item: unknown, index: number, errors: string[]): item is RelationSummary {
  const path = `relationSummaries[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(
    item,
    [
      "id",
      "createdAt",
      "islandAId",
      "islandBId",
      "relationType",
      "derived",
      "text",
      "reviewed",
      "groundingCardIds",
      "groundingEdgeIds",
      "warnings",
      "sourceSignature",
      "history",
    ],
    path,
    errors
  );

  let valid = true;
  if (typeof item.id !== "string") {
    errors.push(`${path}.id: must be a string`);
    valid = false;
  }
  if (typeof item.createdAt !== "string") {
    errors.push(`${path}.createdAt: must be a string`);
    valid = false;
  }
  if (typeof item.islandAId !== "string") {
    errors.push(`${path}.islandAId: must be a string`);
    valid = false;
  }
  if (typeof item.islandBId !== "string") {
    errors.push(`${path}.islandBId: must be a string`);
    valid = false;
  }
  if (
    item.relationType !== "unknown" &&
    !(typeof item.relationType === "string" && (KNOWN_EDGE_TYPES as readonly string[]).includes(item.relationType))
  ) {
    errors.push(`${path}.relationType: must be one of ${KNOWN_EDGE_TYPES.join(", ")}, or 'unknown'`);
    valid = false;
  }
  if (typeof item.derived !== "boolean") {
    errors.push(`${path}.derived: must be a boolean`);
    valid = false;
  }
  if (typeof item.text !== "string") {
    errors.push(`${path}.text: must be a string`);
    valid = false;
  }
  if (typeof item.reviewed !== "boolean") {
    errors.push(`${path}.reviewed: must be a boolean`);
    valid = false;
  }
  if (!validateStringArray(item.groundingCardIds, `${path}.groundingCardIds`, errors)) {
    valid = false;
  }
  if (!validateStringArray(item.groundingEdgeIds, `${path}.groundingEdgeIds`, errors)) {
    valid = false;
  }
  if (item.warnings !== undefined && !validateStringArray(item.warnings, `${path}.warnings`, errors)) {
    valid = false;
  }
  if (typeof item.sourceSignature !== "string") {
    errors.push(`${path}.sourceSignature: must be a string`);
    valid = false;
  }

  return valid;
}



function validatePatchApplyStats(value: unknown, path: string, errors: string[]): boolean {
  if (!isRecord(value)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(
    value,
    [
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
    ],
    path,
    errors
  );

  let valid = true;
  for (const key of [
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
  ] as const) {
    if (!isFiniteNumber(value[key])) {
      errors.push(`${path}.${key}: must be a finite number`);
      valid = false;
    }
  }

  return valid;
}

function validatePatchApplyLogEntry(item: unknown, index: number, errors: string[]): item is PatchApplyLogEntry {
  const path = `patchApplyLog[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(
    item,
    ["id", "createdAt", "patchVersion", "patchTitle", "baseDocSignature", "patchSourceSignature", "appliedOpIds", "stats", "conflictMeta", "note"],
    path,
    errors
  );

  let valid = true;
  if (typeof item.id !== "string") {
    errors.push(`${path}.id: must be a string`);
    valid = false;
  }
  if (typeof item.createdAt !== "string") {
    errors.push(`${path}.createdAt: must be a string`);
    valid = false;
  }
  if (item.patchVersion !== "1") {
    errors.push(`${path}.patchVersion: must be '1'`);
    valid = false;
  }
  if (item.patchTitle !== undefined && typeof item.patchTitle !== "string") {
    errors.push(`${path}.patchTitle: must be a string when provided`);
    valid = false;
  }
  if (item.baseDocSignature !== undefined && typeof item.baseDocSignature !== "string") {
    errors.push(`${path}.baseDocSignature: must be a string when provided`);
    valid = false;
  }
  if (item.patchSourceSignature !== undefined && typeof item.patchSourceSignature !== "string") {
    errors.push(`${path}.patchSourceSignature: must be a string when provided`);
    valid = false;
  }
  if (!validateStringArray(item.appliedOpIds, `${path}.appliedOpIds`, errors)) {
    valid = false;
  }
  if (!validatePatchApplyStats(item.stats, `${path}.stats`, errors)) {
    valid = false;
  }
  if (item.conflictMeta !== undefined) {
    if (!isRecord(item.conflictMeta)) {
      errors.push(`${path}.conflictMeta: must be an object when provided`);
      valid = false;
    } else {
      hasOnlyKeys(item.conflictMeta, ["totalConflicts", "chosenYours", "chosenTheirs", "chosenSkip"], `${path}.conflictMeta`, errors);
      for (const key of ["totalConflicts", "chosenYours", "chosenTheirs", "chosenSkip"] as const) {
        if (!isFiniteNumber(item.conflictMeta[key])) {
          errors.push(`${path}.conflictMeta.${key}: must be a finite number`);
          valid = false;
        }
      }
    }
  }
  if (item.note !== undefined && typeof item.note !== "string") {
    errors.push(`${path}.note: must be a string when provided`);
    valid = false;
  }

  return valid;
}


function validateEvidenceLink(item: unknown, index: number, errors: string[]): item is EvidenceLink {
  const path = `evidenceLinks[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["id", "type", "fromCardId", "toCardId", "note", "createdAt"], path, errors);

  let valid = true;
  if (typeof item.id !== "string") {
    errors.push(`${path}.id: must be a string`);
    valid = false;
  }
  if (item.type !== "supports" && item.type !== "contradicts") {
    errors.push(`${path}.type: must be 'supports' or 'contradicts'`);
    valid = false;
  }
  if (typeof item.fromCardId !== "string") {
    errors.push(`${path}.fromCardId: must be a string`);
    valid = false;
  }
  if (typeof item.toCardId !== "string") {
    errors.push(`${path}.toCardId: must be a string`);
    valid = false;
  }
  if (item.fromCardId === item.toCardId) {
    errors.push(`${path}: self-link is not allowed`);
    valid = false;
  }
  if (item.note !== undefined && typeof item.note !== "string") {
    errors.push(`${path}.note: must be a string when provided`);
    valid = false;
  } else if (typeof item.note === "string" && item.note.length > EVIDENCE_NOTE_MAX_LENGTH) {
    errors.push(`${path}.note: must be ≤ ${EVIDENCE_NOTE_MAX_LENGTH} chars`);
    valid = false;
  }
  if (item.createdAt !== undefined && typeof item.createdAt !== "string") {
    errors.push(`${path}.createdAt: must be a string when provided`);
    valid = false;
  }

  return valid;
}

function validateCritiqueInput(item: unknown, index: number, errors: string[]): item is CritiqueInput {
  const path = `critiqueInputs[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(
    item,
    ["schemaVersion", "critiqueId", "targetRef", "critiqueType", "createdAt", "iteration", "comment", "constraintHints"],
    path,
    errors
  );

  let valid = true;
  if (item.schemaVersion !== "1.0.0") {
    errors.push(`${path}.schemaVersion: must be '1.0.0'`);
    valid = false;
  }
  if (!isNonEmptyString(item.critiqueId)) {
    errors.push(`${path}.critiqueId: must be a non-empty string`);
    valid = false;
  }
  if (!validateA1TargetRef(item.targetRef)) {
    errors.push(`${path}.targetRef: must start with 'card:', 'island:', 'cluster:', 'edge:', or 'proposal:'`);
    valid = false;
  }
  if (
    item.critiqueType !== "too_close"
    && item.critiqueType !== "too_far"
    && item.critiqueType !== "not_the_same"
    && item.critiqueType !== "feels_off"
    && item.critiqueType !== "no_articulable_reason"
  ) {
    errors.push(`${path}.critiqueType: must be a known A1 critique type`);
    valid = false;
  }
  if (!isIsoTimestamp(item.createdAt)) {
    errors.push(`${path}.createdAt: must be an ISO timestamp`);
    valid = false;
  }
  if (!Number.isInteger(item.iteration) || (item.iteration as number) < 1) {
    errors.push(`${path}.iteration: must be an integer greater than or equal to 1`);
    valid = false;
  }
  if (item.comment !== undefined && typeof item.comment !== "string") {
    errors.push(`${path}.comment: must be a string when provided`);
    valid = false;
  }
  if (item.constraintHints !== undefined && !validateStringArray(item.constraintHints, `${path}.constraintHints`, errors)) {
    valid = false;
  }

  return valid;
}

function validateReproposalDiffOp(item: unknown, path: string, errors: string[]): boolean {
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["opId", "opType", "targetRef", "before", "after", "rationale"], path, errors);

  let valid = true;
  if (!isNonEmptyString(item.opId)) {
    errors.push(`${path}.opId: must be a non-empty string`);
    valid = false;
  }
  if (
    item.opType !== "add"
    && item.opType !== "remove"
    && item.opType !== "move"
    && item.opType !== "regroup"
    && item.opType !== "relabel"
  ) {
    errors.push(`${path}.opType: must be 'add' | 'remove' | 'move' | 'regroup' | 'relabel'`);
    valid = false;
  }
  if (!validateA1TargetRef(item.targetRef)) {
    errors.push(`${path}.targetRef: must start with 'card:', 'island:', 'cluster:', 'edge:', or 'proposal:'`);
    valid = false;
  }

  const hasBefore = Object.prototype.hasOwnProperty.call(item, "before");
  const hasAfter = Object.prototype.hasOwnProperty.call(item, "after");
  if (!hasBefore) {
    errors.push(`${path}.before: field is required`);
    valid = false;
  }
  if (!hasAfter) {
    errors.push(`${path}.after: field is required`);
    valid = false;
  }
  if (hasBefore && item.before !== null && !isPlainPayloadObject(item.before)) {
    errors.push(`${path}.before: must be an object or null`);
    valid = false;
  }
  if (hasAfter && item.after !== null && !isPlainPayloadObject(item.after)) {
    errors.push(`${path}.after: must be an object or null`);
    valid = false;
  }
  if (hasBefore && hasAfter && item.before === null && item.after === null) {
    errors.push(`${path}: before and after must not both be null`);
    valid = false;
  }
  if (item.rationale !== undefined && typeof item.rationale !== "string") {
    errors.push(`${path}.rationale: must be a string when provided`);
    valid = false;
  }

  return valid;
}

function validateReproposalDiff(item: unknown, index: number, errors: string[]): item is ReproposalDiff {
  const path = `reproposalDiffs[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["schemaVersion", "proposalId", "basedOnIteration", "diffOps", "traceKey", "rationale"], path, errors);

  let valid = true;
  if (item.schemaVersion !== "1.0.0") {
    errors.push(`${path}.schemaVersion: must be '1.0.0'`);
    valid = false;
  }
  if (!isNonEmptyString(item.proposalId)) {
    errors.push(`${path}.proposalId: must be a non-empty string`);
    valid = false;
  }
  if (!Number.isInteger(item.basedOnIteration) || (item.basedOnIteration as number) < 1) {
    errors.push(`${path}.basedOnIteration: must be an integer greater than or equal to 1`);
    valid = false;
  }
  if (!isNonEmptyString(item.traceKey)) {
    errors.push(`${path}.traceKey: must be a non-empty string`);
    valid = false;
  }
  if (item.rationale !== undefined && typeof item.rationale !== "string") {
    errors.push(`${path}.rationale: must be a string when provided`);
    valid = false;
  }
  if (!Array.isArray(item.diffOps) || item.diffOps.length === 0) {
    errors.push(`${path}.diffOps: must be a non-empty array`);
    valid = false;
  } else {
    item.diffOps.forEach((op, opIndex) => {
      if (!validateReproposalDiffOp(op, `${path}.diffOps[${opIndex}]`, errors)) {
        valid = false;
      }
    });
  }

  return valid;
}

function validateReviewAttribution(item: unknown, errors: string[]): item is ReviewAttribution {
  const path = "reviewAttribution";
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(
    item,
    ["schemaVersion", "reviewState", "reviewedAt", "reviewerRef", "auditRecordedAt", "overridePolicy", "reviewContext", "ownerRef"],
    path,
    errors
  );

  let valid = true;
  if (item.schemaVersion !== "1.0.0") {
    errors.push(`${path}.schemaVersion: must be '1.0.0'`);
    valid = false;
  }
  if (item.reviewState !== "unreviewed" && item.reviewState !== "human_reviewed") {
    errors.push(`${path}.reviewState: must be 'unreviewed' or 'human_reviewed'`);
    valid = false;
  }
  if (!isNonEmptyString(item.reviewerRef)) {
    errors.push(`${path}.reviewerRef: must be a non-empty opaque string`);
    valid = false;
  } else if (!isOpaqueRef(item.reviewerRef)) {
    errors.push(`${path}.reviewerRef: must not contain email-like/provider identifiers`);
    valid = false;
  }
  if (!isIsoTimestamp(item.auditRecordedAt)) {
    errors.push(`${path}.auditRecordedAt: must be an ISO timestamp`);
    valid = false;
  }
  if (item.overridePolicy !== "human_dual_control_only") {
    errors.push(`${path}.overridePolicy: must be 'human_dual_control_only'`);
    valid = false;
  }
  if (item.reviewContext !== undefined && typeof item.reviewContext !== "string") {
    errors.push(`${path}.reviewContext: must be a string when provided`);
    valid = false;
  }
  if (item.ownerRef !== undefined) {
    if (typeof item.ownerRef !== "string") {
      errors.push(`${path}.ownerRef: must be a string when provided`);
      valid = false;
    } else if (!isOpaqueRef(item.ownerRef)) {
      errors.push(`${path}.ownerRef: must not contain email-like/provider identifiers`);
      valid = false;
    }
  }
  if (item.reviewState === "human_reviewed" && !isIsoTimestamp(item.reviewedAt)) {
    errors.push(`${path}.reviewedAt: must be an ISO timestamp when reviewState is 'human_reviewed'`);
    valid = false;
  }
  if (item.reviewState === "unreviewed" && item.reviewedAt !== null) {
    errors.push(`${path}.reviewedAt: must be null when reviewState is 'unreviewed'`);
    valid = false;
  }

  return valid;
}

function validateDeterministicTieBreak(item: unknown, errors: string[]): item is DeterministicTieBreak {
  const path = "deterministicTieBreak";
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["schemaVersion", "order"], path, errors);

  let valid = true;
  if (item.schemaVersion !== "1.0.0") {
    errors.push(`${path}.schemaVersion: must be '1.0.0'`);
    valid = false;
  }
  const order = item.order;
  if (!Array.isArray(order) || order.length !== DOCUMENT_DETERMINISTIC_TIE_BREAK_ORDER.length) {
    errors.push(`${path}.order: must contain the fixed deterministic order`);
    valid = false;
  } else {
    DOCUMENT_DETERMINISTIC_TIE_BREAK_ORDER.forEach((expected, index) => {
      if (order[index] !== expected) {
        errors.push(`${path}.order[${index}]: must be '${expected}'`);
        valid = false;
      }
    });
  }

  return valid;
}


function validateMergeSuggestionDecision(value: unknown): value is MergeSuggestionDecision {
  return value === "accept" || value === "partial" || value === "reject" || value === "defer";
}

function validateRepresentativeResolvedBy(
  value: unknown
): value is "repOf" | "mergedIntoCardId" | "fallback" | "unresolved" {
  return value === "repOf" || value === "mergedIntoCardId" || value === "fallback" || value === "unresolved";
}

function validateMergeSuggestionDecisionEntry(
  item: unknown,
  index: number,
  errors: string[]
): item is MergeSuggestionDecisionEntry {
  const path = `mergeSuggestionDecisions[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["id", "decisionId", "groupId", "decision", "action", "decidedAt", "decidedBy", "cardIds", "selectedCardIds", "mergedTextDraft", "editedText", "note", "snapshotVersion", "rationale", "mergeMethod", "representativeCardId", "representativeResolvedBy", "sourceCardIds", "missingSourceCardIds"], path, errors);

  let valid = true;
  if (typeof item.id !== "string") {
    errors.push(`${path}.id: must be a string`);
    valid = false;
  }
  if (typeof item.groupId !== "string") {
    errors.push(`${path}.groupId: must be a string`);
    valid = false;
  }

  if (item.decisionId !== undefined && typeof item.decisionId !== "string") {
    errors.push(`${path}.decisionId: must be a string when provided`);
    valid = false;
  }
  if (!validateMergeSuggestionDecision(item.decision)) {
    errors.push(`${path}.decision: must be 'accept' | 'partial' | 'reject' | 'defer'`);
    valid = false;
  }
  if (item.action !== undefined && !validateMergeSuggestionDecision(item.action)) {
    errors.push(`${path}.action: must be 'accept' | 'partial' | 'reject' | 'defer' when provided`);
    valid = false;
  }
  if (typeof item.decidedAt !== "string") {
    errors.push(`${path}.decidedAt: must be a string`);
    valid = false;
  }
  if (item.decidedBy !== undefined && typeof item.decidedBy !== "string") {
    errors.push(`${path}.decidedBy: must be a string when provided`);
    valid = false;
  }
  if (!validateStringArray(item.cardIds, `${path}.cardIds`, errors)) {
    valid = false;
  }
  if (item.selectedCardIds !== undefined && !validateStringArray(item.selectedCardIds, `${path}.selectedCardIds`, errors)) {
    valid = false;
  }
  if (typeof item.mergedTextDraft !== "string") {
    errors.push(`${path}.mergedTextDraft: must be a string`);
    valid = false;
  }
  if (typeof item.editedText !== "string") {
    errors.push(`${path}.editedText: must be a string`);
    valid = false;
  }
  if (item.note !== undefined && typeof item.note !== "string") {
    errors.push(`${path}.note: must be a string when provided`);
    valid = false;
  }
  if (item.snapshotVersion !== undefined && typeof item.snapshotVersion !== "string") {
    errors.push(`${path}.snapshotVersion: must be a string when provided`);
    valid = false;
  }
  if (item.rationale !== undefined && typeof item.rationale !== "string") {
    errors.push(`${path}.rationale: must be a string when provided`);
    valid = false;
  }
  if (
    item.mergeMethod !== undefined
    && item.mergeMethod !== "near_duplicate"
    && item.mergeMethod !== "kernel_fusion"
  ) {
    errors.push(`${path}.mergeMethod: must be 'near_duplicate' | 'kernel_fusion' when provided`);
    valid = false;
  }
  if (item.representativeCardId !== undefined && typeof item.representativeCardId !== "string") {
    errors.push(`${path}.representativeCardId: must be a string when provided`);
    valid = false;
  }
  if (item.representativeResolvedBy !== undefined && !validateRepresentativeResolvedBy(item.representativeResolvedBy)) {
    errors.push(`${path}.representativeResolvedBy: must be 'repOf' | 'mergedIntoCardId' | 'fallback' | 'unresolved' when provided`);
    valid = false;
  }
  if (item.sourceCardIds !== undefined && !validateStringArray(item.sourceCardIds, `${path}.sourceCardIds`, errors)) {
    valid = false;
  }
  if (item.missingSourceCardIds !== undefined && !validateStringArray(item.missingSourceCardIds, `${path}.missingSourceCardIds`, errors)) {
    valid = false;
  }

  return valid;
}

// DOMAIN-EXPR-04 (schemas.md §16.2/16.6): fail-closed strict validation,
// mirroring validateMergeSuggestionDecisionEntry above.
function validateContradictionSignalReviewStatus(value: unknown): value is ContradictionSignalReviewStatus {
  return value === "accepted" || value === "held" || value === "rejected";
}

function validateContradictionSignalDecisionEntry(
  item: unknown,
  index: number,
  errors: string[]
): item is ContradictionSignalDecision {
  const path = `contradictionSignalDecisions[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["signatureKey", "status", "decidedAt"], path, errors);

  let valid = true;
  if (typeof item.signatureKey !== "string" || item.signatureKey.length === 0) {
    errors.push(`${path}.signatureKey: must be a non-empty string`);
    valid = false;
  }
  if (!validateContradictionSignalReviewStatus(item.status)) {
    errors.push(`${path}.status: must be 'accepted' | 'held' | 'rejected'`);
    valid = false;
  }
  if (typeof item.decidedAt !== "string") {
    errors.push(`${path}.decidedAt: must be a string`);
    valid = false;
  }

  return valid;
}

function validateNarrative(item: unknown, index: number, errors: string[]): item is Narrative {
  const path = `narratives[${index}]`;
  if (!isRecord(item)) {
    errors.push(`${path}: must be an object`);
    return false;
  }

  hasOnlyKeys(item, ["id", "title", "text", "createdAt", "basedOnReadingOrder", "reviewed", "checks"], path, errors);

  let valid = true;
  if (typeof item.id !== "string") {
    errors.push(`${path}.id: must be a string`);
    valid = false;
  }
  if (typeof item.title !== "string") {
    errors.push(`${path}.title: must be a string`);
    valid = false;
  } else if (item.title.length > NARRATIVE_TITLE_MAX_LENGTH) {
    errors.push(`${path}.title: must be ≤ ${NARRATIVE_TITLE_MAX_LENGTH} chars`);
    valid = false;
  }
  if (typeof item.text !== "string") {
    errors.push(`${path}.text: must be a string`);
    valid = false;
  } else if (item.text.length > NARRATIVE_TEXT_MAX_LENGTH) {
    errors.push(`${path}.text: must be ≤ ${NARRATIVE_TEXT_MAX_LENGTH} chars`);
    valid = false;
  }
  if (item.createdAt !== undefined && typeof item.createdAt !== "string") {
    errors.push(`${path}.createdAt: must be a string when provided`);
    valid = false;
  }
  if (item.basedOnReadingOrder !== undefined && !validateStringArray(item.basedOnReadingOrder, `${path}.basedOnReadingOrder`, errors)) {
    valid = false;
  }
  if (typeof item.reviewed !== "boolean") {
    errors.push(`${path}.reviewed: must be a boolean`);
    valid = false;
  }

  return valid;
}

export function validateDocumentV1Strict(value: unknown): ValidateDocumentV1StrictResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ["document: must be a JSON object"] };
  }

  hasOnlyKeys(
    value,
    [
      "version",
      "id",
      "title",
      "createdAt",
      "updatedAt",
      "transform",
      "cards",
      "edges",
      "islands",
      "affiliations",
      "readingOrder",
      "narratives",
      "relationSummaries",
      "evidenceLinks",
      "patchApplyLog",
      "mergeSuggestionDecisions",
      "contradictionSignalDecisions",
      "critiqueInputs",
      "reproposalDiffs",
      "reviewAttribution",
      "deterministicTieBreak",
      "shelf",
    ],
    "document",
    errors
  );

  if (value.version !== 1) {
    errors.push("document.version: must be the number 1 (DocumentV1 only)");
  }
  if (typeof value.id !== "string") {
    errors.push("document.id: must be a string");
  }
  if (value.title !== undefined && typeof value.title !== "string") {
    errors.push("document.title: must be a string when provided");
  }
  if (typeof value.title === "string" && value.title.length > DOCUMENT_TITLE_MAX_LENGTH) {
    errors.push(`document.title: must be ≤ ${DOCUMENT_TITLE_MAX_LENGTH} chars`);
  }
  if (typeof value.createdAt !== "string") {
    errors.push("document.createdAt: must be a string");
  }
  if (typeof value.updatedAt !== "string") {
    errors.push("document.updatedAt: must be a string");
  }

  if (!isRecord(value.transform)) {
    errors.push("document.transform: must be an object");
  } else {
    hasOnlyKeys(value.transform, ["panX", "panY", "zoom"], "document.transform", errors);
    if (!isFiniteNumber(value.transform.panX)) {
      errors.push("document.transform.panX: must be a finite number");
    }
    if (!isFiniteNumber(value.transform.panY)) {
      errors.push("document.transform.panY: must be a finite number");
    }
    if (!isFiniteNumber(value.transform.zoom)) {
      errors.push("document.transform.zoom: must be a finite number");
    }
  }

  if (!Array.isArray(value.cards)) {
    errors.push("document.cards: must be an array");
  } else {
    value.cards.forEach((item, index) => {
      validateCard(item, index, errors);
    });
  }

  if (!Array.isArray(value.edges)) {
    errors.push("document.edges: must be an array");
  } else {
    value.edges.forEach((item, index) => {
      validateEdge(item, index, errors);
    });
  }

  if (!Array.isArray(value.islands)) {
    errors.push("document.islands: must be an array");
  } else {
    value.islands.forEach((item, index) => {
      validateIsland(item, index, errors);
    });
  }

  if (value.affiliations !== undefined) {
    if (!Array.isArray(value.affiliations)) {
      errors.push("document.affiliations: must be an array when provided");
    } else {
      const cardIds = new Set(
        Array.isArray(value.cards)
          ? value.cards
              .filter((card): card is Record<string, unknown> => isRecord(card) && typeof card.id === "string")
              .map((card) => card.id as string)
          : [],
      );
      const islandIds = new Set(
        Array.isArray(value.islands)
          ? value.islands
              .filter((island): island is Record<string, unknown> => isRecord(island) && typeof island.id === "string")
              .map((island) => island.id as string)
          : [],
      );
      const seenIds = new Set<string>();
      const seenPairs = new Set<string>();
      value.affiliations.forEach((item, index) => {
        if (!validateAffiliation(item, index, errors)) {
          return;
        }
        if (seenIds.has(item.id)) {
          errors.push(`affiliations[${index}].id: duplicate id '${item.id}'`);
        }
        seenIds.add(item.id);

        const pair = `${item.cardId}\0${item.islandId}`;
        if (seenPairs.has(pair)) {
          errors.push(
            `affiliations[${index}]: duplicate pair '${item.cardId}' -> '${item.islandId}'`,
          );
        }
        seenPairs.add(pair);

        if (!cardIds.has(item.cardId)) {
          errors.push(`affiliations[${index}].cardId: unknown card '${item.cardId}'`);
        }
        if (!islandIds.has(item.islandId)) {
          errors.push(`affiliations[${index}].islandId: unknown island '${item.islandId}'`);
        }
      });
    }
  }

  if (value.readingOrder !== undefined && !validateStringArray(value.readingOrder, "document.readingOrder", errors)) {
    // errors are added in validateStringArray
  }

  if (value.narratives !== undefined) {
    if (!Array.isArray(value.narratives)) {
      errors.push("document.narratives: must be an array when provided");
    } else {
      value.narratives.forEach((item, index) => {
        validateNarrative(item, index, errors);
      });
    }
  }

  if (value.shelf !== undefined) {
    if (!Array.isArray(value.shelf)) {
      errors.push("document.shelf: must be an array when provided");
    } else {
      const cardById = new Map(
        Array.isArray(value.cards)
          ? value.cards
              .filter((card): card is Record<string, unknown> => isRecord(card) && typeof card.id === "string")
              .map((card) => [card.id as string, card])
          : [],
      );
      const seenCardIds = new Set<string>();
      value.shelf.forEach((item, index) => {
        if (!validateShelfEntry(item, index, errors)) {
          return;
        }
        if (seenCardIds.has(item.cardId)) {
          errors.push(`shelf[${index}].cardId: duplicate card id '${item.cardId}'`);
        }
        seenCardIds.add(item.cardId);
        const card = cardById.get(item.cardId);
        if (!card) {
          errors.push(`shelf[${index}].cardId: unknown card '${item.cardId}'`);
        } else if (card.holdState !== "shelved") {
          errors.push(`shelf[${index}].cardId: card '${item.cardId}' must have holdState 'shelved'`);
        }
      });
    }
  }

  if (value.relationSummaries !== undefined) {
    if (!Array.isArray(value.relationSummaries)) {
      errors.push("document.relationSummaries: must be an array when provided");
    } else {
      value.relationSummaries.forEach((item, index) => {
        validateRelationSummary(item, index, errors);
      });
    }
  }


  if (value.evidenceLinks !== undefined) {
    if (!Array.isArray(value.evidenceLinks)) {
      errors.push("document.evidenceLinks: must be an array when provided");
    } else {
      const seenEvidenceIds = new Set<string>();
      const seenTuples = new Set<string>();
      value.evidenceLinks.forEach((item, index) => {
        if (!validateEvidenceLink(item, index, errors)) {
          return;
        }

        if (seenEvidenceIds.has(item.id)) {
          errors.push(`evidenceLinks[${index}].id: duplicate id '${item.id}'`);
        }
        seenEvidenceIds.add(item.id);

        const tupleKey = `${item.fromCardId}:${item.toCardId}:${item.type}`;
        if (seenTuples.has(tupleKey)) {
          errors.push(`evidenceLinks[${index}]: duplicate link tuple '${tupleKey}'`);
        }
        seenTuples.add(tupleKey);
      });
    }
  }

  if (value.patchApplyLog !== undefined) {
    if (!Array.isArray(value.patchApplyLog)) {
      errors.push("document.patchApplyLog: must be an array when provided");
    } else {
      value.patchApplyLog.forEach((item, index) => {
        validatePatchApplyLogEntry(item, index, errors);
      });
    }
  }

  if (value.mergeSuggestionDecisions !== undefined) {
    if (!Array.isArray(value.mergeSuggestionDecisions)) {
      errors.push("document.mergeSuggestionDecisions: must be an array when provided");
    } else {
      value.mergeSuggestionDecisions.forEach((item, index) => {
        validateMergeSuggestionDecisionEntry(item, index, errors);
      });
    }
  }

  if (value.contradictionSignalDecisions !== undefined) {
    if (!Array.isArray(value.contradictionSignalDecisions)) {
      errors.push("document.contradictionSignalDecisions: must be an array when provided");
    } else {
      value.contradictionSignalDecisions.forEach((item, index) => {
        validateContradictionSignalDecisionEntry(item, index, errors);
      });
    }
  }

  if (value.critiqueInputs !== undefined) {
    if (!Array.isArray(value.critiqueInputs)) {
      errors.push("document.critiqueInputs: must be an array when provided");
    } else {
      value.critiqueInputs.forEach((item, index) => {
        validateCritiqueInput(item, index, errors);
      });
    }
  }

  if (value.reproposalDiffs !== undefined) {
    if (!Array.isArray(value.reproposalDiffs)) {
      errors.push("document.reproposalDiffs: must be an array when provided");
    } else {
      value.reproposalDiffs.forEach((item, index) => {
        validateReproposalDiff(item, index, errors);
      });
    }
  }

  if (value.reviewAttribution !== undefined) {
    validateReviewAttribution(value.reviewAttribution, errors);
  }

  if (value.deterministicTieBreak !== undefined) {
    validateDeterministicTieBreak(value.deterministicTieBreak, errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, document: value as DocumentV1 };
}

// ---------------------------------------------------------------------------
// Advisory-only diagnostics (NOT part of the fail-closed validation gate)
// ---------------------------------------------------------------------------

/**
 * DOMAIN-ISLAND-MEMBERSHIP-01 / F-5 / R2(a)-検証
 * (`02_Architecture/functional-dependency-integrity-2026-08-06.html` §8.1)
 *
 * Reports cards that appear in more than one island's `cardIds`. The norm
 * "a card belongs to at most one island" is stated by `getIslandsForCard()`
 * in `island_edge_aggregate.ts`, and the drag&drop write path already enforces
 * it via `moveCardToIsland()`. The canonicalization write path
 * (`canonical_ops.ts` `updateIslands()`) does not: a cross-island merge adds
 * the canonical card to EVERY island that held a source card.
 *
 * This is deliberately **advisory only** and is NOT called from
 * `validateDocumentV1Strict()`. §8.1 (R2(a)-検証) concluded that fail-closed
 * rejection of this condition is the wrong trade-off for a local-first app
 * with no document-recovery UI — the risk of a document that can no longer be
 * opened outweighs the harm. The violation rate is to be measured first; any
 * later promotion to a hard error requires a fresh ADR-0047 applicability
 * check. Callers must therefore keep this off blocking paths (save, share,
 * import, export, CI): dev-time console warnings, a non-blocking diagnostic
 * script, or unit tests only.
 *
 * @returns one human-readable advisory per offending card; empty when the
 *          card→island functional dependency holds.
 */
export function checkIslandMembershipIntegrity(document: DocumentV1): string[] {
  const islands = document?.islands;
  if (!Array.isArray(islands)) {
    return [];
  }

  // Insertion-ordered so the output is deterministic: cards in order of first
  // appearance, islands in document order.
  const islandIdsByCardId = new Map<string, string[]>();

  islands.forEach((island, index) => {
    const cardIds = island?.cardIds;
    if (!Array.isArray(cardIds)) {
      return;
    }

    const islandId = typeof island.id === "string" && island.id.length > 0 ? island.id : `islands[${index}]`;
    // Repeats inside one island are a different (intra-island) condition and
    // must not be mistaken for cross-island membership.
    const seenInThisIsland = new Set<string>();

    for (const cardId of cardIds) {
      if (typeof cardId !== "string" || seenInThisIsland.has(cardId)) {
        continue;
      }
      seenInThisIsland.add(cardId);

      const existing = islandIdsByCardId.get(cardId);
      if (existing) {
        existing.push(islandId);
      } else {
        islandIdsByCardId.set(cardId, [islandId]);
      }
    }
  });

  const advisories: string[] = [];
  for (const [cardId, islandIds] of islandIdsByCardId) {
    if (islandIds.length < 2) {
      continue;
    }
    advisories.push(
      `islands: card '${cardId}' belongs to ${islandIds.length} islands (${islandIds.join(", ")}): a card should belong to at most one island`
    );
  }

  return advisories;
}
