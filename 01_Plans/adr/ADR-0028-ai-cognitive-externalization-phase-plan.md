# ADR-0028: 認知外在化AI要件の文書体系統合と次フェーズ実行計画

- Status: Superseded by `ADR-0090` (2026-10-01)
- Date: 2026-04-10
- Deciders: Project Maintainers
- Scope: `00_Prompt/`, `01_Plans/adr/`, `02_Architecture/`, `03_Implement/frontend/`, `03_Implement/backend/`, `04_Documentation/`
- Source Spec: `00_Prompt/ai_cognitive_externalization_requirements.md`
- Related: `ADR-0001`, `ADR-0007`, `ADR-0026`, `ADR-0027`, `02_Architecture/llm_input_ir_spec.md`, `02_Architecture/llm_quality_strategy.md`

> **Current reading note (2026-10-01):** 本ADRのCEフェーズ、Issue分割、Decision Queue、完了ゲートは現在の「1人の開発者＋生成AI」運用では使用しない。認知支援の現行方針は `ADR-0090`、価値と証拠階層は `ADR-0089`、安全境界は現行 `domain.md` / LLM Architectureを正本とする。本書は履歴として保持する。

## Context

`00_Prompt/ai_cognitive_externalization_requirements.md` が追加され、sui-sensemaking を「生成AIの認知外在化フレームワーク」として再定義する要件が提示された。
一方、既存の文書体系では以下が未固定である。

1. 新規要件の参照優先順位（Read Order）
2. 00〜04 レイヤへの分解責務（どの文書/層で何を決めるか）
3. 次フェーズの実行単位・受入条件・停止条件

この未固定状態のまま実装を開始すると、
- Prompt要件がArchitecture/Implementへ未接続のまま分岐実装される
- AI機能がチャット主導へ逸脱し、canvas主従関係が崩れる
- safeMode既定ON/未レビュー保護が機能単位で後退する

リスクがある。

## Decision

認知外在化要件を「上位要件（Prompt）→ 設計（Architecture）→ 実装（Implement）→ 運用（Documentation）」へ段階接続するため、
以下の5フェーズを固定する。

### D1. 文書体系統合（即時適用）

- `ai_cognitive_externalization_requirements.md` を Read Order に追加し、`domain.md`/`handoff.md` の直後に読む。
- 計画の正本は本ADR（0028）とし、機能詳細の正本は `00_Prompt/ai_cognitive_externalization_requirements.md` とする。
- `01_Plans` の関連Issue/メモは本ADRのフェーズID（CE-X）を参照キーとして分割する。

### D2. フェーズ構成（CE-0〜CE-4）

#### CE-0: Contract Freeze（設計前固定）

目的: 認知外在化機能の非後退契約を先に固定する。

- Fixed Contracts:
  - AIは候補生成器（自動確定禁止）
  - Consensus Graph 直接更新禁止（patch提案経由のみ）
  - safeMode既定ON・未レビュー出力の既定抑止
  - Human context と AI projection context の分離
- 成果物:
  - `02_Architecture` への契約追記（API/IR/review attribution/safeMode境界）
  - Contract IDs を issue で凍結

##### CE-0 Contract Matrix（固定契約）

| Contract ID | Responsibility | Input | Output | Prohibitions |
| --- | --- | --- | --- | --- |
| `CE0-CTX-IF` | ContextQuery/ContextBundleの最小I/F固定 | `goal/scope/depth/constraints/reviewFilter/safeModePolicy/outputMode` | deterministic `bundleHash` を持つ ContextBundle | Query Previewバイパス、非決定論bundle |
| `CE0-SAFEMODE-IF` | safeMode既定ONと未レビュー保護を固定 | `safeMode=true` 時のreview state情報 | `allowUnreviewedText=false` を既定適用 | 未レビュー本文のAI入力混入、保護緩和 |
| `CE0-REVIEW-IF` | review状態遷移の責務境界を固定 | `human_reviewed`/`unreviewed` state | 人手操作でのみ `human_reviewed` 昇格 | AIによるreview自動昇格 |
| `CG-01..05` | Working / Projection / Consensus責務固定 | KJ構造 + query constraints + actor/modelTier | proposal-only運用（patch+approval経由） | Consensus直接更新、監査欠損成功扱い |

#### CE-1: Context Query / Bundle 基盤

目的: AI問い合わせを自然言語任せにせず、構造化コンテキストへ固定する。

