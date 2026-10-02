# ADR-0069: LLM投入IRをAI入力の実経路とする（座標・関係語彙・島階層の決着を含む）

- Status: Accepted（2026-08-29、D1=B・D3=A・D4=A仮承認。D2は2026-08-13に別途採択済み。2026-09-03にD5=Aを追補し、generic Document IRとtask-local structured inputの適用境界を明確化）
- Date: 2026-08-09
- Deciders: Project Maintainers
- Scope: `03_Implement/backend/src/sui_sensemaking_api/routes/ai.py`, `03_Implement/backend/src/sui_sensemaking_api/models_context.py`, `03_Implement/frontend/src/domain/island_edge_aggregate.ts`, `03_Implement/frontend/src/export/abstract_map_export.ts`, `02_Architecture/llm_input_ir_spec.md`

## Context

### 発端

KJ法キャンバスの人間・生成AI協働において、座標が意味を持つのは人間側であり、AIにとって意味を持つのはカード・島のあいだの論理的関係である。この非対称性をキャンバスの階層構造の設計へ反映すべきではないか、という問題提起があった。

調査の結果、問いの立て方が変わった。詳細な実測は `02_Architecture/canvas-projection-asymmetry-2026-08-09.html` に記録する。本ADRはそこで挙げた候補C1に対応する。

### 実測された現状

(1) AIは論理構造をほとんど受け取っていない。 `routes/ai.py` の全プロンプト構築関数（9件）を走査した結果、`edges` を渡す関数は1件も存在しない。`evidenceLinks` / `relationSummaries` / `claimType` / `parentIslandId` / `placardCardId` も同様。ADR-0048 D3で固定した関係語彙（`related`/`negate`/`causal`/`mutual`/`equivalence`）はAIに一度も届いていない。

具体的な帰結は次のとおりです。

- `POST /ai/detect-contradiction`（`ai.py:746-752`）は2枚のカードの `text` のみを受け取る。`EvidenceLink.type="contradicts"` も `contradictionState`（`unconfirmed`/`confirmed`/`held`/`resolved`）も渡らないため、人間が確定・保留済みの矛盾を再提示しうる。
- `POST /ai/suggest-card-groups`（`ai.py:725-731`）は `id` と `text` の平坦なリストのみ。既存の島・階層・`holdState` を見ずに提案する。
- `POST /ai/generate-narrative` は `readingOrder` を渡すが `edges` を渡さない。叙述の骨格である因果・対立が使えない。

(2) 座標は1件のみ、ただし生の絶対座標。 `_build_prompt`（`ai.py:317-324`、suggest-layout）のみが `x`/`y` を渡す。出力が座標である以上これ自体は妥当だが、島についても `cardIds` のカード座標から `bounds`/`anchor` を算出して渡しており（`ai.py:326-336`）、島を関係の集合ではなく矩形として提示している。

(3) 設計済みの投影層が4つあり、AI経路はそのすべてを迂回している。

| 投影層 | 状態 | AI入力での使用 |
|---|---|---|
| `getDerivedIslandEdges()`（`island_edge_aggregate.ts:78`） | 実装済み・呼出5箇所 | 未使用 |
| `buildAbstractMapExport()`（`abstract_map_export.ts`） | 実装済み・座標参照ゼロ・SafeMode実装済み | 未使用 |
| `ContextBundleResponse`（`models_context.py:89`、`CE0-CTX-IF`） | stub のみ（`build_bundle()` が `_STUB_DATASET` を返す） | 未接続 |
| **`LLMRequest.inputs` IR**（`llm_input_ir_spec.md` §4） | **凍結仕様・実装ゼロ** | **なし** |

`ir_version` / `graph_summary` / `cluster_candidates` は `03_Implement` 配下に1件も出現しない。

### なぜ今この判断が必要か

4層目の存在が問題の性質を変える。`llm_input_ir_spec.md` は「LLMへ渡す前段データ」の正本であり、`ADR-0009`（Accepted）Phase Bを完了させる凍結仕様である。そこには既に、構造的観測（`graph_summary`: 中心性・連結成分・矛盾サブグラフ）、論理由来と空間由来のクラスタ区別（`cluster_candidates.basis`）、SafeModeの入力側強制（`constraints.safe_mode: const true`、§7.1で違反時はIR生成失敗）、決定論的切り詰め、PII最小化が設計されている。

