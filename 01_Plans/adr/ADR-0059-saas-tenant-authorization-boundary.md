# ADR-0059: SaaSテナント分離と認可境界を構造化する

- Status: Accepted
- Date: 2026-07-16
- Deciders: Project Maintainer
- Scope: `02_Architecture/`, `03_Implement/backend/`, `03_Implement/frontend/`, `03_Implement/mcp/`, runtime/deploy configuration

## Context

現行のsui-sensemakingは、外部認証と外部PDPへ接続できる、単一デプロイかつ単一組織向けの構成である。`documents.id` はDB全体の主キーであり、永続行、`AuthContext`、`AccessRequest`、ブラウザ保存のどれにもtenantの境界がない。access-controlは、構成によって `noop` へ退避できる。PDPに到達できないときの `read_only` は、readを許可する。これらは、単一組織の内部では可用性の選択肢になりうる。しかし、相互に信頼しない複数の顧客を、同じサービスへ収容するための境界にはならない。

SaaS対応を、画面上のtenant選択や外部PDPのポリシー追加だけで行うと、次の問題が起きうる。

- IDOR
- 一覧、検索、キャッシュからの存在の漏えい
- workerやオブジェクトストレージでのscopeの欠落
- 管理者権限の過大化

tenantはroleの一種ではない。データの所在と認可の評価範囲を決める構造的な境界として扱う必要がある。

本ADRは、既存のsingle-tenantでの利用を維持しながら、将来の共有SaaSプロファイルを安全に実装するための、D5〜D10を固定する。ただし、AcceptedはSaaSの実装が完了したことを意味しない。Implementation gateをすべて満たすまでは、現行の `enterprise-production` を、SaaS対応済みと解釈しない。

## Decision

### D5: TenantContextは、信頼できる入力から解決する

requestごとに、backendが次の最小のcontextを確定する。

```text
TenantContext
  tenantId
  membershipId
  resolvedBy = verified_claim | trusted_host_mapping
```

- `tenantId` は、不変で不透明な、サーバーが生成するIDとする。表示名を、識別子や認可のキーに使わない。
- active tenantは、署名、issuer、audienceを検証したclaim、または外部入力を除去できる、信頼できるプロキシやホストのマッピングから解決する。
- browserのheader、query、path、localStorageの値を、そのまま認可の根拠にしない。複数のmembershipを持つ利用者によるtenantの選択は、contextの変更要求にすぎない。backendがmembershipを再確認して、新しいcontextを発行する。
- プロキシ連携でtenantのheaderを使う場合は、外部から届いた同名のheaderを境界で削除し、検証済みの値だけを付け直す。
- tenantが不明な場合、候補が複数で一意に解決できない場合、membershipが停止中の場合は、readを含めてdenyする。

### D6: IdentityとTenantMembershipを分離する

論理モデルは次を基準にする。

```text
Tenant(id, displayName, lifecycleState, ...)
IdentityProvider(id, issuer, audience, lifecycleState, ...)
TenantIdentityProvider(tenantId, identityProviderId, lifecycleState, ...)
User(id, lifecycleState, ...)
UserIdentity(userId, identityProviderId, subject, ...)
TenantMembership(tenantId, userId, lifecycleState, ...)
```

- `User` は、グローバルで不透明なprincipalとし、tenantへの所属は `TenantMembership` で表す。1人が複数のtenantへ所属できる。
- identityの一意性は、曖昧な `provider` 文字列ではなく、検証済みの `identityProviderId + subject` で固定する。`IdentityProvider` は、少なくともissuerとaudienceを含む、信頼の設定を識別する。
- tenantが利用できるIdPは、`TenantIdentityProvider` で明示する。issuerが同じだというだけの理由で、別のtenantへのmembershipを与えない。
- roles/groupsは、IdPやPDPからの一時的な入力のままとし、sui-sensemakingの内部にroleのエディタを作らない。アプリ側は、membershipが有効であること、およびtenantが一致することを、構造的な境界として保持する。
- API keyだけを、SaaS利用者の主体やtenantの証明に使わない。serviceやagentの認証情報は、後述のtenantに束縛した登録に限る。

