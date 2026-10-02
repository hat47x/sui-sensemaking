# Configuration

対象読者: sui-sensemakingを起動・運用する管理者、検証担当者。

目的: すべての公開環境変数、安全な既定値、設定変更後の確認方法を示します。

範囲外: 組織固有の秘密管理、未公開ネットワーク情報、承認履歴。

公開区分: 運用者向け公開候補。ここでは利用者が設定する `SUI_*` と既存の既定値だけを扱い、内部adapterの秘密値や未承認の設定変更は扱いません。

## 基本方針

- sui-sensemakingの利用者・運用者が設定する環境変数は、すべて例外なく `SUI_` で始まります。
- 接頭辞のない旧キーや、別接頭辞の互換キーは使いません。
- Docker Composeやbuild toolが内部的に別名を必要とする場合も、利用者が設定する公開キーは `SUI_*` だけです。
- 既定ではLLM連携は無効です。
- 外部サービスとの共有やlarge-scale LLMの利用は、明示的なopt-inと宛先allowlistがある場合だけ有効にします。


## 起動面ごとの配送範囲（重要）

このページの `export SUI_*` 例は、特記がない限りbackendを直接起動する場合の設定例です。標準Docker Compose (`docker-compose.yml`) は、次の公開キーを明示的な配送面として持ちます。この2行は `01_Plans/tests/test_configuration_compose_delivery_contract.py` でCompose定義と照合します。

| Compose surface | 配送される公開キー | 挙動 |
| --- | --- | --- |
| `api.environment` | `SUI_RUNTIME_PROFILE`, `SUI_DATABASE_URL`, `SUI_LLM_PROVIDER`, `SUI_APP_REVISION`, `SUI_API_KEY`, `SUI_ALLOW_JIT_PROVISIONING` | profile・DB・provider は Compose 既定値を持つ。revision・API key・JIT は host で設定された場合だけ pass-through する。 |
| `web.build.args` | `SUI_FRONTEND_API_BASE`, `SUI_RUNTIME_PROFILE`, `SUI_APP_REVISION` | API base は標準 Compose では `/api` に固定。profile と revision は frontend build 時に確定する。 |

これとは別に、`SUI_WEB_PORT` はloopback公開ポートを、`SUI_POSTGRES_DB` / `SUI_POSTGRES_USER` / `SUI_POSTGRES_PASSWORD` はdbコンテナのvendor設定と既定DB URLの組み立てを制御します。上表にないbackend設定は、`Delivery surface` が `direct` の場合、標準Composeへは届きません。必要な接続系設定は組織側overlayで関連キーを一組として配送してください。キーごとの正本は [runtime_parameter_registry.md の Backend settings 表](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings)です。

標準Composeは同梱の `evaluation` 用スタックです。`SUI_RUNTIME_PROFILE` 自体は `enterprise-production` / `saas-multitenant` もbackendとfrontendへ配送できますが、標準 `api.environment` は両profileで起動必須の `SUI_ADMIN_API_KEY` を配送せず、SaaSで必要な外部adapter・OAuth・session系の `direct` キーも配送しません。そのためprofile名だけを変更しても起動はfail-fastします。これらのprofileをComposeで使う場合は、組織側overlayで各profileの必須キー一式を明示配送してください。

## 公開設定と内部adapter境界

| 区分 | 利用者が設定するか | 例 | 取り扱いルール |
| --- | --- | --- | --- |
| 公開設定（public contract） | はい | `SUI_DATABASE_URL`, `SUI_WEB_PORT`, `SUI_POSTGRES_DB`, `SUI_POSTGRES_USER`, `SUI_POSTGRES_PASSWORD` | `SUI_*` のみを設定対象とします。 |
| 内部adapter設定（private boundary） | いいえ | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | third-party コンテナ内部でのみ使用します。公開設定としては受け付けません。 |

## 設定を変える前に

設定は「値を増やす」より先に「何を許可するか」を決めると安全です。

| 確認すること | 例 |
| --- | --- |
| データはどこに保存するか | SQLite か PostgreSQL か |
| 外部サービスと共有する必要があるか | LLM、audit HTTP、access control |
| 失敗したとき安全側に倒れるか | LLM disabled、access control read-only |
| 秘密値をどこで管理するか | shell history や Git に残さない |

## ここで出る用語

| 用語 | 意味 |
| --- | --- |
| 環境変数 | 起動時や build 時にアプリへ渡す設定値です。 |
| 既定値 | 何も設定しないときに使われる値です。 |
| opt-in | 明示的に有効化することです。large-scale LLM は opt-in なしでは使えません。 |
| allowlist | 接続してよい宛先だけを並べた一覧です。 |


## Runtime profiles（推奨プロファイル）

実装既定値（未設定時に使われる値）と、運用で推奨する値は異なる場合があります。
迷った場合はGitHub上の [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md) を参照してください。

