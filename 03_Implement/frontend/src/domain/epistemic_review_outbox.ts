const STORAGE_KEY = "sui.epistemicReviewOutbox.v1";
const MAX_ENTRIES = 50;

export type EpistemicOutboxEntry = {
  docId: string;
  recordedAt: string;
  intent: Record<string, unknown>;
};

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const ALLOWED_INTENT_FIELDS = [
  "assertionId",
  "source",
  "kind",
  "operation",
  "statementKind",
  "expectedMeaningFingerprint",
  "expectedReviewSubjectFingerprint",
  "expectedTargetBinding",
  "expectedReviewLogSequence",
] as const;

const INTENT_KINDS = new Set(["review-event", "classification-change", "review-request"]);
const INTENT_OPERATIONS = new Set(["confirm", "reject", "withdraw"]);
const TARGET_BINDINGS = new Set([
  "not-required",
  "exact",
  "reanchored",
  "ambiguous",
  "detached",
]);
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isValidIntent(intent: Record<string, unknown>): boolean {
  if (typeof intent.assertionId !== "string" || intent.assertionId.trim().length === 0) {
    return false;
  }
  if (intent.source !== undefined && intent.source !== "human-ui") {
    return false;
  }
  if (intent.kind !== undefined && !INTENT_KINDS.has(intent.kind as string)) {
    return false;
  }
  if (intent.operation !== undefined && !INTENT_OPERATIONS.has(intent.operation as string)) {
    return false;
  }
  if (intent.statementKind !== undefined && intent.statementKind !== "hypothesis") {
    return false;
  }
  if (
    intent.expectedMeaningFingerprint !== undefined
    && !SHA256_PATTERN.test(String(intent.expectedMeaningFingerprint))
  ) {
    return false;
  }
  if (
    intent.expectedReviewSubjectFingerprint !== undefined
    && !SHA256_PATTERN.test(String(intent.expectedReviewSubjectFingerprint))
  ) {
    return false;
  }
  if (
    intent.expectedTargetBinding !== undefined
    && !TARGET_BINDINGS.has(intent.expectedTargetBinding as string)
  ) {
    return false;
  }
  if (
    intent.expectedReviewLogSequence !== undefined
    && (
      typeof intent.expectedReviewLogSequence !== "number"
      || !Number.isInteger(intent.expectedReviewLogSequence)
      || intent.expectedReviewLogSequence < 0
    )
  ) {
    return false;
  }
  return true;
}

function sanitizeEntry(value: unknown): EpistemicOutboxEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const { docId, recordedAt, intent } = value;
  if (typeof docId !== "string" || docId.trim().length === 0) {
    return null;
  }
  if (typeof recordedAt !== "string" || recordedAt.trim().length === 0) {
    return null;
  }
  if (!isRecord(intent) || !isValidIntent(intent)) {
    return null;
  }
  const sanitizedIntent: Record<string, unknown> = {};
  for (const field of ALLOWED_INTENT_FIELDS) {
    if (intent[field] !== undefined) {
      sanitizedIntent[field] = intent[field];
    }
  }
  return {
    docId,
    recordedAt,
    intent: sanitizedIntent,
  };
}

/**
 * Local handoff outbox for TEI review intents.
 *
 * This is a PoC persistence boundary: it keeps the generated intent binding so
 * a later TEI handoff does not lose it, but it never writes to DocumentV1,
 * ReviewEvent, or `human_reviewed`. Only identifiers/fingerprints are stored;
 * card text and narrative content are not.
 */
export function loadEpistemicOutbox(storage: StorageLike | null = defaultStorage()): EpistemicOutboxEntry[] {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => sanitizeEntry(entry))
      .filter((entry): entry is EpistemicOutboxEntry => Boolean(entry))
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function appendEpistemicOutbox(
  entry: EpistemicOutboxEntry,
  storage: StorageLike | null = defaultStorage(),
): EpistemicOutboxEntry[] {
  if (!storage) {
    return [];
  }
  const sanitized = sanitizeEntry(entry);
  if (!sanitized) {
    return loadEpistemicOutbox(storage);
  }
  const next = [...loadEpistemicOutbox(storage), sanitized].slice(-MAX_ENTRIES);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    return loadEpistemicOutbox(storage);
  }
  return next;
}

export function clearEpistemicOutbox(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Local storage can be unavailable in private/incognito contexts.
  }
}

export const EPISTEMIC_OUTBOX_KEY = STORAGE_KEY;
export const EPISTEMIC_OUTBOX_LIMIT = MAX_ENTRIES;
