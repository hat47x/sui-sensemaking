# ADR-0116: SUI sensemaking構造のTEI参照にSource状態と文書単位の開示制限を加える

- Status: Proposed（参照consumer側の限定拡張。`source.status` と文書単位の開示宣言のproducer契約はOwner判断待ち）
- Date: 2026-11-11
- Deciders: Maintainer（設計判断はPR・Issueへ記録し、意味契約の採否はOwnerが決める）
- Scope: `03_Implement/backend/src/sui_sensemaking_api/tei_sui_reference.py`、`03_Implement/backend/src/sui_sensemaking_api/routes/tei_epistemic.py`、`02_Architecture/api.md` §2.18
- Related: `ADR-0101`（TEI transport）、`ADR-0102`（テナント業務面の紐付け）、`ADR-0114`（handoff）、SUI #3401（I0 設計棚卸し）、SUI #3369（本文公開の未決）、SUI #3387（局所I/Oの上限）、TEI #2488（SUI DocumentV1パイロット）、TEI #2497（構造保存写像）、TEI #3394（一機能移行）

## 価値への寄与

V3「レビュー」と P-07「self-host/privacy」に寄与する。SUIのDocument、Card、Island、RelationをTEI側から型付きで参照できるようにしつつ、未レビュー本文・非公開情報・失効したSourceを「読める」と混同しない。ADR-0089 §6 の区分では「運搬の便利さ」に属し、既存の `GET /docs/{doc_id}/tei/sui-reference`（api.md §2.18）を置き換えず、その抜けを埋める限定拡張である。

## Context

2026-11-11時点の前提である。

- SUIの最新mainには、TEI Reference artifact `tai.reference.tei-documentv1-projection/v0` を読み、`tai.reference.sui-document-reference/v0` へ型付けする経路が実装済みである（`tei_sui_reference.py`、`GET /docs/{doc_id}/tei/sui-reference`）。本文・題名・要約・review attributionを返さず、Card参照は `acceptedMeaning: false` である。
- その経路は、同一名称のCard、複数Islandへの所属（containmentとaffiliationの区別）、有向Relation、多重Edge、未レビューCard、部分取得、entity単位の非公開、Revision変更を区別している。
- 一方で、artifactの `source` が失効・期限切れであることを表す経路がなく、Document自体の開示制限を表す経路もentity単位の省略だけである。この二つは、Source失効と開示制限を「参照が返らない」ではなく「参照を返さないと決める」状態として区別できない。
- TEI側のartifact契約は当面 `documentv1-projection` であり、SUIは第二のデータ正本を作らない。TEIのData Provider・共通API（ADR-0048）はartifactを生成する側の責務であり、SUI側のconsumerはその出力を読むだけに留める。

## Decision

`GET /docs/{doc_id}/tei/sui-reference` に、次の二つを**省略可能な入力**として加える。どちらも無い既存artifactは今までどおり動く。

1. **Source状態**: `source.status` が `revoked` または `expired` のとき、参照を返さず `409 sui_reference_source_revoked` / `409 sui_reference_source_expired` で閉じる。`active` 以外の未知値・欠落は `unknown` として扱い、`losses[]` に `source-status: unresolved` を加える。`unknown` を `active` に読み替えない。
2. **文書単位の開示宣言**: Documentの `visibility`/`disclosure`/`access`/`scope` が `private`・`restricted` 等を示す場合、またはpayloadの `disclosure.scope` が制限を示す場合、参照を返さず `403 sui_reference_disclosure_restricted` で閉じる。entity単位の `restrictedKinds` は従来どおり、当該entityだけを除く。

あわせて、有向Relationの `parallel`（`groupRef`・1始まりの `index`・`count`）を返し、同じfrom/to/typeの多重Edgeを、端点の組だけで畳まずに区別できるようにする。

## 変更しないこと（安全不変条件）

- Card本文、Island題名、Document題名、Narrative、要約、review attributionを返さない。
- DocumentV1の保存・変更、レビュー状態の変更、`human_reviewed` の設定を行わない。
- Cardを読めることをTEIのAccepted Meaningとして扱わない（`acceptedMeaning: false` を維持する）。
- 第二のデータ正本、意味Registry、第二のProviderを作らない。artifactは既存の局所I/O transportと紐付けからだけ読む。
- 既存のendpoint、エラーコード、`documentDigest` の意味を変えない。

## SUI構造とTEIモデル表現の対応

| SUI | TEI referenceでの表現 | 状態 |
|---|---|---|
| Document | `sui.document` の不透明ID、`documentDigest`、任意の`sourceRevision` | 参照可。題名・本文は返さない |
| Card | `sui.card` のID、`claimType`、`holdState`、`textReviewed`、`content.status`、canvas座標 | 参照可。本文は返さない |
| Island | `sui.island` のID、`titleReviewed`、`containmentCardRefs`、`parentIslandRef` | 参照可。題名・polygonは返さない |
| Tree | なし | `tree-forest: unsupported` |
| Canvas | Cardの`x`/`y`のみ | `canvas-transform: partial` |
| Relation（Edge） | `relationKind: directed`、`fromRef`/`toRef`、`relationType`、`parallel` | 参照可。根拠は返さない |
| Relation（containment） | `relationKind: containment` | 参照可。occurrence IDは組から導出 |
| Relation（affiliation） | `relationKind: affiliation`、Affiliation ID | 参照可。containmentと混同しない |
| Revision | `documentDigest`、`sourceRevision`、`change`、`previousReferenceInvalidated` | 参照可。履歴は返さない |
| Review | `textReviewed`/`titleReviewed`の真偽と`unknown` | 参照可。attributionは返さない |