- 必須実装:
  - ContextQuery（対象/深さ/範囲/制約）
  - ContextBundle（deterministic projection）
  - Query Preview UI（送信前確認）
- 検証:
  - 同一queryでbundleが再生成一致
  - safeMode時の除外ルール適用
  - diff/auditログ生成

#### CE-2: 低リスクAI支援（候補提示のみ）

目的: 可逆・比較可能なAI支援を先行導入する。

- 対象機能:
  - 島タイトル候補
  - reviewed-only既定のB型文章ドラフト
  - contradiction/evidence由来の論点候補
- 非許可:
  - 自動採用・自動公開・review状態自動昇格
  - 中間処理モデルによる最終採否判定（accept/reject/merge/finalize）
- 検証:
  - すべてpatch/diffとして比較可能
  - `unreviewed` 表示がUI/データで保持
  - 中間処理（分類/要約/整形/条件分岐）と最終判断のルーティングが分離される

#### CE-3: Patch Workspace と Preset 運用

目的: AI提案を比較・部分採用・保留できる運用面を成立させる。

- 対象機能:
  - AI Patch Proposal Workspace
  - Query Presets
  - AI-aware Perspective Mode（人間向け視座と分離）
- 検証:
  - 部分採用/保留/廃棄が可逆
  - Perspective切替が Consensus Graph を変更しない

#### CE-4: API/CLI/監査統合

目的: 再現可能運用と監査性を実運用導線へ接続する。

- 対象機能:
  - ContextQuery/Bundle の API/CLI 提供
  - batch評価・品質回帰チェック
  - query log / generated patch / apply log の監査導線
  - Multi-Model Routing 監査（`routingStage`, `provider`, `model`, `sourceBundleHash`, `proposalId`）
- 検証:
  - CLI/APIで同一queryが同一bundleを生成
  - 監査ログの欠落なし
  - `final_judgement` 経路障害時に `held` へ fail-safe 遷移する

### D3. フェーズ依存関係

- `CE-0 -> CE-1 -> CE-2 -> CE-3 -> CE-4` を固定順序とする。
- 並列許可は同一CE内のサブタスクに限定する。
- `CE-1` 未完了で `CE-2` 実装を開始してはならない。

### D4. Exit Criteria（各フェーズ共通）

各CEは、次を満たした場合のみ Done とする。

1. **Spec Sync**: 00/01/02/04の関連文書に矛盾がない。
2. **Safety**: safeMode既定ONと未レビュー保護に後退がない。
3. **Reversibility**: AI提案は採用/保留/破棄が可逆。
4. **Auditability**: query/patch/apply の追跡が可能。
5. **Fact-based Verify**: テスト/検証コマンド結果で説明可能。

### D5. Stop Conditions（即停止）

- AI出力の自動確定・自動公開を要求する仕様変更。
- `reviewed` 状態をAI自動付与する変更。
- safeMode既定ONまたはshare/export保護を後退させる変更。
- Human context と AI projection context を同一表現へ強制する変更。

### D6. フェーズ別の実行ブレークダウン（具体化）

各フェーズを「A:設計固定 / B:実装 / C:検証 / D:文書同期」の4ステップで実行する。

#### CE-0 ブレークダウン

- CE0-A（Plan）
  - `llm_input_ir_spec.md` / `llm_quality_strategy.md` / `review_attribution.md` の契約空白を抽出。
  - Contract IDs を `CE0-CTX-IF`, `CE0-SAFEMODE-IF`, `CE0-REVIEW-IF` として予約。
- CE0-B（Docs）
  - safeMode既定ON・未レビュー保護・Consensus Graph直接更新禁止を Architecture 文書へ追記。
- CE0-C（Verify）
  - ドリフト検知: `rg -n "safeMode|unreviewed|Consensus Graph|projection" 00_Prompt 01_Plans/adr 02_Architecture 04_Documentation`
    <!-- retired-vocabulary: historical — 旧称の再出現そのものを検知対象にする -->
  - 旧称の再出現検知: `rg -n "Core Graph" 02_Architecture` が、履歴注記として明示された箇所以外を返さないこと。
    正規の検証は `DC-VOCAB-001`（`docs_contract_checks.py`）が行う。
    **旧称を検索語にしていた従来のコマンドは、改名が正しく行われると何も返さなくなり黙って通る。**
    <!-- /retired-vocabulary -->
- CE0-D（Record）
  - issue メモへ Contract IDs / Stop Conditions / 未確定論点（Pending）を記録。

