# SUI Sensemaking Semantic Model

- Status: **Normative conceptual baseline / L0 Planned**
- Date: 2026-09-18
- Related ADR: `ADR-0084`, `ADR-0085`, `ADR-0086`
- Detailed contract: `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- Runtime impact: **None in this change**
- Schema impact: **None in this change**
- Current persistence contract: `DocumentV1` remains unchanged

## 1. この文書の役割

この文書は、SUI Sensemakingが将来扱う意味成果物を、現在のCard / Edge / Island等のUI・永続型へ直接固定せずに整理するための概念モデルである。

目的は、AI Workspaceで複数段階のsensemakingを行えるようにしながら、次を失わないことである。

- 元資料と派生解釈の区別
- 生成主体と承認主体の区別
- 反証・保留・棄却した主要代替案
- 人間・AI・異種認知Providerの来歴
- Working / Accepted / Consensusの権限境界
- 既存`DocumentV1`の互換性

本書に型名が登場しても、それは現時点のruntime schemaやAPIを意味しない。実装へ降ろす場合は、support level、migration、CRUD、SafeMode、retentionを別途決める。

## 2. モデルの基本原則

### 2.1 意味種別は状態ではない

次は成熟度の段階ではなく、意味の異なる成果物である。

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

ObservationをHypothesisへ型変更したり、HypothesisをSynthesisへ上書きしたりしない。

新しい理解が生まれたときは、新しい成果物を作り、元の成果物へ参照を張る。

### 2.2 「何であるか」と「どの状態か」を分離する

一つの成果物には、少なくとも次の軸が直交する。

| 軸 | 問うこと | 例 |
|---|---|---|
| Semantic kind | これは何か | Observation / Hypothesis / Synthesis |
| Provenance | 誰が・何から作ったか | human / AI / provider / source refs |
| Review | 誰がどのrevisionを検査したか | human review / AI review / challenge |
| Authority | どのscopeで採用されたか | Working / Candidate / Accepted / Consensus |
| Lifecycle | 現在どう扱うか | active / held / rejected / superseded / archived |
| Visibility / Access | 誰が見られるか | 既存visibility / ACL policyに従う |

これらを一つの`status`へ畳み込まない。

### 2.3 AcceptedはTruthではない

Accepted / Consensusは、そのscopeで採用されたという運用上・社会上の状態である。

```text
Accepted != True
Consensus != True
Public != Accepted
Reviewed != Accepted
```

後からEvidenceが増えれば、AcceptedなHypothesisやSynthesisをsupersedeしてよい。過去にAcceptedだった事実は履歴として残す。

### 2.4 traceabilityは外在化成果を対象にする

SUIはAIのprivate chain-of-thoughtやhidden stateを保存しない。

保持するのは、別の主体が検証・再開・異議を行うために必要な外在化情報である。

- 入力範囲
- source / Evidence refs
- actor / Provider / Method
- 生成成果物
- derived-from / grounded-by関係
- 主要根拠
- 主要反証
- 主要代替案
- 未解決点
- review / authority transition

## 3. 意味成果物

### 3.1 Evidence

**定義:** sensemakingの根拠として参照される資料・記録・証拠。

例:

- 利用者の元発言
- インタビュー記録
- 写真や図
- 文書の該当箇所
- 実測値
- 外部システムから取得した記録
- 出典不明であることを明示したメモ

EvidenceはTruthを意味しない。相反するEvidenceを同時に保持できる。

#### 必要な来歴

- source reference
- captured / imported time
- source actorが分かる場合の参照
- redaction / transformationがある場合の来歴
- exact sourceへ戻る手掛かり

AIが元資料を要約したものは、元Evidenceそのものではなく派生成果物として扱う。

### 3.2 Observation

**定義:** ある主体または認知Providerが、Evidenceや対象状態から「何を認識したか」を外在化した記録。

例:

- 「この3件では同じ例外処理が繰り返されている」
- 「このカード群では時間に関する表現が増えている」
- 「D2 associative channelが、このカードを追加確認候補として返した」

Observationは認識主体を持つ。

```text
same Evidence
  -> human Observation A
  -> AI Observation B
  -> deterministic detector Observation C
