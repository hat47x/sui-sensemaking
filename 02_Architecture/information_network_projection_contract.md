# SUI Information Network / Context Projection Contract

- Status: **Normative / Target architecture**
- Date: 2026-09-12
- Authority: `00_Prompt/domain.md` の不変条件を具体化する正式アーキテクチャ契約

## 1. 適用範囲と旧契約の扱い

本契約は、SUI Sensemaking の最終的な情報ネットワーク、定性Query、多主体Context Projectionの正本である。

この領域の新規設計・実装は、旧 `DocumentV1`、旧 `ContextQueryV1`、旧 `ContextBundleV1` をターゲットにしない。これらへ合わせるadapter、compiler、互換レイヤーを新設しない。既存コード・文書中の参照は移行対象の技術的残存物として扱い、最終設計判断の根拠にしない。

正式な流れは次だけとする。

```text
SUI Information Network
        │
        │ materialize by scope / permission / time
        ▼
QualitativeNetworkSnapshot
        │
        │ Query Intent
        ▼
Selection / Analysis (D0..D5)
        │
        │ actor-aware presentation
        ▼
Context Projection
```

## 2. SUI Information Network

SUI Information Network は単一Documentの入れ物ではない。人間、生成AI、SEI Cognition、外部systemが共有できる長期情報空間であり、次を第一級に保持する。

- 情報単位（card、island、concept、source、event、proposal等）
- 明示relation
- 空間配置
- provenance / contributor / provider
- temporal event / revision history
- hold / critique / contradiction
- actor-specific working state
- human approvalを経たconsensus state

情報ネットワークは「一つの正解解釈」を表さない。異論、保留、少数意見、未解決、複数主体のWorking stateを共存させる。

## 2.1 Semantic artifact modelとの接続

ADR-0085〜0087で定義したEvidence / Observation / Relation / Hypothesis / Structure / Synthesis / Decision等のsemantic artifactは、SUI Information Networkと競合する別の正本ではない。

将来の永続層では、semantic artifact revision、Review、Authority Scope / transition、provenance等を正本として保持し、Information Networkはそれらをquery可能な形へmaterializeする。

```text
semantic artifact revisions / events
        │
        │ materialize by permission / authority scope / time
        ▼
SUI Information Network
        │
        ▼
QualitativeNetworkSnapshot
        │
        ▼
D0..D5 / Context Projection
```

- artifact revisionはnetwork nodeへ投影できる。
- Relation artifactはedge / hyperedgeへ投影できる。
- Review / Authority eventはevent / provenanceとして投影できる。
- 同じartifact revisionが複数Authority Scopeで異なるstateを持ち得るため、単一`status`へ潰さない。
- sourceからimportしたAuthority assertionはlocal Consensus stateへmaterializeしない。
- unknown extension relationは破棄せず、ただしCore semanticsのside effectを与えない。
- Query / Projection結果はcanonical artifactへ逆書込みしない。

`QualitativeNetworkSnapshot`は引き続きQuery層のread modelであり、physical persistence schemaではない。

## 3. Graph planes

### 3.1 WorkingGraph

`WorkingGraph` は探索、仮説、未確定relation、配置、hold、critiqueを保持する書込み可能な作業面である。

- actor / workspaceにscopeできる
- consensusではない
- AI / SEI proposalを保持できる
- 可逆性を維持する

### 3.2 ConsensusGraph

`ConsensusGraph` は、共有状態として明示承認された差分を、**Authority Scopeを伴って**統合表示する面である。

- `proposal / patch -> human approval -> apply` だけが現行runtimeの昇格経路
- AI / SEI / external systemによるdirect writeは禁止
- 多数決、score、model confidenceはapprovalの代替にならない
- disagreement / holdを消して作らない
- source/import側のAccepted / Consensusをlocal Consensusへ自動投影しない
- 同じrevisionでもscopeが異なればAuthority stateは異なり得る
- ConsensusGraph自体をAuthority eventの正本にしない

### 3.3 ContextProjectionGraph

`ContextProjectionGraph` はQueryごとに生成されるread-only derived viewである。

- 永続正本ではない
- SelectionとPresentationを分離する
- 元node / relation / provenanceへ復元できる
- actor kind自体をtruth、priority、permissionへ変換しない

## 4. Query substrate: QualitativeNetworkSnapshot

Query engineは保存形式そのものを直接読むのではなく、次の論理snapshotを入力とする。

```ts
type QualitativeNetworkSnapshot = {
  networkId: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  sources: SourceRecord[];
  critiques: CritiqueRecord[];
  contradictions: ContradictionRecord[];
  events: NetworkEvent[];
};

type NetworkNode = {
  id: string;
  kind: string;
  text?: string;
  islandId?: string;
  x?: number;
  y?: number;
  holdState?: "held" | "pending" | "shelved";
  reviewState?: "unreviewed" | "human_reviewed";
  sourceRefs: string[];
  actorRefs: string[];
};

type NetworkEdge = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  directed: boolean;
};

type SourceRecord = {
  id: string;
  kind?: string;
  locator?: string;
  actorRefs?: string[];
};

type CritiqueRecord = {
  id: string;
  targetRef: string;
  type: string;
  state: string;
};

type ContradictionRecord = {
  id: string;
  fromId: string;
  toId: string;
  state: string;
};

type NetworkEvent = {
  id: string;
  at: string;
  type: string;
  targetRefs: string[];
  actorRefs?: string[];
};
```

これは永続storage schemaではない。Query層へ渡す正式な論理境界である。保存実装はこのsnapshotを決定論的にmaterializeできればよい。

