# ADR-0033: MVPデータサポート境界と保守方針

- Status: Accepted
- Date: 2026-05-17
- Deciders: Project Maintainers
- Scope: `01_Plans/adr/ADR-0033-mvp-data-support-and-maintenance-boundary.md`, `02_Architecture/data_model_operations_overview.html`, `02_Architecture/schemas.md`

## Context

sui-sensemakingの設計文書には、MVPで実際に利用する最小スキーマと、AI連携・レビュー帰属・監査連携・将来拡張の契約が同じ `02_Architecture` 層に存在している。

一方、現行MVPの永続化は、ドキュメント全体をJSONスナップショットとして保存し、補助的にユーザーとIDの対応表、およびマージ判断ログを持つ構成である。Card、Edge、Island、Narrative、ReviewAttributionなどは論理データとして重要だが、多くは `Document` 内に埋め込まれた構造であり、個別のCRUDや管理画面を持たない。

この境界が曖昧なままだと、次の問題が起きる。

1. スキーマにある型を、標準の運用で保守できるデータだと誤解しやすい。
2. 利用者、レビュアー、運用者、セキュリティ担当者の責任の範囲が読み取りにくい。
3. データの削除、棚卸し、復旧、所有者の移管など、組織の運用に必要な作業が、MVPの内側で保証済みに見えてしまう。
4. DocumentV2やAPIの契約の差分を、実装を直さずに文書だけで吸収しやすくなる。

## Decision

MVPでは、データサポート境界を次の4区分で管理する。

| 区分 | 意味 | 代表例 |
| --- | --- | --- |
| 運用サポート | 標準のAPIとUIで通常の運用ができる | `Document` スナップショット、admin provisioning、merge decision log append/read |
| 埋め込み限定 | `Document` 内には保存されるが、個別のCRUDは持たない | Card、Edge、Island、Narrative、ReviewAttribution |
| 派生/読み取り中心 | 保存済みのデータやリクエストから生成され、保守の対象ではない | SimilarCandidateGroup、ContextBundle、audit event |
| 契約のみ/将来拡張 | 型やI/Fは固定するが、MVPでは完全には保守しない | CE契約、差分同期、証跡・根拠リンクの完全管理 |

`02_Architecture/data_model_operations_overview.html` を、MVPデータモデル、論理ER、CRUDサポート表、ステークホルダー別運用境界の俯瞰文書として追加する。この文書は `schemas.md` や `api.md` の詳細を置き換えず、「実際に運用できる範囲」を読むための入口とする。

採用の理由は、MVPのスナップショット保存の方針を維持しつつ、製品化に必要なデータ運用の課題を隠さずに切り分けられるためである。現段階ですべてのエンティティを正規化して個別のCRUDを実装すると、UI、API、移行、監査の範囲が一気に広がり、MVPで確かめたい価値よりも管理の仕組みが先に立つ。

非目標

- このADRだけで、新しい永続テーブルや管理画面を追加しない。
- Card/Edge/Islandなどの個別CRUDを、MVPの必須にしない。
- 監査ログの閲覧、削除と保管の期限、所有者の移管、復旧の手順を、完了したものとして扱わない。
- 契約のずれを、文書上の言い換えだけで解決しない。実装、API、型の不一致は内部issueで扱う。


## Support / Maintenance / Contract Boundary Table

| 項目 | Support Level（MVP標準運用） | Maintenance Boundary（保守責務） | Contract Boundary（契約責務） | 含む | 含まない |
| --- | --- | --- | --- | --- | --- |
| Document snapshot (`documents.payload_json`) | L1: Supported | Platform operatorが可用性とバックアップ、Document ownerが内容の責任を持つ | `DocumentV1/V2` の往復互換を維持する | `GET/PUT /docs/{doc_id}`、全体の保存と復元 | 個別のCard/Edge CRUD、部分修復API |
| Embedded entities（Card/Edge/Island/Narrative/EvidenceLink） | L2: Embedded-only | Document ownerとReviewerが業務内容を管理する | 型の互換とimport/export roundtripを維持する | スナップショット内への保存、UI操作を経由した更新 | 個別の監査検索、個別の削除と復元 |
| Merge decision log (`merge_decision_logs`) | L1.5: Append-read | ReviewerとAudit operatorが判断の履歴を管理する | append-only契約とdocへの従属を維持する | 追記と参照、groupとsnapshotの整合 | 更新と削除のAPI、独立したライフサイクル |
| Derived read models（SimilarCandidateGroup/ContextBundle） | L3: Derived | Developerが生成ロジックの品質を保守する | 生成I/Fの語彙と、安全側で拒否する条件を維持する | 生成、表示、検証 | 永続的な保守、手動の補正 |
| A1 contract fields（`critiqueInputs`等） | L2.5: Contract-limited | DeveloperとReviewerが型の整合を管理する | frontend/backend/api/schemaの同義性を維持する | 保存、読み込み、往復の検証 | 個別の編集UI、個別のCRUD |
| Admin maintenance ops（backup/restore/inventory） | L0: Planned | Platform operator/Security officer | Runbookの契約を固定する（将来） | 手順の定義、演習の設計 | 自動化済みの運用、完全な管理UI |

