import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import {
  buildContextProjection,
  CONTEXT_PROJECTION_CONSTRAINTS,
  type ContextProjectionConstraint,
} from "./context_bundle_projection";

// EXT-CONN-01 (ADR-0054 stage 1): safety properties of the read-only external
// projection. These lock the SafeMode boundary, the reviewed-only exclusion,
// per-constraint scoping, anti-scoring, and bundleHash determinism BEFORE any
// MCP transport is wired -- the transport is a thin adapter over this core.

function buildDoc(): DocumentV1 {
  return {
    version: 1,
    id: "doc_ext_conn_fixture",
    title: "ext-conn projection fixture",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "reviewed claim one", x: 0, y: 0, claimType: "claim", textReviewed: true },
      { id: "c2", text: "reviewed fact two", x: 100, y: 0, claimType: "fact", textReviewed: true },
      { id: "c3", text: "unreviewed draft three", x: 200, y: 0, claimType: "unknown", textReviewed: false },
      { id: "c4", text: "reviewed hypothesis four", x: 300, y: 0, claimType: "hypothesis", textReviewed: true },
    ],
    edges: [{ id: "e1", fromId: "c1", toId: "c2", type: "related" }],
    islands: [{ id: "i1", cardIds: ["c1", "c2"], title: "First island" }],
    readingOrder: ["c1", "c2", "c3", "c4"],
    narratives: [],
    evidenceLinks: [
      { id: "ev1", type: "supports", fromCardId: "c2", toCardId: "c1", createdAt: "2026-07-12T00:00:00.000Z" },
      // c3 is unreviewed: this link must never surface in an external
      // projection (2026-07-13 gate) -- neither its endpoints nor the link
      // itself, for ANY constraint, even though c1 alone is reviewed.
      { id: "ev2", type: "contradicts", fromCardId: "c3", toCardId: "c1", createdAt: "2026-07-12T00:00:00.000Z" },
      // Both endpoints reviewed: this link IS expected to surface, so the
      // fix can be told apart from "contradiction constraint always empty".
      { id: "ev3", type: "contradicts", fromCardId: "c4", toCardId: "c2", createdAt: "2026-07-12T00:00:00.000Z" },
    ],
    mergeSuggestionDecisions: [],
  };
}

describe("buildContextProjection: reviewed-only constraint", () => {
  it("excludes unreviewed cards entirely and exposes reviewed text when SafeMode is OFF", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "reviewed-only", safeMode: false });

    const ids = projection.cards.map((card) => card.id);
    expect(ids).toEqual(["c1", "c2", "c4"]); // c3 (unreviewed) excluded, sorted
    expect(projection.cards.every((card) => card.reviewed)).toBe(true);
    expect(projection.cards.every((card) => card.redacted === false)).toBe(true);
    expect(projection.cards.find((card) => card.id === "c1")?.text).toBe("reviewed claim one");
    // counts still report the whole document, not just the projected subset
    // (SEC-CONTEXT-PROJECTION-01): c3 is unreviewed, so it is redacted even
    // with SafeMode OFF.
    expect(projection.counts).toEqual({ reviewed: 3, unreviewed: 1, redacted: 1 });
  });

  it("redacts even reviewed card text when SafeMode is ON (external surface == share boundary)", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "reviewed-only", safeMode: true });

    expect(projection.cards.map((card) => card.id)).toEqual(["c1", "c2", "c4"]);
    expect(projection.cards.every((card) => card.redacted)).toBe(true);
    for (const card of projection.cards) {
      expect(card.text).not.toContain("reviewed");
      expect(card.text.startsWith("[REDACTED]")).toBe(true);
    }
    // Whole-document redacted count (SEC-CONTEXT-PROJECTION-01): all 4 cards,
    // including unreviewed c3, are redacted under SafeMode.
    expect(projection.counts.redacted).toBe(4);
  });
});

