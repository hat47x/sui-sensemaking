# ADR-0027: HIL-RS-02 次フェーズ実行計画（議論→決定→文書化→同期）

- Status: Accepted (Stream C alignment update: 2026-05-06)
- Date: 2026-03-14
- Deciders: Project Maintainers
- Scope: `01_Plans/`, `02_Architecture/`, `03_Implement/frontend/`, `04_Documentation/`
- Source Issue: `01_Plans/issues/done/issue-HIL-RS-02-next-phase-delivery-plan.md`
- Related: `ADR-0026`, `00_Prompt/domain.md`, `02_Architecture/architecture.html`, `02_Architecture/schemas.md`

## Context

`ADR-0026` はHIL-RS-01の価値軸とA1→A2→A3の契約先行を固定した。
一方で、次フェーズ着手に必要な「会議ログの定型」「Decision Queueの未確定管理」「dashboard同期手順」は単一文書として固定されていない。
このままでは、議論と実行ログが分散し、再開時に判断根拠が追跡しづらい。

## Decision

次フェーズを **HIL-RS-02** とし、以下を固定する。

### D1. 実行境界

- HIL-RS-02は「議論→意思決定→文書化→進捗同期」を1サイクルで完結させる計画フェーズとする。
- 変更はDocs/Planを主対象とし、実装変更はA2/A3 issueがOpen化されるまで行わない。

### D2. 安全・統治制約（非機能）

- SafeMode既定ON、share/export漏えい防止、責務分離（human_dual_control_only）を後退させない。
- 未確定項目はDecision Queueへ記録し、確定扱いしない。

### D3. 依存順序

1. Umbrella issue（HIL-RS-02）でAC/非スコープ/検証計画を固定する。
2. A1（Governance contract hardening）をOpen化し、A2/A3の着手条件を明示する。
3. A2（frontend適用）/A3（ops & docs同期）はDraftで先行準備し、A1完了後にOpen化する。

### D4. Exit Criteria

- EC-1: 議事録が作成され、論点ごとの「提案・懸念・反証・結論」を含む。
- EC-2: ADRにContext/Decision/Consequences/Alternatives/Rollbackが存在する。
- EC-3: issue分解が最小実行単位（umbrella + A1/A2/A3）で作成される。
- EC-4: `project-progress-dashboard.md` と `issues/README.md` のActive / Decision Queue / 次の1手が同期される。
- EC-5: docs-check（validator + unittest + diff check）が成功する。

### D5. HIL-RS凍結I/F（Contract/Governance）

- Freeze Pack ID: `HIL-RS-02-A1-CONTRACT-FREEZE-v1`
- Contract IDs（変更禁止）
  - `A1-CRITIQUE-IF`
  - `A1-REDIFF-IF`
  - `A1-ATTR-IF`
  - `A1-ERROR-IF`
- Fixed identifiers（変更禁止）
  - `schemaVersion=1.0.0`（Critique / Attribution / TieBreak / Error）
  - `overridePolicy=human_dual_control_only`
  - `contractLinkLocked=true`
  - `sharedResourceFreeze=true`
- SSOT（単一参照先）
  - `02_Architecture/hil_rs_01_a1_minimum_interface_contract.md`

### D6. 固定状態遷移 / 停止条件

- State transitions（固定）
  - A2/A3公開判定: `Draft -> Open` は `A1 Done` かつ `DecisionQueue Pending=0` のときのみ許可。
  - Decision Queue: `Pending -> Approved` または `Pending -> Rejected` のみ許可。
- 禁止遷移
  - `Pending` を経由しない確定化。
  - A1完了前のA2/A3 `Draft -> Open`。
- Stop conditions（即停止）
  1. 契約ID / schemaVersion / overridePolicy / SSOTの不一致。
  2. SafeMode既定ON、share/export漏えい防止、`human_dual_control_only` の後退要求。
  3. 凍結対象共有リソース（dashboard/README）への未承認更新要求。

### D7. 最小インターフェース契約（HIL-RS/CE0 bridge）

- 契約は「型先行」で固定し、実装詳細（ロジック/画面挙動）は後続で確定する。
- 最小監査イベントは `query` / `bundle` / `proposal` / `apply` の4点セットを必須とし、欠損時はNo-Go。
- `A1 -> A2 -> A3` への引き渡しは次の署名をcanonicalとする。

