# Sensemaking Artifact Persistence Candidate

- Status: **Design candidate / L0 Planned**
- Date: 2026-09-18
- Parent: `ADR-0088`
- Portable schema matrix: `02_Architecture/sensemaking_artifact_portable_schema_matrix.md`
- Runtime implementation: **None**
- Migration: **None**
- Purpose: portable schema / transaction / projection design before implementation issue

## 1. 前提

canonical sourceは次の三層へ分ける。

```text
RDB metadata / events
        │
        ├─ identity / revision
        ├─ provenance refs
        ├─ Review
        ├─ Authority Scope / transition
        ├─ Consensus participant snapshot
        └─ import / retention metadata
        │
        └──────────────┐
                       ▼
                 Content Store
                 semantic payload
                       │
                       ▼
            materialized read models
              Information Network
              relation adjacency
              current authority cache
```

materialized read modelは削除して再構築できる。

## 2. Canonical logical record classes

以下は**物理table名の確定ではない**。migration作成前の責務分割である。

### 2.1 Artifact identity

候補field:

```text
tenant_id
artifact_id
semantic_kind
created_at
created_by_actor_kind
created_by_actor_ref?
```

不変条件:

- `tenant_id + artifact_id` unique
- semantic kind immutable
- artifact row自体に本文を置かない
- latest revisionはcacheとして持てても正本にしない

### 2.2 Artifact revision

候補field:

```text
tenant_id
revision_id
artifact_id
payload_schema
payload_content_ref
payload_digest
lifecycle
actor_kind
actor_ref?
method_kind
method_ref?
run_ref?
input_scope_ref?
created_at
```

別record:

- revision parent edges
- input artifact revision refs
- source refs
- transformation refs

不変条件:

- `tenant_id + revision_id` unique
- `tenant_id + artifact_id + revision_id`整合
- semantic kindはartifact rowから取得しrevisionごとに変更しない
- payload digest / schema mismatchはfail closed
- parentは同一artifactだけ
- exact revision FK相当を保つ

### 2.3 Review record

候補field:

```text
tenant_id
review_id
target_artifact_id
target_revision_id
reviewer_kind
reviewer_ref
purpose
disposition
supersedes_review_id?
created_at
```

findingは、

- bounded code / ref metadata
- content object

のどちらかへ分離できる。

Review rowへAccepted / Consensus stateを入れない。

### 2.4 Authority Scope

候補field:

```text
tenant_id
scope_ref
scope_kind
container_ref
purpose_ref?
parent_scope_ref?
created_at
```

- immutable
- parent cycle禁止
- parentはauthority inheritanceを意味しない

### 2.5 Authority transition

候補field:

```text
tenant_id
event_id
target_artifact_id
target_revision_id
scope_ref
expected_from
to_state
authorized_by_kind
authorized_by_ref
policy_ref?
participant_set_ref?
created_at
```

別join/ref:

- basis review refs
- basis Decision revision refs

### 2.6 Consensus participant snapshot

header:

```text
tenant_id
participant_set_ref
scope_ref
membership_source_ref?
created_at
```

member:

```text
tenant_id
participant_set_ref
actor_ref
actor_kind
eligibility_role_ref?
```

snapshot作成後にmember更新を許可しない。

### 2.7 Imported source assertions

Exchange import時に、source Review / Authorityをlocal event storeへ直接入れない。

source assertionとして、

```text
tenant_id
import_session_id
source_network_ref
source_assertion_id
assertion_kind
source_scope_ref?
source_record_content_ref / bounded metadata
created_at
```

等で保持する候補とする。

local Authority reducerの入力にはしない。

### 2.8 Exchange import mapping

```text
tenant_id
import_session_id
source_network_ref
source_artifact_id
source_revision_id
local_artifact_id
local_revision_id
created_at
```

IDを保存したままresolveする実装ではmapping rowを省略できるが、cross-networkでID再発行する場合は必須。

### 2.9 Retention pin / protection

明示pinは独立recordとする。

Review / Authority / Decision / retained relation等からの参照はderived protection rootであり、pin tableへ複製しない。

---

## 3. Content Store payload

### 3.1 Payload boundary

Content Storeへ置くもの:

- Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Decision payload
- Review findingの長文が必要な場合の本文
- source assertionの安全なopaque payloadが必要な場合

RDB bounded columnへ置くもの:

- IDs
- enum / state
- digest
- schema ref
- actor/method opaque refs
- timestamps
- FK / joinに必要なrefs

### 3.2 Canonical JSON

semantic payloadはkind-specific schemaに従うcanonical JSON bytesとしてdigest可能にする。

既存canvas revision codecと同じcanonicalization primitiveを再利用できるかbenchmarkする。

再利用しても、

```text
CanvasRevision ID
  != SemanticArtifactRevision ID
```

である。

### 3.3 Blob dedup

同一tenant + digestのblob共有は可能。

ただし、

- artifact identity
- provenance
- authority
- review

はdedupしない。

---

## 4. Portable indexes

最低限の候補:

### Canonical identity

```text
UNIQUE (tenant_id, artifact_id)
UNIQUE (tenant_id, revision_id)
INDEX  (tenant_id, artifact_id, created_at)
INDEX  (tenant_id, semantic_kind, created_at)
```

### Review

```text
UNIQUE (tenant_id, review_id)
INDEX  (tenant_id, target_artifact_id, target_revision_id, created_at)
INDEX  (tenant_id, reviewer_ref, created_at)
```

### Authority

```text
UNIQUE (tenant_id, scope_ref)
UNIQUE (tenant_id, event_id)
INDEX  (tenant_id, target_artifact_id, target_revision_id, scope_ref, created_at)
INDEX  (tenant_id, scope_ref, created_at)
```

### Consensus participant

```text
UNIQUE (tenant_id, participant_set_ref, actor_ref)
INDEX  (tenant_id, scope_ref, created_at)
```

### Import

```text
INDEX (tenant_id, import_session_id)
UNIQUE (
  tenant_id,
  import_session_id,
  source_network_ref,
  source_artifact_id,
  source_revision_id
)
```

DB familyごとのindex byte上限を考慮し、opaque internal IDは既存bounded identifier catalogの範囲へ収める。

---

## 5. Derived / materialized records

### 5.1 Current authority cache

候補key:

```text
tenant_id
artifact_id
revision_id
scope_ref
```

value:

```text
current_state
last_event_id
updated_at
```

cacheはauthority event列から再構築可能。

Authority transition transactionではCAS targetとして利用できる。

### 5.2 Relation index

Relation artifact payloadをqueryごとにContent Storeから全件decodeしないため、derived indexを持てる。

候補:

```text
tenant_id
relation_artifact_id
relation_revision_id
predicate
participant_role
target_kind
target_ref
```

unknown extension predicateも文字列のまま往復保持する。

このindexはRelation artifact payloadの正本ではない。

### 5.3 Information Network projection

Information Network materializerは、

- artifact revision
- relation index
- provenance refs
- Review summaries
- authority state by requested scope
- hold / contradiction

等から`QualitativeNetworkSnapshot`を構築する。

全Authority Scopeを一つのnode statusへ圧縮しない。

---

## 6. Transaction boundaries

### 6.1 Create artifact

同一transaction候補:

1. artifact identity insert
2. payload Content Store metadata準備
3. artifact revision insert
4. parent / provenance ref insert
5. payload metadata ready確定
6. audit / outbox append

external Content Store利用時は既存coordinator / pending-ready state原則に従い、物理I/OとRDB transactionの不整合を補償する。

### 6.2 Add revision

1. artifact存在・kind確認
2. parent revision存在・same artifact確認
3. payload保存
4. new immutable revision append
5. provenance refs append
6. materializer outbox append

過去revisionをupdateしない。

### 6.3 Review

1. exact target revision存在確認
2. reviewer authority / permission確認
3. Review append
4. finding refs保存
5. materializer outbox append

ReviewだけでAuthority cacheを変更しない。

### 6.4 Authority transition

1. exact target revision存在確認
2. scope存在確認
3. effective authorization確認
4. current state lock / CAS
5. `expectedFrom`確認
6. policy / participant set / basis refs検証
7. transition append
8. current-state cache更新
9. audit / outbox append

stale stateは409相当でfail closed。

