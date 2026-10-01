# Issue: AI-IR-STAGE5-SCOPE-01 Stage 5の残存AI経路を意味要件で分類する

> 個人OSS・プレリリース段階では `ADR-0039` を適用し、Issue本文は現在の実行に必要な情報へ絞る。実装履歴はGitとPRを正本とする。

- Type: Architecture / Investigation
- Status: In Progress
- Source Issue: `AI-IR-PROJECTION-01` Stage 5
- Priority: P1
- Owner: Maintainer
- Scope: `03_Implement/backend/src/sui_sensemaking_api/routes/ai.py`, `03_Implement/backend/src/sui_sensemaking_api/routes/ai_relations.py`, `03_Implement/backend/src/sui_sensemaking_api/models_ai.py`, `02_Architecture/llm_input_ir_spec.md`, `01_Plans/adr/ADR-0069-llm-input-ir-as-the-actual-ai-input-path.md`
- Related ADR/Spec: `AI-IR-PROJECTION-01`, `AI-IR-SCALE-01`, `AI-MERGE-SEMANTICS-01`, `01_Plans/adr/ADR-0069-llm-input-ir-as-the-actual-ai-input-path.md`
- Expected verification level: integration

## 現在地

Stage 5は当初、既存4経路をLLM入力IRへ移した後の「未移行7経路」を棚卸しするために起票した。その後の実装とADR-0069 D5=Aの整理により、現在は単純な未移行件数で管理する段階ではない。

現在の11経路は次のように整理できる。

- 共有Document IRまたはroute固有structured inputを使うDocument-backed経路: 7件。
- caller-limited / no-documentのtask-local structured inputとして境界確定した経路: 3件。
- 方式未確定: `check-narrative` 1件。文書全体を扱うため `AI-IR-SCALE-01` と結合している。

したがって、`summarize-island-relation`、`refine-card-text`、`suggest-document-title` をgeneric Document IRの「未移行残債」と数えない。疑似Documentや架空IDを作って形式的にIRへ寄せることもしない。

## Stage 5対象7経路の現在分類

| 経路 | 現在の境界 | 状態 |
| --- | --- | --- |
| `suggest-island-summary` | Document-backed。対象島の直接メンバーと必要relation/evidenceをroute固有必須集合として保護 | **移行済み** |
| `propose-opposing-viewpoint` | Document-backed。対象カードと直接接続するrelation/evidence、`contradictionState` を保護 | **移行済み** |
| `suggest-merges` | Document-backed。共有IRを基底にmerge固有文脈を重ねるroute固有structured input | **移行済み** |
| `summarize-island-relation` | caller-limited grounding。許可済みcard/edge集合を実効入力境界にする | **task-local境界確定** |
| `refine-card-text` | no-document。単一本文＋任意context | **task-local境界確定** |
| `suggest-document-title` | no-document。呼出側が選んだ島タイトル・本文サンプル | **task-local境界確定** |
| `check-narrative` | Document-backed。narrativeとA型図解を文書全体で往復照合 | **`AI-IR-SCALE-01` 待ち** |

## 各境界で守ること

### Document-backed経路

AIの仕事に必要な意味からrequired setを逆算する。IRに存在する全情報を全routeへ送ることを目的にしない。

- 必須カード本文はIR正規化後本文をprovider promptにも使い、生Document本文を同じ意味の迂回入力として送らない。
- 必須relation / evidence / hierarchyが投影上限で欠ける場合はfail-closedにする。
- SafeModeはroute側の一次検査とIR側の二次検査を維持する。
- 大規模文書で全件保持できない問題はroute個別に隠さず、`AI-IR-SCALE-01` へ戻す。

### caller-limited grounding

`summarize-island-relation` の `groundingCardIds` / `groundingEdgeIds` は安全境界である。generic IRを併用する場合も、このallowlistを理由なく広げない。

### no-document task

`refine-card-text` と `suggest-document-title` はDocumentを持たない。IR利用のためだけに架空card IDや疑似Documentを生成しない。task-local structured inputを正式契約として扱う。

## `suggest-merges` の同期

以前の本文には「merge意味論を決めてからIR移行する」「次は `suggest-merges`」という起票時の記述が残っていたが、現在のmainには合わない。

`AI-MERGE-SEMANTICS-01` で04ステップ型／核融合型の意味境界を先に定めた後、`suggest-merges` はroute固有structured inputへ移行済みである。hold、claimType、島文脈、relation/evidence、既存merge系譜、出典同一性を必要意味として扱い、不足時はfail-closedにする。

採用後の実merge、保存・再読込までの意味保存も別Issue `AI-MERGE-APPLY-01` で完了している。方式追跡性はR19で契約を確定し、R20で `mergeMethod` をprovider提案からDocument decisionまで通した。Stage 5固有の未完は引き続き `check-narrative` のscale境界だけである。

## `check-narrative` が最後に残る理由

`check-narrative` はnarrative本文、reading order、島・カード、論理関係を文書全体で往復照合する。局所required setへ縮約しやすい他routeと違い、300カード規模では「落とした要素を検出する」仕事そのものが全体被覆を要求しやすい。

