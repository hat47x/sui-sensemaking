# ADR-0086: sensemaking artifactのlogical identity・revision・provenance・authority eventを分離する

- Status: Accepted
- Date: 2026-09-18
- Deciders: Maintainer
- Scope: sensemaking semantic artifact identity, provenance, review, authority transition, Review Capsule, retention
- Related: `ADR-0070`, `ADR-0084`, `ADR-0085`
- Runtime impact: None in this change
- Schema impact: None in this change

## Context

ADR-0085では、Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Review / Decisionを別の意味成果物として扱い、review / authority / lifecycle / visibility / provenanceをsemantic kindと直交させることを決めた。

次に必要なのは、その成果物を将来永続化するときのidentityとevent境界である。

既存のcanvas revision設計（ADR-0070）は、次の重要な原則をすでに持つ。

- application revision identityとcontent digestを分ける
- digestを認可・真正性・human review証明に使わない
- AI proposalを人間が採用しても、AI proposal revisionそのものをhuman-authoredへ書き換えない
- AI実行詳細は`ai_generation_runs`等の別recordへ置き、revision metadataへprovider/model/promptを複製しない

sensemaking artifactも同じ原則を継承しないと、同一内容の別仮説がidentity上で衝突する、AI由来が人間由来へ洗い替えられる、Review対象が「現在の内容」にずれる、といった問題が生じる。

## Decision

### D1. logical artifact IDとexact revision IDを分離する

各意味成果物は、少なくとも概念上次を持つ。

```text
artifactId
  = 同じ意味成果物として追跡するlogical identity

revisionId
  = そのartifactの特定時点を指すimmutable identity

contentDigest
  = semantic payloadのintegrity / equality check
```

- `artifactId`は内容から独立したopaque IDとする。
- `revisionId`もopaque IDとし、content digestそのものをIDにはしない。
- `contentDigest`はcanonicalized semantic payloadのSHA-256等で計算できるが、認可、真正性、review、authorityの証明には使わない。
- 同じpayload digestを持つ別artifactをdeduplicateして一つのlogical identityへ潰さない。
- 同じartifact内でpayloadが同一でも、由来・review対象・branch意味が異なる場合は別revisionを作り得る。no-op抑制は上位operation policyで決める。

### D2. semantic kindはlogical artifactの生存期間中に変更しない

`artifactId`には作成時のsemantic kindを固定する。

```text
Observation o1
  --derivedFrom--> Evidence e1

Hypothesis h1
  --derivedFrom--> Observation o1
```

ObservationをHypothesisへ変える場合、同じ`artifactId`のrevisionとして保存しない。新しいHypothesis artifactを作る。

これにより、元の認識段階を後から追える。

### D3. revisionはimmutableとし、修正は新revisionで表現する

一度Review、Authority transition、Decision、別artifactのprovenanceから参照されたrevisionは内容をin-place変更しない。

修正時は同じ`artifactId`の新revisionを作り、親revisionを参照する。

将来mergeが必要な場合に備え、parent revisionは1件に固定しない。ただしmerge semanticsは本ADRでは実装契約化しない。

### D4. Review / Authority / Decisionはexact revisionを参照する

「このHypothesisをreviewした」のではなく、

> artifact H の revision R をreviewした

と記録する。

参照は概念上、少なくとも次を含む。

```text
artifactId
revisionId
contentDigest
```

`contentDigest`はcross-check用であり、revision identityの代替ではない。

対象artifactに新revisionが作られても、過去のReviewやAcceptanceを新revisionへ自動継承しない。

### D5. minimal provenance envelopeをartifact revisionへ結び付ける

各revisionには、後から由来を辿るためのprovenance envelopeを持たせる。

概念上の最小要素は次である。

- actor kind
- opaque actor ref（分かる場合）
- method kind
- method ref（分かる場合）
- execution / generation run ref（該当する場合）
- input artifact revision refs
- external / source refs
- input scope ref（該当する場合）
- transformation / redaction refs（該当する場合）
- createdAt

AI / model生成の場合、`runRef`を用いてprovider / model / policy / input IR等の既存run recordへ接続し、artifact revisionへ詳細を複製しない。

人間生成の場合も、生メールアドレス等をactor refへ直接入れず、既存のopaque identity方針へ従う。

legacy import等でactor不明な場合は、推測して補わず`actorKind=unknown`を許容する。

### D6. Reviewをappend-only recordとして扱い、Authority transitionと分離する

