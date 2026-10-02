# ADR-0054: 外部接続レイヤーの段階導入 ― ガラス箱の共有文脈を MCP で公開する

- Status: Accepted（2026-07-12、maintainer受理。受理時条件: 作業用語「庭」を正式用語「縁側」へ置換すること — 下記「用語定義」参照）
- Date: 2026-07-12
- Deciders: Project Maintainers
- Scope: `03_Implement/backend/`, `03_Implement/frontend/src/export/`・`src/import/`（契約共有）, `01_Plans/`, `02_Architecture/`, `THREAT_MODEL.md`

## 用語定義: 縁側（えんがわ / en: Engawa）

外部エージェント由来の提案カードが静かに堆積する、キャンバス周縁の受け入れ領域。日本家屋の縁側——庭に面した家の縁で、来訪者は家に上がらずに腰掛けられ、住人は好きな時に応対する——から採る。

- **見えるが割り込まない**: 通知バッジ・赤丸・件数の強調を付けない。
- **処理義務を作らない**: Agent Inbox型の未処理キューではない。放置は失敗状態ではない。
- **上がるには明示の採用**: proposal-only。人間が採用するまで文書本体に入らず、未レビューのまま。
- **シェルフとの対**: シェルフ＝内からの退避（保留の置き場）、縁側＝外からの来訪（受け入れ縁）。
- 「外部との縁の側」——外部接続レイヤーの受け入れ面という機能名としても読める。
- 経緯: リサーチ〜P32相談時の作業用語は「庭」。Accepted時に本用語へ置換した（過去文書内の「庭」は本定義を指す）。英語ラベルは `Engawa`（初出時に短い説明を添える）を基本とし、UI上の最終表記はEXT-CONN-02実装ラウンドのレッドラインで確定する。

## Context

- リサーチ（`01_Plans/research/research-2026-07-12-trigger-ai-external-integration.md`＋同日追補）の結論: トリガー型AI（頼まれず動くAI）はプラットフォーマーの主戦場になったが、トリガー面・配信面は変動が激しい。sui-sensemakingは前面を取りに行かず、日常ツールの背後に立つ「認識論的ガバナンス付きの共有文脈基盤」になる。競合する記憶基盤（mem0/Zep/Letta/knowledgeplane等）には「この記憶はレビュー済みか・保留中か・根拠は何か・誰が承認したか」の層が丸ごと欠けており、sui-sensemakingのドメインモデルはこの空白の形をしている。
- 追補で確定した外部事実: (i) MCPはLinux Foundation傘下AAIFへ移管済みで2026-07-28に大型仕様改訂（ステートレスコア・OAuth 2.1リソースサーバー正式化）が確定、(ii) ChatGPT Developer Mode / Copilot Studio / Claudeの3エコシステムすべてがMCPクライアント対応済み（ただしChatGPTはリモートHTTPS必須・個人プランは読み取り専用強制）、(iii) TRACE（arXiv:2606.13174）は「Mem0記憶でも選好違反が57.5%残る」ことを示し、訂正は記憶でなく実行時制約として渡す必要があるという役割Cの前提を定量的に裏付けた。
- 既存資産との関係: `ADR-0028` CE-4はContextQuery/BundleのAPI/CLI提供を既に予定している（本ADRはその外向き部分の具体化）。`ADR-0049`（外部定額エージェント連携）はcopy/pasteの手動レーンとして `agent-task.v1` / `agent-response.v1` 契約とその安全境界（SafeMode本文redaction・未レビュー既定除外・反スコアリング・proposal-only・sanitize-on-import）を実装・検証済み（EXT-AGENT-01/02/03 Done）。本ADRは同じ契約と安全境界の自動輸送版であり、新しい安全判断をなるべく増やさない。
- 再起票基準: `ADR-0047` R-2（外部接続という新たな不可逆境界の導入）に該当するためADRとする。

## Decision

外部接続レイヤーを次の3段階で導入する。各段階は独立に停止可能で、後段が前段の安全原則を弱めることはない。

### 段階1 — read-only MCP サーバー（最小リスク）

