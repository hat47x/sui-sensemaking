# SUI 情報統合：原文復帰から構造横断へ進む段階的受入計画

- 状態: **Proposal／未採用。実製品E2E・T2はNOT RUN**（2026-11-14）
- 位置付け: ROADMAPから参照する**実施順と非干渉条件の索引**。仕様・実行権限・新Schemaの正本ではない
- 一次価値: [ADR-0089](adr/ADR-0089-product-value-canon.md)、非後退: ADR-0041、外部接続: [ADR-0111](adr/ADR-0111-meaning-preserving-external-cognition-interface.md)
- 設計Owner: [Hybrid Tree/KJ](hybrid_outline_canvas_layout_plan.md)（Draft [#3437](https://github.com/hat47x/sui-sensemaking/pull/3437)を含む）／[意味形成 #3400](https://github.com/hat47x/sui-sensemaking/issues/3400)／[高度情報統合 #3401](https://github.com/hat47x/sui-sensemaking/issues/3401)
- 実証Owner: [R0/R1 #3438](https://github.com/hat47x/sui-sensemaking/issues/3438)、[R2 #3441](https://github.com/hat47x/sui-sensemaking/issues/3441)、[共同Undo #3399](https://github.com/hat47x/sui-sensemaking/issues/3399)、[SUI→SHO #3391](https://github.com/hat47x/sui-sensemaking/issues/3391)

## 1. 設計方針と前提

SUIの利用者が行う仕事は、分類前のRaw資料を読み、意味として生きる範囲を人間が選び、Card/Island/Relation/保留・異論を探索し、後日根拠に戻って見立てを更新することである。大規模なData Federation、全形式のImporter、AIによる自動統合、PERT、共通Storageサービスをこの一次価値の完了条件にしない。

SUIで扱う情報本体（Raw/Item）、意味の候補（解釈/関係/Role）、構造（Tree・Island・Affiliation・Graph）、表示出現（Canvas/TreeのDisplay Occurrence）、表現成果（Markdown/図解）、原Sourceの実体・Revision・現在Grantを区別する。現行のDocumentV1を上記の完全な新モデルへ移行済みと呼ばず、Schemaの追加を本計画から承認しない。元Sourceと文書化結果が同じbyteでも、Authority/現在性/意味/Write資格は独立である。

Treeの親子はMind Map/KJ Canvasへ**薄い背景枝として投影**できるが、島所属、意味Edge、位置は独立する。Canvas座標からTree親子を復元しない。巨大Canvasの分割・同一Itemの複数Canvas表示は後段のNon-interference試験とし、R2の前提にしない。

## 2. 現在の証拠と未到達

| 対象 | 確認済みの範囲 | まだ主張できないこと |
| --- | --- | --- |
| R0 Draft [#3439](https://github.com/hat47x/sui-sensemaking/pull/3439) | 現DocumentV1をSQLiteへ保存し、別PythonプロセスのASGI TestClientでGETしてCard/Island/Held/Edgeを確認。backend-contract 316 passed、CI success | 実Browser再開、Raw Reader、別Canvas、Owner受理。PRはDraft／未統合 |
| R1 Draft [#3440](https://github.com/hat47x/sui-sensemaking/pull/3440) | 限定ローカルReferenceでRaw byte、UTF-8 span、hash、別Root反例。ローカル11/11、同HEAD CI success | 正式Host Grant/Source Binding、Product Reader API、Card/Document保存接続。PRはDraft／未統合 |
| R2 [#3441](https://github.com/hat47x/sui-sensemaking/issues/3441) | 受入条件R2-SRC-01〜08が定義済み | 原文→人手抽出→Card保存→別Process/Browserで元位置へ復帰する製品縦断。NOT RUN |
| 情報統合 [#3401](https://github.com/hat47x/sui-sensemaking/issues/3401) | II-01〜12と二資料橋渡しIB-01〜06の独立Expected候補 | 異種Sourceの実E2E、共通Snapshot、T2の認知増分。NOT RUN |

**実測した狭い範囲と、未実装の広い範囲を混同しない。** Referenceがsource digestを計算できても、同内容・同相対path・別Rootは区別できず、現行Card.meta.sourceは検証済みSource spanではない。

## 3. 二つの接続契約（永続Schemaの追加ではない）

### 3.1 根拠復帰の接続

Consumerが「Cardから元資料に戻る」と主張するには、少なくとも現在のHostが許可するSource scope/Root、Content revision、選択位置、現在の再読結果、Document/Cardの保存revisionを**別々に照合**する。任意の人手選択範囲を強制的に一文へ分割しない。取得不能、stale、権限拒否、未取得、部分取得、Reader未対応を空集合と同一視しない。

- 同文の二箇所のうち人が選択した方を再特定する。UTF-8 byte spanは現Raw Readerの限定方法であり、PDF page/rect、音声time span、Table row identityは用途別Position方式の将来候補。
- Digestが同一でもA→B→Aの歴史・別Rootの同一性・現在Grantを推測しない。確かな再束縛がなければread-only/unknownとし、別の文へ自動再リンクしない。
- 外部Agent用Projectionへは許可されないRaw本文・内部locator・ID・件数・ETagを流出させず、Sourceの参照資格と二次開示資格を別判定する。

### 3.2 構造横断の選択コンテキスト

Reader/KJ/Tree/Table/Timeline/Graph間の**表示上の選択引継ぎ**は、グローバルItem registryや書込Patch型ではなく、現在の利用者・Document/Source scope・選択対象種別とID・参照revision・任意の表示Occurrence・可視対象集合/Filter・開示条件を再解決する、用途限定の操作として検討する。

- 元Cardと同じItemをA/B Canvasへ置く場合でもDisplay Occurrenceは別。Aの座標・選択範囲の変更がBの位置、Tree親子、Island/Affiliation、意味Relationを無条件変更しない。
- 現行KJからReaderへ戻る往復を先に確認。Table/Timelineへの同選択表示は必要性が確認されてから追加。未表示・部分取得・非開示を「対象は存在しない」と表示しない。
- 読取Projectionの内容・digestが同じでも、元Source/構造が同じとは言えない（TEI [#2497](https://github.com/hat47x/tei-platform/issues/2497)）。Markdown/OKF・Graph→Treeの非単射投影から元SUIへの自動逆Patchを認めない。
- AIの配置候補を適用するときは、書込対象だけでなく「他カードの位置」「Island/Treeの所属」等のreadSet依存も比較する。base/currentが異なるなら再Preview・保留・拒否。UndoとRevision復元、意味判断履歴を同一視しない（[#3399](https://github.com/hat47x/sui-sensemaking/issues/3399)）。

この2契約は**観測すべき入力と不変条件の整理**であり、共通Reference Envelope・全アプリ共通API・新DBテーブルを先に要求しない。

## 4. 実施順と停止線

| Gate | 実製品で実証すること | 合格・停止条件 | 正本 |
| --- | --- | --- | --- |
| **IG0 基礎を保持** | AI OFF、既存3 Card KJ、Save/Read、Hold/Edge/Island | 新Reader導線なしでも基本編集が維持。従来操作を破壊しない | ADR-0089、R2-SRC-08 |
| **IG1 R2原文復帰** | 単一の許可Raw→人手選択→Card→保存→別Process/BrowserでReader復帰 | 元bytes/選択位置・Revision・Grantの独立再照合。R2-SRC-01〜08の負例を評価。Product接続が無ければ未達 | #3441 |
| **IG2 二資料対照** | 独立Raw A/BをReaderで選択→Cardに置き、関連候補・矛盾・保留を残す | 誤同定/別Root混合0、A/Bへの個別復帰、非公開漏出0。IB-01〜06を再利用 | #3401追補 |
| **IG3 限定異種統合** | IG2成功後、構造化CSVまたはRDBの一Sourceと、遅着Event/時系列を追加 | Source別の対象/時刻/単位/Revision/coverageを保持。同時取得を共通Snapshotとは宣言しない。II-01〜08を評価 | #3401 I1/I2 |
| **IG4 複数View/Canvas** | 同一Itemを二Canvasへ別表示、Reader/KJ/Tree等を切替、分割・非干渉・差分Preview | 位置/Tree/Island/Affiliation/Edge/Reviewの非干渉、選択対象の再解決、CAS競合/Undo、跨る保存のpartialを観測 | Hybrid SI-XC、#3399 |
| **IG5 文書化・外部Consumer** | SUI構造候補→損失付きMarkdown→SHO Reader→筆者の採否・Writer保存後再Read | Loss/保留/異論/未公開範囲を維持。Source byte・Consumer byte・保存receiptを分離。元SUIへの自動逆編集0 | SUI #3391、SHO [#19](https://github.com/hat47x/sho-composer/issues/19) |
| **IG6 実務価値判断** | MaintainerのSUI自身を題材にしない実務資料で従来手法/KJのみ/統合表示を比較 | 新たに見えた関係、保留・異論の保持、元資料復帰、操作負担、誘導・害を個別評価。Fixture PASSをT2と呼ばない | ADR-0089、#3400、#3401 |

IG4/IG5はIG1〜IG3から切り離して技術研究できるが、IG0/IG1の製品完了条件を拡大しない。特にSHO側のEditor/Reader/WriterはSUIフルUIに依存させず、TEI Studioセルフビルドと双方の作業優先順位を尊重する。実務T2が価値を示さなければ、Source Reader＋KJと手動照合へ戻す。

## 5. 他製品へ渡すもの・渡さないもの

| 接続 | 渡してよいもの（検証・認可した範囲） | この成果だけでは認めないこと |
| --- | --- | --- |
| SHO | 文書化候補、選択済み根拠への参照、Tree/Island/RelationのLoss、未決・異論 | 原SUI構造とB型文章が同値、Markdownの逆Patch、正式Writer成功 |
| TEI | 型付きread-onlyの対象・関係・状態・版/損失の候補。Graphは向き・多重辺IDを保持 | Source/Meaning/ActionのAuthority獲得、SUI Cardを受理済み業務Entityへ昇格 |
| SEI/TAI/外部Harness | 許可された目的別Projection、Proposal、参照範囲、revision/partial等の状態 | AI出力のhuman_reviewed昇格、非公開Sourceの開示、Agentの実Effect許可 |

TEIのData/Graph/時系列/標準表現・Go単一バイナリ・外部Host/Provider方針は**将来のConsumerと生成候補**として参照する。SUIのIG0〜IG2へTEI共通DSL、専用Host、汎用Role Resolver、Graph DB、RAG索引を導入しない。PERTは明示的なTask/Dependency/Duration/Calendarが揃う場合の**後段Projection**であり、KJ Card/IslandをTaskや因果関係に自動昇格しない。

## 6. 実装担当への引渡しと証拠票

次の変更で最初に行う仕事は、[#3439](https://github.com/hat47x/sui-sensemaking/pull/3439)と[#3440](https://github.com/hat47x/sui-sensemaking/pull/3440)の基線を再読して、[#3441](https://github.com/hat47x/sui-sensemaking/issues/3441)の**IG1実製品R2**を最小差分で完成すること。新File/DB SchemaやHost Grantが要るなら、それらを既存Product入口とOwnerへ戻して決める。IG1の合格前にIG2以降の新機能を実装開始条件にしない。

各Gateでは「対象Source/Scope・実byte・Source revision・Document revision・Reader/Writer process・具体的な操作・Expectedを先に記述・Actual/CI HEAD・未実施・部分/不明・Owner資格」を記録する。AIなし正常系、同内容別Root/同文二箇所、A→B→A、権限、保存409/ACK不明を一因子反例として扱う。外部送出後は**Producer成功・Transport成功・Consumer実Read・Writer commit・Meaning受理・外部Effect**を別行で報告する。

**撤退条件**：全Sourceの中央取込、共有Registry、抽象APIの実装が先行して元資料への復帰や認知上の効果を示せない場合、IG1/IG2の小さなSource Reader・手動KJへ戻す。未実装を静かに成功扱いしない。

---

本書は既存Issueに散在する受入の**実施順索引**であり、既存ADR・Hybrid Draft・R2作業票の上書きではない。新たな権限、Schema、共通技術基盤、製品機能の正式採択を意味しない。