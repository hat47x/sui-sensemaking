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


test("R2 browser File input preview preserves raw bytes and keeps the selected span unqualified", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.setAttribute("data-r2-local-preview", "1");
    document.body.appendChild(input);
  });

  const rawText = "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊";
  const raw = Buffer.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(rawText)]);
  await page.locator('[data-r2-local-preview="1"]').setInputFiles({
    name: "same-text-is-not-source-identity.txt",
    mimeType: "text/plain",
    buffer: raw,
  });

  const result = await page.evaluate(async () => {
    const { readLocalRawFilePreview } =
      await import("/src/source/local_raw_file_preview_reference.ts");
    const {
      captureRawContentCheckpoint,
      resolveSingleDomTextNodeSelection,
    } = await import("/src/source/raw_utf8_selection_reference.ts");

    const input = document.querySelector<HTMLInputElement>('[data-r2-local-preview="1"]');
    const preview = await readLocalRawFilePreview(input?.files?.item(0) ?? null);
    const element = document.createElement("pre");
    element.textContent = preview.projection.text;
    document.body.appendChild(element);
    const node = element.firstChild;
    const selection = window.getSelection();
    if (!node || !selection) throw new Error("missing-file-selection");
    const range = document.createRange();
    range.setStart(node, 15);
    range.setEnd(node, 22);
    selection.removeAllRanges();
    selection.addRange(range);

    const span = resolveSingleDomTextNodeSelection(preview.projection, element, selection);
    const checkpoint = await captureRawContentCheckpoint(preview.rawBytes, span);
    const extracted = new TextDecoder("utf-8", { fatal: true })
      .decode(preview.rawBytes.subarray(span.startByte, span.endByte));

    selection.removeAllRanges();
    element.remove();
    input?.remove();
    return {
      qualification: preview.qualification,
      byteLength: preview.rawBytes.length,
      selectedSpan: [span.startByte, span.endByte],
      selectedSha256: checkpoint.selectedSha256,
      extracted,
    };
  });

  expect(result).toEqual({
    qualification: "unqualified-local-file-preview",
    byteLength: 57,
    selectedSpan: [38, 57],
    selectedSha256: "6b39ef0ed8a5f5771807dc348b88b79fc716b3ec6cdf541b24fbd6f4b0f53df7",
    extracted: "同じ言葉。🌊",
  });
});


