import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StartPanel } from "./StartPanel";
import { setActiveLocale } from "../i18n/translate";

function buildProps(overrides: Partial<React.ComponentProps<typeof StartPanel>> = {}) {
  return {
    currentDocumentId: "",
    isDirty: false,
    safeMode: true,
    isLoading: false,
    isReadOnly: false,
    isSaving: false,
    recentDocumentIds: [],
    selectedRecentDocumentId: "",
    onClose: vi.fn(),
    onCreateNew: vi.fn(),
    onOpenSample: vi.fn(),
    onLoadDocumentFile: vi.fn(),
    onImportReviewPack: vi.fn(),
    onOpenRecent: vi.fn(),
    onSelectedRecentDocumentChange: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof StartPanel>;
}

describe("StartPanel", () => {
  it("shows the first-run document entry actions in Japanese", () => {
    setActiveLocale("ja");

    const html = renderToStaticMarkup(React.createElement(StartPanel, buildProps()));

    expect(html).toContain("作業を開始");
    expect(html).toContain("新しい文書を作成");
    expect(html).toContain("サンプルを開く");
    expect(html).toContain("文書ファイルを読み込む");
    expect(html).toContain("レビューパックを取り込む");
    expect(html).toContain("セーフモード: ON");
  });

  it("uses English copy when the locale is English", () => {
    setActiveLocale("en");

    const html = renderToStaticMarkup(React.createElement(StartPanel, buildProps({ safeMode: false })));

    expect(html).toContain("Start work");
    expect(html).toContain("Create new document");
    expect(html).toContain("Open sample");
    expect(html).toContain("Load document file");
    expect(html).toContain("Import review pack");
    expect(html).toContain("SafeMode: OFF");
  });

  it("keeps reopening the saved document disabled unless the active copy is not server-backed", () => {
    setActiveLocale("ja");
    const same = {
      currentDocumentId: "doc-first-run-value",
      recentDocumentIds: ["doc-first-run-value"],
      selectedRecentDocumentId: "doc-first-run-value",
    };
    const openButton = (html: string) => html.match(/<button[^>]*>前回の文書を開く<\/button>/)?.[0] ?? "";

    const serverBacked = renderToStaticMarkup(React.createElement(StartPanel, buildProps(same)));
    const packCopy = renderToStaticMarkup(
      React.createElement(StartPanel, buildProps({ ...same, canReopenCurrent: true })),
    );

    expect(openButton(serverBacked)).toContain("disabled");
    expect(openButton(packCopy)).not.toContain("disabled");
  });
});
