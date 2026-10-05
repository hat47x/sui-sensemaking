# Sensemaking Artifact Portable Schema / Constraint Matrix

- 状態: **設計候補 / SENSEMAKING-PERSIST-01**
- 日付: 2026-09-18
- 親: `ADR-0088`, `sensemaking_artifact_persistence_candidate.md`
- マイグレーション: **未着手**
- 目標: 検証済みのDBファミリへ落とせる論理スキーマと、DBとアプリケーションの制約の責務を分離する

## 1. 方針

物理マイグレーションの前に、各不変条件を次の3種へ分類します。

1. **DBで強制する**
   - 主キー、ユニーク、外部キー、check制約など、検証済みのDBファミリでポータブルに守れるもの
2. **トランザクションで強制する**
   - 現在状態のCAS、複数レコードの整合など、アプリケーションのトランザクションで守るもの
3. **検証で強制する**
   - 循環、名前空間の意味、バンドルのクロージャなど、書き込み前の検証処理で守るもの

DBで表現できない意味を、DB固有のトリガーに隠しません。

---

## 2. 基準レコードの候補

### 2.1 `semantic_artifacts`

| カラム | 形 | 役割 |
|---|---|---|
| tenant_id | 既存のテナント識別子 | テナントの境界 |
| artifact_id | 内部の不透明ID | 論理ID |
| semantic_kind | 閉じた集合で長さ制限付きのテキスト | 不変のkind |
| created_at | 正規形のタイムスタンプ | 作成日時 |
| created_by_actor_kind | 閉じた集合 | human / ai / system / import / unknown |
| created_by_actor_ref | 任意の不透明な参照 | 作成者の参照 |

制約は次のとおりです。

- 主キーとユニーク: `(tenant_id, artifact_id)`
- semantic kindは、閉じた集合のcheck制約で守る。
- 成果物のkindを更新するAPIは提供しない。

### 2.2 `semantic_artifact_revisions`

| カラム | 形 | 役割 |
|---|---|---|
| tenant_id | テナント識別子 | テナントの境界 |
| revision_id | 内部の不透明ID | 厳密なリビジョンID |
| artifact_id | 不透明ID | 論理的な成果物 |
| payload_schema | 長さ制限付きのスキーマ参照 | ペイロード契約 |
| payload_content_ref | 内部のコンテンツ参照 | Content Store |
| payload_digest | 長さ制限付きのsha256テキスト | 完全性の照合 |
| lifecycle | 閉じた集合 | active / held / rejected / superseded / archived |
| actor_kind | 閉じた集合 | 来歴 |
| actor_ref | 任意の不透明な参照 | 来歴 |
| method_kind | 閉じた集合 | 来歴 |
| method_ref | 任意の不透明な参照 | 来歴 |
| run_ref | 任意の不透明な参照 | AIやシステムによる実行 |
| input_scope_ref | 任意の不透明な参照 | 長さ制限付きの入力スコープ |
| created_at | 正規形のタイムスタンプ | 不変の作成日時 |

制約は次のとおりです。

- ユニーク: `(tenant_id, revision_id)`
- ユニークの候補: 複合外部キーの参照先として `(tenant_id, artifact_id, revision_id)`
- 外部キー: `(tenant_id, artifact_id) -> semantic_artifacts`
- lifecycleは、閉じた集合のcheck制約で守る。
- ペイロードのダイジェストの構文は、ポータブルな長さ制限付きの検証と、アプリケーションの厳密な検証で確認する。
- 本文のUPDATEは禁止する。lifecycleの変更を新しいリビジョンにするか、追記専用のイベントへ分離するかは、マイグレーションの前に実装方針を再確認する。

> 注: ADR-0086では、lifecycleをリビジョンのエンベロープに置いた。物理実装ではリビジョンの不変性を厳格に保つため、lifecycleをリビジョン行の固定値として置くか、別の追記専用のlifecycleイベントへ分けるかを、ベンチマークの前に最終決定する。その場でlifecycleを更新することは前提にしない。

### 2.3 `semantic_artifact_revision_parents`

| カラム | 役割 |
|---|---|
| tenant_id | テナント |
| artifact_id | 同じ成果物であることのガード |
| child_revision_id | 子 |
| parent_revision_id | 親 |

