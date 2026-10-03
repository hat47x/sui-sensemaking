# ADR-0046: 応答性の性能予算

- Status: Accepted
- Date: 2026-06-10
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `01_Plans/`, `02_Architecture/`, `03_Implement/frontend/`

## Context

`ADR-0043`（複雑性予算）は認知負荷の歯止めを定めた。一方、計算負荷（応答性・性能）の予算は未定義である。両者は別軸であり、機能が増える局面ではどちらも根幹価値（思考を雑にしない＝待たされて思考が途切れない）に影響する。

性能に関する記述は分散し、基準として機能していない（事実）。

- `02_Architecture/architecture.html`: 「カード数が百数十程度であれば実装とデバッグが簡単」と前提を置くだけで、上限・劣化検知の基準がない。
- `02_Architecture/runtime_parameter_registry.md`: HTTP timeout（audit 2.0s / access-control 1.5s）とFailure budgetはあるが、フロントの描画・計算の性能予算はない。
- worker群（`diff` / `diagnostics` / `trace` / `bundle_zip`）で重い計算の非ブロッキング化は実装済みだが、「いつworker化すべきか」「メインスレッドを何ms以上ブロックしないか」の基準がない。
- `PRODUCT-UX-04`（大規模文書・低速環境の操作性、Done）は定性的（見切れ・待機表示の有無）で、`large_document_operability.spec.ts` も性能アサーション（時間・件数閾値）を持たない＝回帰を防ぐ定量予算がない。

質的統合法（KJ法）はカード増殖が前提であり（ROADMAP中期A/B）、DOMAIN-EXPRで状態計算（`state_filter` 等）とUI要素が増えている。応答性の予算がないと、機能追加のたびに静かに遅くなり、ある時点で「思考の道具」として使えなくなるリスクを検知できない。

個人OSS段階（`ADR-0039`）では網羅的な性能保証は過剰だが、代表規模の基準値と劣化検知の予算を最小で固定することは低コストで価値が高い。

## Decision

応答性を次の性能予算（PB）で定義し、代表規模・代表操作に対する目安値と検証方針を固定する。本ADRを、応答性予算の正本とする。

### 性能予算（PB）

数値は厳密SLAではなく劣化検知のための目安（個人OSS段階）。代表環境（デスクトップ・中位スペック）での目標。

- **PB-1 代表規模**: 「快適に使える」基準規模をカード約300・島約30とする（`02_Architecture/architecture.html` の「百数十」前提を実用域へ更新）。これを超えても壊れず、性能が緩やかに落ちるだけで済む（degrade gracefully）こと。
- **PB-2 初期表示**: 代表規模の文書を開いてから操作可能になるまでの体感を、明確な待機表示なしで数秒以内に収める。超える場合は待機状態を可視化する（`ADR-0044` UQ-5）。
- **PB-3 メインスレッドを止めないこと**: 単一の同期処理でメインスレッドを長時間（目安100ms超）ブロックしない。超える計算（diff / diagnostics / trace / bundle・大規模集計）はworkerへ逃がす。これを、worker化の判断基準として固定する。
- **PB-4 対話操作の即応**: 選択・パン/ズーム・フィルタ切替・保留トグル等の対話操作は、入力に対し即応（体感遅延なし）。重い再計算はdebounce / メモ化 / workerで分離する。
- **PB-5 劣化の可視化**: 予算を超える状態（大規模・低速）では「反応がない」ように見せず、待機・進捗・キャンセルを提示する（`ADR-0044` UQ-4/UQ-5と一体）。

### 検証方針（軽量）

- 代表規模fixture（カード約300）で `large_document_operability.spec.ts` に最小の性能アサーション（主要操作完了までの上限時間、worker利用でUIが固まらないこと）を追加する。厳密ベンチでなく回帰検知が目的。
- 性能に影響する変更（大きなループ・全カード走査・同期重処理の追加）を含むissueは、本文に1行で自己申告する。

```
性能予算: 代表規模での主要操作=<不変/改善/悪化（理由）> / メインスレッド100ms超の同期処理=<なし/あり→worker化>
```

- 「悪化」「worker化せず100ms超」を含む場合は `PRODUCT-QA-01`（性能観点）で明示確認する。

### 非目標

- 厳密なSLA・パーセンタイル目標の固定（段階・環境で変動）。
- 大規模専用のレンダリング刷新（仮想化・キャンバスWebGL化等）の即時導入（将来issue候補）。
- マイクロベンチマーク基盤の新規構築。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | KJ法はカード増殖が前提であり、応答性の予算がないと機能追加のたびに静かに遅くなり「思考の道具」として使えなくなる。待たされて思考が途切れることは根幹価値を損なう | 機能: 代表規模fixture（カード約300）で最小の性能アサーションを追加。データ: 劣化は待機・進捗・キャンセルの可視化でユーザーに示す |
| **データ設計** | 代表規模をカード約300・島約30と固定し、これを超えても壊れない（degrade gracefully）ことを保証する。`architecture.html`の「百数十」という前提を、実用的な規模へ更新する | 業務: 予算超えはUQ-4/UQ-5と一体の可視化で扱う。機能: 劣化検知のための目安値であり厳密SLAではない |
| **機能設計** | 単一同期処理でメインスレッドを100ms超ブロックしない（PB-3）。超える計算（diff/diagnostics/trace/bundle）はworkerへ逃がす。対話操作は即応、重い再計算はdebounce/メモ化/workerで分離 | 業務: 「悪化」「worker化せず100ms超」を含む変更はPRODUCT-QA-01で明示確認。データ: 性能アサーションは環境依存の絶対時間を避け回帰検知を主目的とする |

## Consequences

- 期待される効果
  - 機能追加のたびの「静かな劣化」を、代表規模の最小アサーションで検知できる。
  - worker化の判断が「重そうか」ではなく「100ms超か」で行える。
  - `ADR-0043`（認知負荷）と本ADR（計算負荷）が、根幹価値「思考を雑にしない」を二軸で守る体系になる。
- 想定される副作用と制約
  - 目安値は環境に依存し、CIの実行環境では絶対的な時間がぶれる。そのため、アサーションには余裕を持たせ、回帰の検知（相対的な悪化やworkerを使わないこと）を主目的にする。
  - 自己申告は形骸化しうる。そのため、「悪化」のときだけゲートで確認し、最小限の強制力を持たせる。
- 移行時に必要な対応
  - `02_Architecture/value_traceability.md` に「応答性の性能予算」を価値判断として追記する。
  - `02_Architecture/architecture.html` の「百数十」前提に、PB-1代表規模（約300）への参照を補足する。
  - 性能アサーション追加issue（`PERF-BUDGET-01`）をDraft候補とする（`ADR-0039` 軽量運用）。

## Traceability

- Related: `02_Architecture/architecture.html`（規模前提）, `02_Architecture/runtime_parameter_registry.md`（timeout/Failure budget）
- Related: `01_Plans/adr/ADR-0043-complexity-budget-for-cognitive-load.md`（認知負荷予算と対をなす計算負荷予算）
- Related: `01_Plans/adr/ADR-0044-ui-ux-quality-baseline-and-verification.md`（UQ-4レイアウト堅牢性・UQ-5状態可視性）
- Related: `01_Plans/issues/done/issue-PRODUCT-UX-04-responsive-large-document-operability.md`
- Related: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`（軽量運用）
- Derived-from: 2026-06-10性能記述の分布調査（規模前提のみで予算・劣化検知の基準なし）
