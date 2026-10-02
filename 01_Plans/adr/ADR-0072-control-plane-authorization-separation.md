# ADR-0072: 管理面（Control Plane）の認可を業務面から分離し、SaaSでも到達可能にする

- Status: Accepted
- Date: 2026-08-09
- Accepted: 2026-08-13（D1=A+Bの二段 / D2=A / D3=A。保守者による明示承認。仮承認ではない）
- Renumbered: 2026-08-10（起票時にADR-0067を採番したが、同番号が `ADR-0067-three-element-constraint-design-method.md`（2026-08-08、先行）と衝突していた。`docs_check` のDC-ADR-001の指示どおり、先行分を維持し本ADRを次の未使用番号へ改番した。判断内容は無変更。）
- Deciders: Maintainer（2026-08-13採択済み。採択内容は下記「採択記録」を正とする。ドッグフーディングループの承認方針に基づく）
- Scope: `03_Implement/backend/src/sui_sensemaking_api/routes/admin.py`, `main.py`, `settings.py`, `runtime_bootstrap.py`, `02_Architecture/enterprise_architecture.html`, `04_Documentation/security.md`, `THREAT_MODEL.md`

## Context

`ADR-0063`/`ADR-0064` で `saas-multitenant` のtrusted auth edgeが実装され、JWT検証 → tenant解決 → session発行が動作するようになった。この過程で、管理面（provisioning）側の認可がこの認証基盤の外側に取り残された。

コード実読と実行で確認した事実は次の3点である。

### 事実1: 管理APIに業務APIと区別された認可がない

`/admin/provision/*` の唯一の保護は `main.py:135-146` のグローバルmiddleware `require_api_key` である。

```python
if settings.api_key:
    provided_key = request.headers.get("x-api-key")
    ...
```

`settings.py:263-266` で `api_key` の既定値は `None` である。実行確認:

```
$ SUI_RUNTIME_PROFILE=enterprise-production python3 -c "from sui_sensemaking_api.settings import Settings; print(Settings().api_key)"
None
```

すなわち `enterprise-production` は APIキー未設定のまま起動でき、その場合すべてのエンドポイントが無認証になる。キーを設定した場合も、文書API・AI API・管理APIが同一の共有静的キー1本で保護される。

これが重要なのは、`/admin/provision/identity-providers`（`routes/admin.py:324-417`）が信頼するJWT発行者とJWKS URIを登録するエンドポイントだからである。ここへ到達できる主体は、自分が管理する鍵でIdPを登録し、`_resolve_identity_provider()`（`trusted_auth_edge.py:124-135`）の検索に一致するトークンを自ら発行して、任意の利用者・任意のテナントとして認証できる。`/admin/provision/tenant-identity-providers` は外部テナント参照と内部 `tenants.id` の対応を作るため、同様に越境の起点になる。

`02_Architecture/enterprise_architecture.html` §06は自らこう要求している。

> Workspace Data Plane、Tenant Admin、Platform Control Plane の route、audience、capability を分離し、Platform operator へ文書 read を暗黙付与しない。

現行実装はこの要求を満たしていない。

### 事実2: SaaS プロファイルは文書化された手順で起動できない

`routes/admin.py:75-94` の `require_single_tenant_provisioning_surface` は、`resolve_tenant_session_bootstrap_mode` が `single-tenant` 以外を返す場合に404を返す。`runtime_bootstrap.py:21-22` により `saas-multitenant` は `tenant-session-required` を返すため、SaaSでは管理APIが到達不能になる。実行確認:

```
enterprise-production  -> ALLOWED
saas-multitenant       -> HTTP 404 {'code': 'strict_provisioning_unavailable'}
```

一方 `trusted_saas_runtime.py:298-304` は起動時にこう警告する。

> Register at least one via `POST /admin/provision/identity-providers` before authentication requests will succeed.

指示されたエンドポイントが、指示された状況で404を返す。 IdP登録なしに認証は成立しないため、SaaSプロファイルはDB直接操作なしにブートストラップできない。DB直接投入を正規手順にすることは、企業・行政案件の監査要件（操作の認可・証跡）と整合しない。

### 事実3: 「認証は外部IAP責務」という委譲が管理面では成立していない

`ADR-0020` は認証プロトコルを前段IAPへ委譲すると固定した。管理面もこの委譲で保護される、という解釈は成り立ちうる。しかし現状では次の3点により委譲が閉じていない。

- IAPの存在を強制する仕組みがない（`enterprise-production` は無認証で起動する）。
- 管理面と業務面が同一origin・同一認証（あるいは無認証）で提供され、前段で分離するための要件が運用文書に記載されていない。
- `THREAT_MODEL.md` と `04_Documentation/security.md` に「/adminを別経路で保護せよ」という運用要件の記述が見当たらない。

## 採択記録（2026-08-13）

保守者の明示承認によりProposed → Accepted。採択内容は推奨どおり D1=A+Bの二段 / D2=A / D3=A。

