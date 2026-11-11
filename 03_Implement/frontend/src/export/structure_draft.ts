import type { DocumentV1 } from "../domain/types";
import { canonicalizeJson } from "../domain/patch/patch_fingerprint";

/**
 * G3-SHO-1: 往復用の構造Draft v1。
 *
 * SHOから受けた少数のCardを、AIなしで配置・関係編集した結果を、後段の
 * Markdownアウトライン候補（G3-SHO-2）へ渡すための中間表現。
 *
 * このModuleが守る境界:
 * - Tree（Outline/Mind Mapの親子・順序）は **candidate-overlay** として明示入力
 *   から受け取り、`DocumentV1` へ永続化しない。DocumentV1にTreeフィールドは無い。
 * - Canvas座標・Island所属・Affiliation・Edgeはそれぞれ別の層として保持し、
 *   一方の編集が他方を書き換えない。異なるTree枝が同じIslandに集まることは
 *   構造的Observation候補であり、親子の付け替えではない。
 * - 対象は明示的に許可されたCard/Islandだけ。未選択・未レビューのID・本文・
 *   件数を出さない。Card本文はレビュー済みかつ非保留のときだけ含める。
 * - Island題名はレビュー済みのときだけ含める。Voidの題名・詳細はCard本文を
 *   引用し得るため含めない。
 * - 外部投影（context-projection.v1）を拡張しない。MCP面・DocumentV1スキーマ・
 *   TS/Python契約の対象型を変えない。
 * - I/O・ネットワーク・LLM呼出しをしない。純粋な関数とcanonical JSONだけ。
 */

export const STRUCTURE_DRAFT_SCHEMA = "sui.structure-draft/v1";

/** 開示Scopeの閉集合。未知の値はactive/publicへ読み替えない。 */
export const STRUCTURE_DRAFT_DISCLOSURE_SCOPES = [
  "selection-only",
  "synthetic-only",
  "reviewed-projection-only",
] as const;
export type StructureDraftDisclosureScope =
  (typeof STRUCTURE_DRAFT_DISCLOSURE_SCOPES)[number];

export const STRUCTURE_DRAFT_LOSS_KINDS = [
  "canvas-coordinates",
  "tree-candidate",
  "multiple-affiliation",
  "non-hierarchical-relation",
  "contradiction",
  "hold",
  "unresolved",
  "source-unverified",
] as const;
export type StructureDraftLossKind = (typeof STRUCTURE_DRAFT_LOSS_KINDS)[number];

export type StructureDraftLoss = {
  id: string;
  kind: StructureDraftLossKind;
  subject: string;
  reason: string;
  recoverable: boolean;
};

export type TreeCandidateNode = {
  /** 対象Cardのid。選択済みCardだけを参照できる。 */
  id: string;
  parentId: string | null;
  /** 同じ親の中での順序。負値・非整数は拒否する。 */
  order: number;
};

export type StructureDraftCard = {
  id: string;
  /** レビュー済みかつ非保留のときだけ本文。保留・未レビューはnull。 */
  text: string | null;
  holdState: string | null;
};

export type StructureDraft = {
  schema: typeof STRUCTURE_DRAFT_SCHEMA;
  /** 構造（本文・開示・lossを除く）のcanonical sha256。 */
  structureRevision: string;
  tree: {
    source: "candidate-overlay";
    provided: boolean;
    nodes: TreeCandidateNode[];
  };
  cards: StructureDraftCard[];
  canvas: {
    cards: Array<{ id: string; x: number; y: number }>;
  };
  islands: Array<{
    id: string;
    title: string | null;
    titleReviewed: boolean;
    cardIds: string[];
    parentIslandId: string | null;
  }>;
  affiliations: Array<{ cardId: string; islandId: string }>;
  relations: Array<{
    fromId: string;
    toId: string;
    type: string;
    directed: boolean;
  }>;
  holds: Array<{ cardId: string; state: string }>;
  contradictions: Array<{ fromId: string; toId: string }>;
  voids: Array<{ kind: string; subject: string | null; resolved: boolean }>;
  sourceRefs: Array<{ cardId: string; source: string; verified: false }>;
  disclosure: {
    scope: StructureDraftDisclosureScope;
    audience: string[];
    purpose: string;
    includedCardIds: string[];
    includedIslandIds: string[];
  };
  loss: StructureDraftLoss[];
  coverage: {
    structurePersistedToDocumentV1: false;
    treeIsCandidateOverlay: true;
    canvasCoordinatesProjectedToProse: false;
    unreviewedIncluded: false;
    hiddenCountsIncluded: false;
    networkUsed: false;
    aiUsed: false;
  };
};

