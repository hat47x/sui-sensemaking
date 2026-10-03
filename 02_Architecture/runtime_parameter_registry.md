# Runtime Parameter Registry

この文書はsui-sensemakingの環境変数と実行時パラメータの唯一の基準です。実装、Docker Compose、利用者向け文書で設定キーを追加・変更・削除する場合は、先にこの表を更新します。

## 基本ルール

1. 利用者または運用者が設定する環境変数は、すべて例外なく `SUI_` で始めます。
2. 接頭辞のない旧キーや、別接頭辞の互換キーは公開設定として扱いません。
3. サードパーティコンテナやビルドツールが内部的に別名を必要とする場合でも、sui-sensemakingの公開設定キーは `SUI_*` だけです。実装側で内部名へ写像します。
4. booleanは肯定形で命名し、既定値と安全側の意味を固定します。
5. 04文書には「主要なもの」だけではなく、この文書に載る公開環境変数をすべて記載します。
6. サードパーティイメージやビルドツールが要求する内部名は、sui-sensemakingの公開設定キーではありません。必要な内部変換は `01_Plans/adr/ADR-0029-third-party-runtime-env-boundary.md` で扱い、利用者は `SUI_*` だけを設定します。

## Runtime profiles

この表は、代表的な実行環境ごとの運用条件を示します。`SUI_RUNTIME_PROFILE`でプロファイル名を明示します。未指定時は`local-dev`を使います。`Startup-required conditions` はそのプロファイルを起動するために満たす必須条件、`Recommended / conditional settings` は安全・標準として推奨する値または特定機能を使う場合だけ必要な値です。プロファイル名だけで秘密値や接続先を補完しません。実装既定値を変更する場合や、公開設定キーを追加・改名する場合はADRで扱います。

| Profile | Purpose | Startup-required conditions | Recommended / conditional settings | Notes |
|---|---|---|---|---|
| `local-dev` | 開発者の手元で最小起動する | なし（追加のプロファイル固有必須条件なし） | 推奨: `SUI_DATABASE_URL=sqlite:///./sui_sensemaking.db`, `SUI_LLM_PROVIDER=none`。条件付き: ヘッダー由来の未登録ユーザーをJIT自動作成する場合だけ `SUI_ALLOW_JIT_PROVISIONING=true` | 実装既定値だけでも起動可能。外部サービスを使わずに動作確認し、共有・エクスポートの安全境界は緩めない。 |
| `evaluation` | Docker Composeで利用者評価や検証を行う | なし（追加のプロファイル固有必須条件なし） | 推奨: `SUI_DATABASE_URL=postgresql+asyncpg://...`, `SUI_LLM_PROVIDER=none`, `SUI_AUDIT_TRANSPORT=noop`, `SUI_ACCESS_CONTROL_ADAPTER=noop` | 標準Composeでの評価構成。外部監査/外部PDPは必要な場合だけ明示有効化する。 |
| `enterprise-production` | 企業・行政の本番相当で運用する | `SUI_ADMIN_API_KEY=<secret>`, `SUI_API_KEY=<secret>` | 推奨: `SUI_ALLOW_JIT_PROVISIONING=false`, `SUI_LLM_PROVIDER=none`, `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only` または `deny` | 2つのAPIキーは別値で必須。未設定なら `Settings()` 構築時に起動拒否する。HTTP連携を使う場合は接続先、タイムアウト、フェイルセーフ、秘密情報管理を同時に確認する。 |
| `saas-multitenant` | 相互に信頼しない複数テナントを同じサービスへ収容する | `SUI_ADMIN_API_KEY=<secret>`, `SUI_DATABASE_URL=<PostgreSQL URL>`, `SUI_ALLOW_JIT_PROVISIONING=false`, `SUI_ACCESS_CONTROL_ADAPTER=external_http`, `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT=<HTTPS URL>`, `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=deny`, `SUI_DOCUMENT_POLICY_BINDING_RESOLVER=external_http`, `SUI_DOCUMENT_POLICY_BINDING_HTTP_ENDPOINT=<HTTPS URL>`, `SUI_TENANT_CAPABILITY_RESOLVER=external_http`, `SUI_TENANT_CAPABILITY_HTTP_ENDPOINT=<HTTPS URL>`, `SUI_JWT_ALGORITHMS` の非空許可リスト（未指定は既定 `RS256,ES256`、設定時は既知の非HMAC非対称アルゴリズムのみ）, `SUI_TENANT_CLAIM_NAME` の検証済み非空claim名（未指定は既定 `tenant_ref`）, `SUI_SAAS_OAUTH_BROKER_HTTP_AUTHORIZE_ENDPOINT=<HTTPS URL>`, `SUI_SAAS_AUTH_SESSION_HASH_KEY=<64 lowercase hex>` | OAuth BFFリクエスト時の条件付き設定: `/session/login` 開始には `SUI_SAAS_OAUTH_BROKER_HTTP_REDIRECT_URI`, `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_ID`。`/session/callback` のcode交換には `SUI_SAAS_OAUTH_BROKER_HTTP_TOKEN_ENDPOINT`, `SUI_SAAS_OAUTH_BROKER_HTTP_REDIRECT_URI`, `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_ID`, `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_SECRET` の4項目完全セット | `TrustedSaasRuntimePolicy.validate()` と、起動時のlifespan事前検査が必須条件を検証する。有効なIdPの有無はDB初期化後に診断するが、0件でもプロセスの起動は拒否せず警告を出す。管理用の認証情報で最初のプロバイダを登録でき、登録までは認証リクエストが失敗する。ログイン開始用2項目の欠損は`/session/login`を503で、callback用4項目の欠損は`/session/callback`を503で拒否する。 |

プロファイルに関係なく、利用者が設定する公開環境変数は例外なく `SUI_*` で始めます。サードパーティが別名を要求する場合は、実装またはデプロイ用アダプタが内部で写像します。

### Profile default vs recommendation（既定値と推奨値）

運用ドリフトを防ぐため、実装既定値（未設定時）とプロファイル推奨値（運用上の標準）を区別して扱います。

| Key | Implementation default | Enterprise recommendation | Rationale |
| --- | --- | --- | --- |
| `SUI_ALLOW_JIT_PROVISIONING` | `false` | `false` | 未認証の未知ヘッダー由来ユーザー自動作成（濫用可能）を防ぐため既定は `false`（SEC-RATE-LIMIT-01・2026-08-13）。`local-dev` / `evaluation` でヘッダー由来ユーザーを使う場合は明示 `true`。本番は `false` 固定推奨。 |
| `SUI_MAX_DOCUMENT_BYTES` | `20971520`（20 MiB） | 任意の正整数 | DocumentV1保存ペイロードのUTF-8バイト上限（SEC-DOC-BOUND-01・2026-08-13）。inquiry bundleの20 MiBと対称。超えると413 `document_too_large`。 |
| `SUI_MAX_DOCUMENT_CARDS` | `50000` | 任意の正整数 | DocumentV1のカード件数上限（SEC-DOC-BOUND-01。2026-08-17のメタドッグフーディングで数万枚規模へ達する累積型KJキャンバスを踏まえ、2万枚の目標に余白を持たせて50,000へ拡張）。バイト上限の二次防御（小さいカード本文で20 MiB未満に収まる病態的件数を抑止）。超えると413 `document_too_many_cards`。 |
| `SUI_ALLOW_UNREVIEWED_AI_TEXT` | `false` | `false` または `true` | SEC-AI-SAFEMODE-01（ADR-0068 D1=C）の緩和ゲート。`true` のときのみ、AIリクエストの `allowUnreviewedText: true`（未レビュー本文の送出許可）が有効になる。既定 `false` は安全側で拒否（未レビュー本文は常に422で拒否）。 |
| `SUI_ADMIN_API_KEY` | 未設定 | **必須** | ADR-0072 D3=A: `enterprise-production` / `saas-multitenant` では未設定なら `Settings()` 構築時に即時失敗する。`enterprise-production` は加えて `SUI_API_KEY` も必須（業務面の識別を前段プロキシのヘッダーに依存するため）。`saas-multitenant` の業務面は信頼済み認証エッジのJWTが担うため `SUI_API_KEY` は必須としない |
| `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` | `read_only` | `read_only` または `deny` | 障害時の安全側挙動を明示的に選べるようにするため。 |
| `SUI_LLM_PROVIDER` | `none` | `none`（必要時のみオプトイン） | 外部共有の既定無効を維持するため。 |


