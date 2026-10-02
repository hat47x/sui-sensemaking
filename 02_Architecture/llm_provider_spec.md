# English Summary

> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。
This document is the single source of truth for provider abstraction in sui-sensemaking. It standardizes provider enum, `SUI_*` configuration, `LLMRequest`/`LLMResponse` contracts, and links the LLM input IR to the dedicated Phase-B IR spec.

# llm_provider_spec — LLMプロバイダ抽象仕様（正本）

本仕様は、sui-sensemakingにおけるLLM連携の唯一の正本である。
`llm_provider.md` の内容は本仕様へ統合し、重複定義を持たない。

---


## CE1 Contract Handoff Boundary（Stream C / 2026-05-04）

- Provider層はCE1 v1契約を入力境界として扱い、`ContextQueryV1` / `ContextBundleV1` のキー追加・再定義を行わない。
- 固定エラー語彙はprovider実装差異に依存させず、`preview_required` / `unknown_contract_key` / `nondeterministic_bundle` を共通運用語彙として保持する。
- `LLMResponse.metadata.trace_id` と併せて `queryCanonicalHash` / `bundleHash` を監査相関キーとして扱えることを必須とする。
- CE2/CE4連携はmock-firstを許容し、provider実装完了を前提条件にしない（contract-only handoff）。

## 1. 目的と原則

- safeMode既定ONと漏えい防止を優先し、既定は `none`（LLM無効）とする。
- provider抽象はベンダロックインを避け、実装差異を吸収する。
- Provider分類は**通信プロトコルではなく信頼境界**で定義する。
  - 通信プロトコルは `transport`（in-process / ipc / httpなど）で別管理する。
- テスト再現性のためFixtureProviderを正式サポートする。
- 入力は構造化テキストのみ（画像・バイナリは対象外）。

---

## 2. Provider enum（確定）

正式列挙値は以下で固定する。

- `none`
- `fixture`
- `local`
- `external`

### 2.1 この分類を採用する理由

1. `local` と `external` はoutbound制御・監査・safeMode赤線化要件が異なるため、同一値へ統合しない。
2. `transport` は同一provider内で差し替え可能（例: local + ipc/local + http）であり、provider enumと役割が異なる。
3. `fixture` は決定論回帰のための特別実行形態で、`none/local/external` と同列に独立管理する必要がある。

> **実装ノート（PROV-CONTRACT-01・2026-07-06）**: `fixture` は概念上の分類であり、`SUI_LLM_PROVIDER` 環境変数の受理値（`none|local|local_http|large-scale|large_scale|external|deepseek`）には含まれない。Python テストコードから直接インスタンス化される test-only provider であり、実行時に `SUI_LLM_PROVIDER=fixture` を設定しても解決できない。

---

## 3. 設定キー（`SUI_*` に完全統一）

互換aliasは持たない。接頭辞のない旧LLM設定キーは非対応とする。

```text
SUI_LLM_PROVIDER=none|local|local_http|large-scale|large_scale|external|deepseek
SUI_LLM_ESCALATION_ENABLED=false
SUI_LLM_LARGE_SCALE_OPT_IN=false
SUI_LOCAL_LLM_BASE_URL=<url-or-socket>
SUI_LOCAL_LLM_MODEL=<model_id>
SUI_LARGE_SCALE_LLM_BASE_URL=<allowlisted_endpoint>
SUI_LARGE_SCALE_LLM_MODEL=<model_id>
SUI_LARGE_SCALE_LLM_ALLOWLIST=<host-list>
SUI_DEEPSEEK_API_KEY=<secret>
SUI_DEEPSEEK_BASE_URL=https://api.deepseek.com
SUI_DEEPSEEK_MODEL=deepseek-v4-flash
SUI_DEEPSEEK_THINKING_MODE=disabled
```

- `SUI_LLM_PROVIDER=none` を既定値とする。
- `SUI_LLM_PROVIDER=external` は `SUI_LLM_ESCALATION_ENABLED=true` かつ `SUI_LLM_LARGE_SCALE_OPT_IN=true` を必須とする。
- `SUI_LLM_PROVIDER=deepseek` は `SUI_DEEPSEEK_API_KEY` を必須とし、未設定時は起動を拒否する。
- `SUI_DEEPSEEK_THINKING_MODE` は `disabled|enabled`。既定 `disabled` は旧 `deepseek-chat` のnon-thinking semanticsを維持する。

