# ADR-0063: saas-multitenant の trusted auth edge を broker 前提の multi-issuer JWT 検証で実装する

- Status: Accepted
- Date: 2026-08-06
- Implemented: 2026-08-08 (D9-1 through D9-8)
- Deciders: Project Maintainer
- Scope: `03_Implement/backend/src/sui_sensemaking_api/`（`auth_context.py` / `tenant_context.py` / `trusted_saas_runtime.py` / `main.py` / `settings.py` / `models.py`）、`02_Architecture/`、`saas-multitenant` runtime profile

## Context

`ADR-0059` D5は「active tenantは、署名、issuer、audienceを検証したclaimから解決する」と固定した。`ADR-0020` は「認証プロトコルはアプリに実装せず、前段のIAPへ委譲する」と固定した。しかし、両者の交点にある、**実際のHTTPリクエストの認証情報を検証して `VerifiedTenantClaim` を作る層**だけが未実装である。そのため、`saas-multitenant` プロファイルは、`settings.py:425` の無条件の `ValueError` により、起動を拒否され続けている。`SAAS-TENANT-01` のAC-4/6/7/8/9/10/12/13は、ここで止まっている（`issue-SAAS-TENANT-AUTHEDGE-01`）。

### 実装済みの範囲（コード確認結果 2026-08-06）

想定より多くが、すでに存在する。本ADRのスコープは、その差分だけである。

- `resolve_verified_claim_tenant_context()`（`tenant_context.py:150`）は完成している。プロバイダのissuerとaudienceの一致、`tenant_identity_providers` がactiveであること、`(identity_provider_id, subject)` の一意性と `user_id` の一致、membershipがactiveであることを、すべて検証し、満たさなければ拒否する。単体テストも済んでいる（`test_verified_tenant_context.py`）。
- `resolve_trusted_saas_request_session()`（`saas_request_context.py:51`）は、identity → tenant → recheck → capabilityまでのリクエストのパイプラインを実装済みである。
- `routes/docs.py:196` の `_authorize_request()` は、`tenant_session_precondition_required(request)` で分岐する。SaaSの経路では、すでに上記のパイプラインを呼ぶ。
- `main.py:73/85/94` のlifespanは、`validate_trusted_saas_runtime_preflight()`、`initialize_trusted_saas_runtime()`、`release_trusted_saas_runtime()` を呼んでいる。

### 起票時の前提に対する訂正（本 ADR で確定させる事実）

1. **`install_trusted_saas_runtime()` の呼び出し元はゼロだが、`initialize_trusted_saas_runtime()` は `main.py` から呼ばれている。** 欠けているのは、「アダプタ一式を組み込む側」だけである。`install_` も `_trusted_saas_runtime_preflight()` も、`_sui_sensemaking_runtime_started` が立った後の実行を拒否する。そのため、組み込みはlifespanの中ではなく、`app = FastAPI(...)` の直後のmodule scopeで行う必要がある。issueのAC-3は、この粒度で読む。
2. **`TRUSTED_PROXIES` は実装されていない（2026-08-06時点）。** `03_Implement/backend/src` に該当するコードはなく、`ADR-0020` §3-1は未達のままである。`resolve_identity_context()` は、プロキシの許可リストなしで `X-Forwarded-User` などを読む。したがって、「信頼するプロキシの判定は既存」という前提でSaaSを設計できない。これはsingle-tenantプロファイル側にも残る別の欠落であり、本ADRでは解決せず、後続の課題として明示する。**2026-09-07訂正**: 本ADRと同じコミット（`161c2223`）で、`_check_trusted_proxy()`（`auth_context.py`、`SUI_TRUSTED_PROXIES` の設定によるCIDRの許可リスト）が実装されており、`resolve_identity_context()` の先頭で呼ばれている。single-tenant側の欠落は解消済みである（下記「Consequences」の訂正も参照）。ただし、この事実は、本ADRのD2の判断（SaaS向けにheaderモードを拒否し、JWTの検証を必須にする）を変更しない。D2の理由は2つある。CIDRの設定ミスが1つあれば全tenantの越境になること。そして、暗号的な証拠なしに `resolved_by="verified_claim"` を名乗れないこと。後者は、TRUSTED_PROXIESを実装したかどうかと無関係に成立する。
3. **Level 2のmock IdPは、JWTを発行していない。** `tests/level2/mock_idp.py` の `/oidc/token` は、claimのJSON dictを返すだけである。署名もJWKSのエンドポイントもなく、`mock_sp.py` は、それを平文のheaderへ写している。`ADR-0020` §6のハーネスは、headerマッピングのフィクスチャであり、暗号的なIdPのスタブではない。SaaSのe2eには、このハーネスを骨格として、**実際の署名とJWKSを足す**必要がある。
4. **`identity_providers` と `tenant_identity_providers` に、trust materialがない。** 現在の列は、`identity_providers(id, issuer, audience, lifecycle_state, created_at, updated_at)` と `tenant_identity_providers(tenant_id, identity_provider_id, lifecycle_state, created_at, updated_at)` だけである。protocolを判別する列も、JWKSのURIも、署名鍵も、外部組織への参照もない。「protocolに依存せず、すでに存在する」とは、「protocolが名指しされていない」という意味である。どの選択肢を採っても、マイグレーションは必要になる。
5. **`TenantContextResolver.resolve()` は、`request` もclaimも受け取らない**（`def resolve(self, *, db, user_id)`）。検証済みのclaimを、identity層からtenant層へ渡す経路が、型として存在しない。これは、issueのACに書かれていない、認識されていなかった阻害要因である。

