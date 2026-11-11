# ADR-0117: 製品横断Handoff票 `yi.handoff.context/v1` をSUI Producer側に置く

- Status: Proposed（二製品間の最小経路。開示Scope語彙・Consumer契約はOwner判断待ち）
- Date: 2026-11-11
- Deciders: Maintainer（設計判断はPR・Issueへ記録し、意味契約の採否はOwnerが決める）
- Scope: `03_Implement/frontend/src/export/handoff_context_envelope.ts`、`03_Implement/frontend/src/export/handoff_context_emit.test.ts`
- Related: `ADR-0114`（handoff）、`ADR-0116`（TEI参照のSource状態と開示制限）、`ADR-0054`（外部接続のread-only投影）、TAI SK-03 §4（Handoff票の最小要素）、SHO `bin/sho-inspect.cjs handoff`

## 価値への寄与

V3「レビュー」と P-07「self-host/privacy」に寄与する。SUIのread-only投影を別製品へ渡すとき、**何を渡したか・何を渡していないか・何が未確認か**を型で区別できるようにする。会話履歴の丸写しではなく、Task・根拠・未完了の義務・確認が必要な依存関係だけを運ぶ。

## Context

- SUI→SHOの既存経路（P0）は、`renderReadOnlyMarkdownDraft` が作る354 bytesのread-only Markdownを、SHOの実CLI `bin/sho-inspect.cjs inspect` が読む一点張りのbyte契約である。byteは一致しても、**どの製品の何のRevisionで、どの範囲まで開示してよく、何が未解決で、Consumerが何を再確認すべきか**が運ばれない。
- Harness Sessionは運搬経路であって、データ正本・意味受理・権限・実行結果の集約先ではない。Sessionを中央正本にしないためには、Session外に**受渡し用の一時Projection**が必要である。
- TAI SK-03 §4はHandoff票の最小要素を列挙しているが、正式な交換Schemaは作らないとしている。したがって本書は**既存の投影・CLI契約の延長**として最小の票を定義し、新しい共通Schema正本・第二Host・権限Engineは作らない。

## Decision

`yi.handoff.context/v1` をSUI Producer側に実装する。一つのHandoff操作は、payload 1ファイルと票 1ファイルの組だけを書出す。

1. **運ぶ欄**：元製品（`producer`・`target`）、対象ID、Revision（`kind`・`value`・`digest`）、開示Scope（`disclosure.scope`・`audience`・`rawSource`）、参照先（`references`）、未解決情報（`unresolved`）、用途上の制限（`usageRestrictions`）、Task（`task`）、根拠（`evidence`）、未完了の義務（`obligations`）、確認が必要な依存関係（`dependenciesToConfirm`）、Consumerの再確認要求（`consumerRecheck`）、残作業（`residualWork`）。
2. **運ばない欄**：会話履歴（`conversationHistory.included=false` を宣言）、Card本文の生データ・Island題名・Document題名・原本Source、権限・Grant・資格。権限系keyと資格マーカーは実行時に拒否する。
3. **fail-closed**：`disclosure.scope` は閉集合のみ。未知の値は `active` や `public` へ読み替えず拒否する。`payload.relPath` はbare filenameのみ。digestは `sha256:<64小文字hex>` のみ。
4. **自動送出なし**：書き出しは呼び出し側の明示的操作だけ。このModuleはI/Oを行わない。自動送信・バックグラウンド送信・直接POSTの経路は存在しない。
5. **transportは観測のみ**：`transport.authority` は常に `none`。Harness名・Sessionラベルは運搬の記録であり、資格・再送保証・継続許可を与えない。

## 権限の混入を防ぐ二つの検査（2026-11-11 見直し）

1. **key名の完全一致**（`AUTHORITY_BEARING_KEYS`）: `grant`・`token`・`credential`・`secret`・`password`・`authorization`・`permission`・`role`・`lease` 等を、大文字小文字を無視して**anywhere**で拒否する。票は閉じた型なので、この検査は「将来の編集が権限欄を足すこと」と「Consumerが受け取った票を改変して権限を足すこと」の両方を止める。
2. **資格素材の形**（`AUTHORITY_MARKERS`）: 直列化後の票に `-----begin`・`bearer `・`authorization:`・`private key`・`api_key`・`access_token` 等が現れないことを確認する。

**重要**：`credential` や `secret` を**単語として**禁じると、他製品の読み取り専用観測を引用したときに偽陽性になる。TEIの参照Workspaceには `security.credential`・`security.authorization_grant` というsubject IDが実在し、TEI read-only CLIのcatalog出力に現れる。したがって marker は**自然文や業務識別子にまず現れない、serializeされた資格素材の形だけ**に限定する。業務語の扱いは key名の完全一致側で行う。この見直しは `handoff_context_envelope.test.ts` の「他製品の読み取り専用観測を引用しても資格マーカーと誤判定しない」で固定する。

## 変更しないこと（安全不変条件）

- Card本文・Island題名・Document題名・Narrative・要約・review attributionを票やpayloadへ載せない。
- SafeMode・未レビュー非公開・`human_reviewed`・proposal-onlyの境界を緩和しない。
- SUIのDocumentV1保存・レビュー状態・`acceptedMeaning` を変えない。
- 第二のデータ正本・意味Registry・第二のProvider・共通Agent Runtimeを作らない。
- MCP Tool一覧・既存endpoint・既存のP0 byte契約（354 bytes／固定SHA）を変えない。

## 消費者側の契約（SHO）

SHOは票を信じない。`bin/sho-inspect.cjs handoff <票>` が、payloadを**実CLIで独立に再読取**し、票の宣言（`byteLength`・`sha256`・`relPath`）と実bytesの一致を確認してから受領Receiptを返す。不一致・部分受領・改変は fail-closed とする。SHO側の実装は独立に書かれ、このModuleを共有しない（片方のbugがもう片方へ無音で伝播しないため）。

## 損失・未対応・未解決の明示

| 対象 | 扱い | 理由 |
| --- | --- | --- |
| 会話履歴 | 運ばない | HandoffはTaskと根拠の継続であり、対話の複製ではない |
| 原本Source | 参照のみ | 原本はSUIが保持。票はlocatorだけを持つ |
| Review attribution | 運ばない | 真偽フラグのみ。reviewer・時刻・履歴は持たない |
| Source revision | `unresolved` | SHOの`source.revision=unknown`を現行性確認済と読み替えない |
| 開示Scope語彙 | 閉集合の候補 | `synthetic-only`／`reviewed-projection-only`。語彙の確定はOwner判断 |
| 受領Receiptの返送 | 未実装 | SHO→SUIへReceiptを戻す経路は次の段階 |
| 三製品以上・別Harness実実行 | NOT RUN | 二製品の成立後に段階的に検証する |

## Consequences

- Consumerは「何が開示され、何が未確認か」を型で受け取れる。`[]`や`unknown`をglobal不存在や安全と読み替えにくくなる。
- Harness差し替え時に、票が権限を運ばないため増幅の経路が生じない。差し替え後の再確認は`consumerRecheck`で要求される。
- 票の構成を変えると変化検出ピンが崩れる。pinは独立期待ではなく、構成変化の検出である。

## Traceability

- Issues: SUI #3397（SUI→SHO P0）、#3369（本文公開の未決）、#3387
- Related: `ADR-0054`, `ADR-0101`, `ADR-0114`, `ADR-0116`, `ADR-0089`, TAI #168 / #271 / #232
- Supersedes: なし
