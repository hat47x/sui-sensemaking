# ADR-0020: OIDC/SAML 対応における認証アーキテクチャ（IAPヘッダー認証 + Mock SP/IdP 検証プロファイル）

- Status: Accepted
- Date: 2026-03-06
- Deciders: Project Maintainers
- Scope: `01_Plans/adr/`

## Context

`sui-sensemaking` はenterprise/government運用を想定しつつ、OSSとして軽量性・安全性・再現性を維持する必要がある。
既存方針では、アプリ本体は認証機構を内包せず、外部基盤（リバースプロキシ / IdP）へ委譲する。`02_Architecture/enterprise_architecture.html`

一方で、OIDC/SAML連携の実装～検証をAIエージェント主体で継続するには、次の論点を同時に解く必要がある。

- 本番運用での最適解（自前SP/RP実装vsリバースプロキシ + OSS製品）
- ローカル開発での簡易認証導線（開発者体験）
- E2Eでの再現可能な検証導線（Docker-in-Docker非依存）
- ユーザー情報（JIT Provisioningで作る最小属性）のデータ設計整合

## Decision

### 1) 本番運用アーキテクチャの採用方針

本番/準本番は **「完全ヘッダー認証方式（Identity-Aware Proxyモデル）」** を第一選択とする。

- 認証（OIDC/SAML）とセッション管理は前段SP/IAPにオフロードする。
- `sui-sensemaking` Backendは、信頼されたプロキシから渡される認証済みヘッダーを受け取って `AuthContext` を構築する。
- アプリ本体はパスワード・秘密情報・認証セッションを保持しない。

この判断は、`02_Architecture/enterprise_architecture.html` の「認証は外部責務」「アプリは署名済みユーザコンテキストを受け取る」方針を具体化するものである。


### 1.1) 認証責務境界（固定）

- 認証・セッション・再認証（step-up）の責務は前段IAP / SPに委譲し、`sui-sensemaking` 本体は保持しない。
- Backendの責務は「信頼境界の検証（trusted proxy）」「入力ヘッダー/JWTの検証」「`AuthContext` 正規化」の3点に限定する。
- `AuthContext` 正規化後の契約（`userId`/`provider`/`subject`）のみをアプリ内部の認可・帰属判定に使用し、生のヘッダー差異を下流へ漏らさない。

### 1.2) `02_Architecture/enterprise_architecture.html` との整合項目

1. 認証外部委譲（IdP/IAP）とアプリ非保持原則を維持する。
2. `AuthContext` はアプリ内部I/Fの唯一契約とし、provider依存分岐を実装へ持ち込まない。
3. strict mode（`SUI_ALLOW_JIT_PROVISIONING=false`）を本番既定とし、例外緩和は承認付き一時運用に限定する。
4. SafeMode既定ON・PII最小化・監査最小化の上位契約を破らない。

### 2) 方式比較（意思決定根拠）

#### A. 自前で SAML SP / OIDC RP をアプリ内実装する方式

利点は次のとおりです。

- アプリ単体で完結し、PoC立ち上げが速い。
- UI/業務ロジックとの密結合が容易。

課題は次のとおりです。

- 認証プロトコル実装責務（署名検証、証明書更新、脆弱性追随）がアプリ側に集中する。
- 企業・行政監査で「なぜ標準IAPを使わないか」の説明コストが高い。
- セキュリティレビュー対象が広がり、OSS保守負荷が増える。

#### B. リバースプロキシ + OSS IAP（推奨方式）

利点は次のとおりです。

- 認証責務を分離し、アプリ本体の攻撃面を縮小できる。
- 企業・行政で一般的な統制（IdP連携、証明書運用、監査）と親和性が高い。
- `sui-sensemaking` はヘッダー契約に集中でき、後方互換維持が容易。

課題は次のとおりです。

- 配備時にプロキシ設定（trusted proxy, header contract）が必須。
- ローカル開発では簡易導線（Basic認証等）を別途準備する必要がある。

**結論**: `sui-sensemaking` の価値軸（軽量・安全・外部統合）を優先し、Bを採用する。

### 3) Backend（sui-sensemaking 本体）必須契約

