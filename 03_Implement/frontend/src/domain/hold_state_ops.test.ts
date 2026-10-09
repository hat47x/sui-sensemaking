import { describe, expect, it } from "vitest";
import type { Card, DocumentV1 } from "./types";
import { canonicalHoldState, updateCardHoldState, updateCardHoldStateAndShelf } from "./hold_state_ops";

const cards: Card[] = [
  { id: "card-1", text: "one", x: 0, y: 0 },
  { id: "card-2", text: "two", x: 10, y: 10, holdState: "held" },
];

describe("canonicalHoldState", () => {
  it("reads the legacy pending state as held", () => {
    expect(canonicalHoldState("pending")).toBe("held");
    expect(canonicalHoldState("held")).toBe("held");
    expect(canonicalHoldState("shelved")).toBe("shelved");
    expect(canonicalHoldState(undefined)).toBeUndefined();
  });
});

describe("updateCardHoldState", () => {
  it("sets a selected hold state without changing other cards", () => {
    const result = updateCardHoldState(cards, "card-1", "shelved");

    expect(result[0]).toEqual({ ...cards[0], holdState: "shelved" });
    expect(result[1]).toBe(cards[1]);
  });

  it("restores active state by removing the optional field", () => {
    const result = updateCardHoldState(cards, "card-2", "active");

    expect(result[1]).toEqual({ id: "card-2", text: "two", x: 10, y: 10 });
    expect("holdState" in result[1]).toBe(false);
  });
});

describe("updateCardHoldStateAndShelf", () => {
  const document: DocumentV1 = {
    version: 1,
    id: "doc-1",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards,
    edges: [],
    islands: [],
  };

  it("shelves a card without changing its position", () => {
    const result = updateCardHoldStateAndShelf(document, "card-1", "shelved", "2026-06-21T01:00:00.000Z");

    expect(result.cards[0]).toEqual({ ...cards[0], holdState: "shelved" });
    expect(result.cards[0]).toMatchObject({ x: 0, y: 0 });
    expect(result.shelf).toEqual([{ cardId: "card-1", shelvedAt: "2026-06-21T01:00:00.000Z" }]);
  });

  it("restores a shelved card and removes the optional shelf field", () => {
    const shelved = updateCardHoldStateAndShelf(document, "card-1", "shelved", "2026-06-21T01:00:00.000Z");
    const result = updateCardHoldStateAndShelf(shelved, "card-1", "active", "2026-06-21T02:00:00.000Z");

    expect(result.cards[0]).toEqual(cards[0]);
    expect(result.shelf).toBeUndefined();
  });
});

describe("updateCardHoldStateAndShelf", () => {
  const document: DocumentV1 = {
    version: 1,
    id: "doc-1",
    createdAt: "2026-06-21T00:00:00.000Z",
    updatedAt: "2026-06-21T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards,
    edges: [],
    islands: [],
  };

  it("shelves a card without changing its position", () => {
    const result = updateCardHoldStateAndShelf(document, "card-1", "shelved", "2026-06-21T01:00:00.000Z");

    expect(result.cards[0]).toEqual({ ...cards[0], holdState: "shelved" });
    expect(result.cards[0]?.x).toBe(0);
    expect(result.cards[0]?.y).toBe(0);
    expect(result.shelf).toEqual([{ cardId: "card-1", shelvedAt: "2026-06-21T01:00:00.000Z" }]);
  });

  it("keeps the original shelf timestamp when shelving again", () => {
    const shelved = updateCardHoldStateAndShelf(document, "card-1", "shelved", "2026-06-21T01:00:00.000Z");
    const result = updateCardHoldStateAndShelf(shelved, "card-1", "shelved", "2026-06-21T02:00:00.000Z");

    expect(result.shelf?.[0]?.shelvedAt).toBe("2026-06-21T01:00:00.000Z");
  });

  it("restores a shelved card and removes the optional shelf field", () => {
    const shelved = updateCardHoldStateAndShelf(document, "card-1", "shelved", "2026-06-21T01:00:00.000Z");
    const result = updateCardHoldStateAndShelf(shelved, "card-1", "active", "2026-06-21T02:00:00.000Z");

    expect(result.cards[0]).toEqual(cards[0]);
    expect(result.shelf).toBeUndefined();
  });
});