| 論点 | 採択 | 内容 |
|---|---|---|
| **D1** | **A+B の二段** | 静的 admin bearer（`SUI_ADMIN_API_KEY`）を**ブートストラップ専用の最小権限経路**として `/admin/**` のみに適用し、IdP登録後の通常運用は trusted auth edge の JWT ＋ platform-operator capability claim で行う。D1=C（ネットワーク分離）は**アプリ側の保証ではなく deployment 側の推奨構成**として文書化し、A+B と排他にしない |
| **D2** | **A** | 管理面を SaaS でも開放し、D1 の認可で保護する。`require_single_tenant_provisioning_surface` を認可判定へ置き換える |
| **D3** | **A** | `enterprise-production` / `saas-multitenant` で認証手段が未設定なら `Settings()` 構築時に fail-fast（`ADR-0062` と同じ方針を認証そのものへ一貫適用） |

### 採択時の補正: D2 における profile 差の分離（必須）

`02_Architecture/post-mvp-business-scope-design-program.html` §5.2が、本ADR採択時に反映すべき欠落として次を指摘している。D2=Aを採るにあたり、この分離を実装要件に含める。

本ADRは「管理面をどう認可するか」を論じていたが、「最初の管理者は誰であり、その人物の正当性はどう確認されるか」という業務次元の問いを扱っていなかった。そしてこの問いの答えはprofileによって異なる。同じ「bootstrap」という語で二つの異なる業務要件を指していたため、D2のいずれの案を採ってもSaaS側は解ききれない。

| profile | 最初の管理者とは誰か | 正当性の根拠 | bootstrap token で足りるか |
|---|---|---|---|
| `enterprise-production`（自己ホスト） | そのインスタンスをデプロイした人物 | 物理的に自明。サーバへの到達権＝所有権 | **足りる** |
| `saas-multitenant`（共有基盤） | テナントを申し込んだ組織の代表者 | 自明でない。組織の実在とドメイン所有の確認が要る | **足りない**。「申込者が本当にその組織の人か」を担保できない |

したがってD2=Aの実装は次の2段に分ける。

1. **`enterprise-production`**: D1=Aの静的admin bearerによるbootstrapを正規手順とする。到達権＝所有権の前提が成立するため、これで閉じる。
2. **`saas-multitenant`**: 静的bearerによるbootstrapだけでは閉じない。テナント発行は「組織の実在確認を伴う別工程」の帰結として行われるべきものであり、`/admin/provision/*` をSaaSで開放することはその別工程の存在を前提とする。本ADRはこの別工程（申込・審査・ドメイン所有確認）を設計対象としない。SaaSでのテナント発行経路は、この前提が満たされるまで運用手順として閉じたままとし、APIの到達性のみD1の認可で担保する。

この分離を明示しないままSaaSで管理面を開放すると、「静的bearerを知る者が任意の組織名でテナントを作れる」状態になる。APIの認可（本ADRの範囲）と、テナント発行の業務的正当性（本ADRの範囲外）は別問題である。

### 実装の解禁

本ADR採択により `SEC-ADMIN-PLANE-01`（Draft P0）の「ADRがProposedの間は着手しないこと」という制約が解除される。同issueは `enterprise-production` が既定で完全無認証起動する欠陥を扱っており、D3=Aがその直接の対策である。

## 決定すべき論点（採択済み・記録として残す）

本ADRは以下を決めた。採択内容は上記「採択記録」を正とする。

- **D1**: 管理面の認可方式。
- **D2**: SaaSプロファイルにおける管理面の到達性とブートストラップ手順。
- **D3**: `api_key` 未設定で本番相当profileを起動できる現状の扱い。

## 選択肢

### D1: 管理面の認可方式

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A** | 業務面とは別の静的 bearer（`SUI_ADMIN_API_KEY`）を必須化し、`/admin/**` のみに適用 | 実装が最小。ブートストラップ時（IdP未登録）にも使える | 静的秘密の運用（ローテーション・失効）が残る。主体特定ができず監査が弱い |
| **B** | trusted auth edge の JWT ＋ platform-operator capability claim を要求 | 主体が特定でき監査に載る。plane 分離の要求に最も整合 | IdP 未登録状態では使えない（ブートストラップに別経路が必要） |
| **C** | 管理面を別 listen port / 別 ASGI app へ分離し、ネットワーク層で到達制御 | 前段委譲が構造的に閉じる。企業・行政の一般的な運用形 | デプロイ構成が複雑化。単一プロセス前提の現行構成から乖離 |
| **D** | HTTP を廃し、ブートストラップ操作は CLI（`cli.py`）専用にする | HTTP 到達面が消える。最も攻撃面が小さい | 遠隔運用・自動化がしにくい。既存 `/admin/provision/users` の互換を壊す |

### D2: SaaS でのブートストラップ

| 案 | 内容 |
|---|---|
| **A** | 管理面を SaaS でも開放し、D1 の認可で保護する（`require_single_tenant_provisioning_surface` を認可判定へ置き換える） |
| **B** | 管理面は SaaS でも 404 のまま維持し、IdP 登録は CLI / migration seed 専用とする |
| **C** | 初回のみ有効なブートストラップトークン（環境変数、1回限り）を導入する |

