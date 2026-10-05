# SUI Sensemaking Semantic Model

- 状態: **規範的な概念の基準 / L0 計画中**
- 日付: 2026-09-18
- 関連ADR: `ADR-0084`, `ADR-0085`, `ADR-0086`
- 詳細な契約: `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- ランタイムへの影響: **この変更ではなし**
- スキーマへの影響: **この変更ではなし**
- 現行の永続化契約: `DocumentV1` は変更しない

## 1. この文書の役割

この文書は、SUI Sensemakingが将来扱う意味成果物を整理する概念モデルです。現在のCard、Edge、IslandなどのUIや永続型へは、直接固定しません。

目的は、AI Workspaceで複数段階のsensemakingを行えるようにしながら、次の点を失わないことです。

- 元資料と派生した解釈の区別
- 生成した主体と承認した主体の区別
- 反証、保留、棄却した主要な代替案
- 人間、AI、異種の認知プロバイダの来歴
- Working、Accepted、Consensusの権限の境界
- 既存の `DocumentV1` の互換性

この文書に型名が登場しても、現時点のランタイムスキーマやAPIを意味しません。実装へ降ろすときは、サポートレベル、マイグレーション、CRUD、SafeMode、保持を別に決めます。

## 2. モデルの基本原則

### 2.1 意味の種別は状態ではない

次は成熟度の段階ではなく、意味の異なる成果物です。

```text
Evidence
Observation
Relation
Hypothesis
Structure
Synthesis
Review
Decision
```

日本語では、根拠資料（Evidence）、観察（Observation）、関係（Relation）、仮説（Hypothesis）、構造（Structure）、統合（Synthesis）、レビュー（Review）、判断（Decision）と呼びます。以降は英語の概念名で書きます。

ObservationをHypothesisへ型変更したり、HypothesisをSynthesisへ上書きしたりしません。

新しい理解が生まれたときは、新しい成果物を作り、元の成果物へ参照を張ります。

### 2.2 「何であるか」と「どの状態か」を分離する

一つの成果物には、少なくとも次の軸が直交して存在します。

| 軸 | 問うこと | 例 |
|---|---|---|
| Semantic kind | これは何か | Observation / Hypothesis / Synthesis |
| 来歴（Provenance） | 誰が何から作ったか | human / AI / プロバイダ / 出典の参照 |
| Review | 誰がどのリビジョンを検査したか | human review / AI review / challenge |
| 採用上の位置づけ（Authority） | どのスコープで採用されたか | Working / Candidate / Accepted / Consensus |
| ライフサイクル（Lifecycle） | 現在どう扱うか | active / held / rejected / superseded / archived |
| 可視性とアクセス | 誰が見られるか | 既存の可視性とACLのポリシーに従う |

これらを一つの `status` へ畳み込みません。

### 2.3 AcceptedはTruthではない

AcceptedとConsensusは、そのスコープで採用されたという、運用上、社会上の状態です。

```text
Accepted != True
Consensus != True
Public != Accepted
Reviewed != Accepted
```

後からEvidenceが増えたときは、AcceptedのHypothesisやSynthesisを、新しい成果物で置き換えてよいものとします。過去にAcceptedだったという事実は、履歴として残します。

### 2.4 追跡できるのは外在化された成果だけ

SUIは、AIの非公開のchain-of-thoughtや隠れ状態を保存しません。

保持するのは、別の主体が検証、再開、異議を行うために必要な、外在化された情報です。

- 入力範囲
- 出典とEvidenceの参照
- actor、プロバイダ、Method
- 生成した成果物
- derived-fromとgrounded-byの関係
- 主要な根拠
- 主要な反証
- 主要な代替案
- 未解決の点
- Reviewとauthorityの遷移

## 3. 意味成果物

### 3.1 Evidence

**定義:** sensemakingの根拠として参照される資料、記録、証拠。

例は次のとおりです。

- 利用者の元の発言
- インタビュー記録
- 写真や図
- 文書の該当箇所
- 実測値
- 外部システムから取得した記録
- 出典が不明であることを明示したメモ

EvidenceはTruthを意味しません。相反するEvidenceを、同時に保持できます。

#### 必要な来歴

- 出典の参照
- 取得した時刻、またはimportした時刻
- 出典のactorが分かる場合は、その参照
- 墨消しや変換がある場合は、その来歴
- 厳密な出典へ戻るための手掛かり

AIが元資料を要約したものは、元のEvidenceそのものではなく、派生した成果物として扱います。

### 3.2 Observation

**定義:** ある主体または認知プロバイダが、Evidenceや対象の状態から「何を認識したか」を外在化した記録。

例は次のとおりです。

- 「この3件では、同じ例外処理が繰り返されている」
- 「このカード群では、時間に関する表現が増えている」
- 「D2の連想チャネルが、このカードを追加確認の候補として返した」

Observationは、認識した主体を持ちます。

```text
same Evidence
  -> human Observation A
  -> AI Observation B
  -> deterministic detector Observation C
