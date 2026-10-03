# ADR-0064: SAML/OIDC/Broker/JWT 協調認証フローと外部 IdP 連携計画

- Status: Accepted (Phase 1 complete)
- Date: 2026-08-08
- Implemented (Phase 1): 2026-08-08
- Deciders: Project Maintainer
- Scope: `03_Implement/backend/`, `03_Implement/frontend/`, テストハーネス

## Context

ADR-0063 D9により、trusted auth edge（JWT検証、tenant解決、session persister）の基盤が実装された。ただし2026-08-11の再監査で、共有persisterはprincipal単位のversionだけを保存し、認証セッション単位のactive tenantの正本を持たないことが判明した。設定の上では起動できるが、`SAAS-TENANT-SESSION-BINDING-01` が完了するまで、共有SaaSの本番利用のgateは満たされない。加えて、以下の認証フローは未検証で、未実装である。

1. SAML IdP → Broker (SAML→OIDC) → JWT → sui-sensemaking の、エンドツーエンドの協調動作
2. OAuth 2.0 / OIDCによるログインフロー（認可コードグラント、PKCE）
3. 外部IdP（Google、Azure AD、Okta）との連携手順
4. フロントエンドのログインUIとセッション管理

本ADRは、mockレベルのログイン実装から、外部IdPとの連携までの、包括的な計画を定める。

### 実装済みの範囲（2026-08-08 Phase 1 完了後）

| コンポーネント | 状態 |
|---|---|
| `JwtSaasIdentityContextResolver`: JWT 検証 (RS256/ES256) | ○ ADR-0063 D9-3 |
| `JwksStore`: JWKS キャッシュ・ローテーション | ○ ADR-0063 D9-2 |
| `ClaimBasedTenantContextResolver`: claim → tenant 解決 | ○ ADR-0063 D9-4 |
| `DatabaseActiveTenantSessionPersister`: PostgreSQL共有version永続化 | △ principal単位の暫定実装。active tenantとsessionの束縛は`SAAS-TENANT-SESSION-BINDING-01` |
| `main.py` SaaS bundle wiring | ○ ADR-0063 D9-6 |
| Level 2 mock IdP: RS256 JWT + `/jwks.json` | ○ ADR-0063 D9-7 |
| E2E HTTP tenant isolation test | ○ ADR-0063 D9-8 (10 tests) |
| Mock IdP: `/login`, `/oauth/authorize`, `/oauth/token` | ○ ADR-0064 D4-1/2 |
| Mock IdP: `/oauth/userinfo`, OIDC Discovery | ○ ADR-0064 D4-3 |
| Mock SP: OAuth login flow proxy (`/sp/oauth-login/`) | ○ ADR-0064 D4-4 |
| E2E OAuth login → JWT → API test | ○ ADR-0064 (8 tests) |
| SAML assertion 検証 | × 未実装 (broker に委譲) |
| フロントエンドログイン UI | × 未実装 |
| 外部 IdP 連携 (Google etc.) | × Phase 2 |
| 実 Broker (Keycloak) 連携 | × Phase 2 |

### なぜ今この計画が必要か

ADR-0063は「SAMLをアプリに実装しない」と決定した。しかし、その決定が正しく機能すること、つまり、brokerがSAML→OIDCを変換し、sui-sensemakingがJWTを検証し、SAMLの顧客が実際にログインできることは、まだ証明されていない。またOAuth 2.0のログイン要件の有無も、明示的に判断されていない。

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

- **Layer 1 (External IdP)**: Google、Azure AD、Okta、SAML IdP。ユーザーの実際の認証を行う。sui-sensemakingは関与しない。
- **Layer 2 (Broker)**: Keycloak / Authentik / WorkOS。複数の外部IdPを集約し、SAML→OIDCの変換、JWTの発行、tenant claimの注入を行う。sui-sensemakingは、特定の製品に依存しない。
- **Layer 3 (sui-sensemaking)**: JWTの検証、tenantの解決、認可を行う。既存の `trusted_auth_edge.py` が、この層を実装する。

### D2: OAuth 2.0 ログインフローは sui-sensemaking に実装しない（Broker 委譲）

ADR-0020 §1.1の「認証、セッション、再認証の責務は、前段のIAPとSPに委譲する」に従い、OAuth 2.0の認可コードグラント、PKCE、トークンエンドポイント、リダイレクトURIの管理は、sui-sensemaking本体に実装しない。

- フロントエンドは、Brokerのログインページへリダイレクトする。
- Brokerが、認可コードグラントとPKCEを処理し、セッションcookieを発行する。
- sui-sensemakingのBackendは、Brokerが発行したJWTを、`X-Sui-Sensemaking-Authorization` ヘッダーで受け取る。

