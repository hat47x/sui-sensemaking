# ADR-0039: 個人OSS・プレリリース段階に合わせたガバナンス適正化

- Status: Accepted
- Date: 2026-05-31
- Deciders: Maintainer（委譲された意思決定権限により決定）
- Scope: `01_Plans/`, repository governance

## Context

- `README.md` NOTICEのとおり、本リポジトリは生成AIを用いた開発中で、現時点では人的レビュー・利用を伴わない（solo・プレリリース・実ユーザー無し）。
- 一方、現行ガバナンスは多人数・運用中プロダクトを想定した重量級である。具体例:
  - 仮想多役割のRACI（Security Officer / System Owner / Platform Operator / Productization Program Owner / Plan Owner / Architecture Owner / QA Lead / Documentation Maintainer等）。実体は1名で、多くが `TBD` または `Codex`。
  - `project-progress-dashboard.md` のper-rerun共有統合同期ログ（`Stream X rerun-NN ... 再確認した` が数百行、内容はほぼ同一の「件数47 / Active=5 / Done=26」反復）。
  - 期限付きDecision Queue、Program Gate、Release Readiness、二軸スコアカード、strict mode 2者承認フロー。
  - GitHub Issues `N/A→URL` 移行RunbookとRACI-I通知（GitHub Issuesは未運用）。
  - 毎タスクの5フェーズ（Read→Plan→Execute→Verify→Proceed）＋ self-correction上限の形式運用。
- この段階では、これらは価値生産より管理に比重が偏り、個人OSSの継続性をむしろ損なう。
- ただし安全・価値の不変条件はガバナンスではなくプロダクト本体であり、緩和対象に含めない。

## Decision

開発段階（solo・プレリリース）に合わせ、ガバナンスを次の3区分で適正化する。本ADRを緩和方針の正本とする。

### KEEP（維持 / 低コストで有効）

- ADR（意思決定の軽量記録）とissue memo（バックログ）。ただし必須項目は最小限に留める。
- `validate_active_issue_memos.py` / `triage_actionable_plans.py`（自動・軽量・リンク切れ防止に有効）。
- `00_Prompt/domain.md` の概念定義と `AGENTS.md` のRead Order。

### RELAX / DEFER（この段階では任意化・延期）

- **役割**: 仮想多役割を単一の Maintainer に集約する。役割分離（RACI、2者承認、SoD）は協力者が継続参加した時点で再導入する。
- **進捗ダッシュボード**: 今後は現状スナップショットのみを保持し、per-rerun同期ログの追記を停止する。過去ログは凍結（削除は任意の低優先フォローアップ）。
- **ゲート/キュー**: 期限付きDecision Queue、Program Gate、Release Readiness、二軸スコアカード（`VALUE-MEASURE-*`）、社会的普及KPI（`SOCIAL-DIFFUSION-*`）は directionとして保持し、実ユーザー/協力者が現れるmilestoneまでactivationを延期する。
- **外部トラッカー運用**: GitHub Issues `N/A→URL` 移行RunbookとRACI-I通知は、実運用開始まで不要とする。
- **作業プロトコル**: 5フェーズ＋self-correction上限の形式運用は必須化しない（判断補助としての利用は妨げない）。
- **テンプレート**: issue `TEMPLATE.md` の `Requirement meta I/F` / RACI / KPIブロックは任意とする。

### NON-RELAXABLE（緩和禁止 / プロダクト不変条件）

`AGENTS.md` ゴールデンルール#4とCE0契約に基づき、次は段階に関わらず維持する。

- SafeMode既定ONとshare/exportの漏えい防止。
- AIはproposal-only（auto-apply禁止、Consensus Graph直接更新禁止）。
- `human_reviewed` は人手のみ昇格（AI/worker/API自動昇格禁止）。
- `SUI_LLM_PROVIDER=none` 既定でも主要価値が成立。
- import sanitize / zip hardening。

### ADR-0000 への適用（amendment）

