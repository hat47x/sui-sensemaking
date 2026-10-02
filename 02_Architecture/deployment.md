# Deployment Policy And Docker Compose

> 環境変数・実行時パラメータの正本は `02_Architecture/runtime_parameter_registry.md` です。本書ではデプロイ構成の考え方だけを説明し、設定キーの追加・変更は必ず正本と同時に行います。

## 基本方針

- 標準の評価・検証構成はDocker Composeです。
- Composeは `web`、`api`、`db` の3サービスで構成します。
- 利用者が設定する環境変数は、例外なく `SUI_` で始めます。
- サードパーティコンテナやbuild toolが内部的に別名を要求する場合でも、公開設定キーは `SUI_*` だけにします。
- 標準構成は **loopback（`127.0.0.1`）限定の同一ホスト評価用**です（`DEPLOY-NET-01`）。`SUI_WEB_PORT` はport番号だけを変え、bind範囲を拡張しません。別端末・LAN・Internetからの利用は、TLS終端・認証proxy・接続元制限を伴う別deployment profileとして扱い、base Composeのport mappingを直接書き換えません。
- 本番相当の構成では、Composeを起点に組織の認証、監視、バックアップ、秘密管理を追加します。

サードパーティイメージが要求する変数名は、`01_Plans/adr/ADR-0029-third-party-runtime-env-boundary.md` に基づくprivate adapter名として扱います。運用者が設定する値は `SUI_*` だけです。

環境別の推奨値は [runtime_parameter_registry.md](runtime_parameter_registry.md) の `Runtime profiles` を参照します。ローカル開発、評価、企業・行政の本番相当では、同じキーでも推奨値や確認事項が異なります。

## 標準構成

| Service | 役割 |
| --- | --- |
| `web` | build 済み frontend を Nginx で配信し、`/api` を backend へ proxy する |
| `api` | FastAPI backend と Alembic migration を実行する |
| `db` | PostgreSQL を提供する |

ローカル開発だけで確認する場合は、`db` を省略してSQLiteを使えます。

## 公開設定キー

Composeとfrontend buildで利用者が設定する公開キーは次です。

| Key | Default | Purpose |
| --- | --- | --- |
| `SUI_RUNTIME_PROFILE` | `evaluation` | backend実行profileとfrontend entry modeへ同じ値を渡す。現行Composeは評価用途を既定とし、`saas-multitenant`はPostgreSQL共有認証表と必須外部adapterを満たす環境だけで起動。 |
| `SUI_WEB_PORT` | `8080` | `web` の loopback（`127.0.0.1`）port。ホスト外からの到達は既定で不可（`DEPLOY-NET-01`） |
| `SUI_POSTGRES_DB` | `sui_sensemaking` | Compose PostgreSQL の database 名 |
| `SUI_POSTGRES_USER` | `sui_sensemaking` | Compose PostgreSQL の user 名 |
| `SUI_POSTGRES_PASSWORD` | `sui_sensemaking` | Compose PostgreSQL の password |
| `SUI_FRONTEND_API_BASE` | `/api` | frontend build 時に埋め込む API base path（`/` 始まりのみ許可。不正値は `/api` へフォールバック） |
| `SUI_DATABASE_URL` | Compose では PostgreSQL 接続先 | backend が使う DB 接続先 |
| `SUI_LLM_PROVIDER` | `none` | LLM provider |

全量のbackend runtime keyは [runtime_parameter_registry.md](runtime_parameter_registry.md) を参照します。


## Registry / Deploy alignment matrix

`runtime_parameter_registry.md` を基準に、deploy面で次を固定します。

