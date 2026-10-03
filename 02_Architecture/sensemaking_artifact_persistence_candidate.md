# Sensemaking Artifact Persistence Candidate

- 状態: **設計候補 / L0 計画中**
- 日付: 2026-09-18
- 親: `ADR-0088`
- ポータブルなスキーマ対応表: `02_Architecture/sensemaking_artifact_portable_schema_matrix.md`
- ランタイム実装: **なし**
- マイグレーション: **なし**
- 目的: 実装issueを立てる前に、ポータブルなスキーマ、トランザクション、投影の設計を固める

## 1. 前提

基準となるデータ（canonical source）は、次の三層に分けます。

```text
RDB metadata / events
        │
        ├─ identity / revision
        ├─ provenance refs
        ├─ Review
        ├─ Authority Scope / transition
        ├─ Consensus participant snapshot
        └─ import / retention metadata
        │
        └──────────────┐
                       ▼
                 Content Store
                 semantic payload
                       │
                       ▼
            materialized read models
              Information Network
              relation adjacency
              current authority cache
```

マテリアライズした読み取りモデルは、削除しても再構築できます。

## 2. 基準となる論理レコードの分類

以下は**物理テーブル名の確定ではありません**。マイグレーションを作る前の、責務の分割です。

### 2.1 成果物の識別

フィールド候補は次のとおりです。

```text
tenant_id
artifact_id
semantic_kind
created_at
created_by_actor_kind
created_by_actor_ref?
```

不変条件は次のとおりです。

- `tenant_id + artifact_id` は一意にする。
- semantic kindは不変にする。
- 成果物の行そのものには、本文を置かない。
- 最新リビジョンはキャッシュとして持てるが、基準データにはしない。

### 2.2 成果物のリビジョン

フィールド候補は次のとおりです。

```text
tenant_id
revision_id
artifact_id
payload_schema
payload_content_ref
payload_digest
lifecycle
actor_kind
actor_ref?
method_kind
method_ref?
run_ref?
input_scope_ref?
created_at
```

別のレコードとして持つものは次のとおりです。

- リビジョンの親エッジ
- 入力となる成果物リビジョンへの参照
- 出典の参照
- 変換の参照

不変条件は次のとおりです。

- `tenant_id + revision_id` は一意にする。
- `tenant_id + artifact_id + revision_id` の整合を保つ。
- semantic kindは成果物の行から取得し、リビジョンごとには変更しない。
- ペイロードのダイジェストやスキーマが一致しないときは、安全側で拒否する。
- 親は同じ成果物のリビジョンだけにする。
- 厳密なリビジョンに対する外部キー相当の整合を保つ。

### 2.3 Review記録

フィールド候補は次のとおりです。

```text
tenant_id
review_id
target_artifact_id
target_revision_id
reviewer_kind
reviewer_ref
purpose
disposition
supersedes_review_id?
created_at
```

findingは、次のどちらかへ分離できます。

- 長さを制限したコードや参照のメタデータ
- コンテンツオブジェクト

Reviewの行には、AcceptedやConsensusの状態を入れません。

### 2.4 Authority Scope

フィールド候補は次のとおりです。

```text
tenant_id
scope_ref
scope_kind
container_ref
purpose_ref?
parent_scope_ref?
created_at
```

- 不変にする。
- 親子の循環は禁止する。
- 親の指定は、Authorityの継承を意味しない。

### 2.5 Authority遷移

フィールド候補は次のとおりです。

```text
tenant_id
event_id
target_artifact_id
target_revision_id
scope_ref
expected_from
to_state
authorized_by_kind
authorized_by_ref
policy_ref?
participant_set_ref?
created_at
```

別の結合や参照として持つものは次のとおりです。

- 根拠となるReviewへの参照
- 根拠となるDecisionのリビジョンへの参照

### 2.6 Consensusの参加者スナップショット

ヘッダは次のとおりです。

```text
tenant_id
participant_set_ref
scope_ref
membership_source_ref?
created_at
```

メンバーは次のとおりです。

