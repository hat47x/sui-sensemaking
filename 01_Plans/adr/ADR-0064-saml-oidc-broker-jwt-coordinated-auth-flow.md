# ADR-0064: SAML/OIDC/Broker/JWT 協調認証フローと外部 IdP 連携計画

- Status: Accepted (Phase 1 complete)
- Date: 2026-08-08
- Implemented (Phase 1): 2026-08-08
- Deciders: Project Maintainer
- Scope: `03_Implement/backend/`, `03_Implement/frontend/`, テストハーネス

## Context

ADR-0063 D9によりtrusted auth edge（JWT検証 → tenant解決 → session persister）の基盤が実装された。ただし2026-08-11の再監査で、共有persisterはprincipal単位versionのみを保存し、認証セッション単位のactive tenant正本を持たないことが判明した。設定上の起動は可能でも、`SAAS-TENANT-SESSION-BINDING-01`完了まで共有SaaSの本番利用gateは未充足である。加えて以下の認証フローは未検証・未実装である。

1. SAML IdP → Broker (SAML→OIDC) → JWT → sui-sensemaking のエンドツーエンド協調動作
2. OAuth 2.0 / OIDCによるログインフロー（認可コードグラント、PKCE）
3. 外部IdP（Google, Azure AD, Okta）との連携手順
4. フロントエンドのログインUIとセッション管理

本ADRは、mockレベルでのログイン実装から外部IdP連携までの包括的計画を定める。

### 実装済みの範囲（2026-08-08 Phase 1 完了後）

| コンポーネント | 状態 |
|---|---|
| `JwtSaasIdentityContextResolver` — JWT 検証 (RS256/ES256) | ○ ADR-0063 D9-3 |
| `JwksStore` — JWKS キャッシュ・ローテーション | ○ ADR-0063 D9-2 |
| `ClaimBasedTenantContextResolver` — claim → tenant 解決 | ○ ADR-0063 D9-4 |
| `DatabaseActiveTenantSessionPersister` — PostgreSQL共有version永続化 | △ principal単位の暫定実装。active tenant/session束縛は`SAAS-TENANT-SESSION-BINDING-01` |
| `main.py` SaaS bundle wiring | ○ ADR-0063 D9-6 |
| Level 2 mock IdP — RS256 JWT + `/jwks.json` | ○ ADR-0063 D9-7 |
| E2E HTTP tenant isolation test | ○ ADR-0063 D9-8 (10 tests) |
| Mock IdP — `/login`, `/oauth/authorize`, `/oauth/token` | ○ ADR-0064 D4-1/2 |
| Mock IdP — `/oauth/userinfo`, OIDC Discovery | ○ ADR-0064 D4-3 |
| Mock SP — OAuth login flow proxy (`/sp/oauth-login/`) | ○ ADR-0064 D4-4 |
| E2E OAuth login → JWT → API test | ○ ADR-0064 (8 tests) |
| SAML assertion 検証 | × 未実装 (broker に委譲) |
| フロントエンドログイン UI | × 未実装 |
| 外部 IdP 連携 (Google etc.) | × Phase 2 |
| 実 Broker (Keycloak) 連携 | × Phase 2 |

### なぜ今この計画が必要か

ADR-0063は「SAMLをアプリに実装しない」と決定したが、その決定が正しく機能すること——brokerがSAML→OIDCを変換し、sui-sensemakingがJWTを検証し、SAML顧客が実際にログインできること——は未証明である。またOAuth 2.0ログイン要件の有無も明示的に判断されていない。

## Decision

### D1: 認証フローは 3 層モデルとする

```
┌──────────────┐     SAML/OIDC      ┌──────────────┐     Signed JWT     ┌──────────────┐
│  External IdP │ ─────────────────→ │   Broker     │ ─────────────────→ │  sui-sensemaking    │
│  (Google etc) │                    │  (Keycloak/  │                    │  Backend     │
│  SAML IdP     │                    │   Authentik) │                    │  (JWT verify)│
└──────────────┘                    └──────────────┘                    └──────────────┘
  ユーザー認証                         SAML→OIDC変換                       tenant解決
  (外部委譲)                           JWT 発行                           認可・データ
```

