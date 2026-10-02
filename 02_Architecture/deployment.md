# 配備の方針とDocker Compose

> 環境変数と実行時パラメータの正本は、`02_Architecture/runtime_parameter_registry.md` です。この文書では、配備の構成の考え方だけを説明します。設定キーを追加したり変更したりするときは、必ず、正本と同時に行います。

## 基本方針

- 標準の評価と検証の構成は、Docker Composeです。
- Composeは、`web`、`api`、`db` の3つのサービスで構成します。
- 利用者が設定する環境変数は、例外なく、`SUI_` で始めます。
- サードパーティのコンテナやビルドツールが、内部で別の名前を要求するときでも、公開する設定キーは `SUI_*` だけにします。
- 標準の構成は、loopback（`127.0.0.1`）に限った、同じホストでの評価用です（`DEPLOY-NET-01`）。`SUI_WEB_PORT` が変えるのはポート番号だけで、結び付ける範囲は広げません。別の端末、LAN、インターネットからの利用は、TLSの終端、認証プロキシ、接続元の制限を備えた、別の配備のプロファイルとして扱い、基本のComposeのポートの割り当てを、直接書き換えません。
- 本番に近い構成では、Composeを起点に、組織の認証、監視、バックアップ、秘密情報の管理を追加します。

サードパーティのイメージが要求する変数名は、`01_Plans/adr/ADR-0029-third-party-runtime-env-boundary.md` に基づく、内部のアダプタの名前として扱います。運用者が設定する値は、`SUI_*` だけです。

環境ごとの推奨値は、[runtime_parameter_registry.md](runtime_parameter_registry.md) の `Runtime profiles` を参照します。ローカルでの開発、評価、企業や行政の本番に近い環境では、同じキーでも、推奨値や確認事項が異なります。

## 標準の構成

| サービス | 役割 |
| --- | --- |
| `web` | ビルド済みのfrontendをNginxで配信し、`/api` をbackendに中継する |
| `api` | FastAPIのbackendと、Alembicのマイグレーションを実行する |
| `db` | PostgreSQLを提供する |

ローカルでの開発だけで確認するときは、`db` を省略して、SQLiteを使えます。

## 公開する設定キー

Composeとfrontendのビルドで、利用者が設定する公開キーは、次のとおりです。

| キー | 既定値 | 用途 |
| --- | --- | --- |
| `SUI_RUNTIME_PROFILE` | `evaluation` | backendの実行プロファイルと、frontendの入口のモードに、同じ値を渡す。現在のComposeは評価用を既定とし、`saas-multitenant` は、PostgreSQLの共有の認証テーブルと、必須の外部アダプタを満たす環境でだけ起動する。 |
| `SUI_WEB_PORT` | `8080` | `web` のloopback（`127.0.0.1`）のポート。ホストの外からは、既定では到達できない（`DEPLOY-NET-01`）。 |
| `SUI_POSTGRES_DB` | `sui_sensemaking` | Compose上のPostgreSQLのデータベース名 |
| `SUI_POSTGRES_USER` | `sui_sensemaking` | Compose上のPostgreSQLのユーザー名 |
| `SUI_POSTGRES_PASSWORD` | `sui_sensemaking` | Compose上のPostgreSQLのパスワード |
| `SUI_FRONTEND_API_BASE` | `/api` | frontendのビルドのときに埋め込む、APIの基準パス（`/` で始まるものだけを許可し、不正な値は `/api` に戻す）。 |
| `SUI_DATABASE_URL` | Composeでは、PostgreSQLへの接続先 | backendが使う、DBの接続先 |
| `SUI_LLM_PROVIDER` | `none` | LLMのプロバイダ |

backendの実行時のキーの全量は、[runtime_parameter_registry.md](runtime_parameter_registry.md) を参照します。

## レジストリと配備の対応表

`runtime_parameter_registry.md` を基準に、配備の面で、次を固定します。