```text
tenant_id
participant_set_ref
actor_ref
actor_kind
eligibility_role_ref?
```

スナップショットの作成後は、メンバーの更新を許可しません。

### 2.7 importした出典のアサーション

交換データをimportするとき、出典側のReviewやAuthorityを、ローカルのイベントストアへ直接入れません。

出典のアサーションとして、次のような項目で保持する案を候補とします。

```text
tenant_id
import_session_id
source_network_ref
source_assertion_id
assertion_kind
source_scope_ref?
source_record_content_ref / bounded metadata
created_at
```

ローカルのAuthority reducerの入力にはしません。

### 2.8 交換importのマッピング

```text
tenant_id
import_session_id
source_network_ref
source_artifact_id
source_revision_id
local_artifact_id
local_revision_id
created_at
```

IDを保存したまま解決する実装では、マッピングの行を省略できます。ネットワークをまたいでIDを再発行する場合は必須です。

### 2.9 保持のピン留めと保護

明示的なピン留めは、独立したレコードにします。

Review、Authority、Decision、保持されるRelationなどからの参照は、導出される保護ルートです。ピン留めのテーブルへは複製しません。

---

## 3. Content Storeのペイロード

### 3.1 ペイロードの境界

Content Storeへ置くものは次のとおりです。

- Evidence、Observation、Relation、Hypothesis、Structure、Synthesis、Decisionのペイロード
- Reviewのfindingで、長文が必要な場合の本文
- 出典のアサーションで、安全な不透明ペイロードが必要な場合

RDBの長さ制限付きカラムへ置くものは次のとおりです。

- ID
- 列挙値と状態
- ダイジェスト
- スキーマ参照
- actorとmethodの不透明な参照
- タイムスタンプ
- 外部キーや結合に必要な参照

### 3.2 正規JSON

意味ペイロードは、kindごとのスキーマに従う正規JSONのバイト列として、ダイジェストを取れるようにします。

既存のCanvasリビジョンのコーデックと同じ正規化の部品を再利用できるかは、ベンチマークで確かめます。

再利用する場合でも、

```text
CanvasRevision ID
  != SemanticArtifactRevision ID
```

です。

### 3.3 BLOBの重複排除

同じテナントで同じダイジェストなら、BLOBを共有できます。

ただし、次の項目は重複排除しません。

- 成果物の識別
- 来歴
- Authority
- Review

---

## 4. ポータブルなインデックス

最低限の候補は次のとおりです。

### 基準となる識別

```text
UNIQUE (tenant_id, artifact_id)
UNIQUE (tenant_id, revision_id)
INDEX  (tenant_id, artifact_id, created_at)
INDEX  (tenant_id, semantic_kind, created_at)
```

### Review

```text
UNIQUE (tenant_id, review_id)
INDEX  (tenant_id, target_artifact_id, target_revision_id, created_at)
INDEX  (tenant_id, reviewer_ref, created_at)
```

### Authority

```text
UNIQUE (tenant_id, scope_ref)
UNIQUE (tenant_id, event_id)
INDEX  (tenant_id, target_artifact_id, target_revision_id, scope_ref, created_at)
INDEX  (tenant_id, scope_ref, created_at)
```

### Consensusの参加者

```text
UNIQUE (tenant_id, participant_set_ref, actor_ref)
INDEX  (tenant_id, scope_ref, created_at)
```

### import

```text
INDEX (tenant_id, import_session_id)
UNIQUE (
  tenant_id,
  import_session_id,
  source_network_ref,
  source_artifact_id,
  source_revision_id
)
```

DBファミリごとのインデックスのバイト数上限を考慮し、内部の不透明IDは、既存の長さ制限付き識別子カタログの範囲に収めます。

---

## 5. 導出レコードとマテリアライズレコード

### 5.1 現在のAuthorityキャッシュ

キーの候補は次のとおりです。

```text
tenant_id
artifact_id
revision_id
scope_ref
```

値は次のとおりです。

```text
current_state
last_event_id
updated_at
```

