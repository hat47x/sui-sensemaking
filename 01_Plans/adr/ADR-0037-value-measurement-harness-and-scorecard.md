# ADR-0037: 価値観測ハーネスと二軸スコアカード運用

- Status: Accepted
- Date: 2026-05-31
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `01_Plans/`, `02_Architecture/value_traceability.md`, `03_Implement/frontend/e2e/`, `04_Documentation/`
- Activation: directionとしてAccepted。実ユーザー/協力者が現れるmilestoneまでactivationを延期（`ADR-0039`）。
- Derived-from: `01_Plans/adr/ADR-0036-value-to-social-goal-realization-roadmap.md`

## Context

`ADR-0032` は価値観測モデル（Value Hypothesis → User Action → Evidence Artifact → Decision Gate）と二軸スコアカード（価値KPI軸 / 統治軸）を**契約**として固定した。`PRODUCT-VALUE-01..03` も各々 KPIと `Hypothesis→Action→Evidence→Decision` 連鎖を保持している。

一方で、これらは「issueごとの記述契約」に留まり、**観測を実際に運用する成果物（再現可能なシナリオ実行手順・証拠成果物の形式・再測定手順・スコアカードの集計運用）がVR4のフェーズ成果物として存在しない**。結果として、機能完了と価値実感の乖離（`ADR-0032` Context）を埋める観測が、issue本文の宣言止まりになっている。

`ADR-0036` のVR4は、この観測を「契約」から「運用される成果物」へ接続することを要求する。

## Decision

`ADR-0032` の観測契約を運用化するため、次をVR4の観測基盤として固定する。本ADRは観測の**運用方法**を定め、個別KPIの定義は各VALUE issueを正本とする。

### 1. 価値観測ハーネス（再現可能シナリオ実行）

- 各価値ループV0–V4に対し、`Hypothesis → Action(操作列) → Evidence(証拠ID) → Decision(Go/No-Go)` を1つの再実行可能な観測単位として束ねる。
- 操作列はE2Eシナリオ名（または手動受入手順）で固定し、同一手順で同一種類の証拠を再取得できることを要件とする。
- 証拠成果物（Evidence Artifact）は `evidenceId / 取得手順 / 形式 / 保存先 / 再測定一致条件` を持つ。形式は版間比較可能な固定形式とする。

### 2. 二軸スコアカード運用

| 軸 | 観測対象 | 代表KPI（各VALUE issueを正本） | 合否の考え方 |
| --- | --- | --- | --- |
| 価値KPI軸 | 活性化 / 曖昧さ保持 / 成果物レビュー可能性 | `PV01-K1 first_meaningful_map_*`, `PV02-K1 unresolved_*`, `PV03-K1 reviewable_package_completeness` | 定義可能・再測定可能・比較可能の3条件を満たすKPIのみ採用 |
| 統治軸 | SafeMode境界 / review帰属 / 証拠再現性 | safeMode後退=0, `human_reviewed`自動昇格=0, 証拠欠落率/再測定一致率 | 後退検知時は即No-Go（緩和不可） |

- スコアカードは `MVP-EXIT-01` Program Gateと `PRODUCT-QA-01` Release Readinessの入力とし、判定式は既存の `Go / Conditional Go / No-Go` を再利用する（再発明しない）。
- 判定記録には `candidate / date / reviewer / decision / artifactId / re-decision condition` を必須とする（`ADR-0032` AC-L3準拠）。

### 3. 非目標・安全制約