describe("buildContextProjection: evidence vs contradiction scoping", () => {
  it("evidence constraint surfaces only supports links and their endpoint cards", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "evidence", safeMode: false });

    expect(projection.evidence).toEqual([{ from: "c2", to: "c1" }]);
    expect(projection.contradictions).toEqual([]);
    expect(projection.cards.map((card) => card.id).sort()).toEqual(["c1", "c2"]);
  });

  it("contradiction constraint surfaces only contradicts links between reviewed endpoints", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "contradiction", safeMode: false });

    expect(projection.contradictions).toEqual([{ from: "c4", to: "c2" }]);
    expect(projection.evidence).toEqual([]);
    expect(projection.cards.map((card) => card.id).sort()).toEqual(["c2", "c4"]);
  });

  it("excludes a contradicts link entirely when either endpoint is unreviewed (2026-07-13 gate) -- not merely text-redacted", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "contradiction", safeMode: false });

    // ev2 (c3 unreviewed -> c1) must not surface at all: neither the link
    // nor c3's id/ref -- an unreviewed card must not be identifiable even as
    // a bare, text-redacted node.
    expect(projection.contradictions).not.toContainEqual({ from: "c3", to: "c1" });
    expect(projection.cards.find((card) => card.id === "c3")).toBeUndefined();
  });

  it("still redacts a reviewed endpoint's text under SafeMode without dropping the (both-reviewed) link itself", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "contradiction", safeMode: true });

    expect(projection.contradictions).toEqual([{ from: "c4", to: "c2" }]);
    const c4 = projection.cards.find((card) => card.id === "c4");
    expect(c4?.reviewed).toBe(true);
    expect(c4?.redacted).toBe(true);
    expect(c4?.text).not.toContain("reviewed hypothesis four");
    expect(c4?.text.startsWith("[REDACTED]")).toBe(true);
  });
});

describe("buildContextProjection: summary constraint", () => {
  it("emits no card nodes but keeps counts, islands, and reviewed-only relations/links", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "summary", safeMode: false });

    expect(projection.cards).toEqual([]);
    // redacted counts the whole document (SEC-CONTEXT-PROJECTION-01): c3 is
    // unreviewed, so it is redacted even with SafeMode OFF.
    expect(projection.counts).toEqual({ reviewed: 3, unreviewed: 1, redacted: 1 });
    expect(projection.islands).toEqual([{ id: "i1", title: "First island" }]);
    expect(projection.relations).toEqual([{ from: "c1", to: "c2", type: "related" }]);
    // summary carries both link structures, but never a link touching an
    // unreviewed card (2026-07-13 gate) -- ev2 (c3 unreviewed) is excluded.
    expect(projection.evidence).toEqual([{ from: "c2", to: "c1" }]);
    expect(projection.contradictions).toEqual([{ from: "c4", to: "c2" }]);
  });

  it("reports whole-document redacted count under SafeMode even with an empty card scope (SEC-CONTEXT-PROJECTION-01)", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "summary", safeMode: true });

    expect(projection.cards).toEqual([]);
    // Previously this was always 0 because the empty scope loop never ran,
    // hiding how much content SafeMode redacts. Now it reports all 4 cards.
    expect(projection.counts.redacted).toBe(4);
  });

  it("never references an unreviewed card's id, even bare, via relations/evidence/contradictions", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "summary", safeMode: false });

    const allReferencedIds = [
      ...projection.relations.flatMap((r) => [r.from, r.to]),
      ...projection.evidence.flatMap((e) => [e.from, e.to]),
      ...projection.contradictions.flatMap((c) => [c.from, c.to]),
    ];
    expect(allReferencedIds).not.toContain("c3");
  });
});

