# ADR-0088: semantic artifact persistenceはRDB metadata/event正本 + Content Store payload + materialized networkを第一候補とする

- Status: Accepted
- Date: 2026-09-18
- Deciders: Maintainer
- Scope: semantic artifact physical persistence candidate
- Related: `ADR-0066`, `ADR-0070`, `ADR-0071`, `ADR-0085`, `ADR-0086`, `ADR-0087`
- Runtime impact: None in this change
- Migration impact: None in this change

## Context

semantic artifact contractは、Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Decisionと、そのrevision、Review、Authority、Scope、Consensus participant、exchange historyを扱う。

physical persistenceには複数候補がある。

- RDBへすべて正規化
- JSON aggregate
- graph database
- object / content store中心
- RDB metadata + content-addressed payload + materialized graph

SUIにはすでに次の設計資産がある。

- Verified RDB familyとportable migration方針（ADR-0066）
- content objectをContent Storeの背後へ置く方針
- canvas revisionをopaque revision identity + content digest + blobへ分離する方針（ADR-0070）
- Document DB / derived projectionをcanonical sourceにしない方針（ADR-0071）
- SUI Information Network / QualitativeNetworkSnapshotをquery read modelとして扱う方針

semantic artifactだけをgraph DBのcanonical sourceにすると、tenant authorization、transaction、Review / Authority CAS、retention、import collision、portable DB supportを二重実装する。

一方、kind-specific payloadをRDB列へ完全分解すると、新しいsemantic kindやAI-native payload追加のたびにmigration負担が増える。

## Decision

### D1. 第一候補を「RDB metadata/event + Content Store payload」とする

canonical metadata / eventはVerified RDBへ置く。

kind-specific semantic payloadはcanonical JSON content objectとしてContent Store契約の背後へ置く。

```text
RDB canonical metadata/events
  ├─ artifact identity
  ├─ revision metadata
  ├─ provenance refs
  ├─ Review
  ├─ Authority Scope / transition
  ├─ participant snapshot
  ├─ import mapping / source assertions
  └─ retention roots
          │
          │ payload digest / content ref
          ▼
      Content Store
          │
          ▼
   semantic payload JSON
```

Content Storeの既定backendは既存方針どおりdatabase inlineを利用できる。NAS / S3等をsemantic artifact専用に必須化しない。

### D2. artifact identityとrevisionをRDBのbounded metadataとして保持する

logical record classを次のように分ける。

- SemanticArtifact
- SemanticArtifactRevision
- ReviewRecord
- AuthorityScope
- AuthorityTransition
- ConsensusParticipantSet
- SourceReviewAssertion
- SourceAuthorityAssertion
- ExchangeImportMapping
- RetentionPin

具体table名はimplementation issueで決めるが、責務を一つの巨大JSON aggregateへ統合しない。

### D3. semantic payload本文をrevision rowへ巨大JSONとして直接依存させない

Revisionはpayload content ref / digest / schema refを持つ方向とする。

```text
revisionId
semanticKind
payloadSchema
payloadDigest
payloadContentRef
parent refs
provenance refs
lifecycle
```

これにより、

- payload本文の大きさ
- DB familyごとのLOB
- 将来external Content Store
- dedup / codec
- SafeMode派生payload

をrevision identityから分離できる。

ただしContent Store上のblob dedupによってartifact logical identityを統合してはならない。

### D4. existing `content_blobs` / Content Storeの再利用を優先検討する

semantic artifact専用の第二Content Storeを作らない。

既存Content Storeが、

- tenant scoped metadata
- UTF-8 bytes
- byte size
- SHA-256
- schema version
- backend abstraction

を満たせる場合、同じport / blob contractを再利用する。

ただしcanvas revision payloadとsemantic payloadを同じlogical revision tableへ統合しない。

### D5. Relationもsemantic artifactとして正本化する

Relation専用edge tableをcanonical sourceにしない。

Relation artifactのpayloadはContent Storeへ置き、revision metadataをRDBで管理する。

query performance用に、

- predicate
- participant refs
- from/to相当
- network adjacency

をmaterialized index / projectionへ展開してよい。

projectionからRelation artifactを逆生成しない。

### D6. Information Network / graph storeはmaterialized read modelとする

graph DBをcanonical sourceにはしない。

必要なら、

- RDB projection tables
- in-memory graph
- graph DB
- search index

のいずれかへInformation Networkをmaterializeできる。

```text
canonical RDB + payload
       │
       ▼
materializer
       │
       ├─ RDB network projection
       ├─ graph DB projection
       └─ search / vector / sparse index
```

projectionが消えてもcanonical recordsから再構築可能でなければならない。

### D7. Authority current stateはcache可能だがevent列を正本とする

authority transitionはappend-onlyでRDBへ保存する。

performance用に、

```text
artifact revision + scope -> current authority state
```

のmaterialized cacheを持てる。

transition transactionでは、

1. current stateをlock / CAS確認
2. `expectedFrom`検証
3. event append
4. current-state cache更新

を同じtransactionで扱う方向とする。

cache破損時はevent列から再構築できる。

### D8. Reviewはappend-onlyでauthority transactionと分離する

Review appendとAuthority promotionを同じrecordにしない。

UI上で「Reviewして採用」を一操作に見せる場合でも、application serviceは、

1. Review append
2. Authority transition

を意味上別操作として実行する。

必要なら同じDB transactionへ含められるが、一方を他方から推論しない。

