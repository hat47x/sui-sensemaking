# ADR-0103: agent向け投影のカード・島に単位digestを加える

- Status: Accepted（仮承認）（2026-10-27）。仮決めの箇所は本文に「仮決め」と明記する。
- Date: 2026-10-27
- Deciders: Maintainer（仮承認。後日の本承認で §仮決め を確定する）
- Scope: `03_Implement/frontend/src/export/context_bundle_projection.ts`（MCPの `get_context_projection` が共有）、`02_Architecture/schemas.md`、`03_Implement/mcp/README.md`、`04_Documentation/mcp_agent_connection.md`
- Related: `ADR-0054`（外部接続層の段階導入）、`ADR-0056`（カード来歴メタデータの境界）、`ADR-0089`（価値の正本）、`ADR-0093`（agent資格情報と、許可リスト方式で絞った投影の読み取り）、`ADR-0094`（MCP HTTPのagent認証）、`ADR-0098`（人による自己申告と島の題名の扱い）、Issue #3266、TAI Pleroma issue #67

## 価値への寄与

V3「レビュー」に寄与する。人がレビューした内容を、外部の利用者（TAI Pleroma など）がカード・島の単位で版固定して参照し、人の編集後に再観測できるようになる。固定できるのは「その時点で人がレビューして露出した内容」だけであり、未レビューの内容を固定する経路は作らない。

次の不変条件は緩和しない。

- SafeModeは既定ONのままで、digestのために本文の露出を増やさない。
- AI出力は提案のみで、`human_reviewed`（`textReviewed`、`titleReviewed`）は人間だけが設定する。digestはこの値を読むだけで書かない。
- 伏せた内容から計算した値を、どの経路にも出さない。
- `SUI_LLM_PROVIDER=none` でも同じ値が得られる（digestは文書内容だけの純関数で、LLMを使わない）。

## Context

`get_context_projection`（`context-projection.v1`）は、投影全体のcanonical JSONから `bundleHash` を、文書のidと更新時刻から `baseDocSignature` を返す。どちらも投影全体または文書全体の版を表す。1枚のカードだけ、あるいは1つの島だけを版固定したい利用者は、無関係なカードの変更でも値が変わってしまうため、これらを使えない。

投影が露出する内容は限られている（許可リストはADR-0093 §6、題名の扱いはADR-0098）。

- カード本文は、`textReviewed` が真でSafeModeがOFFのときだけ返す。それ以外は長さだけを示すプレースホルダにする。
- 島の題名は、`titleReviewed` が真のときだけ、SafeModeのON/OFFによらず返す。それ以外は `(未レビュー)` にする。
- 未レビューのカードは、どの制約でも `cards` に現れない。
- 来歴（`Card.meta.source`、ADR-0056）と `evidenceLinks` の本体は、カードの項目としては投影しない。関係線は両端がレビュー済みのときだけ、端点のidの組として返す。

既存の実装はすでに、伏せた本文のハッシュを返さない方針を採っている（`context_bundle_projection.ts` の2026-07-13のゲート）。伏せた本文のハッシュは、短い本文なら推測と照合でき、繰り返し読み取る外部経路では相関の手掛かりにもなるためである。単位digestもこの方針を守る必要がある。

## Decision

露出した内容だけを入力とするsha256を、カードと島に1つずつ付ける。内容が露出していない項目のdigestは常に `null` とする。

### 1. 入力

digestの入力は、投影が実際に返した内容だけから作る。利用者は、受け取った項目からdigestを自分で再計算して確かめられる。

- カード: `{"schema":"context-projection.item-digest.v1","kind":"card","id":<カードid>,"text":<露出した本文>}`
- 島: `{"schema":"context-projection.item-digest.v1","kind":"island","id":<島id>,"title":<露出した題名>}`

シリアライズには、投影の `bundleHash` と同じ `canonicalizeJson`（キーを辞書順に並べた、空白なしのJSON）を使い、UTF-8のバイト列にsha256をかける。

### 2. 形式

`{"alg": "sha256", "value": "<小文字16進64桁>"}` とする。`alg` を持たせるのは、将来アルゴリズムを変えるときに、値の解釈を利用者が判別できるようにするためである。

投影の項目は次のとおり。

- `cards[].digest`: `ItemDigest | null`
- `islands[].digest`: `ItemDigest | null`

### 3. 内容が露出しない項目

- カードは、`redacted` が真（未レビュー、またはSafeMode ON）のとき `digest` を `null` にする。SafeModeがONのレビュー済みカードも `null` とする。本文を返さない状況でdigestだけを返すと、伏せた本文の推測と照合の手掛かりになるためである。この点は仮決め（後述）。
- 島は、`titleReviewed` が真で題名が文字列のときだけdigestを持つ。未レビューの題名と無題の島は `null` とする。
- `null` が示す情報は、既存の `redacted` と `(未レビュー)` がすでに示している情報を超えない。伏せた内容のdigestは、計算も保持もしない。

### 4. 安定性

digestが変わる条件は、入力の4つの値（種別、id、露出した本文または題名）のどれかが変わることだけである。

