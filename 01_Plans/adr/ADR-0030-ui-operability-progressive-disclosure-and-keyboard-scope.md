# ADR-0030: UI操作モデルの段階的開示とキーボードスコープ

- Status: Accepted
- Date: 2026-05-17
- Deciders: Project Maintainers
- Scope: `01_Plans/adr/`, `01_Plans/issues/`, `04_Documentation/acceptance_check.md`, `03_Implement/frontend/docs/e2e_testing.md`

## Context

- 2026-05-14の代表操作検証で、次の課題が確認された。
  - **到達性**: キーボードでカード選択に到達できない。
  - **フォーカススコープ**: カード/島を選択しても、選択文脈の確認領域が現在視界に現れにくい。
  - **段階的開示**: 高度機能が初期表示で密集し、主要操作の認知負荷を上げる。
  - **閉じる/復帰**: `表示` / `共有と再現` パネルを `Escape` で閉じられず、起点フォーカス復帰方針も未固定。
- これらは単発UI調整ではなく、UI操作モデル（主要対象・文脈優先・閉じる挙動・Tab優先度）の仕様化が必要である。

## Decision

sui-sensemakingのUI操作モデルとして、次を確定方針とする（仕様決定。実装は別Issueで管理）。

1. キーボード到達可能な主要操作対象
   - カード・島・主要ツールバー・右側パネル主要導線を、キーボード到達の対象として扱う。
   - 少なくとも「選択」「確認」「次操作への移動」がキーボードで成立することを必須要件にする。

2. 段階的開示（Progressive Disclosure）
   - 選択直後は「選択対象の確認・編集・レビュー導線」を文脈先頭に提示する。
   - 高度機能（差分、パッチ、文章化、診断など）は初期状態で全展開せず、明示操作で段階的に開示する。

3. Escapeで閉じる + 起点フォーカス復帰
   - `表示` / `共有と再現` の一時パネルは `Escape` で閉じる。
   - 閉じた後は、開く操作を行った起点ボタンへフォーカスを戻す。

4. Tab順序の文脈優先
   - 起動直後および選択直後の `Tab` 順序は、現在作業中の文脈（選択対象・関連操作）を優先する。
   - 文脈外の高度操作へ長距離巡回を強制しない。

### Non-goals

- 本ADRでは実装方式、コンポーネント分割、最終UIデザインを確定しない。
- 本ADRではfrontend/backend/deployのコード変更を行わない。
- 本ADRではCE/HIL/ENV/PRODUCT-VALUE/DATAストリーム要件を再定義しない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 操作モデルを仕様化：主要対象はキーボード到達必須、選択直後は文脈先頭に確認・編集・レビュー導線を提示、高度機能は段階開示、一時パネルはEscapeで閉じ起点フォーカスへ復帰、Tab順序は文脈優先。「開始→選択→表示→閉じる→復帰」のジャーニーをE2E検証軸に固定 | データ: 右側パネル情報設計の再編が必要。機能: 各IssueはUI実装依存を断つため期待DOM状態とイベント契約のみ先行定義 |
| **データ設計** | 選択直後は「選択対象の確認・編集・レビュー導線」を文脈先頭に提示し、高度機能（差分・パッチ・文章化・診断など）は初期表示で全展開せず情報階層として段階的に開示する | 業務: 閉じた後は開く操作を行った起点ボタンへフォーカスを復帰。機能: 文脈外の高度操作へ長距離巡回を強制しない |
| **機能設計** | 「選択」「確認」「次操作への移動」がキーボードで成立することを必須要件にし、Escape閉じる・起点フォーカス復帰・文脈優先Tab順序をイベント契約として固定する | データ: 高度機能は初期状態で全展開しない。業務: E2Eは「開始→選択→表示→閉じる→復帰」をトレース可能に |

## Consequences

- E2E観点の固定化
  - 「開始 → 選択 → 表示 → 閉じる → 復帰」の検証軸を固定し、UI回帰判定を明確化できる。
- 既存UIとの移行コスト
  - 右側パネル情報設計やフォーカス順序の再編が必要になり、既存利用者の操作位置が変わる可能性がある。
- リグレッション観点の明確化
  - マウス操作とキーボード操作の同等性、SafeMode/share-exportへの到達性、閉じる/戻るの可逆性を回帰対象として固定できる。

## Implementation boundary (I/F level)

- `UX-OPERABILITY-01`〜`04` は次の直列で実施する。
  1. 01: 操作動線レビューと仕様観点固定
  2. 02: カード選択のキーボード到達性
  3. 03: 選択文脈優先パネル
  4. 04: パネル閉じる/復帰フォーカス
- 各IssueはAC/DoD/Validationを仕様として定義し、実装作業は別PRで実施する。

## Traceability

- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `01_Plans/adr/ADR-0019-e2e-verification-policy-and-compose-runbook.md`
- Related: `02_Architecture/architecture.html`
- Related: `01_Plans/issues/done/issue-UX-OPERABILITY-01-pointer-keyboard-flow-review.md`
- Related: `01_Plans/issues/done/issue-UX-OPERABILITY-02-keyboard-card-selection.md`
- Related: `01_Plans/issues/done/issue-UX-OPERABILITY-03-contextual-selection-panel.md`
- Related: `01_Plans/issues/done/issue-UX-OPERABILITY-04-panel-dismissal-focus-scope.md`

## CDC (Context / Decision / Consequences)

### Context

- Stream CはUI実装に先行して、操作モデルの受入境界をI/Fレベルで固定する責務を持つ。
- 実装順が衝突すると、キーボード到達性・文脈優先表示・Escape復帰の契約が相互に破綻するため、Issueを直列化する必要がある。
- アクセシビリティ要求が曖昧な状態で実装へ進むと、後続E2Eが仕様不一致を検出できなくなる。

### Decision

- 本ADRは 仕様固定済み（Accepted） とし、実装は別PRでのみ実施する。
- 実装タスクは次の固定順で直列化する。
  1. `UX-OPERABILITY-01`: 動線レビュー
  2. `UX-OPERABILITY-02`: キーボード到達性（カード選択）
  3. `UX-OPERABILITY-03`: 文脈優先パネル
  4. `UX-OPERABILITY-04`: Escape閉じる + フォーカス復帰
- 各IssueはUI実装依存を断つため、期待DOM状態とイベント契約のみを先行定義する。
- フェイルセーフとして、アクセシビリティ要件が未確定なIssueは `Execution: Hold` とし、実装開始を禁止する。

### Consequences

- 実装PRはI/F契約との差分検証に集中でき、ストリーム間の衝突を最小化できる。
- E2Eは「開始→選択→表示→閉じる→復帰」を4 Issueの受入境界としてトレース可能になる。
- 未確定要件を残したままの実装着手を防ぎ、回帰時の責務分離（仕様vs実装）を維持できる。
