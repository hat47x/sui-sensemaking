# ADR-0063: saas-multitenant の trusted auth edge を broker 前提の multi-issuer JWT 検証で実装する

- Status: Accepted
- Date: 2026-08-06
- Implemented: 2026-08-08 (D9-1 through D9-8)
- Deciders: Project Maintainer
- Scope: `03_Implement/backend/src/sui_sensemaking_api/`（`auth_context.py` / `tenant_context.py` / `trusted_saas_runtime.py` / `main.py` / `settings.py` / `models.py`）、`02_Architecture/`、`saas-multitenant` runtime profile

## Context

`ADR-0059` D5は「active tenantは署名・issuer・audienceを検証したclaimから解決する」と固定し、`ADR-0020` は「認証プロトコルはアプリに実装せず前段IAPへ委譲する」と固定した。しかし両者の交点——**実HTTPリクエストのcredentialを検証して `VerifiedTenantClaim` を作る層**——だけが未実装で、`saas-multitenant` profileは `settings.py:425` の無条件 `ValueError` で起動を拒否され続けている。`SAAS-TENANT-01` のAC-4/6/7/8/9/10/12/13はここで止まっている（`issue-SAAS-TENANT-AUTHEDGE-01`）。

### 実装済みの範囲（コード確認結果 2026-08-06）

想定より多くが既に存在する。本ADRのスコープはその差分だけである。

- `resolve_verified_claim_tenant_context()`（`tenant_context.py:150`）は完成しており、providerのissuer/audience一致、`tenant_identity_providers` のactive、`(identity_provider_id, subject)` の一意性と `user_id` 一致、membership activeを全て検証してdenyする。unit test済み（`test_verified_tenant_context.py`）。
- `resolve_trusted_saas_request_session()`（`saas_request_context.py:51`）はidentity → tenant → recheck → capabilityまでのrequest pipelineを実装済みである。
- `routes/docs.py:196` の `_authorize_request()` は `tenant_session_precondition_required(request)` で分岐し、SaaS経路では既に上記pipelineを呼ぶ。
- `main.py:73/85/94` のlifespanは `validate_trusted_saas_runtime_preflight()` / `initialize_trusted_saas_runtime()` / `release_trusted_saas_runtime()` を呼んでいる。

### 起票時の前提に対する訂正（本 ADR で確定させる事実）

1. **`install_trusted_saas_runtime()` の呼び出し元はゼロだが、`initialize_trusted_saas_runtime()` は `main.py` から呼ばれている。** 欠けているのは「adapter bundleをinstallする側」だけである。`install_` も `_trusted_saas_runtime_preflight()` も `_sui_sensemaking_runtime_started` が立った後の実行を拒否するため、installはlifespanの中ではなく `app = FastAPI(...)` 直後のmodule scopeで行う必要がある。issue AC-3はこの粒度で読む。
2. **`TRUSTED_PROXIES` は実装されていない（2026-08-06時点）。** `03_Implement/backend/src` に該当コードは無く、`ADR-0020` §3-1は未達のままである。`resolve_identity_context()` はproxy allowlistなしで `X-Forwarded-User` 等を読む。したがって「trusted proxy判定は既存」という前提でSaaSを設計できない。これはsingle-tenant profile側にも残る別gapであり、本ADRでは解決せずfollow-upとして明示する。**2026-09-07訂正**: 本ADRと同一コミット（`161c2223`）で`_check_trusted_proxy()`（`auth_context.py`、`SUI_TRUSTED_PROXIES`設定によるCIDR allowlist）が実装され、`resolve_identity_context()`の先頭で呼ばれている。single-tenant側のgapは解消済みである（下記「Consequences」の訂正も参照）。ただしこの事実は本ADRのD2判断（SaaS向けにheader modeを拒否しJWT検証を必須にする）を変更しない——D2の理由はCIDR設定ミス1つで全tenant越境になる点と、暗号的証拠なしに`resolved_by="verified_claim"`を名乗れない点の2つであり、後者はTRUSTED_PROXIES実装の有無と無関係に成立する。
3. **Level 2のmock IdPはJWTを発行していない。** `tests/level2/mock_idp.py` の `/oidc/token` はclaimのJSON dictを返すだけで、署名もJWKS endpointも無く、`mock_sp.py` はそれを平文headerへ写している。`ADR-0020` §6のharnessはheader mapping fixtureであり、暗号的なIdPスタブではない。SaaSのe2eにはこのharnessを骨格として **実署名とJWKSを足す** 必要がある。
4. **`identity_providers` / `tenant_identity_providers` にtrust materialが無い。** 現在の列は `identity_providers(id, issuer, audience, lifecycle_state, created_at, updated_at)` と `tenant_identity_providers(tenant_id, identity_provider_id, lifecycle_state, created_at, updated_at)` だけである。protocol判別列もJWKS URIも署名鍵も外部org参照も無い。「protocol非依存で既に存在する」は「protocolが名指しされていない」という意味であって、どの選択肢を採ってもmigrationは必要である。
5. **`TenantContextResolver.resolve()` は `request` もclaimも受け取らない**（`def resolve(self, *, db, user_id)`）。検証済みclaimをidentity層からtenant層へ渡す経路が型として存在しない。これはissueのACに書かれていない未認識のblockerである。

