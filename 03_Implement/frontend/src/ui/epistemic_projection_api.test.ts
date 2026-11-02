import { describe, expect, it, vi } from "vitest";
import {
  EpistemicProjectionApiError,
  fetchEpistemicProjection,
} from "./epistemic_projection_api";
import { TeiEpistemicProjectionParseError } from "./epistemic_projection_adapter";

const ARTIFACT = {
  contract: "tei.epistemic-projection/v0",
  schema: "tei.reference.epistemic-assessment/v0",
  assessments: [],
  health: { level: "healthy", viewMetadataState: "complete" },
  authorityLimits: ["assessment-does-not-assert-objective-truth"],
};

function response(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe("fetchEpistemicProjection", () => {
  it("loads and validates the tenant-plane artifact", async () => {
    const fetchMock = vi.fn(async () => response(200, { ok: true, artifact: ARTIFACT }));

    const projection = await fetchEpistemicProjection("doc-1", fetchMock as unknown as typeof fetch);

    expect(projection.contract).toBe("tei.epistemic-projection/v0");
    expect(projection.assessments).toEqual([]);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("/docs/doc-1/epistemic/projection");
  });

  it("surfaces a missing binding as a typed 404 with its code", async () => {
    const fetchMock = vi.fn(async () =>
      response(404, { detail: { code: "epistemic_binding_not_found" } }),
    );

    await expect(
      fetchEpistemicProjection("doc-1", fetchMock as unknown as typeof fetch),
    ).rejects.toMatchObject({
      status: 404,
      code: "epistemic_binding_not_found",
    });
    await expect(
      fetchEpistemicProjection("doc-1", fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(EpistemicProjectionApiError);
  });

  it("fails closed on an artifact with an unsupported contract", async () => {
    const fetchMock = vi.fn(async () =>
      response(200, { ok: true, artifact: { ...ARTIFACT, contract: "unknown/v1" } }),
    );

    await expect(
      fetchEpistemicProjection("doc-1", fetchMock as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(TeiEpistemicProjectionParseError);
  });
});
