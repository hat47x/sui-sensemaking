# レビュー帰属（設計）


> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md` である。本書には必要最小限だけを書き、追加や改名のときは正本を先に更新する。
## 目的
sui-sensemakingは「曖昧さを保留したまま思考を進める」ための図解ツールであり、成果物は共有やレビューをされることを前提とする。  
本ドキュメントは、図解内の要素（島・カード・関係・要約など）について、「レビュー済みかどうか」と、（任意で）「誰が・いつ」レビューしたかを記録するための設計方針を示す。

本機能は **設計のみ**とし、MVPには実装しない。

本書が対象とするのは「レビューした人と時刻」であり、カードを最初に起票した人、作成者、出典、取り込み元、最終更新者などのprovenance/accountabilityのメタデータとは分けて扱う。カードの起票者などを標準UIや `Card.meta` に入れる場合は、`CARD-META-UI-01` で、保存の境界、表示の境界、共有/export時の伏せ字処理を先に決める。

## 対象外
- 本機能では、「改ざんできない監査証跡」を提供しない（署名・証明は将来の拡張とする）。
- 認証・認可・IDプロバイダ（SSOなど）を、必須の要件にしない。
- 個人情報（実名、メールなど）を、既定では保存しない。
- レビューという行為の「正しさ」を、自動では判定しない。

## ビュー単位で持つ理由（プライバシー優先）
sui-sensemakingはOSSとして、多様な環境で利用される。
- ローカルでの個人利用（ログインなし）
- 企業や行政のイントラ（SSOやアカウント管理あり）
- 自前のホスティング（最小構成）

この前提で、レビュー情報をdocument.json（内容そのもの）に埋め込むと、共有したときに、個人情報や組織内の情報が意図せず外へ流出する危険が高い。  
そのため、レビューの帰属（attribution）は **view.json側（ビューのメタデータ）に保持**するのを基本方針とする。

## データモデルの選択肢
### Option A: ビュー単位の帰属（推奨の既定）
- view.jsonにreviewEvents / reviewersを保持する
- document.jsonは「内容」だけに限る

**利点**
- 共有物（document.json）の安全性が高い
- レビュー情報を、必要に応じて「同梱」「削除」できる（exportでの伏せ字処理）
- 認証なしで成立する

**欠点**
- view.jsonを共有しない場合、レビュー情報が伝わらない

### Option B: ドキュメント単位の帰属（既定にしない）
- document.jsonに、要素単位のreviewedBy / reviewedAtなどを持たせる

**利点**
- ドキュメント単体で、レビュー状態が完結する

**欠点**
- 個人情報や組織の情報が、コンテンツと一体になり、削除しにくい
- 公開や外部共有のときに、事故が起きやすい

### Option C: ハイブリッド（将来の可能性）
- document.jsonには、reviewerRef（匿名ID）だけを保持し、
- view.jsonで、reviewerRefから表示名へのマッピングを保持する

**利点**
- コンテンツ側で、最低限の帰属を持てる
- 表示名は、view側で削除できる

**欠点**
- 運用が複雑になりやすい
- 「匿名ID」でも、組織内では個人を特定されうる（扱いに注意が必要）

## 推奨するアプローチ
### 既定
- **Option A（ビュー単位）を採用する**
- レビューの記録は、**reviewEvents** として、append-onlyに近い形で残す
- 「誰が」は **ReviewerRef（匿名ID）** とし、実名などはオプトインとする

### CE0-REVIEW-IF（契約凍結の再掲）

- レビュー状態の契約は、`unreviewed | human_reviewed` に固定する。
- `human_reviewed` への遷移は **人の操作だけ** とし、AI単独の遷移を禁止する。
- `mode=autonomous` を含むすべてのAI実行モードで、reviewの自動昇格を禁止する。
- SafeModeの既定ONと、share/exportでの漏えい防止は、レビュー帰属の運用を変更しても緩和してはならない。

### CE2 proposal-only 契約の節（Stream D / proposalの境界を固定）

- CE2由来のnarrativeやレビュー支援の出力は、**確定した本文ではなくproposal** として扱う。
- proposalの最小I/Fは、`proposalId`, `diff`, `sourceBundleHash`, `status`, `reviewState` を必須とする。
- `status` には `proposed | accepted | rejected | held` だけを許可し、`held` はdrift-stop専用の状態とする。
- CE1（ContextBundle）との差分を検知した場合は、`status=held` で停止し、運用上の判断が出るまでProceedしない。
- `accepted` は適用を許可する意思表示であり、自動適用のトリガーではない（auto-applyは禁止）。
- `ConsensusGraph` へのdirect writeは禁止し、適用は `patch + approval` だけを許可する。
- `reviewState` のAIによる自動昇格（`unreviewed -> human_reviewed`）は禁止し、人の操作だけを許可する。

## HIL-RS-01-A1 最小I/F契約（固定の参照）

- SSOT（唯一の参照先）: `02_Architecture/hil_rs_01_a1_minimum_interface_contract.md`
- Contract ID（固定）: `A1-ATTR-IF`
- schemaVersion（固定）: `1.0.0`
- 必須フィールド（固定）
  - `reviewState` (`unreviewed | human_reviewed`)
  - `reviewedAt`
  - `reviewerRef`（不透明な文字列）
  - `auditRecordedAt`
- overridePolicy（固定）
  - allowed: `human_dual_control_only`
  - prohibited: `ai_only_override`, `safemode_relaxation`, `share_export_leakage_relaxation`
  - requiredApproval: `SecurityOfficer+SystemOwner`
- 禁止事項（固定）は次のとおりです。
  - AIだけで `human_reviewed` へ遷移しない
  - 実名 / email / external_uid / providerなどの生のIDを保存しない
  - SafeModeの既定ON、およびshare/exportでの漏えい防止を後退させない
- Freezeフラグ（固定）
  - `contractLinkLocked=true`
  - `sharedResourceFreeze=true`
- Freezeの正規タプル（固定）
  - `freezeContractId=HIL-RS-02-A1-CONTRACT-FREEZE-v1`
  - `schemaVersion=1.0.0`
  - `contractLinkLocked=true`
  - `sharedResourceFreeze=true`

> 注記: 本書は設計の解説であり、契約値の最終的な決定は、常にSSOTを優先する。A2/A3は、本節を改訂せず、A1へ差し戻す。

- Freeze Packの参照（HIL-RS-02）: `HIL-RS-02-A1-CONTRACT-FREEZE-v1`。A2/A3は読み取り専用で参照し、契約の変更の要求はA1へ差し戻す。

### A1-ERROR-IFとの整合（固定）

- エラーコードは、次の5件に固定する。
  - `A1_SCHEMA_VERSION_MISMATCH`
  - `A1_REQUIRED_FIELD_MISSING`
  - `A1_TRACE_KEY_MISSING`
  - `A1_OVERRIDE_POLICY_VIOLATION`
  - `A1_PII_POLICY_VIOLATION`
- `errorEnvelope.contractId` には、`A1-ATTR-IF` を使用する。
- A2/A3でのエラーコードの追加・改名・削除は禁止し、変更の要求はA1へ差し戻す。

### 概念
- **ReviewerRef**: 文字列のID（例: `user:local:4f9c...` / `user:sso:sub:...`）
- **ReviewEvent**: いつ、何に対して、どんなレビューアクションが起きたか
- **ReviewContext**: 内部レビュー、外部レビュー、セルフチェックなど、出力時の扱いに影響する文脈
- **Attribution Policy**: 個人情報の保存の可否、エクスポート時の削除方針、保持期間など

## 相互運用とアイデンティティ
- ローカルで利用する場合は次のとおりです。
  - ランダムに生成したReviewerRefを使う
  - displayNameは保存しない（必要なら、ユーザーが任意に付ける）
- 組織で利用する場合（SSOなど）
  - 安定したsubject idを、ReviewerRefとして利用できる
  - displayNameは「ビュー側」にだけ保持し、エクスポート時に削除できること
- 認証がなくても動作し続けること（必須）

## エクスポートと伏せ字処理のポリシー
レビュー情報は、共有したときに事故の原因になりやすい。  
そのため、view.jsonには、次の「削除モード」を持たせる。

- `none`: すべて含める（組織内の運用向け）
- `strip-identities`: reviewerRefは残すが、displayNameなどのPIIは除去する
- `strip-all`: reviewEvents / reviewers自体を出力しない（公開向け）

※MVPの範囲外だが、I25 review packの既定は `strip-identities` が妥当である。

## 脅威モデル（悪用のケース）
- **Doxxing**: 実名やメールが成果物に残り、外部へ流出する
- **Tampering**: reviewEventsは編集でき、監査証跡としては不完全である
- **Over-collection**: 不要な個人属性を収集しがちである

対策（設計方針）は次のとおりです。
- 既定はstorePII=falseとする
- 表示名はオプトインとする
- 「証拠」ではなく「主張（claim）」として扱う
- 将来の拡張で、署名（detached signature）を検討する

## 任意の署名（Phase3 M6、MVP外）

### 範囲と目標
- detached signatureは、**レビュー帰属を含む配布単位の完全性を確認すること** を目的とする。
- 署名は任意であり、未署名のデータでも、既存の閲覧・編集・レビューの運用は続けられる。
- SafeModeとPIIの最小化（`storePII=false` を既定、伏せ字処理の既定を `strip-identities`）を優先し、署名を導入しても既定値を緩めない。

### 署名の対象
- 対象は `view.json` 単体ではなく、`document.json` と `view.json` の組み合わせを表す `review-attribution digest` とする。
- digestを生成するときは、次を必須の入力とする。
  - `documentDigest`（`document.json` のSHA-256）
  - `viewDigest`（`view.json` のSHA-256。伏せ字処理の後の実ファイルが対象）
  - `reviewEventDigest`（`reviewEvents` を正規化したJSONのSHA-256）
  - `attributionPolicyDigest`（`reviewAttributionPolicy` を正規化したJSONのSHA-256）
- 署名の対象は、上のdigest群を含む `ReviewSignatureEnvelope` のcanonical JSONとし、署名方式は `detached` を前提にする。

### 検証フロー
1. 署名ファイル（例: `review-signature.json`）がある場合に限り、検証処理を開始する。
2. `document.json` / `view.json` からdigestを再計算し、envelope内の値と比較する。
3. `keyId` で公開鍵を解決し、`signature` を検証する。
4. 成功したときは、監査ログに `verification=passed` を追記する。
5. 失敗したときは、監査ログに失敗の理由（`digest_mismatch` / `key_not_found` / `signature_invalid`）を残す。

### 失敗時の動作（既定ではブロックしない）
- **署名がない場合**: `verification=not_provided` として扱い、通常の利用は続ける。
- **署名の検証に失敗した場合**: 既定では読み取り専用で続けられるものとし、破壊的な操作（share/export）に限り、追加の確認を求める。
- 組織の運用で、署名がなければ安全側で拒否する必要がある場合は、policyで `requireSignature=true` を明示し、未署名や検証失敗を拒否できる。
- 既定値は `requireSignature=false` とし、ローカル利用やOSS利用を妨げない。

### UI・運用のポリシー
- UIには、「署名状態」を3値で表示する。
  - `Unsigned`（未署名）
  - `Verified`（署名の検証に成功）
  - `Verification failed`（署名が不正、または鍵が不一致）
- 未署名は警告ではなく情報として扱い、通常のフローをブロックしない。
- `Verification failed` でも、操作をすぐには止めず、share/exportの前に確認ダイアログを出す。
- 運用では、「公開して配布するときだけ署名を必須にする」「内部の下書きは任意にする」を標準とし、署名を必須にする範囲は、deployment policyで管理する。

### 監査ログとの関係
- 署名の検証結果は、レビュー帰属の本体（`reviewEvents`）とは別の系列で記録する。
- 監査ログには、次を残す。
  - `verifiedAt`
  - `result`（`passed` / `not_provided` / `failed`）
  - `reasonCode`（失敗したときだけ）
  - `keyId`（解決できた場合）
- `reviewEvents` の意味は変更しない（レビュー操作のログと検証のログを混在させない）。

### 鍵管理のポリシー
- 秘密鍵は、アプリの実行環境に持ち込まず、CI/CDか専用の署名基盤で管理する。
- 鍵のローテーションを前提に、`keyId` を必須とし、検証する側は複数の公開鍵を保持できるようにする。
- 失効した鍵は、拒否リストで明示し、過去の成果物を再検証するときに、「当時有効だった鍵」を参照できる運用の記録を残す。

### 後方互換のポリシー
- `review-signature.json` は追加のファイルとして扱い、既存の `document.json` / `view.json` の形式を変更しない。
- 未対応のクライアントが、署名ファイルを無視して従来どおり動作できることを、互換の要件とする。
- 将来アルゴリズムを追加するときは、`algorithm` の列挙を拡張し、既存の `rsa-sha256`（初期値）を、後方互換で維持する。

## 今後のマイルストーン（Phase 3以降）
- M1: 「現在のレビュアー」の設定（ローカルIDの発行）
- M2: reviewedフラグを変更したときに、ReviewEventを追記する
- M3: エクスポート時の伏せ字処理の実装（strip-identities / strip-all）
- M4: Merge audit logとの統合
- M5: SSOアダプタ（ReviewerRefの生成規約の差し替え）
- M6: 任意の署名（detached signature + 検証UI）

## 9. M5 ReviewerRef Resolver Adapter 契約

### 9.1 インターフェース（差し替え可能）

- `ReviewerRefResolverAdapter` は、レビュー帰属に使う `reviewerRef` / `ownerRef` を解決する唯一の境界とする。
- 入力（最小の契約）は次のとおりです。
  - `AuthContext.userId`（内部の `users.id`。未認証のときは `null`）
  - `AuthContext.provider` / `AuthContext.externalUid`（認証経路のsubject）
  - `AuthContext.actorRef`（未認証のときのフォールバックに利用できる）
- 出力（最小の契約）は次のとおりです。
  - `reviewerRef: string | null`
  - `ownerRef: string | null`
  - いずれも「不透明なID（opaque）」として扱い、UIや監査は、値の構造に依存しない。
- フォールバックの順序（固定）
  1. adapter profileによる主な解決（`user_id` または `sso_subject`）
  2. `actorRef`（未認証のローカル運用）
  3. `null`（reviewer未設定）

責務の境界は次のとおりです。
- resolver adapterが担当するのは、`reviewerRef` / `ownerRef` の生成だけである。
- reviewEvents/export/importのスキーマと永続化のルールは、既存の契約（opaque string、optional）を維持し、adapterはこれを変更しない。
- 認可の判定（roles/groups/policyRef）や、表示名の復元は、resolverの責務の外とする。

### 9.2 規定のプロファイル

- `user_id`（既定）
  - `reviewerRef = ownerRef = user:<users.id>`
  - `AuthContext.userId` がない場合は、`AuthContext.actorRef` をフォールバックとして利用し、それも未設定なら `null` とする。
- `sso_subject`（M5）
  - 認証済み（`provider` と `externalUid` が存在する）なら、`reviewerRef = ownerRef = user:sso:<provider>:<externalUid>` とする。
  - 認証情報が不足する場合は、`user_id` と同じフォールバック（`actorRef` → `null`）を適用する。

### 9.3 対象外（M5の時点）

- 本番のIdP製品（Keycloak/Authentik/Cloud IAPなど）の固定。
- アプリ内のRBACエンジン本体の実装の完了。
- reviewerRefから表示名を永続的に復元する機能の追加（表示名は、引き続き揮発的に補完する）。

### 9.4 プライバシーの境界（PIIの最小化）

- `sso_subject` profileは、`provider` / `externalUid` を **派生IDの構築にだけ使用** し、レビュー帰属のpayloadへ生の値を保存しない。
- `reviewerRef` はUI上で、source表示（local/SSO）に利用できるが、sourceを判定できないunknownの値を許容する。
- exportでの伏せ字処理（`strip-identities` / `strip-all`）の契約は、M5でも変更しない。

## 補足
- 本機能は、「責任の所在を明確にし、レビューの運用を回す」ための補助である。
- 生成AIによる要約や文章化が入る場合でも、「人間がレビューしたか」を区別できることを優先する。

## 8. AUTH-ARCH-01: AuthContext/JIT の境界と表示の責務

- 永続化の境界は次のとおりです。
  - 永続化する: `userId`, `reviewerRef=user:<userId>`, `ownerRef=user:<userId>`
  - 永続化しない（揮発）: `displayName`, `amr/acr/aal/auth_time`, `roles/groups`, `policyRef`
- PIIの最小化
  - document/view/review eventには `reviewerRef` だけを残し、表示名は、必要なときに外部ディレクトリへの照会か、一時的なヘッダーで補完する。
  - `amr/acr/aal/auth_time` は、レビュー帰属に保存しない。
  - `roles/groups/policyRef` の生の値は、帰属の監査にも残さない。
- strict mode
  - `SUI_ALLOW_JIT_PROVISIONING=false` では、未登録のsubjectを `403` で拒否し、事前プロビジョニングの導線を必須とする。
  - 管理の導線の責務分担: バックエンドは、拒否の契約 (`403`) と最小限のAPI (`POST /admin/provision/users`) を提供し、運用の管理者が、事前登録と再紐付けを実施する。
  - strictの緩和（`SUI_ALLOW_JIT_PROVISIONING=true` への変更）には、Security OfficerとSystem Ownerの2者の承認を必須とし、承認の記録がない変更を禁止する。

### 8.1 `amr/acr/aal/auth_time` の表示と監査の固定方針

- 表示は次のとおりです。
  - Review履歴のUIでは、値を直接表示しない（レビュー帰属は、人間のレビュー責任の表示に限る）。
  - 必要なときは、セッション診断画面でだけ、揮発的に表示する。
- 監査は次のとおりです。
  - 生の値は保存せず、`hasStepUp` / `assuranceLevel` / `authAgeBucket` の正規化した指標だけを出力できる。
  - 監査ログは、safeModeと漏えい防止の原則に従い、再識別性を高める詳細な属性を追加しない。

## Stream A CE0/HIL Contract Freeze Alignment (2026-04-16)

### Context
- レビュー帰属は `CE0-REVIEW-IF` の中核であり、`human_reviewed` の自動昇格を禁止するというガバナンスの境界を維持する必要がある。

### Decision
- 本書のレビュー状態の契約は、`unreviewed | human_reviewed` の2値を維持し、AI/worker/APIによる自動昇格を禁止する。
- `CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1` を参照する契約として固定し、A2/A3での再定義を禁止する。

### Consequences
- safeModeの後退、未レビュー保護の後退、direct writeの許容を検知した場合は、安全側で拒否する。
- 修復は最大3回とし、超過したときは、停止の報告（失敗の条件 / 影響を受ける契約ID / 承認が必要な事項）へ移る。

### スナップショットのメタデータ
- Snapshot ID: `CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1`
- Version: `1.0.0`
- Hash (sha256): `851849b770825eb4844d46c77bae34bbefb4aec1ae9bd004e7dc4d50b875a698`

## Stream B Contract Annotation（レビュー境界 / 条件付き）

### Context
- レビュー帰属は、`CE0-REVIEW-IF` と `A1-ATTR-IF` の境界契約に依存しつつ、実装を待たずに、スキーマの整合を保つ必要がある。

### Decision
- レビュー状態は `unreviewed | human_reviewed` に固定し、AIによる自動昇格を禁止する。
- `A1-ATTR-IF` の参照は読み取り専用とし、未確定の要素は、条件付きのメモとして保持する。
- mockのレビューpayload（`reviewerRef` / `reviewedAt` / `auditRecordedAt`）を使った契約の検証を許可する。

### Consequences
- レビュー運用の責任の境界（人による昇格、2者承認、safeModeの保護）を、実装に依存せずに維持できる。
- 下流は、レビュー帰属の実装より前でも、exportや伏せ字処理と整合した検証を続けられる。
- 契約に矛盾が生じたときは、`held` や、安全側で拒否する判定に収束できる。

## CE0 Contract Matrix Freeze Link（CTX / SAFEMODE / REVIEW）

レビュー帰属は、CE0の契約行列の `REVIEW` 軸を担うが、`CTX` / `SAFEMODE` と切り離さず、同時に拘束して運用する。

### 契約マトリクス（凍結済み）

| Contract ID | Required invariant | Stop condition |
| --- | --- | --- |
| `CE0-CTX-IF` | preview gateを通過していない文脈から、review生成を開始しない。 | `previewConfirmed!=true` で生成を開始した場合。 |
| `CE0-SAFEMODE-IF` | safeModeの既定ONと、reviewed-onlyの既定を緩和しない。 | unreviewedの本文の露出、safeModeの既定値の後退。 |
| `CE0-REVIEW-IF` | `unreviewed | human_reviewed` のみ。昇格は人の操作だけ。 | AIや自動処理による `human_reviewed` への昇格。 |
| `CE0-CG-WRITE-IF` | Consensus Graphへのdirect writeを禁止し、`patch+approval` だけを許可する。 | 直接更新する経路を1件でも検出した場合。 |

### 凍結の規律

1. 契約IDの重複した定義は、0を維持する。
2. 上の4契約のいずれかに抵触した場合、レビュー帰属の機能は `held/stop` を優先する。
3. CE1以降の実装の有無に関わらず、本節は読み取り専用の契約として適用する。

## Stream G hardening note (2026-05-18)

- `reviewerRef` / `ownerRef` は、内部の `users.id` を起点とする不透明な参照を正本とし、`provider` / `external_uid` をattributionへ直接保存することを禁止する。
- strict provisioningでidentityが未確定の場合は、レビュー帰属を生成せず、`identity_not_provisioned` を返す失敗モードを維持する。
- 本契約は、監査できることのために、安全側で拒否することを優先し、便宜上の例外として条件を満たさないまま通すことを導入しない。
