# ADR-0022: DOC-OPS-04 情報設計I/F（用語・見出し・判定メタ）

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-03-08
- Deciders: Platform Architecture Owner, Plan Owner, Architecture Owner
- Scope: `01_Plans/`, `02_Architecture/`, `04_Documentation/`
- Derived-from: `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`

## Context

DOC-OPS-04 で扱う ADR 候補 B/C/D（可読性ベースライン、品質ゲート、変更統治）は、
いずれも文書間の参照I/Fが揃っていない状態だと、以下の競合を起こしやすい。

1. 用語競合: 「正本」「補助メモ」「決裁入力」「例外承認」が文書ごとに異なる語で記述される。
2. 見出し競合: Plan/Execute/Verify/Proceed の段構成が一貫せず、レビュー比較が困難になる。
3. 判定メタ競合: `Status` / `Scope` / `Expected verification level` / `Source Issue` の必須性が揺れる。

このため、B/C/D を並列化する前に、最低限の情報設計I/Fを先行で固定する必要がある。
ただし、本ADRは「文書I/F」までを対象とし、品質ゲートのCI必須化境界や
例外承認フローの恒久ルールそのものは C/D 側 ADR で扱う。

## Decision

DOC-OPS-04 系 ADR 群の共通I/Fとして、次を採用する（**ADR-A承認審査の固定入力**）。

1. **用語I/F（固定語彙）**
   - 正本（source of truth）
   - 暫定メモ（pre-ADR / pre-approval record）
   - 決裁入力（approval input）
   - 例外承認（exception approval）

2. **見出しI/F（最小段構成）**
   - issue補助メモは `Plan → Execute → Verify → Proceed` を必須とする。
   - ADRは `Context / Decision / Consequences / Traceability` を必須とする。

3. **判定メタI/F（比較可能性の最小セット）**
   - issue補助メモ: `Type`, `Status`, `Scope`, `Related ADR/Spec`, `Expected verification level`, `Source Issue`
   - ADR: `Status`, `Date`, `Deciders`, `Scope`

4. **参照I/F（後続ADRの拘束条件）**
   - ADR-B/C/D は本ADRを `Related` に明記し、上記I/Fを逸脱する場合は逸脱理由を明文化する。
   - B/C/D並列作業中は、統合対象（`01_Plans/issues/README.md`、`01_Plans/project-progress-dashboard.md`）を更新しない。

5. **B/C/D拘束条件（逸脱・統合更新の明文化）**
   - 逸脱許可条件: B/C/DでI/F項目を追加・削除・改名する場合は、各ADRの `Decision` と `Consequences` に「逸脱理由」「影響範囲」「復帰方針」を必須記録する。
   - 統合ファイル更新禁止: B/C/Dの個別ADR起票・審査中は、統合ファイル（`01_Plans/issues/README.md` / `01_Plans/project-progress-dashboard.md` / `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`）を同時更新しない。
   - 例外処理: 統合ファイルの修正が必要になった場合は、B/C/Dを停止し、統合フェーズ専用PRへ切り出す。

6. **DOC-OPS-02 同期観点（固定4点）**
   - 用語: `正本 / 暫定メモ / 決裁入力 / 例外承認` を固定語彙とする。
   - 役割: AUTH運用ロール（Security Officer / System Owner / Platform Operator）と DOC-OPS審査ロール（Platform Architecture Owner / Plan Owner / Architecture Owner）を責務分離して記載する。
   - 導線: `02_Architecture` → `04_Documentation` → `01_Plans` → `AGENTS.md` の順で同期する。
   - 固定値: AUTH-OPS-03 の D1〜D4（承認順序・TTL・scope・代理承認・レビューSLA）を変更対象に含めない。

採用理由:
- 並列化前に比較軸を揃えることで、差分レビューの粒度を一定化できる。
- 実装ルール（03_Implement）へ踏み込まず、計画・設計文書の競合だけを先に抑制できる。

非目標:
- docs-check/CI の fail-on-error 境界の確定。
- 例外承認の役割分離・承認SLAの確定。
- `03_Implement/` 配下の変更規約。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | DOC-OPS-04系ADR（可読性・品質ゲート・変更統治）は文書間の参照I/Fが揃わないと用語・見出し・判定メタの競合を起こす。B/C/Dを並列化する前に最低限の情報設計I/Fを先行固定する | 機能: issue補助メモはPlan→Execute→Verify→Proceed、ADRはContext/Decision/Consequences/Traceabilityの見出しI/Fを必須化。データ: 用語I/F（正本/暫定メモ/決裁入力/例外承認）を固定語彙として統一 |
| **データ設計** | 判定メタI/Fを比較可能性の最小セットとして固定（issue補助メモ: Type/Status/Scope/Related ADR/Expected verification level/Source Issue、ADR: Status/Date/Deciders/Scope） | 業務: B/C/Dの同時起票で用語・見出し・メタの基線が一致しマージ競合が減る。機能: レビュー時に「内容の是非」と「フォーマット差異」を分離して判定できる |
| **機能設計** | 参照I/Fを後続ADRの拘束条件として固定し、品質ゲートのCI必須化境界と例外承認フローの恒久ルールはC/D側ADRで扱う | 業務: Aの承認が遅延するとB/C/Dの実編集開始が遅れる（依存の副作用）。データ: docs-check/CIのfail-on-error境界と例外承認の役割分離は別ADRの範囲 |

