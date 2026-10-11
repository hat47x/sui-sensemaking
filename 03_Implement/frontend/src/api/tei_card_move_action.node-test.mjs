import assert from "node:assert/strict";
import { test } from "node:test";
import { createSuiCardMoveActionCommit, observeSuiCardMoveAfterUnknownCommit, SuiCardMoveActionError } from "./tei_card_move_action.ts";

const source = () => ({
  version: 1, id: "doc", transform: { panX: 0, panY: 0, zoom: 1 },
  createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z",
  cards: [
    { id: "a", x: 0, y: 0, text: "first", holdState: "held", meta: { source: "interview" } },
    { id: "b", x: 400, y: 0, text: "second", textReviewed: true },
  ],
  islands: [{ id: "old", cardIds: ["a"] }, { id: "new", cardIds: ["b"] }],
  edges: [{ id: "e", fromId: "a", toId: "b", type: "future-kind" }],
  reviewAttribution: { schemaVersion: "1.0.0", reviewerRef: "human:1" },
  // Non-containment affiliation must not duplicate visual containment.
  affiliations: [{ id: "aff", cardId: "b", islandId: "old" }],
});
const moved = (document) => {
  const next = structuredClone(document);
  next.cards[0].x = 400;
  next.islands[0].cardIds = [];
  next.islands[1].cardIds.push("a");
  return next;
};
function fixture(overrides = {}) {
  const before = source(), next = moved(before);
  const origin = { document: before, etag: "etag-r1" };
  let writes = 0, reads = 0, applied = 0, current = true, result = null;
  let intent = null;
  const ports = {
    dispatch: async (value) => { writes++; intent = value; return "etag-r2"; },
    readDocument: async () => { reads++; return { document: structuredClone(next), etag: "etag-r2" }; },
    isCurrent: () => current,
    applyConfirmed: (value) => { applied++; result = value; return true; },
    ...overrides,
  };
  const run = createSuiCardMoveActionCommit(ports);
  return { origin, next, run, setCurrent(v) { current = v; }, get state() { return { writes, reads, applied, result, intent }; } };
}
const isError = (code, revision = null) => (error) =>
  error instanceof SuiCardMoveActionError && error.code === code && error.committedRevision === revision;

test("ambiguous-commit observer sees convergence but never proves actor attribution", async () => {
  const f = fixture();
  let requests = 0;
  const result = await observeSuiCardMoveAfterUnknownCommit(
    f.origin, f.next, "a",
    async (id) => {
      assert.equal(id, "doc");
      requests++;
      return { document: structuredClone(f.next), etag: "etag-r2" };
    },
  );
  assert.equal(result.status, "converged");
  assert.equal(result.readback.etag, "etag-r2");
  assert.equal(requests, 1);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.applied, 0);
});

test("ambiguous-commit observer distinguishes unchanged from divergent state", async () => {
  const f = fixture();
  const unchanged = await observeSuiCardMoveAfterUnknownCommit(
    f.origin, f.next, "a",
    async () => ({ document: structuredClone(f.origin.document), etag: "etag-r1" }),
  );
  assert.equal(unchanged.status, "unchanged");

  const anotherMove = moved(source());
  anotherMove.cards[0].x = 600;
  const changed = await observeSuiCardMoveAfterUnknownCommit(
    f.origin, f.next, "a",
    async () => ({ document: anotherMove, etag: "etag-r3" }),
  );
  assert.equal(changed.status, "diverged");
  assert.equal(f.state.applied, 0);
});

test("ambiguous-commit observer cannot mistake inconsistent ETag for convergence", async () => {
  const f = fixture();
  const value = await observeSuiCardMoveAfterUnknownCommit(
    f.origin, f.next, "a",
    async () => ({ document: structuredClone(f.next), etag: "etag-r1" }),
  );
  assert.equal(value.status, "diverged");
});

