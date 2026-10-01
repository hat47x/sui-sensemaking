# ADR-0090: 認知支援を候補層として段階導入し、単純方式から証拠で昇格する

- Status: Accepted
- Date: 2026-10-01
- Deciders: Maintainer
- Scope: `00_Prompt/`, `01_Plans/adr/`, `02_Architecture/llm_*.md`, AI支援の候補生成経路
- Supersedes: `ADR-0028` のフェーズ計画・Issue運用・完了ゲート。認知支援の安全境界は本ADRと現行の正本文書へ引き継ぐ。

## 価値への寄与

V2「構造化」とV3「レビュー」に寄与する。特に `ADR-0010` の保留尊重・反スコアリング・人間レビュー中心を維持したまま、利用者が自力では見落としやすい近接・対立・残余・別視点を**候補として**見つける助けにする。正本は `ADR-0089`。

## Context

SUIの一次利用仕事は、まとまりきらない定性資料を早すぎる分類・要約・合意で潰さず、根拠・異論・保留・人間の判断権を残したまま構造化することである。

認知支援には複数の実現方式がある。

- 決定論的な関係・空間・履歴アルゴリズム
- 文字n-gramやTF-IDF等の軽量な統計方式
- FlyHash / WTA / learned sparse representation等の疎表現
- sentence embedding等のsemantic encoder
- local LLM / 外部LLM

高度な方式ほど常に価値が高いわけではない。SUIでは、モデルが賢くなること自体よりも、

- 利用者が新しい材料や関係に気づけるか
- 少数意見・矛盾・保留を吸収しないか
- 候補を見ても利用者自身の判断が残るか
- local/offlineや `SUI_LLM_PROVIDER=none` の主要価値を壊さないか

が重要である。

2026-09には COGNITIVE-ASSOC 系の探索で、A/C/E等を比較する評価ハーネス、疎表現候補、固定semantic provider等を検討した。しかし2026-10-01の管理文書整理で、それらdogfood/研究成果物は正本から削除された。git履歴には残るが、現時点で固定semantic baseline Eの実モデル実行は完了しておらず、方式のwinner・製品採用判断は成立していない。

一方、現行正本には既に次がある。

- `llm_input_ir_spec.md`: relation/spatial由来の決定論的 `cluster_candidates`
- `domain.md`: AIの内部探索権限と、人間承認済み意味への昇格権限の分離
- `ai_sensemaking_execution_procedures.md`: proposal-only / 反スコアリング / SafeMode
- `ADR-0043`: 認知負荷を増やしすぎない複雑性予算
- `ADR-0069`: AI入力を意味保全されたIRへ限定する境界
- `ADR-0084`: proposal-onlyを「AIは一段しか探索できない」とは解釈しない

したがって、認知系の次の課題は新しい研究管理体系を復活させることではなく、**どの方式を、どの証拠で、どこまで製品経路へ昇格させるか**を簡潔に固定することである。

## Decision

### 1. 認知支援の出力は「候補層」とする

認知器は、確定構造ではなく利用者の注意を再配分する候補を生成する。

候補にできるものは、例えば次である。

- 近いかもしれないカード集合
- 一緒に見ると意味が変わるカード
- 既存の島から漏れている残余
- 対立・矛盾・反証の可能性
- 別の切り口
- 既存構造を壊さず比較できる仮配置

候補は Accepted / Consensus / `human_reviewed` を成立させない。保留中のカードを権限なく新しいまとまりへ吸収しない。

### 2. 方式は単純なものから段階的に昇格する

同じ認知仕事を満たせるなら、原則として次の順で検討する。

1. **決定論的構造方式**
   - confirmed relation、空間、既存の島、hold、履歴等
   - 再現性が高く、provider不要
2. **軽量な語彙・統計・疎方式**
   - char n-gram、TF-IDF、固定seed sparse expansion、FlyHash系、必要なら小規模学習器
   - CPU/local実行を優先
3. **semantic encoder**
   - sentence embedding等
   - 語彙表面を越える必要が実際に残った場合のみ
4. **生成モデルによる探索**
   - local LLMを外部providerより先に検討できる
   - 外部providerはopt-inであり、SafeMode/送信境界を変えない

上位方式へ進む理由は「新しい技術だから」ではなく、下位方式では埋まらない具体的な認知上の欠落が確認されたことである。

### 3. 内部計算のscoreと利用者への意味づけを分離する

検索・近傍探索・モデル内部では距離やscoreを使ってよい。

ただし利用者向け候補では、

- 「最適」
- 意味の確からしさの数値
- 意見の重要度ランキング
- 自動採用の閾値

へ変換しない。

