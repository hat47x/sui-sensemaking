# sui-sensemaking MVP API I/F


> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。
> 現行契約と Stream / freeze 履歴の読み分けは `02_Architecture/contract_reading_guide.md` を参照する。
> MVPのCRUDサポート表と運用保守境界は `02_Architecture/data_model_operations_overview.html` を参照する。
本ドキュメントは、sui-sensemakingの **MVP API（Documentの保存・取得）** を定義します。

- MVPでは **スナップショット保存** を基本とします
- Documentの標準CRUDは **全体保存/取得** に絞ります
- 認証/認可、監査、Context/AI系APIは限定契約として別節で扱い、個別エンティティCRUDとは分けます
- APIはイントラ利用や組織導入を含むため、単純で監査しやすい境界を優先します

---

## 1. 基本方針

### 1.1 リソース単位

- 主リソース：`Document`は次のとおりです。
- 最小のCRUD：Create / Read / Update

DeleteはMVPおよび現製品化準備段階の標準APIに含めない（`ADR-0035` Accepted 2026-07-13）。必要性だけを理由に追加せず、削除方式・監査保持・復旧不能性を別ADRで先に固定する。
Card / Edge / Island / NarrativeなどはDocument内の論理構造であり、MVPでは個別リソースCRUDを正本にしません。

### 1.2 更新方式

- `PUT /docs/{doc_id}` で **Document全体** を置き換える
- クライアントは `updatedAt` を更新して送る
- サーバは検証後に保存し、保存後のDocumentを返す

### 1.3 競合

MVPでは以下のいずれかで簡素に扱う。

- Last Write Wins（デフォルト）
- `If-Match` / `ETag` による楽観ロック（任意ヘッダー。指定時は不一致を拒否）

`If-Match` が無い場合はLWWとし、`If-Match` がある場合は保存済み `ETag` と一致したときだけ更新する。

---

## 2. エンドポイント

### 2.1 Create

MVPの実装境界では、クライアントがIDを指定して **PUT** `/docs/{doc_id}` を呼び、対象IDが存在しない場合に作成として扱う。

- Request body：`DocumentV1`は次のとおりです。
- Response：保存後の `Document`

**POST** `/docs` は、サーバ採番の新規作成が必要になった場合の将来候補であり、MVPの必須APIではない。`POST /docs` を標準契約に昇格する場合は、`DATA-CONTRACT-01` で文書、実装、テストを同期する。

---

### 2.2 Read

**GET** `/docs/{doc_id}`

- Response：`DocumentV1`は次のとおりです。
- Not found：404

**GET** `/docs`（第2反復・キャンバス一覧の土台）

- tenant-scopedな文書の**行メタデータ一覧**を返す（SafeMode非依存 — 本文カードは含まない。本文は `GET /docs/{doc_id}` のSafeMode経路で取得する）。
- Query：`createdBy`（任意・作成者フィルタ。「自分の文書」。`created_by=NULL` の移行文書は一致しない）。
- Query（**SEC-DOC-BOUND-05・keyset pagination**）：`limit`（既定500・最大500）と `cursor`（前ページ末尾の不透明カーソル）。並び順 `(updated_at DESC, id ASC)`。次ページがある場合 `X-Next-Cursor` レスポンスヘッダーで次カーソルを返す（`{urlencoded(updated_at)}:{id}`）。レスポンスは配列のまま（既存クライアントは後方互換）。
- Response：`DocumentListItem[]`、`updated_at` 降順
  - `{ id, title?, created_by?, lifecycle_state, updated_at }`
  - `created_by` は不変の作成者事実（未特定の移行文書は省略）。`lifecycle_state` は `active` / `archived`（ADR-0073 D2=A）。
- 認可（`SEC-DOC-BOUND-06`）：tenant-scopedであることに加え、`access_control_adapter` が既定の `noop` 以外
  （実質的なPDPが構成されている）場合は `document_access_metadata.visibility` でも絞り込む。
  `Public`/`Unlisted`/`Org` は無条件、`Restricted`（メタデータ行が無い場合も含む）は作成者本人にのみ返す。
  PDPへの追加照会は行わない——ローカルの `visibility` 列だけで判定する保守的な近似であり、
  厳密な対象者判定の代替ではない。`noop`（既定）の場合、単一文書の `GET`/`PUT` もvisibilityを参照しないため、
  一覧も絞り込まない（一覧だけを単一文書より厳しくしない）。

**POST** `/docs/{doc_id}/archive` / **POST** `/docs/{doc_id}/unarchive`（ADR-0073 D2=A）

- `archive`: `lifecycle_state` を `archived` に遷移。`unarchive`: `active` に戻す。
- Response：204。存在しない文書は404。
- 認可（`SEC-DOC-BOUND-06`）：`GET`/`PUT /docs/{doc_id}` と同じ `_authorize_request(action="write")` を経由する
  （tenant-scopedのみではない）。

---

### 2.3 Update

**PUT** `/docs/{doc_id}`

- Request body：`DocumentV1`は次のとおりです。
- Response：保存後の `DocumentV1`
- Validation error：400

---

### 2.4 Document監査イベント（FB-RM-PUB-05 / CE4）

Document本体の標準CRUDとは別に、共有・Context操作の監査連携点を持つ。監査送信は本体処理を阻害しないfail-open dispatcher方針を維持するが、各リクエスト自体はSafeMode/readOnly/access-controlの判定対象になる。

**POST** `/docs/{doc_id}/export-audit`

- Request body: `{ "safeMode": boolean, "exportKind": string }`
- Response: `{ "status": "accepted" }`
- 目的: export完了通知を監査連携アダプタへ委譲（監査送信失敗でも本体機能を阻害しない）
- SEC-AUDIT-DUP-01: 同一論理操作（`tenant/doc/exportKind`）の重複POSTは、`SUI_AUDIT_DEDUP_WINDOW_SECONDS`（既定5秒）内で外部シンクへ1回しか送出されない（クライアント再送・二重クリックの重複集計を防止）。HTTP応答はいずれも `{ "status": "accepted" }` のまま。

**POST** `/docs/{doc_id}/context-audit`

- Request body:
  - `operation: "query" | "bundle" | "proposal" | "apply"`
  - `safeMode: boolean`
  - `equivalenceKey: <64hex>`
  - `bundleHash: <64hex>`
  - `sourceBundleHash?: <64hex> | mock:<64hex>`
  - `queryHash?: string`
  - `dryRun: boolean`
  - `sideEffect: "none"`
  - `rejectReasonCode?: "none" | "missing_event" | "equivalence_mismatch" | "dry_run_side_effect" | "safemode_regression"`
  - `command: string`
  - `channel: "api" | "cli" | "gui" | "mcp"`
  - `schemaVersion: "ce4.audit.v1"`
- Response: `{ "status": "accepted" }`
- Error:
  - 409: CE4の4点監査イベントが `apply` 時点で揃わない、またはdeterministic判定が不成立
  - 422: operation/command不一致、`dryRun` 違反、`sourceBundleHash` 欠損などの契約違反
- 目的: `query -> bundle -> proposal -> apply` の監査4点を同一 `equivalenceKey` / `bundleHash` で接続し、proposal-only / dry-runの境界を検証する。
- SEC-AUDIT-DUP-01: 同一論理操作（`tenant/doc/operation/equivalenceKey/bundleHash`）の重複POSTは、`SUI_AUDIT_DEDUP_WINDOW_SECONDS`（既定5秒）内で外部シンクへ1回しか送出されない。HTTP応答はいずれも `{ "status": "accepted" }` のまま。
- 消費者境界（外部消費者向け）: 本エンドポイントは`03_Implement/frontend/src`のUIから直接呼び出されることを想定しない。`channel: "api" | "cli" | "gui" | "mcp"`はGUI以外の呼び出し元（CLI、MCP経由の生成AI、将来のAgent連携等）を対等な一級市民として扱うために存在する契約である。2026-08-16時点で、read-only MCPサーバー（`03_Implement/mcp/`）が成功した各投影読み取りを`channel: "mcp"`で本エンドポイントへ監査送出する（`03_Implement/mcp/src/audit_log.ts` の `emitContextAuditEvent`）。CLI（`03_Implement/backend/src/sui_sensemaking_api/cli.py`）は`channel: "cli"`で送出する。監査はbest-effortであり、CE-4送出失敗は読み取り自体を失敗させない（MCP側のローカル監査エントリが読み取りの相関の正本）。分類の根拠と不確実性は`issue-SAAS-TENANT-SURFACE-01-unclassified-frontend-caller-gap.md`の実装記録を参照。


### 2.6 Merge Decision Log（CTR-2B-02-DECISION-LOG-V1）

Manual assisted mergeの意思決定ログを、Document本体とは分離してappend/list/restoreする。

**POST** `/docs/{doc_id}/merge-decision-logs`

- Request body:
  - `{ "record": MergeDecisionRecord }`
- Response: `MergeDecisionRecord`（201）
- Error:
  - 404: `doc_id` が存在しない
  - 409: 同一 `decisionId`（同一 `doc_id` 内）の重複
  - 422: `action` enumなどの契約違反

**GET** `/docs/{doc_id}/merge-decision-logs/by-group/{group_id}`

- Response: `MergeDecisionRecord[]`（append順）

**GET** `/docs/{doc_id}/merge-decision-logs/restore/{snapshot_version}`

- Response: `MergeDecisionRecord[]`（append順）

`MergeDecisionRecord`は次のとおりです。

- `decisionId: string`
- `groupId: string`
- `action: "accept" | "partial" | "reject" | "defer"`
- `selectedCardIds: string[]`
- `note: string`
- `decidedBy: string`
- `decidedAt: string (ISO 8601)`
- `snapshotVersion: string`

`partial` の新規判断では `selectedCardIds` を**人間が明示した真部分集合**として扱う。

- `2 <= len(selectedCardIds) < len(cardIds)` を満たす。
- `selectedCardIds` は `cardIds` の部分集合で、重複を含まない。
- 全候補を採用する場合は `accept` を使う。1枚以下の選択はmergeとして成立しない。
- 旧データで `partial` の `selectedCardIds` が欠落している、または全候補と同一の場合、採用集合を推測せず実適用をfail-closedにする。
- 判断ログ・監査イベント・実mergeの `sourceCardIds` は同じ選択集合を保持する。
- 判断と実適用は別操作とし、再読込後も記録済みの選択集合をUIで確認してから適用できる。
- 選択されなかったカードは、実適用時にも本文・系譜・島所属・relation・review状態を変更しない。

### 2.7 CE4 Audit Integration Contract（API/CLI equivalence）

CE4（API/CLI/監査統合）はCE1契約をread-only参照し、実装方式に依存しない接続契約のみを固定する。

#### 2.7.1 固定ルール（Normative）
- 同値判定成功条件: `equivalenceKey AND bundleHash` の同時一致（片方一致は失敗）。
- 実行モード: `mode=proposal-only` のみ許容（`auto-apply` / `auto-confirm` / `auto-publish` は禁止）。
- 監査イベント順序: `query -> bundle -> proposal -> apply` を固定し、欠損/逆順はfail-closed。
- 依存切断: CE1未整備時は `sourceBundleHash=mock:<64hex>` を許容し、realと同一規律で判定する。

#### 2.7.2 API Signature（contract-only）
- `POST /v1/audit/proposals:verify`
- Request必須: `mode`, `equivalenceKey`, `queryCanonicalHash`, `bundleHash`, `sourceBundleHash`, `events[4]`
- Response必須: `decision` (`go|no_go`), `classification` (`ok|validation_failed|audit_violation|equivalence_violation|policy_violation`), `equivalenceSatisfied` (boolean), `violations` (string[]), `traceId`

#### 2.7.3 CLI Signature（contract-only）
- `kj audit verify-proposal`
- 必須フラグ: `--mode proposal-only`, `--equivalence-key`, `--query-canonical-hash`, `--bundle-hash`, `--source-bundle-hash`, `--events-json`
- 契約: `classification != ok` は常に非0終了（数値割当は未固定）。

#### 2.7.4 監査イベント共通必須キー（API/CLI共通）
- `eventType` (`query|bundle|proposal|apply`)
- `timestamp` (RFC3339 UTC)
- `equivalenceKey`
- `queryCanonicalHash`
- `bundleHash`
- `sourceBundleHash` (`sha256:<64hex>` または `mock:<64hex>`)
- `actor` (`principalType`, `principalIdMasked`)
- `channel` (`api|cli`)
- `command`
- `result` (`ok|ng`)
- `schemaVersion` (SemVer)

#### 2.7.5 失敗分類と停止規律
- `validation_failed`: 入力契約違反
- `audit_violation`: 必須キー欠損 / 順序違反 / 重複矛盾
- `equivalence_violation`: `equivalenceKey` または `bundleHash` 不一致
- `policy_violation`: proposal-only違反（auto-*検出）
- fail-safe: 自己修復は最大3回。4回目相当は `StoppedForClarification`。

#### 2.7.6 責務境界（API / CLI / Audit）
- API責務: 契約検証要求を受理し、分類語彙と判定結果を返す。
- CLI責務: API同値語彙で入力を組み立て、失敗分類を終了ステータスへ反映する。
- Audit責務: 4イベント順序、必須キー、同一 `equivalenceKey` 連結可能性を検証する。

### 2.8 Context Query / Bundle Contract（CE1-CONTEXT-FOUNDATION）

