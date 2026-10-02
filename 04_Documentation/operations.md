# Operations

対象読者: sui-sensemakingの日常運用、検証環境管理、リリース後確認を担当する人。

目的: 起動、停止、状態確認、更新、バックアップ、障害時の初動を再現できる手順としてまとめます。

## 標準構成

Docker Composeの標準構成は次の3サービスです。

| サービス | 役割 |
| --- | --- |
| `web` | React frontend と nginx proxy |
| `api` | FastAPI backend |
| `db` | PostgreSQL |

標準URLは `http://localhost:8080` です。nginxは `/api/` をbackendに転送します。`web` はloopback（`127.0.0.1`）へbindされるため、このURLは起動したホスト自身からだけ開けます。別端末やLANからの利用が必要な場合は、認証proxy・TLSを伴う別構成が必要です。

## 運用で見るもの

sui-sensemakingの運用確認は、次の順で見ると切り分けやすくなります。

1. 画面が開くか。
2. APIが `/api/healthz` に応答するか（liveness）。応答するのに動作がおかしい場合は `/api/readyz` でDBとスキーマを確認します。
3. DBがhealthyか。
4. 保存と再読み込みができるか。
5. LLMやauditなど、外部接続を有効にした部分だけ追加で確認する。

最初からすべてのログを読む必要はありません。利用者影響のある入口から順に確認します。

画面側の入口は次の状態を目安にします。起動直後に「作業を開始」パネルが表示され、新しい文書、サンプル、`document.json`、レビューパックの入口とSafeModeの状態を確認できれば、利用者は次の操作を選べます。

![運用確認で見る作業開始パネル](assets/screenshots/start-document-entry.png)

開始パネルを閉じるか入口を選ぶと、ヘッダーにSafeMode、表示モード、共有と再現、保存などの主要操作があり、キャンバスと右側パネルが表示されます。この状態まで進めば、次にAPIと保存の確認へ進めます。

![運用確認で見る標準画面](assets/screenshots/app-canvas-overview.png)


## Runtime profile の選択

運用手順を開始する前に、対象環境のprofileを固定します。
profileの詳細はGitHub上の [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md) を参照してください。ここでは運用時の判断だけを示します。

- 開発再現や不具合切り分け: `local-dev`は次のとおりです。
- Composeでの評価・受入確認: `evaluation`
- 企業/行政の本番相当: `enterprise-production`
- 共有テナントSaaS: `saas-multitenant`

`enterprise-production` では次を起動前チェックに追加します。

- `SUI_ALLOW_JIT_PROVISIONING=false`
- `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only` または `deny`
- 外部接続（LLM / audit / external_http）を有効化する場合、接続先・timeout・秘密管理の確認記録

### SaaSの複数API instance構成

`saas-multitenant`では、BFFの認証session正本をPostgreSQLの`saas_auth_sessions`で共有します。各行は、server側でhash化した認証session識別子に対してprincipal、issuer、subject、active tenant、`tenantSessionVersion`、作成時刻、最終利用時刻、失効時刻を保持します。API instanceを増やしても同じPostgreSQLを参照するため、sticky sessionを正しさの前提にしてはいけません。

BFF Cookie経路では、次を運用上の前提とします。

- 同じ認証sessionを別のAPI instanceが処理しても、active tenantと`tenantSessionVersion`は同じ共有行から解決します。同じprincipalでも別login sessionは別行なので、一方のtenant切替やlogoutで他方を失効させません。
- tenant切替は期待した`tenantSessionVersion`とのCASで更新します。古いversionのrequestは409で拒否し、clientは新tenantへ自動再送せず、最新のsession contextを読み直してから利用者の操作として再試行します。
- logout、absolute expiry、idle expiryは共有DB上の認証sessionへ反映されるため、どのAPI instanceへ次requestが到達しても同じ失効状態を見ます。
- unsafe methodをBFF Cookieで認証する場合は、Origin / Host一致とsession-bound CSRF tokenを検証します。CSRF tokenやraw session IDをログへ出してはいけません。
- 共有認証表が未migration、または起動時にDBへ接続できない場合、SaaS APIは起動を拒否します。稼働中にDBを失った場合も、session解決やtenant切替をin-memory状態へfallbackせずfail-closedにします。
- JWKS cacheはinstanceごとで構いません。安全境界は共有しませんが、instance数に応じてBrokerへの取得回数が増えるため、取得失敗や集中が疑われる場合はBroker側の状態も確認します。

