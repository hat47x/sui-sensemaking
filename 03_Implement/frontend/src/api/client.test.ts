import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  changeActiveTenant,
  checkNarrative,
  generateNarrative,
  fetchAvailableModels,
  getDocument,
  getTenantSessionBootstrapPolicy,
  listDocuments,
  getTenantSessionContext,
  postExportAudit,
  proposeIslandSummary,
  putDocument,
  recordExternalAgentProposalDecision,
  recordProposalDecision,
  registerExternalAgentProposal,
  registerExternalAgentTask,
  summarizeIslandRelation,
  suggestDocumentTitle,
  suggestMerges,
  suggestLayout,
  putInquiryBundle,
  getInquiryBundle,
  deleteInquiryBundle,
} from "./client";
import type { DocumentV1 } from "../domain/types";
import { InvalidTenantSessionContextError } from "./session_context";
import { InvalidTenantSessionBootstrapPolicyError } from "./session_bootstrap_policy";

function createDocument(): DocumentV1 {
  return {
    version: 1,
    id: "doc-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    transform: { panX: 0, panY: 0, zoom: 1 },
    cards: [
      { id: "c1", text: "Risk mitigation", x: 0, y: 0 },
      { id: "c2", text: "risk mitigation", x: 10, y: 0 },
    ],
    islands: [],
    edges: [],
  };
}

const tenantSessionContext = {
  principalId: "user-1",
  activeTenant: { id: "tenant-a", displayName: "Tenant A" },
  availableTenants: [{ id: "tenant-a", displayName: "Tenant A" }],
  effectiveCapabilities: ["document.read" as const, "document.write" as const],
  capabilityVersion: "capability-v7",
  tenantSessionVersion: "session-v1",
};

describe("tenant-scoped document request precondition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves the safe empty-model reason from the tenant-scoped API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        models: [],
        unavailableReason: "tenant_policy_excludes_all",
      }), { status: 200 }),
    );

    const result = await fetchAvailableModels({ tenantSessionContext });

    expect(result).toEqual({
      models: [],
      unavailableReason: "tenant_policy_excludes_all",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/ai/available-models", {
      headers: { "Sui-Sensemaking-Tenant-Session-Version": "session-v1" },
    });
  });

  it("attaches only the verified opaque version to document reads", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(createDocument()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getDocument("doc-1", { tenantSessionContext });

    expect(fetchMock).toHaveBeenCalledWith("/api/docs/doc-1", {
      headers: { "Sui-Sensemaking-Tenant-Session-Version": "session-v1" },
    });
  });

  it("attaches the version alongside write and audit content headers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createDocument()), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await putDocument("doc-1", createDocument(), "etag-v1", {
      tenantSessionContext,
    });
    await postExportAudit(
      "doc-1",
      { safeMode: true, exportKind: "agent-task" },
      { tenantSessionContext },
    );

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        "Content-Type": "application/json",
        "If-Match": '"etag-v1"',
        "Sui-Sensemaking-Tenant-Session-Version": "session-v1",
      },
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: {
        "Content-Type": "application/json",
        "Sui-Sensemaking-Tenant-Session-Version": "session-v1",
      },
    });
  });

  it("rejects a refused export audit so the caller can report it instead of dropping it", async () => {
    // The App reports a rejected export-audit as "export completed, no audit
    // record saved". That relies on postExportAudit surfacing the 403 rather
    // than resolving successfully.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Access denied: safe_mode" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const attempt = postExportAudit(
      "doc-1",
      { safeMode: true, exportKind: "agent-task" },
      { tenantSessionContext },
    );

    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ status: 403 });
  });

  it("creates a document with If-None-Match only inside a tenant session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify(createDocument()), { status: 200 }));

    await putDocument("doc-1", createDocument(), undefined, { tenantSessionContext });
    await putDocument("doc-1", createDocument());
    await putDocument("doc-1", createDocument(), "etag-v1", { tenantSessionContext });

    const headersOf = (index: number) => (fetchMock.mock.calls[index]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headersOf(0)["If-None-Match"]).toBe("*");
    expect(headersOf(0)["If-Match"]).toBeUndefined();
    expect(headersOf(1)["If-None-Match"]).toBeUndefined();
    expect(headersOf(2)["If-Match"]).toBe('"etag-v1"');
    expect(headersOf(2)["If-None-Match"]).toBeUndefined();
  });

  it("attaches the version to every document-content AI mutation", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        suggestionId: "suggestion-1",
        suggestedDoc: createDocument(),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ suggestions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposalId: "proposal-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ registered: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ registered: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ recorded: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        recorded: true,
        eventId: "event-1",
        proposalId: "proposal-1",
        status: "accepted",
        reviewState: "unreviewed",
        recordedAt: "2026-08-11T00:00:00Z",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "relation",
        groundingCardIds: [],
        groundingEdgeIds: [],
        warnings: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ issues: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        text: "narrative",
        basedOnReadingOrder: [],
      }), { status: 200 }));
    const requestOptions = { tenantSessionContext };

    await suggestLayout(createDocument(), undefined, requestOptions);
    await suggestMerges(createDocument(), undefined, requestOptions);
    await proposeIslandSummary(createDocument(), "island-1", "bundle-1", undefined, requestOptions);
    await registerExternalAgentTask({
      docId: "doc-1",
      taskId: "task-1",
      baseDocSignature: "doc-1:revision-1",
      sourceBundleHash: "a".repeat(64),
      queryCanonicalHash: "b".repeat(64),
      taskKind: "critique_suggestions",
      provenanceLevel: "user_presented_unsigned",
    }, requestOptions);
    await registerExternalAgentProposal({
      docId: "doc-1",
      taskId: "task-1",
      baseDocSignature: "doc-1:revision-1",
      sourceBundleHash: "a".repeat(64),
      queryCanonicalHash: "b".repeat(64),
      proposalId: "external-1",
      proposalKind: "critique",
      proposalFingerprint: "c".repeat(64),
      provenanceLevel: "user_presented_unsigned",
    }, requestOptions);
    await recordExternalAgentProposalDecision({
      docId: "doc-1",
      proposalId: "external-1",
      sourceBundleHash: "a".repeat(64),
      idempotencyKey: "external-1:adopt",
      decision: "adopt",
      provenanceLevel: "user_presented_unsigned",
    }, requestOptions);
    await recordProposalDecision({
      docId: "doc-1",
      proposalId: "proposal-1",
      sourceBundleHash: "a".repeat(64),
      idempotencyKey: "operation-1",
      decision: "adopt",
    }, requestOptions);
    await summarizeIslandRelation({
      doc: createDocument(),
      islandAId: "island-1",
      islandBId: "island-2",
      relationType: "unknown",
      derived: false,
      groundingCardIds: [],
      groundingEdgeIds: [],
      cardTexts: [],
    }, requestOptions);
    await checkNarrative(createDocument(), "narrative", undefined, requestOptions);
    await generateNarrative(createDocument(), undefined, undefined, requestOptions);

    expect(fetchMock).toHaveBeenCalledTimes(10);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        headers: {
          "Content-Type": "application/json",
          "Sui-Sensemaking-Tenant-Session-Version": "session-v1",
        },
      });
    }
  });

  it("preserves single-tenant calls without a session header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(createDocument()), { status: 200 }),
    );

    await getDocument("doc-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/docs/doc-1", { headers: {} });
  });

  it("rejects malformed session input before network access", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(getDocument("doc-1", {
      tenantSessionContext: {
        ...tenantSessionContext,
        tenantSessionVersion: "stale version",
      },
    })).rejects.toBeInstanceOf(InvalidTenantSessionContextError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SafeMode AI request certification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("certifies the reviewed-only title suggestion context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ title: "Reviewed title" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await suggestDocumentTitle(
      ["Reviewed island"],
      ["Reviewed card"],
      "Current title",
      undefined,
      [{ textReviewed: true }],
      { tenantSessionContext },
    );

    const request = fetchMock.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      islandTitles: ["Reviewed island"],
      cardTexts: ["Reviewed card"],
      textReviewed: true,
    });
  });
});

