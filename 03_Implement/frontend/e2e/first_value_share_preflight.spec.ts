import { expect, test, type Page } from "@playwright/test";
import { buildFirstMeaningfulMapDocument } from "./helpers/product_value_fixtures";

const START_PANEL = '[data-panel="start-document-entry"]';

async function routeFirstValueFixture(page: Page): Promise<{ enableSample: () => void }> {
  let shouldReturnSample = false;

  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: shouldReturnSample ? '"first-value-preflight-loaded"' : '"first-value-preflight-empty"' },
      body: JSON.stringify(
        shouldReturnSample ? buildFirstMeaningfulMapDocument() : buildFirstMeaningfulMapDocument([]),
      ),
    });
  });

  return {
    enableSample: () => {
      shouldReturnSample = true;
    },
  };
}

test("first-value journey keeps SafeMode visible from entry through share preflight", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await routeFirstValueFixture(page);

  await page.goto("/?locale=en");
  const startPanel = page.locator(START_PANEL);
  await expect(startPanel).toBeVisible();
  await expect(startPanel).toContainText("SafeMode: ON");

  fixture.enableSample();
  await page.getByRole("button", { name: "Open sample" }).click();
  const firstCard = page.getByRole("button", { name: "first value user problem" });
  const secondCard = page.getByRole("button", { name: "first value observation memo" });
  await firstCard.click();
  await secondCard.click({ modifiers: ["Shift"] });
  // UX-SCALE-01 (b): the bulk-operations bar also has a same-labeled
  // "Create Island" button while 2+ cards are selected, so scope to the
  // header's always-visible slim-toolbar button specifically.
  await page.getByRole("banner").getByRole("button", { name: "Create Island" }).click();

  await page.getByRole("button", { name: "Share & Reproduce" }).click();
  const summary = page.getByTestId("share-domain-expression-summary");
  await expect(page.getByText("SafeMode is ON, so unreviewed drafts are excluded.")).toBeVisible();
  await expect(page.getByText("5 review signals remain")).toBeVisible();
  await expect(summary).toContainText("Unreviewed: cards 2, islands 0");
  await expect(summary).toContainText("Hold / unknown claims: 3");
  await expect(summary).toContainText("Critique or pending feedback targets: 0");
  await expect(summary).toContainText("Evidence links 0, contradictions 0, evidence gaps 0");
  await expect(page.getByLabel("Include unreviewed drafts")).toHaveCount(0);
});
