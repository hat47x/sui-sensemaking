# ADR-0113: T8の証拠条件と判断閾値を現行ADRへ戻す

- Status: Accepted（証拠条件。研究結果ではない。2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（PoC優先の指示にもとづく）
- Scope: COGNITIVE-ASSOC-01 T8、`ADR-0109`、`ADR-0111`
- Related: `ADR-0090`、`ADR-0109`、`ADR-0111`、Issue #3157、commit `b4d75775`（T8事前登録）

## 価値への寄与

V3「レビュー」に寄与する。認知支援を製品へ持ち込む条件を、結果を見る前に固定し、都合のよい後付けを防ぐ。学習順位付けは提案のみで、人間の判断を置き換えない。

## Context

T8の事前登録はcommit `b4d75775`に残っている。しかし、その後の管理文書の整理で、T2〜T7の結果artifactは現行mainから消えた。T5は`Preregistered / pre-result`のまま、T6/T7も結果が無い。

ADR-0109はretrieval-onlyを暫定採用した。ADR-0111は、学習順位付けをT5/T6/T7の結果まで止めると決めた。ただし、どのartifactが揃えばT8を再評価できるかは、現行mainのADRには書かれていない。

## Decision

### 1. T8の入力

T8の入力は、次のmanifestとする。

| 項目 | 必須 | 内容 |
|---|---|---|
| benchmarkId | はい | `cognitive-assoc-benchmark-v0` |
| T2 artifact SHA-256 | はい | 候補検索の基準 |
| T4 artifact SHA-256 | はい | A/C/Eの比較 |
| T5 decision | はい | `Proceed`、`Hold`、`Reject`のいずれか |
| T5 artifact SHA-256 | はい | 判断の根拠 |
| T6 status | はい | `completed`、`not_applicable` |
| T6 artifact SHA-256 | T6がcompletedのとき | affinityの増分 |
| T7 status | はい | `completed`、`not_applicable` |
| T7 artifact SHA-256 | T7がcompletedのとき | cognitive controlの増分 |
| semanticCandidateSignal | はい | `observed`、`not_observed`、`mixed` |
| affinityIncrement | はい | `observed`、`not_observed`、`mixed`、`not_measured` |
| cognitiveControlIncrement | はい | 同上 |
| anchoringRisk | はい | `acceptable`、`unacceptable`、`uncertain`、`not_measured` |
| localBudget | はい | `acceptable`、`unacceptable`、`uncertain` |
| production boundary change | はい | 無し、または変更内容 |

### 2. 判断規則

- T5が`Proceed`でない場合、T8は`no_adoption`とする。T6/T7を`completed`として扱わない。
- T6が`not_applicable`の場合、`affinityIncrement`は`not_measured`とする。
- T7が`not_applicable`の場合、`cognitiveControlIncrement`は`not_measured`とする。
- `candidate_cognition_layer`を選ぶには、次のすべてを満たす。
  - `semanticCandidateSignal=observed`
  - `affinityIncrement=observed`
  - `cognitiveControlIncrement=observed`
  - `anchoringRisk=acceptable`
  - `localBudget=acceptable`
- 上のどれかが欠ける場合、`retrieval_only`または`no_adoption`とする。`adr_trigger`は、production boundaryの変更が必要なときにだけ選ぶ。
- 自動判定は行わない。Maintainerがmanifestを読み、判断をADRへ記録する。

### 3. artifactの再生成

削除されたT5/T6/T7の計画と検証スクリプトは、Git履歴から取得する。

- T5: commit `196dbcce`
- T6: commit `b16a32ce`
- T7: commit `4ce2bca9`
- T8: commit `b4d75775`

再生成では、次の順で記録する。

1. 取得したスクリプトを、現在のmainとは分離した作業ディレクトリで実行する。
2. 入力データのSHA-256と、実行日時、実行者を記録する。
3. 出力artifactのSHA-256をmanifestへ書く。
4. 失敗した実行や、欠落した項目を`not_measured`として残す。成功したように補わない。

### 4. 証拠の階層

T8は研究の判断であり、T1/T2/T3の人間証拠を必須にしない。ただし、`candidate_cognition_layer`を製品の価値主張へ使う場合は、ADR-0089の証拠階層を別に満たす。技術測定だけで「人間の意味保全が改善した」と書かない。

## Three-Element Verification（自己適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| 業務 | 学習順位付けの採否を、結果を見る前の条件で決める | 機能: 自動判定を作らない。データ: manifestの全項目を必須にする。 |
| データ | artifactのSHA-256とstatusを残す | 業務: 欠落を`not_measured`として扱う。機能: 再生成手順を分離する。 |
| 機能 | T5がProceedでなければT8へ進まない | 業務: Maintainerが判断する。データ: T6/T7をcompletedにしない。 |

## Consequences

- T8の判断条件が現行mainに戻る。T5/T6/T7のartifactが無い間は、`no_adoption`が既定である。
- retrieval-onlyのPoCは維持する。学習順位付けは実装しない。
- artifactの再生成は未実施である。再生成した時点で、manifestと判断をADRへ追記する。
- T8の結果如何では、`candidate_cognition_layer`、`retrieval_only`、`no_adoption`、`adr_trigger`のいずれかを選ぶ。
