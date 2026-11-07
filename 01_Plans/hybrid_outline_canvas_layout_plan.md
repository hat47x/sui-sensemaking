# ツリーとKJキャンバスの複合編集・粘性付き配置：製品計画案

- 状態: **提案・未採用 / 未実装 / 利用価値未検証**
- 作成: 2026-10-26
- 価値の正本: [ADR-0089](adr/ADR-0089-product-value-canon.md)
- 認知支援の導入基準: [ADR-0090](adr/ADR-0090-cognitive-assistance-candidate-layer-and-evidence-promotion.md)
- 技術設計案: [独立UI・背景ツリー・粘性付き配置](../02_Architecture/hybrid-tree-canvas-layout-design.html)
- 進行する仕事の正本: [ROADMAP](../ROADMAP.md)

## 1. 目的と利用者価値

SUIの一次利用仕事は、定性資料・観察を早すぎる分類や合意で潰さず、出典・異論・保留・判断の経緯を残しながら理解を育てることである。今回の候補は、この一次価値を補強する「**構造化しやすい入口と、意味を育てる自由な空間を往復できること**」に絞る。

利用者はアウトライン／マインドマップでノードの親子関係を組み立て、同じノードをKJキャンバスへカードとして配置し、別の観点で島を形成する。キャンバスには、アウトライン由来の親子関係だけを薄い背景枝として投影する。異なる親の枝が同一の島へ集まることは、分類軸と発見されたまとまりの一致・不一致を表現し得る。線の錯綜を自動的に誤りと扱わない。

AIは親子関係の生成、代表テキスト候補、初期配置、局所的な整形、変更差分の提案を支援する。利用者の意味形成・配置意図と採否判断を優先する。初期導入の成功は機能数や自動配置の得点ではなく、元資料へ戻れること、少数意見・保留を維持できること、図を使って新たな関係に気付けることで評価する。

## 2. UIと意味の境界（候補要件）

| ID | 要件・意図 | 受入時に見ること |
| --- | --- | --- |
| HC-01 | アウトラインとキャンバスは**独立したUI**。アウトラインとマインドマップは同じツリーを編集・閲覧する二つの表現 | マインドマップの再整列やキャンバスの移動が相手の保存座標を上書きしない |
| HC-02 | 共通ノードIDに対し、Tree（親子・順序）、Mind-map Layout、Canvas Layout（座標・島）を分離する | 同じノードを別UIで追跡でき、Tree revisionを特定できる |
| HC-03 | キャンバス上の親子枝はTreeからの**読み取り専用の描画Projection** | SUIの既存`Edge`（関連・対立・因果など）と混同せず、親の変更でカード座標は変わらない |
| HC-04 | マインドマップのレイアウトはキャンバス初期配置の候補として利用 | 初期配置後は双方が独立し、既存の人手配置を自動再初期化しない |
| HC-05 | KJの島とTree上の親子所属は別の観点として共存する | 異なる祖先から同一島に枝が集まり、Treeと島を自動再編成しない |
| HC-06 | 親側ほど太く、全体として十分薄い背景枝を表示。枝の強調・抑制は表示操作 | 幹の重ね描きで不透明度が増えず、カード本文を覆わず、選択した祖先経路を辿れる |
| HC-07 | アウトラインの中間ノードを折り畳み、代表カード／説明を投影できる | 代表文は元の子孫・根拠・保留・反証へ戻れ、AI生成文を元ノードの事実へ自動昇格しない |
| HC-08 | アウトラインの折り畳み状態とキャンバスの折り畳み状態は独立 | 複数島にまたがる部分木を代表表示してもカード所属と本来のノード同一性が失われない |
| HC-09 | 人が作った島・相対配置・固定・違和感・納得感・言語化できない感覚を配置候補の制約または評価に利用 | 人の`critique`を真偽や正解スコアへ読み替えず、曖昧な評価は曖昧なまま残る |
| HC-10 | **配置の粘性**。既存の島と人手配置を尊重する制約付き局所整形 | AIの「整える」が元の島や意味上重要な交錯を自動解体しない |
| HC-11 | 一回に動かす量を制御するスライダーと、別軸として編集対象範囲・固定対象・編集モードを持つ | スライダー最大でも選択範囲外・固定対象・Tree/島の所属・意味は変更されない |
| HC-12 | 人が一括選択・大胆な移動を行い、AI／決定論的レイアウトがその後で余白・重なりを整える | 人が動かした直後の配置を新しい基準として改善する |
| HC-13 | AI提案は選択範囲・現在版・変更内容・保持条件を指定した**差分のプレビュー**として扱う | 採用前のキャンバスは変更されず、採用は一回のUndo単位 |
| HC-14 | Undo/Redoと「この島以外を前版へ戻す」などの**範囲指定された部分復元** | 指定版と現在版の差分から座標のみ復元し、要素削除・Tree変更・保留変更を黙って混入しない |
| HC-15 | 自然言語と選択操作を組み合わせた変更依頼を、検証可能な型付き編集操作の候補へ変換 | 曖昧な「ここ」は選択ID・範囲などで確認し、古い版への上書きを防ぐ |
| HC-16 | KJキャンバスが中核的な意味形成UIであり、アウトライン／マインドマップを使用しない自由探索も成立する | 最初から親を与えないカードも作れる。仮ルートを正式な分類として扱わない |
| HC-17 | 時系列・予定・実行結果などの別構造も将来同じ意味成果物を参照できる | 今回のPoCへスケジューラーやTEIの全標準型を依存条件として持ち込まない |

## 3. 最初の利用経路と段階的な計画

**第1段階 — 構造と配置の独立性を観察する（ローカル、AIなしでも成立）**

合成30〜50ノードのForest/Treeを作り、アウトラインとマインドマップで編集・閲覧する。マインドマップ配置をキャンバスの初期座標に一度だけ取り込み、カードを別の島へ自由配置し、背景の親子枝を薄く表示する。島への流入元が複数でも描画・保存・再読込できることを確かめる。既存のSUI `DocumentV1` を改訂する前に、外部fixtureや実験用の独立データを使う方式を先に検討する。

**第2段階 — 代表カードと人手編集の粘性を確かめる**

中間ノードを折り畳んで代表表示し、子孫・保留・根拠へ展開できるようにする。人が島を一括移動した後、固定範囲を守りながら整列・重なり解消だけを実施する。個々のカードの絶対位置と、島内部の相対位置の維持を別々に評価する。配置変化量スライダーは明示的な移動上限と組み合わせ、表示上の割合と実移動量の対応を実測して決める。

**第3段階 — AI提案と部分復元**

現在の選択範囲、Tree・Canvasの基準版、既存島、配置上の保持指示、必要な人的アノテーションを選択してAIへ渡す。AIは「操作候補と理由」を返し、決定論的な配置計算が範囲・固定・移動上限を検証する。採用後の一回Undo/Redo、指定版との差分からの部分復元、保存・再読込を確認する。SafeModeの送信境界を変更しない。AIなしの手動操作と決定論的整形は常に残す。

**第4段階 — 適用可能性の検証**

アウトラインのみ、通常マインドマップのみ、KJキャンバスのみ、ハイブリッドの四条件を、同じデータで比較する。人が意味上の新しい関係を発見できたか、保留と異論を維持できたか、図を再開して理解できたか、変更提案のノイズ・混乱が増えていないかを測る。ADR-0089のT2（Maintainer自身のSUI外の実務利用）で必要性と増分を確認するまで製品既定に昇格しない。

## 4. 負例と完了判定（初期案）

| ケース | 期待する振る舞い |
| --- | --- |
| N1 別親のカードが一つの島に集まる | 意味ある交錯と出所の多様性を保持。Treeの自動付け替えなし |
| N2 AIが「見やすく」と全体をシャッフル | 変更範囲・粘性・移動上限で拒否／縮小し、候補だけを提示 |
| N3 人が島全体を大きく移動 | AIは移動後の位置を基準に島内部を整形し、島外を維持 |
| N4 子孫に矛盾やheldがある代表カード | 説明を断定へ圧縮せず、折り畳みから元へ戻れる |
| N5 ある部分木が複数島に散らばる | アウトラインの折り畳みがCanvas所属を変えない |
| N6 「ここ以外前回に戻して」 | 明示選択を除外し、指定版から位置だけを復元。後続追加・削除は別扱い |
| N7 AI応答中にTree/Canvasが変更 | 古い基準版の提案を黙って適用せず、再計画／差分確認 |
| N8 再読込・provider none | 人手構造・配置・保留・アノテーションを保持し、基本操作を続けられる |
| N9 部分的な共有・SafeMode | 未レビュー本文・人的コメント・非公開情報の漏えいを防ぎ、墨消しで欠けたContextを確定済み扱いしない |

実装完了の主張は別のEvidenceを要する。この計画案の追加は、上記ケースのPASSでも製品採用でもない。

## 5. 既存資産と外部基盤との関係

