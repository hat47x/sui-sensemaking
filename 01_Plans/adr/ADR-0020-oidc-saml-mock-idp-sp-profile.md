# ADR-0020: OIDC/SAML 対応における認証アーキテクチャ（IAPヘッダー認証 + Mock SP/IdP 検証プロファイル）

- Status: Accepted
- Date: 2026-03-06
- Deciders: Project Maintainers
- Scope: `01_Plans/adr/`

## Context

`sui-sensemaking` は企業・行政での運用を想定しつつ、OSSとして軽量性・安全性・再現性を維持する必要がある。
既存方針では、アプリ本体は認証機構を内包せず、外部基盤（リバースプロキシ / IdP）へ委譲する（`02_Architecture/enterprise_architecture.html`）。

一方で、OIDC/SAML連携の実装から検証までをAIエージェント主体で続けるには、次の論点を同時に解く必要がある。

- 本番運用での最適解（自前のSP/RP実装と、リバースプロキシ + OSS製品の比較）
- ローカル開発での簡易な認証の経路（開発者体験）
- E2Eでの再現できる検証の経路（Docker-in-Dockerに依存しない）
- ユーザー情報（JIT Provisioningで作る最小属性）とデータ設計との整合

## Decision

### 1) 本番運用アーキテクチャの採用方針

本番/準本番は **「完全ヘッダー認証方式（Identity-Aware Proxyモデル）」** を第一選択とする。

- 認証（OIDC/SAML）とセッション管理は前段のSP/IAPへ任せる。
- `sui-sensemaking` のバックエンドは、信頼されたプロキシから渡される認証済みヘッダーを受け取り、`AuthContext` を構築する。
- アプリ本体はパスワード・秘密情報・認証セッションを保持しない。

この判断は、`02_Architecture/enterprise_architecture.html` の「認証は外部責務」「アプリは署名済みユーザコンテキストを受け取る」方針を具体化するものである。


### 1.1) 認証責務境界（固定）

- 認証・セッション・再認証（step-up）の責務は前段のIAP / SPに委ね、`sui-sensemaking` 本体は保持しない。
- バックエンドの責務は「信頼境界の検証（trusted proxy）」「入力ヘッダーとJWTの検証」「`AuthContext` の正規化」の3点に限る。
- `AuthContext` 正規化後の契約（`userId`/`provider`/`subject`）のみをアプリ内部の認可・帰属判定に使用し、生のヘッダーの差異を下流へ伝えない。

### 1.2) `02_Architecture/enterprise_architecture.html` との整合項目

1. 認証外部委譲（IdP/IAP）とアプリ非保持原則を維持する。
2. `AuthContext` はアプリ内部I/Fの唯一の契約とし、プロバイダに依存する分岐を実装へ持ち込まない。
3. strict mode（`SUI_ALLOW_JIT_PROVISIONING=false`）を本番の既定とし、例外的な緩和は、承認を得た一時的な運用に限る。
4. SafeMode既定ON・PII最小化・監査最小化の上位契約を破らない。

### 2) 方式比較（意思決定根拠）

#### A. 自前で SAML SP / OIDC RP をアプリ内に実装する方式

利点

- アプリ単体で完結し、PoCの立ち上げが速い。
- UIや業務ロジックと密に結合しやすい。

課題

- 認証プロトコルの実装責務（署名検証、証明書更新、脆弱性への追随）がアプリ側に集中する。
- 企業・行政監査で「なぜ標準IAPを使わないか」の説明コストが高い。
- セキュリティレビュー対象が広がり、OSS保守負荷が増える。

#### B. リバースプロキシ + OSS IAP（推奨方式）

利点

- 認証責務を分離し、アプリ本体の攻撃面を縮小できる。
- 企業・行政で一般的な統制（IdP連携、証明書運用、監査）と親和性が高い。
- `sui-sensemaking` はヘッダー契約に集中でき、後方互換維持が容易。

課題

- 配備時に、プロキシの設定（trusted proxy, header contract）が必須になる。
- ローカル開発では、簡易な経路（Basic認証など）を別に用意する必要がある。

**結論**: `sui-sensemaking` の価値軸（軽量・安全・外部統合）を優先し、Bを採用する。

### 3) バックエンド（sui-sensemaking 本体）の必須契約

FastAPI側に「ヘッダー認証のDependency / Middleware」を実装し、以下を満たす。

1. Trust Proxyの強制
   - `TRUSTED_PROXIES`（CIDR/IP）で許可する送信元を制限する。
   - 許可していない送信元からの、認証ヘッダー付きの要求は拒否する（401/403）。
