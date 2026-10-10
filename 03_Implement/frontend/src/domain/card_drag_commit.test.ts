import { describe, expect, it } from "vitest";
import { commitCardDrag } from "./card_drag_commit";
import type { DocumentV1 } from "./types";

const baseDocument = (): DocumentV1 => ({
  version: 1,
  id: "doc",
  createdAt: "2026-10-10T00:00:00Z",
  updatedAt: "2026-10-10T00:00:00Z",
  transform: { panX: 0, panY: 0, zoom: 1 },
  cards: [
    { id: "a", text: "first", x: 0, y: 0, holdState: "held", meta: { source: "interview:1" } },
    { id: "b", text: "second", x: 400, y: 0, textReviewed: true },
  ],
  edges: [{ id: "edge", fromId: "a", toId: "b", type: "unknown-future-kind" }],
  islands: [{ id: "old", cardIds: ["a"] }, { id: "new", cardIds: ["b"] }],
  affiliations: [{ id: "aff", cardId: "a", islandId: "old" }],
  reviewAttribution: {
    schemaVersion: "1.0.0",
    reviewState: "human_reviewed",
    reviewedAt: "2026-10-10T00:00:00Z",
    reviewerRef: "person:1",
    auditRecordedAt: "2026-10-10T00:00:00Z",
    overridePolicy: "human_dual_control_only",
  },
});

describe("native card drag commit", () => {
  it("updates card position and island membership in one immutable document", () => {
    const before = baseDocument();
    const after = commitCardDrag(before, { cardId: "a", deltaWorldX: 400, deltaWorldY: 0 });
    expect(after).not.toBe(before);
    expect(before.cards[0].x).toBe(0);
    expect(before.islands[0].cardIds).toEqual(["a"]);
    expect(after.cards[0]).toMatchObject({ id: "a", x: 400, y: 0 });
    expect(after.islands.map(({ id, cardIds }) => ({ id, cardIds }))).toEqual([
      { id: "old", cardIds: [] },
      { id: "new", cardIds: ["b", "a"] },
    ]);
    expect(after.cards[0].meta).toEqual(before.cards[0].meta);
    expect(after.cards[0].holdState).toBe("held");
    expect(after.cards[1]).toBe(before.cards[1]);
    expect(after.edges).toBe(before.edges);
    expect(after.affiliations).toBe(before.affiliations);
    expect(after.reviewAttribution).toBe(before.reviewAttribution);
  });

  it("honors the existing grid snapping semantics", () => {
    const before = baseDocument();
    const after = commitCardDrag(before, { cardId: "a", deltaWorldX: 24, deltaWorldY: 16, snapGridSize: 10 });
    expect(after.cards[0]).toMatchObject({ x: 20, y: 20 });
  });

  it("rejects missing and duplicate card identities and invalid deltas", () => {
    const before = baseDocument();
    const cases = [
      { cardId: "missing", deltaWorldX: 1, deltaWorldY: 2 },
      { cardId: "a", deltaWorldX: Number.NaN, deltaWorldY: 2 },
      { cardId: "a", deltaWorldX: 2, deltaWorldY: Number.POSITIVE_INFINITY },
      { cardId: "a", deltaWorldX: 0, deltaWorldY: 0 },
    ];
    for (const input of cases) {
      expect(commitCardDrag(before, input)).toBe(before);
    }
    const duplicate = { ...before, cards: [...before.cards, { ...before.cards[0] }] };
    expect(commitCardDrag(duplicate, { cardId: "a", deltaWorldX: 1, deltaWorldY: 2 })).toBe(duplicate);
  });

  it("returns unchanged reference if snapping results in no movement", () => {
    const before = baseDocument();
    expect(commitCardDrag(before, {
      cardId: "a", deltaWorldX: 2, deltaWorldY: -1, snapGridSize: 10,
    })).toBe(before);
  });

  it("keeps unrelated fields when a move does not join an island", () => {
    const before = baseDocument();
    const after = commitCardDrag(before, { cardId: "a", deltaWorldX: 5, deltaWorldY: 0 });
    expect(after.islands).toBe(before.islands);
    expect(after.edges).toBe(before.edges);
    expect(after.cards[0].x).toBe(5);
  });
});
