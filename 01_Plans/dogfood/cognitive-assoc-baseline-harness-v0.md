# COGNITIVE-ASSOC-01 baseline harness v0

- Status: Pre-run / gated
- Date: 2026-09-18
- Parent issue: `01_Plans/issues/issue-COGNITIVE-ASSOC-01-affinity-semantic-field-poc.md`
- Parent preregistration: `cognitive-assoc-benchmark-v0-preregistration.md`

## 1. 位置づけ

この文書はT3の実行契約だけを固定する下位仕様である。親和図作業の目的、認知要件、方式選定理由は上位Issue・research record・preregistrationを正本とする。

T3の目的は、A/C/Eを同じ候補集合・同じpair / 2+1評価面で実行できるoffline harnessを用意することである。**T3の実装完了はv0 benchmarkのsemantic result生成を意味しない。** 固定v0のrunは、human v1またはユーザー明示指示によるAI-proxy v2のreference adjudicationがfreezeされるまで拒否する。

## 2. 共通run gate

`run_cognitive_assoc_baselines.py run` は、次をすべて満たす場合だけ処理を進める。

1. selected review setのraw byte SHA-256がadjudicated artifactと一致する。
2. adjudicated artifactが許可済みstate（`human_adjudication_frozen` または `ai_proxy_adjudication_frozen`）である。
3. AI proxyの場合はuser authorization、`humanAdjudicationObserved=false`、semantic-baseline blindness、既知contaminationの明示をすべて満たす。
4. Evidenceの `semanticBaselineGate` が `eligible_for_explicit_open` である。
5. adjudicated artifactのraw SHA-256がEvidenceと一致する。
6. candidate集合・pair / 2+1件数がselected review setと一致する。
7. reference labelが事前登録済み4値だけである。
8. model inputが `documentId / cardId / text` だけを含むblind inputである。

このgateは「自動的にbaselineを走らせる」ものではない。明示的な `run` 呼出しがあって初めて実行する。

## 3. baseline A

AはUnicode NFKC正規化後の英数字・日本語文字列から2〜4文字n-gramを作り、corpus内document frequencyからTF-IDF vectorを構成する。

- pair: 2 card vector間のcosine
- 2+1: 既存pair 2枚のcentroidとoutsiderのcosine
- 外部依存: なし
- 役割: 表層類似の基準線

## 4. baseline C

CはAと同じTF-IDF featureを入力にし、固定seedの疎展開とk-WTAを適用する。

初期固定値:

- dimensions: 4096
- fanout: 8
- active: 64
- seed: 47

出力はbinary sparse vectorとし、pair / 2+1 metricはAと同じ形へ合わせる。

これはFlyHashそのものの再現を主張するものではなく、**sparse expansion + WTA単体の寄与を見る比較用実装**である。

## 5. baseline E

Eはローカルsentence encoderを実装固定せず、stdin/stdout vector providerとして接続する。

request:

```json
{
  "schema": "sui.cognitive-assoc-embedding-request/v1",
  "texts": ["..."]
}
```

response:

```json
{
  "schema": "sui.cognitive-assoc-embedding-response/v1",
  "model": "local-model-identifier",
  "vectors": [[0.1, 0.2]],
  "runtimeEvidence": {
    "wallMilliseconds": 12.5,
    "peakRssBytes": 123456,
    "memoryScope": "provider-process-peak-rss",
    "includesModelLoad": true,
    "includesEncode": true
  }
}
```

`runtimeEvidence` はoptionalであり、存在する場合はtransport層で型・有限値・memory scope・model load/encode包含を検証する。RSS取得不能時は `peakRssBytes=null` / `memoryScope=provider-process-peak-rss-unavailable` とする。provider memoryはharness側tracemallocへ混ぜない。

providerへ渡すのはcard本文だけであり、candidate ID、human label、U/L stratum、島、座標、relationは渡さない。

### E-v0 provider freeze (2026-09-29)

最初のE実測より前に、比較用providerを次で固定する。

- model: `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
- revision: `e8f8c211226b894fcb81acc59f3b34ba3efd5f42`
- embedding dimension: 384
- device class: CPU
- encode: SentenceTransformer.encode / normalize_embeddings=false
- similarity: downstream cosine
- query/passage prefix: なし
- provider input: card本文のみ
- config: `cognitive-assoc-baseline-E-provider-v0.json`
- executable provider: `run_cognitive_assoc_e_provider.py`

選定条件は日本語明示対応、sentence-similarity用途、local CPUで現実的な規模、許容的license、対称card-to-card比較でquery/passage prefixを要しないこと、immutable revisionを固定できることである。

A/C部分結果は選定時点で既に観測済みであるため、完全な結果前preregistrationとは主張しない。ただしE自身の出力は未観測であり、A/Cの数値優劣を選定条件には用いていない。この順序はT4解釈上の制約として保持する。

### E-v0 concrete provider

固定model/revisionを実行するproviderは `run_cognitive_assoc_e_provider.py` とする。

providerは次をfail-closedで検証する。

- stdin requestは `schema / texts` だけを許可する。
- model ID / revision / CPU deviceはコード側で固定する。
- `normalize_embeddings=false` とし、cosineは既存harness側で計算する。
- 応答vector数は入力text数と一致する。
- 各vectorは384次元かつfiniteな数値のみとする。
- 応答model fieldは `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2@e8f8c211226b894fcb81acc59f3b34ba3efd5f42` とする。

実行例:

```bash
python 01_Plans/dogfood/run_cognitive_assoc_baselines.py run \
  --baseline E \
  --selected-review-set <selected-review-set.json> \
  --model-input <model-input.jsonl> \
  --adjudicated <adjudicated.json> \
  --adjudication-evidence <evidence.json> \
  --encoder-command "python 01_Plans/dogfood/run_cognitive_assoc_e_provider.py" \
  --output <baseline-E.json>
```

必要依存は `sentence-transformers` と固定revisionのmodel bytesである。依存またはmodel bytesを取得できない環境ではproviderは失敗し、代替modelへ自動fallbackしない。

2026-09-30時点で、model downloadを伴わないprovider contract testは7件通過している。これはprotocol/constructor/fail-closed挙動の検証であり、E embedding実測ではない。

## 6. 出力境界

各runはcandidate ID昇順でscoreを記録するが、次を生成しない。

- ranking
- winner
- 単一accuracy
- product-facing confidence
- 自動的な島・表札・relation

pairと2+1はmetric IDを分ける。human labelはprovider入力ではなく、run出力へreferenceとして後結合する。

## 7. plan command

`plan` はbenchmark fileを読まず、A/C/Eのinterfaceとgateだけを表示できる。

```bash
python 01_Plans/dogfood/run_cognitive_assoc_baselines.py plan
```

このcommandはsemantic resultを生成しないため、T2d完了前でも実行できる。

## 8. 固定v0の次工程

T2d完了後、frozen sourceからblind model inputを再生成し、同一selected review set / adjudicated artifact / Evidenceを指定してA/C/Eを個別にrunする。

T4ではrun artifactを入力に、R1〜R5とCPU/memoryを別軸で比較する。U/L stratumは人間判定時には隠したまま、評価集計時にmachine-readable selected review setから復元して別々に報告する。


## AI proxy substitution

ユーザー明示指示により人手判定を生成AIへ代行する場合、human Evidenceとして保存しない。adjudication artifact/evidenceはAI proxy authority、humanAdjudicationObserved=false、user authorization、semantic-baseline blindness、既知のcontamination/limitationを保持する。baseline run artifactもreference authorityを引き継ぐ。
