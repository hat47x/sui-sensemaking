# ADR-0002-internal-roadmap: 内部ロードマップとフェーズ進行方針

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: `01_Plans/roadmap.md`

## Context

`roadmap.md` で管理していた計画・要件・受入条件を、ADR運用へ移管する。

## Decision

以下を本ADRの正本として採用する。

# 開発ロードマップ

本ドキュメントは、本アプリケーションを破綻させずに最小MVPまで到達するための実装順序を定義します。

- README.md / domain.md / system_prompt.mdを前提とします
- 思想・概念の追加は行いません
- ここでは 「何を、どの順で作るか」 のみを扱います

---

## 全体方針

- 最小単位で作る
- 常に可逆性を保つ
- UI・データ・AIを一度に完成させない
- A型図解（空間配置）を最優先 とする
- B型文章化はMVPには含めない（レビュー状態の概念のみ設計に反映）

---

## フェーズ構成（概要）

| Phase | 目的 | 成果物 |
|---|---|---|
| 0 | プロジェクト骨格の確定 | ビルド・実行可能な空リポジトリ |
| 1 | Canvas 最小実装 | カードを置いて動かせる |
| 2 | Core データモデル接続 | Card / Layout の永続化 |
| 3 | 未統合（Shelf）と可逆操作 | 保留状態の実装 |
| 4 | Draft（たたき台）生成 | AIによる仮配置 |
| 5 | Critique（違和感）入力 | 人間からの否定を記録 |
| 6 | 再配置ループ | Draft → Critique → Update |

---

## Phase 0 — プロジェクト骨格

目的  
開発を始められる最小構成を整える。

作業内容
- リポジトリ構造（00〜04）の確定
- フロントエンド / バックエンド / AIの雛形作成
- ローカルで起動できることを確認

完了条件
- `npm start` / `pnpm dev` 等で空画面が表示される
- CIが通る（最低限）

---

## Phase 1 — Canvas 最小実装（A型図解の核）

目的  
思考の場としての「空間」を先に成立させる。

作業内容
- 無限キャンバス（ズーム・パン）
- カードの生成・移動・削除
- カード内容のテキスト編集

意図的にやらないこと
- 自動配置
- グルーピング
- AI連携

完了条件
- ユーザーがカードを自由に置き、並べ替えられる

---

## Phase 2 — Core データモデル接続

目的  
A型図解をデータとして保持できるようにする。

作業内容
- Card / Layoutの最小スキーマ定義
- キャンバス状態の保存・復元
- 差分更新（全消し保存を避ける）

設計上の注意
- 順序・関係を将来付与できる余地を残す
- レビュー状態（human_reviewed / unreviewed）を拡張可能な形で設計

完了条件
- ページリロード後も配置が復元される

---

## Phase 3 — 未統合（Shelf）と可逆操作

目的  
「まだ束ねない」状態を正規の状態として扱う。

作業内容
- 未統合カードの退避領域（Shelf）
- Shelf ⇄ Canvasの移動
- 操作履歴（Undo / Redoもしくは履歴スタック）

完了条件
- ユーザーが意図的に保留を作れる
- 操作を取り消せる

---

## Phase 4 — Draft（たたき台）生成

目的  
AIを「判断者」ではなく「仮案生成器」として導入する。

作業内容
- カード群からのDraftCluster生成
- 複数案提示（最低2〜3案）
- Draftは常に破棄可能

設計上の注意
- 正解・最適という語を使わない
- 採用／部分採用／却下を前提とする

完了条件
- AIが仮配置を提示し、ユーザーが無視できる

---

## Phase 5 — Critique（違和感）入力

目的  
人間の否定・違和感を一次データとして記録する。

作業内容
- Critiqueの種類定義（近すぎる／違う／理由なし 等）
- Critiqueの対象指定（カード／クラスタ／関係）
- Critiqueの保存

設計上の注意
- 理由入力を必須にしない
- 正誤判定をしない

完了条件
- ユーザーが「これは違う」と言える

---

## Phase 6 — 再配置ループ

目的  
Draft → Critique → 再提案 の最小循環を成立させる。

作業内容
- Critiqueを制約として再配置に反映
- 再配置案の提示（複数）
- 過去案との比較

完了条件
- AIが「前より違う案」を出す
- ユーザーがさらに否定できる

---

## 非スコープ項目の扱い（運用）

公開向けの非目標（Out of Scope）はルート `ROADMAP.md` を正本とし、
本ドキュメントでは重複列挙しない。

実装計画として扱う必要が生じた場合のみ、`phaseX_future_backlog.md` に アクション + DoD 形式で起票する。

---

## Phase 2拡張計画への参照

