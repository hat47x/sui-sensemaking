# ADR-0087: semantic payload・Authority Scope・Consensus・交換境界を定義する

- Status: Accepted
- Date: 2026-09-18
- Deciders: Maintainer
- Scope: kindごとのsemantic payload、Relationの語彙、Authority Scope、Consensusの参加者のスナップショット、artifactのimport/export
- Related: `ADR-0084`, `ADR-0085`, `ADR-0086`
- Runtime impact: この変更では影響なし
- Schema impact: この変更では影響なし

## Context

ADR-0085とADR-0086により、SUI Sensemakingの意味成果物について、次の項目の基本的な境界が定まった。

- semantic kind
- 論理的なartifact identity
- 厳密なrevision identity
- provenance
- Review
- Authority transition
- 保持

一方、実装できる契約へ進むには、次の未決事項を整理する必要がある。

1. Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Decisionのpayloadを、どこまで共通化するか。
2. Relationの語彙を、閉じたenumにするか、自由な語彙を許すか。
3. AcceptedやConsensusが「どの範囲で有効か」を示すAuthority Scopeを、どう表すか。
4. Consensusを形成したときの参加者の集合を、後から再現でき、かつPIIを増やさない形で、どう固定するか。
5. artifactをexportしてimportしたとき、source側のReview、Accepted、Consensusを、ローカルのauthorityとしてどう扱うか。
6. SUI Information NetworkやWorkingGraph / ConsensusGraphとの関係を、どう保つか。

特に、exportしたAccepted artifactを別のワークスペースへimportしただけで、ローカルのAcceptedにしてしまうと、権限の境界を越えたauthorityの洗い替え（authority laundering）が起きる。

同様に、semantic payloadを一つの汎用の `text + refs` にまとめてしまうと、EvidenceとHypothesisの意味の違いがpayload層で消える。一方、各kindのschemaを早い段階で細かく固定しすぎると、KJ法以外のAIネイティブなsensemakingや、将来の認知プロバイダを、不必要に制限する。

## Decision

### D1. 共通のenvelopeと、kindごとのpayloadを分ける

共通のエンベロープが扱うのは、identity、revision、provenance、ライフサイクルだけである。

意味の本文は、semantic kindごとのpayload契約へ分ける。

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

全kind共通の、巨大なoptionalオブジェクトは作らない。

### D2. payloadでは「意味の最小限の骨格」だけを固定する

v1alpha1では、各kindのpayloadについて、次の役割だけを固定する。

- **Evidence**: 根拠として参照する内容、またはsource segmentへのポインタ
- **Observation**: 何を認識したかという記述と、その対象
- **Relation**: predicateとparticipants
- **Hypothesis**: 反証できる記述と、その対象
- **Structure**: 構造の種別と、memberおよびrelationへの参照
- **Synthesis**: 統合された理解の本文と、構成要素への参照
- **Decision**: 選択、保留、追加調査などのdecisionの記述と、basisおよびalternativeへの参照

confidence、importance、rank、truth scoreは、共通のpayloadフィールドにしない。

### D3. Evidence payloadは、sourceの複製を要求しない

Evidenceは、インラインのテキストだけに限らない。

```text
Evidence payload
  = inline representation
    OR source segment pointer
    OR both
```

大容量の文書、画像、音声、外部のレコードを、artifactの本文へ複製しない。

sourceへのポインタだけの場合でも、後から同じsegmentへ戻るためのロケーターやダイジェストなどを、source契約の側で持てるようにする。

Evidenceであることは、sourceが正しいことを意味しない。

### D4. ObservationとHypothesisは、statementを共有してもkindを統合しない

ObservationもHypothesisも、自然言語の記述を持ち得る。しかし、同じ型には統合しない。

- Observation: 「この主体または認知系が、こう認識した」
- Hypothesis: 「この材料から、このように解釈できる」

文面が同じでも、semantic kindが違えば別のartifactである。

### D5. Relationは「閉じたcore + 名前空間付きの拡張」とする

Relationのpredicateは、完全に閉じたenumにも、完全に自由な文字列にもしない。

SUIがシステムの挙動に使うコアのpredicateは、閉じた語彙とする。

初期のcoreは次のとおり。

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

ドメイン固有のrelationと実験的なrelationは、名前空間付きのpredicateとして許容する。

例を挙げる。

```text
domain:requirements/depends_on
method:kj/close_affinity
experiment:csw/symbolic_resonance
```

拡張predicateは、登録されたポリシーがない限り、次のものを発火させてはならない。

- authority transition
- 保持のルート
- 真偽の自動推論
- consensus
- 権限

