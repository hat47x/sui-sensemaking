import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentV1 } from "../domain/types";
import {
  commitSuiCardMoveAction,
  getAuthoritativeDocument,
} from "./client";
import { createSuiCardMoveActionCommit } from "./tei_card_move_action";

const originalRevision = "a".repeat(64);
const committedRevision = "b".repeat(64);
const tenantSessionContext = {
  principalId: "user-1",
  activeTenant: { id: "tenant-a", displayName: "Tenant A" },
  availableTenants: [{ id: "tenant-a", displayName: "Tenant A" }],
  effectiveCapabilities: ["document.read" as const, "document.write" as const],
  capabilityVersion: "capability-v7",
  tenantSessionVersion: "session-v1",
};

function source(): DocumentV1 {
  return {
    version: 1, id: "doc-a", title: "Do not lose provenance",
    createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "a", text: "original", x: 0, y: 0, holdState: "held", meta: { source: "interview" } },
      { id: "b", text: "another", x: 400, y: 0 },
    ],
    islands: [{ id: "old", cardIds: ["a"] }, { id: "new", cardIds: ["b"] }],
    edges: [{ id: "edge", fromId: "a", toId: "b", type: "future-kind" }],
  };
}

function moved(document: DocumentV1): DocumentV1 {
  return {
    ...document,
    cards: document.cards.map((card) =>
      card.id === "a" ? { ...card, x: 400 } : card,
    ),
    islands: document.islands.map((island) =>
      island.id === "old"
        ? { ...island, cardIds: [] }
        : island.id === "new"
          ? { ...island, cardIds: ["b", "a"] }
          : island,
    ),
  };
}

describe("SUI Action ports with actual authenticated client transport", () => {
  afterEach(() => vi.restoreAllMocks());

  it("POSTs once, GETs no-store, and synchronously confirms matching revision and document", async () => {
    const initial = source();
    const next = moved(initial);
    const readback = structuredClone(next);
    readback.updatedAt = "2026-10-10T12:00:00Z";
    readback.islands[0].collapsed = false; // Pydantic materializes default
    readback.islands[1].collapsed = false;
    let present = initial;
    let etag = originalRevision;
    let applied = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ protocolVersion: "1", revision: committedRevision }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify(readback), {
        status: 200, headers: {
          "ETag": `"${committedRevision}"`,
          "Content-Type": "application/json",
        },
      }));

    const origin = { document: initial, etag: originalRevision };
    const run = createSuiCardMoveActionCommit({
      dispatch: (intent) => commitSuiCardMoveAction(intent, { tenantSessionContext }),
      readDocument: async (id) => {
        const loaded = await getAuthoritativeDocument(id, { tenantSessionContext });
        if (loaded.document.version !== 1) throw new Error("unexpected version");
        return { document: loaded.document as DocumentV1, etag: loaded.etag };
      },
      isCurrent: (value) => value.document === present && value.etag === etag,
      applyConfirmed: (value) => {
        if (present !== initial || etag !== originalRevision) return false;
        present = value.document;
        etag = value.etag;
        applied++;
        return true;
      },
    });

    await expect(run(origin, next, "a")).resolves.toBe(committedRevision);
    expect(applied).toBe(1);
    expect(present.cards[0].x).toBe(400);
    expect(present.cards[0].meta?.source).toBe("interview");
    expect(etag).toBe(committedRevision);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/docs/doc-a/action-commit");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/docs/doc-a");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      cache: "no-store", headers: {
        "Sui-Sensemaking-Tenant-Session-Version": "session-v1",
      },
    });
  });

  it("does not apply a newer server revision over a locally edited snapshot", async () => {
    const initial = source();
    const next = moved(initial);
    let present = initial;
    let applied = 0;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ protocolVersion: "1", revision: committedRevision }),
        { status: 200 },
      ))
      .mockImplementationOnce(async () => {
        present = { ...initial, title: "locally changed during readback" };
        return new Response(JSON.stringify(next), {
          status: 200, headers: { ETag: `"${committedRevision}"` },
        });
      });
    const run = createSuiCardMoveActionCommit({
      dispatch: (intent) => commitSuiCardMoveAction(intent, { tenantSessionContext }),
      readDocument: async (id) => {
        const loaded = await getAuthoritativeDocument(id, { tenantSessionContext });
        if (loaded.document.version !== 1) throw Error("version");
        return { document: loaded.document as DocumentV1, etag: loaded.etag };
      },
      isCurrent: ({ document, etag }) =>
        document === present && etag === originalRevision,
      applyConfirmed: () => { applied++; return true; },
    });
    await expect(run({ document: initial, etag: originalRevision }, next, "a"))
      .rejects.toMatchObject({
        code: "local_state_changed", committedRevision,
      });
    expect(applied).toBe(0);
  });
});
