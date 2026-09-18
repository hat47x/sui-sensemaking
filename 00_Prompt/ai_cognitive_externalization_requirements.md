# 人間・AI協働の認知外在化基盤としての SUI Sensemaking 拡張要件

- Status: Normative

**English summary**  
This document defines SUI Sensemaking as a durable cognitive externalization and sensemaking environment for humans and artificial cognition.  
It supports a lifecycle from human-led exploration through collaboration and delegation to supervised AI autonomy, while keeping evidence, provenance, uncertainty, review, and authority boundaries explicit.

---

# 0. 本文書の位置づけ

本書は、今後の sui-sensemaking プロジェクトにおける **中核文書** である。  
ここで定義するのは単なる追加機能ではない。sui-sensemaking を、

- 人間のための空間的思考・KJ法キャンバス環境
- AIのための持続的な認知外在化・探索環境
- 人間とAIの役割分担が変化しても意味形成の来歴を継続できるsensemaking基盤

として再定義するための、設計原理・射程・要件・実装方針である。

本書は、以下の上流文書と整合する。

- `00_Prompt/domain.md`
- `01_Plans/adr/ADR-0001-value-to-requirements.md`
- `02_Architecture/architecture.html`
- `02_Architecture/schemas.md`

今後、AI関連機能を追加する際は、本書を参照して整合性を確認すること。

本書に基づく実行計画の正本は `01_Plans/adr/ADR-0028-ai-cognitive-externalization-phase-plan.md` とし、
フェーズ進行・受入条件・検証導線は ADR 側で管理する。

---

# 1. 問題設定

## 1.1 現在の生成AIの限界

> **【2026-08-15 追記】本節を製品の正当化として読んではならない。**
>
> 本節が列挙する限界は、能力向上によって縮小する。したがってこれを存在理由に据えると、
> AI が強くなるほど製品の説明が苦しくなる（`01_Plans/research/product-trajectory-research-2026-08-15.md` §2.1）。
>
> **正当化の正本は `00_Prompt/cognitive_frame_and_evolution_criteria.md` §1 とする** ——
> 人間と人工認知系のsensemaking過程を外在化し、材料・仮説・構造・保留・来歴を跨セッションで蓄積する基盤である、という定義である。
> KJ法に着想を得たキャンバスはその中核的な人間系インターフェースだが、認知主体や認知手法はそれだけに限定しない。
> この価値はAI能力の向上によって失効せず、むしろAIへ委任できる区間の拡大として取り込める。
>
> 本節は引き続き有効だが、その役割は「正当化」ではなく **「フレームを適用しない場合に生じる失敗様態の記述」** である。

生成AIは、単発の要約・変換・応答において高い能力を示す一方、高度な意思決定や長期的思考支援に必要な以下の能力に限界がある。

- 文脈の長期保持
- 多層的な前提関係の維持
- 反対視点や矛盾の保留
- 事実・主張・仮説の峻別
- 「まだ決めるべきでないこと」を保留すること
- 認知的作業空間そのものの持続

このため、生成AIをそのまま「結論生成器」として使うと、

- 早すぎる収束
- もっともらしい誤り
- 反対仮説の消失
- レビュー不能な要約の流通

が起きやすい。

## 1.2 必要なのは“賢いAI”ではなく“賢く考え続けられる場”である

高度な判断に必要なのは、単なる知識量ではなく、**文脈に即した情報の蓄積と配置** である。  
すなわち、

- 何が前提か
- 何が事実で何が仮説か
- どこに対立があるか
- どこまでがレビュー済みか
- 何が未整理で保留されているか

が、構造として保持される必要がある。

この地形はセッションの外に置かれてはじめて持続する。
したがって必要なのは、**sensemakingの材料・途中状態・関係・仮説・統合・来歴を、認知主体を跨いで蓄積できる基盤** である
（`cognitive_frame_and_evolution_criteria.md` §1）。