| Signature ID | Input | Output | Failure |
| --- | --- | --- | --- |
| `A1-GOV-GATE-V1` | `approvalRecord`, `decisionQueueState` | `gateStatus`, `held[]` | `no_go_reason` |
| `A2-PROPOSAL-ENVELOPE-V1` | `sourceBundleHash`, `proposalId`, `policySnapshot` | `proposalEnvelope` | `schema_mismatch` |
| `A3-DOC-SYNC-CHECK-V1` | `contractId`, `syncTargets[]`, `auditDigest` | `syncResult`, `drift[]` | `drift_detected` |

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 「議論→意思決定→文書化→進捗同期」を1サイクルで完結させる計画フェーズとし、議論と実行ログの分散による判断根拠の追跡困難を防ぐ。会議ログ定型・Decision Queue未確定管理・dashboard同期を単一文書として固定する | 機能: A1（Governance contract hardening）をOpen化し、A2（frontend適用）/A3（ops & docs同期）はDraftで先行準備、A1完了後にOpen化。データ: 実装変更はA2/A3 issueがOpen化されるまで行わない |
| **データ設計** | 未確定項目はDecision Queueへ記録し確定扱いしない。HIL-RS凍結I/F（A1-CRITIQUE-IF等のContract IDs）は変更禁止。SafeMode既定ON・share/export漏えい防止・責務分離（human_dual_control_only）を後退させない | 業務: 議事録は論点ごとに「提案・懸念・反証・結論」を含む。機能: docs-check（validator+unittest+diff check）がExit Criteriaとして成功必須 |
| **機能設計** | Exit Criteria（EC-1議事録/EC-2 ADR完全性/EC-3 issue最小分解/EC-4 dashboard同期/EC-5 docs-check）を固定。planフェーズの判断根拠を1サイクルで追跡可能にする | 業務: 実装速度より監査容易性を優先し短期速度は低下する。データ: Active issue数が増え同期ドキュメントの更新コストが増加する |

## Consequences

- 期待される効果
  - 計画フェーズの判断根拠が1サイクルで追跡可能になる。
  - A1依存を明示することで、A2/A3の手戻りを抑制できる。
- 副作用と制約
  - Active issue数が増え、同期ドキュメントの更新コストが増加する。
  - 実装速度より監査容易性を優先するため短期速度は低下する。

## Alternatives

- 代替A（不採用）: HIL-RS-02を1 issueに集約する。
  - 不採用理由: 依存/責務境界が見えず、停止条件判定が不安定。
- 代替B（不採用）: A2/A3を即Open化して並列開始する。
  - 不採用理由: A1契約差分による再作業リスクが高い。

## Rollback

- ロールバック条件
  1. 上位層（00〜02）との矛盾が検出された場合
  2. SafeMode/漏えい防止/責務分離の後退が必要になった場合
- ロールバック手順
  1. HIL-RS-02-A2/A3をDraft維持またはOpenからDraftへ戻す。
  2. A1 issueへ変更要求を差し戻し、Decision Queueへ未確定として登録。
  3. 必要時は本ADRをSupersededとし、上位ADR改訂後に再起票する。

## Stream J Audit（ADR連動監査: active issue基準）

### Read

- `01_Plans/issues` のactive status（Draft/Open/In Progress）と `triage_actionable_plans.py` の逆引き結果で、監査対象ADRを抽出した。
- 対象: `ADR-0026` / `ADR-0027`（active issue直結）。

### ADR/CDC

- 監査対象2件について `Context` / `Decision` / `Consequences` の欠損有無を確認した。
- 判定: 欠損なし（未処理ADR 0件）。

### Plan

- 欠損ADRがある場合のみ、該当ADRへ欠損見出しを最小追記する。
- 欠損がない場合は、active issue連動観点で「追加補完不要」を本文に固定する。

### Execute

- 今回はCDC欠損が0件のため、補完項目の宣言と判定記録のみを最小追記した。

### Verify

- docs-checkを `validator + unittest + triage` の組み合わせで再実行し、監査記録と整合することを確認する。

### Proceed（issue逆引き表）

