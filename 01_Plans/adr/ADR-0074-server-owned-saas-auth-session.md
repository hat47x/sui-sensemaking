# ADR-0074: SaaS active tenantをserver-owned認証sessionへ束縛する

- Status: Accepted
- Date: 2026-08-11
- Accepted: 2026-08-13（**案2 server-owned BFF sessionを採用**。保守者による明示承認。仮承認ではない）
- Deciders: Maintainer（承認2026-08-13。ドッグフーディングループの承認方針に基づく。「Acceptance Gate回答案」節の4項目を含め、個別確認なしで承認）
- Source Issue: `SAAS-TENANT-SESSION-BINDING-01`
- Scope: `03_Implement/backend/`, `03_Implement/frontend/`, Identity Broker連携、SaaS session persistence

## Context

`ADR-0061`はactive tenantと`tenantSessionVersion`を認証session単位で原子的に解決・更新すると決めた。しかし現行実装は`principal_id`を共有DBの主キーとし、versionだけを保存する。選択tenantは保存されず、同じprincipalの別sessionも分離できない。version cookieもDB lookupやanti-forgery検証に使われない。

単なる列追加では解決しない。requestから「同じブラウザ認証session」をserver-trustedに識別する入力が必要である。access tokenの`jti`はtoken識別子であり、通常の連続requestやrefresh後も続くlogin sessionの識別子ではないため流用しない。

比較対象は次の3案である。

1. BrokerのOIDC `sid`相当claimをBearer access tokenへ含め、`issuer + sid`をsession keyにする。OP sessionを表すopaque IDという意味は適合するが、標準の`sid`提供先は主にID Token／Logout Tokenであり、access token搭載はBroker固有契約になる。token更新時の継続性、session fixation、logout通知もBrokerごとに検証が必要である。
2. BFFがOAuth clientとtokenを保持し、browserにはHttpOnly・Secure cookieでserver-owned session IDだけを渡す。API request、active tenant、version、logoutを同じserver sessionへ束縛できるが、現行の「SPAがBearer tokenをメモリ保持しAPIへ直接送る」方針を変更する。
3. tenant切替ごとにBrokerからtenant別tokenを再発行する。DB session正本は減るが、切替UIが認証redirectへ依存し、複数Brokerのclaim更新と失敗時状態が複雑になる。

参考仕様: OpenID Connect Back-Channel Logout 1.0は`sid`をissuer内で一意なUser Agent/deviceのopaque session IDとして定義する。OAuth 2.0 for Browser-Based Applicationsの現行IETF draftはBFFを、browserからtokenを隠し全API requestをbackend経由にする最も強い構成として整理している。

## 採択記録（2026-08-13）

保守者の明示承認によりProposed → Accepted。**案2のserver-owned BFF sessionを採用**する。下記Decisionの7項目がそのまま実装要件になる。

### 実装の解禁

本ADR採択により、**1つの判断で3本のOpen P1が同時に着手可能**になる。

| issue | 本ADRが与える前提 |
|---|---|
| `OPS-SAAS-SCALE-01`（Open P1） | AC-4〜8 が未達で本ADR待ちだった。session 失効の正本が DB 側の `session_key_hash` 行に定まることで、水平スケール時の失効伝播が設計可能になる |
| `SAAS-TENANT-SESSION-BINDING-01` | 詳細なデータ/API修正の正本。本ADRの Decision 3（session row のキー設計）が前提 |
| `AUTH-ONE-TIME-JWT-01` | Decision 7（access token `jti` を session 主キーへ流用しない）が方針を確定させる |

### 採択時に確認した現行実装との差分

現行の `saas_tenant_sessions`（`models.py`）は `principal_id` をキーとしversionのみを保持する。本ADR採択は次の3点を**破壊的変更として認める**ことを含む。

1. `principal_id` 主キー → `session_key_hash` 主キー（別device非干渉のため。Decision 3）
2. SPAのBearer直接送信を廃止し、HttpOnly cookie ＋ anti-CSRFへ移行（Decision 2/5）
3. logoutは提示sessionのみ失効。全session logoutは明示的な別操作（Decision 6）

`research/direction-review-2026-08-13.md` が「session model is principal-scoped, not session-scoped」として記録した問題群（別browser/deviceで切替とlogoutが干渉する、次のrequestでJWTのclaim tenantへ戻り得る、cookieがDB行と照合されない、行が失効しない）はすべて1の帰結であり、本採択がその根本対策にあたる。

## Decision（採択済み）

**案2のserver-owned BFF sessionを採用する。**