制約は次のとおりです。

- ユニーク: `(tenant_id, child_revision_id, parent_revision_id)`
- 子の複合外部キー: `(tenant_id, artifact_id, child_revision_id)`
- 親の複合外部キー: `(tenant_id, artifact_id, parent_revision_id)`
- 自分自身を親にすることを禁止するcheck制約
- 循環は、検証で強制する。

この形にすると、親が別の成果物を指すことを、DBの外部キーで防げます。

### 2.4 `semantic_artifact_input_refs`

成果物の来歴として、別の成果物リビジョンを入力に使ったことを保持します。

| カラム | 役割 |
|---|---|
| tenant_id | テナント |
| revision_id | 出力側のリビジョン |
| ordinal | 必要な場合の決定的な順序 |
| input_artifact_id | 入力の論理ID |
| input_revision_id | 厳密な入力 |

制約は次のとおりです。

- 出力側の厳密なリビジョンへの外部キー
- 入力側の厳密なリビジョンへの複合外部キー
- 重複の扱いは、roleとordinalを設計するときに確定する。

### 2.5 `semantic_artifact_source_refs`

出典レジストリや外部の出典への、不透明な参照です。

- tenant_id
- revision_id
- source_ref
- ordinal

出典がSUI内部のレジストリにある場合に限り、外部キーにします。外部の参照を、偽の外部キーにはしません。

### 2.6 `semantic_artifact_transformation_refs`

墨消し、正規化、変換の系譜です。

- tenant_id
- revision_id
- transformation_ref
- ordinal

---

## 3. Review

### 3.1 `semantic_reviews`

| カラム | 役割 |
|---|---|
| tenant_id | テナント |
| review_id | 不変のReview ID |
| target_artifact_id | 対象 |
| target_revision_id | 厳密な対象 |
| reviewer_kind | human / ai / system |
| reviewer_ref | 不透明なactor |
| purpose | 閉じた集合 |
| disposition | 閉じた集合 |
| supersedes_review_id | 任意。訂正の系譜 |
| created_at | 追記日時 |

制約は次のとおりです。

- ユニーク: `(tenant_id, review_id)`
- 厳密な対象リビジョンへの複合外部キー
- supersedesの参照は、同じテナントにする。
- `accepted` と `consensus` は、disposition列挙へ入れない。
- reviewer kindと `human_reviewed` の連携は、アプリケーションのポリシーで扱う。

### 3.2 Reviewのfinding

短い閉じたコードは長さ制限付きの行にし、長文のfindingはContent Storeへ分離する案を候補とします。

Reviewの行そのものに、自由な長さの本文を大量に詰め込みません。

---

## 4. Authority

### 4.1 `authority_scopes`

| カラム | 役割 |
|---|---|
| tenant_id | テナント |
| scope_ref | 不変のスコープID |
| scope_kind | workspace / inquiry / network / decision_context / external_context |
| container_ref | 文脈 |
| purpose_ref | 任意 |
| parent_scope_ref | 任意 |
| created_at | 作成日時 |

制約は次のとおりです。

- ユニーク: `(tenant_id, scope_ref)`
- 親は、同じテナントの外部キーにする。
- 自分自身を親にすることを禁止する。
- 循環は、検証で強制する。
- 親からのAuthorityの継承は実装しない。

### 4.2 `authority_transitions`

| カラム | 役割 |
|---|---|
| tenant_id | テナント |
| event_id | 追記専用のイベント |
| target_artifact_id | 対象 |
| target_revision_id | 厳密なリビジョン |
| scope_ref | Authorityの文脈 |
| expected_from | CASの事前条件 |
| to_state | 遷移先の状態 |
| authorized_by_kind | human / policy |
| authorized_by_ref | Authorityの主体 |
| policy_ref | 任意 |
| participant_set_ref | 任意 |
| created_at | 追記日時 |

制約は次のとおりです。

- ユニーク: `(tenant_id, event_id)`
- 厳密な対象リビジョンへの外部キー
- スコープへの外部キー
- 状態は、閉じた集合のcheck制約で守る。
- 参加者集合を指定するときは、同じテナントの外部キーにする。
- 現在状態の正しさは、トランザクションで強制する。

