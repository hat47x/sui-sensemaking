# ADR-0025: DOC-OPS-04 変更統治と例外承認の責務境界

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-03-09
- Deciders: Platform Architecture Owner, Plan Owner, Architecture Owner
- Scope: `01_Plans/`, `02_Architecture/`, `04_Documentation/`
- Related: `01_Plans/adr/ADR-0022-doc-ops-04-documentation-information-interface.md`
- Source Issue: `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`

## Plan

### AC/DoD 補完提案（ADR-0025 専用）

- AC補完1: 変更統治における責務境界（起案・審査・承認・実行・監査）を役割単位で固定する。
- AC補完2: 例外承認の適用対象を「文書変更統治」のみに限定し、品質ゲート境界（lint/link/CI必須化）は ADR-0024 へ委譲する。
- AC補完3: 停止条件と再開条件を、A（ADR-0022）との整合前提で明文化する。
- DoD補完1: 役割分離（SoD: Segregation of Duties）違反がないことを表形式で検証できる。
- DoD補完2: 例外承認の失効条件と監査記録要件（Evidence）を明記する。
- DoD補完3: Self-Correction 最大3回の運用と、3回超過時の停止を記録する。

### 合意ログ（本ADRドラフト時点）

- 合意A（取得済み）: ADR-0025 は「変更統治・例外承認の責務境界」のみを定義し、品質ゲート実装境界は扱わない。
- 合意B（取得済み）: 統合ファイル3点（`01_Plans/issues/README.md` / `01_Plans/project-progress-dashboard.md` / `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`）は本ADR作業中に更新しない。
- 合意C（取得済み）: 例外承認の恒久運用は Deciders の受理後にのみ有効化する。

## Context

DOC-OPS-04 の候補D（Documentation Change Governance）では、Issueごとに運用責務が再定義されると、
説明責任・停止基準・再開判断が揺らぐ。
また、例外承認を定義する際に品質ゲート（ADR-0024 領域）まで混在させると、
承認対象が肥大化してレビュー不能になる。

このため、ADR-0025 では以下を先に固定する。

1. 文書変更統治の責務境界（誰が何を決め、誰が実行し、誰が監査するか）。
2. 例外承認の起動条件・停止条件・再開条件。
3. ADR-0022 のI/F語彙（正本/暫定メモ/決裁入力/例外承認）との整合。

非目標:

- docs-check や CI fail-on-error の必須化境界（ADR-0024）。
- lint/link/metadata ルールの技術実装詳細（ADR-0024）。

## Decision

### D1. 変更統治の責務境界（Role Boundary）

- **Change Author（起案者）**
  - 変更要求を起票し、`Context / Decision / Consequences` を作成する。
  - 例外申請時は有効期限・影響範囲・代替統制を必須記載する。
- **Plan Owner（審査責任者）**
  - 起案内容の計画整合（Scope、依存、停止条件）を審査する。
  - 実行は行わず、承認可否判断の入力を整備する。
- **Architecture Owner（設計責任者）**
  - 上位設計との整合（ADR-0022 / 02_Architecture群）を審査する。
  - 承認前に、品質ゲート論点が混入していないことを確認する。
- **Platform Architecture Owner（最終承認者）**
  - 変更適用または例外承認の最終決裁を行う。
  - 決裁者は実行者を兼務しない。
- **Platform Operator（実行責任者）**
  - 承認済み変更のみを反映し、証跡を記録する。
  - 承認前の先行適用は禁止。
- **Auditor（監査）**
  - 役割分離違反、期限切れ例外、停止条件違反を検証する。

### D2. 例外承認の適用境界

- 例外承認は **文書変更統治の運用手順** にのみ適用する。
- 例外承認で変更できる対象:
  - 承認順序、責務割当、停止/再開の手続き定義。
- 例外承認で変更できない対象:
  - docs-check必須化境界、CI失敗条件、実装品質ゲート（ADR-0024 管轄）。

### D3. 停止条件と再開条件