| Public key | Compose mapping | 備考 |
| --- | --- | --- |
| `SUI_RUNTIME_PROFILE` | `api.environment.SUI_RUNTIME_PROFILE` + `web.build.args.SUI_RUNTIME_PROFILE` | backendとfrontend buildへ同じ`${SUI_RUNTIME_PROFILE:-evaluation}`を渡す。値の不一致を許容しない |
| `SUI_WEB_PORT` | `web.ports`（`127.0.0.1:<port>:80`） | loopback bind の port 番号のみを変更する |
| `SUI_POSTGRES_DB` | `db.environment.POSTGRES_DB` | third-party private adapter への内部写像 |
| `SUI_POSTGRES_USER` | `db.environment.POSTGRES_USER` | third-party private adapter への内部写像 |
| `SUI_POSTGRES_PASSWORD` | `db.environment.POSTGRES_PASSWORD` | third-party private adapter への内部写像 |
| `SUI_FRONTEND_API_BASE` | `web.build.args.SUI_FRONTEND_API_BASE` | `/` 始まり path のみ許可 |
| `SUI_DATABASE_URL` | `api.environment.SUI_DATABASE_URL` | backend DB 接続先 |
| `SUI_LLM_PROVIDER` | `api.environment.SUI_LLM_PROVIDER` | provider 切替 |

運用者が設定する公開キーは `SUI_*` のみとし、`POSTGRES_*` はCompose内部で完結するprivate adapter名として扱います。

## Docker Compose の設定例

利用者が値を変える場合は、次のように `SUI_*` だけを設定します。

```bash
export SUI_WEB_PORT=8080
export SUI_POSTGRES_DB=sui_sensemaking
export SUI_POSTGRES_USER=sui_sensemaking
export SUI_POSTGRES_PASSWORD=sui_sensemaking
export SUI_FRONTEND_API_BASE=/api
export SUI_LLM_PROVIDER=none
```

DB名、user、passwordを既定値から変える場合は、backendの接続先も同じ値に合わせます。

```bash
export SUI_DATABASE_URL='postgresql+asyncpg://sui_sensemaking:sui_sensemaking@db:5432/sui_sensemaking'
```

## CE4 契約

- API/CLI/GUIは同じcanonical queryから `equivalenceKey` を生成します。
- 同じ `equivalenceKey` の実行は同じ `bundleHash` を返します。
- 同値性判定は `equivalenceKey + bundleHash` のAND条件を維持します。
- `apply --dry-run` は `sideEffect=none` を必須にし、副作用を起こしません。
- query、bundle、proposal、applyのaudit eventが欠ける場合は成功扱いにしません。

関連設定は次のとおりです。

- `SUI_CE4_EQUIVALENCE_MODE`
- `SUI_CE4_DRY_RUN_ENFORCE_NO_SIDE_EFFECT`
- `SUI_CE4_AUDIT_REQUIRE_ALL_EVENTS`
- `SUI_CE4_SOURCE_BUNDLE_HASH_ALLOW_MOCK`
- `SUI_CE4_STUB_UNRESOLVED_CONTRACTS`

## 運用境界

- `web` と `api` は同一Compose network内で通信します。
- 既定では `SUI_LLM_PROVIDER=none` とし、外部LLMにデータを渡しません。
- local LLMを使う場合は `SUI_LOCAL_LLM_BASE_URL` を管理できる接続先（endpoint）に向けます。
- large-scale LLMを使う場合は、明示opt-in、昇格許可、allowlistをすべて設定します。
- access controlを外部PDPに委譲する場合は、接続先（endpoint）、timeout、fail-safeを同時に確認します。

## Cloud への載せ替え

- `web` は静的hostingやCDNに置き換えられます。
- `api` はcontainer実行環境に載せ替えられます。
- `db` はmanaged PostgreSQLに置き換えられます。
- どの構成でも、公開設定キーは `SUI_*` だけを使います。

## 変更時のルール

1. 設定キーを追加・改名・削除する場合は、先に `runtime_parameter_registry.md` を更新します。
2. 実装、Compose、04文書、release手順を同じPRで同期します。
3. 旧キーや互換キーを公開設定として残しません。
4. SafeMode、share/export、外部サービスとの共有の安全境界を緩める変更はADRで判断します。