test("ambiguous-commit observer never writes or retries when readback fails", async () => {
  const f = fixture();
  const results = await Promise.all([
    observeSuiCardMoveAfterUnknownCommit(
      f.origin, f.next, "a", async () => { throw Error("offline"); },
    ),
    observeSuiCardMoveAfterUnknownCommit(
      f.origin, f.next, "a", async () => ({ document: null, etag: null }),
    ),
    observeSuiCardMoveAfterUnknownCommit(
      f.origin, f.next, "a", async () => {
        const corrupted = moved(source());
        Object.defineProperty(corrupted.cards[1], "text", {
          enumerable: true, get() { throw Error("corrupt"); },
        });
        return { document: corrupted, etag: "etag-r2" };
      },
    ),
  ]);
  for (const result of results) assert.equal(result.status, "unresolved");
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.applied, 0);
});

test("ambiguous-commit observer rejects invalid local move before any GET", async () => {
  const f = fixture();
  const corrupted = structuredClone(f.next);
  corrupted.edges[0].type = "lost-provenance";
  let reads = 0;
  const result = await observeSuiCardMoveAfterUnknownCommit(
    f.origin, corrupted, "a", async () => {
      reads++;
      return { document: f.next, etag: "etag-r2" };
    },
  );
  assert.equal(result.status, "unresolved");
  assert.equal(reads, 0);
});

test("uses v1 SUI Action envelope and restores authoritative Document and ETag", async () => {
  const f = fixture();
  assert.equal(await f.run(f.origin, f.next, "a"), "etag-r2");
  assert.deepEqual(f.state.intent, {
    protocolVersion: "1", applicationID: "sui", resourceID: "doc",
    actionID: "sui.move", expectedRevision: "etag-r1",
    payload: { cardId: "a", x: 400, y: 0 },
  });
  assert.equal(f.state.applied, 1);
  assert.deepEqual(f.state.result.document.edges, f.origin.document.edges);
  assert.deepEqual(f.state.result.document.affiliations, f.origin.document.affiliations);
  assert.deepEqual(f.state.result.document.reviewAttribution, f.origin.document.reviewAttribution);
  assert.equal(f.state.result.document.cards[0].meta.source, "interview");
  assert.equal(f.state.result.document.cards[0].holdState, "held");
  assert.deepEqual(f.state.result.document.islands[1].cardIds, ["b", "a"]);
  assert.equal(f.state.result.etag, "etag-r2");
});

test("malformed post-commit document preserves the acknowledged revision", async () => {
  const f = fixture({
    readDocument: async () => {
      const doc = moved(source());
      // The readback port is an integration boundary and cannot be trusted
      // to always return a well-formed DocumentV1 at runtime.
      Object.defineProperty(doc.cards[1], "text", {
        enumerable: true,
        get() { throw Error("invalid server document"); },
      });
      return { document: doc, etag: "etag-r2" };
    },
  });
  await assert.rejects(
    f.run(f.origin, f.next, "a"),
    isError("invalid_readback", "etag-r2"),
  );
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.applied, 0);
});

test("malformed local snapshot is rejected before any network write", async () => {
  for (const modify of [
    (doc) => { doc.cards[0] = null; },
    (doc) => { doc.islands[0] = null; },
    (doc) => { doc.islands[0].cardIds = null; },
    (doc) => { doc.cards = null; },
  ]) {
    const f = fixture();
    const invalid = structuredClone(f.next);
    modify(invalid);
    await assert.rejects(f.run(f.origin, invalid, "a"), isError("invalid_move_target"));
    assert.equal(f.state.writes, 0);
  }
});

test("refuses successful-revision readback that silently drops provenance", async () => {
  for (const damage of [
    (doc) => { doc.edges[0].type = "related"; },
    (doc) => { doc.cards[0].meta.source = "lost"; },
    (doc) => { delete doc.cards[0].holdState; },
    (doc) => { doc.reviewAttribution.reviewerRef = "other-reviewer"; },
    (doc) => { doc.affiliations = []; },
    (doc) => { doc.cards[1].text = "different"; },
  ]) {
    const f = fixture({
      readDocument: async () => {
        const doc = moved(source());
        damage(doc);
        return { document: doc, etag: "etag-r2" };
      },
    });
    await assert.rejects(f.run(f.origin, f.next, "a"), isError("readback_document_mismatch", "etag-r2"));
    assert.equal(f.state.applied, 0);
  }
});

