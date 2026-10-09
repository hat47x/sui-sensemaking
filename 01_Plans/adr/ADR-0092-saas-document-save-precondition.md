# ADR-0092: 共有SaaSプロファイルの文書保存に、リビジョンの事前条件を必須にする

- Status: Accepted
- Date: 2026-10-09
- Deciders: Maintainer
- Scope: `03_Implement/backend/` の `PUT /docs/{id}`、`03_Implement/frontend/src/api/client.ts`、`02_Architecture/api.md`

## 価値への寄与

CVI（不変条件）のうち、人の判断と来歴が静かに失われないこと。共有環境で複数人が同じ文書を編集するとき、後から保存した側が前の変更を知らないまま上書きすると、レビュー済みの判断や保留・異論の記録が消える。

## Context

- `PUT /docs/{id}` は `If-Match` が無いと後勝ち（LWW）で上書きする。これは `api.md` に仕様として書かれ、単一利用者のプロファイルでは互換のために維持してきた。
- 同じバックエンドの他の更新経路は、すでに事前条件を必須にしている。`inquiry_bundles` のPUT/DELETE、`document_access` の更新、model allowlistの更新は、欠落を `428 Precondition Required` で拒否する。`PUT /docs/{id}` だけが例外だった。
- `If-Match: *` は更新で受理され、競合検査を迂回できた。
- 共有SaaS（`saas-multitenant`）は複数の利用者が同じ文書を編集する前提で、`ADR-0059` D10 は single-tenant の互換と SaaS の移行を分けると定めている。
- 比較した選択肢: (A) 現状維持、(B) 全プロファイルで必須化、(C) `saas-multitenant` だけ必須化。

## Decision

**(C) `saas-multitenant` だけ、`PUT /docs/{id}` に事前条件を必須にする。** 更新は具体的な `If-Match`、作成は `If-None-Match: *` を要求し、欠落と `If-Match: *` は `428 document_precondition_required` で拒否する。single-tenant 系のプロファイルは後勝ちを維持する。

理由: 単一利用者の端末で必須にしても守るものは少なく、外部クライアントを壊す費用だけが残る。共有SaaSでは静かな上書きが実害になる。プロファイル判定は、すでにtenant session事前条件で使っている `tenant_session_precondition_required` に揃え、新しい設定項目を増やさない。

非目標:

- single-tenant 系プロファイルの挙動変更
- 個別エンティティの差分同期や、同時編集の自動マージ（`ADR-0076` の範囲）
- クライアントの自動再送（`ADR-0061` D3 と同じく、競合を黙って再送しない）

## Consequences

- 共有SaaSでは、競合する保存が `409` で止まり、利用者が再読込して判断する。
- frontend は、tenant session の中で `ETag` を持たない保存を `If-None-Match: *` の作成として送る。既存文書への作成は `409` になる。
- 外部の自動化がSaaSの `PUT /docs/{id}` を使う場合は、`If-Match` の送信が必要になる。
- 二つのプロファイルの挙動差は、`api.md` と試験（`test_saas_e2e_tenant_isolation.py`、`client.test.ts`）で固定する。

## Traceability

- Related: `ADR-0059`（D10）、`ADR-0061`、`ADR-0073`、`ADR-0076`
- Derived-from: TEI側の `plan/design/SUI_MIGRATION_EXTENSION_AND_SPLIT_DESIGN_2026-10.md` 付録C