```

これらが一致する必要はない。不一致そのものが次のsensemaking材料になる。

### 3.3 Relation

**定義:** 二つ以上の意味成果物の間に置かれた意味的つながりの主張・記述。

Relationは、現在の`Edge`より広い概念である。

例:

- related-to
- contradicts
- supports
- derived-from
- depends-on
- precedes
- part-of
- alternative-to

将来の汎用Relation vocabularyを本書では固定しない。

Relation自体にも、

- creator
- grounding
- review
- lifecycle

があり得る。

### 3.4 Hypothesis

**定義:** Evidence / Observation / Relation等から形成された、反証可能な解釈。

HypothesisはFactとして扱わない。

最低限、次へ戻れることを目指す。

- 何から導いたか
- 何が支持するか
- 何が反証するか
- 何が未確認か
- どの代替Hypothesisがあるか
- 誰／どのProviderが生成したか

棄却されたHypothesisも、後続の理解に重要なら残す。

### 3.5 Structure

**定義:** 複数の意味成果物を、membership、relation、順序、空間配置、因果、階層等で組み合わせた構造。

具体的なProjectionには、たとえば次がある。

- Island
- Cluster
- Graph
- causal map
- temporal sequence
- layered map
- alternative structure set

Structureは一つの「正しい図」である必要はない。同じEvidence集合に対して複数Structureを併置できる。

### 3.6 Synthesis

**定義:** 複数のHypothesis / Structure / Relation / Observationを統合して外在化した理解。

Synthesisは次を含めてよい。

- 現時点の理解
- 主要根拠
- 主要反証
- 競合する見方
- 未解決点
- 適用scope
- どのStructureを統合したか

文章、要約、図解、機械可読bundle等の複数Projectionを持ち得る。

SynthesisはDecisionではない。

### 3.7 Review

**定義:** 特定の成果物revisionに対し、ある主体が検査・理解・異議・確認を行った記録。

Reviewでは、少なくとも概念上次を区別する。

- reviewer actor
- human / AI / other method
- exact target revision
- review purpose
- objections / holds
- review result
- timestamp

Reviewは成果物の内容を上書きしない。

AIがReviewしたことを`human_reviewed`として記録してはならない。

### 3.8 Decision

**定義:** sensemaking結果を踏まえて、あるauthorityのもとで何を採るか／何をするかを選択した記録。

Decisionは、Evidence、Hypothesis、Synthesisの真偽を証明しない。

例:

- 追加調査を行う
- 現時点ではHypothesis Aを作業前提として採用する
- Structure Bを共有版として使う
- この論点を保留する
- 外部Actionへ進む

Decisionには、必要に応じてauthority / responsibility / scope / rationale / basis refsを持たせる。

## 4. 関係の基本形

将来のconceptual relationとして、少なくとも次の役割を区別できることを目指す。

| Relation role | 意味 |
|---|---|
| `derivedFrom` | 別成果物から派生した |
| `groundedBy` | 根拠として参照する |
| `supports` | 対象を支持する |
| `contradicts` | 対象を反証・矛盾させる |
| `alternativeTo` | 代替案・競合案である |
| `synthesizes` | 複数成果物を統合した |
| `reviews` | Reviewの対象である |
| `basisFor` | Decision等の根拠になった |
| `supersedes` | 新成果物が旧成果物を置換する |

これは将来schemaのenumを確定する表ではない。

既存`Edge.type`や`EvidenceLink.type`へこの語彙を追加することも、本書からは導かない。

## 5. RevisionとIdentity

### 5.1 logical identityとrevision identityを分ける

同じHypothesisの文言を修正した場合、

- 「同じ論点の改訂」として扱うlogical identity
- 「どの時点の内容をReviewしたか」を示すexact revision identity

の両方が必要になる。

具体的なID形式は未決だが、Review / Authority transition / Decisionは**対象revisionを特定可能**でなければならない。

### 5.2 kind変更はrevisionではなく新artifact

次は同一artifactのrevisionとして扱わない。

```text
Observation -> Hypothesis
Hypothesis -> Synthesis
Synthesis -> Decision
```

意味種別が変わる場合は新artifactとし、来歴relationで接続する。

これは元の認知段階を残すための不変条件である。

## 6. Authority model

### 6.1 Working

AI Workspaceまたは人間の作業面で生成された状態。

- 正式な共有意味ではない
- 自由に代替案を生成してよい
- 棄却・再探索してよい
- provenanceは必要

### 6.2 Candidate

Reviewや採用判断の対象として提示された状態。

Candidate化は内容の真偽を保証しない。

### 6.3 Accepted

明示されたscopeとauthorityのもとで採用された状態。

Acceptedには最低限、

- who / policy
- target revision
- scope
- time

を後から辿れる必要がある。

### 6.4 Consensus

定義された参加者集合・手続きのもとで共有採用された状態。

単に「複数Reviewが一致した」だけではConsensusにしない。

具体的なConsensus形成policyは本書では固定しない。

## 7. Lifecycle model

意味成果物は、authorityとは別に次のようなlifecycleを持ち得る。

```text
active
held
rejected
superseded
archived
```

重要な原則は、`rejected`や`superseded`を削除と同一視しないことである。

特にAIが大量の候補を扱う場合、すべての微細な内部試行を永続化する必要はないが、後続理解に影響した主要代替案、強い反証、採択直前まで競合した案は参照可能に残す。

「主要」の選定policyは別Issueで検証する。

## 8. Multi-cognition coexistence

SUIは、異なる認知channelを一つのconfidence scoreへ統合することを要求しない。

例:

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

o1 / o2 / o3が一致しなくてもよい。

Provider内部scoreをSUIのTruth / Importanceへ変換せず、各成果物のprovenanceと関係を保持する。

既存`associative_cognition_provider_contract.md`のD0 / D1 / D2並存原則と整合する。

## 9. Review Capsule

Review Capsuleはcanonical artifactではなく、Review Surface向けの再構築可能Projectionである。

### 9.1 最小内容候補

- target artifact refs / revisions
- 現在のSynthesis
- 主要Evidence
- 主要Observation
- 強いcontradiction
- 主要alternative Hypothesis / Structure
- unresolved / held items
- actor / Provider / Method provenance
- authority action requested
- source revision / generated-at

### 9.2 禁止

- AI内部chain-of-thought全文をReview Capsuleとして保存する
- 反証や代替案を省略して「分かりやすい一結論」だけにする
- AI生成Capsuleを人間Review記録として扱う
- Capsule本文だけをcanonical sourceにする

## 10. 現行DocumentV1との対応

本節は移行mappingではなく、誤読防止のための対応関係である。

| Current `DocumentV1` | Conceptual model |
|---|---|
| `Card.text` | Evidence / Observation / Hypothesis等を表現し得る |
| `Card.claimType` | epistemic hint。semantic artifact kindの完全な代替ではない |
| `Edge` | Canvas Structure上のRelation表現 |
| `EvidenceLink` | supports / contradicts関係。Evidence artifactではない |
| `Island` / `Cluster` | StructureのCanvas Projection |
| `RelationSummary` | Relation / Structureの説明Projection |
| `Narrative` | Synthesisの文章Projectionになり得る |
| `ReviewAttribution` | 現行Document単位review metadata |
| `CritiqueInput` | Review / objectionの入力になり得るが、汎用Review artifactではない |
| `WorkingGraph` | Working authority surface |
| `ConsensusGraph` | Accepted / Consensusを扱うsurface |

### 10.1 非主張

本書は次を主張しない。

- `DocumentV1`へ8種の配列を追加する
- `claimType`を削除する
- `EvidenceLink`を汎用Relationへ置換する
- `Narrative`をSynthesis型へrenameする
- `ReviewAttribution`をReview logへ自動migrationする
- `ConsensusGraph`を新しいDB tableへ変更する

これらは全て別のschema / migration判断である。

## 11. 将来schemaへ降ろす際の最小不変条件

将来の永続型は、具体形式にかかわらず次を満たす必要がある。

1. semantic kindを後から別kindへin-place変更しない。
2. artifactのlogical identityとtarget revisionを区別できる。
3. actor / Provider / Method / source refsを追跡できる。
4. derived artifactから元Evidenceへ戻れる。
5. ReviewとAccepted / Consensusを区別できる。
6. human ReviewとAI Reviewを区別できる。
7. lifecycleとauthorityを別に保持できる。
8. rejected / supersededな主要成果物を参照可能に残せる。
9. visibility / ACLをauthorityの代用品にしない。
10. private chain-of-thoughtを保存要件にしない。
11. SafeModeで許可されない内容をReview CapsuleやAI Workspace経由で漏らさない。
12. `SUI_LLM_PROVIDER=none`でもHuman-ledな主要操作が成立する。

## 12. Identity / Review / Authority contract

ADR-0086により、意味成果物を将来永続化するときのidentityとevent境界を次で固定する。

```text
artifactId
  = logical identity

