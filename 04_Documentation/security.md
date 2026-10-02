# Security

対象読者: sui-sensemakingを安全に評価・運用する管理者、セキュリティ担当者、開発者。

目的: SafeMode、外部サービスとの共有、API保護、アクセス制御、データ取り扱いの基本境界を説明します。

データが保存される場面、外部サービスと共有される場面、利用者が共有する場面を横断して確認したい場合は、先に [data_handling.md](data_handling.md) を読んでください。


## 関連文書の使い分け

- [operations.md](operations.md): 日常運用と障害時の初動。
- [security.md](security.md)（本書）: SafeMode、share/export、外部接続の基本方針。
- [security_operational_guidelines.md](security_operational_guidelines.md): 安全設定を変える前の判断例。

設定値の詳細は、GitHub上の [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md) を参照してください。本書では利用時に確認する境界だけを説明します。

## 基本方針

- 既定では外部LLMにデータを渡しません。
- SafeModeは未レビュー情報の混入、share/exportの意図しない緩和、AIによる自動確定を避けるための安全境界です。
- AIの出力は提案として扱い、人間の確認なしに確定状態へ昇格させません。
- 秘密情報、トークン、未公開顧客情報、生の監査ログを利用者向け文書やexportに混ぜません。

## 先に知っておく用語

| 用語 | 意味 |
| --- | --- |
| SafeMode | 危険な自動処理や未レビュー情報の混入を避けるため、安全側の挙動を優先する状態です。 |
| 外部サービスとの共有 | LLM、監査ログ連携の接続先、外部アクセス制御の接続先など、アプリ外のサービスと情報を共有することです。 |
| opt-in | 危険や影響を理解したうえで、明示的に有効化することです。 |
| allowlist | 接続してよい宛先だけを列挙する一覧です。 |
| fail-safe | 障害時に、便利さより安全を優先する動きです。 |

## 既定で無効なもの

| 項目 | 既定 |
| --- | --- |
| LLM provider | `SUI_LLM_PROVIDER=none` |
| large-scale LLM | opt-in なしでは無効 |
| audit HTTP export | `SUI_AUDIT_EXPORT_ENABLED=false` |
| SafeMode 中の audit HTTP 連携 | `SUI_AUDIT_ALLOW_IN_SAFE_MODE=false` |
| API key 認証 | `SUI_API_KEY` 未設定時は無効 |

## API key

`SUI_API_KEY` を設定すると、`/healthz` 以外のAPIは `X-API-Key` ヘッダーを要求します。

```bash
export SUI_API_KEY='change-me'
```

```bash
curl -H "X-API-Key: change-me" http://localhost:8080/api/docs/example
```

ブラウザで動く同梱の画面（SPA）は `X-API-Key` を送らないため、`SUI_API_KEY` を設定すると画面からの操作は401になります。API keyは `curl` などプログラムからのアクセスを保護するための簡易保護です。ブラウザ配信を保護する場合は、画面に鍵を持たせるのではなく前段の認証proxyで行います。公開ネットワークでの本格運用では、TLS、認証proxy、アクセス制御、監査を組み合わせてください。

> 注意: 標準 Docker Compose はこのキーをホスト環境から pass-through 配送します（ホスト側で未設定の場合はコンテナ内でも未設定のままで、既定の無効状態を維持します。[runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings) 参照）。

## 管理面（Control Plane）の保護

管理面（`/admin/provision/**`）は**業務面とは別の資格情報**で保護します。`SUI_API_KEY`（業務面）では到達できません。

この分離は必須です。`POST /admin/provision/identity-providers` は**信頼するJWT発行者とJWKS URIを登録する**エンドポイントであり、ここへ到達できる主体は自分の鍵でIdPを登録し、それに一致するトークンを自作して**任意の利用者・任意のテナントとして認証できます**。文書を読めることと、信頼の起点を書き換えられることを、同じ資格情報で守ってはなりません。

### 二段構成

| 段 | 経路 | 使う場面 |
| --- | --- | --- |
| **A** | `SUI_ADMIN_API_KEY` を `X-Admin-Api-Key` ヘッダーで提示 | **ブートストラップ専用**。IdPが1件も登録されていない状態で使える唯一の経路。人物は特定できませんが、操作結果と資格情報の短いfingerprintは管理監査へ記録されます |
| **B** | 検証済みセッションの `tenant.provision` capability | **通常運用**。主体が特定でき監査に載ります。IdP登録後はこちらを使います |

