/**
 * DOMAIN-EXPR-01: Domain state filter for cards.
 *
 * ADR-0046 性能予算: 代表規模での主要操作=不変（O(n)単一パス、n≦300）/ メインスレッド100ms超の同期処理=なし
 */
import type { Card } from "./types";
import { canonicalHoldState } from "./hold_state_ops";

export type DomainStateFilter = {
  /** Filter by claim type. Empty = no filter. */
  claimTypes?: Array<"fact" | "claim" | "hypothesis" | "unknown">;
  /** Only show unreviewed cards. */
  unreviewedOnly?: boolean;
  /** Only show cards with critique. */
  hasCritique?: boolean;
  /** Filter by hold state. */
  holdStates?: Array<"held" | "pending" | "shelved">;
};

export function matchesDomainStateFilter(card: Card, filter: DomainStateFilter): boolean {
  if (filter.claimTypes && filter.claimTypes.length > 0) {
    const ct = card.claimType ?? "unknown";
    if (!filter.claimTypes.includes(ct)) {
      return false;
    }
  }

  if (filter.unreviewedOnly && card.textReviewed === true) {
    return false;
  }

  if (filter.hasCritique) {
    const hasCritiqueText =
      typeof card.critique === "string" && card.critique.trim().length > 0;
    const hasCritiqueTags = (card.critiqueTags?.length ?? 0) > 0;
    if (!hasCritiqueText && !hasCritiqueTags) {
      return false;
    }
  }

  if (filter.holdStates && filter.holdStates.length > 0) {
    const hs = canonicalHoldState(card.holdState);
    if (!hs || !filter.holdStates.some((state) => canonicalHoldState(state) === hs)) {
      return false;
    }
  }

  return true;
}

export function filterCardsByDomainState(
  cards: Card[],
  filter: DomainStateFilter,
): Card[] {
  const hasActiveFilter =
    (filter.claimTypes && filter.claimTypes.length > 0) ||
    filter.unreviewedOnly ||
    filter.hasCritique ||
    (filter.holdStates && filter.holdStates.length > 0);

  if (!hasActiveFilter) {
    return cards;
  }

  return cards.filter((card) => matchesDomainStateFilter(card, filter));
}
