# ADR-0026: 次フェーズ計画（HIL-RS-01）Human-in-the-loop可逆統合ループ

- Status: Accepted
- Date: 2026-03-11
- Deciders: Project Maintainers
- Scope: `01_Plans/`, `02_Architecture/`, `03_Implement/frontend/`, `04_Documentation/`
- Source Issue: `01_Plans/issues/done/issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis.md`
- Related: `00_Prompt/domain.md`, `01_Plans/adr/ADR-0001-value-to-requirements.md`, `01_Plans/research/phase-exit-evaluation-ENV-ARCH-01-2026-03-11.md`
- Norms: `DOM-CORE-03`（可逆統合ループの段階導入そのものが本ADRの決定）

## Context

`ENV-ARCH-01` はphase-exit評価でClose可となり、次フェーズ開始条件として
「次Backlog IDに紐づくOpen issue memo化」が明示された。

プロジェクト目的（`00_Prompt/domain.md`）と価値→要件（`ADR-0001`）に照らすと、
次に優先すべきは次の3点である。

1. **意味の保留**を維持した探索（P-01）。
2. **単一正解の否定**を維持した複数案比較（P-02）。
3. **人間が介在する反復**（Human-in-the-loop。Critique→再提案）とレビュー追跡（P-04/P-03）。

上記を満たすため、次フェーズは大規模一括実装ではなく、契約先行で可逆統合ループを段階導入する計画へ固定する。

また、`HIL-RS-01` の停止条件（SafeMode後退禁止、共有リソース競合回避、上位層優先）を満たしたまま
下流（A1/A2/A3）へ進めるためには、ADR採否をProposedのまま残さずDecider判断で確定する必要がある。

## Decision

次フェーズBacklogを **HIL-RS-01（Human-in-the-loop Reversible Synthesis）** として開始する。

### D1. フェーズ目的（Value Anchor）

- 目的は「精度競争」ではなく、**保留を維持した探索支援**の強化とする。
- AI提案は常に候補扱いとし、確定操作は人間操作でのみ行う。

### D2. 実行順序（契約先行）

1. Plan: issueでAC/非目標/検証計画を固定する。
2. Architecture: 最小I/F（Critique入力、再提案差分、レビュー帰属）を定義する。
3. Implement: frontendを小粒度タスクへ分割して実装する。
4. Documentation: 操作手順と制約を運用文書へ同期する。

### D3. 非目標（このフェーズで扱わない）

- LLMプロバイダの全面再設計。
- 採点・ランキング導入など単一正解を示唆するUI。
- SafeMode既定ONを緩める変更。

### D4. Gate（着手・停止・再開）

- 着手条件
  - `issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis.md` がOpenで、ACと検証計画が充足している。
- 停止条件
  1. `domain.md`（保留/違和感/可逆性）と矛盾する設計が必要になった場合。
  2. SafeMode契約の後退が前提になる場合。
  3. 共有リソース（ダッシュボードとissueの索引）で同時編集の競合が発生した場合。
- 再開条件
  - 上位層（00〜02）へ修正提案を先に反映し、Deciders合意後に再開する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 次フェーズは精度競争でなく「保留を維持した探索支援」の強化。AI提案は常に候補扱いとし確定操作は人間操作でのみ行う。意味の保留（P-01）・単一正解の否定（P-02）・HITL反復（P-04）を優先する | 機能: Critique入力・再提案差分・レビュー帰属の最小I/Fを契約先行で定義。データ: AI提案は常に候補として扱い自動確定しない |
| **データ設計** | 可逆統合ループを段階導入し、共有リソース（ダッシュボードとissueの索引）の同時編集の競合を回避。SafeMode後退を禁止 | 業務: 契約先行（Plan→Architecture→Implement→Documentation）でfrontend実装の手戻りを抑制。機能: 停止条件を満たしたまま下流へ進める |
| **機能設計** | HIL-RS-01フェーズを開始し、最小I/F（Critique入力・再提案差分・レビュー帰属）を定義してfrontendを小粒度タスクへ分割実装 | 業務: LLMプロバイダの全面再設計は非目標。データ: 短期の機能追加速度は抑制されるが01/02/03/04の同期運用コストが増える |

## Consequences

- 期待される効果
  - 価値整合を維持しつつ、次フェーズ着手の作業起点を明確化できる。
  - 契約先行によりfrontend実装の手戻りを抑制できる。
