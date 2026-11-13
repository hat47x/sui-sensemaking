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

<!-- 20261107-one-command-ci-exact-head-19pass-1skip -->
**試験入口の最新固定CI**：[SHO Draft #21](https://github.com/hat47x/sho-composer/pull/21) HEAD `f5eeb9f537c0cf9d518139afed272e189b82fe1c` の[Actions #42374198180](https://github.com/hat47x/sho-composer/actions/runs/42374198180)はUbuntu/Windowsとも **19 PASS・0 FAIL・1 SKIP**（実Job log）。新しいRunner構文/省略・相対Path拒否は両OSでPASS。SKIPは**実同一ファイルのConsumer試験**であり、実HandoffのPass数は0。RunnerはSUI/SHO実HEAD・追跡ファイルclean・独立Expected Byte/SHA・対象のSHO実1 Case非Skip／実CLI再Readを要求し、JSON Receiptを**一時ファイル削除の確認後**にだけ出力する。Node 22の二Checkoutを本当に接続したReceiptは、現在 **NOT RUN**。
---

<!-- sui-item-canvas-crossview-20261108 -->
## 17. 未整理Item・複数Canvas・多重Roleの横断Pressure Case（2026-11-08／設計候補・未実装）

### 17.1 目的と採用境界

SUIをKJ法キャンバスとマインドマップを中心とする思考環境に保ちつつ、未整理の資料投入、同一情報の複数認知空間での使用、Tree/Group/Graph/時間/文章への投影をTEI標準データ構造・表現型の**異質Consumer試験**にする。一般的な情報中央統合・地図・PERT・外部Task同期などは**将来の拡張圧力**であり、SUIの一次価値（ADR-0089）や現Hybrid PoCのP0前提を拡大しない。KJのみ・手動・provider=none・オフラインでも、根拠、異論、保留へ戻れることを優先する。

この節は**論理モデルと反例・依存順**を定めるだけで、現行 `DocumentV1`、Semantic Artifact L0、OKF v0.2、標準TEI Role/Plugin、外部Task Providerの正式採用・実装・E2E PASSを主張しない。既存の計画Ownerは本計画、SUI #3391/#3392、TEI #2495/#2497/#2507/#2620、およびSHO/SEIの各Ownerに残す。第二Meaning Registry・第二Host/Policy Engine・新しい全機能統合DBを作らない。

### 17.2 分離する7つの論理概念（新Core型／新物理テーブルの宣言ではない）

| 概念 | 最小意味 | 他概念との禁止すべき混同 |
| --- | --- | --- |
| Subject | 安定して参照できる対象。Source occurrence、Semantic identity、Revisionは区別 | 原資料とその説明Item、同名・同byteの別情報を暗黙同一化しない |
| Item | 未解釈でも保管・直接閲覧できる情報単位 | 観測対象の人物・実Event・操作のEffectそのものではない |
| Content/Asset | 原文・バイナリ・URL等の実Resourceまたは参照 | URL保存＝実内容取得、hash一致＝現在性・真正性ではない |
| Structure | Treeの親子/順序、Groupの意味的所属、GraphのRelation、時間的依存等 | Islandの視覚的包含・Tree祖先・Affiliation・意味Edgeを同一視しない |
| Canvas/View | 視点・作業空間・表示範囲・局所配置 | CanvasはItemの正本所有者ではなく、Tree/Roleの第二正本でもない |
| Display Occurrence | Canvas/Tree等の一表示出現と位置・スタイル・表示固定版 | 実際のEvent occurrence、Item本体、Semantic Roleとの混同禁止 |
| Representation | Item/Island/Canvas/Relation等の文章・図解・画像表現、元Subject参照・来歴・Loss | B型の流暢さをMeaning/Sourceの受理、元構造への可逆編集資格としない |

`Document`は将来は文章成果物を指す用語候補とし、現行`DocumentV1`の名前／JSONを即時変更しない。正式命名では `Canvas` / `View` / `Item` / `Document` / `DisplayOccurrence` / 実Eventの `Occurrence` を峻別する。旧`DocumentV1`はカード本文と`x/y`、`Island.cardIds`等を含む**互換入出力の正本**であり、論理分解した新モデルへ移行済みとは扱わない。旧 `(documentId, cardId)` の一致・内容一致だけで新しい全域Item IDへ統合しない。

### 17.3 非整理・未読を正規の状態として認める

- Itemを作る時点で `title`、意味Role、要約、Tree所属、Canvas座標、Island、解析済本文、human reviewを要求しない。最小は**Identity＋保管できた情報への参照＋観測可能な取得・保存結果**。少なくとも原Contentを読める、あるいは外部参照が未取得・失効と診断できる。任意の `capturedAt` は実取得時刻／記録時刻を区別する。
- Inboxは未整理Itemを引ける**View候補**。未読（利用者相対）、未分類、未レビュー、Held、Shelved、旧資料、取得不能は別軸。既存`Card.holdState`・`Shelf`をInboxに読み替えない。未読でも分類済み、既読でも未分類を許容。
- 大容量テキスト/PDF/画像/音声/URLは、内容全量をカード化せずReader/Document/Media Viewで直接閲覧し、必要に応じて範囲付きItemを抽出する。原Itemを破壊せず、抽出の元Source・span・version・Transformation・Coverageを可能な範囲で保持する。URLのみ／原bytesキャッシュあり／解析済み／外部取得不可は別状態。
- インポートデータの中の「命令」は資料であり、TEI Action実行の根拠ではない。ローカル閲覧と外部AI送信・二次配布は別Grant/Disclosure。SafeModeを緩めず、未解析・部分取得・未開示を不存在扱いしない。

### 17.4 多重構造と複数Canvasへの分割・共有

- 同じItem（あるいは別Subject参照）をCanvas A/Bに**別DisplayOccurrence**として表示でき、座標・縮尺・固定・局所注記は独立。両Canvasから同じ**現在版**へ参照する場合だけ本文更新を共有する。指定Revisionを固定した表示は明示的な古いSnapshotとして扱う。
- Canvasから表示を外してもItem・他Canvas・Relationを消さない。同じItemを一Canvasで二度出すことも許容。Island可視包含、Group Membership、Affiliation、Tree Parent、Semantic Edge、Canvas→Canvas Linkをそれぞれ独立に保持する。Group/Canvasを必ず単一Treeへ押し込まない。幾何学的入れ子と意味的包含の推定変換はしない。
- 分割操作候補は `extract`（部分集合を新Canvasへ）、`share`（両方へ表示）、`move-occurrences`（表示だけを移動）、`link-canvas`（関連参照）、`merge-view`（表示構成の統合）を区別する。意味を持つカード本文・Group所属・Reviewを副作用で変更しない。元Canvasには代表島・他Canvasへの入口を残せる。
- Canvas MapはCanvas群と横断Relationの読み取りProjection候補。境界を越えるRelationを削除・自動再結線せず、対象が隠されている場合の線・件数・集約ラベルによる漏えいを拒否する。閲覧できるCanvasだけでItem/Relationの閲覧権限が成立したとみなさない。
- 分割／AI整形／部分復元は既存HC-09〜15・C5〜C7に従い、base/currentの**readSetとwriteSet**、関係依存、選択範囲、版、権限を照合するProposal→Preview→明示Apply→一回Undo単位。配置の自動Fit/LODは意味と配置意図の自動上書きを許さない。

### 17.5 Task/Action/Eventは単一itemType列挙ではなくRole候補

- Itemは情報保持単位。Task（予定作業）、Activity（活動）、Action（意図/操作）、Event（発生事項）、Question、Hypothesis、Observation、Decision等は**拡張可能な意味Role候補**であり、排他的な巨大enumにしない。一方、実Task・発生Event・実Execution/Receipt・それらを説明するItemは、それぞれ独立Identity/時点/Authorityを必要とし得る。
- Roleは「何として扱うか」、Traitは「どの型付き能力/実装義務を満たすか」を記述する候補。Role文字列の自己宣言からMeaning/実装/Host実行資格へ昇格しない。共通Role Resolver、新DSL/型階層の採用をこのSUI計画から要求しない（TEI #2495/#2620）。
- PERTはTask/Dependency/Duration/Calendar/Resourceに意味が揃う場合のProjection。KJ島・Cardの存在だけからTaskを推定・登録しない。Task管理連携はPERTを必須にせず、外部Issue/Planner等へは標準Providerの能力差・属性ごとの同期所有者・外部ID/Revision・競合/二重作成/Receipt不明を明示する。実EffectはTEI既存Host/Authorityへ委譲し、SUIに第二Scheduler/Task Sync Engineを先行導入しない。

### 17.6 情報の多段投影・AIと人間の別コンテキスト

- 人間向けはKJ＋MindMapが中心。Card表示が不適切な巨大小ItemはReaderへ開く。島の代表ラベル/合計/未処理数、鳥瞰→詳細のSemantic ZoomとFitは、入力集合・出典・有効Revision・取得/Disclosure Scopeを持つ**Derived Projection**とする。AI提案ラベルと人間の表札を混同しない。
- AI向けCLI/MCPは画面のズーム量ではなく、目的・許可されたContent・利用可能な関係・Complete/Partial/Unknown・Token予算からコンテキストを選択する。画面上のCard IDや投影digestだけで元SourceやIsland Membershipを復元しない（SUI #3392/#3396/#3397、TEI #2497）。External AIは候補提示までとし、human_reviewed/Accepted/Consensus/実Effectへ自動昇格しない。
- Item/Group/Island/Canvas/RelationにMarkdown・図解・要約を関連付け得るが、Representationは各元Subjectの代替正本としない。OKF風文書は交換候補であり、現時点のSUI生成Draftは**通常Markdown**。元資料実Read、OKF Conformance、SHO Writer/Save、逆Patchは既存SUI #3391/#3392/SHOの未実行Gateを継続する。

### 17.7 既存PoCと実務価値の段階（追加の全機能Blocking Gateにしない）

| 段階 | 限定Pressure Case | 最小の独立Expected／停止線 |
| --- | --- | --- |
| 0: 現行固定fixture／read-only | 旧DocumentV1→候補Item/Canvas/Occurrence投影、同名・同byteの別Card、未取得URL、未読/未整理 | Legacy保存byteを変更せず、元Refと未解決を返す。同一ID推測で結合しない。AI不要 |
| 1: Hybrid 30〜50件 | 既存HC-01〜17/C1〜C8＋二Canvasに同一Item表示、A移動後B不変、Aの表示除外後B現存 | Tree/Island/Affiliation/Edge/Reviewの非干渉。再読込しても共有Identityと独立配置が保たれる。現DocumentV1に新必須キーを追加しない |
| 2: Split/Representation | 島をExtract→別CanvasへShare、一方のみ古いRevision表示、Canvas横断Relation、Readerから原文範囲抽出 | 元情報・cross Relation・読取/書込依存・Undo、元span/RevisionとLossを検査。部分/非公開を不存在としない |
| 3: 人間/AIの異質なView | 同一固定SourceからCard/Tree/KJ/Canvas Map/MarkdownとCLI投影を比較、1,000件→10,000件へ負荷拡大 | 重要情報・保留・異論が欠落した場合は宣言。LOD/Reader性能を測定し、AI ContextとScreen LODを同一視しない |
| 4: Task/外部Consumer | Task候補→明示Task→PERTと外部2 Provider能力比較、進捗戻し／競合 | Task/外部ID/Execution/Receiptを区別。実Providerの双方向同期資格はこの段階の独立検証。初期PoC完了条件に含めない |
| 5: 実利用T2・TEI生産性 | KJのみ／Tree先行／遅延Tree提示／Hybrid、Inboxあり/なしを実務資料で比較 | 情報へ戻る容易さ、注意移動、未分類の保全、操作負担、誤った早期収束、TEI標準機能で実装できた比率を別計測。T3/合成PASSをT2に数えない |

**初期優先順位**は 0→1。次に利用者が実際に困る規模/分割/読取で2を選ぶ。3〜4を独立研究・将来の拡張として並行検討できるが、既存ADR-0089/0090の一次価値の検証を妨げない。TEI側の生産性比較はTEI #2018、構造Facetは#2495、写像/逆編集は#2497、Roleは#2620、適用Patternは#2507、UI Compositionは#997、Action/Authorityは既存各Ownerに分離。SUIの正式なUI/データの変更は別PRで証拠とOwner受理を要する。

**現在の資格**：本節は設計差分の保存のみ（NOT RUN）。既存MCP read-only、DocumentV1、SUI→SHO限定Synthetic CIが成立した範囲を、新しいItem/Canvasモデルの実装済み証拠には流用しない。

---

<!-- sui-raw-item-first-vertical-20261108 -->
### 17.8 横断深化：Raw Itemの受皿から直接読取・抽出・二Canvas配置まで（設計／NOT RUN）

**目的**：§17.3の未整理Itemの許容を、実際に実装・反証できる一つの最小利用経路へ具体化する。単に「Itemを作成できる」だけでは不十分。**保存したと主張する内容を開ける、あるいは外部Locatorだけで内容未取得と診断できる**ことが入口の要件である。分類・概念化・カード化・AI呼出しは受付の必須条件にしない。既存DocumentV1、Shelf/Hold、OKF/SHO、TEIのデータ源・Authority/Effectの正本は変更しない。

**同じItemに関して混同しない4つの観測**：
1. **受付／参照**：何の入力（貼付テキスト、Raw file、URL等）を受領し、どのSource locator/実bytesを手元で観測したか。URLを登録しただけなら原文取得・オフライン再読込・現在性は未証明。
2. **内容と解析**：保存できたRaw Content、そのRevision/byte identity、別途解析した本文やサムネイル、そのCoverage/処理版を区別。抽出失敗・非対応・途中停止でも原Rawを破壊しない。byte一致から同一のSubject/意味を推定しない。
3. **認知上の取扱い**：未読（利用者相対）・未分類・未確認・Held・Shelved・保管/廃止などは互いに独立。Inboxは既存ItemをQueryするView候補であり、別の意味正本・物理Store・強制Workflowにしない。
4. **表示・派生・外部作用**：Readerで原文を見ること、範囲を根拠に新Item候補を作ること、CanvasへDisplay Occurrenceを置くこと、AIへ送ること、Markdown/OKFへ書き出すこと、外部Taskを実登録することは別操作。画面View可能≠送出/共有/書込許可、Role適用可能≠実Action資格。

**小さな縦切り候補（標準Data Structure＋Presentation BindingのConsumer試験）**：
- 入力：未命名の長文・PDF・URLのみの参照・画像を合成Itemとして受け、RawまたはLocatorの観測結果を返す。Inbox一覧は全文Cardを生成せず、開けるものは実Readerで直接読める。Rawが未取得のものは「読めない理由」を権限に応じて表示し、架空の要約を作らない。
- 展開：本文の選択範囲・ページ・原Revisionを伴う抽出候補を作り、原Itemは不変。人が採用した候補ItemをCanvas AにCard表示し、同じItemをCanvas Bにも別Display Occurrenceとして表示。両Canvas間の座標/固定/局所注記は独立。
- 再構成：Item本文の改版時、現在版を参照するOccurrenceだけ再取得し、特定版Pinは旧版と明示。Canvas Aから表示を外しても原Item、Canvas B、元Source、越境Relation、Reviewは残す。AI提案や分割は現readSetと対象writeSetを確認したうえでPreviewし、採用は明示的な一回Undo単位。
- 説明：同じ対象について、Inbox/Reader、KJ/Tree、CLI read-only Contextが実際に参照できるSource・Content・Revision・Coverage・Disclosure・Unknownを比較する。標準UI側はTEI #2507/#997、Query結果の範囲/粒度は#2506、CLIの必要閉包は#3262、投影Lossは#2497のOwnerに委譲する。新Reader/Policy Engine/Role Resolver/Storeを本PoCで重複実装しない。

**独立Expectedを先に手書きする最小反例（すべてNOT RUN）**：

| ID | 入力・変更 | 期待する観測／禁止する推論 |
| --- | --- | --- |
| **SI-RAW01** | タイトル・Role・Tree所属・座標のない長文を受付 | Item参照を保持し、Inbox→Readerで実Contentを読む。Card/OKF Concept/人工分類の強制作成0 |
| **SI-RAW02** | URLだけ登録し外部Fetchせず、次に取得不可 | locatorは残るがRawの存在・完全性・原文取得はunknown/unavailable。取得成功を偽装しない |
| **SI-RAW03** | 同じbytesの別Source 2件、同名の旧Document Card 2件 | identityは別。明示Bindingなしに重複統合・同一Review引継ぎ・別Canvasでの自動共有を行わない |
| **SI-RAW04** | 利用者Aだけ既読、分類なし、heldは別Item、review未実施 | Aの既読はBに波及せず、既読/分類/held/review/lifecycleを相互変換しない |
| **SI-RAW05** | PDF内の範囲から2候補抽出後、元Content改版 | 原Rawを保持、抽出候補は元Revision・範囲・Coverageを保持。旧根拠を現行原文と偽らない |
| **SI-RAW06** | 同じItemをCanvas A/Bへ置き、A移動・A表示削除・B Revision Pin | Aの局所座標だけ変更、削除はAのOccurrenceだけ。B/Item/元Relation存続、Pinは古い版と明示 |
| **SI-RAW07** | AI提案待ちの間に参照先Item・所属Group・権限を変更 | 古いreadSetの提案を黙ってcommitしない。書込範囲外のCanvas/Role/Reviewは不変 |
| **SI-RAW08** | Raw内部にツール命令らしい文言、非公開Itemを含む集合の要約要求 | 内容を命令として実行しない。外部AI/SHO/OKFへの送出は現在のGrant/Disclosureを別判定。非公開ID・件数・存在を漏らさない |
| **SI-RAW09** | 未解析10件から可視3件を選択、途中Reader失敗、Tool応答途中切断 | Selected/Loaded/Parsed/ExposedのCoverageを別報告。表示3件を全10件・全世界としない。途切れた応答を完了としない |
| **SI-RAW10** | Raw ItemからTask候補を連想し、PERT/外部Issue登録を要求 | 説明Item≠正式Task≠Operation/実Event/Receipt。意味受理・Provider能力・明示Action/現在Grantなしに外部Effectを起こさない |

**追加する評価軸**：最小保存操作数／未分類で再読込できる率、Inbox→実Reader到達、抽出の元位置再到達、A/Bの独立性、戻り先の分かりやすさ、Token/CLI手順/標準Plugin再利用数と個別コード量。30〜50件の初期Hybrid実験に対して上の10件全てを新たなBlocking Gateにせず、まずSI-RAW01/02/03/06の非破壊・非誤認を小さな独立Fixtureで検査し、残りは既存Security/OKF/TEI/Product SkillのOwnerへ段階的に接続する。

**実装・受理状況**：設計案のみ。Rawの正式Item DB、複数Canvas UI、実Reader自動選択、実CLI/Plugin Binding、AI/SHO出力、外部Task更新、T2の実利用は未検証。合成Fixtureの期待記述はPASS、正式製品採用、Source真正性を意味しない。

---

<!-- sui-crosscanvas-qualification-20261108 -->
### 17.9 横断受入：共有Item・複数Canvas・共同編集・SHO受渡しを別資格で接続する（2026-11-08／設計・NOT RUN）

**既存成果の更新と本節の独自範囲**：同一Itemを複数Canvasに置ける論理案は§17.4、Raw→Reader→抽出は§17.8、SUI固有の共同編集Undo/RedoとDocument CASは[Issue #3399](https://github.com/hat47x/sui-sensemaking/issues/3399)、OKF/SHOのSource/Loss/開示は[#3392](https://github.com/hat47x/sui-sensemaking/issues/3392)・[#3391](https://github.com/hat47x/sui-sensemaking/issues/3391)がOwner。本節は**同じ一件を横断して照合するための証拠・停止条件**だけを定め、#3399のCU-01〜10や§17.8のSI-RAW01〜10を第二の試験正本として再定義しない。

#### A. UI上の参照を正本とみなさない最小観測票

- **Original Source**：実際に読めたbytes／外部Locatorのみ／未取得／失効、Source Revision、読み取った範囲。元URLだけからReader成功・現在性を推測しない。
- **Information Item**：Item IdentityとContent Revision、原Sourceとの明示的系譜、解析済みか、Role/Reviewが候補か受理済みか。旧`(DocumentID, CardID)`・本文一致からグローバル同一Itemを生成しない。
- **Structural World**：Tree parent/order、Group membership、Island包含、Semantic Edge、Canvas間の参照関係を別の参照/Revisionで識別。1つのGraph投影へ畳むとき、区別が落ちたらLossとする。
- **Presentation Occurrence**：Canvas/View ID、表示出現ID、参照Item/Revision、座標・固定・注記・選択epoch。あるCanvasの座標変更からItem本文・別Canvas座標・意味上の所属の変更を導かない。
- **Consumer Evidence**：そのConsumerが**実際に**受け取ったRaw/ProjectionのContent・Scope・Coverage・Disclosure・revision・ページ終端とGrant。宣言した出力項目や表示上の件数を、Source全体の実読取・実配送・実保存とは扱わない。
- **Edit/Effect**：提案のreadSet/writeSet、UI Undo、Document版/CAS、実Provider Request、ACK、Receipt、独立Readを分ける。Operation可能の宣言と現Host資格、他者編集後の再適用資格を区別する。

この票は**既存Contractで観測できるものだけを埋める検証用の対照表**であり、現時点で正式な共通Envelope/新Storeを採用しない。未読込・不明・権限不可・非対応を空値や「不存在」へ変換しない。

#### B. 複数Canvasと共同編集の必要な非干渉

- **保存粒度の実証が先**：現`DocumentV1`はDocument単位の保存で、[ADR-0076](adr/ADR-0076-collaboration-concurrency-model.md)はサーバー権威のETag/CASによる保存時同期を採用する。**将来の別Canvas＝別Documentにまたがる一操作の原子Commitは保証済みではない**。Item本体・A表示・B表示・越境Edgeをまとめて一度に変える操作を「単一Undo・全体成功」と表示する前に、対象Store/Revision/失敗cut pointを検証する。
- **編集の衝突は対象と効果で分ける**：A内Occurrenceの移動とB内Occurrenceの移動は論理的には独立。しかし実Storeが同一DocumentをCAS単位にする場合は両方が競合し得る。更新先の項目だけでなく、Readerが参照した位置・Island/Relation・現在Grantを含めたreadSetを照合し、競合しないことを永続化層の実測なしに宣言しない。
- **共有Itemの改版と表示Pin**：A/Bが同一Itemの現在版を表示すれば本文改版を共有するが、個別Canvasの表示固定版は古いSnapshotとして明示する。現在版で内容が変わっても、他Canvasの人手配置やIsland理由を再意味付けしない。古い版のReviewやOKF `verified`を自動継承しない。
- **共同編集の履歴三分離**：UIローカルUndo／保存Revision・Checkpoint／構造判断・保留・異論・Reviewは別。保存済み編集の取り消しは「現在版への条件付き逆操作候補」であって、他者の保存を黙って巻き戻す機能ではない。競合・不明Commit・再Readの振舞いは#3399に委譲する。
- **分割と再配置**：Extract/Share/Move/LinkでCanvasを分割する時、元Canvasの島/線、他CanvasのOccurrence、Item本体、越境Relationの削除・移行を区別。部分成功の場合は成功対象・未適用対象・戻し方を示し、全体を成功扱いしない。異なる永続化単位の横断原子性を新インフラで先取りしない。

#### C. 横断で利用する既存の限定Evidence（2026-11-08時点の確認）

| 確認できた限定成果 | 言えないこと |
| --- | --- |
| [SUI merged PR #3396](https://github.com/hat47x/sui-sensemaking/pull/3396)の実`buildContextProjection`対照3/3 PASS：原Card SourceやIsland所属/座標が異なっても公開投影全体が一致する例 | 表示/文章化の一致から元Source・Topology・編集先Identityを逆決定できること |
| [SUI Draft #3397](https://github.com/hat47x/sui-sensemaking/pull/3397)：公開投影から出典を捏造しない通常Markdown草稿、合成354byte、生成ファイルのopt-in経路 | OKF適合、実Source読取、SHOへの実同一Attempt受渡し、Writer保存、再公開Grant |
| [SHO merged PR #21](https://github.com/hat47x/sho-composer/pull/21)：固定RawのReader実試験・One-file Runner入口。標準CIの実SUI→SHO H1はSkip | SUIが実生成した同一ファイルのSHO実受領、二製品を通した保存資格 |
| [SHO Draft #25](https://github.com/hat47x/sho-composer/pull/25)：Working Copy readbackとFile Identityの限定CI | 正式Editor Save／Storage CAS・ABA防止／Publication・再Openを伴う製品Writer資格 |
| [TEI #3262](https://github.com/hat47x/tei-platform/issues/3262)：read-only Design Contextの実CLI 11 Reply＋限定32 Consumer Controlの記録 | 任意WorkspaceのRequired閉包、実Source読込、外部Tool全Reply配送、Role/意味受理／実Provider E2E |

特に#3396により、**同じMarkdownや画面が得られる二つの原Worldは異なり得る**ことが実Consumerで確認された。したがってCanvas Map/Island要約/B型文章化/OKFから元Item/Edge/Sourceへの編集逆写像は、公開投影だけに頼らず、元の安定Ref・Revision・許可されたReaderと明示的な対象選択を必要とする。これはTEI [#2497](https://github.com/hat47x/tei-platform/issues/2497)の構造写像／逆編集Ownerへ返す。

#### D. 独立Expectedの追加差分（新たな全機能Blocking Gateにはしない）

| ID | 固定する操作と一因子差 | 期待結果・停止線 |
| --- | --- | --- |
| **SI-XC01** | Item XをA/Bに表示。Aの位置のみ変更、B別位置、同じItem本文 | UI/読取でOccurrence IDとItem IDを区別。A移動後Bの位置/本文/Tree/島は不変。旧DocumentV1の二コピーを共有実装成功として扱わない |
| **SI-XC02** | A移動提案中に、別編集者がBの本文または元Itemを改版 | 提案readSetの依存と実CAS単位を照合。衝突する場合は再Preview／拒否、他者の変更・保留・異論を保持（CU-02〜06） |
| **SI-XC03** | 分割がItem/複数Canvas/越境Edgeの複数保存単位へ跨る。途中で一つ失敗 | 実際に永続化できた範囲を確認し、全体atomic成功と表示せず未適用・不明・回復手順を返す。副作用を無条件replayしない |
| **SI-XC04** | 原Item内容同一だがSource改版、またはCanvas配置だけ変更 | 前者はSource依存の出典/抽出を再確認、後者は配置依存の説明だけ再評価。全Role/Review/文書が一斉に失効または復権したことにしない |
| **SI-XC05** | 二つの内部Worldの公開Projectionが一致、その後SHO草稿も一致 | #3396の非単射証拠に従い、隠れた島所属/出典/元Item IDを文書から再構成しない。SHO Edit→SUI逆Patchは対象未同定として保留 |
| **SI-XC06** | Readerは利用できたがOriginal Source未取得、Tool Replyが途中切断 | Item受付・実Reader可否・原Source確認・外部Consumer完全受領を別資格。公開3件を全世界3件、ACKをWriter Save成功としない |
| **SI-XC07** | Canvas Aは閲覧可、B/共有Item一部は非公開。集計ラベル/Canvas Map/競合診断を表示 | Item/Edge/未公開件数・存在/時刻/IDを不許可Consumerへ漏らさない。Canvas閲覧資格だけで共有Item/外部AI送信資格を付与しない |

**最短の次作業**：既存DocumentV1に対しまずSI-RAW01/02とSI-XC05/06の**現行Consumerで再現可能な限定観測**を優先。次にSynthetic Shared ItemモデルでSI-XC01/04（headless→実Reader/Studio）を試す。SI-XC02/03/07は#3399の実2クライアント・ETag/CAS・Disclosure検証へ、SHO H1は#3391/#3392とSHO #6/#19へ、TEI横断同一Source/Scopeは#2497/#3262/#2507へ引渡す。初期Hybridの30〜50件の価値検証やKJ-only/AI OFFの成立を阻害しない。

**計画統合時の留意**：SUI [PR #3393](https://github.com/hat47x/sui-sensemaking/pull/3393)が統合済みの§8〜16（OKF・出典Witness・SHO/SEI受渡し）と章番号が衝突したため、本節は§17として末尾に追加した（旧Draft上の§8、各小節8.x）。既存の§8〜16の番号・内容は変更していない。

**資格**：本節は横断Evidenceの照合と追加Expectedの設計記録のみ。SI-XC01〜07、複数Canvas共有Itemの永続化、共同編集E2E、SUI→SHO H1、Writer Save、TEI実CLIのItem Role/Projection適用、外部Task Providerを今回実行したものではない。正式採用はOwnerの独立判断と実証を要する。

---

<!-- sui-sensemaking-living-unit-and-promotion-20261108 -->
### 17.10 原材料から「意味として生きる単位」へ：SUIの一次価値と外部への翻訳境界（2026-11-08／設計候補・NOT RUN）

**今回の横断入力・Owner**：[SUI #3400](https://github.com/hat47x/sui-sensemaking/issues/3400)の初期KJ構想→現ADR-0089の一次価値、[ADR-0111](adr/ADR-0111-meaning-preserving-external-cognition-interface.md)の外部認知接続、既存§17.3/8.8の未整理Item、§17.4/8.9の複数Canvas、[SUI #3391](https://github.com/hat47x/sui-sensemaking/issues/3391)のSHO文章化、TEI #2497/#2620のProjection/Roleを照合。**価値の採否はADR-0089/#3400が正本**、外部送信・ingest・reviewの許可はADR-0111が正本。SUI計画に第二の価値規約・外部Transport・Role意味正本を作らない。

#### A. Raw Item、意味のあるCard単位、実体・Roleを混同しない

1. **Raw Material / Inbox Item**：未読の長文、インタビュー、画像、未取得URL、PDF等を無分類で保管。入力を「一文一カード」「一命題一Item」へ機械的に分割しない。保存・閲覧できることと原Sourceの検証、観測・解釈の受理は別。
2. **KJで扱う意味の単位**：人が一緒に考えたい体験、発言、文脈、違和感のまとまりをCardの候補にする。1語でも複数段落でもよく、論理命題として一文に整形する義務はない。CardはItemや他Subjectの表示Occurrenceを持てるが、元Rawの単なる表示も、抜粋から新しいItemを作る場合もある。**表示するたびに新しい情報実体/独立根拠を増やさない**。
3. **抽出・解釈**：元Sourceの引用（原文/原領域）と、引用から人やAIが追加した見立て・仮説を別のReference/Relationで繋ぐ。生きた単位の抽出が一つの意味主体を成立させるなら新Item/Revisionを明示。部分引用/多箇所引用・ページ/時刻/画像領域等の適格なLocatorと元Revision、抽出Scope/欠落を保持する。Locatorがない場合は手がかりだけを表示し、精密な出典を捏造しない。
4. **KJ・Mind Map・Canvas**：ItemのIdentity、Treeの親子/順序、KJ島の見立て、Canvas位置・交錯、批判/保留を独立に保持。一つのItemが別Canvas/島で使われても「独立した2証拠」「自動的な合意」とは扱わない。幾何学的近接、同じ島名、Tree同祖先を意味受理の根拠にしない。
5. **後から読む・後から意味付ける自由**：未閲覧、未分類、役割未決、違和感の理由未記載でも保存/再開できる。読了や分類をKJの開始条件にせず、保留理由を後付けした際は**後からの記録**として保存し、過去にそう判断したと偽らない。

#### B. SUI→他製品の境界：参照／草稿／人間・AIによる翻訳／正式受理

- **単なる保管・読取**：SUIのRawやCardを別Consumerが許可済みReader/参照で読み取ることは、業務意味への変換でも正式なTEIモデル化でもない。元Source、Scope、Revision、開示、Readの実績を明示する。
- **SHO経由は任意**：B型文章化/Markdown Draftは著者の文章表現であり、SHOの文書Revision・Writer・著者Reviewへ委譲する。原SUIのKJ島/Tree/異論/未決を無損失に複製できるとは主張しない。SUIにSHOの原文Writerを複製せず、SHOなしのKJ/Raw利用も成立。
- **TEIへは翻訳の明示段階が必要**：SUIのItem/Task Role候補やSHO文書から、Data/Function/Business・Rule等のモデルを**人間または生成AIが明示的に読み替え・提案**する。SUI Card/島/PERT表示の変化をTEI Accepted Meaning・DSL・本番Actionへ機械的に直結しない。SHO経由必須でもSUIからの自動直結でもなく、**任意の情報経路＋明示的な翻訳/検証**という区別にする。TEI側では元Source/Role/Model/独立Expected/Owner受理・実Provider・現在Grantを別資格で確認する。
- **外部連携は現行ADR-0111へ従属**：SUIの現Agent MCPはread-only、TEI送信は未実装。送信・Proposal ingest・Effectを増設する場合は同ADRの方向／データclass／権限への効果／証拠階層／可逆性とTEI側のAuthorityを検収する。公開可能な文字列から送信資格やContentの完全性を推定しない。Task外部連携でも、PERT表示＝外部登録の許可ではない。

#### C. 実Document/Sourceの保存と閲覧の責務：現行実装を止めない

- SUIの現在のDocument保存・ETag/CAS・Revision/Content Storeは現行ADR-0070/0071/0076/0088の責務に置く。SUIの`DocumentV1`はCanvasを含むレガシー保存集合であり、将来のItem/Content/Documentという論理的区別を追加しただけで実分離・移行・共通API実装済みとは呼ばない。
- 共通化しやすい**文書の保存/再読取/版条件付き更新の薄い契約**は、必要になった時に実Consumer同士で比較することはできるが、SUIの初期PoCを別の共通Documentサービス、第二のDB/Authority/Host、全形式の正規化、集中同期に依存させない。既存のRDBとContent Store、Reader/APIで基線を取る。別製品のローカルMarkdownはその製品で編集正本となり得るため、SUIのDocument JSONに吸収しない。
- 文書のContent fingerprint、`DocumentV1`のJSON/ETag、head/CAS Revision、Item Semantic Revision、Canvas Occurrence epoch、SHO Working Copyと正式Saveは**比較対象が異なる**。Raw保存成功・File Reader PASS・Projection digest一致を、各々の正本入替え・共同編集成功・Writer再開保証・TEI意味受理へ合算しない。
- S3/NAS等の保存Providerや全文検索/Vector索引は必要性と実負荷を観測して選ぶ。Blobが保存済みでもIndex更新遅延・Meta commit不明・部分的なReader readがあり得る。表示件数/検索HitとRaw全体・Disclosureの完全性は別。

#### D. 既存ケースで実行する「思考の往復」評価（新しいT2認定の捏造・ケース重複なし）

| 操作・反例 | 使う既存Expected | 認知上の観測／技術上の停止線 |
| --- | --- | --- |
| 長い原資料・複数の主題／未整理をそのまま受付し、必要部分を後から読む | SI-RAW01/02/05、#3400 SV-01 | 読む前の分類・文単位強制0。元Source/引用位置を保ち、意味単位を人が選べる |
| 原資料にない島見立て・違和感を後から言語化、AIなしで配置・再開 | #3400 SV-03/04/08、既存HC/T2 | 元Rawと新しい解釈、当時の記録と後付け理由を分ける。新発見・根拠回帰・未決維持を別観測 |
| 同じItemがA/B Canvasに現れ、異なる島/Tree/説明に利用される | SI-RAW06、SI-XC01/04/05、#3400 SV-06/09 | 表示Occurrenceは別、Identityと原Sourceは一つ。独立証拠数を水増しせず、別案を潰さない |
| A型図解からB型草稿、任意にTEIモデル候補へ人/AIが翻訳 | SI-XC05/06、#3391 SU-SH01〜05、ADR-0111 | 文書化・モデル候補・Meaning受理・実送信/実Effectを別資格。Lossや非公開を隠さない |
| 外部Source未取得／共有拒否／SUIを実務で使わず合成のみ | SI-RAW02/08/09、#3400 SV-10、ADR-0089 T2 | 不明/非開示を不存在扱いしない。SUI内部Dogfoodや合成PASSを「SUI以外の実務」でのT2へ算入しない |

**優先順位**：現在の3カード/KJ+AI OFF→未分類RawのReader再開（小さな資料で十分）→人が決めるCard単位と引用位置→KJ上の配置/異論/保留→二Canvasでの非干渉を確認してから拡張を測る。初期段階から大量Item、外部Task同期、汎用文書サービス、完全Ontologyを必須にしない。利用価値のOwner判断は#3400/ADR-0089に戻し、技術的受入は本節の既存SI-RAW/SI-XC・TEI/SHOの各Ownerへ戻す。

**証拠の上限**：本節は構想・現在の責務と受入順の設計反映のみ。Raw Itemの新製品API、実複数Canvas、Reader→Card抽出E2E、SUI→TEI人/AI翻訳の実モデル受理、SHO正式Writer、外部Task Provider、T2実利用価値の実測は今回NOT RUN。

---

<!-- sui-crossview-20261112 -->
## 18. 2026-11-12 横断接合：情報の選択・意味の投影・SHO往復を実利用の認知順でつなぐ（設計候補／未受理）

### 18.1 前提と増分：17章の繰返しでなく「対象を選んだ後」の欠けた接続を解く

第17章のRaw Item/Content、Tree/Island/Graph、Canvas/Display Occurrence、Task/Action/Event Role、SHO/TEI正本分離はそのまま維持する。11月8日に#3393/#3398はmainへ統合済みだが、**複数Canvasと独立Item正本の実データ移行・GUI・外部Providerは完了していない**。ここでは、別チャットのSUI高度な文脈選択、異種データの状況理解、TEI標準型・構造・表現の段階実装、SHO往復編集の後続課題を、ひとつの作業における**接続資格・最初に観測すべき不足**として整理する。

- **SUIの利用者価値は既存[ADR-0089](adr/ADR-0089-product-value-canon.md)、[#3400](https://github.com/hat47x/sui-sensemaking/issues/3400)**が正本。未整理素材を読み、意味として生きるまとまりで配置し、違和感・異論を残して理解を見直すことが主線。新しいPlatform、Ontology、Role Registry、一般Task同期をP0としない。
- **異種情報統合は[#3401](https://github.com/hat47x/sui-sensemaking/issues/3401)**のI0〜I4が所有。別SourceにあるEntity・Event・時系列は、出典・時点・粒度・暫定同定を照合してから候補Relationを作る。Join表示、語の一致、検索hitから「同一人物／同じ実Event」を確定しない。
- **SHO往復の正本**はSUI [#3391](https://github.com/hat47x/sui-sensemaking/issues/3391)とSHO [#19](https://github.com/hat47x/sho-composer/issues/19)。11月11日のSUI [#3430](https://github.com/hat47x/sui-sensemaking/issues/3430)・[#3431](https://github.com/hat47x/sui-sensemaking/issues/3431)、SHO [#31](https://github.com/hat47x/sho-composer/issues/31)〜[#33](https://github.com/hat47x/sho-composer/issues/33)は具体的な段階の受入提案。Issueのcloseだけで実製品の往復E2E PASSとはしない。
- **TEIの表現とMapping**は新しい段階索引[#4350](https://github.com/hat47x/tei-platform/issues/4350)・[#4351](https://github.com/hat47x/tei-platform/issues/4351)〜[#4353](https://github.com/hat47x/tei-platform/issues/4353)と既存#2495/#2497/#2506/#2507/#4133が担当。SUI Canvasの自由配置や未分類Itemに、TEI Function Data Contextを無条件に必須化しない。

### 18.2 安定した「対象・範囲・意図」の選択：GUI/CUI/AI Harnessをまたぐ作業単位

SUIのCanvasで選択した範囲が、ズーム・パン・別のカードへのホバー・タブ切替で意図せず解除されると、AIへの指示が別対象へ向かい得る。既存の表示Selectionとは別に、**明示的に固定できる作業中の選択文脈**を求める。ただし新しい共通Context StoreやHostを先に作らず、現行Document/Revision/既存Action Proposalの一時的な束縛でFit/Gapを測る。

| 操作面 | 同じ選択で説明できるべき内容 | 不明なら拒否／留保する内容 |
| --- | --- | --- |
| キャンバス上の複数Card/Island選択 | 対象の安定Ref、Canvasと表示Occurrence、Itemへの対応、選択根拠、選択範囲 | 重複表示を二つの独立証拠と数えない。表示IDから更新対象を決めない |
| Tree/Outlineの選択 | Node occurrence、Tree版、親子・順序が候補か受理済みか、対象Item | 読順を親子関係や業務階層に変換しない |
| Readerでの資料範囲選択 | 保存済みRaw／Locator、元Revision、UTF-8 byte/ページ/時刻等の実取得可能な位置 | 未取得URL・解析前PDFに精密Source Spanを捏造しない |
| CUI/AI Harnessへの対象固定 | 対象の集合、用途、利用者の明示した意図、許可されたSource/Scope、base Revision、readSet、writeSet候補、Disclosure、Unknown | 単に「現在選択中」のUIカーソルや前回Harness返信から現行対象・権限を推定しない |

「選択を固定」「文脈を追加」「対象を変更」「解除」は明示操作とし、人が視覚的に確認できる。生成AIは選択された**情報集合と関連構造・来歴を利用可能な範囲で参照**し、未取得・非開示を0件にしない。編集候補は選択対象と非選択依存を含むreadSet/expected Revisionに束縛してPreviewし、実Apply直前に再照合する。SUIの認知的提案と実業務Effect/Host Grantは別（ADR-0111／TEI #1174）。

### 18.3 表現型とContextの適格性：TEIの新しい段階計画をSUIの異質Consumer試験へ

TEI [#4350](https://github.com/hat47x/tei-platform/issues/4350)は「標準値型／標準データ構造／表現型／Function Data Context／Mapping」を分離し、read-only Reference検査 S1→S2/S3→合成損失へ進む。**まだ製品Rendererや正式TEI Function Bindingが実装済みであるとは扱わない**。

SUI→TEIの意味ある接続を検証する際だけ、最低限、次を別々に観測する。元Source/World版、Subjectと表示Occurrenceの対応、重複と集合の粒度（1:N/N:M、Join fanout）、順序と由来、Null/missing/unfetched/withheld、取得Coverage、Domain/Observation/Presentation/Structural Time、表現上のLoss、候補逆編集と現在のOperation/Grant。例えば、同一Itemが2 Canvasに表示されても1 Subjectであり、Island群の件数はQuery/権限に依存し、PERTバーの表示時刻は実Event時刻と同義ではない。

**適用境界**：SUIの自由なKJ Canvas・Inbox・資料Readerは、TEI Functionなしでも成立する。TEIモデルに接続された表現インスタンスは、該当FunctionのData Context/Scope/grain/SelectionとBindingが実証できたときに限り、TEIのModel/操作対象として扱える。Canvasの座標やGroupのまとまりを意味正本へ機械昇格しない。Graph/Tree/Markdownへの非単射投影からの自動書戻しは拒否（TEI #2497/#4353）。

### 18.4 SHOとの「一往復」では原文・構造・文章の版を別々に固定する

11月11日のG3-SHO/G3-SUI各Issueは、次の最小経路を具体化している（**各Issueの記述は受入候補であり、本節だけで実装済みとは認定しない**）。

1. SHOの人間が選択したMarkdown原文の範囲（byte位置、実bytes、原文版、開示Scope）から**選択Handoff票**を作る。R0保存版とDirty bufferを混ぜず、選択外の秘密文書・リンク先実体を送らない（SHO #31）。
2. SUIは**構造Draft候補**を作る。DocumentV1に存在するCanvas座標、Island所属/ネスト、Affiliation多重所属、非階層Relation、Hold/Contradiction/Voidと、別途入力された**未受理のTree候補**を区別し、Treeの親子をDocumentV1に実装済みと偽らない（SUI #3430）。
3. SUIの**Markdownアウトライン候補**は、意味未受理・座標未投影・Source未照合・多重所属・非階層Relation・保留・異論などのLossを記録する。選択外/未レビューの本文・ID・件数を、Markdown/manifest/ハッシュ用入力へ漏らさない（SUI #3431）。
4. SHOは元文書を無断上書きせず、別Draft・差分Preview・明示採用へ進む。古いSource Revision、未知schema、不一致digest、空のLossを「損失なし」と主張する場合は採用拒否。保存ACK、実readback、再Openを別資格で記録する（SHO #32/#33）。

**要注意**：SUIの現行公開Projectionは内部DocumentV1の全Source/Topologyを提供しない。SUI [#3402](https://github.com/hat47x/sui-sensemaking/issues/3402)のIsland端点Edge、[#3418](https://github.com/hat47x/sui-sensemaking/issues/3418)の外部矛盾状態露出の差は、Issue closeだけで「すべての外部Consumerへ公開可能」にはならない。内部Authoringの選択可能性と外部Harness/MCPのDisclosureを別に判定する。実SUI→SHO同一Attempt、Writer保存、逆Patch/正式TEI Meaningは独立ゲート。

### 18.5 権限・完全性と大規模化の追加停止線

- SUI [#3419](https://github.com/hat47x/sui-sensemaking/issues/3419)のMCP文書一覧初ページだけの検索問題は、Inboxに大量Itemがある場合の「見つからない＝存在しない」誤認の具体例。ページ・cursor・実受領・終了MarkerとScopeを確認するまで全件不在と断定しない。
- SUI [#3422](https://github.com/hat47x/sui-sensemaking/issues/3422)の外部PDPのreadOnly意味と、[#3425](https://github.com/hat47x/sui-sensemaking/issues/3425)のexport-audit SafeMode申告値は、外部書込・送出と現在認可の設計に直結。**「PDPが返した」「監査に記録された」「サーバが強制した」「外部Recipientが受領した」は別事実**。契約未確定の経路を安全・実行可能と宣言しない。解決は既存Security Ownerへ戻す。
- 大量情報の取込/検索は、Item・Content保存、Source Reader実取得、索引更新、Agentへの部分出力、Consumer実受領を分離する。部分結果やHiddenを全世界の欠落とせず、AI ContextのToken上限と人間UIのSemantic Zoomを同一の情報集合と扱わない。
- Task/Action/Event Role候補を見つけても、予定Task・実Occurrence・外部Issue/Provider・Execution ReceiptをIdentity上分離し、PERTや文章化だけで本番Effectを発火しない。

### 18.6 最小の独立反例と検証優先度（既存Owner/SSOTを再利用）

**新增の適合検査観点（新たな独立試験正本や全機能Blocking Gateではない）**：

| 観点 | 既存試験・Owner | 別に観測すべき不足とExpected |
| --- | --- | --- |
| 固定した対象選択をUIパン/別タブ/AI入力をまたいで維持 | 17章SI-XC02/07、SUI #3399、ADR-0111 | 明示固定したItem/Island/出現集合は不変。実編集時だけ現在版/権限と再照合。違う対象への黙った書込0 |
| 共有Itemを別Canvas/Tree/島で使う | 17章SI-RAW06/SI-XC01/04/05、#3400 SV-06/09 | 同じ元情報を独立証拠へ水増しせず、異なる文脈を保持。Undo/競合で他者の保留・異論を破棄しない |
| 原文選択→構造Draft→候補→SHO別Draftの最小往復 | SUI #3430/#3431、SHO #31〜33、SUI #3391 | 実byte/選択Scope/構造版/損失/Consumer readbackの切れ目を検査。通常CIのSkipをE2E PASSへ算入しない |
| 表示と正式Model Contextの境界 | TEI #4350/#4351/#4353・#2497・#2506 | SUI KJ-onlyはFunctionなしで成功、TEI Binding付きの場合はIdentity/grain/axis/Scopeが欠ければunqualified。選択から編集対象を推測しない |
| 未取得/秘匿/部分取得・外部Policyの差 | SUI #3401 II-01〜08、#3419/#3422/#3425、17章SI-RAW02/08/09 | 実Read済みSubsetと未読込/Hidden/不明を区別し、明示許可がない書込・外部送信を停止。件数・ID等の二次漏えいを防ぐ |

**進める順**：（A）現在の3カード/KJ・AI OFFと既存ReaderでSI-RAW01/02および原文への復帰を検証、（B）固定選択と同一Itemの別Occurrenceをheadless Fixtureで比較、（C）SHO選択Handoff→SUI内部構造Draft→SHO候補の一往復、（D）TEI #4350のS1/S3が成立した範囲だけTEI表現Bindingの適格性を照合、（E）実需要があれば[#3401](https://github.com/hat47x/sui-sensemaking/issues/3401)のI1から異種3Source/PERT/外部Providerへ拡張。A/Bの利用価値はADR-0089のT2と別に設計実装証拠を保持し、SUI内部Dogfood/合成CIをSUI外の実務T2に加算しない。

**所有と受理**：17章の正本と各Issue Ownerを維持し、TEI/SHO/SUIの第二Context/Source/Authority/Reader/Registry/Hostを増設しない。11月11日以降のG3/TEI #4350/安全性Issuesの具体化を、この接続順へ反映した**計画差分のみ**。新UI/API、Role Runtime、SUI→SHO往復E2E、TEI Function Binding、外部Task Provider、T2実務価値はいずれも本節ではNOT RUN・NOT ACCEPTED。

### 18.7 安定選択を「固定集合＋動的条件＋現在資格」で具体化する（横断追補）

共通Harness [TAI Draft #629](https://github.com/hat47x/tai-pleroma/pull/629)の§11.8を、**SUI利用者の選択体験が満たすべき限定条件**として取り入れる。TAIが外部Harness/Session/Transportを所有し、本節はSUI内部の選択・表示・操作対象の非同一性だけを所有する。共通Selection ABI、共有Session Store、製品埋込みHarness、特定のSession復元APIは**未採用**。

- **Transient Focus**：一時的なホバー・クリック・エディタカーソル・現在表示中のViewport。Esc/画面切替で変わり得る。
- **Pinned Work Set**：利用者が明示した、対象Kind・安定Ref・元のCanvas/Tree/Reader表示出現・Source/Revision・用途・選択条件と補正履歴を持つ対象集合。Highlightは固定集合の可視化であって正本ではない。移動・別タブ・Chat入力で不意に失わず、解除・再束縛は明示操作とする。
- **Resolved Candidate Set**：自然言語検索またはQueryを**特定のScope・時点の実Read**で解決した候補Q。未探索/未公開を0件としない。動的条件そのものと、時点rで解決済みのID集合を別に保持する。
- **Human Correction**：利用者による除外集合E／追加集合A。可視かつ実解決済み対象の範囲で `S=(Q−E)∪A` とし、同一Itemが別Canvasの二表示で現れても証拠数を2としない。追加Aを現在Grantを通さず対象確定・外部送信へ昇格させない。
- **Qualified Apply Set**：最終Sの各Ref/Source/Revision/Scope/現在Grantを実際に再Readし、編集対象ID/Dependency/readSetとwriteSetを解決できたものだけ、条件付きPreview/Applyの対象とする。Sが固定でも、参照先の実在、現在のRowset/RLS、意味Role、許可は固定されない。

**利用者に見せる最低状態**：「いま指している箇所」「固定した作業対象」「未解決・要再確認」「この操作で変更する対象」を分け、対象が一致しない場合は保留。Pinned集合を新しい永続ItemやDecisionとして自動記録せず、利用者が必要とするときだけ通常のSUI情報単位へ明示保存する。SUI内のAI候補を自由に比較する機能はAI OFF・手動補正でも成立し、CSW/TEI/SHOを常時起動しない。

### 18.8 同一Harness Session・Activity引継ぎ・権限は別もの

外部HarnessのSessionと各ProductのUI Viewを共有し得ても、**Session共有＝同一Activity、現在のSource read、現在のGrant、実業務Effect**ではない。AIの返信は起点Request/Attempt・Product・Pin・元Revision・Scopeを付けて表示し、他画面からの遅い応答を現在のPinへ誤貼付しない。

- **実Live attachを確認**した場合のみ同一Sessionの継続と呼ぶ。Harnessが対応しなければ、用途限定のActivity Handoff（対象Ref・未決・Unknownの引渡し）として表現し、同一Conversation継続を偽らない（TAI #168/#271）。
- **機密境界変更**：過去のSession文脈に秘密が残っている場合、後続の出力だけを伏せても隔離できない。Audience/Principal/Trust Boundaryを変更する場合は新しい隔離Sessionに分岐し、許可された情報だけを再取得する。複数画面の便宜よりDisclosureを優先する（TAI #232）。
- **同World fingerprintでも異なるProvider可視集合**：DB Rowset、RLS、Scope/Grantが変わり得る（TAI #271の限定観測）。SUI/TEIとも構造Revisionの一致だけで「同じ検索結果・同じ権限・全件取得済み」を宣言しない。実Provider Read、cursor/終端、取得Scopeを個別確認。SUI [#3419](https://github.com/hat47x/sui-sensemaking/issues/3419)の1ページ目だけの探索欠落は実際の停止線。
- **Toolの成功段階を分離**：送信予定、Tool要求、実Tool Reply、UIに表示されたResult、製品側の確認、正式Write/Receipt、再Readを別観測とする。LLM/CSWの整然とした回答や宣言されたCapabilityは、実受領・実行・完了の証拠ではない。

### 18.9 意味Role・TraitとCSW協調は「推論・役割付け・実行」を分離する

情報がTask/Action/Eventに見えるときも、**「そのことを記述したItem」「予定されるTask」「実際に生じたOccurrence/Event」「実行可能なOperation Contract」「実Effect/Receipt」**を同一のRole-tagでまとめない。異種情報からのEntity同定も同様に候補と受理を区別する（SUI #3401、TEI #2620/#2495）。

- **SUI**：人間の違和感・未分類・多重所属・異論・仮の島/表札を保ったまま、複数の見立てをCard/Tree/Canvas上で試す。Roleは意味解釈の候補になり得るが、Roleが付いたというだけで実TaskやWorkflowは発生しない。
- **CSW**：複数の分類・再配置・対照解釈を提案する任意の認知手法。SUIのIsland構造をCSWが自動受理したMeaningやTEIの組織Membershipへ変換しない。CSW不在のKJ-onlyと、通常AI提案と、CSWを用いた提案を分けて認知増分を測る（SUI #3400）。
- **TEI**：正式モデルへ接続する場合、Roleの意味契約、Traitの実装義務/未履行（manual-requiredを含む）、Function Data Context、適格Provider、Data/Presentation/Operationの別資格を評価する。標準Representation Descriptorの書けたことを、Trait充足/受理済みModel/現在Grantにしない（TEI #4350/#4353）。
- **SHO**：SUIから受け取る文章候補の著者による編集・採用はSHOの文書正本とし、元SUIの島・関係・Role・原出典を書き戻したことにしない。逆編集は対象とLossが一意に資格化できたときのみ候補提示（SUI #3430/#3431、SHO #31〜33）。

#### 追補の独立判定対照（既存Expectedへ割り当て。未実行）

| 対照 | 操作 | 期待結果／停止条件 | Owner・既存Expected |
| --- | --- | --- | --- |
| **HSC-A** | 曖昧Queryで12 Card候補→人が1件除外・1件追加、別Canvasへ移動 | Q・E・A・確定S、元ID/Revisionを追跡。二Occurrenceを別証拠数とせず、元Pin維持。新追加は現在Grantを確認 | TAI #629 §11.8 P1、SUI SI-XC01/07 |
| **HSC-B** | Pin後に元SourceをA→B→A、別利用者が権限を変更 | 同byte/見た目を現行参照資格とせず、再解決・再Read/再Preview。権限の無いAction/送信0 | TAI #271、SUI SI-RAW03/07、#3399 |
| **HSC-C** | 二画面で同一Harness Session attachを試み、古いReplyが後着 | 実attach可否を明示。Request/Pin/Revisionが違うReplyを現行結果へ適用しない。attach不可ならActivity Handoffのみ | TAI #629 P2、ADR-0111 |
| **HSC-D** | 同一World/同じQueryでRLS可視行が変わる。MCPも途中ページだけ読む | Providerの実Rowset/Coverageを別証拠にし、0件・欠損・秘匿・partialを区別 | TAI #271、SUI #3419、SI-RAW09 |
| **HSC-E** | CSWが仮の二島とTask Role案を提案し、人が片方を拒否 | 採用されない候補を保持し、KJ island≠TEI正式Membership、Task候補≠実Effect。AI OFFを基線に比較 | SUI #3400 SV-03/05、TEI #2620、#2507 |
| **HSC-F** | SHO文書選択→SUI構造Draft→文章Candidate→明示採用 | 選択本文/原Source/構造/文書の版とLoss、Disclosure、実readbackを別列。SUI外部公開Projectionだけから元構造を復元しない | SUI #3430/#3431、SHO #31〜33、SI-XC05/06 |

**最短の次実証**は、（1）SUIの固定Card 6〜12枚でAI OFFと限定検索Q＋人間補正Sを比較、（2）Pin維持／解除／失効再解決のheadless→実UI経路のGapを観測、（3）Document/Reader→SHO最小候補の実一往復を先行Ownerで照合、（4）必要となった範囲に限りTEI表現BindingとCSWの追加価値を検証、の順。TAI #629の外部Harness実Attach・CSW実技能・TEI Role/Trait Runtime・本番操作はこの節で採用/実装したとは言わない。**HSC-A〜Fは全て提案段階・NOT RUN。**

<!-- sui-target-qualification-and-identity-20261112 -->
### 18.10 固定した参照が「一意に解決できた」とは限らない：Product別の識別資格

[TAI Draft #629 §11.8.5](https://github.com/hat47x/tai-pleroma/pull/629)と[Draft #630](https://github.com/hat47x/tai-pleroma/pull/630)、[TEI #4475](https://github.com/hat47x/tei-platform/issues/4475)/[#4472](https://github.com/hat47x/tei-platform/issues/4472)を横断照合。§18.7の`Pinned Work Set`は利用者の**選択意図を安定して保持**するが、参照の存在・一意性・出典真正性・現時点での操作資格を保証するものではない。

**最初に分けて確認する条件**：
1. **参照の精度**：Product/Workspace/Document、要素Kind、安定Ref、表示Occurrence、元Source/Revision・選択範囲を混同しない。Qualified Refの構文が正しいことと、Source上で一件へ解決できることを分離する。旧`(DocumentID, CardID)`や本文一致から新しい全域Item IDを捏造しない。
2. **一意性と競合**：同Kind/同IDの重複、同名別ID、Graph同端点の多重Relation、同Item別Canvas表示、同じ文章の別引用箇所を反例にする。**Index/検索/表示の戻り値1件を「原Sourceに1件しかない」の証拠にしない**。0件についても、権限・取得Scope・ページ終端・Index欠落を検査せず不存在としない。
3. **参照はあるが内容不明**：未取得URL、外部Source未許可、Reader未対応、失効・partial、派生Projectionの非単射、未レビューの構造を区別。曖昧・欠損・非開示がある場合は、その**開示可能な範囲で**選択解除なしに保留し、適格に解決済みの残りの要素へのread-only探索を妨げない。
4. **識別と意味対応は別**：異なるSUI Item/Island、CSW仮の束、SHO段落、TEI Data/Function/Business、実世界のEntity/Eventを同一Subjectへ自動統合しない。跨製品の同一対象・因果・役割対応は、出典/範囲/版/Lossを持った**提案Relation**として人間が検討可能にし、実Host/Owner Meaningへ自動昇格しない。
5. **判定の非破壊性**：識別資格を確認するread-only操作やFingerprint算出で、元のItem/Model/Authority/Review/Selectionが変わらないことを必要条件とする。[TEI #4475](https://github.com/hat47x/tei-platform/issues/4475)は`ThreeElementModel.Index()`の同Kind同ID縮約と`ModelFingerprint()`の入力Slice/AuthorityLimitsの破壊・自己参照を**静的ソース調査から指摘**している。**後続の実装更新**：[TEI merged PR #4507](https://github.com/hat47x/tei-platform/pull/4507)でFingerprintの入力破壊・自己参照とDiagramへのAuthorityLimits引渡しは修正がmainに統合済み。一方、同Kind同IDの重複処理、CRUD索引/矛盾、現在Host Grantの実受理は別の未完了範囲であり、本節はそれらをPASS認定しない。

**SHOで永続Occurrence IDを強制しない**：[SHO PR #29](https://github.com/hat47x/sho-composer/pull/29)のUTF-16→UTF-8範囲写像は限定CI済み。[SHO Draft #38](https://github.com/hat47x/sho-composer/pull/38)で提案される原文位置の都度再解決を、SUIのCard/Display Occurrence IDへ合わせるために変更しない。Source byte、Origin、BOM/EOL、buffer/disk、位置/文字列の照合と現在Versionを組み合わせ、同一文字列の別箇所は区別する。再解決不可能なら保留。OS/Editor内の実Writerと永続Storage fenceは独立資格。

### 18.11 画面に見える完全性、元モデルの完全性、送信できる完全性を分離する

同じ観測列で、**SUIの選択→Preview→AI/SHO/TEIへ送出→結果を戻す**過程を比較する。ただし一つの全製品共通Receipt/Policy Engineへ集約せず、Product既存Reader/Projection/StorageとTAIのActivity Handoffの実証から組み立てる。

| 段階 | 実際に確かめる対象 | 禁止推論 |
| --- | --- | --- |
| Source admission | 読めたRaw・Source位置・Source版・欠落・未取得・Permission | URLやhashだけで元文書を現在読めるとしない |
| Identity resolution | Qualified Kind/Ref・解決集合の一意性・多重性・同名別対象 | 先頭Hit、Indexで縮約された1件を正しい唯一対象としない |
| Model/Projection | 元Sourceの全構造と、Reader/Canvas/Tree/Graph/CRUD/Markdownが実際に含む構造の差・Loss | 画面にないEdge、明示CRUD、保留・異論を「元にも無い」としない |
| Audience/Disclosure | 現在のGrant/開示Scope・非公開部分・未レビュー・相手/送信先 | 表示可・Pin可・Review済みを別製品への送出可としない |
| Consumer delivery | 実際に渡したbytes・Tool args/Reply/終端・Receipt・Source再読取 | 生成成功、API ACK、Schemaがあるだけで完全配送や保存完了としない |
| Editing/Effect | readSet/writeSet/expected Revision、再資格化、Preview、人の採用、実Provider Effect | 過去の選択、同一Session、AI/CSW候補を現在の書込権限としない |

**三つの本質的な非同一性**：
- [TEI #4472](https://github.com/hat47x/tei-platform/issues/4472)の静的指摘では、CRUD派生表の生成時にData索引を取り違えたり、明示定義だけのFunction×Data対や矛盾を落としたりする可能性がある。SUI/SHO/AIが表だけを取得した場合、「表示されなかった操作は存在しない」と推測できない。修正はTEI側へ委譲。
- [TEI Draft #4489](https://github.com/hat47x/tei-platform/pull/4489)の限定Projection未解決と、[TEI Draft #4500](https://github.com/hat47x/tei-platform/pull/4500)の業務責任・Case変化は、同じ図や説明ができてもMeaning/権限/現在の業務状態が異なる反例。SUIのKJ Islandや仮Taskを組織の実責任・承認・実Eventへ昇格させない。
- [SHO Draft #38](https://github.com/hat47x/sho-composer/pull/38)の原文位置都度解決と[SHO #33](https://github.com/hat47x/sho-composer/issues/33)の別Draft採用では、「内容を人が編集できる」と「元SUI/TEIモデルを更新できる」を区別する。SHO著者本文の後からの編集やA→B→Aを、SUI抽出Item/TEI Meaningへの自動逆反映としない。

本章はSUIのKJ-only／AI OFFの自由探索を阻害しない。Sourceを読む・Canvasに並べる・違和感を残す操作は**未整理/意味未確定のまま成立**する。他方、秘密情報を公開しない、不適格な編集候補を停止することは既存SafeMode/ADR-0111に従う。完全性の不足は画面全体の利用禁止ではなく、要求された**用途に相対的な資格不足**として扱う。

### 18.12 追加する検証差分とOwnerへの引渡し（技術負例／NOT RUN）

新しい全製品横断Checkerや第二のExpected SSOTを作らず、既存§17〜18、[TAI #271](https://github.com/hat47x/tai-pleroma/issues/271)/[#629](https://github.com/hat47x/tai-pleroma/pull/629)/[#630](https://github.com/hat47x/tai-pleroma/pull/630)、TEI #4475/#4472、SHO E0/G2/G3の既存独立Expectedへ付帯条件を付ける。

| 対照 | 小さな一因子変更 | 独立Expectedと停止 |
| --- | --- | --- |
| **HSC-G** | SUIの同ItemをCanvas A/Bに2表示、そこへ別Item同文を追加 | 2 Occurrence≠2根拠、別Item同文≠同一Subject。表示選択から本体の更新対象を無断決定しない（SI-XC01、SUI #3430） |
| **HSC-H** | 1 Productの実Sourceに同Kind/同IDを2件置く、または同端点多重Edge | 一意性未証明を黙って1件に縮約せず、正しい診断/資格保留。SUIでTEIのIndexerを再実装しない（TEI #4475、#2497） |
| **HSC-I** | 元TEI CRUDには明示操作/衝突があるが表示表では1行もない | 欠損・矛盾の根拠をSource側で確認し、表の空白をOperationなしと解釈しない（TEI #4472） |
| **HSC-J** | 同じSHO文中に同一文字列が2度、元RawはBOM/CRLFを含む。Source改版 | UTF-8 byte span/実Origin/Source版で正しい選択範囲だけ再解決。永続Occurrence IDは要求しない（SHO PR #29/#38） |
| **HSC-K** | TEI FingerprintをPin資格の照合で2度計算し、Model/Authorityを比較 | ModelとAuthorityLimitsがbefore/afterで不変。Fingerprint自己参照で履歴と一致判定が変わらない（TEI #4475、独立実Goテスト待ち） |
| **HSC-L** | GUIで選んだItemをAI/SHOへ送り、Provider Scope/Grantが送出直前に変化 | 現在のSource/Scope/Disclosureを再確認、未許可送出なし。拒否/未取得/Tool Reply部分のみを正直に報告（TAI #630、SUI SI-RAW08/09、ADR-0111） |

**実証順**：P0=SUI内部Reader/Canvas選択＋元Sourceへの再到達をAI OFFで確認 → P1=同Item二表示・同文別Item・未レビューの少数Fixtureで一意性/開示を観測 → P2=SHOの既存E0実span写像をSUI選択資料へ用途限定接続 → P3=TAI #168のG0〜G2が先に成立した適格Harnessのみ実Tool送出・Reply・適用先照合へ → P4=TEI #4475/#4472の実製品修正結果を再読し、モデル投影/操作候補の採否を判断。**SUI本体の新Item/Canvas Schema・元Sourceの実移行はP0〜P1の実需要を確認するまで先行実装しない**。

**資格と未了**：#4475のFingerprint/Diagram AuthorityLimitsに関する部分修正は[merged #4507](https://github.com/hat47x/tei-platform/pull/4507)に入ったが、#4475の同Kind同IDや#4472のCRUD修正は別範囲。SHO #29の17-case CIを実VS Code/Dirty Buffer/正式Writer/Storage CASへ拡大解釈しない。HSC-G〜L、実SUI UI固定Pin、同一Sessionの外部Harness送信・SUI↔SHO↔TEI実共同Read/Write、Owner Meaning受理、T2価値は本節では**未実行・未採用**。既存正本・EffectのOwnerへ戻す。

<!-- sui-raw-evidence-crosslane-20261112 -->
### 18.13 SUIの選択正しさ・Harness配送・共同接続・認知価値を別々に実証する

11月12日以降の[TAI #271](https://github.com/hat47x/tai-pleroma/issues/271)、[Draft #629](https://github.com/hat47x/tai-pleroma/pull/629)、[TAI #168](https://github.com/hat47x/tai-pleroma/issues/168)、[SUI #3400](https://github.com/hat47x/sui-sensemaking/issues/3400)を踏まえ、§18.7〜18.12の選択資格と外部Harnessの実行資格を**独立の四つの観測列**に切り分ける。これは共通ランタイムの追加や新しい正式Gate名ではなく、既存Ownerへ実験結果を返すための比較方法である。

| 観測列（便宜名） | 当該Ownerが実際に示すこと | 示さないこと |
| --- | --- | --- |
| **S：SUI単独選択** | AI OFFで、既存Card/Island/Readerの安定した選択、対象補正、元Source/Revision再解決、非公開要素の非露出、保存/再開の実Outcome | 外部HarnessがToolを読めること、AIの認知増分、別製品での操作資格 |
| **H：Harness単独配送** | 実OS read-deny・実送出byte・Tool args/Reply完全性と終端・受け手のContext、適格Session/隔離 | SUIの意味構造、現在のSUI Grant、元資料の全件性、GUIが使いやすいこと |
| **J：SUI×Harness同一Attempt接合** | **SとHの両方が対象範囲で成立した後**、同じPin/Source/Scope/Request/Tool Reply/Recipient表示が正しく結びつく。遅着・別Audience・切断でも誤適用しない | Session共通化だけでOwnerのMeaning受理やBusiness Effectが生じること |
| **C：認知的な価値の差** | AI OFFの通常KJ、一般的なAI提案、CSWの仮の分類/島案を同じ実務資料と条件で比較し、関係発見・異論維持・再開・誘導害/操作負荷を別観測 | Jの通信成功だけでSUI/CSWの価値が生じたこと、内部DogfoodをT2と数えること |

**実施順**：SとHは相互を待たずに小規模な独立検証を進める。Jは**適格な実Product/実Harness**に限定して後段で同一Attemptを試す。CはSUIの基本価値[#3400](https://github.com/hat47x/sui-sensemaking/issues/3400)/ADR-0089を基準に、AI OFF・非Harness利用を有効な対照とする。Hの基線は[TAI #168](https://github.com/hat47x/tai-pleroma/issues/168)のG0物理Read拒否→G1送出→G2 Tool Reply完全性→独立H2/H3比較の順を変更せず、SUI選択UIを初回の追加Blocking条件にしない。複数画面同一Live Sessionが非対応なら、用途限定Activity Handoffを別Sessionで試し、同一Session成功と称さない。

Sの必要要素を明示する最初の試験は、Syntheticの6〜12件で、同文別Item・同Itemの別表示Occurrence・未レビュー/伏せられた島・動的候補Qと人の除外E/追加A・元Source改版を組み合わせる。**表示が同じでも内部Identityと意味が一致するとは限らない**ことを必ず含める。現行DocumentV1でできることと、将来論理Item/Canvasに必要なことを別列にする。

### 18.14 未整理Itemの「保管できた」と、後日読めるEvidence/Sourceの関係を分離する

[TEI #4307](https://github.com/hat47x/tei-platform/issues/4307)、[#4481](https://github.com/hat47x/tei-platform/issues/4481)、[#4493](https://github.com/hat47x/tei-platform/issues/4493)、[#4494](https://github.com/hat47x/tei-platform/issues/4494)、[#4503](https://github.com/hat47x/tei-platform/issues/4503)の**保管と限定取得の設計・負例**を、SUIのRaw/Inbox/ReaderのConsumer試験へ接続する。TEIのEvidenceをSUI Itemへ全面移管する、SUIに全Evidenceを自動登録する、KON Dataspace/汎用Evidence Registryを新たな必須基盤とすることはしない。

まずSUIの「保存」操作で、(a)利用者が残した**Item identity**、(b)実Raw bytesまたは外部Locatorの**Content/Source reference**、(c)保存・取得・観測した**revision/attempt/status**、(d)人間が後から付けた**見立て/Role/Review**、(e)Canvas上の**Display Occurrence**を独立して説明できるかを検証する。Rawの同一hashはbyte一致の証拠に限り、異Source/出典・実体の同一性やレビュー資格は自動統合しない。大量Rawを投入した時点でTask/Graph/OKF Conceptの強制生成を行わない。

**参照の4段階の必要な違い**：
1. **登録のみ**：URLやLocatorを保存。内容未取得なら実byte/全文検索・オフライン再読込成功を主張しない。
2. **Raw保管**：ローカルContent Storeなどに実byteを保存した事実を示す。受け取ったbyte列・時刻・Scopeを追跡し、再Readに成功するかは別。解析・Index・意味の確認は任意。
3. **参照結合**：元Source/Revision/取得位置/実byte digestとItem/抽出Candidateを明示的に結ぶ。移動・同名異物・A→B→A・Catalog消失では歴史的参照を残し、現在の根拠としてはunresolved/partialを返す。
4. **用途別の取得／共有**：必要集合・現在のGrant/Disclosure/Recipient・実Read Scopeを確認し、AI/SHO/TEIへの限定Projection/送出を明示操作にする。Locatorやdigest、存在件数、private catalog自体も機微情報になり得る。**閲覧/Pin/read-onlyという表示だけで外部Network read・cache write・uploadゼロを保証しない**。

**Git連動と物理保管の関係**：GitHubにRaw/証拠の実体や存在情報を送らない`local-only`も成立させる。Git-linked-privateではGitはSourceの版、Raw/証拠の実体はローカル/NAS/S3等、Git→Manifestの紐付けはGit外のprivate catalog/receiptで管理可能な候補とする。これはTEI #4307の設計Profileを参照する比較であり、SUIの標準Storage Mode Enum採用ではない。GitHub公開を絶対条件とせず、Local-onlyのReader／既存SUI保存機構を最小基線とする。

**復元の反例**：Raw blobだけ復元してもどのSource/Itemに結び付くか不明なら`unresolved`。catalogだけ復元してblob欠損なら`unavailable/partial`。Remote Put ACKだけで後日のReader再取得・世代一式の完全性・Owner受理を保証しない。永続Evidenceの保全/Retention・Cache eviction、権限とGCは[TEI #2845](https://github.com/hat47x/tei-platform/issues/2845)等の既存Ownerと比較し、新しい強制的な共通保管サービスを先に作らない。

### 18.15 最小利用経路と技術反例：Raw→Reader→Pin→限定Handoff

**最短の縦断は、まずSUI単独で**「未整理Rawを保存→Inboxで見つける→Readerで実Contentを再取得→人が範囲を選択・Pin→抽出CandidateをKJに配置→元Rawへ戻る」。次にAI OFFのまま複数Canvasの非干渉を試し、必要性が認められた時にだけ外部Harness、SHO、TEIの限定Consumerを接続する。従来の3 Card KJの最小価値を壊さない。初期段階でNAS/S3、数万Item、Graph全域索引、全製品公開UIを必須にしない。

| 既存Ownerへ戻す対照 | 入力・変更 | 期待する実Outcome／禁止推論 |
| --- | --- | --- |
| **SIR-01**：SUI §17 SI-RAW01/02・TEI #4307 GL-01 | GitHub未接続で長文Rawを一件保管、別プロセスで再読、URLのみ別Item登録 | 長文はContentを取得できるか否かを実Readで判定。URLだけの登録はunknown/unfetched、GitHub送信0。強制Card/Role/AI呼出し0 |
| **SIR-02**：SI-RAW03/05・TEI #4493 DR-02/03 | 同byte別原典、blobのみ／private catalogのみ別Workspaceへ移行 | byte identityとSource/Item identityを別扱い、必要根拠が復元できなければunresolved/partial。元位置や人間Reviewを偽造しない |
| **SIR-03**：SI-XC01/05・SUI #3400 SV-06/09 | 同Itemを二Canvasへ、別Itemに同じ本文、Readerへ元範囲復帰 | Display Occurrenceは別、元Item/Sourceは維持。説明・配置が一致しても元Worldの同一を推定せず、表示削除だけでSource削除しない |
| **SIR-04**：SUI HSC-A/B/L・TAI #629/#271 | Q候補12件→人が1件除外1件追加→Pin後にSource/Grant変化 | S=(Q−E)∪Aの選択意図を保持し、現在のRef/Source/Scope/Grant不適格なら書込/外部送出0。履歴上のPinは残る |
| **SIR-05**：TEI #4503 EC-06/07/08/09・SUI SI-RAW08/09 | 3 Evidence必要・2件のみ実取得。Redacted 1件のみ外部送出、Tool Reply途中切断 | Required closure partial、Rawは非送出。事前予定とcache/Network実作用、生成済みbyteと実Consumer受領を別列 |
| **SIR-06**：SUI #3391・SHO #31〜33・TEI #2497 | 元SHOから選択RawをSUIで構造候補化、別Markdown Draftで再開 | 原Source/Scope/Document/StructureのRevision、公開Loss、実Reader/Writer再Readを独立記録。元SHO/SUIの無断上書き、意味受理の自動昇格0 |

**評価・判断**：SIRは**既存の独立Expectedへ紐づけるための照合票であり新しい第二テスト正本ではない**。原Itemへ戻れた割合、必要な手数、誤った二重カウント、AI OFFでの関係発見、引用位置再到達率、実送出の限定率、権限/失効誤適用をそれぞれ観測する。SUI本体の価値T2は[ADR-0089](adr/ADR-0089-product-value-canon.md)/[#3400](https://github.com/hat47x/sui-sensemaking/issues/3400)を正本とし、技術Fixtureの合格をT2に加算しない。

**Owner/工程**：SUI Item/CanvasとReaderはHybrid計画/§17・#3400、異種Sourceは#3401、外部投影は#3368/#3391/#3392、SHOのWriterはSHO #4/#19/#20、TEI Evidence Store/Private Catalog/ProviderはTEI #4307/#4481/#4493/#4494、意図・取得・開示は#4503/#2516/#2515、Harness実配信とSessionはTAI #168/#271/#232。分担を変更しない。新しいStorage/Role Registryや中央Agent Loop、NAS/S3のSUI必須化は**非目標**。

**現時点の証拠と未完了**：本節は2026-11-12の横断設計・利用順の整理のみ。S/H/J/Cの実照合、SIR-01〜06、新しいSUI Raw Item DB・本番Reader改修・二Canvas UI・Local CAS→SUI正式Binding、NAS/S3・外部Harness実送出、SHO正式Writer、TEI Role/Meaning、実T2はこの追補では**NOT RUN／NOT ACCEPTED**。過去のGitHub Doc Readbackや合成CI成功から本実装のPASSを導かない。

<!-- sui-consumer-claim-ceiling-20261112 -->
### 18.16 最小実装への引渡し票：現行DocumentV1で証明できる事柄から始める

§17〜18.15の広い設計を、**最初の実Product試験で証明できる有限の縦断**へ縮約する。ここでのOwnerはSUIの既存Hybrid計画、価値の判定は[ADR-0089](adr/ADR-0089-product-value-canon.md)と[#3400](https://github.com/hat47x/sui-sensemaking/issues/3400)。SHO/TEI/KONに新たな実装依存を設けない。

**2026-11-12時点の実コード照合による制限**：
- [`frontend/src/domain/types.ts`](../03_Implement/frontend/src/domain/types.ts) の`DocumentV1`は`cards[]`、`edges[]`、`islands[]`とCanvas座標を保持する。一方`Card.meta.source`は**原資料へ戻るための自由記述**であり、検証済みSource ID/Revision/Raw bytes/spansを保証しない。文字列の一致・リンクらしさを根拠受理としない。
- [`backend/src/sui_sensemaking_api/routes/docs.py`](../03_Implement/backend/src/sui_sensemaking_api/routes/docs.py) は保存済みDocumentの`GET /docs/{doc_id}`とDocument単位のETagを持つが、**agent credential側は伏せられた内容からの漏えい防止でETagを公開しない**。そのため利用者内部のCASと外部Agent/SHO Consumerが同じRevision資格で操作できると解釈しない。
- 同ファイルの`GET /docs`は`limit <= 500`・`X-Next-Cursor`の一覧。現[MCP #3419](https://github.com/hat47x/sui-sensemaking/issues/3419)は最初のページのみのmetadata探索を静的に指摘している。Inbox/探す機能のPoCでは**未列挙と不存在を必ず分離**する。
- Rawの任意媒体Reader、Raw Source Reference Store、新しい全域Item ID、Display Occurrence独立永続化はこのファイル群からは**実装済みと確認できない**。既存Document保存をそのまま「汎用Raw Item Storeの完成」として扱わない。

**差分を小さく保つ段階引渡し（入口／出口の独立実観測）**：

| Slice | 実装・検証の入口とOwner | 独立したExit／実装しないもの |
| --- | --- | --- |
| **R0 現行Baseline** | 既存DocumentV1を2件（Card3枚／同文別Card、Held/Island含む）保存。別Process/ブラウザで再Read、既存ETag/CASとSafeMode・元Cardへの戻りを観測。SUI既存API/テストがOwner | 保存前後と再Read実bytes/構造の一致、選択外/未レビューのAgent向け非開示、途中失敗/409診断。新Item Schema/Graph Engineなし |
| **R1 Raw最小Slice** | 小さい日本語長文Rawと外部URL Locatorを各1件。**技術選択前に**既存Document添付で足りるか、明示されたローカルSource Readerを薄く接続するかをFit/Gap比較。独立Raw正本を先に発明しない | 長文の実保存→再起動→Readerの対象byte readback、URLのみはunfetched、元Raw改版時の引用候補stale。実Readerがないときは`unavailable`とし成功にしない |
| **R2 Human Extraction** | 人がRaw上の実範囲を選び、原資料位置と版を持つ抽出Candidateを既存Card表示へ繋ぐ。SUIの意味形成はAI OFFで行う | 「元Rawへ戻る／元Rawとの差を見る」が成立し、候補と原文の同一性を分離。元にない理由を勝手に作らない。Card.meta.source自由記述だけで精密spanを装わない |
| **R3 Select/Share試験** | Headlessで同Card別Canvas表示の**合成Occurrence**、人のQ/E/A補正、Reader/Rawへ戻るルートを比較。SHOへの実Raw引渡しと公開Harnessは別Owner | 本体1・表示2・別Source同文の区別、含める範囲と送出scope、返答の起点Pinの適格性。不適格/非公開は遮断。**合成Occurrenceを二Canvas永続化済みと記録しない** |

**判断点**：R1が実Reader/source spanを既存構成で表現できない場合、最小Blob/Source Bindingの採用案を比較し、**どの欠落のために新しいデータ境界が必要なのか**を独立Evidenceで示す。新テーブル／新API／新Providerはその証拠と別のOwner採否がある場合だけ起票する。R0〜R3を必ず直列化せず、固定Fixture準備・Headless読み取りは安全に並走できる。

### 18.17 Consumerの成功主張に上限を持たせる：SHO G5負例からの横断反映

[SHO #44](https://github.com/hat47x/sho-composer/issues/44)は、G5のテスト用RunnerでAの実行経路を「外部Harness名」で**ラベル表示しただけ**なのに実Session起動の証拠と誤読できること、Bへ不正Scopeを渡していないのに全体`widenedScopeRejected=true`と宣言したこと、Network/OS全Sinkを監視せず「無断送信なし」と宣言したことを、**実Source/Receipt照合で発見**した。Runner修正とB側負例実行は別途未完了。SUIからのHandoffでも、表現が整っていても実観測を上回る成功Claimを出さない。

| Claim（外部に言える上限） | 実際に観測するWitness | まだ言えないこと |
| --- | --- | --- |
| `source-read` | Source/Readerの実bytes・digest・Locator/RevisionとRead/Scope | 原典が正しい、現在も必ず取得可、必要全員分をRead済み |
| `candidate-built` | SUI内部の限定Projection・Loss・対象ID/Kind・Source/開示Scope | SHO/AI/TEIが受領、原Worldへ逆編集可能 |
| `handoff-attempted` | Tool/Process実呼出・送信予定範囲・実bytes・Recipient・Attempt ID | 受け手が全文を受理した、送出外の全Sinkが空 |
| `consumer-read` | **受け手の実Process**でbyte数・Digest/終端・実Parser出力を再Read | 実Harness同一Session接続、正式Editor Save・Owner意味受理 |
| `save-verified` | Saveの実Response・別Reader再Open/世代・必要ならCAS/Grant照合 | 外部Task/業務Effect、古い出典の現時点適用、Retention |
| `effect-verified` | 実Host/Providerの独立Read/Effect Receiptと現在権限・同一Attempt | モデルMeaning受理や未観測第三者への無送信 |

**実験の観測列**：SUI Producer/Reader、SHO Consumer/Writer、外部Harness Loader/Tool/Session、Host/Network、TEI/Providerを一列の単一Booleanへ畳まず、各段で`observed / not-run / unknown / refused / partial`と、対象/Source/実観測地点を記録する。新しい正式Status Enumや共通Receiptを宣言しない。内部Script/テスト引数の`--harness`ラベルと本物のAgent起動は区別。Aで拒否した負例を未実行のBに流用しない。Consumerがdigest一致でも、開示スコープ外や未公開SourceがOS/Tool/Networkへ出ていないことの全証明にはならない。保護判断はADR-0111、TAI #232、TEI #2515/#2516と各Hostに戻す。

### 18.18 負例の先行順位・停止条件・設計の収束

既存SI-RAW/SI-XC/HSC/SIR、SHO #44/TEI #4503の独立Expectedを**第二の試験正本へ転記せず**、最初のR0〜R3で判別力が高い反例だけ先に接続する。

| 選ぶ反例 | 結果の要求 | 主たる引渡し |
| --- | --- | --- |
| **AC-01 現DocumentとRawの境界** | DocumentV1の再Read成功と新Raw Reader成功を別列。現APIで未提供なら`not-supported`、架空のSource Spanは0 | §18.16 R0/R1、SUI #3400、SI-RAW01/02 |
| **AC-02 同一文字列と別出現** | 同文別Sourceを統合せず、同Item別表示を別根拠数にしない。DisplayとSourceのIdentityを区別 | §17 SI-XC01、§18 HSC-G、SHO E0 |
| **AC-03 不完全な探索** | 501件目を最初のページだけで検索したら`not-enumerated`とし、存在しないと主張しない。認可範囲外ID/件数は漏らさない | SUI #3419、SI-RAW09 |
| **AC-04 Recipientなしの偽PASS** | 未起動Harness名、未実行B負例、途中切断Replyに成功判定0。生成済みファイルの存在で受領/保存/正式意味受理を宣言しない | SHO #44、TAI #168/#271、§18.17 |
| **AC-05 読取でも起こる作用** | Raw FetchがCache File作成/Networkアクセス/Credential利用を伴うなら、許可条件と実作用を表示。read-only表記を無送信/無書込の証拠にしない | TEI #4503 EC-06、#3182、ADR-0111 |
| **AC-06 実保存後の紛失・競合** | 保存成功応答が消えても自動重複適用0。別Readerの現状態と元Item・保留/異論を再Readし、不明Commitを成功/失敗に作り替えない | SUI #3399 CU-09、TEI #4307、§18.14 |

**終了条件（次の設計追補を自動で増やすより優先）**：R0/R1で(1)現製品でできることとRaw固有の欠落が再現可能、(2)Required Source/Reader/Disclosureの何が不明か説明できる、(3)一つの実資料に出典回帰できる、の各判定を**実行結果**として揃える。これらが揃わない限り、SUIに新汎用Document/Graph/Reader Store、KON中心集約、独自Harness Loop、外部Task実行の実装計画を先行しない。逆に小さい既存Store/Readerを通せば実証できる場合、新たな共通Core提案へ進まない。正式に足りない機能・試験は各Ownerの既存Issueへ帰属させ、Docsのみの累積をProduct PASSとしない。

**資格**：本節はSource確認に基づく計画とClaim Ceilingの設計。R0〜R3のSUI実試験、AC-01〜06、SHO G5 Runner修正、実OS/Network egress、二Canvas永続化、任意媒体のRaw Reader、正式SUI→SHO/TEI保存、Owner受理、実務T2はいずれもこの追補では**NOT RUN**。

<!-- sui-r0-r1-implementation-and-crossproduct-facts-20261112 -->
### 18.19 11月12日夜の実証更新と実装引渡し：設計追補の増殖を止め、R0/R1を実測する

**本節は最新実績の資格修正と作業の引渡し**であって、新しいSUI基本データモデル・TEIの共通Context型・新Handoff v2を提案するものではない。§18.18の「次は追加文書より実Source→Reader→再読取を優先」を維持する。

**実装担当Issueを起票：[SUI #3438](https://github.com/hat47x/sui-sensemaking/issues/3438)**「R0/R1：現行DocumentV1実再読込と未整理Raw Readerの最小Fit/Gap」。既存Hybrid/ADR-0089/#3400の価値正本は変えず、次を**Product実試行**で確認する：現Documentの保存→別Process/Reader再取得、SafeModeとagent非公開境界、URL登録のみとRaw bytes取得の差、同文別Sourceと同Item別Occurrence、501件目以降の未探索、競合/ACK不明の停止線。RIR-01〜07は既存SI-RAW/HSC/AC・#3399/#3419に対応する**実装引渡しの独立Expected**であり、第二のScenario SSOTを立てない。

#### 最新の横断成果の受入範囲

| 更新・実出典 | 実際に成立した範囲 | SUIに適用する条件と、なお未成立の範囲 |
| --- | --- | --- |
| [TEI merged #4507](https://github.com/hat47x/tei-platform/pull/4507)、[Draft #4504](https://github.com/hat47x/tei-platform/pull/4504) | ModelFingerprintの入力非破壊・自己参照排除、DiagramのAuthorityLimits保持がmain修正済み。#4504では同Manifest/同World FPでも別Workspace Rootのread-only対照を追加、exact HEAD Health成功 | SUIにも内容・digest・同名だけで別Workspaceや別ItemへPinを移すことを禁止。Root/Scope/現在Source/Grantは別照合。TEI GUI実Pinは[#4515](https://github.com/hat47x/tei-platform/issues/4515)で未実証 |
| [SHO merged #47](https://github.com/hat47x/sho-composer/pull/47)、[TAI merged #640](https://github.com/hat47x/tai-pleroma/pull/640) | G5のB側が**今回Consumerを動かさず過去Receipt JSONを再出力するだけでも**A/B形式一致を作れる反例を実試験化。CIは限定Consumer/Runner範囲 | SUI ProducerのReceipt・SHA一致を、SHO/外部Harnessが**このAttemptで**今のSourceを実Readした証拠にしない。現在の受信側Process・実byte・対象/Scopeの再確認は別資格。新しい署名/Nonce必須化は提案しない |
| [TEI #4350](https://github.com/hat47x/tei-platform/issues/4350)／[S1](https://github.com/hat47x/tei-platform/blob/main/tools/reference-facet-mapping-check/README.md)／[S2](https://github.com/hat47x/tei-platform/blob/main/tools/reference-facet-structure-check/README.md)／[S3](https://github.com/hat47x/tei-platform/blob/main/tools/reference-representation-binding-check/README.md) | mainにFacet/Mapping・Structure・Representation Bindingの**headless read-only Reference実装と利用説明が存在**する。写像損失/曖昧/Context束縛を判別する資料として利用可能 | SUIの任意CanvasにTEI Function Data Contextの所持を強制しない。SUI Item/Island/Graph→TEIの正式Consumer接続、Rendering/UI、意味受理、外部Provider Effectは別実証。Referenceの契約判定を製品実装済みとしない |
| [TEI Draft #4514](https://github.com/hat47x/tei-platform/pull/4514) | 構造FPが同じでもSource/Authorityのみ変わる場合、DocumentDraftの図参照をstaleと判別するコード/独立Expected案がある（未統合） | SUI CardやCanvasの表示・見立てが変わらなくても、原Raw/出典・Review/Disclosureが変化したときに現在資格を再確認。Source失効の自動復権をしない |
| [TAI Draft #633](https://github.com/hat47x/tai-pleroma/pull/633)／[TEI #4515](https://github.com/hat47x/tei-platform/issues/4515) | GUIの選択対象・Source/Root・実Schema変更、Tool返信と現在の操作対象が独立である点をOwner別に具体化 | SUIのPin、SHOの引用span、TEIのNode/描画Edgeは各Productで再解決。SUI Island=TEI承認済み業務Relation、UI項目追加=実DB列追加、表示元ID=書込Grantという誤昇格を禁止 |

#### 実証順と次の受領物

- **最優先（SUI Product）**：[#3438](https://github.com/hat47x/sui-sensemaking/issues/3438)のR0を最初に実行し、実HTTP Save/GETと別Process再Read、AI OFF、SafeMode/ETag/競合の実Outcomeを報告する。R1でRaw専用Reader/Source Spanが現行Productに存在しなければ`unsupported`とし、足りない最小能力を**観測した差分**として返す。最初から新汎用Raw Storeを実装しない。
- **小さく並走可（read-onlyの設計適合）**：SUI同文別Item・同Item別Canvas合成Occurrence、TEI #4504の別Root/同FP、TEI S1〜S3の非単射と利用目的別`lossy/unknown`、SHO #47の旧Receipt再利用を、既存独立Expectedの対照として照合する。公開・合成情報のみを使用し、実Product接続PASSに加算しない。
- **次段（Producer/Consumerがそれぞれ適格になった後）**：公開SUI Raw/実Card一件の安全なProjection→SHO実Reader、次に同じ選択からTEIの型付きContext Candidateを**明示翻訳**。Source/Revision/Scope/必要集合・送出byte・受領Attemptを別列で記録し、旧Receiptの再利用を成功にしない。TEI/SHOのOwner Writer/Meaning/Grantはこの段階で自動移管しない。
- **後置**：SUIの製品二Canvas永続化、複数Client協調、CSWの認知増分、NAS/S3と外部Harness実Session/OS隔離、正式Task Effect。一次価値T2は[ADR-0089](adr/ADR-0089-product-value-canon.md)の基線でSUI外の実務資料から別途判定。

**停止・判定のルール**：①「Contentの保存」「Readerで実byteを再取得」「元Sourceへ適格に戻る」を一つのPASSへ畳まない。②新しいDocを書き足しただけでは、R0/R1進捗とは数えない。③Sourceが同じでも別Root/別Scopeへ暗黙再束縛しない。④G5 Receipt一致は実Consumer起動と同義ではない。⑤既存SUIで不足する事実が再現できて初めて、最小Plugin/Schema案の採否をProduct Ownerへ返す。

**実行上限**：この節自体はDocs-onlyで、SUI #3438のHTTP別Process試行、Raw Reader改修、実SHO/SUI/TEI同一Attempt、実Studio/CanvasのPin/書込、実外部Harness、Owner Meaning受理、T2は**NOT RUN**。TEI #4507・SHO #47等の実績は各々のOwnerが検証した限定範囲にのみ帰属する。

<!-- sui-r0-test-and-cross-product-20261113 -->
#### 2026-11-13：設計から実装テストへ移した範囲と、最新の横断実績

- **SUI自身の実装差分**：[SUI Draft #3439](https://github.com/hat47x/sui-sensemaking/pull/3439)で[#3438](https://github.com/hat47x/sui-sensemaking/issues/3438) R0の独立プロセス再読込回帰を新規1ファイルに実装。現行HTTP `PUT /docs/{id}`→Writer TestClientとDB Engine終了→**新しいPythonプロセス**の同API `GET`→JSON/ETag照合という実行経路を用意。公開合成の3Card/同文別`meta.source`/Hold/Island/Edge、stale `If-Match` 409、別Process 404を検査する。**実テスト証拠の追補**：[PR #3439 exact HEAD `2d0c22ee84c106ae803571c544ddc88d0eef37ee`](https://github.com/hat47x/sui-sensemaking/pull/3439) の [SUI 単体検証 #43336035937](https://github.com/hat47x/sui-sensemaking/actions/runs/43336035937) `backend-contract` で、新規2テストを明示的に対象一覧へ加え、実ログ **316 passed／fail 0／warning 1**、Ruffと契約確認も成功した。合格は合成DocumentV1+SQLite+新PythonプロセスのHTTP TestClientに限り、実Browser/Raw Reader/二Canvasを含まない。Front-end/全WorkflowやOwner受理の合否は別証拠。実Raw Reader/元資料byte span/Browser復帰/二Canvas永続化/二Client実競合はこのテスト対象外。
- **TEIの実Readが前進**：[main統合 #4539](https://github.com/hat47x/tei-platform/pull/4539)は隔離PG16でEnvironment束縛→Driver Executor実Read→Function Data Context→限定Reference CLIの実行を確認した。ただし通常`tei` CLI・Studio・SUI/SHO Consumer・現在のHost Grantは未接続。0件でも全世界での不存在を宣言せず、RLS/列欠落/NULL/Join重複と取得Coverageを区別する実証は、SUIの異種Source Readerが持つべき**消費者側の停止線**の参考に限る。
- **問いに必要な依存集合の区別**：[TEI main統合 #4550](https://github.com/hat47x/tei-platform/pull/4550)は申告Graph内の多段upstream unknownをRequired Consumerまで辿る改修。不要な依存で全成果をstaleにしない一方、必要な未取得Sourceを無視してcompleteとも言わない。SUIのReader/Canvas Pinでも「見えているカード・既知の関係の総数」と「この問いに必要で実取得済みの集合」を分ける。実Source Universeの完全性は別。
- **編集逆写像を用途別に判定**：[TEI Draft #4538](https://github.com/hat47x/tei-platform/pull/4538)の限定Property行編集では、全体Graph→Tree Projectionがlossyでも**属性Slotの編集可否を操作相対で調べる必要**が明確になった。SUIでは、Canvas表示の座標移動、Card本文変更、原Raw span変更、SHO文章への書戻しを一つの「編集可」にしない。現在のDocumentV1ならCanvas上のCard座標の編集適格性を現行CASで扱う余地があるが、Item/Raw/SHOへの逆Patchは一意な元Ref/Scope/Revision/Grantを別に要求する。TEIの編集Ref結果をSUI実編集PASSへ転記しない。

**次の受入依存**：まずSUI #3439の実Backend CIを確認し、RIR-01とRIR-03の限定範囲・失敗・未検証を#3438に記録。次にRaw実byteのSource Reader/Fit-GapとR2の人手抽出へ進む。**PR #3437は設計のReview用、#3439はProductコード/試験のReview用**として分け、共通Store・新Harness・第二Expected正本を先に採用しない。


