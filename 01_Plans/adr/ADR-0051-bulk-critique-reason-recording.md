# ADR-0051: Bulk Critique Reason Recording

- Status: Proposed
- Date: 2026-07-10
- Deciders: Maintainer and product-design review
- Scope: `03_Implement/frontend/src/ui/BulkOperationsBar.tsx`, `03_Implement/frontend/src/App.tsx`, `01_Plans/issues/done/issue-UX-WORKFLOW-01-hold-critique-action-continuity.md`
- Norms: `DOM-CRIT-06`（違和感の理由をデータとして保存するという前提がなければ、この一括記録機能は成立しない）

## Context

The bulk operation bar can already hold several selected cards and mark them with a quick critique flag. A user who wants to preserve the reason for that decision still has to leave the bulk workflow, select one card, and edit its note. That breaks the hold -> reason -> review loop and makes it easy to retain uncertainty without retaining its context.

The product model treats critique as human-authored context. It must remain available when AI is disabled, and an existing human note must never be silently replaced by a bulk action.

## Decision

Add an explicit `Add reason` action to the bulk operation bar for selections of two or more cards.

- The user enters one shared reason and explicitly saves it.
- The trimmed reason is appended to every selected card's existing critique note, separated by a blank line.
- Existing notes and authored wording are preserved; the action never replaces them.
- The update is recorded as one document/history operation.
- The action does not call an AI provider and remains available when `SUI_LLM_PROVIDER=none`.
- Escape/cancel closes the editor without changing the document. `Ctrl+Enter` or `Cmd+Enter` saves the entered reason.
- The quick critique flag remains a separate operation for users who only need a marker.

## Alternatives Considered

1. Require one-card-at-a-time editing. Rejected because it interrupts a valid bulk hold workflow.
2. Replace every selected card's note. Rejected because it would destroy authored context.
3. Store a separate group-level note. Deferred because the current data model has no group-note field and the selected cards are the visible targets of the action.
4. Generate a reason with AI. Rejected because recording human context must not depend on an optional provider.

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 一括保留後に理由を記録するには選択→1枚選択→note編集の往復が必要で、hold→reason→reviewループが破綻する。保留と理由記録を同じ選択コンテキストから到達可能にする | 機能: Escape/cancelで文書を変更せず閉じ、Ctrl+Enter/Cmd+Enterで保存。データ: 理由記録はAI providerに依存せず`SUI_LLM_PROVIDER=none`でも利用可能 |
| **データ設計** | トリムした共有理由を選択済みカードの既存critique noteへ空行区切りで追記する。既存noteと著作者の文言を保存し、一括操作で決して置き換えない。更新は1つのdocument/history操作として記録 | 業務: AIで理由を生成しない（人の文脈の記録は任意のproviderに依存させない）。機能: 既存noteを置き換える選択肢を否決 |
| **機能設計** | 2枚以上の選択で`Add reason`アクションを明示追加。quick critique flagはマーカーだけ欲しい利用者向けに別操作として維持。操作は既存history機構で可逆 | 業務: 共有理由が広すぎる場合は個別noteを後から精緻化。データ: 繰り返し使用でnoteが長くなるがUIは著作者文を重複排除しない |

## Consequences

Positive:

- Hold and reason recording are reachable from one selection context.
- The operation is reversible through the existing history mechanism.
- The UI makes the AI-independent persistence boundary explicit.

Trade-offs:

- A shared reason may be too broad for cards that need different explanations; users can refine individual notes afterward.
- Repeated use appends notes and can make a card's critique longer. The UI does not deduplicate authored text.

## Verification

- `src/ui/ux_operability_regression.test.ts` checks the reason editor contract and handler wiring.
- `src/i18n/catalog_integrity.test.ts` and `src/i18n/untranslated_key_inventory.test.ts` cover both catalogs.
- `e2e/bulk_hold_reason_flow.spec.ts` covers mouse selection, bulk hold, `Ctrl+Enter` reason save, and saved-state verification.

## Traceability

- Related issue: `01_Plans/issues/done/issue-UX-WORKFLOW-01-hold-critique-action-continuity.md`
- Related ADR: `01_Plans/adr/ADR-0040-domain-expression-first-class-strategy.md`
- ADR-0047 R-1（実使用の摩擦）: Contextに記した「hold -> reason -> review loop」の破綻は、出荷済み一括批評機能の実利用で顕在化した設計トレードオフである。
