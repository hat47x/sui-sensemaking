# 設定ガイド

対象読者: sui-sensemakingを起動・運用する管理者、検証担当者。

目的: すべての公開環境変数、安全な既定値、設定変更後の確認方法を示します。

## 基本方針

- 利用者や運用者が設定する環境変数は、すべて例外なく `SUI_` で始まります。
- 接頭辞のない旧キーや、別の接頭辞を使う互換キーは受け付けません。
- Docker Composeやビルドツールが内部で別名を必要とする場合も、利用者が設定する公開キーは `SUI_*` だけです。
- 既定ではLLM連携を無効にしています。
- 外部サービスとの共有や大規模LLMの利用は、利用者が明示的に有効化し、接続先を許可リストへ載せたときだけ使えます。

## 起動方法による設定の届き方

このページの `export SUI_*` の例は、特に断りがなければbackendを直接起動する場合の設定です。標準のDocker Compose（`docker-compose.yml`）が受け渡す公開キーは、次の2か所だけです。

| Composeの受け渡し先 | 渡される公開キー | 挙動 |
| --- | --- | --- |
| `api.environment` | `SUI_RUNTIME_PROFILE`, `SUI_DATABASE_URL`, `SUI_LLM_PROVIDER`, `SUI_APP_REVISION`, `SUI_API_KEY`, `SUI_ALLOW_JIT_PROVISIONING` | プロファイル、DB、プロバイダにはComposeの既定値があります。リビジョン、APIキー、JITは、ホストで設定したときだけそのまま渡されます。 |
| `web.build.args` | `SUI_FRONTEND_API_BASE`, `SUI_RUNTIME_PROFILE`, `SUI_APP_REVISION` | 標準のComposeではAPIの基準パスを `/api` に固定します。プロファイルとリビジョンはfrontendのビルド時に決まります。 |

これとは別に、`SUI_WEB_PORT` はループバックで公開するポートを決めます。`SUI_POSTGRES_DB`、`SUI_POSTGRES_USER`、`SUI_POSTGRES_PASSWORD` は、dbコンテナの設定と既定のDB URLの組み立てに使います。

上の表にないbackend設定は、標準のComposeには届きません。接続に関わる設定を追加するときは、組織側の上書きファイル（オーバーレイ）で、関連するキーをひとまとめにして渡してください。各キーの正本は、[runtime_parameter_registry.md のバックエンド設定の表](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings)です。

標準のComposeは、同梱の `evaluation` 用スタックです。`SUI_RUNTIME_PROFILE` の値自体は `enterprise-production` や `saas-multitenant` でもbackendとfrontendへ渡せます。しかし標準の `api.environment` は、両プロファイルで起動に必須の `SUI_ADMIN_API_KEY` を渡さず、SaaSに必要な外部アダプタ、OAuth、セッション関連のキーも渡しません。プロファイル名だけを変えると、設定不足で起動時に停止します。これらのプロファイルをComposeで使うときは、組織側のオーバーレイで、必須キーを一式渡してください。

## 公開設定と内部設定

| 区分 | 利用者が設定するか | 例 | 扱い |
| --- | --- | --- | --- |
| 公開設定 | はい | `SUI_DATABASE_URL`, `SUI_WEB_PORT`, `SUI_POSTGRES_DB`, `SUI_POSTGRES_USER`, `SUI_POSTGRES_PASSWORD` | 設定してよいのは `SUI_*` だけです。 |
| 内部設定 | いいえ | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | サードパーティ製コンテナの内部でだけ使います。公開設定としては受け付けません。 |

## 設定を変える前に

値を増やす前に、何を許可するかを決めると安全です。

| 確認すること | 例 |
| --- | --- |
| データをどこに保存するか | SQLiteかPostgreSQLか |
| 外部サービスと共有する必要があるか | LLM、監査ログのHTTP連携、アクセス制御 |
| 失敗したときに、安全な動作になるか | LLMは無効、アクセス制御は読み取り専用 |
| 秘密の値をどこで管理するか | シェルの履歴やGitに残さない |

## このページで使う用語

| 用語 | 意味 |
| --- | --- |
| 環境変数 | 起動時やビルド時にアプリへ渡す設定値です。 |
| 既定値 | 何も設定しないときに使われる値です。 |
| オプトイン | 利用者が明示的に有効にすることです。大規模LLMは、オプトインしないと使えません。 |
| 許可リスト | 接続してよい宛先だけを並べた一覧です。 |
| プロファイル | 実行環境の種類です。環境ごとに、起動に必要な設定が決まっています。 |

## 実行プロファイル

実装上の既定値（未設定のときに使われる値）と、運用で勧める値は異なる場合があります。迷ったときは、GitHub上の [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md) を参照してください。

- `local-dev`: 起動時の必須条件は追加されません。SQLiteと `SUI_LLM_PROVIDER=none` を勧めます。未登録のヘッダー利用者を自動作成したいときだけ、JITを明示的に `true` にします。
- `evaluation`: プロファイル単独の起動条件は追加されません。標準のComposeでは、PostgreSQL、LLMは `none`、監査とアクセス制御は `noop` を勧めます。
- `enterprise-production`: 起動に、互いに異なる値の `SUI_ADMIN_API_KEY` と `SUI_API_KEY` が必要です。JITは `false`、LLMは `none`、フェイルセーフは `read_only` か `deny` を勧めます。
- `saas-multitenant`: 起動に次のすべてが必要です。`SUI_ADMIN_API_KEY`、PostgreSQL、外部のPDP、文書のポリシー紐づけ、テナント権限の各リゾルバーとその接続先、JITの無効化、フェイルセーフを `deny` にすること、OAuthの認可エンドポイント、認証セッションのハッシュキー。OAuth BFFの設定のうち、ログイン開始にはリダイレクトURIとクライアントID、コールバックでのコード交換にはトークンエンドポイント、リダイレクトURI、クライアントID、クライアントシークレットの4つがそろっている必要があります。これらは起動の必須条件ではありません。欠けていると、該当するリクエストを503で拒否します。