### 3.1 AI-MODEL-GOVERNANCE-03: per-model動的dispatch（2026-08-27追記）

model registry（`LLMProviderRegistryRow`/`LLMModelRegistryRow`）は `providerId` から `providerKind` を独立に保持しており、`SUI_LLM_PROVIDER` はもはや「実行時に選ばれる唯一のprovider」ではない。

- `SUI_LLM_PROVIDER` の役割は次の2つに整理される。
  1. **起動時fail-fast対象**: `validate_llm_provider_guards()` はこの値が指す `providerKind` の設定完全性のみを起動時に検査する（本節冒頭の3箇条は不変）。
  2. **既定/フォールバックtransport**: `model` を指定しないAI呼び出し（suggest-layout / suggest-merges / check-narrative / detect-contradiction）はこの値をそのまま使う。
- **model単位のdispatch**: `model` を指定するAI呼び出しは、そのmodelの登録先 `providerId` → `providerKind` を解決し、`ProviderRegistry.resolve(providerKind)` で対応するtransport（`local`/`large-scale`/`deepseek`）へ直接dispatchする。判定は `SUI_LLM_PROVIDER` と一致するかではなく、その `providerKind` **自身**の設定完全性（`provider_kind_readiness_errors()`、起動時チェックと同一関数を共用）で行う。したがって `SUI_LLM_PROVIDER=local` のプロセスでも、`SUI_DEEPSEEK_API_KEY` が設定済みなら `deepseek` 配下のmodelへ正しくdispatchできる。
- **`none` は無条件のkill switch**: `SUI_LLM_PROVIDER=none` のときは、registryに他の `providerKind` が設定済みであっても動的dispatchを一切行わない。model単位の判定より先にこの条件を評価する（AGENTS.md安全不変条件「`SUI_LLM_PROVIDER=none` でも主要価値が成立する」を維持するための設計判断）。
- **未設定providerの扱い**: 判定に失敗したmodel（`providerKind` 自身の設定不足、`none`、未対応kind）は、LLM呼び出し前に `503 model_provider_unavailable` で拒否する（`ProviderRequestError`由来の生例外を返さない）。
- **apiKeyRef**: registry行の `apiKeyRef`（AC-4で参照形式のみ受理）は、dispatch先の資格情報として直接使わない。各transportは従来どおり `SUI_*_API_KEY` 環境変数を直接読む。dispatchはどのtransport factoryを呼ぶかだけを決め、資格情報の読み出し経路は変更しない。

---

## 4. Interface 契約（`LLMRequest`/`LLMResponse`）

> **PROV-CONTRACT-01（2026-07-06・ADR-0050 D3）で是正**: 本節はかつて `inputs`/`output_schema`/構造化`usage`/`provider_meta` 直接受け渡しを「正規形に固定」と記載していた。現在は `LLMRequest.inputs` だけが**内部の監査用IR保持フィールド**として配線済みで、HTTP provider transportへは送信しない。その他の未配線拡張は §4.4 に分離する。

### 4.1 `LLMRequest`（実装済み・`provider.py` の `LLMRequest` dataclass 準拠）

```json
{
  "task": "string",
  "prompt": "string",
  "temperature": 0.2,
  "max_tokens": 2000
}
```

- `task` は自由文字列（例: `re_layout`・`merge_cards` 等、呼び出し元ルートが指定する）。
- HTTP送信時の`task`は128文字以下のlowercase canonical ID、`prompt`は非空文字列とする。JSON envelope全体はUTF-8で1MiB以下とし、超過時はprovider transportを呼ばず`provider_validation`で停止する。prompt本文をerrorへ反射しない。
- `temperature`・`max_tokens` は既定値を持つoptionalフィールド。HTTP送信時はfiniteな`0 <= temperature <= 2`と`1 <= max_tokens <= 32768`だけを受理し、JSONの`NaN`/`Infinity`拡張表現を送信しない。
- `inputs` は `llm_input_ir_spec.md` の構造化IRをroute→provider境界まで保持する内部フィールドであり、IR移行済みrouteだけが設定する。HTTP transportのJSON envelopeには含めず、providerが読むのはIRからrender済みの `prompt` である。したがって `cluster_candidates.score` 等の内部構造値は、prompt rendererが明示的に採用しない限りproviderへ送られない（`ADR-0090` の「内部計算と意味づけの分離」）。