### 4.1 必須原則

- `sourceRefs` と `actorRefs` は推測しない
- provenance欠落は欠落のまま表現する
- event順序を因果へ読み替えない
- unknown relation typeを破棄しない
- review stateとconsensus stateを同一視しない
- snapshot生成時にauthorization / SafeModeを適用する

## 5. ContextProjectionRequest

正式Requestは旧Queryへのcompileを行わず、直接Query pipelineへ入る。

```ts
type ContextProjectionRequest = {
  requestId: string;
  actor: {
    actorRef: string;
    kind: "human" | "generative_ai" | "sei_cognition" | "external_system";
  };
  roles: Array<
    "observe" | "explore" | "compare" | "critique" |
    "synthesize" | "propose" | "review" | "approve" | "publish"
  >;
  interest: {
    focusRefs: string[];
    themes: string[];
    seek: QueryIntent[];
  };
  inquiry: string;
  permission: EffectivePermission;
  sourceScope: "network" | "working" | "consensus";
  desiredProjection: ProjectionForm[];
  diversityNeed: "default" | "increase";
  unresolvedNeed: "default" | "increase";
};
```

`actorRef` はaudit / collaboration traceに使えるが、同一scope・同一queryでの内容選択をactor identityだけで変えない。

## 6. EffectivePermission

Permissionはauthorization層が解決した結果だけを受ける。

```ts
type EffectivePermission = {
  resolutionSource: "server_resolved";
  readableScopes: string[];
  canSeeUnreviewed: boolean;
  canCreateProposal: boolean;
  canReview: boolean;
  canApprove: boolean;
  canPublish: boolean;
};
```

- requester自己申告をpermissionとして採用しない
- Roleからpermissionを推測しない
- Actor kindからpermissionを推測しない
- unreviewedは `canSeeUnreviewed` とtrusted SafeMode allowanceのAND条件
- permission shrinkはselection前に適用する

## 7. Query Intent

```ts
type QueryIntent =
  | "neighborhood"
  | "contrast"
  | "bridge"
  | "residual"
  | "unresolved"
  | "temporal"
  | "provenance"
  | "affinity"
  | "readout";
```

IntentとProjection Formを分離する。

```ts
type ProjectionForm =
  | "subgraph"
  | "path_list"
  | "card_stack"
  | "comparison_table"
  | "spatial_layout"
  | "timeline"
  | "provenance_matrix"
  | "compact_narrative";
```

## 8. SelectionResult

Selectionは表示とは独立した内容選択結果である。

最低限、次を返せる構造とする。

```ts
type SelectionResult = {
  intent: QueryIntent;
  selectedNodeRefs: string[];
  selectedEdgeRefs: string[];
  groups?: unknown[];
  residuals?: unknown[];
  paths?: unknown[];
  provenanceRefs?: string[];
  temporalContext?: unknown[];
  channelContributions?: unknown[];
  trace: {
    networkId: string;
    method: string;
  };
};
```

同一selectionはactor-facing Projectionが異なっても同一digestを持てること。

## 9. Query execution ladder

```text
D0 deterministic structure
  -> D1 lexical sparse
  -> D2 sparse associative cognition
  -> D3 static semantic
  -> D4 bounded local SLM
  -> D5 stronger model / human-led synthesis
```

上位tierは不足時だけ追加する。下位tierの根拠を捨てない。

- D0: graph / set / time / provenance / hold / critique / contradiction
- D1: lexical candidate expansion
- D2: SEI sparse associative substrateによる候補
- D3: 表層語彙を越えるsemantic candidate
- D4: bounded Working Setの説明・仮説化
- D5: 外部証拠、高新奇性、高リスク、広域統合

channel間の不一致は一つのscoreへ潰さない。

## 10. ContextProjection result

```ts
type ContextProjection = {
  requestId: string;
  actor: { actorRef: string; kind: string };
  selection: SelectionResult;
  selectionDigest: string;
  projections: unknown[];
  deferredProjectionForms: Array<{
    form: ProjectionForm;
    tier: string;
    reason: string;
  }>;
  trace: {
    networkId: string;
    sourceScope: string;
    reviewVisibility: "reviewed_only" | "include_unreviewed";
    selectionTier: string;
    sourceNetworkMutated: false;
  };
};
```

## 11. Non-ranking / proposal-only invariants

- score / confidence / importance / rankを内容価値へ昇格させない
- shortest pathを意味の強さと同一視しない
- no explicit pathを`unrelated`と断定しない
- residual / singleton / hold / minorityをnoiseとして消さない
- semantic proximityだけでisland / relation / consensusを確定しない
- Query / Projectionはcanonical networkを書き換えない
- generated narrativeは必ず元selectionへ戻れる
- AI / SEI proposalをhuman approvalと同一視しない

## 12. 実装順

最終ゴールに直接つながる順だけを採用する。

1. `QualitativeNetworkSnapshot` + `ContextProjectionRequest` をD0実装の直接I/Fにする。
2. 旧ContextQuery compilerを撤去する。
3. D0を正式snapshot上で固定する。
4. D1 lexicalを追加し、D0への独立増分を測る。
5. D2 SEI sparse associative adapterを追加する。
6. D3を意味近接が必要なIntentだけへ追加する。
7. D4 local SLMをbounded selection後だけへ接続する。
8. Human / Generative AI / SEI / External systemで同一selectionを異なるProjectionへ返す。
9. WorkingGraph / ConsensusGraphの永続実装を本契約へ直接合わせる。

旧Document契約への移行adapterはこの順序に含めない。
