# 運用手順

対象読者: sui-sensemakingの日常運用、検証環境の管理、リリース後の確認を担当する人。

目的: 起動、停止、状態確認、更新、バックアップ、障害時の初動を、再現できる手順としてまとめます。

## 標準構成

Docker Composeの標準構成は、次の3つのサービスです。

| サービス | 役割 |
| --- | --- |
| `web` | Reactで作った画面と、nginxによる通信の中継 |
| `api` | FastAPIによるサーバー側の処理 |
| `db` | PostgreSQL |

標準のURLは `http://localhost:8080` です。nginxは`/api/`へのアクセスをサーバー側の処理へ転送します。`web`はループバックアドレス（`127.0.0.1`）でのみ公開されるため、このURLを開けるのは、起動したホスト自身だけです。別の端末やLANから使うときは、認証プロキシとTLSを備えた別の構成が必要です。

## 運用で見るもの

運用の確認は、次の順に見ると原因を絞りやすくなります。

1. 画面が開くか。
2. APIが `/api/healthz` に応答するか（死活確認）。応答するのに動作がおかしいときは、`/api/readyz` でDBとスキーマを確認します。
3. DBが正常な状態（healthy）か。
4. 保存と再読み込みができるか。
5. LLMや監査ログなど、外部接続を有効にした部分だけ、追加で確認します。

最初からすべてのログを読む必要はありません。利用者が操作する画面から順に確認します。

画面の入口は、次の状態を目安にします。起動直後に「作業を開始」パネルが表示され、新しい文書、サンプル、`document.json`、レビューパックの入口と、SafeModeの状態を確認できれば、利用者は次の操作を選べます。

![運用確認で見る作業開始パネル](assets/screenshots/start-document-entry.png)

開始パネルを閉じるか入口を選ぶと、ヘッダーにSafeMode、表示モード、共有と再現、保存などの主要操作が並び、キャンバスと右側のパネルが表示されます。ここまで進めたら、APIと保存の確認に進みます。

![運用確認で見る標準画面](assets/screenshots/app-canvas-overview.png)

## 実行プロファイルの選択

運用手順を実行する前に、対象環境で使う設定の組み合わせ（プロファイル）を決めます。プロファイルの詳細は、GitHub上の [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md) を参照してください。ここでは、運用での使い分けだけを示します。

- 開発での再現や不具合の切り分け: `local-dev`
- Composeでの評価と受け入れ確認: `evaluation`
- 企業や行政の本番に近い環境: `enterprise-production`
- 複数のテナントが共有するSaaS: `saas-multitenant`

`enterprise-production` では、次を起動前の確認に加えます。

- `SUI_ALLOW_JIT_PROVISIONING=false`
- `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only` または `deny`
- 外部接続（LLM、監査ログ、`external_http`）を有効にするときは、接続先、タイムアウト、秘密情報の管理方法を確認し、記録に残します。

### SaaSで複数のAPIサーバーを動かす場合

`saas-multitenant`では、BFFが管理する認証セッションの正本を、PostgreSQLの`saas_auth_sessions`で共有します。各行は、サーバー側でハッシュ化した認証セッションの識別子に対して、利用者（principal）、発行者（issuer）、認証の対象者（subject）、現在利用中のテナント、`tenantSessionVersion`、作成時刻、最終利用時刻、失効時刻を持ちます。APIサーバーを増やしても同じPostgreSQLを参照するので、同じ利用者の要求を常に同じサーバーで処理する仕組み（スティッキーセッション）に、正しさを依存させてはいけません。

BFFのCookie経路では、次を運用の前提にします。

