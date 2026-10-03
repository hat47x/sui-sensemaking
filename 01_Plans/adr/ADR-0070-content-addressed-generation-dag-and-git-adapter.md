# ADR-0070: KJキャンバス世代をcontent-addressed DAGで管理しGitを任意adapterとする

- Status: Accepted
- Date: 2026-08-09
- Deciders: Maintainer
- Scope: Document persistence, Content Store, inquiry snapshots, AI collaboration provenance

## Context

KJ法キャンバスは、長期の編集、分岐、統合、人間と生成AIの提案と採否、探究ラウンドの節目を持ち得る。全スナップショットを複製すると容量が増える。全操作イベントを永続化すると、再生、移行、削除、SafeModeの複雑さが過大になる。

Gitには、content-addressedなobject、delta圧縮、DAG、merge、交換可能性という魅力がある。一方、Git commitを実行時の正本にすると、テナント認可、RDBトランザクション、保持期間、PII削除、objectのGC、同時更新が、Gitの意味に縛られる。

現行には、意味の異なる複数の「version」がある。

- `Document.version` はスキーマバージョンである。
- HTTP ETagは、現在の本文ダイジェストである。
- `RoundSnapshotV1` は、人が確認した探究成果である。
- merge decision logは、判断の履歴である。

これらは、新しい編集世代と同一視できない。

## Decision candidate

1. キャンバスの編集世代を、Gitに依存しないcontent-addressedなrevision DAGとして定義する。revisionはコンテンツダイジェストと親revisionを持ち、物理的な本文は既存のContent Storeへ保存する。
2. 全操作のevent sourcingは採用しない。扱うのは、自動保存、意味のあるcheckpoint、統制対象のcheckpointという3段階だけである。
3. `ephemeral` は自動保存用とし、親、ダイジェスト、時刻、理由だけの最小限のメタデータにする。actor、プロンプト、モデル、AI runは付けず、件数と期間で回収する。
4. `checkpoint` は、手動保存、探究ラウンド、ブランチ、マージ、インポート、AI提案、人による提案の採用に使う。必要な由来の参照だけを持つ。
5. `governed` は、人間によるレビュー、共有、エクスポートなど、再現、説明、監査が必要な節目に使う。不透明なactor、ポリシーとスキーマの参照、保持の判断を、別のメタデータで必須にする。
6. AI提案のrevisionでは、`ai_run_ref` を必須とする。AI runのタスク、入力IRのダイジェスト、出力のダイジェスト、ポリシーバージョンなどは別のレコードへ置く。プロバイダ、モデル、プロンプトを全revisionへ複製しない。生のプロンプトや未レビューの本文を、世代のメタデータへ保存しない。
7. 人がAI提案を採用した場合は、人間を起点とする新しいrevisionを作り、元の提案revisionを参照する。AI提案をhuman-authoredやhuman-reviewedへ書き換えない。
8. 圧縮は、正規化したJSONを前提に、content-addressedなchunkまたはdeltaと、定期的なfull snapshotを組み合わせる。deltaの連鎖には上限を設ける。復元のコストまたはdeltaの比率が閾値を超えたら、full snapshotへ戻す。具体的な値は、代表データのベンチマークで決める。
9. Gitは、アーカイブ、インポート・エクスポート、オフライン協調に限った任意のadapter候補とする。標準の実行時の正本にも、ホットパスのblob保存先にもしない。採用する場合も、アプリケーションのrevision IDとSHA-256ダイジェストを正本とする。GitのオブジェクトIDやブランチrefを、認可や真正性の根拠にしない。
10. Git adapterは、bareリポジトリ、サーバー管理のref、フック無効、worktreeなしを前提とする。テナント分離、暗号化、GC、削除、packのバックアップと復元、同時書き込みを検証するまで、有効にしない。
11. revisionと物理blobを分離する。複数のrevisionが、同じ `tenant + content digest` を持つ不変のblobを参照できる。保存先のバックエンドは、データベース、NAS、S3、将来のGitのいずれでもよい。revisionごとにobjectを複製しない。
12. NAS/S3は、revision DAGと競合する代替の正本ではない。full snapshot、delta、chunkの物理blobバックエンド候補とする。ただし、実行時の切り替え、コーディネータ、ドメイン外部キーの実装は優先度を下げ、revisionスキーマと圧縮のベンチマークが確定するまで凍結する。
13. 現行の `content_object_references` は、外部保存の先行メタデータであり、最終的なスキーマとは扱わない。revisionを導入するときに、`content_blobs`（ダイジェストをidentityとする）と `canvas_revisions`（論理的な世代）へ責務を分ける。既存テーブルは、互換マイグレーションまたは撤去の対象として再評価する。
14. 正規化JSONは、UTF-8、キーの辞書順、余分な空白なし、NaN/Infinity禁止とする。fullとdeltaのどちらにするかは、保存先のバックエンドではなくコーデックが決める。deltaの連鎖の上限または圧縮比の閾値を超えた場合は、full gzipへ戻す。復元後のダイジェストの検証に成功するまで、Documentとして解釈しない。
15. 保持のGCは、mark-and-sweep型とし、最初は候補の列挙だけを行う。head、DAGの親、元の提案、明示的なpinから到達できるrevisionは削除しない。checkpointとgovernedは、期限で自動削除しない。revisionを削除した後も、参照数がゼロで保留期間を過ぎたことを確認するまで、物理blobを削除しない。
16. revisionの削除時には、保護条件を同じDELETE文で再評価する。候補の列挙後にpinやheadが追加されて競合した場合は、安全側で拒否する。blobのsweepは、revisionからの参照とdeltaのbaseからの参照がともにゼロで、`failed|deleting` のまま保留期限を過ぎたobjectだけを対象とする。
17. AIの実行は `ai_generation_runs` へ分離し、次の項目だけを保存する。
    - タスク
    - 監査ログと結ぶためのトレースID
    - 入力IRのダイジェスト
    - 出力blobのダイジェスト
    - ポリシーバージョン
    - SafeMode
    - 作成日時と保持期限

    プロンプト、入出力の本文、プロバイダ、モデル、トランスポートは、revision DAGへ複製しない。同じテナントのAI runを参照できるのは、AI提案のrevisionだけである。SafeModeが無効なrunは、DB制約で拒否する。
