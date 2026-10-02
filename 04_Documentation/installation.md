# Installation

対象読者: sui-sensemakingを初めてローカルまたは検証環境で起動する利用者、運用担当者。

目的: Docker Composeを使った標準起動手順と、Dockerが使えない場合の最小代替手順を示します。

範囲外: 本番用の認証基盤、組織固有のネットワーク設定、秘密情報の配布手順。

公開区分: 初回利用者/運用者向け公開候補。現行リポジトリで確認できる起動経路を案内し、開発者向け自動テストや未実装機能の手順は正本化しません。

## 前提

- Git
- Docker Engine
- Docker Compose v2 (`docker compose` コマンド)
- ブラウザ

Dockerが使えない環境では、後述の「Dockerを使わない最小起動」を使います。

## どの手順を選ぶか

| 状況 | 推奨手順 |
| --- | --- |
| 初めて試す、または評価環境で確認する | Docker Compose |
| backend や frontend を個別に編集しながら確認する | Docker を使わない最小起動 |
| 本番相当の構成を検証する | Docker Compose を起点に、組織の認証・監視・バックアップ方針を追加 |

Docker Composeは、必要な `web`、`api`、`db` をまとめて起動します。個別起動は中身を開発・調査するときに便利ですが、端末を2つ以上使い、DBや環境変数も自分で管理します。

## Docker Compose で起動する

1. リポジトリを取得します。

```bash
git clone https://github.com/hat47x/sui-sensemaking.git
cd sui-sensemaking
```

2. デプロイ用ディレクトリへ移動します。

```bash
cd 03_Implement/deploy
```

3. 初回ビルドを含めて起動します。

```bash
docker compose up --build -d
```

`--build` はDocker imageを作り直す指定、`-d` は裏側で起動し続ける指定です。初回や依存関係が変わった後は `--build` を付けます。

標準構成は **同一ホストからだけ使う評価構成**です。`web` は `127.0.0.1` へbindされるため、`http://localhost:8080` は起動したホスト自身からだけ開けます。別端末や同じLAN上の他利用者からの接続は既定で届きません。組織内で複数端末から使う場合は、認証proxy・TLS・接続元制限を伴う別構成が必要です（`DEPLOY-NET-01`）。

4. サービス状態を確認します。

```bash
docker compose ps
docker compose logs api --tail=50
```

5. ブラウザで開きます。

```text
http://localhost:8080
```

6. APIのヘルスチェックを確認します。

```bash
curl -fsS http://localhost:8080/api/healthz
```

正常なら次の応答になります。

```json
{"status":"ok"}
```

起動とヘルスチェックが完了したら、[最初の意味ある配置を作る](getting_started.md)へ進んでください。標準サンプルだけを使い、AI無効・SafeMode ONのまま、カード、まとまり、未決、保存、共有前確認を約10分で体験できます。

## 停止する

```bash
cd 03_Implement/deploy
docker compose down
```

データベースvolumeも削除する場合だけ、次を使います。（データベースに保存したデータがすべて失われますのでご注意ください）

```bash
docker compose down -v
```

## Docker を使わない最小起動

この手順は開発・検証向けです。本番運用の代替ではありません。

### Backend

```bash
cd 03_Implement/backend
python -m venv .venv
. .venv/bin/activate
pip install -e ".[test]"
pip install alembic uvicorn
export SUI_DATABASE_URL="sqlite:///./sui_sensemaking.db"
export SUI_LLM_PROVIDER="none"
alembic upgrade head
python -m uvicorn sui_sensemaking_api.main:app --host 127.0.0.1 --port 8000
```

Windows PowerShellでは、仮想環境の有効化と環境変数の設定を次のように行います（`. .venv/bin/activate` と `export` の代わり）。

```powershell
.venv\Scripts\Activate.ps1
$env:SUI_DATABASE_URL="sqlite:///./sui_sensemaking.db"
$env:SUI_LLM_PROVIDER="none"
```

`Activate.ps1` の実行がPowerShellの実行ポリシーで拒否される場合は、`.venv\Scripts\activate.bat`（コマンドプロンプト）を使うか、現在のセッションだけ `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` を実行してから有効化します。

この手順では `pip install -e ".[test]"` によってbackend packageが開発用に登録されるため、Pythonのimport pathを個別に設定する必要はありません。

#### SQLite以外のVerified DBを直接使う場合

標準Docker ComposeはPostgreSQL用dependencyをimage構築時に導入します。backendを直接起動して別DBを使う場合は、`test`に加えて対象DBのoptional extraを同じ仮想環境へ導入してください。driverを省略したURLも内部で下表の同期driverへ正規化されますが、運用設定では明示形を推奨します。

