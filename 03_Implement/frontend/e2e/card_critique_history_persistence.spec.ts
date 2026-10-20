import { expect, test, type Page } from "@playwright/test";

const START_PANEL = '[data-panel="start-document-entry"]';
const SAVE = '[data-ui-core-action="save"]';
const DOC_ID = "doc_phase1_canvas";

function initialDocument() {
  return {
    version: 1,
    id: DOC_ID,
    title: "Critique history persistence",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      {
        id: "card-review",
        text: "observation that may not belong together",
        x: 120,
        y: 120,
        textReviewed: true,
        claimType: "claim",
      },
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
        headers: { ETag: `"critique-history-${saveCount}"` },
        body: JSON.stringify(persisted),
      });
      return;
    }

    getCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"critique-history-load-${getCount}"` },
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

test("a saved critique revision survives reload and can be restored", async ({ page }) => {
  const routes = await installRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?locale=en");
  await openSample(page);

  await page.locator('[data-card-id="card-review"]').click();

  const critique = page.locator('textarea[placeholder="Optional feedback about this card"]');
  await critique.fill("First doubt: this may not belong together.");
  await critique.press("Tab");
  await critique.fill("New material changed my view.");
  await critique.press("Tab");

  await page.locator(SAVE).click();
  await expect(page.getByTestId("status-message")).toContainText(/Saved|保存/);
  await expect.poll(() => routes.saveCount()).toBe(1);

  const saved = routes.persisted() as {
    cards: Array<{
      id: string;
      critique?: string;
      critiqueHistory?: Array<{
        fromCritique: string | null;
        toCritique: string | null;
        changeKind: string;
      }>;
    }>;
  };
  const savedCard = saved.cards.find((card) => card.id === "card-review");
  expect(savedCard?.critique).toBe("New material changed my view.");
  expect(savedCard?.critiqueHistory?.map((entry) => entry.toCritique)).toEqual([
    "First doubt: this may not belong together.",
    "New material changed my view.",
  ]);
  expect(savedCard?.critiqueHistory?.every((entry) => entry.changeKind === "manual")).toBe(true);

  // Cross the real client save/load boundary: the GET below returns exactly
  // the document that the PUT above persisted.
  await page.reload();
  await openSample(page);
  await expect.poll(() => routes.getCount()).toBeGreaterThanOrEqual(2);

  await page.locator('[data-card-id="card-review"]').click();
  const reloadedCritique = page.locator('textarea[placeholder="Optional feedback about this card"]');
  await expect(reloadedCritique).toHaveValue("New material changed my view.");

  const history = page.getByTestId("card-critique-history");
  await history.locator("summary").click();
  const firstRevision = history.locator("[data-critique-history-entry]").filter({
    hasText: "First doubt: this may not belong together.",
  });
  await expect(firstRevision).toHaveCount(1);
  await firstRevision.getByRole("button").first().click();
  await firstRevision.getByRole("button", { name: "Restore this version" }).click();

  await expect(reloadedCritique).toHaveValue("First doubt: this may not belong together.");
  await expect(history.locator("summary")).toContainText("Critique note history (3)");
});
