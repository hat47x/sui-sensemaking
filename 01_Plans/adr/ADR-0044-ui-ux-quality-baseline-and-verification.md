# ADR-0044: UI/UX品質基準と検証観点の統合

- Status: Accepted
- Date: 2026-06-10
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `01_Plans/`, `02_Architecture/value_traceability.md`, `03_Implement/frontend/`

## Context

UI/UXに関する設計判断は `ADR-0030`（progressive disclosure・キーボード操作範囲）と `ADR-0031`（製品化画面の情報設計）が定めている。だが両者は配置・操作の原則であり、「UI/UX品質として何を、どの水準まで担保し、どう検証するか」を横断的に定義した品質基準の正本が存在しない。

実装側の品質テストは充実しつつあるが散在している（事実）。

- i18n品質: `src/i18n/` に9ファイル（catalog_integrity / key_consistency / ui_hardcode_guard / untranslated_key_inventory / locale_conversion_guard / document_locale_invariance等）＋ `src/ui/i18n_equivalence.integration.test.ts` — 手厚い。
- 操作性: `src/ui/ux_operability_regression.test.ts`（source-string contract）＋ e2e（`canvas_focus_order` / `keyboard_release_candidate_flow` / `domain_expression_keyboard_access`）。
- レイアウト/規模: e2e `header_toolbar_layout` / `large_document_operability`。
- アクセシビリティ: `src/canvas/IslandView.accessibility.test.ts` の1ファイルのみ＝体系的でない。

この状態の問題は、(1) UI/UX品質の「正本」が無いため、新機能（DOMAIN-EXPR / PRODUCT-VALUEが並行実装中）が品質をどこまで満たせば良いか判断基準がない、(2) a11yのように薄い領域が放置されても気づけない、(3) `ADR-0043`（複雑性予算）の「悪化検知」が依拠すべき品質アンカーが点在している、ことである。

個人OSS・プレリリース段階（`ADR-0039`）では網羅的な品質保証は過剰だが、既存資産を品質次元として索引化し、薄い次元を可視化することは低コストで価値が高い。

## Decision

UI/UX品質を次の品質次元（UQ）で定義し、各次元の担保（既存テスト）と現状の充足度を `value_traceability.md` の対応表に索引化する。本ADRをUI/UX品質基準の正本とする。

### UI/UX 品質次元（UQ）

- **UQ-1操作到達性（Operability）**: 主要操作がポインタとキーボードの双方で到達でき、フォーカス順序が作業文脈を優先する。担保: `ux_operability_regression.test.ts`, e2e `canvas_focus_order` / `keyboard_release_candidate_flow`。
- **UQ-2アクセシビリティ（A11y）**: 重要な対話要素にrole / aria / ラベルが付き、スクリーンリーダで意味が取れる。担保: `IslandView.accessibility.test.ts`（現状薄い → 拡充対象）。
- **UQ-3国際化等価性（i18n）**: ja/enでキー集合が一致し、ハードコード文言が無く、未訳キーがゼロ。担保: `src/i18n/` テスト群＋ `i18n_equivalence.integration.test.ts`（充足）。
- **UQ-4レイアウト堅牢性（Responsive/Layout）**: 代表viewport・大規模文書で見切れ・重なり・フォーカス迷子が無い。担保: e2e `header_toolbar_layout` / `large_document_operability`。
- **UQ-5状態の可視性（Feedback）**: 待機・読み取り専用・SafeMode・選択対象が画面で分かる（`ADR-0031` 情報設計と接続）。担保: `safe_mode_status.test.ts`, selection-context contract。
- **UQ-6認知負荷の節度（Restraint）**: 初期表示の静けさと保留の容易さを損なわない（`ADR-0043` 複雑性予算と一体運用）。担保: 複雑性予算1行申告＋ UX回帰アンカー。

### 充足度の運用

