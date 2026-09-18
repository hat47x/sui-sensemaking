# ADR-0007-future-backlog: 将来バックログ管理

- Status: Accepted
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: `01_Plans/phaseX_future_backlog.md`

## Context

`phaseX_future_backlog.md` で管理していた計画・要件・受入条件を、ADR運用へ移管する。

## Decision

以下を本ADRの正本として採用する。

# phaseX_future_backlog

本ドキュメントは、Phase 1以降の未着手項目を優先度付きで管理する。
`phase2_qualitative_integration.md` の要求ID（RQ）・受け入れ基準（AC）にトレース可能であることを必須とする。

優先度定義:
- P0: 次フェーズで必須
- P1: 次フェーズで高優先
- P2: 中期導入
- P3: 長期検討

---

## Backlog Items（Phase 2）

| ID | タイトル | 優先度 | フェーズ | 対応RQ | 対応AC | DoD（完了条件） |
|---|---|---|---|---|---|---|
| FB-P2A-01 | Island階層モデル導入 | P0 | 2A | RQ-2A-01 | AC-2A-1 | `parentIslandId` の作成/変更/保存/再読込で階層が保持される。 |
| FB-P2A-02 | Collapse/Expand操作 | P0 | 2A | RQ-2A-02 | AC-2A-2, AC-2A-3 | collapseで子要素が描画/ヒットテスト対象外になり、expandで復帰する。 |
| FB-P2A-03 | 代表タイトル表示 | P1 | 2A | RQ-2A-03 | AC-2A-4 | collapsed 親Islandで representative title が表示・編集できる。 |
| FB-P2A-04 | Overview/Detail表示モード | P1 | 2A | RQ-V-01, RQ-V-02 | AC-V-1, AC-V-3, AC-V-4 | UIトグル/ショートカットで同一遷移し、永続データ差分が出ない。 |
| FB-P2B-01 | Similar-card候補提示 | P0 | 2B | RQ-2B-01 | AC-2B-1 | candidate group 一覧と対象Cardを確認できる。 |
| FB-P2B-02 | Manual assisted mergeフロー | P0 | 2B | RQ-2B-02 | AC-2B-2, AC-2B-5 | `採用/部分採用/却下/後で` が保存でき、自動確定しない。 |
| FB-P2B-03 | Representative card決定 | P1 | 2B | RQ-2B-03 | AC-2B-3 | merge 採用時に representative card が必ず1件確定する。 |
| FB-P2B-04 | Merge由来トレーサビリティ | P1 | 2B | RQ-2B-04 | AC-2B-4 | representative card から origin link を辿れる。 |
| FB-P2C-01 | Polygon auto-fit | P0 | 2C | RQ-2C-02 | AC-2C-2, AC-2C-3 | 同一入力で同一polygonを生成し、padding制約を満たす。 |
| FB-P2C-02 | Shape切替UI | P1 | 2C | RQ-2C-01 | AC-2C-1 | `rect/rounded_rect/polygon` の表示・保存・再読込が成立する。 |
| FB-P2C-03 | Polygon検証と互換読み込み | P1 | 2C | RQ-2C-03 | AC-2C-4, AC-2C-5 | 自己交差保存を拒否し、shape欠損Documentを `rect` 解釈で表示する。 |
| FB-P2C-04 | Polygon手動編集（頂点移動） | P1 | 2C+ | RQ-2C-03 | AC-2C-6, AC-2C-7, AC-2C-8, AC-2C-9 | 頂点ドラッグ/追加/削除で編集できる。最小3点と自己交差禁止を常時維持し、不正操作は直前確定状態へロールバックされる。 |

---

## フェーズゲート

- Gate-2A: FB-P2A-01〜04 完了で 2A 終了。
- Gate-2B: FB-P2B-01〜04 完了で 2B 終了。
- Gate-2C: FB-P2C-01〜04 完了で 2C 終了（manual polygon edit 含む）。

---

## 依存メモ

- 2B は 2A と並行可能だが、overview/detail 導線共通化のため 2A 先行を推奨。
- 2C は `02_Architecture/island_shapes.md` の shape 制約を実装前提とする。
- 全項目で review flags と反スコアリング原則を維持する。



---

## Roadmap統合バックログ（公開ROADMAPの実装分解）

本セクションは、ルート `ROADMAP.md` の各項目を、既存バックログ体系（`phaseX_future_backlog.md`）へ統合したものである。  
方針は `ROADMAP.md` を正とし、ここでは **実装アクション / DoD / 状態** を管理する。

