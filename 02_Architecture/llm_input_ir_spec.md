# English Summary

> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。
This document finalizes ADR-0009 Phase B by defining deterministic KJ input normalization, non-LLM graph preprocessing, the strict LLM input IR schema, truncation behavior, fixture generation verification steps, and safety/privacy consistency checks.

# llm_input_ir_spec — LLM投入IR仕様（ADR-0009 Phase B 完了）

本仕様は `ADR-0009` のPhase B（データ/IR整備）を完了させるための正本である。
対象は「LLMへ渡す前段データ」のみであり、モデル実装や推論品質評価ルーブリック自体は対象外とする。

> **現行 `ir_version`: `1.2`**（2026-08-30、`cards[*].hold_state` を加算）。1.1 は同日の `ADR-0069` D1=B / D2=A / D3=A / D4=A 反映版。版数判断の根拠と各版の差分は §7.4 を参照。

> CE1 Context foundation integration note: `ContextQuery` / `ContextBundle` の契約固定（`previewConfirmed` 必須、canonical hash）は `02_Architecture/api.md` と `01_Plans/issues/done/issue-CE1-context-query-bundle-foundation.md` を正本とし、本書では IR 接続時の整合条件のみを規定する。

---

## 0. Scope / Non-Goals / Acceptance Criteria

### 0.1 Scope

1. KJ入力正規化の固定（`cards` / `coordinates` / `relations` / `meta`）。
2. 非LLM前処理の固定（クラスタ候補・中心性・連結成分・矛盾サブグラフ）。
3. LLM投入IR（`LLMRequest.inputs`）のJSON schema・必須/任意・サイズ上限・切り詰め規則の固定。
4. FixtureProvider回帰データをIR仕様のみで生成可能であることの検証手順の提供。
5. safeMode / PII最小化 / 構造化テキスト限定の整合チェック項目の固定。

### 0.2 Non-Goals

1. LLM出力スキーマ（`LLMRequest.output_schema` の中身）の設計。
2. Provider transport実装（HTTP / IPC / in-process）の選定。
3. エスカレーション有効化手順そのもの（`02_Architecture/llm_escalation_policy.html` の領域）。
4. 画像・音声・バイナリ添付の取り扱い。

### 0.3 Acceptance Criteria

- AC-1: 本仕様の正規化入力だけで `LLMRequest.inputs` を決定論的に生成できる。
- AC-2: 非LLM前処理4種の出力形式と計算規則が曖昧語なしで定義されている。
- AC-3: サイズ上限超過時に、同一入力から同一切り詰め結果を再現できる。
- AC-4: FixtureProvider用回帰データを、LLM依存なしで生成・比較できる。
- AC-5: safeMode / PII最小化 / 構造化テキスト限定の検査が、実行チェックリストとして明文化されている。

---

## 1. 用語と識別子

- **canonical card id**: `Card.id` の正規ID。
- **relation id**: `"<type>:<fromId>:<toId>"`（文字列連結）で決定論生成。
- **negation relation**: `relations[*].type == "negate"`。
- **関係型語彙（AI-REL-VOCAB-DRIFT-01 / ADR-0069 D2=A）**: `relations[*].type` はキャンバス語彙5値 `related | negate | causal | mutual | equivalence` に統一する。IR独自の `arrow`（因果か方向か曖昧）は `causal` へ、綴り違いの `negation` は `negate` へ写像する。backendのみの `unknown`（未分類）はIRに含めない。逆方向（IR → キャンバス）の写像は行わない。
- **IR**: `LLMRequest.inputs` に格納するJSON。
- **structured text only**: JSONで表現可能な文字列・数値・配列・オブジェクトのみを許可し、バイナリを禁止する。
- **queryCanonicalHash**: canonical化した `ContextQuery` から算出するsha256 16進小文字。
- **bundleHash**: canonical化した `ContextBundle` から算出するsha256 16進小文字。

---

## CE1 Bridge Constraints（ContextQuery/Bundle 連携制約）

本節はPhase 1〜6のCE1固定契約を、IR生成境界で破らないための拘束条件を定義する。

1. `previewConfirmed != true` の `ContextQuery` からIR生成を開始してはならない（APIは `422 preview_required` を返す前提）。
2. `queryCanonicalHash` と `bundleHash` は、IRメタデータに監査キーとして保持可能でなければならない。
3. IR生成パイプラインは、同一canonical queryに対する `bundleHash` 不一致を検知した場合に `nondeterministic_bundle` として失敗扱いにする。
4. CE2/CE4連携ではbackend未実装時もmock `ContextQuery/ContextBundle` 契約で検証を継続し、CE1完了待ちを禁止する。
5. 実行順序は `Plan -> Execute -> Verify -> Proceed` を固定し、`Proceed` はCE2/CE4への参照専用引継ぎのみ許可する。
6. Verify失敗時の自己修復は最大3回までとし、3回超過時は処理継続せず停止する（fail-closed）。
7. `ContextQuery/ContextBundle` はCE1 v1最小I/F以外の未定義キーを受理してはならない（拡張はv2契約改訂でのみ許可）。
8. 契約ID衝突（`CE1-CTXQ-IF` / `CE1-CTXB-IF` / `CE1-HASH-DET-IF` / `CE1-PREVIEW-GATE-IF`）またはsafeMode後退を検知した場合は即停止する。
9. CE2提案連携では `sourceBundleHash/status/reviewState` を必須監査キーとして扱い、proposal-only境界（auto-apply禁止）を破ってはならない。

### CE1 Contract Lock Summary（Stream B）

- 署名（識別）固定: `CE1-CTXQ-IF` / `CE1-CTXB-IF` / `CE1-HASH-DET-IF` / `CE1-PREVIEW-GATE-IF`
- 型固定: `ContextQueryV1` / `ContextBundleV1` のv1必須キー集合をclosed-worldとして固定
- エラー固定: `422 preview_required` / `400 unknown_contract_key` / `409 nondeterministic_bundle`
- mock-first固定: `stubDatasetId=A2-minimal-v1` で検証し、実DB/実LLM/worker依存を禁止
- Verify自己修復上限: 3回（超過時は `held` で停止）

### CE1 A2 Stub Contract Profile（検証用）

CE1のIR接続検証（A2）はbackend完了待ちを禁止し、次のstub contractを最小プロファイルとして固定する。

- `POST /context/query`
  - request: `ContextQueryV1`（closed-world、未定義キー禁止）
  - success: `200 { accepted: true, queryCanonicalHash }`
  - error: `422 preview_required` / `400 unknown_contract_key`
- `POST /context/bundle`
  - request: `{ query: ContextQueryV1, stubDatasetId: "A2-minimal-v1" }`
  - success: `200 ContextBundleV1 + queryCanonicalHash`
  - error: `409 nondeterministic_bundle` / `400 unknown_contract_key`



### CE1 Execution Order Lock（Stream B）

CE1 Contract作業は次の順序を固定し、逆順・省略を禁止する。

1. Phase 1 Read
2. Phase 2 ADR CDC
3. Phase 3 Plan（AC/DoD提案合意を先に確定）
4. Phase 4 Execute（契約固定：`ContextQuery` / `ContextBundle` / `bundleHash` / `previewConfirmed`）
5. Phase 5 Verify（preview gate + 決定論hash、自己修復は3回まで）
6. Phase 6 Proceed（参照専用handoff）

Phase 5 Verifyは最低限次の機械判定を満たすこと。

- `previewConfirmed=false -> 422 preview_required`
- 同一canonical queryを3回実行し `queryCanonicalHash` と `bundleHash` が3/3一致
- 未定義キーは常に `400 unknown_contract_key`

Phase 6 ProceedはCE2/CE4への参照専用連携のみ許可し、実装変更要求を禁止する。CE2/CE4はmock契約で依存切断したまま進行し、CE1完了待ちを禁止する。

A2 contract testでは次を機械判定する。

1. 同一canonical query 3回実行で `queryCanonicalHash` と `bundleHash` が3/3一致。
2. `previewConfirmed=false` が常に `422 preview_required`。
3. 未定義キーが常に `400 unknown_contract_key`。
4. CE2連携キー `sourceBundleHash === bundleHash` を比較可能。

