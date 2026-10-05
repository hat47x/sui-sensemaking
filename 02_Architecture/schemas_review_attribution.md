# スキーマ: レビュー帰属（提案）


> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md` である。本書には必要最小限だけを書き、追加や改名のときは正本を先に更新する。
本ファイルは、レビュー帰属（review attribution）をview.json側へ追加するためのスキーマ提案である。  
MVPでは未実装だが、将来の互換性のため、設計の段階で固定する。

> **ADR-0086との境界:** 本書の `ReviewEvent` / `ReviewAttribution` は、既存のview/documentのレビュー文脈の契約であり、将来のartifactレベルの `ReviewRecordV1Alpha1` と同じ型ではない。artifactレベルのReviewは、正確なartifact revisionを対象とし、Authorityの遷移とは分離する。移行と正本の関係は、別のschema ADRまで未決とし、本書だけを理由に、現行の `human_reviewed` を導出値へ変更しない。

## 配置
- view.json（viewのメタデータ）に追加する
- document.jsonには追加しない（既定）

## view.jsonのトップレベルへの追加

```ts
type ReviewAttributionPolicy = {
  storePII: boolean; // default false
  exportRedactionMode: "none" | "strip-identities" | "strip-all"; // default "strip-identities"
  retention?: {
    maxEvents: number; // default 2000
    maxDays?: number;  // optional
  };
};

type ReviewerProfile = {
  reviewerRef: string;       // opaque stable id (non-empty)
  displayName?: string;      // optional; only allowed when storePII=true
  contact?: string;          // optional; discouraged
  role?: string;             // optional
};

type ReviewTargetKind = "island" | "card" | "relation" | "summary";

type ReviewTargetRef = {
  kind: ReviewTargetKind;
  id: string; // entity id
};

type ReviewAction =
  | "markReviewed"
  | "unreview"
  | "approve"
  | "requestChange";

type ReviewEvent = {
  id: string;                 // unique
  target: ReviewTargetRef;
  action: ReviewAction;
  reviewerRef?: string;       // optional; recommended
  createdAt: string;          // ISO
  contextLabel?: string;      // e.g., "internal"|"external"|"self"
  reasonCode?: string;        // optional enumerated codes
  note?: string;              // optional; discouraged by default
};

type ViewMetadata = {
  // ...existing fields...
  reviewAttributionPolicy?: ReviewAttributionPolicy;
  reviewers?: ReviewerProfile[];
  reviewEvents?: ReviewEvent[];
};

type ReviewSignatureEnvelope = {
  version: "1";
  keyId: string;
  algorithm: "rsa-sha256";
  signedAt: string; // ISO
  payload: {
    documentDigest: string; // sha256:<hex>
    viewDigest: string; // sha256:<hex>
    reviewEventDigest: string; // sha256:<hex>
    attributionPolicyDigest: string; // sha256:<hex>
  };
  signature: string; // base64 detached signature
};

