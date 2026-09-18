# SUI → TEI Reference Adoption 比較基線

- Status: Baseline / Migration planning
- Date: 2026-09-18
- Parent: `issue-ARCH-TEI-MIGRATION-01-tei-reference-adoption-and-development-load-validation.md`
- TEI counterpart: `tei-platform/plan/issue/000052-sui-reference-adoption-and-plugin-surface-evaluation.md`
- Runtime impact: None
- Purpose: TEI移管による開発負荷低減を、既存SUIの実変更履歴と同一change challengeで比較可能にする

## 1. この文書の役割

SUIをTEIへ移管する価値は、「TEIで同じものが作れる」だけでは判断しない。

確認したいのは、SUIのProduct Valueと安全境界を維持したまま、

- 一つの意味変更が波及する層を減らせるか
- 同じ意味の重複記述を減らせるか
- Validation / Conformanceへ検証を寄せられるか
- 特殊実装を再利用可能なPluginへ分離できるか
- 将来の変更で手書きコードと回帰範囲を減らせるか

である。

そのため、移管前のSUI実装について、実際にmergeされた変更を比較基線として固定する。

## 2. 比較時に守る条件

TEI版だけ要件を簡略化して「少ない実装で済んだ」と評価してはならない。

各challengeでは少なくとも次を等価条件とする。

- SUIの意味上の挙動
- roundtrip / persistenceで失ってはならない情報
- SafeMode / review / authority境界
- accessibilityや失敗時挙動のうち当該変更に含まれるもの
- regressionとして当時固定した主要failure class
- Product Value上の非目標

UIのpixel-perfectな同一性は、challengeがVisual Fidelityを目的にしない限り必須としない。一方、意味や権限境界を省略して実装量を減らすことは禁止する。

## 3. Baseline Challenge A — 階層表示と表札

### 実履歴

SUI PR #235  
`feat(frontend): hierarchical level switch + sub-island placard support (FB-RM-MID-04)`

- merged: 2026-03-01
- changed files: 11
- additions: 328
- deletions: 10
- total changed lines: 338

主な変更箇所:

| Area | File / role |
|---|---|
| application composition | `App.tsx` |
| canvas projection | `canvas/IslandView.tsx` |
| domain model | `domain/types.ts` |
| patch application | `domain/patch/patch_apply.ts` |
| validation | `domain/validate.ts`, `validate_doc.ts` |
| validation tests | `domain/validate.test.ts` |
| view derivation | `domain/view/hierarchy_level.ts` |
| view tests | `domain/view/hierarchy_level.test.ts` |
| editing UI | `ui/SidePanel.tsx` |
| view controls | `ui/ViewControlsPanel.tsx` |

### Product上の意味変更

- Islandに親子関係が存在する。
- Islandがplacard cardを参照できる。
- overview / mid / detailで、同じ意味資産から表示粒度を変えられる。
- viewを変えてもDocumentの意味を暗黙変更しない。

### TEIでPressureするもの

- Canonical meaningとProjection stateの分離
- Data / RelationをUI状態と同一視しないこと
- 同じmeaningから複数Projectionを構成するRQ-011
- hierarchy / placardがTEI標準modelで表現できるか、それともSUI domain extensionとして保持すべきか
- view-level behaviorをApplication / Target側へ寄せることで、domain / validation / UIの同期箇所を減らせるか

### 成功の見方

TEI版で同じ意味変更を行ったとき、`App.tsx`相当、domain type、validation、view derivation、panel群へ同じ意味を繰り返し伝播させる必要が減ること。

## 4. Baseline Challenge B — Polygon頂点編集

### 実履歴

SUI PR #286  
`FB-P2C-04: Add constrained polygon vertex editing and shared polygon validator`

- merged: 2026-03-01
- changed files: 5
- additions: 191
- deletions: 28
- total changed lines: 219

主な変更箇所:

| Area | File / role |
|---|---|
| application / interaction wiring | `App.tsx` |
| specialized geometry | `domain/geometry/polygon_edit.ts` |
| geometry tests | `domain/geometry/polygon_edit.test.ts` |
| validation | `domain/validate.ts`, `validate_doc.ts` |

### Product上の意味変更

- polygon Islandの頂点を手動編集できる。
- 最小3点、自己交差禁止等の制約を維持する。
- 不正操作を意味上有効な状態として保存しない。
- geometryはsensemakingの意味そのものと同一ではない。

### TEIでPressureするもの

これはTEI Coreへpolygon primitiveを追加するためのchallengeではない。

確認対象は、

- complex spatial Interactionをnative componentとしてBindingできるか
- specialized validationをApplication側から呼べるか
- Target / Projectionとdomain validationを分離できるか
- spatial canvasを再利用可能Pluginとして抽出する価値があるか
- Plugin化しなくてもnative asset接続で十分な場合、それを正しく「成功」と扱えるか

### 成功の見方

polygon engineそのもののLOCが消えることを要求しない。

TEI導入後に、

- domain schema
- persistence
- UI shell
- validation wiring
- target integration

までpolygon固有実装が漏れ続けず、専門component周辺へ局所化できれば負荷低減とみなせる。

## 5. Baseline Challenge C — merge acceptの明示適用transaction

### 実履歴

SUI PR #2849  
`feat: 記録済みmerge acceptの明示的適用transactionを追加する`

- merged: 2026-09-03
- changed files: 3
- additions: 465
- deletions: 0
- total changed lines: 465

主な変更箇所:

| Area | File / role |
|---|---|
| plan / acceptance definition | issue memo |
| domain transaction | `domain/merge_suggestion_apply.ts` |
| transaction regression | `domain/merge_suggestion_apply.test.ts` |

### Product上の意味変更

- 「merge suggestionをacceptした」という記録と、実際にDocumentへ変更を適用することを分ける。
- 適用は明示transactionとして行う。
- stale / invalid / authority不足等を黙って成功へ丸めない。
- proposal / decision / mutationを同一イベントにしない。

### TEIでPressureするもの

- Proposal / Shared Acceptance Boundary
- Action / Commandとauthorityの分離
- stale baseの扱い
- Validation後の明示的mutation
- domain transactionをApplication固有コードとしてどこまで残す必要があるか

### 成功の見方

TEIのAcceptance / Validation / Action境界を利用することで、SUI固有コードが「mergeの意味」に集中し、

- generic stale handling
- authority / acceptance
- mutation envelope
- common audit / provenance
- rollback / failure representation

をSUI側で再実装しなくて済む方向へ減ること。

## 6. 追加補助Baseline

Challenge A〜Cを主比較とするが、必要に応じて以下を補助する。

### Hierarchyのcross-cutting拡張

SUI PR #241  
`Add hierarchy-level view controls and export/import support; factor hierarchy visibility logic`

- changed files: 10
- additions: 227
- deletions: 33
- total changed lines: 260

同じhierarchy concernがUIだけでなくexport / import / view metadataまで波及した例として、Challenge Aの「変更増幅」を見る補助Evidenceに使う。

## 7. TEI移管の初期戦略

全面rewriteから始めない。

### Stage 0 — native encapsulation

- 現行`DocumentV1`を当面のauthoritative native assetとして維持する。
- SUIの意味正本をTEI側へ複製しない。
- TEIがnative assetをSource / Adapter / Capability境界から扱えるかを確認する。
- Canvasは既存componentをそのまま利用可能な候補として扱う。

### Stage 1 — stable semantic mapping

Card / Island / Relation / review / proposal等のうち、TEIへformalizeする価値があり、SUI側でも安定している部分だけをmappingする。

この段階では、

```text
SUI native source
  -> TEI mapping / Canonical projection
  -> validation / application reference
```

とし、二つのauthoritative sourceを作らない。

### Stage 2 — Application shell / Target

TEIのWeb Target / Application surfaceがReference Adoption可能な段階になったら、

