import type { DocumentV1, StructureDecisionAction, StructureDecisionRecord } from "./types";
import { updateCardHoldStateAndShelf, type HoldStateSelection } from "./hold_state_ops";

const DEFAULT_STRUCTURE_HISTORY_LIMIT = 100;

export type AppendStructureDecisionInput = {
  action: StructureDecisionAction;
  islandId?: string;
  cardIds: string[];
  fromValue?: string | null;
  toValue?: string | null;
  rationale?: string;
};

export type AppendStructureDecisionOptions = {
  createdAt?: string;
  historyLimit?: number;
  id?: string;
};

function createDecisionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `structure-decision-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeRationale(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Append one structure decision. Only the four actions named in Issue #3239
 * are recorded; ordinary UI actions stay out of this list.
 */
export function appendStructureDecision(
  document: DocumentV1,
  input: AppendStructureDecisionInput,
  options: AppendStructureDecisionOptions = {}
): DocumentV1 {
  const record: StructureDecisionRecord = {
    id: options.id ?? createDecisionId(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    action: input.action,
    ...(input.islandId !== undefined ? { islandId: input.islandId } : {}),
    cardIds: [...new Set(input.cardIds)],
    ...(input.fromValue !== undefined ? { fromValue: input.fromValue } : {}),
    ...(input.toValue !== undefined ? { toValue: input.toValue } : {}),
    ...(normalizeRationale(input.rationale) !== undefined
      ? { rationale: normalizeRationale(input.rationale) }
      : {}),
  };

  const historyLimit = options.historyLimit ?? DEFAULT_STRUCTURE_HISTORY_LIMIT;
  const next = [...(document.structureDecisions ?? []), record];
  const trimmed = next.length > historyLimit ? next.slice(next.length - historyLimit) : next;

  return { ...document, structureDecisions: trimmed };
}

/** Attach or clear a human rationale after the fact. */
export function updateStructureDecisionRationale(
  document: DocumentV1,
  decisionId: string,
  rawRationale: string
): DocumentV1 {
  const rationale = normalizeRationale(rawRationale);
  let changed = false;

  const next = (document.structureDecisions ?? []).map((record) => {
    if (record.id !== decisionId) {
      return record;
    }

    if ((record.rationale ?? undefined) === rationale) {
      return record;
    }

    changed = true;
    if (rationale === undefined) {
      const { rationale: _removed, ...rest } = record;
      return rest;
    }
    return { ...record, rationale };
  });

  return changed ? { ...document, structureDecisions: next } : document;
}

const RESTORABLE_HOLD_STATES = new Set<HoldStateSelection>(["active", "held", "pending", "shelved"]);

export function restorableHoldState(record: StructureDecisionRecord): HoldStateSelection | undefined {
  if (record.action !== "hold_state_changed" || !record.toValue) {
    return undefined;
  }
  return RESTORABLE_HOLD_STATES.has(record.toValue as HoldStateSelection)
    ? (record.toValue as HoldStateSelection)
    : undefined;
}

/**
 * Restore the hold state recorded as `toValue` for a `hold_state_changed`
 * decision. This is a manual, single-document change: it does not rewrite the
 * decision history or restore island membership.
 */
export function restoreStructureDecisionHoldState(
  document: DocumentV1,
  decisionId: string,
  restoredAt: string = new Date().toISOString()
): DocumentV1 {
  const record = (document.structureDecisions ?? []).find((entry) => entry.id === decisionId);
  const target = record ? restorableHoldState(record) : undefined;
  if (!record || target === undefined) {
    return document;
  }

  let next = document;
  for (const cardId of record.cardIds) {
    next = updateCardHoldStateAndShelf(next, cardId, target, restoredAt);
  }
  return next;
}

export function structureDecisionsForTarget(
  document: DocumentV1,
  target: { islandId?: string; cardId?: string }
): StructureDecisionRecord[] {
  return (document.structureDecisions ?? []).filter((record) => {
    if (target.islandId !== undefined && record.islandId === target.islandId) {
      return true;
    }
    if (target.cardId !== undefined && record.cardIds.includes(target.cardId)) {
      return true;
    }
    return false;
  });
}