---



### Stream C CE1 Foundation Lock（2026-05-04）

- 本仕様におけるCE1責務は **契約固定のみ** とし、実装詳細（handler/UI/DB/worker）を追加しない。
- `ContextQueryV1` / `ContextBundleV1` はclosed-world v1を維持し、未定義キーは常に `400 unknown_contract_key`。
- preview gateは `previewConfirmed=false -> 422 preview_required` を固定し、IR生成を開始しない。
- hash決定論は同一canonical queryで `queryCanonicalHash` / `bundleHash` が3/3一致を要件化し、不一致は `409 nondeterministic_bundle`。
- CE2/CE4はmock-firstで依存切断を維持し、CE1実装待ちを禁止する（contract handoffのみで前進）。

## 2. KJ入力正規化（固定仕様）

### 2.1 cards

入力 `cards` は以下へ正規化する。

```json
{
  "id": "string",
  "text": "string",
  "text_norm": "string",
  "char_len": 0,
  "hold_state": "held|pending|shelved"
}
```

規則は次のとおりです。

1. `id` は空文字禁止。
2. `text` はUTF-8文字列。制御文字（U+0000..U+001F, U+007F）は除去する。
3. `text_norm` は次で生成する。
   - NFKC正規化
   - 連続空白を1スペースへ畳み込み
   - 前後空白を除去
4. `char_len` は `text_norm` の文字数。
5. 同一 `id` が複数ある場合は入力不正としてrejectする。
6. **正規化後の並び順は `id` 昇順**（ir_version 1.1で明文化）。入力配列の順序に依存しないため、カードの並び替えだけを行った文書から同一の `llm_ir.json` が得られる（§6の検証成功条件「同一 `document.json` から常に同一 `llm_ir.json`」を、入力の些末な差分に対しても成立させる）。
7. 正規化後に `text` または `text_norm` が空文字になるカードはrejectする（§4.2が `minLength: 1` を課しているため、空のままIRへ入れられない）。
8. **`hold_state`（ir_version 1.2で追加）**: `DocumentV1.cards[*].holdState`（`schemas.md` §14.1）を投影する。値は `held` / `pending` / `shelved` の3値のみ。
   - **値を持たないカードではキーごと省略する**（`null` を書かない）。省略が「保留していない通常カード」の符号化であり、`schemas.md` §14.1の「欠落時＝従来挙動」と一致する。`islands`（§2.2A）が `null` を明示するのとは扱いが異なる — 島では「タイトル未設定」と「タイトル欠落」を区別する必要があるが、カードのhold状態には区別すべき第2の欠落状態が無く、全カードへ `"hold_state": null` を書くのは毎リクエストのトークン費用に見合わない。
   - 3値以外の値はrejectせず**除外**する（キー省略として扱う）。§2.3規則6が未知の関係型を除外するのと同じ理由 — 未知のhold状態はIRが使える構造を持たないが、それによって正常な文書を投影不能にしてはならない。
   - **意味**: 3値はいずれも「人間が意図的に判断を保留・退避させた」ことの記録である。IRの消費側は、この状態のカードを**新規のグループ・島の構成員として提案してはならない**（`AI-IR-PROJECTION-01` AC-2）。既存の島の構成員として `islands[*].card_ids` に現れることは妨げない（既決の構造であり提案ではない）。
   - AIがこの値を書き換え・昇格させてはならない（§2.2A規則6の `review_state` と同じ扱い）。

### 2.2 coordinates（ir_version 1.1 で任意フィールド化・ADR-0069 D1=B）

入力座標は以下へ正規化する。

```json
{
  "card_id": "string",
  "x": 0.0,
  "y": 0.0,
  "radius": 0.0,
  "angle_deg": 0.0
}
```

規則は次のとおりです。

1. `x`, `y` は有限実数（NaN / ±Inf禁止）。
2. 座標は重心基準へ平行移動して正規化する。
   - 重心 `cx = mean(x)`, `cy = mean(y)`
   - 正規化後 `x = round(x - cx, 3)`, `y = round(y - cy, 3)`
3. `radius = round(sqrt(x^2 + y^2), 3)`。
4. `angle_deg = round(atan2(y, x) * 180 / pi, 3)`（範囲 -180.000..180.000）。
5. `card_id` は `cards.id` に存在しなければreject。
6. **座標を渡す場合は必ず本節の正規化を経る。** 生の絶対座標をIRへ入れてはならない。

#### 2.2.1 エンドポイント別 座標要否（ADR-0069 D1=B）

`coordinates` は `ir_version` 1.1で**任意フィールド**である。IRビルダーの呼び出し側は、エンドポイントごとに要否を宣言する。

| エンドポイント | `coordinates` | 理由 |
|---|---|---|
| `POST /ai/suggest-layout` | **要求** | 出力そのものが配置であり、相対布置が入力として意味を持つ |
| `POST /ai/detect-contradiction` | 非要求 | 判断材料は論理関係（`relations` / `evidence_links`）であり、布置は根拠にならない |
| `POST /ai/suggest-card-groups` | 非要求 | 既存の島・階層・関係・`hold_state` で足りる。空間由来のまとまりが要る場合は `cluster_candidates.basis="spatial"` で明示的に渡す |
| `POST /ai/generate-narrative` | 非要求 | 叙述の骨格は `causal` / `negate` であり座標ではない |

`coordinates` を省略したIRでは、`cluster_candidates` のspatial候補（§3.1規則2）は生成されない（relation由来のみ）。

### 2.2A islands（ir_version 1.1 で追加・ADR-0069 D3=A）

人間が確定させた島階層をIRへ渡す。**`cluster_candidates`（機械が出した候補、§3.1）とは型として別**であり、混同してはならない。前者は既決（CVI-3の人手レビュー昇格を経た構造）、後者は提案である。

```json
{
  "id": "string",
  "card_ids": ["c1", "c2"],
  "title": "string|null",
  "placard_card_id": "string|null",
  "parent_island_id": "string|null",
  "review_state": "unreviewed|human_reviewed"
}
```

規則は次のとおりです。

1. `id` は空文字禁止。重複 `id` はreject。
2. `card_ids` は `cards.id` に存在するものだけを残し、昇順ソートする。存在しないIDは黙って除外する（切り詰め §5で除外されたカードを島が参照しうるため）。
3. **カード→島の一意化規則は「先勝ち」**（`issue-DOMAIN-ISLAND-MEMBERSHIP-01` の暫定規則）。複数の島の `cardIds` に同時出現するカードは、**入力配列の先頭から見て最初に一致した島にのみ**帰属させ、後続の島の `card_ids` からは除外する。これは読み取り側の投影規則であり、書込み側の重複所属を禁止するものではない。
4. `parent_island_id` は他の島の `id` に存在しなければ `null` にする（孤立参照をIRへ持ち込まない）。
5. `placard_card_id` は当該島の `card_ids` に含まれない場合 `null` にする。
6. `review_state` は `CE0-REVIEW-IF` の2値のみ。`Island.titleReviewed === true` を `human_reviewed`、それ以外（`false` / 未設定）を `unreviewed` へ写像する。AIがこの値を昇格させてはならない。
7. `card_ids` が空になった島も保持する（島の存在自体が構造情報であるため）。
8. 並び順は `id` 昇順。

`title` / `placard_card_id` / `parent_island_id` は値が無い場合 `null` を明示する（キーの欠落ではない）。

### 2.2B evidence_links（ir_version 1.1 で追加）

人間が記録済みの根拠・矛盾リンクをIRへ渡す。`ADR-0069` が挙げた「矛盾検出が既存の `evidenceLinks` / `contradictionState` を見ていない」（`AI-IR-PROJECTION-01` AC-1）を、IR経路で解消するためのフィールドである。

```json
{
  "id": "string",
  "type": "supports|contradicts",
  "from_card_id": "string",
  "to_card_id": "string",
  "contradiction_state": "unconfirmed|confirmed|held|resolved|null"
}
```

規則は次のとおりです。

