import type { DocumentV1 } from "../domain/types";

export type ResourceActionIntentV1 = Readonly<{
  protocolVersion: "1";
  applicationID: "sui";
  resourceID: string;
  actionID: "sui.move";
  expectedRevision: string;
  payload: Readonly<{ cardId: string; x: number; y: number }>;
}>;

export type SuiCardMoveOrigin = Readonly<{
  document: DocumentV1;
  etag: string | null;
}>;

export type SuiDocumentReadback = Readonly<{
  document: DocumentV1;
  etag?: string | null;
}>;

export type SuiCardMoveActionPorts = Readonly<{
  /** Authenticated TEI Action transport; rejects on denial or conflict. */
  dispatch: (intent: ResourceActionIntentV1) => Promise<string>;
  /** Read SUI's authoritative Document with its server ETag (no cache). */
  readDocument: (documentId: string) => Promise<SuiDocumentReadback>;
  /** Must return the synchronous boolean true only while origin is current. */
  isCurrent: (origin: SuiCardMoveOrigin) => boolean;
  /** Atomically guard and apply the server-committed snapshot; return true on success. */
  applyConfirmed: (readback: { document: DocumentV1; etag: string }) => boolean;
}>;

export class SuiCardMoveActionError extends Error {
  readonly code: string;
  readonly committedRevision: string | null;

  constructor(code: string, committedRevision: string | null = null) {
    super(code);
    this.name = "SuiCardMoveActionError";
    this.code = code;
    this.committedRevision = committedRevision;
  }
}

function selectedCard(document: DocumentV1, id: string) {
  if (!Array.isArray(document.cards)) return null;
  const matching = document.cards.filter((card) => card && card.id === id);
  return matching.length === 1 ? matching[0] : null;
}

function membership(document: DocumentV1, cardId: string): string[] | null {
  if (!Array.isArray(document.islands)) return null;
  const members: string[] = [];
  for (const island of document.islands) {
    if (!island || typeof island.id !== "string" || !Array.isArray(island.cardIds)) return null;
    if (island.cardIds.includes(cardId)) members.push(island.id);
  }
  return members.sort();
}

function current(ports: SuiCardMoveActionPorts, origin: SuiCardMoveOrigin) {
  try {
    return ports.isCurrent(origin) === true;
  } catch {
    return false;
  }
}

/**
 * Compare the application document rather than only x/y and island cardIds.
 * A successful HTTP revision does not prove that the server retained source,
 * Hold, review, unknown Edge types, affiliations, or unrelated Card changes.
 *
 * Object key ordering and optional null-vs-undefined are not persisted
 * semantic differences in DocumentV1; array order and all concrete values are.
 */
