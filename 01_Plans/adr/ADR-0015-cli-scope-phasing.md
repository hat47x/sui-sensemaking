# ADR-0015: CLI 対象範囲と段階導入（ADR-0008分割）

- Status: Accepted
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Derived-from: `01_Plans/adr/ADR-0008-cli-tooling-plan.md`

## Context

CLI計画の実装着手条件が曖昧なままでは、MVP後に「何を確定済みとして進めるか」が揺れやすい。
本ADRは、対象範囲と導入フェーズだけを責務として固定し、コマンド詳細（ADR-0016）と安全運用（ADR-0017）を分離する。

## Decision

### 1) 本ADRで **今決めること（確定）**

1. CLIは APIクライアント として振る舞い、CLI独自ドメインロジックを持たない。
2. 対象ユーザーは「管理者 / 運用担当 / パワーユーザー / CI利用開発者」に限定する。
3. フェーズ順序は `X-0 -> X-1 -> X-2 -> X-3 -> X-4` を固定する。
4. 実装着手の判定は、各フェーズのExit Gateを満たした場合のみ許可する。

### 2) 本ADRで **後で決めること（保留）**

- 各フェーズ内で提供する個別コマンドの完全一覧。
- APIキー/プリンシパルモデルの最終スキーマ。
- MCP連携の適用範囲（allow-list具体値、監査帰属の最終設計）。

### 3) フェーズ責務（重複排除済）

- **Phase X-0（仕様固定）**: 依存関係・前提・Gate定義の合意（実装禁止）。
- **Phase X-1（最低限Ops）**: import/export/validateなど最小運用導線。
- **Phase X-2（権限/監査）**: 認証主体・監査ログ最小要件の導入。
- **Phase X-3（自動化拡張）**: バッチ/CIの再実行安全性を含む運用拡張。
- **Phase X-4（MCP連携）**: CLI利用範囲を統制したAI連携。

### 4) Phase X-2.5（CE4 contract freeze; docs-only）

- Entry: ADR-0016/0017と `02_Architecture/api.md` のCE4契約語彙が未整合である。
- Exit: API/CLI/監査の接続契約（同値条件・失敗分類・proposal-only・4イベント順序）が3文書で同期される。
- Non-goal: 実装方式（保存先/QoS/署名/終了コード数値）の確定。

## Gate（判定可能条件）

### Gate-A: Architecture整合（ADR-0001 / 02_Architecture整合）

- 判定対象は次のとおりです。
  - `02_Architecture/schemas.md` に未定義の概念をCLI計画で確定扱いしていない。
  - `02_Architecture/api.md` に存在しないI/Fを必須コマンドとして宣言していない。
- 判定方法（Docsレビュー）:
  - CLI ADR群内の「確定事項」節をレビューし、上記2条件の逸脱が0件。

### Gate-B: Safety整合（THREAT_MODEL / SafeMode整合）

- 判定対象は次のとおりです。
  - SafeMode既定ON・漏洩防止方針と矛盾する運用を要求していない。
- 判定方法（Docsレビュー）:
  - ADR-0017の「禁止事項」に反する記述がADR-0015内にないこと。

### Gate-C: Ops整合（04_Documentation整合）

- 判定対象は次のとおりです。
  - `04_Documentation/operations.md` と矛盾する運用前提を追加していない。
- 判定方法（Docsレビュー）:
  - 運用手順に影響する差分がある場合、同一PRで関連文書更新が列挙されていること。

## DoD（Definition of Done）

1. フェーズごとにEntry/Exitが明記され、次の1手が単文で説明できる。
2. 「確定」と「保留」が見出しで分離され、混在しない。
3. Gate-A/B/Cの判定者（設計レビュー）が同じ基準で合否判定できる。

## Non-Goals

- CLIの実装技術（言語・配布形式）の確定。
- API仕様の拡張提案そのものの確定。
- 運用ポリシーの新規追加。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | CLI計画の実装着手条件が曖昧なままではMVP後に「何を確定済みとして進めるか」が揺れやすい。対象範囲と導入フェーズを責務として固定し、コマンド詳細（ADR-0016）と安全運用（ADR-0017）を分離する | 機能: CLIはAPIクライアントとして振る舞いCLI独自ドメインロジックを持たない。データ: 対象ユーザーは管理者/運用担当/パワーユーザー/CI利用開発者に限定 |
| **データ設計** | フェーズ順序（X-0仕様固定→X-1最低限Ops→X-2権限/監査→X-3自動化拡張→X-4 MCP連携）を固定。各フェーズのExit Gateを満たした場合のみ実装着手を許可 | 業務: 実装前レビューで「範囲の合意不在」による手戻りを減らす。機能: premature commitを抑制するためフェーズ進行の可否をGateで判定可能にする |
| **機能設計** | Phase X-2.5（CE4 contract freeze; docs-only）でAPI/CLI/監査の接続契約が3文書で同期されることをExit条件にする。実装方式（保存先/QoS/署名/終了コード数値）の確定はNon-goal | 業務: CLIの実装技術・API仕様拡張・運用ポリシーの新規追加は保留。データ: 個別コマンドの完全一覧・APIキー/プリンシパルスキーマ・MCP適用範囲は後で決める |

## Consequences

- 実装前レビューで「範囲の合意不在」による手戻りを減らせる。
- フェーズ進行の可否がGateで判定可能になり、premature commitを抑制できる。

## Traceability

- Parent: `01_Plans/adr/ADR-0008-cli-tooling-plan.md`
- Related: `01_Plans/adr/ADR-0016-cli-command-contract.md`
- Related: `01_Plans/adr/ADR-0017-cli-security-ops-checks.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `02_Architecture/api.md`
- Related: `02_Architecture/schemas.md`
- Related: `THREAT_MODEL.md`
- Related: `04_Documentation/operations.md`