ただし、開発者体験のため、mockレベルのログインフローをLevel 2のテストハーネスに実装する（D4参照）。

### D3: フロントエンドの認証状態管理

フロントエンドは、以下の最小限の認証状態を持つ。

| 状態 | 意味 | UI |
|---|---|---|
| `unauthenticated` | JWT 未取得 | ログインボタン / リダイレクト |
| `authenticated` | JWT 検証済み | 通常画面 |
| `session-expired` | JWT 期限切れ | 再ログイン案内 |

フロントエンドは、Brokerのログイン用URLへリダイレクトし、認証が完了した後、Brokerがフロントエンドへリダイレクトして戻す。フロントエンドは、BrokerからJWTを受け取り、以降のAPIリクエストに `X-Sui-Sensemaking-Authorization: Bearer <jwt>` を付与する。

### D4: Mock ログインフロー実装計画（Phase 1）

Level 2のmock IdPに、以下を追加する。

#### D4-1: Mock ログインページ
- `GET /login`: シンプルなHTMLフォーム（username、password、tenantの選択）
- POSTで `/oidc/authorize` へリダイレクトする（OAuth 2.0の認可コードグラントのmock）

#### D4-2: Mock OAuth 2.0 認可コードグラント
- `GET /oauth/authorize`: 認可エンドポイント（mock）。クエリパラメータ `response_type=code`、`client_id`、`redirect_uri`、`scope`、`state` を受け取る。ログインフォームを表示する。
- `POST /oauth/authorize`: ログイン情報を受け取り、認可コードを発行して、`redirect_uri` へリダイレクトする。
- `POST /oauth/token`: トークンエンドポイント（mock）。認可コードをJWTに交換する。`grant_type=authorization_code`、`code`、`redirect_uri`、`client_id` を受け取る。RS256で署名したJWTを返す。

#### D4-3: Mock セッション管理
- `GET /oauth/userinfo`: UserInfoエンドポイント（Bearerトークンを検証した後、claimを返す）
- トークンは1時間有効（mock）

#### D4-4: Mock SP の JWT ベアラーモード対応
- `tests/federation/mock_sp.py` の `/sp/jwt/{provider}/docs/{doc_id}` エンドポイント（実装済み）を拡張し、完全なログインフローに対応させる。
  1. `/login` → 認可コードを取得する
  2. `/oauth/token` → JWTを取得する
  3. JWTを `X-Sui-Sensemaking-Authorization` ヘッダーで、Backendへ転送する

### D5: 外部 IdP 連携計画（Phase 2）

#### D5-1: Google OAuth 2.0 / OIDC
- BrokerにGoogle IdPを設定する手順書を作成する（KeycloakのIdentity Provider設定）。
- sui-sensemaking側の `identity_providers` テーブルへ、Googleのissuer (`https://accounts.google.com`) とaudienceを登録する手順を用意する。
- tenantのマッピング: Googleの `hd` (hosted domain) claimまたはカスタムclaimを、`external_tenant_ref` へマップする。

#### D5-2: その他の IdP
- Azure AD / Entra ID: OIDC対応。tenantのマッピングは `tid` claimで行う。
- Okta: OIDCとSAMLの両方に対応する。
- 一般的なSAML IdP: BrokerでSAML→OIDCへ変換する。

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
| クライアントクレデンシャルグラント | × v1 では不要（M2M は将来） | なし |
| リフレッシュトークン | ○ 必要（セッション継続） | Broker |
| ログアウト / シングルログアウト | ○ 必要 | Broker + Backend |
| OIDC Session Management | ○ 必要 | Broker |
| RP-Initiated Logout | ○ 必要 | Broker |

**結論**: OAuth 2.0 / OIDCのログインフローは、すべてBrokerが担当する。sui-sensemakingのBackendは、JWTの検証だけを行う。フロントエンドは、Brokerのログインページへリダイレクトする。

### D8: 実装フェーズ

#### Phase 1: Mock ログイン ○ 完了 (2026-08-08)

1. ○ D4-1: Mockログインページ (`GET /login`, `POST /login`): `tests/level2/mock_idp.py`
2. ○ D4-2: Mock OAuth 2.0認可コードグラント (`/oauth/authorize`, `/oauth/token`): `tests/level2/mock_idp.py`
3. ○ D4-3: Mockセッション管理 (`/oauth/userinfo`, OIDC Discovery): `tests/level2/mock_idp.py`
4. ○ D4-4: Mock SPのOAuthログインプロキシ (`/sp/oauth-login/*`): `tests/federation/mock_sp.py`
5. ○ テスト: `test_saas_oauth_login_e2e.py` (8 tests): OAuth login → JWT → API → tenant分離
6. ○ 既存テスト: 全530 testsがパスし、リグレッションなし

