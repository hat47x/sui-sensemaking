# ADR-0001-value-to-requirements: 価値→要件変換の判断基準

- Status: Accepted
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: `01_Plans/value_to_requirements.md`
- Norms: `DOM-AI-08, DOM-AIOK-01, DOM-AIOK-02`（P-08 の `AI-08-1`/`AI-08-2` がこれらの直接の先行要件）

## Context

`value_to_requirements.md` で管理していた計画・要件・受入条件を、ADR運用へ移管する。

## Decision

以下を本ADRの正本として採用する。


> Granularity split: 本ADRの内容は `ADR-0010`（価値原則）/ `ADR-0011`（要求マッピング）/ `ADR-0012`（計画・起票規則）でも管理する。
> 詳細更新は分割ADRを優先し、本ADRは統合ビューとして保持する。

# 価値観→要求マッピング設計（価値整合ドキュメント）

本ドキュメントは、sui-sensemaking の価値観（思想）を、Issue/Epicへ分解可能な要求に変換するための設計資料である。  
目的は次の2点。

- 価値観と実装要求の対応を固定し、スコープドリフトを防ぐ。
- 貢献者がそのままチケット化できる記述粒度を提供する。

本書は `01_Plans` レイヤの文書であり、実装詳細は扱わない。

---

## 1. 価値観（原則）

- **P-01: 意味の保留（曖昧さを保持する）**
- **P-02: 単一正解の否定 / 反スコアリング**
- **P-03: 人間レビューの追跡可能性（review flags）**
- **P-04: Human-in-the-loop反復（Critique → 再提案）**
- **P-05: カード数の可管理性（merge提案 + canonical化）**
- **P-06: 視点制御（俯瞰 ↔ 詳細）**
- **P-07: Self-host / ローカルLLM親和 / プライバシーデフォルト**
- **P-08: 定性情報への忠実性と再解釈可能性**
- **P-09: 累積的探究と中間成果の非破壊性**
- **P-10: 人間・AIの役割可変なsensemakingライフサイクル**

---

## 2. 価値観ごとの要求（UX / Data / AI）

> 形式: `UX-*`（利用者ができること）, `DATA-*`（表現/永続化要件）, `AI-*`（AIの許可/禁止）

### P-01 意味の保留

- UX
  - `UX-01-1`: 未統合・保留状態のままカードを保持できる。
  - `UX-01-2`: 仮クラスタ/仮関係を確定せず併置できる。
- Data
  - `DATA-01-1`: 要素の確定/未確定状態を表現できる。
  - `DATA-01-2`: 破棄可能なDraft案を識別できる（案ID/世代）。
- AI
  - `AI-01-1`: AIはAI Workspace / WorkingGraph内で作業仮説や構造を自律形成してよいが、それを権限確認なしに共有・Accepted・Consensus等の承認済み状態へ昇格しない。
  - `AI-01-2`: 「唯一の意味」を既定出力にしない。

### P-02 単一正解の否定 / 反スコアリング

- UX
  - `UX-02-1`: 複数案を比較し、部分採用/却下できる。
  - `UX-02-2`: 「正解」「採点」「ランキング」をUIで提示しない。
- Data
  - `DATA-02-1`: 案ごとの差分を保存できる。
  - `DATA-02-2`: 採用結果を全採用/部分採用/却下で表現できる。
- AI
  - `AI-02-1`: AIは複数候補を返せる（最低2案）。
  - `AI-02-2`: AIはスコア単独で意思決定を代替しない。

### P-03 人間レビューの追跡可能性（review flags）

- UX
  - `UX-03-1`: AI生成要素の未レビュー表示を確認できる。
  - `UX-03-2`: ユーザーがレビュー済みへ明示的に更新できる。
- Data
  - `DATA-03-1`: 要素単位で `unreviewed / human_reviewed` を保持できる。
  - `DATA-03-2`: レビュー変更履歴を将来拡張可能な形で保持できる。
- AI
  - `AI-03-1`: AI生成物は既定で `unreviewed` として登録する。
  - `AI-03-2`: AIはレビュー状態を自律変更してはならない。

### P-04 Human-in-the-loop反復（Critique → 再提案）

- UX
  - `UX-04-1`: 理由任意でCritique（違う/近すぎる等）を入力できる。
  - `UX-04-2`: 再提案時に前案との差分を確認できる。
- Data
  - `DATA-04-1`: Critique対象（カード/クラスタ/関係）と種別を保持できる。
  - `DATA-04-2`: 提案世代（iteration）を識別して比較できる。
