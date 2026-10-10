# sui-sensemakingバックエンド（フェーズ1 MVP）


> 環境変数と実行パラメータの定義元は `02_Architecture/runtime_parameter_registry.md` です。本書には必要最小限だけを書きます。追加や改名のときは、先にその文書を更新してください。

現在の実装は、`DocumentV1` のスナップショットの保存と読み込みを提供します。

## API

- `GET /healthz`
- `GET /docs/{doc_id}`
- `PUT /docs/{doc_id}`

## TEI Action用SUI Card移動コマンド（参照段階）

`src/sui_sensemaking_api/card_move_command.py`は、SUIの`DocumentV1`と確定座標から**新しいDocumentスナップショット**を生成するアプリケーション所有の純粋処理です。対象Cardの存在・識別の一意性、有限座標、島への所属変更を検証し、Source、Hold、Edge、レビュー帰属などの無関係な情報を保持します。既存の非包含Affiliationと移動後の包含関係が競合する場合は、黙って来歴を削除せず拒否します。

- `tests/test_card_move_command.py`：座標・矩形／多角形境界・島所属・来歴・負例の単体テスト。`../frontend/src/domain/fixtures/card_move_parity_v1.json`は、TypeScriptの`card_drag_commit.test.ts`とPythonが共用するケース表です。グリッド吸着はSUI UIが計算するため、Pythonには吸着後の最終座標を入力します。
- `tests/test_docs_roundtrip.py::test_sui_card_move_command_with_existing_sqlite_document_cas`：このコマンドの結果を既存の`PUT /docs/{id}`へ`If-Match`付きで保存し、`GET`とETagを照合するSQLite参照テスト。
- `../frontend/src/api/client.ts`の`getAuthoritativeDocument`：操作確定後の権威ある読み直しに`cache: "no-store"`を指定し、既存のセッション前提条件を引き継ぐ追加API。

今回の変更では**SUI所有のAction受付口** `POST /docs/{doc_id}/action-commit`も追加しました。**標準状態では無効**であり、`request.app.state.sui_native_action_v1_enabled is True`を明示的に成立させない限り、HTTP 404のActionエラーとして更新を拒否します。このオプトイン条件は現在テスト環境でのみ与えており、未検証の通常配備で新しい書込み面が有効にならないようにしています。この受付口はTEI Go Hostではなく、v1の要求エンベロープ（`protocolVersion`、`applicationID`、`resourceID`、`actionID`、`expectedRevision`、`payload`）を検証し、`X-TEI-Action: commit`と`Content-Type: application/json`を必須とします。`sui.move`の`cardId/x/y`だけを許し、対象DocumentとRevisionを照合します。ブラウザーの確定処理は`commitSuiCardMoveAction`を通じて同一オリジン・既存認証／CSRF／テナントヘッダー付きで送信できます。

この受付口は既存の`_authorize_request(... action="write", safe_mode=True)`と`DatabaseDocumentContentStore`を呼び出し、アーカイブ済み文書・Reviewer帰属・Card数・本文サイズの制限を再利用します。既存のRevision Headの条件付き更新が競合すれば全DBトランザクションをrollbackし、`409 revision_conflict`を返します。成功時は`{"protocolVersion":"1","revision":"<ETag>"}`、失敗時は`{"protocolVersion":"1","error":"..."}`を返し、FastAPIの`detail`ラッパーはAction応答へ混在させません。要求JSONの上限64KiB、重複キー、未知キー、他Application ID、非有限座標を拒否します。リクエスト本文は、JSON Middlewareでもバッファー保持前に上限を適用します。

**このSUIアプリケーション固有の受付口を、TEIの汎用Go Hostと混同しないでください。** TEI Host→SUI保存経路の正式な連結、Host側の認可/セッション伝播、監査、原子的なReact Undo取り込みはまだ行っていません。本番のCanvas操作は依然として既存ローカル確定を使用します。

`PUT /docs/{id}`は現行どおり既存の認可、テナント、アーカイブ状態、レビュー帰属、ETag・Revision処理を担当します。純粋コマンドだけでは同時更新を防げないため、TEI HostとSUI保存側のアダプターが、**権威あるRevisionの原子的比較・SUIコマンド実行・保存**を一単位として保証する必要があります。TEI CoreにはSUI専用構造を持ち込みません。

