# sui-sensemaking デザイン設計要求（Round 9・エージェント連携2パネルの事後照合と開始パネル/カード検索の新規要求）

対象: Claude Designセッションへの貼り付け用プロンプト。今回は、A-1（エージェント連携2パネル：`AgentTaskExportPanel`/`AgentResponseImportPanel`）の事後設計照合と、A-2/A-3（開始パネル・カード検索：`StartPanel`/`SearchBar`）の新規設計要求の2件を扱います。いずれも `02_Architecture/design/design-request-gaps-2026-07-20.md`（改訂: 2026-07-21）の棚卸しで「要求・照合とも未実施のまま」と確認済みの項目です（同時期に予備検討が届いたN-1/N-2/F-1とは別系統で、本ラウンドが対象2項目にとって初回の依頼になります）。

---

## 貼り付け用プロンプト

sui-sensemakingの既存UIを前提に、次の2件について設計レビュー・設計を行ってください。1件は実装済み機能の事後照合（新規画面は作らない）、もう1件は未着手領域の新規設計要求です。両者は独立した成果物として返してください。

### 1. 今回の目的

- **R9-A（事後設計照合）**: `AgentTaskExportPanel`/`AgentResponseImportPanel`（外部エージェントへのタスク依頼書エクスポートと、エージェント応答の取込レビュー）は、設計要求も設計照合も一度も実施されないまま本番機能として稼働しています。安全境界（SafeMode表示、出典参照の扱い、取込サニタイズの見せ方）が既存の核と整合しているかを確認してください。
- **R9-B（新規設計要求）**: `StartPanel`（文書の新規作成・サンプル・再開）と `SearchBar`（カード本文検索）は、5領域IAの「領域1（開始/入口）」を担う中核画面でありながら、一度も設計要求の対象になっていません。特に、ドッグフードで記録された「再読込後に直前の文書へ戻るワンクリック導線がない」という摩擦の解消可否を中心に設計してください。

このRoundの成果は設計入力であり、未定義APIや将来機能の実装許可ではありません。

### 2. 確定済みの境界（変更しない前提）

両項目に共通する、変更しないでください。

- SafeModeは既定ON。`provider=none`でもコア操作は成立する。AI提案・エージェント応答はproposal-onlyで、人間の明示操作なしに文書へ反映されない。
- 反スコアリング: `score`/`rank`/`confidence`/`priority`等の数値評価語彙を新設・復活させない。
- 新規操作を既定表示（初期画面）へ純増させない。既存要素の置換・包含・モード分離で収める。
- 削除・アーカイブ・所有者移管・一括操作は標準機能にしない（本ラウンドの対象範囲外）。
- 両画面とも既存のdialog契約（`role="dialog"`、Escapeによる段階閉鎖、閉じたトリガへのfocus復帰、focus trap、キーボード到達性）を維持する。

R9-A固有の境界:

- パネル自体は表示専用です。エクスポート文面の生成（`export/agent_task_export`）や取込パース/サニタイズ本体（`import/agent_response_import`）のロジックは対象外とし、**表示規約のみ**を扱ってください。
- 一括Adopt/一括Rejectのような新規の一括操作は設計しない。取込は現状どおりper-proposal（1件ずつ）の明示操作を維持する。

R9-B固有の境界:

- ⌘Kのコマンド検索と、`SearchBar`のカード本文検索を**混同しない**。両者は別物として扱ってください。
- 文書一覧・文書を開くフローそのもの（サーバー正本の文書一覧、6状態、viewport変形）はRound 8 R8-Aですでに回答済みです。**R9-Bで再度依頼しません**。R9-Bが扱うのは、StartPanelの「新規/サンプル/読み込み/review pack import」という他3〜4アクションの情報設計、「直前文書への再開導線」の新設可否とfocus復帰先、そしてカード検索の状態管理です。

### 3. 既存UIと視覚言語

- キャンバスが主、AIや設定は従。キャンバスを開いた後に文書一覧を常設サイドバーにしない。
- コマンドの恒久住所は、キャンバス直接操作 → スリムツールバー → メニュー → コンテキストメニュー → コマンドパレットの5層。今回の入口は既存StartPanel/両パネルの置換・包含を基本にし、ツールバーへ純増しない。
- 色はslateを基調とし、amberは保留・違和感の保持系専用。管理警告やtoken注意にamberを使わない。新しい色チャネルを作らない。
- SafeModeは既定ON。provider=`none`でもコア操作は成立する。AI提案はproposal-onlyで自動適用しない。
- 角丸6/8/999、font 12/11/10、spacing 2/4/6/8を既存スケールとして扱う。パネルタイトルのfontSize 15/fontWeight 800は既存の横断的なタイトル規約であり、本ラウンドで変更しない。
- Escapeによる段階閉鎖、dialogを開いたトリガへのfocus復帰、キーボード到達、ja/en同等性を維持する。

