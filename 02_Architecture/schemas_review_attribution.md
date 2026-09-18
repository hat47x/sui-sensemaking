# Schemas: Review Attribution (Proposal)


> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。
本ファイルは review attribution を view.json 側へ追加するためのスキーマ提案である。  
MVPでは未実装だが、将来の互換性のため設計段階で固定する。

> **ADR-0086との境界:** 本書の `ReviewEvent` / `ReviewAttribution` は既存view/document review文脈の契約であり、将来のartifact-level `ReviewRecordV1Alpha1` と同一型ではない。artifact-level Reviewはexact artifact revisionを対象とし、Authority transitionとは分離する。移行・正本関係は別schema ADRまで未決とし、本書だけを理由に現行`human_reviewed`を導出値へ変更しない。

## Location
- view.json (view metadata) に追加
- document.json には追加しない（default）

## Top-level additions to view.json

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


## HIL-RS-01-A1 contract binding（A1-ATTR-IF）

- SSOT（唯一参照先）: `02_Architecture/hil_rs_01_a1_minimum_interface_contract.md`
- Contract ID（固定）: `A1-ATTR-IF`
- schemaVersion（固定）: `1.0.0`
- required fields（固定）:
  - `reviewState` (`unreviewed | human_reviewed`)
  - `reviewedAt`
  - `reviewerRef`（non-empty opaque string）
  - `auditRecordedAt`
- overridePolicy（固定）: `human_dual_control_only`
- prohibited（固定）:
  - `ai_only_override`
  - `safemode_relaxation`
  - `share_export_leakage_relaxation`

> 契約値の変更要求（schemaVersion / required fields / overridePolicy）はA1 issueへ差し戻し、A2/A3で変更しない。

- freeze宣言（固定）:
  - `contractLinkLocked=true`
  - `sharedResourceFreeze=true`


### A1-ERROR-IF binding（review attribution関連）

review attribution の検証失敗時は次の error code を用いる。

- `A1_SCHEMA_VERSION_MISMATCH`
- `A1_REQUIRED_FIELD_MISSING`
- `A1_TRACE_KEY_MISSING`
- `A1_OVERRIDE_POLICY_VIOLATION`
- `A1_PII_POLICY_VIOLATION`

共通 envelope 形式は `02_Architecture/schemas.md` の `A1-ERROR-IF` を唯一参照先とし、
`contractId` は `A1-ATTR-IF` で固定する。

## Defaults
- reviewAttributionPolicy.storePII = false
- reviewAttributionPolicy.exportRedactionMode = "strip-identities"
- reviewAttributionPolicy.retention.maxEvents = 2000
- reviewEvents / reviewers 欠如は「履歴なし」として扱う

## Validation rules
- reviewerRef は空文字不可
- storePII=false の場合:
  - reviewers[].displayName / reviewers[].contact は保存しない（読み込み時に破棄、または無視）
- reviewEvents は以下を満たす:
  - id 重複なし
  - target.id は既存要素IDであることが望ましい
    - ただし過去イベントの再現のため、参照先欠落は 読み込み時にエラーにしない（警告扱い）
  - createdAt は ISO 文字列
- retention:
  - export/import 時に maxEvents を超える場合は古い順に削除してよい
  - details の肥大化を避けるため、必要なら event ごとの note 長を制限してよい（例: 500 chars）

## Export redaction behavior
- none:
  - reviewers / reviewEvents をそのまま出力
- strip-identities:
  - reviewers[].displayName / reviewers[].contact を除去
  - reviewEvents[].reviewerRef は残す（匿名ID）
- strip-all:
  - reviewers / reviewEvents を出力しない
  - policy 自体は残してよい

## Interoperability guidance
ReviewerRef 推奨フォーマット（例）:
- ローカル: user:local:<random>
- SSO: user:sso:sub:<subject>
- 組織独自: user:org:<opaque>

重要:
- reviewEvents は暗号署名されない前提であり、監査証跡としての強度は限定的。
- 将来拡張で detached signature を追加する場合も、上記構造を壊さず付加情報として実装する。

## Optional signing additions (Phase3 M6)

### File placement
- `review-signature.json`（新規、任意）
  - `ReviewSignatureEnvelope` を保存する detached signature ファイル
  - `document.json` / `view.json` を変更せず同梱する

### Verification status model
- 署名検証結果は監査ログ側で `ReviewSignatureVerification` として扱う。
- `reviewEvents` へ混在させない（レビュー操作ログの意味境界を維持）。

### Validation rules for envelope
- `keyId` は空文字不可
- `algorithm` は当面 `rsa-sha256` のみ許可（将来列挙拡張）
- `payload.*Digest` は `sha256:<hex>` 形式
- `signedAt` は ISO 8601 文字列
- `signature` は base64 文字列（空文字不可）

### Verification behavior
- 署名ファイル欠損:
  - `result=not_provided`
  - import / view / review 操作は継続（non-blocking default）
- 署名ファイルあり + 検証成功:
  - `result=passed`
- 署名ファイルあり + 検証失敗:
  - `result=failed` + `reasonCode`
  - 既定では read-only で閲覧継続可、share/export で追加確認

### Policy override (org optional)
- 組織運用で fail-closed が必要な場合のみ `requireSignature=true` を別途 policy で指定する。
- 既定は `requireSignature=false` とし、無署名をエラー扱いにしない。

