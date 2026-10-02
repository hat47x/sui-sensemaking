# ADR-0080: IdP不問・個人単位のゲスト受入プリミティブ

- Status: Accepted
- Date: 2026-08-25
- Accepted: 2026-08-26（D1=多方式対応（A2） / D2=A（`guest_principals`+`guest_document_grants`） / D3=A / D4=A。保守者による明示承認。仮承認ではない）
- Deciders: Maintainer
- Scope: `03_Implement/backend/src/sui_sensemaking_api/tenant_context.py`, `models.py`（新規table候補）, `trusted_auth_edge.py`, `02_Architecture/schemas.md`, `02_Architecture/api.md`, `THREAT_MODEL.md`

## 採択記録（2026-08-26）

保守者の明示承認によりProposed → Accepted。採択内容は以下のとおり、原案から2点補正されている。

1. **D1補正**: 原案は単一方式（単回短命リンク）を推奨したが、保守者の指示により複数方式を選択可能にする（詳細はD1節）。明確に排除するのは「いかなるIdPも要求しない」方式のみ。
2. **要求2の文言補正**: 当初要求2（`post-mvp-business-scope-design-program.html` §18／`issue-PGM-ITER-05-03`）の「組織IdP外のユーザーに対応する」は、「受入先テナント自身の企業IdPは要求しないが、ゲスト自身は何らかのIdP（自分の所属組織のIdPまたは汎用個人アカウント）を持つことを前提とする」という趣旨に補正した。該当箇所は別途更新する。
3. **D2補正**: 保守者の指示（関数従属性再検査・サロゲートキー必要性の明示）を受け、原案の`guest_invitations`単独ではなく、`guest_principals`（招待〜redeem〜失効のライフサイクルを持つ個人identity本体）と`guest_document_grants`の2テーブルへ設計を精緻化した（D2節およびFD再検査節を参照）。テーブル数は原案の2件から変わらない。

## Context

`issue-PGM-ITER-05-03`は、Maintainerが2026-08-25に直接指示した4つの確定要求を扱う（`post-mvp-business-scope-design-program.html` §18）。

1. 組織間だけでなく、小規模の個人間利用もサポートする。
2. 行政・企業等が、市民や外部協力者のような組織IdP外のユーザーを受け入れられる。
3. 組織IdP外ユーザーの受付可否を、テナント全体より詳細な単位で制御できる。
4. 既定は拒否。既定の共有対象ドキュメントは0件。

これらは再検討の対象ではない（同issue「実施しないこと」）。本ADRの論点はどう実現するかである。

コードで確認した事実: `resolve_verified_claim_tenant_context()`（`tenant_context.py:188-227`）は、verified claimの`tenant_id`に対して`tenant_identity_providers`が`(tenant, identity_provider)`単位でactiveであることを要求し、そこから`user_identities`（`identity_provider_id + subject`）経由でしか個人を解決できない。IdPを持たない個人を表現する経路が構造的に存在しない。 `issue-PGM-ITER-05-02`（外部比較調査、`02_Architecture/cross-tenant-sharing-external-comparison-2026-08-25.html`）の結論（§0）は、比較した4製品のうち3製品（Slack・Microsoft・Google）が「組織単位の信頼」と「個人単位の信頼」を別々のプリミティブとして持ち、Notionは組織単位の信頼という概念自体を持たない、という点で一致することを示した。sui-sensemakingはこの4製品のいずれとも異なり、個人単位の信頼を組織単位の信頼から独立に表現できない。

## 決定すべき論点

- **D1**: IdPを持たない個人が、そもそもどう認証するか（ゲスト自身の本人確認手段）。
- **D2**: 個人単位の信頼レコードの形（テーブル設計）。
- **D3**: 既定拒否・既定ゼロ件を、どの層で構造的に保証するか。
- **D4**: 招待の取り消し・失効を、招待した側が相手の状態と無関係に単独で実行できる保証をどこに置くか。

## 選択肢

