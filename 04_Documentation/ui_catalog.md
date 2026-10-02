# 現行UIカタログ / Current UI Catalog

対象読者: sui-sensemakingの画面構成を一覧で把握したい利用者・運用者・評価担当者。

目的は次のとおりです。

現在の画面に「どのUI要素があり、何のためにあるか」を、確認済みスクリーンショット付きで一望できるようにします。最初の操作は[最初の意味ある配置を作る](getting_started.md)、機能全体の確認は[受け入れ確認](acceptance_check.md)を参照してください。

範囲外: 開発者向けの設計・実装手順と、現在提供していない機能の説明。

## 確認情報

| 項目 | 値 |
| --- | --- |
| 確認対象revision | `1367740d8d03cf53bc0ad1eb09ffc45684ff51e1` |
| 最終確認日 | 2026-07-11 |
| 表示条件 | 日本語、`SUI_LLM_PROVIDER=none`、SafeMode ON、秘密情報を含まない固定サンプル |
| 画像検証 | 入口・全体5状態、価値状態6状態、UI要素12状態を再生成し、全23状態成功 |
| 公開状態 | Go。下記の再確認条件に該当した場合は、再撮影が終わるまで要再確認へ戻す |

画面ラベル、主要レイアウト、固定サンプル、locale、viewport、SafeMode/共有前確認、または撮影スクリプトが変わった場合は画像を再生成し、revision・確認日・検証結果を更新します。画像と実画面の差異を見つけた場合も、確認が終わるまで「現行」とみなしません。

## 撮影条件

- サンプル文書: `doc_phase1_canvas`（決定論的フィクスチャ。秘密情報・API key・顧客データを含まない）
- UI locale: `ja` / LLM provider: `SUI_LLM_PROVIDER=none`（AI無効・既定構成）
- 既定ビューポート: 1440×900（レスポンシブ節は390 / 768 / 960px）
- 再生成スクリプト（リポジトリ正本）は次のとおりです。
  - `03_Implement/frontend/scripts/capture_release_screenshots.mjs`（入口・全体・選択・共有・モバイル）
  - `03_Implement/frontend/scripts/capture_product_value_screenshots.mjs`（価値状態）
  - `03_Implement/frontend/scripts/capture_ui_catalog.mjs`（本書のUI要素カタログ）
- ローカルにPlaywrightブラウザ依存が無い場合はPlaywright公式Dockerイメージ内で実行します（手順は [assets/screenshots/README.md](assets/screenshots/README.md)）。

---

## 1. 起動 / 文書入口

起動直後に表示される「作業を開始」パネル。新規作成・サンプル・最近の文書・document.json / レビューパック取り込み・SafeMode状態を扱う入口です。

![起動直後の作業開始パネル](assets/screenshots/start-document-entry.png)

## 2. 全体レイアウト

ヘッダー（主要ツールバー）・キャンバス作業面・右側の選択コンテキストの3分割が基本レイアウトです。

![起動後の標準画面（ヘッダー・キャンバス・右側パネル）](assets/screenshots/app-canvas-overview.png)

## 3. ヘッダー / 主要ツールバー

左から: `ファイル` / `編集` メニュー、`新規カード`、`島を作成`、`削除`、`保存`、`詳細`（AI・高度機能の表示トグル）、表示モード、検索、`表示`、`共有と再現`、SafeMode状態があります。通常作業に必要な作成・島・削除・保存を先に表示し、高度な機能は`詳細`で段階的に開きます。

![ヘッダーと主要ツールバー](assets/screenshots/ui-header-toolbar.png)

## 4. キャンバス: カードとドメイン表現バッジ

カードにはclaimType（`事実`=緑 / `主張`=青 / `仮説`=紫 / `unknown`）、保留状態（`保留` / `未決` / `棚上げ`）、違和感（タグ数または点）、未レビュー（点）のバッジが表示されます。島は領域として囲み、見出しと折りたたみ操作を持ちます。

![カードのドメイン表現バッジと島](assets/screenshots/ui-card-domain-badges.png)

