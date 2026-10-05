# ADR-0009-local-llm-integration: ローカルLLM統合計画

- Status: Accepted
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: `01_Plans/phaseX_local_llm_integration.md`

## Context

`phaseX_local_llm_integration.md` で管理していた計画・要件・受入条件を、ADR運用へ移管する。

## Decision

以下を本ADRの正本として採用する。

# English Summary
sui-sensemakingにローカルLLMを統合するための、段階別のチェックリスト計画である。コードは導入せず、プロバイダの抽象化、実行時の制約、評価ゲート、エスカレーション、運用の準備を扱う。

# phaseX_local_llm_integration — ローカルLLM統合計画（チェックリスト）

本書は、LFM2.5等の軽量ローカルLLMを主軸にした運用へ移行するための計画書である。
実装コードは含まず、完了条件を明示した進行管理チェックリストとして扱う。

---

## 0. ゴール

- Provider Interfaceにより、none/fixture/local/externalを設定で切り替えられるようにする。
- CIの既定をfixture + rule checksに固定し、再現性を確保する。
- 本番はLocal-firstを基本とし、必要なときだけdeterministic triggerでエスカレーションする。
- safeModeと漏えい防止を、評価ゲートと運用手順の両面で満たす。

---

## 1. Phase A: 仕様固定

- [x] `llm_provider_spec.md` のI/F定義をレビュー確定。
- [x] `llm_runtime_constraints.md` の通信制約（in-processとIPCを優先）をレビュー確定。
- [x] `llm_quality_strategy.md` の二層評価基準をレビュー確定。
- [x] `02_Architecture/llm_escalation_policy.html` の、既定で無効とする点とopt-inの条件をレビュー確定。

完了条件
- 4文書の用語の整合（provider, safeMode, escalation）に矛盾がない。

---

## 2. Phase B: データ/IR整備

- [x] KJ入力の正規化項目（cards, coordinates, relations, meta）を固定。
- [x] 非LLM前処理（クラスタ候補、中心性、連結成分、矛盾サブグラフ）を仕様化。
- [x] LLMへ投入するIRのJSON schema（必須と任意、サイズの上限、切り詰めの規則）を確定。

完了条件
- IRの仕様だけで、FixtureProviderの回帰データを生成できる状態になる。
- 正本: `02_Architecture/llm_input_ir_spec.md`。

---

## 3. Phase C: テスト戦略適用

- [x] Unit: schema/post-processing/safeMode検証項目を確定。
- [x] Regression: fixture snapshot/golden運用手順を確定。
- [x] Integration: 強いモデルのcuratedセット（小規模）と、夜間に実行する方針を確定。

### Phase C CDC（Context / Decision / Consequences）

Context
- `llm_quality_strategy.md` と `llm_runtime_constraints.md` は「PR必須」と「定期監査」を分ける方針を示しているが、ADR-0009側の運用の表現が固定されていなかった。
- CIの再現性（fixture中心）と統合監査（強いモデルを夜間に実行）の境界を、同一の文書内で読み替えなしにたどれる必要がある。

Decision
- Unit（PR必須）を以下で固定する。`schema validation` / `post-processing deterministic check` / `safeMode leak prevention`。
- Regression（PR必須）を以下で固定する。`FixtureProvider snapshot + golden diff` / `必須セクション欠落検知` / `citation coverage 下限チェック`。
- Integration（定期監査のみ）を以下で固定する。`external provider による curated 小規模セット` を夜間に実行し、PR必須ゲートから分離する。
- 安全側の動作を明記する。`SUI_LLM_ESCALATION_ENABLED=false` の環境では、integrationの経路を起動しない。

Consequences
- 「PR必須テスト」と「定期監査テスト」の境界は本ADRで確定し、実装側は、この境界を破らない形でCIを定義する。
- 失敗したときの優先順位は、Unit/Regressionを先に解消することとし、Integrationは監査アラートとして別のレーンで運用する。

完了条件
- 「PR必須テスト」と「定期監査テスト」の境界が文書化されている。

---

## 4. Phase D: エスカレーション運用準備

- [x] deterministic triggerの一覧を、運用設定に反映できる形式で整理。
- [x] escalationが無効なときのフォールバック（再試行と人手の確認）を定義。
- [x] 有効なときのallowlist-only outbound要件を、インフラの手順へ連携。

### Phase D CDC（Context / Decision / Consequences）

Context
- `02_Architecture/llm_escalation_policy.html` には、決定論的トリガと、無効なときと有効なときのルーティングがあるが、運用の実装へ渡す最低限の形式がADR側で確定していなかった。
- Local-first原則を維持しつつ、外部への送信を例外の経路として、監査できる形に固定する必要がある。

Decision
- deterministic triggerは、次の固定の列で運用設定に反映する。`schema_failure` / `required_section_missing` / `contradiction_section_missing` / `threshold_exceeded` / `rubric_below_threshold`。
- escalationが無効なとき（既定）は、`local retry -> fixture fallback -> manual review(hold)` の順で処理し、externalへは遷移しない。
- escalationが有効なとき（明示的なopt-in）は、 `allowlist-only outbound` / `safeMode redaction` / `minimal payload` / `reason-code audit log` を必須の条件とする。

