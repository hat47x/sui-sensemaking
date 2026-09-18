# 用語・概念定義

- Status: Normative

このドキュメントは **本アプリケーションにおける概念・用語の揺れを抑制し、
人間とAIの共通理解を維持するためのドメイン定義** です。

実装・ドキュメント・AIプロンプトは、原則として本ファイルに定義された
語彙・意味・対応関係に従います。

> **domain.md は 本アプリケーションにおける「概念の憲法」です。**
> 実装上の都合で意味を変更してはなりません。

### 識別子について

本書の不変条件には安定識別子を付す。**他層（`01_Plans` / `02_Architecture` / `03_Implement`）から
規範を参照するときは、ファイル名だけでなく識別子で指すこと。** 行番号による参照（`domain.md:88` 等）は
編集で腐るため用いてはならない。

| 接頭辞 | 対象 |
| --- | --- |
| `DOM-CORE-*` | §2 基本思想。**主体を問わない不変条件** |
| `DOM-AI-*` | §7 AIが行ってはならないこと |
| `DOM-AIOK-*` | §7 AIが行ってよいこと |
| `DOM-CRIT-*` | §6 Critique の種別と扱い |
| `DOM-SHARE-*` | §8 共有物に必ず含めるもの |
| `DOM-SM-*` | §3.3 sensemaking意味成果物・review・authorityの不変条件 |

識別子は**追記のみ**とし、一度与えた番号を再利用しない。廃止する場合は項目を残して廃止と明記する。

---

## 1. このドキュメントの位置づけ

- 本ファイルは **00_Prompt と 02_Architecture の両方に影響** します
- 実装（03_Implement）よりも **必ず上位** に位置づけます
- AI への指示・構造定義・UI文言は、本定義を参照してください

---

## 2. 基本思想（非コード概念）

> §2 の各項は **主体を問わない**。人間にも、AIにも、両者の協働にも等しく適用される。
> AIに限定された規定は §7 に置く。**§2 と §7 の双方に現れる事項は、§2 が上位である。**

### DOM-CORE-01 保留（Suspension / Hold）

- **意味や判断を確定させない状態を、意図的に維持すること**
- 未熟・未完成・曖昧であることを否定しない

本アプリケーションは、保留を「失敗」や「未完」ではなく、
**探索プロセスの健全な状態**として扱います。

保留は単一の状態ではありません。実装では次の3値を区別します（`HoldState`）。
**いずれも「決めていない」であり、優劣や進捗の段階ではありません。**

| 値 | 意味 |
| --- | --- |
| `held` | 判断を明示的に保留している |
| `pending` | まだ束ねていない（どの島にも属していない） |
| `shelved` | 主たる図から退避させている。削除ではない |

`shelved` の退避記録は `ShelfEntry` として別に保持します。**状態と記録は別物**であり、
退避を解いても記録は残ります（`DOM-CORE-03` 可逆性）。

---

### DOM-CORE-02 違和感（Sense of Discomfort / Incongruity）

- 明確な理由や言語化ができなくてもよい
- 「何か違う」「混ぜたくない」「しっくりこない」という感覚

違和感は **思考を前に進めるための一次データ** であり、
説明責任を伴いません。

---

### DOM-CORE-03 可逆性（Reversibility）

- 配置・分類・構造は、常にやり直せること
- 一度決めた構造に縛られないこと

本アプリケーションでは、
**履歴・差分・巻き戻し** が設計上の前提です。

---

### DOM-CORE-04 非序列化（Non-ranking）

- 内容に **点数・順位・等級・準備度スコアを与えない**
- 統合の結果を単一の正解として提示しない

序列化は分布を早期に潰す操作です。どの項目が重要かを決めるのは利用者であり、
**その判断を数値で先回りしません。**

検査（品質確認）そのものは方法論が要求します。禁じるのは検査ではなく、
**検査結果を点数へ畳んで提示すること**です。報告は件数と種別で行います
（`00_Prompt/sensemaking_technique.md` 第5章「報告は件数で」）。

---