FastAPI側に「ヘッダー認証Dependency / Middleware」を実装し、以下を満たす。

1. Trust Proxy強制
   - `TRUSTED_PROXIES`（CIDR/IP）で許可元を制限する。
   - 非許可信頼元 + 認証ヘッダー付き要求は拒否（401/403）。
2. 汎用 `AuthContextAdapter`（設定駆動）
   - 認証情報の受け取り方式は **設定で切替可能** とする（実装追加なしで吸収）。
   - 最低限サポートする入力モードは次のとおりです。
     - `header`（`X-Forwarded-*` 等のHTTPヘッダー群）
     - `jwt_header`（例: `Authorization: Bearer <JWT>` または `X-Auth-Token`）
   - いずれのモードでも、最終的に同一の `AuthContext` へ正規化する。
3. クレーム/ヘッダーのマッピング規則
   - `AUTH_USER_FIELD`, `AUTH_EMAIL_FIELD`, `AUTH_NAME_FIELD`, `AUTH_GROUPS_FIELD` などの設定キーで、
     受信元フィールド名を差し替え可能にする。
   - 既定値は標準的な `X-Forwarded-User` などを採用するが、AWS ALB / Cloud IAP等の差異は
     **provider preset（設定テンプレート）** で吸収し、サービス別の個別実装を避ける。
   - `X-Forwarded-For` は認証IDではなく、`TRUSTED_PROXIES` 判定と監査補助にのみ利用する。
4. リクエストコンテキスト
   - 正規化した `AuthContext` をAPIで参照可能にする。
5. JIT Provisioning（最小）
   - 未知ユーザーアクセス時に最小属性を登録（userId / displayName / email等）。
   - パスワード・ハッシュは保持しない。

### 3.5) ユーザー識別・保持モデル（認証情報なし前提）

認証情報（password/MFA secret）を保持しない場合でも、`sui-sensemaking` 側の **ユーザーマスタは必須** とする。
理由は、認可判定・データ所有権・レビュー帰属をアプリ内部で安定参照するためである。

- 原則は次のとおりです。
  - 認証は外部（IdP/IAP）責務、`sui-sensemaking` は認証結果を受ける。
  - ただしアプリ内部では `internal_user_id`（不変キー）を保持し、データはこの内部IDに紐づける。
- 推奨データモデル（将来のschema更新方針）:
  - `users`（内部主体）
    - `id`（UUID等, immutable）, `display_name`, `role`, lifecycle metadata
  - `user_identities`（外部識別子との紐付け）
    - `user_id` (FK), `provider`, `external_uid`, attributes metadata
  - 関係: `users` 1 : N `user_identities`
- 標準挙動（JIT有効時）:
  - 受信 `provider + external_uid` を `user_identities` で検索。
  - ヒット: 対応する `users.id` を利用。
  - ミス: `users` と `user_identities` を同時作成（JIT provisioning）。

### 3.6) 複数認証経路（Google/社内SSO/学認等）の扱い

- 基本方針は次のとおりです。
  - アプリUIとしてのアカウントリンク機能は持たない（複雑性/脆弱性増加を回避）。
  - 可能な限り前段IdPで統合し、`sui-sensemaking` には単一安定IDを渡す。
- 例外対応（必要時のみ）は次のとおりです。
  - IdP移行・メール/所属変更等で識別子が変わる場合に備え、
    管理者API/CLIで `user_identities` の付替え・追加を可能にする設計余地を持つ。
  - これにより、データ本体（cards/workspaces/review帰属）を内部 `users.id` へ固定したまま救済できる。

### 3.7) JIT と事前プロビジョニングの運用モード

`sui-sensemaking` はOSS普及性とenterprise統制の両立のため、**ハイブリッド運用** を採用する。

- 既定（OSS向け）: `ALLOW_JIT_PROVISIONING=true`
  - 未登録アイデンティティ到達時に動的作成を許可。
  - 導入障壁を下げ、Time-to-Valueを優先。
- 厳格運用（enterprise/government向け）: `ALLOW_JIT_PROVISIONING=false`
  - 未登録アイデンティティは `403 Forbidden`。
  - 事前プロビジョニング（管理者API/CLI、将来的SCIM連携）で登録済ユーザーのみ許可。

