# sui-sensemaking backend (Phase 1 MVP)


> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。
現行実装では `DocumentV1` のスナップショット保存/読込を提供します。

## API

- `GET /healthz`
- `GET /docs/{doc_id}`
- `PUT /docs/{doc_id}`

## Persistence

- テーブル: `documents(id TEXT PK, version INT, updated_at TEXT, payload_json TEXT)`
- `payload_json` に `DocumentV1` 全体(JSON文字列)を保存
- スキーマ管理はAlembic migrationを利用

## Environment variables

- `SUI_DATABASE_URL`
  - 既定値: `sqlite:///./sui_sensemaking.db`
  - driverを省略したURL（例: `mysql://...`）と対応済みasync URLは、能力レジストリに記録した検証済み同期driverへ正規化して利用
  - 明示driverは検証済みの組合せだけを受理する。例としてMySQLは`mysql+pymysql`、SQL Serverは`mssql+pymssql`、Oracleは`oracle+oracledb`を使用し、未導入・未検証driverはengine生成前に拒否する
  - 正式対応はSQLite、PostgreSQL 16、MySQL 8.4、MariaDB 11.4、SQL Server 2022、CockroachDB 26.2.3、Oracle AI Database Free 23.26.2
  - 対応状況と昇格条件: `02_Architecture/database_portability.md`
- `SUI_LLM_PROVIDER`
  - 既定値: `none`は次のとおりです。
  - 値: `none | local | large-scale | deepseek`（後方互換エイリアス: `local_http`, `external`）
  - `deepseek`では`SUI_DEEPSEEK_API_KEY`が必須。base URLと既定modelは環境変数正本を参照
- `SUI_LLM_FALLBACK_TO_NONE`
  - 既定値: `true`は次のとおりです。
  - `true` の場合、`local`/`large-scale` 呼び出し失敗時は `none` 退避としてfail-closed（HTTP 501）

## Run

```bash
cd 03_Implement/backend
python -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn sqlalchemy alembic pydantic pydantic-settings psycopg[binary]
export PYTHONPATH=src
export SUI_DATABASE_URL="sqlite:///./sui_sensemaking.db"
export SUI_LLM_PROVIDER="none"
alembic upgrade head
uvicorn sui_sensemaking_api.main:app --reload
```

PostgreSQLを使う場合は `SUI_DATABASE_URL` をPostgreSQLのURLに変更してください。

MySQL/MariaDBはoptional driverを導入し、single-tenant構成で使用します。

```bash
pip install -e ".[mysql]"
export SUI_DATABASE_URL="mysql+pymysql://user:password@localhost:3306/sui_sensemaking"
# MariaDB: mariadb+pymysql://user:password@localhost:3306/sui_sensemaking
alembic upgrade head
```

SQL Server 2022もoptional driverを導入し、single-tenant構成で使用します。接続先databaseは事前に作成してください。

```bash
pip install -e ".[mssql]"
export SUI_DATABASE_URL="mssql+pymssql://user:password@localhost:1433/sui_sensemaking"
alembic upgrade head
```

CockroachDB 26.2.3もoptional dialectを導入し、single-tenant構成で使用します。接続先databaseは事前に作成してください。

```bash
pip install -e ".[cockroachdb]"
export SUI_DATABASE_URL="cockroachdb+psycopg://user:password@localhost:26257/sui_sensemaking"
alembic upgrade head
```

`--insecure`はローカル試験専用です。本番ではCockroachDBのTLS構成と適切な`sslmode`を使用してください。

Oracle AI Database Free 23.26.2もThin modeのoptional driverを導入し、single-tenant構成で使用します。URLのpathはSIDとして解釈されるため、PDBへ接続するときは`service_name` query parameterを使用してください。

```bash
pip install -e ".[oracle]"
export SUI_DATABASE_URL="oracle+oracledb://user:password@localhost:1521?service_name=FREEPDB1"
alembic upgrade head
```

Oracle Database FreeにはCPU、RAM、ユーザーデータ量、同一論理環境内のinstance数に製品上限があります。本番採用前にOracleの現行ライセンス条件と必要editionを確認してください。

## Minimal backup / restore

`documents.payload_json`には`DocumentV1`全体をJSON snapshotとして保存しています。バックアップは取得だけで完了とせず、本番とは別のdatabase／schema／pathへ復元してDocument、判断ログ、schema revision、大容量本文を照合してください。

