import { useEffect, useRef, type KeyboardEvent } from "react";

import { t } from "../i18n/translate";

type StartPanelProps = {
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  currentDocumentId: string;
  /** True when the active document is a pack/sample copy that has not been loaded from the server. */
  canReopenCurrent?: boolean;
  isDirty: boolean;
  isLoading: boolean;
  isReadOnly: boolean;
  isSaving: boolean;
  recentDocumentIds: string[];
  safeMode: boolean;
  selectedRecentDocumentId: string;
  onClose: () => void;
  onCreateNew: () => void;
  onImportReviewPack: () => void;
  onLoadDocumentFile: () => void;
  onOpenRecent: () => void;
  onOpenSample: () => void;
  onSelectedRecentDocumentChange: (value: string) => void;
};

const startActionStyle = {
  border: "1px solid #cbd5e1",
  borderRadius: 8,
  backgroundColor: "#ffffff",
  color: "#0f172a",
  padding: 10,
  cursor: "pointer",
  textAlign: "left",
  display: "grid",
  gap: 3,
  minWidth: 0,
  whiteSpace: "normal",
  overflowWrap: "anywhere",
} as const;

const disabledStartActionStyle = {
  ...startActionStyle,
  color: "#64748b",
  backgroundColor: "#f8fafc",
  cursor: "not-allowed",
} as const;