- AI
  - `AI-04-1`: AIはCritiqueを制約として次案を生成する。
  - `AI-04-2`: 前案の単純再掲を避け、変化点を示す。

### P-05 カード数の可管理性（merge提案 + canonical化）

- UX
  - `UX-05-1`: 類似カードの統合候補を確認し、採否を選べる。
  - `UX-05-2`: 統合前後の差分確認とロールバックができる。
  - `UX-05-3`: canonical card と source card の対応をUI上で追跡できる。
- Data
  - `DATA-05-1`: canonical card と派生/別名カードの対応を表現できる。
  - `DATA-05-2`: merge提案の状態（提案中/採用/却下）を保持できる。
  - `DATA-05-3`: canonical化後も source card の参照経路を欠落なく保持できる。
- AI
  - `AI-05-1`: AIは統合候補を提案できるが自動確定しない。
  - `AI-05-2`: 意味差の大きい要素を強制統合してはならない。
  - `AI-05-3`: canonicalへの採用可否は人間操作でのみ確定される。

### P-06 視点制御（俯瞰 ↔ 詳細）

- UX
  - `UX-06-1`: 全体俯瞰と局所詳細を往復できる。
  - `UX-06-2`: クラスタ単位の折りたたみ/展開を行える。
  - `UX-06-3`: focus 操作で局所ビューに入り、解除で俯瞰へ可逆に戻れる。
  - `UX-06-4`: depth filter と peek で詳細確認できる。
- Data
  - `DATA-06-1`: ビュー状態（ズーム/フォーカス/折りたたみ）を保持できる。
  - `DATA-06-2`: 階層ビュー導入に備えた拡張点を持てる。
  - `DATA-06-3`: depth filter は表示制御として保持し、内容削除と分離する。
  - `DATA-06-4`: collapse状態とpeek情報を永続化可能にする。
- AI
  - `AI-06-1`: AIは指定された視点粒度を入力条件として扱う。
  - `AI-06-2`: 指定外粒度への一方的再編成を行わない。
  - `AI-06-3`: focus/depth filter 条件を無視した再配置提案を行わない。

### P-07 Self-host / ローカルLLM親和 / プライバシーデフォルト

- UX
  - `UX-07-1`: 外部送信なしでも基本機能を利用できる。
  - `UX-07-2`: LLM接続状態（none/local/external）を確認できる。
- Data
  - `DATA-07-1`: Provider設定を保持しつつ既定値は無効（none）にする。
  - `DATA-07-2`: 最小限の利用監査情報を記録可能にする。
- AI
  - `AI-07-1`: 既定値は `SUI_LLM_PROVIDER=none` を維持する。
  - `AI-07-2`: 外部Providerは明示設定時のみ利用する。

### P-08 定性情報への忠実性と再解釈可能性

- UX
  - `UX-08-1`: 利用者はカード本文だけで保存でき、出典、文脈、分類の入力を一律に要求されない。
  - `UX-08-2`: 分割、文脈補足、出典追加、観察と解釈の分離は、保存後または要求時に、非モーダルな任意提案として一件ずつ確認できる。
  - `UX-08-3`: 人による確認が必要な場合、理由を短く示し、「このまま保存」「今は保留」を含む選択肢をマウスとキーボードで選べる。
- Data
  - `DATA-08-1`: カードは元の意味と語り手の意図を損なわず、一つの中心的内容と、解釈に必要な文脈を保持できる。
  - `DATA-08-2`: 観察・引用と解釈・仮説、および外部の元記録・統合元カード・主体メタデータを混同しない。出典不明と未分類を許容する。
  - `DATA-08-3`: 少数意見、外れた事例、矛盾、違和感を独立した情報として保持し、分割・言い換え前の本文へ戻れる。
- AI
  - `AI-08-1`: AIはカード品質に関する分割、確認質問、文脈、出典、認識上の位置づけを候補としてのみ提示する。
  - `AI-08-2`: AIは品質の点数化、保存の遮断、文脈の推測補完、少数意見の自動削除、本文・状態・`human_reviewed` の自動変更を行わない。

詳細要件と受入条件は `00_Prompt/qualitative_card_quality_requirements.md` を正本とする。

### P-09 累積的探究と中間成果の非破壊性

- UX
  - `UX-09-1`: 通常の一ラウンド利用を変えず、必要な利用者だけが高度機能として反復的探究を開始できる。
  - `UX-09-2`: 同段階の再試行、前段階への分岐、停止・再開を、完了率や品質点数ではなく現在の問いと引継ぎとして確認できる。
  - `UX-09-3`: 引継ぎ、分岐、過去成果への移動をマウスとキーボードで行い、390px幅でも現在の問いと主要操作を確認できる。