2. 汎用の `AuthContextAdapter`（設定駆動）
   - 認証情報の受け取り方式は **設定で切り替えられる** ものとする（実装を足さずに吸収する）。
   - 最低限サポートする入力モード
     - `header`（`X-Forwarded-*` などのHTTPヘッダー群）
     - `jwt_header`（例: `Authorization: Bearer <JWT>` または `X-Auth-Token`）
   - いずれのモードでも、最終的に同一の `AuthContext` へ正規化する。
3. クレームとヘッダーの対応付けの規則
   - `AUTH_USER_FIELD`, `AUTH_EMAIL_FIELD`, `AUTH_NAME_FIELD`, `AUTH_GROUPS_FIELD` などの設定キーで、
     受信元のフィールド名を差し替えられるようにする。
   - 既定値は標準的な `X-Forwarded-User` などを採用するが、AWS ALBやCloud IAPなどの差異は
     **provider preset（設定テンプレート）** で吸収し、サービスごとの個別実装を避ける。
   - `X-Forwarded-For` は認証IDには使わず、`TRUSTED_PROXIES` の判定と監査の補助にだけ使う。
4. リクエストコンテキスト
   - 正規化した `AuthContext` をAPIから参照できるようにする。
5. JIT Provisioning（最小）
   - 未知のユーザーがアクセスしたときに、最小限の属性（userId / displayName / emailなど）を登録する。
   - パスワードとハッシュは保持しない。

### 3.5) ユーザー識別・保持モデル（認証情報なし前提）

認証情報（passwordやMFA secret）を保持しない場合でも、`sui-sensemaking` 側の **ユーザーマスタは必須** とする。
理由は、認可判定、データの所有権、レビューの帰属をアプリ内部で安定して参照するためである。

- 原則
  - 認証は外部（IdP/IAP）の責務とし、`sui-sensemaking` は認証の結果を受け取る。
  - ただしアプリ内部では `internal_user_id`（不変キー）を保持し、データはこの内部IDに紐づける。
- 推奨データモデル（将来のスキーマ更新方針）
  - `users`（内部主体）
    - `id`（UUID等, immutable）, `display_name`, `role`, lifecycle metadata
  - `user_identities`（外部識別子との紐付け）
    - `user_id` (FK), `provider`, `external_uid`, attributes metadata
  - 関係: `users` 1 : N `user_identities`
- 標準の挙動（JIT有効時）
  - 受信した `provider + external_uid` を `user_identities` で検索する。
  - 見つかった場合は、対応する `users.id` を使う。
  - 見つからない場合は、`users` と `user_identities` を同時に作る（JIT provisioning）。

### 3.6) 複数認証経路（Google/社内SSO/学認等）の扱い

- 基本方針
  - アプリUIとしてのアカウントリンク機能は持たない（複雑さと脆弱性の増加を避けるため）。
  - 可能な限り前段のIdPで統合し、`sui-sensemaking` には単一で安定したIDを渡す。
- 例外対応（必要なときだけ）
  - IdPの移行、メールや所属の変更などで識別子が変わる場合に備え、
    管理者API/CLIで `user_identities` の付け替えと追加ができる設計の余地を持つ。
  - これにより、データ本体（cards/workspaces/review帰属）を内部の `users.id` に固定したまま救済できる。

### 3.7) JITと事前プロビジョニングの運用モード

`sui-sensemaking` は、OSSとしての普及しやすさと企業の統制を両立させるため、**ハイブリッド運用** を採用する。

- 既定（OSS向け）: `ALLOW_JIT_PROVISIONING=true`
  - 未登録のアイデンティティが到達したときに、動的な作成を許可する。
  - 導入の障壁を下げ、価値を得るまでの時間（Time-to-Value）を優先する。
- 厳格運用（企業・行政向け）: `ALLOW_JIT_PROVISIONING=false`
  - 未登録のアイデンティティは `403 Forbidden` とする。
  - 事前プロビジョニング（管理者API/CLI、将来的なSCIM連携）で登録済みのユーザーだけを許可する。

補足
- JITを無効にしても、認証は外部の責務のまま維持する。
- deprovisioningや事前の権限付与を厳密に運用する場合は、事前プロビジョニングのモードを推奨する。

### 4) フロントエンドの必須契約

- フロントエンドは、自前のログイン画面を標準の経路にしない。
- 認証状態は、バックエンドが `AuthContext` に反映した結果で表示する。
- ログアウトは、前段のSP/IAPへリダイレクトして終える方式（RP-Initiated logout）を使う。

### 5) ローカル開発プロファイル（簡易裏口）