1. sui-sensemakingまたは同一trust boundaryのgatewayをconfidential OAuth clientとし、access/refresh tokenをbrowserへ渡さない。
2. browserには128-bit以上のentropyを持つopaque session IDをHttpOnly、Secure、SameSite=LaxまたはStrict cookieで発行する。DBには生cookie値ではなくkeyed hashを保存し、key rotation手順を持つ。
3. session rowは`session_key_hash`を主キーとし、`principal_id`、`issuer`、`subject`、`active_tenant_id`、`tenant_session_version`、作成・最終利用・絶対失効時刻、失効状態を保持する。tenant membership/capabilityはrequestごとに正本を再確認し、session snapshotだけで許可しない。
4. active tenant変更はsession rowの現在tenant/versionを条件に、membership再確認後にCAS更新する。同じsessionの全タブだけが新versionへ進み、同じprincipalの別sessionへ波及しない。
5. state-changing requestはOrigin/Host検証に加えてsessionへ束縛したanti-CSRF tokenを要求する。SameSite cookieだけを唯一のanti-forgery境界にしない。
6. logoutは提示sessionだけを失効させる。全session logout、管理者失効、OIDC back-channel logoutは明示的な別操作として`issuer + subject`または検証済み`issuer + sid`の索引から対象sessionを失効させる。
7. access token `jti`、tenant claim、principal ID、client入力のsession IDをsession主キーへ流用しない。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 利用者は1つのlogin session内でactive tenantを切り替え、同じsessionのタブだけが連動する。別browser/deviceの作業は維持される | logout UIは「このsession」と「全device」を区別する。切替時は同sessionの他タブへ影響する説明を維持する |
| **データ設計** | active tenantとversionをserver-owned session rowへ原子的に保存し、principal、token、tenant claimとは別キーにする | cookie生値・token・versionを監査本文へ保存しない。membership停止・失効・期限切れではrowが残っても利用を拒否する |
| **機能設計** | BFFがOAuth tokenを保持し、browser requestをsession cookie＋anti-CSRFで受ける。切替はCAS、全tenant APIはresource lookup前にversion照合する | SPAのBearer直接送信を廃止する。session bootstrap、refresh、logout、back-channel logout、複数workerを同じ失効正本へ接続する |

### 三要素間の牽制結果

- 業務上必要な「別device非干渉」はprincipal主キーを禁止し、データ設計へsession固有キーを要求する。
- データ上のactive tenant正本は、機能設計へtoken claimより先にsession rowを解決し、その後membershipを再確認する順序を要求する。
- cookie認証化はCSRFを新たに生むため、機能設計のOrigin/Host＋anti-CSRF検証がなければ業務上の安全な切替を満たさない。

## Consequences

- XSS時のtoken窃取範囲を縮小し、active tenant、version、logoutを同じserver sessionへ束縛できる。
- OAuth callback、token refresh、BFF proxy、CSRF、session expiry、key rotation、logout連携の実装・運用が増える。
- `ADR-0064`の「SPAがJWTをメモリ保持し、HttpOnly cookieとの二重管理は採用しない」という選択を、本ADRがAcceptedになった時点でsupersedeする。Proposed中は現行方針を変更しない。
- 現行`saas_tenant_sessions`はin-placeで意味を変えず、新tableへのexpand/backfill不可（既存行からsession ownershipを復元できない）・cutover・旧table削除の段階移行とする。cutover時は既存SaaS loginを再認証させる。

## Acceptance Gate

本ADRをAcceptedへ変更する前に、次をMaintainerが確認する。

- BFFをsui-sensemaking backendへ内蔵するか、同一trust boundaryのgateway責務にするか。
- cookie domain/path、SameSite、CSRF方式、絶対／idle timeout、refresh token保管・暗号鍵管理。
- Brokerごとのlogout連携範囲と、back-channel logout非対応時の全session失効手順。
- SPA Bearer直接送信を前提とする既存E2E、CORS、運用手順の移行範囲。

## Rejected for this proposal

- **Broker `sid`を直ちに採用**: 現行APIが受けるaccess tokenに標準必須ではなく、Broker固有claim契約を共通安全境界にするため見送る。BFF内部で検証済みlogout相関値として使う余地は残す。
- **principal単位のままactive tenant列だけ追加**: 別session非干渉を満たさない。
- **version cookieをsession IDへ昇格**: 現在はserver ownership検証なしに発行され、active tenant正本とも結び付かない。移行時に新規sessionとして再発行する。

## Acceptance Gate 回答（2026-08-13、Maintainer承認済み）

Maintainerの要請により以下4項目への回答案を作成し、個別確認なしで承認された（上記Deciders参照）。本節が「Acceptance Gate」の正式な充足内容である。

### 回答案1: BFFの配置 — sui-sensemaking backend自身に内蔵する（別gatewayは新設しない）

根拠は次のとおりです。
- `main.py`に`CORSMiddleware`が存在しない。これは現状が同一origin／reverse proxy前提の構成であることを示す。BFFを内蔵すれば、OAuth callback・cookie発行・API呼び出しがすべて同一originのまま維持され、**新規CORS設定が不要**になる。
- `ADR-0072`でも同種の論点（D1=C「ネットワーク分離gateway」）を「単一プロセス前提の現行構成から乖離する」という理由で見送り、アプリ内認可（D1=A+B）を選んだばかりである。同じ理由がBFFにも当てはまる。
- 別gatewayを新設すると、デプロイ構成・TLS終端・health check・監視対象が増え、個人OSS・プレリリース段階（`ADR-0039`）が求める複雑性予算に見合わない。

