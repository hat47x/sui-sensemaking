# COGNITIVE-ASSOC-01 evaluation harness v0

- Status: Pre-run / gated
- Date: 2026-09-18
- Parent issue: `01_Plans/issues/issue-COGNITIVE-ASSOC-01-affinity-semantic-field-poc.md`
- Baseline harness: `cognitive-assoc-baseline-harness-v0.md`

## 1. 位置づけ

本書はT4の評価方法を固定する下位仕様である。固定v0に対するsemantic baseline実行そのものは、T2dのmodel-blind human adjudicationがfreezeされるまで行わない。

T4では「一つの高いscore」を作らず、親和図作業に必要な性質を別々に観察する。

## 2. R1 Deep-semantic candidate recall

source manifestで事前登録済みの `challengePositiveSets` だけを用いる。

各challenge memberをanchorにし、同一文書内の他cardをsimilarityで評価して、同じchallenge setの他memberが何位に現れるかを記録する。

報告値:

- recall@1
- recall@3
- recall@5
- target rank

このrankingは**benchmark評価専用**であり、SUIのproduct-facing rankingではない。

## 3. R2 Surface-decoy rejection

63件のhuman-adjudicated contrastだけを用いる。

- `hard_negative`
- `related_but_separate`
- `ambiguous_or_held`
- `exclude`

のうち、`exclude`は性能集計から外す。

集計は必ず次を分離する。

- pair / 2+1
- U / L selection stratum
- human label

U/L overlap caseは両stratumへ現れてよい。これは母比率推定ではなく、事前登録したstress面を別々に観察するためである。

## 4. R3 Singleton / residual survival

v0で観測されている単独島を対象に、同一文書内で最も高いsimilarityを持つ他cardと、そのmaximum similarityを記録する。

ただしv0では「この値を越えたら誤吸収」という普遍閾値を事前登録していない。

したがって、

- maximum similarity
- nearest card
- A/C/E間の性質差

を記述し、単独島であること自体をhold / residual / anomalyへ読み替えない。

## 5. R4 Set-level coherence

challenge positiveが2枚ならpair cosine、3枚なら各memberと残りmember centroidのcosineを計算する。

報告値:

- member score
- mean member coherence
- minimum member coherence

minimumを残すのは、一枚だけ「それではない」状態を平均値が隠さないためである。

## 6. R5 Wording stability

**v0では測定しない。**

v0にはモデル実行前に凍結されたparaphrase caseが存在しない。結果を見てから言い換え例を追加すると評価汚染になるため、R5は `not_measured_in_v0` と明示する。

必要ならv1で事前登録したparaphrase suiteを新設する。

## 7. R7 Continuous-local budget

probe実行時に次を記録する。

- wall time
- Python harness processのpeak traced memory

外部local encoderのmemoryはPython側のtracemallocには含まれないため、`externalProviderMemoryIncluded=false` と明示する。Eの実memory比較にはprovider側の独立Evidenceが必要である。

## 8. R6 / R8

T4 baselineだけでは測定しない。

- R6 Affinity-feedback increment → T6
- R8 Cognitive-control increment → T7

未測定軸を0点や失敗へ読み替えない。

## 9. 比較出力

`evaluate_cognitive_assoc_baselines.py summarize` はA/C/Eを並置するが、次を行わない。

- overall winner選定
- baseline順位付け
- single composite score
- product採用判断

T4の役割は、各方式がどの評価面でどの性質を示したかを分離して残し、T5以降の研究判断材料にすることである。

## 10. 固定v0実行gate

probe実行はT3と同じ凍結gateを再検証する。

- frozen human adjudication artifact
- adjudication Evidence
- selected review set SHA-256
- adjudicated artifact SHA-256
- blind model input
- source manifest / benchmark ID一致

synthetic fixtureによる実装検証はT2d前でも許可するが、固定v0 sourceに対するA/C/E probe artifactはT2d完了まで生成しない。