#### Phase 2: Broker + 外部 IdP 連携 (後続 ADR)

1. Broker製品の選定とセットアップ手順書（Keycloakを推奨）
2. Google OAuth 2.0 / OIDCの設定手順
3. SAML IdP → Brokerの設定手順
4. `identity_providers` テーブルへのBrokerの登録手順
5. Level 3 E2E test (実Broker + sui-sensemaking)
6. フロントエンドのログインリダイレクトへの対応

#### Phase 3: 本番運用準備

1. ○ `TRUSTED_PROXIES` 実装
2. △ PostgreSQL共有の`DatabaseActiveTenantSessionPersister`（2026-08-11）は、principal単位のversionの共有まで。認証session IDとactive tenantを原子的に正本とすることは`SAAS-TENANT-SESSION-BINDING-01`で、Bearerの再送への防御方式は`AUTH-ONE-TIME-JWT-01`で扱う。いずれも未決
3. SCIM provisioning
4. Audit logging for auth events

## Alternatives considered

1. **sui-sensemakingにOAuth 2.0 RPを実装する**: ADR-0020で否決済み。認証プロトコルの実装の責務を、アプリに持ち込まない原則を維持する。
2. **フロントエンドがJWTを直接保持しない**: セッションcookieだけで運用する方式。SPAのAPI呼び出しにはJWTが必要なため、フロントエンドがJWTをメモリに保持することは許容する。HttpOnly cookieとの二重管理は複雑さを増すため、不採用。
3. **BrokerなしでGoogle OAuthを直接検証する**: ADR-0063 D1で否決。複数のIdPに対応するための拡張性を失う。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | SAMLの顧客は、BrokerのSAML→OIDC変換を通じてsui-sensemakingを利用できる。開発者は、mockログインでE2Eの認証フローをテストできる。OAuth 2.0のログインフローはBrokerが担当し、sui-sensemaking本体には実装しない | 機能: フロントエンドは、最小限の認証状態管理（リダイレクトとJWTの保持）で済む。データ: SAML assertionの検証は、brokerに委譲する |
| **データ設計** | SPAへ返す短命のBearer access tokenは、module memoryだけに保持し、`sessionStorage`や`localStorage`へは保存しない。reloadの後は再認証する。refresh token grantは、SPA clientでは無効にする | 業務: tenant-session cookieは`HttpOnly; SameSite=Strict; Path=/`とし、`local-dev`以外では`Secure`を必須にする。機能: ログアウトは、同じ属性とpathで失効させる |
| **機能設計** | JwtSaasIdentityContextResolver、JwksStore、ClaimBasedTenantContextResolver、mock IdP（/login /oauth/authorize /oauth/token /oauth/userinfo）、mock SPのOAuth login flow proxyを実装済み。共有persisterはprincipal単位の暫定実装 | 業務: active tenantとsessionの束縛は`SAAS-TENANT-SESSION-BINDING-01`が完了するまで、本番利用のgateは満たされない。データ: sender-constrainedな再送への防御は、別のADRで方式を決める |

## Consequences

- 開発者は、mockログインでE2Eの認証フローをテストできる。
- SAMLの顧客は、BrokerのSAML→OIDC変換を通じて、sui-sensemakingを利用できる。
- OAuth 2.0のログインフローはsui-sensemaking本体に実装されず、Brokerが担当する。
- フロントエンドは、最小限の認証状態管理（リダイレクトとJWTの保持）で済む。
- SPAへ返す短命のBearer access tokenは、module memoryだけに保持し、有効期間中の連続したAPI要求に使用できる。`sessionStorage`や`localStorage`へは保存せず、reloadの後は再認証する。refresh token grantと`refresh_token`の応答は、SPA clientでは無効にする。sender-constrainedな再送への防御は、別のADRで方式を決める。
- tenant-session cookieは`HttpOnly; SameSite=Strict; Path=/`とし、`local-dev`以外では`Secure`を必須にする。ログアウトでは、同じ属性とpathで失効させる。

## Non-goals

- sui-sensemaking本体へのOAuth 2.0 RPの実装
- Broker製品の同梱と配布
- SCIM / 自動deprovisioning
- M2M (machine-to-machine) のclient credentials grant

## Traceability

- Parent: `01_Plans/adr/ADR-0063-saas-multitenant-trusted-auth-edge.md`（trusted auth edge実装）
- Derived-from: `01_Plans/adr/ADR-0020-oidc-saml-mock-idp-sp-profile.md`（認証責務境界）
- Related: `01_Plans/adr/ADR-0059-saas-tenant-authorization-boundary.md`（tenant認可境界）
- Implementation: 新規issueを起票予定
- Mock harness: `03_Implement/backend/tests/level2/mock_idp.py`, `tests/federation/mock_sp.py`