- 同じ認証セッションを別のAPIインスタンスが処理しても、アクティブなテナントと `tenantSessionVersion` は、同じ共有行から解決します。同じ本人でもログインセッションが違えば別の行なので、一方でテナントを切り替えたりログアウトしたりしても、他方は失効しません。
- テナントの切り替えは、期待する `tenantSessionVersion` と比較して更新します（比較交換）。古いバージョンのリクエストは409で拒否します。クライアントは、新しいテナントへ自動で再送せず、最新のセッション情報を読み直してから、利用者の操作として再試行します。
- ログアウト、絶対的な有効期限、無操作による期限切れは、共有DBの認証セッションに反映されます。次のリクエストがどのAPIインスタンスに届いても、同じ失効状態になります。
- 状態を変えるメソッドをBFFのCookieで認証するときは、OriginとHostの一致と、セッションに結び付いたCSRFトークンを検証します。CSRFトークンや認証セッションIDの生の値を、ログに出してはいけません。
- 共有の認証テーブルのマイグレーションが済んでいない場合や、起動時にDBへ接続できない場合は、SaaSのAPIは起動を拒否します。稼働中にDBを失ったときも、セッションの解決やテナントの切り替えを、メモリ上の状態で代用せず、処理を続けず、失敗として扱います。
- JWKSのキャッシュは、インスタンスごとに持って構いません。安全上の境界は共有しませんが、インスタンスが増えるほどブローカーへの取得回数が増えます。取得の失敗や集中が疑われるときは、ブローカー側の状態も確認します。

#### Bearerトークンを使う互換経路

明示的なBearer認証情報を使う互換経路は、SPAからBFFのCookie経路への移行が終わるまで残ります。この経路では、次を別々の安全上の境界として扱います。

- Bearerのアクセストークンは有効期間を短くし、署名、発行者、audience、期限を検証します。`jti` は任意のトークン識別子で、同じ有効なトークンを、通常の連続したAPIリクエストに使えます。`jti` を一度だけ使えるnonceとしては扱いません。
- 現在のBearer方式は、送信者に結び付いたトークン（sender-constrained token）ではないため、盗まれたBearerトークンがそのまま再利用されても、検出できません。
- 利用者単位の互換経路で使う `Sui-Sensemaking-Tenant-Session-Version` のCookieを、認証セッションの所有や、CSRF対策の根拠として扱いません。BFFのセッション単位の経路では、このバージョンCookieを新たに発行せず、サーバーが管理する `Sui-Sensemaking-Auth-Session` と共有DBの行を正本にします。状態を変えるリクエストのCSRF対策は、別のミドルウェアが担います。

現在の実装には、リクエスト処理用のDBセッションを保持している間に、認証セッションの保存先が別のDBセッションを開く経路があります。1インスタンスあたり `pool_size=1`、`max_overflow=0` まで絞ると、共有セッションを解決する前にコネクションプールがタイムアウトし、503を返して安全側に停止します。本番では、1リクエストが常に1接続だけを使うとは考えず、APIのレプリカ数と同時リクエスト数に対して、コネクションプールに余裕を持たせてください。プールのタイムアウトが出たときは、DBの停止だけでなく、プールの枯渇も原因として切り分けます。

### SaaSのマイグレーションとローリング再起動

更新は、次の順に行います。

1. 新しいAPIのリビジョンを起動する前に、マイグレーションを適用します。`saas_auth_sessions` を含む必要なスキーマがそろっていることを、`/readyz` で確認します。
2. ローリング再起動の間、すべてのAPIインスタンスで、同じ認証セッションのハッシュキーを使います。キーがそろっていれば、新しく起動したインスタンスも、既存のCookieから同じ共有セッションを解決できます。
3. APIインスタンスを1つずつ更新し、各インスタンスの準備ができてから次に進みます。可能なら、同じ認証セッションを古いインスタンスと新しいインスタンスの両方に送り、アクティブなテナントとバージョンが一致することを確認します。
4. 認証セッションのハッシュキーを変えると、古いキーで発行されたCookieは、新しいキーのインスタンスでは別のハッシュになり、既存のセッションを解決できません。現在の実装は、古いキーに切り替えたり推測したりしません。キーの入れ替えは、既存セッションの再ログインを伴う計画的な変更として扱い、ローリング再起動の途中で、インスタンスごとに異なるキーが混在しないようにしてください。
5. `saas_auth_sessions` を削除するダウングレードでは、既存のBFFセッションを維持できません。新しいスキーマを必要とするインスタンスが残っている間はダウングレードせず、ロールバックのときは、セッションの失効と再ログインが利用者に影響することを明示します。