### 4.3 `authority_transition_review_basis`

- tenant_id
- event_id
- review_id

どちらも、同じテナントの外部キーにします。

### 4.4 `authority_transition_decision_basis`

- tenant_id
- event_id
- decision_artifact_id
- decision_revision_id

Decisionのsemantic kindであることは、トランザクションと検証で確認します。

### 4.5 `authority_current_state`（導出キャッシュ）

| カラム | 役割 |
|---|---|
| tenant_id | テナント |
| artifact_id | 対象 |
| revision_id | 厳密なリビジョン |
| scope_ref | Authorityの文脈 |
| current_state | キャッシュ |
| last_event_id | 再構築の起点 |
| updated_at | キャッシュの更新日時 |

ユニーク制約は次のとおりです。
`(tenant_id, artifact_id, revision_id, scope_ref)`

このテーブルは、Authorityイベント列から再構築できなければなりません。

---

## 5. Consensus

### 5.1 `consensus_participant_sets`

- tenant_id
- participant_set_ref
- scope_ref
- membership_source_ref?
- created_at

不変にします。

### 5.2 `consensus_participants`

- tenant_id
- participant_set_ref
- actor_ref
- actor_kind
- eligibility_role_ref?

ユニーク制約は次のとおりです。
`(tenant_id, participant_set_ref, actor_ref)`

参加者の更新は禁止します。訂正するときは、新しい参加者集合を作ります。

Consensus Policy本体は、別のポリシーレジストリまたはコンテンツ契約の候補とします。このIssueでは、投票の数式を固定しません。

---

## 6. 交換

### 6.1 `artifact_import_sessions`

候補は次のとおりです。

- tenant_id
- import_session_id
- source_network_ref
- bundle_digest
- state
- created_at
- completed_at?

stateの値は次のとおりです。
`staging | validated | committed | failed`

一部のAuthorityだけが適用される事態を防ぐため、ステージングと検証の段階を、基準データへのコミットと区別します。

### 6.2 `artifact_import_mappings`

- tenant_id
- import_session_id
- source_network_ref
- source_artifact_id
- source_revision_id
- local_artifact_id
- local_revision_id

出典側のIDの衝突を追跡するためのものです。

### 6.3 出典のアサーション

出典側のReviewやAuthorityは、ローカルの基準イベントとは別のレコード分類にします。

```text
source_review_assertions
source_authority_assertions
```

少なくとも、次の項目を保持できるようにします。

- 出典のネットワーク
- 出典のレコードID
- 出典のスコープ
- 安全なimport後の表現、またはコンテンツ参照
- importセッション
- created_at

ローカルのAuthority reducerは、これらを入力にしません。

---

## 7. Relationの投影インデックス

Relationの成果物そのものは、基準となる成果物です。

高速なクエリ用のインデックスは、導出されたものです。

候補は次のとおりです。

```text
semantic_relation_index
  tenant_id
  relation_artifact_id
  relation_revision_id
  predicate
  participant_ordinal
  participant_role
  target_kind
  target_ref
```

- 未知の拡張predicateを保持する。
- インデックスが失われたときは、Relationのペイロードから再構築する。
- インデックスの行から、Relationのペイロードを逆生成しない。

---

## 8. 制約の責務マトリクス

| 不変条件 | DB | トランザクション | 検証 |
|---|---:|---:|---:|
| テナントをまたぐ外部キーの禁止 | ○ |  |  |
| 厳密なリビジョンの存在 | ○ |  |  |
| 親が同じ成果物であること | ○ 複合外部キー |  |  |
| 親の循環の禁止 |  |  | ○ |
| semantic kindの不変 | スキーマ + 更新経路なし | ○ | ○ |
| ペイロードのkindとスキーマの一致 |  |  | ○ |
| ペイロードのダイジェストの一致 |  | ○ 読み込み時と書き込み時 | ○ |
| Reviewの対象が厳密なリビジョン | ○ |  |  |
| AI Review != human Review | 列挙 + ポリシー | ○ | ○ |
| Authorityの expectedFrom の一致 |  | ○ CAS |  |
| Authority Scopeの存在 | ○ |  |  |
| 親スコープのAuthorityを継承しない |  | ○ | ○ |
| 参加者スナップショットの不変 | 更新経路なし | ○ |  |
| Consensus != Reviewの件数 |  | ○ | ○ |
| importしたAuthorityを昇格しない | 別テーブル | ○ | ○ |
| バンドルのクロージャ |  |  | ○ |
| importでのIDの衝突 |  | ○ | ○ |
| 未知の拡張Relationの保全 |  |  | ○ |
| 拡張Relationの副作用の禁止 |  | ○ | ○ |
| 保持ルートの保護 |  | ○ GC | ○ |