describe("buildContextProjection: invariants across all constraints", () => {
  it("never emits score/rank/confidence/priority anywhere in the output", async () => {
    for (const constraint of CONTEXT_PROJECTION_CONSTRAINTS) {
      for (const safeMode of [true, false]) {
        const projection = await buildContextProjection({ doc: buildDoc(), constraint, safeMode });
        const serialized = JSON.stringify(projection);
        expect(serialized, `${constraint}/${safeMode}`).not.toMatch(/score|rank|confidence|priority|readiness/i);
      }
    }
  });

  it("produces a deterministic bundleHash for identical inputs", async () => {
    const run = (): Promise<string> =>
      buildContextProjection({ doc: buildDoc(), constraint: "reviewed-only", safeMode: false }).then((p) => p.bundleHash);
    expect(await run()).toBe(await run());
  });

  it("changes bundleHash when SafeMode flips (exposure state is part of what was shared)", async () => {
    const off = await buildContextProjection({ doc: buildDoc(), constraint: "reviewed-only", safeMode: false });
    const on = await buildContextProjection({ doc: buildDoc(), constraint: "reviewed-only", safeMode: true });
    expect(off.bundleHash).not.toBe(on.bundleHash);
  });

  it("never puts withheld original text into the hash payload (redacted text hashes as null)", async () => {
    // Two docs whose ONLY difference is the body of a reviewed card that gets
    // redacted under SafeMode: the hash must be identical because the real
    // text was never exposed and must not leak through the correlation hash.
    const docA = buildDoc();
    const docB = buildDoc();
    docB.cards = docB.cards.map((card) => (card.id === "c4" ? { ...card, text: "totally different secret" } : card));

    const a = await buildContextProjection({ doc: docA, constraint: "contradiction", safeMode: true });
    const b = await buildContextProjection({ doc: docB, constraint: "contradiction", safeMode: true });
    // c4 is redacted under SafeMode -> its differing body must not change the hash.
    expect(a.bundleHash).toBe(b.bundleHash);
  });

  it("redaction placeholder never includes a content-derived hash (2026-07-13 gate: no correlation fingerprint)", async () => {
    // A standing external (MCP) surface can be queried repeatedly, so a short
    // hash of withheld text (SafeModePolicy.summarizeForSafeMode's format,
    // "[REDACTED]:h########") would let a client detect when two redacted
    // cards share identical real text. This module must use the length-only
    // placeholder (SafeModePolicy.redactText) instead.
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "reviewed-only", safeMode: true });

    expect(projection.cards.length).toBeGreaterThan(0);
    for (const card of projection.cards) {
      expect(card.redacted).toBe(true);
      expect(card.text).not.toMatch(/:h[0-9a-f]{8}/);
    }
  });

  it("never references an unreviewed card's id via any link, for any constraint (2026-07-13 gate)", async () => {
    for (const constraint of CONTEXT_PROJECTION_CONSTRAINTS) {
      const projection = await buildContextProjection({ doc: buildDoc(), constraint, safeMode: false });
      const allReferencedIds = [
        ...projection.cards.map((card) => card.id),
        ...projection.relations.flatMap((r) => [r.from, r.to]),
        ...projection.evidence.flatMap((e) => [e.from, e.to]),
        ...projection.contradictions.flatMap((c) => [c.from, c.to]),
      ];
      expect(allReferencedIds, constraint).not.toContain("c3");
    }
  });

  it("accepts every declared constraint literal", async () => {
    const constraints: ContextProjectionConstraint[] = [...CONTEXT_PROJECTION_CONSTRAINTS];
    for (const constraint of constraints) {
      const projection = await buildContextProjection({ doc: buildDoc(), constraint, safeMode: false });
      expect(projection.constraint).toBe(constraint);
      expect(projection.schemaVersion).toBe("context-projection.v1");
      expect(projection.baseDocSignature).toBe("doc_ext_conn_fixture:2026-07-12T00:00:00.000Z");
    }
  });
});

describe("buildContextProjection: work-state metadata (DOGFOOD-08)", () => {
  it("projects holdState even in SafeMode (metadata, not text)", async () => {
    const doc = buildDoc();
    // Mark c1 as held, c2 as shelved (working states).
    doc.cards[0] = { ...doc.cards[0], holdState: "held" };
    doc.cards[1] = { ...doc.cards[1], holdState: "shelved" };
    const projection = await buildContextProjection({ doc, constraint: "reviewed-only", safeMode: true });

    const byId = new Map(projection.cards.map((c) => [c.id, c]));
    expect(byId.get("c1")?.holdState).toBe("held");
    expect(byId.get("c2")?.holdState).toBe("shelved");
    // c3 is unreviewed → out of scope for reviewed-only (not present).
    expect(byId.get("c3")).toBeUndefined();
    // SafeMode still redacts text — holdState is metadata, not content.
    expect(byId.get("c1")?.redacted).toBe(true);
  });
});

