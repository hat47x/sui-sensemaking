# E2Eテスト

対象読者: sui-sensemakingの実装変更に対してPlaywright E2E、回帰テスト、PR前の確認を行う開発者、QA担当、メンテナ。

目的: Docker Composeまたはローカル起動環境で、開発者向けのE2Eを再現できるようにします。一般利用者向けの画面確認は [受け入れ確認](../../../04_Documentation/acceptance_check.md) を参照してください。

範囲外: 組織固有のテスト管理、非公開データを使った検証、CI基盤の詳細設定、一般利用者向けの導入説明。

## 事前準備

標準構成を起動します。

```bash
cd 03_Implement/deploy
docker compose up --build -d
curl -fsS http://127.0.0.1:8080/api/healthz
node ../frontend/scripts/e2e_storage_preflight.mjs \
  --write-base-url http://127.0.0.1:8080/api
```

`e2e_storage_preflight.mjs` は、毎回一意なIDの合成 `DocumentV1` を作成し、フロントエンドのプロキシ経由で `PUT -> GET` した応答の本体と `ETag` が一致することを確認します。まっさらなPostgreSQLでも成立し、事前に投入した固定の文書には依存しません。これは `ADR-0019` の標準Composeの最小受入（ヘルスチェックと、実PostgreSQLへの保存経路の往復確認）を実行できる形にしたものです。

ローカル開発サーバーで確認する場合は [導入手順](../../../04_Documentation/installation.md) の「Dockerを使わない最小起動」を使います。Viteの `/api` プロキシはバックエンドが起動していないと500を返すため、E2Eの前に次の両方を確認します。フロントエンドのポートを変更した場合は `4173` を実際のポートに置き換えてください。

```bash
curl -fsS http://127.0.0.1:8000/healthz
cd 03_Implement/frontend
node scripts/e2e_storage_preflight.mjs \
  --write-base-url http://127.0.0.1:8000 \
  --read-base-url http://127.0.0.1:4173/api
```

ローカル経路ではバックエンドへ `PUT` し、同じ文書をフロントエンドのプロキシから `GET` します。これでバックエンドの保存とプロキシの接続を同時に確認できます。

## 手動確認と自動テストの違い

| 種類 | 目的 | 使う場面 |
| --- | --- | --- |
| 手動スモークテスト | 利用者の主要操作が実際にできるかを見る | 初回起動、画面変更、障害調査 |
| Playwright E2E | ブラウザ操作を自動で再現する | PR、リリース前、回帰確認 |
| 単体・回帰テスト | 小さなロジックやデータ変換を速く確認する | 実装変更後、原因切り分け |

一般利用者の確認では、まず [受け入れ確認](../../../04_Documentation/acceptance_check.md) の手動スモークテストだけで十分です。開発変更を含む場合は自動テストも実行します。

## 手動スモークテスト

1. `http://localhost:8080` を開く。
2. 新規ドキュメントを作成する。
3. カードを追加する。
4. カードを移動する。
5. 島またはレビュー関連の表示が崩れていないことを確認する。
6. 保存し、ページを再読み込みする。
7. 変更が残っていることを確認する。
8. 共有やエクスポートを使う場合、[データ取り扱い](../../../04_Documentation/data_handling.md) のチェックリストに沿って、出力に秘密情報や内部メモが混ざっていないことを確認する。

表示設定やSafeModeの確認を含める場合は、`View` パネルを開きます。手動スモークテストでは、視点プリセット、深さ、SafeMode、旧形式エクスポートの導線が表示され、キャンバスが操作不能になっていないことを確認します。

![View パネルを開いた手動確認画面](../../../04_Documentation/assets/screenshots/view-controls-safe-mode.png)

## Playwrightを実行する

フロントエンドの依存関係を入れます。

```bash
cd 03_Implement/frontend
npm ci
```

`npm ci` は `package-lock.json` に固定された依存関係を入れるので、E2Eの再現性を保ちやすい手順です。

