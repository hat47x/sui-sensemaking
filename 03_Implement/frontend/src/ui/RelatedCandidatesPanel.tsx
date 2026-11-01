import { useMemo } from "react";

import { t } from "../i18n/translate";
import { rankAffinityCandidates } from "../domain/affinity_candidates";
import type { Document } from "../domain/types";

type RelatedCandidatesPanelProps = {
  document: Document;
  focusCardId: string;
  /** Read-only/shared contexts exclude unreviewed candidates. */
  reviewedOnly?: boolean;
};

/**
 * Local retrieval-only candidate list for the selected card.
 *
 * This is a PoC baseline for the COGNITIVE-ASSOC-01 retrieval line: no learned
 * model, no network, no document change. It only surfaces candidates for a
 * human to inspect.
 */
export function RelatedCandidatesPanel({
  document,
  focusCardId,
  reviewedOnly = false,
}: RelatedCandidatesPanelProps) {
  const candidates = useMemo(
    () => rankAffinityCandidates(document, focusCardId, { limit: 3, reviewedOnly }),
    [document, focusCardId, reviewedOnly],
  );
  const cardsById = useMemo(
    () => new Map(document.cards.map((card) => [card.id, card])),
    [document.cards],
  );

  return (
    <details data-testid="related-candidates-panel" style={{ marginTop: 12 }}>
      <summary style={{ fontSize: 12, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
        {t("affinity.panel.title", { count: candidates.length })}
      </summary>
      <p style={{ fontSize: 11, color: "#64748b", margin: "6px 0" }}>
        {t("affinity.panel.description")}
      </p>
      {candidates.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
          {candidates.map((candidate) => {
            const card = cardsById.get(candidate.cardId);
            return (
              <li
                key={candidate.cardId}
                data-testid="related-candidate"
                style={{ fontSize: 11, color: "#0f172a" }}
              >
                <span style={{ fontWeight: 600 }}>{card?.text ?? candidate.cardId}</span>
                <span style={{ color: "#64748b" }}>
                  {" "}
                  ({candidate.score.toFixed(3)}: {candidate.reasons.join(", ")})
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>
          {t("affinity.panel.empty")}
        </p>
      )}
      <p style={{ fontSize: 10, color: "#94a3b8", margin: "6px 0 0" }}>
        {t("affinity.panel.note")}
      </p>
    </details>
  );
}