describe("buildContextProjection: structural void and narrative-check state", () => {
  it("exposes voids (kind/refs/resolved) and narrative A/B direction/counts without text", async () => {
    const doc: DocumentV1 = {
      version: 1,
      id: "doc-insights",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      transform: { panX: 0, panY: 0, zoom: 1 },
      cards: [{ id: "c1", text: "reviewed", x: 0, y: 0, textReviewed: true }],
      edges: [],
      islands: [{ id: "i1", cardIds: ["c1"], title: "A", summaryText: "s", summaryReviewed: true }],
      voids: [
        {
          id: "v1",
          kind: "orphaned_island",
          title: "孤立島",
          detail: "contains card text",
          islandIds: ["i1"],
          resolved: false,
          createdAt: "2026-08-14T00:00:00.000Z",
        },
      ],
      narratives: [
        {
          id: "n1",
          title: "N",
          text: "reviewed",
          reviewed: true,
          checks: [
            {
              id: "check-1",
              createdAt: "2026-08-14T00:00:00.000Z",
              kind: "consistency",
              issues: [
                { severity: "warn", message: "x", direction: "b_missing_in_a" },
              ],
              counts: { bMissingInA: 1, aMissingInB: 0 },
            },
          ],
        },
      ],
    };

    const projection = await buildContextProjection({ doc, constraint: "reviewed-only", safeMode: true });

    // Void: structural only — title/detail (can quote card text) are NOT exposed.
    expect(projection.voids).toEqual([
      { id: "v1", kind: "orphaned_island", resolved: false, islandIds: ["i1"] },
    ]);
    // Narrative check: direction + counts, no issue messages.
    expect(projection.narrativeChecks).toEqual([
      { id: "check-1", counts: { bMissingInA: 1, aMissingInB: 0 }, issueDirections: ["b_missing_in_a"] },
    ]);
  });

  it("returns empty arrays when the document has no voids or narrative checks", async () => {
    const doc: DocumentV1 = {
      version: 1,
      id: "doc-plain",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      transform: { panX: 0, panY: 0, zoom: 1 },
      cards: [{ id: "c1", text: "reviewed", x: 0, y: 0, textReviewed: true }],
      edges: [],
      islands: [{ id: "i1", cardIds: ["c1"], title: "A", summaryText: "s", summaryReviewed: true }],
    };

    const projection = await buildContextProjection({ doc, constraint: "reviewed-only", safeMode: true });
    expect(projection.voids).toEqual([]);
    expect(projection.narrativeChecks).toEqual([]);
  });

  it("never returns an unreviewed card id through a void, under any constraint", async () => {
    const doc: DocumentV1 = {
      version: 1,
      id: "doc-void-leak",
      createdAt: "2026-10-08T00:00:00.000Z",
      updatedAt: "2026-10-08T00:00:00.000Z",
      transform: { panX: 0, panY: 0, zoom: 1 },
      cards: [
        { id: "c1", text: "reviewed one", x: 0, y: 0, textReviewed: true },
        { id: "c3", text: "unreviewed draft", x: 100, y: 0, textReviewed: false },
      ],
      edges: [],
      islands: [{ id: "i1", cardIds: ["c1", "c3"], title: "A", summaryText: "s", summaryReviewed: true }],
      voids: [
        {
          id: "v-mixed",
          kind: "orphaned_island",
          title: "mixed",
          detail: "mixed",
          cardIds: ["c1", "c3"],
          resolved: false,
          createdAt: "2026-10-08T00:00:00.000Z",
        },
        {
          id: "v-unreviewed-only",
          kind: "orphaned_island",
          title: "draft only",
          detail: "draft only",
          cardIds: ["c3"],
          resolved: false,
          createdAt: "2026-10-08T00:00:00.000Z",
        },
      ],
    };

    for (const constraint of CONTEXT_PROJECTION_CONSTRAINTS) {
      for (const safeMode of [true, false]) {
        const projection = await buildContextProjection({ doc, constraint, safeMode });
        // Exact quoted id: a bare substring could match inside the hex bundleHash.
        expect(JSON.stringify(projection)).not.toContain('"c3"');
        expect(projection.voids).toEqual([
          { id: "v-mixed", kind: "orphaned_island", resolved: false, cardIds: ["c1"] },
          { id: "v-unreviewed-only", kind: "orphaned_island", resolved: false },
        ]);
      }
    }
  });
});
