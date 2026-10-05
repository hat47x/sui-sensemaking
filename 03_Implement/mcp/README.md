# sui-sensemaking-mcp

sui-sensemakingの `ContextBundle` の投影を読み取り専用で公開するMCPサーバーです。通信はstdio（EXT-CONN-01 サブスライスB）か、ストリーミングHTTPとOAuth 2.1のリソースサーバー認証（サブスライスC）のどちらかを使えます。`ADR-0054` のステージ1にあたります。

独立したパッケージで、npmやyarnのワークスペースには属さず、`03_Implement/frontend` とlockfileも `node_modules` も共有しません。`../frontend/src/export/context_bundle_projection.ts` と、その推移的な依存である `domain/` は、コピーせずに相対パスで取り込みます。これにより、SafeModeの墨消しと順位付け禁止のロジックを、両方の面で一つに保てます。

## 公開するもの

読み取り専用のツールを2つ公開します。

1. `get_context_projection({ docId, constraint, safeMode? })`。フロントエンドの投影の中核である `buildContextProjection` を呼びます。`constraint` は `reviewed-only | evidence | contradiction | summary` のいずれかです。`safeMode` は省略すると `true`（安全な既定値）になります。
2. `get_proposal_status({ docId })`。文書のCE4提案のライフサイクルを返します。AIの各提案が、まだproposal-onlyのまま（`status=proposed`）か、人間が決定した（`accepted | rejected | held`、`decidedAt` つき）かが分かります。生成AIの検証役は、提案が自動適用されていないことと、人間の決定の経緯を、何も変更せずに確認できます。

**適用範囲（DOGFOOD-05）**: 未レビューのカードは、どの `constraint` でも公開しません。`safeMode: false` でも、未レビューのカードは `cards=0` と報告します（`SEC-CONTEXT-PROJECTION-01` で安全側に拒否）。この経路は、**レビュー済み**の内容を見直して構造化するためのもので、未レビューの資料を最初に探索する用途ではありません。レビュー済みカードの作業状態を尊重したいAIの協働者には、`holdState` のメタデータを返します（DOGFOOD-08）。このサーバーで未レビューの内容を読むことはできません。

リソースもプロンプトも書き込みツールもありません。2つのツールには `readOnlyHint: true` が付いています。`tools/list` と、`initialize` の応答に `resources` capabilityが無いことは、`src/context_projection_tool.test.ts` が固定のスナップショットと照合して固定しています。今後の変更でcapabilityが増えたように見える場合は、このファイルを確認してください。

## 対象外とすること

- 書き込み、取り込み、適用、公開、サンプリング、エリシテーションの機能は、どちらの通信方式にも持たせません。後述のCE-4監査のPOSTが、このサーバーが行う唯一の外向きの呼び出しです。これは提供済みの投影を報告する*読み取りの監査*で、投影した文書を変更するものではありません。
- **リソースサーバーに徹します。** このプロセスは、トークンの発行、クライアントの登録、認可や同意のエンドポイントの運用をしません。信頼済みの外部IdPが発行したベアラートークンを検証するだけです（`ADR-0054`。`ADR-0020` の「本番のIdPやAuthorization Serverは運用しない」という立場とも整合します）。このパッケージには、トークンを発行するコードがありません。

## 実行方法

```bash
npm install
npm run typecheck
npm test
npm start   # runs src/index.ts (transport selected by SUI_MCP_TRANSPORT)

# Client-based verification (generative-AI path; requires running backend).
# Run via tsx (npm run verify) — the script imports a .ts module and uses TS
# `as` syntax, which plain Node 20 rejects:
SUI_MCP_API_BASE_URL=http://127.0.0.1:8000 npm run verify -- [docId] [constraint]
```

### 生成AIのMCPクライアントを接続する（設定例）

生成AIのエージェント（Claude Desktop、IDEのMCPクライアントなど）からstdioでこのサーバーを使うには、クライアントのMCPサーバー設定に追加します。先にバックエンドを起動しておく必要があります（`uvicorn sui_sensemaking_api.main:app --port 8000`）。

