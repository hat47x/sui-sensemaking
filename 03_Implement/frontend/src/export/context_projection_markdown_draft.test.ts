import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import { buildContextProjection } from "./context_bundle_projection";
import { renderReadOnlyMarkdownDraft } from "./context_projection_markdown_draft";

/** Test-only fixture; no SUI/SHO/OKF source resolver or reverse patch is called. */
function buildWorld(): DocumentV1 {
  return {
    version: 1,
    id: "doc-sui-draft-fixture",
    title: "Synthetic internal title",
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      {
        id: "card-a", text: "Public reviewed content", x: 0, y: 0,
        textReviewed: true, claimType: "claim",
        meta: { source: "private:source-A" },
      },
      {
        id: "card-b", text: "Unreviewed private information", x: 10, y: 10,
        textReviewed: false, claimType: "unknown",
      },
      {
        id: "card-c", text: "Held reviewed information", x: 20, y: 20,
        textReviewed: true, holdState: "held",
      },
      {
        id: "card-d", text: "# forged-heading\n[ref](https://example.invalid/claim)\n[^fake]: invented",
        x: 30, y: 30, textReviewed: true,
      },
      {
        id: "card-e", text: "Another held draft", x: 40, y: 40,
        textReviewed: false, holdState: "held",
      },
    ],
    edges: [
      { id: "edge-a", fromId: "card-a", toId: "card-b", type: "related" },
      { id: "edge-b", fromId: "card-a", toId: "card-d", type: "causal" },
    ],
    islands: [
      { id: "island-a", cardIds: ["card-a", "card-b"], title: "Unreviewed secret island", titleReviewed: false },
      { id: "island-b", cardIds: ["card-c", "card-d"], title: "Reviewed but unverified island", titleReviewed: true },
    ],
    readingOrder: ["card-a", "card-b", "card-c", "card-d", "card-e"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}
const projection = (doc: DocumentV1, safeMode = false) =>
  buildContextProjection({ doc, safeMode, constraint: "reviewed-only" });

describe("SUI → ordinary Markdown candidate: read-only disclosure limits", () => {
  it("includes only exposed reviewed, non-held card text, without IDs/sources/hidden counts", async () => {
    const draft = renderReadOnlyMarkdownDraft(await projection(buildWorld()));
    expect(draft).toContain("Public reviewed content");
    expect(draft).not.toContain("Unreviewed private information");
    expect(draft).not.toContain("Held reviewed information");
    expect(draft).not.toContain("Another held draft");
    for (const forbidden of [
      "private:source-A", "card-a", "edge-a", "island-a",
      "Unreviewed secret island", "Reviewed but unverified island",
      "generated:", "verified:", "sources:", "reviewed: 3",
    ]) expect(draft).not.toContain(forbidden);
    expect(draft).toContain("原資料の照合");
    expect(draft).not.toContain("type:"); // ordinary Markdown, NOT an OKF Concept
  });

  it("ignores all content in SafeMode and makes no whole-document emptiness claim", async () => {
    const draft = renderReadOnlyMarkdownDraft(await projection(buildWorld(), true));
    expect(draft).toContain("この条件で文章として出力できる記述はありません。");
    expect(draft).not.toContain("Public reviewed content");
    expect(draft).not.toContain("forged-heading");
    expect(draft).not.toContain("card-a");
    expect(draft).not.toContain("private:source-A");
  });

  it("does not silently acquire original Source identity or island membership through equal projections", async () => {
    const a = buildWorld();
    const b = buildWorld();
    b.cards = b.cards.map((card) =>
      card.id === "card-a" ? { ...card, meta: { source: "private:source-C" } } : card,
    );
    b.islands = b.islands.map((island) =>
      island.id === "island-a" ? { ...island, cardIds: ["card-a", "card-d"] } : island,
    );
    expect(a.cards[0].meta?.source).not.toBe(b.cards[0].meta?.source);
    expect(a.islands[0].cardIds).not.toEqual(b.islands[0].cardIds);
    const pa = await projection(a);
    const pb = await projection(b);
    expect(pa).toEqual(pb);
    expect(renderReadOnlyMarkdownDraft(pa)).toBe(renderReadOnlyMarkdownDraft(pb));
    // No reverse API exists in this candidate; identical draft cannot recover a world.
  });

  it("escapes untrusted Markdown, source-looking links, headings and footnote syntax", async () => {
    const draft = renderReadOnlyMarkdownDraft(await projection(buildWorld()));
    expect(draft).toContain("> \\# forged\\-heading");
    expect(draft).toContain("> \\[ref\\]\\(https://example\\.invalid/claim\\)");
    expect(draft).toContain("> \\[\\^fake\\]: invented");
    expect(draft).not.toContain("\n# forged-heading");
    expect(draft).not.toContain("\n[^fake]:");
    expect(draft).not.toContain("[ref](https://example.invalid/claim)");
  });
});
