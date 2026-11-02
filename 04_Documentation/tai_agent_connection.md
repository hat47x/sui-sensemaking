# TAI接続spikeの手順

TAIがSUIのレビュー済み投影を読み、版を固定して再観測するための最小手順です。対象は、Tenant Adminが発行するagent資格情報と、MCPまたは`GET /docs/{id}`のagent経路です。実テナントの値は、この文書へ書かず、実行環境のsecret managerか手元の環境変数へ置いてください。

## 前提

- 対象テナントと、読み取りを許可する文書の`docId`が決まっている。
- 対象文書に、レビュー済みのカードが1件以上ある。未レビューのカードだけでは投影が空になる。
- Tenant Adminの権限を持つ人が、資格情報を発行できる。
- MCPを使う場合は、`03_Implement/mcp`のセットアップが済んでいる。

## 1. 資格情報を発行する

Tenant Adminのセッションで実行します。トークンは応答で一度だけ返るため、標準出力へ残さず、secret managerか環境変数へ移してください。

```bash
export SUI_API_BASE="https://sui.example.invalid"
export SUI_TENANT_SESSION_VERSION="<tenant-session-version>"
export SUI_ADMIN_TOKEN="<admin-session-token>"

curl -sS -X POST "$SUI_API_BASE/tenant-admin/agent-credentials" \
  -H "Authorization: Bearer $SUI_ADMIN_TOKEN" \
  -H "Sui-Sensemaking-Tenant-Session-Version: $SUI_TENANT_SESSION_VERSION" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "tai-spike-1",
    "label": "TAI SCN-001 spike",
    "expiresAt": "2026-12-01T00:00:00+09:00",
    "docIds": ["<doc-id>"]
  }'
```

- `expiresAt`は未来かつ90日以内。
- `docIds`は1〜50件。発行する人が読める文書だけを指定する。
- 応答の`credential`を`SUI_AGENT_CREDENTIAL`へ入れる。同じ`agentId`は失効後も再利用できない。作り直すときは新しい`agentId`にする。

## 2. MCPを設定する

HTTP transportの例です。値は環境変数で渡し、設定ファイルへトークンを直書きしないでください。

```bash
export SUI_MCP_TRANSPORT="http"
export SUI_MCP_API_BASE_URL="$SUI_API_BASE"
export SUI_MCP_AGENT_CREDENTIAL="<credential>"
```

stdioを使う場合も、`SUI_MCP_AGENT_CREDENTIAL`と`SUI_MCP_API_BASE_URL`は同じです。MCPの起動方法は[mcp_agent_connection.md](mcp_agent_connection.md)を参照してください。

## 3. 投影を取得する

MCPの`get_context_projection`を、次の引数で呼びます。

```json
{
  "docId": "<doc-id>",
  "constraint": "reviewed-only",
  "safeMode": false
}
```

`GET /docs/{id}`を直接使う場合も、agent資格情報のヘッダーは同じです。MCPを使わない場合は、投影の組み立てに必要なフィールドが減るため、TAI側の記録形式を確認してください。

## 4. 記録する値

次の3点を組にして保存します。

| 値 | どこから取るか | 意味 |
|---|---|---|
| `baseDocSignature` | 投影の`baseDocSignature` | `<docId>:<updatedAt>`。クライアントが送った`updatedAt`に依存する。 |
| `bundleHash` | 投影の`bundleHash` | 露出した投影全体の決定的なsha256。単位digestは入力に含まない。 |
| `cards[].digest` / `islands[].digest` | 各要素の`digest` | 露出した本文・題名の単位digest。`alg=sha256`、伏せた場合は`null`。 |

`bundleHash`だけではカード単位の同一性を復元できません。`baseDocSignature`だけでは内容の同一性を保証できません。3つを組にして、再観測の前後を照合します。

## 5. 人が編集して再観測する

1. 人がSUIで、レビュー済みのカード本文か島の題名を編集する。
2. 同じ`docId`、同じ`safeMode: false`で投影を取り直す。
3. `bundleHash`と、編集した要素の`digest`が変わることを確認する。
4. 編集していない要素の`digest`が変わっていないことを確認する。

未レビューのカードを編集しても、`bundleHash`と単位digestは変わりません。これは、未レビューの内容を投影へ出さないためです。

## 6. 失敗時の切り分け

| 症状 | 確認すること | 対処 |
|---|---|---|
| HTTP 401 | 資格情報の期限、失効、形式 | 新しい`agentId`で再発行する。 |
| HTTP 404 | 文書の付与、テナント、`docId` | 付与対象を確認する。未付与・不存在・他テナントは同じ応答になる。 |
| HTTP 409（登録時） | `agentId`の再利用 | 新しい`agentId`にする。 |
| HTTP 503（TEI投影） | `SUI_TEI_REFERENCE_DIR`と紐付け | TAIのagent経路では使わない。TEI投影は403のまま。 |
| カードが空 | レビュー済みカードの有無、`docIds` | 人がレビュー済みにしたカードを含む文書を付与する。 |
| 本文が`[withheld]` | `safeMode`が`true` | レビュー済み本文を読む用途では`safeMode: false`を明示する。 |
| `bundleHash`が変わらない | 編集したカードが未レビュー、または投影対象外 | レビュー済みのカードを編集する。 |

## 7. 安全境界

- 未レビューのカード本文、ナラティブ本文、TEI投影はagentへ返さない。
- agentからの提案POSTは使わない。提案は人が貼り付ける既存経路を使う。
- 資格情報は人間のTenant Adminが発行する。TAIが自分で発行しない。
- 取得した投影とトークンを、監査ログやIssueへ貼らない。

## 8. 記録の雛形

実テナントの値は、この雛形をコピーした手元の記録へ入れ、リポジトリへはコミットしないでください。

```text
spike日時:
tenant:
docId:
agentId:
baseDocSignature:
bundleHash:
reviewed cards: <id>:<digest> ...
reviewed islands: <id>:<digest> ...
編集した要素:
再観測後のbaseDocSignature:
再観測後のbundleHash:
変化したdigest:
変化しなかったdigest:
失敗した場合のHTTP status / code:
```

関連: [ADR-0115](../01_Plans/adr/ADR-0115-tai-scn-001-alignment.md)、[MCPエージェント接続](mcp_agent_connection.md)