つまり本件は「新しい投影層を作るべきか」ではなく、「凍結済みの設計が実装されないまま、別経路が出荷された」状態をどう解消するかである。放置するほど `routes/ai.py` の直渡し経路にエンドポイントが積み上がる。実際2026-08-09のコミット `2aeb23d9` は、この経路を前提とした7フェーズのデモ（`kj_canvas_demo.py`）を追加している。

### 決着が必要な論点

IRは本問題提起に既に答えを出しているが、その答えは提起とは異なる。以下は曖昧にしたまま実装へ進めない。

論点1: 座標。 IRは `coordinates` を必須としつつ（§4.1）、重心を原点へ平行移動し `radius`/`angle_deg` を併記する正規化を課す（§2.2）。すなわち「絶対位置は情報ではないが、相対布置は情報である」という立場を取る。これは問題提起の「原則渡さない」とも、現状の「生の絶対座標」とも異なる第三の立場である。

論点2: 関係語彙のドリフト。 二つの凍結契約が食い違っている。

| 契約 | 列挙値 | 出典 |
|---|---|---|
| キャンバス（TS） | `related` / `negate` / `causal` / `mutual` / `equivalence` | `types.ts:78`、ADR-0048 D3 |
| バックエンド（Py） | 同上 ＋ `unknown` | `models.py:605` |
| **LLM投入IR** | `related` / `arrow` / `negation` | `llm_input_ir_spec.md` §2.3 / §4.2 |

`arrow` はキャンバス語彙に存在せず、`negation` は `negate` と綴りが異なり、`causal`/`mutual`/`equivalence` はIRに対応値を持たない。IRは3値への非可逆な正規化を行うことになるが、写像表は仕様に存在しない。

論点3: IRに島階層が存在しない。 IRのスキーマに `islands` はない。あるのは `cluster_candidates`（AIへの候補提示）であって、人間が確定させた島ではない。`parentIslandId` による入れ子も `placardCardId` による表札も表現できない。IRはカードグラフのIRであって、キャンバス階層のIRではない。問題提起の「階層構造の設計上意識する必要がある」は、まさにここに当たる。

論点4: 投影の実装場所。 既存投影はTypeScriptにある。サーバ側で投影するならPython実装が要り、TS↔Pythonの第2の契約ドリフト源になる（`test_ts_python_contract_drift.py` の対象）。

### ADR-0047 ゲート判定

R-3（非機能境界の超過）に該当すると判断する。 `ADR-0009`（Accepted）の凍結仕様と出荷実装が乖離しており、`ADR-0041` のCVI群のうち入力側の保証（CVI-2 proposal-onlyの前提となる入力健全性、SafeMode保護）が、契約ではなくフロントエンド実装のみに依存している。

R-1（実使用の摩擦）ではない。 本件はコード監査から出ており、ドッグフードや実利用で観測された摩擦ではない。`ADR-0067` / `ADR-0068` と同じ性質である。

## Decision

凍結仕様 `llm_input_ir_spec.md` をAI入力の実経路とし、その適用にあたって以下D1〜D4を決する。

> 以下の推奨は起票者の見解であり、採択は保守者が行う。実装は採択後の決定に従うこと。

### D1: 座標の扱い

| 案 | 内容 | 評価 |
|---|---|---|
| A | IR §2.2 の正規化座標を**必須のまま**維持（現仕様どおり） | 仕様変更ゼロ。ただし関係だけで足りるエンドポイントにも座標を強制し、問題提起の懸念が残る |
| **B（推奨）** | `coordinates` を**任意**へ緩和し、エンドポイントごとに要否を宣言する | `suggest-layout` は「要る」と宣言、`detect-contradiction` は宣言しない。用途に即し、かつ渡す場合は §2.2 の正規化を必ず経る |
| C | `suggest-layout` 以外では完全に除去 | 最も保守的。ただし将来「空間的まとまりの気づき」を扱う余地を閉じる |

