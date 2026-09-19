# Issue: COGNITIVE-ASSOC-01 Affinity Semantic Fieldの深層意味近接PoCを行う

> 個人OSS・プレリリース段階では `ADR-0039` を適用し、実行に必要な情報だけを記載する。

- Type: Process
- Status: In Progress
- Source Issue: `COGNITIVE-EVAL-01`
- Priority: P1
- Owner: Maintainer
- Scope: `01_Plans/research/`, `01_Plans/dogfood/`, `01_Plans/issues/`, PoC用の非製品コード
- Related ADR/Spec: `ADR-0047`, `ADR-0046`, `ADR-0067`, `00_Prompt/domain.md`, `00_Prompt/sensemaking_technique.md`, `00_Prompt/cognitive_frame_and_evolution_criteria.md`, `00_Prompt/ai_sensemaking_execution_procedures.md`, `COGNITIVE-EVAL-01`, `COGNITIVE-DOGFOOD-01`
- Norms: `DOM-CORE-01`, `DOM-CORE-02`, `DOM-CORE-03`, `DOM-CORE-04`
- Expected verification level: docs-check + reproducible offline benchmark
- Working branch: `main`（作業branchは最新mainから切り、完了時にmainへ収束させる）
- Research record: `01_Plans/research/fly-inspired-affinity-semantic-field-research-2026-09-10.md`

`kj_*`を含む既存パスやworking branch名は技術識別子であり、本issueで用いる技法の一般名称ではない。

本issueは新ADRを起票しない。`ADR-0047`のexecution-first方針に従い先に実証し、永続状態、production API、provider、安全境界、性能予算等に新しい設計判断が必要になった場合のみR-1..R-4へ戻る。

## 1. 根幹の趣旨

sui-sensemakingが支援したいのは、カードを機械的に分類することではない。

人間がまだ名前を与えていない関係を見つけ、複数のカードを一緒に眺めたときに立ち上がる「訴え」を感じ取り、必要なら離し、保留し、残余を残しながら意味を組み上げていく探索を支援することである。

そのため、認知支援層には単なる語彙類似検索より深い能力が必要になる。一方で、その能力をLLMだけへ依存すると、常時localで軽量に動かすこと、再現可能な候補生成を行うこと、LLMとは異なる探索経路を持つことが難しくなる。

本Issueの目的は、**人間の親和図作業を置き換えず、その前段で「一緒に読んでみる価値のある組合せ」を軽量・再現可能に浮上させる認知層が成立し得るかを検証すること**である。

Fly-inspired方式はそのための候補の一つにすぎず、採用すること自体を目的としない。

## 2. 守るべき原則

このPoCでは、方式の良し悪しより先に、製品として守るべき境界を固定する。

- 人間が意味を立ち上げる主体であり、AIまたは非LLM kernelが島・表札・関係を自動確定しない。
- 「近いものを全部まとめる」ことを最適化しない。単独島、保留、違和感、残余を正規の状態として残す。
- 語彙が似ていることと、同じ訴えであることを混同しない。
- pairwise similarityだけで束を推移的に決めず、2〜3枚を一緒に読んだときの集合としての立ち上がりを扱う。
- 内部similarity / activation / confidenceを利用者向け内容スコアへ変換しない。
- 候補kernelを理由に、戻し検査・空白列挙・A/B照合等のverification scopeを削らない。
- PoCのためだけにDocument schema、Consensus Graph、production APIを変更しない。

## 3. 必要となる認知能力

根幹の趣旨から、少なくとも次の能力が必要になる。

1. **表層を越えた意味近接**  
   使用語彙や具体例が違っても、背後の問題構造・経験上の訴えが近いカードを候補化できる。
2. **高表層類似の拒否**  
   同じ語彙でも、時点・因果方向・立場・肯否・役割が違う場合に安易に一束へ寄せない。
3. **small-set coherence**  
   2〜3枚を同時に読んだときに初めて成立するまとまりを扱える。
4. **残余保持**  
   単独島・保留・少数カードを強制的に既存の束へ吸収しない。
5. **文脈適応**  
   現在の探究、周囲のカード、過去の束ね・分離履歴によって候補の意味を調整できる可能性を持つ。
