# ADR-0016: CLI コマンド契約と検証粒度（ADR-0008分割）

- Status: Accepted
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Derived-from: `01_Plans/adr/ADR-0008-cli-tooling-plan.md`

## Context

CLIコマンド仕様を早期に固定しすぎると、MVP後のAPI確定前提と衝突しやすい。
一方で、実装者が迷わないためには「何を契約として守るか」を先に決める必要がある。

## Decision

### 1) 今決める契約（固定）

1. CLI名は `kj`。
2. トップレベル名前空間は当面 `doc`, `view`, `policy`, `audit` を予約語として扱う。
3. 共通I/F契約:
   - `--format json|yaml|text`
   - `--input -` / `--output -`
   - `--quiet` / `--verbose` / `--debug`
4. exit code契約（暫定だが実装はこの番号を維持）:
   - `0`: success
   - `1`: validation failed
   - `2`: usage error
   - `3`: runtime error
   - `4`: auth error
5. 互換性契約
   - 既存引数の意味変更は禁止。
   - 廃止予定機能は最低1フェーズの非推奨期間を置く。
6. CE4監査統合契約（API/CLI同値）:
   - 成功条件は `equivalenceKey AND bundleHash` の同時成立のみ。
   - `proposal-only` を固定し、`auto-apply` / `auto-confirm` / `auto-publish` を禁止する。
   - 監査4イベント `query -> bundle -> proposal -> apply` が欠損/逆順の場合は安全側で停止する。
   - 失敗分類は `validation_failed` / `audit_violation` / `equivalence_violation` / `policy_violation` の4種を固定語彙とする。

### 2) 後で決める契約（保留）

- 各サブコマンド配下の詳細オプション。
- `--profile` / `--request-id` / `--dry-run` の既定値。
- エラー本文フォーマット（人が読める形式の詳細）。
- exit codeの具体値割当（CE4失敗分類との数値マッピング）。

## Command-level Acceptance（実装着手時の受入判定）

> 本節は「実装後に必ず満たすべき受け入れ基準」である。現時点では、テスト設計の固定が目的である。

### A. 契約テスト（必須）

- `kj --help` にトップレベル名前空間が表示される。
- `kj <namespace> --help` が0終了し、usageを返す。
- 不正引数入力でexit code `2` を返す。

### B. I/O契約テスト（必須）

- `--input -` / `--output -` の標準入出力が機能する。
- `--format` 指定に応じてシリアライズ形式が切り替わる。

### B-2. CE4監査契約テスト（必須）

- 同一入力に対しAPI/CLIで `equivalenceKey AND bundleHash` が同時一致する。
- 監査4イベントの順序整合（`query -> bundle -> proposal -> apply`）が機械判定できる。
- 欠損/逆順/矛盾値は `audit_violation` として失敗終了する。
- `auto-*` 系操作痕跡検出時は `policy_violation` として失敗終了する。

### C. 互換性テスト（必須）

- 既存サブコマンドの引数意味が変わっていないことをスナップショットで検知できる。

## Test Command Blueprint（検証コマンド粒度）

以下のコマンド名を受入判定の標準粒度として予約する。
実装時は同名で追加し、CIに組み込む。

1. `pytest 03_Implement/backend/tests/cli_contract/test_help_contract.py`
2. `pytest 03_Implement/backend/tests/cli_contract/test_exit_codes.py`
3. `pytest 03_Implement/backend/tests/cli_contract/test_stdio_contract.py`
4. `pytest 03_Implement/backend/tests/cli_contract/test_backward_compat.py`

合格条件を次に示す。
- 上記4コマンドが全て終了コード0。
- 失敗時は互換性破壊として扱い、修正またはADR改訂のどちらかを同一PRで実施する。

## DoD

1. 契約テスト観点（Help / Exit / I/O / 互換）が欠落なく列挙される。
2. 受入判定に必要な最小コマンドが固定される。
3. ADR-0015（範囲）・ADR-0017（安全運用）と責務重複しない。

## Non-Goals

- 業務コマンドの機能仕様（例: `doc export` のパラメータ完全定義）。
- APIレスポンススキーマの新規確定。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | CLIコマンド仕様を早期に固定しすぎるとMVP後のAPI確定前提と衝突するが、実装者が迷わないために「何を契約として守るか」を先に決める必要がある。CLI名`kj`と予約名前空間（doc/view/policy/audit）を固定 | 機能: 共通I/F契約（--format/--input/--output/--quiet/--verbose/--debug）とexit code契約（0-4）を固定。データ: 業務コマンドの機能仕様とAPIレスポンススキーマの新規確定は非対象 |
| **データ設計** | exit code（0成功/1 validation/2 usage/3 runtime/4 auth）を実装が維持する暫定契約として固定。CE4実装前にAPI/CLI/監査の契約判定軸を固定 | 業務: 実装者は「まず何のテストを作るか」を迷わない。機能: モックを先に作って依存切断検証を先行できる |
| **機能設計** | CLI契約（名前空間・共通I/F・exit code・互換性）を実装が守る契約として定義し、破壊的変更を検知可能にする | 業務: 仕様未確定領域を残しつつ破壊的変更を検知する。データ: CLIとAPIの契約判定軸をCE4実装前に固定 |

## Consequences

- 実装者は「まず何のテストを作るか」を迷わない。
- 仕様未確定領域を残しつつ、破壊的変更を検知できる。
- CE4実装着手前にAPI/CLI/監査の契約判定軸が固定され、モックを先に作って依存切断検証を先行できる。

## Traceability

- Parent: `01_Plans/adr/ADR-0008-cli-tooling-plan.md`
- Related: `01_Plans/adr/ADR-0015-cli-scope-phasing.md`
- Related: `01_Plans/adr/ADR-0017-cli-security-ops-checks.md`
- Related: `01_Plans/issues/done/issue-CE4-api-cli-audit-integration.md`
- Related: `02_Architecture/api.md`
- Related: `02_Architecture/schemas.md`


## Stream C 注記（CE4接続契約の固定範囲）

- 本ADRで固定するのはAPI/CLI間の語彙と判定契約のみ（`decision/classification/equivalenceSatisfied`）。
- CLI終了コードの数値割当、HTTPステータスの詳細、監査配送方式は未固定（実装フェーズで確定）。
- モックを先に作る方式（`sourceBundleHash=mock:<64hex>`）でも、実物と同じ、安全側で停止する規律で扱う。