E2Eを実行します。

```bash
npm run e2e
```

画面を見ながら確認する場合。

```bash
npm run e2e:headed
```

モックを使うE2Eだけ実行する場合。

```bash
npm run e2e:mock
```

## 単体・回帰テスト

E2Eの前に軽い回帰確認を行う場合。

```bash
cd 03_Implement/frontend
npm run typecheck
npm run test
npm run test:regression-guards
```

### 代表ユーザ操作の回帰レーン

`npm run test:regression-guards` には `src/ui/ux_operability_regression.test.ts` を含めます。このテストは、マウス操作とキーボード操作が同じ選択結果になること、カードを選択した後に文脈パネルへ進めること、`表示` / `共有と再現` パネルを `Escape` で閉じて起点へ戻れることを、実装上の契約として検証します。

このレーンはPlaywrightの代わりではありません。狙いは、E2Eの実行前に主要操作の入口が壊れていないことを短時間で確認し、`PRODUCT-QA-01` のG2主要操作ゲートに渡す最初の証跡を作ることです。リリース候補では、次の順で証跡を積み上げます。

Windowsのローカルシェルで `npm` がPATHにない場合は、同梱Node.jsなど、プロジェクトで承認されたNode.jsの実行ファイルから `node .\node_modules\vitest\vitest.mjs run <対象テスト>` を実行して、同じ対象を確認します。CIと通常の開発環境では `npm run test:regression-guards` を基準のコマンドとします。

| 段階 | 代表操作 | 証跡 |
| --- | --- | --- |
| 契約テスト | ポインタ選択、`Enter` / `Space` 選択、`Escape` 閉鎖、フォーカス復帰 | `npm run test:regression-guards` |
| 手動スモーク | 初期表示、カード作成、移動、保存、再読込、共有前確認 | 手順メモ、必要に応じてスクリーンショット |
| Playwright E2E | 作成→編集→保存→再読込、共有試行→条件充足→許可 | `npm run e2e` または `npm run e2e:mock` |

キーボードでは、`Tab` で対象へ移動し、`Enter` または `Space` で選択、`Escape` で一時パネルを閉じます。マウスでは、対象をクリックまたはドラッグした後、同じ詳細表示・保存・共有前確認へ進めることを確認します。どちらか一方でしか成立しない操作は、G2では未達とします。

バックエンド。

```bash
cd 03_Implement/backend
python -m pytest
```

## 確認観点

| 観点 | 期待 |
| --- | --- |
| 起動 | `/api/healthz` が成功する |
| 保存経路 | 一意な合成documentの `PUT -> GET` でpayloadと `ETag` が一致し、固定seedデータに依存しない |
| 保存 | 作成・編集した内容が再読み込み後も残る |
| SafeMode | 未レビュー情報をAIが自動で確定しない |
| LLM無効 | `SUI_LLM_PROVIDER=none` ではAI機能が無効として扱われる |
| エクスポート | 秘密情報や共有不要な調査メモが混ざらない |
| 画面 | ヘッダー、ツールバー、主要ボタンが狭い幅でも重ならない |
| 操作性・開始 | 初期表示で主要操作へ到達できる |
| 操作性・選択 | キーボードで選択対象へ到達し、選択結果を確認できる |
| 操作性・表示 | 文脈を優先し、必要な情報が先に示される |
| 操作性・閉じる | `表示` / `共有と再現` を `Escape` で閉じられる |
| 操作性・復帰 | 閉じた後に起点フォーカスへ戻る |

## 画面幅の目安

画面崩れを確認するときは、少なくとも次の幅を見ます。

| 幅 | 目的 |
| --- | --- |
| 1280px | 標準的なデスクトップ |
| 960px | 狭めのデスクトップとタブレット |
| 390px | モバイル相当 |

すべての細部を確認する必要はありません。主要操作が見えるか、テキストが重ならないか、保存操作ができるかを優先します。

