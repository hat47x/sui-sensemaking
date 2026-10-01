# ADR-0023: DOC-OPS-04 Readability Baseline

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-03-09
- Deciders: Plan Owner, Documentation Owner, Architecture Owner
- Scope: `01_Plans/` / `02_Architecture/` / `04_Documentation/`（文書可読性の最小基線のみ）
- Related: `01_Plans/adr/ADR-0022-doc-ops-04-documentation-information-interface.md`
- Derived-from: `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`（ADR候補B）

## Context

ADR-0022 で DOC-OPS-04 系 ADR の共通I/F（用語・見出し・判定メタ）が固定された。次段の ADR-0023（候補B）では、可読性の最低基線を定義し、初読コストと再開コストを下げる必要がある。

issue-DOC-OPS-04（ADR候補B）で確認された主要課題は以下。

1. 読者前提・目的・非目標・到達状態の記載粒度が文書ごとに揺れる。
2. 用語ゆれにより、文書横断で判断基準がずれる。
3. 変更時に「今回適用範囲」と「今回非対象範囲」の境界が不明瞭になりやすい。

本ADRは **Readability baseline のみ** を扱う。CI必須化境界や例外承認フローは対象外とし、関連判断は別ADR（候補C/D）へ委譲する。

## Plan（AC/DoD不足補完と合意ログ）

### AC/DoD不足の補完提案

- AC補完-1: 対象文書に Audience / Goal / Non-goal / Outcome を明示する。
- AC補完-2: Upstream Reference / Downstream Apply を各1件以上明示する。
- AC補完-3: 今回編集対象と非対象（Non-goal）を明示し、境界をレビュー可能にする。
- DoD補完-1: ADR本文に `Context / Decision / Consequences / Traceability` を必須記載する。
- DoD補完-2: ADR-0022 I/F逸脱の有無を Verify で明示する（逸脱時は理由を記録）。

### 合意ログ（本ADR起票時点）

- 合意-1（取得済）: 候補Bは可読性基線の定義に限定し、CI境界は扱わない。
- 合意-2（取得済）: 候補Bは例外承認ルールを扱わない。
- 合意-3（取得済）: ADR-0022 の固定I/F（語彙・見出し・判定メタ）を前提とし、逸脱時は理由を明文化する。

## Decision

### 1) Readability Baseline（RBL）

文書の新規作成・大幅改訂時、以下を最小基線として適用する。

- **RBL-1 Audience**: 想定読者を明示する。
- **RBL-2 Goal / Non-goal**: 決めることと決めないことを分離して明示する。
- **RBL-3 Outcome**: 読了後の到達状態（判断・実行可能な状態）を示す。
- **RBL-4 Upstream / Downstream**: 上流根拠と下流適用先を最低1件ずつ示す。
- **RBL-5 Terminology Consistency**: 既存正本語彙との整合を維持する。

### 2) 適用境界

- In-Scope: 当該変更で実際に編集した文書。
- Out-of-Scope: 今回編集していない文書（ただし将来差分時に適用対象）。

### 3) 非目標（明示）

- CI必須化境界（fail条件・ゲート閾値）の定義。
- 例外承認の役割分離・承認手順の定義。
- 実装コード・ランタイム制約の変更。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 読者前提・目的・非目標・到達状態の記載粒度が文書ごとに揺れ、文書横断で判断基準がずれる。可読性の最低基線（Readability Baseline）を定義し初読コストと再開コストを下げる | 機能: RBL-1 Audience・RBL-2 Goal/Non-goal等を新規作成・大幅改訂時の最小基線として適用。データ: 対象文書にAudience/Goal/Non-goal/Outcomeを明示 |
| **データ設計** | AC補完としてAudience/Goal/Non-goal/OutcomeとUpstream Reference/Downstream Applyを各1件以上明示。今回編集対象と非対象を明示し境界をレビュー可能にする | 業務: 初読者の理解開始点が揃い読解コストを低減。機能: 変更レビュー時に適用境界（In/Out）が明確になり差分判定の再現性が上がる |
| **機能設計** | DoD補完としてADR本文にContext/Decision/Consequences/Traceabilityを必須記載し、ADR-0022 I/F逸脱の有無をVerifyで明示（逸脱時は理由を記録） | 業務: 文書横断での用語ドリフトを早期検知しやすくする。データ: 執筆時に最小メタ記載の確認コストが増える（副作用） |

## Consequences

- 期待効果:
  - 初読者の理解開始点（Audience/Goal/Non-goal/Outcome）が揃い、読解コストを低減できる。
  - 変更レビュー時に適用境界（In/Out）が明確になり、差分判定の再現性が上がる。
  - 文書横断での用語ドリフトを早期検知しやすくなる。

- 副作用/制約:
  - 執筆時に最小メタ記載の確認コストが増える。
  - 段階適用のため、移行期間は適用済み/未適用文書が混在する。

## Execute

- ADR候補Bとして、Readability baseline（RBL-1〜RBL-5）を定義した。
- 適用境界（In-Scope / Out-of-Scope）を明文化した。
- 非目標として CI境界・例外承認を明示的に除外した。

## Verify

- ADR構造必須要素の確認:
  - `Context / Decision / Consequences / Traceability` を記載済み。
- ADR-0022 I/F逸脱確認:
  - 判定: **逸脱なし**（固定I/Fを前提に記述）。
  - 逸脱理由: 該当なし。
- Self-Correction:
  - 試行1: 見出し構成と非目標を点検。
  - 試行2: AC/DoD補完と合意ログの不足有無を点検。
  - 試行3: I/F逸脱理由記載欄の有無を点検。
  - 結果: 3回以内で充足（停止条件未該当）。

## Proceed

- 状態: **完了（ADR-0023 Accepted）**
- 未解決点:
  - なし。
- 次Phase開始条件（ADR-0024）:
  1. ADR-0022のI/F語彙に変更兆候がないこと。
  2. ADR-0023で定義したRBL-1〜RBL-5と矛盾しないこと。
- 変更影響:
  - 品質ゲート境界（ADR-0024）は、Audience/Goal/Non-goal/Outcome を前提に判定する。

## Traceability

- Related: `01_Plans/adr/ADR-0022-doc-ops-04-documentation-information-interface.md`
- Related: `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `01_Plans/adr/ADR-0018-coding-standards-and-smell-remediation.md`