### なぜ今この判断が必要か

`ADR-0047` の再起票基準R-1〜R-4に該当する新規の論点ではない。`ADR-0059` のImplementation gateが、follow-upとして明示的に残した決定を、消化するものである。同時に、AGENTS.md §6の「安全境界の変更」と「複数の合理的な選択肢が残る」に該当する。判断を先送りするコストは、すでに表に出ている。issueによれば、同じ文言の実装チェックポイントが、30箇所以上で繰り返されている。

## Decision

### D1: multi-IdP は upstream identity broker で吸収し、アプリは single-issuer を前提としない multi-issuer 検証として実装する

`saas-multitenant` の本番構成は、次の形を前提とする。**顧客ごとのIdP（Okta / Azure AD / SAML IdPなど）を、1つのidentity brokerが集約し、sui-sensemakingへは、単一のissuerと単一のaudienceのJWT、およびtenantを識別するclaimを渡す。** broker製品は固定しない（Keycloakのidentity brokering、Authentik、WorkOS、Auth0 Organizationsなどは、いずれもこの形をとる）。

これは、`ADR-0020` の再決定ではない。`ADR-0020` が禁じたのは、「アプリがSPやRPとして、redirect、callback、assertionの交換を行うこと」である。brokerモデルは、その責務の境界をそのまま保つ。tenantごとのIdPの差異は、brokerの設定で吸収され、アプリのコードの分岐にはならない。これは、`ADR-0020` §3-3の「providerの差異は設定で吸収し、実装の分岐を増やさない」と同じ原則の延長である。

ただし、アプリ側の実装は、**issuerをハードコードせず、検証済みのissuerから `identity_providers` の行を引く、multi-issuerの構造**とする。理由は、次の3点である。

- (a) `resolve_verified_claim_tenant_context()` は、すでに `identity_provider_id + issuer + audience` を受け取る形になっている。single-issuerを前提とする方が、むしろ不自然である。
- (b) brokerの移行、並行運用、stagingとの併存で、複数のissuerは現実に発生する。
- (c) 将来、tenantが自己申告するIdPを許す場合に、変わるのは検証のコードではなく、**trust materialの登録経路だけ**である。

v1では、`identity_providers` の行の作成を、Platform Control Plane（`ADR-0059` D9）の運用者の操作に限定する。tenant adminによるセルフサービスの登録は、提供しない。**アプリが信頼する鍵の出所を、tenantが編集できるデータにしない**ことが、この段階で守るべき唯一の線である。

### D2: `saas-multitenant` では JWT 検証を必須とし、平文 header mode を起動時に拒否する