- 個人追跡、行動スコアリング、監視目的のテレメトリ拡張は行わない（`ADR-0032` 非目標を継承）。
- KPIは診断・受入確認の補助に留め、利用者の評価・序列化へ転用しない。
- 観測は `SUI_LLM_PROVIDER=none` 既定構成でも実行可能であること。
- 自動でGo/No-Goを確定しない。判定は人間がDecision Queueへ記録する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 機能完了と価値実感の乖離を埋める観測がissue本文の宣言止まりになっている。価値観測ハーネス（再現可能シナリオ実行）と二軸スコアカード（価値KPI軸/統治軸）の運用をVR4の観測基盤として固定する | 機能: 各価値ループV0〜V4に`Hypothesis→Action→Evidence→Decision`を1つの再実行可能な観測単位として束ねる。データ: 判定は人間がDecision Queueへ記録し自動でGo/No-Goを確定しない |
| **データ設計** | 証拠成果物は`evidenceId/取得手順/形式/保存先/再測定一致条件`を持ち版間比較可能な固定形式とする。判定記録には`candidate/date/reviewer/decision/artifactId/re-decision condition`を必須化 | 業務: 価値KPI軸は定義可能・再測定可能・比較可能の3条件を満たすKPIのみ採用。機能: 統治軸の後退検知（safeMode後退・human_reviewed自動昇格）は即No-Goで緩和不可 |
| **機能設計** | 操作列はE2Eシナリオ名（または手動受入手順）で固定し同一手順で同一種類の証拠を再取得できることを要件とする。スコアカードはMVP-EXIT-01とPRODUCT-QA-01の入力とし判定式は既存のGo/Conditional Go/No-Goを再利用 | 業務: 個人追跡・行動スコアリング・監視目的のテレメトリ拡張は行わない。データ: 観測は`SUI_LLM_PROVIDER=none`既定構成でも実行可能 |

## Consequences

- 期待される効果は次のとおりです。
  - 「価値を実感できたか」を版間・シナリオ間で比較でき、機能完了と価値の乖離を縮小できる。
  - 監査性が上がり、Program Gate/Release判定の入力が再現可能になる。
- 想定される副作用/制約は次のとおりです。
  - 観測手順・証拠形式の整備コストが先行する。
  - 過剰計測は監視へ滑りやすいため、非監視制約の遵守を毎回確認する必要がある。
- 移行時に必要な対応は次のとおりです。
  - `VALUE-MEASURE-01`（ハーネスと証拠成果物）と `VALUE-MEASURE-02`（二軸スコアカード運用）を起票する。
  - `02_Architecture/value_traceability.md` の検証観点列へ、観測単位と証拠IDの対応を追記する。

## Traceability

- Derived-from: `01_Plans/adr/ADR-0036-value-to-social-goal-realization-roadmap.md`
- Related: `01_Plans/adr/ADR-0032-product-value-realization-model.md`
- Related: `01_Plans/issues/done/issue-PRODUCT-VALUE-01-first-meaningful-map-activation.md`, `issue-PRODUCT-VALUE-02-ambiguity-evidence-workflow.md`, `issue-PRODUCT-VALUE-03-reviewable-outcome-package.md`
- Related: `01_Plans/issues/done/issue-MVP-EXIT-01-productization-readiness.md`, `issue-PRODUCT-QA-01-release-readiness-quality-gates.md`
- Related issues: `issue-VALUE-MEASURE-01-measurement-harness-and-evidence-artifacts.md`, `issue-VALUE-MEASURE-02-two-axis-value-governance-scorecard.md`

---

## Stream H deferred-backlog baseline（2026-06-13）

- `VALUE-MEASURE-01` is **Hold / deferred-open-ready**: the measurement harness may define Value Hypothesis, Evidence Artifact, and Go/No-Go artifact shapes, but must stay a planning contract until a real-user/cooperator milestone or maintainer-approved surrogate-evidence milestone exists.
- `VALUE-MEASURE-02` is **Hold / deferred-open-ready**: the two-axis scorecard may define value KPI × governance guardrail rows, but must not become a release blocker while sui-sensemaking remains solo OSS/pre-release.
- Minimal acceptable evidence while deferred is limited to issue text, mock/synthetic fixtures, command logs, and proposed evidence IDs; no frontend E2E implementation, telemetry expansion, or real-user KPI collection is required.
- No-Go conditions are: surveillance-style telemetry, individual scoring, SafeMode/share-export weakening, heavyweight RACI beyond Maintainer ownership, or mandatory external-participant KPI before activation.
