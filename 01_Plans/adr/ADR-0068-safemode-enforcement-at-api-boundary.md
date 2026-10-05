# ADR-0068: SafeMode の未レビュー本文保護を API 境界で強制する

- Status: Accepted
- Date: 2026-08-09
- Deciders: Maintainer（仮承認2026-08-13。ドッグフーディングループの仮承認方針に基づく。否認・補正可）
- Scope: `03_Implement/backend/src/sui_sensemaking_api/routes/ai.py`, `models.py`, `models_ai.py`, `02_Architecture/api.md`, `02_Architecture/architecture.html`, `02_Architecture/llm_escalation_policy.html`, `03_Implement/frontend/src/api/client.ts`

## Context

`02_Architecture/architecture.html` §05（CE-0禁止事項）は、後退させてはならない不変条件としてこう定めている。

> safeMode既定ON時、未レビュー本文をAI入力へ含めてはならない。

`02_Architecture/llm_escalation_policy.html` §04（CE2-C2実行禁止事項）は、これを処理停止条件として再掲している。

> 以下を検知した場合、処理を継続せず停止する。… 4. safeMode 保護後退（未レビュー本文混入を含む）

コード実読で確認した実装は、この契約を満たしていない。

### 事実1: AI エンドポイントに safeMode パラメータが存在しない

`models.py:941-943`:

```python
class SuggestLayoutRequest(BaseModel):
    doc: DocumentV1
    instruction: str | None = None
```

`SuggestMergesRequest`（`models.py:959-961`）、`GenerateNarrativeRequest`（`models_ai.py:52-56`）も同形で、safeModeを受け取るフィールドが無い。サーバはSafeModeがONかOFFかを知る手段を持たない。

### 事実2: 全カード本文が無条件でプロンプトへ展開される

`routes/ai.py:317-324`:

```python
def _build_prompt(payload: SuggestLayoutRequest) -> str:
    card_lines = []
    for card in payload.doc.cards:
        critique_text = f', critique={json.dumps(card.critique)}' if card.critique else ""
        card_lines.append(
            f'- id="{card.id}", text={json.dumps(card.text)}, x={card.x}, y={card.y}{critique_text}'
        )
```

`card.textReviewed` を参照する分岐は存在しない。`suggest_layout`（`routes/ai.py:517-524`）は `_build_prompt(payload)` の結果をそのまま `generate_with_fallback()` へ渡す。`grep -n "safe_mode\|unreviewed\|redact" routes/ai.py` は、プロンプト内の指示文（273行）と出力側の `reviewState="unreviewed"` 設定（611/650行）しか返さない。

### 帰結

SafeModeの未レビュー本文保護はフロントエンドのみの強制である。`SUI_LLM_PROVIDER=large-scale` の構成では、APIを直接呼ぶ経路（curl、別クライアント、将来のMCP/エージェント連携）を通じて未レビュー本文が外部サービスへ送出される。外部LLM利用時の実質的な信頼境界はAPIであり、そこに防御が無い。

なお、外部送出そのもののガード（`llm_large_scale_opt_in` + `llm_escalation_enabled` の二段opt-in、ホスト許可リスト、trusted-HTTP検証）は `settings.py:473-520` で堅く実装されている。欠けているのは「送出してよい構成において、何を送るか」の側である。

## 決定すべき論点

- **D1**: SafeModeの状態を誰が宣言し、サーバはどう知るか。
- **D2**: SafeMode ONかつ未レビュー本文が含まれる場合の振る舞い。
- **D3**: 既存クライアントとの後方互換。

## 選択肢

### D1: SafeMode 状態の伝達

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A** | リクエストに `safeMode: bool` を必須追加 | 明示的。契約が読める | クライアントが `false` を送れば無効化できる（自己申告） |
| **B** | サーバ側の設定（profile / 環境変数）を正とし、リクエストでは受け取らない | クライアントに無効化されない | 文書単位・利用者単位の切替ができない |
| **C** | サーバ既定 ON。リクエストは「緩和の明示要求」（`allowUnreviewedText: true`）のみ受け付け、緩和は profile で許可された場合だけ有効 | 既定安全。緩和が監査可能な明示操作になる。`CE0-SAFEMODE-IF` の `allowUnreviewedText=false` 既定という既存語彙と一致 | 実装がやや複雑 |

### D2: 未レビュー本文の扱い

| 案 | 内容 |
|---|---|
| **A** | 該当カード本文を除外／マスクして送信（秘匿して継続） |
| **B** | 422 で拒否し、処理を停止（`llm_escalation_policy` CE2-C2 の「処理を継続せず停止する」に文字通り従う） |
| **C** | provider 種別で分岐（`local` は redact、`external` は拒否） |

### D3: 後方互換

| 案 | 内容 |
|---|---|
| **A** | 新フィールドを optional にし、未指定は「SafeMode ON」として扱う（fail-safe 既定） |
| **B** | 必須化し、未指定は 422 |