未知の拡張relationは破棄せず、表示できる不透明なrelationとして保持する。

### D6. Relationは、二項のエッジに限らない

将来の因果構造、複数のEvidenceによる共同の支持、n項の比較などを考慮し、Relation payloadはparticipantsの配列を持つ。

participantは、roleと、厳密なartifact revisionへの参照で表す。

```text
predicate = supports
participants:
  - role=source
  - role=target
```

コアのpredicateごとのrole制約は、別の検証テーブルで固定する。

現行の `Edge` は、引き続きキャンバスのプロジェクションである。このRelation payloadへ自動でマイグレーションはしない。

### D7. Authority Scopeは、権限や可視性から独立した不変のレコードとする

`scopeRef` は、不透明な文字列のまま終わらせず、将来、次のような不変のレコードへ解決できることを要求する。

Authority Scopeは、次の点を定義する。

> **このartifact revisionを、どの意味上の文脈でAcceptedまたはConsensusとして扱うか**

初期のscope kindは次のとおり。

- `workspace`
- `inquiry`
- `network`
- `decision_context`
- `external_context`

scopeのレコードは、少なくとも次を持つ。

- scopeRef
- kind
- containerRef
- purposeRef（任意）
- parentScopeRef（任意）
- createdAt

Authority Scopeは、ACLではない。

```text
authority scope != readable scope
authority scope != visibility
authority scope != tenant boundary
```

「見えるのでAccepted」「公開したのでConsensus」とは扱わない。

### D8. scopeの継承は自動にしない

親のscopeでAcceptedだからといって、子や兄弟や外部のscopeでもAcceptedとする、という暗黙の継承はしない。

scope間でauthorityを引き継ぐ場合は、新しいAuthority transitionを作り、元のauthority eventをbasisとして参照する。

これにより、次のような状態を表現できる。

> inquiry内ではAcceptedだが、組織全体の正式な見解ではない

### D9. Consensusの参加者の集合は、不変のスナップショットとして固定する

Consensus transitionでは、その時点の参加者の集合を、後から再現できなければならない。

`participantSetRef` は、不変のスナップショットのレコードへ解決する。

参加者のスナップショットは、次を持つ。

- participantSetRef
- 不透明なparticipant ref
- participant kind
- eligibilityまたはrole ref（必要な場合）
- source membershipのスナップショットref（必要な場合）
- createdAt

表示名やメールアドレスなどのPIIを、スナップショットに必須とはしない。

組織のmembershipが後から変わっても、過去のConsensusの参加者の集合を、遡って変更しない。

### D10. Consensusの参加者の集合と、Consensusのポリシーを分ける

「誰が対象だったか」と「どの手続きでConsensusとみなすか」を分ける。

```text
ParticipantSet
  != ConsensusPolicy
  != Review records
  != Authority transition
```

Consensusのポリシーは、将来、次のような手続きを表現できる。

- 明示的な全会一致
- 明示的な定足数
- 正式に委任された手続き
- ドメイン固有の手続き

ただしv1alpha1では、数式や多数決の規則は固定しない。

AIのスコア、モデルのconfidence、単純なreview件数を、Consensusのポリシーの代わりにしない。

現行のSUIでは、AIとsystemだけの参加者の集合からConsensusへ昇格させない。

### D11. exportにauthorityの履歴を含めても、import先のローカルauthorityへ自動で適用しない

artifactのバンドルには、由来を説明するために、source側のReviewとAuthority eventを含めてよい。

ただし、別のtrust、ワークスペース、ネットワークへimportした時点では、それらは**source authority assertion**である。

```text
source Accepted
  --export/import-->
local Working or Candidate
```

ローカルのAcceptedやConsensusにするには、ローカルのscope上で、新しいAuthority transitionが必要である。

これにより、authority launderingを防ぐ。

### D12. importしたReviewは、ローカルのhuman_reviewedを自動で成立させない

sourceのバンドルに人間のReviewが含まれていても、それはsourceの文脈でのReview履歴として保持する。

import先の `human_reviewed` やローカルのartifactのReviewを、自動では生成しない。

ローカルのreviewerが明示的にReviewしたときに、新しいローカルのReviewレコードを作る。

### D13. export bundleは、自己完結したclosureか、明示した外部依存を要求する

exportのルートから、必要なartifact revision、Relation、Review、Authority event、Scope、ParticipantSet、source pointerのメタデータをたどる。

各refは、次のどちらかでなければならない。

1. バンドルの中に、自己完結して含まれる
2. manifestで、外部依存として明示される

黙ってぶら下がったrefは許可しない。