type ReviewSignatureVerification = {
  verifiedAt: string; // ISO
  result: "passed" | "not_provided" | "failed";
  reasonCode?: "digest_mismatch" | "key_not_found" | "signature_invalid";
  keyId?: string;
};
```


## HIL-RS-01-A1 契約への結びつき（A1-ATTR-IF）

- SSOT（唯一の参照先）: `02_Architecture/hil_rs_01_a1_minimum_interface_contract.md`
- Contract ID（固定）: `A1-ATTR-IF`
- schemaVersion（固定）: `1.0.0`
- 必須フィールド（固定）
  - `reviewState` (`unreviewed | human_reviewed`)
  - `reviewedAt`
  - `reviewerRef`（空でない不透明な文字列）
  - `auditRecordedAt`
- overridePolicy（固定）: `human_dual_control_only`
- 禁止事項（固定）
  - `ai_only_override`
  - `safemode_relaxation`
  - `share_export_leakage_relaxation`

> 契約値（schemaVersion / 必須フィールド / overridePolicy）の変更の要求は、A1のissueへ差し戻し、A2/A3では変更しない。

- 凍結の宣言（固定）
  - `contractLinkLocked=true`
  - `sharedResourceFreeze=true`


### A1-ERROR-IFへの結びつき（レビュー帰属に関連するもの）

レビュー帰属の検証に失敗したときは、次のエラーコードを用いる。

- `A1_SCHEMA_VERSION_MISMATCH`
- `A1_REQUIRED_FIELD_MISSING`
- `A1_TRACE_KEY_MISSING`
- `A1_OVERRIDE_POLICY_VIOLATION`
- `A1_PII_POLICY_VIOLATION`

共通のenvelope形式は、`02_Architecture/schemas.md` の `A1-ERROR-IF` を唯一の参照先とし、
`contractId` は `A1-ATTR-IF` で固定する。

## 既定値
- reviewAttributionPolicy.storePII = false
- reviewAttributionPolicy.exportRedactionMode = "strip-identities"
- reviewAttributionPolicy.retention.maxEvents = 2000
- reviewEvents / reviewersがない場合は、「履歴なし」として扱う

## 検証ルール
- reviewerRefは、空文字を許さない
- storePII=falseの場合は次のとおりです。
  - reviewers[].displayName / reviewers[].contactは保存しない（読み込み時に破棄する、または無視する）
- reviewEvents は、次を満たす
  - idが重複しない
  - target.idは、既存の要素IDであることが望ましい
    - ただし、過去のイベントを再現するため、参照先が欠けていても、読み込み時にはエラーにしない（警告として扱う）
  - createdAtは、ISO文字列である
- retention
  - export/importのときにmaxEventsを超える場合は、古い順に削除してよい
  - detailsが肥大化するのを避けるため、必要ならeventごとのnoteの長さを制限してよい（例: 500 chars）

## exportでの伏せ字処理の動作
- none
  - reviewers / reviewEventsを、そのまま出力する
- strip-identities
  - reviewers[].displayName / reviewers[].contactを除去する
  - reviewEvents[].reviewerRefは残す（匿名ID）
- strip-all
  - reviewers / reviewEventsを出力しない
  - policy自体は残してよい

## 相互運用の指針
ReviewerRefの推奨フォーマット（例）。
- ローカル: user:local:<random>
- SSO: user:sso:sub:<subject>
- 組織独自: user:org:<opaque>

重要な点は次のとおりです。
- reviewEventsは暗号署名されない前提であり、監査証跡としての強度は限られる。
- 将来の拡張でdetached signatureを追加する場合も、上の構造を壊さず、付加情報として実装する。

## 任意の署名の追加（Phase3 M6）

### ファイルの配置
- `review-signature.json`（新規、任意）
  - `ReviewSignatureEnvelope` を保存する、detached signatureのファイル
  - `document.json` / `view.json` を変更せずに同梱する

### 検証結果のモデル
- 署名の検証結果は、監査ログ側で `ReviewSignatureVerification` として扱う。
- `reviewEvents` には混在させない（レビュー操作ログの意味の境界を維持する）。

### envelopeの検証ルール
- `keyId` は、空文字を許さない
- `algorithm` は、当面 `rsa-sha256` だけを許可する（将来は列挙を拡張する）
- `payload.*Digest` は、`sha256:<hex>` 形式とする
- `signedAt` は、ISO 8601の文字列とする
- `signature` は、base64の文字列とする（空文字は許さない）

### 検証時の動作
- 署名ファイルがない場合は次のとおりです。
  - `result=not_provided`
  - import / view / レビュー操作は継続する（既定ではブロックしない）
- 署名ファイルがあり、検証に成功した場合は次のとおりです。
  - `result=passed`
- 署名ファイルがあり、検証に失敗した場合は次のとおりです。
  - `result=failed` + `reasonCode`
  - 既定では読み取り専用で閲覧を続けられ、share/exportでは追加の確認を行う

### ポリシーの上書き（組織の任意設定）
- 組織の運用で、署名がなければ安全側で拒否する必要がある場合に限り、`requireSignature=true` を別のpolicyで指定する。
- 既定は `requireSignature=false` とし、署名がないことをエラーとして扱わない。

### 後方互換性
- 署名情報はsidecarとして追加するので、既存の `ViewMetadata` のスキーマversionは変更しない。
- 旧クライアントは、`review-signature.json` を読まなくても動作できる。


## 7. AUTH-SCHEMA-01 連携: reviewerRef / ownerRef の正規マッピング

- 正規のキーは、`AuthContext.userId`（内部の `users.id`）とする。
- `reviewerRef` / `ownerRef` には、派生値 `user:<users.id>` を採用する。
- `provider` や `external_uid` は、attribution payloadへ直接は保存しない。
- strict mode（`SUI_ALLOW_JIT_PROVISIONING=false`）では、`users.id` が確定していない要求を拒否し、attributionを作らない。
- `reviewerRef` / `ownerRef` の具体的な値は `ReviewerRefResolverAdapter` が決め、スキーマ側が保証するのは「空でない不透明な文字列」だけである。
- adapterが `sso_subject` の場合は `user:sso:<provider>:<externalUid>` を許容し、入力が不足していれば、`user_id` profile（`actorRef` → `null`）へフォールバックする。
- sourceの判定はUIの補助情報であり、スキーマの必須項目にはしない（`reviewerRef` 単体で互換を維持する）。
- backfillのときは、`reviewerRef` / `ownerRef` だけを書き換えの対象とし、`provider` / `external_uid` は、attribution payloadへ新規には保存しない。

- `internal_user_id` は、実体としては `users.id` を指す。`reviewerRef` / `ownerRef` は、表示と交換のための派生参照（`user:<users.id>`）とする。
- attributionの永続層では `provider` / `external_uid` を保持せず、参照の逆引きは `user_identities` に委ねる。

これにより、IdPを変更したときでも、`user_identities` を結び直すだけで、reviewerやownerへの帰属を変えずに維持できる。

## Stream B Contract Annotation（schema-only fixation）

### Context
- レビュー帰属のスキーマは、privacy/safeModeの境界を壊さずに、mock payloadで独立して検証できる形で固定する必要がある。

### Decision
- `reviewerRef` は、空でない不透明な文字列とし、`provider` / `external_uid` の直接の保存を禁止する。
- `reviewEvents` / `reviewers` / `reviewAttributionPolicy` は、型契約だけを固定し、実装の値や運用の値は本書では規定しない。
- A系の契約IDの参照は、条件付きでも許容するが、schemaのキー集合の再定義は行わない。

### Consequences
- 下流は、mock sidecar（`review-signature.json`）を含む入出力の契約を、先に検証できる。
- 用語の統一（reviewerRef / ownerRef / reviewState）と、safeMode境界を侵さないことを、schemaレビューで確かめられる。
- 実装の段階で、PIIの過剰な収集や、契約にないキーの混入を、安全側で拒否して検知できる。

### CE1整合メモ（Stream B / contract-only）
- 本書はレビュー帰属の契約に限定し、`ContextQueryV1` / `ContextBundleV1` のキー集合を再定義しない。
- CE1の固定エラー語彙（`preview_required` / `unknown_contract_key` / `nondeterministic_bundle`）と衝突するものを導入しない。
- mock-firstで検証するときも、safeModeの境界（PIIの最小化・匿名参照）を緩めない。

## Stream G regression-hardening constraints (2026-05-18)

- Level1の契約境界: `reviewerRef` / `ownerRef` は空でない不透明な文字列とし、PIIの最小化と、禁止キー（`provider`, `external_uid`）を安全側で拒否する検証を必須とする。
- Level2の統合境界: `users` / `user_identities` とattributionの参照整合、strictの403契約、auditの記録の再現性を、同時に検証する。
- 自己修復の上限: 契約の不一致を自動で修復するのは3回までとし、超過したら `StoppedForClarification` を返す。


## Stream D alignment note (2026-05-19)

- Contract driftの抽出: レビュー帰属は、`DocumentV1` に埋め込む契約（L2.5）として維持し、個別のCRUDを保証するとは主張しない。
- Support levelの定義: `reviewerRef` / `ownerRef` / `reviewState` / `reviewedAt` は契約を固定するが、運用は `DATA-MODEL-OPS-01` のCRUD境界に従う。
- 管理者による保守と復旧の境界: 削除・移管・監査の閲覧などの高権限の運用は、`DATA-MAINT-01` のPendingの論点として分離し、先行して実装しない。
- Verify: `schemas.md` と同じsupport levelの語彙（L1/L1.5/L2/L2.5/L3/L0）を参照する前提で整合している。

## Stream D migration boundary memo (2026-05-20)

- 本書はレビュー帰属の契約提案を固定する文書であり、MVPの時点では、attribution専用テーブルのmigrationを要求しない。
- Alembicのhead `20260716_0006`では、tenant基盤の表と、Documentや判断ログの`tenant_id`がexpandされたが、レビュー帰属は引き続き`Document`への埋め込みを前提とし、tenant列には分解しない。
- したがってレビュー帰属は、`L2/L2.5`（埋め込み・契約先行）として扱い、個別のCRUDや独立したmigrationを前提にしない。


## Stream E sync note (2026-05-20, Auth attribution only)

- Authの属性を正規化する境界を再確認した。`reviewerRef` / `ownerRef` は空でない不透明な文字列を維持し、Auth内部の正本は `user:<users.id>` の派生参照とする。
- `provider` / `external_uid` は、レビュー帰属の永続層に保存しない（逆引きは `user_identities` に委ねる）。
- strict mode（`SUI_ALLOW_JIT_PROVISIONING=false`）のときは、`users.id` が未解決の要求を安全側で拒否し、attribution eventを新規には生成しない。
- mock IdPの回帰で差分を吸収する箇所は、`AUTH_PROVIDER_PROFILE` とheaderのマッピングに限り、schemaのキー集合は変えない。
