# ADR-0058: Document契約を単一V1へ再基線化する

- Status: Accepted
- Date: 2026-07-15
- Deciders: Project Maintainer
- Scope: `02_Architecture/`, `03_Implement/frontend/`, `03_Implement/backend/`, `03_Implement/mcp/`

## Context

現在の永続Document契約は、初期のキャンバスだけを表す `DocumentV1` と、島、根拠、レビュー、文章化など現在の製品機能を表す `DocumentV2` を併存させている。フロントエンドは旧V1を読み込んでV2へ補完し、バックエンドAPIはV1/V2のユニオン型を保存する。

しかし本プロジェクトはプレリリース段階であり、現時点にOSS運用者、移行対象となる実利用データ、公開済みの安定API利用者はいない。旧V1を維持すると、次の負債だけが残る。

- API、型、fixture、説明文書で常に二つのDocument契約を理解する必要がある。
- 旧V1では現在の主要機能を表現できず、読込時の暗黙補完がデータ欠落と正規化を区別しにくくする。
- 製品公開後に整理すると、実利用データの移行と互換期間が必要になり、変更費用が大きくなる。
- 現在の完全な契約が最初から「V2」と見えるため、公開利用者に不要な歴史的事情を負わせる。

比較した案は次のとおりである。

1. 旧V1の受付だけを削除し、現行名 `DocumentV2` と `version: 2` を維持する。変更量は小さいが、公開契約に不要な版履歴が残る。
2. `version` を廃止して単一 `Document` とする。現在は簡潔だが、将来の破壊的移行を安全に識別できない。
3. 現V2を新しい唯一の `DocumentV1` / `version: 1` として再基線化し、旧V1とV2の互換経路を削除する。

## Decision

現行 `DocumentV2` の構造を、公開前の唯一の `DocumentV1`（`version: 1`）として再基線化する。旧 `DocumentV1` の最小構造、`DocumentV1 | DocumentV2` のユニオン型、V1からV2へのアップグレード処理、文字列版番号（`"v1"` / `"v2"`）の受付は削除する。

新しいV1は現V2の必須構造を引き継ぐ。特に `islands` を必須配列として検証し、旧V1を新V1として誤認して暗黙補完しない。未知の版番号、版番号欠落、旧最小構造は安全側で拒否する。

採用理由は、利用者と移行対象データが存在しない今が、互換負債を増やさず公開契約を単純化できる最後の低費用な時点だからである。版番号は将来の移行境界として残し、次の破壊的変更は `version: 2` で導入する。

非目標は次のとおりである。

- Document全体スナップショットを正規化テーブルへ分解しない。
- 任意フィールドの支援レベルや個別CRUD境界を変更しない。
- `PatchDocumentV1`、`InquiryJourneyV1`、`RoundSnapshotV1` など、Documentとは別契約の版番号を変更しない。
- 過去ADRや完了issueに記録された当時の `DocumentV2` という事実を履歴から削除しない。

## Consequences

- 公開利用者が理解する永続Document契約は一つになる。
- フロントエンド、バックエンド、MCP、fixture、E2E、現行設計文書の横断変更が必要になる。
- 旧V1/V2ファイルは新しい版では読み込めない。実利用者がいないという前提が崩れた場合は、本変更の公開前に移行CLIを別issueで起票する。
- `DocumentV1` だけを見ても現在の製品機能を表現でき、型名と版番号が一致する。
- 将来の破壊的変更では、利用実績を確認したうえで `DocumentV2` と明示的な移行経路を新設する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | OSS運用者・移行対象データ・公開API利用者が存在しないプレリリースの今を最後の低費用な時点とし、永続Document契約を単一の`DocumentV1`へ再基線化。公開利用者が理解する契約を一つにし版履歴の負債を残さない | フロントエンド・バックエンド・MCP・fixture・E2E・現行設計文書の横断変更が必要。旧V1/V2ファイルは新しい版では読み込めないため、実利用者が現れた場合は公開前に移行CLIを別issueで起票 |
| **データ設計** | 現行`DocumentV2`の構造を唯一の`DocumentV1`（`version: 1`）として再基線化し`islands`を必須配列として検証。旧ユニオン型・アップグレード処理・文字列版番号の受付を削除し、未知版・欠落・旧構造は安全側で拒否 | Document全体スナップショットを正規化テーブルへ分解せず、任意フィールドの支援レベルや個別CRUD境界を変更しない。`PatchDocumentV1`・`InquiryJourneyV1`・`RoundSnapshotV1`などDocumentとは別契約の版番号は変更しない |
| **機能設計** | Document API・型・fixture・説明文書は単一`DocumentV1`のみを扱い、旧V1読込時の暗黙補完を廃止。版番号は将来の移行境界として残し、次の破壊的変更は`version: 2`で導入 | 過去ADRや完了issueに記録された当時の`DocumentV2`という事実を履歴から削除しない。将来の破壊的変更では利用実績を確認したうえで`DocumentV2`と明示的な移行経路を新設 |

## Traceability

- Related: `02_Architecture/schemas.md`
- Related: `02_Architecture/api.md`
- Related: `02_Architecture/data_model_operations_overview.html`
- Related: `01_Plans/issues/done/issue-DATA-CONTRACT-RESET-01-document-v1-rebaseline.md`
- Derived-from: `01_Plans/adr/ADR-0033-mvp-data-support-and-maintenance-boundary.md`
- ADR-0047 R-4（破壊的契約変更）: 旧 `DocumentV1`/`DocumentV1 | DocumentV2` ユニオン型とアップグレード処理の削除、未知版を安全側で拒否することという、永続契約への破壊的変更である。
- Related governance: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`