開発者向けに `docker-compose.local.yml` を用意し、前段のプロキシ（推奨はCaddy）で次を提供する。

- Basic認証は **localとdevに限る** ものとし、本番と準本番では無効を既定とする。
- Basic認証は明示的な環境変数（例: `DEV_BASIC_AUTH_ENABLED=true`）が指定された場合にだけ有効にする。
- 環境ごとの有効と無効は、composeファイルで制御する（例: `docker-compose.local.yml` でのみ指定）。

- Basic認証（固定管理者資格情報）
- 認証成功時のヘッダー付与（例: `X-Forwarded-User: admin`）
- バックエンドへのリバースプロキシ

これにより、本体コードの認証仕様を変えずに、開発の経路を確保する。

### 6) E2E検証プロファイル（Mock SP/IdP の必要性を含む再整理）

結論として、`sui-sensemaking` の主な契約は「IAP/プロキシ -> AuthContext正規化」であり、
**Mock SP/IdPを常には必須にしない**。検証は次の2層で運用する。

#### Level 1: 既定（必須）AuthContext契約E2E

- 対象: `TRUSTED_PROXIES`、header/JWTの対応付け、JIT Provisioning、拒否と許可の制御。
- 方式: 軽量なプロキシ（またはテストハーネス）から認証済みコンテキストを注入し、
  `sui-sensemaking` 側の契約を直接検証する。
- 目的: 本プロジェクトの本質的な価値（アプリ境界の安全性と互換性）を、最短の経路で回帰保証する。

#### Level 2: 拡張（条件付き）FederationフローE2E

- 対象: OIDC/SAMLのフロー全体（redirect/callback/logout、署名検証、`xmlsec1` への依存など）。
- 方式: FastAPI製のモック群（`mock_sp` + `mock_idp`）を起動して検証する。
  - `mock_idp`: SAML（`pysaml2`）, OIDC（`Authlib`）
  - `mock_sp`: 認証成功後に `X-Forwarded-User` などを付与してバックエンドへ転送する
- 目標: 主要なIdP製品とサービスで観測されるデータ連携の仕様と様式を、
  **テストコード上のprovider profile fixtures** として再現し、検証する。
  - 例: ヘッダー名の差異、JWT claim名の差異、`groups` の形式、`amr/acr` の有無。
  - 方針: 製品ごとに実装の分岐を増やさず、preset + fixtureの差し替えで吸収する。
- 実行例（Dockerに依存しない）
  - `uvicorn mock_idp:app --port 8081`
  - `uvicorn mock_sp:app --port 8080`
  - `uvicorn sui_sensemaking_backend.main:app --port 8000`

#### Mock SP/IdPを実施すべき条件

- `AuthContextAdapter` の入力モードやprovider presetの仕様を変更したとき。
- provider profile fixtures（主要IdPの連携様式）を追加または変更したとき。
- logout / step-up / `amr` など、IdP連携の境界に関わる仕様を変更したとき。
- 依存ライブラリ更新（`pysaml2`, `Authlib`, `xmlsec1`）で、連携の回帰リスクが高いとき。

上記の条件に当てはまらないPRでは、Level 1を満たせば受け入れてよい。

### 7) 暗号素材と依存

- SAMLの署名とOIDCのJWKSは、テストの起動時に動的に生成する。
- 鍵素材を平文のままコミットしてはならない。
- `pysaml2` 実行要件として `xmlsec1` を導入する（ローカルの手順 + Dockerfile）。

### 8) 受入基準（最小）

1. trusted proxyの外からの、ヘッダーを偽装した要求を拒否できる。
2. trusted proxyを経由したときに、`AuthContext` が構築される。
3. JIT Provisioningで最小限のユーザーレコードが作成される（パスワード列はない）。
4. E2Eの受け入れ基準
   - **必須**: Level 1（AuthContext契約E2E）を通過する。
   - **条件付きで必須**: IdP連携の境界を変更するPRでは、Level 2（Mock SP/IdP）も通過する。
   - **Level 2の実施時**: 少なくとも1つのprovider profile fixture（主要IdPの様式）を使った回帰を含める。

### 9) 未決事項（TODO / Issue化）

AUTH-ARCH-01で固定した論点と、継続して検討する論点を分ける。

#### 9.1 固定済み（本ADRの決定として扱う）

