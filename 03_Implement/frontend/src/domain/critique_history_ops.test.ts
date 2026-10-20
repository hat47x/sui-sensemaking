import { describe, expect, it } from "vitest";
import type { Card, DocumentV1 } from "./types";
import {
  restoreCardCritiqueHistoryEntry,
  restoreIslandCritiqueHistoryEntry,
  updateCardCritiqueWithHistory,
  updateIslandCritiqueWithHistory,
} from "./critique_history_ops";
import { validateDocument } from "../import/schema_validation";

function createDocument(cards: Card[]): DocumentV1 {
  return {
    version: 1,
    id: "doc-critique-history",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards,
    edges: [],
    islands: [],
  };
}

describe("updateCardCritiqueWithHistory", () => {
  it("records the previous value when a human edits the critique", () => {
    const document = createDocument([{ id: "c1", text: "A", x: 0, y: 0, critique: "first doubt" }]);

    const next = updateCardCritiqueWithHistory(
      document,
      "c1",
      { critique: "new material changed my view" },
      { changeKind: "manual", createdAt: "2026-10-20T01:00:00.000Z" }
    );

    expect(next.cards[0].critique).toBe("new material changed my view");
    expect(next.cards[0].critiqueHistory).toHaveLength(1);
    expect(next.cards[0].critiqueHistory?.[0]).toMatchObject({
      fromCritique: "first doubt",
      toCritique: "new material changed my view",
      fromTags: null,
      toTags: null,
      changeKind: "manual",
      createdAt: "2026-10-20T01:00:00.000Z",
    });
  });

  it("records critique tag changes and keeps both text and tags snapshots", () => {
    const document = createDocument([
      { id: "c1", text: "A", x: 0, y: 0, critique: "doubt", critiqueTags: ["feels_off"] },
    ]);

    const next = updateCardCritiqueWithHistory(
      document,
      "c1",
      { critiqueTags: ["feels_off", "no_articulable_reason"] },
      { changeKind: "manual" }
    );

    expect(next.cards[0].critique).toBe("doubt");
    expect(next.cards[0].critiqueTags).toEqual(["feels_off", "no_articulable_reason"]);
    expect(next.cards[0].critiqueHistory?.[0]).toMatchObject({
      fromCritique: "doubt",
      toCritique: "doubt",
      fromTags: ["feels_off"],
      toTags: ["feels_off", "no_articulable_reason"],
    });
  });

  it("does not fabricate a revision when the value is unchanged", () => {
    const document = createDocument([{ id: "c1", text: "A", x: 0, y: 0, critique: "same" }]);

    const next = updateCardCritiqueWithHistory(document, "c1", { critique: "same" }, { changeKind: "manual" });

    expect(next).toBe(document);
    expect(next.cards[0].critiqueHistory).toBeUndefined();
  });

  it("keeps at most the configured number of revisions", () => {
    let document = createDocument([{ id: "c1", text: "A", x: 0, y: 0 }]);

    for (let index = 0; index < 5; index += 1) {
      document = updateCardCritiqueWithHistory(
        document,
        "c1",
        { critique: `reason ${index}` },
        { changeKind: "manual", historyLimit: 3 }
      );
    }

    expect(document.cards[0].critiqueHistory).toHaveLength(3);
    expect(document.cards[0].critiqueHistory?.map((entry) => entry.toCritique)).toEqual([
      "reason 2",
      "reason 3",
      "reason 4",
    ]);
  });

  it("leaves other cards and their histories untouched", () => {
    const document = createDocument([
      { id: "c1", text: "A", x: 0, y: 0, critique: "a" },
      { id: "c2", text: "B", x: 0, y: 0, critique: "b" },
    ]);

    const next = updateCardCritiqueWithHistory(document, "c1", { critique: "a2" }, { changeKind: "manual" });

    expect(next.cards[1]).toBe(document.cards[1]);
    expect(next.cards[1].critiqueHistory).toBeUndefined();
  });
});

