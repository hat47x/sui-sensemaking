# ADR-0033: MVPデータサポート境界と保守方針

- Status: Accepted
- Date: 2026-05-17
- Deciders: Project Maintainers
- Scope: `01_Plans/adr/ADR-0033-mvp-data-support-and-maintenance-boundary.md`, `02_Architecture/data_model_operations_overview.html`, `02_Architecture/schemas.md`

## Context

sui-sensemakingの設計文書には、MVPで実際に利用する最小スキーマと、AI連携・レビュー帰属・監査連携・将来拡張の契約が同じ `02_Architecture` 層に存在している。

一方、現行MVPの永続化は、ドキュメント全体をJSONスナップショットとして保存し、補助的にユーザー/ID対応表とマージ判断ログを持つ構成である。Card、Edge、Island、Narrative、ReviewAttributionなどは論理データとして重要だが、多くは `Document` 内の埋め込み構造であり、個別CRUDや管理画面を持たない。

この境界が曖昧なままだと、次の問題が起きる。

1. スキーマに存在する型を、標準運用で保守できるデータと誤解しやすい。
2. 利用者、レビュアー、運用者、セキュリティ担当者の責任範囲が読み取りにくい。
3. データ削除、棚卸し、復旧、所有者移管など、組織運用に必要な作業がMVP内で保証済みに見えてしまう。
4. DocumentV2やAPIの契約差分を、実装修正なしに文書だけで吸収しやすくなる。

## Decision

MVPでは、データサポート境界を次の4区分で管理する。

| 区分 | 意味 | 代表例 |
| --- | --- | --- |
| 運用サポート | 標準API/UIで通常運用できる | `Document` スナップショット、admin provisioning、merge decision log append/read |
| 埋め込み限定 | `Document` 内には保存されるが、個別CRUDは持たない | Card、Edge、Island、Narrative、ReviewAttribution |
| 派生/読み取り中心 | 保存済みデータやリクエストから生成され、保守対象ではない | SimilarCandidateGroup、ContextBundle、audit event |
| 契約のみ/将来拡張 | 型やI/Fは固定するが、MVPでは完全保守しない | CE契約、差分同期、証跡・根拠リンクの完全管理 |

`02_Architecture/data_model_operations_overview.html` を、MVPデータモデル、論理ER、CRUDサポート表、ステークホルダー別運用境界の俯瞰文書として追加する。この文書は `schemas.md` や `api.md` の詳細を置き換えず、「実際に運用できる範囲」を読むための入口とする。

採用理由は、MVPのスナップショット保存方針を維持しつつ、製品化に必要なデータ運用課題を隠さず分離できるためである。現段階で全エンティティを正規化し、個別CRUDを実装すると、UI、API、移行、監査の範囲が一気に広がり、MVPで確認したい価値よりも管理機構が先行する。

非目標は次のとおりです。

- このADRだけで新しい永続テーブルや管理画面を追加しない。
- Card/Edge/Islandなどの個別CRUDをMVP必須にしない。
- 監査ログ閲覧、削除/保管期限、所有者移管、復旧手順を完了扱いにしない。
- 契約ドリフトを文書上の言い換えだけで解決しない。実装/API/型の不一致は内部issueで扱う。


## Support / Maintenance / Contract Boundary Table

| 項目 | Support Level（MVP標準運用） | Maintenance Boundary（保守責務） | Contract Boundary（契約責務） | 含む | 含まない |
| --- | --- | --- | --- | --- | --- |
| Document snapshot (`documents.payload_json`) | L1: Supported | Platform operatorが可用性/バックアップ、Document ownerが内容責任 | `DocumentV1/V2` の往復互換を維持 | `GET/PUT /docs/{doc_id}`、全体保存/復元 | 個別Card/Edge CRUD、部分修復API |
| Embedded entities（Card/Edge/Island/Narrative/EvidenceLink） | L2: Embedded-only | Document owner/Reviewerが業務内容を管理 | 型互換とimport/export roundtripを維持 | スナップショット内保存、UI操作経由の更新 | 個別監査検索、個別削除・復元 |
| Merge decision log (`merge_decision_logs`) | L1.5: Append-read | Reviewer/Audit operatorが判断履歴管理 | append-only契約とdoc従属を維持 | 追記/参照、group/snapshot整合 | 更新・削除API、独立ライフサイクル |
| Derived read models（SimilarCandidateGroup/ContextBundle） | L3: Derived | Developerが生成ロジック品質を保守 | 生成I/F語彙とfail-closed条件を維持 | 生成・表示・検証 | 永続保守、手動補正 |
| A1 contract fields（`critiqueInputs`等） | L2.5: Contract-limited | Developer/Reviewerが型整合を管理 | frontend/backend/api/schema同義性を維持 | 保存・読み込み・往復検証 | 個別編集UI、個別CRUD |
| Admin maintenance ops（backup/restore/inventory） | L0: Planned | Platform operator/Security officer | Runbook契約を固定（将来） | 手順定義、演習設計 | 自動化済み運用、完全管理UI |