### SaaSのセッションで障害が起きたときの初動

- `session_context_unavailable` や503が増えたときは、まず `/readyz`、PostgreSQLへの到達性、コネクションプールのタイムアウトを確認します。DBやプールの問題を、メモリ上の代用で隠さないでください。
- `tenant_session_changed`（409）は、古い状態に基づくリクエストです。最新の情報を取得し直します。利用者の操作なしに、テナント切り替えのリクエストを別のテナントへ自動で再送してはいけません。
- キーの入れ替えやデプロイの直後に `session_invalid`（401）が増えたときは、APIインスタンス間で、セッションのハッシュキーが一致しているかを確認します。意図した入れ替えなら、再ログインを案内します。
- ログアウト、期限切れ、失効のあとのセッションを復活させるために、DBの行を書き戻したり、別のセッションの状態を流用したりしてはいけません。
- 障害を調べるときは、認証セッションのCookie、CSRFトークン、Bearerトークン、サーバーのキーを、ログ、課題管理、文書に転記してはいけません。

## 起動

```bash
cd 03_Implement/deploy
docker compose up --build -d
```

## 状態確認

```bash
docker compose ps
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
```

次を確認します。

- `db` が正常（healthy）になっている。
- `api` が、マイグレーションのあとに起動している。
- `web` が、`SUI_WEB_PORT` のポートで公開されている。
- `/api/healthz` が `{"status":"ok"}` を返す（確認できるのは死活だけで、DBの状態は見ていません）。
- `/api/readyz` が `{"status":"ready"}` を返す（DBへの到達性とスキーマの世代を検査します）。DBを失っていても `/api/healthz` は成功するため、依存先の確認にはこちらを使います。

> **ヘルスチェックの意味**: `/healthz` は、プロセスが生きているかだけを確認し、DBには触れません。DBを失っても `{"status":"ok"}` を返します。DBへの到達性とマイグレーションの適用状態まで確認するには、`/readyz` を使います。DBが止まっているときは `/readyz` が503を返します。スキーマがマイグレーションの最新より古いときも、503 `schema_mismatch` を返します。ビルドのリビジョンは `/version` で確認できます。

`docker compose ps` はサービスが動いているかを見るコマンドで、`curl` はAPIが応答するかを見るコマンドです。片方だけでは原因を絞りきれないため、両方を確認します。

## 停止

```bash
cd 03_Implement/deploy
docker compose down
```

データも削除するときだけ、`-v` を付けます。

```bash
docker compose down -v
```

## 更新

1. 変更を取得します。

```bash
git pull --ff-only
```

2. 再ビルドして起動します。

```bash
cd 03_Implement/deploy
docker compose up --build -d
```

3. ヘルスチェックと主要な操作を確認します。

```bash
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
```

更新や復旧のあとは、少なくとも次の順で確認します。

1. 画面が開く。
2. `/api/healthz` が成功する。
3. 標準サンプルか、対象の文書を読み込める。
4. 保存、再読み込み、共有前確認ができる。
5. 外部接続を有効にしているときは、その接続だけを追加で確認する。

1つでも失敗したときは、次の変更に進まず、発生日時、操作、期待した結果、実際の結果、直近の変更を記録します。

## バックアップと隔離復元

バックアップの取得先、保管期間、暗号化、外部への保管の有無は、組織ごとに決める運用事項です。sui-sensemakingでは、バックアップの取得だけで成功とはせず、本番とは別の名前、パス、スキーマへの隔離復元と、内容の確認までを、一組の演習として扱います。

