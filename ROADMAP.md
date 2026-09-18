# ROADMAP

**English summary**  
SUI Sensemaking is a durable environment for human–AI sensemaking, with a KJ-inspired canvas as its current core human interface. The current public product remains human-reviewed and SafeMode-first, while the long-term architecture is intended to support a continuum from human-led exploration to delegated and supervised AI sensemaking without losing evidence, provenance, uncertainty, or authority boundaries. Future capabilities remain candidates until actual-use evidence justifies promoting them.

この文書は、**開発コミュニティ向けの公開コミュニケーション文書**です。

詳細な実装状態・個別タスクは `01_Plans/` を参照してください。特に、従来の公開ロードマップ項目を実装アクションへ分解した状態管理は `01_Plans/adr/ADR-0007-future-backlog.md` の「Roadmap統合バックログ」を正とします。認知dogfoodの実行状態は `01_Plans/dogfood/cognitive-dogfood-index.md`、一次利用仕事と切替理由は `01_Plans/issues/issue-PRODUCT-POSITION-01-primary-job-and-switch-reason.md` を正本とします。

## 基本方針

SUI Sensemaking は、まとまりきらない定性資料や観察を、早すぎる分類・要約・合意で潰さず、出典・異論・保留・来歴を残したまま構造化し、後から根拠へ戻れる共有可能な理解へ育てることを、現在の中心的な利用仕事として検証しています。

現在の公開機能では人間レビューを強く前提としますが、長期的なProduct Scopeはそこに固定しません。AIが探索・仮説形成・反証・構造化・統合のより大きな区間を担い、人間が方向づけ、理解、異議、承認へ比重を移す場合でも、同じsensemaking資産と来歴を継続できることを目指します。

そのため、次を中核原則として維持します。

- 🧠 意味を急いで閉じない（Ambiguity Preservation）
- 🔁 現行フェーズではHuman-in-the-loopを維持しつつ、長期的には人間・AIの役割分担を固定しない
- 🔒 SafeMode を既定とする安全設計
- 🌐 オフライン / 自前ホストを選べる構成
- 📦 OSSとして持続可能な規模感
- 🔎 出典・異論・保留・判断履歴へ戻れる追跡可能性

## 現在地

### 実装済みの基盤

従来のROADMAPで「近接フェーズ」として掲げていた次の項目は、すでに実装済みです。詳細な完了状態と受入条件は `ADR-0007-future-backlog.md` を参照してください。

- Explore / Review / Summary の視座プリセット
- 島の折りたたみと階層可視性制御
- 多角形島と互換読み込み
- SafeMode 状態のUI明示
- Trace Analytics
- 構造メトリクス
- Diagnostics 出力の安定化
- ZIP import の hardening
- Worker ベース処理の安定化
- CIによる import / serialization / shape 回帰防止

これらは「次に作る機能」ではなく、現在の価値検証を支える実装基盤として扱います。

### 現在の焦点 — 機能追加より、価値と認知増分を確かめる

現在の主要な未確定事項は、機能をさらに増やせるかではありません。実装済みの基盤が、既存のAIチャット、ホワイトボード、文書、定性分析ツールなどでは保ちにくい思考過程を、本当に支えられるかを確かめることです。

#### 1. 一次利用仕事と切替理由

`PRODUCT-POSITION-01` で、一次利用仕事と自然な競合、切替理由を暫定的に具体化しています。ただし、これは内部検討だけで最終確定しません。実際の利用観察から反証可能な形で更新します。

#### 2. 認知比較評価

`COGNITIVE-EVAL-01` では、Case 001〜003について、通常のAIチャット、KJ支援skill、SUI Sensemaking、SUI Sensemaking + skill を比較する条件を準備しています。

比較設計、凍結入力、起動用成果物、実行記録、blind review の手順は準備済みです。一方で、**有効な生の実行記録はまだ取得していません**。準備済みであることを、認知上の優位性が実証済みであることとはみなしません。

#### 3. 第三者による価値実証

