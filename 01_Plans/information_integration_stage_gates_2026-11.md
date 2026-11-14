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


### 6.4 ブラウザ選択から元Raw byte範囲への橋（F1/F4の実証条件）

[実装担当 #3441のUTF-16/UTF-8 Fit/Gap追補](https://github.com/hat47x/sui-sensemaking/issues/3441#issuecomment-6869843018)を、実際のUIとReaderの**未接続部分**として取り込む。R1 Referenceは厳密な元Raw UTF-8 byte [start,end)を読み、BrowserはDOM Text node/Rangeの位置やJS UTF-16 code unit位置から選択を得る。この両者を**文字数・substring検索・表示コピー文字列だけで対応付けない**。Web標準の参考：[DOM Range](https://developer.mozilla.org/en-US/docs/Web/API/AbstractRange/startOffset)／[TextEncoderのread（UTF-16）とwritten（UTF-8）](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder/encodeInto)／[TextDecoder BOM](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/TextDecoder)。

**手順と非依存条件**：
1. **F0/F1**：現在許可済みのRaw Source bytesから、元byteの範囲に対応付いた表示用Text Runを生成。BrowserのDOM選択両端をその対応表へ解決する。行番号・装飾・自動折り返しはRawの選択対象にしない。BOM・CRLF/LF/CR・Unicode正規化・HTML描画による相違を暗黙に取り除かない。
2. **選択境界**：DOMの非Sourceノード、UTF-16 surrogate pairの内部、複数Runで連続Raw範囲を確定できない場合は、byte offsetを推測して保存せず未資格とする。選択範囲が同じ文字列の2箇所目であれば2箇所目の位置を保持する。
3. **F2**：Ownerが承認したSource選択の保存方式（§6.2案A/B/C）だけで、同Card IDに出典候補のbyte [start,end)と選択時Source版を保持。ブラウザで選択文字列を見たこと自体はRoot/Grantや出典継続性の証拠にならない。
4. **F3/F4**：Writer終了→別Process Product GET→現在Root/Scope/Grantで同Sourceの実byte範囲を再読し、原文の同じOccurrenceへ戻る。表示上の選択→Card保存→Reader再開を実Browserで操作し、R1の局所CLI試験と別に観測する。現在Sourceと一致しない場合もCard本文/異論/保留は消さない。

**固定の最小独立Expected（既存R2-SRC-01/02/05に紐付け、新規試験正本は作らない）**：

- Raw byteを `BOM(ef bb bf) + UTF-8("前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊")` とする。原byte長は**57**。検索文字列のUTF-8 byte長は**19**。表示ではBOMを除くが元Sourceに3 byteある事実は残す。
- 最初の「同じ言葉。🌊」は byte `[11,30)`、**2箇所目**はbyte `[38,57)`。BOMを表示しないText Runで、先頭からのUTF-16 code unit位置は最初 `[4,11)`、2箇所目 `[15,22)`（改行コードを元の2単位CRLFと1単位LF/CRとして保持する場合の期待）。この表示条件自体を変えるRendererでは、表示/元byteの対応表を変更して同じ元byte位置へ導くこと。
- この対応が取れないRenderer・Readerは「正確な原文範囲に戻れた」と申告しない。surrogate内部を境界とする選択、未知DOM Text Run、元Raw改版、同path別Rootは拒否/再照合。Sourceが無いこと、空選択、選択未取得、権限拒否を「正常に0件」とまとめない。

**実装済みReferenceの証拠（#3443、製品とは区別）**：[Draft PR #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)に、UTF-16↔UTF-8の元byte位置対応・単一DOM Text nodeのSelection・BOM/改行/絵文字/同文二箇所・Raw/選択byteのSHA-256内容Checkpointを実装。非同期WebCrypto開始時にRaw bytesと選択/比較記述子を独立snapshotに固定する。同byte別RootやA→B→Aでは、結果はあくまで`content-match-only`であり現在Root/Scope/Grantの証明ではない。初回HEAD `08a4aa58`の[CI #43545589557](https://github.com/hat47x/sui-sensemaking/actions/runs/43545589557)、DOM検証HEAD `dd11826e`の[CI #43548333212](https://github.com/hat47x/sui-sensemaking/actions/runs/43548333212)、Checkpoint HEAD `7665442c`の[CI #43549516493](https://github.com/hat47x/sui-sensemaking/actions/runs/43549516493)はそれぞれ**completed/success**。最後のHEADで対象Vitest **11件PASS**、代表E2E **11件PASS**（うちDOM新2件）、Frontend型検査/build、Backend契約ジョブ成功を実ログで確認。

**F1.5の限定File API入口（最新Draft）**：同PRに`readLocalRawFilePreview(File)`を追加。ブラウザで明示的に選択したFileの実byteをFile APIから読み、**元BOM/EOLを保った単一Text node→DOM選択→[start,end)→内容Checkpoint**へ受け渡す。1 MiBを上限とし、空/過大/不正UTF-8を拒否。戻り値を明示的に`unqualified-local-file-preview`とする。ファイル名、MIME、最終更新時刻、同digestをSource Identityや継続的再読取権限に昇格させず、Rawの保存・外部送信・Card書込みはしない。合成Fileを実Browserの`input[type=file]`へ与えるPlaywright 1件とVitest 2件を新設したが、**人間のOSファイル選択・SUI製品Readerへの組込みを実証するものではない**。最新コードHEAD `be8f210b76e64608e555966c0feb2ad665ca6033`の[CI #43553871864](https://github.com/hat47x/sui-sensemaking/actions/runs/43553871864)は確認時queued。**13件Vitest／新E2Eを含む12件のexact HEAD PASSは未判定**。古いHEADのPASSを最新へ転記しない。

**F1.5実UIに到達した範囲（Draft #3443・正式Source資格なし）**：前項の一時File Readerを、既存SUI `StartPanel`の展開時にのみ現れる「原文の一時確認」に接続した。**明示File入力→元RawのText表示→利用者選択のDOM Range→UTF-8 byte [start,end)と内容Checkpoint**を、DocumentV1に書かないまま画面で確認できる。Previewは1MiB以下・UTF-8厳密で、表示は単一Text nodeに限定。折りたたみを閉じる、またはStartPanelを閉じるとComponentをunmountし、Fileのraw bufferと選択情報のReact stateを破棄する。日本語／英語の説明を加え、既存の「文書ファイル読込」と明確に分離。JavaScriptのData保持・開示停止はこの画面の局所状態であり、OS上の元File消去、Browserメモリーの完全消去、全Network Sink非送信の保証と呼ばない。

**F1.5の新しい独立Expected**：実ChromiumでStartPanelを展開→原文プレビューを開く→合成`File`を指定→日本語同文の2箇所目を手動Selectionと同じDOM APIで選ぶ→`[38,57)`が表示される→非GET/HEADのRequestが増えないことをその試行で観測→折りたたんだらRaw表示と選択状態が消える。StartPanelの日本語／英語・compact時にプレビューが現れないことも回帰対象。**合成Fileの`setInputFiles`は人間によるOSファイルダイアログ操作の実証ではなく、正式R2-SRC-01のProduct Source→Save→再開とは異なる**。最新コードHEAD `6eed48ba123c606b7fbdf696f56e73ae8af2baad` の[CI #43557030239](https://github.com/hat47x/sui-sensemaking/actions/runs/43557030239)は**completed/success**。frontend-e2eの実ログにStartPanelの一時原文プレビュー試験があり、代表Chromium **13件PASS**。frontend-unitでは従来Byte/Checkpoint **11件**、File API **2件**、StartPanelの和英/compact **5件**の各スイートPASS、型検査/build、backend-contractジョブもsuccess。前HEADのcancelledは現在HEADの成功とは別記録する。UIの表示文言は「選択byte範囲のSHA-256を採取した」と表記し、別Processでの原文再読取による内容一致確認とは区別する。

**次のProduct接合（F1.5）**：実Readerが現在許可Sourceから表示するText nodeと元Raw byteを関連づけ、ユーザーのDOM SelectionをAdapterで解決して**byte [start,end)・選択Raw bytesの実比較**を行う。ただし、Source選択履歴を保存するCard/Document型は§6.2のOwner決定を要する。SUI Reader画面の実人手操作、実Host Root/Grant、Document Save/別Process Product GET、A→B→Aの現在性は、この限定Adapterと合成pre/Chromiumの成功からは一切証明されない。

**停止線**：R2のReaderと最小Browser操作を次に実証し、PDF座標・音声時刻・多形式Selectorや共有Editorを先行導入しない。限定Reference成功は**R2-SRC-01/02/05の一部のみ**であり、R2 Product E2E／Owner意味受理／外部Consumer受領は**NOT RUN**。

### 6.4.1 一時選択の鮮度と、将来のPin意図を分ける（2026-11-14）

TEI Studioの[Subject Pin検討 #4515](https://github.com/hat47x/tei-platform/issues/4515)では、**一時的なFocus/Selectionと、利用者が明示的に固定したPinの意図を分ける**。これをSUIのIG1へそのまま「Pin実装」として移植しない。現行SUIの一時Rawプレビューは、明示選択したFileの**その時点のDOM選択をbyte位置へ対応付けるだけ**であり、Cardへの出典保存、持続的Pin、現在のSource Grantを持たない。

**直ちに必要なUIの不変条件**：一時プレビューが確認済み`[start,end)`を表示している間に、利用者が同じ原文の別Occurrenceを選択したり、別ファイルを指定したり、プレビューを閉じたりすれば、**古い位置を現在の選択結果として残さない**。非同期ハッシュ処理が終わるまでにSelectionが変わった場合も、開始時のHashを別の現在選択へ転用しない。表示原文・元byte Snapshot・選択位置の整合性が確認できたときにだけ現在の位置を示す。ファイル名一致・同文字列・同SHA・DOM Node/描画LabelはSource資格やPinの継続性の証明にならない。

**今回の限定実装とテスト**：[実装Draft #3443](https://github.com/hat47x/sui-sensemaking/pull/3443)の`LocalRawPreviewPanel`に、Selection変更の監視と非同期SHA完了後の**現在DOM Range再照合**を追加。実StartPanelのChromium回帰に、後方同文を選択して`[38,57)`→前方同文へ選び直すと表示を消す→再確認すると`[11,30)`→同名で異内容の別ファイルへ差し替えると範囲を消す→閉じると状態が無い、という独立Expectedを追加。文書保存、外部送信、Persisted Source Pinは行わない。HEAD `3b27d865ace0d6b73c6a7d51f0fd142776a883a0`の[単体CI #43583154802](https://github.com/hat47x/sui-sensemaking/actions/runs/43583154802)は**completed/success**。実`frontend-e2e`ログにStartPanelの同文再選択・同名別ファイル交換を含む13件PASS、`frontend-unit`は**1,954件PASS（4件skip）**。Backend契約ジョブもsuccess。**限定UIの表示状態・内容検査の成功**であり、正式Source Grantや別Process復帰の証拠ではない。

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

---

本書は既存Issueに散在する受入の**実施順索引**であり、既存ADR・Hybrid Draft・R2作業票の上書きではない。新たな権限、Schema、共通技術基盤、製品機能の正式採択を意味しない。