function equivalentStoredDocument(expected: DocumentV1, actual: DocumentV1): boolean {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => stable(entry)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const entries = Object.keys(obj).filter((key) => obj[key] !== undefined && obj[key] !== null);
      entries.sort();
      return `{${entries.map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  };
  // Pydantic materializes Island.collapsed=false even when an old browser
  // Document omitted it. This is a documented schema default, not a change.
  // Do not drop/normalize source, review or structural data.
  const persisted = (document: DocumentV1) => ({
    ...document,
    updatedAt: null, // backend-controlled timestamp
    islands: document.islands.map((island) => {
      // SUI's Pydantic Island model mirrors a declared shape into geometry
      // (and vice versa) for legacy DocumentV1 snapshots. Only synthesize the
      // *missing* mirror; an explicitly divergent or altered shape must fail.
      const geometry = island.geometry ?? (
        island.shape?.kind === "polygon" && island.shape.points
          ? { type: "polygon" as const, points: island.shape.points }
          : island.shape?.kind === "rect"
            ? { type: "rect" as const }
            : undefined
      );
      const shape = island.shape ?? (
        geometry?.type === "polygon" && geometry.points
          ? { kind: "polygon" as const, points: geometry.points }
          : geometry?.type === "rect"
            ? { kind: "rect" as const }
            : undefined
      );
      return {
        ...island,
        collapsed: island.collapsed ?? false,
        // Pydantic's Island.ensure_summary_review_default inserts false
        // when a preexisting summary has no explicit review decision.
        summaryReviewed: island.summaryText != null
          ? island.summaryReviewed ?? false
          : island.summaryReviewed,
        geometry,
        shape,
      };
    }),
  });
  return stable(persisted(expected)) === stable(persisted(actual));
}

/**
 * A Card-move action only authorizes coordinates and island membership.
 * Validate that its locally proposed snapshot did not also change source,
 * reviewer, unknown Edge kinds, other Cards, island metadata, or card order.
 * Reject before dispatch, not after an irreversible remote commit.
 */
function isPureCardMove(before: DocumentV1, after: DocumentV1, cardId: string): boolean {
  // Do not dereference partially loaded or untrusted local snapshots.
  if (!Array.isArray(before.cards) || !Array.isArray(after.cards) ||
      !Array.isArray(before.islands) || !Array.isArray(after.islands) ||
      before.cards.length !== after.cards.length ||
      before.islands.length !== after.islands.length) return false;
  for (let i = 0; i < before.cards.length; i += 1) {
    if (!before.cards[i] || !after.cards[i] ||
        before.cards[i].id !== after.cards[i].id) return false;
  }
  if (before.islands.some((island) => !island || !Array.isArray(island.cardIds)) ||
      after.islands.some((island) => !island || !Array.isArray(island.cardIds))) return false;
  const islandById = new Map(before.islands.map((island) => [island.id, island]));
  if (islandById.size !== before.islands.length) return false;
  for (const island of after.islands) {
    const initial = islandById.get(island.id);
    if (!initial || !Array.isArray(island.cardIds) ||
        island.cardIds.some((id) => typeof id !== "string")) return false;
    const withoutCard = island.cardIds.filter((id) => id !== cardId);
    const initialWithoutCard = initial.cardIds.filter((id) => id !== cardId);
    if (JSON.stringify(withoutCard) !== JSON.stringify(initialWithoutCard)) return false;
  }
  const originalCard = selectedCard(before, cardId);
  if (!originalCard) return false;
  // Reverse the *permitted* movement and compare everything else.
  const restored: DocumentV1 = {
    ...after,
    cards: after.cards.map((card) =>
      card.id === cardId ? { ...card, x: originalCard.x, y: originalCard.y } : card,
    ),
    islands: after.islands.map((island) => ({
      ...island,
      cardIds: [...islandById.get(island.id)!.cardIds],
    })),
  };
  return equivalentStoredDocument(before, restored);
}

/**
 * SUI-owned adapter for a TEI resource-scoped Action commit. Native Canvas,
 * domain move calculation and Undo remain in SUI. No endpoint is activated by
 * importing this module; the host application must supply all four ports.
 */
export function createSuiCardMoveActionCommit(ports: SuiCardMoveActionPorts) {
  const active = new Set<string>();

  return async (
    origin: SuiCardMoveOrigin,
    nextDocument: DocumentV1,
    cardId: string,
  ): Promise<string | null> => {
    if (!origin || !origin.document || origin.document.version !== 1 ||
        !origin.document.id || !origin.etag || typeof origin.etag !== "string" ||
        !nextDocument || nextDocument.version !== 1 || nextDocument.id !== origin.document.id ||
        !cardId) {
      throw new SuiCardMoveActionError("invalid_move_origin");
    }
    const before = selectedCard(origin.document, cardId);
    const after = selectedCard(nextDocument, cardId);
    if (!before || !after || !Number.isFinite(after.x) || !Number.isFinite(after.y)) {
      throw new SuiCardMoveActionError("invalid_move_target");
    }
    // No server mutation when the UI's proposed change is not exclusively
    // this Card's coordinates and containment membership.
    if (!isPureCardMove(origin.document, nextDocument, cardId)) {
      throw new SuiCardMoveActionError("invalid_move_target");
    }
    const originalMembership = membership(origin.document, cardId);
    const nextMembership = membership(nextDocument, cardId);
    if (!originalMembership || !nextMembership) throw new SuiCardMoveActionError("invalid_move_target");
    if (before.x === after.x && before.y === after.y) {
      if (JSON.stringify(originalMembership) !== JSON.stringify(nextMembership)) {
        throw new SuiCardMoveActionError("invalid_move_target");
      }
      return null;
    }
    const resourceKey = JSON.stringify(["sui", origin.document.id]);
    if (active.has(resourceKey)) throw new SuiCardMoveActionError("action_in_flight");
    if (!current(ports, origin)) throw new SuiCardMoveActionError("local_state_changed");
    active.add(resourceKey);
    let committedRevision: string | null = null;
    try {
      // Payload deliberately excludes Document, reviewer and authority claims.
      // The SUI-owned server command must revalidate the Card and island move.
      committedRevision = await ports.dispatch({
        protocolVersion: "1",
        applicationID: "sui",
        resourceID: origin.document.id,
        actionID: "sui.move",
        expectedRevision: origin.etag,
        payload: { cardId, x: after.x, y: after.y },
      });
      if (typeof committedRevision !== "string" || committedRevision.length === 0) {
        throw new SuiCardMoveActionError("invalid_commit_response");
      }
      let readback: SuiDocumentReadback;
      try {
        readback = await ports.readDocument(origin.document.id);
      } catch {
        throw new SuiCardMoveActionError("readback_failed", committedRevision);
      }
      if (!readback || !readback.document || readback.document.version !== 1 ||
          readback.document.id !== origin.document.id ||
          !readback.etag || typeof readback.etag !== "string") {
        throw new SuiCardMoveActionError("invalid_readback", committedRevision);
      }
      if (readback.etag !== committedRevision) {
        throw new SuiCardMoveActionError("readback_revision_mismatch", committedRevision);
      }
      const committedCard = selectedCard(readback.document, cardId);
      if (!committedCard || committedCard.x !== after.x || committedCard.y !== after.y ||
          JSON.stringify(membership(readback.document, cardId)) !== JSON.stringify(nextMembership)) {
        throw new SuiCardMoveActionError("readback_move_mismatch", committedRevision);
      }
      // Even a server success with the expected ETag can carry a malformed
      // document. Preserve committedRevision in *every* post-commit error:
      // consumers must reconcile, not retry the irreversible mutation.
      let readbackMatches = false;
      try {
        readbackMatches = equivalentStoredDocument(nextDocument, readback.document);
      } catch {
        throw new SuiCardMoveActionError("invalid_readback", committedRevision);
      }
      if (!readbackMatches) {
        throw new SuiCardMoveActionError("readback_document_mismatch", committedRevision);
      }
      if (!current(ports, origin)) {
        throw new SuiCardMoveActionError("local_state_changed", committedRevision);
      }
      // The SUI caller must atomically check the origin again inside this port
      // before changing Undo/history/dirty/ETag. Return true only after applying.
      let applied = false;
      try {
        // No await here: a Promise would reopen a race against document reloads,
        // undo/redo, tenant switching or another synchronous state change.
        // The owning app must use an immediate guarded compare-and-apply.
        applied = ports.applyConfirmed({ document: readback.document, etag: readback.etag }) === true;
      } catch {
        // The remote commit may already have succeeded; never retry it here.
      }
      if (!applied) throw new SuiCardMoveActionError("snapshot_not_applied", committedRevision);
      return committedRevision;
    } finally {
      active.delete(resourceKey);
    }
  };
}