補足は次のとおりです。
- JITを無効化しても認証は外部責務のまま維持する。
- deprovisioningや事前権限付与を厳密運用する場合は、事前プロビジョニングモードを推奨する。

### 4) Frontend 必須契約

- フロントエンドは「自前ログイン画面」を正本導線にしない。
- 認証状態はbackendの `AuthContext` 反映結果で表示する。
- ログアウトは前段SP/IAPへリダイレクトする終端（RP-Initiated logout）を使う。

### 5) ローカル開発プロファイル（簡易裏口）

開発者向けに `docker-compose.local.yml` を用意し、前段プロキシ（推奨: Caddy）で次を提供する。

- Basic認証は **local/dev限定** とし、本番/準本番では無効を既定とする。
- Basic認証は明示的な環境変数（例: `DEV_BASIC_AUTH_ENABLED=true`）が指定された場合のみ有効化する。
- 環境ごとの有効/無効はcomposeファイルで制御する（例: `docker-compose.local.yml` でのみ指定）。

- Basic認証（固定管理者資格情報）
- 認証成功時ヘッダー付与（例: `X-Forwarded-User: admin`）
- backendへのreverse proxy

これにより、本体コードの認証仕様を変えずに開発導線を確保する。

### 6) E2E検証プロファイル（Mock SP/IdP の必要性を含む再整理）

結論として、`sui-sensemaking` の主契約は「IAP/プロキシ -> AuthContext正規化」であり、
**常にMock SP/IdPを必須化しない**。検証は次の2層で運用する。

#### Level 1: 既定（必須）— AuthContext 契約E2E

- 対象: `TRUSTED_PROXIES`、header/JWTマッピング、JIT Provisioning、拒否/許可制御。
- 方式: 軽量プロキシ（またはテストハーネス）から認証済みコンテキストを注入し、
  `sui-sensemaking` 側の契約を直接検証する。
- 目的: 本プロジェクトの本質価値（アプリ境界の安全性・互換性）を最短経路で回帰保証する。

#### Level 2: 拡張（条件付き）— Federation フローE2E

- 対象: OIDC/SAMLフロー全体（redirect/callback/logout、署名検証、`xmlsec1` 依存など）。
- 方式: FastAPI製モック群（`mock_sp` + `mock_idp`）を起動して検証する。
  - `mock_idp`: SAML（`pysaml2`）, OIDC（`Authlib`）
  - `mock_sp`: 認証成功後に `X-Forwarded-User` 等を付与してbackendへフォワード
- 目標: 主要なIdP製品/サービスで観測されるデータ連携仕様・様式を、
  **テストコード上のprovider profile fixtures** として再現・検証する。
  - 例: ヘッダー名差異、JWT claim名差異、`groups` 形式、`amr/acr` の有無。
  - 方針: 製品別に実装分岐を増やさず、preset + fixture差し替えで吸収する。
- 実行例（Docker非依存）:
  - `uvicorn mock_idp:app --port 8081`
  - `uvicorn mock_sp:app --port 8080`
  - `uvicorn sui_sensemaking_backend.main:app --port 8000`

#### Mock SP/IdP を実施すべき条件

- `AuthContextAdapter` の入力モードやprovider presetの仕様変更。
- provider profile fixtures（主要IdP連携様式）の追加/変更。
- logout / step-up / `amr` 等、IdP連携境界に関わる仕様変更。
- 依存ライブラリ更新（`pysaml2`, `Authlib`, `xmlsec1`）で連携回帰リスクが高い場合。

上記条件に該当しないPRでは、Level 1を満たせば受入可能とする。

### 7) 暗号素材と依存

- SAML署名/OIDC JWKSはテスト起動時に動的生成する。
- 鍵素材は平文コミット禁止。
- `pysaml2` 実行要件として `xmlsec1` を導入する（ローカル手順 + Dockerfile）。

### 8) 受入基準（最小）

