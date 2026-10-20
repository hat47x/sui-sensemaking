import { expect, test, type Page } from "@playwright/test";
import { buildFirstMeaningfulMapDocument } from "./helpers/product_value_fixtures";

const START_PANEL = '[data-panel="start-document-entry"]';

async function routeSampleDocument(page: Page): Promise<() => void> {
  let sampleEnabled = false;

  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sampleEnabled ? buildFirstMeaningfulMapDocument() : buildFirstMeaningfulMapDocument([])),
    });
  });

  return () => {
    sampleEnabled = true;
  };
}

test("a card keeps an earlier critique revision and can restore it", async ({ page }) => {
  const enableSample = await routeSampleDocument(page);

  await page.goto("/?locale=en");
  await expect(page.locator(START_PANEL)).toBeVisible();
  enableSample();
  await page.getByRole("button", { name: "Open sample" }).click();

  await page.getByRole("button", { name: "first value user problem" }).click();

  const critique = page.locator('textarea[placeholder="Optional feedback about this card"]');
  await critique.fill("First doubt: this may not belong together.");
  await critique.press("Tab");

  const history = page.getByTestId("card-critique-history");
  await expect(history.locator("summary")).toContainText("Critique note history (1)");

  await critique.fill("New material changed my view.");
  await critique.press("Tab");
  await expect(history.locator("summary")).toContainText("Critique note history (2)");

  await history.locator("summary").click();
  const firstRevision = history.locator("[data-critique-history-entry]").filter({
    hasText: "First doubt: this may not belong together.",
  });
  await expect(firstRevision).toHaveCount(1);
  await firstRevision.getByRole("button").first().click();
  await firstRevision.getByRole("button", { name: "Restore this version" }).click();

  await expect(critique).toHaveValue("First doubt: this may not belong together.");
  await expect(history.locator("summary")).toContainText("Critique note history (3)");
});
