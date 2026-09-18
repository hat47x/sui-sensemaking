# Sensemaking Artifact Portable Schema / Constraint Matrix

- Status: **Design candidate / SENSEMAKING-PERSIST-01**
- Date: 2026-09-18
- Parent: `ADR-0088`, `sensemaking_artifact_persistence_candidate.md`
- Migration: **Not started**
- Goal: Verified DB familyへ落とせるlogical schemaと、DB / applicationのconstraint責務を分離する

## 1. 方針

physical migrationの前に、各invariantを次の3種へ分類する。

1. **DB-enforced**
   - PK / unique / FK / check等、Verified DB familyでportableに守れるもの
2. **Transaction-enforced**
   - current state CAS、複数recordの整合等、application transactionで守るもの
3. **Validation-enforced**
   - cycle、namespace semantics、bundle closure等、書込み前validatorで守るもの

DBで表現できない意味を、DB-specific triggerへ隠さない。

---

## 2. Canonical record candidate

### 2.1 `semantic_artifacts`

| Column | Shape | Role |
|---|---|---|
| tenant_id | existing tenant identifier | tenant boundary |
| artifact_id | internal opaque ID | logical identity |
| semantic_kind | closed-set bounded text | immutable kind |
| created_at | canonical timestamp | creation |
| created_by_actor_kind | closed-set | human / ai / system / import / unknown |
| created_by_actor_ref | optional opaque ref | creator reference |

Constraints:

- PK / UNIQUE: `(tenant_id, artifact_id)`
- semantic kind closed-set check
- artifact kind update APIは提供しない

### 2.2 `semantic_artifact_revisions`

| Column | Shape | Role |
|---|---|---|
| tenant_id | tenant identifier | tenant boundary |
| revision_id | internal opaque ID | exact revision identity |
| artifact_id | opaque ID | logical artifact |
| payload_schema | bounded schema ref | payload contract |
| payload_content_ref | internal content ref | Content Store |
| payload_digest | sha256 bounded text | integrity cross-check |
| lifecycle | closed-set | active / held / rejected / superseded / archived |
| actor_kind | closed-set | provenance |
| actor_ref | optional opaque ref | provenance |
| method_kind | closed-set | provenance |
| method_ref | optional opaque ref | provenance |
| run_ref | optional opaque ref | AI/system execution |
| input_scope_ref | optional opaque ref | bounded input scope |
| created_at | canonical timestamp | immutable creation |

Constraints:

- UNIQUE: `(tenant_id, revision_id)`
- UNIQUE candidate: `(tenant_id, artifact_id, revision_id)` for composite FK target
- FK: `(tenant_id, artifact_id) -> semantic_artifacts`
- lifecycle closed-set check
- payload digest syntax checkはportable bounded validation + application strict validation
- UPDATE本文は禁止。lifecycle変更も新revisionにするかappend eventへ分離する実装方針をmigration前に再確認する

> Note: ADR-0086ではlifecycleをrevision envelopeに置いた。physical implementationではrevision immutableを厳格に取るため、lifecycleをrevision rowへ固定値として置くか、別append-only lifecycle eventへ分けるかをbenchmark前に最終決定する。in-place lifecycle updateを前提にはしない。

### 2.3 `semantic_artifact_revision_parents`

| Column | Role |
|---|---|
| tenant_id | tenant |
| artifact_id | same-artifact guard |
| child_revision_id | child |
| parent_revision_id | parent |

Constraints:

- UNIQUE: `(tenant_id, child_revision_id, parent_revision_id)`
- composite FK child: `(tenant_id, artifact_id, child_revision_id)`
- composite FK parent: `(tenant_id, artifact_id, parent_revision_id)`
- self-parent禁止 check
- cycleはvalidation-enforced

この形でparentが別artifactを指すことをDB FKで防ぐ。

### 2.4 `semantic_artifact_input_refs`

artifact provenanceとして別artifact revisionを入力に使ったことを保持。

| Column | Role |
|---|---|
| tenant_id | tenant |
| revision_id | output revision |
| ordinal | deterministic order if needed |
| input_artifact_id | input logical ID |
| input_revision_id | exact input |

Constraints:

- output exact revision FK
- input exact revision composite FK
- duplicate policyはrole / ordinal設計時に確定

### 2.5 `semantic_artifact_source_refs`

source registry / external sourceへのopaque ref。

- tenant_id
- revision_id
- source_ref
- ordinal

sourceがSUI内部registryにある場合だけFK化する。外部refを偽FKにしない。

