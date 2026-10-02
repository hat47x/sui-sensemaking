# 観測と相関

対象読者: sui-sensemakingを運用し、障害の申告を受けて調査する管理者。

目的: 実行時に何を観測できるか、利用者の申告をログの行と突き合わせる手順、まだ観測できないことを示します。

## 観測できるもの

| 対象 | 手段 | 認証 |
| --- | --- | --- |
| プロセスが生きているか | `GET /api/healthz` | 不要 |
| 依存先が使える状態か | `GET /api/readyz` | 不要 |
| 稼働中のビルド | `GET /api/version` | 不要 |
| リクエスト単位の追跡 | `X-Request-Id` レスポンスヘッダーと、ログの行の `requestId` | なし |
| アプリケーションで起きた出来事 | 構造化ログ（既定はJSON） | なし |
| 同じ主体によるログの行の突き合わせ（誰かを特定するものではない） | ログの行の `actorRefHash`（主体を解決できたときだけ） | なし |

メトリクスは提供していません。リクエスト数、レイテンシ、エラー率、DBのコネクションプールの状態、LLMの呼び出し回数は、どれも観測できません。そのため、障害に気づく経路は、現在も利用者からの申告だけです。「影響の範囲はどこまでか」「復旧したか」に、機械的に答える手段はありません。

## `/healthz` と `/readyz` の違い

`/healthz` が確認するのは、プロセスが生きていることだけです。ほかには何も検査しません。データベースを失った状態でも、`{"status": "ok"}` を返します。コンテナを再起動するかどうかの判定には、こちらを使ってください。

`/readyz` は、依存先の状態を検査します。

```bash
curl -s http://localhost:8080/api/readyz
```

```json
{"status": "ready", "checks": {"database": "ok", "schema": "ok"}}
```

- `database: unreachable`: DBに到達できません。接続先、認証、DBが動いているかを確認してください。接続文字列が含まれるおそれがあるため、理由の詳細は応答に出しません。ログの `readiness check failed` を見てください。
- `schema: mismatch`: DBの `alembic_version` が、このビルドの期待するリビジョンと一致していません。`schemaExpected` と `schemaApplied` に、両方のリビジョンIDが出ます。`alembic upgrade head` の実行漏れか、ビルドとDBの世代の違いが原因です。この状態でも、`/healthz` は200を返します。

`schema` の検査は、起動時の検査では届かない範囲を補います。起動時の検査は、Alembicのスクリプト側の分岐だけを見ていて、DBに実際に適用されているリビジョンを読んでいません。そのため、古いスキーマのDBでも正常に起動し、最初のクエリで失敗します。

## 利用者の申告をログと突き合わせる

すべてのレスポンスに `X-Request-Id` が付きます。エラー応答では、本文にも `requestId` が入ります。

```json
{"detail": "Document changed concurrently", "requestId": "9f2c1d..."}
```

手順は、次のとおりです。

1. 利用者から `requestId` を聞きます（エラー画面から控えられます）。控えていないときは、発生した時刻とURLで絞り込みます。
2. ログを検索します。

```bash
docker compose logs api | grep '"requestId":"9f2c1d'
```

呼び出し側が `x-trace-id` ヘッダーで独自のIDを送ってきたときは、それが安全な形式（英数字、ハイフン、アンダースコアだけで、128文字以下）なら、そのまま `requestId` として採用します。安全でない値は破棄して、サーバー側で新しく発行します（リクエスト自体は失敗させません）。

## ログの形式

既定は1行1JSONです（`SUI_LOG_JSON=true`）。

```json
{"timestamp":"2026-08-13T09:12:33+0000","level":"WARNING","logger":"sui_sensemaking_api.audit","message":"audit event send failed; keep fail-open","requestId":"9f2c1d...","tenantId":"tenant-a","docId":"doc-1","queueLength":3}
```

`tenantId`、`docId`、`queueLength` のようなフィールドは、アプリ側のコードが `extra={...}` で渡しているものです。