`VALUE-REALNESS-01` では、参加者向け説明、実行計画、開始前チェック、記録、公開境界、分析計画まで準備しています。

一方で、**第三者による実セッションはまだ実施していません**。内部dogfoodで見つかった価値を、そのまま第三者価値の証拠へ読み替えないことを原則とします。

### 現在の優先順位

当面は次の順で前進します。

1. Case 001から、隔離された新規コンテキストと実際のSUI Sensemaking操作による比較記録を得る。
2. Case 002、003へ同じ比較条件を広げ、特定ケースだけの偶然かを確認する。
3. 第三者の実仕事に近い材料で、一次利用仕事と切替理由を検証する。
4. dogfoodや第三者利用で再現した摩擦を既存Issueへ戻し、必要な場合だけ新しいIssueを起票する。
5. 複数ケースで再現した問題や、利用価値に直結する証拠が得られたものから、将来候補を実装優先へ昇格する。

比較実験や第三者利用より先に、新しい機能一覧を埋めること自体を進捗とはみなしません。

### TEI移管ゲート — 大規模な機能高度化の前に検証する

現在のSUI実装へ新しい高度機能を積み上げ続ける前に、TEIをApplication Implementation Layerとして利用するReference Adoptionを行います。

目的はTEI利用そのものではなく、**同じSUI Product Valueを維持したまま、変更・検証・保守の負荷が実際に大きく下がるかを測ること**です。

- 現行SUIで代表的なchange challengeを固定する。
- TEI上の最小vertical sliceへ同じ変更を適用する。
- hand-written差分、変更箇所数、test / schema /文書同期、変更増幅率を比較する。
- TEIに足りない機能は、まずPlugin / Adapter / Capabilityとして一般化できるかを検討する。
- SUI固有で性能・Interaction上の理由がある部分はnative implementationとして残せるようにする。
- 比較Evidenceが揃うまでは、TEI CoreをSUI専用要求で拡張しない。

詳細は `01_Plans/issues/issue-ARCH-TEI-MIGRATION-01-tei-reference-adoption-and-development-load-validation.md` を正本とします。

Security fix、bug fix、互換性維持、価値検証は継続しますが、AI Workspace、Review Capsule、複数認知器統合などの**大きな新規実装へ進む前に、この移管ゲートの判断を通す**ことを原則とします。

## 証拠によって昇格する将来候補

以下は設計上の可能性として保持しますが、ここに並んでいる順序を実装約束とはしません。実使用の摩擦、比較評価、第三者価値実証、保守負担、安全性を見て、昇格・延期・縮小・棄却します。

### A. 大規模な質的統合

- 類似カード統合を、人間の判断と由来追跡を保ったまま支援する。
- 島の階層化、表札、鳥観と詳細の往復を、大規模キャンバスでも扱いやすくする。
- カードを減らすこと自体を目的にせず、統合前の意味・文脈・由来へ戻れるようにする。

一部の基盤機能は既に実装済みです。今後の拡張は、実際の大規模利用で同じ摩擦が再現した場合に進めます。

### B. AIによる認知・sensemaking支援

- ローカルLLMと大規模LLMだけでなく、embedding、分類器、決定論的処理、将来の異種認知器を同じ上位境界から扱える構成。
- 現行の共有・確定面ではAI出力をproposalとして扱い、人間承認なしに`human_reviewed`・Accepted・Consensusへ昇格させない。
- 将来のAI Workspaceでは、Observation、Relation、Hypothesis、Structure、Synthesisを複数段階にわたり探索・反証・再構成できる余地を持つ。
- SafeMode、Evidence保全、Provenance、権限境界を、AIの自律度とは独立した不変条件として維持する。
- Providerやモデルを変えても、失敗や根拠の見え方が失われないようにする。

現行のローカルLLM `/generate` 契約は sui-sensemaking 独自形状です。OpenAI/Ollama互換ワイヤ形式は、実使用で接続失敗が顕在化した場合に改めて判断します。

### C. 定額 / オフラインAIとの協働

