# ADR-0053: サポート診断バンドルの共有境界

- Status: Accepted（2026-07-13、allowlistを安全側へ修正して採択）
- Date: 2026-07-11
- Deciders: Maintainer
- Scope: `03_Implement/frontend/src/`, `04_Documentation/diagnostics.md`, `04_Documentation/operations.md`, `04_Documentation/data_handling.md`, `SUPPORT.md`

## Context

- `PRODUCT-OPS-01` は画面上の復帰導線と、手動でのサポート共有ガイダンス（共有してよい情報/してはいけない情報の区別）を整備済み。ただし利用者が再現情報を1つずつ転記する形であり、サポート切り分けに必要な情報が揃わない・逆に貼りすぎる、の両方向の事故が起きやすい。
- 「診断バンドル」はshare/exportと同等の外部共有リスクを持つ。方針を決めずに実装すると、未加工本文・API key・token・内部URL・個人情報の混入経路になり、SafeModeと共有抑制の価値を裏から毀損する。
- `PRODUCT-OPS-02` は「バンドル形式・自動収集範囲・送信有無を固定する場合は実装前にADR化」と定めている。本ADRはその決定器である。
- 比較した選択肢は次のとおりです。
  - 案A: バンドルを導入しない（現状の手動テンプレート運用のみ）。安全だが、転記漏れ・過剰貼り付けのリスクが残り続ける。
  - 案B: **ローカル生成・メタデータ限定・プレビュー必須のバンドル**（採用案）。含める項目を許可リストで固定し、送信機能を持たない。
  - 案C: 自動収集＋サポート基盤への送信連携。組織ごとの承認・保持・監査要件を製品が先取りすることになり、`PRODUCT-OPS-02` の非目標と衝突するため不採用。

## Decision

案Bを採用する: **診断バンドルは「明示操作・ローカル生成・プレビュー必須・許可リスト方式」に限定し、製品は送信経路を持たない。**

### バンドル契約（diag-bundle.v1）

- 形式はバージョン付き（`diag-bundle.v1`）とし、項目の追加・削除は本ADRの更新を要する。
- 単一のUTF-8 JSONとして生成し、ZIP化しない。未知キーは全階層で拒否する。
- **許可リスト（これ以外は含めない）**は次のとおりです。
  - 安全な文字種・長さへ検証済みのアプリrevision / ビルド識別子、生成時刻。検証できないrevisionは `unknown` とする
  - 正規化済みのブラウザfamily、任意のmajor version、OS family。生のUserAgentは含めない
  - 障害分類コード（`operations.md` のWEB-ENTRY / API-UNAVAILABLE / SAVE-FAILURE / IMPORT-VALIDATION / SHARE-SAFEMODE）と、画面が明示的な障害コンテキストとして保持する直近のHTTP status
  - SafeMode状態（ON/OFF）とprovider種別名（none / local / large-scale / deepseek / unknown。エンドポイントURL・モデル名は含めない）
  - 対象Documentの `version` / `updatedAt` と、カード/島/エッジの**件数のみ**。`Document.id` は含めない
  - アプリ自身のエラーエンベロープのうち、既知のA1契約値 `errorCode` / `contractId` / `occurredAt` のみ。`message` / stack / causeは含めない
- **禁止リスト（レビュー状態を問わず一切含めない）**は次のとおりです。
  - カード・島・narrative・critique・KAフィールド等の本文、Document id / タイトル、entity id / ref、取り込みファイル内容
  - API key / token / password / Authorizationヘッダー、環境変数値、内部URL・接続文字列
  - メールアドレス等の個人識別子、生のUserAgent、referrer、cookie、request/response body、error message、サーバーログ、スクリーンショット（必要時は利用者が既存文書の判断基準に従い別途添付する）
- **SafeMode不変条件**: SafeMode ON/OFFで出力項目・値の露出境界を変えない。変化してよいのは `safeMode` 状態値だけである。
- **生成契約**: 既存のcontent diagnostics workerやreview/export bundleを流用せず、許可された値だけから新しいオブジェクトを組み立てる。生成時に新しいAPI要求を行わず、localStorage / IndexedDB / cacheへ保存しない。
- **UI契約**: 生成は明示ボタンからのみ開始。コピー/ダウンロードの**前に全文プレビューを必ず表示**し、除外済みカテゴリを明記する。プレビューとコピー/ダウンロードは同一の不変JSON文字列を使う。任意の時点でキャンセルでき、閉じた時点でメモリ上のスナップショットを破棄する。自動送信・バックグラウンド収集・定期収集は行わない。
- **文書同期**: `diagnostics.md` / `operations.md` / `SUPPORT.md` の手動共有テンプレートはバンドル導入後も代替経路として残し、同一PRで整合させる。

