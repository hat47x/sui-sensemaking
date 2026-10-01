# ADR-0004-phase1-canvas-mvp: Phase 1: Canvas MVP

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: `01_Plans/phase1_canvas_mvp.md`

## Context

`phase1_canvas_mvp.md` で管理していた計画・要件・受入条件を、ADR運用へ移管する。

## Decision

以下を本ADRの正本として採用する。

# Phase 1（Canvas MVP）計画書

このドキュメントは、`01_Plans/adr/ADR-0002-internal-roadmap.md` に基づき、**Phase 1：Canvas MVP** を実行するための
**実装計画書**です。

Phase 0 で整えた足場の上に、sui-sensemaking の核となる **A型図解（Canvas）** を最小構成で成立させます。

---

## 1. Phase 1 の目的

Phase 1 の目的は、以下を同時に満たすことです。

- KJ法における **A型図解の最低限の成立**
- 人間が「考えるために動かせる空間」を提供する
- 正解化・最適化・自動整理を **一切行わない**

このフェーズでは、**意味の生成・評価・文章化**には踏み込みません。

---

## 2. 成果物の定義（Definition of Done）

Phase 1 は、以下をすべて満たした時点で完了とします。

- [x] 無限キャンバス相当の表示領域がある
- [x] パン（平行移動）とズームが可能
- [x] 複数のカードが表示される
- [x] カードが座標を持ち、再描画後も位置が保持される
- [x] ドキュメントを保存・再読込できる

### 2.1 進捗記入（2026-02-23 確認）

- 状態: **完了（Done）**
- 確認メモ:
  - `canvas/transform`・`layout_ops`・`docs roundtrip` に関するテストが通過。
  - Canvas MVP の中核（Transform / Card配置 / 保存復元）が実装・維持されている。

---

## 3. スコープ（やること / やらないこと）

### 3.1 やること（MVP）

- world座標系の導入（Transform）
- パン・ズーム操作
- Card の表示（DOM）
- Card の移動（ドラッグ）
- ドキュメントの保存・復元（API）

### 3.2 やらないこと（非MVP）

- Edge（線）の表示
- 囲み（島）
- 自動レイアウト
- AIによる提案
- 文章化・要約
- 出自情報の表示

---

## 4. 技術的前提

- フロント：React + TypeScript
- Canvas表現：DOM + SVG（必要最小）
- 状態管理：React内ローカル状態（外部Store不要）
- バックエンド：Phase 0 のAPIを拡張

---

## 5. フロントエンド設計（Phase 1）

### 5.1 主要コンポーネント

- `CanvasShell`
  - world ↔ screen 変換
  - パン・ズーム管理

- `CardView`
  - Card の描画
  - ドラッグ操作

### 5.2 状態の分離（重要）

- **Canvas状態**：transform（pan/zoom）
- **Domain状態**：Document / Card 配列

UI状態（選択中カード等）は Phase 1 では最小限に留める。

---

## 6. バックエンド設計（Phase 1）

### 6.1 追加API

- `GET /docs/{doc_id}`
- `PUT /docs/{doc_id}`

※ `02_Architecture/api.md` の定義に従う。

### 6.2 永続化

- SQLite での保存をまず成立させる
- SQLAlchemy による DocumentV1 のJSON保存

---

## 7. 作業分割（AIに渡す単位）

Phase 1 は以下の順序で実装する。

1. world / screen 変換ユーティリティ
2. パン・ズーム操作
3. Card の表示（固定座標）
4. Card ドラッグ
5. 保存・復元API接続

---

## 8. UX上の注意点（重要）

- 操作は **軽く・可逆** であること
- 誤操作があっても致命的にならない
- 「整理させられている」印象を与えない

Canvas は「結論を出す装置」ではなく、
**思考を留めておく器**である。

---

## 9. Phase 2 への接続

Phase 1 が完了したら、次は Phase 2（関係・構造の導入）に進む。

- Edge（関連線）
- 島（囲み）
- 選択・フォーカス

を扱う予定とする。

Phase 1 では、それらを **後付けできる余白** を残すことが重要である。


## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | Phase 1（Canvas MVP）をADR-0002の内部ロードマップに基づく実装計画として実行する。カード配置・島形成・保留操作のMVP受入条件を固定し、後付けできる余白を残す | 機能: Canvas MVPの受入条件（カード作成・配置・編集・保留）を固定し、後続Phaseの拡張余地を残す。データ: MVPの計画・要件・受入条件を一箇所で追跡可能にする |
| **データ設計** | `phase1_canvas_mvp.md`の内容を本ADRへ移管し旧文書は廃止して参照を統一。既存リンクは本ADRパスへ更新 | 業務: Canvas MVPの実装判断をADR履歴で追跡する。機能: 後続Phase（質的統合等）が本ADRのMVP前提に整合させる |
| **機能設計** | Canvas MVPの実装計画を参照しやすい単位に移管し、Phase 1実行の入力として利用できるようにする | 業務: MVP受入条件を本ADRへ統一する。データ: 旧`phase1_canvas_mvp.md`は廃止し情報欠落なく本ADRへ移管 |

## Consequences

- 旧文書 `phase1_canvas_mvp.md` は廃止し、本ADRへ参照を統一する。
- 既存リンクは `01_Plans/adr/ADR-0004-phase1-canvas-mvp.md` へ更新する。

## Traceability

- Source: `01_Plans/phase1_canvas_mvp.md`
- Supersedes: `01_Plans/phase1_canvas_mvp.md`
