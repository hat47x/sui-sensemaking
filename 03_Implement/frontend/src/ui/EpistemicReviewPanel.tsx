import { useMemo, useState } from "react";

import { t } from "../i18n/translate";
import {
  appendEpistemicOutbox,
  clearEpistemicOutbox,
  loadEpistemicOutbox,
} from "../domain/epistemic_review_outbox";
import { EpistemicHealthAlert } from "./EpistemicHealthAlert";
import { EpistemicReviewStatus } from "./EpistemicReviewStatus";
import {
  buildBulkConfirmIntents,
  buildEpistemicClassificationIntent,
  buildEpistemicInspectionSummary,
  buildEpistemicReviewIntent,
  buildEpistemicReviewQueue,
  buildEpistemicReviewRequestIntent,
  buildEpistemicUiItems,
  type EpistemicProjectionInput,
  type EpistemicUiAction,
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
  const [intentText, setIntentText] = useState("");
  const [inspectionText, setInspectionText] = useState("");
  const [bulkPreview, setBulkPreview] = useState("");
  const [actionError, setActionError] = useState("");
  const [outboxCount, setOutboxCount] = useState(() => loadEpistemicOutbox().length);

  const canLoad = Boolean(docId) && !busy;

  const queue = useMemo(
    () => (projection ? buildEpistemicReviewQueue(projection) : []),
    [projection],
  );

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
      setIntentText("");
      setInspectionText("");
      setBulkPreview("");
      setError(loadError instanceof Error ? loadError.message : t("epistemic.panel.error"));
    } finally {
      setBusy(false);
    }
  }

  function clearOutbox() {
    clearEpistemicOutbox();
    setOutboxCount(0);
  }

  function previewBulkConfirm() {
    setActionError("");
    try {
      setBulkPreview(JSON.stringify(buildBulkConfirmIntents(items), null, 2));
    } catch (bulkError) {
      setBulkPreview("");
      setActionError(
        bulkError instanceof Error ? bulkError.message : t("epistemic.panel.intent_error"),
      );
    }
  }

  function handleAction(item: EpistemicUiItem, action: EpistemicUiAction) {
    setActionError("");
    try {
      if (action === "inspect-details") {
        setIntentText("");
        setInspectionText(JSON.stringify(buildEpistemicInspectionSummary(item), null, 2));
        return;
      }
      setInspectionText("");
      let intent: unknown;
      if (action === "confirm" || action === "reject") {
        intent = buildEpistemicReviewIntent(item, action);
      } else if (action === "withdraw-confirmation") {
        intent = buildEpistemicReviewIntent(item, "withdraw");
      } else if (action === "mark-hypothesis") {
        intent = buildEpistemicClassificationIntent(item);
      } else if (action === "request-review") {
        intent = buildEpistemicReviewRequestIntent(item);
      } else {
        setIntentText("");
        setActionError(t("epistemic.panel.action_not_wired"));
        return;
      }
      setIntentText(JSON.stringify(intent, null, 2));
      if (docId) {
        setOutboxCount(
          appendEpistemicOutbox({
            docId,
            recordedAt: new Date().toISOString(),
            intent: intent as Record<string, unknown>,
          }).length,
        );
      }
    } catch (intentError) {
      setIntentText("");
      setActionError(
        intentError instanceof Error ? intentError.message : t("epistemic.panel.intent_error"),
      );
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
              <EpistemicReviewStatus
                item={item}
                onAction={(action) => handleAction(item, action)}
              />
            </li>
          ))}
        </ul>
      ) : projection ? (
        <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0" }}>{t("epistemic.panel.empty")}</p>
      ) : null}
      {queue.length > 0 ? (
        <div data-testid="epistemic-review-queue" style={{ marginTop: 8 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#334155", margin: 0 }}>
            {t("epistemic.panel.queue_title", { count: queue.length })}
          </p>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 11, color: "#475569" }}>
            {queue.map((entry) => (
              <li key={entry.id}>
                {entry.kind}: {entry.id}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {items.length > 0 ? (
        <button
          type="button"
          onClick={previewBulkConfirm}
          style={{ fontSize: 11, marginTop: 8 }}
        >
          {t("epistemic.panel.bulk_preview")}
        </button>
      ) : null}
      {bulkPreview ? (
        <>
          <p style={{ fontSize: 10, color: "#475569", margin: "6px 0 0" }}>
            {t("epistemic.panel.bulk_preview_label")}
          </p>
          <pre
            data-testid="epistemic-bulk-preview"
            style={{
              margin: "4px 0 0",
              padding: 6,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 10,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {bulkPreview}
          </pre>
        </>
      ) : null}
      {actionError ? (
        <p style={{ fontSize: 11, color: "#991b1b", margin: "6px 0" }}>{actionError}</p>
      ) : null}
      {intentText ? (
        <>
          <p style={{ fontSize: 10, color: "#475569", margin: "6px 0 0" }}>
            {t("epistemic.panel.intent_preview")}
          </p>
          <pre
            data-testid="epistemic-review-intent"
            style={{
              margin: "4px 0 0",
              padding: 6,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 10,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {intentText}
          </pre>
        </>
      ) : null}
      {inspectionText ? (
        <>
          <p style={{ fontSize: 10, color: "#475569", margin: "6px 0 0" }}>
            {t("epistemic.panel.inspection_label")}
          </p>
          <pre
            data-testid="epistemic-inspection-summary"
            style={{
              margin: "4px 0 0",
              padding: 6,
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              fontSize: 10,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {inspectionText}
          </pre>
        </>
      ) : null}
      {outboxCount > 0 ? (
        <div style={{ marginTop: 8 }}>
          <p data-testid="epistemic-outbox-count" style={{ fontSize: 10, color: "#475569", margin: 0 }}>
            {t("epistemic.panel.outbox_count", { count: outboxCount })}
          </p>
          <button type="button" onClick={clearOutbox} style={{ fontSize: 10, marginTop: 2 }}>
            {t("epistemic.panel.outbox_clear")}
          </button>
          <p style={{ fontSize: 10, color: "#94a3b8", margin: "2px 0 0" }}>
            {t("epistemic.panel.outbox_note")}
          </p>
        </div>
      ) : null}
      <p style={{ fontSize: 10, color: "#94a3b8", margin: "6px 0 0" }}>
        {t("epistemic.panel.read_only")}
      </p>
    </details>
  );
}
