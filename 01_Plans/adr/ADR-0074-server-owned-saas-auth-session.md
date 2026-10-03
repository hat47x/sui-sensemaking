# ADR-0074: SaaS active tenantをserver-owned認証sessionへ束縛する

- Status: Accepted
- Date: 2026-08-11
- Accepted: 2026-08-13（**案2 server-owned BFF sessionを採用**。保守者による明示承認。仮承認ではない）
- Deciders: Maintainer（承認2026-08-13。ドッグフーディングループの承認方針に基づく。「Acceptance Gate回答案」節の4項目を含め、個別確認なしで承認）
- Source Issue: `SAAS-TENANT-SESSION-BINDING-01`
- Scope: `03_Implement/backend/`, `03_Implement/frontend/`, Identity Broker連携、SaaS session persistence

## Context

`ADR-0061` は、active tenantと `tenantSessionVersion` を、認証session単位で原子的に解決して更新すると決めた。しかし現行の実装は、`principal_id` を共有DBの主キーとし、versionだけを保存する。選択したtenantは保存されず、同じprincipalの別sessionも分離できない。versionのcookieも、DBの参照やanti-forgeryの検証には使われない。

単に列を追加するだけでは解決しない。requestから「同じブラウザの認証session」を、サーバーが信頼できる形で識別する入力が必要である。access tokenの `jti` はtokenの識別子である。通常の連続したrequestやrefresh後も続くlogin sessionの識別子ではないため、流用しない。

比較した案は次の3つである。

1. BrokerのOIDC `sid` 相当のclaimをBearer access tokenへ含め、`issuer + sid` をsession keyにする。OP sessionを表す不透明なIDという意味は適合する。ただし、標準の `sid` の提供先は主にID TokenとLogout Tokenであり、access tokenへの搭載はBroker固有の契約になる。token更新時の継続性、session fixation、logout通知も、Brokerごとに検証が必要である。
2. BFFがOAuth clientとtokenを保持し、ブラウザにはHttpOnlyでSecureなcookieで、server-ownedなsession IDだけを渡す。API request、active tenant、version、logoutを、同じserver sessionへ束縛できる。ただし、現行の「SPAがBearer tokenをメモリに保持してAPIへ直接送る」方針を変更する。
3. tenantを切り替えるたびに、Brokerからtenant別のtokenを再発行する。DBのsessionを正本とする部分は減る。しかし、切り替えのUIが認証のリダイレクトに依存し、複数Brokerのclaim更新と失敗時の状態が複雑になる。

参考にした仕様は次の2つである。OpenID Connect Back-Channel Logout 1.0は、`sid` を、issuer内で一意なUser Agentまたは端末の不透明なsession IDとして定義する。OAuth 2.0 for Browser-Based Applicationsの現行のIETF draftは、BFFを、ブラウザからtokenを隠し、全API requestをbackend経由にする最も強い構成として整理している。

## 採択記録（2026-08-13）

保守者の明示承認により、ProposedからAcceptedへ変更した。**案2のserver-owned BFF sessionを採用**する。下記のDecisionの7項目が、そのまま実装の要件になる。

### 実装の解禁

本ADRを採択したことで、**1つの判断で3本のOpen P1が同時に着手できる**ようになる。

| issue | 本ADRが与える前提 |
|---|---|
| `OPS-SAAS-SCALE-01`（Open P1） | AC-4〜8 が未達で、本ADRを待っていた。sessionを失効させる際の正本が、DB側の `session_key_hash` の行に定まることで、水平スケール時の失効の伝播を設計できるようになる |
| `SAAS-TENANT-SESSION-BINDING-01` | 詳細なデータとAPIの修正の正本。本ADRの Decision 3（session rowのキー設計）が前提になる |
| `AUTH-ONE-TIME-JWT-01` | Decision 7（access tokenの `jti` をsessionの主キーへ流用しない）が、方針を確定させる |

### 採択時に確認した現行実装との差分

現行の `saas_tenant_sessions`（`models.py`）は、`principal_id` をキーとし、versionだけを保持する。本ADRの採択は、次の3点を**破壊的変更として認める**ことを含む。

