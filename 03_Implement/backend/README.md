# sui-sensemakingバックエンド（フェーズ1 MVP）


> 環境変数と実行パラメータの定義元は `02_Architecture/runtime_parameter_registry.md` です。本書には必要最小限だけを書きます。追加や改名のときは、先にその文書を更新してください。

現在の実装は、`DocumentV1` のスナップショットの保存と読み込みを提供します。

## API

- `GET /healthz`
- `GET /docs/{doc_id}`
- `PUT /docs/{doc_id}`

## TEI Action用SUI Card移動コマンド（参照段階）

`src/sui_sensemaking_api/card_move_command.py`は、SUIの`DocumentV1`と確定座標から**新しいDocumentスナップショット**を生成するアプリケーション所有の純粋処理です。対象Cardの存在・識別の一意性、有限座標、島への所属変更を検証し、Source、Hold、Edge、レビュー帰属などの無関係な情報を保持します。既存の非包含Affiliationと移動後の包含関係が競合する場合は、黙って来歴を削除せず拒否します。

- `tests/test_card_move_command.py`：座標・矩形／多角形境界・島所属・来歴・負例の単体テスト。
- `tests/test_docs_roundtrip.py::test_sui_card_move_command_with_existing_sqlite_document_cas`：このコマンドの結果を既存の`PUT /docs/{id}`へ`If-Match`付きで保存し、`GET`とETagを照合するSQLite参照テスト。
- `../frontend/src/api/client.ts`の`getAuthoritativeDocument`：操作確定後の権威ある読み直しに`cache: "no-store"`を指定し、既存のセッション前提条件を引き継ぐ追加API。

**今回の変更は新しいHTTP Actionルートを登録しません。** `PUT /docs/{id}`は現行どおり既存の認可、テナント、アーカイブ状態、レビュー帰属、ETag・Revision処理を担当します。純粋コマンドだけでは同時更新を防げないため、TEI HostとSUI保存側のアダプターが、**権威あるRevisionの原子的比較・SUIコマンド実行・保存**を一単位として保証する必要があります。TEI CoreにはSUI専用構造を持ち込みません。

実Go Hostからの呼び出し、実セッション認可、ブラウザーでのCard移動、Undo/Redo接続は**未実施**です。追加したPythonテストとSUIフロントエンド全体のテストも未実行であり、単体テストの追加だけをPASSの証拠とはしません。実装時はPython側とTypeScript側のCard移動規則の差分をクロスランゲージfixtureで検証します。

## 永続化

- テーブル: `documents(id TEXT PK, version INT, updated_at TEXT, payload_json TEXT)`
- `payload_json` に `DocumentV1` の全体（JSON文字列）を保存
- スキーマはAlembicのマイグレーションで管理

## 環境変数

- `SUI_DATABASE_URL`
  - 既定値: `sqlite:///./sui_sensemaking.db`
  - ドライバを省略したURL（例: `mysql://...`）と、対応済みの非同期URLは、能力レジストリに記録した検証済みの同期ドライバへ正規化して使う
  - ドライバを明示する場合は、検証済みの組み合わせだけを受け付ける。例として、MySQLは`mysql+pymysql`、SQL Serverは`mssql+pymssql`、Oracleは`oracle+oracledb`を使う。未導入または未検証のドライバは、エンジンを作る前に拒否する
  - 正式対応はSQLite、PostgreSQL 16、MySQL 8.4、MariaDB 11.4、SQL Server 2022、CockroachDB 26.2.3、Oracle AI Database Free 23.26.2
  - 対応状況と、正式対応へ上げる条件: `02_Architecture/database_portability.md`
- `SUI_LLM_PROVIDER`
  - 既定値: `none`
  - 値: `none | local | large-scale | deepseek`（後方互換の別名: `local_http`, `external`）
  - `deepseek`では`SUI_DEEPSEEK_API_KEY`が必須。ベースURLと既定のモデルは、環境変数の定義元を参照
- `SUI_LLM_FALLBACK_TO_NONE`
  - 既定値: `true`
  - `true` の場合、`local` / `large-scale` の呼び出しに失敗したときは `none` に退避し、安全側で拒否する（HTTP 501）

## 実行

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

PostgreSQLを使う場合は、`SUI_DATABASE_URL` をPostgreSQLのURLに変更してください。

MySQLとMariaDBは、オプションのドライバを導入し、シングルテナント構成で使います。

```bash
pip install -e ".[mysql]"
export SUI_DATABASE_URL="mysql+pymysql://user:password@localhost:3306/sui_sensemaking"
# MariaDB: mariadb+pymysql://user:password@localhost:3306/sui_sensemaking
alembic upgrade head
```

SQL Server 2022も、オプションのドライバを導入し、シングルテナント構成で使います。接続先のデータベースは事前に作成してください。

```bash
pip install -e ".[mssql]"
export SUI_DATABASE_URL="mssql+pymssql://user:password@localhost:1433/sui_sensemaking"
alembic upgrade head
```

CockroachDB 26.2.3も、オプションのdialectを導入し、シングルテナント構成で使います。接続先のデータベースは事前に作成してください。

```bash
pip install -e ".[cockroachdb]"
export SUI_DATABASE_URL="cockroachdb+psycopg://user:password@localhost:26257/sui_sensemaking"
alembic upgrade head
```

`--insecure`はローカルでの試験専用です。本番では、CockroachDBのTLS構成と適切な`sslmode`を使ってください。

Oracle AI Database Free 23.26.2も、Thinモードのオプションのドライバを導入し、シングルテナント構成で使います。URLのパスはSIDとして解釈されるため、PDBへ接続するときは、クエリパラメータの`service_name`を使ってください。

