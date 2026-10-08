import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";
import {
  EXPORT_BUNDLE_BUTTON,
  HIDE_NON_MATCHES_CHECKBOX,
  LOAD_DOCUMENT_BUTTON,
  REPLACE_DOCUMENT_BUTTON,
  SEARCH_CARDS_PLACEHOLDER,
  SHARE_REPRODUCE_BUTTON,
  VIEW_BUTTON,
  closeSharePanelIfOpen,
  continueThroughPreShareGateIfPresent,
} from "./helpers/i18n";

type Box = {
  bottom: number;
  right: number;
};

async function readDownloadToBuffer(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) {
    throw new Error("Failed to open download stream");
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });

  return Buffer.concat(chunks);
}

function buildLargeDocument() {
  const now = "2026-05-22T00:00:00.000Z";
  const cards = Array.from({ length: 120 }, (_, index) => {
    const row = Math.floor(index / 12);
    const col = index % 12;
    return {
      id: `card-${index + 1}`,
      text: index === 86 ? "rare-signal-87 decision review anchor" : `large fixture insight ${index + 1}`,
      x: 120 + col * 170,
      y: 120 + row * 120,
    };
  });
  const islands = Array.from({ length: 12 }, (_, index) => {
    const firstCardIndex = index * 10;
    return {
      id: `island-${index + 1}`,
      title: `large fixture cluster ${index + 1}`,
      cardIds: cards.slice(firstCardIndex, firstCardIndex + 10).map((card) => card.id),
      shape: { kind: "rect" as const },
    };
  });
  const edges = Array.from({ length: 119 }, (_, index) => ({
    id: `edge-${index + 1}`,
    fromId: `card-${index + 1}`,
    toId: `card-${index + 2}`,
    type: "related",
  }));

  return {
    version: 1,
    id: "doc_e2e_large_operability",
    title: "large document operability fixture",
    createdAt: now,
    updatedAt: now,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards,
    edges,
    islands,
  };
}

async function collectFixedPanels(page: Page): Promise<Box[]> {
  return page.locator("body *").evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
          position: style.position,
        };
      })
      .filter((entry) => entry.position === "fixed" && entry.width > 0 && entry.height > 0)
  );
}

test("large document keeps search, panel fit, and export operable", async ({ page }) => {
  const viewport = { width: 768, height: 720 };
  await page.setViewportSize(viewport);
  await page.goto("/?locale=en");
  await page.getByRole("button", { name: SHARE_REPRODUCE_BUTTON }).click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: LOAD_DOCUMENT_BUTTON }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "large-operability.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(buildLargeDocument()), "utf-8"),
  });

  await page.getByRole("button", { name: REPLACE_DOCUMENT_BUTTON }).click();
  await expect(page.getByText("Replaced the current document")).toBeVisible();
  await closeSharePanelIfOpen(page);

  const searchInput = page.getByPlaceholder(SEARCH_CARDS_PLACEHOLDER);
  await searchInput.fill("rare-signal-87");
  await expect(page.getByText("1/1")).toBeVisible();
  await page.getByRole("checkbox", { name: HIDE_NON_MATCHES_CHECKBOX }).check();
  await expect(page.getByText("rare-signal-87 decision review anchor")).toBeVisible();

  await page.getByRole("button", { name: VIEW_BUTTON }).click();
  const viewPanels = await collectFixedPanels(page);
  expect(viewPanels.length).toBeGreaterThan(0);
  expect(viewPanels.some((panel) => panel.bottom > viewport.height || panel.right > viewport.width)).toBe(false);
  await page.getByRole("button", { name: VIEW_BUTTON }).click();

  await page.getByRole("button", { name: SHARE_REPRODUCE_BUTTON }).click();
  const sharePanels = await collectFixedPanels(page);
  expect(sharePanels.length).toBeGreaterThan(0);
  expect(sharePanels.some((panel) => panel.bottom > viewport.height || panel.right > viewport.width)).toBe(false);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: EXPORT_BUNDLE_BUTTON }).click();
  await continueThroughPreShareGateIfPresent(page);
  const zipBuffer = await readDownloadToBuffer(await downloadPromise);
  const zip = await JSZip.loadAsync(zipBuffer);
  const diagnosticsEntryName = Object.keys(zip.files).find((name) => name.endsWith("diagnostics.md"));
  expect(diagnosticsEntryName).toBeTruthy();
  const diagnosticsText = await zip.file(diagnosticsEntryName!)!.async("string");
  // Anti-scoring (74462443): the metrics table is rendered, and it carries no score row.
  expect(diagnosticsText).toContain("## Metrics");
  expect(diagnosticsText).not.toContain("connectivityScore");
});
