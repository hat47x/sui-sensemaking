# ADR-0035: 高権限データライフサイクル操作の製品境界

- Status: Accepted（2026-07-13、maintainer代理裁可。高権限操作の包括解禁は不採用）
- Date: 2026-06-01
- Deciders: Maintainer
- Scope: `01_Plans/adr/ADR-0035-privileged-data-lifecycle-boundary.md`, `01_Plans/issues/done/issue-DATA-MAINT-03-high-privilege-data-lifecycle-policy.md`, `01_Plans/issues/done/issue-DATA-MAINT-04-metadata-only-audit-viewing.md`, `02_Architecture/data_model_operations_overview.html`, `02_Architecture/api.md`

## Context

`ADR-0033` は、MVPのデータサポート境界を固定し、Admin maintenance opsを `L0: Planned` として扱った。`DATA-MAINT-01` と `DATA-MAINT-02` により、読み取り中心の棚卸し、バックアップ、検証環境での復旧確認、本文を含まない支援情報共有は、代表演習と文書証跡を持つ状態になった。

一方で、削除、アーカイブ、所有者移管、管理者本文閲覧、監査ログ閲覧、保持期限管理は、次の理由で通常の保守作業とは分ける必要がある。

1. 利用者本文や未レビュー情報へ触れる可能性があり、SafeModeやshare/exportの安全境界を変える。
2. 削除や保持期限は復旧不能性、監査保持、法務・契約上の説明責任に影響する。
3. 所有者移管は共有範囲、review attribution、判断ログの説明責任を変える。
4. 管理者本文閲覧や横断検索は、利用者が安心して考え途中の情報を預ける価値に直結する。
5. 導入組織ごとの内部統制、承認者、保持期間、監査基盤、法域要件を製品が一律に決めると、かえって混乱を招く。

このため、MVPから製品化へ進む際にも、高権限操作を「便利な管理機能」としてまとめて実装しない判断を正本化する必要がある。

## Decision

MVPおよび次の製品化準備段階では、高権限データライフサイクル操作を標準管理機能として提供しない。提供可否は次の境界で扱う。

本決定は、削除・アーカイブ・所有者移管をまとめて解禁する判断ではない。現行データモデルには、文書所有権の物理正本、復旧可能なライフサイクル状態、共有済み成果物との失効関係、判断ログ保持契約が揃っていないため、3操作の包括解禁を明示的に却下する。

| 操作 | 製品境界 | 実装前提 |
| --- | --- | --- |
| ドキュメント削除 | 標準機能にしない。物理削除、論理削除、復旧可能削除のいずれも本ADRでは採用しない。 | 製品機能にする場合は、削除方式、監査保持、復旧不能性、共有済み成果物との関係を別ADRで固定する。 |
| ドキュメントアーカイブ | 標準機能にしない。ただし将来の状態遷移候補として保留する。 | 一覧表示、共有、review pack、復旧、検索対象からの除外を別ADRまたは専用issueで固定する。 |
| 所有者移管 | 標準機能にしない。 | 移管理由、承認者、履歴、通知、review attribution、判断ログの責任を別ADRで固定する。 |
| 管理者本文閲覧 / 横断検索 | 禁止を既定とする。通常保守、Support、Platform operator の標準導線には含めない。 | 例外運用を認める場合も、目的、範囲、記録、通知、代替手段、監査証跡を別ADRで固定する。 |
| 監査ログ閲覧 | 本文を含まないメタデータ閲覧候補に限り、内部issueで検討できる。 | 本文、未レビュー情報、保持方針、横断検索を含む場合は別ADRを必須とする。 |
| 保持期限管理 | 組織判断事項として扱う。製品の自動削除や標準保持期間は採用しない。 | 自動削除、標準保持期間、法域別ルールを製品が持つ場合は別ADRを必須とする。 |

採用理由は次のとおりです。

