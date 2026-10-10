# ADR-0093: MCPなどの外部agentに、tenantと文書へ束縛した資格情報を与える

- Status: Accepted
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
2. **資格情報の形。** 不透明なトークン（接頭辞 `suiag_`）を発行し、作成時に一度だけ表示する。保存するのは鍵付きハッシュ（領域を分けた HMAC-SHA256）とバージョンだけ。リクエストでは専用の `Sui-Sensemaking-Agent-Credential` ヘッダーで渡す。通常の利用者の `Authorization: Bearer` とは別のヘッダーにして、どちらの経路で解釈するかが曖昧にならないようにする。tenantと付与はサーバー側の行から決め、トークンのclaimやリクエストのheader・pathから決めない（`ADR-0063` D8）。ヘッダーがある場合は、不正・失効・期限切れを区別せず401で閉じ、通常の経路へ落とさない。
3. **MCPの役割。** stdio transport は、プロセスごとに一つのagent資格情報を環境変数で受け取り、backendへそのまま渡す。静的な `SUI_API_KEY` は `saas-multitenant` では使わない。HTTP transport は、MCPが検証するOAuthのトークン（外部IdPが署名したもの）とagent資格情報が別物なので、両者をどう対応付けるかを決めるまで `saas-multitenant` では起動を拒否したままにする。起動時の拒否は、資格情報の経路が揃い、下の試験が通った後に、transportごとに解除する。
4. **backendでの検査。** agent principalの要求は、ゲストと同じ順序で処理する。(1) トークンのハッシュから資格情報を引く、(2) 状態・失効・バージョンを毎要求で確認する、(3) 資格情報のtenantでDBスコープを設定する、(4) 付与されたdocIdだけを読む。付与外の文書、他tenantの文書は同じ404にする。書き込み、export、share、archive は `403 agent_write_not_enabled` で閉じる。agentが通れるのは、`GET /docs`（付与された文書のmetadataだけ）、`GET /docs/{id}`、`GET /ai/proposals/status`、`POST /docs/{id}/context-audit` の四つで、この四つ以外は、`action=read` の経路でも `403 agent_route_not_enabled` で閉じる（判断ログや類似候補のように、本文由来の派生データを返す経路を、個別に検討するまで開けない）。AIの実行や提案の決定の経路は、agentのヘッダーを通常の利用者の認証として受け付けない。
5. **即時失効。** `agent.revoke` は次の要求から効く。interactiveなsession（`tenantSessionVersion`）を持たないagentは、毎要求の状態確認が失効の保証になる。キャッシュする場合は、`deployment + tenantId + agentId + credentialVersion` をキーにし、トークンの有効期限を越えて保持しない。
6. **安全の既定は変えない。** SafeMode既定ON、未レビューのカードは `safeMode:false` でも公開しない（`mcp/README.md`のDOGFOOD-05）。agent資格情報は、これらを緩めるcapabilityを持たない。MCPの投影だけに任せず、backendも `GET /docs/{id}` で、許可リスト方式の文書を返す。許可した構造項目（カードの位置・種別・保留状態、辺、島の構成、根拠リンクの端点、voidの種別、ナラティブ点検の件数と方向）と、人が確認した本文（`textReviewed` が true のカード本文、`titleReviewed` が true の島の題名）だけを残す。文書の題名、島の要約、関係の要約、ナラティブ本文、根拠リンクの注記、voidの題名・詳細などは返さない。必須で空にできない文字列には `[withheld]` を入れて、伏せたことが分かる形にする。`GET /docs` の題名も返さない。許可リストなので、`DocumentV1` に本文を含む項目が増えても、明示するまでagentへは出ない。カードや島のidは残す（投影の件数と整合を保つため）。
7. **監査。** 監査eventは `tenantId` を持ち、主体は `x-actor-ref` ヘッダーではなく検証済みの `agent:<agentId>` から求める。本文・タイトル・トークンは含めない。MCPが送るCE-4の読み取り監査は、資格情報のtenantと文書に束縛された範囲だけ受け付ける。

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

下の条件が固定されるまで、`saas-multitenant` のMCP起動拒否を外さない。transportごとに解除する。stdio は、1〜8 と stdio の9を満たしたので解除した。HTTP は、`ADR-0094` のトークン交換の設定があるときだけ許す。状態を併記する。

