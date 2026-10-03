# ADR-0038: 説明可能な合意形成の社会的普及モデル

- Status: Accepted
- Date: 2026-05-31
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `01_Plans/`, `02_Architecture/`, `03_Implement/frontend/`, `04_Documentation/`
- Activation: 方向性としてAccepted。実際の利用者や協力者が現れるマイルストーンまで、有効化を延期する（`ADR-0039`）。
- Derived-from: `01_Plans/adr/ADR-0036-value-to-social-goal-realization-roadmap.md`

## Context

`ADR-0036` が固定した社会的目標は「説明可能で見直し可能な合意形成を社会へ広げること」である。既存の価値ループは `V4: 共有と学習`（読者が確定点、保留点、根拠を理解できる成果物）までを扱う（`ADR-0032` / `PRODUCT-VALUE-03`）。

しかしV4は**1人の作成者が1つの成果物を安全に共有できる**状態であり、社会的目標が要求する次の3点は未定義である。

1. 同じ成果物が、独立した複数のレビュアーの間で**再現的に同じ理解**を生むか（一貫性であり、正誤の判定ではない）。
2. 一度共有した合意が、時間を越えて**見直し、差し戻し、再オープン**できるか（lock-inしない可逆性）。
3. 社会へ広がる過程で、保留、反対、根拠が**消えずに定着**し、early collapseを社会の規模で防げるか。

加えて、「普及しているか」を知るには観測が要るが、`domain.md` / `ROADMAP.md` / `ADR-0032` は、個人の追跡、監視、SNS型プラットフォーム化を明確な非目標としている。したがって、**監視をしないまま採用と価値を観測する方法**が必要になる。VR5はこの空白を埋める。

## Decision

V4の先に、社会的普及を扱う層VR5を次の4本柱で定義する。新しい思想は加えず、既存のSafeMode / review attribution / evidence trace / Static Publishの資産を、社会の軸へ拡張する。

### 柱1: 複数レビュアー再現性（SOCIAL-DIFFUSION-01）

- 同一のレビューパックを独立したレビュアーが読んだとき、「確定点、保留点、根拠、未レビュー情報」の読み取り結果が再現的に一致することを、観測の単位とする。
- 観測するのは**理解の再現性**であり、結論の正しさや合意の強制ではない（P-02の反スコアリングを維持する）。

### 柱2: 合意の経時的見直し可能性（SOCIAL-DIFFUSION-02）

- 共有済みの成果物（Consensus Graph由来のパック）を、版を越えて再オープンし、差分と根拠を付けて見直せること。
- 過去の合意を、元に戻せない形で固定しない。`patch + approval` の履歴とsource traceを保持し、後から再評価できる経路を残す。

### 柱3: 証拠定着型の安全配布（SOCIAL-DIFFUSION-03）

- 広域への配布（Static Publish / Review Packの配布）でも、保留、反対、未レビュー、根拠への参照が欠けないことを、配布の必須要件とする。
- SafeModeを配布の既定ONとし、解除できない公開モードを、社会へ配布するときの標準とする（`ROADMAP.md` の方式A/Cと整合する）。

### 柱4: 非監視型採用シグナル（SOCIAL-DIFFUSION-04）

- 採用と価値の観測には、個人の追跡、行動のスコアリング、監視のテレメトリを用いない。
- 許可する観測は、opt-in、集計、ローカルファースト、成果物ベース（例: 配布パックに含まれる保留と根拠の要素の充足率、再オープンできるかの自己診断）に限る。
- 観測そのものが新たな漏えいの経路にならないこと（SafeModeの境界を越えない）。

### 統治・非目標