## 3. 中核オブジェクト定義（概念 → コード対応）

| 日本語概念 | 英語概念 | コード上の名称 | 説明 |
|---|---|---|---|
| 生メモ | Raw Note | RawNote | フリーフォームで入力された一次記録 |
| カード | Card | Card | 元の意味と必要な文脈を保ち、一つの中心的内容を扱う最小単位。KJ法カードに相当 |
| ラベル | Label | Label | カードやクラスタにつける短い表札 |
| たたき台 | Draft / Strawman | DraftCluster / ProvisionalLayout | AIが生成する仮配置・仮クラスタ |
| グループ | Cluster | Cluster | 複数カードの仮統合単位 |
| 島 | Island | Island | 複数カードや関係を視覚的に囲む意味のまとまり。KJ法の島に相当 |
| 代表視覚手掛かり | Representative Visual Cue | RepresentativeVisualCue（計画中） | 島または明示的に選んだ情報集合を見つけ直すため、表札や説明と併記する任意の小さな絵文字・アイコン・画像 |
| 一次視覚資料 | Source Visual Material | SourceVisualMaterial（計画中） | 観察・取材・利用者作成で得た写真・図・スケッチなど、元の文脈や出典へ戻る必要がある定性資料 |
| 根拠資料 | Evidence | Evidence（概念。永続型は計画中） | Sensemakingの根拠として参照される資料・記録。TruthやAccepted meaningとは同義ではない |
| 観察 | Observation | Observation（計画中） | Evidenceや対象状態から、ある主体・認知Providerが認識したこと。元資料そのものとは区別し、生成主体と来歴を保持する |
| 関係 | Relation | Relation / Edge | カード、島、観察、仮説の間にある意味的なつながり |
| 仮説 | Hypothesis | Hypothesis（計画中） | EvidenceやObservationをもとに形成された、反証・保留・棄却が可能な解釈 |
| 構造 | Structure | Structure（計画中） | 島、グラフ、因果配置など、複数要素を組み合わせた意味構造の総称 |
| 統合 | Synthesis | Synthesis（計画中） | 複数のRelation / Hypothesis / Structureをまとめた理解。Acceptedでない統合や競合する複数統合も保持できる |
| レビュー | Review | Review（計画中） | 特定revisionに対して人間またはAIが理解・検査・異議・確認した記録。ReviewとAccepted / Consensusを同一視しない |
| 判断 | Decision | Decision（計画中） | Sensemaking結果を踏まえ、あるauthorityのもとで何を採るか／何をするかを選んだ記録。Synthesis / Acceptance / Executionとは別概念 |
| 配置図 | Layout / Map | Layout | 空間的配置を含む図解状態 |
| 違和感 | Discomfort / Incongruity | Critique | 理由の有無を問わない否定・ツッコミ |
| 制約 | Constraint | Constraint | Critique等から生成される再配置条件 |
| 保留状態 | Hold / Suspension | HoldState | 判断を確定させない状態。`held` / `pending` / `shelved` の3値（`DOM-CORE-01`） |
| 退避記録 | Shelf Entry | ShelfEntry | `shelved` にした事実の記録。退避を解いても残る |
| 作業グラフ | Working Graph | WorkingGraph | 主体ごとの探索・未確定保持を担う作業面 |
| 文脈投影グラフ | Context Projection Graph | ContextProjectionGraph | AI問い合わせやプレビューのために作る読取専用の投影面 |
| 合意グラフ | Consensus Graph | ConsensusGraph | 人間承認済みの差分だけを保持する統合面。旧称 Core Graph |

---

### 3.1 カードに記述する定性情報の品質

カードは「短ければよい」ものではありません。次の条件を満たし、後から並べ替え、比較し、元の意味へ戻れることを品質とします。

- 一枚に一つの中心的内容を置く。
- 元の観察、発言、経験、語り手の意図を変えない。
- 解釈に必要な文脈と、必要に応じて元記録へ戻る手がかりを残す。
- 観察・引用と、解釈・仮説を混同しない。
- 少数意見、外れた事例、矛盾、違和感をノイズとして消さない。

