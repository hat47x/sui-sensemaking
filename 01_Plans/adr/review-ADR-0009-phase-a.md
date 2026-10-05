# ADR-0009 Phase Aレビュー報告 — 4文書レビュー確定

- Status: Accepted (Phase A complete)
- Date: 2026-03-02
- Scope: `02_Architecture/llm_provider_spec.md`, `llm_runtime_constraints.md`, `llm_quality_strategy.md`, `02_Architecture/llm_escalation_policy.html`
- Related: `01_Plans/adr/ADR-0009-local-llm-integration.md`

## 1) Plan（照合観点）

Phase Aでは、以下4観点で文書間照合を実施した。

1. 語彙整合
   - provider語彙を `none | fixture | local | external` へ統一。
   - `safeMode` 表記を統一し、外部送信制約との関係を固定。
2. 責務境界
   - provider specは「I/Fと監査契約」、runtime constraintsは「実行環境制約」、quality strategyは「ゲート基準」、escalation policyは「外部送信の運用条件」に責務分離。
3. fail-safe
   - default無効（`SUI_LLM_PROVIDER=none`）と `SUI_LLM_ESCALATION_ENABLED=false` を4文書で一致。
   - `SUI_LLM_ESCALATION_ENABLED=false` 時にexternalへフォールバックしない規則を固定。
4. 運用条件
   - opt-in条件（local/external）とallowlist-only outboundを明文化。

## 2) Execute（差分表と確定案）

| 論点 | 変更前ギャップ | 確定案 |
|---|---|---|
| provider既定 | provider specは`none`既定、escalation policyはLocal既定で不一致 | システム既定を`none`で統一。localは「有効化時の標準経路」に変更 |
| provider語彙 | `large-scale` / `external strong-model` / `openai` が混在 | `none | fixture | local | external` に統一 |
| opt-in条件 | local/externalの有効化条件が文書ごとに曖昧 | localは明示opt-in、externalは`SUI_LLM_ESCALATION_ENABLED=true`+allowlist-only outbound必須 |
| fail-safe | 無効時の外部フォールバック禁止が明示不足 | runtime + qualityで「無効時external不使用」を明文化 |
| 監査整合 | provider監査キーの値集合が分散 | provider監査値を4文書の語彙に合わせて固定 |

## 3) Verify（相互参照・矛盾ゼロ確認）

確認結果は次のとおりです。

- 4文書とも `SUI_LLM_PROVIDER=none` を既定として扱う。
- 4文書ともexternal送信はopt-in + 制約付き（`SUI_LLM_ESCALATION_ENABLED=true` とallowlist-only outbound）で一致。
- quality strategyの必須ゲートにsafeModeとfail-safe（外部不使用）を含め、escalation policyと矛盾なし。
- runtime constraintsの実行モードはprovider語彙と整合し、default無効・外部禁止（通常時）を保持。

## 4) Report（完了判定 / 未解決論点）

### Phase A完了判定

- 判定: **完了**
- 根拠は次のとおりです。
  - 対象4文書の語彙・責務境界・fail-safe・運用条件の矛盾を解消。
  - 「コード変更なしでも完了判定できるレビュー成果物」として本報告を追加。

### 未解決論点（Phase B以降へ送る）

1. `external` providerの具体的接続先命名（ベンダ中立名の運用ガイド詳細化）。
2. `safeMode` の赤線化ルール詳細（フィールド単位）を運用手順へ落とし込む粒度。
3. 監査ログ項目の保存期間・マスキング基準の運用設計。
