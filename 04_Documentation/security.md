# セキュリティ

対象読者: sui-sensemakingを安全に評価・運用する管理者、セキュリティ担当者、開発者。

目的: SafeMode、外部サービスとの共有、APIの保護、アクセス制御、データの取り扱いについて、守るべき基本の境界を説明します。

データが保存される場面、外部サービスと共有される場面、利用者が共有する場面を通して確認したいときは、先に [data_handling.md](data_handling.md) を読んでください。

## 関連文書の使い分け

- [operations.md](operations.md): 日常の運用と、障害時の初動。
- [security.md](security.md)（本書）: SafeMode、共有と書き出し、外部接続の基本方針。
- [security_operational_guidelines.md](security_operational_guidelines.md): 安全に関わる設定を変える前の判断の例。

設定値の詳細は、GitHub上の [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md) を参照してください。本書では、利用するときに確認する境界だけを説明します。

## 基本方針

- 既定では、外部のLLMにデータを渡しません。
- SafeModeは、未レビューの情報が混ざることと、共有や書き出しの制限が意図せず緩むこと、AIが自動で確定することを防ぐための、安全上の境界です。
- AIの出力は提案として扱い、人間が確認するまで、確定した状態にしません。
- 秘密情報、トークン、未公開の顧客情報、生の監査ログを、利用者向けの文書や書き出しに混ぜません。

## 先に知っておく用語

| 用語 | 意味 |
| --- | --- |
| SafeMode | 危険な自動処理や、未レビューの情報の混入を避けるため、安全側の動作を優先する状態です。 |
| 外部サービスとの共有 | LLM、監査ログの連携先、外部のアクセス制御の接続先など、アプリの外にあるサービスと情報を共有することです。 |
| opt-in | リスクと影響を理解したうえで、利用者が明示的に有効にすることです。 |
| 許可リスト | 接続してよい宛先だけを並べた一覧です。 |
| フェイルセーフ | 障害のときに、便利さより安全を優先する動作です。 |

## 既定で無効なもの

| 項目 | 既定 |
| --- | --- |
| LLMのプロバイダ | `SUI_LLM_PROVIDER=none` |
| 大規模LLM | opt-inしなければ無効 |
| 監査ログのHTTP送信 | `SUI_AUDIT_EXPORT_ENABLED=false` |
| SafeMode中の監査ログのHTTP連携 | `SUI_AUDIT_ALLOW_IN_SAFE_MODE=false` |
| APIキーによる認証 | `SUI_API_KEY` が未設定なら無効 |

## APIキー

`SUI_API_KEY` を設定すると、`/healthz` 以外のAPIは `X-API-Key` ヘッダーを要求します。

```bash
export SUI_API_KEY='change-me'
```

```bash
curl -H "X-API-Key: change-me" http://localhost:8080/api/docs/example
```

ブラウザで動く同梱の画面（SPA）は `X-API-Key` を送らないため、`SUI_API_KEY` を設定すると、画面からの操作は401になります。APIキーは、`curl` などプログラムからのアクセスを守る簡易的な保護です。ブラウザへの配信を守るときは、画面に鍵を持たせず、前段の認証プロキシで行います。公開ネットワークで本格的に運用するときは、TLS、認証プロキシ、アクセス制御、監査を組み合わせてください。

> 注意: 標準のDocker Composeは、このキーをホストの環境からそのまま渡します。ホストで未設定なら、コンテナの中でも未設定のままで、既定の無効な状態が保たれます。詳しくは [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings) を参照してください。

## 管理面の保護

管理面（`/admin/provision/**`）は、業務用のAPIとは別の資格情報で保護します。業務用の `SUI_API_KEY` では到達できません。

この分離は必須です。`POST /admin/provision/identity-providers` は、信頼するJWTの発行者とJWKSのURIを登録するエンドポイントです。ここへ到達できる人は、自分の鍵でIdPを登録し、それに一致するトークンを自作して、任意の利用者、任意のテナントとして認証できてしまいます。文書を読める資格情報と、信頼の起点を書き換えられる資格情報を、同じものにしてはいけません。

### 二段構成

| 段 | 経路 | 使う場面 |
| --- | --- | --- |
| A | `SUI_ADMIN_API_KEY` を `X-Admin-Api-Key` ヘッダーで提示する | 初期設定（ブートストラップ）専用です。IdPが1件も登録されていない状態で使える、唯一の経路です。人物は特定できませんが、操作の結果と、資格情報を短くした指紋（fingerprint）は、管理面の監査に記録されます。 |
| B | 検証済みセッションの `tenant.provision` 権限 | 通常の運用で使います。本人を特定でき、監査にも残ります。IdPを登録したあとは、こちらを使います。 |