**CE-0 Done条件**
- Contract IDs が1箇所に集約され、重複定義0件。
- `safeMode` と `unreviewed` の後退表現が0件。
- 影響範囲（In Scope）と非対象（Out of Scope）が issue/ADR/Architecture で一致している。

#### CE-1 ブレークダウン

- CE1-A（Interface）
  - ContextQuery の最小I/Fを固定（target/depth/scope/mode/constraints）。
  - ContextBundle の最小I/Fを固定（selected/relation/evidence/contradiction/review flags/truncation meta）。
- CE1-B（Implement）
  - frontend: Query Preview パネル（送信前に対象範囲と制約を表示）。
  - backend/worker: deterministic bundle generator。
- CE1-C（Verify）
  - 決定論テスト: 同一入力でbundle hash一致。
  - 安全テスト: safeMode時に未レビュー本文が既定除外される。
- CE1-D（Sync）
  - `04_Documentation/operations.md` へ Query Preview 運用手順を追加。

**CE-1 Done条件**
- 同一query再実行で bundle hash 一致率100%。
- Query Previewなしで送信する経路が残っていない。

#### CE-2 ブレークダウン

- CE2-A（Usecase設計）
  - タイトル候補 / B型ドラフト / 反対視点提案の I/O 契約を定義。
- CE2-B（Implement）
  - すべてのAI応答を patch proposal として保存。
  - UIで「AI提案」「未レビュー」「レビュー済」を識別表示。
  - `intermediate` ステージは Groq 上の Llama/Qwen 等を許可し、候補生成専用に固定。
  - `final_judgement` ステージは Claude/GPT-5 等の高推論tierに固定（proposal-only）。
- CE2-C（Verify）
  - 自動適用経路が存在しないことをルーティング/イベントで確認。
  - draft出力の採用・破棄が差分履歴に残ることを確認。
  - 中間処理モデルが `accept/reject/merge/finalize/publish` を実行できないことを契約テストで確認。
- CE2-D（Sync）
  - `04_Documentation/narratives.md` と `04_Documentation/security.md` に利用上の制約を同期。

**CE-2 Done条件**
- 生成結果は全件 patch/diff で追跡可能。
- `reviewed` の自動昇格が0件。
- 中間処理層と最終判断層の責務混線（routing violation）が0件。

#### CE-3 ブレークダウン

- CE3-A（Workspace設計）
  - 複数パッチ並置・部分採用・保留・廃棄の状態遷移を定義。
- CE3-B（Implement）
  - Patch Workspace UI と Query Presets を追加。
  - AI-aware Perspective を表示レイヤに限定（Consensus Graph 非破壊）。
- CE3-C（Verify）
  - 部分採用後のロールバック復元をE2Eで確認。
  - Presetによる query 再現性（同preset=同query）を確認。
- CE3-D（Sync）
  - `03_Implement/frontend/docs/e2e_testing.md` へCE-3検証シナリオを追加。

**CE-3 Done条件**
- 部分採用/保留/廃棄の状態遷移が監査ログに残る。
- Perspective変更で document の実データ差分が発生しない。

#### CE-4 ブレークダウン

- CE4-A（公開契約）
  - ContextQuery/Bundle API schema を固定し version を採番。
- CE4-B（Implement）
  - CLI から query 実行・bundle出力・patch適用dry-run を実装。
  - 監査ログ（query/generated/apply）を統合フォーマット化。
  - 監査ログへ `routingStage` と `provider/model` を追加し、段階別追跡を可能化。
- CE4-C（Verify）
  - API/CLI/GUI の同値性テスト（同query同bundle）。
  - 回帰テストに品質メトリクス（coverage / rejected reason分類）を追加。
  - `final_judgement` 経路停止時に `held` 遷移し、自動公開へ進まないことを確認。
- CE4-D（Sync）
  - `04_Documentation/operations.md` / `local_llm_ops_guide.md` を運用手順で更新。

**CE-4 Done条件**
- API/CLI/GUI の同値性検証がCIで自動実行される。
- query/apply 監査ログの欠落率0%。
- intermediate/final_judgement の段階別監査追跡が可能。

### D7. 実行順序と並列化ルール（運用固定）

- 各CEは `A -> B -> C -> D` の順序固定。
- 並列は `B` ステップ内でのみ許可（frontend/backend/docs補助）。
- `C` 失敗時は必ず当該CEの `B` に戻し、次CEへ進まない。

