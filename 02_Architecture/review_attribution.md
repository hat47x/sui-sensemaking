# Review Attribution (Design)


> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。
## Purpose
sui-sensemakingは「曖昧さを保留したまま思考を進める」ための図解ツールであり、成果物は共有・レビューされることを前提とする。  
本ドキュメントは、図解内の要素（島・カード・関係・要約等）について「レビュー済みかどうか」および（任意で）「誰が・いつ」レビューしたかを記録するための設計方針を示す。

本機能は **設計のみ**とし、MVPには実装しない。

本書の対象は「レビューした人/いつ」であり、カードを最初に起票した人、作成者、出典、取り込み元、最終更新者などのprovenance/accountabilityメタデータとは分けて扱う。カード起票者などを標準UIや `Card.meta` に入れる場合は、`CARD-META-UI-01` で保存境界・表示境界・共有/export時のredactionを先に決める。

## Non-goals
- 本機能で「改ざん不可能な監査証跡」を提供しない（署名・証明は将来拡張）。
- 認証・認可・IDプロバイダ（SSO等）を必須要件にしない。
- 個人情報（実名、メール等）の保存をデフォルトで行わない。
- レビュー行為の“正しさ”を自動判定しない。

## Why view-scoped (privacy-first)
sui-sensemakingはOSSとして、多様な環境で利用される。
- ローカル個人利用（ログイン無し）
- 企業/行政のイントラ（SSOやアカウント管理あり）
- 自前ホスティング（最小構成）

この前提では、レビュー情報をdocument.json（内容そのもの）に埋め込むと、共有時に個人情報や組織内情報が意図せず外へ流出する危険が高い。  
よってレビューの帰属（attribution）は **view.json側（ビュー・メタデータ）に保持**するのを基本方針とする。

## Data Model Options
### Option A: View-scoped attribution (Recommended default)
- view.jsonにreviewEvents / reviewersを保持する
- document.jsonは「内容」のみに限定する

**Pros**
- 共有物（document.json）の安全性が高い
- レビュー情報を必要に応じて “同梱/削除” できる（export redaction）
- 認証不要で成立する

**Cons**
- view.jsonを共有しない場合、レビュー情報が伝播しない

### Option B: Doc-scoped attribution (Not default)
- document.jsonに要素単位のreviewedBy / reviewedAt等を持たせる

**Pros**
- ドキュメント単体でレビュー状態が完結する

**Cons**
- 個人情報/組織情報がコンテンツと一体化し、削除しづらい
- 公開や外部共有で事故りやすい

### Option C: Hybrid (Possible future)
- document.jsonにreviewerRef（匿名ID）のみ保持し、
- view.jsonでreviewerRef→表示名のマッピングを保持する

**Pros**
- コンテンツ側で最低限の帰属が持てる
- 表示名はview側で削除可能

**Cons**
- 運用が複雑化しやすい
- “匿名ID” でも組織内では個人特定されうる（扱い注意）

## Recommended Approach
### Default
- **Option A（view-scoped）を採用**
- レビューの記録は **reviewEvents** としてappend-onlyに近い形で残す
- “誰が”は **ReviewerRef（匿名ID）** とし、実名等はオプトイン

### CE0-REVIEW-IF（契約凍結の再掲）

- review state契約は `unreviewed | human_reviewed` を固定する。
- `human_reviewed` への遷移は **人手操作のみ** とし、AI単独遷移を禁止する。
- `mode=autonomous` を含むすべてのAI実行モードで、review自動昇格を禁止する。
- SafeMode既定ONとshare/export漏えい防止は、review attributionの運用変更で緩和してはならない。

### CE2 proposal-only 契約節（Stream D / proposal境界固定）

- CE2由来のnarrative/review支援出力は、**確定本文ではなくproposal** として扱う。
- proposal最小I/Fは `proposalId`, `diff`, `sourceBundleHash`, `status`, `reviewState` を必須とする。
- `status` は `proposed | accepted | rejected | held` のみを許可し、`held` はdrift-stop専用状態とする。
- CE1（ContextBundle）との差分を検知した場合は `status=held` で停止し、運用判断までProceedしない。
- `accepted` は適用許可の意思表示であり、自動適用トリガーではない（auto-apply禁止）。
- `ConsensusGraph` へのdirect writeは禁止し、適用は `patch + approval` のみを許可する。
- `reviewState` のAI自動昇格（`unreviewed -> human_reviewed`）は禁止し、人手操作のみ許可する。

