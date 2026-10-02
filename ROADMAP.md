# ROADMAP

価値の定義と現在の証拠状態は [`ADR-0089`](01_Plans/adr/ADR-0089-product-value-canon.md) が正本です。

SUI Sensemaking は、まとまりきらない定性資料や観察を、早すぎる分類・要約・合意で潰さず、出典・異論・保留・来歴を残したまま構造化し、後から根拠へ戻れる共有可能な理解へ育てる道具です。1人の開発者が生成AIを用いて開発しています。

## 中核原則

- 意味を急いで閉じない（Ambiguity Preservation）
- 人間が決める。AI出力はproposal-onlyで、`human_reviewed` は人間だけが設定する
- SafeModeを既定とする
- オフライン / 自前ホストを選べる。`SUI_LLM_PROVIDER=none` でも主要価値が成立する
- 出典・異論・保留・判断履歴へ戻れる

## 現在地

KJキャンバス、島・関係・保留、SafeModeのshare/export、import hardening、外部AIとのproposal往復、LLM入力IR（`AI-IR-PROJECTION` 完了）は実装済みです。

## 未完・次の作業

1. **`check-narrative` のscale方式**: 現行は全量送信で入力約14万token（無料枠モデルでの参考値）。本番で使うprovider/modelの実token予算を確認し、全量維持か分割かを決める。
2. **価値の検証**: T3パイロット（2026-10-02）で H1 は narrow、H3 は modify、H4 は narrow（`ADR-0089` §5、`provisional`）。次は、答えを先に与えない初回体験への再構成を実画面で確認し、T2（自分の実務利用）で追う。
3. **初回体験**: 回復用フォールバックは公開パックと同期済み（テスト追加。frontendテストは未実行）。getting startedを、答えを先に書かず自分の判断と理由を残す手順へ再構成する（H3）。
4. **認知支援のT2確認**: `ADR-0090` に従い、まずprovider不要の決定論的候補をMaintainer自身のSUI以外の実務資料で確認する。候補提示前後で「新たに注意した材料」「構造の見直し」「保留・異論の維持」「ノイズ／誘導」を分けて観察する。T2で認知増分が再現しなければ製品候補へ昇格せず、下位方式では埋まらない欠落が残る場合にだけ軽量統計・疎方式を次に検討する。
   - 実行補助: backend rootで `python scripts/review_cognitive_candidate_t2.py --document <DocumentV1.json> --phase baseline` を先に実行して人間側の見立てを記録し、文書を変更せず `--phase candidates` を実行する。両出力の `Source SHA-256` が一致することを確認する。

機能追加より、価値と認知増分の確認を優先します。実使用で同じ摩擦が再現したものから実装を昇格します。

## 将来候補（約束ではない）

- 大規模な質的統合（類似カード統合、島の階層化、鳥観と詳細の往復）
- AI・認知器による認知支援（`ADR-0090`）。決定論的構造方式 → 軽量統計/疎方式 → semantic方式の順で検討し、T3は探索上の provisional Evidence、T2で同じ認知上の欠落・増分が再現されたときに製品候補へ昇格する。SafeMode・Evidence・Provenanceは方式と独立に維持する
- 定額/オフラインAIとの協働（外部AIへ文脈を書き出し、結果を構造化提案として受け取る）
