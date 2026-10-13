import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentResponseImportPanel } from "./AgentResponseImportPanel";
import { boundResolvedAgentImportedProposalReviews, type ImportedProposalReview } from "../import/agent_response_import";

function buildReview(status: ImportedProposalReview["status"], key: string): ImportedProposalReview {
  return {
    proposalId: key,
    kind: "island_title",
    targetRef: {},
    content: { title: `proposal ${key}` },
    rationale: "test",
    rationaleStated: true,
    patchHasDeleteOps: false,
    warnings: [],
    reviewKey: key,
    taskId: "task-1",
    status,
    orphaned: false,
    provenance: "unverified-legacy",
  };
}

function buildProps(overrides: Partial<React.ComponentProps<typeof AgentResponseImportPanel>> = {}) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    triggerRef: { current: null },
    pastedText: "",
    onPastedTextChange: vi.fn(),
    mode: "lenient" as const,
    onModeChange: vi.fn(),
    onParse: vi.fn(),
    parseErrors: [],
    parseWarnings: [],
    reviews: [],
    onAdopt: vi.fn(),
    onReject: vi.fn(),
    onDiscardUncorrelated: vi.fn(),
    onExportPatchFile: vi.fn(),
    ...overrides,
  };
}

describe("AgentResponseImportPanel accessibility", () => {
  it("leaves the paste textarea unmarked as invalid when there are no parse errors", () => {
    const html = renderToStaticMarkup(React.createElement(AgentResponseImportPanel, buildProps()));
    const textareaMatch = html.match(/<textarea[^>]*data-testid="agent-response-paste-input"[^>]*>/);

    expect(textareaMatch).not.toBeNull();
    expect(textareaMatch![0]).not.toContain("aria-invalid=\"true\"");
    expect(textareaMatch![0]).not.toMatch(/aria-describedby="[^"]+"/);
  });

  it("associates the paste textarea with the parse-error message via aria-describedby/aria-invalid", () => {
    const html = renderToStaticMarkup(
      React.createElement(AgentResponseImportPanel, buildProps({ parseErrors: ["payload.missing_taskId"] })),
    );
    const textareaMatch = html.match(/<textarea[^>]*data-testid="agent-response-paste-input"[^>]*>/);
    expect(textareaMatch).not.toBeNull();
    expect(textareaMatch![0]).toContain('aria-invalid="true"');

    const describedByMatch = textareaMatch![0].match(/aria-describedby="([^"]+)"/);
    expect(describedByMatch).not.toBeNull();

    const errorDivId = describedByMatch![1];
    expect(html).toContain(`id="${errorDivId}"`);
    expect(html).toContain("payload.missing_taskId");
  });
});

describe("boundResolvedAgentImportedProposalReviews (FB-RM-UX-02)", () => {
  it("never drops pending reviews even when the list is large", () => {
    const manyPending = Array.from({ length: 70 }, (_, i) => buildReview("pending", `p-${i}`));
    const bounded = boundResolvedAgentImportedProposalReviews(manyPending, 50);
    expect(bounded).toHaveLength(70);
    expect(bounded.every((review) => review.status === "pending")).toBe(true);
  });

  it("drops the oldest resolved entries when they exceed the limit", () => {
    const reviews = [
      buildReview("adopted", "old-1"),
      buildReview("adopted", "old-2"),
      buildReview("adopted", "old-3"),
      buildReview("adopted", "old-4"),
      ...Array.from({ length: 2 }, (_, i) => buildReview("pending", `p-${i}`)),
    ];
    const bounded = boundResolvedAgentImportedProposalReviews(reviews, 2);
    const boundedKeys = new Set(bounded.map((review) => review.reviewKey));
    expect(boundedKeys).toHaveLength(4); // 2 pending + newest 2 of 4 resolved
    expect(boundedKeys).toContain("old-3");
    expect(boundedKeys).toContain("old-4");
    expect(boundedKeys).not.toContain("old-1");
    expect(boundedKeys).not.toContain("old-2");
  });
});
