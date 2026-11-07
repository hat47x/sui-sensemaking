import type { ContextProjectionV1 } from "./context_bundle_projection";

/**
 * An optional, read-only Markdown draft made only from content ALREADY exposed
 * by context-projection.v1. This is NOT an OKF Concept, source citation,
 * semantic review, membership export, or a reverse-write binding.
 *
 * This module deliberately does not carry doc/card/island IDs, source cues,
 * withheld counts, digests, or links to the destination. The capability to
 * READ a projection must not be silently converted into redisclosure rights;
 * callers must separately authorize sharing the generated draft.
 */
function escapeMarkdownLiteral(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/([\x60*_{}\[\]()#+.!|<>~\\-])/g, "\\$1");
}

export function renderReadOnlyMarkdownDraft(projection: ContextProjectionV1): string {
  const sections = [
    "# SUIからの文章草稿",
    "",
    "この文書は取得済みの公開投影から作成した草稿です。原資料の照合、構造の全件性、意味の確認は行っていません。",
    "",
  ];

  // SafeMode is checked a second time here, even if the caller supplies a
  // malformed projection with a non-redacted card.
  if (!projection.safeMode) {
    let ordinal = 0;
    for (const card of projection.cards) {
      if (card.reviewed !== true || card.redacted !== false ||
          card.digest === null || card.holdState !== null ||
          typeof card.text !== "string") continue;
      ordinal += 1;
      sections.push(`## 記述 ${ordinal}`, "");
      // Escape Markdown syntax, including inline links and footnote markers,
      // so untrusted Card.text cannot mint source links, headers or frontmatter.
      for (const line of card.text.split(/\r\n|\r|\n/)) {
        sections.push(`> ${escapeMarkdownLiteral(line)}`);
      }
      sections.push("");
    }
  }

  // Explicitly describe an empty visible scope without claiming the source
  // document has no cards or unresolved evidence.
  if (sections.filter((line) => line.startsWith("## 記述 ")).length === 0) {
    sections.push("この条件で文章として出力できる記述はありません。", "");
  }
  return sections.join("\n");
}