ただし、カード本文以外の入力を一律に必須化しません。利用者はまず本文だけで保存でき、分割、文脈、出典、認識上の位置づけに関する支援は、保存後または明示的に求めたときに任意の提案として受け取ります。AIは内容を採点せず、出典や文脈を推測せず、利用者の確認前に本文や状態を変更しません。

要件、低負担な確認方法、受入条件の正本は `00_Prompt/qualitative_card_quality_requirements.md` とします。

### 3.2 表札（Label）の内容品質

表札は分類名ではありません。その束（クラスタ・島）が何を訴えているかの代弁です。ある表札を別の束の上に置いても違和感なく成立してしまうなら、それは代弁ではなく分類名であり、書き直しが必要です。

要件（転写検査を含む）の正本は `00_Prompt/sensemaking_technique.md` 第3章、AI支援としての扱いは `00_Prompt/qualitative_card_quality_requirements.md` 第5章とします。

---

### 3.3 sensemaking意味成果物の不変条件

詳細な概念モデルは `02_Architecture/sensemaking_semantic_model.md`、設計判断は `ADR-0085` を正本とする。

- **DOM-SM-01 Evidence ≠ Truth**  
  Evidenceは根拠として参照される資料・記録であり、その内容が真であること、Acceptedであることを意味しない。相反するEvidenceや誤りを含む元資料も、来歴を保持して扱える。

- **DOM-SM-02 Semantic kind ≠ Maturity state**  
  Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Review / Decisionは成熟段階ではない。ObservationをHypothesisへ、HypothesisをSynthesisへin-placeで型変更しない。新しい意味成果物を作り、元成果物へ来歴関係で接続する。

- **DOM-SM-03 Observation is actor-attributed**  
  Observationは「誰／どの認知Providerが、何を入力として、何を認識したか」を外在化した記録である。同じEvidenceから複数の異なるObservationが生じてよく、不一致を一つのscoreへ自動統合しない。

- **DOM-SM-04 Review ≠ Acceptance**  
  Review済みであることはAccepted / Consensus / Truthを意味しない。AI Reviewを人間Reviewとして記録してはならず、現行`human_reviewed`は引き続き人間の明示操作だけで成立する。

- **DOM-SM-05 Authority is orthogonal**  
  Working / Candidate / Accepted / Consensus等のauthority上の位置づけは、HypothesisやSynthesis等のsemantic kindと別軸である。visibility / access controlもauthorityの代用品にしない。

- **DOM-SM-06 Rejected / Superseded ≠ Deleted**  
  後続理解へ影響した主要な棄却案、反証、置換済み成果物は参照可能に残す。棄却や置換を根拠の消去として実装しない。

- **DOM-SM-07 Decision ≠ Synthesis ≠ Execution**  
  統合された理解と、何を採るかというDecisionと、実際の外部Executionは別である。Decision Authorityは別途確認可能でなければならない。

- **DOM-SM-08 Traceability ≠ private chain-of-thought retention**  
  後から検証・再開・異議に必要な入力範囲、Evidence、actor、Provider / Method、派生関係、主要根拠・反証・代替案を保持する。一方、AI内部のtoken単位推論やprivate chain-of-thought全文を保存要件にしない。

- **DOM-SM-09 Current schema ≠ future semantic model**  
  現行`Card` / `Edge` / `EvidenceLink` / `Island` / `Narrative` / `ReviewAttribution`を、将来の意味成果物へ一対一で読み替えない。`DocumentV1`の意味はこの概念モデルだけを理由に変更しない。

---

## 4. Cluster と Island の違い

`Cluster` は、カード同士を「意味的に近いかもしれない」と仮に束ねる単位です。まだ確定した分類ではありません。

`Island` は、配置図の上でカードや関係を囲む視覚的な領域です。利用者が図として見ながら、まとまり、境界、未整理の余白を扱うために使います。

