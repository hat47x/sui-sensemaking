# Sensemaking Payload / Authority / Exchange Contract v1alpha1

- Status: **Normative design contract / L0 Planned**
- Date: 2026-09-18
- Parent: `ADR-0085`, `ADR-0086`, `ADR-0087`
- Runtime implementation: **Not yet**
- Persistence implementation: **Not yet**
- Current `DocumentV1`: **Unchanged**

## 1. 目的

この契約は、`sensemaking_artifact_contract_v1alpha1.md` が定義したartifact identity / revision / provenance / Review / Authority eventに対して、

- kind-specific semantic payload
- core / extension Relation
- Authority Scope
- Consensus participant snapshot
- artifact exchange bundle
- SUI Information Networkへのmaterialization

を追加で定義する。

この契約はphysical DB schemaではない。

---

## 2. 共通参照型

### 2.1 SemanticTargetRef

意味成果物はartifactだけでなく、元sourceや既存network entityを対象にできる。

```ts
export type SemanticTargetRefV1Alpha1 =
  | {
      kind: "artifact_revision";
      ref: ArtifactRevisionRefV1Alpha1;
    }
  | {
      kind: "source";
      ref: string;
    }
  | {
      kind: "network_entity";
      ref: string;
    };
```

### 不変条件

- `artifact_revision`はexact revisionを指す。
- `source` / `network_entity` refはopaque。
- unknown ref kindを勝手にartifactへ推測変換しない。
- permission / visibility確認前にref先本文を展開しない。

---

## 3. kind-specific payload

### 3.1 Evidence

Evidenceは、sensemakingの根拠として参照する内容またはsource segmentを表す。

```ts
export type EvidenceRepresentationV1Alpha1 =
  | {
      kind: "inline_text";
      text: string;
    }
  | {
      kind: "source_segment";
      sourceRef: string;
      locatorRef?: string;
      sourceVersionDigest?: `sha256:${string}`;
    }
  | {
      kind: "compound";
      items: Array<
        | { kind: "inline_text"; text: string }
        | {
            kind: "source_segment";
            sourceRef: string;
            locatorRef?: string;
            sourceVersionDigest?: `sha256:${string}`;
          }
      >;
    };

export type EvidencePayloadV1Alpha1 = {
  schema: "sui.semantic-payload/evidence/v1alpha1";
  representation: EvidenceRepresentationV1Alpha1;
};
```

#### Invariants

- `source_segment`はsource本文を複製することを要求しない。
- locatorが取得できない場合にAIが推測して補わない。
- `sourceVersionDigest`はsource version整合確認用でありTruth証明ではない。
- Evidence本文の要約を元Evidenceとして上書きしない。要約はObservation / Synthesis等の別artifactにする。

---

### 3.2 Observation

```ts
export type ObservationPayloadV1Alpha1 = {
  schema: "sui.semantic-payload/observation/v1alpha1";
  statement: string;
  about: SemanticTargetRefV1Alpha1[];
};
```

#### Invariants

- Observationの認識主体・MethodはpayloadでなくProvenance Envelopeに置く。
- confidence / importance / rankを必須fieldにしない。
- 同じEvidenceに複数Observationが存在してよい。
- statementが同じでもactor / method / inputが異なれば同じartifactだと自動判定しない。

---

### 3.3 Relation

#### Predicate

```ts
export type CoreRelationPredicateV1Alpha1 =
  | "sui.core/derived_from"
  | "sui.core/grounded_by"
  | "sui.core/supports"
  | "sui.core/contradicts"
  | "sui.core/alternative_to"
  | "sui.core/synthesizes"
  | "sui.core/basis_for"
  | "sui.core/supersedes"
  | "sui.core/contains"
  | "sui.core/precedes";

export type RelationPredicateV1Alpha1 =
  | CoreRelationPredicateV1Alpha1
  | `${string}:${string}/${string}`;
```

extension predicateの例:

```text
domain:requirements/depends_on
method:kj/close_affinity
experiment:csw/symbolic_resonance
```

#### Participant

