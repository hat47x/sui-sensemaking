import type { Card, Document, DocumentV1, Island, KnownEdgeType } from "../domain/types";
import type { ResourceActionIntentV1 } from "./tei_card_move_action";
import { isMergeMethod, type MergeMethod } from "../domain/merge_method";
import {
  InvalidTenantSessionContextError,
  parseTenantSessionContext,
  type TenantSessionContextV1,
} from "./session_context";
import {
  InvalidTenantSessionBootstrapPolicyError,
  parseTenantSessionBootstrapPolicy,
  type TenantSessionBootstrapPolicyV1,
} from "./session_bootstrap_policy";
import { authorizationHeader } from "../session/token_store";
import { csrfHeader } from "../session/csrf";
import { resolveFrontendApiBase } from "./base_path";

const API_BASE = resolveFrontendApiBase(
  import.meta.env.SUI_FRONTEND_API_BASE,
);

export class ApiError extends Error {
  readonly status: number;
  /**
   * PROV-ERROR-01: structured provider error code, mirrored from the backend's
   * ProviderError.to_contract() ("provider_unavailable" | "provider_timeout" |
   * "provider_validation"), when the failure originated from an LLM provider call.
   * Undefined for non-provider errors.
   */
  readonly code?: string;
  /**
   * Present only for ProviderDisabledError (provider=none), distinguishing an
   * intentionally-disabled provider from one that is configured but unreachable.
   */
  readonly disabledReason?: string;

  constructor(status: number, message: string, options?: { code?: string; disabledReason?: string }) {
    super(message);
    this.status = status;
    this.code = options?.code;
    this.disabledReason = options?.disabledReason;
  }
}

export type DocumentWithEtag<TDocument extends Document> = {
  document: TDocument;
  etag?: string;
};

type ParsedErrorDetail = {
  message: string;
  code?: string;
  disabledReason?: string;
};

const MAX_TENANT_SESSION_RESPONSE_BYTES = 64 * 1024;
const MAX_TENANT_SESSION_BOOTSTRAP_POLICY_BYTES = 4 * 1024;
export const TENANT_SESSION_VERSION_HEADER = "Sui-Sensemaking-Tenant-Session-Version";

export type TenantScopedRequestOptions = Readonly<{
  tenantSessionContext?: TenantSessionContextV1;
}>;

function tenantSessionPreconditionHeaders(
  options: TenantScopedRequestOptions,
): Record<string, string> {
  const authHeaders = authorizationHeader();
  const headers: Record<string, string> = {
    ...authHeaders,
    ...(Object.keys(authHeaders).length === 0 ? csrfHeader() : {}),
  };
  if (options.tenantSessionContext !== undefined) {
    const sessionContext = parseTenantSessionContext(options.tenantSessionContext);
    headers[TENANT_SESSION_VERSION_HEADER] = sessionContext.tenantSessionVersion;
  }
  return headers;
}

async function readBoundedUtf8Response(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null
    && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // The invalid length remains authoritative even if cancellation fails.
    }
    throw new InvalidTenantSessionContextError();
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size violation remains authoritative even if cancellation fails.
        }
        throw new InvalidTenantSessionContextError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const responseBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    responseBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(responseBytes);
  } catch {
    throw new InvalidTenantSessionContextError();
  }
}

/**
 * PROV-ERROR-01: the backend's /ai/* routes send `detail` as the full
 * ProviderError.to_contract() object (code/message/disabled_reason/...) for
 * provider failures, not a plain string. The previous `typeof detail ===
 * "string"` check silently discarded that object and fell back to
 * response.statusText, losing the distinction between "provider disabled"
 * and "provider configured but unreachable/timing out/invalid". This reads
 * both shapes: a plain string `detail` (most routes) or the structured
 * provider-error object.
 */
async function parseErrorDetail(
  response: Response,
  maxBytes?: number,
): Promise<ParsedErrorDetail> {
  try {
    const body = maxBytes === undefined
      ? await response.json()
      : JSON.parse(await readBoundedUtf8Response(response, maxBytes));
    const detail = body?.detail;

    if (typeof detail === "string") {
      return { message: detail };
    }

    if (detail && typeof detail === "object") {
      const code = typeof detail.code === "string" ? detail.code : undefined;
      const disabledReason = typeof detail.disabled_reason === "string" ? detail.disabled_reason : undefined;
      const message = typeof detail.message === "string" ? detail.message : response.statusText || "Request failed";
      return { message, code, disabledReason };
    }
  } catch {
    // ignore json parse failure and fallback to status text
  }

  return { message: response.statusText || "Request failed" };
}

function normalizeCard(card: Card): Card {
  return {
    ...card,
    critique: typeof card.critique === "string" ? card.critique : undefined,
    textReviewed: typeof card.textReviewed === "boolean" ? card.textReviewed : undefined,
  };
}

function normalizeIsland(island: Island): Island {
  return {
    ...island,
    imageUrl: typeof island.imageUrl === "string" ? island.imageUrl : undefined,
    critique: typeof island.critique === "string" ? island.critique : undefined,
  };
}

function normalizeDocument(document: Document): Document {
  if (document.version !== 1) {
    return document;
  }

  return {
    ...document,
    cards: document.cards.map(normalizeCard),
    islands: document.islands.map(normalizeIsland),
  };
}

function normalizeEtag(rawEtag: string | null): string | undefined {
  if (!rawEtag) {
    return undefined;
  }

  let value = rawEtag.trim();
  if (value.startsWith("W/")) {
    value = value.slice(2).trim();
  }

  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }

  return value.length > 0 ? value : undefined;
}