test("R2 StartPanel File preview is user-visible, local-only and cleared when collapsed", async ({ page }) => {
  const observedWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.method() !== "HEAD") {
      observedWrites.push(request.method() + " " + request.url());
    }
  });

  await page.goto("/?locale=ja");
  const panel = page.locator('[data-panel="start-document-entry"]');
  await expect(panel).toBeVisible();
  await panel.locator("[data-start-expand]").click();
  const disclosure = page.getByTestId("raw-local-preview-disclosure");
  await disclosure.locator("summary").click();
  const preview = page.getByTestId("raw-local-preview");
  await expect(preview).toBeVisible();

  const text = "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊";
  await preview.getByTestId("raw-local-file-input").setInputFiles({
    name: "human-chosen-raw.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]),
  });
  const source = preview.getByTestId("raw-local-source-text");
  await expect(source).toHaveText(text);
  await expect(preview.getByTestId("raw-local-unqualified")).toContainText("正式な出典として登録されていません");

  await page.evaluate(() => {
    const element = document.querySelector('[data-testid="raw-local-source-text"]');
    const node = element?.firstChild;
    const selection = window.getSelection();
    if (!node || !selection) throw new Error("missing-product-raw-text-node");
    const range = document.createRange();
    range.setStart(node, 15);
    range.setEnd(node, 22);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await preview.getByTestId("raw-local-confirm-selection").click();
  await expect(preview.getByTestId("raw-local-span")).toContainText("[38, 57)");

  // A later human selection must not keep showing the previous byte span.
  // The first and second Japanese sentences have the same text, but not
  // the same Raw UTF-8 offsets. Neither position is a durable Source Pin.
  await page.evaluate(() => {
    const textNode = document.querySelector('[data-testid="raw-local-source-text"]')?.firstChild;
    const selection = window.getSelection();
    if (!textNode || !selection) throw new Error("missing-second-selection");
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 11);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(preview.getByTestId("raw-local-span")).toHaveCount(0);
  await preview.getByTestId("raw-local-confirm-selection").click();
  await expect(preview.getByTestId("raw-local-span")).toContainText("[11, 30)");

  // Replacing a selected file must clear both the previous selection and
  // its position. Matching filename or previous digest is not identity.
  await preview.getByTestId("raw-local-file-input").setInputFiles({
    name: "human-chosen-raw.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(new TextEncoder().encode("別の資料に更新されました。")),
  });
  await expect(source).toHaveText("別の資料に更新されました。");
  await expect(preview.getByTestId("raw-local-span")).toHaveCount(0);
  expect(observedWrites).toEqual([]);

  await disclosure.locator("summary").click();
  await expect(page.getByTestId("raw-local-preview")).toHaveCount(0);
  await disclosure.locator("summary").click();
  await expect(page.getByTestId("raw-local-source-text")).toHaveCount(0);
});


test("R2 delayed old File read cannot replace a newer preview or revive a cleared preview", async ({ page }) => {
  await page.goto("/?locale=ja");
  const panel = page.locator('[data-panel="start-document-entry"]');
  await panel.locator("[data-start-expand]").click();
  const disclosure = page.getByTestId("raw-local-preview-disclosure");
  await disclosure.locator("summary").click();
  const preview = page.getByTestId("raw-local-preview");
  const fileInput = preview.getByTestId("raw-local-file-input");
  const source = preview.getByTestId("raw-local-source-text");

  // Hold one actual browser File.arrayBuffer() call while allowing the next
  // selected file to complete. No mock server or durable Source is involved.
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let holdNext = true;
    const releases: Array<() => Promise<void>> = [];
    File.prototype.arrayBuffer = function () {
      if (holdNext) {
        holdNext = false;
        const chosenFile = this;
        return new Promise<ArrayBuffer>((resolve, reject) => {
          releases.push(async () => {
            try { resolve(await original.call(chosenFile)); }
            catch (reason) { reject(reason); }
          });
        });
      }
      return original.call(this);
    };
    Object.assign(window, {
      holdNextLocalFileRead: () => { holdNext = true; },
      releaseHeldLocalFileRead: async () => {
        const release = releases.shift();
        if (!release) throw new Error("no-held-file-read");
        await release();
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      },
    });
  });

  await fileInput.setInputFiles({
    name: "same-name.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("先に選んだ原文"),
  });
  await expect(source).toHaveCount(0);

  await fileInput.setInputFiles({
    name: "same-name.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("後から選んだ原文"),
  });
  await expect(source).toHaveText("後から選んだ原文");

  await page.evaluate(async () => {
    const release = (window as Window & { releaseHeldLocalFileRead?: () => Promise<void> })
      .releaseHeldLocalFileRead;
    if (!release) throw new Error("missing-release-hook");
    await release();
  });
  await expect(source).toHaveText("後から選んだ原文");

  // A newly selected file is also delayed; clear the preview BEFORE the
  // read completes. The eventual response must not resurrect the old panel.
  await page.evaluate(() => {
    const hold = (window as Window & { holdNextLocalFileRead?: () => void })
      .holdNextLocalFileRead;
    if (!hold) throw new Error("missing-hold-hook");
    hold();
  });
  await fileInput.setInputFiles({
    name: "same-name.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("破棄する予定の原文"),
  });
  await expect(source).toHaveCount(0);
  await preview.getByTestId("raw-local-clear").click();
  await page.evaluate(async () => {
    const release = (window as Window & { releaseHeldLocalFileRead?: () => Promise<void> })
      .releaseHeldLocalFileRead;
    if (!release) throw new Error("missing-release-hook");
    await release();
  });
  await expect(source).toHaveCount(0);
  await expect(preview.getByTestId("raw-local-span")).toHaveCount(0);
  await disclosure.locator("summary").click();
  await expect(page.getByTestId("raw-local-preview")).toHaveCount(0);
  await disclosure.locator("summary").click();
  await expect(page.getByTestId("raw-local-source-text")).toHaveCount(0);
});