describe("restoreCardCritiqueHistoryEntry", () => {
  it("restores the version after a recorded change and appends a rollback entry", () => {
    const document = createDocument([{ id: "c1", text: "A", x: 0, y: 0 }]);
    const afterFirst = updateCardCritiqueWithHistory(
      document,
      "c1",
      { critique: "first doubt" },
      { changeKind: "manual" }
    );
    const afterSecond = updateCardCritiqueWithHistory(
      afterFirst,
      "c1",
      { critique: "later view" },
      { changeKind: "manual" }
    );
    const firstEntryId = afterSecond.cards[0].critiqueHistory?.[0].id;
    expect(firstEntryId).toBeDefined();

    const restored = restoreCardCritiqueHistoryEntry(afterSecond, "c1", firstEntryId ?? "");

    expect(restored.cards[0].critique).toBe("first doubt");
    expect(restored.cards[0].critiqueHistory?.at(-1)).toMatchObject({
      fromCritique: "later view",
      toCritique: "first doubt",
      changeKind: "rollback",
    });
  });

  it("survives a JSON save/reload roundtrip before restoring", () => {
    const document = createDocument([{ id: "c1", text: "A", x: 0, y: 0 }]);
    const afterFirst = updateCardCritiqueWithHistory(
      document,
      "c1",
      { critique: "first doubt" },
      { changeKind: "manual" }
    );
    const afterSecond = updateCardCritiqueWithHistory(
      afterFirst,
      "c1",
      { critique: "later view" },
      { changeKind: "manual" }
    );
    const firstEntryId = afterSecond.cards[0].critiqueHistory?.[0].id;

    const reloaded = validateDocument(JSON.parse(JSON.stringify(afterSecond)));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;

    expect(reloaded.value.cards[0].critique).toBe("later view");
    expect(reloaded.value.cards[0].critiqueHistory).toHaveLength(2);

    const restored = restoreCardCritiqueHistoryEntry(reloaded.value, "c1", firstEntryId ?? "");
    expect(restored.cards[0].critique).toBe("first doubt");
    expect(restored.cards[0].critiqueHistory?.at(-1)?.changeKind).toBe("rollback");
  });

  it("is a no-op for an unknown card or history entry", () => {
    const document = createDocument([{ id: "c1", text: "A", x: 0, y: 0, critique: "a" }]);

    expect(restoreCardCritiqueHistoryEntry(document, "c1", "missing")).toBe(document);
    expect(restoreCardCritiqueHistoryEntry(document, "missing", "missing")).toBe(document);
  });
});

describe("island critique revision history", () => {
  function createIslandDocument() {
    const document = createDocument([{ id: "c1", text: "A", x: 0, y: 0 }]);
    document.islands = [{ id: "i1", cardIds: ["c1"], critique: "first doubt" }];
    return document;
  }

  it("records, roundtrips, and restores an island critique revision", () => {
    const base = createIslandDocument();
    base.islands[0].critique = undefined;
    const afterFirst = updateIslandCritiqueWithHistory(
      base,
      "i1",
      { critique: "first doubt" },
      { changeKind: "manual" }
    );
    const afterSecond = updateIslandCritiqueWithHistory(
      afterFirst,
      "i1",
      { critique: "later view" },
      { changeKind: "manual" }
    );
    expect(afterSecond.islands[0].critiqueHistory).toHaveLength(2);

    const reloaded = validateDocument(JSON.parse(JSON.stringify(afterSecond)));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.islands[0].critique).toBe("later view");

    const firstEntryId = reloaded.value.islands[0].critiqueHistory?.[0].id;
    const restored = restoreIslandCritiqueHistoryEntry(reloaded.value, "i1", firstEntryId ?? "");

    expect(restored.islands[0].critique).toBe("first doubt");
    expect(restored.islands[0].critiqueHistory?.at(-1)?.changeKind).toBe("rollback");
  });

  it("records island critique tag changes and avoids no-op revisions", () => {
    const document = createIslandDocument();
    const withTags = updateIslandCritiqueWithHistory(
      document,
      "i1",
      { critiqueTags: ["feels_off"] },
      { changeKind: "manual" }
    );
    expect(withTags.islands[0].critiqueHistory?.[0]).toMatchObject({
      fromCritique: "first doubt",
      fromTags: null,
      toTags: ["feels_off"],
    });

    const noOp = updateIslandCritiqueWithHistory(withTags, "i1", { critiqueTags: ["feels_off"] }, { changeKind: "manual" });
    expect(noOp).toBe(withTags);
  });
});
