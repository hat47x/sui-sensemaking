import type { DocumentV1 } from "../../frontend/src/domain/types.js";
import { authHeaders } from "./auth_headers.js";
import { loadTokenExchangeConfigFromEnv, type TokenExchangeConfig } from "./token_exchange.js";
import { requireSecureEndpoint } from "./transport_security.js";

export { AGENT_CREDENTIAL_HEADER, authHeaders } from "./auth_headers.js";

// EXT-CONN-01 subslice B: fetches the DocumentV1 this server projects from,
// via the same GET /docs/{doc_id} contract the frontend uses (02_Architecture/api.md
// §2.2). This process is not served behind the frontend's nginx proxy, so it
// needs an absolute base URL and (when the deployment enables SUI_API_KEY)
// must send X-API-Key itself -- the browser client never does, relying on the
// same-origin proxy instead.

export type DocumentClientConfig = {
  baseUrl: string;
  apiKey?: string;
  /** ADR-0093: tenantと文書に束縛した agent 資格情報。saas-multitenant ではこれだけを送る。 */
  agentCredential?: string;
  /** ADR-0094: HTTP transport の saas-multitenant。要求ごとに、検証済みトークンを交換する設定。 */
  tokenExchange?: TokenExchangeConfig;
  /** ADR-0094: 要求ごとに交換して得た、backend 宛ての短命のトークン。設定から読むものではない。 */
  agentBearer?: string;
};

const AGENT_CREDENTIAL_PREFIX = "suiag_";

const SUPPORTED_RUNTIME_PROFILES = new Set(["local-dev", "evaluation", "enterprise-production"]);

export function validateMcpRuntimeProfile(env: NodeJS.ProcessEnv = process.env): string {
  const runtimeProfile = env.SUI_RUNTIME_PROFILE?.trim().toLowerCase() || "local-dev";
  if (runtimeProfile === "saas-multitenant") {
    // ADR-0093 / ADR-0094: stdio は agent 資格情報、HTTP はトークン交換の設定を必須とする。
    const transport = (env.SUI_MCP_TRANSPORT?.trim() || "stdio").toLowerCase();
    if (env.SUI_API_KEY?.trim()) {
      throw new Error(
        "SUI_API_KEY must not be set with SUI_RUNTIME_PROFILE=saas-multitenant; a static key does not prove a tenant.",
      );
    }
    if (transport === "http") {
      if (!loadTokenExchangeConfigFromEnv(env)) {
        throw new Error(
          "SUI_RUNTIME_PROFILE=saas-multitenant on the HTTP transport requires the SUI_MCP_TOKEN_EXCHANGE_* settings (ADR-0094).",
        );
      }
      if (env.SUI_MCP_AGENT_CREDENTIAL?.trim()) {
        throw new Error(
          "SUI_MCP_AGENT_CREDENTIAL belongs to the stdio transport; the HTTP transport exchanges each caller's token instead.",
        );
      }
    } else if (transport === "stdio") {
      const credential = env.SUI_MCP_AGENT_CREDENTIAL?.trim();
      if (!credential || !credential.startsWith(AGENT_CREDENTIAL_PREFIX)) {
        throw new Error(
          "SUI_RUNTIME_PROFILE=saas-multitenant requires SUI_MCP_AGENT_CREDENTIAL (a tenant-bound agent credential issued by the tenant admin).",
        );
      }
    } else {
      throw new Error(`Unknown SUI_MCP_TRANSPORT: ${transport}`);
    }
    return runtimeProfile;
  }
  if (!SUPPORTED_RUNTIME_PROFILES.has(runtimeProfile)) {
    throw new Error(`Unsupported SUI_RUNTIME_PROFILE: ${runtimeProfile}`);
  }
  return runtimeProfile;
}

export function loadDocumentClientConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DocumentClientConfig {
  const runtimeProfile = validateMcpRuntimeProfile(env);
  const rawBaseUrl = env.SUI_MCP_API_BASE_URL?.trim();
  const baseUrl = rawBaseUrl && rawBaseUrl.length > 0 ? rawBaseUrl : "http://127.0.0.1:8000";
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  if (runtimeProfile === "saas-multitenant") {
    // 資格情報（agent 資格情報、交換後のトークン）を平文で送らない。
    requireSecureEndpoint(normalizedBaseUrl, "SUI_MCP_API_BASE_URL");
    if ((env.SUI_MCP_TRANSPORT?.trim() || "stdio").toLowerCase() === "http") {
      return { baseUrl: normalizedBaseUrl, tokenExchange: loadTokenExchangeConfigFromEnv(env) };
    }
    return { baseUrl: normalizedBaseUrl, agentCredential: env.SUI_MCP_AGENT_CREDENTIAL?.trim() };
  }
  const apiKey = env.SUI_API_KEY?.trim() || undefined;
  return { baseUrl: normalizedBaseUrl, apiKey };
}

export class DocumentNotFoundError extends Error {
  constructor(public readonly docId: string) {
    super(`Document not found: ${docId}`);
    this.name = "DocumentNotFoundError";
  }
}

/** 失敗の切り分け用の短い分類。TAI Pleroma等が接続失敗を記録するときに、認証切れ・付与外・障害を区別できるようにする。 */
function describeHttpStatus(status: number): string {
  if (status === 401) return "unauthorized: credential missing, expired or rejected";
  if (status === 403) return "forbidden: not granted for this document";
  if (status === 429) return "rate limited";
  if (status >= 500) return "backend error";
  return "unexpected status";
}