### D8. 初期Issue分割テンプレート

- `issue-CE0-contract-freeze.md`
- `issue-CE1-context-query-bundle-foundation.md`
- `issue-CE2-low-risk-ai-assist.md`
- `issue-CE3-patch-workspace-presets.md`
- `issue-CE4-api-cli-audit-integration.md`

各IssueのACには最低限以下を必須化する。
1. safeMode後退なし
2. unreviewed保護維持
3. patch/diff監査可能
4. 再現コマンド明記

### D9. AIエージェントが sui-sensemaking を認知キャンバスとして識別・活用する具体方式（ACCI）

#### D9-1. ACCI（Agent Cognitive Canvas Identification）実行手順

AIエージェントは自由文入力をそのまま処理せず、次の順で sui-sensemaking を扱う。

1. **Canvas Signature 認識**
   - `document/view/patch` の3系統入力だけを受理。
   - `docId/version/updatedAt/safeMode/reviewState` が欠損する場合は停止（推測補完禁止）。
2. **KJ構造抽出**
   - KJ法データ構造（card/island/relation/pending）を一次データとして抽出。
   - 構造化コンテキスト（review flags, contradictions, evidence）はメタ層として重畳する。
3. **ContextQuery 合成**
   - `goal/scope/depth/constraints/reviewFilter/safeModePolicy/outputMode` を必須化。
   - default: `reviewedOnly=true`, `allowUnreviewedText=false`, `outputMode=patch_proposal`。
4. **ContextBundle 生成**
   - 同一Queryで同一bundleHashを生成する決定論経路のみ許可。
   - token超過時の切詰め順序を固定（reviewed evidence → contradiction → pending）。
5. **Patch Proposal 出力**
   - AI出力は `proposalId + diff + rationale` を必須化し、直接applyを禁止。

#### D9-2. 実行ガード（固定）

- Guard-01: SafeMode ON 時、未レビュー本文をAI入力へ含めない。
- Guard-02: `human_reviewed` は人間操作のみで遷移。
- Guard-03: Core/Consensus対象への書込は `applyPatch` 経路のみ。
- Guard-04: Query Preview を通過しない送信を拒否。
- Guard-05: `query/bundle/proposal/apply` の監査ログ4点セットが欠損した場合は失敗扱い。

### D10. AI活用方式の判断

#### D10-1. 論点

1. 人間向け空間文脈をAI入力へ直接含めるべきか。
2. Query Preview を任意化できるか。
3. 自動適用を許可するか。

#### D10-2. 決定

- 論点1（Gate-1）: Human Spatial Context は補助信号のみ。一次入力はKJ構造+構造化メタに限定。
- 論点2（Gate-1）: Query Preview は必須。バイパス禁止。
- 論点3（Gate-3相当）: 自動適用禁止を維持。

#### D10-3. 未確定在庫（人間承認キュー）

- `UNC-CE-01-01`: Query Preview UI配置（サイド/モーダル/固定）
- `UNC-CE-01-02`: bundle token budget 初期値（8k相当を初期提案）

<!-- retired-vocabulary: historical — 改名を決定した記録。ここでは旧称が正しい -->
### D11. Core Graph再考

追加指示を受け、Core Graphの役割を再検討し以下を決定する。

#### D11-1. 論点

1. AI単独運用（人間協調なし）を許可するか。
2. Core Graphは常に単一正本か、主体別グラフ統合を許可するか。
3. 高額モデルをhuman role、廉価モデルをagent roleに割り当てる代理構成を許可するか。

#### D11-2. 決定

- 決定A（Gate-1）:
  - Core Graphを **Consensus Graph（合意済み統合グラフ）** と再定義する。
- 決定B（Gate-1）:
  - 主体別に **Working Graph**（human/agent/role別）を許可する。
  - `mode=autonomous` オプションでAI単独運用を許可する。
- 決定C（Gate-2）:
  - model tier（high-cost/low-cost）運用は許可候補だが、actor責任と分離して記録するまで限定運用。

#### D11-3. 新グラフ位置づけ

1. **Working Graph(s)**: 主体ごとの探索・仮説・未確定保持グラフ。
2. **Context Projection Graph**: Working Graphから問い合わせ目的に投影する構造化コンテキスト。
3. **Consensus Graph（旧 Core Graph）**: 合意・適用済み結果を保持する統合グラフ。
<!-- /retired-vocabulary -->