実行前に、DBの製品とバージョン、アプリのリビジョン、復元元、復元先、実行者を記録します。アプリの接続アカウントに、DBの作成、バックアップ、復元の権限を足してはいけません。運用者が、別の管理用の資格情報で実行してください。以下は、バージョンを固定した検証で確認した最小の手順です。マネージドDBでは、提供元の公式のバックアップ機能と権限モデルに読み替えます。

### 復旧確認の共通項目

復旧演習は、本番のDBを直接上書きする手順ではありません。検証環境か一時的なDBに復元し、次を確認します。

| 確認項目 | 見る内容 |
| --- | --- |
| 対象 | DBの製品とバージョン、アプリのリビジョン、バックアップの取得日時、復元元、復元先 |
| スキーマ | `alembic_version` が想定どおりのリビジョンで、起動時のスキーマ検査を通ること |
| 文書 | `id`、`version`、`updated_at` が正しく、画面かAPIで読み込めること |
| 判断ログ | `merge_decision_logs` が対象の文書に結び付き、グループやスナップショットごとの順序が崩れていないこと |
| 大きな本文 | 代表的なキャンバスの `payload_json` が、欠けたり切り詰められたりせず、バイト数か文字数が復元元と一致すること |
| リビジョンのblob | `main` のheadから本文を復元でき、`content_blobs` のダイジェスト、バイト数、1 MiBを超えるペイロードが復元元と一致すること |
| 共有前確認 | SafeModeが有効で、未レビューの本文や個人情報を含む出力を、不用意に共有しないこと |
| 中断の条件 | コマンドの失敗、警告付きの部分的な成功、バージョンの不整合、件数、ダイジェスト、本文の長さ、判断ログの不一致、復元先の取り違え、秘密情報を含むログの共有があれば、完了とは扱わない |

<a id="database-sqlite"></a>
### SQLite

APIを停止し、DBファイルを別のパスにコピーします。復元の演習では、元のファイルを上書きせず、コピーしたDBを、別の `sqlite:///...` のURLで読み込みます。稼働中のDBを単純にコピーすると、確定していないトランザクションやWALが欠けることがあるため、その方法は使いません。

```bash
cp 03_Implement/backend/sui_sensemaking.db sui_sensemaking-backup.sqlite3
cp sui_sensemaking-backup.sqlite3 sui_sensemaking-restore.sqlite3
```

<a id="database-postgresql"></a>
### PostgreSQL

標準のComposeでの例です。`createdb` と復元は、アプリの実行ユーザーではなく、検証用のデータベースを作れる運用用の資格情報で実行します。

```bash
cd 03_Implement/deploy
docker compose exec db pg_dump -Fc -U sui_sensemaking sui_sensemaking > sui_sensemaking_backup.dump
```

復元は、既存のデータを上書きする可能性があります。まず、本番ではない検証用のDBに戻してください。

```bash
docker compose exec db createdb -U sui_sensemaking sui_sensemaking_restore
cat sui_sensemaking_backup.dump | docker compose exec -T db pg_restore -U sui_sensemaking -d sui_sensemaking_restore --clean --if-exists
```

<a id="database-mysql"></a>
### MySQL 8.4

`MYSQL_PWD` は、このシェルのプロセスにだけ設定し、履歴や文書に値を残しません。`CREATE DATABASE` は運用用の資格情報で行い、ダンプには、整合したスナップショットを取るための `--single-transaction` を指定します。

```bash
MYSQL_PWD="$DB_ADMIN_PASSWORD" mysqldump --host="$DB_HOST" --user="$DB_ADMIN_USER" \
  --single-transaction --skip-lock-tables sui_sensemaking > sui_sensemaking_mysql.sql
MYSQL_PWD="$DB_ADMIN_PASSWORD" mysql --host="$DB_HOST" --user="$DB_ADMIN_USER" \
  -e 'CREATE DATABASE sui_sensemaking_restore'
MYSQL_PWD="$DB_ADMIN_PASSWORD" mysql --host="$DB_HOST" --user="$DB_ADMIN_USER" \
  sui_sensemaking_restore < sui_sensemaking_mysql.sql
```

