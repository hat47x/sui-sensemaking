import { expect, test, type Page } from "@playwright/test";

const START_PANEL = '[data-panel="start-document-entry"]';
const SAVE = '[data-ui-core-action="save"]';
const DOC_ID = "doc_phase1_canvas";
const CREATED_AT = "2026-10-21T00:00:00.000Z";

function initialDocument() {
  return {
    version: 1,
    id: DOC_ID,
    title: "Structure decision persistence",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "first observation", x: 100, y: 100, textReviewed: true },
      { id: "c2", text: "second observation", x: 300, y: 100, textReviewed: true },
    ],
    edges: [],
    islands: [],
    readingOrder: [],
    narratives: [],
    evidenceLinks: [],
  };
}

async function installRoutes(page: Page) {
  let persisted = initialDocument();
  let saveCount = 0;
  let getCount = 0;

  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route(`**/docs/${DOC_ID}`, async (route) => {
    if (route.request().method() === "PUT") {
      persisted = route.request().postDataJSON();
      saveCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: `"structure-decision-${saveCount}"` },
        body: JSON.stringify(persisted),
      });
      return;
    }

    getCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"structure-decision-load-${getCount}"` },
      body: JSON.stringify(persisted),
    });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providerKind: "none" }) });
  });
  await page.route("**/ai/available-models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [], unavailableReason: "no_active_models" }),
    });
  });

  return {
    persisted: () => persisted,
    saveCount: () => saveCount,
    getCount: () => getCount,
  };
}

async function openSample(page: Page): Promise<void> {
  const startPanel = page.locator(START_PANEL);
  await expect(startPanel).toBeVisible();
  await startPanel.getByRole("button", { name: /Open sample|サンプルを開く/ }).click();
  await expect(startPanel).toBeHidden();
}

test("a structure decision reason survives save, reload, and reselect", async ({ page }) => {
  const routes = await installRoutes(page);
  await page.goto("/?locale=en");
  await openSample(page);

  await page.getByRole("button", { name: "first observation" }).click();
  await page.getByRole("button", { name: "second observation" }).click({ modifiers: ["Shift"] });

  const bulkBar = page.locator('[data-ui-region="bulk-operations-bar"]');
  await bulkBar.getByRole("button", { name: "Create Island" }).click();

  const history = page.getByTestId("structure-decision-history");
  await expect(history.locator("summary")).toContainText("Structure decisions (1)");
  await history.locator("summary").click();
  const reason = history.getByLabel("Reason for this decision");
  await reason.fill("These observations describe the same concern.");
  await history.getByRole("button", { name: "Save reason" }).click();
  await expect(history).toContainText("These observations describe the same concern.");

  await page.locator(SAVE).click();
  await expect(page.getByTestId("status-message")).toContainText(/Saved|保存/);
  await expect.poll(() => routes.saveCount()).toBe(1);

  const saved = routes.persisted() as {
    islands: Array<{ id: string; cardIds: string[] }>;
    structureDecisions?: Array<{ islandId?: string; rationale?: string; action: string; cardIds: string[] }>;
  };
  const island = saved.islands[0];
  expect(island.cardIds.slice().sort()).toEqual(["c1", "c2"]);
  expect(saved.structureDecisions?.[0]).toMatchObject({
    action: "island_create",
    islandId: island.id,
    rationale: "These observations describe the same concern.",
  });

  await page.reload();
  await openSample(page);
  await expect.poll(() => routes.getCount()).toBeGreaterThanOrEqual(2);

  const islandButton = page.getByRole("button", { name: new RegExp(`Select island ${island.id}`) });
  await islandButton.focus();
  await islandButton.press("Enter");
  const reloadedHistory = page.getByTestId("structure-decision-history");
  await expect(reloadedHistory.locator("summary")).toContainText("Structure decisions (1)");
  await reloadedHistory.locator("summary").click();
  await expect(reloadedHistory).toContainText("These observations describe the same concern.");
});