## HIL-RS-01-A1 最小I/F契約（固定参照）

- SSOT（唯一参照先）: `02_Architecture/hil_rs_01_a1_minimum_interface_contract.md`
- Contract ID（固定）: `A1-ATTR-IF`
- schemaVersion（固定）: `1.0.0`は次のとおりです。
- required fields（固定）:
  - `reviewState` (`unreviewed | human_reviewed`)
  - `reviewedAt`
  - `reviewerRef`（opaque string）
  - `auditRecordedAt`
- overridePolicy（固定）:
  - allowed: `human_dual_control_only`
  - prohibited: `ai_only_override`, `safemode_relaxation`, `share_export_leakage_relaxation`
  - requiredApproval: `SecurityOfficer+SystemOwner`
- 禁止事項（固定）は次のとおりです。
  - AIのみで `human_reviewed` へ遷移しない
  - 実名 / email / external_uid / providerなど生IDを保存しない
  - SafeMode既定ONおよびshare/export漏えい防止を後退させない
- Freeze flags（固定）:
  - `contractLinkLocked=true`
  - `sharedResourceFreeze=true`
- Freeze canonical tuple（固定）:
  - `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`
  - `schemaVersion=1.0.0`
  - `contractLinkLocked=true`
  - `sharedResourceFreeze=true`

> 注記: 本書は設計解説であり、契約値の最終決定は常にSSOTを優先する。A2/A3は本節を改訂せずA1へ差し戻す。

- Freeze Pack参照（HIL-RS-02）: `HIL-RS-02-A1-CONTRACT-FREEZE-v1`。A2/A3はread-only参照とし、契約変更要求はA1へ差し戻す。

### A1-ERROR-IF alignment（固定）

- error codeは次の5件を固定する。
  - `A1_SCHEMA_VERSION_MISMATCH`
  - `A1_REQUIRED_FIELD_MISSING`
  - `A1_TRACE_KEY_MISSING`
  - `A1_OVERRIDE_POLICY_VIOLATION`
  - `A1_PII_POLICY_VIOLATION`
- `errorEnvelope.contractId` は `A1-ATTR-IF` を使用する。
- A2/A3でのerror code追加・改名・削除は禁止し、変更要求はA1へ差し戻す。

### Concepts
- **ReviewerRef**: 文字列ID（例: `user:local:4f9c...` / `user:sso:sub:...`）
- **ReviewEvent**: いつ、何に対して、どんなレビューアクションが起きたか
- **ReviewContext**: 内部レビュー/外部レビュー/セルフチェック等、出力時の扱いに影響する文脈
- **Attribution Policy**: 個人情報の保存可否、エクスポート時の削除方針、保持期間等

## Interoperability & Identity
- ローカル利用は次のとおりです。
  - ランダム生成したReviewerRefを使う
  - displayNameは保存しない（必要ならユーザが任意に付ける）
- 組織利用（SSO等）:
  - 安定したsubject idをReviewerRefとして利用可能
  - displayNameは “ビュー側”にのみ保持し、エクスポート時に削除できること
- 認証無しでも動作し続けること（必須）

## Export & Redaction Policy
レビュー情報は共有時に事故の原因になりやすい。  
よってview.jsonには以下の “削除モード” を持たせる。

- `none`: すべて含める（組織内運用向け）
- `strip-identities`: reviewerRefを残すが、displayName等PIIを除去
- `strip-all`: reviewEvents / reviewers自体を出力しない（公開向け）

※MVP外だが、I25 review packの既定は `strip-identities` が妥当。

## Threat Model (Abuse Cases)
- **Doxxing**: 実名やメールが成果物に残り外部流出
- **Tampering**: reviewEventsは編集可能であり、監査証跡としては不完全
- **Over-collection**: 不要な個人属性を収集しがち