6. **再現性と軽量性**  
   常時localで使える負荷と、同一入力から候補を再生成できる追跡可能性を持つ。

## 4. このIssueで分けて検証する問い

上記の能力を一度に一つの仕組みへ押し込まず、次の順で問いを分離する。

1. 表層特徴だけでは、どこまで届くか。
2. sparse expansionだけで表層baselineを超えられるか。
3. 深層意味表現が必要な場合、FlyVec / Comply系の疎意味表現に独立した研究価値があるか。
4. strong local sentence encoderで十分なのか。
5. 一般意味表現に対して、親和図作業固有のgroup / separate / Critique / hold / graph / space / historyを加えることに独立増分があるか。
6. 候補提示が探索を広げるのか、それとも最初の機械候補へのanchoringを強めるのか。

## 5. 研究仮説

> 一般言語から得たsemantic representationに、親和図作業のgroup / separate / Critique / hold等の局所文脈を重ねることで、表層語彙が異なるhard positiveを回収しつつ、高表層類似のhard negativeと、単独島・保留・残余を保護できる。

この仮説を検証する研究上の仮称を **Affinity Semantic Field** とする。製品名称でも採用済みアーキテクチャでもない。

## 6. 比較する方式

方式は根幹要件を満たすための候補として比較する。

| 系 | 役割 |
|---|---|
| A. character/word n-gram + TF-IDF cosine | 表層類似の基準線 |
| B. conventional sparse/hash baseline | 単なるhash高速化との差を分離 |
| C. FlyHash-like sparse expansion | sparse expansion + WTA単体の寄与 |
| D. learned sparse semantic encoder | FlyVec/Comply系の意味表現寄与 |
| E. strong local sentence encoder | 深層意味近接の現実的な比較基準 |
| F. affinity-specific multi-channel extension | 親和図作業固有履歴・graph・spaceの増分 |
| G. current LLM proposal | 上限・性質比較用 |

最初から全部実装せず、まずA/C/Eで表層・疎拡張・dense semanticの差を確認する。その結果を見てD/Fへ進む意味があるか判定する。

## 7. benchmarkの考え方

評価系が研究方式へ引きずられないよう、モデル結果を見る前にbenchmarkを固定する。

- 今回の研究より前から存在するreviewed dogfoodを観測データとして使う。
- 既存の同一複数カード島を`observedPositiveSet`として扱うが、普遍的なsemantic ground truthとはみなさない。
- 単独島は`observedSingletonIsland`としてそのまま残し、`held / pending / shelved`へ読み替えない。
- cross-islandであること自体をhard negativeとみなさず、人間判定前のcontrast poolへ置く。
- human adjudicationが終わるまでsemantic baselineを実行しない。

現在のv0ではMeta R1とR3の29 reviewed cardsを用い、cross-island pair 173件、2+1 candidate 346件、計519件を監査母集団として固定している。人間判定はこの全件ではなく、モデル非依存の決定論的規則でbounded review setを先に抽出する。

## 8. 実行タスク

- [x] **T1 Research**: FlyHash / BioHash / FlyVec / Comply / APL局所抑制と、親和図法が要求する認知能力との差を整理する。
  - 成果: `01_Plans/research/fly-inspired-affinity-semantic-field-research-2026-09-10.md`
- [ ] **T2 Benchmark freeze**: dogfoodからsmall-set benchmark v0をmodel実行前に固定する。
  - [x] T2a: `textReviewed=true`のMeta R1 / R3をblob SHAで固定し、29枚のblind input、既存複数カード島、単独島、challenge positiveを事前登録した。
  - [x] T2b: cross-island pair 173件 / 2+1 candidate 346件の生成規則と期待件数を固定した。
  - [x] T2c: 座標・島タイトル・edge・source等をmodel inputから除外し、未レビューcardやblob driftをfail-closedにする準備器とunit testを追加した。
  - [ ] T2d: bounded contrast review setをモデル出力を見る前にMaintainerが`hard_negative / related_but_separate / ambiguous_or_held / exclude`へ判定し、adjudicated revisionとして凍結する。
    - [x] frozen source blobから実source prepを再現し、29 blind cards / 173 pair / 346件の2+1をend-to-endで再生成した。
    - [x] 事前登録済みU/L規則で63件（pair 32 / 2+1 31）のmodel-blind review setを確定した。
    - [x] `01_Plans/dogfood/cognitive-assoc-benchmark-v0-pre-adjudication/`へselected review set、human adjudication packet、generation evidenceを凍結した。
    - [x] 63件のhuman response templateと、欠落・重複・label・model-blind attestation・source SHAをfail-closed検証するfreeze utilityを用意した。
    - [x] 4値選択と任意reasonだけを扱うself-contained offline HTML form generatorを追加し、U/L・島・座標・relation・model出力をUIから除外した。
    - [ ] Maintainerが63件をmodel-blindで判定し、freeze utilityでadjudicated artifactの件数・SHA-256を凍結する。完了までsemantic baseline gateは開かない。