実Go Hostからの呼び出し、実セッション認可のエンドツーエンド実証、ブラウザーでのCard移動、Undo/Redo接続は**未実施**です。追加したPython／Vitest／SQLiteテストとSUIフロントエンド全体のテストも未実行であり、テストコードの追加だけをPASSの証拠とはしません。共通fixtureによるPythonとTypeScriptの比較テストを追加しましたが、実行と差分評価が必要です。

### ブラウザ確定の同期的適用と現状の制限

`frontend/src/api/tei_card_move_action.ts`は、サーバー確定応答・no-store再読込・SUI所有Document全体の照合後、**同期boolean**を返す`applyConfirmed`に限って反映完了とみなします。`Promise<boolean>`は原子的な状態反映を証明しないため、旧来の非同期ポート契約を廃止しました。フロントエンドでReactの`setState`を呼んで直後に`true`を返すだけでは、原子的な適用を保証できません。アプリが所有するDocument参照／ETag／未保存変更状態を同期的にガードしてから、履歴・dirty・Undo/Redoへ一貫して反映する仕組みが必要です。

SUIのPydantic保存は未指定の`Island.collapsed`を`false`として表現し、既存の`shape`／`geometry`の片方からもう一方を正規化します。Document全体照合はこの既知の差だけを正規化し、Source、Hold、Edge、レビュー帰属、Affiliation等を比較対象から除外しません。バックエンドが自動更新する`updatedAt`とオプションの`null`／未指定も正規化します。

`frontend/src/api/tei_card_move_action.integration.test.ts`は、SUI側ポート→同一オリジンAction POST→キャッシュ無効Document GET→同期所有状態反映を**モックHTTP応答**でつなぐテストです。**実サーバー／React／Go Hostは通っていません**。実行は`npm test -- src/api/tei_card_move_action.integration.test.ts`で行います。未保存のSUIローカル編集やセッションの変更がある場合、正式接続時の`isCurrent`は送信前から拒否する必要があります。

### 送信前の変更範囲検査と手動検証の入口（2026-10-10）

SUIの`createSuiCardMoveActionCommit`では、`dispatch`前に`isPureCardMove`を実行します。元Documentからの許容差分を**対象Cardのx/yと島への所属変更だけ**に限定し、他Card・島の属性／順序・未知Edge・Source・Hold・Affiliation・レビュー等の変更が混入した場合は`invalid_move_target`で**サーバーへ送信する前に拒否**します。これにより、サーバーは確定したが画面側では再読込差分を受理できない事例を事前に減らします。読込後の完全性照合も継続します。

島の`summaryText`があるときにSUI Pydanticが`summaryReviewed=false`を補完する正規化にも対応し、`summaryReviewed=true`など意味のある差分は拒否します。正常／異常ケースをNodeテストに追加しました。

手動検証の入口として`03_Implement/scripts/verify_native_action_boundary.sh`を追加しました。正確なPR headをクリーンなワークツリーにチェックアウトした後、リポジトリルートから次を実行できます（`pytest`、Node 22+、`npm`依存が構築済みであることが前提です）。

```sh
SUI_ACTION_EXPECTED_SHA="$(git rev-parse HEAD)" \
  bash 03_Implement/scripts/verify_native_action_boundary.sh
# 任意：全Frontend Vitestと本番ビルドも追加
SUI_ACTION_FULL_FRONTEND=1 SUI_ACTION_EXPECTED_SHA="$(git rev-parse HEAD)" \
  bash 03_Implement/scripts/verify_native_action_boundary.sh
```

Python純粋コマンド・SQLiteのAction保存・JSON保護・テナント認可のテスト、TypeScriptコンパイル、SUI Client/Domain/Adapter結合Vitest、Node実行を一括検証します。**未実行のため成功の証拠ではありません。** GitHub CIの再開やDraft解除は行いません。React CanvasとGo TEI Hostの実接続E2Eは別途必要です。

### 修復済み重大不具合：受信EnvelopeのRevision欠落と関数重複

