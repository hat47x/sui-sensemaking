import type { DocumentV1 } from "../domain/types";
import { resolveKnownEdgeType } from "../domain/types";
import { SafeModePolicy } from "../domain/policy/safe_mode";
import { canonicalizeJson } from "../domain/patch/patch_fingerprint";

// EXT-CONN-01 (ADR-0054 stage 1): the transport-independent read-only
// projection core for the external-connection layer. A future MCP server
// (stdio first, then streamable HTTP + OAuth 2.1) is a THIN adapter over
// this module -- ADR-0054 keeps the projection IR transport-independent so
// the MCP layer can be swapped without a contract change (issue AC-5).
//
// Why this lives next to agent_task_export.ts and reuses SafeModePolicy
// verbatim: the redaction boundary is the safety-bearing part. Porting it
// into a second language (e.g. the Python backend) would risk the SafeMode
// rules drifting between surfaces, silently widening exposure. The MCP
// process shares THIS module instead (monorepo import, or a later hoist to
// a shared package -- a structural follow-up, not a contract change).
//
// External read surface == the "share" SafeMode context: the content leaves
// the app boundary to an outside agent, so with SafeMode ON no card text is
// exposed (only structure/counts). Anti-scoring (ADR-0001/ADR-0049 §4.2):
// no score/rank/confidence/priority is ever emitted, in the output or the
// hashed payload.
//
// 2026-07-13 re-review gate (EXT-CONN-01 AC-1, prerequisite for the MCP
// adapter subslice): an unreviewed card's id/ref must never appear in ANY
// constraint's output, not just reviewed-only's. A supports/contradicts/edge
// link is therefore only in scope when BOTH endpoints are reviewed -- an
// unreviewed card must not surface even as a bare id via a link endpoint,
// since that alone reveals its existence and relationships. Redaction also
// no longer reuses SafeModePolicy.summarizeForSafeMode's short hash: a hash
// of withheld text is a correlation/fingerprint vector across repeated reads
// that a standing external MCP surface can query at will (unlike the
// one-shot human copy/paste agent_task_export.ts uses it for); redactText's
// length-only placeholder does not have that property.

export const CONTEXT_PROJECTION_CONSTRAINTS = [
  "reviewed-only",
  "evidence",
  "contradiction",
  "summary",
] as const;

export type ContextProjectionConstraint = (typeof CONTEXT_PROJECTION_CONSTRAINTS)[number];

export type ProjectedCard = {
  id: string;
  claimType: string | null;
  /** Work-state metadata (DOGFOOD-08). Not text; safe to expose even in
   * SafeMode — it is part of the structural/working-state projection that
   * an AI co-worker needs to respect hold/critique without seeing content. */
  holdState: "held" | "pending" | "shelved" | null;
  /** Exposed only when the card is reviewed AND SafeMode is OFF; otherwise a redaction placeholder. */
  text: string;
  reviewed: boolean;
  /** True when the real text was withheld (unreviewed and/or SafeMode). */
  redacted: boolean;
};

export type ProjectedRelation = { from: string; to: string; type: string };
export type ProjectedLink = { from: string; to: string };

// sensemaking_technique.md §4 (優先3-1): structural void state — SafeMode-safe (only
// kind/refs/resolved, never the title/detail which can quote card text).
export type ProjectedVoid = {
  id: string;
  kind: string;
  resolved: boolean;
  cardIds?: string[];
  islandIds?: string[];
};

// Narrative A/B cross-check state (sensemaking_technique.md §5, 優先3): per-check counts
// and the directions present. Structural only — no issue messages.
export type ProjectedNarrativeCheck = {
  id: string;
  counts?: { bMissingInA: number; aMissingInB: number };
  issueDirections: string[];
};