```bash
pip install -e ".[oracle]"
export SUI_DATABASE_URL="oracle+oracledb://user:password@localhost:1521?service_name=FREEPDB1"
alembic upgrade head
```

Oracle Database Freeには、CPU、RAM、ユーザーデータ量、同じ論理環境内のインスタンス数に、製品としての上限があります。本番で採用する前に、Oracleの現行のライセンス条件と必要なエディションを確認してください。

## 最小限のバックアップと復元

`documents.payload_json`には、`DocumentV1`の全体をJSONのスナップショットとして保存しています。バックアップは、取得しただけで完了とせず、本番とは別のデータベース、スキーマ、パスへ復元して、Document、判断ログ、スキーマのリビジョン、大容量の本文を照合してください。

SQLite、PostgreSQL、MySQL、MariaDB、SQL Server、CockroachDB、Oracleの検証済みの最小手順と中断条件は、公開されている運用手順の[`operations.md`「バックアップと隔離復元」](../../04_Documentation/operations.md#バックアップと隔離復元)を参照してください。製品別のコマンドは、このREADMEには重複して書きません。


## テスト

```bash
cd 03_Implement/backend
export PYTHONPATH=src
pytest
```

### CE4 CLIの認証

`sui_sensemaking_api.cli` は、業務プレーンのAPI認証に `SUI_API_KEY` を使います。秘密は環境変数に置いてください。コマンドラインでキーを渡すオプションは、意図的に用意していません。プロセスの引数やシェルの履歴は、秘密を安全に渡す手段ではないためです。値が未設定なら、開放された `local-dev` の動作のままです。

### コントロールプレーンのCLI

同じモジュールは、運用者向けのコントロールプレーンのCLIも提供します。ブートストラップの資格情報は `SUI_ADMIN_API_KEY` からだけ読み取り、業務プレーンの `SUI_API_KEY` は、すべての `admin` コマンドで意図的に無視します。書き込みのコマンドは、変更のプレビューを表示し、対話的な確認を求めます。自動化では、明示的に `--yes` を付けます。

テナントのモデル許可リストを更新するときは、プレビューの読み取りで返されたリビジョンも送ります。書き込みの前に別の管理者が同じテナントを変更していた場合、CLIは新しいポリシーを上書きせず、`model_allowlist_conflict` で非ゼロの終了コードを返して終了します。

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

管理者の資格情報を、エンドユーザー向けのSPAに置かないでください。固定の資格情報は、ADR-0072のブートストラップの経路です。別に配備する管理者コンソールと、対話的なステージBのcapabilityセッションは、別の後続作業として残っています。

PostgreSQLの往復テストを実行する場合。

```bash
export SUI_DATABASE_URL="postgresql+psycopg://sui_sensemaking:sui_sensemaking@localhost:5432/sui_sensemaking"
export SUI_RUN_PG_TESTS=1
alembic upgrade head
pytest -m postgres
```

テナントRLSの実地のテスト行列は、マイグレーションの所有者とは別の、実行用のロールで実行します。実行用のロールには、対象スキーマの通常のDML権限を付与し、superuser属性と`BYPASSRLS`は付与しないでください。同じ資格情報や、RLSを迂回できるロールでは、テストが失敗します。

```bash
export SUI_DATABASE_URL="postgresql+psycopg://migration_owner:...@localhost:5432/sui_sensemaking"
export SUI_TEST_POSTGRES_RUNTIME_DATABASE_URL="postgresql+psycopg://sui_sensemaking_runtime:...@localhost:5432/sui_sensemaking"
export SUI_RUN_PG_RLS_TESTS=1
pytest -q tests/test_document_access_rls_postgres.py
```

認証フェデレーションのLevel 2（モックのSP/IdP）を実行する場合。

```bash
cd 03_Implement/backend
export PYTHONPATH=src
export SUI_LEVEL2_DIAG_DIR=.artifacts/auth-level2/legacy-federation
./scripts/run_auth_level2.sh
```

- プロバイダのプロファイルのフィクスチャ: `tests/level2/fixtures/provider_profile_*.json`, `tests/federation/profiles/*.json`
- 差異を再現する観点: ヘッダー名、claim名、groupsの形式、amr/acrの有無
- 診断のJSONは、`SUI_LEVEL2_DIAG_DIR` を明示したときだけ出力する。通常の `pytest` は、作業ツリーに診断ファイルを書き込まない。

同じ統合ハーネスを直接実行する場合。

```bash
cd 03_Implement/backend
tests/scripts/run_auth_level2.sh
```

- プロバイダのプロファイルのフィクスチャ: `tests/federation/profiles/*.json`
- 失敗時のログ: `.artifacts/auth-level2/`


## LLMプロバイダの監査メタデータ

`/ai/*` のエンドポイントでは、監査できるように、次の項目を構造化ログに記録します。

- `provider` / `provider_kind`
- `model_id`
- `requested_at`（UTCのISO 8601）
- `transport`
- `trace_id`
- `fallback_to_none`

これらは `extra={...}` で渡され、`SUI_LOG_JSON=true`（既定）のときは、JSONの1行として出力されます。OPS-OBSERV-01より前はログの設定がなく、`logging.Formatter` の既定の書式は `extra` を出力しないため、**上記の項目は実際には出力されていませんでした**。出力レベルは `SUI_LOG_LEVEL` で変更できます。すべてのリクエストには `X-Request-Id` が付き、ログ行の `requestId` フィールドと突き合わせられます。