- [x] **T3 Baseline harness**: A/C/Eを同じinterfaceで実行できるoffline harnessを作る。T2d完了前はsemantic resultを生成しない。
  - 成果: `01_Plans/dogfood/run_cognitive_assoc_baselines.py` / `cognitive-assoc-baseline-harness-v0.md`
  - AはUnicode char n-gram TF-IDF、Cは固定seed疎展開 + k-WTA、Eはtext-only local vector providerとして同じpair / 2+1 interfaceへ接続した。
  - fixed v0の`run`はfrozen adjudication artifactとEvidenceのSHA一致・gate eligibilityがなければfail-closedする。2026-09-18時点ではsynthetic fixtureだけを実行し、固定v0 semantic resultは生成していない。
- [ ] **T4 Baseline evaluation**: deep-semantic recall / surface-decoy rejection / singleton・residual survival / wording stability / CPU budgetを比較する。
  - [x] T4a: challenge positive retrieval、set coherence、singleton absorption pressure、U/L・pair/2+1別contrast集計を行うevaluation harnessを実装した。
  - [x] T4a: v0に事前登録paraphraseがないためR5 wording stabilityは`not_measured_in_v0`とし、結果を見てから例を追加しない境界を固定した。
  - [ ] T4b: T2d完了後に固定v0でA/C/E probeを実行し、単一winnerやcomposite scoreへ畳まず結果を凍結する。
- [ ] **T5 Learned sparse gate**: T4を根拠にDをProceed / Hold / Rejectで判断する。
  - [x] T5a: T4結果を見る前に、Dを試す独立理由・不足Evidence・Proceed/Hold/Rejectの意味とdriver categoryを事前登録した。
  - [x] T5a: T4 summaryからwinner/composite scoreを作らずmodel-free decision packetを生成し、Maintainer判断とSHA-256をfreezeするutilityを実装した。
  - [ ] T5b: T4b完了後にpacketを生成し、MaintainerがProceed / Hold / Rejectを判定してdecision artifactを凍結する。
- [ ] **T6 Affinity-specific increment**: Proceed時のみFを追加し、group/separate/Critique/hold/graph/space/historyの寄与をablationする。
  - [x] T6a: T5/T6結果を見る前に、7 channelの研究用意味、target leakage禁止、add-one / leave-one-outの16 variant、R6評価、欠損channel時のHold境界を事前登録した。
  - [x] T6a: frozen T5 Proceed + D research artifact + strictly-pre-target source manifestが揃う場合だけablation planを生成するvalidatorを実装した。
  - [ ] T6b: T5b ProceedかつD実験完了後、pre-target履歴sourceを凍結して16 variantを実行する。十分なpre-target履歴がなければtarget状態から補完せずtemporal benchmark v1へHoldする。
- [ ] **T7 Cognitive dogfood**: 候補提示あり/なしで探索の増分とanchoringを比較する。
  - [x] T7a: unseen・non-self-referential・reviewed 30+ cardsのmatched task pair、study-seeded crossover、unaided/intervention/origin-blind reviewの3 phaseを事前登録した。
  - [x] T7a: candidate layerをresearch-only / autoApply=false / scoreOrRankingVisible=falseに固定し、R8をnewly-considered material / structure revision / residual-hold transitions / attention redistribution / candidate disposition / origin-blind retention / costへ分解した。
  - [x] T7a: task carryover、既視task、SUI自己言及task、条件間のdifficulty/card-count不整合をfail-closedにするdogfood plan generatorを実装した。
  - [ ] T7b: T6b完了後に外部題材のtask manifestを凍結し、control / candidate-assisted両条件を実施してR8 Evidenceを固定する。
