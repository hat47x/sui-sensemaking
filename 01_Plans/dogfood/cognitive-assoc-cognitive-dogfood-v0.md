# COGNITIVE-ASSOC-01 Cognitive Dogfood Protocol v0

- Status: Preregistered / pre-result
- Date: 2026-09-19
- Parent issue: `01_Plans/issues/issue-COGNITIVE-ASSOC-01-affinity-semantic-field-poc.md`
- Upstream: `cognitive-assoc-affinity-ablation-plan-v0.md`

## 1. 位置づけ

本書はT7のhuman-in-the-loop dogfoodを、T6結果を見る前に固定するための下位仕様である。

T7の問いは「candidate layerが何件採用されたか」ではない。

> **candidate layerが、人間の探索を広げ、残余を保ち、早期収束から戻る助けになるか。それと同時に、最初の機械候補へのanchoringを強めないか。**

したがってcandidate採用数、束数、残余数の増減を単独で成功指標にしない。

## 2. 対象task

T7ではT2/T4で使った固定benchmarkや、SUI自身の設計判断を題材にしない。

taskは:

- 参加者がstudy前に見ていない
- SUI自身を題材にしない
- reviewed textだけで構成する
- 30 cards以上
- pair内でdifficulty bandが同じ
- pair内のcard count差が25%以内
- 同一snapshotを2条件で使い回さない

ことを必須にする。

同じtaskをcandidateあり/なしで繰り返すと学習carryoverが強いため、matched but distinct taskをpairにする。

## 3. 条件

### control

- unaided phase
- intervention phaseもcandidate非表示
- origin-blind review

### candidate_assisted

- unaided phaseではcandidate非表示
- intervention phaseだけcandidate表示
- origin-blind reviewではcandidate originを表示しない

candidate layerは:

- auto-applyしない
- score/rank/confidenceを見せない
- island / label / relationを確定しない
- humanのAdopt / Reject / Holdを正規操作として扱う

## 4. Crossover割付

最低2 pairを用意する。

pairごとに2つのdistinct taskを持ち、一方をcontrol、一方をcandidate_assistedへ割り当てる。

割付はstudy IDから得たseed offset + pair順の交互割付とし、結果やtask内容を見て条件を割り当てない。

pair数が偶数ならcontrol-first / candidate-firstを同数にし、奇数なら差を1以内にする。

## 5. 3 phase

全sessionで同じphase durationを事前に固定する。

### Phase 1: unaided

candidateなしで探索する。

記録対象:

- inspected material
- provisional grouping / separation
- hold
- critique
- relation
- residual
- provisional structure checkpoint

### Phase 2: intervention

controlはcandidateなしで継続する。

candidate_assistedだけcandidate layerを利用できる。

candidateはhash順などscoreと無関係な順序で表示し、順位を暗示しない。

記録対象:

- candidate viewed
- considered
- adopted
- rejected
- held
- candidateをきっかけに見直したmaterial
- candidateとは無関係に生まれた新しい関係

### Phase 3: origin-blind review

候補がmachine-originかself-originかを表示せず、最終的な構造・hold・residual・relationを再確認する。

目的はcandidate adoption率を上げることではなく、intervention中の機械由来構造がorigin cueなしでも保持されるかを見ることである。

## 6. R8 Cognitive-control increment

T7で新たにR8を観測する。

単一scoreへ畳まない。

### 6.1 Newly considered material

intervention後に初めて注意対象になったcard / relation / bundle。

多ければ必ず良いとはしない。noise拡大の可能性もあるため、最終reviewで保持されたかを併記する。

### 6.2 Structure revision

unaided checkpointから、どのgroup / separate / hold / relationが変化したか。

変更数を品質scoreにはしない。

### 6.3 Residual / hold transitions

- residual → grouped
- grouped → residual
- open → held
- held → reopened / resolved

を方向別に残す。

残余が減ることを成功としない。

### 6.4 Attention redistribution

candidate提示後、unaided phaseで未確認だったmaterialへ注意が移ったか。

candidate自身だけでなく、その周辺探索へ波及したかを区別する。

### 6.5 Candidate disposition

candidateごとに:

- adopt
- reject
- hold
- considered-no-action

を残す。

adopt率をsuccess metricにはしない。

### 6.6 Origin-blind retention

interventionで採用された構造がorigin-blind reviewで:

- retained
- modified
- held
- rejected

のどれになったかを見る。

machine-originだけが不自然に残り続ける場合、anchoring riskとして検討する。

### 6.7 Cost

- phase時間
- interaction count
- review effort

を別軸で残す。

探索が広がっても負荷が過大なら常時利用に適さない可能性がある。

## 7. Anchoringの扱い

anchoringを「machine候補を採用したこと」と定義しない。

次を組み合わせて観測する。

- unaided checkpointに存在しなかったmachine-origin構造の採用
- candidate rejection / holdの発生
- origin-blind reviewでのretention / modification / rejection
- candidate外の探索が減っていないか
- residual / critiqueがcandidate提示後に消えすぎていないか

ただしv0では単一anchoring scoreを作らない。

## 8. 解釈上の停止線

以下を禁止する。

- candidate採用率を成功率と呼ぶ
- 束数増減を品質と呼ぶ
- residual減少を改善と呼ぶ
- controlとtreatmentを一つの総合点で比較する
- participantをscore/rankする
- machine-origin構造を自動でConsensusへ昇格する

## 9. Study source manifest

`sui.cognitive-assoc-dogfood-study-source/v1` には最低限:

- studyId
- candidate layer artifact SHA-256 / variant ID
- research-only / autoApply=false / scoreOrRankingVisible=false
- phase seconds
- task pair
- task snapshot SHA-256
- card count
- reviewed-only
- self-referential=false
- previously-seen=false
- difficulty band

を凍結する。

`build_cognitive_assoc_cognitive_dogfood_plan.py` はこのmanifestからdeterministic crossover session planを生成する。

## 10. T7完了条件

T7完了には最低限:

- 2 pair以上
- control / candidate-assisted両条件
- unaided checkpoint
- intervention log
- origin-blind review
- R8各観測軸
- candidate disposition
- carryover違反なし
- production auto-applyなし

が必要である。

結果が候補層に不利でもそのまま残す。

T8ではT1〜T7のEvidence全体を使ってarchitecture decisionへ進む。