/**
 * A CAS revision is an *exact* 64-character lowercase hex digest. JS '
  return etag === "*" ? etag : `"${etag}"`;
}

async function sha256Hex(value: string): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) {
    return undefined;
  }

  const encoded = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseDocumentResponse(responseBody: string): Document {
  return JSON.parse(responseBody) as Document;
}

async function parseTenantSessionResponse(response: Response): Promise<unknown> {
  const responseText = await readBoundedUtf8Response(
    response,
    MAX_TENANT_SESSION_RESPONSE_BYTES,
  );
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    throw new InvalidTenantSessionContextError();
  }
}

async function parseTenantSessionBootstrapPolicyResponse(
  response: Response,
): Promise<TenantSessionBootstrapPolicyV1> {
  try {
    const responseText = await readBoundedUtf8Response(
      response,
      MAX_TENANT_SESSION_BOOTSTRAP_POLICY_BYTES,
    );
    return parseTenantSessionBootstrapPolicy(JSON.parse(responseText) as unknown);
  } catch {
    throw new InvalidTenantSessionBootstrapPolicyError();
  }
}

export async function getTenantSessionBootstrapPolicy(
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<TenantSessionBootstrapPolicyV1> {
  const response = await fetch(`${API_BASE}/session/bootstrap-policy`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(
      response,
      MAX_TENANT_SESSION_BOOTSTRAP_POLICY_BYTES,
    );
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }

  return parseTenantSessionBootstrapPolicyResponse(response);
}

export async function getTenantSessionContext(
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<TenantSessionContextV1> {
  const response = await fetch(`${API_BASE}/session/context`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response, MAX_TENANT_SESSION_RESPONSE_BYTES);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }

  const responseBody = await parseTenantSessionResponse(response);
  return parseTenantSessionContext(responseBody);
}

export async function changeActiveTenant(
  currentSessionContext: TenantSessionContextV1,
  requestedTenantId: string,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<TenantSessionContextV1> {
  const currentSession = parseTenantSessionContext(currentSessionContext);
  const requestedTenant = currentSession.availableTenants.find(
    (tenant) => tenant.id === requestedTenantId,
  );
  if (!requestedTenant) {
    throw new InvalidTenantSessionContextError();
  }

  const response = await fetch(`${API_BASE}/session/active-tenant`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...csrfHeader(),
    },
    body: JSON.stringify({
      tenantId: requestedTenant.id,
      expectedTenantSessionVersion: currentSession.tenantSessionVersion,
    }),
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response, MAX_TENANT_SESSION_RESPONSE_BYTES);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }

  const nextSession = parseTenantSessionContext(
    await parseTenantSessionResponse(response),
  );
  if (
    nextSession.principalId !== currentSession.principalId
    || nextSession.activeTenant.id !== requestedTenant.id
    || nextSession.tenantSessionVersion === currentSession.tenantSessionVersion
  ) {
    throw new InvalidTenantSessionContextError();
  }
  return nextSession;
}

export type DocumentListItem = {
  id: string;
  title?: string;
  created_by?: string;
  lifecycle_state: string;
  updated_at: string;
};

/** GET /docs — the tenant's document metadata (第2反復 canvas-list foundation).
 * Row metadata only; fetch a specific document for SafeMode-scoped content.
 * `createdBy` filters to one creator ("my documents"). */
export async function listDocuments(
  options: TenantScopedRequestOptions = {},
  createdBy?: string,
): Promise<DocumentListItem[]> {
  const headers = tenantSessionPreconditionHeaders(options);
  const query = createdBy ? `?createdBy=${encodeURIComponent(createdBy)}` : "";
  const response = headers
    ? await fetch(`${API_BASE}/docs${query}`, { headers })
    : await fetch(`${API_BASE}/docs${query}`);

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as DocumentListItem[];
  if (!Array.isArray(body)) {
    throw new ApiError(500, "Invalid document list response shape");
  }
  return body;
}

export async function getDocument(
  docId: string,
  options: TenantScopedRequestOptions = {},
): Promise<DocumentWithEtag<Document>> {
  const headers = tenantSessionPreconditionHeaders(options);
  const response = await fetch(`${API_BASE}/docs/${docId}`, { headers });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  return {
    document: normalizeDocument(parseDocumentResponse(await response.text())),
    etag: normalizeEtag(response.headers.get("ETag")),
  };
}

/** Action confirmation must bypass browser caches to compare the saved ETag. */
export async function getAuthoritativeDocument(
  docId: string,
  options: TenantScopedRequestOptions = {},
): Promise<DocumentWithEtag<Document>> {
  const headers = tenantSessionPreconditionHeaders(options);
  const response = await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}`, {
    headers,
    cache: "no-store",
    mode: "same-origin",
    credentials: "same-origin",
    redirect: "error",
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  // Conditional Action commits require a strong server-issued revision.
  // The ordinary document GET deliberately tolerates weak/legacy ETags,
  // but a weak validator is never safe evidence of an exact CAS revision.
  const etagHeader = response.headers.get("ETag");
  const strongRevision = etagHeader?.startsWith('"') && etagHeader.endsWith('"') &&
    etagHeader.length === 66 ? etagHeader.slice(1, -1) : null;
  if (!isStrongSuiRevision(strongRevision)) {
    throw new ApiError(response.status, "invalid_authoritative_etag", {
      code: "invalid_authoritative_etag",
    });
  }
  return {
    document: normalizeDocument(parseDocumentResponse(await response.text())),
    etag: strongRevision,
  };
}

/**
 * SUI-owned endpoint implementing the TEI v1 Action envelope. This is not the
 * standalone Go TEI runtime Host. Server-side authorization and ETag CAS are
 * mandatory; a network failure is ambiguous and must never auto-retry.
 */
export async function commitSuiCardMoveAction(
  intent: ResourceActionIntentV1,
  options: TenantScopedRequestOptions = {},
): Promise<string> {
  if (!intent || intent.protocolVersion !== "1" || intent.applicationID !== "sui" ||
      intent.actionID !== "sui.move" ||
      !intent.resourceID || !isStrongSuiRevision(intent.expectedRevision) ||
      typeof intent.payload?.cardId !== "string" || !intent.payload.cardId ||
      !Number.isFinite(intent.payload.x) || !Number.isFinite(intent.payload.y)) {
    throw new TypeError("invalid SUI Action intent");
  }
  const response = await fetch(
    `${API_BASE}/docs/${encodeURIComponent(intent.resourceID)}/action-commit`,
    {
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-TEI-Action": "commit",
        ...tenantSessionPreconditionHeaders(options),
      },
      body: JSON.stringify(intent),
    },
  );

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(response.status, "invalid_action_response", { code: "invalid_action_response" });
  }
  const obj = result as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object" || Array.isArray(obj) ||
      obj.protocolVersion !== "1" ||
      Object.keys(obj).some((key) => !["protocolVersion", "revision", "error"].includes(key))) {
    throw new ApiError(response.status, "invalid_action_response", { code: "invalid_action_response" });
  }
  if (!response.ok) {
    if ("revision" in obj || typeof obj.error !== "string" ||
        !/^[a-z][a-z0-9_]*$/.test(obj.error)) {
      throw new ApiError(response.status, "invalid_action_response", { code: "invalid_action_response" });
    }
    throw new ApiError(response.status, obj.error, { code: obj.error });
  }
  if (response.status !== 200 || "error" in obj ||
      !isStrongSuiRevision(obj.revision)) {
    throw new ApiError(response.status, "invalid_action_response", { code: "invalid_action_response" });
  }
  return obj.revision;
}

export async function putDocument(
  docId: string,
  document: DocumentV1,
  ifMatch?: string,
  options: TenantScopedRequestOptions = {},
): Promise<DocumentWithEtag<DocumentV1>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...tenantSessionPreconditionHeaders(options),
  };
  if (ifMatch) {
    headers["If-Match"] = formatIfMatchHeader(ifMatch);
  } else if (options.tenantSessionContext !== undefined) {
    // ADR-0092: the shared SaaS profile accepts a revision-less PUT only as a
    // create, which must never overwrite an existing document.
    headers["If-None-Match"] = "*";
  }

  const response = await fetch(`${API_BASE}/docs/${docId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(document),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const responseBody = await response.text();
  const normalizedDocument = normalizeDocument(parseDocumentResponse(responseBody));

  if (normalizedDocument.version !== 1) {
    throw new ApiError(500, "Unexpected document version in update response");
  }

  return {
    document: normalizedDocument,
    etag: normalizeEtag(response.headers.get("ETag")) ?? (await sha256Hex(responseBody)),
  };
}

export type ProviderKind = "none" | "local" | "large-scale" | "deepseek";

