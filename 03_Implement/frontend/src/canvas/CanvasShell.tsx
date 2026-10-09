import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";

import { getEdgesToRender } from "../domain/edge_aggregate";
import { getDerivedIslandEdges } from "../domain/island_edge_aggregate";
import {
  isCanonicalCard,
  isSourceCard,
  type DocumentV1,
  type EdgeType,
  type EvidenceLink,
  type Point,
  type Transform,
} from "../domain/types";
import { applyPan, applyZoomAtScreenPoint } from "./transform";
import { CardView } from "./CardView";
import { EdgeLayer } from "./EdgeLayer";
import { Marquee } from "./Marquee";
import { ReadingOrderLayer } from "./ReadingOrderLayer";
import { PolygonEditLayer } from "./PolygonEditLayer";
import { SuggestionDiffLayer } from "./SuggestionDiffLayer";
import { EvidenceOverlayLayer } from "./EvidenceOverlayLayer";
import type { SuggestionMoveDiff } from "./SuggestionDiffLayer";
import type { ReadingOrderDropPosition } from "../domain/reading_order_ops";
import { findNearestPolygonSegmentIndex } from "../domain/geometry/segment_pick";
import { getLODLevel, type LODConfig, type LODLevel } from "../domain/view/lod";
import {
  ACTIVE_CARD_LABEL_PRIORITY,
  buildCardLabelId,
  buildIslandSummaryLabelId,
  buildIslandTitleLabelId,
  buildIslandUnreviewedLabelId,
  cullLabels,
  LABEL_PRIORITIES,
  type LabelItem,
} from "../domain/view/label_culling";
import { getIslandBounds, ISLAND_TITLE_MARGIN_LEFT, ISLAND_TITLE_MARGIN_TOP } from "./IslandView";
import { resolveIslandDisplayTitle } from "../i18n/island_title";
import { t } from "../i18n/translate";
import { LabelVisibilityContext } from "./LabelVisibilityContext";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_SENSITIVITY = 0.0015;
const CARD_WIDTH = 220;
const CARD_HEIGHT = 80;
const CARD_LABEL_PADDING_X = 8;
const CARD_LABEL_PADDING_Y = 8;
const LABEL_CHAR_WIDTH = 7;
const LABEL_LINE_HEIGHT = 14;

export type FocusReference = {
  id: string;
  kind: "card" | "island";
};

type DragState = {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
  startScreenX: number;
  startScreenY: number;
  didMove: boolean;
  mode: "pan" | "marquee";
};

type RenderEdge = {
  id: string;
  fromId: string;
  toId: string;
  type: EdgeType;
};

export type CanvasViewState = {
  hideSourceCards: boolean;
  showCanonicalOnlyEdges: boolean;
  showReadingOrder: boolean;
  showLabelBounds?: boolean;
  highlightEdgeIds?: string[];
  evidenceOverlayEdges?: EvidenceLink[];
  evidenceOverlayDimCardIds?: Set<string>;
  evidenceOverlayHint?: string | null;
  highlightCardIds?: Set<string>;
  perspectiveHint?: string | null;
};