#### Bearer互換経路との境界

明示的なBearer credentialを使う互換経路は、SPAからBFF Cookie経路への移行が完了するまで残ります。この経路では次を別の安全境界として扱います。

- Bearer access tokenは短命にし、署名、issuer、audience、期限を検証します。`jti`は任意のtoken識別子であり、同じ有効tokenを通常の連続API要求へ使用できます。`jti`を一回使用nonceとして扱いません。
- 現行Bearer方式はsender-constrained tokenではないため、窃取されたBearer tokenそのものの再利用を検出しません。
- principal-keyed互換経路で使う`Sui-Sensemaking-Tenant-Session-Version` Cookieを、認証session ownershipやanti-forgeryの証拠として扱いません。BFF session-keyed経路ではこのversion Cookieを新たに発行せず、server-owned `Sui-Sensemaking-Auth-Session`と共有DB行を正本にします。unsafe requestのanti-forgeryは別途CSRF middlewareが担います。

現行実装では、request処理用のDB sessionを保持している間に、認証session storeが別のDB sessionを開く経路があります。1 instanceあたり`pool_size=1`かつ`max_overflow=0`まで絞ると、共有sessionの解決前にconnection pool timeoutとなり503へfail-closedします。本番では「1 requestにつき常に1接続」と仮定せず、API replica数と同時request数に対して接続poolへ余力を持たせてください。pool timeoutが見えた場合は、DB停止だけでなくpool枯渇も切り分け対象です。

### SaaSのmigrationとrolling restart

更新は次の順で行います。

1. 新しいAPI revisionを起動する前にmigrationを適用し、`saas_auth_sessions`を含む必要schemaが揃っていることを`/readyz`で確認します。
2. rolling restart中の全API instanceで、同じ認証session hash keyを使います。keyが揃っていれば、新しく起動したinstanceも既存Cookieから同じ共有sessionを解決できます。
3. API instanceを一つずつ更新し、各instanceがreadyになってから次へ進みます。可能なら同じ認証sessionを旧instanceと新instanceの双方へ到達させ、active tenantとversionが一致することを確認します。
4. 認証session hash keyを変更すると、旧keyで発行されたCookieは新keyのinstanceでは別hashとなり、既存sessionを解決できません。現行実装は旧keyへのfallbackや推測を行わないため、key rotationは既存sessionの再loginを伴う計画変更として扱い、rolling restartの途中でinstanceごとに異なるkeyを混在させないでください。
5. `saas_auth_sessions`を削除するdowngradeは既存BFF sessionを維持できません。新しいschemaを必要とするinstanceが残っている間はdowngradeせず、rollback時はsession失効と再loginを利用者影響として明示します。

### SaaS session障害時の初動

- `session_context_unavailable`や503が増えた場合は、まず`/readyz`、PostgreSQL到達性、connection pool timeoutを確認します。DBやpoolの問題をin-memory fallbackで隠さないでください。
- `tenant_session_changed`（409）はstale requestです。最新contextを再取得し、利用者の操作なしにtenant切替requestを別tenantへ自動再送しません。
- `session_invalid`（401）がkey rotationやdeployment直後に増えた場合は、API instance間でsession hash keyが一致しているかを確認します。意図したrotationなら再loginを案内します。
- logout・expiry・revocation後のsessionを復活させるためにDB行を書き戻したり、別sessionの状態を流用したりしません。
- 障害調査ではraw auth-session Cookie、CSRF token、Bearer token、server keyをログ・Issue・Documentへ転記しません。
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

確認すること。

- `db` がhealthyになっている。
- `api` がmigration後に起動している。
- `web` が `SUI_WEB_PORT` のポートで公開されている。
- `/api/healthz` が `{"status":"ok"}` を返す（**livenessのみ。DBの状態は見ていません**）。
- `/api/readyz` が `{"status":"ready"}` を返す（DB到達性とスキーマ世代を検査します）。DBを失った状態でも `/api/healthz` は成功するため、依存の確認はこちらを使ってください。

> **ヘルスチェックの意味**: `/healthz` は **liveness（プロセス生存）のみ**で、DB には触れません（DB を失っても `{"status":"ok"}` を返します）。依存（DB 到達性・migration の適用状態）まで確認するには `/readyz` を使います。DB 停止時に `/readyz` は 503、schema が migration head より古い場合も 503 `schema_mismatch` を返します。ビルドリビジョンは `/version` で確認できます。