Phase 1以降の定性統合（Hierarchy / Similar-card merge / 非矩形Island / viewpoint switching）の要求整理は、
`01_Plans/adr/ADR-0005-phase2-qualitative-integration.md` を参照する。

実装着手時は同ドキュメントの受け入れ基準とphased rollout（2A/2B/2C）を基準にチケット化する。
バックログ管理は `01_Plans/adr/ADR-0007-future-backlog.md` を正とし、要求ID（RQ）と受け入れ基準（AC）を対応づけて運用する。
フェーズ完了判定は `phaseX_future_backlog.md` のGate-2A / Gate-2B / Gate-2Cを採用する。


## ROADMAP詳細項目の移管先

ルート `ROADMAP.md` から分解した詳細項目（UX深化、研究用途強化、セキュリティ維持、
ローカライゼーション、公開運用）は `01_Plans/adr/ADR-0007-future-backlog.md` の
「Roadmap統合バックログ（公開ROADMAPの実装分解）」で管理する。

- 方針レベル: `ROADMAP.md`は次のとおりです。
- 実装分解（Action/DoD/状態）: `phaseX_future_backlog.md`
- スプリント投入順・Gate判定: `phaseX_future_backlog.md`（既存Phase 2 backlogと同一運用）



## ADR-0018 Follow-up: Frontend lint 強化（ESLint）段階導入計画

目的
Frontendの可読性・安全性ルールをCIで継続的に検知し、`ADR-0018` で定義した
バッドスメル再発防止（巨大ファイル化 / スタイル重複 / 複雑化）を実運用へ接続する。

導入方針（段階導入）
- Phase A: ベースライン構築（warn中心）
  - ESLintをFrontendに導入し、既存コード停止を避けるためwarning中心で開始する。
  - 最低限のルール（未使用変数、危険なany、import順、hooks基本）を有効化する。
  - `npm run lint` をローカル実行可能にし、開発者の早期検知を優先する。
- Phase B: CIゲート化（error昇格）
  - 新規/変更コードに対する違反はerror扱いとし、CI fail条件へ昇格する。
  - 既存負債は段階是正対象として管理し、一括修正を必須化しない。
- Phase C: smell是正ルール拡張
  - `ADR-0018` の観測課題に対応するルールを追加する（巨大ファイル抑制、重複スタイル抑制）。
  - 必要に応じてcustom ruleまたは補助スクリプトを導入し、規約逸脱を機械検知する。

CI統合ポリシー
- CIには `frontend lint` ジョブを追加し、Phase B以降は必須ゲートとして扱う。
- 型検査・テストとlintを分離し、失敗原因を即時特定できる構成を維持する。
- 破壊的変更回避のため、導入初期は段階ロールアウト（warn→error）を厳守する。

受入条件（DoD）
- Frontendで `npm run lint`（または同等コマンド）が定義され、ローカル実行できる。
- CIでlint結果が可視化され、Phase B到達時点でfail-on-errorが有効になる。
- 規約文書（`02_Architecture/coding_standards.md`）と運用導線（`CONTRIBUTING.md`）に
  lint実行手順と運用ルールが同期される。
- SafeMode既定ON・漏えい防止の既存ポリシーに影響を与えない。

トレーサビリティ
- Source ADR: `01_Plans/adr/ADR-0018-coding-standards-and-smell-remediation.md`
- Related: `.github/workflows/ci.yml`, `02_Architecture/coding_standards.md`, `CONTRIBUTING.md`

---

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 従来の`roadmap.md`で管理していた計画・要件・受入条件をADR運用へ移管し、フェーズ進行の判断根拠を追跡可能にする。内部ロードマップを正本として保持する | 機能: フェーズごとのExit条件を受入条件として固定。データ: 各フェーズの計画・要件・受入条件を一箇所で追跡可能にする |
| **データ設計** | `roadmap.md`の内容を本ADRへ移管し、旧文書は廃止して参照を統一。既存リンクは本ADRパスへ更新 | 業務: フェーズ進行方針の変更をADR履歴で追跡する。機能: 下流ADR（Phase0-3等）が本ADRの計画に整合させる |
| **機能設計** | 内部ロードマップを参照しやすい単位に移管し、フェーズ計画の入力として利用できるようにする | 業務: 計画・要件・受入条件の参照先を本ADRへ統一する。データ: 旧`roadmap.md`は廃止し情報欠落なく本ADRへ移管 |

## Consequences

- 旧文書 `roadmap.md` は廃止し、本ADRへ参照を統一する。
- 既存リンクは `01_Plans/adr/ADR-0002-internal-roadmap.md` へ更新する。

## Traceability

- Source: `01_Plans/roadmap.md`
- Supersedes: `01_Plans/roadmap.md`
