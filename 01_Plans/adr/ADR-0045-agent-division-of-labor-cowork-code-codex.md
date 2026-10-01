# ADR-0045: 三エージェント（Cowork / Claude Code / Codex）の責務分担と協働プロトコル

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-06-10
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `00_Prompt/`, `01_Plans/`, リポジトリ運用

## Context

本プロジェクトは複数の生成AIエージェントで開発されている。だが現状の運用文書（`00_Prompt/agent_handover.md` / `handoff.md`）は **Codex 単独前提**で書かれており、次の3者の得意分野の違いと担当分担が定義されていない。

- **Claude Cowork**: 対話的な企画・意思決定支援・上流文書（00/01層）の整理に強い。
- **Claude Code**: リポジトリ内の多ファイル横断の読解・計画（ADR/issue）・実装・テスト駆動の検証・git 操作に強い。拡張（MCP）でブラウザ操作等も受け持てる。
- **Codex（デスクトップアプリ版）**: 実装の高速な反復と、**Chrome 操作によるアドホックな実機検証**（画面を実際に開いて確認）に強い。

実際に、複数エージェントが**同一ローカルワークツリーを共有して並行作業**した結果、作業中ブランチが他エージェントの `checkout`/`pull` で消える、未コミット変更が失われる、ADR 採番が衝突する（`ADR-0035` が二者で重複）といった事故が発生した。担当分担と協働プロトコルの不在が、価値生産より手戻りを生んでいる。

個人OSS段階（`ADR-0039`）でも、**誰が何を持ち、衝突をどう避けるか**の最小プロトコルは必要である。重量級の RACI ではなく、得意分野に基づく緩い分担と、事故を防ぐ具体的なgit規律で足りる。

## Decision

三エージェントの責務分担と、並行作業の衝突を防ぐ協働プロトコルを定義する。運用詳細の正本は `00_Prompt/agent_collaboration.md`（本ADRに基づき新設）とし、本ADRは決定（なぜ・何を）を記録する。

### 責務分担（得意分野ベース、排他でなく主担当）

| 領域 | 主担当 | 補助 | 根拠 |
| --- | --- | --- | --- |
| 企画・価値判断・上流(00/01)整理・合議 | Cowork | Claude Code | 対話的合意形成と思想の言語化が強み |
| ADR/issue 起票・多ファイル横断計画 | Claude Code | Cowork | リポジトリ全体の読解と文書整合が強み |
| 実装（frontend/backend）の高速反復 | Codex | Claude Code | デスクトップ版の反復速度 |
| テスト駆動の検証・回帰固定・git規律 | Claude Code | Codex | tsc/vitest/pytest と差分管理の確実性 |
| 実機アドホック検証（Chrome で画面確認） | Codex | Claude Code(MCP) | Codex の Chrome 操作。Claude Code は拡張導入時に補助 |
| リリース判定・品質ゲート統合 | Claude Code | Cowork | 横断チェックリストの機械的確認 |

非目標: 厳密な承認権限の固定（solo 段階では Maintainer 単独確定、`ADR-0039`）。エージェント間の自動連携・自動引き継ぎ機構の構築。

### 協働プロトコル（並行作業の衝突回避・必須）

過去事故への恒久対策として、全エージェントが次を守る。

- **CP-1 ブランチ専有**: 各作業は専用フィーチャーブランチで行い、`main` で直接作業しない。他エージェントの作業中ブランチに `checkout`/`reset`/`rebase` しない。
- **CP-2 こまめな push**: 節目ごとに `git commit` し、即 `git push -u origin <branch>` でリモート保全する（ローカル消失に備える）。未コミット変更を長時間放置しない。
- **CP-3 ADR/issue 採番の衝突回避**: 新規 ADR/issue 採番前に `git fetch` し、`origin/main` と全リモートブランチの最大番号＋1を採る。採番直後にプレースホルダをコミット＆push して番号を確保する。
- **CP-4 復旧手順**: ブランチが消えても reflog でコミット SHA は生存する。`git cat-file -t <sha>` で確認し、`git branch <name> <sha>` で復活、または現行 main 上へ cherry-pick で再配置する。
- **CP-5 main 反映は PR 経由**: `main` への直接 push は避け、フィーチャーブランチ → PR でマージする。
- **CP-6 範囲の明示**: タスク開始時に Scope（Docs/Frontend/Backend/Schema/どのブランチ）を宣言し、他エージェントの主担当領域への割り込みは事前合意または別ブランチで行う。

### Claude Code 拡張（MCP）の導入

Claude Code が実機検証等を補助できるよう、再現性のある形で拡張設定をリポジトリに整備する（`.claude/` 配下）。導入の詳細手順と設定ファイルは `00_Prompt/agent_collaboration.md` と `.claude/README.md` に記す。Codex の Chrome アドホック検証を置換するのではなく、Claude Code 側でも最小の確認ができる選択肢を増やす位置づけとする。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 複数エージェントが同一ローカルワークツリーを共有して並行作業した結果、作業中ブランチが消える・未コミット変更が失われる・ADR採番が衝突する等の事故が発生。得意分野に基づく緩い分担と事故を防ぐgit規律の最小プロトコルが必要 | 機能: 企画はCowork主・実装はCodex主・検証とgit規律はClaude Code主と担当を明示。データ: 重量級RACIではなく得意分野ベースの分担（ADR-0039準拠） |
| **データ設計** | 運用詳細の正本は`00_Prompt/agent_collaboration.md`（新設）とし、本ADRは決定（なぜ・何を）を記録。`.claude/`配下に拡張設定を再現手順とともに文書化 | 業務: CP-1ブランチ専有・CP-2こまめなpush・CP-3採番衝突回避・CP-4復旧手順・CP-5 PR経由マージで並行作業の衝突を構造的に防ぐ。機能: 実機検証はCodex主・Claude Code補助 |
| **機能設計** | 協働プロトコルCP-1..6を全エージェントが遵守。採番前にgit fetchして最大番号+1を取り、採番直後にプレースホルダをコミット&pushで確保 | 業務: 非目標は厳密な承認権限固定・エージェント間の自動連携機構の構築。データ: プロトコル遵守はエージェントの自己規律に依存（強制機構なし） |

## Consequences

- 期待される効果:
  - 得意分野に基づく分担で、各エージェントの強みが活き、手戻りが減る。
  - CP-1..6 により、並行作業のブランチ消失・採番衝突が構造的に防げる。
  - 実機検証の担い手が明示され（Codex 主・Claude Code 補助）、検証の空白が減る。
- 想定される副作用/制約:
  - プロトコル遵守の徹底はエージェントの自己規律に依存（強制機構は持たない）。
  - 拡張導入は環境差（OS・アプリ版）に影響されうる → 設定は再現手順とともに文書化する。
- 移行時に必要な対応:
  - `00_Prompt/agent_collaboration.md` を新設（責務分担表＋協働プロトコル＋拡張導入手順の正本）。
  - `.claude/` に設定と README を整備する（別作業として本ADR配下で実施）。
  - `AGENTS.md` の Read Order / Project Map に新文書を追加する。

## Traceability

- Related: `00_Prompt/agent_handover.md`, `00_Prompt/handoff.md`
- Related: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`（solo段階・軽量運用）
- Derived-from: 2026-06 並行作業で発生したブランチ消失・ADR採番衝突（`ADR-0035` 重複）の実事故