- 変わるもの: レビュー済みの本文または題名の編集。idの変更。
- 変わらないもの: カードの位置・大きさ・色などのレイアウト、`holdState`、`claimType`、関係線、`evidenceLinks`、`Card.meta.source`、島の所属カード、文書の `updatedAt`、他のカードや島の変更、投影の制約の種類（`reviewed-only`、`evidence` など）。
- 本文を編集して再びレビュー済みにした場合は、新しい本文の値になる。未レビューに戻した間は、そのカードは投影に現れないため、digestも現れない。
- `claimType` などを入力に含めない理由は、digestを「レビューされた文章」の版固定に絞るためである。これらの属性の変化を追う利用者は、投影の他の項目か `bundleHash` を併用する。

### 5. `bundleHash`、`baseDocSignature` との関係

- 3つは別の用途を持つ。単位digestは1項目の内容の版、`bundleHash` は投影1回分の全体の版、`baseDocSignature` は文書全体の更新時刻に基づく版である。
- 単位digestは `bundleHash` の入力に含めない。単位digestは、`bundleHash` がすでに含む露出済みの内容から決まるため、含めても情報が増えない。含めない結果、既存の `bundleHash` の値は変わらない（本PRで同じ文書を旧実装と新実装に通し、同一値であることを確認した）。
- 利用者は、`(docId, 項目id, digest)` の組を保持する。再観測では、同じ項目のdigestが一致するかを見る。

### 6. バージョニング

- 投影の `schemaVersion` は `context-projection.v1` のままとする。項目の追加だけで、既存の項目の意味と値は変わらない。
- 入力の形（上記の1）を変えるときは、入力の `schema` 文字列（`...item-digest.v1`）を上げ、`alg` またはdigest側の版の扱いを新しいADRで決める。同じ `schema` で入力の形を黙って変えない。

### 7. SafeModeとの関係

- 島のdigestは、SafeModeのON/OFFで同じ値になる（題名の露出がSafeModeに依存しないため、ADR-0098）。
- レビュー済みカードのdigestは、SafeMode OFFでのみ値を持ち、ONでは `null` とする。SafeMode OFFでの値は、実行のたびに同じ入力から同じ値になる。
- SafeModeの既定ON、`safeModePolicy` の扱い、露出の規則は変えない。

### 8. 保証しないこと

- 内容の真実性、正しさ、著者を保証しない。digestは「ある時点で人がレビューして露出した文字列」の同一性を確かめるだけである。
- 人の編集は、digestを変える。これが再観測の合図であり、変わらないことは本文が変わっていないことしか示さない。
- 人によるレビューの事実そのもの（誰がいつレビューしたか）は証明しない。`textReviewed` と `titleReviewed` は人間だけが設定する値であり、digestはその値を読むが、証跡ではない。
- 電子署名や改ざん検知の鍵を持たない。投影を受け取る経路の信頼は、ADR-0094のagent認証とTLSに依存する。

### 非目標

- カードの来歴（`Card.meta.source`）、`evidenceLinks` 本体、関係線、位置の版固定。
- 未レビューの内容、SafeMode ONで伏せた本文のdigest化。
- 鍵つきのHMACやSafeMode ON時に本文を伏せたままの版固定（利用者が検証できない値になり、本ADRの検証可能性を満たさない）。
- `DocumentV1` へのフィールド追加。digestは文書に保存せず、投影のたびに計算する。

### 仮決め

人の判断が要る箇所は、次のとおり仮に決めた。後日、変更してよい。

1. SafeMode ONのレビュー済みカードのdigestは `null` にする（SafeMode ONでも露出済みの島の題名と同じ扱いにはしない）。理由は、本文が非露出のまま値だけ返すと推測と照合の手掛かりになり、既存のハッシュ非露出の方針（2026-07-13のゲート）と衝突するため。この場合、SafeMode ONの標準構成では、カードの版固定を使えない。TAI Pleroma は、`safeMode: false` で露出した本文に対して固定するか、島の単位で固定する必要がある。
2. digestの入力に `claimType` を含めない。
3. `docId` を入力に含めない。複製した文書でもid・本文が同じなら同じ値になる。利用者は `docId` と組で保持する。
4. `alg` を持つ構造体にした（文字列ではなく）。

## Consequences

- 外部の利用者が、レビュー済みのカード・島を、周りの変更に左右されずに版固定して再観測できる。
- 既存の利用者への影響はない。追加フィールドだけで、`bundleHash` と他の項目は変わらない。`ProjectedCard` と `islands[]` の型を厳密に検査するコンシューマは、`digest` を許容する必要がある。
- SafeMode ONの標準構成ではカードのdigestが得られない。必要になれば、別ADRで「本文を露出しない版固定」（利用者が検証できない鍵つき値など）の是非を判断する。
- バックエンド（Python）、`DocumentV1`、`test_ts_python_contract_drift.py` の対象型には影響しない。投影はフロントエンドの共有モジュールが持つ。

## Traceability

- Related: `ADR-0054`、`ADR-0056`、`ADR-0089`、`ADR-0093`、`ADR-0094`、`ADR-0098`
- Issue: #3266
- 実装: `03_Implement/frontend/src/export/context_bundle_projection.ts`（`computeItemDigest`）、テストは同ディレクトリの `context_bundle_projection.test.ts`