Reviewは特定revisionに対する検査・理解・異議の記録である。

Review recordには概念上、

- reviewId
- exact target revision ref
- reviewer actor
- review purpose
- disposition
- objection / hold refs
- createdAt
- supersedesReviewId（訂正時、任意）

を持たせる。

Review dispositionにはAuthorityを意味する`accepted` / `consensus`を入れない。

例:

- noted
- no_objection
- objected
- held
- changes_requested

Reviewを訂正する場合も旧recordを書き換えず、新Reviewでsupersedeする。

### D7. Authorityはappend-only transition eventとして扱う

Authorityの現在値だけをartifactへ直接書き込むことを正本にしない。

概念上、Authority transition eventは次を持つ。

- eventId
- exact target revision ref
- expectedFrom
- to
- scopeRef
- authorizedBy actor / policy ref
- basis Review / Decision refs
- policyRef（必要な場合）
- participant-set / consensus-policy ref（Consensus時）
- createdAt

基本state:

```text
Working
Candidate
Accepted
Consensus
```

代表的な遷移:

```text
Working   -> Candidate
Candidate -> Working      // withdraw
Candidate -> Accepted
Accepted  -> Candidate    // revoke acceptance
Accepted  -> Consensus
Consensus -> Accepted     // dissolve / narrow consensus
```

transitionはTruth transitionではない。

同時更新では`expectedFrom`不一致をfail closedにする。

現行runtimeではAccepted / ConsensusへのAI自動昇格を許可しない。将来policy actorを許可する場合はADR-0084 D6に従い別ADRで権限モデルを採択する。

### D8. Consensusはreview件数から自動導出しない

複数の`no_objection` Reviewが存在しても、それだけではConsensusではない。

Consensus transitionには、少なくとも、

- consensus policy
- 対象scope
- 参加者集合またはそのsnapshot参照
- authority event

を必要とする方向とする。

具体的なmulti-user consensus policyは別設計とする。

### D9. Review Capsuleを二層Projectionとする

Review Capsuleは正本ではない。

将来のReview Surfaceでは、次の二層を分ける。

1. **Structural Capsule**
   - canonical artifact / revision refsから決定論的に組み立てるindex
   - 主要Evidence、反証、代替案、未解決点、provenance、requested authority actionへの参照
2. **Narrative Explanation**
   - 人間またはAIがStructural Capsuleを説明する任意Projection
   - 生成主体とprovenanceを持つ
   - Structural Capsuleや元artifactを置換しない

AI要約が変わってもReview対象と根拠集合が同一かを検証しやすくする。

### D10. 「主要代替案」を保持する最低条件を定める

AI内部の全trialやprivate chain-of-thoughtは保存しない。

一方、次のいずれかに該当するartifact revisionは、少なくとも上位retention判断の候補として保護する。

- Candidateへ昇格した
- 人間またはAI Reviewの対象になった
- Authority transition / Decisionのbasisになった
- Accepted / Consensus artifactの直接の`alternativeTo`である
- 後続のSynthesis / Decisionが明示的に参照した
- 強いcontradiction / objectionの対象になった
- 利用者またはpolicyによりpinされた

これらに該当せず、子孫・review・authority・decision・pinから到達不能なWorking-only microtrialは、retention policyのもとでGC可能とする。

### D11. Review Capsuleはretention rootにしない

Review Capsuleは再構築可能Projectionなので、それ自体をcanonical retention rootにしない。

Capsuleが参照するartifact、Review、Authority event、Decisionのうち保持対象となるものがrootを形成する。

これにより、cacheされたCapsuleを削除・再生成しても意味履歴を失わない。

### D12. 現行モデルとの接続はreference bridgeとする

現時点では新artifact配列を`DocumentV1`へ追加しない。

将来接続するときは、既存正本を次のように参照できるようにする。

- `DocumentV1` / canvas revision: source / context revision ref
- `RoundSnapshotV1`: immutable source snapshot ref
- `CardLineageEdgeV1`: 既存ラウンド間lineage。汎用artifact provenanceへ暗黙変換しない
- `ReviewAttribution`: 現行document-level human review metadata。汎用Review recordの互換Projection候補
- `ai_generation_runs`: AI provenanceのrunRef
- WorkingGraph / ConsensusGraph: artifactを表示・統合するsurface / projection

RoundSnapshotとartifact revisionは同一物ではない。artifactはRoundSnapshotをinput/sourceとして参照できる。