test("accepts null-vs-missing optional fields and backend-owned updatedAt", async () => {
  const f = fixture({
    readDocument: async () => {
      const doc = moved(source());
      doc.updatedAt = "2026-10-10T09:00:00Z";
      doc.cards[0].critique = null;
      doc.islands[0].title = null;
      return { document: doc, etag: "etag-r2" };
    },
  });
  assert.equal(await f.run(f.origin, f.next, "a"), "etag-r2");
  assert.equal(f.state.applied, 1);
});

test("accepts Pydantic's documented Island defaults and geometry mirrors", async () => {
  const f = fixture({
    readDocument: async () => {
      const doc = moved(source());
      // Island.collapsed is explicit in Pydantic output, unlike many
      // legitimate preexisting browser Documents.
      doc.islands.forEach((island) => { island.collapsed = false; });
      // SUI's Island.normalize_geometry_shape creates the missing mirror.
      doc.islands[1].geometry = { type: "rect" };
      doc.islands[1].shape = { kind: "rect" };
      return { document: doc, etag: "etag-r2" };
    },
  });
  // Geometry must already belong to the drag origin: a move alone cannot
  // silently introduce or replace an Island's shape.
  f.origin.document.islands[1].shape = { kind: "rect" };
  f.next.islands[1].shape = { kind: "rect" };
  assert.equal(await f.run(f.origin, f.next, "a"), "etag-r2");
});

test("normalizes Pydantic's polygon mirror but rejects divergent geometry", async () => {
  const polygon = [{ x: 100, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }];
  const expected = moved(source());
  expected.islands[1].shape = { kind: "polygon", points: polygon };
  const readDocument = async () => {
    const doc = structuredClone(expected);
    doc.islands[1].geometry = { type: "polygon", points: structuredClone(polygon) };
    return { document: doc, etag: "etag-r2" };
  };
  const f = fixture({ readDocument });
  f.origin.document.islands[1].shape = structuredClone(expected.islands[1].shape);
  assert.equal(await f.run(f.origin, expected, "a"), "etag-r2");

  const damaged = fixture({
    readDocument: async () => {
      const doc = await readDocument();
      doc.document.islands[1].geometry.points[0].x += 1;
      return doc;
    },
  });
  damaged.origin.document.islands[1].shape = structuredClone(expected.islands[1].shape);
  await assert.rejects(
    damaged.run(damaged.origin, expected, "a"),
    isError("readback_document_mismatch", "etag-r2"),
  );
  assert.equal(damaged.state.applied, 0);
});

test("rejects a proposed move that changes unrelated state BEFORE remote dispatch", async () => {
  const mutate = [
    (doc) => { doc.cards[0].meta.source = "silently lost"; },
    (doc) => { doc.cards[0].holdState = "shelved"; },
    (doc) => { doc.cards[1].text = "replaced"; },
    (doc) => { doc.cards.reverse(); },
    (doc) => { doc.edges[0].type = "invented"; },
    (doc) => { doc.reviewAttribution.reviewerRef = "someone else"; },
    (doc) => { doc.affiliations = []; },
    (doc) => { doc.islands[0].title = "new title"; },
    (doc) => { doc.islands[1].cardIds.push("other"); },
    (doc) => { doc.title = "covert change"; },
  ];
  for (const damage of mutate) {
    const f = fixture();
    const altered = structuredClone(f.next);
    damage(altered);
    await assert.rejects(f.run(f.origin, altered, "a"), isError("invalid_move_target"));
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.reads, 0);
    assert.equal(f.state.applied, 0);
  }
});

test("Pydantic default summaryReviewed=false is not an unrelated edit", async () => {
  const f = fixture({
    readDocument: async () => {
      const doc = moved(source());
      doc.islands[0].summaryText = "Observed";
      doc.islands[0].summaryReviewed = false;
      return { document: doc, etag: "etag-r2" };
    },
  });
  f.origin.document.islands[0].summaryText = "Observed";
  f.next.islands[0].summaryText = "Observed";
  assert.equal(await f.run(f.origin, f.next, "a"), "etag-r2");
});

test("an actual change to summary review cannot hide behind default normalization", async () => {
  const f = fixture({
    readDocument: async () => {
      const doc = moved(source());
      doc.islands[0].summaryText = "Observed";
      doc.islands[0].summaryReviewed = true;
      return { document: doc, etag: "etag-r2" };
    },
  });
  f.origin.document.islands[0].summaryText = "Observed";
  f.next.islands[0].summaryText = "Observed";
  await assert.rejects(
    f.run(f.origin, f.next, "a"),
    isError("readback_document_mismatch", "etag-r2"),
  );
});

