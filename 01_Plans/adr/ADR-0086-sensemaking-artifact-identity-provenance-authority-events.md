# ADR-0086: sensemaking artifactのlogical identity・revision・provenance・authority eventを分離する

- Status: Accepted
- Date: 2026-09-18
- Deciders: Maintainer
- Scope: sensemaking semantic artifactのidentity、provenance、review、authority transition、Review Capsule、保持期間
- Related: `ADR-0070`, `ADR-0084`, `ADR-0085`
- Runtime impact: この変更では影響なし
- Schema impact: この変更では影響なし

## Context

ADR-0085では、Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Review / Decisionを、別の意味成果物として扱うことを決めた。あわせて、review、authority、ライフサイクル、visibility、provenanceを、semantic kindと直交させることも決めた。

次に必要なのは、その成果物を将来永続化するときの、identityとeventの境界である。

既存のcanvas revisionの設計（ADR-0070）は、次の重要な原則をすでに持つ。

- アプリケーションのrevision identityと、コンテンツダイジェストを分ける
- ダイジェストを、認可、真正性、人間によるレビューの証明に使わない
- AI提案を人間が採用しても、AI提案のrevision自体を人間が作成したものへ書き換えない
- AI実行の詳細は、`ai_generation_runs` などの別のレコードへ置き、revisionのメタデータへプロバイダ、モデル、プロンプトを複製しない

sensemaking artifactも同じ原則を引き継がないと、次のような問題が生じる。

- 同じ内容の別の仮説が、identity上で衝突する
- AI由来が人間由来へ洗い替えられる
- Reviewの対象が「現在の内容」へずれる

## Decision

### D1. 論理的なartifact IDと、厳密なrevision IDを分ける

各意味成果物は、少なくとも概念上、次を持つ。

```text
artifactId
  = 同じ意味成果物として追跡するlogical identity

revisionId
  = そのartifactの特定時点を指すimmutable identity

contentDigest
  = semantic payloadのintegrity / equality check
```

- `artifactId` は、内容から独立した不透明なIDとする。
- `revisionId` も不透明なIDとし、コンテンツダイジェストそのものをIDにはしない。
- `contentDigest` は、正規化したsemantic payloadのSHA-256などで計算できる。ただし、認可、真正性、review、authorityの証明には使わない。
- 同じpayloadのダイジェストを持つ別のartifactを、重複排除して一つの論理identityへまとめることはしない。
- 同じartifactの中でpayloadが同一でも、由来、reviewの対象、ブランチの意味が異なる場合は、別のrevisionを作り得る。何も変わらない更新を抑えるかどうかは、上位の操作のポリシーで決める。

### D2. semantic kindは、論理artifactの存続期間中は変更しない

`artifactId` には、作成時のsemantic kindを固定する。

```text
Observation o1
  --derivedFrom--> Evidence e1

Hypothesis h1
  --derivedFrom--> Observation o1
```

ObservationをHypothesisへ変える場合は、同じ `artifactId` のrevisionとして保存しない。新しいHypothesis artifactを作る。

これにより、元の認識の段階を、後から追える。

### D3. revisionは不変とし、修正は新しいrevisionで表現する

一度でも、Review、Authority transition、Decision、別のartifactのprovenanceから参照されたrevisionは、内容をその場で変更しない。

修正するときは、同じ `artifactId` の新しいrevisionを作り、親のrevisionを参照する。

将来マージが必要になる場合に備え、親のrevisionは1件に固定しない。ただし、マージの意味論は、本ADRでは実装契約にしない。

### D4. Review、Authority、Decisionは、厳密なrevisionを参照する

記録するのは「このHypothesisをreviewした」ではなく、次の内容である。

> artifact H の revision R をreviewした

参照は、概念上、少なくとも次を含む。

```text
artifactId
revisionId
contentDigest
```

`contentDigest` は照合用であり、revision identityの代わりではない。

対象のartifactに新しいrevisionが作られても、過去のReviewやAcceptanceを、新しいrevisionへ自動では引き継がない。

### D5. 最小限のprovenance envelopeを、artifact revisionへ結び付ける

各revisionには、後から由来をたどるためのprovenanceのエンベロープを持たせる。

概念上の最小の要素は次である。

- actorの種別
- 不透明なactor ref（分かる場合）
- methodの種別
- method ref（分かる場合）
- 実行または生成のrun ref（該当する場合）
- 入力のartifact revision ref
- 外部またはsourceへのref
- 入力のscope ref（該当する場合）
- 変換またはredactionのref（該当する場合）
- createdAt

