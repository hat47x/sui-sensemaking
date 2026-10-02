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
This is a phased checklist plan for local LLM integration in sui-sensemaking, covering provider abstraction, runtime constraints, evaluation gates, escalation, and operations readiness without introducing code.

# phaseX_local_llm_integration — ローカルLLM統合計画（チェックリスト）

本書は、LFM2.5等の軽量ローカルLLMを主軸にした運用へ移行するための計画書である。
実装コードは含まず、完了条件を明示した進行管理チェックリストとして扱う。

---

## 0. ゴール

- Provider Interfaceにより、none/fixture/local/externalを設定で切替可能にする。
- CIの既定をfixture + rule checksに固定し、再現性を担保する。
- 本番はLocal-firstを基本とし、必要時のみdeterministic triggerでエスカレーションする。
- safeModeおよび漏えい防止を、評価ゲートと運用手順の両面で満たす。

---

## 1. Phase A: 仕様固定

- [x] `llm_provider_spec.md` のI/F定義をレビュー確定。
- [x] `llm_runtime_constraints.md` の通信制約（in-process/IPC優先）をレビュー確定。
- [x] `llm_quality_strategy.md` の二層評価基準をレビュー確定。
- [x] `02_Architecture/llm_escalation_policy.html` の既定無効・opt-in条件をレビュー確定。

完了条件
- 4文書の用語整合（provider, safeMode, escalation）に矛盾がない。

---

## 2. Phase B: データ/IR整備

- [x] KJ入力の正規化項目（cards, coordinates, relations, meta）を固定。
- [x] 非LLM前処理（クラスタ候補、中心性、連結成分、矛盾サブグラフ）を仕様化。
- [x] LLM投入IRのJSON schema（必須/任意、サイズ上限、切り詰め規則）を確定。

完了条件
- IR仕様だけでFixtureProviderの回帰データを生成できる状態になる。
- 正本: `02_Architecture/llm_input_ir_spec.md`。

---

## 3. Phase C: テスト戦略適用

- [x] Unit: schema/post-processing/safeMode検証項目を確定。
- [x] Regression: fixture snapshot/golden運用手順を確定。
- [x] Integration: 強モデルのcuratedセット（小規模）と夜間実行方針を確定。

### Phase C CDC（Context / Decision / Consequences）

Context
- `llm_quality_strategy.md` と `llm_runtime_constraints.md` は「PR必須」と「定期監査」を分離する方針を示しているが、ADR-0009側の運用表現が未固定だった。
- CI再現性（fixture中心）と統合監査（強モデル夜間）の境界を、同一文書内で読み替えなしに辿れる必要がある。

Decision
- Unit（PR必須）を以下で固定する：`schema validation` / `post-processing deterministic check` / `safeMode leak prevention`。
- Regression（PR必須）を以下で固定する：`FixtureProvider snapshot + golden diff` / `必須セクション欠落検知` / `citation coverage 下限チェック`。
- Integration（定期監査のみ）を以下で固定する：`external provider による curated 小規模セット` を夜間実行し、PR必須ゲートから分離する。
- fail-safeを明記する：`SUI_LLM_ESCALATION_ENABLED=false` の環境ではintegration経路を起動しない。

Consequences
- 「PR必須テスト」と「定期監査テスト」の境界は本ADRで確定し、実装側は同境界を破らない形でCI定義を行う。
- 失敗時の優先順位はUnit/Regressionを先に解消し、Integrationは監査アラートとして別レーンで運用する。

完了条件
- 「PR必須テスト」と「定期監査テスト」の境界が文書化されている。

---

## 4. Phase D: エスカレーション運用準備

- [x] deterministic trigger一覧を運用設定に反映可能な形式で整理。
- [x] escalation無効時のフォールバック（再試行/人手確認）を定義。
- [x] 有効時のallowlist-only outbound要件をインフラ手順へ連携。

### Phase D CDC（Context / Decision / Consequences）

Context
- `02_Architecture/llm_escalation_policy.html` には決定論的トリガと無効時/有効時ルーティングがあるが、運用実装へ渡す最低形式がADR側で未確定だった。
- Local-first原則を維持しつつ、外部送信を例外経路として監査可能に固定する必要がある。