### なぜ今この判断が必要か

`ADR-0047` の再起票基準R-1〜R-4に該当する新規論点ではなく、`ADR-0059` のImplementation gateがfollow-upとして明示的に残した決定の消化である。同時にAGENTS.md §6の「安全境界変更」「複数の合理的選択肢が残る」に該当する。判断を先送りするコストは既に顕在化しており、issueによれば同一文言の実装チェックポイントが30箇所以上反復されている。

## Decision

### D1: multi-IdP は upstream identity broker で吸収し、アプリは single-issuer を前提としない multi-issuer 検証として実装する

`saas-multitenant` の本番構成は、**顧客ごとのIdP（Okta / Azure AD / SAML IdP等）を1つのidentity brokerが集約し、sui-sensemakingへは単一issuer・単一audienceのJWTとtenant識別claimを渡す**構成を前提とする。broker製品は固定しない（Keycloakのidentity brokering、Authentik、WorkOS、Auth0 Organizations等はいずれもこの形をとる）。

これは `ADR-0020` の再決定ではない。`ADR-0020` が禁じたのは「アプリがSP/RPとしてredirect / callback / assertion交換を行うこと」であり、brokerモデルはその責務境界をそのまま保つ。tenantごとのIdP差異はbrokerの設定で吸収され、アプリのコード分岐にはならない——`ADR-0020` §3-3の「provider差異は設定で吸収し実装分岐を増やさない」と同じ原則の延長である。

ただしアプリ側実装は **issuerをハードコードせず、検証済みissuerから `identity_providers` 行を引くmulti-issuer構造**とする。理由は、(a) `resolve_verified_claim_tenant_context()` が既に `identity_provider_id + issuer + audience` を受け取る形になっておりsingle-issuer前提の方がむしろ不自然、(b) broker移行・並行運用・staging併存で複数issuerは現実に発生する、(c) 将来tenant自己申告IdPを許す場合に検証コードではなく **trust materialの登録経路だけ**が変わる、の3点である。

v1では `identity_providers` 行の作成をPlatform Control Plane（`ADR-0059` D9）の運用者操作に限定し、tenant adminからのself-service登録は提供しない。**アプリが信頼する鍵の出所をtenant編集可能なデータにしない**ことが、この段階で守るべき唯一の線である。

### D2: `saas-multitenant` では JWT 検証を必須とし、平文 header mode を起動時に拒否する

