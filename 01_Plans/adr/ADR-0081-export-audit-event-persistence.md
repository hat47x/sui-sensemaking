# ADR-0081: export/share監査イベントの永続化設計

- Status: Proposed
- Date: 2026-09-07
- Deciders: Maintainer
- Scope: `03_Implement/backend/src/sui_sensemaking_api/models.py`, `03_Implement/backend/src/sui_sensemaking_api/audit.py`, `03_Implement/backend/src/sui_sensemaking_api/routes/docs.py`, `02_Architecture/schemas.md`, `02_Architecture/api.md`
- Norms: `ADR-0035`（高権限データライフサイクル境界）, `GENAI-GOV-01`（`02_Architecture/value_traceability.md` §2.9）

## Context

`DATA-MAINT-05`（A1: share/export event lookup、本文を含まない監査メタデータを読み取り専用で一覧・検索するAPI）は、`DATA-MAINT-04`が候補として推奨した機能である。しかし現行の監査構成は送出専用であり、読み出しAPIが照会できるローカル保存が存在しない。

- `audit.py`の`AuditDispatcher`は`NoopAuditTransport`（既定・破棄）または`HttpAuditTransport`（外部SIEM等への送信）のいずれかで、`build_event()`で作ったイベントをローカルDBへ保存しない。
- ローカルで唯一の監査テーブル`document_access_admin_audit_events`は`CheckConstraint("action = 'document.policy.update'")`により`document.policy.update`専用に固定されており、export/shareイベントを保持する設計ではない。
- `routes/docs.py`の`POST /docs/{doc_id}/export-audit`はイベントをdispatcherへ送出するだけで、読み出しAPIが照会できる保存先を持たない。

`ADR-0035`は「監査ログ閲覧」を次のように制限している（Decision表）。

> 本文を含まないメタデータ閲覧候補に限り、内部issueで検討できる。本文、未レビュー情報、**保持方針**、横断検索を含む場合は別ADRを必須とする。

`DATA-MAINT-06`（本ADRの起票元issue）が扱う設計項目には保持ポリシー（保持期間・保持件数上限・削除手順）が含まれるため、`ADR-0035`自身の規定により内部issueだけでは完結せず、本ADRを必須とする。

比較した主要選択肢（保存先）は次のとおりである。

1. **新規専用テーブル**（例: `document_export_audit_events`）を追加する。
2. `document_access_admin_audit_events`のCHECK制約を緩めてexportイベントも受け入れる。
3. `AuditDispatcher`のtransport層（`NoopAuditTransport`/`HttpAuditTransport`）自体をローカル永続化に置き換える。

案2は却下する。同テーブルは`ADR-0059`の文書ポリシー変更監査という単一の意味に既に固定されており（CHECK制約・docstringとも`document.policy.update`専用）、export/shareという異なる業務事象を後から混入させると、既存の「1テーブル1意味」という設計を損ない、将来の`action`列拡張のたびに無関係な制約追加を強いる。

案3も却下する。`AuditDispatcher`のtransportは外部SIEM/observability基盤への転送を意図した層であり、`DATA-MAINT-05`が要求する「製品自身の読み出しAPI」とは別の関心事である。transportをローカル永続化に転用すると、監査送信の失敗を許容する現行の挙動と、読み出しAPI向けの永続化保証（読み出し可能であることが機能要件）という異なる非機能要件が同じコードパスへ混在する。

## Decision

**案1（新規専用テーブル）を採用する。** 既存`document_access_admin_audit_events`が確立した「テナント複合FK + FORCE RLS + 返却許可リスト + 本文/秘密情報/生識別子を持たない」という設計パターンをそのまま再利用し、export/share専用の新規テーブルとして追加する。

- テーブル名: `document_export_audit_events`（案）。
- 列: `event_id`（主キー、opaque）、`tenant_id`・`doc_id`（`documents`への複合FK、既存パターンと同一）、`event_type`（`share` | `export`）、`export_kind`、`safe_mode`（bool）、`result`、`reject_reason_code`（nullable）、`trace_id`（nullable）、`occurred_at`。
- 本文、review pack本文、共有先個人情報、policyRef生値は列として持たない（`DATA-MAINT-05`の停止条件・`ADR-0035`の本文禁止境界と同一）。
- `POST /docs/{doc_id}/export-audit`は、既存の`AuditDispatcher.build_event()`による送出（transport送信）に**加えて**、この新規テーブルへ同じ許可リスト列だけを挿入する。transport送信の成否とテーブル挿入の成否は独立に扱い、一方の失敗が他方を道連れにしない（失敗しても処理を止めない原則を維持）。
- `DATA-MAINT-05`の読み出しAPIはこの新規テーブルだけを照会し、本文語句を検索条件に受け付けない。
- PostgreSQLでは`document_access_admin_audit_events`と同じ`ENABLE + FORCE ROW LEVEL SECURITY`を設定し、`apply_database_tenant_id()`によるトランザクション内だけで有効なテナント範囲の設定を経由してのみ行を読み書きできるようにする（`SAAS-TENANT-01`で確立済みの手順をそのまま踏襲する）。