Decision
- deterministic triggerは次の固定列で運用設定に反映する：`schema_failure` / `required_section_missing` / `contradiction_section_missing` / `threshold_exceeded` / `rubric_below_threshold`。
- escalation無効時（既定）は `local retry -> fixture fallback -> manual review(hold)` の順で処理し、externalへは遷移しない。
- escalation有効時（明示opt-in）は `allowlist-only outbound` / `safeMode redaction` / `minimal payload` / `reason-code audit log` を必須条件とする。

Consequences
- 「外部送信なしで成立する標準運用」と「有効化時手順」を分離記述する完了条件を満たす。
- 運用手順書側は本ADRのtrigger名称とreason codeをそのまま継承し、命名ドリフトを禁止する。

完了条件
- 「外部送信なしで成立する標準運用」と「有効化時手順」が分離記述される。

---

## 5. Phase E: 運用移行判定

- [x] LocalProvider成功率の目標値を定義。
- [x] エスカレーション率上限を定義。
- [x] 失敗時の手動オペレーション（再実行/レビュー/保留）を整備。
- [x] 最小ログ・赤線化方針を運用ガイドへ反映。

### Phase E CDC（Context / Decision / Consequences）

Context
- 運用移行判定に必要なSLO/KPIが未定義だと、Offline/Intranet/Enterprise間で成功判定が揺れる。
- `llm_runtime_constraints.md` / `02_Architecture/llm_escalation_policy.html` が求める監査可能性を、日次運用手順へ落とし込む必要がある。

Decision
- SLO/KPIを次で固定する。
  - `LocalProvider success rate >= 95%`（日次7日移動平均、対象はlocal実行全件）。
  - `Escalation rate <= 5%`（明示opt-in環境のみ計測、週次）。
  - `Manual hold resolution within 1 business day`（`hold` 事案の中央値）。
- 失敗時手順を固定する：`retry(max2)` -> `human review` -> `hold with reason code`。
- 最小ログ項目を固定する：`timestamp` / `provider` / `trigger` / `decision(pass|hold|stop)` / `reasonCode` / `bundleHash`。
- 赤線化（redaction）方針を固定する：未レビュー本文・個人情報候補・秘匿識別子はログ保存前にマスクし、必要時はhash化する。

Consequences
- 3運用形態（Offline/Intranet/Enterprise）で同一KPIを比較できる。
- 運用ガイド更新時の必須チェックとして、SLO/KPI閾値とログ最小セットの欠落を差し戻し対象にする。

完了条件
- Offline / Intranet / Enterpriseの3運用形態で必要手順が欠落なく揃う。

---

## 6. 非機能・制約チェック（横断）

- [x] ベンダロックイン表現がない。
- [x] 個人情報・秘匿情報を仕様に含めない。
- [x] safeMode既定ONの原則が全関連文書で一貫している。
- [x] 添付入力は「構造化テキストのみ」で統一されている。

### 横断制約 CDC（Context / Decision / Consequences）

Context
- Phase C〜Eを確定しても、横断制約が明文化されないと運用実装で後退（lock-in, PII, safeMode, 添付入力）が起きる。

Decision
- lock-in回避: provider表記は `none|fixture|local|external` の抽象列挙のみを使用し、特定ベンダ固有名を規範語にしない。
- PII/秘匿情報: 仕様・ログ・監査キーに生データを持ち込まず、識別が必要な場合はreason codeとhash参照に限定する。
- safeMode: 既定ON + `allowUnreviewedText=false` を後退不可の運用原則として固定する。
- 添付入力: LLM入力は `structured_text_only=true` を満たす構造化テキストに限定し、バイナリ添付/自由形式ペイロードを許可しない。

Consequences
- 横断4項目をADR-0009の完了条件として扱い、各フェーズ成果物の受入チェックに組み込む。
- 実装・運用文書で例外が必要な場合は、本ADRではなく上位仕様（02_Architecture）へ先に変更提案する。



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