describe("suggestDocumentTitle review declaration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function declaredTextReviewed(
    documentCards: ReadonlyArray<{ textReviewed?: boolean }> | undefined,
  ): Promise<unknown> {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ title: "Title" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await suggestDocumentTitle(
      ["Island"],
      ["Card"],
      undefined,
      undefined,
      documentCards,
      { tenantSessionContext },
    );

    const request = fetchMock.mock.calls[0]?.[1];
    return (JSON.parse(String(request?.body)) as { textReviewed: unknown }).textReviewed;
  }

  it("declares unreviewed when a document card has not been human-reviewed", async () => {
    expect(await declaredTextReviewed([{ textReviewed: true }, { textReviewed: false }])).toBe(false);
  });

  it("declares unreviewed when a document card has no review state", async () => {
    expect(await declaredTextReviewed([{ textReviewed: true }, {}])).toBe(false);
  });

  it("declares reviewed only when every document card is reviewed", async () => {
    expect(await declaredTextReviewed([{ textReviewed: true }, { textReviewed: true }])).toBe(true);
  });

  it("declares unreviewed when no document is loaded", async () => {
    expect(await declaredTextReviewed(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TENANT SESSION VERSION CLIENT COVERAGE CONTRACT
//
// The assertions above enumerate the requests whoever wrote them remembered:
// `toHaveBeenCalledTimes(7)` pins the seven AI mutations that existed then, so
// an eighth tenant-scoped request added to this module would be asserted by
// nothing at all. That is the same fail-open shape the backend's registered
// route coverage guard had until 2026-08-06, when it was inverted so that
// every registered FastAPI route must install a shared tenant boundary or
// appear in an exemption table whose reasons are themselves mechanically
// re-checked (`backend/tests/test_tenant_session_precondition.py`).
//
// The contract below is that inversion on the client side: every fetch() call
// site in the frontend's production source is enumerated, and each backend
// request must either attach the opaque tenant session version through the one
// shared helper or be named here with a reason that is re-verified.
//
// Scope stated rather than implied. The backend refuses every tenant-scoped
// request that omits the header, so a client that forgets it fails closed with
// `409 tenant_session_changed` before any resource lookup -- this contract
// guards a functional boundary against future drift, it is not the thing that
// keeps tenants apart. And it inspects the exported function that lexically
// contains each fetch(), so a request issued from a private helper is
// attributed to that function, exactly as the backend contract inspects
// `route.endpoint` rather than the helpers the endpoint calls.
// ---------------------------------------------------------------------------

const FRONTEND_SRC_ROOT = resolve(__dirname, "..");
const CLIENT_MODULE_PATH = "api/client.ts";
const APP_MODULE_PATH = "App.tsx";
const ADMIN_MODEL_ALLOWLIST_MODULE_PATH = "admin/model_allowlist_api.ts";
const OAUTH_CALLBACK_MODULE_PATH = "session/oauth_callback.ts";
const TENANT_SCOPED_WRAPPERS = [
  "runTenantScopedApiRequest(() => ",
  // Calls made inside runTenantScopedApiRequest's own recovery branch cannot
  // wrap themselves recursively. The lower-level task wrapper is the same
  // tenant generation guard and is valid only for that internal recovery.
  "runTenantScopedTask(() => ",
] as const;

// Request can neither address nor carry a tenant-scoped resource: constant
// path, no request body, no tenant-scoped request options.
const NO_TENANT_RESOURCE = "no-tenant-resource";
// Request is where the opaque version comes from, so it cannot also demand it.
const TENANT_SESSION_VERSION_SOURCE = "tenant-session-version-source";
// Request carries the expected version in its JSON body instead of a header.
const BODY_BORNE_EXPECTED_VERSION = "body-borne-expected-version";
// The reason codes above are the backend exemption table's own. Its fourth
// reason -- `saas-surface-blocked`, for POST /admin/provision/users -- has no
// client counterpart because this module never requests that path, which the
// request enumeration below re-confirms by set equality.

const UNGUARDED_CLIENT_REQUEST_EXEMPTIONS: Readonly<Record<string, string>> = {
  "GET /session/bootstrap-policy": NO_TENANT_RESOURCE,
  "GET /ai/provider-status": NO_TENANT_RESOURCE,
  "GET /session/context": TENANT_SESSION_VERSION_SOURCE,
  "POST /session/active-tenant": BODY_BORNE_EXPECTED_VERSION,
};

type EnumeratedClientRequest = Readonly<{
  functionName: string;
  requestKey: string;
  attachesVersionHeader: boolean;
  acceptsTenantScopedOptions: boolean;
  interpolatesPathValues: boolean;
  requestInit: string;
  functionSource: string;
}>;

function readFrontendModule(modulePath: string): string {
  return readFileSync(resolve(FRONTEND_SRC_ROOT, modulePath), "utf8");
}

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function balancedCallArguments(source: string, openParenIndex: number): string {
  let depth = 0;
  for (let index = openParenIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openParenIndex + 1, index);
      }
    }
  }
  throw new Error(`Unbalanced call at line ${lineNumberAt(source, openParenIndex)}`);
}

function fetchCallSites(source: string): readonly Readonly<{ index: number; args: string }>[] {
  return [...source.matchAll(/\bfetch\s*\(/g)].map((match) => {
    const matchIndex = match.index ?? 0;
    return {
      index: matchIndex,
      args: balancedCallArguments(source, matchIndex + match[0].length - 1),
    };
  });
}

function splitRequestArguments(args: string): Readonly<{ url: string; init: string }> {
  let depth = 0;
  for (let index = 0; index < args.length; index += 1) {
    const character = args[index];
    if (character === "(" || character === "{" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "}" || character === "]") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      return { url: args.slice(0, index).trim(), init: args.slice(index + 1) };
    }
  }
  return { url: args.trim(), init: "" };
}

function productionSourceModules(directory: string): readonly string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...productionSourceModules(entryPath));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      continue;
    }
    collected.push(relative(FRONTEND_SRC_ROOT, entryPath).split(sep).join("/"));
  }
  return collected;
}