- Data
  - `DATA-09-1`: 現在の可変 `DocumentV1` と、独立 `InquiryJourneyV1` が参照する不変 `RoundSnapshotV1` を分離する。
  - `DATA-09-2`: ラウンド段階と反復番号、親子分岐、引継ぎ、現場への問い、カード系譜を保持し、過去成果を後続編集で変更しない。
  - `DATA-09-3`: 共有・移行用成果物は参照を自己完結させ、SafeModeのマスクを元成果の書換えではなく派生bundleとして扱う。
- AI
  - `AI-09-1`: AIは段階別の問い、引継ぎ、差分、反証をproposal-onlyで提示する。
  - `AI-09-2`: AIはラウンド移行、過去成果、系譜、レビュー状態、唯一の仮説を自動確定しない。
  - `AI-09-3`: `SUI_LLM_PROVIDER=none` で作成、引継ぎ、停止・再開、分岐、比較を完了できる。

詳細要件は `00_Prompt/w_type_iterative_inquiry_requirements.md`、データ境界は `02_Architecture/inquiry_journey_model.html`、設計判断は `ADR-0057` を正本とする。

### P-10 人間・AIの役割可変なsensemakingライフサイクル

- UX
  - `UX-10-1`: 人間由来、AI由来、共同編集、未レビュー、人間レビュー済みを、利用者が必要な粒度で区別できる。
  - `UX-10-2`: AIへ一定範囲の探索・仮説形成・構造化を委任した場合でも、人間は主要根拠、反証、未解決点、差分を確認して理解・異議・承認できる。
  - `UX-10-3`: 人間主導、協働、委任、監督付き自律の役割分担を、プロジェクト全体の一律設定ではなく工程・操作ごとに選べる余地を持つ。
  - `UX-10-4`: AIが大きな探索区間を担った場合、人間は全中間試行を読むことを要求されず、Review Capsule等から主要Evidence、反証、代替案、未解決点、生成主体を確認し、元成果物へ戻れる。
- Data
  - `DATA-10-1`: Evidence、AI由来のObservation / Hypothesis / Structure / Synthesis、Review、Accepted / Consensus状態を概念上区別し、生成主体と来歴を保持できる。
  - `DATA-10-2`: AI Workspace / WorkingGraphの途中状態と、人間承認済みの正規状態を同一フィールドの暗黙上書きで表現しない。
  - `DATA-10-3`: AIが自律的に複数段階を進めても、元Evidence、保留、反証、棄却した主要代替案への参照を失わない。
  - `DATA-10-4`: Evidence / Observation / Relation / Hypothesis / Structure / Synthesis / Review / Decisionのsemantic kindを成熟度として扱わず、kindが変わる意味形成は新artifact + provenance relationとして表現する。
  - `DATA-10-5`: review、authority、lifecycle、visibility / access、provenanceをsemantic kindとは別軸に保持でき、Reviewed / Accepted / Consensus / Publicを同一状態へ畳み込まない。
  - `DATA-10-6`: Review / authority transition / Decisionは対象artifactのlogical identityだけでなく、対象revisionを特定可能にする。
- AI
  - `AI-10-1`: AIは権限境界の内側で、Observation → Relation → Hypothesis → Structure → Synthesisの複数段階を自律実行できる。
  - `AI-10-2`: AI内部の作業判断を、人間による理解・レビュー・承認と同一視しない。
  - `AI-10-3`: `human_reviewed`、Accepted / Consensus、人間の異議・承認をAIが偽装または自動付与しない。
  - `AI-10-4`: KJ法に着想を得た手順以外の認知方法を利用する場合でも、Evidence保全、可逆性、保留、来歴、権限境界を維持する。
  - `AI-10-5`: AI内部のprivate chain-of-thought保存を要求せず、検証に必要な入力範囲、Provider / Method、派生成果物、主要根拠・反証・代替案を外在化する。

長期的な役割分担と現行SafeMode / proposal-onlyの境界は
`01_Plans/adr/ADR-0084-sensemaking-lifecycle-and-authority-boundary.md` を正本とする。
意味成果物、Review、Authority、Lifecycleの直交関係は
`01_Plans/adr/ADR-0085-sensemaking-semantic-artifacts-and-authority-axes.md` と
`02_Architecture/sensemaking_semantic_model.md` を正本とする。

---