### 4. 設計・照合してほしい画面

#### R9-A. エージェント連携2パネルの事後設計照合（A-1）

`AgentTaskExportPanel`はエクスポート専用、`AgentResponseImportPanel`は取込レビュー専用のモーダルです。両者とも表示専用で、実際の文面生成・パース・サニタイズは別モジュールが担い、パネルはprops経由で結果とハンドラを受け取るだけです。

**Export側（`AgentTaskExportPanel`）の現状**:

- タスク種別選択（6種）、希望件数（1〜20）、`includeUnreviewedDrafts`チェックボックス（SafeMode時は非表示）、`includeSourceReferences`チェックボックス（チェック時に出典参照が手がかりを漏らし得る旨のインライン警告）。
- スコープ要約（件数のみ、SafeMode時は注記）と、「scope confirmed」確認チェックボックス。3つのエクスポート操作（コピー/ダウンロードmd/ダウンロードjson）は `hasSelection && scopeConfirmed` が揃うまで全て無効。

**Import側（`AgentResponseImportPanel`）の現状**:

- 生JSON貼付テキストエリア、strict/lenientモード切替、「解析」ボタン。
- 解析エラーは赤帯、解析警告は件数のみのamber帯（生の警告文はDOMへ出さない）。
- per-proposalレビューカード: 種別・対象ラベル・内容プレビュー・根拠、状態に応じて「orphaned」（対象が解決不能、Adoptボタンなし）／「patchSignatureMismatch」（Adoptの代わりに「パッチ書出」、in-app適用を拒否）／delete系操作の警告バッジを表示。一括適用はなく、1件ずつの明示Import操作のみ。

**設計論点**は次のとおりです。

1. 外部エージェントへ渡すエクスポート文面（パネル外で生成）に対する安全境界表示は十分か（SafeMode gating・出典参照警告・scope confirm）。
2. 取込サニタイズの見せ方（警告は件数のみ／エラーは全文赤）が、説明可能性と情報過多のバランスとして妥当か。
3. 人間向け文脈とAI向け文脈の分離を満たすか。

**レビュー観点（4軸）**: A.視覚言語（警告色・amberの用法）／B.状態遷移（confirm前後、per-proposalのadopted/rejected）／C.核の保護（AIは候補生成に留まり確定しない。per-proposal明示適用・一括なし・patch mismatch時のin-app適用拒否）／D.a11y・契約（dialog契約4点）。

**期待成果物**: 4軸の○/△/×照合＋外部共有文面・取込サニタイズ表示のレッドライン（△/×があった場合のみ）。

**受入条件**: SafeMode既定ON・共有前確認必須（核）との整合が確認できること。△/×はissue化する。

#### R9-B. 開始パネル・カード検索の新規設計要求（A-2/A-3）

**現状**: `StartPanel`は左上固定のモーダル的パネルで、SafeMode/文書ID/保存状態の表示、「新規作成」「サンプルを開く」「ファイルから読み込み」「review pack import」の4アクション（190px以上のボタングリッド）、および「最近使った文書」がある場合のみ表示される簡易セレクト＋「前回の文書を開く」ボタンで構成されます。`SearchBar`はカード本文検索で、キャンバスヘッダーに常設される別コンポーネントです（StartPanelの開閉とは独立）。

ドッグフード記録（`01_Plans/dogfood/dogfood-log-2026-07-10.md`）: 「再読込後に直前の文書へ自動復帰しない。スタートパネルの文書一覧から選び直す動線になる」という摩擦（低優先、未解消）。関連issue `issue-UI-QUALITY-A11Y-07` は、StartPanelを閉じた後の再オープン導線が現在まったく存在しない（`setIsStartPanelVisible(true)`は初期化以外どこからも呼ばれない）ため、focus復帰先の設計判断ができずに保留中です。

**設計論点**は次のとおりです。

1. 開始パネルの情報設計（新規/サンプル/読み込み/review pack importと、再開導線の主従関係）。
2. 再開導線（直前文書へのワンクリック復帰）の新設可否と、それに伴うfocus復帰先。新設する場合、StartPanel自体を再度開く導線（メニュー等からの再オープン）を設けるのか、それとも別の形（例: 「前回の続きから」を初回表示の主操作にする等）で解決するのかを比較し、推奨案を1つ選んでください。
3. カード検索の検索状態と文書スコープの関係。検索クエリ・非一致非表示・現在マッチindexは文書切替時にリセットされる既存の挙動（`issue-QA-MONKEY-03`で解決済みのクロス文書リーク）を維持しつつ、視覚表現・状態遷移を設計してください。

