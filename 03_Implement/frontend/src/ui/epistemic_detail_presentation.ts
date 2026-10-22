import type { EpistemicDetailInspection } from "./epistemic_review_model";

/**
 * Presentation model for the on-demand epistemic detail inspection
 * (Issue #3184: "unavailable / partial / drift indeterminate の UI 表示を、
 * fixture-driven で先に固定する").
 *
 * The consumer model (`resolveEpistemicDetailForInspection`) already enforces
 * fail-closed validation. This layer fixes how each outcome is *displayed* and
 * keeps every guarantee testable without App wiring:
 *
 * - a rejected detail result never exposes content, not even partially;
 * - drift `indeterminate` is never presented as a semantic change;
 * - quick actions opened from a non-current detail are never reusable;
 * - detail content is data only (no prompt control authority).
 *
 * Content rendering itself is part of the App wiring design and stays out of
 * this module.
 */
export type EpistemicDetailOutcome =
  | { ok: true; inspection: EpistemicDetailInspection }
  | { ok: false; unavailableReason: "rejected" | "provider-unavailable" };

export type EpistemicDetailPresentation = {
  /** i18n key for the primary status line of the outcome. */
  statusKey:
    | "epistemic.detail.status.current"
    | "epistemic.detail.status.refresh_required_changed"
    | "epistemic.detail.status.refresh_required_indeterminate"
    | "epistemic.detail.status.unavailable_rejected"
    | "epistemic.detail.status.unavailable_provider";
  unavailable: boolean;
  /** True only when validated, readable detail content exists. */
  readable: boolean;
  projectionRefreshRequired: boolean;
  actionReuseAllowed: boolean;
  reusableActionCount: number;
  driftIndeterminate: boolean;
  driftChanged: boolean;
};

export function buildEpistemicDetailPresentation(
  outcome: EpistemicDetailOutcome,
): EpistemicDetailPresentation {
  if (!outcome.ok) {
    return {
      statusKey:
        outcome.unavailableReason === "provider-unavailable"
          ? "epistemic.detail.status.unavailable_provider"
          : "epistemic.detail.status.unavailable_rejected",
      unavailable: true,
      readable: false,
      projectionRefreshRequired: false,
      actionReuseAllowed: false,
      reusableActionCount: 0,
      driftIndeterminate: false,
      driftChanged: false,
    };
  }

  const inspection = outcome.inspection;
  const driftIndeterminate = Object.values(inspection.drift).some(
    (value) => value === "indeterminate",
  );
  const driftChanged = Object.values(inspection.drift).some(
    (value) => value === "changed",
  );

  return {
    statusKey: !inspection.projectionRefreshRequired
      ? "epistemic.detail.status.current"
      : driftIndeterminate
        ? "epistemic.detail.status.refresh_required_indeterminate"
        : "epistemic.detail.status.refresh_required_changed",
    unavailable: false,
    readable: true,
    projectionRefreshRequired: inspection.projectionRefreshRequired,
    actionReuseAllowed: inspection.actionReuseAllowed,
    reusableActionCount: inspection.actionReuseAllowed
      ? inspection.reusableActions.length
      : 0,
    driftIndeterminate,
    driftChanged,
  };
}
