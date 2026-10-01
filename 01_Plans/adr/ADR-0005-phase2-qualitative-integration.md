# ADR-0005-phase2-qualitative-integration: Phase 2: 質的統合

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: `01_Plans/phase2_qualitative_integration.md`

## Context

`phase2_qualitative_integration.md` で管理していた計画・要件・受入条件を、ADR運用へ移管する。

## Decision

以下を本ADRの正本として採用する。


> Granularity split: 本ADRの内容は `ADR-0013`（要求・影響）と `ADR-0014`（受入・rollout）に分割管理する。
> 本ADRはPhase2の統合参照として維持する。

# Phase 2 定性統合計画（phase2_qualitative_integration）

本書は、Phase 1（Canvas MVP）後に導入する定性統合機能の要求仕様である。対象は **sui-sensemaking の A型図解** に限定し、B型文章化は対象外とする。

- 対象スコープ: sui-sensemaking（単一 Document の編集体験）
- 文書種別: Plan（実装可能な要求 + 受け入れ判定 + 段階導入）
- 上位整合の原則: `domain.md` / `value_to_requirements.md` / `02_Architecture/architecture.html` を優先

---

## 0. 上位整合（参照元）

- `00_Prompt/system_prompt.md`
- `00_Prompt/domain.md`
- `01_Plans/adr/ADR-0001-value-to-requirements.md`
- `01_Plans/adr/ADR-0002-internal-roadmap.md`
- `02_Architecture/architecture.html`
- `02_Architecture/schemas.md`
- `02_Architecture/island_shapes.md`

---

## 0.1 進捗記入（2026-02-23 確認）

- 状態サマリ: **2A/2B/2C すべて Done（実装 + テスト確認ベース）**
- 根拠メモ:
  - 2A（階層 / collapse）: backend roundtrip test と frontend collapse visibility test を確認。
  - 2B（similar-card merge）: merge suggestions UI・domain test・API route が存在し、テスト通過。
  - 2C（polygon）: polygon shape/geometry の保存復元・検証ロジックを backend/frontend 双方で確認。

| ワークストリーム | 進捗 | 補足 |
|---|---|---|
| Phase 2A: Hierarchy + collapse/expand | ✅ Done | `parentIslandId` / `collapsed` の保存復元、表示制御、undo/redo運用を実装済み。 |
| Phase 2B: Similar-card merge MVP | ✅ Done | 候補提示、承認フロー、代表カード、origin link を実装済み。 |
| Phase 2C: Freeform island boundary | ✅ Done | polygon auto-fit、shape切替、自己交差バリデーション、互換読込を実装済み。 |

## 1. 問題定義（Problem statements）

### PS-01 非矩形境界不足
矩形 (`Rect`) 固定の Island 境界では、L字・分岐・疎密混在を適切に包めず、意味境界が過剰/不足する。

### PS-02 類似カード増加による可読性低下
同義・準同義 Card が増えると探索負荷が増大する。だが domain 原則上「自動確定・単一正解化」は禁止である。

### PS-03 階層欠如による俯瞰困難
Island を上位まとまりへ束ねる操作がなく、俯瞰時の密度を制御できない。

### PS-04 視点切替不足
normal PC display で overview/detail の往復時、文脈保持と編集集中の両立が難しい。

---

## 2. ユーザーストーリー（User stories）

- US-2A-01: ユーザーとして、Island を親子階層で整理したい。なぜなら、議論単位を段階化したいから。
- US-2A-02: ユーザーとして、親 Island を collapse/expand したい。なぜなら、俯瞰時に密度を下げたいから。
- US-2A-03: ユーザーとして、collapsed 表示で representative title を確認したい。なぜなら、展開せず意味把握したいから。
- US-2B-01: ユーザーとして、similar-card merge の候補のみ提示してほしい。なぜなら、重複探索コストを下げたいから。
- US-2B-02: ユーザーとして、merge の最終確定は自分で行いたい。なぜなら、文脈差を保持する判断が必要だから。
- US-2C-01: ユーザーとして、Island 境界を polygon で表したい。なぜなら、視覚輪郭を意味まとまりに合わせたいから。
- US-2C-02: ユーザーとして、auto-fit 後に必要箇所のみ手動調整したい。なぜなら、初速と精度を両立したいから。
- US-V-01: ユーザーとして、overview ↔ detail を即時切替したい。なぜなら、文脈を維持して編集したいから。

---

## 3. Non-goals（非目標）

- NG-01: human 承認なしの自動 merge 確定。
- NG-02: 類似度ランキング・採点の導入（反スコアリングに反する）。
- NG-03: freehand / bezier / spline など高度輪郭編集。
- NG-04: 協調編集・権限管理・共有URLの同時導入。
- NG-05: B型文章化（要約/説明文生成）。

---

## 4. 要求一覧（Requirements）

### 4.1 機能要求（RQ）