## 5. カード操作

背景の右クリックで「ここに新規カード」、カードの右クリックで `カードを編集` / `関係線でつなぐ` / `島を作成` / `削除` のコンテキストメニュー。カードのダブルクリックで本文をインライン編集（Enterまたは外側クリックで確定、Escで取消、Shift+Enterで改行）。

![カード右クリックのコンテキストメニュー](assets/screenshots/ui-card-context-menu.png)

![カードのインライン編集](assets/screenshots/ui-card-inline-edit.png)

## 6. 選択コンテキスト

カードや島を選択すると、右側パネル先頭に「現在の選択」（対象・レビュー状態・根拠・矛盾）が表示されます。判断保留（通常/保留/未決/棚上げ）と違和感もこの文脈で確認・編集します。

![カード選択時の選択コンテキスト](assets/screenshots/selection-context-card.png)

![選択コンテキストの保留状態・違和感](assets/screenshots/ui-selection-context-holdstate.png)

![島選択時の選択コンテキスト](assets/screenshots/ui-selection-context-island.png)

## 7. 作業モード面（「詳細」ON）

`詳細` をONにしたうえで `作業モード` を開くと、差分・ナラティブ・マージ候補・パッチ・AI提案などの高度機能が、選択対象の確認欄とは別の作業面に表示されます。これにより、カードや島を選択した直後の右側パネルには、選択対象の確認と基本編集だけが残ります。

![「詳細」ON 時に展開される作業モード群](assets/screenshots/ui-advanced-work-mode-panels.png)

## 8. 表示（View）コントロール

`表示` パネルでは、表示モード・視点プリセット（俯瞰/中間/詳細）・フォーカス・深さ・SafeModeを扱います。

![表示コントロール](assets/screenshots/ui-view-controls.png)

## 9. 共有前確認 / 書き出し

`共有と再現` は「何を誰と共有するか」を起点にした確認フローです。共有前チェックでSafeMode・公開範囲・未レビュー情報・出力形式・レビューパック粒度を確認してから書き出します。

![共有と再現パネルの共有前確認](assets/screenshots/ui-share-preflight.png)

![共有・書き出し前の SafeMode チェック](assets/screenshots/share-export-safe-mode.png)

## 10. 読み取り専用モード

`?readOnly=1` 等で読み取り専用にすると、編集操作が無効化され、その旨が明示されます。

![読み取り専用モード](assets/screenshots/ui-read-only-mode.png)

## 11. 価値状態の例（Product Value フィクスチャ）

代表的な利用価値の状態。最初のまとまり作成、曖昧さの保持、レビューパックのトレース・読み取り専用レビューなど。

| | |
| --- | --- |
| ![最初の島](assets/screenshots/product-value-first-island.png) | ![最初の島の共有前確認](assets/screenshots/product-value-first-island-share-preflight.png) |
| ![曖昧さの状態](assets/screenshots/product-value-ambiguity-state.png) | ![曖昧さの共有前確認](assets/screenshots/product-value-ambiguity-share-preflight.png) |
| ![レビューパックのトレース](assets/screenshots/product-value-review-pack-trace.png) | ![レビューパックの読み取り専用](assets/screenshots/product-value-review-pack-readonly.png) |

## 12. レスポンシブ / 表示幅

主要操作が画面外へ消えないこと、テキストが重ならないことを各幅で確認します。

| 幅 | 画像 |
| --- | --- |
| 390px（mobile） | ![390px のヘッダーと主要操作](assets/screenshots/mobile-toolbar-smoke-390.png) |
| 768px（tablet 相当） | ![768px レイアウト](assets/screenshots/ui-responsive-768.png) |
| 960px（狭め desktop） | ![960px レイアウト](assets/screenshots/ui-responsive-960.png) |

## 関連文書

- [最初の意味ある配置を作る](getting_started.md)
- [受け入れ確認（操作手順）](acceptance_check.md)
- [導入手順](installation.md)
- [データ取り扱い](data_handling.md)
- 診断画面と品質レポート: [診断と障害調査](diagnostics.md)