- 停止条件（いずれか成立で即停止）:
  1. A不整合: ADR-0022 のI/F語彙または拘束条件と矛盾が発生。
  2. 統合ファイル更新必要: 統合ファイル3点の更新が前提になった。
  3. SoD違反: 承認者と実行者の兼務が検出された。
  4. Self-Correction 3回超過: 修正ループで未解消。
- 再開条件（全条件成立で再開）:
  1. 不整合原因が是正され、Deciders の再確認を取得。
  2. 統合ファイル更新は統合フェーズ専用PRへ分離済み。
  3. 役割分離の再検証ログを追記。

### D4. Self-Correction ルール

- 最大3回まで、以下順序で最小差分修正を許可する。
  1. 用語・見出しI/F整合修正。
  2. 役割境界の記述修正。
  3. 停止/再開条件の条件式修正。
- 3回超過時は推測継続を禁止し、未解決論点を列挙して停止する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | Issueごとに運用責務が再定義されると説明責任・停止基準・再開判断が揺らぐ。文書変更統治の責務境界（起案・審査・承認・実行・監査）を役割単位で固定し、承認と実行の混在を防止する | 機能: Change Author（起案者）等の役割境界を定義し、Context/Decision/Consequencesを作成。データ: 役割分離（SoD）違反がないことを表形式で検証できる |
| **データ設計** | 例外承認の適用対象を「文書変更統治」のみに限定し、品質ゲート境界（lint/link/CI必須化）はADR-0024へ委譲。ADR-0022のI/F語彙（正本/暫定メモ/決裁入力/例外承認）と整合 | 業務: 例外承認の対象が限定され審査スコープ肥大化を抑制。機能: 例外承認の失効条件と監査記録要件（Evidence）を明記 |
| **機能設計** | 停止/再開条件（Self-Correction最大3回・3回超過時の停止）を固定し運用中断時の再始動判断を一貫させる。例外承認の恒久運用はDeciders受理後にのみ有効化 | 業務: 説明責任が役割単位で明確になり承認と実行の混在を防止。データ: 統合ファイル3点は本ADR作業中に更新しない（合意B） |

## Consequences

- 期待効果:
  - 変更統治の説明責任が役割単位で明確になり、承認と実行の混在を防止できる。
  - 例外承認の対象が限定されるため、審査スコープ肥大化を抑制できる。
  - 停止/再開条件が固定され、運用中断時の再始動判断が一貫する。

- リスク/制約:
  - 役割分離を厳格化することで、少人数体制では承認待ち時間が増える。
  - 品質ゲート関連の論点を本ADRで扱えないため、ADR-0024 の進行遅延が残課題になる。

- 不採用時の影響:
  - 変更統治と品質ゲートの境界が再混在し、レビュー負荷と判断の属人化が再発する。

## Verify

- 検証観点1（役割分離）: 承認者と実行者の兼務禁止が明文化されている。
- 検証観点2（停止条件）: A不整合・統合ファイル更新必要・SoD違反・3回超過が停止条件として列挙されている。
- 検証観点3（再開条件）: 是正+再確認+分離PR+再検証ログが定義されている。
- 検証観点4（境界遵守）: 品質ゲート境界を ADR-0024 領域として除外している。

## Proceed

- 完了報告（ADR-0025 Accepted）:
  - 変更統治・例外承認の責務境界を定義完了。
  - 役割分離・停止条件・再開条件を定義完了。
  - 品質ゲート境界を ADR-0024 領域として分離済み。

- 統合フェーズ引き渡し情報:
  1. 引き渡し前提: B/C/D がすべて `Accepted` であること。
  2. 必須確認: ADR-0022 との差分逸脱有無、統合ファイル更新はPhase 4のみ、SoD検証ログ。
  3. 統合時アクション: README / dashboard / issue-DOC-OPS-04 の状態を Done 同期し、validator/unittest を実行する。

## Traceability

- Related: `01_Plans/adr/ADR-0022-doc-ops-04-documentation-information-interface.md`
- Related: `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
