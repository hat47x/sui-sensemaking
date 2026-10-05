# island_shapes: Islandの形状設計（F-01 非矩形Island）

本ドキュメントは、Islandの形状を矩形以外へ拡張するための設計案を定義する。  
対象は **形状の表現・生成・描画・互換移行** に限り、実装コードは扱わない。

上位文書との整合は次のとおりです。
- `00_Prompt/system_prompt.md`（階層遵守）
- `01_Plans/adr/ADR-0002-internal-roadmap.md`（A型図解優先 / 段階導入）
- `01_Plans/adr/ADR-0001-value-to-requirements.md`（反スコアリング / review flags）
- `02_Architecture/schemas.md` / `02_Architecture/api.md`（DocumentV1互換）

---

## 1. 形状の種類

Islandがサポートする形状は、次の3種類である。

- `Rect`
- `RoundedRect`
- `Polygon`

方針は次のとおりです。
- MVP互換の既定の形は `Rect` とする。
- `RoundedRect` は、`Rect` を見やすくした版として扱う。
- `Polygon` は、カードの分布に沿う非矩形の表現として扱う。

---

## 2. データモデル案

`schemas.md` の `Island` を拡張し、`shape` をoptionalで導入する。

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

最小限のバリデーションは次のとおりです。
- `rect` / `rounded_rect`
  - `width > 0`, `height > 0`
  - `radius >= 0 && radius <= min(width, height)/2`
- `polygon`
  - `points.length >= 3`
  - 自己交差は禁止する（検出したら保存エラー）

review flagsとの整合（重要）は次のとおりです。
- AIが提案した形状情報は `unreviewed` で始める。
- `human_reviewed` への遷移は、人間の操作だけに許す。
- バッチ再生成や自動補正が、review状態を自律的に変更してはならない。
- 形状の「正解度」や「採点」のフィールドは追加しない。

---

## 3. 自動生成（凸包とパディング）

`Polygon` の自動生成は、次の最小フローとする。

1. `cardIds` に対応するカードの座標を集める。
2. 点集合を作る（初期はカードの中心点。将来はカード矩形の頂点も選べるようにする）。
3. 点集合から凸包（convex hull）を計算する。
4. 凸包の外側へ一様にパディングを適用する。
5. 結果を `shape.kind = "polygon"` として保存する。

既定値は次のとおりです。
- `padding = 24`（world座標）
- 範囲の制約は `8 <= padding <= 64` とする。

実装上の注意（仕様レベル）は次のとおりです。
- 同じ入力から同じ出力が得られる決定的な生成にする（非ランダム）。
- スムージングは任意かつ軽量とする（無効でも動作できる）。
- AI提案の形状も自動では確定せず、人間が採用することを前提とする。

---

## 4. 手動編集（頂点ハンドル）

Polygon形状では、最小限のUIとして、頂点ハンドルによる編集を許可する。

- 頂点ハンドルを表示する
- 頂点をドラッグして移動する（開始 / 移動 / 確定 / キャンセル）
- Alt+Clickで辺をクリック: 頂点を追加する
- Alt+Clickで頂点をクリック: 頂点を削除する（最小3点は維持する）

頂点移動のイベント仕様は次のとおりです。

1. `drag start`
   - 対象の頂点を確定し、編集セッションを開始する。
2. `drag move`
   - プレビューの座標を更新する。
   - 編集時の検証（最小3点、自己交差の禁止）を適用し、不正なときは警告だけを出す（保存はしない）。
3. `drag commit`
   - ポインタを離したとき、1回だけ確定して保存する（Undoの粒度を保つ）。
   - 確定時の検証に失敗したら保存を拒否し、ドラッグ前の状態を保つ。
4. `drag cancel`
   - ポインタがキャンセルされたときは保存しない。
   - 直前に確定したshapeを保つ。

制約は次のとおりです。
- 最小頂点数3を強制する
- 自己交差を禁止する
- 不正な形状になる操作は保存を拒否する（安全なフォールバックとして、直前の状態を保つ）

FB-P2C-04の受入条件（固定）は次のとおりです。
- AC-2C-6: polygon編集中は、ドラッグ確定時にだけ `shape.points` を永続化し、drag moveはプレビュー専用とする。
- AC-2C-7: `points.length < 3` になる操作は拒否し、直前に確定した `shape.points` を保持する。
- AC-2C-8: 自己交差するpolygonになる操作は拒否し、直前に確定した `shape.points` を保持する。
- AC-2C-9: 同じ入力（同じ点群と同じ移動量）から同じ保存結果になるよう、座標は小数第2位で丸めて決定性を保つ。

互換読み込みと保存時のバリデーションは次のとおりです。
- import時の互換読み込みでは、不正なpolygonをフォールバックしてよい。保存系（厳格な検証やexport）は、不正なpolygonを受理しない。
- manual editの拒否動作は、保存時のエラーに頼らず、UIの時点で成立させる（保存時にも二重に拒否される）。

---

## 5. ヒットテストと描画のメモ

### 5.1 ヒットテスト
- `Rect` / `RoundedRect`: バウンディングボックスで判定する
- `Polygon`: 点が多角形の内側にあるかで判定する（ray castingなど）
- 選択の優先度（誤操作を減らすため）
  1. Card
  2. Edge
  3. Island

### 5.2 描画
- SVGを前提とする
  - `Rect` / `RoundedRect`: `<rect>`
  - `Polygon`: `<polygon>`（将来は `<path>` へ移行する余地がある）
- 推奨する描画順
  - Islandの塗り → Edge → Card → 選択オーバーレイ
- 視認性の方針
  - 塗りは低い不透明度にする
  - 輪郭線は細くする
  - カードの読みやすさを最優先する

### 5.3 パフォーマンスのメモ
- Polygonの再計算は最小限にする。
- カードのドラッグ中はスロットリングし、ドラッグ終了時に最終的な再計算をする。

---

## 6. 移行計画

1. スキーマ拡張: `Island.shape` をoptionalで追加する（既定は `Rect` 扱い）。
2. 互換読み込み: `shape` がない旧データでは、`Rect` を合成する。
3. 描画の分岐: `Rect` / `RoundedRect` / `Polygon` を実装する。
4. ヒットテストの分岐: 形状ごとの判定に分ける。
5. Polygonの自動生成は、機能フラグで段階的に導入する。

API互換（`api.md` と整合）は次のとおりです。
- 初期は `DocumentV1` のまま、optionalフィールドを追加して互換を保つ。
- 破壊的変更が必要になった段階に限り、`version` の更新を検討する。

最小限の受け入れ条件は次のとおりです。
- 旧ドキュメント（shapeがないもの）を表示・保存できる。
- 新規ドキュメントで3種類の形状を、壊さずに往復保存できる。
- 正解・ランキング・採点を、UIにもAPIにも導入しない。
- 人間の操作なしにreview状態を変更しない。

---

## 7. 対象外

この設計では、次を扱わない。

- freehandの輪郭
- bezier / splineの編集
- 形状の正解スコアリング
- AIによる自動確定
- 高度な幾何制約（角度固定・直交固定・高度なスナップ）
