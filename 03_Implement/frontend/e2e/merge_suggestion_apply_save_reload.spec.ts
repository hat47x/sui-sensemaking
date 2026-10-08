import { expect, test, type Page } from "@playwright/test";

const START_PANEL = '[data-panel="start-document-entry"]';
const SAVE = '[data-ui-core-action="save"]';
const WORK_MODE = '[data-ui-core-action="work-mode"]';
const MERGE_TAB = '#work-mode-tab-merge';
const MERGE_PANEL = '#work-mode-panel-merge';
const CANDIDATE_GROUP_CONTRACT = "CTR-2B-01-CANDIDATE-GROUP-V1";

function seedDocument(): Record<string, unknown> {
  return {
    version: 1,
    id: "doc_phase1_canvas",
    title: "Merge apply persistence E2E",
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      {
        id: "source-a",
        text: "Customers wait too long at checkout.",
        x: 120,
        y: 120,
        textReviewed: true,
        claimType: "fact",
        meta: { source: "interview-001" },
      },
      {
        id: "source-b",
        text: "Checkout delays frustrate customers.",
        x: 380,
        y: 120,
        textReviewed: true,
        claimType: "fact",
        meta: { source: "interview-002" },
      },
    ],
    edges: [],
    islands: [
      {
        id: "checkout-observations",
        cardIds: ["source-a", "source-b"],
        title: "Checkout observations",
        titleReviewed: true,
      },
    ],
    readingOrder: ["checkout-observations"],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

async function routeMergePersistence(page: Page): Promise<{
  savedDocument: () => Record<string, any> | null;
  getCount: () => number;
}> {
  let persistedDocument: Record<string, any> = seedDocument();
  let savedDocument: Record<string, any> | null = null;
  let getCount = 0;
  let etagVersion = 1;

  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  await page.route("**/ai/provider-status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ providerKind: "local", callCounts: {}, tokenUsage: {} }),
    });
  });

  await page.route("**/ai/available-models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    });
  });

  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      getCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: `"merge-apply-${etagVersion}"` },
        body: JSON.stringify(persistedDocument),
      });
      return;
    }

    if (method === "PUT") {
      const body = route.request().postData();
      if (!body) {
        await route.fulfill({ status: 400, contentType: "application/json", body: '{"detail":"missing body"}' });
        return;
      }
      persistedDocument = JSON.parse(body) as Record<string, any>;
      savedDocument = persistedDocument;
      etagVersion += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { ETag: `"merge-apply-${etagVersion}"` },
        body: JSON.stringify(persistedDocument),
      });
      return;
    }

    await route.fallback();
  });

  await page.route("**/ai/suggest-merges", async (route) => {
    expect(route.request().method()).toBe("POST");
    const requestBody = route.request().postDataJSON() as { doc?: { id?: string } };
    expect(requestBody.doc?.id).toBe("doc_phase1_canvas");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [
          {
            groupId: "merge-checkout",
            targetCardId: "source-a",
            candidateCardIds: ["source-b"],
            scoreSummary: { min: 0.92, max: 0.92, avg: 0.92 },
            reasonCodes: ["semantic_similarity"],
            snapshotVersion: CANDIDATE_GROUP_CONTRACT,
            mergeMethod: "near_duplicate",
            cardIds: ["source-a", "source-b"],
            mergedTextDraft: "Long checkout waits frustrate customers.",
            rationale: "Both observations describe the same checkout-delay experience.",
          },
        ],
      }),
    });
  });

  return {
    savedDocument: () => savedDocument,
    getCount: () => getCount,
  };
}

async function openMergePanel(page: Page): Promise<void> {
  const advancedButton = page.getByRole("button", { name: "Advanced" });
  if ((await advancedButton.getAttribute("aria-pressed")) !== "true") {
    await advancedButton.click();
  }

  await page.locator(WORK_MODE).click();
  await page.locator(MERGE_TAB).click();
  await expect(page.locator(MERGE_PANEL)).toBeVisible();
}