```bash
curl -X POST -H "X-Admin-Api-Key: $SUI_ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"issuer":"https://idp.example.com","audience":"sui-sensemaking","jwksUri":"https://idp.example.com/jwks"}' \
  http://localhost:8080/api/admin/provision/identity-providers
```

### 本番相当プロファイルでの必須化

`enterprise-production` と `saas-multitenant` は、認証手段が未設定なら**起動しません**（`Settings()` 構築時に失敗します）。

- `enterprise-production`: `SUI_ADMIN_API_KEY` と `SUI_API_KEY` の**両方**が必須です。業務面の識別を前段proxyのheaderに依存するため、業務面キーが唯一の防御線になります。
- `saas-multitenant`: `SUI_ADMIN_API_KEY` が必須です。業務面はtrusted auth edgeの検証済みJWTが担います。

業務面キーと管理面キーには**必ず異なる値**を設定してください。同じ値は起動時に拒否されます。ヘッダー名だけを分けても、秘密値が同じなら業務資格情報の保持者が管理面へ横滑りできるためです。

### アプリ側の保証と前段委譲の責務境界

上記はいずれも**アプリ側の最低保証**です。企業・行政の運用では、これに加えて管理面をネットワーク層で分離する構成（別listen port、別ホスト、IAP配下など）を推奨します。これはdeployment側の選択で、アプリ側の二段構成と排他ではありません。**前段で閉じている場合もアプリ側の資格情報は外さないでください。** 前段の設定ミスが直接公開になる状態を作らないためです。

### SaaS でのテナント発行について

`saas-multitenant` でも管理面のAPIには到達できます。ただし**APIの到達性と、テナント発行の業務的正当性は別問題です。**

- `enterprise-production`（自己ホスト）: 最初の管理者はそのインスタンスをデプロイした人物であり、サーバへの到達権が所有権を意味します。制御プレーン資格情報によるbootstrapでここは閉じます。
- `saas-multitenant`（共有基盤）: 最初の管理者は「テナントを申し込んだ組織の代表者」であり、これは自明ではありません。組織の実在とドメイン所有の確認が必要で、**静的な資格情報だけでは「申込者が本当にその組織の人か」を担保できません。**

したがって共有基盤としてテナントを発行する運用では、申込・審査・ドメイン所有確認を伴う別工程を前段に置いてください。sui-sensemakingはその工程を実装しません。制御プレーン資格情報を知る者が任意の組織名でテナントを作れる状態を、正規手順にしないでください。

## ブラウザ認証トークン

SaaS認証では、短命のaccess tokenを画面の実行中メモリだけに保持します。`localStorage`や`sessionStorage`には保存せず、画面を再読み込みした場合はbrokerで再認証します。SPA用clientではrefresh tokenを発行しないでください。想定外にrefresh tokenを含む応答を受け取った場合、画面はそのtoken応答全体を拒否します。

tenant-session cookieはHttpOnly・SameSite=Strictで、`local-dev`以外ではSecureです。ログアウト処理ではaccess tokenのメモリ状態とtenant-session cookieの両方を破棄してください。XSS対策は引き続き必要ですが、browser storageへ長期資格情報を残さないことで、攻撃後の再利用可能時間を短くします。

## SafeMode の画面確認

share/exportの前は、「共有と再現」パネルの `共有前チェック` でSafeMode、公開範囲、未レビュー情報、出力形式を確認します。SafeModeが有効な状態では、export/shareコンテキストで機微テキストをマスクすること、固定マスク対象を無効化できないこと、未レビューのドラフトを含めないことが画面上に示されます。

![SafeMode と共有前の確認画面](assets/screenshots/share-export-safe-mode.png)

