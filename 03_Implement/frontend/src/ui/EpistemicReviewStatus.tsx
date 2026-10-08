import { t } from "../i18n/translate";
import type { EpistemicUiAction, EpistemicUiItem } from "./epistemic_review_model";

type EpistemicReviewStatusProps = {
  item: EpistemicUiItem;
  onAction: (action: EpistemicUiAction) => void;
  compact?: boolean;
};

const ACTION_LABEL_KEY: Readonly<Record<EpistemicUiAction, string>> = Object.freeze({
  confirm: "epistemic.action.confirm",
  "mark-hypothesis": "epistemic.action.mark_hypothesis",
  reject: "epistemic.action.reject",
  "withdraw-confirmation": "epistemic.action.withdraw_confirmation",
  "inspect-details": "epistemic.action.inspect_details",
  "resolve-target": "epistemic.action.resolve_target",
  "request-access": "epistemic.action.request_access",
  "request-review": "epistemic.action.request_review",
  "refresh-source": "epistemic.action.refresh_source",
});

const TONE_STYLE = {
  neutral: { border: "#cbd5e1", background: "#f8fafc", color: "#334155" },
  info: { border: "#93c5fd", background: "#eff6ff", color: "#1e40af" },
  warning: { border: "#fcd34d", background: "#fffbeb", color: "#92400e" },
  danger: { border: "#fca5a5", background: "#fef2f2", color: "#991b1b" },
} as const;

function badge(
  label: string,
  tone: EpistemicUiItem["tone"] | EpistemicUiItem["confirmationTone"],
): JSX.Element {
  const style = TONE_STYLE[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${style.border}`,
        borderRadius: 999,
        background: style.background,
        color: style.color,
        padding: "1px 6px",
        fontSize: 11,
        lineHeight: 1.5,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export function EpistemicReviewStatus({
  item,
  onAction,
  compact = false,
}: EpistemicReviewStatusProps) {
  const actions = item.actions.filter((action) =>
    compact
      ? action === "confirm"
        || action === "mark-hypothesis"
        || action === "reject"
        || action === "withdraw-confirmation"
      : true,
  );

  return (
    <div
      role="group"
      aria-label={t("epistemic.status.group_label", { assertionId: item.assertionId })}
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 4,
        fontSize: 12,
      }}
    >
      {badge(t(item.labelKey), item.tone)}
      {badge(t(item.confirmationLabelKey), item.confirmationTone)}
      {item.targetReanchored ? (
        <span style={{ fontSize: 11, color: "#64748b" }}>{t("epistemic.hint.target_reanchored")}</span>
      ) : null}
      {item.inferredContextUsed ? (
        <span style={{ fontSize: 11, color: "#64748b" }}>{t("epistemic.hint.inferred_context")}</span>
      ) : null}
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => onAction(action)}
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            background: "#ffffff",
            color: "#334155",
            padding: compact ? "1px 5px" : "2px 7px",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {t(ACTION_LABEL_KEY[action])}
        </button>
      ))}
    </div>
  );
}
