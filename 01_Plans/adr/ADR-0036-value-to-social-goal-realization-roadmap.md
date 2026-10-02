# ADR-0036: プロダクト価値→社会的目標 実現フェーズロードマップ

- Status: Accepted
- Date: 2026-05-31
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `01_Plans/`, `02_Architecture/`, `03_Implement/`, `04_Documentation/`
- Activation: VR0–VR3はactive。VR4/VR5は `ADR-0039` によりactivationを延期（directionとして保持）。

## Context

`README.md`、`00_Prompt/domain.md`、`00_Prompt/ai_cognitive_externalization_requirements.md` は、sui-sensemakingの存在意義を次のように定義している。

- 意味を急いで確定せず、違和感・保留・揺らぎを健全な状態として扱う（`domain.md`）。
- 生成AI時代に起きやすい「早すぎる収束」「もっともらしい誤り」「反対仮説の消失」「レビュー不能な要約の流通」を防ぐ、人間とAIの共有認知足場を提供する（`ai_cognitive_externalization_requirements.md` §1）。

これらから導かれる**プロダクトの社会的目標**は、上位文書に分散しているが一文として固定されていない。一方で**プロダクト価値**は次のように既に定義済みである。

- 価値原則 `P-01〜P-07`（`ADR-0001` / `ADR-0010` / `ADR-0011`）。
- 価値実現ループ `V0〜V4`（`ADR-0032` / `02_Architecture/value_traceability.md`）。
- 認知外在化フェーズ `CE-0〜CE-4`（`ADR-0028`）。

不足しているのは「価値→社会的目標」を**一本のフェーズ系列**として並べた上位ロードマップである。現状フェーズ定義は `ADR-0002`(Phase 0–6) / `ADR-0028`(CE-0–4) / `ADR-0007`(FB-*) / `ROADMAP.md`(近接/中期/長期) / `ADR-0001`(Phase A/B/C) に分散し、相互の順序・出口ゲート・社会的目標への接続が曖昧である。特に、個人・チームの共有(V4)の先にある**「説明可能な合意形成を社会へ広げる」層は、フェーズ化も起票もされていない**（`ADR-0032` はL4相当の社会的観測を将来課題と明記）。

このままでは、各issueが個別に正しくても、全体として「いま価値のどこを作っており、社会的目標まで何が残っているか」を説明できない。

## Decision

新しい思想は追加しない。既存価値を社会的目標まで一直線に並べる**実現フェーズ系列VR0〜VR5** を本ADRの正本として固定する。本ADRは索引・順序・ゲートを定める親ADRであり、実装進捗はissueで管理する。

### 社会的目標（北極星/ 上流文書からの統合表現）

> 散らばった暗黙知・主観・多様な意見を、early collapse（早すぎる収束）させずに、**レビュー可能・可逆・説明可能**な形へ構造化し、人間と生成AIが協働して「説明可能で見直し可能な合意形成」を行える場を社会へ広げること。

この表現は `README.md` / `domain.md` / `ai_cognitive_externalization_requirements.md` の統合であり、価値の再定義ではない。矛盾が生じた場合は上流文書を正とする。

### VR フェーズ系列（価値→社会的目標）