### D13. artifact revision DAGとcanvas revision DAGを同一tableへ早期統合しない

両者は共通原則を持つが、粒度と意味が異なる。

- canvas revision = Document全体の編集世代
- semantic artifact revision = Observation / Hypothesis等の意味成果物の改訂

共通Content Storeやdigest codecを再利用できる可能性はあるが、同じtable / ID namespace / retention policyを共有することは別判断とする。

## Conceptual contract sketch

実装契約ではないが、境界を明確にするため次を基線とする。

```ts
type SemanticKind =
  | "evidence"
  | "observation"
  | "relation"
  | "hypothesis"
  | "structure"
  | "synthesis"
  | "decision";

type ArtifactRevisionRef = {
  artifactId: string;
  revisionId: string;
  contentDigest: `sha256:${string}`;
};

type ProvenanceEnvelopeV1Alpha1 = {
  actor: {
    kind: "human" | "ai" | "system" | "import" | "unknown";
    ref?: string;
  };
  method: {
    kind: "manual" | "deterministic" | "model" | "external" | "unknown";
    ref?: string;
  };
  runRef?: string;
  inputArtifactRefs: ArtifactRevisionRef[];
  sourceRefs: string[];
  inputScopeRef?: string;
  transformationRefs?: string[];
  createdAt: string;
};

type SemanticArtifactRevisionV1Alpha1 = {
  artifactId: string;
  revisionId: string;
  semanticKind: SemanticKind;
  parentRevisionIds: string[];
  contentDigest: `sha256:${string}`;
  provenance: ProvenanceEnvelopeV1Alpha1;
  lifecycle: "active" | "held" | "rejected" | "superseded" | "archived";
};
```

Reviewはsemantic artifactのkindではなく独立recordとして永続化する方向とする。ADR-0085の概念一覧にReviewが含まれることは維持するが、実装上のstorage classificationとしては「content artifact」と「review event record」を分けてよい。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| **業務設計** | AIが広い探索を担っても、人間がexact revision・主要根拠・反証・代替案を確認し、Reviewと採用操作を分けられる | データ: Review / Authority transitionはappend-only record。機能: Review Capsuleは元refへ戻れる |
| **データ設計** | artifactId / revisionId / digest / provenance / review / authority eventを分離する | 業務: AI由来を人間由来へ書換えない。機能: stale targetやexpectedFrom不一致をfail closed |
| **機能設計** | Structural CapsuleとNarrative Explanationを分離し、全CoT保存なしでreview可能にする | 業務: 人間は全trialを読む必要がない。データ: Capsuleはcanonical sourceでもretention rootでもない |

## Consequences

### Positive

- Review対象が「現在の最新版」にずれない。
- AI生成物を人間由来へ洗い替えずに採用できる。
- 同一内容でも別の由来・論点を持つartifactを誤deduplicateしない。
- review件数とConsensusを混同しない。
- 全CoTを保存せずに、重要な代替案と反証を追跡できる。
- 既存canvas revision / InquiryJourney / AI run recordを再利用しつつ、意味成果物固有のidentityを保てる。

### Costs / Open questions

- 具体的ID format（UUIDv7等）は未決。opaque string contractを先行する。
- semantic payload canonicalizationはkindごとに定義が必要。
- generic Relation payloadの詳細は未決。
- Review purpose / dispositionのclosed-world範囲はpilotで検証が必要。
- Authority Scope / consensus participant snapshotの具体schemaは未決。
- artifact revisionの物理storage / DB table / indexは未決。
- canvas revisionとartifact revisionのContent Store共用可否はbenchmarkが必要。

## Non-goals

- 本ADRだけで`DocumentV1`、DB schema、APIを変更しない。
- artifact IDをcontent digestにしない。
- digestをreview・approval・authenticityの証明にしない。
- AI run詳細をartifact revisionへ複製しない。
- Review dispositionにAccepted / Consensusを混ぜない。
- Consensusをreview多数決として自動算出しない。
- Review Capsuleを正本化しない。
- private chain-of-thoughtを保存しない。

## Traceability

- `01_Plans/adr/ADR-0070-content-addressed-generation-dag-and-git-adapter.md`
- `01_Plans/adr/ADR-0085-sensemaking-semantic-artifacts-and-authority-axes.md`
- `02_Architecture/sensemaking_semantic_model.md`
- `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- `02_Architecture/schemas_review_attribution.md`
- `02_Architecture/inquiry_journey_model.html`