1. `from_card_id` / `to_card_id` が `cards.id` に存在しないものは除外する。
2. 重複判定キー `(type, from_card_id, to_card_id)` が重複した場合は入力順で先頭の1件へ重複排除する。
3. **`EvidenceLink.note`（自由記述）はIRへ投影しない。** §7.2のPII最小化と、根拠リンクが構造情報として扱われるべきである（本文の再投入ではない）ことの双方による。
4. `contradiction_state` は `type="contradicts"` のときのみ意味を持つ。`type="supports"` では常に `null`。
5. 並び順は `(type, from_card_id, to_card_id)` 昇順。
6. **`confirmed` / `held` は人間が既に判断を下した状態である。** IRの消費側（プロンプト構築・提案生成）は、この状態のリンクを新規の発見として再提示してはならない。

### 2.3 relations

入力関係は以下へ正規化する。

```json
{
  "id": "string",
  "from": "string",
  "to": "string",
  "type": "related|negate|causal|mutual|equivalence"
}
```

規則は次のとおりです。

1. `from`, `to` は `cards.id` に存在すること。
2. `type` は列挙値のみ許可。
3. 重複判定キー `(from, to, type)` が重複した場合は1件へ重複排除する。
4. 自己ループ（`from == to`）は `negate` 以外はreject。
5. 正規化後の並び順は `(type, from, to)` 昇順。
6. **`DocumentV1.edges` からの投影規則（ir_version 1.1で明文化）**: 次のいずれかに該当する辺は、rejectではなく**除外**する（IRは「カード間の論理関係」のIRであり、それ以外の辺は表現対象外であるため）。
   - `fromKind` または `toKind` が `"island"` の辺（島間の派生辺は `islands` の階層で表現する）。
   - `type` が5値語彙のいずれでもない辺（backendのみの `unknown` を含む。D2=Aの決定によりIRに含めない）。
   - `from` / `to` が `cards` に存在しない辺。
   
   上記に該当しない辺のうち規則1〜5に違反するもの（`negate` 以外の自己ループなど）は規則どおりrejectする。

### 2.4 meta

`meta` は以下の最小フィールドへ固定する。

