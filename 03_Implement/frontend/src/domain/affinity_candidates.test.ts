import { describe, expect, it } from "vitest";

import { rankAffinityCandidates, tokenizeForAffinity } from "./affinity_candidates";
import type { Card, Document } from "./types";

function card(id: string, text: string, extra: Partial<Card> = {}): Card {
  return { id, text, x: 0, y: 0, ...extra };
}

function documentWith(cards: Card[], islands: Document["islands"] = []): Document {
  return {
    version: 1,
    id: "doc-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    cards,
    edges: [],
    islands,
  } as unknown as Document;
}

describe("tokenizeForAffinity", () => {
  it("drops stop words and keeps CJK bigrams", () => {
    const tokens = tokenizeForAffinity("The customer 課題を整理する");
    expect(tokens.has("the")).toBe(false);
    expect([...tokens].some((token) => token === "課題" || token === "整理")).toBe(true);
  });
});

describe("rankAffinityCandidates", () => {
  it("ranks lexical overlap above unrelated cards", () => {
    const doc = documentWith([
      card("a", "alpha beta gamma"),
      card("b", "alpha beta"),
      card("c", "delta epsilon"),
    ]);

    const ranked = rankAffinityCandidates(doc, "a");

    expect(ranked.map((candidate) => candidate.cardId)).toEqual(["b"]);
    expect(ranked[0].reasons).toContain("lexical-overlap");
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it("adds a bounded bonus for shared islands and sources", () => {
    const doc = documentWith(
      [
        card("a", "alpha", { meta: { source: "interview" } }),
        card("b", "unrelated", { meta: { source: "interview" } }),
      ],
      [{ id: "i1", cardIds: ["a", "b"] }],
    );

    const [candidate] = rankAffinityCandidates(doc, "a");

    expect(candidate.cardId).toBe("b");
    expect(candidate.reasons).toEqual(["shared-island", "shared-source"]);
    expect(candidate.score).toBe(0.3);
  });

  it("excludes unreviewed candidates in read-only contexts", () => {
    const doc = documentWith([
      card("focus", "alpha beta", { textReviewed: true }),
      card("reviewed", "alpha beta", { textReviewed: true }),
      card("draft", "alpha beta", { textReviewed: false }),
    ]);

    const ranked = rankAffinityCandidates(doc, "focus", { reviewedOnly: true });

    expect(ranked.map((candidate) => candidate.cardId)).toEqual(["reviewed"]);
  });

  it("is deterministic for equal scores and respects the limit", () => {
    const doc = documentWith([
      card("focus", "alpha"),
      card("c", "alpha"),
      card("b", "alpha"),
      card("d", "alpha"),
    ]);

    expect(rankAffinityCandidates(doc, "focus", { limit: 2 }).map((item) => item.cardId)).toEqual([
      "b",
      "c",
    ]);
  });

  it("returns an empty list for an unknown focus card", () => {
    expect(rankAffinityCandidates(documentWith([card("a", "alpha")]), "missing")).toEqual([]);
  });
});
