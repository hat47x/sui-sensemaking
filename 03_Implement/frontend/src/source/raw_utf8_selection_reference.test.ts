import { describe, expect, it } from "vitest";
import {
  captureRawContentCheckpoint,
  compareRawContentCheckpoint,
  projectRawUtf8Bytes,
  resolveSingleTextRunSelection,
} from "./raw_utf8_selection_reference";

const rawText = "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊";
const rawBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(rawText)]);

describe("R2 single-text-run byte offset reference (NOT Product DOM / Source authority)", () => {
  it("locates both equal substrings by ORIGINAL bytes despite BOM and mixed EOL", () => {
    const projection = projectRawUtf8Bytes(rawBytes);
    expect(projection.sourceByteLength).toBe(57); // hand-authored independent expected
    expect(projection.text).toBe(rawText);
    expect(resolveSingleTextRunSelection(projection, projection.text, 4, 11))
      .toEqual({ startByte: 11, endByte: 30, selectedText: "同じ言葉。🌊" });
    expect(resolveSingleTextRunSelection(projection, projection.text, 15, 22))
      .toEqual({ startByte: 38, endByte: 57, selectedText: "同じ言葉。🌊" });
  });

  it("refuses a UTF-16 boundary inside the surrogate pair", () => {
    const p = projectRawUtf8Bytes(rawBytes);
    expect(() => resolveSingleTextRunSelection(p, p.text, 21, 22))
      .toThrow("unqualified-selection");
  });

  it("refuses a renderer that silently normalizes CRLF / CR or NFC", () => {
    const p = projectRawUtf8Bytes(rawBytes);
    expect(() => resolveSingleTextRunSelection(p, p.text.replace(/\r\n/g, "\n"), 4, 11))
      .toThrow("unqualified-selection");
    expect(() => resolveSingleTextRunSelection(p, p.text.replace(/\r/g, "\n"), 4, 11))
      .toThrow("unqualified-selection");
    const decomposed = projectRawUtf8Bytes(new TextEncoder().encode("e\u0301"));
    expect(() => resolveSingleTextRunSelection(decomposed, "é", 0, 1))
      .toThrow("unqualified-selection");
  });

  it("refuses empty, out-of-range and non-integer selections", () => {
    const p = projectRawUtf8Bytes(rawBytes);
    for (const [a, b] of [[0, 0], [-1, 1], [5, 99], [2.5, 4], [5, 4]]) {
      expect(() => resolveSingleTextRunSelection(p, p.text, a, b))
        .toThrow("unqualified-selection");
    }
  });

  it("refuses invalid UTF-8 instead of decoding replacement characters", () => {
    expect(() => projectRawUtf8Bytes(new Uint8Array([0xff, 0xfe])))
      .toThrow("invalid-utf8");
  });

  it("does not drop a second BOM byte sequence after the leading one", () => {
    const b = new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41]);
    const p = projectRawUtf8Bytes(b);
    expect(p.text).toBe("\ufeffA");
    expect(resolveSingleTextRunSelection(p, p.text, 1, 2))
      .toEqual({ startByte: 6, endByte: 7, selectedText: "A" });
  });
});