- `ADR-0020` §3-2の2 modeのうち、SaaS profileが受理するのは `jwt_header` だけとする。`header` modeは設定検証で拒否する。
- 理由: single-tenantではheader modeの信頼境界は「1組織のproxyを正しく置いたか」であり組織内リスクに閉じるが、shared SaaSではtrusted proxy設定の1箇所のミス・header除去漏れが即座に全tenant越境になる。起票時点（訂正2）では `TRUSTED_PROXIES` も未実装で、network配置と `SUI_API_KEY` 以外の境界が無かった（**2026-09-07訂正**: 本ADR起票と同一コミットで実装済み。CIDR設定ミス1つが全tenant越境になる点自体は変わらず、この理由の結論には影響しない）。
- `TenantContext.resolved_by = "verified_claim"` と `VerifiedTenantClaim` のdocstringが要求する「署名・issuer・audience検証済み」を満たすには暗号的証拠が要る。header modeではこの契約を型どおりに満たせない。
- `trusted_host_mapping`（tenant別subdomain等）は `TenantResolutionMethod` に予約されているが、本ADRでは実装対象外とする。

### D3: protocol 範囲は OIDC/JWT のみとし、SAML はアプリに実装しない

- v1のアプリ側検証はJWS署名付きJWT bearerだけを対象とする。
- SAML tenantはbrokerがSAML→OIDCへ変換して収容する。D1を採る限り、**SAML対応は運用構成で達成でき、アプリにXML署名検証（`xmlsec1` native依存、canonicalization、XML Signature Wrapping対策）を持ち込む必要が無い**。「OIDC先行かSAML同時か」というissueの問いは、brokerモデルを採った時点で「アプリ側はOIDCのみでSAML顧客も収容できる」に解消される。これはD1を選ぶ積極的な理由でもある。
- ただしmigrationでは `identity_providers.protocol` 判別列を今回同時に追加し、既定値 `oidc`、受理値はv1では `{oidc}` のみ、未知値はfail-closedで拒否する。将来SAML行を足すときに破壊的migrationを起こさないための最小の先回りであり、実装は増やさない。

### D4: JWT 検証は PyJWT + cryptography、JWKS 取得は既存の trusted HTTP 規約に従う

- 検証ライブラリは **PyJWT（+ `cryptography`）** を推奨する。`decode()` が `algorithms=` を必須引数として要求し、`audience=` / `issuer=` が第一級であるため、algorithm confusionと検証漏れがAPIの形で防がれる。用途に対してscopeが最も狭い。
- `python-jose` は不採用とする。3.3.0（2021）から3.4.0（2025）まで実質的なreleaseが無く、CVE-2024-33663（algorithm confusion）/ CVE-2024-33664（JWE展開DoS）の修正まで数か月〜年単位を要した。solo OSSがsecurity応答をこのlatencyの依存に預けるべきではない。
- `Authlib` は保守されているが、必要なのは「検証1関数」であるのにOAuth1/2 + OIDCのclientと **server** を含むframework全体を抱えることになる。`ADR-0020` の「protocol実装責務をアプリへ持ち込まない」に逆行する。同著者の `joserfc`（JOSEに絞った後継）はPyJWTの代替として許容範囲とする。
- **`PyJWKClient` の内蔵fetcherは使わない。** `urllib.request` で直接取得するため、`settings._validate_trusted_http_endpoint()` のendpoint正準化・loopback以外HTTPS必須・credential/query/fragment禁止、および `ADR-0062` が固定した「明示した外部連携は完全設定を起動条件にする」規約の外側に出る。JWKS取得は既存の `httpx` ベース外部HTTPと同じ規約（endpoint検証・timeout上限・秘密値非出力）で実装し、取得したJWK setから鍵を組み立ててPyJWTへ渡す。
- 検証時の固定制約: algorithm allowlistは `RS256,ES256` 既定の設定値とし、`none` とHMAC系は常に拒否。token headerの `jku` / `x5u` / 埋め込み鍵は一切参照しない。`kid` は取得済みJWK set内でのみ解決する。clock skewの許容は60秒固定（設定にしない）。
- 採用確定前に、PyJWTと `cryptography` の最新advisory / release状況を再確認する。

