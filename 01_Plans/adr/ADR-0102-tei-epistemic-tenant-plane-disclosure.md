# ADR-0102: TEI epistemic 候補をテナント業務面へ公開するか

- Status: Proposed
- Date: 2026-10-22
- Deciders: Maintainer（本ADRは判断材料であり、公開の有無と方式の決定は Maintainer が行う）
- Scope: テナント業務面の epistemic 関連 endpoint（本ADRで新設の有無を判断する）と、それと一体の frontend wiring 設計の前提。`03_Implement/frontend/src/ui/`、`03_Implement/backend/src/sui_sensemaking_api/`
- Related: `ADR-0089`（価値の正本）、`ADR-0090`（認知支援の候補層と段階昇格）、`ADR-0101`（TEI epistemic projection transport、Option A 採択済み）、`ADR-0072`（コントロールプレーン認可）、`ADR-0068`（SafeModeのAPI境界）、Issue #3184、PR #3261

## 価値への寄与

V3「レビュー」と P-07「self-host/privacy」に関わる。epistemic projection を利用者の確認導線に接続するかどうかは、レビューの価値（未確認は確定しない、意味の崩れと整合の崩れを早期に見える化する）に直接関わる判断である。ADR-0089 §6 の区分では、公開そのものは「運搬の便利さ」に属し、さしあたっての意義は、接続するときの安全境界（テナント境界・SafeMode・provider=none の成立）を事前に固定することにある。

いずれの案でも次のCVIは緩和しない前提で比較する。

- SafeMode は既定 ON であり、epistemic 表示は提案・候補としてしか現れない。
- `human_reviewed` と confirmation / use state は人間だけが設定する。epistemic endpoint は書き換えない。
- `SUI_LLM_PROVIDER=none` でも主要価値が成立する。epistemic 候補が無い状態で、利用者の主要機能が欠けないこと。

## Context

2026-10-22 時点の外部・内部前提である。

- ADR-0101 で Option A（SUI 所有の adapter、同一信頼境界内の局所 I/O）が採択済みである。SUI バックエンドは、生成済み TEI Reference JSON artifact を局所 I/O で読む部品と、コントロールプレーンに限って公開する endpoint（`GET /admin/tei-epistemic/artifacts/{kind}`、`SUI_TEI_REFERENCE_DIR` 未設定なら fail closed）を持つ（PR #3261）。
- frontend 側は検証済みである。`epistemic_review_model.ts`（semantic contract と representation schema を別々に検証し、drift を SUI で再計算する consumer）、`epistemic_projection_adapter.ts`（`tei.reference.epistemic-assessment/v0` の変換）、unavailable / partial / drift indeterminate のfixture-driven な表示層が揃っている。App / SidePanel / canvas への wiring は未接線である。
- 利用者（レビュー者）のUIに epistemic 候補を出すには、テナント業務面での読み取り経路と、artifact と文書の紐付けが要る。TEI Reference の artifact は運用者レベルの資料であり、現在の契約では artifact がどのテナントのどの文書についてのものかを記録していない。詳細参照の query は observed snapshot（fingerprint 群）だけであり、この snapshot は文書本文の派生物だが、未レビューの本文そのものは含まない。

課題は、wiring を実データへ接続する前に、業務面の公開をめぐる安全境界を決めておくことである。雑に公開するとテナント境界と SafeMode の前提を損なう。閉じたままにすると、#3184 の目的（高速な確認導線の実証）が fixture と運用者診断の間で止まる。

## 判断を分ける観点

1. **紐付けの根拠**: artifact をテナントの文書へ結び付けるのは誰か、何をもって正とするか（運用者による明示登録か、fingerprint 照合による一致か）。
2. **snapshot の露出範囲**: 観測スナップショット（meaning / review subject / review log sequence 等）をテナント業務面の応答へ載せてよいか、載せるならどの認可を通すか。
3. **書き込みとの分離**: epistemic 表示から確認・拒否をどう起こすか。read 側を `observed*` 意味論にせず、write 側の `expected*` 楽観同時実行制御を維持する（ADR-0101 非目標を踏襲）。
4. **provider=none / 未接続時の成立**: TEI 未接続・artifact 無しの配置で、利用者の主要機能が変わらないことを何で保証するか。

