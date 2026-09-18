# ADR-0087: semantic payload・Authority Scope・Consensus・交換境界を定義する

- Status: Accepted
- Date: 2026-09-18
- Deciders: Maintainer
- Scope: kind-specific semantic payload, Relation vocabulary, Authority Scope, Consensus participant snapshot, artifact import/export
- Related: `ADR-0084`, `ADR-0085`, `ADR-0086`
- Runtime impact: None in this change
- Schema impact: None in this change

## Context

ADR-0085 / ADR-0086により、SUI Sensemakingの意味成果物について、

- semantic kind
- logical artifact identity
- exact revision identity
- provenance
- Review
- Authority transition
- retention

の基本境界が定まった。

一方、実装可能な契約へ進むには、次の未決事項を整理する必要がある。

1. Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Decisionのpayloadをどこまで共通化するか。
2. Relation vocabularyをclosed enumにするか、自由語彙を許容するか。
3. Accepted / Consensusが「どの範囲で有効か」を示すAuthority Scopeをどう表すか。
4. Consensus形成時の参加者集合を、後から再現可能かつPIIを増やさずどう固定するか。
5. artifactをexport / importしたとき、source側のReview / Accepted / Consensusをlocal authorityへどう扱うか。
6. SUI Information Network、WorkingGraph / ConsensusGraphとの関係をどう保つか。

特に、exportされたAccepted artifactを別workspaceへimportしただけでlocal Acceptedへすると、権限境界を越えたauthority launderingが生じる。

同様に、semantic payloadを一つの汎用`text + refs`へ潰すと、EvidenceとHypothesisの意味差がpayload層で消える。一方、各kindへ過剰に詳細なschemaを早期固定すると、KJ法以外のAI-native sensemakingや将来の認知Providerを不必要に制限する。

## Decision

### D1. 共通envelopeとkind-specific payloadを分離する

共通envelopeはidentity、revision、provenance、lifecycleだけを扱う。

意味本文はsemantic kindごとのpayload contractへ分ける。

```text
SemanticArtifactRevision
  ├─ identity / revision
  ├─ provenance
  ├─ lifecycle
  └─ payloadDigest
          │
          ▼
      kind-specific payload
```

全kindへ共通の巨大optional objectを作らない。

### D2. payloadは「意味の最小骨格」だけを固定する

v1alpha1では、各kindのpayloadは次の役割だけを固定する。

- **Evidence**: 根拠として参照する内容またはsource segmentへのpointer
- **Observation**: 何を認識したかというstatementと対象
- **Relation**: predicateとparticipants
- **Hypothesis**: 反証可能なstatementと対象
- **Structure**: 構造種別とmember / relation refs
- **Synthesis**: 統合された理解のbodyと構成要素refs
- **Decision**: 選択・保留・追加調査等のdecision statementとbasis / alternative refs

confidence、importance、rank、truth scoreを共通payload fieldにしない。

### D3. Evidence payloadはsourceの複製を要求しない

Evidenceはinline textだけに限定しない。

```text
Evidence payload
  = inline representation
    OR source segment pointer
    OR both
```

大容量文書・画像・音声・外部recordをartifact本文へ複製しない。

source pointerだけの場合でも、後から同じsegmentへ戻れるlocator / digest等をsource contract側で持てるようにする。

Evidenceであることはsourceが正しいことを意味しない。

### D4. Observation / Hypothesisはstatementを共有してもkindを統合しない

ObservationとHypothesisはどちらも自然言語statementを持ち得るが、同じ型へ統合しない。

- Observation = 「この主体／認知系がこう認識した」
- Hypothesis = 「この材料からこのように解釈できる」

同じ文面でもsemantic kindが異なれば別artifactである。

### D5. Relationは「closed core + namespaced extension」とする

Relation predicateを完全closed enumにも完全自由文字列にもしない。

SUIがsystem behaviorへ利用するcore predicateはclosed vocabularyとする。

初期core:

- `sui.core/derived_from`
- `sui.core/grounded_by`
- `sui.core/supports`
- `sui.core/contradicts`
- `sui.core/alternative_to`
- `sui.core/synthesizes`
- `sui.core/basis_for`
- `sui.core/supersedes`
- `sui.core/contains`
- `sui.core/precedes`