`routes/docs.py`の以前の差分で、`_SuiCardMoveActionIntent.expectedRevision`が欠落し、さらにActionルートの実装が重複した状態になっていたことを確認しました。壊れた状態へ追記する方式は採用せず、重複のないコミット`d952d97`の`docs.py`を基点に、既存Origin/CAS検証、監査、レビュー帰属保護を再適用しました。現在のファイルでは`_SuiCardMoveActionIntent`、`post_sui_card_move_action`、`_commit_sui_card_move_action`、`expectedRevision`の定義はそれぞれ一つです。

`03_Implement/scripts/verify_native_action_boundary.sh`の先頭で、Pythonの`compileall`、`ast.parse`によるActionの必須フィールド・関数定義の唯一性、TypeScript主要エントリの署名重複を先行チェックします。これらが通らなければSQLite等の重い検証を開始しません。**スクリプトはまだ実行していません**。APIはデフォルト無効のままです。

### レビュー帰属とCard移動の責任境界

SUIの通常`PUT /docs/{id}`は、新しい人間レビュー申告に対して`reviewerRef`が実行者本人と一致することを必須とします。一方、Card移動Actionは既存のDocumentから`reviewAttribution`を**一切変更せず継承する操作**であり、過去のReviewer本人でなければ動かせないという制約は適切ではありません。そこでActionでの再レビュー本人照合を除外し、`updated.reviewAttribution == original.reviewAttribution`を明示検査しました。これによって、別の認可済み編集者による移動を可能にしつつ、レビュー記録の偽造・差し替えを拒否します。

SQLite結合テスト`test_sui_action_preserves_review_by_another_authorized_writer`を追加し、元Reviewerで保存された`human_reviewed`文書を別Actorが移動しても、reviewAttribution・critiqueInputs・reproposalDiffsが保たれることを確認する仕様を記述しました。従来のPUTで他人のReviewerを申告すると403になる検証は維持しています。**新規テストの実行は未了**です。

### 強いRevision・SUI-owned監査（2026-10-11追補）