18. GCによるrevisionとblobの削除では、本文を含まない追記専用の監査を残す。blobのGCは、対象の行をロックしたトランザクション内で参照を再確認し、`deleting` へ遷移してから物理バックエンドを削除する。メタデータの削除と成功の監査は、同じトランザクションに置く。物理削除に失敗したときは、行を `deleting` のまま残して失敗の監査を記録し、再試行できるようにする。外部I/Oの間も行をロックしたままにすることは、GCワーカーに限り、安全性を優先したトレードオフとして許容する。
19. ephemeralの件数による保持は、単一ブランチの連番ではなく、テナント内のDAGの到達性で計算する。手順は次のとおりである。
    - 全head、pin、checkpointとgovernedのrevision、元の参照先をrootとする。
    - 各rootから、各親の経路上で設定件数以内のephemeralを集め、その和集合を保持する。
    - 保持範囲外との境界のエッジを切断する。
    - 候補となる部分DAGを、子から先に削除する。

    共有された祖先が、いずれかのrootから保持範囲内にあるなら削除しない。循環、親の欠損、削除中の保護条件の変更があれば、トランザクション全体を安全側で拒否する。

## Alternatives

| 方式 | 圧縮・重複排除 | 分岐 | tenant／認可 | 削除・retention | 判断 |
| --- | --- | --- | --- | --- | --- |
| 毎回full snapshot | 弱い | 可能 | 既存DBで容易 | 容易だが容量大 | 小規模な代替 |
| 操作event sourcing | 強い | 強い | 実装可能 | 再生・削除が複雑 | 不採用継続 |
| Gitを実行時の正本 | 強い | 強い | RLSやトランザクションと不整合 | GC・履歴改変が難しい | 標準不採用 |
| 独自revision DAG + Content Store | バックエンド非依存 | 強い | DBのメタデータで維持 | ポリシーで制御可能 | 推奨候補 |
| 独自DAG + optional Git adapter | 上記 + Git交換性 | 強い | コアから分離 | アダプタ単位で管理 | 将来候補 |

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | KJキャンバスは、長期の編集、分岐、統合、人間と生成AIの提案の採否、探究ラウンドの節目を持つ。AI提案と人間による採用の系譜を保ちつつ、proposal-onlyとhuman reviewの境界を維持する | 機能: AI提案のrevisionでは `ai_run_ref` を必須にする。人が採用した場合は、人間を起点とする新revisionを作って元を参照し、AI提案をhuman-authoredへ書き換えない。データ: 生のプロンプトや未レビューの本文を、世代のメタデータへ保存しない |
| **データ設計** | キャンバスの編集世代を、Gitに依存しないcontent-addressedなrevision DAGとして定義する（revisionはコンテンツダイジェストと親を持ち、物理本文はContent Storeに置く）。ephemeral、checkpoint、governedの3段階を採用し、全操作のevent sourcingはしない。revisionと物理blobを分離し、複数のrevisionが同じ `tenant+digest` の不変blobを参照する | 業務: 自動保存へ重いAIやactorの属性を付けない（容量、PII、監査ノイズを減らす）。機能: 正規化JSON（UTF-8、キーの辞書順、NaN禁止）を前提に、content-addressedなchunkまたはdeltaと、定期的なfull snapshotを組み合わせる |
| **機能設計** | Gitは、アーカイブ、インポート・エクスポート、オフライン協調に限った任意のadapterとする。AIの実行は `ai_generation_runs` へ分離し、プロンプト、本文、プロバイダ、モデルをDAGへ複製しない。保持のGCはmark-and-sweep型とし、head、DAGの親、元の提案、pinから到達できるrevisionを削除しない。checkpointとgovernedは、期限で自動削除しない | 業務: revisionの削除時に、保護条件を同じDELETE文で再評価し、pinやheadが追加されて競合したら安全側で拒否する。データ: blobのGCは、対象の行をロックしたトランザクション内で参照を再確認し、`deleting` へ遷移してから物理バックエンドを削除する。失敗時は行を `deleting` のまま残し、再試行できるようにする |