export type ContextProjectionV1 = {
  schemaVersion: "context-projection.v1";
  docId: string;
  /** `${doc.id}:${doc.updatedAt}` -- same shape agent-task.v1 uses. */
  baseDocSignature: string;
  constraint: ContextProjectionConstraint;
  safeMode: boolean;
  cards: ProjectedCard[];
  islands: Array<{ id: string; title: string }>;
  relations: ProjectedRelation[];
  evidence: ProjectedLink[];
  contradictions: ProjectedLink[];
  counts: { reviewed: number; unreviewed: number; redacted: number };
  voids: ProjectedVoid[];
  narrativeChecks: ProjectedNarrativeCheck[];
  /** sha256 hex over the canonical-JSON projection payload (deterministic; excludes no-op fields). */
  bundleHash: string;
};

export type ContextProjectionInput = {
  doc: DocumentV1;
  constraint: ContextProjectionConstraint;
  safeMode: boolean;
};

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function isReviewed(card: DocumentV1["cards"][number]): boolean {
  return card.textReviewed === true;
}

/**
 * A card's real text is exposed only at the external read surface when it is
 * reviewed and SafeMode is OFF. This mirrors agent_task_export's "share"
 * boundary exactly so the two external surfaces cannot drift.
 */
function projectCardText(
  card: DocumentV1["cards"][number],
  safeMode: boolean,
): { text: string; redacted: boolean } {
  const canExpose = SafeModePolicy.canExposeText("card.text", "share", safeMode) && isReviewed(card);
  if (canExpose) {
    return { text: card.text, redacted: false };
  }
  return { text: SafeModePolicy.redactText(card.text, true), redacted: true };
}

const byFromThenTo = (a: ProjectedLink, b: ProjectedLink): number =>
  a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from);

/**
 * Build a read-only, constraint-scoped, SafeMode-respecting projection of the
 * document for an external agent. Pure and deterministic given the inputs.
 */
