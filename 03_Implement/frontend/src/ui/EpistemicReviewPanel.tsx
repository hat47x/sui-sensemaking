import { useMemo, useState } from "react";

import { t } from "../i18n/translate";
import { EpistemicHealthAlert } from "./EpistemicHealthAlert";
import { EpistemicReviewStatus } from "./EpistemicReviewStatus";
import {
  buildEpistemicUiItems,
  type EpistemicProjectionInput,
  type EpistemicUiItem,
} from "./epistemic_review_model";
import { fetchEpistemicProjection } from "./epistemic_projection_api";

type EpistemicReviewPanelProps = {
  docId: string | undefined;
  fetchProjection?: typeof fetchEpistemicProjection;
};

/**
 * PoC tenant-plane surface for the TEI epistemic projection.
 *
 * The document is loaded on an explicit click so opening the SidePanel does not
 * add a network request. This is read-only: the TEI confirmation state is shown
 * as derived data and is never written back to DocumentV1 or review history.
 */
export function EpistemicReviewPanel({
  docId,
  fetchProjection = fetchEpistemicProjection,
}: EpistemicReviewPanelProps) {
  const [projection, setProjection] = useState<EpistemicProjectionInput | null>(null);
  const [items, setItems] = useState<EpistemicUiItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canLoad = Boolean(docId) && !busy;

  const summary = useMemo(
    () => (projection ? t("epistemic.panel.loaded", { count: items.length }) : ""),
    [items.length, projection],
  );

  async function load() {
    if (!docId || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const parsed = await fetchProjection(docId);
      setProjection(parsed);
      setItems(buildEpistemicUiItems(parsed));
    } catch (loadError) {
      setProjection(null);
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : t("epistemic.panel.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details data-testid="epistemic-review-panel" style={{ marginTop: 12 }}>
      <summary style={{ fontSize: 12, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
        {t("epistemic.panel.title")}
      </summary>
      <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0" }}>
        {t("epistemic.panel.description")}
      </p>
      <button type="button" disabled={!canLoad} onClick={() => void load()} style={{ fontSize: 11 }}>
        {busy ? t("epistemic.panel.loading") : t("epistemic.panel.load")}
      </button>
      {summary ? <p style={{ fontSize: 11, color: "#166534", margin: "6px 0" }}>{summary}</p> : null}
      {error ? <p style={{ fontSize: 11, color: "#991b1b", margin: "6px 0" }}>{error}</p> : null}
      {projection ? <EpistemicHealthAlert projection={projection} /> : null}
      {items.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 6 }}>
          {items.map((item) => (
            <li key={item.assertionId}>
              <EpistemicReviewStatus item={item} onAction={() => {}} showActions={false} />
            </li>
          ))}
        </ul>
      ) : projection ? (
        <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0" }}>{t("epistemic.panel.empty")}</p>
      ) : null}
      <p style={{ fontSize: 10, color: "#94a3b8", margin: "6px 0 0" }}>
        {t("epistemic.panel.read_only")}
      </p>
    </details>
  );
}