キャッシュは、Authorityイベント列から再構築できます。

Authority遷移のトランザクションでは、CASの対象として利用できます。

### 5.2 Relationインデックス

クエリのたびにContent StoreからRelationの成果物ペイロードを全件デコードしないよう、導出インデックスを持てます。

候補は次のとおりです。

```text
tenant_id
relation_artifact_id
relation_revision_id
predicate
participant_role
target_kind
target_ref
```

未知の拡張predicateも、文字列のまま往復して保持します。

このインデックスは、Relationの成果物ペイロードの基準データではありません。

### 5.3 Information Networkの投影

Information Networkのマテリアライザは、次の情報から `QualitativeNetworkSnapshot` を構築します。

- 成果物のリビジョン
- Relationインデックス
- 来歴の参照
- Reviewの要約
- 要求されたスコープごとのAuthority状態
- 保留と矛盾

すべてのAuthority Scopeを、一つのノード状態へ圧縮しません。

---

## 6. トランザクションの境界

### 6.1 成果物の作成

同一トランザクションの候補は次のとおりです。

1. 成果物の識別をinsertする
2. ペイロードのContent Storeメタデータを準備する
3. 成果物のリビジョンをinsertする
4. 親と来歴の参照をinsertする
5. ペイロードのメタデータをreadyに確定する
6. 監査ログとoutboxへ追記する

外部のContent Storeを使うときは、既存のコーディネータとpending-ready状態の原則に従い、物理I/OとRDBトランザクションの不整合を補償します。

### 6.2 リビジョンの追加

1. 成果物の存在とkindを確認する
2. 親リビジョンの存在と、同じ成果物であることを確認する
3. ペイロードを保存する
4. 新しい不変のリビジョンを追記する
5. 来歴の参照を追記する
6. マテリアライザ用のoutboxへ追記する

過去のリビジョンは更新しません。

### 6.3 Review

1. 対象の厳密なリビジョンの存在を確認する
2. レビューを行う主体の権限と許可を確認する
3. Reviewを追記する
4. findingの参照を保存する
5. マテリアライザ用のoutboxへ追記する

Reviewだけでは、Authorityキャッシュを変更しません。

### 6.4 Authority遷移

1. 対象の厳密なリビジョンの存在を確認する
2. スコープの存在を確認する
3. 有効な認可を確認する
4. 現在の状態をロックまたはCASする
5. `expectedFrom` を確認する
6. ポリシー、参加者集合、根拠の参照を検証する
7. 遷移を追記する
8. 現在の状態のキャッシュを更新する
9. 監査ログとoutboxへ追記する

状態が古いときは、409相当で安全側に拒否します。

### 6.5 交換importの処理

概念上の段階は次のとおりです。

```text
staging parse
  -> structural validate
  -> closure validate
  -> SafeMode / permission validate
  -> collision validate
  -> source authority de-privilege
  -> payload prepare
  -> canonical metadata commit
  -> materialization
```

途中で失敗して、ローカルのAcceptedやhuman reviewedだけが残る状態は禁止します。

---

## 7. マテリアライズ方式の候補

第一候補は、トランザクショナルoutboxと冪等なマテリアライザです。

理由は次のとおりです。

- 基準データのトランザクションとグラフや検索の更新を、同期した二重書き込みにしない。
- グラフ、ベクトル、スパースインデックスの障害で、基準データの書き込みを失敗させない。
- 投影を再構築できる。
- EKIなどへ、重い再構築を将来委譲しやすい。

ただしAuthorityの現在状態キャッシュだけは、CASの正しさに使うため、基準データのトランザクション内にあるRDBの導出状態として扱えます。

```text
canonical commit
   ├─ metadata/events
   ├─ authority cache
   └─ outbox
          │
          ▼
     materializer
          ├─ Information Network
          ├─ relation index
          ├─ search
          └─ optional graph/vector/sparse indexes
```

---

## 8. GCの候補

### 8.1 マークのルート

少なくとも次のとおりです。