### D1: ゲスト本人確認の手段

**2026-08-26補正**: 原案は単一方式（下記A案）を推奨したが、保守者は複数方式を選択可能にする方針を採った。要求2の文言も「受入先テナント自身の企業IdPは不要だが、ゲスト自身は何らかのIdP（自分の所属組織のIdP、または汎用個人アカウント）を持つ」という趣旨に補正されたため（採択記録2参照）、「いかなるIdPも要求しない」方式（下記A案単独運用）は採用しない。

`issue-PGM-ITER-05-02`の調査結果: Microsoft Entra B2Bはゲスト自身の所属組織のIdPで認証させ、リソース側テナントは認可だけを個人単位オブジェクトで管理する（認証と認可の分離）。Notion/Google/Slackのゲスト機構は、より緩い個人単位の信頼（メールアドレス単位、IdP不問）を提供する。

| 案 | 内容 | 位置づけ |
|---|---|---|
| **A1（採用）** | ゲスト自身の**所属組織のIdPへ連携**させる（Microsoft Entra B2B型）。ゲストが自組織のIdPで認証し、招待先テナントは認証結果（issuer/subject）だけを個人単位オブジェクトへ束ねる | 組織に所属する外部協力者（企業間コラボレーション）に対応する主経路 |
| **A2（採用）** | ゲストが**汎用個人アカウント**（Google/Microsoft/GitHub等の個人OAuthアカウント）でログインする | 組織に属さない市民・個人（行政サービスの利用者等）に対応する経路。「受入先テナント自身の企業IdPは不要」という補正後の要求2を満たす |
| B（将来拡張の余地として残す） | メールアドレス宛の単回コード（OTP）等、A1/A2が使えない場合の補助手段 | 本ADRでは方式を1つに固定しないという方針のみを決定し、個々の追加方式の要否・実装順は`issue-PGM-ITER-05-03`のAC-3以降で判断する |
| C（不採用） | 「いかなるIdPも要求しない」単回リンクのみで受諾させる方式 | 補正後の要求2は「ゲスト自身が何らかのIdPを持つこと」を前提とするため、単独の受入経路としては採用しない。ただしA1/A2いずれの認証も、既存の`ADR-0074`が確立したserver-owned session境界と同じ形で短命sessionへ交換する運用は維持する |

この結果、本ADRのデータ設計（D2）は「ゲストがどの方式で認証したか」を単一の固定形ではなく、検証方式を区別する属性を持つ拡張可能な形で保持する必要がある（D2節・FD再検査節を参照）。

### D2: 個人単位の信頼レコードの形

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A（採用・下記FD再検査で精緻化）** | 新規2テーブル（`guest_principals`＋`guest_document_grants`、具体形はFD再検査節を参照）を追加し、既存の`tenant_identity_providers`・`user_identities`とは独立させる | 「テナント全体のIdP信頼」と「個人単位・文書単位の信頼」が構造的に別テーブルになり、要求2・3が求める分離をデータ設計そのもので表現できる。`ADR-0073`のD1（`created_by`は不変事実）と同型のパターンを再利用できる | 新規テーブル・新規migrationが要る |
| B | `tenant_identity_providers`に「IdPなし」を表す特殊行を許容する | 新規テーブル不要 | **却下**。「テナント単位の全体信頼」を表すテーブルの意味を「個人単位・文書単位の信頼」に上書きすることになり、要求2・3が指摘した粒度混在の欠陥を別の場所で再生産する |
| C | ゲストを通常の`UserRow`＋`TenantMembershipRow`（`membership_kind=guest`フラグ付き）として表現する | 既存のmembership解決経路を流用できる | **却下**。`list_active_tenant_summaries`等、既存コードは`TenantMembershipRow`の存在を「そのテナントに（何らかの形で）所属する」の意味で使っている。ゲストをここに混ぜると、文書単位の絞り込みを後付けし忘れた経路がテナント全体相当の可視性を暗黙に与えるリスクを生む（要求4のゼロ件既定に反する） |