test("no-change drag does not write or re-read", async () => {
  const f = fixture();
  assert.equal(await f.run(f.origin, f.origin.document, "a"), null);
  assert.equal(f.state.writes, 0);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.applied, 0);
});

test("rejects impossible Island transitions before remote mutation", async () => {
  const mutations = [
    // Server cannot remove every membership without joining a destination.
    (doc) => { doc.islands[1].cardIds = ["b"]; },
    // Moving to two Islands in a single Action is not a valid SUI move.
    (doc) => { doc.islands[0].cardIds = ["a"]; },
    // Repeating the target member also differs from server's append-once rule.
    (doc) => { doc.islands[1].cardIds = ["b", "a", "a"]; },
  ];
  for (const damage of mutations) {
    const f = fixture();
    const altered = structuredClone(f.next);
    damage(altered);
    await assert.rejects(
      f.run(f.origin, altered, "a"),
      isError("invalid_move_target"),
    );
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.reads, 0);
  }
});

test("cannot remove one preexisting Island membership without a new destination", async () => {
  const f = fixture();
  // Both Islands already contain 'a'. The SUI server skips existing
  // containments while selecting a target, so it would keep both memberships.
  f.origin.document.islands[1].cardIds.push("a");
  const altered = structuredClone(f.next);
  altered.islands[1].cardIds = ["b", "a"];
  await assert.rejects(f.run(f.origin, altered, "a"), isError("invalid_move_target"));
  assert.equal(f.state.writes, 0);
});

test("membership-only change without card movement is invalid", async () => {
  const f = fixture();
  const altered = structuredClone(f.origin.document);
  altered.islands[0].cardIds = [];
  altered.islands[1].cardIds.push("a");
  await assert.rejects(f.run(f.origin, altered, "a"), isError("invalid_move_target"));
  assert.equal(f.state.writes, 0);
});

test("a stale local origin blocks the Action before sending", async () => {
  const f = fixture(); f.setCurrent(false);
  await assert.rejects(f.run(f.origin, f.next, "a"), isError("local_state_changed"));
  assert.equal(f.state.writes, 0);
});

test("an async or throwing origin guard cannot authorize a mutation", async () => {
  for (const isCurrent of [() => Promise.resolve(true), () => { throw Error("unmounted"); }]) {
    const f = fixture({ isCurrent });
    await assert.rejects(f.run(f.origin, f.next, "a"), isError("local_state_changed"));
    assert.equal(f.state.writes, 0);
  }
});

test("a denied Action fails without client-side fallback or retries", async () => {
  let attempts = 0;
  const f = fixture({ dispatch: async () => { attempts++; throw Object.assign(new Error("forbidden"), { code: "action_denied" }); } });
  await assert.rejects(f.run(f.origin, f.next, "a"), { code: "action_denied" });
  assert.equal(attempts, 1);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.applied, 0);
});

test("lost POST acknowledgment is outcome-unknown and never retried", async () => {
  let attempts = 0;
  const f = fixture({
    dispatch: async () => { attempts++; throw Error("connection reset"); },
  });
  await assert.rejects(
    f.run(f.origin, f.next, "a"),
    isError("commit_outcome_unknown"),
  );
  assert.equal(attempts, 1);
  assert.equal(f.state.reads, 0);
  assert.equal(f.state.applied, 0);
});

test("nondefinitive HTTP 500 after a possible commit requires reconciliation", async () => {
  let attempts = 0;
  const f = fixture({
    dispatch: async () => {
      attempts++;
      throw Object.assign(new Error("server failure"), {
        status: 500, code: "execution_failed",
      });
    },
  });
  await assert.rejects(f.run(f.origin, f.next, "a"), isError("commit_outcome_unknown"));
  assert.equal(attempts, 1);
  assert.equal(f.state.applied, 0);
});

test("definite 409 conflict remains distinguishable from uncertain transport", async () => {
  let attempts = 0;
  const conflict = Object.assign(new Error("revision conflict"), {
    status: 409, code: "revision_conflict",
  });
  const f = fixture({ dispatch: async () => { attempts++; throw conflict; } });
  await assert.rejects(
    f.run(f.origin, f.next, "a"),
    (error) => error === conflict,
  );
  assert.equal(attempts, 1);
  assert.equal(f.state.reads, 0);
});