## 3. Backlog整合（F-01〜F-03）

`future_backlog` 系列の管理項目として、以下を価値観に紐付ける（ファイル有無に関わらずIDは固定運用）。

- **F-01 非矩形Island**
  - 主要対応原則: `P-01`, `P-06`
  - 要件到達目安: 曖昧なまとまりを矩形以外で表現し、俯瞰時に判読性を維持する。
  - 追加要求: 形状定義（shapes）・編集（editing）・永続化（persistence）を分離して管理する。
- **F-02 Collapse/Expand**
  - 主要対応原則: `P-05`, `P-06`
  - 要件到達目安: 情報量を段階的に制御し、詳細へのドリルダウンを保証する。
- **F-03 Canonical Cards**
  - 主要対応原則: `P-04`, `P-05`
  - 要件到達目安: 統合候補の人間承認フローを前提に、カード増殖を抑制する。

### 3.1 Viewpoint control requirements（方向性追記）

`P-06` の運用をドリフトさせないため、以下を将来実装の必須要件として固定する。

- collapse
  - クラスタ/Island/サブグラフ単位で折りたたみを行えること。
  - 折りたたみ状態はセッション中だけでなく永続化対象として扱うこと。
  - collapse時に不可視化された要素は削除扱いにせず、表示状態として管理すること。
- focus
  - 選択対象に対してフォーカスビューへ遷移できること。
  - フォーカス解除で元の俯瞰状態へ可逆に戻れること。
  - focus中でも元キャンバスの文脈（親クラスタ/近傍関係）へ再接続できる導線を維持すること。
- depth filter
  - 関係深度（例: 1-hop/2-hop）で表示範囲を制御できること。
  - depth filter は内容を削除せず、表示制御として扱うこと。
  - depth指定は focus と併用可能で、衝突時の優先順（focus優先）を仕様化すること。
- peek
  - 折りたたみ中でも要約的なプレビュー（peek）で局所確認できること。
  - peek は確定編集ではなく、文脈確認の軽量操作として定義すること。
  - peek表示の要約/説明は AI 由来の場合でも `unreviewed` を維持すること。

### 3.2 Canonicalization requirements（方向性追記）

`P-05` の canonical 化を実装都合で逸脱させないため、以下を必須要件として固定する。

- canonical cards
  - canonical card を基準に、候補カードとの対応関係を明示的に保持すること。
  - canonical への採用は常に人間承認ステップを経ること（自動確定禁止）。
  - canonical/source の両方向参照（canonical→source, source→canonical）を保持すること。
- source visibility
  - canonical 化後も、元カード（source）の参照経路をUI/データの両面で追跡可能にすること。
  - source 情報の不可視化によって意味差分が失われないよう、差分確認導線を維持すること。
  - source を非表示にする場合は visibility 状態（visible/hidden/collapsed）を明示保持し、復元可能にすること。

### 3.3 Non-rect shape requirements（方向性追記）

`F-01` の非矩形拡張は、見た目だけでなく操作・保存まで含めて定義する。

- shapes
  - 非矩形（自由形状/丸み/輪郭）を将来型として扱えること。
  - 形状種別追加時に既存矩形データが破壊されないこと。
  - shape direction（内向き/外向きの輪郭拡張方向）を将来拡張点として予約し、既存保存形式と分離すること。
- editing
  - 形状の作成・再編集・削除を可逆に行えること。
  - 形状編集はカード内容編集と独立した操作履歴として扱えること。
- persistence
  - 形状情報はドキュメント保存時に欠落なく永続化されること。
  - 未対応クライアントでも最低限のフォールバック表示が可能な互換性を持つこと。

### 3.4 Dependency graph（実装依存の明示）

- `V1/V2/V3 -> W1/W4 -> F-01 非矩形Island（future_backlog）`
- `W2/W3 -> F-03 Canonical Cards（future_backlog）`
- `V1/V2/V3/W1 -> F-02 Collapse/Expand（future_backlog）`

タスクID接続（固定）:

- `V*` は viewpoint controls（collapse/focus/depth/peek）系タスク群を指す。
- `W*` は canonicalization / merge / visibility 系タスク群を指す。
- `F-*` は phaseX_future_backlog 管理ID（`F-01`/`F-02`/`F-03`）に対応する。

#### 3.4.1 V/W → F backlog link matrix（固定）

