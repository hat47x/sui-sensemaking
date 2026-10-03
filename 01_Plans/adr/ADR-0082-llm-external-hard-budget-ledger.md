# ADR-0082: 外部LLMの共有hard budget ledger

- Status: Proposed
- Date: 2026-09-07
- Deciders: Maintainer
- Scope: `03_Implement/backend/src/sui_sensemaking_api/llm/`, `03_Implement/backend/src/sui_sensemaking_api/routes/ai.py`, `03_Implement/backend/src/sui_sensemaking_api/settings.py`, database schema, `02_Architecture/runtime_parameter_registry.md`, `04_Documentation/operations.md`

## Context

`OPS-LLM-COST-01` の段階2で、プロバイダ別の呼び出し回数と、プロバイダが報告するinput/outputのトークン使用量を、観測できるようになった。しかし現状は、現在のプロセス内の観測値にすぎない。複数のworkerが同時に外部プロバイダへ到達したときに、共有の上限を守る仕組みはない。

未決のまま実装へ進めない論点は、次の4点である。

1. 月次のbudgetの境界を、どの時刻とscopeで切るか。
2. プロバイダを呼ぶ前は、実際のトークン使用量が分からない。その状態で、何をreserveするか。
3. プロバイダの使用量が一部だけ、または全く報告されない場合に、何をsettleするか。
4. budgetを超過した場合や、共有ストアに障害があった場合に、外部送信を許可してしまわずに、どう降格するか。

現行のトランスポートには、重要な差がある。

- `large-scale` の `/generate` トランスポートは、応答の本文しか返さず、トークン使用量を報告しない。
- DeepSeek系のOpenAI互換トランスポートは、`usage.prompt_tokens` と `usage.completion_tokens` を返す場合がある。
- backendには、プロバイダ固有のトークナイザへの依存がない。登録済みのプロバイダにも、コンテキストウィンドウや入力トークン上限のmetadataはない。

したがって、入力payloadのバイト数を、プロバイダの課金トークン数そのものと見なすことはできない。使用量の欠損を0とみなすこともできない。一方、呼び出しの後で実測の使用量だけを加算する方式では、並行するworkerが上限を読み抜けた後に、外部の呼び出しを開始できる。そのため、これはhard gateにならない。

これは、並行するworker間の競合、外部送信の可否、費用の上限という、新しい非機能の境界を固定するものである。そのため、`ADR-0047` のR-3に該当する。

比較した主な案は、以下のとおりである。

- プロセスローカルのカウンタだけを使う: worker数に比例して上限を超過し得るため、不採用。
- プロバイダの応答の後だけ使用量を加算する: 並行する呼び出しを、すでに開始させてしまうため、不採用。
- プロバイダ固有のトークナイザを、実行時の必須の依存にする: 現行の2つのトランスポートと、将来レジストリに加わるプロバイダごとに、トークナイザの整合を保証できない。依存が増える割に境界が不安定なため、現段階では不採用。
- 外部のレート制限サービスを必須にする: 個人開発でリリース前の段階に、新規のインフラを増やしすぎるため、不採用。
- 共有DBで、呼び出しの前にreserveし、応答の後にsettleする: 現行DBの行ロックとCASを再利用できる。追加のサービスなしに、複数のworkerに対するhard gateを作れるため、採用の候補とする。

## Decision

**外部LLMの費用の上限は、共有DB上の月次ledgerに対する `reserve -> external call -> settle` で強制する。hard guaranteeは、「外部の呼び出し回数」と「保守的なトークン予約の単位」に対して与える。プロバイダが報告するトークンの実測値とは、明示的に分離する。budgetの判定ができないとき、またはledgerを利用できないときは、外部プロバイダへ到達させない。**

### D1. 対象のプロバイダとscope

- budgetの対象は、外部送信を伴うプロバイダのkindとする。現行では、`large-scale` と `deepseek`、およびレジストリ経由でこれらへ正規化されるプロバイダを対象とする。
- `none`、`local`、`fixture` は、外部budgetを消費しない。
- budgetはtenant別ではなく、**1つのデプロイ環境全体**で共有する。tenantごとに分けると、tenantの数が増えるにつれて、環境全体の上限を迂回できてしまうためである。
- 環境の識別子は公開設定 `SUI_LLM_BUDGET_SCOPE` とし、空白を含まない、長さに上限のある正規の識別子に正規化する。
- 月次のperiodは、UTCの暦月とする。各月1日の `00:00:00Z` から、次の月の1日の直前までである。workerのローカルのタイムゾーンには依存しない。

### D2. hard limitの設定

公開設定として、以下を追加する。

- `SUI_LLM_EXTERNAL_MONTHLY_CALL_LIMIT`: 月次の外部呼び出しのhard上限。正の整数。
- `SUI_LLM_EXTERNAL_MONTHLY_TOKEN_RESERVATION_LIMIT`: 月次の、保守的なトークン予約の単位の上限。正の整数。
- `SUI_LLM_BUDGET_SCOPE`: デプロイ環境の識別子。

