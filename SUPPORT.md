# サポート

sui-sensemakingの使い方、障害の調査、セキュリティに関する連絡の入口をまとめます。まず [README.md](README.md) で目的と基本の操作を確認し、具体的な切り分けは [診断と障害調査](04_Documentation/diagnostics.md) を参照してください。

English summary: Start with the README. GitHub Issues are not active; use Discussions for questions, bug candidates, and feature ideas, and follow SECURITY.md for vulnerability reports. Never share API keys, tokens, passwords, or raw customer data.

## 相談先

| 内容 | 連絡先 | 補足 |
| --- | --- | --- |
| 使い方、設定、運用についての相談 | GitHub Discussions | 再現の手順や画面の名前があると、回答しやすくなります。 |
| バグの候補、機能の提案 | GitHub Discussions | 公開してよい情報だけで再現できる形に整理してください。実行できる作業は、メンテナが [ROADMAP.md](ROADMAP.md) に移します。 |
| セキュリティの問題、秘密情報が漏れた疑い | [SECURITY.md](SECURITY.md) | 公開のIssueには詳細を書かず、案内された手順を優先してください。 |

## 共有すると調査しやすい情報

- 発生日時、利用していたURL、ブラウザ、OS。
- 実行方法（Docker Compose、直接起動、公開環境など）。
- 最小再現手順、期待した結果、実際の結果。
- 画面に出たエラー、HTTPステータス、エラー画面に出る `requestId`、`/api/healthz`（死活確認）と `/api/readyz`（依存先の状態）の結果。
- 直前に行った操作（保存、インポート、書き出し、AI提案、共有前の確認など）。
- 秘密情報を除外したスクリーンショットやログ。
- 可能であれば、画面ヘッダーの「サポート診断バンドル」から生成した診断バンドル（`diag-bundle.v1`）。手入力より漏れが少なく、秘密情報や本文は含まれません。詳細は [diagnostics.md](04_Documentation/diagnostics.md) を参照してください。

## 共有しない情報

- APIキー、トークン、パスワード、シークレット。
- 未マスクの本文、生の顧客データ、個人情報。
- 組織固有の承認履歴、内部URL、非公開の監査ログ。
- 秘密情報を含む可能性があるファイル全文。

判断に迷うときは、まず [データ取り扱い](04_Documentation/data_handling.md) を確認してください。

GitHub Issuesは、現在運用していません。セキュリティの問題を、公開のDiscussionsに投稿しないでください。

## 障害時の最初の確認

1. 画面だけの問題か、APIも失敗しているかを分けます。
2. `curl -fsS http://localhost:8080/api/healthz` で、APIが応答するかを確認します（死活確認だけで、DBの状態は見ていません）。応答するのに動作がおかしいときは、`curl -s http://localhost:8080/api/readyz` で、DBへの到達性とスキーマの世代を確認します。
3. Docker Composeを使っているときは、 `docker compose ps` と `docker compose logs api --tail=200` を確認します。
4. 保存に失敗したときは、画面上の内容を残したまま再試行し、必要ならJSONを書き出して、変更を保管します。
5. 共有前の確認やSafeModeの警告が出ているときは、警告の内容を確認してから、操作を続けます。

詳しい切り分けの順序は [04_Documentation/diagnostics.md](04_Documentation/diagnostics.md)、日常の運用の手順は [04_Documentation/operations.md](04_Documentation/operations.md) を参照してください。
