# ADR-0107: 島の所属と関係線は単位digestに含めず、文書の版で固定する

- Status: Accepted（2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（Issue #3268 の自律作業として決定）
- Scope: `03_Implement/frontend/src/export/context_bundle_projection.ts`、`02_Architecture/schemas.md` §1.3/§1.4、`04_Documentation/mcp_agent_connection.md`、`03_Implement/mcp/README.md`
- Related: `ADR-0103`（単位digest）、`ADR-0106`（ナラティブ本文を出さない）、Issue #3266、#3268、#3299、TAI Pleroma issue #67 / PR #80

## 価値への寄与

V3「レビュー」に寄与する。外部agentが版固定に使う値を、レビュー済みの内容（カード本文・島の題名）と、文書全体の構造に分ける。島の所属を単位digestへ混ぜると、人がレビューしていない構造判断を「レビュー済みの内容」として固定してしまうため、分けたままにする。

次の不変条件は緩和しない。

- SafeModeは既定ONのまま。
- 未レビューのカードidを、所属や関係線から漏らさない既存ゲートを維持する。
- `human_reviewed` は人間だけが設定する。
- 既存の `bundleHash` と `schemaVersion` の値を変えない。

## Context

投影の `ProjectedIsland` は `id`、`title`、`digest` だけを持ち、`cardIds` と `parentIslandId` は出さない。関係線は `{from, to, type}` で、単位digestを持たない。

ADR-0103 §4 は、島のdigestの入力を `kind`、`id`、`title` に限り、所属カードの変更ではdigestが変わらないと決めた。`bundleHash` の入力の `islands` は `{id, title}` だけで、所属カードは直接含まれない。関係線は `relations` として `bundleHash` に含まれる。

したがって、島の所属だけを変えて `updatedAt` を進めない保存では、`bundleHash` も単位digestも変わらない。通常の保存は `updatedAt` を進めるが、クライアントが更新しない場合は検出できない（ADR-0093追記 / #3299 と同じ残存リスク）。

## Decision

島の所属カードと関係線を、単位digestの入力に加えない。版固定の使い方は次のとおりとする。

- カードの本文と島の題名は、ADR-0103の単位digest（`cards[].digest`、`islands[].digest`）で固定する。
- 島の所属、親島、関係線、根拠・矛盾の関係は、文書全体の `baseDocSignature`（`<docId>:<updatedAt>`）と `bundleHash` で固定する。関係線は `bundleHash` の入力に含まれる。島の所属は、通常の保存で `updatedAt` が進むことで検出する。
- `updatedAt` を進めない保存で所属だけを変えた場合は、`bundleHash` でも検出できない。これは既知の残存リスクであり、内容だけの版固定には単位digestを使う。
- 島の所属を `cardIds` として投影へ出すことは、このADRでは行わない。未レビューのカードを含まない形で出すかは、別の判断にする。

## Consequences

- 外部agentは、島の所属を単位で固定できない。所属の変化は、文書の版（`baseDocSignature` / `bundleHash`）の変化として扱う。
- `schemas.md` §1.3 と §1.4 に、島のdigestが所属を含まないこと、所属は文書の版で扱うことを明記する。
- `04_Documentation/mcp_agent_connection.md` と `03_Implement/mcp/README.md` に、単位digestの対象を明記する。
- `context_bundle_projection.test.ts` に、島の `cardIds` を変えても島のdigestが変わらないことを固定する。
- 所属を単位で固定する必要が出たときは、未レビューidのゲート、`item-digest` の版、`bundleHash` への影響を新しいADRで決める。
