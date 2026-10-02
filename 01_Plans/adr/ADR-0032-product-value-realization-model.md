# ADR-0032: プロダクト価値実現モデル

- Status: Accepted
- Date: 2026-05-15
- Accepted-Date: 2026-05-31
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `01_Plans/`, `02_Architecture/`, `03_Implement/frontend/`, `04_Documentation/`
- Activation: コア価値ループV0–V4はactive。二軸スコアカード等の観測機構（Stream H / VR4）は `ADR-0039` によりactivation延期。Accepted化の根拠とPRODUCT-VALUE-02の循環デッドロック解消は `ADR-0040` を参照。

## Context

`ADR-0001`、`domain.md`、`ai_cognitive_externalization_requirements.md` は、sui-sensemakingが守るべき価値を強く定義している。
また `ADR-0031` は、MVPから製品化へ移るための画面情報設計を定義した。

一方で、現状の計画と設計には次の不足がある。

1. 利用者が初回利用で「価値を得た」と感じる最短経路が、受入条件として固定されていない。
2. 保留、違和感、根拠不足、反対意見が上流概念やAI IRには存在するが、日常操作の中心動線としてまだ定義が薄い。
3. ナラティブ、レビューパック、共有前確認は整備されているが、成果物が「何が分かり、何が未確定か」を読者へ伝える価値単位として十分に束ねられていない。
4. 製品化品質ゲートはUI/安全/文書/診断を扱うが、プロダクト価値そのものを検証するゲートが不足している。

このままでは、機能は増えても、sui-sensemakingの本質である「意味が揺れている状態に耐えながら、判断可能な形へ育てる」価値が利用者体験として届きにくい。

## Decision

sui-sensemakingの製品化では、次の5つの価値ループを最小モデルとして扱う。

| 価値ループ | 利用者が得る状態 | 主な設計対象 | 関連issue |
| --- | --- | --- | --- |
| V0: 開始 | 迷わず作業を始められる | 開始/文書入口、サンプル、SafeMode表示 | `PRODUCT-UX-01`, `PRODUCT-VALUE-01` |
| V1: 外在化 | メモや違和感をカードとして置ける | Raw Note、Card、Hold、Critique | `PRODUCT-VALUE-01`, `PRODUCT-VALUE-02` |
| V2: 構造化 | まとまり、関係、未整理を同時に扱える | Island、Relation、Pending、View controls | `PRODUCT-UX-02`, `PRODUCT-VALUE-02` |
| V3: レビュー | AI候補や要約を人間が採否判断できる | proposal-only、reviewState、patch + approval | `PRODUCT-VALUE-02`, `CE-*` |
| V4: 共有と学習 | 読者が確定点、保留点、根拠を理解できる | Narrative、Review Pack、SafeMode、source trace | `PRODUCT-UX-03`, `PRODUCT-VALUE-03` |

このモデルは新しい思想を追加するものではなく、既存価値を製品化の実行単位へ変換するための橋渡しである。

製品化のGo/No-Goでは、次を価値実現ゲートとして追加で確認する。

- V0/V1: 初回利用者が、サンプルまたは自分のメモから最初の意味ある配置へ到達できる。
- V2: 保留、違和感、根拠不足、反対意見が、削除や失敗ではなく作業状態として残せる。
- V3: AI提案は比較、部分採用、保留、破棄ができ、人間レビュー状態を自動昇格しない。
- V4: 共有物には、確定点だけでなく保留点、未レビュー情報、根拠への戻り方が含まれる。
- 横断: `SUI_LLM_PROVIDER=none` の既定構成でも、価値ループの主要部分が成立する。



### 価値観測モデル（Measurement Contract）

機能完了と価値実感の乖離を埋めるため、VALUE系issueの観測単位を次で固定する。

| 観測単位 | 定義 | 測定方法 | 比較軸 |
| --- | --- | --- | --- |
| Value Hypothesis | 利用者が得るべき価値状態の仮説 | Issueの `RequirementStatement` と `AcceptanceScenario` を対応付ける | 仮説未定義率（0%目標） |
| User Action | 仮説を成立させる最小操作列 | E2E手順または手動受入手順に操作列を明記する | 操作列の再現成功率 |
| Evidence Artifact | 判定に使う証拠（画面状態/出力物/ログ） | 受入条件ごとに証拠IDを定義し、再測定時に同一形式で取得する | 証拠欠落率、再測定一致率 |
| Decision Gate | Go/No-Go判定基準 | Required Gateを満たす閾値をIssue内で明文化する | Gate通過率（Go）、差し戻し率（No-Go） |

KPIは次の3条件を満たすもののみ採用する。

1. **定義可能**: 用語、母数、算出式をIssue本文で定義できる。
2. **再測定可能**: 同じ手順で同じ種類の証拠を再取得できる。
3. **比較可能**: 版間・シナリオ間で改善/劣化を比較できる。

非目標として、個人追跡、行動スコアリング、監視目的のテレメトリ拡張は行わない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 機能は増えても「意味が揺れている状態に耐えながら判断可能な形へ育てる」価値が利用者体験として届きにくい。5つの価値ループ（V0開始/V1外在化/V2構造化/V3レビュー/V4共有と学習）を最小モデルとして製品化の実行単位に変換する | 機能: 製品化のGo/No-Goで価値実現ゲートを追加確認（初回利用で最初の意味ある配置へ到達、保留/違和感が作業状態として残せる等）。データ: `SUI_LLM_PROVIDER=none`の既定構成でも価値ループの主要部分が成立 |
| **データ設計** | 保留・違和感・根拠不足・反対意見は上流概念に存在するが日常操作の中心動線として定義が薄い。V2でこれらが削除や失敗ではなく作業状態として残せることを確認 | 業務: V3でAI提案は比較・部分採用・保留・破棄ができ人間レビュー状態を自動昇格しない。機能: V4で共有物に確定点だけでなく保留点・未レビュー情報・根拠への戻り方が含まれる |
| **機能設計** | 価値観測モデル（Measurement Contract）でVALUE系issueの観測単位を固定。指標は診断・受入確認の補助に留める | 業務: 個人追跡・行動スコアリング・監視目的のテレメトリ拡張は非目標。データ: 過剰な価値測定は利用者行動の監視や不要なログ収集に寄らないようにする |