`large-scale` と `deepseek` に、primary、または登録済みのモデル経由で到達できる構成では、3つの設定を完全なセットとして要求する。一部だけの設定は、起動時の検証で拒否する。

`SUI_LLM_PROVIDER=none` という既定は変更しない。budgetの設定によって、外部プロバイダが自動的に有効になることもない。

SafeMode、proposal-only、human review、不正なモデルやプロバイダを拒否する既存のゲートは、budgetより前に維持する。budgetの仕組みを、外部送信の新しい許可の根拠にはしない。

### D3. 共有ledgerとatomicなreserve

共有DBに、少なくとも次の意味を持つledgerを置く。

- key: `(budget_scope, period_start_utc)`
- 集計: `reserved_calls`, `reserved_token_units`
- reservation: 一意な `reservation_id`、呼び出しの数、入力の予約単位、出力の予約単位、settleの状態

外部の呼び出しの直前に、1つのトランザクションで、対象のperiodの行をロックし、以下を同時に検査して更新する。

1. `reserved_calls + 1 <= call_limit`
2. `reserved_token_units + requested_token_reservation <= token_reservation_limit`
3. 両方を満たす場合だけ、集計の増分とreservationの行をコミットする。

複数のworkerは、同じperiodの行ロックを通る。そのため、同時に上限を読み抜けて、外部の呼び出しを開始することはできない。

reservationのコミットは、ネットワークの呼び出しより前に完了させる。外部プロバイダの障害やworkerのクラッシュでsettleできなくても、未確定の費用をbudgetから消して、外部送信を許可してしまわないためである。

### D4. 呼び出し前のreservationは「トークンの実測値」ではない

プロバイダが報告する使用量は、応答の後にしか得られない。現行のbackendは、プロバイダ固有のトークナイザを持たない。このため、呼び出しの前には、プロバイダのトークン数を偽って推定せず、**送信できる量から作る、保守的な予約の単位**を使う。

- 入力の予約単位: 実際に送信する、シリアライズ済みのUTF-8のrequest payloadのバイト数。
- 出力の予約単位: `LLMRequest.max_tokens`。
- 要求するトークンの予約: 上の2つの値の合計。
- payloadが既存の `MAX_LLM_PROVIDER_REQUEST_BYTES` を超える場合は、プロバイダの検証で先に拒否し、budgetを消費しない。
- `LLMRequest.max_tokens` は、既存の `MAX_LLM_OUTPUT_TOKENS` の範囲内でなければならない。

重要な意味の境界は、次のとおりである。

- 入力の予約単位を、「プロバイダが報告する入力トークン」や、「ローカルのトークナイザによる推定トークン」とは呼ばない。
- hard guaranteeは、DB上の**予約単位の上限を超えて、外部の呼び出しを開始しないこと**である。異種のプロバイダ間の課金トークンを、1つのトークナイザで正確に再現するという保証ではない。
- 運用APIと文書では、`tokenReservationUnits` と、既存の `tokenUsage` と `tokenUsageCoverage` を、別のフィールドにする。
- 将来、プロバイダのadapterが、信頼できる呼び出し前のトークン上限を提供できる場合は、そのadapterだけ、入力の予約方式を精密にできる。ただし、プロバイダが報告する実測値との、由来の分離は維持する。

これにより、トークナイザのない `large-scale /generate` でも、「使用量が不明なので0消費」として外部送信を許可してしまうことを避けられる。送信するpayloadに比例した、保守的な予約を保持できる。

### D5. settleと、使用量の欠損

外部の呼び出しが成功し、使用量が返った場合、reservationは、新しいトランザクションで冪等にsettleする。

- 入力と出力の両方をプロバイダが報告した: それぞれの実測値が、対応する予約値以下なら、実測値まで、使われなかった予約を返却する。
- 片側だけ報告した: 報告された側だけ、実測値が予約値以下の場合に限り、返却する。報告のない側は、予約を維持する。
- 両側とも報告がない: 予約を全量維持する。
- プロバイダのエラー、タイムアウト、workerのクラッシュ: プロバイダ側で、費用が発生したかどうかを証明できない。そのため、予約を全量維持する。
- プロバイダが報告した使用量が、対応する予約値を超えた: 会計上の不変条件の違反として、そのreservationを縮小しない。budgetの状態をunsafeとして、後続の外部呼び出しを止める。運用者が確認するまで、上限を再び開放しない。

したがって、「使用量の欠損を0とする」扱いはしない。これは、`OPS-LLM-COST-01` のAC-4の、由来の契約を維持するものである。

### D6. budgetの拒否と、ストアの障害時の降格

次の場合は、外部プロバイダを呼ばない。

