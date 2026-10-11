# ADR-0059: SaaSテナント分離と認可境界を構造化する

- Status: Accepted
- Date: 2026-07-16
- Deciders: Project Maintainer
- Scope: `02_Architecture/`, `03_Implement/backend/`, `03_Implement/frontend/`, `03_Implement/mcp/`, runtime/deploy configuration

## Context

現行のsui-sensemakingは、外部認証と外部PDPへ接続できる、単一デプロイかつ単一組織向けの構成である。`documents.id` はDB全体の主キーであり、永続行、`AuthContext`、`AccessRequest`、ブラウザ保存のどれにもテナントの境界がない。access-controlは、構成によって `noop` へ退避できる。PDPに到達できないときの `read_only` は、読み取りを許可する。これらは、単一組織の内部では可用性の選択肢になりうる。しかし、相互に信頼しない複数の顧客を、同じサービスへ収容するための境界にはならない。

SaaS対応を、画面上のテナント選択や外部PDPのポリシー追加だけで行うと、次の問題が起きうる。

- IDOR
- 一覧、検索、キャッシュからの存在の漏えい
- ワーカーやオブジェクトストレージでの対象範囲の欠落
- 管理者権限の過大化

テナントは役割の一種ではない。データの所在と認可の評価範囲を決める構造的な境界として扱う必要がある。

本ADRは、既存の単一テナントでの利用を維持しながら、将来の共有SaaSプロファイルを安全に実装するための、D5〜D10を固定する。ただし、AcceptedはSaaSの実装が完了したことを意味しない。Implementation gateをすべて満たすまでは、現行の `enterprise-production` を、SaaS対応済みと解釈しない。

## Decision

### D5: TenantContextは、信頼できる入力から解決する

要求ごとに、バックエンドが次の最小の文脈を確定する。

```text
TenantContext
  tenantId
  membershipId
  resolvedBy = verified_claim | trusted_host_mapping
```

- `tenantId` は、不変で不透明な、サーバーが生成するIDとする。表示名を、識別子や認可のキーに使わない。
- アクティブなテナントは、署名、issuer、対象を検証したクレーム、または外部入力を除去できる、信頼できるプロキシやホストのマッピングから解決する。
- ブラウザーのヘッダー、query、path、localStorageの値を、そのまま認可の根拠にしない。複数の所属を持つ利用者によるテナントの選択は、文脈の変更要求にすぎない。バックエンドが所属を再確認して、新しい文脈を発行する。
- プロキシ連携でテナントのヘッダーを使う場合は、外部から届いた同名のヘッダーを境界で削除し、検証済みの値だけを付け直す。
- テナントが不明な場合、候補が複数で一意に解決できない場合、所属が停止中の場合は、読み取りを含めて拒否する。

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

- `User` は、グローバルで不透明なprincipalとし、テナントへの所属は `TenantMembership` で表す。1人が複数のテナントへ所属できる。
- 識別情報の一意性は、曖昧な `provider` 文字列ではなく、検証済みの `identityProviderId + subject` で固定する。`IdentityProvider` は、少なくとも発行者と対象を含む、信頼の設定を識別する。
- テナントが利用できるIdPは、`TenantIdentityProvider` で明示する。発行者が同じだというだけの理由で、別のテナントへの所属を与えない。
- roles/groupsは、IdPやPDPからの一時的な入力のままとし、sui-sensemakingの内部に役割のエディタを作らない。アプリ側は、所属が有効であること、およびテナントが一致することを、構造的な境界として保持する。
- APIキーだけを、SaaS利用者の主体やテナントの証明に使わない。serviceやagentの認証情報は、後述のテナントに束縛した登録に限る。

### D7: テナントに従属するデータを、DB制約と物理的な境界で分離する

- `Document` は、`tenantId, id` を識別の境界とし、`unique(tenantId, id)` または複合主キーを持つ。公開するDocumentのペイロードへ、利用者が編集できる値としてtenantIdを追加しない。
- Documentに従属するテーブルは、tenantIdを重複して保持し、`(tenantId, docId)` の複合外部キーで親へ接続する。docIdだけによる結合、更新、削除を、リポジトリAPIとして提供しない。
- agentの登録、ジョブとキュー、冪等性キー、ページネーションのカーソル、レート制限のキー、検索インデックス、オブジェクトストレージのキー、暗号鍵の参照、監査イベント、バックアップのマニフェストにも、tenantIdを伝播する。
- 共有スキーマ型のSaaSでは、すべての行のtenantIdと複合制約に加えて、PostgreSQL RLSなどのDB側のテナントガードを必須とする。アプリケーションの判定とDBの判定の、どちらか一方だけに依存しない。
- 専用のスキーマ、DB、バケットの型では、物理的な分離をテナントガードとして利用できる。ただし、要求とリソースでテナントが一致するかの検証は維持する。
- SQLite、およびDB側のテナントガードを提供できない構成は、共有スキーマ型のSaaSプロファイルでは使用しない。