- [ ] **T8 Architecture decision**: `no adoption / retrieval-only / candidate-cognition layer / ADR trigger` のいずれかへ変換する。

## 9. 評価軸と判定ゲート

- **R1 Deep-semantic candidate recall**: hard positiveの候補回収。
- **R2 Surface-decoy rejection**: hard negativeを語彙類似だけで近接扱いしないこと。
- **R3 Singleton / residual survival**: singleton / held / minority cardsを強制回収しないこと。
- **R4 Set-level coherence**: 2〜3枚集合としての適合を扱えること。
- **R5 Wording stability**: 軽微な言い換えで候補が崩れすぎないこと。
- **R6 Affinity-feedback increment**: 親和図作業履歴の追加に独立した改善があること。
- **R7 Continuous-local budget**: CPU/memory/index更新が常時local運用候補として現実的であること。
- **R8 Cognitive-control increment**: 発見・残余保持・早期収束耐性・注意再配分に実利用上の増分があること。

Gate Aでは表層類似を越えたか、Gate BではFly-inspired方式に独立した理由があるか、Gate Cでは親和図作業固有情報に増分があるか、Gate Dでは実際に認知拡張になっているかを順に判定する。

## 10. 受入条件

- [ ] model出力を見る前にsmall-set benchmark v0のcontrast判定までcommitで固定されている。
- [ ] A/C/Eが同じsnapshot・同じ候補数条件で比較できる。
- [ ] hard positiveだけでなくhard negative / held-or-ambiguous / singletonを含む結果が残る。
- [ ] pairwise retrievalと2〜3枚set-level評価を区別している。
- [ ] `COGNITIVE-EVAL-01`の該当軸へ結果を戻せる。
- [ ] seed / algorithm version / parameter setから再実行可能である。
- [ ] Fly-inspired方式が不利だった場合もReject/縮小判断をそのまま記録する。
- [ ] **AIまたは非LLM kernelが人間の明示操作なしに島・表札・関係を確定しない。**
- [x] production schema/APIを変更していない。

## 11. 事前凍結時点の検証記録

- sourceは今回の研究より前に存在する`doc_cognitive_dogfood_meta_r1`と`doc_kj_atlas_dogfood_r3`を使用する。これらのIDはhistorical evidenceとして保持する。
- 両sourceの全29カードが`textReviewed=true`であることを確認した。
- Meta R1は5つの複数カード島 + 1つの単独島、R3は4つの複数カード島 + 1つの単独島としてsource blobを確認した。
- model-visible fieldは`documentId / cardId / text`だけに固定した。
- synthetic unit testでblind field限定、未レビュー拒否、blob SHA不一致拒否、co-island pair除外、異なるsingleton間のcontrast維持、challenge setの島跨ぎ拒否、membership漏れ拒否を確認した。
- 初期確認環境ではGitHubへのDNS解決ができず実source CLIを走らせられなかったが、2026-09-18にGitHub Actions上でfrozen Git blobを再構成してend-to-end実行した。29 blind cards、173 pair、346件の2+1を期待件数どおり再現し、U/L抽出後のreview setは63件（pair 32 / 2+1 31）となった。
- 生成証跡は`cognitive-assoc-benchmark-v0-pre-adjudication/generation-evidence.json`に固定した。selected review set SHA-256は`5b582e144fb6316f6cd5f0308b4a88a859d29a82bd2fdc423370183dbd35cec3`、human adjudication packet SHA-256は`e52a0b16203e5895814c5f7d20ad741ecd3ea847f9d22aab2fb7cfb0c0d041ce`である。
- human adjudication packetにはselection stratum、source island、座標、relation、model-derived score/rankingを含めていない。63件はすべて`PENDING`で、human judgementはまだ入っていない。
- **semantic baseline / embedding / FlyHash候補はまだ一度も生成していない。** benchmark labelはmodel-blindのままである。

## 12. 管理情報

管理情報は文書冒頭のメタデータブロックを正本とする（二重管理を避けるため、この節では再掲しない）。
