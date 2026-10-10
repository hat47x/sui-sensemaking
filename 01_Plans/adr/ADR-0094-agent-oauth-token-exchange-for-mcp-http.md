# ADR-0094: MCPのHTTP通信では、トークン交換で得た短命のトークンをagentに対応付ける

- Status: Accepted
- Date: 2026-10-09
- Deciders: Maintainer
- Scope: `03_Implement/mcp/`（HTTP transport）、`03_Implement/backend/`（agentの認証経路）、`02_Architecture/api.md`

## 価値への寄与

CVI（不変条件）のうち、share/exportで未レビュー情報・秘密情報を意図せず共有しないこと。共有SaaSで、複数の外部AI協働者が同じMCPサーバーを通って読むとき、それぞれが登録された範囲の文書だけを読めるようにする。

## Context

- `ADR-0093` は、外部agentに、tenantと文書へ束縛した不透明な資格情報を与える。MCPのstdio通信は、プロセスごとに一つの資格情報を環境変数で受け取るので、そのまま使える。
- HTTP通信のMCPサーバーは、OAuth 2.1のリソースサーバーとして、外部IdPが署名したトークンを検証する（`ADR-0054`）。このトークンの宛先（audience）はMCPサーバー自身で、agentの資格情報ではない。
- MCPの認可仕様は、MCPサーバーが自分宛てに受け取ったトークンを、下流のAPIへそのまま渡すこと（トークンのパススルー）を禁じている。backendがMCP宛てのトークンを検証する形は、これに当たる。
- 比較した選択肢:
  - (C) MCPの設定に「OAuthの `client_id` → agent資格情報」の対応表を持たせる。全tenantの資格情報がMCP一か所に集まり、agentの追加ごとに設定の更新が要る。
  - (A′) MCPが専用のサービス資格情報で呼び、検証済みの `client_id` を申告する。MCPが侵害されると任意のagentを名乗れる。
  - (B) トークン交換（RFC 8693）で、MCP宛てのトークンを、backend宛ての短命のトークンに交換する。IdP側の対応が要る。

## Decision

**(B) を採る。** MCPのHTTP通信は、検証したトークンを `subject_token` として、IdPのトークンエンドポイントでトークン交換を行い、audienceがbackend宛ての短命のトークンを得る。このトークンを、専用ヘッダー `Sui-Sensemaking-Agent-Bearer` でbackendへ送る。backendは自分で署名・発行者・audience・有効期限を検証し、検証済みの `(identity_provider_id, sub)` を、Tenant Adminが登録した対応付けの行から agent に引く。

1. **対応付け。** `agent_oauth_bindings`（tenant確定前に引くため RLS なしの索引）が、`(identity_provider_id, subject)` から `(tenant_id, agent_id)` を引く。同じ組は全体で一つの agent にしか結べない。tenant は、トークンのclaimではなく、この行から決める（`ADR-0063` D8）。
2. **検証の再利用。** backendの検証は、ゲスト受け入れ（`ADR-0080`）が使う `verify_configured_oidc_token` と、グローバルなIdP登録簿（`identity_providers`）をそのまま使う。backend宛てのaudienceを持つ行を、コントロールプレーンの運用で登録する。新しい設定項目は増やさない。tenantのメンバーのログインには使われない（tenantとIdPの対応が無い）。
3. **agentの同定。** 交換後のトークンの `sub` は、RFC 8693に従い、元のトークンの主体（agentのOAuthクライアント）を指す。交換を行うMCPサーバー自身のクライアントIDは、`azp` / `act` に現れるが、同定には使わない。
4. **状態の確認。** 資格情報の状態・期限は、不透明な資格情報と同じく、毎要求でRLS付きの表を引き直す。資格情報を失効させると、対応付けも次の要求から効かなくなる。
5. **二重指定の拒否。** `Sui-Sensemaking-Agent-Credential` と `Sui-Sensemaking-Agent-Bearer` を同時に送ると `400` とする。どちらも通常の利用者の `Authorization` とは別のヘッダー。
6. **MCP側。** HTTP通信で `saas-multitenant` を使うには、トークン交換の設定（エンドポイント、MCPサーバーのクライアントID・秘密、backend宛てのaudience）を必須とし、欠けていれば起動を拒否する。交換に失敗した要求は、ツールのエラーとして閉じ、元のトークンをbackendへ送らない。
7. **安全の既定は変えない。** 読める範囲・本文の許可リスト・書き込みの拒否は、`ADR-0093` と同じ。

