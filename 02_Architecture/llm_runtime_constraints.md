# English Summary

> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。
This document defines runtime constraints for LLM usage in Codex-like sandboxed environments, with default-disabled (`none`) operation, opt-in `local`/`fixture` usage, and explicit controls for outbound escalation.

# llm_runtime_constraints — LLM実行時制約とサンドボックス前提（02_Architecture）

本仕様は、sui-sensemakingのLLM連携を安全かつ再現可能に運用するため、実行環境制約（特にサンドボックスとネットワーク）を定義する。

---

## 1. 前提: サンドボックスとネットワーク

- Codex系エージェント実行では、**ネットワークが既定で制限される運用**を標準前提とする。
- したがって「外部APIへ常時接続してテストする」運用は標準パスにしない。
- ネットワーク許可が必要な場合は、明示設定と監査可能な運用手順を必須とする。

---

## 2. 推奨通信経路

### 2.1 優先順位

1. **in-process呼び出し**（最優先）  
2. **IPC**（Unix domain socket / named pipe）  
3. localhost HTTP（最終手段、許可前提）

### 2.2 理由

- in-process/IPCはネットワークポリシー影響を受けにくい。
- localhost HTTPは環境によってloopback通信扱いが不安定になる可能性がある。
- テストの安定性・再現性を重視し、HTTP依存は避ける。

---

## 3. CIで許容する実行パターン

前提: `SUI_LLM_PROVIDER=none` は全環境で許容される既定状態（LLM無効）。

### 3.1 常時利用可能（必須）

- **FixtureProvider**: 明示選択時に有効。ネットワーク不要で決定論的。

### 3.2 任意利用（環境依存）

- **LocalProvider**: 明示opt-inかつ、実行ホストにローカルモデル基盤がある場合のみ有効。

### 3.3 定期実行のみ（通常PRでは非必須）

- **External provider（strong model）**: `SUI_LLM_ESCALATION_ENABLED=true` の明示設定下で夜間/定期統合テストのみ実行。
- PRごと必須にしない（コストと接続可用性のため）。

---

## 4. 実行モード定義

- `offline`: none | fixture | local。外部サービスにデータを渡さない。
- `intranet`: local中心、必要時に社内ゲートウェイ経由。
- `scheduled-integration`: `SUI_LLM_ESCALATION_ENABLED=true` かつallowlist-only outbound条件でexternal providerによる小規模評価セット実行。

safeModeは全モードで既定ONとし、外部サービスとの共有可否と独立して漏えい防止ルールを適用する。

---

## 5. 失敗時ポリシー

- LocalProvider未起動時はFixtureProviderへフォールバック可能とする。
- `SUI_LLM_ESCALATION_ENABLED=false` 時は、external providerへフォールバックしない（fail-safe）。
- 外部通信不能はテスト警告扱い（ただし通常CIの必須判定から除外）。
- スキーマ検証失敗は通信可否に関わらず失敗扱い（品質ゲート優先）。

---

## 6. 実装に渡す拘束条件

- プロバイダ実装はtransportを抽象化し、上位ロジックにHTTP依存を漏らさない。
- テストはtransport差し替え可能であること（in-process / IPC / fixture）。
- 監査ログには「どの通信経路を使用したか」を記録する。

---

## 7. 設定キー整合

- 本仕様の公開設定キーは `SUI_*` に統一する。
- 接頭辞のない旧LLM設定キーは互換aliasを提供しない。

## 8. CE-2 Runtime Guardrails（low-risk / proposal-only）

### 8.1 非破壊確認（safeMode既定ON・漏洩防止）

CE2運用では、適用処理を起動せずに以下を確認する。

- safeModeが既定ONであること。
- reviewed-only既定により未レビュー本文が提案入力に混入しないこと。
- share/export境界を越える外部サービスとの共有を伴わないこと。

### 8.2 通信と状態遷移の拘束

- CE2は `proposal-only` とし、runtime上でapply経路を起動しない。
- `status` 許可遷移は `proposed -> accepted|rejected|held` のみ。
- CE1ドリフト検知時は `status=held` に強制遷移し、後続処理を停止する。
- `reviewState` の遷移は `unreviewed -> human_reviewed` を人手操作に限定し、runtime自動昇格を禁止する。
- `held` 状態の自動解除を禁止する（人手判断ログ必須）。

### 8.3 監査ログ最小セット（再現可能性）

CE2 runtimeでは次のキーを記録し、同一入力で再現検証できるようにする。

- `queryId`
- `proposalId`
- `sourceBundleHash`
- `transport`（in-process / IPC / localhost HTTP）
- `safeModeDefaultOnConfirmed`
- `unreviewedLeakPrevented`
- `autoApplyPathCount`
- `autoReviewPromotionCount`
- `verifyAttempt`
- `decision`（`pass|held|stop`）

### 8.4 停止条件（フェイルセーフ）

次のいずれかを検知した時点で停止し、人手判断待ちへ遷移する。

- safeMode後退
- 漏洩防止境界の弱体化
- 未定義状態遷移
- Contract ID衝突または意味不一致

## 9. CE1 Verify Workflow Lock（Phase 1..6）

CE1 contract作業は次の直列Phaseを固定し、スキップ・逆走・並列化を禁止する。

1. Phase 1 Read
2. Phase 2 CDC（Context / Decision / Consequences）
3. Phase 3 Plan（AC/DoD不足は提案して合意）
4. Phase 4 Execute（contract-onlyで固定）
5. Phase 5 Verify（失敗時は自己修復を最大3回）
6. Phase 6 Proceed（参照専用handoff）

停止条件は次のとおりです。

- Verify失敗が3回を超えた場合は `held` で停止する。
- Contract ID collision / error semantics collisionを検知した場合は即停止し、Phase 2へ戻す。


## Stream B verify workflow addendum（2026-05-18 / CE1-independent）

### Context
CE1のVerify失敗を曖昧に扱うと、下流に非決定論が伝播する。

### Decision
- CE1 Verifyは以下4項目を必須機械判定とする。
  1) `previewConfirmed=false -> 422 preview_required`
  2) unknown key -> `400 unknown_contract_key`
  3) 同一canonical query 3回でhash 3/3一致
  4) hash不一致 -> `409 nondeterministic_bundle`
- self-repairは最大3回。3回超過時は `held` 停止。
- 仕様競合・上流矛盾・想定外ファイル競合を検知した場合は即停止。

### Consequences
- runtime制約にCE1固定ゲートが接続され、fail-openを防止できる。
- 下流ストリームは `Proceed` 条件を同一判定で再利用できる。


## Stream B CE1 verify lock addendum（2026-05-20 / Verify-first safety）

### Context
CE1 Verify判定が曖昧だとfail-openが発生し、契約凍結の意味が失われる。

### Decision
- Verify必須判定を次の4点に固定する。
  1. `previewConfirmed=false -> 422 preview_required`
  2. `unknown key -> 400 unknown_contract_key`
  3. 同一canonical query 3回で `queryCanonicalHash` / `bundleHash` が3/3一致
  4. 不一致は `409 nondeterministic_bundle`
- self-correctionは最大3回。超過時は `held` 停止。

### Consequences
- CE1契約一貫性を機械的に再利用でき、Proceed判定の曖昧さを排除できる。
- 競合検知時停止（推測実装禁止）を運用上の既定にできる。
