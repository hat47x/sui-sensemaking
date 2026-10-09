# 現行UIカタログ

対象読者: sui-sensemakingの画面構成を一覧で把握したい利用者・運用者・評価担当者。

目的: 現在の画面に「どのUI要素があり、何のためにあるか」を、スクリーンショット付きで一望できるようにします。最初の操作は[最初の意味ある配置を作る](getting_started.md)、機能全体の確認は[受け入れ確認](acceptance_check.md)を参照してください。

表示条件: 日本語、`SUI_LLM_PROVIDER=none`、SafeMode ON、標準サンプル `doc_phase1_canvas`。

---

## 1. 起動 / 文書入口

起動直後に表示される「作業を開始」パネル。新規の作成、サンプル、最近の文書、`document.json` とレビューパックの取り込み、SafeModeの状態を扱う入口です。

![起動直後の作業開始パネル](assets/screenshots/start-document-entry.png)

## 2. 全体レイアウト

ヘッダー（主要ツールバー）・キャンバス作業面・右側の選択コンテキストの3分割が基本レイアウトです。

![起動後の標準画面（ヘッダー・キャンバス・右側パネル）](assets/screenshots/app-canvas-overview.png)

## 3. ヘッダー / 主要ツールバー

左から: `ファイル` / `編集` メニュー、`新規カード`、`島を作成`、`削除`、`保存`、`詳細`（AIと高度な機能の表示を切り替える）、表示モード、検索、`表示`、`共有と再現`、SafeMode状態があります。通常作業に必要な作成・島・削除・保存を先に表示し、高度な機能は`詳細`で段階的に開きます。

![ヘッダーと主要ツールバー](assets/screenshots/ui-header-toolbar.png)

## 4. キャンバス: カードとドメイン表現バッジ

カードには、主張の種別（claimType。`事実`は緑、`主張`は青、`仮説`は紫、`unknown`）、保留状態（`保留` / `棚上げ`）、違和感（タグ数または点）、未レビュー（点）のバッジが表示されます。島は領域として囲み、見出しと折りたたみ操作を持ちます。

![カードのドメイン表現バッジと島](assets/screenshots/ui-card-domain-badges.png)

## 5. カード操作

背景の右クリックで「ここに新規カード」、カードの右クリックで `カードを編集` / `関係線でつなぐ` / `島を作成` / `削除` のコンテキストメニュー。カードのダブルクリックで本文をインライン編集（Enterまたは外側クリックで確定、Escで取消、Shift+Enterで改行）。

![カードの右クリックのコンテキストメニュー](assets/screenshots/ui-card-context-menu.png)

![カードのインライン編集](assets/screenshots/ui-card-inline-edit.png)

## 6. 選択コンテキスト

カードや島を選択すると、右側パネル先頭に「現在の選択」（対象・レビュー状態・根拠・矛盾）が表示されます。判断保留（通常/保留/棚上げ）と違和感もこの文脈で確認・編集します。

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

![共有と書き出しの前のSafeModeのチェック](assets/screenshots/share-export-safe-mode.png)

## 10. 読み取り専用モード

`?readOnly=1` 等で読み取り専用にすると、編集操作が無効化され、その旨が明示されます。

![読み取り専用モード](assets/screenshots/ui-read-only-mode.png)

## 11. 価値を確認できる状態の例

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
| 390px（スマートフォン） | ![390px のヘッダーと主要操作](assets/screenshots/mobile-toolbar-smoke-390.png) |
| 768px（tablet 相当） | ![768px レイアウト](assets/screenshots/ui-responsive-768.png) |
| 960px（狭めのデスクトップ） | ![960px レイアウト](assets/screenshots/ui-responsive-960.png) |

## 関連文書

- [最初の意味ある配置を作る](getting_started.md)
- [受け入れ確認（操作手順）](acceptance_check.md)
- [導入手順](installation.md)
- [データ取り扱い](data_handling.md)
- 診断画面と品質レポート: [診断と障害調査](diagnostics.md)
