# ADR-0084: 人間・AI協働のsensemakingライフサイクルと権限境界を分離する

- Status: Accepted
- Date: 2026-09-18
- Deciders: Maintainer
- Scope: `README.md`, `00_Prompt/domain.md`, `00_Prompt/cognitive_frame_and_evolution_criteria.md`, `00_Prompt/ai_cognitive_externalization_requirements.md`, `01_Plans/adr/ADR-0001-value-to-requirements.md`, 将来のWorkingGraph / AI Workspace / review・approval設計
- Related: `ADR-0075-l2-autonomy-promotion.md`, `ADR-0083-product-naming-and-trademark-boundary.md`

## Context

SUI Sensemakingはこれまで、KJ法に着想を得た人間の意味形成を中心に据え、AIを一貫して「候補生成器」として扱ってきた。この境界は、現在のSafeMode、`proposal-only`、`human_reviewed`の運用を安全に成立させるうえで有効である。

一方、SUIの長期的な価値はKJ法キャンバスだけに閉じない。人間とAIが未整理な材料から関係・仮説・構造・統合を形成し、その意味形成過程を跨セッションで蓄積・再検証できるsensemaking基盤として発展させる。

AI能力が拡大すれば、AIが担う領域も、単発の候補提示から、複数段階の探索、仮説形成、構造化、反証、統合へ広がる。その結果、人間の役割は、逐次操作から、方向づけ、理解、異議、承認へ移る可能性がある。

既存文書には、この長期射程と現在の安全運用が同じ規範層に置かれている箇所がある。特に「AIは常に候補生成器」「AIは人間承認なしに提案を適用してはならない」を、AI内部の探索まで含む普遍的禁止として読むと、将来の委任・監督付き自律をSUI自身が妨げる。

必要なのは、安全境界を弱めることではなく、**AIが自律的に考えてよい作業空間と、共有・承認済みの意味として扱う権限境界を分離すること**である。

## Decision

### D1. SUIの中心を「特定手法」ではなくsensemaking lifecycleとして定義する

SUIは、人間および人工認知系が、未整理な材料から関係・仮説・構造・統合を形成し、その形成過程を保持しながら理解を成熟させるためのsensemaking基盤とする。

KJ法に着想を得たキャンバスは、SUIにおける中核的な人間系sensemaking interfaceであり続ける。ただし、SUI Coreの内部表現、AIの探索方法、将来の認知プロトコルをKJ法だけに限定しない。

### D2. 「AIが考えること」と「受け入れ済みの意味へ昇格すること」を分離する

AIは、権限境界の内側にある作業空間で、次を複数段階にわたり自律実行してよい。

- Observationの生成
- Relation候補の探索
- Hypothesisの形成・反証
- 複数Structureの比較
- Synthesisの生成
- 再探索、別解生成、棄却、やり直し

これらの途中結果を毎回人間が承認する必要はない。

一方、次は別の操作である。

- 人間が作成した一次Evidenceの改変
- `human_reviewed` の付与
- 人間が承認した意味としての公開・共有
- Consensus / Accepted stateへの昇格
- 人間の判断・異議・承認をAIが代行したと見せること

現在のプロダクトでは、これらは引き続き人間の明示操作を要求する。

### D3. proposal-onlyを「現在の共有・確定境界」に限定する

`proposal-only` は廃止しない。

ただし意味を次のように限定する。

> AIは、共有・承認済み・人間レビュー済みの正規状態を、人間の明示操作なしに変更しない。

これは「AIは一段階の候補しか作れない」「AI内部の仮説から次の仮説へ自律遷移してはならない」という意味ではない。

AI Workspace / WorkingGraph内では、来歴を保持したうえで複数段階の自律sensemakingを許容する。

### D4. 人間とAIの役割分担を固定しない

SUIは、少なくとも次の利用状態を同じ情報資産上で支えられる方向へ進化する。

1. **Human-led** — 人間が意味形成を行い、AIは観察・補助を担う
2. **Collaborative** — 人間とAIが別々の観測・仮説を持ち寄る
3. **Delegated** — 人間が範囲と目的を与え、AIが一定区間のsensemakingを進める
4. **Supervised autonomous** — AIが継続的に探索・統合し、人間が理解・異議・承認を担う

