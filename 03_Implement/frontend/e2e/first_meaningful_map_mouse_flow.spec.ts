import { expect, test, type Page } from "@playwright/test";
import { buildFirstMeaningfulMapDocument } from "./helpers/product_value_fixtures";

const START_PANEL = '[data-panel="start-document-entry"]';

async function routeFirstValueFixture(
  page: Page,
): Promise<{ enableSample: () => void; savedIslandTitles: () => Array<string | undefined> | null }> {
  let shouldReturnSample = false;
  let savedIslandTitles: Array<string | undefined> | null = null;

  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await page.route("**/docs/*", async (route) => {
    if (route.request().method() === "PUT") {
      const savedDocument = route.request().postDataJSON() as {
        islands?: Array<{ title?: string }>;
      };
      savedIslandTitles = savedDocument.islands?.map((island) => island.title) ?? [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: '"first-value-sample-saved"' },
        body: JSON.stringify(savedDocument),
      });
      return;
    }

    const document = shouldReturnSample
      ? buildFirstMeaningfulMapDocument()
      : buildFirstMeaningfulMapDocument([]);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: shouldReturnSample ? '"first-value-sample-loaded"' : '"first-value-sample-empty"' },
      body: JSON.stringify(document),
    });
  });

  return {
    enableSample: () => {
      shouldReturnSample = true;
    },
    savedIslandTitles: () => savedIslandTitles,
  };
}

test("mouse first-value flow creates a visible first island from the sample", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await routeFirstValueFixture(page);

  await page.goto("/?locale=ja");
  await expect(page.locator(START_PANEL)).toBeVisible();

  fixture.enableSample();
  await page.getByRole("button", { name: /サンプルを開く|Open sample/ }).click();
  await expect(page.locator(START_PANEL)).toBeHidden();

  const firstCard = page.getByRole("button", { name: "first value user problem" });
  const secondCard = page.getByRole("button", { name: "first value observation memo" });
  await expect(firstCard).toBeVisible();
  await expect(secondCard).toBeVisible();

  await firstCard.click();
  await expect(firstCard).toHaveAttribute("aria-pressed", "true");
  await secondCard.click({ modifiers: ["Shift"] });
  await expect(firstCard).toHaveAttribute("aria-pressed", "true");
  await expect(secondCard).toHaveAttribute("aria-pressed", "true");

  // UX-SCALE-01 (b): the bulk-operations bar also has a same-labeled
  // "Create Island" button while 2+ cards are selected, so scope to the
  // header's always-visible slim-toolbar button specifically.
  const createIslandButton = page.getByRole("banner").getByRole("button", { name: /島を作成|Create Island/ });
  await expect(createIslandButton).toBeEnabled();
  await createIslandButton.click();
  await expect(page.getByTestId("status-message")).toContainText("選択したカード 2 件から島を作成しました");

  const islandSelect = page.getByRole("button", { name: /島 .* を選択|Select island/ });
  await expect(islandSelect).toBeVisible();

  const selectionPanel = page.locator('[data-ui-region="selection-context"]');
  await expect(selectionPanel).toBeVisible();
  await expect(selectionPanel).toContainText(/島を選択中|Island selected/);
  await expect(selectionPanel).toContainText("島 1");
  await expect(selectionPanel).not.toContainText("Island 1");
  await expect(selectionPanel).toContainText("first value user problem");
  await expect(selectionPanel).toContainText("first value observation memo");

  // The document title button also carries a "Title" aria-label, so address the island field by id.
  const islandTitleInput = page.locator("#selected-island-title");
  await expect(islandTitleInput).toHaveValue("");

  await expect(selectionPanel).not.toContainText(/選択: 2 件のカードを選択中|Selection: 2 cards selected/);

  await page.keyboard.press("Control+Z");
  await expect(page.getByTestId("status-message")).toContainText("操作を元に戻しました");
  await page.keyboard.press("Control+Y");
  await expect(page.getByTestId("status-message")).toContainText("操作をやり直しました");
  await expect(islandSelect).toBeVisible();

  await page.locator('[data-ui-core-action="save"]').click();
  await expect.poll(() => fixture.savedIslandTitles()).toEqual([""]);
});

test("the same untitled island document keeps the English numbered fallback", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await routeFirstValueFixture(page);

  await page.goto("/?locale=en");
  fixture.enableSample();
  await page.getByRole("button", { name: "Open sample" }).click();

  const firstCard = page.getByRole("button", { name: "first value user problem" });
  const secondCard = page.getByRole("button", { name: "first value observation memo" });
  await firstCard.click();
  await secondCard.click({ modifiers: ["Shift"] });
  await page.getByRole("banner").getByRole("button", { name: "Create Island" }).click();

  const selectionPanel = page.locator('[data-ui-region="selection-context"]');
  await expect(selectionPanel).toContainText("Island 1");
  await expect(page.locator("#selected-island-title")).toHaveValue("");
});
