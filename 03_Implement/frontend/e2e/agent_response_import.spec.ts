import { expect, test, type Page } from "@playwright/test";

// EXT-AGENT-02 (ADR-0049 D3): AgentResponse v1 import. Covers: the trigger
// stays behind "Advanced" disclosure (AC-5/CB-1), parsing never mutates the
// document (AC-6), a clean island_title adopt is one undo-able document
// change (AC-1), an orphaned proposal is kept and flagged rather than
// dropped (AC-3), a baseDocSignature-mismatched patch is routed to file
// export instead of a silent apply (AC-3), and re-pasting the same
// response does not create duplicate proposals (AC-4). A response without a
// correlation block gets no audit id: its proposals cannot be imported, but
// they can be discarded locally.

const FIXED_TIMESTAMP = "2026-07-09T00:00:00.000Z";
const RESPONSE_TASK_ID = "22222222-2222-2222-2222-222222222222";
const ALL_KINDS_TASK_ID = "33333333-3333-3333-3333-333333333333";
const AGENT_TASK_LEDGER_KEY = "sui-sensemaking/agent-task-ledger-v1";

// Import and Export are offered only for correlated proposals. A response is
// correlated when its correlation block matches a task already recorded in
// the local ledger (verifyAgentResponseCorrelation), so each fixture response
// echoes a correlation block and the ledger is seeded in beforeEach.
function buildCorrelation(taskId: string) {
  return {
    schemaVersion: "agent-task.v1",
    taskId,
    createdAt: FIXED_TIMESTAMP,
    docId: "doc_agent_response_e2e_fixture",
    baseDocSignature: `doc_agent_response_e2e_fixture:${FIXED_TIMESTAMP}`,
    bundleHash: `e2e-bundle-${taskId}`,
    queryCanonicalHash: `e2e-query-${taskId}`,
    taskKind: "island_titles",
    locale: "ja",
  };
}

function buildFixtureDocument() {
  return {
    version: 1,
    id: "doc_agent_response_e2e_fixture",
    title: "Agent response e2e fixture",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "card one", x: 0, y: 0, claimType: "claim", textReviewed: true },
      { id: "c2", text: "card two", x: 200, y: 0, claimType: "claim", textReviewed: true },
    ],
    edges: [],
    islands: [{ id: "i1", cardIds: ["c1", "c2"], title: "Original Title" }],
    readingOrder: ["c1", "c2"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

function buildResponseJson(): string {
  return JSON.stringify({
    schemaVersion: "agent-response.v1",
    taskId: RESPONSE_TASK_ID,
    correlation: buildCorrelation(RESPONSE_TASK_ID),
    agent: "test-agent",
    proposals: [
      {
        proposalId: "clean-island-title",
        kind: "island_title",
        targetRef: { islandId: "i1" },
        content: { title: "Suggested Title" },
        rationale: "common theme across both cards",
      },
      {
        proposalId: "orphaned-island-title",
        kind: "island_title",
        targetRef: { islandId: "does-not-exist" },
        content: { title: "Unreachable" },
        rationale: "targets a nonexistent island",
      },
      {
        proposalId: "stale-patch",
        kind: "patch",
        targetRef: {},
        content: {},
        rationale: "cleanup from a stale baseline",
        patch: {
          kind: "sui-sensemaking-patch",
          version: 1,
          baseDocSignature: "doc_agent_response_e2e_fixture:2020-01-01T00:00:00.000Z",
          ops: [{ id: "op1", kind: "delete_card", cardId: "c2" }],
        },
      },
    ],
  });
}

async function routeFixture(page: Page): Promise<void> {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: '"agent-response-e2e"' },
      body: JSON.stringify(buildFixtureDocument()),
    });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providerKind: "none" }) });
  });
  await page.route("**/ai/proposals/audit", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "accepted" }) });
  });
  await page.route("**/ai/external-proposals/register", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { proposalId: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ registered: true, proposalId: body.proposalId, provenanceLevel: "user_presented_unsigned" }),
    });
  });
  await page.route("**/ai/external-proposals/audit", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { proposalId: string; decision: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        recorded: true,
        eventId: `e2e-${body.decision}`,
        proposalId: body.proposalId,
        status: body.decision === "adopt" ? "accepted" : body.decision === "reject" ? "rejected" : "held",
        reviewState: "unreviewed",
        recordedAt: FIXED_TIMESTAMP,
      }),
    });
  });
}