/** OPS-LLM-COST-02/01: the provider-status snapshot (kind + in-process LLM call
 * counts and token usage per provider kind plus "total"). Empty until the
 * first LLM call. */
export type ProviderStatusSnapshot = {
  providerKind: ProviderKind;
  callCounts: Record<string, number>;
  tokenUsage: Record<string, { input: number; output: number }>;
  tokenUsageCoverage: Record<string, {
    completeCalls: number;
    partialCalls: number;
    missingCalls: number;
  }>;
  tokenUsageSource: "provider_reported_only";
  tokenUsageAggregationScope: "current_process_by_provider_kind";
};

/**
 * PROV-VIS-01 (ADR-0050 D1): read-only echo of the configured LLM provider.
 * This is a static config echo, not a connectivity check. OPS-LLM-COST-02
 * carries the in-process LLM call counts through so an operator can see call
 * volume (especially external / large-scale) in the UI.
 */
export async function getProviderStatus(): Promise<ProviderStatusSnapshot> {
  const response = await fetch(`${API_BASE}/ai/provider-status`);

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as ProviderStatusSnapshot;
  return {
    providerKind: body.providerKind,
    callCounts: body.callCounts ?? {},
    tokenUsage: body.tokenUsage ?? {},
    tokenUsageCoverage: body.tokenUsageCoverage,
    tokenUsageSource: body.tokenUsageSource,
    tokenUsageAggregationScope: body.tokenUsageAggregationScope,
  };
}

export type SuggestLayoutResult = {
  suggestionId: string;
  suggestedDoc: DocumentV1;
  notes?: string;
};

