import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { metadataHandler } from "@modelcontextprotocol/sdk/server/auth/handlers/metadata.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { HttpTransportConfig } from "./oauth_config.js";
import type { DocumentClientConfig } from "./document_client.js";
import { createServer } from "./server.js";
import { createRemoteBearerTokenVerifier } from "./oauth_verifier.js";
import { exchangeToken, TokenExchangeError } from "./token_exchange.js";

// EXT-CONN-01 subslice C: read-only MCP over streamable HTTP, fronted by
// OAuth 2.1 resource-server auth. THREAT_MODEL.md §6 covers the public-facing
// analysis this file implements (auth, rate limiting, failure behavior).

const MCP_PATH = "/mcp";
const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
export const MCP_READ_SCOPE = "read:context";

/**
 * A conservative default: 60 req/min per client IP, applied to every route
 * including the metadata endpoint. There is exactly one tool behind this
 * server and no legitimate client needs a tighter loop than that; failing
 * closed toward "too slow" is preferable to leaving this open to abuse.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

/**
 * ADR-0094: saas-multitenant では、検証済みの MCP 宛てトークンを交換し、backend 宛ての
 * 短命のトークンを要求ごとの設定に載せる。交換できない要求は、backend を呼ばずに閉じる。
 * MCP 宛てのトークンそのものは、backend へ送らない。
 */
async function documentClientConfigFor(
  base: DocumentClientConfig,
  req: express.Request,
): Promise<DocumentClientConfig | null> {
  if (!base.tokenExchange) return base;
  const subjectToken = req.auth?.token;
  if (!subjectToken) return null;
  try {
    const agentBearer = await exchangeToken(base.tokenExchange, subjectToken);
    return { baseUrl: base.baseUrl, agentBearer };
  } catch (error) {
    if (!(error instanceof TokenExchangeError)) throw error;
    return null;
  }
}

function rejectExchangeFailure(res: express.Response): void {
  res.status(502).json({ error: "token_exchange_failed" });
}

export function buildHttpApp(config: HttpTransportConfig, documentClientConfig: DocumentClientConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  const limiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  const resourceMetadataUrl = new URL(PROTECTED_RESOURCE_METADATA_PATH, config.resource).toString();

  const protectedResourceMetadata: OAuthProtectedResourceMetadata = {
    resource: config.resource,
    authorization_servers: config.authorizationServers,
    bearer_methods_supported: ["header"],
    scopes_supported: [MCP_READ_SCOPE],
    // No score/rank/confidence/priority fields exist on this MCP server's
    // tool output (ADR-0041 CVI anti-scoring); nothing here echoes that
    // vocabulary into the discovery document either.
    resource_name: "sui-sensemaking read-only context projection",
  };
  // metadataHandler returns a Router (it restricts to GET/OPTIONS and adds
  // CORS internally) -- it must be mounted with app.use so Express strips
  // the mount path before the router's own "/" route is matched; app.get
  // would leave req.url unstripped and the router's route would never hit.
  app.use(PROTECTED_RESOURCE_METADATA_PATH, metadataHandler(protectedResourceMetadata));

  const verifier = createRemoteBearerTokenVerifier({
    trustedIssuer: config.trustedIssuer,
    resource: config.resource,
    jwksUri: config.jwksUri,
  });
  const requireAuth = requireBearerAuth({
    verifier,
    requiredScopes: [MCP_READ_SCOPE],
    resourceMetadataUrl,
  });

  // Stateless mode (sessionIdGenerator: undefined): this server has exactly
  // one read-only, idempotent tool and holds no per-client state worth
  // paying session-fixation/session-storage risk to keep across requests.
  // The SDK requires a FRESH transport per request in stateless mode
  // (webStandardStreamableHttp.js: "each request must use a fresh transport")
  // -- a single shared instance returns 500 for post-initialize requests, so
  // a remote client could never complete a full MCP session over HTTP.
  // Stateless mode requires a FRESH server + transport per request
  // (SDK: "each request must use a fresh transport"; the Protocol cannot
  // reconnect). A remote client can then complete a full MCP session over
  // HTTP (initialize -> tools/list -> tools/call).
  app.post(MCP_PATH, requireAuth, async (req, res) => {
    const requestConfig = await documentClientConfigFor(documentClientConfig, req);
    if (!requestConfig) return rejectExchangeFailure(res);
    const server = createServer(requestConfig);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET/DELETE are part of the streamable-HTTP spec (server-initiated
  // notifications, explicit session teardown) but this server never opens a
  // session to notify on or tear down -- still gated behind auth so an
  // unauthenticated caller learns nothing from the response shape either way.
  app.get(MCP_PATH, requireAuth, async (req, res) => {
    const requestConfig = await documentClientConfigFor(documentClientConfig, req);
    if (!requestConfig) return rejectExchangeFailure(res);
    const server = createServer(requestConfig);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  app.delete(MCP_PATH, requireAuth, async (req, res) => {
    const requestConfig = await documentClientConfigFor(documentClientConfig, req);
    if (!requestConfig) return rejectExchangeFailure(res);
    const server = createServer(requestConfig);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });

  return app;
}
