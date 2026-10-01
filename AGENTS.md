# AGENTS.md

このファイルは、生成AIが sui-sensemaking で作業を始めるための最小入口です。リポジトリ全体を先読みせず、現在のタスクに必要な正本とコードだけを参照してください。

## 1. 必須ルール

1. 変更範囲を絞り、既存の利用者変更を取り消さない。
2. 仕様と実装が矛盾する場合は、現在の正本を確認してから修正する。
3. 変更リスクに応じたテストを実行し、未実施項目は明記する。
4. SafeMode、共有・export、import、AI提案に関わる安全不変条件を緩和しない。
5. 現在のissueだけを更新し、同じ進捗を複数の台帳へ転記しない。
6. **設計判断は業務設計・データ設計・機能設計の三要素牽制を通す**（§1.1 三要素牽制設計法）
7. **KJ操作ごとに適切なモデルレベルを選択する**（§1.2 操作別モデルレベル）
8. **自律判断の許容範囲をレベルで自覚する**（§1.3 自律性レベル）

### 1.1 三要素牽制設計法（ADR-0067）

設計判断は **業務設計**（誰が・何のために行うか。何をしてはならないか）／**データ設計**（何が保存・表示され、何が境界を越えるか）／**機能設計**（誰が・どのAPIで・どの状態遷移を通して操作するか）の3次元から相互に制約を突きつけ、矛盾がなくなるまで反復する。**三者が揃わない設計判断は着工しない。**

- 次元別の参照先・反復手順・適用範囲・記録形式の正本: `01_Plans/adr/ADR-0067-three-element-constraint-design-method.md`
- 着工前チェック（基本12項目＋次元間牽制6項目）と適用実例: `02_Architecture/three-element-constraint-checklist.html`

### 1.2 操作別モデルレベル

KJ法の各操作には異なる推論深度が必要である。費用対効果を最適化するため、操作ごとに適切なモデルを選択する。

| KJ操作 | 推論深度 | 推奨モデル | 根拠 |
|--------|---------|-----------|------|
| カード化（RawNote→Card） | 低 | DeepSeek | テキスト構造化。名詞止め→述語文は規則的 |
| 束ね（2〜3枚のグループ化） | 低〜中 | DeepSeek | 近接性判断。幾何情報も利用可能 |
| 表札作成（島ラベル） | 中 | DeepSeek / Sonnet | 共通性抽出。分類名ではなくadvocacy |
| 関係線（5種別） | 中 | DeepSeek / Sonnet | 論理的関係の識別 |
| 違和感検出（Critique） | 中〜高 | Sonnet | 「なんとなく違う」の言語化 |
| 島形成（空間構造化） | 中 | DeepSeek / Sonnet | 空間配置提案 |
| ナラティブ（B型叙述） | 高 | Sonnet / Opus | 空間→文章。A型照合を含む |
| 矛盾検出 | 中〜高 | Sonnet | 論理的矛盾の検出 |
| 文書タイトル提案 | 低〜中 | DeepSeek | 低品質許容・人間が編集前提 |
| 三要素整合チェック | 中 | DeepSeek / Sonnet | 構造化判断記録の検証 |

環境変数 `SUI_MODEL_LEVEL_LOW` / `_MEDIUM` / `_HIGH` で操作別にモデルを上書き可能。provider=`none` 時は全操作でAI呼び出しをスキップ。

### 1.3 自律性レベル

AIが自律的に判断できる範囲を4段階で定義する。現在のセッションがどのレベルで動作すべきかを、ユーザー指示または文書の明示的許可から判断する。

| レベル | 定義 | 人間の役割 | 昇格条件（定量） |
|--------|------|-----------|----------------|
| **L1: 補助** | AIは情報検索・整理・候補提示のみ。全判断は人間が下す | 全判断の主体 | — |
| **L2: 検証** | AIが三要素チェックを自律実行し、不整合を指摘。最終判断は人間 | 最終判断の主体 | **現在**（ADR-0075で昇格） |
| **L3: 実行** | AIが設計→実装→テストを自律実行し、人間が受入判定 | 受入判定の主体 | ① コード生成成功率 80%以上 ② 全管理面（文書アクセス設定・エージェント登録）運用開始 ③ ドッグフーディング週次運用 3ヶ月継続 |
| **L4: 自律** | AIが方向指示から自律的に判断・実行。人間は方向指示のみ | 方向指示の主体 | ① L3状態で6ヶ月継続 ② 人間の介入率 5%未満 ③ 全CIチェック 0エラー維持 |