- `ADR-0020` §3-2の2つのモードのうち、SaaSプロファイルが受理するのは、`jwt_header` だけとする。`header` モードは、設定の検証で拒否する。
- 理由: single-tenantでは、headerモードの信頼境界は、「1つの組織のプロキシを正しく置いたか」である。リスクは組織内に閉じる。しかし、共有のSaaSでは、trusted proxyの設定の1箇所のミスや、headerの除去漏れが、すぐに全tenantの越境になる。起票の時点（訂正2）では、`TRUSTED_PROXIES` も未実装で、ネットワークの配置と `SUI_API_KEY` 以外の境界がなかった（**2026-09-07訂正**: 本ADRの起票と同じコミットで実装済み。CIDRの設定ミスが1つあれば全tenantの越境になる点は変わらず、この理由の結論には影響しない）。
- `TenantContext.resolved_by = "verified_claim"` と、`VerifiedTenantClaim` のdocstringが要求する「署名、issuer、audienceを検証済み」を満たすには、暗号的な証拠が要る。headerモードでは、この契約を、型のとおりには満たせない。
- `trusted_host_mapping`（tenant別のサブドメインなど）は、`TenantResolutionMethod` に予約されている。ただし、本ADRでは実装の対象外とする。

### D3: プロトコル 範囲は OIDC/JWT のみとし、SAML はアプリに実装しない

- v1のアプリ側の検証は、JWS署名付きのJWT bearerだけを対象とする。
- SAMLのtenantは、brokerがSAMLからOIDCへ変換して収容する。D1を採る限り、**SAMLへの対応は運用の構成で達成できる。アプリに、XML署名の検証（`xmlsec1` のnative依存、canonicalization、XML Signature Wrappingへの対策）を持ち込む必要がない。** 「OIDCを先にするか、SAMLも同時にするか」というissueの問いは、brokerモデルを採った時点で、「アプリ側はOIDCだけで、SAMLの顧客も収容できる」という答えになる。これは、D1を選ぶ積極的な理由でもある。
- ただし、マイグレーションでは、`identity_providers.protocol` という判別列を、今回同時に追加する。既定値は `oidc` とし、v1で受理する値は `{oidc}` だけとする。未知の値は、安全側で拒否する。将来、SAMLの行を足すときに、破壊的なマイグレーションを起こさないための、最小限の先回りであり、実装は増やさない。

### D4: JWT 検証は PyJWT + cryptography、JWKS 取得は既存の trusted HTTP 規約に従う

- 検証ライブラリは、**PyJWT（+ `cryptography`）** を推奨する。`decode()` が `algorithms=` を必須の引数として要求し、`audience=` と `issuer=` が第一級であるため、algorithm confusionと検証漏れが、APIの形で防がれる。用途に対して、対象範囲が最も狭い。
- `python-jose` は、不採用とする。3.3.0（2021）から3.4.0（2025）まで、実質的な新版の公開がなかった。CVE-2024-33663（algorithm confusion）とCVE-2024-33664（JWEの展開によるDoS）の修正まで、数か月から年単位を要した。個人開発のOSSが、セキュリティへの対応を、このレイテンシの依存に預けるべきではない。
- `Authlib` は保守されている。しかし、必要なのは「検証1関数」であるのに、OAuth1/2とOIDCのclientと**server**を含む、フレームワーク全体を抱えることになる。`ADR-0020` の「protocolの実装の責務をアプリへ持ち込まない」に逆行する。同じ著者の `joserfc`（JOSEに絞った後継）は、PyJWTの代替として許容範囲とする。
- **`PyJWKClient` の内蔵フェッチャは使わない。** `urllib.request` で直接取得するため、`settings._validate_trusted_http_endpoint()` によるエンドポイントの正規化、loopback以外ではHTTPSを必須とすること、credential、query、fragmentの禁止、および `ADR-0062` が固定した「明示した外部連携は、完全な設定を起動の条件にする」という規約の、外側に出てしまう。JWKSの取得は、既存の `httpx` ベースの外部HTTPと同じ規約（エンドポイントの検証、タイムアウトの上限、秘密値を出力しないこと）で実装する。取得したJWKの集合から鍵を組み立てて、PyJWTへ渡す。
- 検証時の固定の制約: アルゴリズムの許可リストは、`RS256,ES256` を既定とする設定値とし、`none` とHMAC系は、常に拒否する。tokenのheaderの `jku`、`x5u`、埋め込まれた鍵は、一切参照しない。`kid` は、取得済みのJWKの集合の中でのみ解決する。時計のずれの許容は60秒に固定する（設定にしない）。
- 採用を確定する前に、PyJWTと `cryptography` の、最新の脆弱性情報と公開状況を再確認する。

