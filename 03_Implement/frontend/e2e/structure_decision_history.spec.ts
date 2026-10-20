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

test("creating an island records the decision and accepts a later reason", async ({ page }) => {
  const enableSample = await routeSampleDocument(page);

  await page.goto("/?locale=en");
  await expect(page.locator(START_PANEL)).toBeVisible();
  enableSample();
  await page.getByRole("button", { name: "Open sample" }).click();

  await page.getByRole("button", { name: "first value user problem" }).click();
  await page.getByRole("button", { name: "first value observation memo" }).click({ modifiers: ["Shift"] });

  const bulkBar = page.locator('[data-ui-region="bulk-operations-bar"]');
  await bulkBar.getByRole("button", { name: "Create Island" }).click();

  const history = page.getByTestId("structure-decision-history");
  await expect(history.locator("summary")).toContainText("Structure decisions (1)");
  await history.locator("summary").click();
  await expect(history).toContainText("Created island");

  const reason = history.getByLabel("Reason for this decision");
  await reason.fill("These two observations describe the same user problem.");
  await history.getByRole("button", { name: "Save reason" }).click();

  await expect(history).toContainText("These two observations describe the same user problem.");
  await expect(page.getByTestId("status-message")).toContainText("Updated the structure decision reason");
});
