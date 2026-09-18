# TEI / SEI / SUI / EKI プロダクト境界 — cross-repository positioning

- Status: Informative / Cross-repository
- Date: 2026-09-18
- Canonicality: **本書は各プロダクトのProduct Valueの正本ではない。** 各プロダクト固有の価値・非目標・要求は、それぞれのリポジトリを正本とする。
- Purpose: 複数プロダクトを組み合わせて議論するときに、責務の重複・親子関係化・暗黙依存を避けるための共通見取り図を提供する。

## 1. なぜこの文書を置くか

SUI Sensemaking、SEI Cognition、TEI、EKI Fabricは、相互に利用可能な領域を持つが、一つの製品を分割したモジュールではない。

クロスプロダクトの議論を各リポジトリへ複製すると、同じ概念の正本が複数生まれる。一方、現段階で専用の「製品ファミリー」リポジトリを設けると、まだ変化の大きい境界概念のために恒久的な同期・ガバナンス層を増やしてしまう。

そのため当面は、

1. 各プロダクト固有の価値・要件は各リポジトリに置く
2. 横断文書は少数に留め、各正本への導線と責務境界だけを扱う
3. 共通schema、互換性試験、family-wide release policy等が独立した変更単位になった時点で、専用リポジトリへの昇格を再検討する

という運用とする。

## 2. 現時点の責務境界

| Product | Owns | Does not own |
|---|---|---|
| **SUI Sensemaking** | 未整理な材料からObservation / Relation / Hypothesis / Structure / Synthesisを形成し、意味形成の過程を保持・理解・レビュー・成熟させるsensemaking lifecycle | 認知Providerそのものの最適実装、汎用分散compute、formal application model全般 |
| **SEI Cognition** | Observation・Question・Evidence・Unknown・Decision・Capability・Provenance等を用いて、認知と判断を構成・継続する基盤。異種Capability Providerを選択・組合せ可能にする | SUI固有の意味形成UI、TEI固有のformal model、EKI固有のworker scheduling |
| **TEI** | 業務・Application・Infrastructureの意味をCanonicalなformal modelとして保持し、人間向けProjection、AIによる継続開発、native asset / target realization、AI Business Actorが利用するOperational Knowledgeへ接続する基盤 | 未分化な意味探索そのもの、認知・判断の継続性そのもの、汎用認知runtime、汎用分散compute |
| **EKI Fabric** | 一時的・異質・分散したCPU/GPU/NPU等の計算余力を、安全に利用可能なcompute resourceへ変換するexecution fabric | 認知・意味・判断の正本、SUI/SEI/TEI固有のdomain semantics |

## 3. 代表的な協調

### SUI × SEI

SUIが「何について意味を形成するか」「何をObservation / Hypothesis / Structureとして保持するか」を所有し、SEIは必要に応じて「どのCapabilityで、どの認知処理を行うか」を支援する。

SUIはSEIに依存しなければ成立しない製品にはしない。SEIを利用しないローカル処理、決定論、別Providerも許容する。

### SUI × TEI

SUIは未分化・曖昧・対立を含む意味形成を扱う。TEIは、十分に安定しformalizeする価値が生じた意味を、実装・検証可能なCanonical modelへ落とす。

この境界は「SUIの出力を自動的にTEIの正本へ昇格する」ことを意味しない。formalizationは独立した検証・権限境界を持つ。

### SEI × EKI

SEIが必要なCapability、latency、privacy、trust、resource class等を決め、EKIがその計算をどこで実行するかを扱える。

EKIはcognitive workloadを重要な用途として扱えるが、AI/認知専用fabricにはしない。

### TEI × SEI

TEIは、受入済みの業務・Application・Infrastructure knowledgeと、Business Action / Capability / Authorization / Binding / Evidence等の**Operational Semantics**を主に扱う。

SEIは、Observation、Question、Unknown、Recommendation、Decision、Responsibility、Cognitive Method等の**Cognitive / Decision Semantics**を主に扱う。

AIエージェントが業務を行う場合、この二つは次のように協調できる。

```text
SEI
  何を観察し、何を問い、何を判断するか
        ↓ optional cognition / decision context
AI Business Actor
        ↓ reads
TEI
  何が業務上可能か
  どのAction / Capability / Constraint / Authorityがあるか
        ↓
Execution
        ↓
Observation / Evidence
        └──────────────→ SEIへ戻せる
```

