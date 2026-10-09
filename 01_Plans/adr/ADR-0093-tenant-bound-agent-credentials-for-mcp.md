# ADR-0093: MCPなどの外部agentに、tenantと文書へ束縛した資格情報を与える

- Status: Proposed
- Date: 2026-10-09
- Deciders: Maintainer
- Scope: `03_Implement/mcp/`、`03_Implement/backend/`（agentの認証経路）、`02_Architecture/api.md`、`02_Architecture/schemas.md`

## 価値への寄与

CVI（不変条件）のうち、share/exportで未レビュー情報・秘密情報を意図せず共有しないこと。外部のAI協働者（V4: 共有と学習）が共有SaaSで文書の投影を読むときに、他のtenantや許可されていない文書へ届かないことを、資格情報の構造で保証する。

## Context

- `SUI_RUNTIME_PROFILE=saas-multitenant` では、MCPサーバーが起動を拒否する（`mcp/src/document_client.ts`、「tenantに束縛したMCP credentialが未実装」）。つまり共有SaaSでは、外部agentが投影を読む経路が閉じている。
- MCPのHTTP transportは、外部IdPが署名したベアラートークンの `iss` / `aud` / `exp` を検証するリソースサーバーとして動く（`oauth_verifier.ts`）。出力は `clientId` と `scopes` までで、tenantも文書も扱わない。
- MCPがbackendへ文書を取りに行く経路は、静的な `SUI_API_KEY` を使う。これはtenantを証明せず、`ADR-0059` D6が「API keyだけをSaaS利用者の主体やtenantの証明に使わない」と定める。
- `ADR-0059` D9は、Tenant Adminのcapabilityに `agent.register` / `agent.revoke` を置き、D10は、agentの資格情報を「tenantIdと許可された対象のdocIdへ束縛し、他のtenant・文書・用途へ再利用できず、token平文は作成時に一度だけ表示して保存しない」と定めた。capability名は `session_context.py` に定義済みだが、資格情報の保存と検証は未実装。
- `ADR-0063` D8は、tenant claimを権限ではなく要求として扱うと定める。
- `ADR-0080` のゲスト受け入れは、IdPに依存せず、個人単位の付与（grant）だけで文書の読み取りを許す。`GuestAdmissionRepository.can_read_document` は、付与されていない既存文書を、存在しない・他tenantの文書と区別できない404にする。`apply_database_tenant_id` で、membershipを作らずにtenantのDBスコープを設定できる。外部agentが必要とする性質（付与された文書だけを読み取る、列挙を許さない）に近い。

## Decision

**外部agentを、membershipを持たない別種の主体（agent principal）として扱い、tenantの管理者が登録した「文書付与つきの資格情報」だけで、読み取り専用の投影を許す。** 実装は `ADR-0080` の付与モデルを再利用し、新しい認可の仕組みを増やさない。

1. **登録。** Tenant Adminが `agent.register` で、agent資格情報を作る。内容は `(tenantId, agentId, 付与する docId の明示列挙, 許可する用途, 失効日時, 状態)`。用途は読み取り専用の投影（`get_context_projection` / `get_proposal_status`）に限る。docIdの全件指定や、tenant全体への付与は作らない。
2. **資格情報の形。** 不透明なトークンを発行し、作成時に一度だけ表示する。保存するのはハッシュとバージョンだけ。tenantと付与はサーバー側の行から決め、トークンのclaimやリクエストのheader・pathから決めない（`ADR-0063` D8）。
3. **MCPの役割。** MCPは引き続きリソースサーバーとしてトークンを検証し、通過したトークンをそのままbackendへ渡す。静的な `SUI_API_KEY` は `saas-multitenant` では使わない。起動時の拒否は、資格情報の経路が揃い、下の試験が通った後に解除する。
4. **backendでの検査。** agent principalの要求は、ゲストと同じ順序で処理する。(1) トークンのハッシュから資格情報を引く、(2) 状態・失効・バージョンを毎要求で確認する、(3) 資格情報のtenantでDBスコープを設定する、(4) 付与されたdocIdだけを読む。付与外の文書、他tenantの文書は同じ404にする。書き込み、export、share、AIの実行、提案の決定は、すべて `403` で閉じる。
5. **即時失効。** `agent.revoke` は次の要求から効く。interactiveなsession（`tenantSessionVersion`）を持たないagentは、毎要求の状態確認が失効の保証になる。キャッシュする場合は、`deployment + tenantId + agentId + credentialVersion` をキーにし、トークンの有効期限を越えて保持しない。
6. **安全の既定は変えない。** SafeMode既定ON、未レビューのカードは `safeMode:false` でも公開しない（`mcp/README.md`のDOGFOOD-05）。agent資格情報は、これらを緩めるcapabilityを持たない。
7. **監査。** 監査eventは `tenantId` に加えて `agentId` を持つ。本文・タイトル・トークンは含めない。MCPが送るCE-4の読み取り監査は、資格情報のtenantと文書に束縛された範囲だけ受け付ける。

