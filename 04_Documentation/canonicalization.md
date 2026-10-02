# Canonicalization

対象読者: import/export、差分比較、AI提案の根拠確認を行う利用者、開発者、QA。

目的: sui-sensemakingでいうcanonicalizationの考え方と、利用者が確認すべき境界を説明します。

読後にできること: 「同じ内容なら同じ形にそろえて比較する」という考え方を理解し、import/exportやAI提案の確認時に見るべき点を判断できます。

## 概要

canonicalizationは、同じ意味のデータを同じ形にそろえる処理です。

たとえば、人が見れば同じ内容でも、JSONのキー順、空白、生成時刻、trace idが違うだけで、機械的には別物に見えることがあります。sui-sensemakingでは、そのような表記ゆれや一時的な情報に左右されず、カード、島、関係、レビュー状態、bundle hashなどを安定して比較できるようにします。

これは「内容が正しいことを保証する仕組み」ではありません。canonicalizationは比較を安定させるための土台です。内容の妥当性は、人間のレビュー、受け入れ確認、スキーマ検証などで判断します。

## 前提知識

この文書を読むために、hashやschemaの細かい実装を知っている必要はありません。次の3つだけ押さえてください。

| 用語 | ここでの意味 |
| --- | --- |
| 正規化 | 表記ゆれや順序の違いをそろえること |
| hash | 内容が同じかを確認するための短い識別値 |
| 一時情報 | 生成時刻、trace id、処理時間など、内容そのものではない情報 |

## 使われる場面

canonicalizationは、利用者が直接操作する機能というより、確認や安全判定を支える仕組みです。

- JSONをimportするときの検証。
- exportしたファイルを再度読み込むときの比較。
- AI提案が、どの入力データを根拠にしているかを確認するとき。
- 受け入れ確認や回帰テストで、不要な差分を見分けるとき。
- review済み、未reviewの境界を確認するとき。

## 利用者が確認すること

通常の利用では、内部の正規化手順を追う必要はありません。次の観点だけ確認してください。

1. 同じ入力から同じ結果が再現されること。
2. 生成時刻、trace id（追跡用ID）、provider応答時間などの一時情報を、内容判断の主根拠にしていないこと。
3. AI提案に根拠hashがあっても、それだけで自動採用しないこと。
4. SafeMode、share/export、個人情報保護の境界を、canonicalizationの都合で緩めていないこと。

判断に迷う場合は、canonicalizationの結果を「比較しやすくする補助情報」として扱い、人間のレビューを優先してください。

## import/export の確認

import/exportで問題を切り分けるときは、次の順で確認します。

1. exportしたファイルを保管する。
2. 同じファイルをimportする。
3. カード、島、関係、レビュー状態が意図どおり復元されることを確認する。
4. 不要な内部メモ、秘密情報、一時情報が含まれていないことを確認する。
5. 差分が出た場合は、内容差分なのか、表示順や一時情報だけの差分なのかを分けて記録する。

## AI 提案との関係

AI提案では、提案の根拠になったbundleと提案内容が対応しているかを確認するためにhashを使います。

hashが一致しない場合は、古い入力や別の状態に基づく提案の可能性があります。その提案は採用せず、保留または再生成してください。

hashが一致していても、提案はまだ「候補」です。内容の正しさ、少数意見の扱い、未レビュー情報の混入、秘密情報の有無は、人間が確認します。

## 正本

詳細なschemaと設計上の根拠は、次の文書を参照してください。

- [schemas.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/schemas.md)
- [architecture.html](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/architecture.html)
- [ce2_low_risk_ai_assist.md](ce2_low_risk_ai_assist.md)

## 関連文書

- [diagnostics.md](diagnostics.md)
- [acceptance_check.md](acceptance_check.md)
- [narratives.md](narratives.md)