### D7: tenantに従属するデータを、DB制約と物理的な境界で分離する

- `Document` は、`tenantId, id` を識別の境界とし、`unique(tenantId, id)` または複合主キーを持つ。公開するDocumentのpayloadへ、利用者が編集できる値としてtenantIdを追加しない。
- Documentに従属するテーブルは、tenantIdを重複して保持し、`(tenantId, docId)` の複合外部キーで親へ接続する。docIdだけによる結合、更新、削除を、リポジトリAPIとして提供しない。
- agentの登録、ジョブとキュー、冪等性キー、ページネーションのカーソル、レート制限のキー、検索インデックス、オブジェクトストレージのキー、暗号鍵の参照、監査イベント、バックアップのマニフェストにも、tenantIdを伝播する。
- 共有スキーマ型のSaaSでは、すべての行のtenantIdと複合制約に加えて、PostgreSQL RLSなどのDB側のtenantガードを必須とする。アプリケーションの判定とDBの判定の、どちらか一方だけに依存しない。
- 専用のスキーマ、DB、バケットの型では、物理的な分離をtenantガードとして利用できる。ただし、requestとresourceでtenantが一致するかの検証は維持する。
- SQLite、およびDB側のtenantガードを提供できない構成は、共有スキーマ型のSaaSプロファイルでは使用しない。

### D8: tenantの一致をローカルの不変条件とし、capabilityの評価を外部PDPの責務とする

認可は次の順序で行う。

1. AuthContextとTenantContextを、信頼できる境界で解決する。
2. active membershipを検証する。
3. resourceを、`tenantId + resourceId` でサーバー側で参照する。
4. 主体のtenantと資源のtenantが一致するかを、アプリ内で検証する。不一致または不明なら、PDPを呼ばずにdenyする。
5. SafeModeやread-onlyなど、ローカルの安全ガードを適用する。
6. 外部PDPで、`document.read` などのcapabilityを評価する。
7. APIで最終的に強制し、tenantIdを含む最小限の監査イベントを残す。

資源側のtenant、visibility、policyRefは、サーバーの正本から取得する。公開クライアントが指定したheaderやpayloadを、認可の根拠にしない。

SaaSの実行時プロファイルは、実際に判定できるaccess-controlのadapterと、`deny` で安全側に倒す設定を必須とする。次のいずれの場合も、起動またはrequestを安全側で拒否する。

- adapterの欠損
- `noop`
- PDPのタイムアウト
- 無効な応答
- tenantを解決できないこと

`read_only` のフォールバックでは、readを許可しない。現行のsingle-tenantプロファイルでは、互換性のために従来の選択肢を維持できる。ただし、SaaSプロファイルと混同できない名称と検証にする。

他のtenantの資源のIDを指定した公開APIは、原則としてnot-foundに相当する応答とし、存在を推測させない。現在のtenant内で認証済みだがcapabilityが足りない場合は、permission deniedとしてよい。内部の監査には、正確なdenyの理由、ポリシーのバージョン、correlation IDを残す。本文、文書のタイトル、tokenは残さない。

### D9: Data Plane、Tenant Admin、Platform Control Planeを分離する

| 面 | 代表capability | 範囲 | 文書本文・タイトル |
| --- | --- | --- | --- |
| Workspace Data Plane | `document.read/write/export/share` | active tenantの許可済み資源 | capabilityに従う |
| Tenant Admin | `membership.provision`, `agent.register/revoke` | active tenantだけ | 表示しない |
| Platform Control Plane | `tenant.provision/suspend`, system status | tenantのlifecycleと、秘密を含まない運用metadata | 表示しない |
| Audit | `audit.read` | 明示的に許可されたtenantの固定metadata | 表示しない |