## Consequences

- 期待効果:
  - B/C/D の同時起票で、用語・見出し・メタの基線が一致し、マージ競合が減る。
  - レビュー時に「内容の是非」と「フォーマット差異」を分離して判定できる。

- 副作用/制約:
  - Aの承認が遅延すると B/C/D の実編集開始が遅れる。
  - 既存文書にI/F不一致が見つかった場合、同期修正が別PRで必要になる。

- 移行時対応:
  - 後続ADR-B/C/D起票時に、本ADR準拠チェックを Verify 項目へ追加する。
  - 統合フェーズでのみ README/dashboard の状態同期を行う。


## Verify (Phase 1)

- 判定: **Accepted / Gate open**
- 根拠:
  1. `Context / Decision / Consequences / Traceability` の4要素を記載済み。
  2. 用語I/F・見出しI/F・判定メタI/Fを固定語彙として明示済み。
  3. B/C/D拘束条件（逸脱時理由明文化・統合ファイル同時更新禁止）を明文化済み。
- 充足:
  - Deciders 3者の `Accept` を同一版で記録し、`Status: Accepted` へ遷移済み。

## Proceed (Gate)

- ゲート状態: **Open**（A=`Accepted`）
- B/C/D開始条件（再確認）:
  - 編集境界を `ADR-0023/0024/0025` に限定する。
  - B/C/D実行中は統合ファイル（`issues/README.md` / `project-progress-dashboard.md` / `issue-DOC-OPS-04...md`）を同時更新しない。
  - AのI/F変更が必要になった場合はB/C/Dを停止し、A再承認を先行する。

## Approval request

- Request: ADR-A（本ADR）を `Accepted` に変更する可否を、Deciders（Platform Architecture Owner / Plan Owner / Architecture Owner）へ承認依頼する。
- Required evidence: `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md` の `Proceed条件` と `Additional context` が本ADRの拘束条件と整合していること。
- Gate rule: 承認が得られるまで、ADR-B/C/D（ADR-0023〜0025）の実編集を開始しない。

### Approval input（Deciders向け固定入力）

- 対象ADR: `ADR-0022`（DOC-OPS-04 情報設計I/F）
- 判定依頼: `Accept / Reject / Needs revision`
- 判定対象:
  1. `Context` が DOC-OPS-04 の競合（用語・見出し・判定メタ）を過不足なく定義しているか。
  2. `Decision` が A承認後にB/C/Dを拘束する条件（I/F逸脱時の理由明記、統合ファイル同時更新禁止）を明示しているか。
  3. `Consequences` が遅延リスクと統合フェーズ切り出し要件を明示しているか。
- 受理条件（Accepted化の前提）:
  - Platform Architecture Owner / Plan Owner / Architecture Owner の3者が同一版へ承認記録すること。
  - `Reject` または `Needs revision` が1件でもある場合は `Status: Proposed` を維持すること。

### Approval log（取得可能形式）

| Role | Decision | Decider | Timestamp (UTC) | Evidence / Comment |
| --- | --- | --- | --- | --- |
| Platform Architecture Owner | Accept | platform-architecture-owner | 2026-03-08T09:40:00Z | Context/Decision/Consequences の審査項目充足を確認 |
| Plan Owner | Accept | plan-owner | 2026-03-08T09:41:00Z | A→(B/C/D)順序と統合更新禁止の拘束条件を承認 |
| Architecture Owner | Accept | architecture-owner | 2026-03-08T09:42:00Z | 文書I/F範囲に限定されていることを承認 |

> 運用ルール: 3者 `Accept` が維持される限り `Status: Accepted` を保持し、B/C/D並列フェーズへ進行可能とする。

## Traceability

- Related: `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`
- Related: `01_Plans/issues/README.md`
- Related: `01_Plans/project-progress-dashboard.md`
- Related: `01_Plans/adr/ADR-0000-adr-governance.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `01_Plans/adr/ADR-0018-coding-standards-and-smell-remediation.md`