```ts
export type RelationParticipantV1Alpha1 = {
  role: string;
  target: SemanticTargetRefV1Alpha1;
};

export type RelationPayloadV1Alpha1 = {
  schema: "sui.semantic-payload/relation/v1alpha1";
  predicate: RelationPredicateV1Alpha1;
  participants: RelationParticipantV1Alpha1[];
};
```

#### Core role validation

| Predicate | 必須role | 備考 |
|---|---|---|
| `derived_from` | `derived`, `source` | derivedはartifact revisionを推奨 |
| `grounded_by` | `claim`, `ground` | groundはEvidence等 |
| `supports` | `supporter`, `target` | supportはTruth確定ではない |
| `contradicts` | `contradictor`, `target` | contradiction自体もReview可能 |
| `alternative_to` | `alternative` 2件以上 | 対称関係として扱える |
| `synthesizes` | `synthesis`, `component` 1件以上 | Synthesisへ構成要素を接続 |
| `basis_for` | `basis`, `target` | Decision等のbasis |
| `supersedes` | `newer`, `older` | 削除を意味しない |
| `contains` | `container`, `member` 1件以上 | membership |
| `precedes` | `earlier`, `later` | 因果を意味しない |

#### Extension predicate invariant

登録済みpolicyが無いextension relationは、

- authority promotion
- permission
- Consensus
- retention root
- Truth / importance inference

へ利用しない。

未知extension predicateはopaque relationとして保持できる。

---

### 3.4 Hypothesis

```ts
export type HypothesisPayloadV1Alpha1 = {
  schema: "sui.semantic-payload/hypothesis/v1alpha1";
  statement: string;
  about: SemanticTargetRefV1Alpha1[];
  applicabilityRefs?: string[];
};
```

#### Invariants

- Evidence / ObservationからHypothesisへin-place変換しない。
- `applicabilityRefs`はAuthority Scopeではない。
- supports / contradicts / grounded_byはRelation artifactで表す。
- provider自己申告confidenceをHypothesisのTruth scoreにしない。

---

### 3.5 Structure

```ts
export type StructureKindV1Alpha1 =
  | "set"
  | "hierarchy"
  | "sequence"
  | "spatial"
  | "causal_candidate"
  | "network"
  | "mixed";

export type StructurePayloadV1Alpha1 = {
  schema: "sui.semantic-payload/structure/v1alpha1";
  structureKind: StructureKindV1Alpha1;
  memberRefs: ArtifactRevisionRefV1Alpha1[];
  relationRefs: ArtifactRevisionRefV1Alpha1[];
};
```

#### Invariants

- `causal_candidate`は因果が確定したことを意味しない。
- member / relationの順序に意味がある場合はkind-specific validationで保持する。
- Island / Cluster / spatial canvasはStructureのProjectionになり得るが自動変換しない。
- 同じmember集合から複数Structureを保持できる。

---

### 3.6 Synthesis

```ts
export type SynthesisPayloadV1Alpha1 = {
  schema: "sui.semantic-payload/synthesis/v1alpha1";
  body: string;
  componentRefs: ArtifactRevisionRefV1Alpha1[];
  unresolvedRefs: ArtifactRevisionRefV1Alpha1[];
};
```

#### Invariants

- Synthesisは最終結論を意味しない。
- 主要反証・代替案はRelation / component refsから辿れる必要がある。
- `unresolvedRefs`を空にするために未解決を削除しない。
- 複数の競合Synthesisを保持できる。

---

### 3.7 Decision

```ts
export type DecisionKindV1Alpha1 =
  | "adopt"
  | "defer"
  | "reject"
  | "investigate"
  | "act"
  | "other";

export type DecisionPayloadV1Alpha1 = {
  schema: "sui.semantic-payload/decision/v1alpha1";
  decisionKind: DecisionKindV1Alpha1;
  statement: string;
  selectedRefs: ArtifactRevisionRefV1Alpha1[];
  alternativeRefs: ArtifactRevisionRefV1Alpha1[];
  basisRefs: ArtifactRevisionRefV1Alpha1[];
  decisionContextRef: string;
};
```

#### Invariants

- DecisionはAuthority transitionやExecutionではない。
- `decisionContextRef`はDecisionが成立した文脈であり、Authority Scope refと同じ値である必要はない。
- external Actionへ進む場合は別authorization / execution contractが必要。
- AIがDecision payloadを生成しても、人間Decision Authorityを持ったことにはならない。

