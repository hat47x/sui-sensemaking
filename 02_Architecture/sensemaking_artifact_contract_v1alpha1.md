# Sensemaking Artifact Contract v1alpha1

- Status: **Normative design contract / L0 Planned**
- Date: 2026-09-18
- Parent: `ADR-0085`, `ADR-0086`
- Runtime implementation: **Not yet**
- Persistence implementation: **Not yet**
- Current `DocumentV1`: **Unchanged**

## 1. 目的

この契約は、SUI Sensemakingが将来AI Workspaceや人間との協働で生成する意味成果物について、

- logical identity
- exact revision identity
- provenance
- review
- authority transition
- Review Capsule
- retention boundary

を、現行Canvas schemaへ早期結合せず定義する。

この契約の目的は「新しいDB tableを先に作ること」ではない。

目的は、

> **何を同じ意味成果物として追跡し、何を別revisionとして固定し、何をReviewしたのか、誰がどのscopeで採用したのかを後から一意に説明できること**

である。

---

## 2. 共通参照

### 2.1 ArtifactRevisionRef

```ts
export type ArtifactRevisionRefV1Alpha1 = {
  artifactId: string;
  revisionId: string;
  contentDigest: `sha256:${string}`;
};
```

### 不変条件

1. `artifactId`はlogical identityであり、contentから独立する。
2. `revisionId`はexact revision identityであり、content digestから独立する。
3. `contentDigest`はintegrity / equality cross-checkであり、identityではない。
4. Review / Authority / Decision / provenance relationは可能な限りexact revisionを参照する。
5. 同じdigestを持つ別artifactを同一artifactへ自動統合しない。
6. digest一致を「同じ意味」「同じ由来」「同じauthority」の証明に使わない。

### 2.2 Opaque refs

actor、method、run、scope、policy等のrefはopaque stringとする。

refへメールアドレス、credential、provider secret等の生識別情報を埋め込まない。

具体的namespace形式はv1alpha1では固定しない。

---

## 3. Semantic Artifact Revision

### 3.1 SemanticKind

```ts
export type SemanticKindV1Alpha1 =
  | "evidence"
  | "observation"
  | "relation"
  | "hypothesis"
  | "structure"
  | "synthesis"
  | "decision";
```

Reviewはcontent artifactではなく独立recordとして扱う。これはADR-0085の概念上Reviewをsensemaking成果物として扱うことと矛盾しない。永続責務を分けるためのstorage classificationである。

### 3.2 Lifecycle

```ts
export type ArtifactLifecycleV1Alpha1 =
  | "active"
  | "held"
  | "rejected"
  | "superseded"
  | "archived";
```

LifecycleはAuthorityではない。

```text
held != Working
rejected != not-reviewed
superseded != revoked-authority
archived != invisible
```

### 3.3 Revision envelope

```ts
export type SemanticArtifactRevisionV1Alpha1 = {
  schema: "sui.semantic-artifact-revision/v1alpha1";
  artifactId: string;
  revisionId: string;
  semanticKind: SemanticKindV1Alpha1;
  parentRevisionIds: string[];
  contentDigest: `sha256:${string}`;
  provenance: ProvenanceEnvelopeV1Alpha1;
  lifecycle: ArtifactLifecycleV1Alpha1;
  createdAt: string;
};
```

semantic payload本体はkind-specific content store / payload contractへ分離する。v1alpha1では各kindの本文schemaを固定しない。

### 3.4 Revision invariants

- `artifactId`, `revisionId`, `semanticKind`は非空。
- 同じ`artifactId`の全revisionで`semanticKind`は同じ。
- `revisionId`はrepository / tenant内で一意。
- `parentRevisionIds`は同じ`artifactId`内のrevisionだけを参照する。
- cycleは禁止。
- Review / Authority / Decisionから参照済みrevisionはimmutable。
- kind変更は新artifactで行う。
- `contentDigest`検証失敗時、そのrevisionをsemantic payloadとして利用しない。
- digest一致だけでrevisionを自動再利用しない。

---

## 4. Provenance Envelope

### 4.1 型

```ts
export type ProvenanceActorKindV1Alpha1 =
  | "human"
  | "ai"
  | "system"
  | "import"
  | "unknown";

export type ProvenanceMethodKindV1Alpha1 =
  | "manual"
  | "deterministic"
  | "model"
  | "external"
  | "unknown";

export type ProvenanceEnvelopeV1Alpha1 = {
  actor: {
    kind: ProvenanceActorKindV1Alpha1;
    ref?: string;
  };
  method: {
    kind: ProvenanceMethodKindV1Alpha1;
    ref?: string;
  };
  runRef?: string;
  inputArtifactRefs: ArtifactRevisionRefV1Alpha1[];
  sourceRefs: string[];
  inputScopeRef?: string;
  transformationRefs?: string[];
  createdAt: string;
};
```