export type BuildStructureDraftInput = {
  doc: DocumentV1;
  /** 明示的に許可されたCard。すべてレビュー済みでなければ拒否する。 */
  includedCardIds: string[];
  /** 明示的に許可されたIsland。 */
  includedIslandIds: string[];
  /** Outline/Mind Mapの親子・順序。DocumentV1へは書かない。 */
  treeCandidate?: TreeCandidateNode[] | null;
  disclosure: {
    scope: StructureDraftDisclosureScope;
    audience: string[];
    purpose: string;
  };
};

export class StructureDraftError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "StructureDraftError";
    this.code = code;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function compareCodeUnit(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function requireIdList(value: unknown, field: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new StructureDraftError(
      "draft-missing-field",
      allowEmpty ? `${field} must be an array` : `${field} must be a non-empty array`,
    );
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new StructureDraftError("draft-missing-field", `${field}[${index}] must be a non-empty string`);
    }
    return entry;
  });
}

function requireScope(value: unknown): StructureDraftDisclosureScope {
  if (typeof value !== "string" ||
      !(STRUCTURE_DRAFT_DISCLOSURE_SCOPES as readonly string[]).includes(value)) {
    throw new StructureDraftError(
      "draft-disclosure-scope-unknown",
      `disclosure.scope must be one of ${STRUCTURE_DRAFT_DISCLOSURE_SCOPES.join(", ")}`,
    );
  }
  return value as StructureDraftDisclosureScope;
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort(compareCodeUnit);
}

function validateTree(
  nodes: TreeCandidateNode[],
  allowedIds: Set<string>,
): TreeCandidateNode[] {
  const byId = new Map<string, TreeCandidateNode>();
  for (const node of nodes) {
    if (!allowedIds.has(node.id)) {
      throw new StructureDraftError(
        "draft-tree-unknown-node",
        `tree node ${node.id} is not an included card`,
      );
    }
    if (byId.has(node.id)) {
      throw new StructureDraftError("draft-tree-duplicate-node", `tree node ${node.id} appears twice`);
    }
    if (!Number.isSafeInteger(node.order) || node.order < 0) {
      throw new StructureDraftError(
        "draft-tree-invalid-order",
        `tree node ${node.id} must have a non-negative integer order`,
      );
    }
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentId === node.id) {
      throw new StructureDraftError("draft-tree-cycle", `tree node ${node.id} is its own parent`);
    }
    if (node.parentId !== null && !byId.has(node.parentId)) {
      throw new StructureDraftError(
        "draft-tree-unknown-parent",
        `tree node ${node.id} points at an unknown parent ${node.parentId}`,
      );
    }
  }
  // Cycle detection: walk each node's ancestors.
  for (const node of nodes) {
    const seen = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (seen.has(parentId)) {
        throw new StructureDraftError("draft-tree-cycle", `tree contains a cycle at ${parentId}`);
      }
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
  }
  return [...nodes].sort((left, right) => {
    if (left.parentId !== right.parentId) {
      return compareCodeUnit(left.parentId ?? "", right.parentId ?? "");
    }
    if (left.order !== right.order) return left.order - right.order;
    return compareCodeUnit(left.id, right.id);
  });
}

/**
 * 構造Draftを組み立てる。返す値は決定的で、同じ入力からは同じ
 * structureRevisionになる（Card本文の変更では変わらない）。
 */
