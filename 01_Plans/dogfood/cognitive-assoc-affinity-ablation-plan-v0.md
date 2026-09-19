# COGNITIVE-ASSOC-01 Affinity-specific Ablation Plan v0

- Status: Preregistered / pre-result
- Date: 2026-09-19
- Parent issue: `01_Plans/issues/issue-COGNITIVE-ASSOC-01-affinity-semantic-field-poc.md`
- Upstream gate: `cognitive-assoc-learned-sparse-gate-v0.md`

## 1. 位置づけ

本書はT6のablation契約を、T4/T5結果を見る前に固定する。

T6の問いは「親和図作業固有の情報を全部入れれば良くなるか」ではない。

> **一般意味表現だけでは説明できない増分が、group / separate / Critique / hold / graph / space / historyのどこから生じるか。**

そのため、channelを一つの合成scoreへ潰さず、add-oneとleave-one-outを両方残す。

## 2. 実行前提

T6を実行してよいのは次をすべて満たす場合だけである。

1. T5 decisionがfreeze済みである。
2. T5 decisionが `Proceed` である。
3. T5 Evidenceのdecision artifact SHA-256が一致する。
4. learned sparse semantic reference Dのbounded research artifactが存在する。
5. affinity-specific feature sourceが**評価対象より前の履歴**だけから構築されている。
6. final target island / final target layout / T2d label / 当該candidateのmodel出力をfeatureへ戻していない。

T5 Proceedはproduction採用を意味しない。T6も研究実験に限定する。

## 3. Target leakage禁止

T6では最終状態を入力へ戻すと、親和図作業固有情報の増分を測ったことにならない。

明示的に禁止する。

- 最終target island membership
- 最終target layoutの座標・近傍・topology
- T2d human adjudication label
- A/C/E/Dの当該candidateに対するmodel output
- 評価後に作られたCritique / hold / relation

使ってよいのは、target snapshotより**厳密に前**に存在した操作・状態だけである。

十分なpre-target履歴が存在しない場合は、target状態から擬似履歴を作らない。T6は `Hold` とし、必要ならtemporal benchmark v1を新設する。

## 4. 研究用channel

channel名は研究上のfeature familyであり、production schema名ではない。

### group

targetより前に人間または承認済み操作として成立したco-grouping / grouping adoption。

### separate

targetより前に明示されたsplit / remove / not-the-same等の分離操作。

### critique

targetより前のCritique信号。例:

- too_close
- too_far
- not_the_same
- feels_off
- no_articulable_reason

理由が言語化されていないCritiqueも有効なsignalとして保持する。

### hold

targetより前の明示的な保留・未解決・open状態。

### graph

targetより前に成立していたtyped relation。

relation typeを語彙類似へ潰さない。

### space

targetより前のrelative neighbourhood / layout topology。

絶対座標値を意味そのものとして扱わず、最終target配置は使用しない。

### history

targetより前の操作順序・反復・頻度・時間的近接。

他channelと情報が重複し得るため、historyの増分を因果効果とは呼ばない。

## 5. Ablation matrix

利用可能な7channelがすべて揃う場合、固定matrixは16 variantとする。

1. `F0_semantic_reference`
2. 各channelの `F_plus_<channel>` 7本
3. `F_all`
4. 各channelの `F_minus_<channel>` 7本

合計16。

### Add-one

`F0 + channel` と `F0` を比較する。

単独channelを足したときに、どの評価面が動くかを見る。

### Leave-one-out

`F_all - channel` と `F_all` を比較する。

複合状態の中でそのchannelが抜けたときに、どの評価面が動くかを見る。

add-oneとleave-one-outが一致しなくても異常ではない。channel間相互作用を保持する。

## 6. 欠損channel

channelが取得できない場合、target状態から補完してはならない。

planは:

- `state = hold_missing_channels`
- `executionAuthorized = false`
- `missingChannels` を明示

とする。

不足channelだけを「0」とみなして完全ablationを装わない。

## 7. 評価軸

T4と同じR1/R2/R3/R4/R7を再利用し、新たにR6を加える。

### R6 Affinity-feedback increment

各channelについて:

- add-one delta vs F0
- leave-one-out delta vs F_all

を別々に残す。

R6を一つのscoreへ畳まない。

### 未測定

- R5 wording stability: v0では未測定のまま
- R8 cognitive-control increment: T7へ残す

## 8. 解釈上の停止線

以下を禁止する。

- channel winner
- channel ranking
- single composite score
- 「groupが原因で改善した」等の因果主張
- similarity増加を一律に改善扱いすること
- singleton maximum similarity増加を自動的に悪化扱いすること
- Fの結果を自動でproductionへ昇格すること

R2/R3は方向性の読み方が単純ではないため、個別Evidenceとして解釈する。

## 9. Source manifest

T6実行前に `sui.cognitive-assoc-affinity-ablation-source/v1` manifestを作る。

最低限:

- benchmarkId
- D artifact SHA-256
- target snapshot ID
- strictly-pre-target境界
- channelごとのavailable/unavailable
- targetDerived=false
- onlyPreTargetEvents=true
- evidenceRefs

を持つ。

`build_cognitive_assoc_affinity_ablation_plan.py` はこのmanifestとT5 decision/Evidenceを検証してplanを作る。

## 10. 実行結果の位置づけ

T6の結果は、親和図作業固有の履歴・構造が一般意味表現へ独立増分を持つかを調べる研究Evidenceである。

T6だけで、

- 自動束ね
- 自動表札
- 自動relation確定
- user-facing score/confidence

を正当化しない。

最終的な認知拡張価値とanchoring影響はT7のhuman-in-the-loop dogfoodで確認する。