### 2.6 `semantic_artifact_transformation_refs`

redaction / normalization / conversion lineage。

- tenant_id
- revision_id
- transformation_ref
- ordinal

---

## 3. Review

### 3.1 `semantic_reviews`

| Column | Role |
|---|---|
| tenant_id | tenant |
| review_id | immutable review ID |
| target_artifact_id | target |
| target_revision_id | exact target |
| reviewer_kind | human / ai / system |
| reviewer_ref | opaque actor |
| purpose | closed set |
| disposition | closed set |
| supersedes_review_id | optional correction lineage |
| created_at | append time |

Constraints:

- UNIQUE `(tenant_id, review_id)`
- exact target revision composite FK
- supersedes ref same tenant
- `accepted` / `consensus`をdisposition enumへ入れない
- reviewer kindと`human_reviewed`の連携はapplication policyで扱う

### 3.2 Review findings

短いclosed codeはbounded rows、長文findingはContent Storeへ分離する候補。

Review row自体へ自由長本文を大量に詰め込まない。

---

## 4. Authority

### 4.1 `authority_scopes`

| Column | Role |
|---|---|
| tenant_id | tenant |
| scope_ref | immutable scope identity |
| scope_kind | workspace / inquiry / network / decision_context / external_context |
| container_ref | context |
| purpose_ref | optional |
| parent_scope_ref | optional |
| created_at | creation |

Constraints:

- UNIQUE `(tenant_id, scope_ref)`
- parent same tenant FK
- self-parent禁止
- cycleはvalidation-enforced
- parent authority inheritanceを実装しない

### 4.2 `authority_transitions`

| Column | Role |
|---|---|
| tenant_id | tenant |
| event_id | append-only event |
| target_artifact_id | target |
| target_revision_id | exact revision |
| scope_ref | authority context |
| expected_from | CAS precondition |
| to_state | target state |
| authorized_by_kind | human / policy |
| authorized_by_ref | authority principal |
| policy_ref | optional |
| participant_set_ref | optional |
| created_at | append time |

Constraints:

- UNIQUE `(tenant_id, event_id)`
- exact target revision FK
- scope FK
- state closed-set checks
- participant set same tenant FK when provided
- current state correctnessはtransaction-enforced

### 4.3 `authority_transition_review_basis`

- tenant_id
- event_id
- review_id

両方same tenant FK。

### 4.4 `authority_transition_decision_basis`

- tenant_id
- event_id
- decision_artifact_id
- decision_revision_id

Decision semantic kindであることはtransaction / validationで確認する。

### 4.5 `authority_current_state`（derived cache）

| Column | Role |
|---|---|
| tenant_id | tenant |
| artifact_id | target |
| revision_id | exact revision |
| scope_ref | authority context |
| current_state | cache |
| last_event_id | reconstruction anchor |
| updated_at | cache time |

UNIQUE:
`(tenant_id, artifact_id, revision_id, scope_ref)`

このtableはAuthority event列から再構築可能でなければならない。

---

## 5. Consensus

### 5.1 `consensus_participant_sets`

- tenant_id
- participant_set_ref
- scope_ref
- membership_source_ref?
- created_at

immutable。

### 5.2 `consensus_participants`

- tenant_id
- participant_set_ref
- actor_ref
- actor_kind
- eligibility_role_ref?

UNIQUE:
`(tenant_id, participant_set_ref, actor_ref)`

participant updateは禁止。訂正時は新participant setを作る。

Consensus Policy本体は別policy registry / content contractの候補とし、本Issueで投票数式を固定しない。

---

## 6. Exchange

### 6.1 `artifact_import_sessions`

候補:

- tenant_id
- import_session_id
- source_network_ref
- bundle_digest
- state
- created_at
- completed_at?

state:
`staging | validated | committed | failed`

部分authority適用を防ぐため、staging / validationとcanonical commitを区別する。

### 6.2 `artifact_import_mappings`

- tenant_id
- import_session_id
- source_network_ref
- source_artifact_id
- source_revision_id
- local_artifact_id
- local_revision_id

source identity collisionの追跡用。

### 6.3 Source assertions

source Review / Authorityはlocal canonical eventと別record classにする。

```text
source_review_assertions
source_authority_assertions
```

少なくとも、

- source network
- source record identity
- source scope
- safe imported representation / content ref
- import session
- created_at

を保持できる。

local authority reducerはこれらを入力にしない。

---

## 7. Relation projection index

Relation artifactそのものはcanonical artifact。

