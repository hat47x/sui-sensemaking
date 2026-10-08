import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { t } from "../i18n/translate";
import type { ParsedAgentProposal, AgentResponseImportMode } from "../import/agent_response_import";
import type { ImportedProposalReview } from "../import/agent_response_import";

// EXT-AGENT-02 (ADR-0049 D3): review surface for a pasted external AI
// agent's agent-response.v1 JSON. Parsing/validating never touches the
// document (AC-6); only a per-proposal, explicit "Import" click does --
// one applyDocumentChange per proposal, so Cmd+Z reverts it individually
// (App.tsx owns that dispatch; this panel is presentational).

type AgentResponseImportPanelProps = {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: { current: HTMLElement | null };
  pastedText: string;
  onPastedTextChange: (value: string) => void;
  mode: AgentResponseImportMode;
  onModeChange: (value: AgentResponseImportMode) => void;
  onParse: () => void;
  parseErrors: string[];
  parseWarnings: string[];
  reviews: ImportedProposalReview[];
  onAdopt: (reviewKey: string) => void;
  onReject: (reviewKey: string) => void;
  onExportPatchFile: (reviewKey: string) => void;
};

const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function getFocusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  );
}

const buttonStyle = {
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  backgroundColor: "#ffffff",
  color: "#0f172a",
  padding: "6px 12px",
  fontWeight: 600,
  cursor: "pointer",
} as const;

function proposalTargetLabel(proposal: ParsedAgentProposal): string {
  if (proposal.targetRef.islandId) return `island:${proposal.targetRef.islandId}`;
  if (proposal.targetRef.cardIds && proposal.targetRef.cardIds.length > 0) return proposal.targetRef.cardIds.join(", ");
  return t("agent_response_import.target_none");
}

function proposalContentPreview(proposal: ParsedAgentProposal): string {
  return proposal.content.title ?? proposal.content.mergedText ?? proposal.content.text ?? "";
}

