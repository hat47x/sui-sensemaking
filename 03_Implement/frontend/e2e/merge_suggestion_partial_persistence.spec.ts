import { expect, test, type Page } from "@playwright/test";

const START_PANEL = '[data-panel="start-document-entry"]';
const SAVE = '[data-ui-core-action="save"]';
const WORK_MODE = '[data-ui-core-action="work-mode"]';
const MERGED_TEXT = "Two matching observations are represented together.";

function buildDocument() {
  return {
    version: 1,
    id: "doc_phase1_canvas",
    title: "Partial merge persistence sample",
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "Observation one", x: 0, y: 0, textReviewed: true, claimType: "fact" },
      { id: "c2", text: "Observation two", x: 280, y: 0, textReviewed: true, claimType: "fact" },
      { id: "c3", text: "Observation three should remain separate", x: 560, y: 0, textReviewed: true, claimType: "fact" },
    ],
    edges: [],
    islands: [],
    readingOrder: ["c1", "c2", "c3"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

async function routePersistentDocument(page: Page) {
  let storedDocument: any = buildDocument();
  let putCount = 0;

  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/ai/available-models", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], unavailableReason: "no_active_models" }) });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ providerKind: "none", callCounts: {}, tokenUsage: {} }),
    });
  });
  await page.route("**/ai/suggest-merges", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [{
          groupId: "partial-three-cards",
          targetCardId: "c1",
          candidateCardIds: ["c2", "c3"],
          scoreSummary: { min: 0.9, max: 0.95, avg: 0.925 },
          reasonCodes: ["e2e:partial-selection-contract"],
          snapshotVersion: "CTR-2B-01-CANDIDATE-GROUP-V1",
          mergeMethod: "near_duplicate",
          cardIds: ["c1", "c2", "c3"],
          mergedTextDraft: MERGED_TEXT,
          rationale: "The first two can be represented together while the third may remain independent.",
        }],
      }),
    });
  });
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    if (route.request().method() === "PUT") {
      storedDocument = JSON.parse(route.request().postData() ?? "{}");
      putCount += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"partial-merge-${putCount}"` },
      body: JSON.stringify(storedDocument),
    });
  });
  return { storedDocument: () => storedDocument, putCount: () => putCount };
}

async function openSample(page: Page) {
  const startPanel = page.locator(START_PANEL);
  await expect(startPanel).toBeVisible();
  await startPanel.getByRole("button", { name: /Open sample|サンプルを開く/ }).click();
  await expect(startPanel).toBeHidden();
}

async function openMergePanel(page: Page) {
  const advanced = page.getByRole("button", { name: "Advanced", exact: true });
  if ((await advanced.getAttribute("aria-pressed")) !== "true") await advanced.click();
  await page.locator(WORK_MODE).click();
  const workMode = page.locator('[data-ui-region="work-mode"]');
  await expect(workMode).toBeVisible();
  await workMode.getByRole("tab", { name: "Merge selection" }).click();
  return workMode;
}

test("a human-selected partial subset is the only subset merged and survives save/reload", async ({ page }) => {
  const persistence = await routePersistentDocument(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?locale=en");
  await openSample(page);

  const workMode = await openMergePanel(page);
  await workMode.getByRole("button", { name: "Collect candidates" }).click();
  const partialSelectionSummary = workMode.getByText("Select cards for partial acceptance");
  await expect(partialSelectionSummary).toBeVisible();
  await partialSelectionSummary.click();

  const reason = workMode.getByPlaceholder("Record why you accept/partial/reject/defer this proposal");
  await reason.fill("I want to merge only c1 and c2; c3 has a distinct nuance that should remain separate.");
  const partialButton = workMode.getByRole("button", { name: "Partially accept" });
  await expect(partialButton).toBeDisabled();

  await workMode.getByRole("checkbox", { name: /c1: Observation one/ }).check();
  await expect(partialButton).toBeDisabled();
  await workMode.getByRole("checkbox", { name: /c2: Observation two/ }).check();
  await expect(partialButton).toBeEnabled();
  await partialButton.click();

  // Decision and apply are deliberately separate operations. Persist the
  // decision first, reload it, and require the recorded subset to be visible
  // again before the human can explicitly apply it.
  await workMode.getByRole("button", { name: "Close work mode" }).click();
  await page.locator(SAVE).click();
  await expect.poll(() => persistence.putCount()).toBe(1);

  await page.reload();
  await openSample(page);
  const reopenedWorkMode = await openMergePanel(page);
  await reopenedWorkMode.getByRole("button", { name: "Collect candidates" }).click();
  const reopenedPartialSelectionSummary = reopenedWorkMode.getByText("Select cards for partial acceptance");
  await reopenedPartialSelectionSummary.click();
  await expect(reopenedWorkMode.getByRole("checkbox", { name: /c1: Observation one/ })).toBeChecked();
  await expect(reopenedWorkMode.getByRole("checkbox", { name: /c2: Observation two/ })).toBeChecked();
  await expect(reopenedWorkMode.getByRole("checkbox", { name: /c3: Observation three/ })).not.toBeChecked();

  const applyButton = reopenedWorkMode.getByRole("button", { name: "Apply accepted merge" });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(reopenedWorkMode.getByRole("button", { name: "Merge applied" })).toBeDisabled();

  await reopenedWorkMode.getByRole("button", { name: "Close work mode" }).click();
  await page.locator(SAVE).click();
  await expect.poll(() => persistence.putCount()).toBe(2);

  const saved = persistence.storedDocument();
  const representative = saved.cards.find((card: any) => Array.isArray(card.repOf) && card.repOf.includes("c1") && card.repOf.includes("c2"));
  expect(representative).toBeTruthy();
  expect(new Set(representative.sources)).toEqual(new Set(["c1", "c2"]));
  expect(saved.cards.find((card: any) => card.id === "c1").mergedIntoCardId).toBe(representative.id);
  expect(saved.cards.find((card: any) => card.id === "c2").mergedIntoCardId).toBe(representative.id);

  const untouched = saved.cards.find((card: any) => card.id === "c3");
  expect(untouched.text).toBe("Observation three should remain separate");
  expect(untouched.mergedIntoCardId).toBeUndefined();
  expect(untouched.canonicalId).toBeUndefined();

  const decision = saved.mergeSuggestionDecisions.find((item: any) => item.decision === "partial");
  expect(decision.cardIds).toEqual(["c1", "c2", "c3"]);
  expect(decision.selectedCardIds).toEqual(["c1", "c2"]);
  expect(decision.sourceCardIds).toEqual(["c1", "c2"]);
  expect(decision.representativeCardId).toBe(representative.id);

  await page.reload();
  await openSample(page);
  const primaryFlow = page.locator('[data-ui-region="primary-flow"]');
  await expect(primaryFlow).toContainText(MERGED_TEXT);
  await expect(primaryFlow).toContainText("Observation three should remain separate");
});
