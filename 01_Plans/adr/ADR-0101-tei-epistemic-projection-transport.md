# ADR-0101: TEI epistemic projection の transport 方式

- Status: Accepted（仮承認、2026-10-22）
- Date: 2026-10-22
- Deciders: Maintainer（2026-10-22 に仮承認。本承認までは仮承認として扱う）
- Scope: `03_Implement/frontend/src/ui/epistemic_review_model.ts`、`03_Implement/frontend/src/ui/epistemic_projection_adapter.ts`、transport 接続経路（両案に共通の安全境界）
- Related: `ADR-0089`（価値の正本）、`ADR-0090`（認知支援の候補層と段階昇格）、Issue #3184、SUI PR #3255、TEI #1055（access-aware detail resolver、merged）、TEI #1057（qualification、closed）

## 価値への寄与

V3「レビュー」と P-07「self-host/privacy」に関わる。また CVI の「SafeMode 既定 ON」「provider=none でも主要価値が成立する」を接続時にも維持するかを決める判断である。ADR-0089 §6 の区分では「運搬の便利さ」に属し、手動の代替経路（fixture を使った検証、CLI 実行）が当面は存在するため、即時性より接続時の安全境界を固定する意義を持つ。

## Context

外部前提は 2026-10-21 時点で次の状態である（Issue #3184）。

- TEI #1055 の access-aware detail resolver は merged、Qualification #1057 は closed。
- TEI Reference は CLI と、corpus / context / detail-query / detail-access の JSON ファイル群として提供されている。SUI から呼べる HTTP provider はまだない。
- SUI 側には、`epistemic_review_model.ts`（semantic contract と representation schema を別々に検証し、drift を SUI で再計算する consumer）と、PR #3255 の adapter（`tei.reference.epistemic-assessment/v0` を `EpistemicProjectionInput` へ変換し、未知 contract/schema・不正 enum・重複 assertion・欠落 authorityLimits で fail closed）がある。
- 詳細参照の query は、meaning / review subject / target binding / review log sequence / metadata state の観測スナップショットだけを持つ。authorization の access ref は semantic query に入れない。

共通の制約として、どの transport を採っても、次は変えない。

- TEI Assessment を SUI の Document / Canonical state へ埋め込まない。
- contract と schema を別々に検証し、未知・不正は fail closed する。
- detail result の `accessRefs` を拒否する。access ref は opaque な入力としてのみ扱い、認可の権限を出さない。
- `statementKind=instruction` に prompt control authority を与えない。
- producer の drift を盲信せず、SUI で current Assessment から drift を再計算する。drift が矛盾すれば fail closed、`indeterminate` を semantic change へ読み替えない。

## 比較する2つの選択肢

### 案 A: SUI が所有する adapter（同一信頼境界内のローカル実行）

SUI バックエンドが、同じホスト（または同一テナントの信頼境界内）で TEI Reference の CLI 出力・JSON を読み、検証して projection を UI へ渡す。transport はファイルや subprocess の局所 I/O である。

- **今日成立している。** TEI Reference の現状の提供形態（CLI/JSON）がそのまま使える。実在する接続にだけ実 production provider wiring を足せる。
- **機微資料が境界を越えない。** 観測スナップショットは端末内に留まり、SafeMode の送信閉止と独立に、設計上 external に流れない。
- **offline / `SUI_LLM_PROVIDER=none` と構造的に両立する。** CVI を損なう前提が生じない。
- **代償: 版ずれの運用を SUI が担う。** TEI Reference の更新に SUI 側が追随し、版の不一致は fail closed で止める（adapter はこれを実装済み）。検証は TEI 側の qualification 出力を使う。
- **代償: 実行環境の置き場所は SUI 側が選ぶ。** モデルを要する検証は SUI を動かすホストに負荷が寄る。

### 案 B: TEI 側 HTTP endpoint（access-aware detail resolver を service として呼ぶ）

TEI サイドが access-aware detail query の HTTP endpoint を追加し、SUI は HTTP で呼ぶ。

- **検証と resolver の実装が TEI に一元化される。** SUI 側は transport の版ずれを version header 等で検知すればよい。
- **依存を足す。** runtime に TEI の HTTP provider が必要になる。SUI core の主要価値（provider=none 成立、offline）を保つには、同じ信頼境界内に自前運用可能であることまで含めて判断する必要がある。
- **送信境界の対象が増える。** 観測スナップショットは利用者の文書から派生する。自前運用であっても、文中の未レビュー内容が HTTP を越える経路になるため、既存の LLM 送信境界（レビュー状態による閉止）と同じ取り扱いを明示的に設計する必要がある。境界外運用なら、CVI と衝突する。

## 決定を分ける観点

1. **信頼境界の位置**: self-host / privacy をどこまでに定義するか。同一信頼境界内なら案 B のHTTPも許されるか、それとも端末内に限るか。
2. **offline・provider=none の成立範囲**: 接続先が無い・落ちている場合に、主要価値が変わらないことをどう保証するか。
3. **運用と追随**: TEI Reference の更新をどちらが pin して検証するか。fail closed の時点がどちらで発火するか。
4. **未レビュー本文の派生物の流れ**: 観測スナップショットが HTTP を越えるか否かと、それに付けるレビュー状態による閉止の有無。

## Decision

**案 A（SUI が所有する adapter を、同一信頼境界内でローカル実行する）を採る。**

決定を分ける観点への答えは次のとおり。

1. 信頼境界: 観測スナップショットは SUI を動かすホストの外へ出さない。HTTP で TEI へ送る経路は作らない。
2. offline・provider=none: 接続先を持たないので、TEI Reference の出力が無い・読めない場合は projection を表示しないだけで、SUI の主要価値は変わらない。
3. 運用と追随: TEI Reference の版は SUI 側で pin する。版の不一致は、PR #3255 の adapter が fail closed で止める。
4. 未レビュー本文の派生物: HTTP を越えないため、LLM 送信境界と同じ閉止を新たに設計する必要がない。

理由: TEI Reference は今日 CLI と JSON で提供されており、案 A はそのまま成立する。案 B は、TEI 側の HTTP provider がまだ無く、成立させるには送信境界の設計を新たに要する。案 B は、TEI 側が提供を始めた時点で、本ADRを Supersede して改めて比べる。

## 非目標

このADRでは決めない事項。

- App / SidePanel / Card / canvas への production provider wiring（transport 決定後に扱う）。
- 詳細参照 UI の設計。unavailable / partial / drift indeterminate の fixture-driven な UI 表示固定は、UI wiring の設計と一体で行う。
- SUI の read-side を `observed*` 意味論へ置き換えること。write-side の `expected*` 楽観同時実行制御は維持する。

## Consequences

- 案 A の接続経路で、非目標に置いた wiring の実装を始める（Issue #3184）。provider は interface の背後に置き、fixture と、ローカルのファイル・CLI の読み取りを差し替えられるようにする。
- 採択されなかった案は、TEI 側が提供を始めた場合でも本ADRの選択肢として残る。切り替えが生じた場合は Supersede する。
- どちらを採っても、上記の共通の制約（fail closed、access ref 拒否、drift 再計算、Document への埋め込み禁止）は transport に依存しない不変条件としてテストで追跡する。

## Traceability

- Issues: #3184
- Related: `ADR-0089`, `ADR-0090`
- Supersedes: なし