export async function buildStructureDraft(
  input: BuildStructureDraftInput,
): Promise<StructureDraft> {
  const doc = input?.doc;
  if (!doc || !Array.isArray(doc.cards) || !Array.isArray(doc.islands) || !Array.isArray(doc.edges)) {
    throw new StructureDraftError("draft-invalid-document", "doc must be a DocumentV1");
  }
  if (!input.disclosure || typeof input.disclosure !== "object") {
    throw new StructureDraftError("draft-missing-disclosure", "disclosure must be stated explicitly");
  }
  const scope = requireScope(input.disclosure.scope);
  const audience = requireIdList(input.disclosure.audience, "disclosure.audience", false);
  const purpose = input.disclosure.purpose;
  if (typeof purpose !== "string" || purpose.trim().length === 0) {
    throw new StructureDraftError("draft-missing-field", "disclosure.purpose must be a non-empty string");
  }

  const includedCardIds = uniqueSorted(requireIdList(input.includedCardIds, "includedCardIds", false));
  const includedIslandIds = uniqueSorted(requireIdList(input.includedIslandIds, "includedIslandIds", true));
  const cardById = new Map(doc.cards.map((card) => [card.id, card]));
  const islandById = new Map(doc.islands.map((island) => [island.id, island]));

  for (const id of includedCardIds) {
    const card = cardById.get(id);
    if (!card) {
      throw new StructureDraftError("draft-unknown-card", `included card ${id} does not exist`);
    }
    // 未レビュー本文は外部へ出さない。選択そのものを拒否する。
    if (card.textReviewed !== true) {
      throw new StructureDraftError("draft-card-not-reviewed", `included card ${id} is not reviewed`);
    }
  }
  for (const id of includedIslandIds) {
    if (!islandById.has(id)) {
      throw new StructureDraftError("draft-unknown-island", `included island ${id} does not exist`);
    }
  }
  const cardSet = new Set(includedCardIds);
  const islandSet = new Set(includedIslandIds);

  const cards: StructureDraftCard[] = includedCardIds.map((id) => {
    const card = cardById.get(id)!;
    const held = typeof card.holdState === "string" && card.holdState.length > 0;
    return {
      id,
      // 保留中の本文は投影しない。hold状態そのものは構造として残す。
      text: held ? null : card.text,
      holdState: held ? card.holdState! : null,
    };
  });

  const canvas = {
    cards: includedCardIds.map((id) => {
      const card = cardById.get(id)!;
      return { id, x: card.x, y: card.y };
    }),
  };

  const islands = includedIslandIds.map((id) => {
    const island = islandById.get(id)!;
    const titleReviewed = island.titleReviewed === true;
    return {
      id,
      // 未レビューの題名は出さない。
      title: titleReviewed && typeof island.title === "string" ? island.title : null,
      titleReviewed,
      cardIds: uniqueSorted(island.cardIds.filter((cardId) => cardSet.has(cardId))),
      parentIslandId:
        typeof island.parentIslandId === "string" && islandSet.has(island.parentIslandId)
          ? island.parentIslandId
          : null,
    };
  });

  const affiliations = (doc.affiliations ?? [])
    .filter((entry) => cardSet.has(entry.cardId) && islandSet.has(entry.islandId))
    .map((entry) => ({ cardId: entry.cardId, islandId: entry.islandId }))
    .sort((left, right) =>
      compareCodeUnit(left.cardId, right.cardId) || compareCodeUnit(left.islandId, right.islandId));

  const relations: StructureDraft["relations"] = [];
  const contradictions: StructureDraft["contradictions"] = [];
  for (const edge of doc.edges) {
    const fromKind = edge.fromKind ?? "card";
    const toKind = edge.toKind ?? "card";
    const fromIncluded = fromKind === "card" ? cardSet.has(edge.fromId) : islandSet.has(edge.fromId);
    const toIncluded = toKind === "card" ? cardSet.has(edge.toId) : islandSet.has(edge.toId);
    if (!fromIncluded || !toIncluded) continue;
    // Edgeの型は保存する。未知の型をrelatedへ読み替えない。
    relations.push({
      fromId: edge.fromId,
      toId: edge.toId,
      type: edge.type,
      directed: edge.type === "causal",
    });
    if (edge.type === "negate") {
      contradictions.push({ fromId: edge.fromId, toId: edge.toId });
    }
  }
  relations.sort((left, right) =>
    compareCodeUnit(left.fromId, right.fromId) ||
    compareCodeUnit(left.toId, right.toId) ||
    compareCodeUnit(left.type, right.type));
  contradictions.sort((left, right) =>
    compareCodeUnit(left.fromId, right.fromId) || compareCodeUnit(left.toId, right.toId));

  const holds = cards
    .filter((card) => card.holdState !== null)
    .map((card) => ({ cardId: card.id, state: card.holdState! }))
    .sort((left, right) => compareCodeUnit(left.cardId, right.cardId));

  // Voidのtitle/detailはCard本文を引用し得るため含めない。選択範囲に
  // 紐づく空白だけを、種別と解決状態で残す。
  const voids = (doc.voids ?? [])
    .filter((entry) => {
      const refs = [...(entry.cardIds ?? []), ...(entry.islandIds ?? [])];
      return refs.some((ref) => cardSet.has(ref) || islandSet.has(ref));
    })
    .map((entry) => ({
      kind: entry.kind,
      subject: null,
      resolved: entry.resolved === true,
    }))
    .sort((left, right) =>
      compareCodeUnit(left.kind, right.kind) || Number(left.resolved) - Number(right.resolved));

  const sourceRefs: Array<{ cardId: string; source: string; verified: false }> = [];
  for (const id of includedCardIds) {
    const source = cardById.get(id)!.meta?.source;
    if (typeof source === "string" && source.length > 0) {
      sourceRefs.push({ cardId: id, source, verified: false });
    }
  }

  const treeCandidate = input.treeCandidate ?? null;
  const treeProvided = Array.isArray(treeCandidate);
  const treeNodes = treeProvided
    ? validateTree(treeCandidate!, cardSet)
    : [];
  const treeIds = new Set(treeNodes.map((node) => node.id));
  const unclassified = treeProvided ? includedCardIds.filter((id) => !treeIds.has(id)) : includedCardIds;

  // 複数所属: Island.cardIds と affiliations を (card, island) 単位で
  // 重複除去してから数える。同じ所属を二重に数えない。
  const membershipPairs = new Set<string>();
  for (const island of islands) {
    for (const cardId of island.cardIds) {
      membershipPairs.add(cardId + "\u0000" + island.id);
    }
  }
  for (const entry of affiliations) {
    membershipPairs.add(entry.cardId + "\u0000" + entry.islandId);
  }
  const islandsPerCard = new Map<string, Set<string>>();
  for (const pair of membershipPairs) {
    const separator = pair.indexOf("\u0000");
    const cardId = pair.slice(0, separator);
    const islandId = pair.slice(separator + 1);
    const set = islandsPerCard.get(cardId) ?? new Set<string>();
    set.add(islandId);
    islandsPerCard.set(cardId, set);
  }
  const multiAffiliated = [...islandsPerCard.entries()]
    .filter(([, islandIds]) => islandIds.size > 1)
    .map(([id]) => id);

  const loss: StructureDraftLoss[] = [];
  const addLoss = (kind: StructureDraftLossKind, subject: string, reason: string) => {
    loss.push({ id: `loss-${loss.length + 1}`, kind, subject, reason, recoverable: true });
  };
  addLoss(
    "canvas-coordinates",
    "structure",
    "Canvas座標は文章へ投影しない。元の配置はSUIに残る。",
  );
  addLoss(
    "tree-candidate",
    "tree",
    "Treeは候補overlayであり、DocumentV1の親子構造として永続化されていない。",
  );
  if (multiAffiliated.length > 0) {
    addLoss(
      "multiple-affiliation",
      uniqueSorted(multiAffiliated).join(","),
      "複数Island所属は1つの見出しへ還元できない。所属一覧として残す。",
    );
  }
  if (relations.length > 0) {
    addLoss(
      "non-hierarchical-relation",
      "relations",
      "非階層Relationは親子見出しへ変換しない。型付きの関係一覧として残す。",
    );
  }
  if (contradictions.length > 0) {
    addLoss(
      "contradiction",
      "contradictions",
      "矛盾は本文へ混ぜず独立節に残す。",
    );
  }
  if (holds.length > 0) {
    addLoss(
      "hold",
      "holds",
      "保留中のCardは本文を投影せず、保留として列挙する。",
    );
  }
  if (voids.length > 0 || unclassified.length > 0) {
    addLoss(
      "unresolved",
      "voids,tree",
      "未解決の空白・Tree未分類は解消せず、未解決として残す。",
    );
  }
  if (sourceRefs.length > 0) {
    addLoss(
      "source-unverified",
      "sourceRefs",
      "Card.meta.sourceは自由記述であり、照合済み出典として扱わない。",
    );
  }

  // structureRevisionの入力。Card本文・開示Scope・lossは含めない。
  // 構造が変わらない限り、本文の推敲でRevisionを進めない。
  const revisionInput = {
    schema: STRUCTURE_DRAFT_SCHEMA,
    tree: { source: "candidate-overlay", provided: treeProvided, nodes: treeNodes },
    cards: cards.map((card) => ({ id: card.id, holdState: card.holdState })),
    canvas,
    islands,
    affiliations,
    relations,
    holds,
    contradictions,
    voids,
    sourceRefs,
  };
  const structureRevision = await sha256Hex(canonicalizeJson(revisionInput));

  return {
    schema: STRUCTURE_DRAFT_SCHEMA,
    structureRevision,
    tree: { source: "candidate-overlay", provided: treeProvided, nodes: treeNodes },
    cards,
    canvas,
    islands,
    affiliations,
    relations,
    holds,
    contradictions,
    voids,
    sourceRefs,
    disclosure: {
      scope,
      audience,
      purpose,
      includedCardIds,
      includedIslandIds,
    },
    loss,
    coverage: {
      structurePersistedToDocumentV1: false,
      treeIsCandidateOverlay: true,
      canvasCoordinatesProjectedToProse: false,
      unreviewedIncluded: false,
      hiddenCountsIncluded: false,
      networkUsed: false,
      aiUsed: false,
    },
  };
}
