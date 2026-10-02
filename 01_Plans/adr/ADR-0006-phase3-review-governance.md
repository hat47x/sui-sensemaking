# ADR-0006-phase3-review-governance: Phase 3: レビュー・統治

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: `01_Plans/phase3_review_governance.md`

## Context

`phase3_review_governance.md` で管理していた計画・要件・受入条件を、ADR運用へ移管する。

## Decision

以下を本ADRの正本として採用する。

# Phase 3: Review Governance (Plan)

本フェーズはMVP後の拡張であり、レビュー運用（責任所在・共有・監査）を整える。  
実装は段階的に進める。セキュリティ/プライバシを優先する。

## Progress update（2026-02-23 確認）

- Overall: **In Progress（部分着手）**
- 判定方針: 03_Implementの実装有無とテスト有無を基準に判定。

| Milestone | Status | 根拠 |
|---|---|---|
| M1: Current reviewer (local) | ○ Done (2026-03-06) | `reviewerRef` の localStorage保持と UI導線を実装。 |
| M2: ReviewEvent append on review toggle | ○ Done (2026-02-26) | `reviewEvents` データモデル・reviewed toggle連動・view metadata export/import保持を実装。 |
| M3: Export redaction | ○ Done (2026-03-06) | `view.json` に redaction モードを追加し、bundle は既定 strip-identities。 |
| M4: Merge audit log integration | ○ Done (2026-03-06) | `mergeAuditLog` / `reviewEvents` を同居トリム（決定論）で統一。 |
| M5: Org deployment hooks (optional) | ○ Done (2026-03-07) | reviewerRef adapter I/F と SSO subject→reviewerRef 正規化契約を architecture/api/schema と同期。 |
| M6: Optional signing (non-MVP) | ○ Done (2026-03-03) | detached signature のデータモデル、検証フロー、無署名時 non-blocking UI/運用、鍵管理・監査ログ・互換方針を設計文書へ反映。 |

> 注記: M4 の「部分着手」は `mergeAuditLog` 単体の実装確認に基づく。Phase 3 の DoD 充足には `reviewEvents` 実装と export/import 連携が必要。

## Objectives
- “人間がレビューしたか”を確実に区別できる
- 誰がレビューしたかはオプトイン（匿名ID既定）
- 成果物エクスポート時に適切に削除できる
- 多環境（ローカル/イントラ/自前ホスト）で成立する

## Milestones

### M1: Current reviewer (local)
- [x] ローカル環境でreviewerRefを生成・保持（localStorage等）
- [x] UIで “Current reviewer” を設定可能（displayNameは既定OFF）
- Done criteria:
  - 設定したreviewerRefが再起動後も維持される

### M2: ReviewEvent append on review toggle
- [x] island/card/summaryのreviewedを切り替える操作時にReviewEventを追記
- [x] reviewerRef（あれば）とcreatedAtを記録
- Done criteria:
  - [x] reviewEventsがview.json export/importで保持される

- 実装メモ（2026-02-26）は次のとおりです。
  - `reviewEvents` をview metadataに追加し、import時はsanitizeして後方互換（欠損許容）を維持。
  - reviewed toggle連動対象: card text / island title / island summary / island image / relation summary。
  - retention上限は `2000` 件で古いイベントからトリム。

### M3: Export redaction
- [x] view.json exportにredactionモードを実装
- [x] review pack / bundle exportで既定strip-identities
- Done criteria:
  - 公開用にstrip-allを選ぶとレビュー履歴が消える

### M4: Merge audit log integration
- [x] I29のmergeAuditLogとreviewEventsの整合（同居・保持上限）
- Done criteria:
  - レビュー運用ログが肥大化しない

### M5: Org deployment hooks (optional)
- [x] reviewerRef生成規約の差し替え（adapter interface）
- [x] SSO subjectをreviewerRefにできる
- Done criteria:
  - [x] 認証があっても無くても動く

実装メモ（2026-03-07）は次のとおりです。
- `ReviewerRefResolverAdapter` の責務を「`AuthContext` から `reviewerRef/ownerRef` を解決する一点」に固定。
- profileは `user_id`（既定）/`sso_subject`（任意）を提供し、`sso_subject` は入力不足時に `user_id` フォールバックを適用。
- 永続payload（reviewEvents/view export/import）は `reviewerRef` のopaque string契約を維持し、既存互換を壊さない。
- PII最小化として、`provider` / `external_uid` の生値はattribution payloadへ保存せず、resolver内部の派生ID生成のみに使用。