---

## 4. semantic payload dispatch

```ts
export type SemanticPayloadV1Alpha1 =
  | EvidencePayloadV1Alpha1
  | ObservationPayloadV1Alpha1
  | RelationPayloadV1Alpha1
  | HypothesisPayloadV1Alpha1
  | StructurePayloadV1Alpha1
  | SynthesisPayloadV1Alpha1
  | DecisionPayloadV1Alpha1;
```

Revision Envelopeの`semanticKind`とpayload schemaは一致必須。

例:

```text
semanticKind = "hypothesis"
payload.schema = "sui.semantic-payload/hypothesis/v1alpha1"
```

不一致はfail closed。

---

## 5. Authority Scope

### 5.1 型

```ts
export type AuthorityScopeKindV1Alpha1 =
  | "workspace"
  | "inquiry"
  | "network"
  | "decision_context"
  | "external_context";

export type AuthorityScopeV1Alpha1 = {
  schema: "sui.authority-scope/v1alpha1";
  scopeRef: string;
  kind: AuthorityScopeKindV1Alpha1;
  containerRef: string;
  purposeRef?: string;
  parentScopeRef?: string;
  createdAt: string;
};
```

### 5.2 Invariants

- Authority Scopeはimmutable。
- `scopeRef`はopaque。
- `parentScopeRef`はauthority継承を意味しない。
- cycleは禁止。
- scopeが異なれば、同じrevisionでも別のAuthority stateを持ち得る。
- scopeはpermission / ACL / visibilityではない。
- `external_context`は外部制度・顧客・会議等を参照するためのplaceholderであり、外部systemのauthorityをSUIが保証することを意味しない。

### 5.3 例

```text
Hypothesis H/r3

Scope A = inquiry: "沖縄連載第15回の検討"
  -> Accepted

Scope B = network: "公開知識ネットワーク"
  -> Candidate

Scope C = external_context: "公開記事"
  -> Working / not promoted
```

一つのAccepted状態を全scopeへ伝播しない。

---

## 6. Consensus Participant Snapshot

### 6.1 型

```ts
export type ConsensusParticipantV1Alpha1 = {
  actorRef: string;
  actorKind: "human" | "ai" | "system" | "external";
  eligibilityRoleRef?: string;
};

export type ConsensusParticipantSetV1Alpha1 = {
  schema: "sui.consensus-participant-set/v1alpha1";
  participantSetRef: string;
  scopeRef: string;
  participants: ConsensusParticipantV1Alpha1[];
  membershipSourceRef?: string;
  createdAt: string;
};
```

### 6.2 Invariants

- snapshotはimmutable。
- actorRefはopaque。
- display name / mail address等のPIIを必須にしない。
- actorRef重複は禁止。
- snapshot生成後に組織membershipが変わっても過去snapshotを変更しない。
- `membershipSourceRef`が無ければ、存在しないmembership sourceを推測しない。
- 現行runtimeではAI / systemだけのparticipant setをConsensus Authorityのbasisにしない。

---

## 7. Consensus Policy Boundary

v1alpha1では具体的投票計算を固定しない。

Authority transitionの`policyRef`は、次のいずれかの手続きへ解決可能でなければならない方向とする。

- explicit unanimous
- explicit quorum
- formally delegated procedure
- domain-specific explicit procedure

ただし、

```text
ConsensusPolicy
  != ParticipantSet
  != Review count
  != model confidence
```

である。

### 7.1 禁止

- `no_objection` ReviewがN件あるだけでConsensusへ昇格
- AIのconfidence閾値をConsensus判定に利用
- participant set外のactor Reviewを黙って集計
- 現在membershipを使って過去participant setを再計算
- majority / quorumを非序列化原則とは無関係に自動導入

具体policyはmulti-user機能を設計するときに別ADRで採択する。

---

## 8. Artifact Exchange Bundle

### 8.1 ExchangeとBackupを分離する

artifact exchange bundleは、別workspace / network / systemへ意味成果物を移送・共有する契約である。

運用上のbackup / disaster recoveryは別契約とする。

```text
Exchange
  = source authorityをlocal authorityへ継承しない

Backup / Restore
  = 同一authority domainの復元
  = 別の運用・真正性契約
```