### 比較した選択肢

| 案 | 内容 | 判断 |
| --- | --- | --- |
| A | IdPのトークンのtenant claimをそのまま信用する | 採らない。claimは要求であって権限ではない（`ADR-0063` D8）。IdPの設定ミスがtenantの越境になる |
| B | 登録済みagentの資格情報が付与を決める（本案） | 採る。付与がサーバー側の行にあり、失効と監査が単純。ゲストの仕組みを再利用できる |
| C | 利用者のbrowser sessionをMCPへ委譲する | 採らない。sessionの権限が読み取り専用の用途より広く、tenantSessionVersionをagentに持たせることになる |

非目標:

- agentの書き込み（提案の登録・決定は人間の経路のみ。`human_reviewed` は人間だけが設定する不変条件）
- OAuthの認可サーバーとしての動作（MCPはリソースサーバーに徹する。`ADR-0054`）
- agent資格情報のtenant横断利用、tenant全体への一括付与
- break-glass（時間制限・目的・承認・通知・監査が揃うまで標準にしない）

## 起動拒否を解除する条件（実装の解禁）

下の試験がすべて固定されるまで、`saas-multitenant` のMCP起動拒否を外さない。

1. 同じdocIdを持つtenant AとBで、Aのagentが、Bの同名文書を読めない（404で、存在を示さない）
2. 付与外のdocIdが404になり、付与済みの文書と区別できない
3. 失効、期限切れ、バージョン不一致が、キャッシュを含めて次の要求で拒否される
4. 書き込み、export、share、AI実行、提案の決定が403
5. 未レビューのカードが `safeMode:false` でも出ない
6. 他tenantの資格情報のハッシュ・agentIdを指定しても、そのtenantのDBスコープが設定されない
7. 監査eventに `tenantId` と `agentId` があり、本文・トークンがない
8. トークン平文が、保存・ログ・エラー応答のどこにも現れない

## Consequences

- 共有SaaSでも、外部のAI協働者がレビュー済みの内容を読み取れるようになる。
- 新しい表（agent資格情報とその文書付与）と、`api.md` / `schemas.md` の契約が必要になる。`ADR-0059` のImplementation gate 1（契約を先に反映）に従う。
- ゲスト受け入れと同じ付与モデルを使うため、二つの主体（ゲスト、agent）で付与の検査を共通化する余地がある。共通化は本ADRの範囲外で、実装時に重複が確認できたときに検討する。
- 未解決: agentごとの要求回数の上限（rate limit）を、tenantとagentのどちらのキーにするか。Data Planeへ制限を足す時の規則として別に決める。

## Traceability

- Related: `ADR-0054`、`ADR-0059`（D6・D9・D10）、`ADR-0063`（D8）、`ADR-0068`、`ADR-0080`、`ADR-0081`
- Derived-from: TEI側の `plan/design/SUI_MIGRATION_EXTENSION_AND_SPLIT_DESIGN_2026-10.md` 付録A（MCP経路の所見）