- **Layer 1 (External IdP)**: Google, Azure AD, Okta, SAML IdP — ユーザーの実際の認証を行う。sui-sensemakingは関与しない。
- **Layer 2 (Broker)**: Keycloak / Authentik / WorkOS — 複数の外部IdPを集約し、SAML→OIDC変換、JWT発行、tenant claim注入を行う。sui-sensemakingは特定製品に依存しない。
- **Layer 3 (sui-sensemaking)**: JWT検証、tenant解決、認可。既存の `trusted_auth_edge.py` がこの層を実装する。

### D2: OAuth 2.0 ログインフローは sui-sensemaking に実装しない（Broker 委譲）

ADR-0020 §1.1の「認証・セッション・再認証の責務は前段IAP/SPに委譲」に従い、OAuth 2.0認可コードグラント、PKCE、トークンエンドポイント、リダイレクトURI管理はsui-sensemaking本体に実装しない。

- フロントエンドはBrokerのログインページへリダイレクトする。
- Brokerが認可コードグラント + PKCEを処理し、セッションcookieを発行する。
- sui-sensemaking BackendはBrokerが発行したJWTを `X-Sui-Sensemaking-Authorization` ヘッダーで受け取る。

ただし、開発者体験のため、mockレベルのログインフローをLevel 2テストハーネスに実装する（D4参照）。

### D3: フロントエンドの認証状態管理

フロントエンドは以下の最小限の認証状態を持つは次のとおりです。

| 状態 | 意味 | UI |
|---|---|---|
| `unauthenticated` | JWT 未取得 | ログインボタン / リダイレクト |
| `authenticated` | JWT 検証済み | 通常画面 |
| `session-expired` | JWT 期限切れ | 再ログイン案内 |

フロントエンドはBrokerのログインURLへリダイレクトし、認証完了後Brokerがフロントエンドへリダイレクトバックする。フロントエンドはBrokerからJWTを受け取り、以降のAPIリクエストに `X-Sui-Sensemaking-Authorization: Bearer <jwt>` を付与する。

### D4: Mock ログインフロー実装計画（Phase 1）

Level 2 mock IdPに以下を追加する。

#### D4-1: Mock ログインページ
- `GET /login` — シンプルなHTMLフォーム（username, password, tenant選択）
- POSTで `/oidc/authorize` へリダイレクト（OAuth 2.0認可コードグラントのmock）

#### D4-2: Mock OAuth 2.0 認可コードグラント
- `GET /oauth/authorize` — 認可エンドポイント（mock）。クエリパラメータ `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state` を受け取る。ログインフォームを表示。
- `POST /oauth/authorize` — ログイン情報を受け取り、認可コードを発行、`redirect_uri` へリダイレクト。
- `POST /oauth/token` — トークンエンドポイント（mock）。認可コードをJWTに交換。`grant_type=authorization_code`, `code`, `redirect_uri`, `client_id` を受け取る。RS256署名付きJWTを返す。

#### D4-3: Mock セッション管理
- `GET /oauth/userinfo` — UserInfoエンドポイント（Bearerトークン検証後、claimを返す）
- トークンは1時間有効（mock）

#### D4-4: Mock SP の JWT ベアラーモード対応
- `tests/federation/mock_sp.py` の `/sp/jwt/{provider}/docs/{doc_id}` エンドポイント（実装済み）を拡張し、完全なログインフローに対応させる：
  1. `/login` → 認可コード取得
  2. `/oauth/token` → JWT取得
  3. JWTを `X-Sui-Sensemaking-Authorization` ヘッダーでBackendへ転送

### D5: 外部 IdP 連携計画（Phase 2）

