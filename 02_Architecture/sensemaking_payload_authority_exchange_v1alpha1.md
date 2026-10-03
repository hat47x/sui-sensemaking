# Sensemaking Payload / Authority / Exchange Contract v1alpha1

- 状態: **規範的な設計契約 / L0 計画中**
- 日付: 2026-09-18
- 親: `ADR-0085`, `ADR-0086`, `ADR-0087`, `ADR-0088`
- 永続化の候補: `02_Architecture/sensemaking_artifact_persistence_candidate.md`
- ランタイム実装: **未実装**
- 永続化実装: **未実装**
- 現行の `DocumentV1`: **変更なし**

## 1. 目的

この契約は、`sensemaking_artifact_contract_v1alpha1.md` が定義した成果物の識別、リビジョン、来歴、Review、Authorityイベントに対して、次の項目を追加で定義します。

- kindごとの意味ペイロード
- 中核（core）Relationと拡張（extension）Relation
- Authority Scope
- Consensusの参加者スナップショット
- 成果物の交換バンドル
- SUI Information Networkへのマテリアライズ

この契約は、物理DBスキーマではありません。

---

## 2. 共通参照型

### 2.1 SemanticTargetRef

意味成果物の対象には、成果物だけでなく、元の出典や既存のネットワークエンティティも指定できます。

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

- `artifact_revision` は、厳密なリビジョンを指す。
- `source` と `network_entity` の参照は、不透明にする。
- 未知の参照kindを、勝手に成果物へ推測して変換しない。
- 許可や可視性を確認する前に、参照先の本文を展開しない。

---

## 3. kindごとのペイロード

### 3.1 Evidence

Evidenceは、sensemakingの根拠として参照する内容、または出典の区間（source segment）を表します。

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

#### 不変条件

- `source_segment` は、出典の本文を複製することを要求しない。
- ロケータを取得できないとき、AIが推測して補わない。
- `sourceVersionDigest` は出典のバージョンの整合を確認するための値であり、Truthの証明ではない。
- Evidenceの本文の要約で、元のEvidenceを上書きしない。要約は、ObservationやSynthesisなどの別の成果物にする。

---

### 3.2 Observation

```ts
export type ObservationPayloadV1Alpha1 = {
  schema: "sui.semantic-payload/observation/v1alpha1";
  statement: string;
  about: SemanticTargetRefV1Alpha1[];
};
```

#### 不変条件

- Observationの認識主体とMethodは、ペイロードではなく来歴エンベロープに置く。
- confidence、importance、rankを必須フィールドにしない。
- 同じEvidenceに、複数のObservationが存在してよい。
- statementが同じでも、actor、method、入力が異なれば、同じ成果物とは自動的に判定しない。

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

拡張predicateの例は次のとおりです。

```text
domain:requirements/depends_on
method:kj/close_affinity
experiment:csw/symbolic_resonance
```

#### 参加者

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

#### 中核predicateのロール検証

| Predicate | 必須ロール | 備考 |
|---|---|---|
| `derived_from` | `derived`, `source` | derivedは成果物リビジョンを推奨 |
| `grounded_by` | `claim`, `ground` | groundはEvidenceなど |
| `supports` | `supporter`, `target` | supportはTruthの確定ではない |
| `contradicts` | `contradictor`, `target` | 矛盾そのものもReviewできる |
| `alternative_to` | `alternative` 2件以上 | 対称な関係として扱える |
| `synthesizes` | `synthesis`, `component` 1件以上 | Synthesisへ構成要素を接続する |
| `basis_for` | `basis`, `target` | Decisionなどの根拠 |
| `supersedes` | `newer`, `older` | 削除を意味しない |
| `contains` | `container`, `member` 1件以上 | 所属関係 |
| `precedes` | `earlier`, `later` | 因果を意味しない |

#### 拡張predicateの不変条件

登録済みのポリシーがない拡張Relationは、次の用途に使いません。

- Authorityの昇格
- 許可
- Consensus
- 保持ルート
- TruthやImportanceの推論

未知の拡張predicateは、不透明なRelationとして保持できます。

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

#### 不変条件