| ID | 要求 | フェーズ |
|---|---|---|
| RQ-2A-01 | Island は `parentIslandId` による親子階層を保持できる。 | 2A |
| RQ-2A-02 | 親 Island は collapse/expand 可能で、collapsed 時は子 Island / Card を非表示化する。 | 2A |
| RQ-2A-03 | collapsed 表示は representative title（未設定時は `title`）を表示する。 | 2A |
| RQ-2A-04 | hierarchy/collapse 操作は undo/redo 対象である。 | 2A |
| RQ-2B-01 | similar-card merge candidate group を提示できる。 | 2B |
| RQ-2B-02 | 候補ごとに `採用 / 部分採用 / 却下 / 後で` を選択できる。 | 2B |
| RQ-2B-03 | merge 時に representative card を「既存選択 or 新規作成」できる。 | 2B |
| RQ-2B-04 | merge 後に origin link（元 Card 参照）を追跡できる。 | 2B |
| RQ-2C-01 | Island shape は `rect / rounded_rect / polygon` を往復保存できる。 | 2C |
| RQ-2C-02 | polygon auto-fit（convex hull + padding）を提供する。 | 2C |
| RQ-2C-03 | polygon の自己交差を保存時に拒否する。 | 2C |
| RQ-V-01 | overview/detail を UIトグルとショートカット双方で切替可能にする。 | 2A |
| RQ-V-02 | mode 切替は表示状態のみ変更し、Document 永続データは変更しない。 | 2A |

### 4.2 非機能要求（NFR）

| ID | 要求 |
|---|---|
| NFR-01 | review flags（`unreviewed` / `human_reviewed`）は人間操作でのみ遷移可能。 |
| NFR-02 | merge/shape/hierarchy に「正解スコア」「ランキング」を導入しない。 |
| NFR-03 | 旧データ（shape/hierarchy欠損）を互換読み込みできる。 |
| NFR-04 | auto-fit は deterministic（同一入力→同一出力）である。 |
| NFR-05 | `02_Architecture/architecture.html` の責務分離（Domain Model / Canvas Engine / Renderer）を崩さない。 |

---

## 5. 受け入れ基準（Acceptance criteria）

### AC-2A Hierarchy + collapse/expand
- AC-2A-1: 親子設定した Island を保存/再読込して階層が失われない。
- AC-2A-2: collapse 後、子 Island / Card が描画・ヒットテスト対象から除外される。
- AC-2A-3: expand で直前表示状態（表示対象・選択）に復帰する。
- AC-2A-4: collapsed 親 Island に対して移動・選択・タイトル編集が可能。
- AC-2A-5: collapse/expand/hierarchy 変更は undo/redo で可逆。

### AC-2B Similar-card merge MVP（manual assisted）
- AC-2B-1: candidate group 一覧が表示され、各 group の対象 Card を確認できる。
- AC-2B-2: 各 group に `採用 / 部分採用 / 却下 / 後で` を保存できる。
- AC-2B-3: 採用時、representative card が必ず1件確定する。
- AC-2B-4: representative card から元 Card の origin link を辿れる。
- AC-2B-5: system 処理のみでは `human_reviewed` へ遷移しない。

### AC-2C Freeform island boundary（polygon tools + auto fit）
- AC-2C-1: `rect / rounded_rect / polygon` の表示・保存・再読込が破綻しない。
- AC-2C-2: auto-fit は同一入力で同一輪郭を返す。
- AC-2C-3: padding は `island_shapes.md` の制約範囲で調整できる。
- AC-2C-4: 自己交差 polygon の保存は失敗し、既存状態を保持する。
- AC-2C-5: `shape` 欠損の旧 Document は `rect` として表示できる。
- AC-2C-6: polygon 頂点ドラッグは pointer up 時のみ確定保存し、drag move はプレビューに限定する。
- AC-2C-7: polygon 編集で `points.length < 3` になる操作は拒否し、確定済み shape を保持する。
- AC-2C-8: polygon 編集で自己交差になる操作は拒否し、確定済み shape を保持する。
- AC-2C-9: 同一入力の頂点編集は小数第2位丸めで決定論結果を維持する。

### AC-V Viewpoint switching（overview ↔ detail）
- AC-V-1: overview は hierarchy 前提で collapsed 単位の低密度表示になる。
- AC-V-2: detail は focus Island の Card 編集を優先し、周辺文脈は参照可能に保つ。
- AC-V-3: mode 切替前後で Document 永続データ差分が発生しない。
- AC-V-4: UIトグルとショートカットで同一 mode 切替結果になる。

---

## 6. データモデル影響（Data model impact）

`schemas.md` の DocumentV1 互換を維持し、optional 拡張で段階導入する。

- DM-01: `Island.parentIslandId?: string`
- DM-02: `Island.collapsed?: boolean`
- DM-03: `Island.representativeTitle?: string`
- DM-04: `Card.representativeOf?: string[]`（または `MergeProposal` 参照）
- DM-05: `MergeProposal`（`id, candidateCardIds, status, selectedRepresentativeCardId?`）
- DM-06: `ViewState.mode: "overview" | "detail"`（UI state 層で保持）
- DM-07: `Island.shape` は `island_shapes.md` 準拠（`polygon` 段階導入）

補足:
- `ViewState` は Document本体ではなく表示状態。永続モデルに混在させない。

---

## 7. UI/UX影響（UI/UX impact）

