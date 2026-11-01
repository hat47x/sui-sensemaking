# 生成AIエージェントをMCPで接続する

このガイドは、生成AIのエージェントが読み取り専用のMCPサーバー経由でsui-sensemakingの文書の文脈を読む方法を説明します。読める範囲と読めない範囲、そして判断を人間が保つ境界を示します。

エージェントは文書の文脈や提案の状態を読み、検証に使えます。文書を変更することはできません。提案を採用するか、保留するか、破棄するかは人間が決めます。

対象は、MCPクライアントを設定する人と、そのクライアントから文書を読ませる利用者です。

## 境界

このMCPサーバーは読み取り専用です。

- 書き込み、取り込み、適用、公開のツールはありません。リソースとプロンプトもありません。
- エージェントは提案を作れず、提案を採用もできません。
- AI提案は、人間が判断するまで`proposed`のまま残ります。採用、保留、破棄は人間が行います。エージェントは`get_proposal_status`で、その結果と決定日時を読めます。
- 「レビュー済み」は、カードの`textReviewed`が真であることを指します。未レビューのカードは`cards`に含まれず、本文も返しません。

## エージェントが読めるもの

`get_context_projection`で読めるものは次のとおりです。

- 文書の構造。カードのid、主張の種類（`claimType`）、保留状態（`holdState`）、島のidと題名、関係線。
- 根拠と矛盾の関係。両端のカードがどちらもレビュー済みのものに限ります。
- 空白（void）の種類、解決済みかどうか、関係するid（レビュー済みのカードのidだけ）。
- 物語の検査（A/B）の件数と、問題の向き。本文は含みません。
- 件数。レビュー済み、未レビュー、墨消しされたものの数です。いずれも文書全体の数です。

`get_proposal_status`で読めるものは次のとおりです。

- 文書のAI提案ごとに、`proposalId`、`proposalKind`、`origin`、`status`（`proposed`、`accepted`、`rejected`、`held`）、`sourceBundleHash`、作成日時、決定日時。

## エージェントが読めないもの

- 未レビューのカードの本文。
- `safeMode: true`（既定）のときのカード本文。レビュー済みのカードでも、本文は墨消しされ、文字数だけが分かる表示になります。
- 点数、順位、確度、優先度の項目。どの結果にも含まれません。
- AI提案の差分（diff）と理由（rationale）。
- 文書への書き込み。

## 接続の前に

1. バックエンドを起動します。MCPサーバーはバックエンドから文書を読むため、先に起動しておく必要があります。たとえば`uvicorn sui_sensemaking_api.main:app --port 8000`で起動します。バックエンドに届かない場合、ツールはエラーの結果を返します。
2. 文書のidを確認します。文書の一覧は、バックエンドの`GET /docs`で取得できます。一覧の`id`を`docId`に使います。
3. SafeModeは既定でONです。`safeMode`を省略すると`true`になります。`false`にすると、レビュー済みのカードの本文が返ります。本文を読ませる必要がないかぎり、`true`のままにしてください。
4. バックエンドがAPIキーを要求する場合は、`SUI_API_KEY`を設定します。
5. 実行プロファイル`SUI_RUNTIME_PROFILE`は、手元で試すときは既定の`local-dev`のまま使います。複数テナントのSaaS（`saas-multitenant`）に接続するときは、次の「複数テナントのSaaSへ接続する」に従い、Tenant Adminが発行した資格情報を用意します。

## 複数テナントのSaaSへ接続する

`SUI_RUNTIME_PROFILE=saas-multitenant`では、MCPサーバーはAPIキーでの接続を受け付けません。`SUI_API_KEY`を同時に設定すると、起動を拒否します。通信方式ごとに、次の設定が必須です。