- EvidenceやObservationから、Hypothesisへその場で変換しない。
- `applicabilityRefs` は、Authority Scopeではない。
- supports、contradicts、grounded_byは、Relationの成果物で表す。
- プロバイダが自己申告したconfidenceを、HypothesisのTruthスコアにしない。

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

#### 不変条件

- `causal_candidate` は、因果が確定したことを意味しない。
- memberやrelationの順序に意味があるときは、kindごとの検証で保持する。
- Island、Cluster、空間的なCanvasは、Structureの投影になり得る。ただし自動変換はしない。
- 同じmember集合から、複数のStructureを保持できる。

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

#### 不変条件

- Synthesisは、最終結論を意味しない。
- 主要な反証や代替案を、Relationやcomponent refsから辿れる必要がある。
- `unresolvedRefs` を空にするために、未解決の項目を削除しない。
- 競合する複数のSynthesisを保持できる。

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

#### 不変条件

- Decisionは、Authority遷移でもExecutionでもない。
- `decisionContextRef` はDecisionが成立した文脈であり、Authority Scopeの参照と同じ値である必要はない。
- 外部のActionへ進むときは、別の認可と実行の契約が必要になる。
- AIがDecisionのペイロードを生成しても、人間のDecision Authorityを持ったことにはならない。

---

## 4. 意味ペイロードのディスパッチ

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

リビジョンエンベロープの `semanticKind` とペイロードのスキーマは、必ず一致させます。

例は次のとおりです。

```text
semanticKind = "hypothesis"
payload.schema = "sui.semantic-payload/hypothesis/v1alpha1"
```

一致しないときは、安全側で拒否します。

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

### 5.2 不変条件

- Authority Scopeは不変にする。
- `scopeRef` は不透明にする。
- `parentScopeRef` は、Authorityの継承を意味しない。
- 循環は禁止する。
- スコープが異なれば、同じリビジョンでも別のAuthority状態を持ち得る。
- スコープは、許可、ACL、可視性ではない。
- `external_context` は、外部の制度、顧客、会議などを参照するための場所取りである。外部システムのAuthorityをSUIが保証することは意味しない。

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

一つのAccepted状態を、すべてのスコープへ伝播させません。

---

## 6. Consensusの参加者スナップショット

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

### 6.2 不変条件

- スナップショットは不変にする。
- actorRefは不透明にする。
- 表示名やメールアドレスなどの個人情報を、必須にしない。
- actorRefの重複は禁止する。
- スナップショットの生成後に組織のメンバーシップが変わっても、過去のスナップショットは変更しない。
- `membershipSourceRef` がないときは、存在しないメンバーシップの出典を推測しない。
- 現行のランタイムでは、AIやsystemだけの参加者集合を、Consensus Authorityの根拠にしない。

---

## 7. Consensus Policyの境界

v1alpha1では、具体的な投票の計算を固定しません。

Authority遷移の `policyRef` は、次のいずれかの手続きへ解決できなければならない、という方向にします。

- 明示された全会一致
- 明示された定足数
- 正式に委任された手続き
- ドメイン固有の明示された手続き

ただし、

```text
ConsensusPolicy
  != ParticipantSet
  != Review count
  != model confidence
```

です。

### 7.1 禁止事項

- `no_objection` のReviewがN件あるだけで、Consensusへ昇格する
- AIのconfidenceの閾値を、Consensusの判定に利用する
- 参加者集合の外にいるactorのReviewを、黙って集計する
- 現在のメンバーシップを使って、過去の参加者集合を再計算する
- 非序列化の原則と無関係に、多数決や定足数を自動的に導入する

具体的なポリシーは、複数ユーザー機能を設計するときに、別のADRで採択します。

---

## 8. 成果物の交換バンドル

### 8.1 交換とバックアップを分離する

成果物の交換バンドルは、別のworkspace、ネットワーク、システムへ意味成果物を移送し、共有するための契約です。

運用上のバックアップや災害復旧は、別の契約とします。

```text
Exchange
  = source authorityをlocal authorityへ継承しない

Backup / Restore
  = 同一authority domainの復元
  = 別の運用・真正性契約
```