| SQLAlchemy backend | pip extra | 検証済み同期driver |
| --- | --- | --- |
| `sqlite` | built-in | `sqlite` |
| `postgresql` | `postgres` | `postgresql+psycopg` |
| `mysql` | `mysql` | `mysql+pymysql` |
| `mariadb` | `mysql` | `mariadb+pymysql` |
| `mssql` | `mssql` | `mssql+pymssql` |
| `cockroachdb` | `cockroachdb` | `cockroachdb+psycopg` |
| `oracle` | `oracle` | `oracle+oracledb` |

たとえばMySQLなら`pip install -e ".[test,mysql]"`を実行してから`SUI_DATABASE_URL`を設定します。製品version、single-tenant／shared-schema SaaSの範囲、昇格条件は[DB対応表](../02_Architecture/database_portability.md)を確認してください。未検証driverを明示したURLは、別driverが偶然導入済みでも起動前に拒否されます。

### Frontend

別の端末で実行します。

```bash
cd 03_Implement/frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

このリポジトリには `package-lock.json` があるため、通常は `npm ci` を使います。依存関係そのものを更新する場合だけ `npm install` を使います。

ブラウザで開きます。

```text
http://127.0.0.1:4173
```

## 起動後の確認

- 画面が表示される。
- `curl -fsS http://localhost:8080/api/healthz` または `curl -fsS http://127.0.0.1:8000/healthz` が成功する。
- 新規ドキュメントを作成し、再読み込み後も内容が残る。
- 既定では `SUI_LLM_PROVIDER=none` のため、外部LLMとデータを共有しない。

画面が正常に開くと、まず「作業を開始」パネルで、新しい文書、サンプル、手元の `document.json`、レビューパックの入口を選べます。ここでSafeModeがONであることも確認します。

![作業開始パネル](assets/screenshots/start-document-entry.png)

画面が正常に開くと、次のようにSafeMode、表示モード、共有と再現、キャンバス、右側の操作パネルが同じ画面内に表示されます。最初の確認では、サンプル文書または新規文書を使い、秘密情報や実データを入力しない状態で確認してください。

![起動後の標準画面](assets/screenshots/app-canvas-overview.png)

`curl` はHTTPの接続先が応答するか確認するコマンドです。`curl` が使えない場合は、ブラウザで `http://localhost:8080/api/healthz` を開いても確認できます。

## よくある問題

### `docker: command not found`

Docker EngineとDocker Compose v2をインストールしてください。Dockerを使えない場合は「Dockerを使わない最小起動」を使います。

### `permission denied while trying to connect to the Docker API at unix:///var/run/docker.sock`

これはDockerfileやファイル配置の問題ではなく、Dockerデーモン（ソケット）への接続権限がない状態です。`docker compose up --build` はイメージをビルドする前のデーモン接続の段階で失敗します。同時に表示される `unable to get image 'deploy-api'` は異常なimage名ではなく、「Composeのプロジェクト名（composeファイルのあるディレクトリ名 `deploy`）＋ サービス名 `api`」という既定の命名で、デーモンへ接続できずにimage情報を取得できなかったことを示しています。利用環境に応じて次を確認します。

- Docker Desktop（Windows / macOS、WSL2を含む）: Docker Desktopが起動しているか確認します。WSL2上で実行している場合は、Docker Desktopの `Settings` → `Resources` → `WSL Integration` で対象のディストリビューションを有効化し、シェルを開き直してから再試行します。
- Linux（Docker Engineを直接利用）: 実行ユーザーを `docker` グループに追加します。

  ```bash
  sudo usermod -aG docker $USER
  ```

  追加後はログインし直すか、`newgrp docker` を実行してから再試行します。デーモンが停止している場合は `sudo systemctl start docker` で起動します。一時的に確認するだけであれば `sudo docker compose up --build -d` でも実行できます。

### `password authentication failed for user "sui_sensemaking"`

`docker compose logs api` に次のようなエラーが出て、APIが起動できず、`alembic upgrade head` やDB接続の段階で失敗する状態です。

```text
sqlalchemy.exc.OperationalError: (psycopg.OperationalError) connection failed:
connection to server at "172.19.0.2", port 5432 failed: FATAL:  password authentication failed for user "sui_sensemaking"
```

`db` サービスは起動して `docker compose ps` 上はhealthyに見えることがあります。これは `db` のhealthcheckが `pg_isready` を使っており、サーバーが接続を受け付けるかだけを確認し、パスワード認証までは検証しないためです。そのため `db` がhealthyでもAPIからの認証だけが失敗します。

この症状には主に2つの原因があります。まず次のコマンドで切り分けます。

```bash
# シェルに SUI_* が export されていないか（compose の既定値を上書きします）
env | grep -i sui_sensemaking

# compose が実際に解決している値（db 側パスワードと、API 側 URL 内のパスワードが一致するか）
cd 03_Implement/deploy
docker compose config | grep -iE 'POSTGRES_PASSWORD|POSTGRES_USER|SUI_DATABASE_URL'
```