### D2の関数従属性再検査（`functional-dependency-integrity-2026-08-06.html`の枠組みを適用）

保守者の指示に基づき、D2=Aの初稿（`guest_invitations` + `guest_document_grants`の2テーブル）を関数従属性 `x → y`（xの値がyの値を一意に決める関係）の観点で再検査した。同分析手法の枠組み（§1.1）に従い、対象を「システム内世界の確定事実」（招待・redeem・失効・権限付与のいずれも確定事実であり適用対象）に限定する。

**発見した問題**: 初稿の`guest_invitations`は「招待という手続き」と「redeem後の個人identity」という2つの異なる関数従属性を1つのテーブルへ混在させていた。

- 手続き面のFD: `invitation_id → (invited_email, status, expires_at, created_by)`
- identity面のFD: `guest_principal_id → (verified_issuer, verified_subject, verification_method)`

同じ人物が同一テナント内で複数回招待される場合（例: 別の管理者が別の文書について後日再度招待する）、この2つのFDを1テーブルに混在させたまま素朴に「招待ごとに新規行」とすると、同一人物に対して`guest_principal_id`が複数生成され、`guest_document_grants`が人物単位で集約できなくなる（`functional-dependency-integrity-2026-08-06.html` F-3が指摘した「同一関係の複数箇所保持」と同型の問題）。

**是正**: 「招待」と「identity」を同じライフサイクルを持つ1つの実体として統合し、テーブル数は増やさずに`guest_invitations`を`guest_principals`へ改称・再定義する。「再招待」は新しい行を作らず、既存`guest_principals`行への`guest_document_grants`追加として表現する（招待は`(tenant_id, invited_email)`の一意制約でdedupする）。

```
guest_principals (
  guest_principal_id   -- サロゲートキー（必要性は次段落）
  tenant_id
  invited_email         -- 招待時点の宛先。redeem後も不変事実として保持
  status                 -- pending / active / revoked
  verification_method    -- home_org_idp / personal_account（D1のA1/A2に対応。将来のB追加に備え列挙型で拡張可能にする）
  verified_issuer        -- redeem後のみ非NULL
  verified_subject        -- redeem後のみ非NULL
  created_by, created_at, expires_at, redeemed_at, revoked_at
  UNIQUE (tenant_id, invited_email)
  UNIQUE (tenant_id, verified_issuer, verified_subject) WHERE verified_subject IS NOT NULL
)

guest_document_grants (
  tenant_id, guest_principal_id, doc_id   -- 複合主キー（自然キー。サロゲート不要）
  granted_by, granted_at, revoked_at
  FOREIGN KEY (tenant_id, guest_principal_id) REFERENCES guest_principals
)
```

**サロゲートキーの必要性（`guest_principals.guest_principal_id`）**: この列だけは自然キーで代替できない。理由は、この実体を一意に識別する属性集合がライフサイクルの途中で変わるためである——pending状態では`invited_email`しか分からず、redeem後に初めて`(verified_issuer, verified_subject)`という暗号学的に検証済みの識別子が確定する。`guest_document_grants`側の外部キーは、この2つのどちらの時点でも変化しない安定した参照先を必要とする。もし`(tenant_id, invited_email)`を主キーにすると、redeem後に実際に認証されたアカウントのメールアドレスが招待メールと一致しない場合（多くのOAuthプロバイダで許容される）に破綻する。既存コードの`UserRow`（サロゲート`user_id`）と`UserIdentityRow`（`identity_provider_id + subject`）を分離した先例と同型の必要性であり、本ADR独自の判断ではない。`guest_document_grants`側は逆に、複合自然キー（どの人物がどの文書にアクセスできるか、という関係そのもの）で十分であり、追加のサロゲートキーは不要と判断する。