export type CanvasCamera = {
  panX: number;
  panY: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type CameraTransformRequest = {
  panX: number;
  panY: number;
  zoom: number;
  requestSeq: number;
};

type CanvasShellProps = {
  document: DocumentV1;
  onCardMove: (cardId: string, deltaWorldX: number, deltaWorldY: number) => void;
  /** Opt-in drop-only commit callback; drag preview remains local to CardView. */
  onCardMoveCommit?: (cardId: string, deltaWorldX: number, deltaWorldY: number) => void;
  selectedCardIds: string[];
  onCardSelect: (cardId: string, isShiftPressed: boolean) => void;
  onCanvasBackgroundClick: () => void;
  onMarqueeSelect: (cardIds: string[], isShiftPressed: boolean) => void;
  onTransformChange?: (transform: Transform) => void;
  onCameraChange?: (camera: CanvasCamera) => void;
  cameraTransformRequest?: CameraTransformRequest | null;
  hiddenCardIds?: Set<string>;
  deemphasizedCardIds?: Set<string>;
  hideSourceCards?: boolean;
  viewState?: CanvasViewState;
  /** @deprecated Use revealCardIds. */
  peekCardIds?: Set<string>;
  revealCardIds?: Set<string>;
  showCanonicalOnlyEdges?: boolean;
  summaryView?: boolean;
  abstractMapView?: boolean;
  lodEnabled?: boolean;
  lodThresholds?: LODConfig["lodThresholds"];
  lodLevelOverride?: LODLevel | null;
  lodShowLoneWolvesWhenFar?: boolean;
  showProtectionMarks?: boolean;
  /** DOMAIN-TRACE-01 AC-3: canvas seq badge, default OFF (View panel toggle). */
  showSeqNumbers?: boolean;
  effectiveCollapsedIslandIds?: Set<string>;
  showDerivedIslandEdges?: boolean;
  searchQuery?: string;
  matchedCardIds?: Set<string>;
  activeMatchedCardId?: string | null;
  focusCardId?: string | null;
  focusWorldPoint?: { x: number; y: number } | null;
  focusRequestSeq?: number;
  flashReference?: FocusReference | null;
  flashRequestSeq?: number;
  isPickingEdgeTarget?: boolean;
  editingCardId?: string | null;
  onBeginEditCard?: (cardId: string) => void;
  onCommitEditCard?: (cardId: string, text: string) => void;
  onCancelEditCard?: () => void;
  onCardContextMenu?: (cardId: string, clientX: number, clientY: number, trigger: HTMLElement) => void;
  onBackgroundContextMenu?: (clientX: number, clientY: number, worldX: number, worldY: number) => void;
  suggestionMoveDiffs?: SuggestionMoveDiff[];
  selectedEdgeId?: string | null;
  onEdgeSelect?: (edgeId: string) => void;
  onAggregatedEdgesChange?: (edges: AggregatedEdgeMeta[]) => void;
  showReadingOrder?: boolean;
  readingOrderEditMode?: boolean;
  onReadingOrderRemove?: (entryId: string) => void;
  onReadingOrderReorder?: (entryId: string, targetEntryId: string, position: ReadingOrderDropPosition) => void;
  visibleIslandIds?: Set<string>;
  polygonVertexEditIslandId?: string | null;
  onPolygonVertexDragStart?: (islandId: string, vertexIndex: number) => void;
  onPolygonVertexDragMove?: (islandId: string, vertexIndex: number, point: Point) => void;
  onPolygonVertexDragCommit?: (islandId: string, vertexIndex: number, point: Point) => void;
  onPolygonVertexDragCancel?: (islandId: string, vertexIndex: number) => void;
  onPolygonVertexAdd?: (islandId: string, segmentStartIndex: number, point: Point) => void;
  onPolygonVertexRemove?: (islandId: string, vertexIndex: number) => void;
  children?: ReactNode;
};

export type AggregatedEdgeSource = {
  sourceEdgeId?: string;
  sourceFromCardId: string;
  sourceToId: string;
  sourceToKind: "card" | "island";
};

export type AggregatedEdgeMeta = {
  id: string;
  fromId: string;
  toId: string;
  fromKind: "canonical" | "island";
  toKind: "canonical" | "island";
  fromLabel?: string;
  toLabel?: string;
  type: EdgeType;
  sources: AggregatedEdgeSource[];
  aggregateCount?: number;
  contributingEdgeIds?: string[];
  contributingCardIds?: string[];
  isDerivedIslandEdge?: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toScreenRect(
  worldRect: { left: number; top: number; width: number; height: number },
  transform: Transform
): { x: number; y: number; w: number; h: number } {
  return {
    x: worldRect.left * transform.zoom + transform.panX,
    y: worldRect.top * transform.zoom + transform.panY,
    w: worldRect.width * transform.zoom,
    h: worldRect.height * transform.zoom,
  };
}

function estimateTextWidth(text: string): number {
  return Math.max(24, text.length * LABEL_CHAR_WIDTH);
}

function buildCardLabelRect(card: { x: number; y: number; text: string }, compactMode: boolean, transform: Transform) {
  const text = compactMode ? card.text.trim().split(/\n+/).join(" ").slice(0, 72) : card.text;
  const width = Math.min(220 - CARD_LABEL_PADDING_X * 2, estimateTextWidth(text));
  const height = LABEL_LINE_HEIGHT * (compactMode ? 2 : 3);
  return toScreenRect(
    {
      left: card.x + CARD_LABEL_PADDING_X,
      top: card.y + CARD_LABEL_PADDING_Y + (compactMode ? 0 : 4),
      width,
      height,
    },
    transform
  );
}

export function focusTransformAtWorldPoint(
  currentTransform: Transform,
  worldPoint: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number
): Transform {
  return {
    ...currentTransform,
    panX: viewportWidth / 2 - worldPoint.x * currentTransform.zoom,
    panY: viewportHeight / 2 - worldPoint.y * currentTransform.zoom,
  };
}

function canStartDrag(event: PointerEvent<HTMLDivElement>): boolean {
  if (event.pointerType === "mouse") {
    return event.button === 0;
  }

  return true;
}

function shouldUseSpacePan(eventTarget: EventTarget | null, viewport: HTMLElement | null): boolean {
  if (!(eventTarget instanceof Element)) return true;
  if (eventTarget === document.body) return true;
  if (!viewport?.contains(eventTarget)) return false;

  return !eventTarget.closest(
    [
      "a",
      "button",
      "input",
      "select",
      "textarea",
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="tab"]',
      '[role="textbox"]',
    ].join(",")
  );
}

export function CanvasShell({
  document,
  onCardMove,
  onCardMoveCommit,
  selectedCardIds,
  onCardSelect,
  onCanvasBackgroundClick,
  onMarqueeSelect,
  onTransformChange,
  onCameraChange,
  cameraTransformRequest = null,
  hiddenCardIds,
  deemphasizedCardIds,
  hideSourceCards = true,
  viewState,
  peekCardIds,
  revealCardIds,
  showCanonicalOnlyEdges = false,
  summaryView = false,
  abstractMapView = false,
  lodEnabled = false,
  lodThresholds,
  lodLevelOverride = null,
  lodShowLoneWolvesWhenFar = true,
  showProtectionMarks = true,
  showSeqNumbers = false,
  effectiveCollapsedIslandIds,
  showDerivedIslandEdges = false,
  searchQuery = "",
  matchedCardIds,
  activeMatchedCardId,
  focusCardId,
  focusWorldPoint,
  focusRequestSeq = 0,
  flashReference = null,
  flashRequestSeq = 0,
  isPickingEdgeTarget = false,
  editingCardId,
  onBeginEditCard,
  onCommitEditCard,
  onCancelEditCard,
  onCardContextMenu,
  onBackgroundContextMenu,
  suggestionMoveDiffs,
  selectedEdgeId,
  onEdgeSelect,
  onAggregatedEdgesChange,
  showReadingOrder = false,
  readingOrderEditMode = false,
  onReadingOrderRemove,
  onReadingOrderReorder,
  visibleIslandIds,
  polygonVertexEditIslandId = null,
  onPolygonVertexDragStart,
  onPolygonVertexDragMove,
  onPolygonVertexDragCommit,
  onPolygonVertexDragCancel,
  onPolygonVertexAdd,
  onPolygonVertexRemove,
  children,
}: CanvasShellProps) {
  const effectiveHideSourceCards = viewState?.hideSourceCards ?? hideSourceCards;
  const effectiveShowCanonicalOnlyEdges = viewState?.showCanonicalOnlyEdges ?? showCanonicalOnlyEdges;
  const effectiveShowReadingOrder = viewState?.showReadingOrder ?? showReadingOrder;
  const showLabelBounds = viewState?.showLabelBounds ?? false;
  const highlightEdgeIds = viewState?.highlightEdgeIds ?? [];
  const evidenceOverlayEdges = viewState?.evidenceOverlayEdges ?? [];
  const evidenceOverlayDimCardIds = viewState?.evidenceOverlayDimCardIds ?? new Set<string>();
  const evidenceOverlayHint = viewState?.evidenceOverlayHint ?? null;
  const highlightCardIds = viewState?.highlightCardIds ?? new Set<string>();
  const perspectiveHint = viewState?.perspectiveHint ?? null;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [transform, setTransform] = useState<Transform>(document.transform);
  const transformRef = useRef<Transform>(document.transform);
  const [dragMode, setDragMode] = useState<"none" | "pan" | "marquee">("none");
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [activeFlashReference, setActiveFlashReference] = useState<FocusReference | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.code === "Space" && shouldUseSpacePan(event.target, viewportRef.current)) {
        event.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.code === "Space") {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  useEffect(() => {
    setTransform(document.transform);
  }, [document.transform]);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    if (!onTransformChange) {
      return;
    }

    onTransformChange(transform);
  }, [onTransformChange, transform]);


  useEffect(() => {
    if (!cameraTransformRequest) {
      return;
    }

    setTransform({
      panX: cameraTransformRequest.panX,
      panY: cameraTransformRequest.panY,
      zoom: cameraTransformRequest.zoom,
    });
  }, [cameraTransformRequest]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const updateViewportSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      });
    };

    updateViewportSize();
    const observer = new ResizeObserver(updateViewportSize);
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!onCameraChange || viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }

    onCameraChange({
      panX: transform.panX,
      panY: transform.panY,
      zoom: transform.zoom,
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
    });
  }, [onCameraChange, transform.panX, transform.panY, transform.zoom, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    if (focusWorldPoint) {
      setTransform((previousTransform) =>
        focusTransformAtWorldPoint(previousTransform, focusWorldPoint, viewport.clientWidth, viewport.clientHeight)
      );
      return;
    }

    if (!focusCardId) {
      return;
    }

    const targetCard = document.cards.find((card) => card.id === focusCardId);
    if (!targetCard) {
      return;
    }

    setTransform((previousTransform) =>
      focusTransformAtWorldPoint(
        previousTransform,
        {
          x: targetCard.x + CARD_WIDTH / 2,
          y: targetCard.y + CARD_HEIGHT / 2,
        },
        viewport.clientWidth,
        viewport.clientHeight
      )
    );
  }, [document.cards, focusCardId, focusRequestSeq, focusWorldPoint]);

  useEffect(() => {
    if (!flashReference) {
      return;
    }

    setActiveFlashReference(flashReference);
    const timeoutId = window.setTimeout(() => {
      setActiveFlashReference((previousReference) => {
        if (
          previousReference?.kind === flashReference.kind &&
          previousReference.id === flashReference.id
        ) {
          return null;
        }
        return previousReference;
      });
    }, 1000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [flashReference, flashRequestSeq]);

  const selectedCardIdSet = useMemo(() => new Set(selectedCardIds), [selectedCardIds]);
  const emptyIdSet = useMemo(() => new Set<string>(), []);

  const sourceCardIdSet = useMemo(() => {
    if (!effectiveHideSourceCards) {
      return emptyIdSet;
    }
    return new Set(
      document.cards
        .filter((card) => isSourceCard(card))
        .map((card) => card.id)
    );
  }, [document.cards, effectiveHideSourceCards, emptyIdSet]);
  const revealedCardIdSet = revealCardIds ?? peekCardIds ?? emptyIdSet;

  const hiddenCardIdSet = hiddenCardIds ?? emptyIdSet;
  const deemphasizedCardIdSet = deemphasizedCardIds ?? emptyIdSet;
  const visibleIslandIdSet = visibleIslandIds ?? emptyIdSet;
  const effectiveCollapsedIslandIdSet = effectiveCollapsedIslandIds ?? emptyIdSet;

  const lod = useMemo(() => {
    if (!lodEnabled) {
      return null;
    }

    return getLODLevel(transform.zoom, { lodThresholds, lodLevelOverride });
  }, [lodEnabled, lodLevelOverride, lodThresholds, transform.zoom]);

  /*
   * Manual test steps (Abstract Map View):
   * 1) Turn on Abstract map view from View controls.
   * 2) Confirm non-lone-wolf cards hide, island summaries stay visible, and UNREVIEWED badges appear for draft summaries.
   * 3) Select an island and use temporary reveal/focus controls, then reload and confirm reveal state is not persisted.
   */
  const abstractMemberCardIdSet = useMemo(() => {
    if (!abstractMapView) {
      return emptyIdSet;
    }

    const memberCardIds = new Set<string>();
    for (const island of document.islands) {
      for (const cardId of island.cardIds) {
        memberCardIds.add(cardId);
      }
    }

    return memberCardIds;
  }, [abstractMapView, document.islands, emptyIdSet]);

  const loneWolfCardIdSet = useMemo(() => {
    const islandMemberCardIds = new Set<string>();
    for (const island of document.islands) {
      for (const cardId of island.cardIds) {
        islandMemberCardIds.add(cardId);
      }
    }

    return new Set(document.cards.map((card) => card.id).filter((cardId) => !islandMemberCardIds.has(cardId)));
  }, [document.cards, document.islands]);

  // UX-VISUAL-02 (ADR-0048 D3): deterministic protection set = lone-wolf cards,
  // but only once clustering has begun (>=1 island) so isolation is meaningful
  // (in a fresh doc every card is unclustered, which is not a "minority").
  const protectedCardIdSet = useMemo(() => {
    if (!showProtectionMarks || document.islands.length === 0) {
      return new Set<string>();
    }
    return loneWolfCardIdSet;
  }, [showProtectionMarks, document.islands.length, loneWolfCardIdSet]);

  const isCardHidden = useCallback(
    (cardId: string) => {
      if (hiddenCardIdSet.has(cardId)) {
        return true;
      }

      if (sourceCardIdSet.has(cardId) && !revealedCardIdSet.has(cardId)) {
        return true;
      }

      if (abstractMapView && abstractMemberCardIdSet.has(cardId) && !revealedCardIdSet.has(cardId)) {
        return true;
      }

      if (lod?.rules.showCards === false && !revealedCardIdSet.has(cardId)) {
        if (lodShowLoneWolvesWhenFar && lod.level === "far" && loneWolfCardIdSet.has(cardId)) {
          return false;
        }
        return true;
      }

      return false;
    },
    [
      abstractMapView,
      abstractMemberCardIdSet,
      hiddenCardIdSet,
      sourceCardIdSet,
      revealedCardIdSet,
      lod,
      lodShowLoneWolvesWhenFar,
      loneWolfCardIdSet,
    ]
  );

  const hiddenEndpointIdSet = useMemo(() => {
    const hiddenSourceCardIds = Array.from(sourceCardIdSet).filter((cardId) => !revealedCardIdSet.has(cardId));
    const hiddenAbstractCardIds =
      abstractMapView
        ? Array.from(abstractMemberCardIdSet).filter((cardId) => !revealedCardIdSet.has(cardId))
        : [];
    const hiddenLodCardIds =
      lod?.rules.showCards === false
        ? document.cards
            .map((card) => card.id)
            .filter(
              (cardId) =>
                !revealedCardIdSet.has(cardId) &&
                !(lodShowLoneWolvesWhenFar && lod.level === "far" && loneWolfCardIdSet.has(cardId))
            )
        : [];
    return new Set([...hiddenCardIdSet, ...hiddenSourceCardIds, ...hiddenAbstractCardIds, ...hiddenLodCardIds]);
  }, [abstractMapView, abstractMemberCardIdSet, hiddenCardIdSet, sourceCardIdSet, revealedCardIdSet, lod, document.cards, lodShowLoneWolvesWhenFar, loneWolfCardIdSet]);

  const visibleCards = useMemo(() => {
    return document.cards.filter((card) => !isCardHidden(card.id));
  }, [document.cards, isCardHidden]);
  const visibleCardIdSet = useMemo(() => new Set(visibleCards.map((card) => card.id)), [visibleCards]);
  const visibleIslands = useMemo(
    () => document.islands.filter((island) => visibleIslandIdSet.has(island.id)),
    [document.islands, visibleIslandIdSet]
  );
  const labelCullingResult = useMemo(() => {
    const candidates: LabelItem[] = [];

    for (const island of document.islands) {
      if (!visibleIslandIdSet.has(island.id)) {
        continue;
      }

      const bounds = getIslandBounds(island, document.cards);
      if (!bounds) {
        continue;
      }

      const islandTitle = resolveIslandDisplayTitle(island, document.islands);
      candidates.push({
        id: buildIslandTitleLabelId(island.id),
        kind: "islandTitle",
        priority: LABEL_PRIORITIES.islandTitle,
        rect: toScreenRect(
          {
            left: bounds.left + ISLAND_TITLE_MARGIN_LEFT,
            top: bounds.top + ISLAND_TITLE_MARGIN_TOP,
            width: estimateTextWidth(islandTitle) + 70,
            height: 20,
          },
          transform
        ),
        text: islandTitle,
        payload: { islandId: island.id },
      });

      const hasSummary = typeof island.summaryText === "string" && island.summaryText.trim().length > 0;
      const shouldShowSummary =
        lod?.level === "mid"
          ? summaryView || island.summaryReviewed !== false
          : summaryView || abstractMapView || lod?.level === "far";
      const showsSummaryBlock = (hasSummary && shouldShowSummary) || abstractMapView;

      if (showsSummaryBlock) {
        const summaryText = hasSummary ? island.summaryText ?? "" : t("canvas.island.no_summary");
        const summaryWidth = Math.min(320, Math.max(120, estimateTextWidth(summaryText)));
        candidates.push({
          id: buildIslandSummaryLabelId(island.id),
          kind: "islandSummary",
          priority: LABEL_PRIORITIES.islandSummary,
          rect: toScreenRect(
            {
              left: bounds.left + ISLAND_TITLE_MARGIN_LEFT,
              top: bounds.top + ISLAND_TITLE_MARGIN_TOP + 28,
              width: summaryWidth,
              height: LABEL_LINE_HEIGHT * 2 + 4,
            },
            transform
          ),
          text: summaryText,
          payload: { islandId: island.id },
        });

        if (island.summaryReviewed === false && hasSummary) {
          candidates.push({
            id: buildIslandUnreviewedLabelId(island.id),
            kind: "unreviewed",
            priority: LABEL_PRIORITIES.unreviewed,
            rect: toScreenRect(
              {
                left: bounds.left + Math.max(40, bounds.width - 124),
                top: bounds.top + ISLAND_TITLE_MARGIN_TOP + 28,
                width: 96,
                height: 18,
              },
              transform
            ),
            text: t("canvas.island.unreviewed_badge"),
            payload: { islandId: island.id },
          });
        }
      } else if (island.summaryReviewed === false && hasSummary) {
        candidates.push({
          id: buildIslandUnreviewedLabelId(island.id),
          kind: "unreviewed",
          priority: LABEL_PRIORITIES.unreviewed,
          rect: toScreenRect(
            {
              left: bounds.left + Math.max(40, bounds.width - 124),
              top: bounds.top + ISLAND_TITLE_MARGIN_TOP,
              width: 96,
              height: 18,
            },
            transform
          ),
          text: t("canvas.island.unreviewed_badge"),
          payload: { islandId: island.id },
        });
      }
    }

    if (lod?.level !== "far") {
      for (const card of visibleCards) {
        // QA-MONKEY-10: selected / in-edit cards win the overlap contest so
        // freshly typed text never visually disappears under a neighbour.
        const isActiveCard = selectedCardIdSet.has(card.id) || editingCardId === card.id;
        candidates.push({
          id: buildCardLabelId(card.id),
          kind: "card",
          priority: isActiveCard ? ACTIVE_CARD_LABEL_PRIORITY : LABEL_PRIORITIES.card,
          rect: buildCardLabelRect(card, Boolean(lod?.rules.compactCards), transform),
          text: card.text,
          payload: { cardId: card.id },
        });
      }
    }

    return cullLabels(candidates);
  }, [
    abstractMapView,
    document.cards,
    document.islands,
    editingCardId,
    lod,
    selectedCardIdSet,
    summaryView,
    transform,
    visibleCards,
    visibleIslandIdSet,
  ]);
  const acceptedLabelIds = labelCullingResult.acceptedIds;

  const highlightedCard = useMemo(() => {
    if (activeFlashReference?.kind !== "card") {
      return null;
    }

    return visibleCards.find((card) => card.id === activeFlashReference.id) ?? null;
  }, [activeFlashReference, visibleCards]);
  const highlightedIsland = useMemo(() => {
    if (activeFlashReference?.kind !== "island") {
      return null;
    }

    return document.islands.find((island) => island.id === activeFlashReference.id) ?? null;
  }, [activeFlashReference, document.islands]);
  const highlightedIslandBounds = useMemo(() => {
    if (!highlightedIsland) {
      return null;
    }

    const focusedCards = document.cards.filter((card) => highlightedIsland.cardIds.includes(card.id));
    if (focusedCards.length === 0) {
      return null;
    }

    const minX = Math.min(...focusedCards.map((card) => card.x)) - 24;
    const minY = Math.min(...focusedCards.map((card) => card.y)) - 24;
    const maxX = Math.max(...focusedCards.map((card) => card.x + CARD_WIDTH)) + 24;
    const maxY = Math.max(...focusedCards.map((card) => card.y + CARD_HEIGHT)) + 24;

    return {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [document.cards, highlightedIsland]);
  const canonicalCardIdSet = useMemo(
    () => new Set(document.cards.filter((card) => isCanonicalCard(card)).map((card) => card.id)),
    [document.cards]
  );

  const aggregatedEdges = useMemo(() => {
    const cardsById = new Map(document.cards.map((card) => [card.id, card]));
    const grouped = new Map<string, AggregatedEdgeMeta>();

    for (const edge of document.edges) {
      const edgeWithKinds = edge as typeof edge & { fromKind?: "card" | "island"; toKind?: "card" | "island" };
      const sourceFromKind = edgeWithKinds.fromKind ?? "card";
      const sourceToKind = edgeWithKinds.toKind ?? "card";

      const fromCard = sourceFromKind === "card" ? cardsById.get(edge.fromId) : undefined;
      const toCard = sourceToKind === "card" ? cardsById.get(edge.toId) : undefined;
      const resolvedFromId = sourceFromKind === "card" ? fromCard?.canonicalId ?? edge.fromId : edge.fromId;
      const resolvedToId = sourceToKind === "card" ? toCard?.canonicalId ?? edge.toId : edge.toId;
      const resolvedFromKind = sourceFromKind === "island" ? "island" : "canonical";
      const resolvedToKind = sourceToKind === "island" ? "island" : "canonical";

      if (resolvedFromId === resolvedToId && resolvedFromKind === resolvedToKind) {
        continue;
      }

      const key = `${resolvedFromKind}:${resolvedFromId}->${resolvedToKind}:${resolvedToId}:${edge.type}`;
      const current = grouped.get(key);
      const nextSource: AggregatedEdgeSource = {
        sourceEdgeId: edge.id,
        sourceFromCardId: edge.fromId,
        sourceToId: edge.toId,
        sourceToKind: sourceToKind,
      };

      if (current) {
        current.sources.push(nextSource);
        continue;
      }

      grouped.set(key, {
        id: key,
        fromId: resolvedFromId,
        toId: resolvedToId,
        fromKind: resolvedFromKind,
        toKind: resolvedToKind,
        fromLabel: resolvedFromKind === "island"
          ? document.islands.find((island) => island.id === resolvedFromId)?.title?.trim() || resolvedFromId
          : cardsById.get(resolvedFromId)?.text || resolvedFromId,
        toLabel: resolvedToKind === "island"
          ? document.islands.find((island) => island.id === resolvedToId)?.title?.trim() || resolvedToId
          : cardsById.get(resolvedToId)?.text || resolvedToId,
        type: edge.type,
        sources: [nextSource],
      });
    }

    return Array.from(grouped.values());
  }, [document.cards, document.edges]);

  const derivedIslandEdges = useMemo(() => {
    if (!showDerivedIslandEdges) {
      return [];
    }

    return getDerivedIslandEdges(document);
  }, [document, showDerivedIslandEdges]);

  const derivedIslandEdgeMeta = useMemo<AggregatedEdgeMeta[]>(() => {
    return derivedIslandEdges.map((edge) => ({
      id: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      fromKind: "island",
      toKind: edge.toKind === "island" ? "island" : "canonical",
      fromLabel: document.islands.find((island) => island.id === edge.fromId)?.title?.trim() || edge.fromId,
      toLabel:
        edge.toKind === "island"
          ? document.islands.find((island) => island.id === edge.toId)?.title?.trim() || edge.toId
          : document.cards.find((card) => card.id === edge.toId)?.text?.trim() || edge.toId,
      type: edge.type,
      sources: [],
      aggregateCount: edge.aggregateCount,
      contributingEdgeIds: edge.contributingEdgeIds,
      contributingCardIds: edge.contributingCardIds,
      isDerivedIslandEdge: true,
    }));
  }, [derivedIslandEdges]);

  const cardMembershipById = useMemo(() => {
    const memberships = new Map<string, Set<string>>();

    for (const island of document.islands) {
      for (const cardId of island.cardIds) {
        const current = memberships.get(cardId) ?? new Set<string>();
        current.add(island.id);
        memberships.set(cardId, current);
      }
    }

    return memberships;
  }, [document.islands]);

  const visibleEdges = useMemo(() => {
    let edges = getEdgesToRender(document, effectiveHideSourceCards === true).filter((edge) => {
      const isFromVisible = edge.fromKind === "island" ? visibleIslandIdSet.has(edge.fromId) : visibleCardIdSet.has(edge.fromId);
      const isToVisible = edge.toKind === "island" ? visibleIslandIdSet.has(edge.toId) : visibleCardIdSet.has(edge.toId);
      return isFromVisible && isToVisible;
    });

    if (effectiveShowCanonicalOnlyEdges) {
      edges = edges.filter((edge) => {
        return (
          edge.fromKind === "card" &&
          edge.toKind === "card" &&
          canonicalCardIdSet.has(edge.fromId) &&
          canonicalCardIdSet.has(edge.toId)
        );
      });
    }

    edges = edges.filter((edge) => {
      if (edge.fromKind !== "card" || edge.toKind !== "card") {
        return true;
      }

      const fromMemberships = cardMembershipById.get(edge.fromId);
      const toMemberships = cardMembershipById.get(edge.toId);
      if (!fromMemberships || !toMemberships) {
        return true;
      }

      for (const islandId of fromMemberships) {
        if (effectiveCollapsedIslandIdSet.has(islandId) && toMemberships.has(islandId)) {
          return false;
        }
      }

      return true;
    });

    if (lod && !lod.rules.showCardEdges) {
      edges = edges.filter((edge) => edge.fromKind === "island" && edge.toKind === "island");
    }

    if (showDerivedIslandEdges || (lod?.level === "far" && lod.rules.showIslandEdges)) {
      edges = [
        ...edges,
        ...derivedIslandEdges.filter((edge) => {
          if (!visibleIslandIdSet.has(edge.fromId)) {
            return false;
          }
          return edge.toKind === "island" ? visibleIslandIdSet.has(edge.toId) : visibleCardIdSet.has(edge.toId);
        }),
      ];
    }

    return edges;
  }, [
    canonicalCardIdSet,
    cardMembershipById,
    derivedIslandEdges,
    document,
    effectiveCollapsedIslandIdSet,
    effectiveHideSourceCards,
    effectiveShowCanonicalOnlyEdges,
    visibleCardIdSet,
    visibleIslandIdSet,
    showDerivedIslandEdges,
    lod,
  ]);

  const visibleEdgeInspectorMeta = useMemo(() => {
    const visibleIds = new Set(visibleEdges.map((edge) => edge.id));
    const edgeMetaById = new Map<string, AggregatedEdgeMeta>();

    for (const edgeMeta of [...aggregatedEdges, ...derivedIslandEdgeMeta]) {
      if (visibleIds.has(edgeMeta.id)) {
        edgeMetaById.set(edgeMeta.id, edgeMeta);
      }
    }

    // DOMAIN-KJ-01: every non-derived visible edge (card↔card and mixed
    // endpoints included, not just island↔island) gets inspector meta, so
    // selecting any persisted relation line opens the inspector and its
    // relation-type control. Previously card↔card selections had no meta and
    // were silently deselected by App's stale-selection cleanup effect.
    const cardsForLabels = new Map(document.cards.map((card) => [card.id, card]));
    const labelFor = (kind: "card" | "island", id: string): string =>
      kind === "island"
        ? document.islands.find((island) => island.id === id)?.title?.trim() || id
        : cardsForLabels.get(id)?.text || id;

    for (const edge of visibleEdges) {
      if (edgeMetaById.has(edge.id) || edge.isDerived) {
        continue;
      }

      edgeMetaById.set(edge.id, {
        id: edge.id,
        fromId: edge.fromId,
        toId: edge.toId,
        fromKind: edge.fromKind === "island" ? "island" : "canonical",
        toKind: edge.toKind === "island" ? "island" : "canonical",
        fromLabel: labelFor(edge.fromKind, edge.fromId),
        toLabel: labelFor(edge.toKind, edge.toId),
        type: edge.type,
        sources: [
          {
            sourceEdgeId: edge.id,
            sourceFromCardId: edge.fromId,
            sourceToId: edge.toId,
            sourceToKind: edge.toKind,
          },
        ],
      });
    }

    return Array.from(edgeMetaById.values());
  }, [aggregatedEdges, derivedIslandEdgeMeta, document.cards, document.islands, visibleEdges]);

  useEffect(() => {
    onAggregatedEdgesChange?.(visibleEdgeInspectorMeta);
  }, [onAggregatedEdgesChange, visibleEdgeInspectorMeta]);
  const visibleSuggestionMoveDiffs = useMemo(() => {
    const diffs = suggestionMoveDiffs ?? [];
    return diffs.filter((diff) => !isCardHidden(diff.cardId));
  }, [isCardHidden, suggestionMoveDiffs]);

  const clearDragState = useCallback((event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragMode("none");
    setMarqueeRect(null);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleCardMove = useCallback(
    (cardId: string, deltaScreenX: number, deltaScreenY: number) => {
      const currentZoom = transformRef.current.zoom;
      onCardMove(cardId, deltaScreenX / currentZoom, deltaScreenY / currentZoom);
    },
    [onCardMove]
  );

  const handleCardCommit = useCallback(
    (cardId: string, deltaScreenX: number, deltaScreenY: number) => {
      const currentZoom = transformRef.current.zoom;
      onCardMoveCommit?.(cardId, deltaScreenX / currentZoom, deltaScreenY / currentZoom);
    },
    [onCardMoveCommit]
  );

  const handleCardSelect = useCallback(
    (cardId: string, isShiftPressed: boolean) => {
      onCardSelect(cardId, isShiftPressed);
    },
    [onCardSelect]
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.altKey && polygonVertexEditIslandId && polygonVertexEditShape && onPolygonVertexAdd) {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const worldPoint = {
        x: (event.clientX - rect.left - transform.panX) / transform.zoom,
        y: (event.clientY - rect.top - transform.panY) / transform.zoom,
      };
      const segmentStartIndex = findNearestPolygonSegmentIndex(polygonVertexEditShape.points, worldPoint, 8 / transform.zoom);
      if (segmentStartIndex !== null) {
        event.preventDefault();
        event.stopPropagation();
        onPolygonVertexAdd(polygonVertexEditIslandId, segmentStartIndex, worldPoint);
        return;
      }
    }

    if (!canStartDrag(event)) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const startScreenX = event.clientX - rect.left;
    const startScreenY = event.clientY - rect.top;

    const mode = isSpacePressed ? "pan" : "marquee";

    dragRef.current = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startScreenX,
      startScreenY,
      didMove: false,
      mode,
    };
    setDragMode(mode);

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - drag.lastClientX;
    const deltaY = event.clientY - drag.lastClientY;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    dragRef.current = {
      ...drag,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      didMove: true,
    };

    if (drag.mode === "marquee") {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const currentScreenX = event.clientX - rect.left;
      const currentScreenY = event.clientY - rect.top;
      const left = Math.min(drag.startScreenX, currentScreenX);
      const top = Math.min(drag.startScreenY, currentScreenY);
      const width = Math.abs(currentScreenX - drag.startScreenX);
      const height = Math.abs(currentScreenY - drag.startScreenY);

      setMarqueeRect({
        x: left,
        y: top,
        width,
        height,
      });
      return;
    }

    setTransform((prev) => applyPan(prev, deltaX, deltaY));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (!drag.didMove) {
      onCanvasBackgroundClick();
    } else if (drag.mode === "marquee") {
      const viewport = viewportRef.current;
      if (!viewport) {
        clearDragState(event);
        return;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const endScreenX = event.clientX - viewportRect.left;
      const endScreenY = event.clientY - viewportRect.top;
      const selectionRect = {
        x: Math.min(drag.startScreenX, endScreenX),
        y: Math.min(drag.startScreenY, endScreenY),
        width: Math.abs(endScreenX - drag.startScreenX),
        height: Math.abs(endScreenY - drag.startScreenY),
      };

      const worldRect = {
        x: (selectionRect.x - transform.panX) / transform.zoom,
        y: (selectionRect.y - transform.panY) / transform.zoom,
        width: selectionRect.width / transform.zoom,
        height: selectionRect.height / transform.zoom,
      };

      const intersects = (cardX: number, cardY: number) => {
        return (
          cardX < worldRect.x + worldRect.width &&
          cardX + CARD_WIDTH > worldRect.x &&
          cardY < worldRect.y + worldRect.height &&
          cardY + CARD_HEIGHT > worldRect.y
        );
      };

      const selectedByMarquee = visibleCards
        .filter((card) => intersects(card.x, card.y))
        .map((card) => card.id);

      onMarqueeSelect(selectedByMarquee, event.shiftKey);
    }

    clearDragState(event);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    clearDragState(event);
  };

  const polygonVertexEditShape = useMemo(() => {
    if (!polygonVertexEditIslandId) {
      return null;
    }

    const targetIsland = document.islands.find((island) => island.id === polygonVertexEditIslandId);
    if (!targetIsland || targetIsland.shape?.kind !== "polygon") {
      return null;
    }

    return targetIsland.shape;
  }, [document.islands, polygonVertexEditIslandId]);

  // QA-MONKEY-18: a JSX `onWheel` handler is registered by React as a passive
  // listener, so `event.preventDefault()` inside it is a silent no-op and logs
  // "Unable to preventDefault inside passive event listener invocation." on
  // every wheel tick. Zoom needs to block the browser's native wheel behavior
  // (page scroll / ctrl+wheel page zoom), so this attaches a real, non-passive
  // DOM listener instead.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const handleWheelNative = (event: globalThis.WheelEvent) => {
      event.preventDefault();

      const rect = viewport.getBoundingClientRect();
      const screenPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      setTransform((prev) => {
        const factor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
        const unclampedZoom = prev.zoom * factor;
        const nextZoom = clamp(unclampedZoom, MIN_ZOOM, MAX_ZOOM);
        const actualFactor = nextZoom / prev.zoom;

        if (actualFactor === 1) {
          return prev;
        }

        return applyZoomAtScreenPoint(prev, actualFactor, screenPoint);
      });
    };

    viewport.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", handleWheelNative);
    };
  }, []);

  return (
    <div
      ref={viewportRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(event) => {
        if (!onBackgroundContextMenu) {
          return;
        }
        const viewport = viewportRef.current;
        if (!viewport) {
          return;
        }
        event.preventDefault();
        const rect = viewport.getBoundingClientRect();
        const worldX = (event.clientX - rect.left - transform.panX) / transform.zoom;
        const worldY = (event.clientY - rect.top - transform.panY) / transform.zoom;
        onBackgroundContextMenu(event.clientX, event.clientY, worldX, worldY);
      }}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        touchAction: "none",
        backgroundColor: "#fbfbfb",
        backgroundImage:
          "linear-gradient(to right, rgba(30, 41, 59, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(30, 41, 59, 0.08) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        cursor: dragMode === "pan" ? "grabbing" : isSpacePressed ? "grab" : "default",
      }}
    >
      <LabelVisibilityContext.Provider value={{ acceptedLabelIds }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom})`,
          transformOrigin: "0 0",
        }}
      >
        <EdgeLayer
          // Full card list (not visibleCards): EdgeLayer only uses `cards`
          // to compute anchor CENTERS, including the bbox-fallback for an
          // island with no persisted polygon, which needs its member cards'
          // positions even when those members are individually hidden by
          // LOD compaction. hiddenCardIds below still independently blocks
          // any edge whose card endpoint is genuinely hidden from rendering.
          cards={document.cards}
          islands={visibleIslands}
          edges={visibleEdges}
          hiddenCardIds={hiddenEndpointIdSet}
          selectedEdgeId={selectedEdgeId}
          highlightedEdgeIds={highlightEdgeIds}
          onEdgeSelect={onEdgeSelect}
        />
        <SuggestionDiffLayer diffs={visibleSuggestionMoveDiffs} cardWidth={CARD_WIDTH} cardHeight={CARD_HEIGHT} />
        {effectiveShowReadingOrder ? (
          <ReadingOrderLayer
            cards={document.cards}
            islands={visibleIslands}
            readingOrder={document.readingOrder ?? []}
            visibleCardIdSet={visibleCardIdSet}
            visibleIslandIdSet={visibleIslandIdSet}
            isEditMode={readingOrderEditMode}
            onRemoveEntry={onReadingOrderRemove}
            onReorderEntry={onReadingOrderReorder}
            onItemFocus={(_entryId, _kind, worldPoint) => {
              const viewport = viewportRef.current;
              if (!viewport) {
                return;
              }

              setTransform((previousTransform) =>
                focusTransformAtWorldPoint(previousTransform, worldPoint, viewport.clientWidth, viewport.clientHeight)
              );
            }}
          />
        ) : null}
        {children}
        {highlightedIslandBounds ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: highlightedIslandBounds.left,
              top: highlightedIslandBounds.top,
              width: highlightedIslandBounds.width,
              height: highlightedIslandBounds.height,
              border: "3px solid #f59e0b",
              borderRadius: 14,
              boxShadow: "0 0 0 4px rgba(245, 158, 11, 0.2)",
              pointerEvents: "none",
            }}
          />
        ) : null}
        {highlightedCard ? (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: highlightedCard.x - 4,
              top: highlightedCard.y - 4,
              width: CARD_WIDTH + 8,
              height: CARD_HEIGHT + 8,
              border: "3px solid #f59e0b",
              borderRadius: 10,
              boxShadow: "0 0 0 4px rgba(245, 158, 11, 0.2)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
        ) : null}
        {evidenceOverlayEdges.length > 0 ? <EvidenceOverlayLayer cards={visibleCards} edges={evidenceOverlayEdges} /> : null}
        {visibleCards.map((card) => {
          return (
            <CardView
              key={card.id}
              card={card}
              onMove={handleCardMove}
              onCommitMove={onCardMoveCommit ? handleCardCommit : undefined}
              isSelected={selectedCardIdSet.has(card.id)}
              onSelect={handleCardSelect}
              searchQuery={searchQuery}
              isSearchMatch={matchedCardIds?.has(card.id) ?? false}
              isActiveSearchMatch={activeMatchedCardId === card.id}
              isPickingEdgeTarget={isPickingEdgeTarget}
              isDeemphasized={deemphasizedCardIdSet.has(card.id) || evidenceOverlayDimCardIds.has(card.id)}
              isHighlighted={highlightCardIds.has(card.id)}
              compactMode={Boolean(lod?.rules.compactCards)}
              markerMode={Boolean(lod && lod.level === "far" && lodShowLoneWolvesWhenFar && loneWolfCardIdSet.has(card.id))}
              isProtected={protectedCardIdSet.has(card.id)}
              showSeqNumber={showSeqNumbers}
              showLabelText={acceptedLabelIds.has(buildCardLabelId(card.id))}
              isEditing={editingCardId === card.id}
              onBeginEdit={onBeginEditCard}
              onCommitEdit={onCommitEditCard}
              onCancelEdit={onCancelEditCard}
              onCardContextMenu={onCardContextMenu}
            />
          );
        })}
        {polygonVertexEditIslandId && polygonVertexEditShape && onPolygonVertexDragCommit && onPolygonVertexRemove ? (
          <PolygonEditLayer
            points={polygonVertexEditShape.points}
            onVertexDragStart={(vertexIndex) => {
              onPolygonVertexDragStart?.(polygonVertexEditIslandId, vertexIndex);
            }}
            onVertexDragMove={(vertexIndex, screenPoint) => {
              if (!onPolygonVertexDragMove) {
                return;
              }

              const viewport = viewportRef.current;
              if (!viewport) {
                return;
              }

              const rect = viewport.getBoundingClientRect();
              const worldPoint = {
                x: (screenPoint.x - rect.left - transform.panX) / transform.zoom,
                y: (screenPoint.y - rect.top - transform.panY) / transform.zoom,
              };
              onPolygonVertexDragMove(polygonVertexEditIslandId, vertexIndex, worldPoint);
            }}
            onVertexDragCommit={(vertexIndex, screenPoint) => {
              const viewport = viewportRef.current;
              if (!viewport) {
                return;
              }

              const rect = viewport.getBoundingClientRect();
              const worldPoint = {
                x: (screenPoint.x - rect.left - transform.panX) / transform.zoom,
                y: (screenPoint.y - rect.top - transform.panY) / transform.zoom,
              };
              onPolygonVertexDragCommit(polygonVertexEditIslandId, vertexIndex, worldPoint);
            }}
            onVertexDragCancel={(vertexIndex) => {
              onPolygonVertexDragCancel?.(polygonVertexEditIslandId, vertexIndex);
            }}
            onVertexNudge={(vertexIndex, screenDelta) => {
              const currentPoint = polygonVertexEditShape.points[vertexIndex];
              if (!currentPoint) {
                return;
              }

              onPolygonVertexDragCommit(polygonVertexEditIslandId, vertexIndex, {
                x: currentPoint.x + screenDelta.x / transform.zoom,
                y: currentPoint.y + screenDelta.y / transform.zoom,
              });
            }}
            onVertexRemove={(vertexIndex) => {
              onPolygonVertexRemove(polygonVertexEditIslandId, vertexIndex);
            }}
          />
        ) : null}
      </div>
      {showLabelBounds
        ? [...labelCullingResult.accepted, ...labelCullingResult.culled].map((label) => {
            const accepted = acceptedLabelIds.has(label.id);
            return (
              <div
                key={`label-debug-${label.id}`}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: label.rect.x,
                  top: label.rect.y,
                  width: label.rect.w,
                  height: label.rect.h,
                  border: `1px solid ${accepted ? "#16a34a" : "#ef4444"}`,
                  backgroundColor: accepted ? "rgba(22, 163, 74, 0.08)" : "rgba(239, 68, 68, 0.08)",
                  pointerEvents: "none",
                  zIndex: 25,
                }}
                title={`${label.kind} (${accepted ? "accepted" : "culled"})`}
              />
            );
          })
        : null}
      </LabelVisibilityContext.Provider>
      {marqueeRect && dragMode === "marquee" ? <Marquee rect={marqueeRect} /> : null}
      {evidenceOverlayHint || perspectiveHint ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            top: 12,
            backgroundColor: "rgba(15, 23, 42, 0.78)",
            color: "#f8fafc",
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          {evidenceOverlayHint ?? perspectiveHint}
        </div>
      ) : null}
    </div>
  );
}
