import type { DocumentV1 } from "../domain/types";
import { resolveKnownEdgeType } from "../domain/types";
import { SafeModePolicy } from "../domain/policy/safe_mode";
import { canonicalizeJson } from "../domain/patch/patch_fingerprint";
import { projectIslandTitle } from "./context_bundle_projection";

// EXT-AGENT-01 (ADR-0049 D2, spec `02_Architecture/external_agent_collaboration_spec.md`
// §3): AgentTaskPackage v1 -- a single Markdown "task sheet" a human hands to an
// external flat-rate AI agent (copy/paste or file attach; Tier 0 only, no
// automatic transport). Content is a REAL excerpt of the current document
// (direct DocumentV1 traversal), not a round-trip through the backend's
// /context/query and /context/bundle endpoints: `issue-CE1-context-query-bundle-foundation.md`
// fixes CE1 as "mock-first, contract-only" (stubDatasetId is a closed-world
// literal, "A2-minimal-v1", accepting no real document) until a separate,
// not-yet-started implementation slice expands its provider/runtime behavior.
// Routing this generator's context excerpt through that stub would embed
// canned, unrelated content in a package meant to leave the app boundary --
// so bundleHash/queryCanonicalHash are computed locally (sha256 of the same
// canonical-JSON shape CE1's own hash rule uses) over the REAL selection.

export const AGENT_TASK_KINDS = [
  "island_titles",
  "merge_candidates",
  "narrative_draft",
  "opposing_viewpoints",
  "critique_suggestions",
  "free_analysis",
] as const;

export type AgentTaskKind = (typeof AGENT_TASK_KINDS)[number];

export type AgentTaskCorrelation = {
  schemaVersion: "agent-task.v1";
  taskId: string;
  createdAt: string;
  docId: string;
  baseDocSignature: string;
  bundleHash: string;
  queryCanonicalHash: string;
  taskKind: AgentTaskKind;
  locale: "ja";
};

export type AgentTaskExportOptions = {
  /** Default false. Forced false whenever safeMode is true (mirrors reading_outline.ts). */
  includeUnreviewedDrafts?: boolean;
  /** Default false. Independent of safeMode (DOMAIN-TRACE-01 axis). */
  includeSourceReferences?: boolean;
  /** "roughly how many" for count-bearing taskKinds. Default 3. */
  desiredCount?: number;
};

export type AgentTaskSheetInput = {
  doc: DocumentV1;
  taskKind: AgentTaskKind;
  selectedCardIds: string[];
  selectedIslandIds: string[];
  safeMode: boolean;
  /** Caller-supplied (crypto.randomUUID() at call time) for determinism/testability. */
  taskId: string;
  /** Caller-supplied ISO8601 for determinism/testability. */
  createdAt: string;
  options?: AgentTaskExportOptions;
};

export type AgentTaskSheetOutput = {
  taskSheetMd: string;
  correlation: AgentTaskCorrelation;
  taskJson: string;
};

// spec §3.3 item 2, quoted verbatim -- "省略禁止" (must not be abridged).
export const AGENT_TASK_GUARDRAIL_TEXT =
  "「あなたの出力は提案であり確定しません／点数・順位・％・優先度の数値を付けないでください／曖昧・対立・未確定はそのまま保持して提示してください／出典のない断定をしないでください／応答は§4の JSON のみで返してください（前後の説明文は不要）」";

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function buildScopeLabel(cardCount: number, islandCount: number): string {
  if (cardCount === 0 && islandCount === 0) {
    return "選択なし";
  }
  const parts: string[] = [];
  if (cardCount > 0) parts.push(`カード${cardCount}枚`);
  if (islandCount > 0) parts.push(`島${islandCount}件`);
  return parts.join("・");
}

function buildRequestInstruction(taskKind: AgentTaskKind, scopeLabel: string, desiredCount: number): string {
  switch (taskKind) {
    case "island_titles":
      return `文脈に含まれるカード群から、島（まとまり）のタイトル候補を${desiredCount}件程度、提案してください。対象範囲: ${scopeLabel}。`;
    case "merge_candidates":
      return `文脈に含まれるカードの中で、統合（マージ）できそうな組を${desiredCount}件程度、提案してください。対象範囲: ${scopeLabel}。近い記述を整理する場合は near_duplicate、完全な重複ではない複数カードから共通の意味核を立てる場合は kernel_fusion とし、各 merge_candidate の content.mergeMethod に必ず明示してください。`;
    case "narrative_draft":
      return `文脈に含まれる内容をもとに、読み手に伝わる文章の草稿を1件、提案してください。対象範囲: ${scopeLabel}。`;
    case "opposing_viewpoints":
      return `文脈に含まれる主張に対して、対立する視点や反例を${desiredCount}件程度、提案してください。対象範囲: ${scopeLabel}。`;
    case "critique_suggestions":
      return `文脈に含まれる内容について、違和感や再検討すべき点を${desiredCount}件程度、指摘してください。対象範囲: ${scopeLabel}。`;
    case "free_analysis":
      return `文脈に含まれる内容について、自由に分析・考察してください。対象範囲: ${scopeLabel}。`;
  }
}