#### D5-1: Google OAuth 2.0 / OIDC
- BrokerにGoogle IdPを設定する手順書を作成する（KeycloakのIdentity Provider設定）。
- sui-sensemaking側の `identity_providers` テーブルにGoogleのissuer (`https://accounts.google.com`) とaudienceを登録する手順。
- tenantマッピング: Googleの `hd` (hosted domain) claimまたはカスタムclaimを `external_tenant_ref` へマップ。

#### D5-2: その他の IdP
- Azure AD / Entra ID: OIDC対応。tenantマッピングは `tid` claim。
- Okta: OIDC + SAML両対応。
- 一般SAML IdP: BrokerでSAML→OIDC変換。

### D6: 包括的テスト戦略

| テストレベル | 内容 | 対象 |
|---|---|---|
| Level 0 (unit) | JWT resolver, JWKS store, tenant resolver, session persister | ○ 実装済み (42 tests) |
| Level 1 (integration) | HTTP-level E2E tenant isolation with signed JWT | ○ 実装済み (10 tests) |
| Level 2 (mock login) | Mock OAuth 2.0 認可コードグラント + PKCE → JWT 発行 → リクエスト転送 | ○ 実装済み (8 tests) |
| Level 3 (broker E2E) | 実 Broker (Keycloak) + mock IdP + sui-sensemaking Backend | × Phase 2 |
| Level 4 (external IdP) | Google / Azure AD 連携実証 | × Phase 2 |

### D7: OAuth 2.0 ログイン要件の確認

以下のユースケースについて、sui-sensemakingの要件を確認する。

| ユースケース | sui-sensemaking での必要性 | 実装場所 |
|---|---|---|
| 認可コードグラント (Authorization Code Grant) | ○ 必要（Broker→フロントエンド間） | Broker |
| PKCE (Proof Key for Code Exchange) | ○ 必要（public client 対応） | Broker |
| クライアントクレデンシャルグラント | × v1 では不要（M2M は将来） | — |
| リフレッシュトークン | ○ 必要（セッション継続） | Broker |
| ログアウト / シングルログアウト | ○ 必要 | Broker + Backend |
| OIDC Session Management | ○ 必要 | Broker |
| RP-Initiated Logout | ○ 必要 | Broker |

**結論**: OAuth 2.0 / OIDCログインフローは すべてBrokerが担当する。sui-sensemaking BackendはJWT検証のみ。フロントエンドはBrokerのログインページへリダイレクトする。

### D8: 実装フェーズ

#### Phase 1: Mock ログイン ○ 完了 (2026-08-08)

1. ○ D4-1: Mockログインページ (`GET /login`, `POST /login`) — `tests/level2/mock_idp.py`
2. ○ D4-2: Mock OAuth 2.0認可コードグラント (`/oauth/authorize`, `/oauth/token`) — `tests/level2/mock_idp.py`
3. ○ D4-3: Mockセッション管理 (`/oauth/userinfo`, OIDC Discovery) — `tests/level2/mock_idp.py`
4. ○ D4-4: Mock SPのOAuthログインプロキシ (`/sp/oauth-login/*`) — `tests/federation/mock_sp.py`
5. ○ テスト: `test_saas_oauth_login_e2e.py` (8 tests) — OAuth login → JWT → API → tenant分離
6. ○ 既存テスト: 全530 testsパス、リグレッション無し

#### Phase 2: Broker + 外部 IdP 連携 (後続 ADR)

1. Broker製品の選定・セットアップ手順書（Keycloak推奨）
2. Google OAuth 2.0 / OIDC設定手順
3. SAML IdP → Broker設定手順
4. `identity_providers` テーブルへのBroker登録手順
5. Level 3 E2E test (実Broker + sui-sensemaking)
6. フロントエンドのログインリダイレクト対応

#### Phase 3: 本番運用準備