`docker compose ps` はサービスの生死を見るコマンドです。`curl` はAPIの応答を見るコマンドです。どちらか片方だけでは原因を絞り切れないため、両方を確認します。

## 停止

```bash
cd 03_Implement/deploy
docker compose down
```

データも削除する場合だけ `-v` を付けます。

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

3. ヘルスチェックと主要操作を確認します。

```bash
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
```

## バックアップと隔離復元

取得先、保管期間、暗号化、外部保管の有無は組織ごとに決める運用事項です。sui-sensemakingでは、バックアップ取得だけを成功条件にせず、本番DBとは異なる名前・path・schemaへの隔離復元と内容確認までを一組の演習として扱います。

実行前にDB製品とversion、アプリrevision、source、復元先、実行者を記録します。アプリruntimeの接続アカウントへDB作成・backup・restore権限を追加せず、運用者が別の管理資格情報で実行してください。以下は固定versionのpromotion matrixで確認した最小パターンであり、managed DBではprovider公式のbackup機能と権限モデルへ読み替えます。

### 共通の復旧確認

復旧演習は、本番DBを直接上書きする手順ではありません。検証環境または一時DBに復元し、次を確認します。

| 確認項目 | 見る内容 |
| --- | --- |
| 対象 | DB製品/version、アプリrevision、バックアップ取得日時、source、復元先 |
| Schema | `alembic_version`が想定revisionで、起動時のschema gateを通過すること |
| Document | `id`、`version`、`updated_at`、画面またはAPIで読み込めること |
| 判断ログ | `merge_decision_logs`が対象Documentに紐づき、group/snapshot単位の順序が崩れていないこと |
| 大容量本文 | 代表canvasの`payload_json`が欠落・切詰めされず、byte数または文字数がsourceと一致すること |
| Revision blob | `main` headから本文を復元でき、`content_blobs`のdigest、byte size、1 MiB超payloadがsourceと一致すること |
| 共有前確認 | SafeModeが有効で、未レビュー本文や個人情報を含む出力を不用意に共有しないこと |
| 中断条件 | command失敗・警告付き部分成功、version不整合、件数・digest・本文長・判断ログの不一致、復元先取り違え、秘密情報を含むログ共有があれば完了扱いにしない |

<a id="database-sqlite"></a>
### SQLite

APIを停止し、DBファイルを別pathへコピーします。復元演習では元ファイルを上書きせず、コピーしたDBを別の`sqlite:///...` URLで読み込みます。稼働中の単純なファイルコピーは未確定transactionやWALを欠落させ得るため使用しません。

```bash
cp 03_Implement/backend/sui_sensemaking.db sui_sensemaking-backup.sqlite3
cp sui_sensemaking-backup.sqlite3 sui_sensemaking-restore.sqlite3
```

<a id="database-postgresql"></a>
### PostgreSQL

標準Composeの例です。`createdb`とrestoreはruntime userではなく、検証用databaseを作成できる運用資格情報で実行します。

```bash
cd 03_Implement/deploy
docker compose exec db pg_dump -Fc -U sui_sensemaking sui_sensemaking > sui_sensemaking_backup.dump
```

復元は既存データを上書きする可能性があります。まず本番DBではない検証用DBへ戻してください。

```bash
docker compose exec db createdb -U sui_sensemaking sui_sensemaking_restore
cat sui_sensemaking_backup.dump | docker compose exec -T db pg_restore -U sui_sensemaking -d sui_sensemaking_restore --clean --if-exists
```

<a id="database-mysql"></a>
### MySQL 8.4

`MYSQL_PWD`はこのshell processだけへ設定し、履歴や文書へ値を残しません。`CREATE DATABASE`は運用資格情報で行い、dump対象には整合snapshot用の`--single-transaction`を指定します。

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

MySQLと同じ分離方針で、MariaDB同梱clientを使用します。

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

database backup権限と、復元先を作成できる管理権限が必要です。backup fileはSQL Server processから見える管理pathへ置きます。復元前に`RESTORE FILELISTONLY`で実際のlogical file名を確認し、`MOVE`の値へ使います。

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

`BACKUP`権限と復元先作成権限が必要です。次はsingle-node検証で確認した`nodelocal`例です。multi-nodeやmanaged serviceでは共有object storage URIとKMS／IAMを組織側で定義します。

```sql
BACKUP DATABASE "sui_sensemaking" INTO 'nodelocal://1/sui_sensemaking-backup';
RESTORE DATABASE "sui_sensemaking" FROM LATEST IN 'nodelocal://1/sui_sensemaking-backup'
  WITH new_db_name = 'sui_sensemaking_restore';
```