### M6: Optional signing (non-MVP)
- [x] detached signatureを設計（ファイル単位署名）
- [x] 署名検証UI（任意）
- Done criteria:
  - [x] 署名が無い場合も通常利用を阻害しない

### M6 Detailed spec (decision record)

#### 1) Detached signature 設計
- sidecar方式を採用し、`review-signature.json`（任意）にdetached signatureを格納する。
- 署名対象は `document.json` / `view.json` とreview attribution正規化データから生成したdigest集合。
- `ReviewSignatureEnvelope` は `version`, `keyId`, `algorithm`, `signedAt`, `payload`, `signature` を必須とする。

#### 2) 検証フロー / 失敗時挙動
- 署名ファイル欠損: `not_provided`（情報表示のみ、通常利用継続）。
- 署名あり検証成功: `passed`。
- 署名あり検証失敗: `failed`（既定では閲覧継続可、share/export時に追加確認）。
- fail-closedが必要な組織運用のみpolicy override（`requireSignature=true`）で拒否可能。

#### 3) UI/運用仕様（non-blocking）
- UIの署名状態は `Unsigned` / `Verified` / `Verification failed` を表示。
- `Unsigned` はwarningではなくinfo扱い。
- `Verification failed` は直ちに編集停止しないが、外部共有系操作にガードを追加。

#### 4) 監査ログ・鍵管理・後方互換
- 署名検証結果は `reviewEvents` と分離し、監査ログ系列へ記録（`verifiedAt`, `result`, `reasonCode`, `keyId`）。
- private keyはアプリ外（CI/CD or signing service）で管理し、`keyId` によるローテーション前提で運用。
- 既存 `document.json` / `view.json` は変更しない。未対応クライアントは署名ファイルを無視可能。

#### 5) AC / DoD（M6）
- AC-1: detached signatureのデータモデルがarchitecture + schema文書で定義済み。
- AC-2: 署名対象（document/view/review policy+events digest）とcanonical化要件が記載済み。
- AC-3: 検証フロー（成功/未提供/失敗）とUI表示要件が定義済み。
- AC-4: 無署名non-blocking既定とfail-closed optional policyが定義済み。
- AC-5: 監査ログ分離、鍵管理（key rotation）、後方互換（sidecar追加）方針が明記済み。

DoD:
- `02_Architecture/review_attribution.md` と `02_Architecture/schemas_review_attribution.md` が本仕様と整合。
- docs-check（リンク/整合/体裁）を実行し、エラーなし。

## Risk notes
- doxxing/個人情報流出は最大リスク。storePII=falseを既定にする。
- 改ざん可能性は残るため、“監査証跡”用途は署名まで到達してから。


## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | MVP後の拡張としてレビュー運用（責任所在・共有・監査）を整える。セキュリティ/プライバシを優先し、改ざん可能性を考慮して「監査証跡」用途は署名まで到達してから扱う | 機能: レビュー運用の計画を段階的に実装し受入条件を固定。データ: 責任所在・共有・監査を明確化しレビュー統治を整える |
| **データ設計** | `phase3_review_governance.md`の内容を本ADRへ移管し旧文書は廃止して参照を統一。既存リンクは本ADRパスへ更新 | 業務: レビュー統治の実装判断をADR履歴で追跡する。機能: セキュリティ/プライバシ優先の方針を実装に反映する |
| **機能設計** | レビュー運用（責任所在・共有・監査）の実装計画を参照しやすい単位に移管し、Phase 3実行の入力として利用できるようにする | 業務: MVP後の拡張として段階的にレビュー統治を導入する。データ: 旧`phase3_review_governance.md`は廃止し情報欠落なく本ADRへ移管 |

## Consequences

- 旧文書 `phase3_review_governance.md` は廃止し、本ADRへ参照を統一する。
- 既存リンクは `01_Plans/adr/ADR-0006-phase3-review-governance.md` へ更新する。

## Traceability

- Source: `01_Plans/phase3_review_governance.md`
- Supersedes: `01_Plans/phase3_review_governance.md`
