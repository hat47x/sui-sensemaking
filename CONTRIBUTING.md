# 貢献の方法

1人の開発者が生成AIを用いて開発する個人OSSです。変更提案は小さなPRで歓迎します。

## 構成

- `00_Prompt/`: 概念と要件
- `01_Plans/adr/`: 長期的な設計の判断
- `02_Architecture/`: 設計と契約
- `03_Implement/`: 実装
- `04_Documentation/`: 利用者向けの文書

## ローカルでの実行

```bash
# フルスタック
cd 03_Implement/deploy && docker compose up --build

# frontend
cd 03_Implement/frontend && npm ci && npm run dev

# backend
cd 03_Implement/backend && pip install -e ".[test]" && export PYTHONPATH=src && alembic upgrade head && uvicorn sui_sensemaking_api.main:app --reload
```

詳細は [`03_Implement/README.md`](03_Implement/README.md)。

## PR

- 変更の範囲を絞り、関連するテストを実行する（backendは `pytest`、frontendは `npm test`）。
- 契約（API、スキーマ、環境変数）を変えたら、`02_Architecture/` の該当する文書を、同じPRで更新する。
- SafeMode、proposal-only、`human_reviewed`、共有と書き出し、インポートに関する安全上の不変条件は、緩めない（[`AGENTS.md`](AGENTS.md)）。
- 脆弱性は、[`SECURITY.md`](SECURITY.md) に従って報告する。
