import type { KeyboardEvent } from "react";

import { t } from "../i18n/translate";

type CanvasLegendProps = {
  onClose: () => void;
};

const groupTitleStyle = {
  fontSize: 10,
  fontWeight: 700,
  color: "#475569",
  marginBottom: 3,
} as const;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10,
  color: "#334155",
  lineHeight: "16px",
} as const;

const shortcutKeyStyle = {
  minWidth: 18,
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  backgroundColor: "#f8fafc",
  color: "#0f172a",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: "14px",
  textAlign: "center",
  flexShrink: 0,
} as const;

function swatch(backgroundColor: string, extra?: Record<string, string | number>) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: 3,
        backgroundColor,
        flexShrink: 0,
        ...extra,
      }}
    />
  );
}

function kbd(label: string) {
  return <kbd style={shortcutKeyStyle}>{label}</kbd>;
}

function line(color: string, dashed: boolean) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 18,
        height: 0,
        borderTop: dashed ? `2px dashed ${color}` : `2px solid ${color}`,
        flexShrink: 0,
      }}
    />
  );
}

// UX-VISUAL-01 AC-2 (ADR-0048 D1): in-canvas legend for the 4-channel state
// language. Default OFF; opened only by explicit action; Escape closes and
// focus returns to the trigger (ADR-0030 contract, handled by the caller).
export function CanvasLegend({ onClose }: CanvasLegendProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <section
      data-ui-region="canvas-legend"
      role="dialog"
      aria-label={t("legend.title")}
      onKeyDown={handleKeyDown}
      style={{
        position: "absolute",
        inset: "auto 16px 16px auto",
        zIndex: 12,
        width: 260,
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        backgroundColor: "rgba(255, 255, 255, 0.97)",
        boxShadow: "0 8px 24px rgba(15, 23, 42, 0.14)",
        padding: 10,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>{t("legend.title")}</span>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          aria-label={t("legend.close")}
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 4,
            backgroundColor: "#ffffff",
            color: "#475569",
            fontSize: 10,
            fontWeight: 600,
            padding: "1px 6px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>
      <div>
        <div style={groupTitleStyle}>{t("legend.group.type")}</div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={rowStyle}>{swatch("#dcfce7", { border: "1px solid #166534" })}{t("card_view.claim_type.fact")}</span>
          <span style={rowStyle}>{swatch("#dbeafe", { border: "1px solid #1e40af" })}{t("card_view.claim_type.claim")}</span>
          <span style={rowStyle}>{swatch("#f3e8ff", { border: "1px solid #6b21a8" })}{t("card_view.claim_type.hypothesis")}</span>
          <span style={rowStyle}>{swatch("#f1f5f9", { border: "1px solid #64748b" })}{t("legend.item.unknown")}</span>
        </div>
      </div>
      <div>
        <div style={groupTitleStyle}>{t("legend.group.hold")}</div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={rowStyle}>{swatch("#fef3c7")}{t("side_panel.hold_state.held")}</span>
          <span style={rowStyle}>{swatch("#f1f5f9")}{t("side_panel.hold_state.shelved")}</span>
        </div>
      </div>
      <div>
        <div style={groupTitleStyle}>{t("legend.group.check")}</div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={rowStyle}>{swatch("#f59e0b", { borderRadius: "50%", width: 7, height: 7 })}{t("legend.item.unreviewed")}</span>
          <span style={rowStyle}>{swatch("#fef3c7", { border: "1px solid #f59e0b" })}{t("legend.item.critique")}</span>
        </div>
      </div>
      <div>
        <div style={groupTitleStyle}>{t("legend.group.shortcuts")}</div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={rowStyle}>{kbd("H")}{t("legend.shortcut.hold")}</span>
          <span style={rowStyle}>{kbd("U")}{t("legend.shortcut.critique")}</span>
          <span style={rowStyle}>{kbd("R")}{t("legend.shortcut.reviewed")}</span>
        </div>
      </div>
      <div>
        <div style={groupTitleStyle}>{t("legend.group.evidence")}</div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={rowStyle}>{line("#0369a1", false)}{t("legend.item.supports")}</span>
          <span style={rowStyle}>{line("#b91c1c", true)}{t("legend.item.contradicts")}</span>
        </div>
      </div>
      <div>
        <div style={groupTitleStyle}>{t("legend.group.protection")}</div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={rowStyle}>{swatch("#94a3b8", { borderRadius: 2 })}{t("legend.item.protected")}</span>
        </div>
      </div>
      {/* Transient UI states live in a visually separated frame so they are
          not confused with the four permanent meaning channels above
          (Claude Design P32: teal = search match is search-session-only). */}
      <div style={{ borderTop: "1px dashed #cbd5e1", paddingTop: 6 }}>
        <div style={groupTitleStyle}>{t("legend.group.transient")}</div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={rowStyle}>{swatch("transparent", { border: "2px solid #0d9488" })}{t("legend.item.search_match")}</span>
        </div>
      </div>
    </section>
  );
}