SUIの通常`getDocument`は既存互換性のため弱いETagの正規化を許容します。一方、Action後の`getAuthoritativeDocument`は**ダブルクォート付き64桁SHA-256形式の強いETag**を必須とし、弱いETag（`W/"..."`）、未設定、未引用、非正規値を`invalid_authoritative_etag`で拒否します。通信は同一オリジン・認証情報明示・リダイレクト拒否・`no-store`を強制します。Actionのリクエストと応答のRevisionも**長さ64と非16進文字不在**を別々に確認し、JavaScriptの`# sui-sensemakingバックエンド（フェーズ1 MVP）


> 環境変数と実行パラメータの定義元は `02_Architecture/runtime_parameter_registry.md` です。本書には必要最小限だけを書きます。追加や改名のときは、先にその文書を更新してください。

現在の実装は、`DocumentV1` のスナップショットの保存と読み込みを提供します。

## API

- `GET /healthz`
- `GET /docs/{doc_id}`
- `PUT /docs/{doc_id}`

## TEI Action用SUI Card移動コマンド（参照段階）

`src/sui_sensemaking_api/card_move_command.py`は、SUIの`DocumentV1`と確定座標から**新しいDocumentスナップショット**を生成するアプリケーション所有の純粋処理です。対象Cardの存在・識別の一意性、有限座標、島への所属変更を検証し、Source、Hold、Edge、レビュー帰属などの無関係な情報を保持します。既存の非包含Affiliationと移動後の包含関係が競合する場合は、黙って来歴を削除せず拒否します。

- `tests/test_card_move_command.py`：座標・矩形／多角形境界・島所属・来歴・負例の単体テスト。`../frontend/src/domain/fixtures/card_move_parity_v1.json`は、TypeScriptの`card_drag_commit.test.ts`とPythonが共用するケース表です。グリッド吸着はSUI UIが計算するため、Pythonには吸着後の最終座標を入力します。
- `tests/test_docs_roundtrip.py::test_sui_card_move_command_with_existing_sqlite_document_cas`：このコマンドの結果を既存の`PUT /docs/{id}`へ`If-Match`付きで保存し、`GET`とETagを照合するSQLite参照テスト。
- `../frontend/src/api/client.ts`の`getAuthoritativeDocument`：操作確定後の権威ある読み直しに`cache: "no-store"`を指定し、既存のセッション前提条件を引き継ぐ追加API。

今回の変更では**SUI所有のAction受付口** `POST /docs/{doc_id}/action-commit`も追加しました。**標準状態では無効**であり、`request.app.state.sui_native_action_v1_enabled is True`を明示的に成立させない限り、HTTP 404のActionエラーとして更新を拒否します。このオプトイン条件は現在テスト環境でのみ与えており、未検証の通常配備で新しい書込み面が有効にならないようにしています。この受付口はTEI Go Hostではなく、v1の要求エンベロープ（`protocolVersion`、`applicationID`、`resourceID`、`actionID`、`expectedRevision`、`payload`）を検証し、`X-TEI-Action: commit`と`Content-Type: application/json`を必須とします。`sui.move`の`cardId/x/y`だけを許し、対象DocumentとRevisionを照合します。ブラウザーの確定処理は`commitSuiCardMoveAction`を通じて同一オリジン・既存認証／CSRF／テナントヘッダー付きで送信できます。

この受付口は既存の`_authorize_request(... action="write", safe_mode=True)`と`DatabaseDocumentContentStore`を呼び出し、アーカイブ済み文書・Reviewer帰属・Card数・本文サイズの制限を再利用します。既存のRevision Headの条件付き更新が競合すれば全DBトランザクションをrollbackし、`409 revision_conflict`を返します。成功時は`{"protocolVersion":"1","revision":"<ETag>"}`、失敗時は`{"protocolVersion":"1","error":"..."}`を返し、FastAPIの`detail`ラッパーはAction応答へ混在させません。要求JSONの上限64KiB、重複キー、未知キー、他Application ID、非有限座標を拒否します。リクエスト本文は、JSON Middlewareでもバッファー保持前に上限を適用します。

**このSUIアプリケーション固有の受付口を、TEIの汎用Go Hostと混同しないでください。** TEI Host→SUI保存経路の正式な連結、Host側の認可/セッション伝播、監査、原子的なReact Undo取り込みはまだ行っていません。本番のCanvas操作は依然として既存ローカル確定を使用します。

`PUT /docs/{id}`は現行どおり既存の認可、テナント、アーカイブ状態、レビュー帰属、ETag・Revision処理を担当します。純粋コマンドだけでは同時更新を防げないため、TEI HostとSUI保存側のアダプターが、**権威あるRevisionの原子的比較・SUIコマンド実行・保存**を一単位として保証する必要があります。TEI CoreにはSUI専用構造を持ち込みません。

実Go Hostからの呼び出し、実セッション認可のエンドツーエンド実証、ブラウザーでのCard移動、Undo/Redo接続は**未実施**です。追加したPython／Vitest／SQLiteテストとSUIフロントエンド全体のテストも未実行であり、テストコードの追加だけをPASSの証拠とはしません。共通fixtureによるPythonとTypeScriptの比較テストを追加しましたが、実行と差分評価が必要です。

### ブラウザ確定の同期的適用と現状の制限

`frontend/src/api/tei_card_move_action.ts`は、サーバー確定応答・no-store再読込・SUI所有Document全体の照合後、**同期boolean**を返す`applyConfirmed`に限って反映完了とみなします。`Promise<boolean>`は原子的な状態反映を証明しないため、旧来の非同期ポート契約を廃止しました。フロントエンドでReactの`setState`を呼んで直後に`true`を返すだけでは、原子的な適用を保証できません。アプリが所有するDocument参照／ETag／未保存変更状態を同期的にガードしてから、履歴・dirty・Undo/Redoへ一貫して反映する仕組みが必要です。

SUIのPydantic保存は未指定の`Island.collapsed`を`false`として表現し、既存の`shape`／`geometry`の片方からもう一方を正規化します。Document全体照合はこの既知の差だけを正規化し、Source、Hold、Edge、レビュー帰属、Affiliation等を比較対象から除外しません。バックエンドが自動更新する`updatedAt`とオプションの`null`／未指定も正規化します。

`frontend/src/api/tei_card_move_action.integration.test.ts`は、SUI側ポート→同一オリジンAction POST→キャッシュ無効Document GET→同期所有状態反映を**モックHTTP応答**でつなぐテストです。**実サーバー／React／Go Hostは通っていません**。実行は`npm test -- src/api/tei_card_move_action.integration.test.ts`で行います。未保存のSUIローカル編集やセッションの変更がある場合、正式接続時の`isCurrent`は送信前から拒否する必要があります。

### 送信前の変更範囲検査と手動検証の入口（2026-10-10）

SUIの`createSuiCardMoveActionCommit`では、`dispatch`前に`isPureCardMove`を実行します。元Documentからの許容差分を**対象Cardのx/yと島への所属変更だけ**に限定し、他Card・島の属性／順序・未知Edge・Source・Hold・Affiliation・レビュー等の変更が混入した場合は`invalid_move_target`で**サーバーへ送信する前に拒否**します。これにより、サーバーは確定したが画面側では再読込差分を受理できない事例を事前に減らします。読込後の完全性照合も継続します。

島の`summaryText`があるときにSUI Pydanticが`summaryReviewed=false`を補完する正規化にも対応し、`summaryReviewed=true`など意味のある差分は拒否します。正常／異常ケースをNodeテストに追加しました。

手動検証の入口として`03_Implement/scripts/verify_native_action_boundary.sh`を追加しました。正確なPR headをクリーンなワークツリーにチェックアウトした後、リポジトリルートから次を実行できます（`pytest`、Node 22+、`npm`依存が構築済みであることが前提です）。

```sh
SUI_ACTION_EXPECTED_SHA="$(git rev-parse HEAD)" \
  bash 03_Implement/scripts/verify_native_action_boundary.sh