状態定義:
- Planned: 未着手
- In Progress: 着手中
- Done: 完了

### Next 1–2 Releases（統合）

| ID | テーマ | 優先度 | 状態 | 具体アクション | DoD（完了条件） | 参照 |
|---|---|---|---|---|---|---|
| FB-RM-UX-01 | 視座プリセット | P0 | Done (2026-02-26) | Explore / Review / Summary を view mode として定義し、ヘッダーのモードトグルと `⌘/Ctrl+1..3` ショートカットで共通導線化。document単位のlocalStorage保存（`sui-sensemaking/view-mode-by-doc`）を導入し、再読込時に既存modeを復元する。`view_mode.ts` / `view_mode.test.ts` / `storage/view_mode.test.ts` を追加し、mode↔preset対応・保存値パースを回帰固定。 | 同一Document再読込時に mode が再現され、UIトグルとショートカットの双方で同一presetへ到達できる | `RQ-V-01` 系 |
| FB-RM-UX-02 | 島の折りたたみ | P0 | Done (2026-02-26) | 階層Islandの collapse/expand と hit-test 制御を実装。collapse状態を island.collapsed と viewState の双方で保持し、descendant連鎖を共通ヘルパーへ統合。Collapse/Expand all を永続値へ同期。 | collapse時に配下要素が描画・選択対象から外れ、expandと再読込で復帰する | `FB-P2A-02` |
| FB-RM-UX-03 | Polygon islands | P1 | Done (2026-02-26) | polygon shape の保存・再読込・互換読込を統合実装。`validateAndUpgradeImportedDocument` で自己交差polygonを自動破棄して card-bounds フォールバックへ退避し、`validateDocumentV2Strict` では自己交差を検証エラーとして拒否。polygon自己交差判定ユーティリティと回帰テストを追加。 | 欠損shapeで `rect` フォールバックしつつ編集継続でき、自己交差polygonが保存・厳格検証で受理されない | `FB-P2C-01..03` |
| FB-RM-UX-04 | SafeMode UI明示 | P1 | Done (2026-02-26) | ヘッダー常設のSafeMode状態バッジ（ON/OFF）を追加し、クリックでShareパネルを開いて詳細を確認できる導線へ統一。Share & Reproduce内でSafeMode説明・export警告・「Share/Review Packでは赤字化が解除不可」の文言を共通ヘルパーで集約。`safe_mode_status.ts` / `safe_mode_status.test.ts` / `SharePanel.test.tsx` を追加し、文言と状態分岐を回帰固定。 | 閲覧者がヘッダーからSafeMode状態を即時確認でき、Share/export警告と解除不可モード表記が矛盾なく統一される | `03_Implement/frontend/src/ui/safe_mode_status.ts` |
| FB-RM-RS-01 | Trace Analytics | P1 | Done (2026-02-27) | Trace Analytics に根拠リンク本数・孤立ノード・出典密度を追加し、UI/Export/Worker golden で同一集計値を参照できるよう統合。Map/Set→配列化時のソート順固定と roundTo4 により決定論を担保。 | 同一入力で同一統計値を返し、追加指標が markdown/export/UI で一貫表示される | `03_Implement/frontend/src/worker/trace_analytics.ts` |
| FB-RM-RS-02 | 構造メトリクス | P1 | Done (2026-03-01) | diagnostics に構造健全性指標（connected components / largest component ratio / degreeP95 / bridge edges / isolation rate / connectivity score / degree skew ratio）を追加し、UI・worker・exportを同一集計経路へ統合。Playwright E2E で Share Panel 経由 export の diagnostics 行と決定論（同一入力2回一致）を確認。 | 指標定義と計算式が `04_Documentation/diagnostics.md` に文書化され、unit/worker/E2E で決定論が固定される | `03_Implement/frontend/src/domain/view/structural_metrics.ts`, `03_Implement/frontend/e2e/diagnostics_structural_metrics.spec.ts`, `04_Documentation/diagnostics.md` |
| FB-RM-RS-03 | Diagnostics安定化 | P1 | Done (2026-02-26) | diagnostics出力schemaVersionを固定し、pre-release方針として `schemaVersion===1` のみ受理。invalid/unsupported version・malformed/array payload・worker message/result envelope不正（他request無視含む）・progress不正・unknown type・diagnostics.error不正・必須フィールド欠落/型不正を検知してfallbackするテストを整備。`04_Documentation/diagnostics.md` を追加。 | current version以外はfallbackで安全に処理継続できる（unit testで固定） | `03_Implement/frontend/src/worker/diagnostics_protocol.ts` |
| FB-RM-SEC-01 | ZIP hardening | P0 | Done (2026-02-26) | import時の path traversal（相対/絶対/UNC/NUL）・zip bomb（総量/件数/単体サイズ/圧縮率）・許可拡張子制限を強化し、Z001/Z002で拒否。`zip_import.test.ts` と review-pack workflow 統合テストで回帰固定。 | 悪性fixtureで拒否・通常fixtureで成功する | `03_Implement/frontend/src/import/zip_import.ts` |
| FB-RM-SEC-02 | Worker安定化 | P1 | Done (2026-02-28) | Bundle export の zip 生成を `bundle_zip.worker.ts` + `bundle_zip_client.ts` へ移管し、worker unavailable 時は scheduler fallback を維持。`buildBundleZipBlob` に cancellation/progress を接続し、`bundle_export.test.ts` で worker/fallback/cancel を回帰固定。 | 大規模 export でも zip 圧縮で UI 応答が阻害されず、abort 時は cancelled として終了できる | `03_Implement/frontend/src/worker/bundle_zip_client.ts` |
| FB-RM-SEC-03 | CI回帰防止 | P0 | Done (2026-02-26) | import/serialization/shape互換の回帰テスト群を `test:regression-guards` として固定し、CIに専用ジョブ `Frontend regression guards (import/serialization/shape)` を追加。branch protection に required check として設定する手順を運用ドキュメントに明記。 | import/serialization/shape互換の回帰テストがCI専用ジョブで常時実行され、required check設定手順が文書化されている | `.github/workflows/ci.yml` |