対策（設計方針）は次のとおりです。
- デフォルトstorePII=false
- 表示名はオプトイン
- “証拠”ではなく“主張（claim）”として扱う
- 将来拡張で署名（detached signature）を検討

## Optional signing (Phase3 M6, non-MVP)

### Scope and goals
- detached signatureは **review attributionを含む配布単位の完全性確認** を目的とする。
- 署名はオプションであり、未署名データでも既存の閲覧・編集・レビュー運用は継続できる。
- SafeModeとPII最小化（`storePII=false` 既定、redaction既定 `strip-identities`）を優先し、署名導入で既定値を緩めない。

### Signing target
- 対象は `view.json` 単体ではなく、`document.json` + `view.json` の組み合わせを表す `review-attribution digest` とする。
- digest生成時は次を必須入力にする。
  - `documentDigest`（`document.json` のSHA-256）
  - `viewDigest`（`view.json` のSHA-256。redaction後の実ファイルを対象）
  - `reviewEventDigest`（`reviewEvents` 正規化JSONのSHA-256）
  - `attributionPolicyDigest`（`reviewAttributionPolicy` 正規化JSONのSHA-256）
- 署名対象は上記digest群を含む `ReviewSignatureEnvelope` のcanonical JSONとし、署名方式は `detached` を前提にする。

### Verification flow
1. 署名ファイル（例: `review-signature.json`）がある場合のみ検証処理を開始する。
2. `document.json` / `view.json` からdigestを再計算し、envelope内の値と比較する。
3. `keyId` で公開鍵を解決し、`signature` を検証する。
4. 成功時は監査ログに `verification=passed` を追記する。
5. 失敗時は監査ログに失敗理由（`digest_mismatch` / `key_not_found` / `signature_invalid`）を残す。

### Failure behavior (non-blocking default)
- **署名がない場合**: `verification=not_provided` として扱い、通常利用は継続する。
- **署名検証失敗**: 既定ではread-onlyで継続可能とし、破壊的操作（share/export）のみ追加確認を要求する。
- 組織運用でfail-closedが必要な場合はpolicyで `requireSignature=true` を明示し、未署名/失敗を拒否できる。
- 既定値は `requireSignature=false` とし、ローカル利用・OSS利用を阻害しない。

### UI / operations policy
- UIには「署名状態」を3値で表示する。
  - `Unsigned`（未署名）
  - `Verified`（署名検証成功）
  - `Verification failed`（署名不正または鍵不一致）
- 未署名はwarningではなくinfo扱いにし、通常フローをブロックしない。
- `Verification failed` では操作を即時停止せず、share/export前に確認ダイアログを出す。
- 運用では「公開配布時のみ署名必須」「内部下書きは任意」を標準とし、署名必須範囲をdeployment policyで管理する。

### Audit log relation
- 署名検証結果はreview attribution本体（`reviewEvents`）とは別系列で記録する。
- 監査ログには以下を残す。
  - `verifiedAt`
  - `result`（`passed` / `not_provided` / `failed`）
  - `reasonCode`（失敗時のみ）
  - `keyId`（解決できた場合）
- `reviewEvents` の意味を変更しない（レビュー操作ログと検証ログを混在させない）。

### Key management policy
- private keyはアプリ実行環境に持ち込まず、CI/CDか専用署名基盤で管理する。
- key rotationを前提に `keyId` 必須、検証側は複数公開鍵を保持可能にする。
- 失効した鍵はdeny-listで明示し、過去成果物再検証時は「当時有効だった鍵」を参照できる運用記録を残す。

### Backward compatibility policy
- `review-signature.json` は追加ファイル扱いとし、既存の `document.json` / `view.json` 形式を変更しない。
- 未対応クライアントは署名ファイルを無視して従来通り動作できることを互換要件とする。
- 将来アルゴリズム追加時は `algorithm` 列挙を拡張し、既存 `rsa-sha256`（初期値）を後方互換で維持する。

## Future Milestones (Phase 3+)
- M1: “現在のレビュア”設定（ローカルID発行）
- M2: reviewedフラグ変更時にReviewEventを追記
- M3: エクスポート時のredaction実装（strip-identities / strip-all）
- M4: Merge audit log integration
- M5: SSOアダプタ（ReviewerRef生成規約の差し替え）
- M6: Optional signing（detached signature + verification UI）

