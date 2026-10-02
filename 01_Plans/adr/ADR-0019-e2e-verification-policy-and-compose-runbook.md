# ADR-0019-e2e-verification-policy-and-compose-runbook: E2E確認方針とCompose実行手順の標準化

- Status: Accepted
- Date: 2026-02-26
- Deciders: Project Maintainers
- Scope: `01_Plans/`, `03_Implement/`, `04_Documentation/`, `CONTRIBUTING.md`

## Context

`sui-sensemaking` はCanvas/UI（Frontend）・API（Backend）・永続化（DB）の連動で価値を提供する。
このためunit/integrationが通過していても、結合境界で不整合が残ると人間レビュー時に
「実装不具合の切り分け」に時間を使い、仕様評価に集中できない。

本ADRの目的は次の1点に集約する。

- 人間が仕様を評価するフェーズでは、結合レベルのバグを極小化し、評価認知負荷を下げること。

また、開発/検証環境によっては `docker compose` が利用できないため、
非Docker環境でも同等の結合確認を継続できる方針が必要である。

---

## Decision

以下を標準運用として採用する。

### 1. 目的駆動の原則（なぜE2Eを行うか）

1. E2E確認は「デモのため」ではなく、仕様評価前に結合バグを除去する品質ゲートとして扱う。
2. `03_Implement/*` の変更では、原則E2E確認を必須とする。
3. UIを伴う変更では、PlaywrightベースのE2E追加/更新を原則必須とする。

### 2. 実行優先順位（どの経路でE2Eするか）

1. 第一選択: Compose統合経路（標準）
   - `web + api + db` を `docker compose` で起動し、実運用に最も近い構成で確認する。
2. 第二選択: SQLite代替経路（Docker未導入時）
   - `backend(SQLite)` + `frontend dev server` の2プロセスで、API/永続化/UI連動を確認する。
3. 第三選択: 例外記録（上記が実行不能な場合のみ）
   - ブロッカー・代替検証・後続手順をPRに明記し、未確認リスクを可視化する。

### 3. 最小受入基準（PRマージ前に満たすもの）

#### 3.1 共通（必須）

- ヘルス確認は次のとおりです。
  - Compose: `curl -fsS http://localhost:8080/api/healthz`
  - SQLite代替: `curl -fsS http://localhost:8000/healthz` と `curl -fsS http://localhost:4173/api/healthz`
- ドキュメント往復保存確認は次のとおりです。
  - `PUT /docs/{doc_id}` → `GET /docs/{doc_id}` が成功し、保存内容が保持される。

#### 3.2 UI変更時（必須）

- Playwrightでsmoke + 変更対象フロー1ケース以上を実行する。
- PR本文に実行コマンドと結果（pass/fail/未実施理由）を記載する。

### 4. sui-sensemaking向けE2E設計原則（将来拡張でも維持）

1. 仕様境界優先
   - カード編集、Island操作、保存復元、SafeMode、import/exportなど
     仕様の価値境界を優先してE2E対象を選ぶ。
2. 安全境界優先
   - SafeMode既定ON、漏えい防止、悪性入力拒否など安全性に関わる経路を優先する。
3. 決定論優先
   - flakeを避けるため、非決定的待機を減らし、入力と期待結果を固定する。
4. 最小維持コスト
   - すべてをE2Eで覆わず、unit/integrationとの責務分担を維持する。

### 5. 現時点で見えている実務課題（2026-02時点）

1. Docker未導入環境の存在により、Compose確認が常に実行できるとは限らない。
2. Frontend/Backendのローカル起動手順が分散すると、確認漏れが発生しやすい。
3. UI改修の増加に伴い、Playwrightシナリオを「価値境界ベース」で整理しないと肥大化する。

対処方針は次のとおりです。
- `03_Implement/frontend/docs/e2e_testing.md` をE2E実務手順の正本とし、
  シナリオ追加時はSmoke / Core / Safetyのどこを守るかを明示する。

### 6. ドキュメント同期ルール

- 以下の文書は本ADRと整合させる。
  - `04_Documentation/installation.md`
  - `04_Documentation/operations.md`
  - `04_Documentation/acceptance_check.md`
  - `03_Implement/frontend/docs/e2e_testing.md`
  - `CONTRIBUTING.md`
  - `02_Architecture/coding_standards.md`

### 7. 利用者向けドキュメントとの完全整合ルール

