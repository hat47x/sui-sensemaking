import { expect, test, type Download, type Page } from "@playwright/test";
import { SHARE_REPRODUCE_BUTTON } from "./helpers/i18n";

// EXT-AGENT-01 (ADR-0049 D2): AgentTaskPackage v1 export. Covers: the trigger
// stays behind "Advanced" disclosure (AC-5), export is blocked until the
// scope-confirmed checkbox is checked (AC-2 previewConfirmed-equivalent
// gate), unreviewed drafts are excluded by default (AC-3), the exported
// sheet has the fixed 5-section order + verbatim guardrail + correlation
// block (AC-1), and no score/rank/priority vocabulary ever appears (§4.2).

const FIXED_TIMESTAMP = "2026-07-09T00:00:00.000Z";

function buildFixtureDocument() {
  return {
    version: 1,
    id: "doc_agent_task_e2e_fixture",
    title: "Agent task e2e fixture",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "reviewed card one", x: 0, y: 0, claimType: "claim", textReviewed: true },
      { id: "c2", text: "unreviewed draft card", x: 200, y: 0, claimType: "unknown", textReviewed: false },
    ],
    edges: [],
    islands: [],
    readingOrder: ["c1", "c2"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

async function routeFixture(page: Page): Promise<void> {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: '"agent-task-e2e"' },
      body: JSON.stringify(buildFixtureDocument()),
    });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providerKind: "none" }) });
  });
  // export-audit is fail-open on the backend and not under test here; avoid
  // a real network call reaching a (likely absent) backend in this e2e run.
  await page.route("**/export-audit", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "accepted" }) });
  });
  // The task correlation must be registered before the sheet is released
  // (fail-closed in the app). Echo the taskId the client sent, as the backend
  // does; the response carries no body text (ExternalAgentTaskRegistrationResponse).
  await page.route("**/ai/external-tasks/register", async (route) => {
    const sent = JSON.parse(route.request().postData() ?? "{}") as { taskId?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ registered: true, taskId: sent.taskId, provenanceLevel: "user_presented_unsigned" }),
    });
  });
}

async function readDownloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Failed to open download stream");
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return Buffer.concat(chunks).toString("utf8");
}

test.beforeEach(async ({ page }) => {
  await routeFixture(page);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/?locale=en");
  const startPanel = page.locator('[data-panel="start-document-entry"]');
  await expect(startPanel).toBeVisible();
  await startPanel.getByRole("button", { name: /Open sample|サンプルを開く/ }).click();
  await expect(startPanel).toBeHidden();
});

test("trigger is absent until Advanced is enabled", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Export to agent" })).toHaveCount(0);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByRole("button", { name: "Export to agent" })).toBeVisible();
});

test("export is blocked until scope is confirmed, then downloads a task sheet with the fixed structure and correlation block", async ({
  page,
}) => {
  // A fresh document defaults to SafeMode ON (all card text redacted); turn
  // it off so this test can distinguish reviewed-vs-unreviewed exclusion
  // (AC-3) rather than SafeMode's own full-redaction behavior.
  await page.getByRole("button", { name: SHARE_REPRODUCE_BUTTON }).click();
  page.once("dialog", (dialog) => {
    void dialog.accept();
  });
  await page.getByRole("checkbox", { name: "Enable SafeMode" }).uncheck();
  await page.getByRole("button", { name: SHARE_REPRODUCE_BUTTON }).click();

  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.getByRole("button", { name: /reviewed card one/ }).click();
  await page.getByRole("button", { name: "Export to agent" }).click();

  const panel = page.locator('[data-ui-region="agent-task-export"]');
  await expect(panel).toBeVisible();

  const downloadButton = page.getByRole("button", { name: "Download task sheet (.md)" });
  await expect(downloadButton).toBeDisabled();

  await page.getByTestId("agent-task-scope-confirmed").check();
  await expect(downloadButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("task-sheet.md");

  const taskSheet = await readDownloadText(download);
  const sectionOrder = ["## 依頼", "## ガードレール", "## 文脈", "## 応答契約", "## 相関ブロック"].map((heading) =>
    taskSheet.indexOf(heading),
  );
  expect(sectionOrder.every((index) => index !== -1)).toBe(true);
  expect(sectionOrder).toEqual([...sectionOrder].sort((a, b) => a - b));
  expect(taskSheet).toContain("あなたの出力は提案であり確定しません");
  expect(taskSheet).toContain('"schemaVersion": "agent-task.v1"');
  expect(taskSheet).toContain('"docId": "doc_agent_task_e2e_fixture"');

  // AC-3: the unreviewed card's text is excluded by default.
  expect(taskSheet).not.toContain("unreviewed draft card");
  expect(taskSheet).toContain("reviewed card one");

  // §4.2 anti-scoring, outside the guardrail's own prohibition sentence.
  const withoutGuardrail = taskSheet.replace(/「あなたの出力は提案であり確定しません[^」]*」/, "");
  expect(withoutGuardrail).not.toMatch(/score|rank|confidence|priority|readiness/i);
});

test("Escape closes the panel and returns focus to the trigger", async ({ page }) => {
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Export to agent" });
  await trigger.click();

  const panel = page.locator('[data-ui-region="agent-task-export"]');
  await expect(panel).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
});
