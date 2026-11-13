# ロードマップ

価値の定義と、現在の証拠の状態は、[`ADR-0089`](01_Plans/adr/ADR-0089-product-value-canon.md) が正本です。

SUI Sensemakingは、まとまりきらない定性の資料や観察を、早すぎる分類、要約、合意でつぶさず、出典、異論、保留、来歴を残したまま構造化し、あとから根拠に戻れる、共有できる理解へ育てる道具です。1人の開発者が、生成AIを使って開発しています。

## 上位課題

外部のAI、TEI、TAI、MCPクライアントがSUIの意味形成へ関与するとき、出典、異論、保留、人間の判断権を失わず、接続の方向と権限を一箇所で説明できるようにします。読み取り投影、handoff、提案ingest、送信の四類型と、接続ごとに書く5点の宣言は、[`ADR-0111`](01_Plans/adr/ADR-0111-meaning-preserving-external-cognition-interface.md) が正本です。

## 中核の原則

- 意味を急いで閉じない（曖昧さの保持）。
- 人間が決める。AIの出力は提案だけを出し（proposal-only）、`human_reviewed` は人間だけが設定する。
- SafeModeを既定にする。
- オフラインや自前のホストを選べる。`SUI_LLM_PROVIDER=none` でも、主要な価値が成り立つ。
- 出典、異論、保留、判断の履歴に戻れる。

## 現在地

次の機能は、実装済みです。KJ法のキャンバス、島、関係、保留、SafeModeでの共有と書き出し、インポートの堅牢化、外部のAIとの提案のやり取り、LLMの入力の中間表現（`AI-IR-PROJECTION` が完了）。カードと島の違和感メモは、現在値と改訂履歴を分けて保持し、以前の見立てへ戻せます（`ADR-0099`）。島の作成・カードの追加/除外・保留状態の変更は、現在の構造とは別の履歴として残り、後から理由を追記できます（`ADR-0100`）。

外部のAIエージェントへの読み取り専用の接続も実装済みです。`03_Implement/mcp` のMCPサーバーは、`get_context_projection` で文書の文脈の投影を、`get_proposal_status` でAI提案の状態を返します。書き込みのツールはありません。エージェントは、テナントに結び付いた資格情報（`ADR-0093`）か、OAuthのトークン交換（`ADR-0094`）で認証します。投影は、カードと島の単位ごとのdigestを持ち、単位で版を照合できます（`ADR-0103`）。TEIのepistemic reference artifactは、読み取り専用のAPIで渡せます（`ADR-0101`、`ADR-0102`）。接続手順は [`mcp_agent_connection.md`](04_Documentation/mcp_agent_connection.md) にあります。

## 未完の作業と、次の作業