// Matches both `export async function name(` and an arrow-exported
// equivalent (`export const name = async (` / `export const name = (`).
// Client.ts only uses the function-declaration style today, but the arrow
// style is equally idiomatic TS and this enumeration must not have a blind
// spot the moment someone adds one -- a fetch() call whose declaration this
// regex fails to recognize gets silently attributed to the *previous*
// matched declaration instead of raising, per the loop below.
const CLIENT_FUNCTION_DECLARATION_RE =
  /^export (?:async function (\w+)\(|const (\w+) = (?:async )?\()/gm;

function enumerateClientRequests(): readonly EnumeratedClientRequest[] {
  const source = readFrontendModule(CLIENT_MODULE_PATH);
  const declarations = [...source.matchAll(CLIENT_FUNCTION_DECLARATION_RE)].map((match) => ({
    name: match[1] ?? match[2] ?? "",
    index: match.index ?? 0,
    headerLength: match[0].length,
  }));

  return fetchCallSites(source).map((site) => {
    const declaration = [...declarations]
      .reverse()
      .find((candidate) => candidate.index < site.index);
    if (!declaration) {
      throw new Error(
        `fetch() at line ${lineNumberAt(source, site.index)} is outside an exported function`,
      );
    }
    const nextDeclaration = declarations.find((candidate) => candidate.index > declaration.index);
    const functionSource = source.slice(declaration.index, nextDeclaration?.index ?? source.length);
    if (/\bfunction\b/.test(source.slice(declaration.index + declaration.headerLength, site.index))) {
      throw new Error(
        `fetch() at line ${lineNumberAt(source, site.index)} is not directly inside ${declaration.name}`,
      );
    }

    const { url, init } = splitRequestArguments(site.args);
    const template = url.match(/^`\$\{API_BASE\}([^`]*)`$/);
    if (!template) {
      throw new Error(
        `fetch() at line ${lineNumberAt(source, site.index)} does not target the API base: ${url}`,
      );
    }
    const requestPath = (template[1] ?? "").replace(
      /\$\{([^}]+)\}/g,
      (_match, expression: string) => `{${expression}}`,
    );
    const method = init.match(/method:\s*"([A-Z]+)"/)?.[1] ?? "GET";

    return {
      functionName: declaration.name,
      requestKey: `${method} ${requestPath}`,
      attachesVersionHeader: functionSource.includes("tenantSessionPreconditionHeaders"),
      acceptsTenantScopedOptions: functionSource.includes("TenantScopedRequestOptions"),
      interpolatesPathValues: (template[1] ?? "").includes("${"),
      requestInit: init,
      functionSource,
    };
  });
}

function exemptClientRequests(reason: string): readonly EnumeratedClientRequest[] {
  return enumerateClientRequests().filter(
    (request) => UNGUARDED_CLIENT_REQUEST_EXEMPTIONS[request.requestKey] === reason,
  );
}

// A name occurrence inside a line comment, a block-comment body line, or a
// block-comment opener is prose, not a call site.
function isCommentedOccurrence(source: string, index: number): boolean {
  const linePrefix = source.slice(source.lastIndexOf("\n", index) + 1, index);
  return linePrefix.includes("//") || /^\s*\*/.test(linePrefix) || /^\s*\/\*/.test(linePrefix);
}

describe("tenant session version client coverage contract", () => {
  it("classifies every frontend fetch surface by its trust boundary", () => {
    const modulesWithFetch = productionSourceModules(FRONTEND_SRC_ROOT).filter(
      (modulePath) => fetchCallSites(readFrontendModule(modulePath)).length > 0,
    );

    expect([...modulesWithFetch].sort()).toEqual([
      APP_MODULE_PATH,
      ADMIN_MODEL_ALLOWLIST_MODULE_PATH,
      CLIENT_MODULE_PATH,
      OAUTH_CALLBACK_MODULE_PATH,
    ]);

    // App's own fetches load bundled public-pack files from the frontend
    // origin, never the backend API, so they address no tenant-scoped
    // resource. Their staleness boundary is the tenant session generation
    // guard, not a request header.
    for (const site of fetchCallSites(readFrontendModule(APP_MODULE_PATH))) {
      const { url } = splitRequestArguments(site.args);
      expect(url).toMatch(/^["`]\.\/packs\//);
      expect(url).not.toContain("API_BASE");
    }

    // The model allowlist console is a separate control-plane surface. It does
    // not carry the business-plane tenant-session version: tenant identity is
    // explicit in the admin route and mutations use the control-plane CSRF/auth
    // headers. Keep this exception narrow and mechanically bound to that route.
    for (const site of fetchCallSites(readFrontendModule(ADMIN_MODEL_ALLOWLIST_MODULE_PATH))) {
      const { url, init } = splitRequestArguments(site.args);
      expect(url).toContain("API_BASE");
      expect(url).toContain("/admin/provision/models/tenants/");
      expect(url).toContain("/allowlist");
      expect(init).toContain("controlPlaneHeaders");
      expect(init).toContain('credentials: "same-origin"');
      expect(init).not.toContain("tenantSessionPreconditionHeaders");
    }

    // OAuth code exchange targets the separately configured identity broker,
    // before a tenant session exists. It must never address the application API.
    for (const site of fetchCallSites(readFrontendModule(OAUTH_CALLBACK_MODULE_PATH))) {
      const { url } = splitRequestArguments(site.args);
      expect(url).toContain("brokerBase");
      expect(url).not.toContain("API_BASE");
    }
  });

  it("requires every enumerated client request to attach the version or be exempt", () => {
    const requests = enumerateClientRequests();
    expect(requests.length).toBeGreaterThan(0);

    const unguarded = new Set(
      requests
        .filter((request) => !request.attachesVersionHeader)
        .map((request) => request.requestKey),
    );

    // Set equality both ways: a new tenant-scoped request that skips the
    // shared helper fails until it is classified, and a stale exemption fails
    // once the request it excused starts attaching the version or disappears.
    expect([...unguarded].sort()).toEqual(
      Object.keys(UNGUARDED_CLIENT_REQUEST_EXEMPTIONS).sort(),
    );
  });

  it("lets exactly the guarded requests receive a verified session", () => {
    for (const request of enumerateClientRequests()) {
      expect({
        request: request.requestKey,
        acceptsTenantScopedOptions: request.acceptsTenantScopedOptions,
      }).toEqual({
        request: request.requestKey,
        acceptsTenantScopedOptions: request.attachesVersionHeader,
      });
    }
  });

  it("re-checks that no-tenant-resource exemptions cannot address or carry a resource", () => {
    const exemptRequests = exemptClientRequests(NO_TENANT_RESOURCE);
    expect(exemptRequests.length).toBeGreaterThan(0);

    for (const request of exemptRequests) {
      expect({
        request: request.requestKey,
        interpolatesPathValues: request.interpolatesPathValues,
        sendsRequestBody: /\bbody:/.test(request.requestInit),
      }).toEqual({
        request: request.requestKey,
        interpolatesPathValues: false,
        sendsRequestBody: false,
      });
    }
  });

  it("re-checks that the session route exemptions own the opaque version themselves", () => {
    const versionSourceRequests = exemptClientRequests(TENANT_SESSION_VERSION_SOURCE);
    const bodyBorneRequests = exemptClientRequests(BODY_BORNE_EXPECTED_VERSION);
    expect(versionSourceRequests.length).toBeGreaterThan(0);
    expect(bodyBorneRequests.length).toBeGreaterThan(0);

    for (const request of [...versionSourceRequests, ...bodyBorneRequests]) {
      expect(request.functionSource).toContain("parseTenantSessionContext");
    }
    for (const request of versionSourceRequests) {
      expect(/\bbody:/.test(request.requestInit)).toBe(false);
    }
    for (const request of bodyBorneRequests) {
      expect(request.requestInit).toContain(
        "expectedTenantSessionVersion: currentSession.tenantSessionVersion",
      );
    }
  });

  it("keeps the version header name bound to the one shared helper", () => {
    const clientSource = readFrontendModule(CLIENT_MODULE_PATH);

    expect(clientSource.match(/"Sui-Sensemaking-Tenant-Session-Version"/g)).toHaveLength(1);
    expect(clientSource.match(/TENANT_SESSION_VERSION_HEADER/g)).toHaveLength(2);
    expect(
      productionSourceModules(FRONTEND_SRC_ROOT).filter(
        (modulePath) =>
          modulePath !== CLIENT_MODULE_PATH
          && /Sui-Sensemaking-Tenant-Session-Version|TENANT_SESSION_VERSION_HEADER/.test(
            readFrontendModule(modulePath),
          ),
      ),
    ).toEqual([]);
  });

  it("sends every guarded client request through the tenant session wrapper, from any production module", () => {
    // Scoped to App.tsx until 2026-08-06: today it is the only caller, but
    // api/client.ts is already imported directly by other production files
    // (NarrativesPanel.tsx, MergeSuggestionsPanel.tsx, session/*.ts), so a
    // guarded call added there would previously have gone unchecked. Every
    // production module except client.ts itself (which defines, not calls,
    // these functions) is scanned now.
    const guardedFunctionNames = [
      ...new Set(
        enumerateClientRequests()
          .filter((request) => request.attachesVersionHeader)
          .map((request) => request.functionName),
      ),
    ].sort();
    expect(guardedFunctionNames.length).toBeGreaterThan(0);

    const callerModulePaths = productionSourceModules(FRONTEND_SRC_ROOT).filter(
      (modulePath) => modulePath !== CLIENT_MODULE_PATH,
    );
    expect(callerModulePaths).toContain(APP_MODULE_PATH);

    let totalCallSites = 0;
    let totalSessionOptionOccurrences = 0;
    for (const modulePath of callerModulePaths) {
      const moduleSource = readFrontendModule(modulePath);

      for (const functionName of guardedFunctionNames) {
        for (const match of moduleSource.matchAll(new RegExp(`\\b${functionName}\\s*\\(`, "g"))) {
          const matchIndex = match.index ?? 0;
          if (isCommentedOccurrence(moduleSource, matchIndex)) {
            continue;
          }

          const location = `${functionName} (${modulePath}:${lineNumberAt(moduleSource, matchIndex)})`;
          totalCallSites += 1;
          // The session-bearing variable is not required to be named
          // verifiedTenantSession outside App.tsx -- a future caller in a
          // different module may reasonably bind its own verified session
          // under a different local name. What must hold everywhere is that
          // some identifier is passed (the request is not sent bare) and
          // that the call is wrapped in the generation guard.
          const passedSessionIdentifier = balancedCallArguments(
            moduleSource,
            matchIndex + match[0].length - 1,
          ).match(/tenantSessionContext:\s*(\w+)/)?.[1];
          expect({
            location,
            wrappedInGenerationGuard: TENANT_SCOPED_WRAPPERS.some((wrapper) => moduleSource
              .slice(Math.max(0, matchIndex - wrapper.length), matchIndex)
              .endsWith(wrapper)),
            passesSessionIdentifier: passedSessionIdentifier !== undefined,
          }).toEqual({ location, wrappedInGenerationGuard: true, passesSessionIdentifier: true });
        }
      }

      // Every session-bearing option object in this module belongs to one of
      // the call sites just scanned; a stray one would mean a guarded request
      // escaped the loop above (e.g. inside a function this test does not
      // recognize as one of guardedFunctionNames).
      totalSessionOptionOccurrences += [
        ...moduleSource.matchAll(/tenantSessionContext:\s*\w+/g),
      ].length;
    }

    expect(totalCallSites).toBeGreaterThan(0);
    expect(totalSessionOptionOccurrences).toBe(totalCallSites);
  });
});

