import { describe, expect, it } from "vitest";
import type { Card, DocumentV1 } from "./types";
import { collectMergeCandidates } from "./merge_candidates";

function createDocument(cards: Card[]): DocumentV1 {
  return {
    version: 1,
    id: "doc-1",
    createdAt: "2026-02-28T00:00:00.000Z",
    updatedAt: "2026-02-28T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards,
    edges: [],
    islands: [],
  };
}

describe("collectMergeCandidates", () => {
  it("collects deterministic candidates from normalized duplicate text", () => {
    const result = collectMergeCandidates(
      createDocument([
        { id: "c3", text: "Needs Follow-Up", x: 0, y: 0 },
        { id: "c1", text: "needs follow up", x: 0, y: 0 },
        { id: "c2", text: "Needs   follow-up", x: 0, y: 0 },
      ])
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.cardIds).toEqual(["c1", "c2", "c3"]);
    expect(result[0]?.groupId).toBe("heuristic-needs-follow-up-c1-c2-c3");
    expect(result[0]?.mergedTextDraft).toBe("Needs   follow-up");
    expect(result[0]?.mergeMethod).toBe("near_duplicate");
    expect(result[0]?.targetCardId).toBe("c1");
    expect(result[0]?.candidateCardIds).toEqual(["c2", "c3"]);
    expect(result[0]?.scoreSummary).toEqual({ min: 1, max: 1, avg: 1 });
    expect(result[0]?.reasonCodes).toEqual(["heuristic:normalized-text"]);
    expect(result[0]?.snapshotVersion).toBe("CTR-2B-01-CANDIDATE-GROUP-V1");
    expect(result[0]?.rationale).toContain("normalized-text");
  });

  it("falls back to token signature grouping when wording order differs", () => {
    const result = collectMergeCandidates(
      createDocument([
        { id: "a", text: "Budget review pending", x: 0, y: 0 },
        { id: "b", text: "Pending budget review", x: 0, y: 0 },
        { id: "c", text: "Review timeline", x: 0, y: 0 },
      ])
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.cardIds).toEqual(["a", "b"]);
    expect(result[0]?.mergeMethod).toBe("near_duplicate");
    expect(result[0]?.scoreSummary).toEqual({ min: 0.75, max: 0.75, avg: 0.75 });
    expect(result[0]?.reasonCodes).toEqual(["heuristic:token-signature"]);
    expect(result[0]?.rationale).toContain("token-signature");
  });

  it("excludes source/merged cards from candidate members", () => {
    const result = collectMergeCandidates(
      createDocument([
        { id: "canon-1", text: "Theme B", x: 0, y: 0 },
        { id: "src-1", text: "Theme A", x: 0, y: 0, canonicalId: "canon-1" },
        { id: "m1", text: "Theme A", x: 0, y: 0, mergedIntoCardId: "rep-1" },
        { id: "m2", text: "Theme A", x: 0, y: 0 },
      ])
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.cardIds).toEqual(["canon-1", "m2"]);
  });

  it("returns empty list when less than two eligible cards exist", () => {
    const result = collectMergeCandidates(
      createDocument([{ id: "c1", text: "single card", x: 0, y: 0 }])
    );

    expect(result).toEqual([]);
  });

  it("stays deterministic for tie cases by sorting card IDs and groups", () => {
    const doc = createDocument([
      { id: "z", text: "Risk register", x: 0, y: 0 },
      { id: "y", text: "risk register", x: 0, y: 0 },
      { id: "b", text: "Action item", x: 0, y: 0 },
      { id: "a", text: "action-item", x: 0, y: 0 },
    ]);

    const first = collectMergeCandidates(doc);
    const second = collectMergeCandidates(doc);

    expect(first).toEqual(second);
    expect(first.map((group) => group.cardIds)).toEqual([
      ["a", "b"],
      ["y", "z"],
    ]);
    expect(first.map((group) => group.mergeMethod)).toEqual([
      "near_duplicate",
      "near_duplicate",
    ]);
  });

  // Issue #3231: unreviewed cards must not stop deterministic local
  // candidate collection -- the collector is local-only and never sends
  // card text to a model. SafeMode review gating applies to AI paths.
  it("collects candidates even when every card is unreviewed", () => {
    const doc = createDocument([
      { id: "c1", text: "Needs Follow-Up", x: 0, y: 0, textReviewed: false },
      { id: "c2", text: "needs follow up", x: 0, y: 0, textReviewed: false },
    ]);

    const result = collectMergeCandidates(doc);

    expect(result).toHaveLength(1);
    expect(result[0]?.cardIds).toEqual(["c1", "c2"]);
    expect(result[0]?.mergeMethod).toBe("near_duplicate");
  });
});