現在は **L2（検証）** で動作する（ADR-0075、2026-08-12）。昇格判定は四半期ごとに行い、判定結果をADRとして記録する。いずれかの条件が未達の場合は昇格を見送り、未達項目を次四半期のR5具体策に反映する。

**L2での動作**: AIは設計判断の三要素整合チェック（`three-element-constraint-checklist.html` の18項目）を自律実行し、不整合を指摘する。最終適用判断は人間が行う（SafeMode・proposal-only・human_reviewedの緩和禁止を維持）。

**現在の自律性進捗**（2026-08-12。詳細は `01_Plans/dogfood/README.md` と `01_Plans/dogfood/codegen_results.md`）:
- L2: ①警告1件 ✅ ②ADR 75/75件 ✅ ③実API検証 2/2達成（refine_card_text 10/10・suggest_island_summary 4/4）— **昇格済み（ADR-0075）**
- L3: ①コード生成 ドライラン 骨格80%/ロジック100%/テスト100%・実適用66%（2/3） ②管理面 auth edge待ち ③週次ドッグフード運用待ち

## 2. 最小読取ルール

通常は次の順で十分です。

1. 本書
2. 変更対象のコードと近接テスト
3. 下表から該当する正本を1〜2件
4. 作業対象のActive issue memo（存在する場合）

| タスク | 先に読む正本 |
|---|---|
| 価値・要件判断 | `01_Plans/adr/ADR-0001-value-to-requirements.md` |
| 用語・KJ法の概念 | `00_Prompt/domain.md` |
| KJ法の実行（束ね・表札・空白・検査） | `00_Prompt/sensemaking_technique.md` |
| KJ操作のAI実行手順（入出力・判断基準・停止条件） | `00_Prompt/ai_sensemaking_execution_procedures.md` |
| カード品質 | `00_Prompt/qualitative_card_quality_requirements.md` |
| W型反復 | `00_Prompt/w_type_iterative_inquiry_requirements.md`, `02_Architecture/inquiry_journey_model.html` |
| 設計方法論（三要素牽制） | `01_Plans/adr/ADR-0067-three-element-constraint-design-method.md` |
| 三要素整合チェックリスト | `02_Architecture/three-element-constraint-checklist.html` |
| 非キャンバスUI・画面横断フロー | `02_Architecture/non-canvas-ui-flow-design.html` |
| 管理面のデータ境界 | `02_Architecture/design/master-data-settings-ui-ux-concept.md`, `02_Architecture/design/admin-surface-metadata-display-correction.html` |
| ドッグフーディング・AI協働計画 | `02_Architecture/dogfooding-ai-collaboration-plan.html` |
| 全体構成 | `02_Architecture/architecture.html` |
| Document契約・互換性 | `01_Plans/adr/ADR-0058-document-contract-v1-rebaseline.md`, `02_Architecture/schemas.md` |
| API | `02_Architecture/api.md` |
| 環境変数 | `02_Architecture/runtime_parameter_registry.md` |
| UI/UX | `01_Plans/adr/ADR-0044-ui-ux-quality-baseline-and-verification.md` |
| SafeMode・脅威 | `THREAT_MODEL.md` と対象ポリシー実装 |
| LLM | 該当する `02_Architecture/llm_*.md` |
| 利用者向け手順 | `04_Documentation/public_index.md` から該当文書へ進む |
| 開発・CI | `CONTRIBUTING.md`, 対象workflow, 対象パッケージのREADME |

次の文書は、タスクが直接関係するときだけ読みます。

- 過去ADR、Done issue、`02_Architecture/history/`
- `01_Plans/project-progress-dashboard.md`
- `01_Plans/issues/decision-pack-2026-03-human-judgement.md`
- `00_Prompt/agent_handover.md`
- Claude Codeなど特定ツールの運用文書

全ADR、全issue、00〜04の全ファイルを作業開始時に読む必要はありません。検索や `01_Plans/triage_actionable_plans.py` で対象を絞ってください。

## 3. ディレクトリの役割

| パス | 役割 |
|---|---|
| `00_Prompt/` | プロダクト固有の概念・要件 |
| `01_Plans/adr/` | 長期的な設計判断 |
| `01_Plans/issues/` | 実行可能な内部タスク |
| `02_Architecture/` | 現行の設計・契約 |
| `03_Implement/` | frontend、backend、MCP、deployとテスト |
| `04_Documentation/` | 一般利用者・運用者向けガイド |

人間向け入口は `README.md`、一般公開文書の入口は `04_Documentation/public_index.md` です。