test("R2 preview clear cannot erase a different workspace DOM selection", async ({ page }) => {
  await page.goto("/?locale=ja");
  const panel = page.locator('[data-panel="start-document-entry"]');
  await panel.locator("[data-start-expand]").click();
  await page.getByTestId("raw-local-preview-disclosure").locator("summary").click();
  const preview = page.getByTestId("raw-local-preview");
  const fileInput = preview.getByTestId("raw-local-file-input");
  await fileInput.setInputFiles({
    name: "read-only.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("原文の一時選択"),
  });
  await expect(preview.getByTestId("raw-local-source-text")).toHaveText("原文の一時選択");

  // A different editor/workspace may own window.getSelection(). Dispatch
  // the real DOM click handler without letting a pointer-focus side effect
  // obscure whether the preview itself removed another pane's selection.
  const outsideSelection = await page.evaluate(() => {
    const other = document.createElement("p");
    other.textContent = "別の作業領域で選択された文字";
    other.setAttribute("data-r2-external-selection", "true");
    document.body.appendChild(other);
    const otherText = other.firstChild;
    const selection = window.getSelection();
    const button = document.querySelector<HTMLButtonElement>('[data-testid="raw-local-clear"]');
    if (!otherText || !selection || !button) throw new Error("missing-external-selection-elements");
    const range = document.createRange();
    range.selectNodeContents(otherText);
    selection.removeAllRanges();
    selection.addRange(range);
    button.click();
    return { text: selection.toString(), anchorIsOther: selection.anchorNode === otherText };
  });
  expect(outsideSelection).toEqual({
    text: "別の作業領域で選択された文字",
    anchorIsOther: true,
  });
  await expect(preview.getByTestId("raw-local-source-text")).toHaveCount(0);

  // Conversely, the preview can discard the current selection it owns.
  await fileInput.setInputFiles({
    name: "read-only.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("もう一度原文を選択する"),
  });
  await expect(preview.getByTestId("raw-local-source-text")).toHaveText("もう一度原文を選択する");
  const ownSelection = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="raw-local-source-text"]');
    const ownText = root?.firstChild;
    const selection = window.getSelection();
    const button = document.querySelector<HTMLButtonElement>('[data-testid="raw-local-clear"]');
    if (!ownText || !selection || !button) throw new Error("missing-own-selection-elements");
    const range = document.createRange();
    range.selectNodeContents(ownText);
    selection.removeAllRanges();
    selection.addRange(range);
    button.click();
    return { rangeCount: selection.rangeCount };
  });
  expect(ownSelection).toEqual({ rangeCount: 0 });
  await expect(preview.getByTestId("raw-local-source-text")).toHaveCount(0);
});


test("R2 observed selection A-B-A while hashing cannot confirm the old span", async ({ page }) => {
  await page.goto("/?locale=ja");
  const panel = page.locator('[data-panel="start-document-entry"]');
  await panel.locator("[data-start-expand]").click();
  await page.getByTestId("raw-local-preview-disclosure").locator("summary").click();
  const preview = page.getByTestId("raw-local-preview");
  await preview.getByTestId("raw-local-file-input").setInputFiles({
    name: "same-occurrences.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊")]),
  });
  await expect(preview.getByTestId("raw-local-source-text"))
    .toHaveText("前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊");

  // Keep the first real WebCrypto digest pending; the UI still uses its
  // actual digest call when released, not synthetic bytes or an API mock.
  await page.evaluate(() => {
    const subtle = crypto.subtle;
    const originalDigest = subtle.digest.bind(subtle);
    let release: (() => void) | null = null;
    Object.defineProperty(subtle, "digest", {
      configurable: true,
      value: (algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
        if (release) return originalDigest(algorithm, data);
        return new Promise<ArrayBuffer>((resolve, reject) => {
          release = () => { void originalDigest(algorithm, data).then(resolve, reject); };
        });
      },
    });
    Object.assign(window, {
      r2CheckpointHeld: () => release !== null,
      r2ReleaseCheckpoint: () => {
        if (!release) throw new Error("digest-not-held");
        release();
      },
    });
  });

  const choose = async (start: number, end: number) => {
    await page.evaluate(({ start, end }) => {
      const textNode = document.querySelector('[data-testid="raw-local-source-text"]')?.firstChild;
      const selection = window.getSelection();
      if (!textNode || !selection) throw new Error("missing-selection");
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);
      selection.removeAllRanges();
      selection.addRange(range);
      // Observe one real DOM Selection with deliberately controlled timing.
      document.dispatchEvent(new Event("selectionchange"));
    }, { start, end });
  };

  await choose(15, 22);
  await preview.getByTestId("raw-local-confirm-selection").click();
  await page.waitForFunction(() =>
    (window as Window & { r2CheckpointHeld?: () => boolean }).r2CheckpointHeld?.() === true,
  );

  // During one pending confirmation, choose the first occurrence, then
  // return to the same second occurrence and offsets. An end-only comparison
  // would incorrectly treat the old confirmation as still current.
  await choose(4, 11);
  await choose(15, 22);
  await page.evaluate(() =>
    (window as Window & { r2ReleaseCheckpoint?: () => void }).r2ReleaseCheckpoint?.(),
  );

  await expect(preview.getByTestId("raw-local-span")).toHaveCount(0);
  await expect(preview.getByRole("alert")).toContainText("元のバイト位置を特定できません");

  // The user can confirm the current selection anew; this is not a Pin.
  await preview.getByTestId("raw-local-confirm-selection").click();
  await expect(preview.getByTestId("raw-local-span")).toContainText("[38, 57)");
});