推奨はB。 問題提起が拒否しているのは「AIに配置を解釈させること」であり、IRは `cluster_candidates.basis="spatial"` によって空間由来を明示ラベル付けすることで、その暗黙化を既に防いでいる。Bなら「相対布置を渡すか否か」をエンドポイント単位で明示的に選べる。

**決定（2026-08-29・仮承認）**: D1=Bを採択。`coordinates` を任意フィールドへ緩和し、`suggest-layout` は要求、他エンドポイント（`detect-contradiction`/`suggest-card-groups`/`generate-narrative`）は非要求とする。実装時にエンドポイントごとの要否表を `llm_input_ir_spec.md` へ明記する。

### D2: 関係語彙の写像

| 案 | 内容 | 評価 |
|---|---|---|
| **A（推奨）** | IR の `relations.type` をキャンバス語彙5値へ拡張する | キャンバス語彙は人間が確定させた言語化そのものであり、これを潰すと本ADRの目的（論理関係をAIへ届ける）が達成できない |
| B | 3値を維持し、写像表を仕様へ明記する（非可逆であることを含めて） | 仕様変更が小さい。ただし `causal` を `arrow` へ潰すと叙述の骨格が失われ、上記(1)の問題が IR 経由で再発する |
| C | `type`（3値）と `type_source`（原語彙）を併記する | 後方互換だが冗長で、消費側がどちらを見るべきか曖昧になる |

推奨はA。 あわせて `unknown`（`models.py:605`）の扱いを決めること。

**決定（2026-08-13・仮承認）**: D2=Aを採択。`llm_input_ir_spec.md` の `relations.type` をキャンバス5値 `related | negate | causal | mutual | equivalence` へ統一（`arrow`→`causal`、`negation`→`negate`）。`unknown` はIRに含めない（未分類は構造値として意味を持たない）。逆方向（IR→キャンバス）写像は行わない。

### D3: 島階層の表現

| 案 | 内容 | 評価 |
|---|---|---|
| **A（推奨）** | IR に `islands`（人間が確定させたもの）を追加し、`cluster_candidates`（AIへの候補）と**型として分ける** | CVI-2（proposal-only）/ CVI-3（人手レビュー昇格のみ）と一致する。`AbstractMapExportIsland` が既にこの形を持つ |
| B | `cluster_candidates` に `confirmed: boolean` を足す | 変更は小さいが、確定済みの島と機械が出した候補が同じ型に同居し、消費側が取り違えうる |
| C | 階層は渡さない（現状維持） | 問題提起の中心（階層構造）に答えない |

推奨はA。 追加する `islands` には最低限 `id` / `card_ids` / `title` / `placard_card_id` / `parent_island_id` / レビュー状態を含めること。

**決定（2026-08-29・仮承認）**: D3=Aを採択。ただし実装は下記「前提条件」節の解消（`DOMAIN-ISLAND-MEMBERSHIP-01`）を先行させること。

### D4: 投影の実装場所

| 案 | 内容 | 評価 |
|---|---|---|
| **A（推奨）** | サーバ（Python）で IR を構築し、TS 既存実装との同値性をテストで固定する | SafeMode をサーバ側で強制できる（下記 ADR-0068 との関係を参照）。ドリフトは `test_ts_python_contract_drift.py` の拡張で管理する |
| B | フロントエンドが IR を組み立てて送る | **推奨しない。** サーバがクライアント構築の投影を信頼することになり、`SEC-AI-SAFEMODE-01` が指摘した迂回経路をそのまま残す |
| C | 投影ロジックを Python へ一本化し TS 側を削除する | 描画・export がサーバ往復を要することになり、ローカルファースト（`architecture.html`）に反する |

推奨はA。

**決定（2026-08-29・仮承認）**: D4=Aを採択。サーバ側（Python）にIRビルダーを実装し、`test_ts_python_contract_drift.py` の対象へ投影ロジックを追加する。

### D5: generic Document IR と task-local structured input の適用境界