```jsonc
{
  "mcpServers": {
    "sui-sensemaking": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/absolute/path/to/sui-sensemaking/03_Implement/mcp",
      "env": {
        "SUI_MCP_API_BASE_URL": "http://127.0.0.1:8000",
        "SUI_MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

この経路を使うAIエージェント向けの注意点です。
- ツールは `get_context_projection({ docId, constraint, safeMode })` の1つで、読み取り専用です。
- **未レビューのカードは、どの `constraint` でも公開しません**（安全側に拒否します。上の適用範囲を参照）。レビュー済みの内容に使ってください。`holdState` のメタデータから、保留、未確定、棚上げのカードが分かります（DOGFOOD-08）。
- 投影には、生成AIが検証できる構造の状態も含まれます。`voids`（kind、refs、resolved。KJ-VOIDS-01）と `narrativeChecks`（A/Bの向きと件数。KJ-AB-CROSS-CHECK-01）です。どちらもSafeModeで安全に扱えます（カードの本文も、issueのメッセージも含みません）。
- HTTPとOAuth 2.1のリソースサーバーで使うには、`SUI_MCP_TRANSPORT=http` と必須のOAuth用の環境変数を設定します（下の「通信方式の選択」を参照）。トークンは、設定した信頼済みの発行者が発行し、`read:context` スコープを持つ必要があります。

### 生成AIによる検証の手順

生成AIのエージェントは、`get_context_projection` を呼んで期待される契約を確かめることで、配信中のアプリが正しく動くことを検証できます。単体のクライアント `scripts/verify_mcp.ts`（`npm run verify` で実行）がこの検証をそのまま行います。下の表が、その確認内容です。

| Scenario | Call | Expected (assert) |
| --- | --- | --- |
| SafeMode fail-closed | `get_context_projection({ docId, constraint: "reviewed-only", safeMode: true })` on a doc with unreviewed cards | `cards[].redacted === true`; `counts.unreviewed > 0`; unreviewed text is absent |
| holdState projection | same call on a doc with held/shelved cards | `cards[].holdState` is `held` / `shelved` / `pending` (DOGFOOD-08) |
| Anti-scoring | serialize the projection | no `score` / `rank` / `confidence` / `priority` tokens |
| not_found | `get_context_projection({ docId: "<missing>", ... })` | `isError: true` with a plain message — the transport is alive, the doc is not retrievable (DOGFOOD-03/06) |
| void state | same call on a doc that has stored voids | `voids` lists each void's kind/refs/resolved (KJ-VOIDS-01) |
| narrative A/B | same call on a doc with narrative checks | `narrativeChecks[].issueDirections` and `counts` are present — and `verify_mcp.ts` **asserts the per-check counts** (`bMissingInA`/`aMissingInB`) so a generative-AI verifier can rely on the A/B totals, not just the directions (KJ-AB-CROSS-CHECK-01) |
| lifecycle | same call on a doc | `documentMetadata.lifecycle_state` (`active` / `archived`) and `created_by` are present (ADR-0073 / 第2反復) |
| archived read-only | same call on an archived doc | `documentMetadata.lifecycle_state === "archived"`; the server enforces review-only (`PUT /docs/{id}` → **423 Locked**, code `document_archived`, even with a current ETag — ADR-0073 D2=A). A generative-AI can cross-check the write contract directly over the HTTP API or via `verify_api_write.sh` (checks 12–14) |
| bundle determinism | call twice with identical inputs | identical `bundleHash` |

解釈の規則です。`not_found` や `error` を伴う `isError` の結果は、対象の文書が存在しないことを示す**有効なシグナル**であり、MCP経路の失敗ではありません。通信は動き、リクエストはサーバーに届き、失敗は分類されています。

上の `mcp-context-read.v1` のローカル記録に加えて、**成功した**読み取りはすべて、バックエンドの `POST /docs/{id}/context-audit`（CE-4）エンドポイントに `channel="mcp"` で報告されます（`operation=query`、`command=context-query`、`equivalenceKey=queryCanonicalHash`、`bundleHash=projection.bundleHash`、`safeMode`、`dryRun=true`、`sideEffect=none`）。報告は `src/audit_log.ts` の `emitContextAuditEvent` が行います。これで、以前あったチャネル列挙の欠落が解消されました。MCP経由の読み取りも、api、cli、guiの呼び出しと同じバックエンドの監査証跡で追跡できます。報告は**ベストエフォート**です。同期的なローカル記録が読み取りの相関になるため、CE-4のPOSTが失敗しても、成功した読み取りがエラーになることはありません（構造化された警告をstderrに出します）。バックエンドがその読み取りを受け取ったことを確かめたい生成AIの検証役は、配備先の監査の出力先を直接照合してください。`verify_mcp.ts` 自体が検証するのは読み取り経路で、出力先への配送ではありません。

連鎖の全体（MCPの読み取り、CE-4の `channel="mcp"` イベント、バックエンド、設定したHTTP監査の出力先）を一度の自己完結した実行で検証するには、ドッグフードのE2Eを使います。

```bash
cd 03_Implement/backend
.venv/bin/python scripts/verify_mcp_ce4_audit_e2e.py   # expect "Result: 9 passed, 0 failed"
```

このE2Eは、ローカルの監査の出力先と、`SUI_AUDIT_TRANSPORT=http` を設定してマイグレーション済みのバックエンドを起動します。`SUI_AUDIT_ALLOW_IN_SAFE_MODE=1` も設定します。MCPの読み取りはsafeMode=trueなので、これがないとディスパッチャがセーフモードのイベントを捨てるためです。そこへ `verify_mcp.ts` を実行し、読み取った文書について `channel="mcp"`、`operation=query` のイベントを出力先が受け取ったことを確かめます。

### 通信方式の選択

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUI_MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |

### stdio通信（サブスライスB）

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUI_RUNTIME_PROFILE` | `local-dev` | `local-dev`, `evaluation`, `enterprise-production`を受理する。`saas-multitenant`はtenant-bound MCP credentialが未実装のため起動拒否する。 |
| `SUI_MCP_API_BASE_URL` | `http://127.0.0.1:8000` | Backend base URL this process fetches `GET /docs/{id}` from. Not the frontend's browser-relative `SUI_FRONTEND_API_BASE` -- this process runs outside the frontend's nginx proxy and needs an absolute URL. |
| `SUI_API_KEY` | unset | Sent as `X-API-Key` when the backend requires it. The browser client relies on same-origin proxying instead; this standalone process must send it itself. |