390pxでは、ヘッダーが複数行に折り返され、検索、表示モード、共有と再現、保存などの主要操作が画面外へ消えないことを確認します。

![390pxのヘッダー確認](../../../04_Documentation/assets/screenshots/mobile-toolbar-smoke-390.png)



## QA MonkeyとE2Eの境界（テスト資産限定）

本節は、変更対象を **テスト資産だけ** にする境界の定義です。`src/ui` / `src/canvas` など本番実装コードの機能変更は含めません。

### 層の分離（契約テスト、スモーク、E2E）

| 層 | 目的 | 変更対象 | 禁止事項 |
| --- | --- | --- | --- |
| 契約テスト（単体・結合） | APIとドメインの契約の不整合を早く見つける | `03_Implement/frontend/tests/**/*` フィクスチャとテスト | UI機能の追加、仕様変更 |
| スモーク（手動・軽量） | 起動、主要導線、安全境界をすぐ確認する | 手動手順、記録テンプレート | 合否を翻訳品質だけで決めること |
| E2E（Playwright） | 実利用のシナリオと境界の回帰を自動で再現する | Playwrightのspec、モックのフィクスチャ、文書 | 本番データへの依存、不安定な外部依存 |

### QA Monkey群の優先境界

1. SafeModeと共有・エクスポートは、安全側で拒否する動作を維持する。
2. `SUI_LLM_PROVIDER=none` でも回帰検証を続けられる。
3. `ja/en` のユーザージャーニーが等価かどうかはE2Eで機械的に判定し、翻訳の品質は人間のレビューで別に見る。

### 再現性と不安定なテストへの対策（必須）

- モックとフィクスチャを優先し、外部依存を固定する。
- 同一commitで `npm run test` → `npm run e2e:mock` を同じ順で実行し、差分を再現できることを確認する。
- 不安定な失敗が出た場合は、まず再実行か待機の調整で切り分ける。同じ原因で繰り返し失敗するなら、無条件に再実行して見逃さず、フィクスチャか実装の問題として対象のissueに記録する。


## QA issueをOpenにする条件

`issue-QA-*` をDraftからOpenへ進めるときの受入条件、完了条件、証跡の形式、ゲートのテンプレートは、対象のissueメモ、[issues/README.md](../../../01_Plans/issues/README.md)（ライフサイクルの運用）、`01_Plans/adr/ADR-0019-e2e-verification-policy-and-compose-runbook.md` に従います。値や進行のテンプレートは本書へ複製せず、対象のissueを直接参照してください。

## 失敗時に残す情報

- 実行したコマンド
- 対象URL
- ブラウザと画面幅
- 失敗した操作
- API status code
- `docker compose logs api --tail=200`
- 可能ならスクリーンショット

ログやスクリーンショットを共有するときは、APIキー、トークン、パスワード、未加工の顧客情報を含めません。どこまで残すか迷う場合は [データ取り扱い](../../../04_Documentation/data_handling.md) を参照してください。

## E2Eの記録

検証結果を残すときは内部の検証記録テンプレートを使います。個人情報、秘密情報、内部承認履歴は記録しません。

### 実行経路とPR証跡

標準経路はDocker Composeです。Dockerを実行できない場合だけSQLiteとフロントエンドの開発サーバー、またはモックのフィクスチャを使い、Composeとの差分によるリスクをPRに残します。詳細な優先順位と例外条件は `01_Plans/adr/ADR-0019-e2e-verification-policy-and-compose-runbook.md` を参照してください。

```md
### E2E verification
- Path: Compose | SQLite | mock
- Command:
- Result: pass | fail | blocked | not executed
- Evidence:
- Not executed reason:
- Unverified risk delta:
- Resume condition / owner:
```

代替経路で未確認になる代表境界は次のとおりです。

