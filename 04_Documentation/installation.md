# 導入手順

対象読者: sui-sensemakingを初めてローカルまたは検証環境で起動する利用者、運用担当者。

目的: Docker Composeを使った標準起動手順と、Dockerが使えない場合の最小代替手順を示します。

## 前提

- Git
- Docker Engine
- Docker Compose v2（`docker compose` コマンド）
- ブラウザ

Dockerが使えない環境では、後述の「Dockerを使わない最小起動」を使います。

## どの手順を選ぶか

| 状況 | 推奨手順 |
| --- | --- |
| 初めて試す、または評価環境で確認する | Docker Compose |
| backendやfrontendを個別に編集しながら確認する | Dockerを使わない最小起動 |
| 本番に近い構成を検証する | Docker Composeを起点に、組織の認証、監視、バックアップの方針を追加する |

Docker Composeは、必要な `web`、`api`、`db` をまとめて起動します。個別に起動する方法は、中身を開発したり調べたりするときに便利です。ただし、端末が2つ以上必要で、DBや環境変数も自分で管理します。

## Docker Composeで起動する

1. リポジトリを取得します。

```bash
git clone https://github.com/hat47x/sui-sensemaking.git
cd sui-sensemaking
```

2. デプロイ用のディレクトリへ移動します。

```bash
cd 03_Implement/deploy
```

3. 初回のビルドを含めて起動します。

```bash
docker compose up --build -d
```

`--build` はDockerイメージを作り直す指定、`-d` はバックグラウンドで起動し続ける指定です。初回と、依存関係が変わったあとは、`--build` を付けます。

標準の構成は、同じホストからだけ使う評価用の構成です。`web` は `127.0.0.1` にだけ公開されるため、`http://localhost:8080` を開けるのは、起動したホスト自身だけです。別の端末や、同じLANにいる他の利用者からは、既定では接続できません。組織内で複数の端末から使うときは、認証プロキシ、TLS、接続元の制限を備えた、別の構成が必要です。

4. サービスの状態を確認します。

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

正常なときは、次の応答が返ります。

```json
{"status":"ok"}
```

起動とヘルスチェックが完了したら、[最初の意味ある配置を作る](getting_started.md)へ進んでください。標準サンプルだけを使い、AI無効・SafeMode ONのまま、カード、まとまり、保留、保存、共有前確認を、約10分で体験できます。

## 停止する

```bash
cd 03_Implement/deploy
docker compose down
```

データベースのボリュームも削除するときだけ、次を使います。データベースに保存したデータは、すべて失われます。

```bash
docker compose down -v
```

## Dockerを使わない最小起動

この手順は、開発と検証のためのものです。本番の運用には使えません。

### backend

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

Windows PowerShellでは、仮想環境の有効化と環境変数の設定を、次のように行います（`. .venv/bin/activate` と `export` の代わりです）。

```powershell
.venv\Scripts\Activate.ps1
$env:SUI_DATABASE_URL="sqlite:///./sui_sensemaking.db"
$env:SUI_LLM_PROVIDER="none"
```

`Activate.ps1` の実行がPowerShellの実行ポリシーで拒否されたときは、`.venv\Scripts\activate.bat`（コマンドプロンプト）を使うか、現在のセッションだけ `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` を実行してから有効にします。

この手順では、`pip install -e ".[test]"` でbackendのパッケージが開発用に登録されるため、Pythonのimportパスを個別に設定する必要はありません。

#### SQLite以外の検証済みDBを直接使う場合

標準のDocker Composeは、PostgreSQL用の依存パッケージを、イメージを作るときに導入します。backendを直接起動して別のDBを使うときは、`test` に加えて、対象のDBの追加パッケージ（extra）を、同じ仮想環境に導入してください。ドライバを省略したURLも、内部で下の表の同期ドライバに読み替えますが、運用では、ドライバを明示した形を勧めます。

| SQLAlchemyのバックエンド | pipのextra | 検証済みの同期ドライバ |
| --- | --- | --- |
| `sqlite` | 標準で利用可 | `sqlite` |
| `postgresql` | `postgres` | `postgresql+psycopg` |
| `mysql` | `mysql` | `mysql+pymysql` |
| `mariadb` | `mysql` | `mariadb+pymysql` |
| `mssql` | `mssql` | `mssql+pymssql` |
| `cockroachdb` | `cockroachdb` | `cockroachdb+psycopg` |
| `oracle` | `oracle` | `oracle+oracledb` |