## 9. M5 ReviewerRef Resolver Adapter 契約

### 9.1 Interface（差し替え可能）

- `ReviewerRefResolverAdapter` はreviewer attribution用の `reviewerRef` / `ownerRef` を解決する唯一の境界とする。
- 入力（最小契約）は次のとおりです。
  - `AuthContext.userId`（内部 `users.id`、未認証時は `null`）
  - `AuthContext.provider` / `AuthContext.externalUid`（認証経路のsubject）
  - `AuthContext.actorRef`（未認証時フォールバックに利用可能）
- 出力（最小契約）は次のとおりです。
  - `reviewerRef: string | null`
  - `ownerRef: string | null`
  - いずれも「不透明ID（opaque）」として扱い、UI/監査は値の構造へ依存しない。
- fallback順序（固定）:
  1. adapter profileの主解決（`user_id` または `sso_subject`）
  2. `actorRef`（未認証ローカル運用）
  3. `null`（reviewer未設定）

責務境界は次のとおりです。
- resolver adapterは `reviewerRef` / `ownerRef` の生成のみを担当する。
- reviewEvents/export/importのschema・永続化ルールは既存契約（opaque string, optional）を維持し、adapterはこれを変更しない。
- 認可判定（roles/groups/policyRef）や表示名復元はresolverの責務外とする。

### 9.2 規定プロファイル

- `user_id`（既定）
  - `reviewerRef = ownerRef = user:<users.id>`
  - `AuthContext.userId` が無い場合は `AuthContext.actorRef` をフォールバックとして利用し、未設定なら `null`。
- `sso_subject`（M5）
  - 認証済み（`provider` + `externalUid` が存在）なら `reviewerRef = ownerRef = user:sso:<provider>:<externalUid>`。
  - 認証情報が不足する場合は `user_id` と同じフォールバック（`actorRef` → `null`）を適用。

### 9.3 Non-Goals（M5時点）

- 本番IdP製品（Keycloak/Authentik/Cloud IAP等）の固定。
- アプリ内RBACエンジン本体の実装完了。
- reviewerRefから表示名を永続復元する機能の追加（表示名は引き続き揮発補完）。

### 9.4 Privacy境界（PII最小化）

- `sso_subject` profileは `provider` / `externalUid` を **派生ID構築にのみ使用**し、review attribution payloadへ生値保存しない。
- `reviewerRef` はUI上でsource表示（local/SSO）に利用可能だが、source判定不能なunknown値を許容する。
- export redaction（`strip-identities` / `strip-all`）契約はM5でも変更しない。

## Notes
- 本機能は「責任所在を明確化し、レビュー運用を回す」ための補助である。
- 生成AIの要約/文章化が入る場合でも、“人間がレビューしたか”の区別ができることを優先する。

## 8. AUTH-ARCH-01: AuthContext/JIT 境界と表示責務

- 永続境界は次のとおりです。
  - 永続化: `userId`, `reviewerRef=user:<userId>`, `ownerRef=user:<userId>`
  - 非永続（揮発）: `displayName`, `amr/acr/aal/auth_time`, `roles/groups`, `policyRef`
- PII最小化:
  - document/view/review eventには `reviewerRef` のみ残し、表示名は必要時に外部ディレクトリ照会または一時ヘッダーで補完する。
  - `amr/acr/aal/auth_time` はreviewer attributionへ保存しない。
  - `roles/groups/policyRef` の生値はattribution監査にも残さない。
- strict mode:
  - `SUI_ALLOW_JIT_PROVISIONING=false` では未登録subjectを `403` 拒否し、事前プロビジョニング導線を必須とする。
  - 管理導線の責務分担: backendは拒否契約 (`403`) と最小API (`POST /admin/provision/users`) を提供し、運用管理者は事前登録・再紐付けを実施する。
  - strict緩和（`SUI_ALLOW_JIT_PROVISIONING=true` への変更）はSecurity Officer + System Ownerの2者承認を必須とし、承認記録なき変更を禁止する。