#### D11-4. 整合原則（KJ法構造との整合）

- 構造化コンテキストは KJ法データ構造へのメタデータ拡張として実装する。
- メタデータが作図上省略されても、配置・関係・保留（pending）意味を破壊しない。
- Consensus Graph へ反映されるのは patch + approval を通過した差分のみ。

#### D11-5. 追加契約ID（CE-0で凍結）

- `CG-01`: Consensus Graph は合意済み状態のみ保持。
- `CG-02`: Working -> Consensus 遷移は patch + approval 必須。
- `CG-03`: autonomous mode でも safeMode/監査契約を緩和しない。
- `CG-04`: actor と modelTier を分離して記録する。
- `CG-05`: 構造化コンテキストはKJ法構造との互換を維持する。

#### D11-6. CE0影響範囲 / 非対象範囲

- 影響範囲（In Scope）:
  - 契約語彙（Working/Projection/Consensus, reviewed/unreviewed, safeMode）
  - Contract IDとGo/NoGo Gateの固定
  - CE-1以降で参照する最小I/F境界
- 非対象範囲（Out of Scope）:
  - CE-1以降の実装詳細（API payload詳細、UI配置、CLI UX、RBAC実装）
  - モデル選定/価格戦略の最終確定（`modelTier` は分離記録のみ凍結）

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | sui-sensemakingを「生成AIの認知外在化フレームワーク」として再定義する要件が追加された。未固定状態のまま実装するとPrompt要件がArchitecture/Implementへ未接続のまま分岐実装され、AI機能がチャット主導へ逸脱しcanvas主従関係が崩れるリスクがある | 機能: 認知外在化要件を「上位要件→設計→実装→運用」へ段階接続する5フェーズを固定。データ: safeMode既定ON・未レビュー保護が機能単位で後退しないようにする |
| **データ設計** | 新規要件の参照優先順位（Read Order）と00〜04レイヤへの分解責務（どの文書/層で何を決めるか）を固定。CE-1以降で参照する最小I/F境界を凍結 | 業務: 監査・差分・レビュー重視の既存方針と整合したAI拡張を進める。機能: CE-1以降の実装詳細（API payload・UI配置・CLI UX・RBAC実装）は非対象 |
| **機能設計** | 5フェーズ（CE-0基盤→CE-1 context→CE-2提案→CE-3構造化変更→CE-4監査統合）を実装順序として固定し低リスク導入（CE-1/2）を優先する。Contract IDとGo/NoGo Gateを固定 | 業務: AI機能がチャット主導へ逸脱しないようcanvas主従関係を維持。データ: モデル選定/価格戦略の最終確定は非対象（modelTierは分離記録のみ凍結） |

## Consequences

- 期待効果:
  - 追加された中核要件を既存体系へ衝突なく接続できる。
  - 実装順序が固定され、低リスク導入（CE-1/2）を優先できる。
  - 監査・差分・レビュー重視の既存方針と整合したAI拡張が進む。
  - Consensus/Working二層で、人間協調とAI単独運用を同一設計上で扱える。
- 副作用:
  - 初期フェーズで文書同期と契約固定の工数が増える。
  - 自動化より可逆性を優先するため、短期的な機能速度は抑制される。
  - グラフ層追加により運用・検証コストが増える。

## Alternatives

- 代替A（不採用）: 00_Prompt新規文書を参考扱いに留め、計画ADRを作らない。
  - 不採用理由: 実装優先順位が固定できず、層間ドリフトが増加する。
- 代替B（不採用）: 既存 HIL-RS-02 に追記し一本化する。
  - 不採用理由: HIL-RS運用論点と認知外在化機能計画が混在し、意思決定境界が不明瞭になる。

## Rollback

- 条件:
  - 上位文書（`domain.md`/`ADR-0001`）と整合しない要求が顕在化した場合
  - 既存SafeMode契約と両立できない場合
- 手順:
  1. CE進行を停止し、対象issueをDraftへ戻す。
  2. 本ADRに `Superseded by` を付与し、修正版ADRを起票する。
  3. 既に着手した実装はCE単位でrevertする。

## Traceability

- Derived-from: `00_Prompt/ai_cognitive_externalization_requirements.md`
- Related: `01_Plans/issues/done/issue-HIL-RS-02-next-phase-delivery-plan.md`
- Related: `02_Architecture/llm_input_ir_spec.md`
- Related: `02_Architecture/llm_quality_strategy.md`

