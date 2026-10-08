import type { EpistemicUiAction, EpistemicUiItem } from "./epistemic_review_model";

type EpistemicReviewStatusProps = {
  item: EpistemicUiItem;
  onAction: (action: EpistemicUiAction) => void;
  compact?: boolean;
};

const ACTION_LABEL: Readonly<Record<EpistemicUiAction, string>> = Object.freeze({
  confirm: "確認",
  "mark-hypothesis": "仮説",
  reject: "否定",
  "withdraw-confirmation": "確認を撤回",
  "inspect-details": "詳細",
  "resolve-target": "対象を選び直す",
  "request-access": "アクセスを確認",
  "request-review": "確認を依頼",
  "refresh-source": "情報を更新",
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
      aria-label={`認識状態: ${item.assertionId}`}
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 4,
        fontSize: 12,
      }}
    >
      {badge(item.label, item.tone)}
      {badge(item.confirmationLabel, item.confirmationTone)}
      {item.targetReanchored ? (
        <span style={{ fontSize: 11, color: "#64748b" }}>対象位置を再特定</span>
      ) : null}
      {item.inferredContextUsed ? (
        <span style={{ fontSize: 11, color: "#64748b" }}>推定文脈を含む</span>
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
          {ACTION_LABEL[action]}
        </button>
      ))}
    </div>
  );
}