**保持ポリシー: 製品としての自動削除・標準保持期間は採用しない。** `ADR-0035`の既存決定（「保持期限管理は組織判断事項として扱う。製品の自動削除や標準保持期間は採用しない」）をexport監査イベントにもそのまま適用する。これは新しい判断ではなく、既存`document_access_admin_audit_events`・`admin_audit_events`の両テーブルが現在すでに保持している挙動（TTL/自動削除機構を持たない）と同型である。保持・削除が必要な導入組織は、自組織のDB運用手順で対応する。

**`DX-BACKEND-CE4-01`との関係: 無関係、混在させない。** CE4監査完全性トラッカー（`_ce4_audit_event_tracker`）は`query→bundle→proposal→apply`の一連完了をプロセス内メモリ（TTL 24h・LRU 10,000件）で追跡する短命な整合性チェック機構であり、本ADRが扱う「export/shareイベントの永続的な監査証跡」とは目的が異なる。前者は必要期間が短く、意図的にプロセス内で完結してよい。後者は`DATA-MAINT-05`の読み出しAPIが後から照会するため、定義上永続化が必須である。本ADRはCE4 トラッカーのロジック・保存先を一切変更しない。

非目標は次のとおりである。

- `DATA-MAINT-05`のAPI実装そのもの（本ADR採択後に着手する）。
- `document_access_admin_audit_events`・`admin_audit_events`の既存スキーマ変更。
- CE4監査完全性トラッカーの保存先変更（プロセス内メモリのまま）。
- 保持期間・削除義務の組織別既定値の策定（`ADR-0035`の非目標を継承する）。

## Three-Element Verification（ADR-0067。全ADRで必須）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | Audit operatorが、共有/exportの発生有無と安全境界（SafeMode・result・拒否理由）を本文抜きで確認できる。保持・削除は組織判断のまま製品既定値を持たない（`ADR-0035`継承） | データ: 本文・秘密情報・生IdP識別子・policyRef生値を列として持たない。機能: 読み出しAPIは`event_type`/`safe_mode`/`result`等の許可リストのみ返し、自動削除ジョブを実装しない |
| **データ設計** | `document_export_audit_events`を新設し、`tenant_id + doc_id`複合FK・FORCE RLSで既存`document_access_admin_audit_events`と同型の境界を持たせる。既存2テーブルとは`action`/`event_type`の意味が異なるため同一テーブルへ混在させない（同一関係の二重表現を避ける） | 業務: テナント境界を越えた閲覧を不可能にする。機能: `apply_database_tenant_id()`経由以外の直接クエリを許さない |
| **機能設計** | `POST /docs/{doc_id}/export-audit`が既存のtransport送出に加えて本テーブルへ挿入する。`DATA-MAINT-05`のGET系読み出しAPIが本テーブルのみを照会し、本文検索条件を受け付けない | 業務: 許可リスト外の列を追加しない。データ: 挿入の失敗がtransport送信の成否と独立（失敗しても処理を止めない） |

## Consequences

期待される効果は次のとおりである。

- `DATA-MAINT-05`（A1 読み出しAPI）が、保存先未定という前提条件を解消して着手可能になる。
- 既存`document_access_admin_audit_events`で実証済みのテナント境界パターン（複合FK + FORCE RLS）を再利用するため、新規のセキュリティ設計判断を追加しない。
- 保持ポリシーを`ADR-0035`の既存決定へ一本化し、二重の方針決定を作らない。

想定される副作用/制約は次のとおりである。

- 監査イベントがテナントごとに無期限に蓄積される（`ADR-0035`が明示的に許容している範囲）。大規模テナントでの行数増加に伴うインデックス設計は実装issueで扱う。
- transport送信（外部SIEM）とローカル永続化の二重書き込みになるため、両者の内容不一致（例: transport送信は成功したが挿入は失敗）が起こり得る。これは失敗しても処理を止めない原則上許容するが、実装issueで観測可能性（ログ）を用意する。

移行時に必要な対応は次のとおりである。

- `DATA-MAINT-06`をこのADR採択後に`DecisionStatus=Fixed`相当として扱い、`DATA-MAINT-05`のDraft→Open判断をMaintainerが行う。
- `02_Architecture/schemas.md` / `api.md`に新規テーブルと読み出しAPI契約を同期する（`DATA-MAINT-05`実装時）。

## Traceability

- Related: `01_Plans/issues/issue-DATA-MAINT-06-export-audit-event-persistence.md`
- Related: `01_Plans/issues/issue-DATA-MAINT-05-share-export-event-lookup.md`
- Related: `01_Plans/adr/ADR-0035-privileged-data-lifecycle-boundary.md`
- Related: `01_Plans/issues/done/issue-DATA-MAINT-04-metadata-only-audit-viewing.md`
- Related: `01_Plans/issues/done/issue-DX-BACKEND-CE4-01-audit-tracker-unbounded-memory.md`（関係の否定を明示するための参照）
- Related: `01_Plans/issues/done/issue-SEC-ADMIN-PLANE-03-admin-operation-audit-trail.md`（`document_access_admin_audit_events`パターンの由来）
- Supersedes: N/A
- Superseded by: N/A
- Derived-from: `01_Plans/issues/issue-DATA-MAINT-06-export-audit-event-persistence.md`

---