type ContextExcerpt = {
  lines: string[];
  hashPayload: unknown;
};

function buildContextExcerpt(input: AgentTaskSheetInput): ContextExcerpt {
  const { doc, safeMode, selectedCardIds, selectedIslandIds } = input;
  const includeUnreviewedDrafts = !safeMode && (input.options?.includeUnreviewedDrafts ?? false);
  const includeSourceReferences = input.options?.includeSourceReferences ?? false;

  const cardsById = new Map(doc.cards.map((card) => [card.id, card]));
  const islandsById = new Map(doc.islands.map((island) => [island.id, island]));

  const effectiveCardIds = new Set(selectedCardIds);
  for (const islandId of selectedIslandIds) {
    const island = islandsById.get(islandId);
    if (island) {
      for (const cardId of island.cardIds) effectiveCardIds.add(cardId);
    }
  }
  const selectedEntityIds = new Set<string>([...effectiveCardIds, ...selectedIslandIds]);

  let reviewedCount = 0;
  let unreviewedCount = 0;
  const cardEntries: Array<{ id: string; claimType?: string; text: string; source?: string }> = [];

  for (const cardId of [...effectiveCardIds].sort()) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    const reviewed = card.textReviewed ?? false;
    if (reviewed) reviewedCount += 1;
    else unreviewedCount += 1;

    const canExpose = SafeModePolicy.canExposeText("card.text", "share", safeMode) && (reviewed || includeUnreviewedDrafts);
    const text = canExpose ? card.text : SafeModePolicy.summarizeForSafeMode(card.text);
    cardEntries.push({
      id: card.id,
      claimType: card.claimType,
      text,
      source: includeSourceReferences ? card.meta?.source : undefined,
    });
  }

  const islandEntries = [...selectedIslandIds]
    .sort()
    .map((islandId) => islandsById.get(islandId))
    .filter((island): island is NonNullable<typeof island> => island !== undefined)
    // Same rule as the external projection: an island title leaves the app only once reviewed.
    .map((island) => ({ id: island.id, title: projectIslandTitle(island) }));

  const relationEntries = doc.edges
    .filter((edge) => selectedEntityIds.has(edge.fromId) && selectedEntityIds.has(edge.toId))
    .map((edge) => ({ from: edge.fromId, to: edge.toId, type: resolveKnownEdgeType(edge.type) }))
    .sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));

  const byFromThenTo = (a: { from: string; to: string }, b: { from: string; to: string }): number =>
    a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from);

  const evidenceLinks = doc.evidenceLinks ?? [];
  const evidenceEntries = evidenceLinks
    .filter((link) => link.type === "supports" && effectiveCardIds.has(link.fromCardId) && effectiveCardIds.has(link.toCardId))
    .map((link) => ({ from: link.fromCardId, to: link.toCardId }))
    .sort(byFromThenTo);
  const contradictionEntries = evidenceLinks
    .filter((link) => link.type === "contradicts" && effectiveCardIds.has(link.fromCardId) && effectiveCardIds.has(link.toCardId))
    .map((link) => ({ from: link.fromCardId, to: link.toCardId }))
    .sort(byFromThenTo);

  const lines: string[] = [];
  if (safeMode) {
    lines.push("（セーフモード: 本文は非表示です）", "");
  } else if (!includeUnreviewedDrafts && unreviewedCount > 0) {
    lines.push(`（未レビューのカード ${unreviewedCount}件は本文を除外しています）`, "");
  }

  lines.push(`カード: ${reviewedCount + unreviewedCount}枚（レビュー済み ${reviewedCount}・未レビュー ${unreviewedCount}）`);
  for (const entry of cardEntries) {
    const claimTypeLabel = entry.claimType ? `[${entry.claimType}] ` : "";
    const sourceLabel = entry.source ? ` (source: ${entry.source})` : "";
    lines.push(`- ${claimTypeLabel}${entry.text}${sourceLabel}`);
  }

  if (islandEntries.length > 0) {
    lines.push("", `島: ${islandEntries.length}件`);
    for (const entry of islandEntries) {
      lines.push(`- ${entry.title}`);
    }
  }

  if (relationEntries.length > 0) {
    lines.push("", `関係線: ${relationEntries.length}件`);
    for (const entry of relationEntries) {
      lines.push(`- ${entry.from} → ${entry.to} (${entry.type})`);
    }
  }

  if (evidenceEntries.length > 0) {
    lines.push("", `根拠リンク: ${evidenceEntries.length}件`);
    for (const entry of evidenceEntries) {
      lines.push(`- ${entry.from} ⇒ ${entry.to}`);
    }
  }

  if (contradictionEntries.length > 0) {
    lines.push("", `矛盾リンク: ${contradictionEntries.length}件`);
    for (const entry of contradictionEntries) {
      lines.push(`- ${entry.from} ⇔ ${entry.to}`);
    }
  }

  return {
    lines,
    hashPayload: {
      cards: cardEntries.map((entry) => ({ id: entry.id, claimType: entry.claimType ?? null })),
      islands: islandEntries,
      relations: relationEntries,
      evidence: evidenceEntries,
      contradictions: contradictionEntries,
      reviewFlags: { reviewed: reviewedCount, unreviewed: unreviewedCount },
    },
  };
}

