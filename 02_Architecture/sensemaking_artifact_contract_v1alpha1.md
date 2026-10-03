# Sensemaking Artifact Contract v1alpha1

- 状態: **規範的な設計契約 / L0 計画中**
- 日付: 2026-09-18
- 親: `ADR-0085`, `ADR-0086`, `ADR-0087`
- ペイロード、Authority Scope、交換: `02_Architecture/sensemaking_payload_authority_exchange_v1alpha1.md`
- ランタイム実装: **未実装**
- 永続化実装: **未実装**
- 現行の `DocumentV1`: **変更なし**

## 1. 目的

この契約は、SUI Sensemakingが将来AI Workspaceや人間との協働で生成する意味成果物について、次の項目を定義します。現行のCanvasスキーマには早い段階で結合しません。

- 論理ID（logical identity）
- 厳密なリビジョンID（exact revision identity）
- 来歴（provenance）
- レビュー（Review）
- 権限の遷移（authority transition）
- Review Capsule
- 保持境界（retention boundary）

この契約の目的は「新しいDBテーブルを先に作ること」ではありません。

目的は、

> **何を同じ意味成果物として追跡し、何を別リビジョンとして固定し、何をレビューしたのか、誰がどのスコープで採用したのかを、後から一意に説明できること**

です。

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

1. `artifactId` は論理IDであり、内容から独立している。
2. `revisionId` は厳密なリビジョンIDであり、内容のダイジェストから独立している。
3. `contentDigest` は完全性と同一性を照合するための値であり、IDではない。
4. Review、Authority、Decision、来歴の関係は、可能な限り厳密なリビジョンを参照する。
5. 同じダイジェストを持つ別の成果物を、自動的に同一の成果物へ統合しない。
6. ダイジェストの一致を、「同じ意味」「同じ由来」「同じAuthority」の証明に使わない。

### 2.2 不透明な参照

actor、method、run、スコープ、ポリシーなどの参照は、不透明な文字列とします。

参照には、メールアドレス、認証情報、プロバイダの秘密情報など、生の識別情報を埋め込みません。

具体的な名前空間の形式は、v1alpha1では固定しません。

---

## 3. 意味成果物のリビジョン

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

Reviewは内容の成果物ではなく、独立した記録として扱います。ADR-0085は概念上、Reviewをsensemakingの成果物として扱っており、これと矛盾しません。ここでの扱いは、永続化の責務を分けるための保存上の分類です。

### 3.2 ライフサイクル

```ts
export type ArtifactLifecycleV1Alpha1 =
  | "active"
  | "held"
  | "rejected"
  | "superseded"
  | "archived";
```

ライフサイクルはAuthorityではありません。

```text
held != Working
rejected != not-reviewed
superseded != revoked-authority
archived != invisible
```

### 3.3 リビジョンのエンベロープ

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

意味ペイロードの本体は、kindごとのコンテンツストアとペイロード契約に分けます。v1alpha1では、各kindの本文スキーマを固定しません。

### 3.4 リビジョンの不変条件

- `artifactId`、`revisionId`、`semanticKind` は空にしない。
- 同じ `artifactId` のすべてのリビジョンで、`semanticKind` は同じにする。
- `revisionId` は、リポジトリまたはテナントの中で一意にする。
- `parentRevisionIds` は、同じ `artifactId` の中のリビジョンだけを参照する。
- 循環は禁止する。
- Review、Authority、Decisionから参照されたリビジョンは不変とする。
- kindを変えるときは、新しい成果物として作る。
- `contentDigest` の検証に失敗したリビジョンは、意味ペイロードとして利用しない。
- ダイジェストが一致しただけでは、リビジョンを自動的に再利用しない。

---

## 4. 来歴エンベロープ

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

### 4.2 必須と任意の境界

| 条件 | 必須 |
|---|---|
| 新規の成果物リビジョン全般 | actor.kind, method.kind, createdAt |
| AI / モデルによる生成 | `runRef` |
| 別の成果物から派生 | `inputArtifactRefs` に厳密なリビジョン |
| 外部資料を直接利用 | 可能な範囲で `sourceRefs` |
| 旧データのimportでactorが不明 | `actor.kind="unknown"`。actor refは推測しない |
| 墨消しや変換がある | 変換を追跡できる参照があれば `transformationRefs` |

