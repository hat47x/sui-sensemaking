import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EpistemicAdminApiError,
  getEpistemicProjectionArtifact,
} from "./epistemic_admin_api";

const FIXTURE_ARTIFACT = {
  contract: "tei.epistemic-projection/v0",
  schema: "tei.reference.epistemic-assessment/v0",
  assessments: [],
  health: { level: "normal", viewMetadataState: "complete", coverage: { areas: [] } },
  reviewRequests: [],
  authorityLimits: [
    "assessment-does-not-assert-objective-truth",
  ],
};

describe("getEpistemicProjectionArtifact", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a parsed projection on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, artifact: FIXTURE_ARTIFACT }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    const projection = await getEpistemicProjectionArtifact("epistemic-assessment", {
      adminApiKey: "secret-key",
    });

    expect(projection.contract).toBe("tei.epistemic-projection/v0");
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/admin/tei-epistemic/artifacts/epistemic-assessment");
    expect((init as RequestInit).headers).toMatchObject({ "X-Admin-Api-Key": "secret-key" });
  });

  it("throws with status and code on a fail-closed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: { code: "tei_reference_unconfigured", message: "no dir" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })),
    );

    await expect(getEpistemicProjectionArtifact("epistemic-assessment")).rejects.toMatchObject({
      status: 503,
      code: "tei_reference_unconfigured",
    });
  });

  it("throws when the artifact shape is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, artifact: { contract: "wrong" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    await expect(getEpistemicProjectionArtifact("epistemic-assessment")).rejects.toBeInstanceOf(
      EpistemicAdminApiError,
    );
  });

  it("throws when the artifact field is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })),
    );

    await expect(getEpistemicProjectionArtifact("epistemic-assessment")).rejects.toMatchObject({
      status: 500,
    });
  });
});
