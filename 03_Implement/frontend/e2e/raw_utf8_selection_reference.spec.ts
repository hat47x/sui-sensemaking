import { expect, test } from "@playwright/test";

/**
 * Real Chromium DOM/Selection boundary, but only a synthetic Raw fixture.
 * No Product Reader, permitted Host Root, Card Save, or Source Binding.
 */
test("R2 single DOM Text selection keeps second Japanese occurrence at the original raw byte span", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const {
      captureRawContentCheckpoint, compareRawContentCheckpoint,
      projectRawUtf8Bytes, resolveSingleDomTextNodeSelection,
    } =
      await import("/src/source/raw_utf8_selection_reference.ts");

    const text = "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊";
    const raw = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
    const projection = projectRawUtf8Bytes(raw);

    const element = document.createElement("pre");
    element.textContent = projection.text;
    document.body.appendChild(element);
    const node = element.firstChild;
    const selection = window.getSelection();
    if (!node || !selection) throw new Error("browser-selection-unavailable");

    const range = document.createRange();
    range.setStart(node, 15);
    range.setEnd(node, 22);
    selection.removeAllRanges();
    selection.addRange(range);

    const second = resolveSingleDomTextNodeSelection(projection, element, selection);
    const checkpoint = await captureRawContentCheckpoint(raw, second);
    const contentCheck = await compareRawContentCheckpoint(Uint8Array.from(raw), checkpoint);
    const roundtrip = new TextDecoder("utf-8", { fatal: true })
      .decode(raw.subarray(second.startByte, second.endByte));

    selection.removeAllRanges();
    element.remove();

    return { totalBytes: raw.length, second, checkpoint, contentCheck, roundtrip };
  });

  expect(result).toEqual({
    totalBytes: 57,
    second: { startByte: 38, endByte: 57, selectedText: "同じ言葉。🌊" },
    checkpoint: {
      rawSha256: "0d92d8f8852fffe376d1af5655ffea572b4989de7a77de64b182ee47a8ff20cf",
      selectedSha256: "6b39ef0ed8a5f5771807dc348b88b79fc716b3ec6cdf541b24fbd6f4b0f53df7",
      startByte: 38,
      endByte: 57,
    },
    contentCheck: "content-match-only",
    roundtrip: "同じ言葉。🌊",
  });
});

test("R2 DOM selection reference refuses decorated nodes, normalized text, and surrogate boundaries", async ({ page }) => {
  await page.goto("/");

  const rejected = await page.evaluate(async () => {
    const { projectRawUtf8Bytes, resolveSingleDomTextNodeSelection } =
      await import("/src/source/raw_utf8_selection_reference.ts");

    const text = "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊";
    const projection = projectRawUtf8Bytes(new TextEncoder().encode(text));
    const element = document.createElement("pre");
    element.textContent = projection.text;
    document.body.appendChild(element);
    const node = element.firstChild;
    const selection = window.getSelection();
    if (!node || !selection) throw new Error("browser-selection-unavailable");

    function select(start: number, end: number): void {
      const range = document.createRange();
      range.setStart(node!, start);
      range.setEnd(node!, end);
      selection!.removeAllRanges();
      selection!.addRange(range);
    }
    function rejects(): boolean {
      try {
        resolveSingleDomTextNodeSelection(projection, element, selection);
        return false;
      } catch {
        return true;
      }
    }

    select(15, 22);
    element.appendChild(document.createElement("span")); // an extra DOM node
    const extraChildRejected = rejects();
    element.lastChild?.remove();

    element.textContent = projection.text.replace(/\r\n/g, "\n");
    const normalizedNode = element.firstChild;
    if (!normalizedNode) throw new Error("missing-normalized-text");
    const normalizedRange = document.createRange();
    normalizedRange.setStart(normalizedNode, 4);
    normalizedRange.setEnd(normalizedNode, 11);
    selection.removeAllRanges();
    selection.addRange(normalizedRange);
    // This must reject the normalized SOURCE TEXT, not merely a stale Range
    // whose Text node was detached during the mutation.
    const normalizedTextRejected = rejects();

    element.textContent = projection.text;
    const restoredNode = element.firstChild;
    if (!restoredNode) throw new Error("missing-restored-text");
    const brokenRange = document.createRange();
    brokenRange.setStart(restoredNode, 21);
    brokenRange.setEnd(restoredNode, 22);
    selection.removeAllRanges();
    selection.addRange(brokenRange);
    const splitSurrogateRejected = rejects();

    selection.removeAllRanges();
    element.remove();
    return { extraChildRejected, normalizedTextRejected, splitSurrogateRejected };
  });

  expect(rejected).toEqual({
    extraChildRejected: true,
    normalizedTextRejected: true,
    splitSurrogateRejected: true,
  });
});