### Mid-term Vision（統合）

| ID | テーマ | 優先度 | 状態 | 具体アクション | DoD（完了条件） | 参照 |
|---|---|---|---|---|---|---|
| FB-RM-MID-01 | 類似度検出 | P1 | Done (2026-02-28) | `collectMergeCandidates` を導入し、normalized-text / token-signature の2段 heuristic で merge candidate をローカル生成。source/merged済み card を除外し、group/card順序を安定ソートで固定。UI導線は API 呼び出しから deterministic local batch へ置換。 | 同一入力で candidate group と group内 card 順が一致し、候補一覧で対象Cardを確認できる（AC-2B-1整合） | `FB-P2B-01` |
| FB-RM-MID-02 | 統合候補提示 | P1 | Done (2026-02-28) | Merge Suggestions を4アクション（accept/partial/reject/defer）へ更新し、decision log (`mergeSuggestionDecisions`) を document に保存。候補再収集時に latest decision と編集済みテキストを復元し、自動 canonical merge を無効化。Frontend strict validation / backend roundtrip を同期。 | 自動確定なしで人間承認履歴が残り、保存再読込後も decision 状態を再現できる | `FB-P2B-02` |
| FB-RM-MID-03 | 統合ログ監査 | P2 | Done (2026-02-28) | bundle export に `merge_decision_audit.json` を追加し、decisionId/groupId/decisionType/actorType/decidedAt と representative-source 追跡情報を決定論で出力。 | 同一入力で同一監査ログを出力でき、representative と source の追跡が可能 | `FB-P2B-03..04` |
| FB-RM-MID-04 | 階層質的統合 | P1 | Done (2026-03-01) | sub-island（`parentIslandId`）+ 表札（`placardCardId`）+ レベル切替UI（overview/mid/detail）を最小垂直スライスとして導入。missing field fallback を維持しつつ、overviewでは表札カードのみ表示、mid/detailでは全カード表示の制御を実装。collapse/hit-test/selection 回帰テストを維持し、backend roundtrip でも parent/placard 永続化を固定。 | level切替で表示粒度のみ変化し、sub-island/表札カードが保存・再読込で欠落しない | `FB-P2A-*` |
| FB-RM-MID-05 | 構造レベル別export | P2 | Done (2026-03-01) | bundle export に `overview/detail` 粒度を追加。`bundle_manifest.json` へ粒度を記録し、overview時は selected-card trace を抑止。SharePanel で粒度選択ラジオを提供。 | 同一Documentから粒度別bundleを再現可能に生成でき、overviewではtraceを含めず俯瞰用途に固定される | `01_Plans/issues/done/issue-FB-RM-MID-05-structural-granularity-export.md` |
| FB-RM-MID-06 | 共通LLM adapter | P1 | Done (2026-03-01) | provider abstraction（none/local/large-scale）の共通I/Fを固定し、none既定・large-scale明示opt-in（`SUI_LLM_LARGE_SCALE_OPT_IN` + `SUI_LLM_ESCALATION_ENABLED`）・timeout/error/fallback契約を統一。監査最小フィールド（provider/model/transport/requested_at/trace_id/execution_path/fallback_to_none）を切替非依存で固定し、decision確定API非提供を回帰テストで検証。 | provider切替でUI/監査契約が変化せず、外部providerは明示opt-in時のみ利用される | `P-07`, `AI-07-*` |
| FB-RM-MID-07 | 定額/オフラインAI補完（プロンプト+文脈書き出し / 構造化変更指示の適用） | P2 | Planned | キャンバス文脈（カード/島/関係）と生成AI向けプロンプトを一体エクスポートし、外部の定額AI/エージェントの思考結果を (a) ローカルLLMで反映、または (b) スキーマ化された構造化変更指示（パッチ/操作列）を出力させ専用適用ロジックで反映する。SafeMode/HIL を維持し自動確定しない。MVP で API 従量課金が困難な場合への回答。 | 文脈付きプロンプトを書き出せ、外部AIの構造化変更指示を検証のうえ人間承認下でキャンバスへ適用でき、自動確定しないことがテストで固定される。 | ROADMAP 中期D, `FB-RM-MID-06`, `ADR-0049`（2026-07-05 仕様化） |
| FB-RM-MID-08 | TEI Reference Adoption / 移管ゲート | P0 | Planned | 大規模な機能高度化へ進む前に、現行SUIの代表change challengeを固定し、TEI-based vertical sliceへ同じ変更を適用してchange amplification、手書き差分、test / schema /文書同期負荷を比較する。不足はExisting TEI / Plugin・Adapter・Capability / native asset / Core gap candidateへ分類する。 | 同一change challengeの比較Evidence、少なくとも1件のPlugin候補評価、broad / incremental / limited / deferredの移管判断が残り、SUIのDomain / SafeMode / review authorityが二重正本化していない。 | `issue-ARCH-TEI-MIGRATION-01-tei-reference-adoption-and-development-load-validation.md`, TEI `ISSUE-000052` |

