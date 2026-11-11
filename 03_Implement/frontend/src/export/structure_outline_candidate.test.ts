import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DocumentV1 } from "../domain/types";
import { buildStructureDraft, type StructureDraft } from "./structure_draft";
import {
  OUTLINE_CANDIDATE_SCHEMA,
  renderOutlineCandidate,
  type OutlineCandidateEnvelope,
} from "./structure_outline_candidate";

/**
 * G3-SHO-2 の受入。Markdownの独立期待は文字列リテラルで確かめ、
 * 実装の出力から期待を作らない。
 */
const CREATED = "2026-11-11T00:00:00.000Z";
const EMITTED_AT = "2026-11-11T00:00:00.000Z";
const SOURCE_REVISION = "e".repeat(64);
const SELECTION = { byteStart: 10, byteEnd: 40, sha256: "d".repeat(64) };

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

async function draft(overrides: { treeCandidate?: null } = {}): Promise<StructureDraft> {
  return buildStructureDraft({
    doc: fixture(),
    includedCardIds: ["c1", "c2", "c4"],
    includedIslandIds: ["i1", "i2", "i3"],
    treeCandidate: overrides.treeCandidate === null
      ? null
      : [
        { id: "c1", parentId: null, order: 0 },
        { id: "c2", parentId: "c1", order: 0 },
        { id: "c4", parentId: "c1", order: 1 },
      ],
    disclosure: { scope: "selection-only", audience: ["sho-composer"], purpose: "限定往復試験" },
  });
}