### D5: JWKS のキャッシュと鍵ローテーション

`identity_provider_id` 単位でキャッシュし、次を既定とする（いずれも設定可能、上限あり）。

- 正常TTL 600秒。
- 未知 `kid` を受けた場合、cooldown 60秒を満たしていれば1回だけ強制refreshする。providerごとにin-flight refreshは1本に制限する。cooldownを置かないと、ランダムな `kid` を送るだけでIdPのJWKS endpointへの増幅攻撃になる。
- refresh失敗時は最後の既知JWK setを **最大1800秒まで**返す。超過したら「検証不能」として扱う（D6）。無期限のstale継続はしない。
- stale供給は「どの署名鍵を受理するか」だけに作用し、`exp` / `iss` / `aud` / `alg` / membershipの検証は一切緩めない。IdPは通常ローテーション時に新旧鍵を重ねて公開するため、1800秒はIdP側のoverlapを超えない範囲の有界なリスクである。
- 署名検証を省略するfallback、token由来の鍵の採用は、いかなる状況でも行わない。

### D6: identity 検証が不能なときは deny 固定とし、fail-safe mode 設定を設けない

`access_control_fail_safe_mode` に `read_only` があるのは、PDP障害時でも **principalとtenantは判っていてcapabilityだけが不明**だからである。identity層にはこの縮退が成立しない。検証できないとき不明なのは「誰か」と「どのtenantか」そのものであり、あらゆるfallbackは「未検証のprincipalをどこかのtenantのデータへ入れる」に等しい。`ADR-0059` D5もtenant不明時はreadを含めてdenyとしている。

したがってidentity検証にはfail-safe mode設定を **作らない**。「設定可能にする」は、正しい運用が一つも選ばないはずの構成を作ることであり、`ADR-0062` が扱った「安全に見える縮退設定そのものが危険」と同じ失敗である。可用性の予算はD5の有界stale windowに一本化して支出する。

応答の分離（内部監査には正確な理由codeを残し、外部には最小限を返す）:

- header欠落 / 署名不正 / `iss` `aud` `alg` `kid` 不一致 / 期限切れ → `401`。どの検証で落ちたかを外部へ区別させない単一のopaque codeとする。
- JWKSがmax-staleを超えて取得不能 → `503` + 専用code。accessを与えない点は同じだが、運用者が「攻撃」と「外部障害」を区別できるようにする。tenantの存在を示唆する情報は含めない。
- 検証成功・subject未登録 → `403` `identity_not_provisioned`（既存）。SaaS profileは `allow_jit_provisioning=false` が必須（`TrustedSaasRuntimePolicy.validate()`）なので、**auth edgeは `users` / `user_identities` を一切書かない**。provisioningは `POST /admin/provision/users` とTenant Admin `membership.provision` の責務である。
- 検証成功・membership不成立 → `403` `tenant_context_untrusted`（既存）。

### D7: 検証済み claim は `ResolvedIdentity` に載せて明示的に受け渡す

訂正5の型の穴を、次の最小変更で塞ぐ。

- `ResolvedIdentity` に `verified_tenant_claim: VerifiedTenantClaim | None = None` を追加する（既定値ありのためsingle-tenant経路は無変更）。
- `TenantContextResolver.resolve()` を `resolve(self, *, db, user_id, claim: VerifiedTenantClaim | None = None)` へ広げる。呼び出し元は `saas_request_context.py:106` と `routes/docs.py:215` の2箇所だけである。
- `contextvars` などの暗黙のrequest-scope側チャネルは採らない。安全境界のデータ経路は型で追えることを優先する。
- `resolve_verified_claim_tenant_context()` は **変更しない**。既存のunit testの証明価値をそのまま残す。

### D8: tenant claim は tenant の「要求」であって権限ではない