```

これらが一致する必要はありません。不一致そのものが、次のsensemakingの材料になります。

### 3.3 Relation

**定義:** 二つ以上の意味成果物の間に置かれた、意味的なつながりの主張または記述。

Relationは、現在の `Edge` より広い概念です。

例は次のとおりです。

- related-to
- contradicts
- supports
- derived-from
- depends-on
- precedes
- part-of
- alternative-to

将来の汎用的なRelationの語彙は、この文書では固定しません。

Relation自体にも、次の項目があり得ます。

- 作成者
- 根拠づけ
- Review
- ライフサイクル

### 3.4 Hypothesis

**定義:** Evidence、Observation、Relationなどから形成された、反証できる解釈。

HypothesisをFactとしては扱いません。

最低限、次の点へ戻れることを目指します。

- 何から導いたか
- 何が支持するか
- 何が反証するか
- 何が未確認か
- どの代替Hypothesisがあるか
- 誰またはどのプロバイダが生成したか

棄却されたHypothesisも、後続の理解にとって重要なら残します。

### 3.5 Structure

**定義:** 複数の意味成果物を、所属、関係、順序、空間配置、因果、階層などで組み合わせた構造。

具体的な投影には、たとえば次があります。

- Island
- Cluster
- Graph
- 因果マップ
- 時系列
- 階層マップ
- 代替構造の集合

Structureは、一つの「正しい図」である必要はありません。同じEvidence集合に対して、複数のStructureを並べて置けます。

### 3.6 Synthesis

**定義:** 複数のHypothesis、Structure、Relation、Observationを統合して、外在化した理解。

Synthesisには、次を含めてよいものとします。

- 現時点の理解
- 主要な根拠
- 主要な反証
- 競合する見方
- 未解決の点
- 適用するスコープ
- どのStructureを統合したか

文章、要約、図解、機械可読なバンドルなど、複数の投影を持ち得ます。

SynthesisはDecisionではありません。

### 3.7 Review

**定義:** 特定の成果物リビジョンに対し、ある主体が検査、理解、異議、確認を行った記録。

Reviewでは、少なくとも概念上、次を区別します。

- レビューを行ったactor
- human、AI、その他のmethodの別
- 厳密な対象リビジョン
- レビューの目的
- 異議と保留
- レビューの結果
- タイムスタンプ

Reviewは、成果物の内容を上書きしません。

AIがレビューしたことを、`human_reviewed` として記録してはいけません。

### 3.8 Decision

**定義:** sensemakingの結果を踏まえて、あるAuthorityのもとで何を採るか、何をするかを選択した記録。

Decisionは、Evidence、Hypothesis、Synthesisの真偽を証明しません。

例は次のとおりです。

- 追加調査を行う
- 現時点ではHypothesis Aを作業の前提として採用する
- Structure Bを共有版として使う
- この論点を保留する
- 外部のActionへ進む

Decisionには、必要に応じて、Authority、責任、スコープ、理由、根拠の参照を持たせます。

## 4. 関係の基本形

将来の概念上のRelationとして、少なくとも次の役割を区別できることを目指します。

| Relationの役割 | 意味 |
|---|---|
| `derivedFrom` | 別の成果物から派生した |
| `groundedBy` | 根拠として参照する |
| `supports` | 対象を支持する |
| `contradicts` | 対象に反証する、または対象と矛盾する |
| `alternativeTo` | 代替案、または競合案である |
| `synthesizes` | 複数の成果物を統合した |
| `reviews` | Reviewの対象である |
| `basisFor` | Decisionなどの根拠になった |
| `supersedes` | 新しい成果物が古い成果物を置き換える |

これは、将来のスキーマの列挙を確定する表ではありません。

この語彙を既存の `Edge.type` や `EvidenceLink.type` へ追加することも、この文書からは導きません。

## 5. リビジョンとID

### 5.1 論理IDとリビジョンIDを分ける

同じHypothesisの文言を修正した場合、次の両方が必要になります。

- 「同じ論点の改訂」として扱うための論理ID
- 「どの時点の内容をReviewしたか」を示す、厳密なリビジョンID

具体的なIDの形式は未決です。ただし、Review、Authorityの遷移、Decisionは、**対象のリビジョンを特定できる**必要があります。

### 5.2 kindの変更はリビジョンではなく新しい成果物

次は、同じ成果物のリビジョンとして扱いません。

```text
Observation -> Hypothesis
Hypothesis -> Synthesis
Synthesis -> Decision
```

意味の種別が変わるときは新しい成果物とし、来歴の関係で接続します。

これは、元の認知の段階を残すための不変条件です。

## 6. Authorityモデル

### 6.1 Working

AI Workspaceまたは人間の作業面で生成された状態です。

- 正式に共有された意味ではない
- 自由に代替案を生成してよい
- 棄却や再探索をしてよい
- 来歴は必要

### 6.2 Candidate

Reviewや採用の判断の対象として提示された状態です。

Candidateにしても、内容の真偽は保証されません。

### 6.3 Accepted

明示されたスコープとAuthorityのもとで採用された状態です。

Acceptedについては、最低限、次の項目を後から辿れる必要があります。

- 誰が、またはどのポリシーが
- 対象のリビジョン
- スコープ
- 時刻

### 6.4 Consensus

定義された参加者集合と手続きのもとで、共有採用された状態です。

単に「複数のReviewが一致した」だけでは、Consensusにしません。

Consensusを形成する具体的なポリシーは、この文書では固定しません。

## 7. ライフサイクルモデル

意味成果物は、Authorityとは別に、次のようなライフサイクルを持ち得ます。

```text
active
held
rejected
superseded
archived
```

重要な原則は、`rejected` や `superseded` を、削除と同一視しないことです。

特にAIが大量の候補を扱うときは、細かい内部の試行をすべて永続化する必要はありません。ただし、後続の理解に影響した主要な代替案、強い反証、採択の直前まで競合した案は、参照できる形で残します。

「主要」の選定ポリシーは、別のIssueで検証します。

## 8. 複数の認知の共存

SUIは、異なる認知チャネルを一つのconfidenceスコアへ統合することを要求しません。

例は次のとおりです。

```text
D0 deterministic detector
  -> Observation o1

