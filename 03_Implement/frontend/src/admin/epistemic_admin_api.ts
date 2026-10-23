import { csrfHeader } from "../session/csrf";
import { resolveFrontendApiBase } from "../api/base_path";
import type { ControlPlaneCredential } from "./model_allowlist_api";
export type { ControlPlaneCredential } from "./model_allowlist_api";
import { parseTeiEpistemicProjection } from "../ui/epistemic_projection_adapter";
import type { EpistemicProjectionInput } from "../ui/epistemic_review_model";

const API_BASE = resolveFrontendApiBase(
  import.meta.env.SUI_FRONTEND_API_BASE,
);

export class EpistemicAdminApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(
    status: number,
    message: string,
    options: Readonly<{ code?: string }> = {},
  ) {
    super(message);
    this.status = status;
    this.code = options.code;
  }
}

async function parseError(response: Response): Promise<EpistemicAdminApiError> {
  let message = response.statusText || "Request failed";
  let code: string | undefined;
  try {
    const body = (await response.json()) as { detail?: unknown };
    const detail = body.detail;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object") {
      const contract = detail as Record<string, unknown>;
      if (typeof contract.message === "string") {
        message = contract.message;
      }
      if (typeof contract.code === "string") {
        code = contract.code;
      }
    }
  } catch {
    // Keep the HTTP status text when the body is not a valid JSON error contract.
  }
  return new EpistemicAdminApiError(response.status, message, { code });
}

export async function getEpistemicProjectionArtifact(
  artifactKind: string,
  credential: ControlPlaneCredential = {},
): Promise<EpistemicProjectionInput> {
  const response = await fetch(
    `${API_BASE}/admin/tei-epistemic/artifacts/${encodeURIComponent(artifactKind)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(credential.adminApiKey?.trim()
          ? { "X-Admin-Api-Key": credential.adminApiKey.trim() }
          : {}),
      },
      credentials: "same-origin",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw await parseError(response);
  }
  const body = (await response.json()) as { artifact?: unknown };
  if (body.artifact === undefined) {
    throw new EpistemicAdminApiError(500, "Invalid epistemic artifact response shape");
  }
  try {
    return parseTeiEpistemicProjection(body.artifact);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid epistemic artifact";
    throw new EpistemicAdminApiError(500, message);
  }
}