## Consequences

- DB、NAS、S3、将来のGit保存で、同じ論理世代を使える。
- 自動保存へ重いAIやactorの属性を付けないため、容量、PII、監査ノイズを抑えられる。
- AI提案と人間による採用の系譜を保ちつつ、proposal-onlyとhuman reviewの境界を維持できる。
- AI実行の再現と監査への接続に必要な最小のidentityを保持しつつ、プロンプトや生成本文の重複保存を避けられる。プロバイダの実行詳細は、既存の監査ログをトレースIDで参照する。
- revision DAG、delta生成、GC、保持pin、ドメイン行からの参照、共有bundleについて、追加の設計が必要になる。
- Gitの圧縮効果は、JSONの正規化と変更の局所性に依存する。実データのベンチマークなしに、採用の効果を断定しない。
- オブジェクトストレージを先行して実装しないことで、二重参照と二重GCを避ける。一方、大容量、低価格、共有ストレージが必要になった時点で、同じblob契約へ追加できる。
- GC監査には、revision IDまたはダイジェスト、バックエンド、結果だけを保持する。削除済みの本文やlocatorは複製しない。

## Preliminary benchmark 2026-08-09

実キャンバスの大規模なフィクスチャが未整備のため、一次計測は合成条件で行った。条件は、300カード、100世代、各世代で5カードを更新、キーを安定した順にした複数行JSONである。

| 方式 | 合計bytes | 備考 |
| --- | ---: | --- |
| raw full snapshot x100 | 12,781,223 | 最終1世代は130,103 bytes |
| gzip full snapshot x100 | 476,633 | 世代単位の独立復元が容易 |
| gzip delta x99 | 41,446 | 初期full snapshotの分を加える必要がある |
| aggressive GC後のGitリポジトリ | 112,612 | `.git`全体。worktree 130,103 bytesは別 |

この結果は、Git packとdelta方式のどちらにも圧縮の価値があることを示す。ただし、実データ、分岐、並べ替え、巨大な本文、復元時間は含まない。Gitを直接採用する根拠にはせず、revisionとblobの分離、および代表フィクスチャの整備を先に進める。

実装済みのコーデックを使い、同じ規模で再現できるベンチマークを追試した。結果は、raw 11,273,323 bytes、保存447,181 bytes、full 100、delta 0、エンコード約720ms、100世代の復元の合計約41msである。したがって、当面の既定はgzip fullとする。deltaは常設を前提にせず、実データでfullより有利な場合だけ、適応的に採用する。

同じフィクスチャを100回のGit commitとして保存し、aggressive GCした追試の結果は次のとおりである。`.git`全体は113,646 bytes、commitの作成とGCは約37.8秒、3世代の `git show` による復元は約194msだった。Git packはgzip fullより約4倍小さい。しかし、書き込み、GC、任意の世代の読み取りというホットパスのコストが大きい。したがって、標準の実行時はgzip fullとDB メタデータにする。Gitは、明示的なアーカイブや交換の処理でのみ、再評価する。

## Extended representative benchmark 2026-08-10

