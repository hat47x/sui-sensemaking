# sui-sensemaking 利用ガイド

sui-sensemakingは、カード、島、関係線を使って情報を整理し、考えの流れを共有しやすくするためのWebアプリケーションです。このガイドは、はじめて起動する人、日常運用を担当する人、安全な共有やAI提案の扱いを確認したい人のための入口です。

このページから、目的に合う手順へ進んでください。すべてを一度に読む必要はありません。

このページから案内する文書も、SafeMode既定ON、共有・書き出し前の確認、未レビュー本文やAI提案の人間レビューという安全境界を緩めません。

起動後は「作業を開始」パネルから、新しい文書、サンプル、手元の `document.json`、レビューパックを選びます。SafeModeがONであることを確認してから作業を始めてください。

![作業開始パネル](assets/screenshots/start-document-entry.png)

![起動後の標準画面](assets/screenshots/app-canvas-overview.png)

## まず試す

はじめて使う場合は、次の順に読むと迷いにくくなります。

| やりたいこと | 読む手順 |
| --- | --- |
| まず起動したい | [導入手順](installation.md) |
| 起動後、最初のまとまりと未決を作りたい | [最初の意味ある配置を作る](getting_started.md) |
| 起動前に設定値を確認したい | [設定ガイド](configuration.md) |
| 共有や export の前に安全確認したい | [データ取り扱い](data_handling.md) |
| 日常運用の流れを知りたい | [運用手順](operations.md) |
| 変更後に画面から確認したい | [受け入れ確認](acceptance_check.md) |

## 安全に使う

sui-sensemakingは、既定ではAI機能と外部連携を有効にしない安全側の設定を使います。最初の確認では、`SUI_LLM_PROVIDER=none` のまま起動してください。これにより、保存、表示、共有前確認などの基本操作を、意図しない外部サービス連携なしで確認できます。

共有、export、AI提案、監査ログ連携を使う前には、次の文書を確認します。

| 確認したいこと | 読む手順 |
| --- | --- |
| どの情報を保存・共有してよいか | [データ取り扱い](data_handling.md) |
| SafeMode、API 保護、外部サービス連携の境界 | [セキュリティ](security.md) |
| 安全設定を変える前の判断基準 | [セキュリティ運用ガイドライン](security_operational_guidelines.md) |
| local LLM を使う場合の設定と戻し方 | [local LLM 運用](local_llm_ops_guide.md) |

![共有と再現パネルの export/share 前チェック](assets/screenshots/share-export-safe-mode.png)

## 目的別に読む

| 目的 | 読む手順 |
| --- | --- |
| 標準サンプルでカード・島・未決を安全に体験する | [最初の意味ある配置を作る](getting_started.md) |
| Docker Compose で標準起動する | [導入手順](installation.md) |
| すべての環境変数と既定値を確認する | [設定ガイド](configuration.md) |
| 起動、停止、更新、バックアップを行う | [運用手順](operations.md) |
| 画面、API、保存の問題を切り分ける | [診断と障害調査](diagnostics.md) |
| ブラウザ操作で主要機能を確認する | [受け入れ確認](acceptance_check.md) |
| 現在の画面構成と操作を一覧で確認する | [現行UIカタログ](ui_catalog.md) |
| AI 提案を採用・保留・破棄する | [AI 提案の扱い](ce2_low_risk_ai_assist.md) |
| カードや島から説明文を作る | [ナラティブ生成](narratives.md) |
| import/export や比較結果の再現性を理解する | [正規化と決定論](canonicalization.md) |
| Copilot 等の定額課金AIエージェントに依頼・応答を取り込む | [外部エージェント連携ワークフロー](external_agent_workflow.md) |

## 困ったとき

画面が開かない、保存できない、AI提案が出ない、exportの内容が想定と違うなどの問題がある場合は、まず [診断と障害調査](diagnostics.md) を確認してください。画面から再現確認をする場合は [受け入れ確認](acceptance_check.md) を使います。

問い合わせや共有用のメモを作るときは、秘密情報、API key、token、password、未加工の顧客情報を含めないでください。どこまで残してよいか迷う場合は [データ取り扱い](data_handling.md) を先に確認します。

## 最小用語集

| 用語 | 意味 |
| --- | --- |
| Docker Compose | 複数のサービスをまとめて起動する仕組みです。sui-sensemaking では `web`、`api`、`db` をまとめて起動します。 |
| API | 画面と backend がやり取りする入口です。通常は `/api/...` で呼び出されます。 |
| SafeMode | 未レビュー情報の混入や外部サービスとの共有を避けるための安全側の動作です。 |
| LLM | 文章生成や要約を行う AI モデルです。sui-sensemaking では既定で無効です。 |
| provider | LLM の接続先種別です。`none`、`local`、`large-scale` などがあります。 |
| 受け入れ確認 | 画面から実際に操作して、利用者の流れ全体を確認することです。 |
| audit | 後から確認できるように残す操作記録です。秘密情報を含めないことが前提です。 |
| export | アプリ内の情報をファイルとして取り出す操作です。共有前に秘密情報や不要な identity 情報がないか確認します。 |
| share | 他の人が閲覧できるように共有する操作です。公開範囲、SafeMode、readOnly の状態を確認してから使います。 |
| visibility | 公開範囲の意図を示す分類です。SafeMode や readOnly の拒否結果を上書きするものではありません。 |
