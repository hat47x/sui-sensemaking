# 概要

> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md` である。本書には必要最小限だけを書き、追加や改名のときは正本を先に更新する。
本書は、ADR-0009のPhase Bを完了させるため、次の項目を定義する。決定論的なKJ入力の正規化、LLMを使わないグラフの前処理、厳密なLLM入力IRのスキーマ、切り詰めの動作、フィクスチャ生成の検証手順、安全性とプライバシーの整合チェックである。

# llm_input_ir_spec: LLM投入IR仕様（ADR-0009 Phase B 完了）

本仕様は、`ADR-0009` のPhase B（データ/IRの整備）を完了させるための正本である。
対象は「LLMへ渡す前段のデータ」だけであり、モデルの実装や、推論品質の評価ルーブリック自体は対象外とする。

> **現行の `ir_version` は `1.2`**（2026-08-30、`cards[*].hold_state` を加算）。1.1は、同日の `ADR-0069` D1=B / D2=A / D3=A / D4=A を反映した版である。版数を判断した根拠と、各版の差分は、§7.4を参照。

> CE1のContext基盤との統合メモ: `ContextQuery` / `ContextBundle` の契約固定（`previewConfirmed` 必須、正準ハッシュ）は、`02_Architecture/api.md` と `01_Plans/issues/done/issue-CE1-context-query-bundle-foundation.md` を正本とする。本書では、IRと接続するときの整合条件だけを規定する。

---

## 0. 範囲・対象外・受け入れ基準

### 0.1 範囲

1. KJ入力の正規化の固定（`cards` / `coordinates` / `relations` / `meta`）。
2. LLMを使わない前処理の固定（クラスタ候補・中心性・連結成分・矛盾サブグラフ）。
3. LLM投入IR（`LLMRequest.inputs`）の、JSON schema・必須/任意・サイズ上限・切り詰め規則の固定。
4. FixtureProviderの回帰データを、IR仕様だけで生成できることの検証手順の提供。
5. safeMode / PIIの最小化 / 構造化テキスト限定についての、整合チェック項目の固定。

### 0.2 対象外

1. LLMの出力スキーマ（`LLMRequest.output_schema` の中身）の設計。
2. プロバイダのトランスポートの実装（HTTP / IPC / in-process）の選定。
3. エスカレーションを有効にする手順そのもの（`02_Architecture/llm_escalation_policy.html` の領域）。
4. 画像・音声・バイナリの添付の取り扱い。

### 0.3 受け入れ基準

- AC-1: 本仕様の正規化入力だけで、`LLMRequest.inputs` を決定論的に生成できる。
- AC-2: LLMを使わない前処理4種の、出力形式と計算規則が、曖昧な語なしで定義されている。
- AC-3: サイズ上限を超えたとき、同じ入力から同じ切り詰め結果を再現できる。
- AC-4: FixtureProvider用の回帰データを、LLMに依存せずに生成して比較できる。
- AC-5: safeMode / PIIの最小化 / 構造化テキスト限定の検査が、実行できるチェックリストとして明文化されている。

---

## 1. 用語と識別子

- **正準のカードID**: `Card.id` の正規ID。
- **relation id**: `"<type>:<fromId>:<toId>"`（文字列の連結）で、決定論的に生成する。
- **negation relation**: `relations[*].type == "negate"`。
- **関係型の語彙（AI-REL-VOCAB-DRIFT-01 / ADR-0069 D2=A）**: `relations[*].type` は、キャンバスの語彙5値 `related | negate | causal | mutual | equivalence` に統一する。IR独自の `arrow`（因果か方向か曖昧）は `causal` へ、綴り違いの `negation` は `negate` へ写像する。バックエンドだけにある `unknown`（未分類）は、IRに含めない。逆方向（IRからキャンバス）の写像は行わない。
- **IR**: `LLMRequest.inputs` に格納するJSON。
- **structured text only**: JSONで表現できる文字列・数値・配列・オブジェクトだけを許可し、バイナリを禁止する。
- **queryCanonicalHash**: 正準化した `ContextQuery` から算出する、sha256の16進小文字。
- **bundleHash**: 正準化した `ContextBundle` から算出する、sha256の16進小文字。

---

## CE1 Bridge Constraints（ContextQuery/Bundle 連携の制約）

本節は、Phase 1〜6のCE1の固定契約を、IR生成の境界で破らないための拘束条件を定義する。

1. `previewConfirmed != true` の `ContextQuery` から、IRの生成を始めてはならない（APIは `422 preview_required` を返す前提）。
2. `queryCanonicalHash` と `bundleHash` は、IRのメタデータに監査キーとして保持できなければならない。
3. IRの生成パイプラインは、同じ正準queryに対する `bundleHash` の不一致を検知したら、`nondeterministic_bundle` として失敗扱いにする。
4. CE2/CE4との連携では、バックエンドが未実装のときも、モックの `ContextQuery/ContextBundle` 契約で検証を続け、CE1の完了を待つことを禁止する。
5. 実行の順序は `Plan -> Execute -> Verify -> Proceed` に固定し、`Proceed` では、CE2/CE4への参照専用の引き継ぎだけを許可する。
6. Verifyが失敗したときの自己修復は最大3回までとし、3回を超えたら、処理を続けずに停止する（安全側で拒否する）。
7. `ContextQuery/ContextBundle` は、CE1 v1の最小I/F以外の未定義キーを受理してはならない（拡張は、v2契約の改訂でのみ許可する）。
8. 契約IDの衝突（`CE1-CTXQ-IF` / `CE1-CTXB-IF` / `CE1-HASH-DET-IF` / `CE1-PREVIEW-GATE-IF`）、またはsafeModeの後退を検知したら、ただちに停止する。
9. CE2の提案連携では、`sourceBundleHash/status/reviewState` を必須の監査キーとして扱い、proposal-onlyの境界（auto-applyの禁止）を破ってはならない。

### CE1 Contract Lock Summary（Stream B）

- 署名（識別）の固定: `CE1-CTXQ-IF` / `CE1-CTXB-IF` / `CE1-HASH-DET-IF` / `CE1-PREVIEW-GATE-IF`
- 型の固定: `ContextQueryV1` / `ContextBundleV1` のv1必須キー集合を、closed-worldとして固定
- エラーの固定: `422 preview_required` / `400 unknown_contract_key` / `409 nondeterministic_bundle`
- mock-firstの固定: `stubDatasetId=A2-minimal-v1` で検証し、実DB・実LLM・workerへの依存を禁止
- Verify自己修復の上限: 3回（超過したら `held` で停止）

### CE1 A2 Stub Contract Profile（検証用）

CE1のIR接続の検証（A2）では、バックエンドの完了を待つことを禁止し、次のスタブの契約を最小のプロファイルとして固定する。

- `POST /context/query`
  - リクエスト: `ContextQueryV1`（closed-world、未定義キーは禁止）
  - success: `200 { accepted: true, queryCanonicalHash }`
  - error: `422 preview_required` / `400 unknown_contract_key`
- `POST /context/bundle`
  - リクエスト: `{ query: ContextQueryV1, stubDatasetId: "A2-minimal-v1" }`
  - success: `200 ContextBundleV1 + queryCanonicalHash`
  - error: `409 nondeterministic_bundle` / `400 unknown_contract_key`



### CE1 Execution Order Lock（Stream B）

CE1のContract作業では、次の順序を固定し、逆順にすることも省略することも禁止する。

1. Phase 1 Read
2. Phase 2 ADR CDC
3. Phase 3 Plan（AC/DoDの提案への合意を先に確定する）
4. Phase 4 Execute（契約の固定: `ContextQuery` / `ContextBundle` / `bundleHash` / `previewConfirmed`）
5. Phase 5 Verify（プレビューのゲート + 決定論hash。自己修復は3回まで）
6. Phase 6 Proceed（参照専用の引き渡し）

Phase 5 Verifyは、最低限、次の機械判定を満たすこと。

- `previewConfirmed=false -> 422 preview_required`
- 同じ正準queryを3回実行して、`queryCanonicalHash` と `bundleHash` が3/3一致
- 未定義のキーは、常に `400 unknown_contract_key`

Phase 6 Proceedでは、CE2/CE4への参照専用の連携だけを許可し、実装の変更の要求を禁止する。CE2/CE4は、モック契約で依存を切り離したまま進め、CE1の完了を待つことを禁止する。

A2の契約テストでは、次を機械判定する。

1. 同じ正準queryを3回実行して、`queryCanonicalHash` と `bundleHash` が3/3一致。
2. `previewConfirmed=false` は、常に `422 preview_required`。
3. 未定義のキーは、常に `400 unknown_contract_key`。
4. CE2連携のキー `sourceBundleHash === bundleHash` を比較できる。

---



### Stream C CE1 Foundation Lock（2026-05-04）

- 本仕様でのCE1の責務は **契約の固定だけ** とし、実装の詳細（handler/UI/DB/worker）は追加しない。
- `ContextQueryV1` / `ContextBundleV1` は、closed-worldのv1を維持し、未定義のキーは常に `400 unknown_contract_key` とする。
- プレビューのゲートは `previewConfirmed=false -> 422 preview_required` に固定し、IRの生成を始めない。
- hashの決定性は、同じ正準queryで `queryCanonicalHash` / `bundleHash` が3/3一致することを要件とし、不一致は `409 nondeterministic_bundle` とする。
- CE2/CE4は、mock-firstで依存の切り離しを維持し、CE1の実装を待つことを禁止する（契約の引き渡しだけで前進する）。

## 2. KJ入力の正規化（固定仕様）

### 2.1 cards

入力の `cards` は、次の形へ正規化する。

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

1. `id` は、空文字を禁止する。
2. `text` はUTF-8の文字列とする。制御文字（U+0000..U+001F, U+007F）は除去する。
3. `text_norm` は、次の手順で生成する。
   - NFKC正規化
   - 連続する空白を、1つのスペースへ畳み込む
   - 前後の空白を除去する
4. `char_len` は、`text_norm` の文字数とする。
5. 同じ `id` が複数ある場合は、入力不正として拒否する。
6. **正規化後の並び順は `id` の昇順**とする（ir_version 1.1で明文化）。入力配列の順序に依存しないため、カードを並べ替えただけの文書からも、同じ `llm_ir.json` が得られる（§6の検証の成功条件「同じ `document.json` から常に同じ `llm_ir.json`」を、入力のわずかな差分に対しても成立させる）。
7. 正規化した後に、`text` または `text_norm` が空文字になるカードは、拒否する（§4.2が `minLength: 1` を課しているため、空のままではIRへ入れられない）。
8. **`hold_state`（ir_version 1.2で追加）**: `DocumentV1.cards[*].holdState`（`schemas.md` §14.1）を投影する。値は、`held` / `pending` / `shelved` の3値だけとする。
   - **値を持たないカードでは、キーごと省略する**（`null` は書かない）。省略は「保留していない通常のカード」を表す符号化であり、`schemas.md` §14.1の「欠落時は従来の挙動」と一致する。`islands`（§2.2A）が `null` を明示するのとは扱いが異なる。島では「タイトル未設定」と「タイトル欠落」を区別する必要があるが、カードの保留状態には、区別すべき第2の欠落状態がない。また、全カードへ `"hold_state": null` を書くのは、毎回のリクエストのトークン費用に見合わない。
   - 3値以外の値は拒否せず、**除外**する（キーの省略として扱う）。§2.3の規則6が未知の関係型を除外するのと同じ理由による。未知の保留状態は、IRが使える構造を持たないが、それによって、正常な文書を投影できなくしてはならない。
   - **意味**: 3値はいずれも、「人間が意図的に判断を保留したり、退避させたりした」ことの記録である。IRを消費する側は、この状態のカードを、**新規のグループや島の構成員として提案してはならない**（`AI-IR-PROJECTION-01` AC-2）。既存の島の構成員として `islands[*].card_ids` に現れることは妨げない（既に決まった構造であり、提案ではない）。
   - AIが、この値を書き換えたり、昇格させたりしてはならない（§2.2Aの規則6の `review_state` と同じ扱い）。

### 2.2 coordinates（ir_version 1.1 で任意フィールドにした・ADR-0069 D1=B）

入力の座標は、次の形へ正規化する。

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

1. `x`, `y` は、有限の実数とする（NaN / ±Infは禁止）。
2. 座標は、重心を基準に平行移動して正規化する。
   - 重心 `cx = mean(x)`, `cy = mean(y)`
   - 正規化した後 `x = round(x - cx, 3)`, `y = round(y - cy, 3)`
3. `radius = round(sqrt(x^2 + y^2), 3)`。
4. `angle_deg = round(atan2(y, x) * 180 / pi, 3)`（範囲は -180.000..180.000）。
5. `card_id` が `cards.id` に存在しなければ、拒否する。
6. **座標を渡す場合は、必ず本節の正規化を経る。** 生の絶対座標を、IRへ入れてはならない。

#### 2.2.1 エンドポイント別の座標の要否（ADR-0069 D1=B）

`coordinates` は、`ir_version` 1.1で**任意フィールド**になった。IRビルダーを呼び出す側は、エンドポイントごとに、要否を宣言する。

| エンドポイント | `coordinates` | 理由 |
|---|---|---|
| `POST /ai/suggest-layout` | **要求** | 出力そのものが配置であり、相対的な布置が入力として意味を持つ |
| `POST /ai/detect-contradiction` | 非要求 | 判断の材料は論理関係（`relations` / `evidence_links`）であり、布置は根拠にならない |
| `POST /ai/suggest-card-groups` | 非要求 | 既存の島・階層・関係・`hold_state` で足りる。空間に由来するまとまりが必要な場合は、`cluster_candidates.basis="spatial"` で明示的に渡す |
| `POST /ai/generate-narrative` | 非要求 | 叙述の骨格は `causal` / `negate` であり、座標ではない |

`coordinates` を省略したIRでは、`cluster_candidates` のspatialの候補（§3.1の規則2）は生成されない（relation由来のものだけになる）。

### 2.2A islands（ir_version 1.1 で追加・ADR-0069 D3=A）

人間が確定させた島の階層を、IRへ渡す。これは、**`cluster_candidates`（機械が出した候補、§3.1）とは型として別のもの**であり、混同してはならない。前者は既に決まったもの（CVI-3の人によるレビューで昇格した構造）であり、後者は提案である。

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

1. `id` は、空文字を禁止する。`id` が重複したら拒否する。
2. `card_ids` は、`cards.id` に存在するものだけを残し、昇順にソートする。存在しないIDは、黙って除外する（§5の切り詰めで除外されたカードを、島が参照しうるため）。
3. **カードから島への一意化の規則は「先勝ち」**とする（`issue-DOMAIN-ISLAND-MEMBERSHIP-01` の暫定規則）。複数の島の `cardIds` に同時に現れるカードは、**入力配列の先頭から見て最初に一致した島にだけ**帰属させ、後続の島の `card_ids` からは除外する。これは読み取り側の投影の規則であり、書き込み側が重複して所属させることを禁止するものではない。
4. `parent_island_id` は、他の島の `id` に存在しなければ `null` にする（孤立した参照を、IRへ持ち込まない）。
5. `placard_card_id` は、その島の `card_ids` に含まれない場合は `null` にする。
6. `review_state` は、`CE0-REVIEW-IF` の2値だけとする。`Island.titleReviewed === true` を `human_reviewed` に、それ以外（`false` / 未設定）を `unreviewed` に写像する。AIが、この値を昇格させてはならない。
7. `card_ids` が空になった島も、保持する（島が存在すること自体が、構造の情報であるため）。
8. 並び順は、`id` の昇順とする。

`title` / `placard_card_id` / `parent_island_id` は、値がない場合に `null` を明示する（キーの欠落ではない）。

### 2.2B evidence_links（ir_version 1.1 で追加）

人間が記録済みの、根拠と矛盾のリンクを、IRへ渡す。`ADR-0069` が挙げた「矛盾検出が、既存の `evidenceLinks` / `contradictionState` を見ていない」（`AI-IR-PROJECTION-01` AC-1）という問題を、IRの経路で解消するためのフィールドである。

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

1. `from_card_id` / `to_card_id` が `cards.id` に存在しないものは、除外する。
2. 重複判定のキー `(type, from_card_id, to_card_id)` が重複した場合は、入力順で先頭の1件に重複排除する。
3. **`EvidenceLink.note`（自由記述）は、IRへ投影しない。** §7.2のPIIの最小化と、根拠リンクが構造の情報として扱われるべきである（本文の再投入ではない）ことの、両方による。
4. `contradiction_state` は、`type="contradicts"` のときだけ意味を持つ。`type="supports"` では、常に `null` とする。
5. 並び順は、`(type, from_card_id, to_card_id)` の昇順とする。
6. **`confirmed` / `held` は、人間が既に判断を下した状態である。** IRを消費する側（プロンプトの構築・提案の生成）は、この状態のリンクを、新規の発見として再提示してはならない。

### 2.3 relations

入力の関係は、次の形へ正規化する。

```json
{
  "id": "string",
  "from": "string",
  "to": "string",
  "type": "related|negate|causal|mutual|equivalence"
}
```

規則は次のとおりです。

1. `from`, `to` は、`cards.id` に存在すること。
2. `type` は、列挙値だけを許可する。
3. 重複判定のキー `(from, to, type)` が重複した場合は、1件に重複排除する。
4. 自己ループ（`from == to`）は、`negate` 以外なら拒否する。
5. 正規化した後の並び順は、`(type, from, to)` の昇順とする。
6. **`DocumentV1.edges` からの投影規則（ir_version 1.1で明文化）**: 次のいずれかに該当する辺は、拒否ではなく**除外**する（IRは「カード間の論理関係」のIRであり、それ以外の辺は表現の対象外であるため）。
   - `fromKind` または `toKind` が `"island"` の辺（島と島のあいだの派生辺は、`islands` の階層で表現する）。
   - `type` が5値の語彙のいずれでもない辺（バックエンドだけにある `unknown` を含む。D2=Aの決定により、IRには含めない）。
   - `from` / `to` が `cards` に存在しない辺。
   
   上記に該当しない辺のうち、規則1〜5に違反するもの（`negate` 以外の自己ループなど）は、規則どおり拒否する。

### 2.4 meta

`meta` は、次の最小のフィールドに固定する。

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

1. `safe_mode` は必須であり、`true` でなければIRの生成を拒否する。
2. `doc_version` は、正の整数とする。
3. `language` を判定できないときは、`unknown` を使用する。
4. `meta` には、個人を識別できる情報（メール、電話、住所、外部ID）を含めない。
5. **`created_at` / `updated_at` は、ir_version 1.1で任意のフィールドとする。** 文書を伴わない入力（`POST /ai/detect-contradiction` にカード2枚だけを渡す既存の契約など）では、発生した時刻が入力に存在しない。生成した時刻で埋めると、同じ入力から同じIRが得られなくなる（AC-3 / §5の決定性に反する）。この場合は、**キーごと省略する**。現在の時刻で代用してはならない。
6. **`language` の判定規則（ir_version 1.1で明文化）**: 全カードの `text_norm` を連結した文字列に対して、次のとおり判定する。
   - CJK統合漢字・ひらがな・カタカナ（`U+3040..U+30FF`, `U+3400..U+4DBF`, `U+4E00..U+9FFF`, `U+F900..U+FAFF`）のいずれかを含むなら、`ja` の成分がある。
   - ASCIIのラテン文字（`A-Za-z`）を含むなら、`en` の成分がある。
   - 両方があれば `mixed`、片方だけならその値、どちらもなければ `unknown` とする。
7. **`meta` は、`LLMRequest.inputs` のトップレベルに含める**（§4.1を参照）。§7.1が `meta.safe_mode` を必須としている以上、`meta` がIRの外にあると、仕様が自己矛盾する。ir_version 1.0の§4のスキーマは、`meta` を列挙しないまま `additionalProperties: false` としており、実装できなかった。1.1で、これを是正する。

### 2.5 横断的所属（`DocumentV1.affiliations`）は投影しない

`DocumentV1.affiliations` は、カードと島の `(cardId, islandId)` の組であり、LLM投入IRへ投影しない。2026-10-09 に、次の経路を読んで確認した。

1. `source_from_document` は `affiliations` を読まない。`IRSource` に、所属を表す欄はない。
2. `llm_input_ir.py` のどこにも `affiliation` の参照はなく、`build_llm_input_ir` の出力に `affiliations` のキーは含まれない。
3. `attention_candidates.build_attention_ir` は、`build_llm_input_ir` の出力を作ったあとに `ir["affiliations"]` を追加する。この拡張されたIRは、プロバイダを呼ばない `POST /ai/suggest-attention-candidates` と、人間が手元で読むための表示用スクリプト `scripts/review_cognitive_candidate_t2.py` でだけ使われ、LLMへは渡らない。
4. attention の `sourceDigest` は `(cardId, islandId)` の組を含めて計算するが、応答にはハッシュ値だけを返す。

したがって、Affiliation の ID の組は、外部LLMへの入力には乗らない。Affiliation をLLMの入力へ加える場合は、IRの契約（`ir_version`）の改版と、本節の改訂が必要になる。

---

## 3. LLMを使わない前処理（固定仕様）

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

1. relation-basedの候補: `related|causal` の辺で連結な部分集合を、列挙する。
2. spatial-basedの候補: 座標の距離による近傍グラフ（k=3）で連結な集合を、列挙する。`coordinates` がないIR（§2.2.1で非要求のエンドポイント）では、spatialの候補を生成しない。
3. 同じ `card_ids` は、`basis` を統合して1件にする（`relation` を優先する）。
4. `score` は、`round(min(1.0, density + cohesion) / 2, 4)` とする。
   - `score` は、relation/spatialのグラフの**構造上の密度と凝集度を再現するための、内部の診断値**であり、カード内容の意味的な類似度、重要度、確信度、採用の順位ではない。IRや監査には保持できるが、AIのプロンプトや利用者向けの候補へ数値として露出し、semantic authorityへ読み替えてはならない（`ADR-0090`）。

**ir_version 1.1での明文化**（AC-2「曖昧な語なし」を満たすため。1.0は、`density` / `cohesion` / `cluster_id` の採番順と、候補の粒度を定義しておらず、決定論的に再現できなかった）。

5. 候補の粒度は、**連結成分**とする（極大な連結部分集合であり、部分集合の総当たりの列挙ではない）。カード1枚だけの成分は、候補にしない（`card_ids` の `minItems` は2）。
6. spatialの近傍グラフ: 各カードについて、正規化した座標のユークリッド距離が近い順に、上位3件（`k=3`）へ無向辺を張る。距離が同じ値の場合は、`card_id` の昇順で先に来るものを採る。
7. `density = round(m / (n * (n - 1) / 2), 6)`。`n` は候補内のカード数、`m` は候補内の**内部の辺の数**（そのbasisのグラフで、両端が候補内にある辺の数。重複を排除した後）。
8. `cohesion = round(m / (m + b), 6)`。`b` は、候補内のカードに接続する辺のうち、片端が候補の外にある辺の数。`m + b == 0` のときは `0.0` とする。
   - 候補が連結成分である以上、`b` は常に0であり、`m > 0` なら `cohesion` は1.0になる。それでも式を残すのは、将来basisの定義を、成分より細かい粒度へ変えたときに、`score` の意味が変わらないようにするためである。
9. `cluster_id` は、`card_ids` を昇順にソートした配列どうしを辞書順で比較して並べ、その順に `cc-0001` から連番を振る。`basis` は、採番の順序に影響しない（規則3で統合した後に採番する）。

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

1. 無向グラフとして、`degree` を計算する。
2. betweenness centralityを標準の定義で計算し、小数4桁へ丸める。
3. 並び順は、`betweenness desc`、同値のときは `degree desc`、さらに同値のときは `card_id asc` とする。
4. `rank` は、上の順序で1から始まる連番とする。

**ir_version 1.1での明文化**。

5. 対象のグラフは、§2.3で正規化した後の全relationを、無向辺とみなしたものとする（型では絞らない）。多重辺は、`(from, to)` の順序のない対で1本に畳む（`degree` の二重計上を避けるため）。自己ループは、`degree` に数えない。
6. `degree` は、そのカードに接続する（畳み込んだ後の）辺の本数とする。
7. betweennessは、**正規化しない**標準の定義 `bc(v) = Σ_{s<t, s≠v≠t} σ_st(v) / σ_st` を用いる（無向グラフなので、各ペアを1回だけ数える）。Brandesのアルゴリズムで計算し、最後に `round(x, 4)` とする。
8. 関係を1本も持たないカードも、`degree=0` / `betweenness=0.0` の項目として、必ず列挙する。`centrality` は `cards` と1対1であり、§5.2の切り詰めは、この `rank` を唯一の順序の根拠として使う。

### 3.3 連結成分（connected_components）

```json
{
  "component_id": "cmp-001",
  "card_ids": ["c1", "c2"],
  "edge_count": 1
}
```

計算規則は次のとおりです。

1. `related|negate|causal|mutual|equivalence` を、すべて無向辺として、成分に分解する。
2. `component_id` は、card_idsの最小のID順に、`cmp-001` から連番とする。
3. `card_ids` は、昇順にソートする。
4. `edge_count` は、その成分内の、正規化したrelationの数とする。

**ir_version 1.1での明文化**。

5. 孤立したカード（辺を持たないカード）も、カード1枚・`edge_count=0` の成分として列挙する。全カードが、いずれか1つの成分にちょうど1回ずつ現れる（`connected_components` の `card_ids` の総和 = `cards`）。
6. `edge_count` は、畳み込む前の、正規化したrelationの件数（`(from, to, type)` 単位）とする。したがって、同じカードの対に `related` と `negate` があれば、2と数える。

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

1. `negate` の辺を含む成分ごとに、1つのサブグラフを作る。
2. `summary` は、テンプレートによる生成だけを許可する。
   - 形式: `"<n> negation edges across <m> cards"`
3. LLMによる要約は禁止する（前処理は純粋に決定論的にする）。

**ir_version 1.1での明文化**。

4. `card_ids` は、その成分の全カードではなく、**その成分内の `negate` の辺に接続するカードだけ**を、昇順に並べたものとする（1.0の§3.4の例が、`card_ids: ["c3","c7"]` / `negation_edges: ["negate:c3:c7"]` と対応していることに合わせる）。
5. `negation_edges` は、その成分内の `negate` のrelationの `id` を、`(from, to)` の昇順に並べたものとする。
6. `subgraph_id` は、§3.3の `component_id` の順序に従い、`negate` を含む成分だけを対象に、`neg-001` から連番とする。
7. `summary` の `<n>` は `len(negation_edges)`、`<m>` は `len(card_ids)` とする。自己ループ `negate:cX:cX` は、`card_ids` に `cX` を1回だけ寄与させる。

---

## 4. LLM投入IRのJSON Schema（LLMRequest.inputs）

### 4.1 必須と任意（ir_version 1.2）

必須は次のとおりです。
- `ir_version`
- `cards`
- `relations`
- `graph_summary`
- `constraints`
- `meta`（1.1で追加。§2.4の規則7を参照。§7.1が `meta.safe_mode` を必須としているため、1.0での欠落は、仕様の欠陥であった）

任意は次のとおりです。
- `coordinates`（1.1で必須から任意へ。ADR-0069 D1=B。§2.2.1の要否の表を参照）
- `islands`（1.1で追加。ADR-0069 D3=A。§2.2A）
- `evidence_links`（1.1で追加。§2.2B）
- `cluster_candidates`
- `truncation`

カード単位の任意のフィールドは次のとおりです。
- `cards[*].hold_state`（1.2で追加。§2.1の規則8。値を持つカードにだけ現れる）

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

### 5.2 切り詰めの順序

上限を超えたときは、次を上から順に適用し、各段階で上限内に収まったかを判定する。

1. `cluster_candidates` を全削除する（任意のフィールドであるため）。
2. `centrality.rank` が低位のカードから、カードを除外する。ただし、呼び出し側がルート契約上の必須の対象として `required_card_ids` を明示した場合は、その集合を先に保持し、残りの枠だけを、中心性の順位で埋める。
3. 除外したカードに接続するrelationを、除外する。
4. それでも超過する場合は、`text` を `text_norm` の先頭240文字へ、固定で切り詰める。

**ir_version 1.1での明文化**（AC-3「同じ入力から同じ切り詰め結果」を、機械的に満たすため。1.0は、各段階の対象・順序・参照整合の扱いが未定義であった）。

5. 判定は、切り詰める前の値で、1度だけ行う。`over_cards = len(cards) > MAX_CARDS`、`over_relations = len(relations) > MAX_RELATIONS`、`over_text = sum(char_len) > MAX_TEXT_CHARS`。いずれかが真なら、段階1を実施する。
6. 段階2の「低位」は、§3.2の `rank` が**大きい**方（中心性が低い方）である。除外の順序を決める `rank` は、**切り詰める前の全カードの集合に対して1度だけ**算出し、以後の全段階でその値を使う（段階ごとに再計算すると、除外の順が入力の規模に依存して揺れる）。`required_card_ids` が空なら、従来どおり `rank <= MAX_CARDS` のカードだけを残す。必須集合がある場合は、必須のカードを先に保持し、`MAX_CARDS - len(required_card_ids)` の残りの枠を、`rank` の小さい順に埋める。理由コードは `MAX_CARDS`。
   - IRへ出力する `graph_summary` と `cluster_candidates` は、**全段階の除外を終えた後の集合に対して算出する**。除外の順の根拠に使う `rank`（切り詰める前）と、出力する `centrality`（切り詰めた後）は別のものである。こうしないと、`graph_summary` がIRに存在しないカードを参照し、IRが参照として閉じなくなる。
7. 段階3では、除外したカードを参照する `coordinates` / `islands[*].card_ids` / `evidence_links` も、同時に除外する（参照整合を、IR内で保つ）。島は、`card_ids` が空になっても保持する（§2.2Aの規則7）。必須カードどうしを結ぶrelationと根拠リンクも、カードを除外する段階では、両端点が残る限り保持される。relationの件数の上限に対する保護は、規則8と§5.2.2に従う。
8. 段階3の後も、なお `len(relations) > MAX_RELATIONS` の場合は、呼び出し側が `required_relation_ids` を指定していれば、その正規化済みのrelationを先に保持し、残りの枠を、`(type, from, to)` の昇順で、必須でないrelationで埋める。必須集合が空なら、従来どおり `(type, from, to)` の昇順で、先頭から `MAX_RELATIONS` 件だけを残す。理由コードは `MAX_RELATIONS`。
9. 段階4では、`text` だけでなく `text_norm` も `text_norm[:240]` に揃え、`char_len = len(text_norm)` を再計算する。`char_len` を据え置くと、`sum(char_len)` が減らず、上限の判定が永久に成立しない。理由コードは `MAX_TEXT_CHARS`。
10. 段階4の後も、なお `sum(char_len) > MAX_TEXT_CHARS` の場合は、`rank` が大きいカードから1枚ずつ除外し（そのたびに、段階3と同じ参照整合の除外を行う）、上限内へ収める。必須カードは、この追加の除外の候補にしてはならない。必須カード以外をすべて除外しても `MAX_TEXT_CHARS` に収まらない場合は、`required_card_budget_exceeded` で安全側で拒否し、ルート必須の意味を黙って削除しない。必須指定がない場合は、従来どおりカードを最低1枚残す（§4.2の `cards.minItems = 1`）。理由コードは `MAX_TEXT_CHARS` のままとする（新しい切り詰めの理由コードは増やさない）。

### 5.2.1 route契約上の必須カード（`required_card_ids`）

`required_card_ids` は、呼び出し側が「このAI操作の対象そのもの」として明示したカードを、汎用的な中心性の順位による切り詰めから保護するための、**IRビルダーへの入力専用の制約**である。AIやIRビルダーが、重要そうなカードを推測して追加する仕組みではない。

1. `required_card_ids` は、IRへ直列化しない。§4.2のJSON Schemaに、新しいフィールドを追加するものではない。
2. 必須集合は、正規化済みの `cards.id` の部分集合でなければならない。欠落したIDを含む場合は、`required_card_missing` で安全側で拒否する。失敗の応答へ、欠落したIDそのものを反射してはならない。
3. 必須集合の件数が `MAX_CARDS` を超える場合は、`required_card_budget_exceeded` で安全側で拒否する。
4. 必須集合の入力順は、選別の結果へ影響させない。同じ入力と同じ必須集合からは、必須IDの列挙順が異なっても、同じIRを生成する。
5. 必須集合が空の場合、§5.2の切り詰めの結果は、本規則を追加する前と同一でなければならない。既存のフィクスチャの正準JSON / SHA-256を変えてはならない。
6. 現時点で `POST /ai/detect-contradiction` は、`cardA.id` / `cardB.id` を必須集合として渡す。この2枚と、その両端点に対応する `confirmed` / `held` の `evidence_links` は、人間が既に下した判断を再提案しないための、ルート固有の必要な意味である。
7. `POST /ai/generate-narrative` は、正規化の対象となるcard-to-cardの `causal` / `negate` relationの両端点を、必須カードとして渡す。さらに、relation自体も§5.2.2の `required_relation_ids` として渡し、端点だけが残って論理的な接続が失われる状態を許可しない。

### 5.2.2 route契約上の必須relation（`required_relation_ids`）

`required_relation_ids` は、呼び出し側が「このAI操作の論理的な接続そのもの」として明示した、正規化済みのrelationを、汎用的な件数による切り詰めから保護するための、**IRビルダーへの入力専用の制約**である。relationの重要度を、AIやIRビルダーが推測する仕組みではない。

1. `required_relation_ids` は、IRへ直列化しない。relation IDは、§2.3の正規化した後のID（`<type>:<fromId>:<toId>`）で指定する。
2. 必須集合は、正規化済みの `relations.id` の部分集合でなければならない。欠落したIDを含む場合は、`required_relation_missing` で安全側で拒否し、失敗の応答へ、欠落したIDそのものを反射してはならない。
3. 必須集合の件数が `MAX_RELATIONS` を超える場合は、`required_relation_budget_exceeded` で安全側で拒否する。
4. 必須relationの両端点は、自動的に `required_card_ids` と同じ保護集合へ加える。これにより、relationを保持しながら端点のカードだけを切り落とすことを、禁止する。結果として、必要な端点が `MAX_CARDS` を超える場合は、`required_card_budget_exceeded` で安全側で拒否する。
5. relationの件数が `MAX_RELATIONS` を超える場合は、必須relationを先に全件保持し、残りの枠を、正規化済みの `(type, from, to)` の昇順で埋め、最終的な配列も同じ順に再整列する。
6. 必須集合の入力順は、選別の結果へ影響させない。同じ入力と同じ必須集合からは、同じIRを生成する。
7. 必須集合が空の場合、relationの切り詰めの結果は、本規則を追加する前と同一でなければならない。既存のフィクスチャの正準JSON / SHA-256を変えてはならない。
8. `POST /ai/generate-narrative` は、§2.3で正規化できるcard-to-cardの `causal` / `negate` relationを、必須集合として渡す。必須relationが `MAX_RELATIONS` を超える場合は、B型の文章化に使う論理の骨格を、部分的に送信せず、安全側で拒否する。

### 5.3 記録

- 切り詰めを1回でも実施した場合は、`truncation.truncated=true` とする。
- 該当した上限の理由コードを、重複なしで `reason_codes` へ記録する。
- `reason_codes` は、`MAX_CARDS` / `MAX_RELATIONS` / `MAX_TEXT_CHARS` の順で並べる（集合の並びが、入力順に依存しないようにするため）。
- 切り詰めが一度も発生しなかった場合、`truncation` は `{"truncated": false, "reason_codes": []}` を出力する（キーごと省略しない。「切り詰めていない」ことを、消費する側が確認できるようにするため）。

---

## 6. FixtureProviderの回帰データの生成手順（IR仕様だけで再現）

1. 入力の `document.json` から、`cards / coordinates / relations / islands / evidence_links / meta` を抽出する。
2. 本仕様の2章の正規化規則を適用して、`normalized_input.json` を生成する。
3. 本仕様の3章の前処理規則を適用して、`graph_features.json` を生成する。
4. 本仕様の4章のschemaに従って、`llm_ir.json`（= `LLMRequest.inputs`）を生成する。
5. 本仕様の5章の上限チェックと切り詰めを適用する。
6. `llm_ir.json` を、フィクスチャのキーの唯一の入力として、FixtureProviderの応答を引き当てる。
7. 回帰テストは、`llm_ir.json` のハッシュ（SHA-256）の一致で、前段の再現性を判定する。

検証の成功条件は次のとおりです。

- 同じ `document.json` から、常に同じ `llm_ir.json` が生成される。
- プロバイダが未起動（`SUI_LLM_PROVIDER=none`）でも、回帰が成立する。

### 6.1 回帰データの所在と再生成

| 役割 | パス |
|---|---|
| 入力 `document.json` | `03_Implement/backend/tests/fixtures/llm_input_ir_document.json` |
| 期待 `llm_ir.json` ＋ SHA-256 | `03_Implement/backend/tests/fixtures/llm_input_ir_expected.json` |
| 再生成コマンド | `python3 scripts/generate_llm_input_ir_fixture.py`（`03_Implement/backend` 直下で実行） |
| 回帰テスト | `03_Implement/backend/tests/test_llm_input_ir.py` |

ファイル名には、版数を含めない（1.1から1.2への繰り上げのたびに改名すると、参照元が増える一方であるため。版数は、期待ファイル内の `irVersion` フィールドが持つ）。

`llm_ir.json` のハッシュは、正準JSON（キーの辞書順・UTF-8・空白なし・`ensure_ascii=false`）のSHA-256の16進小文字とする（§9.2の `bundleHash` の算出規則と同じ正規化を、IRへ適用したもの）。再生成コマンドは、この仕様の実装を通すだけであり、LLMも外部プロバイダも呼ばない。

---

## 7. safeMode・PIIの最小化・構造化テキスト限定の整合チェック

### 7.1 safeModeのチェック

- `meta.safe_mode == true` を必須とする。
- `constraints.safe_mode == true` を必須とする。
- どちらかが欠けている、または `false` の場合は、IRの生成を失敗させる。

**ir_version 1.1での明文化**。

- 本節のチェックは、**既存のAPI境界でのSafeModeの強制（`ADR-0068` / `SEC-AI-SAFEMODE-01` が配線した `_reject_unreviewed_cards` / `_reject_unreviewed_text`）を置き換えるものではなく、それに追加する第二層である**（`ADR-0069`「ADR-0068との関係」）。IR経路を導入する変更が、既存の呼び出しを除去したり弱めたりすることを禁じる。
- IRビルダーは、投影の対象のカードが、人間のレビュー済みであること（`textReviewed === true`）を、**ビルダー自身で**再検査する。ルート側のガードが将来失われても、IRが未レビューの本文を組み立てないようにするためであり、二重に検査されること自体が目的である。
- 緩和（`allowUnreviewedText` ＋ プロファイルの許可）が成立している場合に限り、この再検査は通過してよい。ただし、`safe_mode` フラグそのものの緩和は許可しない（`constraints.safe_mode` は `const true`）。
- 失敗は安全側で拒否することとし、API境界では422とする。**失敗の応答に、違反した入力値（カード本文・検出したPIIの断片）を反射してはならない**（`SEC-VALIDATION-LEAK-01` の作法）。

### 7.2 PII最小化のチェック

次のパターンに一致する文字列を、`text` / `text_norm` / `meta` で検出した場合は、IRの生成を失敗させる。

- メール: `/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/`
- 電話: `/\+?[0-9][0-9\- ]{8,}[0-9]/`
- URLのクエリ中のトークン: `/[?&](token|key|secret|password)=/i`

**ir_version 1.1での明文化**。

- 検査の対象は、**自由記述のテキスト**（`cards[*].text` / `cards[*].text_norm`）と、`meta` の文字列値に限る。ID系のフィールド（`cards[*].id` / `islands[*].id` / `relations[*].id` / `evidence_links[*].*_card_id` など）は、検査の対象に**含めない**。UUIDやハイフン区切りのIDが電話のパターンに偽陽性で一致し、正常な文書のIR生成ができなくなるためである。
- `meta` に適用するのは、**メールとURLトークンの2パターンだけ**とし、電話のパターンは適用しない。電話のパターンは、実質的に「長い数字列」の検出器であり、ISO-8601のタイムスタンプ（`2026-01-01T00:00:00Z`）が必ず一致する。`meta.created_at` / `meta.updated_at` は自由記述ではなく、ここで弾く価値もない。
- **既知の偽陽性**: 電話のパターンは、自由記述のテキスト中の日付・連番・型番にも一致しうる（`2026-01-01` など）。本節は、安全側で拒否する設計であり、この偽陽性は意図的に受け入れる。パターン自体を精緻にする必要が生じた場合は、本仕様の改訂として別に扱い、実装側で黙って緩めない。
- 失敗したときのエラーは、どのパターンの種別（`email` / `phone` / `url_token`）に当たったかまでを報告し、**一致した文字列そのものは報告しない**。
- 本節は「検出したら失敗」であって、「マスクして続行」ではない。IRは入力の正本であり、黙って書き換えると、`document.json → llm_ir.json` の対応を追跡できなくなる。

### 7.3 構造化テキスト限定のチェック

- JSONの型は、`string|number|boolean|array|object|null` だけとする。
- Base64の疑似バイナリ（長さが1024を超え、かつ `[A-Za-z0-9+/=]` のみ）を禁止する。
- `attachments` / `binary` / `image` というキー名の出現を禁止する。

**ir_version 1.1での明文化**。

- 禁止するキー名の判定は**完全一致**とし、大文字と小文字を区別しない（`attachments` / `binary` / `image`）。`imageUrl` / `image_url` のような別の語は該当しない（部分一致で弾くと、`Island.imageUrl` を持つ正常な文書が通らなくなるため）。IRが `Island.imageUrl` を投影しないこと自体は、§2.2Aのフィールド一覧が保証する。
- Base64の判定は、長さが1024を**超え**、かつ空白を含まず、`[A-Za-z0-9+/=]` のみで構成される文字列を対象とする。
- 検査は、IR全体を再帰的に走査して行う。`constraints.structured_text_only == true` は、この検査を通過した事実の宣言である。

---

## 7.4 ir_versionの履歴と版数の判断

| `ir_version` | 日付 | 変更 | 出典 |
|---|---|---|---|
| `1.0` | 2026-04 | 初版（凍結） | `ADR-0009` Phase B |
| `1.1` | 2026-08-30 | D1（`coordinates` の任意化）、D3（`islands` の追加）、`evidence_links` の追加、`meta` をIRのトップレベルへ明記、§3/§5 の計算規則の明文化 | `ADR-0069`, `issue-AI-IR-PROJECTION-01` |
| `1.2` | 2026-08-30 | `cards[*].hold_state` の追加（§2.1の規則8） | `issue-AI-IR-PROJECTION-01` AC-2（Stage 2: `suggest-card-groups`） |

**2026-09-03の `required_card_ids` の明文化では、版数を上げない。** `required_card_ids` は、IRビルダーへ渡す入力専用の制約であり、§4.2の直列化スキーマへフィールドを追加しない。必須指定が空の経路では、従来の正準JSON / SHA-256を維持し、必須指定がある経路でも、変わるのは、既存フィールドの部分集合を選ぶ規則だけである。このため、消費する側が `ir_version` で判別すべき新しいIR表現は生じず、現行の `1.2` を維持する。根拠は `AI-IR-FOCUS-PRESERVATION-01` とする。

**なぜ1.2か（`hold_state` の追加）。** `AI-IR-PROJECTION-01` AC-2は、「`suggest-card-groups` が `holdState` を受け取り、保留中のカードを新規グループへ含めない」ことを要求する。1.1のIRには、カードの保留状態を表す場所がなく、**既存のフィールドでは代替できない**。`islands`（§2.2A）は確定した所属を、`evidence_links`（§2.2B）は根拠と矛盾を、`relations`（§2.3）はカード間の論理関係を表すが、いずれも「このカードの扱いを人間が保留している」という単項の状態を表現できない。IRを迂回して `DocumentV1` を直接読めば実装はできるが、それは `ADR-0069`（IRがAI入力の実際の経路である）の主張そのものを崩す。

1.1から1.2への変更も**加算的**であり、2.0には当たらない。理由は次のとおりです。

- 任意フィールドの追加だけである。`required` は `["id", "text", "text_norm", "char_len"]` のままで、増やしていない。
- 保留状態を持たないカードではキーが現れないため、保留状態を使っていない文書のIRは、1.1と**バイト単位で同一**である（`ir_version` の値を除く）。
- 既存フィールドの意味・列挙値・計算規則を変更していない。`hold_state` は、§3の前処理（中心性・連結成分・クラスタ候補）にも、§5の切り詰めの順序にも**影響しない**。保留は、人間の見立てであって構造ではないためである（`AGENTS.md` §5のR5判定: `holdState` は「利用者の現在の見立て」の側であり、正規化と不変条件の対象にしない）。

`additionalProperties: false` は維持しているため、1.1を想定した消費側は、`hold_state` を未知のキーとして扱う。消費側は、`ir_version` を見て分岐すること。

**なぜ2.0ではなく1.1か。** 1.1の変更は**加算的**である。

- 必須フィールドを増やしていない。`meta` は、§2.4と§7.1が既に必須と定めていたものを、§4のスキーマ本文へ書き足しただけであり、新しい要求ではなく、1.0の内部矛盾の是正である。
- `coordinates` は、必須から任意へ**緩和**した。1.0で妥当なIRは、1.1でも妥当である（`ir_version` の値を除く）。
- `islands` / `evidence_links` は、任意フィールドの追加である。
- 既存フィールドの意味・列挙値・計算規則を**変更していない**。§3 / §5への追記は、1.0が定義していなかった箇所（`density` / `cohesion` の定義、採番の順序、切り詰めの参照整合）を、決定論的に埋めたものである。1.0では、同じ入力から複数の出力があり得た箇所を、1つに絞っている。1.0で一意に定まっていた結果を、別の値へ変えてはいない。
- 関係型の語彙の5値化（D2=A）は、2026-08-13に本書へ適用済みであり、1.1で新たに変わるものではない。

したがって、破壊的変更を示す2.0ではなく、加算的なマイナーの繰り上げである1.1とする。`additionalProperties: false` は維持しているため、1.0の消費側が1.1のIRを読む場合は、`islands` / `evidence_links` / `meta` を未知のキーとして扱う点に注意する。消費側は、`ir_version` を見て分岐すること。

## 8. トレーサビリティ

- 計画の正本: `01_Plans/adr/ADR-0009-local-llm-integration.md` Phase B。
- プロバイダ契約: `02_Architecture/llm_provider_spec.md`（`LLMRequest.inputs` の意味の境界）。
- 実行制約: `02_Architecture/llm_runtime_constraints.md`。
- 品質ゲート: `02_Architecture/llm_quality_strategy.md`。
- エスカレーションの運用: `02_Architecture/llm_escalation_policy.html`。
- 版数1.1の決定の根拠: `01_Plans/adr/ADR-0069-llm-input-ir-as-the-actual-ai-input-path.md`（D1=B / D2=A / D3=A / D4=A）。
- 版数1.2（`cards[*].hold_state`）の決定の根拠: `01_Plans/issues/issue-AI-IR-PROJECTION-01-llm-input-ir-as-ai-input-path.md` AC-2と「結果（Stage 2）」の節。`holdState` の意味の正本は、`02_Architecture/schemas.md` §14.1。
- ルート必須カードの切り詰めからの保護: `01_Plans/issues/done/issue-AI-IR-FOCUS-PRESERVATION-01-preserve-focus-adjudication-under-truncation.md`。共有IRの実装は `03_Implement/backend/src/sui_sensemaking_api/llm_input_ir.py`、`detect-contradiction` の配線は `03_Implement/backend/src/sui_sensemaking_api/routes/ai.py` を参照する。
- 実装課題: `01_Plans/issues/issue-AI-IR-PROJECTION-01-llm-input-ir-as-ai-input-path.md`。
- SafeModeの第一層（本仕様の§7.1が置き換えてはならない既存の実装）: `01_Plans/adr/ADR-0068-safemode-enforcement-at-api-boundary.md`, `01_Plans/issues/done/issue-SEC-AI-SAFEMODE-01-safemode-not-enforced-at-api-boundary.md`。
- カードから島への一意化規則（先勝ち）の出典: `01_Plans/issues/done/issue-DOMAIN-ISLAND-MEMBERSHIP-01-cross-island-cardid-duplicate-detection.md`。
- Pythonの実装（D4=A）: `03_Implement/backend/src/sui_sensemaking_api/llm_input_ir.py`。


## 9. CE-1 ContextQuery/ContextBundle 最小I/F（Contract Freeze）

### 9.1 Context

- 本章は、ADR-0028 CE-1の「同じqueryなら同じbundleHash」を機械判定できるようにするため、LLM入力IRの前段の契約を固定する。
- 本章の契約は、モック実装にも同じように適用し、バックエンドとフロントエンドへの依存を切り離す。

### 9.2 Decision

`POST /context/query` と `POST /context/bundle` の論理契約を、次のとおりに固定する。

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

`bundleHash` の算出規則（固定）は次のとおりです。
1. 非決定論的なフィールド（timestamp/trace/latency）を除外する。
2. 配列の順序を固定する（selected=id asc, relations=(type,from,to) asc, evidence=cardId asc, contradictions=(weight desc,id asc)）。
3. 正準JSONにする（キーの辞書順、UTF-8、空白なし）。
4. `sha256(canonical_json)` の16進小文字を採用する。

### 9.3 Consequences

- CE-2以降は、`sourceBundleHash` に `ContextBundle.bundleHash` を必ず連携する。
- `previewConfirmed=false` は、バンドルを生成する前に `422 preview_required` とする（Query Previewのバイパスを禁止する）。
- 未定義のキーを含むリクエストは、`400 unknown_contract_key` として拒否する（CE1 v1 closed-world）。
- 同じ正準queryで `bundleHash` が不一致となる場合は、`409 nondeterministic_bundle` として安全側で拒否する。
- `safeModePolicy=strict` かつ `reviewFilter=reviewedOnly` では、未レビューの本文を入力IRへ含めない。
- 機械判定の式: `canonical(queryA)==canonical(queryB) && hashA==hashB` が真であること。
- CE4の監査では、`queryId` / `queryCanonicalHash` / `bundleHash` / `excludedReason` の4キーを欠落させてはならない。

#### A2-minimal-v1 ambiguity semantics

`A2-minimal-v1` は、曖昧さを解決済みの事実へ変換しないことも検証する。固定スタブ内の選択項目、関係、根拠、反対意見は、次の意味情報を持つ。

- `claimType` は、既存のドメイン語彙を使い、レビュー済みであっても、仮説を事実として扱わない。
- `resolutionState="unresolved"` は、利用者による判断がまだ完了していないことを示す。
- `aiDisposition="constraint"` は、AIの入力で、結論ではなく制約として扱うことを示す。
- `autoResolve=false` は、AI、worker、APIが、自動的に解決済みへ変更してはならないことを示す。
- `safeModePolicy=strict` では、未レビューの本文を `selected` から除外する一方、本文を含まない根拠・反対意見・矛盾の存在は、制約として保持できる。

これらは、`ContextBundleV1` のトップレベルのキーを増やすものではなく、固定スタブの意味論を検証するための値である。永続データの状態語彙やレビュー権限を変更する場合は、別のissue/ADRで扱う。

---

## Stream A CE0/HIL Contract Snapshot Linkage (2026-04-16)

### Context
- CE0/HILの契約凍結（`CE0-CTX-IF` / `CE0-SAFEMODE-IF` / `CE0-REVIEW-IF`）は、IR生成の境界で後退させてはならない。

### Decision
- 本仕様のCE1 Bridge Constraintsは、`CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1` を参照し、次を固定する。
  - `previewConfirmed=true` を必須とする
  - 決定論的な `queryCanonicalHash` / `bundleHash`
  - safeModeの後退の禁止
  - proposal-onlyの境界（直接書き込みとauto-applyの禁止）

### Consequences
- Verifyで契約のドリフトを検知した場合は、IRの生成を停止し、自己修復は最大3回とする。
- 下流はスナップショットの参照だけを可とし、契約の更新は、CE0/A1のissue側でのみ実施する。

### スナップショットのメタデータ
- Snapshot ID: `CE0-HIL-CONTRACT-SNAPSHOT-2026-04-16-v1`
- Version: `1.0.0`
- Hash (sha256): `851849b770825eb4844d46c77bae34bbefb4aec1ae9bd004e7dc4d50b875a698`

## Stream B Contract Vocabulary Sync Note（2026-04-17）

本書で扱うCE0/CE1/CE2の契約語彙は、次のとおりに固定する。

- CE0: `safeMode` の後退の禁止 / Consensusへの直接書き込みの禁止 / auto-applyの禁止
- CE1: `ContextQuery` / `ContextBundle` / `queryCanonicalHash` / `bundleHash` / `previewConfirmed`
- CE2: `proposal-only` / `proposalId` / `diff` / `sourceBundleHash` / `status` / `reviewState` / `held`

上の語彙について、意味の変更・列挙値の変更・安全境界の変更は、本書だけでは行わず、Issue契約（CE0/CE1/CE2）でCDCの承認を得た後に同期する。


## CE1 contract freeze sync note（2026-05-06 / Stream B）

- `ContextQueryV1` / `ContextBundleV1` の必須キーと意味論は、v1の凍結を維持する。
- IR生成の前提のゲートとして、`previewConfirmed=true` を必須とし、違反は `422 preview_required` とする。
- 未知のキーは `400 unknown_contract_key`、hashの非決定性は `409 nondeterministic_bundle` として、安全側で拒否する状態を維持する。
- 同じ正準queryを3回実行して、`queryCanonicalHash` / `bundleHash` が3/3一致することの検証を、mock-firstの基準とする。

## CE1 contract-freeze note（2026-05-07 / Stream B）

- 本仕様は、CE1の `ContextQueryV1` / `ContextBundleV1` を、**contract-only / mock-first** の境界として参照する。
- IRの生成は、Query Previewの完了後にだけ許可し、`previewConfirmed=false` は `422 preview_required` で停止する。
- v1はclosed-worldとし、未定義のキーは `400 unknown_contract_key` とする。
- 同じ正準queryに対して、`queryCanonicalHash` / `bundleHash` が一致しない場合は、`409 nondeterministic_bundle` として安全側で拒否する。
- 本節は実装方式を拘束せず、契約の語彙と検証条件だけを固定する。

## CE0 Contract Matrix Freeze（CTX / SAFEMODE / REVIEW）

本節は、CE0の契約行列を、IR仕様の上で凍結する。実装の進捗に依存せず、後退できない契約の境界として扱う。

| 契約ID | 領域 | 凍結する規則 | 回帰の確認 |
| --- | --- | --- | --- |
| `CE0-CTX-IF` | CTX | `ContextQuery/ContextBundle` は、プレビューのゲート (`previewConfirmed=true`) を満たした場合にだけ、IRの生成を許可する。 | `previewConfirmed=false` は常に `422 preview_required`。 |
| `CE0-SAFEMODE-IF` | SAFEMODE | safeModeの既定を `ON`（`meta.safe_mode=true`）として必須とし、`reviewFilter=reviewedOnly` を既定の境界として保持する。 | safeModeがOFFの入力、未レビューの混入、既定値の緩和は、安全側で拒否する。 |
| `CE0-REVIEW-IF` | REVIEW | `reviewState` は `unreviewed | human_reviewed` のみ。AIによる自動昇格を禁止する。 | `unreviewed -> human_reviewed` が、人の操作以外の経路で発生したら失敗とする。 |

### Consensus Graph write boundary（CE0-CG-WRITE-IF）

- `ConsensusGraph` への直接書き込みは禁止する。
- AI/worker/APIは、proposalを生成しても、適用は `patch + approval` だけを許可する。
- 品質ゲートの実行中に、直接書き込みの経路を1件でも検知した場合は、検証をただちに停止する。

### Freeze invariants

1. Contract IDの追加・改名・削除は禁止する（重複した定義は0を維持する）。
2. safeModeの既定ON、未レビューの保護、Consensus Graphの直接書き込みの禁止という3点は、同時に成立することが必須である。
3. 本節で扱う契約は、CE1以降の実装の進捗に依存せず、読み取り専用の参照で運用する。

## Stream B Bridge Freeze Note（2026-05-17）

- IRを接続するときも、CE1 v1 closed-worldを維持し、未定義のキーの受理を禁止する。
- 失敗の語彙は、`preview_required` / `unknown_contract_key` / `nondeterministic_bundle` の3種に固定する。
- A2では、`stubDatasetId=A2-minimal-v1` を唯一の検証データセットとし、実DB・実LLM・workerの経路を無効にする。
- Verifyでは、`queryCanonicalHash` / `bundleHash` の3/3一致を必須とし、自己修復の上限は3回とする。
- Proceedは、CE2/CE4への読み取り専用の引き渡しだけを許可する。

## CE1 Stream C sync note（2026-05-17 / I/F-first mock-first）

- Phaseを開始するたびに、`issue-CE1-context-query-bundle-foundation.md` / `schemas.md` / 本書を再度読み込み、契約のドリフトを禁止する。
- `ContextQueryV1` / `ContextBundleV1` は、v1 closed-worldのまま固定し、未定義のキーを受理しない（`400 unknown_contract_key`）。
- 往復の検証は、`stubDatasetId=A2-minimal-v1` に固定して行い、同じ正準queryを3回実行して、`queryCanonicalHash` と `bundleHash` の3/3一致を必須とする。
- `previewConfirmed=false` は、IR生成を開始する前に、必ず `422 preview_required` として安全側で拒否する。
- CE2/CE4への引き渡しは、読み取り専用とし（`sourceBundleHash === bundleHash` を検証できる最小のキーだけ）、CE1側で実装への依存を追加することを禁止する。


## Stream B contract lock addendum（2026-05-18 / CE1-independent）

### Context
CE2/CE4の進行を、CE1の実装の完了待ちにしないため、IRの境界で、ContextQuery/ContextBundle契約の不変条件を固定する。

### Decision
1. **スキーマとバージョン管理の固定**
   - `ContextQueryV1` / `ContextBundleV1` は、closed-worldとする。
   - v1では、未知のキーを拒否する（`400 unknown_contract_key`）。
   - 契約の変更は、v2の改訂でのみ許可する。
2. **切り詰めの境界の固定**
   - 切り詰めは、IR payload（`LLMRequest.inputs`）の内側でのみ許可する。
   - Query/Bundleの正準化の結果（`queryCanonicalHash` / `bundleHash`）を変化させる切り詰めを、禁止する。
3. **フォールバックの固定（安全側で拒否）**
   - `previewConfirmed!=true` は、`422 preview_required` で即座に失敗とする。
   - 正準queryが同値なのにhashが不一致の場合は、`409 nondeterministic_bundle` とする。
4. **モック/契約テストの固定**
   - `stubDatasetId=A2-minimal-v1` を、CE1検証の唯一のプロファイルとして固定する。

### Consequences
- IRの実装は、CE1契約に依存しつつも、バックエンドの実装に依存せずに検証できる。
- 下流は、hashの監査キーを、不変の前提として再利用できる。
- 契約が衝突したときは、実装を続けず、`held` で停止することが必須となる。


## Stream B CE1 contract freeze addendum（2026-05-20 / Context-Decision-Consequences）

### Context
CE1 v1のqueryとバンドルの契約が揺れると、IR生成の境界で、CE2/CE4の監査の再現性が崩れる。

### Decision
- `ContextQueryV1` / `ContextBundleV1` は、closed-worldのv1として維持する。
- 固定するエラーの語彙を、`preview_required` / `unknown_contract_key` / `nondeterministic_bundle` の3種に限定する。
- Verifyは、`Plan -> Execute -> Verify -> Proceed` の直列の順序を固定し、Verifyが失敗したときの自己修復は、最大3回までとする。

### Consequences
- IR仕様は、プロバイダの差分や実装の進捗とは独立に、contract-firstで検証できる。
- 競合（契約IDの衝突、語彙の衝突）を検知したときは、安全側で拒否して停止できる。
