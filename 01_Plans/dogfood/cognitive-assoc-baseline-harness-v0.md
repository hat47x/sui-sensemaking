# COGNITIVE-ASSOC-01 baseline harness v0

- Status: Pre-run / gated
- Date: 2026-09-18
- Parent issue: `01_Plans/issues/issue-COGNITIVE-ASSOC-01-affinity-semantic-field-poc.md`
- Parent preregistration: `cognitive-assoc-benchmark-v0-preregistration.md`

## 1. 位置づけ

この文書はT3の実行契約だけを固定する下位仕様である。親和図作業の目的、認知要件、方式選定理由は上位Issue・research record・preregistrationを正本とする。

T3の目的は、A/C/Eを同じ候補集合・同じpair / 2+1評価面で実行できるoffline harnessを用意することである。**T3の実装完了はv0 benchmarkのsemantic result生成を意味しない。** T2dのmodel-blind human adjudicationがfreezeされるまで固定v0のrunは拒否する。

## 2. 共通run gate

`run_cognitive_assoc_baselines.py run` は、次をすべて満たす場合だけ処理を進める。

1. selected review setのraw byte SHA-256がadjudicated artifactと一致する。
2. adjudicated artifactが `human_adjudication_frozen` である。
3. adjudication Evidenceが `human_adjudication_frozen` である。
4. Evidenceの `semanticBaselineGate` が `eligible_for_explicit_open` である。
5. adjudicated artifactのraw SHA-256がEvidenceと一致する。
6. candidate集合・pair / 2+1件数がselected review setと一致する。
7. human labelが事前登録済み4値だけである。
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
  "vectors": [[0.1, 0.2]]
}
```

providerへ渡すのはcard本文だけであり、candidate ID、human label、U/L stratum、島、座標、relationは渡さない。

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