- stdio: Tenant Adminが登録したagent資格情報を、環境変数`SUI_MCP_AGENT_CREDENTIAL`に設定します。値は`suiag_`で始まる不透明な文字列です。設定がない場合や接頭辞が違う場合は、起動を拒否します。
- HTTP: `SUI_MCP_TOKEN_EXCHANGE_ENDPOINT`、`SUI_MCP_TOKEN_EXCHANGE_CLIENT_ID`、`SUI_MCP_TOKEN_EXCHANGE_CLIENT_SECRET`、`SUI_MCP_TOKEN_EXCHANGE_AUDIENCE`の4つをすべて設定します。MCPサーバーは、呼び出し元のトークンを要求ごとにバックエンド宛てのトークンへ交換して使います（ADR-0094）。この方式では`SUI_MCP_AGENT_CREDENTIAL`を設定できません。

資格情報、クライアントの秘密、交換後のトークンは、設定ファイルやログに書かないでください。設定ファイルを共有する場合は、これらの値を含めないでください。

### 資格情報の登録、失効、更新

資格情報の発行は、接続する側ではなく、そのテナントのTenant Adminが行う作業です。エージェントやMCPサーバーは、自分で資格情報を作れません。接続を依頼する人は、次の内容をTenant Adminに伝えます。

1. `agentId`と`label`を決めます。
2. 読ませる文書のidを1件から50件まで、明示して列挙します。登録する人が読める文書に限ります。
3. 有効期限を、タイムゾーンつきで、現在より後かつ90日以内の日時で決めます。

Tenant Adminは`POST /tenant-admin/agent-credentials`で登録します。資格情報の平文は、この登録の応答にだけ出ます。一覧の`GET /tenant-admin/agent-credentials`では、平文もハッシュも見られません。受け取った値はすぐ安全な場所へ保管してください。

- 失効: `POST /tenant-admin/agent-credentials/{agentId}/revoke`で失効します。次の要求から効きます。1つの文書の付与だけを外すときは、`DELETE /tenant-admin/agent-credentials/{agentId}/documents/{docId}`を使います。
- 更新: 期限の延長や付与の追加はできません。失効後の`agentId`も再登録できないため、新しい`agentId`で登録し直し、MCPサーバーの設定を差し替えます。
- OAuthトークンで接続する場合は、`POST /tenant-admin/agent-credentials/{agentId}/oauth-bindings`で、信頼するIdPの`identityProviderId`と`subject`をagentに結びます。

各APIの条件と応答は、[API仕様のAgent資格情報（§2.15）](../02_Architecture/api.md)が正本です。agent資格情報で通せるのは、`GET /docs`、`GET /docs/{doc_id}`、`GET /ai/proposals/status`、`POST /docs/{doc_id}/context-audit`の4つだけです。付与外の文書は、存在しない文書と区別せず`404`になります。

## 生成AIサービスへの送信について

このMCPサーバーのコードは、生成AIのサービスへ直接通信しません。通信先は、設定したバックエンドのURLと、HTTP方式で使う場合に署名検証へ使うJWKS URIだけです。

ツールの結果は、接続したMCPクライアントに返されます。その結果を生成AIのサービスへ送るかどうかは、クライアントの仕様によります。この文書では、個々のクライアントの送信先は確認していません。接続するクライアントが結果をどう扱うかを、事前に確かめてください。

既定の`safeMode: true`でも、カード本文以外は返ります。島の題名は、レビュー済みのものに限って返ります。未レビューの題名は`(未レビュー)`に置き換えます。主張の種類、件数なども返ります。文書の題名と作成者は、エージェントには返しません。

## 設定例（stdio）

生成AIのエージェントが標準入出力でこのサーバーを起動するための設定例です。READMEの設定例と同じ内容です。READMEの例では、Claude DesktopやIDEのMCPクライアントが挙げられています。

最初に、`03_Implement/mcp`で`npm install`を実行します。