たとえばMySQLなら、`pip install -e ".[test,mysql]"` を実行してから、`SUI_DATABASE_URL` を設定します。製品のバージョン、single-tenantとshared-schema SaaSの範囲、昇格の条件は、[DB対応表](../02_Architecture/database_portability.md)を確認してください。未検証のドライバを明示したURLは、別のドライバがたまたま導入されていても、起動の前に拒否します。

### frontend

別の端末で実行します。

```bash
cd 03_Implement/frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 4173
```

このリポジトリには `package-lock.json` があるため、通常は `npm ci` を使います。依存関係そのものを更新するときだけ、`npm install` を使います。

ブラウザで開きます。

```text
http://127.0.0.1:4173
```

## 起動後の確認

- 画面が表示される。
- `curl -fsS http://localhost:8080/api/healthz` または `curl -fsS http://127.0.0.1:8000/healthz` が成功する。
- 新しい文書を作成し、再読み込みしたあとも内容が残る。
- 既定では `SUI_LLM_PROVIDER=none` のため、外部のLLMとデータを共有しない。

画面が正常に開くと、まず「作業を開始」パネルで、新しい文書、サンプル、手元の `document.json`、レビューパックの入口を選べます。ここでSafeModeがONであることも確認します。

![作業開始パネル](assets/screenshots/start-document-entry.png)

開始パネルを閉じると、次のように、SafeMode、表示モード、共有と再現、キャンバス、右側の操作パネルが、同じ画面に表示されます。最初の確認では、サンプルか新規の文書を使い、秘密情報や実際のデータを入力せずに確認してください。

![起動後の標準画面](assets/screenshots/app-canvas-overview.png)

`curl` は、HTTPの接続先が応答するかを確認するコマンドです。`curl` が使えないときは、ブラウザで `http://localhost:8080/api/healthz` を開いても確認できます。

## よくある問題

### `docker: command not found`

Docker EngineとDocker Compose v2をインストールしてください。Dockerを使えないときは、「Dockerを使わない最小起動」を使います。

### `permission denied while trying to connect to the Docker API at unix:///var/run/docker.sock`

Dockerデーモン（ソケット）へ接続する権限がない状態です。`unable to get image 'deploy-api'` も、同じ原因で表示されます。環境に応じて、次を確認します。

- Docker Desktop（WindowsとmacOS、WSL2を含む）: Docker Desktopが起動しているかを確認します。WSL2の上で実行しているときは、Docker Desktopの `Settings` → `Resources` → `WSL Integration` で、対象のディストリビューションを有効にし、シェルを開き直してから、再試行します。
- Linux（Docker Engineを直接使う場合）: 実行するユーザーを、`docker` グループに追加します。

  ```bash
  sudo usermod -aG docker $USER
  ```

  追加したあとは、ログインし直すか、`newgrp docker` を実行してから、再試行します。デーモンが止まっているときは、`sudo systemctl start docker` で起動します。一時的に確認するだけなら、`sudo docker compose up --build -d` でも実行できます。

### `password authentication failed for user "sui_sensemaking"`

`docker compose logs api` に次のようなエラーが出て、APIが起動できず、`alembic upgrade head` やDBへの接続の段階で失敗する状態です。

```text
sqlalchemy.exc.OperationalError: (psycopg.OperationalError) connection failed:
connection to server at "172.19.0.2", port 5432 failed: FATAL:  password authentication failed for user "sui_sensemaking"
```

`db` サービスは起動していて、`docker compose ps` では正常（healthy）に見えることがあります。`db` のヘルスチェックが `pg_isready` を使っていて、サーバーが接続を受け付けるかだけを確認し、パスワードの認証までは検証しないためです。そのため、`db` が正常でも、APIからの認証だけが失敗します。

この症状の原因は、主に2つあります。まず、次のコマンドで切り分けます。

```bash
# シェルに SUI_* がexportされていないか（composeの既定値を上書きします）
env | grep -i sui_sensemaking

# composeが実際に解決している値（db側のパスワードと、API側のURLに含まれるパスワードが一致するか）
cd 03_Implement/deploy
docker compose config | grep -iE 'POSTGRES_PASSWORD|POSTGRES_USER|SUI_DATABASE_URL'
```

**原因A: シェルに残った `SUI_*` の環境変数が、composeの既定値を上書きしている**

