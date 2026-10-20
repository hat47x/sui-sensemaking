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

test("a recorded hold state can be restored manually from the structure history", async ({ page }) => {
  const enableSample = await routeSampleDocument(page);

  await page.goto("/?locale=en");
  await expect(page.locator(START_PANEL)).toBeVisible();
  enableSample();
  await page.getByRole("button", { name: "Open sample" }).click();

  await page.getByRole("button", { name: "first value user problem" }).click();

  const holdState = page.locator("#selected-card-hold-state");
  await holdState.selectOption("held");
  await holdState.selectOption("active");

  const history = page.getByTestId("structure-decision-history");
  await expect(history.locator("summary")).toContainText("Structure decisions (2)");
  await history.locator("summary").click();

  const heldRevision = history.locator("[data-structure-decision]").filter({ hasText: "→ held" }).first();
  await expect(heldRevision).toBeVisible();
  await heldRevision.getByRole("button", { name: "Restore this hold state" }).click();

  await expect(holdState).toHaveValue("held");
  await expect(page.getByTestId("status-message")).toContainText("Restored the hold state from history");
});