1. E2E手順の正本
   - `03_Implement/frontend/docs/e2e_testing.md` をE2E実施手順の正本（single source of truth）とする。
   - `04_Documentation/acceptance_check.md` は一般利用者向けの手動確認だけを扱い、Playwright実行手順を正本化しない。
2. 完全整合の対象
   - `acceptance_check.md` / `installation.md` / `operations.md` / `CONTRIBUTING.md` / `02_Architecture/coding_standards.md` に記載する
     E2Eコマンド、受入基準、代替経路（Docker未導入時）は、正本と同一意味で記述する。
3. 同一PR更新の義務
   - E2E関連のコマンド・判定基準・対象フローを変更した場合は、上記文書を同一PRで同期更新する。
4. 差分の明示
   - PR本文に「更新したE2E関連文書一覧」を記載し、利用者向け手順との差分が残らないことを示す。
5. 不足・不整合の解消手順
   - 利用者向けドキュメントとE2Eテスト方針の間に不足/不整合を検出した場合は、先に「あるべき状態（期待挙動・受入基準・実行手順）」を明文化したうえで、正本へ合わせて同期修正する。
   - どちらを正とすべきか容易に判断できない場合は、ADR本文に暫定判断を書かず、`ADR-0000` の分離ポリシーに従ってGitHub Issueを起票し、論点・選択肢・影響範囲を管理する。


---

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | unit/integrationが通過していても結合境界で不整合が残ると、人間レビュー時に「実装不具合の切り分け」に時間を使い仕様評価に集中できない。E2Eは仕様評価前に結合バグを除去する品質ゲートとして扱う | 機能: `03_Implement/*`の変更では原則E2E確認を必須としUIを伴う変更ではPlaywrightベースのE2E追加/更新を必須。データ: 結合不具合が仕様レビューに流入しにくくし人間は仕様評価に集中 |
| **データ設計** | 開発/検証環境によっては`docker compose`が利用できないため、非Docker環境でも同等の結合確認を継続できるSQLite代替経路（backend(SQLite)+frontend dev server）を第二選択として標準化 | 業務: 実行優先順位（Compose統合経路→SQLite代替経路→例外記録）を固定。機能: 実行不能な場合はブロッカー・代替検証・後続手順をPRに明記し未確認リスクを可視化 |
| **機能設計** | Playwrightの適用範囲を「価値境界ベース」で管理し回帰防止と運用コストを両立する。E2Eの目的・優先順位・受入基準を固定 | 業務: 将来機能拡張時もE2Eの判断軸を共有できる。データ: Compose経路はweb+api+dbを起動し実運用に最も近い構成で確認 |

## Consequences

- 結合不具合が仕様レビューに流入しにくくなり、人間は仕様評価に集中しやすくなる。
- 非Docker環境でもSQLite代替経路で連動確認を継続できる。
- E2Eの目的・優先順位・受入基準が固定され、将来機能拡張時も判断軸を共有できる。
- Playwrightの適用範囲を「価値境界ベース」で管理することで、回帰防止と運用コストを両立できる。

## Traceability

- Related: `03_Implement/deploy/docker-compose.yml`
- Related: `03_Implement/backend/README.md`
- Related: `04_Documentation/installation.md`
- Related: `04_Documentation/operations.md`
- Related: `04_Documentation/acceptance_check.md`
- Related: `03_Implement/frontend/docs/e2e_testing.md`
- Related: `CONTRIBUTING.md`
- Related: `02_Architecture/coding_standards.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`

## 8. Draft QA issue の昇格条件（PRODUCT-QA-01 / QA系共通）

Draft issueをOpenへ昇格させる最小条件を次で固定する。

1. Gate定義が `Go/No-Go` と証跡型（command log / screenshot / follow-up issue）を持つ。
2. 実行経路（Compose / SQLite / 例外記録）が事前選択され、未選択時は `Execution: Hold` を維持する。
3. 失敗分類は `test defect / product defect / environment limitation` の3語彙に正規化する。
4. No-Go時の戻し先issueと再開条件を1:1で記述する。
5. 自己修復上限は3回、4回目相当でStopとする。

### 8.1 Verify matrix（昇格判定）

| 観点 | Pass条件 |
| --- | --- |
| 判定可能性 | Gateごとに Go/No-Go 条件が明記される |
| 証跡可能性 | コマンド/結果/失敗分類/戻し先issueが追跡できる |
| 経路固定 | Compose/SQLite/例外のいずれかが事前選択される |
| 安全境界 | SafeMode既定ON・share/export境界のNo-Go条件がある |
| 自己修復 | 上限3回が明記される |
