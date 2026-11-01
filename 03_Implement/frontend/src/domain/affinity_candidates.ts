import type { Card, Document } from "./types";

export type AffinityCandidateReason =
  | "lexical-overlap"
  | "shared-island"
  | "shared-source";

export type AffinityCandidate = {
  cardId: string;
  score: number;
  reasons: AffinityCandidateReason[];
};

export type RankAffinityOptions = {
  limit?: number;
  minScore?: number;
};

const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_SCORE = 0.05;
const LEXICAL_WEIGHT = 0.7;
const ISLAND_WEIGHT = 0.2;
const SOURCE_WEIGHT = 0.1;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "have",
  "into",
  "する",
  "した",
  "して",
  "です",
  "ます",
  "こと",
  "もの",
  "ため",
  "から",
  "として",
  "について",
]);

/**
 * Tokenize for a deterministic, local baseline.
 *
 * ASCII words are split on non-alphanumerics. Japanese text has no spaces, so
 * we also add character bigrams from Han/Hiragana/Katakana runs. This keeps the
 * ranking dependency-free and reproducible; it is not a semantic model.
 */
export function tokenizeForAffinity(text: string): Set<string> {
  const tokens = new Set<string>();
  const normalized = text.normalize("NFKC").toLowerCase();

  for (const match of normalized.matchAll(/[a-z0-9]{2,}/g)) {
    const token = match[0];
    if (!STOP_WORDS.has(token)) {
      tokens.add(token);
    }
  }

  const cjkRuns = normalized.replace(
    /[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu,
    " ",
  );
  for (const run of cjkRuns.split(/\s+/)) {
    if (run.length < 2) {
      continue;
    }
    for (let index = 0; index + 1 < run.length; index += 1) {
      const token = run.slice(index, index + 2);
      if (!STOP_WORDS.has(token)) {
        tokens.add(token);
      }
    }
  }

  return tokens;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function islandIdsByCard(document: Document): Map<string, Set<string>> {
  const byCard = new Map<string, Set<string>>();
  for (const island of document.islands) {
    for (const cardId of island.cardIds) {
      const existing = byCard.get(cardId) ?? new Set<string>();
      existing.add(island.id);
      byCard.set(cardId, existing);
    }
  }
  return byCard;
}

function sharedSource(left: Card, right: Card): boolean {
  const leftSource = left.meta?.source?.trim();
  const rightSource = right.meta?.source?.trim();
  return Boolean(leftSource) && leftSource === rightSource;
}

/**
 * Rank related-card candidates locally, without a learned model or network.
 *
 * This is the retrieval-only baseline: it surfaces candidate pairs for a human
 * to inspect and never changes the document. Ties are broken by card id so the
 * same document produces the same ranking.
 */
export function rankAffinityCandidates(
  document: Document,
  focusCardId: string,
  options: RankAffinityOptions = {},
): AffinityCandidate[] {
  const focus = document.cards.find((card) => card.id === focusCardId);
  if (!focus) {
    return [];
  }
  const limit = Math.max(1, Math.min(20, options.limit ?? DEFAULT_LIMIT));
  const minScore = Math.max(0, options.minScore ?? DEFAULT_MIN_SCORE);
  const focusTokens = tokenizeForAffinity(focus.text);
  const islands = islandIdsByCard(document);
  const focusIslands = islands.get(focus.id) ?? new Set<string>();

  const candidates: AffinityCandidate[] = [];
  for (const card of document.cards) {
    if (card.id === focus.id) {
      continue;
    }
    const cardTokens = tokenizeForAffinity(card.text);
    const lexical = jaccard(focusTokens, cardTokens);
    const cardIslands = islands.get(card.id) ?? new Set<string>();
    let sharedIsland = false;
    for (const islandId of focusIslands) {
      if (cardIslands.has(islandId)) {
        sharedIsland = true;
        break;
      }
    }
    const sameSource = sharedSource(focus, card);
    const reasons: AffinityCandidateReason[] = [];
    if (lexical > 0) {
      reasons.push("lexical-overlap");
    }
    if (sharedIsland) {
      reasons.push("shared-island");
    }
    if (sameSource) {
      reasons.push("shared-source");
    }
    const score =
      lexical * LEXICAL_WEIGHT
      + (sharedIsland ? ISLAND_WEIGHT : 0)
      + (sameSource ? SOURCE_WEIGHT : 0);
    if (score < minScore) {
      continue;
    }
    candidates.push({
      cardId: card.id,
      score: Math.round(score * 1000) / 1000,
      reasons,
    });
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.cardId.localeCompare(right.cardId);
  });
  return candidates.slice(0, limit);
}
