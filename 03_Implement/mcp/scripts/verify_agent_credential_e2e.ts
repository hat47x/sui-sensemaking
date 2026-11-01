#!/usr/bin/env node
// agent資格情報からMCPの実プロセスが投影を取得するまでの結合検証（#3283）。
//
// 1回の実行で、次を確かめる。
//   1. テナントAの管理者が POST /tenant-admin/agent-credentials で資格情報を登録する。
//   2. その資格情報で、MCPのstdioプロセス（SUI_RUNTIME_PROFILE=saas-multitenant）を起動する。
//   3. get_context_projection で、付与した文書の投影が返る。
//   4. 未レビューのカードと島の題名が、MCPの出力に出ない。
//   5. 付与外の文書と存在しない文書は、同じ応答（not found）になる。
//   6. 失効（POST .../revoke）の次の要求で、同じプロセスが401を受ける。
//   7. 失効後に、他の資格情報や他テナントの文書へ届かない。
//   8. 監査eventの主体が agent:<agentId> で、トークンと本文を含まない。
//
// バックエンドは、backend/scripts/serve_agent_mcp_e2e_backend.py が、一時のSQLiteと合成の文書で立てる。
// PostgresとIdPは使わない（RLSは test_agent_credential_postgres_rls.py の担当）。実資料と本番の資格情報は使わない。
//
// 使い方（03_Implement/mcp で。tsx 経由で動く）:
//   npm run verify:agent-e2e
// 環境変数:
//   SUI_E2E_PYTHON  backendの依存を入れたPython（既定: python3、Windowsは python）

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const mcpDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const backendDir = join(mcpDir, "..", "backend");
const python = process.env.SUI_E2E_PYTHON || (process.platform === "win32" ? "python" : "python3");

const checks: string[] = [];
function check(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`NG: ${message}`);
  }
  checks.push(message);
  console.log(`  ok  ${message}`);
}

type Ready = { port: number; auditLog: string };

async function startBackend(workdir: string): Promise<{ child: ChildProcessWithoutNullStreams; ready: Ready }> {
  const child = spawn(python, ["scripts/serve_agent_mcp_e2e_backend.py", "--workdir", workdir], {
    cwd: backendDir,
    env: { ...process.env, PYTHONPATH: "src", SUI_LLM_PROVIDER: "none" },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const lines = createInterface({ input: child.stdout });
  const ready = await new Promise<Ready>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`backend did not become ready\n${stderr}`)), 90_000);
    lines.on("line", (line) => {
      if (process.env.SUI_E2E_DEBUG) console.error("[backend]", line);
      if (line.startsWith("READY ")) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice("READY ".length)) as Ready);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`backend exited early (${code})\n${stderr}`));
    });
  });
  return { child, ready };
}

const ADMIN_HEADERS = {
  "content-type": "application/json",
  "Sui-Sensemaking-Tenant-Session-Version": "session-v1",
};