- `local-dev`: **起動hard gateは追加なし**。SQLite + `SUI_LLM_PROVIDER=none` を推奨し、未登録header userを自動作成する場合だけJITを明示 `true`。
- `evaluation`: **profile単体の起動hard gateは追加なし**。標準ComposeではPostgreSQL + LLM `none` + audit/access-control `noop` を推奨。
- `enterprise-production`: **起動hard gate**は別値の `SUI_ADMIN_API_KEY` と `SUI_API_KEY`。JIT `false`、LLM `none`、fail-safe `read_only` または `deny` は運用推奨。
- `saas-multitenant`: **起動hard gate**は `SUI_ADMIN_API_KEY`、PostgreSQL、外部PDP/document binding/tenant capabilityと各endpoint、JIT無効、deny fail-safe、OAuth authorize endpoint、auth-session hash key。OAuth BFFのlogin開始にはredirect URI + client ID、callback code交換にはtoken endpoint + redirect URI + client ID + client secretの完全セットが必要。これらは起動hard gateではなく、欠損時は該当requestを503で拒否。

`SUI_RUNTIME_PROFILE`でprofile名を指定します。Docker Composeの既定は`evaluation`、backendを直接起動したときの未指定既定は`local-dev`です。

> 注意: `SUI_ALLOW_JIT_PROVISIONING` の実装既定値は **`false`（fail-closed、2026-08-13 変更）**です。`local-dev` / `evaluation` でヘッダー由来のユーザー自動作成を使う場合は明示 `true` を設定してください。既定 `false` は未認証の未知ヘッダーからのユーザー自動作成（濫用可能）を防ぎます（SEC-RATE-LIMIT-01）。
> 補足: `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` は実装既定値 `read_only` ですが、`enterprise-production` では `read_only` と `deny` のどちらを採るかを事前に固定してください。

## 最小設定

Docker Composeの既定値で起動する場合、通常は追加設定なしで動きます。明示するなら次を使います。

```bash
export SUI_LLM_PROVIDER=none
export SUI_RUNTIME_PROFILE=evaluation
export SUI_DATABASE_URL='postgresql+asyncpg://sui_sensemaking:sui_sensemaking@db:5432/sui_sensemaking'
export SUI_WEB_PORT=8080
```

ローカルSQLiteでbackendを直接起動する場合。

```bash
export SUI_DATABASE_URL='sqlite:///./sui_sensemaking.db'
export SUI_RUNTIME_PROFILE=local-dev
export SUI_LLM_PROVIDER=none
```

最初の確認では `SUI_LLM_PROVIDER=none` を推奨します。AI機能は使えませんが、意図しない外部サービスとの共有を避けながら、保存・表示・受け入れ確認の基本動作を確認できます。

## Backend 環境変数

