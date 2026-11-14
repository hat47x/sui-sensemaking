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

### 6.2.1 保存方式の技術的な優先候補と、採用前の拒否境界（2026-11-14）

**Owner判断へ渡す結論**：R2の「1件のSourceからCard作成→既存Document Save→別Process GET」を最小化するには、**A（Card直下の型付き・省略可能なSource選択記録）を優先試験候補**とする。BはCardとDocument別Mapの整合責任が増えるためAの旧Client互換や開示条件を満たせない場合の比較案。Cは一つの操作に二つのCommit/ACK/Recoveryを持ち込むため、既存Providerが整合と現在Grantを既に保証できる場合に限り検討し、R2では先行採用しない。**技術的優先順位でありOwnerの正式採用ではない**。

**現在の具体的な保存欠落**（現行mainを照合）：Python `CardBase`／`CardMeta`に出典byte spanの型がない。Pydantic既定の未知属性無視で未宣言の`sourceBinding`等は捨てられ得る。他方Frontend `validate_doc.ts`の厳密Importは未知Card/meta項目を拒否し、`validate.ts`の緩い`parseCards`は既知属性のみ再構成する。これは**保存成功らしく見えて出典情報だけを失う**非対称性であり、Current Source authorityの実装がなくても解消可能な不具合の入口である。

**採用前の最小対策（実装Draft #3444）**：[PR #3444](https://github.com/hat47x/sui-sensemaking/pull/3444)では、`PUT /docs/{id}`に未採用の**予約Source Binding候補欄**（Document `sourceBindings`/`sourceSelections`、Card/`Card.meta`の`sourceBinding`/`sourceBindings`/`sourceSelection`/`sourceSelections`）が含まれる場合、BackendのPydanticが情報を消す前に**HTTP 422・`source_binding_contract_unavailable`**を返す。エラーへRaw文字列、Locator、内部Card ID、byte span/件数を反射しない。既存`Card.meta.source`の自由記述は維持する。

Frontendの緩い`validateImportedDocument`も、予約Source選択欄があれば`ok:false`で**インポートを拒否**し、`parseCards`が既知の項目だけを組み直す段階での黙った情報欠落を防ぐ。既存の厳密`validate_doc.ts`が未知欄を拒否する契約は変更しない。**新規Schema/出典保存を採用したわけではなく、予約語に限定した防護**であり、一般の未知属性・すべての入出力経路を対象とするものではない。

