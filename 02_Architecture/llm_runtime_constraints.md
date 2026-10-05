# 概要

> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md` である。本書には必要最小限だけを書き、追加や改名のときは正本を先に更新する。
本書は、Codex系のサンドボックス環境でLLMを使うときの実行時制約を定義する。既定は無効（`none`）で、`local` と `fixture` はopt-inで使い、外部への送信を広げる操作は明示的に制御する。

# llm_runtime_constraints: LLM実行時制約とサンドボックス前提（02_Architecture）

本仕様は、sui-sensemakingのLLM連携を安全かつ再現可能に運用するため、実行環境の制約（特にサンドボックスとネットワーク）を定義する。

---

## 1. 前提: サンドボックスとネットワーク

- Codex系エージェントの実行では、**ネットワークを既定で制限する運用**を標準の前提とする。
- したがって、「外部APIへ常時接続してテストする」運用は標準の経路にしない。
- ネットワークの許可が必要な場合は、明示的な設定と、監査できる運用手順を必須とする。

---

## 2. 推奨する通信経路

### 2.1 優先順位

1. **in-process呼び出し**（最優先）  
2. **IPC**（Unix domain socket / named pipe）  
3. localhost HTTP（最終手段で、許可が前提）

### 2.2 理由

- in-processとIPCは、ネットワークポリシーの影響を受けにくい。
- localhost HTTPは、環境によってループバック通信の扱いが不安定になる可能性がある。
- テストの安定性と再現性を重視し、HTTPへの依存は避ける。

---

## 3. CIで許容する実行パターン

前提: `SUI_LLM_PROVIDER=none` は、全環境で許容される既定の状態（LLM無効）である。

### 3.1 常時利用できるもの（必須）

- **FixtureProvider**: 明示的に選んだときに有効になる。ネットワークは不要で、決定的に動く。

### 3.2 任意で利用するもの（環境依存）

- **LocalProvider**: 明示的にopt-inし、かつ実行ホストにローカルモデルの基盤がある場合だけ有効になる。

### 3.3 定期実行のみ（通常のPRでは必須にしない）

- **外部プロバイダ（強いモデル）**: `SUI_LLM_ESCALATION_ENABLED=true` を明示した場合に限り、夜間や定期の統合テストでだけ実行する。
- コストと接続可用性の都合から、PRごとの必須にはしない。

---

## 4. 実行モードの定義

- `offline`: none | fixture | local。外部サービスにデータを渡さない。
- `intranet`: localを中心とし、必要なときは社内ゲートウェイを経由する。
- `scheduled-integration`: `SUI_LLM_ESCALATION_ENABLED=true` で、かつ送信先を許可リストだけに限る条件のもと、外部プロバイダで小規模な評価セットを実行する。

safeModeは全モードで既定ONとし、外部サービスとの共有が許されるかどうかとは独立に、漏えい防止ルールを適用する。

---

## 5. 失敗時のポリシー

- LocalProviderが起動していないときは、FixtureProviderへフォールバックしてよい。
- `SUI_LLM_ESCALATION_ENABLED=false` のときは、外部プロバイダへフォールバックしない（安全側の動作）。
- 外部と通信できない場合はテストの警告として扱う（ただし通常CIの必須判定からは除く）。
- スキーマ検証の失敗は、通信できるかどうかに関わらず失敗として扱う（品質ゲートを優先する）。

---

## 6. 実装に課す拘束条件

- プロバイダの実装はトランスポートを抽象化し、上位のロジックにHTTP依存を漏らさない。
- テストでは、トランスポートを差し替えられること（in-process / IPC / fixture）。
- 監査ログには、「どの通信経路を使ったか」を記録する。

---

## 7. 設定キーの整合

- 本仕様で公開する設定キーは `SUI_*` に統一する。
- 接頭辞のない旧LLM設定キーには、互換エイリアスを提供しない。

## 8. CE-2 ランタイムのガードレール（low-risk / proposal-only）

### 8.1 非破壊の確認（safeMode既定ON・漏えい防止）

CE2の運用では、適用処理を起動せずに、次を確認する。

- safeModeが既定でONであること。
- 既定がreviewed-onlyなので、未レビューの本文が提案の入力に混入しないこと。
- share/exportの境界を越えて、外部サービスと共有することがないこと。

### 8.2 通信と状態遷移の拘束

- CE2は `proposal-only` とし、ランタイム上でapply経路を起動しない。
- `status` で許可する遷移は `proposed -> accepted|rejected|held` だけである。
- CE1のドリフトを検知したら、`status=held` へ強制的に遷移させ、後続の処理を止める。
- `reviewState` の遷移は、`unreviewed -> human_reviewed` を人の操作だけに限り、ランタイムによる自動昇格を禁止する。
- `held` 状態の自動解除を禁止する（人の判断のログが必須）。

### 8.3 監査ログの最小セット（再現可能性）

CE2のランタイムでは、同じ入力で再現を検証できるよう、次のキーを記録する。

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

次のいずれかを検知した時点で停止し、人の判断を待つ状態へ遷移する。

- safeModeの後退
- 漏えい防止境界の弱体化
- 未定義の状態遷移
- Contract IDの衝突または意味の不一致

## 9. CE1 Verifyワークフローの固定（Phase 1..6）

CE1のcontract作業では、次の直列のPhaseを固定し、スキップ、逆戻り、並列化を禁止する。

1. Phase 1 Read
2. Phase 2 CDC（Context / Decision / Consequences）
3. Phase 3 Plan（AC/DoDが不足していれば、提案して合意する）
4. Phase 4 Execute（contract-onlyで固定）
5. Phase 5 Verify（失敗したら自己修復を最大3回）
6. Phase 6 Proceed（参照専用のhandoff）

停止条件は次のとおりです。

- Verifyの失敗が3回を超えた場合は、`held` で停止する。
- Contract IDの衝突やエラー意味の衝突を検知した場合は、ただちに停止し、Phase 2へ戻す。


## Stream B Verifyワークフローの追記（2026-05-18 / CE1-independent）

### Context
CE1のVerify失敗をあいまいに扱うと、下流に非決定性が伝わる。

### Decision
- CE1 Verifyでは、次の4項目を機械判定の必須とする。
  1) `previewConfirmed=false -> 422 preview_required`
  2) 未知のキー -> `400 unknown_contract_key`
  3) 同じcanonical queryを3回実行して、hashが3/3一致
  4) hashの不一致 -> `409 nondeterministic_bundle`
- 自己修復は最大3回とする。3回を超えたら `held` で停止する。
- 仕様の競合、上流との矛盾、想定外のファイル競合を検知した場合は、ただちに停止する。

### Consequences
- ランタイム制約にCE1の固定ゲートがつながり、条件を満たさないまま通ってしまう事態を防げる。
- 下流のストリームは、`Proceed` の条件を同じ判定で再利用できる。


## Stream B CE1 Verifyロックの追記（2026-05-20 / Verify-first safety）

### Context
CE1のVerify判定があいまいだと、条件を満たさないまま通ってしまい、契約を凍結した意味が失われる。

### Decision
- Verifyの必須判定を、次の4点に固定する。
  1. `previewConfirmed=false -> 422 preview_required`
  2. `unknown key -> 400 unknown_contract_key`
  3. 同じcanonical queryを3回実行して、`queryCanonicalHash` / `bundleHash` が3/3一致
  4. 不一致は `409 nondeterministic_bundle`
- 自己修正は最大3回とする。超過したら `held` で停止する。

### Consequences
- CE1の契約の一貫性を機械的に再利用でき、Proceed判定のあいまいさをなくせる。
- 競合を検知したら停止する（推測による実装は禁止）ことを、運用上の既定にできる。