- UI-2A-01: Island inspector に「親設定」「子一覧」「collapse/expand」を追加。
- UI-2A-02: collapsed 表示は representative title + 件数バッジ（子Island数/Card数）。
- UI-2B-01: 右パネルに `Merge Candidates` セクションを追加。
- UI-2B-02: group ごとに比較プレビュー（共通点/差異）を表示。
- UI-2C-01: Island toolbar に `Rect / RoundedRect / Polygon` 切替を追加。
- UI-2C-02: polygon 主操作は `Auto-fit`、手動編集は 2C 後半で段階導入。
- UI-V-01: ヘッダーに `Overview` / `Detail` トグルを常設。

---

## 8. リスクと緩和策（Risks & mitigations）

- R-01: 階層導入で学習コストが増える
  - M-01: 2A は「1親に複数子」の基本操作に限定（横断参照は非対応）。
- R-02: merge が誤統合を誘発する
  - M-02: default は候補提示のみ、反映は明示承認 + undo/redo 必須。
- R-03: polygon が破綻形状になる
  - M-03: 自己交差検証 + 保存失敗時ロールバックを必須化。
- R-04: overview/detail 切替で混乱する
  - M-04: 導線をヘッダーに統一し、ショートカットを一貫化する。
- R-05: スキーマ互換が崩れる
  - M-05: optional 追加を原則とし、破壊的変更時のみ `Document.version` 更新。

---

## 9. 段階導入計画（Phased rollout）

### Phase 2A: Hierarchy + collapse/expand

**スコープ**
- RQ-2A-01〜04, RQ-V-01〜02

**実装アウトプット**
- Island 階層保存/復元
- collapse/expand UI
- representative title 表示
- overview/detail 切替（表示限定）

**Exit criteria（全て必須）**
- AC-2A-1〜5 を満たす
- AC-V-1,3,4 を満たす
- `phaseX_future_backlog.md` の FB-P2A-01〜04 が DoD 完了

### Phase 2B: Similar-card merge MVP（manual assisted）

**スコープ**
- RQ-2B-01〜04

**実装アウトプット**
- candidate group 提示
- 承認フロー（採用/部分採用/却下/後で）
- representative card 決定
- origin link 保存

**Exit criteria（全て必須）**
- AC-2B-1〜5 を満たす
- `phaseX_future_backlog.md` の FB-P2B-01〜04 が DoD 完了

### Phase 2C: Freeform island boundary（polygon tools + auto fit）

**スコープ**
- RQ-2C-01〜03

**実装アウトプット**
- shape 切替 UI
- polygon auto-fit
- 保存バリデーション（自己交差拒否）
- 旧データ互換読み込み

**Exit criteria（全て必須）**
- AC-2C-1〜5 を満たす
- `phaseX_future_backlog.md` の FB-P2C-01〜03 が DoD 完了

---

## 10. チケット化テンプレート（実装チーム向け）

各実装チケットは最低限次を含むこと。

- 対応ID: `FB-*`
- 対応要求: `RQ-*`
- 対応受け入れ基準: `AC-*`
- 変更対象境界: Domain Model / Canvas Engine / Renderer / API
- 非目標（このチケットでやらないこと）
- 完了証跡: AC満了を示す確認手順（手動または自動）

---

## 11. 実装着手前チェックリスト

- C-01: `schemas.md` の optional 拡張で要求を表現できるか。
- C-02: `02_Architecture/architecture.html` の責務境界を維持しているか。
- C-03: review flags を自動変更していないか。
- C-04: UI/API に「正解・採点・ランキング」を導入していないか。
- C-05: overview/detail が表示状態に限定され、Document本体を暗黙変更しないか。
- C-06: 各 backlog item が `RQ` と `AC` に一意対応するか。



## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | Phase 2（質的統合）をADR-0002の内部ロードマップに基づく実装計画として実行する。質的統合（カード群のまとめ・関係・叙述化）の統合参照として維持する | 機能: 質的統合の計画を受入条件として固定し、要求（ADR-0013）と受入・rollout（ADR-0014）へ分割管理する。データ: 質的統合の計画・要件・受入条件を一箇所で追跡可能にする |
| **データ設計** | `phase2_qualitative_integration.md`の内容を本ADRへ移管し旧文書は廃止して参照を統一。既存リンクは本ADRパスへ更新 | 業務: 質的統合の実装判断をADR履歴で追跡する。機能: 要求と受入基準の分割（ADR-0013/0014）と整合させる |
| **機能設計** | Phase 2の統合参照として本ADRを維持し、実装計画を参照しやすい単位に移管する | 業務: 質的統合の受入条件を本ADRへ統一する。データ: 旧`phase2_qualitative_integration.md`は廃止し情報欠落なく本ADRへ移管 |

## Consequences

- 旧文書 `phase2_qualitative_integration.md` は廃止し、本ADRへ参照を統一する。
- 既存リンクは `01_Plans/adr/ADR-0005-phase2-qualitative-integration.md` へ更新する。

## Traceability

- Source: `01_Plans/phase2_qualitative_integration.md`
- Supersedes: `01_Plans/phase2_qualitative_integration.md`
