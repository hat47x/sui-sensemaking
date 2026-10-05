# ADR-0008-cli-tooling-plan: CLI導入計画（MVP後正式化の親ADR）

- Status: Accepted
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Migrated-from: legacy draft `phaseX_cli_tool.md` (removed)

## Context

`phaseX_cli_tool.md` で管理していたCLI構想をADR運用へ移管した。
ただしMVP未完成時点で詳細仕様を確定すると、API/Schema/Securityの上位文書との不整合を生みやすい。

## Decision

### 1) 本ADRの役割（固定）

- 本ADRは **CLI計画の親ADR** とし、詳細仕様は分割ADRに委譲する。
- TODOを削除せず、正式化条件（Gate）を満たすまで「計画メモ」扱いを維持する。

> TODO（維持）: CLI文書は現時点で要件精度が十分ではない。MVP後に本ADR群を土台として再合意し、正式仕様へ昇格させる。

### 2) 分割ADRの責務（重複排除）

- `ADR-0015`: CLIの対象範囲・段階導入・フェーズGate
- `ADR-0016`: CLIのコマンド契約・互換性・受入テスト粒度
- `ADR-0017`: CLIのセキュリティと運用のGate、監査との整合

### 3) 今決めること / 後で決めること

#### 今決めること（本ADRで確定）

1. CLI計画の判断基準（価値・安全・スキーマ整合）を固定参照にする。
2. 実装着手は分割ADRのGateを満たした場合のみ許可する。
3. CLI仕様変更は「範囲 / 契約 / 安全運用」のどれを変更したかを明示する。

#### 後で決めること（MVP後に正式化）

- 個別コマンド仕様の最終確定。
- APIキーとprincipalモデルの最終定義。
- MCPを導入するときの運用の細目。

## Formalization Gate（判定可能化）

CLI計画を「正式仕様」に昇格するための必須条件。

### Gate-1: Value Gate

- `01_Plans/adr/ADR-0001-value-to-requirements.md` の価値基準に対して、CLI目的が説明可能。

### Gate-2: Architecture Gate

- `02_Architecture/api.md` / `02_Architecture/schemas.md` に存在しない概念を確定仕様として宣言していない。

### Gate-3: Safety Gate

- `THREAT_MODEL.md` と `04_Documentation/security.md` に反する運用を標準導線にしていない。

### Gate-4: Operations Gate

- `04_Documentation/operations.md` と運用手順が矛盾しない。

### Gate-5: Verification Gate

- ADR-0016/0017で定義した受入コマンド粒度が、実装PRの検証項目として再現可能。

## DoD（この親ADRの完了定義）

1. 確定範囲と保留範囲が見出しで一目判別できる。
2. 分割ADR（0015/0016/0017）で責務重複がない。
3. Gate-1〜5が、レビュー記録で合否判定可能な文で記述される。

## Non-Goals

- CLI実装コードの追加。
- 未合意API仕様の確定拡張。
- 独断での運用ポリシー追加。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | CLI構想をADR運用へ移管するが、MVP未完成時点で詳細仕様を確定するとAPI/Schema/Securityの上位文書と不整合を生みやすい。本ADRをCLI計画の親ADRとし詳細仕様は分割ADRに委譲する | 機能: 正式化条件（Gate）を満たすまで「計画メモ」扱いを維持。データ: 未合意API仕様の確定拡張と独断での運用ポリシー追加は非目標 |
| **データ設計** | CLI計画の詳細仕様を分割ADR（ADR-0015スコープ・0016契約・0017安全）へ委譲し、親ADRは入口（判断軸とGate）に専念する | 業務: MVP後に実装着手する際に合意済み範囲から着手できる。機能: 上位文書（API/Schema/Security）との整合を維持 |
| **機能設計** | CLI計画の判断軸とGateを親ADRで固定し、詳細は分割ADRで管理する。TODOを削除せず正式化条件まで計画メモ扱いを維持 | 業務: 実装着手の判断をGateで行い早すぎる確定を抑制する。データ: 親ADRは判断軸とGateに専念し詳細を分割管理する |

## Consequences

- ADR-0008は「入口（判断軸とGate）」に専念し、詳細は分割ADRで管理できる。
- MVP後に実装着手する際、合意済み範囲から着手できる。

## Traceability

- Source: legacy draft `phaseX_cli_tool.md` (removed)
- Related: `01_Plans/adr/ADR-0015-cli-scope-phasing.md`
- Related: `01_Plans/adr/ADR-0016-cli-command-contract.md`
- Related: `01_Plans/adr/ADR-0017-cli-security-ops-checks.md`
- Related: `01_Plans/adr/ADR-0001-value-to-requirements.md`
- Related: `02_Architecture/api.md`
- Related: `02_Architecture/schemas.md`
- Related: `THREAT_MODEL.md`
- Related: `04_Documentation/security.md`
- Related: `04_Documentation/operations.md`