`SUI_POSTGRES_PASSWORD` や `SUI_DATABASE_URL` がシェルにexportされていると、`db` を初期化したパスワードと、APIが送るパスワードが食い違い、この認証の失敗が起きます。よくあるのは、同じシェルで「Dockerを使わない最小起動」の `export SUI_...` を実行したまま、`docker compose` を起動した場合です。この場合は、`docker compose down -v` では解消しません。環境変数が残っているため、ボリュームを作り直しても、同じ食い違いが再び起きます。`env | grep -i sui_sensemaking` で出た変数を解除してから、起動し直します。

```bash
unset SUI_DATABASE_URL SUI_POSTGRES_PASSWORD SUI_POSTGRES_USER SUI_POSTGRES_DB
cd 03_Implement/deploy
docker compose down -v
docker compose up --build -d
```

独自の認証情報を使いたいときは、解除する代わりに、`db` 側の `SUI_POSTGRES_PASSWORD` と、API側の `SUI_DATABASE_URL` のパスワードを一致させてください。このリポジトリのcomposeは、`SUI_POSTGRES_PASSWORD` だけを設定すれば、既定値どうしが一致するように作ってあります。ただし、`SUI_DATABASE_URL` を別の値で設定したときは、そちらが優先されます。

**原因B: 過去に別の認証情報で初期化されたボリューム `sui_sensemaking_pgdata` が残っている**

PostgreSQLは、ボリュームが空のときの初回の起動でだけ、`POSTGRES_USER` と `POSTGRES_PASSWORD` を反映します。一度初期化されたボリュームが残っていると、設定を変えても、既存の認証情報は更新されません。`docker compose config` ではdbとAPIのパスワードが一致して見えても、ボリュームの中に古い認証情報が残っていれば、この症状が出ます。

注意: `docker compose down -v` でもボリュームを削除できますが、コンテナが使用中などの理由で削除されず、`down -v` のあとも、`docker volume ls` にボリュームが残ることがあります。確実に消すために、明示的に削除して、消えたことを確認してから、起動し直します。ボリューム名は `<プロジェクト名>_sui_sensemaking_pgdata` です。標準の手順ではプロジェクト名が `deploy` なので、`deploy_sui_sensemaking_pgdata` になります。実際の名前は、`docker volume ls` で確認してください。

```bash
cd 03_Implement/deploy
docker compose down                       # コンテナを止めてボリュームを解放
docker volume rm deploy_sui_sensemaking_pgdata   # ボリュームを明示的に削除
docker volume ls | grep pgdata            # 何も表示されない（消えた）ことを確認してから次へ
docker compose up --build -d
```

`volume is in use` で失敗したときは、`docker compose down --remove-orphans` で残っているコンテナを止めてから、再実行します。

正しく初期化し直せたかは、dbのログで確認できます。

```bash
docker compose logs db | grep -iE 'initdb|skipping initialization|ready to accept'
```

`Skipping initialization` と出るときは、まだ古いボリュームが使われています（初期化されていません）。新しい起動で `initdb` や `ready to accept connections` が出れば、現在の認証情報で初期化できています。

ボリュームを削除すると、保存した文書もすべて消えます。実行する前に、必要な文書を書き出してください。検証環境で実際のデータを入れていなければ、そのまま実行して構いません。設定の詳細は、[configuration.md](configuration.md) を参照してください。

### `port is already allocated`

`SUI_WEB_PORT` を変えて起動します。

```bash
SUI_WEB_PORT=8081 docker compose up --build -d
```

### APIが401を返す

`SUI_API_KEY` を設定している環境では、`/healthz` 以外のAPIに、`X-API-Key` ヘッダーが必要です。詳しくは、[configuration.md](configuration.md) を参照してください。

ブラウザで動く同梱の画面（SPA）は、`X-API-Key` を付けません。そのため、`SUI_API_KEY` を設定すると、画面からの読み込みと保存は、すべて401になります。ブラウザでの動作確認では、`SUI_API_KEY` を未設定（既定）にしてください。APIキーは、`curl` などのプログラムからのアクセスを守るためのものです。ブラウザへの配信を守るときは、前段に認証プロキシを置きます（[security.md](security.md) を参照）。

### 画面は開くが保存できない

まずAPIとDBを確認します。

```bash
cd 03_Implement/deploy
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
docker compose logs db --tail=100
```

画面から保存や読み込みをすると401になるときは、上の「APIが401を返す」を確認してください。

## 関連文書

- [getting_started.md](getting_started.md)
- [configuration.md](configuration.md)
- [operations.md](operations.md)
- [acceptance_check.md](acceptance_check.md)
- [security.md](security.md)