| Task group | 内容 | Link先 backlog ID |
|---|---|---|
| `V1` | collapse 制御 | `F-02` |
| `V2` | focus 制御 | `F-02` |
| `V3` | depth/peek 制御 | `F-02` |
| `W1` | source visibility 制御 | `F-02`, `F-01` |
| `W2` | merge 提案フロー | `F-03` |
| `W3` | canonical/source 対応関係保持 | `F-03` |
| `W4` | 非矩形拡張時の canonical/source 可視性整合 | `F-01` |

#### 3.4.2 運用ルール

- backlog 起票時は、`V*` または `W*` の起点IDと `F-*` の到達IDを同時に記載する。
- `F-01/F-02/F-03` のいずれかに未接続の `V*`/`W*` タスクは計画未整合として扱う。
- 依存線を跨ぐスキップ実装（例: `W3` 未完了で `F-03` 実装着手）は禁止する。

上記の依存線を固定し、先行タスク未完了のまま後段機能へ進んで要件が崩れる状態を防ぐ。

---

## 4. フェーズ計画

### Phase A（次の1〜2スプリント）: 安全な追加

- 対象
  - review flags の可視化・保存（AI生成は常に未レビュー開始）。
  - Critique入力（理由任意）と再提案1ループ。
  - merge提案の提示（提案のみ。自動確定なし）。
- 完了判定
  - `P-02`, `P-03`, `P-04` の最低要求を満たす。

### Phase B（中期）: 構造拡張

- 対象
  - `F-01` 非矩形Island。
  - `F-02` collapse/expand。
  - `F-03` canonical cards 構造。
- 完了判定
  - `P-05`, `P-06` の運用負荷が低減している。

### Phase C（後期）: 高度拡張

- 対象
  - 階層的視点制御（多段フォーカス）。
  - 形状/関係型の拡張（rich shapes）。
- 完了判定
  - 大規模キャンバスでも、視点切替と意味保留を維持できる。

---

## 5. Non-goals（意図的に対象外）

- 完全リアルタイム共同編集（OT/CRDTを含む同時編集基盤）
- 権威的な真理判定エンジン（AIによる正誤確定）
- スコア主導の意思決定UI（ランキングで結論誘導）
- 人間承認なしの自動統合/自動削除

---

## 6. チケット化ルール（Issue/Epic化）

- Epicには、対象原則 `P-*` と要求ID `UX-* / DATA-* / AI-*` を必ず記載する。
- Issueには、受け入れ条件として最低1つの **AI禁止条件** を入れる。
- 実装レビュー時は以下を必須チェックにする。
  - AI生成物が既定で `unreviewed` か。
  - 正解/採点UIを導入していないか。
  - 最終判断が人間操作に残っているか。

この運用により、価値観を仕様へ接続したまま段階実装を進める。


## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 価値観（P-01〜P-09）を貢献者がそのままチケット化できる要求粒度（UX/DATA/AI 別）に変換し、価値観と実装要求の対応を固定してスコープドリフトを防ぐ。人間レビュー追跡（P-03）と Human-in-the-loop 反復（P-04）を業務ルールとして固定する | 機能: 全実装は P-* / UX-* / DATA-* / AI-* のIDを追跡可能でなければならない。データ: 確定/未確定、canonical化、review状態が表現可能でなければならない |
| **データ設計** | 要素の確定/未確定状態、Draft案の世代（iteration）、canonical card と source card の対応、review 状態（unreviewed/human_reviewed）を永続化する。視点制御（depth filter / collapse / peek）は内容削除と分離した表示制御として保持する | 機能: 個別CRUDを前提とせずスナップショット保存の上で状態を表現する。業務: 破棄可能なDraft案と確定要素を識別できる運用が必要。AI: レビュー状態や正解・採点を自律確定しない |
| **機能設計** | 価値観→要求をタスクID（V*/W*/F-*）へ接続し依存線を固定する。チケット化時は対象原則 P-* と要求IDを必ず記載し、受入条件に最低1つの AI 禁止条件を入れる。実装レビューでは「AI生成物が既定で unreviewed か」「正解/採点UIを導入していないか」「最終判断が人間操作に残るか」を必須チェックとする | データ: レビュー状態・canonical化状態・対応関係を永続化できること。業務: 自動確定・自動削除・スコア主導意思決定は禁止し、人間承認ステップを維持する |

## Consequences

- 旧文書 `value_to_requirements.md` は廃止し、本ADRへ参照を統一する。
- 既存リンクは `01_Plans/adr/ADR-0001-value-to-requirements.md` へ更新する。

## Traceability

- Source: `01_Plans/value_to_requirements.md`
- Supersedes: `01_Plans/value_to_requirements.md`
