# ADR-0039: 個人OSS・プレリリース段階に合わせたガバナンス適正化

- Status: Accepted
- Date: 2026-05-31
- Deciders: Maintainer（委譲された意思決定権限により決定）
- Scope: `01_Plans/`, repository governance

## Context

- `README.md` NOTICEのとおり、本リポジトリは生成AIを用いた開発中で、現時点では人によるレビューも利用も伴わない（solo、プレリリース、実際の利用者はいない）。
- 一方、現行のガバナンスは、多人数で運用中のプロダクトを想定した重いものである。具体例は次のとおり。
  - 仮想の多役割によるRACI（Security Officer / System Owner / Platform Operator / Productization Program Owner / Plan Owner / Architecture Owner / QA Lead / Documentation Maintainer等）。実体は1名で、多くが `TBD` または `Codex` になっている。
  - `project-progress-dashboard.md` の、再実行ごとの共有統合同期ログ（`Stream X rerun-NN ... 再確認した` が数百行あり、内容はほぼ同一の「件数47 / Active=5 / Done=26」の繰り返し）。
  - 期限付きのDecision Queue、Program Gate、Release Readiness、二軸スコアカード、strict modeの2者承認フロー。
  - GitHub Issuesの `N/A→URL` 移行Runbookと、RACI-Iの通知（GitHub Issuesは運用していない）。
  - 毎タスクの5フェーズ（Read→Plan→Execute→Verify→Proceed）と、self-correctionの上限を形式的に運用すること。
- この段階では、これらは価値を生むことより管理に比重が偏り、個人のOSSの継続性をかえって損なう。
- ただし、安全と価値の不変条件はガバナンスではなくプロダクト本体であり、緩和の対象に含めない。

## Decision

開発段階（solo、プレリリース）に合わせ、ガバナンスを次の3区分で適正化する。緩和の方針は、本ADRに従う。

### KEEP（維持 / 低コストで有効）

- ADR（意思決定の軽量な記録）とissue memo（バックログ）。ただし、必須の項目は最小限にとどめる。
- `validate_active_issue_memos.py` / `triage_actionable_plans.py`（自動で動き、軽量で、リンク切れの防止に有効）。
- `00_Prompt/domain.md` の概念定義と `AGENTS.md` のRead Order。

### RELAX / DEFER（この段階では任意化・延期）

- **役割**: 仮想の多役割を、単一のMaintainerに集約する。役割の分離（RACI、2者承認、SoD）は、協力者が継続して参加した時点で再導入する。
- **進捗ダッシュボード**: 今後は現状のスナップショットだけを保持し、再実行ごとの同期ログの追記を停止する。過去のログは凍結する（削除は、任意の優先度の低いフォローアップとする）。
- **ゲートとキュー**: 期限付きのDecision Queue、Program Gate、Release Readiness、二軸スコアカード（`VALUE-MEASURE-*`）、社会的普及KPI（`SOCIAL-DIFFUSION-*`）は、方向性として保持し、実際の利用者や協力者が現れるマイルストーンまで有効化を延期する。
- **外部トラッカーの運用**: GitHub Issuesの `N/A→URL` 移行Runbookと、RACI-Iの通知は、実際の運用を始めるまで不要とする。
- **作業プロトコル**: 5フェーズとself-correctionの上限を形式的に運用することは、必須にしない（判断の補助として使うことは妨げない）。
- **テンプレート**: issueの `TEMPLATE.md` にある `Requirement meta I/F`、RACI、KPIのブロックは任意とする。

### NON-RELAXABLE（緩和禁止 / プロダクトの不変条件）

`AGENTS.md` のゴールデンルール#4とCE0契約に基づき、次は段階にかかわらず維持する。

- SafeMode既定ONと、share/exportでの漏えい防止。
- AIはproposal-only（auto-apply禁止、Consensus Graph直接更新禁止）。
- `human_reviewed` は人手でのみ昇格する（AI、worker、APIによる自動の昇格は禁止）。
- `SUI_LLM_PROVIDER=none` が既定でも、主要な価値が成立すること。
- import sanitize / zip hardening。

