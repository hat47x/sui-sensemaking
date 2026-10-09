# ローカルLLMの運用

想定読者: 自分の端末や組織内で動くLLMをsui-sensemakingに接続する運用担当者と開発者。

本書では、ローカルのLLMに接続するための設定、HTTP通信の仕様、動作確認と問題の切り分けを説明します。

既定ではLLMを利用しないことを確認したうえで、ローカルLLMを有効にする設定、通信の確認方法、元の状態に戻す手順を把握できます。

## 既定値

sui-sensemakingは、既定ではLLMを使いません。

```bash
export SUI_LLM_PROVIDER=none
```

この状態では、AI機能は無効として扱われ、LLM連携によって外部サービスとデータを共有することもありません。最初の評価、受け入れ確認、保存の動作の確認では、この既定値を勧めます。

## ローカルLLMとは

本書では、sui-sensemakingから接続でき、利用者側で管理する範囲にあるLLMの接続先を「ローカルLLM」と呼びます。同じPC上のサービスとは限らず、組織内のサーバーを使う場合もあります。

設定名にlocalとあっても、URLが外部サービスを指していれば、そのサービスへデータが送られます。接続先、保持期間、入力データの扱いを確認してから、有効にしてください。

## ローカルプロバイダを有効にする

```bash
export SUI_LLM_PROVIDER=local
export SUI_LOCAL_LLM_BASE_URL='http://localhost:8001'
export SUI_LOCAL_LLM_MODEL='local-model-name'
```

`local_http` は、`local` の別名として扱います。

> 注意: 上の例は、直接起動したときの設定です。標準のDocker Composeは、これらのキーを渡しません。Compose上で検証するときは、下の「GPUなしで動作イメージを確認する」の、overlayを使う手順に従ってください。また、`api` コンテナの中から見た `http://localhost:8001` は、ホストではなく `api` コンテナ自身を指します。Compose環境では、この例をそのまま写さないでください。

元の設定へ戻す場合は、プロバイダを`none`に戻します。

```bash
export SUI_LLM_PROVIDER=none
```

## HTTPの仕様

サーバー側（backend）は、`<ベースURL>/generate`へPOST要求を送ります。

リクエストは、次の形です。

```json
{
  "task": "string",
  "prompt": "string",
  "temperature": 0.2,
  "max_tokens": 2000,
  "model": "local-model-name"
}
```

応答は、次の形です。

```json
{
  "text": "generated text"
}
```

`text`が文字列でない応答は、プロバイダの検証エラーとして扱います。

この`/generate`は、sui-sensemaking独自の仕様です。OpenAI互換のAPIやOllamaのAPIとは、互換性がありません。`SUI_LOCAL_LLM_BASE_URL` をOllamaなどに直接向けても、動作しません。接続には、この仕様（`POST /generate`、応答は`{"text": "<JSON文字列>"}`）に合わせて要求と応答を変換する、薄い接続部（アダプタ）が必要です。

## GPUなしで動作イメージを確認する（モックアダプタ）

AIの各タスクは、`text` の中に、タスクごとに厳密なJSONを要求します。たとえば、レイアウトの提案には元のすべてのカードが過不足なく含まれること、島のサマリの根拠IDはその島のメンバーであること、ナラティブは読み順と完全に一致することです。GPUのないPCで使う小規模で精度の低いモデルでは、要求されたJSONを安定して生成できず、検証エラー（422）が頻繁に起きることがあります。

動作のイメージだけをGPUなしで確認したいときは、リポジトリに同梱した、決定論的なモックアダプタを使えます。これはLLMではありません。各処理に対して、形式上は妥当な最小限のJSONを返すだけの代替実装です。レイアウトは単純なグリッド配置、要約とナラティブは定型の下書き、統合の候補と整合性のチェックは空になります。画面上で、AI連携のやり取りと表示の流れを確認する用途に限って使ってください。

```bash
# 別の端末でモックアダプタを起動する（Python標準ライブラリだけで動き、依存はありません）
python3 03_Implement/deploy/tools/mock_local_llm.py --host 127.0.0.1 --port 8001

# backend側でローカルプロバイダを有効にし、モックに向ける
export SUI_LLM_PROVIDER=local
export SUI_LOCAL_LLM_BASE_URL=http://localhost:8001
export SUI_LOCAL_LLM_MODEL=mock
```