**実証の上限**：ASGI＋SQLiteのHTTP回帰に、Card/Meta/Documentの予約欄、旧形式互換、既存Documentへ未採用情報を送って拒否された後の**元Card本文・`held`・異論・ETag不変**を追加。FrontendはDocument/Meta/Cardの未採用欄と旧自由記述の対照を追加。最新HEAD `e776c198130ac51f7827e4d6bd341281e4e1f712`の[Unit CI #43559145376](https://github.com/hat47x/sui-sensemaking/actions/runs/43559145376)で、**Backend契約322件PASS（本件8ケース）、Frontend `validate.test.ts` 22件PASS、型検査/build/代表E2Eジョブsuccess**を実ログで確認。正式A/B/C Source保存・現在Root/Scope/Grant・Owner承認・R2製品E2Eは**未実装／NOT RUN**。

**Aの正式化を検討する必須Gate**：
1. **Model/Frontend/Importの対称性**：独立した型付きCard欄を採用するなら、Pythonモデル・Frontend型・厳密Import・緩い再読込・複製/削除/Undo・安全な旧Client読込まで同一Attemptで検証する。既存`Card.meta.source`や`Card.sources`（Card合成由来）を出典byte選択として流用しない。
2. **Current Source資格と開示**：Document内に保存するものは選択時の**資格付きSource参照の候補**・Revision/digest・UTF-8 half-open byte範囲・選択byte digest・人間の選択という記録。Rootの実OSパス、Grant Token、Credential、Raw全文を含めない。**opaque参照やhashそのものも未許可閲覧者には開示の可能性がある**ため、Document共有やSafeMode/Agent Exportの実Projectionを検証し、現在Grantが不明なら保存・復帰を勝手に許可しない。
3. **CASとCurrent readの分離**：新規Documentはcreate条件、既存更新は**明示的な最新ETag/If-Match**をR2のUI経路で必須とする（現行Local APIのIf-Match省略LWWと混同しない）。Writer終了→別Process GET後、Hostが**その時点のRoot/Scope/Grant**を確かめた実Sourceから再読。Source revision/Root identity/HistoryとDocument ETag/digestを別列で比較し、A→B→Aおよび別Root同byteは`unknown/refused`とする。
4. **Card意味の非破棄**：Sourceから復帰不能でもCard本文・異論・Hold・人の意味判断を消さない。CardのDelete/Clone/Merge/分割でSource選択履歴の継承を暗黙に決めず、Ownerが明示的な規則を確定するまでは候補保持または操作保留とする。

**統合順**：#3444の予約項目拒否（前段安全対策）→R2 OwnerのA/B/C採用票とProvider/開示Gate→採用された方式のSchema＋実Readerの小PR→Document CAS Save/別Process readback→同じSourceへの復帰R2-SRC-01〜08。独立したDocument/Source台帳、TEI Host、汎用Source RegistryやCRDTを先に作らない。

### 6.2.2 送信前の境界と閲覧権限（A/B/C採否の独立条件）

**今回発見した不足**：Backendが未採用の出典選択項目をHTTP 422で拒否しても、`PUT /docs/{id}`を発行した時点で、非公開のSource Locatorなどが**通信のRequest Bodyへ送出されている**。画面側の型注釈と保存後の拒否だけでは、出典情報の外部開示境界を守れない。

**限定実装（Draft #3444拡張）**：Frontend `putDocument`へ、緩いImportと共通の`hasUnacceptedSourceBindingFields`を接続した。Card/Meta/Documentの**未採用の予約Source選択キー**が一つでもあれば、通信前に`ApiError(422, source_binding_contract_unavailable)`として中止。新`client.test.ts`の拒否負例で**呼出し前後にHTTP追加0件、秘密Locatorを例外に反射0件**を確認する。旧`meta.source`の自由記述は、従来のDocument PUTを維持する。これにより保存前／サーバ保存／Importの3入口で、**予約語だけ**が無断に保存成功・欠落・送出にならないよう合わせる。Blob Upload、別Agent/Exportの全経路に同一保証があるとは主張しない。

**Document閲覧とSource閲覧は別資格**：現行`GET /docs/{id}`はDocumentに対するreadを確認し、`agent_credential`では`_agent_document_view`による許可リスト投影を使用する。他方、それ以外の許可済みDocument Readerでは**Document payloadをそのまま返す経路**があり、Source単位の別Grantや出典Locatorの属性別Redactionは現時点で実装確認できない。採用前の単体負例として、仮のSource候補を含む入力を`_agent_document_view`へ渡し、Agent投影へRaw Locator/Metaが漏れないことを検査するが、**実Agent資格によるHTTP egressやGuest/Member間のSource権限差の実証ではない**。

**A案優先の停止条件**：Cardに保存する出典参照が、Documentを閲覧可能でも元Sourceを閲覧できないPrincipalに露出する場合、A案は**まだ採用不可**。opaque handleやSHA-256でもID・参照の存在・関係数が情報になり得る。権威あるServer投影で「Document read ≠ Source read」を実装し、Guest/Member/Agent/SafeModeでRaw/Locator/Handle/Hash/ID・件数/ETagを独立に検査するまでは、Aを最有力の**技術候補**から正式Schemaへ昇格させない。もしDocument内に一切のSource参照を安全に配置できないなら、既存Providerが別Root/Grantを保護できることを条件に**Cを再評価**する。BのDocument別Mapも閲覧時の漏洩問題を解消しないため、Aの単純な代替として選ばない。

**Evidenceの粒度**：予約項目が拒否されたこと（無送出・HTTP 422・Import拒否）／Documentが保存されたこと（ETag CAS）／実Sourceへ再到達できること（現在Root/Scope/Grant・Revision）／TEI/SHOなどの外部Consumerが今回実受領したこと／人間が意味を受理したことは、別々の結果欄に残す。内容ハッシュ一致で後の資格を代替しない。実装予定の`putDocument`事前拒否とAgent投影単体テストは[Draft #3444](https://github.com/hat47x/sui-sensemaking/pull/3444)の新HEAD `6f864be6361b0d3f8f3dc2cf343e8fe524c64023`の[CI #43571702321](https://github.com/hat47x/sui-sensemaking/actions/runs/43571702321)は**completed/success**。実ログでBackend契約**323件PASS**（Agent投影ヘルパーの新負例を含む）、Frontend全体**1,943件PASS**、`client.test.ts` **63件PASS**（送信前拒否の2件を含む）、`validate.test.ts` **22件PASS**、代表E2E・型検査/build・native Action/MCP/agent各Workflowもsuccess。ただし実HTTPのAgent/Guest別Source資格、Documentへ正式な型付きSource保存、別Processからの現在原文再Readは**未実装／NOT RUN**。

### 6.2.3 Document閲覧とSource閲覧の差分受入（R2・実装対象の固定）

**二つの権限を混同しない**：現行の`GET /docs/{id}`はDocumentのreadを判定するが、Source Reader／現在Root・Scope・Grantに関する判定器を持たない。Agent向けにDocument投影があっても、**Document readをSource readへ昇格できない**。このため「Documentを読めるがSourceを読めないPrincipal」の**製品E2Eは、現時点で実行不能・NOT RUN**。ダミーのGrantフラグや内容ハッシュ一致を正式なSource権威に見立てて合格させない。

| Documentの現在権限 | Sourceの現在資格 | 予定する受入観測 | 今回確認済みの証拠 |
|---|---|---|---|
| 許可 | 許可・同じRoot／Revisionも検査済み | Cardと出典位置を示せる。ただしHuman Meaning受理は別 | **Source Provider未実装：NOT RUN** |
| 許可 | 拒否／失効 | Card本文・Hold・異論は維持し、出典Locator／opaque ID／digest／存在数や原文位置を出さない。必要なら出典状態を「確認できない」とだけ示す | **Source Grant差分：NOT RUN** |
| 許可 | 不明／Provider障害／partial | Rootや内容一致を推測せず、原文再到達を保留。既存Cardは消さない | **Source Provider：NOT RUN** |
| 拒否 | 許可 | Source資格からDocumentの存在・Card内容を逆算しない | Documentの認可試験は既存、**組合せ試験未実施** |
| AgentのDocument閲覧が許可 | Sourceは拒否／不明 | 人間がレビュー済みの本文だけをAgent投影し、出典欄・未レビューID・ETagを出さない | Agent allowlist単体検査のみ。**Agent HTTP×Source権限：NOT RUN** |
| Documentが許可 | 同じ内容・別Root／A→B→A | 内容一致だけで現在Grantや同一出典・履歴連続性と判定しない | **内容CheckpointのReferenceのみPASS** |

**実Document GETの二段階拒否（#3444・Revision検査を優先）**：現行`GET /docs/{id}`は、まず`DatabaseDocumentContentStore.load`で保存済みDocument投影とRevision Headの内容一致を検証し、その後にDocumentV1/予約Source項目を検証して、正常な応答を返せる場合だけ`view`監査を記録する。従って、**DB行`payload_json`だけに未採用Source欄を手動混入させると、Revisionとの不整合が先に検出され、HTTP 503となる**。この503を「Source契約422の失敗」や「Source閲覧権限拒否」と読み替えない。

2026-11-14に[Draft #3444](https://github.com/hat47x/sui-sensemaking/pull/3444)のHEAD `88dd09f5b24817cec3f1f574e94a74ddc5d5142b`で[単体CI #43572911307](https://github.com/hat47x/sui-sensemaking/actions/runs/43572911307)が失敗した原因は、**Raw DB行だけを改変したテストが422を期待したこと**。これは既存Content-addressed Revisionの検査が働いた事実であり、保全機能を外してテストを通してはならない。

**修正した独立Expected**：①内部StoreによってDocument投影とRevision Head/Blobを**整合させた上で**予約Source欄を持つ保存済みDocumentを合成し、HTTP GETが**秘密Locator非反射の422**・`view`監査0件となること、②正常なRevision-backed DocumentのDB投影**だけ**を改変した場合は、**Revision不整合による503**・秘密非反射・`view`監査0件となること、③整合性とSchemaの両方が正常なGETのみ200・`view`監査1件となることを別々に検証する。修正HEAD `a572dd89885a138ebc308fa7bc299715b554ea87`の[CI #43579792062](https://github.com/hat47x/sui-sensemaking/actions/runs/43579792062)は**completed/success**。Backend契約テスト**325件PASS**（本件でのGET二負例を含む）、Ruff PASS、Frontend単体・代表E2Eジョブもsuccess。同じHEADのNative Action・MCP/Agent関連Workflowもsuccess。**正常に動くRevision検査を残したまま、異なる失敗原因を別々に受け入れた**ことを証拠として記録する。

この検査の受入上限は**Document保存Revision・契約・監査の整合**であって、Source Providerの現在Root/Scope/Grant、元Rawの閲覧拒否、Card保存後の別Process原文復帰を実証したものではない。Document ETag、Content Digest、元Source Revision、Host Grant、Meaning Acceptance、Consumer受領を一つの`verified`や単一Receiptにまとめない。

**既存TEI Referenceの再利用範囲**：SUI側にはすでに`tei_sui_reference.py`の**読み取り専用Artifact投影**があり、`source.status`の`active/revoked/expired/unknown`を区別し、revoked/expiredを内容非返却にし、private/restrictedエンティティのID・数を出さず、unknownをactiveと見なさない。これは**Artifactが宣言する状態と参照投影**の実装であり、現在のHostから任意のRaw資料を取得するSource Reader／Root・Scope・Grant認可ではない。非開示・失効・部分性の**負例設計の参考**には使うが、これをそのままR2のSource権威や新しい共通Storeへ流用しない。TEI Referenceの`ACCEPTED_MEANING=False`と同様に、資料の可読性をOwner意味受理に昇格させない。

**正式受入の最小接続**：Sourceの権威は既存Host/Provider側に置き、Doc readの確認とは独立に`SourceRef + Workspace/Root + 現在Grant + Revision/epoch + 選択byte span`を照合する。Cardへ永続保存する属性集合はA/B/C Owner選定と閲覧Projectionが成立してから確定する。未許可のPrincipalがハッシュ・参照個数・存在の推定をできないこと、権限失効後に既存Cardが残ること、Doc ETag/If-Match競合で他者変更を失わないことを**独立Readと実HTTP**で確認する。EvidenceはSource取得、Document CAS、Consumer受領、人間の意味受理を別票とし、F0〜F5をすべての読取用途に一律の直列Gateとして要求しない。

### 6.2.4 R2を正式なSource復帰へ進めるためのOwner判断票（実装着手条件）

**現時点の判断**：一時ファイルの読込・元バイト位置の復元・選択変更への追従は、[実装Draft #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)で限定的に実証した。しかし、ブラウザで利用者が選んだ`File`は**別プロセスから再び開けるSource参照ではない**。また、[R1 #3440](https://github.com/hat47x/sui-sensemaking/pull/3440)の許可rootを模したCLIは実ProductのRoot/Scope/Grantを管理せず、既存`ContentObjectReference`はDocumentコンテンツの管理参照であって任意のRawファイルの閲覧資格を与えない。したがって、Source保存用のJSON欄を先に決めるだけではR2の縦断が成立しない。

**Ownerが最初に決めることは「保存先」より「どの実Sourceを、誰の権限で再読するか」**である。最初の1件の公開合成Rawについて、以下を一つの受入票に記録し、それぞれ未定なら未定のまま残す。

| 決定項目 | 実装前に必要な回答 | 回答がない場合 |
| --- | --- | --- |
| **Sourceを保持・再解決する既存Host/Provider** | SUIのWebサーバが既存の許可Rootから読み直すのか、Desktopの既存Hostが再読するのか。どの実APIとPrincipalで可能か | ブラウザの一時Fileに限り、永続Source Bindingは作らない |
| **Qualified identityと版** | Root/Workspace、Source occurrence、revision・観測時刻・変更履歴の取得可否。同byte別RootとA→B→Aをどう判別するか | Digestと相対pathを資格とせず、現在の同一性は`unknown` |
| **DocumentとSourceの開示範囲** | 同じDocumentを読めてもSourceは読めないGuest/Member/Agentへの投影。Locator・opaque handle・hash・参照数・選択位置の扱い | A/Bを正式採用せず、既存Providerの権限分離がある場合のみCを再評価 |
| **保存と失敗後の扱い** | 採用するA/B/C、既存Document ETag/If-Match、保存ACK不明、Card削除・複製・Hold/異論との整合 | 現行[Draft #3444](https://github.com/hat47x/sui-sensemaking/pull/3444)の予約欄拒否を維持し、保存成功を装わない |

**方式の比較は次の順で絞る**。第一候補AはCardに選択履歴を結び付け、既存Document CASで一緒に保存できる利点がある。ただし、現在Sourceを読む権限のないDocument読者へ参照情報を開示するなら**不採用**。BはCard IDとの孤児・複製の整合を追加で証明しなければならず、Document内の別Mapへ移すだけでは開示問題を解決しない。Cは、すでに権限分離と永続参照を持つ**実在のProvider**が見つかった場合に限り、二つの書込・部分成功・Receipt/Recoveryを比較する。今回の技術的な優先順位を、Ownerによる意味受理やSchema採用の代行にしない。

**採用後、最初に実装・実測する縦断**：[R2-SRC-01〜08 #3441](https://github.com/hat47x/sui-sensemaking/issues/3441)の既存Expectedに沿って、(1)現在許可された実RawをProduct Readerから表示、(2)人が二番目の同文を選択、(3)Card本文と出典候補を分けて明示If-Matchで保存、(4)Writer終了後に**別プロセス**からDocument GET、(5)現在のSource権限とRevisionを改めて確認して元バイトへ戻る。この往復と並行し、Doc許可×Source拒否、同byte別Root、Source改版・欠落、409/ACK不明、Agent非開示を個別に反証する。**Card本文・Hold・異論を出典失効とともに消さない**。Productにまだ接続していないReference、擬似Grant、HTTPを通らない単体Projection、合成DOMだけのPASSから縦断成功を推論しない。

**Providerから受け取った情報の完全性を、現在の権限とは別に判定する**。TEI Studioの実Read/Context設計で整理している「取得範囲が足りているか」と「それを現在使ってよいか」の区別を、R2のSource復帰にも取り込む。ただし、新しい共通Result型を採用するのではなく、最初の縦断試験で実Providerの返却内容から確認できる事実を記録する。

| 確認する性質 | 合格の根拠 | 不明・不足の場合 |
| --- | --- | --- |
| **Readの実行と対象** | 呼出したHost/Provider、実際に解決されたRoot/Source、呼出Principal・Scopeが追跡できる | 同名・同内容・保存済みLocatorへの推測接続をせず、Source復帰を保留 |
| **読めた範囲の完全性** | 元Raw全体のbyte長と取得byteの完全性を実Readerが証明でき、選択`[start,end)`が範囲内にある | `partial/unavailable/unknown`を「全文一致」「0件」「許可済み」にしない。選択箇所だけ読めても、全RawのSHA一致は主張しない |
| **版と現在性** | 読取時のRevisionまたはHostが保証するSource世代、選択時点との差分、改版履歴の確認可能性 | A→B→AでHashが再一致しても継続した同一性としない。必要な履歴証拠がなければ`unknown` |
| **閲覧・開示資格** | Docのreadとは独立した現在のSource Grantと、Principalごとの出力Projectionの検査 | 取得できたbyteをCard閲覧者やAgentへ自動送出しない。非許可の存在数・Locator・Hashも伏せる |
| **保存後の継続性** | 既存Document CASの書込Result、別ProcessのGET、再Read結果を別のAttempt/Receiptとして照合 | 保存ACK不明を成功にしない。Card本文・Hold・異論は維持し、Source復帰のみ未解決にする |

**試験の組み立て**：まず単一Root・1MiB以下の公開合成Rawで`complete`を確認し、次に同じReader入口で`partial`・`unavailable`・`permission-denied`・`not-found`・`stale`を独立に起こせるか調べる。表現できない状態は擬似ステータスを作って成功とせず、Provider能力不足としてOwnerへ返す。特に`ContentObjectReference.state=READY`は**Documentコンテンツの保管状態**であり、任意のRawへの現在Grantや全文取得の完了を意味しない。SHOのProvenance、TEIのモデルRevision、TAIのActivity/Consumer受領もそれぞれ別の結果として照合する。**情報が揃ったか・実読取したか・現在閲覧可能か・保存されたか・意味を受理したか**を一つの`verified`にまとめない。

**成果物と着手順**：まずOwner判断票にHost/Providerの**実在する読み取り入口**と開示責任を記録し、その次にA/B/Cを一つ選び、必要な最小Schema・Reader・権限Projection・保存経路を別々にレビューする。全テストの成功と実際の元資料への復帰が揃うまで、`R2 Product accepted`とは記録しない。SHO Writer、TEI意味受理、外部Harnessや中央Registryは、この縦断の必須依存にしない。

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


### 6.4 ブラウザで選んだ文字列を、元のRawバイト位置へ結び付ける（F1/F4）

**目的**：利用者が原文から選んだ箇所を、表示上の文字位置ではなく、保存された元Rawの**UTF-8バイト範囲 `[start,end)`**として正確に特定する。画面のコピー文字列や部分文字列検索から位置を逆算しない。表示上の位置を特定できたことと、Sourceの現在の閲覧資格、Cardへの保存、後日の再到達は別々に検証する。[R2実装担当 #3441](https://github.com/hat47x/sui-sensemaking/issues/3441)が受入の正本。

**対応付けの条件**：元Rawから、各文字のUTF-16境界とUTF-8バイト境界の対応を保ったText Runを表示する。DOMのSelection/Rangeが、そのText Runのどこを選んだかを特定してからバイト位置を求める。BOM、CRLF/LF/CR、絵文字、同じ文字列の繰り返しを考慮し、表示用の折返しや装飾ノードを原文の一部と混同しない。選択が複数Runにまたがる場合、DOMが原文を正規化した場合、サロゲートペアの内部を選択境界にした場合は、位置を推定せず拒否する。参考： [DOM Range](https://developer.mozilla.org/en-US/docs/Web/API/AbstractRange/startOffset)／[TextEncoder](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder/encodeInto)／[TextDecoder](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder)。

**独立した期待値（R2-SRC-01/02/05を再利用）**：原文は `BOM(ef bb bf) + UTF-8("前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊")` の**57バイト**。同じ「同じ言葉。🌊」でも、前半はUTF-16位置`[4,11)`・元Rawバイト`[11,30)`、後半はUTF-16位置`[15,22)`・元Rawバイト`[38,57)`。BOMは画面に表示しないが、元Rawの先頭3バイトとして残す。位置が分からないとき、ファイルが空のとき、元Sourceが欠落・改版・権限失効したときの結果を、いずれも「正常な0件」にまとめない。

**2026-11-14時点の実装と実証**：[Draft #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)では、元RawバイトとDOMの単一Text node選択との対応を実装し、選択時Raw全体・選択範囲のSHA-256を、同一Snapshotから計算する。非同期計算中に入力バイト列や選択記述子が変更されても、異なる時点の値を混ぜない。チェックポイントの比較結果は`content-match-only`または`stale-content`に限り、内容一致をSourceの同一性・現在Grant・A→B→Aの履歴連続性へ昇格させない。

そのうえで、既存SUIのStartPanelに**「原文の一時確認（保存しません）」**を追加した。利用者が選んだ1 MiB以下のUTF-8ファイルを実File APIで読み、元BOM/改行を保持したまま表示して、選択した範囲のバイト位置を確認できる。空ファイル・容量超過・不正UTF-8を拒否し、パネルを閉じるとReact上の一時状態を破棄する。文書の通常読込とは別の機能であり、CardやDocumentにSource Bindingを保存したり、AIや外部Providerへ送ったりはしない。**原ファイルの削除、ブラウザメモリの完全消去、すべての通信経路での送出禁止まで保証したものではない**。

最新コードHEAD `3b27d865ace0d6b73c6a7d51f0fd142776a883a0`の[CI #43583154802](https://github.com/hat47x/sui-sensemaking/actions/runs/43583154802)は**completed/success**。実StartPanelを操作するChromium代表E2Eは**13件PASS**、Frontend単体は**1,954件PASS**（4件skip）、型検査・ビルド・Backend契約ジョブも成功。合成FileをPlaywrightで入力した試験であり、人間によるOSファイルダイアログ操作や、実Hostの永続的Source Reader接続は含まない。選択後の位置の鮮度とPinの区別は次の§6.4.1で扱う。

**製品として次に必要なこと**：現在許可されたSourceから実Readerが取得したバイト列を、そのSourceのRevision・Root/Scope/Grantとともに表示へ接続する。Ownerが§6.2のA/B/Cから正式な保存方式を選んだ後、Cardに出典候補を保存し、Documentの条件付きSave、Writer終了、別プロセスのGET、現在のSource権限による再読取を一続きで検証する。戻れない場合もCard本文・保留・異論は保持する。**PDF座標、音声Selector、複数形式のReader、共通Source RegistryはIG1の前提へ加えない**。

**受入の上限**：ここまでの合格は**一時Rawプレビューと原文byte位置対応の限定Reference**であり、正式なR2-SRC-01〜08全件、Product Reader/Source認可、Document保存→別プロセス復帰、外部Consumer受領、Ownerによる意味受理は**NOT RUN**。

### 6.4.1 一時選択の鮮度と、将来のPin意図を分ける（2026-11-14）

TEI Studioの[Subject Pin検討 #4515](https://github.com/hat47x/tei-platform/issues/4515)では、**一時的なFocus/Selectionと、利用者が明示的に固定したPinの意図を分ける**。これをSUIのIG1へそのまま「Pin実装」として移植しない。現行SUIの一時Rawプレビューは、明示選択したFileの**その時点のDOM選択をbyte位置へ対応付けるだけ**であり、Cardへの出典保存、持続的Pin、現在のSource Grantを持たない。

**直ちに必要なUIの不変条件**：一時プレビューが確認済み`[start,end)`を表示している間に、利用者が同じ原文の別Occurrenceを選択したり、別ファイルを指定したり、プレビューを閉じたりすれば、**古い位置を現在の選択結果として残さない**。非同期ハッシュ処理が終わるまでにSelectionが変わった場合も、開始時のHashを別の現在選択へ転用しない。表示原文・元byte Snapshot・選択位置の整合性が確認できたときにだけ現在の位置を示す。ファイル名一致・同文字列・同SHA・DOM Node/描画LabelはSource資格やPinの継続性の証明にならない。

**今回の限定実装とテスト**：[実装Draft #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)の`LocalRawPreviewPanel`に、Selection変更の監視と非同期SHA完了後の**現在DOM Range再照合**を追加。実StartPanelのChromium回帰に、後方同文を選択して`[38,57)`→前方同文へ選び直すと表示を消す→再確認すると`[11,30)`→同名で異内容の別ファイルへ差し替えると範囲を消す→閉じると状態が無い、という独立Expectedを追加。文書保存、外部送信、Persisted Source Pinは行わない。HEAD `3b27d865ace0d6b73c6a7d51f0fd142776a883a0`の[単体CI #43583154802](https://github.com/hat47x/sui-sensemaking/actions/runs/43583154802)は**completed/success**。実`frontend-e2e`ログにStartPanelの同文再選択・同名別ファイル交換を含む13件PASS、`frontend-unit`は**1,954件PASS（4件skip）**。Backend契約ジョブもsuccess。**限定UIの表示状態・内容検査の成功**であり、正式Source Grantや別Process復帰の証拠ではない。

**非同期File読込の競合と破棄（F1.5の独立負例）**：利用者が同じファイル名で異なる原文A→Bを続けて選び、Aの`File.arrayBuffer()`が後から完了しても、既に表示したBをAで上書きしない。さらに、原文Cの読込中に利用者が「一時データを破棄」を選んだ場合、Cの遅延結果で本文・選択位置を復活させない。現実装の`requestId`に基づく世代照合を流用し、新しいSource Registry/Session/Grantを実装しない。[Draft #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)の実StartPanel Chromium試験では、ブラウザ`File.arrayBuffer`の完了順を明示制御し、**A遅着→B維持、およびC読込中の破棄→C遅着後も空表示**を独立に確認する。確認可能な範囲は当該画面の局所状態であって、OS Rootの資格、ブラウザメモリーの完全消去、別プロセスでのSource再取得、AI/外部Consumer送出の認可ではない。最新コードHEAD `ee6afd7e744099326f7dde10a191a7bc4977e781`の[単体CI #43584490767](https://github.com/hat47x/sui-sensemaking/actions/runs/43584490767)は**completed/success**。実Chrome/Playwrightのログで、A遅着→B維持とC破棄後の非復活を試す新規ケースを含む**代表E2E 14件PASS**、Frontend単体は**1,954件PASS（4件skip）**、Backend契約ジョブもsuccess。**局所UIの読込世代の検証に限定**し、現在Root/Grantや別Process復帰の受入には転用しない。

**別の作業面の選択を巻き込まない（IG1局所・IG4にも有効）**：ブラウザの`window.getSelection()`は画面全体で共有される。したがって、原文プレビューの「一時データを破棄」が`removeAllRanges()`を無条件に実行すると、別Card/Editor/Canvasの選択まで消してしまう。破棄時にDOM Rangeが当該プレビューの単一Text nodeを指している場合に**限って**選択解除し、別作業面にある選択は維持する。これは「一時選択の破棄」と「他のViewが所有する選択の変更」を分ける最小の非干渉条件で、TEI Studio [Subject Pin #4515](https://github.com/hat47x/tei-platform/issues/4515)の独立選択と矛盾しない。新しいグローバルSelection StoreやPinの正式仕様は不要。[Draft #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)の実Browser負例では、プレビュー外のText nodeに選択を置いた後でプレビューを破棄しても外側のSelectionが残ること、プレビュー自身が選択中ならその選択だけを解除することを対照にする。最新HEAD `6146cb1dcfb6dcc0711212383f07d18381a7ed9c`の[CI #43584875014](https://github.com/hat47x/sui-sensemaking/actions/runs/43584875014)は**completed/success**。実StartPanelの`frontend-e2e`ログで、非同期読込の遅着試験と、**他作業面のSelectionを破棄しない試験を含む代表15件PASS**を確認。Frontend単体・Backend契約ジョブもsuccess。これを**一時プレビューとブラウザ選択の局所非干渉**の証拠として記録する。この時点では合成DOMでの局所非干渉であり、実Card編集や複数Window/Canvasの製品E2Eは未実施であった。

**実CanvasのCard選択を保つ限定検証**：SUIの通常Canvas Cardは`CardView`で`userSelect: none`とし、**文字のDOM Rangeではなく`aria-pressed`を使うCard選択状態**を提供している。一時プレビューとは所有者の異なる選択であり、破棄してもそのCard選択・本文・枚数を変えてはならない。[実装Draft #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)では、初回表示の**本物の3枚のCanvas Card**から1枚を選択した後、StartPanelの一時Rawプレビューを開いて破棄し、Cardの`aria-pressed`・3枚の本文・枚数を前後比較するChromium試験を追加した。初回HEAD `9a89dd4b`の[CI #43587483171](https://github.com/hat47x/sui-sensemaking/actions/runs/43587483171)は、Canvas Cardの先頭DOM文字列を直接選ぼうとしたFixtureが`user-select:none`に反していたためE2E失敗。**SUIの実選択方式を使う試験に修正**し、HEAD `4fea9cfd999b723c9f57469441bf8b72a4a30b8c`の[CI #43587789865](https://github.com/hat47x/sui-sensemaking/actions/runs/43587789865)では**代表Chromium 17件PASS**、Frontend単体**1,954件PASS（4件skip）**、Backend契約ジョブsuccess。ここから言えるのは**現在のCard選択と本文への非干渉**までであり、Cardの編集途中のDirty Buffer・Undo・共同編集による競合や別WindowのFocus維持は未実施である。


**選択中の変更を確認操作へ持ち越さない（非同期Checkpointの負例）**：利用者が元Rawの同一バイト位置Aを選んでハッシュ計算を始め、その完了前に別の範囲Bへ移り、もう一度Aを選んだとする。計算完了時の両端offsetだけを見ると「Aと同じ」に見えるが、その確認操作の途中で選択意図は変わっている。そこで[Draft #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)では、当該計算中に**DOMの`selectionchange`として観測できた異なる範囲**を不可逆な局所無効化として記録し、最後にoffsetがAへ戻っていても旧確認を採用しない。利用者が改めて確認する操作は可能にする。WebCryptoの完了順を制御した実Chromium試験で、A→B→Aの旧確認拒否と再確認の対照を追加した。初回HEAD `eeb25426`の[CI #43586459921](https://github.com/hat47x/sui-sensemaking/actions/runs/43586459921)は**試験FixtureのBOM欠落によりE2E失敗**（実装が返した`[35,54)`はBOMなしRawの正しい位置）。BOM付き原文で期待する`[38,57)`とFixtureを揃えた修正HEAD `5517d22da0f377f22cf8456ef76aef3bef437644`の[CI #43586649025](https://github.com/hat47x/sui-sensemaking/actions/runs/43586649025)は**completed/success**。実Chromiumの選択A→B→A負例を含む**代表16件PASS**、Frontend単体**1,954件PASS（4件skip）**、Backend契約ジョブもsuccess。**DOMイベントとして観測できない瞬間的変更や、Source自体の改版A→B→Aまで検出したとは扱わない**。後者は実HostのSource revision・履歴・現在Grantによる独立検査を要する。

**将来の明示Pinが必要になった場合**：Pinned Intent（何を見直したいか）と、現在解決できるSource（Host/Root/Scope/Grant/Revision）を別に保持する。別Workspace、Source A→B→A、同offset別Occurrence、後着旧応答では元意図を別Sourceへ黙って付け替えず、現在の資格を`unknown/unresolved`とする。Pinned IntentをUndoで戻してもSource Grantは戻らない。Pinは[TEI #4515](https://github.com/hat47x/tei-platform/issues/4515)の判断を待ち、R2縦断の必須API／新Registryにはしない。

**横断Handoffの上限**：[TAI #271](https://github.com/hat47x/tai-pleroma/issues/271)に合わせ、Product Selection、Activity、Harness Session、実Document/Source Read、書込Operation Attempt、Consumer Receiptを別の資格として扱う。SUIの現在選択はSHO/TEI/AIが再解決すべき**候補**であり、Session継続・Selectionの再表示・同Digestによって別Productが実Read済み、Current Grantが有効、意味受理済みとはしない。[SHO #19](https://github.com/hat47x/sho-composer/issues/19)のWriter/Raw DraftとTEI Meaning Acceptanceは後段IG5の独立受入とし、IG1に新しい必須依存を加えない。

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

**同一AttemptによるConsumer対照（IG5後段）**：TEI [#2586](https://github.com/hat47x/tei-platform/issues/2586)／[計画PR #4619](https://github.com/hat47x/tei-platform/pull/4619)のD1に合わせ、同じSUI出典選択と同じ実Source/Document revisionから生成した**一つの候補Artifact**を、SHO Readerと別の許可されたConsumerへ渡す場合は、Producer実HEAD・選択Source版・候補Raw digest・試行ID・各実Consumer版・実ReadされたScope・Loss・拒否/部分成功を**Consumer別**に観測する。別々の合成Fixtureで得たdigest一致だけを「同一試行で二Consumerが受領」とは呼ばない。片側が未実行なら片側だけNOT RUN。TEIやSHOのConsumer/Writer実行、現在Host Grant、意味受理はそれぞれのOwnerへ戻す。IG1のR2完成を、この二Consumer試験でブロックしない。

### 8.1 外部Skill/Harnessの三つの独立閉包（IG5の後段・任意）

YIC/TAIの[Skill適合 #488](https://github.com/hat47x/tai-pleroma/issues/488)と[Activity選択的再資格 #271](https://github.com/hat47x/tai-pleroma/issues/271)の成熟した境界を、SUI [外部Skill #3368](https://github.com/hat47x/sui-sensemaking/issues/3368)の**開示・受領判定**に限定して参照する。SUI内の独自Agent Loop、常時TAI Skill Load、第二のResolver/Hostは作らない。Product API単独／Tool-only／Product Skill／任意TAI Skillは別の選択肢として評価する。

| 閉包（評価上の区別） | 具体的に再照合する入力 | その閉包だけでは成立しないこと |
| --- | --- | --- |
| **Instruction** | Product Skillの実ファイルとdigest・版・実Harness Loader/Tool Profile・読み込んだ指示範囲 | Skillファイルの存在＝実Load/遵守、ツール名の表示＝実Invoke |
| **Subject / Information** | 現在Card/Source/SelectionのIdentityとrevision、許可されたProjection、取得範囲・Loss・現在Disclosure | 同じContext hash＝原文の現在性、未公開ID/件数の送信資格、部分投影＝全Source |
| **Capability / Authority** | Host/Providerの現在Actor/Scope/Grant、read-onlyとWrite/Export/Effectの区別、実操作TargetとReceipt | SkillやHandoffの宣言＝権限、Runnerの成功＝全Network/OS Sinkの非送信、ACK＝Effect確定 |

**失効は閉包ごと**に評価する。Source改版ならInstruction自体の版は失効しないがそのSourceを含むProjectionは再照合する。Skill改版なら保存済みCardが自動的にstaleになるわけではない。Grant失効ならSkill/Source Digestが同じでも新しい外部送信を止める。同一Harness Session IDやActivity継続は現在Grant・対象同一性を保証しない。過去に公開した情報を「Grant撤回で回収した」と主張しない。

**後段の最小独立反証**：H1＝Skillの実Loadなしで回答やReceiptだけが正常、H2＝別Rootの同文Cardを同一Sourceとして再使用、H3＝現Grantが失効したのに旧HandoffからRawを再送、H4＝A側CLIの悪性Scope拒否をB側実Harnessの拒否へ転記、H5＝Tool Replyは返るがSHO実Read・Writer Saveは未観測。別試験Suiteを新設せず、TAI #168/#488/#271・[SHO #44](https://github.com/hat47x/sho-composer/issues/44)・SUI #3368の既存Expected/Trialを参照する。最初のIG1/R2はAIなし・Harnessなしでも合格可能に保つ。

## 9. 認可・誤判定・品質の先行検査（新しいG0依存は作らない）

IG1（ローカルRaw＋AI OFF）の最小縦断を止めない。一方、IG2以降の外部Reader、Agent、共有、派生索引、外部Sourceを**有効化する当該経路**では、以下の既存Issueを回帰・未対応一覧へ結び付ける。

- [#3422](https://github.com/hat47x/sui-sensemaking/issues/3422)：外部PDPの readOnly 応答をWrite/Export/Share資格へ取り違えない。
- [#3423](https://github.com/hat47x/sui-sensemaking/issues/3423)：未知の認可Adapter名から暗黙の全許可/noopへ退避しない。
- [#3425](https://github.com/hat47x/sui-sensemaking/issues/3425)：export-auditのクライアント申告 SafeMode を、Server側で実証された書出し状態と呼ばない。
- [#3419](https://github.com/hat47x/sui-sensemaking/issues/3419)：一覧未列挙/取得不可/501件目以降/未存在を分ける。[merged PR #3426](https://github.com/hat47x/sui-sensemaking/pull/3426)でcursor複数ページの限定対応あり。ただしnull理由の判別や実バックエンド大規模試験は別。
- [ADR-0111](adr/ADR-0111-meaning-preserving-external-cognition-interface.md)：Source可視性、AI投影、派生Index、外部送信、操作権限の開示・Authority境界。Hidden Node/Edge・件数・診断・キャッシュの漏洩を一律に「UI上非表示」で防げたとは言わない。

実装者は各Source/Consumerごとに既存Testと未実行を列挙する。Access Provider未接続・宣言不明の場合は独断で公開/実行可と判定しない。既存Issueの現時点の状態を将来も固定と見なさず、採用前に実コードと最新の回帰結果を再確認する。



## 10. 作業面を跨ぐSource選択・共同編集・Draftの保存（IG4〜IG5後段／未採用）

TEI Studioの[Web/Desktop共通部品方針 #1824](https://github.com/hat47x/tei-platform/issues/1824)と、Desktop＝独立Workspace/Git共有・Web＝共有サーバ編集という別チャットの構想を、SUIの**参照資格と編集競合の圧力ケース**として利用する。ただし、SUIは現行のWebサーバ権威Document製品であり、TEI側のGit/Branch運用へSUIの正本を移さない。

**既採用との整合**：[ADR-0076](adr/ADR-0076-collaboration-concurrency-model.md)はサーバ権威・既存ETag/CAS・保存時同期から開始し、保留・少数意見を失うプロパティ単位Mergeを無条件採用しない。[共同Undo #3399](https://github.com/hat47x/sui-sensemaking/issues/3399)のCU-01〜10がSUIの競合検証Owner。TEIで将来テキストCRDT/Yjs等を検討しても、SUIのCard/Island/Reviewの意味的合流へ自動適用しない。

| 作業面・Consumer | 実Source・変更のOwner | 受取時に確認すること |
| --- | --- | --- |
| **SUI Web Document** | SUI DocumentV1・サーバ保存ETag、Actor/tenant | 版・現在Scope・可視CardとSource。明示If-Matchで古い更新409。単一tenant LWW既定でもR2の保存試験はCASを使う |
| **Local Workspace（将来のDesktop/TEI連携候補）** | そのHostの許可Rootと実Source bytes。Gitを使うなら独立したSource版の証拠 | 相対path・同SHA・同ManifestをグローバルRoot ID/Grantとみなさない。別Rootへ移設時は候補参照として再束縛要否を提示 |
| **TEI Studio Web共有サーバ候補** | TEI Workspace/Branch/ChangeSet/Model revisionと編集AuthorityはTEI Owner | Git mergeやTEI Model revisionとSUI Document ETagを同一視しない。TEI側で採用した編集がSUIのCardの意味受理にはならない |
| **SHO/SEI/外部Harness** | 受取先のDraft/判断/Session、実Consumer/Writerの観測 | Loss、出典の現在Scope/Disclosure、Consumer版、未解決。Activity/Session継続は実Writer commitや現在Grantの証明ではない |

**可搬なものと可搬でないもの**：過去の人手選択・Cardの解釈・Hold/異論・許可された論理Source参照・byte位置は次の作業面へ「候補」として渡し得る。しかし現在OS Root、Access Token、Provider Credential、過去Grant、非公開Node/EdgeのIDや件数は自動継承しない。別Hostが現在Sourceを再解決できなければ、元Cardと判断履歴は残して原文復帰だけunknown/unresolvedとする。同byte/相対pathのSourceへ無言で繋ぎ替えない。

**三つの版を分離**：SUI Document ETag、原Source revision/digest、必要に応じ外部Git/Workspace/TEI Model revisionを別の証拠として参照する。これらを共通の「最新版」や同一revision番号へ畳まない。特に[API仕様](../02_Architecture/api.md) §1.2〜1.3のupdatedAtはクライアント提供文字列で、CAS版の証明ではない。

### 後段で反証する代表条件（新たなExpected正本は作らない）

| 例 | 検証Ownerと棄却条件 |
| --- | --- |
| 同内容・同相対pathのLocal Root A→BへSource選択を移動 | R2-SRC-03/04：現在Root/Grantを再確認。Digest一致で自動再束縛しない |
| 二つのWeb Clientが同一ETagを起点に、一方は配置、他方はHoldを保存 | #3399 CU-01〜03/09：旧版409、dirty buffer・保留を維持、無条件自動Mergeなし |
| Git mergeで元資料が同じbytesへ戻る | R2-SRC-04／IV-06：過去の出典資格・Current Grant・A→B→Aの履歴を自動復権させない |
| TEI/Webのテキスト編集が収束したあとSUIへ意味Patchを適用 | IV-02/08／CU-05〜08：readSet/writeSet・現在の意味判断・Holdを別検査。CRDT収束≠意味受理 |
| SUI→SHO Handoff後にSource Disclosureが失効 | [#3391](https://github.com/hat47x/sui-sensemaking/issues/3391)・SHO #19・[TAI #271](https://github.com/hat47x/tai-pleroma/issues/271)：次のRead/送出を再資格化し、過去に送出した内容を回収したと推定しない |

**実装順**：(1) IG1/R2の単一許可Rootを完成、(2) IG4で現行Document CAS/Undoの二Client保存試験、(3) IG5で許可済みSource参照のConsumer移動とLoss/Grantの再照合、(4) WebSocket・Presence・Yjs/CRDT・Git双方向同期・中央Workspace Registryは実利用価値/安全性が確認された場合にのみ別Ownerで比較。TEI Studio Web/SUI Desktopの完成をIG1の新Hard Gateにしない。

本節は**受入の非干渉条件**であり、新Runtime・新Schema・リアルタイム共同編集・実Desktop/外部Consumerを実装したものではない。これら後段の新試験はすべてNOT RUN。

## 11. IG4の鳥瞰・選択・再開を一つの操作契約にする（2026-11-14／後段の設計候補・NOT RUN）

SUIの巨大CanvasやMind Map/Tree/KJ/Graphの切替では、描画の速さだけでなく、**同じ情報へ戻れること、見えていないものを不存在と誤認しないこと、利用者の編集中の判断を失わないこと**を受入対象にする。これは[Hybrid計画 §17](hybrid_outline_canvas_layout_plan.md)のItem/Canvas/Display Occurrence分離、[同計画のDraft #3437](https://github.com/hat47x/sui-sensemaking/pull/3437)の選択・投影候補、本計画§7・§10、[共同Undo #3399](https://github.com/hat47x/sui-sensemaking/issues/3399)を**実際の操作として検証する入口**であり、新しいItem Store、汎用Selection Service、Reactive Runtime、全形式変換Engineを採用するものではない。IG1のSource復帰・IG2の二資料比較を遅らせない。

### 11.1 四つの状態を一つに畳まない

| 対象 | 保持・変更すること | 混同してはいけないこと |
| --- | --- | --- |
| **情報と意味** | Item/Source/Relation、Tree・Island・Affiliation・Review、各Revisionと開示範囲 | 描画されないItemを削除済み、非公開を不存在、近接を因果・親子としない |
| **Viewと表示** | Canvas/Tree/Mind Mapなどの表示方式、各Display Occurrenceの配置、ズーム・表示集約 | 表示座標や集約ラベルを意味正本、別Canvasの同一Itemを独立証拠としない |
| **作業対象** | Focus、一時Selection、明示的に固定したWork Setの候補、選択の基準版 | 画面内・描画済み要素の集合を、AIへ渡す完全な作業対象や現在のApply資格としない |
| **編集と再開** | 未保存編集、選択/Viewportの一時状態、明示Save/Undo/Redo、別Processの実Read | 画面移動・非同期Layout完了を保存、Commit、意味受理としない |

特に「同じItemを別Canvasで二つ表示」「同じCanvasで同じItemを二度表示」「同文だが別Source/別Item」の三つを区別する。画面上の選択はDisplay Occurrenceを起点にしても、実操作対象へ移るときはItem/Sourceの識別とScopeを明示的に解決する。一意に解決できなければ候補提示に留める。

### 11.2 ズーム・Fit・分割はまずView操作とする

- **全体Fit、選択範囲Fit、領域Fit、前の視点へ戻る**はViewportの移動を基本とし、Card本文、Tree親子、Island/Group所属、Relation、Review、保持すべき人手配置を変更しない。選択範囲Fitで非表示・権限外の対象を無断追加しない。
- 鳥瞰では必要に応じてCard本文を点・輪郭・代表ラベルなどへ省略し、拡大で内容を表示する。ただし、**LOD（描画密度）による省略と、検索・選択・出典復帰の可能性を分ける**。元のItem/Occurrenceへの移動経路を失った集約は、単なる見た目の最適化として受理しない。
- Treeの背景枝、KJの島、意味Edge、Canvas間リンクを異なる表示層として扱う。島を囲む形や重なり、画面上の近接から自動でSemantic Relationを確定しない。非単射の投影から元構造を逆編集する場合はLossと必要な人手判断を示す。
- 分割・Share・表示削除は[Hybrid §17.4](hybrid_outline_canvas_layout_plan.md)の候補操作に従う。一方のCanvasのOccurrenceを削除してもItem、他ViewのOccurrence、Source、Relationは消えない。明示的なItem削除は別の操作・権限・確認とする。

### 11.3 非同期描画と選択の継続性

Viewを切り替えたり、ズーム・検索・絞り込みが更新されたりしたとき、描画が遅れて届いた旧結果は、**現在のView/Selection/Sourceの世代に照合できた場合だけ**表示へ反映する。A→B→Aのように見た目や同一IDへ戻っただけで旧結果を復権させない。ここでの世代は局所的な無効化のための候補であり、Sourceの現在Grantや永続Revisionを置き換えない。

集約表示から詳細へ移る場合、Focusや明示固定した対象の**意図**と、現在の閲覧・編集資格を分ける。対象が削除・非公開・未取得・部分取得・改版された場合、古い対象へ無条件に書き込まず、元の選択意図を保持したまま現在の資格をunknown/unresolved等として扱う。未保存のCard編集やHold/異論を、View切替・AI整形・後着Layoutによって破棄しない。

集約値・島の件数・検索件数・Canvas Mapの線・「他にもある」表示は、**許可された取得範囲のみに基づく**。公開投影が同一で非公開Itemだけ異なる二世界の差を、件数・空白・重なり・診断文で漏らさないことを検査する。情報をまだ読み切っていない場合は、0件ではなく取得範囲の制限を示す。AI向けContextの完全性は画面LODと独立に検証する。

### 11.4 既存Gateに追加する試験観点と測定

新しいExpected正本やIG1のBlocking Gateは作らず、[情報統合 #3401](https://github.com/hat47x/sui-sensemaking/issues/3401)・Hybrid HC-01〜17/SI-XC・[共同Undo #3399](https://github.com/hat47x/sui-sensemaking/issues/3399)の既存Ownerで次を評価する。

| 観測する操作 | 独立Expected／失格例 |
| --- | --- |
| 同一Itemを二Canvasへ表示し、Aを拡大・移動・表示削除 | Bの配置・本文・Review・Sourceに副作用0。Aの表示消去がItem削除に化けない |
| 鳥瞰の集約からCardへ辿り、Canvas/Treeを切替え元へ戻る | Item/Occurrence/Sourceの帰属を維持。折り畳みやLODで選択・読取対象の同一性を失わない |
| 表示更新・検索・非同期Layout中に別の選択／未保存編集を行う | 後着の旧結果が現在Selection・Dirty Buffer・明示固定位置を上書きしない。Undo対象とView操作を混ぜない |
| 取得範囲がpartial、または隠れたItem/Edgeの数が異なる | 0件・全件・Consensusを誤表示せず、許可されない件数・連結関係・IDを漏らさない |
| 画面上は同じ同文Card、またはA→B→Aの操作列 | 出典と実Identity、更新世代、現在のRead/Apply資格を再確認し、表示一致を同一性の証拠にしない |

性能は合成**30〜50件→1,000件→10,000件**の順に測り、最初に役立つ表示までの時間、パン/ズームの応答分布（p50/p95）、メモリ、選択から詳細/原文復帰までの時間、集約から再展開した際の情報欠落を区別して記録する。計測環境、取得範囲、描画要素数、AI OFF/ON、現行Baseline、コードHEADを必ず併記する。根拠のない固定SLAや、表示の高速化だけによる正式受入を宣言しない。必要なら描画省略・部分取得・Canvas分割の順に小さく導入し、専用Graph DBや分散Storeを先行要件にしない。

**到達条件**：IG4では、少数Itemの実UIで「鳥瞰→選択→詳細→原文へ戻る」「別Canvasへ移って戻る」「非公開/未取得を誤表示しない」を人手操作とBrowser回帰で実証し、それから規模を増やす。実務価値は[ADR-0089](adr/ADR-0089-value-evidence-policy.md)／[#3400](https://github.com/hat47x/sui-sensemaking/issues/3400)のT2で判断する。**この節の新たなUI/E2E・性能測定はNOT RUN**。IG1の正式Raw Source復帰が成立したとの主張ではない。


---

本書は既存Issueに散在する受入の**実施順索引**であり、既存ADR・Hybrid Draft・R2作業票の上書きではない。新たな権限、Schema、共通技術基盤、製品機能の正式採択を意味しない。