そのため、固定 `MAX_CARDS` / `MAX_TEXT_CHARS` のまま無理に移行しない。`AI-IR-SCALE-01` で、必要意味を保持しながら大規模文書を扱う方式とtoken実測の境界が決まった後に実装する。

## 2026-09-04: `check-narrative` のtoken計測基準を追加

`AI-IR-SCALE-01` のR20ハーネスへ `check-narrative` を追加し、`suggest-layout` / `generate-narrative` / `check-narrative` を同じ300カード・30島の合成入力で比較できるようにした。

現行 `check-narrative` はIRを介さず全300カード・全30島をprovider promptへ載せており、dry-runでは末尾要素までcoverageが残ることを確認した。ただしpromptのUTF-8 byte数は171,426で、比較3ルートの中で最大だった。この値はtoken数ではない。named provider/modelの `usage` による正確な入力token実測が終わるまでは、全量方式が安全に収まるとも、分割が必要とも断定しない。

2026-09-04には、R20ハーネスをnamed providerへ実送信できるか確認するため、branch-onlyのGitHub Actions Run `33875031314` で `SUI_DEEPSEEK_API_KEY` の有無だけを検査した。secret値は取得・表示しておらず、結果は未設定だった。このため外部送信とprovider-reported usage取得は行っていない。byte数からtoken数を推定する代替も採らない。

したがって本Issueの未完境界は変わらない。`check-narrative` を形式的にgeneric IRへ移すのではなく、`AI-IR-SCALE-01` でnamed provider/modelの実token予算を確認し、A/B双方向の全体照合を失わない方式を選んだ後に実装する。

## 2026-09-05: `check-narrative` のA型relation欠落を別Issueで解消

`check-narrative` のprompt自体にA型図解の明示的relation（`causal`/`negate`/`mutual`/`equivalence`/`related`）が渡っていない欠落を、scale問題とは分離して `AI-IR-CHECK-NARRATIVE-RELATIONS-01` で解消した。全Card・全Island coverageは変更せず、`Relations:` 節を追加しただけであり、本Issueが指すscale投影方式（IR移行・分割・実token予算）の未完はそのまま残る。

## Dependencies

- `01_Plans/issues/issue-AI-IR-SCALE-01-preserve-large-round-evidence-under-token-budget.md`
  - `check-narrative` の全体照合を維持できるscale投影方式とnamed provider/modelの実token予算を確定する実証元。
  - `AI-IR-SCALE-01` の結果が出る前に、固定上限への切り捨てや形式的なIR移行で本Issueを完了扱いにしない。

## 2026-09-30: 無料枠モデルでの入力token実測（参考値）

`measure_ai_route_provider_tokens.py` を、OpenRouter無料枠の `nvidia/nemotron-3-super-120b-a12b:free`（context 262,144）で実行した。送信したのは300カード・30島の合成データだけである。provider報告の `usage.prompt_tokens` は次のとおり。

| route | 入力token（provider報告） | prompt UTF-8 bytes |
|---|---:|---:|
| suggest-card-groups | 14,934 | 38,044 |
| suggest-card-groups-route-b | 18,127 | 48,791 |
| generate-narrative | 66,622 | 89,331 |
| suggest-layout | 84,254 | 117,389 |
| suggest-layout-route-b | 90,388 | 128,562 |
| **check-narrative（現行・全量）** | **141,853**（再送3回で同値） | 198,092 |

- `check-narrative` は比較対象で最大で、このモデルのcontextの約54%を占める。全量方式はこの条件では収まったが、無料枠の単一モデルでの結果にすぎない。
- 無料枠は429・503（過負荷）が出やすい。初回測定では `check-narrative` が503となり、単発再送で取得した。`max_tokens=1` のため出力品質は測っていない。
- **方式（全量維持/分割）の決定には使わない。** 本番で使うnamed provider/modelの実測は未実施で、下記の未完条件は変わらない。判断材料として、全量方式の規模は約14万tokenである。

## 受入条件

- [x] Stage 5対象7経路を、Document-backed / caller-limited grounding / no-documentで分類した。
- [x] IRに存在する全情報を全経路へ送ることを目的にしないと明記した。
- [x] `suggest-island-summary` の必要意味をintegration regressionへ固定し、IRへ配線した。
- [x] `propose-opposing-viewpoint` の必要意味と既決 `contradictionState` を保護し、IRへ配線した。
- [x] `suggest-merges` の意味論を先に確定し、route固有structured inputへ移行した。
- [x] `summarize-island-relation` のgrounding allowlistをgeneric IR化で広げないと確定した。
- [x] no-document経路へ疑似Documentや架空IDを作らず、task-local structured inputを正式境界とした。
- [x] ADR-0069 D5=AへDocument IRの適用範囲を反映した。
- [ ] `check-narrative` のscale投影方式を `AI-IR-SCALE-01` の結果と整合させる。

## 完了境界

本Issueで未確定なのは `check-narrative` だけである。`AI-IR-SCALE-01` の結果が出るまで、形式的なIR移行や固定上限内への切り捨てを行わない。他6経路を再び「未移行」として数え直さない。