domain-specific / experimental relationはnamespaced predicateとして許容する。

例:

```text
domain:requirements/depends_on
method:kj/close_affinity
experiment:csw/symbolic_resonance
```

extension predicateは、登録されたpolicyがない限り、

- authority transition
- retention root
- automatic truth inference
- consensus
- permission

を発火させてはならない。

未知extension relationは破棄せず、表示可能なopaque relationとして保持する。

### D6. Relationはbinary edgeへ限定しない

将来の因果構造、複数Evidenceによる共同支持、n-aryな比較等を考慮し、Relation payloadはparticipants配列を持つ。

participantはrole + exact artifact revision refで表現する。

```text
predicate = supports
participants:
  - role=source
  - role=target
```

core predicateごとのrole制約は別validation tableで固定する。

現行`Edge`は引き続きcanvas projectionであり、このRelation payloadへ自動migrationしない。

### D7. Authority Scopeはpermission / visibilityから独立したimmutable recordとする

`scopeRef`はopaque stringのまま終わらせず、将来次のようなimmutable recordへ解決できることを要求する。

Authority Scopeは、

> **このartifact revisionを、どの意味上の文脈でAccepted / Consensusとして扱うか**

を定義する。

初期scope kind:

- `workspace`
- `inquiry`
- `network`
- `decision_context`
- `external_context`

scope recordは少なくとも、

- scopeRef
- kind
- containerRef
- purposeRef（任意）
- parentScopeRef（任意）
- createdAt

を持つ。

Authority ScopeはACLではない。

```text
authority scope != readable scope
authority scope != visibility
authority scope != tenant boundary
```

「見えるからAccepted」「公開したからConsensus」と扱わない。

### D8. scope継承は自動にしない

parent scopeでAcceptedだからchild / sibling / external scopeでもAccepted、という暗黙継承をしない。

scope間でauthorityを引き継ぐ場合は、新しいAuthority transitionを作り、source authority eventをbasisとして参照する。

これにより、

> inquiry内ではAcceptedだが、組織全体の正式見解ではない

という状態を表現できる。

### D9. Consensus participant setはimmutable snapshotとして固定する

Consensus transitionでは、その時点の参加者集合を後から再現できる必要がある。

`participantSetRef`はimmutable snapshot recordへ解決する。

参加者snapshotは、

- participantSetRef
- opaque participant refs
- participant kind
- eligibility / role ref（必要な場合）
- source membership snapshot ref（必要な場合）
- createdAt

を持つ。

表示名・メールアドレス等のPIIをsnapshotへ必須化しない。

組織membershipが後から変わっても、過去Consensusの参加者集合を遡及変更しない。

### D10. Consensus participant setとConsensus policyを分離する

「誰が対象だったか」と「どの手続きでConsensusとみなすか」を分ける。

```text
ParticipantSet
  != ConsensusPolicy
  != Review records
  != Authority transition
```

Consensus policyは将来、

- explicit unanimous
- explicit quorum
- formally delegated procedure
- domain-specific procedure

等を表現できるが、v1alpha1では数式や多数決規則を固定しない。

AI score / model confidence /単純review件数をConsensus policyの代用にしない。

現行SUIではAI / systemだけのparticipant setからConsensusへ昇格させない。

### D11. exportはauthority historyを含めても、import先のlocal authorityへ自動適用しない

artifact bundleは、由来説明のためにsource側Review / Authority eventを含め得る。

ただし別trust / workspace / networkへimportした時点では、それらは**source authority assertion**である。

```text
source Accepted
  --export/import-->
local Working or Candidate
```

local Accepted / Consensusにするには、local scope上の新しいAuthority transitionが必要である。

これによりauthority launderingを防ぐ。

### D12. imported Reviewはlocal human_reviewedを自動成立させない

source bundle内にhuman Reviewが含まれていても、それはsource contextのReview履歴として保持する。

import先の`human_reviewed`やlocal artifact Reviewを自動生成しない。

local reviewerが明示Reviewした場合に、新しいlocal Review recordを作る。

### D13. export bundleはself-contained closureまたは明示external dependencyを要求する

export rootから必要なartifact revision、Relation、Review、Authority event、Scope、ParticipantSet、source pointer metadataを辿る。