この二つを一つのimport処理へ統合しない。

### 8.2 Manifest

```ts
export type ArtifactExchangeExternalDependencyV1Alpha1 = {
  ref: string;
  kind: "source" | "artifact" | "policy" | "scope" | "participant_set" | "other";
  reason: string;
};

export type ArtifactExchangeManifestV1Alpha1 = {
  schema: "sui.artifact-exchange-manifest/v1alpha1";
  bundleId: string;
  sourceNetworkRef: string;
  rootRefs: ArtifactRevisionRefV1Alpha1[];
  safeModeApplied: true;
  authorityMode: "source_assertions_only";
  externalDependencies: ArtifactExchangeExternalDependencyV1Alpha1[];
  createdAt: string;
};
```

### 8.3 Bundle

```ts
export type SourceAuthorityAssertionV1Alpha1 = {
  sourceNetworkRef: string;
  sourceScope: AuthorityScopeV1Alpha1;
  sourceEvent: AuthorityTransitionEventV1Alpha1;
};

export type SourceReviewAssertionV1Alpha1 = {
  sourceNetworkRef: string;
  sourceReview: ReviewRecordV1Alpha1;
};

export type ArtifactExchangeBundleV1Alpha1 = {
  manifest: ArtifactExchangeManifestV1Alpha1;
  revisions: SemanticArtifactRevisionV1Alpha1[];
  payloads: SemanticPayloadV1Alpha1[];
  scopes: AuthorityScopeV1Alpha1[];
  participantSets: ConsensusParticipantSetV1Alpha1[];
  sourceReviews: SourceReviewAssertionV1Alpha1[];
  sourceAuthorityAssertions: SourceAuthorityAssertionV1Alpha1[];
};
```

実装時はrevisionとpayloadの対応keyを明示的に定義する。v1alpha1では配列配置順へ意味を持たせない。

### 8.4 Closure rule

rootから必要なrefを辿り、各refは、

- bundle内に存在する
- `externalDependencies`に明示される

のどちらかでなければならない。

silent dangling refは禁止。

### 8.5 SafeMode

外部共有用exchange bundleでは`safeModeApplied=true`を必須とする。

- 元artifact / networkを変更しない
- 派生bundle側でredact / omit / rebuildを行う
- redaction後payloadのdigestを再計算する
- source Review / Authority stateをredactionで人間承認済みへ昇格させない
- permissionで読めないrefをbundleへ含めない
- permission除外によってclosureを満たせない場合、external dependencyとして露出してよいかをpolicyで判断し、不可ならexportをfail closedする

### 8.6 Imported authority

import先では、

```text
SourceAuthorityAssertion
  != Local AuthorityTransitionEvent
```

である。

importされたartifact revisionのlocal authority既定値は`working`とする方向を採る。

利用者が明示的にReview対象として提示する場合に`candidate`へlocal transitionできる。

source側Accepted / Consensusをlocal Accepted / Consensusへ直接復元するのはexchangeではなくbackup/restore領域である。

### 8.7 Imported Review

```text
SourceReviewAssertion(human)
  != local human Review
  != local human_reviewed
```

source human Reviewはprovenanceとして表示できるが、local reviewerによる新Reviewを要求する。

### 8.8 Identity collision

import時に同じ`artifactId / revisionId`が存在する場合:

1. semantic kind
2. content digest
3. parent revision refs
4. provenance identity

を検証する。

完全整合する場合だけ既存revisionへresolve可能。

不一致ならfail closedする。

local ID再発行方式を採る場合は、

```text
origin network
origin artifact ID
origin revision ID
local artifact ID
local revision ID
```

のmappingを失わない。

---

## 9. Information Network materialization

### 9.1 責務

semantic artifact persistenceは意味成果物の正本を保持する。

SUI Information Networkは、その情報をquery可能な長期ネットワークへmaterializeするtarget architectureである。

```text
Semantic artifacts / events
  │
  │ materialize by permission / scope / time
  ▼
SUI Information Network
  │
  ▼
QualitativeNetworkSnapshot
  │
  ▼
D0..D5 Query
  │
  ▼
Context Projection
```

