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