- sui-sensemakingの価値は、利用者が考え途中の情報を安心して置けることにある。管理者本文閲覧や破壊的操作を標準導線にすると、この信頼の前提が弱くなる。
- バックアップや復旧確認は運用上必要だが、削除、所有者移管、保持期限は組織ごとの責任・監査・法務判断に依存する。
- 製品標準として固定する範囲を狭くすることで、公開文書は判断支援に徹し、必要以上に細かい規定を避けられる。
- 実装前にADRを要求することで、SafeMode、share/export、public exposure、review attribution、merge decision logの意味が暗黙に変わることを防げる。

非目標は次のとおりです。

- このADRでは削除API、アーカイブUI、所有者移管、管理者本文閲覧、保持期限自動化を実装しない。
- 各組織の保持期間、暗号化方式、保管先、承認手順、法域別削除義務を製品一律の規定として定めない。
- 本文を含まない運用メタデータの読み取り改善を禁止しない。ただし本文や未レビュー情報を含む場合は本ADRの外へ出せない。

## Acceptance readiness packet (2026-06-02)

本ADRを `Accepted` に変更する前に、Decidersは次の点だけを確認する。ここで確認するのは「高権限操作を標準機能にしない製品境界」であり、各組織の運用規程を細かく固定することではない。

| 確認項目 | Accepted にできる条件 | Accepted 後も残ること |
| --- | --- | --- |
| 標準機能の範囲 | 削除、アーカイブ、所有者移管、管理者本文閲覧、保持期限自動化を標準機能にしないことに合意している。 | いずれかを将来採用する場合は、対象操作ごとに別ADRと専用issueを起票する。 |
| 組織判断との境界 | 保持期間、削除義務、承認者、保管先、暗号化方式を、製品一律の規定として固定しないことに合意している。 | 導入組織は自組織の法務・契約・監査基盤に合わせて判断する。 |
| 利用者本文の保護 | Support、Platform operator、管理者が標準導線で本文や未レビュー情報を横断閲覧しないことに合意している。 | 例外運用を認める場合は、目的、通知、記録、代替手段を別ADRで固定する。 |
| 監査メタデータ閲覧 | 本文を含まない監査メタデータ閲覧だけは `DATA-MAINT-04` で検討可能とすることに合意している。 | `DATA-MAINT-04` はAccepted後にOpen化可否を判断する。実装許可ではない。 |
| リリースゲート | 未実装の高権限操作を、単独のリリース阻害ではなく明示された製品境界として扱える。 | 本番導入組織が必須機能と判断する場合は、リリース条件へ戻す。 |

Accepted 後の実装停止条件:

- 高権限操作を「便利な管理機能」としてまとめて実装しようとする場合は停止する。
- 本文、未レビュー情報、Document JSON全体、review pack本文、diff本文を管理者・Support向け標準導線で閲覧させる場合は停止する。
- 自動削除、標準保持期間、所有者移管、削除方式を製品既定値として固定する場合は停止する。
- `DATA-MAINT-04` を、監査メタデータ閲覧ではなく本文閲覧や横断検索へ広げる場合は停止する。

## Maintainer decision packet（2026-06-06）

このパケットは、本ADRを `Proposed` から `Accepted` へ進められるかを判断するためのものである。実装要求ではなく、管理API、管理UI、CLI変更コマンド、削除フロー、アーカイブフロー、所有者移管、本文閲覧、文書横断検索、保持期限自動化の追加許可として読んではならない。

Maintainer への推奨判断:

- `ADR-0035` は、製品境界の判断としてのみAcceptedにする。
- 削除、アーカイブ、所有者移管、管理者本文閲覧/横断検索、保持期限自動化は、現在の製品化段階では標準導線の外に置く。
- 本文を含まない監査メタデータ閲覧候補だけを `DATA-MAINT-04` で継続検討できるものとし、その場合もDraft-to-Open gateを明示的に確認する。
- 組織ごとの保持期間、法的削除義務、承認経路、保管先、暗号化詳細は本ADRの外に置く。公開文書や運用ガイドは判断を支援してよいが、プロジェクト共通の既定値として規定してはならない。