### 4.2 `LLMResponse`（実装済み・`provider.py` の `LLMResponse`/`LLMCallMetadata` dataclass 準拠）

```json
{
  "raw_text": "string",
  "metadata": {
    "provider_kind": "none|local|large-scale",
    "provider_name": "none|local|large-scale",
    "model_id": "string",
    "transport": "none|http",
    "requested_at": "ISO-8601",
    "trace_id": "llm-...",
    "fallback_to_none": false,
    "execution_path": "primary"
  }
}
```

- `raw_text` はproviderが返した生テキスト（構造化 `output` ではない）。呼び出し元ルート（`03_Implement/backend/src/sui_sensemaking_api/routes/ai.py`）がタスクごとにJSONとしてパース・検証する。
- `usage`（トークン数）は未実装。

### 4.3 失敗時契約（実装済み）

- HTTP provider応答は1MiB以下の`{"text": string}`単独objectだけを受理する。非UTF-8/非JSON、object以外、余分なfield、size超過、`text`型不正は値をclient・logへ反射せずfail-fastとし、再整形で救済しない。`ProviderRequestError.validation` として `422` を返す。
- HTTP base URLはcredential/query/fragment、空白・制御文字・backslashを含まないHTTPS、またはloopback HTTPだけを受理する。model IDは256文字以下のcanonical値とする。large-scaleはbase URL・model・canonical host allowlistを完全セットで必須とし、URL/wildcard/port/path/重複hostやbase URLとの不一致を起動時に拒否する。
- `provider_validation`は設定済みfallbackの有無に関係なく`none`へ変換せず、そのまま`422`として返す。request/response契約違反をprovider不達の`503`へ隠さない。timeout/unavailableだけが既存fallback対象になり得る。
- `large-scale`（設定エイリアス `external`/`large_scale` も同じproviderを指す）が無効設定時はフォールバックしない。`ProviderRequestError.unavailable`（`503`）。
- 失敗時も `metadata.trace_id` を監査ログへ残す（`ProviderError.to_contract()`）。
- HTTPステータス対応: `provider_timeout→504` / `provider_validation→422` / `provider_unavailable→503`（`ProviderDisabledError` も `503`、`disabled_reason` 付き）。

### 4.4 Phase-2（未配線・Pending）

以下は `llm_input_ir_spec.md` 等で仕様は存在するが、`LLMRequest`/`LLMResponse` への実配線はまだ無い。実装時期は未定であり、本節の記載は「仕様が先行して存在する」ことを示すに留める。

- `LLMRequest.output_schema`: JSON Schemaを渡しproviderにスキーマ準拠出力を強制させる経路。現状はルート側で受信後にパース・検証している。
- `LLMRequest.options.timeout_ms`/`seed`: 決定論的再現・タイムアウト制御の明示指定。
- `LLMRequest.context.trace_id`/`safe_mode`: 呼び出し側からのtrace_id引き継ぎ・safe_modeフラグの明示伝播（現状 `trace_id` はprovider層が `_new_metadata()` で新規採番する）。
- `LLMResponse.usage`: トークン数計測。
- `LLMResponse` の構造化 `output`: `raw_text` に代えてJSON Schema準拠のオブジェクトを直接返す経路。

---

## 5. 監査データ契約

`generate(LLMRequest) -> LLMResponse` の成否に関わらず、以下を構造化記録する。

- provider種別
- model_id
- transport
- requested_at
- fallback_to_none
- trace_id

監査ログにpayload本文・PII・秘匿トークンを保存しない。

---

## 6. Attachments 制約

- 入力データはKJ構造データ由来の構造化テキストのみ。
- バイナリ添付、画像、音声を `LLMRequest.prompt`（および §4.4でPhase-2とした将来の `inputs`）に含めない。

---

## 7. 役割境界

- Provider層は「提案生成」だけを担当する。
- 意思決定確定APIを提供しない。
- 最終確定は人間操作でのみ実施する。

---

## 8. 参照

- 入力IR正本: `02_Architecture/llm_input_ir_spec.md`
- 実行制約: `02_Architecture/llm_runtime_constraints.md`
- 品質戦略: `02_Architecture/llm_quality_strategy.md`
- エスカレーション方針: `02_Architecture/llm_escalation_policy.html`
- 計画正本: `01_Plans/adr/ADR-0009-local-llm-integration.md`