- tokenのtenant claimは「どのtenantとして振る舞いたいか」の表明にすぎず、権限の根拠は常にDB側の `tenant_identity_providers` + `user_identities` + `tenant_memberships` である。これは既に `resolve_verified_claim_tenant_context()` が実装している性質であり、broker共有issuer構成でも越境が成立しないことの根拠になる。
- claimが運ぶのはsui-sensemaking内部IDではなく **外部organization参照**とする。`tenant_identity_providers` に `external_tenant_ref` 列を追加し、`unique(identity_provider_id, external_tenant_ref)` を張って `tenants.id` へ写す。理由は、(a) 運用者にIdP設定へsui-sensemakingの内部IDを書かせない、(b) `ADR-0059` D5/D10の「`tenants.id` はopaque・外部へ出さない」を保つ、(c) 共有brokerでは `tenant_identity_providers` 行が単なるN:1の飾りになってしまうところに実データを持たせられる、の3点である。
- tenant claimが無いtokenはdenyする。membershipが1件だけなら推定する、という縮退は入れない。`resolved_by="verified_claim"` は「検証済み証拠から解決した」を意味しなければならず、複数membership利用者のtenant切替は `ADR-0061` のtenant sessionと `select_active_tenant_context()` が既に扱う別経路である。

### D9: 実装スコープと起動拒否の解除条件

**いま作る**（この順で1本の変更として実行可能な粒度にしてある）:

1. migration: `identity_providers` に `protocol` / `jwks_uri`、`tenant_identity_providers` に `external_tenant_ref` を追加する。`jwks_uri` は書き込み時に `_validate_trusted_http_endpoint()` 相当で検証する。
2. JWKS key store（D4/D5）。
3. `SaasIdentityContextResolver` の具象実装（JWT検証 → subject照合 → 書き込みなし → `ResolvedIdentity` + claimを返す）。
4. `TenantContextResolver` の具象実装（claimを受けて既存 `resolve_verified_claim_tenant_context()` を呼ぶだけ）。
5. D7の型変更と2箇所の呼び出し元更新。
6. `main.py` のmodule scopeでprofileが `saas-multitenant` のときだけbundleを組んで `install_trusted_saas_runtime()` する。`settings.py:425` の無条件 `ValueError` は**削除ではなく差し替え**——既存の `TrustedSaasRuntimePolicy.validate()` にauth edge側の必須設定（mode、tenant claim名、algorithm allowlist、有効な `identity_providers` 行の存在）を加えたfail-closed検証にする。
7. Level 2 mock IdPにRS256実署名と `/jwks.json` を足す。鍵は `ADR-0020` §7のとおり起動時動的生成とし、平文コミットしない。
8. tenant A/B・同一docIdのHTTPレベルnegative matrix e2e。AC-4をresolver単体ではなくリクエスト経由で証明する。

**いま作らない**: アプリ内SAML、tenant self-serviceのIdP登録API/UI、SCIM、broker製品の同梱・選定、`trusted_host_mapping` 経路、複数brokerの同時運用手順。

**「実顧客がまだ居ない」ことの意味**: 決定を先送りする理由にはならない——先送りのコストは既に8件のAC停止と反復チェックポイントとして支払われている。一方で、顧客が居て初めて価値が出るもの（self-service onboarding、SAMLのアプリ内実装、複数broker、課金連動）は明確にdeferしてよい。上の8項目が1本の変更に収まらない規模へ膨らむなら、それは日程の問題ではなく設計が間違っている合図として扱う。起動拒否は8が通るまで維持し、その後も削除せず条件を絞る形で残す。

## Alternatives considered

