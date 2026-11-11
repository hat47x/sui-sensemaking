import type { StructureDraft, StructureDraftLoss } from "./structure_draft";

/**
 * G3-SHO-2: 構造Draftから、人が編集できるMarkdownアウトライン候補と
 * 機械可読な損失一覧を作る。
 *
 * このModuleが守る境界:
 * - Treeの見出しを機械的に「正しい親子」と主張しない。Treeが未指定なら
 *   見出しを作らず、全Cardを未分類として並べる。
 * - 非階層Relation・矛盾・保留・未解決・複数所属を本文へ混ぜず、独立した節に残す。
 * - 未選択・未レビューのID・本文・件数・題名を出さない（構造Draftの境界を
 *   そのまま引き継ぐ）。選択外の存在や件数は書かない。
 * - Card本文はMarkdown記法をエスケープし、見出し・リンク・脚注を捏造させない。
 * - I/O・ネットワーク・LLM呼出しをせず、同一入力で同一bytesになる。
 * - 返す封筒は SHO の `src/sui-candidate.cjs` が受理する
 *   `sui.sho.outline-candidate/v1` 契約に合わせる。
 */

export const OUTLINE_CANDIDATE_SCHEMA = "sui.sho.outline-candidate/v1";
export const OUTLINE_CANDIDATE_RAW_SOURCE_POLICY = "not-exportable";

export type OutlineCandidateSelection = {
  byteStart: number;
  byteEnd: number;
  sha256: string;
};

export type RenderOutlineCandidateInput = {
  draft: StructureDraft;
  /** SHO選択時点の元文書raw sha256。 */
  sourceRevision: string;
  /** SHO選択範囲。Patchの適用先になる。 */
  selection: OutlineCandidateSelection;
  purpose: string;
  emittedAt: string;
};

export type OutlineCandidateEnvelope = {
  schema: typeof OUTLINE_CANDIDATE_SCHEMA;
  emittedAt: string;
  producer: { product: string; entrypoint: string; version: string };
  consumer: { product: string; entrypoint: string };
  purpose: string;
  structureRevision: { kind: "sui-structure-draft-sha256"; value: string };
  sourceRevision: { kind: "sho-raw-sha256"; value: string };
  selection: OutlineCandidateSelection;
  disclosure: {
    scope: StructureDraft["disclosure"]["scope"];
    audience: string[];
    purpose: string;
    rawSource: typeof OUTLINE_CANDIDATE_RAW_SOURCE_POLICY;
  };
  loss: StructureDraftLoss[];
  payload: {
    mediaType: "text/markdown";
    encoding: "utf-8";
    sha256: string;
    byteLength: number;
    markdown: string;
  };
  coverage: {
    structureFlattened: false;
    unreviewedIncluded: false;
    hiddenCountsIncluded: false;
    networkUsed: false;
    aiUsed: false;
  };
};

export class OutlineCandidateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OutlineCandidateError";
    this.code = code;
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function escapeMarkdownLiteral(text: string): string {
  return text.replace(/([\x60*_{}\[\]()#+.!|<>~\\-])/g, "\\$1");
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function requireSha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new OutlineCandidateError("candidate-invalid-digest", `${field} must be 64 lowercase hex`);
  }
  return value;
}

function requireSafeSpan(selection: unknown): OutlineCandidateSelection {
  if (!selection || typeof selection !== "object") {
    throw new OutlineCandidateError("candidate-missing-selection", "selection must be present");
  }
  const { byteStart, byteEnd, sha256 } = selection as OutlineCandidateSelection;
  if (!Number.isSafeInteger(byteStart) || !Number.isSafeInteger(byteEnd) ||
      byteStart < 0 || byteEnd < byteStart) {
    throw new OutlineCandidateError("candidate-invalid-selection", "selection span must be a safe non-negative range");
  }
  return { byteStart, byteEnd, sha256: requireSha256(sha256, "selection.sha256") };
}

function firstLine(text: string): string {
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim().length > 0) return line;
  }
  return "";
}

function remainingLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  let first = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().length > 0) { first = index; break; }
  }
  if (first < 0) return [];
  return lines.slice(first + 1).filter((line) => line.trim().length > 0);
}