```json
{
  "doc_id": "string",
  "doc_version": 1,
  "safe_mode": true,
  "language": "ja|en|mixed|unknown",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

規則は次のとおりです。

1. `safe_mode` は必須かつ `true` でなければIR生成を拒否する。
2. `doc_version` は正整数。
3. `language` 判定不能時は `unknown` を使用する。
4. `meta` に個人識別子（メール、電話、住所、外部ID）を含めない。
5. **`created_at` / `updated_at` はir_version 1.1で任意フィールドとする。** 文書を伴わない入力（`POST /ai/detect-contradiction` にカード2枚だけを渡す既存契約など）では発生時刻が入力に存在せず、生成時刻で埋めると同一入力から同一IRが得られなくなる（AC-3 / §5の決定論に反する）。この場合は**キーごと省略する**。現在時刻で代替してはならない。
6. **`language` の判定規則（ir_version 1.1で明文化）**: 全カードの `text_norm` を連結した文字列に対し、
   - CJK統合漢字・ひらがな・カタカナ（`U+3040..U+30FF`, `U+3400..U+4DBF`, `U+4E00..U+9FFF`, `U+F900..U+FAFF`）のいずれかを含むなら `ja` 成分あり。
   - ASCIIのラテン文字（`A-Za-z`）を含むなら `en` 成分あり。
   - 両方あれば `mixed`、片方だけならその値、どちらも無ければ `unknown`。
7. **`meta` は `LLMRequest.inputs` のトップレベルに含める**（§4.1参照）。§7.1が `meta.safe_mode` を必須としている以上、`meta` がIRの外にあると仕様が自己矛盾する。ir_version 1.0の §4スキーマは `meta` を列挙しないまま `additionalProperties: false` としており、実装不能であった。1.1でこれを是正する。

---

## 3. 非LLM前処理（固定仕様）

### 3.1 クラスタ候補（cluster_candidates）

```json
{
  "cluster_id": "cc-0001",
  "card_ids": ["c1", "c2"],
  "basis": "relation|spatial",
  "score": 0.0
}
```

計算規則は次のとおりです。

1. relation-based候補: `related|causal` 辺で連結な部分集合を列挙。
2. spatial-based候補: 座標距離の近傍グラフ（k=3）で連結な集合を列挙。`coordinates` が無いIR（§2.2.1で非要求のエンドポイント）ではspatial候補を生成しない。
3. 同一 `card_ids` は `basis` を統合し1件にする（`relation` 優先）。
4. `score` は `round(min(1.0, density + cohesion) / 2, 4)`。
   - `score` はrelation/spatialグラフの**構造上の密度・凝集度を再現するための内部診断値**であり、カード内容の意味的類似度、重要度、確信度、採用順位ではない。IR/監査には保持できるが、AI promptや利用者向け候補へ数値として露出してsemantic authorityへ読み替えない（`ADR-0090`）。

**ir_version 1.1での明文化**（AC-2「曖昧語なし」を満たすため。1.0は `density` / `cohesion` / `cluster_id` の採番順・候補の粒度を定義しておらず、決定論的に再現できなかった）:

5. 候補の粒度は**連結成分**とする（極大な連結部分集合。部分集合の総当たり列挙ではない）。カード1枚だけの成分は候補にしない（`card_ids` の `minItems` は2）。
6. spatial近傍グラフ: 各カードについて、正規化座標のユークリッド距離が近い順に上位3件（`k=3`）へ無向辺を張る。距離が同値の場合は `card_id` 昇順で先に来るものを採る。
7. `density = round(m / (n * (n - 1) / 2), 6)`。`n` は候補内カード数、`m` は候補内の**内部辺数**（当該basisのグラフにおける、両端が候補内にある辺の数。重複排除後）。
8. `cohesion = round(m / (m + b), 6)`。`b` は候補内カードに接続する辺のうち、片端が候補外にある辺の数。`m + b == 0` のときは `0.0`。
   - 候補が連結成分である以上 `b` は常に0であり `cohesion` は `m > 0` なら1.0になる。それでも式を残すのは、将来basisの定義を成分より細かい粒度へ変えたときに `score` の意味が変わらないようにするためである。
9. `cluster_id` は、`card_ids` を昇順ソートした配列同士を辞書順比較して並べ、その順に `cc-0001` から連番を振る。`basis` は採番順序に影響しない（規則3の統合後に採番する）。

### 3.2 中心性（centrality）

```json
{
  "card_id": "c1",
  "degree": 0,
  "betweenness": 0.0,
  "rank": 1
}
```

計算規則は次のとおりです。

1. 無向グラフとして `degree` を計算。
2. betweenness centralityを標準定義で計算し小数4桁へ丸める。
3. 並び順は `betweenness desc`, 同値時 `degree desc`, 同値時 `card_id asc`。
4. `rank` は上記順序の1始まり連番。

**ir_version 1.1 での明文化**:

5. 対象グラフは §2.3正規化後の全relationを無向辺とみなしたもの（型で絞らない）。多重辺は `(from, to)` の非順序対で1本に畳む（`degree` の二重計上を避ける）。自己ループは `degree` に数えない。
6. `degree` は当該カードに接続する（畳み込み後の）辺の本数。
7. betweennessは**非正規化**の標準定義 `bc(v) = Σ_{s<t, s≠v≠t} σ_st(v) / σ_st` を用いる（無向グラフなので各ペアを1回だけ数える）。Brandesのアルゴリズムで計算し、最後に `round(x, 4)`。
8. 関係を1本も持たないカードも `degree=0` / `betweenness=0.0` の項目として必ず列挙する。`centrality` は `cards` と1対1であり、§5.2の切り詰めがこの `rank` を唯一の順序根拠として使う。

### 3.3 連結成分（connected_components）

```json
{
  "component_id": "cmp-001",
  "card_ids": ["c1", "c2"],
  "edge_count": 1
}
```

計算規則は次のとおりです。

1. `related|negate|causal|mutual|equivalence` を全て無向辺として成分分解する。
2. `component_id` はcard_idsの最小ID順に `cmp-001` から連番。
3. `card_ids` は昇順ソート。
4. `edge_count` は当該成分内の正規化relation数。

**ir_version 1.1 での明文化**:

5. 孤立カード（辺を持たないカード）も、カード1枚・`edge_count=0` の成分として列挙する。全カードがいずれか1つの成分にちょうど1回現れる（`connected_components` の `card_ids` の総和 = `cards`）。
6. `edge_count` は畳み込み前の正規化relation件数（`(from, to, type)` 単位）。したがって同じカード対に `related` と `negate` があれば2と数える。

### 3.4 矛盾サブグラフ（contradiction_subgraphs）

```json
{
  "subgraph_id": "neg-001",
  "card_ids": ["c3", "c7"],
  "negation_edges": ["negate:c3:c7"],
  "summary": "string"
}
```

計算規則は次のとおりです。

1. `negate` 辺を含む成分ごとに1サブグラフを作る。
2. `summary` はテンプレート生成のみ許可する。
   - 形式: `"<n> negation edges across <m> cards"`
3. LLM要約は禁止（前処理は純決定論）。

**ir_version 1.1 での明文化**:

4. `card_ids` は当該成分の全カードではなく、**その成分内の `negate` 辺に接続するカードだけ**を昇順で並べたもの（1.0の §3.4例が `card_ids: ["c3","c7"]` / `negation_edges: ["negate:c3:c7"]` と対応させていることに合わせる）。
5. `negation_edges` は当該成分内の `negate` relationの `id` を `(from, to)` 昇順で並べたもの。
6. `subgraph_id` は §3.3の `component_id` の順序に従い、`negate` を含む成分だけを対象に `neg-001` から連番。
7. `summary` の `<n>` は `len(negation_edges)`、`<m>` は `len(card_ids)`。自己ループ `negate:cX:cX` は `card_ids` に `cX` を1回だけ寄与させる。

---

## 4. LLM投入IR JSON Schema（LLMRequest.inputs）

### 4.1 必須/任意（ir_version 1.2）

必須は次のとおりです。
- `ir_version`
- `cards`
- `relations`
- `graph_summary`
- `constraints`
- `meta`（1.1で追加。§2.4規則7を参照。§7.1が `meta.safe_mode` を必須としているため1.0の欠落は仕様の欠陥であった）

任意は次のとおりです。
- `coordinates`（1.1で必須→任意。ADR-0069 D1=B。§2.2.1の要否表を参照）
- `islands`（1.1で追加。ADR-0069 D3=A。§2.2A）
- `evidence_links`（1.1で追加。§2.2B）
- `cluster_candidates`
- `truncation`

カード単位の任意フィールドは次のとおりです。
- `cards[*].hold_state`（1.2で追加。§2.1規則8。値を持つカードにのみ現れる）

### 4.2 JSON Schema（Draft 2020-12相当）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "ir_version",
    "cards",
    "relations",
    "graph_summary",
    "constraints",
    "meta"
  ],
  "properties": {
    "ir_version": { "type": "string", "const": "1.2" },
    "cards": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "text", "text_norm", "char_len"],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "text": { "type": "string", "minLength": 1 },
          "text_norm": { "type": "string", "minLength": 1 },
          "char_len": { "type": "integer", "minimum": 1 },
          "hold_state": { "type": "string", "enum": ["held", "pending", "shelved"] }
        }
      }
    },
    "coordinates": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["card_id", "x", "y", "radius", "angle_deg"],
        "properties": {
          "card_id": { "type": "string", "minLength": 1 },
          "x": { "type": "number" },
          "y": { "type": "number" },
          "radius": { "type": "number", "minimum": 0 },
          "angle_deg": { "type": "number", "minimum": -180, "maximum": 180 }
        }
      }
    },
    "relations": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "from", "to", "type"],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "from": { "type": "string", "minLength": 1 },
          "to": { "type": "string", "minLength": 1 },
          "type": { "type": "string", "enum": ["related", "negate", "causal", "mutual", "equivalence"] }
        }
      }
    },
    "islands": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "card_ids",
          "title",
          "placard_card_id",
          "parent_island_id",
          "review_state"
        ],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "card_ids": { "type": "array", "items": { "type": "string", "minLength": 1 } },
          "title": { "type": ["string", "null"] },
          "placard_card_id": { "type": ["string", "null"] },
          "parent_island_id": { "type": ["string", "null"] },
          "review_state": { "type": "string", "enum": ["unreviewed", "human_reviewed"] }
        }
      }
    },
    "evidence_links": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "type", "from_card_id", "to_card_id", "contradiction_state"],
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "type": { "type": "string", "enum": ["supports", "contradicts"] },
          "from_card_id": { "type": "string", "minLength": 1 },
          "to_card_id": { "type": "string", "minLength": 1 },
          "contradiction_state": {
            "type": ["string", "null"],
            "enum": ["unconfirmed", "confirmed", "held", "resolved", null]
          }
        }
      }
    },
    "cluster_candidates": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["cluster_id", "card_ids", "basis", "score"],
        "properties": {
          "cluster_id": { "type": "string", "minLength": 1 },
          "card_ids": { "type": "array", "minItems": 2, "items": { "type": "string" } },
          "basis": { "type": "string", "enum": ["relation", "spatial"] },
          "score": { "type": "number", "minimum": 0, "maximum": 1 }
        }
      }
    },
    "graph_summary": {
      "type": "object",
      "additionalProperties": false,
      "required": ["centrality", "connected_components", "contradiction_subgraphs"],
      "properties": {
        "centrality": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["card_id", "degree", "betweenness", "rank"],
            "properties": {
              "card_id": { "type": "string", "minLength": 1 },
              "degree": { "type": "integer", "minimum": 0 },
              "betweenness": { "type": "number", "minimum": 0 },
              "rank": { "type": "integer", "minimum": 1 }
            }
          }
        },
        "connected_components": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["component_id", "card_ids", "edge_count"],
            "properties": {
              "component_id": { "type": "string", "minLength": 1 },
              "card_ids": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string", "minLength": 1 }
              },
              "edge_count": { "type": "integer", "minimum": 0 }
            }
          }
        },
        "contradiction_subgraphs": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["subgraph_id", "card_ids", "negation_edges", "summary"],
            "properties": {
              "subgraph_id": { "type": "string", "minLength": 1 },
              "card_ids": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string", "minLength": 1 }
              },
              "negation_edges": {
                "type": "array",
                "minItems": 1,
                "items": { "type": "string", "minLength": 1 }
              },
              "summary": { "type": "string", "minLength": 1 }
            }
          }
        }
      }
    },
    "meta": {
      "type": "object",
      "additionalProperties": false,
      "required": ["doc_id", "doc_version", "safe_mode", "language"],
      "properties": {
        "doc_id": { "type": "string", "minLength": 1 },
        "doc_version": { "type": "integer", "minimum": 1 },
        "safe_mode": { "type": "boolean", "const": true },
        "language": { "type": "string", "enum": ["ja", "en", "mixed", "unknown"] },
        "created_at": { "type": "string", "minLength": 1 },
        "updated_at": { "type": "string", "minLength": 1 }
      }
    },
    "constraints": {
      "type": "object",
      "additionalProperties": false,
      "required": ["safe_mode", "structured_text_only", "required_sections"],
      "properties": {
        "safe_mode": { "type": "boolean", "const": true },
        "structured_text_only": { "type": "boolean", "const": true },
        "required_sections": {
          "type": "array",
          "items": { "type": "string", "enum": ["overall", "clusters", "contradictions"] },
          "minItems": 3,
          "maxItems": 3,
          "uniqueItems": true
        }
      }
    },
    "truncation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["truncated", "reason_codes"],
      "properties": {
        "truncated": { "type": "boolean" },
        "reason_codes": {
          "type": "array",
          "items": { "type": "string", "enum": ["MAX_CARDS", "MAX_RELATIONS", "MAX_TEXT_CHARS"] }
        }
      }
    }
  }
}
```

---

## 5. サイズ上限と切り詰め規則（決定論）

### 5.1 上限値

