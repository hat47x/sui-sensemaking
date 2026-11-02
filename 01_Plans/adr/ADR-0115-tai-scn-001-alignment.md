# ADR-0115: TAI SCN-001との接続をreviewed projectionと単位digestで整合する

- Status: Accepted（接続の整合。新しいAPIは追加しない。2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（TAI SCN-001の事実確認と三要素分析にもとづく）
- Scope: TAI `SCN-001`、MCP agent経路、`04_Documentation/mcp_agent_connection.md`、`ADR-0103`、`ADR-0106`、`ADR-0108`、`ADR-0112`
- Related: TAI Pleroma Issue #67、`ADR-0093`、`ADR-0101`、`ADR-0103`、`ADR-0106`、`ADR-0111`

## 価値への寄与

V4「共有と学習」に寄与する。TAIがSUIのレビュー済みの意味を読み、版を固定して再観測できるようにする。書き込みは増やさず、未レビュー本文、ナラティブ、TEI投影をagentへ開かない。

## Context

TAIのSCN-001は、SUIの接続面を`b0f5bae1`（2026-10-25）で確認し、次の不足を挙げている。

- agentが提案を直接POSTするAPIがない
- agent経路でナラティブ本文を取れない
- TEI投影はagent資格情報では403
- `bundleHash`は投影全体のもので、カード・島の単位digestがない
- 資格情報の発行は人が行う

現行mainでは、このうち単位digestと資格情報の管理APIが追加されている。TAIの在庫は、その分だけ古い。一方、提案POST、ナラティブ、TEI投影の閉鎖は、設計上の意図的な境界である。

TAIの業務は、レビュー済みの投影を読み、`bundleHash`と版を記録し、人が編集した後に再観測して変化を確かめることにある。書き込みを必要としない。

## Decision

### 1. TAIが使う経路

TAIは、agent資格情報でMCPの`get_context_projection`を使う。MCPを使えない場合は`GET /docs/{id}`のagent応答を使う。

- 読めるのは、レビュー済みのカード本文と、レビュー済みの島の題名だけとする。
- 未レビューのカード、ナラティブ本文、島・関係の要約は返さない。
- TEI投影はagent資格情報では403のままとする。
- agentからの提案POSTは作らない。提案は人が貼り付ける既存経路を使う（`ADR-0108`、`ADR-0112`）。

### 2. 版固定の形式

TAIは、次の3つを組にして版を固定する。

| 値 | 用途 |
|---|---|
| `baseDocSignature`（`<docId>:<updatedAt>`） | 文書全体の版。クライアントが送った`updatedAt`に依存する。 |
| `bundleHash` | 露出した投影全体の決定的なsha256。digestは入力に含めない。 |
| `cards[].digest` / `islands[].digest` | 露出したカード本文・島の題名の単位digest。`alg=sha256`、64桁の16進数。伏せた場合は`null`。 |

`bundleHash`だけでは、カード単位の同一性を復元できない。`baseDocSignature`だけでは、内容の同一性を保証できない。3つを組にして、TAIの記録と再観測を照合する。

### 3. 資格情報の発行

資格情報は、Tenant Adminの`/tenant-admin/agent-credentials`で発行する。APIは実装済みだが、発行は人間の管理者が行う。TAIが自分で資格情報を発行することはできない。

- 有効期限は未来かつ90日以内。
- 付与する文書は1〜50件。
- 登録者本人が読める文書だけを付与できる。
- トークンは登録応答でだけ返し、保存しない。

### 4. TAIの在庫との差分

| TAIの記載 | 現行main | 扱い |
|---|---|---|
| 単位digestがない | `ADR-0103`で追加済み | TAIの在庫を更新する |
| 資格情報の発行は人だけ | APIはあるが、発行は人間 | 記載を「人間がAPIで発行」へ更新する |
| agentの提案POSTがない | 意図的に未実装 | 維持する。人が貼り付ける |
| ナラティブ本文がない | 意図的に非公開（`ADR-0106`） | 維持する |
| TEI投影が403 | 意図的に閉鎖 | 維持する |
| `docSignature` | 実際は`baseDocSignature` | 名称を修正する |

## Three-Element Verification（自己適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| 業務 | TAIはレビュー済みの投影を読み、版を固定して再観測する | 機能: 書き込みAPIを作らない。データ: 未レビューとナラティブを返さない。 |
| データ | `baseDocSignature`、`bundleHash`、単位digestを組にする | 業務: TAIは3つを記録する。機能: digestをbundleHashの入力に含めない。 |
| 機能 | MCPと`GET /docs/{id}`の既存経路だけを使う | 業務: 資格情報は人間が発行する。データ: TEI投影をagentへ開かない。 |

## Consequences

- SUI側の新しいAPIは増えない。TAIは既存のagent経路とMCPで接続を試せる。
- TAIの在庫は、単位digest、`baseDocSignature`、資格情報APIの事実に合わせて更新する必要がある。
- 提案POST、ナラティブ、TEI投影の閉鎖は維持する。必要になった時点で、それぞれ新しいADRを起こす。
- SafeMode、未レビュー非公開、`human_reviewed`、proposal-onlyの境界は変わらない。
