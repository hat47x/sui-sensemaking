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
2. **価値の検証**: 一次利用仕事（`ADR-0089` §1）が、AI模擬参加者（T3）・自分の実務利用（T2）・実在の第三者（T1）のどれで支持/修正/棄却されるかを確かめる。判定は証拠階層を明記し、T3のみなら `provisional` とする。
3. **初回体験**: 初回サンプル（`03_Implement/frontend/public/packs/`）とgetting startedの題材を揃え、`App.tsx` の回復用フォールバックと食い違わないようにする。

機能追加より、価値と認知増分の確認を優先します。実使用で同じ摩擦が再現したものから実装を昇格します。

## 将来候補（約束ではない）

- 大規模な質的統合（類似カード統合、島の階層化、鳥観と詳細の往復）
- AIによる認知支援（複数provider・認知器を同じ境界から扱う。SafeMode・Evidence・Provenanceは自律度と独立に維持）
- 定額/オフラインAIとの協働（外部AIへ文脈を書き出し、結果を構造化提案として受け取る）
