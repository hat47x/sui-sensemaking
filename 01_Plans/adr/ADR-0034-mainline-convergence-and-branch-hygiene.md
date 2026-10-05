# ADR-0034: 最新main収束とブランチ衛生の運用統治

- Status: Superseded by ADR-0089（2026-10-01。旧: Proposed）
- Date: 2026-05-21
- Deciders: Project Maintainers
- Scope: `01_Plans/`, repository branch/PR workflow

## Context

- 2026-05-21に `origin/main` を取得し、ローカル `main` を `2a93c95e` へfast-forwardした。
- 取得直後の観測では、remote branchが2247件、そのうち `codex/` を含むものが2227件存在した。
- `python 01_Plans/triage_actionable_plans.py` の実測では `active_issues=43 / ready=15 / blocked=28 / actionable_adrs=1` で、triage stopperは `none` だった。
- 一方で、過去の並行ストリーム名を持つbranch/issue/ADRが多数残っており、最新mainに入った内容と、未統合または放棄された計画案を区別しにくい。
- `PRODUCT-QA-01` のG0計画整合、および `MVP-EXIT-01` のProgram Gateでは、計画・証跡・戻し先issueの追跡可能性がリリース判定の前提になっている。

## Decision

最新mainを唯一の開発入力とし、並行branchや古いPR branchを仕様・計画の正本として扱わない。今後の分析・起票・実装は、次のintake手順を必須化する。

1. 作業開始時に `git fetch --prune` と `main` のfast-forward可否を確認し、対象 `origin/main` SHAを記録する。
2. 新規issue/ADRの作成前に、既存の `01_Plans/issues` と `01_Plans/adr` を検索し、重複なし、上位/下位関係、またはsupersedes/supersededのいずれかを本文に明記する。
3. branchは作業単位の一時的な置き場とし、仕様・設計・計画の正本は `main` 上の `00_Prompt/`, `01_Plans/`, `02_Architecture/` に限定する。
4. merged / abandoned / duplicateの可能性があるremote branchは、内部issue `PROJECT-GOV-01` で棚卸しし、削除・保持・参照のみの分類案を作る。
5. 最新mainの健康状態は、内部issue `PROJECT-BASELINE-01` でcandidate単位のbaseline recordとして確定する。
6. このADRは運用統治を扱う。プロダクト価値、UI、データ構造、SafeMode既定値などの仕様変更は扱わない。

採用理由: 現状のbranch数と計画ストリーム数では、個々のissueが正しくても、全体として「いま何が正本か」を誤認するリスクがある。mainline収束を先に固定することで、MVP脱却の品質ゲートと人間判断の入力を安定させる。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 並行branchが2247件もあり、最新mainに入った内容と未統合/放棄された計画案を区別しにくい。個々のissueが正しくても「いま何が正本か」を誤認するリスクがある。最新mainを唯一の開発入力とし並行branchや古いPR branchを仕様・計画の正本として扱わない | 機能: 新規issue/ADR作成前に既存のissues/adrを検索し重複なし・上位/下位関係・supersedesを本文に明記。データ: branchは作業単位の一時置き場とし正本はmain上の00_Prompt/01_Plans/02_Architectureに限定 |
| **データ設計** | 最新mainの健康状態は`PROJECT-BASELINE-01`でcandidate単位のbaseline recordとして確定。merged/abandoned/duplicateのremote branchは`PROJECT-GOV-01`で棚卸しし削除・保持・参照のみの分類案を作る | 業務: 古いbranch上にだけ存在する未統合の知見は即削除せず必要に応じて内部issueへ回収。機能: `PRODUCT-QA-01`のG0計画整合と`MVP-EXIT-01`のProgram Gateに再現可能な入力を渡す |
| **機能設計** | 作業開始時に`git fetch --prune`とmainのfast-forward可否を確認し対象origin/main SHAを記録するintake手順を必須化 | 業務: 類似issueや過去branchに基づく二重実装・二重ADR・古い仕様の再導入を減らす。データ: このADRは運用統治を扱いプロダクト価値・UI・データ構造・SafeMode既定値の仕様変更は扱わない |

## Consequences

- 期待される効果は次のとおりです。
  - 最新main、内部issue、ADR、PRの関係をcandidate単位で説明しやすくなる。
  - 類似issueや過去branchに基づく二重実装、二重ADR、古い仕様の再導入を減らせる。
  - `PRODUCT-QA-01` のG0計画整合と `MVP-EXIT-01` のProgram Gateに、再現可能な入力を渡せる。
- 想定される副作用/制約は次のとおりです。
  - 作業開始時のintakeと重複確認に追加コストがかかる。
  - branch削除やPR整理には、リポジトリ管理権限と人間判断が必要になる。
  - 古いbranch上にだけ存在する未統合の知見は、即削除せず、必要に応じて内部issueへ回収する必要がある。
- 移行時に必要な対応は次のとおりです。
  - `PROJECT-GOV-01` でremote branch / open PR / internal issue / ADRの棚卸し手順を定義する。
  - `PROJECT-BASELINE-01` で最新mainの検証コマンド、失敗分類、戻し先issueを記録する。
  - AGENTS.mdと `01_Plans/README.md` のADR参照範囲を `ADR-0034` まで更新する。

## Traceability

- Related: `01_Plans/adr/ADR-0000-adr-governance.md`
- Related: `01_Plans/issues/done/issue-MVP-EXIT-01-productization-readiness.md`
- Related: `01_Plans/issues/done/issue-PRODUCT-QA-01-release-readiness-quality-gates.md`
- Related: `01_Plans/issues/done/issue-DOC-OPS-03-project-progress-dashboard-planning.md`
- Related: `01_Plans/issues/done/issue-PROJECT-GOV-01-mainline-convergence-and-branch-hygiene.md`
- Related: `01_Plans/issues/done/issue-PROJECT-BASELINE-01-latest-mainline-health-baseline.md`
- Supersedes: N/A
- Superseded by: N/A
- Derived-from: 2026-05-21 latest-main intake and triage observation

---