### 4.3 AI runとの境界

`runRef` の参照先は、次のような情報を保持します。

- タスク
- プロバイダとモデル
- 入力IRのダイジェスト
- 出力のダイジェスト
- ポリシーのバージョン
- SafeMode
- トレースID

これらを成果物リビジョンへ複製しません。

プロバイダを変更しても成果物契約が変わらないことを優先します。

### 4.4 禁止事項

- 存在しないactorや出典をAIが補う
- プロバイダ内部の活性化をTruthやImportanceへ読み替えて、来歴へ入れる
- 生のプロンプトを来歴エンベロープへ複製する
- 認証情報を参照へ含める
- 出典の参照を、Authorityの根拠として自動的に解釈する

---

## 5. 成果物間の来歴関係

v1alpha1では汎用的なRelationペイロードを固定しません。ただし成果物の系譜として、少なくとも次の役割を区別します。

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

この語彙は、現行の `Edge.type` へ追加する列挙ではありません。

`Edge`、`EvidenceLink`、`CardLineageEdgeV1` との間で、自動的に相互変換しません。

---

## 6. Review記録

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

### 6.2 Reviewの不変条件

- targetは厳密なリビジョンにする。
- target側のリビジョンが変わったら、Reviewを自動的に引き継がない。
- 将来のhuman reviewの判定で根拠の候補になれるのは、`reviewer.kind="human"` だけである。
- AIによるReviewを、human reviewへ変換しない。
- dispositionに `accepted` や `consensus` を追加しない。
- Reviewを訂正するときは、追記専用で新しい記録を作る。
- `supersedesReviewId` は、同じtargetを指すのを原則とする。別のリビジョンへReviewを移し替える用途には使わない。

### 6.3 現行のReviewAttributionとの関係

現行の `ReviewAttribution` と `human_reviewed` は、そのまま維持します。

将来、汎用のReview記録を導入したときは、次の2つの関係をmigration ADRで決めます。

- ドキュメント単位のhuman reviewメタデータ
- 成果物単位のReview記録

v1alpha1だけを理由に、現行の `reviewState` を導出値へ変更しません。

---

## 7. Authority遷移イベント

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

### 7.3 Authorityの不変条件

- 状態は、追記専用の遷移イベント列から導出する。
- 現在の状態だけを唯一の記録として上書きしない。
- `expectedFrom` が一致しないときは、安全側で拒否する。
- 遷移は、厳密なリビジョンに対して成立する。
- 同じ成果物の新しいリビジョンへ、Authorityを自動的に引き継がない。
- `scopeRef` は必須とする。無制限のスコープを暗黙の既定にしない。
- Reviewがなくても、Working→Candidateの遷移は可能にし得る。AcceptedとConsensusの要件は、ポリシーで別に定める。
- Consensusは、Reviewの件数から自動的に算出しない。
- `authorizedBy.kind="policy"` は将来の予約であり、現行のランタイムでは、AcceptedやConsensusへの自動昇格に使わない。

### 7.4 代表的な遷移

| expectedFrom | to | 意味 |
|---|---|---|
| working | candidate | Reviewや採用の対象として提示する |
| candidate | working | 提示を取り下げる |
| candidate | accepted | スコープ内で採用する |
| accepted | candidate | 採用を取り消し、再検討する |
| accepted | consensus | 定義済みの手続きで共有採用する |
| consensus | accepted | Consensusを解除し、スコープを狭める |

別のリビジョンへ置き換えるときは、古いリビジョンのAuthority履歴を変更しません。新しいリビジョン側に、独立した遷移を作ります。

---

## 8. Decisionとの接続

Decisionは意味成果物であり、Authorityイベントそのものではありません。

Decisionペイロードの具体的なスキーマは未固定です。ただし少なくとも、次の項目を参照できることを要求します。