const focusableSelector = [
  "button:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function StartPanel({
  expanded = true,
  onExpandedChange,
  currentDocumentId,
  canReopenCurrent = false,
  isDirty,
  isLoading,
  isReadOnly,
  isSaving,
  recentDocumentIds,
  safeMode,
  selectedRecentDocumentId,
  onClose,
  onCreateNew,
  onImportReviewPack,
  onLoadDocumentFile,
  onOpenRecent,
  onOpenSample,
  onSelectedRecentDocumentChange,
}: StartPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const isBusy = isLoading || isSaving;
  const canCreateNew = !isBusy && !isReadOnly;
  const canOpenRecent = selectedRecentDocumentId.length > 0 && (canReopenCurrent || selectedRecentDocumentId !== currentDocumentId);

  useEffect(() => {
    const firstFocusable = panelRef.current?.querySelector<HTMLElement>(expanded ? '[data-start-close]' : '[data-start-expand]');
    firstFocusable?.focus();
  }, [expanded]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (!expanded || event.key !== "Tab") {
      return;
    }

    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const focusableElements = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });

    if (focusableElements.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement = window.document.activeElement;

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  return (
    <section
      ref={panelRef}
      data-panel="start-document-entry"
      role={expanded ? "dialog" : "region"}
      aria-modal={expanded ? "true" : undefined}
      aria-label={t("start_panel.title")}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{
        position: "absolute",
        inset: expanded ? "16px auto auto 16px" : "8px auto auto 8px",
        zIndex: 20,
        width: "min(560px, calc(100vw - 32px))",
        maxHeight: "calc(100% - 32px)",
        overflow: "auto",
        boxSizing: "border-box",
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        backgroundColor: "rgba(255, 255, 255, 0.98)",
        boxShadow: "0 12px 24px rgba(15, 23, 42, 0.14)",
        padding: expanded ? 12 : 6,
        display: expanded ? "grid" : "flex",
        flexWrap: expanded ? undefined : "wrap",
        alignItems: expanded ? undefined : "center",
        gap: expanded ? 10 : 4,
      }}
    >
      <div style={{ display: expanded ? "flex" : "contents", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "grid", gap: 4, minWidth: 0, order: expanded ? undefined : 0 }}>
          {onExpandedChange ? (
            <button type="button" data-start-expand aria-expanded={expanded} onClick={() => onExpandedChange(!expanded)}
              style={{ border: 0, background: "transparent", padding: 0, fontSize: 15, fontWeight: 800, color: "#0f172a", cursor: "pointer", textAlign: "left" }}>
              {t("start_panel.title")} <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
            </button>
          ) : <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{t("start_panel.title")}</div>}
          {expanded ? <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{t("start_panel.description")}</div> : null}
        </div>
        {!expanded ? <span style={{ fontSize: 12, color: safeMode ? "#166534" : "#9a3412", order: 2 }}>
          {safeMode ? t("start_panel.status.safe_mode_on") : t("start_panel.status.safe_mode_off")}
        </span> : null}
        <button
          type="button"
          data-start-close
          onClick={onClose}
          aria-label={t("start_panel.close")}
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            backgroundColor: "#ffffff",
            color: "#0f172a",
            padding: "4px 8px",
            cursor: "pointer",
            flex: "0 0 auto",
            order: expanded ? undefined : 3,
          }}
        >
          ×
        </button>
      </div>

      {expanded ? <dl
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(96px, 0.35fr) minmax(0, 1fr)",
          gap: "5px 8px",
          margin: 0,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          padding: 8,
          backgroundColor: "#f8fafc",
          fontSize: 12,
        }}
      >
        <dt style={{ margin: 0, fontWeight: 700, color: "#334155" }}>{t("start_panel.status.safe_mode")}</dt>
        <dd style={{ margin: 0, color: safeMode ? "#166534" : "#9a3412", fontWeight: 700 }}>
          {safeMode ? t("start_panel.status.safe_mode_on") : t("start_panel.status.safe_mode_off")}
        </dd>
        <dt style={{ margin: 0, fontWeight: 700, color: "#334155" }}>{t("start_panel.status.current_document")}</dt>
        <dd style={{ margin: 0, color: "#0f172a", overflowWrap: "anywhere" }}>
          {currentDocumentId}
          {isDirty ? ` ${t("start_panel.status.unsaved")}` : ""}
        </dd>
        <dt style={{ margin: 0, fontWeight: 700, color: "#334155" }}>{t("start_panel.status.editing")}</dt>
        <dd style={{ margin: 0, color: isReadOnly ? "#9a3412" : "#166534", fontWeight: 700 }}>
          {isReadOnly ? t("start_panel.status.read_only") : t("start_panel.status.editable")}
        </dd>
      </dl> : null}

      <div style={{ display: "grid", gridTemplateColumns: expanded ? "repeat(auto-fit, minmax(190px, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: expanded ? 8 : 4, fontSize: expanded ? undefined : 12, flex: expanded ? undefined : "1 1 220px", order: expanded ? undefined : 1 }}>
        <button
          type="button"
          onClick={onCreateNew}
          disabled={!canCreateNew}
          aria-label={expanded ? undefined : t("start_panel.action.new")}
          title={expanded ? undefined : t("start_panel.action.new")}
          style={{ ...(canCreateNew ? startActionStyle : disabledStartActionStyle), padding: expanded ? 10 : 4 }}
        >
          <span style={{ fontWeight: 800 }}>{t(expanded ? "start_panel.action.new" : "start_panel.compact.new")}</span>
          {expanded ? <span style={{ fontSize: 12, color: "#475569" }}>{t("start_panel.action.new_hint")}</span> : null}
        </button>
        <button type="button" onClick={onOpenSample} disabled={isBusy} aria-label={expanded ? undefined : t("start_panel.action.sample")} title={expanded ? undefined : t("start_panel.action.sample")} style={{ ...(isBusy ? disabledStartActionStyle : startActionStyle), padding: expanded ? 10 : 4 }}>
          <span style={{ fontWeight: 800 }}>{t(expanded ? "start_panel.action.sample" : "start_panel.compact.sample")}</span>
          {expanded ? <span style={{ fontSize: 12, color: "#475569" }}>{t("start_panel.action.sample_hint")}</span> : null}
        </button>
        <button type="button" onClick={onLoadDocumentFile} disabled={isBusy} aria-label={expanded ? undefined : t("start_panel.action.load_document")} title={expanded ? undefined : t("start_panel.action.load_document")} style={{ ...(isBusy ? disabledStartActionStyle : startActionStyle), padding: expanded ? 10 : 4 }}>
          <span style={{ fontWeight: 800 }}>{t(expanded ? "start_panel.action.load_document" : "start_panel.compact.load_document")}</span>
          {expanded ? <span style={{ fontSize: 12, color: "#475569" }}>
            {t(isReadOnly ? "start_panel.action.load_document_hint_read_only" : "start_panel.action.load_document_hint")}
          </span> : null}
        </button>
        <button type="button" onClick={onImportReviewPack} disabled={isBusy} aria-label={expanded ? undefined : t("start_panel.action.import_review_pack")} title={expanded ? undefined : t("start_panel.action.import_review_pack")} style={{ ...(isBusy ? disabledStartActionStyle : startActionStyle), padding: expanded ? 10 : 4 }}>
          <span style={{ fontWeight: 800 }}>{t(expanded ? "start_panel.action.import_review_pack" : "start_panel.compact.import_review_pack")}</span>
          {expanded ? <span style={{ fontSize: 12, color: "#475569" }}>{t("start_panel.action.import_review_pack_hint")}</span> : null}
        </button>
      </div>

      {expanded && recentDocumentIds.length > 0 ? (
        <div style={{ display: "grid", gap: 6, borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 700, color: "#334155" }}>
            {t("start_panel.recent.label")}
            <select
              value={selectedRecentDocumentId}
              onChange={(event) => onSelectedRecentDocumentChange(event.target.value)}
              aria-label={t("start_panel.recent.label")}
              disabled={isBusy}
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                padding: "6px 8px",
                color: "#0f172a",
                backgroundColor: "#ffffff",
                minWidth: 0,
              }}
            >
              <option value="">{t("start_panel.recent.placeholder")}</option>
              {recentDocumentIds.map((docId) => (
                <option key={docId} value={docId}>
                  {docId}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onOpenRecent}
            disabled={isBusy || !canOpenRecent}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 10px",
              backgroundColor: "#ffffff",
              color: isBusy || !canOpenRecent ? "#64748b" : "#0f172a",
              fontWeight: 700,
              cursor: isBusy || !canOpenRecent ? "not-allowed" : "pointer",
              justifySelf: "start",
            }}
          >
            {t("start_panel.recent.open")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
