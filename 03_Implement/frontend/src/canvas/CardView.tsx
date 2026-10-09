import { memo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";

import { canonicalHoldState } from "../domain/hold_state_ops";
import type { Card } from "../domain/types";
import { t } from "../i18n/translate";

type CardDragState = {
  pointerId: number;
  lastClientX: number;
  lastClientY: number;
  startClientX: number;
  startClientY: number;
  didMove: boolean;
};

type CardViewProps = {
  card: Card;
  isSelected: boolean;
  isDeemphasized?: boolean;
  isHighlighted?: boolean;
  searchQuery?: string;
  isSearchMatch?: boolean;
  isActiveSearchMatch?: boolean;
  onMove: (cardId: string, deltaScreenX: number, deltaScreenY: number) => void;
  /** Opt-in: keep drag preview local, then emit one final delta on pointerup. */
  onCommitMove?: (cardId: string, deltaScreenX: number, deltaScreenY: number) => void;
  /** World-canvas zoom applied outside the CardView; defaults to 1. */
  dragPreviewZoom?: number;
  onSelect: (cardId: string, isShiftPressed: boolean) => void;
  isPickingEdgeTarget?: boolean;
  compactMode?: boolean;
  markerMode?: boolean;
  showLabelText?: boolean;
  isEditing?: boolean;
  onBeginEdit?: (cardId: string) => void;
  onCommitEdit?: (cardId: string, text: string) => void;
  onCancelEdit?: () => void;
  onCardContextMenu?: (cardId: string, clientX: number, clientY: number, trigger: HTMLElement) => void;
  /** UX-VISUAL-02: deterministic "protection" mark for a lone-wolf card. */
  isProtected?: boolean;
  /** DOMAIN-TRACE-01 AC-3: show the optional #seq badge (default OFF, View toggle). */
  showSeqNumber?: boolean;
};

function canStartDrag(event: PointerEvent<HTMLDivElement>): boolean {
  if (event.pointerType === "mouse") {
    return event.button === 0;
  }

  return true;
}

function renderHighlightedText(text: string, searchQuery: string): JSX.Element {
  if (!searchQuery) {
    return <>{text}</>;
  }

  const query = searchQuery.toLowerCase();
  const lowerText = text.toLowerCase();
  const parts: JSX.Element[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    const foundIndex = lowerText.indexOf(query, cursor);
    if (foundIndex < 0) {
      parts.push(<span key={key}>{text.slice(cursor)}</span>);
      break;
    }

    if (foundIndex > cursor) {
      parts.push(<span key={key}>{text.slice(cursor, foundIndex)}</span>);
      key += 1;
    }

    parts.push(
      <mark
        key={key}
        style={{
          backgroundColor: "#fde68a",
          color: "inherit",
          padding: 0,
        }}
      >
        {text.slice(foundIndex, foundIndex + searchQuery.length)}
      </mark>
    );
    key += 1;
    cursor = foundIndex + searchQuery.length;
  }

  return <>{parts}</>;
}

function CardViewComponent({
  card,
  isSelected,
  searchQuery = "",
  isSearchMatch = false,
  isActiveSearchMatch = false,
  onMove,
  onCommitMove,
  dragPreviewZoom = 1,
  onSelect,
  isPickingEdgeTarget = false,
  isDeemphasized = false,
  isHighlighted = false,
  compactMode = false,
  markerMode = false,
  showLabelText = true,
  isEditing = false,
  onBeginEdit,
  onCommitEdit,
  onCancelEdit,
  onCardContextMenu,
  isProtected = false,
  showSeqNumber = false,
}: CardViewProps) {
  const cardRootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<CardDragState | null>(null);
  const previewZoom = Number.isFinite(dragPreviewZoom) && dragPreviewZoom > 0 ? dragPreviewZoom : 1;
  const [isDragging, setIsDragging] = useState(false);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [isFocused, setIsFocused] = useState(false);
  const hasCritique = typeof card.critique === "string" && card.critique.trim().length > 0;
  const critiqueTagCount = card.critiqueTags?.length ?? 0;
  const claimType = card.claimType;
  const isTextReviewed = card.textReviewed === true;
  const holdState = canonicalHoldState(card.holdState);
  const representativeCount = card.repOf?.length ?? 0;
  const compactText = card.text.trim().split(/\n+/).join(" ").slice(0, 72);
  // UX-VISUAL-01 AC-3 (ADR-0048 D1): even at far LOD the "needs attention"
  // signal (unreviewed / has critique) must stay discoverable, so far-view
  // markers keep an amber tint instead of the neutral slate dot.
  const markerNeedsAttention = !isTextReviewed || hasCritique;

  // Domain state badge styling (DOMAIN-EXPR-01/02)
  const CLAIM_TYPE_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
    fact: { bg: "#dcfce7", fg: "#166534", label: t("card_view.claim_type.fact") },
    claim: { bg: "#dbeafe", fg: "#1e40af", label: t("card_view.claim_type.claim") },
    hypothesis: { bg: "#f3e8ff", fg: "#6b21a8", label: t("card_view.claim_type.hypothesis") },
    unknown: { bg: "#f1f5f9", fg: "#475569", label: "?" },
  };
  const HOLD_STATE_STYLE: Record<string, { bg: string; fg: string }> = {
    held: { bg: "#fef3c7", fg: "#92400e" },
    shelved: { bg: "#f1f5f9", fg: "#64748b" },
  };
  const holdStateLabel = holdState ? t(`side_panel.hold_state.${holdState}`) : "";
  const unreviewedDescriptionId = `card-unreviewed-description-${card.id}`;
  const restoreCardFocus = () => {
    window.requestAnimationFrame(() => {
      cardRootRef.current?.focus({ preventScroll: true });
    });
  };

  const clearDragState = (event: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setIsDragging(false);
    setPreviewOffset({ x: 0, y: 0 });

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (isEditing) {
      // While the inline text editor is open, let the textarea own pointer input
      // (do not start a card drag or change selection).
      return;
    }

    if (isPickingEdgeTarget) {
      event.stopPropagation();
      onSelect(card.id, false);
      return;
    }

    if (!canStartDrag(event)) {
      return;
    }

    event.stopPropagation();

    dragRef.current = {
      pointerId: event.pointerId,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      didMove: false,
    };
    setIsDragging(true);

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();

    const deltaScreenX = event.clientX - drag.lastClientX;
    const deltaScreenY = event.clientY - drag.lastClientY;

    if (deltaScreenX === 0 && deltaScreenY === 0) {
      return;
    }

    dragRef.current = {
      ...drag,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      didMove: true,
    };

    if (onCommitMove) {
      // This branch never mutates DocumentV1 during pointermove.
      setPreviewOffset({
        x: event.clientX - drag.startClientX,
        y: event.clientY - drag.startClientY,
      });
    } else {
      onMove(card.id, deltaScreenX, deltaScreenY);
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();

    // Release the local preview first, even if a caller fails to commit.
    clearDragState(event);

    if (!drag.didMove) {
      onSelect(card.id, event.shiftKey);
    } else if (onCommitMove) {
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (dx !== 0 || dy !== 0) {
        onCommitMove(card.id, dx, dy);
      }
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    clearDragState(event);
  };



  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Defense in depth: the editing textarea already stopPropagation()s its
    // own keydowns, so this shouldn't fire while editing anyway -- but the
    // root no longer carries button semantics/tabIndex while isEditing
    // (ADR-0052), so it must not act as one either if it somehow does fire.
    if (isEditing) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(card.id, event.shiftKey);
    }
  };

  const handleFocus = (_event: FocusEvent<HTMLDivElement>) => {
    setIsFocused(true);
  };

  const handleBlur = (_event: FocusEvent<HTMLDivElement>) => {
    setIsFocused(false);
  };

  return (
    <div
      ref={cardRootRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
        position: "absolute",
        // Shift/Ctrl+click multi-select must not paint native text selection over
        // card bodies; the inline editor textarea below stays selectable.
        userSelect: isEditing ? "text" : "none",
        WebkitUserSelect: isEditing ? "text" : "none",
        left: card.x,
        top: card.y,
        // Only the opt-in path renders temporary movement outside DocumentV1.
        transform: onCommitMove && isDragging
          ? `translate(${previewOffset.x / previewZoom}px, ${previewOffset.y / previewZoom}px)`
          : undefined,
        width: markerMode ? 10 : 220,
        minHeight: markerMode ? 10 : compactMode ? 52 : 80,
        padding: markerMode ? 0 : compactMode ? "8px 10px" : 12,
        border: markerMode
          ? markerNeedsAttention
            ? "1px solid #f59e0b"
            : "1px solid #64748b"
          : "1px solid #cbd5e1",
        // UX-VISUAL-01 D1: 3px left band tinted by claimType (色チャネル=型)。
        borderLeft:
          !markerMode && claimType && claimType !== "unknown"
            ? `3px solid ${CLAIM_TYPE_STYLE[claimType]?.fg ?? "#cbd5e1"}`
            : undefined,
        // Search-match highlight uses a dedicated teal channel, not amber --
        // amber is reserved for hold/critique (retention) state and would
        // otherwise collide with the unreviewed/critique ring on the same
        // card (Claude Design conformance review 2026-07-11, finding A-3).
        outline: isActiveSearchMatch
          ? "3px solid #0d9488"
          : isSelected
            ? "2px solid #2563eb"
            : isSearchMatch
              ? "2px solid #5eead4"
              : "none",
        outlineOffset: 1,
        borderRadius: markerMode ? 999 : 8,
        backgroundColor: markerMode
          ? markerNeedsAttention
            ? "rgba(245, 158, 11, 0.45)"
            : "rgba(100, 116, 139, 0.25)"
          : "#ffffff",
        opacity: markerMode ? (markerNeedsAttention ? 0.8 : 0.4) : isDeemphasized ? 0.55 : 1,
        boxShadow: isHighlighted
          ? "0 0 0 3px rgba(245, 158, 11, 0.35), 0 0 0 1px rgba(245, 158, 11, 0.9), 0 1px 2px rgba(15, 23, 42, 0.08)"
          : isSelected
            ? "0 0 0 2px rgba(37, 99, 235, 0.2), 0 1px 2px rgba(15, 23, 42, 0.08)"
            : "0 1px 2px rgba(15, 23, 42, 0.08)",
        color: "#0f172a",
        lineHeight: compactMode ? 1.25 : 1.4,
        whiteSpace: compactMode ? "normal" : "pre-wrap",
        fontSize: compactMode ? 12 : 14,
        cursor: isPickingEdgeTarget ? "crosshair" : isDragging ? "grabbing" : "grab",
      }}
      title={
        markerMode && markerNeedsAttention
          ? t("card_view.marker_attention")
          : compactMode
            ? card.text
            : undefined
      }
      // ADR-0052: cards are independently-reachable/selectable operation
      // targets, not entries in a listbox (no arrow-key "move active option"
      // contract exists or is introduced here -- Tab reaches each card, and
      // Enter/Space activates it, exactly as a plain button already does).
      // aria-pressed reflects membership in the selection set: a normal
      // activation solo-selects (single primary target), a Shift-activation
      // toggles this card's membership without touching the rest.
      // While editing, button semantics/aria-pressed/tab-stop move entirely
      // to the textarea below -- the root is not an operable element then.
      role={isEditing ? undefined : "button"}
      data-card-id={card.id}
      aria-pressed={isEditing ? undefined : isSelected}
      aria-describedby={
        !markerMode && !isEditing && !isTextReviewed ? unreviewedDescriptionId : undefined
      }
      data-focus={isFocused ? "card" : undefined}
      tabIndex={isEditing ? -1 : 0}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onDoubleClick={(event) => {
        if (markerMode || !onBeginEdit) {
          return;
        }
        event.stopPropagation();
        onBeginEdit(card.id);
      }}
      onContextMenu={(event) => {
        if (markerMode || !onCardContextMenu) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onCardContextMenu(card.id, event.clientX, event.clientY, event.currentTarget);
      }}
    >
      {/* UX-VISUAL-01 (ADR-0048 D1): state badges live in a normal-flow meta-row
          ABOVE the body so the card body first line is never overlapped. Channels:
          色=claimType(型) / 位置=保持系(amberピル) / 密度=違和感(件数) / 形=未レビュー(右上の点)。 */}
      {!markerMode &&
      (representativeCount > 0 ||
        (claimType && claimType !== "unknown") ||
        holdState ||
        hasCritique ||
        isProtected ||
        (showSeqNumber && card.meta?.seq !== undefined)) ? (
        <div
          data-card-meta-row=""
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 4,
            marginBottom: 6,
            minHeight: 16,
          }}
        >
          {showSeqNumber && card.meta?.seq !== undefined ? (
            // DOMAIN-TRACE-01: plain neutral text (no pill) — the seq badge
            // claims no visual-language channel (色/位置/密度/形 stay with
            // their existing owners per UX-VISUAL-01's channel budget).
            <span
              data-card-seq-badge=""
              title={t("card_view.seq_title", { seq: card.meta.seq })}
              style={{ fontSize: 10, fontWeight: 600, color: "#64748b", lineHeight: "14px" }}
            >
              #{card.meta.seq}
            </span>
          ) : null}
          {claimType && claimType !== "unknown" ? (
            <span
              aria-label={t("card_view.claim_type.aria", { value: CLAIM_TYPE_STYLE[claimType]?.label ?? claimType })}
              title={t("card_view.claim_type.title", { value: CLAIM_TYPE_STYLE[claimType]?.label ?? claimType })}
              style={{
                borderRadius: 4,
                backgroundColor: CLAIM_TYPE_STYLE[claimType]?.bg ?? "#f1f5f9",
                color: CLAIM_TYPE_STYLE[claimType]?.fg ?? "#475569",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                lineHeight: "14px",
              }}
            >
              {CLAIM_TYPE_STYLE[claimType]?.label ?? claimType}
            </span>
          ) : null}
          {holdState ? (
            <span
              aria-label={t("card_view.hold_state.aria", { value: holdStateLabel })}
              title={t("card_view.hold_state.title", { value: holdStateLabel })}
              style={{
                borderRadius: 4,
                backgroundColor: HOLD_STATE_STYLE[holdState]?.bg ?? "#f1f5f9",
                color: HOLD_STATE_STYLE[holdState]?.fg ?? "#475569",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                lineHeight: "14px",
              }}
            >
              {holdStateLabel}
            </span>
          ) : null}
          {representativeCount > 0 ? (
            <span
              style={{
                borderRadius: 4,
                backgroundColor: "#dbeafe",
                color: "#1d4ed8",
                fontSize: 10,
                fontWeight: 700,
                padding: "1px 6px",
                lineHeight: "14px",
              }}
            >
              {t("card_view.representative_count", { count: representativeCount })}
            </span>
          ) : null}
          {hasCritique ? (
            <span
              aria-label={critiqueTagCount > 0
                ? t("card_view.critique_with_tags", { count: critiqueTagCount })
                : t("card_view.critique_note")}
              title={critiqueTagCount > 0
                ? t("card_view.critique_with_tags_title", { count: critiqueTagCount })
                : t("card_view.critique_note")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                borderRadius: 4,
                backgroundColor: "#fef3c7",
                color: "#92400e",
                fontSize: 10,
                fontWeight: 600,
                padding: "1px 6px",
                lineHeight: "14px",
              }}
            >
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "#f59e0b" }} />
              {critiqueTagCount > 0 ? t("card_view.critique_tag_count", { count: critiqueTagCount }) : null}
            </span>
          ) : null}
          {isProtected ? (
            // UX-VISUAL-02 (ADR-0048 D3): protection mark for an isolated card.
            // Neutral slate (amber is reserved for hold/critique). No score/rank/ratio.
            // Dashed border + fg #334155 deliberately avoid colliding with the
            // unknown-claimType pill (fg #475569) and shelved-hold pill (fg #64748b),
            // which share the same neutral slate bg (#f1f5f9) — see UX-VISUAL-02
            // review finding on channel collision. The square dot is the shared
            // "protection" form signature, mirrored on IslandView and the legend.
            <span
              aria-label={t("card_view.protected")}
              title={t("card_view.protected_title")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                borderRadius: 4,
                backgroundColor: "#f8fafc",
                color: "#334155",
                border: "1px dashed #94a3b8",
                fontSize: 10,
                fontWeight: 600,
                padding: "0px 5px",
                lineHeight: "14px",
              }}
            >
              <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: "#94a3b8" }} />
              {t("card_view.protected")}
            </span>
          ) : null}
        </div>
      ) : null}
      {!markerMode && !isTextReviewed ? (
        <>
          <span id={unreviewedDescriptionId} hidden>
            {t("card_view.unreviewed")}
          </span>
          <span
            aria-hidden="true"
            title={t("card_view.unreviewed")}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: "#f59e0b",
              opacity: 0.7,
            }}
          />
        </>
      ) : null}
      {!markerMode && isEditing ? (
        <textarea
          // MVP-EXIT-01 screen-reader acceptance: without an accessible name a
          // screen reader announces this field as an unlabeled edit box, so the
          // "focus moved to the card body input" step of
          // 04_Documentation/acceptance_check.md is not audible.
          aria-label={t("card_view.edit_textarea_label")}
          aria-describedby={!isTextReviewed ? unreviewedDescriptionId : undefined}
          defaultValue={card.text}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onCommitEdit?.(card.id, event.currentTarget.value);
              restoreCardFocus();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancelEdit?.();
              restoreCardFocus();
            }
          }}
          onBlur={(event) => onCommitEdit?.(card.id, event.currentTarget.value)}
          style={{
            width: "100%",
            minHeight: compactMode ? 36 : 56,
            boxSizing: "border-box",
            border: "none",
            outline: "none",
            resize: "none",
            padding: 0,
            margin: 0,
            fontFamily: "inherit",
            fontSize: compactMode ? 12 : 14,
            lineHeight: compactMode ? 1.25 : 1.4,
            color: "inherit",
            backgroundColor: "transparent",
          }}
        />
      ) : !markerMode && showLabelText ? (
        compactMode
          ? renderHighlightedText(compactText, searchQuery)
          : renderHighlightedText(card.text, searchQuery)
      ) : !markerMode && card.text.length > 0 ? (
        // QA-MONKEY-10: when overlap culling hides this card's text, show an
        // explicit omission mark instead of rendering nothing -- an entirely
        // blank card is indistinguishable from lost text. The full text stays
        // reachable via hover (title) and the accessibility tree (aria-label).
        <span data-card-text-culled="true" aria-label={card.text} title={card.text} style={{ color: "#94a3b8" }}>
          …
        </span>
      ) : null}
    </div>
  );
}

export const CardView = memo(CardViewComponent);