両者は一致する場合がありますが、同義ではありません。例えば、ひとつの `Island` の中に複数の `Cluster` がある場合や、まだ `Cluster` と呼べない保留カード群を `Island` として囲む場合があります。

### 4.1 代表視覚手掛かり

代表視覚手掛かりは、島や情報集合の内容を思い出し、見つけ直すための補助です。表札、要約、カード本文、出典、根拠、レビュー状態の代わりにはなりません。画像に描かれた細部を、元情報に含まれる事実や合意済み解釈として扱ってはなりません。

利用者は画像なしを選べます。絵文字、同梱素材、外部素材、生成画像のいずれも、候補の確認と人間による採用を必要とし、自動で島の意味や状態を変更しません。詳細要件は `00_Prompt/representative_visual_cue_requirements.md` を正本とします。

標準KJ法で表札・ラベルの束に付ける手描きのシンボルマークは、代表視覚手掛かりの先行形態とみなせます。一方、島どり線・関係線は構造を表す記号であり、代表視覚手掛かりではありません。写真・図・スケッチ自体が観察データや根拠である場合は一次視覚資料であり、その縮小表示を手掛かりとして使っても元資料と出典を失いません。

---

## 5. Graph 責務境界

本節は責務の境界を定めます。**概念として定義済みであることと、型として実装済みであることは別です。**
実装状況を併記します（§3 の「（計画中）」と同じ記法）。

- `WorkingGraph`（**計画中**）は、探索中の配置、Observation、Hypothesis、Structure、未確定の関係を保持します。
  将来は人間とAIそれぞれの作業面、またはAIが複数段階の探索を行う **AI Workspace** の論理的な保持先として利用できるようにします。
  「主体ごと」に分かれるのは複数主体運用が成立した後であり、現時点の実装は単一主体を前提とします
  （複数主体は `02_Architecture/post-mvp-business-scope-design-program.html` 第3反復の範囲）。
  AI WorkspaceはAccepted / Consensusと同義ではなく、内部で複数段階の仮説形成や棄却を行っても、そのことだけでは人間承認済み状態へ昇格しません。
- `ContextProjectionGraph`（**実装済み**）は、問い合わせ目的に合わせて読み取り専用で作る投影です。永続的な正本ではありません。
- `Consensus Graph`（**計画中**）は、`patch + approval` 済みの差分だけを保持します。
- `Core Graph` は旧称です。履歴説明以外では契約語彙として再導入しません。

---

## 6. Critique（違和感）についての厳密定義

> **違和感は本書の3箇所に現れます。競合する定義ではなく、層が異なります。**
>
> | 箇所 | 役割 |
> | --- | --- |
> | §2 `DOM-CORE-02` | **不変条件**。なぜ理由を要求しないのか |
> | §3 の表 | **語彙対応**。概念「違和感」がコード上 `Critique` であること |
> | §6（本節） | **詳細仕様**。どの種別を持ち、どう扱うか |
>
> 矛盾が生じた場合は **§2 が上位** です。

### Critique とは

- ユーザーによる **否定・拒否・留保の表明**
- 理由を要求しない根拠は `DOM-CORE-02` に定める。本節では繰り返しません。

### Critique の種類

次の5種は固定語彙です（実装の `CRITIQUE_TAGS` と一致します）。**増減には本書の改訂を要します。**

- **DOM-CRIT-01** 近すぎる（Too Close / `too_close`）
- **DOM-CRIT-02** 遠すぎる（Too Far / `too_far`）
- **DOM-CRIT-03** 同じではない（Not The Same / `not_the_same`）
- **DOM-CRIT-04** ここに違和感（Something Feels Off / `feels_off`）
- **DOM-CRIT-05** 理由は言語化できない（No Articulable Reason / `no_articulable_reason`）

**`DOM-CRIT-05` は他の4種の代替ではなく、独立した正当な入力です。** 種別を選べないことを
理由に入力を拒んではなりません（`DOM-CORE-02`）。

### Critique の扱い

- **DOM-CRIT-06** データとして保存する
- **DOM-CRIT-07** 学習や精度向上ではなく、**制約条件として再配置に反映** する