### D8: テナントの一致をローカルの不変条件とし、権限の評価を外部PDPの責務とする

認可は次の順序で行う。

1. AuthContextとTenantContextを、信頼できる境界で解決する。
2. active 所属を検証する。
3. リソースを、`tenantId + resourceId` でサーバー側で参照する。
4. 主体のテナントと資源のテナントが一致するかを、アプリ内で検証する。不一致または不明なら、PDPを呼ばずに拒否する。
5. SafeModeや読み取り専用など、ローカルの安全ガードを適用する。
6. 外部PDPで、`document.read` などの権限を評価する。
7. APIで最終的に強制し、tenantIdを含む最小限の監査イベントを残す。

資源側のテナント、visibility、policyRefは、サーバーの正本から取得する。公開クライアントが指定したヘッダーやペイロードを、認可の根拠にしない。

SaaSの実行時プロファイルは、実際に判定できるaccess-controlのアダプターと、`deny` で安全側に倒す設定を必須とする。次のいずれの場合も、起動または要求を安全側で拒否する。

- アダプターの欠損
- `noop`
- PDPのタイムアウト
- 無効な応答
- テナントを解決できないこと

`read_only` のフォールバックでは、読み取りを許可しない。現行の単一テナントプロファイルでは、互換性のために従来の選択肢を維持できる。ただし、SaaSプロファイルと混同できない名称と検証にする。

他のテナントの資源のIDを指定した公開APIは、原則としてnot-foundに相当する応答とし、存在を推測させない。現在のテナント内で認証済みだが権限が足りない場合は、permission deniedとしてよい。内部の監査には、正確な拒否の理由、ポリシーのバージョン、correlation IDを残す。本文、文書のタイトル、tokenは残さない。

### D9: Data Plane、Tenant Admin、Platform Control Planeを分離する

| 面 | 代表権限 | 範囲 | 文書本文・タイトル |
| --- | --- | --- | --- |
| Workspace Data Plane | `document.read/write/export/share` | アクティブなテナントの許可済み資源 | 権限に従う |
| Tenant Admin | `membership.provision`, `agent.register/revoke` | アクティブなテナントだけ | 表示しない |
| Platform Control Plane | `tenant.provision/suspend`, system status | テナントのlifecycleと、秘密を含まない運用metadata | 表示しない |
| Audit | `audit.read` | 明示的に許可されたテナントの固定metadata | 表示しない |

- Platform Control Planeは、Data Planeと、routeの面、認可の対象、権限を分離する。Platformの運用者であることから、文書の読み取りを暗黙に付与しない。
- Tenant Adminは、自分のテナントの所属とagentの登録だけを扱う。platformの権限へ昇格できない。
- フロントエンドは、役割名やgroup名を解釈しない。バックエンドが返す、テナント単位の `effectiveCapabilities` と理由コードを、表示に利用する。APIは、同じ操作を必ず再認可する。
- 権限のキャッシュを持つ場合は、`deployment + tenantId + principalId + policyVersion` でキーを分け、tokenの有効期限を越えて保持しない。所属の停止やポリシーの変更の際に、失効できる設計にする。
- 全テナントの文書一覧、テナントを横断した本文検索、隠れたサポートのなりすまし、恒久的なsuper-readerは、標準の機能にしない。break-glassを導入する場合は、時間制限、目的、承認、通知、監査を、別のADRで扱う。

### D10: 単一テナントとの互換と、SaaSへの移行を分ける

- 既存のデータは、内部の `local-default` テナントへバックフィルする。単一テナントのアダプターがTenantContextを内部で注入し、公開するDocument契約と、通常のローカルでの操作を維持する。
- `enterprise-production` は、当面、単一組織のデプロイ向けのままとする。共有SaaSは別の実行時プロファイルとし、テナントの解決、外部PDP、拒否で安全側に倒す設定、DBのテナントガードのいずれかが欠ける構成を、起動時に拒否する。
- 書き出しには、内部のtenantId、membership、権限を、既定では含めない。取り込みは、移送されたテナントの権限を採用しない。取り込み先のアクティブなテナントで、新規の入力として、認可、検証、人手によるレビューを行う。
- ブラウザーの保存は、`deployment origin + tenantId + principalId` で名前空間を分離する。テナントの切り替えとlogoutの際に、次のものを破棄する。文書、選択、検索、work mode、取り込みのプレビュー、最近使った項目、QueryPreset、要求のキャッシュ、object URL。
- アクティブなテナントは、認証セッションごとに1つとする。複数のタブ、同時の切り替え、bfcache、遅れて届いた応答による古い文脈は、`ADR-0061` のサーバーが発行する `tenantSessionVersion` により、リソースを参照する前に拒否する。クライアント間の通知だけを、安全の境界にしない。
- agentの認証情報は、tenantIdと許可された対象のdocIdへ束縛する。他のテナント、他の文書、別の用途へ再利用できない。token平文は、作成時に一度だけ表示し、保存しない。