> 本節を「生成AIには維持できないから外部が要る」と読んではならない。それは §1.1 の追記で
> 退けた欠損ベースの形式であり、`cognitive_frame_and_evolution_criteria.md` §1.2 が禁じている。
> 地形を外に置く理由は能力の不足ではなく、**認知の蓄積が跨セッションで参照可能でなければ
> 拡張にならない**という、認知主体を問わない要件である。

---

# 2. 基本コンセプト

## 2.1 SUI Sensemaking の再定義

SUI Sensemaking は、単なるKJ法図解ツールではない。  
また、単なる生成AI支援ツールでもない。

SUI Sensemaking は、

> **人間および人工認知系が、未整理な材料から関係・仮説・構造・統合を形成し、その過程を保持しながら理解を成熟させるための、構造化されたsensemaking・認知外在化環境**

である。

KJ法に着想を得たキャンバスは、人間が意味形成へ深く参加する局面の中核インターフェースとする。一方、AI内部の探索方法やSUI Coreの表現を、KJ法だけに固定しない。

## 2.2 外部認知空間という位置づけ

ここでの認知拡張は、AIの不足を恒久的に補うことを意味しない。  
SUI Sensemaking は、人間とAIの双方に対して、

- 構造
- 保留
- 対立
- 根拠
- 履歴
- 文脈の配置
- 生成主体と承認主体
- 未確定から採用までの状態遷移

をセッション外へ持続させる外部認知空間として機能する。

AIが十分に高度になった後も、探索過程を外在化することで、別主体による検証、再開、異議、再解釈、承認が可能になる。

> **SUIはAIの弱さを補う補助具ではなく、人間とAIが同じ意味形成の地形を継続的に読み書きするための基盤である。**

---

# 3. 目標（Goal）

本拡張の目標は、次の三つに整理される。

## 3.1 人間向け目標

- 空間配置を通じて意味や違和感を扱えること
- 曖昧さを保留したまま思考を継続できること
- AIの出力を飲み込まず、比較・保留・修正・承認できること

## 3.2 生成AI向け目標

- 構造化された文脈投影を受け取れること
- 探索の深さ・範囲・制約を明示的に与えられること
- 単なる自由テキストではなく、思考済みの地形の上で推論できること

## 3.3 システム全体としての目標

- AI Workspace内の自律的な途中生成物と、共有・承認済みの意味を区別できること
- 共有・確定面へ出るAI生成物は差分・候補・パッチとしてレビュー可能であること
- 人間とAIそれぞれのレビュー状態・生成主体・承認主体が明示されること
- safeMode を共有・配布時の既定とすること
- 後から監査・差分確認・再評価ができること
- 中間処理（分類/要約/整形/条件分岐）と最終判断（採否・統合方針）を分離し、
  モデル能力とコストに応じて責務分担できること

---

# 4. 非目標（Non-goals）

本拡張は、以下を目的としない。

- AIの自律度や生成量そのものを価値指標にすること
- AI生成物を、来歴・レビュー・権限境界を飛び越えて人間承認済みの意味として扱うこと
- 一つのモデル、一つのクラスタリング、一つの総合スコアへ意味形成を集約すること
- 「もっともらしくまとまった文章」を素早く作ること自体
- KJ法キャンバスまたはチャットUIのどちらか一方を、将来の唯一の操作面として固定すること
- 生成AIの内部モデル改善そのもの

---

# 5. 設計原則

## 原則1：単一の真実源と複数の投影を分ける

正規データは `document` と `view` に保持する。  
AI向けコンテキストは、それらから都度構成される **投影（projection）** であり、一次データではない。

## 原則2：人間向け空間文脈とAI向け文脈を分ける

人間にとって意味を持つものと、AIにとって有効なものは異なる。

- 人間向け：位置、近接、見た目、脇置き、暫定配置
- AI向け：対象集合、関係集合、深さ、範囲、レビュー状態、除外条件

