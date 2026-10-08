import JSZip from "jszip";
import { expect, test, type Download, type Page } from "@playwright/test";
import {
  DOCUMENT_REPLACED_STATUS,
  EXPORT_BUNDLE_BUTTON,
  LOAD_DOCUMENT_BUTTON,
  REPLACE_DOCUMENT_BUTTON,
  SHARE_REPRODUCE_BUTTON,
  continueThroughPreShareGateIfPresent,
} from "./helpers/i18n";

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

async function exportDiagnosticsMd(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: EXPORT_BUNDLE_BUTTON }).click();
  await continueThroughPreShareGateIfPresent(page);
  const download = await downloadPromise;
  const zipBuffer = await readDownloadToBuffer(download);
  const zip = await JSZip.loadAsync(zipBuffer);
  const diagnosticsEntryName = Object.keys(zip.files).find((name) => name.endsWith("diagnostics.md"));
  expect(diagnosticsEntryName).toBeTruthy();
  const diagnosticsEntry = diagnosticsEntryName ? zip.file(diagnosticsEntryName) : null;
  expect(diagnosticsEntry).toBeTruthy();
  return diagnosticsEntry!.async("string");
}

test("bundle diagnostics includes structural metrics and remains deterministic across exports", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: SHARE_REPRODUCE_BUTTON }).click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: LOAD_DOCUMENT_BUTTON }).click();
  const fileChooser = await fileChooserPromise;

  const now = new Date().toISOString();
  const doc = {
    version: 1,
    id: "doc_e2e_diagnostics_metrics",
    createdAt: now,
    updatedAt: now,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "alpha", x: 100, y: 100 },
      { id: "c2", text: "beta", x: 200, y: 100 },
      { id: "c3", text: "gamma", x: 300, y: 100 },
      { id: "c4", text: "delta", x: 500, y: 100 },
    ],
    edges: [
      { id: "r1", fromId: "c1", toId: "c2", type: "related" },
      { id: "r2", fromId: "c2", toId: "c3", type: "related" },
    ],
    islands: [
      { id: "i1", cardIds: ["c1", "c2", "c3"], shape: { kind: "rect" } },
      { id: "i2", cardIds: ["c4"], shape: { kind: "rect" } },
    ],
  };

  await fileChooser.setFiles({
    name: "diagnostics-structural-metrics.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc), "utf-8"),
  });

  const replaceButton = page.getByRole("button", { name: REPLACE_DOCUMENT_BUTTON });
  await expect(replaceButton).toBeEnabled();
  await replaceButton.click();
  await expect(page.getByText(DOCUMENT_REPLACED_STATUS)).toBeVisible();

  const diagnosticsMdRun1 = await exportDiagnosticsMd(page);
  expect(diagnosticsMdRun1).toContain("| connectedComponentCount | 2 |");
  expect(diagnosticsMdRun1).toContain("| largestComponentRatio | 0.75 |");
  expect(diagnosticsMdRun1).toContain("| bridgeEdgeCount | 2 |");
  expect(diagnosticsMdRun1).toContain("| isolationRate | 0.25 |");
  // Anti-scoring (74462443): the connectivity score row is intentionally absent.
  expect(diagnosticsMdRun1).not.toContain("connectivityScore");
  expect(diagnosticsMdRun1).toContain("| degreeSkewRatio | 2 |");

  const diagnosticsMdRun2 = await exportDiagnosticsMd(page);
  expect(diagnosticsMdRun2).toBe(diagnosticsMdRun1);
});