| Active issue | 連動ADR | CDC欠損 | 対応 |
| --- | --- | --- | --- |
| `issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis` | `ADR-0026` | なし | 追加補完不要 |
| `issue-HIL-RS-02-next-phase-delivery-plan` | `ADR-0027` | なし | 追加補完不要 |

## Traceability

- Related: `01_Plans/issues/done/issue-HIL-RS-02-next-phase-delivery-plan.md`
- Related: `01_Plans/issues/done/issue-HIL-RS-02-A1-governance-contract-hardening.md`
- Related: `01_Plans/issues/done/issue-HIL-RS-02-A2-frontend-reversible-synthesis-application.md`
- Related: `01_Plans/issues/done/issue-HIL-RS-02-A3-operations-documentation-sync.md`
- Derived-from: `ADR-0026`


## Stream A serial execution update（2026-04-29）

### Plan（対象/非対象宣言）
- 対象: `ADR-0026/0027` とHIL-RS-01/02 issue（許可リスト内）
- 非対象: 実装コード、dashboard、許可リスト外issue。

### Execute（HIL-RS-01-A1 -> HIL-RS-02-A1 -> next-phase）
1. HIL-RS-01-A1契約固定の再確認（fixed keys driftなし）。
2. HIL-RS-02-A1統治ゲート（Pending bypass禁止・NoGo return path固定）を再確認。
3. next-phase計画は `Approval Record` 完了までDraft/Conditionalを維持。

### Verify（AC/DoD照合）
- AC: fixed keys diff=`0`、`unlockRule` 一致、`Pending -> Approved/Rejected` 以外の遷移追加なし。
- DoD: `Plan -> Execute -> Verify -> Proceed` を維持し、self-correctionは `0/3`。
- ゲート結果: **Conditional**（承認待ち継続）。

## Stream A contract-governance checkpoint（2026-04-29）

### 読み取り結果（許可リストのみ）
- `schemaVersion=1.0.0` / `overridePolicy=human_dual_control_only` / `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1` / `safeModeDefault=ON` を再照合し、差分 `0` を確認。

### Proceed gate
- 固定遷移: `Pending -> Approved | Pending -> Rejected` のみ許可。
- 禁止遷移: `Pending bypass`、`A1 Done前の A2/A3 Draft->Open`。
- 判定: **Conditional / Needs-decision**（承認証跡 `approved_by` / `approved_at` / `evidence` 未入力）。


## Stream A interface-first freeze record (2026-04-29)

### Context
- HIL-RS-02は後続ストリームの参照契約であり、A1完了前にA2/A3が契約更新を行うと統治ドリフトが発生する。

### Decision
- 後続参照契約（用語・責務・入出力境界）を以下で固定する。
  - 用語: `Security Officer` / `System Owner` / `Platform Operator`
  - 責務: `human_dual_control_only`
  - 境界: `NoGo return path = issue-HIL-RS-01-A1-architecture-minimum-interface-contract.md`（固定）
- 実装を伴う箇所はモック契約で代替し、A3は `mock I/F preparation only` を維持する。

### Consequences
- 契約値の再定義を防ぎ、A2/A3はインターフェース準備のみを先行できる。
- 承認入力（`approved_by` / `approved_at` / `evidence`）が揃うまでGo判定は行わない。

### Gate equation（再掲・固定）
- `A2A3_OPEN_ALLOWED = (a1Status=="Done" && pendingDecisionQueueCount==0 && freezeContractId=="HIL-RS-02-A1-CONTRACT-FREEZE-v1" && schemaVersion=="1.0.0" && overridePolicy=="human_dual_control_only" && contractLinkLocked==true && sharedResourceFreeze==true && safeModeDefault=="ON" && safeModeBoundary=="SAFE_MODE_STRICT_ON")`
- `NoGo = (!A2A3_OPEN_ALLOWED) || pendingBypassDetected || undefinedConflictDetected`

## Stream A critical-path contract freeze update（2026-04-30）

