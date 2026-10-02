// One-off capture for a Claude Design review request covering the gaps
// identified in `02_Architecture/design/design-request-gaps-2026-07.md`:
// B-1 (work mode's 4 internal sections, provider=none and AI-enabled, plus
// the QA-MONKEY-11-adjacent empty-state screen), A-1 (agent export/import
// panels + an export text sample), and A-2/A-3/A-4 (start panel, search
// bar, view controls). Modeled on capture_design_conformance_20260709.mjs.
// Not part of the regular release screenshot set -- outputs to a scratch
// directory and is not wired into CI.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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
  path.resolve(repoRoot, "03_Implement", "backend", ".tmp", "design-review-20260711");

const ts = "2026-07-11T00:00:00.000Z";

function file(name) {
  return path.join(outputDir, name);
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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickButtonByText(page, fragments) {
  const match = page.locator("button").filter({
    hasText: new RegExp(fragments.map((fragment) => escapeRegExp(fragment)).join("|")),
  });
  await match.first().click();
}

// ---------------------------------------------------------------------------
// B-1 fixture: enough cards/islands/reading-order for narratives, merge
// candidates, and a layout suggestion to all have something to show.
// ---------------------------------------------------------------------------
function buildWorkModeDocument() {
  return {
    version: 1,
    id: "doc_phase1_canvas",
    title: "Work mode design review fixture",
    createdAt: ts,
    updatedAt: ts,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "利用者が最初に迷う導線", x: 100, y: 100, claimType: "claim", textReviewed: true },
      { id: "c2", text: "同じ迷いを示す別の観察", x: 380, y: 100, claimType: "claim", textReviewed: true },
      { id: "c3", text: "裏付けとなる根拠メモ", x: 660, y: 100, claimType: "fact", textReviewed: true },
      { id: "c4", text: "保留のまま置いている違和感", x: 100, y: 320, claimType: "unknown", textReviewed: false, holdState: "held" },
    ],
    edges: [],
    islands: [{ id: "i1", cardIds: ["c1", "c2"], title: "導線の迷い" }],
    readingOrder: ["c1", "c2", "c3", "c4"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

const mockMergeSuggestions = {
  suggestions: [
    {
      groupId: "group-nav-confusion",
      targetCardId: "c1",
      candidateCardIds: ["c2"],
      scoreSummary: { min: 0.88, max: 0.95, avg: 0.91 },
      reasonCodes: ["heuristic:normalized-text"],
      snapshotVersion: "CTR-2B-01-CANDIDATE-GROUP-V1",
      cardIds: ["c1", "c2"],
      mergedTextDraft: "利用者が最初に迷う導線（統合案）",
      rationale: "同じ迷いを指す2枚の重複",
    },
  ],
};

async function routeWorkModeFixture(page, providerKind) {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: '"work-mode-design-review"' },
      body: JSON.stringify(buildWorkModeDocument()),
    });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providerKind }) });
  });
  await page.route("**/ai/suggest-merges", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(mockMergeSuggestions) });
  });
  await page.route("**/ai/suggest-layout", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggestionId: "mock-suggestion-1",
        suggestedDoc: body.doc,
        notes: "近接する2枚を1つの島にまとめる案です。",
      }),
    });
  });
}

// REAL FINDING (design review, 2026-07-11): `[data-ui-region="work-mode"]`
// is a fixed full-screen overlay with its own `overflow: auto` (see
// WorkModePanel.tsx) rather than the page body scrolling. Playwright's
// built-in scrollIntoViewIfNeeded() did not reliably move this inner
// scroll container before a screenshot was taken (screenshots came back
// identical pre/post-scroll) -- scroll it explicitly via JS instead.
async function scrollWorkModeToElement(page, buttonNamePattern) {
  await page.locator('[data-ui-region="work-mode"]').evaluate((container, patternSource) => {
    const pattern = new RegExp(patternSource);
    const target = Array.from(container.querySelectorAll("button")).find((button) => pattern.test(button.textContent ?? ""));
    target?.scrollIntoView({ block: "center" });
  }, buttonNamePattern.source);
  await page.waitForTimeout(150);
}

