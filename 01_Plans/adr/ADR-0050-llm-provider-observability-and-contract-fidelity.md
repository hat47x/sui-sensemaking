# ADR-0050: LLMプロバイダの可視性・エラー忠実性・契約整合

- Status: Proposed
- Date: 2026-07-06
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `03_Implement/frontend/src/`, `03_Implement/backend/src/sui_sensemaking_api/`, `02_Architecture/llm_provider_spec.md`, `01_Plans/issues/`

## Context

- 「ローカルLLM・生成AIまわりで、ADR起票後に要件の詳細化やUI/UXデザインが未定の箇所が多い」という指摘を受け、実装コード（`provider.py`・`client.ts`・`App.tsx`・`SidePanel.tsx`）を直接読み、既存の文書（`ADR-0009`・`llm_provider_spec.md`・`04_Documentation/local_llm_ops_guide.md`）と突き合わせて棚卸しした。
- **すでに十分に決定され、文書化されていると確認できたもの**（本ADRの対象外であり、再決定しない）
  - プロバイダの抽象（`none|fixture|local|large-scale`）、設定キー、safeMode既定ON、ローカルファーストの方針（`ADR-0009` Accepted、`llm_provider_spec.md` §1-3）。
  - ローカルLLMの `/generate` 契約は、**意図的にsui-sensemaking独自の形**（OpenAIやOllamaとは互換でない）であり、実運用には薄いアダプタ層が必要だという判断（`04_Documentation/local_llm_ops_guide.md` に明記済み）。GPUなしで確認するためのモックアダプタ（`03_Implement/deploy/tools/mock_local_llm.py`）も実装済みである。
  - エスカレーションの方針、品質ゲート、HIL-RS A1契約（`02_Architecture/llm_escalation_policy.html`・`llm_quality_strategy.md`・`hil_rs_01_a1_minimum_interface_contract.md`）は凍結済みである。
- **確認された本当のギャップ**（コードを読んで実証済みで、本ADRの対象）
  1. **プロバイダの状態が見えない**: `SUI_LLM_PROVIDER` は、運用者がdeploy時に設定する環境変数だけで、アプリ内に「今どのproviderが有効か」を示すUIが一切ない（grepで確認したところ、該当するUI要素はない）。
  2. **エラーの分類が、バックエンドからフロントエンドへの経路で失われる**（3層すべてで確認）。
     - バックエンド `provider.py` は `ProviderRequestError.unavailable/timeout/validation` と `ProviderDisabledError`（`disabled_reason` 付き）という構造化エラー種別を `to_contract()` で用意している（[provider.py:81-100](../../03_Implement/backend/src/sui_sensemaking_api/llm/provider.py)）。
     - しかしフロントエンドの `ApiError`（[client.ts:17-24](../../03_Implement/frontend/src/api/client.ts)）は `status: number` と平文の `message: string` だけを保持し、構造化されたフィールドを受け取る型を持たない。
     - `App.tsx:2510` の呼び出し元は、受け取った平文のメッセージに対して、**正規表現 `/AI is disabled|provider.*disabled/i` で文字列を照合**し、「provider disabled」バナーが要るかを判定している。その結果、`provider=local` が設定されているのに接続先が落ちている場合（実際には `"local request failed: Connection refused"` などの**未翻訳の英語の例外文が、そのままステータス表示に漏れる**）と、`provider=none`（意図的な無効）の場合を、利用者は画面上で区別できない。
  3. **`llm_provider_spec.md` §4の契約とバックエンドの実装とのずれ**: 仕様は `LLMRequest`（`inputs`・`output_schema`・`options.timeout_ms`/`seed`・`context.trace_id`/`safe_mode`）と `LLMResponse`（`usage`・`provider_meta`の構造化 `output`）を「正規形に固定」と記載するが、実装（[provider.py:16-20](../../03_Implement/backend/src/sui_sensemaking_api/llm/provider.py)）は `LLMRequest{task, prompt, temperature, max_tokens}` → `LLMResponse{raw_text, metadata}` という、大幅に単純化された形だけで、`inputs`/`output_schema`/`usage`/構造化された`output`は配線されていない。凍結された文書である「正本」が、実装済みでない内容を確定事項のように記載しており、これ自体が「詳細化が未定」である一因になっている。
