import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendDir, "..", "..");

const host = process.env.SUI_SCREENSHOT_HOST ?? "127.0.0.1";
const port = Number(process.env.SUI_SCREENSHOT_PORT ?? "4173");
const baseUrl = process.env.SUI_SCREENSHOT_BASE_URL ?? `http://${host}:${port}/?locale=ja`;
const outputDir =
  process.env.SUI_SCREENSHOT_OUTPUT_DIR ??
  path.resolve(repoRoot, "04_Documentation", "assets", "screenshots");

const files = {
  overview: path.join(outputDir, "app-canvas-overview.png"),
  selection: path.join(outputDir, "selection-context-card.png"),
  share: path.join(outputDir, "share-export-safe-mode.png"),
  start: path.join(outputDir, "start-document-entry.png"),
  mobile: path.join(outputDir, "mobile-toolbar-smoke-390.png"),
};

function buildDocument(cardTexts) {
  return {
    version: 1,
    id: "doc_phase1_canvas",
    title: "Release screenshot sample",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: cardTexts.map((text, index) => ({
      id: `sample-card-${index + 1}`,
      text,
      x: 120 + index * 260,
      y: 120 + (index % 2) * 150,
    })),
    edges: [
      { id: "edge-1", from: "sample-card-1", to: "sample-card-2", kind: "relates" },
      { id: "edge-2", from: "sample-card-2", to: "sample-card-3", kind: "relates" },
    ],
    islands: [
      {
        id: "island-1",
        title: "導入時に確認すること",
        cardIds: ["sample-card-1", "sample-card-2"],
        shape: { kind: "rect", x: 80, y: 80, width: 620, height: 260 },
      },
    ],
    readingOrder: ["sample-card-1", "sample-card-2", "sample-card-3"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

function fetchStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve(0));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(0);
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fetchStatus(url)) === 200) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function ensureViteServer() {
  const url = `http://${host}:${port}/`;
  if ((await fetchStatus(url)) === 200) return { process: null, reused: true };

  const viteBin = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin, "--host", host, "--port", String(port)], {
    cwd: frontendDir,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  if (!(await waitForServer(url, 30_000))) {
    child.kill();
    throw new Error(`Vite did not become ready at ${url}\n${stderr}`);
  }

  return { process: child, reused: false };
}

async function clickButtonByText(page, fragments) {
  const match = page.locator("button").filter({
    hasText: new RegExp(fragments.map((fragment) => escapeRegExp(fragment)).join("|")),
  });
  const count = await match.count();
  if (count !== 1) {
    throw new Error(`Expected one button for ${fragments.join(" / ")}, found ${count}`);
  }
  await match.click();
}

async function captureScreenshot(page, file) {
  await page
    .locator('[data-testid="status-message"]')
    .evaluate((element) => {
      element.style.display = "none";
    })
    .catch(() => {});
  await page.screenshot({ path: file, fullPage: false });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function routeDeterministicData(page, shouldReturnSample) {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    const document = shouldReturnSample.value
      ? buildDocument([
          "インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。",
          "結論は残っているのに、どの発言を根拠にしたのか後から分からなくなった。",
          "一人だけ違う意見だったので、そのまま議事録から落ちた。",
        ])
      : buildDocument([]);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: shouldReturnSample.value ? '"release-sample-loaded"' : '"release-sample-empty"' },
      body: JSON.stringify(document),
    });
  });
}

async function capture() {
  await mkdir(outputDir, { recursive: true });
  const server = await ensureViteServer();
  const browser = await chromium.launch({
    executablePath: process.env.SUI_SCREENSHOT_BROWSER_PATH || undefined,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const shouldReturnSample = { value: false };
    await routeDeterministicData(page, shouldReturnSample);

    await page.goto(baseUrl);
    await page.locator('[data-panel="start-document-entry"]').waitFor({ state: "visible" });
    await captureScreenshot(page, files.start);

    await page.setViewportSize({ width: 390, height: 720 });
    shouldReturnSample.value = true;
    await clickButtonByText(page, ["サンプルを開く", "Open sample"]);
    await page.locator('[data-panel="start-document-entry"]').waitFor({ state: "hidden" });
    await captureScreenshot(page, files.mobile);

    await page.setViewportSize({ width: 1440, height: 900 });
    await captureScreenshot(page, files.overview);

    await page.getByRole("button", { name: /インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。/ }).click();
    await page.locator('[data-panel="selection-context"]').waitFor({ state: "visible" });
    await captureScreenshot(page, files.selection);

    await clickButtonByText(page, ["共有と再現", "Share and reproduce"]);
    await page.locator('[data-panel="share-replay"]').waitFor({ state: "visible" });
    await captureScreenshot(page, files.share);

    console.log(
      JSON.stringify(
        {
          baseUrl,
          outputDir,
          screenshots: Object.fromEntries(Object.entries(files).map(([name, file]) => [name, path.relative(repoRoot, file)])),
          reusedServer: server.reused,
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
    if (server.process) server.process.kill();
  }
}

capture().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