**レビュー観点（4軸）**: 4軸すべて、特にB.状態遷移（Empty/一覧/検索一致・非一致）とD.a11y・契約（focus復帰・キーボード到達性）。

**期待成果物**: 開始パネル・カード検索のレッドライン。各状態一覧＋viewport（1440/768/390px）で、「主従関係・認知負荷・キーボード動線」を理由に複数案を比較し1案を選定・根拠提示。

**受入条件**: ドッグフード摩擦（再開導線の欠如）が解消方向に載り、`issue-UI-QUALITY-A11Y-07`のfocus復帰先が定まること。

### 5. 出力形式

次を1つの回答パッケージとして返してください。

1. **R9-A**: 4軸の○/△/×照合表と、△/×があった場合のみのレッドライン修正案。
2. **R9-B**: 開始パネル・カード検索の推奨IA、画面レッドライン（1440/768/390px）、状態表（Empty/Loading/Ready/Error/検索一致・非一致）、a11y/focus仕様。
3. **既存→提案の置換表（R9-Bのみ）**: StartPanelの4アクション・最近使った文書セレクトが、提案後どう変わるか。初期表示に何が増減するか。
4. **自己照合**: 下記の採否を○/△/×と理由つきで回答。

### 6. 自己照合項目

- SafeMode、provider=`none`、proposal-only、反スコアリングを弱めていない。
- amberを保留・違和感以外（警告・注意喚起等）へ流用していない。
- 新規操作をツールバー・既定表示へ純増していない。
- キーボード、Escape、focus復帰、ja/en、390pxが成立する。
- （R9-A）AIは候補生成に留まり、パネル側の操作だけでは文書へ確定反映されない。取込は1件ずつの明示操作のみで、一括適用を新設していない。
- （R9-B）⌘Kのコマンド検索とカード本文検索を混同していない。Round 8 R8-Aで回答済みの「文書を開く」一覧UI（サーバー正本一覧・6状態・viewport変形）を再度設計し直していない。

### 7. fixture例

R9-Aでは、次の架空データを使って構いません。

- タスク依頼書: 島タイトル案3件、`includeSourceReferences`チェック時の警告文面例。
- エージェント応答: 正常proposal 2件（1件はorphaned、1件はpatchSignatureMismatch）、禁止フィールド（`score`等）を含むlenientモード警告の例。

R9-Bでは、Round 8と同じ架空文書を使って構いません（一貫性のため）。

- `doc-7f2a` / 地域ヒアリングの整理 / 2026-07-16T09:30:00+09:00
- `doc-a104` / 新サービスの利用観察 / 2026-07-15T17:10:00+09:00
- `doc-c821` / ふりかえりの未整理メモ / 2026-07-12T11:45:00+09:00

カード検索の一致/非一致例として、上記文書内の架空カード文言を3〜5件程度、自由に設定して構いません。

---

## プロジェクト側の受領条件

- 回答は`02_Architecture/design/design-request-gaps-2026-07-20.md`のN-3/N-7詳細仕様、`ADR-0049`（external-flat-rate-agent-collaboration, Status: Proposed）、`02_Architecture/external_agent_collaboration_spec.html`、`02_Architecture/design/ui_design_handoff.md`の5領域IA定義へ照合する。
- R9-Aで△/×が出た場合、またはR9-Bの新規画面いずれについても、△/×・新規レッドラインはissue化してから実装する。本Roundの成果物だけでは実装着手の根拠にしない。
- R9-Bの「文書を開く」一覧UI自体はRound 8 R8-Aの管轄であり、本Roundでは扱わない（R8-A採否とは独立に進められる）。
- 実装ラウンドでは実機スクリーンショットを取得し、`design-qa-checklist.md`で4軸（A.視覚言語/B.状態遷移/C.核の保護/D.a11y・契約）の照合を行う。

---

## Traceability

- Related: `02_Architecture/design/design-request-gaps-2026-07-20.md`（本Roundの一次入力、N-3/N-7の詳細仕様）
- Related: `02_Architecture/design/design-request-2026-07-round8.md`（視覚言語の再利用元、R8-Aとの境界）
- Related: `02_Architecture/design/design-qa-checklist.md`（4軸○/△/×規約の正本）
- Related: `01_Plans/adr/ADR-0049-external-flat-rate-agent-collaboration.md`（Status: Proposed）
- Related: `02_Architecture/external_agent_collaboration_spec.html`
- Related: `01_Plans/dogfood/dogfood-log-2026-07-10.md`（N-7の再開導線摩擦）
- Related issues: `issue-UI-QUALITY-A11Y-07-start-panel-focus-return.md`, `issue-QA-MONKEY-03-search-state-document-scope.md`