接続後、stdoutはMCPのJSON-RPCストリーム専用です。ほかのものは一切書き込まないでください。診断はすべてstderrへ出します。これは、stdioで配備しない場合も含め、通信方式によらず同じ扱いです。

### HTTP通信とOAuth 2.1のリソースサーバー（サブスライスC）

`SUI_MCP_TRANSPORT=http` のとき、このプロセスは公開用の待ち受けポートを開きます。上の `SUI_API_KEY` と `SUI_MCP_API_BASE_URL` は引き続き適用されます（バックエンドの取得は通信方式に依存しません）。次の変数も追加で必須で、許容的な既定値はありません。値が1つでも欠けていれば、認証なしやワイルドカードで信頼するモードへ戻らず、起動時に安全側で拒否します。

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUI_MCP_HTTP_HOST` | `127.0.0.1` | Listen host. |
| `SUI_MCP_HTTP_PORT` | `8787` | Listen port. |
| `SUI_MCP_RESOURCE_URL` | *(required)* | This server's own resource identifier (RFC 8707). Must equal the `aud` claim tokens are issued for. |
| `SUI_MCP_TRUSTED_ISSUER` | *(required)* | Exact issuer string tokens must present in `iss`. Matched exactly, no prefix/wildcard matching. |
| `SUI_MCP_JWKS_URI` | *(required)* | JWKS endpoint of the trusted issuer, used to verify token signatures. |
| `SUI_MCP_AUTHORIZATION_SERVERS` | `[SUI_MCP_TRUSTED_ISSUER]` | Comma-separated list advertised in `/.well-known/oauth-protected-resource` (RFC 9728). Purely informational to clients -- not itself trusted for anything. |

動作は次のとおりです。

- `POST/GET/DELETE /mcp` には、`read:context` スコープを持つ有効なベアラートークン（`Authorization: Bearer <token>`）が必要です。トークンが無い、無効、期限切れ、発行者違い、audience違いの場合は401を返します。有効でも必要なスコープが無いトークンには、403 `insufficient_scope` を返します。どちらの応答にも、SDKの `requireBearerAuth` による `WWW-Authenticate` チャレンジが付きます。
- `GET /.well-known/oauth-protected-resource` は、意図的に認証なしです（RFC 9728 の要求です）。返すのは秘密を含まないディスカバリのメタデータだけです。
- メタデータのエンドポイントを含むすべてのルートで、IPごとに1分あたり60リクエストのレート制限を共有します。
- 通信はステートレスです（`sessionIdGenerator: undefined`）。クライアントごとのセッション状態がないので、固定されたり使い果たされたりしません。ステートレスモードでは、リクエストごとに新しいサーバーとトランスポートが必要です（SDKの要件）。このサーバーはそうしており、リモートのクライアントはHTTPでMCPセッションを最後まで実行できます（initialize、tools/list、tools/call の順）。`http_server.test.ts` で確認済みです。
- この面の脅威分析の全体は `THREAT_MODEL.md` の §6-1 を参照してください。
