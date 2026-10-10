# 04_Documentationの管理用README

このREADMEは、利用者向け文書を保守する担当者のための案内です。一般公開する場所やGistの冒頭には使いません。

## 入口の役割分担

- 利用者入口: [public_index.md](public_index.md)
- 管理者入口: この `04_Documentation/README.md`
- 開発者入口: ルート [README.md](../README.md)

三つの入口は役割ごとに分け、公開する説明文書に内部の管理情報を混ぜません。


## 文書の公開範囲

| 区分 | 文書 | 公開して配布するときの扱い |
| --- | --- | --- |
| 一般の利用者向けの公開の入口 | `public_index.md` | Gistや外部への共有の先頭に使う |
| 一般の利用者と運用者向けの公開文書 | `getting_started.md`, `installation.md`, `configuration.md`, `data_handling.md`, `operations.md`, `security.md`, `security_operational_guidelines.md`, `acceptance_check.md`, `ui_catalog.md`, `diagnostics.md`, `canonicalization.md`, `ce2_low_risk_ai_assist.md`, `local_llm_ops_guide.md`, `narratives.md`, `external_agent_workflow.md`, `observability.md` | 公開の候補。実装済みの事実、安全上の境界、手動での確認に限る |
| 04の文書の保守者向け | `README.md`, `release.md` | 公開の準備とリリースの確認のための管理用。Gistの本文には、原則として含めない |
| 内部の計画と判断のログ | `../01_Plans/adr/*.md`, `../00_Prompt/*.md` | 公開する本文に入れない。必要なときも、確定した事実を利用者向けに要約してから、別に反映する |

公開範囲の判断に迷う場合は、一般の利用者が安全に操作するための確定した手順か、開発・保守・内部判断の記録かを基準に区分します。承認前の仕様、内部のissue、ADRの詳細、AIエージェントの作業ログは、公開用の案内には含めません。

公開向けの入口は、[public_index.md](public_index.md) です。公開用のGistには、利用者がsui-sensemakingを使うための説明だけを収録します。文書管理、作業ログ、issue、ADR、Gistの更新手順など、プロジェクトの管理情報は含めません。

## 公開向けの索引

[public_index.md](public_index.md) は、リポジトリの構成を知らない読み手のための案内です。次の観点だけを扱います。

- sui-sensemakingで何ができるか。
- 最初にどの手順を読めばよいか。
- 安全な既定値、データの共有、AI提案、障害調査で、何を確認するか。
- 画面例をどの文脈で見るか。

公開用GistのREADMEには、原則として`public_index.md`の内容を使います。`04_Documentation`という階層名や公開作業の手順は記載しません。

## Gistに含める文書

公開用Gistには、利用方法の説明に必要な文書だけを含めます。

| 用途 | 文書 |
| --- | --- |
| 公開入口 | [public_index.md](public_index.md) |
| 最初の価値の体験 | [getting_started.md](getting_started.md) |
| 初回起動 | [installation.md](installation.md) |
| 設定 | [configuration.md](configuration.md) |
| データの取り扱い | [data_handling.md](data_handling.md) |
| 日常運用 | [operations.md](operations.md) |
| セキュリティ | [security.md](security.md), [security_operational_guidelines.md](security_operational_guidelines.md) |
| 変更後の確認 | [acceptance_check.md](acceptance_check.md), [diagnostics.md](diagnostics.md) |
| 観測と相関 | [observability.md](observability.md) |
| 画面UIの一覧 | [ui_catalog.md](ui_catalog.md) |
| AI提案と文章化 | [ce2_low_risk_ai_assist.md](ce2_low_risk_ai_assist.md), [local_llm_ops_guide.md](local_llm_ops_guide.md), [narratives.md](narratives.md) |
| 比較と再現性 | [canonicalization.md](canonicalization.md) |
| 定額課金AIエージェント連携 | [external_agent_workflow.md](external_agent_workflow.md) |

次の文書や情報は、Gistの本文には含めません。

