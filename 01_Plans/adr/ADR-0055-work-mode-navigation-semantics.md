# ADR-0055: 作業モードのナビゲーション意味論

- Status: Accepted
- Date: 2026-07-15
- Deciders: Project Maintainers（`UX-NAV-02` の実装・検証記録に基づく受理）
- Scope: `02_Architecture/design/`, `03_Implement/frontend/src/ui/WorkModePanel.tsx`, `03_Implement/frontend/src/App.tsx`, `03_Implement/frontend/e2e/`

## 背景

作業モードは、設計要求にある5つの高度機能を同格の作業面として扱います。実装では、画面全体を覆う `role="dialog"` の中に `role="tablist"` と5つの `role="tab"` を置き、選択した作業面だけを表示します。`ADR-0052` はキャンバスとメニューの意味論に限定されるため、作業モードの判断は本ADRで管理します。

## 決定

作業モードは、次の契約で5タブ方式を採用します。

1. 作業モード全体は `role="dialog"` とし、開いた直後は選択中タブ（未設定時は先頭タブ）へフォーカスを置きます。
2. タブは差分、選択マージ、AI提案、診断、文章化の5つとします。非選択パネルは `hidden` で非表示にしますが、状態保持のためDOMからは取り除きません。
3. 左右矢印はフォーカスだけを移動し、Enter/Spaceまたはマウスクリックで選択を確定する手動確定方式（manual activation）とします。Home/Endとroving `tabIndex` を実装します。
4. タブとパネルは `aria-selected`、`aria-controls`、`aria-labelledby` で関連付けます。実際に表示するパネルとARIAの意味論を一致させます。
5. パネル内のEscapeはアクティブタブへフォーカスを戻し、タブ上のEscapeはダイアログを閉じて起動元へフォーカスを戻します。
6. 狭幅画面ではタブ列を横スクロール可能とし、選択中タブが視野内に残ることを保証します。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 5つの高度機能（差分・選択マージ・AI提案・診断・文章化）を同格の作業面として扱い、画面の重なりを抑えて各作業面の操作対象を把握しやすくする。目的の作業面への横断導線は対象タブを直接開いてフォーカスできる契約で補う | 機能: 左右矢印はフォーカス移動のみ、Enter/Space/マウスクリックで選択確定（手動確定方式）。データ: 各タブ内部の業務フロー・文言は決定しない |
| **データ設計** | 非選択パネルは`hidden`で非表示にするが、状態保持のためDOMから取り除かない。タブとパネルは`aria-selected`/`aria-controls`/`aria-labelledby`で関連付け、実際に表示するパネルとARIA意味論を一致させる | 業務: タブ切替時に入力値や非同期結果を失わない。機能: 狭幅画面ではタブ列を横スクロール可能とし選択中タブを視野内に保つ |
| **機能設計** | 作業モード全体は`role="dialog"`、開いた直後は選択中タブ（未設定時は先頭）へフォーカス。Home/Endとroving tabIndexを実装。パネル内Escapeはアクティブタブへ、タブ上Escapeはダイアログを閉じて起動元へフォーカス復帰 | 業務: AI機能・provider・SafeMode・共有/export境界は変更しない。データ: タブ方式で操作回数が増える場合は主要横断導線の直接タブ契約で補う |

## 影響

- 高度機能を同時に表示しないため、画面の重なりを抑え、各作業面の操作対象を把握しやすくします。
- 非選択パネルをDOMに保持することで、タブ切替時に入力値や非同期結果を失わないようにします。
- タブの意味論とキーボード操作を明文化し、画面実装・設計正本・E2Eの乖離を検出できます。
- タブ方式では目的の作業面へ到達するための操作回数が増える場合があります。主要な横断導線は、対象タブを直接開いてフォーカスできる契約で補います。

## 対象外

- 各タブ内部の業務フローや文言の詳細は決定しません。
- AI機能、providerの挙動、SafeMode、共有・エクスポート境界は変更しません。

## 追跡関係

- Related: `01_Plans/issues/done/issue-UI-QUALITY-A11Y-02-per-surface-aria-focus-spec.md`
- Related: `01_Plans/issues/done/issue-UI-QUALITY-A11Y-04-work-mode-navigation-semantics.md`
- Related: `01_Plans/issues/done/issue-UX-NAV-02-work-mode-tab-content-full-design.md`
- Related: `01_Plans/adr/ADR-0030-ui-operability-progressive-disclosure-and-keyboard-scope.md`
- Related: `01_Plans/adr/ADR-0031-productization-screen-information-architecture.md`
- Related: `01_Plans/adr/ADR-0052-canvas-and-menu-aria-semantics.md`
- Source: `02_Architecture/design/design-request-2026-07-round3.md`
- Source: `02_Architecture/design/design-qa-checklist.md`

## 受理チェックリスト

- [x] Status、日付、Deciders、Scopeを記載した。
- [x] 背景、決定、影響、対象外、追跡関係を記載した。
- [x] `UX-NAV-02` に実装・検証結果が記録されている。
- [x] `work_mode_tabs.spec.ts` と `a11y_axe_smoke.spec.ts` でタブ意味論、キーボード操作、Escape、狭幅表示を検証した。
- [x] ADR番号を既存の診断バンドルADRと重複しない `ADR-0055` に整理した。