### Localization Strategy（統合）

| ID | 優先度 | 状態 | 具体アクション | DoD（完了条件） |
|---|---|---|---|---|
| FB-RM-I18N-01 | P1 | Done (2026-02-28) | `src/i18n/messages.ts` と `src/i18n/translate.ts` を追加し、ImportPanel / SharePanel（Export〜Load document） / safe_mode_status の主要文言を辞書キー経由へ移行。placeholder補間と unknown-key fallback を実装し、UI回帰テストを追加。 | 主要画面の表示文言が辞書経由で解決され、既存コピー互換とfallback挙動がテストで固定される |
| FB-RM-I18N-02 | P1 | Done (2026-03-01) | `src/i18n/locales/{ja,en}.json` を導入し、`t()` を `requested locale -> default locale (ja) -> key` 順で解決する契約へ更新。`validateLocaleMessages` / `resolveTemplate` を追加し、欠損キー時に既定言語へ復元するテストを固定。 | JSON辞書契約とfallback順序がコード/テストで固定され、locale欠損時でもUI文言が既定言語で解決される |
| FB-RM-I18N-03 | P2 | Done (2026-03-02) | 英語UI等価のsmoke/flow E2Eを追加し、SQLite代替経路で再実行を含む通過ログを記録。 | 日本語/英語で機能差がなく、E2E smoke + flow が再実行でも通過する |
| FB-RM-I18N-04 | P2 | Done (2026-03-01) | view単位言語設定を保存（view metadata + localStorage + URL/read-only優先） | view切替・再読込後も表示言語が決定論で復元される |
| FB-RM-I18N-05 | P2 | Done (2026-03-01) | `src/i18n/document_locale_invariance.test.ts` を追加し、hash対象を `document.json` の canonical JSON のみに固定。`ja→en→ja`・URL優先・read-only の各シナリオで `document hash 不変` と `view metadata のみ変化` を分離検証し、漏洩時の層別診断（ui-state/view-metadata/document-payload）をログ化。CIジョブ `Frontend i18n document hash regression` と `npm run test:i18n-regression` を追加。 | 言語変更前後でdocument hashが不変、差分発生時は漏洩レイヤを特定できる |
| FB-RM-I18N-06 | P2 | Done (2026-03-01) | `locale_conversion_guard` と `locale_conversion_guard.test.ts` を追加し、SafeMode中の翻訳遮断・fetch/XHR/Worker監視・telemetry/audit fail-safe・timeout/adapter error時のログ秘匿を回帰固定。CIジョブ `Frontend i18n safe-mode leakage guards` と `npm run test:i18n-security` を追加。 | SafeMode ONで外部送信ゼロ、ログマスキング違反を検知、CIで再発防止できる |