describe("tenant session bootstrap policy fetch boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches a strict server policy without client runtime hints", async () => {
    const abortController = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        tenantSessionMode: "tenant-session-required",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await expect(getTenantSessionBootstrapPolicy({
      signal: abortController.signal,
    })).resolves.toEqual({ tenantSessionMode: "tenant-session-required" });
    expect(fetchMock).toHaveBeenCalledWith("/api/session/bootstrap-policy", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: abortController.signal,
    });
  });

  it("rejects unknown modes and response expansion", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ tenantSessionMode: "required" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          tenantSessionMode: "single-tenant",
          runtimeProfile: "local-dev",
        }), { status: 200, headers: { "Content-Type": "application/json" } }),
      );

    await expect(getTenantSessionBootstrapPolicy()).rejects.toBeInstanceOf(
      InvalidTenantSessionBootstrapPolicyError,
    );
    await expect(getTenantSessionBootstrapPolicy()).rejects.toBeInstanceOf(
      InvalidTenantSessionBootstrapPolicyError,
    );
  });

  it("rejects oversized and non-UTF-8 success responses", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(new Uint8Array((4 * 1024) + 1), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0xff]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(getTenantSessionBootstrapPolicy()).rejects.toBeInstanceOf(
      InvalidTenantSessionBootstrapPolicyError,
    );
    await expect(getTenantSessionBootstrapPolicy()).rejects.toBeInstanceOf(
      InvalidTenantSessionBootstrapPolicyError,
    );
  });

  it("preserves a bounded backend failure contract", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        detail: {
          code: "runtime_policy_unavailable",
          message: "Runtime policy is unavailable.",
        },
      }), { status: 503, headers: { "Content-Type": "application/json" } }),
    );

    await expect(getTenantSessionBootstrapPolicy()).rejects.toMatchObject({
      status: 503,
      code: "runtime_policy_unavailable",
      message: "Runtime policy is unavailable.",
    });
  });
});