### ADR-0000 への適用（amendment）

- 「1 ADR 50–180行」「Authoring Checklistは必須」「`Draft→Open` では `Source Issue` が必須」「`Open/In Progress/Done` は多役割の承認」という規則は、solo段階では推奨へ下げ、Statusの遷移はMaintainer単独で確定してよい。
- 進捗の正本はissueとADRとし、ダッシュボードは任意の参照用の層へ下げる。

### 保留キューの解決（代理裁可）

このセッションで委ねられた権限により、前のターンで保留した事項を次のとおり確定する。

- `ADR-0036` → Accepted（VR0–VR3はactive、VR4/VR5は有効化を延期）。
- `ADR-0037` / `ADR-0038` → Accepted（方向性として、有効化は延期）。
- `VR-ROADMAP-01` / `VALUE-MEASURE-01,02` / `SOCIAL-DIFFUSION-01..04` → Draftの先送りのバックログ（非アクティブで、優先度は実質P3）。
- `DQ-VR-ROADMAP-01` → Approved（deferred activation）/ Resolved。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | solo、プレリリースの段階では、重いガバナンスを KEEP / RELAX-DEFER / NON-RELAXABLE の3区分に適正化する。仮想の多役割を単一のMaintainerへ集約し、安全の不変条件は緩和しない | データ: 進捗の正本は issue/ADR とし、ダッシュボードは任意の参照用の層へ下げる。機能: 外部トラッカーの運用は、実際の運用を始めるまで不要 |
| **データ設計** | 進捗の正本は issue/ADR。ダッシュボードは現状のスナップショットだけを保持し、再実行ごとの同期ログの追記を停止して、過去のログは凍結する | 業務: 「いま何が active で何が延期か」を、1名でも追跡できるようにする。機能: `validate_active_issue_memos.py` などの、軽量な自動検証は維持する |
| **機能設計** | 自動で動く軽量な検証スクリプトは維持する。期限付きのDecision Queue、Program Gate、Release Readiness、観測スコアカード、社会的普及KPIは、方向性として保持し、有効化を延期する。Statusの遷移とADRの確定は、Maintainer単独で行ってよい | データ: スコアカードとKPIの観測データの生成は、有効化を延期する。業務: 役割の分離（RACI、2者承認、SoD）は、協力者が継続して参加した時点で再導入する |

## Consequences

- 期待される効果
  - 維持のコストが下がり、価値のある計画と思想、および安全の不変条件は保たれる。
  - 「いま何がactiveで、何が延期か」を、1名でも追跡できる。
- 想定される副作用と制約
  - 役割の分離と監査の重さをいったん手放すため、協力者が参加したときに、段階的な再導入が必要になる。
  - 過去のログを凍結するため、当時の同期の経緯は履歴としてだけ残る。
- Optional follow-ups（優先度は低く、強制しない）
  - ダッシュボードにある過去の再実行ログの整理。
  - 各文書の多役割の表記を、`Maintainer` へ置き換えること。
  - `strict_mode_exception_approval_flow` などにある2者承認の記述への、段階の注記。

### 再導入トリガー（Reactivation）

- 外部の協力者が継続して参加した、または公開リリースで実際の利用者が付いた時点で、役割の分離、Decision Queue、観測スコアカード、社会的普及KPIを段階的に戻す。

## Traceability

- Related: `README.md`（NOTICE / 開発段階）, `AGENTS.md`, `01_Plans/adr/ADR-0000-adr-governance.md`
- Execution inventory: `01_Plans/lean_operations_inventory.md`, `01_Plans/issues/done/issue-OPS-LEAN-01-small-oss-operations-reduction.md`
- Related: `01_Plans/adr/ADR-0036-value-to-social-goal-realization-roadmap.md`, `ADR-0037-value-measurement-harness-and-scorecard.md`, `ADR-0038-social-diffusion-of-explainable-consensus.md`
- Related: `01_Plans/project-progress-dashboard.md`, `02_Architecture/value_traceability.md`, `01_Plans/issues/TEMPLATE.md`
- Derived-from: 2026-05-31委譲された意思決定セッションでのガバナンス適正化判断