D1 lexical sparse
  -> Observation o2

D2 associative sparse
  -> Observation o3

LLM
  -> Hypothesis h1

Human
  -> Critique c1
```

o1、o2、o3は、一致しなくてかまいません。

プロバイダ内部のスコアを、SUIのTruthやImportanceへ変換しません。各成果物の来歴と関係を保持します。

既存の `associative_cognition_provider_contract.md` にある、D0、D1、D2を並存させる原則と整合します。

## 9. Review Capsule

Review Capsuleは基準となる成果物ではなく、Review Surface向けに再構築できる投影です。

### 9.1 最小内容の候補

- 対象となる成果物の参照とリビジョン
- 現在のSynthesis
- 主要なEvidence
- 主要なObservation
- 強い矛盾
- 主要な代替のHypothesisとStructure
- 未解決の項目と保留の項目
- actor、プロバイダ、Methodの来歴
- 求められているAuthorityの操作
- 入力元のリビジョンと生成日時

### 9.2 禁止事項

- AI内部のchain-of-thought全文を、Review Capsuleとして保存する
- 反証や代替案を省略して、「分かりやすい一つの結論」だけにする
- AIが生成したCapsuleを、人間のReview記録として扱う
- Capsuleの本文だけを、基準データにする

## 10. 現行のDocumentV1との対応

この節は移行のマッピングではなく、誤読を防ぐための対応関係です。

| 現行の `DocumentV1` | 概念モデル |
|---|---|
| `Card.text` | Evidence、Observation、Hypothesisなどを表現し得る |
| `Card.claimType` | 認識論上のヒント。semantic artifact kindの完全な代替ではない |
| `Edge` | Canvasの構造上のRelationの表現 |
| `EvidenceLink` | supportsとcontradictsの関係。Evidenceの成果物ではない |
| `Island` / `Cluster` | StructureのCanvas上の投影 |
| `RelationSummary` | RelationとStructureを説明する投影 |
| `Narrative` | Synthesisの文章による投影になり得る |
| `ReviewAttribution` | 現行のDocument単位のreviewメタデータ |
| `CritiqueInput` | Reviewや異議の入力になり得るが、汎用的なReview成果物ではない |
| `WorkingGraph` | Working Authorityの作業面 |
| `ConsensusGraph` | AcceptedとConsensusを扱う作業面 |

### 10.1 主張しないこと

この文書は、次のことを主張しません。

- `DocumentV1` へ8種類の配列を追加する
- `claimType` を削除する
- `EvidenceLink` を汎用的なRelationへ置き換える
- `Narrative` をSynthesis型へ改名する
- `ReviewAttribution` をReviewログへ自動的にマイグレーションする
- `ConsensusGraph` を新しいDBテーブルへ変更する

これらはすべて、別のスキーマとマイグレーションの判断です。

## 11. 将来のスキーマへ降ろすときの最小の不変条件

将来の永続型は、具体的な形式にかかわらず、次を満たす必要があります。

1. semantic kindを、後から別のkindへその場で変更しない。
2. 成果物の論理IDと、対象のリビジョンを区別できる。
3. actor、プロバイダ、Method、出典の参照を追跡できる。
4. 派生した成果物から、元のEvidenceへ戻れる。
5. ReviewとAccepted / Consensusを区別できる。
6. human ReviewとAI Reviewを区別できる。
7. ライフサイクルとAuthorityを別に保持できる。
8. rejectedやsupersededの主要な成果物を、参照できる形で残せる。
9. 可視性やACLを、Authorityの代用品にしない。
10. 非公開のchain-of-thoughtを、保存の要件にしない。
11. SafeModeで許可されない内容を、Review CapsuleやAI Workspace経由で漏らさない。
12. `SUI_LLM_PROVIDER=none` でも、人間が主導する主要な操作が成立する。

## 12. ID、Review、Authorityの契約

ADR-0086により、意味成果物を将来永続化するときの、IDとイベントの境界を次のように固定します。

```text
artifactId
  = logical identity