### 文書の形式（2026-08-06改定）

- `01_Plans/`（ADR・issue）は Markdown を維持します。正規化・機械検証・差分レビューの対象であり、形式を揺らしません。
- `02_Architecture/design/` は **Claude Design ツールが実際に生成した出力専用**です。当該出力は `.dc.html` 拡張子を維持し、Claude Design のエクスポート形式（`<x-dc>` + `<script src="./support.js">` + `helmet`）をそのまま保持します。他の文書をこの拡張子・このディレクトリへ置きません。
- **新規の `02_Architecture/` 設計文書は、原則 HTML + Mermaid 単独（`02_Architecture/` 直下、拡張子 `.html`）で作成します。** Markdown を並行して作らない。理由は継ぎ目のドリフトです（`02_Architecture/contract-seam-integrity-2026-08-05.html` が実例と根拠を示す：手保守で二重化された契約表現は片方だけが更新されドリフトするが、単一表現ならその余地がない）。対象読者は開発者であり、構造・状態遷移・階層を図で伝えることが認知負荷を下げる目的に直結する文書（アーキテクチャ、状態機械、承認フロー、DAG的データモデル等）から優先する。純粋な原則列挙・箇条書き方針文書まで無理に図解化する必要はない。視覚的な一貫性のためClaude Designと同じ`support.js`/`<x-dc>`テンプレートを流用してよいが、これは意匠の選択であり、`design/`へ置く理由にも`.dc.html`へ改名する理由にもならない。
- **既存 Markdown 設計文書は、図解が必要になった段階で HTML + Mermaid 化し、Markdown を退役させます。** 変換時は参照元リンクをすべて新パスへ置き換える（`git grep -l 'ファイル名\.md'` で洗い出す）。**旧来のように Markdown 側を正本として残し続けることはしません** — 双方向に手保守される表現はどちらかがドリフトする、というのが上記実例で確認された構造的リスクだからです。参照コストは変換時の一括更新で払い切り、その後の継続コストにしない。**この方針は2026-08-06時点で維持継続の是非が未確認です**——別の判断軸（被参照数の大きい文書でMarkdownを正本として残す）が同じ理由（参照コスト）から同一セッション内で一度採用されており、どちらを標準とするかはメンテナの判断を要します。判断が下るまで、新規変換はこの一覧の各項目を`AGENTS.md`更新のPRで明示してください。
- 文書HTMLはリンク切れ検査の対象です（`DX-DOC-07`）。`00_Prompt` / `01_Plans` / `02_Architecture` / `04_Documentation` 配下の追跡HTMLが対象で、アプリ・ビルド成果物のHTMLは除外されます（`03_Implement/frontend/index.html` の `src="/src/main.tsx"` は dev server 基準であり、リポジトリ基準ではないため）。
- Mermaid は CDN 取得で構いませんが、**`file://` で直接開く運用を前提とする設計HTML文書は ES module 版（`.esm.mjs`）を使いません。** Chrome は `file://` 上の module script を CORS でブロックし、図が全て空白になる。UMD版（`mermaid.min.js`）を classic `<script>` で読み込む。
- `support.js`/`<x-dc>`テンプレートを流用する場合、そのランタイムは読み込み後に DOM を非同期で再構築し、その前に描画した Mermaid SVG を破棄する。`mermaid.initialize({ startOnLoad: false, ... })` とし、`MutationObserver` で `.mermaid:not([data-processed])` を検出するたびに再描画する（`contract-seam-integrity-2026-08-05.html` の実装を雛形にする）。テンプレートを流用する`02_Architecture/`直下の文書は、同じ`./support.js`を`02_Architecture/support.js`から相対参照する（`design/`配下のClaude Design専用出力とは別に、このコピーを維持する）。

## 4. 作業手順

1. **確認**: 対象、期待結果、非目標を短く定める。
2. **変更**: 既存パターンに沿って最小差分で実装する。
3. **検証**: 近接テストから始め、影響が広い場合だけ範囲を広げる。
4. **記録**: 変更理由、検証結果、残課題をissueまたはPRへ一度だけ記録する。

固定の5フェーズ、rerun番号、Stream別同期ログ、複数台帳の件数同期、毎回のRACI更新は不要です。

### 失敗からの学習

作業中に遭遇した失敗（CIエラー、コンフリクト解決ミス、環境不具合、手順の見落としなど）は、**原因分析と対応内容を自律的に記録し、次回から参照**してください。記録の対象・形式・参照タイミングは `01_Plans/agent_failure_lessons.md`、実記録は `01_Plans/agent_failure_log.md` にあります。

