# `.claude/` — Claude Code プロジェクト設定（再現性のある導入手順）

本ディレクトリは、このリポジトリで **Claude Code** を使うエージェント／開発者が、同じ前提・同じ補助機能で作業できるようにするための設定とガイドです。

- 背景・決定: `01_Plans/adr/ADR-0045-agent-division-of-labor-cowork-code-codex.md`
- 協働の運用正本: `00_Prompt/agent_collaboration.md`
- AI 向け入口: `../AGENTS.md`

> 役割の位置づけ: 実機のアドホック検証は **Codex（Chrome 操作）が主担当**。Claude Code は MCP 拡張が使える環境で **最小の補助確認**を担う（`agent_collaboration.md` §4）。

---

## 1. 管理対象ファイル

| ファイル | 役割 | git 管理 |
| --- | --- | --- |
| `.claude/settings.json` | プロジェクト共有設定（秘匿情報を含めない） | する |
| `.claude/settings.local.json` | 個人ローカル設定（トークン・個人許可など） | **しない**（`.gitignore`） |
| `.claude/README.md` | 本書（導入手順の正本） | する |

`settings.json` には現在、安全な既定のみを置いている。

```json
{
  "env": { "SUI_LLM_PROVIDER": "none" }
}
```

`SUI_LLM_PROVIDER=none` は `domain.md` / `ADR-0041`（CVI-6）の「provider=none 既定でも価値が成立」を、Claude Code セッションの既定としても明示するもの。

---

## 2. 推奨 permission（各自が `/permissions` で追加）

権限の allow ルールは**自動付与しない方針**（エージェントが自分の権限を勝手に広げないため）。
権限プロンプトを減らしたい場合は、各自が Claude Code の対話で `/permissions` を開き、次を **allow** に追加する（すべて読み取り専用・検証系で安全）。

```
Bash(git status:*)
Bash(git diff:*)
Bash(git log:*)
Bash(git fetch:*)
Bash(git show:*)
Bash(git cat-file:*)
Bash(python3 01_Plans/issues/validate_active_issue_memos.py:*)
Bash(python3 01_Plans/triage_actionable_plans.py:*)
Bash(python3 -m unittest:*)
```

破壊的・外向き操作（`git push` / `git commit` / `git reset --hard` / `git push --force`）は **allow にしない**（その都度確認）。`ADR-0045` CP-2/CP-5 の git 規律と整合する。

個人で恒久的に許可したい場合は `.claude/settings.local.json`（git 管理外）に記述する。例:

```json
{
  "permissions": {
    "allow": ["Bash(git status:*)", "Bash(git diff:*)", "Bash(git fetch:*)"]
  }
}
```

---

## 3. MCP 拡張（実機検証の補助）

Claude Code でブラウザ実機の最小確認を行う場合、MCP サーバ（例: `claude-in-chrome` / preview 系）が利用可能な環境で使う。

### 3.1 前提（フロントエンドを起動して確認できる状態）

```bash
# WSL: node20（既定 v12 では Vite が動かない）
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
cd 03_Implement/frontend
npm ci                 # 初回のみ（約35秒）
npm run preview        # http://127.0.0.1:4173
```

### 3.2 補助確認の範囲（MCP がある場合）

- preview（`http://127.0.0.1:4173`）を開き、表示崩れ・主要導線（開始→カード→選択コンテキスト→共有前確認）の到達を最小確認する。
- 自由なアドホック探索は Codex（Chrome）に委ねる。Claude Code は再現可能な確認（e2e／source-string contract）を優先する。

### 3.3 MCP が無い環境での代替（必須の回帰は常にこちら）

```bash
cd 03_Implement/frontend
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 20
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/vitest/vitest.mjs run
node ./node_modules/playwright/cli.js test --reporter=line
```

MCP の有無に関わらず、**マージ判定は e2e と単体テストの事実**で行う（実機目視は補助）。

---

## 4. 安全境界（全エージェント共通）

- `domain.md` の禁止事項（AIが保留を勝手に解消しない／`human_reviewed` 自動昇格しない等）と SafeMode 既定ON を侵さない（`ADR-0041` CVI）。
- `.claude/settings.local.json` 以外に秘匿情報（トークン・鍵）を置かない。
- 設定変更は再現性のため本書を更新してから行う。
