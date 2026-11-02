import { authHeaders } from "./auth_headers.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DocumentFetchError,
  DocumentFetchTimeoutError,
  DocumentNotFoundError,
  DocumentShapeError,
  fetchDocument,
  fetchDocumentMetadata,
  loadDocumentClientConfigFromEnv,
  resolveRequestTimeoutMs,
  validateMcpRuntimeProfile,
} from "./document_client.js";

const VALID_DOC = { version: 1, id: "doc1", cards: [], edges: [], islands: [] };

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe("loadDocumentClientConfigFromEnv", () => {
  it("defaults to the direct-launch backend URL and no API key", () => {
    const config = loadDocumentClientConfigFromEnv({});
    expect(config).toEqual({ baseUrl: "http://127.0.0.1:8000", apiKey: undefined });
  });

  it("reads SUI_MCP_API_BASE_URL and SUI_API_KEY, stripping a trailing slash", () => {
    const config = loadDocumentClientConfigFromEnv({
      SUI_MCP_API_BASE_URL: "https://sui-sensemaking.example.internal/",
      SUI_API_KEY: "secret-key",
    });
    expect(config).toEqual({ baseUrl: "https://sui-sensemaking.example.internal", apiKey: "secret-key" });
  });

  it.each(["local-dev", "evaluation", "enterprise-production"])(
    "accepts the single-tenant runtime profile %s",
    (runtimeProfile) => {
      expect(validateMcpRuntimeProfile({ SUI_RUNTIME_PROFILE: ` ${runtimeProfile.toUpperCase()} ` })).toBe(
        runtimeProfile,
      );
    },
  );

  describe("saas-multitenant (ADR-0093)", () => {
    const saas = { SUI_RUNTIME_PROFILE: "saas-multitenant", SUI_MCP_AGENT_CREDENTIAL: "suiag_token" };

    it("fails closed without a tenant-bound agent credential", () => {
      expect(() => loadDocumentClientConfigFromEnv({ SUI_RUNTIME_PROFILE: "saas-multitenant" })).toThrow(
        "SUI_MCP_AGENT_CREDENTIAL",
      );
      expect(() =>
        loadDocumentClientConfigFromEnv({ ...saas, SUI_MCP_AGENT_CREDENTIAL: "not-an-agent-token" }),
      ).toThrow("SUI_MCP_AGENT_CREDENTIAL");
    });

    describe("HTTP transport (ADR-0094)", () => {
      const http = {
        SUI_RUNTIME_PROFILE: "saas-multitenant",
        SUI_MCP_TRANSPORT: "http",
        SUI_MCP_TOKEN_EXCHANGE_ENDPOINT: "https://idp.example/token",
        SUI_MCP_TOKEN_EXCHANGE_CLIENT_ID: "mcp-server",
        SUI_MCP_TOKEN_EXCHANGE_CLIENT_SECRET: "s3cret",
        SUI_MCP_TOKEN_EXCHANGE_AUDIENCE: "sui-sensemaking-agents",
      };

      it("fails closed without the token exchange settings", () => {
        expect(() =>
          loadDocumentClientConfigFromEnv({ SUI_RUNTIME_PROFILE: "saas-multitenant", SUI_MCP_TRANSPORT: "http" }),
        ).toThrow("SUI_MCP_TOKEN_EXCHANGE_*");
      });

      it("rejects a partial token exchange configuration", () => {
        expect(() =>
          loadDocumentClientConfigFromEnv({ ...http, SUI_MCP_TOKEN_EXCHANGE_CLIENT_SECRET: "" }),
        ).toThrow("must be set together");
      });

      it("does not combine a static agent credential with per-caller exchange", () => {
        expect(() => loadDocumentClientConfigFromEnv({ ...http, SUI_MCP_AGENT_CREDENTIAL: "suiag_x" })).toThrow(
          "belongs to the stdio transport",
        );
      });

      it("loads the exchange settings and no static credential", () => {
        const config = loadDocumentClientConfigFromEnv(http);

        expect(config.agentCredential).toBeUndefined();
        expect(config.tokenExchange).toEqual({
          tokenEndpoint: "https://idp.example/token",
          clientId: "mcp-server",
          clientSecret: "s3cret",
          audience: "sui-sensemaking-agents",
        });
      });
    });

    it("sends credentials only to an https backend (http only on loopback)", () => {
      expect(() =>
        loadDocumentClientConfigFromEnv({ ...saas, SUI_MCP_API_BASE_URL: "http://sui.example" }),
      ).toThrow("SUI_MCP_API_BASE_URL must be https");
      expect(() =>
        loadDocumentClientConfigFromEnv({ ...saas, SUI_MCP_API_BASE_URL: "https://user:pw@sui.example" }),
      ).toThrow("credentials");
      expect(
        loadDocumentClientConfigFromEnv({ ...saas, SUI_MCP_API_BASE_URL: "https://sui.example/" }).baseUrl,
      ).toBe("https://sui.example");
      expect(loadDocumentClientConfigFromEnv(saas).baseUrl).toBe("http://127.0.0.1:8000");
    });

    it("rejects an unknown transport", () => {
      expect(() => loadDocumentClientConfigFromEnv({ ...saas, SUI_MCP_TRANSPORT: "ws" })).toThrow(
        "Unknown SUI_MCP_TRANSPORT",
      );
    });

    it("refuses a static API key, which does not prove a tenant", () => {
      expect(() => loadDocumentClientConfigFromEnv({ ...saas, SUI_API_KEY: "static" })).toThrow(
        "SUI_API_KEY must not be set",
      );
    });

    it("sends the per-request bearer instead of any static credential", () => {
      expect(authHeaders({ agentBearer: "exchanged", agentCredential: "suiag_x", apiKey: "k" })).toEqual({
        "Sui-Sensemaking-Agent-Bearer": "Bearer exchanged",
      });
    });

    it("carries only the agent credential, never an API key", () => {
      const config = loadDocumentClientConfigFromEnv(saas);

      expect(config).toEqual({ baseUrl: "http://127.0.0.1:8000", agentCredential: "suiag_token" });
      expect(authHeaders(config)).toEqual({ "Sui-Sensemaking-Agent-Credential": "suiag_token" });
    });
  });

  it("keeps the single-tenant profiles on the static API key", () => {
    expect(authHeaders({ apiKey: "k" })).toEqual({ "X-API-Key": "k" });
    expect(authHeaders({})).toEqual({});
  });

  it("rejects unknown runtime profiles", () => {
    expect(() => loadDocumentClientConfigFromEnv({ SUI_RUNTIME_PROFILE: "production" })).toThrow(
      "Unsupported SUI_RUNTIME_PROFILE",
    );
  });
});