# 任意：全Frontend Vitestと本番ビルドも追加
SUI_ACTION_FULL_FRONTEND=1 SUI_ACTION_EXPECTED_SHA="$(git rev-parse HEAD)" \
  bash 03_Implement/scripts/verify_native_action_boundary.sh
```

Python純粋コマンド・SQLiteのAction保存・JSON保護・テナント認可のテスト、TypeScriptコンパイル、SUI Client/Domain/Adapter結合Vitest、Node実行を一括検証します。**未実行のため成功の証拠ではありません。** GitHub CIの再開やDraft解除は行いません。React CanvasとGo TEI Hostの実接続E2Eは別途必要です。

が末尾改行の直前へ一致する問題（63桁+改行でも全長64）を防ぎます。弱いETag・短いもの・改行境界を検査するフロントエンドテストを追加しました。

Action受付側では、**DBコミットの成功後にSUI既存の`AuditDispatcher`へ`apply`イベントを送信**します。Tenant ID、Document ID、既存の検証済みActor、Action識別子、結果を記録し、Card本文、Source本文、ユーザー指定権限を監査メタデータへ複製しません。Revision競合やその他拒否では成功イベントを送信しません。監査機構は既存方針どおりfail-openであり、外部監査先の障害がコミット済みActionのHTTP成功を500へ変えないようにしています。テストでは成功イベント1件・再送0件・監査失敗後も保存済みRevisionを確認します。

**制限:** SUI監査の外部送信は既存のfail-open方針であり、配送成功が永続保証されるものではありません。Actionの法定監査・完全な永続的outbox・Actor付き生成履歴が必要な構成では、別途保証を追加するまで本番利用不可です。テストは追加済みですが、実Python/SQLite/Node/Vitest/TypeScript/Goによる最新PR headの検証は未完了です。

### サーバーActionの追加境界確認（2026-10-11）

SUI所有のAction受付口に、**Cookie有無と独立した、明示されたOriginの同一オリジン検証**を追加しました。Originが提示された場合、信頼されたリクエストのScheme/Hostと一致しない値は`403 request_origin_denied`です。Originがない非ブラウザー経路はTEI Go参照契約と同様に許容しますが、その場合も既存の認証／認可を必須とします。BFF Cookieがある場合には、従来どおりグローバル`BffCsrfProtectionMiddleware`がOriginとセッションに紐づくCSRFヘッダーを別途検証します。`X-TEI-Action: commit`がない要求も403、非JSON Content-Typeは`415 unsupported_content_type`とし、Go参照プロファイルのHTTPエラーコードに合わせました。悪意あるOriginの負例テストを追加しています。

保存済みDocumentが現行Document検証を満たさない場合は、クライアントの権限不足と混同せず`500 execution_failed`として拒否します。ドメイン変換が検証違反で失敗した場合は`400 invalid_payload`です。どちらも保存を行いません。

### 保存後のUndo履歴を扱う準備（本番React接続は未完了）

`frontend/src/domain/confirmed_card_move_state.ts`に、SUI既存の`DocumentHistory`（past/present/future）とETag、dirty状態の意味論を引き継ぐ**純粋な計画関数**`planConfirmedCardMoveState`を追加しました。未保存変更・ReadOnly・保存処理中・セッション失効・ドラッグ中・Document参照／ETag不一致を拒否し、受け付けた場合は「新しいサーバーRevisionを保存済みとして設定しつつ、移動前DocumentをUndo履歴に残す」状態を計算します。Undoはサーバー操作の取消しではなく、新しいローカル編集として保存し直す必要があります。SUIの履歴上限50とRedo破棄を維持し、入力Documentは複製します。

`frontend/src/domain/confirmed_card_move_state.test.ts`には正常系・原点差替え・Dirty/ReadOnly/Session/保存中・履歴制限・Undo保持のテストを追加。Github上のファイルをV8で型注釈除去して簡易実行した限定検査では**5/5ケース・29 assertions PASS**を確認しましたが、これは正式なVitest・TypeScript型検査ではありません。計画関数単体ではReactの複数Stateの原子的な更新を保証しないため、**本番App.tsxへの接続は引き続き見送ります**。SUI `runTenantScopedApiRequest`とDocument参照・ETag・dirtyの単一所有境界が整うまで、実Action受付口もデフォルト無効です。

### 接続試験の実行（未実行）

```sh
cd 03_Implement/backend
pytest -q tests/test_card_move_command.py tests/test_request_body_safety.py tests/test_docs_roundtrip.py -k 'card_move or native_action or cross_runtime_parity'
pytest -q tests/test_tenant_session_precondition.py
cd ../frontend
npm run typecheck
npm test -- src/api/client.test.ts src/domain/card_drag_commit.test.ts
```

上記は再現用コマンドであり、このチャット環境でPASSを確認したものではありません。実リポジトリを正確なコミットでチェックアウトした後、依存関係・DB環境・SafeMode・セッション前提条件をそろえて実行する必要があります。

## 永続化

- テーブル: `documents(id TEXT PK, version INT, updated_at TEXT, payload_json TEXT)`
- `payload_json` に `DocumentV1` の全体（JSON文字列）を保存
- スキーマはAlembicのマイグレーションで管理

## 環境変数

- `SUI_DATABASE_URL`
  - 既定値: `sqlite:///./sui_sensemaking.db`
  - ドライバを省略したURL（例: `mysql://...`）と、対応済みの非同期URLは、能力レジストリに記録した検証済みの同期ドライバへ正規化して使う
  - ドライバを明示する場合は、検証済みの組み合わせだけを受け付ける。例として、MySQLは`mysql+pymysql`、SQL Serverは`mssql+pymssql`、Oracleは`oracle+oracledb`を使う。未導入または未検証のドライバは、エンジンを作る前に拒否する
  - 正式対応はSQLite、PostgreSQL 16、MySQL 8.4、MariaDB 11.4、SQL Server 2022、CockroachDB 26.2.3、Oracle AI Database Free 23.26.2
  - 対応状況と、正式対応へ上げる条件: `02_Architecture/database_portability.md`
