# ADR-0088: semantic artifact persistenceはRDB metadata/event正本 + Content Store payload + materialized networkを第一候補とする

- Status: Accepted
- Date: 2026-09-18
- Deciders: Maintainer
- Scope: semantic artifactの物理的な永続化の候補
- Related: `ADR-0066`, `ADR-0070`, `ADR-0071`, `ADR-0085`, `ADR-0086`, `ADR-0087`
- Runtime impact: この変更では影響なし
- Migration impact: この変更では影響なし

## Context

semantic artifact契約は、Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Decision、およびそのリビジョン、Review、Authority、Scope、Consensusの参加者、交換履歴を扱う。

物理的な永続化には複数の候補がある。

- すべてをRDBへ正規化する
- JSON集約にする
- グラフデータベースにする
- オブジェクトストアまたはコンテンツストアを中心にする
- RDBのメタデータ + 内容アドレス指定のpayload + マテリアライズしたグラフにする

SUIにはすでに次の設計資産がある。

- 検証済みRDBファミリとポータブルなマイグレーション方針（ADR-0066）
- content objectをContent Storeの背後へ置く方針
- canvas revisionを、不透明なリビジョンID、コンテンツダイジェスト、blobへ分ける方針（ADR-0070）
- Document DBと派生プロジェクションを正本にしない方針（ADR-0071）
- SUI Information NetworkとQualitativeNetworkSnapshotを、問い合わせ用の読み取りモデルとして扱う方針

semantic artifactだけグラフDBを正本にすると、テナント認可、トランザクション、ReviewとAuthorityのCAS、保持期間、インポート時の衝突、ポータブルなDB対応を二重に実装することになる。

一方、種別ごとのpayloadをRDBの列へ完全に分解すると、新しいsemantic kindやAIネイティブなpayloadを足すたびにマイグレーションの負担が増える。

## Decision

### D1. 第一候補を「RDB metadata/event + Content Store payload」とする

正本となるメタデータとeventは、検証済みRDBへ置く。

種別ごとのsemantic payloadは、正規化したJSONのcontent objectとして、Content Store契約の背後へ置く。

```text
RDB canonical metadata/events
  ├─ artifact identity
  ├─ revision metadata
  ├─ provenance refs
  ├─ Review
  ├─ Authority Scope / transition
  ├─ participant snapshot
  ├─ import mapping / source assertions
  └─ retention roots
          │
          │ payload digest / content ref
          ▼
      Content Store
          │
          ▼
   semantic payload JSON
```

Content Storeの既定のバックエンドは、既存方針どおりデータベースへのインライン保存を使える。NASやS3などを、semantic artifact専用に必須とはしない。

### D2. artifact identityとrevisionは、RDBの上限付きmetadataとして保持する

論理的なレコードクラスを次のように分ける。

- SemanticArtifact
- SemanticArtifactRevision
- ReviewRecord
- AuthorityScope
- AuthorityTransition
- ConsensusParticipantSet
- SourceReviewAssertion
- SourceAuthorityAssertion
- ExchangeImportMapping
- RetentionPin

具体的なテーブル名は実装issueで決める。ただし、責務を一つの巨大なJSON集約へまとめない。

### D3. semantic payloadの本文を、revision行の巨大なJSONに直接依存させない

Revisionは、payloadのcontent ref、ダイジェスト、スキーマ参照を持つ方向とする。

```text
revisionId
semanticKind
payloadSchema
payloadDigest
payloadContentRef
parent refs
provenance refs
lifecycle
```

これにより、次の点をrevision identityから切り離せる。

- payload本文の大きさ
- DBファミリごとのLOB
- 将来の外部Content Store
- 重複排除とコーデック
- SafeModeの派生payload

ただし、Content Store上のblobを重複排除しても、artifactの論理identityを統合してはならない。

### D4. 既存の `content_blobs` とContent Storeの再利用を優先して検討する

semantic artifact専用の第二のContent Storeは作らない。

既存のContent Storeが次を満たせるなら、同じportとblob契約を再利用する。

- テナント単位のメタデータ
- UTF-8バイト列
- バイトサイズ
- SHA-256
- スキーマバージョン
- バックエンドの抽象化

ただし、canvas revisionのpayloadとsemantic payloadを、同じ論理revisionテーブルへ統合しない。

### D5. Relationもsemantic artifactとして正本にする