```json
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

注意点は次のとおりです。

- `cwd`には、リポジトリの`03_Implement/mcp`の絶対パスを指定します。
- 接続後、標準出力はMCPのJSON-RPCの通信だけに使われます。起動用のラッパーなどで標準出力に文字を書かないでください。診断は標準エラー出力に出ます。
- `SUI_API_KEY`を設定ファイルに書く場合は、そのファイルを共有しないでください。

環境変数（stdio）は次のとおりです。

| 変数 | 既定値 | 役割 |
| --- | --- | --- |
| `SUI_MCP_TRANSPORT` | `stdio` | `stdio`または`http`を指定します。 |
| `SUI_MCP_API_BASE_URL` | `http://127.0.0.1:8000` | 読み取り元のバックエンドのURLです。絶対URLで指定します。 |
| `SUI_API_KEY` | 未設定 | バックエンドがAPIキーを要求する場合に、`X-API-Key`として送ります。 |
| `SUI_RUNTIME_PROFILE` | `local-dev` | `local-dev`、`evaluation`、`enterprise-production`、`saas-multitenant`を受け付けます。`saas-multitenant`はstdioでは`SUI_MCP_AGENT_CREDENTIAL`が必須で、`SUI_API_KEY`とは併用できません。 |
| `SUI_MCP_AGENT_CREDENTIAL` | 未設定 | `saas-multitenant`で必須です。Tenant Adminが登録した`suiag_`で始まる資格情報です。付与された文書の読み取りだけができます。値を設定ファイルやログへ書かないでください。 |

## ツール

| ツール | 引数 | 内容 |
| --- | --- | --- |
| `get_context_projection` | `docId`（必須）、`constraint`（必須）、`safeMode`（省略時は`true`） | 文書の投影を返します。 |
| `get_proposal_status` | `docId`（必須） | 文書のAI提案の状態を返します。 |

どちらのツールも、読み取り専用であることを示す`readOnlyHint`を持ちます。

`constraint`の値は次の意味です。

- `reviewed-only`: レビュー済みのカードだけを`cards`に入れます。
- `evidence`: 根拠の関係の両端にあるカードを入れます。
- `contradiction`: 矛盾の関係の両端にあるカードを入れます。
- `summary`: カードは入れず、構造と件数だけを返します。

文書が見つからない場合は、`Document not found: <docId>`を含むエラーの結果になります。

## 結果の内容（get_context_projection）

結果は、JSONをテキストにしたものです。主な項目は次のとおりです。

- `schemaVersion`（`context-projection.v1`）、`docId`、`constraint`、`safeMode`、`baseDocSignature`（文書のidと更新時刻）
- `cards`: 含まれたカードの`id`、`claimType`、`holdState`（`held`、`pending`、`shelved`、または`null`）、`text`、`reviewed`、`redacted`、`digest`。カードの`meta`（出典`source`と通し番号`seq`を含む）は返しません（ADR-0105）。
- `islands`: 島の`id`、`title`、`digest`
- `digest`: 露出した本文または題名から計算したsha256（`{ "alg": "sha256", "value": ... }`）です。カードは本文を返したときだけ値を持ち、伏せたときは`null`です。島はレビュー済みの題名だけ値を持ちます。レビュー済みの本文や題名を編集すると値が変わり、位置や関係線の変更では変わりません。内容の真実性は保証しません（ADR-0103）。
- `relations`、`evidence`、`contradictions`: 関係線と、根拠・矛盾の関係。`contradictions` は `from` と `to` だけで、人が付けた確認状態（`contradictionState`）と注記（`note`）は含みません（ADR-0104）。`resolved` の矛盾も同じ形で残ります。
- `voids`: 空白の`id`、`kind`、`resolved`、`cardIds`、`islandIds`
- `narrativeChecks`: 物語の検査の`id`、`counts`、`issueDirections`
- `counts`: `reviewed`、`unreviewed`、`redacted`。いずれも文書全体の数です。
- `bundleHash`: 同じ入力と同じ文書から計算されるハッシュです。この値はMCP投影専用で、CE-1の `POST /context/bundle` が返す `bundleHash` とは入力も実装言語も異なり、一致しません。外部の記録では「投影の `bundleHash`」と区別してください。READMEでは、同じ入力で同じ値になることを確認項目にしています。露出した内容だけの版ではなく、文書の版（`baseDocSignature`、つまり文書の`id`と`updatedAt`）を含みます。露出内容が同じでも、文書が保存されて`updatedAt`が進めば値が変わります。ただし`updatedAt`はクライアントが送る値で、サーバーは採番も単調増加の検証もしません。そのため、この版の成分はサーバーが保証する値ではありません。内容だけで版固定したいときは、カードと島の単位digest（`digest`）を使ってください。入力と変わる条件、および`holdState`など入力に含まれない項目の残存リスクは、`02_Architecture/schemas.md`の§1.4にあります。

  なお、書き出しのview.jsonにある`docSignature`は、`baseDocSignature`とは別の項目です。文書のidだけを持ち、`updatedAt`を含まないため、版固定には使えません（`02_Architecture/schemas.md`の§1.4と§8.1）。