1. **tenantごとにIAP/gatewayインスタンスを立てる（issue想定のAの素直な読み）**: アプリは最も単純になるが、tenant追加がinfra作業になり、SaaSの単位経済が壊れる。solo OSSが運用手順として要求できる現実味が無い。brokerモデルは同じapp側単純性を、gatewayを増やさずに得られる。
2. **tenantが自分のIdPを登録し、アプリがrequestごとにJWKSを取りに行く（B）**: 最終形としては妥当だが、v1で採ると「アプリが信頼する鍵の出所」がtenant編集可能データになり、tenant供給URLへのoutbound（SSRF面）、per-tenantの可用性依存、cache poisoningが同時に載る。D1は検証コードをmulti-issuerで作るため、trust materialの登録経路を差し替えるだけで後からBへ到達できる。**順序の問題であって排他ではない**と判断した。
3. **`header` modeをSaaSでも許し、`TRUSTED_PROXIES` を実装して境界とする**: 暗号的証拠なしに `resolved_by="verified_claim"` を名乗ることになり `ADR-0059` D5と整合しない。CIDR設定1行のミスが全tenant越境になる点もshared SaaSでは受け入れられない。**2026-09-07訂正**: `TRUSTED_PROXIES`（`_check_trusted_proxy()`）はその後single-tenant profile向けに実装済みだが、上記2点の却下理由（暗号的証拠の不在・CIDR誤設定の一発全tenant越境リスク）はいずれも実装の有無と独立に成立するため、本選択肢の却下判断は変わらない。
4. **アプリ内にSAML SPを実装してOIDCと同時提供**: `xmlsec1` native依存とXML署名検証の攻撃面を、brokerで代替できるのに抱え込むことになる。`ADR-0020` §2-Aで一度否決した構図の再現。
5. **identity層にも `fail_safe_mode` 設定を置く**: 「誰か不明でも通す」設定は正しい運用が選ばない。存在すること自体が誤設定の入口になる（`ADR-0062` の教訓）。
6. **`contextvars` でclaimを運ぶ**: 型変更を避けられるが、安全境界のデータ経路が暗黙になり、asyncでの取り違えを静的に検出できない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 顧客ごとのIdP（Okta/Azure AD/SAML等）をidentity brokerが集約し、sui-sensemakingへは単一issuer・単一audienceのJWTとtenant識別claimを渡す。broker製品は固定しない（Keycloak/Authentik/WorkOS/Auth0 Organizations等） | 機能: アプリはSP/RPとしてredirect/callback/assertion交換を行わない（ADR-0020の責務境界を維持）。データ: tenantごとのIdP差異はbroker設定で吸収しアプリのコード分岐にしない |
| **データ設計** | `identity_providers`行の作成はPlatform Control Planeの運用者操作に限定しtenant adminのself-service登録は提供しない。アプリが信頼する鍵の出所をtenant編集可能なデータにしない | 業務: アプリ側実装はissuerをハードコードせず検証済みissuerから`identity_providers`行を引くmulti-issuer構造。機能: migrationでtrust material列を追加 |
| **機能設計** | 実HTTPリクエストのcredentialを検証して`VerifiedTenantClaim`を作る層を実装。multi-issuer JWT検証（PyJWT+cryptography）。`TenantContextResolver.resolve()`はrequest/claimを受け取る形に署名変更 | 業務: IdP/JWKS障害時は1800秒猶予後に全面停止（可用性より機密性、ADR-0059の帰結）。データ: single-tenant挙動は既定値により無変更 |

## Consequences

