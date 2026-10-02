# Local LLM Operations Guide

対象読者: local LLMまたは組織内LLM endpointをsui-sensemakingに接続する運用担当者、開発者。

目的: local providerの設定、HTTP contract、確認方法、失敗時の切り分けを示します。

読後にできること: 既定ではLLMが無効であることを理解し、local LLMを有効にするときの設定、疎通確認、戻し方を判断できます。

## 既定値

sui-sensemakingは既定でLLMを使いません。

```bash
export SUI_LLM_PROVIDER=none
```

この状態では、AI機能はdisabledとして扱われ、LLM連携による外部サービスとの共有は行われません。最初の評価、受け入れ確認、保存動作の確認では、この既定値を推奨します。

## local LLM とは

この文書でのlocal LLMは、sui-sensemakingから見て管理できる範囲にあるLLM endpointを指します。同じPC上のサービスとは限りません。組織内サーバーを使う場合もあります。

localという名前でも、URLが外部サービスを指していれば、そのサービスとデータを共有する扱いです。接続先、保持期間、入力データの扱いを確認してから有効にしてください。

## local provider を有効にする

```bash
export SUI_LLM_PROVIDER=local
export SUI_LOCAL_LLM_BASE_URL='http://localhost:8001'
export SUI_LOCAL_LLM_MODEL='local-model-name'
```

`local_http` は `local` のaliasとして扱われます。

> 注意: 上記は direct 起動時の例です。標準 Docker Compose はこれらのキーを配送しません。Compose 上で検証する場合は下記「GPU なしで動作イメージを確認する」の overlay 手順を使ってください。また `api` コンテナ内から見た `http://localhost:8001` はホストではなく `api` コンテナ自身を指すため、Compose 環境ではこの例をそのまま転記しないでください。

設定を戻す場合は、providerを `none` に戻します。

```bash
export SUI_LLM_PROVIDER=none
```

## HTTP contract

backendは `<base_url>/generate` にPOSTします。

Request:

```json
{
  "task": "string",
  "prompt": "string",
  "temperature": 0.2,
  "max_tokens": 2000,
  "model": "local-model-name"
}
```

Response:

```json
{
  "text": "generated text"
}
```

`text` が文字列でない場合、provider validation errorとして扱われます。

この `/generate` はsui-sensemaking独自の契約で、OpenAI互換APIやOllamaのAPIとは**互換性がありません**。`SUI_LOCAL_LLM_BASE_URL` をOllama等へ直接向けても動作しません。接続するには、この契約（`POST /generate`、応答 `{"text": "<JSON文字列>"}`）を満たす薄いアダプタ層が必要です。

## GPU なしで動作イメージを確認する（モックアダプタ）

各AIタスクは `text` の中に**タスクごとの厳密なJSON**（例: レイアウト提案は元の全カードを過不足なく含む、島サマリの根拠IDはその島のメンバーである、ナラティブは読み順と完全一致する等）を要求します。GPU非搭載PCで動く小規模・低精度モデルでは、このJSONを安定して生成できず検証エラー（422）が頻発しがちです。

「動作イメージ」だけをGPUなしで確認したい場合は、リポジトリ同梱の決定論的モックアダプタを使えます。これはLLMではなく、各タスクに**最小限の妥当なJSON** を返すだけのスタブです（レイアウトは単純なグリッド配置、要約・ナラティブは定型の下書き、統合候補・整合性チェックは空）。UI上でAI連携の往復と表示の流れを確認する用途に限定してください。

```bash
# 別端末でモックアダプタを起動（Python 標準ライブラリのみ・依存なし）
python3 03_Implement/deploy/tools/mock_local_llm.py --host 127.0.0.1 --port 8001

# backend 側で local provider を有効化し、モックに向ける
export SUI_LLM_PROVIDER=local
export SUI_LOCAL_LLM_BASE_URL=http://localhost:8001
export SUI_LOCAL_LLM_MODEL=mock
```

> 注意: `mock_local_llm.py` は direct 起動（backend をローカルで直接起動する構成）向けの確認手段です。標準 Docker Compose 環境では、代わりに検証専用の `docker-compose.llm-stub.yml` overlay（`docker compose -f docker-compose.yml -f docker-compose.llm-stub.yml up -d`）を使ってください。この overlay は Compose ネットワーク内で完結する別の決定論的スタブ（`llm-stub` サービス）であり、`mock_local_llm.py` とは別の仕組みです。どちらも本番相当の利用者向けデプロイでは使いません。

モック有効時に画面で確認できる AI 機能:

- 既定の画面（「詳細」トグルOFF）: 島を選択して「AIで提案」（島サマリ）、島どうしの関係線を選択して「AIで生成」（関係サマリ）。
- 「詳細」トグルON: 上記に加えて、レイアウト提案・統合候補・ナラティブ生成／整合性チェック。

モックの出力は内容を持たない定型です。実際の示唆を得るには、`/generate` 契約に合わせて十分なJSON追従性を持つLLMを接続してください（通常は薄いアダプタ層が必要です）。

## 疎通確認

まずlocal endpoint側を直接確認します。

```bash
curl -fsS http://localhost:8001/generate \
  -H 'content-type: application/json' \
  --data '{"task":"health","prompt":"Say ok","temperature":0.2,"max_tokens":16,"model":"local-model-name"}'
```

次にsui-sensemaking backendとログを確認します。

```bash
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
```

`/healthz` が通っても、LLM endpointの疎通まで保証するわけではありません。AI提案を実行し、provider errorやtimeoutが出ないことも確認してください。

## 運用上の注意

- 入力に秘密情報、個人情報、未レビューの機密情報を含めないでください。共有してよい情報か迷う場合は [data_handling.md](data_handling.md) を確認します。
- SafeModeの目的を緩める設定変更は、[security.md](security.md) と [security_operational_guidelines.md](security_operational_guidelines.md) を確認してから行ってください。
- providerが不安定な場合は、まず `SUI_LLM_PROVIDER=none` に戻し、保存や表示などの基本操作が正常か確認します。
- local providerの接続先（endpoint）のログにprompt全文が残る場合があります。ログの保管先と閲覧権限を確認してください。

## よくある失敗

| 症状 | 確認すること |
| --- | --- |
| `SUI_LOCAL_LLM_BASE_URL is not set` | base URL が未設定です |
| provider timeout | local provider の接続先（endpoint）が起動しているか、応答が遅すぎないか |
| response missing text field | 接続先（endpoint）の応答が `{ "text": "..." }` になっているか |
| AI disabled | `SUI_LLM_PROVIDER=none` のままではないか |
| 401 または 403 | 接続先（endpoint）側の認証、proxy、ネットワーク制限 |

## large-scale との違い

large-scale providerは、明示opt-in、昇格許可、allowlistがすべて必要です。local providerとは別の安全境界として扱います。

```bash
export SUI_LLM_PROVIDER=large-scale
export SUI_LLM_ESCALATION_ENABLED=true
export SUI_LLM_LARGE_SCALE_OPT_IN=true
export SUI_LARGE_SCALE_LLM_ALLOWLIST='llm.example.com'
```

> 注意: 上記は direct 起動時の例です。標準 Docker Compose はこれらのキーを配送しません（[runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings) 参照）。

large-scale providerを使う場合は、[configuration.md](configuration.md) と [security.md](security.md) を確認してください。

## 関連文書

- [configuration.md](configuration.md)
- [data_handling.md](data_handling.md)
- [security.md](security.md)
- [ce2_low_risk_ai_assist.md](ce2_low_risk_ai_assist.md)