### Publishing / Access Control（統合）

| ID | 優先度 | 状態 | 具体アクション | DoD（完了条件） |
|---|---|---|---|---|
| FB-RM-PUB-01 | P1 | Done (2026-03-03) | Public / Unlisted / Org / Restricted を pack/view metadataへ追加し、viewは `Restricted`・packは `Public` の欠損fallback、enum外値のstrict reject、SafeMode/readOnly優先順を architecture/schema/API/実装/テストで固定。 | schema検証と既存データ互換を両立し、安全優先順位を維持したまま保存/再読込を回帰固定 |
| FB-RM-PUB-02 | P1 | Done (2026-03-01) | URL query (`readonly/readOnly/isReadOnly/mode=readonly`) から read-only モードを解決し、`applyDocumentChange` ガードで編集系更新を一括抑止。Suggestion / Merge Suggestions の編集導線をdisabled化し、サイドパネルとヘッダーに read-only 状態を明示。 | 読み取り専用時に編集系更新が保存されず、UIで状態が明示される |
| FB-RM-PUB-03 | P1 | Done (2026-03-01) | `publish:static` パイプラインを追加し、`index.html + assets + packs` の最小公開物を生成。`packs/index.json` から公開packを自動読込し、`safeMode=true` を強制。生成済み `index.html` は `readonly=1` URLへ自動遷移。運用手順を `operations.md` / `03_Implement/README.md` に追記。 | 生成物のみで静的サーバ閲覧が成立し、SafeMode既定ON + read-only 公開モードで再現手順が文書化される |
| FB-RM-PUB-04 | P2 | Done (2026-03-01) | `AccessControlAdapter` 抽象I/F（roles/groups/policyRef）を追加し、API本体は `resolve_access_decision` 呼び出しへ限定。`noop` 既定 + `mock` 契約アダプタを導入し、fail-safe（safeMode/readOnly/policyRef）と監査最小項目をテストで固定。 | 本体にRBAC評価ロジックを埋め込まず、adapter未設定時も既存挙動を維持したまま外部委譲契約で運用できる |
| FB-RM-PUB-05 | P2 | Done (2026-03-01) | 閲覧/エクスポート監査イベントを送信抽象（noop/http）経由で連携し、設定ON/OFF・SafeMode送信制御・fail-open queue/dropを導入。運用手順（鍵/エンドポイント/障害時）を整備。 | 監査連携のON/OFF切替、OFF時副作用ゼロ、送信失敗時も本体機能継続が確認できる |

### 完了済み（文書統合）

| ID | 状態 | 内容 | 完了条件 |
|---|---|---|---|
| FB-RM-DOC-01 | Done | ルート文書の位置づけ（公開コミュニケーション）と更新タイミングの明確化 | `README.md` に文書役割マトリクスが存在し、更新運用ルールが定義済み |
| FB-RM-DOC-02 | Done | ROADMAPのLLM方針を共通アダプタ（local/large-scale）へ更新 | `ROADMAP.md` と `01_Plans` 側の対応項目が整合している |


## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | Phase 1以降の未着手項目を優先度付きで管理し、将来バックログを追跡可能にする。要求ID（RQ）と受け入れ基準（AC）へのトレース可能性を必須とする | 機能: 未着手項目を優先度付きで管理し、受入条件をACで固定。データ: Phase 1以降の拡張候補を一箇所で追跡可能にする |
| **データ設計** | `phaseX_future_backlog.md`の内容を本ADRへ移管し旧文書は廃止して参照を統一。既存リンクは本ADRパスへ更新 | 業務: 将来拡張の計画判断をADR履歴で追跡する。機能: 各FB項目は要求ID（RQ）と受け入れ基準（AC）にトレース可能にする |
| **機能設計** | 将来バックログを参照しやすい単位に移管し、未着手項目の優先順位付けの入力として利用できるようにする | 業務: 将来拡張の実装判断を本ADRへ統一する。データ: 旧`phaseX_future_backlog.md`は廃止し情報欠落なく本ADRへ移管 |

## Consequences

- 旧文書 `phaseX_future_backlog.md` は廃止し、本ADRへ参照を統一する。
- 既存リンクは `01_Plans/adr/ADR-0007-future-backlog.md` へ更新する。

## Traceability