- 検証（テスト・typecheck・lint）が失敗したとき、マージ・リベース前後、環境依存エラーに遭遇したときは、まず `agent_failure_log.md` に同じ失敗の記録がないか確認する。
- 復旧が完了したその場で、事象・原因・対応・再発防止の4点をログへ追記する（後回しにしない）。
- ログは簡潔に（1件5〜15行）、issue/PRの進捗欄には書き込まない。

## 5. 変更時の追随範囲

- Document契約変更: `ADR-0058`、`schemas.md`、`api.md`、frontend/backend/MCPの契約と関連テストを確認する。
- API変更: `api.md`、client/server、契約テストを確認する。
- 環境変数変更: `SUI_*` 命名を守り、`runtime_parameter_registry.md` と設定例を同期する。
- UI視覚変更: 対象画面を実ブラウザで確認する。スクリーンショットは公開文書または視覚回帰の根拠として必要な場合だけ更新する。
- SafeMode・共有・import変更: fail-closed、proposal-only、人手レビュー境界を対象テストで確認する。
- `DocumentV1`へ新しいoptionalフィールドを追加する前（R5、`02_Architecture/functional-dependency-integrity-2026-08-06.html` §08）: (1) 表現しようとしている関係を、既存のフィールドが既にカバーしていないか確認する — 同一関係を複数フィールドで表さない。(2) その関係が確定事実（統合・所属・帰属など）か利用者の現在の見立て（`claimType`/`holdState`等）かを判定し、後者なら正規化・不変条件の対象にしない。(3) 追加する型に対応するPydanticモデルのフィールドも同時に追加し、`test_ts_python_contract_drift.py`の対象型リストに含める。(4) SafeMode向けのredact/preserve/omitポリシー（`inquiry_bundle_safe_mode.ts`）を判断する。

無関係なダッシュボード、decision-pack、過去ログ、全Project Mapを同じPRで更新しません。

## 6. ガバナンス

現段階は個人OSS・プレリリースであり、`ADR-0039` を適用します。

- **開発体制の前提（2026-10-01）: 1人の開発者が生成AIを用いて開発する。** 外部協力者・複数人レビュー・第三者の確保を完了条件にする制約は置かない。実在の第三者証拠（T1）は追加入力であり、ゲートではない（`VALUE-REALNESS-01` の証拠階層を参照）。SafeMode等の安全不変条件（§7）はこの前提で緩和しない。
- 意思決定者と実行者は `Maintainer` に集約する。
- issue memoは `Type / Status / Source Issue / Priority / Scope / Related ADR / Expected verification level / Acceptance / Validation` を最小項目とする。
- ADRは、長期的・横断的・破壊的な契約変更、安全境界変更、複数の合理的選択肢が残る場合に限る。
- 2者承認、Decision Queue、RACI、KPIは、実ユーザーまたは継続的な協力者が現れるまで既定では使わない。
- 進捗の正本はActive issue memoとGit履歴であり、手書きダッシュボードは正本にしない。
- issue本文に記録された未決事項（`DecisionStatus: Pending` 等）は、**何が未決かの記録であり、それ自体が着手を禁じるゲートではありません。** 未決のまま進められる部分は進め、決定が必要になった時点で判断を仰いでください。ただし SafeMode・`human_reviewed`・外部共有条件・自動適用に触れる変更は例外で、`GENAI-GOV-01`（`02_Architecture/value_traceability.md` §2.9）のとおり実装PRより先にADRまたは内部issueで扱います。
- 決定済みの参照（採択済みADRを指す `DecisionStatus: Fixed` 等）はissue本文へ書き写さない。ADR側のStatusが正本であり、二重管理は取りやめました。

削減対象と再導入条件は `01_Plans/lean_operations_inventory.md` を参照してください。

## 7. 安全不変条件

- SafeModeは既定ON。
- AI出力はproposal-onlyで、自動適用しない。
- `human_reviewed` は人間だけが設定する。
- `SUI_LLM_PROVIDER=none` でも主要価値が成立する。
- share/exportで未レビュー情報や秘密情報を意図せず共有しない。
- import/zip/markdownは不正入力を安全側で拒否または無害化する。

## 8. 本書の更新

本書はパス単位の入口に留めます。個別ファイルを追加するたびに一覧へ追記せず、タスク別の正本が変わった場合だけ更新してください。新しい契約やADRは、全件読取へ追加せず、該当タスクの行だけを更新します。
