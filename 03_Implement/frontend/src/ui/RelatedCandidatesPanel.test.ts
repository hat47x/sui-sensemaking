import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { setActiveLocale } from "../i18n/translate";
import type { Card, Document } from "../domain/types";
import { RelatedCandidatesPanel } from "./RelatedCandidatesPanel";

function card(id: string, text: string): Card {
  return { id, text, x: 0, y: 0 };
}

function documentWith(cards: Card[], islands: Document["islands"] = []): Document {
  return {
    version: 1,
    id: "doc-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    transform: { scale: 1, offsetX: 0, offsetY: 0 },
    cards,
    edges: [],
    islands,
  } as unknown as Document;
}

describe("RelatedCandidatesPanel", () => {
  beforeEach(() => {
    setActiveLocale("ja");
  });

  it("renders local candidates without applying them", () => {
    const document = documentWith(
      [card("a", "顧客の課題を整理する"), card("b", "顧客の課題を分類する")],
      [{ id: "i1", cardIds: ["a", "b"] }],
    );

    const html = renderToStaticMarkup(
      createElement(RelatedCandidatesPanel, { document, focusCardId: "a" }),
    );

    expect(html).toContain("関連候補（ローカル・1）");
    expect(html).toContain("顧客の課題を分類する");
    expect(html).toContain("学習モデルは使っていません");
    expect(html).not.toContain(">追加<");
  });

  it("shows an empty state when no candidate is close enough", () => {
    const document = documentWith([card("a", "alpha"), card("b", "completely different")]);

    const html = renderToStaticMarkup(
      createElement(RelatedCandidatesPanel, { document, focusCardId: "a" }),
    );

    expect(html).toContain("関連候補は見つかりませんでした");
  });
});
