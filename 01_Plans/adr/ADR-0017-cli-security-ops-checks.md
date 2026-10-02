# ADR-0017: CLI セキュリティ/運用 Gate と受入チェック（ADR-0008分割）

- Status: Accepted
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Derived-from: `01_Plans/adr/ADR-0008-cli-tooling-plan.md`

## Context

CLI導入では、機能追加より先に「漏洩しない・監査できる・運用手順が崩れない」を満たす必要がある。
本ADRは安全・運用の判定軸だけを独立し、仕様検討と混線しないようにする。

## Decision

### 1) 今決めること（固定）

1. 秘密情報（APIキー/トークン/認証ヘッダ）は `--debug` を含めログ出力禁止。
2. CLI設定の優先順位は `CLI引数 > 環境変数 > 設定ファイル > デフォルト`。
3. CLIの実行はAPI監査ログに帰属可能であることを前提要件とする。
4. SafeModeと矛盾する共有/公開導線をCLIで標準化しない。
5. CE4監査ゲートでは `proposal-only` を強制し、`auto-apply` / `auto-confirm` / `auto-publish` をポリシー違反としてfail-closed停止する。
6. CE1未整備時は `sourceBundleHash=mock:<64hex>` を許容し、実実装依存を切断した監査検証を許可する（同一fail-closed規律を適用）。

### 2) 後で決めること（保留）

- 鍵ローテーションの運用周期。
- principal識別子のマスキング方式（可逆/不可逆の選択）。
- MCP連携時の監査帰属フォーマット詳細。

## Security/Ops Gate（判定可能条件）

### Gate-S1: Secret Handling

- 判定条件は次のとおりです。
  - 機密情報がログ・エラー出力・監査エクスポートに平文露出しない。
- 検証粒度（実装後）は次のとおりです。
  - `pytest 03_Implement/backend/tests/cli_security/test_secret_redaction.py`

### Gate-S2: Audit Attribution

- 判定条件は次のとおりです。
  - CLI起点実行がprincipal/request-idと紐づいて追跡可能。
  - 監査4イベント `query -> bundle -> proposal -> apply` が同一 `equivalenceKey` で連結可能。
  - API/CLI同値判定が `equivalenceKey AND bundleHash` のAND条件で再演算可能。
- 検証粒度（実装後）は次のとおりです。
  - `pytest 03_Implement/backend/tests/cli_security/test_audit_attribution.py`

### Gate-S3: SafeMode Alignment

- 判定条件は次のとおりです。
  - SafeMode既定ONに反する操作フローをデフォルト動線にしない。
- 検証粒度（実装後）は次のとおりです。
  - `pytest 03_Implement/frontend/tests/safe_mode/test_cli_alignment_policy.py`

### Gate-O1: Operations Consistency

- 判定条件は次のとおりです。
  - CLI運用手順の変更が `04_Documentation/operations.md` に同期される。
  - CE4契約変更時は `01_Plans/issues/done/issue-CE4-api-cli-audit-integration.md` / `02_Architecture/api.md` / `ADR-0016` / `ADR-0017` の4文書同期を必須とする（契約監査ドリフト防止）。
- 検証粒度（Docs運用）:
  - PRチェックリストで「CLI運用変更時の同時更新」を必須項目化。

## DoD

1. Gate-S1/S2/S3/O1の合否判定がYes/Noで記録できる。
2. 各Gateに最低1つの検証コマンドまたは運用チェック項目が紐づく。
3. セキュリティ要件と機能仕様の責務が分離される（機能詳細はADR-0016へ委譲）。

## Non-Goals

- 認証方式（OAuth/API key）の最終選定。
- 監査基盤そのものの実装方式確定。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | CLI導入では機能追加より先に「漏洩しない・監査できる・運用手順が崩れない」を満たす必要がある。安全・運用の判定軸を独立し仕様検討と混線させない | 機能: 秘密情報（APIキー/トークン/認証ヘッダ）は--debugを含めログ出力禁止。データ: CLIの実行はAPI監査ログに帰属可能であることを前提要件とする |
| **データ設計** | CLI設定の優先順位はCLI引数>環境変数>設定ファイル>デフォルト。SafeModeと矛盾する共有/公開導線をCLIで標準化しない | 業務: CLIの機能検討より前に安全/運用の不成立を検出する。機能: 監査観点レビューを独立実施しレビュー抜けを減らす |
| **機能設計** | CE4監査ゲートでproposal-onlyを強制し、auto-apply/auto-confirm/auto-publishをポリシー違反としてfail-closed停止。CE1未整備時はsourceBundleHash=mockを許容し実装依存を切断した監査検証を許可 | 業務: 認証方式（OAuth/API key）の最終選定と監査基盤の実装方式確定は保留。データ: CE1依存未実装でもmock接続で監査ゲート検証を継続できる |

## Consequences

- CLIの機能検討より前に、安全/運用の不成立を検出できる。
- 監査観点レビューを独立実施でき、レビュー抜けを減らせる。
- CE1依存が未実装でもmock接続で監査ゲート検証を継続でき、契約適合監査を実装待ちから分離できる。

## Traceability

- Parent: `01_Plans/adr/ADR-0008-cli-tooling-plan.md`
- Related: `01_Plans/adr/ADR-0015-cli-scope-phasing.md`
- Related: `01_Plans/adr/ADR-0016-cli-command-contract.md`
- Related: `01_Plans/issues/done/issue-CE4-api-cli-audit-integration.md`
- Related: `THREAT_MODEL.md`
- Related: `04_Documentation/security.md`
- Related: `04_Documentation/operations.md`
- Related: `01_Plans/adr/ADR-0019-e2e-verification-policy-and-compose-runbook.md`


## CE4責務境界（API/CLI/Audit）

- API: proposal検証要求を受理し、監査分類（`validation_failed|audit_violation|equivalence_violation|policy_violation`）を返す。
- CLI: API同値条件（`equivalenceKey AND bundleHash`）を再演算可能な入力を必須化し、`classification != ok` を非0終了にする。
- Audit: 4イベント順序と必須キー検証を実施し、欠損/逆順/矛盾をfail-closed停止する。