これらを一方向の成熟度ランキングとはしない。対象、リスク、利用目的に応じて工程単位で異なる役割分担を選べることを目指す。

### D5. 変わらない不変条件を明確にする

AIの自律度が上がっても、次は維持する。

- 元Evidenceと派生解釈を混同しない
- Unknown / Hold / Conflictを自動的に事実へ潰さない
- 少数意見・反証・違和感を都合の悪いノイズとして削除しない
- AI生成物の主体、provider、入力範囲、来歴を追跡可能にする
- 人間のreview / approvalをAIが偽装しない
- 共有・公開時のSafeMode境界を迂回しない
- 探索結果を不可逆に唯一の意味へ固定しない

### D6. 現行実装の安全境界は本ADRだけでは変更しない

本ADRは長期のProduct / Domain boundaryを更新するものであり、現行runtimeの自動適用を有効化しない。

当面は次を維持する。

- SafeMode既定ON
- `human_reviewed` は人間だけが設定
- 現行APIのproposal-only挙動
- 共有・export時の人間レビュー境界
- `SUI_LLM_PROVIDER=none` でも人間主導の主要機能を利用可能

将来、Accepted / Consensusへの自動昇格、代理承認、外部Actionまで許可する場合は、別ADRでAuthority model、停止条件、監査、取消し、失敗時挙動を定義する。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| **業務設計** | SUIは人間主導からAI主導＋人間理解・承認まで同一ライフサイクルで支える | データ: AI内部成果と承認済み意味を区別する。機能: 工程ごとに自律度を選べる余地を残す |
| **データ設計** | Evidence / AI-derived artifact / reviewed・accepted state / provenanceを混同しない | 業務: 人間の承認をAIが偽装できない。機能: AI Workspaceから共有面への昇格を明示操作として扱う |
| **機能設計** | AI Workspaceでは複数段階の自律sensemakingを許容し、現行の共有・確定面ではproposal-onlyを維持する | 業務: 現行安全運用を変えず長期射程だけを拡張する。データ: 自律探索の途中状態にも来歴を残す |

三要素の整合上、「AIの自律性を高めること」と「人間承認を消すこと」は同義ではない。自律探索を拡大しつつ、権限境界は独立して保持できる。

## Consequences

### 期待される効果

- SUIの存在理由が「AIの不得意を補う」「人間が必ず全操作を行う」ことに依存しなくなる。
- KJ法キャンバスを保持したまま、AI-nativeなsensemaking手法を追加できる。
- AI能力の向上を、既存価値への脅威ではなく、より広い委任区間を可能にする変化として受け止められる。
- 「候補」「仮説」「統合」「承認」を別状態として扱うことで、AIの内部自律性と人間の権限を両立できる。
- 将来、人間が全カード操作を追わず、Review Capsule等を通じて理解・異議・承認に集中する設計へ移行できる。

### 制約・後続課題

- `domain.md`のAI禁止事項を、内部探索と共有・確定境界の違いが分かる表現へ改訂する必要がある。
- `ai_cognitive_externalization_requirements.md`の「AIは常に候補生成器」という表現を改訂する必要がある。
- `ADR-0001`のAI要求は、AI Workspace内の自律処理とAccepted stateへの昇格を区別する必要がある。
- 将来のデータモデルでは、Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Review / Decisionの区別を検討する。
- 自律度は精度スコアだけで自動昇格させず、対象業務・権限・損失可能性を含むpolicyとして扱う必要がある。

## Traceability

- `00_Prompt/domain.md` — AIと共有・確定面のドメイン境界
- `00_Prompt/cognitive_frame_and_evolution_criteria.md` — SUIの存在理由と長期進化基準
- `00_Prompt/ai_cognitive_externalization_requirements.md` — AI Workspaceと人間・AI協働の要件
- `01_Plans/adr/ADR-0001-value-to-requirements.md` — 価値から具体要求への変換
- `AGENTS.md §7` — 現行開発時の安全不変条件。本ADRだけでは変更しない
