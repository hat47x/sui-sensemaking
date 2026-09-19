# COGNITIVE-ASSOC-01 Architecture Decision Gate v0

- Status: Preregistered / pre-result
- Date: 2026-09-19
- Parent issue: `01_Plans/issues/issue-COGNITIVE-ASSOC-01-affinity-semantic-field-poc.md`
- Upstream: T2 / T4 / T5 / T6 / T7 evidence

## 1. 位置づけ

本書はT8の最終判断を、T7結果を見る前に固定するための下位仕様である。

T8では研究Evidenceを一つのscoreへ畳まず、Maintainerが次の4つから一つを選ぶ。

- `no_adoption`
- `retrieval_only`
- `candidate_cognition_layer`
- `adr_trigger`

自動判定・winner選定・production自動昇格は行わない。

## 2. Evidence manifest

T8入力は `sui.cognitive-assoc-architecture-evidence/v1` とする。

最低限:

- benchmarkId
- T2 artifact SHA-256
- T4 artifact SHA-256
- T5 decision artifact SHA-256 + Proceed / Reject
- T6 status + artifact SHA-256またはnot_applicable理由
- T7 status + artifact SHA-256またはnot_applicable理由
- semantic candidate signal
- affinity increment
- cognitive-control increment
- anchoring risk
- local budget
- research boundary
- 将来必要となるproduction boundary change

を持つ。

T5がHoldのままならT8へ進まない。

T5 Rejectの場合、T6/T7をcompleted扱いにしてはならない。

## 3. Observationの意味

### semanticCandidateSignal

- observed
- not_observed
- mixed

A/C/E等の候補検索・意味近接に、実用的なsignalが観測されたかを記述する。

### affinityIncrement

- observed
- not_observed
- mixed
- not_measured

T6のR6 Evidence。

T6がnot_applicableなら必ずnot_measuredとする。

### cognitiveControlIncrement

- observed
- not_observed
- mixed
- not_measured

T7のR8 Evidence。

T7がnot_applicableなら必ずnot_measuredとする。

### anchoringRisk

- acceptable
- unacceptable
- uncertain
- not_measured

candidate layerが探索を狭める危険を別軸で残す。

### localBudget

- acceptable
- unacceptable
- uncertain

常時local候補としてのCPU / memory / latency等。

## 4. no_adoption

認知層をこの研究線から先へ持ち込まない。

想定driver:

- useful semantic incrementがない
- local budgetが成立しない
- anchoring riskが受容できない
- Evidenceが不十分
- 複雑性が観測価値を上回る

Rejectは失敗ではなく、研究で不要な複雑性を落とした結果として保存する。

## 5. retrieval_only

軽量な候補検索・近傍想起だけを残す。

親和図作業固有の認知制御やmulti-channel意味層をproduction claimにしない。

想定driver:

- retrieval signalは有用
- affinity incrementは未証明
- cognitive-control incrementは未証明
- local retrievalだけでも価値がある
- 意味権限をkernelへ持たせない方が適切

semanticCandidateSignalが `not_observed` の場合は選べない。

## 6. candidate_cognition_layer

proposal-onlyのcandidate cognition layerを今後のintegration方向として選ぶ。

ただしproduction deploymentそのものをこのdecisionで承認しない。

必須条件:

- T6 completed
- T7 completed
- affinityIncrement = observed または mixed
- cognitiveControlIncrement = observed または mixed
- anchoringRisk = acceptable
- localBudget = acceptable

さらに以下のようなdriverをMaintainerが明示する。

- semantic_signal_useful
- affinity_increment_observed
- cognitive_control_increment_observed
- anchoring_acceptable
- local_budget_acceptable
- proposal_only_boundary_sufficient

この選択でも:

- auto-apply
- automatic island / label / relation confirmation
- user-facing semantic score / rank
- Consensusへの自動昇格

は許可しない。

## 7. adr_trigger

研究Evidenceから、productionへ進むには既存境界を変える必要がある場合に選ぶ。

例:

- persistent stateが必要
- production APIが必要
- provider boundaryを変える必要がある
- safety boundaryを変える必要がある
- normative performance budgetが必要
- cross-repository durable contractが必要

`requiredFutureBoundaryChanges` が空の場合は選べない。

このdecisionはproduction採用ではなく、通常のADR / design processへ戻る指示である。

## 8. Driver

decision responseは自由記述rationaleに加え、事前登録されたdriver IDを一つ以上持つ。

decisionと一致するdriverが最低1つ必要。

別decision用driverを併記すること自体は、矛盾を残すため許容する。ただしdecisionの根拠が自分のcategoryに一つも無い場合はfreezeできない。

## 9. Research boundary

T8 evidence manifestでは、PoC中に次が起きていないことを確認する。

- production schema変更
- production API変更
- candidate auto-apply
- user-facing score / ranking

もし既に変更されているなら、本IssueのPoC境界違反としてT8以前に是正する。

## 10. Decision artifact

`build_cognitive_assoc_architecture_decision.py freeze` は:

- packet SHA-256
- decision
- driver
- rationale
- next step

を固定する。

`retrieval_only` / `candidate_cognition_layer` でも:

- `integrationDirectionSelected=true`
- `productionAdoptionAuthorized=false`

とする。

production実装は通常のarchitecture / change controlへ渡す。

## 11. T8完了条件

- T2 / T4 / T5のEvidenceが凍結済み
- T6 / T7がcompletedまたは正当なnot_applicable
- T5 Holdが残っていない
- observationsがstage statusと矛盾しない
- research boundary違反なし
- Maintainerが4択decisionを明示
- rationaleとdriverを保存
- decision artifact SHA-256をEvidenceへ固定
- automatic semantic authorityは最後までfalse

以上を満たしたとき、COGNITIVE-ASSOC-01の研究線をarchitecture decisionへ変換できる。