### 4.2 必須／任意境界

| 条件 | 必須 |
|---|---|
| 新規artifact revision全般 | actor.kind, method.kind, createdAt |
| AI / model生成 | `runRef` |
| 別artifactから派生 | `inputArtifactRefs`にexact revision |
| 外部資料を直接利用 | 可能な範囲で`sourceRefs` |
| legacy importでactor不明 | `actor.kind="unknown"`。actor refを推測しない |
| redaction / transformationあり | 変換を追跡するrefが存在する場合`transformationRefs` |

### 4.3 AI runとの境界

`runRef`の参照先が保持するもの:

- task
- provider / model
- input IR digest
- output digest
- policy version
- SafeMode
- trace ID

等。

artifact revisionへこれらを複製しない。

Provider変更時もartifact contractが変わらないことを優先する。

### 4.4 禁止

- 存在しないactor / sourceをAIが補う
- provider内部activationをTruth / Importanceへ読み替えてprovenanceへ入れる
- raw promptをprovenance envelopeへ複製する
- credentialをrefへ含める
- source refをauthorityの根拠と自動解釈する

---

## 5. Artifact間のprovenance relation

v1alpha1ではgeneric relation payloadを固定しないが、artifact lineageとして少なくとも次の役割を区別する。

```ts
export type ArtifactLineageRoleV1Alpha1 =
  | "derived_from"
  | "grounded_by"
  | "supports"
  | "contradicts"
  | "alternative_to"
  | "synthesizes"
  | "basis_for"
  | "supersedes";
```

この語彙は現行`Edge.type`へ追加するenumではない。

`Edge` / `EvidenceLink` / `CardLineageEdgeV1`と自動相互変換しない。

---

## 6. Review Record

### 6.1 型

```ts
export type ReviewActorV1Alpha1 = {
  kind: "human" | "ai" | "system";
  ref: string;
};

export type ReviewPurposeV1Alpha1 =
  | "understanding"
  | "challenge"
  | "quality"
  | "adoption_readiness"
  | "other";

export type ReviewDispositionV1Alpha1 =
  | "noted"
  | "no_objection"
  | "objected"
  | "held"
  | "changes_requested";

export type ReviewRecordV1Alpha1 = {
  schema: "sui.review-record/v1alpha1";
  reviewId: string;
  target: ArtifactRevisionRefV1Alpha1;
  reviewer: ReviewActorV1Alpha1;
  purpose: ReviewPurposeV1Alpha1;
  disposition: ReviewDispositionV1Alpha1;
  findingRefs: string[];
  supersedesReviewId?: string;
  createdAt: string;
};
```

### 6.2 Review invariants

- targetはexact revision。
- target revisionが変わればReviewは自動継承しない。
- `reviewer.kind="human"`だけが将来のhuman review判定の根拠候補になれる。
- AI Reviewをhuman reviewへ変換しない。
- dispositionに`accepted` / `consensus`を追加しない。
- Reviewを訂正するときはappend-onlyで新recordを作る。
- `supersedesReviewId`は同じtargetを原則とする。異なるrevisionへReviewを移し替える用途に使わない。

### 6.3 現行ReviewAttributionとの関係

現行`ReviewAttribution` / `human_reviewed`はそのまま維持する。

将来generic Review recordを導入した場合、

- document-level human review metadata
- artifact-level Review record

の関係をmigration ADRで決める。

v1alpha1だけを理由に現行`reviewState`を導出値へ変更しない。

---

## 7. Authority Transition Event

### 7.1 状態

```ts
export type AuthorityStateV1Alpha1 =
  | "working"
  | "candidate"
  | "accepted"
  | "consensus";
```

### 7.2 型

```ts
export type AuthorityPrincipalV1Alpha1 =
  | { kind: "human"; ref: string }
  | { kind: "policy"; ref: string };

export type AuthorityTransitionEventV1Alpha1 = {
  schema: "sui.authority-transition/v1alpha1";
  eventId: string;
  target: ArtifactRevisionRefV1Alpha1;
  expectedFrom: AuthorityStateV1Alpha1;
  to: AuthorityStateV1Alpha1;
  scopeRef: string;
  authorizedBy: AuthorityPrincipalV1Alpha1;
  basisReviewRefs: string[];
  basisDecisionRefs: ArtifactRevisionRefV1Alpha1[];
  policyRef?: string;
  participantSetRef?: string;
  createdAt: string;
};
```

### 7.3 Authority invariants