### Phase 1: Read（Status / Decision / 未解決論点の再棚卸し）
- Read対象: `ADR-0026` / `ADR-0027` / `issue-HIL-RS-02-A1-governance-contract-hardening.md` / `issue-HIL-RS-02-next-phase-delivery-plan.md` / `02_Architecture/hil_rs_01_a1_minimum_interface_contract.md`。
- Status要約
  - A1契約固定値（`freezeContractId` / `schemaVersion` / `overridePolicy` / `safeModeDefault`）は差分 `0`。
  - A2/A3開放条件は `A2A3_OPEN_ALLOWED` の固定式を継続参照。
  - `Approval Record: Pending` と `held` 論点が残存。
- 未解決の論点
  1. `approved_by`
  2. `approved_at`
  3. `evidence`

### Phase 2: ADR明文化（Context / Decision / Consequences）
- Context: HIL-RS/CEの上位契約を先行固定しない場合、A2/A3で契約派生が発生し依存順が崩れる。
- Decision: `HIL-RS-02-A1-CONTRACT-FREEZE-v1` と `schemaVersion=1.0.0` を上位契約の固定参照として維持し、A2/A3はmock/contract参照のみに限定する。
- Consequences: 承認証跡が未入力の間は `Conditional / Needs-decision` を維持し、実装確定へ進まない。

### Phase 3: 契約凍結（インターフェースのみ）
- 固定対象I/F: `A1-CRITIQUE-IF` / `A1-REDIFF-IF` / `A1-ATTR-IF` / `A1-ERROR-IF`。
- 責務境界: `overridePolicy=human_dual_control_only`、`Pending -> Approved | Pending -> Rejected` 以外は禁止。
- 外部依存の扱い: A2/A3は `readOnly=true` のcontract artifact参照で吸収し、待機依存を作らない。

### Phase 4: 整合チェック（Issue/ADRリンク・用語・優先度）
- リンク整合: `ADR-0026`/`ADR-0027` ⇄ HIL-RS-02 A1 / next-phase issueの相互参照を維持。
- 用語整合: `safeModeDefault=ON` / `safeModeBoundary=SAFE_MODE_STRICT_ON` / `human_dual_control_only` を統一。
- 優先度整合: critical path（A1先行、A2/A3後続）を維持。
- self-correction: `0/3`（不整合未検知）。

### Phase 5: 完了判定
- 判定: **Conditional / Needs-decision**。
- DoD達成状況
  - 契約固定と依存順固定は達成。
  - 未解決論点（承認証跡3項目）が残るためGoは未達。
- 次アクション: 人間承認入力完了後に同一判定式で再検証する。

## Stream A Phase-5 handover artifacts（次ストリーム非依存）

### 固定I/F一覧（変更禁止）
- `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`
- `contractIds=A1-CRITIQUE-IF|A1-REDIFF-IF|A1-ATTR-IF|A1-ERROR-IF`
- `schemaVersion=1.0.0`
- `overridePolicy=human_dual_control_only`
- `safeModeDefault=ON`
- `safeModeBoundary=SAFE_MODE_STRICT_ON`
- `decisionQueueTransition=Pending -> Approved | Pending -> Rejected`
- `NoGo return path=issue-HIL-RS-01-A1-architecture-minimum-interface-contract.md`

### 判定テンプレート（Go / Conditional / No-Go）
```md
[HIL-RS Gate Decision]
- As of (UTC)
- Target stream
- A2A3_OPEN_ALLOWED: true|false
- Approval Record
  - approved_by
  - approved_at
  - evidence
- DecisionQueue
  - pending_count
  - transition_rule_match: true|false
- Drift check
  - fixed_keys_diff_count
  - pending_bypass_detected: true|false
  - undefined_conflict_detected: true|false
- Result: Go | Conditional | No-Go
- If No-Go
  - cause
  - impact_interface
  - required_human_approval
```

## Stream A execution constraint addendum（型のみ変更する境界）

### Context
- HIL-RS-02ではA1契約を先行固定し、A2/A3は読み取り専用参照で進行する前提である。
- そのため、A1作業でロジック実装差分が混入すると `Plan -> Execute -> Verify -> Proceed` の検証軸が崩れる。

### Decision
- Stream AのExecuteは **A1契約の型定義更新のみ** を許可する。
- 禁止: 実装ロジック変更、runtime挙動変更、A2/A3のOpen化条件変更、`Pending` bypassの導入。
- Verifyではdocs-checkと契約整合（4点セット一致）を必須化し、失敗時は最大3回まで自己修復する。

