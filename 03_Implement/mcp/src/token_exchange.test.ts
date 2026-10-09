import { describe, expect, it, vi } from "vitest";
import { exchangeToken, loadTokenExchangeConfigFromEnv, TokenExchangeError } from "./token_exchange.js";

const CONFIG = {
  tokenEndpoint: "https://idp.example/token",
  clientId: "mcp-server",
  clientSecret: "s3cret/with space",
  audience: "sui-sensemaking-agents",
};

function respond(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("exchangeToken", () => {
  it("sends an RFC 8693 request authenticated as the MCP client and returns the new token", async () => {
    const fetchImpl = respond({ access_token: "backend-token", token_type: "Bearer", expires_in: 300 });

    const token = await exchangeToken(CONFIG, "subject-token", fetchImpl);

    expect(token).toBe("backend-token");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CONFIG.tokenEndpoint);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(form.get("subject_token")).toBe("subject-token");
    expect(form.get("audience")).toBe("sui-sensemaking-agents");
    const expectedBasic = Buffer.from(
      `${encodeURIComponent("mcp-server")}:${encodeURIComponent("s3cret/with space")}`,
    ).toString("base64");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${expectedBasic}`);
  });

  it.each([
    ["a rejected exchange", respond({ error: "invalid_grant" }, 400)],
    ["a non-JSON body", respond("<html>")],
    ["a body without access_token", respond({ token_type: "Bearer" })],
    ["an empty access_token", respond({ access_token: "" })],
    ["an oversized access_token", respond({ access_token: "x".repeat(9000) })],
    ["an oversized response", respond("x".repeat(70_000))],
  ])("fails closed on %s", async (_label, fetchImpl) => {
    await expect(exchangeToken(CONFIG, "subject-token", fetchImpl)).rejects.toBeInstanceOf(TokenExchangeError);
  });

  it("fails closed when the request itself fails, without leaking tokens in the message", async () => {
    const failing = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED with subject-token");
    }) as unknown as typeof fetch;

    const error = await exchangeToken(CONFIG, "subject-token", failing).catch((e: unknown) => e as Error);

    expect(error).toBeInstanceOf(TokenExchangeError);
    expect((error as Error).message).not.toContain("subject-token");
    expect((error as Error).message).not.toContain("s3cret");
  });
});

describe("loadTokenExchangeConfigFromEnv", () => {
  const full = {
    SUI_MCP_TOKEN_EXCHANGE_ENDPOINT: "https://idp.example/token",
    SUI_MCP_TOKEN_EXCHANGE_CLIENT_ID: "mcp-server",
    SUI_MCP_TOKEN_EXCHANGE_CLIENT_SECRET: "s3cret",
    SUI_MCP_TOKEN_EXCHANGE_AUDIENCE: "aud",
  };

  it("returns undefined when nothing is configured", () => {
    expect(loadTokenExchangeConfigFromEnv({})).toBeUndefined();
  });

  it("requires every setting together", () => {
    expect(() => loadTokenExchangeConfigFromEnv({ ...full, SUI_MCP_TOKEN_EXCHANGE_AUDIENCE: undefined })).toThrow(
      "must be set together",
    );
  });

  it("requires https except on loopback, and no embedded credentials", () => {
    expect(() =>
      loadTokenExchangeConfigFromEnv({ ...full, SUI_MCP_TOKEN_EXCHANGE_ENDPOINT: "http://idp.example/token" }),
    ).toThrow("https");
    expect(
      loadTokenExchangeConfigFromEnv({ ...full, SUI_MCP_TOKEN_EXCHANGE_ENDPOINT: "http://127.0.0.1:9000/token" }),
    ).toBeDefined();
    expect(() =>
      loadTokenExchangeConfigFromEnv({ ...full, SUI_MCP_TOKEN_EXCHANGE_ENDPOINT: "https://u:p@idp.example/token" }),
    ).toThrow("credentials");
  });
});
