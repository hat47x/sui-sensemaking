# sui-sensemaking LLM クイックスタート

AI支援機能（レイアウト提案、マージ候補、ナラティブ生成など）をローカルで動作させる手順です。

## 前提

sui-sensemakingのLLMプロバイダは独自の `/generate` 契約を使用します（OpenAI API非互換）。
実際のLLM推論サーバがなくても、付属のmockサーバで全AI機能の動作を確認できます。

## 方法 1: Mock LLM（GPU不要、全6タスク対応）

`mock_local_llm.py` は決定論的なスタブで、全AIタスクに有効な最小限の応答を返します。

```bash
# 1. Mock LLM を起動
cd 03_Implement/deploy
python3 tools/mock_local_llm.py --host 127.0.0.1 --port 8001

# 2. 別のターミナルでバックエンドを起動
cd 03_Implement/backend
SUI_LLM_PROVIDER=local \
SUI_LOCAL_LLM_BASE_URL=http://localhost:8001 \
SUI_LOCAL_LLM_MODEL=mock \
SUI_DATABASE_URL=sqlite:///./sui_sensemaking.db \
.venv/bin/uvicorn sui_sensemaking_api.main:app --reload

# 3. 動作確認
curl http://localhost:8000/ai/provider-status
# → {"providerKind":"local"}
```

## 方法 2: Docker Compose llm-stub（re_layout + suggest_merges のみ）

```bash
cd 03_Implement/deploy
docker compose -f docker-compose.yml -f docker-compose.llm-stub.yml up -d

# 確認
curl http://localhost:8000/ai/provider-status
# → {"providerKind":"local"}
```

## 方法 3: 実 LLM（OpenAI 互換 API 統一アダプタ）

`openai_compatible_adapter.py` は **すべての主要な生成AI** に対応する単一のアダプタです。
OpenAI / DeepSeek / Groq / Together / Ollama (v0.1.14+) / vLLMなど、
OpenAI互換のchat completions APIを持つすべてのプロバイダで動作します。

```bash
# Ollama（ローカル・無料）
python3 deploy/tools/openai_compatible_adapter.py --port 8001

# DeepSeek（クラウド・高品質）
export LLM_API_KEY="sk-..."
python3 deploy/tools/openai_compatible_adapter.py --port 8001 \
  --base-url https://api.deepseek.com/v1 --model deepseek-v4-flash

# OpenAI
export LLM_API_KEY="sk-..."
python3 deploy/tools/openai_compatible_adapter.py --port 8001 \
  --base-url https://api.openai.com/v1 --model gpt-4o-mini

# Groq（高速推論）
export LLM_API_KEY="gsk_..."
python3 deploy/tools/openai_compatible_adapter.py --port 8001 \
  --base-url https://api.groq.com/openai/v1 --model llama-3.3-70b

# バックエンドに接続
SUI_LLM_PROVIDER=local \
SUI_LOCAL_LLM_BASE_URL=http://localhost:8001 \
SUI_LOCAL_LLM_MODEL=<model-name> \
.venv/bin/uvicorn sui_sensemaking_api.main:app

# テスト
pytest tests/test_llm_integration.py -v -m external_llm
pytest tests/test_kj_session_e2e.py -v -m external_llm
```

| アダプタ | 対象 | 用途 |
|---|---|---|
| `mock_local_llm.py` | — | テスト用決定論的スタブ（GPU不要・常時利用可能） |
| **`openai_compatible_adapter.py`** | **全 OpenAI 互換 API** | **本番・開発用統一アダプタ** |

> **削除済み**: `ollama_adapter.py` と `deepseek_adapter.py` は `openai_compatible_adapter.py` に統合されました。

## タスク別モデル選択

`SUI_LLM_TASK_MODEL_MAP` でタスクごとに異なるモデルを指定できます（ADR-0065）。

```bash
# 例: 軽量タスクはflash、高度な推論はpro
export SUI_LLM_TASK_MODEL_MAP="re_layout=deepseek-v4-flash,suggest_merges=deepseek-v4-flash,generate_narrative=deepseek-v4-pro,detect_contradiction=deepseek-v4-pro"

# 1M トークンコンテキストウィンドウが必要な場合
export SUI_LLM_TASK_MODEL_MAP="generate_narrative=deepseek-v4-pro[1m]"
```

> **DeepSeek モデル名** (2026年8月現在):
> - `deepseek-v4-pro` — フラッグシップ推論モデル。複雑な判断・文章生成に。
> - `deepseek-v4-flash` — 高速・低コストモデル。簡易タスクに。
> - `deepseek-v4-pro[1m]` — 1M トークンコンテキストウィンドウ付き。大規模文書処理に。

## 全 AI エンドポイント一覧

| エンドポイント | メソッド | LLM タスク | 説明 |
|---|---|---|---|
| `/ai/provider-status` | GET | — | プロバイダ設定の表示 |
| `/ai/suggest-layout` | POST | `re_layout` | カード配置の提案 |
| `/ai/suggest-merges` | POST | `suggest_merges` | 統合候補の提案 |
| `/ai/suggest-island-summary` | POST | `suggest_island_summary` | アイランド要約 |
| `/ai/proposals/island-summary` | POST | `suggest_island_summary` | 同上（ProposalEnvelope形式） |
| `/ai/proposals/audit` | POST | — | 提案の受理/拒否/保留を記録 |
| `/ai/generate-narrative` | POST | `generate_narrative` | ナラティブ生成 |
| `/ai/check-narrative` | POST | `check_narrative` | ナラティブ検証 |
| `/ai/summarize-island-relation` | POST | `summarize_island_relation` | アイランド間関係の要約 |

## 設定リファレンス

| 環境変数 | 既定値 | 説明 |
|---|---|---|
| `SUI_LLM_PROVIDER` | `none` | `none` / `local` / `large-scale` / `deepseek` |
| `SUI_LOCAL_LLM_BASE_URL` | — | local プロバイダの `/generate` エンドポイント |
| `SUI_LOCAL_LLM_MODEL` | — | モデル識別子（任意の文字列） |
| `SUI_LLM_ESCALATION_ENABLED` | `false` | large-scale に必須 |
| `SUI_LLM_LARGE_SCALE_OPT_IN` | `false` | large-scale に必須 |

`SUI_LLM_PROVIDER=none`（既定）では、全AIエンドポイントが `503 provider_unavailable` を返します。
これは安全な既定値であり、AIを使わない運用を妨げません。

> **注意**: 登録済みモデル（モデル登録で作成したモデル）を使う環境では、`SUI_LLM_PROVIDER` を `none` のままにしないでください。`none` は登録済みモデルへの呼び出しも止める無条件の停止スイッチなので、`local` や `deepseek` などの値を明示する必要があります（`deepseek` を選ぶ場合は `SUI_DEEPSEEK_API_KEY` も必要です）。

## トラブルシューティング

| 現象 | 原因 | 解決 |
|---|---|---|
| `503 provider_unavailable` | LLM サーバが未起動または到達不能 | Mock LLM または実サーバを起動 |
| `422 provider_validation` | プロンプトが不正（空、過大、タスク名不正） | プロンプトを確認 |
| `504 provider_timeout` | LLM サーバが 60 秒以内に応答しない | モデルを小さくするかタイムアウトを調整 |
| `provider=none` でも 200 | `/ai/provider-status` は常に動作（設定表示のみ） | — |