Relation専用のエッジテーブルを正本にはしない。

Relation artifactのpayloadはContent Storeへ置き、revisionのメタデータをRDBで管理する。

問い合わせの性能のために、次の項目はマテリアライズしたインデックスやプロジェクションへ展開してよい。

- predicate
- 参加者への参照
- from/toに相当する項目
- ネットワークの隣接関係

プロジェクションからRelation artifactを逆に生成することはしない。

### D6. Information Networkとグラフストアは、materializedな読み取りモデルとする

グラフDBを正本にはしない。

必要なら、次のいずれかへInformation Networkをマテリアライズできる。

- RDBのプロジェクションテーブル
- インメモリのグラフ
- グラフDB
- 検索インデックス

```text
canonical RDB + payload
       │
       ▼
materializer
       │
       ├─ RDB network projection
       ├─ graph DB projection
       └─ search / vector / sparse index
```

プロジェクションが失われても、正本のレコードから再構築できなければならない。

### D7. Authorityの現在状態はキャッシュしてよいが、event列を正本とする

authority transitionは、追記専用でRDBへ保存する。

性能のために、次の対応を持つマテリアライズしたキャッシュを置ける。

```text
artifact revision + scope -> current authority state
```

transitionのトランザクションでは、次の手順を同じトランザクションで扱う方向とする。

1. 現在状態をロックし、CASで確認する
2. `expectedFrom` を検証する
3. eventを追記する
4. 現在状態のキャッシュを更新する

キャッシュが壊れた場合は、event列から再構築できる。

### D8. Reviewは追記専用とし、authorityのトランザクションとは分ける

Reviewの追記とAuthorityの昇格を、同じレコードにしない。

UI上で「Reviewして採用」を一つの操作に見せる場合も、アプリケーションサービスは次の二つを、意味上は別の操作として実行する。

1. Reviewの追記
2. Authority transition

必要なら同じDBトランザクションへ含めてよい。ただし、一方から他方を推論しない。

### D9. provenance relationは、厳密なrevisionへの外部キー相当で検証する

artifact間の入力と系譜の参照は、次をアプリケーション制約またはDB制約で検証できなければならない。

- 同じテナントであること
- 厳密なartifact revisionが存在すること
- semantic kindの制約
- 循環の制約（必要なroleのみ）

外部のsource refには、同じ外部キーを求めない。ただし、source registryへ解決できる場合は、テナントと権限の境界を確認する。

### D10. RDBのポータビリティを保ち、JSON演算にコアの正しさを依存させない

検証済みのDBすべてで成立することを前提に、次の項目はポータブルな上限付きの列で表す。

- identity
- 外部キー
- 一意制約
- ライフサイクルとauthorityの状態
- createdAt
- スキーマ参照
- ダイジェスト

こうしたコアの正しさは、列で表現する。種別ごとのpayloadの内容検索やJSON path演算を、ReviewとAuthorityの正しさの必須条件にはしない。

PostgreSQL固有のJSONBや再帰クエリなどは、最適化としてのみ使う。

### D11. テナントとSaaSの境界は、既存のDB方針を引き継ぐ

共有スキーマのSaaSでは、semantic artifactのメタデータ、Review、Authority event、contentのメタデータのすべてにテナントガードを適用する。

PostgreSQL以外で共有スキーマのSaaSに対応できるとは、新たに推論しない。

actor ref、source ref、import mappingを通じたテナント越境は許可しない。

### D12. exchange importは、ステージング、検証、正本へのコミットの順とする

artifactの交換バンドルのimportは、正本のテーブルへ直接、逐次書き込まない。

概念上は、次の順で扱う。

```text
parse
  -> schema validate
  -> SafeMode / permission validate
  -> closure validate
  -> identity collision validate
  -> source authority de-privilege
  -> canonical commit
```

大規模なバンドルで単一のトランザクションが不適切な場合でも、「一部だけがローカルのauthorityへ入った」状態を作らないステージング契約を設ける。

### D13. backupとrestoreに、exchange importの経路を流用しない

バックアップと災害復旧は、同じauthorityドメインを正しく復元するための運用契約である。source authorityの特権を外すexchangeとは、意味が異なる。

同じAPIやモードフラグで、両者を曖昧に切り替えない。

### D14. 保持とGCは、正本への参照をrootとする

semantic artifactのGCは、少なくとも次をルート、または保護の入力として扱う。