### D5: JWKS のキャッシュと鍵ローテーション

`identity_provider_id` 単位でキャッシュし、次を既定とする（いずれも設定でき、上限がある）。

- 正常時の有効期間は600秒とする。
- 未知の `kid` を受けた場合は、再取得の待ち時間(cooldown)の60秒を満たしていれば、1回だけ強制的に再取得する。プロバイダごとに、実行中の再取得は1本に制限する。待ち時間を置かないと、ランダムな `kid` を送るだけで、IdPのJWKSエンドポイントへの増幅攻撃になる。
- 再取得に失敗した場合は、最後に取得できていたJWKの集合を、**最大1800秒まで**返す。超過したら、「検証不能」として扱う（D6）。無期限に古い鍵のまま継続することはしない。
- 古い鍵を供給することは、「どの署名鍵を受理するか」にだけ作用する。`exp`、`iss`、`aud`、`alg`、membershipの検証は、一切緩めない。IdPは、通常、ローテーションのときに新旧の鍵を重ねて公開する。そのため、1800秒は、IdP側の重なりを超えない範囲の、上限のあるリスクである。
- 署名の検証を省略するフォールバックと、token由来の鍵の採用は、いかなる状況でも行わない。

### D6: identity 検証が不能なときは deny 固定とし、fail-safe mode 設定を設けない

`access_control_fail_safe_mode` に `read_only` があるのは、PDPの障害時でも、**principalとtenantは分かっていて、capabilityだけが不明**だからである。identity層には、この縮退が成立しない。検証できないときに不明なのは、「誰か」と「どのtenantか」そのものである。あらゆるフォールバックは、「未検証のprincipalを、どこかのtenantのデータへ入れる」ことに等しい。`ADR-0059` D5も、tenantが不明なときは、readを含めて拒否としている。

したがって、identityの検証には、縮退モードの設定を**作らない**。「設定できるようにする」ことは、正しい運用が一つも選ばないはずの構成を作ることである。これは、`ADR-0062` が扱った、「安全に見える縮退の設定そのものが危険」というのと同じ失敗である。可用性の予算は、D5の、上限のある古い鍵の許容時間に一本化して使う。

応答は、次のように分ける。内部の監査には正確な理由のコードを残し、外部には最小限を返す。

- headerの欠落、署名の不正、`iss`、`aud`、`alg`、`kid` の不一致、期限切れは、`401` とする。どの検証で落ちたかを外部へ区別させない、単一の不透明なコードとする。
- JWKSがmax-staleを超えて取得できない場合は、`503` と専用のコードを返す。accessを与えない点は同じだが、運用者が「攻撃」と「外部の障害」を区別できるようにする。tenantの存在を示唆する情報は含めない。
- 検証に成功したが、subjectが未登録の場合は、`403` `identity_not_provisioned`（既存）とする。SaaSプロファイルは、`allow_jit_provisioning=false` が必須（`TrustedSaasRuntimePolicy.validate()`）なので、**auth edgeは、`users` と `user_identities` を一切書かない**。provisioningは、`POST /admin/provision/users` と、Tenant Adminの `membership.provision` の責務である。
- 検証に成功したが、membershipが成立しない場合は、`403` `tenant_context_untrusted`（既存）とする。

### D7: 検証済み claim は `ResolvedIdentity` に載せて明示的に受け渡す

訂正5の型の穴を、次の最小の変更で塞ぐ。