- 「1 ADR 50–180行」「Authoring Checklist必須」「`Draft→Open` での `Source Issue` 必須」「`Open/In Progress/Done` の多役割承認」はsolo段階では推奨へ降格し、Status遷移はMaintainer単独で確定してよい。
- 進捗の正本はissue/ADRとし、ダッシュボードは任意の参照レイヤへ降格する。

### 保留キューの解決（代理裁可）

本セッションの委譲権限により、前ターンの保留を次のとおり確定する。

- `ADR-0036` → Accepted（VR0–VR3 active、VR4/VR5はactivation延期）。
- `ADR-0037` / `ADR-0038` → Accepted（direction、activation延期）。
- `VR-ROADMAP-01` / `VALUE-MEASURE-01,02` / `SOCIAL-DIFFUSION-01..04` → Draftのdeferred backlog（非アクティブ、優先度実質P3）。
- `DQ-VR-ROADMAP-01` → Approved（deferred activation）/ Resolved。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | solo・プレリリース段階では重量級ガバナンスを KEEP / RELAX-DEFER / NON-RELAXABLE の3区分に適正化する。仮想多役割を単一Maintainerへ集約し安全不変条件は緩和しない | データ: 進捗の正本は issue/ADR としダッシュボードは任意の参照レイヤへ降格。機能: 外部トラッカー運用は実運用開始まで不要 |
| **データ設計** | 進捗の正本は issue/ADR。ダッシュボードは現状スナップショットのみ保持し、per-rerun 同期ログの追記を停止・過去ログは凍結する | 業務: 「いま何が active で何が延期か」を1名でも追跡可能にする。機能: `validate_active_issue_memos.py` 等の軽量自動検証は維持 |
| **機能設計** | 自動・軽量の検証スクリプトは維持。期限付きDecision Queue・Program Gate・Release Readiness・観測スコアカード・社会的普及KPIはdirectionとして保持しactivation延期。Status遷移・ADR確定はMaintainer単独で行ってよい | データ: スコアカード・KPIの観測データ生成はactivation延期。業務: 役割分離（RACI・2者承認・SoD）は協力者が継続参加した時点で再導入 |

## Consequences

- 期待される効果は次のとおりです。
  - 維持コストが下がり、価値ある計画・思想と安全不変条件は保持される。
  - 「いま何がactiveで、何が延期か」を1名でも追跡できる。
- 想定される副作用/制約は次のとおりです。
  - 役割分離・監査の重量を一旦手放すため、協力者参加時に段階的な再導入が必要。
  - 過去ログ凍結により、当時の同期経緯は履歴としてのみ残る。
- Optional follow-ups（低優先 / 強制しない）:
  - ダッシュボード過去rerunログの整理。
  - 各文書の多役割表記 → `Maintainer` への置換。
  - `strict_mode_exception_approval_flow` 等の2者承認記述の段階注記。

### 再導入トリガー（Reactivation）

- 外部協力者が継続参加した、または公開リリースで実ユーザーが付いた時点で、役割分離・Decision Queue・観測スコアカード・社会的普及KPIを段階的に戻す。

## Traceability

- Related: `README.md`（NOTICE / 開発段階）, `AGENTS.md`, `01_Plans/adr/ADR-0000-adr-governance.md`
- Execution inventory: `01_Plans/lean_operations_inventory.md`, `01_Plans/issues/done/issue-OPS-LEAN-01-small-oss-operations-reduction.md`
- Related: `01_Plans/adr/ADR-0036-value-to-social-goal-realization-roadmap.md`, `ADR-0037-value-measurement-harness-and-scorecard.md`, `ADR-0038-social-diffusion-of-explainable-consensus.md`
- Related: `01_Plans/project-progress-dashboard.md`, `02_Architecture/value_traceability.md`, `01_Plans/issues/TEMPLATE.md`
- Derived-from: 2026-05-31委譲された意思決定セッションでのガバナンス適正化判断