- `SUI_LLM_PROVIDER`
  - 既定値: `none`
  - 値: `none | local | large-scale | deepseek`（後方互換の別名: `local_http`, `external`）
  - `deepseek`では`SUI_DEEPSEEK_API_KEY`が必須。ベースURLと既定のモデルは、環境変数の定義元を参照
- `SUI_LLM_FALLBACK_TO_NONE`
  - 既定値: `true`
  - `true` の場合、`local` / `large-scale` の呼び出しに失敗したときは `none` に退避し、安全側で拒否する（HTTP 501）

## 実行

```bash
cd 03_Implement/backend
python -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn sqlalchemy alembic pydantic pydantic-settings psycopg[binary]
export PYTHONPATH=src
export SUI_DATABASE_URL="sqlite:///./sui_sensemaking.db"
export SUI_LLM_PROVIDER="none"
alembic upgrade head
uvicorn sui_sensemaking_api.main:app --reload
```

PostgreSQLを使う場合は、`SUI_DATABASE_URL` をPostgreSQLのURLに変更してください。

MySQLとMariaDBは、オプションのドライバを導入し、シングルテナント構成で使います。

```bash
pip install -e ".[mysql]"
export SUI_DATABASE_URL="mysql+pymysql://user:password@localhost:3306/sui_sensemaking"
# MariaDB: mariadb+pymysql://user:password@localhost:3306/sui_sensemaking
alembic upgrade head
```