- `ResolvedIdentity` に、`verified_tenant_claim: VerifiedTenantClaim | None = None` を追加する（既定値があるため、single-tenantの経路は変更しない）。
- `TenantContextResolver.resolve()` を、`resolve(self, *, db, user_id, claim: VerifiedTenantClaim | None = None)` へ広げる。呼び出し元は、`saas_request_context.py:106` と `routes/docs.py:215` の2箇所だけである。
- `contextvars` などの、暗黙のrequest単位のチャネルは採らない。安全境界のデータ経路は、型で追えることを優先する。
- `resolve_verified_claim_tenant_context()` は**変更しない**。既存のunit testが持つ、証明としての価値を、そのまま残す。

### D8: tenant claim は tenant の「要求」であって権限ではない

- tokenのtenant claimは、「どのtenantとして振る舞いたいか」の表明にすぎない。権限の根拠は、常にDB側の `tenant_identity_providers` + `user_identities` + `tenant_memberships` である。これは、すでに `resolve_verified_claim_tenant_context()` が実装している性質である。brokerが共有するissuerの構成でも、越境が成立しないことの根拠になる。
- claimが運ぶのは、sui-sensemakingの内部IDではなく、**外部の組織への参照**とする。`tenant_identity_providers` に `external_tenant_ref` 列を追加し、`unique(identity_provider_id, external_tenant_ref)` を張って、`tenants.id` へ写す。理由は、次の3点である。
  - (a) 運用者に、IdPの設定へsui-sensemakingの内部IDを書かせない。
  - (b) `ADR-0059` D5/D10の「`tenants.id` は不透明で、外部へ出さない」を保つ。
  - (c) 共有brokerでは、`tenant_identity_providers` の行が、単なるN:1の飾りになってしまう。そこに、実際のデータを持たせられる。
- tenant claimがないtokenは、拒否する。membershipが1件だけなら推定する、という縮退は入れない。`resolved_by="verified_claim"` は、「検証済みの証拠から解決した」ことを意味しなければならない。複数のmembershipを持つ利用者のtenantの切り替えは、`ADR-0061` のtenant sessionと `select_active_tenant_context()` が、すでに扱っている別の経路である。

### D9: 実装スコープと起動拒否の解除条件

**いま作る**（この順で、1本の変更として実行できる粒度にしてある）。

1. マイグレーション: `identity_providers` に `protocol` と `jwks_uri` を、`tenant_identity_providers` に `external_tenant_ref` を追加する。`jwks_uri` は、書き込み時に `_validate_trusted_http_endpoint()` 相当で検証する。
2. JWKSの鍵ストア（D4/D5）。
3. `SaasIdentityContextResolver` の具象の実装（JWTの検証 → subjectの照合 → 書き込みなし → `ResolvedIdentity` とclaimを返す）。
4. `TenantContextResolver` の具象の実装（claimを受けて、既存の `resolve_verified_claim_tenant_context()` を呼ぶだけ）。
5. D7の型の変更と、2箇所の呼び出し元の更新。
6. `main.py` のmodule scopeで、プロファイルが `saas-multitenant` のときだけbundleを組んで、`install_trusted_saas_runtime()` する。`settings.py:425` の無条件の `ValueError` は、**削除ではなく差し替え**とする。既存の `TrustedSaasRuntimePolicy.validate()` に、auth edge側の必須の設定（モード、tenant claimの名前、アルゴリズムの許可リスト、有効な `identity_providers` の行の存在）を加えた、安全側で拒否する検証にする。
7. Level 2のmock IdPに、RS256の実際の署名と `/jwks.json` を足す。鍵は、`ADR-0020` §7のとおり、起動時に動的に生成し、平文でコミットしない。
8. tenant A/Bと、同一のdocIdによる、HTTPレベルのネガティブマトリクスのe2e。AC-4を、resolver単体ではなく、リクエストを経由して証明する。

**いま作らない**ものは、アプリ内のSAML、tenantのセルフサービスによるIdPの登録APIとUI、SCIM、broker製品の同梱と選定、`trusted_host_mapping` の経路、複数のbrokerを同時に運用する手順である。

