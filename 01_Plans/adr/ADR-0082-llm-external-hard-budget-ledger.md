# ADR-0082: 外部LLMの共有hard budget ledger

- Status: Proposed
- Date: 2026-09-07
- Deciders: Maintainer
- Scope: `03_Implement/backend/src/sui_sensemaking_api/llm/`, `03_Implement/backend/src/sui_sensemaking_api/routes/ai.py`, `03_Implement/backend/src/sui_sensemaking_api/settings.py`, database schema, `02_Architecture/runtime_parameter_registry.md`, `04_Documentation/operations.md`

## Context

`OPS-LLM-COST-01` 段階2で、provider別の呼出回数とprovider-reported input/output token usageは観測できるようになった。しかし現状はcurrent process内の観測値であり、複数workerが同時に外部providerへ到達したときに共有上限を守る機構はない。

未決のまま実装へ進めない論点は次の4点である。

1. 月次budgetの境界をどの時刻・scopeで切るか。
2. provider call前には実token usageが分からない状態で、何をreserveするか。
3. provider usageがpartial/missingの場合に何をsettleするか。
4. budget超過または共有store障害時に、外部送信をfail-openせずどう降格するか。

現行transportには重要な差がある。

- `large-scale` の `/generate` transportはresponse本文しか返さず、token usageを報告しない。
- DeepSeek系OpenAI-compatible transportは `usage.prompt_tokens` / `usage.completion_tokens` を返す場合がある。
- backendにはprovider固有tokenizer依存がなく、登録providerにもcontext window / input-token上限のmetadataはない。

したがって、入力payloadのbyte数をproviderの課金token数そのものと見なすことも、usage欠損を0とみなすこともできない。一方、call後だけ実測usageを加算する方式では、並行workerが上限を読み抜けした後に外部callを開始できるためhard gateにならない。

これは並行worker間の競合、外部送信の可否、費用上限という新しい非機能境界を固定するため、`ADR-0047` R-3に該当する。

比較した主要案は以下である。

- process-local counterのみ: worker数に比例して上限を超過し得るため不採用。
- provider応答後だけusageを加算: 並行callを開始済みにするため不採用。
- provider固有tokenizerをruntime必須依存にする: 現行2 transportと将来registry providerごとのtokenizer整合を保証できず、依存増加に対して境界が不安定なため現段階では不採用。
- 外部rate-limit serviceを必須化: solo/pre-releaseに新規インフラを増やし過ぎるため不採用。
- 共有DBでcall前reserve、応答後settle: 現行DBのrow lock/CASを再利用でき、追加サービスなしで複数workerのhard gateを作れるため採用候補とする。

## Decision

**外部LLM費用上限は、共有DB上の月次ledgerに対する `reserve -> external call -> settle` で強制する。hard guaranteeは「外部call回数」と「conservative token-reservation units」に対して与え、provider-reported token実測値とは明示的に分離する。budget判定またはledger利用不能時は外部providerへ到達させない。**

### D1. 対象providerとscope

- budget対象は外部送信を伴うprovider kindとする。現行では `large-scale` と `deepseek`、およびregistry経由でこれらへcanonicalizeされるproviderを対象とする。
- `none`、`local`、`fixture` は外部budgetを消費しない。
- budgetはtenant別ではなく、**1 deployment environment全体**で共有する。tenantごとに分けるとtenant数の増加で環境全体上限を迂回できるためである。
- environment識別子は公開設定 `SUI_LLM_BUDGET_SCOPE` とし、空白を含まないbounded canonical identifierに正規化する。
- 月次periodはUTC暦月、各月1日 `00:00:00Z` から次月1日直前までとする。workerのローカルtimezoneには依存しない。

### D2. hard limit設定

公開設定として以下を追加する。

- `SUI_LLM_EXTERNAL_MONTHLY_CALL_LIMIT`: 月次外部callのhard上限。正整数。
- `SUI_LLM_EXTERNAL_MONTHLY_TOKEN_RESERVATION_LIMIT`: 月次のconservative token-reservation units上限。正整数。
- `SUI_LLM_BUDGET_SCOPE`: deployment environment識別子。

