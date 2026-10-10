import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "./types";
import { planConfirmedCardMoveState } from "./confirmed_card_move_state";

function document(id = "doc"): DocumentV1 {
  return {
    version: 1, id, createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-10T00:00:00Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "a", text: "source", x: 0, y: 0, meta: { source: "interview" }, holdState: "held" },
      { id: "b", text: "target", x: 400, y: 0 },
    ],
    islands: [{ id: "old", cardIds: ["a"] }, { id: "new", cardIds: ["b"] }],
    edges: [{ id: "e", fromId: "a", toId: "b", type: "future-kind" }],
  };
}

function scenario() {
  const source = document();
  const committed = structuredClone(source);
  committed.cards[0].x = 400;
  committed.islands[0].cardIds = [];
  committed.islands[1].cardIds = ["b", "a"];
  committed.updatedAt = "2026-10-10T12:30:00Z";

  return {
    origin: { document: source, etag: "old-etag" },
    history: { past: [], present: source, future: [] },
    currentEtag: "old-etag",
    isDirty: false,
    isReadOnly: false,
    isSaving: false,
    isTenantSessionCurrent: true,
    isPendingDrag: false,
    confirmed: { document: committed, etag: "new-etag" },
  };
}

describe("SUI-owned server-confirmed Card move history", () => {
  it("keeps the old saved Document Undo-able while marking the new revision clean", () => {
    const args = scenario();
    const planned = planConfirmedCardMoveState(args);
    expect(planned).not.toBeNull();
    expect(planned?.isDirty).toBe(false);
    expect(planned?.etag).toBe("new-etag");
    expect(planned?.history.present.cards[0].x).toBe(400);
    expect(planned?.history.present.islands[1].cardIds).toEqual(["b", "a"]);
    expect(planned?.history.past).toHaveLength(1);
    expect(planned?.history.past[0].cards[0].x).toBe(0);
    expect(planned?.history.future).toEqual([]);
    expect(planned?.history.present.cards[0].meta?.source).toBe("interview");
    expect(planned?.history.present.cards[0].holdState).toBe("held");

    // The planned state is an immutable snapshot, not a deferred React
    // setter; mutating it cannot silently change source/confirmed inputs.
    planned!.history.present.cards[0].x = 900;
    planned!.history.past[0].cards[0].x = 800;
    expect(args.history.present.cards[0].x).toBe(0);
    expect(args.confirmed.document.cards[0].x).toBe(400);
  });

  it("refuses unsaved edits, read-only sessions, save races and pending drags", () => {
    for (const patch of [
      { isDirty: true },
      { isReadOnly: true },
      { isSaving: true },
      { isTenantSessionCurrent: false },
      { isPendingDrag: true },
      { currentEtag: "other-etag" },
      { history: null },
      { confirmed: { document: document("other"), etag: "new-etag" } },
      { confirmed: { document: document(), etag: "old-etag" } },
      { historyLimit: 0 },
      { historyLimit: Number.NaN },
    ]) {
      expect(planConfirmedCardMoveState({ ...scenario(), ...patch })).toBeNull();
    }
  });

  it("rejects an obsolete origin even with coincidentally matching ETag", () => {
    const args = scenario();
    const elsewhere = structuredClone(args.history.present);
    const result = planConfirmedCardMoveState({
      ...args,
      history: { ...args.history, present: elsewhere },
    });
    expect(result).toBeNull();
  });

  it("uses the native history limit and discards redo after a remote commit", () => {
    const args = scenario();
    const planned = planConfirmedCardMoveState({
      ...args,
      history: {
        past: [document("earlier"), document("later")],
        present: args.history.present,
        future: [document("redo")],
      },
      historyLimit: 2,
    });
    expect(planned?.history.past.map((value) => value.id)).toEqual(["later", "doc"]);
    expect(planned?.history.future).toEqual([]);
  });

  it("does not mutate the previous history when a guard rejects commit", () => {
    const args = scenario();
    const historyBefore = structuredClone(args.history);
    expect(planConfirmedCardMoveState({ ...args, isDirty: true })).toBeNull();
    expect(args.history).toEqual(historyBefore);
    expect(args.currentEtag).toBe("old-etag");
  });
});