### Recovery / Exception Flow（MVP）

1. **Detect**: 異常検知（破損、契約ドリフト、復元要求）を運用者が起票する。
2. **Classify**: 事象を `Contract` / `Maintenance` / `Support` の3系統で分類する。
3. **Contain**: share/exportをsafeMode既定ONで凍結し、未レビュー本文の二次共有を抑止する。
4. **Recover**: `DATA-MAINT-01` の手順に従いバックアップ復元（DB単位）またはDocument再投入を行う。
5. **Verify**: `DATA-CONTRACT-01` 観点でroundtripと `PUT create-if-absent` 契約を再確認する。
6. **Record**: 判断と再発防止を `DATA-MODEL-OPS-01` の境界表へ反映する。

## Acceptance Criteria / Definition of Done

- ADR-0033 is **Accepted** and defines a non-ambiguous boundary for MVP support vs maintenance vs contract-only concerns.
- `02_Architecture/data_model_operations_overview.html` uses the same four support classes (`L1`, `L1.5`, `L2`, `L2.5`, `L3`, `L0`) and the same terminology as this ADR.
- `schemas.md` explicitly states that schema presence does not imply operational support, and points readers to `02_Architecture/data_model_operations_overview.html` for the boundary table.
- No statement in this ADR implies that Card/Edge/Island/Narrative have independent CRUD or operational recovery guarantees in MVP.
- Downstream implementation work is split into issues (`DATA-MODEL-OPS-01`, `DATA-MAINT-01`, `DATA-CONTRACT-01`) rather than marked as already implemented.

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 利用者・レビュアー・運用者・セキュリティ担当者に対し、MVPで標準運用できるデータと将来契約を明確に区別できる境界を提供し、責任範囲をステークホルダー別に説明可能にする。削除・棚卸・復旧・所有者移管をMVP保証対象外として分離する | データ: スキーマに存在する型が運用サポートを意味しないことを明示し続ける。機能: 個別CRUDの無い型を標準操作として誤認しない運用が必要 |
| **データ設計** | データ境界を4区分（運用サポート/埋め込み限定/派生・読み取り中心/契約のみ）で分類する。Card/Edge/Island/Narrative/ReviewAttribution は Document 内の埋め込み構造として保存し、merge decision log は append-only 契約、Derived read models は生成ロジックとして保守する | 機能: 新しい永続テーブルまたは標準CRUDを追加する際は本ADRの区分と CRUD 表を更新しなければならない。業務: 部分修復・個別監査・復旧の不足を運用上の既知制約として扱う |
| **機能設計** | Document スナップショットの GET/PUT /docs/{doc_id}、merge decision log の append/read を標準APIとして維持し、Card/Edge/Island 等の個別CRUDを MVP 必須にしない。Support level（L0〜L3）を定義し、`data_model_operations_overview.html` を「実際に運用できる範囲」の入口とする | データ: スナップショット内構造の増加で全体置換保存の競合・検証・復旧が難しくなる副作用を許容する。業務: API・frontend型・backend型・実装ルートの同期確認を継続的な責務とする |

## Consequences

- 期待される効果は次のとおりです。
  - 初見の開発者や運用者が、MVPで保守できるデータと将来契約を区別しやすくなる。
  - ステークホルダー別に、標準操作でできることと未整備の運用課題を説明できる。
  - 製品化に必要な管理機能、復旧手順、契約同期を個別issueとして進めやすくなる。
- 想定される副作用/制約は次のとおりです。
  - `Document` スナップショット内の構造が増えるほど、全体置換保存の競合・検証・復旧が難しくなる。
  - 個別CRUDがないため、管理者やサポートが部分修復したい場面では標準手段が不足する。
  - API文書、frontend型、backend型、実装ルートの同期を継続的に確認する必要がある。
- 移行時に必要な対応は次のとおりです。
  - `DATA-MAINT-01` で、一覧、アーカイブ/削除、バックアップ、復旧、データ検証、ユーザー棚卸しを設計する。
  - `DATA-CONTRACT-01` で、DocumentV2とAPIの正本差分を棚卸しし、必要な実装・テストを分割する。
  - 新しい永続テーブルまたは標準CRUDを追加する場合は、本ADRの区分と `02_Architecture/data_model_operations_overview.html` のCRUD表を更新する。

## Traceability

- Related: `02_Architecture/data_model_operations_overview.html`
- Related: `02_Architecture/schemas.md`
- Related: `02_Architecture/api.md`
- Related: `02_Architecture/enterprise_architecture.html`
- Related: `01_Plans/adr/ADR-0032-product-value-realization-model.md`
- Related: `01_Plans/issues/done/issue-DATA-MODEL-OPS-01-mvp-data-model-overview-and-crud-boundary.md`
- Related: `01_Plans/issues/done/issue-DATA-MAINT-01-admin-maintenance-and-recovery-operations.md`
- Related: `01_Plans/issues/done/issue-DATA-CONTRACT-01-document-v2-contract-drift-and-support-levels.md`

---
