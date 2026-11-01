import { describe, expect, it } from "vitest";

import {
  EPISTEMIC_OUTBOX_KEY,
  EPISTEMIC_OUTBOX_LIMIT,
  appendEpistemicOutbox,
  clearEpistemicOutbox,
  loadEpistemicOutbox,
} from "./epistemic_review_outbox";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function entry(assertionId: string, docId = "doc-1") {
  return {
    docId,
    recordedAt: "2026-11-01T00:00:00.000Z",
    intent: {
      assertionId,
      kind: "review-event",
      operation: "confirm",
      expectedMeaningFingerprint: `sha256:${"a".repeat(64)}`,
    },
  };
}

describe("epistemic review outbox", () => {
  it("stores only bounded intent bindings and reloads them", () => {
    const storage = memoryStorage();

    appendEpistemicOutbox(entry("a1"), storage);
    const loaded = appendEpistemicOutbox(entry("a2"), storage);

    expect(loaded.map((item) => item.intent.assertionId)).toEqual(["a1", "a2"]);
    expect(storage.getItem(EPISTEMIC_OUTBOX_KEY)).toContain("sha256:");
  });

  it("drops malformed entries and keeps the newest bounded set", () => {
    const storage = memoryStorage({
      [EPISTEMIC_OUTBOX_KEY]: JSON.stringify([
        { docId: "", recordedAt: "t", intent: { assertionId: "bad" } },
        { docId: "doc", recordedAt: "t", intent: { assertionId: "ok" } },
      ]),
    });

    expect(loadEpistemicOutbox(storage)).toHaveLength(1);

    for (let index = 0; index < EPISTEMIC_OUTBOX_LIMIT + 5; index += 1) {
      appendEpistemicOutbox(entry(`a${index}`), storage);
    }
    const loaded = loadEpistemicOutbox(storage);
    expect(loaded).toHaveLength(EPISTEMIC_OUTBOX_LIMIT);
    expect(loaded[loaded.length - 1].intent.assertionId).toBe(
      `a${EPISTEMIC_OUTBOX_LIMIT + 4}`,
    );
  });

  it("drops fields outside the handoff allowlist", () => {
    const storage = memoryStorage();
    const unsafe = {
      ...entry("a1"),
      intent: {
        ...entry("a1").intent,
        cardText: "secret source text",
        narrative: "secret narrative",
      },
    };

    appendEpistemicOutbox(unsafe, storage);
    const [loaded] = loadEpistemicOutbox(storage);

    expect(loaded.intent.assertionId).toBe("a1");
    expect(loaded.intent).not.toHaveProperty("cardText");
    expect(loaded.intent).not.toHaveProperty("narrative");
  });

  it("rejects tampered intent bindings instead of storing them", () => {
    const base = entry("a1");

    for (const intent of [
      { ...base.intent, expectedMeaningFingerprint: "not-a-fingerprint" },
      { ...base.intent, kind: "unknown-kind" },
      { ...base.intent, operation: "delete" },
      { ...base.intent, expectedReviewLogSequence: -1 },
      { ...base.intent, expectedTargetBinding: "elsewhere" },
    ]) {
      const storage = memoryStorage();
      appendEpistemicOutbox({ ...base, intent }, storage);
      expect(loadEpistemicOutbox(storage)).toEqual([]);
    }
  });

  it("clears the outbox and tolerates unavailable storage", () => {
    const storage = memoryStorage();
    appendEpistemicOutbox(entry("a1"), storage);
    clearEpistemicOutbox(storage);
    expect(loadEpistemicOutbox(storage)).toEqual([]);
    expect(loadEpistemicOutbox(null)).toEqual([]);
    expect(appendEpistemicOutbox(entry("a1"), null)).toEqual([]);
  });
});
