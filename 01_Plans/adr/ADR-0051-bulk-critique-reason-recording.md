# ADR-0051: Bulk Critique Reason Recording

- Status: Proposed
- Date: 2026-07-10
- Deciders: Maintainer and product-design review
- Scope: `03_Implement/frontend/src/ui/BulkOperationsBar.tsx`, `03_Implement/frontend/src/App.tsx`, `01_Plans/issues/done/issue-UX-WORKFLOW-01-hold-critique-action-continuity.md`
- Norms: `DOM-CRIT-06`（違和感の理由をデータとして保存するという前提がなければ、この一括記録機能は成立しない）

## Context

一括操作バーでは、すでに複数のカードをまとめて保留し、クイック批評フラグを付けられる。しかし、その判断の理由を残したい利用者は、一括操作の流れをいったん離れ、カードを1枚だけ選んで、そのnoteを編集する必要がある。これでは、保留、理由、レビューという流れが途切れる。また、迷いだけが残り、その文脈が残らないという状態になりやすい。

プロダクトのモデルでは、批評を、人間が書いた文脈として扱う。AIを無効にしても使えなければならない。また、人間が書いた既存のnoteを、一括操作が黙って置き換えてはならない。

## Decision

2枚以上のカードを選択しているときに、一括操作バーへ、明示的な `Add reason` アクションを追加する。

- 利用者は、共有する理由を1つ入力し、明示的に保存する。
- 前後の空白を除いた理由を、選択した各カードの既存の批評noteの末尾へ、空行で区切って追記する。
- 既存のnoteと、書き手の文言は保持する。このアクションが、それらを置き換えることはない。
- 更新は、1つのdocument/history操作として記録する。
- このアクションは、AIプロバイダを呼ばない。`SUI_LLM_PROVIDER=none` でも使える。
- Escapeまたはキャンセルで、文書を変更せずにエディタを閉じる。`Ctrl+Enter` または `Cmd+Enter` で、入力した理由を保存する。
- クイック批評フラグは、目印だけが欲しい利用者のために、別の操作として残す。

## Alternatives Considered

1. 1枚ずつの編集を必須にする。一括で保留するという正当な作業の流れを、中断させるため、却下した。
2. 選択した全カードのnoteを置き換える。書き手が書いた文脈を、壊してしまうため、却下した。
3. グループ単位の別のnoteを保存する。現在のデータモデルには、グループnoteのフィールドがなく、選択したカードが、このアクションの目に見える対象になっているため、見送った。
4. AIで理由を生成する。人間の文脈を記録することは、任意のプロバイダに依存してはならないため、却下した。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 一括で保留した後に理由を記録するには、選択、1枚の選択、noteの編集という往復が必要になり、保留、理由、レビューのループが破綻する。保留と理由の記録を、同じ選択のコンテキストから到達できるようにする | 機能: Escapeまたはキャンセルで文書を変更せずに閉じ、Ctrl+EnterまたはCmd+Enterで保存する。データ: 理由の記録は、AIプロバイダに依存せず、`SUI_LLM_PROVIDER=none`でも利用できる |
| **データ設計** | 前後の空白を除いた共有の理由を、選択済みのカードの既存の批評noteへ、空行区切りで追記する。既存のnoteと書き手の文言を保持し、一括操作では決して置き換えない。更新は、1つのdocument/history操作として記録する | 業務: AIで理由を生成しない（人の文脈の記録を、任意のプロバイダに依存させない）。機能: 既存のnoteを置き換える選択肢は、否決した |
| **機能設計** | 2枚以上の選択で、`Add reason`アクションを明示的に追加する。クイック批評フラグは、目印だけが欲しい利用者のために、別の操作として維持する。操作は、既存のhistory機構で元に戻せる | 業務: 共有した理由が広すぎる場合は、個別のnoteを後から詳しくする。データ: 繰り返し使うとnoteが長くなるが、UIは書き手の文を重複排除しない |

## Consequences

良い点は次のとおり。

- 保留と理由の記録を、1つの選択のコンテキストから行える。
- 操作は、既存のhistory機構で元に戻せる。
- AIに依存せず保存できるという境界を、UIが明示する。

トレードオフは次のとおり。

- 共有した理由が、それぞれ違う説明が必要なカードにとっては、広すぎることがある。その場合、利用者は後から個別のnoteを詳しくできる。
- 繰り返し使うと、noteが追記されて、カードの批評が長くなることがある。UIは、書き手が書いた文を重複排除しない。

## Verification

- `src/ui/ux_operability_regression.test.ts` が、理由エディタの契約とハンドラの接続を確認する。
- `src/i18n/catalog_integrity.test.ts` と `src/i18n/untranslated_key_inventory.test.ts` が、両方のカタログを対象にする。
- `e2e/bulk_hold_reason_flow.spec.ts` が、マウスでの選択、一括保留、`Ctrl+Enter` による理由の保存、保存された状態の確認を対象にする。

## Traceability

- Related issue: `01_Plans/issues/done/issue-UX-WORKFLOW-01-hold-critique-action-continuity.md`
- Related ADR: `01_Plans/adr/ADR-0040-domain-expression-first-class-strategy.md`
- ADR-0047 R-1（実使用の摩擦）: Contextに記した「hold -> reason -> review loop」の破綻は、出荷済みの一括批評機能を実際に使って顕在化した、設計上のトレードオフである。
