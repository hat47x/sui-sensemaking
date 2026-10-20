import type { Card, CritiqueHistoryEntry, DocumentV1, Island } from "./types";

const DEFAULT_HISTORY_LIMIT = 50;

export type CritiqueHistoryChangeKind = CritiqueHistoryEntry["changeKind"];

export type UpdateCardCritiquePatch = {
  critique?: string;
  /** null clears the tags; undefined leaves the current tags unchanged. */
  critiqueTags?: string[] | null;
};

export type UpdateCardCritiqueWithHistoryOptions = {
  changeKind?: CritiqueHistoryChangeKind;
  note?: string;
  createdAt?: string;
  historyLimit?: number;
  forceHistoryEntry?: boolean;
};

function createEntryId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `critique-history-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTags(tags: string[] | undefined): string[] | null {
  if (!tags || tags.length === 0) {
    return null;
  }
  return [...tags];
}

function tagsEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const leftTags = left ?? [];
  const rightTags = right ?? [];
  return leftTags.length === rightTags.length && leftTags.every((tag, index) => tag === rightTags[index]);
}

/**
 * SUIPV-RATIONALE-HISTORY-01 (Issue #3175): write the current critique while
 * keeping the previous human judgment in `Card.critiqueHistory`.
 *
 * The current `critique` / `critiqueTags` stay the source of truth. History is
 * only appended when a human-facing value actually changes (or when a caller
 * explicitly forces an entry for an import/rollback), so ordinary editing
 * stays light and no empty revision is fabricated.
 */
export function updateCardCritiqueWithHistory(
  document: DocumentV1,
  cardId: string,
  patch: UpdateCardCritiquePatch,
  options: UpdateCardCritiqueWithHistoryOptions = {}
): DocumentV1 {
  let didChange = false;

  const nextCards = document.cards.map((card) => {
    if (card.id !== cardId) {
      return card;
    }

    if (patch.critique === undefined && patch.critiqueTags === undefined) {
      return card;
    }

    const nextCritique = patch.critique !== undefined
      ? (patch.critique.length > 0 ? patch.critique : undefined)
      : card.critique;
    const nextTags = patch.critiqueTags !== undefined
      ? (patch.critiqueTags ?? undefined)
      : card.critiqueTags;
    const critiqueChanged = (card.critique ?? "") !== (nextCritique ?? "");
    const tagsChanged = !tagsEqual(card.critiqueTags, nextTags);
    if (!critiqueChanged && !tagsChanged && options.forceHistoryEntry !== true) {
      return card;
    }

    const nextCard: Card = {
      ...card,
      critique: nextCritique,
      critiqueTags: nextTags,
    };

    const newEntry: CritiqueHistoryEntry = {
      id: createEntryId(),
      createdAt: options.createdAt ?? new Date().toISOString(),
      fromCritique: card.critique ?? null,
      toCritique: nextCard.critique ?? null,
      fromTags: normalizeTags(card.critiqueTags),
      toTags: normalizeTags(nextCard.critiqueTags),
      changeKind: options.changeKind ?? "unknown",
      ...(options.note !== undefined ? { note: options.note } : {}),
    };

    const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    const nextHistory = [...(card.critiqueHistory ?? []), newEntry];
    const trimmedHistory =
      nextHistory.length > historyLimit ? nextHistory.slice(nextHistory.length - historyLimit) : nextHistory;

    didChange = true;
    return {
      ...nextCard,
      critiqueHistory: trimmedHistory,
    };
  });

  if (!didChange) {
    const cardsUpdated = nextCards.some((card, index) => card !== document.cards[index]);
    return cardsUpdated ? { ...document, cards: nextCards } : document;
  }

  return { ...document, cards: nextCards };
}

/**
 * Restore the value a card had right after a recorded revision. The restore is
 * itself a human action, so it appends a `rollback` entry instead of deleting
 * history.
 */
export function restoreCardCritiqueHistoryEntry(
  document: DocumentV1,
  cardId: string,
  entryId: string
): DocumentV1 {
  const card = document.cards.find((item) => item.id === cardId);
  const entry = card?.critiqueHistory?.find((item) => item.id === entryId);
  if (!card || !entry) {
    return document;
  }

  return updateCardCritiqueWithHistory(
    document,
    cardId,
    {
      critique: entry.toCritique ?? "",
      critiqueTags: entry.toTags === null ? null : [...entry.toTags],
    },
    { changeKind: "rollback" }
  );
}

export type UpdateIslandCritiquePatch = {
  critique?: string;
  /** null clears the tags; undefined leaves the current tags unchanged. */
  critiqueTags?: string[] | null;
};

/**
 * Island counterpart of `updateCardCritiqueWithHistory`. Reuses the same
 * entry shape so cards and islands do not grow separate history schemes.
 */
export function updateIslandCritiqueWithHistory(
  document: DocumentV1,
  islandId: string,
  patch: UpdateIslandCritiquePatch,
  options: UpdateCardCritiqueWithHistoryOptions = {}
): DocumentV1 {
  let didChange = false;

  const nextIslands = document.islands.map((island) => {
    if (island.id !== islandId) {
      return island;
    }

    if (patch.critique === undefined && patch.critiqueTags === undefined) {
      return island;
    }

    const nextCritique = patch.critique !== undefined
      ? (patch.critique.length > 0 ? patch.critique : undefined)
      : island.critique;
    const nextTags = patch.critiqueTags !== undefined
      ? (patch.critiqueTags ?? undefined)
      : island.critiqueTags;
    const critiqueChanged = (island.critique ?? "") !== (nextCritique ?? "");
    const tagsChanged = !tagsEqual(island.critiqueTags, nextTags);
    if (!critiqueChanged && !tagsChanged && options.forceHistoryEntry !== true) {
      return island;
    }

    const nextIsland: Island = {
      ...island,
      critique: nextCritique,
      critiqueTags: nextTags,
    };
    const newEntry: CritiqueHistoryEntry = {
      id: createEntryId(),
      createdAt: options.createdAt ?? new Date().toISOString(),
      fromCritique: island.critique ?? null,
      toCritique: nextIsland.critique ?? null,
      fromTags: normalizeTags(island.critiqueTags),
      toTags: normalizeTags(nextIsland.critiqueTags),
      changeKind: options.changeKind ?? "unknown",
      ...(options.note !== undefined ? { note: options.note } : {}),
    };

    const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    const nextHistory = [...(island.critiqueHistory ?? []), newEntry];
    const trimmedHistory =
      nextHistory.length > historyLimit ? nextHistory.slice(nextHistory.length - historyLimit) : nextHistory;

    didChange = true;
    return {
      ...nextIsland,
      critiqueHistory: trimmedHistory,
    };
  });

  if (!didChange) {
    const islandsUpdated = nextIslands.some((island, index) => island !== document.islands[index]);
    return islandsUpdated ? { ...document, islands: nextIslands } : document;
  }

  return { ...document, islands: nextIslands };
}

export function restoreIslandCritiqueHistoryEntry(
  document: DocumentV1,
  islandId: string,
  entryId: string
): DocumentV1 {
  const island = document.islands.find((item) => item.id === islandId);
  const entry = island?.critiqueHistory?.find((item) => item.id === entryId);
  if (!island || !entry) {
    return document;
  }

  return updateIslandCritiqueWithHistory(
    document,
    islandId,
    {
      critique: entry.toCritique ?? "",
      critiqueTags: entry.toTags === null ? null : [...entry.toTags],
    },
    { changeKind: "rollback" }
  );
}