`large-scale` / `deepseek` がprimaryまたは登録model経由で到達可能な構成では3設定を完全セットとして要求する。部分設定はstartup validationで拒否する。

`SUI_LLM_PROVIDER=none` 既定は変更しない。budget設定によって外部providerが自動的に有効化されることもない。

SafeMode、proposal-only、human review、不正なmodel/providerを拒否する既存gateはbudgetより前に維持し、budget機構を外部送信の新しい許可根拠にはしない。

### D3. 共有ledgerとatomic reserve

共有DBに、少なくとも次の意味を持つledgerを置く。

- key: `(budget_scope, period_start_utc)`
- aggregate: `reserved_calls`, `reserved_token_units`
- reservation: 一意な `reservation_id`、call数、input reservation units、output reservation units、settle状態

外部call直前に1 transactionで対象period rowをlockし、以下を同時に検査・更新する。

1. `reserved_calls + 1 <= call_limit`
2. `reserved_token_units + requested_token_reservation <= token_reservation_limit`
3. 両方を満たす場合だけaggregate増分とreservation rowをcommitする。

複数workerは同じperiod row lockを通るため、同時に上限を読み抜けして外部callを開始できない。

reservationのcommitはnetwork callより前に完了させる。外部provider障害やworker crashでsettleできなくても、未確定費用をbudgetから消してfail-openしないためである。

### D4. pre-call reservationは「token実測値」ではない

provider-reported usageは応答後にしか得られず、現行backendはprovider固有tokenizerを持たない。このためcall前はprovider token数を偽って推定せず、**送信可能量から作るconservative reservation units**を使う。

- input reservation units: 実際に送信するserialized UTF-8 request payloadのbyte数。
- output reservation units: `LLMRequest.max_tokens`。
- requested token reservation: 上記2値の合計。
- payloadが既存 `MAX_LLM_PROVIDER_REQUEST_BYTES` を超える場合はprovider validationで先に拒否し、budgetを消費しない。
- `LLMRequest.max_tokens` は既存 `MAX_LLM_OUTPUT_TOKENS` の範囲内でなければならない。

重要な意味境界は次のとおりです。

- input reservation unitsを「provider-reported input tokens」「local tokenizer推定token」と呼ばない。
- hard guaranteeはDB上の**reservation units上限を超えて外部callを開始しないこと**であり、異種provider間の課金tokenを1 tokenizerで正確に再現するという保証ではない。
- 運用API/文書では `tokenReservationUnits` と既存 `tokenUsage` / `tokenUsageCoverage` を別フィールドにする。
- 将来、provider adapterが信頼できるpre-call token upper boundを提供できる場合は、そのadapterだけinput reservation strategyを精密化できる。ただしprovider-reported実測値とのprovenance分離は維持する。

これにより、tokenizerのない `large-scale /generate` でも「usage不明なので0消費」というfail-openを避け、送信payloadに比例した保守的予約を保持できる。

### D5. settleとmissing usage

外部callが成功しusageが返った場合、reservationは新しいtransactionでidempotentにsettleする。

- input/outputの両方がprovider-reported: 各実測値が対応する予約値以下なら実測値までunused reservationを返却する。
- 片側だけreported: reported側だけ、実測値が予約値以下の場合に限り返却する。missing側は予約を維持する。
- 両側missing: 予約を全量維持する。
- provider error、timeout、worker crash: provider側で費用発生の有無を証明できないため予約を全量維持する。
- provider-reported usageが対応する予約値を超える場合: accounting invariant違反として、そのreservationを縮小しない。budget状態をunsafeとして後続外部callを止め、運用者の確認なしに上限を再解放しない。

従って「missing usage = 0」とは扱わない。これは `OPS-LLM-COST-01` AC-4のprovenance契約を維持する。

### D6. budget deny / store outageの降格