| Risk ID | Composeで確認する境界 | 代替経路での扱い |
| --- | --- | --- |
| R-01 | PostgreSQLの方言、マイグレーション、コネクションプール | 未確認として記録し、Composeでroundtripを再実行する |
| R-02 | web経由の`/api`の書き換え、CORS、圧縮 | フロントエンドへの直結だけで合格にしない |
| R-03 | dbが正常になってからapi、webの順に起動する連鎖 | `docker compose ps`とapiのログを後日確認する |
| R-04 | Composeのネットワーク上でのweb、api、dbの接続 | モックの成功を結合テストの成功と表現しない |

### 認証連携を変更した場合

認証ヘッダー、JWTの対応付け、プロバイダのプリセット、ログアウト、ステップアップ、JITプロビジョニングの境界を変更した場合は、通常のフロントエンドE2Eだけでは完了にしません。`01_Plans/adr/ADR-0020-oidc-saml-mock-idp-sp-profile.md` とバックエンドの `scripts/run_auth_level2.sh` に従い、プロバイダのプロファイルのフィクスチャを使ったLevel 2を実行します。

### フィクスチャで固定した公開範囲スイートの境界

`e2e/pub_visibility_i18n_readonly_flow.spec.ts` は、文書、public-packのインデックス、プロバイダの状態をPlaywrightのrouteで固定する、フロントエンド用のフィクスチャスイートです。各シナリオはバックエンドのプロセスなしで動くよう、決まった応答をrouteで返します。

このスイートが検証するのは、ブラウザ内での公開範囲の挙動と再読み込み後の表示状態です。バックエンドの永続化やプロバイダとの結合を検証したことにはなりません。それらの契約は、バックエンドのテストと、明示的に構成した結合テストの実行で確認します。

| シナリオ | 境界 |
| --- | --- |
| 再読み込み後の公開範囲 | フィクスチャで固定したUIとブラウザのストレージ |
| viewとpackで異なる公開範囲の説明 | フィクスチャで固定したUI |
| 英語切り替えフロー | フィクスチャで固定したUI |
| readOnlyとSafeModeの制限 | フィクスチャで固定したUI |

この境界を確認するコマンドは次のとおりです。

```bash
cd 03_Implement/frontend
node ./node_modules/@playwright/test/cli.js test e2e/pub_visibility_i18n_readonly_flow.spec.ts --reporter=line
```

### 実バックエンドが必須のスイートの境界（AI-MODEL-UX-01）

`e2e/ai_model_ux_available_models_reason.spec.ts` は、`GET /ai/available-models` の `unavailableReason`（`no_active_models` / `provider_unavailable` / `tenant_policy_excludes_all`）が、実バックエンドのモデルレジストリ、プロバイダ、テナント許可リストの状態から実際に導かれ、ModelSelectorの案内文言に正しく反映されることを検証するスイートです。他のe2e specとは逆に、page.routeでは固定しません。`/admin/provision/models/**` の管理APIで実際のレジストリを変更し、再読み込みで取得し直させます。

`SUI_E2E_REAL_BACKEND=1` を設定しない限り全ケースをスキップするため、`npm run e2e` / `npm run e2e:mock` の既定の実行は本スイートの影響を受けません。実行するには、SQLite代替E2Eの手順（本書冒頭）でバックエンドを起動したうえで、次を実行します。

```bash
cd 03_Implement/backend
PYTHONPATH=src SUI_DATABASE_URL="sqlite:////tmp/sui_sensemaking_model_ux_e2e.sqlite3" python -m alembic upgrade head
PYTHONPATH=src SUI_DATABASE_URL="sqlite:////tmp/sui_sensemaking_model_ux_e2e.sqlite3" SUI_LLM_PROVIDER=none \
  python -m uvicorn sui_sensemaking_api.main:app --host 127.0.0.1 --port 8000

cd 03_Implement/frontend
SUI_E2E_REAL_BACKEND=1 node ./node_modules/@playwright/test/cli.js test \
  e2e/ai_model_ux_available_models_reason.spec.ts --reporter=line --workers=1
```