| 公開キー | Composeでの対応 | 備考 |
| --- | --- | --- |
| `SUI_RUNTIME_PROFILE` | `api.environment.SUI_RUNTIME_PROFILE` と `web.build.args.SUI_RUNTIME_PROFILE` | backendとfrontendのビルドに、同じ `${SUI_RUNTIME_PROFILE:-evaluation}` を渡す。値の不一致は許容しない。 |
| `SUI_WEB_PORT` | `web.ports`（`127.0.0.1:<port>:80`） | loopbackに結び付けた、ポート番号だけを変える。 |
| `SUI_POSTGRES_DB` | `db.environment.POSTGRES_DB` | サードパーティの内部アダプタへの、内部での対応。 |
| `SUI_POSTGRES_USER` | `db.environment.POSTGRES_USER` | サードパーティの内部アダプタへの、内部での対応。 |
| `SUI_POSTGRES_PASSWORD` | `db.environment.POSTGRES_PASSWORD` | サードパーティの内部アダプタへの、内部での対応。 |
| `SUI_FRONTEND_API_BASE` | `web.build.args.SUI_FRONTEND_API_BASE` | `/` で始まるパスだけを許可する。 |
| `SUI_DATABASE_URL` | `api.environment.SUI_DATABASE_URL` | backendのDBの接続先。 |
| `SUI_LLM_PROVIDER` | `api.environment.SUI_LLM_PROVIDER` | プロバイダの切り替え。 |

運用者が設定する公開キーは、`SUI_*` だけとし、`POSTGRES_*` は、Compose内部で完結する、内部のアダプタの名前として扱います。

## Docker Composeの設定の例

利用者が値を変えるときは、次のように、`SUI_*` だけを設定します。

```bash
export SUI_WEB_PORT=8080
export SUI_POSTGRES_DB=sui_sensemaking
export SUI_POSTGRES_USER=sui_sensemaking
export SUI_POSTGRES_PASSWORD=sui_sensemaking
export SUI_FRONTEND_API_BASE=/api
export SUI_LLM_PROVIDER=none
```

DB名、ユーザー名、パスワードを既定値から変えるときは、backendの接続先も、同じ値に合わせます。

```bash
export SUI_DATABASE_URL='postgresql+asyncpg://sui_sensemaking:sui_sensemaking@db:5432/sui_sensemaking'
```

## CE4の契約

- API、CLI、GUIは、同じ正規化したクエリから `equivalenceKey` を生成します。
- 同じ `equivalenceKey` の実行は、同じ `bundleHash` を返します。
- 同値性の判定は、`equivalenceKey` と `bundleHash` の両方が一致する（AND）条件を維持します。
- `apply --dry-run` は、`sideEffect=none` を必須にし、副作用を起こしません。
- クエリ、バンドル、提案、適用のいずれかの監査イベントが欠けているときは、成功として扱いません。

関連する設定は、次のとおりです。

- `SUI_CE4_EQUIVALENCE_MODE`
- `SUI_CE4_DRY_RUN_ENFORCE_NO_SIDE_EFFECT`
- `SUI_CE4_AUDIT_REQUIRE_ALL_EVENTS`
- `SUI_CE4_SOURCE_BUNDLE_HASH_ALLOW_MOCK`
- `SUI_CE4_STUB_UNRESOLVED_CONTRACTS`

## 運用の境界

- `web` と `api` は、同じComposeのネットワークの中で通信します。
- 既定では、`SUI_LLM_PROVIDER=none` とし、外部のLLMにデータを渡しません。
- ローカルのLLMを使うときは、`SUI_LOCAL_LLM_BASE_URL` を、管理できる接続先（エンドポイント）に向けます。
- 大規模LLMを使うときは、明示的なopt-in、昇格の許可、許可リストを、すべて設定します。
- アクセス制御を外部のPDPに任せるときは、接続先（エンドポイント）、タイムアウト、フェイルセーフを、同時に確認します。

## クラウドへの載せ替え

- `web` は、静的なホスティングやCDNに置き換えられます。
- `api` は、コンテナの実行環境に載せ替えられます。
- `db` は、マネージドのPostgreSQLに置き換えられます。
- どの構成でも、公開する設定キーは、`SUI_*` だけを使います。

## 変更するときのルール

1. 設定キーを追加、改名、削除するときは、先に `runtime_parameter_registry.md` を更新します。
2. 実装、Compose、04の文書、リリースの手順を、同じPRで同期します。
3. 旧キーや互換キーを、公開の設定として残しません。
4. SafeMode、共有と書き出し、外部サービスとの共有の安全上の境界を緩める変更は、ADRで判断します。
