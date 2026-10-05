# ADR-0078: 整合性予算（IC）の新設と、プロダクト価値に沿った包括的検査計画

- Status: Accepted（2026-08-29、仮承認。利用者からの委譲に基づく暫定決定であり、特別に重大な安全境界変更を伴わないため実行フェーズへ移行）
- Date: 2026-08-21
- Deciders: Maintainer（委譲された意思決定権限）
- Scope: `02_Architecture/value_traceability.md`, `01_Plans/issues/`, `03_Implement/backend/tests/`, `03_Implement/frontend/src/`

## Context

利用者から「処理全体の整合性やUI上のスムーズさはプロダクト価値において重要であり、プロダクト価値に沿って包括的に検査する計画を整理してほしい」との要望があった。着手前に、既存の枠組みで既にカバーされている範囲を確認した。

### 既にカバーされている範囲（重複を作らないための棚卸し）

sui-sensemakingは既に、価値に沿った品質次元をIDで索引化する仕組みを持つ（`value_traceability.md`）。

| 既存の次元 | 正本 | 対象 |
|---|---|---|
| CVI（根幹価値の不変条件） | `ADR-0041` | SafeMode・proposal-only・human_reviewed 等の安全境界 |
| CB（複雑性予算） | `ADR-0043` | 認知負荷・初期表示の静けさ |
| UQ（UI/UX品質次元） | `ADR-0044` | 操作到達性・a11y・i18n・レイアウト・状態可視性 |
| PB（応答性の性能予算） | `ADR-0046` | メインスレッドブロック・体感待機 |
| GENAI-GOV（生成AIレーン境界） | `value_traceability.md` §2.9 | AI経路のデータ境界・レビュー境界 |

さらに `PRODUCT-QA-01`（Done）がG0〜G7（計画整合・安全・主要操作・i18n・画面耐性・公開文書・診断・ビルドと回帰）とV0〜V4（価値ゲート）をリリース候補ごとに判定する枠組みを既に定義している。**「UI上のスムーズさ」はG2/G4とUQ/PBが既にほぼ全域をカバーしている**（後述の非目標を参照）。

一方、`03_Implement/backend/scripts/check_contract_drift.py` と `test_ts_python_contract_drift.py` が、API↔`api.md`、Pydanticフィールド↔`schemas.md`、frontend client↔backend route、環境変数↔`runtime_parameter_registry.md` の**構造的な**一致を自動検査している。

### 見つかった本物の穴：「整合性」に索引化された次元が無い

CVI/CB/UQ/PB/GENAI-GOVと異なり、**「整合性」には、CVI表のようにID付きで棚卸しされた対応表が存在しない。** 検査自体は複数存在するが、「どの境界が」「どの検査で」「自動か手動か」を一望できる場所がない。

この空白は仮説ではない。本セッション中だけで、以下の実例が見つかっている（`git grep -l "drift\|ドリフト\|整合しない\|食い違"` は `01_Plans/issues` と `01_Plans/adr` と `02_Architecture/*.html` だけで37件ヒットする）。

| 実例 | 種別 | 発見経路 | 既存の自動検査での検出可否 |
|---|---|---|---|
| `AI-REL-VOCAB-DRIFT-01`（Done） | 凍結仕様間の語彙不一致（IR `related/arrow/negation` 3値 vs キャンバス5値） | 手動監査（`canvas-projection-asymmetry-2026-08-09.html`） | **不可**（`check_contract_drift.py`はTS↔Python構造一致のみで、仕様書間の語彙整合は対象外） |
| `DOMAIN-SCORING-SURFACE-01`（In Progress） | 同一不変条件（`domain.md`「AIは内容を採点せず」）がAI経路（backend）にしか防御されておらず、クライアント決定論計算（frontend）に同種の採点面が残存 | 手動監査（セキュリティレビュー系列） | **不可**（`test_ai_anti_scoring_contract.py`はbackendのみを対象とし、frontend側に対応する検査が無かった） |
| `functional-dependency-integrity-2026-08-06.html` F-5 | 島所属（カード→島）の関数従属性が実装で強制されていない | 手動監査 | **不可**（データモデルの関数従属性を検査する自動テストが無い） |
| `SEC-TENANT-SESSION-01` | `secrets.token_urlsafe()`の出力形式と`_TENANT_SESSION_VERSION_PATTERN`の不整合（3.10%棄却） | 手動監査＋実測 | 一部可（該当テストが偶発的な失敗として検出していたが、原因特定は手動だった） |

