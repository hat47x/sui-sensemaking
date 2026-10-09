import { describe, expect, it } from "vitest";
import { createRepresentativeInquiryBundle } from "./inquiry_journey.fixture";
import { parseInquiryBundleJson, serializeInquiryBundle } from "./inquiry_bundle_io";
import { deriveDocumentSafeModeProjection, deriveInquirySafeModeBundle } from "./inquiry_bundle_safe_mode";
import type { DocumentV1 } from "./types";

const CREATED_AT = "2026-07-19T00:00:00.000Z";

function addSensitiveDocumentFields(document: DocumentV1): void {
  document.title = "SECRET_DOCUMENT_TITLE";
  document.cards[0] = {
    ...document.cards[0],
    text: "SECRET_CARD_TEXT",
    critique: "SECRET_CARD_CRITIQUE",
    critiqueTags: ["SECRET_CARD_TAG"],
    textReviewed: true,
    meta: { seq: 7, source: "SECRET_SOURCE_URL" },
    ka: { voice: "SECRET_INNER_VOICE", value: "SECRET_VALUE" },
  };
  document.cards.push({
    id: "card-2",
    text: "SECRET_SECOND_CARD",
    x: 200,
    y: 100,
    holdState: "shelved",
  });
  document.cards.push({
    id: "card-3",
    text: "SECRET_THIRD_CARD",
    x: 320,
    y: 100,
  });
  document.edges = [
    {
      id: "edge-1",
      fromId: document.cards[0].id,
      toId: "card-2",
      type: "SECRET_CUSTOM_EDGE_TYPE",
    },
  ];
  document.islands = [
    {
      id: "island-1",
      cardIds: [document.cards[0].id, "card-2"],
      title: "SECRET_ISLAND_TITLE",
      titleReviewed: true,
      summaryText: "SECRET_ISLAND_SUMMARY",
      summaryReviewed: true,
      summaryGrounding: [document.cards[0].id],
      summaryHistory: [
        {
          id: "summary-history-1",
          createdAt: CREATED_AT,
          fromText: "SECRET_OLD_SUMMARY",
          toText: "SECRET_NEW_SUMMARY",
          fromReviewed: false,
          toReviewed: true,
          changeKind: "manual",
          note: "SECRET_SUMMARY_NOTE",
          groundingIds: [document.cards[0].id],
        },
      ],
      imageUrl: "https://example.invalid/SECRET_IMAGE.png",
      imageReviewed: true,
      critique: "SECRET_ISLAND_CRITIQUE",
      critiqueTags: ["SECRET_ISLAND_TAG"],
      geometry: { type: "rect", x: 10, y: 20, w: 300, h: 200 },
      shape: {
        kind: "rect",
        generatedFrom: {
          cardIds: [document.cards[0].id, "card-2"],
          versionToken: "SECRET_SHAPE_VERSION",
        },
      },
      representativeCue: {
        kind: "user_image",
        cueId: "cue-1",
        altText: "SECRET_CUE_ALT_TEXT",
        imageRef: "idb-ref-1",
      },
    },
  ];
  // card-3 is outside island-1's visual containment, so this is a valid
  // cross-cutting affiliation rather than a duplicate of Island.cardIds.
  document.affiliations = [
    { id: "SECRET_AFFILIATION_ID", cardId: "card-3", islandId: "island-1" },
  ];
  document.readingOrder = ["island-1"];
  document.narratives = [
    {
      id: "narrative-1",
      title: "SECRET_NARRATIVE_TITLE",
      text: "SECRET_NARRATIVE_TEXT",
      createdAt: CREATED_AT,
      basedOnReadingOrder: ["island-1"],
      reviewed: true,
      checks: [
        {
          id: "check-1",
          createdAt: CREATED_AT,
          kind: "consistency",
          issues: [
            {
              severity: "warn",
              message: "SECRET_CHECK_MESSAGE",
              references: [{ id: document.cards[0].id, kind: "card" }],
            },
          ],
        },
      ],
    },
  ];
  document.relationSummaries = [
    {
      id: "relation-summary-1",
      createdAt: CREATED_AT,
      islandAId: "island-1",
      islandBId: "island-2",
      relationType: "related",
      derived: true,
      text: "SECRET_RELATION_TEXT",
      reviewed: true,
      groundingCardIds: [document.cards[0].id],
      groundingEdgeIds: ["edge-1"],
      warnings: ["SECRET_RELATION_WARNING"],
      sourceSignature: "SECRET_SOURCE_SIGNATURE",
      history: [
        {
          id: "relation-history-1",
          createdAt: CREATED_AT,
          changeKind: "manual",
          fromText: "SECRET_OLD_RELATION",
          toText: "SECRET_NEW_RELATION",
          fromReviewed: false,
          toReviewed: true,
          warningsSnapshot: ["SECRET_HISTORY_WARNING"],
          groundingCardIdsSnapshot: [document.cards[0].id],
          groundingEdgeIdsSnapshot: ["edge-1"],
          note: "SECRET_RELATION_NOTE",
        },
      ],
    },
  ];
  document.evidenceLinks = [
    {
      id: "evidence-1",
      type: "supports",
      fromCardId: document.cards[0].id,
      toCardId: "card-2",
      note: "SECRET_EVIDENCE_NOTE",
      createdAt: CREATED_AT,
    },
  ];
  document.patchApplyLog = [
    {
      id: "patch-log-1",
      createdAt: CREATED_AT,
      patchVersion: "1",
      patchTitle: "SECRET_PATCH_TITLE",
      baseDocSignature: "SECRET_BASE_SIGNATURE",
      patchSourceSignature: "SECRET_PATCH_SOURCE_SIGNATURE",
      appliedOpIds: ["op-1"],
      stats: {
        upsertCards: 1,
        deleteCards: 0,
        upsertIslands: 0,
        deleteIslands: 0,
        upsertEdges: 0,
        deleteEdges: 0,
        upsertRelationSummaries: 0,
        deleteRelationSummaries: 0,
        upsertEvidenceLinks: 0,
        deleteEvidenceLinks: 0,
      },
      conflictMeta: {
        totalConflicts: 1,
        chosenYours: 1,
        chosenTheirs: 0,
        chosenSkip: 0,
      },
      note: "SECRET_PATCH_NOTE",
    },
  ];
  document.mergeSuggestionDecisions = [
    {
      id: "merge-log-1",
      decisionId: "decision-1",
      groupId: "group-1",
      decision: "partial",
      action: "partial",
      decidedAt: CREATED_AT,
      decidedBy: "SECRET_OPERATOR",
      cardIds: [document.cards[0].id, "card-2"],
      selectedCardIds: [document.cards[0].id],
      mergedTextDraft: "SECRET_MERGED_DRAFT",
      editedText: "SECRET_EDITED_TEXT",
      note: "SECRET_MERGE_NOTE",
      snapshotVersion: "SECRET_SNAPSHOT_VERSION",
      rationale: "SECRET_MERGE_RATIONALE",
    },
  ];
  document.critiqueInputs = [
    {
      schemaVersion: "1.0.0",
      critiqueId: "critique-1",
      targetRef: `card:${document.cards[0].id}`,
      critiqueType: "feels_off",
      createdAt: CREATED_AT,
      iteration: 1,
      comment: "SECRET_CRITIQUE_COMMENT",
      constraintHints: ["SECRET_CONSTRAINT_HINT"],
    },
  ];
  document.reproposalDiffs = [
    {
      schemaVersion: "1.0.0",
      proposalId: "proposal-1",
      basedOnIteration: 1,
      diffOps: [
        {
          opId: "diff-op-1",
          opType: "relabel",
          targetRef: `card:${document.cards[0].id}`,
          before: { nested: { arbitrary: "SECRET_ARBITRARY_BEFORE" } },
          after: { nested: { arbitrary: "SECRET_ARBITRARY_AFTER" } },
          rationale: "SECRET_DIFF_RATIONALE",
        },
      ],
      traceKey: "SECRET_TRACE_KEY",
      rationale: "SECRET_REPROPOSAL_RATIONALE",
    },
  ];
  document.reviewAttribution = {
    schemaVersion: "1.0.0",
    reviewState: "human_reviewed",
    reviewedAt: CREATED_AT,
    reviewerRef: "SECRET_REVIEWER_REF",
    auditRecordedAt: CREATED_AT,
    overridePolicy: "human_dual_control_only",
    reviewContext: "SECRET_REVIEW_CONTEXT",
    ownerRef: "SECRET_OWNER_REF",
  };
  document.deterministicTieBreak = {
    schemaVersion: "1.0.0",
    order: [
      "padding_compliance",
      "self_intersection_avoidance",
      "minimum_area_delta",
      "minimum_vertex_count",
    ],
  };
  document.shelf = [
    { cardId: "card-2", shelvedAt: CREATED_AT, reason: "SECRET_SHELF_REASON" },
  ];
  document.contradictionSignalDecisions = [
    { signatureKey: "SECRET_CONTRADICTION_SIGNATURE", status: "held", decidedAt: CREATED_AT },
  ];
}

