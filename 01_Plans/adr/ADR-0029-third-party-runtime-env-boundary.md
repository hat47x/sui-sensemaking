# ADR-0029: Third-party runtime environment boundary

- Status: Accepted
- Date: 2026-05-10
- Deciders: Project Maintainers
- Scope: `03_Implement/deploy/`, `02_Architecture/runtime_parameter_registry.md`, `04_Documentation/configuration.md`

## Context

ADR-0021 は、sui-sensemaking の実行時環境変数に使える名前空間を `SUI_*` だけとして受け入れた。

Compose による配備は、いまも第三者のコンポーネントを使っている。代表例は公式のPostgreSQLコンテナイメージで、このイメージには独自の環境変数の取り決めがある。そこで、次の2つを区別する決定の境界が必要になった。

- 利用者と運用者が sui-sensemaking のために設定する公開変数
- 第三者のイメージやビルドツールが必要とする非公開のアダプタ変数

この境界がないと、「すべての環境変数は `SUI_` で始める」という文が、両立しない2通りに読める。

1. sui-sensemaking の公開設定はすべて `SUI_*` を使う。
2. 配備内のどのプロセスも、ベンダー定義の名前を含め、`SUI_*` 以外の環境変数名を受け取らない。

現在の実装は1つ目の解釈を満たす。2つ目は満たさない。PostgreSQLイメージが、`db` サービスの内側でベンダー定義の名前を使うためである。

## Decision

プロジェクトが所有し、利用者に見せる実行時環境変数は、必ず `SUI_` で始める。

`SUI_*` 以外の変数を、sui-sensemaking の公開設定として文書化したり、受け付けたり、必須にしたりしてはならない。

第三者のイメージやビルドツールがベンダー定義の環境変数名を要求する場合、sui-sensemaking はサービスまたはビルドの境界で、`SUI_*` の入力からその非公開の名前へ写してよい。この写像はアダプタの境界であり、公開設定の例外ではない。

ベンダー定義の名前を利用者が直接設定する使い方は対象外とする。公開文書と運用手順書は、`SUI_*` の変数だけを設定するよう案内しなければならない。

配備に含まれるどのプロセスの環境にも `SUI_*` 以外の名前を入れない、というより厳しい解釈をメンテナーが求める場合は、別のアーキテクチャ変更として扱う。その場合、issueを完了にする前に、PostgreSQLサービスをプロジェクト所有の初期化・実行の経路へ置き換えるか、マネージドデータベースだけを使う配備へ変える必要がある。

Non-goals

- このADRでデータベースの構成を設計し直すこと
- 接頭辞のない旧プロジェクト変数への互換対応を加えること
- SafeMode、アクセス制御、エクスポートの挙動を変えること


## Boundary contract matrix

| Boundary | Key namespace | Who sets it | Where it appears | Rule |
| --- | --- | --- | --- | --- |
| Public runtime contract | `SUI_*` only | Users / operators | Runtime registry, configuration docs, Compose input surface | MUST be documented and supported as public keys. |
| Private adapter boundary | vendor-defined names (for example `POSTGRES_*`) | Compose/build implementation only | Third-party container `environment` / build internals | MUST NOT be exposed as public configuration keys. |

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | Composeによる配備は公式PostgreSQLなど第三者のイメージを使い、そのイメージは独自のコンテナ環境の取り決めを持つ。「全環境変数が`SUI_*`」を、「公開設定は`SUI_*`」と「配備内の全プロセスが非`SUI_*`名を受け取らない」の2解釈に分けて、境界を明確に定める | 機能: 非`SUI_*`変数は公開設定として文書化も受付も要求もしない。データ: 利用者向けの公開文書と運用手順書は`SUI_*`だけを設定させる |
| **データ設計** | 第三者のイメージやビルドツールがベンダー定義名を要求する場合は、サービスまたはビルドの境界で`SUI_*`の入力から非公開名へ写すアダプタ境界とする。利用者による直接設定は対象外 | 業務: 公開設定の取り決めを単純で監査しやすく保ち、第三者イメージの環境変数を利用者に見せない。機能: ベンダー定義名の直接設定は対象外 |
| **機能設計** | より厳しい解釈（同梱の配備内のプロセス環境に非`SUI_*`名を含めない）が必要なら、別のアーキテクチャ変更として扱う。PostgreSQLをプロジェクト所有の初期化・実行の経路かマネージドデータベース限定へ置き換えるまで、Doneにしない | 業務: データベース構成の再設計、接頭辞のない旧変数の互換対応、SafeMode・アクセス制御・エクスポートの変更は対象外。データ: アダプタ境界は公開設定の例外ではなく写像として扱う |

## Consequences

期待される効果

- 公開設定の取り決めを、単純で監査しやすいまま保てる。
- 標準の第三者イメージを使い続けながら、その環境変数を利用者に見せずに済む。
- 文書に「利用者は `SUI_*` だけを設定する。実装側のアダプタが内部で変換してよい」という明確な規則を与えられる。

制約とリスク

- 第三者のアダプタが必要とする箇所では、ソースファイルにベンダー定義の名前が残る場合がある。
- 自動検査は、公開設定のキーと非公開のアダプタのキーを区別する必要がある。
- 将来「接頭辞のない環境変数をどこにも置かない」という要件が出た場合、それは文書の整理ではなく配備の再設計である。


## C/D/C log (for ENV-CONFIG-DRIFT-01)

### Confirmed

- 公開する実行時の取り決めは、`SUI_*` のキーだけを使う。
- ベンダーやビルドツール固有の名前は、アダプタの境界の内側（Composeのサービス内部、ビルド時の橋渡し変数）にだけ置ける。
- 公開文書と実行時レジストリは、ベンダー定義の名前を運用者に直接設定させてはならない。

### Decided

- このフェーズでは、Composeと第三者イメージについて、アダプタ境界の解釈を採用した運用モデルとして維持する。
- 第三者コンテナの内側にあるベンダー定義のプロセス環境変数名は実装の詳細として扱い、公開する取り決めの例外とは見なさない。

### Clarified pending

- 将来、プロジェクトの方針を「`SUI_*` 以外のプロセス環境変数名をどこにも置かない」へ引き上げる場合は、配備の再設計が必要になる（PostgreSQLイメージの経路を置き換えるか、マネージドデータベースだけの構成を強制する）。
- エンドポイントがないときの `external_http` アダプタの挙動は別のガバナンス判断として残り、このADRでは変えない。

## Traceability

- Related: `01_Plans/adr/ADR-0021-env-var-global-prefix-migration.md`
- Related: `02_Architecture/runtime_parameter_registry.md`
- Related: `03_Implement/deploy/docker-compose.yml`
- Related issue: `01_Plans/issues/done/issue-ENV-CONFIG-DRIFT-01-runtime-configuration-contract-alignment.md`
- Derived-from: `01_Plans/adr/ADR-0001-value-to-requirements.md`


## Public key set (frozen for ENV-CONFIG-DRIFT-01)

公開する実行時キーの集合は、`02_Architecture/runtime_parameter_registry.md` に載っているキーに固定する。そのすべてが `SUI_*` を使わなければならない。

第三者コンテナの内部を含め、ベンダー定義のプロセス環境変数名をすべて禁止したいという将来の要件は、このADRの解釈の調整ではない。置き換え後の配備アーキテクチャを必要とする、別の設計変更の系統である。