1. `principal_id` 主キーから `session_key_hash` 主キーへ変える（別の端末が干渉しないようにするため。Decision 3）
2. SPAからのBearerの直接送信を廃止し、HttpOnly cookieとanti-CSRFへ移行する（Decision 2/5）
3. logoutは、提示されたsessionだけを失効させる。全sessionのlogoutは、明示的な別の操作とする（Decision 6）

`research/direction-review-2026-08-13.md` は、「session model is principal-scoped, not session-scoped」として、次の問題群を記録した。

- 別のブラウザや端末で、切り替えとログアウトが干渉する
- 次のrequestで、JWTのclaimのtenantへ戻り得る
- cookieがDBの行と照合されない
- 行が失効しない

これらはすべて1の帰結であり、本採択がその根本的な対策にあたる。

## Decision（採択済み）

**案2のserver-owned BFF sessionを採用する。**

1. sui-sensemakingまたは同一のtrust boundaryにあるgatewayをconfidentialなOAuth clientとし、access tokenとrefresh tokenをブラウザへ渡さない。
2. ブラウザには、128ビット以上のエントロピーを持つ不透明なsession IDを、HttpOnly、Secure、SameSite=LaxまたはStrictのcookieで発行する。DBには、生のcookie値ではなく、鍵付きのハッシュを保存し、鍵のローテーション手順を持つ。
3. session rowは、`session_key_hash` を主キーとし、次の項目を保持する。`principal_id`、`issuer`、`subject`、`active_tenant_id`、`tenant_session_version`、作成時刻、最終利用時刻、絶対的な失効時刻、失効の状態。tenantのmembershipとcapabilityは、requestごとに正本を再確認し、sessionのスナップショットだけで許可しない。
4. active tenantの変更は、session rowの現在のtenantとversionを条件に、membershipを再確認した後でCAS更新する。同じsessionの全タブだけが新しいversionへ進み、同じprincipalの別sessionへは波及しない。
5. 状態を変更するrequestには、OriginとHostの検証に加えて、sessionへ束縛したanti-CSRF tokenを要求する。SameSite cookieだけを、唯一のanti-forgeryの境界にしない。
6. logoutは、提示されたsessionだけを失効させる。全sessionのlogout、管理者による失効、OIDC back-channel logoutは、明示的な別の操作とする。これらは、`issuer + subject`、または検証済みの `issuer + sid` の索引から、対象のsessionを失効させる。
7. access tokenの `jti`、tenantのclaim、principal ID、clientが入力したsession IDを、sessionの主キーへ流用しない。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 利用者は、1つのログインセッションの中でactive tenantを切り替える。連動するのは同じsessionのタブだけである。別のブラウザや端末での作業は維持される | ログアウトのUIは、「このセッション」と「全端末」を区別する。切り替えの際は、同じsessionの他タブへ影響することの説明を維持する |
| **データ設計** | active tenantとversionを、server-ownedなsession rowへ原子的に保存し、principal、token、tenantのclaimとは別のキーにする | cookieの生値、token、versionを、監査の本文へ保存しない。membershipの停止、失効、期限切れの場合は、rowが残っていても利用を拒否する |
| **機能設計** | BFFがOAuth tokenを保持し、ブラウザのrequestを、session cookieとanti-CSRFで受ける。切り替えはCASで行い、全tenant APIは、resourceを参照する前にversionを照合する | SPAからのBearerの直接送信を廃止する。session bootstrap、refresh、logout、back-channel logout、複数のworkerを、同じ失効の正本へ接続する |

### 三要素間の牽制結果

- 業務上必要な「別の端末が干渉しない」ことは、principalを主キーにすることを禁じ、データ設計へsession固有のキーを要求する。
- データ上のactive tenantの正本は、機能設計へ、tokenのclaimより先にsession rowを解決し、その後でmembershipを再確認する順序を要求する。
- cookie認証にするとCSRFが新たに生じる。機能設計のOriginとHostの検証、およびanti-CSRFの検証がなければ、業務上の安全な切り替えを満たせない。

## Consequences