- 根拠となる成果物リビジョンへの参照
- Authorityのスコープ
- Decisionを行ったactorと、その権限
- 選択した選択肢
- 保留または棄却した代替案
- createdAt

DecisionがAccepted Synthesisを根拠にしても、そのSynthesisが真であることは証明されません。

Decisionを外部のActionへ接続するときの実行と認可の境界は、別の契約とします。

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

Structural Capsuleは、元の記録群から再構築できる投影です。

`sourceSetDigest` は、入力の参照集合と投影ポリシーを照合するための値であり、Authorityの証明ではありません。

### 9.2 Narrative Explanation

```ts
export type ReviewCapsuleNarrativeV1Alpha1 = {
  schema: "sui.review-capsule-narrative/v1alpha1";
  structuralSourceSetDigest: `sha256:${string}`;
  text: string;
  provenance: ProvenanceEnvelopeV1Alpha1;
};
```

Narrativeは、人間でもAIでも生成できます。

NarrativeのtextをReviewやAuthorityの唯一の記録にはしません。

### 9.3 Capsuleの不変条件

- Structural Capsuleのすべての参照を、元の記録へ解決できる。
- 強い矛盾や主要な代替案を、説明の都合で削除しない。
- AIのNarrativeは、human Reviewの記録を生成しない。
- 入力集合が変わったら、古いNarrativeを最新の説明として再利用しない。
- Capsuleのキャッシュを削除しても、正規のデータは失われない。

---

## 10. 主要な代替案の保持境界

### 10.1 保護対象の候補

次のいずれかに該当するリビジョンは、GCの候補から自動的に除外する保護入力になり得ます。

- AuthorityがCandidate、Accepted、Consensusのいずれかに到達した
- Reviewの対象になった
- Decisionの根拠になった
- 保持されている成果物から、`alternative_to`、`contradicts`、`grounded_by` などで直接参照されている
- 後続のSynthesisから明示的に参照されている
- 利用者またはポリシーによるピン留めがある
- ガバナンス下のチェックポイントに含まれる

### 10.2 破棄してよい小さな試行

次をすべて満たす、Workingだけのリビジョンは、保持ポリシーに従ってGCできます。

- Reviewされていない
- Authorityへ昇格していない
- Decisionの根拠でない
- 保持される子孫や関係から到達できない
- ピン留めされていない
- ガバナンス下のチェックポイントに含まれない

### 10.3 CoTとの境界

保存の対象は、外在化された成果物、関係、イベントです。

次は、保存を必須としません。

- トークン単位の推論
- 隠れ状態
- プロバイダ内部の活性化
- ビームやサンプリングで得た全候補
- モデル内部で破棄された思考

ただし、後続の選択や人間のReviewに実質的な影響を与えた代替案は、必要に応じて、独立したHypothesisまたはStructureの成果物として外在化します。

---

## 11. 現行モデルとの統合

### 11.1 DocumentV1

`DocumentV1` は、現在の可変なCanvasの唯一の記録であり、この契約の成果物ストアではありません。

この契約を理由に、次の変更は行いません。

- `semanticArtifacts[]` を追加する
- `reviews[]` を追加する
- `authorityEvents[]` を追加する
- `Card.claimType` をsemanticKindへ変更する
- `version: 2` へ上げる

将来は、成果物の側から次を出典や文脈として参照する方式を、優先して検討します。

```text
document revision ref
entity ref (card / island / edge ...)
```

### 11.2 Canvasリビジョン DAG

ADR-0070のCanvasリビジョンDAGは、Document全体の編集世代です。

意味成果物のリビジョンと原則は似ていますが、同じリビジョンではありません。

```text
CanvasRevision
  = whole-document generation

SemanticArtifactRevision
  = one semantic artifact's revision
```

同じテーブルへ統合しません。

コンテンツストア、正規JSON、ダイジェストのコーデックなどの下位部品を共有するかどうかは、別に評価します。

### 11.3 InquiryJourneyV1 / RoundSnapshotV1

`RoundSnapshotV1` は、人が「ここまでを残す」と確認した、不変なDocumentの成果です。