必要なら内部scoreは再現性・デバッグ用Evidenceとして保持するが、候補の意味上のauthorityにはしない。

### 4. 昇格判断は「モデル精度」と「認知増分」を分ける

方式の評価は単一scoreへ畳まない。少なくとも次を別々に見る。

**方式としての性質**

- 候補coverage / 見落とし
- surface decoyへの過反応
- contradiction / minority / residualの保存
- 再現性
- CPU時間、メモリ、モデルサイズ
- local/offline可否
- 依存・配布コスト

**利用者への認知増分**

- 候補が無い場合には見なかった材料へ注意が移ったか
- 構造を見直すきっかけになったか
- 保留・異論を早期収束させなかったか
- 候補がノイズとなり、利用者の探索を狭めなかったか
- 操作・待ち時間・表示量が `ADR-0043` の複雑性予算を侵さないか

方式として良い結果でも、認知増分が確認できなければ製品既定へ昇格させない。

### 5. 証拠階層はADR-0089をそのまま使う

- T3（生成AI模擬）だけの結果は `provisional`
- T2（Maintainer自身の、SUI自身を題材にしない実務利用）で同じ摩擦・増分が再現すれば、製品候補として扱える
- T1は有力だが完了条件にしない
- SUI自身を題材にした内部dogfoodは価値実証には数えない

認知系だけ独自の重いT4/T5/T6管理体系を復活させない。再現実験が必要なら、短いfixture/scriptとPR/コミットのEvidenceで足りる範囲にする。

### 6. provider依存を一次価値の前提にしない

`SUI_LLM_PROVIDER=none` でも一次価値が成立するというCVIを維持する。

semantic encoderやLLMが利用可能な場合でも、

- 基本編集
- 保留
- 関係づけ
- 人間による構造化
- 根拠への回帰

をprovider必須にしない。

認知支援が無効でも文書を開ける・編集できる・共有境界を守れることを維持する。

### 7. cognitive providerは共通境界の後ろに置く

方式ごとに製品意味論を増やさない。

入力は可能な限り既存の意味保全IRを使い、出力は既存のproposal/candidate境界へ戻す。モデル固有のvector、activation、hidden state、confidence等をDocumentV1の意味として保存しない。

将来、semantic artifactとして独立保存する価値が出た場合は、`ADR-0085`〜`ADR-0088` のartifact/provenance/authority設計へ接続し、DocumentV1へ場当たり的なフィールドを追加しない。

### 8. 旧COGNITIVE-ASSOC探索の扱い

2026-09までの探索は次の位置づけとする。

- アルゴリズム候補や評価軸を考えるための履歴として有用
- git履歴から必要なfixture/実装を回収してよい
- 旧issue/dogfood文書を管理体系として復活させない
- semantic baseline Eの未完実測を、現行開発のblocking gateにはしない
- 当時winnerを確定していないため、特定方式の採用根拠として引用しない

再利用するときは、現在の一次利用仕事と証拠階層へ再接続してから使う。

## 非目標

- 特定の認知アルゴリズムをこのADRで採用すること
- モデルbenchmarkのwinnerを決めること
- 自動クラスタリングを確定構造として適用すること
- 人間レビューを減らすこと自体を目的にすること
- 認知器ごとの設定UIを先に増やすこと
- 大規模な研究ログ・issue台帳・評価ダッシュボードを復活させること

## Consequences

- 認知系開発が「どのモデルが強いか」ではなく、一次価値への認知増分から始まる。
- 決定論的方式で足りる領域では、モデル依存・モデルサイズ・配布コストを増やさずに済む。
- semantic方式が必要な場合も、下位方式で埋まらない欠落が説明可能になる。
- 旧研究資産は失われずgit履歴へ残るが、現在の正本を汚さない。
- provider切替や将来の軽量認知器追加でも、DocumentV1・authority・SafeModeの意味を増殖させずに済む。
- T3だけで便利に見える機能を既定UIへ急いで載せないため、機能追加の速度は抑えられる。
- 一方で、T2で同じ摩擦が繰り返し確認された機能は、重い運用ゲートなしに小さな実装として昇格できる。

## Traceability

- Supersedes: `ADR-0028` のフェーズ計画・Issue運用・完了ゲート
- Related: `ADR-0010`, `ADR-0041`, `ADR-0043`, `ADR-0069`, `ADR-0084`, `ADR-0085`〜`ADR-0089`
- Related: `00_Prompt/domain.md`, `00_Prompt/ai_sensemaking_execution_procedures.md`
- Historical exploration: git history of deleted `01_Plans/dogfood/cognitive-assoc-*` and `issue-COGNITIVE-ASSOC-01-*`