- stateはappend-only transition event列から導出する。
- current stateだけを正本として上書きしない。
- `expectedFrom`不一致はfail closed。
- transitionはexact revisionに対して成立する。
- 同じartifactの新revisionへauthorityを自動継承しない。
- `scopeRef`は必須。無制限scopeを暗黙既定にしない。
- ReviewがなくてもWorking→Candidateは可能にし得るが、Accepted / Consensus要件はpolicyで別途規定する。
- Consensusはreview件数から自動算出しない。
- `authorizedBy.kind="policy"`は将来予約であり、現行runtimeではAccepted / Consensusへの自動promotionに使わない。

### 7.4 代表遷移

| expectedFrom | to | 意味 |
|---|---|---|
| working | candidate | Review / adoption対象へ提示 |
| candidate | working | 提示を撤回 |
| candidate | accepted | scope内で採用 |
| accepted | candidate | 採用を撤回・再検討 |
| accepted | consensus | 定義済み手続きで共有採用 |
| consensus | accepted | Consensus解除・scope縮小 |

別revisionへ置換する場合は、旧revisionのauthority historyを改変せず、新revision側に独立transitionを作る。

---

## 8. Decisionとの接続

Decisionはsemantic artifactであり、Authority eventそのものではない。

Decision payloadの具体schemaは未固定だが、少なくとも次を参照できることを要求する。

- basis artifact revision refs
- authority scope
- decision actor / authority
- selected option
- held / rejected alternatives
- createdAt

DecisionがAccepted Synthesisをbasisにしても、そのSynthesisのTruthを証明しない。

Decisionを外部Actionへ接続する場合は、Execution / authorization境界を別契約とする。

---

## 9. Review Capsule

### 9.1 Structural Capsule

```ts
export type ReviewCapsuleStructuralV1Alpha1 = {
  schema: "sui.review-capsule-structural/v1alpha1";
  targetRefs: ArtifactRevisionRefV1Alpha1[];
  synthesisRefs: ArtifactRevisionRefV1Alpha1[];
  evidenceRefs: ArtifactRevisionRefV1Alpha1[];
  observationRefs: ArtifactRevisionRefV1Alpha1[];
  contradictionRefs: ArtifactRevisionRefV1Alpha1[];
  alternativeRefs: ArtifactRevisionRefV1Alpha1[];
  unresolvedRefs: ArtifactRevisionRefV1Alpha1[];
  reviewRefs: string[];
  authorityStateRefs: string[];
  requestedAuthorityAction?: {
    target: ArtifactRevisionRefV1Alpha1;
    expectedFrom: AuthorityStateV1Alpha1;
    to: AuthorityStateV1Alpha1;
    scopeRef: string;
  };
  sourceSetDigest: `sha256:${string}`;
  projectionPolicyRef: string;
  generatedAt: string;
};
```

Structural Capsuleは元record群から再構築可能なProjectionである。

`sourceSetDigest`は入力ref集合とprojection policyのcross-check用であり、authority証明ではない。

### 9.2 Narrative Explanation

```ts
export type ReviewCapsuleNarrativeV1Alpha1 = {
  schema: "sui.review-capsule-narrative/v1alpha1";
  structuralSourceSetDigest: `sha256:${string}`;
  text: string;
  provenance: ProvenanceEnvelopeV1Alpha1;
};
```

Narrativeは人間でもAIでも生成できる。

Narrative textをReview / Authorityの正本にしない。

### 9.3 Capsule invariants

- Structural Capsuleから全refを元recordへ解決できる。
- Strong contradictionや主要alternativeを説明都合で削除しない。
- AI Narrativeはhuman Review recordを生成しない。
- source setが変わったら、古いNarrativeを最新説明として再利用しない。
- Capsule cache削除でcanonical dataを失わない。

---

## 10. 主要代替案のRetention Boundary

### 10.1 Protected candidate

次のいずれかに該当するrevisionは、GC候補から自動除外するための保護入力になり得る。

- Authority stateがCandidate / Accepted / Consensusに到達した
- Review targetになった
- Decisionのbasisになった
- retained artifactから`alternative_to` / `contradicts` / `grounded_by`等で直接参照される
- 後続Synthesisから明示参照される
- 利用者 / policy pinがある
- governed checkpointに含まれる

### 10.2 Disposable microtrial

次を全て満たすWorking-only revisionはretention policyによりGC可能。

- Reviewされていない
- Authority promotionされていない
- Decision basisでない
- retained descendant / relationから到達不能
- pinされていない
- governed checkpointに含まれない

### 10.3 CoTとの境界

保存対象は外在化されたartifact / relation / eventである。

次は保存必須ではない。

