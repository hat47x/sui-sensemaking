# ADR-0018: シンプル・セキュア規約とバッドスメル是正方針

- Status: Accepted
- Date: 2026-02-25
- Deciders: Project Maintainers
- Scope: `03_Implement/frontend`, `03_Implement/backend`, `02_Architecture/coding_standards.md`
- Derived-from: コードベース観測（2026-02-25）

## Context

コードベースの保守性・安全性を継続的に担保するため、再発しやすいバッドスメルを
「観測メモ」ではなく、意思決定（ADR）と運用規約へ昇格させる必要がある。

観測した主な課題は次のとおりです。

1. Frontendで巨大ファイル化（例: `App.tsx`）が進み、責務境界が曖昧。
2. インラインスタイルや色コード重複が多く、UI変更時の一貫性が崩れやすい。
3. Backendで `except Exception` の広域捕捉が散見され、障害解析性が低い。
4. Frontend CIは型検査中心で、可読性・安全性ルールの自動検知が限定的。
5. PRごとにE2E実施証跡（実行コマンド/未実施理由）が明示されず、UI/境界変更で確認漏れが再発しやすい。

## Decision

1. **バッドスメルの管理先をADR + 規約へ一本化**する。
   - 観測事項は本ADRに記録し、実務ルールは `02_Architecture/coding_standards.md` に集約する。
   - 規約文書からは「現在のコードの観測一覧」を削除し、ルール本文に集中させる。

2. **是正方針を以下に固定**する。
   - 巨大ファイル: 機能追加時に責務抽出（component/hook/util）を必須化。
   - スタイル重複: トークン/定数へ集約し、重複追加を禁止。
   - 広域例外: 期待例外型での狭い捕捉へ置換。
   - 静的検知: Frontend lint強化（例: ESLint）を段階導入。
   - E2E証跡: UI/境界変更時はPlaywright追加/更新または未実施理由の明記を必須化。

3. **PRレビューでの統制**を明文化する。
   - 規約チェックリストにより、複雑性・安全性・テスト有無を毎回確認する。


## ADR-0018 Follow-up（Frontend lint 段階導入）

本ADRの「静的検知を段階導入する」決定に対する運用実装として、以下を必須化する。

- Phase A/B/Cのチェックリストとexit criteriaを `02_Architecture/coding_standards.md` に定義する。
- 開発者向けの `npm run lint` 実行手順・失敗時対処・期限付き例外運用を `CONTRIBUTING.md` に定義する。
- CIは `frontend-lint` / `frontend-typecheck` / `frontend-test` に責務分離し、Phase B以降のfail-on-error条件を明示する。
- 文書とCIの同期確認は、同一PR内の差分監査コマンドで検証する。

### 2026-08-05 追記: 上記の運用実装は撤去した（決定自体は維持）

「静的検知を段階導入する」という本ADRの決定は維持する。ただし上記4項目の運用実装は、**段階導入の対象となる独立したリンタが実際には導入されなかった**ため撤去した。`npm run lint` は `npm run typecheck`（`tsc --noEmit`）の別名であり、`frontend-lint` ジョブは `frontend-typecheck` と同一コマンドを実行していた。

そのためPhase A/B/Cのチェックリスト、移行証跡、14日期限の例外Issue運用、`FRONTEND_LINT_PHASE` 変数、差分監査手順は、いずれも存在しないツールを統治していた。`ADR-0039`（個人OSS段階の過剰ガバナンス回避）に照らして撤去し、CIゲートを `frontend-typecheck` と `frontend-test` の2つへ整理した。

実のリンタを導入する時点で、専用ジョブと運用方針を改めて定める。その際に本ADRの決定を再び運用実装へ落とす。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | コードベースの保守性・安全性を継続的に担保するため、再発しやすいバッドスメルを「観測メモ」ではなく意思決定（ADR）と運用規約へ昇格させる。巨大ファイル（App.tsx）・スタイル重複・広域例外・E2E証跡不足に対処 | 機能: 機能追加時に責務抽出（component/hook/util）を必須化し、広域例外は期待例外型での狭い捕捉へ置換。データ: バッドスメルの再発時に「既知課題か新規課題か」をADR単位で追跡 |
| **データ設計** | バッドスメルの管理先をADR+規約へ一本化し、実務ルールは`02_Architecture/coding_standards.md`に集約。規約文書から「現在のコードの観測一覧」を削除しルール本文に集中 | 業務: ルールと背景の責務分離により規約文書は短く運用可能になる。機能: スタイル重複はトークン/定数へ集約し重複追加を禁止 |
| **機能設計** | Frontend lint強化（ESLint等）を段階導入し、UI/境界変更時はPlaywright追加/更新または未実施理由の明記を必須化。将来の規約改定は本ADRを起点に更新履歴を残す | 業務: PRごとにE2E実施証跡（実行コマンド/未実施理由）を明示。データ: 実リンタ導入時点で専用ジョブと運用方針を改めて定める |

## Consequences

- ルールと背景の責務分離により、規約文書は短く運用可能になる。
- バッドスメルの再発時に「既知課題か」「新規課題か」をADR単位で追跡できる。
- 将来の規約改定時は、本ADRを起点に更新履歴を残せる。

## Traceability

- Implements: `02_Architecture/coding_standards.md`
- Related: `.github/workflows/ci.yml`, `CONTRIBUTING.md`, `01_Plans/adr/ADR-0019-e2e-verification-policy-and-compose-runbook.md`
