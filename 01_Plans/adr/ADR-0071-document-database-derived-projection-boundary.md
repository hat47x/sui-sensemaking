# ADR-0071: Document DBをRDB正本の代替ではなく再構築可能な派生projection候補とする

- Status: Accepted
- Date: 2026-08-10
- Deciders: Maintainer
- Scope: persistence architecture, realtime collaboration, offline/read projection, revision DAG

## Context

KJキャンバスは、JSONドキュメントとして扱いやすい。FirestoreやDynamoDBには、柔軟なドキュメントモデル、マネージドなスケーリング、リアルタイムとオフラインの連携という、採用する価値がある。一方、sui-sensemakingの永続化では、キャンバスの本文だけでなく、次の項目を、同じ整合性の境界で管理する。

- テナントの認可
- 複合外部キー
- identityの一意性
- 監査
- AIのlineage
- content-addressedなrevision DAG
- 保持pin
- GC

現在の代表的なキャンバスは、1 MiBを超える大きさを、実DBのマトリクスで検証している。Firestoreのドキュメントの上限は1 MiBで、DynamoDBのitemの上限は、属性名を含めて400 KiBである。そのため、キャンバス全体を、単一のドキュメントやitemへ保存することはできない。Firestoreのトランザクションは、競合したときに再実行され、オフラインでは失敗する。さらに、リクエストの上限10 MiB、ロックの期限20秒、全体で270秒という制約がある。DynamoDBのトランザクションは、同一のアカウントとリージョン内で、最大100 item、合計4 MiBまでである。また、Global Tablesへの反映は、リージョン間のトランザクションではない。

本文を分割すれば、保存そのものは可能である。しかし、chunk、マニフェスト、原子的なheadの更新、孤立したデータの回収、テナントの認可、世代のGCが、既存のcontent-addressedなDAGと二重になる。また、Document DBを、SQLAlchemyのdialectのように扱うこともできない。RDBの昇格マトリクスとは別に、リポジトリ、マイグレーション、トランザクション、バックアップの契約が必要になる。

## Decision

1. RDBを、テナントの認可、documentのhead、revision DAG、監査、AIのlineage、保持とGCのmetadataの正本として維持する。Firestore/DynamoDBを、RDBの代替バックエンドとして、DB能力レジストリへ登録しない。
2. キャンバスの本文とrevision blobの物理的な保存は、既存の`ContentStore`の境界で扱う。Document DB固有のchunkingを追加して、revision DAGを複製しない。
3. Document DBの採用候補は、正本から再構築でき、失われても権限、履歴、監査を失わない、派生用途に限る。
   - オンラインのpresence、カーソル、選択、入力中の表示など、短命な協調作業の状態
   - 受信箱、最近使った文書、検索候補などの、読み取り用のprojection
   - オフラインでの取得を速くする、暗号化済みのキャッシュのマニフェスト。ただし、未同期の編集を正本にすることには、別のADRを必須とする
4. 派生データの更新は、RDBのトランザクション内のoutboxを起点に、非同期で反映する。アプリケーションのトランザクションから、RDBとDocument DBへdual writeしない。
5. projectionは、`tenant_id + projection_kind + source_version`を持ち、RDBでの認可の判定の後にだけ配信する。projection側のsecurity ruleやIAMだけを、正本の認可として信頼しない。
6. 古いprojectionであることを明示できるように、source versionを返す。更新が遅れたり、欠落したりしたときは、RDBへフォールバックする。projectionからRDBの正本を、逆に生成しない。
7. TTL、削除要求、テナントの退会、SafeMode、暗号化、リージョン、バックアップ、費用の上限を、プロバイダ別の昇格ゲートで実証するまでは、実行時の設定を公開しない。
8. FirestoreとDynamoDBを、1つの抽象的な「Document DB adapter」へ、早い段階で統合しない。具体的なアクセスパターンが成立した時点で、用途別のportに対する最小のadapterとして比較する。

## Provider assessment