非目標:

- IdPの種類ごとの交換方式の吸収（RFC 8693に対応するIdPを前提にする）
- 交換後のトークンの再利用・キャッシュを長期に行うこと（有効期限の範囲でのみ、短く保持する）
- 元のトークンのbackendへの転送

## Consequences

- backendが信頼するのは、署名を検証できるIdPの短命のトークンだけで、MCPサーバーの申告ではない。MCPサーバーが侵害されても、任意のagentを名乗ることはできない（侵害の間に通るトークンの範囲に限られる）。
- Tenant Adminは、agentごとに、OAuthの主体（IdP登録簿のidと `sub`）を結ぶ。`/tenant-admin/agent-credentials/{agentId}/oauth-bindings` で管理する。
- MCPサーバーは、交換のために、自分自身のOAuthクライアント秘密を持つ。これは `oauth_config.ts` が「秘密を持たない」としていた方針からの変更である。持つのはこの秘密だけで、トークンの発行や、クライアントの登録はしない。秘密は環境変数で受け取り、ログへ出さない。
- IdPがトークン交換に対応していない場合、HTTP通信のMCPは `saas-multitenant` で使えない。その場合は stdio を使う。
- 交換後のトークンの `sub` の意味はIdPの実装に依存する。導入時に、実際のIdPでの確認が要る（このADRの時点では、署名したテスト用のトークンでの確認にとどまる）。

## Traceability

- Related: `ADR-0054`、`ADR-0063`（D8）、`ADR-0080`、`ADR-0093`

## 実装後の訂正（レビュー反映）

Decision の 1 と 2 のうち、次の点を改めた。対応付けの考え方（交換後のトークンの `sub` で agent を同定し、tenant はトークンの claim ではなく対応付けの行から決める）は変えていない。

- **audience は設定で固定する。** backend が交換後のトークンに求める audience は、設定 `SUI_AGENT_OAUTH_AUDIENCE` で与える（`runtime_parameter_registry.md` 参照）。未設定なら、OAuth の経路は閉じる。「新しい設定項目は増やさない」としていた前提は、この理由で誤りだった。トークン自身の `aud` の値から一致するものを選ぶ回避は行わない。呼び出し側が指定した audience を、トークンの申告で無効にさせないため。
- **tenant は IdP が証明したものだけで確定する。** トークンの tenant claim（`SUI_TENANT_CLAIM_NAME`）を、`tenant_identity_providers` で tenant に写した行だけを使う。agent の対応付けは `(tenant, IdP, sub)` で一意とする。他の tenant が同じ `(IdP, sub)` を結んでも、互いに見えず、競合も存在の手掛かりも生じない。
- **対応付けは、tenant が信頼する IdP にだけ結べる。** Tenant Admin が agent を結べるのは、その tenant が `tenant_identity_providers` で信頼している IdP の行に限る。信頼していない IdP と存在しない IdP は、同じ `404` で閉じる。
- **メンバーのログインとの分離は、audience の分離に依る。** 同じ IdP の行をメンバーのログインと共有しても、audience が固定されるので、メンバーのトークンが agent として通ることはない。ただし、この分離は IdP が audience を正しく分けて発行することを前提にする。この前提は、導入時に実 IdP で確かめる（未解決。このADRの時点では、署名したテスト用のトークンでの確認にとどまる）。