この二つを、一つのimport処理へ統合しません。

### 8.2 マニフェスト

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

### 8.3 バンドル

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

実装するときは、リビジョンとペイロードを対応づけるキーを明示的に定義します。v1alpha1では、配列の並び順に意味を持たせません。

### 8.4 クロージャの規則

ルートから必要な参照を辿ったとき、各参照は次のどちらかでなければなりません。

- バンドルの中に存在する
- `externalDependencies` に明示されている

黙って宙に浮いた参照は禁止します。

### 8.5 SafeMode

外部共有用の交換バンドルでは、`safeModeApplied=true` を必須とします。

- 元の成果物とネットワークは変更しない。
- 派生したバンドルの側で、墨消し、除外、再構築を行う。
- 墨消しの後に、ペイロードのダイジェストを再計算する。
- 出典側のReviewやAuthorityの状態を、墨消しによって人間承認済みへ昇格させない。
- 許可がなくて読めない参照は、バンドルへ含めない。
- 許可による除外でクロージャを満たせないときは、外部依存として露出してよいかをポリシーで判断する。不可なら、エクスポートを安全側で拒否する。

### 8.6 importしたAuthority

import先では、

```text
SourceAuthorityAssertion
  != Local AuthorityTransitionEvent
```

です。

importした成果物リビジョンのローカルのAuthority既定値は、`working` とする方向を採ります。

利用者が明示的にReviewの対象として提示するときは、ローカルの遷移で `candidate` へ進められます。

出典側のAcceptedやConsensusを、ローカルのAcceptedやConsensusへ直接復元するのは、交換ではなくバックアップとリストアの領域です。

### 8.7 importしたReview

```text
SourceReviewAssertion(human)
  != local human Review
  != local human_reviewed
```

出典側のhuman Reviewは、来歴として表示できます。ただし、ローカルのレビュー担当者による新しいReviewを要求します。

### 8.8 IDの衝突

import時に、同じ `artifactId / revisionId` が既に存在する場合は、次の4項目を検証します。

1. semantic kind
2. コンテンツのダイジェスト
3. 親リビジョンの参照
4. 来歴の同一性

完全に整合する場合に限り、既存のリビジョンへ解決できます。

一致しない場合は、安全側で拒否します。

ローカルIDを再発行する方式を採るときは、

```text
origin network
origin artifact ID
origin revision ID
local artifact ID
local revision ID
```

の対応を失わないようにします。

---

## 9. Information Networkへのマテリアライズ

### 9.1 責務

意味成果物の永続化は、意味成果物の基準データを保持します。

SUI Information Networkは、その情報を、クエリできる長期ネットワークへマテリアライズする目標アーキテクチャです。

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

### 9.2 マテリアライズの原則

- 成果物リビジョンは、ネットワークのノードになり得る。
- Relationの成果物は、ネットワークのエッジやハイパーエッジの投影になり得る。
- Authority Scopeごとの状態を、ノードプロパティの単一の `status` にまとめない。
- Review記録は、イベントや来歴の投影になり得る。
- WorkingとConsensusのプレーンは、Authorityとactorを考慮した投影であり、semantic kindではない。
- 許可とSafeModeは、マテリアライズ時に適用する。
- クエリ結果やContext Projectionを、基準となる成果物へ逆書き込みしない。

### 9.3 QualitativeNetworkSnapshotとの関係

既存の `QualitativeNetworkSnapshot` は、クエリ用の読み取りモデルとして維持します。

将来、意味成果物を入力元にする場合でも、次の点を優先します。

- スナップショットのフィールドを、成果物DBのスキーマに合わせて膨らませない。
- クエリが必要とする形へ投影する。
- 厳密な成果物リビジョンへ戻れる、安定した参照を持つ。
- 未知のRelationや、欠けた来歴を破棄しない。

---

## 10. 物理永続化の論理要件

物理DBの設計は別のADRで扱います。ただし少なくとも、次の論理レコードの分類を、それぞれ独立に永続化できる必要があります。

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

### 10.1 現在状態のキャッシュ

