# Identity Broker Setup (Phase 2)

このディレクトリはsui-sensemakingのSaaSマルチテナント認証に必要な
identity brokerのセットアップ参考手順を提供する。

## アーキテクチャ

```
┌──────────┐  SAML/OIDC  ┌──────────┐  Signed JWT   ┌──────────┐
│ Ext IdP  │ ──────────→ │ Keycloak │ ────────────→ │ sui-sensemaking │
│ (Google) │             │ (Broker) │               │ Backend  │
└──────────┘             └──────────┘               └──────────┘
```

- **Keycloak**: 複数IdPを集約し、SAML→OIDC変換、JWT発行、tenant claim注入
- **sui-sensemaking**: JWT検証、tenant解決、認可

## 1. Keycloak 起動

```bash
cd 03_Implement/deploy/broker
docker-compose up -d
```

初回起動後、管理コンソールは http://localhost:18080 でアクセス可能。
デフォルト管理者: `admin` / `admin`（`docker-compose.yml` の `KEYCLOAK_ADMIN` 参照）。

## 2. Realm 作成

1. Keycloak管理コンソールにログイン
2. "Create Realm" → Realm name: `sui-sensemaking`
3. Realm 設定:
   - Login タブ: "User registration" = OFF
   - Tokens タブ: "Default Signature Algorithm" = RS256

## 3. Client 作成 (sui-sensemaking Backend)

1. Realm `sui-sensemaking` → Clients → Create client
2. Client ID: `sui-sensemaking-backend`
3. Client type: OpenID Connect (OIDC)
4. Settings:
   - **Access Type**: confidential
   - **Standard Flow Enabled**: ON (authorization code grant)
   - **Direct Access Grants Enabled**: OFF
   - **Valid Redirect URIs**: `http://localhost:5173/*`（frontend dev server）
   - **Web Origins**: `http://localhost:5173`
5. Advanced:
   - **Proof Key for Code Exchange (PKCE) Code Challenge Method**: S256
6. Save → CredentialsタブでClient Secretを控える

## 4. Tenant Claim マッパー設定

sui-sensemakingはJWTの `tenant_ref` claimでテナントを識別する。
Keycloakでこのclaimを発行するマッパーを設定する。

1. Client `sui-sensemaking-backend` → Client scopes
2. `sui-sensemaking-backend-dedicated` → Add mapper → "By configuration"
3. Mapper type: User Attribute
4. Settings:
   - Name: `tenant_ref`
   - User Attribute: `tenant_ref`
   - Token Claim Name: `tenant_ref`
   - Claim JSON Type: String
   - Add to ID token: ON
   - Add to access token: ON
   - Add to userinfo: ON

## 5. ユーザー作成と Tenant 属性設定

1. Users → Add user
   - Username: `alice`
   - Email: `alice@example.com`
2. 作成後、Attributesタブで `tenant_ref` = `org-123` を追加
3. Credentialsタブでパスワードを設定（Temporary = OFF）

## 6. Google OAuth 2.0 / OIDC 連携 (Identity Provider)

1. Google Cloud ConsoleでOAuth 2.0 Client IDを作成
   - Authorized redirect URIs: `http://localhost:18080/realms/sui-sensemaking/broker/google/endpoint`
2. Keycloak Realm `sui-sensemaking` → Identity Providers → Add provider → Google
3. Settings:
   - Client ID: (Googleから取得)
   - Client Secret: (Googleから取得)
   - Enabled: ON
   - Store Tokens: ON
   - Stored Tokens Readable: ON
4. Mappers タブ:
   - Add mapper: Attribute Importer
   - Claim: `hd` (Google hosted domain)
   - User Attribute: `tenant_ref`
   - または `email` からマッピングルールを設定

## 7. SAML IdP 連携

1. Realm `sui-sensemaking` → Identity Providers → Add provider → SAML v2.0
2. Settings:
   - Alias: `saml-customer`
   - Service Provider Entity ID: `sui-sensemaking`
   - Single Sign-On Service URL: (SAML IdPから取得)
   - NameID Policy Format: `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress`
3. Mappers タブ:
   - NameID → `email` にマップ
   - 属性 → `tenant_ref` にマップ

## 8. sui-sensemaking 側の設定

### 8.1 環境変数

```bash
export SUI_RUNTIME_PROFILE=saas-multitenant
export SUI_DATABASE_URL=postgresql://...
export SUI_ALLOW_JIT_PROVISIONING=false
export SUI_ACCESS_CONTROL_ADAPTER=external_http
export SUI_ACCESS_CONTROL_FAIL_SAFE_MODE=deny
export SUI_DOCUMENT_POLICY_BINDING_RESOLVER=external_http
export SUI_TENANT_CAPABILITY_RESOLVER=external_http
export SUI_JWT_ALGORITHMS=RS256,ES256
export SUI_TENANT_CLAIM_NAME=tenant_ref
```

### 8.2 Identity Provider 登録 (Admin API)

```bash
# 1. IdP 登録
curl -X POST http://localhost:18000/admin/provision/identity-providers \
  -H "Content-Type: application/json" \
  -d '{
    "issuer": "http://localhost:18080/realms/sui-sensemaking",
    "audience": "sui-sensemaking-backend",
    "protocol": "oidc",
    "jwksUri": "http://localhost:18080/realms/sui-sensemaking/protocol/openid-connect/certs"
  }'

# 2. Tenant 紐付け（external_tenant_ref が JWT の tenant_ref と一致すること）
curl -X POST http://localhost:18000/admin/provision/tenant-identity-providers \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-a",
    "identityProviderId": "idp-xxxxxxxxxxxx",
    "externalTenantRef": "org-123"
  }'
```

## 9. 動作確認

### 9.1 OIDC Discovery

```bash
curl http://localhost:18080/realms/sui-sensemaking/.well-known/openid-configuration | jq .
```

### 9.2 認可コードグラント

```bash
# 1. 認可エンドポイントへリダイレクト（ブラウザで開く）
open "http://localhost:18080/realms/sui-sensemaking/protocol/openid-connect/auth?\
response_type=code&\
client_id=sui-sensemaking-backend&\
redirect_uri=http://localhost:5173/callback&\
scope=openid&\
code_challenge=BASE64URL(SHA256(code_verifier))&\
code_challenge_method=S256"

# 2. 認可コードでトークン交換
curl -X POST http://localhost:18080/realms/sui-sensemaking/protocol/openid-connect/token \
  -d "grant_type=authorization_code" \
  -d "code=<authorization_code>" \
  -d "redirect_uri=http://localhost:5173/callback" \
  -d "client_id=sui-sensemaking-backend" \
  -d "client_secret=<client_secret>" \
  -d "code_verifier=<code_verifier>"
```

### 9.3 JWT で sui-sensemaking API アクセス

```bash
JWT="<access_token from above>"

curl http://localhost:18000/docs/shared-doc \
  -H "X-Sui-Sensemaking-Authorization: Bearer $JWT" \
  -H "Sui-Sensemaking-Tenant-Session-Version: <session_version>"
```

## 10. Level 3 E2E テスト（将来計画）

実Keycloak brokerを含むE2Eテストは、以下の理由で別ADR/Phaseで扱う:

1. Keycloakの起動には10-30秒かかり、CIではセットアップ時間が課題
2. Keycloakの状態管理（realm, client, userの自動作成）が必要
3. テスト間の分離（realmのreset）の設計が必要
4. Docker-in-Dockerまたはservice containerの構成が必要

一時的な検証には上記の手動手順を使用する。
