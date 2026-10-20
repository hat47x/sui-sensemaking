import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCUMENT_REPLACED_STATUS, openAdvancedWorkMode, selectWorkModeTab } from "./helpers/i18n";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const ce3SuggestionsFixture = JSON.parse(
  readFileSync(resolve(fixtureDir, "../tests/fixtures/e2e/ce3_mock_candidates.json"), "utf-8"),
) as { suggestions: unknown[] };

// The document itself is not persisted across a reload (only Advanced UI and
// query presets are), so scenarios that reload the page re-import it here.
async function loadDocument(page: Page, doc: unknown): Promise<void> {
  await page.getByRole("button", { name: /Share & Reproduce|共有と再現/ }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Load document\.json$|^document\.json を読み込む$/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "workspace-doc.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(doc), "utf-8"),
  });
  await page.getByRole("button", { name: /Replace current document|現在のドキュメントを置換/ }).click();
  await expect(page.getByText(DOCUMENT_REPLACED_STATUS)).toBeVisible();
}

test("CE3 patch workspace supports candidate comparison, preset replay, and rollback recovery", async ({ page }) => {
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    const now = new Date().toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        id: "doc_phase1_canvas",
        createdAt: now,
        updatedAt: now,
        transform: { panX: 0, panY: 0, zoom: 1 },
        cards: [],
        edges: [],
        islands: [],
      }),
    });
  });
  await page.route("**/ai/suggest-merges", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(ce3SuggestionsFixture),
    });
  });

  const now = new Date().toISOString();
  const doc = {
    version: 1,
    id: "doc_e2e_ce3_workspace",
    createdAt: now,
    updatedAt: now,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "alpha", x: 100, y: 100, textReviewed: true },
      { id: "c2", text: "Alpha", x: 130, y: 120, textReviewed: true },
      { id: "c3", text: "alpha ", x: 160, y: 140, textReviewed: true },
      { id: "c4", text: "beta", x: 500, y: 100, textReviewed: true },
      { id: "c5", text: "gamma", x: 560, y: 120, textReviewed: true },
      // MergeSuggestion requires at least two card ids. The fixture's beta and
      // gamma groups therefore pair each with one near-duplicate card.
      { id: "c6", text: "beta", x: 530, y: 160, textReviewed: true },
      { id: "c7", text: "gamma", x: 590, y: 180, textReviewed: true },
    ],
    edges: [],
    islands: [],
  };

  await page.goto("/");
  await loadDocument(page, doc);

  // Workspace IA: candidate collection moved into the Advanced-gated Work
  // mode panel (QA-MONKEY-11), then into the "Merge selection" tab once
  // UX-NAV-02 split the panel's stacked sections into exclusive tabs.
  await openAdvancedWorkMode(page);
  await selectWorkModeTab(page, "merge");
  await page.getByRole("button", { name: /Collect candidates|候補を収集/i }).click();

  const workspace = page.getByTestId("ce3-workspace-panel");
  await expect(workspace).toBeVisible();
  await expect(page.getByTestId("ce3-candidate-select")).toBeEnabled();
  await expect(page.getByTestId("ce3-candidate-count")).toContainText("(3)");
  await expect(page.getByTestId("ce3-diff-preview")).toContainText(/Review changes|変更内容の確認/);
  await expect(page.getByTestId("ce3-diff-preview")).toContainText(/Word changes:|語句の変更量:/);
  const optionLocator = page.locator('[data-testid="ce3-candidate-select"] option');
  await expect(optionLocator).toHaveCount(3);
  const alphaCandidateId = await optionLocator.nth(0).getAttribute("value");
  const betaCandidateId = await optionLocator.nth(1).getAttribute("value");
  const gammaCandidateId = await optionLocator.nth(2).getAttribute("value");
  expect(alphaCandidateId).not.toBeNull();
  expect(betaCandidateId).not.toBeNull();
  expect(gammaCandidateId).not.toBeNull();

  await page.getByTestId("ce3-adopt").click();
  await expect(page.getByTestId("ce3-decision-state")).toContainText(/adopt|採用/);
  await expect(page.getByTestId(`ce3-candidate-state-${alphaCandidateId}`)).toContainText(/adopt|採用/);

  await page.getByTestId("ce3-candidate-select").selectOption(betaCandidateId ?? "");
  await page.getByTestId("ce3-reject").click();
  await expect(page.getByTestId(`ce3-candidate-state-${betaCandidateId}`)).toContainText(/reject|破棄/);
  await expect(page.getByTestId(`ce3-candidate-state-${alphaCandidateId}`)).toContainText(/adopt|採用/);
  await expect(page.getByTestId(`ce3-candidate-state-${gammaCandidateId}`)).toContainText(/hold|保留/);
  await expect(page.getByTestId("ce3-audit-log-size")).toContainText("2");

  await page.getByTestId("ce3-rollback").click();
  await expect(page.getByTestId("ce3-decision-state")).toContainText(/hold|保留/);
  await expect(page.getByTestId(`ce3-candidate-state-${betaCandidateId}`)).toContainText(/hold|保留/);
  await expect(page.getByTestId(`ce3-candidate-state-${alphaCandidateId}`)).toContainText(/adopt|採用/);
  await expect(page.getByTestId(`ce3-candidate-audit-${betaCandidateId ?? ""}`)).toContainText(/rollback|ロールバック/);
  await expect(page.getByTestId(`ce3-candidate-audit-${alphaCandidateId ?? ""}`)).not.toContainText(/rollback|ロールバック/);
  await expect(page.getByTestId("ce3-audit-log-size")).toContainText("3");

  await page.getByTestId("ce3-preset-name").fill("Local CE3 Preset");
  await page.getByTestId("ce3-preset-scope").selectOption("selection");
  await page.getByTestId("ce3-preset-depth").fill("2");
  await page.getByTestId("ce3-preset-filters").fill(" risk, merge ");
  await page.getByTestId("ce3-save-preset").click();

  await page.getByRole("button", { name: /Run current conditions|現在の条件で実行/ }).click();
  // The normalized query is now rendered as a localized human-readable
  // summary (patch_workspace.executed_query_summary) instead of raw JSON.
  // Same invariants: scope=selection, depth=2, filters trimmed+sorted.
  await expect(page.getByTestId("ce3-normalized-query")).toContainText(/target selection|対象 選択範囲/);
  await expect(page.getByTestId("ce3-normalized-query")).toContainText(/depth 2|深さ 2/);
  await expect(page.getByTestId("ce3-normalized-query")).toContainText(/filters merge, risk|絞り込み merge, risk/);

  await page.getByRole("button", { name: /Run Local CE3 Preset|Local CE3 Preset を実行/ }).click();
  await expect(page.getByTestId("ce3-normalized-query")).toContainText(/target selection|対象 選択範囲/);
  await expect(page.getByTestId("ce3-failure")).toHaveCount(0);

  await page.reload();
  await loadDocument(page, doc);
  // Advanced UI persists in localStorage, but the Work mode panel itself
  // starts closed after a reload -- reopen it (and reselect the tab, since
  // it always resets to the first/"Diff" tab).
  await openAdvancedWorkMode(page);
  await selectWorkModeTab(page, "merge");
  await page.getByRole("button", { name: /Collect candidates|候補を収集/i }).click();
  await page.getByRole("button", { name: /Run Local CE3 Preset|Local CE3 Preset を実行/ }).click();
  await expect(page.getByTestId("ce3-normalized-query")).toContainText(/filters merge, risk|絞り込み merge, risk/);
});