export function AgentResponseImportPanel({
  isOpen,
  onClose,
  triggerRef,
  pastedText,
  onPastedTextChange,
  mode,
  onModeChange,
  onParse,
  parseErrors,
  parseWarnings,
  reviews,
  onAdopt,
  onReject,
  onExportPatchFile,
}: AgentResponseImportPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const parseErrorsId = useId();
  // An uncorrelated proposal has no audit record, so App refuses onReject for
  // it. Its Discard only hides the card here: no document write, no apply or
  // import call, and nothing is marked reviewed.
  const [dismissedReviewKeys, setDismissedReviewKeys] = useState<ReadonlySet<string>>(() => new Set<string>());
  const visibleReviews = reviews.filter((review) => !dismissedReviewKeys.has(review.reviewKey));
  const dismissUncorrelatedReview = (reviewKey: string) => {
    setDismissedReviewKeys((previous) => new Set(previous).add(reviewKey));
    panelRef.current?.focus();
  };

  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
    const [firstFocusable] = getFocusableElements(panelRef.current);
    (firstFocusable ?? panelRef.current).focus();
  }, [isOpen]);

  const closePanelAndRestoreFocus = () => {
    onClose();
    setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePanelAndRestoreFocus();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;

    const focusableElements = getFocusableElements(panelRef.current);
    if (focusableElements.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      data-ui-region="agent-response-import"
      data-ui-complexity-tier="advanced-content"
      role="dialog"
      aria-label={t("agent_response_import.title")}
      aria-modal="true"
      tabIndex={-1}
      onKeyDown={handlePanelKeyDown}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 500,
        backgroundColor: "#ffffff",
        overflow: "auto",
        padding: 16,
        display: "grid",
        gap: 12,
        alignContent: "start",
        maxWidth: 640,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>{t("agent_response_import.title")}</div>
        <button
          type="button"
          onClick={closePanelAndRestoreFocus}
          aria-label={t("agent_response_import.close")}
          data-focus-return-id="agent-response-import-close"
          style={buttonStyle}
        >
          {t("agent_response_import.close")}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{t("agent_response_import.intent_hint")}</div>

      <label style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{t("agent_response_import.paste_label")}</span>
        <textarea
          data-testid="agent-response-paste-input"
          value={pastedText}
          onChange={(event) => onPastedTextChange(event.target.value)}
          rows={8}
          aria-describedby={parseErrors.length > 0 ? parseErrorsId : undefined}
          aria-invalid={parseErrors.length > 0}
          style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: 8, fontFamily: "monospace", fontSize: 12 }}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
        <input type="checkbox" checked={mode === "strict"} onChange={(event) => onModeChange(event.target.checked ? "strict" : "lenient")} />
        {t("agent_response_import.strict_mode_label")}
      </label>

      <button type="button" data-testid="agent-response-parse-button" onClick={onParse} style={buttonStyle}>
        {t("agent_response_import.parse")}
      </button>

      {parseErrors.length > 0 ? (
        <div id={parseErrorsId} style={{ border: "1px solid #fecaca", borderRadius: 6, backgroundColor: "#fef2f2", padding: 8, fontSize: 12, color: "#991b1b" }}>
          {parseErrors.join("; ")}
        </div>
      ) : null}
      {parseWarnings.length > 0 ? (
        <div style={{ border: "1px solid #fde68a", borderRadius: 6, backgroundColor: "#fffbeb", padding: 8, fontSize: 12, color: "#92400e" }}>
          {t("agent_response_import.warnings_summary", { count: parseWarnings.length })}
        </div>
      ) : null}

      {visibleReviews.length > 0 ? (
        <div style={{ display: "grid", gap: 8 }}>
          {visibleReviews.map((review) => (
            <div
              key={review.reviewKey}
              data-testid={`agent-response-proposal-${review.proposalId}`}
              data-proposal-status={review.status}
              style={{
                border: "1px solid #bfdbfe",
                borderRadius: 6,
                backgroundColor: review.orphaned ? "#f1f5f9" : "#eff6ff",
                padding: 8,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, color: "#1e3a8a" }}>
                {t("agent_response_import.ai_proposal")} <strong>{t(`agent_response_import.kind.${review.kind}`)}</strong> ·{" "}
                {proposalTargetLabel(review)}
              </div>
              <div style={{ fontSize: 11, color: review.provenance === "verified-local-export" ? "#166534" : "#92400e" }}>
                {t(`agent_response_import.provenance.${review.provenance}`)}
              </div>
              <div style={{ fontSize: 12, color: "#1e293b" }}>{proposalContentPreview(review)}</div>
              <div style={{ fontSize: 11, color: "#475569" }}>
                {t("agent_response_import.rationale_label")}: {review.rationale}
              </div>
              {review.orphaned ? (
                <div style={{ fontSize: 11, color: "#7c2d12" }}>{t("agent_response_import.orphaned_note")}</div>
              ) : null}
              {review.patchSignatureMismatch ? (
                <div style={{ fontSize: 11, color: "#7c2d12" }}>{t("agent_response_import.patch_signature_mismatch_note")}</div>
              ) : null}
              {review.patchHasDeleteOps ? (
                <div style={{ fontSize: 11, color: "#9a3412" }}>{t("agent_response_import.patch_delete_ops_warning")}</div>
              ) : null}
              {review.status === "pending" && !review.auditProposalId ? (
                <>
                  <div style={{ fontSize: 11, color: "#92400e" }}>
                    {t("agent_response_import.audit_required_status_message")}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissUncorrelatedReview(review.reviewKey)}
                    style={{ ...buttonStyle, justifySelf: "start" }}
                  >
                    {t("agent_response_import.reject")}
                  </button>
                </>
              ) : review.status === "pending" ? (
                <div style={{ display: "flex", gap: 6 }}>
                  {review.orphaned ? null : review.patchSignatureMismatch ? (
                    <button type="button" onClick={() => onExportPatchFile(review.reviewKey)} style={{ ...buttonStyle, flex: 1 }}>
                      {t("agent_response_import.export_patch_file")}
                    </button>
                  ) : (
                    <button type="button" onClick={() => onAdopt(review.reviewKey)} style={{ ...buttonStyle, flex: 1 }}>
                      {t("agent_response_import.adopt")}
                    </button>
                  )}
                  <button type="button" onClick={() => onReject(review.reviewKey)} style={{ ...buttonStyle, flex: 1 }}>
                    {t("agent_response_import.reject")}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 11, fontWeight: 600, color: review.status === "adopted" ? "#166534" : "#64748b" }}>
                  {t(`agent_response_import.status.${review.status}`)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