| Phase | 目的（利用者/社会が得る状態） | カバーする価値 | Entry Gate | Exit Gate | 主担当issue |
| --- | --- | --- | --- | --- | --- |
| VR0 安全基盤 | 安全・可逆・監査の既定が崩れない土台 | P-03/P-07, CE-0 | リポジトリbaseline | SafeMode既定ON・`provider=none`既定・patch+approval・review人手昇格が回帰固定 | 既存: `CE0`, `THREAT_MODEL`, safe_mode policy |
| VR1 価値活性化 | 迷わず始め、最初の意味ある配置へ到達 | V0/V1, P-01 | VR0 Exit | 初回経路で「カード+まとまり/保留」に到達できる | 既存: `PRODUCT-VALUE-01`, `PRODUCT-UX-01` |
| VR2 曖昧さネイティブ作業 | 保留・違和感・根拠不足・反対意見を作業状態として扱える | V2/V3, P-01/P-02/P-04, CE-1/CE-2 | VR1 Exit | 4状態の付与・絞り込み・共有前確認・AI制約反映が成立 | 既存: `PRODUCT-VALUE-02`, `PRODUCT-UX-02`, `CE1`, `CE2` |
| VR3 レビュー可能成果物 | 読者が確定点・保留点・根拠・レビュー状態を理解できる | V4, P-02/P-03 | VR2 Exit | 成果物最小6要素 + 安全共有 + 元データ復帰導線が成立 | 既存: `PRODUCT-VALUE-03`, `PRODUCT-UX-03`, `CE3` |
| VR4 価値観測と製品化ゲート | 価値実感を再現可能に観測し、Go/No-Goを下せる | 横断（観測契約） | VR1–VR3が観測対象を提供 | 観測ハーネス + 二軸スコアカード + Program Gate が運用可能 | 新規: `VALUE-MEASURE-01/02`; 既存: `MVP-EXIT-01`, `PRODUCT-QA-01` |
| VR5 社会的普及 | 説明可能な合意が、複数レビュアー間・時間越しに再現・見直し可能な形で社会へ広がる | 社会的目標（L4相当） | VR3 Exit + VR4観測 | 複数レビュア再現性 + 合意の経時的見直し可能性 + 証拠定着安全配布 + 非監視型採用シグナル | 新規: `SOCIAL-DIFFUSION-01..04`; 既存: `CE4`, ROADMAP公開運用 |

### 順序・依存・統治ルール

1. 順序は `VR0 -> VR1 -> VR2 -> VR3` を直列固定。`VR4` はVR1–VR3の各完了点を観測対象として並行進行してよいが、Program Gate最終判定は対象フェーズ完了後に行う。`VR5` は `VR3` Exitと `VR4` 観測の双方を前提とする。
2. 本ADRは既存フェーズ体系（`ADR-0028` CE / `ADR-0007` FB / `ADR-0031` PRODUCT-UX）を**置換せず、価値軸で再配置する索引**として機能する。各VRは既存issueを正担当として再利用し、重複起票しない。
3. 新規に必要なのはVR4（観測の運用化）とVR5（社会的普及）のみであり、それぞれ `ADR-0037` / `ADR-0038` と新規issueへ委譲する。
4. 全VR共通の非後退不変条件: SafeMode既定ON、未レビュー保護、`human_reviewed` 人手昇格、patch+approval、`SUI_LLM_PROVIDER=none` 既定でも主要価値が成立。
5. 非目標: 自動結論生成、自動合意、正解/採点UI、個人追跡・行動スコアリング・監視目的テレメトリ、SNS型公開プラットフォーム化。
6. 本ADRは `Accepted`（`ADR-0039` の段階適正化を反映）。VR0–VR3は既存issueで進行可能。VR4/VR5は実ユーザー/協力者が現れるmilestoneまでactivationを延期し、新規issueは `Draft`（deferred backlog）として保持する。各VRのExit判定はMaintainerが記録する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 各issueが個別に正しくても、全体として「いま価値のどこを作っており、社会的目標まで何が残っているか」を説明できない。既存価値を社会的目標まで一直線に並べる実現フェーズ系列VR0〜VR5を親ADRとして固定する | 機能: 新規思想は追加せず既存価値を再配置する索引として機能。データ: 各VRは既存issueを正担当として再利用し重複起票しない |
| **データ設計** | 社会的目標は「早すぎる収束させずレビュー可能・可逆・説明可能な形へ構造化し、説明可能で見直し可能な合意形成を行える場を社会へ広げる」と統合表現。価値原則P-01〜P-07・価値ループV0〜V4・認知外在化CE-0〜4を背骨で接続 | 業務: 全VR共通の非後退不変条件（SafeMode既定ON・未レビュー保護・human_reviewed人手昇格・patch+approval・provider=noneでも主要価値成立）。機能: 社会的普及VR5が初めて計画可能になる |
| **機能設計** | VR4（観測の運用化）とVR5（社会的普及）のみ新規で、`ADR-0037`/`ADR-0038`と新規issueへ委譲。VR0〜VR3は既存issueで進行可能 | 業務: 非目標は自動結論生成・自動合意・正解/採点UI・個人追跡・SNS型公開。データ: VR4/VR5は実ユーザー/協力者が現れるmilestoneまでactivation延期しDraftとして保持 |

