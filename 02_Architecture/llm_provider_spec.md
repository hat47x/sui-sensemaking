# 概要

> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md` である。本書には必要最小限だけを書き、追加や改名のときは正本を先に更新する。
本書は、sui-sensemakingにおけるプロバイダ抽象の唯一の正本である。プロバイダのenum、`SUI_*` 設定、`LLMRequest`/`LLMResponse` の契約を標準化し、LLM入力IRは、Phase-B専用のIR仕様に結びつける。

# llm_provider_spec: LLMプロバイダ抽象仕様（正本）

本仕様は、sui-sensemakingにおけるLLM連携の唯一の正本である。
`llm_provider.md` の内容は本仕様へ統合し、重複した定義は持たない。

---


## CE1 Contract Handoff Boundary（Stream C / 2026-05-04）

- プロバイダ層は、CE1 v1契約を入力の境界として扱い、`ContextQueryV1` / `ContextBundleV1` のキー追加や再定義を行わない。
- 固定のエラー語彙はプロバイダ実装の差異に依存させず、`preview_required` / `unknown_contract_key` / `nondeterministic_bundle` を共通の運用語彙として保つ。
- `LLMResponse.metadata.trace_id` とあわせて、`queryCanonicalHash` / `bundleHash` を監査の相関キーとして扱えることを必須とする。
- CE2/CE4との連携はmock-firstを許容し、プロバイダ実装の完了を前提条件にしない（contract-only handoff）。

## 1. 目的と原則

- safeModeの既定ONと漏えい防止を優先し、既定は `none`（LLM無効）とする。
- プロバイダ抽象は、ベンダロックインを避け、実装の差異を吸収する。
- プロバイダの分類は、**通信プロトコルではなく信頼境界**で定義する。
  - 通信プロトコルは、`transport`（in-process / ipc / httpなど）で別に管理する。
- テストの再現性のため、FixtureProviderを正式にサポートする。
- 入力は構造化テキストだけとする（画像・バイナリは対象外）。

---

## 2. プロバイダenum（確定）

正式な列挙値は、次のとおりに固定する。

- `none`
- `fixture`
- `local`
- `external`

### 2.1 この分類を採用する理由

1. `local` と `external` は、送信制御・監査・safeModeの赤線化の要件が異なるため、同じ値には統合しない。
2. `transport` は同じプロバイダの中で差し替えられる（例: local + ipc/local + http）ので、プロバイダenumとは役割が異なる。
3. `fixture` は決定論的な回帰のための特別な実行形態であり、`none/local/external` と同列に独立して管理する必要がある。

> **実装ノート（PROV-CONTRACT-01・2026-07-06）**: `fixture` は概念上の分類であり、`SUI_LLM_PROVIDER` 環境変数が受理する値（`none|local|local_http|large-scale|large_scale|external|deepseek`）には含まれない。Pythonのテストコードから直接インスタンス化するtest-onlyのプロバイダなので、実行時に `SUI_LLM_PROVIDER=fixture` を設定しても解決できない。

---

## 3. 設定キー（`SUI_*` に完全統一）

互換エイリアスは持たない。接頭辞のない旧LLM設定キーは非対応とする。

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
- `SUI_LLM_PROVIDER=external` は、`SUI_LLM_ESCALATION_ENABLED=true` かつ `SUI_LLM_LARGE_SCALE_OPT_IN=true` を必須とする。
- `SUI_LLM_PROVIDER=deepseek` は `SUI_DEEPSEEK_API_KEY` を必須とし、未設定のときは起動を拒否する。
- `SUI_DEEPSEEK_THINKING_MODE` は `disabled|enabled` を取る。既定の `disabled` は、旧 `deepseek-chat` のnon-thinkingの意味を維持する。

### 3.1 AI-MODEL-GOVERNANCE-03: モデルごとの動的dispatch（2026-08-27追記）

モデルレジストリ（`LLMProviderRegistryRow`/`LLMModelRegistryRow`）は、`providerId` とは独立に `providerKind` を保持している。このため `SUI_LLM_PROVIDER` は、もはや「実行時に選ばれる唯一のプロバイダ」ではない。

- `SUI_LLM_PROVIDER` の役割は、次の2つに整理される。
  1. **起動時に即座に失敗させる対象**: `validate_llm_provider_guards()` は、この値が指す `providerKind` の設定が揃っているかだけを起動時に検査する（本節冒頭の3箇条は変わらない）。
  2. **既定かつフォールバックのtransport**: `model` を指定しないAI呼び出し（suggest-layout / suggest-merges / check-narrative / detect-contradiction）は、この値をそのまま使う。
- **モデル単位のdispatch**: `model` を指定するAI呼び出しは、そのモデルの登録先 `providerId` から `providerKind` を解決し、`ProviderRegistry.resolve(providerKind)` で対応するtransport（`local`/`large-scale`/`deepseek`）へ直接dispatchする。判定は `SUI_LLM_PROVIDER` と一致するかどうかではなく、その `providerKind` **自身**の設定が揃っているか（`provider_kind_readiness_errors()`。起動時のチェックと同じ関数を共用する）で行う。したがって `SUI_LLM_PROVIDER=local` のプロセスでも、`SUI_DEEPSEEK_API_KEY` が設定済みなら、`deepseek` 配下のモデルへ正しくdispatchできる。
- **`none` は無条件のkill switch**: `SUI_LLM_PROVIDER=none` のときは、レジストリに他の `providerKind` が設定済みであっても、動的dispatchを一切行わない。モデル単位の判定より先に、この条件を評価する（AGENTS.mdの安全不変条件「`SUI_LLM_PROVIDER=none` でも主要価値が成立する」を維持するための設計判断）。
- **未設定のプロバイダの扱い**: 判定に失敗したモデル（`providerKind` 自身の設定不足、`none`、未対応のkind）は、LLMを呼び出す前に `503 model_provider_unavailable` で拒否する（`ProviderRequestError` 由来の生の例外は返さない）。
- **apiKeyRef**: レジストリ行の `apiKeyRef`（AC-4で参照形式だけを受理）は、dispatch先の資格情報として直接は使わない。各transportは従来どおり `SUI_*_API_KEY` 環境変数を直接読む。dispatchが決めるのは、どのtransport factoryを呼ぶかだけであり、資格情報を読み出す経路は変えない。

---

## 4. インターフェース契約（`LLMRequest`/`LLMResponse`）

> **PROV-CONTRACT-01（2026-07-06・ADR-0050 D3）で是正**: 本節はかつて、`inputs`/`output_schema`/構造化`usage`/`provider_meta` の直接の受け渡しを「正規形に固定」と記載していた。現在配線済みなのは `LLMRequest.inputs` だけで、これは**内部の監査用IRを保持するフィールド**であり、HTTPプロバイダのtransportへは送信しない。そのほかの未配線の拡張は §4.4 に分離する。

### 4.1 `LLMRequest`（実装済み・`provider.py` の `LLMRequest` dataclassに準拠）

```json
{
  "task": "string",
  "prompt": "string",
  "temperature": 0.2,
  "max_tokens": 2000
}
```

- `task` は自由な文字列である（例: `re_layout`・`merge_cards` など。呼び出し元のルートが指定する）。
- HTTPで送信するときの`task`は、128文字以下のlowercaseのcanonical IDとし、`prompt`は空でない文字列とする。JSON envelope全体はUTF-8で1MiB以下とし、超えた場合はプロバイダのtransportを呼ばず、`provider_validation`で停止する。prompt本文をエラーへ反射しない。
- `temperature` と `max_tokens` は、既定値を持つoptionalフィールドである。HTTPで送信するときは、有限の`0 <= temperature <= 2`と`1 <= max_tokens <= 32768`だけを受理し、JSONの`NaN`/`Infinity`の拡張表現は送信しない。
- `inputs` は、`llm_input_ir_spec.md` の構造化IRを、ルートからプロバイダの境界まで保持する内部フィールドであり、IRへ移行済みのルートだけが設定する。HTTP transportのJSON envelopeには含めず、プロバイダが読むのは、IRからレンダリング済みの `prompt` である。したがって `cluster_candidates.score` などの内部の構造値は、promptレンダラーが明示的に採用しない限り、プロバイダへ送られない（`ADR-0090` の「内部計算と意味づけの分離」）。

### 4.2 `LLMResponse`（実装済み・`provider.py` の `LLMResponse`/`LLMCallMetadata` dataclassに準拠）

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

- `raw_text` はプロバイダが返した生のテキストであり、構造化された `output` ではない。呼び出し元のルート（`03_Implement/backend/src/sui_sensemaking_api/routes/ai.py`）が、タスクごとにJSONとしてパースして検証する。
- `usage`（トークン数）は未実装である。

### 4.3 失敗時の契約（実装済み）

- HTTPプロバイダの応答は、1MiB以下の`{"text": string}`だけのobjectに限って受理する。非UTF-8や非JSON、object以外、余分なフィールド、サイズ超過、`text`の型の不正は、値をクライアントやログへ反射せず、即座に失敗とし、再整形で救済しない。`ProviderRequestError.validation` として `422` を返す。
- HTTPのbase URLは、credential・query・fragment、空白・制御文字・バックスラッシュを含まないHTTPS、またはloopbackのHTTPだけを受理する。モデルIDは、256文字以下のcanonicalな値とする。large-scaleは、base URL・モデル・canonicalなホストの許可リストを完全なセットで必須とし、URL・ワイルドカード・ポート・パス・重複したホスト、base URLとの不一致を、起動時に拒否する。
- `provider_validation`は、フォールバックが設定済みかどうかに関係なく、`none`へ変換せず、そのまま`422`として返す。リクエストやレスポンスの契約違反を、プロバイダ不達の`503`に隠さない。既存のフォールバックの対象になり得るのは、タイムアウトと利用不可だけである。
- `large-scale`（設定エイリアスの `external`/`large_scale` も、同じプロバイダを指す）が無効に設定されているときは、フォールバックしない。`ProviderRequestError.unavailable`（`503`）を返す。
- 失敗したときも、`metadata.trace_id` を監査ログに残す（`ProviderError.to_contract()`）。
- HTTPステータスの対応: `provider_timeout→504` / `provider_validation→422` / `provider_unavailable→503`（`ProviderDisabledError` も `503` で、`disabled_reason` が付く）。

### 4.4 Phase-2（未配線・Pending）

次は、`llm_input_ir_spec.md` などに仕様はあるが、`LLMRequest`/`LLMResponse` への実際の配線はまだない。実装の時期は未定であり、本節の記載は「仕様が先に存在する」ことを示すにとどめる。

- `LLMRequest.output_schema`: JSON Schemaを渡し、プロバイダにスキーマへ準拠した出力を強制させる経路。現状は、ルート側が受信後にパースして検証している。
- `LLMRequest.options.timeout_ms`/`seed`: 決定論的な再現とタイムアウト制御を、明示的に指定するもの。
- `LLMRequest.context.trace_id`/`safe_mode`: 呼び出し側からのtrace_idの引き継ぎと、safe_modeフラグの明示的な伝播（現状の `trace_id` は、プロバイダ層が `_new_metadata()` で新規に採番する）。
- `LLMResponse.usage`: トークン数の計測。
- `LLMResponse` の構造化 `output`: `raw_text` の代わりに、JSON Schemaに準拠したオブジェクトを直接返す経路。

---

## 5. 監査データの契約

`generate(LLMRequest) -> LLMResponse` の成否に関わらず、次を構造化して記録する。

- プロバイダの種別
- model_id
- transport
- requested_at
- fallback_to_none
- trace_id

監査ログには、payload本文・PII・秘匿トークンを保存しない。

---

## 6. 添付の制約

- 入力データは、KJ構造データ由来の構造化テキストだけとする。
- バイナリの添付、画像、音声を、`LLMRequest.prompt`（および §4.4でPhase-2とした将来の `inputs`）に含めない。

---

## 7. 役割の境界

- プロバイダ層が担当するのは「提案の生成」だけである。
- 意思決定を確定するAPIは提供しない。
- 最終的な確定は、人間の操作でのみ実施する。

---

## 8. 参照

- 入力IRの正本: `02_Architecture/llm_input_ir_spec.md`
- 実行制約: `02_Architecture/llm_runtime_constraints.md`
- 品質戦略: `02_Architecture/llm_quality_strategy.md`
- エスカレーション方針: `02_Architecture/llm_escalation_policy.html`
- 計画の正本: `01_Plans/adr/ADR-0009-local-llm-integration.md`


## 9. CE1 ContextQuery/ContextBundle Contract Bridge（contract-only / mock-first）

本仕様はプロバイダ抽象の正本であるが、CE1基盤のquery/bundle契約との整合を、次のとおり固定する。

### 9.1 Closed-world contract（v1）

- `ContextQueryV1` / `ContextBundleV1` は、v1でclosed-worldとし、未定義のキーを拒否する。
- 未定義のキーには `400 unknown_contract_key` を返す。
- `previewConfirmed=false` は、プロバイダを呼び出す前に `422 preview_required` として失敗させる。

### 9.2 Deterministic hash gate

- `queryCanonicalHash` と `bundleHash` は、監査キーとして必須とする。
- 同じcanonical queryで `bundleHash` が一致しない場合は、`409 nondeterministic_bundle` を返し、プロバイダの実行を続けない。

### 9.3 Mock validation profile（実装依存の切断）

実際のLLMへの接続が未確定でも、次をfixtureで検証できる状態をDoDとする。

1. `previewConfirmed=false -> 422 preview_required`
2. 未定義のキー -> `400 unknown_contract_key`
3. 同じcanonical queryを3回実行して、`queryCanonicalHash` / `bundleHash` が3/3一致
4. 3回のうち1回でも不一致なら `409 nondeterministic_bundle`

## 10. Stream B CE0/CE1 mock-first provider alignment（2026-05-06）

- 対象範囲: CE0/CE1の契約整合（contract-only）。
- プロバイダは、`previewConfirmed` のゲートを通過した後にだけ呼び出される、という前提を維持する。
- CE1 v1のclosed-worldにより、未定義のキーは、プロバイダ層に届く前に `400 unknown_contract_key` で拒否する。
- `bundleHash` の非決定性を検知したときは、`409 nondeterministic_bundle` を返し、安全側で拒否する。
- 本節はmock-firstの連携を想定しており、実際のLLM実装の差分を、契約の語彙へ反映しない。

## CE1 mock-first contract reaffirmation（2026-05-07 / Stream B）

- プロバイダはCE1 v1契約の下流にあり、`ContextQueryV1` / `ContextBundleV1` のキーを再定義しない。
- プロバイダに届く前のゲートを固定する。
  - `previewConfirmed=false` -> `422 preview_required`
  - unknown key -> `400 unknown_contract_key`
  - hashの非決定性 -> `409 nondeterministic_bundle`
- 監査の相関キーは、`queryCanonicalHash` / `bundleHash` / `LLMResponse.metadata.trace_id` を最小の集合として保持する。
- 今回の再確認はcontract-onlyであり、接続の実装・リトライ戦略・モデル選定は、この凍結の範囲外とする。


## Stream B contract stabilization addendum（2026-05-18 / CE1-independent）

### Context
プロバイダ抽象の差異でCE1の契約語彙が揺れると、CE2/CE4の監査の再現性が崩れる。

### Decision
- プロバイダ層は、CE1の契約語彙を変更しない。
- 固定する語彙は、`preview_required` / `unknown_contract_key` / `nondeterministic_bundle` だけである。
- プロバイダ実装の差異によるフォールバックは、**契約エラーを書き換えてはならない**。
- `queryCanonicalHash` / `bundleHash` / `LLMResponse.metadata.trace_id` を、最小の監査相関キーとして固定する。
- mock-firstの契約テストは、プロバイダの種別に依存させない（fixtureで同じ判定をする）。

### Consequences
- プロバイダを切り替えても（none/fixture/local/external）、CE1のI/F契約は変わらない。
- CE2/CE4は、プロバイダ実装の進捗とは独立に、契約の連携を続けられる。


## Stream B CE1 provider contract freeze addendum（2026-05-20 / I/F-first + mock-first）

### Context
プロバイダを切り替えたときにCE1の語彙が変わると、query/bundle契約の監査の相関が崩れる。

### Decision
- プロバイダ層は、CE1 v1 closed-world契約の語彙を変更しない。
- 固定するエラーは、`422 preview_required` / `400 unknown_contract_key` / `409 nondeterministic_bundle` である。
- mock-firstの検証では `stubDatasetId=A2-minimal-v1` を利用し、実DBや実LLMに依存せずに、契約を判定できるようにする。

### Consequences
- プロバイダの実装状態に依存せず、CE1契約を先に凍結して、下流へhandoffできる。
- 衝突を検知したときは、プロバイダ側で意味を変換せず、停止して上流の契約へ戻す運用を徹底できる。