両者は対応してよいが、同一である必要はない。

## 原則3：AIの作業空間と承認済みの意味を分離する

AIは、AI Workspace / WorkingGraph内では、下書きや単発候補に限らず、Observation、Relation、Hypothesis、Structure、Synthesisを複数段階にわたり生成・比較・棄却・再生成してよい。

ただし、AI内部で採用した作業仮説を、そのまま人間が理解・承認した意味へ昇格させてはならない。共有・Accepted・Consensus等の正規状態へ移す境界では、

- 生成主体
- 根拠
- 差分
- provenance
- review state
- authority

を確認できる形にする。

現行runtimeでは、この権限境界を `proposal-only` と人間の明示承認で実装する。  
Consensus Graph（旧称: Core Graph）をAIが直接変更してはならない。

### 原則3a：カードの元の意味を品質支援より優先する

AIは、カードの分割、文脈補足、出典追加、観察と解釈の分離を提案してよい。ただし、品質を点数や合否で示さず、出典・話者・日時・因果関係を推測せず、利用者の採用前に本文や状態を変更してはならない。

利用者は本文だけでカードを保存できる。品質支援は保存後または利用者が求めたときに、一つずつ確認できる任意の提案として提示する。詳細は `00_Prompt/qualitative_card_quality_requirements.md` を正本とする。

### 原則3b：視覚手掛かりを意味の正本にしない

AIは、島または利用者が明示的に選んだ情報集合を見つけ直すための小さな画像候補を提示してよい。ただし、画像は表札、要約、本文、根拠の代替ではなく、人間向けの任意の再認識補助とする。画像の生成、取得、採用は明示操作を必要とし、採用前に正規データを変更しない。

絵文字、同梱プリセット、権利確認済み外部素材、生成画像は、通信・権利・来歴が異なる経路として扱う。外部検索または生成へ渡す投影は利用者が事前に確認でき、SafeModeと暗黙のprovider切替禁止を守る。曖昧さや対立を一つの具体像へ収束させず、画像なし、中立的な候補、複数候補を許容する。詳細は `00_Prompt/representative_visual_cue_requirements.md` を正本とする。

利用者の手描き、基本図形、撮影写真はAI機能へ従属させない。写真・図が一次資料である場合、AIが作るサムネイルや説明は投影・提案に留まり、元資料、撮影文脈、出典を変更または置換しない。

### 原則3c：表札（島タイトル）の代弁性を分類名化より優先する

AIは島タイトル候補を提案してよい。ただし、その候補が別の島の上に置いても成立してしまう一般的な分類名（例：「重要な論点」「今後の課題」）になっていないかを検査し、該当する場合は書き直し案を示す。AIはタイトルを確定または自動適用してはならない。詳細は `00_Prompt/qualitative_card_quality_requirements.md` 第5章、転写検査そのものは `00_Prompt/sensemaking_technique.md` 第3章を正本とする。

## 原則3d：役割分担をライフサイクルとして扱う

SUIは、人間とAIの役割を一つに固定しない。対象・リスク・利用目的に応じて、少なくとも次の状態を同じ情報資産上で支えられる方向へ進化する。

1. **Human-led** — 人間が意味形成を行い、AIは観察・補助を担う
2. **Collaborative** — 人間とAIが異なるObservationやHypothesisを持ち寄る
3. **Delegated** — 人間が目的・範囲・停止条件を与え、AIが一定区間を自律処理する
4. **Supervised autonomous** — AIが探索・反証・統合を継続し、人間は理解・異議・承認を中心に担う

これは成熟度ランキングではなく、工程ごとに選択できる役割分担である。現在の公開実装はHuman-led / Collaborativeを中心とし、より高い自律度を本書だけで有効化しない。

## 原則4：曖昧さ・対立・未解決を保持する

AIは収束したがる。  
sui-sensemaking は、

- contradictions
- unknowns
- hypothesis
- unreviewed
- pending