export async function buildContextProjection(input: ContextProjectionInput): Promise<ContextProjectionV1> {
  const { doc, constraint, safeMode } = input;

  const allCards = [...doc.cards].sort((a, b) => a.id.localeCompare(b.id));
  const reviewedCount = allCards.filter(isReviewed).length;
  const unreviewedCount = allCards.length - reviewedCount;
  const reviewedCardIds = new Set(allCards.filter(isReviewed).map((card) => card.id));

  // A link is only in scope when BOTH endpoints are reviewed -- otherwise the
  // unreviewed endpoint's id/ref would leak through the link itself even
  // though its card text stays redacted (see 2026-07-13 gate note above).
  const bothEndpointsReviewed = (link: { fromCardId: string; toCardId: string }): boolean =>
    reviewedCardIds.has(link.fromCardId) && reviewedCardIds.has(link.toCardId);

  const evidenceLinks = doc.evidenceLinks ?? [];
  const supports = evidenceLinks
    .filter((link) => link.type === "supports" && bothEndpointsReviewed(link))
    .map((link) => ({ from: link.fromCardId, to: link.toCardId }))
    .sort(byFromThenTo);
  const contradicts = evidenceLinks
    .filter((link) => link.type === "contradicts" && bothEndpointsReviewed(link))
    .map((link) => ({ from: link.fromCardId, to: link.toCardId }))
    .sort(byFromThenTo);

  // Decide which cards appear as nodes for the requested constraint.
  let cardIdsInScope: Set<string>;
  if (constraint === "summary") {
    cardIdsInScope = new Set();
  } else if (constraint === "reviewed-only") {
    cardIdsInScope = new Set(allCards.filter(isReviewed).map((card) => card.id));
  } else if (constraint === "evidence") {
    cardIdsInScope = new Set(supports.flatMap((link) => [link.from, link.to]));
  } else {
    // contradiction
    cardIdsInScope = new Set(contradicts.flatMap((link) => [link.from, link.to]));
  }

  // SEC-CONTEXT-PROJECTION-01: redactedCount reports the WHOLE document, not
  // just the in-scope subset — consistent with reviewedCount/unreviewedCount
  // and the documented invariant ("counts report the whole document"). The
  // summary constraint has an empty card set, so counting only in-scope cards
  // would always yield 0 and hide how much content SafeMode redacts.
  let redactedCount = 0;
  for (const card of allCards) {
    if (projectCardText(card, safeMode).redacted) redactedCount += 1;
  }
  const cards: ProjectedCard[] = allCards
    .filter((card) => cardIdsInScope.has(card.id))
    .map((card) => {
      const reviewed = isReviewed(card);
      const projected = projectCardText(card, safeMode);
      return {
        id: card.id,
        claimType: card.claimType ?? null,
        holdState: card.holdState ?? null,
        text: projected.text,
        reviewed,
        redacted: projected.redacted,
      };
    });

  const islands = [...doc.islands]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((island) => ({ id: island.id, title: island.title ?? "(無題)" }));

  // Relations are only meaningful when both endpoints are in scope. For
  // summary they are always in scope of the full doc (structure only).
  const relationScope: (id: string) => boolean =
    constraint === "summary" ? (id) => reviewedCardIds.has(id) : (id) => cardIdsInScope.has(id);
  const relations: ProjectedRelation[] = doc.edges
    .filter((edge) => relationScope(edge.fromId) && relationScope(edge.toId))
    .map((edge) => ({ from: edge.fromId, to: edge.toId, type: resolveKnownEdgeType(edge.type) }))
    .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));

  // The evidence/contradiction link lists are surfaced for the constraint
  // that asked for them (and for summary as structure).
  const evidence = constraint === "evidence" || constraint === "summary" ? supports : [];
  const contradictions = constraint === "contradiction" || constraint === "summary" ? contradicts : [];

  // Hash payload: structural only, never any numeric quality field. Card text
  // is included ONLY when it was actually exposed (redacted placeholders would
  // otherwise let a SafeMode toggle change the hash for the same real content
  // -- but exposure state IS part of what was shared, so we hash id + reviewed
  // + redacted + the exposed text, and never the withheld original).
  // An unreviewed card's id must not surface through a void either (same gate as
  // the links above): keep only reviewed card ids, and omit the field when none remain.
  const voids = (doc.voids ?? []).map((v) => {
    const reviewedVoidCardIds = (v.cardIds ?? []).filter((id) => reviewedCardIds.has(id));
    return {
      id: v.id,
      kind: v.kind,
      resolved: v.resolved === true,
      ...(reviewedVoidCardIds.length > 0 ? { cardIds: reviewedVoidCardIds } : {}),
      ...(v.islandIds && v.islandIds.length > 0 ? { islandIds: v.islandIds } : {}),
    };
  });
  const narrativeChecks = (doc.narratives ?? []).flatMap((narrative) =>
    (narrative.checks ?? []).map((check) => ({
      id: check.id,
      ...(check.counts ? { counts: check.counts } : {}),
      issueDirections: (check.issues ?? []).flatMap((issue) =>
        issue.direction ? [issue.direction] : [],
      ),
    })),
  );
  const hashPayload = {
    schemaVersion: "context-projection.v1",
    docId: doc.id,
    baseDocSignature: `${doc.id}:${doc.updatedAt}`,
    constraint,
    safeMode,
    cards: cards.map((card) => ({
      id: card.id,
      claimType: card.claimType,
      reviewed: card.reviewed,
      redacted: card.redacted,
      text: card.redacted ? null : card.text,
    })),
    islands,
    relations,
    evidence,
    contradictions,
    counts: { reviewed: reviewedCount, unreviewed: unreviewedCount, redacted: redactedCount },
    voids,
    narrativeChecks,
  };
  const bundleHash = await sha256Hex(canonicalizeJson(hashPayload));

  return {
    schemaVersion: "context-projection.v1",
    docId: doc.id,
    baseDocSignature: `${doc.id}:${doc.updatedAt}`,
    constraint,
    safeMode,
    cards,
    islands,
    relations,
    evidence,
    contradictions,
    counts: { reviewed: reviewedCount, unreviewed: unreviewedCount, redacted: redactedCount },
    voids,
    narrativeChecks,
    bundleHash,
  };
}