- view controls
- side panel
- review / proposal UI
- import / export orchestration
- generic form / command / validation surface

の共通部分をTEI側へ寄せる。

Canvasのspecialized rendering / interactionはnative componentのままでもよい。

### Stage 3 — Plugin discovery

SUIで繰り返し必要になり、別Applicationでも再利用可能性があるものだけPlugin候補にする。

初期候補:

- spatial / graph canvas projection
- complex direct-manipulation interaction host
- review / diff visualization
- offline artifact / bundle exchange

Plugin化のためにSUI固有semantic objectをTEI Coreへ追加しない。

### Stage 4 — advanced sensemaking

AI Workspace、Review Capsule、複数認知器等は、SUIのsemantic artifact contractとTEI移管境界が安定してから本格実装する。

## 8. Gap分類表

Reference中の不足は必ず次で記録する。

| Class | 意味 | 原則 |
|---|---|---|
| A — Existing TEI | 現行TEIで表現可能 | 既存機能を使う |
| B — Reusable extension | Plugin / Adapter / Capabilityとして一般化可能 | Coreより先にextensionを試す |
| C — Native SUI | SUI固有・専門性・性能上nativeが妥当 | TEIからBindingする |
| D — TEI product gap | 複数Applicationに共通する意味上の欠落 | 第二Reference等のEvidence後にRequirement候補 |

Dが多いほど良いわけではない。B / Cで健全に境界を保てるなら、それ自体がTEIの小さいCoreという価値に沿う。

## 9. 構造化設計適性も比較対象にする

TEI移管の価値は、単に同じ機能を少ないLOCで実装できるかだけではない。

SUIでは、Card / Island / Relation / hierarchy / review / proposal等がすでに図表的・構造的な情報として存在する。そこでReference Adoptionでは、

> **一度整理した構造化情報から、Validation・Projection・Target・文書・AI向けcontextをどこまで再利用して導けるか**

も比較する。

各challengeについて、次を記録する。

- 同じ意味を複数箇所へ再記述している数
- 一つのCanonical / authoring definitionから導出できる派生物の数
- 図・表・グラフ等のProjectionを切り替えても意味を再入力せずに済むか
- UI変更とdomain meaning変更を分離できるか
- Validation / documentation / AI contextが同じ構造化情報へ戻れるか
- custom codeでしか表現できない領域がどこに残るか

この観点を **structure-to-application leverage** と呼ぶ。

TEI版が優位であるとは、すべてをmodelへ押し込むことではない。**構造化して価値がある意味は一度だけ定義し、特殊挙動だけをnativeへ局所化できること**を重視する。

## 9. 比較記録フォーマット

各challengeについて次を記録する。

| Metric | Current SUI | TEI-based | Notes |
|---|---:|---:|---|
| changed files | | | generated除外も併記 |
| hand-written changed lines | | | generated / vendoredを分離 |
| semantic source locations | | | 同じ意味を書く正本数 |
| validation locations | | | |
| test files touched | | | |
| manual sync steps | | | |
| native SUI LOC remaining | | | |
| TEI Plugin LOC | | | |
| TEI Core changes | | | 0が望ましい初期仮説 |
| conformance-detected failures | | | |
| rollback / revert surface | | | |

単一の総合scoreへ畳まず、どこで負荷が減り、どこで増えたかを読む。

## 10. 最初の判定基準

SUI本格移管を進める最低条件は、少なくとも3 challengeのうち複数で、

1. change amplificationが明確に減る
2. SUI固有の意味がTEI固有schemaへ歪められない
3. TEI Core変更を常態化させない
4. specialized native codeが局所化する
5. regression / conformanceの自動検出範囲が増える

こと。

一方、TEI用のmapping / Adapter / generated artifact同期が増え、二重管理が発生する場合は移管を限定または延期する。

SUIをTEIへ移すという方針そのものを守るのではなく、**SUIを実例としてTEIのProduct Valueを検証する**ことを優先する。