- ContextBundle IR（CE-0契約の形）の制約付き投影をMCP resources/toolsとして公開する: reviewed-only / evidence subset / contradiction subset / 島・関係の要約等。
- 安全境界はADR-0049のエクスポート側をそのまま適用: SafeMode既定ON（本文redaction）、未レビュー既定除外、score/rank/confidence/priority語彙の不使用、`bundleHash`/`queryCanonicalHash` による監査相関。
- 書き込みツールを一切持たない。
- 輸送: stdio（ローカルClaude Code / Claude Desktop）を先行実装し、streamable HTTP + OAuth 2.1（2026-07-28仕様）を追加してChatGPT / Copilot Studioへ到達する。ChatGPT個人プランの読み取り専用強制は本段階の設計と外部制約が一致していることを意味する。
- 実装はCE-1の実データ化を待たず、EXT-AGENT-01が確立したDocumentV1直接走査＋SafeMode境界の投影ロジックを再利用して開始できる（前例: EXT-AGENT-01のスコープ判断）。ContextBundle IRの契約形はCE-0を正とし、輸送（MCP）は薄いアダプタに留める（R4対抗）。

### 段階2 — webhook → 提案カード ingest（proposal-only 書き込み）

- 外部エージェントの観察・ブリーフを `agent-response.v1` 互換payloadとしてHTTPで受け、提案（未レビュー・自動確定なし・個別undo可）としてのみ着地させる。
- EXT-AGENT-02のパーサ・サニタイズをそのまま再利用: 禁止フィールド除去（lenient）/拒否（strict）、orphan提案の保持、stale patchのファイル退避、解析だけでは文書を変えない原則。
- トリガー型AIの使い捨て出力（ephemeralな会議前ブリーフ等）の「堆積場」となり、人間が後からKJ法的に問題を立ち上げる素材にする（リサーチ役割D）。

### 段階3 — critique/constraint の機械可読エクスポート（訂正ループの輸出）

- 人間がエージェント由来カードへ付けた違和感タグ・保留・却下を、次回以降のエージェント実行への制約として機械可読に輸出する（`agent-task.v1` のガードレール節拡張、または独立のconstraint文書）。
- TRACEの知見（訂正→原子ルール→実行時強制）に接続する。違和感は理由不要（domain.md）のまま輸出できる形式とし、説明責任を人間に課さない。
- 仕様設計を要するため最後に置く。効果は最大（「同じ誤りを繰り返すAI」への、記憶ではなく制約による訂正チャネル）。

### 採用理由

- 順序はリスク昇順: 読み取り公開（既存のSafeMode/投影契約の再利用のみ）→ proposal-only原則で守られた書き込み → 新規仕様設計を要する訂正輸出。
- ADR-0049手動レーンで契約と安全境界が実地検証済みのため、本ADRで新設する安全判断は「公開エンドポイントの認証・認可」に集中できる。
- sui-sensemakingは「Agent Inbox（処理すべき受信箱）」ではなく「縁側（処理義務のない受け入れ縁）」であり、critiqueはnotify/question/reviewに続く第4のHITLパターンとして差別化される（追補A5、用語定義参照）。

### 非目標

- トリガー/スケジューラ面（カレンダー監視・定期実行等）の実装。前面はプラットフォーマーのものを使う。
- 通知プッシュ。エージェントは縁側に置き、人間は好きな時に見る。
- Consensus（レビュー済み層）への直接書き込み。human approvalを経ない昇格は今後も存在しない。
- 行動テレメトリ・利用計測（ADR-0042非監視制約の維持）。
- MCP Apps（チャット内サーバー描画UI）の実装。役割B「なぜ？リンク」の将来オプションとして記録のみ。
- リアルタイム共同編集。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | トリガー型AIの使い捨て出力を「縁側」（処理義務のない受け入れ縁）として保持し、人間が後からKJ法的に問題を立ち上げる素材にする。Agent Inbox（処理すべき受信箱）にしない | 機能: 提案は未レビュー・自動確定なし・個別undo可としてのみ着地。データ: 放置は失敗状態ではない |
| **データ設計** | 外部エージェント由来の提案カードはキャンバス周縁の受け入れ領域に堆積し、SafeMode本文redaction・未レビュー既定除外・反スコアリング・proposal-onlyを適用。`bundleHash`/`queryCanonicalHash`で監査相関 | 業務: 人間が明示採用するまで文書本体に入らない。機能: score/rank/confidence語彙を契約上不使用 |
| **機能設計** | 3段階導入（①read-only MCPサーバー：書き込みツールなし②webhook→proposal-only提案カードingest③critique/constraintの機械可読エクスポート）。各段階は独立停止可能で後段が前段の安全原則を弱めない。ADR-0049手動レーンの契約と安全境界を再利用 | 業務: 新設する安全判断は公開エンドポイントの認証・認可に集中。データ: 段階2の受信はsanitize強制経路としバイパスを作らない |