- Source: `01_Plans/phaseX_future_backlog.md`
- Supersedes: `01_Plans/phaseX_future_backlog.md`


#### FB-RM-UX-01 実装TODO（完了ログ）

- [x] Explore / Review / Summary を `ViewMode` として型定義し、default preset との対応を固定。
- [x] ヘッダーに view mode トグル（3分割）を追加。
- [x] `⌘/Ctrl+1..3` で mode 切替ショートカットを実装。
- [x] `sui-sensemaking/view-mode-by-doc` に document単位で mode を保存。
- [x] document読込時に保存済み mode を復元。
- [x] `view_mode.test.ts` / `storage/view_mode.test.ts` で mode変換・保存値検証を追加。



#### FB-RM-RS-01 実装TODO（完了ログ）

- [x] `TraceAnalytics` 型へ `evidenceLinkCount` / `isolatedNodeCount` / `isolatedNodeIds` / `sourceDensity` を追加し、互換フィールドを維持した。
- [x] `computeTraceAnalytics` で根拠リンク本数・孤立ノード・出典密度を決定論ソート（ID昇順）で算出するようにした。
- [x] `buildTraceAnalyticsMd` に追加指標を出力し、孤立ノードがある場合のみ `## Isolated nodes` セクションを生成するようにした。
- [x] `trace_analytics.test.ts` で追加指標・孤立ノード順序・決定論・markdown出力の回帰テストを先行追加して固定した。
- [x] `worker_golden.test.ts` と fixture `trace_analytics_c1.md` を同期し、worker経路でも追加指標の出力を固定した。
- [x] SidePanel の Trace Analytics 表示へ追加指標（Evidence links / Isolated nodes / Source density）を反映した。

#### FB-RM-RS-02 実装TODO（完了ログ）

- [x] `StructureMetrics` に `connectedComponentCount` / `largestComponentRatio` / `degreeP95` / `bridgeEdgeCount` / `isolationRate` / `connectivityScore` / `degreeSkewRatio` を追加した。
- [x] `computeStructureMetrics` で無向単純グラフの正規化（自己ループ除外・重複排除・ID昇順ソート）を導入し、丸め規則 `round(value * 10_000) / 10_000` を固定した。
- [x] `diagnostics_compute.ts` と `SidePanel.tsx` を更新し、worker/export/UI のすべてで同一構造メトリクス値を表示するよう統一した。
- [x] `structural_metrics.test.ts` / `worker_golden.test.ts` / fixture `tests/fixtures/worker/diagnostics.md` を更新し、追加指標と決定論を回帰固定した。
- [x] Playwright E2E `e2e/diagnostics_structural_metrics.spec.ts` を追加し、Share Panel 経由 export の `diagnostics.md` に追加指標が含まれること、および同一入力2回で出力一致することを固定した。
- [x] E2E未実装だった原因分析と再発防止を `03_Implement/frontend/docs/e2e_testing.md` に反映した（issueメモ依存を解消）。

#### FB-RM-RS-03 実装TODO（完了ログ）

- [x] Protocol: `diagnosticsData.schemaVersion` を current=1 として固定。
- [x] Validation: unsupported/invalid schema version を検知し fallback。
- [x] Validation: payload/result envelope の malformed/array を検知。
- [x] Validation: progress / unknown type / diagnostics.error 不正を検知。
- [x] Isolation: 他requestIdメッセージは無視。
- [x] Required fields: `recommendations` / report objects / `diagnosticsMd` 欠落を検知。
- [x] Docs: `04_Documentation/diagnostics.md` に schemaVersion/互換/fallback を明記。
- [x] Tests: `diagnostics_protocol.test.ts` / `diagnostics_client.test.ts` を更新して回帰固定。


#### FB-RM-SEC-01 実装TODO（完了ログ）

- [x] Path validation: `../` に加えて absolute path / Windows drive path / UNC path / NUL byte を拒否。
- [x] Zip bomb guard: file count / per-file size / total uncompressed size / compression ratio の上限を導入。
- [x] Extension policy: `.json/.md/.png` 以外を取り込み対象から除外（警告件数に加算）。
- [x] Tests: `src/import/zip_import.test.ts` に悪性ケース（絶対パス・圧縮率・サイズ上限）を追加。
- [x] Integration: `src/diff/review_pack_workflow.integration.test.ts` の悪性ZIP拒否を維持。





#### FB-RM-SEC-02 実装TODO（完了ログ）