Maintainer の選択肢:

| 選択 | 意味 | 後続対応 |
| --- | --- | --- |
| Accept as written | 製品境界を固定し、高権限ライフサイクル操作を標準機能にしない。 | `DATA-MAINT-03` を `DecisionStatus=Fixed` 候補へ進め、`DATA-MAINT-04` を Draft から進められるか別途確認する。 |
| Request changes | 方向性は妥当だが、必要なリスク、ステークホルダー、導入条件が不足している。 | `DATA-MAINT-03` を Pending のまま維持し、実装issueを開く前に本ADRを更新する。 |
| Reject | 少なくとも1つの高権限操作を、現時点で標準機能として扱うべきである。 | 実装前に、その操作の権限、監査、復旧、通知、検証、リリースゲート影響を扱う後続ADRを作る。 |

すでにそろっている最小証跡は次のとおりです。

- `DATA-MAINT-03` は、高権限操作ごとの分類とStop条件を記録している。
- `DATA-MAINT-04` は、本文アクセスと監査メタデータ閲覧を分離し、Draftのまま維持している。
- `02_Architecture/data_model_operations_overview.html` は、MVPで支援するデータ、埋め込み構造、派生情報、未支援のライフサイクル操作を区別している。
- `PRODUCT-QA-01` と `MVP-EXIT-01` は、未解決の高権限操作を隠れた実装漏れではなく、リリースゲート対象の製品境界判断として扱っている。

## Current-main decision freshness（2026-06-13、2026-07-13解決）

2026-06-13時点では判断材料だけがそろい、Project Maintainersの明示判断が残っていた。2026-07-13のmaintainer代理裁可で `Accept as written` を選び、この判断待ちは解決した。

採択結果は次のとおりです。

1. 削除: 解禁しない。
2. アーカイブ: 可逆な状態遷移の将来候補として保持するが、現時点では解禁しない。
3. 所有者移管: 所有権の正本と監査責任が未定義のため解禁しない。
4. 本文を含まない監査メタデータ閲覧: `DATA-MAINT-04` で境界整理を継続してよいが、本採択だけでは実装を許可しない。

Productization Program Owner / QA Leadが次に確認する事項:

- 導入想定組織が、削除、アーカイブ、所有者移管、保持期限自動化、管理者本文閲覧、文書横断検索のいずれかを本番導入の前提条件として求めているか。
- 求めている場合、それは本ADRのAccepted化では解決せず、後続ADRと実装issueを通してリリースゲートへ戻す必要がある。
- 求めていない場合、未実装状態は隠れた欠落ではなく、明示された製品境界として扱える。

この確認では、API、UI、CLI、runtime behavior、SafeMode、share/export、公開文書、`DATA-MAINT-04` のDraft状態を変更しない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 削除・アーカイブ・所有者移管・管理者本文閲覧・文書横断検索・保持期限自動化は現在の製品化段階では標準導線の外に置く。未実装状態は隠れた欠落ではなく明示された製品境界として扱う | 機能: 高権限操作を「便利な管理機能」としてまとめて実装しようとする場合は停止。データ: Platform operator/Security officer/Supportが利用者本文へ標準的にアクセスできるように見える誤解を避ける |
| **データ設計** | 高権限ライフサイクル操作（削除/アーカイブ/所有者移管/保持期限自動化）は標準機能にしない。本文を含まない監査メタデータ閲覧候補だけを`DATA-MAINT-04`で継続検討 | 業務: 本文・未レビュー情報・Document JSON全体・review pack本文・diff本文を管理者/Support向け標準導線で閲覧させない。機能: 自動削除・標準保持期間・所有者移管・削除方式を製品既定値として固定しない |
| **機能設計** | 削除・アーカイブ・所有者移管のAPI/UI/CLIを解禁しない（可逆な状態遷移は将来候補として保持）。将来製品化する場合はADRと専用issueで権限・監査・復旧・検証を先に合意 | 業務: `DATA-MAINT-04`を本文閲覧や横断検索へ広げる場合は停止。データ: この確認でAPI・UI・CLI・runtime behavior・SafeMode・share/export・公開文書・DATA-MAINT-04のDraft状態を変更しない |