- `MAX_CARDS = 200`
- `MAX_RELATIONS = 400`
- `MAX_TEXT_CHARS = 12000`（`sum(cards[*].char_len)`）

### 5.2 切り詰め順序

超過時は次を上から順に適用し、各段階で上限内か判定する。

1. `cluster_candidates` を全削除（任意フィールドのため）。
2. `centrality.rank` 低位カードからカードを除外。ただし、callerがroute契約上の必須対象として `required_card_ids` を明示した場合は、その集合を先に保持し、残り枠だけを中心性順位で埋める。
3. 除外カードに接続するrelationを除外。
4. なお超過する場合は `text` を `text_norm` 先頭240文字へ固定切り詰め。

**ir_version 1.1での明文化**（AC-3「同一入力から同一切り詰め結果」を機械的に満たすため。1.0は各段階の対象・順序・参照整合の扱いが未定義であった）:

5. 判定は切り詰め前の値で1度だけ行う。`over_cards = len(cards) > MAX_CARDS`、`over_relations = len(relations) > MAX_RELATIONS`、`over_text = sum(char_len) > MAX_TEXT_CHARS`。いずれかが真なら段階1を実施する。
6. 段階2の「低位」は §3.2の `rank` が**大きい**方（中心性が低い方）である。除外の順序を決める `rank` は**切り詰め前の全カード集合に対して1度だけ**算出し、以後の全段階でその値を使う（段階ごとに再計算すると除外順が入力規模に依存して揺れる）。`required_card_ids` が空なら従来どおり `rank <= MAX_CARDS` のカードだけを残す。required集合がある場合はrequired cardを先に保持し、`MAX_CARDS - len(required_card_ids)` の残り枠を `rank` の小さい順で埋める。理由コード `MAX_CARDS`。
   - IRへ出力する `graph_summary` と `cluster_candidates` は、**全段階の除外を終えた後の集合に対して算出する**。除外順の根拠に使う `rank`（切り詰め前）と、出力する `centrality`（切り詰め後）は別物である。こうしないと `graph_summary` がIRに存在しないカードを参照し、IRが参照的に閉じなくなる。
7. 段階3では、除外カードを参照する `coordinates` / `islands[*].card_ids` / `evidence_links` も同時に除外する（参照整合をIR内で保つ）。島は `card_ids` が空になっても保持する（§2.2A規則7）。required card同士を結ぶrelation / evidence linkも、カード除外の段階では両端点が残る限り保持される。relation件数上限に対する保護は規則8および§5.2.2に従う。
8. 段階3の後もなお `len(relations) > MAX_RELATIONS` の場合、callerが `required_relation_ids` を指定していればその正規化済みrelationを先に保持し、残り枠を `(type, from, to)` 昇順の非required relationで埋める。required集合が空なら従来どおり `(type, from, to)` 昇順で先頭 `MAX_RELATIONS` 件だけを残す。理由コード `MAX_RELATIONS`。
9. 段階4は `text` だけでなく `text_norm` も `text_norm[:240]` へ揃え、`char_len = len(text_norm)` を再計算する。`char_len` を据え置くと `sum(char_len)` が減らず上限判定が永久に成立しない。理由コード `MAX_TEXT_CHARS`。
10. 段階4の後もなお `sum(char_len) > MAX_TEXT_CHARS` の場合、`rank` の大きいカードから1枚ずつ除外し（そのたびに段階3と同じ参照整合の除外を行う）、上限内へ収める。required cardはこの追加除外の候補にしてはならない。required card以外をすべて除外しても `MAX_TEXT_CHARS` に収まらない場合は `required_card_budget_exceeded` でfail-closedし、route必須の意味を黙って削除しない。required指定が無い場合は従来どおりカードを最低1枚残す（§4.2 `cards.minItems = 1`）。理由コードは `MAX_TEXT_CHARS` のまま（新しいtruncation理由コードは増やさない）。

### 5.2.1 route契約上の必須カード（`required_card_ids`）

`required_card_ids` は、callerが「このAI操作の対象そのもの」として明示したカードを、汎用的な中心性順位による切り詰めから保護するための**IRビルダー入力専用制約**である。AIやIRビルダーが重要そうなカードを推測して追加する仕組みではない。

1. `required_card_ids` はIRへ直列化しない。§4.2のJSON Schemaに新しいフィールドを追加するものではない。
2. required集合は正規化済み `cards.id` の部分集合でなければならない。欠落IDを含む場合は `required_card_missing` でfail-closedする。失敗応答へ欠落IDそのものを反射してはならない。
3. required集合の件数が `MAX_CARDS` を超える場合は `required_card_budget_exceeded` でfail-closedする。
4. required集合の入力順は選別結果へ影響させない。同一入力と同一required集合からは、required IDの列挙順が異なっても同一IRを生成する。
5. required集合が空の場合、§5.2の切り詰め結果は本規則追加前と同一でなければならない。既存fixtureのcanonical JSON / SHA-256を変えてはならない。
6. 現時点で `POST /ai/detect-contradiction` は `cardA.id` / `cardB.id` をrequired集合として渡す。この2枚と、その両端点に対応する `confirmed` / `held` の `evidence_links` は、人間が既に下した判断を再提案しないためのroute固有の必要意味である。
7. `POST /ai/generate-narrative` は、正規化対象となるcard-to-card `causal` / `negate` relationの両端点をrequired cardとして渡す。さらにrelation自体も§5.2.2の `required_relation_ids` として渡し、端点だけ残って論理接続が失われる状態を許可しない。

### 5.2.2 route契約上の必須relation（`required_relation_ids`）

`required_relation_ids` は、callerが「このAI操作の論理接続そのもの」として明示した正規化relationを、汎用的な件数切り詰めから保護するための**IRビルダー入力専用制約**である。relationの重要度をAIやIRビルダーが推測する仕組みではない。

1. `required_relation_ids` はIRへ直列化しない。relation IDは§2.3の正規化後ID（`<type>:<fromId>:<toId>`）で指定する。
2. required集合は正規化済み `relations.id` の部分集合でなければならない。欠落IDを含む場合は `required_relation_missing` でfail-closedし、失敗応答へ欠落IDそのものを反射してはならない。
3. required集合の件数が `MAX_RELATIONS` を超える場合は `required_relation_budget_exceeded` でfail-closedする。
4. required relationの両端点は自動的に `required_card_ids` と同じ保護集合へ加える。これによりrelationを保持しながら端点カードだけを切り落とすことを禁止する。結果として必要端点が `MAX_CARDS` を超える場合は `required_card_budget_exceeded` でfail-closedする。
5. relation件数が `MAX_RELATIONS` を超える場合はrequired relationを先に全件保持し、残り枠を正規化済み `(type, from, to)` 昇順で埋め、最終配列も同じ順に再整列する。
6. required集合の入力順は選別結果へ影響させない。同一入力と同一required集合からは同一IRを生成する。
7. required集合が空の場合、relationの切り詰め結果は本規則追加前と同一でなければならない。既存fixtureのcanonical JSON / SHA-256を変えてはならない。
8. `POST /ai/generate-narrative` は、§2.3で正規化可能なcard-to-card `causal` / `negate` relationをrequired集合として渡す。required relationが `MAX_RELATIONS` を超える場合は、B型文章化の論理骨格を部分的に送信せずfail-closedする。

### 5.3 記録

- 切り詰めを1回でも実施した場合、`truncation.truncated=true`。
- 該当した上限の理由コードを重複なしで `reason_codes` へ記録。
- `reason_codes` は `MAX_CARDS` / `MAX_RELATIONS` / `MAX_TEXT_CHARS` の順で並べる（集合の並びが入力順に依存しないようにするため）。
- 切り詰めが一度も発生しなかった場合、`truncation` は `{"truncated": false, "reason_codes": []}` を出力する（キーごと省略しない。「切り詰めていない」ことを消費側が確認できるようにするため）。

---

## 6. FixtureProvider回帰データ生成手順（IR仕様のみで再現）