function renderTreeSection(draft: StructureDraft, cardById: Map<string, StructureDraft["cards"][number]>): string[] {
  const out: string[] = ["## 見出し候補（Tree）", ""];
  if (!draft.tree.provided || draft.tree.nodes.length === 0) {
    out.push("Tree候補は指定されていません。見出しは作らず、Cardを未分類として並べます。", "");
    return out;
  }
  const children = new Map<string | null, typeof draft.tree.nodes>();
  for (const node of draft.tree.nodes) {
    const bucket = children.get(node.parentId) ?? [];
    bucket.push(node);
    children.set(node.parentId, bucket);
  }
  const sortNodes = (nodes: typeof draft.tree.nodes) =>
    [...nodes].sort((left, right) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    });
  const walk = (parentId: string | null, depth: number): void => {
    for (const node of sortNodes(children.get(parentId) ?? [])) {
      const card = cardById.get(node.id);
      const level = Math.min(2 + depth, 6);
      const text = card?.text ?? null;
      const label = text === null ? "（保留中の記述）" : (firstLine(text) || "記述");
      out.push(`${"#".repeat(level)} ${escapeMarkdownLiteral(label)}`, "");
      if (text !== null) {
        for (const line of remainingLines(text)) {
          out.push(escapeMarkdownLiteral(line));
        }
        if (remainingLines(text).length > 0) out.push("");
      }
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function renderUnclassifiedSection(draft: StructureDraft): string[] {
  const treeIds = new Set(draft.tree.nodes.map((node) => node.id));
  const unclassified = draft.tree.provided
    ? draft.cards.filter((card) => !treeIds.has(card.id))
    : draft.cards;
  const out: string[] = ["## Tree未分類", ""];
  if (unclassified.length === 0) {
    out.push("この範囲ではTree未分類のCardはありません。", "");
    return out;
  }
  unclassified.forEach((card, index) => {
    out.push(`### 未分類の記述 ${index + 1}`, "");
    if (card.text === null) {
      out.push("（保留中のため本文は投影しない）", "");
      return;
    }
    out.push(escapeMarkdownLiteral(card.text), "");
  });
  return out;
}

function renderRelations(draft: StructureDraft): string[] {
  const out: string[] = ["## 非階層の関係", ""];
  if (draft.relations.length === 0) {
    out.push("この候補の範囲では非階層Relationはありません（範囲外の非存在は主張しない）。", "");
    return out;
  }
  for (const relation of draft.relations) {
    const arrow = relation.directed ? "→" : "—";
    out.push(`- ${relation.fromId} —(${relation.type})${arrow} ${relation.toId}`);
  }
  out.push("");
  return out;
}

function renderContradictions(draft: StructureDraft): string[] {
  const out: string[] = ["## 矛盾", ""];
  if (draft.contradictions.length === 0) {
    out.push("この候補の範囲では矛盾Edgeはありません（範囲外の非存在は主張しない）。", "");
    return out;
  }
  for (const contradiction of draft.contradictions) {
    out.push(`- ${contradiction.fromId} と ${contradiction.toId} は対立として記録されている`);
  }
  out.push("");
  return out;
}

function renderHolds(draft: StructureDraft): string[] {
  const out: string[] = ["## 保留", ""];
  if (draft.holds.length === 0) {
    out.push("この候補の範囲では保留中のCardはありません。", "");
    return out;
  }
  for (const hold of draft.holds) {
    out.push(`- ${hold.cardId}（${hold.state}）本文は投影しない`);
  }
  out.push("");
  return out;
}

function renderUnresolved(draft: StructureDraft): string[] {
  const out: string[] = ["## 未解決・空白", ""];
  const lines: string[] = [];
  for (const entry of draft.voids) {
    lines.push(`- 空白: ${entry.kind}（${entry.resolved ? "解決済み" : "未解決"}）`);
  }
  const treeIds = new Set(draft.tree.nodes.map((node) => node.id));
  if (draft.tree.provided) {
    for (const card of draft.cards) {
      if (!treeIds.has(card.id)) lines.push(`- Tree未分類: ${card.id}`);
    }
  }
  if (lines.length === 0) {
    out.push("この候補の範囲では未解決の空白・Tree未分類はありません。", "");
    return out;
  }
  out.push(...lines, "");
  return out;
}

function renderMembership(draft: StructureDraft): string[] {
  const out: string[] = ["## 所属と配置", ""];
  for (const island of draft.islands) {
    const title = island.title === null ? "（題名未レビュー）" : `「${escapeMarkdownLiteral(island.title)}」`;
    const members = island.cardIds.length === 0 ? "（対象Cardなし）" : island.cardIds.join(", ");
    out.push(`- Island ${island.id} ${title}: ${members}`);
  }
  for (const entry of draft.affiliations) {
    out.push(`- Affiliation: ${entry.cardId} → ${entry.islandId}`);
  }
  out.push("- Canvas座標は文章へ投影しない。元の配置はSUIに残る。", "");
  return out;
}

function renderSourceRefs(draft: StructureDraft): string[] {
  const out: string[] = ["## 元Source参照", ""];
  if (draft.sourceRefs.length === 0) {
    out.push("この候補の範囲では元Source参照はありません。", "");
    return out;
  }
  for (const entry of draft.sourceRefs) {
    out.push(`- ${entry.cardId}: ${escapeMarkdownLiteral(entry.source)}（未照合。照合済み出典として扱わない）`);
  }
  out.push("");
  return out;
}

function renderDisclosure(draft: StructureDraft): string[] {
  return [
    "## 開示境界",
    "",
    `- 開示Scope: ${draft.disclosure.scope}`,
    `- 対象Card: ${draft.disclosure.includedCardIds.join(", ")}`,
    `- 対象Island: ${draft.disclosure.includedIslandIds.length === 0 ? "なし" : draft.disclosure.includedIslandIds.join(", ")}`,
    "- 選択外の項目の有無・件数は示さない。",
    "",
  ];
}

function renderLoss(draft: StructureDraft): string[] {
  const out: string[] = ["## この候補で失われるもの", ""];
  for (const entry of draft.loss) {
    out.push(`- ${entry.kind}: ${entry.subject} — ${entry.reason}`);
  }
  out.push("");
  return out;
}

function buildMarkdown(draft: StructureDraft): string {
  const cardById = new Map(draft.cards.map((card) => [card.id, card]));
  const lines: string[] = [
    "# SUIからのアウトライン候補",
    "",
    "この候補は、明示的に選択された範囲の構造から作った草案です。意味の受理、出典の照合、構造の完全性の確認は行っていません。",
    "",
    ...renderTreeSection(draft, cardById),
    ...renderUnclassifiedSection(draft),
    ...renderRelations(draft),
    ...renderContradictions(draft),
    ...renderHolds(draft),
    ...renderUnresolved(draft),
    ...renderMembership(draft),
    ...renderSourceRefs(draft),
    ...renderDisclosure(draft),
    ...renderLoss(draft),
  ];
  return lines.join("\n") + "\n";
}

/**
 * 構造Draftから候補封筒を作る。draftは変更しない。
 */
export async function renderOutlineCandidate(
  input: RenderOutlineCandidateInput,
): Promise<OutlineCandidateEnvelope> {
  const draft = input?.draft;
  if (!draft || draft.schema !== "sui.structure-draft/v1") {
    throw new OutlineCandidateError("candidate-invalid-draft", "draft must be a sui.structure-draft/v1");
  }
  if (!Array.isArray(draft.loss) || draft.loss.length === 0) {
    // 空のlossを「損失なし」として通さない。
    throw new OutlineCandidateError("candidate-loss-missing", "draft must carry a non-empty loss manifest");
  }
  const sourceRevision = requireSha256(input.sourceRevision, "sourceRevision");
  const selection = requireSafeSpan(input.selection);
  if (typeof input.purpose !== "string" || input.purpose.trim().length === 0) {
    throw new OutlineCandidateError("candidate-missing-field", "purpose must be a non-empty string");
  }
  if (typeof input.emittedAt !== "string" || input.emittedAt.trim().length === 0) {
    throw new OutlineCandidateError("candidate-missing-field", "emittedAt must be a non-empty string");
  }

  const markdown = buildMarkdown(draft);
  const bytes = new TextEncoder().encode(markdown);
  const payloadSha256 = await sha256Hex(markdown);

  return {
    schema: OUTLINE_CANDIDATE_SCHEMA,
    emittedAt: input.emittedAt,
    producer: {
      product: "sui-sensemaking",
      entrypoint: "src/export/structure_outline_candidate.ts",
      version: "sui-sensemaking@main",
    },
    consumer: { product: "sho-composer", entrypoint: "src/sui-candidate.cjs" },
    purpose: input.purpose,
    structureRevision: { kind: "sui-structure-draft-sha256", value: draft.structureRevision },
    sourceRevision: { kind: "sho-raw-sha256", value: sourceRevision },
    selection,
    disclosure: {
      scope: draft.disclosure.scope,
      audience: draft.disclosure.audience,
      purpose: input.purpose,
      rawSource: OUTLINE_CANDIDATE_RAW_SOURCE_POLICY,
    },
    loss: draft.loss.map((entry) => ({ ...entry })),
    payload: {
      mediaType: "text/markdown",
      encoding: "utf-8",
      sha256: payloadSha256,
      byteLength: bytes.length,
      markdown,
    },
    coverage: {
      structureFlattened: false,
      unreviewedIncluded: false,
      hiddenCountsIncluded: false,
      networkUsed: false,
      aiUsed: false,
    },
  };
}