### 回答案2: cookie/CSRF/timeout/鍵管理 — 既存cookie属性を継承し、寿命は提案値として明示する

既存の`tenantSessionVersion` cookie（`active_tenant_session.py:259-265, 336-342`）は既に`httponly=True`、`secure=<local-dev以外でTrue>`、`samesite="strict"`、`max_age=3600`を採用している。新設する認証session cookieもこの属性をそのまま継承することを提案する。

- **domain/path**: `Path=/`。`Domain`属性は付与しない（発行元originに限定し、subdomain間共有は行わない）。
- **SameSite**: `Strict`（既存踏襲）。BFFが受けるOAuth callbackはBrokerからのGETリダイレクト応答であり、そこでの`Set-Cookie`はSameSite属性の影響を受けない（SameSiteが制限するのは「そのcookieを添えて送るか」であり「受け取れるか」ではない）。したがってStrictのままcallbackを処理できる。
- **CSRF方式**: session cookieへ束縛したsynchronizer token（非HttpOnlyの別cookieまたはresponse bodyで払い出し、state変更requestではheader経由で送らせて一致検証）を提案する。SameSite=Strictを主防御、token検証を第二防御とする多層防御とする。
- **絶対/idleタイムアウト（提案値・要確認）**: 絶対session寿命 **12時間**、idle失効 **60分**。既存`tenantSessionVersion`の`max_age=3600`（1時間）とidle 60分は整合する。絶対12時間は「1営業日単位で必ず再認証させる」運用を意図した値であり、コンプライアンス要件次第で調整可能な提案値である。
- **refresh token保管・暗号鍵管理**: refresh tokenはBFFプロセスの外（browser）へは一切渡さない（本ADR決定1に整合）。DB保存時は対称鍵暗号（AES-GCM等）で暗号化し、鍵はプロセス起動時に既存の`SUI_*`環境変数規約に沿って注入する。鍵ローテーション手順は別途運用issueで定義する（本ADRのスコープ外とする）。

### 回答案3: Brokerごとのlogout連携範囲 — Keycloakのback-channel logoutを優先し、非対応Brokerには既存決定6のフォールバックを適用する

- `ADR-0064` Phase 2が推奨するBroker（Keycloak）はOIDC Back-Channel Logout 1.0に対応しているため、`sid`相当のsession識別子を受け取れる場合はback-channel logout通知経路を実装する。
- back-channel logout非対応のBrokerでは、本ADR決定6が既に規定する「`issuer + subject`索引からの全session失効」を汎用フォールバックとする（新規提案ではなく、本文の既存決定をそのまま適用する）。
- Phase 2（実Broker連携）着手までは、mock IdP/SPハーネス（`tests/level2/mock_idp.py`）へback-channel logoutのmock要素を追加し、フロントエンド実装なしに契約だけを先に固定する。

### 回答案4: 既存E2E/CORS/運用手順の移行範囲

回答案1（BFF内蔵）を採る場合、**CORS設定の新規追加は不要**。影響を受ける既存資産は次の3点:

- **SaaS向けE2E**（`playwright.saas.config.ts`、`tenant_session_multitab.spec.ts`等）: 現状は`Sui-Sensemaking-Tenant-Session-Version`ヘッダーとmock session objectを直接注入している。BFF移行後はOAuth callbackを経由したcookie発行を模擬する経路へ書き換えが必要。
- **Level 1/2テストハーネス**（`tests/federation/mock_sp.py`、`tests/level2/mock_idp.py`）: 現状はJWTを`X-Sui-Sensemaking-Authorization`ヘッダーで直接転送する構成（`ADR-0064` D4-4）。BFF移行後は「BFFがtoken交換を代行し、browserにはcookieだけを返す」経路への拡張が必要。
- **frontend `api/client.ts`**: 現状のBearerヘッダー送信から、cookie送信（`credentials`指定）への切替が必要。tenant session precondition headerの扱い（`Sui-Sensemaking-Tenant-Session-Version`）自体は維持可能。

## Traceability

- Derived-from: `01_Plans/adr/ADR-0061-saas-active-tenant-session-concurrency.md`
- Related: `01_Plans/adr/ADR-0064-saml-oidc-broker-jwt-coordinated-auth-flow.md`
- Implementation issue: `01_Plans/issues/done/issue-SAAS-TENANT-SESSION-BINDING-01-principal-keyed-session-state.md`
- Standards: OpenID Connect Back-Channel Logout 1.0, OAuth 2.0 for Browser-Based Applications (IETF draft)