test("server-acknowledged read failure is not mistaken for rollback", async () => {
  let attempts = 0;
  const f = fixture({
    dispatch: async () => { attempts++; return "etag-r2"; },
    readDocument: async () => { throw Error("network"); },
  });
  await assert.rejects(f.run(f.origin, f.next, "a"), isError("readback_failed", "etag-r2"));
  assert.equal(attempts, 1);
  assert.equal(f.state.applied, 0);
});

test("stale ETag or mismatched Card coordinates reject local application", async () => {
  for (const readDocument of [
    async () => ({ document: moved(source()), etag: "etag-r3" }),
    async () => ({ document: source(), etag: "etag-r2" }),
  ]) {
    const f = fixture({ readDocument });
    await assert.rejects(f.run(f.origin, f.next, "a"));
    assert.equal(f.state.applied, 0);
  }
});

test("unexpected island membership rejects local application", async () => {
  const f = fixture({
    readDocument: async () => {
      const wrong = moved(source()); wrong.islands[0].cardIds = ["a"];
      return { document: wrong, etag: "etag-r2" };
    },
  });
  await assert.rejects(f.run(f.origin, f.next, "a"), isError("readback_move_mismatch", "etag-r2"));
  assert.equal(f.state.applied, 0);
});

test("local change during network request rejects UI replacement", async () => {
  let f;
  f = fixture({ readDocument: async () => { f.setCurrent(false); return { document: moved(source()), etag: "etag-r2" }; } });
  await assert.rejects(f.run(f.origin, f.next, "a"), isError("local_state_changed", "etag-r2"));
  assert.equal(f.state.applied, 0);
});

test("a no-op snapshot application cannot pretend successful UI confirmation", async () => {
  const f = fixture({ applyConfirmed: async () => undefined });
  await assert.rejects(f.run(f.origin, f.next, "a"), isError("snapshot_not_applied", "etag-r2"));
});

test("an asynchronous applyConfirmed cannot acknowledge a local mutation", async () => {
  let lateResolve;
  const f = fixture({
    applyConfirmed: () => new Promise((resolve) => { lateResolve = resolve; }),
  });
  await assert.rejects(
    f.run(f.origin, f.next, "a"),
    isError("snapshot_not_applied", "etag-r2"),
  );
  // Even if the stale application eventually claims success, this protocol
  // must not await it or mark the resulting state as safely acknowledged.
  lateResolve(true);
});

test("synchronous owner guard can refuse a changed state at the last boundary", async () => {
  let current = true;
  const f = fixture({
    isCurrent: () => current,
    applyConfirmed: () => { current = false; return false; },
  });
  await assert.rejects(
    f.run(f.origin, f.next, "a"),
    isError("snapshot_not_applied", "etag-r2"),
  );
  assert.equal(f.state.applied, 0);
});

test("missing server ETag and unknown Card identity block sending", async () => {
  const f = fixture();
  await assert.rejects(f.run({ ...f.origin, etag: null }, f.next, "a"), isError("invalid_move_origin"));
  await assert.rejects(f.run(f.origin, f.next, "missing"), isError("invalid_move_target"));
  assert.equal(f.state.writes, 0);
});

test("one in-flight Action per resource, cleared after confirmed commit", async () => {
  let release;
  let firstPending = true;
  const f = fixture({ dispatch: () => firstPending
    ? (firstPending = false, new Promise((resolve) => { release = resolve; }))
    : Promise.resolve("etag-r2") });
  const first = f.run(f.origin, f.next, "a");
  await assert.rejects(f.run(f.origin, f.next, "a"), isError("action_in_flight"));
  release("etag-r2");
  assert.equal(await first, "etag-r2");
  assert.equal(await f.run(f.origin, f.next, "a"), "etag-r2");
});

test("invalid remote revision cannot be treated as successful commit", async () => {
  const f = fixture({ dispatch: async () => ({ revision: "etag-r2" }) });
  await assert.rejects(f.run(f.origin, f.next, "a"), isError("invalid_commit_response"));
  assert.equal(f.state.applied, 0);
});
