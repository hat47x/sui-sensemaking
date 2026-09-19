# COGNITIVE-ASSOC-01 Learned Sparse Gate v0

- Status: Preregistered / pre-result
- Date: 2026-09-19
- Parent issue: `01_Plans/issues/issue-COGNITIVE-ASSOC-01-affinity-semantic-field-poc.md`
- Upstream: `cognitive-assoc-evaluation-harness-v0.md`

## 1. 位置づけ

本書はT5の判断規則を、固定v0のA/C/E結果を見る前に固定するための下位仕様である。

T5の問いは「A/C/Eのどれが勝ったか」ではない。

> **learned sparse semantic encoder Dを追加実装して検証する独立した研究理由が、A/C/Eの結果から残るか。**

したがって、overall winner、単一composite score、production採用判定は行わない。

## 2. なぜT4結果の前に固定するか

T4結果を見た後で「Dを試すべき条件」を作ると、Fly-inspired / learned sparse方式に有利な基準を後付けできてしまう。

そのため、T2dとT4bが未完了の現在時点で、T5が見る情報と判断の意味を固定する。

## 3. T5が見る情報

`build_cognitive_assoc_learned_sparse_gate.py packet` は、T4 summaryから次だけを抜き出す。

### R1

- A / C / E の recall@3 mean
- E - A
- E - C

### R4

- A / C / E の minimum member coherence mean
- E - A
- E - C

### R3

- singleton maximum similarity mean
- E - A
- E - C

R3の正方向差を「悪化」と自動判定しない。これは吸収圧の記述値にすぎず、v0では普遍閾値を定義していない。

### R2

human-adjudicated `hard_negative` について、共通して存在する

- pair / 2+1
- U / L

の各面でA/C/E meanとE-A / E-Cを残す。

値が低いことはsurface-decoy rejection上望ましい可能性があるが、ここでも普遍的なsimilarity閾値や自動勝敗は定義しない。

### R7

- wall time
- external provider memoryが測定に含まれているか

特にEは外部local encoderのmemoryをPython harness側から観測できないため、未測定なら `E:external_provider_memory_not_measured` を不足Evidenceとして残す。

## 4. Proceed / Hold / Reject

### Proceed

Dを**bounded research experimentとして実装する**。

Proceedには、Maintainerが少なくとも次の2種類を両方明示する必要がある。

1. semantic gap
   - EがA/Cにないsemantic signalを示した等
2. sparse value hypothesis
   - compactness、local/edge、incremental index、representation diversity等、dense encoderをそのまま使うだけでは解けない別の価値仮説

semantic gapだけではProceedしない。

逆に「疎だから軽そう」という期待だけでもProceedしない。

### Hold

Dをまだ実装しない。

次のような場合を想定する。

- Eのexternal provider memoryが未測定
- runtime比較が同条件でない
- R1/R2/R3/R4のEvidenceが混在している
- decoyまたはsingleton riskの解釈が未解決
- v0が小さすぎてDを追加する根拠として弱い
- T4 Evidenceが一部欠けている

HoldはRejectではなく、不足Evidenceを明示した保留である。

### Reject

benchmark v0の範囲ではDを実装しない。

想定理由:

- A/CとEの間に独立したsemantic gapが観測されない
- AまたはCで現在の研究問いに十分
- E自体が有用なsemantic signalを示さない
- targeted deficitのないままDを追加すると複雑性だけが増える

RejectはFly-inspired研究一般の否定ではなく、v0からDを追加する独立理由が得られなかったという記録である。

## 5. Driver category

responseでは自由な理由文に加え、事前登録されたdriver IDを選ぶ。

### semantic_gap

- `e_recall_advantage`
- `e_set_coherence_advantage`
- `general_semantic_signal_needed`

### sparse_value

- `e_runtime_or_memory_pressure`
- `compact_representation_value`
- `incremental_index_value`
- `offline_or_edge_value`
- `representation_diversity_value`

### hold

- `e_provider_memory_missing`
- `runtime_not_comparable`
- `evidence_mixed`
- `contrast_risk_unresolved`
- `singleton_risk_unresolved`
- `benchmark_too_small`
- `t4_evidence_incomplete`

### reject

- `no_independent_semantic_gap`
- `a_or_c_sufficient_for_current_scope`
- `e_does_not_show_useful_semantic_signal`
- `sparse_complexity_without_target_deficit`

## 6. 機械的停止線

freeze utilityは次を検証する。

- T4 gate packetのraw SHA-256一致
- decisionが `Proceed / Hold / Reject` のいずれか
- Maintainer role
- rationaleが空でない
- unknown driverなし
- duplicate driverなし
- Proceedはsemantic_gap + sparse_valueを両方含む
- Proceedはreject driverを含まない
- Holdはhold driverを1つ以上含む
- Rejectはreject driverを1つ以上含む
- Rejectはsemantic_gap driverを含まない

機械処理はdecisionを自動生成しない。

## 7. production境界

Proceedでも次は許可しない。

- production provider化
- Document / Information Network schema変更
- 自動島形成
- user-facing confidence
- learned sparse scoreによる自動順位付け
- Dの結果を見てv0 benchmarkを変更

Proceedが許可するのは、T6へ向けた**bounded research implementation**だけである。

## 8. 実行順

T2d → T4bが完了した後に:

```bash
python 01_Plans/dogfood/build_cognitive_assoc_learned_sparse_gate.py packet \
  cognitive-assoc-benchmark-v0-evaluation-summary.json \
  cognitive-assoc-benchmark-v0-learned-sparse-gate-packet.json \
  cognitive-assoc-benchmark-v0-learned-sparse-gate-response.json
```

Maintainerがpacketを読み、responseを完成させる。

その後:

```bash
python 01_Plans/dogfood/build_cognitive_assoc_learned_sparse_gate.py freeze \
  cognitive-assoc-benchmark-v0-learned-sparse-gate-packet.json \
  cognitive-assoc-benchmark-v0-learned-sparse-gate-response.json \
  cognitive-assoc-benchmark-v0-learned-sparse-gate-decision.json \
  cognitive-assoc-benchmark-v0-learned-sparse-gate-evidence.json
```

T5 decisionとSHA-256を凍結してから次工程へ進む。