- 副作用と制約
  - 短期の機能追加速度は抑制される。
  - 01/02/03/04の同期運用コストが増える。

### Contract Freeze Addendum（Stream A / HIL-RS最小I/F固定）

実装前固定として、HIL-RSの最小I/Fを次のとおり定義する（実装詳細は後続Phaseで確定）。

| Interface | Input（最小） | Output（最小） | Audit Event（必須） |
| --- | --- | --- | --- |
| `HIL_RS_DECISION_GATE_V1` | `issueId`, `phase`, `approvalRecord` | `gateStatus`（`go/conditional/no-go`）, `held[]` | `query`,`bundle`,`proposal`,`apply` |
| `HIL_RS_PATCH_PROPOSAL_V1` | `sourceBundleHash`, `proposalId`, `actor` | `patchDraft`, `riskLabels[]` | `proposal` |
| `HIL_RS_APPLY_JUDGEMENT_V1` | `proposalId`, `humanDecision`, `approvedBy` | `applyResult`, `rollbackRef` | `apply` |

- `Approval Record` がPendingの間、上記I/Fは **読み取り専用の契約** として扱う。
- 上記I/Fのキー追加・削除は `approved_by` / `approved_at` / `evidence` の充足後のみ許可する。

## Approval Log

- 2026-03-11: Deciders（Project Maintainers）が `Accepted` を確定。
- 判断根拠
  1. `HIL-RS-01` の目的（保留維持・可逆性・HIL反復）が `domain.md` / `ADR-0001` と整合している。
  2. 非目標（単一正解示唆UI、SafeMode後退、LLM全面再設計）が明示され、スコープ逸脱を抑制できる。
  3. 停止条件（上位層矛盾・SafeMode契約後退・共有リソース競合）を維持したままA1着手に進行可能。

## Verify

- 検証観点1: `HIL-RS-01` がアクティブなissueとして `issues/README.md` とダッシュボードの双方に同期されている。
- 検証観点2: ACに「安全」「可逆」「検証コマンド」が含まれる。
- 検証観点3: docs-check（validator/unittest）が成功する。

## Stream J Audit（ADR連動監査: active issue基準）

### Read

- `python 01_Plans/triage_actionable_plans.py` の出力を正とし、アクティブなissueからの逆引きで対象ADRを抽出した。
- 抽出結果: アクティブなissueに直接連動するADRは `ADR-0026` / `ADR-0027` の2件。

### ADR/CDC

- `ADR-0026` / `ADR-0027` の本文に `Context` / `Decision` / `Consequences` が存在することを確認した。
- 本ADR（`ADR-0026`）はCDC欠損なし。

### Plan

- アクティブなissueに連動するADRでCDCの欠損が検出された場合のみ、欠損見出しを最小追記する。
- 欠損なしの場合は「未処理ADRなし」をADR本文へ明文化し、Proceedで逆引き表を固定する。

### Execute

- 本監査回ではCDC欠損を検出しなかったため、仕様追記は監査結果の明文化に限定した（実質変更最小）。

### Proceed（issue逆引き表）

| Active issue | 連動ADR | CDC欠損 | 判定 |
| --- | --- | --- | --- |
| `issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis` | `ADR-0026` | なし | 追補不要 |
| `issue-HIL-RS-02-next-phase-delivery-plan` | `ADR-0027` | なし | 追補不要 |

## Proceed

1. `HIL-RS-01` を起点にA1（Architecture最小I/F定義）を最初の実行タスクとして起票する。
2. A2（Frontend実装）/A3（Documentation同期）を依存順序つきでissue化する。
3. フェーズ出口では `phase-exit-evaluation-HIL-RS-01-<date>.md` を追加して完了判定を記録する。

## Traceability