- Platform Control Planeは、Data Planeと、routeの面、認可のaudience、capabilityを分離する。Platformの運用者であることから、文書のreadを暗黙に付与しない。
- Tenant Adminは、自分のtenantのmembershipとagentの登録だけを扱う。platformのcapabilityへ昇格できない。
- frontendは、role名やgroup名を解釈しない。backendが返す、tenant単位の `effectiveCapabilities` と理由コードを、表示に利用する。APIは、同じ操作を必ず再認可する。
- capabilityのキャッシュを持つ場合は、`deployment + tenantId + principalId + policyVersion` でキーを分け、tokenの有効期限を越えて保持しない。membershipの停止やポリシーの変更の際に、失効できる設計にする。
- 全tenantの文書一覧、tenantを横断した本文検索、隠れたサポートのなりすまし、恒久的なsuper-readerは、標準の機能にしない。break-glassを導入する場合は、時間制限、目的、承認、通知、監査を、別のADRで扱う。

### D10: single-tenantとの互換と、SaaSへの移行を分ける

- 既存のデータは、内部の `local-default` tenantへバックフィルする。single-tenantのadapterがTenantContextを内部で注入し、公開するDocument契約と、通常のローカルでの操作を維持する。
- `enterprise-production` は、当面、単一組織のデプロイ向けのままとする。共有SaaSは別の実行時プロファイルとし、tenantの解決、外部PDP、denyで安全側に倒す設定、DBのtenantガードのいずれかが欠ける構成を、起動時に拒否する。
- exportには、内部のtenantId、membership、capabilityを、既定では含めない。importは、移送されたtenantの権限を採用しない。import先のactive tenantで、新規の入力として、認可、検証、人手によるレビューを行う。
- browserの保存は、`deployment origin + tenantId + principalId` で名前空間を分離する。tenantの切り替えとlogoutの際に、次のものを破棄する。文書、選択、検索、work mode、importのプレビュー、最近使った項目、QueryPreset、requestのキャッシュ、object URL。
- active tenantは、認証sessionごとに1つとする。複数のタブ、同時の切り替え、bfcache、遅れて届いたresponseによる古いcontextは、`ADR-0061` のサーバーが発行する `tenantSessionVersion` により、resourceを参照する前に拒否する。クライアント間の通知だけを、安全の境界にしない。
- agentの認証情報は、tenantIdと許可された対象のdocIdへ束縛する。他のtenant、他の文書、別の用途へ再利用できない。token平文は、作成時に一度だけ表示し、保存しない。

## Implementation gate

本ADRがAcceptedになった後も、次を順番に満たすまで、共有SaaSを有効にしない。

1. `schemas.md`、`api.md`、`runtime_parameter_registry.md` へ、TenantContext、capability、SaaSプロファイル、失敗時の応答を、契約を先にして反映する。
2. tenant、identity、membershipのマイグレーションと、tenantに従属する全テーブルの複合制約を導入する。
3. リポジトリ、API、MCP、worker、オブジェクトストレージ、監査へ、tenantの必須contextを伝播する。
4. 共有スキーマのプロファイルでは、DB側のtenantガードを有効にし、接続プールでcontextが漏れないことを検証する。
5. 同じdocIdを持つtenant AとBを使い、GET/PUT/list/search/count/export/share/import/MCP/webhook/job/audit/cache/agentの認証情報について、越境のネガティブマトリクスを、統合テストとE2Eで固定する。
6. サーバー側の `effectiveCapabilities` が利用できるようになった後に、tenantの切り替え、Tenant Admin、Platform Control PlaneをUIへ導入する。

## Alternatives considered