1. 入力 `document.json` から `cards / coordinates / relations / islands / evidence_links / meta` を抽出する。
2. 本仕様2章の正規化規則を適用して `normalized_input.json` を生成する。
3. 本仕様3章の前処理規則を適用して `graph_features.json` を生成する。
4. 本仕様4章のschemaに従って `llm_ir.json`（= `LLMRequest.inputs`）を生成する。
5. 本仕様5章の上限チェックと切り詰めを適用する。
6. `llm_ir.json` をfixture keyの唯一入力としてFixtureProvider応答を引き当てる。
7. 回帰テストは `llm_ir.json` のハッシュ（SHA-256）一致で前段の再現性を判定する。

検証成功条件は次のとおりです。

- 同一 `document.json` から常に同一 `llm_ir.json` が生成される。
- provider未起動（`SUI_LLM_PROVIDER=none`）でも回帰が成立する。

### 6.1 回帰データの所在と再生成

| 役割 | パス |
|---|---|
| 入力 `document.json` | `03_Implement/backend/tests/fixtures/llm_input_ir_document.json` |
| 期待 `llm_ir.json` ＋ SHA-256 | `03_Implement/backend/tests/fixtures/llm_input_ir_expected.json` |
| 再生成コマンド | `python3 scripts/generate_llm_input_ir_fixture.py`（`03_Implement/backend` 直下で実行） |
| 回帰テスト | `03_Implement/backend/tests/test_llm_input_ir.py` |

ファイル名に版数を含めない（1.1→1.2の繰り上げのたびに改名すると参照元が増える一方であるため。版数は期待ファイル内の `irVersion` フィールドが持つ）。

`llm_ir.json` のハッシュはcanonical JSON（キー辞書順・UTF-8・空白なし・`ensure_ascii=false`）のSHA-256 16進小文字とする（§9.2の `bundleHash` 算出規則と同じ正規化をIRへ適用したもの）。再生成コマンドはこの仕様の実装を通すだけであり、LLMも外部providerも呼ばない。

---

## 7. safeMode・PII最小化・構造化テキスト限定 整合チェック

### 7.1 safeModeチェック

- `meta.safe_mode == true` を必須化。
- `constraints.safe_mode == true` を必須化。
- どちらかが欠ける、または `false` の場合はIR生成を失敗させる。

**ir_version 1.1 での明文化**:

- 本節のチェックは**既存のAPI境界のSafeMode強制（`ADR-0068` / `SEC-AI-SAFEMODE-01` が配線した `_reject_unreviewed_cards` / `_reject_unreviewed_text`）を置き換えるものではなく、それに追加する第二層である**（`ADR-0069`「ADR-0068との関係」）。IR経路を導入する変更が、既存の呼び出しを除去・弱化することを禁じる。
- IRビルダーは、投影対象のカードが人間レビュー済みであること（`textReviewed === true`）を**ビルダー自身で**再検査する。ルート側のガードが将来失われてもIRが未レビュー本文を組み立てないようにするためであり、二重に検査されること自体が目的である。
- 緩和（`allowUnreviewedText` ＋ profile許可）が成立している場合に限り、この再検査は通過してよい。ただし `safe_mode` フラグそのものの緩和は許可しない（`constraints.safe_mode` は `const true`）。
- 失敗はfail-closedとし、API境界では422とする。**失敗応答に違反した入力値（カード本文・検出したPII断片）を反射してはならない**（`SEC-VALIDATION-LEAK-01` の作法）。

### 7.2 PII最小化チェック

以下パターンに一致する文字列を `text` / `text_norm` / `meta` で検出した場合、IR生成を失敗させる。

- メール: `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/`
- 電話: `/\+?[0-9][0-9\- ]{8,}[0-9]/`
- URLクエリ中トークン: `/[?&](token|key|secret|password)=/i`

**ir_version 1.1 での明文化**:

- 検査対象は**自由記述テキスト**（`cards[*].text` / `cards[*].text_norm`）と `meta` の文字列値に限る。ID系フィールド（`cards[*].id` / `islands[*].id` / `relations[*].id` / `evidence_links[*].*_card_id` など）は検査対象に**含めない** — UUIDやハイフン区切りIDが電話パターンへ偽陽性で一致し、正常な文書のIR生成が不能になるため。
- `meta` に適用するのは**メール・URLトークンの2パターンのみ**とし、電話パターンは適用しない。電話パターンは実質「長い数字列」の検出器であり、ISO-8601のタイムスタンプ（`2026-01-01T00:00:00Z`）が必ず一致する。`meta.created_at` / `meta.updated_at` は自由記述ではなく、ここで弾く価値もない。
- **既知の偽陽性**: 電話パターンは自由記述テキスト中の日付・連番・型番にも一致しうる（`2026-01-01` など）。本節はfail-closed側に倒す設計であり、この偽陽性は意図的に受け入れる。パターン自体の精緻化が必要になった場合は本仕様の改訂として別途扱い、実装側で黙って緩めない。
- 失敗時のエラーは、どのパターン種別（`email` / `phone` / `url_token`）に当たったかまでを報告し、**一致した文字列そのものは報告しない**。
- 本節は「検出したら失敗」であって「マスクして続行」ではない。IRは入力の正本であり、黙って書き換えると `document.json → llm_ir.json` の対応が追跡できなくなる。

### 7.3 構造化テキスト限定チェック

- JSON型は `string|number|boolean|array|object|null` のみ。
- Base64疑似バイナリ（長さ1024超かつ `[A-Za-z0-9+/=]` のみ）を禁止。
- `attachments` / `binary` / `image` というキー名の出現を禁止。

**ir_version 1.1 での明文化**:

- 禁止キー名の判定は**完全一致**とし、大文字小文字を区別しない（`attachments` / `binary` / `image`）。`imageUrl` / `image_url` のような別語は該当しない（部分一致で弾くと `Island.imageUrl` を持つ正常文書が通らなくなるため）。IRが `Island.imageUrl` を投影しないこと自体は §2.2Aのフィールド一覧が保証する。
- Base64判定は、長さ1024を**超え**、かつ空白を含まず `[A-Za-z0-9+/=]` のみで構成される文字列を対象とする。
- 検査はIR全体を再帰的に走査して行う。`constraints.structured_text_only == true` はこの検査を通過した事実の宣言である。

---

## 7.4 ir_version の履歴と版数判断

| `ir_version` | 日付 | 変更 | 出典 |
|---|---|---|---|
| `1.0` | 2026-04 | 初版（凍結） | `ADR-0009` Phase B |
| `1.1` | 2026-08-30 | D1（`coordinates` 任意化）、D3（`islands` 追加）、`evidence_links` 追加、`meta` をIRトップレベルへ明記、§3/§5 の計算規則の明文化 | `ADR-0069`, `issue-AI-IR-PROJECTION-01` |
| `1.2` | 2026-08-30 | `cards[*].hold_state` 追加（§2.1 規則8） | `issue-AI-IR-PROJECTION-01` AC-2（Stage 2: `suggest-card-groups`） |

**2026-09-03の `required_card_ids` 明文化では版数を上げない。** `required_card_ids` はIRビルダーへ渡す入力専用制約であり、§4.2の直列化スキーマへフィールドを追加しない。required指定が空の経路では従来のcanonical JSON / SHA-256を維持し、required指定がある経路でも既存フィールドの部分集合を選ぶ規則だけが変わる。このため、消費側が `ir_version` で判別すべき新しいIR表現は生じず、現行 `1.2` を維持する。根拠は `AI-IR-FOCUS-PRESERVATION-01` とする。

**なぜ1.2か（`hold_state` の追加）。** `AI-IR-PROJECTION-01` AC-2は「`suggest-card-groups` が `holdState` を受け取り、保留中のカードを新規グループへ含めない」ことを要求する。1.1のIRにはカードのhold状態を表す場所が無く、**既存フィールドで代替できない** — `islands`（§2.2A）は確定した所属を、`evidence_links`（§2.2B）は根拠・矛盾を、`relations`（§2.3）はカード間の論理関係を表すが、いずれも「このカードの扱いを人間が保留している」という単項の状態を表現できない。IRを迂回して `DocumentV1` を直接読めば実装はできるが、それは `ADR-0069`（IRがAI入力の実経路である）の主張そのものを崩す。