---

## 7. AI（LLM・その他の人工認知系）の役割定義（ドメイン観点）

> §2 の `DOM-CORE-*` はAIにも適用される。本節はそれに**追加**される、AI固有の規定である。
> **AI内部の探索権限と、人間承認済みの意味へ昇格する権限を分ける。**
> 現行runtimeのSafeMode・proposal-only・`human_reviewed`境界は維持するが、
> proposal-onlyを「AIは一段階の候補しか生成できない」という意味には解釈しない（ADR-0084）。

AI は以下を **行ってよい**：

- **DOM-AIOK-01** カード分割・要約の候補提示
- **DOM-AIOK-02** カード本文の意味を保った分割、文脈補足、出典追加、認識上の位置づけの候補提示
- **DOM-AIOK-03** 複数のクラスタ案・配置案の生成
- **DOM-AIOK-04** 制約を反映した再提案
- **DOM-AIOK-05** `WorkingGraph` 上の候補や `ContextProjectionGraph` のプレビュー生成
- **DOM-AIOK-06** 島または利用者が選んだ情報集合に対する、代表視覚手掛かりの候補提示
- **DOM-AIOK-07** AI Workspace / WorkingGraph内で、Observation → Relation → Hypothesis → Structure → Synthesisの複数段階を自律的に探索し、別解生成・反証・棄却・再探索を行う
- **DOM-AIOK-08** KJ法に着想を得た手順以外の認知方法を用い、異なる認知器・モデル・決定論的処理の結果を並存させる
- **DOM-AIOK-09** 自身の途中生成物を次の探索入力として利用する。ただし元Evidence、生成主体、来歴、未確定状態を失わない

AI は以下を **行ってはならない**：

- **DOM-AI-01** AI Workspace内の作業仮説を、共有・承認面で単一の正解として断定する
- **DOM-AI-02** 違和感を無視・正当化する（`DOM-CORE-02`）
- **DOM-AI-03** 人間または別主体が保持している保留状態を、権限なく解消する（`DOM-CORE-01`）
- **DOM-AI-04** `Consensus Graph` を直接更新する
- **DOM-AI-05** `human_reviewed` を自動付与する
- **DOM-AI-06** 人間承認を要する共有・Accepted・Consensus状態へ、AI生成物を人間の明示操作なしに昇格する
- **DOM-AI-07** カード品質を点数・順位・合否で評価する（`DOM-CORE-04` のAI経路での現れ。**非AI経路にも `DOM-CORE-04` が適用される**）
- **DOM-AI-08** 出典、話者、日時、因果関係、語り手の意図を推測してEvidenceへ補う
- **DOM-AI-09** 少数意見や矛盾をノイズとして自動削除する
- **DOM-AI-10** 代表視覚手掛かりを自動採用し、画像だけで意味・分類・根拠を確定する
- **DOM-AI-11** AIによる検査・推論・採択を、人間が理解・レビュー・承認したものとして記録する

---

## 8. 共有・要約・説明に関する注意

- **DOM-SHARE-01** 本アプリケーション内部の構造は **未確定・仮説的** であることを明示する
- 利用者が要約や資料として共有する内容では、次を必ず含める。
- **DOM-SHARE-02** 共有内容に**保留点**を含める
- **DOM-SHARE-03** 共有内容に**対立・分岐点**を含める
- **DOM-SHARE-04** 共有内容に**未測定・未評価項目**を含める

**これらを担保する責務は共有・書き出し経路の実装側にある。** 利用者の記憶や善意に依存させません。
含められない場合は、共有を止めるか、欠落していることを明示します。

---

## 9. 変更ルール

- 本ファイルの変更は **思想変更に相当** します
- 変更時は必ず理由と影響範囲を明記してください
- 実装側が DOMAIN 定義に合わせて修正されるべきであり、
  DOMAIN を実装都合で変えてはなりません

---

## 10. 変更記録

§9 に従い、思想に関わる変更の理由と影響範囲を記録する。

