# ADR-0040: 中核ドメイン概念の第一級化戦略（保留・違和感・根拠・矛盾）

- Status: Accepted
- Date: 2026-05-31
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `00_Prompt/domain.md`, `02_Architecture/schemas.md`, `03_Implement/frontend/`, `01_Plans/`
- Norms: `DOM-AI-02, DOM-AI-03`（AIはHold/Critiqueを解消せず保持対象として扱うという緩和禁止条項が、DOMAIN-EXPR全4フェーズの設計を制約する）

## Context

社会的目標は、「散らばった暗黙知、主観、多様な意見を、early collapseさせずに、レビュー可能で可逆で説明可能な形へ構造化する場」を広げること（`README.md` / `domain.md` / `ai_cognitive_externalization_requirements.md`）。その中核は、domain.mdの概念群（保留HoldState / 違和感Critique / 未統合PendingItems・Shelf / 根拠EvidenceLink / 矛盾Contradiction / claimType）である。

しかし現状、これらは「概念の憲法」と「往復保存される型」の間で、どちらにも定まっていない。

- `schemas.md` は `critiqueInputs` / `evidenceLinks` / `claimType` / `reviewAttribution` を持つが、432行目が「MVPでは画面上の個別編集や個別CRUDを提供せず、import/export/API保存時の型、検証、監査の境界を固定する」と明記しており、利用者が触れる日常のUIも視覚言語もない。
- frontendの実装に `shelf` / `pending` / `holdState` は一つもない（コードの走査で0件）。`PendingItems/Shelf`（未統合の退避場所）は、型すらない。
- `value_traceability.md` §2.1.1は、「保留と違和感の日常操作」「根拠、主張、反対意見の追跡」を、不足している設計の観点として明記している。
- `PRODUCT-VALUE-02` のRepresentation boundary tableは、5つの語彙のすべてで「現行の構造で不足する範囲」を挙げ、各行を「schema issueを起こすか判断する」として保留している。さらに、同issueのOpen化の条件は「`ADR-0032` がAccepted」であり、`ADR-0032` 自身が同issueのOpen-readyを待っている。つまり循環したデッドロックである。

この保留の状態のままでは、sui-sensemakingは「単なるカード配置ツール」に見え、認知外在化フレームワークとしての価値が利用者の体験に届かない。保留された設計判断を確定する必要がある。

## Decision

中核ドメイン概念を、段階的に、加算的に、後方互換を保って第一級化する。新しい概念は加えず、domain.mdにある既存の概念を、「往復保存される型」から「利用者が触れる作業状態」へ昇格させる橋渡しに限る。`PRODUCT-VALUE-02` が保留したschemaの判断を、本ADRで確定する。

### 循環デッドロックの解消（代理裁可）

- `ADR-0032`（プロダクト価値実現モデル）をAcceptedとする（中核のV0–V4ループはactiveとし、二軸スコアカードなどのVR4の観測機構は `ADR-0039` に従って有効化を延期する）。これにより、`PRODUCT-VALUE-02` のOpen化の条件「ADR-0032がAccepted」が満たされる。
- `PRODUCT-VALUE-02` の `DecisionStatus: Pending` をFixedへ変える。保留されていたschemaの判断は、本ADRの方針（下記）に従う。Representation boundary tableを、価値ゲートV2の暫定的な正本として承認する。

### schema第一級化の確定方針（PV-02の保留の解消）

| ドメイン語彙 | 現行 | 確定方針 |
| --- | --- | --- |
| 違和感 Critique / 根拠 EvidenceLink / 矛盾 Contradiction / claimType | 型は往復保存。UIなし | **schema変更なし**。既存の往復フィールドを、読み取りUI（バッジ、絞り込み、確認）として見せる（Phase 1） |
| 保留 HoldState | `claimType="unknown"` の代用のみ | **加算的で任意のフィールドを新設**（`holdState?`）。欠けているときは従来の挙動（Phase 2） |
| 未統合 PendingItems / Shelf | 型すらない | **加算的で任意のShelf membershipを新設**。退避と復帰は可逆で、内容の削除とは分ける（Phase 2） |

加算の原則: 新しいフィールドはすべてoptionalにする。未対応のクライアントと旧データは、欠けていることを従来の挙動として解釈し、壊さない。schemaの変更は、`schemas.md` を先に更新し、import/export/validate/testsが追随する（`AGENTS.md` §4.2）。

### フェーズ分割（→ DOMAIN-EXPR-01..04）