- ユーザーの最小属性スキーマ（永続する項目とPIIの最小化）
- reviewerRef / ownerRefとAuthContext.userIdの正規の対応付け
- `users` / `user_identities` の正式なスキーマの骨子（`provider+external_uid` の一意制約、strictとJITの分岐）
- `ALLOW_JIT_PROVISIONING=false` のときの403拒否の契約と、最小の管理の経路（`POST /admin/provision/users`）
- 組織属性の境界: `roles/groups/policyRef` はtransient（外部への照会）で扱い、アプリのDBには永続化しない

#### 9.2 継続検討（後続Issueで扱う）

- 管理の経路を将来置き換える場合（SCIMや企業ID管理との連携）の運用の詳細

#### 2026-03-03 update（AUTH-ARCH-01 確定）

- AuthContext/JIT属性の境界を固定
  - persist: `provider`, `external_uid`, `display_name`, `email`
  - transient: `amr/acr/aal/auth_time`, `roles/groups`, `trace_id`
  - forbidden: password/hash/secret, WebAuthn credential id, raw policy token
- 正規の対応付けを固定
  - `AuthContext.userId = users.id`
  - `reviewerRef = ownerRef = user:<users.id>`
- strict modeの契約を固定
  - `SUI_ALLOW_JIT_PROVISIONING=false` かつ未登録のsubjectは `403`
  - 事前プロビジョニング `POST /admin/provision/users`（将来SCIMに置き換える点）
- 監査の最小化の契約を固定
  - `amr/acr/aal/auth_time` の生の値を永続化することを禁止し、監査では正規化した指標（`hasStepUp`/`assuranceLevel`/`authAgeBucket`）だけを許可する
- strict modeの運用責任を固定
  - 例外的な緩和は、Security OfficerとSystem Ownerの2者承認とする
  - Platform Operatorが、実行の記録（時刻、理由、承認者）を保持する

上記は、issue memo `issue-AUTH-ARCH-01-authcontext-jit-provisioning-data-boundary.md` で管理する。

### 10) IdPがパスキー（FIDO2/WebAuthn）を提供する場合の考慮事項

前段のIdP/SP側がパスキー認証を採用しても、`sui-sensemaking` 本体の基本原則（認証情報を保持しない）は維持する。

- 位置づけ
  - パスキーはIdP側の認証手段（Authenticator）であり、`sui-sensemaking` はWebAuthnの検証を直接実装しない。
  - `sui-sensemaking` が信頼するのは、最終的な認証済みコンテキスト（ヘッダーとトークンの検証結果）だけである。
- 最低限の受信属性（将来の拡張を含む）
  - 必須: `userId`（`X-Forwarded-User` 相当）
  - 任意: `amr`（認証手段, 例: `pwd`, `webauthn`）, `acr`/`aal`（保証レベル）, `auth_time`（認証時刻）
- 運用上の必須ルール
  - 高リスクの操作（将来のexport/share/admin相当）は、`amr/acr/aal` に基づく追加の制御ができるI/Fで設計する（値がない場合は、安全側で拒否するか読み取り専用にする）。
  - `amr` などの属性は監査の目的で扱うが、端末固有の情報や公開鍵クレデンシャルIDなど、識別子の過剰な保存は避ける。
  - セッションの長さと再認証の要求（step-up）はIAP側のポリシーで実施し、アプリ本体は結果だけを受け取る。
- テストの観点
  - Mock SP/IdPで `amr=webauthn` を模擬できるようにし、属性がある場合とない場合の両方をE2Eで確認する。
  - 「パスキーを使うときでもヘッダー契約が変わらないこと」を回帰の条件に含める。

### 11) スキーマ定義として連動して深掘りすべき文書

本ADRの実装に関する議論を進めるときは、次の文書を **同一の論点で同期して更新** する。

1. `02_Architecture/schemas.md`
   - `users` / `user_identities` の論理スキーマ、必須列、一意制約、状態遷移。
2. `02_Architecture/schemas_review_attribution.md`
   - `reviewerRef` / `ownerRef` と `internal_user_id` の参照整合。
3. `02_Architecture/review_attribution.md`
   - レビュー帰属の運用契約（表示名が変わりやすいこと、監査向けの識別子）。
4. `02_Architecture/api.md`
   - `ALLOW_JIT_PROVISIONING=false` のときの拒否の契約（403）と、管理者API/CLI（将来のSCIMを含む）のI/F。

この論点は、`issue-AUTH-ARCH-01-*` に加えて、スキーマ計画専用のissueで追跡する。

### 非目標

- 本ADRは「本番IdP製品の選定（Keycloak/Authentik/Cloud IAPなど）」を固定しない。
- 本ADRはアプリ内パスワード認証機能を追加しない。
- 本ADRは、RBACの全実装を完了条件にしない（I/Fの整備を優先する）。

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