async function openWorkModeAdvanced(page) {
  await page.goto(baseUrl);
  await clickButtonByText(page, ["サンプルを開く", "Open sample"]);
  await page.locator('[data-panel="start-document-entry"]').waitFor({ state: "hidden" });
  await clickButtonByText(page, ["詳細", "Advanced"]);
  await clickButtonByText(page, ["作業モード", "Work mode"]);
  await page.locator('[data-ui-region="work-mode"]').waitFor({ state: "visible" });
}

async function captureWorkMode(browser) {
  // --- provider=none: the 4 internal sections in their default state ---
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();
    await routeWorkModeFixture(page, "none");
    await openWorkModeAdvanced(page);

    await page.screenshot({ path: file("b1-01-worklmode-top-narratives-provider-none.png"), fullPage: false });

    // Scroll to the candidate-comparison section (merge + patch workspace),
    // still empty -- this is the state closest to the QA-MONKEY-11 finding
    // (domain_expr03_provider_local_e2e.mjs hit "No candidates collected
    // yet" intercepting the Suggest layout button's click target).
    await scrollWorkModeToElement(page, /Collect candidates|候補を収集/i);
    await page.screenshot({ path: file("b1-02-worklmode-candidate-comparison-empty.png"), fullPage: false });

    // Same viewport region, but zoomed via clip around the boundary between
    // the merge/patch empty state and the layout-suggestion section, since
    // that is exactly where the QA-MONKEY-11 script's click was intercepted.
    await scrollWorkModeToElement(page, /Suggest layout|配置を提案/);
    await page.screenshot({ path: file("b1-03-worklmode-boundary-collect-vs-suggest.png"), fullPage: false });

    await page.screenshot({ path: file("b1-04-worklmode-full-scroll-provider-none.png"), fullPage: true });
    await context.close();
  }

  // --- provider=local (AI-enabled): after collecting candidates + suggesting ---
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const page = await context.newPage();
    await routeWorkModeFixture(page, "local");
    await openWorkModeAdvanced(page);

    await page.getByRole("button", { name: /Collect candidates|候補を収集/i }).click();
    await page.getByText(/alpha|統合案|group-nav-confusion|利用者が最初に迷う導線（統合案）/).first().waitFor({ state: "visible" }).catch(() => {});
    await page.screenshot({ path: file("b1-05-worklmode-candidate-comparison-populated.png"), fullPage: false });

    // Capture the overlap itself before working around it with keyboard
    // activation below (see the finding note there).
    await scrollWorkModeToElement(page, /Suggest layout|配置を提案/);
    await page.screenshot({ path: file("b1-05b-worklmode-overlap-defect-after-collect.png"), fullPage: false });

    const suggestButton = page.getByRole("button", { name: /Suggest layout|配置を提案/ }).first();
    // REAL FINDING (design review, 2026-07-11): with candidates already
    // collected above, the AI-disclaimer hint text
    // ("AIによる確認は補助的な未レビュー結果です...") from a NEIGHBORING
    // section overlaps this button's clickable area and blocks a pointer
    // click -- the same class of overlap QA-MONKEY-11's provider-local
    // script hit. Use keyboard activation to capture the state regardless,
    // but keep this as a genuine layout defect to report, not just a script
    // workaround.
    await suggestButton.press("Enter");
    await page.getByText(/近接する2枚を1つの島にまとめる案です|proposal-only|自動で現在の文書へ反映されることはありません/).first().waitFor({ state: "visible" }).catch(() => {});
    await page.screenshot({ path: file("b1-06-worklmode-suggestion-panel-populated.png"), fullPage: false });

    await page.screenshot({ path: file("b1-07-worklmode-full-scroll-provider-local.png"), fullPage: true });
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// A-1: Agent export/import panels
// ---------------------------------------------------------------------------
function buildAgentDocument() {
  return {
    version: 1,
    id: "doc_agent_design_review_fixture",
    title: "Agent panel design review fixture",
    createdAt: ts,
    updatedAt: ts,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "reviewed card one", x: 0, y: 0, claimType: "claim", textReviewed: true },
      { id: "c2", text: "unreviewed draft card", x: 200, y: 0, claimType: "unknown", textReviewed: false },
    ],
    edges: [],
    islands: [{ id: "i1", cardIds: ["c1", "c2"], title: "Original Title" }],
    readingOrder: ["c1", "c2"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

function buildAgentResponseJson() {
  return JSON.stringify({
    schemaVersion: "agent-response.v1",
    taskId: "22222222-2222-2222-2222-222222222222",
    agent: "design-review-fixture-agent",
    proposals: [
      {
        proposalId: "clean-island-title",
        kind: "island_title",
        targetRef: { islandId: "i1" },
        content: { title: "Suggested Title" },
        rationale: "common theme across both cards",
      },
      {
        proposalId: "orphaned-island-title",
        kind: "island_title",
        targetRef: { islandId: "does-not-exist" },
        content: { title: "Unreachable" },
        rationale: "targets a nonexistent island",
      },
      {
        proposalId: "stale-patch",
        kind: "patch",
        targetRef: {},
        content: {},
        rationale: "cleanup from a stale baseline",
        patch: {
          kind: "sui-sensemaking-patch",
          version: 1,
          baseDocSignature: "doc_agent_design_review_fixture:2020-01-01T00:00:00.000Z",
          ops: [{ id: "op1", kind: "delete_card", cardId: "c2" }],
        },
      },
    ],
  });
}

async function routeAgentFixture(page) {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: '"agent-design-review"' },
      body: JSON.stringify(buildAgentDocument()),
    });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providerKind: "none" }) });
  });
  await page.route("**/export-audit", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "accepted" }) });
  });
  await page.route("**/ai/proposals/audit", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "accepted" }) });
  });
}