```bash
curl -X POST -H "X-Admin-Api-Key: $SUI_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"issuer":"https://idp.example.com","audience":"sui-sensemaking","jwksUri":"https://idp.example.com/jwks"}' \
  http://localhost:8080/api/admin/provision/identity-providers
```

### 本番に近いプロファイルでの必須設定

`enterprise-production` と `saas-multitenant` は、認証の手段が未設定だと起動しません（設定を読み込む時点で失敗します）。

- `enterprise-production`: `SUI_ADMIN_API_KEY` と `SUI_API_KEY` の両方が必須です。業務用のAPIでの本人識別を、前段のプロキシが付けるヘッダーに頼るため、業務用のキーが唯一の防御になります。
- `saas-multitenant`: `SUI_ADMIN_API_KEY` が必須です。業務用のAPIでは、信頼する認証の入口が検証したJWTを使います。

業務用のキーと管理用のキーには、必ず異なる値を設定してください。同じ値を設定すると、起動時に拒否します。ヘッダー名を分けても、秘密の値が同じなら、業務用の資格情報を持つ人が管理面へ移れてしまうからです。

### アプリ側の保証と前段の責務

上の設定は、いずれもアプリ側が最低限保証するものです。企業や行政の運用では、これに加えて、管理面をネットワークの層で分離する構成（別のポート、別のホスト、IAPの配下など）を勧めます。これは配備側の選択で、アプリ側の二段構成と併用できます。前段で閉じている場合も、アプリ側の資格情報は外さないでください。前段の設定を誤ったときに、そのまま公開される状態を避けるためです。

### SaaSでのテナントの発行

`saas-multitenant` でも、管理面のAPIには到達できます。ただし、APIに到達できることと、テナントを発行してよい業務上の根拠があることは、別の問題です。

- `enterprise-production`（自己ホスト）: 最初の管理者は、そのインスタンスを配備した人です。サーバーに到達できることが、所有していることを意味します。管理面の資格情報による初期設定で、この点は閉じています。
- `saas-multitenant`（共有基盤）: 最初の管理者は、テナントを申し込んだ組織の代表者で、その人が本当にその組織の人かは自明ではありません。組織が実在することと、ドメインを所有していることの確認が必要です。固定の資格情報だけでは、申込者がその組織の人であることを保証できません。

そのため、共有基盤でテナントを発行する運用では、申し込み、審査、ドメイン所有の確認を行う別の工程を、前段に置いてください。sui-sensemakingは、この工程を実装していません。管理面の資格情報を知っている人が、任意の組織名でテナントを作れる状態を、正規の手順にしてはいけません。

## ブラウザの認証トークン

SaaSの認証では、有効期間の短いアクセストークンを、画面の実行中のメモリにだけ保持します。`localStorage` や `sessionStorage` には保存せず、画面を再読み込みしたときは、ブローカーで認証し直します。SPA向けのクライアントには、リフレッシュトークンを発行しないでください。想定外にリフレッシュトークンを含む応答を受け取ったときは、画面がそのトークン応答の全体を拒否します。

テナントセッションのCookieは、HttpOnlyとSameSite=Strictで、`local-dev` 以外ではSecureも付けます。ログアウトの処理では、アクセストークンのメモリ上の状態と、テナントセッションのCookieの、両方を破棄してください。XSS対策は引き続き必要です。そのうえで、ブラウザのストレージに長期の資格情報を残さないことで、攻撃を受けたあとに悪用できる時間を短くします。

## SafeModeの画面での確認

共有や書き出しの前に、「共有と再現」パネルの `共有前チェック` で、SafeMode、公開範囲、未レビューの情報、出力形式を確認します。SafeModeが有効なときは、書き出しと共有で機微なテキストをマスクすること、固定のマスク対象を無効にできないこと、未レビューの下書きを含めないことが、画面に示されます。

![SafeModeと共有前の確認画面](assets/screenshots/share-export-safe-mode.png)

> 起動方法による違い: 以下の `export SUI_*` の例は、backendを直接起動したときの設定です。標準のDocker Composeが `api` コンテナへ渡すのは `SUI_LLM_PROVIDER` だけで、`SUI_LOCAL_LLM_BASE_URL` などの接続情報は渡しません。どのキーが渡されるかは、[runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings) の `Delivery surface` の列を参照してください。

## LLMプロバイダの安全上の境界

### `none`

既定の設定です。AI機能は、プロバイダが無効であるものとして失敗します。検証やデモでは、この状態を勧めます。