const AGENT_TASK_RESPONSE_SCHEMA_JSON = JSON.stringify(
  {
    schemaVersion: "agent-response.v1",
    taskId: "uuid (依頼のエコーバック・必須)",
    correlation: {
      schemaVersion: "agent-task.v1",
      taskId: "相関ブロックの値",
      createdAt: "相関ブロックの値",
      docId: "相関ブロックの値",
      baseDocSignature: "相関ブロックの値",
      bundleHash: "相関ブロックの値",
      queryCanonicalHash: "相関ブロックの値",
      taskKind: "相関ブロックの値",
      locale: "ja",
    },
    respondedAt: "ISO8601 (任意)",
    agent: "string (例: copilot-studio:<agent名> / m365-copilot。自由記述)",
    proposals: [
      {
        proposalId: "string (応答内一意)",
        kind: "island_title | merge_candidate | narrative_draft | opposing_viewpoint | critique | patch",
        targetRef: { islandId: "string?", cardIds: ["string"] },
        content: { title: "string?", text: "string?", mergedText: "string?", mergeMethod: "near_duplicate | kernel_fusion (kind=merge_candidate のとき必須)" },
        rationale: "string (必須・なぜそう考えたか)",
        patch: "PatchV1? (kind=patch のときのみ。baseDocSignature は依頼と一致必須)",
      },
    ],
  },
  null,
  2,
);

const AGENT_TASK_RESPONSE_MINIMAL_EXAMPLE_JSON = JSON.stringify(
  {
    schemaVersion: "agent-response.v1",
    taskId: "<correlation.taskId をそのまま記入>",
    correlation: "<依頼の相関ブロックをオブジェクトとしてそのまま記入>",
    proposals: [
      {
        proposalId: "p1",
        kind: "critique",
        targetRef: { cardIds: ["<card-id>"] },
        content: { text: "..." },
        rationale: "...",
      },
    ],
  },
  null,
  2,
);

export async function buildAgentTaskSheet(input: AgentTaskSheetInput): Promise<AgentTaskSheetOutput> {
  const desiredCount = input.options?.desiredCount ?? 3;
  const context = buildContextExcerpt(input);
  const scopeLabel = buildScopeLabel(new Set(input.selectedCardIds).size, new Set(input.selectedIslandIds).size);

  const baseDocSignature = `${input.doc.id}:${input.doc.updatedAt}`;
  const queryCanonicalHash = await sha256Hex(
    canonicalizeJson({
      taskKind: input.taskKind,
      selectedCardIds: [...input.selectedCardIds].sort(),
      selectedIslandIds: [...input.selectedIslandIds].sort(),
      docId: input.doc.id,
    }),
  );
  const bundleHash = await sha256Hex(canonicalizeJson(context.hashPayload));

  const correlation: AgentTaskCorrelation = {
    schemaVersion: "agent-task.v1",
    taskId: input.taskId,
    createdAt: input.createdAt,
    docId: input.doc.id,
    baseDocSignature,
    bundleHash,
    queryCanonicalHash,
    taskKind: input.taskKind,
    locale: "ja",
  };
  const correlationJson = JSON.stringify(correlation, null, 2);

  const lines: string[] = [
    "## 依頼",
    "",
    buildRequestInstruction(input.taskKind, scopeLabel, desiredCount),
    "",
    "## ガードレール",
    "",
    AGENT_TASK_GUARDRAIL_TEXT,
    "",
    "## 文脈",
    "",
    ...context.lines,
    "",
    "## 応答契約",
    "",
    "以下のJSON Schemaの形式で応答してください。",
    "",
    "```json",
    AGENT_TASK_RESPONSE_SCHEMA_JSON,
    "```",
    "",
    "最小記入例:",
    "",
    "```json",
    AGENT_TASK_RESPONSE_MINIMAL_EXAMPLE_JSON,
    "```",
    "",
    "## 相関ブロック",
    "",
    "以下のJSONを、応答の correlation にそのまま echo-back してください（taskId も必ず一致させてください）。",
    "",
    "```json",
    correlationJson,
    "```",
  ];

  return {
    taskSheetMd: `${lines.join("\n").trimEnd()}\n`,
    correlation,
    taskJson: correlationJson,
  };
}