SEIがなくてもAI AgentはTEIのOperational Knowledgeを利用でき、TEIがなくてもSEIは認知・判断を保持できる。固定pipelineにはしない。

また、TEIがSEIのRecommendationをCanonical meaningへ暗黙昇格させず、SEIもTEIのBusiness Procedure / Application / Capability contractをUniversal Coreへ複製しない。

## 4. 実装方針 — TEI適性をApplication Planeと構造化設計適性の二軸で見る

プロダクト上の正本と、実装に使う共通基盤は分けて考える。

今後の自作OSSでは、TEI適用を一つの条件だけで決めない。少なくとも次の二軸を見る。

1. **Application Plane強度** — UI、Interaction、業務／domain logic、Projection、Validation、Application lifecycle等をどれだけ持つか
2. **Structured Design Affinity（構造化設計適性）** — Data、Relation、state、rule、constraint、transformation、capability等を図・表・グラフ・モデルで整理統合し、その設計資産から実装を導きたい度合い

後者が高ければ、UIをほとんど持たないCLIやheadless serviceでもTEIの射程に入る。

逆にApplication Planeが大きくても、価値の中心が特殊algorithm、描画engine、compiler、model runtime等の手続き的・性能依存なkernelにある場合、TEIはshellや周辺設計に限定してよい。

| | 構造化設計適性 高 | 構造化設計適性 低 |
|---|---|---|
| **Application Plane 高** | Broad TEI-first | TEI shell + native specialized engine |
| **Application Plane 低** | TEI design / definition plane | Native-first |

TEI-firstは、各Productの意味や価値をTEIへ移すことを意味しない。SUIのsensemaking、SEIのcognition / decision meaning、EKIのdistributed compute semanticsは各Repositoryが引き続き正本を持つ。

また、「図表で整理する」とは見た目の図そのものを唯一の正本にすることではない。図・表・グラフ等は、同じCanonicalな意味を読み書きするProjection / authoring surfaceとして扱う。

一方、次の領域はTEI化を自動的な既定にはしない。

- scheduler / worker / queue / lease等の分散実行kernel
- protocol、sandbox、resource governor、device-level agent
- model runtime、認知アルゴリズム本体、性能クリティカルなcompute kernel
- TEI自身のbootstrapに必要なlow-level implementation
- native assetとして保持した方が意味・性能・安全性を保てる専門実装

この区別を概念的には次のように扱う。

```text
Application Plane
  UI / interaction / domain rule / projection / validation
  -> TEI-first

Specialized Capability
  spatial canvas / cognition / external integration / special runtime
  -> TEI Plugin / Adapter / Capability / native assetを優先検討

Kernel / Infrastructure Plane
  scheduler / worker / protocol / sandbox / compute engine
  -> native-first、TEI利用は管理面等で個別評価
```

TEIに不足が見つかった場合、SUIやSEI等の都合を直接TEI Coreへ入れず、次の順で評価する。

1. 既存TEI機能で表現できないか
2. reusable Plugin / Adapter / Capabilityとして切り出せないか
3. native asset / custom implementationとして接続できないか
4. 複数Applicationに共通する意味上の欠落であることがEvidenceで確認できた場合だけCore / Product Requirement候補にする

SUI Sensemakingを最初のReference Adoptionとし、TEI移管で**開発負荷が本当に低下するか**と、実利用由来のPlugin surfaceを同時に検証する。

SUIはこの二軸の両方が高い。Canvas / review / proposal / export等のApplication Planeを持つだけでなく、カード・島・関係・階層・Evidence・Hypothesis等の情報を図表的に外在化し、その構造を保ったまま別Projectionや実装へ接続したいProductである。そのため、TEI-firstの最初のReference Adoptionとして特に適している。

### 自作OSSへの当てはめ例

| 対象 | Application Plane | 構造化設計適性 | TEIの主な役割 |
|---|---|---|---|
| SUI Sensemaking | 高 | 高 | Broad TEI-first。Canvas等のspecialized Interactionはnative / Plugin併用可 |
| SEIの管理・Review surface | 高 | 高 | Application / Projection / policy editor |
| SEIの認知kernel | 低 | 低〜中 | 原則native。Capability境界だけTEIと接続 |
| EKIのoperator / policy surface | 中〜高 | 高 | control planeのApplication / Projection |
| EKI scheduler / worker / protocol | 低 | 低 | native-first |
| markdown-matrix-injectorの定義・mapping・validation面 | 低〜中 | 高 | headlessなdesign / definition planeとして適用余地 |
| 純粋なalgorithm library | 低 | 低 | native-first |