> 起動面の注意: 以下の `export SUI_*` 例は direct 起動時の設定例です。標準 Docker Compose は `SUI_LLM_PROVIDER` のみを `api` コンテナへ配送し、`SUI_LOCAL_LLM_BASE_URL` 等の接続情報キーは配送しません。配送範囲は [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md#backend-settings)（`Delivery surface` 列）を参照してください。

## LLM provider の安全境界

### `none`

既定です。AI機能はprovider disabledとして失敗します。検証やデモではこの状態を推奨します。

初回導入時は、まず `none` のまま保存・表示・受け入れ確認を行ってください。AI接続を後から足す方が、問題の原因を分けやすくなります。

### `local`

ローカルまたは組織内のHTTP接続先（endpoint）を使います。

```bash
export SUI_LLM_PROVIDER=local
export SUI_LOCAL_LLM_BASE_URL='http://localhost:8001'
```

接続先は `<base_url>/generate` です。localと呼んでいても、実際の宛先が外部ネットワークでないことを運用側で確認してください。

送信requestはUTF-8 JSONで1MiB以下に制限され、task、temperature、max token数を接続前に検証します。過大promptや`NaN`等の不正値は本文をerrorへ表示せず`provider_validation`で停止し、fallback設定があっても別の失敗分類へ置き換えません。

> 注意: 標準 Docker Compose は `SUI_LOCAL_LLM_BASE_URL` を配送しません。Compose 上で `local` provider を検証する場合は、検証専用の `docker-compose.llm-stub.yml` overlay を使ってください。また `api` コンテナ内から見た `http://localhost:8001` はホストではなく `api` コンテナ自身を指すため、Compose 環境ではこの例をそのまま転記しないでください。

### `large-scale`

large-scaleは、明示opt-in、昇格許可、allowlistがすべて必要です。

```bash
export SUI_LLM_PROVIDER=large-scale
export SUI_LLM_ESCALATION_ENABLED=true
export SUI_LLM_LARGE_SCALE_OPT_IN=true
export SUI_LARGE_SCALE_LLM_ALLOWLIST='llm.example.com'
```

allowlistに含まれないhostとの連携は失敗します。

## Audit export

audit HTTP exportを使う場合。

```bash
export SUI_AUDIT_EXPORT_ENABLED=true
export SUI_AUDIT_TRANSPORT=http
export SUI_AUDIT_HTTP_ENDPOINT='https://audit.example.com/events'
```

注意は次のとおりです。

- 接続先（endpoint）とAPI keyは秘密情報として扱います。
- `SUI_AUDIT_TRANSPORT=http` を指定した場合、endpointは必須です。未設定ならnoopへ縮退せず、設定エラーとして起動を拒否します。
- SafeMode中にaudit HTTP連携を許可する場合は、`SUI_AUDIT_ALLOW_IN_SAFE_MODE=true` の理由を運用記録に残してください。
- auditには必要最小限のメタ情報だけを含め、生の秘密情報を含めないでください。

## Access control

既定のadapterは `noop` です。これは外部PDPへ問い合わせず、アプリ単体のlocal fail-safeだけで動きます。

現行実装で使えるadapterは次です。

| adapter | 用途 |
| --- | --- |
| `noop` | 外部認可を使わない既定値 |
| `mock` | 契約・結合テスト用 |
| `external_http` | 外部 PDP へ HTTP POST で認可判定を委譲 |

外部PDPを使う場合は、fail-safe動作を先に決めます。

```bash
export SUI_ACCESS_CONTROL_ADAPTER=external_http
export SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=read_only
export SUI_ACCESS_CONTROL_EXTERNAL_HTTP_ENDPOINT='https://pdp.example.com/decide'
```

障害時に読み取り専用へ落とす `read_only` を推奨します。より厳格に止めたい環境では `deny` を使います。

注意は次のとおりです。

- `external_http` を指定した場合、接続先（endpoint）は必須です。未設定なら `noop` にフォールバックせず、設定エラーとして起動を拒否します。外部PDPを使わない場合はadapterを明示的に`noop`へ戻してください。
- `Org` または `Restricted` の対象で `policyRef` がない場合、local fail-safeが働きます。`read_only` では読み取りだけを許可し、`deny` では拒否します。
- `Public` と `Unlisted` は `policyRef` 欠損による強制fail-safeの対象外です。公開範囲を広げる前に、visibilityとpolicyRefを確認してください。

### 外部HTTP連携は設定不備を起動時に拒否する

次の2 resolverも、access-controlと監査HTTPと同じ完全設定の原則を使います。

- `SUI_DOCUMENT_POLICY_BINDING_RESOLVER`
- `SUI_TENANT_CAPABILITY_RESOLVER`

どちらも `none` または `external_http` だけを受理します。`external_http` を選んだのにendpointがない場合、または `none` のままendpointやAPI keyだけを残した場合は、`noop` / `none` へ静かに後退せず、設定エラーとして起動を拒否します。不明なresolver名、安全でないURL、credential・query・fragmentを含むURLもfail-closedで拒否します。

この起動時拒否は設定ミスを隠さないための安全境界です。resolverを無効化する場合は、対応するHTTP endpointとAPI keyも同時に削除してください。全キーと入力制約は `02_Architecture/runtime_parameter_registry.md` を参照してください。


## 障害診断時の共有境界

障害対応時のログ共有は、次の境界を満たす場合のみ許可します。

- 共有可: 発生日時、URL（機微部分を除去）、エラー種別、HTTP status、SafeMode状態、再現手順。
- 共有禁止: API key、token、password、未マスク本文、個人情報、生の監査イベント。

復旧時は、先に原因を決めつけず、計画、実行、確認の順で進めます。endpointや組織内識別子を共有する必要がある場合は、必要性を確認し、機微部分を最小化してから共有します。

承認と実行の責務は分離します。

- 判断する人: 共有範囲とマスク方針を決める。
- 実行する人: マスク済みログの作成と送付を行う。

誰が判断するか不明な場合は、ログ共有を止めて [operations.md](operations.md) の停止条件に従います。

### アプリケーションログの PII 方針

アプリケーションログも監査イベントと同じPII最小化方針に従います。**主体識別子（`subject`）・外部テナント参照（`external_tenant_ref`）などのIdP由来の生値をログに含めません。**不具合診断で識別子が必要な場合は、ハッシュ化した値または最小化した断片のみを扱います。

## 保持してよい情報、避ける情報

| 区分 | 例 | 方針 |
| --- | --- | --- |
| 保持してよい | ドキュメント本文、カード、島、レビュー状態 | 通常データとして扱う |
| 最小保持 | 表示名、メールアドレス、外部 identity 参照 | 必要最小限にする |
| 一時利用 | roles, groups, policyRef, trace id | 永続化しない前提で扱う |
| 禁止 | password, token, secret, raw assertion | 保存、ログ、export に含めない |

export、share、障害調査でどの情報を削るか迷う場合は、[data_handling.md](data_handling.md) のチェックリストを使います。

## セキュリティ確認チェックリスト

- [ ] LLM providerが意図した値になっている。
- [ ] large-scaleを使う場合、opt-inとallowlistが設定済み。
- [ ] API keyやaudit tokenをリポジトリに含めていない。
- [ ] SafeMode中に外部サービスとの共有を許可していない、または許可理由を記録している。
- [ ] share/exportの出力に秘密情報や内部メモが混ざっていない。
- [ ] access control障害時のfail-safeが `read_only` など保守的な値になっている。
- [ ] `external_http` を使う場合、PDPの接続先（endpoint）を同時に設定し、設定検証を通過して起動している。
- [ ] Document policy binding / tenant capability resolverを`external_http`にする場合はendpointが設定され、`none`にする場合はHTTP endpoint・API keyが残っていない。

## 迷ったときの判断

- 外部サービスと共有する必要が説明できない場合は共有しない。
- 秘密情報が含まれる可能性がある場合は、先に入力データを減らす。
- SafeModeの緩和が必要に見える場合は、実装変更ではなく運用上の例外として扱う。
- 障害時の挙動が分からない場合は、読み取り専用またはLLM disabledに倒す。

## 役割と記録の考え方

組織内の正式な役職名に関係なく、少なくとも次の責務を分けて考えます。

- 安全性を判断する人: SafeMode、外部サービスとの共有、share/exportのリスクを確認する。
- 業務上の必要性を判断する人: なぜ変更や共有が必要か、利用者にどの影響があるかを確認する。
- 設定を実行する人: 設定変更、復旧、実行結果の記録を担当する。

同じ人が複数の責務を担う場合でも、記録上は「誰が判断し、誰が実行したか」を分けて残します。

## 関連文書

- [configuration.md](configuration.md)
- [data_handling.md](data_handling.md)
- [security_operational_guidelines.md](security_operational_guidelines.md)
- [operations.md](operations.md)
- [THREAT_MODEL.md](https://github.com/hat47x/sui-sensemaking/blob/main/THREAT_MODEL.md)