- **Phase 1 / `DOMAIN-EXPR-01`**: 既存の往復状態を、読み取りUIとして第一級にする（claimType/critique/evidence/reviewStateのバッジと絞り込み）。schema変更なし、低リスクで、価値を先に検証する。
- **Phase 2 / `DOMAIN-EXPR-02`**: 保留Holdと未統合Shelfを第一級にする（加算的なスキーマ拡張、可逆な退避と復帰）。
- **Phase 3 / `DOMAIN-EXPR-03`**: 違和感から再提案までの日常のループUI（理由を任意にしたCritique→制約の反映→再提案の差分確認、P-04）。既存の `critiqueInputs`/`reproposalDiffs` を、日常の導線へ載せる。
- **Phase 4 / `DOMAIN-EXPR-04`**: 根拠、主張、矛盾を、人間によるレビューの第一級の対象かつ成果物の要素へつなぐ（`PRODUCT-VALUE-03` のreviewable packageと連携する）。

### 非目標 / 緩和禁止の不変条件

- 非目標: 正解の判定、採点、ランキング、AIによる保留の自動解除、矛盾の自動での解決、証拠としての能力を持つ監査証跡。
- 緩和禁止（`ADR-0039` / CE0契約）: proposal-only、`human_reviewed` を人手で昇格すること、SafeMode既定ON、`SUI_LLM_PROVIDER=none` が既定でも各Phaseの主要な価値が成立すること。AIはHold/Critiqueを解消せず、保持の対象として扱う。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 中核概念（保留HoldState・違和感Critique・未統合Shelf・根拠EvidenceLink・矛盾Contradiction）が、「概念の憲法」と「往復保存される型」の間でどちらにも定まらず、sui-sensemakingが単なるカード配置ツールに見える。中核概念を、段階的に、加算的に、後方互換を保って第一級化し、利用者が触れる作業状態へ昇格させる | 機能: Phase 1は、既存の往復状態の読み取りUI（バッジ、絞り込み）でschema変更なしの低リスク。データ: 非目標は、正解の判定、採点、ランキング、AIによる保留の自動解除、矛盾の自動での解決 |
| **データ設計** | schemaの変更は、違和感、根拠、矛盾、claimTypeは変更なし（既存の往復フィールドを読み取りUIへ）、保留HoldStateは加算的で任意の`holdState?`を新設、未統合Shelfは加算的で任意のShelf membershipを新設する。新しいフィールドはすべてoptionalで、欠けているときは従来の挙動とする | 業務: 退避と復帰は可逆で、内容の削除とは分ける。機能: schemaの変更は、schemas.mdを先に更新し、import/export/validate/testsが追随する |
| **機能設計** | 4フェーズ（読み取りUI→保留と未統合→違和感から再提案へのループ→根拠と矛盾をレビューの対象へ接続）を、DOMAIN-EXPR-01..04に分割する。循環したデッドロックは、ADR-0032をAcceptedにして解消する | 業務: 緩和禁止は、proposal-only、human_reviewedの人手での昇格、SafeMode既定ON、provider=noneでも主要な価値が成立すること。データ: AIはHold/Critiqueを解消せず、保持の対象として扱う |

## Consequences

- 期待される効果: domain.mdの中核概念が利用者の体験に届き、社会的目標（曖昧さを保留する道具）の核が成立する。PV-02の循環したデッドロックが解消し、保留されていた設計判断が確定する。
- 想定される副作用と制約: Phase 2でschemaを加算的に拡張するため、import/export/validate/testsを同期する作業が伴う。状態の語彙が多すぎると、カードの操作が重くなりうる（Phase 1を読み取り専用に限ることで和らげる）。
- 個人OSSの段階での扱い（`ADR-0039`）: DOMAIN-EXPR-01..04はDraftの先送りのバックログとし、Phase 1（schema変更なし）から着手できる。重いRACIやKPIは課さない。

## Traceability

- Related: `00_Prompt/domain.md`, `00_Prompt/ai_cognitive_externalization_requirements.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`（P-01/P-04/P-05）, `ADR-0032-product-value-realization-model.md`（V1–V3）, `ADR-0036`（VR2）, `ADR-0039`（段階適正化）
- Related: `02_Architecture/schemas.md`（DocumentV1 / CritiqueInput / EvidenceLink）, `02_Architecture/value_traceability.md` §2.1.1
- Derived-from: `01_Plans/issues/done/issue-PRODUCT-VALUE-02-ambiguity-evidence-workflow.md`（Representation boundary tableの保留判断を確定）
