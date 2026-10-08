import { describe, expect, it } from "vitest";

import { computeVisibleBounds } from "../domain/geometry/bounds";
import type { DocumentV1 } from "../domain/types";
import { exportCanvasToSVG } from "./canvas_svg";

function buildDoc(): DocumentV1 {
  return {
    version: 1,
    id: "doc_svg",
    title: "SVG",
    createdAt: "2026-02-15T00:00:00.000Z",
    updatedAt: "2026-02-15T00:00:00.000Z",
    transform: { panX: -120, panY: -80, zoom: 1.5 },
    cards: [
      { id: "c1", text: "Card one", x: 100, y: 100 },
      { id: "c2", text: "Card two", x: 360, y: 140 },
      { id: "c3", text: "Source card", x: 620, y: 180, canonicalId: "c2" },
    ],
    edges: [
      { id: "e1", fromId: "c1", toId: "c2", type: "related" },
      { id: "e2", fromId: "c2", toId: "c3", type: "negate" },
      { id: "e3", fromId: "c1", toId: "c3", type: "related" },
    ],
    islands: [
      { id: "i1", title: "Island One", summaryText: "Summary", cardIds: ["c1", "c2"] },
      {
        id: "i2",
        title: "Island Two",
        cardIds: ["c3"],
        shape: {
          kind: "polygon",
          points: [
            { x: 560, y: 120 },
            { x: 760, y: 120 },
            { x: 760, y: 320 },
            { x: 560, y: 320 },
          ],
        },
      },
    ],
  };
}

