# sui-sensemaking アーキテクチャドキュメント — 索引

> **読み方**: 目的に応じた「おすすめの読み順」が各セクションの冒頭にあります。
> 全ファイルを読む必要はありません。

## クイックナビゲーション

| あなたの目的 | 最初に読むべき文書 | 所要時間 |
|---|---|---|
| プロジェクト全体を理解したい | [アーキテクチャ概要](#アーキテクチャ概要) | 10分 |
| 認証フローを理解したい | [認証・認可](#認証認可-saasマルチテナント) | 15分 |
| API 仕様を調べたい | [API・データモデル](#apiデータモデル) | 5分 |
| 運用設定を知りたい | [運用・設定](#運用設定) | 5分 |
| コントリビュートしたい | [開発規約](#開発規約) | 10分 |

---

## アーキテクチャ概要

プロジェクト全体像を把握するための文書。

| 文書 | 形式 | 内容 |
|---|---|---|
| [`architecture.html`](architecture.html) | HTML | システム全体アーキテクチャ（図解） |
| [`enterprise_architecture.html`](enterprise_architecture.html) | HTML | エンタープライズ構成図 |
| [`module_architecture.html`](module_architecture.html) | HTML | モジュール依存関係・レイヤー図・ER図 |
| [`architecture-coherence-synthesis-2026-07-23.md`](architecture-coherence-synthesis-2026-07-23.md) | Markdown | アーキテクチャ一貫性の統合分析 |

**おすすめの読み順**: `architecture.html` → `module_architecture.html` → `enterprise_architecture.html`

---

## 認証・認可（SaaSマルチテナント）

SAML / OIDC / Broker / JWT の協調認証フローに関する文書。

| 文書 | 形式 | 内容 |
|---|---|---|
| [`saas_authentication_architecture.html`](saas_authentication_architecture.html) | HTML | 認証フロー全体図・OAuth PKCE シーケンス・JWT 検証パイプライン・テナント解決・セッション管理 |
| [`../01_Plans/adr/ADR-0063-saas-multitenant-trusted-auth-edge.md`](../01_Plans/adr/ADR-0063-saas-multitenant-trusted-auth-edge.md) | ADR | trusted auth edge 設計判断 |
| [`../01_Plans/adr/ADR-0064-saml-oidc-broker-jwt-coordinated-auth-flow.md`](../01_Plans/adr/ADR-0064-saml-oidc-broker-jwt-coordinated-auth-flow.md) | ADR | SAML→Broker→JWT 協調フロー計画 |
| [`../01_Plans/adr/ADR-0059-saas-tenant-authorization-boundary.md`](../01_Plans/adr/ADR-0059-saas-tenant-authorization-boundary.md) | ADR | SaaS テナント認可境界 |
| [`../01_Plans/adr/ADR-0061-saas-active-tenant-session-concurrency.md`](../01_Plans/adr/ADR-0061-saas-active-tenant-session-concurrency.md) | ADR | アクティブテナントセッション |
| [`../01_Plans/adr/ADR-0020-oidc-saml-mock-idp-sp-profile.md`](../01_Plans/adr/ADR-0020-oidc-saml-mock-idp-sp-profile.md) | ADR | 認証責務境界・Mock SP/IdP |
| [`../01_Plans/design/agent_registrations_tenant_binding.md`](../01_Plans/design/agent_registrations_tenant_binding.md) | 設計書 | agent テナントバインディング設計案 |
| [`../01_Plans/design/mcp_saas_multitenant_support.md`](../01_Plans/design/mcp_saas_multitenant_support.md) | 設計書 | MCP saas-multitenant 設計案 |

**おすすめの読み順**: `saas_authentication_architecture.html`（図解）→ ADR-0063（判断）→ ADR-0064（計画）

---

## API・データモデル

| 文書 | 形式 | 内容 |
|---|---|---|
| [`api.md`](api.md) | Markdown | API 仕様（全エンドポイント・認可・エラー） |
| [`schemas.md`](schemas.md) | Markdown | データモデル・テーブル定義・型 |
| [`data_model_operations_overview.html`](data_model_operations_overview.html) | HTML | データモデル操作俯瞰図 |
| [`sensemaking_semantic_model.md`](sensemaking_semantic_model.md) | Markdown | Evidence / Observation / Hypothesis / Synthesis / Review / Decisionと、provenance・authority・lifecycleの概念境界（L0 Planned） |
| [`sensemaking_artifact_contract_v1alpha1.md`](sensemaking_artifact_contract_v1alpha1.md) | Markdown | logical artifact / exact revision / provenance / Review / Authority transition / Review Capsuleのv1alpha1契約 |
| [`runtime_parameter_registry.md`](runtime_parameter_registry.md) | Markdown | 全環境変数一覧（プロファイル別推奨値付き） |
| [`hil_rs_01_a1_minimum_interface_contract.md`](hil_rs_01_a1_minimum_interface_contract.md) | Markdown | HIL-RS インターフェース契約 |

**おすすめの読み順**: `sensemaking_semantic_model.md`（将来の意味境界）→ `sensemaking_artifact_contract_v1alpha1.md`（identity / provenance / authority）→ `schemas.md`（現行永続モデル）→ `api.md`（API）→ `runtime_parameter_registry.md`（設定）

---

## 運用・設定

| 文書 | 形式 | 内容 |
|---|---|---|
| [`deployment.md`](deployment.md) | Markdown | デプロイ手順 |
| [`../04_Documentation/configuration.md`](../04_Documentation/configuration.md) | Markdown | ユーザ向け設定ガイド |
| [`../03_Implement/deploy/broker/README.md`](../03_Implement/deploy/broker/README.md) | Markdown | Keycloak ブローカーセットアップ手順 |
| [`../03_Implement/deploy/broker/docker-compose.yml`](../03_Implement/deploy/broker/docker-compose.yml) | YAML | ブローカー Docker Compose |

---

## ビジネス意図・要件

| 文書 | 形式 | 内容 |
|---|---|---|
| [`business-intent-boundary-and-phases.html`](business-intent-boundary-and-phases.html) | HTML | ビジネス意図・フェーズ境界 |
| [`business-intent-extension-analysis-2026-08-04.md`](business-intent-extension-analysis-2026-08-04.md) | Markdown | 拡張分析 |
| [`business-intent-step0-action-script-2026-08-05.md`](business-intent-step0-action-script-2026-08-05.md) | Markdown | Step 0 アクションスクリプト |
| [`value_traceability.md`](value_traceability.md) | Markdown | 価値トレーサビリティ |
| [`activation-scenarios-requirements-2026-07-23.md`](activation-scenarios-requirements-2026-07-23.md) | Markdown | アクティベーションシナリオ要件 |

---

## LLM・AI

AI 支援機能（レイアウト提案、マージ候補、ナラティブ生成など）の設計・実装・運用。

| 文書 | 形式 | 内容 |
|---|---|---|
| [`llm_provider_spec.md`](llm_provider_spec.md) | Markdown | LLM プロバイダ仕様（`/generate` 契約・タスク別出力スキーマ） |
| [`llm_input_ir_spec.md`](llm_input_ir_spec.md) | Markdown | LLM 入力 IR 仕様（プロンプト構築・文書表現） |
| [`llm_quality_strategy.md`](llm_quality_strategy.md) | Markdown | LLM 品質戦略（SLO・フォールバック・検証） |
| [`llm_runtime_constraints.md`](llm_runtime_constraints.md) | Markdown | LLM 実行時制約（タイムアウト・サイズ上限・同時実行） |
| [`llm_escalation_policy.html`](llm_escalation_policy.html) | HTML | LLM エスカレーションポリシー（intermediate/final_judgement ルーティング） |

**運用ガイド**:

| 文書 | 形式 | 内容 |
|---|---|---|
| [`../03_Implement/deploy/LLM_QUICKSTART.md`](../03_Implement/deploy/LLM_QUICKSTART.md) | Markdown | LLM クイックスタート（mock/実LLMの起動・設定・トラブルシューティング） |
| [`../04_Documentation/local_llm_ops_guide.md`](../04_Documentation/local_llm_ops_guide.md) | Markdown | 実 LLM 運用ガイド（アダプタ作成・デプロイ） |

**おすすめの読み順**: `LLM_QUICKSTART.md`（即実践）→ `llm_provider_spec.md`（仕様）→ `llm_escalation_policy.html`（発展）

---

## 開発規約

| 文書 | 形式 | 内容 |
|---|---|---|
| [`coding_standards.md`](coding_standards.md) | Markdown | コーディング規約 |
| [`contract_reading_guide.md`](contract_reading_guide.md) | Markdown | 契約文書の読み方ガイド |
| [`contract_consolidation_inventory.md`](contract_consolidation_inventory.md) | Markdown | 契約統合インベントリ |
| [`functional-dependency-integrity-2026-08-06.html`](functional-dependency-integrity-2026-08-06.html) | HTML | 機能依存関係整合性 |

---

## 全 ADR 一覧（認証関連のみ）

この表は関連ADRへの入口です。採択・置換などの状態は各ADR本文を正とし、この索引では複製しません。

| ADR | 概要 |
|---|---|
| ADR-0020 | OIDC/SAML 認証アーキテクチャ |
| ADR-0059 | SaaS テナント認可境界 |
| ADR-0061 | アクティブテナントセッション |
| ADR-0063 | trusted auth edge（JWT 検証） |
| ADR-0064 | SAML/OIDC/Broker/JWT 協調フロー |

全 ADR 一覧は [`01_Plans/adr/`](../01_Plans/adr/) を参照。

---

## テナント関連 Issue の入口

この表は、Architectureを追うときに関連しやすいIssue IDを見つけるための**トピック索引**です。Issueのライフサイクル状態はここでは管理しません。

- activeなIssueの正本: [`01_Plans/issues/`](../01_Plans/issues/)
- 完了したIssueの正本: [`01_Plans/issues/done/`](../01_Plans/issues/done/)

Issueがactiveからdoneへ移動しても、このArchitecture索引へ状態を複製して追随させません。現在の状態・完了根拠・残条件はIssue正本で確認してください。

| Issue | 概要 |
|---|---|
| SAAS-TENANT-01 | テナント基盤・ストレージ |
| SAAS-TENANT-AUTHEDGE-01 | trusted auth edge 実装 |
| SAAS-TENANT-FK-01 | 監査テーブル複合 FK |
| SAAS-TENANT-FK-02 | 大文字小文字非依存 index |
| SAAS-TENANT-FK-03 | レガシー identity lookup index |
| SAAS-TENANT-MIGRATION-01 | downgrade データ安全 |
| SAAS-TENANT-CAP-01 | null membership と capability |
| SEC-HTTP-02 | 403/404 非対称性 |
| SAAS-TENANT-SURFACE-01 | フロントエンド呼出し元分類 |
| SAAS-TENANT-UX-01 | provider-status 生成ガード外 |
| SAAS-TENANT-BUDGET-01 | CB/PB 宣言 |
| SAAS-TENANT-E2E-01 | AI mutation E2E instrumentation |
| QA-E2E-SAAS-01 | TenantSession UI E2E coverage |