出力のレベルは、`SUI_LOG_LEVEL` で変えます。`SUI_LOG_JSON=false` にすると、人間向けの1行の書式になります。このとき、突き合わせに使う `requestId`、`actorRefHash`、`appRevision` は残ります。一方、`tenantId`、`docId`、`queueLength`、LLMの `trace_id` など、呼び出し側が `extra={...}` で渡すフィールドは、人間向けの書式では出力しません。これらの構造化したフィールドが必要な運用では、JSON出力のままにしてください。

### ログに出ないもの

[security.md](security.md) の方針に従い、主体の識別子（IdPに由来する `subject`）、外部テナントの参照、資格情報は、出力しません。`extra` にこれらの名前のフィールドが渡されたときは、`[redacted]` に置き換えます。これは方針を機械的に支えるもので、方針の代わりにはなりません。

### actorRefHash: 主体を照合するための指紋

リクエストの主体を解決できたときは、そのリクエストで出力したログのすべての行に、`actorRefHash` が付きます。主体とは、single-tenantのヘッダー認証の利用者、SaaSの信頼するセッションの本人、管理面のステージAとステージBのいずれかです。管理面の監査イベント（`admin_audit_events`）が持つ `actorRefHash`（SHA-256の先頭16桁）と同じ計算を使うため、両方の記録で、同じ主体には同じ値になります。

```json
{"timestamp":"2026-08-26T09:12:33+0000","level":"INFO","logger":"sui_sensemaking_api.ai","message":"llm_generate","requestId":"9f2c1d...","actorRefHash":"a1b2c3d4e5f6a7b8","task":"refine_card_text"}
```

- 一方向のハッシュです。元の識別子（利用者のIDや管理面のキー）には戻せません。主体の実際の識別子ではなく、照合のための指紋です。「このログの行とあのログの行は同じ主体によるものだ」と突き合わせられますが、それが具体的に誰なのかは、ログだけでは分かりません。
- 主体を解決できなかったリクエストには、このフィールドが出ません。`/healthz` のような認証のないエンドポイントや、single-tenantのプロファイルで認証ヘッダーのないリクエストが、これに当たります。フィールドがないのは異常ではなく、既定の匿名の状態です。
- そのため、エラーを起こした主体が誰なのかをログから特定する手段は、まだありません。できるのは、同じ主体によるログの行を、ひとまとめにするところまでです。個人を特定するには、DB側で追加の調査が必要です（たとえば、管理面のキーを入れ替えた記録や、SaaS側の利用者管理画面）。監査イベントの `actorRefHash` も、同じ制約を持ちます。監査ログの送信先の設定と保存については、下の「まだ観測できないこと」を参照してください。

## まだ観測できないこと

運用上重要なので、明示します。

- メトリクスがありません（前述）。容量の計画やスケールアウトの判断に使える入力がありません。導入の予定はなく、障害に気づく手段は、利用者からの申告に頼ります。
- 監査イベントは、既定では捨てられます。既定は、`SUI_AUDIT_EXPORT_ENABLED=false` と `SUI_AUDIT_TRANSPORT=noop` です。有効にしても、SafeMode中のイベントは、`SUI_AUDIT_ALLOW_IN_SAFE_MODE=false`（既定）では送信されません。`view` イベントはSafeModeを前提に発行されるため、監査を有効にしただけでは、文書を閲覧した記録は、ほとんど残りません。詳しくは、[security.md](security.md) の「監査ログの送信」を参照してください。
- 監査イベントのローカルでの保存と、照会するAPIがありません。送信先は、何もしない送信先と、外部のHTTPの2つだけで、DBにもファイルにも残りません。誰がこの文書を読んだかに答える手段は、現状ではありません。
- 管理面の操作の監査は、実装済みです（`admin_audit_events` テーブルと `GET /admin/provision/audit`）。
- ログの保存とローテーションは、Dockerの既定に任せています。上限がないため、長く稼働させるときは、ホスト側で `json-file` のローテーションを設定してください。

## 関連文書

- [operations.md](operations.md): 日常の運用と、障害時の初動。
- [diagnostics.md](diagnostics.md): 症状からの切り分けの順序と、診断バンドル。
- [security.md](security.md): ログの個人情報の方針と、監査ログの送信の境界。