describe("tenant session context fetch boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches without client tenant hints and validates the response", async () => {
    const abortController = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        principalId: "user-1",
        activeTenant: { id: "tenant-a", displayName: "Tenant A" },
        availableTenants: [{ id: "tenant-a", displayName: "Tenant A" }],
        effectiveCapabilities: ["document.write", "document.read"],
        capabilityVersion: "capability-v7",
        tenantSessionVersion: "session-v1",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const context = await getTenantSessionContext({ signal: abortController.signal });

    expect(context.effectiveCapabilities).toEqual(["document.read", "document.write"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/session/context", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: abortController.signal,
    });
  });

  it("preserves the backend status and stable error code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        detail: {
          code: "capability_resolution_unavailable",
          message: "Tenant capabilities are unavailable.",
        },
      }), { status: 503, headers: { "Content-Type": "application/json" } }),
    );

    await expect(getTenantSessionContext()).rejects.toMatchObject({
      status: 503,
      code: "capability_resolution_unavailable",
      message: "Tenant capabilities are unavailable.",
    });
  });

  it("rejects invalid JSON and invalid session contracts", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("not-json", { status: 200, headers: { "Content-Type": "text/plain" } }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ principalId: "user-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(getTenantSessionContext()).rejects.toBeInstanceOf(
      InvalidTenantSessionContextError,
    );
    await expect(getTenantSessionContext()).rejects.toBeInstanceOf(
      InvalidTenantSessionContextError,
    );
  });

  it("rejects an oversized session response before JSON contract use", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ padding: "x".repeat(64 * 1024) }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String((64 * 1024) + 1),
          },
        }),
      );

    await expect(getTenantSessionContext()).rejects.toBeInstanceOf(
      InvalidTenantSessionContextError,
    );
    await expect(getTenantSessionContext()).rejects.toBeInstanceOf(
      InvalidTenantSessionContextError,
    );
  });

  it("cancels a chunked session response as soon as it exceeds the byte limit", async () => {
    let pullCount = 0;
    let cancelled = false;
    const chunks = [
      new Uint8Array(64 * 1024),
      new Uint8Array([0x20]),
      new TextEncoder().encode("must-not-be-read"),
    ];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pullCount];
        pullCount += 1;
        if (chunk) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getTenantSessionContext()).rejects.toBeInstanceOf(
      InvalidTenantSessionContextError,
    );
    expect(pullCount).toBe(2);
    expect(cancelled).toBe(true);
  });

  it("bounds oversized error responses and falls back to the HTTP status text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array((64 * 1024) + 1), {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getTenantSessionContext()).rejects.toEqual(
      new ApiError(503, "Service Unavailable"),
    );
  });

  it("rejects a session response that is not valid UTF-8", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([0xff]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getTenantSessionContext()).rejects.toBeInstanceOf(
      InvalidTenantSessionContextError,
    );
  });

  it("changes only to a tenant from the verified current allowlist", async () => {
    const abortController = new AbortController();
    const currentSession = {
      principalId: "user-1",
      activeTenant: { id: "tenant-a", displayName: "Tenant A" },
      availableTenants: [
        { id: "tenant-a", displayName: "Tenant A" },
        { id: "tenant-b", displayName: "Tenant B" },
      ],
      effectiveCapabilities: ["document.read" as const],
      capabilityVersion: "capability-v7",
      tenantSessionVersion: "session-v1",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...currentSession,
        activeTenant: { id: "tenant-b", displayName: "Tenant B" },
        capabilityVersion: "capability-v8",
        tenantSessionVersion: "session-v2",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const nextSession = await changeActiveTenant(
      currentSession,
      "tenant-b",
      { signal: abortController.signal },
    );

    expect(nextSession.activeTenant.id).toBe("tenant-b");
    expect(fetchMock).toHaveBeenCalledWith("/api/session/active-tenant", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenantId: "tenant-b",
        expectedTenantSessionVersion: "session-v1",
      }),
      cache: "no-store",
      credentials: "same-origin",
      signal: abortController.signal,
    });
  });

  it("rejects a free-input tenant before sending a request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const currentSession = {
      principalId: "user-1",
      activeTenant: { id: "tenant-a", displayName: "Tenant A" },
      availableTenants: [{ id: "tenant-a", displayName: "Tenant A" }],
      effectiveCapabilities: ["document.read" as const],
      capabilityVersion: "capability-v7",
      tenantSessionVersion: "session-v1",
    };

    await expect(
      changeActiveTenant(currentSession, "attacker-tenant"),
    ).rejects.toBeInstanceOf(InvalidTenantSessionContextError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a tenant-change response for another principal or tenant", async () => {
    const currentSession = {
      principalId: "user-1",
      activeTenant: { id: "tenant-a", displayName: "Tenant A" },
      availableTenants: [
        { id: "tenant-a", displayName: "Tenant A" },
        { id: "tenant-b", displayName: "Tenant B" },
      ],
      effectiveCapabilities: ["document.read" as const],
      capabilityVersion: "capability-v7",
      tenantSessionVersion: "session-v1",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          ...currentSession,
          principalId: "user-2",
          activeTenant: { id: "tenant-b", displayName: "Tenant B" },
          tenantSessionVersion: "session-v2",
        }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          ...currentSession,
          activeTenant: { id: "tenant-a", displayName: "Tenant A" },
          tenantSessionVersion: "session-v2",
        }), { status: 200 }),
      );

    await expect(
      changeActiveTenant(currentSession, "tenant-b"),
    ).rejects.toBeInstanceOf(InvalidTenantSessionContextError);
    await expect(
      changeActiveTenant(currentSession, "tenant-b"),
    ).rejects.toBeInstanceOf(InvalidTenantSessionContextError);
  });

  it("rejects a tenant-change response that keeps the old session version", async () => {
    const currentSession = {
      principalId: "user-1",
      activeTenant: { id: "tenant-a", displayName: "Tenant A" },
      availableTenants: [
        { id: "tenant-a", displayName: "Tenant A" },
        { id: "tenant-b", displayName: "Tenant B" },
      ],
      effectiveCapabilities: ["document.read" as const],
      capabilityVersion: "capability-v7",
      tenantSessionVersion: "session-v1",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...currentSession,
        activeTenant: { id: "tenant-b", displayName: "Tenant B" },
      }), { status: 200 }),
    );

    await expect(
      changeActiveTenant(currentSession, "tenant-b"),
    ).rejects.toBeInstanceOf(InvalidTenantSessionContextError);
  });

  it("preserves a stable active-tenant update failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        detail: {
          code: "active_tenant_update_unavailable",
          message: "Active tenant update is unavailable.",
        },
      }), { status: 503, statusText: "Service Unavailable" }),
    );
    const currentSession = {
      principalId: "user-1",
      activeTenant: { id: "tenant-a", displayName: "Tenant A" },
      availableTenants: [
        { id: "tenant-a", displayName: "Tenant A" },
        { id: "tenant-b", displayName: "Tenant B" },
      ],
      effectiveCapabilities: ["document.read" as const],
      capabilityVersion: "capability-v7",
      tenantSessionVersion: "session-v1",
    };

    await expect(changeActiveTenant(currentSession, "tenant-b")).rejects.toMatchObject({
      status: 503,
      code: "active_tenant_update_unavailable",
      message: "Active tenant update is unavailable.",
    });
  });
});