これら4件に共通する性質は、**「構造（フィールド名・型）は一致しているが、意味・不変条件が一方の実装面にしか反映されていない」**というドリフトである。`check_contract_drift.py`系はこの種類を原理的に検出できない（フィールド名の集合比較であり、「同じルールが両面で守られているか」は評価しない）。この種のドリフトを恒常的な自動検査にするには、個々のルールごとに専用のアサーションを書く必要があり、汎用化が難しい（`ADR-0039`の物量抑制方針とも整合しない）。**したがって、この次元は自動検査を新設するのではなく、既存の点検査を索引化し、定期的な手動監査で埋める。**

### なぜ今この判断が必要か

`ADR-0069`（LLM投入IR）、`ADR-0076`（共同編集の並行性）、`DOMAIN-SCORING-SURFACE-01` など、複数の独立した実装面にまたがる機能が増えている。実装面が増えるほど、「同じルールをどの面が守っているか」を索引せずに把握することは難しくなる。**放置するほど、この種のドリフトを見つける経路が『たまたま監査した』ことに依存し続ける。**

## Decision

### D1: 整合性予算（IC）を新設し、`value_traceability.md` へ索引化する

CVI/CB/UQ/PBと同じ形式で、**IC（Integrity/Consistency）次元**を定義する。CVI/CB/UQ/PBが「何を守るか」を定義するのに対し、ICは「守るべきものが実際に両面（または全面）で守られているか」を横断的に一覧する。

| IC ID | 整合性境界 | 種別 | 担保（既存） | 充足度 |
|---|---|---|---|---|
| IC-1 | TS↔Python 型のフィールド集合一致（`DocumentV1`関連12型） | 構造 | `test_ts_python_contract_drift.py`（`KNOWN_TS_ONLY_GAPS`許可リスト方式） | 充足（自動） |
| IC-2 | API実装↔`api.md`のエンドポイント一致 | 構造 | `check_contract_drift.py` チェック1 | 充足（自動） |
| IC-3 | Pydanticフィールド↔`schemas.md`の一致 | 構造 | `check_contract_drift.py` チェック2 | 充足（自動） |
| IC-4 | frontend APIクライアント↔backend routeシグネチャ一致 | 構造 | `check_contract_drift.py` チェック3 | 充足（自動） |
| IC-5 | 環境変数↔`runtime_parameter_registry.md`の一致 | 構造 | `check_contract_drift.py` チェック4 | 充足（自動） |
| IC-6 | 文書間の相互参照リンク切れ（`02_Architecture`等の追跡HTML） | 構造 | `DX-DOC-07`（docs_check） | 充足（自動） |
| IC-7 | historyディレクトリのbacklinkメタデータ整合 | 構造 | `check_history_metadata`（`docs_contract_checks.py`） | 充足（自動、本セッションでバグ修正済み） |
| IC-8 | 凍結仕様間の語彙一致（例: LLM投入IR↔キャンバス関係語彙） | **意味** | なし（`AI-REL-VOCAB-DRIFT-01`で個別修正のみ） | **未**（自動検査なし） |
| IC-9 | 同一不変条件の全実装面カバレッジ（例: 反スコアリングがbackend/frontend両方に効くか） | **意味** | 一部（`test_ai_anti_scoring_contract.py`はbackendのみ。`DOMAIN-SCORING-SURFACE-01`で発覚） | **薄い**（片面のみ自動検査） |
| IC-10 | `DocumentV1`内の関数従属性（例: カード→島の所属一意性） | **意味** | 一部（drag&drop経路は`moveCardToIsland()`で解決済み。統合経路は`issue-DOMAIN-ISLAND-MEMBERSHIP-01`で対応中） | **薄い**（書込み経路の一部は解決済みだが、検知機構が無く統合経路に別のギャップを2026-08-29の監査で新規発見） |
| IC-11 | ADR/issue間のバッククォート引用パスの正確性 | 構造 | `DC-LNK-002`（`docs_contract_checks.py` `check_code_span_citations`。`RETIRED_CITATION_TARGETS`許可リスト方式） | 充足（自動）。初回監査で244件の不整合を実測して`DX-DOC-09`を起票（2026-08-21）、同issueで検査を新設し446件を修正・退役文書への歴史的引用62件を許可リスト化した（2026-08-29） |