**「実際の顧客がまだいない」ことの意味**: 決定を先送りする理由にはならない。先送りのコストは、すでに、8件のACの停止と、繰り返されるチェックポイントとして支払われている。一方で、顧客がいて初めて価値が出るもの（セルフサービスのオンボーディング、SAMLのアプリ内の実装、複数のbroker、課金との連動）は、明確に先送りしてよい。上の8項目が、1本の変更に収まらない規模へ膨らむなら、それは日程の問題ではなく、設計が間違っているという合図として扱う。起動の拒否は、8が通るまで維持し、その後も削除せず、条件を絞る形で残す。

## Alternatives considered

1. **tenantごとにIAPやgatewayのインスタンスを立てる（issueが想定したAの素直な読み）**: アプリは最も単純になる。しかし、tenantの追加がインフラの作業になり、SaaSの単位経済が崩れる。個人開発のOSSが、運用手順として要求できる現実味がない。brokerモデルは、同じアプリ側の単純さを、gatewayを増やさずに得られる。
2. **tenantが自分のIdPを登録し、アプリがrequestごとにJWKSを取りに行く（B）**: 最終的な形としては妥当である。しかし、v1で採ると、「アプリが信頼する鍵の出所」が、tenantが編集できるデータになる。tenantが供給するURLへの外向きの通信（SSRFの面）、tenantごとの可用性への依存、キャッシュポイズニングが、同時に載る。D1は、検証のコードをmulti-issuerで作るため、trust materialの登録経路を差し替えるだけで、後からBへ到達できる。**順序の問題であり、排他ではない**と判断した。
3. **`header` モードをSaaSでも許し、`TRUSTED_PROXIES` を実装して境界とする**: 暗号的な証拠なしに `resolved_by="verified_claim"` を名乗ることになり、`ADR-0059` D5と整合しない。CIDRの設定1行のミスが、全tenantの越境になる点も、共有のSaaSでは受け入れられない。**2026-09-07訂正**: `TRUSTED_PROXIES`（`_check_trusted_proxy()`）は、その後、single-tenantプロファイル向けに実装済みである。ただし、上記の2点の却下の理由（暗号的な証拠の不在と、CIDRの誤設定が一発で全tenantの越境になるリスク）は、いずれも実装の有無と独立に成立する。そのため、本選択肢を却下した判断は変わらない。
4. **アプリ内にSAML SPを実装して、OIDCと同時に提供する**: `xmlsec1` のnative依存と、XML署名の検証の攻撃面を、brokerで代替できるのに、抱え込むことになる。`ADR-0020` §2-Aで一度否決した構図の再現である。
5. **identity層にも `fail_safe_mode` の設定を置く**: 「誰か不明でも通す」設定は、正しい運用が選ばない。存在すること自体が、誤設定の入口になる（`ADR-0062` の教訓）。
6. **`contextvars` でclaimを運ぶ**: 型の変更を避けられる。しかし、安全境界のデータ経路が暗黙になり、asyncでの取り違えを、静的に検出できない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 顧客ごとのIdP（Okta/Azure AD/SAMLなど）をidentity brokerが集約し、sui-sensemakingへは、単一のissuerと単一のaudienceのJWT、およびtenantを識別するclaimを渡す。broker製品は固定しない（Keycloak/Authentik/WorkOS/Auth0 Organizationsなど） | 機能: アプリは、SPやRPとして、redirect、callback、assertionの交換を行わない（ADR-0020の責務の境界を維持する）。データ: tenantごとのIdPの差異は、brokerの設定で吸収し、アプリのコードの分岐にしない |
| **データ設計** | `identity_providers`の行の作成は、Platform Control Planeの運用者の操作に限定し、tenant adminのセルフサービスによる登録は提供しない。アプリが信頼する鍵の出所を、tenantが編集できるデータにしない | 業務: アプリ側の実装は、issuerをハードコードせず、検証済みのissuerから`identity_providers`の行を引く、multi-issuerの構造とする。機能: マイグレーションでtrust materialの列を追加する |
| **機能設計** | 実際のHTTPリクエストの認証情報を検証して`VerifiedTenantClaim`を作る層を実装する。multi-issuerのJWT検証（PyJWT+cryptography）を行う。`TenantContextResolver.resolve()`は、requestとclaimを受け取る形に、シグネチャを変更する | 業務: IdPやJWKSの障害時は、1800秒の猶予の後に、全面的に停止する（可用性より機密性を優先する、ADR-0059の帰結）。データ: single-tenantの挙動は、既定値により変更しない |

