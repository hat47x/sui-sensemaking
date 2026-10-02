# island_shapes — Island形状設計（F-01 非矩形Island）

本ドキュメントは、Islandの形状を矩形以外へ拡張するための設計案を定義する。  
対象は **形状表現・生成・描画・互換移行** に限定し、実装コードは扱わない。

上位整合は次のとおりです。
- `00_Prompt/system_prompt.md`（階層遵守）
- `01_Plans/adr/ADR-0002-internal-roadmap.md`（A型図解優先 / 段階導入）
- `01_Plans/adr/ADR-0001-value-to-requirements.md`（反スコアリング / review flags）
- `02_Architecture/schemas.md` / `02_Architecture/api.md`（DocumentV1互換）

---

## 1. Shapes

Islandがサポートする形状は以下の3種。

- `Rect`
- `RoundedRect`
- `Polygon`

方針は次のとおりです。
- MVP互換の既定形は `Rect`。
- `RoundedRect` は `Rect` の視認性改善版として扱う。
- `Polygon` はカード分布に追従する非矩形表現として扱う。

---

## 2. Data model proposal

`schemas.md` の `Island` 拡張として、`shape` をoptionalで導入する。

```ts
export type Point = { x: number; y: number };

export type IslandShape =
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "rounded_rect";
      x: number;
      y: number;
      width: number;
      height: number;
      radius: number;
    }
  | {
      kind: "polygon";
      points: Point[]; // minimum 3
    };

export type Island = {
  id: string;
  title?: string;
  cardIds: string[];
  shape?: IslandShape; // 未指定時は rect として解釈（互換読み込み）

  // AI提案由来の形状を将来扱うための整合用（任意）
  reviewState?: "unreviewed" | "human_reviewed";
};
```

最小バリデーションは次のとおりです。
- `rect` / `rounded_rect`
  - `width > 0`, `height > 0`
  - `radius >= 0 && radius <= min(width, height)/2`
- `polygon`
  - `points.length >= 3`
  - 自己交差禁止（検出時は保存エラー）

review flags整合（重要）:
- AIが提案した形状情報は `unreviewed` で開始する。
- `human_reviewed` への遷移は人間操作のみで許可する。
- バッチ再生成・自動補正がreview状態を自律変更してはならない。
- 形状の「正解度」や「採点」フィールドは追加しない。

---

## 3. Auto-generation（convex hull + padding）

`Polygon` の自動生成は以下の最小フローとする。

1. `cardIds` に対応するカード座標を収集。
2. 点集合を作る（初期はカード中心点、将来はカード矩形頂点を選択可）。
3. 点集合からconvex hullを計算。
4. hull外側へ一様paddingを適用。
5. 結果を `shape.kind = "polygon"` として保存。

既定値は次のとおりです。
- `padding = 24`（world座標）
- 範囲制約: `8 <= padding <= 64`は次のとおりです。

実装上の注意（仕様レベル）は次のとおりです。
- 同一入力で同一出力になる決定的生成にする（非ランダム）。
- smoothingは任意・軽量（無効でも動作可能）とする。
- AI提案形状でも自動確定せず、人間採用を前提とする。

---

## 4. Manual editing（vertex handles）

Polygon形状では、最小UIとして頂点ハンドルによる編集を許可する。

- 頂点ハンドル表示
- 頂点ドラッグ移動（開始/移動/確定/キャンセル）
- Alt+Click辺: 頂点追加
- Alt+Click頂点: 頂点削除（最小3点維持）

イベント仕様（頂点移動）は次のとおりです。

1. `drag start`
   - 対象頂点を確定し、編集セッションを開始する。
2. `drag move`
   - プレビュー座標を更新する。
   - 編集時検証（最小3点・自己交差禁止）を適用し、不正時は警告のみ（保存しない）。
3. `drag commit`
   - ポインタ解放時に1回だけ確定保存する（Undo粒度を維持）。
   - 確定時検証に失敗した場合は保存拒否し、ドラッグ前状態を維持する。
4. `drag cancel`
   - ポインタキャンセル時は保存しない。
   - 直前の確定済みshapeを維持する。

制約は次のとおりです。
- 最小頂点数3を強制
- 自己交差を禁止
- 不正形状操作時は保存拒否（安全フォールバック: 直前状態を維持）

FB-P2C-04 受入条件（固定）:
- AC-2C-6: polygon編集中はドラッグ確定時のみ `shape.points` を永続化し、drag moveはプレビュー専用とする。
- AC-2C-7: `points.length < 3` になる操作は拒否し、直前の確定済み `shape.points` を保持する。
- AC-2C-8: 自己交差polygonになる操作は拒否し、直前の確定済み `shape.points` を保持する。
- AC-2C-9: 同一入力（同一点群 + 同一移動量）で同一保存結果になるよう、座標は小数第2位で丸めて決定論を維持する。

互換/保存時バリデーションは次のとおりです。
- import互換読込では不正polygonをフォールバック可能だが、保存系（strict validate / export）は不正polygonを受理しない。
- manual editの拒否動作は `save時エラーに依存せず` UI時点で成立させる（保存時にも二重で拒否される）。

---

## 5. Hit-testing & rendering notes

### 5.1 Hit-testing
- `Rect` / `RoundedRect`: bboxベース判定
- `Polygon`: point-in-polygon（ray casting等）
- 選択優先度（誤操作低減）
  1. Card
  2. Edge
  3. Island

### 5.2 Rendering
- SVG前提
  - `Rect` / `RoundedRect`: `<rect>`
  - `Polygon`: `<polygon>`（将来 `<path>` へ移行余地）
- 推奨描画順
  - Island fill → Edge → Card → Selection overlay
- 視認性方針
  - fillは低不透明度
  - strokeは細線
  - カード可読性を最優先

### 5.3 パフォーマンスメモ
- Polygon再計算は最小化する。
- カードドラッグ中はthrottleし、ドラッグ終了時に最終再計算する。

---

## 6. Migration plan

1. スキーマ拡張: `Island.shape` optional追加（既定は `Rect` 扱い）。
2. 互換読み込み: `shape` 欠損の旧データで `Rect` を合成。
3. 描画分岐: `Rect` / `RoundedRect` / `Polygon` を実装。
4. ヒットテスト分岐: 形状ごとの判定へ分離。
5. Polygon自動生成を機能フラグで段階導入。

API互換（`api.md` 整合）:
- 初期は `DocumentV1` のままoptional field追加で互換を維持する。
- 破壊的変更が必要な段階でのみ `version` 更新を検討する。

受け入れ条件（最小）は次のとおりです。
- 旧ドキュメント（shape欠損）を表示・保存できる。
- 新規ドキュメントで3形状を破壊なく往復保存できる。
- 正解/ランキング/採点をUI・APIに導入しない。
- 人間操作なしでreview状態を変更しない。

---

## 7. Non-goals

この設計では以下を扱わない。

- freehand輪郭
- bezier / spline編集
- 形状の正解スコアリング
- AIによる自動確定
- 高度な幾何制約（角度固定・直交固定・高度スナップ）