同一Repositoryの中でも領域ごとに象限が異なってよい。Product単位で「TEI製／非TEI製」と二分するのではなく、**どの意味・設計・Application責務をTEIへ預けると再利用性と変更局所性が高まるか**で境界を切る。


## 5. 依存ではなく利用可能性として扱う

4製品を次の固定スタックとしては定義しない。

```text
SUI -> SEI -> TEI -> EKI
```

実際には用途ごとに関係が異なる。

```text
SUI ----uses----> SEI
 |                 |
 | formalize       | compute
 v                 v
TEI ----uses----> EKI

各Productは必要に応じて単独でも成立する
```

「関係が深い」ことと「必須依存」は区別する。

## 6. 各リポジトリへ反映すべき要点

### SUI Sensemaking

- KJ法キャンバスを中核的な人間系interfaceとして保持する
- SUI CoreをKJ法だけへ限定しない
- Human-led → Collaborative → Delegated → Supervised autonomousのライフサイクルを支える
- AI Workspace内の自律sensemakingと、人間承認済み状態への権限昇格を分離する
- Evidence / provenance / hold / conflict / reversibilityを失わない

正本候補:
- `README.md`
- `00_Prompt/domain.md`
- `00_Prompt/cognitive_frame_and_evolution_criteria.md`
- `00_Prompt/ai_cognitive_externalization_requirements.md`
- `ADR-0084`

### SEI Cognition

- 特定AIモデルではなく、認知・判断・不確実性・根拠・来歴を継続する基盤
- rule / classifier / embedding / associative cognition / local SLM / frontier LLM / human等をCapability Providerとして扱える
- 「どう認知し、どう判断を構成するか」を所有し、sensemaking UIやcompute placementを所有しない
- AI能力向上に対してProvider交換可能性とDecision Continuityを維持する

正本候補:
- `product/value/SEI_PRODUCT_VALUE.md`
- `product/vision/SEI_PRODUCT_VISION.md`
- `product/definition/SEI_PRODUCT_SHAPE.md`

### TEI

- 業務・Application・Infrastructureの意味をCanonical modelとして保持する
- source / meaning / realization / execution / observationの境界を守る
- 生成AIが継続的にApplicationを構築・変更するためのmachine-readable development contextを提供する
- 人間がgenerated code全体を読まずに意味・差分・影響・Evidenceを理解できるProjectionを提供する
- AI Business Actorが、明示Authorityの範囲でBusiness Action / Capabilityを利用するOperational Knowledgeになり得る
- 認知Capabilityは、曖昧なmapping・候補・例外検知に利用してよいが、Canonical meaningを暗黙更新しない
- SUI等で形成された意味のformalization先になり得るが、SUIを必須前段としない

正本候補:
- `product/value/TEI_PRODUCT_VALUE.md`
- `product/vision/`
- `product/principles/`

### EKI Fabric

- cognitive workloadを主要な利用候補として認める
- ただし汎用distributed compute fabricとしての独立性を維持する
- data locality / trust / resource requirement / user impact / costを含めて実行場所を選ぶ
- SUI / SEI / TEIを特別扱いする専用runtimeにはしない

正本候補:
- `product/value.md`
- `product/principles.md`

## 7. 専用リポジトリへの昇格条件

次のうち複数が継続的に発生したとき、横断領域を専用リポジトリへ昇格する。

- どの個別製品にも所有させにくい共通schema / IDLが存在する
- cross-product contract testsを独立CIで継続運用する
- compatibility matrixやrelease coordinationを横断管理する必要がある
- family-wide ADRが繰り返し発生する
- 一つのプロダクトの内部文書に置くことで、他プロダクトが従属して見える問題が実害を生む
- 横断成果物が文書だけでなく、versioned artifactとして配布される

それまでは専用リポジトリを増やさず、各Product Valueを各リポジトリで育てる。

## 8. 今回の位置づけ

2026-09-18時点では、横断領域は独立プロダクト／独立artifactというより、各プロダクトの責務境界を明確化するための設計知識である。

したがって本書はSUIの`01_Plans/cross-repo/`に暫定配置するが、**SUIが他3製品を所有することを意味しない。**

専用リポジトリ新設は保留し、各Product Value / Visionへの反映を先行する。