revisionId
  = exact immutable revision identity

contentDigest
  = integrity cross-check only
```

Review、Authorityの遷移、Decisionは、厳密なリビジョンを参照し、新しいリビジョンへ自動的に引き継ぎません。

Reviewは追記専用の記録、Authorityは追記専用の遷移イベントとして扱います。ConsensusはReviewの件数から自動的に導出しません。

Review Capsuleは、次の二つに分けます。

1. 基準となる参照集合から再構築する、Structural Capsule
2. それを説明する、任意のNarrative Explanation

Narrativeを唯一の記録にはしません。

AI内部のすべての試行は保存しません。Candidate化、Reviewの対象、Decisionの根拠、主要な代替案、強い矛盾、ピン留めなどの条件を満たす、外在化された成果物を、保持の保護候補とします。

詳細な契約は、`sensemaking_artifact_contract_v1alpha1.md` を参照してください。

## 12. 次の設計課題

実装へ進む前に、少なくとも次を、別のIssueで詰めます。

ADR-0086とv1alpha1で、次の項目までは設計の基準にしました。

- 論理的な成果物IDと、厳密なリビジョンID
- 最小限の来歴エンベロープ
- Review記録
- Authorityの遷移
- Review Capsule
- 主要な代替案の保持条件
- DocumentV1とInquiryJourneyV1への参照ブリッジ

引き続き未決なのは、次の項目です。

- kindごとの意味ペイロードのスキーマ
- 汎用的なRelationの語彙について、閉じる範囲と開く範囲の最終的な境界
- Authority Scopeの具体的な型
- 複数ユーザーのConsensusにおける、参加者スナップショットとポリシー
- 物理DBのスキーマとインデックス、Content Storeを共用できるか
- 成果物単位のimport/exportバンドル
- Review CapsuleのUI表現
- 代表的なフィクスチャ、並行性、GCによる昇格条件の検証

この順序を飛ばして、`DocumentV1` へフィールドを追加しません。