### Consequences
- 契約凍結のまま文書品質を改善でき、下流レーンの参照安定性が向上する。
- 検証失敗時の復旧手順が明確化され、安全側へ止める停止条件との整合が保たれる。


## Stream A contract freeze checkpoint（2026-05-04 / critical path）

### Phase 1: Read
- 許可リスト対象（ADR-0026/0027/0028 + FB-P2C + FB-P0 baseline + HIL-RS-01/02 issue）を再読した。
- `triage_actionable_plans.py` の結果で `FB-P2C-01` / `FB-P0-2A2B2C` が `Ready` であること、active ADRが `ADR-0026/0027` のみであることを確認した。

### Phase 2: CDC
- Context: `A1 -> A2 -> A3` 依存維持にはA1契約を唯一ゲートとして凍結し続ける必要がある。
- Decision: `HIL-RS-02-A1-CONTRACT-FREEZE-v1` と固定式 `A2A3_OPEN_ALLOWED` を再定義せず運用継続する。
- Consequences: `Approval Record` 未充足時はProceedを `Conditional / Needs-decision` に固定する。

### Phase 3-5: Plan / Execute / Verify
- 固定I/Fの引き渡しは `A1-CRITIQUE-IF` / `A1-REDIFF-IF` / `A1-ATTR-IF` / `A1-ERROR-IF` の4点を読み取り専用に限定する。
- Self-Correctionは `0/3`。即時停止条件（前提崩壊 / 未定義競合 / 許可リスト外編集要求 / 4回目相当）は未発火。
- Proceed判定: **Conditional / Needs-decision**（`approved_by` / `approved_at` / `evidence` が未入力）。


## Stream B Planning Sync Addendum（2026-05-04）

### Context
- HIL-RS-02ではA1依存が明示されている一方、Issue実務ではAC/DoDの不足判定とblocker記法が不統一で、triage出力のReady/Blocked判定に揺れがあった。

### Decision
- HIL-RS-02配下Issueの運用規則として以下を固定する。
  - Ready条件は `contract-ready`（契約キー一致）と `execution-ready`（承認充足）を分離して記録する。
  - Blockerは `contract_mismatch` / `approval_pending` / `decision_queue_pending` / `out_of_scope_request` の4分類へ正規化する。
  - AC/DoD不足時はPhase 2（ADR/CDC）でドラフト補完し、合意完了まで `held` を維持する。

### Consequences
- triage CLIの再計算時にunlocks判定の機械可読性が上がる。
- 実装依存の曖昧な待ち状態を削減し、契約依存ベースで並行可能な作業を可視化できる。


## Stream C Alignment Update（2026-05-06）

### Context
- HIL-RS-02 deliveryとA3 operations syncを、他ストリーム非依存で実行するために、実務フェーズを5段へ再編した。
- 既存の統治制約（SafeMode既定ON、human_dual_control_only、A1先行依存）は維持が必須。

### Decision
- Stream Cの実行規律をADRレベルで固定する。
  1. フェーズ固定: `Read -> ADR整合 -> Delivery具体化 -> 運用同期条件定義 -> Verify`
  2. 各フェーズ必須: `Plan -> Execute -> Verify -> Proceed`
  3. Self-correction上限: `<=3`（4回目相当は即停止）
  4. A3 Open条件: `A1 Done` かつ `pendingDecisionQueueCount==0` を満たすまで `Conditional` 維持
  5. 運用同期観点: 用語一致（Security Officer / System Owner / Platform Operator）、2者承認と実行責務分離、DOC-OPS-02の固定同期順序を必須化

### Consequences
- delivery計画と運用同期計画の判定軸が一本化され、再開時の判断負荷が下がる。
- A1未完時の先行Openを防止しつつ、準備作業（docs planning）は継続可能となる。
- 競合判定は `許可リスト外差分ゼロ` を必須化し、越境編集を抑止する。

## Stream A Contract Freeze synchronization（2026-05-07）

### Context
- HIL-RS-02はA1契約凍結を唯一ゲートとして扱う必要があり、実装準備と契約確定の混線を防止する必要がある。