| 観点 | Firestore | DynamoDB | sui-sensemaking判断 |
| --- | --- | --- | --- |
| 単一objectの上限 | document 1 MiB | item 400 KiB | canvasとrevision blobの正本には不適合 |
| 複数objectのtransaction | 競合時はretry、10 MiBのrequest、offlineでは失敗 | 最大100 item・4 MiB・同一account/Region | 既存のRDB transactionを置き換える理由にならない |
| realtime/offline | client SDKとの統合の価値が高い | Streams/AppSyncなどの追加の構成が必要 | presenceやread projectionなら、Firestoreを先に評価できる |
| access pattern | collection/query/indexの設計 | partition/sort keyを先に固定 | 汎用のリポジトリにせず、用途別に評価する |
| vendor portability | Google/Firebase固有 | AWS固有 | 再構築できるprojectionに限定して、lock-inを封じる |

## Promotion gate for a future pilot

1. 実際のアクセスパターンとSLOを先に固定し、RDBだけのベースラインより価値があることを計測する。
2. projectionの再構築、重複したイベント、順序の逆転、遅延、プロバイダの障害、レート制限を、フィクスチャで再現する。
3. テナントA/Bの越境、認可の失効、削除、TTL、バックアップと復元、リージョンの境界を、実際のサービスまたは公式のエミュレータと、本番相当のIAMで検証する。
4. source versionが一致しないときの、古い表示とRDBへのフォールバックを確認する。
5. SDK、credential、費用のテレメトリ、ヘルスチェックを、任意の連携の中に閉じ込め、コアの実行時の依存にしない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | キャンバスはJSONとして扱いやすい。しかし、永続化では、本文だけでなく、テナントの認可、複合外部キー、identityの一意性、監査、AIのlineage、revision DAGを、同じ整合性の境界で管理する必要がある。JSONの形との相性だけで、検証済みのトランザクション、制約、revision DAGを捨てない | 機能: RDBを正本として維持し、Document DBをDB能力レジストリへ登録しない。データ: リアルタイムの需要が生じたら、Document DBの強みだけを利用する |
| **データ設計** | キャンバスの本文とrevision blobの物理的な保存は、既存の`ContentStore`の境界で扱う。Document DB固有のchunkingを追加して、revision DAGを複製しない。Document DBの採用候補は、正本から再構築でき、失われても権限、履歴、監査を失わない、派生用途（presence、read projection、キャッシュのマニフェスト）に限る | 業務: projectionは`tenant_id + projection_kind + source_version`を持ち、RDBでの認可の判定の後にだけ配信する。機能: 古いprojectionはsource versionを返し、更新が遅れたり欠落したりしたときは、RDBへフォールバックする |
| **機能設計** | 派生データの更新は、RDBのトランザクション内のoutboxを起点に非同期で反映し、dual writeを行わない。projection側のsecurity ruleやIAMだけを、正本の認可として信頼しない。Firestore/DynamoDBを、抽象的なDocument DB adapterへ早い段階で統合しない | 業務: outbox、projectionのworker、古さの表示、プロバイダ別の障害試験が必要になる。需要とSLOが未確定の現時点では、実装しない。データ: TTL、削除、テナントの退会、SafeMode、暗号化、バックアップ、費用の上限を、昇格ゲートで実証するまで、実行時の設定を公開しない |

## Consequences

- JSONとの形の上での相性だけで、すでに検証済みのトランザクション、制約、revision DAGを、捨てずに済む。
- リアルタイムの協調作業に、具体的な需要が生じた場合は、Document DBの強みだけを利用できる。
- outbox、projectionのworker、古さの表示、プロバイダ別の障害試験が必要になる。そのため、需要とSLOが未確定の現時点では、実装しない。
- RDB、NAS/S3、Git、Document DBの責務が分離され、複数の「正本」が競合する状態を避けられる。

## Evidence

- [Firestore usage and limits](https://firebase.google.com/docs/firestore/quotas)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [DynamoDB constraints](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Constraints.html)
- [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)

## Traceability

- `01_Plans/issues/done/issue-DB-DOCUMENT-01-document-database-derived-projection.md`
- `01_Plans/adr/ADR-0066-database-portability-capability-registry.md`
- `01_Plans/adr/ADR-0070-content-addressed-generation-dag-and-git-adapter.md`
- `02_Architecture/database_portability.md`