describe("fetchDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests GET /docs/{id} against the configured base URL", async () => {
    const fetchSpy = vi.fn(async () => mockResponse(200, VALID_DOC));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc1");

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:8000/docs/doc1", { headers: {}, redirect: "error", signal: expect.any(AbortSignal) });
  });

  it("sends X-API-Key when configured (the browser client never does; this is a separate process)", async () => {
    const fetchSpy = vi.fn(async () => mockResponse(200, VALID_DOC));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchDocument({ baseUrl: "http://127.0.0.1:8000", apiKey: "secret-key" }, "doc1");

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:8000/docs/doc1", {
      headers: { "X-API-Key": "secret-key" },
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });

  it("URL-encodes the docId", async () => {
    const fetchSpy = vi.fn(async () => mockResponse(200, VALID_DOC));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc with space");

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:8000/docs/doc%20with%20space", { headers: {}, redirect: "error", signal: expect.any(AbortSignal) });
  });

  it("throws DocumentNotFoundError on 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(404, {})));
    await expect(fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "missing")).rejects.toThrow(
      DocumentNotFoundError,
    );
  });

  it("throws DocumentFetchError on other non-ok statuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(500, {})));
    await expect(fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc1")).rejects.toThrow(DocumentFetchError);
  });

  it("distinguishes 401, 403, 5xx in the error text without leaking a body", async () => {
    const cases: Array<[number, string]> = [
      [401, "unauthorized"],
      [403, "forbidden"],
      [503, "backend error"],
    ];
    for (const [status, label] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => mockResponse(status, { detail: "secret-body" })));
      const error = await fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc1").catch((e: Error) => e);
      expect(error).toBeInstanceOf(DocumentFetchError);
      expect((error as Error).message).toContain(`HTTP ${status}`);
      expect((error as Error).message).toContain(label);
      expect((error as Error).message).not.toContain("secret-body");
    }
  });

  it("raises DocumentFetchTimeoutError when the request is aborted by the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    await expect(fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc1")).rejects.toThrow(
      DocumentFetchTimeoutError,
    );
  });

  it.each([
    ["an HTML error page parsed as a string", "<html>502</html>"],
    ["a non-1 version", { ...VALID_DOC, version: 2 }],
    ["a missing id", { ...VALID_DOC, id: undefined }],
    ["cards that are not an array", { ...VALID_DOC, cards: {} }],
    ["islands that are missing", { ...VALID_DOC, islands: undefined }],
    ["null", null],
  ])("rejects %s with DocumentShapeError", async (_label, body) => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200, body)));
    await expect(fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc1")).rejects.toThrow(DocumentShapeError);
  });

  it("rejects a 200 whose body is not JSON with DocumentShapeError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } }) as unknown as Response),
    );
    await expect(fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc1")).rejects.toThrow(DocumentShapeError);
  });

  it("returns the parsed document body on success", async () => {
    const body = { ...VALID_DOC, cards: [{ id: "c1" }] };
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(200, body)));
    const result = await fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc1");
    expect(result).toEqual(body);
  });
});

describe("fetchDocumentMetadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests GET /docs and finds the document by id", async () => {
    const list = [
      { id: "doc1", title: "Alpha", lifecycle_state: "archived", updated_at: "2026-08-15T00:00:00Z" },
      { id: "doc2", lifecycle_state: "active", updated_at: "2026-08-14T00:00:00Z" },
    ];
    const fetchSpy = vi.fn(async () => mockResponse(200, list));
    vi.stubGlobal("fetch", fetchSpy);

    const metadata = await fetchDocumentMetadata({ baseUrl: "http://127.0.0.1:8000" }, "doc1");

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:8000/docs", { headers: {}, redirect: "error", signal: expect.any(AbortSignal) });
    expect(metadata).toEqual(list[0]);
  });

  it("returns null when the list is unavailable (advisory, never breaks the projection)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(500, {})));
    expect(await fetchDocumentMetadata({ baseUrl: "http://127.0.0.1:8000" }, "doc1")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    expect(await fetchDocumentMetadata({ baseUrl: "http://127.0.0.1:8000" }, "doc1")).toBeNull();
  });
});

describe("resolveRequestTimeoutMs (#3312)", () => {
  it("defaults when unset and reads SUI_MCP_REQUEST_TIMEOUT_MS", () => {
    expect(resolveRequestTimeoutMs({})).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(resolveRequestTimeoutMs({ SUI_MCP_REQUEST_TIMEOUT_MS: "2500" })).toBe(2500);
  });

  it.each(["0", "-5", "abc", "1.5", "99", "999999999", ""])("falls back to the default for %j (never unbounded)", (raw) => {
    expect(resolveRequestTimeoutMs({ SUI_MCP_REQUEST_TIMEOUT_MS: raw })).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });
});