### Decision
- Contract Freeze Pack `HIL-RS-02-A1-CONTRACT-FREEZE-v1` を継続参照し、次を固定する。
  - API signature群: `A1-CRITIQUE-IF|A1-REDIFF-IF|A1-ATTR-IF|A1-ERROR-IF`
  - `schemaVersion=1.0.0`（v1互換固定）
  - `A2A3_OPEN_ALLOWED` 判定式の前提（`a1Status=="Done" && pendingDecisionQueueCount==0`）
- 変更不可範囲: 契約ID変更、`schemaVersion` 改版、Pending bypass、SafeMode境界後退。
- 将来拡張余地: v2契約の追加（v1非破壊）と監査イベント拡張のみ。

### Consequences
- A1未承認時は `Hold/Needs-decision` 維持となり、A2/A3のOpen化を防止できる。
- 下流はモック先行で検証継続できるが、契約再定義は不可となる。

## Stream A Critical Path update（2026-05-10 / contract freeze and governance gate finalization）

### Phase 1: Read & Contract Inventory
- 対象再読: `ADR-0026` / `ADR-0027` / `ADR-0028` / `issue-HIL-RS-01-*` / `issue-HIL-RS-02-*` / `issue-CE0-contract-freeze.md`。
- Status抽出
  - HIL-RS-01 parent: `In Progress`
  - HIL-RS-01 A1: `In Progress`
  - HIL-RS-02 delivery: `Ready`（ただし `Proceed=Hold`）
  - CE0 contract freeze: `Open`（SSOT freeze lane）
- 契約ID棚卸し（読み取り専用固定）
  - `HIL-RS-02-A1-CONTRACT-FREEZE-v1`
  - `A1-CRITIQUE-IF` / `A1-REDIFF-IF` / `A1-ATTR-IF` / `A1-ERROR-IF`
  - `CE0-CTX-IF` / `CE0-SAFEMODE-IF` / `CE0-REVIEW-IF` / `CG-01..05`
- 固定した遷移制約
  - `decisionQueueTransition=Pending -> Approved | Pending -> Rejected`
  - `Pending bypass` は禁止（未承認確定化禁止）

### Phase 2: ADR明文化（Context / Decision / Consequences）
#### Context
- クリティカルパスは契約凍結と統治ゲート確定であり、未承認項目をbypassするとA1->A2->A3依存が破綻する。

#### Decision
- Stream Aは契約キー・遷移制約・safeMode境界を再定義せず、`Pending` を明示的に `Hold/Needs-decision` として維持する。
- 人間承認待ち箇所（Approval Record未充足、GOV exception held）は `Pending` のまま保持し、Open/Goへ昇格しない。

#### Consequences
- 下流はモック先行で準備継続できるが、契約再解釈余地は封じられる。
- 未承認在庫が0になるまで `Proceed=Hold` を維持するため、統治上の抜け道が閉じる。

### Phase 3: Plan -> Execute -> Verify
- Plan（AC/DoD）
  - AC-1: 契約IDと固定値の再定義0件。
  - AC-2: `Pending -> Approved|Rejected` 以外の遷移追加0件。
  - AC-3: A1未完了時は `Proceed=Hold` 維持。
- Execute
  - 本更新はplanning/contract freeze文書明文化のみ（実装変更なし）。
- Verify
  - AC/DoD照合で矛盾0件。
  - self-correction使用回数 `0/3`。

### Phase 4: Proceed Gate
- 判定: **Hold/Needs-decision維持**。
- 理由: `Approval Record` が `Pending` のためunlock条件 `a1Status=="Done" && pendingDecisionQueueCount==0` が未成立。
- 停止条件: self-correction>3 / 前提崩れ / 未定義競合を検知した場合は即Stop。


## Stream A governance contract hardening update（2026-05-10）

### Context
- HIL-RS-02 A1は固定契約値（`freezeContractId` / `schemaVersion` / `overridePolicy` / `safeModeBoundary`）を維持しているが、Decision Queueに未承認IDが残存している。
- `Proceed=Go` は `A1 Done && pendingDecisionQueueCount==0` を満たす場合のみ許可される。

### Decision
- Stream Aは直列固定運用（Read Gate → ADR明文化 → Plan → Execute → Verify → Proceed判定）を維持する。
- 承認待ち（`approved_by`, `approved_at`, `evidence` 未充足、またはPending Decision ID残存）の間は `executeAllowed=false` を固定する。
- 禁止遷移（`Draft -> Approved`, `Pending -> Execute`, `Rejected -> Execute`）を追加例外なしで維持する。

