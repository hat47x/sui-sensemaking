import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import {
  STRUCTURE_DRAFT_SCHEMA,
  STRUCTURE_DRAFT_LOSS_KINDS,
  buildStructureDraft,
  type BuildStructureDraftInput,
  type TreeCandidateNode,
} from "./structure_draft";

/**
 * G3-SHO-1 の受入。独立した期待はリテラルで書き、実装のReceiptから
 * 期待を作らない。
 */
const CREATED = "2026-11-11T00:00:00.000Z";

function fixture(): DocumentV1 {
  return {
    version: 1,
    id: "doc-g3",
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

const TREE_A: TreeCandidateNode[] = [
  { id: "c1", parentId: null, order: 0 },
  { id: "c2", parentId: "c1", order: 0 },
  { id: "c4", parentId: "c1", order: 1 },
];

const TREE_B: TreeCandidateNode[] = [
  { id: "c1", parentId: null, order: 0 },
  { id: "c2", parentId: null, order: 1 },
  { id: "c4", parentId: "c2", order: 0 },
];

function baseInput(overrides: Partial<BuildStructureDraftInput> = {}): BuildStructureDraftInput {
  return {
    doc: fixture(),
    includedCardIds: ["c1", "c2", "c4"],
    includedIslandIds: ["i1", "i2", "i3"],
    treeCandidate: TREE_A,
    disclosure: {
      scope: "selection-only",
      audience: ["sho-composer"],
      purpose: "限定往復試験",
    },
    ...overrides,
  };
}

describe("G3-SHO-1 構造Draft v1", () => {
  it("U1-1 Tree親の変更はCanvas・Island所属・Affiliationを変えない", async () => {
    const first = await buildStructureDraft(baseInput({ treeCandidate: TREE_A }));
    const second = await buildStructureDraft(baseInput({ treeCandidate: TREE_B }));
    expect(second.canvas).toEqual(first.canvas);
    expect(second.islands).toEqual(first.islands);
    expect(second.affiliations).toEqual(first.affiliations);
    expect(second.tree.nodes).not.toEqual(first.tree.nodes);
    expect(second.structureRevision).not.toBe(first.structureRevision);
  });

  it("U1-2 Canvas移動はTree親子・順序を変えない", async () => {
    const doc = fixture();
    doc.cards[0] = { ...doc.cards[0], x: 999, y: 999 };
    const moved = await buildStructureDraft(baseInput({ doc }));
    const original = await buildStructureDraft(baseInput());
    expect(moved.tree).toEqual(original.tree);
    expect(moved.canvas).not.toEqual(original.canvas);
    expect(moved.structureRevision).not.toBe(original.structureRevision);
  });

  it("U1-3 複数Island所属を1つへ縮約しない", async () => {
    const draft = await buildStructureDraft(baseInput());
    const c2Islands = draft.islands
      .filter((island) => island.cardIds.includes("c2"))
      .map((island) => island.id);
    expect(c2Islands).toEqual(["i1", "i2"]);
    expect(draft.affiliations.filter((entry) => entry.cardId === "c2").length).toBe(2);
    expect(draft.loss.map((entry) => entry.kind)).toContain("multiple-affiliation");
  });

  it("U1-4 非階層Relationを親子へ変換せず、型と向きを保つ", async () => {
    const draft = await buildStructureDraft(baseInput());
    const negate = draft.relations.find((entry) => entry.type === "negate");
    const causal = draft.relations.find((entry) => entry.type === "causal");
    expect(negate).toEqual({ fromId: "c1", toId: "c2", type: "negate", directed: false });
    expect(causal).toEqual({ fromId: "c2", toId: "c4", type: "causal", directed: true });
    // c5は選択外なので、c5を端点とするEdgeは含めない。
    expect(draft.relations.some((entry) => entry.toId === "c5")).toBe(false);
    // Treeの親子はEdgeから導出しない。
    expect(draft.tree.nodes.find((node) => node.id === "c2")?.parentId).toBe("c1");
    expect(draft.loss.map((entry) => entry.kind)).toContain("non-hierarchical-relation");
  });

  it("U1-5 保留と未解決を保持し、保留本文を投影しない", async () => {
    const draft = await buildStructureDraft(baseInput());
    expect(draft.holds).toEqual([{ cardId: "c4", state: "held" }]);
    expect(draft.cards.find((card) => card.id === "c4")?.text).toBeNull();
    expect(draft.voids.length).toBe(2);
    expect(draft.voids.map((entry) => entry.kind)).toEqual(["orphaned_island", "unintegrated_card"]);
    expect(draft.loss.map((entry) => entry.kind)).toContain("hold");
    expect(draft.loss.map((entry) => entry.kind)).toContain("unresolved");
  });

  it("U1-6 未選択・未レビューのID・本文・件数・題名を出さない", async () => {
    const draft = await buildStructureDraft(baseInput());
    const serialized = JSON.stringify(draft);
    expect(serialized).not.toContain('"c3"');
    expect(serialized).not.toContain('"c5"');
    expect(serialized).not.toContain("非公開の本文");
    expect(serialized).not.toContain("選択外の本文");
    expect(serialized).not.toContain("SECRET-TITLE");
    expect(serialized).not.toContain("未レビューの島題名");
    expect(serialized).not.toContain("unreviewed_content");
    // レビュー済みの題名だけを含める。
    expect(draft.islands.find((island) => island.id === "i2")?.title).toBe("公開島");
    expect(draft.islands.find((island) => island.id === "i1")?.title).toBeNull();
    expect(draft.coverage.unreviewedIncluded).toBe(false);
    expect(draft.coverage.hiddenCountsIncluded).toBe(false);
  });

  it("U1-7 同一入力で決定的なstructureRevisionになる", async () => {
    const first = await buildStructureDraft(baseInput());
    const second = await buildStructureDraft(baseInput());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.structureRevision).toBe(first.structureRevision);
    expect(first.structureRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  it("U1-7b Card本文の推敲はstructureRevisionを進めない", async () => {
    const first = await buildStructureDraft(baseInput());
    const doc = fixture();
    doc.cards[0] = { ...doc.cards[0], text: "推敲した観測A" };
    const second = await buildStructureDraft(baseInput({ doc }));
    expect(second.structureRevision).toBe(first.structureRevision);
    expect(second.cards.find((card) => card.id === "c1")?.text).toBe("推敲した観測A");
  });

  it("U1-8 ネットワーク・LLM・I/Oを行わない", () => {
    const source = readFileSync(join(__dirname, "structure_draft.ts"), "utf8");
    expect(source).not.toMatch(/require\(['"](?:node:)?(?:net|http|https|dns|child_process)['"]\)/);
    expect(source).not.toMatch(/from\s+['"](?:node:)?(?:net|http|https|dns|child_process)['"]/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/openai|anthropic/i);
    expect(source).not.toMatch(/from\s+['"][^'"]*llm[^'"]*['"]/i);
    expect(source).not.toMatch(/from\s+['"]node:fs['"]/);
  });

  it("未レビューCardの選択・未知ID・Tree循環を拒否する", async () => {
    await expect(buildStructureDraft(baseInput({ includedCardIds: ["c3"] })))
      .rejects.toMatchObject({ code: "draft-card-not-reviewed" });
    await expect(buildStructureDraft(baseInput({ includedCardIds: ["cX"] })))
      .rejects.toMatchObject({ code: "draft-unknown-card" });
    await expect(buildStructureDraft(baseInput({
      treeCandidate: [
        { id: "c1", parentId: "c2", order: 0 },
        { id: "c2", parentId: "c1", order: 0 },
      ],
    }))).rejects.toMatchObject({ code: "draft-tree-cycle" });
    await expect(buildStructureDraft(baseInput({
      disclosure: { scope: "public" as never, audience: ["sho-composer"], purpose: "x" },
    }))).rejects.toMatchObject({ code: "draft-disclosure-scope-unknown" });
  });

  it("Tree未指定はcandidate-overlayの欠如として明示する", async () => {
    const draft = await buildStructureDraft(baseInput({ treeCandidate: null }));
    expect(draft.tree).toEqual({ source: "candidate-overlay", provided: false, nodes: [] });
    expect(draft.loss.map((entry) => entry.kind)).toContain("tree-candidate");
    expect(draft.loss.map((entry) => entry.kind)).toContain("unresolved");
    expect(draft.schema).toBe(STRUCTURE_DRAFT_SCHEMA);
    for (const entry of draft.loss) {
      expect(STRUCTURE_DRAFT_LOSS_KINDS).toContain(entry.kind);
    }
  });

  it("SourceRefは照合済み出典として扱わない", async () => {
    const draft = await buildStructureDraft(baseInput());
    expect(draft.sourceRefs).toEqual([
      { cardId: "c1", source: "https://example.invalid/a", verified: false },
    ]);
    expect(draft.loss.map((entry) => entry.kind)).toContain("source-unverified");
  });
});