---

## 9. DB移植性の注記

### SQLite

- 複合外部キー、ユニーク、check制約は利用できる。
- 並行性は、単一ライターという特性を考慮する。
- 共有スキーマのSaaSは対象外とする。
- Authority CASのフィクスチャでは、SQLite固有のロック挙動と、意味の契約を分けて検証する。

### PostgreSQL

- 共有スキーマのSaaSが対象となる。
- RLSは、既存のテナントポリシーに従う。
- JSONBと再帰CTEは、最適化にだけ利用する。

### MySQL / MariaDB

- 長さ制限付きの識別子とインデックスのバイト数上限には、既存のカタログを利用する。
- JSONフィールドへの依存を、Coreの制約にしない。

### SQL Server

- 名前付き制約、長さ制限付きID、LOBについての既存方針に従う。
- 再帰機能やグラフ固有の機能を必須にしない。

### CockroachDB

- トランザクションの意味を、実DBのフィクスチャで検証する。
- 分散DBであることから、共有スキーマのSaaSに対応していると推論しない。

### Oracle

- CLOBや名前付き制約など、既存のポータブルなDDLの境界に従う。
- JSON固有の機能を、Coreの正しさに使わない。

---

## 10. Authority CASの疑似フロー

```text
BEGIN

load authority_current_state FOR UPDATE / equivalent
  by tenant + artifact + revision + scope

if current != expectedFrom:
    ROLLBACK -> stale_authority_state

validate authorizedBy / policy / participantSet / basis refs

append authority_transition

upsert authority_current_state(to_state, last_event_id)

append audit / outbox

COMMIT
```

具体的なロックの仕組みは、DBファミリのアダプタへ閉じ込めます。

CASの意味は、すべてのDBで共通にします。

---

## 11. Reviewの対象のずれに関する疑似フロー

```text
Review starts on H/r3
AI or human creates H/r4
Review submits target H/r3

=> valid Review for r3
=> does NOT review r4
=> UI should show "newer revision exists"
=> r4 remains unreviewed
```

「最新リビジョンへの自動的な読み替え」は禁止します。

---

## 12. importのステージングに関する疑似フロー

```text
parse bundle
  ↓
schema / version
  ↓
SafeMode fixed-point / permission
  ↓
closure / external dependency
  ↓
identity collision
  ↓
source Review / Authority -> source assertion
  ↓
prepare payload blobs
  ↓
canonical transaction
  ↓
import mappings
  ↓
outbox
  ↓
materialized network
```

失敗したときは、次のとおりにします。

- ローカルのAcceptedやConsensusを残さない。
- ローカルのhuman Reviewを残さない。
- readyになっていないペイロードを、基準リビジョンから参照しない。
- 外部BLOBの孤児は、既存のContent Storeの回収規則へ送る。

---

## 13. マイグレーションの前に未決のもの

- 物理名の確定
- IDの生成アルゴリズム
- lifecycleを、リビジョンのエンベロープに固定するか、追記専用イベントへ分離するか
- Reviewのfindingを、長さ制限付きの行にするか、コンテンツオブジェクトにするかの境界
- Consensus Policyの永続化
- importした出典のアサーションのペイロード形状
- マテリアライザのoutboxで、既存テーブルを再利用できるか
- 現在状態キャッシュの復旧操作
- Relationインデックスの更新の粒度
- GCの到達可能性アルゴリズムを、DBに依存せず実装する方法

これらは、フィクスチャやベンチマークなしにマイグレーションへ固定しません。
