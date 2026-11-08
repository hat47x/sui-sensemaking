import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import { buildContextProjection } from "./context_bundle_projection";
import { renderReadOnlyMarkdownDraft } from "./context_projection_markdown_draft";

/**
 * An independently authored UTF-8 expected payload for the SHO read-only
 * Consumer. Mirror bytes live at SHO's test/fixtures/sui-to-sho-p0.md.
 * Do NOT generate this expected from the function under test.
 * Pinned digest is over UTF-8 raw bytes, not a Source or Knowledge revision.
 */
const EXPECTED_BYTES_SHA256 = "7fd6fde2fbc4d9beaf9de14e8b8f4f5d70003cd2129f1502cdd7c73f50c171cd";
const expected = [
  "# SUIからの文章草稿",
  "",
  "この文書は取得済みの公開投影から作成した草稿です。原資料の照合、構造の全件性、意味の確認は行っていません。",
  "",
  "## 記述 1",
  "",
  "> 公開された観測",
  String.raw`> C:\\notes`,
  "",
  "## 記述 2",
  "",
  String.raw`> \# 疑似見出し`,
  String.raw`> \[出典らしい記述\]\(https://example\.invalid/ref\)`,
  String.raw`> \[^s1\]: 未照合`,
  "",
].join("\n");

function fixture(): DocumentV1 {
  return {
    version: 1,
    id: "sui-sho-p0-cross-product-synthetic",
    title: "Do not export this title",
    createdAt: "2026-11-07T00:00:00.000Z",
    updatedAt: "2026-11-07T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "公開された観測\nC:\\notes", x: 0, y: 0,
        textReviewed: true, meta: { source: "hidden:original-A" } },
      { id: "c2", text: "# 疑似見出し\n[出典らしい記述](https://example.invalid/ref)\n[^s1]: 未照合",
        x: 10, y: 10, textReviewed: true },
      { id: "c3", text: "非公開・未レビュー", x: 20, y: 20, textReviewed: false },
      { id: "c4", text: "レビュー済みだが保留", x: 30, y: 30, textReviewed: true, holdState: "held" },
      { id: "c5", text: "非公開の保留", x: 40, y: 40, textReviewed: false, holdState: "held" },
    ],
    islands: [
      { id: "i1", title: "secret island A", titleReviewed: false, cardIds: ["c1", "c3"] },
      { id: "i2", title: "public island B", titleReviewed: true, cardIds: ["c2", "c4"] },
    ],
    edges: [
      { id: "e1", fromId: "c1", toId: "c3", type: "related" },
      { id: "e2", fromId: "c2", toId: "c4", type: "causal" },
    ],
    readingOrder: ["c1", "c2", "c3", "c4", "c5"],
    narratives: [], evidenceLinks: [], mergeSuggestionDecisions: [],
  };
}

describe("SUI→SHO P0 fixed raw-byte Consumer contract (SUI producer only)", () => {
  it("generates the independently authored Markdown bytes; original Source and island remain absent", async () => {
    const doc = fixture();
    const visible = await buildContextProjection({ doc, constraint: "reviewed-only", safeMode: false });
    const md = renderReadOnlyMarkdownDraft(visible);
    const raw = new TextEncoder().encode(md);
    const hash = await crypto.subtle.digest("SHA-256", raw);
    const sha = Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, "0")).join("");
    expect(md).toBe(expected);
    expect(raw.byteLength).toBe(354);
    expect(sha).toBe(EXPECTED_BYTES_SHA256);
    expect(md).not.toContain("hidden:original-A");
    expect(md).not.toContain("secret island A");
    expect(md).not.toContain("e1");
    expect(md).not.toContain("非公開");
    expect(md).not.toContain("レビュー済みだが保留");
    expect(md).not.toContain("sources:");
    expect(md).not.toContain("verified:");

    // Explicit opt-in local integration probe only: the actual SUI runtime
    // output is written to one new disk file for SHO's real CLI to read.
    // Never overwrite pre-existing content, and never write hidden SUI data.
    // CI without this env var remains a pure read-only Producer test.
    const output = process.env.SUI_SHO_P0_OUTPUT;
    if (output !== undefined) {
      expect(output.length).toBeGreaterThan(0);
      expect(isAbsolute(output)).toBe(true);
      writeFileSync(output, raw, { flag: "wx", mode: 0o600 });
      expect(new Uint8Array(readFileSync(output))).toEqual(raw);
    }
  });
});
