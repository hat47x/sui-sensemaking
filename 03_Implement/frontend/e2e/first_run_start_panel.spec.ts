import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  START_PANEL_IMPORT_PACK,
  START_PANEL_LOAD_DOCUMENT,
  START_PANEL_NEW_DOCUMENT,
  START_PANEL_SAMPLE,
  START_PANEL_TITLE,
} from "./helpers/i18n";

async function activeElementSummary(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (!active) {
      return "(none)";
    }

    const text = (active.textContent ?? "").replace(/\s+/g, " ").trim();
    const label = active.getAttribute("aria-label") ?? "";
    return `${active.tagName.toLowerCase()} ${label} ${text}`.trim();
  });
}

async function pressTabUntilFocused(page: Page, target: Locator, maxTabs = 50): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((node) => document.activeElement === node).catch(() => false)) {
      return;
    }
    await page.keyboard.press("Tab");
  }

  throw new Error(`Target was not reachable with Tab. Active element: ${await activeElementSummary(page)}`);
}

const viewports = [
  { width: 960, height: 720 },
  { width: 390, height: 720 },
] as const;

test("compact first-run panel leaves sample cards visible and expands on demand", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto("/?locale=ja");
  const panel = page.locator('[data-panel="start-document-entry"]');
  const toggle = panel.getByRole("button", { name: START_PANEL_TITLE });
  await expect(panel).toHaveAttribute("role", "region");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-card-id]')).toHaveCount(3);
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  await page.screenshot({ path: testInfo.outputPath("compact-start-panel.png") });
  for (const card of await page.locator('[data-card-id]').all()) {
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const overlaps = box!.x < panelBox!.x + panelBox!.width && box!.x + box!.width > panelBox!.x &&
      box!.y < panelBox!.y + panelBox!.height && box!.y + box!.height > panelBox!.y;
    expect(overlaps, JSON.stringify({ panel: panelBox, card: box })).toBe(false);
  }
  await toggle.click();
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAttribute("aria-modal", "true");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(panel).toHaveAttribute("role", "region");
  await expect(toggle).toBeFocused();
});

for (const viewport of viewports) {
  test(`first-run start panel exposes core document entry actions at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/?locale=ja");

    const panel = page.locator('[data-panel="start-document-entry"]');
    await expect(panel).toBeVisible();
    const compactBox = await panel.boundingBox();
    expect(compactBox!.width).toBeGreaterThan(300);
    expect(compactBox!.x + compactBox!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`compact-${viewport.width}.png`) });
    await panel.getByRole("button", { name: START_PANEL_TITLE }).click();
    await expect(panel).toHaveAccessibleName(START_PANEL_TITLE);
    await expect(panel.getByRole("button", { name: START_PANEL_NEW_DOCUMENT })).toBeVisible();
    await expect(panel.getByRole("button", { name: START_PANEL_SAMPLE })).toBeVisible();
    await expect(panel.getByRole("button", { name: START_PANEL_LOAD_DOCUMENT })).toBeVisible();
    await expect(panel.getByRole("button", { name: START_PANEL_IMPORT_PACK })).toBeVisible();
    await expect(panel.getByText(/^安全状態$|^Safety status$/)).toBeVisible();
    await expect(panel.getByText(/^セーフモード: ON$|^SafeMode: ON$/)).toBeVisible();

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(metrics.scrollWidth).toBe(metrics.viewportWidth);

    const newDocumentButton = panel.getByRole("button", { name: START_PANEL_NEW_DOCUMENT });
    await pressTabUntilFocused(page, newDocumentButton);
    await expect(newDocumentButton).toBeFocused();

    await panel.getByRole("button", { name: /閉じる|Close/ }).click();
    await expect(panel).toBeHidden();
  });
}
