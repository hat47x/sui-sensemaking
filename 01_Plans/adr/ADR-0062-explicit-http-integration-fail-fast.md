# ADR-0062: 明示的に選択した外部HTTP連携は完全設定を起動条件にする

- Status: Accepted
- Date: 2026-08-01
- Deciders: Project Maintainer
- Scope: backend runtime settings、access-control adapter、audit transport、運用文書

## Context

sui-sensemakingは、外部PDPを使わない `SUI_ACCESS_CONTROL_ADAPTER=noop` と、監査HTTPを使わない `SUI_AUDIT_TRANSPORT=noop` を安全な既定値として持つ。一方、運用者が `external_http` または `http` を明示的に選んでもendpointを設定しなかった場合、従来実装は設定を受理し、実行時に `NoopAccessControlAdapter` / `NoopAuditTransport` へ縮退していた。

特にaccess-controlのnoop adapterは全要求を許可する。運用者が外部PDPを有効化したつもりでも、設定漏れだけで認可が無警告の全許可へ変わるため、実行時障害に対する `read_only` / `deny` fail-safeより前に安全境界が失われる。監査側には警告があったが、明示した連携が成立していない状態でアプリを継続する点は同じである。

`ADR-0029` と `runtime_parameter_registry.md` はこの挙動を別判断として保留していた。今回、`SEC-CONFIG-01` で実装・テストがfail-openを固定していることを確認したため、可用性と設定完全性のトレードオフを決定する必要がある。

本ADRは `ADR-0047` の再起票基準R-3（非機能境界の超過）に該当する。明示した認可連携が設定欠損で全許可へ変わる経路は、既存のfail-closed安全不変条件では覆えていない実際の境界超過であり、単なる再掲ではない。

## Decision

### D1: 連携方式の選択とendpointを原子的な設定として検証する

- `SUI_ACCESS_CONTROL_ADAPTER=external_http` では `SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT` を必須とする。
- `SUI_AUDIT_TRANSPORT=http` では `SUI_AUDIT_HTTP_ENDPOINT` を必須とする。
- 欠損時はSettings構築を `ValueError` で停止し、DB初期化、外部通信、request受付より前に起動を拒否する。
- エラーは欠損した設定キーだけを示し、endpoint、bearer、issuerその他の入力値を反射しない。

### D2: runtime builderもnoopへ縮退しない

- access-control builderが外部HTTP方式を受け取ったのにendpointを解決できない場合は、設定不変条件違反として例外を送出する。
- audit builderも `http` 選択時にendpointを解決できなければ例外を送出する。
- これにより、validation後の設定差し替えや直接builder呼び出しでも、明示した外部連携がnoopへ変わらない。

### D3: 明示的なnoopと実行時障害の既存契約は維持する

- 未設定時の既定値 `access-control=noop` / `audit=noop` は変更しない。外部連携を使わない構成は従来どおり起動できる。
- endpoint設定済みのPDPが実行時に不達・timeout・不正応答となった場合は、既存の `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only|deny` を適用する。
- 監査HTTPの送信失敗は、既存のfail-open dispatcher方針を維持する。今回拒否するのは「HTTPを選択したのに接続先がない」という静的な構成不備である。
- 起動時のendpoint到達性probeは行わない。構成完全性と一時的な外部サービス可用性を混同しない。

### D4: 全runtime profileへ同じ完全性規則を適用する

- `local-dev`、`evaluation`、`enterprise-production`、予約中の `saas-multitenant` のいずれでも、外部HTTP方式を明示した場合はendpointを必須とする。
- profile別の互換flagや「endpoint欠損を許可する」例外設定は追加しない。外部連携を無効化する場合は方式を明示的に `noop` へ戻す。

## Alternatives considered

1. **警告してnoopへ縮退する**: 設定ミスを観測できても認可は全許可のままであり、安全境界を回復しないため不採用。
2. **SaaS profileだけfail-fastにする**: single-tenantでも「外部PDPを選択した」という運用意図を設定欠損で無効化してよい理由はないため不採用。
3. **request時にunavailable adapterへ倒す**: 起動は成功して障害発見が遅れ、監査側との契約も揃わないため不採用。
4. **起動時に接続先へprobeする**: 一時障害で起動不能となり、credentialを伴う副作用のない共通probe契約もないため不採用。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 運用者が外部PDPを有効化したつもりでも、設定漏れだけで認可が無警告の全許可へ変わる。明示した認可連携が設定欠損で全許可になる経路は既存のfail-closed安全不変条件で覆えない実際の境界超過 | 機能: 欠損時はSettings構築を`ValueError`で停止しDB初期化・外部通信・request受付より前に起動拒否。データ: エラーは欠損した設定キーだけを示し入力値を反射しない |
| **データ設計** | `external_http`/`http`選択時は対応endpointを必須とする原子的設定。access-control builderが外部方式を受け取ったのにendpointを解決できない場合は例外送出 | 業務: 未設定時の既定`noop`は変更しない。機能: endpoint設定済みPDPの実行時障害は既存のfail-safe（read_only/deny）を適用 |
| **機能設計** | 全runtime profileへ同じ完全性規則を適用（local-dev/evaluation/enterprise-production/saas-multitenant）。互換flagや「endpoint欠損を許可する」例外設定は追加しない | 業務: 外部連携を無効化する場合は方式を明示的に`noop`へ戻す。データ: 起動時のendpoint到達性probeは行わず構成完全性と一時的可用性を混同しない |

## Consequences

- endpointを欠いた既存の明示HTTP構成は起動しなくなる。運用者は正しいendpointを設定するか、外部連携を使わない意図を `noop` で明示する必要がある。
- 既定構成、完全設定された外部HTTP構成、実行時障害のfail-safe/fail-open方針は変わらない。
- 設定漏れがrequest処理後ではなく起動時に判明し、外部PDPを有効化したつもりの全許可を防げる。
- プレリリースで安定API利用者・移行対象運用がないため、互換flagは設けない。

## Non-goals

- access-controlの既定をexternal HTTPへ変更しない。
- 外部PDP障害時の `read_only` / `deny` 方針を変更しない。
- 監査送信失敗で本体機能を停止する方式へ変更しない。
- endpointの到達性、認証情報の有効性、外部サービスの健全性を起動時に保証しない。

## Traceability

- Implementation: `01_Plans/issues/done/issue-SEC-CONFIG-01-http-integration-silent-noop-fallback.md`
- Runtime contract: `02_Architecture/runtime_parameter_registry.md`
- API contract: `02_Architecture/api.md` §8.5
- Security boundary: `THREAT_MODEL.md`
- Related: `01_Plans/adr/ADR-0029-third-party-runtime-env-boundary.md`
- Re-entry trigger: `01_Plans/adr/ADR-0047-design-decision-adr-saturation-and-execution-first.md` R-3

