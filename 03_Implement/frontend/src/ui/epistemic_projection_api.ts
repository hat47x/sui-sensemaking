import { resolveFrontendApiBase } from "../api/base_path";
import { parseTeiEpistemicProjection } from "./epistemic_projection_adapter";
import type { EpistemicProjectionInput } from "./epistemic_review_model";

const API_BASE = resolveFrontendApiBase(import.meta.env.SUI_FRONTEND_API_BASE);

export class EpistemicProjectionApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "EpistemicProjectionApiError";
    this.status = status;
    this.code = code;
  }
}

type FetchLike = typeof fetch;

/**
 * Read the tenant-plane TEI epistemic projection for one document.
 *
 * The backend returns `{ ok, artifact }`; the artifact is validated against the
 * semantic contract and representation schema by the existing fail-closed
 * parser. Missing bindings / unavailable artifacts are surfaced as typed
 * errors so the UI can distinguish "no projection" from "transport failure".
 */
export async function fetchEpistemicProjection(
  docId: string,
  fetchImpl: FetchLike = fetch,
): Promise<EpistemicProjectionInput> {
  const response = await fetchImpl(
    `${API_BASE}/docs/${encodeURIComponent(docId)}/epistemic/projection`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = (await response.json()) as { detail?: { code?: unknown } };
      if (typeof body.detail?.code === "string") {
        code = body.detail.code;
      }
    } catch {
      // Keep the status-only error when the body is not JSON.
    }
    throw new EpistemicProjectionApiError(
      response.status,
      `Epistemic projection request failed (${response.status}${code ? `: ${code}` : ""})`,
      code,
    );
  }

  const body = (await response.json()) as { artifact?: unknown };
  return parseTeiEpistemicProjection(body.artifact);
}