### Consequences
- A1完了条件が明文化され、A2/A3の誤開放経路を継続遮断できる。
- 判定は `Hold/NoGo` 優先となり、承認証跡が揃うまでProceedは停止される。

### Pending Decision Queue（as of 2026-05-10）
- `PD-20260507-A1-001`（Approval evidence format）
- `PD-20260507-A1-002`（reviewerRef匿名化パターン）


## Stream A governance contract clarification（2026-05-18）

### Context
A1契約固定前にA2/A3が承認境界を実装すると、`Pending bypass` とローカル再定義のリスクが高い。

### Decision
- `A2A3_UNLOCK = (a1Status=="Done" && pendingDecisionQueueCount==0)` を唯一の解放条件として固定する。
- trusted human interaction境界を次で固定する。
  - AI: `decision/reasonCodes` の提示まで。
  - Human: 承認確定（2者承認）と例外判断。
- 禁止事項: `auto-confirm`, `auto-approve`, `Pending->Execute`, `Rejected->Execute`, `Draft->Approved`。

### Consequences
A2/A3はモックI/Fで先行実装可能だが、承認確定の責務はA1ガバナンス契約の外に持ち出せない。

## Stream A critical-path freeze handoff（2026-05-19）

### Phase 1: Read（契約未確定項目と依存差分）
- Read対象（許可リスト）: `ADR-0026`, `ADR-0027`, `issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis.md`, `issue-HIL-RS-02-A1-governance-contract-hardening.md`, `contract_reading_guide.md`, `runtime_parameter_registry.md`。
- 未確定項目（承認待ち）: `approved_by`, `approved_at`, `evidence`, `HIL-RS-02-GOV-EXCEPTION-01`。
- 依存関係固定: `HIL-RS-01-A1 -> HIL-RS-02-A1 -> A2/A3 unlock`（差分なし）。

### Phase 2: ADR明文化（Context / Decision / Consequences）
- Context: 承認入力未充足のままA2/A3を開放すると `Pending bypass` が発生し、統治契約違反となる。
- Decision: 承認待ち論点を `Decision Queue` に保持し、`Proceed=Hold/Needs-decision` を継続する。
- Consequences: 下流はmock検証のみ並行可。契約値更新・状態確定は禁止。

### Phase 3: 契約凍結（変更禁止境界）
- API signature（固定）: `A1-GOV-GATE-V1`, `A2-PROPOSAL-ENVELOPE-V1`, `A3-DOC-SYNC-CHECK-V1`。
- Data/type（固定）: `schemaVersion=1.0.0`, `overridePolicy=human_dual_control_only`, `safeModeDefault=ON`, `safeModeBoundary=SAFE_MODE_STRICT_ON`。
- Transition（固定）: `Pending -> Approved | Pending -> Rejected` のみ。
- 変更禁止境界: fixed keyの再定義、SafeMode後退、A1完了前のA2/A3 `Draft->Open`。

### Phase 4: 受け渡し仕様（B〜F向け）
- 固定済みI/F一覧
  - `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`
  - `contractIds=A1-CRITIQUE-IF|A1-REDIFF-IF|A1-ATTR-IF|A1-ERROR-IF`
  - `Decision gate`: `A2A3_UNLOCK = (a1Status=="Done" && pendingDecisionQueueCount==0)`
- 変更不可の項目
  - fixed keys（上記）
  - `overridePolicy=human_dual_control_only`
  - `decisionQueueTransition`
- mock許可項目
  - 監査4イベント（`query`,`bundle`,`proposal`,`apply`）の存在検証
  - 入出力型の適合検証
  - `pendingDecisionQueueCount>0` のHold判定検証

### Phase 5: 検証（AC/DoD + 依存再確認）
- AC/DoD判定: pass（契約差分 `0`、禁止遷移追加なし、SafeMode後退なし）。
- 未確定事項: `Approval Record` 3項目 + `HIL-RS-02-GOV-EXCEPTION-01`。
- 最終判定: **Conditional / Needs-decision**（人間承認待ち）。

