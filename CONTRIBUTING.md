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

- 変更の範囲を絞り、関連するテストを実行する。バックエンドは `pytest`、フロントエンドは `npm test` を使う。実行できなかった検証は、その理由と残る危険性をPR本文へ書く。
- 変更の目的・境界の記述は、PRを作成した後に埋めてよい。Draft PRは作業中の表示であり、内容が揃ったら解除して統合する。並行作業と衝突した場合は、その変更だけを保留し、他の作業を続ける。
- API、スキーマ、環境変数の契約を変えたら、`02_Architecture/` の該当する文書を、同じPRで更新する。
- SafeMode、proposal-only、`human_reviewed`、共有と書き出し、インポートに関する安全上の不変条件は、緩めない。詳しくは [`AGENTS.md`](AGENTS.md) を参照する。
- 脆弱性は、[`SECURITY.md`](SECURITY.md) に従って報告する。

## 人が確認する範囲

既定は自律とする。人が確認するのは、リポジトリの外へ取り消せない効果を出す場合だけです。具体的には、実在の機微資料や認証情報の外部送信、本番環境への配備、外部システムの削除や破壊的移行、第三者ライセンスの法的判断、対外公開です。これらに当たらない実装・文書の変更は、案を実装して検証し、版と採否の記録を残して進めます。
