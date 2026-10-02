# ADR-0000: ADRで設計判断を管理する方針

- Status: Accepted（2026-10-01改訂。旧版はgit履歴）
- Date: 2026-02-24
- Deciders: Maintainer
- Scope: `01_Plans/adr/`

## 価値への寄与

運用のみ。ADRが価値へ寄与するかを毎回確認する規則は `ADR-0089` §7を正本とする。

## Decision

- 長期的・横断的・破壊的な契約変更、安全境界の変更、複数の合理的選択肢が残る判断だけをADRにする。進捗やTODOは書かない（TODOは `ROADMAP.md`、理由はPR/コミット）。
- 採番は `ADR-NNNN` の連番。1 ADR = 1意思決定境界。目安は50〜180行。
- 必須: `Status` / `Date` / `Deciders` / `Scope`、章 `価値への寄与` / `Context` / `Decision` / `Consequences` / `Traceability`（`TEMPLATE.md`）。
- 変更は追記優先。置き換えは `Supersedes` / `Superseded by` で残す。
- 体制は1人＋生成AI。承認フロー・Decision Queue・三要素整合表は必須にしない。

## Consequences

- 判断の根拠と履歴がADRに集まり、運用文書は増えない。

## Traceability

- Related: `ADR-0039`, `ADR-0089`