## Consequences

- 期待される効果は次のとおりです。
  - 価値から社会的目標までの優先順位を単一の背骨で説明でき、散在フェーズの再発明を防げる。
  - 社会的普及(VR5)が初めて計画可能・起票可能になる。
  - 観測(VR4)が「契約」から「運用される成果物」へ接続される。
- 想定される副作用/制約は次のとおりです。
  - UI/データ/文書/E2Eを横断するため単一PRで閉じにくい。
  - VR5は過剰計測へ滑りやすいため、非監視制約を`ADR-0038`で固定する。
  - ADR `Proposed -> Accepted` の人間承認が前提で、承認前は下流着手しない。
- 移行時に必要な対応は次のとおりです。
  - `02_Architecture/value_traceability.md` にVR系列と社会的目標接続を追記する。
  - `ADR-0037`（観測ハーネス）と `ADR-0038`（社会的普及）を起票する。
  - VR4/VR5の新規issueを `01_Plans/issues/` に起票し、`AGENTS.md` のADR参照範囲を更新する。

## Traceability

- Related: `README.md`, `00_Prompt/domain.md`, `00_Prompt/ai_cognitive_externalization_requirements.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`, `ADR-0010-values-principles.md`, `ADR-0011-requirements-mapping.md`
- Related: `01_Plans/adr/ADR-0028-ai-cognitive-externalization-phase-plan.md`, `ADR-0031-productization-screen-information-architecture.md`, `ADR-0032-product-value-realization-model.md`, `ADR-0033-mvp-data-support-and-maintenance-boundary.md`
- Related: `02_Architecture/value_traceability.md`, `ROADMAP.md`
- Children: `01_Plans/adr/ADR-0037-value-measurement-harness-and-scorecard.md`, `01_Plans/adr/ADR-0038-social-diffusion-of-explainable-consensus.md`
- Related issues: `issue-VR-ROADMAP-01-value-to-social-goal-phase-baseline.md`, `issue-VALUE-MEASURE-01-*`, `issue-VALUE-MEASURE-02-*`, `issue-SOCIAL-DIFFUSION-01..04-*`

---

## Stream H activation baseline（2026-06-13）

| VR | Planning classification | Open/activation rule | Non-goal lock |
| --- | --- | --- | --- |
| VR0 | Active backbone | Open/Done may proceed through safety regressions and docs-checks. | SafeMode/provider/review invariants are never relaxed. |
| VR1 | Active backbone | Open/Done may proceed when first-value scenarios are acceptance-testable. | No new value principle is added here. |
| VR2 | Active backbone | Open/Done may proceed through domain-expression work already delegated to product/domain issues. | Ambiguity is preserved; AI does not auto-resolve Hold/Critique. |
| VR3 | Active backbone | Open/Done may proceed when reviewable outcome package criteria are traceable. | Share/export cannot omit unreviewed, held, or evidence state. |
| VR4 | Deferred backlog | Direction is retained, but activation waits for real users/cooperators or maintainer-approved surrogate evidence; it is not a release blocker in solo OSS/pre-release. | No surveillance KPI, individual scoring, or mandatory frontend E2E harness is introduced by this ADR. |
| VR5 | Deferred backlog | Direction is retained, but activation waits for real users/cooperators and a safe public/share path; it is not implementation-mandatory now. | No social diffusion KPI requiring real external participants is made mandatory before the milestone exists. |

This baseline keeps `ADR-0039` governance right-sizing intact: Stream H may refine planning issue memos, but must not edit implementation files or force VR4/VR5 Open while activation is deferred.