Stage 5の棚卸しで、残存経路には次の3種類が混在することが分かった。

1. `DocumentV1` 由来の構造そのものをAIの判断材料にする経路。
2. `DocumentV1` は受け取るが、呼出側がAIへ渡してよいgrounding集合を先に限定している経路。
3. Documentを受け取らず、単一本文や選択済みの概要情報だけを扱う経路。

ここで「すべての `/ai/*` をgeneric Document IRへ通す」ことを目的化すると、2ではgrounding境界を広げ、3では架空IDや疑似Documentを作る逆効果が生じる。したがって、AI入力を構造化された実経路へ揃えるという原則と、`llm_input_ir_spec.md` のgeneric Document IRを使う条件を分けて決める。

| 案 | 内容 | 評価 |
|---|---|---|
| **A（採択）** | AI入力の構造化・実経路化は全AI経路に要求するが、generic Document IRはDocument由来の構造を仕事上必要とする経路に適用する。限定grounding/no-doc経路はtask-local structured inputを正式な入力契約として認める | 仕事上の意味と安全境界を保ったまま、IR利用そのものを目的化しない |
| B | すべてのAI経路をgeneric Document IRへ統一する | 形式は揃うが、限定groundingを広げたり、no-doc経路へ虚偽の識別子を作る必要が生じる |
| C | 各経路を個別実装のままにし、共通原則を置かない | 実入力の迂回やSafeMode・最小化のばらつきを再び許す |

**決定（2026-09-03・追補）**: D5=Aを採択。以下を不変条件とする。

- **Document-backed structured task**: 文書のカード・島・relation・evidenceなど、`DocumentV1` 由来の構造が仕事上の判断材料になる経路は、generic Document IRまたはそのroute固有投影をprovider実入力の正本とする。Document生値から同じ意味をpromptへ迂回させない。
- **Caller-limited grounding task**: 呼出側が `groundingCardIds` / `groundingEdgeIds` などで許可集合を明示する経路では、そのallowlistを安全境界の正本とする。generic Document IRを検査・正規化に併用してもよいが、最終promptや `LLMRequest.inputs` の実効意味集合をallowlistより広げてはならない。
- **No-document task**: Documentや実在IDを持たない経路では、generic Document IRへ合わせるための疑似Document・架空カードID・架空島IDを作らない。明示的なtask-local structured inputを正式なAI入力契約とし、provider promptはその構造化入力から描画する。
- **共通の安全境界**: generic Document IRを使わない経路も、レビュー状態、SafeMode、PII最小化、structured-text-only、決定論的な入力上限など、その入力型に適用可能な境界保護から免除されない。必要な保護はAPI境界またはtask-local入力ビルダーでfail-closedにする。
- **契約変更時の再判定**: no-doc経路が将来 `DocumentV1` を受け取る仕事へ変わる場合は、既存の例外を暗黙に継承せず、request契約の変更時点でgeneric Document IR適用を再判定する。
- **完了指標**: 11/11をgeneric Document IRへ揃えること自体を完了条件にしない。各AI経路について「何がproviderの実入力正本か」「何を送らないか」「どの境界でfail-closedにするか」が明示され、promptがその契約を迂回しないことを完了条件とする。

この追補により、`summarize-island-relation` はcaller-limited grounding task、`refine-card-text` と `suggest-document-title` はno-document taskとして扱う。これらは「未移行だから放置する経路」ではなく、generic Document IRを適用しないこと自体が意味保存のための明示的な設計判断である。

### 仕様バージョンについて

IRスキーマは `ir_version: {"const": "1.0"}` かつ `additionalProperties: false` で固定されている。D1〜D3のいずれを採ってもスキーマ変更を伴うため `ir_version` の繰り上げが必要である。採択時に新版数を決めること。

### 非目標

