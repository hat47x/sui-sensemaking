import { ApiError } from "../api/client";

/**
 * PROV-ERROR-01 (ADR-0050 D2): classify an AI-call failure by the backend's
 * structured provider error contract, instead of matching raw exception text
 * with a regex. "disabled" = provider=none (intentional); the other kinds mean
 * a provider is configured but the call itself failed.
 */
export type AiProviderErrorKind = "disabled" | "timeout" | "validation" | "too_large" | "unavailable" | "unknown";

export function classifyAiProviderError(error: unknown): AiProviderErrorKind {
  if (!(error instanceof ApiError)) {
    return "unknown";
  }

  if (error.disabledReason) {
    return "disabled";
  }

  switch (error.code) {
    case "provider_timeout":
      return "timeout";
    case "provider_validation":
      return "validation";
    case "provider_request_too_large":
      return "too_large";
    case "provider_unavailable":
      return "unavailable";
    default:
      return "unknown";
  }
}
