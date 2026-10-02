# ADR-0077: 島表札の凝縮（核融合法）第一級化 — 複数候補（candidates）と接地/凝縮の分離

- Status: Accepted
- Date: 2026-08-18
- Deciders: Maintainer
- Scope: `03_Implement/backend/src/sui_sensemaking_api/models_ai.py`, `routes/ai.py`, `02_Architecture/api.md`（suggest-island-summary契約）, `03_Implement/deploy/tools/mock_local_llm.py`

## Context

W型探求（2026-08-17〜18、R1問題提起〜R6手順計画、カード444枚）の結論として、sui-sensemakingの次段階の価値は「凝縮（核融合法）」にあると判明した。

- **現状**: `POST /ai/suggest-island-summary` は単一の `summaryText` を返す。`groundingIds`（接地・代表カード≤10）と `summaryText`（凝縮・志）が「唯一の答え」として一体に返るため、接地と凝縮が概念として混在している。
- **なぜ今必要か**: 川喜田の核融合法・04ステップでは、表札づくりは複数カードの「志」（こころ+指す、全体として能動的に訴えかけるもの）を汲み上げて1枚の表札へ凝縮する。この「志」は集約的・生成的なものであり、単発の自動採否ではなく、複数候補・代替候補・チャット壁打ちで対話的に収束するのが最適である（ユーザー要望・R4構想/R5具体策で合意）。
- **モデル分業（ADR-0065に整合）**: flash（グループ編成・仮要約・初期候補の多数生成）／pro（深い凝縮・違和感に応じた代替候補）／人間（志の確定adopt）。
- 比較した主要選択肢は次のとおりです。
  1. 単一候補のまま（現状維持）— 志の多様性を提示できず、壁打ち（Phase 2）の土台にならない。
  2. トップレベルに `candidates` を追加し、`summaryText`/`groundingIds` も残す（後方互換・加法）— 同一関係（志）を複数フィールドで表す二重管理になり、AGENTS.md §5(1)「同一関係を複数フィールドで表さない」に反する。
  3. `candidates` に一本化し、各候補が `summaryText`（凝縮）と `groundingIds`（接地）を別フィールドで持つ（破壊的・クリーン）— 接地と凝縮を候補単位で分離し、`suggest-document-title`（既に `candidates` を返す）と同じ形状に揃う。

## Decision

選択肢3を採用する。 `SuggestIslandSummaryResponse` を複数候補（`candidates`）へ一本化し、各候補が `summaryText`（凝縮・志）と `groundingIds`（接地・代表カード≤10）を別フィールドで持つ。

- 採用理由は次のとおりです。
  - 接地（品質ガード・代表カード≤10）と凝縮（核融合法・全カードの志）は別概念であり、候補ごとに接地が異なり得る（志が違えば代表カードも変わる）。候補単位で分離するのが唯一の整合表現。
  - `suggest-document-title`（`candidates`）との形状統一で、フロントエンドの複数候補UIを再利用できる。
  - `extra="forbid"` により、LLMが旧形式（`summaryText` 単独）を返した場合は422で拒否され、契約の一本化が強制される。
- 非目標（このADRで扱わない範囲）:
  - 壁打ち（Phase 2・島詳細チャットパネル、DOMAIN-EXPR-03の再提案の対話化）のUI設計 — 別issue/ADR。
  - 多段編成（Phase 3・`parentIslandId` CRUDと一行見出しの連鎖）— DOGFOOD-32。
  - 複層キャンバス（WorkingGraph/ContextProjectionGraph/Consensus分離）— 別ADR。
  - 本ADRでは `propose_island_summary` のProposalDiffは変更しない（`after`/`groundingIds` は `candidates[0]` から取り、人間の単一adoptの契約を維持）。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 定性分析者は島の表札づくりで、AIが提示した複数候補の「志」を比較し、壁打ち（Phase 2）で洗練して**人間が最終的に adopt** する。AIは自動適用しない（proposal-only 維持）。生成AI単独より質の高い洞察が価値 | 機能: 複数候補を提示し人間が選択する導線が必要。データ: 候補（志）は提案であり Document へ自動保存しない |
| **データ設計** | `groundingIds`（接地・代表カード≤10）と `summaryText`（凝縮・志）を候補単位で分離して表現する。複数候補は `suggest-island-summary` の応答にのみ現れ、Document へ永続化されるのは人間が adopt した `candidates[0]`（=ProposalDiff.after）のみ | 業務: 志は人間の確定前は「提案」であり、確定された志のみ文書に残る。機能: 接地の≤10・重複なし・メンバー限定の品質ガードを候補ごとに強制する |
| **機能設計** | `POST /ai/suggest-island-summary` が `candidates: list[_IslandSummaryCandidate]`（1〜3件）を返す。`POST /ai/proposals/island-summary` は `candidates[0]` を ProposalDiff（`field:"summaryText"`, `after`, `groundingIds`）へ写し、状態遷移は proposed→unreviewed→人間 adopt/reject のまま | 業務: proposal-only・human_reviewed の緩和禁止を維持（SafeMode 不変条件）。データ: 各候補の `groundingIds` は対象島のメンバーカードIDに限る |

## Consequences

- 期待される効果は次のとおりです。
  - 「志」の複数候補提示により、凝縮の質と人間の選択肢が向上する。
  - 接地と凝縮の分離で、核融合法（凝縮）と品質ガード（接地）の責務が明確になる。
  - `suggest-document-title` と形状統一され、複数候補UIの再利用が可能。
- 想定される副作用/制約は次のとおりです。
  - `SuggestIslandSummaryResponse` の形状が破壊的に変わる（外部APIクライアント・E2Eの `summaryText`/`groundingIds` 直下参照が `candidates` 参照へ変わる）。プレリリース（ADR-0039）のため許容。
  - 現行E2Eの `groundingIds` 部分一致グロブは `candidates[0].groundingIds` に一致し続ける（mockは候補[0]の接地を維持する）。
- 移行時に必要な対応は次のとおりです。
  - `models_ai.py`・`routes/ai.py`（prompt/parse/propose）・`mock_local_llm.py`・`api.md` を更新。
  - `test_llm_integration.py`・`test_kj_session_e2e.py`・`test_ce2_proposal_api.py` の直下フィールド参照を `candidates` へ更新。
  - `verify_business_flow_e2e.sh` に `candidates` 複数候補の固定を追加。

## Traceability

- Related: `01_Plans/adr/ADR-0065-llm-model-selection-by-task-complexity.md`（flash/pro分業）
- Related: `01_Plans/adr/ADR-0068-safemode-enforcement-at-api-boundary.md`（proposal-only・unreviewed境界）
- Related: `01_Plans/adr/ADR-0040-domain-expression-first-class-strategy.md`（DOMAIN-EXPR-03再提案 → 壁打ちへの発展）
- Related: `00_Prompt/sensemaking_technique.md` §3（表札検査）, `00_Prompt/ai_sensemaking_execution_procedures.md` §3（代弁文）
- Related: `01_Plans/issues/issue-DOGFOOD-33-*.md`（本ADRの実装issue）
- Derived-from: W型探求（2026-08-17〜18）R4構想・R5具体策・R6手順計画の結論
---