CE-1のHTTP endpoint、status/error、副作用を本節の正本とする。型、required/optional key、列挙、canonicalization、version互換は [`schemas.md` §1.2](schemas.md#12-ce1ce2ce4-型契約実装非依存) を正本とし、本書では再定義しない。

logical type、HTTP envelope、下流handoffのkey所属は [`schemas.md` CE1 v1 layer ownership matrix](schemas.md#ce1-v1-layer-ownership-matrixlogical--transport--handoff) を正本とする。`queryId`は`ContextQueryV1`だけに属し、`schemaVersion="1.0.0"`はHTTP response metadata、`sourceBundleHash`はCE2/CE4のread-only handoff値である。

JSON request共通のtransport安全境界として、backendは `application/json` / `application/*+json` の構造ネストをparser前段で64以下に制限する。超過時は入力値やparser例外を反射せず `400 json_nesting_too_deep` を返す。この制限はlogical type、canonical hash入力、schema versionを変更しない。API keyが設定されている場合は認証をbody検査より先に行う。

**POST** `/context/query`

- Purpose: Query Preview通過済みの `ContextQuery` を検証・正規化する。
- Request body: `ContextQueryV1`
- Response body: `ContextQueryValidationResponse`
- Error:
  - `422 preview_required`: `previewConfirmed != true`
  - `400 unknown_contract_key`: CE1 v1最小I/F外のキー、またはenum/range違反をfail-closedで拒否
  - `400 invalid_constraints`: `constraints` がJSON互換ではない、深さ8・総ノード数1024・canonical UTF-8 64 KiBのいずれかを超過
  - `400 json_nesting_too_deep`: JSON request bodyの構造ネストが64を超過
  - `422 invalid_query_contract`: enum/rangeの補助バリデーション。既存の契約・安全境界エラー語彙を置換しない

**POST** `/context/bundle`

- Purpose: Deterministic projectionを実行し `ContextBundle` を返す。
- Request body: `ContextBundleRequest`
- Response body: `ContextBundleResponse`。`schemaVersion`はtransport metadataでcanonical bundle hash対象外。`queryId` / `sourceBundleHash`はresponseへ含めない
- Error:
  - `400 invalid_constraints`: `query.constraints` がJSON互換ではない、深さ8・総ノード数1024・canonical UTF-8 64 KiBのいずれかを超過
  - `400 json_nesting_too_deep`: JSON request bodyの構造ネストが64を超過
  - `409 nondeterministic_bundle`: 同一canonical queryでdeterministic `bundleHash`が成立しない
  - `400 unknown_contract_key`: closed-world envelopeまたは型の未定義キー

SafeMode既定ON、未レビュー本文保護、proposal-only、`human_reviewed`人手昇格、Consensus Graph直接更新禁止は [architecture.html §05](architecture.html#ce0-boundary) を正本とする。


旧Phase手順、mock validation plan、Stream A freeze logは[形成履歴](history/api-contract-formation-2026-04-to-05.md)へ分離した。

### 2.9 CE4 API/CLI/GUI 同値性・監査契約（CE4-API-CLI-AUDIT）

CE-4はAPI/CLI/GUIの操作同値性と監査導線を固定する契約フェーズであり、実装方式やUI差分よりも監査可能性を優先する。
またCE4はproposal-only境界を維持し、`accepted/rejected` の自動確定経路を許可しない。

#### 2.9.0 Proposal-only + API/CLI監査責務境界

- CE4の責務は **I/F契約固定** に限定する（実装方式・アルゴリズム詳細・自動適用導線は扱わない）。
- API責務境界: 入力/出力/失敗時セマンティクスを固定する。
- CLI責務境界: API同値の入力面・出力面・終了コードを固定する。
- 監査責務境界: `query/bundle/proposal/apply` と `queryCanonicalHash` の記録を固定する。
- Fail-safe: proposal-only逸脱（auto-apply/auto-confirm/auto-publish）または監査欠損成功扱いを検知した場合はfail-closed。

#### 2.9.0a CE4 API/CLI監査統合ゲート（Context / Decision / Consequences）

Context:
- CE4は実装詳細を持ち込まず、API/CLI監査統合をcontract-onlyで先行固定する必要がある。
- `ADR-0016` のCLI契約と `ADR-0017` のSecurity/Ops Gateを、監査イベント最小スキーマで接続する必要がある。

Decision:
1. 監査イベント最小スキーマ（全イベント共通必須キー）を `eventType`, `timestamp`, `equivalenceKey`, `queryCanonicalHash`, `bundleHash`, `actor`, `result`, `channel`, `command`, `schemaVersion`, `sourceBundleHash` に固定する。
2. API→CLI同値性は `equivalenceKey AND bundleHash` 成立のみ成功とし、部分一致成功を禁止する。
3. セキュリティ運用チェックは `eventType + equivalenceKey + queryCanonicalHash` の追跡成立を必須にする。
4. 契約未確定の実装依存点（終了コード数値割当、匿名化方式、監査転送基盤）はCE4スコープ外としてstub隔離し、契約確定前に本番判定へ昇格しない。

Consequences:
- mock fixture（`sourceBundleHash=mock:<hash>`）のみでAPI/CLI監査整合の検証が可能になる。
- 監査欠損・同値不成立を成功扱いできなくなり、fail-closed境界が明確化される。
- 下流実装はproposal-onlyのまま契約準拠テストを先行でき、未確定点の混入を防げる。

#### 2.9.1 logical operation 同値性（固定）

- 対象operation: `context-query` / `context-bundle` / `proposal-diff` / `apply --dry-run`
- 同値性判定は `equivalenceKey == same` かつ `bundleHash == same` のAND条件で固定する。
- GUIは独自operationを定義せず、上記operationをAPI/CLIと同一語彙で呼び出す。
- 同値性判定は `query/bundle/proposal/apply` の全監査イベントで同一 `equivalenceKey` を共有していることを前提に評価する。

`equivalenceKey` 定義（normative）:
1. `ContextQuery` をcanonical JSON化（キー辞書順、UTF-8、余分な空白なし、非決定論フィールド除外）。
2. `equivalenceKey = sha256(canonical_query_json)` を16進小文字で生成。
3. API/CLI/GUIは同一query入力時に同一 `equivalenceKey` を返す。

#### 2.9.1a CE4 resolve endpoint（mock-first 契約）

- Endpoint（compat）: `POST /context/bundles:resolve`
- Endpoint（v1 alias）: `POST /context/v1/bundles:resolve`
- Required Request Fields:
  - `query`（non-empty string）
  - `dryRun`（boolean）
  - `sourceBundleHash`（`sha256:<64hex>` または `mock:<64hex>`）
  - `safeMode`（boolean, CE4では既定 `true`）
- Required Response Fields:
  - `equivalenceKey`
  - `bundleHash`
  - `queryCanonicalHash`
  - `proposalLifecycle`（`proposed | accepted | rejected | held`）
  - `sideEffect`
  - `auditChain.query|bundle|proposal|apply`
- Error Contract（fail-closed / 422）:
  - 監査4点欠損（空文字・空白のみを含む）
  - `queryCanonicalHash` 欠損
  - `dryRun=true` かつ `sideEffect!="none"`
  - safeMode後退（`safeMode=false`）

#### 2.9.2 監査4点セット（必須イベント）

同一 `equivalenceKey` について、次の4イベントを全て記録しない限り成功扱いにしてはならない（fail-closed）。

| eventType | Required keys |
| --- | --- |
| `query` | `queryId`, `timestamp`, `actor`, `safeMode`, `equivalenceKey` |
| `bundle` | `queryId`, `bundleHash`, `excludedReason[]`, `equivalenceKey` |
| `proposal` | `proposalId`, `sourceBundleHash`, `status`, `equivalenceKey` |
| `apply` | `proposalId`, `approver`, `dryRun`, `sideEffect`, `result`, `equivalenceKey` |

追加必須キー（全イベント共通メタ）: `channel`（`api|cli|gui|mcp`）, `command`, `schemaVersion`.
 `schemaVersion` はCE4契約期間中に固定値を使用し、互換性変更時のみ明示的に更新する。
CE4固定値は `schemaVersion="ce4.audit.v1"` とする。

追加必須キー（同値判定の比較根拠）: `queryCanonicalHash`。
`queryCanonicalHash` が欠損する監査イベントは、4点が揃っていても成功扱いにしてはならない（fail-closed）。

`rejectReasonCode` は次の分類コードを最小集合として固定する（追加は後方互換でのみ許可）。
- `missing_event`
- `equivalence_mismatch`
- `dry_run_side_effect`
- `safemode_regression`

#### 2.9.3 dry-run 副作用境界（固定）

- `dryRun=true` の場合、`sideEffect` は常に `"none"`。
- `dryRun=true` で禁止される副作用は次のとおりです。
  - DB永続化
  - 外部サービスとの共有（監査ログHTTP連携を除く。監査ログHTTP連携はfail-open dispatcher方針）
  - review stateの昇格（`unreviewed -> human_reviewed`）
- 上記を満たさない場合は契約違反として失敗扱い（fail-closed）。

proposal lifecycleは `proposed | accepted | rejected | held` の閉集合のみを許可する。
CE4範囲での語彙追加・別名導入は禁止する。

CE4 フェイルセーフ（停止条件）:
- 監査4点セット欠損を成功扱いしようとする要求
- `dryRun=true` で `sideEffect="none"` を満たさない挙動
- safeMode後退要求（share/export保護緩和、未レビュー保護緩和）
- Consensus直書き要求（proposal/apply契約を迂回する更新）
- Verifyの自己修復が3回失敗した場合（4回目試行は行わない）
- 前提崩れ（同値性定義や固定operation契約の不成立）
- 未定義競合（必須キーの契約定義欠落、または同一キーの多重定義衝突）

#### 2.9.4 `sourceBundleHash` の受理境界（依存切離し）

- `proposal.sourceBundleHash` は次の両形式を受理する。
  - 本番hash（`[0-9a-f]{64}`）
  - モックhash（`mock:[0-9a-f]{64}`）
- 形式差により同値性判定・監査手順を分岐させてはならない。
- CE3未完了時も `mock:<hash>` によりCE4の契約検証を継続可能とする。
- 運用runbook（`04_Documentation/local_llm_ops_guide.md`）でも `Plan -> Execute(同値性契約) -> Verify(max3) -> Proceed` の固定順序と同一契約を維持する。

#### 2.9.5 CE4 mock/stub execution boundary（implementation-ready）

- APIはCE4契約検証用に `sourceBundleHash=mock:<64hex>` を受理してよい。
- 未確定項目は次のstubを返して隔離する（fail-closedを優先）。
  - `501 ce4_stubbed_exit_code_mapping`
  - `501 ce4_stubbed_principal_masking`
  - `501 ce4_stubbed_audit_transport`
- stub応答時も `equivalenceKey`, `queryCanonicalHash`, `bundleHash`, `schemaVersion` を監査イベントへ記録し、`result=ng` で終了する。
- 本節のstubは契約確定までの暫定隔離であり、成功系の代替として利用してはならない。

### 2.10 Polygon Handoff Contract Verify（FB-P0-2A2B2C）

Polygon auto-fitのbackend接続準備として、A2比較キーの最小契約を検証する。

**POST** `/docs/{doc_id}/polygon-handoff/verify-contract`

- Request body:
  - `input.gateApprovalRef: string`
  - `input.a2VerifyRef: string`
  - `input.inputHash: string`（sha256 hex / 64桁）
  - `input.deterministicTieBreakOrder: ["padding_compliance", "self_intersection_avoidance", "minimum_area_delta", "minimum_vertex_count"]`
  - `expectedOutput.outputPolygonHash: string`（sha256 hex / 64桁）
  - `expectedOutput.paddingViolationCount: number`（>=0）
  - `expectedOutput.tieBreakOrder: ["padding_compliance", "self_intersection_avoidance", "minimum_area_delta", "minimum_vertex_count"]`
  - `expectedOutput.tieBreakOrderChanged: boolean`（後方互換。`tieBreakOrder` 未送信時に必須）
- Response:
  - `status: "ok" | "rollback_required"`
  - `rollbackRequired: boolean`
  - `failureReasons: string[]`
  - `verificationKey: string`（`sha256(inputHash + ":" + outputPolygonHash)`）
- Error:
  - 404: `doc_id` が存在しない
  - 422: hash formatなどの契約違反

### 2.11 実装済み response model の補助API

次のAPIはDocument CRUDとは別の、実装済みの限定契約である。response fieldの型定義は `02_Architecture/schemas.md` §13を正本とする。

**POST** `/admin/provision/hil-rs/a2a3-gate:validate`

- Request body: `A2A3GateValidationRequest`。HIL-RS-02の固定値（`freezeContractId` / `schemaVersion` / `overridePolicy` / lock・freeze・status・未解決要求フラグ）だけを受理し、未知fieldは拒否する。
- Response: `A2A3GateValidationResponse`
  - `go: true`
  - `schemaVersion: "1.0.0"`
  - `freezeContractId: "HIL-RS-02-A1-CONTRACT-FREEZE-v1"`
- Error:
  - 409: 固定されたgate invariantとの不一致
  - 422: literal違反、必須field欠落、未知fieldなどのrequest schema違反

**GET** `/docs/{doc_id}/similar-candidate-groups`

- Request header: 通常のDocument read認可に従い、`X-Read-Only: 1 | true` をread-only contextとして扱う。
- Response: `CandidateListViewModel`。Documentから決定論的に導出するread-only viewであり、merge判断を自動適用しない。
  - `generatedAt: string (ISO 8601)`
  - `groups: SimilarCandidateGroup[]`
  - `totalGroupCount: number`（0以上、常に `groups.length` と一致）
- Error:
  - 403: 認可または安全境界違反
  - 404: `doc_id` が存在しない

**GET** `/ai/provider-status`

- Response: `ProviderStatusResponse`
  - `providerKind: "none" | "local" | "large-scale" | "deepseek"`
  - `callCounts: { [providerKind]: number, total: number }` — **OPS-LLM-COST-01（段階2）**: プロセス内のLLM呼び出し回数（provider種別別＋total）。初回呼び出しまでは空。単一プロセス前提（共有ストアは段階3）。
  - `tokenUsage: { [providerKind]: { input: number, output: number }, total: {...} }` — **OPS-LLM-COST-01（段階2）**: プロセス内の入力/出力token合計（provider種別別＋total）。provider報告の`usage`（DeepSeek等のOpenAI互換`usage`）から計上し、報告が無いproviderは0。初回呼び出しまでは空。
- 設定解決後のprovider種別を表示用に返すread-only echoであり、providerへの疎通確認は行わない。`local_http` 設定は `local` に正規化される。

**GET** `/ai/available-models`

- テナントの利用可能モデル一覧（AI-MODEL-GOVERNANCE-01 R2/R3・MMR-04）。active model・active provider・tenant allowlistを交差し、`_is_user_selectable_model`（intermediate/generate層のみ）でフィルタする。`final_judgement` 専用モデルは除外する。
- **AI-MODEL-GOVERNANCE-03（動的dispatch）**: 各modelは自身が登録された `providerId` の `providerKind` が実行可能（必須設定が揃っている）かどうかで判定する。判定は `SUI_LLM_PROVIDER`（プロセス全体の既定値）とmodel自身の `providerKind` が一致するかではなく、その `providerKind` 単独の設定完全性（例: `deepseek` なら `SUI_DEEPSEEK_API_KEY`）で行う。したがって、`SUI_LLM_PROVIDER=local` のプロセスでも、`SUI_DEEPSEEK_API_KEY` が設定済みなら `deepseek` 配下のmodelも同時に一覧へ含まれる。ただし `SUI_LLM_PROVIDER=none` はプロセス全体のkill switchであり、この場合はどの `providerKind` の設定完全性に関わらず一覧は常に空になる。
- Response: モデルID・表示名・"auto" 既定の選択肢。UIの `ModelSelector` がこの一覧でモデル選択肢を限定する。
- 一覧取得後に状態が変わった場合を含め、実行APIへ利用不可なmodel IDを直接指定すると、LLM送信前に503 `model_provider_unavailable`で拒否する（一覧と実行gateは同一の判定関数を使うため乖離しない）。

### 2.12 AI支援／LLM生成API

全エンドポイント共通は次のとおりです。
- tenant-scoped precondition必須（§10参照）
- proposal-only: AI出力は候補生成に留まり、人間の明示操作なしに文書へ反映されない
- **SafeModeはAPI境界で強制（SEC-AI-SAFEMODE-01 / ADR-0068）**: 文書を伴う全エンドポイント（suggest-layout / suggest-merges / suggest-island-summary / generate-narrative / check-narrative / proposals/island-summary）は、未レビューカード（`textReviewed ≠ true`）を含む場合に **422 `unreviewed_text_not_allowed`** で拒否する。`allowUnreviewedText=true` かつprofileの `SUI_ALLOW_UNREVIEWED_AI_TEXT=true` のときのみ緩和（監査へ記録）
- `SUI_LLM_PROVIDER=none` は、LLM providerを呼び出す生成エンドポイントに対する無条件のkill switchである。registryに他のproviderが設定済みでも動的dispatchは行わず、503（provider disabled）を返す。決定論的な `/ai/suggest-attention-candidates` はproviderを呼び出さないため、この制約の対象外とする。
- **AI-MODEL-GOVERNANCE-03（動的dispatch）**: `model` を受け取るエンドポイント（suggest-island-summary / propose-opposing-viewpoint / generate-narrative / refine-card-text / suggest-card-groups / suggest-document-title）は、そのmodelがregistry上で登録された `providerId` の `providerKind` へ直接dispatchする（`ProviderRegistry.resolve(providerKind)`）。`SUI_LLM_PROVIDER` とmodelの `providerKind` が異なっていても、その `providerKind` 自身の設定が完全なら実行できる。`model` を受け取らないエンドポイント（suggest-layout / suggest-merges / check-narrative / detect-contradiction）は従来どおり `SUI_LLM_PROVIDER` の既定transportを使う。`apiKeyRef` は登録時の参照検証（AC-4）を経た上で、実際の資格情報は引き続き `SUI_*_API_KEY` 環境変数から解決する（registry行の値を直接使う経路は追加しない）
- モデル選択は操作別モデルレベル定義（AGENTS.md §1.2）に従う

**POST** `/ai/suggest-attention-candidates`

- Request: `SuggestAttentionCandidatesRequest`
  - `doc: DocumentV1` — 現在の文書全体
  - `includeSpatial?: boolean` — 空間配置を候補生成へ使うか。既定は `false`
  - `allowUnreviewedText?: boolean` — 未レビュー本文の扱いはSafeMode境界に従う
- Response: `SuggestAttentionCandidatesResponse`
  - `sourceDigest: string` — 候補生成に使った投影断面のSHA-256
  - `candidates: AttentionCandidate[]` — 文書を書き換えない注意候補
    - `candidateId: string`
    - `cardIds: string[]`
    - `focusPairs: [string, string][]` — 実際に見比べる対象のカード対
    - `basis: "relation" | "spatial"`
    - `cue: "cross_island" | "indirect_relation" | "unassigned"`
  - `excludedCardIds: string[]` — held / pending / shelved により候補から除外したカード
  - `truncated: boolean` — IR切り詰めの有無
- providerを呼び出さない決定論的な候補APIであり、`SUI_LLM_PROVIDER=none` でも利用できる。出力は注意の向け先を示すだけで、島への採用、重要度、確信度、順位を決定しない。
- relation候補は、既存島への同居や既存の直接relationをそのまま再提示せず、まだ直接表現されていない跨島の組だけを `focusPairs` として返す。空間候補は `includeSpatial=true` の場合だけ有効になる。
- 1候補の `focusPairs` が8組を超える場合は、根拠のない順位付けや任意切り捨てをせず、その候補を返さない。
- `sourceDigest` はIR version、文書識別、投影後のカード、relation、島、および空間候補を使う場合の正規化座標から決定論的に算出する。通常モードではカードの画面移動だけでは変化しない。利用側は文書更新後に古い候補を保持し続けないための断面識別子として使える。

**POST** `/ai/suggest-layout`

- Request: `SuggestLayoutRequest`
  - `doc: DocumentV1` — 現在の文書全体
  - `instruction?: string` — 配置指示（任意）
  - `allowUnreviewedText?: boolean` — **SEC-AI-SAFEMODE-01（ADR-0068）**: 未レビュー本文の送出許可（任意・既定fail-closed）。未レビューカード（`textReviewed ≠ true`）を含む文書は、この値が `true` かつprofileの `SUI_ALLOW_UNREVIEWED_AI_TEXT=true` でない限り **422 `unreviewed_text_not_allowed`** で拒否される。
- Response: `SuggestLayoutResponse`
  - `suggestionId: string` — 提案の一意識別子
  - `suggestedDoc: DocumentV1` — 再配置後の文書
  - `notes?: string` — AIからの補足
- キャンバス全体の空間配置（島・カードの位置）を提案する。指示文があればそれに沿った配置を試みる。
- **`AI-IR-PROJECTION-01`（`ADR-0069`）Stage 4でLLM投入IR経由になった**（`02_Architecture/llm_input_ir_spec.md`。版数の正本は `llm_input_ir.IR_VERSION` で、Stage 4では繰り上げていない）。**リクエスト／レスポンスの形は変わらない**（後方互換。フロントエンドの `suggestLayout` は無改修）。
- **座標を渡す唯一のエンドポイントである**（`ADR-0069` D1=B、`llm_input_ir_spec.md` §2.2.1の要否表で本エンドポイントだけが「要求」）。出力そのものが配置であるため相対布置が入力として意味を持つ。IRが運ぶのは §2.2の**正規化座標**（重心を原点へ平行移動した `x` / `y` と `radius` / `angle_deg`）のみで、**生の絶対座標はIRに入らない**（§2.2規則6）。プロンプトには従来どおり文書の絶対座標も併記する ── レスポンスは文書と同じ絶対座標系で返る契約であり、`suggestedDoc` は全カードの位置を含む必要があるため。
- `doc.edges` の**カード間**関係（5語彙。特に `causal` / `negate`）がAI入力へ届く（`ADR-0069` 実装順序4「あわせて `edges` を渡す」）。島間の辺（`fromKind` / `toKind` = `island`）はIRの対象外であり（§2.3規則6）、従来どおり `doc.edges` から描画する。
- **島は矩形だけでなく関係の集合としても渡る。** 従来は `cardIds` から算出した `bounds` / `anchor` のみだった。IR経由化により (a) 確定済みの島階層（`parentIslandId` / `placardCardId` / レビュー状態、`ADR-0069` D3=A）と、(b) カード間関係を島単位へ集約した**島間の派生関係**が加わる。(b) はフロントエンドの `getDerivedIslandEdges()`（`island_edge_aggregate.ts`）に対応するサーバ側実装（`llm_input_ir.derived_island_relations()`）が算出する。`bounds` / `anchor` は**削っていない** ── 新しい配置を提案するエンドポイントは現在の幾何を必要とするため、変更は加算的である。
- SafeModeは二層で強制される。**(1)** `_reject_unreviewed_text`（`ADR-0068` / `SEC-AI-SAFEMODE-01`、変更なし）が `doc.cards` を検査する。**(2)** IRビルダーが `llm_input_ir_spec.md` §7.1に従いレビュー状態を独立に再検査する。両層は同じ述語（`allowUnreviewedText=true` かつprofile許可）で緩和され、片開きにならない。
- IR経由化で次の422が新設された（いずれも `{code, message}` 形のdetail）。`pii_detected`（§7.2のメール／電話／URLトークンのパターンに一致する本文）、`structured_text_only_violation`（§7.3）、`empty_cards`。**`empty_cards` は挙動変更である** ── カード0枚の文書は従来200で空の配置提案を返していたが、配置する対象が無い以上422とする。
- カード200枚超（`MAX_CARDS`、§5.1）の文書ではIRが切り詰められ、**打ち切られたカードの座標・関係はAI入力の該当セクションに含まれない**。`Cards:` セクションは文書側から描画するため全カードが残り、`suggestedDoc` が全カードの位置を返す契約は維持される。レスポンスの形を変えない方針（後方互換）のため `suggest-card-groups` の `truncated` に相当するフィールドは追加しておらず、切り詰めはプロンプト本文に明記して黙って落とさないことのみ担保する。上限値の妥当性は `AI-IR-PROJECTION-01` AC-10で扱う。

**POST** `/ai/suggest-merges`

- Request: `SuggestMergesRequest`
  - `doc: DocumentV1` — 現在の文書全体
  - `instruction?: string` — 提案方針の指示（任意）
  - `allowUnreviewedText?: boolean` — **SEC-AI-SAFEMODE-01（ADR-0068）**: 未レビュー本文の送出許可（任意・既定fail-closed）
- Response: `SuggestMergesResponse`
  - `suggestions: MergeSuggestion[]` — 統合候補の配列。各要素のAPI契約は `groupId`、2件以上の `cardIds`、`mergedTextDraft`、必須の `mergeMethod`（`near_duplicate` | `kernel_fusion`）、任意の `rationale`。方式欠落・未知値は信頼境界で拒否する。
- 類似カードの統合候補を提案する。各候補は統合対象カード群と統合理由を含む。
- フロントエンドの決定論的ローカル候補は、このAPI契約にStream Bの `targetCardId` / `candidateCardIds` / `scoreSummary` / `reasonCodes` / `snapshotVersion` を付加した派生表現を使う。これらはローカル候補生成の再現性メタデータであり、AIプロバイダーが生成する `MergeSuggestion` の必須フィールドではない。remote AI提案に存在しないスコアやsnapshotを補作しない。

**POST** `/ai/suggest-island-summary`

- Request: `SuggestIslandSummaryRequest`
  - `doc: DocumentV1` — 現在の文書全体（対象島を含む）
  - `islandId: string` — 対象の島ID
  - `allowUnreviewedText?: boolean` — **SEC-AI-SAFEMODE-01（ADR-0068）**: 未レビュー本文の送出許可（任意・既定fail-closed）
  - `model?: string` — タスク別モデルoverride（AI-MODEL-GOVERNANCE-01 R2・allowlist検査付き）
  - `critiqueText?: string` — 壁打ち（DOGFOOD-34）。現行表札への違和感。指定時はそれを踏まえた代替候補を返す（任意・後方互換）
- Response: `SuggestIslandSummaryResponse`
  - `candidates: IslandSummaryCandidate[]` — 表札候補（1〜3件）。各候補は接地（代表カード）と凝縮（志）を分離して持つ（ADR-0077）
    - `summaryText: string` — 凝縮・志（述語を伴う代弁文。分類名・名詞止めでないこと）
    - `groundingIds: string[]` — 接地・根拠としたメンバーカードのID（1〜10件・重複なし・メンバー限定）
  - `warnings?: string[]`
- 島の表札（ラベル）を提案する。表札は分類名ではなく、カード群の訴えを代弁する文でなければならない（sensemaking_technique.md §3表札検査）。
- AI入力は `DocumentV1` をそのまま広げず、対象島の全直接メンバーと、それらへ直接つながるcard relation / evidenceの両端だけへsourceを縮約してからLLM投入IRを構築する。無関係な文書カードはIRにも追加prompt文脈にも送らない。providerへ送る最終promptの直接メンバー本文もIR正規化後本文から描画し、Document側の生本文を同じ箇所へ再送しない。
- 対象島の外側にある隣接カードは、relation / evidenceを理解するための**文脈専用**である。応答の `groundingIds` は従来どおり対象島の直接メンバーだけを許可し、外部カードへ広げない。
- 親島、表札カード、review state、card relation、`contradictionState` はIR由来の構造としてAIへ渡す。親島は親子関係を保持する構造だけを残し、親島のカード集合まで入力へ広げない。`critiqueTags` / `critiqueText` と明示的なisland-to-island edgeはtask-local入力として従来の経路を維持する。
- 対象島の仕事に必要な意味をIRで完全に保持できない場合は、providerへ不完全な表札生成を依頼せず422でfail-closedにする。主なIRエラーコードは、必須カード集合が上限を超える `required_card_budget_exceeded`、必須カード本文が文字数上限で短縮される `required_text_truncated`、投影後の必須カード集合が一致しない `required_card_context_mismatch`、必要なrelation / evidenceが欠ける `required_relation_missing` / `required_evidence_missing`。request / responseの形は変更しない。
- **DX-CLEANUP-07案B**: この直接routeはフロントエンドの直接呼び出し元を持たない（UIはproposal-onlyの `POST /ai/proposals/island-summary` を使用）。**後方互換・外部APIクライアント用に維持**する。`suggest_island_summary` 関数本体はproposal routeの内部実装として再利用されている。

**POST** `/ai/proposals/island-summary`

- Request: `ProposeIslandSummaryRequest`
  - `doc: DocumentV1`
  - `islandId: string`
  - `sourceBundleHash: string` — context bundleのハッシュ
  - `critiqueText?: string` — 壁打ち（DOGFOOD-34）。現行表札への違和感（任意・後方互換）
- Response: `ProposalEnvelope`
  - `type: "island_summary"`
  - `proposalId: string`
  - `diff: ProposalDiff` — `entityType: "island_summary"`, `field: "summaryText"`, `after`（candidates[0]）／`groundingIds`／`candidates?: IslandSummaryCandidate[]`（全候補・壁打ち用・DOGFOOD-34）
  - `status: "proposed"`
  - `reviewState: "unreviewed"`
- `/ai/suggest-island-summary` のproposalラッパー。人間の明示的Adopt/Reject/Hold操作を経て文書へ反映される。
- 成功時は本文を持たないproposal相関行を`ai_proposals`へ保存する。対象Documentが存在しない、またはwrite認可されない場合はproposalを生成・登録しない。

**POST** `/ai/proposals/opposing-viewpoint`（AI-OPPOSE-01・iteration 65以降で契約化）

- Request: `ProposeOpposingViewpointRequest`
  - `doc: DocumentV1` — 現在の文書全体（contradiction / evidence構造を含む）
  - `targetCardId: string` — 反対視点・根拠不足を検討する対象カード
  - `allowUnreviewedText?: boolean` — **SEC-AI-SAFEMODE-01（ADR-0068）**: 未レビュー本文の送出許可（任意・既定fail-closed）
  - `model?: string` — タスク別モデルoverride（AI-MODEL-GOVERNANCE-01 R2・allowlist検査付き）
- Response: `OpposingViewpointProposal`（proposal-only）
  - `proposalId: string`
  - `type: "opposing_viewpoint"`, `status: "proposed"`, `reviewState: "unreviewed"`
  - `targetCardId: string`, `opposingText: string`, `evidenceGap: boolean`, `rationale: string`, `warnings: string[]`
- contradiction / evidence構造をもとに、対象カードの**反対視点・根拠不足**を提案する（value_traceability V1/V3）。**proposal-only（自動適用なし・人間の判断を先取りしない）**。対象カードが存在しない場合は422、対象Documentが永続化されていない場合は404。判定（Adopt/Reject/Hold）は `/ai/proposals/audit` と同経路。
- AI入力はLLM投入IRを経由する。対象カードと、そこへ直接接続するcard relation / evidenceの両端を必須文脈として保護し、`confirmed` / `held` を含む `contradictionState` を人間の既決判断としてprovider手前へ渡す。直接接続していないカードはIRに残った範囲だけを補助探索へ用いる。
- `Target card:` の本文もIR正規化後の対象カード本文から描画し、Document側の生本文を中心入力へ迂回させない。promptと `LLMRequest.inputs` の対象本文は同じIR値を使う。
- 必須意味が共有IRの上限で欠ける場合は422でfail-closedにする。主なコードは `required_card_budget_exceeded` / `required_text_truncated` / `required_card_context_mismatch` / `required_relation_missing` / `required_evidence_missing`。SafeModeはroute側とIR側の二層を維持し、座標は送らない。

**POST** `/ai/proposals/audit`

- Request: `ProposalDecisionAuditRequest`
  - `docId: string`
  - `proposalId: string`
  - `sourceBundleHash: string` — proposal生成時の64桁SHA-256
  - `idempotencyKey: string` — 利用者操作ごとに生成し、再送時は同じ値を使う
  - `decision: "adopt" | "reject" | "hold"`
  - `reason?: string` — 最大1000文字。本文は永続化せずdigestとUTF-8 byte数だけを監査する
- Response: `ProposalDecisionAuditResponse`
  - `recorded: true`
  - `eventId: string`
  - `proposalId: string`
  - `status: "accepted" | "rejected" | "held"`
  - `reviewState: "unreviewed"`
  - `recordedAt: string`
- proposalに対する人間の判断（Adopt/Reject/Hold）をtenant・Document・source bundleへ結合し、生成時registry`ai_proposals`との一致を確認して記録する。未登録IDや別Documentのproposalは404、source bundle不一致は409とする。reviewerはclient入力を信頼せず、serverが認証contextから解決する。追記イベントの正本は`ai_proposal_decision_events`、競合制御用の現在状態は`ai_proposal_decision_states`とする。
- 同じidempotency keyと同じ内容の再送は同じreceiptを返す。`held`からは`accepted/rejected`へ一度だけ進められ、終端後の変更は409になる。

**GET** `/ai/proposals/status`

- CE4 read-only proposal lifecycle status for a document. Query: `docId`（tenant-scoped precondition必須）。
- Response: `ProposalStatusResponse`（`proposalId`・`proposalKind`・`origin`・各proposalの判定状態など）。
- generative-AI（MCP/API経由）がproposalが依然proposal-onlyか、人間が判定済み（accepted/rejected/held）かを検証するためのtraceability。read-only契約（`action="read"`）で、proposalや判定を一切書き込まない。

**POST** `/ai/external-tasks/register`

- Request: `ExternalAgentTaskRegistrationRequest`
  - `docId: string`
  - `taskId: string` — 依頼の一意識別子
  - `baseDocSignature: string` — 依頼生成時点の文書シグネチャ（`{docId}:{updatedAt}`）
  - `sourceBundleHash: string` — 依頼に渡したcontext bundleのハッシュ
  - `queryCanonicalHash: string`
  - `taskKind: "island_titles" | "merge_candidates" | "narrative_draft" | "opposing_viewpoints" | "critique_suggestions" | "free_analysis"`
  - `provenanceLevel: "user_presented_unsigned"`
- Response: `ExternalAgentTaskRegistrationResponse`
  - `registered: true`
  - `taskId: string`
  - `provenanceLevel: "user_presented_unsigned"`
- ADR-0049（外部定額課金AIエージェントとの成果物ベース・非同期協調）の依頼パッケージ登録。人間が依頼を外部エージェントへ手渡す前に、その依頼の起点をtenant側へ記録する。対象Documentが存在しない場合は404、`baseDocSignature`が現在の文書と一致しない場合は409（stale）を返す。仕様正本: `external_agent_collaboration_spec.html`。

**POST** `/ai/external-proposals/register`

- Request: `ExternalAgentProposalRegistrationRequest`
  - `docId: string`
  - `taskId: string` — `/ai/external-tasks/register` で登録した依頼ID
  - `baseDocSignature: string`
  - `sourceBundleHash: string`
  - `queryCanonicalHash: string`
  - `proposalId: string`
  - `proposalKind: "island_title" | "merge_candidate" | "narrative_draft" | "opposing_viewpoint" | "critique" | "patch"`
  - `proposalFingerprint: string`
  - `provenanceLevel: "user_presented_unsigned"`
- Response: `ExternalAgentProposalRegistrationResponse`
  - `registered: true`
  - `proposalId: string`
  - `provenanceLevel: "user_presented_unsigned"`
- 外部エージェントが返した成果物を、人間がDocumentへ貼り戻す前にtenant側へ`origin: external_agent`として登録する。対象Documentが存在しない場合は404、`baseDocSignature`不一致は409。ここで登録していないproposal IDに対して`/ai/external-proposals/audit`でdecisionを記録することはできない（404）。

**POST** `/ai/external-proposals/audit`

- Request: `ExternalAgentProposalDecisionRequest`（`ProposalDecisionAuditRequest`を継承し `provenanceLevel: "user_presented_unsigned"` を追加。他フィールドは本節「POST `/ai/proposals/audit`」のRequestと同一）
- Response: `ProposalDecisionAuditResponse`（`/ai/proposals/audit`と同一形状）
- `/ai/proposals/audit`と同じ判断記録APIだが、`/ai/external-proposals/register`で登録した`origin: external_agent`のproposalにのみ適用される。proposal未登録は404、`/ai/proposals/audit`側で登録された（origin不一致の）proposalに対して呼んだ場合は409（`proposal origin does not match endpoint`）。

**POST** `/ai/generate-narrative`

- Request: `GenerateNarrativeRequest`
  - `doc: DocumentV1` — 現在の文書全体
  - `narrativeTitle?: string` — ナラティブのタイトル（任意）
  - `allowUnreviewedText?: boolean` — **SEC-AI-SAFEMODE-01（ADR-0068）**: 未レビュー本文の送出許可（任意・既定fail-closed）
  - `model?: string` — タスク別モデルoverride（AI-MODEL-GOVERNANCE-01 R2・allowlist検査付き）
- Response: `GenerateNarrativeResponse`
  - `text: string` — 生成された文章
  - `basedOnReadingOrder: string[]` — 参照した読取順
  - `warnings?: string[]`
- A型図解（空間配置）からB型叙述（文章）を生成する。生成後はA/B照合（sensemaking_technique.md §5）を人間が実施する必要がある。
- **`AI-IR-PROJECTION-01`（`ADR-0069`）Stage 3でLLM投入IR経由になった**（`02_Architecture/llm_input_ir_spec.md`、`ir_version` 1.2）。`doc.edges` の**カード間**関係（5語彙。特に `causal` / `negate`）と `evidenceLinks` の `contradictionState` が、読み順上のどの位置で効くかとあわせてAI入力へ届く。**リクエスト／レスポンスの形は変わらない**（後方互換。フロントエンドの `generateNarrative` は無改修）。
- 読み順はIRのフィールドではない（`llm_input_ir_spec.md` §4は閉じたスキーマであり `reading_order` を定義しない）。叙述の背骨は従来どおり `doc.readingOrder` から描画し、IRは骨格（関係）を供給する。島間の辺（`fromKind` / `toKind` = `island`）もIRの対象外であり（§2.3規則6）、従来どおり `doc.edges` から描画する。
- SafeModeは二層で強制される。**(1)** `_reject_unreviewed_text`（`ADR-0068` / `SEC-AI-SAFEMODE-01`、変更なし）。**(2)** IRビルダーが §7.1に従い投影対象カードのレビュー状態を独立に再検査する。本エンドポイントは (1) と (2) の検査対象がいずれも同一の `doc` であるため (1) が必ず先に発火する。(2) は多層防御であり、(1) の置き換えではない。
- IR生成が失敗した場合の422コード: `unreviewed_text_not_allowed`（§7.1）/ `pii_detected`（§7.2。メール・電話・URLトークン。**応答に該当文字列を含めない**）/ `structured_text_only_violation`（§7.3）/ `empty_cards` / `empty_card_text` / `duplicate_card_id` / `invalid_card_id` / `invalid_self_loop` / `duplicate_island_id` / `invalid_island_id`。**`empty_cards` は挙動変更**であり、カードが1枚も無い文書は200ではなく422を返す（叙述の対象が存在しないため）。
- 座標は渡さない（`ADR-0069` D1=B、`llm_input_ir_spec.md` §2.2.1）。叙述の骨格は `causal` / `negate` であり布置ではない。
- カード200枚超（`MAX_CARDS`、§5.1）の文書ではIRが切り詰められ、**打ち切られたカードに繋がる関係はAI入力に含まれない**。読み順そのものは従来どおり `doc.readingOrder` 全体から描画するため欠落しない。レスポンスの形は変えない方針（後方互換）のため `suggest-card-groups` の `truncated` に相当するフィールドは追加しておらず、切り詰めはプロンプト本文に明記して黙って落とさないことのみ担保する。上限値の妥当性は `AI-IR-PROJECTION-01` AC-10で扱う。

**POST** `/ai/check-narrative`

- Request: `CheckNarrativeRequest`
  - `doc: DocumentV1` — 検証対象のA型図解
  - `narrativeText: string` — 検証対象のナラティブ本文
  - `basedOnReadingOrder?: string[]` — ナラティブが従った読取順（A/B照合のA側）
  - `allowUnreviewedText?: boolean` — **SEC-AI-SAFEMODE-01（ADR-0068）**: 未レビュー本文の送出許可（任意・既定fail-closed）
- Response: `CheckNarrativeResponse`
  - `issues: NarrativeIssue[]` — A/B照合で検出された不整合
    - `direction: "b_missing_in_a" | "a_missing_in_b"` — B型（ナラティブ）にあるのにA型にない記述 / A型にあるのにB型で落ちた島
- 生成されたナラティブとA型図解の整合性をチェックする。A型にあってB型で落ちた島、B型にあってA型にない記述を検出する。
- **`AI-IR-CHECK-NARRATIVE-RELATIONS-01`**: promptは `doc.edges` の全件を `id` / `type` / `fromKind` / `fromId` / `toKind` / `toId` 付きで列挙する。ナラティブが図に無い因果・対立・同値等の論理接続を作っていないか（`sensemaking_technique.md` §6 `SUI-SIGN-09`）をA/B双方向照合の判断材料にするためで、`fromKind`/`toKind` 未指定のlegacy edgeはcard端点として解釈する。IRへは移行していない（現行の全Card・全Island coverageを維持したままの追加であり、`AI-IR-SCALE-01` のscale方式決定を待つ）。

**POST** `/ai/refine-card-text`

- Request: `RefineCardTextRequest`
  - `cardText: string` — 元のカード本文
  - `context?: string` — 周辺カードの本文（任意）
  - `textReviewed?: boolean` — 入力本文が人間レビュー済みか（`SEC-AI-SAFEMODE-02`。**既定false = fail-closed**。未指定・falseは422）
  - `allowUnreviewedText?: boolean` — 未レビュー本文の送信を明示的に許可（`SEC-AI-SAFEMODE-01`。`SUI_ALLOW_UNREVIEWED_AI_TEXT=true` のときのみ有効）
- Response: `RefineCardTextResponse`
  - `refinedText: string` — 改善された文
  - `reasoning?: string` — 変更理由
- カード本文を明確かつ簡潔に改善する。名詞止め禁止（動詞で終わる文）を遵守する。

**POST** `/ai/suggest-card-groups`

- Request: `SuggestCardGroupsRequest`
  - `cards: CardRef[]` — グループ化対象カードの配列（id + text + textReviewed、2〜1000件。上限は `DOGFOOD-31` で100件から引き上げ済み）
  - `doc?: DocumentV1` — **任意**。`AI-IR-PROJECTION-01`（`ADR-0069`）Stage 2で追加。渡すとサーバがLLM投入IR（`02_Architecture/llm_input_ir_spec.md`、`ir_version` 1.2）を構築し、**確定済みの `islands`・`parentIslandId` 階層・`edges`（関係5語彙）・各カードの `holdState`** がAI入力へ届く。**省略時は従来どおり `cards` だけで動作する**（後方互換）
  - `allowUnreviewedText?: boolean` — 未レビュー本文の送信を明示的に許可（`SEC-AI-SAFEMODE-01`）
  - `model?: string` — タスク別モデルoverride（AI-MODEL-GOVERNANCE-01 R2・allowlist検査付き）
- Response: `SuggestCardGroupsResponse`
  - `groups: SuggestedGroup[]` — グループの配列
    - `label: string`
    - `cardIds: string[]`
    - `rationale?: string`
  - `excludedCardIds: string[]` — 既定 `[]`。`holdState`（`held` / `pending` / `shelved`）が付いているためグループ化候補から外したリクエストカードのID
  - `truncated: boolean` — 既定 `false`。IRが §5の上限（`MAX_CARDS=200` / `MAX_TEXT_CHARS=12000`）に達し、リクエストの全カードを投影できなかった場合に `true`。このとき `groups` は投影されたカードのみを対象とする（上限値の妥当性は `AI-IR-PROJECTION-01` AC-10で別途扱う）
- カード群のテーマ別グループ化（島候補）を提案する。1段目の束は2〜3枚が原則。
- **`holdState` が付いたカードを新規グループへ含めない**（`ADR-0069` / `AI-IR-PROJECTION-01` AC-2）。`held`（判断を保留）/ `pending`（未着手）/ `shelved`（Shelfへ退避）の3値はいずれも「人間が意図的に扱いを決めていない」ことの記録であり（`schemas.md` §14.1）、新しい島の構成員として提案することはその判断を上書きする。抑止は**コードで強制**する ── 候補集合から除外してプロンプトに載せず、さらにLLM応答からも当該IDを除去する（プロンプトの遵守は不変条件にならない）。除外後に候補が2枚未満になった場合は**LLMを呼ばず** `groups: []` を返す。既存の島の構成員として `islands[*].cardIds` に現れることは妨げない（既決の構造であり提案ではない）。
- 応答の `cardIds` は候補集合に限定される。候補外のID（保留カード・未知のID）は除去され、それにより空になったグループは返さない。
- `CardRef.textReviewed` は **既定false = fail-closed**（`SEC-AI-SAFEMODE-02`）。1件でも未レビューのカードを含むと422（`unreviewed_text_not_allowed`）。
- SafeModeは二層で強制される。**(1)** `_reject_unreviewed_cards`（`ADR-0068` / `SEC-AI-SAFEMODE-01`、変更なし）が `cards` を検査する。**(2)** IRビルダーが `llm_input_ir_spec.md` §7.1に従い、投影対象の全カード（`doc` 側を含む）のレビュー状態を独立に再検査する。`doc` にのみ含まれる未レビューカードは (1) では見えず (2) が422（`unreviewed_text_not_allowed`）で拒否する。
- IR生成が失敗した場合の422コード: `unreviewed_text_not_allowed`（§7.1）/ `pii_detected`（§7.2。メール・電話・URLトークン。**応答に該当文字列を含めない**）/ `structured_text_only_violation`（§7.3）/ `duplicate_card_id` / `invalid_self_loop` / `empty_card_text`。
- 座標は渡さない（`ADR-0069` D1=B、`llm_input_ir_spec.md` §2.2.1）。束ねの根拠は訴えの類似性であり布置ではない。

**POST** `/ai/detect-contradiction`

- Request: `DetectContradictionRequest`
  - `cardA: CardRef`（id + text + textReviewed）
  - `cardB: CardRef`
  - `doc?: DocumentV1` — **任意**。`AI-IR-PROJECTION-01`（`ADR-0069`）で追加。渡すとサーバがLLM投入IR（`02_Architecture/llm_input_ir_spec.md`、`ir_version` 1.2）を構築し、`edges`（関係5語彙）・確定済みの `islands`・`evidenceLinks` の `contradictionState` がAI入力へ届く。**省略時は従来どおりカード2枚のみで動作する**（後方互換）
  - `allowUnreviewedText?: boolean` — 未レビュー本文の送信を明示的に許可（`SEC-AI-SAFEMODE-01`）
- Response: `DetectContradictionResponse`
  - `hasContradiction: boolean`
  - `explanation?: string`
  - `alreadyRecorded: boolean` — 既定 `false`。`doc` に当該2枚の**人間が確定・保留済み**の矛盾（`EvidenceLink.type="contradicts"` かつ `contradictionState` が `confirmed` / `held`）がある場合に `true`
  - `existingContradictionState?: "unconfirmed" | "confirmed" | "held" | "resolved"` — 上記に該当する既存リンクの状態
- 2枚のカード間の論理的矛盾を検出する。異なる意見（単なる相違）は矛盾として扱わない。
- **確定・保留済みの矛盾を再提示しない**（`ADR-0069`）。`alreadyRecorded=true` のとき、応答は `hasContradiction=false` ＋ `alreadyRecorded=true` を返し、**LLMを呼ばない**。人間が既に下した判断を新規の発見として提示し直さないための決定論的な抑止であり、「矛盾が無い」ことの主張ではない。`unconfirmed` / `resolved` は抑止対象外で、通常どおりAIへ問い合わせる。
- `CardRef.textReviewed` は **既定false = fail-closed**（`SEC-AI-SAFEMODE-02`）。どちらかが未レビューなら422。
- SafeModeは二層で強制される。**(1)** `_reject_unreviewed_cards`（`ADR-0068` / `SEC-AI-SAFEMODE-01`、変更なし）が `cardA` / `cardB` を検査する。**(2)** IRビルダーが `llm_input_ir_spec.md` §7.1に従い、投影対象の全カード（`doc` 側を含む）のレビュー状態を独立に再検査する。`doc` にのみ含まれる未レビューカードは (1) では見えず (2) が422（`unreviewed_text_not_allowed`）で拒否する。
- IR生成が失敗した場合の422コード: `unreviewed_text_not_allowed`（§7.1）/ `pii_detected`（§7.2。メール・電話・URLトークン。**応答に該当文字列を含めない**）/ `structured_text_only_violation`（§7.3）/ `duplicate_card_id` / `invalid_self_loop` / `empty_card_text`。
- 座標は渡さない（`ADR-0069` D1=B、`llm_input_ir_spec.md` §2.2.1）。矛盾の根拠は論理関係であり布置ではない。

#### 廃止済み: カード重要度評価（再実装禁止）

- 廃止: POST /ai/assess-card-importance — `AI-IMPORTANCE-SCORING-01`（2026-08-11、方向D-a）

上の1行は機械可読な廃止宣言である（`check_design_consistency.py` が読む。書式は §13参照）。**2026-08-11に意図的に廃止した**ものであり、未実装でも計画でもない。

`AI-IMPORTANCE-SCORING-01`（Status: Done、方向D-a）が、カード本文を `high` / `medium` / `low` へ序列化する動作を `00_Prompt/domain.md` の無条件の不変条件「AIは内容を採点せず」との抵触と判定し、route・Pydantic型・prompt/parser・mock応答・デモ工程を削除した。`03_Implement/backend/tests/test_ai_anti_scoring_contract.py` が採点surfaceの復活を禁じている。

**この契約を実装の正本として使用してはならない。** 代替が必要な場合は順位・等級を含まない構造的観測（`llm_input_ir_spec.md` §4の `graph_summary`）に限定し、`ADR-0069` の後に置くこと。

> 記録: 2026-08-12 に本節へ「未実装（計画）。実装前にこの契約を正本として使用すること」という誤った注記が入った。`DX-CONTRACT-DRIFT-01` が検出した「api.md に記載があるが実装が無い」というドリフトに対し、**廃止によるものか未着手によるものかを区別せずに** 後者と解釈したことが原因である。ドリフト検出は差分を見つけるが意図は見分けない。詳細は `DX-CANON-INTENT-01`。

**POST** `/ai/summarize-island-relation`

- Request: `SummarizeIslandRelationRequest`
  - `doc: DocumentV1`
  - `islandAId: string`, `islandBId: string`
  - `relationType: "related" | "negate" | "causal" | "mutual" | "equivalence" | "unknown"`
  - `derived: bool`, `groundingCardIds: string[]`, `groundingEdgeIds: string[]`
  - `cardTexts: RelationCardText[]` — 根拠カードの本文（id + text）
  - `edgeTexts?: RelationEdgeText[]` — 根拠エッジの本文（edgeId/type/from/to）
  - `allowUnreviewedText?: boolean` — **SEC-AI-SAFEMODE-01（ADR-0068）**: 未レビュー本文の送出許可（任意・既定fail-closed）
- Response: `SummarizeIslandRelationResponse`
  - `text: string`, `groundingCardIds: string[]`, `groundingEdgeIds: string[]`, `warnings: string[]`
- 2つの島間の関係を要約する。関係種別は5語彙（related/negate/causal/mutual/equivalence）から選ぶ。

**POST** `/ai/suggest-document-title`

- Request: `SuggestDocumentTitleRequest`
  - `islandTitles: string[]` — 島の表札一覧（最大50件）
  - `cardTexts: string[]` — レビュー済みカード本文（最大50件）
  - `currentTitle?: string` — 現在のタイトル
  - `textReviewed?: boolean` — `cardTexts` が人間レビュー済みか（`SEC-AI-SAFEMODE-02`。**既定false = fail-closed**。未指定・falseは422）
  - `allowUnreviewedText?: boolean` — 未レビュー本文の送出許可（`SEC-AI-SAFEMODE-01`）
- Response: `SuggestDocumentTitleResponse`
  - `candidates: DocumentTitleCandidate[]` — タイトル候補（1〜3件）
    - `title: string`
- 文書全体の内容を反映したタイトル候補を提案する。低品質許容・人間が書き換える前提。候補は並列提示し、順位付け・スコア表示は行わない。

### 2.13 Document監査・検証系API

**POST** `/docs/{doc_id}/context-audit`

- 文書に対するAI文脈参照イベント（query/bundle）を監査記録する。proposal適用時にCE4の4点監査イベントを伴う。
- Error: 404（doc_id不存在）、422（無効なpayload）

**POST** `/docs/{doc_id}/export-audit`

- 共有・書き出しイベント（exportKindを含む）を監査記録する。SafeMode適用後の書き出し境界を通過した場合のみ記録される。
- Error: 404（doc_id不存在）

**GET** `/docs/{doc_id}/similar-candidate-groups`

- Response: `CandidateListViewModel`
- 類似カード統合候補の一覧を返す派生ビュー。保存されたDocumentから導出される。

**POST** `/docs/{doc_id}/polygon-handoff/verify-contract`

- Response: `PolygonHandoffContractVerificationResponse`
- 非矩形島の形状データを、保存契約との整合性で検証する。

### 2.14 Session / Admin / システム系API

BFFの `Sui-Sensemaking-Auth-Session` cookieで認証するunsafe method（POST/PUT/PATCH/DELETE）は、ADR-0074 Decision 5に従い、SameSite=Strictだけに依存しない。`Origin` のscheme/hostが現在のrequest `Host` と一致し、かつsession cookieへHMAC束縛して `Sui-Sensemaking-Csrf`（非HttpOnly）で払い出した値を `X-Sui-Sensemaking-Csrf` headerで返送した場合だけ処理する。欠落・別session・改ざん・cross-site Originはresource lookup前に403で拒否する。明示Bearer credentialがある互換経路はtrusted auth edgeと同じ優先順位でこのcookie用guardの対象外とし、SPA Bearer廃止そのものは別のcutover境界として扱う。

**GET** `/session/context`

- Response: `TenantSessionContextResponse`
- 認証済みセッションのactive tenant・available tenants・effective capabilities・tenantSessionVersionを返す（§8参照）。

**POST** `/session/active-tenant`

- Request: active tenant切替（expectedTenantSessionVersion必須）
- Response: `TenantSessionContextResponse`
- 一致時のみ切替を保存。不一致・欠損は `409 tenant_session_changed`。

**POST** `/session/logout`

- セッションを終了し、サーバー側のセッション状態を破棄する。204 No Content。

**GET** `/session/login`

- AC-1（ADR-0074）: OAuth brokerへのauthorization-code+PKCEフローを開始するBFFエンドポイント（ブラウザ向けリダイレクト）。`next` クエリを保持し、brokerのauthorizeエンドポイントへ302。

**GET** `/session/callback`

- AC-1（ADR-0074）: OAuth callback。codeを交換し、JWKSパイプラインでトークンを検証してサーバー所有の認証セッションcookieを発行する（ブラウザ向けリダイレクト）。

**POST** `/admin/provision/identity-providers`

- strict provisioning: 外部IdPの登録。provider, issuer, audienceを登録する。
- 認可: Platform operator / admin capability

**POST** `/admin/provision/tenant-identity-providers`

- strict provisioning: tenantとIdPのbinding登録。

**POST** `/admin/agent-registrations`

- 将来のエージェント登録（EXT-CONN-02契約後）。登録・一覧・失効は別契約。

**GET** `/admin/provision/audit`

- SEC-ADMIN-PLANE-03: 制御プレーン操作の監査証跡（allowlist読取）。`X-Admin-Api-Key`（またはprovision capability）のcontrol-plane認可必須。
- Response: `{ "events": [{ "eventId", "occurredAt", "route", "operation?", "result", "statusCode", "requestId?", "actorRefHash?" }], "nextCursor?" }`。`limit`（既定100・上限500）と `cursor`（前ページの `nextCursor`）でboundedにページング。
- Stage-A（`X-Admin-Api-Key`）はbootstrap運用者として全体監査を取得する。Stage-B（trusted sessionの`tenant.provision`）はserver解決したactive tenantで絞り込み、他tenantおよびbootstrap行を返さない。caller指定のactor/tenant headerは監査属性・絞り込みに使用しない。
- allowlistに `tenant_id`・本文・secret・生PII・policyRef生値は含めない（ADR-0035）。
- 監査記録はfail-open（記録失敗でも管理操作を阻害しない）。

**GET** `/admin/provision/models`

- AI-MODEL-GOVERNANCE-01（R1）: モデル/プロバイダレジストリ一覧。`X-Admin-Api-Key`（またはprovision capability）のcontrol-plane認可必須。
- Response: `{ "providers": [{ "id", "providerKind", "displayName", "lifecycleState" }], "models": [{ "id", "providerId", "displayName", "capabilities?", "lifecycleState" }] }`。プラットフォーム共有資産（tenant非依存）。

**POST** `/admin/provision/models/providers` / **POST** `/admin/provision/models`

- プロバイダ/モデルを**動的に登録**（control-plane認可）。modelの`providerId`がrequest単位のtransportを決め、一覧表示と実行gateは同じprovider利用可否を用いる。`baseUrl`はtrusted HTTP endpoint契約（HTTPはloopbackのみ）に従う。`apiKeyRef` はprovider用途別の明示allowlistまたは`secret:`参照のみで、平文や他用途の環境変数を保存・解決しない（ADR-0035）。`capabilities` は `intermediate`/`final_judgement` 等のタグ。
- 登録はinsert-only。同一IDの再登録はproviderを`409 provider_already_exists`、modelを`409 model_already_exists`で拒否し、既存rowを暗黙更新しない。起動時seedの冪等upsertとは別契約とする。
- モデル無効化: `PATCH /admin/provision/models/{model_id}` で `lifecycleState: disabled`。無効モデルへの呼び出しはfail-closed。

**GET** `/admin/provision/models/tenants/{tenant_id}/allowlist`

- AI-MODEL-GOVERNANCE-01（R3）: テナントの利用可能モデルallowlistの参照（fail-closed）。空 = プラットフォーム既定。適用はPhase 2の実効モデル解決で交差（より狭い方が勝つ）。
- Responseには`revision`（modelIdsの正規化内容から生成した64桁hex）を含む。管理UI/CLIは更新時にこの値を引き継ぎ、表示後の競合更新を検出する。

**PUT** `/admin/provision/models/tenants/{tenant_id}/allowlist`

- AI-MODEL-GOVERNANCE-01（R3）: テナントの利用可能モデルallowlistの更新（fail-closed・control-plane認可）。空 = プラットフォーム既定。
- 対象tenantが存在しactiveであること、各modelが登録済みかつactiveであること、modelIdsに重複がないことを更新前に検証する。存在しないtenantは404、無効なmodel集合・重複は422とし、部分更新しない。
- `expectedRevision`は必須（OPS-ADMIN-CONCURRENCY-01 AC-4、2026-08-26のMaintainer決定：意図的な破壊的変更・移行期間なし）。未指定は`428 Precondition Required`（`{"code": "model_allowlist_expected_revision_required", "message": "..."}`）で拒否し、更新しない。`inquiry_bundles.py`のPUT/DELETEが`If-Match`欠落時に返す428と同じ契約形状。指定した`expectedRevision`が現行revisionと不一致なら`409 model_allowlist_conflict`で更新せず、`currentRevision`を返す（この不一致検出の挙動自体は変更していない）。正式CLIは常にGETで取得したrevisionを指定するため、この変更による影響を受けない。

**GET** `/healthz`

- 未認証。プロセス生存確認。`200 {"status": "ok"}` を返す。
- **livenessのみで、何も検査しない。** OPS-OBSERV-01: 以前はこれが唯一のAPI確認手段として全runbookで案内されていたため、DBを失った状態でも `ok` を返すことが運用上の落とし穴になっていた。依存の状態は `/readyz` を使う。

**GET** `/readyz`

- 未認証。依存のreadinessを検査する（OPS-OBSERV-01）。
- Response: `{ status: "ready" | "not_ready", checks: { [name: string]: string } }`
- `checks.database`: `ok` | `unreachable`。到達不能時の理由は接続文字列を含みうるため応答へ出さない。
- `checks.schema`: `ok` | `mismatch`。DBの `alembic_version` とビルドが期待するAlembic headの一致を見る。`mismatch` のとき `checks.schemaExpected` と `checks.schemaApplied` にリビジョンIDを併記する（いずれも秘密ではなく、roll-forwardとrestoreの判断に必要）。
- 準備完了なら `200`、そうでなければ `503`。例外を投げず必ずstatusで答える。
- 起動時検査はAlembicの**スクリプト側**の分岐しか見ておらずDBの適用済みリビジョンを読まないため、古いスキーマのDBでも正常起動する。その隙間をこのendpointが埋める。

**GET** `/version`

- 未認証。稼働中のビルドを返す（OPS-OBSERV-01）。
- Response: `{ revision: string, runtimeProfile: string }`
- `revision` は `SUI_APP_REVISION`。未設定時は `"unknown"`。
- `runtimeProfile` はprofile名をそのまま返す。`GET /session/bootstrap-policy` がprofile名を隠してbootstrap modeへ写像するのとは**意図的に異なる**——運用者はどのprofileで動いているかを知る必要があり、profile名自体は秘密ではない。

**GET** `/redoc`

- 未認証。ReDoc形式のAPIドキュメントUI。

**GET** `/openapi.json`

- 未認証。OpenAPIスキーマを返す。

---

## 3. レスポンス例（概要）

### 3.1 DocumentV1（レスポンス）

```json
{
  "version": 1,
  "id": "doc_...",
  "title": "",
  "createdAt": "2026-02-10T00:00:00Z",
  "updatedAt": "2026-02-10T00:00:00Z",
  "transform": {"panX": 0, "panY": 0, "zoom": 1},
  "cards": [{"id": "c1", "text": "...", "x": 120, "y": 80}],
  "edges": [{"id": "e1", "fromId": "c1", "toId": "c2", "type": "related"}],
  "islands": []
}
```

---

## 4. エラー設計（最小）

MVPでは、エラーを過度に作り込まない。ただし、実装済みの安全境界と契約境界は区別して返す。

- 400：**トランスポート/パース境界** — リクエストを解釈できない段階の失敗（JSON構造ネスト深さ超過、closed-worldの未知キー、`json_nesting_too_deep` / `unknown_contract_key` 等）。Pydantic body validationの既定は422へ整形するため、400は明示的に上げる安全境界のみ。
- 403：認可、readOnly、review attribution identityなどの安全境界違反
- 404：doc not found
- 409：`If-Match` 不一致、重複する判断ログなどの競合
- 422：**ドメイン契約違反** — well-formedだが契約を満たさない（必須フィールドがtrim後空、enum違反、operation/command不一致、A1契約フィールド違反、Pydantic body validationの既定）。
- 500：内部エラー

（SEC-HTTP-01・2026-08-15）`POST /admin/provision/users` の必須文字列空チェックを **422** へ統一（従来400だったが、ai.py/ai_relations.pyの同種チェックは422。IdP登録系の `unsupported_protocol` / `invalid_jwks_uri` は構造化コードを持つ別クラスとして400のまま・将来の標準化対象）。

---

## 5. 現行限定契約と将来拡張の境界

### 5.1 現行の限定契約

- `ETag` / `If-Match`: Document全体保存の楽観ロックとして実装済み。個別エンティティの差分同期ではない。
- 認証/認可: `AuthContext` 正規化、strict provisioning、access-control adapter、readOnly / SafeMode優先判定を提供する。完全な組織権限管理UIやRBACエンジンは含まない。
- 監査: view/export/context/proposal系のイベント連携点を持つ。監査ログ閲覧UIや保持期限管理は含まない。
- AI/Context: proposal-only、mock-first、closed-world契約を中心に提供する。AI提案の自動適用や確定昇格は含まない。
- Merge decision / Similar candidate: append-read / derivedの限定契約として提供する。Document内エンティティの個別CRUDではない。

### 5.2 非MVPまたは別Issueで扱う拡張

- Patch APIによる一般的な差分同期。
- サーバ採番の `POST /docs` 標準化。
- read-only link、公開URL、共有管理画面などの完全な共有機能。
- 管理者向け一覧、削除、アーカイブ、所有者移管、保管期限管理。高権限データライフサイクル操作はAccepted済み `ADR-0035` で標準機能外と固定され、本文を含まない監査メタデータ閲覧候補だけを `DATA-MAINT-04` でOpen管理する。本文閲覧、未レビュー情報閲覧、横断検索、保持期限、自動削除、所有者移管は、このAPI契約では提供しない。
- 大規模マルチテナント向けの権限管理UI、監査検索UI、SCIM連携。

---

## 6. 次に作るもの

- `02_Architecture/llm_provider_spec.md`
- `02_Architecture/llm_input_ir_spec.md`
- `02_Architecture/deployment.md`

---

## 7. Publishing metadata の扱い（FB-RM-PUB-01）

- `view.json` / `packs/index.json` の `visibility` は **公開範囲ラベル用メタデータ** として扱う。
- `visibility` の値は `Public | Unlisted | Org | Restricted` を採用し、不正値はvalidatorで拒否する。
- 後方互換として、`view.json` 欠損時は `Restricted`、`packs/index.json` 欠損時は `Public` を補完する。
- `visibility` はAPIの共有可否判定を上書きしない。外部サービスとの共有制御は引き続きSafeMode / share/export policyを正本とする。


## 8. AccessControlAdapter API契約（FB-RM-PUB-04）

roles/groups/policyRefに基づく認可判定は、API本体ではなく `AccessControlAdapter` へ外部委譲する。

### 8.1 入力（API → adapter/hook）

- `action`: `read | write | export | share`
- `auth.actorRef`: `x-actor-ref` ヘッダ（任意）
- `auth.roles`: `x-auth-roles` ヘッダ（`,` 区切り、任意）
- `auth.groups`: `x-auth-groups` ヘッダ（`,` 区切り、任意）
- `auth.traceId`: `x-trace-id` ヘッダ（任意）
- `resource.visibility`: `x-doc-visibility` ヘッダ（`Public | Unlisted | Org | Restricted`）
- `resource.policyRef`: `x-policy-ref` ヘッダ（任意）
- `safeMode`: ルート側のsafeMode（export-auditではpayload.safeMode）
- `readOnly`: `X-Read-Only` ヘッダ（`1`/`true`）

正規化ルールは次のとおりです。

- `x-auth-roles` / `x-auth-groups` が未指定・空文字・`null` 相当値のときは `[]` として扱う。
- `x-policy-ref` はtrim後に空文字なら `null` として扱う。
- API本体はroles/groups/policyRefの意味解釈を行わない（外部委譲）。

上記visibility/policyRef headerはsingle-tenant互換resolverだけの契約である。SaaS profileでは公開headerを無視し、`tenantId + docId`で取得したserver-owned `document_access_metadata`のvisibilityと非秘密`policyBindingId/version`を使う。生のpolicyRefはDBへ保存せず、trusted runtime binding resolverがbinding IDから一時的に解決した値だけをPDPへ渡す。metadata、binding、runtime resolverのいずれかが欠損・不正・到達不能なら、`Restricted + policyRef欠損`としてdeny fail-safeへ倒す。

### 8.2 出力（adapter/hook → API）

```ts
type AccessDecision = {
  allow: boolean;
  readOnly?: boolean;
  reason?: string;
};
```

- `allow=false` の場合はAPIは `403` を返す。
- `reason` は `Access denied: <reason>` として観測可能。
- 本体はdecisionの解釈のみを行い、roles/groupsの評価規則は持たない。

### 8.3 fail-safe

SafeMode/readOnly 優先順:

1. `safeMode=true` かつ `action in {export, share}` は常に拒否（`reason=safe_mode`）
2. `readOnly=true` かつ `action in {write, export, share}` は常に拒否（`reason=read_only`）
3. その後にadapter判定とpolicyRef fail-safeを評価


- 条件: `visibility in {Org, Restricted}` かつ `policyRef` 欠損。
- 既定 `read_only`: `read` のみ許可、`write/export/share` は `403`。
- オプション `deny`: 全アクション `403`。
- 実装パラメータ: `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only|deny`。

fail-safe マトリクス:

- `policyRef` 欠損/空白（`visibility in {Org, Restricted}`）: `policy_ref_missing`
- `policyRef` 不達（接続失敗/timeout）: `policy_ref_unreachable`
- `policyRef` 無効（形式不正/失効/署名不正）: `policy_ref_invalid`
- adapter例外/想定外応答: `adapter_error`

上記4系統は `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` に従い `read_only` または `deny` へ倒す。`visibility` が `Public/Unlisted` の場合は欠損系の強制fail-safe対象外。

### 8.4 監査イベント連携点

- `GET /docs/{doc_id}` でアクセス許可後に `eventType=view` を送信。
- `POST /docs/{doc_id}/export-audit` でアクセス許可後に `eventType=export` を送信。
- `POST /docs/{doc_id}/context-audit` でアクセス許可後に `eventType=query|bundle|proposal|apply` を送信。
- 監査送信は既存のfail-open dispatcher方針を維持する（監査送信失敗で本体機能は停止しない）。
- event envelopeの`tenantId`は、認可・repositoryと同じserver-resolved TenantContextから設定する必須fieldであり、自由形式metadataやclient入力から補完しない。欠損、空値、前後空白、制御文字、256文字超のtenantIdではeventを構築しない。
- HTTP送信payloadは64KiB以下、metadataは32 field以下、keyは128文字以下、文字列値は1,024文字以下に制限する。本文・credential系keyは固定値へredactし、過大値や非finite numberをそのままqueue／送信先へ渡さない。transport失敗時のfail-open方針はこの構造検証を迂回しない。

最小記録項目（PII非保存）:

- 必須: `eventType`, `schemaVersion`, `occurredAt`, `tenantId`, `docId`, `action`, `decision.allow`, `policyRefPresent`
- 任意: `decision.readOnly`, `decision.reason`, `visibility`, `adapterName`, `traceId`, `amr`, `acr`, `aal`, `authTime`
- 非保存: `policyRef` 生値、`roles/groups` 生値、token/assertion生値、WebAuthn credential id、ドキュメント本文

### 8.5 実運用アダプタ設定（OIDC/SAML接続）

- `SUI_ACCESS_CONTROL_ADAPTER=external_http` で、APIは外部policy接続先（endpoint）へ `POST` 委譲する。
- endpointはcredential/query/fragmentを含まないHTTPS、またはloopback HTTPに限定する。`external_http` を選択した場合はendpointを必須とし、欠損、固定bearerやIdP issuerだけが残る不完全設定、0以下または30秒超のtimeoutを起動時に拒否する。
- request bodyは `AccessRequest` 契約から構成し、`auth.roles/groups` と `resource.policyRef` の意味解釈は行わない。一方で送信前の安全境界として、UTF-8 JSON全体を64KiB以下、識別子を256文字以下、`policyRef`を2,048文字以下、roles/groupsを各64件以下の重複なしcanonical文字列に限定する。
- subject/resource欠損、制御文字・前後空白、未知のaction/visibility、型不正、上限超過を含むserver-composed requestはtransport前に拒否し、raw値をclient・logへ反射せず`adapter_error`としてfail-safeを適用する。
- request headerには `x-acl-auth-mode: none|oidc|saml` を付与し、必要時のみ `Authorization: Bearer <static>` / `x-idp-issuer` / `x-trace-id` を付与する。
- 応答は `allow:boolean`（必須）+ `readOnly:boolean?` + `reason:string?` の最小契約。object以外、余分なfield、64KiB超、非UTF-8/非JSON、512文字超または制御文字を含むreasonは受理せず、応答値をclient・logへ反射せずに`policy_ref_invalid`としてfail-safeを適用する。
- `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT` が未設定の場合、`external_http` を `noop` へフォールバックせず、設定不備として起動を拒否する（`ADR-0062`）。明示的な `noop` と、完全設定後のPDP実行時障害に対する `read_only|deny` は従来どおり維持する。

### 8.6 互換性

- adapter未設定（`noop`）では既存挙動を維持する。
- API本体にRBACエンジンは実装しない（非目標）。

## 9. AUTH-SCHEMA-01 API契約（JIT / strict provisioning）

### 9.1 AuthContext 正規化

- single-tenantのforwarded-header identity pathの入力ヘッダ（設定差し替え可。`saas-multitenant` のtrusted JWT/cookie pathでは使用しない）:
  - `SUI_AUTH_PROVIDER_FIELD`（既定 `x-auth-provider`）
  - `SUI_AUTH_USER_FIELD`（既定 `x-forwarded-user`）
  - `SUI_AUTH_SUBJECT_FIELD`（既定 `x-auth-subject`）
  - `SUI_AUTH_EMAIL_FIELD`（既定 `x-forwarded-email`）
  - `SUI_AUTH_NAME_FIELD`（既定 `x-forwarded-name`）
- header意味:
  - external UIDは `AUTH_SUBJECT_FIELD` を第一候補とし、欠損時だけlegacy `AUTH_USER_FIELD` へfallbackする。`AUTH_USER_FIELD` は内部 `users.id` の指定ではない。
  - providerはtrim・lowercase正規化し、欠損/空値は `header` とする。
  - email/nameはJIT provisioningで新規 `UserRow` を作る時の初期値にだけ使い、既存user属性をheaderで上書きしない。
- 正規化後は次のとおりです。
  - `AuthContext.userId`: `users.id`
  - `AuthContext.actorRef`: `user:<users.id>`
  - `AuthContext.provider` / `AuthContext.externalUid`
- reviewerRef解決:
  - `SUI_REVIEWER_REF_RESOLVER_ADAPTER`（既定: `user_id`）で `reviewerRef/ownerRef` を解決する。
  - adapter実装は `resolve(auth_context) -> { reviewerRef, ownerRef }` 契約を満たす。
  - profile:
    - `user_id`: `user:<users.id>`（未認証は `actorRef` → `null`）
    - `sso_subject`: `user:sso:<provider>:<externalUid>`（不足時は `user_id` フォールバック）
  - 責務境界: resolverはreviewerRef/ownerRef生成のみを行い、reviewEvents/export/import schemaを変更しない（opaque string互換維持）。
  - adapter未設定時はSettingsの既定値 `user_id` を使う。不正値はSettings validationで起動時に拒否し、公開設定経路ではフォールバックしない（factory内部の未知adapter名への `user_id` フォールバックは防御的実装）。
- 属性境界は次のとおりです。
  - persist: `provider`, `external_uid`, `display_name`, `email`
  - transient only: `roles`, `groups`, `policyRef`, `amr`, `acr`, `aal`, `auth_time`, `trace_id`
  - forbidden: password/hash/secret, WebAuthn credential id, raw policy token

### 9.2 strict mode 拒否契約

- 条件: `SUI_ALLOW_JIT_PROVISIONING=false` かつ `provider+external_uid` が `user_identities` に未登録。
- 応答: `403 Forbidden`は次のとおりです。
- エラーボディ（最小契約）: `{ "code": "identity_not_provisioned", "message": "Identity not provisioned. Pre-provision via /admin/provision/users before access." }`

型契約（モック互換のための最小）は次のとおりです。

```ts
export type StrictProvisioningError = {
  code: "identity_not_provisioned";
  message: string;
  requestId?: string;
};
```

- `code` は固定値。
- `message` は可読文（文言変更は許容、意味は固定）。
- `requestId` は任意（監査/追跡用途）。
- 追加フィールドは許容するが、依存実装は上記3項目のみで判定可能であること。

### 9.2.1 strict mode の運用責任境界（承認フロー固定）

- backend 実装責務:
  - strict mode条件に一致した要求を例外なく `403` で拒否する。
  - 緊急時でもアプリ内の一時バイパス（特定ユーザー許可など）を実装しない。
- 例外承認責務は次のとおりです。
  - `SUI_ALLOW_JIT_PROVISIONING` の切替承認は **Security Officer + System Ownerの2者承認** を必須とする。
  - 実行（環境変数変更/再起動）はPlatform Operatorが行い、変更記録（時刻・理由・承認者）を監査証跡に残す。
- 承認なき例外は不許可は次のとおりです。
  - 開発者判断のみでstrict modeを緩和してはならない。
  - 監査時は「承認記録がない緩和設定」を設定不備として扱う。

### 9.3 事前プロビジョニング API（最小）

- `POST /admin/provision/users`
  - request: `{ provider, externalUid, displayName?, email?, roles? }`
  - `roles?`: **server-verifiedロール識別子の配列**（SEC-AUTH-ATTRIB-01）。この列からidentity解決が読み出し、認可サービスはクライアントヘッダ由来ではなくserver導出のrolesを受領する。
  - `201` response (created): `{ userId, reviewerRef, ownerRef, provisioned=true }`
  - `200` response (idempotent retry): `{ userId, reviewerRef, ownerRef, provisioned=false }`
  - 冪等: 同一 `provider+externalUid` の再試行は `provisioned=false` を返す
  - `409` response: 既存subjectへ矛盾する `displayName` / `email` を再投入した場合は `identity_already_provisioned_conflict` と可読 `message` を返す
  - runtime境界: `local-dev`、`evaluation`、`enterprise-production`のsingle-tenant profileだけで提供する。`saas-multitenant`ではDB参照・書込前に`404 strict_provisioning_unavailable`、未知・解決不能profileでは`503 runtime_policy_unavailable`として閉じ、SaaS membership provisioningへfallbackしない

型契約（I/F固定）:

```ts
export type AdminProvisionUserRequest = {
  provider: string;
  externalUid: string;
  displayName?: string;
  email?: string;
};

export type AdminProvisionUserResponse = {
  userId: string;
  reviewerRef: `user:${string}`;
  ownerRef: `user:${string}`;
  provisioned: boolean;
};

export type AdminProvisionUserConflictError = {
  code: "identity_already_provisioned_conflict";
  message: string;
};
```

- 判定規約: single-tenantクライアントがidentity処理として必須サポートするのは `2xx + provisioned`、`403 + code=identity_not_provisioned`、`409 + code=identity_already_provisioned_conflict` の3分岐とする。runtime境界の`404`／`503`はidentity結果へfallbackせず、管理surface自体を停止する。
- 非目標: 本契約ではページング・検索・一括削除・SCIM互換項目は定義しない。

本APIはsingle-tenant互換の管理者CLI連携の最小置換点として扱う。SaaSのTenantMembership／SCIM連携はverified IdP、active tenant、`membership.provision`を再検証する別契約とし、本APIを再利用しない。

### 9.4 移行契約（expand/contract）

- expand: `users` / `user_identities` 追加後、Alembic `20260717_0007`以降は作成処理で旧`provider+external_uid`と`identity_provider_id+subject`を二重書きし、解決時は後者を優先する。expand列が空の旧行だけは旧keyへbounded fallbackし、成功時に新bindingを補完する。両keyが異なるUserへ一致する場合や既存bindingと入力が不一致の場合は`identity_mapping_conflict`で拒否する。互換IdPはsingle-tenant移行用であり、検証済みissuer/audienceに基づくSaaS認証とは扱わない。
- contract: attribution APIは `reviewerRef` / `ownerRef` を `user:<users.id>` に統一し、外部subject直参照を受け付けない。
- strict modeはcontract側の強制条件として扱い、未登録subjectを `403` で拒否する。

### 9.5 エージェント登録 API（契約先行固定、`DATA-MODEL-OPS-02` D3/AC-5）

`agent_registrations` をサーバー正本として採用する（実装は `EXT-CONN-02` で行う。本節は `EXT-CONN-02` 着手前提の契約先行固定であり、実装そのものの許可を意味しない）。§9.3の事前プロビジョニングAPIと同じstrict provisioning型を採用し、通常の文書owner操作とは分離する。

- 登録・失効はadminのstrict provisioning型操作に限定する。文書ownerによるtoken発行は不採用とする。
- 平文tokenは保存しない。作成時のレスポンスで一度だけ表示し、以後は `tokenHash` のみで照合する。再取得APIは提供しない。
- 登録は文書単位（`docId`）に束縛する。登録の存在自体を文書書込権限とみなさず、ingestごとに既存access-controlで別途許可判定する（`EXT-CONN-02` 受信面が強制）。

**POST** `/admin/agent-registrations`

- Request body：`AdminCreateAgentRegistrationRequest`
- Response（201）：`AdminCreateAgentRegistrationResponse`（`token` はこの応答でのみ返る平文値）
- Error：`403 identity_not_provisioned` 相当（§9.2と同一のstrict mode拒否契約）

**DELETE** `/admin/agent-registrations/{registration_id}`

- Response（200）：`AdminAgentRegistrationSummary`（`revokedAt` が設定された状態）
- Not found：404
- 冪等：失効済みへの再DELETEは既存の `revokedAt` を保った同一レスポンスを返す

**GET** `/admin/agent-registrations`

- Response：`AdminAgentRegistrationSummary[]`
- `token` / `tokenHash` はこの一覧応答に含めない（§2.4 DocumentListItemV1と同種のallowlist方針）

型契約（I/F固定）:

```ts
export type AdminCreateAgentRegistrationRequest = {
  docId: string;
  label?: string;
};

export type AdminCreateAgentRegistrationResponse = {
  registrationId: string;
  docId: string;
  label?: string;
  token: string; // 平文。この応答でのみ返り、以後は再取得不可
  createdAt: string; // ISO 8601
};

export type AdminAgentRegistrationSummary = {
  registrationId: string;
  docId: string;
  label?: string;
  createdAt: string; // ISO 8601
  createdBy: string; // opaque admin actorRef
  revokedAt?: string | null; // ISO 8601、未失効はnull
};
```

- 非目標：本契約ではページング・検索・token roll（再発行による旧token継続失効付き差し替え）・複数document一括登録は定義しない。

## 10. SaaS TenantContext / capability契約（ADR-0059 / ADR-0061、現存surface実装済み）

本節はAccepted済みのtarget契約であり、現在公開・到達可能なsurfaceについては`SAAS-TENANT-01` AC-1〜13をmainへ統合済みである。`local-dev` / `evaluation` / `enterprise-production`はsingle-tenant相当を維持し、SaaSは独立した`saas-multitenant` profileで、必須policy/componentのpreflightを通過した構成だけを有効化する。bootstrap policy、session context、conditional active tenant変更のfail-closed routeとfrontend entry gateに加え、信頼済みauth edgeのidentity resolver・tenant resolver・active tenant session adapterを3点同時にだけ受け付ける起動前bundle境界を実装済みである。profile、型付き非秘密policy、bundleの型・欠損・相互必須、started-state、構築済みPDP／capability／binding componentの実型を状態変更なしでpreflightし、DB初期化前とadapter有効化前に同じ判定を再実行する。single-tenant profileへのbundle注入、SaaS profileでのbundle欠損、未知profile、設定と実componentの不一致をDB接続前に起動拒否する。SaaS profileではPostgreSQL、JIT無効、external access-control、`deny` fail-safe、external document binding、external tenant capabilityに加え、対応する3つのexternal component実体を必須とする。preflight済みの同一instanceだけをApp stateとDocument resource resolverへ渡す。bundle非注入のsingle-tenant profileではidentity/session adapterをunavailable、tenant resolverとDocument resource resolverをsingle-tenant互換へ戻してsession context系を503として閉じる。SaaS bundle有効化時はDocument resource resolverもserver-owned metadata＋trusted binding resolverへ同じlifespan内で切り替え、公開visibility／policy headerを認可根拠にしない。Document、Tenant Admin、文書内容を扱うAI mutation、context mutationには共通version preconditionを実装済みであり、Document context auditは世代確認と認可が成功するまで監査進行stateを更新せず、event completeness trackerを検証済み`tenantId + docId`単位に分離する。登録済みの全Document／Document access admin routeが各共通認可境界を呼ぶことはcontract testで固定する。同contractは登録route全件を既定fail-closedで列挙し、共通のtenant-scoped境界を持たないrouteは機械的に再検査される理由付きexemptionとして明示分類されなければ失敗するため、未分類の新規routeとmountされたASGI sub-appを検出する。実auth edge adapter（`JwtSaasIdentityContextResolver`。BFFのcookie経路を含む）とanti-forgery付きserver-owned session形式は実装済みである。現在公開されているDocument／Tenant Admin／session／文書内容を扱うAI・worker/browser経路は親Issueのversion/tenant境界で検証済みとする。一方、現存しないimport／share／webhook／非同期jobの新規開始点は実装済みと主張せず、MCPはtenant-bound credentialが存在しない間`saas-multitenant`を起動時fail-fastする。実SaaS deploymentは外部binding/PDP/capability等の必須componentを構成し、preflightを通過しなければならない。

### 10.1 session context（GET/POST version guard実装済み・SaaS runtime gated）

- `GET /session/bootstrap-policy`
  - settings validation済みのserver runtime profileを起動時にsnapshotし、profile名やtenant情報を公開せず、`tenantSessionMode: "single-tenant" | "tenant-session-required"`だけを返す。header、query、Document payloadを判定根拠にしない。
  - `local-dev`、`evaluation`、`enterprise-production`は`single-tenant`へ写像する。`saas-multitenant`は`tenant-session-required`へ写像し、`TrustedSaasRuntimePolicy`と起動前bundleの必須component検証を通過した場合だけ起動する。不完全な構成はDB初期化・adapter有効化前にfail-fastする。
  - 未知・欠損profileは`503 runtime_policy_unavailable`として値を反射せず閉じる。成功・失敗とも`Cache-Control: no-store`と`Pragma: no-cache`を付ける。
- `GET /session/context`
  - 現在の検証済みTenantContext、利用者がactive membershipを持つtenant候補、tenant-scoped capabilityを返す。
  - tenant候補はサーバーでallowlistされたmembershipだけとし、tenant検索や自由入力を提供しない。
  - identity、TenantContext、active membership、membership ID、capability snapshotをrequestごとに再確認する。membership IDはresolver値をそのままPDPへ渡さず、`principalId + tenantId`のactive membershipからserver-sideで再生成した値との一致を必須にする。信頼済みresolver欠損、single-tenant互換context、停止・差し替えmembership、不正・未知capabilityではfail-closedとする。
  - responseは64KiB以下、principal/tenant IDを256文字以下、tenant display nameを256文字以下、capability versionと`tenantSessionVersion`を各128文字以下、available tenantを1〜256件の重複なし、effective capabilityを既知11件以下の重複なしへ限定する。server-side session値が不正・非表示・過大な場合は`503 session_context_unavailable`、capability snapshot違反は`503 capability_resolution_unavailable`として値を反射せず閉じる。
  - `tenantSessionVersion`はtrusted auth/session adapterがactive tenant stateへ束縛して発行する予測不能なopaque IDである。Documentやcapabilityのversionではなく、同じ認証sessionの複数タブ・古いrequestを止めるexpected-context guardにだけ使う。
  - `Cache-Control: no-store`と`Pragma: no-cache`を付け、利用者表示名・email・外部IdP subject・membership ID・role/groupを返さない。
- `POST /session/active-tenant`
  - request: `{ tenantId, expectedTenantSessionVersion }`
  - backendが現在のidentity・TenantContext・membershipを再確認し、同じprincipalのactive membership allowlistから新TenantContextを確定した場合だけ更新後contextを返す。header、query、role/group、自由入力tenantを選択根拠にしない。
  - `expectedTenantSessionVersion`をtrusted sessionの現versionとconstant-time相当の比較で照合し、欠損・不一致なら保存前に`409 tenant_session_changed`として値を反射せず閉じる。同時切替や古いdialogからの確定を新contextへ自動適用しない。
  - 認証session固有の保存形式、versionの原子的更新、anti-forgery検証はtrusted auth edgeが注入する`active_tenant_session_persister`の責務とする。persisterへはraw tenant値ではなく、server検証済みprincipal、旧TenantContext、旧version、選択済みTenantContextだけを渡し、成功時に新versionを返させる。
  - session adapter欠損・現versionの欠損／不正は`503 session_context_unavailable`、原子的な更新時の予期しない保存障害や同値／不正な新versionは`503 active_tenant_update_unavailable`として値を反射せず閉じ、保存前にresponse sizeとclosed-world契約を検証する。trusted adapterによるanti-forgery拒否はその拒否status/codeを維持する。
  - 不明tenant、他利用者のtenant、停止membershipは存在を推測させない`404`相当とする。
- `POST /session/logout`
  - live JWTを要求せず、提示されたopaque session versionのserver-side bindingを失効したうえで、`Sui-Sensemaking-Tenant-Session-Version` cookieを発行時と同じ`Path=/`、`HttpOnly`、`SameSite=Strict`、profile依存`Secure`属性で失効する。期限切れJWTがlogoutを妨げないよう、tenantやprincipalの解決は行わない。
  - responseは`204`、`Cache-Control: no-store`、`Pragma: no-cache`とする。frontendはこの呼出しの成否にかかわらずmodule memory上のaccess tokenを破棄する。

```ts
export type TenantSessionBootstrapPolicyV1 = {
  tenantSessionMode: "single-tenant" | "tenant-session-required";
};

export type TenantSessionContextV1 = {
  principalId: string;
  activeTenant: { id: string; displayName: string };
  availableTenants: Array<{ id: string; displayName: string }>;
  effectiveCapabilities: string[];
  capabilityVersion: string;
  tenantSessionVersion: string;
};

export type ActiveTenantRequestV1 = {
  tenantId: string;
  expectedTenantSessionVersion: string;
};
```

`effectiveCapabilities`は表示補助であり、APIの再認可を代替しない。trusted server-side sessionのcapability正本はWorkspace（`document.read/write/export/share`）、Tenant Admin（`document.policy.manage`、`membership.provision`、`agent.register/revoke`、`audit.read`）、Platform Control Plane（`tenant.provision/suspend`）の3つの認可surfaceへ明示分離する。`GET /session/context`とactive tenant変更responseはWorkspace＋Tenant Adminの9種だけを返し、Platform Control Plane capabilityをbrowser向けWorkspace contextへ露出しない。server内部のtrusted sessionからPlatform capabilityを削除してはならず、`/admin/provision/**`等の専用routeで独立に再認可する。cacheする場合は`deployment + tenantId + principalId + capabilityVersion`で分離し、auth sessionの有効期限を越えて保持しない。

`tenantSessionVersion`はtenant/capabilityの認可根拠ではない。SaaS profileのtenant-scoped public APIと非同期開始点は、最後に検証したversionを単一の`Sui-Sensemaking-Tenant-Session-Version` request headerとして必須受領し、trusted sessionを解決した後、resource lookup、body parse後の副作用、PDP、job enqueueより前に一致を確認する。同名headerの欠損・重複・不正・不一致では本文・metadataを返さず`409 tenant_session_changed`へ閉じ、生versionや現在tenantを応答・log・監査へ反射しない。read、list、export、share、import、MCP、webhook、Tenant Adminも例外にせず、stale requestを新contextへ自動再送しない。このclient値からTenantContextを解決してはならない。browserから利用するSaaS配備ではCORS allow-headersへこの名前だけを明示し、proxy/CDNで同名headerを連結・複製しない。

frontend clientは現在の検証済み`availableTenants`にないtenantを通信前に拒否し、`no-store`・same-origin JSONでactive tenant変更を要求する。要求には現在の`tenantSessionVersion`を含め、成功responseは既存validatorに加えてprincipal不変、要求tenant一致、新versionへの変更を確認した後だけ遷移へ使用する。遷移時は進行中requestをabortし、workerをdisposeし、object URLと文書・選択・検索等のmemory stateを破棄し、旧browser storage scopeだけを削除してhard document replacementを行う。cleanup/storage削除の一部が失敗しても旧DOMを継続利用せずreplacementを優先する。未検証responseではcleanup、storage変更、navigationを開始しない。別タブ通知は旧DOMを早くblockする補助に限り、通知欠落時も次requestのserver preconditionで停止する。

Workspace用tenant controlは、検証済みmembershipが1件ならactive tenant表示だけ、複数なら`availableTenants`だけをoptionとするselectを構築する。tenant IDの自由入力、tenant検索、role/group解釈を持たず、active tenant自身・allowlist外・不正sessionから変更要求を発火しない。未保存変更の保存／破棄／取消を選ぶalert dialog、選択・旧scope・server応答を再検証するrequest coordinator、App保存・request/worker/object URL/timer cleanup・旧scope削除・hard replacementを起動する任意注入hostは実装済みである。App hostは注入sessionとbrowser scopeが完全一致する場合だけcontrolを構築し、切替確定後または応答不明時は旧tenant本文をloading／blocked stateへ置換する。切替確認は同じ認証sessionの他タブにも影響することを常時説明する。固定channel名へ`null`だけを送る別タブ通知と、受信、`pageshow.persisted`、online復帰、5分以上の非表示復帰で旧Appをblocked化しrequest／workerを停止するcoherence境界も実装済みである。通知はbest-effortであり、失敗してもlocal hard replacementを止めない。SaaS entry pointはbootstrapで検証したsession contextと一致するbrowser scopeをAppへ同時注入し、文書read/write/export監査と文書内容を扱うAI mutation clientはそのopaque versionだけを正式headerへ付与する。serverの`tenant_session_changed`は通常の文書競合やAI provider障害として扱わず、runtime cleanup後に旧Appをblocked化する。App runtime cleanupはtenant session generationを単調に無効化し、Document read/write、export監査、AI mutation、diff／診断worker、bundle生成の遅延成功結果を開始時generationが一致する場合だけ呼出元へ返す。bundleはgeneration照合後にだけzip downloadへ進む。ローカルDocument／view／comparison／review-pack／patch importもFile／zip／integrity／fingerprintの非同期結果を同じguardへ通し、review-pack snapshot URLは最後の検証後にだけ生成する。PNG／HTML snapshot、patch、agent taskの非同期生成結果もguard成功後にだけdownload／clipboardへ渡す。public packはmanifest／Document／任意viewを同一generationで取得・検証してから一括commitし、stale時はAPI／組込みsampleへ自動fallbackしない。子コンポーネントが所有する問い合わせbundle import workerとtrace workerもAppから同じguardを受け取り、stale結果をstate更新やclipboard開始へ渡さない。将来追加するserver import／share等のendpoint、clipboard API呼出し後のOS側commit取消は未実装である。

`principalId`は認証済みUserに対応するserver-managed opaque IDであり、表示名やemail、外部IdP subjectを返さない。browser storage scopeのprincipal要素にはこの値だけを使う。

実装準備として、署名・issuer・audience検証後の証跡を受け取る内部resolver、IdP/tenant binding、UserIdentity、active membershipの再照合、active membershipだけのtenant候補列挙と切替選択serviceを実装済みである。server runtime profileをprofile名非公開の2値へ写像する`GET /session/bootstrap-policy`、strict frontend client、profile別entry pointも実装済みで、frontendは成功・エラーresponseを4KiBまでに限定し、未知mode、余分なfield、非UTF-8、不正JSONを利用しない。session responseの内部builderと`GET /session/context` routeは、active tenantの再照合、opaque principalId、allowlist済みtenant候補、trusted capability resolverの既知capabilityだけを受理し、識別子・一覧件数・response sizeを上限内へ閉じる。不正・欠損したcapability snapshotは`503 capability_resolution_unavailable`、不正・過大なsession値は`503 session_context_unavailable`としてfail-closedにする。`POST /session/active-tenant`も現在contextと要求tenantのmembershipを再確認し、検証済み選択結果だけをtrusted session persisterへ渡す。frontend側はsession GET/POSTを`no-store`・same-originで行い、成功・エラーresponseのstreamを64KiBまでで打ち切って超過時はcancelする。成功response validatorを通過し、active tenantがavailableTenantsと一致したcontextだけをbrowser storage scope／transitionへ渡す。request coordinatorと任意注入App hostもcurrent session、要求tenant、旧scope、POST成功responseのprincipal／active tenantを独立に再検証し、未保存変更の取消・保存失敗では通信やcleanupを開始しない。未知・重複capability、余分なfield、非UTF-8、非表示・過大値は利用しない。strict external HTTP capability resolver、application lifecycleの既定unavailable配線、identity/tenant/persisterを部分注入させずruntime profileとも原子的に照合する起動前bundle境界は実装済みである。SaaS frontend entryはpolicy／session bootstrap成功後の検証済みcontextとbrowser scopeをApp hostへ同時注入し、single-tenant entryは従来どおり未注入で起動する。HTTP headerやqueryを直接verified evidenceへ変換する処理は単一テナント向けのlegacy経路である。SaaS向けtrusted auth edgeは `SUI_JWT_ALGORITHMS` の検証済みallowlist（既定 `RS256,ES256`。RS/ES/PS系の既知asymmetric algorithmを受理）でJWTの署名、issuer、audience、期限を検証し、HMAC/`none`/未知algorithmは受理しない。PKCE対応mock IdPによるE2E基盤を持つ。Bearer tokenの`jti`は任意であり、通常のrequest単位replay検出には使用しない。共有persisterは現時点でprincipal単位versionのみを保持するため、認証session IDとactive tenantの原子的正本化は`SAAS-TENANT-SESSION-BINDING-01`で未完了である。`saas-multitenant` profileは設定上起動できるが、本番利用gateを満たさない。**2026-08-22時点の是正**: `SAAS-TENANT-SESSION-BINDING-01`のAC-1〜6は、BFF cookie経路（`Sui-Sensemaking-Auth-Session`、trusted auth edgeが`auth_session_key_hash`を解決する経路）に限り完了した——共有store（`SaasAuthSessionRow`）は認証session識別子・active tenant・versionを同一行でCAS原子的に保持・更新する。**この本文が記述する現行SPAのBearer token経路は対象外のまま**であり、依然principal単位versionのみの旧storeを使う。BFF cookie経路への切替（AC-9・cutover）が完了するまで、本文の記述と本番利用gate未充足の結論は変わらない。

frontend entryはbuild時の`SUI_RUNTIME_PROFILE`をclosed-worldに解決する。未指定・`local-dev`・`evaluation`・`enterprise-production`はpolicy通信を行わず従来のlocal-first Appをmountする。`saas-multitenant`だけはserver bootstrap policyが`tenant-session-required`と一致した後、server-owned BFF cookie sessionによるsession GETとresponse再検証を完了し、成功時だけ`deployment + tenantId + principalId` scope付きAppをmountする。未知・空・非canonical build値、policy取得失敗・不一致、401、403、session解決不能、不正response、不正deploymentは旧本文をmountしないretry可能なblocked stateへ分離し、upstream message、profile、principal、tenant値を表示しない。lifecycle abortは失敗表示へ変換せず破棄する。active tenantは認証session keyへ束縛してserver側で正本化し、frontendはBearer tokenのtenant claimをactive tenant正本として使わない。

Appは注入されたbrowser storage scopeをmount時に検証・snapshotし、recent document、view mode/locale/visibility、reviewer、onboarding、advanced UI、Minimap、QueryPresetを同じscopeへbindingする。scopeを同一mount内で変更する場合は旧memory stateを再利用せず例外停止し、§10.1のhard document replacementを必須とする。App unmount時は進行中のdiff・diagnostics・bundle requestをabortし、bundle taskをcancelしてdiff・diagnostics workerをdisposeする。個別cleanup失敗で残りのcleanupやreplacementを止めない。scope省略時は既存single-tenant keyを維持する。`saas-multitenant` entryはsession bootstrap成功時だけscopeを注入するが、backend runtime gateと残る越境matrixが未完了のため、これだけをSaaS対応済みとは扱わない。

capability resolverは`principalId`、`tenantId`、DB再照合済み`membershipId`だけをtrusted endpointへPOSTし、各値を256文字以下のcanonicalなserver-owned ID、request全体を64KiB以下に限定する。不正・欠損・過大contextはtransport前に停止する。応答は`effectiveCapabilities`と`capabilityVersion`だけを受理し、capabilityは§10.5を含む既知11値に限定して重複・未知値・roles/groups等の余分なfieldを拒否する。§10.2のtenant-scoped AccessRequest actionはWorkspace＋Tenant Adminの9値に限定し、Platform Control Planeの2値を混入させない。responseは64KiB以下、versionは128文字以下のopaque canonical IDとし、4xx、timeout、transport障害、非JSON、不正shapeは内部詳細を反射せず`capability_resolution_unavailable`へ正規化する。API keyと応答bodyはDB・監査・diagnosticsへ保存しない。

### 10.2 tenant-scoped access request

SaaS profileでAccessControlAdapterへ渡すrequestは、§8.1に加えて次を必須とする。

```ts
export type TenantScopedAccessRequestV1 = {
  action:
    | "document.read"
    | "document.write"
    | "document.export"
    | "document.share"
    | "document.policy.manage"
    | "membership.provision"
    | "agent.register"
    | "agent.revoke"
    | "audit.read";
  auth: AuthContext;
  tenant: TenantContextV1;
  resource: {
    tenantId: string;
    kind: "document" | "membership" | "agent_registration" | "audit";
    id: string;
    policyRef?: string;
  };
  safeMode: boolean;
  readOnly: boolean;
};
```

評価順はAuthContext解決、TenantContextとserver-side session version解決、client expected `tenantSessionVersion`照合、active membership確認、`tenantId + resourceId`によるserver-side lookup、主体tenantと資源tenantの一致、SafeMode/readOnly guard、外部PDP、API enforceとする。version不一致とtenant不一致はPDPへ委譲せず常にdenyする。resourceのtenant/visibility/policyRefをclient headerやpayloadから採用しない。

### 10.3 SaaS fail-closed / response境界

- tenant不明・不一致、membership停止、adapter欠損、PDP timeout/無効応答ではreadを含めてdenyする。
- `tenantSessionVersion`欠損・不一致ではresource lookup前に`409 tenant_session_changed`へ閉じ、現在tenantやresourceの存在を応答へ混入させない。
- 他tenantのresource IDは`404`相当とし、list/search/count/paginationにも存在を混入させない。
- current tenant内でresourceの存在が認可済みだが操作capabilityが不足する場合は`403`を返してよい。
- 明示的な`noop`と`read_only` fail-safeはSaaS profileで禁止する。endpoint欠損時noop fallbackは`ADR-0062`によりprofileを問わず廃止し、外部HTTP方式の不完全設定は起動時に拒否する。§8.3〜8.6のうち明示的なsingle-tenant互換挙動だけを既存profileへ適用する。
- auditにはtenantId、opaque actor/resource ID、action、decision、policy/capability version、correlation IDだけを記録し、本文、タイトル、role/group生値、tokenを記録しない。

Tenant-scoped access-control entry pointは、TenantContext欠損、resource tenant欠損、両tenant不一致をそれぞれ`tenant_context_missing`、`resource_tenant_missing`、`tenant_mismatch`として外部PDP呼出し前にdenyする。このguardは`read_only` fail-safeから独立し、tenant境界の不備をread許可へ変換しない。Document routeのresource解決もapplication lifecycleで設定するresolver境界とし、現行profileは公開headerを読む`SingleTenantHeaderResourceResolver`、SaaS profileはheaderを無視して`tenantId + docId`をDB lookupする`ServerOwnedDocumentResourceResolver`を使用する。後者は既存行のtenantを確認し、未整備のvisibility/policyRefを`Restricted`/欠損へ倒すためdeny modeで安全側に停止する。server-owned policy metadata store、外部binding resolver adapter、SaaS bundle有効化時のresolver切替は実装済みである。trusted auth edge（ADR-0063 D9）とmock OAuth login（ADR-0064 Phase 1）の基盤は実装済みだが、実binding service／PDP接続、認証session単位のactive tenant正本化は未完了である。SaaS profileは設定上起動できても本番利用gateを満たさない。

`external_http` binding resolverは、server-owned metadataから得た`tenantId`、非秘密`bindingId`、`policyVersion`だけを信頼済みendpointへPOSTする。tenantIdは256文字以下、bindingId/policyVersionは128文字以下のcanonical ID、request全体は64KiB以下に限定し、不正・過大lookupはtransport前に解決失敗へ倒す。応答は`{"policyRef": string}`だけを受理し、64KiB超、余分なfield、空白・制御文字を含む値、2,048文字超、非JSON、4xx拒否、timeout/transport障害は解決失敗とする。raw request/responseや内部例外詳細をclient・監査・logへ反射しない。返却されたpolicyRefはAccessRequest内だけでPDPへ渡し、永続化しない。resolver未設定は従来どおりunavailableとして`Restricted + policy_ref_missing`へ倒す。

外部PDP、監査HTTP、binding/capability resolver、LLM providerのoutbound HTTPは3xx redirectを追跡しない。元のendpointに対するscheme/host検証やallowlistをredirectで迂回させず、Authorization header、tenant context、policyRef、promptを別接続先へ転送しない。redirect応答は各adapterの既存のHTTP/transport失敗契約へ正規化する。

### 10.4 文書アクセス設定管理API（実装済み・SaaS runtime gated）

Tenant Admin向けに次のrouteを実装する。ただし、application lifecycleへ信頼済みSaaS identity resolverとtenant capability resolverが明示注入されない限り`503`で閉じる。single-tenant互換context、公開headerのrole/group、Document owner、`document.write`、Platform operator capabilityを管理権限へ昇格させない。

- `GET /tenant-admin/document-access`
  - active tenant内の文書IDと`visibility`、設定有無、binding状態、policy version、更新時刻、opaque revisionだけを返す。
  - title、本文、card、review集計、tenantId、binding IDを一覧responseへ含めない。metadata未登録は`Restricted / unconfigured`として返す。
  - **SEC-DOC-BOUND-04・keyset pagination**: `limit`（既定100・最大500）と `cursor`（前ページ末尾の文書ID）。`DocumentRow.id` 昇順。次ページがある場合 `X-Next-Cursor` ヘッダーで返す。
- `GET /tenant-admin/document-access/{doc_id}`
  - 一覧項目に加えて、編集対象の非秘密`policyBindingId`だけを返す。responseの`ETag`はbodyの`revision`と一致させる。
- `PUT /tenant-admin/document-access/{doc_id}`
  - bodyは`visibility`、`policyBindingId?`、`policyVersion`だけを受け付ける。extra fieldは拒否し、validation responseへ入力値を反射しない。
  - `policyBindingId`と`policyVersion`は128文字以下のopaque canonical IDに限定し、URL、token、raw policyRef、assertionを受け付けない。`Org/Restricted`はbinding必須、`Public/Unlisted`はbinding保存禁止とする。
  - 一覧または詳細で得たrevisionを`If-Match`へ必須指定する。欠損は`428 document_access_precondition_required`、不一致または同時更新は`409 document_access_conflict`とする。wildcardで競合検査を迂回できない。
  - `If-Match`のDocument metadata revisionとは別に、SaaS共通の`tenantSessionVersion` preconditionを必須とする。session version不一致をmetadata conflictとして再読込・再送せず、先に`tenant_session_changed`へ停止する。
  - metadata更新と`document_access_admin_audit_events`追加を同一transactionで確定する。auditはtenantId、opaque principal/doc ID、action/decision、policy/capability version、server-generated correlation ID、時刻だけを持ち、binding ID、raw policyRef、title、本文、tokenを保存しない。

他tenantにしか存在しないdocIdは`404`とし、list/detail/updateはすべて解決済みTenantContextでDB guardを設定する。APIで`document.policy.manage`を毎回再評価し、capability resolver欠損・不正応答は`503 capability_resolution_unavailable`へfail-closedにする。

本routeは管理APIとtransactional auditの境界を先行実装した状態である。検証済みauth edge、実PDP capability resolver、binding secret store resolver、SaaS profileのdeny-only配線、PostgreSQL RLS実地matrixが揃うまではfrontendから有効化せず、共有SaaS対応済みとは扱わない。

### 10.5 管理面の予約capability

Tenant Adminは`document.policy.manage`、`membership.provision`と`agent.register/revoke`、`audit.read`、Platform Control Planeは`tenant.provision/suspend`を使用する。Workspaceは`document.read/write/export/share`を使用する。3者はapplicationのroute/capability認可surfaceとして分離し、ここでいう認可audienceを新しいJWT `aud` claimの追加と同義には扱わない。Platform capabilityから`document.read`や`document.policy.manage`を暗黙導出せず、Workspace session responseにもPlatform capabilityを反射しない。Platform routeはserver-side trusted sessionに保持されたPlatform capabilityを独立に再認可する。汎用role editor、tenant横断文書検索、support impersonationは追加しない。

### 10.6 single-tenant互換

既存profileは内部`local-default` TenantContextを注入する互換resolverを使用できる。認証済み利用者ではUser、Tenant、TenantMembershipがすべてactiveであることをrequestごとに確認し、停止・欠損時は`tenant_membership_inactive`で拒否する。匿名利用は既存single-tenant互換に限ってmembershipなしを維持する。Document routeはapplication lifecycleで設定された信頼済みresolverだけを呼び、公開Document APIへtenantIdを入力項目として追加せず、header・query・path・payloadのtenant値をresolverへ渡さない。URLのdocIdは解決済みTenantContext内で検索し、同じcontextを外部PDP payload、本文を含まないaudit metadata、PostgreSQL transaction-local DB settingへ伝播する。PostgreSQL RLSはsetting欠落時にread/writeとも行を許可せず、SQLiteではこのDB guardをSaaS境界として扱わない。exportされたtenantIdやmembershipをimport先の権限として採用しない。

## 11. Inquiry bundle lifecycle API（L0 Planned、ADR-0057 / SAAS-TENANT-01）

Inquiry bundleは `DocumentV1` のoptional fieldではなく、W型累積探究のlifecycleを保存する独立リソースである。backendはpayloadの内部schemaを解釈せず、clientが管理するopaque JSON bundleをtenantと `journey_id` の組で保持する。これにより、このAPIの追加は `DocumentV1`、既存のimport/export、またはSafeModeの契約を変更しない。

### 11.1 共通境界

- tenantはrequest body、path、query、headerの利用者入力から決定しない。server-resolved identityとactive membershipから解決されたtrusted `TenantContext` のみを使用する。
- tenant session preconditionがある構成では、既存の `tenantSessionVersion` guardを適用する。trusted tenant contextを解決できない場合はfail-closed（`403 tenant_context_untrusted`）とする。
- `journey_id` は空でない、前後に空白がない、printable、最大256文字のcanonical文字列でなければならない。不正値は `422`（`invalid_journey_id`）とする。
- request bodyはJSONとして有限値だけを受け付け、UTF-8 serialized payloadが **20 MiBを超える場合は保存せず `413`**（`inquiry_bundle_too_large`）とする（`MAX_INQUIRY_BUNDLE_PAYLOAD_BYTES`。`SUI_MAX_DOCUMENT_BYTES` の文書サイズ上限20 MiBと整合。**ドッグフーディングiteration 83で実装値と契約の乖離を検出しapi.mdを修正**）。
- backendはpayloadの未知keyや将来versionを解釈・変換しない。Inquiry bundleのstrict import/export、SafeMode projection、DocumentV1との関係は既存のfrontend/domain契約が保持する。
- **保持契約（DATA-INQUIRY-RETENTION-01 D1=案A）**: 探究bundleは **明示DELETEまで永続** する。自動期限・purge・保持例外（legal hold等）は**存在しない**。期限切れと長期停止は区別されず、backendはpayload内の日時・stage・個人情報有無から期限を推測しない。明示DELETEのみが削除経路で、削除時は本文なし監査を同一transactionで記録する。

### 11.2 Endpoint契約

**POST** `/inquiry-bundles/{journey_id}`

- Request body: JSON object/value（opaque Inquiry bundle payload）
- 前提条件（DATA-INQUIRY-CONCURRENCY-01、案A）:
  - `If-None-Match: *` — **create only**。`tenant_id + journey_id` の行が存在しなければrevision 1で作成し `201 Created` + `ETag: "1"` を返す。既に存在すれば `409`（`inquiry_bundle_conflict`）で上書きしない。
  - `If-Match: "<n>"` — **update only**。`tenant_id + journey_id + revision == n` の単一atomic UPDATEで置換しrevisionをn+1へ増加、`204 No Content` + `ETag: "<n+1>"` を返す。revision不一致・行欠損は `409`（`inquiry_bundle_conflict`）で何も変更しない。
  - 前提条件なし — `428`（`precondition_required`）。
  - `If-Match` がwildcard `*`・複数値・非正整数、または `If-Match` と `If-None-Match` の両方 — `422`（`invalid_if_match` / `invalid_if_none_match` / `conflicting_preconditions`）。
- validation error: `422`（JSONでない、非有限値、または不正な `journey_id`）
- size error: `413`（serialized payloadが20 MiB超）

**GET** `/inquiry-bundles/{journey_id}`

- Response: 保存時のopaque JSON payload（`DocumentV1` ではない）＋ `ETag: "<revision>"` header（server-owned revisionのopaque表現）。
- Not found: `404 Inquiry bundle not found`
- `journey_id` validation、trusted tenant resolution、tenant session preconditionはPOSTと同じである。

**DELETE** `/inquiry-bundles/{journey_id}`

- 前提条件（DATA-INQUIRY-CONCURRENCY-01、案A）: `If-Match: "<n>"` を要求。欠損は `428`（`precondition_required`）、wildcard・複数値・非正整数は `422`。
- `tenant_id + journey_id + revision == n` の単一atomic DELETEで成功したときのみ `204 No Content`。revision不一致・行欠損は `409`（`inquiry_bundle_conflict`）で何も変更しない。
- 削除単位は一つの探究全体（`tenant_id + journey_id`）であり、ラウンド単体や `DocumentV1` の一部は削除しない。
- 対象行の削除と本文なしの削除監査イベントは同一DB transactionで原子的に確定する。監査には `event_id`、server-resolved `tenant_id`、`journey_id`、`principal_id`、action=`inquiry_bundle.delete`、outcome=`deleted`、`occurred_at` のみを記録し、payload本文・カード本文・秘密情報を複製しない。

### 11.3 Migration / persistence model

- `inquiry_bundles`: primary key `(tenant_id, journey_id)`、`payload_json`、`updated_at`、`revision`（server-owned正整数、既定1、DATA-INQUIRY-CONCURRENCY-01案A）。`tenant_id` は `tenants.id` を参照し、PostgreSQLではRLSを有効化してtenant settingと一致する行だけを許可する。
- `inquiry_bundle_deletion_audit_events`: deletion evidence専用のappend record。`tenant_id` は `tenants.id` を参照し、action/outcomeを固定値制約で制限する。PostgreSQLではこの表にもRLSを適用する。
- migration revision: `20260806_0014_add_inquiry_bundle_storage`（前revision `20260720_0013`）。`revision` カラム追加は `20260813_0026_add_inquiry_bundle_revision`（前revision `20260811_0025`）。
- retention期限、保持件数、backend上の履歴削除・purge jobはこの追加だけでは定義・実装しない。したがってInquiry/W型のsupport levelは **`L0: Planned`** のままであり、AC-11を完了扱いにしない。

### 11.4 非対象・互換性

- SafeModeの既定ON、proposal-only、`human_reviewed` の人手限定、import/exportのstrict validation、DocumentV1のschemaは変更しない。
- このAPIは保存境界を追加するだけで、SafeMode未適用の既存ローカルexportを自動的に安全な共有へ昇格させない。共有・exportの安全境界は既存契約に従う。

## 12. 形成履歴（Informative）

2026-04-30〜2026-05-19のCE0/CE1/CE4 mock-first、Stream同期、freeze/handoff形成記録は [API contract formation history](history/api-contract-formation-2026-04-to-05.md) へ分離した。現在の型は`schemas.md`、責務・信頼境界は`02_Architecture/architecture.html`、endpoint/status/error/認証/副作用は本書を正本とする。

## 13. 廃止済みエンドポイントの記録規約（DX-CANON-INTENT-01）

### 13.1 なぜ規約が要るか

ドリフト検出器は「本書に記載があるが実装に無い」という**差分**を見つけるが、その差分が **まだ作っていないから** 生じたのか、**作ったが原則違反として捨てたから** 生じたのかを見分ける情報を持たない。両者は検出器から見て同じ形をしている。

このため実際に事故が起きた。カード重要度評価は `AI-IMPORTANCE-SCORING-01` が製品不変条件（`00_Prompt/domain.md`「AIは内容を採点せず」）との抵触として意図的に削除したのに、2026-08-12に本書へ「未実装（計画）。実装前にこの契約を正本として使用すること」という**誤った注記**が入った。検出結果に意図が乗っていなかったことが原因である。

さらに、契約を本書から単に削除するだけでも別の副作用が出る。**廃止された機能を正当に論じている設計文書（廃止を決めたissue自身を含む）が、一律に「api.mdに無いエンドポイントを参照している」警告になる。** 実測で7件発生した。

### 13.2 書式

廃止したendpointは、本書の該当箇所に次の1行を置く。

```
- 廃止: <METHOD> <path> — <廃止を決めたissue ID>（<廃止日>、<採択した方向>）
```

この行は `check_design_consistency.py` が `RETIRED_ENDPOINT_RE` で読む。効果は次の2点である。

1. 当該endpointを参照する設計文書は警告されない（**廃止として文書化されている**ため、未文書化ではない）。
2. 実装が復活した場合は検出対象として残る（`check_contract_drift.py` のroutes→api.md方向、および不変条件由来の廃止については専用の回帰テスト）。

### 13.3 併記すべきこと

機械可読な1行に加えて、散文で次を書く。**実装可能なrequest/responseスキーマは残さない。** スキーマが残っていれば、それは仕様として読まれる（13.1の事故の直接原因）。

- 廃止の理由（どの不変条件・どの判断に抵触したか）
- 再実装の可否。禁止する場合は、それを固定しているテスト
- 代替手段があればその方針と前提

### 13.4 現在の廃止済み一覧

| endpoint | 廃止日 | 根拠 | 再実装 |
|---|---|---|---|
| POST /ai/assess-card-importance | 2026-08-11 | `AI-IMPORTANCE-SCORING-01`（D-a）。カード本文の序列化が `domain.md` の無条件の不変条件に抵触 | **禁止**。`test_ai_anti_scoring_contract.py` が固定。代替は順位・等級を含まない構造的観測（`llm_input_ir_spec.md` §4 `graph_summary`）に限り、`ADR-0069` の後 |

### 2.10 AIカード統合提案（`POST /ai/suggest-merges`）

`POST /ai/suggest-merges` は、複数カードを一枚へ統合できる可能性を**提案するだけ**のAI APIである。AIはカードを削除・上書き・自動統合しない。04ステップ型の近接カード整理と、複数カードの意味核を保つ核融合法型の統合を候補として扱うが、単なる語彙類似や同一テーマだけでは統合理由にしない。

入力境界は次のとおり。

- SafeModeを既定で維持し、未レビュー本文やPIIをproviderへ送らない。
- `holdState` が付いたカードと `mergedIntoCardId` 済みカードは統合候補から除外する。候補が2枚未満ならproviderを呼ばず空の提案を返す。
- 候補本文、候補間のcard relation、`evidenceLinks` は共有LLM入力IRを正本とする。
- `claimType`、全島所属、`canonicalId` / `repOf`、出典の同一性は `suggest-merges` 専用の構造化文脈として重ねる。
- `sources` の生値はproviderへ送らず、同じ出典を共有しているかを判別できる文書内の不透明参照へ変換する。
- 全候補カードをroute-requiredとして扱う。IR上限により候補本文、候補間relation、候補間evidenceが欠ける場合は、不完全な入力で統合を提案せず422でfail-closedにする。
- provider promptは `LLMRequest.inputs` と同じ構造化入力から描画し、Document側の生本文を同じ意味の迂回入力として使わない。

LLM応答は信頼境界の外側として扱う。新しい提案では `mergeMethod` を必須とし、`near_duplicate`（04ステップ型の近接整理）または `kernel_fusion`（核融合法型の意味核統合）のどちらかを明示する。欠落値・未知値は拒否する。決定論的fallbackは意味核を新規生成しないため `near_duplicate` を付与する。未知ID・重複ID・2件未満・件数上限に加え、hold、既merge、明示的な `negate`、`type=contradicts` のevidence、異なる既知 `claimType`、同じカードを複数候補へ含める競合提案も決定論的に拒否する。人間が判断を記録する際は `mergeMethod` をDocumentのdecision snapshotへ保存するが、旧Documentのdecisionでは欠落を許容し、方式を推測補完しない。

Responseは `SuggestMergesResponse` / `MergeSuggestion` とし、各候補に `groupId`、`cardIds`、`mergedTextDraft`、`mergeMethod`、任意の `rationale` を持つ。`mergeMethod` は `near_duplicate`（類似カードの整理・04ステップ型）または `kernel_fusion`（意味核の統合・核融合法型）の2値で、promptが選んだ方法を人間レビューと後続decisionへ渡す意味属性である。決定論ローカルfallbackは実装上の性質から `near_duplicate` を付与する。保存済みの旧decisionに方式が無い場合は推測補完しない。元カードとlineageを保持しているため、独立した `residuals` フィールドは現契約の必須要素にしない。

## Final-judgement external proposal linkage (AI-ROUTE-HELD-LINKAGE-01 R1)

`POST /ai/check-narrative` and `POST /ai/detect-contradiction` MAY carry `externalProposalRef`:

```json
{"proposalId":"<registered external proposal id>","sourceBundleHash":"<64-char sha256>"}
```

The field is optional so standalone final-judgement calls remain backward-compatible. When supplied, the server MUST bind it to the request document ID and validate `(tenantId, docId, proposalId)`, `origin=external_agent`, and `sourceBundleHash` before any provider request. The server MUST NOT infer a proposal or document from latest-created order, document similarity, or proposal content. `detect-contradiction` therefore requires `doc` whenever `externalProposalRef` is present. Missing registration returns 404; identity/source conflict returns 409; linkage without a document returns 422. R1 is read-only and does not itself transition proposal state.

## Final-judgement system hold (AI-ROUTE-HELD-LINKAGE-01 R2)

An explicitly linked external proposal is changed from implicit `proposed` (no decision-state row) to `held` only when final judgement fails with `ProviderDisabledError`, `provider_unavailable`, or `provider_timeout`. `provider_validation`, request/policy rejection, and response parse/schema failure do not trigger system hold. A standalone final-judgement call without `externalProposalRef` never changes proposal state.

The state transition re-validates `(tenantId, docId, proposalId, sourceBundleHash, origin=external_agent)` inside the transaction. Existing `accepted`, `rejected`, or `held` state wins and is never overwritten. A concurrent first human decision is resolved by the decision-state primary key plus rollback/re-read; system failure cannot roll an accepted/rejected proposal back to held.

System hold does not create a human proposal-decision event. On an actual `proposed -> held` transition, the audit dispatcher receives a content-free `eventType=proposal` event with `previousStatus=proposed`, `newStatus=held`, `transitionSource=final_judgement_unavailable`, `routingStage=final_judgement`, failure code, and available provider/model/transport/trace metadata. Repeated failure against an already-held proposal is idempotent and emits no second transition event.

Recovery does not automatically reopen `held`. A retry that needs a fresh proposed lifecycle registers a new proposal ID; existing authenticated human decision behavior for a held proposal remains unchanged. Availability recovery alone never accepts or publishes a proposal.