既存のfrontendにある実Documentのフィクスチャを起点に、次の3条件を `benchmark_generation_scenarios.py` で追試した。

- 40世代
- 同じフィクスチャの2ブランチとマージ
- 同じDocumentの形のまま1.15 MiBへ拡張した20世代

| 条件 | 世代サイズ | raw合計 | 適応的な保存 | full/delta | 符号化 / 全復元 | Git pack | Git書き込み+GC / 3世代復元 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| フィクスチャ派生40世代 | 830–1,486 B | 46,192 B | 22,625 B | 40 / 0 | 14.73 / 1.43 ms | 56,549 B | 16.39 s / 185.46 ms |
| ブランチ＋マージ 4世代 | 814–834 B | 3,298 B | 1,977 B | 4 / 0 | 1.23 / 0.16 ms | 29,796 B | 2.59 s / 179.85 ms |
| 1.15 MiB級20世代 | 1,156,489–1,157,646 B | 23,140,981 B | 11,794,985 B | 20 / 0 | 2.91 s / 187.48 ms | 694,796 B | 12.95 s / 295.09 ms |

全条件でdeltaは選ばれず、最大の深さは0だった。Git packは、特に大容量の反復データでよく圧縮した。しかし、メタデータを含む小規模な履歴ではgzip fullより大きく、全条件で、書き込みとGC、および任意の世代の復元に固定のコストが目立った。そのため、`delta_chain_max_depth=32` と比率0.7は上限の安全柵として維持する。ただし、実行時の容量の見積もりはdeltaを前提にせず、gzip fullで行う。Gitをホットパスから外す判断も維持する。

## Non-goals

- 本ADRだけでは、Gitを実行時の保存先として有効にしない。
- 全キー入力、undo/redo、UI操作、LLMのトークンを、永続的なeventにしない。
- revisionのダイジェストを、署名、認可、human reviewの証明として扱わない。
- 既存の `RoundSnapshotV1`、merge decision log、監査eventを、revisionで置き換えない。

## Runtime integration amendment 2026-08-11

既存のDocument APIをrevision DAGへ段階的に移行する際の曖昧さを、次のとおり解消する。

1. 現行frontendの `PUT /docs/{doc_id}` は、利用者の明示的な保存操作からだけ呼ばれる。そのため、`generation_reason=manual_save`、`generation_tier=checkpoint`、`generation_origin=human` として扱う。自動保存、インポート、AI提案、人間による採用は、既存のPUTから推測しない。将来のサーバー管理の操作コンテキストか、専用のAPIで区別する。
2. 通常のDocumentの既定のhead名は `main` とする。headがまだないDocumentでは、最初の実体化でversion 1を作る。以後の変更の保存は、現在のheadを単一の親に持つ。
3. HTTP ETagは、互換期間中も `documents.payload_json` のSHA-256を維持する。コンテンツダイジェストは正規化JSONのSHA-256であり、headのversionはCAS用の整数である。この三つを、同じversionとして公開しない。
4. バイト単位の入力表現ではなく、正規化JSONのダイジェストが現在のheadと同じなら、PUTはプロジェクションの互換フィールドを更新できる。ただし、新しいrevisionの作成とheadのversionの増加は行わない。意味のない世代の増加を避ける。同じ本文を監査用のcheckpointとして残す用途は、将来の明示的な操作に分ける。
5. 旧形式のDocumentは、GETで暗黙に書き換えない。初期revisionは、一括のバックフィル、または次回のPUTのトランザクション内で作る。headがない間だけ、`documents.payload_json` を旧形式の正本として読む。
6. headが存在するDocumentでは、revision blobの復元とダイジェストの検証に成功させ、互換プロジェクションと正規化結果が一致することを確認する。不一致の場合は、一方を黙って上書きせず、安全側で拒否し、修復手順書へ回す。
7. PUTは、Documentのプロジェクション、blob、revision、親、headを、単一のDBトランザクションに置く。`If-Match` の確認後に同時更新があった場合は、headのCASで再検証し、古い書き込み側へ409を返す。成功の応答後に非同期で二重書き込みすることは禁止する。

## Traceability

- Implementation: `01_Plans/issues/archive/issue-DATA-GENERATION-01-content-generation-policy.md`
- Related: `01_Plans/adr/ADR-0057-w-type-cumulative-inquiry-model.md`
- Related: `01_Plans/adr/ADR-0066-database-portability-capability-registry.md`
- Related: `01_Plans/adr/ADR-0041-core-value-invariants-single-guard.md`
- Related: `02_Architecture/database_portability.md`
