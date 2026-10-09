import { describe, expect, it } from "vitest";
import { filterCardsByDomainState, matchesDomainStateFilter } from "./domain_state_filter";
import type { Card } from "./types";

function c(overrides: Partial<Card> = {}): Card {
  return { id: "c1", text: "test", x: 0, y: 0, ...overrides };
}

describe("matchesDomainStateFilter", () => {
  it("matches any card with empty filter", () => {
    expect(matchesDomainStateFilter(c(), {})).toBe(true);
  });

  it("filters by claimType", () => {
    expect(matchesDomainStateFilter(c({ claimType: "fact" }), { claimTypes: ["fact"] })).toBe(true);
    expect(matchesDomainStateFilter(c({ claimType: "claim" }), { claimTypes: ["fact"] })).toBe(false);
  });

  it("filters unreviewed only", () => {
    expect(matchesDomainStateFilter(c({ textReviewed: false }), { unreviewedOnly: true })).toBe(true);
    expect(matchesDomainStateFilter(c({ textReviewed: true }), { unreviewedOnly: true })).toBe(false);
  });

  it("filters by critique presence", () => {
    expect(matchesDomainStateFilter(c({ critique: "hmm" }), { hasCritique: true })).toBe(true);
    expect(matchesDomainStateFilter(c({ critiqueTags: ["too_close"] }), { hasCritique: true })).toBe(true);
    expect(matchesDomainStateFilter(c(), { hasCritique: true })).toBe(false);
  });

  it("filters by holdState", () => {
    expect(matchesDomainStateFilter(c({ holdState: "held" }), { holdStates: ["held"] })).toBe(true);
    expect(matchesDomainStateFilter(c({ holdState: "pending" }), { holdStates: ["held"] })).toBe(true);
    expect(matchesDomainStateFilter(c({ holdState: "shelved" }), { holdStates: ["held"] })).toBe(false);
    expect(matchesDomainStateFilter(c(), { holdStates: ["held"] })).toBe(false);
  });
});

describe("filterCardsByDomainState", () => {
  it("returns all cards with empty filter", () => {
    const cards = [c(), c(), c()];
    expect(filterCardsByDomainState(cards, {})).toHaveLength(3);
  });

  it("filters by multiple criteria", () => {
    const cards = [
      c({ id: "a", claimType: "fact", textReviewed: true }),
      c({ id: "b", claimType: "hypothesis", textReviewed: false }),
      c({ id: "c", claimType: "fact", textReviewed: false }),
    ];
    const result = filterCardsByDomainState(cards, {
      claimTypes: ["fact"],
      unreviewedOnly: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c");
  });
});