> 注意: `mock_local_llm.py` は、直接起動（backendをローカルで直接起動する構成）向けの確認手段です。標準のDocker Compose環境では、代わりに、検証専用の `docker-compose.llm-stub.yml` を重ねて使ってください（`docker compose -f docker-compose.yml -f docker-compose.llm-stub.yml up -d`）。これはCompose内のネットワークで完結する、別の決定論的なスタブ（`llm-stub` サービス）で、`mock_local_llm.py` とは別の仕組みです。どちらも、本番に近い、利用者向けの配備では使いません。

モックを有効にしたときに、画面で確認できるAI機能は、次のとおりです。

- 既定の画面（「詳細」のトグルがOFF）: 島を選んで「AIで提案」（島のサマリ）、島どうしの関係線を選んで「AIで生成」（関係のサマリ）。
- 「詳細」のトグルがON: 上に加えて、レイアウトの提案、統合の候補、ナラティブの生成と整合性のチェック。

モックが返すのは、実質的な分析内容を持たない定型の出力です。実際の示唆を得るには、`/generate` の仕様に合わせて、JSONに十分に従えるLLMを接続してください（通常は、薄い変換層が必要です）。

## 疎通の確認

最初に、ローカルLLMの接続先へ直接要求を送り、応答を確認します。

```bash
curl -fsS http://localhost:8001/generate \
  -H 'content-type: application/json' \
  --data '{"task":"health","prompt":"Say ok","temperature":0.2,"max_tokens":16,"model":"local-model-name"}'
```

続いて、sui-sensemakingのサーバー側の状態とログを確認します。

```bash
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
```

`/healthz`が正常に応答しても、LLMの接続先と通信できることまで保証されるわけではありません。AIによる提案を実際に要求し、提供元のエラーやタイムアウトが発生しないことも確認してください。

## 運用上の注意

- 入力に、秘密情報、個人情報、未レビューの機密情報を含めないでください。共有してよい情報か迷うときは、[data_handling.md](data_handling.md) を確認します。
- SafeModeの目的を緩める設定の変更は、[security.md](security.md) と [security_operational_guidelines.md](security_operational_guidelines.md) を確認してから行ってください。
- プロバイダが不安定なときは、まず `SUI_LLM_PROVIDER=none` に戻し、保存や表示などの基本操作が正常かを確認します。
- ローカルプロバイダの接続先（エンドポイント）のログに、プロンプトの全文が残ることがあります。ログの保管先と、閲覧できる権限を確認してください。

## よくある失敗

| 症状 | 確認すること |
| --- | --- |
| `SUI_LOCAL_LLM_BASE_URL is not set` | ベースURLが設定されていません。 |
| プロバイダのタイムアウト | ローカルプロバイダの接続先（エンドポイント）が起動しているか、応答が遅すぎないか |
| `response missing text field` | 接続先（エンドポイント）の応答が、`{ "text": "..." }` の形になっているか |
| AIが無効と表示される | `SUI_LLM_PROVIDER=none` のままになっていないか |
| 401または403 | 接続先（エンドポイント）側の認証、プロキシ、ネットワークの制限 |

## 大規模LLMとの違い

大規模LLMの提供元を利用するには、明示的な利用同意（opt-in）、昇格の許可、接続先の許可リストの三つすべてが必要です。ローカルプロバイダとは別の安全上の境界として扱います。

```bash
export SUI_LLM_PROVIDER=large-scale
export SUI_LLM_ESCALATION_ENABLED=true
export SUI_LLM_LARGE_SCALE_OPT_IN=true
export SUI_LARGE_SCALE_LLM_ALLOWLIST='llm.example.com'
```

> 注意: 上の例は、直接起動したときの設定です。標準のDocker Composeは、これらのキーを渡しません（[runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings) を参照）。

大規模LLMのプロバイダを使うときは、[configuration.md](configuration.md) と [security.md](security.md) を確認してください。

## 関連文書

- [configuration.md](configuration.md)
- [data_handling.md](data_handling.md)
- [security.md](security.md)
- [ce2_low_risk_ai_assist.md](ce2_low_risk_ai_assist.md)
