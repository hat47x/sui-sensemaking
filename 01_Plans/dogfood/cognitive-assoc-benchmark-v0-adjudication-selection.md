# COGNITIVE-ASSOC-01 benchmark v0 — contrast人間判定の事前抽出規則

- Status: Pre-model frozen
- Date: 2026-09-10
- Parent preregistration: `cognitive-assoc-benchmark-v0-preregistration.md`
- Source manifest: `cognitive-assoc-benchmark-v0-source-manifest.json`
- Rule: 本文書の抽出規則を固定した後も、semantic baseline / embedding / FlyHash候補を見るまで変更しない。

## 0. 文書の位置づけ

この文書は、親和図法の認知要件や方式選定を説明するものではない。上位のIssue・研究記録・benchmark事前登録で決めた方針を受けて、**人間判定対象をモデル非依存にどう抽出するかだけを固定する下位仕様**である。

したがって、根幹の趣旨を確認する場合は先に次を読む。

1. `01_Plans/issues/issue-COGNITIVE-ASSOC-01-affinity-semantic-field-poc.md`
2. `01_Plans/research/fly-inspired-affinity-semantic-field-research-2026-09-10.md`
3. `cognitive-assoc-benchmark-v0-preregistration.md`
4. 本文書

## 1. なぜ519件を全件判定しないか

v0の完全なcontrast母集団は、cross-island pair 173件と2+1 candidate 346件、計519件である。

この母集団は後からcandidateを都合よく作り直さないための**監査母集団**として全件保持する。一方、519件すべてを一人のMaintainerが連続して意味判定すると、単純な作業量が大きく、後半ほど判断基準が粗くなる危険がある。

そこでv0の人間判定は、semantic modelとは無関係な決定論的抽出でbounded review setを先に作る。

重要なのは、**semantic modelが難しいと感じた例を後から選ぶのではなく、人間判定対象もモデル実行前に固定すること**である。

## 2. 二つの抽出stratum

### U: uniform-hash stratum

candidate IDのSHA-256だけを使い、hash値の昇順から抽出する。

- pair: 16件
- 2+1: 16件

カード本文を見ずに選ぶため、特定テーマや語彙へ恣意的に寄せない。

これは母集団比率の厳密推定を目的とするrandom sampleではない。seed管理を不要にし、誰が実行しても同じ集合になる**再現可能な擬似一様抽出**である。

### L: lexical-stress stratum

表層的には近く見えるが、既存の親和図では別島だった例を意図的に多く含め、R2 `Surface-decoy rejection`へ圧力を掛ける。

選定に使うのはsemantic encoderではなく、次の固定した文字n-gram overlapだけとする。

1. Unicode NFKC正規化
2. Unicodeの英数字・日本語文字だけを残し、空白・句読点・記号を除く
3. 連続する3文字の集合を作る
4. pairはJaccard overlapを計算する
5. 2+1は、既存島内pairへ追加されたoutsiderと2枚それぞれのJaccardの大きい方を用いる
6. 値の降順、同値ならcandidate ID昇順で選ぶ

抽出数:

- pair: 16件
- 2+1: 16件

このoverlap値は**人間判定パケットへ表示しない**。判定者へ「この組合せは表層的に近いはずだ」と先入観を与えないためである。

## 3. dedupと最終件数

UとLで同じcandidateが選ばれた場合は一件へ統合する。

したがって最終human review setは最大64件、最小32件となる。実件数は選定scriptの出力で固定する。

選定理由はmachine-readable artifactには保持してよいが、人間がカード内容を判定する本文には原則表示しない。

## 4. このsamplingから言えること / 言えないこと

### 言えること

- 表層語彙に依存しない事前抽出(U)で、cross-island candidateをどう読むか。
- 表層類似が高いstress set(L)で、単純なsimilarityが親和的な束ねにおける分離を壊しやすいか。
- hard negative / related-but-separate / ambiguous-or-heldが実際に存在するか。
- semantic model比較前に、評価すべきcontrast caseを固定できる。

### 言えないこと

- 519件全体における各labelの母比率。
- 親和図カード一般のhard-negative発生率。
- L stratumの成績を通常データ分布での平均性能と読み替えること。

結果はU/Lを分けて報告し、単一のaccuracyへ畳まない。

## 5. 人間判定はモデルblindのまま行う

人間パケットには以下だけを出す。

- candidate ID
- document ID
- 2枚または3枚のcard ID
- card本文
- 4つの選択肢
- 任意のreason欄

次を出さない。

