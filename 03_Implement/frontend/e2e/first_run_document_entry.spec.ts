import { expect, test } from "@playwright/test";

const START_PANEL = '[data-panel="start-document-entry"]';

function seedDocumentJson(): string {
  return JSON.stringify(
    {
      version: 1,
      id: "first-run-import",
      title: "First run import",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      transform: { panX: 0, panY: 0, zoom: 1 },
      cards: [{ id: "card-1", text: "first run imported card", x: 120, y: 120 }],
      edges: [],
      islands: [],
      readingOrder: [],
      narratives: [],
      evidenceLinks: [],
      mergeSuggestionDecisions: [],
    },
    null,
    2
  );
}

function buildDocument(cardTexts: string[]): unknown {
  return {
    version: 1,
    id: "doc_phase1_canvas",
    title: "First run sample",
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: cardTexts.map((text, index) => ({
      id: `sample-card-${index + 1}`,
      text,
      x: 120 + index * 260,
      y: 120 + (index % 2) * 150,
    })),
    edges: [],
    islands: [],
    readingOrder: [],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

test("first-run panel presents safe document entry choices", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await page.goto("/");

  const startPanel = page.locator(START_PANEL);
  await expect(startPanel).toBeVisible();
  await expect(startPanel).toContainText(/作業を開始|Start work/);
  await expect(startPanel).toContainText(/セーフモード: ON|SafeMode: ON/);

  await expect(page.getByRole("button", { name: /新しい文書を作成|Create new document/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /サンプルを開く|Open sample/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /文書ファイルを読み込む|Load document file/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /レビューパックを取り込む|Import review pack/ })).toBeVisible();

  const box = await startPanel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
});

test("first-run panel keeps keyboard focus inside the entry dialog", async ({ page }) => {
  await page.goto("/");

  const startPanel = page.locator(START_PANEL);
  await expect(startPanel).toBeVisible();
  await expect(startPanel).toHaveAttribute("role", "dialog");
  await expect(startPanel).toHaveAttribute("aria-modal", "true");

  await expect(page.getByRole("button", { name: /開始パネルを閉じる|Close start panel/ })).toBeFocused();

  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press("Tab");
    const isFocusInsideStartPanel = await page.evaluate(() => {
      const panel = document.querySelector('[data-panel="start-document-entry"]');
      return Boolean(panel && document.activeElement && panel.contains(document.activeElement));
    });
    expect(isFocusInsideStartPanel).toBe(true);
  }

  await page.keyboard.down("Shift");
  await page.keyboard.press("Tab");
  await page.keyboard.up("Shift");
  const isFocusInsideStartPanelAfterReverseTab = await page.evaluate(() => {
    const panel = document.querySelector('[data-panel="start-document-entry"]');
    return Boolean(panel && document.activeElement && panel.contains(document.activeElement));
  });
  expect(isFocusInsideStartPanelAfterReverseTab).toBe(true);
});

test("first-run document file entry opens the validation-before-replace flow", async ({ page }) => {
  await page.goto("/");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /文書ファイルを読み込む|Load document file/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "first-run-import.document.json",
    mimeType: "application/json",
    buffer: Buffer.from(seedDocumentJson(), "utf-8"),
  });

  const shareDialog = page.locator('[data-panel="share-replay"]');
  await expect(shareDialog).toBeVisible();
  await expect(shareDialog).toContainText("first-run-import.document.json");
  await expect(shareDialog).toContainText(/カード: 1|cards: 1/);
  await expect(page.getByRole("button", { name: /現在のドキュメントを置換|Replace current document/ })).toBeVisible();
});

test("first-run sample entry opens the sample and exposes selection context", async ({ page }) => {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });

  let shouldReturnSample = false;
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    const document = shouldReturnSample
      ? buildDocument(["インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。", "結論は残っているのに、どの発言を根拠にしたのか後から分からなくなった。", "一人だけ違う意見だったので、そのまま議事録から落ちた。"])
      : buildDocument([]);

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { ETag: shouldReturnSample ? '"first-run-sample-loaded"' : '"first-run-sample-empty"' },
      body: JSON.stringify(document),
    });
  });

  await page.goto("/");
  await expect(page.locator(START_PANEL)).toBeVisible();
  await expect(page.getByRole("button", { name: "インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。" })).toHaveCount(0);

  shouldReturnSample = true;
  await page.getByRole("button", { name: /サンプルを開く|Open sample/ }).click();

  await expect(page.locator(START_PANEL)).toBeHidden();
  const sampleCard = page.getByRole("button", { name: "インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。" });
  await expect(sampleCard).toBeVisible();
  await expect(page.getByRole("button", { name: "結論は残っているのに、どの発言を根拠にしたのか後から分からなくなった。" })).toBeVisible();
  await expect(page.getByRole("button", { name: "一人だけ違う意見だったので、そのまま議事録から落ちた。" })).toBeVisible();

  await sampleCard.click();

  const selectionContext = page.locator('[data-panel="selection-context"]');
  await expect(selectionContext).toContainText(/現在の選択|Current selection/);
  await expect(selectionContext).toContainText(/カードを選択中|Card selected/);
  await expect(selectionContext).toContainText(/対象: インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。|Target: インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。/);
  await expect(selectionContext).toContainText(/レビュー状態: 未レビュー|Review state: Unreviewed/);
});

test("read-only first-run entry falls back to the built-in sample when services are unavailable", async ({ page }) => {
  await page.route("**/packs/index.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/docs/doc_phase1_canvas", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"service unavailable"}' });
  });

  await page.goto("/?locale=en&readOnly=1");

  const createButton = page.getByRole("button", { name: /Create new document/ });
  const sampleButton = page.getByRole("button", { name: /Open sample/ });
  await expect(createButton).toBeDisabled();
  await expect(sampleButton).toBeEnabled();
  await expect(page.getByRole("button", { name: /Load document file/ })).toContainText("open it for inspection without saving");

  await sampleButton.click();

  await expect(page.locator(START_PANEL)).toBeHidden();
  await expect(page.locator('[data-ui-region="primary-flow"] [role="button"]')).toHaveCount(3);
  await expect(page.locator("header")).toContainText("Read-only");
  await expect(page.locator("body")).toContainText("Opened the built-in sample");
});

test("read-only document file entry opens validated content for inspection without unsaved changes", async ({ page }) => {
  await page.goto("/?locale=en&readOnly=1");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Load document file/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "read-only-inspection.document.json",
    mimeType: "application/json",
    buffer: Buffer.from(seedDocumentJson(), "utf-8"),
  });

  await expect(page.locator("body")).toContainText("Document validated. Review the summary, then click Open for inspection.");
  await expect(page.getByText("Validate DocumentV1 JSON, then open it for inspection without saving.")).toBeVisible();
  await page.getByRole("button", { name: "Open for inspection" }).click();

  await expect(page.getByRole("button", { name: "first run imported card" })).toBeVisible();
  await expect(page.locator("header")).toContainText("Read-only");
  await expect(page.locator("header")).not.toContainText("Unsaved changes");
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(page.locator("body")).toContainText("Opened the document for inspection");
});

test("first-run panel can create a new document from keyboard activation", async ({ page }) => {
  await page.goto("/");

  const createButton = page.getByRole("button", { name: /新しい文書を作成|Create new document/ });
  await expect(createButton).toBeEnabled();
  await createButton.focus();
  await expect(createButton).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.locator(START_PANEL)).toBeHidden();
  await expect(page.locator("header")).toContainText(/未保存|Unsaved changes/);
});