<a id="database-mariadb"></a>
### MariaDB 11.4

MySQLと同じ分離の方針で、MariaDBに同梱のクライアントを使います。

```bash
MYSQL_PWD="$DB_ADMIN_PASSWORD" mariadb-dump --host="$DB_HOST" --user="$DB_ADMIN_USER" \
  --single-transaction --skip-lock-tables sui_sensemaking > sui_sensemaking_mariadb.sql
MYSQL_PWD="$DB_ADMIN_PASSWORD" mariadb --host="$DB_HOST" --user="$DB_ADMIN_USER" \
  -e 'CREATE DATABASE sui_sensemaking_restore'
MYSQL_PWD="$DB_ADMIN_PASSWORD" mariadb --host="$DB_HOST" --user="$DB_ADMIN_USER" \
  sui_sensemaking_restore < sui_sensemaking_mariadb.sql
```

<a id="database-mssql"></a>
### SQL Server 2022

データベースのバックアップ権限と、復元先を作れる管理権限が必要です。バックアップファイルは、SQL Serverのプロセスから見える管理用のパスに置きます。復元の前に `RESTORE FILELISTONLY` で実際の論理ファイル名を確認し、その値を `MOVE` に使います。

```sql
BACKUP DATABASE [sui_sensemaking]
  TO DISK = N'/var/opt/mssql/data/sui_sensemaking.bak'
  WITH INIT, COPY_ONLY;
RESTORE FILELISTONLY
  FROM DISK = N'/var/opt/mssql/data/sui_sensemaking.bak';
RESTORE DATABASE [sui_sensemaking_restore]
  FROM DISK = N'/var/opt/mssql/data/sui_sensemaking.bak'
  WITH MOVE N'<data-logical-name>' TO N'/var/opt/mssql/data/sui_sensemaking_restore.mdf',
       MOVE N'<log-logical-name>' TO N'/var/opt/mssql/data/sui_sensemaking_restore_log.ldf';
```

<a id="database-cockroachdb"></a>
### CockroachDB 26.2.3

`BACKUP` の権限と、復元先を作る権限が必要です。次は、単一ノードでの検証で確認した `nodelocal` を使う例です。複数ノードやマネージドサービスでは、共有のオブジェクトストレージのURIと、KMSやIAMを、組織側で定義します。

```sql
BACKUP DATABASE "sui_sensemaking" INTO 'nodelocal://1/sui_sensemaking-backup';
RESTORE DATABASE "sui_sensemaking" FROM LATEST IN 'nodelocal://1/sui_sensemaking-backup'
  WITH new_db_name = 'sui_sensemaking_restore';
```

<a id="database-oracle"></a>
### Oracle AI Database Free 23.26.2

Data Pumpのディレクトリへの読み書きの権限、復元元のスキーマをエクスポートする権限、復元先のスキーマを作成してクォータを設定する権限が必要です。パスワードを引数に埋め込まず、ウォレットや対話入力など、組織の標準的な秘密情報の受け渡し方法を使います。復元先のスキーマを先に作成してから、`REMAP_SCHEMA` で隔離します。

```bash
expdp "$DB_ADMIN_USER@$ORACLE_SERVICE" SCHEMAS=sui_sensemaking DIRECTORY=DATA_PUMP_DIR \
  DUMPFILE=sui_sensemaking.dmp LOGFILE=sui_sensemaking_exp.log REUSE_DUMPFILES=YES
impdp "$DB_ADMIN_USER@$ORACLE_SERVICE" DIRECTORY=DATA_PUMP_DIR \
  DUMPFILE=sui_sensemaking.dmp LOGFILE=sui_sensemaking_imp.log \
  REMAP_SCHEMA=sui_sensemaking:RESTORED_SCHEMA
```

