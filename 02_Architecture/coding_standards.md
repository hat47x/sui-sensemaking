# コーディング規約（Simple & Secure）


> 環境変数・実行パラメータの正本は `02_Architecture/runtime_parameter_registry.md`。本書では必要最小限のみ記載し、追加/改名時は正本を先に更新する。
この文書は、`sui-sensemaking` のコードを シンプル かつ セキュア に保つための、実務向けルールとレビュー観点を定義します。

- 対象: `03_Implement/frontend` / `03_Implement/backend`
- 優先順位: `00_Prompt` / `01_Plans` / `02_Architecture` に従う
- バッドスメル是正の意思決定: `01_Plans/adr/ADR-0018-coding-standards-and-smell-remediation.md`

---

## 1. 規約（必須）

### 1.1 シンプルさ（複雑性制御）

1. 責務分割
   - 1ファイル1責務を原則とする。
   - UIコンポーネントは「表示」「状態管理」「ドメイン処理」を分離する。
2. ファイル肥大化の抑制
   - 新規追加時は300行を超える前に分割を検討する。
   - 既存巨大ファイルへの機能追加時は、同時に最小1単位の抽出（hook / util / component）を行う。
3. 重複排除
   - 同一ロジックが2回以上出る場合は関数化する。
   - UI色・余白・フォントは定数化して再利用する。
4. 命名
   - 識別子は英語で、意図が読める名前にする（略語はドメイン既知のみ）。

5. 長期保守性を最優先する
   - 本プロジェクトは長期運用を前提とし、短期的な場当たり修正より、変更容易性と回帰耐性を優先する。
   - 設計判断では 疎結合・高凝集 を優先し、依存方向を明確に保つ。
6. 設計原則の実践
   - SOLID / DRY / KISS / YAGNI / 単一抽象度（SLAP）を実装判断の基準として使う。
   - 汎用化の根拠がない抽象化を追加しない（将来予測だけで拡張ポイントを作らない）。
7. 自己説明的なコードを優先
   - 命名と構造で意図が読める実装を優先し、コメントは「何をしているか」ではなく「なぜそうしたか」を補足する。

### 1.2 セキュリティ（安全な実装）

1. 入力検証を先に行う
   - APIは「存在確認」「型・範囲」「参照整合」をハンドラ先頭で検証する。
   - フロントエンドのimport/exportでもschema validationを省略しない。
2. 例外は狭く捕捉する
   - `except Exception` は原則禁止。
   - 期待する例外型（例: `ValidationError`, `JSONDecodeError`）を明示して捕捉し、ログ・メッセージを分ける。
3. 安全な既定値を維持する
   - SafeModeの既定ONを変更しない。
   - share/export系は「漏えいしない初期値」を守る。
4. 危険APIの禁止
   - `eval` / `new Function` / `dangerouslySetInnerHTML` は禁止（設計レビューで例外承認された場合のみ）。
5. 機密情報の直書き禁止
   - APIキーやトークンはコード・fixture・ログへ保存しない。
   - 設定は環境変数から注入する。
6. 型安全性を維持する
   - TypeScriptでは `any` と安易な型アサーション（`as any` / `!`）を原則禁止する。
   - 例外的に型緩和が必要な場合は、境界を局所化し理由をコメントまたはPRで明示する。

### 1.3 ドキュメンテーションとコメント

1. ドキュメンテーションの最小要件
   - 公開API・複雑な分岐・セキュリティ境界では、実装理由（Why）を簡潔に残す。
   - コメントは最新状態を保ち、実装と矛盾する説明を残さない。

### 1.4 テスト・検証

1. 変更に対応するテストを同時追加
   - バグ修正時は再現テストを先に書く（または同時に追加）。
2. 最低実行コマンド
   - Frontend: `npm run typecheck && npm run test`
   - Backend: `ruff check src tests && pytest`
3. セキュリティ境界を触る変更
   - import/export/safeMode/LLM連携は、正常系・異常系の双方をテストする。
4. アプリ改修時のE2E確認
   - `03_Implement/*` を変更した場合、原則 `docker compose` による `web+api+db` の連動確認を行う。
   - Docker未導入環境では、SQLite代替E2E（`backend:8000` + `frontend:4173`）で連動確認を行う。
   - UI変更時は原則Playwright E2Eテストを追加/更新する（最低: `npx playwright test e2e/i18n_locale_query_equivalence.spec.ts --reporter=line`）。
   - E2E手順の正本は `03_Implement/frontend/docs/e2e_testing.md` とし、利用者向けの確認手順は `04_Documentation/acceptance_check.md` に分離する。E2E手順を変更した場合は `installation.md` / `operations.md` / `CONTRIBUTING.md` との記述整合を同一PRで確認する。
   - 正本の判断が難しい不足・不整合は、あるべき状態を整理したIssueを起票してから同期する（ADRに作業トラッキングを混在させない）。
   - それでも実行不能な環境のみ、未実施理由・代替検証・後続確認手順・Compose未確認リスク差分をPRに記載する。

### 1.5 Frontend の品質ゲート

CIのfrontendゲートは `frontend-typecheck`（`tsc --noEmit`）と `frontend-test`（`vitest run` 全件）の2つであり、どちらも常時fail-on-errorとする。

独立したリンタは導入していない。`npm run lint` は `npm run typecheck` の別名である。将来実のリンタを入れる時点で専用ジョブと運用方針を足す。

---

## 2. レビュー時チェックリスト（PR貼り付け推奨）

- [ ] 変更は上位文書（`00_`〜`02_`）と矛盾しない
- [ ] 1ファイル1責務を守れている（巨大化していない）
- [ ] 重複ロジック・重複スタイルを追加していない
- [ ] 入力検証とエラーハンドリングが明示されている
- [ ] `except Exception` / `any` / 危険APIを増やしていない
- [ ] 影響範囲に対するテストを追加・更新した
- [ ] E2E証跡（Playwright追加/更新、または未実施理由・代替検証）をPR本文に記載した
- [ ] E2E関連ドキュメント（acceptance_check/installation/operations/CONTRIBUTING）を正本（03_Implement/frontend/docs/e2e_testing.md）と同期した
- [ ] E2E不整合の正本判断が難しい場合、Issueを起票した

---

## 3. 再発防止の運用ルール

1. 規約逸脱は「技術的負債」として明示
   - すぐ直せない場合は、Issueに「理由・解消期限・担当」を記録する。
2. 巨大ファイルは段階的に解体
   - 機能追加PRで最低1つ、責務を外部へ抽出する。
3. 静的検査の強化を継続
   - Frontend lint（ESLint導入など）をロードマップ管理し、CIで段階的に必須化する。