## 区別することと、その担保

| 区別 | 実装 | 試験 |
|---|---|---|
| 同一名称の異なるCard | IDで区別し、名称で畳まない | `test_same_name_cards_keep_distinct_identities` |
| 複数Islandへの所属 | containmentとaffiliationを別のrelationとして保持 | `test_multi_island_membership_distinguishes_containment_from_affiliation` |
| 有向Relation | `fromRef`/`toRef`を保持し、逆向きを別occurrenceにする | `test_directed_relations_and_multi_edges_are_preserved` |
| 多重Edge | Edge IDごとに保持し、`parallel.groupRef/index/count` を付ける | `test_parallel_edges_keep_group_and_occurrence_index` |
| 未レビュー情報 | 参照は残し、`content.status="withheld-unreviewed"` とする | `test_unreviewed_is_kept_as_withheld_reference` |
| 部分取得 | 宣言された`completeness`と理由を返し、完全と推定しない | `test_private_entity_is_omitted_without_id_or_count` |
| 非公開情報 | entity単位は省略、文書単位は403で全内容を返さない | `test_private_entity_is_omitted_without_id_or_count`、`test_route_document_disclosure_restriction_fails_closed` |
| Revision変更 | `change` と `previousReferenceInvalidated` で初回・不変・内容変更・source revision変更を分ける | `test_reference_change_and_re_reference_invalidate_prior_reference`、`test_source_revision_change_is_distinct_from_content_change` |
| Source失効 | `revoked`/`expired` で409、内容を返さない | `test_revoked_or_expired_source_fails_closed_without_entities`、`test_route_revoked_source_fails_closed_without_identities` |

## 損失・未対応・未解決の明示

| 対象 | 扱い | 理由 |
|---|---|---|
| Tree/Forest | `unsupported` | DocumentV1投影v0に存在しない。containmentと`parentIslandId`をTree階層と呼ばない |
| Canvas transform/z-order/zoom/gesture | `partial` | Card座標だけを保持する |
| Island geometry（polygon/rect） | `partial` | containmentとparent linkだけを保持する |
| Review attribution | `unsupported` | 真偽フラグだけで、reviewer・時刻・履歴を持たない |
| Narrative/要約/critique | `unsupported` | artifactに存在しない |
| Relationの根拠 | `unsupported` | 向き・種別・IDだけを保持する |
| Document題名 | `unsupported` | 内容であり、この経路では返さない |
| Source revision | `unresolved`（欠落時） | `documentDigest` は内容指紋でありSUIのrevisionではない |
| Source状態 | `unresolved`（欠落時） | `unknown` を `active` と読み替えない |

## SUI既存方式との比較

同じ合成Document（Card 1,000、Island 20、Directed Edge 1,100のうち200が並行、Affiliation 1,000）を、プロセス内で次の二方式に通した。2026-11-11、Python 3.12、ローカル実行の実測であり、配備後のlatencyではない。

| 観点 | SUI既存方式（DocumentV1） | TEI連携方式（typed reference） |
|---|---|---|
| 構築時間 | 39 ms（`DocumentV1` validation） | 127 ms（参照の構築。relationをoccurrenceごとに列挙する） |
| payload | 350 KB | 903 KB（全occurrenceと損失を明示するため大きい） |
| 本文バイト | 53,890 | 0（本文を返さない） |
| 非公開entity | 除去は呼び出し側の判断 | entity単位で省略、文書単位で403 |
| 未レビュー | 本文ごと返る | 参照だけを返し、本文を伏せる |
| 変更検知 | revision/ETagの比較を別途実装 | `documentDigest` と `sourceRevision` を分けて返す |
| 追加DB読み取り | 文書本体を読む | 文書内容の追加読み取りなし（認可とartifact読み取りのみ） |

**読み取れること**: この経路の実利は速度ではなく、本文バイトを0にし、未レビュー・非公開・失効・部分取得を型で区別できる点にある。構築時間とpayloadは既存方式より大きい。したがって、性能を理由に既存のDocumentV1経路を置き換えない。

## 残る制約とOwner判断

- **本文公開**: この経路は #3369 の「カード本文を業務面へ出してよいか」を先取りしない。本文が要る用途は別の判断である。
- **producer契約**: `source.status` と文書単位の開示宣言は、TEI側のartifact生成契約にまだ無い。無い場合は `unknown` として動く。契約として固定するかはOwner判断とする。
- **Source失効の意味**: `revoked` を「参照の無効」と「Sourceの削除」のどちらとして扱うかは、TEI側のSource管理と合わせて決める。本ADRは参照を返さないことだけを決める。
- **Revision**: `documentDigest` は内容指紋であり、SUIの保存revisionそのものではない。両者を同一視しない。
- **Tree/Forest**: 表現が増えた場合も、containmentをTreeと呼ばない。

## Consequences

- 参照consumerは、Source失効と文書単位の開示制限を、部分的な内容ではなく明示的な失敗として受け取れる。
- 既存artifactは変更なしで動く。`source.status` が無い場合は `unknown` として損失に現れる。
- 多重Edgeを端点の組で畳むconsumerは、`parallel.count` を無視すると区別を失う。契約として `parallel` を読む必要がある。
- 性能・payloadのコストは既存方式より大きい。参照の用途を、本文を返さず区別だけを渡す用途に限定する。

## Traceability

- Issues: SUI #3401（I0）、SUI #3369（本文公開の未決）、SUI #3387
- Related: `ADR-0101`, `ADR-0102`, `ADR-0089`, TEI #2488, TEI #2497, TEI #3394
- Supersedes: なし