## Stream A Contract/Governance Freeze Snapshot（for downstream lanes）

### Context
- CE0/CE1 の契約・統治を先に固定しないまま下流（CE2/CE4）を進めると、語彙衝突と責務境界の再解釈が発生する。

### Decision
- Snapshot ID を `SNAP-CE0-CE1-CONTRACT-GOVERNANCE-v1` として固定し、以下を downstream read-only で引き渡す。
  - `safeModeDefault=ON`
  - `overridePolicy=human_dual_control_only`
  - `queryPreviewRequired=true`
  - `decisionQueueTransition=Pending -> Approved | Pending -> Rejected`
  - 監査4点セット `query/bundle/proposal/apply` 必須
- 署名境界（APIシグネチャ/データ境界/責務分離）を契約値として凍結し、実装詳細は下流でのみ確定する。

### Consequences
- 後続ストリームは契約再定義を行わず、mock前提で分離検証を実施できる。
- 未承認確定化（Pending bypass）および safeMode 後退は即時 No-Go 判定になる。

## Stream A Dependency-Cut Design（Mock-first assumptions）

- Mockで分離可能な依存（contract-only）
  1. `ContextQueryV1` 生成器（Preview Gateを通した canonical query のみ受理）
  2. `ContextBundleV1` 生成器（`queryCanonicalHash` / `bundleHash` を固定返却）
  3. Proposal Envelope（`proposalId + diff + rationale`）
  4. Governance Gate（`go/conditional/no-go` 判定のみ）
- Mock前提
  - UI配置・操作導線は未確定のまま（契約語彙のみ固定）
  - Provider実装差分は contract adapter で吸収し、contract key追加は禁止
  - hash不一致は `409 nondeterministic_bundle` で fail-closed

## Stream A addendum（2026-05-06 / CE0 contract freeze linkage）

### Context
- CE0 Contract Freeze と HIL-RS A1最小I/F契約の接続点が曖昧だと、後続CEで契約再解釈が発生しうる。

### Decision
- CE0固定契約（proposal-only / safeMode既定ON / review昇格の人間責務）を、A1凍結契約 `HIL-RS-02-A1-CONTRACT-FREEZE-v1` と `schemaVersion=1.0.0` に明示的にリンクする。
- A2/A3相当の下流作業は read-only 契約参照 + mock検証に限定し、未承認事項の確定化を禁止する。

### Consequences
- CEフェーズ実行時の判定分岐が固定化され、`Pending` 残存時は `Hold/Needs-decision` を一貫適用できる。
- SafeMode境界後退や契約ID再定義を起点とするドリフトを抑止できる。

## Stream A governance gate binding（2026-05-10）

### Context
- CE系の契約凍結（CE0）とHIL-RS A1凍結が別系統で運用されるため、遷移制約の単一解釈を明示しないとドリフトが起こる。

### Decision
- CE系/ HIL系の双方で `Pending bypass` を禁止し、承認遷移は `Pending -> Approved | Pending -> Rejected` のみ許可する。
- Contract freezeは read-only（ID追加/改名/削除禁止）で維持し、承認待ちは `Hold/Needs-decision` を適用する。

### Consequences
- 契約語彙と統治ゲートの解釈が統一され、下流laneでの再定義・強行遷移を抑止できる。


## Stream A CE-0/CE-1 contract lock + A1 gate alignment（2026-05-10）

### Phase 1 Read（stopper check）
- Read target: 本ADR, `issue-FB-P2C-01-a1-interface-contract.md`, `issue-HIL-RS-01-A1-architecture-minimum-interface-contract.md`, `issue-HIL-RS-01-next-phase-human-loop-reversible-synthesis.md`。
- triage stopper check: 対象3 issue すべてで `Status` と `Priority` を確認済み（欠落なし）。

### Phase 2 ADR clarification（CE-0 / CE-1）
- Context: CE-0/CE-1 の契約固定が曖昧なまま下流へ進むと、A1以外で契約再定義が発生し、`Pending bypass` と SafeMode 後退リスクが増幅する。
- Decision:
  - CE-0/CE-1 は A1 契約凍結値を**再定義せず参照専用**で固定する。
  - 固定参照値: `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`, `schemaVersion=1.0.0`, `safeModeBoundary=SAFE_MODE_STRICT_ON`, `safeModeDefault=ON`, `overridePolicy=human_dual_control_only`。
  - 人間承認遷移は `Pending -> Approved | Pending -> Rejected` のみ許可し、それ以外の遷移を禁止する。