1. trusted proxy外からのヘッダー偽装要求を拒否できる。
2. trusted proxy経由時に `AuthContext` が構築される。
3. JIT Provisioningで最小ユーザーレコードが作成される（パスワード列なし）。
4. E2E受入基準:
   - **必須**: Level 1（AuthContext契約E2E）を通過する。
   - **条件付き必須**: IdP連携境界を変更するPRではLevel 2（Mock SP/IdP）も通過する。
   - **Level 2実施時**: 少なくとも1つ以上のprovider profile fixture（主要IdP様式）を使った回帰を含める。

### 9) 未決事項（TODO / Issue化）

AUTH-ARCH-01で固定した論点と、継続検討論点を分離する。

#### 9.1 固定済み（本ADRの決定として扱う）

- ユーザー最小属性スキーマ（永続項目とPII最小化）
- reviewerRef / ownerRefとAuthContext.userIdの正規マッピング
- `users` / `user_identities` の正式スキーマ骨子（`provider+external_uid` 一意制約、strict/JIT分岐）
- `ALLOW_JIT_PROVISIONING=false` 時の403拒否契約と最小管理導線（`POST /admin/provision/users`）
- 組織属性境界: `roles/groups/policyRef` はtransient（外部照会）で扱い、アプリDBには永続化しない

#### 9.2 継続検討（後続Issueで扱う）

- 管理導線の将来置換（SCIM/企業ID管理連携）の運用詳細

#### 2026-03-03 update（AUTH-ARCH-01 確定）

- AuthContext/JIT 属性境界を固定:
  - persist: `provider`, `external_uid`, `display_name`, `email`
  - transient: `amr/acr/aal/auth_time`, `roles/groups`, `trace_id`
  - forbidden: password/hash/secret, WebAuthn credential id, raw policy token
- 正規マッピングを固定は次のとおりです。
  - `AuthContext.userId = users.id`
  - `reviewerRef = ownerRef = user:<users.id>`
- strict mode 契約を固定:
  - `SUI_ALLOW_JIT_PROVISIONING=false` かつ未登録subjectは `403`
  - 事前プロビジョニング `POST /admin/provision/users`（将来SCIM置換点）
- 監査最小化契約を固定は次のとおりです。
  - `amr/acr/aal/auth_time` の生値永続化を禁止し、監査は正規化指標（`hasStepUp`/`assuranceLevel`/`authAgeBucket`）のみ許可
- strict mode 運用責任を固定:
  - 例外緩和はSecurity Officer + System Ownerの2者承認
  - Platform Operatorが実行記録（時刻/理由/承認者）を保持

上記はissue memo `issue-AUTH-ARCH-01-authcontext-jit-provisioning-data-boundary.md` で管理する。

### 10) IdP がパスキー（FIDO2/WebAuthn）を提供する場合の考慮事項

前段IdP/SP側がパスキー認証を採用しても、`sui-sensemaking` 本体の基本原則（認証情報を保持しない）は維持する。

- 位置づけは次のとおりです。
  - パスキーはIdP側の認証手段（Authenticator）であり、`sui-sensemaking` は直接WebAuthn検証を実装しない。
  - `sui-sensemaking` が信頼するのは最終的な認証済みコンテキスト（ヘッダー/トークン検証結果）のみ。
- 最低限の受信属性（将来拡張を含む）は次のとおりです。
  - 必須: `userId`（`X-Forwarded-User` 相当）
  - 任意: `amr`（認証手段, 例: `pwd`, `webauthn`）, `acr`/`aal`（保証レベル）, `auth_time`（認証時刻）
- 運用上の必須ルールは次のとおりです。
  - 高リスク操作（将来のexport/share/admin相当）は `amr/acr/aal` に基づく追加制御が可能なI/Fで設計する（値が無い場合は保守的に拒否/read-only）。
  - `amr` 等の属性は監査目的で扱うが、端末固有情報や公開鍵クレデンシャルIDなど識別子の過剰保存は避ける。
  - セッション長・再認証要求（step-up）はIAP側ポリシーで実施し、アプリ本体は結果のみ受け取る。
- テスト観点は次のとおりです。
  - Mock SP/IdPで `amr=webauthn` を模擬できるようにし、属性有無の両ケースをE2Eで確認する。
  - 「パスキー利用時でもヘッダー契約が不変であること」を回帰条件に含める。

### 11) スキーマ定義として連動して深掘りすべき文書

