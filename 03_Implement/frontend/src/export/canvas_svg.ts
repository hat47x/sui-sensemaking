import { getEdgesToRender, type RenderEdge } from "../domain/edge_aggregate";
import { getDerivedIslandEdges } from "../domain/island_edge_aggregate";
import { getIslandCenter, getIslandWorldBounds, type BoundsRect, type VisibleBoundsViewState } from "../domain/geometry/bounds";
import { getIslandPolygonPoints } from "../domain/geometry/island_geometry";
import { isSelfIntersectingPolygon } from "../domain/geometry/polygon_self_intersection";
import { deriveDocumentSafeModeProjection } from "../domain/inquiry_bundle_safe_mode";
import type { Card, DocumentV1, Island } from "../domain/types";

const CARD_WIDTH = 220;
const CARD_HEIGHT = 80;

type ExportArea = BoundsRect;

export type ExportCanvasToSvgInput = {
  doc: DocumentV1;
  viewState: VisibleBoundsViewState;
  camera: {
    panX: number;
    panY: number;
    zoom: number;
    viewportWidth: number;
    viewportHeight: number;
  };
  area: ExportArea;
  safeMode: boolean;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function getCardCenter(card: Card): { x: number; y: number } {
  return {
    x: card.x + CARD_WIDTH / 2,
    y: card.y + CARD_HEIGHT / 2,
  };
}

function collectVisibleEdges(doc: DocumentV1, viewState: VisibleBoundsViewState): RenderEdge[] {
  const visibleCardIds = new Set(
    doc.cards.filter((card) => !viewState.hiddenCardIds.has(card.id)).map((card) => card.id)
  );

  let edges = getEdgesToRender(doc, viewState.hideSourceCards).filter((edge) => {
    const fromVisible = edge.fromKind === "island" ? viewState.visibleIslandIds.has(edge.fromId) : visibleCardIds.has(edge.fromId);
    const toVisible = edge.toKind === "island" ? viewState.visibleIslandIds.has(edge.toId) : visibleCardIds.has(edge.toId);
    return fromVisible && toVisible;
  });

  if (viewState.summaryView || viewState.abstractMapView) {
    edges = [
      ...edges,
      ...getDerivedIslandEdges(doc).filter((edge) => {
        if (!viewState.visibleIslandIds.has(edge.fromId)) {
          return false;
        }
        return edge.toKind === "island" ? viewState.visibleIslandIds.has(edge.toId) : visibleCardIds.has(edge.toId);
      }),
    ];
  }

  return edges;
}

function lineStyle(edge: RenderEdge): { stroke: string; dash?: string; width: number } {
  if (edge.isDerived) {
    return { stroke: "#0f766e", dash: "4 4", width: 2.5 };
  }

  if (edge.type === "negate") {
    return { stroke: "#64748b", dash: "6 4", width: 2 };
  }

  return { stroke: "#64748b", width: 2 };
}

function islandLabel(island: Island): string {
  return island.title?.trim() || island.id;
}

export function exportCanvasToSVG({ doc: sourceDoc, viewState, camera: _camera, area, safeMode }: ExportCanvasToSvgInput): string {
  // SafeMode 有効時は、共有・書き出し共通の投影（bundle_export と同じ規則）を通してから描画する。
  // 投影はカード本文・島タイトル・要約・批評を墨消しし、id・座標・形状・接続などの構造は残す。
  const doc = safeMode ? deriveDocumentSafeModeProjection(sourceDoc) : sourceDoc;
  const cardsById = new Map(doc.cards.map((card) => [card.id, card]));
  const islands = doc.islands.filter((island) => viewState.visibleIslandIds.has(island.id));
  const cards = doc.cards.filter((card) => {
    if (viewState.hiddenCardIds.has(card.id)) {
      return false;
    }

    if (viewState.hideSourceCards && card.canonicalId !== undefined) {
      return false;
    }

    return true;
  });
  const edges = collectVisibleEdges(doc, viewState);

  const islandElements: string[] = [];
  const edgeElements: string[] = [];
  const cardElements: string[] = [];
  const labelElements: string[] = [];

  for (const island of islands) {
    const bounds = getIslandWorldBounds(island, cardsById);
    if (!bounds) {
      continue;
    }

    const polygonPoints = getIslandPolygonPoints(island);
    if (polygonPoints.length >= 3 && !isSelfIntersectingPolygon(polygonPoints)) {
      const polygon = polygonPoints.map((point) => `${point.x},${point.y}`).join(" ");
      islandElements.push(`<polygon points="${polygon}" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/>`);
    } else {
      islandElements.push(
        `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.w}" height="${bounds.h}" rx="12" ry="12" fill="#e2e8f0" stroke="#64748b" stroke-width="2"/>`
      );
    }

    const title = truncateText(islandLabel(island), 64);
    labelElements.push(
      `<text x="${bounds.x + 10}" y="${bounds.y + 20}" font-size="14" font-weight="600" fill="#0f172a" font-family="sans-serif">${escapeXml(title)}</text>`
    );

    const hasSummary = typeof island.summaryText === "string" && island.summaryText.trim().length > 0;
    const hideUnreviewedSummary = safeMode && island.summaryReviewed === false && hasSummary;
    if (hasSummary) {
      const summaryText = hideUnreviewedSummary ? "(unreviewed — hidden)" : truncateText(island.summaryText as string, 90);
      labelElements.push(
        `<text x="${bounds.x + 10}" y="${bounds.y + 40}" font-size="12" fill="#334155" font-family="sans-serif">${escapeXml(summaryText)}</text>`
      );
    }
  }

  const islandById = new Map(islands.map((island) => [island.id, island]));

  for (const edge of edges) {
    const fromPoint =
      edge.fromKind === "card"
        ? cardsById.get(edge.fromId)
          ? getCardCenter(cardsById.get(edge.fromId) as Card)
          : null
        : islandById.get(edge.fromId)
        ? getIslandCenter(islandById.get(edge.fromId) as Island, cardsById)
        : null;
    const toPoint =
      edge.toKind === "card"
        ? cardsById.get(edge.toId)
          ? getCardCenter(cardsById.get(edge.toId) as Card)
          : null
        : islandById.get(edge.toId)
        ? getIslandCenter(islandById.get(edge.toId) as Island, cardsById)
        : null;

    if (!fromPoint || !toPoint) {
      continue;
    }

    const style = lineStyle(edge);
    edgeElements.push(
      `<line x1="${fromPoint.x}" y1="${fromPoint.y}" x2="${toPoint.x}" y2="${toPoint.y}" stroke="${style.stroke}" stroke-width="${style.width}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""} stroke-linecap="round"/>`
    );
  }

  for (const card of cards) {
    cardElements.push(
      `<rect x="${card.x}" y="${card.y}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="8" ry="8" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5"/>`
    );
    labelElements.push(
      `<text x="${card.x + 10}" y="${card.y + 24}" font-size="12" fill="#0f172a" font-family="sans-serif">${escapeXml(truncateText(card.text, 56))}</text>`
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(area.w)}" height="${Math.ceil(area.h)}" viewBox="${area.x} ${area.y} ${area.w} ${area.h}">\n  ${islandElements.join("\n  ")}\n  ${edgeElements.join("\n  ")}\n  ${cardElements.join("\n  ")}\n  ${labelElements.join("\n  ")}\n</svg>\n`;
}

/*
Manual test steps:
1) Open View controls and click "Export SVG (Viewport)".
2) Pan/zoom canvas and confirm exported SVG matches current framing.
3) Click "Export SVG (Visible bounds)" and confirm all visible islands/cards/edges are included with padding.
4) Toggle Abstract map view and verify island shapes, derived dashed edges, and island titles appear in exported SVG.
5) After exports, confirm Unsaved changes indicator and undo/redo behavior do not change.
*/