- このREADME。
- [assets/screenshots/README.md](assets/screenshots/README.md)。
- 公開作業のマニフェスト、コミットのハッシュ、PR、issue、ADR、内部の作業ログ。

## 画面例の管理

画面操作を説明する文書には、標準サンプル`doc_phase1_canvas`を使ったスクリーンショットを掲載します。画像は`assets/screenshots/`に保存し、画面が変わった場合は同じ操作場面で撮り直します。秘密情報、APIキー、組織固有の承認履歴、顧客のデータを含む画面は使いません。

| 掲載先 | 画面例 | 読み取りポイント |
| --- | --- | --- |
| [getting_started.md](getting_started.md) | `start-document-entry.png` | SafeModeがONの入口。以降は、現在のUIのラベルだけで再現できる一本道 |
| [installation.md](installation.md) | `app-canvas-overview.png` | 起動後に表示される標準画面、SafeMode、ヘッダー、キャンバス、右側パネル |
| [operations.md](operations.md) | `app-canvas-overview.png` | 運用の確認で見る入口と、画面、API、保存の確認の位置づけ |
| [data_handling.md](data_handling.md) | `share-export-safe-mode.png` | 共有や書き出しの前に確認する、SafeMode、公開範囲、reviewerRef、出力の範囲 |
| [security.md](security.md) | `share-export-safe-mode.png` | SafeModeと、外部サービスと共有する前に見る安全上の境界 |
| [acceptance_check.md](acceptance_check.md) | `view-controls-safe-mode.png`, `mobile-toolbar-smoke-390.png` | 手動のスモークテスト、表示の設定、狭い画面でのヘッダーの確認 |
| [ui_catalog.md](ui_catalog.md) | `ui-*.png` ほか全 UI 要素 | 利用者向けの、現在のUIの一覧。内部の設計の受け渡しの情報は含めない |
| [diagnostics.md](diagnostics.md) | `diagnostics-quality-report.png` | 診断ワーカーの実行結果、品質レポート、再現の記録の入口 |

## 文書品質のルール

- 各文書の冒頭で、対象読者と目的が分かるようにします。
- コマンドは、そのままコピーして実行できる形で示します。
- 環境に固有の秘密情報、社内のURL、承認履歴、監査ログの生のデータは含めません。
- 利用者が使う手順、判断の基準、確認の方法に集中します。
- 設計や実装の判断、プロジェクト管理の情報は、公開用のGistに含めません。

必要な前提知識が多すぎる場合、手順の成功条件が分からない場合、次に読む文書が見つからない場合は、その文書自体を改善します。

## Gistを公開する手順

この節は保守担当者向けです。公開用のGistには含めません。

1. 変更をコミットし、公開に使うコミットのハッシュを決める。
2. `public_index.md`と「Gistに含める文書」に挙げた文書だけを、公開用の一つのファイルにまとめる。
3. Gistにスクリーンショットを含め、画像へのリンクをGist内の画像ファイルへ向ける。
4. 文書間のリンクを、連結後の見出しを参照するリンクへ変更する。
5. 管理文書、作業ログ、issue、ADR、公開手順、マニフェストなど、公開対象外の情報が本文に混ざっていないことを確認する。
6. 公開のGistとして公開するか、既存のGistを更新する。
7. 公開先のURLと元のコミットのハッシュはPRや作業記録に残す。Gistの本文には記載しない。

公開する前に、次を確認します。

```bash
git status --short
git rev-parse HEAD
rg -n "ghp_\\w+|github_pat_\\w+|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|password\\s*=|token\\s*=" 04_Documentation
rg -n "04_Documentation|AGENTS.md|01_Plans|ADR-|PUBLICATION_MANIFEST|内部管理|作業ログ" <generated-public-gist.md>
```

設計の仕様の詳細を説明するために、GitHub上の `02_Architecture` の文書へリンクすることは、許容します。ただし、公開する本文は利用者の操作方法と判断材料に集中させ、プロジェクト管理や作業の記録を混ぜないでください。

更新時も同じ手順を繰り返します。公開済みのGistはURLを維持し、本文を差し替えます。