revisionId
  = exact immutable revision identity

contentDigest
  = integrity cross-check only
```

Review / Authority transition / Decisionはexact revisionを参照し、新revisionへ自動継承しない。

Reviewはappend-only record、Authorityはappend-only transition eventとして扱う。ConsensusはReview件数から自動導出しない。

Review Capsuleは、

1. canonical ref集合から再構築するStructural Capsule
2. それを説明する任意のNarrative Explanation

へ分ける。Narrativeを正本にしない。

AI内部の全trialは保存せず、Candidate化、Review対象、Decision basis、主要alternative、強いcontradiction、pin等の条件を満たす外在化成果物をretention保護候補とする。

詳細contractは `sensemaking_artifact_contract_v1alpha1.md` を参照する。

## 12. 次の設計課題

実装へ進む前に、少なくとも次を別Issueで詰める。

ADR-0086 / v1alpha1で、logical artifact ID / exact revision ID、minimal provenance envelope、Review record、Authority transition、Review Capsule、主要代替案のretention条件、DocumentV1 / InquiryJourneyV1へのreference bridgeまでは設計基線化した。

引き続き未決なのは次である。

- kind-specific semantic payload schema
- generic relation vocabularyの最終closed/open boundary
- Authority Scopeの具体型
- multi-user Consensus participant snapshot / policy
- physical DB schema / index / Content Store共用可否
- artifact-level import / export bundle
- Review CapsuleのUI表現
- representative fixture / concurrency / GCによるpromotion gate検証

この順序を飛ばして`DocumentV1`へfieldを追加しない。