### 9.2 Materialization原則

- artifact revisionはnetwork nodeになり得る。
- Relation artifactはnetwork edge / hyperedge projectionになり得る。
- Authority Scopeごとのstateはnode propertyの単一`status`へ潰さない。
- Review recordはevent / provenance projectionになり得る。
- Working / Consensus planeはauthority / actor-aware projectionでありsemantic kindではない。
- permission / SafeModeをmaterialization時に適用する。
- Query結果やContext Projectionをcanonical artifactへ逆書込みしない。

### 9.3 QualitativeNetworkSnapshotとの関係

既存`QualitativeNetworkSnapshot`はquery用read modelとして維持する。

将来semantic artifactをsourceにする場合でも、

- snapshot fieldをartifact DB schemaへ合わせて膨張させない
- Queryが必要とする形へ投影する
- exact artifact revisionへ戻れるstable refを持つ
- unknown relation / provenance欠落を破棄しない

ことを優先する。

---

## 10. Physical persistence logical requirements

physical DB設計は別ADRとするが、少なくとも次のlogical record classを独立に永続化できる必要がある。

```text
Artifact identity
Artifact revision
Artifact payload/blob
Artifact relation
Review record
Authority scope
Authority transition
Consensus participant snapshot
Source review/authority assertion
Exchange import mapping
Pin / retention root
```

### 10.1 Current-state cache

performanceのため、

- latest revision
- current authority state per scope
- materialized network node

等をcacheしてよい。

ただし、cacheだけを正本にしない。

Authority current stateはtransition event列から再構築可能でなければならない。

### 10.2 Storage engine non-decision

本契約は、

- PostgreSQL等のRDB
- JSON aggregate
- graph DB
- object store
- existing Content Store

のどれを最終採用するか決めない。

次のADRで、代表fixtureとQuery / GC / import-export workloadをもとに比較する。

---

## 11. Validation Matrix

| Case | Expected |
|---|---|
| ObservationとHypothesisのstatementが同文 | 別kind・別artifactとして保持可能 |
| Evidence source pointerだけ | valid。source本文複製不要 |
| unknown extension Relation | 保持可能。authority / retention side effectなし |
| core `contradicts` role欠落 | reject |
| inquiry scope Accepted / network scope Working | valid |
| parent scope Accepted | child scopeへ自動継承しない |
| participant membership変更 | 過去snapshot不変 |
| 5 human Reviews + participant set | Consensusを自動生成しない |
| source Accepted artifactをexchange import | local Working、source assertion保持 |
| source human Reviewをimport | local human_reviewedを付与しない |
| bundle内ref欠落・external dependency未記載 | reject |
| ID同一・digest不一致 | collision / fail closed |
| SafeModeで必要refが読めない | policyによりexternal dependency化またはexport拒否 |
| Context Projection生成 | canonical artifact不変 |
| current authority cache消失 | transition eventから再構築可能 |

---

## 12. Promotion Gates

runtime / persistenceへ昇格する前に、次を検証する。

1. 各kind payloadのcanonical JSON / digest往復。
2. core Relation role validation。
3. extension Relation unknown roundtrip。
4. 同一revisionに複数scopeのauthority stateを持つfixture。
5. participant snapshotのmembership変更耐性。
6. source Accepted / Consensus importがlocal authorityへ漏れないこと。
7. source human Review importが`human_reviewed`へ漏れないこと。
8. self-contained / external dependency bundle validation。
9. SafeMode後のclosure validation。
10. 100 / 1000 / 10000 artifactでInformation Network materializationとReview Capsule再構築を計測。
11. current-state cacheを削除してevent列からauthorityを復元。
12. retention GCがsource assertion / Review / Authority basisを破壊しない。
13. physical persistence candidateをRDB / aggregate / graph観点で比較。
14. artifact exchangeとbackup/restoreを別入口として実装できることを確認。

---

## 13. 未決事項

- exact ID generation format
- Evidence source locator共通contract
- kind payloadのUI編集surface
- extension Relation registry format
- Authority Scope parent利用方針
- Consensus Policy具体schema
- artifact bundle署名 / authenticity
- physical table / index / partition
- object/blob dedup
- artifact exchange import UI
- Review Capsule UI