を構造として保持し、消去対象ではなく **保留対象** として扱う。

## 原則5：共有時は安全側に倒す

共有・レビュー配布・静的公開などの経路では、safeMode を既定ONとし、未レビューAI文章や生テキストを漏らさない。

## 原則6：推論パイプラインを二層化する（中間処理層 / 最終判断層）

分類・要約・フォーマット変換・条件分岐などの中間処理は、
高速・低コスト層（例: Groq 上の Llama / Qwen）へ委譲してよい。

ただし、次の最終判断は高信頼層（例: Claude / GPT-5）に限定する。

- patch の採否判定
- competing proposal の統合方針
- 保留解除の提案（hold解除候補）
- 公開前の最終 narrative 承認候補

現行runtimeでは、最終判断層の出力も **共有・Accepted・Consensusへ自動確定せず** proposal-only とする。
将来AI Workspace内部の作業判断を自律化しても、この共有・承認境界とは分離する。

---

# 6. 三層アーキテクチャ

本拡張では、文脈を三層で扱う。

## 6.1 Consensus Graph（旧称: Core Graph）

唯一の正規データ層。

含まれるもの：
- Card
- Island
- Membership
- Relation / Edge
- EvidenceLink
- ClaimType
- ReviewState
- Summary / RelationSummary
- PatchLog / AuditLog

## 6.2 Human Spatial Context

人間の認知のための空間層。

含まれるもの：
- card.position
- island.geometry
- collapsed state
- reading order hints
- visual clusters
- temporary placement
- current focus / zoom / perspective

これは人間の思考補助であり、AI入力へ直接渡すことを前提としない。

## 6.3 AI Context Projection（ContextProjectionGraph）

AI問い合わせのたびに Consensus Graph / WorkingGraph から生成される読取専用の投影層。

含まれるもの：
- 対象ノード集合
- 対象島集合
- 対象関係集合
- reviewed-only subset
- contradiction subset
- evidence subset
- traversal depth / scope
- exclusion rules
- safeMode constraints
- output mode

AIはこの投影層を入力として受け取る。
`patch + approval` を経ない direct write / auto-apply は禁止する。

---

# 7. AI Context IR（中間表現）要件

## 7.0 CE0 Contract Freeze 参照（Stream B）

本書で扱う契約語彙は、CE0 Contract Freeze の参照専用固定値に従う。
**凍結内容の正本は `01_Plans/adr/ADR-0028-ai-cognitive-externalization-phase-plan.md`（CE-0）である。**
本節は語彙の対応表であり、凍結の運用（Exit Criteria・衝突検知の閾値・Stream進行）は ADR 側で管理する。

- `CE0-CTX-IF`: ContextQuery/ContextBundle 最小I/F（Query Preview必須、決定論bundle）
- `CE0-SAFEMODE-IF`: safeMode既定ON、`allowUnreviewedText=false` 既定
- `CE0-REVIEW-IF`: `human_reviewed` 昇格は人手のみ
- `CG-01..05`: WorkingGraph / ContextProjectionGraph / ConsensusGraph の責務分離、`patch + approval` 以外の適用禁止

## 7.1 IR の基本方針

AIに渡す入力は、キャンバスの見た目や雑多な履歴ではなく、**問い合わせ目的に応じて切り出された構造化コンテキスト束** であるべきである。

基本形：

```text
ContextQuery -> ContextBundle
```

## 7.1a Multi-Model Routing 要件（MMR-01〜06）

本節は、モデル責務分担を固定する要件である。

- **MMR-01（責務分離）**:
  `intermediate`（中間処理）と `final_judgement`（最終判断）を論理的に分離する。
- **MMR-02（許可タスク）**:
  `intermediate` は `classify/summarize/format_transform/branch_resolve` に限定する。
- **MMR-03（禁止タスク）**:
  `intermediate` は `accept/reject/merge/finalize/publish` を実行してはならない。
