# ADR-0109: COGNITIVE-ASSOC-01 T8はretrieval-onlyを暫定採用する

- Status: Accepted（暫定、2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（PoC優先の指示にもとづく暫定判断）
- Scope: `03_Implement/frontend/src/domain/affinity_candidates.ts`、`03_Implement/frontend/src/ui/RelatedCandidatesPanel.tsx`、COGNITIVE-ASSOC-01
- Related: `ADR-0090`（認知支援候補層）、Issue #3157、Issue #3156（T8事前登録）、PR #3344

## 価値への寄与

V3「レビュー」とV1「文脈の再構成」に寄与する。人がカード間の近さに気づく負荷を下げるが、意味や合意を自動で決めない。候補は提案として表示し、人間の判断を置き換えない。

安全不変条件は緩和しない。

- SafeModeは既定ONのまま。
- AI出力は提案のみで、関係や統合を自動適用しない。
- `human_reviewed` は人間だけが設定する。
- ローカル計算だけで、外部への送信を増やさない。

## Context

T8の事前登録（commit `b4d75775`）は、`no_adoption` / `retrieval_only` / `candidate_cognition_layer` / `adr_trigger` の4つからMaintainerが選ぶ。しかし現行mainにはT5/T6/T7の結果artifactがなく、T8を証拠にもとづいて決められない。

上流のTAIや周辺プロダクトの利用シーンも未確定である。PoCを止めずに機能を確かめるため、現時点で最も安全に実装できる範囲を選ぶ必要がある。

## Decision

T8の暫定判断として **`retrieval_only`** を採用する。

- 実装するのは、語彙のJaccard、共有島、共有出典による決定論的な候補順位付けだけとする。
- 学習モデル、埋め込み、外部推論、ネットワーク送信は使わない。
- affinity incrementやcognitive-control incrementを主張しない。
- 候補は最大3件をSidePanelに表示し、関係・統合・レビュー状態を自動変更しない。
- スコアと理由（`lexical-overlap`、`shared-island`、`shared-source`）を表示し、人が検証できるようにする。

これはT8の証拠判断を置き換えない。T5/T6/T7のartifactが揃った時点で、T8を正式に再評価する。`candidate_cognition_layer`へ進むには、T5のProceedとT6/T7の結果を必要とする。

## Consequences

- #3157は`retrieval_only`として一旦閉じる。学習順位付けの実装は、T8の正式判断まで開始しない。
- 候補の精度・有用性は、実利用者の観察で別途評価する。現時点では「候補が出ること」と「安全に適用されないこと」だけをテストで固定する。
- 将来、両建てや別方式が必要になった場合は、このADRをSupersedeするか新しいADRを起こす。
- T8の証拠が揃わないままでも、既存の検索・一覧・人手の関係付けは引き続き使える。