test("unreviewed cards still collect deterministic local merge candidates without an AI call", async ({ page }) => {
  let aiRequested = false;
  await page.route("**/ai/suggest-merges", async (route) => {
    aiRequested = true;
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    const now = new Date().toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: 1,
        id: "doc_phase1_canvas",
        createdAt: now,
        updatedAt: now,
        transform: { panX: 0, panY: 0, zoom: 1 },
        cards: [],
        edges: [],
        islands: [],
      }),
    });
  });

  const now = new Date().toISOString();
  await page.goto("/");
  await loadDocument(page, {
    version: 1,
    id: "doc_e2e_unreviewed_merge_candidates",
    createdAt: now,
    updatedAt: now,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "Needs Follow-Up", x: 100, y: 100, textReviewed: false },
      { id: "c2", text: "needs follow up", x: 140, y: 120, textReviewed: false },
      { id: "c3", text: "unrelated observation", x: 400, y: 100, textReviewed: false },
    ],
    edges: [],
    islands: [],
  });

  await openAdvancedWorkMode(page);
  await selectWorkModeTab(page, "merge");
  await page.getByRole("button", { name: /Collect candidates|候補を収集/i }).click();

  await expect(page.getByTestId("ce3-candidate-select")).toBeEnabled();
  await expect(page.getByTestId("ce3-candidate-count")).toContainText("(1)");
  await expect(page.getByText(/without calling the AI|AIは呼び出さず/)).toBeVisible();
  expect(aiRequested).toBe(false);
});
