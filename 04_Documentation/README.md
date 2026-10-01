# 04_Documentation README

この README は、利用者向け文書を保守する人のための管理入口です。一般公開や Gist で最初に見せる入口には使いません。

## 入口の役割分担（固定）

- 利用者入口: [public_index.md](public_index.md)
- 管理者入口: この `04_Documentation/README.md`
- 開発者入口: ルート [README.md](../README.md)

上記3系統は混在させず、公開本文に管理情報を混入させません。


## 文書公開境界マトリクス

| 区分 | 文書 | 公開配布での扱い |
| --- | --- | --- |
| 一般利用者向け公開入口 | `public_index.md` | Gist や外部共有の先頭に使う |
| 一般利用者/運用者向け公開文書 | `getting_started.md`, `installation.md`, `configuration.md`, `data_handling.md`, `operations.md`, `security.md`, `security_operational_guidelines.md`, `acceptance_check.md`, `ui_catalog.md`, `diagnostics.md`, `canonicalization.md`, `ce2_low_risk_ai_assist.md`, `local_llm_ops_guide.md`, `narratives.md`, `external_agent_workflow.md`, `observability.md` | 公開候補。実装済み事実、安全境界、手動確認に限定する |
| 04文書保守者向け | `README.md`, `release.md` | 公開準備やリリース確認の管理用。Gist本文には原則含めない |
| 内部計画/判断ログ | `../01_Plans/adr/*.md`, `../00_Prompt/*.md` | 公開本文へ混入しない。必要な場合も利用者向けに確定済み事実へ要約してから別途反映する |

分類に迷う場合は、一般利用者が安全に操作するための確定済み手順か、開発・保守・内部判断のための記録かで判定します。未承認仕様、内部 issue、ADR の詳細、AIエージェント作業ログは公開入口へ入れません。

公開向けの入口は [public_index.md](public_index.md) です。公開用の Gist は、利用者が sui-sensemaking を使うための説明だけで構成し、文書管理、作業ログ、issue、ADR、Gist 更新手順などのプロジェクト管理情報を含めません。

## 公開向けインデックス

[public_index.md](public_index.md) は、リポジトリ構成を知らない読み手のための案内です。次の観点だけを扱います。

- sui-sensemaking で何ができるか。
- 最初にどの手順を読めばよいか。
- 安全な既定値、データ共有、AI 提案、障害調査で何を確認するか。
- 画面例をどの文脈で見るか。

公開用 Gist の README には、原則として `public_index.md` の内容を使います。`04_Documentation` という階層名や、公開作業の手順は出しません。

## Gist に含める文書

公開用 Gist は、使い方の説明に必要な文書だけを含めます。

| 用途 | 文書 |
| --- | --- |
| 公開入口 | [public_index.md](public_index.md) |
| 最初の価値体験 | [getting_started.md](getting_started.md) |
| 初回起動 | [installation.md](installation.md) |
| 設定 | [configuration.md](configuration.md) |
| データ取り扱い | [data_handling.md](data_handling.md) |
| 日常運用 | [operations.md](operations.md) |
| セキュリティ | [security.md](security.md), [security_operational_guidelines.md](security_operational_guidelines.md) |
| 変更後の確認 | [acceptance_check.md](acceptance_check.md), [diagnostics.md](diagnostics.md) |
| 観測と相関 | [observability.md](observability.md) |
| 画面UIの一覧 | [ui_catalog.md](ui_catalog.md) |
| AI 提案・文章化 | [ce2_low_risk_ai_assist.md](ce2_low_risk_ai_assist.md), [local_llm_ops_guide.md](local_llm_ops_guide.md), [narratives.md](narratives.md) |
| 比較・再現性 | [canonicalization.md](canonicalization.md) |
| 定額課金AIエージェント連携 | [external_agent_workflow.md](external_agent_workflow.md) |

次の文書や情報は、Gist の本文には含めません。