- [x] `bundle_zip_protocol.ts` を追加し request/progress/result/cancel/error のメッセージ契約を定義した。
- [x] `bundle_zip.worker.ts` を追加し、zip圧縮を off-main-thread で実行する経路を実装した。
- [x] `bundle_zip_client.ts` を追加し、worker unavailable 時は main-thread scheduler fallback へ退避するようにした。
- [x] `buildBundleZipBlob` を worker client 経由へ置換し、abort signal/progress 連携を実装した。
- [x] `App.tsx` の bundle export で zip progress を表示し、cancelled を失敗扱いしないようにした。
- [x] `bundle_export.test.ts` に worker/fallback/cancel 回帰を追加し、`test:regression-guards` で通過確認した。

#### FB-RM-SEC-03 実装TODO（完了ログ）

- [x] Frontend向けに import/serialization/shape互換の回帰テスト対象を選定。
- [x] `03_Implement/frontend/package.json` に `test:regression-guards` スクリプトを追加。
- [x] `.github/workflows/ci.yml` に専用ジョブ `Frontend regression guards (import/serialization/shape)` を追加。
- [x] CIジョブ名を branch protection の required check に設定可能な安定名に固定。
- [x] `04_Documentation/release.md` に required check 設定手順（GitHub UI）を追記。
- [x] ローカルで `test:regression-guards` を実行し、通過を確認。


#### FB-RM-UX-04 実装TODO（完了ログ）

- [x] ヘッダーに SafeMode 状態バッジ（ON/OFF）を常設し、1クリックで Share パネルへ遷移できるようにした。
- [x] Share & Reproduce 内の SafeMode 説明・export警告・解除不可モード表記を共通ヘルパーで統一した。
- [x] SafeMode ON/OFF の文言分岐を `safe_mode_status.test.ts` で固定した。
- [x] `SharePanel.test.tsx` で SafeMode 表示の回帰テストを追加した。


#### FB-RM-UX-02 実装TODO（完了ログ）

- [x] collapse対象判定を `collapse_visibility.ts` の共通ヘルパーへ集約し、親collapse時のdescendant連鎖を固定した。
- [x] `collapse_visibility.test.ts` を拡張し、階層Islandでの collapsed island ids / hidden card ids を回帰固定した。
- [x] Island単位の collapse/expand 操作時に `island.collapsed` 永続値を更新するよう `App.tsx` を修正した。
- [x] Collapse all / Expand all 操作で UI状態と永続状態が乖離しないよう同期した。
- [x] `npm run test -- src/domain/view/collapse_visibility.test.ts` / `npm run typecheck` / `npm test` の通過を確認した。
- [x] collapse永続更新ロジックを `collapse_state.ts` に分離し、単体/全体collapse更新の純粋関数テストを追加した。


#### FB-RM-UX-03 実装TODO（完了ログ）

- [x] `validateDocumentV2Strict` に polygon 自己交差検証を追加し、保存時バリデーションで拒否するようにした。
- [x] `validateAndUpgradeImportedDocument` に自己交差polygon除外を追加し、互換読込時は card-bounds フォールバックで編集継続可能にした。
- [x] `polygon_self_intersection.ts` を追加して判定ロジックを共通化し、幾何判定を再利用可能にした。
- [x] `validate_doc.test.ts` / `validate.test.ts` / `polygon_self_intersection.test.ts` を追加・更新し、自己交差ケースの回帰を固定した。
- [x] E2E追加有無を確認し、本改修は Domain validation（非UI導線）中心で Playwright シナリオ追加対象外だったため、PRに未追加理由と代替検証（unit + regression-guards）を明記する運用へ修正した（ADR-0018連携）。
- [x] Playwright E2E `e2e/polygon_import_validation.spec.ts` を追加し、自己交差polygonを含む document.json の取込→置換→bundle export で shape が除去されることを実動作で確認した。


#### FB-RM-MID-02 実装TODO（完了ログ）

- [x] `MergeSuggestionsPanel` を accept/partial/reject/defer の4アクションに更新。
- [x] `mergeSuggestionDecisions` を `DocumentV2` に追加し、decision append log を保存可能化。
- [x] decision記録時に自動 canonical merge を実行しないフローへ変更。
- [x] 候補再収集時に latest decision / edited text を復元するよう `App.tsx` を更新。
- [x] Frontend strict validator (`validate_doc.ts`) に decision schema 検証を追加。
- [x] Backend `DocumentV2` モデルと docs roundtrip test を更新し、PUT/GETで decision log 保持を確認。


#### FB-RM-I18N-01 実装TODO（完了ログ）

