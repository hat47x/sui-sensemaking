// ADR-0094: OAuth 2.0 トークン交換 (RFC 8693) のクライアント。
//
// HTTP transport の MCP サーバーは、自分宛て (aud = MCP) のトークンを検証する。その
// トークンを backend へそのまま渡す（パススルー）ことは、MCP の認可仕様が禁じている。
// そこで、検証済みのトークンを subject_token として IdP のトークンエンドポイントで
// 交換し、audience が backend 宛ての短命のトークンを得て、backend へ送る。
//
// このプロセスは、トークンを発行も登録もしない（リソースサーバーのまま）。持つ秘密は、
// 交換のために IdP へ名乗る自分自身のクライアント秘密だけで、トークンの内容は一切ログに
// 出さない。

export type TokenExchangeConfig = {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  /** 交換後のトークンの宛先 (backend)。IdP登録簿の audience と一致させる。 */
  audience: string;
};

export class TokenExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenExchangeError";
  }
}

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TOKEN_LENGTH = 8192;

export function loadTokenExchangeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TokenExchangeConfig | undefined {
  const entries = {
    tokenEndpoint: env.SUI_MCP_TOKEN_EXCHANGE_ENDPOINT?.trim(),
    clientId: env.SUI_MCP_TOKEN_EXCHANGE_CLIENT_ID?.trim(),
    clientSecret: env.SUI_MCP_TOKEN_EXCHANGE_CLIENT_SECRET?.trim(),
    audience: env.SUI_MCP_TOKEN_EXCHANGE_AUDIENCE?.trim(),
  };
  const present = Object.values(entries).filter(Boolean).length;
  if (present === 0) return undefined;
  if (present !== 4) {
    throw new TokenExchangeError(
      "SUI_MCP_TOKEN_EXCHANGE_ENDPOINT, _CLIENT_ID, _CLIENT_SECRET and _AUDIENCE must be set together.",
    );
  }
  const endpoint = new URL(entries.tokenEndpoint as string);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    throw new TokenExchangeError("SUI_MCP_TOKEN_EXCHANGE_ENDPOINT must be https (http only on loopback).");
  }
  if (endpoint.username || endpoint.password || endpoint.hash) {
    throw new TokenExchangeError("SUI_MCP_TOKEN_EXCHANGE_ENDPOINT must not carry credentials or a fragment.");
  }
  return entries as TokenExchangeConfig;
}

/**
 * subject_token（検証済みの MCP 宛てトークン）を、backend 宛ての短命のトークンに交換する。
 * 失敗はすべて TokenExchangeError にする。メッセージには、トークンや IdP の応答本文を含めない。
 */
export async function exchangeToken(
  config: TokenExchangeConfig,
  subjectToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: GRANT_TYPE,
    subject_token: subjectToken,
    subject_token_type: ACCESS_TOKEN_TYPE,
    requested_token_type: ACCESS_TOKEN_TYPE,
    audience: config.audience,
  });
  const basic = Buffer.from(
    `${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`,
  ).toString("base64");

  let response: Response;
  try {
    response = await fetchImpl(config.tokenEndpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        Authorization: `Basic ${basic}`,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new TokenExchangeError("Token exchange request failed.");
  }
  if (!response.ok) {
    throw new TokenExchangeError(`Token exchange was rejected (HTTP ${response.status}).`);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new TokenExchangeError("Token exchange response is too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TokenExchangeError("Token exchange response is not valid JSON.");
  }
  const accessToken = (parsed as { access_token?: unknown }).access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0 || accessToken.length > MAX_TOKEN_LENGTH) {
    throw new TokenExchangeError("Token exchange response has no usable access_token.");
  }
  return accessToken;
}