### 8.1 `amr/acr/aal/auth_time` の表示・監査の固定方針

- 表示は次のとおりです。
  - Review履歴UIでは値を直接表示しない（review attributionは人間レビュー責任の表示に限定）。
  - 必要時はセッション診断画面でのみ揮発表示する。
- 監査は次のとおりです。
  - 生値は保存せず、`hasStepUp` / `assuranceLevel` / `authAgeBucket` の正規化指標のみ出力可能。
  - 監査ログはsafeMode/漏洩防止原則に従い、再識別性を増やす詳細属性を追加しない。

## Stream A CE0/HIL Contract Freeze Alignment (2026-04-16)

### Context
- review attributionは `CE0-REVIEW-IF` の中核であり、`human_reviewed` 自動昇格禁止の統治境界を維持する必要がある。

### Decision
- 本書のreview state契約は `unreviewed | human_reviewed` の2値を維持し、AI/worker/APIによる自動昇格を禁止する。
- `CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1` を参照契約として固定し、A2/A3での再定義を禁止する。

### Consequences
- safeMode後退、unreviewed保護後退、direct write許容が検知された場合はfail-closed。
- 修復は最大3回、超過時は停止報告（失敗条件 / 影響契約ID / 要承認事項）へ移行する。

### Snapshot Metadata
- Snapshot ID: `CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1`
- Version: `1.0.0`
- Hash (sha256): `851849b770825eb4844d46c77bae34bbefb4aec1ae9bd004e7dc4d50b875a698`

## Stream B Contract Annotation（review boundary / conditional）

### Context
- review attributionは `CE0-REVIEW-IF` と `A1-ATTR-IF` の境界契約に依存しつつ、実装待機なしでschema整合を保つ必要がある。

### Decision
- review stateは `unreviewed | human_reviewed` を固定し、AI自動昇格を禁止する。
- `A1-ATTR-IF` 参照はread-onlyとし、未確定要素はconditionalメモとして保持する。
- mock review payload（`reviewerRef` / `reviewedAt` / `auditRecordedAt`）を使った契約検証を許可する。

### Consequences
- review運用の責任境界（人手昇格・2者承認・safeMode保護）を実装非依存で維持できる。
- 下流はattribution実装前でもexport/redactionと整合した検証を継続できる。
- 契約矛盾が発生した場合は `held` / fail-closed判定へ収束できる。

## CE0 Contract Matrix Freeze Link（CTX / SAFEMODE / REVIEW）

review attributionはCE0契約行列の `REVIEW` 軸を担うが、`CTX` / `SAFEMODE` と分離せず同時拘束で運用する。

### Contract matrix (frozen)

| Contract ID | Required invariant | Stop condition |
| --- | --- | --- |
| `CE0-CTX-IF` | preview gate 未通過の文脈から review 生成を開始しない。 | `previewConfirmed!=true` で生成開始した場合。 |
| `CE0-SAFEMODE-IF` | safeMode 既定ON、reviewed-only 既定を緩和しない。 | unreviewed 本文の露出、safeMode 既定値後退。 |
| `CE0-REVIEW-IF` | `unreviewed | human_reviewed` のみ。昇格は人手のみ。 | AI/自動処理による `human_reviewed` 昇格。 |
| `CE0-CG-WRITE-IF` | Consensus Graph direct write 禁止、`patch+approval` のみ許可。 | 直接更新経路を1件でも検出。 |

### Freeze discipline

1. 契約IDの重複定義は0を維持する。
2. 上記4契約のいずれかに抵触した場合、review attribution機能は `held/stop` を優先する。
3. CE1以降の実装有無に関わらず、本節はread-only契約として適用する。

## Stream G hardening note (2026-05-18)

- `reviewerRef` / `ownerRef` は内部 `users.id` 起点のopaque参照を正本とし、`provider` / `external_uid` のattribution直保存を禁止する。
- strict provisioningでidentity未確定の場合、review attributionを生成せず `identity_not_provisioned` を返す失敗モードを維持する。
- 本契約は監査可能性のためにfail-closedを優先し、便宜上のfail-open例外を導入しない。
