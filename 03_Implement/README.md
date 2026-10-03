# 03_Implement 実行ガイド


> 環境変数と実行パラメータの定義元は `02_Architecture/runtime_parameter_registry.md` です。本書には必要最小限だけを書きます。追加や改名のときは、先にその文書を更新してください。

## Nix開発環境（プロジェクト標準）

ローカルのツールチェーン（Node 20、Python 3.12、Ruff）は、`03_Implement/flake.nix` でまとめて管理します。バージョンは `03_Implement/flake.lock` で固定されるので、全員が同じ環境になります。フロントエンドとバックエンドのDockerfile（`node:20-alpine`、`python:3.12-slim`）とも揃えています。

1. Nixを導入します（WSL2とsystemdの環境で確認済みです。flakesが既定で有効になるDeterminate Systems版を勧めます。`sudo` のパスワード入力を求められます）。

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

公式インストーラを使う場合は、導入後にflakesを有効化します。

```bash
sh <(curl -L https://nixos.org/nix/install) --daemon
mkdir -p ~/.config/nix && printf 'experimental-features = nix-command flakes\n' >> ~/.config/nix/nix.conf
```

導入後はシェルを開き直し、`nix --version` が通ることを確認します。

2. リポジトリ直下から開発シェルに入ります（カレントはリポジトリ直下のままにします。以降の表のコマンドが `cd 03_Implement/...` を前提にしているためです）。`npm`、`python`、`ruff` はこのシェルの中で実行します。

```bash
cd /path/to/sui-sensemaking
nix develop ./03_Implement
```

flakesを有効にしないまま一時的に使う場合は、次の形でも実行できます。

```bash
nix --extra-experimental-features 'nix-command flakes' develop ./03_Implement
```

3. （任意）direnvを使うと、`03_Implement` 以下に入ったときに自動でこのシェルへ切り替わります。`.envrc` はGitで追跡しないため、テンプレートをコピーして有効にします。

```bash
cp 03_Implement/.envrc.example 03_Implement/.envrc
cd 03_Implement && direnv allow
```

補足は次のとおりです。

- Dockerはホスト側（Docker DesktopとWSL統合）で用意します。`flake.nix` には含めません。統合起動（`docker compose up --build`）は、ローカルのNodeやPythonがなくても、Dockerだけで動きます。
- WSL2から、Windowsのファイルシステム上（`/mnt/c/...`）にある本リポジトリで `npm ci` を実行すると、9p経由の展開でファイルが壊れて失敗することがあります（esbuildのinstall.jsが `SyntaxError` になるなど）。その場合は、リポジトリをWSLのネイティブなファイルシステム（例 `~/`）に置いてNode系のコマンドを実行するか、統合確認にDocker（`docker compose up --build`）を使ってください。`python`、`ruff`、`nix develop` そのものは `/mnt/c` 上でも動きます。
- WSL2側のgitから `/mnt/c/...` 上のリポジトリを参照すると、改行コード（`core.autocrlf`）やファイルモード（`core.filemode`）の違いから、実際には変更がないのに「変更あり」と多数表示されることがあります。コミットの対象を決めるのは、Windows側のgit（`git status` がcleanを示すもの）です。差分の有無はWindows側のgitで判断し、WSL側のgitの表示だけを見て `git add -A` などを実行しないでください。WSL側で常用する場合は、`git config core.autocrlf false` と `git config core.filemode false` を設定すると、誤った検出を減らせます。
- Playwright（`npx playwright test`）はブラウザの実行ファイルを別途取得する必要があり、Nixシェルだけでは動かないことがあります。E2Eは、Dockerを使うか、ブラウザを別に導入して実行してください。

## 主要コマンド（本リポジトリの標準）

| 操作 | コマンド | 用途 |
|---|---|---|
| フロントエンドの開発サーバー | `cd 03_Implement/frontend && npm run dev` | UIのローカル確認 |
| フロントエンドの検証 | `cd 03_Implement/frontend && npm run typecheck && npm run test` | 型と単体テストの確認 |
| バックエンドの検証 | `cd 03_Implement/backend && ruff check src tests && pytest` | Lintと単体テストの確認 |
| E2E（UI変更時） | `cd 03_Implement/frontend && npx playwright test` | UIを含む結合の確認 |
| 統合起動（推奨） | `cd 03_Implement/deploy && docker compose up --build` | web、api、dbを合わせた動作の確認 |

> 注: `pnpm`、`supabase`、`.kiro` 系のコマンドは、本リポジトリの標準の手順ではありません。

## フロントエンドをビルドし、Docker Composeで全体を起動する

```bash
cd 03_Implement/deploy
docker compose up --build
```

次のものが起動します。

- `db`（PostgreSQL）
- `api`（FastAPI。起動時にAlembicのマイグレーションを実行）
- `web`（Nginx。フロントエンドの `dist` を配信し、`/api` を `api` へ中継）

`http://localhost:8080` を開きます。

## 環境変数

値は、シェルの環境変数か、`03_Implement/deploy` の `.env` に設定します。

- `SUI_WEB_PORT`（既定値: `8080`）
- `SUI_DATABASE_URL`（既定値: `postgresql+asyncpg://sui_sensemaking:sui_sensemaking@db:5432/sui_sensemaking`）
- `SUI_LLM_PROVIDER`（既定値: `none`）
- `SUI_POSTGRES_DB`（既定値: `sui_sensemaking`）
- `SUI_POSTGRES_USER`（既定値: `sui_sensemaking`）
- `SUI_POSTGRES_PASSWORD`（既定値: `sui_sensemaking`）
- `SUI_FRONTEND_API_BASE`（既定値: `/api`）

sui-sensemakingが公開する環境変数は、すべて `SUI_` の接頭辞を使います。コンテナごとに別の内部名が必要な場合は、Docker Composeがこれらの値を対応付けます。

## フロントエンドを手動でビルドする（任意）

```bash
cd 03_Implement/frontend
npm ci
npm run build
```

## MCPの読み取り専用サーバー

```bash
cd 03_Implement/mcp
npm ci
npm run typecheck
npm test
```

MCPサーバーは、AIエージェントとの協働のために、読み取り専用のツール（`get_document`、`get_agent_constraints`）を提供します。CIのゲートとして、`03_Implement/mcp/**` に変更があると `mcp` ジョブ（`npm ci`、型検査、テストの順）が実行されます。ローカルの準備とCIの詳細は [`CONTRIBUTING.md`](../CONTRIBUTING.md) を参照してください。

## 静的な公開成果物（index、assets、packs）

```bash
cd 03_Implement/frontend
npm ci
npm run publish:static -- \
  --document ./tests/fixtures/worker/doc.small.json \
  --out ../deploy/public \
  --pack-id public-main
```

出力は次のとおりです。

- `03_Implement/deploy/public/index.html`
- `03_Implement/deploy/public/assets/*`
- `03_Implement/deploy/public/packs/*`

静的ファイルサーバーで配信します。

```bash
cd 03_Implement/deploy/public
python3 -m http.server 4173
```
