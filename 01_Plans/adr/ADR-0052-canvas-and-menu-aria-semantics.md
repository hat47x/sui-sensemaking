# ADR-0052: キャンバス選択とメニュー内フォームのARIA意味付け

- Status: Accepted（2026-07-13、下記2方式を採択）
- Date: 2026-07-10
- Deciders: Maintainer
- Scope: `03_Implement/frontend/src/canvas/CardView.tsx`, `03_Implement/frontend/src/canvas/CanvasShell.tsx`, `03_Implement/frontend/src/ui/MenuBar.tsx`, `03_Implement/frontend/src/App.tsx`, `03_Implement/frontend/e2e/a11y_axe_smoke.spec.ts`

## Context

axeの横断スモークテストで、現在のUIに2つのARIA構造上の課題が残っている。

1. キャンバス上のカードは自由配置・ドラッグ・複数選択を行う要素だが、現在は `role="option"` を使っており、`role="listbox"` の親を持たない。
2. Fileメニューの `extraContent` に最近のドキュメント選択や操作ボタンが含まれ、`role="menu"` の直接の子としてフォーム要素が現れる。

どちらも属性を追加するだけでは解決しない。listboxは選択肢一覧の意味を、menuはコマンド一覧の意味を持つため、自由配置キャンバスやフォーム付きメニューへ機械的に適用すると、支援技術へ誤った操作モデルを伝える可能性がある。

## Decision

次の2方式を採択する。

1. **キャンバス上のカードは、独立して到達・選択する操作要素として `role="button"` + `aria-pressed` で表す。** `listbox/option`、`grid/gridcell`、`role="application"` は採用しない。自由配置・Tabによる個別到達・Enter/Spaceによる選択という現行操作モデルに、リストや二次元グリッドの矢印キー契約を持ち込まないためである。`aria-pressed` は選択集合への所属を表し、通常の起動は単一主対象化、Shift併用の起動は所属の切り替えとする。編集中はカードのルート要素からボタンの意味付けと `aria-pressed` とタブ停止位置を外し、textareaへ完全に移譲する。この操作説明、ドラッグ後のフォーカス、マウスとキーボードの等価性を、実装issueのE2Eと支援技術確認で固定する。
2. **最近のドキュメント選択等のフォームは `role="menu"` の外へ移す。** メニューにはコマンドだけを残し、`menuitem`「最近のドキュメントを開く…」から独立したdialogまたは既存の開始パネルを開く。`role="none"` ラッパーは、フォームのフォーカスとキーイベントをmenu契約から分離できないため採用しない。

採用案では、マウス操作、Tab/矢印/Enter/Space/Escape、スクリーンリーダーの読み上げ、ドラッグ中のフォーカス保持、モバイル幅の表示を同じE2E仕様で検証する。カードの複数選択と島作成の単一主対象モデルは変更しない。

## Non-goals

- このADRでは `role="application"` を導入しない。
- axeの警告を無言で無効化しない。延期するルールIDと判断理由をテスト・issueに残す。
- 見出し構造、コントラスト、フォームラベルなど、設計判断を要しないa11y課題をこのADRへ戻さない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | キャンバスのカードは自由配置・ドラッグ・複数選択を行う操作要素。支援技術へ誤った操作モデル（listboxの矢印キー契約等）を伝えるとキーボード操作を混乱させる | 機能: マウス・Tab/矢印/Enter/Space/Escape・スクリーンリーダー・ドラッグ中のフォーカス保持・モバイル幅を同じE2E仕様で検証。データ: カードの複数選択と島作成の単一主対象モデルは変更しない |
| **データ設計** | カードを`role="button"`+`aria-pressed`で表し、`aria-pressed`は選択集合への所属を表す。編集中はカードのルート要素からボタンの意味付け・aria-pressed・タブ停止位置を外しtextareaへ完全移譲 | 業務: 通常の起動は単一主対象化、Shift併用の起動は所属の切り替え。機能: listbox/option・grid/gridcell・role=applicationは採用しない |
| **機能設計** | 最近のドキュメント選択等のフォームは`role="menu"`の外へ移し、menuにはコマンドだけを残す。`menuitem`から独立dialogまたは既存開始パネルを開く。`role="none"`ラッパーは採用しない | 業務: マウス操作とキーボード操作の等価性を固定。データ: 実装完了まではaxeスモークに2つの明示的除外が残り`UI-QUALITY-A11Y-03`で解除 |

## Consequences

- 実装完了までは、axeスモークに2つの明示的な除外が残る。
- 誤ったlistbox/menu意味付けによるキーボード操作の混乱を避けられる。
- `UI-QUALITY-A11Y-03` で上記2方式を実装し、代表操作のE2Eと支援技術確認を通した後に2つのaxe除外を解除する。

## Traceability

- Related: `01_Plans/issues/done/issue-UI-QUALITY-A11Y-03-structural-aria-findings.md`
- Related: `01_Plans/issues/done/issue-UI-QUALITY-A11Y-02-per-surface-aria-focus-spec.md`
- Related: `01_Plans/adr/ADR-0030-ui-operability-progressive-disclosure-and-keyboard-scope.md`
- Related: `03_Implement/frontend/e2e/a11y_axe_smoke.spec.ts`
- Independent follow-up: `01_Plans/issues/done/issue-UX-NAV-02-work-mode-tab-content-full-design.md`

## 追記 2026-07-12: 作業モードタブの role=tablist 判断（C-5、2026-07-13分離確定）

Claude Design実装照合レビュー（拡張提案P21、2026-07-11）が作業モード面の中身について
「タブはrole=tablist、矢印キーで移動、5タブ（差分／選択マージ／AI提案／診断／文章化）」の
完全設計を提示した。作業モードタブは本ADRのキャンバスカード／メニュー内フォームとは別の
操作面であり、本ADRのAcceptedを形式的な着手条件にしない。`UI-QUALITY-A11Y-02` のC-5残課題は
実装Issue
`01_Plans/issues/done/issue-UX-NAV-02-work-mode-tab-content-full-design.md` を起票した。
`UX-NAV-02` は、タブ固有のキーボード・フォーカス・状態保持条件をIssue側で満たした時点で独立に着手できる。
