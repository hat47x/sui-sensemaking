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
    islands: [{ id: "i1", cardIds: ["c1", "c2"], title: "First island", titleReviewed: true }],
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
    expect(projection.islands.map(({ id, title }) => ({ id, title }))).toEqual([{ id: "i1", title: "First island" }]);
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

describe("buildContextProjection: bundleHash が変わる条件と変わらない条件（#3280）", () => {
  // bundleHash は「露出内容だけの版」ではなく「文書の版を含む値」である。
  // baseDocSignature（`${doc.id}:${doc.updatedAt}`）が入力に入るため、保存で updatedAt が進めば値が変わる。
  // 内容だけで版固定するには、単位digest（ADR-0103）を使う。
  const hashOf = (doc: DocumentV1, safeMode = false): Promise<string> =>
    buildContextProjection({ doc, constraint: "reviewed-only", safeMode }).then((p) => p.bundleHash);

  it("updatedAt だけが進むと、露出内容が同じでも bundleHash は変わる", async () => {
    const before = buildDoc();
    const after = { ...buildDoc(), updatedAt: "2026-07-13T00:00:00.000Z" };
    expect(await hashOf(after)).not.toBe(await hashOf(before));
  });

  it("updatedAt を保ったままのカード位置の変更では、bundleHash は変わらない", async () => {
    const moved = buildDoc();
    moved.cards = moved.cards.map((card) => (card.id === "c1" ? { ...card, x: 999, y: 999 } : card));
    expect(await hashOf(moved)).toBe(await hashOf(buildDoc()));
  });

  it("holdState だけの変更は、updatedAt が同じなら bundleHash に現れない（検出は updatedAt に依存する）", async () => {
    const held = buildDoc();
    held.cards = held.cards.map((card) => (card.id === "c1" ? { ...card, holdState: "held" as const } : card));
    const projection = await buildContextProjection({ doc: held, constraint: "reviewed-only", safeMode: false });
    // holdState は投影には露出するが、hashPayload には含まれない。
    expect(projection.cards.find((card) => card.id === "c1")?.holdState).toBe("held");
    expect(await hashOf(held)).toBe(await hashOf(buildDoc()));
    // 保存で updatedAt が進めば、値は変わる。
    expect(await hashOf({ ...held, updatedAt: "2026-07-13T00:00:00.000Z" })).not.toBe(await hashOf(buildDoc()));
  });

  it("レビュー済みの島の題名を直すと、updatedAt が同じでも bundleHash は変わる（SafeModeに依存しない）", async () => {
    const renamed = buildDoc();
    renamed.islands = renamed.islands.map((island) => ({ ...island, title: "Renamed island" }));
    for (const safeMode of [false, true]) {
      expect(await hashOf(renamed, safeMode), `safeMode=${safeMode}`).not.toBe(await hashOf(buildDoc(), safeMode));
    }
  });

  it("未レビューの島の題名の編集は、updatedAt が同じなら bundleHash を変えない（本文は露出していない）", async () => {
    const base = buildDoc();
    base.islands = base.islands.map((island) => ({ ...island, titleReviewed: false }));
    const edited = buildDoc();
    edited.islands = edited.islands.map((island) => ({ ...island, titleReviewed: false, title: "Secret rename" }));
    expect(await hashOf(edited)).toBe(await hashOf(base));
  });

  it("単位digestは updatedAt に依存せず、露出内容だけで決まる", async () => {
    const before = await buildContextProjection({ doc: buildDoc(), constraint: "reviewed-only", safeMode: false });
    const after = await buildContextProjection({
      doc: { ...buildDoc(), updatedAt: "2026-07-13T00:00:00.000Z" },
      constraint: "reviewed-only",
      safeMode: false,
    });
    expect(after.bundleHash).not.toBe(before.bundleHash);
    expect(after.cards.map((card) => card.digest)).toEqual(before.cards.map((card) => card.digest));
    expect(after.islands.map((island) => island.digest)).toEqual(before.islands.map((island) => island.digest));
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

describe("buildContextProjection: island title review gate", () => {
  it("never returns an unreviewed island title, under any constraint or SafeMode (fail closed)", async () => {
    const doc = buildDoc();
    doc.islands = [{ id: "i1", cardIds: ["c1", "c2"], title: "unreviewed secret title", titleReviewed: false }];

    for (const constraint of CONTEXT_PROJECTION_CONSTRAINTS) {
      for (const safeMode of [true, false]) {
        const projection = await buildContextProjection({ doc, constraint, safeMode });
        expect(JSON.stringify(projection), `${constraint}/${safeMode}`).not.toContain("unreviewed secret title");
        expect(projection.islands).toEqual([{ id: "i1", title: "(未レビュー)", digest: null }]);
      }
    }
  });

  it("returns a reviewed island title even when SafeMode is ON (ADR-0098)", async () => {
    const projection = await buildContextProjection({ doc: buildDoc(), constraint: "summary", safeMode: true });

    expect(projection.islands).toEqual([
      { id: "i1", title: "First island", digest: { alg: "sha256", value: expect.stringMatching(/^[0-9a-f]{64}$/) } },
    ]);
  });
});

// ADR-0103: 単位digest。露出した内容だけを入力にし、伏せた内容は入力にも出力にもしない。
describe("buildContextProjection: per-item digest (ADR-0103)", () => {
  const project = (doc: DocumentV1, safeMode: boolean, constraint: ContextProjectionConstraint = "reviewed-only") =>
    buildContextProjection({ doc, constraint, safeMode });
  const digestOf = (p: Awaited<ReturnType<typeof project>>, id: string) => p.cards.find((c) => c.id === id)?.digest;

  it("exposes a digest for a reviewed card whose text is exposed, and verifies from the exposed fields", async () => {
    const p = await project(buildDoc(), false);
    const d = digestOf(p, "c1");
    expect(d).toEqual({ alg: "sha256", value: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const bytes = new TextEncoder().encode(
      '{"id":"c1","kind":"card","schema":"context-projection.item-digest.v1","text":"reviewed claim one"}',
    );
    const hex = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(d?.value).toBe(hex);
  });

  it("exposes no card digest when the text is withheld (SafeMode ON), and no unreviewed card appears at all", async () => {
    const p = await project(buildDoc(), true);
    expect(p.cards.length).toBeGreaterThan(0);
    for (const card of p.cards) {
      expect(card.redacted).toBe(true);
      expect(card.digest).toBeNull();
    }
    expect(p.cards.find((c) => c.id === "c3")).toBeUndefined();
    expect(JSON.stringify(p)).not.toContain("unreviewed draft three");
  });

  it("changes when reviewed text changes, but not when layout, hold state or edges change", async () => {
    const base = buildDoc();
    const before = digestOf(await project(base, false), "c1");
    const edited = { ...base, cards: base.cards.map((c) => (c.id === "c1" ? { ...c, text: "reviewed claim ONE" } : c)) };
    expect(digestOf(await project(edited, false), "c1")).not.toEqual(before);
    expect(digestOf(await project(edited, false), "c2")).toEqual(digestOf(await project(base, false), "c2"));
    const moved = {
      ...base,
      cards: base.cards.map((c) => (c.id === "c1" ? { ...c, x: 999, y: -5, holdState: "held" as const } : c)),
      edges: [],
      updatedAt: "2026-08-01T00:00:00.000Z",
    };
    expect(digestOf(await project(moved, false), "c1")).toEqual(before);
  });

  it("is deterministic across runs and independent of the constraint", async () => {
    const a = await project(buildDoc(), false, "reviewed-only");
    const b = await project(buildDoc(), false, "reviewed-only");
    expect(a.cards.map((c) => c.digest)).toEqual(b.cards.map((c) => c.digest));
    const ev = await project(buildDoc(), false, "evidence");
    expect(digestOf(ev, "c1")).toEqual(digestOf(a, "c1"));
  });

  it("does not hash the text of a card that is not exposed (unreviewed text edits change nothing)", async () => {
    const base = buildDoc();
    const edited = { ...base, cards: base.cards.map((c) => (c.id === "c3" ? { ...c, text: "different draft" } : c)) };
    const a = await project(base, false);
    const b = await project(edited, false);
    expect(a.cards.map((c) => c.digest)).toEqual(b.cards.map((c) => c.digest));
    expect(a.bundleHash).toBe(b.bundleHash);
  });

  it("island digest follows titleReviewed only, identical in SafeMode ON/OFF, null for unreviewed or untitled", async () => {
    const base = buildDoc();
    const on = await project(base, true, "summary");
    const off = await project(base, false, "summary");
    expect(on.islands[0].digest).toEqual(off.islands[0].digest);
    expect(on.islands[0].digest).not.toBeNull();

    const renamed = { ...base, islands: [{ ...base.islands[0], title: "Renamed island" }] };
    expect((await project(renamed, true, "summary")).islands[0].digest).not.toEqual(on.islands[0].digest);

    const unreviewed = { ...base, islands: [{ ...base.islands[0], titleReviewed: false }] };
    const un = await project(unreviewed, false, "summary");
    expect(un.islands[0]).toEqual({ id: "i1", title: "(未レビュー)", digest: null });
    const untitled = { ...base, islands: [{ id: "i1", cardIds: ["c1"] }] } as DocumentV1;
    expect((await project(untitled, false, "summary")).islands[0].digest).toBeNull();
  });

});
