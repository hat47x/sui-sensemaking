# ADR-0114: TEI handoffはローカルJSONの受け渡しを暫定採用する

- Status: Accepted（PoCの仮説。2026-11-01）
- Date: 2026-11-01
- Deciders: Maintainer（PoC優先の指示にもとづく仮説採用）
- Scope: `03_Implement/frontend/src/domain/epistemic_review_outbox.ts`、`03_Implement/frontend/src/ui/EpistemicReviewPanel.tsx`、TEI handoff
- Related: `ADR-0101`（TEI transport）、`ADR-0110`（handoffの境界）、`ADR-0111`（上位課題）

## 価値への寄与

V3「レビュー」とV4「共有と学習」に寄与する。TEIの確認intentを、ネットワーク送信を増やさずに人が受け渡せるようにする。SafeMode、未レビュー非公開、`human_reviewed`、proposal-onlyは緩和しない。

## Context

TEIの確認状態をSUIへ取り込むhandoffは、outboxまで実装した。しかし、TEI ReferenceにはHTTP providerがなく、SUIから送る先も決まっていない。ADR-0111は、TEI送信に進む条件を3回以上のT2観測としている。

PoCでは、その条件を待たずにhandoffの価値を確かめる必要がある。ネットワーク送信を作らず、人がファイルを持ち運ぶ方式なら、認証・監査・再送の設計を増やさずに試せる。

## Decision

TEIへのhandoffは、**ローカルJSONファイルの受け渡し**を暫定採用する。

- パネルの「handoff JSONを書き出す」を押したときだけ、`sui.epistemic-review-outbox/v1` を書き出す。
- ファイルには、`docId`、`recordedAt`、intentの識別子・fingerprint・operationだけを含める。カード本文、ナラティブ、秘密情報は含めない。
- 自動送信、バックグラウンド送信、TEIへの直接POSTは行わない。
- ファイルの受け渡しとTEI側の取り込みは、人が明示的に行う。
- ファイルを書き出しても、SUIの`human_reviewed`やReviewEventは変わらない。

## Five-Point Declaration

| 項目 | 宣言 |
|---|---|
| 方向 | handoff（SUI → 外部）。送信APIではない。 |
| データclass | 識別子とfingerprintだけ。未レビュー本文と秘密情報は含めない。 |
| 権限への効果 | なし。確認済み状態を自動で設定しない。 |
| 証拠の階層 | 現時点では無し。T2の利用観測を後で記録する。 |
| 可逆性 | ファイルの削除とoutboxの消去で戻せる。SUI側の状態は変わらない。 |

## Consequences

- ネットワーク送信、認証、監査、再送の実装は増えない。
- 人がファイルを運ぶため、受け渡しの履歴はSUIに残らない。必要になった時点で、受信側の記録か送信ADRを検討する。
- 3回以上のT2利用でファイル受け渡しが不足した場合、またはTEI側にHTTP endpointができた場合は、ADR-0111の送信条件へ戻り、新しいADRで置き換える。
- SafeMode、未レビュー非公開、`human_reviewed`、proposal-onlyの境界は変わらない。