### D3: 本番相当 profile での認証必須化

| 案 | 内容 |
|---|---|
| **A** | `enterprise-production` / `saas-multitenant` で認証手段が未設定なら `Settings()` 構築時に fail-fast（`ADR-0062` と同じ方針） |
| **B** | 起動を許すが警告を出す |
| **C** | 現状維持（前段 IAP 前提を運用文書で明記するに留める） |

## Three-Element Verification（ADR-0067 暫定適用・提案として）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 管理面（provisioning）側の認可が認証基盤の外側に取り残され、`/admin/provision/identity-providers`が信頼するJWT発行者とJWKS URIを登録するエンドポイントとして任意の利用者・任意のテナントとして認証できる越境の起点になる。管理面の認可を業務面から分離しSaaSでも到達可能にする | 機能: 業務面とは別の静的bearer（SUI_ADMIN_API_KEY）とtrusted auth edgeのJWT+platform-operator capability claimの二段構成。データ: IdP未登録状態（ブートストラップ）と通常運用（capability claim）を構造的に区別 |
| **データ設計** | `enterprise-production`はAPIキー未設定のまま起動でき、その場合すべてのエンドポイントが無認証になる。キーを設定しても文書API・AI API・管理APIが同一の共有静的キー1本で保護される。D3=Aで本番相当profileでは認証を必須化 | 業務: 明示選択したのに設定が無ければ起動を止める（ADR-0062のfail-fast方針を認証へ一貫適用）。機能: 管理面の認可はcapability claimで監査に載せる |
| **機能設計** | D1=A+Bの二段（静的admin bearerはブートストラップ専用の最小権限経路、IdP登録後はcapability claim）。D2=AでSaaSでも管理面を開放し`require_single_tenant_provisioning_surface`を認可判定へ置換。D1=C（ネットワーク分離）はdeployment側の選択として文書化 | 業務: R-3（非機能境界の超過）としてADR-0063/0064で追加したSaaS認証が管理面認可の境界を越えた。データ: D3=AはADR-0062の判断を認証そのものへ一貫適用 |

## 推奨（保守者の判断を拘束しない）

D1=A + Bの二段、D2=A、D3=A を推奨する。

理由: ブートストラップという「IdPがまだ無い」状態が構造的に存在する以上、JWTのみ（B単独）ではD2が閉じない。一方A単独では監査要件が満たせない。したがって「静的admin bearerをブートストラップ専用の最小権限経路として残し、IdP登録後の通常運用はcapability claimで行う」二段構成が、`ADR-0062` のfail-fast方針とも `enterprise_architecture` §06のplane分離要求とも整合する。D3=Aは `ADR-0062` がaccess_control / auditに対して既に採った判断（明示選択したのに設定が無ければ起動を止める）を、認証そのものへ一貫適用するものである。

ただしD1=C（ネットワーク分離）を採る組織も多く、これはdeployment側の選択としてD1=A/Bと排他ではない。Cを「推奨構成」として文書化し、A/Bをアプリ側の最低保証とする整理もありうる。

## ADR-0047 ゲート判定

`ADR-0047` の再起票基準に照らす。

- **R-1（実使用の摩擦）**: 該当しない。ドッグフードログに該当記録はなく、本件はコード監査で発見した。
- **R-3（非機能境界の超過）**: 該当すると考える。 `ADR-0063`/`ADR-0064` で追加したSaaS認証機能が、既存の不変条件（`ADR-0041` CVI、`enterprise_architecture` のplane分離要求）では覆えない管理面認可の境界を越えた。
- **R-2 / R-4**: 該当しない。

R-3該当の是非は保守者が確認すること。非該当と判断される場合、本ADRはRejectedとし、`SEC-ADMIN-PLANE-01` も併せて取り下げる。

## Non-goals

- 認証プロトコル（OIDC/SAML）そのものをアプリへ実装しない（`ADR-0020` 維持）。
- RBAC評価ロジックをアプリ本体へ持ち込まない（`enterprise_architecture` のAccessControlAdapter外部委譲を維持）。
- `local-dev` / `evaluation` profileの開発利便性を損なう変更はしない。

## Traceability

- Implementation: `01_Plans/issues/done/issue-SEC-ADMIN-PLANE-01-admin-surface-authorization-and-saas-bootstrap.md`
- Related: `01_Plans/adr/ADR-0020-oidc-saml-mock-idp-sp-profile.md`（認証の外部委譲）
- Related: `01_Plans/adr/ADR-0062-explicit-http-integration-fail-fast.md`（D3=Aの先例）
- Related: `01_Plans/adr/ADR-0063-saas-multitenant-trusted-auth-edge.md`（本件が露出した経緯）
- Related: `02_Architecture/enterprise_architecture.html` §06（plane分離要求）
- Related: `THREAT_MODEL.md`