## Implementation gate

本ADRがAcceptedになった後も、次を順番に満たすまで、共有SaaSを有効にしない。

1. `schemas.md`、`api.md`、`runtime_parameter_registry.md` へ、TenantContext、capability、SaaSプロファイル、失敗時の応答を、契約を先にして反映する。
2. tenant、identity、所属のマイグレーションと、テナントに従属する全テーブルの複合制約を導入する。
3. リポジトリ、API、MCP、worker、オブジェクトストレージ、監査へ、テナントの必須文脈を伝播する。
4. 共有スキーマのプロファイルでは、DB側のテナントガードを有効にし、接続プールで文脈が漏れないことを検証する。
5. 同じdocIdを持つテナント AとBを使い、GET/PUT/list/search/count/export/share/import/MCP/webhook/job/audit/cache/agentの認証情報について、越境のネガティブマトリクスを、統合テストとE2Eで固定する。
6. サーバー側の `effectiveCapabilities` が利用できるようになった後に、テナントの切り替え、Tenant Admin、Platform Control PlaneをUIへ導入する。

## Alternatives considered

1. **テナントの分離を、外部PDPだけへ委譲する**: DBのクエリ、キャッシュ、ジョブ、バックアップで範囲が欠けるのを防げないため、不採用。
2. **tenantIdをDocumentのペイロードへ追加する**: 利用者が編集できる取り込みと書き出しの値が、認可の境界になるため、不採用。
3. **全資源のIDをグローバルに一意にして、テナントの列を持たない**: 一覧、結合、監査、ストレージでの越境を、構造的に防げない。IDを秘匿しても認可にならないため、不採用。
4. **共有スキーマで、アプリケーションのフィルタだけを使う**: フィルタの漏れが、そのまま越境になる。そのため、SaaSプロファイルでは、DB側のガードとの二重化を必須とする。
5. **Platformの運用者を、全テナントのsuper-userにする**: 運用の権限と顧客データの閲覧を、不要に結び付けるため、不採用。
6. **テナントごとにUserを複製する**: 複数のテナントへの所属と識別情報のlifecycleが不自然になる。そのため、グローバルなUserと所属の分離を採用する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 相互に信頼しない複数の顧客を、同じサービスへ収容するには、テナントをUIのフィルタではなく、構造的な境界として扱う必要がある。テナントが不明な場合と、所属が停止中の場合は、読み取りを含めて拒否する | 機能: 全APIでTenantContextを必須とする。データ: tenantIdはサーバーが生成する不透明なIDとし、表示名を認可のキーにしない |
| **データ設計** | tenantIdを、全リソース（Document、MergeDecisionLog、InquiryBundle、AuditEvent、キャッシュ、オブジェクトストレージのキー）へ伝播する。共有スキーマでは、PostgreSQL RLSなどのDB側のガードを必須とする | 業務: SQLiteは単一テナントに限る。機能: docIdだけによる既存のDBアクセスは、全面的な棚卸しが必要 |
| **機能設計** | TenantContextは、署名、issuer、対象を検証済みのクレーム、または信頼できるプロキシのマッピングからだけ解決する。ブラウザーの入力を認可の根拠にしない。アクティブなテナントは、サーバーが発行するtenantSessionVersionでガードする | データ: tenantIdを、localStorageや表示名から復元しない。業務: テナントの切り替えは文脈の変更要求であり、バックエンドが所属を再確認して新しい文脈を発行する |

## Consequences

- テナントはUIのフィルタではなく、DB、API、認可、キャッシュ、非同期処理、監査を横断する、必須の文脈になる。
- 同じdocIdを複数のテナントで安全に使える。一方、docIdだけを受け取る既存のDBアクセスは、全面的な棚卸しが必要になる。
- 共有スキーマのSaaSではPostgreSQL RLSなどが必要になり、SQLiteはローカルの単一テナントの用途に限られる。
- IdPとの接続、Userの識別情報、TenantMembershipを分離する、マイグレーションと管理APIが必要になる。
- 可用性より機密性を優先するため、SaaSではPDPの障害時に読み取りを継続できない。運用上は、PDPの冗長化と障害の表示が必要になる。
- Platformの運用者が顧客の文書を暗黙に読めないため、サポートの手順は、diagnostics bundleなど、本文を表示しない経路を基本とする。
- UIは、バックエンドの権限契約より先に有効にできない。Claude Design Round 8のSaaS画面は、先行するレッドラインとしてのみ扱う。

## Non-goals

- 本ADRだけで、SaaSの提供や実装の完了を宣言しない。
- 課金、契約プラン、地域配置、テナントの削除、保持期限、SCIMを定義しない。
- roles/groupsを、sui-sensemakingで編集できるマスタにしない。
- サポートによるなりすましやbreak-glassを導入しない。
- Documentのスナップショットの公開ペイロードを、テナント単位のテーブルへ正規化しない。

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