**原因A: シェルに残った `SUI_*` 環境変数がcomposeの既定値を上書きしている**

`SUI_POSTGRES_PASSWORD` や `SUI_DATABASE_URL` がシェルにexportされていると、`db` の初期化パスワードとAPIが送るパスワードが食い違い、この認証失敗が起きます。よくあるのは、同じシェルで「Dockerを使わない最小起動」の `export SUI_...` を実行したまま `docker compose` を起動した場合です。この場合は **`docker compose down -v` では解消しません**（環境変数が残っているため、volumeを作り直しても同じ食い違いが再発します）。`env | grep -i sui_sensemaking` で出た変数を解除してから起動し直します。

```bash
unset SUI_DATABASE_URL SUI_POSTGRES_PASSWORD SUI_POSTGRES_USER SUI_POSTGRES_DB
cd 03_Implement/deploy
docker compose down -v
docker compose up --build -d
```

独自の認証情報を使いたい場合は、解除する代わりに `db` 側の `SUI_POSTGRES_PASSWORD` とAPI側の `SUI_DATABASE_URL` のパスワードを一致させてください（本リポジトリのcomposeは、`SUI_POSTGRES_PASSWORD` だけを設定すれば既定値どうしが一致するよう構成済みです。ただし `SUI_DATABASE_URL` を別値で設定するとそちらが優先されます）。

**原因B: 過去に別の認証情報で初期化されたvolume `sui_sensemaking_pgdata` が残っている**

PostgreSQLはvolumeが空のときの初回起動でのみ `POSTGRES_USER` / `POSTGRES_PASSWORD` を反映します。一度初期化されたvolumeが残っていると、設定を変えても既存の認証情報は更新されません。`docker compose config` 上はdbとAPIのパスワードが一致して見えても、volume内に古い認証情報が残っていればこの症状が出ます。

注意: `docker compose down -v` でもvolumeを削除できますが、コンテナが使用中などの理由で削除されず、`down -v` 後も `docker volume ls` にvolumeが残ることがあります。確実に消すため、明示的に削除して確認してから起動し直します（volume名は `<project>_sui_sensemaking_pgdata`。標準手順ではproject名が `deploy` のため `deploy_sui_sensemaking_pgdata`。実際の名前は `docker volume ls` で確認）。

```bash
cd 03_Implement/deploy
docker compose down                       # コンテナを止めて volume を解放
docker volume rm deploy_sui_sensemaking_pgdata   # volume を明示的に削除
docker volume ls | grep pgdata            # 何も表示されない（消えた）ことを確認してから次へ
docker compose up --build -d
```

`volume is in use` で失敗する場合は、`docker compose down --remove-orphans` で残存コンテナを止めてから再実行します。

正しく初期化し直せたかはdbのログで確認できます。

```bash
docker compose logs db | grep -iE 'initdb|skipping initialization|ready to accept'
```

`Skipping initialization` と出る場合はまだ古いvolumeが使われています（初期化されていません）。新しい起動で `initdb` や `ready to accept connections` が出れば、現在の認証情報で初期化できています。

volumeを削除すると保存済みのドキュメントもすべて消えます。実行前に必要なドキュメントをexportしてください。検証環境で実データを入れていない場合はそのまま実行して問題ありません。設定の詳細は [configuration.md](configuration.md) を参照してください。

### `port is already allocated`

`SUI_WEB_PORT` を変えて起動します。

```bash
SUI_WEB_PORT=8081 docker compose up --build -d
```

### API が 401 を返す

`SUI_API_KEY` を設定している環境では、`/healthz` 以外のAPIに `X-API-Key` ヘッダーが必要です。詳しくは [configuration.md](configuration.md) を参照してください。

なお、ブラウザで動く同梱の画面（SPA）は `X-API-Key` を付与しません。そのため `SUI_API_KEY` を設定すると、画面からの読み込み・保存はすべて401になります。ブラウザでの動作検証では `SUI_API_KEY` を未設定（既定）にしてください。APIキーは `curl` などのプログラムからのアクセス保護を想定しており、ブラウザ配信を保護する場合は前段に認証proxyを置きます（[security.md](security.md) 参照）。

### 画面は開くが保存できない

まずAPIとDBを確認します。

```bash
cd 03_Implement/deploy
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
docker compose logs db --tail=100
```

`SUI_API_KEY` を設定している場合は注意が必要です。ブラウザの同梱画面（SPA）は `X-API-Key` を送れないため、キーを設定すると画面からの保存・読み込みが401になります。ブラウザでの動作検証中は `SUI_API_KEY` を未設定（既定）にしてください。

## 関連文書

- [getting_started.md](getting_started.md)
- [configuration.md](configuration.md)
- [operations.md](operations.md)
- [acceptance_check.md](acceptance_check.md)
- [security.md](security.md)
