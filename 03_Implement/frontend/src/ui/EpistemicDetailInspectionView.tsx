import { t } from "../i18n/translate";
import { statePresentation } from "./epistemic_review_model";
import {
  buildEpistemicDetailPresentation,
  type EpistemicDetailOutcome,
} from "./epistemic_detail_presentation";

type EpistemicDetailInspectionViewProps = {
  outcome: EpistemicDetailOutcome;
};

/**
 * Fixed display for the on-demand epistemic detail inspection. Content is only
 * ever reachable through a validated, current-or-refresh-required inspection;
 * a fail-closed outcome shows a status line and nothing else. Rendering of the
 * detail content itself stays with the future App wiring; this component fixes
 * the status, action-reuse and authority display for each outcome fixture.
 */
export function EpistemicDetailInspectionView({
  outcome,
}: EpistemicDetailInspectionViewProps) {
  const presentation = buildEpistemicDetailPresentation(outcome);

  if (presentation.unavailable || !outcome.ok) {
    return (
      <section
        role="status"
        aria-label={t("epistemic.detail.group_label")}
        style={{
          border: "1px solid #fca5a5",
          borderRadius: 8,
          background: "#fef2f2",
          padding: 10,
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 700 }}>{t(presentation.statusKey)}</div>
        <div style={{ marginTop: 4, color: "#991b1b" }}>
          {t("epistemic.detail.unavailable_note")}
        </div>
      </section>
    );
  }

  const inspection = outcome.inspection;
  const currentState = statePresentation(inspection.current.state);

  return (
    <section
      role="status"
      aria-label={t("epistemic.detail.group_label")}
      style={{
        border: "1px solid #cbd5e1",
        borderRadius: 8,
        background: "#f8fafc",
        padding: 10,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700 }}>{t(presentation.statusKey)}</div>
      <div
        style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}
      >
        <span style={{ color: "#64748b" }}>
          {t("epistemic.detail.current_state_label")}
        </span>
        <span
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 999,
            padding: "1px 6px",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          {t(currentState.labelKey)}
        </span>
      </div>
      {presentation.actionReuseAllowed &&
      presentation.reusableActionCount > 0 ? (
        <div style={{ marginTop: 6 }}>
          {t("epistemic.detail.actions_reusable", {
            count: presentation.reusableActionCount,
          })}
        </div>
      ) : (
        <div style={{ marginTop: 6 }}>
          {t("epistemic.detail.actions_blocked")}
        </div>
      )}
      <div style={{ marginTop: 6, color: "#64748b" }}>
        {t("epistemic.detail.data_only_note")}
      </div>
    </section>
  );
}