SafeModeと権限のプロジェクションは、バンドルを生成する前に適用する。元のネットワークは変更しない。

### D14. import時のidentityの衝突は、安全側で拒否するか、明示的なマッピングとする

同じ `artifactId / revisionId` がローカルに存在する場合は、次のとおりとする。

- ダイジェスト、semantic kind、provenanceが完全に整合するなら、既存のrefへ解決できる
- 一つでも不一致があれば、衝突として安全側で拒否する
- IDを黙って上書きしない
- 自動的に「同じ意味」として統合しない

ネットワーク間でローカルのIDを再発行する実装を採る場合は、起点のrefのマッピングを失わない。

### D15. SUI Information Networkを、意味成果物の最終的なプロジェクション先とする

semantic artifact契約は、Information Networkと競合する別のプロダクトモデルではない。

将来のInformation Networkは、次のものを問い合わせできる形へマテリアライズする。

- artifact revisions
- Relation artifacts
- Review / Authority event
- provenance
- Working / Consensus plane

`QualitativeNetworkSnapshot` は、その時点、権限、scopeに応じた読み取りモデルである。artifact persistenceそのものではない。

したがって、次の関係を採る。

```text
semantic artifact persistence
      ↓ materialize
SUI Information Network / snapshot
      ↓ query
Context Projection
```

### D16. 物理的な永続化は、論理契約の確定後に、別のADRへ送る

本ADRでは、テーブル名、DBのインデックス、オブジェクトストレージの配置を固定しない。

ただし、物理設計は次を満たす必要がある。

- 不変のrevision
- 追記専用のReviewとAuthority event
- 厳密なrevisionへの外部キー相当の整合
- provenance refのテナントとscopeの整合
- 保持のルートからの到達可能性
- SafeMode、削除、法的な保持との整合
- 現在状態のキャッシュを正本にしない
- authorityとconsensusの状態を、event列から再構築できる

RDBの正規化、JSON集約、グラフストア、Content Storeの共有の比較は、別のADRで行う。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| **業務設計** | 同じ成果物でも、Authorityはscopeごとに異なる。export/importしても、source authorityをローカルのauthorityへ洗い替えない | データ: Scope、ParticipantSet、source authorityの履歴を、別のレコードで保持する。機能: importの際は、ローカルでの昇格を別の操作にする |
| **データ設計** | kindごとのpayload、閉じたcoreと名前空間付きのrelation、不変のscopeとparticipantのスナップショット、自己完結したバンドルを定義する | 業務: 未知のrelationや外部のauthorityを、勝手に解釈しない。機能: ぶら下がったrefとIDの衝突を、安全側で拒否する |
| **機能設計** | Artifact persistenceからInformation Networkをマテリアライズし、Context Projectionは読み取りモデルとして維持する | 業務: 問い合わせの結果を、authorityへ昇格しない。データ: スナップショットは、正本の永続化ではない |

## Consequences

### Positive

- KJ法以外のsensemakingへ拡張しても、共通のエンベロープを壊さずに、payloadを追加できる。
- Relationの語彙に秩序を持たせつつ、ドメイン固有の関係を失わない。
- 「どの範囲でAcceptedか」を明示できる。
- Consensusの参加者の集合が、組織のmembershipの変更で書き換わらない。
- 外部からimportした「承認済み」を、ローカルの承認へ誤って昇格しない。
- Information Networkとsemantic artifactモデルの責務が接続する。

### Costs / Open questions

- kindごとのpayloadフィールドの最終的な形は、v1alpha1契約で固定する必要がある。
- コアのpredicateのroleを検証するテーブルが必要である。
- Authority Scopeの親子関係をどこまで使うかは、パイロットが必要である。
- Consensusのポリシーの具体的な規則は、マルチユーザーの実装の前に、別の設計が必要である。
- artifactのバンドルの署名と真正性の証明は未決である。
- 物理的な永続化は未決である。

## Non-goals

- 本ADRだけでは、DB、API、DocumentV1を変更しない。
- Relationの拡張を、自動の意味推論に使わない。
- 可視性をauthorityへ変換しない。
- sourceのAcceptedやConsensusを、import先へ自動では継承しない。
- importした人間のReviewを、ローカルの `human_reviewed` へ変換しない。
- ConsensusをAIのスコアやreview件数から自動で算出しない。
- この段階では、物理的なストレージエンジンを決めない。

## Traceability

- `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- `02_Architecture/sensemaking_payload_authority_exchange_v1alpha1.md`
- `02_Architecture/information_network_projection_contract.md`
- `02_Architecture/inquiry_journey_model.html`
- `00_Prompt/domain.md`