性能のために、次のものをキャッシュしてよいものとします。

- 最新のリビジョン
- スコープごとの現在のAuthority状態
- マテリアライズしたネットワークのノード

ただし、キャッシュだけを基準データにはしません。

Authorityの現在状態は、遷移イベント列から再構築できなければなりません。

### 10.2 ストレージエンジンは未決定

この契約は、次のどれを最終的に採用するかを決めません。

- PostgreSQLなどのRDB
- JSON集約
- グラフDB
- オブジェクトストア
- 既存のContent Store

次のADRで、代表的なフィクスチャと、クエリ、GC、import/exportのワークロードをもとに比較します。

---

## 11. 検証マトリクス

| ケース | 期待結果 |
|---|---|
| ObservationとHypothesisのstatementが同文 | 別のkind、別の成果物として保持できる |
| Evidenceが出典へのポインタだけ | 有効。出典の本文は複製不要 |
| 未知の拡張Relation | 保持できる。Authorityや保持への副作用はない |
| 中核の `contradicts` でロールが欠落 | 拒否する |
| inquiryスコープでAccepted、networkスコープでWorking | 有効 |
| 親スコープがAccepted | 子スコープへ自動的に継承しない |
| 参加者のメンバーシップが変更 | 過去のスナップショットは変わらない |
| human Review 5件と参加者集合 | Consensusを自動生成しない |
| 出典側でAcceptedの成果物を交換importする | ローカルではWorking。出典のアサーションを保持する |
| 出典側のhuman Reviewをimportする | ローカルのhuman_reviewedを付与しない |
| バンドル内の参照が欠落し、外部依存にも未記載 | 拒否する |
| IDが同一で、ダイジェストが不一致 | 衝突として、安全側で拒否する |
| SafeModeで必要な参照が読めない | ポリシーに従い、外部依存にするか、エクスポートを拒否する |
| Context Projectionを生成 | 基準となる成果物は変わらない |
| 現在のAuthorityキャッシュが消失 | 遷移イベントから再構築できる |

---

## 12. 昇格条件

ランタイムや永続化へ昇格する前に、次を検証します。

1. 各kindのペイロードについて、正規JSONとダイジェストの往復。
2. 中核Relationのロール検証。
3. 拡張Relationの、未知のものの往復。
4. 同じリビジョンが、複数スコープのAuthority状態を持つフィクスチャ。
5. 参加者スナップショットが、メンバーシップの変更に耐えること。
6. 出典側のAcceptedやConsensusのimportが、ローカルのAuthorityへ漏れないこと。
7. 出典側のhuman Reviewのimportが、`human_reviewed` へ漏れないこと。
8. 自己完結したバンドルと、外部依存つきバンドルの検証。
9. SafeModeの適用後に、クロージャを検証すること。
10. 成果物が100件、1000件、10000件のときの、Information NetworkのマテリアライズとReview Capsuleの再構築の計測。
11. 現在状態のキャッシュを削除して、イベント列からAuthorityを復元すること。
12. 保持のGCが、出典のアサーション、Review、Authorityの根拠を壊さないこと。
13. 物理永続化の候補を、RDB、集約、グラフの観点で比較すること。
14. 成果物の交換と、バックアップとリストアを、別の入口として実装できることの確認。

---

## 13. 未決事項

ADR-0088で、物理永続化の第一候補を、RDBのメタデータとイベント、Content Storeのペイロード、マテリアライズしたネットワークとしました。具体的なポータブルスキーマ、インデックス、フィクスチャ、ベンチマークは、`SENSEMAKING-PERSIST-01` で検証します。

引き続き未決なのは、次の項目です。

- IDの具体的な生成形式
- Evidenceの出典ロケータの共通契約
- kindごとのペイロードのUI編集画面
- 拡張Relationのレジストリ形式
- Authority Scopeの親の利用方針
- Consensus Policyの具体的なスキーマ
- 成果物バンドルの署名と真正性
- 物理テーブル、インデックス、パーティションの最終形
- オブジェクトとBLOBの重複排除のベンチマーク結果
- 成果物交換のimport UI
- Review CapsuleのUI