- LLM出力スキーマ（`LLMRequest.output_schema`）の設計。IR §0.2の非目標を引き継ぐ。
- Provider transportの選定。同上。
- `POST /ai/assess-card-importance` の採点と `DOM-AI-07`（`00_Prompt/domain.md` §7「カード品質を点数・順位・合否で評価する」の禁止。主体を問わない上位規定は `DOM-CORE-04`）の抵触。`issue-AI-IMPORTANCE-SCORING-01` で採点APIを廃止して解消済み。本ADRが将来提供する`graph_summary`は、順位や等級を持たない構造的観測（中心性・連結成分・矛盾サブグラフ）に限定する。
- IRの上限値（`MAX_CARDS=200` / `MAX_RELATIONS=400` / `MAX_TEXT_CHARS=12000`、§5.1）が現行規模に妥当かの再検討。実装時に代表規模で計測し、必要なら別途起票する。

## Stage 5での適用範囲（2026-09-03追補）

Stage 5で残存経路を棚卸しした結果、本ADRの「IRをAI入力の実経路とする」は、**すべての `/ai/*` を機械的にDocument IRへ通すという意味ではないことを明確にする。正本にするべきなのは、その仕事に対して人間または呼出側が確定した構造化入力契約**であり、Document IRはそのうち `DocumentV1` 由来の構造意味を扱うための契約である。

適用境界を次のように固定する。

1. Document-backedで、Documentのカード・島・relation・evidence等が仕事上の意味になる経路
   - `llm_input_ir_spec.md` のDocument IRを実入力経路とする。
   - route-required meaningを保護し、必要意味が投影上限で欠ける場合はprovider呼出前にfail-closedにする。
   - provider transportがpromptのみを送る場合も、IRで正規化・保護した本文や構造をpromptへ描画し、Document生値を同じ意味入力へ迂回させない。

2. Document-backedだが、呼出側がgrounding集合を明示的に限定している経路
   - 限定groundingはDocument全体より強い入力境界として扱う。generic Document IRを使うことで許可集合を広げてはならない。
   - `summarize-island-relation` はこの型である。現行requestは `groundingCardIds` / `groundingEdgeIds` と、それに対応する `cardTexts` / `edgeTexts` を明示し、応答側も同じallowlistの部分集合だけを許可している。
   - 将来IRを併用する場合はhybridとし、IRはSafeMode・関係語彙・参照整合等の検査に利用してよいが、providerへ渡す内容は呼出側が許可したgrounding集合から広げない。永続edge IDとIR relation ID（`type:from:to`）は別物なので、暗黙に置換しない。
   - 現時点では、構造上の具体的な欠落が観測されていないため、IR使用率を上げる目的だけの改修は行わない。

3. Documentを入力契約に持たないtask-local変換経路
   - `refine-card-text` と `suggest-document-title` はDocument IRの適用外とする。
   - IRを使うためだけに疑似Document、架空card ID、架空islandを生成しない。追跡可能性のための識別子へ虚偽の由来を持ち込む方が、本ADRの目的に反する。
   - Pydantic request、入力上限、route側SafeMode、model governance等からなるtask-local structured inputを、その経路の実入力契約として維持する。
   - 複数のno-doc経路で共通の入力ガバナンス不足が実際に観測された場合に限り、Document IRとは別の共通envelopeを検討する。現時点では新しい抽象層を先回りして作らない。

4. 件数は完了指標にしない
   - 「11経路中何件がDocument IRを持つか」は移行状況の説明には使えるが、品質KPIや完了条件にはしない。
   - 明示的な限定grounding契約やno-doc task-local契約を、形式上の11/11達成のためにDocument IRへ偽装しない。