プロファイルは `SUI_RUNTIME_PROFILE` で指定します。Docker Composeの既定は `evaluation` です。backendを直接起動して指定しなかった場合は `local-dev` になります。

> 注意: `SUI_ALLOW_JIT_PROVISIONING` の既定値は `false` で、不明なヘッダーからの利用者作成を拒否します。`local-dev` や `evaluation` でヘッダーからの利用者自動作成を使うときは、明示的に `true` を設定してください。既定の `false` は、認証されていない未知のヘッダーから利用者が自動で作られ、悪用されることを防ぎます。
>
> 補足: `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` の既定値は `read_only` です。`enterprise-production` では、`read_only` と `deny` のどちらにするかを、事前に決めてください。

## 最小の設定

Docker Composeの既定値で起動するときは、通常は追加の設定が要りません。明示するなら次のようにします。

```bash
export SUI_LLM_PROVIDER=none
export SUI_RUNTIME_PROFILE=evaluation
export SUI_DATABASE_URL='postgresql+asyncpg://sui_sensemaking:sui_sensemaking@db:5432/sui_sensemaking'
export SUI_WEB_PORT=8080
```

ローカルのSQLiteでbackendを直接起動するときは、次のようにします。

```bash
export SUI_DATABASE_URL='sqlite:///./sui_sensemaking.db'
export SUI_RUNTIME_PROFILE=local-dev
export SUI_LLM_PROVIDER=none
```

最初の確認では、`SUI_LLM_PROVIDER=none` を勧めます。AI機能は使えませんが、外部サービスと意図せず共有することなく、保存、表示、受け入れ確認の基本動作を確認できます。

## backendの環境変数