各refは次のどちらかでなければならない。

1. bundle内に自己完結して含まれる
2. manifestでexternal dependencyとして明示される

silent dangling refを許可しない。

SafeMode / permission projectionはbundle生成前に適用し、元networkを変更しない。

### D14. import時のidentity collisionはfail closedまたはexplicit mappingとする

同じ`artifactId / revisionId`がlocalに存在する場合、

- digest / semantic kind / provenanceが完全整合するなら既存refへresolveできる
- 一つでも不一致ならcollisionとしてfail closedする
- IDを黙って上書きしない
- 自動的に「同じ意味」と統合しない

cross-networkでlocal IDを再発行する実装を採る場合は、origin ref mappingを失わない。

### D15. SUI Information Networkを意味成果物の最終projection先とする

semantic artifact contractはInformation Networkと競合する別Product modelではない。

将来のInformation Networkは、

- artifact revisions
- Relation artifacts
- Review / Authority event
- provenance
- Working / Consensus plane

をQuery可能な形へmaterializeする。

`QualitativeNetworkSnapshot`は、その時点・permission・scopeに応じたread modelであり、artifact persistenceそのものではない。

したがって、

```text
semantic artifact persistence
      ↓ materialize
SUI Information Network / snapshot
      ↓ query
Context Projection
```

という関係を採る。

### D16. physical persistenceはlogical contract確定後に別ADRへ送る

本ADRではtable名・DB index・object storage layoutを固定しない。

ただしphysical designは次を満たす必要がある。

- immutable revision
- append-only Review / Authority events
- exact revision FK相当の整合
- provenance refのtenant / scope整合
- retention rootからの到達性
- SafeMode / delete / legal retentionとの整合
- current state cacheを正本化しない
- authority / consensus stateをevent列から再構築可能

RDB正規化、JSON aggregate、graph store、Content Store共有の比較は別ADRで行う。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| **業務設計** | 同じ成果物でもAuthorityはscopeごとに異なり、export/importしてもsource authorityをlocal authorityへ洗い替えない | データ: Scope / ParticipantSet / source authority historyを別recordで保持。機能: import時はlocal promotionを別操作にする |
| **データ設計** | kind-specific payload、closed core + namespaced relation、immutable scope / participant snapshot、self-contained bundleを定義 | 業務: 未知relationや外部authorityを勝手に解釈しない。機能: dangling ref / ID collisionをfail closed |
| **機能設計** | Artifact persistenceからInformation Networkをmaterializeし、Context Projectionはread modelとして維持する | 業務: query結果をauthorityへ昇格しない。データ: snapshotはcanonical persistenceではない |

## Consequences

### Positive

- KJ法以外のsensemakingへ拡張しても、共通envelopeを壊さずpayloadを追加できる。
- Relation vocabularyに秩序を持たせつつ、domain固有関係を失わない。
- 「どの範囲でAcceptedか」を明示できる。
- Consensusの参加者集合が組織membership変更で書き換わらない。
- 外部からimportした「承認済み」をlocal承認へ誤昇格しない。
- Information Networkとsemantic artifact modelの責務が接続する。

### Costs / Open questions

- kind-specific payload fieldの最終shapeはv1alpha1 contractで固定する必要がある。
- core predicate role validation tableが必要。
- Authority Scopeのparent関係をどこまで使うかはpilotが必要。
- Consensus Policyの具体規則はmulti-user実装前に別設計が必要。
- artifact bundleの署名・真正性証明は未決。
- physical persistenceは未決。

## Non-goals

- 本ADRだけでDB / API / DocumentV1を変更しない。
- Relation extensionを自動semantic inferenceへ使わない。
- visibilityをauthorityへ変換しない。
- source Accepted / Consensusをimport先へ自動継承しない。
- imported human Reviewをlocal `human_reviewed`へ変換しない。
- ConsensusをAI score / review件数から自動算出しない。
- physical storage engineをこの段階で決めない。

## Traceability

- `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- `02_Architecture/sensemaking_payload_authority_exchange_v1alpha1.md`
- `02_Architecture/information_network_projection_contract.md`
- `02_Architecture/inquiry_journey_model.html`
- `00_Prompt/domain.md`