1. **`check-narrative` の規模への対応**: 現在は全量を送る。DeepSeek（`deepseek-flash`）で、300カード・30島の全量を合成データで測った（2026-10-09）。入力はプロバイダ報告値で約10万トークン（20回ずつの評価は、物語が全カードに触れる形で約4.7万トークン）、APIが報告する文脈長は1,048,576トークンで、全量は収まる。1回は約3〜8秒、約0.03ドル（ピーク時の上限見積もり）だった。ただし、島を1つだけ物語から欠いた入力では、思考モードの影響が大きい。`scripts/evaluate_check_narrative_omission.py` で20回ずつ測ると、DeepSeek（`deepseek-flash`）は思考モード `enabled` で20回中20回検出し（Wilson下限0.84）、欠かさない対照20回のうち誤検出は2回だった。無料枠の OpenRouter の `nvidia/nemotron-3-super-120b-a12b:free` は、`enabled` で20回中11回（下限0.34、誤検出0）、`disabled` で0回だった。無料モデルは最終判断の基準（下限0.8）を満たさず、最終判断には使わない。分割は要らないと判断し、最終判断のタスクは既定で思考モード有効にした（`SUI_DEEPSEEK_THINKING_TASK_MAP` でタスク別に上書きできる。管理者がタスクの種類ごとに個別設定する仕組みは今後の課題）。ローカルのOllama（qwen3.5:4b、GPUなし）は、他の処理と競合するCPUで約1万トークンの入力に15分以上かかり、全量の検証には使えなかった。
2. **価値の検証**: T3のパイロット（2026-10-02）では、H1は絞り込み（narrow）、H3は修正（modify）、H4は絞り込み（narrow）になった（`ADR-0089` の5節、`provisional`）。次は、T2（自分の実務での利用）で確かめる。
3. **初回の体験**: 完了。`保留` と `未決` は実務上の違いがないため統合した（`00_Prompt/domain.md` DOM-CORE-01）。統合後も教程を実画面で通し、サンプル、島、保留と違和感メモ、保存、再読み込み、共有前チェックが動くことを確認した（2026-10-10）。
4. **認知支援のT2での確認**: `ADR-0090` に従い、まず、プロバイダを使わない決定論的な候補を、Maintainer自身の、SUI以外の実務の資料で確認する。候補を見せる前と後で、「新たに注意した材料」「構造の見直し」「保留と異論の維持」「ノイズや誘導」を分けて観察する。T2で認知の増分が再現しなければ、製品の候補に昇格させない。下位の方式では埋まらない欠落が残るときにだけ、軽量な統計の方式と疎な方式を、次に検討する。
   - 実行の補助: バックエンドのルートで、`python scripts/review_cognitive_candidate_t2.py --document <DocumentV1.json> --phase baseline` を先に実行する。出力された3つの問いへの事前判断をローカルのメモへ保存し、同じ出力の `Baseline receipt` を控える。そのあと、文書を変更せずに `--phase candidates --baseline-receipt <receipt> --baseline-observation <note-file>` を実行する。候補フェーズは製品APIと同じ決定論ロジック、`focusPairs`、hold除外、複雑性上限を使い、候補集合そのものに `Candidate receipt` を付ける。候補を確認した後は、出力された6軸のJSON雛形へ「注意移動」「構造再考」「保留・異論維持」「ノイズ・探索の狭まり」「候補なしでも到達した可能性」「複雑性予算」をそれぞれ独立に記録し、`--phase outcome --baseline-receipt <receipt> --baseline-observation <note-file> --candidate-receipt <candidate-receipt> --post-observation <json-file>` で検証する。baselineと事後観察の本文は出力へ再掲せず、SHA-256とbyte数だけを残す。`Source SHA-256`、`Attention sourceDigest`、`Attention methodId` がbaseline・candidates・outcomeの3段階で一致することを確認し、評価対象が同じファイル・同じ構造断面・同じ候補生成方式であることを確かめる。このreceiptとメモの必須化は操作順の取り違えを防ぐための手順上のゲートであり、記録時刻そのものを暗号学的に証明するものではない。IRが切り詰められた場合、有効候補が製品の複雑性予算を超えて候補集合全体が抑制された場合、または同じカードが複数の視覚島へ属して共有IRでは損失なく投影できない場合は、候補の有無や認知増分を評価せず、そのT2実行自体を無効として扱う。横断的な所属を一方の島へ勝手に縮約しない。複数の方法核・観点・分類への所属は `DocumentV1.affiliations` で包含と分離して可逆に表現し、attention支援では既存の人間グルーピングとして扱う。T2 baselineもAffiliationを現在の人間構造として各島の下に明示し、Affiliation済みカードを未所属扱いしない。