- `documentMetadata`: 文書の`id`、`lifecycle_state`、`updated_at`。エージェントには`title`と`created_by`を返さないため、この2つは`null`です。取得できなかった場合も`null`です。文書一覧の最初のページ（既定で500件）に含まれない文書も`null`になります。

点数や順位の項目は、この結果に含まれません。

## 監査

- 読み取りのたびに、MCPサーバーの標準エラー出力に1行のJSONが記録されます。記録には文書のid、`constraint`、`safeMode`、ハッシュが入り、本文は入りません。
- 成功した読み取りは、バックエンドの`POST /docs/{id}/context-audit`にも`channel: "mcp"`で報告されます。この報告はベストエフォートです。報告に失敗しても、読み取りは成功のままです。失敗した場合は、警告が標準エラー出力に出ます。
- 報告がバックエンドの監査の出力先まで届くかは、バックエンドの設定によります。READMEの説明では、既定の読み取りは`safeMode=true`で行われるため、`SUI_AUDIT_ALLOW_IN_SAFE_MODE`が`true`でないと、ディスパッチャが安全モードのイベントを捨てます。この変数の既定値は`false`です。

## 既知の制限

- バックエンドが起動していることが前提です。MCPサーバーはバックエンドを起動しません。
- 未レビューのカードを最初に探索する用途には向きません。レビュー済みの内容を見直し、構造化する用途に使ってください。
- `safeMode: false`では、レビュー済みのカードの本文が返ります。未レビューのカードの本文は返りません。
- レビュー済みの島の題名は、`safeMode`の値に関係なく返ります。レビュー済みの題名が、未レビューのカードの本文を引用している可能性は残ります。
- `documentMetadata`は補助情報です。取得できなかった場合は`null`になり、投影の内容は変わりません。
- AI提案の差分と理由は、このMCPの経路では読めません。
- `npm run verify`は読み取りの契約を確かめますが、監査の出力先への配送は確かめません。

## HTTP方式

`SUI_MCP_TRANSPORT=http`にすると、ストリーミングHTTPのサーバーとして待ち受けます。MCPの入口は`/mcp`です。

| 変数 | 既定値 | 役割 |
| --- | --- | --- |
| `SUI_MCP_HTTP_HOST` | `127.0.0.1` | 待ち受けるホストです。 |
| `SUI_MCP_HTTP_PORT` | `8787` | 待ち受けるポートです。 |
| `SUI_MCP_RESOURCE_URL` | 必須 | このサーバーのリソース識別子です。トークンの`aud`と一致させます。 |
| `SUI_MCP_TRUSTED_ISSUER` | 必須 | トークンの`iss`と完全に一致させる発行者の文字列です。 |
| `SUI_MCP_JWKS_URI` | 必須 | 信頼する発行者のJWKSのURLです。署名の検証に使います。 |
| `SUI_MCP_AUTHORIZATION_SERVERS` | `SUI_MCP_TRUSTED_ISSUER`の値 | `/.well-known/oauth-protected-resource`に載せる一覧です。情報として返すだけで、信頼の根拠にはなりません。 |

