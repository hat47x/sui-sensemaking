import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import type { HttpTransportConfig } from "./oauth_config.js";

// ADR-0094: HTTP transport + saas-multitenant。検証した MCP 宛てトークンを交換し、
// backend には交換後の短命のトークンだけを送ること（パススルーしないこと）を、
// 実際の Express と MCP クライアントで確かめる。IdP と backend は fetch の差し替えで代用する。

const state = vi.hoisted(() => ({ getKey: undefined as JWTVerifyGetKey | undefined }));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: () => {
      if (!state.getKey) throw new Error("test getKey not configured");
      return state.getKey;
    },
  };
});

const { buildHttpApp, MCP_READ_SCOPE } = await import("./http_server.js");

const ISSUER = "https://idp.example/";
const RESOURCE = "https://mcp.sui-sensemaking.example/";
const KID = "test-key-1";
const TOKEN_ENDPOINT = "https://idp.example/token";
const BACKEND = "http://backend.invalid";
const EXCHANGED = "exchanged-backend-token";

const realFetch = globalThis.fetch;

type Recorded = { url: string; headers: Record<string, string>; body?: string };

function headersOf(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function start(exchange: "ok" | "rejected") {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = KID;
  jwk.alg = "RS256";
  state.getKey = createLocalJWKSet({ keys: [jwk] });

  const idp: Recorded[] = [];
  const backend: Recorded[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === TOKEN_ENDPOINT) {
      idp.push({ url, headers: headersOf(init), body: String(init?.body) });
      return exchange === "ok"
        ? new Response(JSON.stringify({ access_token: EXCHANGED, token_type: "Bearer" }), { status: 200 })
        : new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    }
    if (url.startsWith(BACKEND)) {
      backend.push({ url, headers: headersOf(init) });
      if (url.endsWith("/docs/doc1")) {
        return new Response(
          JSON.stringify({
            version: 1,
            id: "doc1",
            createdAt: "2026-10-09T00:00:00.000Z",
            updatedAt: "2026-10-09T00:00:00.000Z",
            transform: { panX: 0, panY: 0, zoom: 1 },
            cards: [{ id: "c1", text: "reviewed", x: 0, y: 0, textReviewed: true }],
            edges: [],
            islands: [],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/docs")) return new Response("[]", { status: 200 });
      return new Response("{}", { status: 200 });
    }
    return realFetch(input, init);
  });

  const config: HttpTransportConfig = {
    host: "127.0.0.1",
    port: 0,
    resource: RESOURCE,
    trustedIssuer: ISSUER,
    jwksUri: "https://idp.example/jwks",
    authorizationServers: [ISSUER],
  };
  const app = buildHttpApp(config, {
    baseUrl: BACKEND,
    tokenExchange: {
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: "mcp-server",
      clientSecret: "s3cret",
      audience: "sui-sensemaking-agents",
    },
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = await new SignJWT({ sub: "agent-client-1", scope: MCP_READ_SCOPE })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(ISSUER)
    .setAudience(RESOURCE)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  return { server, baseUrl, token, idp, backend };
}

describe("buildHttpApp with token exchange (ADR-0094)", () => {
  let context: Awaited<ReturnType<typeof start>> | undefined;

  afterEach(() => {
    context?.server.close();
    context = undefined;
    state.getKey = undefined;
    vi.unstubAllGlobals();
  });

  it("exchanges the caller's token and sends only the exchanged token to the backend", async () => {
    context = await start("ok");
    const client = new Client({ name: "exchange-e2e", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${context.baseUrl}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${context.token}` } },
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "get_context_projection",
        arguments: { docId: "doc1", constraint: "reviewed-only", safeMode: true },
      });
      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
    }

    // IdP へは、検証済みの MCP 宛てトークンを subject_token として、MCP 自身の資格で送る。
    const exchange = context.idp.find((call) => new URLSearchParams(call.body).get("subject_token") === context!.token);
    expect(exchange).toBeDefined();
    expect(new URLSearchParams(exchange!.body).get("audience")).toBe("sui-sensemaking-agents");
    expect(exchange!.headers.authorization).toMatch(/^Basic /);

    // backend へは、交換後のトークンだけを専用ヘッダーで送る。
    expect(context.backend.length).toBeGreaterThan(0);
    for (const call of context.backend) {
      expect(call.headers["sui-sensemaking-agent-bearer"]).toBe(`Bearer ${EXCHANGED}`);
      expect(call.headers.authorization).toBeUndefined();
      expect(call.headers["x-api-key"]).toBeUndefined();
      expect(JSON.stringify(call.headers)).not.toContain(context.token);
    }
  });

  it("closes the request with 502 and never calls the backend when the exchange is rejected", async () => {
    context = await start("rejected");

    const response = await realFetch(`${context.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "token_exchange_failed" });
    expect(context.backend).toHaveLength(0);
  });

  it("does not exchange for a caller that fails OAuth validation", async () => {
    context = await start("ok");

    const response = await realFetch(`${context.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer not-a-jwt" },
      body: "{}",
    });

    expect(response.status).toBe(401);
    expect(context.idp).toHaveLength(0);
  });
});