したがってStage 5以降の「AI入力の実経路」は、そのrouteで採択された構造化入力契約からprovider-bound contentを描画し、その契約を生入力が迂回しないことを共通原則とする。Document IRは重要な実装だが、唯一の入力表現ではない。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | KJ法キャンバスでは座標が意味を持つのは人間側で、AIにとって意味を持つのはカード・島の論理的関係。この非対称性を踏まえ、AIは論理構造（関係語彙・島階層・holdState）を実際に受け取る必要がある | 機能: `routes/ai.py`の全プロンプト構築関数で`edges`/`evidenceLinks`/`relationSummaries`/`claimType`/`parentIslandId`を渡す。データ: 関係語彙（related/negate/causal/mutual/equivalence）をAIへ届ける |
| **データ設計** | 凍結済みの`LLMRequest.inputs` IR（llm_input_ir_spec.md §4）をAI入力の実経路とする。`graph_summary`（中心性・連結成分・矛盾サブグラフ）は順位や等級を持たない構造的観測に限定。SafeModeの入力側強制（constraints.safe_mode）とPII最小化をサーバ側契約へ | 業務: 矛盾検出が既存`evidenceLinks`を、グルーピング提案が既存の島を見る。機能: 決定論的切り詰め（MAX_CARDS=200/MAX_RELATIONS=400/MAX_TEXT_CHARS=12000）で大規模文書のAI入力を再現可能にする |
| **機能設計** | Document由来の構造を扱うAI経路はgeneric Document IRを実入力へ接続する。caller-limited grounding/no-doc経路はtask-local structured inputを正式契約とし、provider promptがその構造化入力を迂回しないようにする | 業務: 経路ごとの仕事に必要な意味と許可範囲を先に固定する。データ: 座標は必要な経路だけに限定し、限定groundingやno-doc入力をgeneric IRの都合で広げない |

## Consequences

### 期待される効果

- ADR-0048 D3で固定した関係語彙が、はじめてAIへ届く。矛盾検出が既存の `evidenceLinks` を、グルーピング提案が既存の島を見るようになる。
- SafeModeの入力側保護が、フロントエンド実装依存からサーバ側の契約へ移る（IR §7.1）。
- PII最小化（IR §7.2）と構造化テキスト限定（§7.3）が、現在は存在しない防御として入る。
- 決定論的な切り詰め（§5）により、大規模文書でのAI入力が再現可能になる。
- `graph_summary` により、採点によらない構造的観測が可能になる。

### 想定される副作用・制約

- TS↔Pythonの第2のドリフト源が生まれる（D4=Aの代償）。`test_ts_python_contract_drift.py` の対象を投影ロジックへ拡張して管理する。
- 入力トークン量が変わる。関係・階層・`graph_summary` が増える一方、生座標が減る。差し引きは未計測であり、実装時に代表規模（カード300・島30程度）で測ること。
- `ir_version` の繰り上げが必要（上述）。`llm_input_ir_spec.md` §8のトレーサビリティとFixtureProvider回帰データ（§6）の再生成を伴う。
- generic Document IRの対象となる既存AI経路では呼び出し側やprompt構築の改修が要る。task-local structured inputを採る経路では、既存の限定入力を広げず、実際にproviderへ送る内容との一致を回帰で固定する必要がある。

### ADR-0068 との関係（重要）

**更新（2026-08-29）**: 本節起票時点では `ADR-0068` はProposedだったが、その後Acceptedとなり、実装issue `issue-SEC-AI-SAFEMODE-01`（Done）が `_reject_unreviewed_cards`/`_reject_unreviewed_text` を `detect-contradiction` を含む対象ルートへ既に配線済みである（コードで確認済み）。同issue自身が当時「短期のSafeMode強制はADR-0068を採択して `/ai/*` に適用し、ADR-0069/IRは別途進める併用が現実的」と記録しており、吸収ではなく併用（defense-in-depth）が既定路線として先に実現している。

`ADR-0068`（SafeMode enforcement at API boundary、Accepted・実装済み）と本ADRは同じ境界を対象とするが、既存の `_reject_unreviewed_cards`/`_reject_unreviewed_text` を本ADRの実装が除去・弱化してはならない。本ADR D4=A（IR §7.1による `safe_mode` 強制）は、既存の境界保護に追加する第二層として実装すること（唯一の防御手段として置き換えない）。

- `ADR-0068` は `/ai/*` の各リクエストモデルへ `safeMode` を追加する方向（実装済み）。
- 本ADR D4=Aは、IR構築をサーバ側へ置き、IR §7.1が `safe_mode` を強制する方向（追加の防御層）。

将来的にすべてのAI経路がgeneric Document IRまたは明示的なtask-local structured inputの実経路で覆われた段階で、`ADR-0068` 由来のAPI境界実装を退役させるかどうかは別途判断する。本ADRの実装時点では二層防御を維持する。