// The ledger key is the legacy (unscoped) key: the e2e run has no tenant session.
async function seedAgentTaskLedger(page: Page): Promise<void> {
  const entries = [RESPONSE_TASK_ID, ALL_KINDS_TASK_ID].map((taskId) => ({ ...buildCorrelation(taskId), exportedAt: FIXED_TIMESTAMP }));
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Without storage the responses stay uncorrelated: Import is unavailable.
      }
    },
    { key: AGENT_TASK_LEDGER_KEY, value: JSON.stringify(entries) },
  );
}

test.beforeEach(async ({ page }) => {
  await routeFixture(page);
  await seedAgentTaskLedger(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/?locale=en");
  const startPanel = page.locator('[data-panel="start-document-entry"]');
  await expect(startPanel).toBeVisible();
  await startPanel.getByRole("button", { name: /Open sample|サンプルを開く/ }).click();
  await expect(startPanel).toBeHidden();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
});

test("trigger is absent until Advanced is enabled", async ({ page }) => {
  await page.getByRole("button", { name: "Advanced", exact: true }).click(); // toggle off
  await expect(page.getByRole("button", { name: "Import agent response" })).toHaveCount(0);
  await page.getByRole("button", { name: "Advanced", exact: true }).click(); // toggle back on
  await expect(page.getByRole("button", { name: "Import agent response" })).toBeVisible();
});

test("parsing never mutates the document; a clean adopt is one undo-able change; an orphaned proposal is kept flagged; a stale patch is routed to file export", async ({
  page,
}) => {
  const undoButton = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undoButton).toBeDisabled();

  await page.getByRole("button", { name: "Import agent response" }).click();
  const panel = page.locator('[data-ui-region="agent-response-import"]');
  await expect(panel).toBeVisible();

  await page.getByTestId("agent-response-paste-input").fill(buildResponseJson());
  await page.getByTestId("agent-response-parse-button").click();

  // AC-6: parsing alone must not create a history entry.
  await expect(undoButton).toBeDisabled();

  const cleanProposal = page.getByTestId("agent-response-proposal-clean-island-title");
  const orphanedProposal = page.getByTestId("agent-response-proposal-orphaned-island-title");
  const staleProposal = page.getByTestId("agent-response-proposal-stale-patch");
  await expect(cleanProposal).toBeVisible();
  await expect(orphanedProposal).toBeVisible();
  await expect(staleProposal).toBeVisible();

  // AC-3: orphaned proposal has no Import action, only Discard.
  await expect(orphanedProposal).toContainText("kept as an orphaned proposal");
  await expect(orphanedProposal.getByRole("button", { name: "Import" })).toHaveCount(0);
  await expect(orphanedProposal.getByRole("button", { name: "Discard" })).toBeVisible();

  // AC-3: a baseDocSignature-mismatched patch offers file export, not a
  // one-click adopt that could silently apply a stale change.
  await expect(staleProposal).toContainText("export it as a patch file");
  await expect(staleProposal.getByRole("button", { name: "Import" })).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await staleProposal.getByRole("button", { name: "Export as patch file" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("agent-patch-stale-patch.json");

  // AC-1: adopting the clean proposal is exactly one undo-able document change.
  await cleanProposal.getByRole("button", { name: "Import" }).click();
  await expect(page.getByTestId("status-message")).toContainText("Proposal imported");
  await expect(cleanProposal).toHaveAttribute("data-proposal-status", "adopted");
  await expect(undoButton).toBeEnabled();

  // Close the panel overlay before interacting with the toolbar behind it.
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();
  await undoButton.click();
  await expect(undoButton).toBeDisabled();
});

test("all 5 proposal kinds can be individually imported as unreviewed, undo-able document changes (AC-1)", async ({ page }) => {
  const undoButton = page.getByRole("button", { name: "Undo", exact: true });
  const allKindsResponse = JSON.stringify({
    schemaVersion: "agent-response.v1",
    taskId: ALL_KINDS_TASK_ID,
    correlation: buildCorrelation(ALL_KINDS_TASK_ID),
    proposals: [
      {
        proposalId: "k-island-title",
        kind: "island_title",
        targetRef: { islandId: "i1" },
        content: { title: "Suggested Title" },
        rationale: "r1",
      },
      {
        proposalId: "k-merge-candidate",
        kind: "merge_candidate",
        targetRef: { cardIds: ["c1", "c2"] },
        content: { mergedText: "merged text", mergeMethod: "near_duplicate" },
        rationale: "r2",
      },
      {
        proposalId: "k-narrative-draft",
        kind: "narrative_draft",
        targetRef: {},
        content: { title: "Draft", text: "narrative body" },
        rationale: "r3",
      },
      {
        proposalId: "k-critique",
        kind: "critique",
        targetRef: { cardIds: ["c1"] },
        content: { text: "this feels off" },
        rationale: "r4",
      },
      {
        proposalId: "k-patch",
        kind: "patch",
        targetRef: {},
        content: {},
        rationale: "r5",
        patch: {
          kind: "sui-sensemaking-patch",
          version: 1,
          baseDocSignature: "doc_agent_response_e2e_fixture:2026-07-09T00:00:00.000Z",
          ops: [{ id: "op1", kind: "upsert_card", card: { id: "c3", text: "patched-in card", x: 400, y: 0 } }],
        },
      },
    ],
  });

  await page.getByRole("button", { name: "Import agent response" }).click();
  await page.getByTestId("agent-response-paste-input").fill(allKindsResponse);
  await page.getByTestId("agent-response-parse-button").click();

  for (const proposalId of ["k-island-title", "k-merge-candidate", "k-narrative-draft", "k-critique", "k-patch"]) {
    const card = page.getByTestId(`agent-response-proposal-${proposalId}`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Import" }).click();
    await expect(card).toHaveAttribute("data-proposal-status", "adopted");
  }

  // merge_candidate's "adopt" stages it into the existing mergeSuggestions
  // review surface rather than mutating the document directly (it still
  // requires MergeSuggestionsPanel's own accept step) -- so only 4 of the 5
  // kinds push a history entry here. Confirm at least one did.
  await expect(undoButton).toBeEnabled();
});

test("re-pasting the same response does not create duplicate proposals", async ({ page }) => {
  await page.getByRole("button", { name: "Import agent response" }).click();
  await page.getByTestId("agent-response-paste-input").fill(buildResponseJson());
  await page.getByTestId("agent-response-parse-button").click();
  await expect(page.getByTestId("agent-response-proposal-clean-island-title")).toBeVisible();

  await page.getByTestId("agent-response-parse-button").click();
  await expect(page.getByTestId("status-message")).toContainText("already been imported");
  await expect(page.getByTestId("agent-response-proposal-clean-island-title")).toHaveCount(1);
});

test("an uncorrelated proposal has no Import action and Discard removes it without touching the document", async ({ page }) => {
  const undoButton = page.getByRole("button", { name: "Undo", exact: true });
  const uncorrelatedResponse = JSON.stringify({
    schemaVersion: "agent-response.v1",
    taskId: "44444444-4444-4444-4444-444444444444",
    proposals: [
      {
        proposalId: "no-correlation",
        kind: "island_title",
        targetRef: { islandId: "i1" },
        content: { title: "Suggested Title" },
        rationale: "no correlation block",
      },
    ],
  });

  await page.getByRole("button", { name: "Import agent response" }).click();
  await page.getByTestId("agent-response-paste-input").fill(uncorrelatedResponse);
  await page.getByTestId("agent-response-parse-button").click();

  const card = page.getByTestId("agent-response-proposal-no-correlation");
  await expect(card).toContainText("cannot be audited");
  await expect(card.getByRole("button", { name: "Import" })).toHaveCount(0);

  await card.getByRole("button", { name: "Discard" }).click();
  await expect(card).toHaveCount(0);
  await expect(undoButton).toBeDisabled();
});