1. ○ `TRUSTED_PROXIES` 実装
2. △ PostgreSQL共有の`DatabaseActiveTenantSessionPersister`（2026-08-11）はprincipal単位version共有まで。認証session IDとactive tenantの原子的正本化は`SAAS-TENANT-SESSION-BINDING-01`、Bearer replay防御方式は`AUTH-ONE-TIME-JWT-01`で未決
3. SCIM provisioning
4. Audit logging for auth events

## Alternatives considered

1. **sui-sensemakingにOAuth 2.0 RPを実装する**: ADR-0020で否決済み。認証プロトコル実装責務をアプリに持ち込まない原則を維持する。
2. **フロントエンドがJWTを直接保持しない**: セッションcookieのみで運用する方式。SPAのAPI呼び出しにJWTが必要なため、フロントエンドがJWTをメモリに保持することは許容する。HttpOnly cookieとの二重管理は複雑性を増すため不採用。
3. **BrokerなしでGoogle OAuthを直接検証**: ADR-0063 D1で否決。multi-IdP対応の拡張性を失う。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | SAML顧客はBrokerのSAML→OIDC変換を通じてsui-sensemakingを利用し、開発者はmockログインでE2E認証フローをテストできる。OAuth 2.0ログインフローはBrokerが担当しsui-sensemaking本体に実装しない | 機能: フロントエンドは最小限の認証状態管理（リダイレクト+JWT保持）で済む。データ: SAML assertion検証はbrokerに委譲 |
| **データ設計** | SPAへ返す短命Bearer access tokenはmodule memoryだけに保持し`sessionStorage`/`localStorage`へ保存しない。reload後は再認証。refresh token grantはSPA clientで無効化 | 業務: tenant-session cookieは`HttpOnly; SameSite=Strict; Path=/`、`local-dev`以外では`Secure`必須。機能: ログアウトは同じ属性とpathで失効させる |
| **機能設計** | JwtSaasIdentityContextResolver・JwksStore・ClaimBasedTenantContextResolver・mock IdP（/login /oauth/authorize /oauth/token /oauth/userinfo）・mock SPのOAuth login flow proxyを実装済み。共有persisterはprincipal単位の暫定実装 | 業務: active tenant/session束縛は`SAAS-TENANT-SESSION-BINDING-01`完了まで本番利用gate未充足。データ: sender-constrained replay防御は別ADRで方式決定 |

## Consequences

- 開発者はmockログインでE2E認証フローをテストできる。
- SAML顧客はBrokerのSAML→OIDC変換を通じてsui-sensemakingを利用できる。
- OAuth 2.0ログインフローはsui-sensemaking本体に実装されず、Brokerが担当する。
- フロントエンドは最小限の認証状態管理（リダイレクト + JWT保持）で済む。
- SPAへ返す短命Bearer access tokenはmodule memoryだけに保持し、有効期間中の連続API要求へ使用できる。`sessionStorage` / `localStorage`へ保存せず、reload後は再認証する。refresh token grantと`refresh_token`応答はSPA clientで無効にする。sender-constrained replay防御は別ADRで方式決定する。
- tenant-session cookieは`HttpOnly; SameSite=Strict; Path=/`とし、`local-dev`以外では`Secure`を必須にする。ログアウトでは同じ属性とpathで失効させる。

## Non-goals

- sui-sensemaking本体へのOAuth 2.0 RP実装
- Broker製品の同梱・配布
- SCIM / 自動deprovisioning
- M2M (machine-to-machine) client credentials grant

## Traceability

- Parent: `01_Plans/adr/ADR-0063-saas-multitenant-trusted-auth-edge.md`（trusted auth edge実装）
- Derived-from: `01_Plans/adr/ADR-0020-oidc-saml-mock-idp-sp-profile.md`（認証責務境界）
- Related: `01_Plans/adr/ADR-0059-saas-tenant-authorization-boundary.md`（tenant認可境界）
- Implementation: 新規issueを起票予定
- Mock harness: `03_Implement/backend/tests/level2/mock_idp.py`, `tests/federation/mock_sp.py`