## 比較する選択肢

### 案A: 公開しない（現状維持）

epistemic projection と detail は、運用者がコントロールプレーンで確認する診断データに留める。利用者のUIには出さない。

- 安全境界を触らずに済む。マージ済みの transport 部品だけで成立する。
- #3184 の利用者向け実証は留まる。fixture 駆動の表示層と運用者診断では、利用者にとっての価値実感に届かない。

### 案B: 文書単位の紐付けを管理面で登録し、テナント業務面の読み取り endpoint で提供する

運用者が TEI を実行した assessment / detail を、明示的に「このテナントのこの文書のもの」と管理面で紐付けて登録する。業務面は `GET /docs/{docId}/epistemic/projection`、`GET /docs/{docId}/epistemic/detail` のような読み取り endpoint を、通常のテナント認証・文書閲覧認可（既存の access control adapter と policy binding）を通して提供する。

- 利用者の確認導線に届く。ADR-0090 の候補層（認知支援）として段階昇格を経て UI へ出せる。
- 新たに要るもの: 管理面の紐付け登録（(tenant, doc, artifact) の参照と登録簿）、業務面の読み取り endpoint、wiring。紐付けは追加のみで、削除は運用者の明示に限る。
- 書き込みは分離する。epistemic 表示からの確認・拒否は既存の write 経路（人間が実行する）だけに結線する。
- 代償: 紐付けの運用負荷。また、紐付けの粗い検証のまま出すと、文書と合わない候補を表示してしまえるため、表示側はconsumerの整合検証（drift 矛盾は fail closed）に依存する。

### 案C: SUI バックエンドが文書単位で TEI を実行する

artifact の読み取りではなく、TEI Reference の CLI 実行を SUI バックエンドが行い、その結果を業務面へ出す。

- 紐付けの運用負荷が SUI 側の自動化で減る可能性がある。
- 実行環境（ホスト負荷、subprocess の安全な起動、失敗時の fail closed を含む transport 実行の設計）が別途要るため、公開の判断と実行の判断を重ねて動かすには大きい。まず案Bの紐付けで実証した後に扱うことができる。

## 共通の安全不変条件（いずれの案でも緩和しない）

- epistemic データ（projection / detail）は DocumentV1 / Canonical state へ保存も埋め込みもしない（ADR-0101）。
- projection / detail は提案・候補のみであり、確認・拒否を自動適用しない。
- 詳細参照の query に authorization の access ref を入れない。endpoint も access ref を要求・出力しない（ADR-0101）。
- 業務面の endpoint は既存のテナント認証・文書認可・テナントセッション前提を通る。endpoint 専用の認可（admin onlyの可否を含む）が必要な場合は、登録簿と合わせて同じADRの実装で示す。
- epistemic 経路が無い・落ちている配置でも、`SUI_LLM_PROVIDER=none` と同様に主要価値が成立する。未検証の表示は無いのと同じに倒れる。
- 表示は SafeMode と独立した fail closed を持つ（unavailable / partial / drift indeterminate のfixtureが固定済み）。

## 非目標

このADRで決めない事項。

- UI wiring の設計の細部（配置、i18n文言の設計）。表示層の fixture 固定は既に済んでおり、wiring 設計と一体で踏襲する。
- TEI Reference CLI を SUI 内で subprocess 実行するかの判断。実行する場合は別のADR（案Cの具体化）として扱う。
- read 側を `observed*` 意味論へ置き換えること。write 側の `expected*` 楽観同時実行制御は維持する。

## Consequences（決定後に確定する事項）

- 案B を採った場合: 管理面の紐付け登録簿と業務面の読み取り endpoint の実装、`02_Architecture/api.md` の契約、contract test、frontend fetch と wiring が続いて始まる。
- 案A を維持した場合: #3184 は運用者診断と fixture の検証で留まり、利用者への接続は次の外部前提を待つ。
- どちらの場合も、共通の安全不変条件（Document への非保存、提案のみ、access ref 拒否、drift 再計算、provider=none での成立）は transport と公開方式に依存しない不変条件としてテストで追跡し続ける。

## Traceability

- Issues: #3184
- Related: `ADR-0089`, `ADR-0090`, `ADR-0101`, `ADR-0072`, `ADR-0068`
- Supersedes: なし