`no_active_models` のケースは空のモデルレジストリを前提とするため、バックエンドは毎回新しいSQLiteファイルで起動してください（前回の実行で登録したフィクスチャが残っていると、誤って失敗します）。ローカル開発のプロファイルは無設定で管理面が開いているため、`SUI_API_KEY` / `SUI_ADMIN_API_KEY` は不要です。4つ目の理由（`no_user_selectable_models`）は、issueメモの受入条件が明示する3件（プロバイダの不一致、許可リストが空、有効なモデルなし）に含まれないため、本スイートの対象外です。

### 実バックエンドが必須のスイートの境界（DATA-INQUIRY-CONCURRENCY-01 AC-9）

`e2e/inquiry_bundle_backend_conflict.spec.ts` は、`POST /inquiry-bundles/{journey_id}` で起きる実際のCAS競合（古い `If-Match` による409）について、実ブラウザの`InquiryJourneyPrototypePanel`が偽の保存成功を表示しないこと、`conflict_backend`の競合文言を表示すること、自動の再試行や自動マージでローカルの編集や観測済みのリビジョンを黙って書き換えないことを検証するスイートです。ブラウザ自身の保存に加えて、`request`フィクスチャで同じjourneyへ直接2本目のPUT（正しい`If-Match`）を送り、サーバー側のリビジョンを実際に進めます。2クライアントの構成でしか再現できない競合を検証します。

AI-MODEL-UX-01のスイートと同じ`SUI_E2E_REAL_BACKEND`による切り替えと、同じSQLite代替E2Eの起動手順を使います（新しい環境変数は導入していません）。journeyIdはテストごとに`crypto.randomUUID()`由来の値を新しく生成するため、`no_active_models`のケースのように新しいDBを前提とせず、他のフィクスチャが残っているバックエンドでもそのまま実行できます。

```bash
cd 03_Implement/backend
PYTHONPATH=src SUI_DATABASE_URL="sqlite:////tmp/sui_sensemaking_inquiry_conflict_e2e.sqlite3" python -m alembic upgrade head
PYTHONPATH=src SUI_DATABASE_URL="sqlite:////tmp/sui_sensemaking_inquiry_conflict_e2e.sqlite3" SUI_LLM_PROVIDER=none \
  python -m uvicorn sui_sensemaking_api.main:app --host 127.0.0.1 --port 8000

cd 03_Implement/frontend
SUI_E2E_REAL_BACKEND=1 node ./node_modules/@playwright/test/cli.js test \
  e2e/inquiry_bundle_backend_conflict.spec.ts --reporter=line --workers=1
```

DELETEの`If-Match`競合（同issueのAC-3とAC-5）は対象外です。パネルに削除操作のUIがなく（`deleteInquiryBundle`はclient.tsにだけ実装されています）、バックエンド側のCASは`test_inquiry_bundle_routes.py`で確認済みです。UIから呼べない機能のE2Eは新たに作らない、という判断です。

## 関連文書

- [導入手順](../../../04_Documentation/installation.md)
- [受け入れ確認](../../../04_Documentation/acceptance_check.md)
- [運用手順](../../../04_Documentation/operations.md)
- [診断と障害調査](../../../04_Documentation/diagnostics.md)
- [データ取り扱い](../../../04_Documentation/data_handling.md)
- [セキュリティ](../../../04_Documentation/security.md)

## リリースゲートとの連携（QA専任の運用）

- E2Eの結果は、`PRODUCT-QA-01` のゲート記録に `result/evidence/owner/due` の形式で転記します。
- BlockerまたはCriticalを検出した場合は、E2Eの段階で直ちに止め、`MVP-EXIT-01` の判定をFailにします。
- Composeを実行できない場合は、`ADR-0019` の代替経路（SQLiteまたはモック）を使い、未実施の理由を必ず記録します。
