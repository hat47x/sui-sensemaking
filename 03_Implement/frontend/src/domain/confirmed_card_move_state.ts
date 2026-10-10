import type { DocumentV1 } from "./types";

/**
 * The native SUI Canvas owns history, dirty state and DocumentV1. The
 * TEI Action transport never sees or creates this state.
 */
export type ConfirmedCardMoveHistory = Readonly<{
  past: readonly DocumentV1[];
  present: DocumentV1;
  future: readonly DocumentV1[];
}>;

export type ConfirmedCardMoveState = Readonly<{
  history: { past: DocumentV1[]; present: DocumentV1; future: DocumentV1[] };
  etag: string;
  isDirty: false;
}>;

/**
 * Pure planning step for a future React owner. This deliberately does NOT
 * call setState: scheduling multiple React setters is NOT an atomic compare
 * and apply. The caller must revalidate the live refs and install the plan
 * in a single synchronous owner-controlled operation.
 *
 * A previously server-saved Document remains Undo-able. Undo afterwards is
 * a *new local unsaved edit* against the newly confirmed ETag; it is not a
 * rollback of the already committed server Action.
 */
export function planConfirmedCardMoveState(
  args: Readonly<{
    origin: Readonly<{ document: DocumentV1; etag: string }>;
    history: ConfirmedCardMoveHistory | null;
    currentEtag: string | null;
    isDirty: boolean;
    isReadOnly: boolean;
    isSaving: boolean;
    isTenantSessionCurrent: boolean;
    isPendingDrag: boolean;
    confirmed: Readonly<{ document: DocumentV1; etag: string }>;
    historyLimit?: number;
  }>,
): ConfirmedCardMoveState | null {
  const {
    origin, history, currentEtag, isDirty, isReadOnly, isSaving,
    isTenantSessionCurrent, isPendingDrag, confirmed,
  } = args;
  if (!history || !origin || !confirmed ||
      !origin.document || !confirmed.document ||
      history.present !== origin.document ||
      origin.document.version !== 1 || confirmed.document.version !== 1 ||
      !origin.document.id || origin.document.id !== confirmed.document.id ||
      typeof origin.etag !== "string" || !origin.etag ||
      currentEtag !== origin.etag ||
      typeof confirmed.etag !== "string" || !confirmed.etag ||
      confirmed.etag === currentEtag ||
      isDirty || isReadOnly || isSaving || !isTenantSessionCurrent ||
      isPendingDrag) {
    return null;
  }
  const limit = args.historyLimit ?? 50; // Matches App.tsx HISTORY_LIMIT.
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      !Array.isArray(history.past) || !Array.isArray(history.future)) {
    return null;
  }

  // SUI's ordinary pushHistorySnapshot truncates past and clears future;
  // use the same semantics but do not mark a *server-committed* edit dirty.
  const past = [...history.past, structuredClone(history.present)];
  return {
    history: {
      past: past.length > limit ? past.slice(past.length - limit) : past,
      present: structuredClone(confirmed.document),
      future: [],
    },
    etag: confirmed.etag,
    isDirty: false,
  };
}