次の表はbackendが受け付ける全環境変数です。

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `SUI_RUNTIME_PROFILE` | `local-dev` | `local-dev`, `evaluation`, `enterprise-production`, `saas-multitenant`。SaaSは共有認証表を含む最新migrationと必須policyを起動前検査。 |
| `SUI_DATABASE_URL` | `sqlite:///./sui_sensemaking.db` | backend が使うSQLAlchemy接続URL。正式対応DB、検証済みdriver、single-tenant／shared-schema SaaSの範囲は[DB対応表](../02_Architecture/database_portability.md)を正本とする。driver省略URLと対応済みasync URLは検証済み同期driverへ正規化され、未検証driverと未知DBはengine生成前に拒否される |
| `SUI_LLM_PROVIDER` | `none` | `none`, `local`, `local_http`, `large-scale`, `large_scale`, `external`, `deepseek` |
| `SUI_LOG_LEVEL` | `INFO` | アプリケーションログ（JSON／人間可読）とuvicornログの出力レベル（OPS-OBSERV-01）。`CRITICAL`/`ERROR`/`WARNING`/`INFO`/`DEBUG`、未知値（`NOTSET` を含む）は `INFO` へフォールバック |
| `SUI_APP_REVISION` | `unknown` | ビルドリビジョン（OPS-OBSERV-01）。1〜64文字のASCII英数字・`.`・`_`・`-`だけをcanonical値として受理し、それ以外は`unknown`へ丸める。`/version` と全アプリケーションログ（JSON／人間可読）、frontend 診断バンドルの `app.revision` に反映。Compose では build-arg + `api.environment` から配線 |
| `SUI_LOCAL_LLM_BASE_URL` | 未設定 | local LLMのHTTPSまたはloopback HTTP base URL |
| `SUI_LOCAL_LLM_MODEL` | 未設定 | local LLMで使う256文字以下のmodel ID |
| `SUI_LARGE_SCALE_LLM_BASE_URL` | 未設定 | large-scale LLMのHTTPSまたはloopback HTTP base URL |
| `SUI_LARGE_SCALE_LLM_MODEL` | 未設定 | large-scale LLMで使う256文字以下のmodel ID |
| `SUI_LLM_ESCALATION_ENABLED` | `false` | 互換名は escalation だが、現行実装では large-scale provider kind の実行gate。`false` では primary `large-scale`/`external` の起動readinessを満たさず、model registry経由のregistered large-scale providerも利用不可。`LargeScaleProvider.generate()` 自体も拒否する。利用には別途 `SUI_LLM_LARGE_SCALE_OPT_IN=true` も必須 |
| `SUI_LLM_LARGE_SCALE_OPT_IN` | `false` | large-scale 利用の明示 opt-in |
| `SUI_LARGE_SCALE_LLM_ALLOWLIST` | 未設定 | large-scale接続を許可するhostのカンマ区切り。URLやwildcardは不可 |
| `SUI_LLM_FALLBACK_TO_NONE` | `true` | `provider_unavailable` / `provider_timeout` を成功応答へ切り替えず、`none` metadata（`fallback_to_none=true`, `execution_path=<provider>->none`）付き `ProviderDisabledError` としてfail-closedする。`provider_validation` はfallback対象外。`false` では元の `ProviderRequestError` を維持する |
| `SUI_DEEPSEEK_API_KEY` | 未設定 | DeepSeek API 認証キー。primary `SUI_LLM_PROVIDER=deepseek` では起動readinessの必須値。model registryのregistered DeepSeek providerも `api_key_ref=SUI_DEEPSEEK_API_KEY` の場合に同じ値をrequest-timeで解決し、未設定・非canonicalなら provider unavailable としてfail-closedする |
| `SUI_DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek API のbase URL。credential/query/fragmentなしのHTTPS、またはloopback HTTPだけを許可 |
| `SUI_DEEPSEEK_MODEL` | `deepseek-v4-flash` | DeepSeek API に渡す256文字以下のcanonical model ID（空白・制御文字・backslash不可） |
| `SUI_DEEPSEEK_THINKING_MODE` | `disabled` | DeepSeek V4 thinking mode（`disabled` / `enabled`）。primary DeepSeek とmodel registry経由のregistered DeepSeekの送信payload `thinking.type` に反映し、local / large-scaleのgeneric HTTP payloadには作用しない。旧既定のnon-thinking挙動を維持するため既定はdisabled |
| `SUI_LLM_TASK_MODEL_MAP` | 未設定（空文字） | タスク別モデル割当（`task=model,...`）。未設定タスクは既定モデル |
| `SUI_LLM_HIGH_REASONING_MODEL` | 未設定 | final_judgement系タスク（check_narrative / detect_contradiction）の既定モデル。未設定時は既定モデルへフォールバック（AI-ROUTE-01 MMR-04） |
| `SUI_API_KEY` | 未設定 | business-plane APIを `X-API-Key` で保護。`enterprise-production` では起動必須。`saas-multitenant` はtrusted JWT/cookie identityを使うためbusiness key自体は起動必須ではない。`/healthz` / `/readyz` / `/version` は運用probeとして対象外。`/admin/*` もbusiness key対象外で、別のcontrol-plane認可（`X-Admin-Api-Key` / provision capability）を使う |
| `SUI_ADMIN_API_KEY` | 未設定 | control-plane の Stage A bootstrap 資格情報。`X-Admin-Api-Key` で提示する。Stage B では trusted SaaS session の `tenant.provision` capability でも `/admin/provision/**` を認可でき、request に admin bearer は不要。業務面 `SUI_API_KEY` は管理面で受理せず、同じ秘密値を `SUI_API_KEY` と `SUI_ADMIN_API_KEY` の両方へ設定する構成も起動時に拒否する。`enterprise-production` / `saas-multitenant` では設定自体が**必須**（未設定なら起動しない）。`local-dev` / `evaluation` は admin key 未設定時だけ development 用に管理面を開く |
| `SUI_LOG_JSON` | `true` | 既定は1行1JSON。`true` では `extra={...}` の `tenantId` / `docId` / `queueLength` / LLM `trace_id` などを構造化fieldとして出力する。`false` ではこれらextra fieldは出力せず、人間可読書式に `requestId` / `actorRefHash` / `appRevision` を残す（OPS-OBSERV-01） |
| `SUI_AUDIT_EXPORT_ENABLED` | `false` | audit export のdispatch master gate。`false` ではvalidation済みtransport設定に関係なく外部送信せず `NoopAuditTransport` を使う。ただし `SUI_AUDIT_TRANSPORT=http` の完全設定validationは独立して適用され、export無効でもendpoint欠損は起動時に拒否する。`true` のときだけtransport設定が実送信に使われる |
| `SUI_AUDIT_TRANSPORT` | `noop` | `noop` または `http`。`http` はexport flagと独立してendpoint必須の完全設定validationを受ける。validation通過後、実送信に使われるのは `SUI_AUDIT_EXPORT_ENABLED=true` の場合だけで、export無効時は `http` 指定でも dispatcher は `NoopAuditTransport` を使う |
| `SUI_AUDIT_HTTP_ENDPOINT` | 未設定 | 監査ログ連携の接続先 URL。credential/query/fragmentなしのHTTPS、またはloopback HTTPだけを許可し、`SUI_AUDIT_TRANSPORT=http` 時は必須 |
| `SUI_AUDIT_HTTP_API_KEY` | 未設定 | 監査ログの HTTP 連携用 API key。非空のcanonical bearer値（空白・制御文字不可） |
| `SUI_AUDIT_HTTP_TIMEOUT_SECONDS` | `2.0` | 監査ログの HTTP 連携の timeout 秒数 |
| `SUI_AUDIT_QUEUE_SIZE` | `100` | 外部監査送信失敗時のfail-open retry buffer上限。正常送信時やexport無効時はqueueへ積まない |
| `SUI_AUDIT_DEDUP_WINDOW_SECONDS` | `5.0` | `context-audit` / `export-audit` が渡す同一論理操作のdedup keyに対する重複排除ウィンドウ（SEC-AUDIT-DUP-01）。`view` / `LLM` / `proposal` 監査には適用しない。`0` で無効化 |
| `SUI_AUDIT_ALLOW_IN_SAFE_MODE` | `false` | `AuditEvent.safeMode=true` の外部監査送出を許可するevent-level gate。`false` ではviewおよびsafeMode=trueのcontext/export系を抑止する。LLM / proposal監査はproducerがsafeMode=falseを明示するため対象外 |
| `SUI_ACCESS_CONTROL_ADAPTER` | `noop` | `noop`, `mock`, `external_http` |
| `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` | `read_only` | Org/Restricted 文書の `policyRef` 欠損または access-control adapter 障害時の fail-safe。`read_only` は read だけ allow + read-only、write / export / share は deny。`deny` は read を含む全 action を deny |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT` | 未設定 | `external_http` adapter で使う必須のPDP接続先 URL。credential/query/fragmentなしのHTTPS、またはloopback HTTPだけを許可 |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_TIMEOUT_SECONDS` | `1.5` | `external_http` adapter の timeout 秒数 |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_AUTH_MODE` | `none` | PDPへ渡す `x-acl-auth-mode` metadata。`none`, `oidc`, `saml`。この値自体は `Authorization` headerを生成・変更せず、固定bearerは `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_STATIC_BEARER_TOKEN` で別設定する |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_STATIC_BEARER_TOKEN` | 未設定 | `external_http` adapter の固定 bearer token。非空のcanonical bearer値（空白・制御文字不可） |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_IDP_ISSUER` | 未設定 | PDPへ `x-idp-issuer` として渡すIdP issuer metadata。設定する場合は `SUI_ACCESS_CONTROL_ADAPTER=external_http` と endpoint が必須。canonical header valueとして検査するが、この設定自体はJWT/SAML issuerをローカル検証しない |
| `SUI_DOCUMENT_POLICY_BINDING_RESOLVER` | `none` | 文書の非秘密binding IDを外部policy参照へ解決するresolver。`none`, `external_http`。`saas-multitenant` では `external_http` が必須で、起動前にexternal componentを検査し、server-owned document resource解決へ配線 |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_ENDPOINT` | 未設定 | binding resolverのHTTPS接続先。ローカル検証だけloopback HTTP可 |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_API_KEY` | 未設定 | binding resolver専用bearer token。非空のcanonical bearer値（空白・制御文字不可）。Git、DB、監査へ保存しない |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_TIMEOUT_SECONDS` | `1.5` | binding resolverのtimeout秒数（0より大きく30以下） |
| `SUI_TENANT_CAPABILITY_RESOLVER` | `none` | tenantごとの有効権限を解決するresolver。`none`, `external_http`。`saas-multitenant` では `external_http` が必須で、起動前にexternal componentを検査し、tenant-scoped capability resolverとして配線 |
| `SUI_TENANT_CAPABILITY_HTTP_ENDPOINT` | 未設定 | capability resolverのHTTPS接続先。ローカル検証だけloopback HTTP可 |
| `SUI_TENANT_CAPABILITY_HTTP_API_KEY` | 未設定 | capability resolver専用bearer token。非空のcanonical bearer値（空白・制御文字不可）。Git、DB、監査へ保存しない |
| `SUI_TENANT_CAPABILITY_HTTP_TIMEOUT_SECONDS` | `1.5` | capability resolverのtimeout秒数（0より大きく30以下） |
| `SUI_ALLOW_JIT_PROVISIONING` | `false` | single-tenant の forwarded-header identity path でだけ未登録identityのJIT provisioningを許可する。`true` なら user・identity binding・local-default membershipを作成し、`false` なら403 `identity_not_provisioned`。`saas-multitenant` は起動時に `false` が必須で、trusted JWT/cookie pathはこの設定に関係なく未登録subjectを403で拒否する（SEC-RATE-LIMIT-01・2026-08-13変更） |
| `SUI_SAAS_OAUTH_BROKER_HTTP_AUTHORIZE_ENDPOINT` | 未設定 | ADR-0074 BFF: OAuth authorization-code フロー開始 URL。credential/query/fragment なしの HTTPS、または loopback HTTP だけを許可。`saas-multitenant` では必須（`TrustedSaasRuntimePolicy` が起動前検査） |
| `SUI_SAAS_OAUTH_BROKER_HTTP_TOKEN_ENDPOINT` | 未設定 | ADR-0074 BFF: code 交換用 token endpoint。credential/query/fragment なしの HTTPS、または loopback HTTP だけを許可。起動必須ではないが、callbackでは redirect URI / client ID / client secret と4項目完全セットで必要。欠損時503 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_REDIRECT_URI` | 未設定 | ADR-0074 BFF: OAuth callback の redirect URI。credential/query/fragment なしの HTTPS、または loopback HTTP だけを許可し、path は `/session/callback` 固定。起動必須ではないが、login開始では client ID とともに必要、callbackでは4項目完全セットの一部。欠損時は該当requestを503 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_ID` | 未設定 | ADR-0074 BFF: OAuth client ID。2,048文字以下のcanonical値（空白・制御文字不可）。起動必須ではないが、login開始では redirect URI とともに必要、callbackでは4項目完全セットの一部。欠損時は該当requestを503 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_SECRET` | 未設定 | ADR-0074 BFF: OAuth client secret（秘密。ログ・監査・DBへ保存しない）。非空のcanonical bearer値（空白・制御文字不可）。起動必須ではないがcallbackの4項目完全セットで必要。欠損時503 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_TIMEOUT_SECONDS` | `5.0` | ADR-0074 BFF: broker HTTP timeout 秒数（0 より大きく 30 以下） |
| `SUI_SAAS_AUTH_SESSION_HASH_KEY` | 未設定 | ADR-0074 / ADR-0080: member SaaS auth session、guest auth session、guest redeem state のHMAC-SHA256導出に共有するキー（64文字 lowercase hex = 32 bytes）。`saas-multitenant` では必須。guest redeem state はdomain separationを通し、生cookie/state値はDBへ平文保存しない。キーをローテーションすると既存member/guest sessionと未使用redeem stateは無効化される |
| `SUI_MAX_DOCUMENT_BYTES` | `20971520` | DocumentV1 保存ペイロードの UTF-8 バイト上限（20 MiB・SEC-DOC-BOUND-01） |
| `SUI_MAX_DOCUMENT_CARDS` | `50000` | DocumentV1 のカード件数（SEC-DOC-BOUND-01。meta-dogfoodingの数万枚規模と20,000-card targetに対する余白を確保） |
| `SUI_ALLOW_UNREVIEWED_AI_TEXT` | `false` | AI リクエストの `allowUnreviewedText` 緩和を許可するか（SEC-AI-SAFEMODE-01・ADR-0068） |
| `SUI_AUTH_PROVIDER_FIELD` | `x-auth-provider` | single-tenant の forwarded-header identity path で external identity provider を受け取る header 名。値はtrim・lowercase正規化され、欠損/空値は `header`。`saas-multitenant` の trusted JWT/cookie path では使用しない |
| `SUI_AUTH_USER_FIELD` | `x-forwarded-user` | single-tenant の forwarded-header identity path で `AUTH_SUBJECT_FIELD` 欠損時の external UID/subject fallback を受け取る legacy header 名。内部 `users.id` を直接指定しない。`saas-multitenant` の trusted JWT/cookie path では使用しない |
| `SUI_AUTH_EMAIL_FIELD` | `x-forwarded-email` | single-tenant の forwarded-header identity path でJIT provisioning時に新規 `UserRow.email` を初期化する header 名。既存user属性は更新しない。`saas-multitenant` の trusted JWT/cookie path では使用しない |
| `SUI_AUTH_NAME_FIELD` | `x-forwarded-name` | single-tenant の forwarded-header identity path でJIT provisioning時に新規 `UserRow.display_name` を初期化する header 名。既存user属性は更新しない。`saas-multitenant` の trusted JWT/cookie path では使用しない |
| `SUI_AUTH_SUBJECT_FIELD` | `x-auth-subject` | single-tenant の forwarded-header identity path で external UID/subject の第一候補を受け取る header 名。欠損時だけ `AUTH_USER_FIELD` へfallbackする。`saas-multitenant` の trusted JWT/cookie path では使用しない |
| `SUI_JWT_ALGORITHMS` | `RS256,ES256` | trusted OIDC/JWT 署名検証の algorithm allowlist（カンマ区切り）。受理値は `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`, `PS256`, `PS384`, `PS512`。空list、HMAC 系、`none` を含む未知値は Settings validation で起動時に拒否し、未指定時は既定 `RS256,ES256` を使う。 |
| `SUI_TENANT_CLAIM_NAME` | `tenant_ref` | trusted JWT 内の tenant 外部識別子を運ぶclaim名。`tenant_ref` は既定値で固定名ではない。非空・256文字以下・前後空白なし・空白文字なし・printableなカスタム名を指定でき、値は `tenant_identity_providers.external_tenant_ref` と照合する。 |
| `SUI_TRUSTED_PROXIES` | （空） | single-tenant forwarded-header identity path の信頼できるsource proxy CIDR（カンマ区切り）。設定時は `request.client.host` をauth header読取より先に検査するため、非信頼IPはheaderの有無にかかわらず403 `untrusted_proxy`。未設定時はsource gateを行わず警告ログを1回出す。本番では設定を推奨。`saas-multitenant` のtrusted JWT/cookie pathでは使用しない。 |
| `SUI_REVIEWER_REF_RESOLVER_ADAPTER` | `user_id` | reviewerRef 解決 adapter。`user_id` または `sso_subject` |
| `SUI_CE4_EQUIVALENCE_MODE` | `equivalence_and_bundle_hash` | CE4 同値性判定 mode |
| `SUI_CE4_DRY_RUN_ENFORCE_NO_SIDE_EFFECT` | `true` | CE4 dry-run が副作用なしであることを強制 |
| `SUI_CE4_AUDIT_REQUIRE_ALL_EVENTS` | `true` | CE4 audit 欠損を fail-closed にする |
| `SUI_CE4_SOURCE_BUNDLE_HASH_ALLOW_MOCK` | `true` | docs CE4 の `POST /docs/{doc_id}/context-audit` で `sourceBundleHash=mock:<hash>` を許容する policy。proposal / CE4 resolve の受理契約は別で、この switch の対象外 |
| `SUI_CE4_STUB_UNRESOLVED_CONTRACTS` | `true` | 未確定 CE4 契約を stub 応答で隔離する fail-closed 契約。現在は `true` 固定で、`false` は起動時に拒否 |

## Compose / frontend build 環境変数

次の表は、標準Docker Composeがhostから参照する公開キーと、frontendを直接buildするときに設定できる公開キーです。これらもすべて `SUI_` で始まります。標準Composeでhostから変更できないbuild値は用途欄に明記します。

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `SUI_WEB_PORT` | `8080` | web の loopback（`127.0.0.1`）port。port 番号だけを変え、LAN など他ホストからの到達可否は変えない |
| `SUI_POSTGRES_DB` | `sui_sensemaking` | Compose PostgreSQL の database 名 |
| `SUI_POSTGRES_USER` | `sui_sensemaking` | Compose PostgreSQL の user 名 |
| `SUI_POSTGRES_PASSWORD` | `sui_sensemaking` | Compose PostgreSQL の password |
| `SUI_RUNTIME_PROFILE` | `evaluation`（Compose） | backendとfrontendへ同じ実行profileを渡す。`saas-multitenant`はPostgreSQL共有認証表と必須外部adapterが必要 |
| `SUI_APP_REVISION` | `unknown` | backend `/version`・全アプリケーションログと frontend 診断bundleを同じbuildへ結び付ける。標準 Compose は api へ pass-through し、web build へも渡す |
| `SUI_FRONTEND_API_BASE` | `/api` | frontend direct build の API base path。標準 Compose は `/api` を固定注入するため host 側の値では変更できない |

PostgreSQL imageやfrontend build toolの内部名は、sui-sensemakingの公開設定キーではありません。利用者は上の `SUI_*` だけを設定します。

サードパーティイメージやbuild toolが内部的に別名を要求する場合でも、利用者が設定するsui-sensemakingの公開設定は `SUI_*` だけに統一します。

## よく使う構成例

### ローカル評価

```bash
export SUI_DATABASE_URL='sqlite:///./sui_sensemaking.db'
export SUI_RUNTIME_PROFILE=local-dev
export SUI_LLM_PROVIDER=none
```

### Docker Compose 評価

```bash
export SUI_LLM_PROVIDER=none
export SUI_RUNTIME_PROFILE=evaluation
export SUI_WEB_PORT=8080
```

### API key 付き検証

```bash
export SUI_API_KEY='change-me'
```

この値は例です。実運用では推測しにくい値を使い、Gitにコミットしないでください。

## Frontend の API 接続先

frontendのAPI接続先は `SUI_FRONTEND_API_BASE` で指定します。未設定なら `/api` を使います。値はsame-originの絶対pathとして扱い、`/` 自体または単一の `/` で始まるpathだけを受理します。`//host` のようなnetwork-path reference、backslash、query (`?`)、fragment (`#`) を含む値や相対pathは受理せず、frontend側で `/api` にフォールバックします。`/` はroot API baseとして扱います。

ローカル開発サーバーとDocker Composeの標準構成では `/api` がbackendへproxyされます。標準Composeは同梱Nginxの `location /api/` と一致させるためfrontend buildに `/api` を固定注入し、host側で `SUI_FRONTEND_API_BASE` を変更しても標準ComposeのAPI baseは変更しません。別pathを使う場合はfrontendを直接buildし、そのpathをbackendへ配送するreverse proxyも同時に構成してください。

直接frontend buildを実行する場合は、build前に`SUI_RUNTIME_PROFILE`と`SUI_FRONTEND_API_BASE`を設定します。profile未指定時はlocal-firstの`local-dev`相当です。空文字、未知値、前後空白を含む値はsingle-tenantへfallbackせずblocked画面になります。

```bash
export SUI_RUNTIME_PROFILE=local-dev
export SUI_FRONTEND_API_BASE=/api
npm run build
```

## API キーを有効にする

```bash
export SUI_API_KEY='change-me'
```

`/healthz` / `/readyz` / `/version` は運用probeとしてAPIキーなしで確認できます。`/admin/*` はbusiness API keyでは保護せず、`X-Admin-Api-Key` またはprovision capabilityによるcontrol-plane認可を使います。それ以外のbusiness-plane APIへアクセスする場合は次のヘッダーを付けます。

```bash
curl -H "X-API-Key: change-me" http://localhost:8080/api/docs/example
```

ブラウザで動く同梱の画面（SPA）は `X-API-Key` を付与しません。そのため `SUI_API_KEY` を設定すると画面からの読み込み・保存は401になります。APIキーは `curl` などプログラムからのアクセス保護を想定したものです。ブラウザでの動作検証では未設定（既定）のまま使い、ブラウザ配信自体を保護する場合は前段に認証proxyを置いてください（[security.md](security.md) 参照）。

> 注意: 標準 Docker Compose はこのキーをホスト環境から pass-through 配送します。`local-dev` / `evaluation` では未設定ならbusiness API keyは無効のままです。`enterprise-production` はこのキーを起動必須とするため未設定では起動しません。`saas-multitenant` はtrusted JWT/cookie identityを使うためbusiness key自体は起動必須ではありません（control plane用 `SUI_ADMIN_API_KEY` は別途必須です）。[runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings) 参照。

## local LLM を使う

local providerは `<base_url>/generate` にJSONをPOSTします。応答は `{ "text": "..." }` を返す必要があります。

```bash
export SUI_LLM_PROVIDER=local
export SUI_LOCAL_LLM_BASE_URL='http://localhost:8001'
export SUI_LOCAL_LLM_MODEL='local-model-name'
```

base URLにはcredential、query、fragment、空白、制御文字、backslashを含められません。HTTPS、または`localhost`、`127.0.0.1`、`::1`へのHTTPだけを使用できます。model IDは256文字以下で、空白・制御文字・backslashを含められません。

providerへ送るrequestはUTF-8 JSONで1MiB以下です。task、temperature、max token数も安全な範囲へ検証され、過大promptや不正な数値は接続前に`provider_validation`として拒否されます。この検証エラーはfallbackで`none`へ置き換えられません。

> 注意: 上記は direct 起動時の例です。標準 Docker Compose はこれらのキーを配送しません。Compose 上で `local` provider を検証する場合は、検証専用の `docker-compose.llm-stub.yml` overlay を使ってください（`docker compose -f docker-compose.yml -f docker-compose.llm-stub.yml up -d`）。また `api` コンテナ内から見た `http://localhost:8001` はホストではなく `api` コンテナ自身を指すため、Compose 環境ではこの例をそのまま転記しないでください。

## large-scale LLM を使う

large-scale providerは既定で無効です。利用する場合は、昇格許可、明示opt-in、allowlistをすべて設定します。

```bash
export SUI_LLM_PROVIDER=large-scale
export SUI_LLM_ESCALATION_ENABLED=true
export SUI_LLM_LARGE_SCALE_OPT_IN=true
export SUI_LARGE_SCALE_LLM_BASE_URL='https://llm.example.com'
export SUI_LARGE_SCALE_LLM_MODEL='model-name'
export SUI_LARGE_SCALE_LLM_ALLOWLIST='llm.example.com'
```

large-scaleではbase URL、model、allowlistをすべて設定し、base URLのhostをallowlistへ含める必要があります。allowlistはhost名またはIPアドレスだけをカンマ区切りで指定し、scheme付きURL、wildcard、port、path、空要素、重複は起動時に拒否されます。base URLとmodelにはlocal providerと同じcanonical値制約を適用します。

## アクセス制御を使う

既定の `noop` は、認可判定を外部のPDPに任せません。外部PDPを使う場合は、方式（adapter）、失敗時の扱い（fail-safe）、接続先（endpoint）をセットで設定します。

```bash
export SUI_ACCESS_CONTROL_ADAPTER=external_http
export SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only
export SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT='https://pdp.example.com/decide'
```

アクセス制御で`external_http`を指定する場合、接続先（endpoint）は必須です。空の場合は`noop`へ縮退せず、設定エラーとして起動を拒否します。外部PDPを使わない場合は、adapterを明示的に`noop`へ戻し、endpointと固定bearerも同時に未設定へ戻してください。`noop`のままendpointまたは固定bearerだけを残す構成は起動時に拒否されます。endpointはcredential、query、fragment、空白、制御文字、backslashを含まないHTTPS URLにし、HTTPはloopbackだけで利用できます。IdP issuerを設定する場合も`external_http` adapterとendpointが必要で、どちらかを欠く構成は起動時に拒否されます。0以下または30秒超のtimeoutも起動時に拒否されます。

監査HTTPも同じendpoint・bearer・timeout制約を適用します。`SUI_AUDIT_TRANSPORT=http`ではendpointが必須で、欠損時はnoopへ縮退せず起動を拒否します。`noop`のまま監査endpoint/API keyを残す設定や、`http`でendpointなしのままAPI keyだけを設定する構成も拒否されます。送信先を完全設定した後の一時的な監査送信失敗は、従来どおり本体機能を止めないfail-open方針です。

### 文書policy binding resolver

`document_access_metadata`に保存する値は非秘密のbinding IDとversionだけです。`external_http` resolverはこれらをactive tenant IDとともに信頼済みサービスへPOSTし、応答の`policyRef`をそのrequest内だけで利用します。raw policyRefやAPI keyをDB、監査、export、diagnosticsへ保存しません。

```bash
export SUI_DOCUMENT_POLICY_BINDING_RESOLVER=external_http
export SUI_DOCUMENT_POLICY_BINDING_HTTP_ENDPOINT='https://binding.example.com/v1/resolve'
export SUI_DOCUMENT_POLICY_BINDING_HTTP_API_KEY='set-in-secret-store'
export SUI_DOCUMENT_POLICY_BINDING_HTTP_TIMEOUT_SECONDS=1.5
```

接続先はcredential、query、fragmentを含まないHTTPS URLにします。HTTPは`localhost`、`127.0.0.1`、`::1`だけで利用できます。resolverを`none`へ戻す場合はendpoint/API keyも同時に未設定へ戻し、`none`のままHTTP設定だけを残す構成は起動時に拒否されます。`saas-multitenant` では `external_http` が必須で、起動前にexternal componentを検査し、`ServerOwnedDocumentResourceResolver` のpolicy binding resolverとして配線されます。このresolverだけでSaaSが成立するわけではなく、trusted auth edge、external access control、tenant capability resolver等の必須条件も同時に満たす必要があります。

### Tenant capability resolver

`external_http` resolverは、server-resolved `principalId`、`tenantId`、`membershipId`だけを信頼済みpolicy serviceへPOSTし、既知の`effectiveCapabilities`と`capabilityVersion`を取得します。role/group名やclient指定tenantを送信・保存しません。

```bash
export SUI_TENANT_CAPABILITY_RESOLVER=external_http
export SUI_TENANT_CAPABILITY_HTTP_ENDPOINT='https://capability.example.com/v1/resolve'
export SUI_TENANT_CAPABILITY_HTTP_API_KEY='set-in-secret-store'
export SUI_TENANT_CAPABILITY_HTTP_TIMEOUT_SECONDS=1.5
```

接続先とAPI keyにはbinding resolverと同じ制約を適用し、resolverを`none`へ戻す場合はendpoint/API keyも同時に未設定へ戻します。`none`のままHTTP設定だけを残す構成は起動時に拒否されます。未知capability、重複、余分なroles/groups field、不正version、timeoutは成功扱いにせず、APIでは`503 capability_resolution_unavailable`へ倒します。`saas-multitenant` では `external_http` が必須で、起動前にexternal componentを検査し、runtimeのtenant capability resolverとして配線されます。trusted SaaS identity / tenant / active-session adaptersも同profileでbundleとして導入されますが、required policyやactive IdPが欠ける構成は起動時にfail-fastします。

## 設定後の確認

```bash
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
```

直接backendを起動している場合。

```bash
curl -fsS http://127.0.0.1:8000/healthz
```

設定ミスでbackendが起動しない場合、`api` logにvalidation errorが出ます。特に旧キー、provider名、large-scaleのopt-in不足を確認してください。

## 関連文書

- [installation.md](installation.md)
- [data_handling.md](data_handling.md)
- [security.md](security.md)
- [local_llm_ops_guide.md](local_llm_ops_guide.md)
- [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md)