- U/Lどちらで選ばれたか
- lexical overlap値
- source island ID / title
- 座標
- relation edge
- semantic score / distance
- model ranking / explanation

## 6. 判定選択肢

- `hard_negative`
  - 一束へ寄せるとカードの訴えを壊す。特に表層類似へ引かれて混ぜないことが重要。
- `related_but_separate`
  - 関係・連続性はあるが、一束として代弁することとは別。
- `ambiguous_or_held`
  - 現時点で近い/遠いを閉じない。理由を言語化できなくてもよい。
- `exclude`
  - v0のcontrast評価に使うには条件が不適切。

この四値には優劣を置かない。

## 7. baseline gate

次がcommitされるまでsemantic baseline gateは閉じる。

1. full contrast pool 519件がsource manifest規則から再生成できる。
2. 本文書のU/L規則でbounded review setが決定論的に再生成できる。
3. bounded review setの人間判定が完了している。
4. 判定artifactのSHA-256と件数が凍結されている。

判定後に例を追加したくなった場合はv0を変更せず、v1または別のstress suiteへ追加する。

## 8. 人間判定後の凍結手順

T2dの人間判定は `cognitive-assoc-benchmark-v0-pre-adjudication/human-adjudication-response.json` に記録する。

判定中は次を維持する。

- `status = in_progress`
- `semanticBaselineGate = closed`
- `modelOutputsAllowed = false`
- 各 `label` は空欄または4つの事前登録labelのいずれか
- reasonは任意であり、言語化できないことを欠陥としない
- semantic model / embedding / FlyHash候補など、後段で比較する出力を判定前に見ない

63件すべての判定が終わったMaintainerだけが、次を明示的に変更する。

1. `status = complete`
2. `attestation.semanticModelOutputsViewedBeforeCompletion = false`
3. 各candidateへ4値labelのいずれかを設定する

その後、次のfreeze utilityを実行する。

```bash
python 01_Plans/dogfood/freeze_cognitive_assoc_adjudication.py freeze \
  01_Plans/dogfood/cognitive-assoc-benchmark-v0-pre-adjudication/selected-review-set.json \
  01_Plans/dogfood/cognitive-assoc-benchmark-v0-pre-adjudication/human-adjudication-response.json \
  01_Plans/dogfood/cognitive-assoc-benchmark-v0-adjudicated.json \
  01_Plans/dogfood/cognitive-assoc-benchmark-v0-adjudication-evidence.json
```

freeze utilityは次をfail-closedで検証する。

- selected review setのraw byte SHA-256一致
- candidate集合が63件と完全一致し、欠落・重複・追加がない
- 4値label以外を含まない
- score / similarity / activation / confidence / ranking / model output等を含まない
- Maintainer roleによるmodel-blind attestationが成立している
- pair / 2+1件数とlabel件数を機械的に集計できる

成功時はadjudicated artifactと別EvidenceへSHA-256を固定する。成功はsemantic baselineを自動実行する操作ではない。Evidenceのgate状態は `eligible_for_explicit_open` とし、T3/T4側が凍結済みartifactを明示的に参照して初めて次段へ進む。

## 9. Offline判定フォーム

63件をMarkdownとJSONの間で手作業転記する誤りを減らすため、`build_cognitive_assoc_adjudication_form.py`でself-contained HTMLを生成できる。

役割は次のように分ける。

- `human-adjudication-packet.md`: 判定対象とblind境界を人間が監査する読み物
- offline HTML form: 4値選択と任意reasonを入力する補助UI
- `human-adjudication-response.json`: freeze utilityへ渡す判定の正本

フォーム生成時にもsemantic gateは閉じたままであり、入力はselected review setとblind model inputだけを使う。

```bash
python 01_Plans/dogfood/build_cognitive_assoc_adjudication_form.py \
  01_Plans/dogfood/cognitive-assoc-benchmark-v0-pre-adjudication/selected-review-set.json \
  /path/to/model-input.jsonl \
  /tmp/cognitive-assoc-human-adjudication.html
```

HTMLは外部script / stylesheet / network requestを持たない。candidate ID、document ID、card ID、card本文、4値label、任意reasonだけを表示する。U/L stratum、lexical overlap、source island、座標、relation、model score / ranking / explanationは含めない。

途中経過JSONは `status=in_progress` のまま保存できる。完了JSONを出力するには全63件が判定済みで、Maintainerがmodel-blind完了確認を明示的にチェックする必要がある。最終JSONは既存のfreeze utilityで再検証するため、フォーム自体を信頼境界にはしない。

