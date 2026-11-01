# ADR-0104: 矛盾リンクの確認状態を外部投影に出さない

- Status: Accepted（2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（Issue #3302 の自律作業として決定）
- Scope: `03_Implement/frontend/src/export/context_bundle_projection.ts`、`02_Architecture/schemas.md`、`04_Documentation/mcp_agent_connection.md`
- Related: `ADR-0054`（外部接続層の段階導入）、`ADR-0093`（agent資格情報と投影の許可リスト）、`ADR-0103`（単位digest）、Issue #3302、TAI Pleroma issue #67

## 価値への寄与

V3「レビュー」に寄与する。外部agentへ何を「確認済み」として見せるかを絞り、人が付けた矛盾の判断を、文書の内容から独立した権威として外部へ出さない。投影の利用者は、確認状態を投影だけから推定しない。

次の不変条件は緩和しない。

- SafeModeは既定ONのまま。
- `human_reviewed` は人間だけが設定する。
- 未レビューのカードidを漏らさない既存ゲート（両端がレビュー済み）を維持する。
- 投影の `bundleHash` と `schemaVersion` の既存値を変えない。

## Context

`DocumentV1` の `EvidenceLink.contradictionState` は、`"unconfirmed" | "confirmed" | "held" | "resolved"` を持つ。これは人が付けた判断で、AI入力のIRには渡している。

一方、外部投影の `contradictions` は、`type === "contradicts"` かつ両端がレビュー済みのリンクを `{from, to}` に落とす。`contradictionState` も `note` も出さない。そのため、`resolved` の矛盾と `unconfirmed` の矛盾は、投影では同じ形になる。

`contradictionState` を投影に足すと、次の影響がある。

- 投影の `bundleHash` の入力が変わり、既存の値が変わる。`schemaVersion` の更新が必要になる。
- 人が付けた「確認済み」が、文書本文とは別の権威として外部agentに読まれる。ADR-0098が扱った島の題名と同様に、外部へ出す意味を決める必要がある。
- TAI Pleroma の SCN-001 は、真の矛盾・一般則と例外・古い案内を区別する題材だが、`contradictionState` の4値がその区別を表すとは決まっていない。

## Decision

`contradictionState` と `note` は、外部投影の `contradictions` に出さない。`resolved` の矛盾も、`unconfirmed` と同じ `{from, to}` として残す。

理由は次のとおり。

1. 確認状態は人が付けた判断であり、投影の他の構造項目（id、関係線、レビュー済み本文）とは性質が違う。外部agentへ「確認済み」として見せる意味を、まだ決めていない。
2. 既存の `bundleHash` と `schemaVersion` を変えずに済む。投影の利用者は、現在の契約のまま再計算できる。
3. `resolved` を単に除外すると、矛盾が存在したこと自体が投影から消える。確認状態を出さないことと、関係を隠すことは別である。

投影の `contradictions` は、引き続き「両端がレビュー済みの `contradicts` リンクの端点の組」だけを表す。`note` は出さない。

## Consequences

- 外部agentは、投影だけから矛盾の確認状態を区別できない。必要な利用者は、人向けの画面・書き出し、または将来の別契約を使う。
- `schemas.md` §1.4 に、確認状態が投影と `bundleHash` の入力に含まれないことを明記する。
- `context_bundle_projection.test.ts` に、`contradictionState` を設定しても投影の形が変わらないことを固定する。
- SCN-001の「真の矛盾／一般則と例外／古い案内」を投影で表す必要が出たときは、新しいADRで、状態の意味・露出範囲・`schemaVersion` の扱いを決める。このADRでは新しい分類を追加しない。