- [x] `src/i18n/messages.ts` を追加し、UI文言キーと既定辞書（ja）を定義。
- [x] `src/i18n/translate.ts` を追加し、placeholder補間と unknown-key fallback を実装。
- [x] `ImportPanel.tsx` の表示文言を辞書キー参照へ置換。
- [x] `safe_mode_status.ts` / `SharePanel.tsx`（Export〜Load document）を辞書キー参照へ置換。
- [x] `translate.test.ts` / `ImportPanel.test.ts` / 既存 safe_mode_status・SharePanel テストで回帰を固定。


#### FB-RM-MID-03 実装TODO（完了ログ）

- [x] `src/domain/merge_decision_audit.ts` を追加し、merge decision から監査エントリ（decisionType/actorType/representative/source）を生成する決定論ロジックを実装。
- [x] `src/export/bundle_export.ts` を更新し、bundle に `merge_decision_audit.json` を常時同梱。
- [x] `src/domain/merge_decision_audit.test.ts` を追加し、代表カード解決と source 追跡・時系列安定ソートを回帰固定。
- [x] `src/export/bundle_export.test.ts` を拡張し、bundle出力に監査JSONが含まれることと payload 内容を回帰固定。
- [x] `04_Documentation/operations.md` に bundle監査ファイルの運用メモを追加。


#### FB-RM-I18N-02 実装TODO（完了ログ）

- [x] locale JSONフォーマット（`src/i18n/locales/ja.json`, `en.json`）を追加。
- [x] `t()` の解決順序を `requested locale -> default locale (ja) -> key` へ固定。
- [x] `validateLocaleMessages` で JSON object + string value 契約を検証。
- [x] `translate.test.ts` に locale fallback / unknown key / 契約検証テストを追加。
- [x] Import/Share/SafeMode 文言の回帰テストを再実行し互換を確認。


#### FB-RM-PUB-02 実装TODO（完了ログ）

- [x] `src/domain/policy/read_only.ts` を追加し、queryパラメータから read-only 判定を行う共通ロジックを実装。
- [x] `src/domain/policy/read_only.test.ts` を追加し、truthy/falsy と mode 指定の判定を回帰固定。
- [x] `App.tsx` の `applyDocumentChange` に read-only ガードを追加し、編集更新を一括拒否するよう統合。
- [x] `SuggestionPanel` / `MergeSuggestionsPanel` の編集導線を read-only 時に disabled 化。
- [x] `SidePanel` とヘッダー subtitle に read-only 状態表示を追加。


#### FB-RM-MID-05 実装TODO（完了ログ）

- [x] `bundle_export.ts` に `exportGranularity`（overview/detail）を導入し、`bundle_manifest.json` 出力を追加。
- [x] overview時は selected-card trace の生成を抑止し、detail時のみ trace を出力。
- [x] SharePanel の bundle export セクションに granularity 選択UI（radio）を追加。
- [x] `App.tsx` から bundle export context へ granularity を伝搬。
- [x] `bundle_export.test.ts` / `SharePanel.test.ts` を更新し、manifest/trace抑止/UI文言を回帰固定。
- [x] `04_Documentation/operations.md` に運用メモを追記。


#### FB-RM-MID-04 実装TODO（完了ログ）

- [x] Island に `parentIslandId` / `placardCardId` を保持する互換実装（missing field fallback）を frontend import/validation で維持した。
- [x] SidePanel から parent island / placard card を編集可能にし、保存後の再読込で復元される導線を実装した。
- [x] 構造レベル切替（overview/mid/detail）を View Controls とショートカット（Alt+Shift+1/2/3）で提供し、表示粒度のみを切り替える挙動を実装した。
- [x] overview で placard 以外カードを非表示化する可視性ヘルパーとテストを追加し、データ本体を破壊しないことを回帰固定した。
- [x] collapse_visibility/hierarchy_visibility/hierarchy_level の既存回帰を維持し、backend docs roundtrip に parent/placard 永続化アサーションを追加した。


#### FB-RM-I18N-04 実装TODO（完了ログ）

- [x] view locale 解決順序を `URL(locale/lang/uiLocale) -> view metadata -> localStorage(doc+view) -> default(ja)` に固定。
- [x] read-only 時は locale 永続化を抑止し、URL 指定時は上書き保存しない責務を明確化。
- [x] `viewState.locale` を view metadata schema/export/import に追加し、不正 locale を validation で拒否。
- [x] App 初期化・view切替・pack/view import で同一 resolver を使用し、race condition を回避。
- [x] `view_locale_resolution.test.ts` で view切替・再読込・欠損時fallback を回帰固定。