## Stream A critical-path contract lock update（2026-05-20）

### Phase 1: Read / inventory
- 対象（許可リスト）再読結果
  - `HIL-RS-01 parent` = In Progress / P1
  - `HIL-RS-01-A1` = In Progress / P1
  - `HIL-RS-02-A1` = Open(In Progress運用) / P1
  - `CE0 contract freeze` = Open / P1
- 依存固定: `HIL-RS-01-A1 -> HIL-RS-02-A1 -> parent Proceed`、`HIL-RS-01-A1 -> CE0 contract freeze`。
- mock方針固定: `decision/executeAllowed/reasonCodes` まで先行可能、`Pending -> Approved|Rejected` 確定は人間のみ。

### Phase 2: ADR合意（Context / Decision / Consequences）
- Context: 承認待ちを残したままA2/A3相当の下流開放を行うと `Pending bypass` となり統治違反。
- Decision: `A2A3_UNLOCK = (a1Status=="Done" && pendingDecisionQueueCount==0)` を唯一ゲートとして継続固定。
- Consequences: `Approval Record` 未充足時は `Hold/Needs-decision` を維持し、Proceed=Goを出さない。

### Phase 3: HIL-RS最小I/F凍結（downstream mock可）
- API signatures（凍結）
  - `A1-GOV-GATE-V1(approvalRecord, decisionQueueState) -> (gateStatus, held[], no_go_reason)`
  - `A2-PROPOSAL-ENVELOPE-V1(sourceBundleHash, proposalId, policySnapshot) -> (proposalEnvelope | schema_mismatch)`
  - `A3-DOC-SYNC-CHECK-V1(contractId, syncTargets[], auditDigest) -> (syncResult, drift[] | drift_detected)`
- Payload schema最小集合（凍結）
  - required keys: `freezeContractId`, `contractIds`, `schemaVersion`, `overridePolicy`, `safeModeDefault`, `safeModeBoundary`, `pendingDecisionQueueCount`, `approvalRecord`。
- Event contract（凍結）
  - `query|bundle|proposal|apply` の4点欠損時はNo-Go。
- versioning方針
  - 破壊的変更（必須キー変更・遷移追加・承認主体変更）は `v2` へ隔離し、`v1` は読み取り専用維持。

### Phase 4-6: Execute / Verify / Proceed
- Execute: 文書と契約の記述整合に限定。
- Verify: `validate_active_issue_memos` / `git diff --check` で自己検証。
- Proceed判定: **Hold/Needs-decision**（`Approval Record` と `held` 未解消のため）。


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
- 次ストリーム非依存で読めるよう、判定根拠・停止条件・読み取り専用 handoffを明示した。

### Phase 8: Final status
- 判定: **Hold/Needs-decision**（`pendingDecisionQueueCount>0` のため）。
- Stop条件適用: なし（検証失敗・未定義競合は検出せず）。

## Stream D execution contract clarification（2026-06-13）

### Context
- HIL-RS-02はHIL-RS-01-A1の最小I/Fを再定義せず、統治契約を硬化してA2/A3へ読み取り専用 handoffする段階である。
- `Approval Record` と `HIL-RS-02-GOV-EXCEPTION-01` に未解決在庫が残るため、Proceed Goは未成立である。

### Decision
- 固定順序は `A1 -> RS-02-A1 -> A2 handoff -> A3 handoff -> delivery plan` とし、A2/A3の実作業は各専任Streamに分離する。
- RS-02-A1の実行許可は `a1Status==Done && pendingDecisionQueueCount==0 && fixedKeyDrift==0 && safeModeRetreat==false` のときだけ成立する。
- mockで先行可能な範囲は `decision`, `executeAllowed`, `reasonCodes`, `auditEventRef` の読取・検証までに限定する。
- 将来版に隔離する事項は、必須キー追加/削除、承認主体変更、新規状態遷移、GOV例外の恒久化、SafeMode境界変更である。

### Consequences
- A2/A3へは「参照契約」と「Stop条件」を渡し、Frontend/UI/E2E/04文書の実装完了を本計画の前提にしない。
- Pending bypass、contract redefinition、approval inferenceが検出された場合は `Proceed=Stop` とし、承認在庫へ戻す。