## Consequences

期待される効果は次のとおりです。

- `DATA-MAINT-03` の判断待ちが「高権限操作は標準機能にしない」という明確な境界へ収束する。
- Platform operator、Security officer、Supportが利用者本文へ標準的にアクセスできるように見える誤解を避けられる。
- 公開文書や運用ガイドラインは、各組織の判断を支援する最小限の説明に留められる。
- 将来、削除や所有者移管を本当に製品化する場合、ADRと専用issueを通して権限・監査・復旧・検証を先に合意できる。

想定される副作用/制約は次のとおりです。

- 導入組織によっては、削除、アーカイブ、所有者移管、保持期限管理の不足を製品化前のギャップとして扱う必要がある。
- 運用者は、標準機能ではなく組織内手順や外部監査基盤で補う範囲を明示する必要がある。
- 管理画面や管理APIを一気に実装する要求は、ADR未承認のままでは進められない。

移行時に必要な対応は次のとおりです。

- `DATA-MAINT-03` は本ADRを参照先として、DecisionStatusをAccepted後にFixedへ進める。
- 本文を含まない監査メタデータ閲覧候補は `DATA-MAINT-04` でDraftとして追跡し、本ADRがAcceptedされるまで実装着手しない。
- `02_Architecture/data_model_operations_overview.html` と `api.md` は、高権限データライフサイクル操作の標準提供なし、メタデータ限定の監査閲覧候補のみissueで検討可、という境界へ同期する。
- `PRODUCT-QA-01` / `MVP-EXIT-01` は、削除や管理者本文閲覧の未実装を単独のリリース阻害ではなく、明示された製品境界として扱う。ただし本番運用で必須と判断される場合は、別ADR/issueをリリース条件へ戻す。

## Post-2398 governance-context note (2026-06-14、2026-07-13更新)

- Current mainline reviewed: `origin/main@e6a72667dbd3794b1903264887642932f11515d9`.
- `ADR-0039` is Accepted and right-sizes governance for the personal-OSS / pre-release phase. That process decision does not change this ADR's decision state.
- The maintainer proxy decision on 2026-07-13 chose `Accept as written`; this ADR is now `Status: Accepted`.
- `DATA-MAINT-03` is `Status=Done` / `DecisionStatus=Fixed`; `DATA-MAINT-04` may remain Open for metadata-only boundary work.
- This note grants no implementation permission for deletion, archive, ownership transfer, admin body browsing, cross-document body search, retention automation, broad audit viewing, or metadata-only audit viewing.
- Stop condition: do not treat this acceptance as permission for deletion, archive, ownership transfer, admin body browsing, cross-document body search, or retention automation.

## Traceability

- Related: `01_Plans/adr/ADR-0033-mvp-data-support-and-maintenance-boundary.md`
- Related: `01_Plans/issues/done/issue-DATA-MAINT-03-high-privilege-data-lifecycle-policy.md`
- Related: `01_Plans/issues/done/issue-DATA-MAINT-04-metadata-only-audit-viewing.md`
- Related: `01_Plans/issues/done/issue-DATA-MAINT-01-admin-maintenance-and-recovery-operations.md`
- Related: `02_Architecture/data_model_operations_overview.html`
- Related: `02_Architecture/api.md`
- Related: `04_Documentation/security.md`
- Supersedes: N/A
- Superseded by: N/A
- Derived-from: `DATA-MAINT-03` high-privilege operation classification

---