- Consequences:
  - A2/A3 への受け渡しは read-only handoff のみ。
  - `pendingDecisionQueueCount>0` の間は `Hold/Needs-decision` を維持する。

### Phase 3 Plan（AC / DoD）
- AC-1: safeMode後退 `0`。
- AC-2: contract drift `0`（固定参照値の不一致なし）。
- AC-3: responsibility boundary drift `0`（AI=proposal-only, Human=final approval）。
- AC-4: `Pending bypass` 禁止。
- AC-5: read-only handoff 成立（A2/A3側の再定義禁止）。
- DoD: 上記 AC を満たし、Stop 条件（safeMode後退/契約再定義/未定義競合/指定外編集）未該当。

### Phase 4-6 Execute / Verify / Proceed
- Execute: docs-only 契約文言整合のみ（実装仕様の追加なし）。
- Verify checkpoint: `contract drift`, `responsibility boundary`, `pending queue gate`, `stop condition consistency` を照合。
- Proceed rule: `a1Status=="Done" && pendingDecisionQueueCount==0 && drift==0` のときのみ Go。
- Current decision: `Hold`（Pending 解消待ち）。

## Stream A CE0 freeze completion update（2026-05-19）

### Context
- Stream A（クリティカルパス）として、HIL-RS/CE0 の契約凍結を「下流が mock だけで独立実行できる状態」まで固定する必要がある。
- 実装着手前に、APIシグネチャ/データ型/エラー契約/互換ポリシーを再定義禁止の read-only 契約へ明文化し、ストリーム間依存を切断する。

### Decision
- CE0 の固定I/Fを `ContextQueryV1` / `ContextBundleV1` / `ProposalPatchV1` / `AuditEventV1` に限定し、v1 の required key の削除・意味変更を禁止する。
- エラー契約語彙は `400 unknown_contract_key` / `422 preview_required` / `409 nondeterministic_bundle` を closed-world として凍結する。
- 互換ポリシーは「v1追記は optional 拡張のみ許可、破壊的変更は v2 でのみ許可」とする。
- 下流ストリームは mock contract（`stubDatasetId=A2-minimal-v1`, `sourceBundleHash=mock:<64hex>`）で先行実行し、CE1/CE2/CE4 実装完了待ちを禁止する。

### Consequences
- Stream B/C/E は固定I/Fを read-only 参照するだけで、契約再定義なしに CDC と検証を進められる。
- 互換違反が出た場合は「v1更新」ではなく「v2起票 + 移行計画」へ強制分岐できる。
- 契約凍結後の変更提案は Decision Queue 管理に一本化され、未承認項目の混入を抑止できる。

### Decision Queue（未承認事項）
- `DQ-CE0-001`: `ProposalPatchV1` の `diffFormat` 列挙（`json_patch` / `semantic_patch`）の初期値固定。
- `DQ-CE0-002`: `AuditEventV1` の `command` マスキング規則（引数長上限・伏字方式）。
- `DQ-CE0-003`: `classification != ok` 時の CLI 終了コードの数値割当（非0固定のみ確定、具体値は未承認）。

## Stream D HIL-RS cognitive externalization guardrails（2026-06-13）

### Context
- HIL-RS の可逆統合は、認知外在化要件上の ContextQuery / ContextBundle / proposal-only 統治と同じ安全境界に置かれる。
- AI出力は探索候補であり、Consensus Graph / `human_reviewed` を直接更新する権限を持たない。

### Decision
- HIL-RS proposal は ContextBundle の `sourceBundleHash` と `proposalId` を持ち、出所・切り詰め・根拠・矛盾・保留の監査に接続できる場合だけ下流へ渡す。
- `riskLabels[]` は最低限 `safe_mode`, `unreviewed_content`, `conflict`, `rollback_required`, `approval_pending` を扱える契約として記録し、UI表現や実装詳細は確定しない。
- `apply` 系イベントは人間判断後の監査イベントであり、AI候補生成時点では `proposal` までに留める。

### Consequences
- A2/A3 への引き渡しは proposal-only と rollbackRef 必須の制約を含むが、Frontend実装仕様や運用文書本文はこのStreamで確定しない。
- `Pending` を無視した自動適用、SafeMode既定ONの後退、AIによるレビュー済み化は認知外在化要件違反として Stop する。
