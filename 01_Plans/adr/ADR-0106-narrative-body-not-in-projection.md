# ADR-0106: ナラティブの本文と題名を外部投影に出さない

- Status: Accepted（2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（Issue #3270 の自律作業として決定）
- Scope: `03_Implement/frontend/src/export/context_bundle_projection.ts`、`02_Architecture/schemas.md` §1.4、`04_Documentation/mcp_agent_connection.md`、`03_Implement/mcp/README.md`
- Related: `ADR-0054`（外部接続層の段階導入）、`ADR-0093`（agent資格情報と投影の許可リスト）、`ADR-0098`（人による自己申告と島の題名）、`ADR-0103`（単位digest）、Issue #3270、TAI Pleroma issue #67

## 価値への寄与

V3「レビュー」に寄与する。外部agentに渡す読み取り面を、レビュー済みのカードと島の構造に限定し、ナラティブ本文という新しい露出面を増やさない。TAIなどの利用者は、`narrativeChecks` の件数と向きから検査の状態を参照できる。

次の不変条件は緩和しない。

- SafeModeは既定ONのまま。
- 未レビューのカードを投影に出さない既存ゲートを維持する。
- `human_reviewed` は人間だけが設定する。
- 投影の `bundleHash` と `schemaVersion` の既存値を変えない。

## Context

投影の `narrativeChecks` は、検査の `id`、件数（`counts`）、向き（`issueDirections`）だけを返す。ナラティブの `title` と `text` は返さない。

`Narrative` は `reviewed: boolean` を持つが、本文は未レビューのカードを引用し得る。カード本文のレビュー状態と、ナラティブ本文に含まれる引用の安全性は別である。ADR-0098は島の題名について、人が確認した短い見出しとしてSafeMode ONでも返すと決めたが、ナラティブ本文は見出しより長く、引用の範囲も広い。

投影に本文を足すと、次の影響がある。

- 投影の `bundleHash` の入力が変わり、既存の値が変わる。`schemaVersion` の更新が必要になる。
- レビュー済みナラティブの本文を、未レビューのカードの引用ごと外部へ出す経路ができる。
- 単位digestの入力に本文を含めるか、別の版固定を決める必要がある。

## Decision

ナラティブの `title` と `text` を、外部投影に出さない。投影は引き続き `narrativeChecks`（`id`、`counts`、`issueDirections`）だけを返す。

理由は次のとおり。

1. ナラティブ本文は未レビューのカードを引用し得る。ナラティブの `reviewed` は、引用元カードのレビュー状態を保証しない。
2. 投影に本文を足すと、`bundleHash` と `schemaVersion` の変更を伴う新しい露出面になる。利用者の需要と、引用元のレビューを確認する方法を先に決める必要がある。
3. 現行の `narrativeChecks` で、検査の件数と向きは参照できる。本文が必要な利用者は、人向けの画面・書き出しを使える。

## Consequences

- 外部agentは、投影だけからナラティブ本文を取得できない。TAIは、`narrativeChecks` とレビュー済みカードの内容で足りるかを確認する。
- `schemas.md` §1.4 に、`narratives` の本文・題名が投影と `bundleHash` の入力に含まれないことを明記する。
- `04_Documentation/mcp_agent_connection.md` と `03_Implement/mcp/README.md` に、投影が返すナラティブ項目を明記する。
- `context_bundle_projection.test.ts` に、レビュー済みナラティブの本文・題名を設定しても投影のJSONと `bundleHash` が変わらないことを固定する。
- 本文を露出する必要が出たときは、引用元カードのレビュー確認、SafeMode、単位digest、`schemaVersion` を新しいADRで決める。