- XSSの際にtokenを盗まれる範囲を縮小でき、active tenant、version、logoutを、同じserver sessionへ束縛できる。
- OAuth callback、tokenのrefresh、BFFのプロキシ、CSRF、sessionの有効期限、鍵のローテーション、logoutの連携について、実装と運用が増える。
- `ADR-0064` の「SPAがJWTをメモリに保持し、HttpOnly cookieとの二重管理は採用しない」という選択を、本ADRがAcceptedになった時点で置き換える。Proposedの間は、現行の方針を変更しない。
- 現行の `saas_tenant_sessions` は、既存の行のまま意味を変えない。新しいテーブルへexpandとバックフィルを行うことはできない（既存の行から、sessionの所有関係を復元できないため）。そのため、cutover、旧テーブルの削除という段階的な移行とする。cutoverの際は、既存のSaaSのloginを再認証させる。

## Acceptance Gate

本ADRをAcceptedへ変更する前に、次をMaintainerが確認する。

- BFFをsui-sensemakingのbackendへ内蔵するか、同一のtrust boundaryにあるgatewayの責務にするか。
- cookieのdomainとpath、SameSite、CSRFの方式、絶対的なタイムアウトと無操作タイムアウト、refresh tokenの保管と暗号鍵の管理。
- Brokerごとのlogout連携の範囲と、back-channel logout非対応の場合の、全sessionの失効手順。
- SPAからのBearerの直接送信を前提とする、既存のE2E、CORS、運用手順の移行範囲。

## Rejected for this proposal

- **Brokerの `sid` をすぐに採用する**: 現行のAPIが受けるaccess tokenには、標準で必須ではない。Broker固有のclaim契約を、共通の安全境界にすることになるため、見送る。BFFの内部で、検証済みのlogout相関値として使う余地は残す。
- **principal単位のまま、active tenantの列だけを追加する**: 別sessionが干渉しないという条件を満たさない。
- **version cookieをsession IDへ昇格する**: 現在は、サーバーによる所有の検証なしに発行されており、active tenantの正本とも結び付かない。移行時に、新規のsessionとして再発行する。

## Acceptance Gate 回答（2026-08-13、Maintainer承認済み）

Maintainerの要請により、以下の4項目への回答案を作成し、個別確認なしで承認された（上記のDecidersを参照）。本節が、「Acceptance Gate」を満たした正式な内容である。

### 回答案1: BFFの配置はsui-sensemaking backend自身に内蔵し、別gatewayは新設しない

根拠は次のとおり。

- `main.py` に `CORSMiddleware` が存在しない。これは、現状が同一originまたはリバースプロキシを前提とした構成であることを示す。BFFを内蔵すれば、OAuth callback、cookieの発行、APIの呼び出しがすべて同一originのまま維持され、**新規のCORS設定が不要**になる。
- `ADR-0072` でも、同種の論点（D1=C「ネットワーク分離gateway」）を、「単一プロセスを前提とする現行構成から乖離する」という理由で見送り、アプリ内認可（D1=A+B）を選んだばかりである。同じ理由が、BFFにも当てはまる。
- 別のgatewayを新設すると、デプロイ構成、TLS終端、ヘルスチェック、監視の対象が増える。個人OSSでプレリリース段階（`ADR-0039`）が求める、複雑さの予算に見合わない。

### 回答案2: cookie、CSRF、タイムアウト、鍵管理は、既存のcookie属性を継承し、寿命は提案値として明示する

既存の `tenantSessionVersion` cookie（`active_tenant_session.py:259-265, 336-342`）は、すでに `httponly=True`、`secure=<local-dev以外でTrue>`、`samesite="strict"`、`max_age=3600` を採用している。新設する認証session cookieも、この属性をそのまま継承することを提案する。