初めて導入するときは、まず `none` のまま、保存、表示、受け入れ確認を行ってください。AIとの接続は、あとから足すほうが、問題の原因を切り分けやすくなります。

### `local`

ローカル、または組織内のHTTPの接続先を使います。

```bash
export SUI_LLM_PROVIDER=local
export SUI_LOCAL_LLM_BASE_URL='http://localhost:8001'
```

接続先は `<ベースURL>/generate` です。名前がlocalでも、実際の宛先が外部のネットワークでないことを、運用側で確認してください。

送信するリクエストは、UTF-8のJSONで1MiB以下に制限します。タスク、temperature、最大トークン数は、接続の前に検証します。大きすぎるプロンプトや `NaN` などの不正な値は、本文をエラーに表示せず、`provider_validation` で停止します。フォールバックの設定があっても、別の失敗の分類には置き換えません。

> 注意: 標準のDocker Composeは、`SUI_LOCAL_LLM_BASE_URL` を渡しません。Compose上でローカルのプロバイダを検証するときは、検証用の `docker-compose.llm-stub.yml` を重ねて使ってください。また、`api` コンテナの中から見た `http://localhost:8001` は、ホストではなく `api` コンテナ自身を指します。Compose環境では、この例をそのまま写さないでください。

### `large-scale`

大規模LLMを使うには、明示的なopt-in、昇格の許可、許可リストの、すべてが必要です。

```bash
export SUI_LLM_PROVIDER=large-scale
export SUI_LLM_ESCALATION_ENABLED=true
export SUI_LLM_LARGE_SCALE_OPT_IN=true
export SUI_LARGE_SCALE_LLM_ALLOWLIST='llm.example.com'
```

許可リストに含まれないホストとの連携は、失敗します。

## 監査ログの送信

監査ログをHTTPで送信するときの設定です。

```bash
export SUI_AUDIT_EXPORT_ENABLED=true
export SUI_AUDIT_TRANSPORT=http
export SUI_AUDIT_HTTP_ENDPOINT='https://audit.example.com/events'
```

次の点に注意してください。

- 接続先（エンドポイント）とAPIキーは、秘密情報として扱います。
- `SUI_AUDIT_TRANSPORT=http` を指定したときは、エンドポイントが必須です。未設定のままでも何もしない送信先には切り替わらず、設定エラーとして起動を拒否します。
- SafeMode中に監査ログのHTTP連携を許可するときは、`SUI_AUDIT_ALLOW_IN_SAFE_MODE=true` にした理由を、運用の記録に残してください。
- 監査ログには、必要最小限のメタ情報だけを含め、秘密情報の生の値は含めないでください。

## アクセス制御

既定のアダプタは `noop` です。外部のPDPへ問い合わせず、アプリ単体で、ローカルのフェイルセーフだけを使って動作します。

現在使えるアダプタは、次のとおりです。

| アダプタ | 用途 |
| --- | --- |
| `noop` | 外部の認可を使わない既定値 |
| `mock` | 契約テストと結合テスト用 |
| `external_http` | 認可の判定を、HTTPのPOSTで外部のPDPに任せる |

外部のPDPを使うときは、先に、障害時のフェイルセーフの動作を決めます。

```bash
export SUI_ACCESS_CONTROL_ADAPTER=external_http
export SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only
export SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT='https://pdp.example.com/decide'
```

障害のときに読み取り専用にする `read_only` を勧めます。より厳しく止めたい環境では、`deny` を使います。

次の点に注意してください。

- `external_http` を指定したときは、接続先のエンドポイントが必須です。未設定のままでも `noop` には戻らず、設定エラーとして起動を拒否します。外部のPDPを使わないときは、アダプタを明示的に `noop` に戻してください。
- `Org` や `Restricted` の対象で `policyRef` がないときは、ローカルのフェイルセーフが働きます。`read_only` では読み取りだけを許可し、`deny` では拒否します。
- `Public` と `Unlisted` は、`policyRef` がなくても、フェイルセーフを強制する対象ではありません。公開の範囲を広げる前に、公開範囲と `policyRef` を確認してください。

### 外部HTTP連携の設定の不備は、起動時に拒否する

次の2つのリゾルバーにも、アクセス制御や監査ログのHTTP連携と同じく、設定をすべてそろえる原則を適用します。

- `SUI_DOCUMENT_POLICY_BINDING_RESOLVER`
- `SUI_TENANT_CAPABILITY_RESOLVER`