<a id="database-oracle"></a>
### Oracle AI Database Free 23.26.2

Data Pump directoryへのread/write権限、source schemaのexport権限、復元schemaの作成・quota設定が必要です。passwordを引数へ埋め込まず、walletまたは対話入力等の組織標準のsecret受渡しを使用します。復元先schemaを事前作成してから`REMAP_SCHEMA`で隔離します。

```bash
expdp "$DB_ADMIN_USER@$ORACLE_SERVICE" SCHEMAS=sui_sensemaking DIRECTORY=DATA_PUMP_DIR \
  DUMPFILE=sui_sensemaking.dmp LOGFILE=sui_sensemaking_exp.log REUSE_DUMPFILES=YES
impdp "$DB_ADMIN_USER@$ORACLE_SERVICE" DIRECTORY=DATA_PUMP_DIR \
  DUMPFILE=sui_sensemaking.dmp LOGFILE=sui_sensemaking_imp.log \
  REMAP_SCHEMA=sui_sensemaking:RESTORED_SCHEMA
```

復元確認後は検証用database/schemaと一時backupを、組織の保持・監査方針に従って削除します。削除対象をsourceと照合し、名前が曖昧な状態では実行しません。

## Document revisionの段階移行

schema revision `20260811_0021`以降、新規保存と更新保存は`documents.payload_json`互換projectionとcontent-addressed revision DAGを同じtransactionへ保存します。既存Documentはheadがない間だけlegacy projectionから読み、GETだけではDBを書き換えません。次回PUTまたは明示backfillで`main` headを作成します。

backfill前に上記の隔離復元を成功させ、対象tenant IDとDocument件数を記録してください。database URLには資格情報を含み得るため、shell履歴、ticket、通常ログへ残さない受渡し方法を使用します。既定はdry-runです。

```bash
cd 03_Implement/backend
python -m sui_sensemaking_api.backfill_document_revisions \
  --database-url "$SUI_DATABASE_URL" \
  --tenant-id "$TARGET_TENANT_ID" \
  --limit 100
```

出力の`candidates`を確認後、同じtenantと接続先に対して`--apply`を付けます。1回のtransactionを小さく保つため、`remaining`が0になるまでbatch単位で再実行します。

```bash
python -m sui_sensemaking_api.backfill_document_revisions \
  --database-url "$SUI_DATABASE_URL" \
  --tenant-id "$TARGET_TENANT_ID" \
  --limit 100 \
  --apply
```

次の場合は中断し、再実行前にDBを調査します。

- tenantが存在しない、JSON復元・digest・byte size検証に失敗する。
- 保存またはGETがHTTP 503 `Document revision storage failed integrity verification`になる。
- 同じDocumentの`main` headと互換projectionがcanonical JSONとして一致しない。
- backfill対象外のtenantにrevision/headが作成される。
- `remaining`が減らない、または予想件数を超える。

rollbackのためにrevision rowだけを手作業で削除してはいけません。Document、blob、parent、headは複合FKと保持規則で接続されています。問題がある場合は書込みを止め、隔離復元したbackupと比較してから修復方針を決めます。

## ログを見る

```bash
docker compose logs web --tail=100
docker compose logs api --tail=200
docker compose logs db --tail=100
```

障害調査では、最初に発生時刻、操作内容、対象ドキュメントID、HTTP status、画面上のエラーを控えます。ログやスクリーンショットを共有する前に、秘密情報を除外してください。診断workerの見方は [diagnostics.md](diagnostics.md)、残してよい情報の判断は [data_handling.md](data_handling.md) を参照してください。

ログは既定で1行1JSONです。エラー応答の `requestId`（`X-Request-Id` ヘッダーと同じ値）でログ行を絞り込めます。

```bash
docker compose logs api | grep '"requestId":"<利用者から聞いたID>'
```

ログの形式、突き合わせ手順、および**まだ観測できないこと**（メトリクス、監査イベントのローカル保存）は
[observability.md](observability.md) にまとめています。

**ログの形式・相関ID・ヘルスチェックの意味**は [observability.md](observability.md) を参照してください。`X-Request-Id` を使って障害報告をサーバ側ログへ突き合わせます。

## 障害時の初動