### 2026-09-18 sensemakingライフサイクルとAI権限境界の分離

ADR-0084に基づき、SUIの長期射程を人間主導のKJ法キャンバスだけに固定せず、
AI Workspaceでの自律的なObservation / Hypothesis / Structure / Synthesis形成を許容する方向へ拡張した。
一方、`human_reviewed`、Accepted / Consensus、元Evidenceの改変は別の権限操作として分離し、
現行runtimeのSafeMode・proposal-only運用は変更していない。

この変更は「AIが人間承認なしに確定できる」という規範変更ではなく、
**AI内部の探索を逐次承認させる必要はないことと、人間承認済み状態への昇格を同一視しない**
ための境界整理である。

### 2026-08-15 識別子の付与と `DOM-CORE-04` の追加

**識別子の付与**（`DOC-NORM-01`）。理由: 本書への参照64件のうち約50件がファイル名だけの裸参照で、
規範を名指しできなかった。行番号参照も3件発生していた。影響範囲: 参照方法のみ。**既存の散文の意味は変えていない。**

**`DOM-CORE-04` 非序列化の追加**。これは新しい規範ではなく、**置き場所の是正**である。

- 採点の禁止は従来 §7（AIの役割）にのみ存在した。しかし `02_Architecture/design/ui_design_handoff.md`
  は「単一正解、ランキング、採点、準備度スコアで結論を誘導しない」を**AIに限定せず**掲げており、
  規範の実際の適用範囲は当初からAIより広かった。
- 置き場所が §7 だけだったため、**非AI経路が素通りした**。`DOMAIN-SCORING-SURFACE-01` のとおり、
  クライアント側の決定論的計算による「健全性 N%」が利用者の図解に出荷されていた。AI経路と
  書き出し境界では `score` / `rank` の混入を検査していたのに、画面には検査が無かった。
- したがって §2 へ主体を問わない不変条件として明記し、§7 の `DOM-AI-07` はその**AI経路での現れ**
  として位置づけ直した。影響範囲: 画面・書き出し・AI の全経路。**規範の内容は変えていない。**

### 2026-08-15 三箇所の整合（層の明示）

内容精査で「違和感が3箇所に定義されている」「保留の下位区分が憲法に無い」
「`WorkingGraph` の『主体ごと』に複数主体の定義が無い」の3点が判明した。実装を確認した結果、
**いずれも定義の競合ではなく、層または実装状況が明示されていないことによる**と判断した。

- **違和感**: §6 の5種別は実装の `CRITIQUE_TAGS` と完全に一致していた。§2＝不変条件、§3＝語彙対応、
  §6＝詳細仕様という層を明示し、§6 が §2 を繰り返していた部分を参照へ置き換えた。`DOM-CRIT-*` を付与。
- **保留**: 実装には `HoldState = held | pending | shelved` があるのに憲法が沈黙し、§3 の表は
  `pending` と `shelved` を無関係な2行に割っていた。3値を `DOM-CORE-01` へ明記し、表を状態と記録の
  区別へ是正した。**新しい概念は導入していない。実装に既にあるものを憲法へ写した。**
- **WorkingGraph**: 型として未実装であり、`ContextProjectionGraph` のみ実装済みである事実を確認した。
  §3 の表が既に用いる「（計画中）」の記法に揃えて実装状況を併記し、「主体ごと」が複数主体運用の
  成立後の話であることを明示した。**概念は削っていない。**

影響範囲: 語彙と参照のみ。**規範の内容は変えていない。**

---

## 11. 最後に

本アプリケーションは、

> **意味を一度で確定させるためのツールではなく、
> 人間とAIが意味を形成し、揺らぎや反証を残したまま成熟させるための基盤**

です。

現在は人間がレビュー・承認の中心を担いますが、将来AIがより広いsensemaking区間を担っても、
Evidence・来歴・保留・権限境界を失わず、人間が必要な粒度で理解し直せることを目指します。

domain.md は、その揺れの範囲と前提を定めるための、
最も重要な文書です。