生成AI APIの従量課金を前提にせず、定額チャットや外部AIエージェントと安全に往復できる経路を維持・発展させます。

- キャンバス文脈と依頼内容を、外部AIへ渡せる形で書き出す。
- 現行フェーズでは、外部AIの結果を構造化変更提案として受け取り、人間の承認後に共有・確定面へ反映する。
- 将来AI側で複数段階のsensemakingを行う場合も、その内部採択と、人間承認済み・共有済みの意味への昇格を区別する。

この方向の契約は `ADR-0049-external-flat-rate-agent-collaboration.md` と関連仕様で管理しています。

### D. ローカライゼーション

- 日本語を一次言語とする。
- UI文字列は翻訳可能なキーとして管理する。
- `document.json` の意味を表示言語から独立させる。
- 多言語化によってSafeModeや公開境界が弱くならないようにする。

翻訳範囲の拡大は、実際の利用者・協力者の需要に合わせて段階的に進めます。

### E. 展開・公開運用

企業・行政・研究などでは公開範囲が異なるため、次の選択肢を設計候補として保持します。

- 静的配信: Review Pack等を静的Webとして安全に公開する。
- 認証付き配信: OIDC/SAML等の外部認証と認可境界を組み合わせる。
- ハイブリッド: 内部は制限付き、外部向けは匿名化・SafeModeを強制した公開版とする。

visibility、read-only表示、Static Publish、DocumentACLなどは、実利用上の必要性と既存アーキテクチャへの影響を確認して昇格します。

## 長期的に保持する探索余地

- AI Workspaceでの複数段階sensemakingと、工程ごとの委任範囲・停止条件の設計
- AIが大規模な探索を担った後、人間が主要根拠・反証・未解決点を理解して異議・承認できるReview View / Review Capsule
- 複数の異質な認知器が出すObservationやRelationを、一つの総合スコアへ潰さず比較・保持する仕組み
- 自由曲線や不定形包囲など、島表現の高度化
- 差分レビューを中心とした慎重な複数人協働
- 署名付きレビュー記録や監査ログハッシュなど、研究・組織利用向け監査強化

これらも固定した到達義務ではありません。sui-sensemakingの中心的な利用仕事を強める場合に限って取り込みます。

## 非目標（Out of Scope）

- SNS型公開プラットフォーム化
- AI内部の作業結果を、来歴・権限・レビュー境界を飛び越えて人間承認済みの結論・合意・意思決定として扱うこと
- SaaSに依存しなければ成立しない設計
- 大規模リアルタイム共同編集を主目的にすること
- 汎用ホワイトボードの機能数を競うこと
- AI自律率そのものを成功指標にし、人間が必要なときに理解・異議・承認できる経路を失うこと

## 設計原則（常に維持する）

- `document.json` は純粋な構造データとして扱う。
- `view.json` は視座と表示上のメタ情報を扱う。
- SafeMode は既定ONとする。
- 個人情報を安易に保存しない。
- 重い処理はWorker等へ逃がし、UI応答性を守る。
- 出典・異論・保留・生成主体・判断履歴へ戻れることを、便利な自動化より優先する。
- AI Workspace内の自律探索と、共有・承認済み状態への権限昇格を同一視しない。
- dogfoodや実利用で見つかった摩擦は、手順で隠すのではなく、再現できるものを製品へ戻す。

## このROADMAPの更新ルール

公開ROADMAPは、内部の実装状態より先に未来を約束するための文書ではありません。

- 実装済み項目を未来形のまま残さない。
- 準備済みと実証済みを分ける。
- 将来候補をP0へ昇格するときは、実使用の証拠または明確な安全・保守上の理由を示す。
- 実装状態の詳細は `ADR-0007`、認知dogfoodの状態は `cognitive-dogfood-index.md`、価値仮説は各Issue/ADRへ戻って確認できるようにする。
- 公開文書として読みやすい自然な日本語に整えるが、凍結済み実験入力を文体だけの理由で書き換えない。