import { getIslandWorldBounds } from "./geometry/bounds";
import { moveCardToIsland } from "./island_edge_aggregate";
import { snapValueToGrid } from "./layout_ops";
import type { DocumentV1 } from "./types";

/** The UI holds this optimistic guard from pointerdown until pointerup. */
export type CardDragOrigin = {
  document: DocumentV1;
  etag: string | null;
};

/** Reject a stale or untrusted drag origin without modifying any document. */
export function isCardDragOriginCurrent(
  origin: unknown,
  document: DocumentV1,
  etag: string | null
): origin is CardDragOrigin {
  if (!origin || typeof origin !== "object") {
    return false;
  }
  const candidate = origin as Partial<CardDragOrigin>;
  return candidate.document === document && candidate.etag === etag;
}

export type CardDragCommit = {
  cardId: string;
  deltaWorldX: number;
  deltaWorldY: number;
  snapGridSize?: number;
  cardWidth?: number;
  cardHeight?: number;
};

/**
 * Apply one committed card drag, including a possible island membership change.
 * Pointer previews and cancellations must not invoke this function.
 * Keeps DocumentV1 and existing island ownership in SUI, not in TEI Core.
 */
export function commitCardDrag(document: DocumentV1, input: CardDragCommit): DocumentV1 {
  if (!input.cardId || !Number.isFinite(input.deltaWorldX) || !Number.isFinite(input.deltaWorldY)) {
    return document;
  }
  const card = document.cards.find((candidate) => candidate.id === input.cardId);
  if (!card || document.cards.filter((candidate) => candidate.id === input.cardId).length !== 1) {
    return document;
  }
  const gridSize = input.snapGridSize;
  const snap = (value: number): number =>
    gridSize !== undefined && Number.isFinite(gridSize) && gridSize > 0
      ? snapValueToGrid(value, { gridSize })
      : value;
  const x = snap(card.x + input.deltaWorldX);
  const y = snap(card.y + input.deltaWorldY);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (x === card.x && y === card.y)) {
    return document;
  }

  const cards = document.cards.map((candidate) =>
    candidate.id === input.cardId ? { ...candidate, x, y } : candidate
  );
  let islands = document.islands;
  try {
    const moved = cards.find((candidate) => candidate.id === input.cardId)!;
    const cardsById = new Map(cards.map((candidate) => [candidate.id, candidate] as const));
    const centerX = moved.x + (input.cardWidth ?? 220) / 2;
    const centerY = moved.y + (input.cardHeight ?? 80) / 2;
    const targetIsland = islands.find((island) => {
      if (island.cardIds.includes(input.cardId)) return false;
      const bounds = getIslandWorldBounds(island, cardsById);
      return bounds !== null &&
        centerX >= bounds.x && centerX <= bounds.x + bounds.w &&
        centerY >= bounds.y && centerY <= bounds.y + bounds.h;
    });
    if (targetIsland) {
      islands = moveCardToIsland(islands, input.cardId, targetIsland.id);
    }
  } catch {
    // Match the current Canvas rule: geometry failure must not discard a valid
    // coordinate move, and may not fabricate island membership.
    islands = document.islands;
  }
  return { ...document, cards, islands };
}
