import { describe, expect, it } from "vitest";

import { checkIslandMembershipIntegrity, validateDocumentV1Strict } from "./validate_doc";
import type { DocumentV1 } from "./types";
import { detectVoidCandidates } from "./void_detection";

describe("validateDocumentV1Strict", () => {
  const now = new Date().toISOString();

  const validDocument = {
    version: 1,
    id: "doc_v2",
    createdAt: now,
    updatedAt: now,
    transform: {
      panX: 0,
      panY: 0,
      zoom: 1,
    },
    cards: [{ id: "c1", text: "A", x: 0, y: 0 }],
    edges: [],
    islands: [],
  };

  it("accepts valid DocumentV1", () => {
    const result = validateDocumentV1Strict(validDocument);
    expect(result.ok).toBe(true);
  });

  it("accepts valid cross-cutting affiliations", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      cards: [{ id: "c1", text: "A", x: 0, y: 0 }],
      islands: [{ id: "i1", cardIds: [] }],
      affiliations: [{ id: "a1", cardId: "c1", islandId: "i1" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.affiliations).toEqual([
      { id: "a1", cardId: "c1", islandId: "i1" },
    ]);
  });

  it("rejects duplicate or dangling affiliations", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      cards: [{ id: "c1", text: "A", x: 0, y: 0 }],
      islands: [
        { id: "i1", cardIds: [] },
        { id: "i2", cardIds: ["c1"] },
      ],
      affiliations: [
        { id: "a1", cardId: "c1", islandId: "i1" },
        { id: "a2", cardId: "c1", islandId: "i1" },
        { id: "a1", cardId: "missing", islandId: "missing-island" },
        { id: "a3", cardId: "c1", islandId: "i2" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain(
      "affiliations[1]: duplicate pair 'c1' -> 'i1'",
    );
    expect(result.errors).toContain("affiliations[2].id: duplicate id 'a1'");
    expect(result.errors).toContain(
      "affiliations[2].cardId: unknown card 'missing'",
    );
    expect(result.errors).toContain(
      "affiliations[2].islandId: unknown island 'missing-island'",
    );
    expect(result.errors).toContain(
      "affiliations[3]: duplicates visual containment 'c1' -> 'i2'",
    );
  });

  it("accepts supported card hold states and rejects unknown values", () => {
    expect(validateDocumentV1Strict({
      ...validDocument,
      cards: [{ ...validDocument.cards[0], holdState: "shelved" }],
    }).ok).toBe(true);

    const invalid = validateDocumentV1Strict({
      ...validDocument,
      cards: [{ ...validDocument.cards[0], holdState: "resolved" }],
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.errors).toContain("cards[0].holdState: must be 'held' | 'pending' | 'shelved' when provided");
  });

  it("accepts a shelf entry that points to a shelved card", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      cards: [{ ...validDocument.cards[0], holdState: "shelved" }],
      shelf: [{ cardId: "c1", shelvedAt: now, reason: "Revisit later" }],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects invalid, duplicate, orphaned, and inconsistent shelf entries", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      shelf: [
        { cardId: "c1", shelvedAt: now },
        { cardId: "c1", shelvedAt: now },
        { cardId: "missing", shelvedAt: now },
        { cardId: "c1", shelvedAt: "not-a-date" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("shelf[0].cardId: card 'c1' must have holdState 'shelved'");
    expect(result.errors).toContain("shelf[1].cardId: duplicate card id 'c1'");
    expect(result.errors).toContain("shelf[2].cardId: unknown card 'missing'");
    expect(result.errors).toContain("shelf[3].shelvedAt: must be an ISO timestamp");
  });

  it("rejects unknown root fields", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      unknownField: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("document: unknown field 'unknownField'");
  });

  // Regression: `voids` (types.ts DocumentV1.voids, schemas.md) and
  // EvidenceLink.contradictionState (DOMAIN-EXPR-04) are written by the UI, so a
  // legitimate document carrying them must pass the strict import gate.
  it("accepts stored voids and EvidenceLink.contradictionState", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      cards: [
        { id: "c1", text: "A", x: 0, y: 0 },
        { id: "c2", text: "B", x: 10, y: 0 },
        { id: "c3", text: "C", x: 20, y: 0 },
      ],
      evidenceLinks: [
        { id: "ev1", type: "contradicts", fromCardId: "c1", toCardId: "c2", contradictionState: "unconfirmed" },
        { id: "ev2", type: "contradicts", fromCardId: "c2", toCardId: "c3", contradictionState: "confirmed" },
        { id: "ev3", type: "contradicts", fromCardId: "c3", toCardId: "c1", contradictionState: "held" },
        { id: "ev4", type: "contradicts", fromCardId: "c1", toCardId: "c3", contradictionState: "resolved" },
      ],
      voids: [
        {
          id: "void-1",
          kind: "unintegrated_card",
          title: "どの島にも属さないカード",
          detail: "カード c3 はどの島にも属していません",
          cardIds: ["c3"],
          resolved: false,
          createdAt: now,
        },
        {
          id: "void-2",
          kind: "unreviewed_content",
          title: "未レビューの内容",
          detail: "レビュー前の内容が残っています",
          resolved: true,
          createdAt: now,
        },
      ],
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("accepts voids written by void detection (the app's own writer) without altering them", () => {
    const base = {
      version: 1,
      id: "doc-voids-strict",
      createdAt: now,
      updatedAt: now,
      transform: { panX: 0, panY: 0, zoom: 1 },
      cards: [
        { id: "c1", text: "alpha", x: 0, y: 0 },
        { id: "c2", text: "beta", x: 10, y: 10 },
        { id: "c3", text: "lone", x: 500, y: 500 },
      ],
      edges: [
        { id: "e1", fromId: "i1", toId: "i2", fromKind: "island", toKind: "island", type: "related" },
      ],
      islands: [
        { id: "i1", cardIds: ["c1"], title: "A", summaryText: "s", summaryReviewed: true },
        { id: "i2", cardIds: ["c2"], title: "B", summaryText: "", summaryReviewed: false },
      ],
      relationSummaries: [],
    };
    const detected = detectVoidCandidates(base as unknown as DocumentV1, { nowIso: now });
    expect(detected.voids.length).toBeGreaterThan(0);

    const result = validateDocumentV1Strict({ ...base, voids: detected.voids });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.voids).toEqual(detected.voids);
  });

  it("keeps rejecting unknown fields inside voids, EvidenceLink, and the root", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      cards: [
        { id: "c1", text: "A", x: 0, y: 0 },
        { id: "c2", text: "B", x: 10, y: 0 },
      ],
      evidenceLinks: [
        {
          id: "ev1",
          type: "contradicts",
          fromCardId: "c1",
          toCardId: "c2",
          contradictionState: "held",
          contradictionStatus: "held",
        },
      ],
      voids: [
        {
          id: "void-1",
          kind: "unspoken_island",
          title: "表札なし",
          detail: "島に表札がありません",
          severity: "high",
          createdAt: now,
        },
      ],
      unknownRootField: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("evidenceLinks[0]: unknown field 'contradictionStatus'");
    expect(result.errors).toContain("voids[0]: unknown field 'severity'");
    expect(result.errors).toContain("document: unknown field 'unknownRootField'");
  });

  it("rejects malformed voids and out-of-enum contradictionState values", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      cards: [
        { id: "c1", text: "A", x: 0, y: 0 },
        { id: "c2", text: "B", x: 10, y: 0 },
      ],
      evidenceLinks: [
        { id: "ev1", type: "contradicts", fromCardId: "c1", toCardId: "c2", contradictionState: "bogus" },
      ],
      voids: [
        { id: "void-1", kind: "bogus_kind", title: "t", detail: "d", createdAt: now },
        { id: "void-2", kind: "orphaned_island", title: "", detail: "d", createdAt: now },
        { id: "void-3", kind: "orphaned_island", title: "t", detail: "d", resolved: "yes", createdAt: now },
        { id: "void-4", kind: "orphaned_island", title: "t", detail: "d", createdAt: "not-a-date" },
        { id: "void-5", kind: "orphaned_island", title: "t", detail: "d", cardIds: [1], createdAt: now },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContainEqual(expect.stringMatching(/^voids\[0\]\.kind: must be one of /));
    expect(result.errors).toContain("voids[1].title: must be a non-empty string");
    expect(result.errors).toContain("voids[2].resolved: must be a boolean when provided");
    expect(result.errors).toContain("voids[3].createdAt: must be an ISO timestamp");
    expect(result.errors).toContain("voids[4].cardIds[0]: must be a string");
    expect(result.errors).toContain(
      "evidenceLinks[0].contradictionState: must be 'unconfirmed' | 'confirmed' | 'held' | 'resolved' when provided",
    );
  });

  it("rejects voids that are not an array", () => {
    const result = validateDocumentV1Strict({ ...validDocument, voids: { id: "void-1" } });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("document.voids: must be an array when provided");
  });

  it("accepts polygon geometry", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      islands: [
        {
          id: "i1",
          cardIds: ["c1"],
          geometry: {
            type: "polygon",
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("accepts a valid Island.representativeCue and rejects unknown kind / missing altText (DOMAIN-VISUAL-CUE-01, schemas.md §19.3)", () => {
    const valid = validateDocumentV1Strict({
      ...validDocument,
      islands: [
        {
          id: "i1",
          cardIds: ["c1"],
          representativeCue: { kind: "emoji", cueId: "📍", altText: "location" },
        },
      ],
    });
    expect(valid.ok).toBe(true);

    const unknownKind = validateDocumentV1Strict({
      ...validDocument,
      islands: [
        {
          id: "i1",
          cardIds: ["c1"],
          representativeCue: { kind: "external_url", cueId: "x", altText: "y" },
        },
      ],
    });
    expect(unknownKind.ok).toBe(false);
    if (unknownKind.ok) return;
    expect(unknownKind.errors).toContain(
      "islands[0].representativeCue.kind: must be 'hand_drawn' | 'user_image' | 'preset_svg' | 'emoji'"
    );

    const missingAltText = validateDocumentV1Strict({
      ...validDocument,
      islands: [
        {
          id: "i1",
          cardIds: ["c1"],
          representativeCue: { kind: "preset_svg", cueId: "place" },
        },
      ],
    });
    expect(missingAltText.ok).toBe(false);
  });

  it("strict: drops a string imageRef on preset_svg / emoji from the returned document and keeps hand_drawn imageRef (DOMAIN-VISUAL-CUE-01, schemas.md §19.3)", () => {
    const input = {
      ...validDocument,
      islands: [
        {
          id: "i_preset",
          cardIds: ["c1"],
          representativeCue: { kind: "preset_svg", cueId: "place", altText: "place", imageRef: "should-be-dropped" },
        },
        {
          id: "i_emoji",
          cardIds: ["c1"],
          representativeCue: { kind: "emoji", cueId: "📍", altText: "location", imageRef: "should-be-dropped" },
        },
        {
          id: "i_hand_drawn",
          cardIds: ["c1"],
          representativeCue: { kind: "hand_drawn", cueId: "cue-1", altText: "sketch", imageRef: "idb-key-1" },
        },
      ],
    };

    const result = validateDocumentV1Strict(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byId = (id: string) => result.document.islands.find((island) => island.id === id);
    expect(byId("i_preset")?.representativeCue).toEqual({ kind: "preset_svg", cueId: "place", altText: "place" });
    expect(byId("i_preset")?.representativeCue).not.toHaveProperty("imageRef");
    expect(byId("i_emoji")?.representativeCue).toEqual({ kind: "emoji", cueId: "📍", altText: "location" });
    expect(byId("i_emoji")?.representativeCue).not.toHaveProperty("imageRef");
    expect(byId("i_hand_drawn")?.representativeCue).toEqual({
      kind: "hand_drawn",
      cueId: "cue-1",
      altText: "sketch",
      imageRef: "idb-key-1",
    });

    // The caller's object is not mutated; the strip happens only on the returned copy.
    const inputPreset = input.islands[0].representativeCue as Record<string, unknown>;
    expect(inputPreset.imageRef).toBe("should-be-dropped");
  });

  it("strict: rejects the whole document for a non-string imageRef, including null, and for an unknown cue key", () => {
    for (const cue of [
      { kind: "hand_drawn", cueId: "cue-1", altText: "sketch", imageRef: 123 },
      { kind: "preset_svg", cueId: "place", altText: "place", imageRef: ["idb-key-1"] },
      { kind: "user_image", cueId: "cue-3", altText: "photo", imageRef: null },
    ]) {
      const result = validateDocumentV1Strict({
        ...validDocument,
        islands: [{ id: "i1", cardIds: ["c1"], representativeCue: cue }],
      });
      expect(result.ok, JSON.stringify(cue)).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContain("islands[0].representativeCue.imageRef: must be a string when provided");
    }

    const unknownKey = validateDocumentV1Strict({
      ...validDocument,
      islands: [{ id: "i1", cardIds: ["c1"], representativeCue: { kind: "emoji", cueId: "📍", altText: "location", extra: 1 } }],
    });
    expect(unknownKey.ok).toBe(false);
    if (unknownKey.ok) return;
    expect(unknownKey.errors).toContain("islands[0].representativeCue: unknown field 'extra'");
  });

  it("keeps shape compatibility for rect and polygon islands", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      islands: [
        {
          id: "i_rect",
          cardIds: ["c1"],
          shape: {
            kind: "rect",
          },
        },
        {
          id: "i_polygon",
          cardIds: ["c1"],
          shape: {
            kind: "polygon",
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("accepts legacy polygon geometry payload", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      islands: [
        {
          id: "i1",
          cardIds: ["c1"],
          geometry: {
            type: "polygon",
            polygon: {
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
                { x: 100, y: 100 },
              ],
            },
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects polygon shape with fewer than 3 points", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      islands: [
        {
          id: "i1",
          cardIds: ["c1"],
          shape: {
            kind: "polygon",
            points: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("islands[0].shape.points: must contain at least 3 points for polygon");
  });

  it("rejects self-intersecting polygon shape", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      islands: [
        {
          id: "i1",
          cardIds: ["c1"],
          shape: {
            kind: "polygon",
            points: [
              { x: 0, y: 0 },
              { x: 120, y: 120 },
              { x: 120, y: 0 },
              { x: 0, y: 120 },
            ],
          },
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("islands[0].shape.points: polygon must not self-intersect");
  });


  it("accepts merge suggestion decisions", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      mergeSuggestionDecisions: [
        {
          id: "decision-1",
          groupId: "heuristic-a-b",
          decision: "defer",
          decidedAt: now,
          cardIds: ["c1", "c2"],
          mergedTextDraft: "A",
          editedText: "A",
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("accepts known merge methods and legacy decisions without a method, but rejects unknown methods", () => {
    const known = validateDocumentV1Strict({
      ...validDocument,
      mergeSuggestionDecisions: [{
        id: "decision-method",
        groupId: "g1",
        decision: "accept",
        decidedAt: now,
        cardIds: ["c1", "c2"],
        mergedTextDraft: "A",
        editedText: "A",
        mergeMethod: "kernel_fusion",
      }],
    });
    expect(known.ok).toBe(true);

    const legacy = validateDocumentV1Strict({
      ...validDocument,
      mergeSuggestionDecisions: [{
        id: "decision-legacy",
        groupId: "g1",
        decision: "defer",
        decidedAt: now,
        cardIds: ["c1", "c2"],
        mergedTextDraft: "A",
        editedText: "A",
      }],
    });
    expect(legacy.ok).toBe(true);

    const unknown = validateDocumentV1Strict({
      ...validDocument,
      mergeSuggestionDecisions: [{
        id: "decision-unknown",
        groupId: "g1",
        decision: "accept",
        decidedAt: now,
        cardIds: ["c1", "c2"],
        mergedTextDraft: "A",
        editedText: "A",
        mergeMethod: "semantic_similarity",
      }],
    });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.errors).toContain(
      "mergeSuggestionDecisions[0].mergeMethod: must be 'near_duplicate' | 'kernel_fusion' when provided",
    );
  });

  it("rejects merge suggestion decisions with invalid status", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      mergeSuggestionDecisions: [
        {
          id: "decision-1",
          groupId: "heuristic-a-b",
          decision: "approved",
          decidedAt: now,
          cardIds: ["c1", "c2"],
          mergedTextDraft: "A",
          editedText: "A",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain(
      "mergeSuggestionDecisions[0].decision: must be 'accept' | 'partial' | 'reject' | 'defer'"
    );
  });

  it("accepts A1 contract-only DocumentV1 fields", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      critiqueInputs: [
        {
          schemaVersion: "1.0.0",
          critiqueId: "crit-1",
          targetRef: "island:i1",
          critiqueType: "feels_off",
          createdAt: now,
          iteration: 1,
          comment: "境界が分かりにくい",
        },
      ],
      reproposalDiffs: [
        {
          schemaVersion: "1.0.0",
          proposalId: "proposal-1",
          basedOnIteration: 1,
          traceKey: "trace:crit-1",
          rationale: "カード追加の取り消しに必要な前後差分を保持する",
          diffOps: [
            {
              opId: "op-add-c2",
              opType: "add",
              targetRef: "card:c2",
              before: null,
              after: { id: "c2", text: "B", x: 10, y: 20 },
            },
          ],
        },
      ],
      reviewAttribution: {
        schemaVersion: "1.0.0",
        reviewState: "human_reviewed",
        reviewedAt: now,
        reviewerRef: "reviewer:opaque-1",
        auditRecordedAt: now,
        overridePolicy: "human_dual_control_only",
      },
      deterministicTieBreak: {
        schemaVersion: "1.0.0",
        order: [
          "padding_compliance",
          "self_intersection_avoidance",
          "minimum_area_delta",
          "minimum_vertex_count",
        ],
      },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects irreversible reproposal diffs", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      reproposalDiffs: [
        {
          schemaVersion: "1.0.0",
          proposalId: "proposal-1",
          basedOnIteration: 1,
          traceKey: "trace:crit-1",
          diffOps: [
            {
              opId: "op-empty",
              opType: "move",
              targetRef: "card:c1",
              before: null,
              after: null,
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("reproposalDiffs[0].diffOps[0]: before and after must not both be null");
  });

  it("rejects review attribution with email-like reviewer refs", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      reviewAttribution: {
        schemaVersion: "1.0.0",
        reviewState: "human_reviewed",
        reviewedAt: now,
        reviewerRef: "reviewer@example.com",
        auditRecordedAt: now,
        overridePolicy: "human_dual_control_only",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("reviewAttribution.reviewerRef: must not contain email-like/provider identifiers");
  });

  it("rejects review attribution with provider-prefixed reviewer/owner refs", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      reviewAttribution: {
        schemaVersion: "1.0.0",
        reviewState: "human_reviewed",
        reviewedAt: now,
        reviewerRef: "sso:abc",
        auditRecordedAt: now,
        overridePolicy: "human_dual_control_only",
        ownerRef: "oidc:abc",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("reviewAttribution.reviewerRef: must not contain email-like/provider identifiers");
    expect(result.errors).toContain("reviewAttribution.ownerRef: must not contain email-like/provider identifiers");
  });

  it("rejects reordered deterministic tie-break fields", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      deterministicTieBreak: {
        schemaVersion: "1.0.0",
        order: [
          "self_intersection_avoidance",
          "padding_compliance",
          "minimum_area_delta",
          "minimum_vertex_count",
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors).toContain("deterministicTieBreak.order[0]: must be 'padding_compliance'");
  });

  // DOMAIN-ISLAND-MEMBERSHIP-01 AC-1: the advisory diagnostic must not leak
  // into the fail-closed gate. A document whose card sits in two islands stays
  // valid — §8.1 (R2(a)-検証) rejected fail-closed handling of this condition.
  it("keeps a document with cross-island duplicate membership valid", () => {
    const result = validateDocumentV1Strict({
      ...validDocument,
      cards: [
        { id: "c1", text: "A", x: 0, y: 0 },
        { id: "c2", text: "B", x: 1, y: 1 },
      ],
      islands: [
        { id: "island-a", cardIds: ["c1", "c2"] },
        { id: "island-b", cardIds: ["c2"] },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.islands).toHaveLength(2);
  });

});

// DOMAIN-ISLAND-MEMBERSHIP-01 AC-1 (F-5 / R2(a)-検証).
describe("checkIslandMembershipIntegrity", () => {
  const now = new Date().toISOString();

  function docWithIslands(islands: DocumentV1["islands"]): DocumentV1 {
    return {
      version: 1,
      id: "doc_membership",
      createdAt: now,
      updatedAt: now,
      transform: { panX: 0, panY: 0, zoom: 1 },
      cards: [
        { id: "c1", text: "A", x: 0, y: 0 },
        { id: "c2", text: "B", x: 1, y: 1 },
      ],
      edges: [],
      islands,
    };
  }

  it("reports nothing when every card belongs to at most one island", () => {
    const advisories = checkIslandMembershipIntegrity(
      docWithIslands([
        { id: "island-a", cardIds: ["c1"] },
        { id: "island-b", cardIds: ["c2"] },
      ])
    );

    expect(advisories).toEqual([]);
  });

  it("reports a card that belongs to two islands", () => {
    const advisories = checkIslandMembershipIntegrity(
      docWithIslands([
        { id: "island-a", cardIds: ["c1", "c2"] },
        { id: "island-b", cardIds: ["c2"] },
      ])
    );

    expect(advisories).toEqual([
      "islands: card 'c2' belongs to 2 islands (island-a, island-b): a card should belong to at most one island",
    ]);
  });

  it("reports every offending card and lists all islands it belongs to", () => {
    const advisories = checkIslandMembershipIntegrity(
      docWithIslands([
        { id: "island-a", cardIds: ["c1", "c2"] },
        { id: "island-b", cardIds: ["c1", "c2"] },
        { id: "island-c", cardIds: ["c1"] },
      ])
    );

    expect(advisories).toEqual([
      "islands: card 'c1' belongs to 3 islands (island-a, island-b, island-c): a card should belong to at most one island",
      "islands: card 'c2' belongs to 2 islands (island-a, island-b): a card should belong to at most one island",
    ]);
  });

  it("does not treat a repeat inside a single island as cross-island membership", () => {
    const advisories = checkIslandMembershipIntegrity(
      docWithIslands([{ id: "island-a", cardIds: ["c1", "c1"] }])
    );

    expect(advisories).toEqual([]);
  });

  it("stays advisory: it never changes validateDocumentV1Strict's verdict", () => {
    const document = docWithIslands([
      { id: "island-a", cardIds: ["c1", "c2"] },
      { id: "island-b", cardIds: ["c2"] },
    ]);

    expect(checkIslandMembershipIntegrity(document)).toHaveLength(1);
    expect(validateDocumentV1Strict(document).ok).toBe(true);
  });
});