- **MMR-04（モデル階層）**:
  `final_judgement` は high-reasoning tier へルーティングする。
  **どのモデルが high-reasoning tier に該当するかは本書では定めない。**
  設定は `02_Architecture/runtime_parameter_registry.md` の `SUI_LLM_HIGH_REASONING_MODEL`
  が持ち（同レジストリの当該行は本要件を MMR-04 として参照している）、
  複雑度とモデルの対応は `01_Plans/adr/ADR-0065-llm-model-selection-by-task-complexity.md` が持つ。
  ここにモデル名を書くと、モデルが更新されるたびに憲法を書き換えることになる。
- **MMR-05（監査性）**:
  監査ログに `routingStage`（intermediate/final_judgement）、
  `provider/model`、`sourceBundleHash`、`proposalId` を必須記録する。
- **MMR-06（安全停止）**:
  `final_judgement` 経路が利用不能な場合は auto-publish へフォールバックせず、
  `held` へ遷移して人手確認待ちにする。

## 7.2 ContextBundle に最低限含むべき要素

- query metadata
- selected cards / islands
- adjacency / relation subset
- contradiction subset
- evidence subset
- summaries with review flags
- claimType distribution
- unresolved items
- safeMode policy
- truncation / limit metadata

## 7.3 IR の性質

- 決定論的に生成できること
- query が同じなら同じ bundle を再生成できること
- 実装依存の内部状態に引きずられないこと
- diff / audit 対象にできること

---

# 8. ContextQuery 要件

## 8.1 必要性

自然言語だけでAIへの文脈指定を行うと、探索範囲・深さ・制約が曖昧になり、AIに過度な裁量を与えてしまう。  
そのため、**探索条件を明示的に指定するクエリ機構** を持つことが望ましい。

## 8.2 クエリで指定できるべき軸

### 対象
- card
- island
- document
- relation cluster
- contradiction cluster
- evidence cluster

### 深さ
- direct only
- hop depth 1 / 2 / 3 ...
- reverse evidence depth
- contradiction chain depth

### 範囲
- selected only
- same island only
- adjacent islands
- reviewed-only
- exclude unknown
- include hypothesis

### モード
- summarize
- outline-draft
- title-candidates
- contradiction-trace
- evidence-trace
- critique
- merge-candidates
- next-focus suggestions

### 制約
- safeMode
- maxNodes
- maxChars
- reviewedOnly
- includeUnreviewed
- includeRawText

## 8.3 クエリ表現

初期段階では、厳密な言語仕様よりも、**探索の深さ・範囲・制約を明示できる軽量DSL** を目指す。

例：

```text
focus island:i12
mode contradiction-trace
depth 2
reviewed-only true
exclude unknown
max-nodes 30
```

将来的には、
- UI
- CLI
- API
- AI呼び出し内部

の共通問い合わせフォーマットとして用いる。

---

# 9. AIにやらせる処理 / やらせない処理

## 9.1 AIにやらせる処理

### 候補生成
- 島タイトル候補
- B型文章ドラフト
- 代表カード候補
- 反対視点候補
- 欠落論点候補

### 自律探索（AI Workspace / WorkingGraph）
- Observationの生成
- Relation候補の探索
- Hypothesisの形成・反証・棄却
- 複数Structureの比較
- Synthesisの生成と再探索
- 異なる認知器・モデル・決定論的処理の結果の並存

### 制約付き変換
- reviewed-only からの要約
- contradiction cluster からの論点整理
- evidence graph からの narrative draft

### 探索支援
- 次に見るべき島・カード候補
- 根拠不足の仮説抽出
- 整理が必要な混在島の指摘

### パッチ提案
- summary rewrite proposal
- merge proposal
- relation summary draft

## 9.2 AIにやらせない処理

ここで禁止するのはAI Workspace内の仮説形成ではなく、**権限境界を越えた確定・偽装・一次情報改変**である。