次の場合、外部providerを呼ばない。

- call limit超過
- token reservation limit超過
- ledger lock/read/write/commit失敗
- ledger schema/preflight不成立
- accounting invariant違反によりbudget状態を安全に判定できない

降格順は次のとおりとする。

1. 同じtaskをlocal providerで実行可能ならlocal-onlyで再試行する。
2. local providerが利用不能なら`none`相当のfail-closed結果へ閉じる。
3. final-judgement routeで外部proposalとの明示linkがある場合、既存system-hold規則へ接続し、proposalを自動accept/rejectしない。

budget deny/store outageから別の外部providerへfallbackしてはならない。`SUI_LLM_FALLBACK_TO_NONE=false` でも、budget機構をfail-openして外部送信することは許さない。

### D7. 観測と非目標

最低限、content-freeな以下を運用観測できるようにする。

- period / budget scope
- call limit / reserved calls
- token reservation limit / reserved token units
- deny reason（calls / token units / store unavailable / invariant violation）
- settle coverage（complete / partial / missing）

保存・表示しないもの。

- prompt本文、response本文、raw token列
- card/document本文
- user email等のPII

本ADRでは次を扱わない。

- tenant別課金・請求書生成
- provider価格表からの円/ドル換算
- SEC-RATE-LIMIT-01のHTTP rate limit
- 外部providerを自動選択する新しいrouting policy
- 異種providerを単一local tokenizerで課金tokenへ換算すること

## Three-Element Verification（ADR-0067。全ADRで必須）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 運用者がdeployment environment全体の外部LLM費用gateを月次で固定し、複数workerでもcall/reservation上限を越えて外部callを開始させない | 機能: call前atomic reserveを必須化。データ: tenant別でなくenvironment共有ledgerとする |
| **データ設計** | UTC暦月×budget scopeの共有ledgerとidempotent reservationを保存し、partial/missing usageでは未知側の予約を返却しない。prompt/response/PIIは保存しない | 業務: usage欠損を0扱いしない。機能: DB不能時は外部送信をfail-closedする |
| **機能設計** | 外部provider直前でreserveし、成功後settleする。budget deny/store outageはlocal-onlyへ降格し、local不能ならnone/heldへ閉じる | 業務: SafeMode/proposal-only/human reviewを迂回しない。データ: provider-reported token実測値とconservative reservation unitsを別指標として扱う |

## Consequences

- 複数workerでも外部call開始前に共有call/reservation hard gateを強制できる。
- provider usage欠損・timeout・worker crashを「使用量0」とみなさないため、費用面では保守的に閉じる。
- `large-scale /generate` のようにusageを報告しないproviderはreservationを返却できず、同じ設定値では報告するproviderより早くbudgetに到達する。これは未知費用を安全側へ倒す意図的な挙動である。
- provider-reported tokenとconservative reservation unitsは意味が異なるため、運用表示と文書で明確に分離する必要がある。
- 外部providerを使うdeploymentはbudget設定3点を追加しない限りstartup/readinessでfail-closedする移行が必要になる。
- DBへのreserve/settle transactionが外部callごとに追加される。実装後にlatencyを計測する。
- 「providerの課金token数そのものに対する完全なpre-call hard cap」は本ADRでは主張しない。将来それを必要とする場合はprovider固有tokenizer/上限APIを別決定として追加する。

## Traceability

- Related: `01_Plans/issues/issue-OPS-LLM-COST-01-cost-control-contract-unimplemented.md`
- Related: `02_Architecture/llm_escalation_policy.html`
- Related: `01_Plans/adr/ADR-0009-local-llm-integration.md`
- Related: `01_Plans/adr/ADR-0047-design-decision-adr-saturation-and-execution-first.md`（R-3）
- Related: `01_Plans/adr/ADR-0050-llm-provider-observability-and-contract-fidelity.md`
- Related: `03_Implement/backend/src/sui_sensemaking_api/generation_repository.py`（共有DB row lock/CASの既存実装例）

---