1.1→1.2も**加算的**であり、2.0に当たらないは次のとおりです。

- 任意フィールドの追加のみ。`required` は `["id", "text", "text_norm", "char_len"]` のまま増やしていない。
- hold状態を持たないカードではキーが現れないため、hold状態を使っていない文書のIRは1.1と**バイト単位で同一**である（`ir_version` の値を除く）。
- 既存フィールドの意味・列挙値・計算規則を変更していない。`hold_state` は §3の前処理（中心性・連結成分・クラスタ候補）にも §5の切り詰め順序にも**影響しない** — 保留は人間の見立てであって構造ではないため（`AGENTS.md` §5のR5判定: `holdState` は「利用者の現在の見立て」側であり、正規化・不変条件の対象にしない）。

`additionalProperties: false` は維持しているため、1.1想定の消費側は `hold_state` を未知キーとして扱う。消費側は `ir_version` を見て分岐すること。

**なぜ2.0ではなく1.1か。** 1.1の変更は**加算的**である。

- 必須フィールドを増やしていない。`meta` は §2.4と §7.1が既に必須と定めていたものを §4のスキーマ本文へ書き足しただけであり、新しい要求ではなく1.0の内部矛盾の是正である。
- `coordinates` は必須から任意へ**緩和**した。1.0の妥当なIRは1.1でも妥当である（`ir_version` の値を除く）。
- `islands` / `evidence_links` は任意フィールドの追加である。
- 既存フィールドの意味・列挙値・計算規則を**変更していない**。§3 / §5への追記は、1.0が定義していなかった箇所（`density` / `cohesion` の定義、採番順序、切り詰めの参照整合）を決定論的に埋めたものである。1.0の下で同じ入力から複数の出力があり得た箇所を1つに絞っており、1.0で一意に定まっていた結果を別の値へ変えてはいない。
- 関係型語彙の5値化（D2=A）は2026-08-13に本書へ適用済みであり、1.1で新たに変わるものではない。

したがって破壊的変更を示す2.0ではなく、加算的なマイナー繰り上げ1.1とする。`additionalProperties: false` は維持しているため、1.0の消費側が1.1のIRを読む場合は `islands` / `evidence_links` / `meta` を未知キーとして扱う点に注意する。消費側は `ir_version` を見て分岐すること。

## 8. トレーサビリティ

- Plan正本: `01_Plans/adr/ADR-0009-local-llm-integration.md` Phase B。
- Provider契約: `02_Architecture/llm_provider_spec.md`（`LLMRequest.inputs` の意味境界）。
- 実行制約: `02_Architecture/llm_runtime_constraints.md`。
- 品質ゲート: `02_Architecture/llm_quality_strategy.md`。
- エスカレーション運用: `02_Architecture/llm_escalation_policy.html`。
- 版数1.1の決定根拠: `01_Plans/adr/ADR-0069-llm-input-ir-as-the-actual-ai-input-path.md`（D1=B / D2=A / D3=A / D4=A）。
- 版数1.2（`cards[*].hold_state`）の決定根拠: `01_Plans/issues/issue-AI-IR-PROJECTION-01-llm-input-ir-as-ai-input-path.md` AC-2と「結果（Stage 2）」節。`holdState` の意味の正本は `02_Architecture/schemas.md` §14.1。
- route必須カードの切り詰め保護: `01_Plans/issues/done/issue-AI-IR-FOCUS-PRESERVATION-01-preserve-focus-adjudication-under-truncation.md`。共有IR実装は `03_Implement/backend/src/sui_sensemaking_api/llm_input_ir.py`、`detect-contradiction` の配線は `03_Implement/backend/src/sui_sensemaking_api/routes/ai.py` を参照する。
- 実装課題: `01_Plans/issues/issue-AI-IR-PROJECTION-01-llm-input-ir-as-ai-input-path.md`。
- SafeModeの第一層（本仕様 §7.1が置き換えてはならない既存実装）: `01_Plans/adr/ADR-0068-safemode-enforcement-at-api-boundary.md`, `01_Plans/issues/done/issue-SEC-AI-SAFEMODE-01-safemode-not-enforced-at-api-boundary.md`。
- カード→島の一意化規則（先勝ち）の出典: `01_Plans/issues/done/issue-DOMAIN-ISLAND-MEMBERSHIP-01-cross-island-cardid-duplicate-detection.md`。
- Python実装（D4=A）: `03_Implement/backend/src/sui_sensemaking_api/llm_input_ir.py`。


## 9. CE-1 ContextQuery/ContextBundle 最小I/F（Contract Freeze）

### 9.1 Context

- 本章はADR-0028 CE-1の「同一query同一bundleHash」を機械判定可能にするため、LLM入力IRの前段契約を固定する。
- 本章の契約はmock実装でも同一に適用し、backend/frontend依存を切離す。

### 9.2 Decision

`POST /context/query` と `POST /context/bundle` の論理契約を以下で固定する。

```json
{
  "ContextQuery": {
    "queryId": "uuid",
    "goal": "string",
    "scope": "document|view|island",
    "depth": "integer(0..5)",
    "constraints": {"maxTokens": "integer>0", "timeBudgetMs": "integer>0"},
    "reviewFilter": "reviewedOnly|includeUnreviewed",
    "safeModePolicy": "strict",
    "outputMode": "summary|proposal|candidate",
    "previewConfirmed": true
  }
}
```

```json
{
  "ContextBundle": {
    "bundleHash": "sha256-hex",
    "selected": [],
    "relations": [],
    "evidence": [],
    "contradictions": [],
    "reviewFlags": {"reviewed": 0, "unreviewed": 0},
    "truncationMeta": {"applied": false, "reasons": []},
    "excludedReason": []
  }
}
```

`bundleHash` 算出規則（固定）は次のとおりです。
1. 非決定論フィールド除外（timestamp/trace/latency）。
2. 配列順序固定（selected=id asc, relations=(type,from,to) asc, evidence=cardId asc, contradictions=(weight desc,id asc)）。
3. canonical JSON化（キー辞書順、UTF-8、空白なし）。
4. `sha256(canonical_json)` の16進小文字を採用。

### 9.3 Consequences

- CE-2+ は `sourceBundleHash` に `ContextBundle.bundleHash` を必須連携する。
- `previewConfirmed=false` はbundle生成前に `422 preview_required` とする（Query Previewバイパス禁止）。
- 未定義キーを含むrequestは `400 unknown_contract_key` としてrejectする（CE1 v1 closed-world）。
- 同一canonical queryで `bundleHash` が不一致となる場合は `409 nondeterministic_bundle` としてfail-closedする。
- `safeModePolicy=strict` + `reviewFilter=reviewedOnly` では未レビュー本文を入力IRへ含めない。
- 機械判定式: `canonical(queryA)==canonical(queryB) && hashA==hashB` が真であること。
- CE4監査では `queryId` / `queryCanonicalHash` / `bundleHash` / `excludedReason` の4キーを欠落させてはならない。

#### A2-minimal-v1 ambiguity semantics

`A2-minimal-v1` は、曖昧さを解決済みの事実へ変換しないことも検証する。固定stub内の選択項目、関係、根拠、反対意見は、次の意味情報を持つ。

- `claimType` は既存のドメイン語彙を使い、レビュー済みであっても仮説を事実として扱わない。
- `resolutionState="unresolved"` は、利用者による判断がまだ完了していないことを示す。
- `aiDisposition="constraint"` は、AI入力で結論ではなく制約として扱うことを示す。
- `autoResolve=false` は、AI、worker、APIが自動的に解決済みへ変更してはならないことを示す。
- `safeModePolicy=strict` では未レビュー本文を `selected` から除外する一方、本文を含まない根拠・反対意見・矛盾の存在は制約として保持できる。

これらは `ContextBundleV1` のトップレベルキーを増やすものではなく、固定stubの意味論を検証するための値である。永続データの状態語彙やレビュー権限を変更する場合は、別issue/ADRで扱う。

---

## Stream A CE0/HIL Contract Snapshot Linkage (2026-04-16)