## Consequences

- 期待される効果は次のとおりです。
  - 製品化作業が「画面を整える」だけでなく、プロダクト価値の実現単位で優先順位づけできる。
  - 既存の認知外在化要件、SafeMode、review attribution、ナラティブ、共有導線が一つの利用者価値へ接続される。
  - 価値実現に足りない作業を内部issueとして管理しやすくなる。
- 想定される副作用/制約は次のとおりです。
  - UI、データ、文書、E2Eを横断するため、単一PRで完了しにくい。
  - 価値ループを過剰に測定しようとすると、利用者行動の監視や不要なログ収集に寄りやすい。
  - 指標は診断・受入確認の補助に留め、個人行動追跡やスコアリングへ転用しない。
- 移行時に必要な対応は次のとおりです。
  - `02_Architecture/value_traceability.md` に価値ループと設計境界を追加する。
  - `PRODUCT-VALUE-01` で初回価値実感の受入シナリオを定義する。
  - `PRODUCT-VALUE-02` で保留・違和感・根拠不足を日常操作へ落とす。
  - `PRODUCT-VALUE-03` で成果物化と共有後レビュー循環を定義する。

## Traceability

- Related: `00_Prompt/domain.md`
- Related: `00_Prompt/ai_cognitive_externalization_requirements.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `01_Plans/adr/ADR-0028-ai-cognitive-externalization-phase-plan.md`
- Related: `01_Plans/adr/ADR-0031-productization-screen-information-architecture.md`
- Related: `02_Architecture/value_traceability.md`
- Derived-from: `01_Plans/issues/done/issue-MVP-EXIT-01-productization-readiness.md`

---

## Stream H Finalization Pack (2026-05-20)

### Context
- Scope is constrained to `MVP-EXIT-01` and `PRODUCT-VALUE-01..03` in plan/ADR layer only.
- Implementation code changes are explicitly out of scope.
- Existing value-loop (V0..V4) is kept, and only contract-level readiness is finalized.

### Decision
1. ADR-0032 remains **Proposed** until all three value issues are Open-ready with fixed AC/DoD and measurable KPI definitions.
2. The KPI and audit contract is fixed as a two-axis scorecard:
   - **Value KPI axis**: activation, ambiguity-handling, reviewable-package completeness.
   - **Governance axis**: safeMode boundary integrity, review attribution integrity, evidence reproducibility.
3. Program gate linkage for `MVP-EXIT-01` is fixed to:
   - Input: `PRODUCT-VALUE-01..03` issue evidence summaries.
   - Output: `Go / Conditional Go / No-Go` with owner/due/re-decision metadata.
4. Non-dependency rule: This ADR finalization does not depend on other stream implementation completion; it only depends on issue-level contract completeness.

### Consequences
- Positive:
  - Product-value validation can be judged before feature completion by contract quality.
  - Auditability increases because KPI and gate evidence are explicitly bound.
- Trade-offs:
  - Additional documentation discipline is required before Open transition.
  - Proposed status must be retained until issue contract checks are all green.

### KPI / Audit Scorecard Binding
| Backlog | KPI ID | KPI name | Target | Evidence | Audit check |
| --- | --- | --- | --- | --- | --- |
| PRODUCT-VALUE-01 | PV01-K1 | first_meaningful_map_activation_rate | >= 0.90 | activation scenario record | scenario reproducibility (3/3) |
| PRODUCT-VALUE-02 | PV02-K1 | unresolved_signal_capture_rate | = 1.00 | ambiguity signal checklist | signal loss = 0 |
| PRODUCT-VALUE-03 | PV03-K1 | reviewable_package_completeness | = 1.00 | package element checklist | mandatory 6 elements present |
| MVP-EXIT-01 | EXIT-K1 | productization_gate_traceability | = 1.00 | Go/No-Go decision log | candidate/date/reviewer/decision complete |

### AC / DoD lock
- AC-L1: Each value issue has `Hypothesis -> Action -> Evidence -> Decision` chain with explicit Go/No-Go rule.
- AC-L2: Each KPI has definition, formula, data source, and re-measurement procedure.
- AC-L3: Each issue includes audit fields (`reviewer`, `date`, `artifact id`, `re-decision condition`).
- DoD-L1: Cross-stream implementation progress is not referenced as blocking condition.
- DoD-L2: Plan/ADR documents are internally consistent for terminology and gate logic.

### Verification of non-dependency
- Verified by scope inspection: no implementation file paths are newly introduced in this finalization block.
- Verified by gate logic inspection: all decisions are contract-evidence based and can run docs-only.

### Self-correction log (<=3)
1. Corrected KPI naming to align with existing issue KPI sections (`reviewable_package_completeness`).
2. Corrected gate linkage wording to use `Go / Conditional Go / No-Go` consistently.
3. Corrected DoD wording to avoid implicit dependency on other stream code delivery.

### Approval-wait package
- Package includes:
  1. This ADR finalization block.
  2. Updated issue-level AC/DoD/KPI scorecards for `MVP-EXIT-01` and `PRODUCT-VALUE-01..03`.
  3. Non-dependency verification notes.
- Approval decision requested: **Accept ADR-0032 proposed finalization for Stream H scope**.