export class DocumentFetchError extends Error {
  constructor(public readonly docId: string, public readonly status: number) {
    super(`Failed to fetch document ${docId}: HTTP ${status} (${describeHttpStatus(status)})`);
    this.name = "DocumentFetchError";
  }
}

/** バックエンド呼び出しの待ち時間の上限（#3312）。接続を保持したまま応答しない場合にツール呼び出しが待ち続けないようにする。 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MIN_REQUEST_TIMEOUT_MS = 100;
const MAX_REQUEST_TIMEOUT_MS = 120_000;

/** `SUI_MCP_REQUEST_TIMEOUT_MS` を読む。未設定・不正・範囲外のときは既定値へ戻す（無制限にはしない）。 */
export function resolveRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SUI_MCP_REQUEST_TIMEOUT_MS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_REQUEST_TIMEOUT_MS;
  const value = Number(raw);
  if (value < MIN_REQUEST_TIMEOUT_MS || value > MAX_REQUEST_TIMEOUT_MS) return DEFAULT_REQUEST_TIMEOUT_MS;
  return value;
}

/** タイムアウトで中断された。資格情報の値や応答本文は含めない。 */
export class DocumentFetchTimeoutError extends Error {
  constructor(public readonly docId: string, public readonly timeoutMs: number) {
    super(`Failed to fetch document ${docId}: timeout after ${timeoutMs}ms (backend did not respond)`);
    this.name = "DocumentFetchTimeoutError";
  }
}

/** 200で返った本文が DocumentV1 の最低限の形を満たさない。この場合は投影を作らない。 */
export class DocumentShapeError extends Error {
  constructor(public readonly docId: string, public readonly reason: string) {
    super(`Failed to fetch document ${docId}: unexpected response shape (${reason})`);
    this.name = "DocumentShapeError";
  }
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/** `DocumentV1` の最低限の形（version、id、cards、edges、islands）を検査する。満たさないときは理由を返す。 */
export function describeDocumentShapeProblem(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "body is not an object";
  const record = body as Record<string, unknown>;
  if (record.version !== 1) return "version is not 1";
  if (typeof record.id !== "string" || record.id.length === 0) return "id is not a non-empty string";
  for (const key of ["cards", "edges", "islands"]) {
    if (!Array.isArray(record[key])) return `${key} is not an array`;
  }
  return null;
}

export async function fetchDocument(config: DocumentClientConfig, docId: string): Promise<DocumentV1> {
  const url = `${config.baseUrl}/docs/${encodeURIComponent(docId)}`;
  const headers: Record<string, string> = authHeaders(config);
  const timeoutMs = resolveRequestTimeoutMs();

  let body: unknown;
  try {
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });

    if (response.status === 404) {
      throw new DocumentNotFoundError(docId);
    }
    if (!response.ok) {
      throw new DocumentFetchError(docId, response.status);
    }
    try {
      body = await response.json();
    } catch (error) {
      if (isAbortLike(error)) throw error;
      throw new DocumentShapeError(docId, "body is not valid JSON");
    }
  } catch (error) {
    if (isAbortLike(error)) throw new DocumentFetchTimeoutError(docId, timeoutMs);
    throw error;
  }

  const problem = describeDocumentShapeProblem(body);
  if (problem) throw new DocumentShapeError(docId, problem);
  return body as DocumentV1;
}

// ADR-0073 / 第2反復: the document's row lifecycle metadata (creator and
// lifecycle state) — payload-independent, exposed so a generative-AI client can
// verify the lifecycle features (created_by / archive) via MCP.
export type DocumentLifecycleMetadata = {
  id: string;
  title?: string;
  created_by?: string;
  lifecycle_state: string;
  updated_at: string;
};

/** Fetch the document's lifecycle metadata via GET /docs (list), matching by id. */
export async function fetchDocumentMetadata(
  config: DocumentClientConfig,
  docId: string,
): Promise<DocumentLifecycleMetadata | null> {
  const url = `${config.baseUrl}/docs`;
  const headers: Record<string, string> = authHeaders(config);

  try {
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(resolveRequestTimeoutMs()) });
    if (!response.ok) {
      return null; // metadata is advisory — the content fetch remains authoritative
    }
    const list = (await response.json()) as DocumentLifecycleMetadata[];
    if (!Array.isArray(list)) return null;
    return list.find((item) => item.id === docId) ?? null;
  } catch {
    return null; // never break the main projection over an advisory metadata fetch
  }
}

// CE4 proposal lifecycle (read-only): lets a generative-AI verifier confirm
// whether each AI proposal is still proposal-only (status="proposed") or was
// decided by a human (accepted/rejected/held, with decidedAt). Read-only by
// contract (GET /ai/proposals/status); never mutates.
export type ProposalStatusItem = {
  proposalId: string;
  proposalKind: string;
  origin: string;
  status: "proposed" | "accepted" | "rejected" | "held";
  sourceBundleHash: string;
  createdAt: string;
  decidedAt?: string | null;
};

export async function fetchProposalStatus(
  config: DocumentClientConfig,
  docId: string,
): Promise<ProposalStatusItem[]> {
  const url = `${config.baseUrl}/ai/proposals/status?docId=${encodeURIComponent(docId)}`;
  const headers: Record<string, string> = authHeaders(config);

  const timeoutMs = resolveRequestTimeoutMs();
  let response: Response;
  try {
    response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    if (isAbortLike(error)) throw new DocumentFetchTimeoutError(docId, timeoutMs);
    throw error;
  }
  if (!response.ok) {
    throw new DocumentFetchError(docId, response.status);
  }
  const body = (await response.json()) as { proposals: ProposalStatusItem[] };
  return body.proposals;
}
