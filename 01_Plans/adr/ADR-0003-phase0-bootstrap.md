# ADR-0003-phase0-bootstrap: Phase 0: プロジェクト骨格

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: `01_Plans/phase0_bootstrap.md`

## Context

`phase0_bootstrap.md` で管理していた計画・要件・受入条件を、ADR運用へ移管する。

## Decision

以下を本ADRの正本として採用する。

# Phase 0 実装ブートストラップ

このドキュメントは、`01_Plans/adr/ADR-0002-internal-roadmap.md` に定義された Phase 0（プロジェクト骨格の確立） を実行するための
実装ブートストラップ手順書です。

- 本リポジトリは 00〜04の5階層構造を厳守します
- `03_Implement` には 実装コードのみ を配置します
- 本書は 人間および生成AI（Codex等）への作業指示書です

---

## 1. Phase 0 の位置づけ

Phase 0の目的は「機能を作ること」ではありません。

- 実装を安全に進められる 足場（scaffold） を作る
- フロント・バックエンド・デプロイの
  - 起動
  - 接続
  - 最小疎通

を確認することがゴールです。

この段階では、sui-sensemaking固有の機能（KJ法・Canvas・AI）には踏み込みません。

---

## 2. 完了条件（Definition of Done）

Phase 0は、以下をすべて満たした時点で完了とします。

- [x] バックエンドが `uvicorn` で起動する
- [x] `GET /healthz` がHTTP 200を返す
- [x] フロントエンドが `npm run dev` で起動する
- [x] ブラウザにsui-sensemakingの最小UI（ヘッダ等）が表示される
- [x] （任意）`docker compose up` でAPI + DBが起動する

### 2.1 進捗記入（2026-02-23 確認）

- 状態: 完了（Done）
- 確認メモは次のとおりです。
  - backendの `/healthz` とdocs APIの回帰テストが通過。
  - frontendのテストスイートが通過し、Vite + React基盤が継続運用されている。

---

## 3. 推奨ディレクトリ構成（Phase 0 時点）

```
/project-root
  ├── 00_Prompt/
  ├── 01_Plans/
  │   ├── roadmap.md
  │   └── phase0_bootstrap.md
  ├── 02_Architecture/
  ├── 03_Implement/
  │   ├── frontend/
  │   ├── backend/
  │   └── deploy/
  └── 04_Documentation/
```

---

## 4. Backend ブートストラップ

### 4.1 技術スタック（固定）

- Python
- FastAPI
- SQLAlchemy（まだDB接続は必須でない）

### 4.2 初期ファイル構成（案）

```
03_Implement/backend/
  ├── pyproject.toml
  ├── Dockerfile
  ├── src/
  │   └── sui_sensemaking_api/
  │       ├── __init__.py
  │       ├── main.py        # FastAPI app
  │       ├── settings.py    # 環境変数ロード
  │       └── health.py      # /healthz
  └── README.md
```

### 4.3 最小実装要件

- `FastAPI()` アプリケーションが起動すること
- `GET /healthz` が常に200を返すこと
- `SUI_DATABASE_URL` / `SUI_LLM_PROVIDER` を設定ファイル経由で読めること
- DB未接続でも起動できること

> 注意：CRUD・ORM・マイグレーションは Phase 1 以降

---

## 5. Frontend ブートストラップ

### 5.1 技術スタック（固定）

- React
- Vite
- TypeScript

### 5.2 初期ファイル構成（案）

```
03_Implement/frontend/
  ├── package.json
  ├── vite.config.ts
  ├── tsconfig.json
  ├── index.html
  ├── src/
  │   ├── main.tsx
  │   ├── App.tsx
  │   └── ui/
  │       └── Shell.tsx
  └── Dockerfile
```

### 5.3 最小実装要件

- 画面に "sui-sensemaking" のタイトルが表示されること
- ローカル開発時に `GET /healthz` を叩けること（表示のみで可）

> 注意：Canvas・カード・状態管理は Phase 1 以降

---

## 6. Deploy（任意・補助）

### 6.1 位置づけ

- Phase 0では 必須ではない
- ただし「どこでも動く」ことを担保するため、
  早期に雛形を置く価値は高い

### 6.2 対象

- Docker Compose（api + db）
- webはPhase 1以降に統合してもよい

---

## 7. 作業の分割単位（AIに渡す順序）

Phase 0は、以下の単位でAIに渡すことを推奨します。

1. backend雛形（FastAPI / healthz / settings）
2. backend Dockerfile
3. frontend雛形（Vite + React）
4. frontend healthz疎通
5. （任意）docker-compose雛形

---

## 8. やらないこと（明示）

Phase 0では以下を 意図的に行いません。

- DBスキーマ定義
- API CRUD実装
- Canvas / KJ法ロジック
- AI / LLM呼び出し
- テストの充実（空でよい）

---

## 9. 次フェーズへの引き継ぎ

Phase 0完了後、次に進むのは Phase 1（Canvas MVP） です。

- 座標系（Transform）
- Card表示（DOM）
- pan / zoom

はすべてPhase 1で扱います。

本書はPhase 0専用であり、
Phase 1以降は新しい計画書を `01_Plans/` に追加します。


## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | Phase 0（プロジェクト骨格の確立）をADR-0002の内部ロードマップに定義された計画として実行する。実装ブートストラップ手順を正本として保持し、プロジェクト骨格の受入条件を固定する | 機能: 骨格確立の手順を受入条件として固定し、Phase 1以降の計画書追加の起点とする。データ: 骨格の計画・要件・受入条件を一箇所で追跡可能にする |
| **データ設計** | `phase0_bootstrap.md`の内容を本ADRへ移管し旧文書は廃止して参照を統一。既存リンクは本ADRパスへ更新 | 業務: プロジェクト骨格の確立判断をADR履歴で追跡する。機能: 下流Phase（1-3）が本ADRの骨格前提に整合させる |
| **機能設計** | 実装ブートストラップ手順を参照しやすい単位に移管し、Phase 0実行の入力として利用できるようにする | 業務: 骨格確立の受入条件を本ADRへ統一する。データ: 旧`phase0_bootstrap.md`は廃止し情報欠落なく本ADRへ移管 |

## Consequences

- 旧文書 `phase0_bootstrap.md` は廃止し、本ADRへ参照を統一する。
- 既存リンクは `01_Plans/adr/ADR-0003-phase0-bootstrap.md` へ更新する。

## Traceability

- Source: `01_Plans/phase0_bootstrap.md`
- Supersedes: `01_Plans/phase0_bootstrap.md`