test("recorded accept is explicitly applied, saved, and restored through the UI/API path", async ({ page }) => {
  const routed = await routeMergePersistence(page);

  await page.goto("/?locale=en");
  await expect(page.locator(START_PANEL)).toBeVisible();
  await page.getByRole("button", { name: "Open sample" }).click();
  await expect(page.locator(START_PANEL)).toBeHidden();
  await expect(page.getByRole("button", { name: "Customers wait too long at checkout." })).toBeVisible();
  expect(routed.getCount()).toBeGreaterThanOrEqual(1);

  await openMergePanel(page);
  const mergePanel = page.locator(MERGE_PANEL);
  await mergePanel.getByRole("button", { name: "Collect candidates" }).click();
  await expect(mergePanel).toContainText("source-a");
  await expect(mergePanel).toContainText("source-b");
  await expect(mergePanel.getByRole("button", { name: "Accept", exact: true })).toBeDisabled();

  await mergePanel
    .getByPlaceholder("Record why you accept/partial/reject/defer this proposal")
    .fill("The two observations retain the same actor, situation, and factual position.");
  await expect(mergePanel.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
  await mergePanel.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(mergePanel).toContainText("Accepted");

  const applyButton = mergePanel.getByRole("button", { name: "Apply accepted merge" });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(mergePanel.getByRole("button", { name: "Merge applied" })).toBeDisabled();

  // Save is a core action outside the modal Work mode surface, as in the accept
  // spec: close Work mode with its Close control before the real save flow.
  const workMode = page.locator('[data-ui-region="work-mode"]');
  await workMode.getByRole("button", { name: /Close|閉じる/ }).click();
  await expect(workMode).toBeHidden();

  const saveButton = page.locator(SAVE);
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByTestId("status-message")).toContainText("Saved");
  await expect.poll(() => routed.savedDocument()).not.toBeNull();

  const saved = routed.savedDocument()!;
  const sourceA = saved.cards.find((card: any) => card.id === "source-a");
  const sourceB = saved.cards.find((card: any) => card.id === "source-b");
  expect(sourceA?.text).toBe("Customers wait too long at checkout.");
  expect(sourceA?.meta?.source).toBe("interview-001");
  expect(sourceB?.text).toBe("Checkout delays frustrate customers.");
  expect(sourceB?.meta?.source).toBe("interview-002");

  const representative = saved.cards.find(
    (card: any) => Array.isArray(card.repOf) && card.repOf.includes("source-a") && card.repOf.includes("source-b"),
  );
  expect(representative).toBeTruthy();
  expect(representative.text).toBe("Long checkout waits frustrate customers.");
  expect(representative.textReviewed).toBe(false);
  expect([...representative.repOf].sort()).toEqual(["source-a", "source-b"]);
  expect([...representative.sources].sort()).toEqual(["source-a", "source-b"]);

  const acceptedDecision = saved.mergeSuggestionDecisions.find(
    (decision: any) => decision.groupId === "merge-checkout" && (decision.action ?? decision.decision) === "accept",
  );
  expect(acceptedDecision).toBeTruthy();
  expect(acceptedDecision.representativeCardId).toBe(representative.id);
  expect([...acceptedDecision.sourceCardIds].sort()).toEqual(["source-a", "source-b"]);
  expect(acceptedDecision.missingSourceCardIds ?? []).toEqual([]);

  const getsBeforeReload = routed.getCount();
  await page.reload();
  const startPanel = page.locator(START_PANEL);
  if (await startPanel.isVisible()) {
    await page.getByRole("button", { name: "Open sample" }).click();
    await expect(startPanel).toBeHidden();
  }
  await expect.poll(() => routed.getCount()).toBeGreaterThan(getsBeforeReload);
  await expect(page.getByRole("button", { name: "Long checkout waits frustrate customers." })).toBeVisible();
  // The source cards stay in the saved document (asserted above). With the default
  // hideSourceCards view they are folded behind their representative on the canvas.
  await expect(page.getByRole("button", { name: "Customers wait too long at checkout." })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Checkout delays frustrate customers." })).toHaveCount(0);
});