- **domainとpath**: `Path=/` とする。`Domain` 属性は付与しない（発行元のoriginに限定し、サブドメイン間では共有しない）。
- **SameSite**: `Strict`（既存を踏襲）。BFFが受けるOAuth callbackは、Brokerからの、GETによるリダイレクトの応答である。そこでの `Set-Cookie` は、SameSite属性の影響を受けない（SameSiteが制限するのは「そのcookieを添えて送るか」であり、「受け取れるか」ではない）。したがって、Strictのままcallbackを処理できる。
- **CSRFの方式**: sessionのcookieへ束縛した同期トークンを提案する。tokenは、HttpOnlyでない別のcookieまたはresponse bodyで払い出す。状態を変更するrequestでは、headerで送らせて一致を検証する。SameSite=Strictを主な防御、tokenの検証を第二の防御とする、多層防御にする。
- **絶対的なタイムアウトと無操作タイムアウト（提案値、要確認）**: sessionの絶対的な寿命は **12時間**、無操作による失効は **60分** とする。既存の `tenantSessionVersion` の `max_age=3600`（1時間）と、無操作の60分は整合する。絶対的な12時間は、「1営業日ごとに必ず再認証させる」運用を意図した値である。コンプライアンスの要件によって、調整できる提案値である。
- **refresh tokenの保管と暗号鍵の管理**: refresh tokenは、BFFのプロセスの外（ブラウザ）へは一切渡さない（本ADRの決定1に整合）。DBへ保存するときは、対称鍵暗号（AES-GCMなど）で暗号化する。鍵は、プロセスの起動時に、既存の `SUI_*` 環境変数の規約に沿って注入する。鍵のローテーションの手順は、別の運用issueで定義する（本ADRのスコープ外とする）。

### 回答案3: Brokerごとのlogout連携の範囲は、Keycloakのback-channel logoutを優先し、非対応のBrokerには既存の決定6のフォールバックを適用する

- `ADR-0064` のPhase 2が推奨するBroker（Keycloak）は、OIDC Back-Channel Logout 1.0に対応している。そのため、`sid` 相当のsession識別子を受け取れる場合は、back-channel logoutの通知経路を実装する。
- back-channel logoutに非対応のBrokerでは、本ADRの決定6がすでに規定する「`issuer + subject` の索引からの全sessionの失効」を、汎用のフォールバックとする（新規の提案ではなく、本文の既存の決定を、そのまま適用する）。
- Phase 2（実Brokerとの連携）に着手するまでは、mock IdPとSPのハーネス（`tests/level2/mock_idp.py`）へ、back-channel logoutの模擬要素を追加する。フロントエンドを実装せずに、契約だけを先に固定する。

### 回答案4: 既存のE2E、CORS、運用手順の移行範囲

回答案1（BFFを内蔵する）を採る場合、**CORS設定の新規追加は不要**である。影響を受ける既存の資産は次の3点である。

- **SaaS向けのE2E**（`playwright.saas.config.ts`、`tenant_session_multitab.spec.ts` など）: 現状は、`Sui-Sensemaking-Tenant-Session-Version` ヘッダーとmockのsession objectを、直接注入している。BFFへ移行した後は、OAuth callbackを経由してcookieを発行する経路を模擬するように、書き換える必要がある。
- **Level 1/2のテストハーネス**（`tests/federation/mock_sp.py`、`tests/level2/mock_idp.py`）: 現状は、JWTを `X-Sui-Sensemaking-Authorization` ヘッダーで直接転送する構成である（`ADR-0064` D4-4）。BFFへ移行した後は、「BFFがtokenの交換を代行し、ブラウザにはcookieだけを返す」経路へ拡張する必要がある。
- **frontendの `api/client.ts`**: 現状のBearerヘッダーの送信から、cookieの送信（`credentials` の指定）へ切り替える必要がある。tenant sessionの前提条件ヘッダー（`Sui-Sensemaking-Tenant-Session-Version`）自体の扱いは、維持できる。

## Traceability

- Derived-from: `01_Plans/adr/ADR-0061-saas-active-tenant-session-concurrency.md`
- Related: `01_Plans/adr/ADR-0064-saml-oidc-broker-jwt-coordinated-auth-flow.md`
- Implementation issue: `01_Plans/issues/done/issue-SAAS-TENANT-SESSION-BINDING-01-principal-keyed-session-state.md`
- Standards: OpenID Connect Back-Channel Logout 1.0, OAuth 2.0 for Browser-Based Applications (IETF draft)
