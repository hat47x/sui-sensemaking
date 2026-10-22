# ADR-0101: TEI epistemic projection の transport 方式の判断材料

- Status: Accepted (2026-10-22; Option A: SUI-owned local adapter)
- Date: 2026-10-22
- Deciders: Maintainer（本ADRは判断材料であり、transport の決定は Maintainer が行う）
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

## Decision

Maintainer は **Option A（SUI が所有する adapter、同一信頼領域内のローカル実行）** を採択する。

- 理由: `SUI_LLM_PROVIDER=none` / offline / self-host の安全不変条件を優先するため、観測スナップショットが信頼領域を越えない経路を既定にする。
- TEI Reference は CLI / JSON ファイル群のまま SUI バックエンドから局所 I/O で読み、contract/schema の検証と fail-closed を維持する。
- Option B（TEI HTTP endpoint）は、TEI 側が提供を始めても本 ADR の選択肢として残し、必要に応じて Supersede する。

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

## 非目標

このADRでは決めない事項。

- App / SidePanel / Card / canvas への production provider wiring（transport 決定後に扱う）。
- 詳細参照 UI の設計。unavailable / partial / drift indeterminate の fixture-driven な UI 表示固定は、UI wiring の設計と一体で行う。
- SUI の read-side を `observed*` 意味論へ置き換えること。write-side の `expected*` 楽観同時実行制御は維持する。

## Consequences（決定後に確定する事項）

- 採択された案の接続経路が ADR として Accepted へ更新され、非目標に置いた wiring の実装が始まる。
- 採択されなかった案は、TEI 側が提供を始めた場合でも本ADRの選択肢として残る。切り替えが生じた場合は Supersede する。
- どちらを採っても、上記の共通の制約（fail closed、access ref 拒否、drift 再計算、Document への埋め込み禁止）は transport に依存しない不変条件としてテストで追跡する。

## Traceability

- Issues: #3184
- Related: `ADR-0089`, `ADR-0090`
- Supersedes: なし