- この README。
- [assets/screenshots/README.md](assets/screenshots/README.md)。
- [e2e_testing.md](e2e_testing.md)（移転案内のみ。正本は `../03_Implement/frontend/docs/e2e_testing.md`）。
- 公開作業の manifest、commit hash、PR、issue、ADR、内部作業ログ。

## 画面例の管理

画面操作を伴う文書には、標準サンプル `doc_phase1_canvas` を使ったスクリーンショットを掲載します。画像は `assets/screenshots/` に置き、UI が変わった場合は同じ文脈で撮り直します。秘密情報、API key、組織固有の承認履歴、顧客データを含む画面は使いません。

| 掲載先 | 画面例 | 読み取りポイント |
| --- | --- | --- |
| [getting_started.md](getting_started.md) | `start-document-entry.png` | SafeMode ONの入口。以降は現行UIラベルだけで再現する一本道 |
| [installation.md](installation.md) | `app-canvas-overview.png` | 起動後に表示される標準画面、SafeMode、ヘッダー、キャンバス、右側パネル |
| [operations.md](operations.md) | `app-canvas-overview.png` | 運用確認で見る入口と、画面/API/保存確認の位置づけ |
| [data_handling.md](data_handling.md) | `share-export-safe-mode.png` | share/export 前に確認する SafeMode、visibility、reviewerRef、出力範囲 |
| [security.md](security.md) | `share-export-safe-mode.png` | SafeMode と外部サービスとの共有前に見る安全境界 |
| [acceptance_check.md](acceptance_check.md) | `view-controls-safe-mode.png`, `mobile-toolbar-smoke-390.png` | 手動 smoke test、表示設定、狭い viewport でのヘッダー確認 |
| [ui_catalog.md](ui_catalog.md) | `ui-*.png` ほか全 UI 要素 | 利用者向けの現行UI一覧。内部の設計受け渡し情報は含めない |
| [diagnostics.md](diagnostics.md) | `diagnostics-quality-report.png` | 診断 worker の実行結果、品質レポート、再現記録の入口 |

## 文書品質のルール

- 1文書は、対象読者、目的、範囲外、完了状態を本文の冒頭で分かるようにします。
- コマンドはコピーして実行できる形で示します。
- 環境固有の秘密情報、社内 URL、承認履歴、生の監査ログは含めません。
- 利用者が使う手順、判断基準、確認方法に集中します。
- 設計判断、実装判断、プロジェクト管理情報は、公開用 Gist へ含めません。

文書を読んでいて、前提知識が必要すぎる、手順の成功条件が分からない、どの文書に進めばよいか分からない場合は、その文書自体を改善対象にします。

## Gist 公開の手順

この節は保守者向けです。公開用 Gist には含めません。

1. 変更を commit し、公開に使う commit hash を決める。
2. `public_index.md` と「Gist に含める文書」だけを公開用の1ファイルへ連結する。
3. Gist へスクリーンショット画像を同梱し、画像リンクは Gist 内の画像ファイルを参照する形に置き換える。
4. 文書間リンクは、連結後の見出しへ置き換える。
5. 公開対象外の管理文書、作業ログ、issue、ADR、公開手順、manifest が本文に混ざっていないことを確認する。
6. public Gist として公開または既存 Gist を更新する。
7. 公開先 URL と元 commit hash は PR や作業記録に残し、Gist 本文には出さない。

公開前には次を確認します。

```bash
git status --short
git rev-parse HEAD
rg -n "ghp_\\w+|github_pat_\\w+|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|password\\s*=|token\\s*=" 04_Documentation
rg -n "04_Documentation|AGENTS.md|01_Plans|ADR-|PUBLICATION_MANIFEST|内部管理|作業ログ" <generated-public-gist.md>
```

設計仕様の詳細を説明するために GitHub 上の `02_Architecture` 文書へリンクすることは許容します。ただし、公開本文そのものは利用者の使い方と判断材料に集中させ、プロジェクト管理や作業記録を混ぜないでください。

更新時も同じ手順を繰り返します。公開済み Gist を更新する場合は、前回の Gist URL を保ったまま本文を差し替えます。