describe("suggestMerges contract validation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts the backend MergeSuggestion contract without local Stream B metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [
            {
              groupId: "m1",
              cardIds: ["c1", "c2"],
              mergedTextDraft: "Risk mitigation",
              mergeMethod: "kernel_fusion",
              rationale: "Both cards express the same core concern.",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await suggestMerges(createDocument(), "collect candidates");

    expect(result.suggestions).toEqual([
      {
        groupId: "m1",
        cardIds: ["c1", "c2"],
        mergedTextDraft: "Risk mitigation",
        mergeMethod: "kernel_fusion",
        rationale: "Both cards express the same core concern.",
      },
    ]);
  });

  it("preserves backend suggestion order and method without requiring deterministic-candidate scoring fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [
            { groupId: "m1", cardIds: ["c1", "c2"], mergedTextDraft: "Risk mitigation", mergeMethod: "near_duplicate" },
            { groupId: "m2", cardIds: ["c3", "c4"], mergedTextDraft: "Timeline review", mergeMethod: "kernel_fusion" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await suggestMerges(createDocument());
    expect(result.suggestions.map((suggestion) => suggestion.groupId)).toEqual(["m1", "m2"]);
    expect(result.suggestions.map((suggestion) => suggestion.mergeMethod)).toEqual(["near_duplicate", "kernel_fusion"]);
  });

  it("fails fast when a core backend field is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [{ groupId: "m1", mergedTextDraft: "Risk mitigation", mergeMethod: "near_duplicate" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(suggestMerges(createDocument())).rejects.toMatchObject({
      message: "Invalid merge suggestions contract payload",
      status: 500,
    });
  });

  it("fails fast when mergeMethod is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [{ groupId: "m1", cardIds: ["c1", "c2"], mergedTextDraft: "Risk mitigation" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(suggestMerges(createDocument())).rejects.toMatchObject({
      message: "Invalid merge suggestions contract payload",
      status: 500,
    });
  });

  it("fails fast when mergeMethod is unknown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [{
            groupId: "m1",
            cardIds: ["c1", "c2"],
            mergedTextDraft: "Risk mitigation",
            mergeMethod: "semantic_similarity",
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(suggestMerges(createDocument())).rejects.toMatchObject({
      message: "Invalid merge suggestions contract payload",
      status: 500,
    });
  });

  it("fails fast when a merge suggestion contains fewer than two cards", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          suggestions: [{
            groupId: "m1",
            cardIds: ["c1"],
            mergedTextDraft: "Risk mitigation",
            mergeMethod: "near_duplicate",
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await expect(suggestMerges(createDocument())).rejects.toMatchObject({
      message: "Invalid merge suggestions contract payload",
      status: 500,
    });
  });
});