## Profile selection criteria（運用判断基準）

実行プロファイルは「どこで動かすか」ではなく「どこまで外部依存を許可するか」で選びます。

1. `local-dev` を選ぶ条件
   - 目的が機能開発または再現テストであり、外部連携が不要。
   - DBをSQLiteでよい（`SUI_DATABASE_URL=sqlite:///./sui_sensemaking.db`）。
2. `evaluation` を選ぶ条件
   - Docker Compose上で利用者評価を行い、PostgreSQLやNginx経由の導線を含めて検証したい。
   - 外部監査/外部PDPは原則無効（`noop`）で、必要時のみ限定有効化する。
3. `enterprise-production` を選ぶ条件
   - `SUI_ADMIN_API_KEY` と `SUI_API_KEY` を別値で設定できる。両方ともSettingsの起動必須条件であり、欠損時は即座に失敗させる。
   - 認証・認可・監査の責務分離が必要で、障害時のフェイルセーフを `read_only` か `deny` で固定する。
   - JITプロビジョニングを無効化し、運用承認済みの接続先・秘密管理がある。
4. `saas-multitenant` を選ぶ条件
   - `SUI_ADMIN_API_KEY` を設定し、PostgreSQLの共有認証状態、信頼済みのSaaS認証エッジ、外部のアクセス制御、外部の文書ポリシー紐付け、外部のテナントcapability、JIT無効、`deny` のフェイルセーフ、SaaS OAuthブローカーの認可エンドポイント、認証セッションのハッシュキーなど、`TrustedSaasRuntimePolicy` の必須条件を満たす。
   - 起動前の事前検査で必須条件を満たしている。必須条件が1つでも欠ける場合は起動を即座に失敗させ、シングルテナントのプロファイルへフォールバックしない。有効なIdPの有無の検査はDB初期化後の警告診断であり、プロバイダが0件であること自体は起動を拒否する条件ではない。

### SaaS profile implementation gate（ADR-0059）

- `SUI_RUNTIME_PROFILE`でプロファイルを明示選択する。`local-dev`、`evaluation`、`enterprise-production`は正規化して受理する。
- `saas-multitenant`は必須ポリシー、実アダプタ、PostgreSQLの共有認証表をすべて起動前に検査し、不足時は即座に失敗させる。無視して`local-dev`やメモリ上の状態へフォールバックしない。
- バックエンドが持つ信頼済みSaaSアダプタのバンドルと`saas-multitenant`は、相互に必須である。事前検査では、プロファイル、非秘密の実行時安全ポリシー、バンドルの型・欠損・相互必須、起動済みの状態に加え、構築済みのPDP・capability・紐付けの各コンポーネントの実型を、状態を変更せずに検査する。同じ判定をDB初期化前とアダプタ有効化前にも再実行する。次の構成は、DB接続前に起動を拒否する。シングルテナントのプロファイルへのバンドル注入、SaaSプロファイルでのバンドル欠損、未知のプロファイル、設定上は外部連携でも実コンポーネントがnoopまたは利用不可になる構成である。プロファイル間の相互検証は`SUI_ADMIN_API_KEY`を必須とする。実行時安全ポリシーは、PostgreSQL、JIT無効、外部のアクセス制御、`deny` のフェイルセーフ、外部の文書ポリシー紐付け、外部のテナントcapability、SaaS OAuthブローカーの認可エンドポイント、認証セッションのハッシュキーを必須とする。実コンポーネントも`ExternalPolicyAccessControlAdapter`、`ExternalHttpTenantCapabilityResolver`、`ExternalHttpDocumentPolicyBindingResolver`の完全セットを必須とする。SaaSプロファイルを受理する現行実装でも、この完全セットが欠ける構成は起動しない。
- バックエンドは検証済みのプロファイルを起動時に記録し、`GET /session/bootstrap-policy`ではプロファイル名を公開せず、`single-tenant`または`tenant-session-required`のどちらかだけに写像する。フロントエンドのビルドも同じプロファイルを受け取る。既存の3プロファイルはポリシーを問い合わせずにlocal-firstで起動し、`saas-multitenant`だけはサーバのポリシーとの一致とセッションのbootstrap成功まで、Appをマウントしない。未知・空・正規形でないビルド値、ポリシーの不一致、取得失敗は、シングルテナントへフォールバックせず、ブロック状態にとどめる。
- 現行実装は、テナント解決、PDP、DBガードを含む相互検証と事前検査がすべて成立した場合だけSaaSの起動を許可する。欠ける構成は起動を拒否する。
- `ADR-0062`により、プロファイルを問わず `external_http` / `http` を明示選択した場合は対応エンドポイントを必須とする。エンドポイント欠損をnoopへフォールバックせず、DB初期化やリクエスト受付より前に起動を拒否する。

### Drift check gates（設定ドリフト防止ゲート）

- 命名ゲート: 公開キーは `SUI_*` のみ。
- 既定値ゲート: `Default` 列と実装既定値が一致しない変更は差し戻す。
- 境界ゲート: `POSTGRES_*` などvendor名は非公開アダプタ扱いとし、公開文書で利用者入力として記載しない。
- プロファイルゲート: プロファイル変更は `runtime profiles` 表と同時に理由（Purpose/Notes）を更新する。

## Prefix migration governance（互換期間と切替条件）

- バックエンド実行時キーは `ADR-0021` に基づき **互換期間なし** で `SUI_*` へ一括切替済みです。
- 旧キー（接頭辞なし/別接頭辞）は公開契約外であり、受理しません。
- 切替条件（Go/No-Go）は次のとおり。
  1. `runtime_parameter_registry.md`、`deployment.md`、Compose定義で公開キーが一致していること。
  2. バックエンドsettings検証が旧キー単独・新旧混在を拒否すること。
  3. runbook/公開文書で利用者向けキーが `SUI_*` のみであること。
- 破壊的な再移行（例: 旧キー互換の再導入、公開キー改名）は新規ADRを必須とします。

## Backend settings

`Delivery surface` は、現時点でそのキーがどの起動面へ実際に届くかを示します（ENV-COMPOSE-01）。

- `direct`: バックエンドを直接起動する場合にのみ有効。標準Compose・オーバーレイのいずれからも配送されない。
- `base Compose`: 標準 `docker-compose.yml` の `api.environment` が配送する。
- `llm-stub overlay`: `docker-compose.llm-stub.yml`（検証専用オーバーレイ。本番相当の利用者向けデプロイでは使わない）からのみ配送される。
- `fixed`: `Settings.validate_llm_provider_guards` が既定値以外を拒否する固定契約値。運用者が変更する対象ではない。

`direct` と記載されたキーは、`04_Documentation/configuration.md` 等でCompose起動時の設定例として案内しても、実際には `api` コンテナへ届かない。標準の `docker-compose.yml` は `SUI_API_KEY` と `SUI_ALLOW_JIT_PROVISIONING` を、ホスト環境からそのまま受け渡す形（値なしの `environment` 項目）で配送する（ENV-COMPOSE-01段階2）。ホスト側で未設定の場合はコンテナ内でも未設定のままで（空文字は注入しない）、実装既定値を維持する。監査HTTP、外部PDP、large-scale LLM、ローカルLLMの接続に関するキーは、標準Composeでは未対応である。必要な場合は、組織側のオーバーレイで関連キーを一組として配送する。