- [SUIの現行スキーマ](../02_Architecture/schemas.md): `Card.x/y`、`Island.cardIds`、`Edge`、`Affiliation`、`critique/critiqueTags` を各々の意味の範囲で使う。ツリー枝を既存の意味的`Edge`へ複製しない。新しいTreeやLayoutの正式永続型はPoCで保存圧力を観測してから検討する。
- [SUIの意味モデル](../02_Architecture/sensemaking_semantic_model.md) と [成果物契約案](../02_Architecture/sensemaking_artifact_contract_v1alpha1.md): Structure、Review、Decision、リビジョン、Authorityの分離を保つ。L0の契約を実装済みとして扱わない。
- [SUIの島形状設計](../02_Architecture/island_shapes.md): ドラッグ中はプレビュー、確定時は一回のUndo単位とする境界を参照。
- [SUIの既存判断履歴](https://github.com/hat47x/sui-sensemaking/issues/3175)、[構造判断履歴](https://github.com/hat47x/sui-sensemaking/issues/3239)、[保留復元](https://github.com/hat47x/sui-sensemaking/issues/3256): 履歴を別の共通サブシステムへ複製せず、空間的な操作履歴と意味上の判断履歴を分ける。
- SEI Cognition: Working Set、意味状態、留保、AIへのContext選択は連携の対象候補であり、SUIの基本操作をSEI常駐に依存させない。
- TEI: 汎用Tree/Graph/Layout、時間・予定等の`std.*`への将来接続候補。実装済み標準プラグインとは主張しない。
- TAI: 各基盤をまたぐ活動の有用性評価の文脈。SUIの現行機能要件の正本や実行権限をTAIへ移さない。

## 6. 未決事項

- 1つのノード集合に対するTreeは一つか、複数の分類Treeを並存させるか。未分類カードの扱い。
- Tree/Canvas/Mind-mapの版、レイアウト操作履歴、代表カードの参照をどこへ保存するか。既存`DocumentV1`への追加・移行の要否。
- カードごとの「固定」「人手配置の強さ」「島の意図」を、既存アノテーションとどう区別して保存するか。
- 線の太さ・透明度、共通幹の束ね方、ズームに伴う可読性。数値は実画面を見て選ぶ。
- 自然言語依頼の曖昧な指示、削除済み対象、競合する復元指示をどう解決するか。
- 人的な納得感・違和感を意味上のTruthや承認へ変換せず、内部のレイアウト評価だけに使う対応。
- 外部資料・画像・出典を含む部分をSafeModeで共有する場合の投影と送信範囲。

判断と履歴は小さなPRへ残し、正式契約の追加が必要な時点だけADR化する。新たな管理台帳は作らない。


## 7. 構造差・再解釈・部分適用の検証追補（2026-10-31、設計候補）

本節はHC-02/03/05/07/09/10/13〜16およびN1/N4/N6/N7/N9の**受入観点の補足**である。追加の製品要求、採用済み仕様、実装完了を意味しない。10/28の構成議論#Workの担当領域へ重複作業を発行しない。既存のKJ技法、意味成果物L0、判断履歴、SafeModeを置換しない。

### 7.1 構造差を観測しても、意味上の発見や採用は成立しない

- Treeの親子・順序、Islandの視覚的包含、Affiliationの横断的所属、カード座標、意味的Edge、表示枝は別の性質を持つ。カードIDが同じでも、**同じ版・同じ意味・同じAuthority**を保証しない。
- 例：営業A、経理C、情報システムEが別のTree枝にある一方で、同じIsland Xに含まれることは、指定スナップショットから決定論的に観測できる。しかし、なぜ集まったか（人手の意味編成／一時的な作業／AI初期配置／旧版の残存）は構造差だけでは判定できない。
- 「部門横断の月末負荷がある」という解釈はObservationではなくHypothesis候補とし、元カード、反例、別の解釈（偶然の配置・分類軸の混在など）へ戻れるようにする。新しいStructure候補が生成されても、元Tree・Island・異論・保留は上書きしない。
- 代表カードやSynthesis候補には、元の関心の**保持／具体化・追加／表現からの脱落／未解決**を人が検討できる経路を置く。AIの説明、候補選択、見た目の一致、配置変更を、理解成立・`human_reviewed`・Accepted・実行許可へ自動昇格しない。転写検査（`SUI-INSPECT-01`）を既存技法として利用できるが、万能な意味保存証明とはしない。

### 7.2 比較対象・未評価範囲を固定し、空結果を「不存在」と呼ばない

- まずは**同じ固定Document/fixtureのTreeとIsland包含を比較する局所的・副作用なしの観測**に限る。対象カード集合、Tree構造、Island構造、参照する版または再現可能なスナップショット、比較規則を特定する。Tree/Island個別revisionの永続形式や共通Comparison schemaは未決とする。
- 所属差だけを調べるとき、座標・背景線の太さ・Rendererが変わっても結果は変化しない。一方、Tree祖先またはIsland包含が変われば、影響した範囲の結果を更新する。空の差分は「**指定対象・指定規則で差が検出されなかった**」以上を意味しない。参照欠損、範囲不完全、未対応、版不一致ならその制約を併記し、空結果と混同しない。
- 現行のLLM IRは用途別の損失を伴う投影であり、`islands.card_ids`の先勝ち、`EvidenceLink.note`の除外、未知のEdge型の除外等がある。**構造照合の正本を投影済みLLM IRとしない**。必要ならローカルの元Documentから用途別に投影し、Affiliationや保留・反証を評価対象へ含めたかを呼出し側で確認する。
- SafeModeで非開示の情報がある場合、AIへ非開示対象の件数・ID・存在自体を追加開示しない。「未評価」と表示できる範囲は既存の開示規則に従う。投影から除外されたことは、元資料に存在しないことの証明ではない。

### 7.3 AI提案の採用・部分復元を、版付きの限定操作として検査する

- 提案時の基準`base`、採用直前の`current`、提案差分`proposal`を区別し、**書込対象だけでなく提案が参照した読取条件**（固定座標・島所属・相対距離・Tree祖先など）を照合する。これらは検査項目であり、新しい汎用Patch engineや永続schemaの導入を意味しない。
- 書込対象が異なっても安全とは限らない。例：AIが「Aとの距離を保ってBを右へ」と提案中に、人がAを移動した場合、Bだけを変更するPatchでも古いAの座標に依存する。依存条件が変わったときは自動適用せず、差分再確認・再計算または見送りとする。
- 座標のみの操作では、Card本文、Tree親子、Island包含、Affiliation、Critique、Hold、Review/Authorityを変更しない。空間的な違和感や意図は再確認対象になり得るが、幾何学的な制約充足を意味的な納得の証拠とはしない。
- 「この島以外を前版へ戻す」は指定版と現在版を比較し、対象の**座標だけ**を選択復元する。削除済みカード、対象範囲変更、相対配置の依存競合は自動復活・無条件上書きせず明示する。Undo/Redoは操作の復元であり、過去のReview/Decision/Authorityを復活させない。

### 7.4 歴史的な理解と現在の適用可能性を切り分ける

- 例：当時のTree T12／Island I18で観測O1を得て、作業仮説H1を採用した。後にカードCの本文改訂、反例Fの追加、あるいは採用判断の撤回があっても、**当時のO1/H1の存在と来歴は消さない**。一方、現在も妥当・採用済みと表示するには別途確認が必要である。
- 内容が同じでも人の確認が撤回される場合がある。判断の撤回はSourceのbyte変更と別。逆に、資料が変わっただけでAIが過去の判断を自動撤回・棄却することもしない。再評価候補は、何が変更されたか／何が従来どおり再構成できるか／何が未判定かを分けて示す。
- 既存のカード・島のCritique履歴、StructureDecisionRecord、保留の手動復元（#3175/#3239/#3256）を優先して照合し、新しい第二のDecision Logや全UI操作の恒久履歴を増やさない。理由が保存されていない過去操作へ、AIの推測理由を人間の理由として補完しない。

### 7.5 既存PoC段階に追加する最小反例（全て未実行）

| 対応段階 | ケース | 合格とみなす最小条件 |
| --- | --- | --- |
| 第1段階 / N1 | C1: TreeとIslandの所属差を観測後、座標・描画のみ変更 | 所属差は不変。背景枝は意味Edgeへ保存されない |
| 第1段階 / N1 | C2: Tree祖先またはIsland包含を変更 | 指定範囲の観測結果だけが正しく変わる。Affiliationを勝手に変更しない |
| 第1段階 / N9 | C3: 比較対象欠損・LLM IRで関係が省略・SafeModeで非開示 | 未評価と不存在を区別し、非開示情報の存在をAIへ漏らさない |
| 第2段階 / N4 | C4: 代表表示の元子孫にheld・反例・少数意見がある | 元へ戻れる。断定的な単一解釈へ圧縮しない |
| 第3段階 / N7 | C5: AIがBを移す提案中に、依存先Aを人が移動 | 書込対象がBだけでも古い依存を自動適用しない |
| 第3段階 / N6 | C6: 位置を前版へ部分復元後、過去の採用判断が撤回済み | 座標だけ復元し、判断・Reviewは復活しない |
| 第3段階 / N7 | C7: 提案生成中にカード本文またはTree所属が変更 | 古い解釈候補を現在の受理・観測へ自動昇格しない |
| 第4段階 | C8: 新しいStructureが元意見の片方を脱落・勝手に追加条件を付与 | 原カードと保持／脱落／追加／未決を人が比較でき、案を保留・棄却できる |

最初は第1段階のC1〜C3を、既存の30〜50ノード合成fixtureへ**追加検査として**位置づける。第3段階以降の機能を前倒しの必須条件にしない。第4段階ではKJのみ／Treeあり／AI補助ありで、発見の再確認、残余の保持、操作負担、誤った早期収束を比較する（ADR-0089のT2実務利用とは区別し、T2の代替証拠にしない）。

### 7.6 受入・変更の境界と未決事項

- **確定的な品質境界（設計上の提案）**：比較の対象と条件を言えること、構造差から意味を自動確定しないこと、座標操作の非干渉性、現在の判断と過去の履歴を区別すること。
- **未確定**：複数Treeの永続化方式、個別revisionの粒度、Annotationの対象スコープ、再評価結果の保存先、Canvasの認知的な効果、Providerの汎用化範囲。これらは実Consumerと実務利用から判断する。
- SUI基本操作をSEI常駐／TEIのGraph・Layout標準プラグインの完成へ依存させない。TEIは構造照会・幾何・読取表示の限定的能力の再利用候補であり、意味判断の所有者ではない。SHOの文章化は元カードへの参照を維持し、文章の流暢さを意味的受理へ読み替えない。
- 本追補は**設計観点と未実行期待値**の保存である。mainに文書が統合された事実、既存の合成正常系など他作業の実証、SUI PoCのPASS、Owner採用を混同しない。新規の汎用Outcome・承認Engine・TEI独自Host・第二正本は前提にしない。

### 7.7 視点間パターンを、同種構造の差分と区別する

- **Treeの親子関係とIslandの視覚的包含は異なる関係**であり、同一対象について一致・不一致を判定する前提はない。「別Tree枝にあるカードが同じ島に集まる」は、相反する二つの真偽値ではなく、**二つの視点を横断する観測パターン**である。従来の「構造差」という略称を使う場合も、矛盾や誤分類の自動判定へ読み替えない。
- 最小の観測例は、共通に参照可能なカードa,bについて、明示したTree分類基準（例：部門直下の祖先）が異なる一方、同じIslandに**視覚的に包含**されるという結合条件。概念的には `treePartition(a) != treePartition(b) && island(a) == island(b)`。Tree分類基準の指定がない、祖先が比較不能、Tree側に対応ノードがない、対象が投影から欠けるときは「差0件」ではなく、比較可能な範囲と未評価を区別する。複数Treeを同時に永続化する正式仕様はここでは決めない。
- このパターンは「同じ島に集まる理由」を説明しない。人による意味的な編成、作業上の一時配置、AI初期配置、以前の版から残った配置など、異なる生成経路がある。観測と、それへの解釈Hypothesisを別に保持する。Affiliationは横断的な**意味上の所属**であり、`island(a)`の代替ではない。
- 既存C1/C2の比較規則を上記の結合条件として読む。Graph/Rendererの同値性を示す試験ではなく、同じ明示的な関係・対象版から同じ観測パターンが得られることを確認する。SUIへ汎用Ontologyや新しいRelation enumを導入する理由とはしない。

### 7.8 Tree先行の認知的な枠付けを、第4段階の利用価値検証へ含める

- HC-16の「自由なKJ探索」を保持したまま、**既存分類の提示順による枠付け（anchoring）**を観測対象にする。Treeは発見の補助になり得る一方、先に与えた分類によって、後から形成する島や表札が誘導される可能性もある。構造の相違が多いこと自体を創造性の高さや成果と見なさない。
- 第4段階の比較へ、同じ原資料から始める三条件を含める候補とする。A：Treeを見せず自由なKJ編成から開始、B：既存Treeを先に提示してKJ編成、C：自由編成の**後**にTreeを提示し再解釈を促す。先にTreeを使った人は完全な未提示状態へ戻れないため、同一参加者による単純な前後比較だけで因果差を主張しない。実施可能なら参加者割付と資料順を調整し、人数・経験・資料差という限界を併記する。
- 評価対象は、新しい関係や区別を元カードへ戻って説明できたか、孤立カード／反例／heldを保持できたか、Tree先行による見落とし・修正が発生したか、説明できない関係を「発見」と言い切っていないか、試行・保留・撤回を続けられたか。AIによる「発見件数」「採用率」「類似度」だけを成功指標にしない。
- 追加の実験専用UI・順位付けモデルを必須にせず、まず既存の手動／決定論的操作と固定fixtureで比較する。SUI #3157のlearned rankingはT8判定待ちの独立研究であり、同研究のPreservation Laneやlongitudinal reopen測定を置換しない。第4段階の確認はADR-0089 T2の実務利用とは別資格であり、T2を代替しない。


---
<!-- 20261107-sui-okf-crosslayer-plan -->
## 8. OKFの知識管理原則を、探索の多層構造に合わせて導入する（2026-11-07／未採用）

一次資料：[OKF v0.2](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md)。実装・独立Expectedの追跡先は [SUI #3392](https://github.com/hat47x/sui-sensemaking/issues/3392)、SHO文書化は[#3391](https://github.com/hat47x/sui-sensemaking/issues/3391)、SEI知識交換は[SEI #820](https://github.com/hat47x/sei-cognition/issues/820)。**OKFをDocumentV1や未実装のTree/Canvas正本へ置き換えない**。

- **出典（Source）**：Card単位、Islandの理由、仮説と反例のそれぞれが何に依拠するかを選択的に観測し、OKF出力時に`source.id`と脚注IDで対応づける。既存`Card.meta.source`は原資料への任意の自由記述であり、出典の実取得・Exact Binding・著者性を保証しない。OKF sourcesのリスト順をCard/Claim対応へ流用しない。
- **生成と確認（Provenance）**：SUIのAI提案、人手での配置/要約変更、カードや島のreview、SEIの判断、OKF Conceptの`verified`は異なるイベント/対象。OKF派生`human-reviewed`の文字列やConceptの`status:stable`をSUIのlocal review/Owner受理へ自動昇格させない。IslandやTreeの構造が美しいことも真理・合意ではない。
- **鮮度（Lifecycle）**：Card本文・原Source・Island包含・Tree祖先・Reviewer撤回・キャンバスの座標を異なるChange kindとして扱う。Source改版と判断の失効は依存する範囲だけ再評価し、過去の発見/違和感は歴史として保持。座標だけが変わるとき原文脚注を失効させず、位置関係に依存した仮説には再検討候補を出す。`stale_after`は期間の目安で、現在の採用・完備性の保証ではない。
- **多層構造・Loss**：Outline/MindMapのTree親子、Canvas位置、Islandの視覚包含、Affiliation、意味Edge、Hold/Contrary/Reviewを単一のMarkdown見出しへ縮約しない。別Tree祖先の枝が一島に集まる現象はObservation候補であり、OKFに`type: Insight`を付けても自動Meaning化しない。Lossと元SUIへの参照を明示。非公開のCard/Edge/Island/countをLoss表示で漏洩しない。
- **段階的Discovery**：OKF `index.md`の発想は、大きなSUI探索から許可済みの関心対象・出典・保留だけを読み込む選択的Contextとして参考にする。ただしIndexの取得対象は完全なUniverseとは限らず、表示されない数/ID/未許可情報を推測しない。`log.md`は公開用の人間可読な履歴であり、SUI既存のsummaryHistory/critiqueHistory/Review Eventsや正式な撤回・認可の代替としない。
- **軽量性と自律性**：AIやOKF Plugin、SEI/TEI/TAI常駐を要求せず、Card/KJ/Outline/Mind Mapの基本操作が成立することを維持する。SHOへ渡すときは利用者が許可した範囲だけMarkdown Draft/任意OKF ConceptとしてProjection。外部OKF Conceptをインポートしてもカード/島/Treeの自動更新とせずレビュー候補として扱う。

**検証順序**：既存のAI無し手動KJと出典手掛かりをまず固定→同じ5 Card/2 Island合成FixtureでClaim-source脚注と未解決/多重所属/構造Lossの投影→SafeMode/異論/未レビュー・非開示→A→B→A/一部変更の再検討→SHO/SEIへ実受領。#3392のSU-OKF01〜12を独立Expectedとして参照し、ここに第二試験Gateを作らない。Hybrid PlanのHC-01〜17/C1〜8とADR-0089 T2実利用を後から満たしたことにはしない。

**状態**：仕様照合に基づく製品設計候補。現mainに新OKF Exporter、Hybrid Tree永続化、真正Source Binding、Attester、SHO Writer E2E、実Agent Skill、User T2効果が実装・実証されたわけではない。

---
<!-- 20261107-sui-okf-source-and-disclosure-witness -->
## 9. OKFへ出す前の実取得・可視範囲・出典Witness（2026-11-07／現行コード照合）

### 9.1 現実装で取得できる情報と不足情報

現mainの `03_Implement/frontend/src/export/context_bundle_projection.ts` と `02_Architecture/schemas.md` を照合した。以下は実コードの静的確認であり、外部APIの実Response/Consumer E2Eを実証したものではない。

| 現行経路 | 観測できるもの | 自動昇格できないもの |
| --- | --- | --- |
| `context-projection.v1` のCard | `id`/`claimType`/`holdState`/`reviewed`/`redacted`、制約内の本文と限定digest | `Card.meta.source`は **ProjectedCardの型に存在しない**。元資料・Original Span/Revisionの認証・完全な引用を推測しない |
| `context-projection.v1` のIsland | `id`/公開可能な題名/題名単位digest | `Island.cardIds`/`parentIslandId`/Tree/座標は含まれず、題名digestは包含・所属・複数Treeの版を証明しない |
| 同ProjectionのRelation / Link | 選択制約とレビューを通った公開可能な端点/種別 | Edge履歴・非公開Relation・全Graphの完備性を断定しない |
| `counts`/`voids`/`narrativeChecks` | 現投影契約では**文書全体の**reviewed/unreviewed/redacted countと、限定されたvoid ID/島ID、narrative check件数を露出 | `SafeMode ONなら存在/件数さえ常に秘匿される`とは断言できない。OKFへの再配布時には新たなDisclosure判断が必要 |
| `bundleHash`/`baseDocSignature` と単位digest | 公開投影の構成要素と、クライアント申告 `updatedAt` を含む署名 | `holdState`/`meta.source`/Island所属が変化してもその変更を常に捕捉できるとは限らない。`updatedAt`はサーバー保証版でない（既存[#3299](https://github.com/hat47x/sui-sensemaking/issues/3299)） |

**特に重要な差**：`ProjectedCard.holdState` は応答には載るが `bundleHash` の hashPayload には含まれない。`meta.source`は型にも hashPayloadにも載らない。Islandの cardIdsも未収録。`updatedAt`を更新しない保存などでは内容の意味・出典・保留が変わっても投影hash不変になり得る。これを根拠にOKF `verified`/SEI exact bindingの現行性を証明しない。既存ADR-0103と#3299の意味を上書きせず、**用途に必要な項目の実Read**を追加の資格条件にする。

### 9.2 3段階の証拠能力を分ける

| 入口 | 許される主張の上限 | OKFへ書ける出典 |
| --- | --- | --- |
| **L0: 現行の許可済みAgent Projectionだけを受領** | 投影に現れた公開内容/制約/条件/部分Scopeのみ。SafeMode ONで本文が伏せられれば本文Claimの再引用不可 | 原資料は未取得。`Card.meta.source`由来のfootnote/`sources`は書かない。元資料を検証した体裁にしない |
| **L1: SUIが許可した元DocumentとCard出典手掛かりを内部で実Read** | Card ID+実Doc版+自由記述 `meta.source` を見たといえるが、原典の取得/位置の照合・Source authenticityまでは未確定 | Sourceの存在を未検証の『参照候補』として限定表示（公開可否/範囲が別）。OKF sourcesを作るときは誤って `verified` へ昇格しない |
| **L2: 参照先原本を許可されたReaderで再取得し Claim→Original span/Revisionを解決** | 特定ClaimのOriginalに戻れることを、指定Source/時点/範囲に限定して説明できる。独立性/意味妥当性/完全性は別のSEI判断 | 権限により公開可能な源だけ `sources[].id`↔本文脚注を実対応。Credential/秘密URI/Hidden IDをFrontmatterへ流さない |

**L0→L1→L2は単なるユーザー操作の順番ではなく、実証できるClaimの包含関係**。このL0/L1/L2は本節での**説明上の読取範囲の略号**であり、既存`InquiryJourneyV1`等の「L0: Planned」成熟段階とは無関係。正式Status Enum・Capability Level・実行許可に導入しない。OKF `type`/脚注の見た目、SKILLの説明、LLM自身の作文だけで段階を上げない。現在のSUI外部AdapterがL1/L2に到達するとは主張しない。Native SUI閲覧は外部Agent公開許可と同義ではない。

### 9.3 二世界・同表示の反例とDisclosureの検証

同じ公開カードC1/C2の本文・題名、同じ `updatedAt` を持つ2つの許可済み合成文書W1/W2を用意し、(a) W2のみ `meta.source` が別の原典に変更、(b) W2のみ `holdState` が変更、(c) W2のみIsland所属が変化、という**一因子差**を各々作る。現`bundleHash`/Card digestで区別できるか実測し、必要な出典・構造・保留を表現する識別子ではないことを受入に反映する（SUI #3392 SU-OKF01/04/05）。hashが同じでも『同じ知識・同じSource』と扱わない。

別の二世界W3/W4では、公開文書・公開カード本文が同じで、非公開Card/Edge/Islandだけ異なる。現在のProjectionは `counts`/`voids`/島ID等を露出し得るので**外部が二世界を区別できないとは保証されない**。隠れた情報の存在/数量まで秘匿したいConsumerの要件と、現在許されている構造Count公開は別契約。勝手に既存Projectionの数を削除せず、OKF Exportにその値を転載するかはOwner/Disclosureの別判断として、明示的許可がない限り再配布しない。

Schema/Frontend/BackendのSafeMode・agent `GET /docs/{id}` とMCP `get_context_projection` は異なる可能性がある。外部Harnessがどの経路を実際に通ったかを証拠に含め、片方のゲートがもう片方にも強制されたとは推論しない。 [#3275](https://github.com/hat47x/sui-sensemaking/issues/3275)/[#3297](https://github.com/hat47x/sui-sensemaking/issues/3297)/[#3285](https://github.com/hat47x/sui-sensemaking/issues/3285)の既存判断・Source公開条件を変更しない。

### 9.4 検証の最小提示票と責務

OKF/SHOへ送る最小の内部検証票（**新Canon Schemaでなく試験票**）は `producer current source & revision`、`transport/read route`、`actual visible object set/selection`、`safeMode & disclosure decision`、`claim→SUI Card/Island & original source resolution state`、`loss (Tree/Canvas/Affiliation/Edge/Hold)`、`provenance/verification applicability`、`current trust ceiling`、`unread/partial/unknown`。機密情報のID/数や原URI自体は許可されない投影に同梱しない。

- **SUI**：Sourceを実読んだか／出典が手掛かり止まりか、公開可能な構造とLossの区別、現在のReview/hold、文書版の限界。
- **SHO**：Raw Markdownの保存・再取得・Source footnoteを構文的に保全。SUIの元構造/Authorityを新たな意味正本へ複製しない。
- **SEI**：Claimの外延・内包・独立Source・現在用途の十分性、未決と追加Probe。L0/L1なら不足を保持し、見た目からOriginalの確認を推測しない。
- **TAI/YIC Skill**：SUI→SHO/SEIが必要な時だけ受渡し。実Tool/Skill Load、Host・OS隔離、現在の開示許可と対象Contextを別検査。外部Harnessでの限定TEI CLI呼出し成功（TAI #168）を今回のSUI OKF経路の実証へ転用しない。

**試験の位置付け**：上記は既存[#3392](https://github.com/hat47x/sui-sensemaking/issues/3392) SU-OKF01/04/05/08/09/10/12と、[SEI #820](https://github.com/hat47x/sei-cognition/issues/820) KO-01/05/06/07/10/11を**同一Fixtureで絞って適用**する。新たな長大な試験群・中央Attesterを設置しない。L0現行コードは静的確認のみ、L1/L2/実外部API/文書生成/Importer・独立Consumer/OS権限は NOT RUN。
---

<!-- 20261107-sui-okf-proof-carrying-handoff-trial -->
## 10. SUI → SHO → SEI の「根拠を伴う引渡し」を一つの縦切りで検証する（2026-11-07／設計・未実行）

### 10.1 先行製品の最新実証と不足

- **SUI**：現mainの `context-projection.v1` は一部のCard/Island/Relation/Countを出せるが、`Card.meta.source`、原資料版、Islandの全所属は出せない（§9）。`bundleHash`やクライアント申告`updatedAt`も、公開された知識全体の同一性保証ではない。
- **SHO**：[Draft #17](https://github.com/hat47x/sho-composer/pull/17) の固定HEAD `4113040fb66b72f62f5baaeaf88aedd961b4b6bc` はUbuntu/Windows各16/16のG1b read-only Reader限定CIが成立（BOM検出と2MiB+1有界読取）。ただし未解決のReferenceを全列挙した証明でなく、文書を書込んで再開するG2 Writerは別。[SHO #4](https://github.com/hat47x/sho-composer/issues/4)/[#16](https://github.com/hat47x/sho-composer/issues/16)がOwnerであり、Reader成功をSHO受領・保存成功へ転用しない。
- **TEI/TAI**：[TEI PR #3113](https://github.com/hat47x/tei-platform/pull/3113)は2026-11-07 01:10 UTCにmerged。DSH `h2-08` で実TEI CLI起動32回・Tool呼出し56回・結果55回が限定観測された。一方、read-only参加者から固定WorktreeのReadが可能で、独立Expected/Skill資料の非露出隔離が未証明。[TAI #168](https://github.com/hat47x/tai-pleroma/issues/168)のH2→H3比較資格は**未達**。この実験をSUI/SHO/SEIの接続・認可・Tool実LoadのPASSへ昇格させない。
- **SEI**：[SEI #820](https://github.com/hat47x/sei-cognition/issues/820)はConcept/Source/Decision/Unknownの対応案。原資料の独立Readと用途別十分性が未証明なら、OKF `type`/`verified`や文書の保存を現在のMeaning/Decision Acceptanceにしない。

### 10.2 受渡しの同一性と観測の鎖（新しい共通ABIではない）

最小の試験票は**固定された公開合成5 Card/2 Island/2 Edge/1 held + 出典2種 + 非開示の対照**を使い、製品ごとの既存Receipt/記録を参照する。次の識別対象を**別の列**にする。

| 確認地点 | 最小観測 | その地点だけで主張できないこと |
| --- | --- | --- |
| **SUI選択** | 元DocumentのIdentityと実Read/Selection・公開チャネル/Constraint/SafeMode・可視範囲・現在のhold/review | 同じ見た目/同じprojection hash=元構造/元Source同一、全Card取得 |
| **SUI投影** | 載せたClaim/Cardの対応・投影Profile/投影bytes・失ったTree/Island/Affiliation/Edge/座標/異論と、原資料の実照合有無（§9の説明用L0/L1/L2） | 未取得Sourceを自動で`sources`/脚注へ補完、`status:stable`や`verified`を自動受理 |
| **SHO Reader** | 受信した実Markdown bytes/実Parser版・抽出したLink/Footnoteの範囲/BOM・unresolved候補の未評価・Source span | Readerで文法解析できた=Raw Save/Restart・URL dereference・全Link網羅 |
| **SHO Writer（将来）** | dirty buffer基準版と実保存disk bytes、再open後bytes、外部資産や相対Pathの解決状態を別照合 | 保存成功=元SUIに対する意味同値・文書固定納品・外部Recipientで表示確認 |
| **SEI Consumer（将来）** | 実受信のConcept/Claim別Source ID・元Revision/Unknown/Conflict/Loss、問い・用途・時点・可視範囲 | OKF Conformance/Source脚注だけで独立根拠・全件性・正式Decision/現Authorityを宣言 |
| **TAI/Harness（後続）** | 実Tool/Skill Load/Session/OS隔離/許可された出力、独立Expectedの非露出、各製品の必要Witness | 1製品のCI/Harness成功=横断Handoff成功、Skill文書だけ=実接続、実行Receipt=現在のGrant |

**判定結果は積ではなく、用途別の必要条件の充足関係**として提示する。文書/出典へのアクセス許可は再配布先の開示を意味しない。暗号学的な証明、新しい永続Ledger、第二Semantic Store、OKF独自Execution Hostは作らない。

### 10.3 One-source → One-claim の出典帰属と、同時変更の反例

1. 5 CardのうちC1とC2が同一原典A（その転載Bでは独立性なし）、C3は別原典D、C4は未解決参照、C5はheldの合成例を使う。安全な出力は、**説明可能なCard/Claimだけ**を文書に載せ、原資料A/Dについて実取得・位置/版照合できたものだけに正規の`sources[].id`/脚注を付ける。C4/C5を削除して『未決なし』とは宣言しない。未公開C5のIDや件数を出すことが禁じられたチャネルでは、未決の詳しい理由も開示しない。公開可能な未評価範囲は用語上区別する。
2. **TOCTOU（読取後の変更）**：SUI選択R0→投影生成→C1の出典RefまたはC2のIsland所属/holdだけがR1へ変更→SHO編集→保存という順にする。元のdocument/read snapshot、投影とSHO Writer保存時点を混同せず、R0の出典が現在のR1でも同じと自動表示しない。文書自体のByte一致とSource/Meaningの現在性は独立に扱う。
3. **無関係な変更**：キャンバスの座標のみ変更し原典A/元Claimを変えない場合、出典全件を再読する必要があるとは断定しない。ただし空間的な「枝の収束」という仮説は別の検証対象。依存のないカードのSource変更では、他CardのReviewを一括失効させない。
4. **出典への誘導**：`sources[].resource`やSHO文書内のLinkは説明データであり、Scope Descriptor・外部URI・未信頼URLかもしれない。自動Fetch/Plugin起動/Egressを行わず、必要時の実Resolverと現在のDisclosure/許可を検査する。

### 10.4 最小実証順と修了条件

- **P0（現時点の実行可能範囲）**：既存SUI公開投影から、可視カード/hold状態/部分構造を実Readする最小対象を固定し、**元原典が未取得であることを明記したMarkdown草稿**をオフラインで組み立てる。OKF形式とするなら`type`は付けてもよいが、`sources`/出典脚注/`verified`を捏造しない。既存SUI SU-OKF01/08/10、SU-SH01/03を利用し、生成器とExpectedを独立にする。
- **P1（SHO Readerの限定適合）**：実生成Markdownを固定SHO G1b候補でread-only解析し、raw bytes/BOM/link認識範囲/未解決Reference被覆の欠落を示す。**SHO PR #17の既存16/16 CIはこのP1の実試験ではない**。外部URL到達・Writer Saveは主張しない。
- **P2（Product Authoring／意味Loss）**：SHOの正式Writer G2が成立した後に保存→再読取を試し、SEIにはread-only Inquiry候補として引き渡す。SEI #820 KO-01/02/10/14、SHO #4 FR-09/10/11、SUI #3391 SU-SH01/05/14を同じfixtureで採点。元SUIへの自動Patch/SEI Decision/TEI Meaningの昇格はしない。
- **P3（横断Harness）**：TAI #168の実隔離が確保された別Groupで、Tool-onlyとProduct Skillありの差を比較。Skillの実Loader/参照内容、独立Expected保全、Egress、再配布権限を確かめる。既存の正式H2/H3 4Session比較をOKF統合のために変更しない。

**P0合格の必要条件**は「許可された投影の実Readと内容の一致」「出典未取得が明示される」「held/非公開が無断で説明文に変換されない」「失われた構造と未評価範囲を表示できる」「独立Expectedに対する正負対照」であり、Markdownが綺麗に表示されることだけでは不足。現時点で**P0〜P3は全て NOT RUN**。固定fixtureは既存SU-OKF/SU-SH/SEI KO/SHO FRから共用し、新試験Gateを増やさない。

### 10.5 Ownerと採用の境界

本§10はSUIの次のRead-only Producer/Sourceの観測要件と、他製品へ出すClaimの上限の明確化のみ。SHO G1b/G2のReader/WriterはSHO #4/#16、SEIのExact Binding/Inquiry adequacyはSEI #820/#767、TAIのH2/H3実Tool・Skill比較はTAI #168/#488、TEI意味・計算契約は既存Ownerのまま。SUIが出した自然な解説・OKF `verified`・SHOの保存と、実意味受理/権限行使を互換な出来事として扱わない。


---

<!-- 20261107-sui-okf-typed-structure-vs-expression-inverse -->
## 11. SUIの多層トポロジーとOKF表現は非同型の写像として扱う（2026-11-07／横断・未採用）

### 11.1 TEI標準構造／表現型／Function／Rendererの区別をSUIの交換に翻訳する

[TEI #2497](https://github.com/hat47x/tei-platform/issues/2497)（構造保存写像・Loss・編集逆写像）、[#2507](https://github.com/hat47x/tei-platform/issues/2507)（標準構造と標準表現型・Function Data Context/Actionの分離）で成熟した境界を、SUI内の実装依存ではなく**任意の交換時の比較規則**として活用する。

- **元の意味・データ構造**：Card identity、Card本文、Review/Hold/Critique、Tree親子・順序、Islandの表示上の包含、Affiliationの意味所属、Edgeの種別・向き・多重性、Canvas上の座標などは別軸。Hybrid Treeや多層revisionは未実装の候補であり、現DocumentV1へ既にあると主張しない。
- **用途・Functionの文脈**：自由KJ整理、原出典調査、文章化、配置比較、編集/受理で、必要な対象集合とGrain、失ってよい軸、取得完備性、現在版、Owner/Disclosureをそれぞれ決める。可視のCard集合が同一でも、判断の前提が同じとは限らない。
- **表現とRenderer**：Canvas・Island・将来Tree/MindMap・SHO Markdownの見出し・OKF Concept/脚注は異なる表示・交換面。表現型の定義が再利用できても、Function内Instance・操作・認可・逆書戻しは製品ごとに別。SUIの内部RendererをTEIに置き換えることは本件の条件にしない。
- **逆写像**：文章・見出し・位置を編集しても、元のIsland/Tree/Edgeを変更したとはみなさない。対象Identity/Relation kind/Occurrenceと現Source Revisionが一意で、明示された意図・レビュー・Write Grant・独立再読取が成立した場合に限り、既存Productの操作候補として検討する。現OKF→SUI自動Patchは**非目標**。

### 11.2 保存軸とLossの実際

| 元の構造軸 | SUI現Agent Projection | OKF/SHO文書の表現候補 | 表示から復元・保証できないこと |
| --- | --- | --- | --- |
| Cardと本文 | review/SafeMode/Constraintで部分取得 | 段落/箇条書き | 同文面＝同Card ID/Source/Revision |
| Tree親子・順序（将来） | Treeは現Projectionに未収録 | 見出し/インデント | 元の親子順序・複数Tree |
| Island視覚包含 | cardIds/parentは未収録 | 島名の見出しや叙述 | Island＝Tree親＝Affiliation |
| 意味Edge / Affiliation | 一部Relationだけ。Affiliationは既存共有方針でomit | 無型リンク/脚注 | Relation種別・方向・多重性・承認 |
| Canvas座標/MindMap配置 | 現Projectionに未収録 | 原則省略 | 2D近接・交差・配置の生成経緯 |
| Hold/異論/Review | Holdは一部可視、実Review履歴は別 | 未決/注記（許可済範囲） | 文書の流暢さ＝異論解消、OKF verified＝現在Review |

OKFの普通のMarkdownリンクは型付きGraph Relationを自動的に表現しない。SUIのIsland上に表示されることとAffiliationが宣言されたことも異なる。TEI標準表現型を利用する場合も、表示の対応可能性／忠実度とFunction Operation/認可/効果資格を別に判定する。

### 11.3 既存Fixtureに重ねる高判別力の反例（新Gate/Case IDなし）

[#3392](https://github.com/hat47x/sui-sensemaking/issues/3392) SU-OKF03/04/05/10、[#3391](https://github.com/hat47x/sui-sensemaking/issues/3391) SU-SH12/14/15、[TEI #2497](https://github.com/hat47x/tei-platform/issues/2497)のProjection比較を、§10と同じ合成5Card/2Island/2Edge・別Tree枝（Treeは概念上のfixture）に適用する。

1. **非単射**：World Aでは別Tree枝の2 Cardが同一Island、World Bでは異なるIsland。両者が同じMarkdown見出し・本文を生成し得る。OKF Conformanceも文書byteも一致するが、元Worldは同一と判定できず、元構造への自動逆写像は0件。
2. **同一Data・別View**：同じ原Card/EdgeをCanvas・将来Tree・SHO箇条書きとして表示。View切替だけでは元Source/Review/意味Relation/Owner判断への書込みは0件。ただし実Read未取得なら「0件成功」へ昇格しない。
3. **編集曖昧性**：Markdown見出しの移動や一つのCardの2か所引用を元Canvas/Islandの所属操作へ変換するのは多義的。明示的な対象/版/関係種別がなければPatch適用0件、別Draft/Review候補として戻す。
4. **履歴と失効**：OKF generatedの時刻が新しくてもSUIの元Review/Sourceは別時点。原資料の変更・配置だけの変更・Review撤回で再評価する対象を分け、A→B→Aで以前の意味受理を自動復活させない。
5. **非開示の別World**：表示本文が同じでも内部の秘密Card/Edge/所属が異なり得る。元の完全性は宣言できず、Loss診断と外部OKF index/脚注へ秘密ID/数/URIを再掲しない。現Projectionで見えるCountと二次公開許可は別。

**最小の実証上限**：SUIが実際に公開可能な部分をread-onlyで文書化し、出典/Relation/Reviewを捏造せず、目的別Lossを明示、逆書戻し0件を独立Expectedで確認するところまで。正式なTEI標準表現型、SUI Hybrid Tree、OKF Exporter、逆写像Editor、SHO Writer→SEI Consumerの実E2Eは**NOT RUN**。

### 11.4 既存コードの証拠と横断Harnessの現在資格

現SUIの context_bundle_projection.test.ts には、updatedAt固定時のholdStateだけの変更、Island所属だけの変更、座標変更などで既存Hash/digestが何を表すかのテストが**既に存在**する。これらを新規テストとして二重実装しない。次に追加すべき独立検証は、構造からの表現Lossと**非単射な表現からの曖昧な逆書戻しを拒否すること**。

[TAI #168](https://github.com/hat47x/tai-pleroma/issues/168)の実H2/H3経緯は[TAI Draft #270のRunbook §24.5](https://github.com/hat47x/tai-pleroma/blob/docs/yi-harness-skills-20261102/docs/yi-constellation/first-real-skill-qualification-runbook-2026-11-02.md)。H3-A/H3-BでTEI Product Skill本文5,482 bytesと参照を実Toolで読み取った事実は限定成立。一方、OS隔離/事前割付/Tool許可条件/独立Expected・正答採点が未成立で、比較適格は**0/4**。旧H3未実行の記述は歴史状態であり現在の実Loadを否定しない。SUI Product Skillの実Load/OKF横断資格には転用しない。最初の外部Harness試験に新Blocking Gateは増やさない。


---

<!-- 20261107-sui-okf-test-only-noninjectivity-witness -->
## 12. 実Projectionの非単射を確認する最小実装試験（2026-11-07）

[独立test-only Draft #3396](https://github.com/hat47x/sui-sensemaking/pull/3396) は、現mainの実 `buildContextProjection()` を呼ぶVitestの3対照を追加。新OKF Exporter／SUI逆Patch API／共有Data Store／第二Converterを実装しない。

| 検証（既存SU-OKF/SU-SHへ接続） | 二つの元Worldの差分 | 独立Expected／主張の上限 |
| --- | --- | --- |
| **Source Identity**：SU-OKF01/03 | c1の原資料参照 `meta.source` のみ A→C。レビュー済み本文と更新日時は固定 | Original attributionは異なるが、**公開Projection全体は等しい**。そこから原資料脚注を自動補完しない |
| **Island／Canvas Structure**：SU-OKF03/04、SU-SH12/14 | 2 Islandの `cardIds` を組替え、c1の位置だけ移動。タイトル・本文と公開Revisionは同じ | Island所属／座標は異なるが、**公開Projection全体は等しい**。文書の見出しやHashで元の所属を確定・書戻しできない |
| **Positive control** | 公開可能なCard本文とreview済みIsland題名を変更 | 投影全体・対応digest・bundleHashは変化する。常に『同じ』を返す偽の検証ではない |

**テスト境界**：この3件で証明できるのは『今の公開投影がSource attribution/Island構造に対して非単射である』という実観測のみ。Treeは現行Product型で実装されておらず、Markdown/OKF実変換やSHO/SEI連携の完成、逆Patchが安全に拒否されたこと、独立原典Reader／Owner受理を証明するものではない。

**次の受入順**：まず#3396の固定HEADでVitest/TypeScript/CI結果を確認し、その証拠を既存SU-OKF03/04／SU-SH12/14へ限定対応付ける。次いで[TEI表現同期Draft #3222](https://github.com/hat47x/tei-platform/pull/3222)の Subject occurrence／Relation occurrence／Result grain／Representation occurrence／Selection epoch を参照し、SUIのCard ID・Island membership・文書中の引用Occurrenceを区別した**明示的な戻り先選択**を検討する。選択/焦点/位置変更だけでDomain編集を発火しない。TEI #3222もDraftであり、既存SUI Runtimeへの正式仕様追加とはしない。

**実観測（固定HEAD）**：[SUI test-only Draft #3396](https://github.com/hat47x/sui-sensemaking/pull/3396) の HEAD `a7893f9c4114d140dc19c7ff2f565693c5b1b29b` について、[SUI単体検証CI #42345896949](https://github.com/hat47x/sui-sensemaking/actions/runs/42345896949) は `completed/success`。`frontend-unit`の実ログに本新規テストファイル **3/3 PASS** があり、suite全体は278 files／1867 tests PASS。これは元World→公開Projectionの**非単射という限定命題の実証**であり、TypeScriptの現在テストでOKF書出し・原典実Read・逆Patchの拒否・SHO/SEI実受領・Owner Meaning受理まで確認したわけではない。[MCP/agent認証回帰 #42345897113](https://github.com/hat47x/sui-sensemaking/actions/runs/42345897113)も同HEADでcompleted/success、両workflowの全7ジョブを確認。ただしこれは既存製品の回帰資格であり、OKF/SHO/SEI横断機能が存在・採用されたという意味ではない。SUI→SHO→SEI/OKF実E2E、逆Patch、TEI共通表現の正式採用は **NOT RUN**。本#3393は引き続きdocs-only Draft、実テストは別PRに分離。

---

<!-- 20261107-sui-markdown-draft-product-limited-p0 -->
## 13. 公開投影から「出典未検証の通常Markdown草稿」を作るP0（2026-11-07／実装候補）

### 13.1 同一性よりも許された叙述の範囲を優先

[実験Draft #3397](https://github.com/hat47x/sui-sensemaking/pull/3397)で、現SUIの実 `buildContextProjection()` 出力だけを入力として、**外部再配布や書戻しを行わない純粋なread-only関数** `renderReadOnlyMarkdownDraft` を用意した。常設Exporter/正式製品UIやOKF Conceptの採用ではない。独立した[非単射実証 #3396](https://github.com/hat47x/sui-sensemaking/pull/3396)は「出典・島所属が異なっても公開投影全体が等しい」という元の証拠であり、#3397はその不足を勝手に補わず**出力の上限を小さくする**候補。

- **入力**：`context-projection.v1`のうち、`safeMode=false`かつ`card.reviewed===true`、`redacted===false`、公開本文digestあり、`holdState===null`のカード本文。これは**本関数の安全側の選択条件**であり、全SUIデータの真偽・元資料許可ではない。
- **出力**：カードIDや元 `meta.source`、Island/Cardの関係、未公開Count、`bundleHash`、出典らしいリンク・OKF `sources`/`verified`を付けない通常の`.md`草稿。Card.textをMarkdown引用ブロックとして**記法をエスケープ**し、未信頼の見出し・脚注・URLを外部の出典や構造関係へ昇格させない。
- **現在の取得範囲**：SafeMode ONまたは条件に合うCardなしなら、その**投影条件で本文として出せるものがない**とだけ表示する。元DocumentにCardが不存在・未決が0・出典が無いと断言しない。説明冒頭にもOriginal Sourceは未照合で、構造・意味の全件性を証明していない旨を示す。
- **権限**：既存Agent Projectionを読めることとMarkdownを新しいRecipientへ**再配布してよいことは別**。実験関数はStore/Clipboard/Network/Host Actionを呼ばず、配布先のDisclosure/Owner許可を追加で検証するまでは配布を実装しない。UIでのWriter/Exportボタンに直結しない。
- **文字忠実度**：Backslashの二重エスケープは元文字列を変え得るため、#3397では一度だけエスケープするよう修正し、文字忠実度の反例を追加。本文の原raw byteを文書へ移すという主張ではなく、Markdown Rendererが見せる文字を保つ**候補**として扱う。SHOが実Parserで表示/保存した結果とは別に評価する。

### 13.2 OKF・SHO・SEIの採用境界

| 達成できること | 達成したと誤認してはいけないこと |
| --- | --- |
| SUI可視・レビュー済み・非保留の本文をMarkdown草稿に選択的に移す | SUI元Card・Source/Island/Graph/Treeと同一の構造文書を作った |
| 本文内の `[title](url)`、`[^id]` 等を外部出典の記法にしない | Original Sourceが確認できた／不適切なURLを持つSourceをすべて検出した |
| 出力された通常MarkdownをSHO G1bで将来実Read可能な候補にする | `SHO Reader 0 link`＝元SUIや文書に必要な根拠が0件・Reference Complete |
| 出力関数自身は書込み・Network・逆Patchを呼ばない | 配布先Disclosureが許可済み、SHO G2 Writerが完成、元SUI逆書戻しが安全 |
| OKF Conceptへ今すぐ強制しない | OKFの`type`/`generated`/`verified`やSEIのDecisionとして自動Importできる |

**SHOの現状に注意**：[SHO Draft #17](https://github.com/hat47x/sho-composer/pull/17)は**Closed/Unmerged**になっている。一方、2026-11-07時点のSHO `main`には `src/g1b-reader.cjs` と `bin/sho-inspect.cjs` があり、双方のblob SHAは#17 HEAD `4113040f...`と一致する。つまり「PRが未mergeだからReaderがmainに無い」も「ReaderコードがmainにあるからOwner正式受理が済んだ」も誤り。G1bは`markdown-it` 14.3.3、`link_open`を中心にした限定Parserで、未解決Reference/Markdown全出典の完全列挙・G2 Writerや通常文書の実保存を証明しない。特殊File/FIFOのOpen前ブロック問題はSHO #16 R17-03へ残す。

**SEIの根拠ループ**：最近の[SEI #794](https://github.com/hat47x/sei-cognition/issues/794)にある「Decision自身をbasisにする」「存在を根拠として数える」という反例は、SUI草稿が自分自身を出典脚注とし、SHO→SEIで独立根拠に化ける問題の同類。文書生成・Parserの受領・同じConceptの`verified`だけでは独立Sourceが増えない。[SEI #752](https://github.com/hat47x/sei-cognition/issues/752)のRecommendation根拠非表示も、未表示と不存在を区別する例として共用する。両IssueはClosedだが、**修正済みの実CLI動作は未再確認**なので解消済みと誤判定しない。

### 13.3 既存Expectedへの接続と次の修了条件

- **現時点の限定証拠**：[SUI Draft #3397](https://github.com/hat47x/sui-sensemaking/pull/3397)の最初の固定HEAD `38c319dd...`は公開投影→草稿4件PASS（旧CI #42351654854/#42351654714）。Backslash修正と新文字忠実度テストを加えた**現HEAD `aa3c31fa42c4e490a698cda7629d9d6bd2a74b9c`**では、[単体CI #42351852065](https://github.com/hat47x/sui-sensemaking/actions/runs/42351852065)と[MCP/agent回帰 #42351852202](https://github.com/hat47x/sui-sensemaking/actions/runs/42351852202)が**共にcompleted/success（全7 Job）**。frontend-unit実ログの新5/5 PASS、全278ファイル/1,869テストPASSを確認。これはP0の関数単体と既存回帰に限定し、SHO実受領と再配布権限は未証明。
- **次のProduct P0**：同一合成5Card／2Island／2Edge／1Heldを使い、公開本文のみを出す。出典未取得、Card/Island/Edge ID非出力、SafeMode/保留による非開示、偽Markdown Link/Footnote抑止、元Source/Island変更で草稿は同じ、公開本文変更で草稿は変わる、文字忠実度という**既存SU-OKF01/03/08/10・SU-SH01/05/12/14**へ接続。新しい中央Gateや独立SSOTは増やさない。
- **次のConsumer P1**：実SUI生成byte（改版と出力時点をPin）を、実SHO main `sho-inspect`で**独立した同一ファイル**としてRead。G1bの限定`link_open`数とRaw SHA/BOM/Parse Profileを観測し、未解決Sourceが無い・原資料の正しさ・出典の完全性とは結論しない。保存・再OpenはSHO #4/G2が成立してから別試験。AI/Plugin/TEI不可でも手動文書作成は妨げない。
- **意味とAction P2**：SEI #820/#767の問い相対のSource/Unknown/自他参照、TEI #2497/#2507/#3236の合成写像とSelection/Operation分離へ引渡し。Cardが二回引用されても同じCard Identity/元Relationは自動操作しない。OKFの`verified`・SHO Reader PASS・文字表現の一致からOwner受理/Host Grant/実書戻しへ昇格しない。

**採用状態**：#3397はDraftのtest/opt-in関数のみ。実SUI UI接続／SHO main Readerによる実草稿Read／G2 Writer／SEI Inquiry／OKF Conformance・原典Reader／SUI逆Patch／外部Harness実資格は未実証。本§13自体も提案であり、SUI/SHO/SEI/TEIのOwner既存責務を変更しない。

---

<!-- 20261107-sho-raw-byte-handoff-p0-bridge -->
## 14. SUI Producer実バイト→SHO実Readerに向けた固定引渡し試験（2026-11-07）

### 14.1 同じ合成Raw原文を別製品の既存Readerで検査する

**SUI Producerの実証**：[SUI Draft #3397](https://github.com/hat47x/sui-sensemaking/pull/3397) HEAD `72fd41fa5ab4b7685e07705be72f16b4d1c7cedf`で、実`buildContextProjection`→`renderReadOnlyMarkdownDraft` の一往復を追加。5 Card（公開/非保留2、非公開/保留3）・2 Island・2 EdgeのSynthetic Documentから、以下の独立手書き期待原文と**byte一致**を確認した。

- **原文**：UTF-8、354 bytes、SHA-256 `7fd6fde2fbc4d9beaf9de14e8b8f4f5d70003cd2129f1502cdd7c73f50c171cd`。
- **内容**：公開本文の二つの引用ブロック、Literal Backslash、偽Markdown見出し・Link・Footnoteをエスケープ。Original `meta.source`、Island/Edge、hidden ID/count、未レビュー・保留本文、`sources/verified`の補完なし。
- **実CI**：[SUI単体 #42352776477](https://github.com/hat47x/sui-sensemaking/actions/runs/42352776477)はcompleted/success、当該新試験 **1/1 PASS** と既存草稿5/5 PASS、全279ファイル／1,870テストPASS。SUI ProductがSHO/SEI/OKFに送信したことは未証明。

**SHO Consumerの独立候補**：[SHO test-only Draft #21](https://github.com/hat47x/sho-composer/pull/21)は、SHO `main`の既存`inspectRaw`に、SUIの期待bytesをコピーした**固定Synthetic .md Fixture**（上記354 bytes/hash）を実ファイルとして入力する試験を追加。正例/負例で以下を区別する。

| 観測地点 | Independent Expected | 責任・許されるClaim |
| --- | --- | --- |
| SUI real Producer | Raw bytes/shaが独立Expectedと一致、hidden Source/Island/Count/heldを補わない | 公開Projectionから普通のMarkdown草稿を決定的生成できた |
| SHO actual Reader候補 | 354 bytes/sha維持、原文非変更、Parser `markdown-it 14.3.3`、`link_open=0`、`coverage.allDocumentReferencesEnumerated=false`、`unresolvedReferenceCandidatesEvaluated=false`、`externalSourcesAcquired=false`、`source.revision=unknown` | 与えられたRaw文書を**限定されたGrammar Scope**で読んだ。出典0件/全件/真正性は証明しない |
| SHO unsafe-mutant対照 | 文書中の偽リンクのEscapeだけ解除→Readerの`link_open=1`（出典URIは依然未照合） | 単にすべてのリンクを無視するReaderではない |
| 独立Source検査（将来） | 原Sourceの実許可Read、Card Claim/Original Occurrence/Revision、時点/公開Scope、別Sourceの独立性 | SUI Draftの文章からは推論できずSEI/SHO/TEI各Ownerへ |
| Writer／Host／YIC（将来） | Raw bytesを実保存・再Open、Recipient開示許可、Tool実Load/OS隔離、必要に応じ実Provider独立Read | Reader単独やSHA一致ではWriter・Owner意味受理・Host Effectを証明しない |

**CIの状態**：SUI Producerは上記固定HEAD実CIで成立。SHO #21は新規Draftであり、**独立したSHO Actionsの実結果をまだ確認できていない**。固定Fixtureと2ケースを書いた事実をSHO Product PASSにしない。既存[SHO #16](https://github.com/hat47x/sho-composer/issues/16)のread-only G1b Scope、未定義参照候補未評価、POSIX FIFO Open前停止の受入未了は引き続き優先。Reader部分の選択だけでSource/Witness/Current Grantを拡張しない。

### 14.2 他チャットの判断との一致

- **TEI Draft #3236／#2497**：合成Projection `Q(P(World))` は、Pで失った`meta.source`／Island関係をQが自動復元できない。実バイト一致はRepresentation同一の限定証拠。逆Write対象・Relation Occurrence・Owner意味/Authorityは別のSource/Target条件で再資格化。
- **SEI #820/#767**：出典風の本文をEscapeしてReaderリンク0にしても、独立一次資料0件とは言えない。同じSUI由来のConceptやDecision自身をbasisに数えない（SEI #794）。Resumeで見えない根拠は不存在と断定しない（SEI #752）。未取得/未開示/真に空を別に扱う。
- **SHO #18/#4/#16**：文書の生成原文、Reader構文索引、Editor dirty buffer、disk保存/再Open、相対Reference解決、元Source/Occurrence Revisionは別々の観測。将来Editorが重複引用の一つを編集しても、元SUI Card/Island/EdgeへのPatchは発生させない。
- **TAI #168/#271**：Productが既に生成した原文を独立Consumerが読めたことと、外部HarnessでSkill効果・現在Grant・OS read隔離を観測できたことは別。最初のH2/H3固定Trialに今回のP0を新Blockingで加えない。

### 14.3 最小Exit

1. **SUI byte Producer**：完了（#3397の固定HEAD単体CI、新1/1）。過去のSUI公開Projectionの非単射の負例#3396（3/3）と独立に保持。
2. **SHO Parser**：#21をSHO CIの実HEAD・Node版・実logで確認。あえて `link_open=0`のScope限定判定と、Escape解除で`link_open=1`の対照を保持。Readerが成功しても0 Sourceという断定をしない。
3. **実ファイルの引渡し**：SUI Runtimeが実生成して保存した**同一Raw bytes**をSHO実CLIへ受け渡し、ファイル所在/実Read/Source SHA・OS/Parser profileを別途確認。今回の二つのrepoに同一Fixtureを置いた結果はこの手順の代替ではない。
4. **SHO G2／SEI**：Writerが成立した後にsave→reopenし、SEIが用途別にSource/Claim/Unknownを問い直す。Owner/Recipient可視性の確認なく勝手に公開・逆Patchしない。

**追加実装の上限**：SUIには小さなread-only草稿Emitterと固定byteテスト、SHOには既存Readerのfixture/テストだけ。新中央Schema/二重Reader/第二Writer/Host/Metadata DBを設置せず、既存SU-OKF03/08/10・SU-SH01/12/14・KO-01/02/10/15・SHO FR-09/10/11を同じデータで参照する。現時点ではSUI↔SHO自動E2E、OKF Conformance/実出典Read、SHO Writer/SEI Native Import、OS Egress・Owner受理はNOT RUN。

---
<!-- sui-20261107-sho-crossos-rawbytes-qualified -->
## 15. 固定Rawを介したSUI Producer→SHO Reader検証の証拠と、次の製品受渡し（2026-11-07）

### 15.1 同一Fixture・別Productを区別した実測

- **P0 SUI Producer**：[SUI Draft #3397](https://github.com/hat47x/sui-sensemaking/pull/3397) HEAD `72fd41fa5ab4b7685e07705be72f16b4d1c7cedf`、[SUI単体CI #42352776477](https://github.com/hat47x/sui-sensemaking/actions/runs/42352776477)で実`buildContextProjection`→`renderReadOnlyMarkdownDraft`が**公開合成2 Cardの354 UTF-8 bytes**を作り、独立手書きExpected SHA-256 `7fd6fde2fbc4d9beaf9de14e8b8f4f5d70003cd2129f1502cdd7c73f50c171cd`と一致。元Cardの出典/島/非公開/hold/ID/Edgeは出力しない。
- **P1 SHO Reader**：[SHO Draft #21](https://github.com/hat47x/sho-composer/pull/21)の同一Raw合成Fixtureを`main`由来の既存`inspectRaw`で構文解析。初回[CI #42353536878](https://github.com/hat47x/sho-composer/actions/runs/42353536878)はUbuntu18/18 PASS、Windows17/18 FAIL。Windows CheckoutによるLF→CRLFで`354→368 bytes`となり、**パーサーや表示は動いてもRaw Witnessは不一致**。この赤は期待検証の実際の判別能力を示す。
- **修正後**：[SHO PR #21](https://github.com/hat47x/sho-composer/pull/21) HEAD `720ee05765e1d110e03acb0223dac34023c58612`で、**合成Fixtureだけ**`.gitattributes`に`text eol=lf`を指定。[SHO CI #42353651398](https://github.com/hat47x/sho-composer/actions/runs/42353651398)のUbuntu/Windowsの実Job logはともに**18/18 PASS（各0失敗）**。SHA/Raw bytes維持、実`markdown-it 14.3.3`限定`link_open=0`、Escape解除したmutantは`link_open=1`。著者が保存するMarkdownをLFに自動変換する製品仕様ではない。

### 15.2 知識を失わせない受渡しの最小Witness（新ABIでない）

| 観測 | 取得済みの保証 | なおUnknownのもの |
| --- | --- | --- |
| SUI公開ProjectionのProducer・固定bytes | 出力された公開可能なCard本文、合成Fixtureの生成バイト/期待SHA | Hidden Card/Island/Edgeの完全性、原`meta.source`の真偽、元DocのRevision/Disclosure、実Runtimeの現在性 |
| OSのcheckoutとSHO Reader | 実checkout先のRaw bytes/SHA、Parser実版、固定Grammarでの認識Link数、出力coverage | 対象ファイルの実Author Revisionや文書内全Reference（Readerは`unresolvedReferenceCandidatesEvaluated=false`）、実原資料取得 |
| Markdownの保守・逆編集（後続） | いまはraw保存Writer未実行、元SUIへのEdit不在 | dirty buffer/disk/旧Index/Source R0→R1競合、逆Patch一意性/Host Grant/実Effect |
| SEI/TEI/TAI再利用（後続） | 固定合成文書の読取を次の観測候補として渡せる | SEI問い相対Adequacy/Decision、TEI意味受理、TAI Skill比較、実外部Recipientへの二次配布許可 |

**合成Fixtureの2つのリポジトリにある原文が同じことは、1つの実SUIプロセスがSHOプロセスへ同一ファイルを送信した証拠ではない**。今後の実HandoffではProducerの実出力ファイル／実Source Context／独立Consumerが開いた同一ファイルPathとByteを逐次観測し、OS変換、転送、Buffer→Diskの競合を別に記録する。Product固有Reader/Writer/Hostを新設しない。

### 15.3 他の認知・意味・実行契約との接続

- **SEI**：[SEI PR #822](https://github.com/hat47x/sei-cognition/pull/822)は`merged`、CLI自己参照basis拒否とResumeの根拠表示等を統合。これは**SEIのCLI入力/表示の限定改善**。SHO文書が自身やSUIのコピーを独立根拠として数えることや、SEI OKF Import/問い相対Adequacyが解決したとは限らない。原Source未取得なら`insufficient-evidence`を維持。
- **TEI**：#2497／[Draft #3236](https://github.com/hat47x/tei-platform/pull/3236)の`P:Data→View`, `Q:View→Consumer`をSUI/SHOに適用。Pで元Source/Island所属を落とせばQが原情報を回復できない。Rawバイトの再現性成功は、元構造の一意な逆写像や更新Intent/Effect資格を与えない。
- **TAI/EKI**：OS実Reader成功とHostの実Grant・Skill価値は別。EKIの[PR #783](https://github.com/hat47x/eki-fabric/pull/783)（merged）による`--version`の実VCS revision表示は、未知版を`unknown`とする正直な実行版観測の参考だが、SUI→SHOの実Transport/Source Revision/OS隔離を代替しない。

**次の最小Exit**：既存合成Fixtureの実SUI Producerが作成した**その一つのRawファイル**を、許可済みのSHO実CLIへ明示的に渡し、同一Source bytes/実Parser結果/対象Scope/外部への出力ゼロを観測する。その後SHO G2 WriterとSEIによる根拠未確認の保持を別試験。最初のOS赤/緑とOwner未受理は併記し、旧SUI計画§14の『SHO新CI未確認』は**作成当時の履歴**として扱う。本§15の実績はP0/P1固定Fixture相互運用だけ。正式OKF Concept・自動転送・Writer・Import・Source真正性は**NOT RUN**。

---
<!-- sui-20261107-live-local-onefile-handoff-executable -->
## 16. SUI実Producer→同一ディスクファイル→SHO実CLIの検証経路（2026-11-07）

### 16.1 今回準備した最小接続

- [SUI実験Draft #3397](https://github.com/hat47x/sui-sensemaking/pull/3397)：現行の実Projection→Markdownの合成テストに、**SUI_SHO_P0_OUTPUT**が明示された場合のみ、生成した354 UTF-8 bytesを新規の絶対Pathへ**wx（上書き禁止）**で保存し、直後に実ファイルを再Readする経路を追加。未指定なら書かない。通常UI/API/Writerは変更しない。
- [SHO実験Draft #21](https://github.com/hat47x/sho-composer/pull/21)：**SHO_SUI_P0_INPUT**が明示されたときだけ、その絶対Pathの実ファイルを既存SHO CLIへ渡すテストを追加。Raw SHA/354 bytes、実Parser14.3.3、Scope限定link0、参照完全列挙はfalse、原文のmtime・bytes不変を確認。未指定では**テストSkip＝未実行**。Reader/Parser本体は変更しない。
- 操作は[SHO #21の実施Runbook](https://github.com/hat47x/sho-composer/blob/test/sui-p0-readonly-handoff-20261107/docs/sui-p0-same-file-handoff-trial-2026-11-07.md)に固定。両RepoのローカルCheckoutとNode22が必要。外部Token、ネットワーク転送、元Source自動取得、外部公開を実装しない。

### 16.2 同一ファイルと意味受理は別のWitness

| 観測地点 | 検証できること | 未解決のこと |
| --- | --- | --- |
| SUI Producer | 公開2 Card・非公開/heldの制限を保った354-byte生成、新規File書込とReadback | 元CardのSource、Island/Edge、全件性、現在Grantと原Doc Revision |
| 実Disk | **Producerが実生成した一つのファイル**をConsumerが実Readしたこと、Path・Raw SHA・OS改行 | 同じバイトから元Worldの同一性・原Source真正性やA→B→Aが証明されたこと |
| SHO CLI | 実Parser版、固定文書link0、coverageの未評価・Writer未呼出し、mtime不変 | 原資料0件・未定義Referenceなし・SHO G2 Writer完成 |
| SEI/TEI/TAI | 限定のRead事実を次の調査へ利用する候補 | 独立根拠数・Meaning/Owner受理・逆Patch/Host Grant・H2/H3適格性 |

**受入の負例**：Producerが既存ファイルに出力しようとすれば上書き拒否、SHO入力Path未指定ならSkip、LF→CRLFはRaw SHA不一致、SUI元SourceやIsland所属だけ異なるWorldは同一草稿を作り得る、SHO Parserのlink0は原資料なしの証明でない、配布先のDisclosureは別。既存SU-OKF03/08/10・SU-SH01/12/14・SEI KO-01/02/10/15・TEI #2497/#3236に接続し、新SSOTを設置しない。

### 16.3 結果の資格と次のExit

- **先行済**：SUI #3397の実Producer固定354-byte/期待SHA（[CI #42352776477](https://github.com/hat47x/sui-sensemaking/actions/runs/42352776477)）、SHO #21の同一合成FixtureのUbuntu/Windows各18/18（[CI #42353651398](https://github.com/hat47x/sho-composer/actions/runs/42353651398)）。これは**別Productで同じ固定原文をそれぞれ検査した**資格に限る。
- **今回のSUI変更の限定CI**：HEAD 0bc63b944c6f18e0fc8693bd05092ad031997c11、[単体CI #42370271882](https://github.com/hat47x/sui-sensemaking/actions/runs/42370271882)はcompleted/success、279 files/1,870 tests PASS（実frontend-unitログ）。ただし環境変数は**未指定**であり、実ディスクへ書き出した経路のPASSではない。
- **次の明示Trial**：SUI実コードが生成した**その一つのファイル**をSHO実CLIに絶対Pathで渡し、両コミット、Node/OS、書込/実読込Path・サイズ・SHA、Parser/Scope、無Writer・開示対象を記録。これが揃うまではLive One-file Handoffを**NOT RUN**とする。SHO G2 Editor/Writer、OKF正式束、SEI Native Decision、現在のSource/Owner/配布認可はさらに別受入。

**設計上の線引き**：SUI Data→公開Projectionが非単射で、公開Projection→通常Markdownも不可逆なのだから、同じFileを読めてもSource/Topologyは自動復元できない。既存Product Ownerを維持し、中央Ledger、別Reader/Writer、二重Meaning/Action Engineを作らない。

---

<!-- sui-20261107-one-command-local-actual-input-orchestrator -->
### 16.4 SUI/SHOの実ファイル試験を一回の操作に束ねる（2026-11-07追補）

[SHO試験Draft #21](https://github.com/hat47x/sho-composer/pull/21)に **test-only** `scripts/sui-sho-onefile-p0.cjs`を追加。[実施Runbook](https://github.com/hat47x/sho-composer/blob/test/sui-p0-readonly-handoff-20261107/docs/sui-p0-same-file-handoff-trial-2026-11-07.md)の手動2段階は残したまま、SHO checkoutから `node scripts/sui-sho-onefile-p0.cjs --sui-frontend <絶対SUI Frontend Path>`で、**SUIの実Vitest Producer→新しいPrivate一時ファイル→SHOの対象opt-in Reader実テスト→SHO実CLIの再Read**を逐次実行する候補。

- **元コード束縛**：両Repoの実Git HEADとtracked worktree cleanを検査する。別Subject/別版を混ぜたらこのAttemptの資格としない。SUI実依存（node_modules/Vitest）・Node22・SHO実markdown-it 14.3.3の存在を前提として、未導入なら明示的に失敗する。
- **実Consumer束縛**：SUIが実生成したその一つのFileについて、354 byte・独立Expected SHA `7fd6fde2fbc4d9beaf9de14e8b8f4f5d70003cd2129f1502cdd7c73f50c171cd`・通常File、SHOの**名前指定されたopt-in 1 Caseが非SkipでPASS**、実`sho-inspect`の結果と再Read原文を検証。SHO全テスト件数が将来増減しても、対象試験の成績だけを別に数える。異なる粒度のSuite PASSをActual Handoffへ転用しない。
- **証拠の表記**：成功時だけstdoutに両Git HEAD、Node/OS、実File PathとSHA・byte、実ParserとLink Scope、Original Sources未取得、Host Grant未検証、SHO Writer未呼出し、SEI Meaning未受理の**限定JSON Receipt**を表示。一時Fileは最後に削除。歴史的Pathを永続Source Locationと混同しない。ファイル変更の無い観測点は確認できるが、連続したOSレベルLock・TOCTOU不在は証明しない。
- **既存契約を優先**：これは別Host/共通Artifact Store/Source Registryや正式のSHO Writerでなく、**合成データを使った試験専用Runner**。SUI UI/SHO Writer/SEI Native Import/実OKF Concept/Author権限を変更しない。

**独立Expected**は既存SUI SU-OKF03/08/10、SU-SH01/12/14、TEI #2497/#3266の「実CLI出力と期待値を別比較」の原則、TAI #271の同一Attempt・同一Artifactに接続する。SEI #767/#820の問い相対十分性・独立Source/Current Authorityは本Receiptから推論しない。

**受入上限**：今回追加されたのはRunner、Runnerの明示起動拒否・構文の単体確認、Runbookと設計計画。GitHub CIでは別RepoのSUI checkoutを与えないため、**実一ファイルHandoffは依然NOT RUN**。通常CIでRunner引数ガードがPASSしても、その出力を実P1消費のPASSへ昇格させない。実Runの対象opt-in Case **1/1 PASS（非Skip）**と両実HEAD/Raw Receiptを観測して初めて、その一回のSynthetic Local Handoffを限定受理する。