- AI Workspaceの分類・関係・仮説を、人間承認済みの最終確定として扱うこと
- 真偽が未確定なHypothesisをEvidenceへ書き換えること
- `human_reviewed` 状態の自動付与
- Consensus Graph（旧称: Core Graph）の暗黙更新
- 人間または別主体の保留・異議を権限なく解消すること
- 未レビューのまま外部共有向け文章を人間承認済みの正式版として出すこと

---

# 10. 機能要件

各機能が**何を満たさなければならないか**を定める。
**どれをいつ作るかは定めない** —— 実装順序・反復割当・受入条件の正本は
`01_Plans/adr/ADR-0028-ai-cognitive-externalization-phase-plan.md`（CE-0〜CE-4）である。

以前は本節を「10.1 MVPで実装すべきもの / 10.2 中期拡張」に分けていた。
分割は release 計画の関心であり、憲法が持つと計画変更のたびに憲法が動く。

### M1. Context Query Preview

AIに渡る前に、
- どのカードが含まれるか
- どの島が含まれるか
- どの関係が含まれるか
- どの制約が適用されるか

を人間が確認できること。

### M2. 島タイトル候補生成

- 1つの島または島群を対象に、タイトル候補を複数提示
- 自動適用はしない
- 選択・編集・破棄を可能にする

### M3. B型文章ドラフト生成

- reviewed-only を既定とする
- unreviewed を含める場合は明示
- 出力は常に draft とする
- patch / diff として比較可能であること

### M4. 反対視点・根拠不足提案

- contradiction / evidence 構造をもとに、未検討論点や根拠不足箇所を提案
- 結論ではなく、考えるべき点を提示する

### M5. AI Patch Proposal Workspace

AIが出した複数案を並置し、
- 比較
- 一部採用
- 保留
- 廃棄

をキャンバス上で扱えること。

### M6. Query Presets

頻出する問い合わせ（例：reviewed-only contradiction trace）をプリセット化する。

### M7. AI-aware Perspective Mode

人間向け視座とは別に、AI問い合わせに適した視座モードを導入する。

---

# 11. UI / UX 要件

## 11.1 現在はキャンバスを中核とし、将来は複数の理解面を許容する

現在の人間主導・協働フェーズでは、AIとのやりとりをチャット欄だけに閉じず、**キャンバス上の材料・配置・関係へ作用する操作** として設計する。

将来AIがより広いsensemaking区間を担う場合、人間が全中間操作を追うことを前提にしない。Review View、Graph View、差分、根拠、反証、Review Capsule等の理解・承認面を追加できるようにし、キャンバスをSUI Coreそのものとは同一視しない。

## 11.2 AI由来と人間由来を明確に区別

最低限、視覚的に区別すべき状態：

- AI提案
- 人間未確認
- 人間レビュー済
- 人間修正済
- AI由来だが人間承認済

## 11.3 保留を操作可能にする

- 採用しないが保持
- 比較候補として残す
- 反証待ちにする
- 根拠不足として保留する

など、「未決着」を表現できる必要がある。

---

# 12. 安全・統治要件

## 12.1 SafeMode

共有・配布・レビュー用途では safeMode を既定ONとする。

safeMode時：
- 未レビューAI文章は既定で出さない
- 生カードテキストは既定で出さない
- IDs / counts / reviewed flags 中心に落とす

## 12.2 Review Attribution

AI出力が最終的に採用される場合でも、
- 誰がレビューしたか
- どの時点で承認されたか
- どの差分が適用されたか

を追跡可能にする。

## 12.3 Auditability

AI Context Query と AI出力は、必要に応じて
- query log
- generated patch
- apply log

として監査可能であることが望ましい。

---

# 13. 既存設計との接続

本拡張は、既存の以下の設計資産を前提とする。

- patch / diff / conflict detect
- review attribution
- safe mode policy
- diagnostics / contradiction / evidence trace
- perspective / reading path / presets
- worker-based computation