## Three-Element Verification（ADR-0067 暫定適用・提案として）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | SafeModeの未レビュー本文保護はフロントエンドのみの強制で、`large-scale`構成ではAPIを直接呼ぶ経路（curl・別クライアント・将来MCP/エージェント連携）を通じて未レビュー本文が外部サービスへ送出される。外部LLM利用時の実質的な信頼境界はAPIであり、そこに防御が無い | 機能: AIエンドポイントにsafeModeパラメータを追加しサーバがSafeMode状態を知る。データ: `allowUnreviewedText=false`既定（CE0-SAFEMODE-IFの語彙をAPIへ持ち上げ）で未指定時に危険側の動作にならない |
| **データ設計** | `card.textReviewed`を参照する分岐がプロンプト構築に無く、全カード本文が無条件で展開される。`_build_prompt`で未レビュー本文を除外（秘匿）または検出時に拒否する | 業務: 未レビュー本文をサーバが検出した時点でそれはクライアント側の契約違反か意図的な迂回であり、黙って受け流すより拒否して顕在化させる方が安全側。機能: 外部送出そのもののガード（opt-in・allowlist・trusted-HTTP）は既に堅く実装済みで、欠けているのは「送出してよい構成において何を送るか」 |
| **機能設計** | D1=C（allowUnreviewedText語彙をAPIにも適用する）・D2=B（未レビュー検出時は拒否）・D3=A（未指定時は安全側で拒否）を推奨。`allowUnreviewedText=true`をprofileで許可する場合は監査必須項目へ緩和適用事実を記録 | 業務: ADR-0041 CVIとCE-0の安全不変条件がAPI境界で担保されていない乖離をR-3として再確認。データ: 既存フロントエンドを壊さず、既存の語彙と明文化（CE2-C2停止条件）を尊重 |

## 推奨（保守者の判断を拘束しない）

D1=C、D2=B、D3=A を推奨する。

理由: D1=Cは既存の `CE0-SAFEMODE-IF`（`allowUnreviewedText=false` 既定）の語彙をそのままAPIにも適用するだけで、新しい概念を増やさない。D2=Bは `llm_escalation_policy` CE2-C2が既に「停止する」と明文化しており、秘匿しての継続はその明文と食い違う。またフロントエンドは既にSafeMode適用済みの内容を送る想定なので、サーバが未レビュー本文を検出した時点でそれはクライアント側の契約違反か、意図的な迂回であり、黙って受け流すより拒否して顕在化させる方が安全側である。D3=Aは既存フロントエンドを壊さず、かつ未指定時に危険側の動作にならない。

`allowUnreviewedText=true` をprofile側で許可する場合は、`llm_escalation_policy` の監査必須項目へ「緩和が適用された事実」を記録すること（`SEC-LLM-AUDIT-01` と連動）。

## ADR-0047 ゲート判定

- **R-1（実使用の摩擦）**: 該当しない。コード監査による発見。
- **R-3（非機能境界の超過）**: 該当すると考える。`ADR-0041` CVIとCE-0の安全不変条件が、API境界では実装により担保されていないことが判明した。宣言済み不変条件と実装の乖離であり、新機能追加ではないが、境界の再確認を要する。
- **R-2 / R-4**: 該当しない。

R-3該当の是非は保守者が確認すること。

## Non-goals

- SafeModeのフロントエンド実装は変更しない（二重防御として維持）。
- 外部送出ガード（opt-in・allowlist・trusted-HTTP）は変更しない。既に妥当。
- proposal-only / 反スコアリング / `human_reviewed` 人手昇格の各境界は変更しない。
- LLM応答側（出力）のフィルタリングは本ADRの範囲外。

## 追記（2026-08-09）: ADR-0069 との境界重複

> `ADR-0069` と本ADRは同じ境界を対象としており、独立に実装すると衝突する。着手前に採択順序を確認すること。

`ADR-0069`（LLM投入IRをAI入力の実経路とする、Proposed）が起票された。本ADRの前提のうち一点が、その後の調査で変わっている。

本ADRは「SafeModeの入力側保護がどこにも実装されていない」ことを前提に、`/ai/*` の各リクエストモデルへ `safeMode` を追加する方向（D1）を提案した。しかし `02_Architecture/llm_input_ir_spec.md`（`ADR-0009` Accepted、Phase Bの正本）§7.1が、同じ保護を既に凍結仕様として定めている。`meta.safe_mode` と `constraints.safe_mode` の双方を必須かつ `true` とし、欠落または `false` の場合はIR生成を失敗させる。実装が存在しないだけである（`ir_version` / `graph_summary` / `cluster_candidates` は `03_Implement` 配下に0件）。

したがって二つの経路がある。

- **本ADR D1**: `/ai/*` のリクエスト契約へ `safeMode` を追加し、`routes/ai.py` で強制する。
- **`ADR-0069` D4=A**: IR構築をサーバ側へ置き、IR §7.1の既存規定で強制する。

`ADR-0069` が採択される場合、本ADRのD1は吸収されうる。D2（未レビュー本文検出時の挙動）とD3（後方互換）は、どちらの経路でも決着が要るため引き続き有効である。

両者を別々のAIエージェントが並行して実装しないこと。保守者が採択順序を決め、後続側はその決定を前提に再検討すること。

根拠と実測は `02_Architecture/canvas-projection-asymmetry-2026-08-09.html` を参照。

## Traceability

- Implementation: `01_Plans/issues/done/issue-SEC-AI-SAFEMODE-01-safemode-not-enforced-at-api-boundary.md`
- Related: `01_Plans/adr/ADR-0069-llm-input-ir-as-the-actual-ai-input-path.md`（境界が重複する。上記追記を参照）
- Related: `02_Architecture/llm_input_ir_spec.md` §7.1（SafeModeを凍結仕様として既に規定）
- Related: `02_Architecture/canvas-projection-asymmetry-2026-08-09.html`
- Related: `02_Architecture/architecture.html` §05（CE-0禁止事項の出典）
- Related: `02_Architecture/llm_escalation_policy.html` §04（CE2-C2停止条件の出典）
- Related: `01_Plans/adr/ADR-0041-core-value-invariants-single-guard.md`
- Related: `01_Plans/issues/done/issue-SEC-LLM-AUDIT-01-llm-calls-bypass-audit-dispatcher.md`
- Related: `THREAT_MODEL.md`