高速query用indexはderived。

候補:

```text
semantic_relation_index
  tenant_id
  relation_artifact_id
  relation_revision_id
  predicate
  participant_ordinal
  participant_role
  target_kind
  target_ref
```

- unknown extension predicate保持
- index消失時にRelation payloadからrebuild
- index rowからRelation payloadを逆生成しない

---

## 8. Constraint responsibility matrix

| Invariant | DB | Transaction | Validator |
|---|---:|---:|---:|
| tenant越境FK禁止 | ✅ |  |  |
| exact revision存在 | ✅ |  |  |
| parent same artifact | ✅ composite FK |  |  |
| parent cycle禁止 |  |  | ✅ |
| semantic kind immutable | schema + no update path | ✅ | ✅ |
| payload kind/schema一致 |  |  | ✅ |
| payload digest一致 |  | ✅ load/write | ✅ |
| Review target exact revision | ✅ |  |  |
| AI Review != human Review | enum + policy | ✅ | ✅ |
| Authority expectedFrom一致 |  | ✅ CAS |  |
| Authority Scope存在 | ✅ |  |  |
| parent scope authority非継承 |  | ✅ | ✅ |
| participant snapshot immutable | no update path | ✅ |  |
| Consensus != Review count |  | ✅ | ✅ |
| imported authority非昇格 | separate tables | ✅ | ✅ |
| bundle closure |  |  | ✅ |
| import ID collision |  | ✅ | ✅ |
| unknown extension relation保全 |  |  | ✅ |
| extension relation side effect禁止 |  | ✅ | ✅ |
| retention root保護 |  | ✅ GC | ✅ |

---

## 9. Portable DB notes

### SQLite

- composite FK / unique / checkは利用可能
- concurrencyは単一writer特性を考慮
- shared-schema SaaS対象外
- Authority CAS fixtureはSQLite固有lock挙動と意味contractを分けて検証

### PostgreSQL

- shared-schema SaaS対象
- RLSは既存tenant policyに従う
- JSONBやrecursive CTEはoptimizationでのみ利用

### MySQL / MariaDB

- bounded identifier / index byte limitsに既存catalogを利用
- JSON field依存をCore constraintにしない

### SQL Server

- named constraint / bounded ID / LOB既存方針へ従う
- recursive / graph固有機能を必須にしない

### CockroachDB

- transaction semanticsを実DB fixtureで検証
- distributed DBであることからshared-schema SaaS対応を推論しない

### Oracle

- CLOB / named constraint等既存portable DDL境界へ従う
- JSON-specific featureをCore correctnessへ使わない

---

## 10. Authority CAS pseudo-flow

```text
BEGIN

load authority_current_state FOR UPDATE / equivalent
  by tenant + artifact + revision + scope

if current != expectedFrom:
    ROLLBACK -> stale_authority_state

validate authorizedBy / policy / participantSet / basis refs

append authority_transition

upsert authority_current_state(to_state, last_event_id)

append audit / outbox

COMMIT
```

具体的なlock primitiveはDB family adapterへ閉じ込める。

CASの意味は全DB共通にする。

---

## 11. Review target drift pseudo-flow

```text
Review starts on H/r3
AI or human creates H/r4
Review submits target H/r3

=> valid Review for r3
=> does NOT review r4
=> UI should show "newer revision exists"
=> r4 remains unreviewed
```

「最新revisionへ自動読み替え」は禁止。

---

## 12. Import staging pseudo-flow

```text
parse bundle
  ↓
schema / version
  ↓
SafeMode fixed-point / permission
  ↓
closure / external dependency
  ↓
identity collision
  ↓
source Review / Authority -> source assertion
  ↓
prepare payload blobs
  ↓
canonical transaction
  ↓
import mappings
  ↓
outbox
  ↓
materialized network
```

failure時:

- local Accepted / Consensusを残さない
- local human Reviewを残さない
- readyになっていないpayloadをcanonical revisionから参照しない
- external blob orphanは既存Content Store回収規則へ送る

---

## 13. Migration前に未決のもの

- exact physical names
- ID generation algorithm
- lifecycleをrevision envelopeに固定するかappend-only eventへ分離するか
- Review findingのbounded row / content object境界
- Consensus Policy persistence
- import source assertion payload shape
- materializer outbox既存table再利用可否
- current-state cache recovery operation
- Relation index更新の粒度
- GC reachability algorithmのDB-portable実装

これらをfixture / benchmarkなしにmigrationへ固定しない。