async function register(base: string, agentId: string, docIds: string[]): Promise<string> {
  const response = await fetch(`${base}/tenant-admin/agent-credentials`, {
    method: "POST",
    headers: ADMIN_HEADERS,
    body: JSON.stringify({
      agentId,
      label: `e2e ${agentId}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      docIds,
    }),
  });
  const body = (await response.json()) as { credential?: string };
  if (response.status !== 201 || !body.credential) {
    throw new Error(`registration failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }
  return body.credential;
}

async function startMcp(base: string, credential: string): Promise<Client> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "SUI_API_KEY") env[key] = value;
  }
  Object.assign(env, {
    SUI_MCP_TRANSPORT: "stdio",
    SUI_RUNTIME_PROFILE: "saas-multitenant",
    SUI_MCP_AGENT_CREDENTIAL: credential,
    SUI_MCP_API_BASE_URL: base,
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["node_modules/tsx/dist/cli.mjs", "src/index.ts"],
    cwd: mcpDir,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "sui-agent-credential-e2e", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function projection(client: Client, docId: string, safeMode: boolean) {
  const result = await client.callTool({
    name: "get_context_projection",
    arguments: { docId, constraint: "reviewed-only", safeMode },
  });
  const text = (result.content as Array<{ text?: string }>)?.[0]?.text ?? "";
  return { isError: result.isError === true, text };
}

const workdir = mkdtempSync(join(tmpdir(), "sui-agent-e2e-"));
let backend: ChildProcessWithoutNullStreams | undefined;
let client: Client | undefined;
try {
  console.log("バックエンドを起動する（一時のSQLite、合成の文書）");
  const started = await startBackend(workdir);
  backend = started.child;
  const base = `http://127.0.0.1:${started.ready.port}`;

  console.log("1. 管理APIで資格情報を登録する");
  const credential = await register(base, "agent-e2e", ["doc-granted"]);
  check(credential.startsWith("suiag_"), "登録の応答が suiag_ で始まる資格情報を返す");

  console.log("2. その資格情報でMCPのstdioプロセスを起動する");
  client = await startMcp(base, credential);
  const { tools } = await client.listTools();
  check(
    tools.map((t) => t.name).sort().join(",") === "get_context_projection,get_proposal_status",
    "MCPが読み取り専用の2ツールだけを公開する",
  );

  console.log("3. 付与した文書の投影を取得する（safeMode=false）");
  const granted = await projection(client, "doc-granted", false);
  check(!granted.isError, "付与した文書の get_context_projection が成功する");
  const parsed = JSON.parse(granted.text) as {
    baseDocSignature?: string;
    bundleHash?: string;
    cards?: Array<{ id: string; text?: string; digest?: { alg?: string; value?: string } | null }>;
    islands?: Array<{ id: string; title?: string; digest?: { alg?: string; value?: string } | null }>;
  };
  check(typeof parsed.bundleHash === "string" && parsed.bundleHash.length > 0, "bundleHashが返る");
  check(
    typeof parsed.baseDocSignature === "string" && parsed.baseDocSignature.startsWith("doc-granted:"),
    "baseDocSignatureが文書全体の版として返る",
  );
  const cardIds = (parsed.cards ?? []).map((card) => card.id).sort();
  check(
    cardIds.join(",") === "c-reviewed,c-reviewed-2",
    `レビュー済みのカード2件だけが返る（実際: ${cardIds.join(",")}）`,
  );
  for (const card of parsed.cards ?? []) {
    check(
      card.digest?.alg === "sha256" && /^[0-9a-f]{64}$/.test(card.digest?.value ?? ""),
      `${card.id} の単位digestが返る`,
    );
  }
  check(
    (parsed.islands ?? []).some(
      (island) => island.digest?.alg === "sha256" && /^[0-9a-f]{64}$/.test(island.digest.value),
    ),
    "レビュー済みの島の単位digestが返る",
  );
  check(granted.text.includes("E2E-REVIEWED-TEXT"), "safeMode=false でレビュー済みの本文が返る");

  console.log("4. 未レビューの内容がMCPの出力に出ない");
  check(!granted.text.includes("E2E-SECRET-"), "未レビューの本文、島の題名、要約、文書の題名が出ない");
  check(!granted.text.includes("c-unreviewed"), "未レビューのカードのidが出ない");
  check(!granted.text.includes("e-to-unreviewed"), "未レビューのカードを端点とする根拠リンクが出ない");
  const islandTitles = (parsed.islands ?? []).map((island) => island.title);
  check(
    islandTitles.includes("E2E-REVIEWED-ISLAND-TITLE"),
    "レビュー済みの島の題名は返る（ADR-0098）",
  );
  const safe = await projection(client, "doc-granted", true);
  check(!safe.isError && !safe.text.includes("E2E-REVIEWED-TEXT"), "safeMode=true ではカード本文が返らない");
  const repeat = await projection(client, "doc-granted", false);
  check(
    (JSON.parse(repeat.text) as { bundleHash?: string }).bundleHash === parsed.bundleHash,
    "同じ入力でbundleHashが一致する",
  );

  console.log("5. 付与外の文書は、存在しない文書と区別できない");
  const ungranted = await projection(client, "doc-ungranted", false);
  const missing = await projection(client, "doc-does-not-exist", false);
  const otherTenant = await projection(client, "doc-b-only", false);
  check(ungranted.isError && missing.isError && otherTenant.isError, "3件とも失敗する");
  check(
    ungranted.text.replace("doc-ungranted", "X") === missing.text.replace("doc-does-not-exist", "X") &&
      otherTenant.text.replace("doc-b-only", "X") === missing.text.replace("doc-does-not-exist", "X"),
    "付与外・存在しない・他テナントの応答が、docIdを除いて同じ",
  );
  check(!ungranted.text.includes("E2E-"), "失敗の応答に本文が含まれない");

  console.log("6. 失効の次の要求で401になる");
  const revoke = await fetch(`${base}/tenant-admin/agent-credentials/agent-e2e/revoke`, {
    method: "POST",
    headers: ADMIN_HEADERS,
  });
  check(revoke.status === 204, "失効が204で成功する");
  const afterRevoke = await projection(client, "doc-granted", false);
  check(afterRevoke.isError && /HTTP 401/.test(afterRevoke.text), `同じMCPプロセスが401を受ける（実際: ${afterRevoke.text.slice(0, 80)}）`);

  console.log("7. 失効しても他の資格情報は影響を受けない");
  const second = await register(base, "agent-e2e-2", ["doc-granted"]);
  const client2 = await startMcp(base, second);
  try {
    const again = await projection(client2, "doc-granted", false);
    check(!again.isError, "別のagentIdの資格情報では取得できる");
  } finally {
    await client2.close();
  }

  console.log("8. 監査event");
  check(existsSync(started.ready.auditLog), "監査eventが記録される");
  const events = readFileSync(started.ready.auditLog, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const agentEvents = events.filter((event) => event.principalKind === "agent");
  check(agentEvents.length > 0, `agent主体のeventがある（${agentEvents.length}件）`);
  check(
    agentEvents.every((event) => event.tenantId === "tenant-a"),
    "agentのeventのtenantIdがすべてtenant-a",
  );
  const serialized = JSON.stringify(events);
  check(!serialized.includes(credential) && !serialized.includes(second), "監査eventに資格情報が含まれない");
  check(!serialized.includes("E2E-REVIEWED-TEXT") && !serialized.includes("E2E-SECRET-"), "監査eventに本文が含まれない");

  console.log(`\n結合検証 OK（${checks.length}項目）`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => undefined);
  if (backend) {
    backend.stdin.end();
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        backend!.kill();
        resolve(undefined);
      }, 10_000);
      backend!.on("exit", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  }
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    // 後始末の失敗は、結果に影響させない。
  }
}