- 各UQの現状を `value_traceability.md` に「充足 / 薄い / 未」で記録し、「薄い／未」の次元のみを改善issue化する（物量での網羅追加はしない、`ADR-0039`）。
- 現時点の判定: UQ-3（i18n）充足、UQ-1/UQ-4/UQ-5はおおむね充足、UQ-2（a11y）が薄い＝最優先の品質改善対象。
- UIを増やすissueは、触れるUQ次元を明記し、`ADR-0043` の複雑性予算1行と合わせて自己申告する。

### 非目標

- WCAG等の外部適合認証の取得。
- ビジュアルリグレッション（スクリーンショット差分）基盤の新規導入（将来issue候補に留める）。
- デザインシステムの刷新。

## Consequences

- 期待される効果は次のとおりです。
  - 「UI/UX品質をどこまで担保するか」がUQ-IDで言語化され、新機能のレビュー基準になる。
  - a11yの手薄が明示され、改善が価値起点で優先できる。
  - `ADR-0043`（複雑性予算）と `ADR-0030/0031`（配置原則）がUQを介して一つの品質体系に接続される。
- 想定される副作用/制約は次のとおりです。
  - UQと既存テストの対応がずれると二重管理 → 正本はvalue_traceabilityのUQ表とし、テストはその参照。
  - 充足度判定に主観が残る → e2eとsource-string contractの事実で裏づける。
- 移行時に必要な対応は次のとおりです。
  - `02_Architecture/value_traceability.md` にUQ-1..6対応表（担保テスト＋充足度）を追記する。
  - a11y拡充issue（`UI-QUALITY-A11Y-01`）を起票候補とする（Draft、`ADR-0039` 軽量運用）。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | UI/UX品質をUQ-1..6の6次元で定義し、既存テストを担保として`value_traceability.md`に索引化。新機能の品質レビュー基準と薄い次元の可視化を実現する。個人OSS・プレリリース段階では物量での網羅追加はしない | UIを増やすissueは触れるUQ次元を明記しADR-0043の複雑性予算と合わせて自己申告。「薄い／未」の次元のみを改善issue化しUQ-2（a11y）を最優先改善対象とする |
| **データ設計** | `value_traceability.md`のUQ対応表（担保テスト＋充足度）を正本とし、各次元を「充足 / 薄い / 未」で記録。現状はUQ-3（i18n）充足、UQ-1/UQ-4/UQ-5おおむね充足、UQ-2（a11y）は薄いと固定 | テストはUQ表の参照とし、UQと既存テストの対応がずれて二重管理にならないようにする。充足度判定の主観はe2eとsource-string contractの事実で裏づける |
| **機能設計** | 各UQに既存テストを担保として割り当て: UQ-1（`ux_operability_regression.test.ts`・e2e focus order）、UQ-2（`IslandView.accessibility.test.ts`＝拡充対象）、UQ-3（`src/i18n/`テスト群＋`i18n_equivalence`）、UQ-4（e2e layout/大規模文書）、UQ-5（`safe_mode_status.test.ts`・selection-context）、UQ-6（複雑性予算申告＋UX回帰アンカー） | ビジュアルリグレッション基盤の新規導入、WCAG等の外部適合認証の取得、デザインシステム刷新をしない。a11y拡充issue（`UI-QUALITY-A11Y-01`）をDraftとして起票候補 |

## Traceability

- Related: `01_Plans/adr/ADR-0030-ui-operability-progressive-disclosure-and-keyboard-scope.md`, `ADR-0031-productization-screen-information-architecture.md`
- Related: `01_Plans/adr/ADR-0043-complexity-budget-for-cognitive-load.md`（UQ-6と一体）, `ADR-0041-core-value-invariants-single-guard.md`（索引化パターンの踏襲）
- Related: `02_Architecture/value_traceability.md`（UQ正本対応表）
- Related: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`（軽量運用）
- Derived-from: 2026-06-10 UI/UX品質テストの分布調査（i18n手厚い・a11y手薄・横断基準なし）