- ADR-0047のゲート判定: 上記の1と2は、R-1（実際に使うときの摩擦。コードの監査で顕在化した、実際の誤誘導と情報の欠落）に該当するため起票する。3は新しい設計判断ではなく、既存の「正本」の記述を正すこと（文書を事実に合わせること）であり、本ADRに併記してまとめて処理する。

## Decision

**LLMプロバイダの状態をアプリ内で偽りなく見えるようにし、バックエンドがすでに持っている構造化されたエラー情報をフロントエンドまで欠落なく伝え、`llm_provider_spec.md` の契約の記述を実装の実態に合わせる。**

### D1. プロバイダの可視化（読み取り専用・運用者による設定を維持）

- Viewパネル（`ViewControlsPanel`、UX-VISUAL-01/02のトグル群と同じ節）に「AIプロバイダ」の表示を追加する。現在の `provider_kind`（none/local/large-scale/fixture）を**読み取り専用**で表示する。
- **実行中に切り替えるUIは提供しない**: providerの変更は、これまでどおり、運用者による環境変数の設定と再起動だけで行う。これは、SafeModeが既定ONで運用者の制御下にあるという既存の方針（`02_Architecture/enterprise_architecture.html` §03）と同じガバナンスの境界であり、エンドユーザーが個別に `large-scale`（外部送信）へ昇格できてしまう抜け道を作らない。
- 直近の呼び出し結果（成功、`provider_unavailable`、`provider_timeout`、`provider_validation`、未使用）を、**スコアリングしない状態ラベル**として併記する（％、点数、信頼度は表示しない）。
- 複雑性予算: 表示はViewパネルの内側（すでに開示済みの領域）に追加するため、初期表示のアンカーは1つも増えない（CB-1）。

### D2. エラー分類を忠実に伝えること（正規表現による照合の廃止）

- バックエンドの `/ai/*` ルートは、`ProviderError.to_contract()` の `code`（`provider_unavailable`|`provider_timeout`|`provider_validation`）と `disabled_reason` を、HTTPエラーレスポンスの構造化されたフィールドとして返す（`detail` を平文からオブジェクトへ拡張する。既存の `detail: string` の読み手との互換は、`detail` を維持しつつ、`code` と `disabled_reason` をトップレベルに追加する形で保つ）。
- フロントエンドの `ApiError` に `code?: string` と `disabledReason?: string` を追加し、`parseErrorMessage` に相当する解析でこれを保持する。
- `App.tsx` の判定は、**正規表現ではなく `error.code`/`error.disabledReason` を直接参照する**形へ置き換える。
- 利用者向けのメッセージは、`code` ごとにi18nキーを用意する（例: `provider_disabled` は既存の「AI無効」の文言、`provider_unavailable` と `provider_timeout` は「AI機能に接続できません。運用担当者に確認してください」という、**未翻訳の生の例外文を出さない**文言）。運用者向けの詳細（生のメッセージと `trace_id`）は、開発者コンソールとログにだけ残し、エンドユーザーの画面には出さない。

### D3. `llm_provider_spec.md` §4の契約記述の是正（文書の整合であり、新しい設計判断ではない）

- §4.1/4.2を「現在実装済みの最小契約」として書き直す。 `LLMRequest{task, prompt, temperature, max_tokens}` → `LLMResponse{raw_text, metadata(provider_kind/provider_name/model_id/transport/requested_at/trace_id/fallback_to_none)}`。
- `inputs`・`output_schema`・構造化された `output`・`usage`・`context.safe_mode` の直接の受け渡しは、**Phase-2（未配線・Pending）** として明示的に切り分け、「正規形に固定」という既存の言い回しを、「将来配線する予定で、現状は未接続」に是正する。
- `02_Architecture/llm_input_ir_spec.md` との関係も、「IRの仕様はあるが、`LLMRequest.inputs` への実際の配線はまだない」と明記する。

### Pending（本ADRでは決定せず、明示的に未決事項として残す）