## 9. CE1 ContextQuery/ContextBundle Contract Bridge（contract-only / mock-first）

本仕様はprovider抽象の正本であるが、CE1基盤のquery/bundle契約整合を次の通り固定する。

### 9.1 Closed-world contract（v1）

- `ContextQueryV1` / `ContextBundleV1` はv1でclosed-worldとし、未定義キーを拒否する。
- 未定義キーは `400 unknown_contract_key` を返す。
- `previewConfirmed=false` はprovider呼び出し前に `422 preview_required` として失敗させる。

### 9.2 Deterministic hash gate

- `queryCanonicalHash` と `bundleHash` は監査キーとして必須扱いにする。
- 同一canonical queryで `bundleHash` が一致しない場合は `409 nondeterministic_bundle` を返し、provider実行を継続しない。

### 9.3 Mock validation profile（実装依存切断）

実LLM接続未確定でも以下をfixtureで検証できる状態をDoDとする。

1. `previewConfirmed=false -> 422 preview_required`
2. 未定義キー -> `400 unknown_contract_key`
3. 同一canonical query 3回実行で `queryCanonicalHash` / `bundleHash` が3/3一致
4. 3回中1回でも不一致なら `409 nondeterministic_bundle`

## 10. Stream B CE0/CE1 mock-first provider alignment（2026-05-06）

- Scope: CE0/CE1契約整合（contract-only）。
- Providerは `previewConfirmed` ゲート通過後にのみ呼び出される前提を維持する。
- CE1 v1 closed-worldにより未定義キーはprovider層到達前に `400 unknown_contract_key` で拒否する。
- `bundleHash` 非決定論検知時は `409 nondeterministic_bundle` を返しfail-closedとする。
- 本節はmock-first連携を想定し、実LLM実装差分を契約語彙へ反映しない。

## CE1 mock-first contract reaffirmation（2026-05-07 / Stream B）

- ProviderはCE1 v1契約の下流であり、`ContextQueryV1` / `ContextBundleV1` のキー再定義を行わない。
- Provider到達前ゲートを固定する。
  - `previewConfirmed=false` -> `422 preview_required`
  - unknown key -> `400 unknown_contract_key`
  - hash非決定論 -> `409 nondeterministic_bundle`
- 監査相関キーは `queryCanonicalHash` / `bundleHash` / `LLMResponse.metadata.trace_id` を最小集合として保持する。
- 本再確認はcontract-onlyであり、接続実装・リトライ戦略・モデル選定は本凍結範囲外とする。


## Stream B contract stabilization addendum（2026-05-18 / CE1-independent）

### Context
Provider抽象の差異でCE1契約語彙が揺れると、CE2/CE4の監査再現性が崩れる。

### Decision
- Provider層はCE1契約語彙を変更しない。
- 固定語彙は `preview_required` / `unknown_contract_key` / `nondeterministic_bundle` のみ。
- Provider実装差異によるfallbackは **契約エラーを書き換えてはならない**。
- `queryCanonicalHash` / `bundleHash` / `LLMResponse.metadata.trace_id` を最小監査相関キーとして固定。
- mock-first contract testはprovider種別に依存させない（fixtureで同一判定）。

### Consequences
- provider切替（none/fixture/local/external）でもCE1 I/F契約は不変。
- CE2/CE4はprovider実装進捗と独立して契約連携を継続できる。


## Stream B CE1 provider contract freeze addendum（2026-05-20 / I/F-first + mock-first）

### Context
Provider切替時にCE1語彙が変化すると、query/bundle契約の監査相関が崩れる。

### Decision
- Provider層はCE1 v1 closed-world契約語彙を変更しない。
- 固定エラーは `422 preview_required` / `400 unknown_contract_key` / `409 nondeterministic_bundle`。
- mock-first検証で `stubDatasetId=A2-minimal-v1` を利用し、実DB/実LLM依存なしで契約判定可能とする。

### Consequences
- provider実装状態に依存せず、CE1契約を先に凍結して下流へhandoffできる。
- 衝突検知時はprovider側で意味変換せず、停止して上流契約へ戻す運用を徹底できる。