## Consequences

- 期待される効果: 1つのサーバーで3大エコシステムに到達し、ADR-0049手動レーンが自動化される。「エージェント記憶側の訂正ループ」と「キャンバス側の意味形成」を認識論的状態で結合した共有マップという空白（リサーチ§4）を先行確保する。
- 副作用/制約: (i) HTTP輸送時はOAuth 2.1リソースサーバー運用が入る（鍵管理・トークン検証）。公開面の追加は `THREAT_MODEL.md` の更新と、PRODUCT-QA-01ゲートでのセキュリティ照合を実装前提とする。(ii) 段階2の受信エンドポイントは悪性入力の一次面になるため、EXT-AGENT-02のsanitizeを強制経路とし、バイパス経路を作らない。(iii) 監査導線（CE-4: query log / ingest log）の整合が各段階のExit Criteriaに入る。
- 移行時の対応: 段階1は新規サービスまたは既存backendへの同居のどちらでも成立する（実装issueで決定）。ContextBundle IRが輸送非依存である限り、MCP仕様改訂への追随はアダプタ層の改修に閉じる。

## 追記 2026-07-12: UI面の設計方向を受領（Claude Design P32・先行相談への回答）

本ADRのAccepted判断の材料として、新設面のUI方向がClaude Design第2回照合（P32）で回答された。実装レッドラインはAccepted後の実装ラウンドで受領する。要点:

- **B-1外部エージェント由来カード**: 由来はメタ行の控えめな出所チップ（「⌂ agent名」、型バッジの後）。AI由来区別（ADR-0048 D1）を「非人間由来」共通マーク＋出所ラベルへ拡張し、色チャネルは新設しない。受け皿はキャンバス周縁の縁側レーン（直置きでも未処理キューでもない。P32回答時の呼称は「庭」＝用語定義参照）。束が増えたら集約チップ「外部からn件」に畳み、通知バッジ・赤丸は付けない。
- **B-2 「なぜ？」リンク着地**: readOnly＋focusでは不足、専用の読み取り専用「根拠トレイル」ビュー（ブリーフ→基づくレビュー済みカード群→関係線）。未レビュー・違和感・保留は既定非表示（共有前確認の露出規則を継承）。確からしさ%等は出さない。→ 実装Issue `EXT-CONN-04`。
- **B-3 critiqueの位置づけ**: 既存の違和感導線のまま成立。段階3で輸出が有効な場合に限り、違和感入力の近傍に受動態の帰結説明（「この違和感は次回の依頼に制約として渡ります」）を1行添える。輸出は既定で含めない・明示opt-in。

## Traceability

- Related: `01_Plans/research/research-2026-07-12-trigger-ai-external-integration.md`（Contextの根拠。追補含む）
- Related: `01_Plans/adr/ADR-0028-ai-cognitive-externalization-phase-plan.md`（CE-4の具体化）
- Related: `01_Plans/adr/ADR-0049-external-flat-rate-agent-collaboration.md`（契約・安全境界の正本。本ADRはその自動輸送版）
- Related: `01_Plans/adr/ADR-0047-design-decision-adr-saturation-and-execution-first.md`（再起票基準R-2）
- Related: `THREAT_MODEL.md`, `01_Plans/adr/ADR-0042-value-realness-validation-and-notice-exit.md`（非監視制約）
- Related: `01_Plans/issues/done/issue-EXT-CONN-01-readonly-mcp-server.md`（Acceptedに伴いOpen）, `issue-EXT-CONN-02-webhook-proposal-ingest.md`, `issue-EXT-CONN-03-critique-constraint-export.md`, `issue-EXT-CONN-04-evidence-trail-landing-view.md`（段階ゲートによりDraft維持）

---