SQLite、PostgreSQL、MySQL、MariaDB、SQL Server、CockroachDB、Oracleの検証済み最小手順と中断条件は、公開運用正本の[`operations.md`「バックアップと隔離復元」](../../04_Documentation/operations.md#バックアップと隔離復元)を参照してください。製品別コマンドをこのREADMEへ重複記載しません。


## Tests

```bash
cd 03_Implement/backend
export PYTHONPATH=src
pytest
```

### CE4 CLI authentication

`sui_sensemaking_api.cli` uses `SUI_API_KEY` for business-plane API
authentication. Keep the secret in the environment; there is intentionally no
command-line key option because process arguments and shell history are not a
safe secret transport. An unset value preserves open `local-dev` behavior.

### Control-plane CLI

The same module provides an operator-facing control-plane CLI. It reads the
bootstrap credential only from `SUI_ADMIN_API_KEY`; the business-plane
`SUI_API_KEY` is deliberately ignored for every `admin` command. Write
commands print a change preview and require interactive confirmation, or an
explicit `--yes` in automation.

Tenant model-allowlist updates also carry the revision returned by the preview
read. If another administrator changes the same tenant before the write, the
CLI exits non-zero with `model_allowlist_conflict` instead of overwriting the
newer policy.

```bash
export SUI_ADMIN_API_KEY='...'
python -m sui_sensemaking_api.cli admin models list
python -m sui_sensemaking_api.cli admin providers register \
  --id deepseek --kind deepseek --display-name DeepSeek \
  --base-url https://api.deepseek.com --api-key-ref SUI_DEEPSEEK_API_KEY
python -m sui_sensemaking_api.cli admin models register \
  --id deepseek-v4-flash --provider-id deepseek --display-name 'DeepSeek V4 Flash' \
  --capabilities intermediate,generate
python -m sui_sensemaking_api.cli admin tenants model-allowlist-set \
  --tenant-id local-default --model-id deepseek-v4-flash
python -m sui_sensemaking_api.cli admin models set-lifecycle \
  --id deepseek-v4-flash --state disabled
python -m sui_sensemaking_api.cli admin audit list --limit 50
```

Do not place the admin credential in the end-user SPA. The static credential is
the ADR-0072 bootstrap path; a separately deployed administrator console and
interactive Stage-B capability session remain separate follow-up work.

PostgreSQL roundtrip testを実行する場合。

```bash
export SUI_DATABASE_URL="postgresql+psycopg://sui_sensemaking:sui_sensemaking@localhost:5432/sui_sensemaking"
export SUI_RUN_PG_TESTS=1
alembic upgrade head
pytest -m postgres
```

tenant RLSの実地matrixは、migration所有者とは別のruntime roleで実行します。runtime roleには対象schemaの通常DML権限を付与し、superuser属性と`BYPASSRLS`を付与しないでください。同じ資格情報やRLSを迂回できるroleではテストが失敗します。

```bash
export SUI_DATABASE_URL="postgresql+psycopg://migration_owner:...@localhost:5432/sui_sensemaking"
export SUI_TEST_POSTGRES_RUNTIME_DATABASE_URL="postgresql+psycopg://sui_sensemaking_runtime:...@localhost:5432/sui_sensemaking"
export SUI_RUN_PG_RLS_TESTS=1
pytest -q tests/test_document_access_rls_postgres.py
```

Auth federation Level2（Mock SP/IdP）を実行する場合。

```bash
cd 03_Implement/backend
export PYTHONPATH=src
export SUI_LEVEL2_DIAG_DIR=.artifacts/auth-level2/legacy-federation
./scripts/run_auth_level2.sh
```

- provider profile fixtures: `tests/level2/fixtures/provider_profile_*.json`, `tests/federation/profiles/*.json`
- 差異再現観点: ヘッダー名 / claim名 / groups形式 / amr-acr有無
- 診断JSONは `SUI_LEVEL2_DIAG_DIR` を明示したときだけ出力する。通常の `pytest` は作業ツリーへ診断ファイルを書き込まない。

同じ統合ハーネスを直接実行する場合。

```bash
cd 03_Implement/backend
tests/scripts/run_auth_level2.sh
```

- provider profile fixture: `tests/federation/profiles/*.json`
- 失敗時ログ: `.artifacts/auth-level2/`


## LLM provider audit metadata

`/ai/*` エンドポイントでは、監査可能性のために以下の項目を構造化ログへ記録します。

- `provider` / `provider_kind`
- `model_id`
- `requested_at`（UTC ISO8601）
- `transport`
- `trace_id`
- `fallback_to_none`

これらは `extra={...}` で渡され、`SUI_LOG_JSON=true`（既定）のときJSONの1行として
出力されます。OPS-OBSERV-01以前はログ設定が存在せず、`logging.Formatter` の既定書式が
`extra` を描画しないため **上記の項目は実際には出力されていませんでした**。出力レベルは
`SUI_LOG_LEVEL` で変更できます。全リクエストには `X-Request-Id` が付与され、ログ行の
`requestId` フィールドと突き合わせられます。