| 症状 | 確認 |
| --- | --- |
| 画面が開かない | `docker compose ps`、`web` の logs、`SUI_WEB_PORT` の競合 |
| API が 502/503 | `api` の logs、migration エラー、DB 接続 |
| API が 401 | `SUI_API_KEY` と `X-API-Key` ヘッダー |
| AI 機能が使えない | `SUI_LLM_PROVIDER`、local/large-scale provider の設定 |
| 保存できない | API logs、DB logs、ブラウザ developer tools の network |

問い合わせや引き継ぎでは、次の形で共有すると調査が速くなります。

```text
発生日時:
URL:
操作:
期待した結果:
実際の結果:
API status:
直近の変更:
確認したログ:
```


## 障害診断と復旧

### 障害分類（一次切り分け）

| 分類 | 代表症状 | 一次切り分け（5分以内） | 初期復旧アクション |
| --- | --- | --- | --- |
| WEB-ENTRY | 画面が開かない、表示崩れ | `web` logs、ポート競合、ブラウザ console | `web` 再起動、ポート競合解消、再読み込み |
| API-UNAVAILABLE | 502/503、`/api/healthz` 失敗 | `api` logs、`db` health、migration 失敗 | `api`/`db` 再起動、migration 復旧 |
| SAVE-FAILURE | 保存失敗、再読み込みで内容不一致 | API status、`db` logs、Network 失敗応答 | 再保存、API復旧後に再試行、バックアップ確認 |
| IMPORT-VALIDATION | 取り込み失敗、schema 不整合 | import エラー内容、schemaVersion、入力サイズ | 別ファイルで再試行、validation 結果を共有 |
| SHARE-SAFEMODE | 共有前警告、export 制約 | SafeMode 状態、マスク警告、visibility 設定 | 共有を一時停止し、マスク対象確認後に再実行 |

### 小規模運用での判断

個人運用では、Maintainerが状況判断と復旧操作を兼ねても構いません。通常の再起動、再試行、既知バージョンへのロールバックに、仮想的な承認者や役職別記録は不要です。

次の場合だけ作業を止めます。

- secretsや未マスク本文を共有しなければ調査できない。
- SafeModeの緩和、外部共有範囲の拡大、不可逆なデータ変更が必要である。
- 変更後に安全な状態へ戻せる確信がない。

組織が職務分離を必要とする場合は、[strict mode例外緩和仕様](../02_Architecture/strict_mode_exception_approval_flow.html)を組織用プロファイルとして適用します。

### 障害復旧の最小手順

1. 症状に最も近い分類コードを選び、一次切り分けを行います。
2. 再起動、再試行、既知のロールバックなど、可逆な最小操作を実施します。
3. `/api/healthz`、保存、再読み込み、必要な利用者操作を確認します。
4. 未解決の場合だけ、症状、実施内容、結果、次に試すことを短く残します。

**暫定対応メモの記録フォーマット**

```text
暫定対応メモID:
不足している確認:
不足により確定できない判断:
暫定運用（いつまで）:
恒久対応が必要な場合の相談先:
```

### 復旧実行の再現テンプレート

```text
分類:
発生日時:
影響範囲:
一次切り分け結果:
実施コマンド:
復旧結果:
承認者:
実行者:
次回予防策:
```

## SafeMode と外部サービスとの共有

既定では `SUI_LLM_PROVIDER=none`、audit HTTP連携も無効です。外部LLMやaudit HTTPを有効にする場合は、[data_handling.md](data_handling.md)、[security.md](security.md)、[configuration.md](configuration.md) を先に確認してください。

## 運用前チェックリスト

- [ ] `/api/healthz` が成功する。
- [ ] 画面から新規ドキュメントを作成できる。
- [ ] 保存後に再読み込みして内容が残る。
- [ ] LLM providerが意図した値になっている。
- [ ] API keyを使う環境では、キーなしAPIが401になる。
- [ ] バックアップまたは復旧方針が確認済み。

## 関連文書

- [installation.md](installation.md)
- [configuration.md](configuration.md)
- [data_handling.md](data_handling.md)
- [security.md](security.md)
- [diagnostics.md](diagnostics.md)
- [release.md](release.md)

## 更新後の確認

更新や復旧のあと、少なくとも次の順で確認します。

1. 画面が開く。
2. `/api/healthz` が成功する。
3. 標準サンプルまたは対象ドキュメントを読み込める。
4. 保存、再読み込み、共有前確認ができる。
5. 外部接続を有効にしている場合、その接続だけを追加で確認する。

どれか1つでも失敗する場合は、次の変更へ進まず、発生日時、操作、期待結果、実際の結果、直近の変更を記録します。
