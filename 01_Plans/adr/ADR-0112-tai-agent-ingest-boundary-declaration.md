# ADR-0112: TAI・agentの提案ingestは境界だけを先に宣言する

- Status: Accepted（境界宣言。実装の承認ではない。2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（上位課題のPoC優先指示にもとづく）
- Scope: `01_Plans/adr/`、TAI・agent連携、`02_Architecture/api.md`の将来拡張
- Related: `ADR-0108`（段階2は必要性が観測されるまで作らない）、`ADR-0111`（外部認知インターフェースの上位課題）、`ADR-0093`（agent資格情報）、Issue #3271

## 価値への寄与

V3「レビュー」とV4「共有と学習」に寄与する。外部agentの観察を提案として受け取る場合でも、人間の判断権と未レビュー非公開を保つ境界を先に固定する。本文のingestはまだ行わず、content-freeの登録だけを既存の範囲で維持する。

## Context

TAIはagentの書込みAPIを接続の詰まりとして挙げている。しかし、具体的な入力例、頻度、認可、監査、undoの単位が決まっていない。ADR-0108は、これらが揃うまで提案ingestを作らないと決めた。

上位課題（ADR-0111）では、提案ingestを四類型の一つとして扱う。実装を急がず、境界だけを先に宣言しておけば、必要になったときに安全条件を再議論せずに済む。

## Decision

### 1. 五つの宣言

| 項目 | 宣言 |
|---|---|
| 方向 | 外部agent → SUIの提案。読み取りの逆方向は既存の投影だけとする。 |
| データclass | 本文は受け取らない。識別子、proposalKind、sourceBundleHash、proposalFingerprintだけを扱う。SafeModeや表示設定でレビュー済みにしない。 |
| 権限への効果 | 提案のみ。`human_reviewed`、`textReviewed`、確定、共有を自動で設定しない。 |
| 証拠の階層 | 現時点では無し。実装前にT2/T3の利用観察と、認可・監査の技術テストを必要とする。 |
| 可逆性 | 提案ごとのundo、冪等キー、受信監査を必須とする。重複受信は同じ提案へ寄せる。 |

### 2. 実装の前提

既存の `/ai/external-proposals/register` は、content-freeのメタデータ登録として実装済みである。本文のingestは、次のすべてが揃うまで作らない。

1. TAIまたは他の利用者から、本文のingestで足りる具体的な入力例と頻度が出る。
2. `tenantId + docId` 単位の認可が、既存のaccess-controlと矛盾しない。
3. 本文の保存先、未レビューの扱い、SafeModeでの表示、保持期間、監査eventの項目を決める。
4. undoと重複排除の単位を決める。
5. 新しいADRで、`api.md`の契約と実装範囲を固定する。

本文を受け取らない現行の登録は、このADRの範囲で維持する。本文のingestを追加するときは、上の5点を満たす新しいADRを起こす。

### 3. 既存の読み取り境界との関係

- MCPは読み取り専用のままにする。提案ingestをMCPのツールとして追加しない。
- agent資格情報のallowlistは広げない。受信面は別の認可経路として設計する。
- TEIのhandoff outboxは、SUIから外部への記録であり、このingestとは方向が逆である。同じoutboxへ混ぜない。

## Three-Element Verification（自己適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| 業務 | 外部agentの観察は提案として受け、人間が判断する | 機能: 自動確定のAPIを作らない。データ: 未レビューのまま保存する。 |
| データ | 提案本文は受け取らず、識別子とfingerprintだけを保存する | 業務: 人間のレビューを経て初めて共有する。機能: 冪等キーとundoを持つ。 |
| 機能 | content-freeの登録だけを維持し、本文ingestは前提が揃うまで作らない | 業務: 具体的な入力例を待つ。データ: 監査と重複排除の単位を先に決める。 |

## Consequences

- content-freeの提案登録は実装済みである。本文のingestは未着手のままである。ADR-0108の判断を変更しない。
- 将来、本文のingestを追加するときは、この5点を満たすか確認し、満たさない場合は新しいADRで変更理由を書く。
- MCPの読み取り専用、agent資格情報のallowlist、TEI handoffの方向は変わらない。
- SafeMode、未レビュー非公開、`human_reviewed`、proposal-onlyの境界は変わらない。
