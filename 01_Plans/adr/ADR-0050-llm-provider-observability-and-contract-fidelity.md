# ADR-0050: LLMプロバイダの可視性・エラー忠実性・契約整合

- Status: Proposed
- Date: 2026-07-06
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `03_Implement/frontend/src/`, `03_Implement/backend/src/sui_sensemaking_api/`, `02_Architecture/llm_provider_spec.md`, `01_Plans/issues/`

## Context

- 「ローカルLLM・生成AIまわりで、ADR起票後に要件の詳細化やUI/UXデザインが未定の箇所が多い」という指摘を受け、実装コード（`provider.py`・`client.ts`・`App.tsx`・`SidePanel.tsx`）を直接読み、既存文書（`ADR-0009`・`llm_provider_spec.md`・`04_Documentation/local_llm_ops_guide.md`）と突き合わせて棚卸しした。
- **既に十分に決定・文書化済みと確認できたもの**（本ADRの対象外・再決定しない）:
  - Provider抽象（`none|fixture|local|large-scale`）・設定キー・safeMode既定ON・ローカルファースト方針（`ADR-0009` Accepted、`llm_provider_spec.md` §1-3）。
  - ローカルLLM `/generate` 契約が **意図的にsui-sensemaking独自形状**（OpenAI/Ollama非互換）であり、実運用には薄いアダプタ層が必要という判断（`04_Documentation/local_llm_ops_guide.md` に明記済み）。GPU無し確認用のモックアダプタ（`03_Implement/deploy/tools/mock_local_llm.py`）も実装済み。
  - エスカレーション方針・品質ゲート・HIL-RS A1契約（`02_Architecture/llm_escalation_policy.html`・`llm_quality_strategy.md`・`hil_rs_01_a1_minimum_interface_contract.md`）は凍結済み。
- **確認された真のギャップ**（コード読解で実証済み・本ADRの対象）:
  1. **プロバイダの可視性ゼロ**: `SUI_LLM_PROVIDER` は運用者がdeploy時に設定する環境変数のみで、アプリ内に「今どのproviderが有効か」を示すUIが一切ない（grepで確認: 該当UI要素なし）。
  2. **エラー分類がバックエンド→フロントエンドの経路で失われる**（3層すべてで確認）:
     - バックエンド `provider.py` は `ProviderRequestError.unavailable/timeout/validation` と `ProviderDisabledError`（`disabled_reason` 付き）という構造化エラー種別を `to_contract()` で用意している（[provider.py:81-100](../../03_Implement/backend/src/sui_sensemaking_api/llm/provider.py)）。
     - しかしフロントエンド `ApiError`（[client.ts:17-24](../../03_Implement/frontend/src/api/client.ts)）は `status: number` と平文 `message: string` のみを保持し、構造化フィールドを受け取る型を持たない。
     - `App.tsx:2510` の呼び出し元は、受け取った平文メッセージに対して **正規表現 `/AI is disabled|provider.*disabled/i` で文字列一致** させて「provider disabled」バナーの要否を判定している。この結果、`provider=local` が設定されているのに接続先が落ちている場合（実際には `"local request failed: Connection refused"` 等の**未翻訳の英語例外文がそのままステータス表示に漏れる**）と、`provider=none`（意図的無効）の場合を、ユーザーは画面上で区別できない。
  3. **`llm_provider_spec.md` §4の契約とバックエンド実装の乖離**: 仕様は `LLMRequest`（`inputs`・`output_schema`・`options.timeout_ms`/`seed`・`context.trace_id`/`safe_mode`）と `LLMResponse`（`usage`・`provider_meta`の構造化 `output`）を「正規形に固定」と記載するが、実装（[provider.py:16-20](../../03_Implement/backend/src/sui_sensemaking_api/llm/provider.py)）は `LLMRequest{task, prompt, temperature, max_tokens}` → `LLMResponse{raw_text, metadata}` という大幅に単純化された形のみで、`inputs`/`output_schema`/`usage`/構造化`output`は未配線。凍結文書である「正本」が実装済みでない内容を確定事項のように記載しており、これ自体が「詳細化未定」の一因になっている。