- 成果物の現在のヘッドと、保持するリビジョンのポリシー
- Reviewの対象
- Authority遷移の対象と根拠
- Decisionの根拠
- 保持されるRelationの参照
- 参加者と出典アサーションの保持ポリシー
- 明示的なピン留め
- ガバナンス下のチェックポイント

### 8.2 スイープ

- ルートから到達できない、Workingだけのリビジョンを候補にする。
- 候補を列挙した後、トランザクション内で保護条件を再確認する。
- リビジョンのメタデータを削除した後も、ペイロードBLOBの参照数と保持の猶予期間を確認する。
- 外部コンテンツの削除に失敗したときは、既存のContent Storeの状態機械に従って再試行する。

### 8.3 投影

投影やキャッシュを、GCのルートにはしません。

投影から基準レコードが参照されていることを理由に、保持期間を延ばしません。

---

## 9. DB移植性のチェックリスト

マイグレーションを実装する前に、検証済みのDBファミリすべてについて、次を確認します。

- 識別子の長さ制限
- テナントを含む複合外部キー
- 追記専用イベントの制約
- Authority状態のcheck制約
- ライフサイクルのcheck制約
- NULLを許す不透明な参照
- タイムスタンプの正規形
- ペイロードのLOBとContent Storeの往復
- ユニーク制約とインデックスのバイト数上限
- importのステージングトランザクション
- 同時実行時のAuthority CAS
- バックアップとリストア
- テナントガードとRLS（共有スキーマが対象の場合のみ）

PostgreSQL固有のJSONB、再帰CTE、アドバイザリロックを、Coreの正しさを支える唯一の実装にはしません。

---

## 10. 代表的なフィクスチャ

実装issueでは、最低限、次のフィクスチャを作ります。

### Fixture A: 人間が主導

- Evidence 20
- Observation 10
- Hypothesis 5
- Structure 2
- Synthesis 1
- Human Review 4
- InquiryスコープでAccepted 1

### Fixture B: AI Workspace

- Evidence 50
- Observation 100
- Hypothesis 80
- Workingだけの小さな試行が多数
- Candidate 10
- Reviewの対象 6
- Accepted 2
- 保持される代替案と矛盾

### Fixture C: 複数スコープ

同じリビジョンについて、

- workspace = Accepted
- inquiry = Accepted
- network = Candidate
- external = Working

とします。

### Fixture D: 交換

出典側は次のとおりです。

- Accepted / Consensus
- human Review
- 参加者スナップショット

import先は次のとおりです。

- ローカルではWorking
- 出典のアサーションを保持
- ローカルのhuman_reviewed = false
- 明示的に昇格した後に限り、ローカルでCandidateやAccepted

### Fixture E: 衝突

同じ出典IDについて、次を検証します。

- 同じダイジェストで、同じ来歴
- 同じIDで、ダイジェストが異なる
- 同じIDで、semantic kindが異なる

---

## 11. 実装の停止ライン

次のいずれかが起きたら、マイグレーションを進めず、ADRへ戻ります。

- `DocumentV1` の意味を変える必要が生じた
- ReviewとAuthorityを同じ行へ統合しないと実装できない
- importした出典のAuthorityを、ローカルの現在状態へ入れる必要がある
- グラフDBを基準データにしないと成立しない
- プロバイダ内部のスコアを、永続するTruthやImportanceとして要求される
- 非公開のchain-of-thoughtの保存が必須になる
- 検証済みのDBファミリの複数で、ポータブルな制約を表現できない

---

## 12. 実装前に必要な成果物

1. ポータブルなテーブルのスケッチと、外部キーの対応表
2. Authority遷移の並行性に関する疑似テスト
3. 交換importのステージングに関する疑似テスト
4. 代表的なフィクスチャのJSON
5. Content Storeのペイロードのベンチマーク
6. Information Networkの再構築のベンチマーク
7. 保持の到達可能性に関するテスト計画

これらを確認した後に限り、マイグレーションのissueを「実装可能（Ready for Implementation）」へ昇格します。