本ADRの実装議論を進める際、次の文書を **同一論点で同期更新** する。

1. `02_Architecture/schemas.md`
   - `users` / `user_identities` の論理スキーマ、必須列、一意制約、状態遷移。
2. `02_Architecture/schemas_review_attribution.md`
   - `reviewerRef` / `ownerRef` と `internal_user_id` の参照整合。
3. `02_Architecture/review_attribution.md`
   - レビュー帰属の運用契約（表示名の揮発性、監査向け識別子）。
4. `02_Architecture/api.md`
   - `ALLOW_JIT_PROVISIONING=false` 時の拒否契約（403）と、管理者API/CLI（将来SCIM含む）のI/F。

本論点は `issue-AUTH-ARCH-01-*` に加えて、スキーマ計画専用issueで追跡する。

### 非目標

- 本ADRは「本番IdP製品選定（Keycloak/Authentik/Cloud IAP等）」を固定しない。
- 本ADRはアプリ内パスワード認証機能を追加しない。
- 本ADRは全RBAC実装を完了条件にしない（I/F整備を優先）。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 企業・行政で要求される監査/統制と整合しつつ、sui-sensemakingは認証実装責務を最小化しOSSとしての安全運用性を高める。認証プロトコルはアプリに実装せず前段IAP/IdPへ委譲する | 機能: 本番IdP製品選定（Keycloak/Authentik/Cloud IAP等）は固定せず、アプリ内パスワード認証機能を追加しない。データ: 全RBAC実装を完了条件にせずI/F整備を優先 |
| **データ設計** | ユーザーデータ境界はAUTH-ARCH-01/AUTH-SCHEMA-01の決裁結果と同期し、変更時はfollow-up issueから再度ADRへ昇格する。Mock SP/IdPはIdP連携境界変更時の拡張ゲートとして運用 | 業務: 入力方式の差異（header/JWT、IAPヘッダー名差異）は設定テンプレートで吸収し実装分岐の増殖を抑制。機能: Level 2は主要IdPのデータ連携様式をfixture化して設定互換の回帰保証を担う |
| **機能設計** | プロキシ設定ミス（trusted proxy, header mapping）が主要リスクとなるためLevel 1 E2Eを常時維持する。Mock SP/IdPを「常時必須」にせず拡張ゲートとして運用 | 業務: 本番IdP選定は組織の既存投資を尊重し設定で対応。データ: header/JWTの入力形式差は設定テンプレートで吸収し認証境界を維持 |

## Consequences

- `sui-sensemaking` は認証実装責務を最小化し、OSSとしての安全運用性を高める。
- 企業・行政で要求される監査/統制との整合が取りやすくなる。
- 一方で、プロキシ設定ミス（trusted proxy, header mapping）が主要リスクとなるため、Level 1 E2Eを常時維持する必要がある。
- Mock SP/IdPは「常時必須」ではなく、IdP連携境界変更時の拡張ゲートとして運用する。
- Level 2は主要IdPのデータ連携様式をfixture化して再現し、設定互換の回帰保証を担う。
- 入力方式の差異（header/JWT、各IAPのヘッダー名差異）は設定テンプレートで吸収し、実装分岐の増殖を抑制する。
- ユーザーデータ境界はAUTH-ARCH-01 / AUTH-SCHEMA-01の決裁結果と同期済みであり、変更時はfollow-up issueから再度ADRへ昇格する。

## Traceability

- Related: `02_Architecture/enterprise_architecture.html`
- Related: `02_Architecture/schemas.md`
- Related: `02_Architecture/api.md`
- Related: `02_Architecture/review_attribution.md`
- Related: `04_Documentation/security.md`
- Related: `03_Implement/frontend/docs/e2e_testing.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `01_Plans/adr/ADR-0019-e2e-verification-policy-and-compose-runbook.md`
- Follow-up: `01_Plans/issues/done/issue-AUTH-ARCH-01-authcontext-jit-provisioning-data-boundary.md`
- Follow-up: `01_Plans/issues/done/issue-AUTH-SCHEMA-01-identity-schema-planning.md`
- Replaces: `04_Documentation/auth_oidc_saml_mock_idp.md`