describe("deriveInquirySafeModeBundle", () => {
  it("redacts free text and removes correlation payloads while preserving the inquiry graph", async () => {
    const source = createRepresentativeInquiryBundle();
    source.journey.title = "SECRET_JOURNEY_TITLE";
    for (const round of source.journey.roundRecords) {
      round.theme = `SECRET_THEME_${round.roundId}`;
      if (round.handoff) {
        round.handoff.unresolvedQuestions = ["SECRET_UNRESOLVED_QUESTION"];
        round.handoff.understandingDelta = "SECRET_UNDERSTANDING_DELTA";
        for (const request of round.handoff.fieldworkRequests) {
          request.question = "SECRET_FIELDWORK_QUESTION";
          if (request.outcome) request.outcome.note = "SECRET_FIELDWORK_NOTE";
        }
      }
    }
    addSensitiveDocumentFields(source.snapshots[0].document);

    const sourceBefore = structuredClone(source);
    const validatedSource = await serializeInquiryBundle(source);
    expect(validatedSource.ok).toBe(true);
    if (!validatedSource.ok) return;

    const result = await deriveInquirySafeModeBundle(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.safeModeApplied).toBe(true);
    expect(source).toEqual(sourceBefore);
    expect(result.bundle.journey.journeyId).toBe(source.journey.journeyId);
    expect(result.bundle.journey.roundRecords.map((round) => round.roundId)).toEqual(
      source.journey.roundRecords.map((round) => round.roundId)
    );
    expect(result.bundle.snapshots.map((snapshot) => snapshot.snapshotId)).toEqual(
      source.snapshots.map((snapshot) => snapshot.snapshotId)
    );
    expect(result.bundle.cardLineage).toEqual(source.cardLineage);

    const safeDocument = result.bundle.snapshots[0].document;
    expect(safeDocument.cards.map((card) => card.id)).toEqual(
      source.snapshots[0].document.cards.map((card) => card.id)
    );
    expect(safeDocument.cards[0].meta).toEqual({ seq: 7 });
    expect(safeDocument.edges[0].type).toBe("related");
    expect(safeDocument.islands[0].imageUrl).toBeUndefined();
    expect(safeDocument.islands[0].imageReviewed).toBeUndefined();
    expect(safeDocument.islands[0].representativeCue?.kind).toBe("user_image");
    expect(safeDocument.islands[0].representativeCue?.cueId).toBe("cue-1");
    expect(safeDocument.islands[0].representativeCue?.imageRef).toBe("idb-ref-1");
    expect(safeDocument.islands[0].representativeCue?.altText).not.toBe("SECRET_CUE_ALT_TEXT");
    expect(safeDocument.reproposalDiffs).toBeUndefined();
    expect(safeDocument.contradictionSignalDecisions).toBeUndefined();
    expect(safeDocument.affiliations).toBeUndefined();
    expect(safeDocument.patchApplyLog?.[0].baseDocSignature).toBeUndefined();
    expect(safeDocument.patchApplyLog?.[0].patchSourceSignature).toBeUndefined();
    expect(safeDocument.mergeSuggestionDecisions?.[0].decidedBy).toBeUndefined();
    expect(safeDocument.reviewAttribution?.ownerRef).toBeUndefined();
    expect(safeDocument.reviewAttribution?.reviewState).toBe("human_reviewed");

    const safeJson = JSON.stringify(result.bundle);
    expect(safeJson).not.toContain("SECRET_");
    expect(safeJson).toContain("[REDACTED]");
    expect(result.bundle.snapshots[0].canonicalDigest).not.toBe(
      validatedSource.bundle.snapshots[0].canonicalDigest
    );

    const serialized = await serializeInquiryBundle(result.bundle);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const parsed = await parseInquiryBundleJson(serialized.json);
    expect(parsed).toEqual({ ok: true, bundle: result.bundle });
  });

  it("fails closed when the source contains an unknown field", async () => {
    const source = createRepresentativeInquiryBundle();
    Object.assign(source.snapshots[0].document.cards[0], {
      futureSensitiveField: "SECRET_FUTURE_FIELD",
    });

    const result = await deriveInquirySafeModeBundle(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_shape",
          message: expect.stringContaining("unknown field 'futureSensitiveField'"),
        }),
      ])
    );
  });
});