async function readDownloadText(download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Failed to open download stream");
  const chunks = [];
  await new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(chunks).toString("utf8");
}

async function captureAgentPanels(browser) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  await routeAgentFixture(page);
  await page.goto("http://" + host + ":" + port + "/?locale=en");
  await page.locator('[data-panel="start-document-entry"]').waitFor({ state: "visible" });
  await page.getByRole("button", { name: /Open sample|サンプルを開く/ }).click();
  await page.locator('[data-panel="start-document-entry"]').waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Advanced", exact: true }).click();

  // The scope-confirmed checkbox stays disabled with nothing selected
  // (AgentTaskExportPanel's hasSelection gate) -- select a card first.
  await page.getByRole("option", { name: /reviewed card one/ }).click();

  // --- Export panel: default (scope unconfirmed, download disabled) ---
  await page.getByRole("button", { name: "Export to agent" }).click();
  const exportPanel = page.locator('[data-ui-region="agent-task-export"]');
  await exportPanel.waitFor({ state: "visible" });
  await page.screenshot({ path: file("a1-01-agent-task-export-default.png"), fullPage: false });

  // --- Export panel: scope confirmed (download enabled) ---
  await page.getByTestId("agent-task-scope-confirmed").check();
  await page.screenshot({ path: file("a1-02-agent-task-export-scope-confirmed.png"), fullPage: false });

  // --- Export text sample ---
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download task sheet (.md)" }).click();
  const download = await downloadPromise;
  const taskSheetText = await readDownloadText(download);
  await writeFile(file("a1-03-agent-task-export-sample.md"), taskSheetText, "utf8");

  await page.keyboard.press("Escape");
  await exportPanel.waitFor({ state: "hidden" });

  // --- Import panel: default (paste input empty) ---
  await page.getByRole("button", { name: "Import agent response" }).click();
  const importPanel = page.locator('[data-ui-region="agent-response-import"]');
  await importPanel.waitFor({ state: "visible" });
  await page.screenshot({ path: file("a1-04-agent-response-import-default.png"), fullPage: false });

  // --- Import panel: after parsing (clean / orphaned / stale proposal states) ---
  await page.getByTestId("agent-response-paste-input").fill(buildAgentResponseJson());
  await page.getByTestId("agent-response-parse-button").click();
  await page.getByTestId("agent-response-proposal-clean-island-title").waitFor({ state: "visible" });
  await page.screenshot({ path: file("a1-05-agent-response-import-parsed.png"), fullPage: true });

  await context.close();
}

