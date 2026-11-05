# ADR-0011: 価値→要求マッピング（ADR-0001分割）

- Status: Accepted
- Date: 2026-02-24
- Deciders: Project Maintainers
- Scope: `01_Plans/`
- Derived-from: `01_Plans/adr/ADR-0001-value-to-requirements.md`

## Context

UX/Data/AI要求が価値原則と混在しており、要件レビュー時に参照範囲が大きい。

## Decision

要求マッピング（UX / Data / AI / review flags / safeMode制約）を独立管理する。
バックログ連携とチケット化ルールは別ADRで扱う。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | UX/Data/AI要求が価値原則と混在すると要件レビュー時の参照範囲が大きい。要求マッピング（UX/Data/AI/review flags/safeMode制約）を独立管理する | 機能: 仕様変更時に要件差分のみレビュー可能にする。データ: 要求は価値原則（ADR-0010）に整合させる |
| **データ設計** | ADR-0001の「2. 価値観ごとの要求」「3. Backlog整合」を本ADRへ独立させる。各価値原則（P-01〜P-09）に対するUX/Data/AI要求を対応表で保持 | 業務: 計画ADR（ADR-0012）とのトレーサビリティを改善。機能: バックログ連携とチケット化ルールは別ADRで扱う |
| **機能設計** | 要求マッピングを参照しやすい単位に分割し、実装の受入条件として利用できるようにする | 業務: 各要求は「利用者ができること（UX）/表現・永続化（DATA）/AIの許可・禁止（AI）」の形式で記述。データ: review flagsとsafeMode制約を要求レベルで固定 |

## Consequences

- 仕様変更時に要件差分のみレビュー可能。
- 計画ADRとのトレーサビリティが改善する。

## Traceability

- Superseded by（一部）: `ADR-0089`（価値の「現在の定義」に関する運用部分。原則・不変条件・モデルそのものは `ADR-0010`・`ADR-0032`・`ADR-0041` が引き続き正本）
- Derived sections: `ADR-0001` の「2. 価値観ごとの要求」「3. Backlog整合」
- Related: `ADR-0010`, `ADR-0012`