復元を確認したら、検証用のデータベースやスキーマと、一時的なバックアップを、組織の保持と監査の方針に従って削除します。削除の対象は復元元と照合し、名前があいまいなときは実行しません。

## 文書リビジョンの段階的な移行

スキーマのリビジョン `20260811_0021` 以降は、新規の保存と更新の保存で、`documents.payload_json` と互換のあるデータと、内容アドレス方式のリビジョンDAGを、同じトランザクションで保存します。既存の文書は、headがない間だけ従来の形式から読み、GETだけではDBを書き換えません。次のPUT、または明示的なバックフィルで、`main` のheadを作ります。

バックフィルの前に、上記の隔離復元を成功させ、対象のテナントIDと文書の件数を記録してください。データベースのURLには資格情報が含まれることがあるため、シェルの履歴、チケット、通常のログに残らない方法で受け渡します。既定はドライランです。

```bash
cd 03_Implement/backend
python -m sui_sensemaking_api.backfill_document_revisions \
  --database-url "$SUI_DATABASE_URL" \
  --tenant-id "$TARGET_TENANT_ID" \
  --limit 100
```

出力の `candidates` を確認したら、同じテナントと接続先に `--apply` を付けて実行します。1回のトランザクションを小さく保つため、`remaining` が0になるまで、バッチ単位で繰り返します。

```bash
python -m sui_sensemaking_api.backfill_document_revisions \
  --database-url "$SUI_DATABASE_URL" \
  --tenant-id "$TARGET_TENANT_ID" \
  --limit 100 \
  --apply
```

次の場合は中断し、再実行する前にDBを調べます。

- テナントが存在しない。または、JSONの復元、ダイジェスト、バイト数の検証に失敗する。
- 保存やGETが、HTTP 503 `Document revision storage failed integrity verification` を返す。
- 同じ文書の `main` のheadと互換のあるデータが、正規化したJSONとして一致しない。
- バックフィルの対象でないテナントに、リビジョンやheadが作られる。
- `remaining` が減らない。または、想定の件数を超える。

ロールバックのために、リビジョンの行だけを手作業で削除してはいけません。文書、blob、親、headは、複合外部キーと保持の規則でつながっています。問題があるときは、書き込みを止め、隔離復元したバックアップと比べてから、修復の方針を決めます。

## ログを見る

```bash
docker compose logs web --tail=100
docker compose logs api --tail=200
docker compose logs db --tail=100
```

障害を調べるときは、まず、発生時刻、操作の内容、対象の文書ID、HTTPステータス、画面のエラーを控えます。ログやスクリーンショットを共有する前に、秘密情報を除いてください。診断ワーカーの見方は [diagnostics.md](diagnostics.md)、残してよい情報の判断は [data_handling.md](data_handling.md) を参照してください。

ログは既定で1行1JSONです。エラー応答の `requestId`（`X-Request-Id` ヘッダーと同じ値）で、ログの行を絞り込めます。

```bash
docker compose logs api | grep '"requestId":"<利用者から聞いたID>'
```

ログの形式、突き合わせの手順、まだ観測できないこと（メトリクス、監査イベントのローカル保存）は、[observability.md](observability.md) にまとめています。

## 障害時の初動

| 症状 | 確認すること |
| --- | --- |
| 画面が開かない | `docker compose ps`、`web` のログ、`SUI_WEB_PORT` の競合 |
| APIが502か503を返す | `api` のログ、マイグレーションのエラー、DBへの接続 |
| APIが401を返す | `SUI_API_KEY` と `X-API-Key` ヘッダー |
| AI機能が使えない | `SUI_LLM_PROVIDER`、ローカルや大規模LLMのプロバイダの設定 |
| 保存できない | APIのログ、DBのログ、ブラウザの開発者ツールのネットワーク |

問い合わせや引き継ぎでは、次の形で共有すると、調査が早く進みます。