**確認した「禁止したい関数従属性」**: `tenant_id → (guest_principalが読める文書集合)`という関数従属性は存在してはならない。`guest_principals`の存在（pending/active/revokedいずれの状態でも）単独では、いかなる文書へのアクセスも決定しない。アクセスは`guest_document_grants`の一致行の有無だけで決まる（D3）。同様に、`tenant_identity_providers`（テナント全体のIdP信頼）から`guest_principals`への参照・派生も存在しない——2つの信頼プリミティブは意図的に非連動である。

### D3: 既定拒否・既定ゼロ件の保証層

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A** | `guest_document_grants`に**一致する行がある場合のみ**アクセスを許可する構造的deny-by-default。ゲストprincipalに対して、tenant-wide fallbackや「その他の文書も見える」経路を一切実装しない。既存の`_require_active_tenant`・PostgreSQL RLSのfail-closed方針と同型 | 「見えるのは明示的に付与された文書だけ」がデータモデルの構造から導かれ、実装の見落としに依存しない | なし（既存方針との一貫性が高い） |
| B | capability/PDPのpolicy設定で既定拒否を表現する | 既存のcapability機構と統一的に扱える | 設定依存になり、`ADR-0062`が繰り返し指摘してきた「明示選択のfail-fast」ではなく「設定忘れがfail-open」になるリスクを再導入する |

### D4: 取り消し・失効の独立性

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A** | `guest_document_grants.revoked_at`／`guest_invitations.status=revoked`は**招待した側のテナントだけが**書き込める状態遷移とし、ゲスト側の同意・応答を待たない。書き込み後は次回以降の全requestで即時反映（`ADR-0074`の`tenantSessionVersion`と同型のCAS更新） | `issue-PGM-ITER-05-02`が確認したMicrosoft Entra B2Bの先例（リソース側テナントが単独で無効化できる）と一致する | 既発行済みの短命session（D1）が期限切れまで残る可能性がある（Entraも同じ残存リスクを公式に認めている。§検証で明示し、隠さない） |
| B | 取り消しにゲスト側の確認応答を要求する | なし | **却下**。要求されている「相手側の状態と無関係に単独で取り消せる」に反する |

## Three-Element Verification（ADR-0067・着工前チェックリスト適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | CHK-B1: 現行は個人単位・IdP不問の受入journeyが構造的に不可能（「あったほうがいい」ではなく皆無）。CHK-B4: 招待できる利用者種別はテナント側の`document.write`または新設capabilityを持つ主体に限る（ゲスト自身に招待権限は与えない）。CHK-B5: ゲストの無効化（招待取り消し）時、当該ゲストが見ていた文書の可視性は即時失われる（D4） | データ: D2でtenant-wide信頼と個人単位信頼を別テーブルに分離することを要求する。機能: D3でdeny-by-defaultの構造化を要求する |
| **データ設計** | CHK-D1: 新規データの正本はサーバー（`guest_principals`／`guest_document_grants`）であり、招待メールアドレス以外の秘密値（トークン本体等）はハッシュのみ保持する（既存の`session_key_hash`等と同じ方針）。CHK-D4: SafeMode ON時、ゲストへの表示はカードSafeMode制約を通常利用者と同様に適用する（本ADRはSafeModeの境界自体を変更しない） | 業務: D1（A1/A2どちらの経路でも）の認証結果を、業務要件（招待は「特定の個人」宛の意図）として明記し、実装側の技術対策の限界を隠さない。機能: D2のテーブル設計（FD再検査済み）がD3のdeny-by-default構造を可能にする前提を提供する |
| **機能設計** | D1=A1/A2（自組織IdP連携／汎用個人アカウントの多方式、`ADR-0074`型session交換）、D2=A（`guest_principals`+`guest_document_grants`、FD再検査で1実体2テーブルへ精緻化）、D3=A（構造的deny-by-default）、D4=A（招待側単独revoke、即時反映）の一貫した機能連鎖 | 業務: 既存のcapability/PDP経路とは別に、ゲストという新しい主体種別をtrusted auth edgeの外側（org IdP検証を経由しない）に追加することになるため、既存の`VerifiedTenantClaim`ベースの経路とゲスト経路が混線しない境界（ゲストprincipalは`tenant_identity_providers`を経由しない、という構造的区別）を要求する。データ: D4の即時失効が、D2のテーブルへの単純な状態更新で表現できることを要求する（複雑な連鎖更新を要さない） |

