# ADR-0047: 設計判断ADRの一巡完了と execution-first への転換

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-06-10
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `01_Plans/`, リポジトリ運用

## Context

`ADR-0036`〜`ADR-0046` で、プロダクト価値・社会的目標・ガバナンス・ドメイン表現・根幹価値保護・UI/UX品質・エージェント分担・性能の各設計判断を一巡して固定した。これに加え `ADR-0000`〜`ADR-0035` と `02_Architecture/*`、`01_Plans/issues/*` が既存領域を覆っている。

「引き続きADRを作成」の要請に応えるため、全12設計次元を多エージェントで横断スイープし、各ギャップ候補を敵対的反証にかける監査を実施した（2026-06-10）。インフラ事由（セッション制限）でエージェント実行は完走しなかったが、メインループによる事実確認で次を確定した。

- **配布/Static Publish**: `ADR-0038` 柱3（`SOCIAL-DIFFUSION-03` 証拠定着型の安全配布、SafeMode配布既定ON、ROADMAP方式A/C整合）で被覆済み（VR5として延期方向）。
- **observability/error-recovery**: `PRODUCT-OPS-01`（Done）/`PRODUCT-OPS-02`（Open）でissue被覆・実行中。
- **security姿勢**: `THREAT_MODEL.md` / `SECURITY.md` / `ADR-0017` / CVI-1（`ADR-0041`）で被覆。
- **AI品質**: `llm_quality_strategy.md` / `02_Architecture/llm_escalation_policy.html` / `llm_input_ir_spec.md` / `llm_runtime_constraints.md` で被覆。
- **i18n / privacy / testing-CI / extensibility / export-interop / contributor-onboarding / collaboration-future**: それぞれ既存ADR/doc/issue（ROADMAP localization・`src/i18n` テスト群・`ADR-0019`・`ADR-0007` future-backlog・`schemas.md` pack契約・`CONTRIBUTING.md`＋`agent_collaboration.md`・ROADMAP長期）で被覆、または `ADR-0039` により適切に延期。

triageは `actionable_adrs=0`（ADRが作業をブロックしていない）、一方active issuesは約22件（うちready約12件）＝実行待ちが豊富。

この状態で新規の設計判断ADRを起票し続けることは、`ADR-0039`（個人OSS・プレリリース段階の過剰ガバナンス回避）が禁じるover-governanceに該当する。設計判断の層は現段階で健全に飽和した。

## Decision

設計判断ADRの新規起票を一旦停止し、優先をexecution（既存issueの実装・検証）とdogfood（`ADR-0042`）へ転換する。

- 現時点で「最も不足しているもの」は新しい設計判断ではなく、確定済み設計判断の実行である。次の作業優先度を以下とする。
  1. `ADR-0042` の最小ドッグフード経路を1回完走し、実使用から摩擦点を発見する。
  2. 既存ready issue（UI/UX a11y拡充、性能アサーション、DOMAIN-EXPR後続、PRODUCT-VALUE受入）を実装・検証する。
  3. 価値ゲート（`PRODUCT-QA-01`）と不変条件の砦（`ADR-0041` CVI横断テスト）を緑に保つ。

### ADR 再起票の基準（次に ADR を作るべき条件）

惰性での起票を防ぎ、かつ必要時に確実に再開するため、新規ADRは次のいずれかが成立したときのみ起票する。

- **R-1実使用の摩擦**: ドッグフード（`ADR-0042`）または実利用で、設計トレードオフを伴う摩擦が顕在化した。
- **R-2段階遷移**: 外部協力者の継続参加、または公開リリースで実ユーザーが付いた（`ADR-0039` 再導入トリガー）。延期中の役割分離・観測スコアカード（`ADR-0037`）・社会的普及（`ADR-0038`）のactivation判断が必要になる。
- **R-3非機能境界の超過**: 新機能が既存の予算・不変条件（CVI `ADR-0041` / 複雑性 `ADR-0043` / UQ `ADR-0044` / 性能 `ADR-0046`）で覆えない境界を越える。
- **R-4破壊的契約変更**: `schemas.md` のversion gateを超える破壊的変更（`version: 3`）が必要になる。

いずれにも該当しない「念のため」「それっぽい」ADRは起票しない。

### 非目標

- 既存ADRの再掲・分割のための新規採番。
- 飽和判定を理由とした既存issueの凍結（実行はむしろ加速する）。
- ADR運用そのものの停止（再起票基準R-1..4に該当すれば通常どおり起票する）。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 設計判断の層は12次元の監査で健全に飽和し、新規ADRの起票はover-governanceに該当する。優先をexecution（既存issue実装）とdogfood（ADR-0042）へ転換する。「ADRが増えない＝停滞」という誤読を防ぐため停止は実行への転換であると明示 | 機能: 既存ready issueの実装・検証を加速。データ: value_traceability.md §2.4を被覆の正本として維持 |
| **データ設計** | 新規ADRはR-1..4（実使用の摩擦・段階遷移・非機能境界超過・破壊的契約変更）のいずれかが成立したときのみ起票。惰性での起票を防ぎ必要時に確実に再開する | 業務: 「念のため」「それっぽい」ADRを起票しない。機能: 予算・不変条件（CVI-0041/0043/0044/0046）をR-3の判定基準として活用 |
| **機能設計** | 次優先は①ADR-0042最小ドッグフード経路1回完走②既存ready issue実装③価値ゲートとCVI砦テストを緑に保つ。736kトークンのギャップ監査は本ADRが結論の正本 | 業務: 以後の作業は新規ADRでなく既存issue/dogfood起点。データ: 飽和判定はsolo・プレリリース・ユーザー無しの現段階限定 |

## Consequences

- 期待される効果は次のとおりです。
  - 「引き続きADRを作成」に対し、飽和の事実と再起票基準で答えられ、over-governanceを防げる。
  - 736kトークンを要した今回のギャップ監査を再実行せずに済む（本ADRがその結論の正本）。
  - 価値生産の重心が計画から実行・実証へ移る。
- 想定される副作用/制約は次のとおりです。
  - 「ADRが増えない＝停滞」と誤読されうる → 本ADRで「停止は実行への転換であり停滞ではない」を明示。
  - 飽和判定は現段階（solo・プレリリース・ユーザー無し）限定。R-2で容易に解除される。
- 移行時に必要な対応は次のとおりです。
  - `AGENTS.md` のProject Mapに本ADRを追加する。
  - 以後の作業は新規ADRでなく既存issue / `ADR-0042` ドッグフードを起点にする。

## Traceability

- Related: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`（過剰ガバナンス回避・再導入トリガー）
- Related: `01_Plans/adr/ADR-0042-value-realness-validation-and-notice-exit.md`（ドッグフードによる摩擦発見＝R-1）
- Related: `02_Architecture/value_traceability.md` §2.4要件被覆マトリクス（被覆の正本）
- Related: `01_Plans/adr/ADR-0041`/`ADR-0043`/`ADR-0044`/`ADR-0046`（予算・不変条件＝R-3の判定基準）
- Related: `01_Plans/adr/ADR-0000-adr-governance.md`（起票トリガー）
- Derived-from: 2026-06-10全12設計次元のギャップ監査（workflow wf_c6883b17-831＋メインループ事実確認）