意味成果物は、RoundSnapshotを出典として参照できます。ただし、RoundSnapshotそのものをSynthesisの成果物などへ自動変換することはしません。

既存の `CardLineageEdgeV1.derived` は、ラウンド間のカード系譜です。成果物単位の `derived_from` とは別の契約のまま維持します。

### 11.4 ReviewAttribution

現行のドキュメント単位の `human_reviewed` とReviewAttributionを維持します。

汎用的な成果物Reviewを導入した後に、どちらを唯一の記録にするかは、migrationの判断とします。

### 11.5 AI生成run

AIの成果物リビジョンでは、`runRef` を既存のAI生成runへ接続します。

プロバイダ、モデル、プロンプト、ポリシーを、成果物のメタデータへ複製しません。

### 11.6 WorkingGraph / ConsensusGraph

- WorkingGraph = Workingの成果物を探索、編集する作業面
- ConsensusGraph = AcceptedとConsensusの成果物を統合して表示する作業面

Graph自体を、semantic kindやAuthorityイベントと同一視しません。

---

## 12. 検証マトリクス

| ケース | 期待結果 |
|---|---|
| 同じダイジェストで、別のartifactId | 両方を保持できる |
| 同じartifactIdで、semanticKindを変更 | 拒否する。新しい成果物が必要 |
| Reviewのtargetリビジョンが存在しない | 拒否する |
| Reviewの後に新しいリビジョンを作成 | 古いReviewを新しいリビジョンへ引き継がない |
| AIによるReview | human_reviewedへ昇格しない |
| Authorityの expectedFrom が不一致 | 安全側で拒否する |
| no_objectionのReviewが5件 | Consensusを自動生成しない |
| Candidateのリビジョンがrejectedのライフサイクルへ移る | Authorityの履歴は保持する |
| Review Capsuleのキャッシュを削除 | 正規の成果物、Review、Authorityイベントは変わらない |
| プロバイダの変更 | runRefの解決先だけが変わり、成果物契約は変わらない |
| contentDigestの一致 | 認可や真正性を意味しない |
| 出典のEvidenceが矛盾している | 両方を保持できる |
| Workingの小さな試行が、到達不能で、未review、未ピン | 保持ポリシーに従ってGCできる |
| 非公開のCoTが存在しない | 契約違反にしない |

---

## 13. 昇格条件

v1alpha1からランタイム契約へ昇格する前に、少なくとも次の条件を満たします。

1. 代表的なフィクスチャで、成果物、リビジョン、Review、Authorityイベントの往復を検証する。
2. 古くなったReviewのtarget、古くなったAuthorityの状態、同時昇格の競合を再現する。
3. SafeModeの投影で、来歴、Review、出典の参照が漏れる境界を確認する。
4. human reviewとAI reviewが、UI、エクスポート、APIで混ざらないことを確認する。
5. RoundSnapshotやCanvasリビジョンと重複する容量を計測する。
6. 100〜1000件規模の成果物で、Review Capsuleの再構築時間を測る。
7. 保持とGCで、Review、Authority、Decisionの参照先を削除しない。
8. importとexportで、未知の将来フィールドやバージョン不一致を安全側で拒否する方針を決める。
9. `SUI_LLM_PROVIDER=none` でも、human成果物、Review、Authorityの操作が成立する。
10. 現行の `DocumentV1` の互換性を壊す必要が生じたら、実装の前に別のスキーマADRを採択する。

---

## 14. 未決事項

ADR-0087と `sensemaking_payload_authority_exchange_v1alpha1.md` により、次の設計基線を追加しました。

- kindごとのペイロード
- Relationの閉じた中核と、名前空間付きの拡張
- Authority Scope
- Consensusの参加者スナップショット
- 成果物交換バンドル

引き続き意図的に未決なのは、次の項目です。

- UUIDv7などの具体的なID生成方式
- Evidenceの出典ロケータの共通契約
- Reviewのfindingスキーマ
- Consensus Policyの具体的なスキーマ
- 物理DBスキーマとインデックス
- コンテンツストアを共用できるか
- 成果物バンドルの署名と真正性
- Review CapsuleのUI表現
- 成果物交換のimport UI