CHK-X1〜X6（次元間クロスチェック）: 業務要求（個人単位受入）はデータの非表示原則（SafeMode・文書本体の秘匿）を侵さない（ゲストも通常利用者と同じSafeMode制約を受ける）。データ境界クラス（新規2テーブル）は機能のCRUDサポートレベルと一致させる（招待発行・取消はテナント側write、ゲストの文書readは付与された`doc_id`のみ）。機能の状態遷移（pending→redeemed→revoked）は業務シナリオ（招待→受諾→利用→取消）の全経路をカバーする。

## 採択内容（確定）

D1=多方式対応（A1: 自組織IdP連携 + A2: 汎用個人アカウント、Bは将来拡張余地として保留、Cは不採用）、D2=A（`guest_principals`+`guest_document_grants`、FD再検査済み）、D3=A、D4=A。

理由: D2=A・D3=Aは、`issue-PGM-ITER-05-02`が発見した「sui-sensemakingには個人単位の信頼を組織単位の信頼から独立に表現する経路がない」という欠陥を、データモデルの構造そのもので解消する。既存の`tenant_identity_providers`を流用する案（D2=B）は、粒度混在という同じ欠陥を別の場所で再生産するため採用しない。D1は、保守者の指示により当初の単一方式（原案A＝単回リンクのみ）から複数方式へ拡張し、「受入先テナント自身の企業IdPは不要だが、ゲスト自身は何らかのIdPを持つ」という補正後の要求2を、A1（自組織IdP連携）とA2（汎用個人アカウント）の2経路で満たす。D4=Aは要求されている取り消しの独立性と直接一致する。

## Non-goals

- ゲスト側からの「相互の」共有（ゲストが自分のテナントへ相手を招く等）は対象外。本ADRは常にテナント側からゲスト個人への一方向の招待だけを扱う。
- ゲストに対するcapability体系の一般化（`tenant.provision`等の既存capabilityとの統合）は対象外。ゲストの権限は「付与された`doc_id`集合への読み書き」のみとし、他のcapabilityとは独立に扱う。
- ゲストの組織的な一括管理（CSVインポート、SCIM等）は対象外（`ADR-0039`の個人OSS・プレリリース段階の対応外）。
- ライブ共同編集の並行性モデル自体の変更は対象外（`ADR-0076`が既に決定済み。本ADRはその適用対象にゲストprincipalを含めるかどうかを新たに決定しない）。

## Traceability

- Implementation: `01_Plans/issues/done/issue-PGM-ITER-05-03-cross-tenant-guest-admission-primitive-requirements.md`
- Related: `02_Architecture/cross-tenant-sharing-external-comparison-2026-08-25.html`（外部比較調査。D1〜D4の各選択肢の先例根拠）
- Related: `02_Architecture/post-mvp-business-scope-design-program.html` §15・§18（三要素分析の先行部分・確定要求の記録）
- Related: `01_Plans/adr/ADR-0067-three-element-constraint-design-method.md`
- Related: `01_Plans/adr/ADR-0073-document-ownership-and-lifecycle-model.md`（D2=Aが再利用する「不変事実としての`created_by`」パターンの先例）
- Related: `01_Plans/adr/ADR-0074-server-owned-saas-auth-session.md`（session-binding。D1=Aが再利用するserver-owned session交換パターンの先例）
- Related: `01_Plans/adr/ADR-0059-saas-tenant-authorization-boundary.md`（tenant境界の正本。ゲストprincipalはこの境界の外側の新しい主体種別として追加される）
- Related: `02_Architecture/functional-dependency-integrity-2026-08-06.html`（D2再検査で適用した関数従属性分析の方法論の先例）