```text
発生日時:
URL:
操作:
期待した結果:
実際の結果:
APIのステータス:
直近の変更:
確認したログ:
```

## 障害の診断と復旧

### 障害の分類（一次切り分け）

| 分類 | 代表的な症状 | 一次切り分け（5分以内） | 最初の復旧操作 |
| --- | --- | --- | --- |
| WEB-ENTRY | 画面が開かない、表示が崩れる | `web` のログ、ポートの競合、ブラウザのコンソール | `web` の再起動、ポート競合の解消、再読み込み |
| API-UNAVAILABLE | 502や503、`/api/healthz` の失敗 | `api` のログ、`db` の状態、マイグレーションの失敗 | `api` と `db` の再起動、マイグレーションの復旧 |
| SAVE-FAILURE | 保存の失敗、再読み込みで内容が合わない | APIのステータス、`db` のログ、ネットワークの失敗応答 | 再保存、API復旧後の再試行、バックアップの確認 |
| IMPORT-VALIDATION | 取り込みの失敗、スキーマの不整合 | 取り込みのエラー内容、schemaVersion、入力のサイズ | 別のファイルで再試行、検証結果の共有 |
| SHARE-SAFEMODE | 共有前の警告、書き出しの制約 | SafeModeの状態、マスクの警告、公開範囲の設定 | 共有を一時停止し、マスク対象を確認してから再実行 |

### 小規模な運用での判断

個人で運用するときは、状況の判断と復旧の操作を、同じ人が兼ねて構いません。通常の再起動、再試行、既知のバージョンへのロールバックに、仮想の承認者や役職別の記録は要りません。

次の場合だけ、作業を止めます。

- 秘密情報や、マスクしていない本文を共有しないと、調査できない。
- SafeModeの緩和、外部への共有範囲の拡大、元に戻せないデータ変更が必要である。
- 変更したあとに、安全な状態へ戻せる確信がない。

組織が職務の分離を必要とするときは、[strictモードの例外を緩和する仕様](../02_Architecture/strict_mode_exception_approval_flow.html)を、組織用のプロファイルとして適用します。

### 障害復旧の最小の手順

1. 症状に最も近い分類を選び、一次切り分けを行います。
2. 再起動、再試行、既知のバージョンへのロールバックなど、元に戻せる最小の操作を行います。
3. `/api/healthz`、保存、再読み込み、必要な利用者の操作を確認します。
4. 解決しない場合だけ、症状、実施した内容、結果、次に試すことを短く残します。

暫定の対応を記録するときの書式です。

```text
暫定対応メモID:
不足している確認:
不足のため確定できない判断:
暫定の運用（いつまで）:
恒久的な対応が必要な場合の相談先:
```

復旧を再現できるようにするときの書式です。

```text
分類:
発生日時:
影響の範囲:
一次切り分けの結果:
実行したコマンド:
復旧の結果:
承認者:
実行者:
次回の予防策:
```

## SafeModeと外部サービスとの共有

既定では、`SUI_LLM_PROVIDER=none` で、監査ログのHTTP連携も無効です。外部のLLMや監査ログのHTTP連携を有効にするときは、先に [data_handling.md](data_handling.md)、[security.md](security.md)、[configuration.md](configuration.md) を確認してください。

## 運用前のチェックリスト

- [ ] `/api/healthz` が成功する。
- [ ] 画面から、新規の文書を作成できる。
- [ ] 保存して再読み込みしたあとも、内容が残っている。
- [ ] LLMのプロバイダが、意図した値になっている。
- [ ] APIキーを使う環境で、キーなしのAPI呼び出しが401になる。
- [ ] バックアップか復旧の方針を確認している。

## 関連文書

- [installation.md](installation.md)
- [configuration.md](configuration.md)
- [data_handling.md](data_handling.md)
- [security.md](security.md)
- [diagnostics.md](diagnostics.md)
- [release.md](release.md)