`Probe` 列は、設定後に秘密値を出力せず効果を確認する方法を説明する。`SUI_API_KEY` と `SUI_ALLOW_JIT_PROVISIONING` の代表的な確認手順は、`03_Implement/deploy/tools/verify_env_delivery.sh`（Dockerを使えるローカル環境向け。CIでは実行しない）として実装済みである。他のキーの手順は記載のみで、自動テストとしては未実装（後続作業）である。

| Key | Default | Purpose | Delivery surface | Secret | Probe (non-secret) |
| --- | --- | --- | --- | --- | --- |
| `SUI_RUNTIME_PROFILE` | `local-dev` | バックエンド/MCPの実行プロファイル。`local-dev`, `evaluation`, `enterprise-production`, `saas-multitenant`を受理する。SaaSバックエンドはPostgreSQL共有認証表と必須ポリシーを検査し、不足時は起動拒否。 | direct / base Compose | 通常値 | `GET /version` の `runtimeProfile` が設定後の検証済みのプロファイルと一致することを確認する。`/healthz` は生存確認のみでプロファイルを返さない |
| `SUI_LOG_LEVEL` | `INFO` | OPS-OBSERV-01: アプリケーションログの出力レベル（`CRITICAL`/`ERROR`/`WARNING`/`INFO`/`DEBUG`）。不正値は `INFO` へ丸める。uvicornのロガーも同じハンドラへ束ねる | direct | 通常値 | 起動ログが指定レベルで出ること、`DEBUG` で件数が増えることを確認する |
| `SUI_LOG_JSON` | `true` | OPS-OBSERV-01: ログを1行1JSONで出力する。`true` では呼び出し側が渡す `extra={...}` の `tenantId` / `docId` / `queueLength` / LLM `trace_id` などを構造化フィールドとして出力する。`false` ではこれらextraフィールドは出力せず、人間可読書式に相関メタデータの `requestId` / `actorRefHash` / `appRevision` を残す | direct | 通常値 | `true` でextraフィールドがJSONフィールドとして出ること、`false` で `requestId` / `actorRefHash` / `appRevision` が人間可読書式に残ることを確認する |
| `SUI_APP_REVISION` | `unknown` | OPS-OBSERV-01: 稼働中の正規ビルド識別子。1〜64文字のASCII `A-Za-z0-9._-` のみ受理し、それ以外（空文字、前後空白、スラッシュ、記号、改行、65文字以上）は `unknown` に丸める。バックエンドは `GET /version` と全アプリケーションログの `appRevision` で返し、フロントエンドは同じ規則で診断バンドルの `app.revision` に載せる。フロントエンドへはビルド引数として渡す（`vite.config.ts` の `envPrefix` 経由）ため、ビルド時に確定する | direct / base Compose | 通常値 | 正規値では `GET /version.revision`・ログ `appRevision`・診断バンドル `app.revision` が同値になること、不正値ではすべて `unknown` になることを確認する |
| `SUI_DATABASE_URL` | `sqlite:///./sui_sensemaking.db` | 永続化DB接続先。Verifiedの検証対象バージョンと利用範囲は`database_portability.md`を正本とする。候補/未知DBはエンジン生成・マイグレーション前に拒否する | direct / base Compose | 資格情報を含み得る（URLにパスワードを埋め込む場合がある） | `GET /readyz` が200 `status=ready` かつ `checks.database=ok` / `checks.schema=ok` を返すことを確認する。`/healthz` は生存確認のみでDBを検査しない。URL値は出力しない |
| `SUI_LLM_PROVIDER` | `none` | LLMプロバイダ種別。`none`, `local`, `local_http`, `large-scale`, `large_scale`, `external`, `deepseek`。起動時即時失敗の対象となる**プロセス既定/フォールバックトランスポート**であり、`model` を指定しないAI呼び出しに使う。AI-MODEL-GOVERNANCE-03以降、`model` を指定するAI呼び出しはモデル自身のレジストリ上の `providerKind` へ動的ディスパッチするため、この値と一致しないプロバイダへも（その `providerKind` 自身の設定が完全なら）到達し得る。`none` は無条件の停止スイッチであり、この場合は動的ディスパッチを含め一切のAI呼び出しを行わない | direct / base Compose | 通常値 | `GET /ai/provider-status` の `providerKind` で実際に解決された正規実行時kindを確認する。aliasは `local_http`→`local`、`large_scale`/`external`→`large-scale`。`/healthz` は生存確認のみでプロバイダを返さない |
| `SUI_LOCAL_LLM_BASE_URL` | 未設定 | ローカルLLMのbase URL。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可 | direct / llm-stubオーバーレイのみ | 通常値（接続先ホスト名。認証情報は含まない） | オーバーレイ使用時、`local` プロバイダ経由のリクエストがスタブへ到達すること（成否のみ確認、ペイロードは出力しない） |
| `SUI_LOCAL_LLM_MODEL` | 未設定 | ローカルLLMに渡す256文字以下の正規モデルID | direct / llm-stubオーバーレイのみ | 通常値 | スタブ側ログのモデル欄が設定値と一致することを確認する |
| `SUI_LLM_TASK_MODEL_MAP` | 未設定（空文字） | ADR-0065: タスク別モデル割当（`task=model,...`）。未設定タスクは既定モデル。 | direct | 通常値 | 指定taskのリクエストモデルが設定値と一致することをログで確認する |
| `SUI_LLM_HIGH_REASONING_MODEL` | 未設定 | AI-ROUTE-01 MMR-04: final_judgement系タスク（check_narrative/detect_contradiction）の既定モデル。未設定時は既定モデルへフォールバック。 | direct | 通常値 | final_judgementタスクのリクエストモデルが設定値と一致することをログで確認する |
| `SUI_LARGE_SCALE_LLM_BASE_URL` | 未設定 | large-scale LLMのbase URL。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可 | direct | 通常値（接続先ホスト名。認証情報は別キー） | 許可リスト外ホストを設定した場合に呼び出しが拒否されることを確認する |
| `SUI_LARGE_SCALE_LLM_MODEL` | 未設定 | large-scale LLMに渡す256文字以下の正規モデルID | direct | 通常値 | 呼び出しペイロードのモデルフィールドが設定値と一致することを確認する |
| `SUI_LLM_ESCALATION_ENABLED` | `false` | 互換名はescalationだが、現行実装ではlarge-scaleプロバイダkindの実行ゲート。プライマリ `large-scale`/`external` の起動readiness、registered large-scaleプロバイダの構築、`LargeScaleProvider.generate()` の全経路で `true` が必要。別途 `SUI_LLM_LARGE_SCALE_OPT_IN=true` も必須 | direct | 通常値 | `false` でプライマリlarge-scale設定がreadiness失敗し、registered large-scaleプロバイダが利用不可、直接large-scale実行も `provider_unavailable` になることを確認する |
| `SUI_LLM_LARGE_SCALE_OPT_IN` | `false` | large-scale LLM利用の明示オプトイン | direct | 通常値 | `false` のとき `large-scale`/`external` プロバイダ指定が起動時に拒否されることを確認する（バリデータで既に強制） |
| `SUI_LARGE_SCALE_LLM_ALLOWLIST` | 未設定 | large-scale接続を許可する正規ホストのカンマ区切り。URL、ワイルドカード、ポート、パス、重複は不可 | direct | 通常値（ホスト名リスト。認証情報を含まない） | 許可リスト外ホストへの接続が拒否されることを確認する |
| `SUI_LLM_FALLBACK_TO_NONE` | `true` | `provider_unavailable` / `provider_timeout` を成功応答へ切り替えず、`none` メタデータ（`fallback_to_none=true`, `execution_path=<provider>->none`）付き `ProviderDisabledError` として安全側で拒否する。`provider_validation` はフォールバック対象外。`false` では元の `ProviderRequestError` を維持する | direct | 通常値 | 利用不可/timeoutを模擬し、`true` では `provider_kind=none`・`fallback_to_none=true`・`<provider>->none` を持つ `ProviderDisabledError`、`false` または検証では元エラーになることを確認する |
| `SUI_DEEPSEEK_API_KEY` | 未設定 | DeepSeek API認証キー。プライマリ `SUI_LLM_PROVIDER=deepseek` では起動readinessの必須値。registered DeepSeekプロバイダでは `api_key_ref=SUI_DEEPSEEK_API_KEY` のrequest-time認証情報sourceとして使い、解決不能ならプロバイダ利用不可として安全側で拒否する | direct | 秘密値 | 未設定時、プライマリdeepseekは起動拒否されること。registered DeepSeek + `api_key_ref=SUI_DEEPSEEK_API_KEY` は認証情報利用不可となり、設定時だけ構築可能になることを確認する（秘密値は出力しない） |
| `SUI_DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | DeepSeek APIのbase URL。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可 | direct | 通常値（接続先URL。認証情報は別キー） | リクエストが正しいURLへ送信されることを確認する |
| `SUI_DEEPSEEK_MODEL` | `deepseek-v4-flash` | DeepSeek APIに渡すモデルID。256文字以下の正規 | direct | 通常値 | 呼び出しペイロードのモデルフィールドが設定値と一致することを確認する |
| `SUI_DEEPSEEK_THINKING_MODE` | `disabled` | DeepSeek V4 Chat Completionsのthinkingモード。`disabled` / `enabled`。旧 `deepseek-chat` のnon-thinking semanticsを保つため既定はdisabled | direct | 通常値 | DeepSeek送信ペイロードの `thinking.type` が設定値と一致することを確認する |
| `SUI_API_KEY` | 未設定 | 業務面APIを `X-API-Key` で保護する。`enterprise-production` では起動必須。`saas-multitenant` は信頼済みJWT/cookie識別情報を使うためbusinessキー自体は起動必須ではない。`/healthz` / `/readyz` / `/version` は運用プローブとして常に対象外。`/admin/*` もbusinessキーの対象外で、`X-Admin-Api-Key` またはprovision capabilityによるコントロールプレーン認可へ分離する | direct / base Compose | 秘密値 | 業務面ルートでキーなし/誤りが401、正しいキーが成功すること。3つの運用プローブはキーなしで到達でき、`/admin/*` はbusinessキーではなくコントロールプレーン資格情報で認可されることを確認する |
| `SUI_ADMIN_API_KEY` | 未設定 | ADR-0072 D1=A+B: コントロールプレーンのStage A bootstrap資格情報。`X-Admin-Api-Key` で提示する。Stage Bでは信頼済みSaaSセッションの `tenant.provision` capabilityでも認可でき、リクエストに管理者bearerは不要。**業務面の `SUI_API_KEY` はどちらのStageでも受理せず、同じ秘密値の設定も起動時に拒否する**。`enterprise-production` / `saas-multitenant` では設定自体が起動必須。`local-dev` / `evaluation` では未設定時だけdevelopment用にcontrol planeを開く。IdP未登録bootstrapではStage Bを使えないためStage Aがproductionの経路 | direct | 秘密値 | 業務面キーで `/admin/provision/*` が401、正しい `X-Admin-Api-Key` が成功、信頼済みSaaSセッション + `tenant.provision` も管理者bearerなしで成功することを確認する。併せて両キー同値がSettings構築で拒否されることを確認する（秘密値自体は出力しない） |
| `SUI_AUDIT_EXPORT_ENABLED` | `false` | 監査エクスポートのディスパッチmasterゲート。`false` では、検証を通過したトランスポート設定に関係なくディスパッチャは無効化され `NoopAuditTransport` を使い、外部送信しない。ただし `SUI_AUDIT_TRANSPORT=http` の完全設定検証は独立して適用され、エクスポート無効でもエンドポイント欠損は起動時に拒否する。`true` のときだけトランスポート設定が実送信に使われる | direct | 通常値 | `false` + 完全な`http`設定ではテストダブルへ1件も到達しないこと、`false`でも`http` + エンドポイント欠損は起動拒否、`true` + `http`では監査イベントがテストダブルへ到達することを確認する |
| `SUI_AUDIT_TRANSPORT` | `noop` | 監査トランスポート。`noop` または `http`。`http` はエクスポートflagと独立してエンドポイント必須の完全設定検証を受ける。検証通過後、実送信トランスポートとして作用するのは `SUI_AUDIT_EXPORT_ENABLED=true` の場合だけで、エクスポート無効時は `http` 指定でもディスパッチャは `NoopAuditTransport` を使う | direct | 通常値 | トランスポート名の正常時起動自己申告はない。エクスポート無効でも`http` + エンドポイント欠損が起動拒否されること、完全な`http`設定ではエクスポート無効時にPOSTせず、有効時だけテストダブルへ到達することを確認する |
| `SUI_AUDIT_HTTP_ENDPOINT` | 未設定 | 監査ログHTTP連携の接続先。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可し、`SUI_AUDIT_TRANSPORT=http` 時は必須 | direct | 通常値（接続先URL。認証情報は別キー） | テストダブルへの到達確認（実サービスへは送らない） |
| `SUI_AUDIT_HTTP_API_KEY` | 未設定 | 監査ログHTTP連携用APIキー。非空の正規bearer値（空白・制御文字不可） | direct | 秘密値 | 送信ヘッダにキーが付与されることを確認する（値はマスクして確認） |
| `SUI_AUDIT_HTTP_TIMEOUT_SECONDS` | `2.0` | 監査HTTPタイムアウト秒数 | direct | 通常値 | タイムアウト超過時に監査送出が失敗として扱われることを確認する |
| `SUI_AUDIT_QUEUE_SIZE` | `100` | 外部監査送信に失敗しても処理を続ける場合の、再試行バッファの上限。正常送信時やエクスポート無効時はキューへ積まない | direct | 通常値 | failingトランスポートで上限超過を起こし、最古イベントのdrop警告を確認する |
| `SUI_AUDIT_DEDUP_WINDOW_SECONDS` | `5.0` | `context-audit` / `export-audit` が渡す同一論理操作のdedupキーに対する重複排除ウィンドウ（SEC-AUDIT-DUP-01）。`view` / `LLM` / `proposal` 監査には適用しない。`0` で無効化 | direct | 通常値 | `context-audit` / `export-audit` の同一論理操作を二重POSTして外部シンクへ1件のみ送出されることを確認する。`view` / `LLM` / `proposal` はdedup対象として扱わない |
| `SUI_AUDIT_ALLOW_IN_SAFE_MODE` | `false` | `AuditEvent.safeMode=true` の外部監査送出を許可するevent-levelゲート。`false` では常にsafeMode=trueの `view` と、ペイロードのsafeModeを引き継ぐコンテキスト/export系のtrueイベントを抑止する。LLM / proposal監査はproducerが `safeMode=false` を明示するためこのゲートの対象外 | direct | 通常値 | `false` でsafeMode=trueのビュー/context/exportイベントが `safe_mode_blocked`、safeMode=falseのLLM/proposalイベントは対象外で送出可能なことを確認する |
| `SUI_ACCESS_CONTROL_ADAPTER` | `noop` | access controlアダプタ。`noop`, `mock`, `external_http` | direct | 通常値 | アダプタ名の起動自己申告はない。`saas-multitenant` では起動前事前検査が `ExternalPolicyAccessControlAdapter` の実型を要求し、`external_http` の個別配送はPDPテストダブルへの到達で確認する |
| `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` | `read_only` | access controlフェイルセーフモード。Org/Restricted文書で `policyRef` が欠ける場合と、アダプタがunreachable / invalidレスポンス / invalidリクエスト / unexpectedエラーに倒れた場合に適用する。`read_only` はreadだけをallow + 読み取り専用とし、write / エクスポート / shareはdeny。`deny` は全actionをdenyする | direct | 通常値 | Org/Restricted + `policyRef` 欠損とアダプタ障害を分けて模擬し、`read_only` でreadのみallow、write/export/shareはdeny、`deny` ではreadを含む全actionがdenyになることを確認する |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT` | 未設定 | `external_http` アダプタが利用する必須のPDP接続先。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可 | direct | 通常値 | テストダブルへの到達確認（実PDPへは送らない） |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_TIMEOUT_SECONDS` | `1.5` | `external_http` アダプタのタイムアウト秒数 | direct | 通常値 | タイムアウト超過時にフェイルセーフモードの挙動が発火することを確認する |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_AUTH_MODE` | `none` | `external_http` アダプタがPDPへ渡す認証方式メタデータ。`none`, `oidc`, `saml` を `x-acl-auth-mode` ヘッダーへ写す。この値自体は `Authorization` ヘッダーを生成・変更せず、固定bearerは別設定 `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_STATIC_BEARER_TOKEN` が担う | direct | 通常値 | PDPテストダブルで `x-acl-auth-mode` が設定値と一致することを確認する。`Authorization` はこの値だけでは付与されないことも確認する |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_STATIC_BEARER_TOKEN` | 未設定 | `external_http` アダプタの固定bearerトークン。非空の正規bearer値（空白・制御文字不可） | direct | 秘密値 | PDPリクエストにBearerヘッダが付与されることを確認する（値はマスク） |
| `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_IDP_ISSUER` | 未設定 | `external_http` アダプタがPDPへ渡すIdP issuerメタデータ。設定する場合は `SUI_ACCESS_CONTROL_ADAPTER=external_http` とエンドポイントが必須。正規ヘッダーvalueとして検査し、設定時は `x-idp-issuer` ヘッダーへ写す。この設定自体はJWT/SAML issuerのローカル検証を行わない | direct | 通常値 | PDPテストダブルで `x-idp-issuer` が設定値と一致することを確認する。issuer検証の結果を示すプローブとしては扱わない |
| `SUI_DOCUMENT_POLICY_BINDING_RESOLVER` | `none` | サーバ所有の紐付けIDを一時的なpolicyRefへ解決するリゾルバ。`none`, `external_http`。`saas-multitenant` では `external_http` が必須で、起動前に外部コンポーネントを検査し、`ServerOwnedDocumentResourceResolver` のポリシー紐付けリゾルバとして配線 | direct | 通常値 | リゾルバ名の起動自己申告はない。`saas-multitenant` では起動前事前検査が `ExternalHttpDocumentPolicyBindingResolver` の実型を要求し、`external_http` の個別配送は紐付けサービステストダブルへの検索到達で確認する |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_ENDPOINT` | 未設定 | 紐付けリゾルバの接続先。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可 | direct | 通常値（接続先URL。認証情報は別キー） | テストダブルへの到達確認（実サービスへは送らない） |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_API_KEY` | 未設定 | 紐付けリゾルバ専用の固定bearerトークン。非空の正規bearer値（空白・制御文字不可）。DB・監査・診断へ出力しない | direct | 秘密値 | 送信ヘッダにキーが付与されることを確認する（値はマスクして確認） |
| `SUI_DOCUMENT_POLICY_BINDING_HTTP_TIMEOUT_SECONDS` | `1.5` | 紐付けリゾルバのタイムアウト秒数。`0 < value <= 30` | direct | 通常値 | タイムアウト超過時にリゾルバが安全側で拒否へ倒れることを確認する |
| `SUI_TENANT_CAPABILITY_RESOLVER` | `none` | テナント単位のeffective capabilityリゾルバ。`none`, `external_http`。`saas-multitenant` では `external_http` が必須で、起動前に外部コンポーネントを検査し、実行時のテナントcapabilityリゾルバとして配線 | direct | 通常値 | リゾルバ名の起動自己申告はない。`saas-multitenant` では起動前事前検査が `ExternalHttpTenantCapabilityResolver` の実型を要求し、`external_http` の個別配送はcapabilityサービステストダブルへの検索到達で確認する |
| `SUI_TENANT_CAPABILITY_HTTP_ENDPOINT` | 未設定 | capabilityリゾルバの接続先。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可 | direct | 通常値（接続先URL。認証情報は別キー） | テストダブルへの到達確認（実サービスへは送らない） |
| `SUI_TENANT_CAPABILITY_HTTP_API_KEY` | 未設定 | capabilityリゾルバ専用の固定bearerトークン。非空の正規bearer値（空白・制御文字不可）。DB・監査・診断へ出力しない | direct | 秘密値 | 送信ヘッダにキーが付与されることを確認する（値はマスクして確認） |
| `SUI_TENANT_CAPABILITY_HTTP_TIMEOUT_SECONDS` | `1.5` | capabilityリゾルバのタイムアウト秒数。`0 < value <= 30` | direct | 通常値 | タイムアウト超過時にリゾルバが安全側で拒否へ倒れることを確認する |
| `SUI_ALLOW_JIT_PROVISIONING` | `false` | シングルテナントのforwarded-header識別情報パスにだけ作用するJITプロビジョニングゲート。未登録プロバイダ/subjectで `true` の場合はユーザー・識別情報紐付け・local-defaultメンバーシップを作成し、`false` では403 `identity_not_provisioned`。`saas-multitenant` は起動ポリシーで `false` を必須とし、信頼済みJWT/cookie識別情報リゾルバはこの設定を参照せず未登録subjectを常に403で拒否する（SEC-RATE-LIMIT-01） | direct / base Compose | 通常値 | シングルテナントヘッダーパスで `false` 時は未登録識別情報が403かつ新規作成されず、`true` 時だけ作成されること。SaaSでは `true` が起動拒否され、未登録subjectが設定値に関係なく403になることを確認する |
| `SUI_MAX_DOCUMENT_BYTES` | `20971520` | DocumentV1保存ペイロードのUTF-8バイト上限（20 MiB・SEC-DOC-BOUND-01） | direct | 通常値 | 超えるペイロードで413 `document_too_large` を確認する |
| `SUI_MAX_DOCUMENT_CARDS` | `50000` | DocumentV1のカード件数上限（SEC-DOC-BOUND-01） | direct | 通常値 | 超えるカード件数で413 `document_too_many_cards` を確認する |
| `SUI_ALLOW_UNREVIEWED_AI_TEXT` | `false` | AIリクエストの `allowUnreviewedText` 緩和を許可するか（SEC-AI-SAFEMODE-01 / ADR-0068） | direct | 通常値 | `false` 時、未レビュー本文を含む `/ai/*` リクエストが422で拒否されることを確認する |
| `SUI_AUTH_PROVIDER_FIELD` | `x-auth-provider` | シングルテナントのforwarded-header識別情報パスで外部識別情報プロバイダを受け取るヘッダー名。trim・小文字正規化し、欠損/空値は `header`。`saas-multitenant` の信頼済みJWT/cookieパスでは使用しない | direct | 通常値 | シングルテナントヘッダーパスで指定値が正規化され `AuthContext.provider` へ反映され、欠損時は `header` になることを確認する |
| `SUI_AUTH_USER_FIELD` | `x-forwarded-user` | シングルテナントのforwarded-header識別情報パスで `AUTH_SUBJECT_FIELD` 欠損時の外部UID/subjectフォールバックを受け取る旧ヘッダー名。内部 `users.id` を直接指定しない。`saas-multitenant` の信頼済みJWT/cookieパスでは使用しない | direct | 通常値 | subjectヘッダー欠損時だけ指定ヘッダーが `AuthContext.external_uid` へ反映され、内部 `users.id` は識別情報対応付けから解決されることを確認する |
| `SUI_AUTH_EMAIL_FIELD` | `x-forwarded-email` | シングルテナントのforwarded-header識別情報パスでJITプロビジョニング時に新規 `UserRow.email` を初期化するヘッダー名。既存ユーザー属性は更新しない。`saas-multitenant` の信頼済みJWT/cookieパスでは使用しない | direct | 通常値 | JITで新規ユーザーを作る時だけ指定値が `UserRow.email` に入り、既存ユーザーリクエストでは属性が上書きされないことを確認する |
| `SUI_AUTH_NAME_FIELD` | `x-forwarded-name` | シングルテナントのforwarded-header識別情報パスでJITプロビジョニング時に新規 `UserRow.display_name` を初期化するヘッダー名。既存ユーザー属性は更新しない。`saas-multitenant` の信頼済みJWT/cookieパスでは使用しない | direct | 通常値 | JITで新規ユーザーを作る時だけ指定値が `UserRow.display_name` に入り、既存ユーザーリクエストでは属性が上書きされないことを確認する |
| `SUI_AUTH_SUBJECT_FIELD` | `x-auth-subject` | シングルテナントのforwarded-header識別情報パスで外部UID/subjectの第一候補を受け取るヘッダー名。欠損時だけ `AUTH_USER_FIELD` へフォールバックする。`saas-multitenant` の信頼済みJWT/cookieパスでは使用しない | direct | 通常値 | subjectヘッダーがあれば `AUTH_USER_FIELD` より優先して `AuthContext.external_uid` へ反映されることを確認する |
| `SUI_JWT_ALGORITHMS` | `RS256,ES256` | 信頼済みOIDC/JWT署名検証のアルゴリズム許可リスト（カンマ区切り）。受理値は `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `ES512`, `PS256`, `PS384`, `PS512`。空list、HMAC系、`none` を含む未知値はSettings検証で起動時に拒否する | direct | 通常値 | 非defaultの既知アルゴリズムを設定でき、設定許可リスト外のアルゴリズムで署名されたJWTが401、HMAC/未知値は起動時に拒否されることを確認する |
| `SUI_TENANT_CLAIM_NAME` | `tenant_ref` | 信頼済みJWT内のテナント外部識別子を運ぶclaim名。既定は `tenant_ref` だが固定名ではなく、Settings検証を通るカスタム名を指定できる。値は `tenant_identity_providers.external_tenant_ref` と照合する | direct | 通常値 | カスタムclaim名を設定すると認証エッジがそのclaimを参照し、指定claimが存在しないJWTは401で拒否されることを確認する |
| `SUI_TRUSTED_PROXIES` | （空） | シングルテナントforwarded-header識別情報パスの信頼できるsourceプロキシCIDRのカンマ区切りリスト。設定時は識別情報resolution冒頭で `request.client.host` をヘッダー読取より先に検査し、非信頼IPはauthヘッダーの有無にかかわらず403 `untrusted_proxy`。未設定時はsourceゲートを行わず警告ログを1回出す。本番では `10.0.0.0/8` 等で限定すること。`saas-multitenant` の信頼済みJWT/cookieパスでは使用しない。 | direct | 通常値 | CIDR設定時に非信頼IPがヘッダー読取前に403、信頼IPが識別情報解決へ進むこと、未設定時はsourceゲートを行わず警告することを確認する |
| `SUI_REVIEWER_REF_RESOLVER_ADAPTER` | `user_id` | reviewerRef解決アダプタ。`user_id` または `sso_subject` | direct | 通常値 | reviewerRefの解決方式が選択値（`user_id`/`sso_subject`）どおりであることを確認する |
| `SUI_CE4_EQUIVALENCE_MODE` | `equivalence_and_bundle_hash` | CE4同値性判定モード | fixed | 通常値 | 既定値以外を設定すると起動時に拒否されることを確認する |
| `SUI_CE4_DRY_RUN_ENFORCE_NO_SIDE_EFFECT` | `true` | CE4 dry-runが副作用なしであることを強制する | fixed | 通常値 | `false` 設定時に起動が拒否されることを確認する |
| `SUI_CE4_AUDIT_REQUIRE_ALL_EVENTS` | `true` | CE4のクエリ/bundle/proposal/apply監査欠損を安全側で拒否にする | fixed | 通常値 | `false` 設定時に起動が拒否されることを確認する |
| `SUI_CE4_SOURCE_BUNDLE_HASH_ALLOW_MOCK` | `true` | docs CE4の `POST /docs/{doc_id}/context-audit` で `sourceBundleHash=mock:<hash>` を許容する。proposal / CE4 resolveの受理契約は各API正本に従い、このswitchの対象外 | direct（docs CE4ポリシー） | 通常値 | `false` 設定時に `/docs/{doc_id}/context-audit` の `mock:` 接頭辞が `422 mock_source_bundle_hash_disabled` で拒否されることを確認する |
| `SUI_CE4_STUB_UNRESOLVED_CONTRACTS` | `true` | 未確定CE4契約をスタブ応答で隔離し、成功扱いにしない安全契約。未確定スタブtriggerの実行時契約が実装されるまで `true` 固定 | fixed | 通常値 | `false` 設定時に起動が拒否されることを確認する |
| `SUI_SAAS_OAUTH_BROKER_HTTP_AUTHORIZE_ENDPOINT` | 未設定 | BFFが認可code交換の前にリダイレクトするIdPのauthorizeエンドポイント（SAAS-TENANT-SESSION-BINDING-01 / ADR-0074）。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可し、必須性はTrustedSaasRuntimePolicyが担う | direct | 通常値（接続先URL。認証情報は別キー） | saas-multitenantでOAuthフローが開始されることを確認する |
| `SUI_SAAS_OAUTH_BROKER_HTTP_TOKEN_ENDPOINT` | 未設定 | BFFが認可codeをトークンへ交換するIdPのトークンエンドポイント（ADR-0074）。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可。process起動時の必須条件ではないが、`/session/callback` のcode交換ではリダイレクトURI / クライアントID / クライアント秘密情報と4項目完全セットで必要で、欠損時は503で拒否 | direct | 通常値（接続先URL。認証情報は別キー） | トークン交換リクエストが正しいエンドポイントへ送信されること、欠損時にcallbackが503になることを確認する |
| `SUI_SAAS_OAUTH_BROKER_HTTP_REDIRECT_URI` | 未設定 | OAuthフローのリダイレクトURI（ADR-0074）。認証情報/query/fragmentなしのHTTPS、またはループバックHTTPだけを許可し、パスは `/session/callback` 固定。process起動時の必須条件ではないが、`/session/login` 開始時はクライアントIDとともに必要で、callbackのcode交換ではトークンエンドポイント / クライアントID / クライアント秘密情報と4項目完全セットで必要。欠損時は該当リクエストを503で拒否 | direct | 通常値（接続先URL。認証情報は別キー） | ログイン開始とcallback code交換で設定値が使われ、欠損時に該当リクエストが503になることを確認する |
| `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_ID` | 未設定 | confidential-client OAuthのクライアントID（ADR-0074）。2,048文字以下の正規値（空白・制御文字不可）。process起動時の必須条件ではないが、`/session/login` 開始時はリダイレクトURIとともに必要で、callbackのcode交換ではトークンエンドポイント / リダイレクトURI / クライアント秘密情報と4項目完全セットで必要。欠損時は該当リクエストを503で拒否 | direct | 通常値 | 認可リクエストのclient_idが設定値と一致し、欠損時に該当リクエストが503になることを確認する |
| `SUI_SAAS_OAUTH_BROKER_HTTP_CLIENT_SECRET` | 未設定 | confidential-client OAuthのクライアント秘密情報（ADR-0074）。非空の正規bearer値（空白・制御文字不可）。process起動時の必須条件ではないが、`/session/callback` のcode交換ではトークンエンドポイント / リダイレクトURI / クライアントIDと4項目完全セットで必要で、欠損時は503で拒否 | direct | 秘密値 | 設定後にトークン交換が成功し、欠損時にcallbackが503になることを確認する（値自体は出力しない） |
| `SUI_SAAS_OAUTH_BROKER_HTTP_TIMEOUT_SECONDS` | `5.0` | OAuth brokerのHTTPタイムアウト秒（0 < x ≤ 30） | direct | 通常値 | タイムアウト超過時にエラーへ倒れることを確認する |
| `SUI_SAAS_AUTH_SESSION_HASH_KEY` | 未設定 | member SaaS authセッション、guest authセッション、guest redeem状態のHMAC-SHA256導出に共有するキー（ADR-0074 decision 2 / ADR-0080、64文字小文字hex = 32 bytes）。guest redeem状態は `guest-redeem-v1` domain separationを通す。生cookie/state値は平文保存せず、ローテーション時は新キー設定＋再起動で既存member/guestセッションと未使用redeem状態を無効化する | direct | 秘密値 | キー変更で既存member/guestセッションと未使用redeem状態が無効化され、セッションは再ログイン／guest sign-inへ導かれることを確認する |

## Compose and frontend build keys

| Key | Default | Purpose |
| --- | --- | --- |
| `SUI_WEB_PORT` | `8080` | Composeのweb公開ポート |
| `SUI_POSTGRES_DB` | `sui_sensemaking` | Compose PostgreSQLのdatabase名 |
| `SUI_POSTGRES_USER` | `sui_sensemaking` | Compose PostgreSQLのユーザー名 |
| `SUI_POSTGRES_PASSWORD` | `sui_sensemaking` | Compose PostgreSQLのパスワード |
| `SUI_RUNTIME_PROFILE` | `local-dev`（Composeは`evaluation`を注入） | フロントエンドエントリモード。`local-dev` / `evaluation` / `enterprise-production` はシングルテナント、`saas-multitenant` はテナントセッション必須。未知値は起動UIをブロックにする |
| `SUI_FRONTEND_API_BASE` | `/api` | フロントエンドのビルド時に埋め込むsame-origin API baseパス。標準Composeは同梱Nginxの固定 `location /api/` と一致させるため `/api` を固定注入し、ホスト側のこの値では変更しない。直接フロントエンドのビルド / 独自reverseプロキシでは `/` 自体または単一の `/` で始まるパスを受理する。`//host`、バックスラッシュ、クエリ、fragment、相対パスは `/api` にフォールバック |


## Private adapter boundary (non-public keys)

以下は公開設定キーではなく、サードパーティのアダプタが内部で使用する名前です。利用者は設定しません。

| Internal name | Adapter owner | Source public key | Scope |
| --- | --- | --- | --- |
| `POSTGRES_DB` | `docker-compose.yml` `db` サービス | `SUI_POSTGRES_DB` | PostgreSQLコンテナinternal env |
| `POSTGRES_USER` | `docker-compose.yml` `db` サービス | `SUI_POSTGRES_USER` | PostgreSQLコンテナinternal env |
| `POSTGRES_PASSWORD` | `docker-compose.yml` `db` サービス | `SUI_POSTGRES_PASSWORD` | PostgreSQLコンテナinternal env |

## Verification harness keys (non-public)

以下は製品ランタイムの公開設定ではなく、ローカル検証・CI・リハーサル用の環境変数です。利用者向けの04文書では公開ランタイム設定として扱いませんが、名前の例外を作らないため `SUI_*` を使います。

| Key | Owner | Default | Purpose |
| --- | --- | --- | --- |
| `SUI_RUN_PG_TESTS` | バックエンドpytest | 未設定 | PostgreSQL roundtrip testsを明示的に実行するオプトインflag |
| `SUI_RUN_PG_RLS_TESTS` | バックエンドpytest | 未設定 | 非superuser・非BYPASSRLS実行時ロールによるテナントRLS実地マトリクスを明示実行するオプトインflag |
| `SUI_TEST_POSTGRES_RUNTIME_DATABASE_URL` | バックエンドpytest | 未設定 | RLS実地マトリクス専用の実行時ロール接続URL。マイグレーション用`SUI_DATABASE_URL`と別資格情報を必須とする |
| `SUI_AUTH_PROVIDER_PROFILE_DIR` | Auth Level2 test harness | `03_Implement/backend/tests/federation/profiles` | プロバイダプロファイルフィクスチャの読み込み先 |
| `SUI_AUTH_LEVEL2_BACKEND_PORT` | `tests/scripts/run_auth_level2.sh` | `18000` | Auth Level2モック検証で起動するバックエンドポート |
| `SUI_AUTH_LEVEL2_SP_PORT` | `tests/scripts/run_auth_level2.sh` | `18080` | Auth Level2モックSPポート |
| `SUI_AUTH_LEVEL2_IDP_PORT` | `tests/scripts/run_auth_level2.sh` | `18081` | Auth Level2モックIdPポート |
| `SUI_SCREENSHOT_HOST` | `capture_release_screenshots.mjs` 等のスクリーンショット取得スクリプト | `127.0.0.1` | スクリーンショット撮影用に起動するviteプレビューサーバのホスト |
| `SUI_SCREENSHOT_PORT` | スクリーンショット取得スクリプト | `4173` | スクリーンショット撮影用viteプレビューサーバのポート |
| `SUI_SCREENSHOT_BASE_URL` | スクリーンショット取得スクリプト | `http://<host>:<port>/?locale=ja`（ホスト/portから導出） | 撮影対象ページのbase URL |
| `SUI_SCREENSHOT_OUTPUT_DIR` | スクリーンショット取得スクリプト | `04_Documentation/assets/screenshots` | 生成画像の出力先 |
| `SUI_SCREENSHOT_BROWSER_PATH` | スクリーンショット取得スクリプト | 未設定（Playwright管理ブラウザを使用） | 同梱Chromiumが利用できない環境向けのブラウザ実体パス代替 |
| `SUI_E2E_REAL_BACKEND` | Playwright e2e (`ai_model_ux_available_models_reason.spec.ts`) | 未設定 | 実バックエンド（モックではない）必須のE2E specを明示的に実行するオプトインflag（`"1"`で有効化）。未設定時は該当specをskipし、バックエンド未起動でも既定の`npm run e2e`を壊さない |
| `SUI_E2E_BACKEND_URL` | Playwright e2e (`ai_model_ux_available_models_reason.spec.ts`) | `http://127.0.0.1:8000` | 上記specがフィクスチャ設定（`/admin/provision/models/**`）を直接叩く先のバックエンドbase URL |

## Validation rules

- LLMのbase URLは認証情報/query/fragment、空白・制御文字・バックスラッシュを含まないHTTPS、またはループバックHTTPだけを受理します。モデルIDは256文字以下で空白・制御文字・バックスラッシュなしとします。
- `SUI_LLM_PROVIDER=large-scale`, `large_scale`, `external` は `SUI_LLM_LARGE_SCALE_OPT_IN=true`、`SUI_LLM_ESCALATION_ENABLED=true`、base URL、モデル、許可リストの完全セットを必須にします。許可リストは正規ホストだけを受理し、URL、ワイルドカード、ポート、パス、空要素、重複を拒否します。base URLのhostnameが許可リストにない構成も起動時に拒否します。
- `SUI_RUNTIME_PROFILE` は `local-dev`, `evaluation`, `enterprise-production`, `saas-multitenant` だけを名前として認識し、SaaSは安全条件が欠ける場合だけ起動を拒否します。
- 信頼済みSaaS識別情報リゾルバ、テナントリゾルバ、アクティブなテナントセッションpersisterは環境変数やリクエストヘッダーから選択せず、アプリケーション起動前の同一アダプタバンドルとしてのみ注入します。3要素の部分設定、起動後の差し替え、未検証の状態objectは拒否し、バンドル非注入時はセッションAPIを安全側で拒否に保ちます。SaaSバンドル有効化時はDocumentリソースリゾルバもサーバ所有のメタデータ＋信頼済み紐付けリゾルバへ切り替えます。アプリケーションlifespan終了時は3アダプタをApp状態から同時に無効化し、Documentリソースリゾルバもシングルテナント互換へ戻します。再起動時も実行時プロファイルとの照合を通過するまで再有効化しません。
- `SUI_ACCESS_CONTROL_ADAPTER` は `noop`, `mock`, `external_http` だけを許可します。
- `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` は `read_only`, `deny` だけを許可します。
- `SUI_AUDIT_TRANSPORT`は`noop`, `http`だけを許可します。監査HTTPと外部PDPのエンドポイントは認証情報/query/fragment、空白・制御文字・バックスラッシュを含まないHTTPS、またはループバックHTTPだけを受理し、ポート不正も拒否します。`http` / `external_http` を明示選択した場合は対応エンドポイントを必須とし、欠損時はnoopへフォールバックせず起動を拒否します。HTTP連携を無効にしたままエンドポイント/APIキーを残すことや、エンドポイントなしでbearer/IdP issuerだけを設定することも拒否します。
- 監査HTTPと外部PDPのタイムアウトは`0 < value <= 30`、監査キューは1以上を必須にします。固定bearerは空値・空白・制御文字を、IdP issuerヘッダー値は2,048文字超・前後空白・制御文字を拒否し、検証エラーへ入力値を反射しません。
- `SUI_DOCUMENT_POLICY_BINDING_RESOLVER` は `none`, `external_http` だけを許可します。`external_http`ではエンドポイントを必須とし、非ループバックHTTP、URL内認証情報/query/fragment、空白・制御文字を含むAPIキーを拒否します。`none`でHTTP設定だけを残すことも拒否します。
- `SUI_TENANT_CAPABILITY_RESOLVER`も同じ信頼済みHTTP接続制約を適用します。外部応答は既知capabilityの重複なし配列と不透明なcapabilityバージョンだけを受理し、不明値・不完全設定は安全側で拒否にします。
- 外部PDP、監査HTTP、Documentポリシー紐付け、テナントcapability、LLMのoutbound HTTPは3xxリダイレクトを追跡しません。検証済みエンドポイントやホスト許可リストをリダイレクト先で迂回させず、固定bearer、テナントコンテキスト、policyRef、promptを別の接続先へ転送しません。
- `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_AUTH_MODE` は `none`, `oidc`, `saml` だけを許可します。
- `SUI_REVIEWER_REF_RESOLVER_ADAPTER` は `user_id`, `sso_subject` だけを許可します。
- CE4の固定契約値は、実装で安全側に検証します。

## Operating rule

公開文書、runbook、Docker Composeの利用者入力、CI設定例では、上記以外の環境変数名をsui-sensemakingの設定キーとして記載しません。内部実装上の写像が必要な場合も、利用者には `SUI_*` のみを提示します。


### Public contract boundary (ENV-CONFIG-DRIFT-01)

- このレジストリは公開実行時キーの唯一の情報源であり、公開するのは `SUI_*` の名前だけです。
- ベンダーが定義する名前は実装内部のアダプタの詳細であり、公開キーとして扱ってはなりません。
- `SUI_*` 以外の名前をすべてのプロセス環境から排除する方針は、別途デプロイの再設計として判断する事項です。

### Productization readiness boundary（ENV-CONFIG-DRIFT-01 / 2026-06-02）

製品化判定では、「公開設定として利用者に求めるもの」と「実装内部で第三者コンポーネントに渡すもの」を分けて評価します。

| 判定対象 | 現在の扱い | Done への影響 |
| --- | --- | --- |
| 公開環境変数 | このレジストリと公開文書に載せるキーは `SUI_*` のみ。 | 現在の方針で充足。キーを追加する場合はこの表を先に更新する。 |
| 第三者コンテナ内部名 | `POSTGRES_*` は `ADR-0029` の非公開アダプタ境界。利用者には設定させない。 | 現在の方針ではDone阻害要因ではない。全process envからの排除を求める場合は別ADRとデプロイ再設計が必要。 |
| `external_http` endpoint 未設定時の挙動 | `ADR-0062`で即時失敗を採択。明示した外部HTTP連携はエンドポイントを必須とし、欠損時は起動拒否する。 | 既定 `noop` は維持し、完全設定された連携の実行時障害は既存のフェイルセーフ、または失敗しても処理を続ける方式へ委譲する。 |
| 最終検証 | settings検証、docs key-drift search、Compose config、フロントエンドのビルドキーの確認を実行する。 | issue Done前の確認事項として残す。 |

## Drift recurrence prevention checklist（ENV-CONFIG-DRIFT-01 / ENV-ARCH-01 / ENV-PROFILE-01）

実行時パラメータの契約を変更するときは、毎回、次のチェックを実施します。

1. **Naming**: 追加・変更する公開キーが `SUI_*` で始まること。
2. **Defaults**: `Default` 列と実装既定値（settings/frontendビルド）が一致していること。
3. **境界**: vendor名（例: `POSTGRES_*`）を公開キーとして公開文書に露出していないこと。
4. **Profiles**: `local-dev` / `evaluation` / `enterprise-production` の推奨差分が変更理由と整合し、`saas-multitenant`は必須ポリシー・コンポーネントが完備した場合だけ起動可能で、不足時は即座に失敗させること。
5. **Cross-doc sync**: `deployment.md` と `04_Documentation/configuration.md` に同じ公開キー集合が反映されていること。
6. **Compatibilityゲート**: 非互換が必要な場合は即実装せず、ADR/IssueにGo/No-Goとロールバックを先に記録すること。

停止条件は次のとおり。
- 上記1〜6のうち未充足がある場合は変更を停止し、承認待ちに切り替える。


## Global prefix migration adapter boundary（Stream D contract）

`ADR-0021` に基づきバックエンド実行時キーは互換期間なしで `SUI_*` へ移行済みです。
一方でdeploy/frontendビルドには、利用者向け公開キーと実装内部アダプタの境界があるため、次の2層で固定します。

1. **公開contract layer（利用者入力）**
   - 受理する公開キーは `SUI_*` のみ。
   - 旧接頭辞/無接頭辞キーは即時失敗で拒否する。
2. **非公開アダプタlayer（実装内部写像）**
   - third-partyコンテナが要求する `POSTGRES_*` 等は内部写像に限定する。
   - フロントエンドのビルドは `envPrefix: "SUI_"` とし、`SUI_RUNTIME_PROFILE`と`SUI_FRONTEND_API_BASE`だけを読み取る。旧フロントエンドキーの互換互換層は設けない。

### Plan → Execute → Verify → Proceed gate

- Plan: 変更前に `Naming / Defaults / Boundary / Profiles` の4観点を固定する。
- Execute: 公開契約の更新を先に行い、実装・deploy・docsを追随させる。
- Verify: docs-check + settings検証 + compose configで同一キー集合を確認する。
- Proceed: 4観点がすべてpassの場合のみ進行し、1つでもfailなら停止してIssue/ADRへ戻す。

### Failure budget（3回失敗で停止）

- 同一論点でVerifyが3回連続失敗した場合、4回目の試行に進まず **Stop** とする。
- Stop時は「失敗原因」「再開条件」「要追加判断（ADR/Issue）」を `01_Plans/issues/` に記録する。