5. **文化的体系を参照した認知支援の段階計画**: SUIの一次価値への寄与から、①根拠へ戻って理解を見直す、②異論・保留を残して別の構造を比べる、③理解の差を次の観察と再開へ引き継ぐ、の順で[計画案](01_Plans/cognitive_cultural_validation_plan.md)へ取り込む。利用場面、最小範囲、受入条件を具体化済み。第2計画では四句分別・ジャイナの条件付け・易の仮の反転を選択可能な操作として試す。実務の有用性は未確認であり、通常の方法と同等の問いを比較に含め、同じ摩擦と認知増分がT2で再現した範囲から実装へ進める。体系にもとづく深掘りは[発想資料](02_Architecture/cognitive_cultural_ideation.html#depth-cases)で継続する。
   - 追加した計画範囲: [表札の射程と残余](01_Plans/cognitive_cultural_validation_plan.md#product-label-scope)、[発言の根拠と解釈](01_Plans/cognitive_cultural_validation_plan.md#product-statement-basis)、[文脈から補った条件の比較](01_Plans/cognitive_cultural_validation_plan.md#product-inherited-context)、[不明点を残した停止・再開](01_Plans/cognitive_cultural_validation_plan.md#product-inquiry-stop)の順で具体化した。原文・元カードへの回帰と異論の非破壊を先行させ、既存の表札・根拠・比較・引継ぎを使う最小差分から試す。発想資料の深掘り例を4件から8件へ増やし、文化的な由来と対象側で確認すべき範囲を分けた。
   - 次は[表札から元カードへ戻る実務試行](01_Plans/cognitive_cultural_validation_plan.md#first-practical-trial)を行い、[残った不足から実装範囲を絞る](01_Plans/cognitive_cultural_validation_plan.md#next-implementation-scope)。既存の違和感メモ・構造の判断履歴へ接続し、履歴の上限とSafeModeでの共有範囲を区別する。第2計画では[華厳由来の全体と部分の比較](01_Plans/cognitive_cultural_validation_plan.md#product-whole-part)を深め、同じカードの役割の変化と原文に残る違いを比べる。実務試行は未実施であり、新しい製品機能の採用は確定していない。

6. **外部agent連携の判断**: 主要な未決は決着した。段階2の提案ingestは必要性が観測されるまで作らない（`ADR-0108`）。境界だけを先に宣言し、認可・未レビュー・監査・undoの条件を固定した（`ADR-0112`）。TEI epistemic projectionのtransportはSUI所有のローカルadapterとする（`ADR-0101`）。TEIの確認状態はSUIの`human_reviewed`へ写さず、intentのoutboxをhandoff境界とする（`ADR-0110`）。残るのは、outboxをTEIへ送る必要が生じたときの送信ADRと、実利用者による操作検証である。操作検証は、#3346 のclose時に外部協力者の確保を完了条件から外し、`ADR-0089` の証拠階層のT2/T3の範囲で記録すると組み替えた（`ADR-0110` §2）。

機能の追加より、価値と認知の増分の確認を優先します。実際に使って、同じ摩擦が再現したものから、実装に昇格させます。

## 実施順：原資料から情報統合へ（提案・未採用）

[段階的な受入計画](01_Plans/information_integration_stage_gates_2026-11.md)に、Hybrid Tree/KJ・異種情報統合・TEI/SHO等の横断検討から、**今着手する最小の製品縦断と後段の依存順**を整理した。一次価値・安全・外部接続の正本は引き続きADR-0089/0041/0111。計画を文書化しただけで製品機能を実装・承認したとは扱わない。

| 順序 | 内容・停止線 | 管理先 |
| --- | --- | --- |
| **IG0→IG1（最優先）** | AI OFFの3 Card KJを維持し、Raw Readerで人が選んだ原文範囲をCard化→保存→別Process/Browserから**同じSourceの同じ位置へ再到達**。Root/Scope/Revision/Grantを独立再検査。R0/R1は限定Draft試験で、R2製品縦断は未実証 | [R0/R1 #3438](https://github.com/hat47x/sui-sensemaking/issues/3438)、[R2 #3441](https://github.com/hat47x/sui-sensemaking/issues/3441) |
| **IG2（R2の後）** | 2つの独立Raw資料でCard間の関係候補・矛盾・保留を残し、個別Sourceへ復帰。同文別出典・別Root・改版・SafeMode・409/ACK不明を検査 | [情報統合 #3401](https://github.com/hat47x/sui-sensemaking/issues/3401)のIB-01〜06 |
| **IG3以降（需要で選択）** | 構造化CSV/時系列、Tree/複数Canvasの独立Occurrence、表示横断、SHO文章化・TEI型付き投影へ段階拡張。Graphの向き/多重性・Loss/未解決・Source scope・読取/書込資格を別検証。PERT/Task同期や中央Query/Storeは必須にしない | [情報統合 #3401](https://github.com/hat47x/sui-sensemaking/issues/3401)、[Hybrid計画](01_Plans/hybrid_outline_canvas_layout_plan.md)、[SUI→SHO #3391](https://github.com/hat47x/sui-sensemaking/issues/3391) |

**統合時の非干渉**：同一ItemのA/B Canvas表示で座標・島・Tree・意味Edgeは独立。Reader/KJ/Tree等の表示選択は現在Scope/版/Disclosureで再解決し、Projectionが同一でも元Sourceや逆Writeの同一性を推測しない。AI提案のApplyはreadSet/writeSetと現在Revisionを照合し、他者のHold・異論・Reviewを上書きしない。SUI→SHO Draft、TEI Canonical候補、Agent Proposal、正式Meaning受理、実Effectはそれぞれ別の受入段階。

## 検討候補：アウトライン／マインドマップとKJキャンバスの連携

[計画案](01_Plans/hybrid_outline_canvas_layout_plan.md)と[設計案](02_Architecture/hybrid-tree-canvas-layout-design.html)に、独立したアウトライン／マインドマップUIとKJキャンバスの連携、Tree由来の薄い背景枝、マインドマップからの初期配置、島を保つ粘性付き整形、人的アノテーション、変化量制御、Undo/Redo、指定版からの部分復元を整理した。**構想段階であり、採用・実装・T2の利用価値検証は未了**。

初期の確認対象は、同じノードの親子関係・位置・島を別々に保ち、人手で形成した島や保留を自動レイアウトで損なわないこと。KJキャンバス単独の自由探索も維持する。標準データ構造やSEIとの将来連携は候補とし、既存DocumentV1の契約変更は独立判断に残す。

## 検討候補：OKFの出典・確認・鮮度をSUIの自由な意味探索へ取り込む

[OKF連携の製品要件 #3392](https://github.com/hat47x/sui-sensemaking/issues/3392)と[Hybrid Tree/KJ計画案](01_Plans/hybrid_outline_canvas_layout_plan.md)で、Card/Island/Tree/Edgeの出典、生成/確認履歴、再検討と、SHO/SEIへのLoss付きMarkdown投影を検証する。OKFをSUI DocumentV1やReviewの正本へ置き換えない。可視の知識から非公開Cardの存在を推定せず、AI/OFF・OKF Pluginなしでも手動KJ/Outlineを維持する。

**現在は調査と受入候補のみ**。最初に既存Card出典手掛かりを使う5 Cardの固定Fixtureと独立Expectedを用意し、Review/Sourceの観測範囲を確認する。Hybrid永続化、実Exporter、SHO/SEIの実受領、実利用によるT2の価値確認は未実施。全件検証や実認可に進む前にOwner判断を要する。

## 検討候補：TEI（*.tei.md＋Plugin）への移行

SUIは最終的に、TEIの`.tei.md`（Canonical定義）とPluginによる設計〜実装へ移行します。2026-11-11に、その第一段階として「許可されたSUIデータの一部を、TEIから型付きで参照するread-only経路」を実装しました（PR #3429、`ADR-0116`、`api.md` §2.18）。この経路はDocument/Card/Island/Tree/Canvas/Relation/Revision/Reviewの対応と損失を実コードで確定させましたが、**移行そのものは未決定で、第二のデータ正本は作っていません**。

SUI側で今後必要なタスクは、TEI側の[移行タスク分解](https://github.com/hat47x/tei-platform/blob/main/plan/design/SUI_TEI_MIGRATION_TASKS_2026-11.md)（`hat47x/tei-platform` の `plan/design/SUI_TEI_MIGRATION_TASKS_2026-11.md`）にM0〜M6として整理済みです。

2026-11-12時点の現在地:

| 段階 | 状態 | 根拠 |
| --- | --- | --- |
| M0 read-only参照 | 統合済み | PR #3429（main `5be212ca`） |
| M1 producer契約 | TAI側で実装済み（optional） | TAI PR #626（`source.status`・`disclosure.scope` をschemaで受理。consumerは無変更） |
| M2 Canonical定義 | TEI側で限定実装済み | TEI PR #4346・#4394（`reference/sui-adoption/workspace-m2`） |
| M6 scope conformance | TEI側で実装済み（限定） | TEI PR #4447（14経路の行列・checker）。SUI側は PR #3434 で参照routeの境界を追加済み |
| M3・M4・M5 | 未着手 | 下記の残作業 |

SUI側の残作業は次のとおりです。

1. ~~**artifact生成側（producer）との契約**~~: TAI側で optional として受理済み（TAI PR #626）。SUIは引き続き、未宣言を `unknown` として扱い `active` へ読み替えません。producer が実際に宣言を埋める運用は未実装です。
2. **本文・題名の公開判断（#3369）**: 参照経路は本文を返しません。この境界は維持します（オーナー判断の代行でも「出さない」で確定）。業務面へ出す場合の設計は M4 として未着手です。
3. **Tree/ForestとCanvas geometry**: 閲覧状態と polygon・placard を Canonical へ入れない判断を維持しました（代行判断）。第二の Consumer が現れた場合に再検討します。
4. **版の同一視**: `documentDigest`（内容指紋）と保存revisionを混同しない方針を維持。両者を別欄で持つ契約の載せ方は未確定です。
5. **review attribution**: Data としては持たず、監査・Source 側に委ねる判断を維持（代行判断）。
6. **性能**: 合成1,000カードで、参照経路は DocumentV1 方式より遅く（127ms対39ms）、payload は大きい（903KB対350KB）。用途は識別・関係・状態の伝達に限定し、速度を理由に既存経路を置き換えません。
7. ~~**越境試験のギャップ**~~: 4経路（一覧・`export-audit`・監査読み取り・import権限非継承）は既に固定済みでした。残る `cache`（browser 保存の切り替え時破棄）が TEI 側の行列で `uncovered` として可視化されています。

**撤退条件**: 参照経路が第二の正本として使われ始めた場合（artifactを保存・編集する経路が生まれた場合）、または本文が不用意に載り始めた場合、経路をread-onlyのまま閉じ、判断をIssueへ戻します。意味契約やデータ正本の変更は、正式なOwner判断まで確定させません（代行判断は設計文書 §7.1 に根拠と覆す条件つきで記録しています）。

## 将来の候補（約束ではありません）

位置づけと段階は [`ADR-0091`](01_Plans/adr/ADR-0091-positioning-for-the-agent-era.md) に従います。生成AIが普及した社会で、AIの要約の隣に置く「判断と異論の記録層」を目指し、既存の質的分析ツールからの移行（REFI-QDA）と来歴の受け渡し（W3C PROV）は、実際に必要な場面が確認されてから取り組みます。

- 大規模な質的統合（似たカードの統合、島の階層化、全体の俯瞰と詳細の行き来）。
- AIや認知器による認知の支援（`ADR-0090`）。決定論的な構造の方式、軽量な統計や疎な方式、意味（semantic）を扱う方式の順で検討する。T3は、探索の段階の暫定的な証拠（provisional Evidence）として扱い、T2で、同じ認知上の欠落と増分が再現されたときに、製品の候補に昇格させる。SafeMode、Evidence、Provenanceは、方式にかかわらず維持する。
- 文化的体系を併用した認知支援。[発想資料](02_Architecture/cognitive_cultural_ideation.html)に、23体系・実践を参照した150案を整理した。別解生成、推論と根拠への往復、理解の差分と記憶、異論別の応答、価値と規則の衝突、探索の進行調整の6方向を深めた。位置の反転と経路比較は資料内の仮設定で動かせる。まず手作業で、問いが変えた原文の読み・関係・保留・次の確認を具体的に見る。通常の方法や体系を使わない同等の問いと比べ、認知増分が残る範囲から既存の候補層への接続を検討する。研究候補の参照、発想案、操作例を、採用済みの仕様や価値実証とは扱わない。
- 定額制やオフラインのAIとの協働（外部のAIに文脈を書き出し、結果を、構造化した提案として受け取る）。
