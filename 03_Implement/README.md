# 03_Implement run guide


> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。

## Nix 開発環境（プロジェクト標準）

ローカルのツールチェーン（Node 20 / Python 3.12 / Ruff）は、`03_Implement/flake.nix` で一元管理します。バージョンは `03_Implement/flake.lock` で固定され、全員が同一環境になります。frontend/backendのDockerfile（`node:20-alpine` / `python:3.12-slim`）と揃えています。

1. Nixを導入します（WSL2 / systemd環境で確認済み。flakesが既定で有効になるDeterminate Systems版を推奨。`sudo` のパスワード入力を求められます）。

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

公式インストーラを使う場合は、導入後にflakesを有効化します。

```bash
sh <(curl -L https://nixos.org/nix/install) --daemon
mkdir -p ~/.config/nix && printf 'experimental-features = nix-command flakes\n' >> ~/.config/nix/nix.conf
```

導入後はシェルを開き直して `nix --version` が通ることを確認します。

2. リポジトリ直下から開発シェルに入ります（カレントはリポジトリ直下のまま。以降の表のコマンドが `cd 03_Implement/...` 前提のため）。`npm` / `python` / `ruff` はこのシェル内で実行します。

```bash
cd /path/to/sui-sensemaking
nix develop ./03_Implement
```

flakesを未有効化のまま一時的に使う場合は次の形でも実行できます。

```bash
nix --extra-experimental-features 'nix-command flakes' develop ./03_Implement
```

3. （任意）direnvを使うと `03_Implement` 以下に入ったとき自動的にこのシェルへ切り替わります。`.envrc` は追跡しないため、テンプレートをコピーして有効化します。

```bash
cp 03_Implement/.envrc.example 03_Implement/.envrc
cd 03_Implement && direnv allow
```

補足は次のとおりです。

- Dockerはホスト側（Docker Desktop / WSL統合）で用意します。`flake.nix` には含めません。統合起動（`docker compose up --build`）はローカルのNode/Python不要で、Dockerだけで動きます。
- WSL2からWindowsファイルシステム上（`/mnt/c/...`）の本リポジトリで `npm ci` を実行すると、9p経由の展開でファイルが壊れて失敗することがあります（esbuildのinstall.jsが `SyntaxError` になる等）。その場合はリポジトリをWSLネイティブFS（例 `~/`）に置いてNode系コマンドを実行するか、統合確認はDocker（`docker compose up --build`）を使ってください。`python` / `ruff` や `nix develop` 自体は `/mnt/c` 上でも動作します。
- WSL2側のgitから `/mnt/c/...` 上のリポジトリを参照すると、改行コード（`core.autocrlf`）やファイルモード（`core.filemode`）の差により、実体のない「変更あり」が多数表示されることがあります（実際の変更ではありません）。コミット対象の正本はWindows側git（`git status` がcleanを示す）です。差分の有無を判断する際はWindows gitを優先し、WSL gitの表示のみで `git add -A` 等を行わないでください。WSL側で常用する場合は `git config core.autocrlf false` と `git config core.filemode false` を設定すると誤検出を抑えられます。
- Playwright（`npx playwright test`）はブラウザバイナリの追加取得が必要で、Nixシェル単体では動かないことがあります。E2EはDockerか別途のブラウザ導入で実行してください。

## 主要コマンド（本リポジトリ準拠）

| アクション | コマンド | 用途 |
|---|---|---|
| Frontend 開発サーバ | `cd 03_Implement/frontend && npm run dev` | UIのローカル確認 |
| Frontend 検証 | `cd 03_Implement/frontend && npm run typecheck && npm run test` | 型・単体テスト確認 |
| Backend 検証 | `cd 03_Implement/backend && ruff check src tests && pytest` | Lint・単体テスト確認 |
| E2E（UI変更時） | `cd 03_Implement/frontend && npx playwright test` | UIを含む結合確認 |
| 統合起動（推奨） | `cd 03_Implement/deploy && docker compose up --build` | web+api+db の統合動作確認 |

> 注: `pnpm` / `supabase` / `.kiro` 系コマンドは本リポジトリの標準手順ではありません。

## Build frontend and run full stack with Docker Compose

```bash
cd 03_Implement/deploy
docker compose up --build
```

This starts:

- `db` (PostgreSQL)
- `api` (FastAPI + Alembic migration on startup)
- `web` (Nginx serving frontend `dist` and proxying `/api` to `api`)

Open `http://localhost:8080`.

## Environment variables

Set values in shell env vars or `.env` in `03_Implement/deploy`.

- `SUI_WEB_PORT` (default: `8080`)
- `SUI_DATABASE_URL` (default: `postgresql+asyncpg://sui_sensemaking:sui_sensemaking@db:5432/sui_sensemaking`)
- `SUI_LLM_PROVIDER` (default: `none`)
- `SUI_POSTGRES_DB` (default: `sui_sensemaking`)
- `SUI_POSTGRES_USER` (default: `sui_sensemaking`)
- `SUI_POSTGRES_PASSWORD` (default: `sui_sensemaking`)
- `SUI_FRONTEND_API_BASE` (default: `/api`)

All public sui-sensemaking environment variables use the `SUI_` prefix. Docker Compose maps these values to any internal container-specific names that are needed.

## Manual frontend build (optional)

```bash
cd 03_Implement/frontend
npm ci
npm run build
```

## MCP read-only server

```bash
cd 03_Implement/mcp
npm ci
npm run typecheck
npm test
```

The MCP server provides read-only tools (`get_document`, `get_agent_constraints`) for AI agent collaboration. CI gate: `mcp` job (`npm ci` → typecheck → test) runs on `03_Implement/mcp/**` changes. Local setup and CI details: [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Static publish artifact (index/assets/packs)

```bash
cd 03_Implement/frontend
npm ci
npm run publish:static -- \
  --document ./tests/fixtures/worker/doc.small.json \
  --out ../deploy/public \
  --pack-id public-main
```

Output:

- `03_Implement/deploy/public/index.html`
- `03_Implement/deploy/public/assets/*`
- `03_Implement/deploy/public/packs/*`

Serve with a static file server:

```bash
cd 03_Implement/deploy/public
python3 -m http.server 4173
```
