import { expect, test, type Page, type Route } from "@playwright/test";
import JSZip from "jszip";
import {
  ADVANCED_UI_BUTTON,
  continueThroughPreShareGateIfPresent,
  enableAdvancedUiIfNeeded,
  EXPORT_BUNDLE_BUTTON,
  SHARE_REPRODUCE_BUTTON,
  WORK_MODE_BUTTON,
} from "./helpers/i18n";

const DOCUMENT_ID = "doc_phase1_canvas";

function buildDocument() {
  const now = "2026-05-22T00:00:00.000Z";

  return {
    version: 1,
    id: DOCUMENT_ID,
    title: "ops recovery fixture",
    createdAt: now,
    updatedAt: now,
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      {
        id: "card-1",
        text: "保存復旧の確認用カード",
        x: 120,
        y: 120,
      },
    ],
    edges: [],
    islands: [],
  };
}

async function routeDocumentApi(
  page: Page,
  options: {
    failGet?: boolean;
    failPut?: boolean;
  },
) {
  // The first-run public pack is tried before the server document; a 404 keeps
  // these tests on the server-document path they are about.
  await page.route("**/packs/index.json", async (route: Route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/docs/**", async (route: Route) => {
    const method = route.request().method();
    if (method === "GET") {
      if (options.failGet) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "backend unavailable" }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(buildDocument()),
      });
      return;
    }

    if (method === "PUT") {
      if (options.failPut) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "database unavailable" }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: route.request().postData() ?? JSON.stringify(buildDocument()),
      });
      return;
    }

    await route.continue();
  });
}

async function expectStatusFitsViewport(page: Page) {
  const viewport = page.viewportSize();
  const box = await page.getByTestId("status-message").boundingBox();

  expect(viewport).toBeTruthy();
  expect(box).toBeTruthy();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

async function installSlowDiagnosticsWorker(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;

    class SlowDiagnosticsWorker extends EventTarget {
      private requestId: string | null = null;
      private progressTimer: number | null = null;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super();
        if (!String(scriptURL).includes("diagnostics.worker")) {
          return new NativeWorker(scriptURL, options) as unknown as SlowDiagnosticsWorker;
        }
      }

      postMessage(message: unknown) {
        if (!message || typeof message !== "object") {
          return;
        }

        const payload = message as { type?: string; requestId?: string };
        if (payload.type === "diagnostics.request" && payload.requestId) {
          this.requestId = payload.requestId;
          this.progressTimer = window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", {
              data: {
                type: "diagnostics.progress",
                requestId: payload.requestId,
                stage: "outline",
                percent: 10,
              },
            }));
          }, 50);
          return;
        }

        if (payload.type === "diagnostics.cancel" && payload.requestId) {
          if (this.progressTimer !== null) {
            window.clearTimeout(this.progressTimer);
            this.progressTimer = null;
          }
          this.dispatchEvent(new MessageEvent("message", {
            data: {
              type: "diagnostics.cancelled",
              requestId: payload.requestId,
            },
          }));
        }
      }

      terminate() {
        if (this.progressTimer !== null) {
          window.clearTimeout(this.progressTimer);
          this.progressTimer = null;
        }
        this.requestId = null;
      }
    }

    window.Worker = SlowDiagnosticsWorker as unknown as typeof Worker;
  });
}

async function installSlowBundleZipWorker(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;

    class SlowBundleZipWorker extends EventTarget {
      private requestId: string | null = null;
      private progressTimer: number | null = null;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super();
        if (!String(scriptURL).includes("bundle_zip.worker")) {
          return new NativeWorker(scriptURL, options) as unknown as SlowBundleZipWorker;
        }
      }

      postMessage(message: unknown) {
        if (!message || typeof message !== "object") {
          return;
        }

        const payload = message as { type?: string; requestId?: string };
        if (payload.type === "bundle.zip.request" && payload.requestId) {
          this.requestId = payload.requestId;
          this.progressTimer = window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", {
              data: {
                type: "bundle.zip.progress",
                requestId: payload.requestId,
                percent: 10,
              },
            }));
          }, 50);
          return;
        }

        if (payload.type === "bundle.zip.cancel" && payload.requestId) {
          if (this.progressTimer !== null) {
            window.clearTimeout(this.progressTimer);
            this.progressTimer = null;
          }
          this.dispatchEvent(new MessageEvent("message", {
            data: {
              type: "bundle.zip.cancelled",
              requestId: payload.requestId,
            },
          }));
        }
      }

      terminate() {
        if (this.progressTimer !== null) {
          window.clearTimeout(this.progressTimer);
          this.progressTimer = null;
        }
        this.requestId = null;
      }
    }

    window.Worker = SlowBundleZipWorker as unknown as typeof Worker;
  });
}

async function installSlowDiffWorker(page: Page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;

    class SlowDiffWorker extends EventTarget {
      private requestId: string | null = null;
      private progressTimer: number | null = null;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super();
        if (!String(scriptURL).includes("diff.worker")) {
          return new NativeWorker(scriptURL, options) as unknown as SlowDiffWorker;
        }
      }

      postMessage(message: unknown) {
        if (!message || typeof message !== "object") {
          return;
        }

        const payload = message as { type?: string; requestId?: string };
        if (payload.type === "diff.request" && payload.requestId) {
          this.requestId = payload.requestId;
          this.progressTimer = window.setTimeout(() => {
            this.dispatchEvent(new MessageEvent("message", {
              data: {
                type: "diff.progress",
                requestId: payload.requestId,
                stage: "cards",
                percent: 10,
                protocolVersion: 1,
              },
            }));
          }, 50);
          return;
        }

        if (payload.type === "diff.cancel" && payload.requestId) {
          if (this.progressTimer !== null) {
            window.clearTimeout(this.progressTimer);
            this.progressTimer = null;
          }
          this.dispatchEvent(new MessageEvent("message", {
            data: {
              type: "diff.cancelled",
              requestId: payload.requestId,
              protocolVersion: 1,
            },
          }));
        }
      }

      terminate() {
        if (this.progressTimer !== null) {
          window.clearTimeout(this.progressTimer);
          this.progressTimer = null;
        }
        this.requestId = null;
      }
    }

    window.Worker = SlowDiffWorker as unknown as typeof Worker;
  });
}

test("API load failure gives safe recovery guidance", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await routeDocumentApi(page, { failGet: true });

  await page.goto("/");

  const status = page.getByTestId("status-message");
  await expect(status).toContainText("ドキュメントを読み込めませんでした");
  await expect(status).toContainText("/api/healthz");
  await expect(status).toContainText("バックエンドの起動状態");
  await expect(status).toContainText("API key や token を含めない");
  await expectStatusFitsViewport(page);
});

test("save failure keeps content and points to export or retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await routeDocumentApi(page, { failPut: true });

  await page.goto("/");
  await expect(page.getByTestId("status-message")).toContainText("ドキュメントを読み込みました");

  // UX-MENU-01: at 390px the menu bar collapses into a single "Menu" trigger;
  // "New" moved from a flat toolbar button into the File menu inside it.
  await page.getByRole("menuitem", { name: /^メニュー$|^Menu$/ }).click();
  await page.getByRole("menuitem", { name: /^新規$|^New$/ }).click();
  await page.getByRole("button", { name: /^保存$|^Save$/ }).click();

  const status = page.getByTestId("status-message");
  await expect(status).toContainText("ドキュメントを保存できませんでした");
  await expect(status).toContainText("内容は画面上に残っています");
  await expect(status).toContainText("JSONを書き出して保全");
  await expect(status).toContainText("API key や token を除外");
  await expectStatusFitsViewport(page);
});

test("slow diagnostics shows progress and can be cancelled", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await installSlowDiagnosticsWorker(page);
  await routeDocumentApi(page, {});

  await page.goto("/");
  await expect(page.getByTestId("status-message")).toContainText("ドキュメントを読み込みました");

  await enableAdvancedUiIfNeeded(page);
  await page.getByRole("button", { name: /診断を実行|Run diagnostics/ }).first().click();
  await expect(page.getByText("診断中: アウトライン（10%）").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^処理中|^Working/ }).first()).toBeDisabled();

  await page.getByRole("button", { name: /^キャンセル$|^Cancel$/ }).first().click();
  await expect(page.getByTestId("status-message")).toContainText("診断を中止しました");
  await expectStatusFitsViewport(page);
});

test("slow review pack export shows progress and can be cancelled", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await installSlowBundleZipWorker(page);
  await routeDocumentApi(page, {});

  await page.goto("/");
  await expect(page.getByTestId("status-message")).toContainText("ドキュメントを読み込みました");

  await page.getByRole("button", { name: SHARE_REPRODUCE_BUTTON }).click();
  await page.getByRole("button", { name: EXPORT_BUNDLE_BUTTON }).click();
  await continueThroughPreShareGateIfPresent(page);

  await expect(page.getByText("レビューパックを圧縮中（10%）").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^処理中|^Working/ }).first()).toBeDisabled();

  await page.locator("button:not([disabled])", { hasText: /^キャンセル$|^Cancel$/ }).last().click();
  await expect(page.getByTestId("status-message")).toContainText("レビューパックの書き出しを中止しました");
  await expectStatusFitsViewport(page);
});

test("review pack missing document.json shows localized recovery guidance", async ({ page }) => {
  await routeDocumentApi(page, {});
  await page.goto("/?locale=ja");
  await expect(page.getByTestId("status-message")).toContainText("ドキュメントを読み込みました");

  const zip = new JSZip();
  zip.file("view.json", JSON.stringify({
    schemaVersion: "1.0.0",
    visibility: "Restricted",
    viewState: {},
  }));
  const buffer = await zip.generateAsync({ type: "nodebuffer" });

  await page.getByRole("button", { name: SHARE_REPRODUCE_BUTTON }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /ZIPファイルを選択|Choose ZIP/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "missing-document.zip",
    mimeType: "application/zip",
    buffer,
  });

  const status = page.getByTestId("status-message");
  await expect(status).toContainText("レビューパックに document.json がありません");
  await expect(status).toContainText("作り直してください");
  await expect(status).not.toContainText("document.json not found in zip");
  await expectStatusFitsViewport(page);
});

test("slow review diff shows localized progress and can be cancelled", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await installSlowDiffWorker(page);
  await routeDocumentApi(page, {});

  const comparisonDocument = buildDocument();
  comparisonDocument.cards = [
    ...comparisonDocument.cards,
    {
      id: "card-2",
      text: "差分キャンセル確認用カード",
      x: 280,
      y: 120,
    },
  ];

  await page.goto("/");
  await expect(page.getByTestId("status-message")).toContainText("ドキュメントを読み込みました");
  await page.getByRole("button", { name: /開始パネルを閉じる|Close start panel/ }).click();
  await page.getByRole("button", { name: ADVANCED_UI_BUTTON }).click();
  // UX-NAV-02: comparison loading (ReviewDiffPanel) lives inside the
  // Advanced-gated Work mode panel's "Diff" tab -- the first/default tab, so
  // opening the panel is enough without an explicit tab selection.
  await page.getByRole("button", { name: WORK_MODE_BUTTON }).click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /比較対象ドキュメントを読み込む|Load comparison document/ }).first().click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "diff-cancel.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(comparisonDocument), "utf-8"),
  });

  await expect(page.getByTestId("status-message")).not.toContainText("Loaded comparison document (view-only)");
  await expect(page.getByText("差分を計算中: カード（10%）").first()).toBeVisible();
  await expect(page.getByText(/項目数: 0.*処理中|Items: 0.*Working/).first()).toBeVisible();

  // Scoped to the work-mode region: "Cancel"/"キャンセル" is also used by
  // SidePanel's (always-rendered, usually-disabled) connect/edit actions,
  // which now sort ahead of ReviewDiffPanel's Cancel button in DOM order
  // since UX-NAV-02 moved the diff panel inside WorkModeTabs.
  await page
    .locator('[data-ui-region="work-mode"]')
    .getByRole("button", { name: /^キャンセル$|^Cancel$/ })
    .first()
    .click();
  await expect(page.getByTestId("status-message")).toContainText("差分計算を中止しました");
  await expectStatusFitsViewport(page);
});

test("invalid comparison JSON shows localized recovery guidance", async ({ page }) => {
  await routeDocumentApi(page, {});
  await page.goto("/?locale=ja");
  await expect(page.getByTestId("status-message")).toContainText("ドキュメントを読み込みました");
  await page.getByRole("button", { name: /開始パネルを閉じる|Close start panel/ }).click();
  await page.getByRole("button", { name: ADVANCED_UI_BUTTON }).click();
  // UX-NAV-02: comparison loading (ReviewDiffPanel) lives inside the
  // Advanced-gated Work mode panel's "Diff" tab -- the first/default tab, so
  // opening the panel is enough without an explicit tab selection.
  await page.getByRole("button", { name: WORK_MODE_BUTTON }).click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /比較対象ドキュメントを読み込む|Load comparison document/ }).first().click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "invalid-comparison.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ invalid json", "utf-8"),
  });

  await expect(page.getByTestId("status-message")).toContainText("比較対象のJSONファイルを解析できませんでした");
  await expectStatusFitsViewport(page);
});

test("invalid patch JSON shows localized validation guidance", async ({ page }) => {
  await routeDocumentApi(page, {});
  await page.goto("/?locale=ja");
  await expect(page.getByTestId("status-message")).toContainText("ドキュメントを読み込みました");
  // "Load patch.json" is gated behind Advanced UI in SharePanel.tsx.
  await enableAdvancedUiIfNeeded(page);
  await page.getByRole("button", { name: SHARE_REPRODUCE_BUTTON }).click();

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /patch\.json を読み込む|Load patch\.json/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "invalid-patch.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ invalid json", "utf-8"),
  });

  await expect(page.getByTestId("status-message")).toContainText("パッチJSONを読み込めませんでした");
  await expect(page.getByText(/パッチを検証できませんでした/)).toBeVisible();
  await expect(page.getByText(/JSONの構文が正しくありません/)).toBeVisible();
  await expectStatusFitsViewport(page);
});