`SUI_RUNTIME_PROFILE=saas-multitenant`でHTTP方式を使うときは、バックエンド宛てのトークン交換（RFC 8693）の設定が、次の4つとも必須です。値は設定ファイルやログへ書かないでください。

| 変数 | 既定値 | 役割 |
| --- | --- | --- |
| `SUI_MCP_TOKEN_EXCHANGE_ENDPOINT` | 必須 | IdPのトークンエンドポイントです。httpsで指定します（loopbackだけhttpも可）。資格情報やフラグメントは含めません。 |
| `SUI_MCP_TOKEN_EXCHANGE_CLIENT_ID` | 必須 | 交換のためにIdPへ名乗る、このMCPサーバー自身のOAuthクライアントIDです。 |
| `SUI_MCP_TOKEN_EXCHANGE_CLIENT_SECRET` | 必須 | 上のクライアントの秘密です。設定ファイルやログへ書かないでください。 |
| `SUI_MCP_TOKEN_EXCHANGE_AUDIENCE` | 必須 | 交換後のトークンの宛先です。バックエンドの`SUI_AGENT_OAUTH_AUDIENCE`と一致させます。 |

環境変数の定義は、開発者向けの[MCPサーバーのREADME](../03_Implement/mcp/README.md)を正本とします。この表は、接続する人が必要な範囲を抜き出したものです。

必須の変数が1つでも欠けていると、サーバーは起動を拒否します。

- `/mcp`には、`read:context`スコープを持つ有効なベアラートークンが必要です。
- 無効なトークンには401、スコープが足りないトークンには403（`insufficient_scope`）を返します。
- `/.well-known/oauth-protected-resource`は認証なしで応答し、秘密を含みません。
- このサーバーはトークンを発行しません。信頼する外部の発行者が必要です。`saas-multitenant`では、受け取ったトークンをバックエンド宛てのトークンへ交換する設定も必要です。
- 1つのIPアドレスからのリクエストは、1分あたり60回に制限されます。

HTTP方式を外部に公開する前に、リポジトリの [THREAT_MODEL.md](../THREAT_MODEL.md) の§6-1を確認してください。

## 動作の確認（開発者向け）

バックエンドを起動してから、次のスクリプトで読み取りの契約を確かめられます。確認項目は、ツールの一覧と読み取り専用の注釈、点数の項目がないこと、`bundleHash`の再現性、提案の状態の形です。SafeModeで本文が出ないことや、存在しない文書の扱いは、`npm test`の単体テストで確かめます。

bashの場合は次のとおりです。

```bash
cd 03_Implement/mcp
SUI_MCP_API_BASE_URL=http://127.0.0.1:8000 npm run verify -- [docId] [constraint]
```

PowerShellの場合は次のとおりです。

```powershell
cd 03_Implement\mcp
$env:SUI_MCP_API_BASE_URL = "http://127.0.0.1:8000"
npm run verify -- [docId] [constraint]
```

## 関連文書

- [AI提案の扱い](ce2_low_risk_ai_assist.md): 提案の採用、保留、破棄の判断
- [外部エージェント連携ワークフロー](external_agent_workflow.md): タスクシートをコピーして渡す、MCPとは別の経路
- [データ取り扱い](data_handling.md): 保存、共有、書き出しの扱い
- [セキュリティ](security.md): SafeModeと外部連携の境界
- [設定ガイド](configuration.md): 環境変数の一覧
- [MCPサーバーのREADME（開発者向け）](../03_Implement/mcp/README.md)