v1のtop-level keyは `schemaVersion/generatedAt/app/client/incident/runtime/document?/error?` に固定する。`client` は `browserFamily/browserMajor?/osFamily`、`incident` は `classificationCode/httpStatus?`、`runtime` は `safeMode/providerType`、`document` は `version/updatedAt?/counts`、`error` は `errorCode/contractId/occurredAt` だけを持つ。`counts` は `cards/islands/edges` だけを持つ。自由記述フィールドは設けない。

### 非目標

- 自動ログ送信、チケット/サポート基盤連携、組織横断の保持期間・送信先の規定。
- サーバー側でのバンドル組み立て、管理者による他利用者分の収集。
- 監査ログ本文の同梱（`DATA-MAINT-04` / `ADR-0035` の境界に従う）。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | サポート切り分けに必要な再現情報を揃えつつ、転記漏れ・過剰貼り付けの両方向の事故を防ぐ。診断バンドルはshare/exportと同等の外部共有リスクを持ち、未加工本文・API key・token・個人情報の混入経路になってはならない | 機能: 明示ボタンからのみ生成し、コピー/ダウンロード前に全文プレビュー必須。データ: 送信機能を持たずローカル生成に限定 |
| **データ設計** | 許可リスト方式（revision/ブラウザfamily/障害分類コード/SafeMode状態/provider種別/件数のみ）と禁止リスト（本文・Document id・API key・token・個人識別子・生UA・cookie）を固定。SafeMode ON/OFFで出力項目の露出境界を変えない | 業務: 新しい診断項目の追加には本ADRの更新が必要（意図的な摩擦）。機能: 未知キーは全階層で拒否し単一UTF-8 JSONとして生成 |
| **機能設計** | 既存のcontent diagnostics workerやreview/export bundleを流用せず許可された値だけから新オブジェクトを組み立てる。生成時に新しいAPI要求を行わずlocalStorage/IndexedDB/cacheへ保存しない。閉じた時点でメモリ上のスナップショットを破棄 | 業務: プレビューとコピー/ダウンロードは同一の不変JSON文字列を使う。データ: v1のtop-level keyとフィールドを固定し自由記述フィールドを設けない |

## Consequences

- サポートが受け取る情報が一定になり、切り分けが速くなる。利用者は「何が含まれ、何が含まれないか」をプレビューで確認してから共有できる。
- 許可リスト方式のため、新しい診断項目の追加には本ADRの更新が必要（意図的な摩擦）。
- 実装は本ADRのAccepted後に、UI（生成・プレビュー・コピー/ダウンロード・キャンセル）＋e2e検証＋文書同期を1つの実装issueとして切り出す。`PRODUCT-OPS-02` の受入条件がそのままe2e観点になる。

## 実装着手ゲート（2026-07-13）

- unit: strict schema/unknown-key拒否、SafeMode ON/OFF双方の禁止センチネル、プレビューと出力bytesの一致を確認する。
- integration: 生成中の `fetch` / XHR / `sendBeacon` / WebSocketと、localStorage / sessionStorage / IndexedDBへの書き込みが0件であることを確認する。
- e2e: 明示生成、全文プレビュー、キャンセル、コピー、ダウンロード、キーボード/フォーカス、ja/en等価性、禁止項目不在を確認する。
- `diagnostics.md` / `operations.md` / `data_handling.md` / `SUPPORT.md` を同一変更単位で同期する。

## Traceability

- Related: `01_Plans/issues/done/issue-PRODUCT-OPS-02-support-diagnostics-bundle-policy.md`
- Related: `01_Plans/issues/done/issue-PRODUCT-OPS-01-support-diagnostics-error-recovery.md`
- Related: `THREAT_MODEL.md`
- Related: `04_Documentation/diagnostics.md`
- Related: `04_Documentation/operations.md`
- ADR-0047 R-3（非機能境界）: 新しい共有面（診断バンドル）が既存のSafeMode・共有抑制の不変条件を裏から毀損しうるという、既存境界に覆われない新機能の判断である。
- Related: `SUPPORT.md`
- Related: `01_Plans/adr/ADR-0035-privileged-data-lifecycle-boundary.md`
- Related: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`

---