### 6.5 Exchange import

概念phase:

```text
staging parse
  -> structural validate
  -> closure validate
  -> SafeMode / permission validate
  -> collision validate
  -> source authority de-privilege
  -> payload prepare
  -> canonical metadata commit
  -> materialization
```

途中失敗でlocal Accepted / human reviewedだけが残る状態を禁止する。

---

## 7. Materialization strategy candidate

第一候補はtransactional outbox + idempotent materializer。

理由:

- canonical transactionとgraph/search更新を同期dual-writeしない
- graph / vector / sparse index障害でcanonical writeを失敗させない
- projectionを再構築できる
- EKI等へheavy rebuildを将来委譲しやすい

ただし、Authority current-state cacheだけはCAS correctnessに使うためcanonical transaction内のRDB derived stateとして扱える。

```text
canonical commit
   ├─ metadata/events
   ├─ authority cache
   └─ outbox
          │
          ▼
     materializer
          ├─ Information Network
          ├─ relation index
          ├─ search
          └─ optional graph/vector/sparse indexes
```

---

## 8. GC candidate

### 8.1 Mark roots

少なくとも:

- artifact current heads / retained revision policy
- Review targets
- Authority transition targets / basis
- Decision basis
- retained Relation refs
- participant/source assertion retention policy
- explicit pins
- governed checkpoints

### 8.2 Sweep

- rootから到達不能なWorking-only revisionsを候補化
- candidate列挙後、transaction内で保護条件を再確認
- revision metadata削除後もpayload blob参照数 / retention delayを確認
- external content delete失敗時はexisting Content Store state machineに従いretry

### 8.3 Projection

projection / cacheをGC rootにしない。

projectionからcanonical recordが参照されていることを理由に保持期間を延ばさない。

---

## 9. Database portability checklist

migration実装前にVerified DB familyすべてについて次を確認する。

- bounded identifier length
- composite tenant FK
- append-only event constraint
- authority state check
- lifecycle check
- nullable opaque refs
- timestamp canonical form
- payload LOB / Content Store roundtrip
- unique / index byte limits
- import staging transaction
- concurrent authority CAS
- backup / restore
- tenant guard / RLS（shared-schema対象のみ）

PostgreSQL固有のJSONB、recursive CTE、advisory lockをCore correctnessの唯一実装にしない。

---

## 10. Representative fixture

implementation issueでは最低限次を作る。

### Fixture A: human-led

- Evidence 20
- Observation 10
- Hypothesis 5
- Structure 2
- Synthesis 1
- Human Review 4
- Inquiry scope Accepted 1

### Fixture B: AI Workspace

- Evidence 50
- Observation 100
- Hypothesis 80
- Working-only microtrial多数
- Candidate 10
- Review target 6
- Accepted 2
- retained alternatives / contradictions

### Fixture C: multi-scope

同じrevision:

- workspace = Accepted
- inquiry = Accepted
- network = Candidate
- external = Working

### Fixture D: exchange

source:

- Accepted / Consensus
- human Review
- participant snapshot

import先:

- local Working
- source assertions preserved
- local human_reviewed = false
- explicit promotion後だけlocal Candidate / Accepted

### Fixture E: collision

同じsource ID:

- same digest / same provenance
- same ID / different digest
- same ID / different semantic kind

を検証する。

---

## 11. Implementation stop lines

次が発生したらmigrationを進めずADRへ戻す。

- `DocumentV1`の意味変更が必要
- ReviewとAuthorityを同じrowへ統合しないと実装できない
- imported source authorityをlocal current stateへ入れる必要がある
- graph DBをcanonical sourceにしないと成立しない
- Provider内部scoreを永続Truth / Importanceとして要求する
- private chain-of-thought保存が必須になる
- Verified DB familyの複数でportable constraintを表現できない

---

## 12. 次の実装前成果物

1. portable table sketch + FK matrix
2. Authority transition concurrency pseudo-test
3. exchange import staging pseudo-test
4. representative fixture JSON
5. Content Store payload benchmark
6. Information Network rebuild benchmark
7. retention reachability test plan

これらを確認後にだけmigration issueをReady for Implementationへ昇格する。