### 移行時に必要な対応

1. `llm_input_ir_spec.md` をD1〜D3の決定に従って改訂し、`ir_version` を繰り上げる。
2. サーバ側にIRビルダーを実装する（D4=Aの場合）。
3. 各AI経路をD5の3分類へ当てはめる。Document由来の構造を扱う経路はgeneric Document IRへ、caller-limited grounding/no-doc経路は明示的なtask-local structured inputへ揃える。いずれもprovider promptが宣言済み入力契約を迂回しないことを回帰で固定する。
4. `test_ts_python_contract_drift.py` を投影ロジックへ拡張する。
5. `02_Architecture/api.md` のリクエスト契約を同期する。

### 前提条件

`02_Architecture/functional-dependency-integrity-2026-08-06.html` の F-5「島所属の関数従属性が強制されていない」が未解消である。カード→島の所属が一意に定まらない状態では、`islands` を含むIRの構築結果が一意にならない。本ADRの実装前にF-5を解消するか、投影側で一意化規則（先勝ち・後勝ち・全列挙のいずれか）を明示すること。

**決定（2026-08-29）**: 書込み側のドラッグ&ドロップ経路は既に単一所属を強制済み（`island_edge_aggregate.ts` `moveCardToIsland()`）と確認したが、統合（canonicalization）経路（`canonical_ops.ts` `updateIslands()`）は跨島マージ時に重複所属を生成しうることを新たに確認した（`issue-DOMAIN-ISLAND-MEMBERSHIP-01`）。同issueが追加する助言的診断が実運用データでの発生頻度を計測するまでの暫定の一意化規則として「先勝ち」（`getIslandsForCard()`/`islands.find()` が既に実装している、配列先頭から見て最初に一致した島を採用する）を採用する。IRビルダー（D4=A）は、複数島に同時出現するカードについてこの規則で単一の `island_id` を選ぶこと。`issue-DOMAIN-ISLAND-MEMBERSHIP-01` のAC-1〜2が完了するまで、本ADRの `islands` 実装（D3）には着手しない。

## Traceability

- Related: `02_Architecture/canvas-projection-asymmetry-2026-08-09.html`（本ADRの根拠となる実測と分析）
- Related: `02_Architecture/llm_input_ir_spec.md`（改訂対象の正本）
- Related: `01_Plans/adr/ADR-0009-local-llm-integration.md`（Phase Bの完了宣言元）
- Related: `01_Plans/adr/ADR-0048-visual-language-command-reach-and-kj-vocabulary.md`（D3で関係語彙を固定）
- Related: `01_Plans/adr/ADR-0041-core-value-invariants-single-guard.md`（CVI-2 / CVI-3 / CVI-7）
- Related: `01_Plans/adr/ADR-0047-design-decision-adr-saturation-and-execution-first.md`（再起票ゲートR-3の判定根拠）
- Related: `01_Plans/adr/ADR-0068-safemode-enforcement-at-api-boundary.md`（境界が重複する。上記「ADR-0068との関係」を参照）
- Related: `01_Plans/issues/issue-AI-IR-PROJECTION-01-llm-input-ir-as-ai-input-path.md`（本ADR採択後の実装課題）
- Related: `01_Plans/issues/issue-AI-IR-STAGE5-SCOPE-01-classify-remaining-ai-input-paths.md`（D5追補の根拠となった経路棚卸し）
- Related: `01_Plans/issues/done/issue-AI-REL-VOCAB-DRIFT-01-ir-canvas-relation-type-mismatch.md`（D2で解決される事実の記録）
- Related: `01_Plans/issues/done/issue-AI-IMPORTANCE-SCORING-01-importance-rating-conflicts-with-no-scoring.md`（非目標として分離した課題）
- Related: `02_Architecture/functional-dependency-integrity-2026-08-06.html`（F-5 = 実装前提条件）
- Related: `01_Plans/issues/done/issue-DOMAIN-ISLAND-MEMBERSHIP-01-cross-island-cardid-duplicate-detection.md`（F-5前提条件の実装課題、Draft）

---