| # | 条件 | 状態 |
| --- | --- | --- |
| 1 | 同じdocIdを持つtenant AとBで、Aのagentが、Bの同名文書を読めない（404で、存在を示さない） | 固定済み（`test_agent_credential_http.py`） |
| 2 | 付与外のdocIdが404になり、存在しない文書・他tenantの文書と区別できない | 固定済み |
| 3 | 失効、期限切れ、バージョン不一致、付与の取り消しが次の要求で拒否される | 固定済み（キャッシュは持たない） |
| 4 | 書き込み、export、archive が403。AI実行・提案の決定・派生データの経路が開かない | 固定済み（`saas-multitenant` では、agentのヘッダーはAI系の経路で認証にならない） |
| 5 | 確認していない本文が出ない | 固定済み（許可リスト方式。カード本文、島の題名・要約、関係の要約、ナラティブ、根拠リンクの注記、void、文書の題名） |
| 6 | リクエストのheaderやqueryでtenantを指定しても、その値でDBスコープが決まらない | 固定済み |
| 7 | 監査eventに `tenantId` と、検証済みのagentに由来する主体があり、本文・トークンがない | 固定済み |
| 8 | トークン平文が、保存・ログ・エラー応答のどこにも現れない | 保存と応答は固定済み。ログは、ヘッダーを出力する箇所がコード上に無いことを確認した（試験は未整備） |
| 9 | MCPのstdio transportが資格情報を渡し、HTTP transportの対応付けが決まる | stdio は実装済み（`SUI_MCP_AGENT_CREDENTIAL`）。HTTP は `ADR-0094`（トークン交換）で決定・実装した |

## Consequences

- 共有SaaSでも、外部のAI協働者がレビュー済みの内容を読み取れるようになる。
- 新しい表（`agent_credentials`、`agent_document_grants`、`agent_credential_index`）と、`api.md` の契約が必要になる。`ADR-0059` のImplementation gate 1（契約を先に反映）に従い、`api.md` を同時に更新した。トークンの索引表は、tenantが決まる前に引くため RLS を掛けない（`guest_auth_sessions` と同じ理由）。状態・期限・付与は、毎要求でRLS付きの表を引き直す。
- ゲスト受け入れと同じ付与モデルを使うため、二つの主体（ゲスト、agent）で付与の検査を共通化する余地がある。共通化は本ADRの範囲外で、実装時に重複が確認できたときに検討する。
- 登録・失効は `/tenant-admin/agent-credentials` で行う（`api.md` §2.15）。有効期限は90日以内とした。資格情報の更新（ローテーション）は、新しい `agentId` で登録し直し、古いものを失効させる運用とし、同じ `agentId` の再利用はしない。
- 未解決: agentごとの要求回数の上限（rate limit）を、tenantとagentのどちらのキーにするか。Data Planeへ制限を足す時の規則として別に決める。

## Traceability

- Related: `ADR-0054`、`ADR-0059`（D6・D9・D10）、`ADR-0063`（D8）、`ADR-0068`、`ADR-0080`、`ADR-0081`
- Derived-from: TEI側の `plan/design/SUI_MIGRATION_EXTENSION_AND_SPLIT_DESIGN_2026-10.md` 付録A（MCP経路の所見）

## 実装後の訂正（レビュー反映）

実装のレビューで、次の境界を明示した。決定の方向は変えていない。

- **登録は、登録者が読める文書だけに付与する。** `agent.register` は文書の中身を読む権限ではない（`ADR-0059` D9）。登録時、付与する文書ごとに、登録者本人の identity と tenant で読み取りの判定（PDP・分類・tenant境界）を通す。通らない文書は、存在しない文書と同じ `404 document_not_found` で閉じ、何も作らない。判定の主体は、要求に同乗した agent 資格情報ではなく、管理APIが確定した登録者である。
- **ハッシュ鍵は専用にする。** 不透明な資格情報のハッシュ鍵は、セッション用の `SUI_SAAS_AUTH_SESSION_HASH_KEY` と分けた `SUI_AGENT_CREDENTIAL_HASH_KEY` とする。鍵を更新しても、互いの資格情報が失効しないようにするため。未設定なら、発行は `503` で閉じる。
- **資格情報の系統を混ぜない。** agent の資格情報（不透明・OAuth）と、利用者の資格情報（cookie・ヘッダー）を同じ要求で送ると、`400 agent_credential_conflict` で閉じる。どの主体として扱うかを曖昧にしないため。
- **agent への応答は共有キャッシュに残さない。** agent の応答は `Cache-Control: private, no-store` とし、資格情報のヘッダーで `Vary` を付ける。ETag は返さない。保存された全文のハッシュは、伏せた項目の変更や内容の一致を示す手掛かりになるため。`created_by`（内部のユーザーID）も返さない。
- **agent の監査は読み取りの記録だけ。** agent が送れる context-audit は、MCP の `context-query` だけとする。提案・適用の監査は作れない。CE-4 の完全性の追跡は、人間の経路の提案→適用の連鎖のためのものなので、agent の読み取り監査はそこに加えない。

**この訂正が保証しないこと。** agent 経由の監査イベントが、既定の監査設定で記録されない経路があるかは、導入時に確かめる（未解決）。ログに資格情報が出ないことは、`03_Implement/backend/tests/test_agent_credential_log_hygiene.py` で検査する。これは試験の範囲の保証であり、本番の監視基盤の出力までは確かめない。