- `saas-multitenant` の運用者はidentity brokerの設置・維持を負う。sui-sensemakingはその選定・同梱を行わない。
- SAML顧客はアプリのコード変更なしに収容できる。protocol差異の吸収点がbrokerに一元化される。
- 新規runtime依存が2つ増える（PyJWT、`cryptography`）。現在backendはJWTライブラリを一切持っていない。
- migrationが1本増える（`identity_providers` 2列、`tenant_identity_providers` 1列）。
- `TenantContextResolver` protocolの署名が変わる。呼び出し元は2箇所で、single-tenant挙動は既定値により無変更。
- `resolve_verified_claim_tenant_context()` と既存のunit testは無変更のまま流用され、AC-4の証明がresolver単体からHTTP経由へ拡張される。
- IdP/JWKS障害時、SaaS deploymentは1800秒の猶予の後に全面停止する。可用性より機密性を優先する `ADR-0059` の帰結をidentity層へも適用したことになる。
- `TRUSTED_PROXIES` 未実装は本ADRでは解消されない。single-tenant profile向けの独立したgapとして残る。**2026-09-07訂正**: このgapは本ADR起票と同一コミット（`161c2223`）で既に`_check_trusted_proxy()`として実装されていたが、本節の記述が同期されていなかった。`SUI_TRUSTED_PROXIES`未設定時は起動時警告付きで全origin許可（後方互換）、設定時はCIDR外接続元を`403 untrusted_proxy`で拒否し、`resolve_identity_context()`の先頭（forwarded headerを読む前）で必ず評価される。2026-09-07時点では専用回帰テストが無かったため、`tests/test_auth_context_resolution.py`へ6件追加した（未設定時許可・CIDR内許可・CIDR外拒否・client IP不明時拒否・不正形式IP拒否・信頼できないproxyからの完全なidentity headerセットも先頭で拒否されること）。既存のguardを一時的に無効化してこれらのテストが期待どおり失敗することを確認した上で復元済み。

## Non-goals

- `ADR-0020` の「アプリはOIDC/SAMLのhandshakeを実装しない」原則の変更。本ADRはbearer tokenの検証だけを扱い、redirect / callback / logout / step-upは前段の責務のまま維持する。
- broker製品の選定・推奨・同梱。
- tenantによるIdP自己登録、SCIM、deprovisioning自動化。
- `saas-multitenant` の起動拒否の解除そのもの（解除は `SAAS-TENANT-01` 側でD9-8の達成を確認してから判断する）。
- single-tenant profileの認証挙動の変更。

## Open questions for the maintainer

本ADRが承認を求めている論点は次の4つである。ここがredirectされればD2以降は組み替えになる。

> 2026-08-08: 全質問が D9-1〜D9-8 の実装をもって解決済み。ADR は Accepted。

1. **D1のbroker前提をSaaS運用の必須要件として運用者へ課してよいか。** → **Yes.** brokerモデルで実装。tenant登録型multi-IdPはv1ではdefer。
2. **D3のとおりSAMLをアプリに実装しないと確定してよいか。** → **Yes.** SAML顧客はbrokerのSAML→OIDC変換で収容。アプリにXML署名検証は導入しない。
3. **D4のPyJWT採用**（`Authlib` / `joserfc` ではなく）。 → **Yes.** PyJWT + cryptographyで実装。検証のみが必要なbrokerモデルに適合。
4. **D6の「identity層にfail-safe設定を作らない」**。 → **Yes.** identity検証不能時はdeny固定。D5の1800秒stale windowが唯一の可用性予算。

## Traceability

- Implementation: `01_Plans/issues/done/issue-SAAS-TENANT-AUTHEDGE-01-no-concrete-trusted-auth-edge-implementation.md`
- Implementation gate親: `01_Plans/issues/done/issue-SAAS-TENANT-01-tenant-context-and-storage-foundation.md`
- Derived-from: `01_Plans/adr/ADR-0059-saas-tenant-authorization-boundary.md`
- Related: `01_Plans/adr/ADR-0020-oidc-saml-mock-idp-sp-profile.md`（認証責務境界・Mock SP/IdP profile）
- Related: `01_Plans/adr/ADR-0061-saas-active-tenant-session-concurrency.md`（tenant sessionと切替の再認可）
- Related: `01_Plans/adr/ADR-0062-explicit-http-integration-fail-fast.md`（外部HTTP連携の完全設定要求）
- Related governance: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`, `01_Plans/adr/ADR-0047-design-decision-adr-saturation-and-execution-first.md`
- Runtime contract: `02_Architecture/runtime_parameter_registry.md`（新規 `SUI_*` キーは実装時に登録する）
- Schema contract: `02_Architecture/schemas.md`
- API contract: `02_Architecture/api.md`
- Security boundary: `THREAT_MODEL.md`, `04_Documentation/security.md`