どちらも、受け付ける値は `none` と `external_http` だけです。`external_http` を選んだのにエンドポイントがない場合、または `none` のままエンドポイントやAPIキーだけが残っている場合は、`noop` や `none` へ黙って戻さず、設定エラーとして起動を拒否します。未知のリゾルバー名、安全でないURL、認証情報、クエリ、フラグメントを含むURLも、拒否します。

この起動時の拒否は、設定の誤りを隠さないための、安全上の境界です。リゾルバーを無効にするときは、対応するHTTPのエンドポイントとAPIキーも、同時に削除してください。すべてのキーと入力の制約は、`02_Architecture/runtime_parameter_registry.md` を参照してください。

## 障害を調べるときの共有の境界

障害に対応するときのログの共有は、次の境界を守る場合だけ許可します。

- 共有してよい: 発生日時、URL（機微な部分を除く）、エラーの種類、HTTPステータス、SafeModeの状態、再現の手順。
- 共有してはいけない: APIキー、トークン、パスワード、マスクしていない本文、個人情報、監査イベントの生のデータ。

復旧するときは、先に原因を決めつけず、計画、実行、確認の順に進めます。エンドポイントや組織内の識別子を共有する必要があるときは、必要性を確認し、機微な部分を最小限にしてから共有します。

判断と実行は、別の人が担います。

- 判断する人: 共有する範囲と、マスクの方針を決める。
- 実行する人: マスクしたログを作り、送る。

誰が判断するのか分からないときは、ログの共有を止めて、[operations.md](operations.md) の、作業を止める条件に従います。

### アプリケーションログの個人情報の方針

アプリケーションログも、監査イベントと同じく、個人情報を最小限にする方針に従います。主体の識別子（`subject`）や外部テナントの参照（`external_tenant_ref`）など、IdPに由来する生の値は、ログに含めません。不具合の診断で識別子が必要なときは、ハッシュにした値か、最小限に切り出した断片だけを扱います。

## 保持してよい情報と避ける情報

| 区分 | 例 | 方針 |
| --- | --- | --- |
| 保持してよい | 文書の本文、カード、島、レビューの状態 | 通常のデータとして扱う |
| 最小限だけ保持する | 表示名、メールアドレス、外部のID参照 | 必要最小限にする |
| 一時的に使う | roles、groups、policyRef、trace id | 永続化しない前提で扱う |
| 禁止 | パスワード、トークン、シークレット、認証アサーションの生の値 | 保存、ログ、書き出しに含めない |

書き出し、共有、障害調査で、どの情報を削るか迷うときは、[data_handling.md](data_handling.md) のチェックリストを使います。

## セキュリティ確認のチェックリスト

- [ ] LLMのプロバイダが、意図した値になっている。
- [ ] 大規模LLMを使うときは、opt-inと許可リストを設定している。
- [ ] APIキーや監査ログのトークンを、リポジトリに含めていない。
- [ ] SafeMode中に、外部サービスとの共有を許可していない。許可しているときは、その理由を記録している。
- [ ] 共有や書き出しの出力に、秘密情報や内部のメモが混ざっていない。
- [ ] アクセス制御の障害時のフェイルセーフが、`read_only` など保守的な値になっている。
- [ ] `external_http` を使うときは、PDPの接続先（エンドポイント）も同時に設定し、設定の検証を通って起動している。
- [ ] 文書のポリシー紐づけとテナント権限のリゾルバーを `external_http` にするときは、エンドポイントを設定している。`none` にするときは、HTTPのエンドポイントとAPIキーが残っていない。

## 迷ったときの判断

- 外部サービスと共有する理由を説明できないときは、共有しない。
- 秘密情報が含まれるかもしれないときは、先に入力するデータを減らす。
- SafeModeを緩める必要がありそうなときは、実装を変えず、運用上の例外として扱う。
- 障害のときの挙動が分からないときは、読み取り専用にするか、LLMを無効にする。

## 役割と記録の考え方

組織での正式な役職名にかかわらず、少なくとも次の責務を分けて考えます。

- 安全性を判断する人: SafeMode、外部サービスとの共有、共有や書き出しのリスクを確認する。
- 業務上の必要性を判断する人: なぜ変更や共有が必要なのか、利用者にどのような影響があるかを確認する。
- 設定を実行する人: 設定の変更、復旧、実行結果の記録を担当する。

同じ人が複数の責務を担うときも、記録の上では、誰が判断し、誰が実行したかを分けて残します。

## 関連文書

- [configuration.md](configuration.md)
- [data_handling.md](data_handling.md)
- [security_operational_guidelines.md](security_operational_guidelines.md)
- [operations.md](operations.md)
- [THREAT_MODEL.md](https://github.com/hat47x/sui-sensemaking/blob/main/THREAT_MODEL.md)
