import { afterEach, describe, expect, it, vi } from "vitest";

import { createExportId } from "./export_id";

// Matches the backend ExportAuditPayload.exportId constraint (routes/docs.py).
const BACKEND_EXPORT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

describe("createExportId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when it is available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });

    expect(createExportId()).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("falls back to an alphanumeric random string when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(7);
        return array;
      },
    });

    expect(createExportId()).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it("still returns a valid id when the Web Crypto API is entirely absent", () => {
    vi.stubGlobal("crypto", undefined);

    expect(createExportId()).toMatch(BACKEND_EXPORT_ID_PATTERN);
  });

  it("returns a value the backend accepts, and a different value per call", () => {
    const first = createExportId();
    const second = createExportId();

    expect(first).toMatch(BACKEND_EXPORT_ID_PATTERN);
    expect(second).toMatch(BACKEND_EXPORT_ID_PATTERN);
    expect(first).not.toBe(second);
  });
});
