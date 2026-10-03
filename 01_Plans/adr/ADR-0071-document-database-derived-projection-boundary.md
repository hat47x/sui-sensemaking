# ADR-0071: Document DBをRDB正本の代替ではなく再構築可能な派生projection候補とする

- Status: Accepted
- Date: 2026-08-10
- Deciders: Maintainer
- Scope: 永続化のアーキテクチャ、リアルタイムの協調作業、オフラインと読み取り用の投影、リビジョンDAG

## Context

KJキャンバスは、JSONドキュメントとして扱いやすい。FirestoreやDynamoDBには、柔軟なドキュメントモデル、マネージドなスケーリング、リアルタイムとオフラインの連携という、採用する価値がある。一方、sui-sensemakingの永続化では、キャンバスの本文だけでなく、次の項目を、同じ整合性の境界で管理する。

- テナントの認可
- 複合外部キー
- IDの一意性
- 監査
- AIの系譜
- 内容アドレス方式のリビジョンDAG
- 保持のpin
- GC

現在の代表的なキャンバスは、1 MiBを超える大きさを、実DBのマトリクスで検証している。Firestoreのドキュメントの上限は1 MiBで、DynamoDBの項目の上限は、属性名を含めて400 KiBである。そのため、キャンバス全体を、単一のドキュメントや項目へ保存することはできない。Firestoreのトランザクションは、競合したときに再実行され、オフラインでは失敗する。さらに、リクエストの上限10 MiB、ロックの期限20秒、全体で270秒という制約がある。DynamoDBのトランザクションは、同一のアカウントとリージョン内で、最大100項目、合計4 MiBまでである。また、Global Tablesへの反映は、リージョン間のトランザクションではない。

本文を分割すれば、保存そのものは可能である。しかし、チャンク、マニフェスト、原子的なheadの更新、孤立したデータの回収、テナントの認可、世代のGCが、既存の内容アドレス方式のDAGと二重になる。また、Document DBを、SQLAlchemyの方言（dialect）のように扱うこともできない。RDBの昇格マトリクスとは別に、リポジトリ、マイグレーション、トランザクション、バックアップの契約が必要になる。

## Decision

1. RDBを、テナントの認可、文書のhead、リビジョンDAG、監査、AIの系譜、保持とGCのメタデータの正本として維持する。Firestore/DynamoDBを、RDBの代替バックエンドとして、DB能力レジストリへ登録しない。
2. キャンバスの本文とrevision blobの物理的な保存は、既存の`ContentStore`の境界で扱う。Document DB固有のチャンク分割を追加して、リビジョンDAGを複製しない。
3. Document DBの採用候補は、正本から再構築でき、失われても権限、履歴、監査を失わない、派生用途に限る。
   - オンラインのプレゼンス、カーソル、選択、入力中の表示など、短命な協調作業の状態
   - 受信箱、最近使った文書、検索候補などの、読み取り用の投影
   - オフラインでの取得を速くする、暗号化済みのキャッシュのマニフェスト。ただし、未同期の編集を正本にすることには、別のADRを必須とする
4. 派生データの更新は、RDBのトランザクション内のアウトボックスを起点に、非同期で反映する。アプリケーションのトランザクションから、RDBとDocument DBへ二重書き込みしない。
5. 投影は、`tenant_id + projection_kind + source_version`を持ち、RDBでの認可の判定の後にだけ配信する。投影側のセキュリティルールやIAMだけを、正本の認可として信頼しない。
6. 古い投影であることを明示できるように、元のバージョンを返す。更新が遅れたり、欠落したりしたときは、RDBへフォールバックする。投影からRDBの正本を、逆に生成しない。
7. TTL、削除要求、テナントの退会、SafeMode、暗号化、リージョン、バックアップ、費用の上限を、プロバイダ別の昇格ゲートで実証するまでは、実行時の設定を公開しない。
8. FirestoreとDynamoDBを、1つの抽象的な「Document DBのアダプタ」へ、早い段階で統合しない。具体的なアクセスパターンが成立した時点で、用途別のポートに対する最小のアダプタとして比較する。

