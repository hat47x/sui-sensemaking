import { describe, expect, it } from "vitest";
import {
  MAX_LOCAL_RAW_PREVIEW_BYTES,
  readLocalRawFilePreview,
} from "./local_raw_file_preview_reference";

describe("R2 explicit local File preview (no durable Source authority)", () => {
  it("retains BOM, mixed EOL, and duplicate Japanese text as exact bytes", async () => {
    const source = "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊";
    const raw = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(source)]);
    const file = new File([raw], "not-a-source-identity.txt", { type: "text/plain" });
    const result = await readLocalRawFilePreview(file);
    expect(result.qualification).toBe("unqualified-local-file-preview");
    expect(result.rawBytes).toEqual(raw);
    expect(result.projection.sourceByteLength).toBe(57);
    expect(result.projection.text).toBe(source);
    expect(Object.keys(result).sort()).toEqual(["projection", "qualification", "rawBytes"]);
  });

  it("refuses missing, empty, oversized, and invalid UTF-8 files", async () => {
    await expect(readLocalRawFilePreview(null)).rejects.toThrow("unqualified-local-file");
    await expect(readLocalRawFilePreview(new File([], "empty.txt")))
      .rejects.toThrow("unqualified-local-file");
    await expect(readLocalRawFilePreview(
      new File([new Uint8Array(MAX_LOCAL_RAW_PREVIEW_BYTES + 1)], "too-large.txt"),
    )).rejects.toThrow("unqualified-local-file");
    await expect(readLocalRawFilePreview(new File([new Uint8Array([0xff])], "invalid.txt")))
      .rejects.toThrow("invalid-utf8");
  });
});