- ADR-0047ゲート判定: 上記1・2はR-1（実使用の摩擦。コード監査で顕在化した実際の誤誘導・情報欠落）に該当し起票する。3は新規設計判断ではなく既存「正本」の記述是正（ドキュメントの事実整合）であり、本ADRに併記して一括処理する。

## Decision

**LLMプロバイダの状態をアプリ内で正直に可視化し、バックエンドが既に持つ構造化エラー情報をフロントエンドまで欠落なく伝播させ、`llm_provider_spec.md` の契約記述を実装の実態に整合させる。**

### D1. プロバイダ可視性（読み取り専用・運用者設定を維持）

- Viewパネル（`ViewControlsPanel`、UX-VISUAL-01/02のトグル群と同じ節）に「AIプロバイダ」表示を追加する: 現在の `provider_kind`（none/local/large-scale/fixture）を**読み取り専用**で表示する。
- **ランタイム切替UIは提供しない**: providerの変更は既存どおり運用者による環境変数設定＋再起動のみとする。これはSafeModeが既定ONで運用者制御のままである既存方針（`02_Architecture/enterprise_architecture.html` §03）と同じガバナンス境界であり、エンドユーザーが個別に `large-scale`（外部送信）へ昇格できてしまう抜け道を作らない。
- 直近の呼び出し結果（成功/`provider_unavailable`/`provider_timeout`/`provider_validation`/未使用）を**非スコアリングの状態ラベル**として併記する（％・点数・信頼度は表示しない）。
- 複雑性予算: 表示はViewパネル内（既存の開示済み領域）に追加するため、初期表示アンカーへの純増はゼロ（CB-1）。

### D2. エラー分類の忠実な伝播（正規表現一致の廃止）

- バックエンドの `/ai/*` ルートは `ProviderError.to_contract()` の `code`（`provider_unavailable`|`provider_timeout`|`provider_validation`）と `disabled_reason` をHTTPエラーレスポンスの構造化フィールドとして返す（`detail` を平文からオブジェクトへ拡張。既存の `detail: string` 読者との互換は、`detail` を維持しつつ `code`/`disabled_reason`をトップレベルに追加する形で後方互換を保つ）。
- フロントエンド `ApiError` に `code?: string` と `disabledReason?: string` を追加し、`parseErrorMessage` 相当の解析でこれを保持する。
- `App.tsx` の判定は **正規表現ではなく `error.code`/`error.disabledReason` を直接参照**する形へ置き換える。
- ユーザー向けメッセージは `code` 別にi18nキーを用意する（例: `provider_disabled`＝既存の「AI無効」文言／`provider_unavailable`・`provider_timeout`＝「AI機能に接続できません。運用担当者に確認してください」という**未翻訳の生例外文を出さない**文言）。運用者向けの詳細（生メッセージ・`trace_id`）は開発者コンソール/ログにのみ残し、エンドユーザー画面には出さない。

### D3. `llm_provider_spec.md` §4 の契約記述是正（ドキュメント整合・新規設計判断ではない）

- §4.1/4.2を「現在実装済みの最小契約」として明記し直す: `LLMRequest{task, prompt, temperature, max_tokens}` → `LLMResponse{raw_text, metadata(provider_kind/provider_name/model_id/transport/requested_at/trace_id/fallback_to_none)}`。
- `inputs`・`output_schema`・構造化 `output`・`usage`・`context.safe_mode` 直接受け渡しは **Phase-2（未配線・Pending）** として明示的に分離し、「正規形に固定」という既存の言い回しを「将来配線予定・現状未接続」に是正する。
- `02_Architecture/llm_input_ir_spec.md` との関係も、「IR仕様は存在するが `LLMRequest.inputs` への実配線はまだ無い」と明記する。

### Pending（本ADRでは決定しない・明示的に未決事項として残す）