describe("PROV-ERROR-01: structured provider error propagation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("carries code and disabledReason from a ProviderDisabledError contract (detail as object)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "provider_unavailable",
            message: "AI is disabled. Set SUI_LLM_PROVIDER to local or large-scale.",
            provider: "none",
            disabled_reason: "provider_disabled_or_none_default",
          },
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      )
    );

    const error = await suggestLayout(createDocument()).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
    expect((error as ApiError).code).toBe("provider_unavailable");
    expect((error as ApiError).disabledReason).toBe("provider_disabled_or_none_default");
    expect((error as ApiError).message).toBe("AI is disabled. Set SUI_LLM_PROVIDER to local or large-scale.");
  });

  it("carries code without disabledReason for a configured-but-unreachable provider", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "provider_timeout",
            message: "local request timed out with status 504",
            provider: "local",
          },
        }),
        { status: 504, headers: { "Content-Type": "application/json" } }
      )
    );

    const error = await suggestLayout(createDocument()).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("provider_timeout");
    expect((error as ApiError).disabledReason).toBeUndefined();
  });

  it("still supports a plain string detail (non-provider routes)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "narrativeText must not be empty" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      })
    );

    const error = await suggestLayout(createDocument()).catch((caught) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("narrativeText must not be empty");
    expect((error as ApiError).code).toBeUndefined();
  });
});

