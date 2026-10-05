# ADR-0021: 環境変数のグローバルプレフィックス移行方針

- Status: Accepted
- Date: 2026-03-05
- Deciders: Project Maintainers
- Scope: `02_Architecture/`, `03_Implement/backend/`, `03_Implement/deploy/`, `04_Documentation/`

## Context

同じサーバやCI環境では、sui-sensemaking以外のアプリケーション、データベース、ビルドツールも環境変数を使う。

`DATABASE_URL`、`API_KEY`、`LLM_PROVIDER` のような一般的な名前を公開設定として使うと、次の問題が起きやすい。

- 別のアプリケーションの設定を、sui-sensemakingが誤って読み込む。
- 運用者が、どのアプリの設定値か判断しにくい。
- 公開設定、第三者コンテナの内部名、ビルドツールの内部名の境界が曖昧になる。
- 古い互換キーが残り、意図しない外部連携や接続先の変更につながる。

そのため、sui-sensemakingが利用者と運用者に公開する環境変数は、アプリケーション固有の名前空間に統一する必要がある。

## Decision

sui-sensemakingの公開環境変数は、すべて例外なく `SUI_` で始まる名前だけを、正規のキーとして扱う。

### 規則

1. 利用者と運用者が設定する公開キーは、`SUI_*` だけとする。
2. 旧キー、短縮キー、互換キーは、公開設定として受け付けない。
3. 新旧のキーの同時指定を認める移行期間は設けない。
4. 旧キーを自動で変換するdeprecation windowは設けない。
5. 新しい環境変数を追加する場合も、必ず `SUI_` で始める。

### 代表例

| 目的 | 正規キー |
| --- | --- |
| DB接続先 | `SUI_DATABASE_URL` |
| LLM provider | `SUI_LLM_PROVIDER` |
| large-scale LLMへの昇格の許可 | `SUI_LLM_ESCALATION_ENABLED` |
| API key | `SUI_API_KEY` |
| frontendのAPI base path | `SUI_FRONTEND_API_BASE` |
| Docker ComposeのWeb公開port | `SUI_WEB_PORT` |
| Docker ComposeのPostgreSQL入力 | `SUI_POSTGRES_DB`, `SUI_POSTGRES_USER`, `SUI_POSTGRES_PASSWORD` |

### Private Adapter Boundary

第三者のコンテナやビルドツールが、内部的に別の名前を要求する場合がある。

この場合でも、利用者と運用者に公開するsui-sensemakingの入力は、`SUI_*` のままとする。内部名への写像はprivate adapter boundaryとして扱い、公開設定とはみなさない。

例を挙げる。

- Docker ComposeのPostgreSQLイメージへ渡す `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`
- frontendのビルドツールの内部処理で使われる互換のshim

これらは、利用者が直接設定するsui-sensemakingの公開キーではない。公開文書では、正規のキーと内部への写像の境界を明示する。

## Non-Goals

- 既存の安全な既定値を変更しない。
- SafeMode、共有前の確認、LLMのopt-in、audit連携、access controlの方針は、このADRでは変更しない。
- 第三者のコンテナの内部から、`SUI_*` 以外の名前を完全に排除するdeploymentの再設計は、このADRの範囲外とする。採用する場合は、別のADRで扱う。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 同一のサーバやCI環境では他のアプリケーションも環境変数を使うため、`DATABASE_URL`などの一般的な名前を公開設定にすると、別のアプリの設定を誤って読み込み、所有の境界が曖昧になる。sui-sensemakingの公開環境変数を、アプリ固有の名前空間に統一する | 機能: 新しい環境変数も、必ず`SUI_`で始める。データ: 設定値の所有の境界を明確にし、誤接続、誤送信、別のアプリの設定の混入を減らす |
| **データ設計** | 公開キーは`SUI_*`だけとする。旧キー、短縮キー、互換キーは公開設定として受け付けない。新旧のキーを同時に指定できる移行期間と、旧キーを自動で変換するdeprecation windowは設けない | 業務: 運用者が、どのアプリの設定値か判断しやすくする。機能: 古い互換キーが、意図しない外部連携や接続先の変更につながらないようにする |
| **機能設計** | 第三者のコンテナやビルドツールが内部的に別の名前を要求する場合は、private adapter boundaryとして扱い、公開する入力は`SUI_*`のまま内部名へ写像する | 業務: 第三者のコンテナの内部から`SUI_*`以外の名前を完全に排除するdeploymentの再設計は、別ADRの範囲とする。データ: runtime_parameter_registry.mdと公開文書では、`SUI_*`だけを利用者向けのキーとして記載する |

## Consequences

期待される効果

- 設定値の所有の境界が明確になる。
- 誤接続、誤送信、別のアプリの設定の混入を減らせる。
- 公開文書、runtime registry、backend settings、Compose入力の対応を、監査しやすくなる。

制約

- 旧キーを使っていた環境は、起動時に修正が必要になる。
- 設定を変更するときは、実装、設計文書、公開文書、テストを同時に更新する必要がある。
- 第三者のコンテナの内部名を公開設定と誤読しないよう、文書でprivate adapter boundaryを維持する必要がある。

## Verification Expectations

このADRを維持するため、次を継続して確認する。

- backend settingsが、`SUI_*` のvalidation aliasだけを公開入力として受け付ける。
- frontendのビルドが、`SUI_FRONTEND_API_BASE` を正規のキーとして扱う。
- Docker Composeの利用者の入力が、`SUI_*` だけである。
- `04_Documentation/configuration.md` と `02_Architecture/runtime_parameter_registry.md` が、同じ公開キーの集合を説明している。
- 旧キー名は、拒否の対象、履歴の説明、private adapter boundaryの説明としてだけ現れる。

## Separation of Concerns

このADRは、長期的に維持する意思決定を記録する。

実装作業、検証ログ、Done判定、残りのタスクは、issue memoで管理する。

- Execution tracking: `01_Plans/issues/done/issue-ENV-ARCH-01-global-env-prefix-migration.md`
- Runtime contract tracking: `01_Plans/issues/done/issue-ENV-CONFIG-DRIFT-01-runtime-configuration-contract-alignment.md`
- Policy SSOT: `02_Architecture/runtime_parameter_registry.md`

## Traceability

- Derived-from: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `01_Plans/adr/ADR-0029-third-party-runtime-env-boundary.md`