### Context
- CE0/HIL契約凍結（`CE0-CTX-IF` / `CE0-SAFEMODE-IF` / `CE0-REVIEW-IF`）はIR生成境界で後退させてはならない。

### Decision
- 本仕様のCE1 Bridge Constraintsは、`CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1` を参照し、次を固定する。
  - `previewConfirmed=true` 必須
  - deterministic `queryCanonicalHash` / `bundleHash`
  - safeMode後退禁止
  - proposal-only境界（direct write / auto-apply禁止）

### Consequences
- Verifyで契約ドリフトを検知した場合はIR生成を停止し、Self-Correctionは最大3回。
- 下流はsnapshot参照のみ可とし、契約更新はCE0/A1 issue側でのみ実施する。

### Snapshot Metadata
- Snapshot ID: `CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1`
- Version: `1.0.0`
- Hash (sha256): `851849b770825eb4844d46c77bae34bbefb4aec1ae9bd004e7dc4d50b875a698`

## Stream B Contract Vocabulary Sync Note（2026-04-17）

本書で扱うCE0/CE1/CE2契約語彙は次で固定する。

- CE0: `safeMode` 後退禁止 / Consensus direct write禁止 / auto-apply禁止
- CE1: `ContextQuery` / `ContextBundle` / `queryCanonicalHash` / `bundleHash` / `previewConfirmed`
- CE2: `proposal-only` / `proposalId` / `diff` / `sourceBundleHash` / `status` / `reviewState` / `held`

上記語彙の意味変更・列挙値変更・安全境界変更は本書単独で行わず、Issue契約（CE0/CE1/CE2）でCDC承認後に同期する。


## CE1 contract freeze sync note（2026-05-06 / Stream B）

- `ContextQueryV1` / `ContextBundleV1` のrequired keyと意味論はv1凍結を維持する。
- IR生成前提ゲートとして `previewConfirmed=true` を必須化し、違反は `422 preview_required` とする。
- unknown keyは `400 unknown_contract_key`、hash非決定論は `409 nondeterministic_bundle` のfail-closedを維持する。
- 同一canonical query 3回実行で `queryCanonicalHash` / `bundleHash` が3/3一致する検証をmock-first基準とする。

## CE1 contract-freeze note（2026-05-07 / Stream B）

- 本仕様はCE1 `ContextQueryV1` / `ContextBundleV1` を **contract-only / mock-first** 境界として参照する。
- IR生成はQuery Preview完了後のみ許可し、`previewConfirmed=false` は `422 preview_required` で停止する。
- v1はclosed-worldとし、未定義キーは `400 unknown_contract_key` とする。
- 同一canonical queryに対して `queryCanonicalHash` / `bundleHash` が一致しない場合は `409 nondeterministic_bundle` でfail-closedとする。
- 本節は実装方式を拘束せず、契約語彙と検証条件のみを固定する。

## CE0 Contract Matrix Freeze（CTX / SAFEMODE / REVIEW）

本節はCE0契約行列をIR仕様上で凍結する。実装進捗に依存せず、後退不能の契約境界として扱う。

| Contract ID | Domain | Frozen rule | Regression check |
| --- | --- | --- | --- |
| `CE0-CTX-IF` | CTX | `ContextQuery/ContextBundle` は preview gate (`previewConfirmed=true`) を満たした場合のみ IR 生成を許可する。 | `previewConfirmed=false` は常に `422 preview_required`。 |
| `CE0-SAFEMODE-IF` | SAFEMODE | safeMode 既定 `ON`（`meta.safe_mode=true`）を必須とし、`reviewFilter=reviewedOnly` を既定境界として保持する。 | safeMode OFF 入力、unreviewed 混入、既定値緩和は fail-closed。 |
| `CE0-REVIEW-IF` | REVIEW | `reviewState` は `unreviewed | human_reviewed` のみ。AI による自動昇格を禁止。 | `unreviewed -> human_reviewed` が人手以外経路で発生したら fail。 |

### Consensus Graph write boundary（CE0-CG-WRITE-IF）

- `ConsensusGraph` へのdirect writeは禁止。
- AI/worker/APIはproposalを生成しても、適用は `patch + approval` のみ許可。
- quality gate実行中にdirect write pathを1件でも検知した場合、検証を即時停止する。

### Freeze invariants

1. Contract IDの追加・改名・削除は禁止（重複定義0を維持）。
2. safeMode既定ON・unreviewed保護・Consensus Graph direct write禁止の3点は同時成立が必須。
3. 本節で扱う契約はCE1以降の実装進捗に依存せず、read-only参照で運用する。

## Stream B Bridge Freeze Note（2026-05-17）

- IR接続時もCE1 v1 closed-worldを維持し、未定義キー受理を禁止する。
- 失敗語彙は `preview_required` / `unknown_contract_key` / `nondeterministic_bundle` の3種固定。
- A2では `stubDatasetId=A2-minimal-v1` を唯一の検証データセットとし、実DB/実LLM/worker経路を無効化する。
- Verifyは `queryCanonicalHash` / `bundleHash` の3/3一致を必須とし、自己修復上限は3回。
- ProceedはCE2/CE4へのread-only handoffのみ許可。

## CE1 Stream C sync note（2026-05-17 / I/F-first mock-first）

- Phase開始ごとに `issue-CE1-context-query-bundle-foundation.md` / `schemas.md` / 本書を再Readし、contract driftを禁止する。
- `ContextQueryV1` / `ContextBundleV1` はv1 closed-worldのまま固定し、未定義キーを受理しない（`400 unknown_contract_key`）。
- roundtrip検証は `stubDatasetId=A2-minimal-v1` 固定で行い、同一canonical query 3回で `queryCanonicalHash` と `bundleHash` の3/3一致を必須とする。
- `previewConfirmed=false` はIR生成開始前に必ず `422 preview_required` としてfail-closedする。
- CE2/CE4への引き渡しはread-only（`sourceBundleHash === bundleHash` 検証可能な最小鍵のみ）とし、CE1側での実装依存追加を禁止する。


## Stream B contract lock addendum（2026-05-18 / CE1-independent）

### Context
CE2/CE4の進行をCE1実装完了待ちにしないため、IR境界でContextQuery/ContextBundle契約の不変条件を固定する。

### Decision
1. **Schema/versioning固定**
   - `ContextQueryV1` / `ContextBundleV1` はclosed-world。
   - v1では未知キー拒否（`400 unknown_contract_key`）。
   - 契約変更はv2改訂のみ許可。
2. **Truncation境界固定**
   - truncationはIR payload（`LLMRequest.inputs`）内でのみ許可。
   - Query/Bundle canonicalization結果（`queryCanonicalHash` / `bundleHash`）を変化させるtruncationを禁止。
3. **Fallback固定（fail-closed）**
   - `previewConfirmed!=true` は `422 preview_required` で即失敗。
   - canonical query同値でhash不一致は `409 nondeterministic_bundle`。
4. **Mock/contract test固定**
   - `stubDatasetId=A2-minimal-v1` をCE1検証の唯一プロファイルとして固定。

### Consequences
- IR実装はCE1契約に依存しつつもbackend実装非依存で検証可能。
- 下流はhash監査キーを不変前提で再利用できる。
- 契約衝突時は実装継続せず `held` 停止が必須となる。


## Stream B CE1 contract freeze addendum（2026-05-20 / Context-Decision-Consequences）

### Context
CE1 v1のquery/bundle契約が揺れると、IR生成境界でCE2/CE4の監査再現性が崩れる。

### Decision
- `ContextQueryV1` / `ContextBundleV1` はclosed-world v1として維持する。
- 固定エラー語彙を `preview_required` / `unknown_contract_key` / `nondeterministic_bundle` の3種に限定する。
- Verifyは `Plan -> Execute -> Verify -> Proceed` の直列順序を固定し、Verify失敗の自己修復は最大3回までとする。

### Consequences
- IR仕様はprovider差分や実装進捗と独立してcontract-firstで検証可能。
- 競合（契約ID衝突・語彙衝突）検知時はfail-closedで停止できる。