### Recovery / Exception Flow（MVP）

1. **Detect**: 異常の検知（破損、契約のずれ、復元の要求）を、運用者が起票する。
2. **Classify**: 事象を `Contract` / `Maintenance` / `Support` の3系統に分類する。
3. **Contain**: share/exportをsafeMode既定ONで凍結し、未レビューの本文が二次的に共有されるのを抑える。
4. **Recover**: `DATA-MAINT-01` の手順に従い、バックアップの復元（DB単位）またはDocumentの再投入を行う。
5. **Verify**: `DATA-CONTRACT-01` の観点で、roundtripと `PUT create-if-absent` の契約を再確認する。
6. **Record**: 判断と再発の防止策を `DATA-MODEL-OPS-01` の境界表へ反映する。

## Acceptance Criteria / Definition of Done

- ADR-0033は **Accepted** であり、MVPにおけるサポート、保守、契約のみの関心事の境界を、曖昧さなく定めている。
- `02_Architecture/data_model_operations_overview.html` は、このADRと同じ4つのサポート区分（`L1`, `L1.5`, `L2`, `L2.5`, `L3`, `L0`）と同じ用語を使う。
- `schemas.md` は、スキーマにあることが運用のサポートを意味しないと明記し、境界の表については `02_Architecture/data_model_operations_overview.html` を読者に案内する。
- このADRのどの記述も、MVPでCard/Edge/Island/Narrativeが独立したCRUDや運用上の復旧の保証を持つことを示唆しない。
- 下流の実装作業は、実装済みとして扱わず、issue（`DATA-MODEL-OPS-01`, `DATA-MAINT-01`, `DATA-CONTRACT-01`）に分ける。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 利用者・レビュアー・運用者・セキュリティ担当者に対し、MVPで標準運用できるデータと将来契約を明確に区別できる境界を提供し、責任範囲をステークホルダー別に説明可能にする。削除、棚卸し、復旧、所有者の移管を、MVPの保証の対象外として切り分ける | データ: スキーマに存在する型が運用サポートを意味しないことを明示し続ける。機能: 個別CRUDの無い型を標準操作として誤認しない運用が必要 |
| **データ設計** | データ境界を4区分（運用サポート/埋め込み限定/派生・読み取り中心/契約のみ）で分類する。Card/Edge/Island/Narrative/ReviewAttribution は Document 内の埋め込み構造として保存し、merge decision log は append-only 契約、Derived read models は生成ロジックとして保守する | 機能: 新しい永続テーブルまたは標準CRUDを追加する際は本ADRの区分と CRUD 表を更新しなければならない。業務: 部分修復・個別監査・復旧の不足を運用上の既知制約として扱う |
| **機能設計** | Document スナップショットの GET/PUT /docs/{doc_id}、merge decision log の append/read を標準APIとして維持し、Card/Edge/Island 等の個別CRUDを MVP 必須にしない。Support level（L0〜L3）を定義し、`data_model_operations_overview.html` を「実際に運用できる範囲」の入口とする | データ: スナップショット内構造の増加で全体置換保存の競合・検証・復旧が難しくなる副作用を許容する。業務: API・frontend型・backend型・実装ルートの同期確認を継続的な責務とする |

## Consequences

- 期待される効果
  - 初見の開発者や運用者が、MVPで保守できるデータと将来契約を区別しやすくなる。
  - ステークホルダー別に、標準操作でできることと未整備の運用課題を説明できる。
  - 製品化に必要な管理機能、復旧手順、契約同期を個別issueとして進めやすくなる。
- 想定される副作用と制約
  - `Document` スナップショット内の構造が増えるほど、全体置換保存の競合・検証・復旧が難しくなる。
  - 個別CRUDがないため、管理者やサポートが部分修復したい場面では標準手段が不足する。
  - API文書、frontend型、backend型、実装ルートの同期を継続的に確認する必要がある。
- 移行時に必要な対応
  - `DATA-MAINT-01` で、一覧、アーカイブと削除、バックアップ、復旧、データの検証、ユーザーの棚卸しを設計する。
  - `DATA-CONTRACT-01` で、DocumentV2とAPIの差分を棚卸しし、必要な実装・テストを分割する。
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