- 結論の自動生成、自動での合意、正解を判定するUIを導入しない。
- SNS型の公開プラットフォーム化、大規模なリアルタイム共同編集、個人を追跡するアナリティクスは非目標とする（`ROADMAP.md` のOut of Scopeを引き継ぐ）。
- 本ADRは `Accepted`（方向性）。社会的普及（VR5）の機能群は、実際の利用者や協力者が現れるマイルストーンまで有効化を延期し、配下のissueは `Draft`（先送りのバックログ）として保持する（`ADR-0039`）。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | V4は1人の作成者が1つの成果物を安全に共有できる状態で、社会的目標が要求する「複数レビュアー間の再現的な理解、経時的な見直し可能性、保留と反対と根拠の定着」が未定義である。VR5を4本柱で定義し、社会的目標を測定でき、かつ安全な形に分解する | 機能: 複数レビュアー再現性は理解の再現性を観測し結論の正しさや合意の強制ではない（P-02反スコアリング維持）。データ: 過去合意を不可逆に固定せずpatch+approval履歴とsource traceを保持 |
| **データ設計** | 広域配布（Static Publish/Review Pack）でも保留・反対・未レビュー・根拠参照が欠落しないことを必須要件とし、SafeModeを配布既定ON・解除不可の公開モードを社会配布の標準とする | 業務: 同一レビューパックを独立レビュアーが読んだとき確定点・保留点・根拠・未レビューの読み取り結果が再現的に一致することを観測単位とする。機能: 共有済み成果物を版を越えて再オープンし差分と根拠付きで見直せる |
| **機能設計** | 採用・価値の観測はopt-in・集計・ローカルファースト・成果物ベースに限定し個人追跡・行動スコアリング・監視テレメトリを用いない。観測自体が新たな漏洩経路にならないこと（SafeMode境界を越えない） | 業務: 複数レビュアー再現性の観測は人手評価を伴いコストが高い。データ: 非監視制約のため採用観測は粗くなり監視への転用を禁ずる。VR5機能群は実ユーザー/協力者が現れるmilestoneまでactivation延期 |

## Consequences

- 期待される効果
  - 社会的目標が、測定でき安全な4本柱へ分解され、初めて計画でき、起票できるようになる。
  - 既存の安全とレビューの資産を、個人の利用から社会的な利用へ無理なく広げられる。
- 想定される副作用と制約
  - 複数レビュアーの再現性の観測は人手の評価を伴い、コストが高い。
  - 監視をしない制約のため、採用の観測は粗くなる。意図的にその粗さを受け入れ、監視への転用を禁じる。
- 移行時に必要な対応
  - `SOCIAL-DIFFUSION-01..04` を起票する。
  - `02_Architecture/value_traceability.md` と `ROADMAP.md` の公開運用の節に、社会的普及の安全要件をつなぐ。

## Traceability

- Derived-from: `01_Plans/adr/ADR-0036-value-to-social-goal-realization-roadmap.md`
- Related: `00_Prompt/domain.md`, `00_Prompt/ai_cognitive_externalization_requirements.md`
- Related: `01_Plans/adr/ADR-0032-product-value-realization-model.md`, `ADR-0006-phase3-review-governance.md`
- Related: `01_Plans/issues/done/issue-PRODUCT-VALUE-03-reviewable-outcome-package.md`, `issue-CE4-api-cli-audit-integration.md`
- Related: `02_Architecture/review_attribution.md`, `02_Architecture/value_traceability.md`, `ROADMAP.md`, `THREAT_MODEL.md`
- Related issues: `issue-SOCIAL-DIFFUSION-01-multi-reviewer-reproducibility.md`, `issue-SOCIAL-DIFFUSION-02-consensus-revisability-over-time.md`, `issue-SOCIAL-DIFFUSION-03-evidence-anchored-safe-diffusion.md`, `issue-SOCIAL-DIFFUSION-04-non-surveillance-adoption-signals.md`

---

## Stream H deferred-backlog baseline（2026-06-13）

`SOCIAL-DIFFUSION-01..04` の4件はすべて、実際の利用者や協力者、または明示的な公開共有のパイロットが現れるまで、**Hold / deferred-open-ready** のままとする。設計の方向性としてだけ保持する。

| Issue | Direction retained | Activation waits for | Explicit non-goal |
| --- | --- | --- | --- |
| `SOCIAL-DIFFUSION-01` | 理解の再現性を、複数のレビュアーで確かめる。 | 独立したレビュアー2名以上、またはメンテナーが承認した代替の手順。 | 正しさの採点、または合意の強制。 |
| `SOCIAL-DIFFUSION-02` | 合意を、時間を越えて見直せるようにする。 | 版を持つレビューパッケージと、再オープンの手順の候補。 | lock-in、変更できない合意、または自動での再承認。 |
| `SOCIAL-DIFFUSION-03` | 証拠に結び付いた、安全な配布。 | 保留、レビュー、根拠の状態を保てる、安全な公開・共有の経路。 | SafeModeとshare/exportの保護を外した公開配布。 |
| `SOCIAL-DIFFUSION-04` | 監視によらない採用のシグナル。 | opt-inで集計する、または成果物に基づくシグナルの設計。 | 個人の追跡、行動のスコアリング、管理者中心の監視KPI。 |

これらの制約は、社会的なマイルストーンが生まれる前に、VR5が実装の要件になってしまうことを、意図して防ぐものである。