export async function suggestLayout(
  doc: DocumentV1,
  instruction?: string,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<SuggestLayoutResult> {
  const response = await fetch(`${API_BASE}/ai/suggest-layout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, instruction }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as {
    suggestionId: string;
    suggestedDoc: Document;
    notes?: string;
  };

  const suggestedDoc = normalizeDocument(body.suggestedDoc);
  if (suggestedDoc.version !== 1) {
    throw new ApiError(500, "Unexpected document version in suggestion response");
  }

  return {
    suggestionId: body.suggestionId,
    suggestedDoc,
    notes: body.notes,
  };
}


export type MergeSuggestion = {
  groupId: string;
  cardIds: string[];
  mergedTextDraft: string;
  mergeMethod: MergeMethod;
  rationale?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

function isMergeSuggestion(value: unknown): value is MergeSuggestion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const suggestion = value as Partial<MergeSuggestion>;
  return (
    isNonEmptyString(suggestion.groupId)
    && isStringArray(suggestion.cardIds)
    && suggestion.cardIds.length >= 2
    && isNonEmptyString(suggestion.mergedTextDraft)
    && isMergeMethod(suggestion.mergeMethod)
    && (suggestion.rationale === undefined || isNonEmptyString(suggestion.rationale))
  );
}

export async function suggestMerges(
  doc: DocumentV1,
  instruction?: string,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{ suggestions: MergeSuggestion[] }> {
  const response = await fetch(`${API_BASE}/ai/suggest-merges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, instruction }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as { suggestions?: MergeSuggestion[] };
  if (!Array.isArray(body.suggestions)) {
    throw new ApiError(500, "Invalid merge suggestions response");
  }

  if (!body.suggestions.every((suggestion) => isMergeSuggestion(suggestion))) {
    throw new ApiError(500, "Invalid merge suggestions contract payload");
  }

  return { suggestions: body.suggestions };
}


export type IslandSummaryProposal = {
  proposalId: string;
  type: "island_summary";
  status: "proposed";
  sourceBundleHash: string;
  diff: {
    entityType: "island_summary";
    targetId: string;
    field: "summaryText";
    before?: string;
    after: string;
    groundingIds: string[];
    warnings?: string[];
    candidates?: { summaryText: string; groundingIds: string[] }[];
  };
  rationale: string;
};

export type DocumentTitleCandidate = {
  title: string;
};

export type SuggestDocumentTitleResponse = {
  candidates: DocumentTitleCandidate[];
};

// AI-MODEL-GOVERNANCE-01 (R2): the models the current tenant is allowed to use,
// for the per-operation model selector. Never includes disabled models.
export type AvailableModelItem = {
  id: string;
  displayName: string;
  providerId: string;
  capabilities?: string | null;
};

export type AvailableModelUnavailableReason =
  | "no_active_models"
  | "provider_unavailable"
  | "tenant_policy_excludes_all"
  | "no_user_selectable_models";

export type AvailableModelsResponse = {
  models: AvailableModelItem[];
  unavailableReason?: AvailableModelUnavailableReason | null;
};

export async function fetchAvailableModels(
  requestOptions: TenantScopedRequestOptions = {},
): Promise<AvailableModelsResponse> {
  const response = await fetch(`${API_BASE}/ai/available-models`, {
    headers: {
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }
  return (await response.json()) as AvailableModelsResponse;
}

/**
 * 文書の全カードが人間レビュー済み（textReviewed === true）かを返す。
 * 未レビューのカードが1つでもあれば false。文書が読み込まれていない（undefined）
 * 場合も false にして、申告が誤って true になる経路を作らない。
 */
function allDocumentCardsReviewed(
  documentCards: ReadonlyArray<Pick<Card, "textReviewed">> | undefined,
): boolean {
  return documentCards !== undefined && documentCards.every((card) => card.textReviewed === true);
}

export async function suggestDocumentTitle(
  islandTitles: string[],
  cardTexts: string[],
  currentTitle: string | undefined,
  model: string | undefined,
  documentCards: ReadonlyArray<Pick<Card, "textReviewed">> | undefined,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<SuggestDocumentTitleResponse> {
  const response = await fetch(`${API_BASE}/ai/suggest-document-title`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({
      islandTitles,
      cardTexts,
      currentTitle: currentTitle ?? null,
      // The review declaration is derived from the document's real card state,
      // never a constant. The backend defaults this field to false and rejects
      // any request whose declaration is not true with 422
      // (unreviewed_text_not_allowed) before any provider call.
      textReviewed: allDocumentCardsReviewed(documentCards),
      model: model ?? null,
    }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }

  const body = (await response.json()) as SuggestDocumentTitleResponse;
  if (!body.candidates || body.candidates.length === 0) {
    throw new ApiError(500, "No title candidates returned");
  }
  return body;
}

export async function proposeIslandSummary(
  doc: DocumentV1,
  islandId: string,
  sourceBundleHash: string,
  model: string | undefined,
  requestOptions: TenantScopedRequestOptions = {},
  critiqueText?: string,
): Promise<IslandSummaryProposal> {
  const response = await fetch(`${API_BASE}/ai/proposals/island-summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, islandId, sourceBundleHash, model: model ?? null, critiqueText: critiqueText ?? null }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  return (await response.json()) as IslandSummaryProposal;
}

// AI-OPPOSE-01 (M4): proposal-only opposing-viewpoint / evidence-gap
// observation for a target card, grounded in the doc's contradiction/evidence
// structure. Never auto-applied (status stays "proposed").
export type OpposingViewpointProposal = {
  proposalId: string;
  type: "opposing_viewpoint";
  status: "proposed";
  reviewState: "unreviewed";
  targetCardId: string;
  opposingText: string;
  evidenceGap: boolean;
  rationale: string;
  warnings: string[];
};

export async function proposeOpposingViewpoint(
  doc: DocumentV1,
  targetCardId: string,
  model: string | undefined,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<OpposingViewpointProposal> {
  const response = await fetch(`${API_BASE}/ai/proposals/opposing-viewpoint`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, targetCardId, model: model ?? null }),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }
  return (await response.json()) as OpposingViewpointProposal;
}

export async function recordProposalDecision(
  input: {
    docId: string;
    proposalId: string;
    sourceBundleHash: string;
    idempotencyKey: string;
    decision: "adopt" | "reject" | "hold";
    reason?: string;
  },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{
  recorded: true;
  eventId: string;
  proposalId: string;
  status: "accepted" | "rejected" | "held";
  reviewState: "unreviewed";
  recordedAt: string;
}> {
  const response = await fetch(`${API_BASE}/ai/proposals/audit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return await response.json();
}

export async function registerExternalAgentProposal(
  input: {
    docId: string;
    taskId: string;
    baseDocSignature: string;
    sourceBundleHash: string;
    queryCanonicalHash: string;
    proposalId: string;
    proposalKind: string;
    proposalFingerprint: string;
    provenanceLevel: "user_presented_unsigned";
  },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{ registered: true; proposalId: string; provenanceLevel: "user_presented_unsigned" }> {
  const response = await fetch(`${API_BASE}/ai/external-proposals/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tenantSessionPreconditionHeaders(requestOptions) },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return await response.json();
}

export async function registerExternalAgentTask(
  input: {
    docId: string;
    taskId: string;
    baseDocSignature: string;
    sourceBundleHash: string;
    queryCanonicalHash: string;
    taskKind: string;
    provenanceLevel: "user_presented_unsigned";
  },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{ registered: true; taskId: string; provenanceLevel: "user_presented_unsigned" }> {
  const response = await fetch(`${API_BASE}/ai/external-tasks/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tenantSessionPreconditionHeaders(requestOptions) },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return await response.json();
}

export async function recordExternalAgentProposalDecision(
  input: {
    docId: string;
    proposalId: string;
    sourceBundleHash: string;
    idempotencyKey: string;
    decision: "adopt" | "reject" | "hold";
    provenanceLevel: "user_presented_unsigned";
  },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{
  recorded: true;
  eventId: string;
  proposalId: string;
  status: "accepted" | "rejected" | "held";
  reviewState: "unreviewed";
  recordedAt: string;
}> {
  const response = await fetch(`${API_BASE}/ai/external-proposals/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tenantSessionPreconditionHeaders(requestOptions) },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return await response.json();
}

// EXT-AGENT-01 (ADR-0049 D2, spec §3.4): the only frontend caller of
// /docs/{docId}/export-audit today. Fail-open on the backend (audit send
// failure never blocks the export itself) -- but a network/HTTP error here
// still surfaces to the caller so the UI can fall back to a status message
// rather than silently pretending the audit call succeeded.
// exportId (SEC-AUDIT-DUP-01): one id per export action. The backend suppresses
// only a repeat of the same id, so the caller passes a fresh id per export and
// reuses it only when resending that same export.
export async function postExportAudit(
  docId: string,
  options: { safeMode: boolean; exportKind: string; exportId: string },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<void> {
  const response = await fetch(`${API_BASE}/docs/${docId}/export-audit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({
      safeMode: options.safeMode,
      exportKind: options.exportKind,
      exportId: options.exportId,
    }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
}

export type SummarizeIslandRelationPayload = {
  doc: DocumentV1;
  islandAId: string;
  islandBId: string;
  relationType: KnownEdgeType | "unknown";
  derived: boolean;
  groundingCardIds: string[];
  groundingEdgeIds: string[];
  edgeTexts?: { edgeId: string; type: string; from: string; to: string }[];
  cardTexts: { id: string; text: string }[];
};

export type SummarizeIslandRelationResult = {
  text: string;
  groundingCardIds: string[];
  groundingEdgeIds: string[];
  warnings: string[];
};

export async function summarizeIslandRelation(
  payload: SummarizeIslandRelationPayload,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<SummarizeIslandRelationResult> {
  const response = await fetch(`${API_BASE}/ai/summarize-island-relation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as SummarizeIslandRelationResult;
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    throw new ApiError(500, "Invalid relation summary text");
  }

  if (!Array.isArray(body.groundingCardIds) || !Array.isArray(body.groundingEdgeIds) || !Array.isArray(body.warnings)) {
    throw new ApiError(500, "Invalid relation summary response shape");
  }

  return body;
}

export type NarrativeIssueReference = {
  id: string;
  kind: "card" | "island";
};

export type NarrativeIssue = {
  severity: "info" | "warn" | "error";
  message: string;
  references?: NarrativeIssueReference[];
  direction?: "b_missing_in_a" | "a_missing_in_b";
};

export type NarrativeCheckCounts = {
  bMissingInA: number;
  aMissingInB: number;
};

export async function checkNarrative(
  doc: DocumentV1,
  narrativeText: string,
  basedOnReadingOrder?: string[],
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{ issues: NarrativeIssue[]; counts?: NarrativeCheckCounts }> {
  const response = await fetch(`${API_BASE}/ai/check-narrative`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, narrativeText, basedOnReadingOrder }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as { issues?: NarrativeIssue[]; counts?: NarrativeCheckCounts };
  if (!Array.isArray(body.issues)) {
    throw new ApiError(500, "Invalid narrative consistency response");
  }

  return { issues: body.issues, ...(body.counts ? { counts: body.counts } : {}) };
}


export type GenerateNarrativeResult = {
  text: string;
  basedOnReadingOrder: string[];
  warnings?: string[];
};

export async function generateNarrative(
  doc: DocumentV1,
  narrativeTitle?: string,
  model?: string,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<GenerateNarrativeResult> {
  const response = await fetch(`${API_BASE}/ai/generate-narrative`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, narrativeTitle, model: model ?? null }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as GenerateNarrativeResult;
  if (typeof body.text !== "string" || !Array.isArray(body.basedOnReadingOrder)) {
    throw new ApiError(500, "Invalid narrative generation response");
  }

  if (body.warnings !== undefined && !Array.isArray(body.warnings)) {
    throw new ApiError(500, "Invalid narrative generation warnings");
  }

  return body;
}

export type InquiryBundleWithEtag = {
  payload: unknown;
  etag?: string;
};

/**
 * DATA-INQUIRY-CONCURRENCY-01 (案A): update/delete carry a single server-owned
 * revision (If-Match); create carries `If-None-Match: *`. The server returns a
 * 428 when the precondition is absent and a 409 when it is stale or the row is
 * missing. The caller must surface a 409 as a conflict — never auto-retry or
 * auto-merge into the newer bundle (AC-6).
 */
export type InquiryBundlePrecondition = {
  etag?: string;
  createIfAbsent?: boolean;
};

export async function putInquiryBundle(
  journeyId: string,
  payload: unknown,
  options: TenantScopedRequestOptions = {},
  precondition?: InquiryBundlePrecondition,
): Promise<string | undefined> {
  // G5 (W型 single-tenant 化): store an opaque W型 inquiry journey. The backend
  // treats the body as an opaque JSON value; the frontend owns the schema.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...tenantSessionPreconditionHeaders(options),
  };
  if (precondition?.createIfAbsent) {
    headers["If-None-Match"] = "*";
  } else if (precondition?.etag) {
    headers["If-Match"] = formatIfMatchHeader(precondition.etag);
  }
  const response = await fetch(`${API_BASE}/inquiry-bundles/${encodeURIComponent(journeyId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return normalizeEtag(response.headers.get("ETag"));
}

export async function getInquiryBundle(
  journeyId: string,
  options: TenantScopedRequestOptions = {},
): Promise<InquiryBundleWithEtag> {
  const response = await fetch(`${API_BASE}/inquiry-bundles/${encodeURIComponent(journeyId)}`, {
    headers: tenantSessionPreconditionHeaders(options),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return {
    payload: (await response.json()) as unknown,
    etag: normalizeEtag(response.headers.get("ETag")),
  };
}

export async function deleteInquiryBundle(
  journeyId: string,
  etag: string,
  options: TenantScopedRequestOptions = {},
): Promise<void> {
  const headers: Record<string, string> = {
    ...tenantSessionPreconditionHeaders(options),
  };
  headers["If-Match"] = formatIfMatchHeader(etag);
  const response = await fetch(`${API_BASE}/inquiry-bundles/${encodeURIComponent(journeyId)}`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
}

/** POST /docs/{id}/archive — set lifecycle_state to archived (ADR-0073 D2=A). */
export async function archiveDocument(
  docId: string,
  options: TenantScopedRequestOptions = {},
): Promise<void> {
  const headers = tenantSessionPreconditionHeaders(options);
  const response = headers
    ? await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}/archive`, { method: "POST", headers })
    : await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}/archive`, { method: "POST" });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
}

/** POST /docs/{id}/unarchive — set lifecycle_state to active (ADR-0073 D2=A). */
export async function unarchiveDocument(
  docId: string,
  options: TenantScopedRequestOptions = {},
): Promise<void> {
  const headers = tenantSessionPreconditionHeaders(options);
  const response = headers
    ? await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}/unarchive`, { method: "POST", headers })
    : await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}/unarchive`, { method: "POST" });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
}

 * accepts a position before a final newline, so length must be checked
 * separately from the character pattern.
 */
function isStrongSuiRevision(value: unknown): value is string {
  return typeof value === "string" &&
    value.length === 64 &&
    /^[0-9a-f]+$/.test(value);
}

function formatIfMatchHeader(etag: string): string {
  return etag === "*" ? etag : `"${etag}"`;
}

async function sha256Hex(value: string): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) {
    return undefined;
  }

  const encoded = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseDocumentResponse(responseBody: string): Document {
  return JSON.parse(responseBody) as Document;
}

async function parseTenantSessionResponse(response: Response): Promise<unknown> {
  const responseText = await readBoundedUtf8Response(
    response,
    MAX_TENANT_SESSION_RESPONSE_BYTES,
  );
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    throw new InvalidTenantSessionContextError();
  }
}

async function parseTenantSessionBootstrapPolicyResponse(
  response: Response,
): Promise<TenantSessionBootstrapPolicyV1> {
  try {
    const responseText = await readBoundedUtf8Response(
      response,
      MAX_TENANT_SESSION_BOOTSTRAP_POLICY_BYTES,
    );
    return parseTenantSessionBootstrapPolicy(JSON.parse(responseText) as unknown);
  } catch {
    throw new InvalidTenantSessionBootstrapPolicyError();
  }
}

export async function getTenantSessionBootstrapPolicy(
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<TenantSessionBootstrapPolicyV1> {
  const response = await fetch(`${API_BASE}/session/bootstrap-policy`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(
      response,
      MAX_TENANT_SESSION_BOOTSTRAP_POLICY_BYTES,
    );
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }

  return parseTenantSessionBootstrapPolicyResponse(response);
}

export async function getTenantSessionContext(
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<TenantSessionContextV1> {
  const response = await fetch(`${API_BASE}/session/context`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response, MAX_TENANT_SESSION_RESPONSE_BYTES);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }

  const responseBody = await parseTenantSessionResponse(response);
  return parseTenantSessionContext(responseBody);
}

export async function changeActiveTenant(
  currentSessionContext: TenantSessionContextV1,
  requestedTenantId: string,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<TenantSessionContextV1> {
  const currentSession = parseTenantSessionContext(currentSessionContext);
  const requestedTenant = currentSession.availableTenants.find(
    (tenant) => tenant.id === requestedTenantId,
  );
  if (!requestedTenant) {
    throw new InvalidTenantSessionContextError();
  }

  const response = await fetch(`${API_BASE}/session/active-tenant`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...csrfHeader(),
    },
    body: JSON.stringify({
      tenantId: requestedTenant.id,
      expectedTenantSessionVersion: currentSession.tenantSessionVersion,
    }),
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response, MAX_TENANT_SESSION_RESPONSE_BYTES);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }

  const nextSession = parseTenantSessionContext(
    await parseTenantSessionResponse(response),
  );
  if (
    nextSession.principalId !== currentSession.principalId
    || nextSession.activeTenant.id !== requestedTenant.id
    || nextSession.tenantSessionVersion === currentSession.tenantSessionVersion
  ) {
    throw new InvalidTenantSessionContextError();
  }
  return nextSession;
}

export type DocumentListItem = {
  id: string;
  title?: string;
  created_by?: string;
  lifecycle_state: string;
  updated_at: string;
};

/** GET /docs — the tenant's document metadata (第2反復 canvas-list foundation).
 * Row metadata only; fetch a specific document for SafeMode-scoped content.
 * `createdBy` filters to one creator ("my documents"). */
export async function listDocuments(
  options: TenantScopedRequestOptions = {},
  createdBy?: string,
): Promise<DocumentListItem[]> {
  const headers = tenantSessionPreconditionHeaders(options);
  const query = createdBy ? `?createdBy=${encodeURIComponent(createdBy)}` : "";
  const response = headers
    ? await fetch(`${API_BASE}/docs${query}`, { headers })
    : await fetch(`${API_BASE}/docs${query}`);

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as DocumentListItem[];
  if (!Array.isArray(body)) {
    throw new ApiError(500, "Invalid document list response shape");
  }
  return body;
}

export async function getDocument(
  docId: string,
  options: TenantScopedRequestOptions = {},
): Promise<DocumentWithEtag<Document>> {
  const headers = tenantSessionPreconditionHeaders(options);
  const response = await fetch(`${API_BASE}/docs/${docId}`, { headers });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  return {
    document: normalizeDocument(parseDocumentResponse(await response.text())),
    etag: normalizeEtag(response.headers.get("ETag")),
  };
}

/** Action confirmation must bypass browser caches to compare the saved ETag. */
export async function getAuthoritativeDocument(
  docId: string,
  options: TenantScopedRequestOptions = {},
): Promise<DocumentWithEtag<Document>> {
  const headers = tenantSessionPreconditionHeaders(options);
  const response = await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}`, {
    headers,
    cache: "no-store",
    mode: "same-origin",
    credentials: "same-origin",
    redirect: "error",
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  // Conditional Action commits require a strong server-issued revision.
  // The ordinary document GET deliberately tolerates weak/legacy ETags,
  // but a weak validator is never safe evidence of an exact CAS revision.
  const etagHeader = response.headers.get("ETag");
  const strongMatch = etagHeader?.match(/^"([0-9a-f]{64})"$/);
  if (!strongMatch) {
    throw new ApiError(response.status, "invalid_authoritative_etag", {
      code: "invalid_authoritative_etag",
    });
  }
  return {
    document: normalizeDocument(parseDocumentResponse(await response.text())),
    etag: strongMatch[1],
  };
}

/**
 * SUI-owned endpoint implementing the TEI v1 Action envelope. This is not the
 * standalone Go TEI runtime Host. Server-side authorization and ETag CAS are
 * mandatory; a network failure is ambiguous and must never auto-retry.
 */
export async function commitSuiCardMoveAction(
  intent: ResourceActionIntentV1,
  options: TenantScopedRequestOptions = {},
): Promise<string> {
  if (!intent || intent.protocolVersion !== "1" || intent.applicationID !== "sui" ||
      intent.actionID !== "sui.move" ||
      !intent.resourceID || !/^[0-9a-f]{64}$/.test(intent.expectedRevision) ||
      typeof intent.payload?.cardId !== "string" || !intent.payload.cardId ||
      !Number.isFinite(intent.payload.x) || !Number.isFinite(intent.payload.y)) {
    throw new TypeError("invalid SUI Action intent");
  }
  const response = await fetch(
    `${API_BASE}/docs/${encodeURIComponent(intent.resourceID)}/action-commit`,
    {
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-TEI-Action": "commit",
        ...tenantSessionPreconditionHeaders(options),
      },
      body: JSON.stringify(intent),
    },
  );

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(response.status, "invalid_action_response", { code: "invalid_action_response" });
  }
  const obj = result as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object" || Array.isArray(obj) ||
      obj.protocolVersion !== "1" ||
      Object.keys(obj).some((key) => !["protocolVersion", "revision", "error"].includes(key))) {
    throw new ApiError(response.status, "invalid_action_response", { code: "invalid_action_response" });
  }
  if (!response.ok) {
    if ("revision" in obj || typeof obj.error !== "string" ||
        !/^[a-z][a-z0-9_]*$/.test(obj.error)) {
      throw new ApiError(response.status, "invalid_action_response", { code: "invalid_action_response" });
    }
    throw new ApiError(response.status, obj.error, { code: obj.error });
  }
  if (response.status !== 200 || "error" in obj ||
      typeof obj.revision !== "string" || !/^[0-9a-f]{64}$/.test(obj.revision)) {
    throw new ApiError(response.status, "invalid_action_response", { code: "invalid_action_response" });
  }
  return obj.revision;
}

export async function putDocument(
  docId: string,
  document: DocumentV1,
  ifMatch?: string,
  options: TenantScopedRequestOptions = {},
): Promise<DocumentWithEtag<DocumentV1>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...tenantSessionPreconditionHeaders(options),
  };
  if (ifMatch) {
    headers["If-Match"] = formatIfMatchHeader(ifMatch);
  } else if (options.tenantSessionContext !== undefined) {
    // ADR-0092: the shared SaaS profile accepts a revision-less PUT only as a
    // create, which must never overwrite an existing document.
    headers["If-None-Match"] = "*";
  }

  const response = await fetch(`${API_BASE}/docs/${docId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(document),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const responseBody = await response.text();
  const normalizedDocument = normalizeDocument(parseDocumentResponse(responseBody));

  if (normalizedDocument.version !== 1) {
    throw new ApiError(500, "Unexpected document version in update response");
  }

  return {
    document: normalizedDocument,
    etag: normalizeEtag(response.headers.get("ETag")) ?? (await sha256Hex(responseBody)),
  };
}

export type ProviderKind = "none" | "local" | "large-scale" | "deepseek";

/** OPS-LLM-COST-02/01: the provider-status snapshot (kind + in-process LLM call
 * counts and token usage per provider kind plus "total"). Empty until the
 * first LLM call. */
export type ProviderStatusSnapshot = {
  providerKind: ProviderKind;
  callCounts: Record<string, number>;
  tokenUsage: Record<string, { input: number; output: number }>;
  tokenUsageCoverage: Record<string, {
    completeCalls: number;
    partialCalls: number;
    missingCalls: number;
  }>;
  tokenUsageSource: "provider_reported_only";
  tokenUsageAggregationScope: "current_process_by_provider_kind";
};

/**
 * PROV-VIS-01 (ADR-0050 D1): read-only echo of the configured LLM provider.
 * This is a static config echo, not a connectivity check. OPS-LLM-COST-02
 * carries the in-process LLM call counts through so an operator can see call
 * volume (especially external / large-scale) in the UI.
 */
export async function getProviderStatus(): Promise<ProviderStatusSnapshot> {
  const response = await fetch(`${API_BASE}/ai/provider-status`);

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as ProviderStatusSnapshot;
  return {
    providerKind: body.providerKind,
    callCounts: body.callCounts ?? {},
    tokenUsage: body.tokenUsage ?? {},
    tokenUsageCoverage: body.tokenUsageCoverage,
    tokenUsageSource: body.tokenUsageSource,
    tokenUsageAggregationScope: body.tokenUsageAggregationScope,
  };
}

export type SuggestLayoutResult = {
  suggestionId: string;
  suggestedDoc: DocumentV1;
  notes?: string;
};

export async function suggestLayout(
  doc: DocumentV1,
  instruction?: string,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<SuggestLayoutResult> {
  const response = await fetch(`${API_BASE}/ai/suggest-layout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, instruction }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as {
    suggestionId: string;
    suggestedDoc: Document;
    notes?: string;
  };

  const suggestedDoc = normalizeDocument(body.suggestedDoc);
  if (suggestedDoc.version !== 1) {
    throw new ApiError(500, "Unexpected document version in suggestion response");
  }

  return {
    suggestionId: body.suggestionId,
    suggestedDoc,
    notes: body.notes,
  };
}


export type MergeSuggestion = {
  groupId: string;
  cardIds: string[];
  mergedTextDraft: string;
  mergeMethod: MergeMethod;
  rationale?: string;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

function isMergeSuggestion(value: unknown): value is MergeSuggestion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const suggestion = value as Partial<MergeSuggestion>;
  return (
    isNonEmptyString(suggestion.groupId)
    && isStringArray(suggestion.cardIds)
    && suggestion.cardIds.length >= 2
    && isNonEmptyString(suggestion.mergedTextDraft)
    && isMergeMethod(suggestion.mergeMethod)
    && (suggestion.rationale === undefined || isNonEmptyString(suggestion.rationale))
  );
}

export async function suggestMerges(
  doc: DocumentV1,
  instruction?: string,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{ suggestions: MergeSuggestion[] }> {
  const response = await fetch(`${API_BASE}/ai/suggest-merges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, instruction }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as { suggestions?: MergeSuggestion[] };
  if (!Array.isArray(body.suggestions)) {
    throw new ApiError(500, "Invalid merge suggestions response");
  }

  if (!body.suggestions.every((suggestion) => isMergeSuggestion(suggestion))) {
    throw new ApiError(500, "Invalid merge suggestions contract payload");
  }

  return { suggestions: body.suggestions };
}


export type IslandSummaryProposal = {
  proposalId: string;
  type: "island_summary";
  status: "proposed";
  sourceBundleHash: string;
  diff: {
    entityType: "island_summary";
    targetId: string;
    field: "summaryText";
    before?: string;
    after: string;
    groundingIds: string[];
    warnings?: string[];
    candidates?: { summaryText: string; groundingIds: string[] }[];
  };
  rationale: string;
};

export type DocumentTitleCandidate = {
  title: string;
};

export type SuggestDocumentTitleResponse = {
  candidates: DocumentTitleCandidate[];
};

// AI-MODEL-GOVERNANCE-01 (R2): the models the current tenant is allowed to use,
// for the per-operation model selector. Never includes disabled models.
export type AvailableModelItem = {
  id: string;
  displayName: string;
  providerId: string;
  capabilities?: string | null;
};

export type AvailableModelUnavailableReason =
  | "no_active_models"
  | "provider_unavailable"
  | "tenant_policy_excludes_all"
  | "no_user_selectable_models";

export type AvailableModelsResponse = {
  models: AvailableModelItem[];
  unavailableReason?: AvailableModelUnavailableReason | null;
};

export async function fetchAvailableModels(
  requestOptions: TenantScopedRequestOptions = {},
): Promise<AvailableModelsResponse> {
  const response = await fetch(`${API_BASE}/ai/available-models`, {
    headers: {
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }
  return (await response.json()) as AvailableModelsResponse;
}

/**
 * 文書の全カードが人間レビュー済み（textReviewed === true）かを返す。
 * 未レビューのカードが1つでもあれば false。文書が読み込まれていない（undefined）
 * 場合も false にして、申告が誤って true になる経路を作らない。
 */
function allDocumentCardsReviewed(
  documentCards: ReadonlyArray<Pick<Card, "textReviewed">> | undefined,
): boolean {
  return documentCards !== undefined && documentCards.every((card) => card.textReviewed === true);
}

export async function suggestDocumentTitle(
  islandTitles: string[],
  cardTexts: string[],
  currentTitle: string | undefined,
  model: string | undefined,
  documentCards: ReadonlyArray<Pick<Card, "textReviewed">> | undefined,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<SuggestDocumentTitleResponse> {
  const response = await fetch(`${API_BASE}/ai/suggest-document-title`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({
      islandTitles,
      cardTexts,
      currentTitle: currentTitle ?? null,
      // The review declaration is derived from the document's real card state,
      // never a constant. The backend defaults this field to false and rejects
      // any request whose declaration is not true with 422
      // (unreviewed_text_not_allowed) before any provider call.
      textReviewed: allDocumentCardsReviewed(documentCards),
      model: model ?? null,
    }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }

  const body = (await response.json()) as SuggestDocumentTitleResponse;
  if (!body.candidates || body.candidates.length === 0) {
    throw new ApiError(500, "No title candidates returned");
  }
  return body;
}

export async function proposeIslandSummary(
  doc: DocumentV1,
  islandId: string,
  sourceBundleHash: string,
  model: string | undefined,
  requestOptions: TenantScopedRequestOptions = {},
  critiqueText?: string,
): Promise<IslandSummaryProposal> {
  const response = await fetch(`${API_BASE}/ai/proposals/island-summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, islandId, sourceBundleHash, model: model ?? null, critiqueText: critiqueText ?? null }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  return (await response.json()) as IslandSummaryProposal;
}

// AI-OPPOSE-01 (M4): proposal-only opposing-viewpoint / evidence-gap
// observation for a target card, grounded in the doc's contradiction/evidence
// structure. Never auto-applied (status stays "proposed").
export type OpposingViewpointProposal = {
  proposalId: string;
  type: "opposing_viewpoint";
  status: "proposed";
  reviewState: "unreviewed";
  targetCardId: string;
  opposingText: string;
  evidenceGap: boolean;
  rationale: string;
  warnings: string[];
};

export async function proposeOpposingViewpoint(
  doc: DocumentV1,
  targetCardId: string,
  model: string | undefined,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<OpposingViewpointProposal> {
  const response = await fetch(`${API_BASE}/ai/proposals/opposing-viewpoint`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, targetCardId, model: model ?? null }),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, {
      code: errorDetail.code,
      disabledReason: errorDetail.disabledReason,
    });
  }
  return (await response.json()) as OpposingViewpointProposal;
}

export async function recordProposalDecision(
  input: {
    docId: string;
    proposalId: string;
    sourceBundleHash: string;
    idempotencyKey: string;
    decision: "adopt" | "reject" | "hold";
    reason?: string;
  },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{
  recorded: true;
  eventId: string;
  proposalId: string;
  status: "accepted" | "rejected" | "held";
  reviewState: "unreviewed";
  recordedAt: string;
}> {
  const response = await fetch(`${API_BASE}/ai/proposals/audit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return await response.json();
}

export async function registerExternalAgentProposal(
  input: {
    docId: string;
    taskId: string;
    baseDocSignature: string;
    sourceBundleHash: string;
    queryCanonicalHash: string;
    proposalId: string;
    proposalKind: string;
    proposalFingerprint: string;
    provenanceLevel: "user_presented_unsigned";
  },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{ registered: true; proposalId: string; provenanceLevel: "user_presented_unsigned" }> {
  const response = await fetch(`${API_BASE}/ai/external-proposals/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tenantSessionPreconditionHeaders(requestOptions) },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return await response.json();
}

export async function registerExternalAgentTask(
  input: {
    docId: string;
    taskId: string;
    baseDocSignature: string;
    sourceBundleHash: string;
    queryCanonicalHash: string;
    taskKind: string;
    provenanceLevel: "user_presented_unsigned";
  },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{ registered: true; taskId: string; provenanceLevel: "user_presented_unsigned" }> {
  const response = await fetch(`${API_BASE}/ai/external-tasks/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tenantSessionPreconditionHeaders(requestOptions) },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return await response.json();
}

export async function recordExternalAgentProposalDecision(
  input: {
    docId: string;
    proposalId: string;
    sourceBundleHash: string;
    idempotencyKey: string;
    decision: "adopt" | "reject" | "hold";
    provenanceLevel: "user_presented_unsigned";
  },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{
  recorded: true;
  eventId: string;
  proposalId: string;
  status: "accepted" | "rejected" | "held";
  reviewState: "unreviewed";
  recordedAt: string;
}> {
  const response = await fetch(`${API_BASE}/ai/external-proposals/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...tenantSessionPreconditionHeaders(requestOptions) },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return await response.json();
}

// EXT-AGENT-01 (ADR-0049 D2, spec §3.4): the only frontend caller of
// /docs/{docId}/export-audit today. Fail-open on the backend (audit send
// failure never blocks the export itself) -- but a network/HTTP error here
// still surfaces to the caller so the UI can fall back to a status message
// rather than silently pretending the audit call succeeded.
// exportId (SEC-AUDIT-DUP-01): one id per export action. The backend suppresses
// only a repeat of the same id, so the caller passes a fresh id per export and
// reuses it only when resending that same export.
export async function postExportAudit(
  docId: string,
  options: { safeMode: boolean; exportKind: string; exportId: string },
  requestOptions: TenantScopedRequestOptions = {},
): Promise<void> {
  const response = await fetch(`${API_BASE}/docs/${docId}/export-audit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({
      safeMode: options.safeMode,
      exportKind: options.exportKind,
      exportId: options.exportId,
    }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
}

export type SummarizeIslandRelationPayload = {
  doc: DocumentV1;
  islandAId: string;
  islandBId: string;
  relationType: KnownEdgeType | "unknown";
  derived: boolean;
  groundingCardIds: string[];
  groundingEdgeIds: string[];
  edgeTexts?: { edgeId: string; type: string; from: string; to: string }[];
  cardTexts: { id: string; text: string }[];
};

export type SummarizeIslandRelationResult = {
  text: string;
  groundingCardIds: string[];
  groundingEdgeIds: string[];
  warnings: string[];
};

export async function summarizeIslandRelation(
  payload: SummarizeIslandRelationPayload,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<SummarizeIslandRelationResult> {
  const response = await fetch(`${API_BASE}/ai/summarize-island-relation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as SummarizeIslandRelationResult;
  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    throw new ApiError(500, "Invalid relation summary text");
  }

  if (!Array.isArray(body.groundingCardIds) || !Array.isArray(body.groundingEdgeIds) || !Array.isArray(body.warnings)) {
    throw new ApiError(500, "Invalid relation summary response shape");
  }

  return body;
}

export type NarrativeIssueReference = {
  id: string;
  kind: "card" | "island";
};

export type NarrativeIssue = {
  severity: "info" | "warn" | "error";
  message: string;
  references?: NarrativeIssueReference[];
  direction?: "b_missing_in_a" | "a_missing_in_b";
};

export type NarrativeCheckCounts = {
  bMissingInA: number;
  aMissingInB: number;
};

export async function checkNarrative(
  doc: DocumentV1,
  narrativeText: string,
  basedOnReadingOrder?: string[],
  requestOptions: TenantScopedRequestOptions = {},
): Promise<{ issues: NarrativeIssue[]; counts?: NarrativeCheckCounts }> {
  const response = await fetch(`${API_BASE}/ai/check-narrative`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, narrativeText, basedOnReadingOrder }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as { issues?: NarrativeIssue[]; counts?: NarrativeCheckCounts };
  if (!Array.isArray(body.issues)) {
    throw new ApiError(500, "Invalid narrative consistency response");
  }

  return { issues: body.issues, ...(body.counts ? { counts: body.counts } : {}) };
}


export type GenerateNarrativeResult = {
  text: string;
  basedOnReadingOrder: string[];
  warnings?: string[];
};

export async function generateNarrative(
  doc: DocumentV1,
  narrativeTitle?: string,
  model?: string,
  requestOptions: TenantScopedRequestOptions = {},
): Promise<GenerateNarrativeResult> {
  const response = await fetch(`${API_BASE}/ai/generate-narrative`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...tenantSessionPreconditionHeaders(requestOptions),
    },
    body: JSON.stringify({ doc, narrativeTitle, model: model ?? null }),
  });

  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }

  const body = (await response.json()) as GenerateNarrativeResult;
  if (typeof body.text !== "string" || !Array.isArray(body.basedOnReadingOrder)) {
    throw new ApiError(500, "Invalid narrative generation response");
  }

  if (body.warnings !== undefined && !Array.isArray(body.warnings)) {
    throw new ApiError(500, "Invalid narrative generation warnings");
  }

  return body;
}

export type InquiryBundleWithEtag = {
  payload: unknown;
  etag?: string;
};

/**
 * DATA-INQUIRY-CONCURRENCY-01 (案A): update/delete carry a single server-owned
 * revision (If-Match); create carries `If-None-Match: *`. The server returns a
 * 428 when the precondition is absent and a 409 when it is stale or the row is
 * missing. The caller must surface a 409 as a conflict — never auto-retry or
 * auto-merge into the newer bundle (AC-6).
 */
export type InquiryBundlePrecondition = {
  etag?: string;
  createIfAbsent?: boolean;
};

export async function putInquiryBundle(
  journeyId: string,
  payload: unknown,
  options: TenantScopedRequestOptions = {},
  precondition?: InquiryBundlePrecondition,
): Promise<string | undefined> {
  // G5 (W型 single-tenant 化): store an opaque W型 inquiry journey. The backend
  // treats the body as an opaque JSON value; the frontend owns the schema.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...tenantSessionPreconditionHeaders(options),
  };
  if (precondition?.createIfAbsent) {
    headers["If-None-Match"] = "*";
  } else if (precondition?.etag) {
    headers["If-Match"] = formatIfMatchHeader(precondition.etag);
  }
  const response = await fetch(`${API_BASE}/inquiry-bundles/${encodeURIComponent(journeyId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return normalizeEtag(response.headers.get("ETag"));
}

export async function getInquiryBundle(
  journeyId: string,
  options: TenantScopedRequestOptions = {},
): Promise<InquiryBundleWithEtag> {
  const response = await fetch(`${API_BASE}/inquiry-bundles/${encodeURIComponent(journeyId)}`, {
    headers: tenantSessionPreconditionHeaders(options),
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
  return {
    payload: (await response.json()) as unknown,
    etag: normalizeEtag(response.headers.get("ETag")),
  };
}

export async function deleteInquiryBundle(
  journeyId: string,
  etag: string,
  options: TenantScopedRequestOptions = {},
): Promise<void> {
  const headers: Record<string, string> = {
    ...tenantSessionPreconditionHeaders(options),
  };
  headers["If-Match"] = formatIfMatchHeader(etag);
  const response = await fetch(`${API_BASE}/inquiry-bundles/${encodeURIComponent(journeyId)}`, {
    method: "DELETE",
    headers,
  });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
}

/** POST /docs/{id}/archive — set lifecycle_state to archived (ADR-0073 D2=A). */
export async function archiveDocument(
  docId: string,
  options: TenantScopedRequestOptions = {},
): Promise<void> {
  const headers = tenantSessionPreconditionHeaders(options);
  const response = headers
    ? await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}/archive`, { method: "POST", headers })
    : await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}/archive`, { method: "POST" });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
}

/** POST /docs/{id}/unarchive — set lifecycle_state to active (ADR-0073 D2=A). */
export async function unarchiveDocument(
  docId: string,
  options: TenantScopedRequestOptions = {},
): Promise<void> {
  const headers = tenantSessionPreconditionHeaders(options);
  const response = headers
    ? await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}/unarchive`, { method: "POST", headers })
    : await fetch(`${API_BASE}/docs/${encodeURIComponent(docId)}/unarchive`, { method: "POST" });
  if (!response.ok) {
    const errorDetail = await parseErrorDetail(response);
    throw new ApiError(response.status, errorDetail.message, { code: errorDetail.code, disabledReason: errorDetail.disabledReason });
  }
}
