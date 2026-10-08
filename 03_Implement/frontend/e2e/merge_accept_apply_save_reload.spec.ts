import { expect, test, type Locator, type Page } from "@playwright/test";
import { WORK_MODE_BUTTON, enableAdvancedUiIfNeeded } from "./helpers/i18n";

const START_PANEL = '[data-panel="start-document-entry"]';
const SAVE = '[data-ui-core-action="save"]';
const DOC_ID = "doc_phase1_canvas";
const GROUP_ID = "merge-e2e-1";

function initialDocument() {
  return {
    version: 1,
    id: DOC_ID,
    title: "Merge apply persistence",
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      {
        id: "c-source-1",
        text: "利用者の待ち時間が長いという観察",
        x: 80,
        y: 80,
        textReviewed: true,
        claimType: "fact",
        meta: { source: "interview://record-1" },
      },
      {
        id: "c-source-2",
        text: "利用者の待ち時間が長いという別の観察",
        x: 260,
        y: 80,
        textReviewed: true,
        claimType: "fact",
        meta: { source: "interview://record-2" },
      },
    ],
    edges: [],
    islands: [],
    readingOrder: [],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

function suggestionResponse() {
  return {
    suggestions: [
      {
        groupId: GROUP_ID,
        targetCardId: "c-source-1",
        candidateCardIds: ["c-source-2"],
        scoreSummary: { min: 0.9, max: 0.9, avg: 0.9 },
        reasonCodes: ["near_duplicate"],
        snapshotVersion: "CTR-2B-01-CANDIDATE-GROUP-V1",
        mergeMethod: "near_duplicate",
        cardIds: ["c-source-1", "c-source-2"],
        mergedTextDraft: "利用者の待ち時間が長いという観察が複数ある",
        rationale: "二つの観察は中心内容が近いが、元カードは保持して戻せるようにする。",
      },
    ],
  };
}

async function installRoutes(page: Page) {
  let persisted = initialDocument();
  let saveCount = 0;
  let getCount = 0;

  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route(`**/docs/${DOC_ID}`, async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      persisted = body;
      saveCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: `"merge-apply-${saveCount}"` },
        body: JSON.stringify(persisted),
      });
      return;
    }

    getCount += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: `"merge-load-${getCount}"` },
      body: JSON.stringify(persisted),
    });
  });
  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ providerKind: "none" }) });
  });
  await page.route("**/ai/available-models", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ models: [], unavailableReason: "no_active_models" }) });
  });
  await page.route("**/ai/suggest-merges", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(suggestionResponse()),
    });
  });

  return {
    persisted: () => persisted,
    saveCount: () => saveCount,
    getCount: () => getCount,
  };
}

async function openSample(page: Page): Promise<void> {
  const startPanel = page.locator(START_PANEL);
  await expect(startPanel).toBeVisible();
  await startPanel.getByRole("button", { name: /Open sample|サンプルを開く/ }).click();
  await expect(startPanel).toBeHidden();
}

async function openMergePanel(page: Page): Promise<Locator> {
  await enableAdvancedUiIfNeeded(page);
  await page.getByRole("button", { name: WORK_MODE_BUTTON }).click();
  const workMode = page.locator('[data-ui-region="work-mode"]');
  await expect(workMode).toBeVisible();
  await page.getByRole("tab", { name: "Merge selection" }).click();
  const panel = page.getByRole("tabpanel", { name: "Merge selection" });
  await expect(panel).toBeVisible();
  return panel;
}

test("recorded merge accept can be explicitly applied, saved, and restored with its source lineage", async ({ page }) => {
  const routes = await installRoutes(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?locale=en");
  await openSample(page);

  let panel = await openMergePanel(page);
  await panel.getByRole("button", { name: /Collect.*candidate/i }).click();

  let suggestion = panel.locator("article").filter({ hasText: "c-source-1" });
  await expect(suggestion).toBeVisible();
  const textareas = suggestion.locator("textarea");
  await expect(textareas).toHaveCount(2);
  await textareas.nth(1).fill("二つの観察の差分を残しつつ、同じ中心内容として統合する");
  await suggestion.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(suggestion).toContainText("Accepted");

  const applyButton = suggestion.getByRole("button", { name: "Apply accepted merge" });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(suggestion.getByRole("button", { name: "Merge applied" })).toBeDisabled();

  // Save is a core action outside the modal Work mode surface. Close Work mode
  // with the dialog's actual Close control before exercising the real save flow.
  const workMode = page.locator('[data-ui-region="work-mode"]');
  await workMode.getByRole("button", { name: /Close|閉じる/ }).click();
  await expect(workMode).toBeHidden();

  const saveButton = page.locator(SAVE);
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByTestId("status-message")).toContainText("Saved");
  await expect.poll(() => routes.saveCount()).toBe(1);

  const saved = routes.persisted() as {
    cards: Array<{
      id: string;
      text: string;
      textReviewed?: boolean;
      repOf?: string[];
      sources?: string[];
      canonicalId?: string;
      meta?: { source?: string };
    }>;
    mergeSuggestionDecisions: Array<{
      groupId: string;
      action?: string;
      decision: string;
      representativeCardId?: string;
      sourceCardIds?: string[];
    }>;
  };

  const savedById = Object.fromEntries(saved.cards.map((card) => [card.id, card]));
  expect(savedById["c-source-1"]?.meta?.source).toBe("interview://record-1");
  expect(savedById["c-source-2"]?.meta?.source).toBe("interview://record-2");
  expect(saved.cards.filter((card) => card.id === "c-source-1" || card.id === "c-source-2")).toHaveLength(2);

  const representative = saved.cards.find(
    (card) => card.id !== "c-source-1" && card.id !== "c-source-2" && card.sources?.includes("c-source-1"),
  );
  expect(representative).toBeTruthy();
  expect(representative?.sources?.slice().sort()).toEqual(["c-source-1", "c-source-2"]);
  expect(representative?.repOf?.slice().sort()).toEqual(["c-source-1", "c-source-2"]);
  expect(representative?.textReviewed).toBe(false);

  const source1 = savedById["c-source-1"];
  const source2 = savedById["c-source-2"];
  expect(source1?.canonicalId).toBe(representative?.id);
  expect(source2?.canonicalId).toBe(representative?.id);

  const decision = saved.mergeSuggestionDecisions.find((entry) => entry.groupId === GROUP_ID);
  expect(decision?.action ?? decision?.decision).toBe("accept");
  expect(decision?.representativeCardId).toBe(representative?.id);
  expect(decision?.sourceCardIds?.slice().sort()).toEqual(["c-source-1", "c-source-2"]);

  // Reload the application. The route now returns exactly the document that
  // went through the real PUT above, so this crosses the actual client
  // save/load boundary rather than only JSON round-tripping a domain object.
  await page.reload();
  await openSample(page);
  await expect.poll(() => routes.getCount()).toBeGreaterThanOrEqual(2);

  // The newly created representative is intentionally unreviewed, so SafeMode
  // correctly blocks a new AI merge-suggestion request at this point. Persistence
  // is therefore verified through the actual GET/render boundary below, not by
  // recreating an ephemeral suggestion preview after reload.
  const representativeCard = page.locator(`[data-card-id="${representative?.id ?? "missing-representative"}"]`);
  await expect(representativeCard).toBeVisible();
  await expect(representativeCard).toContainText("利用者の待ち時間が長いという観察が複数ある");
});