// ---------------------------------------------------------------------------
// A-2/A-3/A-4: StartPanel, SearchBar, ViewControlsPanel
// ---------------------------------------------------------------------------
function buildStartAreaDocument(cardTexts) {
  return {
    version: 1,
    id: "doc_phase1_canvas",
    title: "Start/search/view-controls design review fixture",
    createdAt: ts,
    updatedAt: ts,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: cardTexts.map((text, index) => ({
      id: `card-${index + 1}`,
      text,
      x: 120 + index * 260,
      y: 120 + (index % 2) * 150,
    })),
    edges: [],
    islands: [],
    readingOrder: cardTexts.map((_, index) => `card-${index + 1}`),
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

async function routeStartAreaFixture(page, shouldReturnSample) {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    const document = shouldReturnSample.value
      ? buildStartAreaDocument([
          "インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。",
          "結論は残っているのに、どの発言を根拠にしたのか後から分からなくなった。",
          "一人だけ違う意見だったので、そのまま議事録から落ちた。",
          "検索でこの一致を確認する",
        ])
      : buildStartAreaDocument([]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: shouldReturnSample.value ? '"start-area-loaded"' : '"start-area-empty"' },
      body: JSON.stringify(document),
    });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providerKind: "none" }) });
  });
}

async function captureStartSearchViewControls(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const shouldReturnSample = { value: false };
  await routeStartAreaFixture(page, shouldReturnSample);

  // --- A-2: StartPanel, current default state ---
  await page.goto(baseUrl);
  await page.locator('[data-panel="start-document-entry"]').waitFor({ state: "visible" });
  await page.screenshot({ path: file("a2-01-start-panel-default.png"), fullPage: false });
  await page.screenshot({ path: file("a2-02-start-panel-full.png"), fullPage: true });

  shouldReturnSample.value = true;
  await clickButtonByText(page, ["サンプルを開く", "Open sample"]);
  await page.locator('[data-panel="start-document-entry"]').waitFor({ state: "hidden" });

  // --- A-3: SearchBar, active search with a real match + non-matches hidden ---
  const searchInput = page.getByPlaceholder(/Search cards|カードを検索/);
  await searchInput.click();
  await searchInput.fill("検索でこの一致");
  await page.getByLabel(/Hide non-matches|非一致を非表示/).check();
  await page.screenshot({ path: file("a3-01-search-bar-active-match-hidden-others.png"), fullPage: false });

  await searchInput.fill("");
  await page.getByLabel(/Hide non-matches|非一致を非表示/).uncheck();

  // --- A-4: ViewControlsPanel opened ---
  await clickButtonByText(page, ["表示", "View"]);
  await page.locator('[data-panel="view-controls"]').waitFor({ state: "visible" }).catch(() => {});
  await page.screenshot({ path: file("a4-01-view-controls-panel.png"), fullPage: true });

  await context.close();
}

async function capture() {
  await mkdir(outputDir, { recursive: true });
  const server = await ensureViteServer();
  const browser = await chromium.launch();

  try {
    await captureWorkMode(browser);
    await captureAgentPanels(browser);
    await captureStartSearchViewControls(browser);

    console.log(JSON.stringify({ baseUrl, outputDir, reusedServer: server.reused }, null, 2));
  } finally {
    await browser.close();
    if (server.process) server.process.kill();
  }
}

capture().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