async function candidate(overrides: { treeCandidate?: null } = {}): Promise<OutlineCandidateEnvelope> {
  return renderOutlineCandidate({
    draft: await draft(overrides),
    sourceRevision: SOURCE_REVISION,
    selection: SELECTION,
    purpose: "構造化結果をSHOの別Draftとして受け取る",
    emittedAt: EMITTED_AT,
  });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

describe("G3-SHO-2 Markdownアウトライン候補", () => {
  it("U2-0 封筒はSHOの候補契約に合い、payload digestを独立に再計算できる", async () => {
    const envelope = await candidate();
    expect(envelope.schema).toBe(OUTLINE_CANDIDATE_SCHEMA);
    expect(envelope.payload.sha256).toBe(await sha256(envelope.payload.markdown));
    expect(envelope.payload.byteLength).toBe(new TextEncoder().encode(envelope.payload.markdown).length);
    expect(envelope.structureRevision.value).toBe((await draft()).structureRevision);
    expect(envelope.sourceRevision).toEqual({ kind: "sho-raw-sha256", value: SOURCE_REVISION });
    expect(envelope.selection).toEqual(SELECTION);
    expect(envelope.disclosure.rawSource).toBe("not-exportable");
    expect(envelope.coverage).toEqual({
      structureFlattened: false,
      unreviewedIncluded: false,
      hiddenCountsIncluded: false,
      networkUsed: false,
      aiUsed: false,
    });
  });

  it("U2-1 同一入力で同一bytes・同一digestになる", async () => {
    const first = await candidate();
    const second = await candidate();
    expect(second.payload.markdown).toBe(first.payload.markdown);
    expect(second.payload.sha256).toBe(first.payload.sha256);
  });

  it("U2-2 複数所属を1つの見出しへ還元せず、所属一覧に残す", async () => {
    const markdown = (await candidate()).payload.markdown;
    expect(markdown).toContain("- Island i1 （題名未レビュー）: c1, c2");
    expect(markdown).toContain("- Island i2 「公開島」: c2");
    expect(markdown).toContain("- Affiliation: c2 → i1");
    expect(markdown).toContain("- Affiliation: c2 → i2");
    // 見出し本文は1回だけ。所属が2つでも見出しを二重化しない。
    expect(markdown.match(/観測B/g)?.length).toBe(1);
  });

  it("U2-3 矛盾・保留・未解決を独立した節に残し、本文へ混ぜない", async () => {
    const markdown = (await candidate()).payload.markdown;
    const body = markdown.indexOf("## 非階層の関係");
    const contradictions = markdown.indexOf("## 矛盾");
    const holds = markdown.indexOf("## 保留");
    const unresolved = markdown.indexOf("## 未解決・空白");
    expect(body).toBeLessThan(contradictions);
    expect(contradictions).toBeLessThan(holds);
    expect(holds).toBeLessThan(unresolved);
    expect(markdown).toContain("- c1 —(negate)— c2");
    expect(markdown).toContain("- c2 —(causal)→ c4");
    expect(markdown).toContain("c1 と c2 は対立として記録されている");
    expect(markdown).toContain("- c4（held）本文は投影しない");
    expect(markdown).toContain("空白: unintegrated_card");
    expect(markdown).toContain("空白: orphaned_island");
    // 保留本文は投影しない。
    expect(markdown).not.toContain("保留中の本文");
    // 矛盾を親子見出しとして複製しない。
    expect(markdown).not.toContain("### 観測B\n\n## 矛盾");
  });

  it("U2-4 loss manifestが非表現構造を列挙し、空manifestでは候補を作らない", async () => {
    const envelope = await candidate();
    const kinds = envelope.loss.map((entry) => entry.kind);
    for (const kind of [
      "canvas-coordinates", "tree-candidate", "multiple-affiliation",
      "non-hierarchical-relation", "contradiction", "hold", "unresolved", "source-unverified",
    ]) {
      expect(kinds).toContain(kind);
    }
    const markdown = envelope.payload.markdown;
    expect(markdown).toContain("## この候補で失われるもの");
    expect(markdown).toContain("- canvas-coordinates:");
    expect(markdown).toContain("- multiple-affiliation:");

    const empty = await draft();
    empty.loss = [];
    await expect(renderOutlineCandidate({
      draft: empty,
      sourceRevision: SOURCE_REVISION,
      selection: SELECTION,
      purpose: "x",
      emittedAt: EMITTED_AT,
    })).rejects.toMatchObject({ code: "candidate-loss-missing" });
  });

  it("U2-5 未レビュー・選択外のID・本文・件数・題名を出さない", async () => {
    const envelope = await candidate();
    const markdown = envelope.payload.markdown;
    expect(markdown).not.toContain("c3");
    expect(markdown).not.toContain("c5");
    expect(markdown).not.toContain("非公開の本文");
    expect(markdown).not.toContain("選択外の本文");
    expect(markdown).not.toContain("SECRET");
    expect(markdown).not.toContain("未レビューの島題名");
    expect(markdown).not.toContain("unreviewed_content");
    // 選択外の件数らしき数値を書かない。
    expect(markdown).not.toMatch(/選択外.*\d+件/);
    expect(envelope.coverage.unreviewedIncluded).toBe(false);
    expect(envelope.coverage.hiddenCountsIncluded).toBe(false);
  });

  it("U2-6 ネットワーク・LLM・I/Oを行わない", () => {
    const source = readFileSync(join(__dirname, "structure_outline_candidate.ts"), "utf8");
    expect(source).not.toMatch(/require\(['"](?:node:)?(?:net|http|https|dns|child_process)['"]\)/);
    expect(source).not.toMatch(/from\s+['"](?:node:)?(?:net|http|https|dns|child_process)['"]/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/openai|anthropic/i);
    expect(source).not.toMatch(/from\s+['"]node:fs['"]/);
  });

  it("U2-7 元の構造Draftを書き換えない", async () => {
    const original = await draft();
    const before = JSON.stringify(original);
    await renderOutlineCandidate({
      draft: original,
      sourceRevision: SOURCE_REVISION,
      selection: SELECTION,
      purpose: "x",
      emittedAt: EMITTED_AT,
    });
    expect(JSON.stringify(original)).toBe(before);
  });

  it("U2-8 Tree未指定なら見出しを作らず、未分類として並べる", async () => {
    const markdown = (await candidate({ treeCandidate: null })).payload.markdown;
    expect(markdown).toContain("Tree候補は指定されていません。見出しは作らず、Cardを未分類として並べます。");
    expect(markdown).toContain("### 未分類の記述 1");
    expect(markdown).toContain("### 未分類の記述 2");
    expect(markdown).not.toContain("## 観測A");
  });

  it("U2-9 節の順序を固定し、本文より先に構造の注意を置く", async () => {
    const markdown = (await candidate()).payload.markdown;
    const order = [
      "# SUIからのアウトライン候補",
      "## 見出し候補（Tree）",
      "## Tree未分類",
      "## 非階層の関係",
      "## 矛盾",
      "## 保留",
      "## 未解決・空白",
      "## 所属と配置",
      "## 元Source参照",
      "## 開示境界",
      "## この候補で失われるもの",
    ];
    let previous = -1;
    for (const heading of order) {
      const at = markdown.indexOf(heading);
      expect(at).toBeGreaterThan(previous);
      previous = at;
    }
  });

  it("U2-10 不正なsourceRevision・selectionを拒否する", async () => {
    const base = await draft();
    await expect(renderOutlineCandidate({
      draft: base,
      sourceRevision: "short",
      selection: SELECTION,
      purpose: "x",
      emittedAt: EMITTED_AT,
    })).rejects.toMatchObject({ code: "candidate-invalid-digest" });
    await expect(renderOutlineCandidate({
      draft: base,
      sourceRevision: SOURCE_REVISION,
      selection: { byteStart: 5, byteEnd: 4, sha256: "d".repeat(64) },
      purpose: "x",
      emittedAt: EMITTED_AT,
    })).rejects.toMatchObject({ code: "candidate-invalid-selection" });
  });
});
