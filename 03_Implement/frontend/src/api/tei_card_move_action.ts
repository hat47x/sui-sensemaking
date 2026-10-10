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
  applyConfirmed: (readback: { document: DocumentV1; etag: string }) => boolean | Promise<boolean>;
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
      if (!current(ports, origin)) {
        throw new SuiCardMoveActionError("local_state_changed", committedRevision);
      }
      // The SUI caller must atomically check the origin again inside this port
      // before changing Undo/history/dirty/ETag. Return true only after applying.
      let applied = false;
      try {
        applied = await ports.applyConfirmed({ document: readback.document, etag: readback.etag }) === true;
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