- 呼び出しの上限を超過した
- トークン予約の上限を超過した
- ledgerのロック、読み取り、書き込み、コミットのいずれかが失敗した
- ledgerのスキーマまたはpreflightが成立しない
- 会計上の不変条件の違反により、budgetの状態を安全に判定できない

降格の順は、次のとおりとする。

1. 同じタスクをローカルのプロバイダで実行できるなら、ローカルのみで再試行する。
2. ローカルのプロバイダも利用できないなら、`none` に相当する、安全側で拒否する結果へ閉じる。
3. final-judgementのrouteで、外部の提案との明示的なリンクがある場合は、既存のsystem-holdの規則へ接続する。提案を自動でacceptやrejectしない。

budgetの拒否やストアの障害から、別の外部プロバイダへフォールバックしてはならない。`SUI_LLM_FALLBACK_TO_NONE=false` であっても、budgetの仕組みを破って外部送信することは許さない。

### D7. 観測と非目標

最低限、本文を含まない以下の項目を、運用で観測できるようにする。

- periodとbudget scope
- 呼び出しの上限と、予約済みの呼び出し数
- トークン予約の上限と、予約済みのトークン単位
- 拒否の理由（calls / token units / store unavailable / invariant violation）
- settleのカバレッジ（complete / partial / missing）

保存も表示もしないものは、次のとおり。

- プロンプトの本文、応答の本文、生のトークン列
- カードや文書の本文
- 利用者のメールアドレスなどのPII

本ADRでは、次を扱わない。

- tenant別の課金と請求書の生成
- プロバイダの価格表からの、円やドルへの換算
- SEC-RATE-LIMIT-01のHTTPレート制限
- 外部プロバイダを自動で選択する、新しいルーティングのポリシー
- 異種のプロバイダを、単一のローカルのトークナイザで、課金トークンへ換算すること

## Three-Element Verification（ADR-0067。全ADRで必須）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 運用者が、デプロイ環境全体の外部LLMの費用ゲートを月次で固定する。複数のworkerでも、呼び出しと予約の上限を越えて、外部の呼び出しを開始させない | 機能: 呼び出し前のatomicなreserveを必須にする。データ: tenant別ではなく、環境で共有するledgerとする |
| **データ設計** | UTCの暦月とbudget scopeごとの共有ledgerと、冪等なreservationを保存する。一部または全く報告されない使用量では、未知の側の予約を返却しない。プロンプト、応答、PIIは保存しない | 業務: 使用量の欠損を0として扱わない。機能: DBが使えないときは、外部送信を安全側で拒否する |
| **機能設計** | 外部プロバイダを呼ぶ直前にreserveし、成功の後でsettleする。budgetの拒否とストアの障害は、ローカルのみへ降格し、ローカルが使えなければnoneまたはheldへ閉じる | 業務: SafeMode、proposal-only、human reviewを迂回しない。データ: プロバイダが報告するトークンの実測値と、保守的な予約の単位を、別の指標として扱う |

## Consequences

- 複数のworkerでも、外部の呼び出しを開始する前に、共有の呼び出しと予約のhard gateを強制できる。
- プロバイダの使用量の欠損、タイムアウト、workerのクラッシュを、「使用量0」とみなさない。そのため、費用の面では保守的に閉じる。
- `large-scale /generate` のように、使用量を報告しないプロバイダは、reservationを返却できない。同じ設定値では、報告するプロバイダより早くbudgetに到達する。これは、未知の費用を安全側へ寄せる、意図した挙動である。
- プロバイダが報告するトークンと、保守的な予約の単位は、意味が異なる。運用の表示と文書で、明確に分離する必要がある。
- 外部プロバイダを使うデプロイは、budgetの3つの設定を追加しない限り、起動時とreadinessで安全側に拒否される。そのための移行が必要になる。
- DBへのreserveとsettleのトランザクションが、外部の呼び出しごとに加わる。実装の後で、レイテンシを計測する。
- 「プロバイダの課金トークン数そのものに対する、呼び出し前の完全なhard cap」は、本ADRでは主張しない。将来それが必要になった場合は、プロバイダ固有のトークナイザや上限APIを、別の決定として追加する。

## Traceability

- Related: `01_Plans/issues/issue-OPS-LLM-COST-01-cost-control-contract-unimplemented.md`
- Related: `02_Architecture/llm_escalation_policy.html`
- Related: `01_Plans/adr/ADR-0009-local-llm-integration.md`
- Related: `01_Plans/adr/ADR-0047-design-decision-adr-saturation-and-execution-first.md`（R-3）
- Related: `01_Plans/adr/ADR-0050-llm-provider-observability-and-contract-fidelity.md`
- Related: `03_Implement/backend/src/sui_sensemaking_api/generation_repository.py`（共有DBの行ロックとCASの既存の実装例）

---