## Consequences

- `saas-multitenant` の運用者は、identity brokerの設置と維持を負う。sui-sensemakingは、その選定も同梱も行わない。
- SAMLの顧客は、アプリのコードを変更せずに収容できる。protocolの差異を吸収する点が、brokerに一元化される。
- 新規の実行時の依存が2つ増える（PyJWT、`cryptography`）。現在のbackendは、JWTのライブラリを一切持っていない。
- マイグレーションが1本増える（`identity_providers` に2列、`tenant_identity_providers` に1列）。
- `TenantContextResolver` protocolのシグネチャが変わる。呼び出し元は2箇所で、single-tenantの挙動は、既定値により変更しない。
- `resolve_verified_claim_tenant_context()` と既存のunit testは、変更のないまま流用される。AC-4の証明は、resolver単体から、HTTP経由へ拡張される。
- IdPやJWKSの障害時、SaaSのデプロイは、1800秒の猶予の後に、全面的に停止する。可用性より機密性を優先する `ADR-0059` の帰結を、identity層へも適用したことになる。
- `TRUSTED_PROXIES` が未実装であることは、本ADRでは解消されない。single-tenantプロファイル向けの、独立した欠落として残る。**2026-09-07訂正**: この欠落は、本ADRの起票と同じコミット（`161c2223`）で、すでに `_check_trusted_proxy()` として実装されていた。しかし、本節の記述が同期されていなかった。`SUI_TRUSTED_PROXIES` が未設定のときは、起動時の警告を出した上で、全originを許可する（後方互換）。設定されているときは、CIDRの外にある接続元を `403 untrusted_proxy` で拒否する。これは、`resolve_identity_context()` の先頭（forwarded headerを読む前）で、必ず評価される。2026-09-07の時点では、専用の回帰テストがなかったため、`tests/test_auth_context_resolution.py` へ6件を追加した。追加したテストは、次のとおりである。未設定のときの許可、CIDR内の許可、CIDR外の拒否、クライアントIPが不明なときの拒否、不正な形式のIPの拒否、信頼できないプロキシからの完全なidentity headerのセットも先頭で拒否されること。既存のガードを一時的に無効にして、これらのテストが期待どおりに失敗することを確認した上で、復元済みである。

## Non-goals

- `ADR-0020` の「アプリは、OIDCやSAMLのhandshakeを実装しない」という原則の変更。本ADRは、bearer tokenの検証だけを扱う。redirect、callback、logout、step-upは、前段の責務のまま維持する。
- broker製品の選定、推奨、同梱。
- tenantによるIdPの自己登録、SCIM、deprovisioningの自動化。
- `saas-multitenant` の起動拒否の解除そのもの（解除は、`SAAS-TENANT-01` 側で、D9-8の達成を確認してから判断する）。
- single-tenantプロファイルの認証の挙動の変更。

## Open questions for the maintainer

本ADRが承認を求めている論点は、次の4つである。ここが差し戻されれば、D2以降は組み替えになる。

> 2026-08-08: 全質問が D9-1〜D9-8 の実装をもって解決済み。ADR は Accepted。

1. **D1のbroker前提を、SaaS運用の必須要件として、運用者へ課してよいか。** → **Yes.** brokerモデルで実装。tenant登録型のmulti-IdPは、v1ではdefer。
2. **D3のとおり、SAMLをアプリに実装しないと確定してよいか。** → **Yes.** SAMLの顧客は、brokerのSAML→OIDC変換で収容。アプリには、XML署名の検証を導入しない。
3. **D4のPyJWT採用**（`Authlib` や `joserfc` ではなく）。 → **Yes.** PyJWT + cryptographyで実装。検証だけが必要なbrokerモデルに適合。
4. **D6の「identity層にfail-safeの設定を作らない」**。 → **Yes.** identityを検証できないときは、拒否に固定。D5の1800秒のstaleの窓が、唯一の可用性の予算。

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
