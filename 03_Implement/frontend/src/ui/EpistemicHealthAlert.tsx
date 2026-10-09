import { t } from "../i18n/translate";
import {
  buildEpistemicHealthAlertQueue,
  buildEpistemicHealthPresentation,
  type EpistemicProjectionInput,
  type EpistemicReviewQueueItem,
} from "./epistemic_review_model";

type EpistemicHealthAlertProps = {
  projection: EpistemicProjectionInput;
  onOpenReview?: (item: EpistemicReviewQueueItem) => void;
  maxItems?: number;
};

function percent(value: number): number {
  return Math.round(value * 100);
}

export function EpistemicHealthAlert({
  projection,
  onOpenReview,
  maxItems = 3,
}: EpistemicHealthAlertProps) {
  const health = buildEpistemicHealthPresentation(projection);
  const queue = buildEpistemicHealthAlertQueue(projection);
  if (health.severity === "normal" && queue.length === 0) {
    return null;
  }

  const visible = queue.slice(0, Math.max(0, maxItems));
  const hasResolutionPolicy =
    health.resolvedRatio !== undefined &&
    health.minimumResolvedRatio !== undefined &&
    health.resolutionCoverageState !== "unknown" &&
    health.resolutionCoverageState !== "insufficient-sample";

  return (
    <section
      aria-label={t("epistemic.health.alert_group")}
      style={{
        border: "1px solid #fcd34d",
        borderRadius: 8,
        background: "#fffbeb",
        padding: 10,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700 }}>{t(health.labelKey)}</div>

      {health.resolutionCoverageState === "unknown" ? (
        <div style={{ marginTop: 4 }}>{t("epistemic.health.resolution_unknown")}</div>
      ) : health.resolutionCoverageState === "insufficient-sample" ? (
        <div style={{ marginTop: 4 }}>{t("epistemic.health.resolution_insufficient_sample")}</div>
      ) : hasResolutionPolicy ? (
        <div style={{ marginTop: 4 }}>
          {t("epistemic.health.resolution_summary", {
            resolvedPercent: percent(health.resolvedRatio ?? 0),
            minimumPercent: percent(health.minimumResolvedRatio ?? 0),
          })}
        </div>
      ) : null}

      {(health.requiredResolutions ?? 0) > 0 ? (
        <div style={{ marginTop: 2 }}>
          {t("epistemic.health.required_reviews", {
            count: health.requiredResolutions ?? 0,
          })}
        </div>
      ) : null}

      {hasResolutionPolicy ? (
        <div style={{ marginTop: 2, color: "#64748b" }}>
          {t("epistemic.health.resolution_not_truth")}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <>
          <div style={{ marginTop: 8, fontWeight: 600 }}>
            {t("epistemic.health.review_queue")}
          </div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {visible.map((item) => (
              <li key={item.id} style={{ marginBottom: 6 }}>
                {item.kind === "assertion-review" ? (
                  <>
                    <span>{item.assertionId}</span>
                    <div style={{ color: "#475569" }}>
                      {item.reviewerCandidates.length > 0
                        ? t("epistemic.health.reviewer_candidates", {
                            value: item.reviewerCandidates.join(", "),
                          })
                        : t("epistemic.health.no_reviewer_candidate")}
                    </div>
                    {item.downstreamImpact.length > 0 ? (
                      <div style={{ color: "#475569" }}>
                        {t("epistemic.health.downstream_impact", {
                          value: item.downstreamImpact.join(", "),
                        })}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <span>{t("epistemic.health.coverage_gap", { areaId: item.areaId })}</span>
                )}
                {onOpenReview ? (
                  <button
                    type="button"
                    onClick={() => onOpenReview(item)}
                    style={{ marginTop: 3 }}
                  >
                    {t("epistemic.health.open_review")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <div style={{ color: "#64748b" }}>{t("epistemic.health.authority_note")}</div>
        </>
      ) : null}
    </section>
  );
}