- **OpenAI互換（`/v1/chat/completions`）のワイヤ形式の追加または代替**: 現状の `/generate` 独自契約は「意図的な決定」であり、実際に使う場面での摩擦（誰かが実際にOllamaなどをつなごうとして失敗した記録）はまだ確認されていない。ADR-0047のR-1は「顕在化した」摩擦を要求するため、予測に基づく契約の変更は、本ADRの範囲外とする。このPending事項は `ROADMAP.md` の要件C（LLMアダプタ基盤）に追記し、実際の摩擦が観測された時点で、別のADRとして起票する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 運用者とエンドユーザーは、「AIが今使えるか、使えないなら意図的な無効か障害か」を画面から判断できる必要がある。未翻訳の生の例外文がエンドユーザーの画面へ漏れるのは誤誘導であり、実際に使うときの摩擦（ADR-0047 R-1）に該当する | 機能: 実行中に切り替えるUIは提供せず、運用者による設定と再起動を維持する。データ: 直近の呼び出し結果を、スコアリングしない状態ラベルとして表示する |
| **データ設計** | バックエンドの`ProviderError.to_contract()`（code: provider_unavailable/timeout/validation, disabled_reason）を、HTTPレスポンスの構造化されたフィールドとして欠落なく伝える。フロントエンドの`ApiError`に`code`/`disabledReason`を追加する | 業務: 利用者向けのメッセージは、codeごとのi18nキーで示し、生の例外文を出さない。機能: 詳細（trace_idなど）は、開発者コンソールとログにだけ残す |
| **機能設計** | ViewパネルにAIプロバイダの状態（読み取り専用）を追加する。App.tsxの判定は、正規表現ではなく`error.code`/`disabledReason`を直接参照する。`llm_provider_spec.md`§4を、実装済みの契約（LLMRequest{task,prompt,temperature,max_tokens}→LLMResponse{raw_text,metadata}）に是正する | 業務: provider変更は運用者の制御のままとする（SafeMode既定ONのガバナンスの境界と同一）。データ: inputs/output_schema/usageは、Phase-2（未配線）として明示的に切り分ける |

## Consequences

- 期待される効果: 運用者もエンドユーザーも、「AIが今使えるか、使えないなら意図的な無効か障害か」を画面から判断できるようになる。誤解を招く未翻訳の例外文が出なくなる。`llm_provider_spec.md` が実装と一致し、以後の実装判断（IRの配線など）の起点として信頼できる状態になる。
- 副作用と制約: `/ai/*` のエラーレスポンスの形が変わる（`detail` は維持するため既存のクライアントを壊す変更にはならないが、HTTPレスポンスボディへのフィールドの追加を伴う）。Viewパネルへの表示の追加は軽微だが、i18nキーの追加とテストの更新が必要になる。
- 移行対応（Actionはissueで管理する）
  - `PROV-VIS-01`: プロバイダの可視化バッジと状態ラベル（Viewパネル、e2e）。
  - `PROV-ERROR-01`: 構造化エラーの伝播（backendで `to_contract()` を公開し、frontendの `ApiError` を拡張し、正規表現を除去する。integration）。
  - `PROV-CONTRACT-01`: `llm_provider_spec.md` §4の記述の是正（docs-check）。
  - `ROADMAP.md` の要件Cへ、OpenAI互換のワイヤ形式のPending事項を追記する。

## Traceability

- Related: `01_Plans/adr/ADR-0009-local-llm-integration.md`（プロバイダの抽象の親ADR。再決定しない）
- Related: `01_Plans/adr/ADR-0047-design-decision-adr-saturation-and-execution-first.md`（R-1の、実際に使うときの摩擦で起票）
- Related: `02_Architecture/llm_provider_spec.md`（D3是正対象）, `02_Architecture/llm_input_ir_spec.md`, `04_Documentation/local_llm_ops_guide.md`（既存の充実した運用文書であり、変更は不要）
- Related: `01_Plans/issues/done/issue-PROV-VIS-01-llm-provider-visibility-badge.md`, `issue-PROV-ERROR-01-structured-provider-error-propagation.md`, `issue-PROV-CONTRACT-01-llm-provider-spec-drift-correction.md`
- Derived-from: 2026-07-06のコード監査（`provider.py`・`client.ts`・`App.tsx`・`SidePanel.tsx` 実読）