**「充足」列が構造系（IC-1〜7）に集中し、意味系（IC-8〜10）が薄い／未であるという非対称が、この索引の主要な発見である。** これはCVI/UQ/PBの索引化パターン（`ADR-0044`）をそのまま踏襲しており、「薄い／未の次元のみを改善issue化する」（`ADR-0039`）という既存運用にそのまま乗る。

### D2: 「整合性」の包括的検査は、自動検査の新設ではなく**定期的な監査パス**で埋める

IC-8〜10のような意味的ドリフトは、汎用的な自動検査に一般化しにくい（個々の不変条件ごとに専用ロジックが要り、点検査の物量化になる。`ADR-0039`に反する）。したがって:

- **新しい自動チェッカーは作らない**（非目標、後述）。
- 代わりに、**リリース候補または大きな機能追加のまとまりごとに、意味的整合性の監査パスを1回実行する**。本セッションで実施した「セキュリティレビュー」「canvas-projection-asymmetry調査」と同じ手法（コードを実読し、同じ不変条件が別の実装面でも守られているかを確認する）を使う。これを都度アドホックに行うのではなく、**IC表への記録を伴う定期作業として位置づける**。
- 監査パスは `PRODUCT-QA-01` のG7（ビルドと回帰）の一部として、リリース候補時に実行する。通常PRでは、変更が意味的整合性境界（IC-8〜11）に触れる場合のみ対象とする。

### D3: 「UI上のスムーズさ」は新次元を作らず、UQ/PBの再検査パスとして扱う

UQ（`ADR-0044`）とPB（`ADR-0046`）は既にUI操作性・応答性を包括的に定義しており、`QA-MONKEY-20..32`（全件Done）が実際にexploratory testingで多数の欠陥（キーボードフォーカス喪失系が大半）を発見・修正した実績がある。**この経路は機能している。** 新しい枠組みは不要で、以下を提案する。

- UQ/PBの充足度判定（`value_traceability.md` §2.7/§2.8）は2026-06〜07時点のものであり、`ADR-0069`（IR）、`ADR-0076`（共同編集）等、その後の実装増分を反映していない。**次回リリース候補時に、UQ-1〜6・PB-1〜5の充足度を現行コードで再確認し、判定日を更新する。**
- `QA-MONKEY`系のexploratory testingパターン（起点issue→harness実行→発見→個別issue化→Done）を、UI変更が一定量蓄積した時点で再実行する。新規issueの命名は既存の`QA-MONKEY-NN`連番を継続する。

## 非目標

- 意味的整合性ドリフト（IC-8〜10）を検出する汎用自動チェッカーの新規実装。個々の不変条件専用の検査は、その不変条件を導入するADR/issue自身が担う（例: `DOMAIN-SCORING-SURFACE-01`が反スコアリングのfrontend側検査を追加するのはそのissueの責務であり、本ADRの責務ではない）。
- ビジュアルリグレッション（スクリーンショット差分）基盤の新設（`ADR-0044`の既存非目標を継続）。
- WCAG等の外部適合認証取得（`ADR-0044`の既存非目標を継続）。
- UQ/CVI/PB/CBの再定義・再構成。ICは既存4次元を置き換えず、隣接する新次元として追加する。
- IC表の「充足」項目（IC-1〜7）に対する追加検査の新設。既に自動化されており、対象外。

## Consequences

### 期待される効果

- 「整合性」が初めてID付きで索引化され、CVI/UQ/PB/CBと同じ運用（薄い/未のみ改善issue化）に乗る。
- 構造的ドリフト（自動検査あり）と意味的ドリフト（自動検査困難）が明確に区別され、後者を「見つからなかった」のではなく「見つけに行く運用が要る」ものとして扱えるようになる。
- リリース候補ごとの意味的整合性監査パスが `PRODUCT-QA-01` G7の一部として制度化され、次に見つかる同種のドリフトが「たまたま監査した」ことに依存しなくなる。

### 想定される副作用・制約

- 監査パスは人間（またはAIエージェント、L2以上）による実読が主体であり、CI等では自動化されない。実行漏れのリスクは残る。
- IC-8〜11の「未／薄い」判定は、本ADRの起票時点の棚卸しに基づく。新しい実装面が増えるたびにIC表への追記が要る（`value_traceability.md`の更新ルールに従う）。

### 移行時に必要な対応