describe("deriveDocumentSafeModeProjection", () => {
  it("keeps imageRef only for hand_drawn / user_image cues (schemas.md §19.3)", () => {
    const cue = (kind: "preset_svg" | "emoji" | "hand_drawn", id: string) => ({
      kind,
      cueId: id,
      altText: "alt",
      imageRef: "idb-ref-" + id,
    });
    const document: DocumentV1 = {
      version: 1,
      id: "doc-imageref-safe",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      transform: { panX: 0, panY: 0, zoom: 1 },
      cards: [{ id: "c1", text: "t", x: 0, y: 0 }],
      edges: [],
      islands: [
        { id: "i1", cardIds: ["c1"], representativeCue: cue("preset_svg", "a") },
        { id: "i2", cardIds: ["c1"], representativeCue: cue("emoji", "b") },
        { id: "i3", cardIds: ["c1"], representativeCue: cue("hand_drawn", "c") },
      ],
    } as DocumentV1;
    const safe = deriveDocumentSafeModeProjection(document);
    expect(safe.islands[0].representativeCue?.imageRef).toBeUndefined();
    expect(safe.islands[1].representativeCue?.imageRef).toBeUndefined();
    expect(safe.islands[2].representativeCue?.imageRef).toBe("idb-ref-c");
  });

  it("redacts void title/detail while preserving structural fields (sensemaking_technique.md §4)", () => {
    const document: DocumentV1 = {
      version: 1,
      id: "doc-voids-safe",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      transform: { panX: 0, panY: 0, zoom: 1 },
      cards: [{ id: "c1", text: "SECRET_CARD_TEXT", x: 0, y: 0 }],
      edges: [],
      islands: [{ id: "i1", cardIds: ["c1"], title: "A", summaryText: "s", summaryReviewed: true }],
      voids: [
        {
          id: "v1",
          kind: "orphaned_island",
          title: "SECRET_VOID_TITLE",
          detail: "SECRET_VOID_DETAIL quoting card text",
          islandIds: ["i1"],
          resolved: false,
          createdAt: "2026-08-14T00:00:00.000Z",
        },
      ],
    };

    const projected = deriveDocumentSafeModeProjection(document);

    expect(projected.voids).toBeDefined();
    const voidEntry = projected.voids![0];
    expect(voidEntry.kind).toBe("orphaned_island");
    expect(voidEntry.id).toBe("v1");
    expect(voidEntry.islandIds).toEqual(["i1"]);
    expect(voidEntry.createdAt).toBe("2026-08-14T00:00:00.000Z");
    expect(voidEntry.title).not.toContain("SECRET");
    expect(voidEntry.detail).not.toContain("SECRET");
    expect(voidEntry.resolved).toBe(false);
  });
});