Consequences
- 「外部送信なしで成立する標準運用」と「有効にするときの手順」を分けて記述するという完了条件を満たす。
- 運用手順書側は、本ADRのtrigger名称とreason codeをそのまま引き継ぎ、名前がずれることを禁止する。

完了条件
- 「外部送信なしで成立する標準運用」と「有効にするときの手順」が、分けて記述される。

---

## 5. Phase E: 運用移行判定

- [x] LocalProviderの成功率の目標値を定義。
- [x] エスカレーション率の上限を定義。
- [x] 失敗したときの手動のオペレーション（再実行、レビュー、保留）を整備。
- [x] 最小限のログと赤線化の方針を、運用ガイドへ反映。

### Phase E CDC（Context / Decision / Consequences）

Context
- 運用移行の判定に必要なSLO/KPIが定義されていないと、Offline/Intranet/Enterpriseの間で成功の判定が揺れる。
- `llm_runtime_constraints.md` / `02_Architecture/llm_escalation_policy.html` が求める監査可能性を、日次の運用手順へ落とし込む必要がある。

Decision
- SLO/KPIを次のとおり固定する。
  - `LocalProvider success rate >= 95%`（日次7日移動平均、対象はlocal実行全件）。
  - `Escalation rate <= 5%`（明示opt-in環境のみ計測、週次）。
  - `Manual hold resolution within 1 business day`（`hold` 事案の中央値）。
- 失敗したときの手順を固定する。`retry(max2)` -> `human review` -> `hold with reason code`。
- 最小限のログ項目を固定する。`timestamp` / `provider` / `trigger` / `decision(pass|hold|stop)` / `reasonCode` / `bundleHash`。
- 赤線化（redaction）の方針を固定する。未レビューの本文、個人情報の候補、秘匿の識別子は、ログに保存する前にマスクし、必要なときはhash化する。

Consequences
- 3つの運用形態（Offline/Intranet/Enterprise）で、同じKPIを比較できる。
- 運用ガイドを更新するときの必須のチェックとして、SLO/KPIの閾値とログの最小セットが欠けているものを差し戻しの対象にする。

完了条件
- Offline / Intranet / Enterpriseの3つの運用形態で、必要な手順が欠けずにそろう。

---

## 6. 非機能・制約チェック（横断）

- [x] ベンダーロックインを示す表現がない。
- [x] 個人情報と秘匿情報を仕様に含めない。
- [x] safeMode既定ONの原則が、すべての関連文書で一貫している。
- [x] 添付の入力は「構造化テキストのみ」で統一されている。

### 横断制約 CDC（Context / Decision / Consequences）

Context
- Phase C〜Eを確定しても、横断的な制約が明文化されないと、運用の実装で後退（lock-in, PII, safeMode, 添付入力）が起きる。

Decision
- lock-inの回避: providerの表記は `none|fixture|local|external` の抽象的な列挙だけを使い、特定ベンダーの固有名を規範的な語にしない。
- PIIと秘匿情報: 仕様、ログ、監査キーに生のデータを持ち込まず、識別が必要な場合はreason codeとhashによる参照に限る。
- safeMode: 既定ONと `allowUnreviewedText=false` を、後退させない運用の原則として固定する。
- 添付入力: LLMへの入力は、`structured_text_only=true` を満たす構造化テキストに限り、バイナリの添付や自由形式のペイロードを許可しない。

Consequences
- 横断の4項目をADR-0009の完了条件として扱い、各フェーズの成果物の受け入れチェックに組み込む。
- 実装や運用の文書で例外が必要な場合は、本ADRではなく上位の仕様（02_Architecture）へ先に変更を提案する。



## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | LFM2.5等の軽量ローカルLLMを主軸にした運用へ移行し、none/fixture/local/externalを設定で切替可能にする。本番はLocal-firstを基本とし必要時のみdeterministic triggerでエスカレーションする | 機能: Provider Interfaceで設定切替可能にしCIの既定をfixture+rule checksに固定して再現性を担保。データ: safeModeおよび漏えい防止を評価ゲートと運用手順の両面で満たす |
| **データ設計** | `llm_provider_spec.md`でI/F定義、`llm_runtime_constraints.md`で通信制約（in-process/IPC優先）、`llm_quality_strategy.md`で二層評価基準をレビュー確定する | 業務: ローカルLLMの利用は秘密情報の外部送信を避けプライバシー既定（P-07）を維持。機能: エスカレーションはlarge-scaleへの明示opt-in時に限定 |
| **機能設計** | Phase A仕様固定→Phase B/CでProvider実装と評価ゲートを段階導入。providerはnone/fixture/local/externalの切替を環境変数で実現 | 業務: provider=externalは明示設定時のみ利用（既定値はnone）。データ: 二層評価（品質・安全）で生成物の品質と漏えい防止を確認 |

## Consequences

- 旧文書 `phaseX_local_llm_integration.md` は廃止し、本ADRへ参照を統一する。
- 既存リンクは `01_Plans/adr/ADR-0009-local-llm-integration.md` へ更新する。

## Traceability

- Source: `01_Plans/phaseX_local_llm_integration.md`
- Supersedes: `01_Plans/phaseX_local_llm_integration.md`
