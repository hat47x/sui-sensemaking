# 概要

> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md` である。本書には必要最小限だけを書き、追加や改名のときは正本を先に更新する。
本書は、二層の品質ゲート戦略を定義する。最初に決定的なルールチェックを行い、次に任意で低コストのローカル自己評価を行う。既定は無効（`none`）で、エスカレーションへの引き継ぎ基準も明示する。

# llm_quality_strategy: LLM品質戦略（02_Architecture）

本仕様は、図解からテキストを生成する際の品質保証を、「正解との一致」ではなく「有用性のゲート」で運用する方針を定義する。

---

## 1. 基本方針

- 生成される出力は多様なので、完全一致の判定だけでは品質を適切に表せない。
- そのため本プロジェクトでは、**二層評価（決定論的チェック + 任意のLLM自己チェック）**を採用する。
- 合否は、「利用可能性」「安全性」「構造の整合性」を中心に判定する。
- 本戦略は `SUI_LLM_PROVIDER=none`（既定は無効）を前提とし、opt-inしたときも同じゲートを適用する。
- `none`（LLM無効）/`fixture`/`local`/`external` のどのプロバイダでも、同じゲート基準を適用する。

---

## 2. Layer A: 決定論的ルールチェック（必須）

次のすべてを機械的に検証する。

1. スキーマ検証が成功すること。  
2. 必須セクション（例: 全体要約、島ごとの要点、矛盾/反証セクション）が存在すること。  
3. 引用数とカバレッジの閾値を満たすこと（根拠カードの参照不足を防ぐ）。  
4. 長さと冗長さの境界（最小・最大）に収まること。  
5. safeModeの要件に適合すること（禁止領域への生テキストの漏えいがないこと）。
6. `SUI_LLM_ESCALATION_ENABLED=false` のときは、外部プロバイダを使わないこと（安全側の動作）。

---

## 3. Layer B: LocalProviderの自己チェック（任意）

低コストの評価として、LocalProviderの `evaluate`（または同等の手段）を使い、0〜5のスコアを算出する。

### 3.1 ルーブリックの例

- grounding（入力の根拠との整合）
- missing contradictions（矛盾や否定関係の取りこぼしの有無）
- over-assertion（過剰な断定や、根拠の薄い断定をどれだけ抑えているか）

### 3.2 利用方法

- Layer Aに合格した後、`local` を使うときに限って実行してもよい。
- スコアが閾値に届かない場合は、エスカレーション候補のフラグとして扱う。

---

## 4. テスト体系（分類）

### 4.1 単体テスト（毎回実行）

- スキーマ準拠の検証
- 後処理（整形・正規化）の安定性
- safeModeでの禁止出力の検証

### 4.2 回帰テスト（毎回実行）

- FixtureProviderのスナップショット（golden files）の比較
- 期待するフィールド、セクション、引用カバレッジの退行の検出

### 4.3 統合テスト（定期実行）

- 厳選した小規模のケース群を、強いモデルで実行する
- 夜間や定期のジョブで差分を追跡する
- PRの必須ゲートにはせず、品質監査として運用する

---

## 5. 正しさの判定が難しい理由と実務での対応

- KJ法の構造から導く要約は、単一の正解に収束しない。
- したがって、「正しいか」よりも「業務で使えるか」を重視する。
- 具体的には、構造の整合（schema/section/citation）と安全の整合（safeMode）を最低基準とし、解釈の質は定期の統合テストで補う。

## 6. IR準拠の条件（Phase B連携）

- Layer Aのスキーマ検証には、`LLMRequest.inputs` が `02_Architecture/llm_input_ir_spec.md` に準拠していることを含める。
- `structured_text_only=true` を満たさないIRは、品質評価の対象に進めない。


## 7. CE-1 品質ゲート（Context / Decision / Consequences）

### 7.1 Context

CE-1では、生成の品質を問う前に、ContextQuery/ContextBundleの契約の再現性（determinism）を満たさない限り、後続の評価を始めない。
CE0の境界（safeModeの後退禁止、reviewの自動昇格禁止、Consensusへの直接書き込み禁止）に抵触する差分は、品質判定の対象に入れず、ただちに安全側で拒否する。

### 7.2 Decision

Layer A（必須）に、次のCE-1ゲートを追加する。

1. Determinism gate: 同じcanonical queryを3回実行して、`bundleHash` が3/3一致すること。
2. Query Preview gate: `previewConfirmed=true` がないrequestには `422 preview_required` を返す。
3. SafeMode exclusion gate: `safeModePolicy=strict` かつ `reviewFilter=reviewedOnly` のとき、`excludedReason` に `unreviewed_filtered` を含む。
4. Mock parity gate: mockバックエンドと実バックエンドで、ContextQuery/ContextBundleのJSON schemaが一致する。

### 7.3 Consequences

- いずれかが不合格なら、Layer Bを実行せずに失敗とする。
- CE-2以降の `sourceBundleHash` 検証の前提条件として、このゲートに合格した結果を監査ログに残す。
- 監査ログの最小キーは `queryId`, `bundleHash`, `excludedReason` である。

## 8. CE-2 proposal-only 品質ゲート（Stream D）

### 8.1 Context

CE-2は「低リスクのAI支援」なので、LLMの出力を適用した結果ではなく、**提案の差分** として扱う。  
品質の判定では、内容の良し悪しよりも先に、契約からの逸脱（auto-apply、reviewの自動昇格、安全性の後退）を、安全側で拒否して検出する必要がある。

### 8.2 Decision

Layer A（必須）に、次のCE-2契約ゲートを追加する。

Contract IDs: `CE2-PROPOSAL-IF` / `CE2-LIFECYCLE-IF` / `CE2-DRIFT-STOP-IF` / `CE2-NO-AUTOAPPLY-IF`

1. Proposal schema gate: すべての提案が `proposalId/diff/sourceBundleHash/status/reviewState` を持つ。
2. Lifecycle gate: 許可する遷移は `proposed -> accepted|rejected|held` だけである（`held` からの自動遷移は禁止）。
3. No-auto-apply gate: `accepted` を含め、提案の状態から直接適用へ進む経路を禁止する。
4. No-auto-review-promotion gate: AI/worker/APIによる `reviewState=human_reviewed` への自動遷移を禁止する。
5. Drift-stop gate: CE1の最小I/Fとの差異を検知したら、`status=held` を強制し、Verify/Proceedを止める。

### 8.3 Consequences

- 上のゲートのいずれかが不合格なら、Layer Bを実行せずに失敗とする。
- Verifyの修復は最大3回までとし、4回目にあたる修復は `status=held` で停止する。
- `Read -> ADR CDC -> Plan -> Execute -> Verify -> Proceed` の固定順序で進め、Planの開始時に契約のドリフトを先に検知する。
- CE-3への引き継ぎでは、CE-2 Proposal I/Fの後方互換（改名・省略・型変更の禁止）を必須とする。

## 9. CE-2 low-risk 運用の固定（安全側）

### 9.1 Serial Phase gate（Stream D）

CE2では次の順序を固定し、前のPhaseの証跡がないまま次のPhaseへ進まない。

1. Read（契約の語彙の再確認）
2. ADR CDC（Context/Decision/Consequencesの固定）
3. Plan（AC/DoDの固定）
4. Execute
5. Verify（最大3回の修復）
6. Proceed（CE3への引き継ぎ）


### 9.1.1 独立して実行するためのルール

- CE1は、実装の完了を待たずに、**mock contractを参照して** 扱う。
- 実装待ちを停止の理由にせず、Read/ADR CDC/Plan/Execute/Verify/Proceedの契約検証を続ける。
- 停止を許すのは、ドリフトが解消しない場合、safeModeが後退した場合、auto-applyを検知した場合に限る。

### 9.2 安全性を最優先する

Layer Aで次を検知した場合は、**ただちに安全側で拒否** し、Layer Bは実行しない。

- safeMode既定ONの後退
- 未レビューの本文の混入（reviewed-onlyの既定への違反）
- auto-apply経路の存在
- AIによる `reviewState=human_reviewed` への自動昇格
- CE1/CE2契約のドリフトが解消していない（`status=held` に遷移していない）

### 9.3 Verify/Proceedの証跡の最小キー

監査と再現ができるよう、CE2の品質ゲートの結果には次を必ず記録する。

- `verifyAttempt`（1..3）
- `proposalId`
- `sourceBundleHash`
- `statusBefore` / `statusAfter`
- `reviewStateBefore` / `reviewStateAfter`
- `safeModeDefaultOnConfirmed`
- `autoApplyPathCount`
- `autoReviewPromotionCount`
- `decision`（`pass|held|stop`）

4回目にあたる修復は許可せず、`status=held` で停止する。

## Stream A CE0/HIL ガバナンス検証フック (2026-04-16)

### Context
- 品質ゲートは、契約の固定（CE0/HIL）より下流にある。契約の後退を品質評価で吸収してはならない。

### Decision
- Layer Aの安全側で拒否する判定に、次のCE0/HIL契約の監査キーを必須とする。
  - `safeModeRegressionCount==0`
  - `unreviewedProtectionRegressionCount==0`
  - `directWritePathCount==0`
  - `contractIdCollisionCount==0`
- Verifyで不一致があれば、Layer Bを実行せずに停止し、自己修正を最大3回まで許可する。

### Consequences
- CE2/CE3へのProceedは、`Read -> ADR CDC -> Plan -> Execute -> Verify -> Proceed` の順序の証跡がある場合に限られる。
- 契約の更新はquality strategyでは行わず、CE0/A1契約のIssueでのみ許可する。

### スナップショットのメタデータ
- Snapshot ID: `CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1`
- Version: `1.0.0`
- Hash (sha256): `851849b770825eb4844d46c77bae34bbefb4aec1ae9bd004e7dc4d50b875a698`

## Stream B CE 契約同期メモ（2026-04-17）

- CE0/CE1/CE2の品質ゲートでは、`Plan -> Execute -> Verify -> Proceed` を固定順序とする。
- Verifyは、`Contract ID collision=0` / `Vocabulary collision=0` / `safeMode regression=0` を同時に満たすことを前提とする。
- 自己修正は最大3回とし、4回目にあたる修復は、安全側で拒否して停止する（CE2は `status=held`）。
- 本書は実装手順を追加せず、mock-firstの契約検証の基準だけを扱う。


## CE0 契約マトリクスの品質ロック（CTX / SAFEMODE / REVIEW）

CE0の契約行列は、品質戦略より上位の固定された境界として扱い、Layer Aで必ず先に評価する。

### Context

- CE0はcontract-onlyのfreezeであり、実装できるかどうかとは独立に判定できる必要がある。
- `safeMode default ON` / `unreviewed protection` / `Consensus Graph direct write prohibition` の後退は、品質の差ではなく契約違反とみなす。

### Decision

Layer Aに、次の固定の監査キーを必須とする。

- `ce0CtxGatePass`（preview gateと、閉じたキー集合のチェック）
- `ce0SafeModeDefaultOnPass`
- `ce0UnreviewedProtectionPass`
- `ce0ReviewPromotionManualOnlyPass`
- `ce0CoreGraphDirectWritePathCount==0`
- `ce0ContractIdCollisionCount==0`

判定の規則は次のとおりです。

1. 上のいずれかが失敗した時点で、安全側で拒否する（Layer Bは実行しない）。
2. Verifyの自己修復は最大3回とし、4回目にあたる修復は停止する。
3. CE1/CE2/CE4の実装の進捗は、判定の前提にしない（mock contractで評価を続ける）。

### Consequences

- CE0の契約からの逸脱を、「品質のばらつき」と誤って分類しない。
- Proceedの判定には、`Read -> ADR(C/D/C) -> Plan(AC/DoD) -> Execute -> Verify -> Proceed/Stop` の順序の証跡を必須とする。
- Contract IDの衝突、未定義の依存、safeModeの後退を検知した場合は、`stop` を返す。
