import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import { buildContextProjection } from "./context_bundle_projection";

/**
 * SU-OKF03 / SU-SH12 / TEI #2497: the *same whole public projection* can
 * arise from different source references or island topologies.
 *
 * This uses the production projection, not a mock exporter or a proposed
 * OKF/SHO reverse mapper. It proves non-injectivity, not an OKF roundtrip,
 * a disclosure authorization, or the correctness of any automatic patch.
 */
function makeWorld(): DocumentV1 {
  return {
    version: 1,
    id: "sui-okf-noninjective-public-fixture",
    title: "Public synthetic fixture",
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "One claim", x: 10, y: 10, claimType: "claim", textReviewed: true, meta: { source: "example:A#span1" } },
      { id: "c2", text: "Related evidence", x: 20, y: 20, claimType: "fact", textReviewed: true, meta: { source: "example:A#span2" } },
      { id: "c3", text: "A second viewpoint", x: 30, y: 30, claimType: "hypothesis", textReviewed: true, meta: { source: "example:B#span1" } },
      { id: "c4", text: "A question", x: 40, y: 40, claimType: "unknown", textReviewed: true },
      { id: "c5", text: "Private held draft", x: 50, y: 50, claimType: "unknown", textReviewed: false, holdState: "held" },
    ],
    edges: [
      { id: "e1", fromId: "c1", toId: "c2", type: "related" },
      { id: "e2", fromId: "c3", toId: "c4", type: "causal" },
    ],
    islands: [
      { id: "i-left", cardIds: ["c1", "c2"], title: "Theme A", titleReviewed: true },
      { id: "i-right", cardIds: ["c3", "c4"], title: "Theme B", titleReviewed: true },
    ],
    readingOrder: ["c1", "c2", "c3", "c4", "c5"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

const publicView = (doc: DocumentV1) =>
  buildContextProjection({ doc, constraint: "reviewed-only", safeMode: false });

describe("SUI/OKF handoff: whole-projection non-injectivity (test-only witness)", () => {
  it("cannot distinguish two original source references even when public claim text is identical", async () => {
    const worldA = makeWorld();
    const worldB = makeWorld();
    worldB.cards = worldB.cards.map((card) =>
      card.id === "c1" ? { ...card, meta: { source: "example:C#different-span" } } : card,
    );

    // Independent fixture expectation: the original attribution has changed.
    expect(worldA.cards[0].meta?.source).toBe("example:A#span1");
    expect(worldB.cards[0].meta?.source).toBe("example:C#different-span");

    const a = await publicView(worldA);
    const b = await publicView(worldB);
    expect(a.cards.find((card) => card.id === "c1")?.text).toBe("One claim");
    expect(a.cards).toHaveLength(4); // the held, unreviewed card stays outside this view
    expect(a).toEqual(b); // stronger than comparing only bundleHash or item digest
    expect(a.cards[0]).not.toHaveProperty("meta");
    expect(a.cards[0]).not.toHaveProperty("source");

    // Identical public bytes are not a witness for original-document citations.
    // No OKF sources/footnotes are synthesized here.
  });

  it("cannot uniquely recover the island membership and canvas positions from the whole projection", async () => {
    const worldA = makeWorld();
    const worldB = makeWorld();
    worldB.islands = [
      { ...worldB.islands[0], cardIds: ["c1", "c3"] },
      { ...worldB.islands[1], cardIds: ["c2", "c4"] },
    ];
    worldB.cards = worldB.cards.map((card) =>
      card.id === "c1" ? { ...card, x: 900, y: -200 } : card,
    );

    expect(worldA.islands[0].cardIds).toEqual(["c1", "c2"]);
    expect(worldB.islands[0].cardIds).toEqual(["c1", "c3"]);
    expect(worldA.cards[0].x).toBe(10);
    expect(worldB.cards[0].x).toBe(900);

    const a = await publicView(worldA);
    const b = await publicView(worldB);
    expect(a).toEqual(b);
    expect(a.islands).toHaveLength(2);
    expect(a.islands[0]).not.toHaveProperty("cardIds");
    expect(a.islands[0]).not.toHaveProperty("parentIslandId");

    // Any future Markdown heading with only these two island titles likewise
    // cannot authorize writing a specific island membership to either world.
  });

  it("has positive controls: changes to an actually exposed claim and island title are detectable", async () => {
    const base = makeWorld();
    const altered = makeWorld();
    altered.cards = altered.cards.map((card) =>
      card.id === "c1" ? { ...card, text: "A changed public claim" } : card,
    );
    altered.islands = altered.islands.map((island) =>
      island.id === "i-left" ? { ...island, title: "A changed public island title" } : island,
    );

    const a = await publicView(base);
    const b = await publicView(altered);
    expect(a).not.toEqual(b);
    expect(a.bundleHash).not.toBe(b.bundleHash);
    expect(a.cards.find((card) => card.id === "c1")?.digest)
      .not.toEqual(b.cards.find((card) => card.id === "c1")?.digest);
    expect(a.islands.find((island) => island.id === "i-left")?.digest)
      .not.toEqual(b.islands.find((island) => island.id === "i-left")?.digest);
  });
});
