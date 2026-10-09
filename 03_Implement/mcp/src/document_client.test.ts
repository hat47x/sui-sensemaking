import { authHeaders } from "./auth_headers.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DocumentFetchError,
  DocumentNotFoundError,
  fetchDocument,
  fetchDocumentMetadata,
  loadDocumentClientConfigFromEnv,
  validateMcpRuntimeProfile,
} from "./document_client.js";

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
    const fetchSpy = vi.fn(async () => mockResponse(200, { id: "doc1", version: 1 }));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc1");

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:8000/docs/doc1", { headers: {} });
  });

  it("sends X-API-Key when configured (the browser client never does; this is a separate process)", async () => {
    const fetchSpy = vi.fn(async () => mockResponse(200, { id: "doc1", version: 1 }));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchDocument({ baseUrl: "http://127.0.0.1:8000", apiKey: "secret-key" }, "doc1");

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:8000/docs/doc1", {
      headers: { "X-API-Key": "secret-key" },
    });
  });

  it("URL-encodes the docId", async () => {
    const fetchSpy = vi.fn(async () => mockResponse(200, {}));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchDocument({ baseUrl: "http://127.0.0.1:8000" }, "doc with space");

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:8000/docs/doc%20with%20space", { headers: {} });
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

  it("returns the parsed document body on success", async () => {
    const body = { id: "doc1", version: 1, cards: [] };
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

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:8000/docs", { headers: {} });
    expect(metadata).toEqual(list[0]);
  });

  it("returns null when the list is unavailable (advisory, never breaks the projection)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(500, {})));
    expect(await fetchDocumentMetadata({ baseUrl: "http://127.0.0.1:8000" }, "doc1")).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    expect(await fetchDocumentMetadata({ baseUrl: "http://127.0.0.1:8000" }, "doc1")).toBeNull();
  });
});
