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


### 6.1 R2製品接続のFit/Gap（実コード確認、未実装）

実装者用の具体的な引渡しは、[R2 #3441 実コードFit/Gap追補](https://github.com/hat47x/sui-sensemaking/issues/3441#issuecomment-6869227748)を参照する。R0/R1の個別試験成功からR2 Product完成を主張できない理由を、**永続化・認可・再読込**の3点に絞って固定した。

- `backend/src/sui_sensemaking_api/models.py`：`CardMeta`は`seq`と説明用`source: str`のみ。未知`meta`キーは消える。`CardBase.sources: list[str]`も出典位置・版の認証情報ではない。`DocumentV1`に現在のRaw Source Bindingを検証できる専用表現が無い。**未宣言`meta.sourceBinding`の挿入や、説明文字列へのJSON隠蔽は保存解決策にしない。**既存欄/分離された許可済み保存先/最小型付き拡張のFit/GapはProduct Ownerが判断する。
- `02_Architecture/api.md` §1.3：単一Tenant系のPUTは`If-Match`が無いとLWW、SaaSは具体的ETag必須。R2では現GETから取得したETagに基づく**明示的な条件付きPUT**を正常系とし、旧ETagの409・ACK不明の独立GET再照合を別に検証。LWWを共同編集安全の証拠にしない。
- R1 `experiments/r1_raw_source_probe.py`：明示Root下の1MiB以下のUTF-8 bytes・期待digest・half-open範囲検証に限定。Host Grant、OS Race、A→B→A履歴、正式Root Identityは担わない。Product側で現在のSource scope/Root/Grantを検査できない場合は**Reader公開APIへ接続しない**。Referenceの検査を認可と読み替えない。
- R0 `tests/test_docs_cross_process_readback.py` とR1 `tests/test_r1_raw_source_probe.py` は別実験。**同じSource/選択位置→Card保存→別ProcessのProduct GET→現在RootでのRaw再Read**を連結して初めてIG1達成と判定する。後段のBrowser UIはこの経路の別観測として実施する。

作業順は **F0 既存入口・保存先のFit/Gap／Owner決定 → F1 許可済みRawの手動選択 → F2 明示If-Match保存と別Process GET → F3 現在Source再照合と負例 → F4 Browser実操作**。適切なSource Authorityが存在しないならF1以前で停止して`unqualified`と記録し、合成Referenceとしてのみ検証を継続する。既存R2-SRC-01〜08を使い、新たなExpected正本を作らない。**全F0〜F4の製品実装・E2Eは今回NOT RUN。**

### 6.2 Source Bindingの保存候補と採否ゲート（F0判断票・未採用）

**R2の重要な区別**：Cardに保存すべきものは「人がどのSourceのどの範囲を選んだか」という**選択の履歴**であり、「いまSourceを読んでよい」という**現在のGrant**ではない。Raw原文とCardの解釈を一つの本文に畳まない。Host/Providerはその時点のRoot/Scope/Grantを再解決し、保存済みDigest・相対path・Workspace名・旧PermissionをCurrent Authorityの代用にしない（TEI [#4504](https://github.com/hat47x/tei-platform/issues/4504)の同Manifest別Rootの読取反例と整合）。

| F0の候補 | 長所 | 未解決・棄却の条件 |
| --- | --- | --- |
| **A：Card内の任意・型付きSource選択記録** | 既存DocumentのSave/GET・ETag・Card IDと一緒に扱える。第二の書込単位が増えない。**最初にFit/Gapを見る候補** | 現CardMetaの未知属性は消える。Python/TSの双方で明示契約、旧Document互換、外部Projectionの除外を確認するまで採用しない。説明用meta.sourceへ隠しJSONを入れない |
| **B：Document内のCard ID→Source選択記録** | 同じDocument CASでCardとの関係を維持できる | 新DocumentV1欄の仕様判断、Card削除・改名・複製時の孤児参照、Frontendでの保存往復を解決できなければ不適格 |
| **C：既存Providerの独立したSource参照記録** | 既に実Source管理能力があるProviderならDocument型を変えずに使える | Card保存とSource参照が別Commit/Receiptになる。部分失敗・ACK不明・孤児・独立ReadとRecoveryを説明できないならR2の最小経路として棄却。新共通CASや中央台帳は作らない |

最低限区別する**設計上の列**は、Document/Card identity、qualified source locator、選択時点のSource revisionとdigest、Selector kind（R2ではUTF-8 half-open byte span）、start/end、選択原bytesのdigest、Card側の解釈・Holdとの分離。**これらはまだ永続化JSON Schemaではない。** Rootの実OS path、Grant Token、CredentialをCardに直接記録しない。Source Locator自体も、現在の開示権限に応じて伏せる。

**採否Gate**：①独立ExpectedのRaw byte位置を人が選ぶ、②既存Documentへ明示If-Matchで保存、③Writer終了後の別Process Product GETで同Card ID・必要な選択情報を読める、④現在許可されたRoot/Scope/GrantとRaw bytesを再照合、⑤不一致ならCard・異論・Holdを保ったまま出典復帰だけ停止、⑥許可外のAgent/SHO/TEI投影からLocatorや隠れたID・件数を開示しない。この**一つの縦断**が通るまでA/B/Cの選択を「実証済み」にしない。Ownerは実験着手時に最小案を選ぶ。

**負例（独立Expectedの重複SSOTは作らない）**：未宣言metaに記録した値がSave/GETで消える、同文2回の先頭へ誤ジャンプ、同内容・別Rootへ自動再束縛、If-MatchなしのLWWを安全な共同編集と主張、存在しないSourceを「抽出0件の正常系」と表示。既存[R2-SRC-01〜08 #3441](https://github.com/hat47x/sui-sensemaking/issues/3441)の検査方法として追加する。

### 6.3 依存の種類に応じた選択的再資格化（IG1と後段を分離）

全Document・Activity・Consumerを一律に失効させることも、同じDigest/OK Receiptだけですべてを継続有効とみなすこともしない。変更影響を既知の依存と現在Version/Scopeから説明し、分からなければ**そのClaimだけunknown**とする。

| 変化 | 再確認する部分 | 条件付きで保持できる部分 |
| --- | --- | --- |
| Raw Source内容/Revision、A→B→A | 原文復帰、引用根拠、Source依存の解釈・同定候補。Digest一致で履歴連続を推定しない | Cardに残った人間の見立て・違和感・保留の履歴。ただし根拠の現在性は別表示 |
| Card本文・意味・Hold変更 | それに依存した島の説明・共有候補・構造Draft | 独立したRaw Source、無関係のCard、別Canvasの表示 |
| Canvas位置・Tree表示だけの変更 | 位置依存の説明・当該Viewと選択epoch | 原Raw、Card本文、意味Edge、独立Occurrence |
| Grant・Disclosure失効 | Rawの新規Read、AI/SHOへの新規送信、派生Index/Cacheの利用資格 | 人間が残したCard記録自体。過去に送出した情報の消去保証はしない |
| Harness/Skill/Plugin/Consumer版の変更 | 当該Instruction/Toolの実Load、対象情報の開示、実行権限とConsumer受領 | AI OFFの手動KJ・関係ない既存Card・別のProduct |

IG1は**Source・Document・現在Grant**の必要部分だけを検査する。後段IG4では選択epoch、IG5では外部ConsumerやSkillの資格を追加し、**初回R2の追加Blocking条件にはしない**。変更無影響を主張するときは依存するSubject/Source/Scopeを説明し、根拠なしに「問題なし」と判断しない。TEI [#2582](https://github.com/hat47x/tei-platform/issues/2582)、TAI [#271](https://github.com/hat47x/tai-pleroma/issues/271)を参考とし、新Reactive Runtimeや中央Evidence台帳は作らない。

## 7. 表示選択の再資格化と反応的な再取得（IG4の実証契約）

TEI [#2582](https://github.com/hat47x/tei-platform/issues/2582)のFunction Data Context／選択epoch、[#2500](https://github.com/hat47x/tei-platform/issues/2500)の逆編集資格、[#2497](https://github.com/hat47x/tei-platform/issues/2497)の非単射を、**SUI固有のRead/Preview/Applyの負例**として取り込む。TEI Reactive Runtimeを待たず、SUIの最初の受入は独立したread-only照合。UI selectionを新しい永続SSOTやAction資格にしない。

### 7.1 同じ選択でも、6つの別資格を区別する

| 観点 | SUIの最小的な照合 | 混同しないもの |
| --- | --- | --- |
| Source / Document | source scope・許可済みRoot・実Content Revision、Document保存Revision | 同じbytes/digestと同じSourceの現在性 |
| Meaning / Item | Cardまたは対象候補のIdentity・人の解釈・異論・Hold | 表示位置・文字列・業務上の確定Identity |
| Occurrence / View | CanvasまたはTreeでの表示Occurrence、View ID、選択対象の表示状態 | Item本体・他Canvasの同Item表示 |
| Selection / Request | Window/Consumer・その選択のepoch・依存したreadSet・要求発行時点 | 古い非同期応答の現在表示への採用資格 |
| Coverage / Time | 可視集合、filter、未取得・部分取得・非開示、Source時刻・観測時刻 | 空結果／不存在、異Sourceの同時Snapshot |
| Operation / Disclosure | 現在のActor/Grant・SafeMode・許可用途・書込対象とOwner | 読み取り可／表示可／編集可／意味受理／外部Effect |

この表は**照合用の観点**であり、6つを全操作の必須fieldや新APIへ固定しない。IG1の単一Raw→Cardでは必要なSource/Selection/Saveの値のみを観測し、IG4で複数Consumerを扱う際に不足を評価する。

### 7.2 read-only表示から編集への橋

1. 人間の選択を、対象・Scope・現Revision・発行Window/epochで局所的に固定してReader/KJ等へ問い合わせる。
2. 応答には照合できるSource/Document/Contextの範囲を添え、**そのWindowで現在の選択条件が変わっていれば古い応答を現在値へ適用しない**。別Windowの同じSubjectは巻き込まない。
3. 表示Projectionの損失・取得範囲・非開示・失効を分け、曖昧な場合は参照表示に留める。Hidden IDや件数などの存在情報も許可外へ開示しない。
4. 編集可能な対象が一意に戻る場合に限り、Draft/Proposalと差分Previewを生成する。非単射の集計・Tree化・Markdown化から元データ更新対象を推定しない。
5. Applyの直前に、writeSetだけでなく提案が参照したreadSet（他Card位置、Island、Tree、元Sourceなど）、現在の保存Revision、Ownerの操作資格を照合する。競合は再Preview/保留/拒否とし、既存Document CASと共同UndoのOwner [#3399](https://github.com/hat47x/sui-sensemaking/issues/3399)を用いる。
6. ACK不明やProvider結果の部分成功は、成功扱いや無条件の再Submitを行わず独立Read/Receiptの資格に戻す。過去の人間Reviewや意味履歴は表示・Undoで消さない。

TEI [#4350](https://github.com/hat47x/tei-platform/issues/4350)・[#4351](https://github.com/hat47x/tei-platform/issues/4351)は、型・構造・表現・写像の確認項目を持つ**参照設計／Reference受入**として利用する。Source/Target・Identity/Multiplicity・Presence/Coverage・Time/Quantity・Loss・Operation資格の各差を検査できるが、その12列をSUI製品Schemaにそのまま複製しない。特に同じCard本文、同じ表示byte、同じGraphラベルだけで多重辺・Tree祖先・原Source・書戻し先を復元してはならない。

### 7.3 固有の独立Expected（IV-01〜08、全件NOT RUN）

| Case | 一因子差・操作 | Expected／棄却条件 |
| --- | --- | --- |
| IV-01 | Window AでCard X→Yを選択変更中、XのReader応答が遅着。Window BはXを保持 | AのYへX情報を混入しない。BのXまで一律に消さない |
| IV-02 | 同一ItemをCanvas A/Bで別Occurrence表示し、Aだけ移動・非表示 | B位置・本文・Tree・島・Edgeは不変。Aの表示削除をItem削除へ昇格しない |
| IV-03 | 同一bytes＋同じ相対pathでも許可Rootが異なる | 対象の黙った再束縛0。現在Host Scopeが不明ならReadのみ/unknown |
| IV-04 | 可視集合から非公開Card/Islandが除外され、その関係Edgeがある | Aの表示・エラー・検索候補・件数・診断経由の漏洩0。「存在しない」とも主張しない |
| IV-05 | 2 Card→1見出しへMarkdown化、または多重Graph→Tree表示後、見出し/表示Nodeを編集 | 一意な逆写像を推測した原データ自動Patch 0。差分・Loss・未解決を提示 |
| IV-06 | Sourceだけ改版／Canvas配置だけ変更／Rendererだけ改版 | 原文参照、位置依存の説明、再描画の失効範囲を別々に判断。旧Reviewを再受理しない |
| IV-07 | 部分取得のLEFT JOIN/NOT EXISTS/Top-Nが後続データで変わる | 旧NULL・未一致・順位を確定不存在として維持しない。差分証拠が無い場合は再取得 |
| IV-08 | 二ClientでCard保留が競合、AI候補は旧Canvas位置に依存 | 既存CASで旧提案の盲適用を拒否。相手の保留・異論・意味履歴を保持 |

IV-01/02/06/08は[Hybrid計画](hybrid_outline_canvas_layout_plan.md)のSI-XCと[#3399](https://github.com/hat47x/sui-sensemaking/issues/3399)を**参照・再利用**する。新たな同等Engineや重複Fixtureの作成指示ではない。IV-07は[情報統合 #3401](https://github.com/hat47x/sui-sensemaking/issues/3401)のII-04/08/12にTEIの非単調Query負例を結び付けるだけで、現SUIに新SQL実行器を要求しない。

## 8. 異製品HandoffとEvidenceの到達上限（IG5）

2026-11-11時点でSUI [merged PR #3433](https://github.com/hat47x/sui-sensemaking/pull/3433) はStructure Draft／Loss付きOutline CandidateのProducerと、SHO実Runnerによる限定往復を実証している。**これを未実装と表記しない**一方、Source実Read・正式Writer・別Host権限・実Agent Sessionの証明へ拡大しない。

| 層 | 現在言えること・必要な独立証拠 | 合格から推定してはいけないこと |
| --- | --- | --- |
| SUI Producer / Candidate | #3433の構造Draft/Outline候補、Loss・保留・未解決・非公開の扱い。固定入力での生成観測 | 全Sourceへの復帰、全構造の可逆化、正式Meaning受理 |
| Handoff 票とTransport | 既存の yi.handoff.context/v1 を使用。Producer生成・実file/byte・明示Scope・送信先別Readを区別 | Producer生成成功＝実Egress/外部Consumer成功 |
| SHO Consumer / Draft | [SHO #19](https://github.com/hat47x/sho-composer/issues/19)の実Reader→別Draft→筆者の差分採否→Writer保存後再読込で確認 | 実Readだけで保存・元SUIへの自動逆Patch・筆者採用を主張 |
| 外部Harness / Agent | [SHO #44](https://github.com/hat47x/sho-composer/issues/44)の観測上限を適用。CLI引数のharness名と実Process/Tool/Session、Aの悪性Scope拒否とBの拒否を分離 | ラベル一致を実DSH/ClaudeのAgent接続、全OS/Network Sinkでの非送信証拠へ昇格 |
| TEI / SEI / 実Effect | 型付き参照、意味/判断候補、正式Owner受理、Target実Provider/Receiptを**別Ownerの各段階**で観測 | SUIのCard/AI要約からAccepted Meaning・Grant・Commit確定へ自動昇格 |

この表は新Receipt ABIや第二Evidence台帳を作るものではない。いずれかの段階が未観測なら、その段階は NOT RUN / unknown / partial のまま報告し、他段階のPASSで補わない。IDや失敗理由を記録する場合も現在のDisclosureを再判定する。SUI→SHOの実受領が狭く成功していても、G5全体の正式な完了とは別である。

## 9. 認可・誤判定・品質の先行検査（新しいG0依存は作らない）

IG1（ローカルRaw＋AI OFF）の最小縦断を止めない。一方、IG2以降の外部Reader、Agent、共有、派生索引、外部Sourceを**有効化する当該経路**では、以下の既存Issueを回帰・未対応一覧へ結び付ける。

- [#3422](https://github.com/hat47x/sui-sensemaking/issues/3422)：外部PDPの readOnly 応答をWrite/Export/Share資格へ取り違えない。
- [#3423](https://github.com/hat47x/sui-sensemaking/issues/3423)：未知の認可Adapter名から暗黙の全許可/noopへ退避しない。
- [#3425](https://github.com/hat47x/sui-sensemaking/issues/3425)：export-auditのクライアント申告 SafeMode を、Server側で実証された書出し状態と呼ばない。
- [#3419](https://github.com/hat47x/sui-sensemaking/issues/3419)：一覧未列挙/取得不可/501件目以降/未存在を分ける。[merged PR #3426](https://github.com/hat47x/sui-sensemaking/pull/3426)でcursor複数ページの限定対応あり。ただしnull理由の判別や実バックエンド大規模試験は別。
- [ADR-0111](adr/ADR-0111-meaning-preserving-external-cognition-interface.md)：Source可視性、AI投影、派生Index、外部送信、操作権限の開示・Authority境界。Hidden Node/Edge・件数・診断・キャッシュの漏洩を一律に「UI上非表示」で防げたとは言わない。

実装者は各Source/Consumerごとに既存Testと未実行を列挙する。Access Provider未接続・宣言不明の場合は独断で公開/実行可と判定しない。既存Issueの現時点の状態を将来も固定と見なさず、採用前に実コードと最新の回帰結果を再確認する。


---

本書は既存Issueに散在する受入の**実施順索引**であり、既存ADR・Hybrid Draft・R2作業票の上書きではない。新たな権限、Schema、共通技術基盤、製品機能の正式採択を意味しない。