1. **tenantの分離を、外部PDPだけへ委譲する**: DBのクエリ、キャッシュ、ジョブ、バックアップでscopeが欠けるのを防げないため、不採用。
2. **tenantIdをDocumentのpayloadへ追加する**: 利用者が編集できるimportとexportの値が、認可の境界になるため、不採用。
3. **全資源のIDをグローバルに一意にして、tenantの列を持たない**: 一覧、結合、監査、ストレージでの越境を、構造的に防げない。IDを秘匿しても認可にならないため、不採用。
4. **共有スキーマで、アプリケーションのフィルタだけを使う**: フィルタの漏れが、そのまま越境になる。そのため、SaaSプロファイルでは、DB側のガードとの二重化を必須とする。
5. **Platformの運用者を、全tenantのsuper-userにする**: 運用の権限と顧客データの閲覧を、不要に結び付けるため、不採用。
6. **tenantごとにUserを複製する**: 複数のtenantへの所属とidentityのlifecycleが不自然になる。そのため、グローバルなUserとmembershipの分離を採用する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 相互に信頼しない複数の顧客を、同じサービスへ収容するには、tenantをUIのフィルタではなく、構造的な境界として扱う必要がある。tenantが不明な場合と、membershipが停止中の場合は、readを含めてdenyする | 機能: 全APIでTenantContextを必須とする。データ: tenantIdはサーバーが生成する不透明なIDとし、表示名を認可のキーにしない |
| **データ設計** | tenantIdを、全リソース（Document、MergeDecisionLog、InquiryBundle、AuditEvent、キャッシュ、オブジェクトストレージのキー）へ伝播する。共有スキーマでは、PostgreSQL RLSなどのDB側のガードを必須とする | 業務: SQLiteはsingle-tenantに限る。機能: docIdだけによる既存のDBアクセスは、全面的な棚卸しが必要 |
| **機能設計** | TenantContextは、署名、issuer、audienceを検証済みのclaim、または信頼できるプロキシのマッピングからだけ解決する。browserの入力を認可の根拠にしない。active tenantは、サーバーが発行するtenantSessionVersionでガードする | データ: tenantIdを、localStorageや表示名から復元しない。業務: tenantの切り替えはcontextの変更要求であり、backendがmembershipを再確認して新しいcontextを発行する |

## Consequences

- tenantはUIのフィルタではなく、DB、API、認可、キャッシュ、非同期処理、監査を横断する、必須のcontextになる。
- 同じdocIdを複数のtenantで安全に使える。一方、docIdだけを受け取る既存のDBアクセスは、全面的な棚卸しが必要になる。
- 共有スキーマのSaaSではPostgreSQL RLSなどが必要になり、SQLiteはローカルのsingle-tenantの用途に限られる。
- IdPとの接続、Userのidentity、TenantMembershipを分離する、マイグレーションと管理APIが必要になる。
- 可用性より機密性を優先するため、SaaSではPDPの障害時にreadを継続できない。運用上は、PDPの冗長化と障害の表示が必要になる。
- Platformの運用者が顧客の文書を暗黙に読めないため、サポートの手順は、diagnostics bundleなど、本文を表示しない経路を基本とする。
- UIは、backendのcapability契約より先に有効にできない。Claude Design Round 8のSaaS画面は、先行するレッドラインとしてのみ扱う。

## Non-goals

- 本ADRだけで、SaaSの提供や実装の完了を宣言しない。
- 課金、契約プラン、地域配置、tenantの削除、保持期限、SCIMを定義しない。
- roles/groupsを、sui-sensemakingで編集できるマスタにしない。
- サポートによるなりすましやbreak-glassを導入しない。
- Documentのスナップショットの公開payloadを、tenant単位のテーブルへ正規化しない。

## Traceability

- Research: `01_Plans/research/research-2026-07-16-saas-tenant-authorization-boundary.md`
- Related: `02_Architecture/enterprise_architecture.html`
- Related: `02_Architecture/data_model_operations_overview.html`
- Related: `02_Architecture/runtime_parameter_registry.md`
- Related: `THREAT_MODEL.md`
- Related UI: `02_Architecture/design/master-data-settings-ui-ux-concept.md`
- Related design request: `02_Architecture/design/design-request-2026-07-round8.md`
- Implementation: `01_Plans/issues/done/issue-SAAS-TENANT-01-tenant-context-and-storage-foundation.md`
- Related governance: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`
- Follow-up boundary: `01_Plans/adr/ADR-0061-saas-active-tenant-session-concurrency.md`