次の表は、backendが受け付けるすべての環境変数です。

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `SUI_RUNTIME_PROFILE` | `local-dev` | `local-dev`、`evaluation`、`enterprise-production`、`saas-multitenant` のいずれか。SaaSでは、共有の認証テーブルを含む最新のマイグレーションと、必須のポリシー設定を、起動前に検査します。 |
| `SUI_DATABASE_URL` | `sqlite:///./sui_sensemaking.db` | backendが使うSQLAlchemyの接続URL。対応するDB、検証済みのドライバ、シングルテナントと共有スキーマのSaaSの範囲は、[DB対応表](../02_Architecture/database_portability.md)が正本です。ドライバを省略したURLと、対応済みの非同期URLは、検証済みの同期ドライバに読み替えます。未検証のドライバと未知のDBは、接続を作る前に拒否します。 |
| `SUI_LLM_PROVIDER` | `none` | `none`、`local`、`local_http`、`large-scale`、`large_scale`、`external`、`deepseek` のいずれか。 |
| `SUI_LOG_LEVEL` | `INFO` | アプリケーションログ（JSONと人間向け書式）とuvicornログの出力レベル。`CRITICAL`、`ERROR`、`WARNING`、`INFO`、`DEBUG` を指定できます。未知の値（`NOTSET` を含む）は `INFO` になります。 |
| `SUI_APP_REVISION` | `unknown` | ビルドのリビジョン。1〜64文字のASCII英数字と `.`、`_`、`-` だけを受け付け、それ以外は `unknown` にします。`/version`、すべてのアプリケーションログ、frontendの診断バンドルの `app.revision` に反映されます。Composeではビルド引数と `api.environment` で渡します。 |
| `SUI_LOCAL_LLM_BASE_URL` | 未設定 | ローカルLLMのベースURL。HTTPS、またはループバックのHTTPだけを使えます。 |
| `SUI_LOCAL_LLM_MODEL` | 未設定 | ローカルLLMで使う256文字以下のモデルID。 |
| `SUI_LARGE_SCALE_LLM_BASE_URL` | 未設定 | 大規模LLMのベースURL。HTTPS、またはループバックのHTTPだけを使えます。 |
| `SUI_LARGE_SCALE_LLM_MODEL` | 未設定 | 大規模LLMで使う256文字以下のモデルID。 |
| `SUI_LLM_ESCALATION_ENABLED` | `false` | 名前は互換のために残していますが、現在の実装では、大規模LLMプロバイダを実行してよいかを決める設定です。`false` のままだと、`large-scale` や `external` を主プロバイダにしても起動できず、モデル登録経由で登録した大規模プロバイダも使えません。使うには `SUI_LLM_LARGE_SCALE_OPT_IN=true` も必要です。 |
| `SUI_LLM_LARGE_SCALE_OPT_IN` | `false` | 大規模LLMを使うことへの、明示的なオプトイン。 |
| `SUI_LARGE_SCALE_LLM_ALLOWLIST` | 未設定 | 大規模LLMへの接続を許可するホストを、カンマ区切りで並べます。URLとワイルドカードは指定できません。 |
| `SUI_LLM_FALLBACK_TO_NONE` | `true` | `provider_unavailable` や `provider_timeout` のとき、成功として応答を返さず、`none` に切り替えたことを示すメタデータ（`fallback_to_none=true`、`execution_path=<プロバイダ>->none`）を付けた `ProviderDisabledError` で、処理を続けず、失敗として扱います。`provider_validation` はこの切り替えの対象外です。`false` にすると、元の `ProviderRequestError` をそのまま返します。 |
| `SUI_DEEPSEEK_API_KEY` | 未設定 | DeepSeek APIの認証キー。`SUI_LLM_PROVIDER=deepseek` を主プロバイダにするときは、起動に必須です。モデル登録で登録したDeepSeekプロバイダも、`api_key_ref=SUI_DEEPSEEK_API_KEY` のときは同じ値をリクエスト時に取得します。未設定、または形式が正しくない場合は、プロバイダが使えないものとして処理を続けず、失敗として扱います。 |
| `SUI_DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek APIのベースURL。認証情報、クエリ、フラグメントを含まないHTTPS、またはループバックのHTTPだけを使えます。 |
| `SUI_DEEPSEEK_MODEL` | `deepseek-v4-flash` | DeepSeek APIに渡す256文字以下のモデルID。空白、制御文字、バックスラッシュは使えません。 |
| `SUI_DEEPSEEK_THINKING_MODE` | `disabled` | DeepSeek V4のthinkingモード（`disabled` か `enabled`）。主プロバイダのDeepSeekと、モデル登録経由のDeepSeekが送る `thinking.type` に反映します。ローカルと大規模LLMの汎用HTTPリクエストには影響しません。以前の既定である非thinkingの挙動を保つため、既定は `disabled` です。 |
| `SUI_DEEPSEEK_THINKING_TASK_MAP` | 未設定 | タスクごとにthinkingモードを指定します（例: `check_narrative=enabled,suggest_document_title=disabled`）。未記載のタスクは `SUI_DEEPSEEK_THINKING_MODE` に従いますが、`check_narrative` と `detect_contradiction` は、未指定なら `enabled` で動きます。 |
| `SUI_LLM_TASK_MODEL_MAP` | 未設定（空文字） | タスクごとのモデル割り当て（`task=model,...`）。割り当てのないタスクは既定のモデルを使います。 |
| `SUI_LLM_HIGH_REASONING_MODEL` | 未設定 | 最終判断にあたるタスク（`check_narrative`、`detect_contradiction`）の既定モデル。未設定のときは、通常の既定モデルを使います。 |
| `SUI_API_KEY` | 未設定 | 業務用APIを `X-API-Key` ヘッダーで保護します。`enterprise-production` では起動に必須です。`saas-multitenant` は、検証済みのJWTやCookieで本人を識別するため、このキーは起動に必須ではありません。`/healthz`、`/readyz`、`/version` は運用の死活確認用なので、このキーの対象外です。`/admin/*` もこのキーの対象外で、別の管理面の認可（`X-Admin-Api-Key` またはprovision権限）を使います。 |
| `SUI_ADMIN_API_KEY` | 未設定 | 管理面（control plane）の、ステージAの初期設定用の資格情報。`X-Admin-Api-Key` ヘッダーで提示します。ステージBでは、検証済みのSaaSセッションが持つ `tenant.provision` 権限でも `/admin/provision/**` を認可でき、リクエストに管理用のベアラートークンは要りません。業務用の `SUI_API_KEY` は管理面では受け付けません。同じ秘密値を `SUI_API_KEY` と `SUI_ADMIN_API_KEY` の両方に設定した構成も、起動時に拒否します。`enterprise-production` と `saas-multitenant` では設定が必須で、未設定だと起動しません。`local-dev` と `evaluation` では、管理用キーが未設定のときだけ、開発用に管理面を開放します。 |
| `SUI_LOG_JSON` | `true` | 既定は1行1JSONです。`true` のときは、`extra={...}` で渡される `tenantId`、`docId`、`queueLength`、LLMの `trace_id` などを、構造化したフィールドとして出力します。`false` のときは、これらの追加フィールドを出力せず、人間向け書式に `requestId`、`actorRefHash`、`appRevision` だけを残します。 |
| `SUI_AUDIT_EXPORT_ENABLED` | `false` | 監査ログの外部送信を行うかを決める主スイッチ。`false` のときは、送信先の設定が正しくても外部へ送らず、何もしない送信先（`NoopAuditTransport`）を使います。ただし `SUI_AUDIT_TRANSPORT=http` の設定検査は独立して行うので、送信が無効でもエンドポイントが欠けていれば起動時に拒否します。`true` のときだけ、送信先の設定を実際の送信に使います。 |
| `SUI_AUDIT_TRANSPORT` | `noop` | `noop` か `http`。`http` は、送信の有効・無効とは別に、エンドポイントを必須とする設定検査を受けます。検査を通っても、実際に送るのは `SUI_AUDIT_EXPORT_ENABLED=true` のときだけです。送信が無効なら、`http` を指定していても何もしない送信先を使います。 |
| `SUI_AUDIT_HTTP_ENDPOINT` | 未設定 | 監査ログの連携先URL。認証情報、クエリ、フラグメントを含まないHTTPS、またはループバックのHTTPだけを使えます。`SUI_AUDIT_TRANSPORT=http` のときは必須です。 |
| `SUI_AUDIT_HTTP_API_KEY` | 未設定 | 監査ログのHTTP連携で使うAPIキー。空でなく、空白と制御文字を含まない値にします。 |
| `SUI_AUDIT_HTTP_TIMEOUT_SECONDS` | `2.0` | 監査ログのHTTP連携のタイムアウト（秒）。 |
| `SUI_AUDIT_QUEUE_SIZE` | `100` | 外部への監査送信に失敗したとき、再送のために溜めておく件数の上限。正常に送れた場合と、送信が無効な場合は、溜めません。 |
| `SUI_AUDIT_DEDUP_WINDOW_SECONDS` | `5.0` | `context-audit` と `export-audit` が同じ操作として渡した記録を、重複とみなす時間（秒）。`view`、LLM、proposalの監査には適用しません。`0` にすると無効になります。 |
| `SUI_AUDIT_ALLOW_IN_SAFE_MODE` | `false` | `AuditEvent.safeMode=true` の監査を外部へ送ってよいかを、イベント単位で決めます。`false` のときは、viewの監査と、`safeMode=true` のcontext系・export系の監査を送りません。LLMとproposalの監査は、生成側が `safeMode=false` と明示するため、対象外です。 |
| `SUI_ACCESS_CONTROL_ADAPTER` | `noop` | `noop`、`mock`、`external_http` のいずれか。 |
| `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` | `read_only` | OrgまたはRestrictedの文書で、`policyRef` が欠けているとき、またはアクセス制御のアダプタが故障したときの安全側の動作。`read_only` は、読み取りだけを許可し、書き込み、書き出し、共有を拒否します。`deny` は、読み取りを含むすべての操作を拒否します。 |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT` | 未設定 | `external_http` アダプタが使うPDPの接続先URL。必須です。認証情報、クエリ、フラグメントを含まないHTTPS、またはループバックのHTTPだけを使えます。 |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_TIMEOUT_SECONDS` | `1.5` | `external_http` アダプタのタイムアウト（秒）。 |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_AUTH_MODE` | `none` | PDPへ渡す `x-acl-auth-mode` のメタデータ。`none`、`oidc`、`saml` のいずれか。この値自体は `Authorization` ヘッダーを作ったり変えたりしません。固定のベアラートークンは、`SUI_ACCESS_CONTROL_EXTERNAL_HTTP_STATIC_BEARER_TOKEN` で別に設定します。 |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_STATIC_BEARER_TOKEN` | 未設定 | `external_http` アダプタが使う固定のベアラートークン。空でなく、空白と制御文字を含まない値にします。 |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_IDP_ISSUER` | 未設定 | PDPへ `x-idp-issuer` として渡すIdPの発行者情報。設定するときは、`SUI_ACCESS_CONTROL_ADAPTER=external_http` とエンドポイントも必要です。ヘッダー値としての形式は検査しますが、JWTやSAMLの発行者を、この設定だけでローカルに検証することはありません。 |
| `SUI_DOCUMENT_POLICY_BINDING_RESOLVER` | `none` | 文書に付いた秘密でない紐づけIDを、外部のポリシー参照に解決するリゾルバー。`none` か `external_http`。`saas-multitenant` では `external_http` が必須で、起動前に外部コンポーネントを検査し、サーバー側の文書リソース解決に組み込みます。 |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_ENDPOINT` | 未設定 | 紐づけリゾルバーの接続先。HTTPSを使います。ローカルでの検証に限り、ループバックのHTTPも使えます。 |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_API_KEY` | 未設定 | 紐づけリゾルバー専用のベアラートークン。空でなく、空白と制御文字を含まない値にします。Git、DB、監査ログには保存しません。 |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_TIMEOUT_SECONDS` | `1.5` | 紐づけリゾルバーのタイムアウト（秒）。0より大きく、30以下にします。 |
| `SUI_TENANT_CAPABILITY_RESOLVER` | `none` | テナントごとの有効な権限を解決するリゾルバー。`none` か `external_http`。`saas-multitenant` では `external_http` が必須で、起動前に外部コンポーネントを検査し、テナント単位の権限リゾルバーとして組み込みます。 |
| `SUI_TENANT_CAPABILITY_HTTP_ENDPOINT` | 未設定 | 権限リゾルバーの接続先。HTTPSを使います。ローカルでの検証に限り、ループバックのHTTPも使えます。 |
| `SUI_TENANT_CAPABILITY_HTTP_API_KEY` | 未設定 | 権限リゾルバー専用のベアラートークン。空でなく、空白と制御文字を含まない値にします。Git、DB、監査ログには保存しません。 |
| `SUI_TENANT_CAPABILITY_HTTP_TIMEOUT_SECONDS` | `1.5` | 権限リゾルバーのタイムアウト（秒）。0より大きく、30以下にします。 |
| `SUI_ALLOW_JIT_PROVISIONING` | `false` | シングルテナントの転送ヘッダーによる本人識別でだけ、未登録の利用者を自動作成（JIT）してよいかを決めます。`true` なら、利用者、識別子の紐づけ、既定のメンバーシップを作ります。`false` なら、403 `identity_not_provisioned` を返します。`saas-multitenant` では起動時に `false` が必須です。検証済みのJWTやCookieによる経路では、この設定にかかわらず、未登録の利用者を403で拒否します。 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_AUTHORIZE_ENDPOINT` | 未設定 | OAuthの認可コードフローを始めるURL。認証情報、クエリ、フラグメントを含まないHTTPS、またはループバックのHTTPだけを使えます。`saas-multitenant` では必須で、起動前に検査します。 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_TOKEN_ENDPOINT` | 未設定 | 認可コードを交換するトークンエンドポイント。認証情報、クエリ、フラグメントを含まないHTTPS、またはループバックのHTTPだけを使えます。起動には必須ではありません。ただしコールバックでは、リダイレクトURI、クライアントID、クライアントシークレットと合わせた4項目がそろっている必要があり、欠けていると503を返します。 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_REDIRECT_URI` | 未設定 | OAuthのコールバックで使うリダイレクトURI。認証情報、クエリ、フラグメントを含まないHTTPS、またはループバックのHTTPだけを使え、パスは `/session/callback` に固定です。起動には必須ではありません。ログインの開始にはクライアントIDと合わせて必要で、コールバックでは4項目の1つとして必要です。欠けていると、該当するリクエストに503を返します。 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_ID` | 未設定 | OAuthのクライアントID。2,048文字以下で、空白と制御文字を含まない値にします。起動には必須ではありません。ログインの開始にはリダイレクトURIと合わせて必要で、コールバックでは4項目の1つとして必要です。欠けていると、該当するリクエストに503を返します。 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_SECRET` | 未設定 | OAuthのクライアントシークレット。秘密の値なので、ログ、監査ログ、DBには保存しません。空でなく、空白と制御文字を含まない値にします。起動には必須ではありませんが、コールバックの4項目の1つとして必要で、欠けていると503を返します。 |
| `SUI_SAAS_OAUTH_BROKER_HTTP_TIMEOUT_SECONDS` | `5.0` | OAuthブローカーへのHTTP通信のタイムアウト（秒）。0より大きく、30以下にします。 |
| `SUI_SAAS_AUTH_SESSION_HASH_KEY` | 未設定 | メンバーの認証セッション、ゲストの認証セッション、ゲストの引き換え状態のHMAC-SHA256を求めるときに共有するキー（64文字の小文字16進数、32バイト）。`saas-multitenant` では必須です。ゲストの引き換え状態はドメイン分離を通し、Cookieや状態の生の値はDBに平文で保存しません。キーを入れ替えると、既存のメンバーとゲストのセッション、および未使用の引き換え状態が無効になります。 |
| `SUI_AGENT_CREDENTIAL_HASH_KEY` | 未設定 | 外部のAIエージェント（MCPなど）の不透明な資格情報を、保存する前にHMAC-SHA256でハッシュ化するキー（64文字の小文字16進数、32バイト）。セッション用のキーとは別にしてあるため、片方を入れ替えてももう片方の資格情報は無効になりません。未設定なら、エージェント資格情報の発行と認証は使えません（安全側）。キーを入れ替えると、発行済みのエージェント資格情報がすべて無効になります。 |
| `SUI_AGENT_OAUTH_AUDIENCE` | 未設定 | トークン交換で得た、エージェント用のOAuthトークンが持つべき `aud`。この値と完全に一致するトークンだけを、エージェントとして受け付けます。メンバーのログイン用やゲスト用のトークンは `aud` が違うため、エージェントとしては通りません。未設定なら、OAuthによるエージェント認証は使えません（安全側）。 |
| `SUI_MAX_DOCUMENT_BYTES` | `20971520` | DocumentV1を保存するときの、UTF-8のバイト数の上限（20 MiB）。 |
| `SUI_MAX_DOCUMENT_CARDS` | `50000` | DocumentV1のカード数の上限。 |
| `SUI_ALLOW_UNREVIEWED_AI_TEXT` | `false` | AIへのリクエストで、`allowUnreviewedText` による制限の緩和を許可するか。 |
| `SUI_AUTH_PROVIDER_FIELD` | `x-auth-provider` | シングルテナントの転送ヘッダーによる本人識別で、外部のIDプロバイダを受け取るヘッダー名。値は前後の空白を除いて小文字にし、欠けているか空なら `header` にします。`saas-multitenant` の、検証済みのJWTやCookieによる経路では使いません。 |
| `SUI_AUTH_USER_FIELD` | `x-forwarded-user` | シングルテナントの転送ヘッダーによる本人識別で、`SUI_AUTH_SUBJECT_FIELD` が欠けているときに、外部のUIDを代わりに受け取る旧来のヘッダー名。内部の `users.id` は直接指定しないでください。`saas-multitenant` の、検証済みのJWTやCookieによる経路では使いません。 |
| `SUI_AUTH_EMAIL_FIELD` | `x-forwarded-email` | シングルテナントの転送ヘッダーによる本人識別で、JITによる利用者の自動作成時に、新しい利用者のメールアドレスの初期値を受け取るヘッダー名。既存の利用者の属性は更新しません。`saas-multitenant` の、検証済みのJWTやCookieによる経路では使いません。 |
| `SUI_AUTH_NAME_FIELD` | `x-forwarded-name` | シングルテナントの転送ヘッダーによる本人識別で、JITによる利用者の自動作成時に、新しい利用者の表示名の初期値を受け取るヘッダー名。既存の利用者の属性は更新しません。`saas-multitenant` の、検証済みのJWTやCookieによる経路では使いません。 |
| `SUI_AUTH_SUBJECT_FIELD` | `x-auth-subject` | シングルテナントの転送ヘッダーによる本人識別で、外部のUID（subject）を最優先で受け取るヘッダー名。欠けているときだけ、`SUI_AUTH_USER_FIELD` で受け取ります。`saas-multitenant` の、検証済みのJWTやCookieによる経路では使いません。 |
| `SUI_JWT_ALGORITHMS` | `RS256,ES256` | 検証済みのOIDCとJWTの署名検証で許可するアルゴリズム（カンマ区切り）。指定できるのは `RS256`、`RS384`、`RS512`、`ES256`、`ES384`、`ES512`、`PS256`、`PS384`、`PS512` です。空のリスト、HMAC系、`none` を含む未知の値は、起動時に拒否します。未指定のときは `RS256,ES256` を使います。 |
| `SUI_TENANT_CLAIM_NAME` | `tenant_ref` | 検証済みのJWTで、テナントの外部識別子を運ぶクレーム名。`tenant_ref` は既定値で、固定の名前ではありません。空でなく、256文字以下で、前後に空白がなく、空白文字を含まない、表示できる文字だけの名前を指定できます。値は `tenant_identity_providers.external_tenant_ref` と照合します。 |
| `SUI_TRUSTED_PROXIES` | （空） | シングルテナントの転送ヘッダーによる本人識別で、信頼するプロキシの送信元CIDR（カンマ区切り）。設定すると、認証ヘッダーを読む前に `request.client.host` を検査します。信頼しないIPからのリクエストは、ヘッダーの有無にかかわらず403 `untrusted_proxy` で拒否します。未設定のときは送信元の検査をせず、警告ログを1回だけ出します。本番では設定を勧めます。`saas-multitenant` の、検証済みのJWTやCookieによる経路では使いません。 |
| `SUI_REVIEWER_REF_RESOLVER_ADAPTER` | `user_id` | レビュー担当者の参照（reviewerRef）を解決するアダプタ。`user_id` か `sso_subject`。 |
| `SUI_CE4_EQUIVALENCE_MODE` | `equivalence_and_bundle_hash` | CE4の同値判定の方式。 |
| `SUI_CE4_DRY_RUN_ENFORCE_NO_SIDE_EFFECT` | `true` | CE4のドライランが、副作用を持たないことを強制します。 |
| `SUI_CE4_AUDIT_REQUIRE_ALL_EVENTS` | `true` | CE4の監査記録が欠けたとき、処理を続けず、失敗として扱います。 |
| `SUI_CE4_SOURCE_BUNDLE_HASH_ALLOW_MOCK` | `true` | CE4の `POST /docs/{doc_id}/context-audit` で、`sourceBundleHash=mock:<hash>` を受け付けるかを決めます。proposalとCE4の解決リクエストが受け付ける形式は別に決まっており、この設定の対象外です。 |
| `SUI_CE4_STUB_UNRESOLVED_CONTRACTS` | `true` | 仕様が未確定のCE4の契約を、スタブの応答に閉じ込めます。現在は `true` に固定で、`false` を指定すると起動時に拒否します。 |

## Composeとfrontendのビルドに関する環境変数

次の表は、標準のDocker Composeがホストから参照する公開キーと、frontendを直接ビルドするときに設定できる公開キーです。これらもすべて `SUI_` で始まります。標準のComposeではホストから変えられないビルド値は、用途の欄に書いています。

| 変数 | 既定値 | 用途 |
| --- | --- | --- |
| `SUI_WEB_PORT` | `8080` | webのループバック（`127.0.0.1`）のポート。変わるのはポート番号だけで、LANなど他のホストから到達できるかどうかは変わりません。 |
| `SUI_POSTGRES_DB` | `sui_sensemaking` | Compose上のPostgreSQLのデータベース名。 |
| `SUI_POSTGRES_USER` | `sui_sensemaking` | Compose上のPostgreSQLのユーザー名。 |
| `SUI_POSTGRES_PASSWORD` | `sui_sensemaking` | Compose上のPostgreSQLのパスワード。 |
| `SUI_RUNTIME_PROFILE` | `evaluation`（Compose） | backendとfrontendに、同じ実行プロファイルを渡します。`saas-multitenant` には、PostgreSQLの共有認証テーブルと、必須の外部アダプタが必要です。 |
| `SUI_APP_REVISION` | `unknown` | backendの `/version` とすべてのアプリケーションログ、frontendの診断バンドルを、同じビルドに結び付けます。標準のComposeは、apiへそのまま渡し、webのビルドにも渡します。 |
| `SUI_FRONTEND_API_BASE` | `/api` | frontendを直接ビルドするときの、APIの基準パス。標準のComposeは `/api` を固定で注入するため、ホスト側の値では変えられません。 |

PostgreSQLのイメージやfrontendのビルドツールが内部で使う名前は、sui-sensemakingの公開設定キーではありません。利用者が設定するのは、上の `SUI_*` だけです。

## よく使う構成の例

### ローカルでの評価

```bash
export SUI_DATABASE_URL='sqlite:///./sui_sensemaking.db'
export SUI_RUNTIME_PROFILE=local-dev
export SUI_LLM_PROVIDER=none
```

### Docker Composeでの評価

```bash
export SUI_LLM_PROVIDER=none
export SUI_RUNTIME_PROFILE=evaluation
export SUI_WEB_PORT=8080
```

### APIキーを付けた検証

```bash
export SUI_API_KEY='change-me'
```

この値は例です。実際の運用では推測されにくい値を使い、Gitにコミットしないでください。

## frontendのAPI接続先

frontendのAPI接続先は、`SUI_FRONTEND_API_BASE` で指定します。未設定なら `/api` を使います。値は同一オリジンの絶対パスとして扱い、`/` だけ、または単一の `/` で始まるパスだけを受け付けます。`//host` のような形式、バックスラッシュ、クエリ（`?`）、フラグメント（`#`）を含む値、相対パスは受け付けず、frontend側で `/api` に戻します。`/` は、ルートをAPIの基準パスとして扱います。

ローカルの開発サーバーと、Docker Composeの標準構成では、`/api` がbackendへ中継されます。標準のComposeは、同梱のNginxの `location /api/` に合わせて、frontendのビルドに `/api` を固定で注入します。そのため、ホスト側で `SUI_FRONTEND_API_BASE` を変えても、標準のComposeの基準パスは変わりません。別のパスを使いたいときは、frontendを直接ビルドし、そのパスをbackendへ中継するリバースプロキシも、同時に用意してください。

frontendを直接ビルドするときは、ビルドの前に `SUI_RUNTIME_PROFILE` と `SUI_FRONTEND_API_BASE` を設定します。プロファイルを指定しなければ、ローカル優先の `local-dev` と同等になります。空文字、未知の値、前後に空白を含む値は、シングルテナントに切り替わらず、利用を止める画面が表示されます。

```bash
export SUI_RUNTIME_PROFILE=local-dev
export SUI_FRONTEND_API_BASE=/api
npm run build
```

## APIキーを有効にする

```bash
export SUI_API_KEY='change-me'
```

`/healthz`、`/readyz`、`/version` は、運用の死活確認用なので、APIキーなしで確認できます。`/admin/*` は業務用のAPIキーでは保護せず、`X-Admin-Api-Key` またはprovision権限による管理面の認可を使います。それ以外の業務用APIにアクセスするときは、次のヘッダーを付けます。

```bash
curl -H "X-API-Key: change-me" http://localhost:8080/api/docs/example
```

ブラウザで動く同梱の画面は、`X-API-Key` を付けません。そのため `SUI_API_KEY` を設定すると、画面からの読み込みと保存は401になります。APIキーは、`curl` などプログラムからのアクセスを守るためのものです。ブラウザでの動作確認では未設定（既定）のまま使い、ブラウザへの配信そのものを守りたいときは、前段に認証プロキシを置いてください（[security.md](security.md) を参照）。

> 注意: 標準のDocker Composeは、このキーをホストの環境からそのまま渡します。`local-dev` と `evaluation` では、未設定なら業務用のAPIキーは無効のままです。`enterprise-production` ではこのキーが起動に必須で、未設定だと起動しません。`saas-multitenant` は、検証済みのJWTやCookieで本人を識別するため、業務用のキーは起動に必須ではありません（管理面用の `SUI_ADMIN_API_KEY` は、別に必須です）。詳しくは [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings) を参照してください。

## ローカルLLMを使う

ローカルのプロバイダは、`<ベースURL>/generate` にJSONをPOSTします。応答は `{ "text": "..." }` の形で返す必要があります。

```bash
export SUI_LLM_PROVIDER=local
export SUI_LOCAL_LLM_BASE_URL='http://localhost:8001'
export SUI_LOCAL_LLM_MODEL='local-model-name'
```

ベースURLには、認証情報、クエリ、フラグメント、空白、制御文字、バックスラッシュを含められません。使えるのは、HTTPS、または `localhost`、`127.0.0.1`、`::1` へのHTTPだけです。モデルIDは256文字以下で、空白、制御文字、バックスラッシュを含められません。

プロバイダへ送るリクエストは、UTF-8のJSONで、1MiB以下にします。タスク、temperature、最大トークン数も、安全な範囲に収まっているか検査します。大きすぎるプロンプトや不正な数値は、接続する前に `provider_validation` として拒否します。この検証エラーは、`none` への切り替えでは置き換えられません。

> 注意: 上の例は、直接起動したときの設定です。標準のDocker Composeは、これらのキーを渡しません。Compose上でローカルのプロバイダを検証するときは、検証用の `docker-compose.llm-stub.yml` を重ねて使ってください（`docker compose -f docker-compose.yml -f docker-compose.llm-stub.yml up -d`）。また、`api` コンテナの中から見た `http://localhost:8001` は、ホストではなく `api` コンテナ自身を指します。Compose環境では、この例をそのまま写さないでください。

## 大規模LLMを使う

大規模LLMのプロバイダは、既定では無効です。使うときは、昇格の許可、明示的なオプトイン、許可リストを、すべて設定します。

```bash
export SUI_LLM_PROVIDER=large-scale
export SUI_LLM_ESCALATION_ENABLED=true
export SUI_LLM_LARGE_SCALE_OPT_IN=true
export SUI_LARGE_SCALE_LLM_BASE_URL='https://llm.example.com'
export SUI_LARGE_SCALE_LLM_MODEL='model-name'
export SUI_LARGE_SCALE_LLM_ALLOWLIST='llm.example.com'
```

大規模LLMでは、ベースURL、モデル、許可リストをすべて設定し、ベースURLのホストを許可リストに含める必要があります。許可リストには、ホスト名かIPアドレスだけをカンマ区切りで書きます。スキーム付きのURL、ワイルドカード、ポート、パス、空の要素、重複は、起動時に拒否します。ベースURLとモデルには、ローカルのプロバイダと同じ制約を適用します。

## アクセス制御を使う

既定の `noop` は、認可の判定を外部のPDPに任せません。外部のPDPを使うときは、方式（アダプタ）、失敗時の扱い（フェイルセーフ）、接続先（エンドポイント）を、セットで設定します。

```bash
export SUI_ACCESS_CONTROL_ADAPTER=external_http
export SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only
export SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT='https://pdp.example.com/decide'
```

アクセス制御で `external_http` を指定したときは、接続先のエンドポイントが必須です。空のままにしても `noop` に切り替わらず、設定エラーとして起動を拒否します。外部のPDPを使わないときは、アダプタを明示的に `noop` に戻し、エンドポイントと固定のベアラートークンも、同時に未設定へ戻してください。`noop` のままエンドポイントか固定のベアラートークンだけを残した構成は、起動時に拒否します。エンドポイントは、認証情報、クエリ、フラグメント、空白、制御文字、バックスラッシュを含まないHTTPSのURLにします。HTTPが使えるのは、ループバックだけです。IdPの発行者を設定するときも、`external_http` アダプタとエンドポイントが必要で、どちらかが欠けた構成は起動時に拒否します。タイムアウトが0以下の場合と、30秒を超える場合も、起動時に拒否します。

監査ログのHTTP連携にも、同じ制約を適用します。`SUI_AUDIT_TRANSPORT=http` ではエンドポイントが必須で、欠けていても `noop` に切り替わらず、起動を拒否します。`noop` のまま監査のエンドポイントやAPIキーを残した設定と、`http` でエンドポイントがないままAPIキーだけを設定した構成も、拒否します。送信先を完全に設定したあとで、一時的に監査の送信に失敗した場合は、従来どおり本体の機能を止めずに続けます。

### 文書のポリシー紐づけリゾルバー

`document_access_metadata` に保存する値は、秘密でない紐づけIDとバージョンだけです。`external_http` のリゾルバーは、これらを有効なテナントIDとともに、信頼済みのサービスにPOSTします。応答の `policyRef` は、そのリクエストの中でだけ使います。`policyRef` の生の値やAPIキーを、DB、監査ログ、書き出し、診断には保存しません。

```bash
export SUI_DOCUMENT_POLICY_BINDING_RESOLVER=external_http
export SUI_DOCUMENT_POLICY_BINDING_HTTP_ENDPOINT='https://binding.example.com/v1/resolve'
export SUI_DOCUMENT_POLICY_BINDING_HTTP_API_KEY='set-in-secret-store'
export SUI_DOCUMENT_POLICY_BINDING_HTTP_TIMEOUT_SECONDS=1.5
```

接続先は、認証情報、クエリ、フラグメントを含まないHTTPSのURLにします。HTTPが使えるのは、`localhost`、`127.0.0.1`、`::1` だけです。リゾルバーを `none` に戻すときは、エンドポイントとAPIキーも同時に未設定へ戻してください。`none` のままHTTPの設定だけを残した構成は、起動時に拒否します。`saas-multitenant` では `external_http` が必須で、起動前に外部コンポーネントを検査し、サーバー側の文書リソース解決に組み込みます。ただし、このリゾルバーだけでSaaSが成り立つわけではありません。信頼する認証の入口、外部のアクセス制御、テナントの権限リゾルバーなどの必須条件も、同時に満たす必要があります。

### テナント権限リゾルバー

`external_http` のリゾルバーは、サーバーが解決した `principalId`、`tenantId`、`membershipId` だけを、信頼済みのポリシーサービスにPOSTし、既知の `effectiveCapabilities` と `capabilityVersion` を受け取ります。ロール名やグループ名、クライアントが指定したテナントは、送信も保存もしません。

```bash
export SUI_TENANT_CAPABILITY_RESOLVER=external_http
export SUI_TENANT_CAPABILITY_HTTP_ENDPOINT='https://capability.example.com/v1/resolve'
export SUI_TENANT_CAPABILITY_HTTP_API_KEY='set-in-secret-store'
export SUI_TENANT_CAPABILITY_HTTP_TIMEOUT_SECONDS=1.5
```

接続先とAPIキーには、紐づけリゾルバーと同じ制約を適用します。リゾルバーを `none` に戻すときは、エンドポイントとAPIキーも同時に未設定へ戻してください。`none` のままHTTPの設定だけを残した構成は、起動時に拒否します。未知の権限、重複、余分なロールやグループのフィールド、不正なバージョン、タイムアウトは、成功として扱わず、APIでは `503 capability_resolution_unavailable` を返します。`saas-multitenant` では `external_http` が必須で、起動前に外部コンポーネントを検査し、実行時のテナント権限リゾルバーとして組み込みます。信頼するSaaSの本人識別、テナント、有効セッションのアダプタも、同じプロファイルでまとめて導入されます。ただし、必須のポリシーや有効なIdPが欠けている構成は、起動時に停止します。

## 設定後の確認

```bash
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
```

backendを直接起動している場合は、次のようにします。

```bash
curl -fsS http://127.0.0.1:8000/healthz
```

設定の誤りでbackendが起動しないときは、`api` のログに検証エラーが出ます。特に、旧キー、プロバイダ名、大規模LLMのオプトインの不足を確認してください。

## 関連文書

- [installation.md](installation.md)
- [data_handling.md](data_handling.md)
- [security.md](security.md)
- [local_llm_ops_guide.md](local_llm_ops_guide.md)
- [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md)