### D9. provenance relationはexact revision FK相当で検証する

artifact-to-artifact input / lineage refは、

- same tenant
- exact artifact revision存在
- semantic kind制約
- cycle制約（必要なrole）

をapplication / DB constraintで検証できる必要がある。

external source refは同じFKを要求しないが、source registryへ解決可能な場合はtenant / permission境界を確認する。

### D10. RDB portabilityを維持し、JSON演算へCore correctnessを依存させない

Verified DBすべてで成立することを前提に、

- identity
- FK
- unique
- lifecycle / authority state
- createdAt
- schema ref
- digest

等のCore correctnessはportable bounded columnsで表現する。

kind-specific payloadの内容検索やJSON path演算を、Review / Authority correctnessの必須条件にしない。

PostgreSQL固有JSONB / recursive query等はoptimizationとしてのみ利用する。

### D11. tenant / SaaS境界は既存DB policyを継承する

shared-schema SaaSでは、semantic artifact metadata / Review / Authority event / content metadataすべてにtenant guardを適用する。

PostgreSQL以外でshared-schema SaaS対応を新たに推論しない。

actor ref / source ref / import mappingからtenant越境を許可しない。

### D12. exchange importはstaging + validation + canonical commitとする

artifact exchange bundle importは、直接canonical tableへ逐次writeしない。

概念上、

```text
parse
  -> schema validate
  -> SafeMode / permission validate
  -> closure validate
  -> identity collision validate
  -> source authority de-privilege
  -> canonical commit
```

の順で扱う。

大規模bundleで単一transactionが不適切な場合でも、「一部だけlocal authorityへ入った」状態を作らないstaging contractを設ける。

### D13. backup/restoreはexchange import経路を流用しない

backup / disaster recoveryは、同じauthority domainを真正に復元する運用契約であり、source authorityをde-privilegeするexchangeとは意味が異なる。

同じAPI / mode flagで曖昧に切り替えない。

### D14. retention / GCはcanonical referencesをrootとする

semantic artifact GCは、少なくとも次をroot / protection inputとして扱う。

- current / historical Authority event
- Review target
- Decision basis
- retained Relation target
- participant / source assertion参照
- explicit pin
- governed checkpoint
- exchange import mappingの保持policy

payload blobはrevision参照がなくなっても、Content Store既存policyに従い保留期間・参照再確認後に削除する。

projection / Review Capsule cacheはretention rootにしない。

### D15. physical schema実装は別Issueへ分離する

本ADRはpersistence方式の第一候補を選ぶが、migrationを開始しない。

実装前に、

- portable schema draft
- representative fixture
- RDB family compile / constraint review
- payload roundtrip
- import staging
- authority CAS
- GC
- projection rebuild

を検証する専用implementation issueを起票する。

## Alternatives

| Candidate | 長所 | 主な問題 | 判断 |
|---|---|---|---|
| giant JSON aggregate | 初期実装が容易 | exact revision FK / concurrent authority / partial query / GCが弱い | 不採用 |
| fully normalized payload columns | 強いconstraint | semantic kind追加ごとにmigration、自由度低下 | payload正本として不採用 |
| graph DB canonical | Relation queryに強い | tenant / transaction / portability / authority eventを二重化 | 不採用 |
| object store canonical | contentに強い | Review / Authority CAS / FK / query metadataに弱い | 不採用 |
| **RDB metadata/event + Content Store payload** | 既存portability、transaction、柔軟payloadを両立 | materializer / blob lifecycleが必要 | **第一候補** |

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| **業務設計** | exact revision Review、scope authority、exchange de-privilegeをtransactionalに守る | データ: Review / Authority / import mappingを独立record化。機能: partial importやstale promotionをfail closed |
| **データ設計** | RDB metadata/event + Content Store payloadを正本としgraph/networkはprojectionにする | 業務: payload自由度を保ちつつauthority correctnessはRDB column/constraintで守る。機能: projection rebuild可能 |
| **機能設計** | import staging、authority CAS、materializer、GCをcanonical references中心に実装する | 業務: backupとexchangeを混同しない。データ: cache / graph storeを正本にしない |

## Consequences

### Positive

- 既存DB portabilityとContent Store投資を再利用できる。
- semantic kind追加でDB migrationを最小化できる。
- Authority / Reviewはportable transactionで守れる。
- graph / sparse / vector等のquery技術を正本から切り離せる。
- 将来EKI等でmaterializationを分散実行してもcanonical semanticsは変わらない。

### Costs / Open questions

- concrete table / index shapeは未確定。
- payload Content Storeのcodec共有にbenchmarkが必要。
- Relation projectionの更新方式（sync / outbox）は未決。
- large bundle staging方式は未決。
- portable recursive reachability / GC実装方式は検証が必要。

## Non-goals

- 本ADRだけでmigrationを追加しない。
- graph DBを禁止しない。canonical sourceとして採らないだけである。
- Content Store external backendを必須化しない。
- PostgreSQL固有機能を全DBへ強制しない。
- current state cacheを正本化しない。
- exchangeとbackupを同じmode flagにしない。

## Traceability

- `02_Architecture/database_portability.md`
- `01_Plans/adr/ADR-0070-content-addressed-generation-dag-and-git-adapter.md`
- `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- `02_Architecture/sensemaking_payload_authority_exchange_v1alpha1.md`
- `02_Architecture/information_network_projection_contract.md`
