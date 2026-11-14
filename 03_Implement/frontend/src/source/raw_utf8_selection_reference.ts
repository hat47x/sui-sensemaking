/**
 * R2 reference ONLY: map a faithful, single rendered text run back to UTF-8
 * byte boundaries of one supplied Raw source. This does not resolve a DOM
 * Range, authorize a root, store a Source Binding, or prove source freshness.
 */
export interface RawTextProjection {
  readonly text: string;
  readonly sourceByteLength: number;
  readonly utf16ToByte: ReadonlyArray<number | null>;
}

export interface RawByteSpan {
  readonly startByte: number;
  readonly endByte: number;
  readonly selectedText: string;
}

export function projectRawUtf8Bytes(sourceBytes: Uint8Array): RawTextProjection {
  if (!(sourceBytes instanceof Uint8Array)) {
    throw new Error("invalid-source");
  }
  const hasBom = sourceBytes.length >= 3 &&
    sourceBytes[0] === 0xef && sourceBytes[1] === 0xbb && sourceBytes[2] === 0xbf;
  const firstByte = hasBom ? 3 : 0;
  let text: string;
  try {
    // Explicit BOM handling: do not normalize EOL or Unicode. A second BOM
    // remains part of the text, not a silently removed prefix.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(sourceBytes.subarray(firstByte));
  } catch {
    throw new Error("invalid-utf8");
  }

  const positions: Array<number | null> = Array(text.length + 1).fill(null);
  const encoder = new TextEncoder();
  let utf16 = 0;
  let byte = firstByte;
  positions[0] = firstByte;
  for (const scalar of text) {
    utf16 += scalar.length; // 1 BMP code unit or 2 for a non-BMP scalar
    byte += encoder.encode(scalar).length;
    positions[utf16] = byte;
  }
  if (byte !== sourceBytes.length) {
    throw new Error("unqualified-source");
  }
  return { text, sourceByteLength: sourceBytes.length, utf16ToByte: positions };
}

/**
 * The UI must first prove that its selection endpoints address exactly this
 * ONE text run. Offsets from decorative/multiple DOM nodes are unsupported.
 * If the renderer normalized CRLF/CR or Unicode, fail rather than guess.
 */
export function resolveSingleTextRunSelection(
  projection: RawTextProjection,
  renderedText: string,
  startUtf16: number,
  endUtf16: number,
): RawByteSpan {
  if (renderedText !== projection.text ||
      !Number.isSafeInteger(startUtf16) || !Number.isSafeInteger(endUtf16) ||
      startUtf16 < 0 || endUtf16 <= startUtf16 ||
      endUtf16 > projection.text.length) {
    throw new Error("unqualified-selection");
  }
  const startByte = projection.utf16ToByte[startUtf16];
  const endByte = projection.utf16ToByte[endUtf16];
  if (startByte == null || endByte == null || endByte <= startByte) {
    // E.g. inside a UTF-16 surrogate pair (one non-BMP Unicode scalar).
    throw new Error("unqualified-selection");
  }
  return { startByte, endByte, selectedText: projection.text.slice(startUtf16, endUtf16) };
}

/**
 * DOM boundary of the same R2 Reference. Accept exactly one faithful native
 * DOM Text node, contained directly by the supplied element. Other layouts
 * require a separate, explicit source-run map; never guess DOM offsets.
 *
 * This only reads in-memory DOM state. It does NOT establish Source identity,
 * current Host/Root authorization, or persisted Document bindings.
 */
export function resolveSingleDomTextNodeSelection(
  projection: RawTextProjection,
  sourceElement: Element,
  selection: Selection | null,
): RawByteSpan {
  const textNode = sourceElement.firstChild;
  if (sourceElement.childNodes.length !== 1 ||
      textNode?.nodeType !== 3 ||
      textNode.nodeValue !== projection.text ||
      selection?.rangeCount !== 1) {
    throw new Error("unqualified-dom-selection");
  }

  const range = selection.getRangeAt(0);
  if (range.startContainer !== textNode ||
      range.endContainer !== textNode ||
      selection.anchorNode !== textNode ||
      selection.focusNode !== textNode) {
    throw new Error("unqualified-dom-selection");
  }

  return resolveSingleTextRunSelection(
    projection,
    textNode.nodeValue,
    range.startOffset,
    range.endOffset,
  );
}

/**
 * Content-only checkpoint for an independently re-read Raw byte sequence.
 * NEVER treat matching digests as the same authorized Source, the same Root,
 * or uninterrupted freshness (A -> B -> A is indistinguishable).
 */
export interface RawContentCheckpoint {
  readonly rawSha256: string;
  readonly selectedSha256: string;
  readonly startByte: number;
  readonly endByte: number;
}

async function sha256RawBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function captureRawContentCheckpoint(
  sourceBytes: Uint8Array,
  selected: RawByteSpan,
): Promise<RawContentCheckpoint> {
  // Freeze one local byte snapshot before any await: the caller may mutate
  // its Uint8Array while WebCrypto digests are being computed.
  const snapshot = Uint8Array.from(sourceBytes);
  const { startByte, endByte, selectedText } = selected; // pin caller-provided fields
  const projection = projectRawUtf8Bytes(snapshot);
  if (!Number.isSafeInteger(startByte) ||
      !Number.isSafeInteger(endByte) ||
      startByte < 0 || endByte > snapshot.length ||
      startByte >= endByte ||
      !projection.utf16ToByte.includes(startByte) ||
      !projection.utf16ToByte.includes(endByte)) {
    throw new Error("unqualified-selection");
  }

  const selectedBytes = snapshot.subarray(startByte, endByte);
  const currentText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    .decode(selectedBytes);
  if (currentText !== selectedText) {
    throw new Error("unqualified-selection");
  }
  return {
    rawSha256: await sha256RawBytes(snapshot),
    selectedSha256: await sha256RawBytes(selectedBytes),
    startByte,
    endByte,
  };
}

/**
 * May return "content-match-only", never "source-verified" or "authorized".
 * The caller must independently re-resolve current Host Root/Scope/Grant and
 * reliable Source revision/history before permitting a Source return.
 */
export async function compareRawContentCheckpoint(
  currentBytes: Uint8Array,
  checkpoint: RawContentCheckpoint,
): Promise<"content-match-only" | "stale-content"> {
  // Compare a single immutable-by-convention local snapshot, never two
  // different observations of a mutable byte buffer across an await.
  const snapshot = Uint8Array.from(currentBytes);
  const { rawSha256: expectedRawSha256, selectedSha256: expectedSelectedSha256,
    startByte, endByte } = checkpoint; // pin the comparison descriptor
  projectRawUtf8Bytes(snapshot); // strict UTF-8; still no Host grant.
  const rawSha256 = await sha256RawBytes(snapshot);
  if (rawSha256 !== expectedRawSha256) {
    return "stale-content";
  }
  if (!Number.isSafeInteger(startByte) || !Number.isSafeInteger(endByte) ||
      startByte < 0 || startByte >= endByte || endByte > snapshot.length) {
    throw new Error("unqualified-selection");
  }
  const currentSelected = snapshot.subarray(startByte, endByte);
  return (await sha256RawBytes(currentSelected)) === expectedSelectedSha256
    ? "content-match-only"
    : "stale-content";
}