- **OpenAI互換（`/v1/chat/completions`）ワイヤ形式の追加/代替**: 現状 `/generate` 独自契約は「意図的な決定」であり、real-useでの実際の摩擦（誰かが実際にOllama等を繋ごうとして失敗した記録）はまだ確認されていない。ADR-0047のR-1は「顕在化した」摩擦を要求するため、予測ベースでの契約変更は本ADRの範囲外とする。このPending事項は `ROADMAP.md` 要件C（LLMアダプタ基盤）に追記し、実際の摩擦が観測された時点で別ADRとして起票する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 運用者とエンドユーザーは「AIが今使えるか、使えないなら意図的無効か障害か」を画面から判断できる必要がある。未翻訳の生例外文がエンドユーザー画面へ漏れるのは誤誘導であり実使用の摩擦（ADR-0047 R-1）に該当 | 機能: ランタイム切替UIは提供せず運用者設定＋再起動を維持。データ: 直近の呼び出し結果を非スコアリングの状態ラベルとして表示 |
| **データ設計** | バックエンドの`ProviderError.to_contract()`（code: provider_unavailable/timeout/validation, disabled_reason）をHTTPレスポンスの構造化フィールドとして欠落なく伝播する。フロントエンド`ApiError`に`code`/`disabledReason`を追加 | 業務: ユーザー向けメッセージはcode別のi18nキーで提示し生例外文を出さない。機能: 詳細（trace_id等）は開発者コンソール/ログにのみ残す |
| **機能設計** | ViewパネルにAIプロバイダ状態（読み取り専用）を追加。App.tsxの判定は正規表現でなく`error.code`/`disabledReason`を直接参照。`llm_provider_spec.md`§4を実装済み契約（LLMRequest{task,prompt,temperature,max_tokens}→LLMResponse{raw_text,metadata}）に是正 | 業務: provider変更は運用者制御のまま（SafeMode既定ONのガバナンス境界と同一）。データ: inputs/output_schema/usageはPhase-2（未配線）として明示分離 |

## Consequences

- 期待される効果: 運用者・エンドユーザーとも「AIが今使えるか、使えないなら意図的無効か障害か」を画面から判断できるようになる。誤解を招く未翻訳例外文の露出が無くなる。`llm_provider_spec.md` が実装と一致し、以後の実装判断（IR配線等）の起点として信頼できる状態になる。
- 副作用/制約: `/ai/*` エラーレスポンスの形が変わる（`detail` は維持するため既存クライアントの破壊的変更にはならないが、HTTPレスポンスボディへのフィールド追加を伴う）。Viewパネルへの表示追加は軽微だが、i18nキー追加とテストの更新が必要。
- 移行対応（Action は issue で管理）:
  - `PROV-VIS-01`: プロバイダ可視性バッジ＋状態ラベル（Viewパネル、e2e）。
  - `PROV-ERROR-01`: 構造化エラー伝播（backend `to_contract()` 露出＋frontend `ApiError` 拡張＋正規表現除去、integration）。
  - `PROV-CONTRACT-01`: `llm_provider_spec.md` §4の記述是正（docs-check）。
  - `ROADMAP.md` 要件CへOpenAI互換ワイヤ形式のPending事項を追記。

## Traceability

- Related: `01_Plans/adr/ADR-0009-local-llm-integration.md`（Provider抽象の親ADR。再決定しない）
- Related: `01_Plans/adr/ADR-0047-design-decision-adr-saturation-and-execution-first.md`（R-1実使用の摩擦で起票）
- Related: `02_Architecture/llm_provider_spec.md`（D3是正対象）, `02_Architecture/llm_input_ir_spec.md`, `04_Documentation/local_llm_ops_guide.md`（既存の充実した運用文書。変更不要）
- Related: `01_Plans/issues/done/issue-PROV-VIS-01-llm-provider-visibility-badge.md`, `issue-PROV-ERROR-01-structured-provider-error-propagation.md`, `issue-PROV-CONTRACT-01-llm-provider-spec-drift-correction.md`
- Derived-from: 2026-07-06のコード監査（`provider.py`・`client.ts`・`App.tsx`・`SidePanel.tsx` 実読）