SQL Server 2022も、オプションのドライバを導入し、シングルテナント構成で使います。接続先のデータベースは事前に作成してください。

```bash
pip install -e ".[mssql]"
export SUI_DATABASE_URL="mssql+pymssql://user:password@localhost:1433/sui_sensemaking"
alembic upgrade head
```

CockroachDB 26.2.3も、オプションのdialectを導入し、シングルテナント構成で使います。接続先のデータベースは事前に作成してください。

```bash
pip install -e ".[cockroachdb]"
export SUI_DATABASE_URL="cockroachdb+psycopg://user:password@localhost:26257/sui_sensemaking"
alembic upgrade head
```

`--insecure`はローカルでの試験専用です。本番では、CockroachDBのTLS構成と適切な`sslmode`を使ってください。

Oracle AI Database Free 23.26.2も、Thinモードのオプションのドライバを導入し、シングルテナント構成で使います。URLのパスはSIDとして解釈されるため、PDBへ接続するときは、クエリパラメータの`service_name`を使ってください。

```bash
pip install -e ".[oracle]"
export SUI_DATABASE_URL="oracle+oracledb://user:password@localhost:1521?service_name=FREEPDB1"
alembic upgrade head
```

Oracle Database Freeには、CPU、RAM、ユーザーデータ量、同じ論理環境内のインスタンス数に、製品としての上限があります。本番で採用する前に、Oracleの現行のライセンス条件と必要なエディションを確認してください。

## 最小限のバックアップと復元

`documents.payload_json`には、`DocumentV1`の全体をJSONのスナップショットとして保存しています。バックアップは、取得しただけで完了とせず、本番とは別のデータベース、スキーマ、パスへ復元して、Document、判断ログ、スキーマのリビジョン、大容量の本文を照合してください。