- token-by-token reasoning
- hidden state
- provider内部activation
- beam / samplingの全candidate
- model内部のdiscarded thought

ただし、後続の選択や人間Reviewに実質的に影響した代替案は、必要に応じて独立Hypothesis / Structure artifactとして外在化する。

---

## 11. Current Model Integration

### 11.1 DocumentV1

`DocumentV1`は現在の可変Canvas正本であり、本契約のartifact storeではない。

本契約を理由に、次を行わない。

- `semanticArtifacts[]`を追加
- `reviews[]`を追加
- `authorityEvents[]`を追加
- `Card.claimType`をsemanticKindへ変更
- `version: 2`へ上げる

将来はartifact側から、

```text
document revision ref
entity ref (card / island / edge ...)
```

をsource / contextとして参照する方式を優先検討する。

### 11.2 Canvas revision DAG

ADR-0070のcanvas revision DAGはDocument全体の編集世代である。

semantic artifact revisionと原則は似るが、同じrevisionではない。

```text
CanvasRevision
  = whole-document generation

SemanticArtifactRevision
  = one semantic artifact's revision
```

同一tableへ統合しない。

Content Store、canonical JSON、digest codec等の下位部品を共有するかは別途評価する。

### 11.3 InquiryJourneyV1 / RoundSnapshotV1

`RoundSnapshotV1`は人が「ここまでを残す」と確認した不変なDocument成果である。

semantic artifactはRoundSnapshotをsourceとして参照できるが、RoundSnapshotそのものをSynthesis artifact等へ自動変換しない。

既存`CardLineageEdgeV1.derived`はラウンド間カード系譜であり、artifact-level `derived_from`とは別contractのまま維持する。

### 11.4 ReviewAttribution

現行document-level `human_reviewed` / ReviewAttributionを維持する。

generic artifact Reviewの導入後にどちらを正本とするかはmigration判断とする。

### 11.5 AI generation run

AI artifact revisionでは`runRef`を既存AI generation runへ接続する。

provider / model / prompt / policyをartifact metadataへ複製しない。

### 11.6 WorkingGraph / ConsensusGraph

- WorkingGraph = Working artifactを探索・編集するsurface
- ConsensusGraph = Accepted / Consensus artifactを統合表示するsurface

Graph自体をsemantic kindやauthority eventと同一視しない。

---

## 12. Validation Matrix

| Case | Expected |
|---|---|
| 同じdigest、別artifactId | 両方保持可能 |
| 同じartifactId、semanticKind変更 | reject / new artifact required |
| Review target revisionが存在しない | reject |
| Review後に新revision作成 | 旧Reviewを新revisionへ継承しない |
| AI review | human_reviewedへ昇格しない |
| Authority expectedFrom mismatch | fail closed |
| 5件のno_objection Review | Consensusを自動生成しない |
| Candidate revisionがrejected lifecycleへ | authority historyは保持 |
| Review Capsule cache削除 | canonical artifact / Review / Authority eventは不変 |
| provider変更 | runRef解決先だけ変わりartifact contractは不変 |
| contentDigest一致 | authorization / authenticityを意味しない |
| source Evidence conflicting | 両方保持可能 |
| Working microtrialが到達不能・未review・未pin | retention policyでGC可能 |
| private CoTが存在しない | contract violationにしない |

---

## 13. Promotion Gates

v1alpha1からruntime契約へ昇格する前に、少なくとも次を満たす。

1. representative fixtureでartifact / revision / Review / Authority eventの往復を検証する。
2. stale review target、stale authority state、同時promotion競合を再現する。
3. SafeMode projectionでprovenance / Review / source refsの漏洩境界を確認する。
4. human reviewとAI reviewがUI / export / APIで混ざらない。
5. RoundSnapshot / canvas revisionとの重複容量を計測する。
6. 100〜1000 artifact規模でReview Capsule再構築時間を測る。
7. retention / GCでReview・Authority・Decision参照先を削除しない。
8. import / exportでunknown future fields / version mismatchをfail-closedにする方針を決める。
9. `SUI_LLM_PROVIDER=none`でもhuman artifact / Review / Authority操作が成立する。
10. 現行`DocumentV1`の互換性を破壊する必要が生じた場合、実装前に別schema ADRを採択する。

---

## 14. 未決事項

次はv1alpha1で意図的に固定しない。

- UUIDv7等の具体ID生成方式
- kind-specific semantic payload schema
- Relation vocabularyの最終closed/open boundary
- Authority Scopeの具体型
- Consensus participant snapshot schema
- Review finding schema
- physical DB schema / index
- Content Store共用可否
- artifact-level import / export bundle schema
- Review CapsuleのUI表現