- 現在および過去のAuthority event
- Reviewの対象
- Decisionの根拠
- 保持されるRelationの対象
- participantとsource assertionからの参照
- 明示的なpin
- 統制されたチェックポイント
- exchange import mappingの保持方針

payload blobは、revisionからの参照がなくなっても、Content Storeの既存方針に従い、保留期間と参照の再確認を経てから削除する。

プロジェクションとReview Capsuleのキャッシュは、保持のルートにしない。

### D15. 物理スキーマの実装は、別のissueへ分ける

本ADRは永続化方式の第一候補を選ぶだけで、マイグレーションは始めない。

実装の前に、次を検証する専用の実装issueを起票する。

- ポータブルなスキーマの草案
- 代表的なフィクスチャ
- RDBファミリごとのコンパイルと制約のレビュー
- payloadの往復
- importのステージング
- authorityのCAS
- GC
- プロジェクションの再構築

## Alternatives

| Candidate | 長所 | 主な問題 | 判断 |
|---|---|---|---|
| 巨大なJSONの集約 | 初期実装が容易 | 厳密なrevisionの外部キー、同時実行のauthority、部分的な問い合わせ、GCが弱い | 不採用 |
| 完全に正規化したpayloadの列 | 制約が強い | semantic kindを足すたびにマイグレーションが要り、自由度が下がる | payloadの正本としては不採用 |
| グラフDBを正本にする案 | Relationの問い合わせに強い | テナント、トランザクション、ポータビリティ、authority eventが二重になる | 不採用 |
| オブジェクトストアを正本にする案 | contentに強い | ReviewとAuthorityのCAS、外部キー、問い合わせ用メタデータに弱い | 不採用 |
| **RDBのメタデータとevent + Content Storeのpayload** | 既存のポータビリティとトランザクションを保ちつつ、payloadを柔軟にできる | マテリアライザとblobのライフサイクルが必要 | **第一候補** |

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| **業務設計** | 厳密なrevisionへのReview、scopeごとのauthority、exchangeでの特権剥奪を、トランザクションで守る | データ: Review、Authority、import mappingを独立したレコードにする。機能: 部分的なimportや古い昇格は、安全側で拒否する |
| **データ設計** | RDBのメタデータ/event + Content Store payloadを正本とし、グラフとネットワークはプロジェクションにする | 業務: payloadの自由度を保ちつつ、authorityの正しさはRDBの列と制約で守る。機能: プロジェクションを再構築できる |
| **機能設計** | importのステージング、authorityのCAS、マテリアライザ、GCを、正本への参照を中心に実装する | 業務: バックアップとexchangeを混同しない。データ: キャッシュとグラフストアを正本にしない |

## Consequences

### Positive

- 既存のDBポータビリティとContent Storeへの投資を再利用できる。
- semantic kindを足してもDBマイグレーションを最小にできる。
- AuthorityとReviewを、ポータブルなトランザクションで守れる。
- グラフ、スパース、ベクトルなどの問い合わせ技術を、正本から切り離せる。
- 将来EKIなどでmaterializationを分散実行しても、正本の意味は変わらない。

### Costs / Open questions

- 具体的なテーブルとインデックスの形は未確定である。
- payloadのContent Storeでコーデックを共有できるかは、ベンチマークが必要である。
- Relationプロジェクションの更新方式（同期かアウトボックスか）は未決である。
- 大規模バンドルのステージング方式は未決である。
- ポータブルな再帰的到達可能性とGCの実装方式は、検証が必要である。

## Non-goals

- 本ADRだけでは、マイグレーションを追加しない。
- グラフDBは禁止しない。正本としては採らないだけである。
- Content Storeの外部バックエンドを必須にしない。
- PostgreSQL固有の機能を、全DBへ強制しない。
- 現在状態のキャッシュを正本にしない。
- exchangeとbackupを、同じモードフラグにしない。

## Traceability

- `02_Architecture/database_portability.md`
- `01_Plans/adr/ADR-0070-content-addressed-generation-dag-and-git-adapter.md`
- `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- `02_Architecture/sensemaking_payload_authority_exchange_v1alpha1.md`
- `02_Architecture/sensemaking_artifact_persistence_candidate.md`
- `02_Architecture/sensemaking_artifact_portable_schema_matrix.md`
- `02_Architecture/information_network_projection_contract.md`
