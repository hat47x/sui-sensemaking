import { expect, test, type Page } from "@playwright/test";

// DATA-GENERATION-01: the DocumentTitleEditor displays the document title (or
// "無題" as a placeholder), switches to an inline edit input on click, and
// conditionally shows an AI suggest-title button based on the configured
// provider.

async function routeEssentials(page: Page, providerKind: string): Promise<void> {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ providerKind }),
    });
  });
  // The suggest button also needs at least one allowed model (AI-MODEL-GOVERNANCE-01).
  await page.route("**/ai/available-models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [{ id: "e2e-model", displayName: "E2E Model" }] }),
    });
  });
  // Accept any PUT (triggered by onTitleChange → applyDocumentChange) so the
  // test doesn't stall on an unhandled network request.
  await page.route("**/docs/*", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: '"title-editor-test"' },
      body: route.request().postData() ?? "{}",
    });
  });
}

test("displays the document title and enters edit mode on click", async ({ page }) => {
  await routeEssentials(page, "local");
  await page.goto("/?locale=en");

  // Create a new document so the title defaults to the untitled placeholder.
  await page.getByRole("button", { name: "Create new document" }).click();
  await expect(page.getByTestId("document-title-display")).toBeVisible();

  // Placeholder shown when no title is set (English, matching the ?locale=en
  // navigation above -- QA-MONKEY-19: this previously asserted the Japanese
  // "無題" string while the page was loaded under the English locale).
  await expect(page.getByTestId("document-title-display")).toHaveText("Untitled");

  // Click enters inline edit mode.
  await page.getByTestId("document-title-display").click();
  await expect(page.getByTestId("document-title-input")).toBeVisible();
  await expect(page.getByTestId("document-title-input")).toBeFocused();
});

test("shows the suggest-title button when a provider is configured", async ({ page }) => {
  await routeEssentials(page, "local");
  await page.goto("/?locale=en");

  await page.getByRole("button", { name: "Create new document" }).click();
  await expect(page.getByTestId("document-title-display")).toBeVisible();
  await expect(page.getByTestId("suggest-title-button")).toBeVisible();

  // Candidates panel and error banner are absent until the suggest action runs.
  await expect(page.getByTestId("title-candidates")).toHaveCount(0);
  await expect(page.getByTestId("title-suggest-error")).toHaveCount(0);
});

test("title candidates explain proposal-only adoption and preserve keyboard focus", async ({ page }) => {
  await routeEssentials(page, "deepseek");
  await page.route("**/ai/suggest-document-title", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ candidates: [
        { title: "Regional mobility for everyday life" },
        { title: "Reconnecting shopping and transport" },
      ] }),
    });
  });
  await page.goto("/?locale=en");
  await page.getByRole("button", { name: "Create new document" }).click();

  const title = page.getByTestId("document-title-display");
  await expect(page.getByRole("button", { name: "Edit title: Untitled" })).toBeVisible();
  await title.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("document-title-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(title).toBeFocused();

  const suggest = page.getByTestId("suggest-title-button");
  await suggest.click();
  const candidates = page.getByRole("region", { name: "AI title candidates" });
  await expect(candidates).toContainText("current title stays unchanged");
  await expect(title).toHaveText("Untitled");

  await page.getByRole("button", { name: "Adopt this candidate: Regional mobility for everyday life" }).click();
  await expect(title).toHaveText("Regional mobility for everyday life");
  await expect(title).toBeFocused();

  await suggest.click();
  await page.getByRole("button", { name: "Dismiss candidates" }).click();
  await expect(page.getByTestId("title-candidates")).toHaveCount(0);
  await expect(suggest).toBeFocused();
});

test("hides the suggest-title button when the provider is none", async ({ page }) => {
  await routeEssentials(page, "none");
  await page.goto("/?locale=en");

  await page.getByRole("button", { name: "Create new document" }).click();
  await expect(page.getByTestId("document-title-display")).toBeVisible();
  await expect(page.getByTestId("suggest-title-button")).toHaveCount(0);
});
