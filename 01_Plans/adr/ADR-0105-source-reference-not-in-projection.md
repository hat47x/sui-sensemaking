# ADR-0105: カードの出典参照を外部投影に出さない

- Status: Accepted（2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（Issue #3285 の自律作業として決定）
- Scope: `03_Implement/frontend/src/export/context_bundle_projection.ts`、`02_Architecture/schemas.md` §15、`04_Documentation/mcp_agent_connection.md`、`03_Implement/mcp/README.md`
- Related: `ADR-0048`（`Card.meta` の加算スキーマ）、`ADR-0056`（カード来歴メタデータの境界）、`ADR-0093`（agent資格情報と投影の許可リスト）、`ADR-0103`（単位digest）、Issue #3285、TAI Pleroma issue #28 / #67

## 価値への寄与

V3「レビュー」と、外部共有の安全境界に寄与する。出典参照は内部資料のURLや行番号を含み得るため、外部agentへの既定の露出を増やさない。人が出典を確認して共有する経路は、既存の書き出しの明示トグルに残す。

次の不変条件は緩和しない。

- SafeModeは既定ONのまま。
- 未レビューのカードを投影に出さない既存ゲートを維持する。
- `human_reviewed` は人間だけが設定する。
- 投影の `bundleHash` と `schemaVersion` の既存値を変えない。

## Context

`Card.meta.source` は、原発話・観察記録の行番号・URLなどを書く自由記述の任意項目である（`schemas.md` §15）。文書外部の原データへ戻る手がかりだが、内部情報を含み得る。

共有向け書き出しでは、`Card.meta` を既定で含めず、「出典参照を含める」の明示トグル（既定OFF）でオプトインする（§15.4）。投影 `context-projection.v1` は、このトグルを持たない。`ProjectedCard` は `meta` を返さず、MCPの `get_context_projection` はその投影をそのまま返す。

TAI Pleroma の SCN-001 は、資料から成果物までの対応を確かめる題材であり、出典への参照を必要とする。ただし、投影に載せるには、レビュー済みカードだけに限るか、SafeMode ONでどう扱うか、既定OFFのオプトインをどう持ち込むかを決める必要がある。

## Decision

`Card.meta.source` を、外部投影の `cards` に出さない。`meta` 全体も出さない。

理由は次のとおり。

1. 出典は内部情報を含み得る。レビュー済みの本文でも、出典の安全性はレビューされていない。本文のレビュー状態を、出典の露出許可として流用しない。
2. 投影には明示トグルがない。既定OFFのオプトインを投影へ持ち込むには、ツール入力・`schemaVersion`・`bundleHash` の変更が必要で、既存の利用者に影響する。
3. 単位digest（ADR-0103）の入力にも出典を含めない。含めると、出典の編集だけでdigestが変わり、「レビューされた文章の版固定」という意味が広がる。

## Consequences

- 外部agentは、投影だけから出典へ戻れない。出典が必要な利用者は、人が明示トグルをONにした書き出し、または人向けの画面を使う。
- `schemas.md` §15 に、外部投影では `meta` を出さないこと、代替の経路を明記する。
- `04_Documentation/mcp_agent_connection.md` と `03_Implement/mcp/README.md` に、投影の `cards` に出典が含まれないことを明記する。
- `context_bundle_projection.test.ts` に、`meta.source` を設定しても投影のJSONと `bundleHash` が変わらないことを固定する。
- 将来、レビュー済みの出典だけを明示オプトインで投影する必要が出たときは、新しいADRで、ツール入力、`schemaVersion`、`bundleHash`、SafeModeとの関係を決める。