describe("canvas_svg export", () => {
  it("computes visible bounds and exports SVG layers", () => {
    const doc = buildDoc();
    const viewState = {
      visibleIslandIds: new Set(["i1", "i2"]),
      hiddenCardIds: new Set<string>(),
      hideSourceCards: false,
      summaryView: false,
      abstractMapView: false,
    };

    const bounds = computeVisibleBounds(doc, viewState);
    expect(bounds).not.toBeNull();

    const svg = exportCanvasToSVG({
      doc,
      viewState,
      camera: { panX: 0, panY: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 720 },
      area: bounds!,
      safeMode: true,
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain("<rect");
    expect(svg).toContain("<polygon");
    expect(svg).toContain("<line");
    expect(svg).toContain("<text");
    // SafeMode projects the island title to the redaction marker (len:10 = "Island One").
    expect(svg).not.toContain("Island One");
    expect(svg).toContain("[REDACTED] (len:10)");
  });

  it("renders dashed derived edges in abstract map view", () => {
    const doc = buildDoc();
    const viewState = {
      visibleIslandIds: new Set(["i1", "i2"]),
      hiddenCardIds: new Set(["c1", "c2", "c3"]),
      hideSourceCards: true,
      summaryView: true,
      abstractMapView: true,
    };

    const bounds = computeVisibleBounds(doc, viewState);
    expect(bounds).not.toBeNull();

    const svg = exportCanvasToSVG({
      doc,
      viewState,
      camera: { panX: 0, panY: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 720 },
      area: bounds!,
      safeMode: true,
    });

    expect(svg).toContain('stroke-dasharray="4 4"');
    expect(svg).not.toContain("Island Two");
    expect(svg).toContain("[REDACTED] (len:10)");
  });


  it("hides edges when either endpoint card is hidden", () => {
    const doc = buildDoc();
    const viewState = {
      visibleIslandIds: new Set(["i1", "i2"]),
      hiddenCardIds: new Set(["c2"]),
      hideSourceCards: false,
      summaryView: false,
      abstractMapView: false,
    };

    const bounds = computeVisibleBounds(doc, viewState);
    expect(bounds).not.toBeNull();

    const svg = exportCanvasToSVG({
      doc,
      viewState,
      camera: { panX: 0, panY: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 720 },
      area: bounds!,
      safeMode: true,
    });

    const lineCount = (svg.match(/<line /g) ?? []).length;
    expect(lineCount).toBe(1);
  });

  it("hides source cards when hideSourceCards is enabled", () => {
    const doc = buildDoc();
    const viewState = {
      visibleIslandIds: new Set(["i1", "i2"]),
      hiddenCardIds: new Set<string>(),
      hideSourceCards: true,
      summaryView: false,
      abstractMapView: false,
    };

    const bounds = computeVisibleBounds(doc, viewState);
    expect(bounds).not.toBeNull();

    const svg = exportCanvasToSVG({
      doc,
      viewState,
      camera: { panX: 0, panY: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 720 },
      area: bounds!,
      safeMode: true,
    });

    // Under SafeMode the card text is projected, so the hidden source card is identified by its
    // redaction marker length ("Source card" = 11 characters) rather than by its raw text.
    expect(svg).not.toContain("[REDACTED] (len:11)");
    expect(svg).toContain("[REDACTED] (len:8)");
  });

  it("projects unreviewed and reviewed card text, island titles and summaries under SafeMode", () => {
    const doc = buildDoc();
    doc.cards[0] = { ...doc.cards[0], text: "未レビューのカード本文", textReviewed: false };
    doc.cards[1] = { ...doc.cards[1], text: "レビュー済みのカード本文", textReviewed: true };
    doc.islands = [
      {
        id: "i1",
        title: "未確認の島タイトル",
        titleReviewed: false,
        summaryText: "未確認の島の要約",
        summaryReviewed: false,
        cardIds: ["c1", "c2"],
      },
      {
        id: "i2",
        title: "確認済みの島タイトル",
        titleReviewed: true,
        summaryText: "確認済みの島の要約",
        summaryReviewed: true,
        cardIds: ["c3"],
        shape: {
          kind: "polygon",
          points: [
            { x: 560, y: 120 },
            { x: 760, y: 120 },
            { x: 760, y: 320 },
            { x: 560, y: 320 },
          ],
        },
      },
    ];

    const viewState = {
      visibleIslandIds: new Set(["i1", "i2"]),
      hiddenCardIds: new Set<string>(),
      hideSourceCards: false,
      summaryView: false,
      abstractMapView: false,
    };
    const bounds = computeVisibleBounds(doc, viewState);
    expect(bounds).not.toBeNull();

    const svg = exportCanvasToSVG({
      doc,
      viewState,
      camera: { panX: 0, panY: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 720 },
      area: bounds!,
      safeMode: true,
    });

    for (const raw of [
      "未レビューのカード本文",
      "レビュー済みのカード本文",
      "未確認の島タイトル",
      "確認済みの島タイトル",
      "未確認の島の要約",
      "確認済みの島の要約",
    ]) {
      expect(svg).not.toContain(raw);
    }
    expect(svg).toContain("[REDACTED]");
    // Geometry survives the projection: the polygon island is still drawn as a polygon.
    expect(svg).toContain("<polygon");
  });

  it("keeps raw card text, island titles and summaries when SafeMode is off", () => {
    const doc = buildDoc();
    doc.cards[0] = { ...doc.cards[0], text: "未レビューのカード本文", textReviewed: false };
    doc.islands = [
      {
        id: "i1",
        title: "未確認の島タイトル",
        titleReviewed: false,
        summaryText: "未確認の島の要約",
        summaryReviewed: false,
        cardIds: ["c1", "c2"],
      },
    ];

    const viewState = {
      visibleIslandIds: new Set(["i1"]),
      hiddenCardIds: new Set<string>(),
      hideSourceCards: false,
      summaryView: false,
      abstractMapView: false,
    };
    const bounds = computeVisibleBounds(doc, viewState);
    expect(bounds).not.toBeNull();

    const svg = exportCanvasToSVG({
      doc,
      viewState,
      camera: { panX: 0, panY: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 720 },
      area: bounds!,
      safeMode: false,
    });

    expect(svg).toContain("未レビューのカード本文");
    expect(svg).toContain("未確認の島タイトル");
    expect(svg).toContain("未確認の島の要約");
    expect(svg).not.toContain("[REDACTED]");
  });


  it("falls back to rect export for self-intersecting polygon", () => {
    const doc = buildDoc();
    doc.islands = [
      {
        id: "i1",
        title: "Invalid Polygon",
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
    ];

    const viewState = {
      visibleIslandIds: new Set(["i1"]),
      hiddenCardIds: new Set<string>(),
      hideSourceCards: false,
      summaryView: false,
      abstractMapView: false,
    };

    const bounds = computeVisibleBounds(doc, viewState);
    expect(bounds).not.toBeNull();

    const svg = exportCanvasToSVG({
      doc,
      viewState,
      camera: { panX: 0, panY: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 720 },
      area: bounds!,
      safeMode: true,
    });

    expect(svg).toContain("<rect");
    expect(svg).not.toContain(`<polygon points="0,0 120,120 120,0 0,120"`);
  });
  it("does not mutate document", () => {
    const doc = buildDoc();
    const before = JSON.stringify(doc);

    const viewState = {
      visibleIslandIds: new Set(["i1", "i2"]),
      hiddenCardIds: new Set<string>(),
      hideSourceCards: false,
      summaryView: false,
      abstractMapView: false,
    };

    const bounds = computeVisibleBounds(doc, viewState);
    exportCanvasToSVG({
      doc,
      viewState,
      camera: { panX: 0, panY: 0, zoom: 1, viewportWidth: 1280, viewportHeight: 720 },
      area: bounds ?? { x: 0, y: 0, w: 100, h: 100 },
      safeMode: true,
    });

    expect(JSON.stringify(doc)).toBe(before);
  });
});