SQLite、PostgreSQL、MySQL、MariaDB、SQL Server、CockroachDB、Oracleの検証済みの最小手順と中断条件は、公開されている運用手順の[`operations.md`「バックアップと隔離復元」](../../04_Documentation/operations.md#バックアップと隔離復元)を参照してください。製品別のコマンドは、このREADMEには重複して書きません。


## テスト

```bash
cd 03_Implement/backend
export PYTHONPATH=src
pytest
```

### CE4 CLIの認証

`sui_sensemaking_api.cli` は、業務プレーンのAPI認証に `SUI_API_KEY` を使います。秘密は環境変数に置いてください。コマンドラインでキーを渡すオプションは、意図的に用意していません。プロセスの引数やシェルの履歴は、秘密を安全に渡す手段ではないためです。値が未設定なら、開放された `local-dev` の動作のままです。

### コントロールプレーンのCLI

同じモジュールは、運用者向けのコントロールプレーンのCLIも提供します。ブートストラップの資格情報は `SUI_ADMIN_API_KEY` からだけ読み取り、業務プレーンの `SUI_API_KEY` は、すべての `admin` コマンドで意図的に無視します。書き込みのコマンドは、変更のプレビューを表示し、対話的な確認を求めます。自動化では、明示的に `--yes` を付けます。

テナントのモデル許可リストを更新するときは、プレビューの読み取りで返されたリビジョンも送ります。書き込みの前に別の管理者が同じテナントを変更していた場合、CLIは新しいポリシーを上書きせず、`model_allowlist_conflict` で非ゼロの終了コードを返して終了します。

```bash
export SUI_ADMIN_API_KEY='...'
python -m sui_sensemaking_api.cli admin models list
python -m sui_sensemaking_api.cli admin providers register \
  --id deepseek --kind deepseek --display-name DeepSeek \
  --base-url https://api.deepseek.com --api-key-ref SUI_DEEPSEEK_API_KEY
python -m sui_sensemaking_api.cli admin models register \
  --id deepseek-v4-flash --provider-id deepseek --display-name 'DeepSeek V4 Flash' \
  --capabilities intermediate,generate
python -m sui_sensemaking_api.cli admin tenants model-allowlist-set \
  --tenant-id local-default --model-id deepseek-v4-flash
python -m sui_sensemaking_api.cli admin models set-lifecycle \
  --id deepseek-v4-flash --state disabled
python -m sui_sensemaking_api.cli admin audit list --limit 50
```

管理者の資格情報を、エンドユーザー向けのSPAに置かないでください。固定の資格情報は、ADR-0072のブートストラップの経路です。別に配備する管理者コンソールと、対話的なステージBのcapabilityセッションは、別の後続作業として残っています。

PostgreSQLの往復テストを実行する場合。

```bash
export SUI_DATABASE_URL="postgresql+psycopg://sui_sensemaking:sui_sensemaking@localhost:5432/sui_sensemaking"
export SUI_RUN_PG_TESTS=1
alembic upgrade head
pytest -m postgres
```

テナントRLSの実地のテスト行列は、マイグレーションの所有者とは別の、実行用のロールで実行します。実行用のロールには、対象スキーマの通常のDML権限を付与し、superuser属性と`BYPASSRLS`は付与しないでください。同じ資格情報や、RLSを迂回できるロールでは、テストが失敗します。

```bash
export SUI_DATABASE_URL="postgresql+psycopg://migration_owner:...@localhost:5432/sui_sensemaking"
export SUI_TEST_POSTGRES_RUNTIME_DATABASE_URL="postgresql+psycopg://sui_sensemaking_runtime:...@localhost:5432/sui_sensemaking"
export SUI_RUN_PG_RLS_TESTS=1
pytest -q tests/test_document_access_rls_postgres.py
```

認証フェデレーションのLevel 2（モックのSP/IdP）を実行する場合。

```bash
cd 03_Implement/backend
export PYTHONPATH=src
export SUI_LEVEL2_DIAG_DIR=.artifacts/auth-level2/legacy-federation
./scripts/run_auth_level2.sh
```

- プロバイダのプロファイルのフィクスチャ: `tests/level2/fixtures/provider_profile_*.json`, `tests/federation/profiles/*.json`
- 差異を再現する観点: ヘッダー名、claim名、groupsの形式、amr/acrの有無
- 診断のJSONは、`SUI_LEVEL2_DIAG_DIR` を明示したときだけ出力する。通常の `pytest` は、作業ツリーに診断ファイルを書き込まない。

同じ統合ハーネスを直接実行する場合。

```bash
cd 03_Implement/backend
tests/scripts/run_auth_level2.sh
```

- プロバイダのプロファイルのフィクスチャ: `tests/federation/profiles/*.json`
- 失敗時のログ: `.artifacts/auth-level2/`


## LLMプロバイダの監査メタデータ

`/ai/*` のエンドポイントでは、監査できるように、次の項目を構造化ログに記録します。

- `provider` / `provider_kind`
- `model_id`
- `requested_at`（UTCのISO 8601）
- `transport`
- `trace_id`
- `fallback_to_none`

これらは `extra={...}` で渡され、`SUI_LOG_JSON=true`（既定）のときは、JSONの1行として出力されます。OPS-OBSERV-01より前はログの設定がなく、`logging.Formatter` の既定の書式は `extra` を出力しないため、**上記の項目は実際には出力されていませんでした**。出力レベルは `SUI_LOG_LEVEL` で変更できます。すべてのリクエストには `X-Request-Id` が付き、ログ行の `requestId` フィールドと突き合わせられます。