AIやモデルによる生成の場合は、`runRef` を用いて、プロバイダ、モデル、ポリシー、入力IRなどの既存のrunレコードへ接続する。artifact revisionへは、詳細を複製しない。

人間による生成の場合も、生のメールアドレスなどをactor refへ直接入れず、既存の不透明なidentityの方針に従う。

旧形式のimportなどでactorが不明な場合は、推測して補わず、`actorKind=unknown` を許容する。

### D6. Reviewは追記専用のレコードとして扱い、Authority transitionと分ける

Reviewは、特定のrevisionに対する、検査、理解、異議の記録である。

Reviewのレコードには、概念上、次を持たせる。

- reviewId
- 厳密な対象revisionのref
- reviewer actor
- review purpose
- disposition
- 異議または保留のref
- createdAt
- supersedesReviewId（訂正時、任意）

Reviewのdispositionには、Authorityを意味する `accepted` や `consensus` を入れない。

例を挙げる。

- noted
- no_objection
- objected
- held
- changes_requested

Reviewを訂正する場合も、古いレコードは書き換えず、新しいReviewで置き換える。

### D7. Authorityは、追記専用のtransition eventとして扱う

Authorityの現在値だけを、artifactへ直接書き込むことは、正本としない。

概念上、Authority transition eventは次を持つ。

- eventId
- 厳密な対象revisionのref
- expectedFrom
- to
- scopeRef
- authorizedByのactorまたはポリシーのref
- 根拠となるReviewまたはDecisionのref
- policyRef（必要な場合）
- participant-setまたはconsensus-policyのref（Consensusの場合）
- createdAt

基本の状態は次のとおり。

```text
Working
Candidate
Accepted
Consensus
```

代表的な遷移を挙げる。

```text
Working   -> Candidate
Candidate -> Working      // withdraw
Candidate -> Accepted
Accepted  -> Candidate    // revoke acceptance
Accepted  -> Consensus
Consensus -> Accepted     // dissolve / narrow consensus
```

transitionは、Truthのtransitionではない。

同時更新で `expectedFrom` が一致しない場合は、安全側で拒否する。

現行のruntimeでは、AcceptedやConsensusへの、AIによる自動の昇格を許可しない。将来、ポリシーのactorを許可する場合は、ADR-0084 D6に従い、別のADRで権限モデルを採択する。

### D8. Consensusは、reviewの件数から自動で導かない

複数の `no_objection` のReviewがあっても、それだけではConsensusではない。

Consensus transitionには、少なくとも次を必要とする方向とする。

- consensus policy
- 対象のscope
- 参加者の集合、またはそのスナップショットへの参照
- authority event

マルチユーザーでの具体的なconsensus policyは、別の設計とする。

### D9. Review Capsuleを、二層のProjectionとする

Review Capsuleは、正本ではない。

将来のReview Surfaceでは、次の二層を分ける。

1. **Structural Capsule**
   - 正本のartifactとrevisionのrefから、決定論的に組み立てるインデックス
   - 主要なEvidence、反証、代替案、未解決点、provenance、要求されたauthority actionへの参照
2. **Narrative Explanation**
   - 人間またはAIが、Structural Capsuleを説明する、任意のProjection
   - 生成した主体とprovenanceを持つ
   - Structural Capsuleや元のartifactを置き換えない

AIの要約が変わっても、Reviewの対象と根拠の集合が同一かを、検証しやすくする。

### D10. 「主要な代替案」を保持する最低限の条件を定める

AI内部の全試行や、非公開のchain-of-thoughtは保存しない。

一方、次のいずれかに該当するartifact revisionは、少なくとも、上位の保持判断の候補として保護する。

- Candidateへ昇格した
- 人間またはAIによるReviewの対象になった
- Authority transitionまたはDecisionのbasisになった
- AcceptedまたはConsensusのartifactの、直接の `alternativeTo` である
- 後続のSynthesisまたはDecisionが、明示的に参照した
- 強いcontradictionまたはobjectionの対象になった
- 利用者またはポリシーによりpinされた

これらに該当せず、子孫、review、authority、decision、pinから到達できないWorkingだけの微小な試行は、保持ポリシーのもとでGCの対象にできる。

### D11. Review Capsuleは、保持のrootにしない

Review Capsuleは、再構築できるProjectionである。それ自体を、正本の保持のルートにはしない。

Capsuleが参照するartifact、Review、Authority event、Decisionのうち、保持の対象となるものが、ルートを形成する。

これにより、キャッシュされたCapsuleを削除して再生成しても、意味の履歴を失わない。

### D12. 現行モデルとの接続は、参照のブリッジとする