1. `value_traceability.md` に「§2.10整合性予算（IC）正本対応表」としてIC-1〜11の表を追記する。
2. `PRODUCT-QA-01` のG7判定条件に「意味的整合性監査パス（IC-8〜11が変更範囲に触れる場合）」を追記する。
3. IC-9（`DOMAIN-SCORING-SURFACE-01`）は既に個別issueで追跡中のため、新規issueは起票しない。**IC-11は本ADR起票直後に初回監査パスを実際に実行し、244件の不整合を実測し、`DX-DOC-09`を起票した**（構造的ドリフトであり機械検査可能なため、意味的ドリフトの類型とは対応方針が異なる。IC-11の非目標欄・§D2記述を参照）。**IC-10は2026-08-29の追加監査で、書込み経路の一部（drag&drop）が既に解決済みである一方、別の書込み経路（統合/canonicalization）に未解決の重複所属ギャップを新規発見し、`issue-DOMAIN-ISLAND-MEMBERSHIP-01`を起票した**（`ADR-0069` D3の実装前提）。IC-8は次回監査パスの実行時に対応要否を判断する（2026-08-29時点でDocumentV1関連4enumおよび外部連携仕様を横断的に確認したが追加のドリフトは確認していない。現時点でBlocker/Majorに該当する実害は確認していない）。
4. 次回リリース候補時に、UQ/PB充足度の再確認（D3）を実施する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 「プロダクト価値に沿った包括的検査」を、UI操作性（既存UQ/PBで充足）と整合性（未索引だった）に分解し、後者のみを新次元として埋める。監査は都度アドホックではなく、リリース候補ごとの制度化された監査パスとして行う | 機能: 新しい自動チェッカーは作らない（IC-8〜10）。データ: IC表は`value_traceability.md`の既存索引パターンをそのまま踏襲する |
| **データ設計** | IC-1〜11をID付きで棚卸しし、「充足/薄い/未」で記録する。構造的整合性（IC-1〜7）はほぼ充足、意味的整合性（IC-8〜10）が薄い/未という非対称を正本として固定する | 業務: 薄い/未のみを改善対象とし、既に充足しているIC-1〜7への追加検査は作らない。機能: IC-9/IC-10は既存issueへの重複起票をしない |
| **機能設計** | 監査パスは`PRODUCT-QA-01` G7の一部として実行し、新しい品質ゲート機構は追加しない。UQ/PB再検査は既存の`QA-MONKEY`連番運用を継続する | データ: 監査パスの記録は`PRODUCT-QA-01`のGate Recordテンプレートを流用し、本ADRへ反復ログを蓄積しない（`ADR-0039`） |

## Traceability

- Related: `01_Plans/adr/ADR-0041-core-value-invariants-single-guard.md`（CVI、索引化パターンの起源）
- Related: `01_Plans/adr/ADR-0043-complexity-budget-for-cognitive-load.md`（CB）, `ADR-0044-ui-ux-quality-baseline-and-verification.md`（UQ）, `ADR-0046-responsiveness-performance-budget.md`（PB）
- Related: `01_Plans/issues/done/issue-PRODUCT-QA-01-release-readiness-quality-gates.md`（G0〜G7・V0〜V4、監査パスの実行場所）
- Related: `02_Architecture/value_traceability.md`（IC表の追記先）
- Related: `01_Plans/issues/done/issue-DOMAIN-SCORING-SURFACE-01-health-percentage-and-lone-card-defect-contradict-invariants.md`（IC-9の実例、Done）
- Related: `02_Architecture/functional-dependency-integrity-2026-08-06.html`（IC-10 = F-5の出典）
- Related: `02_Architecture/canvas-projection-asymmetry-2026-08-09.html`（IC-8の実例の発見経路）
- Related: `01_Plans/issues/done/issue-DX-DOC-09-backtick-path-citations-unchecked-by-link-checker.md`（IC-11の初回監査パスと`DC-LNK-002`の実装）
- Related: `01_Plans/issues/done/issue-DOMAIN-ISLAND-MEMBERSHIP-01-cross-island-cardid-duplicate-detection.md`（IC-10の追加監査で新規発見した実装課題、Draft）
- Related: `01_Plans/adr/ADR-0039-governance-right-sizing-personal-oss.md`（物量抑制方針。新規自動検査を作らない根拠）
- Related: `01_Plans/adr/ADR-0067-three-element-constraint-design-method.md`