したがって、新機能は既存資産を置き換えるのではなく、**AI問い合わせ層として接続** することを原則とする。

---

# 14. プロジェクト判断基準

この方向性に沿う機能かどうかは、次の問いで判定する。

1. これは人間またはAIのsensemakingを、根拠を失う方向へ雑にしないか
2. これは早すぎる収束を強制しないか
3. これは保留・対立・未レビュー・反証を保持できるか
4. これは生成主体・差分・監査・レビュー・承認を辿れるか
5. これは人間向け文脈とAI向け文脈を混同していないか
6. AI Workspace内の自律処理と、共有・承認済み状態への権限昇格を混同していないか

いずれかに強く反するなら、採用しない。

---

# 15. 実行フェーズ

**実行フェーズの正本は `01_Plans/adr/ADR-0028-ai-cognitive-externalization-phase-plan.md`（CE-0〜CE-4）である。**
依存順序・Exit Criteria・Stop Conditions・issue分割は同 ADR が持つ（§0 でもそう宣言している）。

本節にはかつて `Phase A`〜`Phase D` という独立した4段構成があった。削除した理由は次の3点である。

- **リポジトリ内で本書以外のどこにも存在せず、参照している文書も無かった。** 計画として機能していない。
- ADR-0028 の `CE-0`〜`CE-4` と**対応表が無く、どちらが有効なのか読んで判断できなかった。**
  同じ計画に二つの語彙があり、片方だけが正本と宣言されている状態だった。
- 段階分けは実装の関心である。憲法が持つと、計画を組み替えるたびに憲法を書き換えることになる。

---

# 16. 結論

SUI Sensemaking のAI拡張の本質は、AIを賢くすることだけではない。  
本質は、

> **材料・Observation・Relation・Hypothesis・Structure・Synthesis・保留・反証・根拠・来歴を、認知主体を跨いで継続できる外部sensemaking空間として保持すること**

にある。

この方向性において、SUI Sensemaking は単なる図解ツールではなく、

> **人間と人工認知系が役割分担を変えながら意味を形成し、その過程を理解・検証・承認し直せる知識蓄積基盤**

である（`cognitive_frame_and_evolution_criteria.md` §1）。

KJ法に着想を得たキャンバスは、その中で人間が深く意味形成へ参加するための中核インターフェースとして位置づける。

---

# 17. 変更記録

| 日付 | 変更 | 理由 |
|---|---|---|
| 2026-09-18 | ADR-0084に基づき、人間主導から監督付きAI自律までのsensemakingライフサイクルと、AI Workspace / 承認済み状態の権限境界を追加した | AI能力の向上を取り込みつつ、現行SafeMode・proposal-only・human_reviewed境界を長期ビジョンと混同しないため |
| 2026-08-15 | §1.1 の正当化を `cognitive_frame_and_evolution_criteria.md` §1 へ移した | 欠損ベースの正当化はAI能力の向上で失効する |
| 2026-08-16 | §1.2 末尾と §16 に残っていた欠損ベースの記述を是正した | 同書 §1.2 が禁じている形式が憲法層に残っていた |
| 2026-08-16 | §7.0 から Stream B の衝突検知閾値を除き、正本を ADR-0028 CE-0 とした | 実装ストリームの運用値であり、憲法の条項ではない |
| 2026-08-16 | §7.1 の本文を復元した | §7.1a（MMR要件）の挿入時に見出しと本文が分断され、§7.1 が空になっていた |
| 2026-08-16 | MMR-04 から具体モデル名を除いた | モデル更新のたびに憲法を書き換えることになる |
| 2026-08-16 | §10 の「MVP / 中期拡張」区分を除いた | 何を満たすかは憲法、いつ作るかは計画 |
| 2026-08-16 | §15 の `Phase A`〜`D` を削除し、ADR-0028 への参照にした | 参照者ゼロで、ADR-0028 の CE-0〜CE-4 と対応表の無い二重の計画だった |
