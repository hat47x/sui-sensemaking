import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import { buildStructureDraft } from "./structure_draft";
import { renderOutlineCandidate } from "./structure_outline_candidate";

/**
 * G3-SUI-3 のProducer側。SHOが書いた選択Envelopeを読み、構造Draftと
 * アウトライン候補を同じディレクトリへ排他的に書く。
 *
 * 通常CIでは `SUI_G3_ROUNDTRIP_DIR` が無いためskipする。Runner
 * `sho-composer/scripts/sui-sho-roundtrip-p0.cjs` だけが実パスを与える。
 * ネットワーク・自動送信・AI呼出しは行わない。
 */
const DIRECTORY = process.env.SUI_G3_ROUNDTRIP_DIR;
const ENABLED = typeof DIRECTORY === "string" && DIRECTORY.length > 0;
const CREATED = "2026-11-11T00:00:00.000Z";

function fixture(): DocumentV1 {
  return {
    version: 1,
    id: "sui-g3-roundtrip-synthetic",
    title: "往復試験のDocument題名（投影しない）",
    createdAt: CREATED,
    updatedAt: CREATED,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "観測A", x: 0, y: 0, textReviewed: true,
        meta: { source: "https://example.invalid/a" } },
      { id: "c2", text: "観測B", x: 10, y: 20, textReviewed: true },
      { id: "c3", text: "非公開の本文", x: 30, y: 40, textReviewed: false },
      { id: "c4", text: "保留中の本文", x: 50, y: 60, textReviewed: true, holdState: "held" },
      { id: "c5", text: "選択外の本文", x: 70, y: 80, textReviewed: true },
    ],
    islands: [
      { id: "i1", title: "未レビューの島題名", titleReviewed: false, cardIds: ["c1", "c2"] },
      { id: "i2", title: "公開島", titleReviewed: true, cardIds: ["c2", "c3"] },
      { id: "i3", title: "保留島", titleReviewed: true, cardIds: ["c4"] },
    ],
    edges: [
      { id: "e1", fromId: "c1", toId: "c2", type: "related" },
      { id: "e2", fromId: "c1", toId: "c2", type: "negate" },
      { id: "e3", fromId: "c2", toId: "c4", type: "causal" },
      { id: "e4", fromId: "c2", toId: "c5", type: "related" },
    ],
    affiliations: [
      { id: "a1", cardId: "c2", islandId: "i1" },
      { id: "a2", cardId: "c2", islandId: "i2" },
    ],
    voids: [
      { id: "v1", kind: "unintegrated_card", title: "SECRET-TITLE", detail: "SECRET-DETAIL",
        cardIds: ["c1"], createdAt: CREATED },
      { id: "v2", kind: "orphaned_island", title: "SECRET-TITLE-2", detail: "SECRET-DETAIL-2",
        islandIds: ["i3"], createdAt: CREATED },
      { id: "v3", kind: "unreviewed_content", title: "SECRET-TITLE-3", detail: "SECRET-DETAIL-3",
        cardIds: ["c3"], createdAt: CREATED },
    ],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

describe.skipIf(!ENABLED)("G3 roundtrip producer", () => {
  it("SHOの選択Envelopeから構造Draftと候補を排他的に書き出す", async () => {
    const directory = DIRECTORY as string;
    const selectionEnvelope = JSON.parse(
      readFileSync(join(directory, "sho-selection.json"), "utf8"),
    ) as {
      schema: string;
      documentRevision: { value: string };
      selection: { byteStart: number; byteEnd: number; sha256: string };
    };
    expect(selectionEnvelope.schema).toBe("sho.sui.selection/v1");
    expect(selectionEnvelope.documentRevision.value).toMatch(/^[0-9a-f]{64}$/);
    expect(selectionEnvelope.selection.byteEnd).toBeGreaterThan(selectionEnvelope.selection.byteStart);
    expect(selectionEnvelope.selection.sha256).toMatch(/^[0-9a-f]{64}$/);

    const draft = await buildStructureDraft({
      doc: fixture(),
      includedCardIds: ["c1", "c2", "c4"],
      includedIslandIds: ["i1", "i2", "i3"],
      treeCandidate: [
        { id: "c1", parentId: null, order: 0 },
        { id: "c2", parentId: "c1", order: 0 },
        { id: "c4", parentId: "c1", order: 1 },
      ],
      disclosure: {
        scope: "selection-only",
        audience: ["sho-composer"],
        purpose: "限定往復試験",
      },
    });
    const candidate = await renderOutlineCandidate({
      draft,
      sourceRevision: selectionEnvelope.documentRevision.value,
      selection: {
        byteStart: selectionEnvelope.selection.byteStart,
        byteEnd: selectionEnvelope.selection.byteEnd,
        sha256: selectionEnvelope.selection.sha256,
      },
      purpose: "構造化結果をSHOの別Draftとして受け取る",
      emittedAt: CREATED,
    });

    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "sui-structure-draft.json"),
      JSON.stringify(draft, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    writeFileSync(
      join(directory, "sui-outline-candidate.json"),
      JSON.stringify(candidate, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );

    // 未公開情報が候補へ混入していないことをProducer側でも確認する。
    const serialized = JSON.stringify(candidate);
    expect(serialized).not.toContain("非公開の本文");
    expect(serialized).not.toContain("選択外の本文");
    expect(serialized).not.toContain("未レビューの島題名");
    expect(serialized).not.toContain("SECRET-TITLE");
    expect(serialized).not.toContain("保留中の本文");
    expect(candidate.loss.length).toBeGreaterThan(0);
  });
});