### Backward compatibility
- 署名情報は sidecar 追加のため、既存 `ViewMetadata` スキーマ version を変更しない。
- 旧クライアントは `review-signature.json` を読まなくても動作可能。


## 7. AUTH-SCHEMA-01 連携: reviewerRef / ownerRef 正規マッピング

- 正規キーは `AuthContext.userId`（内部 `users.id`）とする。
- `reviewerRef` / `ownerRef` は派生値 `user:<users.id>` を採用する。
- `provider` や `external_uid` は attribution payload へ直保存しない。
- strict mode（`SUI_ALLOW_JIT_PROVISIONING=false`）では、`users.id` が未確定の要求を拒否し attribution を作らない。
- `reviewerRef` / `ownerRef` の具体値は `ReviewerRefResolverAdapter` が決定し、schema側は「non-empty opaque string」のみを保証する。
- adapterが `sso_subject` の場合は `user:sso:<provider>:<externalUid>` を許容し、入力不足時は `user_id` profile（`actorRef` → `null`）へフォールバックする。
- source判定は UI補助情報であり schema必須項目にしない（`reviewerRef` 単体で互換維持）。
- backfill時は `reviewerRef` / `ownerRef` のみを書換対象とし、`provider` / `external_uid` は attribution payload へ新規保存しない。

- `internal_user_id` は実体として `users.id` を指し、`reviewerRef` / `ownerRef` は表示・交換用の派生参照（`user:<users.id>`）とする。
- attribution の永続層では `provider` / `external_uid` を保持せず、参照逆引きは `user_identities` に委譲する。

これにより、IdP変更時でも `user_identities` の再紐付けで reviewer/owner 帰属を不変維持できる。

## Stream B Contract Annotation（schema-only fixation）

### Context
- review attribution schema は privacy/safeMode 境界を壊さずに、mock payload で独立検証できる形で固定する必要がある。

### Decision
- `reviewerRef` は non-empty opaque string とし、`provider` / `external_uid` の直保存を禁止する。
- `reviewEvents` / `reviewers` / `reviewAttributionPolicy` は型契約のみ固定し、実装値や運用値は本書で規定しない。
- A系契約ID参照は conditional を許容するが、schema key set の再定義は行わない。

### Consequences
- 下流は mock sidecar（`review-signature.json`）を含む入出力契約を先行検証できる。
- 用語統一（reviewerRef / ownerRef / reviewState）と safeMode境界の非侵害を schema review で担保できる。
- 実装段階での過収集PIIや契約外キー混入を fail-closed で検知できる。

### CE1整合メモ（Stream B / contract-only）
- 本書は review attribution 契約に限定し、`ContextQueryV1` / `ContextBundleV1` のキー集合を再定義しない。
- CE1 固定エラー語彙（`preview_required` / `unknown_contract_key` / `nondeterministic_bundle`）との衝突を導入しない。
- mock-first 検証時も safeMode 境界（PII最小化・匿名参照）を緩和しない。

## Stream G regression-hardening constraints (2026-05-18)

- Level1 契約境界: `reviewerRef` / `ownerRef` は non-empty opaque string、PII最小化、禁止キー（`provider`, `external_uid`）の fail-closed 検証を必須とする。
- Level2 統合境界: `users` / `user_identities` と attribution の参照整合、strict 403 契約、audit 記録の再現性を同時検証する。
- 自己修復上限: 契約不一致の自動修復は3回までとし、超過時は `StoppedForClarification` を返す。


## Stream D alignment note (2026-05-19)

- Contract drift抽出: review attribution は `DocumentV1` 埋め込み契約（L2.5）として維持し、個別CRUD保証を主張しない。
- Support level定義: `reviewerRef` / `ownerRef` / `reviewState` / `reviewedAt` は契約固定だが運用は `DATA-MODEL-OPS-01` のCRUD境界に従う。
- Admin maintenance/recovery境界: 削除・移管・監査閲覧などの高権限運用は `DATA-MAINT-01` のPending論点として分離し、先行実装しない。
- Verify: `schemas.md` と同じ support level語彙（L1/L1.5/L2/L2.5/L3/L0）を参照する前提で整合。

## Stream D migration boundary memo (2026-05-20)

- 本書は review attribution の契約提案を固定する文書であり、MVP時点では attribution 専用テーブル migration を要求しない。
- Alembic head `20260716_0006`ではtenant foundation表とDocument/判断ログの`tenant_id`がexpandされたが、review attributionは引き続き`Document`埋め込み前提とし、tenant列へ分解しない。
- したがって review attribution は `L2/L2.5`（埋め込み/契約先行）として扱い、個別CRUDや独立 migration を前提にしない。


## Stream E sync note (2026-05-20, Auth attribution only)

- Auth属性の正規化境界を再確認: `reviewerRef` / `ownerRef` は non-empty opaque string を維持し、Auth内部正本は `user:<users.id>` 派生参照とする。
- `provider` / `external_uid` は review attribution 永続層に保存しない（逆引きは `user_identities` へ委譲）。
- strict mode（`SUI_ALLOW_JIT_PROVISIONING=false`）時は `users.id` 未解決の要求を fail-closed で拒否し、attribution event を新規生成しない。
- mock IdP 回帰での差分吸収点は `AUTH_PROVIDER_PROFILE` と header mapping に限定し、schema key set は不変。