現時点では、新しいartifactの配列を `DocumentV1` へ追加しない。

将来接続するときは、既存の正本を、次のように参照できるようにする。

- `DocumentV1` / canvas revision: sourceまたはcontextのrevision ref
- `RoundSnapshotV1`: 不変のsource snapshotへのref
- `CardLineageEdgeV1`: 既存のラウンド間のlineage。汎用のartifact provenanceへは、暗黙に変換しない
- `ReviewAttribution`: 現行のdocument単位の人間によるレビューのメタデータ。汎用のReviewレコードの、互換Projectionの候補
- `ai_generation_runs`: AI provenanceのrunRef
- WorkingGraph / ConsensusGraph: artifactを表示して統合する、surfaceまたはprojection

RoundSnapshotとartifact revisionは、同一のものではない。artifactは、RoundSnapshotを入力またはsourceとして参照できる。

### D13. artifact revisionのDAGとcanvas revisionのDAGを、早い段階で同じテーブルへ統合しない

両者は共通の原則を持つが、粒度と意味が異なる。

- canvas revision = Document全体の編集世代
- semantic artifact revision = Observation / Hypothesisなどの意味成果物の改訂

共通のContent Storeやダイジェストのコーデックは、再利用できる可能性がある。ただし、同じテーブル、IDの名前空間、保持ポリシーを共有するかどうかは、別の判断とする。

## Conceptual contract sketch

実装契約ではない。境界を明確にするため、次を基線とする。

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

Reviewは、semantic artifactのkindではなく、独立したレコードとして永続化する方向とする。ADR-0085の概念の一覧にReviewが含まれることは維持する。ただし、実装上のストレージの分類としては、「content artifact」と「review event record」を分けてよい。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| **業務設計** | AIが広い探索を担っても、人間が、厳密なrevision、主要な根拠、反証、代替案を確認できる。Reviewと採用の操作も分けられる | データ: ReviewとAuthority transitionは、追記専用のレコードにする。機能: Review Capsuleは、元のrefへ戻れる |
| **データ設計** | artifactId、revisionId、ダイジェスト、provenance、review、authority eventを分離する | 業務: AI由来を人間由来へ書き換えない。機能: 古い対象や、expectedFromの不一致を、安全側で拒否する |
| **機能設計** | Structural CapsuleとNarrative Explanationを分離し、chain-of-thoughtを全部保存しなくても、reviewできるようにする | 業務: 人間は、全試行を読む必要がない。データ: Capsuleは、正本でも保持のルートでもない |

## Consequences

### Positive

- Reviewの対象が、「現在の最新版」へずれない。
- AI生成物を、人間由来へ洗い替えずに採用できる。
- 同一の内容でも、別の由来や論点を持つartifactを、誤って重複排除しない。
- review件数とConsensusを混同しない。
- chain-of-thoughtを全部保存しなくても、重要な代替案と反証を追跡できる。
- 既存のcanvas revision、InquiryJourney、AI runのレコードを再利用しつつ、意味成果物に固有のidentityを保てる。

### Costs / Open questions

- 具体的なIDの形式（UUIDv7など）は未決である。不透明な文字列の契約を先に置く。
- semantic payloadの正規化は、kindごとに定義が必要である。
- 汎用のRelation payloadの詳細は未決である。
- Review purposeとdispositionの閉じた範囲は、パイロットでの検証が必要である。
- Authority Scopeとconsensusの参加者スナップショットの具体的なスキーマは、未決である。
- artifact revisionの物理的なストレージ、DBのテーブル、インデックスは未決である。
- canvas revisionとartifact revisionで、Content Storeを共用できるかどうかは、ベンチマークが必要である。

## Non-goals

- 本ADRだけでは、`DocumentV1`、DBスキーマ、APIを変更しない。
- artifact IDをコンテンツダイジェストにしない。
- ダイジェストを、review、承認、真正性の証明にしない。
- AI runの詳細を、artifact revisionへ複製しない。
- Reviewのdispositionに、AcceptedやConsensusを混ぜない。
- Consensusを、reviewの多数決として自動で算出しない。
- Review Capsuleを正本にしない。
- 非公開のchain-of-thoughtを保存しない。

## Traceability

- `01_Plans/adr/ADR-0070-content-addressed-generation-dag-and-git-adapter.md`
- `01_Plans/adr/ADR-0085-sensemaking-semantic-artifacts-and-authority-axes.md`
- `02_Architecture/sensemaking_semantic_model.md`
- `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- `02_Architecture/schemas_review_attribution.md`
- `02_Architecture/inquiry_journey_model.html`