## Provider assessment

| 観点 | Firestore | DynamoDB | sui-sensemakingの判断 |
| --- | --- | --- | --- |
| 単一オブジェクトの上限 | ドキュメント1 MiB | 項目400 KiB | キャンバスとリビジョンのblobの正本には不適合 |
| 複数オブジェクトのトランザクション | 競合時は再試行、リクエストは10 MiBまで、オフラインでは失敗 | 最大100項目・4 MiB・同一アカウントとリージョン | 既存のRDBのトランザクションを置き換える理由にならない |
| リアルタイムとオフライン | クライアントSDKとの統合の価値が高い | Streams/AppSyncなどの追加の構成が必要 | プレゼンスや読み取り用の投影なら、Firestoreを先に評価できる |
| アクセスパターン | コレクション、クエリ、索引の設計 | パーティションキーとソートキーを先に固定 | 汎用のリポジトリにせず、用途別に評価する |
| ベンダー間の可搬性 | Google/Firebase固有 | AWS固有 | 再構築できる投影に限定して、ロックインを封じる |

## Promotion gate for a future pilot

1. 実際のアクセスパターンとSLOを先に固定し、RDBだけのベースラインより価値があることを計測する。
2. 投影の再構築、重複したイベント、順序の逆転、遅延、プロバイダの障害、レート制限を、フィクスチャで再現する。
3. テナントA/Bの越境、認可の失効、削除、TTL、バックアップと復元、リージョンの境界を、実際のサービスまたは公式のエミュレータと、本番相当のIAMで検証する。
4. 元のバージョンが一致しないときの、古い表示とRDBへのフォールバックを確認する。
5. SDK、認証情報、費用のテレメトリ、ヘルスチェックを、任意の連携の中に閉じ込め、コアの実行時の依存にしない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | キャンバスはJSONとして扱いやすい。しかし、永続化では、本文だけでなく、テナントの認可、複合外部キー、IDの一意性、監査、AIの系譜、リビジョンDAGを、同じ整合性の境界で管理する必要がある。JSONの形との相性だけで、検証済みのトランザクション、制約、リビジョンDAGを捨てない | 機能: RDBを正本として維持し、Document DBをDB能力レジストリへ登録しない。データ: リアルタイムの需要が生じたら、Document DBの強みだけを利用する |
| **データ設計** | キャンバスの本文とrevision blobの物理的な保存は、既存の`ContentStore`の境界で扱う。Document DB固有のチャンク分割を追加して、リビジョンDAGを複製しない。Document DBの採用候補は、正本から再構築でき、失われても権限、履歴、監査を失わない、派生用途（プレゼンス、読み取り用の投影、キャッシュのマニフェスト）に限る | 業務: 投影は`tenant_id + projection_kind + source_version`を持ち、RDBでの認可の判定の後にだけ配信する。機能: 古い投影は元のバージョンを返し、更新が遅れたり欠落したりしたときは、RDBへフォールバックする |
| **機能設計** | 派生データの更新は、RDBのトランザクション内のアウトボックスを起点に非同期で反映し、二重書き込みを行わない。投影側のセキュリティルールやIAMだけを、正本の認可として信頼しない。Firestore/DynamoDBを、抽象的なDocument DBのアダプタへ早い段階で統合しない | 業務: アウトボックス、投影のワーカー、古さの表示、プロバイダ別の障害試験が必要になる。需要とSLOが未確定の現時点では、実装しない。データ: TTL、削除、テナントの退会、SafeMode、暗号化、バックアップ、費用の上限を、昇格ゲートで実証するまで、実行時の設定を公開しない |

## Consequences

- JSONとの形の上での相性だけで、すでに検証済みのトランザクション、制約、リビジョンDAGを、捨てずに済む。
- リアルタイムの協調作業に、具体的な需要が生じた場合は、Document DBの強みだけを利用できる。
- アウトボックス、投影のワーカー、古さの表示、プロバイダ別の障害試験が必要になる。そのため、需要とSLOが未確定の現時点では、実装しない。
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