describe("inquiry-bundle client (G5 W型 single-tenant)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("putInquiryBundle creates with If-None-Match: * and returns the new ETag", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 201, headers: { ETag: '"1"' } })
    );
    const payload = { schemaVersion: "inquiry-journey.v1", rounds: [{ roundId: "r1" }] };

    const etag = await putInquiryBundle("journey-1", payload, {}, { createIfAbsent: true });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/inquiry-bundles/journey-1");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe("*");
    expect(JSON.parse(init.body as string)).toEqual(payload);
    expect(etag).toBe("1");
  });

  it("putInquiryBundle updates with If-Match carrying the observed revision", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204, headers: { ETag: '"2"' } })
    );

    const etag = await putInquiryBundle("journey-1", { v: 2 }, {}, { etag: "1" });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"1"');
    expect(etag).toBe("2");
  });

  it("getInquiryBundle returns the stored opaque payload and ETag", async () => {
    const stored = { schemaVersion: "inquiry-journey.v1", rounds: [{ roundId: "r1" }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(stored), { status: 200, headers: { "Content-Type": "application/json", ETag: '"3"' } })
    );

    const result = await getInquiryBundle("journey-1");

    expect(result).toEqual({ payload: stored, etag: "3" });
  });

  it("deleteInquiryBundle DELETEs with If-Match", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 })
    );

    await deleteInquiryBundle("journey-1", "3");

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/inquiry-bundles/journey-1");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>)["If-Match"]).toBe('"3"');
  });
});

describe("listDocuments", () => {
  it("fetches GET /docs and returns the metadata array", async () => {
    const body = [
      { id: "doc-1", title: "Alpha", lifecycle_state: "active", updated_at: "2026-08-15T00:00:00Z" },
      { id: "doc-2", lifecycle_state: "archived", updated_at: "2026-08-14T00:00:00Z" },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));

    const result = await listDocuments();

    expect(fetchMock).toHaveBeenCalledWith("/api/docs", { headers: {} });
    expect(result).toEqual(body);
  });

  it("passes createdBy as a query param for the my-documents filter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    await listDocuments({}, "principal-1");
    expect(fetchMock).toHaveBeenCalledWith("/api/docs?createdBy=principal-1", { headers: {} });
  });

  it("rejects a non-array list response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ not: "a list" }), { status: 200 }));
    await expect(listDocuments()).rejects.toThrow("Invalid document list response shape");
  });
});
