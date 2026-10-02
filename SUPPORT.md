# SUPPORT

sui-sensemakingの使い方、障害調査、セキュリティ連絡の入口をまとめます。まず [README.md](README.md) で目的と基本操作を確認し、具体的な切り分けは [診断と障害調査](04_Documentation/diagnostics.md) を参照してください。

**English summary:** Start with README for basic usage. GitHub Issues are not currently active; use Discussions for questions, bug candidates, and feature ideas, and use SECURITY.md for vulnerability reports. Never share API keys, tokens, passwords, or raw customer data.

## 相談先

| 内容 | 連絡先 | 補足 |
| --- | --- | --- |
| 使い方、設定、運用上の相談 | GitHub Discussions | 再現手順や画面名があると回答しやすくなります。 |
| バグ候補、機能提案 | GitHub Discussions | 公開してよい情報だけで再現できる形に整理してください。実行可能なActionはメンテナが内部issue memoへ移します。 |
| セキュリティ問題、秘密情報の漏えい疑い | [SECURITY.md](SECURITY.md) | 公開 Issue には詳細を書かず、案内された手順を優先してください。 |

## 共有すると調査しやすい情報

- 発生日時、利用していたURL、ブラウザ、OS。
- 実行方法（Docker Compose、直接起動、公開環境など）。
- 最小再現手順、期待した結果、実際の結果。
- 画面上のエラー、HTTP status、エラー画面に出る `requestId`、`/api/healthz`（liveness）と `/api/readyz`（依存の状態）の結果。
- 直前に行った操作（保存、import、export、AI提案、共有前確認など）。
- 秘密情報を除外したスクリーンショットやログ。
- 可能であれば、画面ヘッダーの「サポート診断バンドル」から生成した診断バンドル（`diag-bundle.v1`）。手入力より漏れが少なく、秘密情報や本文は含まれません。詳細は [diagnostics.md](04_Documentation/diagnostics.md) を参照してください。

## 共有しない情報

- API key、token、password、secret。
- 未マスクの本文、生の顧客データ、個人情報。
- 組織固有の承認履歴、内部URL、非公開の監査ログ。
- 秘密情報を含む可能性があるファイル全文。

判断に迷う場合は、まず [データ取り扱い](04_Documentation/data_handling.md) を確認してください。

GitHub Issuesは現在運用していません。セキュリティ問題を公開Discussionsへ投稿しないでください。

## 障害時の最初の確認

1. 画面だけの問題か、APIも失敗しているかを分けます。
2. `curl -fsS http://localhost:8080/api/healthz` でAPIが応答するかを確認します（livenessのみ。DBの状態は見ていません）。応答するのに動作がおかしい場合は `curl -s http://localhost:8080/api/readyz` でDB到達性とスキーマ世代を確認します。
3. Docker Composeを使っている場合は `docker compose ps` と `docker compose logs api --tail=200` を確認します。
4. 保存に失敗した場合は、画面上の内容を残したまま再試行し、必要であればJSON書き出しで変更を保全します。
5. 共有前確認やSafeModeの警告が出ている場合は、警告内容を確認してから操作を続けます。

詳しい切り分け順は [04_Documentation/diagnostics.md](04_Documentation/diagnostics.md)、日常運用の手順は [04_Documentation/operations.md](04_Documentation/operations.md) を参照してください。