- Related: `01_Plans/research/phase-exit-evaluation-ENV-ARCH-01-2026-03-11.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `00_Prompt/domain.md`
- Derived-from: `01_Plans/issues/done/issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis.md`


## Stream A critical-path checkpoint（2026-04-29）

### Phase 1: Contract Baseline Read
- 対象（Stream A 許可リスト）を再読し、`Status / Dependencies / Pending承認` を抽出した。
- 抽出結果: A1=`Open`、RS-01 umbrella=`Open`、RS-02 umbrella=`Open`、A2=`Open`、A3=`Draft`。
- Pending承認: `Approval Record` 必須項目（`approved_by` / `approved_at` / `evidence`）が未充足のため **承認待ち**。

### Phase 2: ADR明文化（Context / Decision / Consequences）
- Context: A1契約凍結未完了のままA2/A3を前進させると `A1 -> A2 -> A3` 依存が崩れる。
- Decision: `HIL-RS-02-A1-CONTRACT-FREEZE-v1` / `schemaVersion=1.0.0` / `overridePolicy=human_dual_control_only` / `safeModeDefault=ON` を固定継続。
- Consequences: 承認待ちの間はProceedの判定を `Conditional/Needs-decision` に維持し、確定化を行わない。

### Phase 4: Proceed Gate
- 前提差分: 固定キーの差分=`0`（再読時点）。
- 判定: **Needs-decision（停止可能状態）**。承認未充足のため、次工程は人間承認入力後に再開する。

## Stream A serial gate verification（2026-04-29, critical path）

### Phase 1: Read同期
- 許可リスト対象4ファイルを再読し、`schemaVersion=1.0.0` / `overridePolicy=human_dual_control_only` / `Freeze Pack ID=HIL-RS-02-A1-CONTRACT-FREEZE-v1` の一致を確認した。
- 固定キーのドリフト: `0`。

### Phase 2-5: 判定
- ADR側のContext / Decision / Consequencesは欠損なし。
- `Pending bypass` 禁止、`A1 Done 前の A2/A3 Open禁止`、`SafeMode既定ON維持` を再確認した。
- 判定: **Conditional / Needs-decision**（`Approval Record` 未充足のため）。


## Stream A Phase 1-5 contract/governance lock (2026-04-29)

### Context
- Stream A（クリティカルパス）はHIL-RS契約・統治の確定を最短で完了しつつ、A1→A2→A3依存を崩さないことが要求される。
- 既存記録には `Needs-decision` が残存しており、合意入力前に下流を確定化しない統治境界を再固定する必要がある。

### Decision
- AC/DoDを本ADR上で再固定し、未承認時の判定を `Conditional/Needs-decision` に固定する。
- 固定契約値（`freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1` / `schemaVersion=1.0.0` / `overridePolicy=human_dual_control_only` / `safeModeDefault=ON` / `safeModeBoundary=SAFE_MODE_STRICT_ON`）は参照専用とし再定義しない。
- A2/A3は `A2A3_OPEN_ALLOWED=true` を満たすまで `Draft -> Open` を禁止する。

### Consequences
- 合意未充足時に実装/運用更新へ誤進行する経路を遮断できる。
- Stream B/Cなど後続ストリームは、契約値を再解釈せず固定参照で前進できる。

### AC / DoD（Stream A固定）
- AC-1: `fixed keys diff=0` を維持する。
- AC-2: `Pending -> Approved | Pending -> Rejected` 以外の遷移を導入しない。
- AC-3: A1完了前のA2/A3 Open化を行わない。
- DoD-1: `Plan -> Execute -> Verify -> Proceed` の直列運用を維持する。
- DoD-2: 自己修正の試行回数を `0/3` から記録し、4回目に相当する時点で停止する。
- DoD-3: `Approval Record` 未入力時は `Needs-decision` で停止またはConditional維持。

## Stream A Phase 2 explicit CDC addendum（Contract freeze wording）

### Context
- Stream Aは `HIL-RS-02-A1-CONTRACT-FREEZE-v1` を下流参照契約として維持し、A1より先にA2/A3で契約再解釈が起きないことを保証する必要がある。
- 直近の再読で `contractId / schemaVersion / overridePolicy / audit event set` の4点セットはdrift=0だったため、更新は「明文化不足の補完」に限定できる。

### Decision
- A1契約の更新は **型定義（interface/type signature）に限定** し、ロジック実装・挙動変更・運用手順変更は本ストリームの対象外とする。
- 固定4点セット（`contractIds` / `schemaVersion=1.0.0` / `overridePolicy=human_dual_control_only` / `query|bundle|proposal|apply`）は凍結値として維持する。

### Consequences
- 契約統治の可読性が上がり、A1->A2->A3の依存順を崩さずにレビュー可能になる。
- 変更可能範囲が型定義に限定されるため、実装前提の差分混入を防止できる。



## Stream B Planning Sync Addendum（2026-05-04）

### Context
- HIL-RS-01関連IssueのReady条件とBlockerの粒度に差があり、A1/A2/A3への受け渡しで「実装依存」と「契約依存」が混在していた。

### Decision
- HIL-RS-01系は **実装依存を契約依存へ置換** する方針を追加採用する。
- Ready判定は次の契約ゲートで統一する。
  1. `freezeContractId` 一致
  2. `Approval Record`（`approved_by/approved_at/evidence`）充足
  3. `Decision Queue Pending=0`
- モックで並行化できる項目（Query/Bundle/Proposal/Applyの監査4点セット確認）は、実装完了待ちをせずissue側で先行検証する。

### Consequences
- A1未完了時でも、A2/A3はモック契約ベースで準備作業を継続できる。
- Ready/Blocker判定が契約値ベースになり、再開時の分岐判断が単純化される。

## Stream A addendum（2026-05-06 / Contract Freeze and minimum interface agreement）

### Context
- HIL-RS-01の親ADRはA1契約凍結の上位参照であり、親側で再定義が入るとA1/A2/A3の依存順が崩れる。

### Decision
- 親ADRでは契約固定値を参照専用として扱う（`freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`, `schemaVersion=1.0.0`, `overridePolicy=human_dual_control_only`, `safeModeDefault=ON`, `safeModeBoundary=SAFE_MODE_STRICT_ON`）。
- 判定は `A2A3_OPEN_ALLOWED`（または同値条件）を唯一ゲートとして維持し、派生判定式を導入しない。

### Consequences
- A2/A3は読み取り専用の引き渡しを継続し、未承認事項（`Approval Record`, `held`）が解消するまでは `Needs-decision/Hold` を維持する。
- SafeMode既定ONと厳格境界の後退を禁止する。

## Stream A Contract Freeze update（2026-05-07）

### Context
- Stream Aの責務は、A1契約の固定値を親ADRで再定義せず、A2/A3の参照境界を凍結状態で維持することである。
- 現時点で `Approval Record` が未充足のため、実装・下流確定へ進める前提が成立していない。

### Decision
- 親ADRの契約値は次を参照専用で固定する（変更不可範囲）。
  - `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`
  - `schemaVersion=1.0.0`
  - `overridePolicy=human_dual_control_only`
  - `safeModeDefault=ON`
  - `safeModeBoundary=SAFE_MODE_STRICT_ON`
  - `decisionQueueTransition=Pending -> Approved | Pending -> Rejected`
- 将来拡張余地は `v2` 追加のみに限定し、`v1` 必須キー集合と失敗意味論は維持する。
- `Approval Record` 未充足時は `Proceed=Needs-decision/Hold` を維持し、推測確定を行わない。

### Consequences
- A2/A3は読み取り専用の引き渡しのまま進行し、契約再定義を実施できない。
- 契約ID改変、SafeMode境界緩和、Pending bypassをNo-Goとして維持できる。

## Stream A serial contract freeze addendum（2026-05-10）

### Phase 1: Read & Diff Check
- 対象（ADR-0026 / RS-01親Issue / RS-01-A1 / RS-02親 / RS-02-A1 / RS-02-A3）を再読し、依存順 `A1 -> A2 -> A3` を確認した。
- 差分確認の観点は `fixed keys`・`approval record`・`gate equation`・`A2/A3 open条件` に限定し、契約ドリフトの有無のみを判定対象とした。

### Phase 2: ADR明文化（Context / Decision / Consequences）
- Context: A1契約が未承認のままA2/A3側で判定式や語彙が増減すると、読み取り専用の引き渡し原則が崩れる。
- Decision: 親ADRは契約値の**再定義を行わない参照専用ノード**として固定し、Proceed判定は `Needs-decision/Hold` を維持する。
- Consequences: 承認完了まで下流は準備作業のみ可能、契約変更と実装指示は不可。

### Phase 3: Contract Freeze（読み取り専用の契約）
- APIシグネチャ（固定）
  - `HIL_RS_DECISION_GATE_V1(issueId, phase, approvalRecord) -> {gateStatus, held[]}`
  - `HIL_RS_PATCH_PROPOSAL_V1(sourceBundleHash, proposalId, actor) -> {patchDraft, riskLabels[]}`
  - `HIL_RS_APPLY_JUDGEMENT_V1(proposalId, humanDecision, approvedBy) -> {applyResult, rollbackRef}`
- 最小データ型（固定）
  - `ApprovalRecordV1 = { approved_by: string|null, approved_at: string|null, evidence: string|"pending" }`
  - `GateStatusV1 = "go" | "conditional" | "no-go"`
  - `DecisionQueueTransitionV1 = "Pending->Approved" | "Pending->Rejected"`
- 監査イベント名（固定）: `query`, `bundle`, `proposal`, `apply`。
- モックを許可する境界
  - 許可: 入出力の型適合検証、監査イベント4点セット検証、`Pending` 時の `Hold` 判定検証。
  - 不許可: 状態遷移の確定、契約ID/キー集合/失敗意味論の変更、SafeMode境界緩和。

### Phase 4: Proceed Gate
- Go条件: `a1Status=="Done" && pendingDecisionQueueCount==0 && fixedKeyDrift==0 && undefinedConflictDetected==false`
- Hold条件: `pendingDecisionQueueCount>0`
- Stop条件: `pending bypass` / `contract redefinition` / `fixed key drift>0` / `safeMode retreat` / `undefined conflict`
- 現在判定（2026-05-10）: **Hold/Needs-decision**。


## Stream A alignment update（2026-05-07 / Phase 1-5）

### Phase 1: ADR整合確認（再Read実施）
- 再読対象: `ADR-0026` / `issue-HIL-RS-01-A1-architecture-minimum-interface-contract.md` / `issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis.md`。
- Context差分: 本ADRは「親計画の実行順序と統治原則」、A1は「最小契約SSOT」、親Issueは「参照運用」の責務に分離されている。
- Decision差分: 固定契約値の正本はA1であり、ADR-0026は再定義せず参照する。
- Consequences差分: 未承認項目（Approval Record / GOV-EXCEPTION）が残る間は `Hold/Needs-decision` を維持。

### Phase 2: 契約最小I/F固定（参照ルール）
- 本ADRで固定するのは「A1契約を参照専用とする統治ルール」のみ。
- 下流依存はモック参照で切断し、外部レーン完了待ちを開始条件にしない。

### Phase 3: 親Issue反映ポリシー
- 親issueにはA1固定契約の読み取り専用参照・Gate条件・Hold運用のみ反映する。
- 未承認論点は `Hold list` に隔離し、推測で確定しない。

### Phase 4: 検証
- AC/DoD照合: pass（固定語彙再定義なし、SafeMode後退なし、Pending bypass禁止）。
- リンク整合: pass（NoGo return pathはA1 Issueを維持）。
- 状態遷移妥当性: pass（`Pending -> Approved | Rejected` 以外を不許可）。
- 自己修正: `0/3`。

### Phase 5: 完了報告（Stream A）
- 変更要約: ADR-0026は「契約再定義禁止・A1参照専用・Hold継続」を明文化。
- 残リスク: 人間最終承認ログ未充足時はProceed不可。
- 他ストリーム契約固定点: `freezeContractId` / `contractIds` / `schemaVersion` / `overridePolicy` / `safeModeBoundary` は読み取り専用。


## Stream A addendum（2026-05-09 / contract freeze and minimum interface agreement）

### Context
- Stream Aの目的は「契約凍結と最小I/F合意」を最短で確定し、A2/A3を契約再解釈から保護すること。
- 未承認項目（`Approval Record`, `HIL-RS-02-GOV-EXCEPTION-01`）が残るため、承認済み契約と承認待ちを分離して扱う必要がある。

### Decision
- 固定契約（実装へ渡す不変領域）
  - `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`
  - `contractIds=A1-CRITIQUE-IF|A1-REDIFF-IF|A1-ATTR-IF|A1-ERROR-IF`
  - `schemaVersion=1.0.0`
  - APIシグネチャ: `CritiqueV1`, `ReDiffV1`, `AttributionV1`, `A1ErrorV1`
  - `overridePolicy=human_dual_control_only`
  - `safeModeDefault=ON`, `safeModeBoundary=SAFE_MODE_STRICT_ON`
  - `decisionQueueTransition=Pending -> Approved | Pending -> Rejected`
  - 解放のゲート: `A2A3_OPEN_ALLOWED`（同値条件を含む）
- 変更可能領域（実装準備で可変）
  - モックを先に作る検証手順
  - 引き渡しの記述の可読性改善
  - 理由コードの補助説明（意味不変）

### Consequences
- A2/A3はモック依存で先行可能（backend完了待ち不要）だが、契約キー・型・版の再定義は不可。
- 検証に失敗したときの自己修正は最大3回とし、超過したときは停止する（推測での実行を禁止する）。
- `pendingDecisionQueueCount>0` の間、判定は `Hold/Needs-decision` を維持する。


## Stream A serial execution record（2026-05-09 / HIL-FB contract freeze gate）

### Phase 1: Read同期
- 対象再読: `ADR-0026`, `issue-HIL-RS-01-A1-architecture-minimum-interface-contract.md`, `issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis.md`, `issue-FB-P0-2A2B2C-stream-c-planning-baseline.md`, `issue-FB-P2C-01-a1-interface-contract.md`。
- 差分記録（Status/Priority/Dependencies/AC/DoD）
  - `ADR-0026`: `Status=Accepted`（維持）
  - `HIL-RS-01 parent`: `Status=In Progress`, `Priority=P1`
  - `HIL-RS-01 A1`: `Status=In Progress`, `Priority=P1`
  - `FB-P0 baseline`: `Status=Open`, `Priority=P0`
  - `FB-P2C A1`: `Status=Open`, `Priority=P0`
- 不一致ログ: `HIL-RS系がIn Progress` と `FB系がOpen` で進捗段階が異なるため、Proceed判定を `Hold/Needs-decision` のまま維持する。

### Phase 2: ADR明文化（Context / Decision / Consequences）
- Context: クリティカルパスは `A1契約凍結` が唯一ゲートであり、親計画・baselineでの再定義は契約ドリフトを招く。
- Decision: 本ADRでは固定キー（`freezeContractId`, `schemaVersion`, `overridePolicy`, `safeModeDefault`, `safeModeBoundary`, `decisionQueueTransition`）を参照専用で維持し、承認待ち2件の確定化を行わない。
- Consequences: `pendingDecisionQueueCount>0` の間は `Go` 不可、`Hold/Needs-decision` を継続する。

### Phase 3-6: Plan / Execute / Verify / Proceed
- Plan: 実施範囲を文書のみに限定し、契約再定義を禁止。
- Execute: 追記は本節のみ（既存契約値と判定式の更新なし）。
- Verify: `A2A3_OPEN_ALLOWED` 判定式、SafeMode境界、承認遷移語彙のドリフト `0` を再確認。
- Proceed: 未承認項目が残るため `Hold`。

## Stream A gate lock note（2026-05-10）

### Context
- A1契約凍結未完了時にProceedを許可すると、統治ゲートが形式化されず下流でPending bypassが発生しうる。

### Decision
- `decisionQueueTransition=Pending -> Approved | Pending -> Rejected` を唯一許容遷移として固定継続する。
- `Approval Record=Pending` の間は `Proceed=Hold/Needs-decision` を強制し、Goへ遷移しない。

### Consequences
- 契約凍結と統治ゲートが同時にロックされ、A2/A3の強行Openを防止できる。

## Stream A serial governance checkpoint（2026-05-20）

### Context
- Stream A（critical path）はHIL-RS契約・統治計画の上流整合を維持し、A1→RS-02-A1→parent Proceedの依存順を崩さないことを最優先とする。
- 現時点でも `Approval Record` 未充足により、`Proceed=Go` 条件は未成立である。

### Decision
- 親ADRでは契約固定値を再定義せず、以下を読み取り専用維持する。
  - `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`
  - `schemaVersion=1.0.0`
  - `overridePolicy=human_dual_control_only`
  - `safeModeDefault=ON`
  - `safeModeBoundary=SAFE_MODE_STRICT_ON`
- ゲートは既存の式を継続し、`Pending` 残存時は `Hold/Needs-decision` を強制する。

### Consequences
- A1/RS-02-A1/親計画の契約語彙ドリフトを抑制し、下流の誤解放を防止できる。
- 人間承認が揃うまで `Conditional/Needs-decision` を維持し、推測確定を行わない。

## Stream A boundary declaration（2026-05-20）

### Context
- クリティカルパス継続のため、Stream Aは契約凍結（A1）と統治ゲート（RS-02-A1）を先に固定し、下流レーンの実装待ちを作らない必要がある。

### Decision
- 競合を防ぐため、ファイル単位の境界を以下で固定する。
  - Stream A: `ADR-0026/0027/0028`、`issue-HIL-RS-01-*`、`issue-HIL-RS-02-A1-*`、`issue-CE0-contract-freeze.md`
  - Stream B/C等: 上記以外（特にA2/A3のissue、実装コード、ダッシュボード）
- Stream Aは `contract/value/governance` 記述のみ更新し、実装仕様確定・コード変更を行わない。

### Consequences
- 競合可能性は `issue-CE0-contract-freeze.md` のみ（Stream B担当と重複）であり、更新時は「契約語彙の再定義禁止・追記のみ」を厳守する。
- A2/A3は本ADR群の読み取り専用の契約の要約を参照してモック実装の準備を継続できる。


## Stream A serial governance pass (2026-05-20)

### Phase 1: Read Gate
- 対象ファイルを再読し、Status/AC/依存を監査した。
- `Approval Record=Pending` と `HIL-RS-02-GOV-EXCEPTION-01=held` を未解決として確認した。

### Phase 2: ADR明文化
- Context/Decision/Consequencesを再確認し、固定契約を再定義しない方針を継続する。
- 変更禁止契約（minimum I/Fと承認ゲート）を読み取り専用参照として固定する。

### Phase 3: Issue整合
- AC / Validation plan / Non-goalsをADR-0026, ADR-0027と語彙一致させた（drift=0）。
- `Pending -> Approved | Pending -> Rejected` 以外の遷移を追加しない。

### Phase 4: Governance hardening
- SoD（二者承認と実行責務分離）を維持し、`approver_a != approver_b` 制約を継続する。
- 停止条件（pending bypass / contract drift / safeMode後退 / 未定義競合）を固定した。

### Phase 5: Verify-1
- 用語一致（Security Officer / System Owner / Platform Operator）を確認した。
- 固定値D1〜D4とゲート式（Proceed/Hold/Stop）の整合を確認した。
- 未承認事項を確定扱いにしていないことを確認した。

### Phase 6: Self-correction
- 不一致検知なし。修正ループ実行回数: 0/3。

### Phase 7: Publish-ready
- 次ストリーム非依存で読めるよう、判定根拠・停止条件・読み取り専用の引き渡しを明示した。

### Phase 8: Final status
- 判定: **Hold/Needs-decision**（`pendingDecisionQueueCount>0` のため）。
- Stop条件適用: なし（検証失敗・未定義競合は検出せず）。

## Stream D HIL-RS governance contract clarification（2026-06-13）

### Context
- 本追記はHIL-RS系の契約・統治・承認在庫整理に限定し、Frontend/UI/E2E/04運用文書の実装・編集には進まない。
- 依存順は `HIL-RS-01-A1 minimum I/F -> HIL-RS-02-A1 governance hardening -> HIL-RS-01 parent Proceed` を維持する。
- `Approval Record` が `Pending` の間は `pendingDecisionQueueCount>0` とみなし、Proceed Goを出してはならない。

### Decision
- HIL-RS最小I/Fは次の契約語彙を読み取り専用で下流へ渡す。
  - 入力: `issueId`, `phase`, `sourceBundleHash`, `proposalId`, `approvalRecord`, `policySnapshot`。
  - 出力: `gateStatus`, `held[]`, `patchDraft`, `riskLabels[]`, `applyResult`, `rollbackRef`。
  - 監査イベント: `query`, `bundle`, `proposal`, `apply`。4種のうち欠損がある場合はNo-GoまたはHoldとする。
- `Approval Record` は `approved_by`, `approved_at`, `evidence`, `decision`, `segregation_of_duties_check` が揃うまで `Pending` として扱う。
- AI候補は常にproposal-onlyであり、`human_reviewed` 昇格、auto-apply、SafeMode後退、未承認の共有/export解放を禁止する。
- rollbackは `rollbackRef` を必須証跡とし、適用判断の前後を可逆に辿れる状態だけを契約上の成立条件にする。

### Consequences
- ADRのStatusは変更しない。人間承認の証跡なしに `Accepted` 以外の新状態やProceed Goを推定しない。
- A2はFrontend実装レーン、A3はDocs/Ops同期レーンへ渡す準備情報だけを受け取り、本Streamでは実装や `04_Documentation/` 編集を行わない。
- 親issueは `Approval Record=Pending` または保留項目の残存時に `In Progress継続 / Hold` と分類し、`pendingDecisionQueueCount==0` になるまでGoを保留する。
