import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "./types";
import {
  appendStructureDecision,
  structureDecisionsForTarget,
  updateStructureDecisionRationale,
} from "./structure_decisions";

function createDocument(): DocumentV1 {
  return {
    version: 1,
    id: "doc-structure-decisions",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "A", x: 0, y: 0 },
      { id: "c2", text: "B", x: 10, y: 0 },
    ],
    edges: [],
    islands: [{ id: "i1", cardIds: ["c1"] }],
  };
}

describe("appendStructureDecision", () => {
  it("records an island creation with the cards that formed it", () => {
    const next = appendStructureDecision(
      createDocument(),
      { action: "island_create", islandId: "i1", cardIds: ["c1", "c2", "c1"] },
      { createdAt: "2026-10-21T01:00:00.000Z", id: "d1" }
    );

    expect(next.structureDecisions).toEqual([
      {
        id: "d1",
        createdAt: "2026-10-21T01:00:00.000Z",
        action: "island_create",
        islandId: "i1",
        cardIds: ["c1", "c2"],
      },
    ]);
  });

  it("records a hold-state change with before/after values", () => {
    const next = appendStructureDecision(
      createDocument(),
      { action: "hold_state_changed", cardIds: ["c1"], fromValue: "active", toValue: "held" }
    );

    expect(next.structureDecisions?.[0]).toMatchObject({
      action: "hold_state_changed",
      cardIds: ["c1"],
      fromValue: "active",
      toValue: "held",
    });
  });

  it("keeps only the configured number of decisions", () => {
    let document = createDocument();
    for (let index = 0; index < 5; index += 1) {
      document = appendStructureDecision(
        document,
        { action: "cards_added_to_island", islandId: "i1", cardIds: [`c${index}`] },
        { historyLimit: 3, createdAt: `2026-10-21T0${index}:00:00.000Z` }
      );
    }

    expect(document.structureDecisions?.map((record) => record.cardIds[0])).toEqual(["c2", "c3", "c4"]);
  });
});

describe("updateStructureDecisionRationale", () => {
  it("adds, trims, and clears a rationale", () => {
    const document = appendStructureDecision(
      createDocument(),
      { action: "cards_added_to_island", islandId: "i1", cardIds: ["c2"] },
      { id: "d1", createdAt: "2026-10-21T01:00:00.000Z" }
    );

    const withReason = updateStructureDecisionRationale(document, "d1", "  wrong bundle  ");
    expect(withReason.structureDecisions?.[0].rationale).toBe("wrong bundle");

    const cleared = updateStructureDecisionRationale(withReason, "d1", "   ");
    expect(cleared.structureDecisions?.[0]).not.toHaveProperty("rationale");
  });

  it("is a no-op for an unknown decision or unchanged rationale", () => {
    const document = createDocument();
    expect(updateStructureDecisionRationale(document, "missing", "x")).toBe(document);
  });
});

describe("structureDecisionsForTarget", () => {
  it("returns decisions for the island or for a card contained in one", () => {
    let document = createDocument();
    document = appendStructureDecision(
      document,
      { action: "island_create", islandId: "i1", cardIds: ["c1"] },
      { id: "d1" }
    );
    document = appendStructureDecision(
      document,
      { action: "hold_state_changed", cardIds: ["c2"], fromValue: "active", toValue: "held" },
      { id: "d2" }
    );

    expect(structureDecisionsForTarget(document, { islandId: "i1" }).map((record) => record.id)).toEqual(["d1"]);
    expect(structureDecisionsForTarget(document, { cardId: "c2" }).map((record) => record.id)).toEqual(["d2"]);
    expect(structureDecisionsForTarget(document, { islandId: "i1", cardId: "c2" }).map((record) => record.id)).toEqual([
      "d1",
      "d2",
    ]);
  });
});