describe("R2 content-only checkpoints (never Source authority)", () => {
  it("fixes independently computed Raw/selected SHA-256 and detects byte drift", async () => {
    const p = projectRawUtf8Bytes(rawBytes);
    const selection = resolveSingleTextRunSelection(p, p.text, 15, 22);
    const checkpoint = await captureRawContentCheckpoint(rawBytes, selection);
    expect(checkpoint).toEqual({
      rawSha256: "0d92d8f8852fffe376d1af5655ffea572b4989de7a77de64b182ee47a8ff20cf",
      selectedSha256: "6b39ef0ed8a5f5771807dc348b88b79fc716b3ec6cdf541b24fbd6f4b0f53df7",
      startByte: 38,
      endByte: 57,
    });
    expect(await compareRawContentCheckpoint(Uint8Array.from(rawBytes), checkpoint))
      .toBe("content-match-only");
    const sameLengthChanged = Uint8Array.from(rawBytes);
    sameLengthChanged[5] ^= 1; // a different Raw byte OUTSIDE the selected span
    expect(await compareRawContentCheckpoint(sameLengthChanged, checkpoint))
      .toBe("stale-content");
  });

  it("same bytes at two roots and A→B→A cannot establish Root or historical continuity", async () => {
    const selected = resolveSingleTextRunSelection(
      projectRawUtf8Bytes(rawBytes),
      projectRawUtf8Bytes(rawBytes).text,
      15, 22,
    );
    const a = Uint8Array.from(rawBytes);
    const checkpoint = await captureRawContentCheckpoint(a, selected);
    const anotherRootSameContent = Uint8Array.from(a); // synthetic copy, not a Host Root grant
    expect(await compareRawContentCheckpoint(anotherRootSameContent, checkpoint))
      .toBe("content-match-only");
    a[5] ^= 1; // A→B
    expect(await compareRawContentCheckpoint(a, checkpoint)).toBe("stale-content");
    a[5] ^= 1; // B→A: bytes equal again, but history and current Grant are NOT proven
    expect(await compareRawContentCheckpoint(a, checkpoint)).toBe("content-match-only");
  });

  it("snapshots a mutable caller buffer before asynchronous hashing", async () => {
    const p = projectRawUtf8Bytes(rawBytes);
    const selected = resolveSingleTextRunSelection(p, p.text, 15, 22);
    const mutable = Uint8Array.from(rawBytes);
    const promised = captureRawContentCheckpoint(mutable, selected);
    mutable[5] ^= 1; // caller mutation after invocation, during awaited WebCrypto
    const checkpoint = await promised;
    expect(checkpoint.rawSha256)
      .toBe("0d92d8f8852fffe376d1af5655ffea572b4989de7a77de64b182ee47a8ff20cf");
    expect(await compareRawContentCheckpoint(mutable, checkpoint)).toBe("stale-content");

    const original = Uint8Array.from(rawBytes);
    const comparison = compareRawContentCheckpoint(original, checkpoint);
    original[5] ^= 1;
    expect(await comparison).toBe("content-match-only");
  });

  it("snapshots mutable span and checkpoint descriptors before async digests", async () => {
    const projection = projectRawUtf8Bytes(rawBytes);
    const selected = { ...resolveSingleTextRunSelection(projection, projection.text, 15, 22) };
    const promise = captureRawContentCheckpoint(rawBytes, selected);
    selected.startByte = 11; // caller races the async digest
    selected.endByte = 30;
    selected.selectedText = "another sentence";
    const checkpoint = await promise;
    expect([checkpoint.startByte, checkpoint.endByte]).toEqual([38, 57]);
    expect(checkpoint.selectedSha256)
      .toBe("6b39ef0ed8a5f5771807dc348b88b79fc716b3ec6cdf541b24fbd6f4b0f53df7");

    const mutableCheckpoint = { ...checkpoint };
    const comparison = compareRawContentCheckpoint(rawBytes, mutableCheckpoint);
    mutableCheckpoint.rawSha256 = "not-the-original-hash";
    mutableCheckpoint.startByte = 11;
    mutableCheckpoint.endByte = 30;
    expect(await comparison).toBe("content-match-only");
  });

  it("rejects forged bounds and a selected text inconsistent with supplied Raw bytes", async () => {
    const selected = resolveSingleTextRunSelection(
      projectRawUtf8Bytes(rawBytes), rawText, 15, 22,
    );
    await expect(captureRawContentCheckpoint(rawBytes, { ...selected, startByte: 39 }))
      .rejects.toThrow("unqualified-selection");
    await expect(captureRawContentCheckpoint(rawBytes, { ...selected, selectedText: "別の言葉" }))
      .rejects.toThrow("unqualified-selection");
    await expect(captureRawContentCheckpoint(rawBytes, { ...selected, startByte: 38.5 }))
      .rejects.toThrow("unqualified-selection");
  });
});
