# ADR-0060: 代表視覚手掛かりの供給経路と意味境界

- Status: Accepted
- Date: 2026-07-20
- Deciders: Product Owner / UX Lead / Security Officer / Project Maintainers
- Scope: `00_Prompt/representative_visual_cue_requirements.md`, `02_Architecture/schemas.md`, `02_Architecture/data_model_operations_overview.html`, `03_Implement/frontend/src/ui/`, `03_Implement/frontend/src/export/`, `03_Implement/frontend/src/import/`
- Norms: `DOM-AIOK-06, DOM-AI-10`（自動生成・自動採用の禁止、候補確認と人間による採用の必須化が本ADRの決定を構成する）

## 背景

島や情報集合を小さな画像で見分けられると、カード数が増えたときの再発見を助ける可能性がある。しかし、「画像生成」という単一機能として設計すると、外部通信を必要としない絵文字、同梱画像、外部素材、生成画像の異なる安全・権利・運用境界が混ざる。また、画像を要約や分類の正解として扱うと、KJ法が保持すべき曖昧さ、少数意見、対立を一枚の具体像へ早く収束させるおそれがある。

## 選択肢

1. 画像機能を持たない。UIと権利管理は単純だが、視覚的な再認識を支援できない。
2. 島ごとに生成AIが画像を自動生成する。個別性は高いが、通信、費用、待ち時間、誤った具体化、AI無効構成との格差が大きい。
3. 絵文字または単一の画像集だけを採用する。実装は小さいが、表現範囲とライセンス条件が一つの供給元に固定される。
4. 共通の意味境界の下で、手描き・利用者画像、同梱素材、外部素材、生成画像を段階導入する。実装は段階ごとに増えるが、従来実践との連続性を保ち、利用者が負担とリスクに応じて選べる。

## 提案する決定

選択肢4を採用候補とし、次を固定する。

1. 機能の正本語彙は「代表視覚手掛かり」とする。画像は島の表札・要約・本文・根拠を置き換えず、再認識を助ける任意の補助である。
2. 供給経路をA: 手描き/基本図形/利用者画像、B: Unicode絵文字/同梱プリセット、C: 権利確認済み外部素材、D: proposal-only画像生成に分ける。A/Bから順に検証し、後の経路を前提にしない。
3. どの経路も明示操作、候補確認、人間による採用、削除・取り消し、非表示を共通条件とする。島作成時の自動生成と自動採用は禁止する。
4. B/Cは外部通信前に接続先と共有内容を確認し、SafeMode、provider固定、暗黙切替禁止を守る。
5. 外部素材は、原典、作者、ライセンス、取得時点、改変、クレジット要件を採用参照と一緒に保持する。検索集約サービスのライセンス表示だけで利用可能と判断しない。
6. Cは生成物であること、provider/model、生成日時、対象参照、入力投影digest、人間の採用状態を保持する。生成画像を事実や根拠として表示しない。
7. 写真・図が観察データや根拠である場合、識別用の手掛かりとは別の一次視覚資料として保持し、元資料、撮影文脈、出典へ戻れるようにする。島どり線・関係線などの図解記号も、代表手掛かりと混同しない。
8. 採用済み手掛かりと一次視覚資料の保存先、画像バイナリの保持方式、容量上限、許容ライセンスallowlist、外部providerは本ADR受理後のfixture検証で決める。決定前に `DocumentV1` やDBへフィールド・テーブルを追加しない。→ **T6比較により下記のとおり決定（2026-07-20）**。採用参照・権利情報は `DocumentV1.islands[].representativeCue` へ埋め込む（L2: payload内）。画像本体は経路別に保存方式を分離する：A（手描き/利用者画像）はIndexedDB（上限4KB/16KB）、B（絵文字）は保存不要（OSフォント依存）、B（プリセットSVG）はJS bundle同梱（上限計16KB/最大32種）、C/Dは未定（T8へ延期）。サムネイルは画像本体からのリアルタイム描画とし個別保存しない。詳細は `02_Architecture/design/representative_visual_cue/storage_candidate_comparison.md` を参照。

現行`DocumentV1`には、由来・権利・代替テキストを持たず島全体の背景を外部URLから表示する旧式`Island.imageUrl` / `imageReviewed`が存在する。これは本ADRの`RepresentativeVisualCue`または`SourceVisualMaterial`として採用済みとはみなさない。互換期間中はSafeModeで取得を遮断して往復保持し、移行または除却条件を本ADRの受理時に決める（`SEC-VISUAL-ASSET-01`）。

## 複雑性予算

既定画面の常設操作は増やさず、島または選択集合の詳細から一段深く開く任意操作にする。画像なしの既存操作を変えず、外部経路は高度機能として段階的に開示する。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 島や情報集合を小さな画像で見分ける再認識支援を提供しつつ、画像を要約や分類の正解として扱わない（KJ法の曖昧さ・少数意見・対立を早く収束させない）。画像は表札・要約・本文・根拠を置き換えない任意の補助 | 機能: どの経路も明示操作・候補確認・人間による採用・削除・非表示を共通条件とし自動生成・自動採用を禁止。データ: 生成画像を事実や根拠として表示しない |
| **データ設計** | 供給経路をA手描き/利用者画像・B絵文字/プリセット・C権利確認済み外部素材・D proposal-only生成に分け、採用参照・権利情報は`DocumentV1.islands[].representativeCue`へ埋め込む（L2）。画像本体は経路別保存（IndexedDB/OSフォント/JS bundle） | 業務: 外部素材は原典・作者・ライセンス・取得時点・改変・クレジット要件を採用参照と一緒に保持。機能: 外部通信前に接続先と共有内容を確認しSafeMode・provider固定を守る |
| **機能設計** | 旧式`Island.imageUrl`/`imageReviewed`はSafeModeで取得遮断して往復保持。A/Bから順に検証し後の経路を前提にしない。採用参照・権利情報は`representativeCue`へ、一次視覚資料は`SourceVisualMaterial`として分離 | 業務: 画像なしの既存操作を変えず外部経路は高度機能として段階開示。データ: 決定前に`DocumentV1`やDBへフィールド・テーブルを追加しない |

## 影響

- AIを使えない環境でも、小さな視覚支援を先に提供できる。
- 紙上のシンボルマーク、簡単な手描き、汎用図形、撮影写真から自然に移行できる。
- 特定素材集を採用する前に、表示義務や継承条件を製品配布と照合する作業が必要になる。
- 候補・採用済み参照・画像本体・サムネイルを分けたデータ設計が必要になる可能性がある。
- 公開/exportでクレジットを表示できない形式は、該当素材を含められない。
- 画像の有無による探索性能を比較し、効果が確認できない供給経路は標準機能へ昇格させない。

## 受理に必要な確認

- [x] 絵文字をOS依存のUnicode表示とするか、固定画像セットとして同梱するかを比較する。`02_Architecture/representative_visual_cue_offline_preset_comparison.md`で、基本図形を先行し、Unicode絵文字を任意比較、固定SVGを必要性確認後の候補とした。
- [ ] 手描きの最小機能と、写真・図を一次資料として保持する境界をfixtureで確認する。
- [ ] 同梱候補のライセンス、帰属表示、派生物の継承条件を配布形態と照合する。
- [ ] 外部素材providerのAPI利用条件、検索語の扱い、キャッシュ、削除、クレジットを確認する。
- [x] 画像保存先、容量上限、削除、import/export、オフライン表示をfixtureで比較する。→ `02_Architecture/design/representative_visual_cue/storage_candidate_comparison.md`（2026-07-20、T6）
- [ ] 画像なし・手描き・基本図形・撮影写真・絵文字・プリセット・外部素材・生成画像の代表タスク評価計画をUX Leadが確認する。
- [ ] SafeModeと共有前確認をSecurity Officerが確認する。

## 追跡関係

- Source: `01_Plans/issues/issue-DOMAIN-VISUAL-CUE-01-representative-visual-cues.md`
- Requirements: `00_Prompt/representative_visual_cue_requirements.md`
- Evaluation: `02_Architecture/representative_visual_cue_evaluation.md`
- Candidate comparison: `02_Architecture/representative_visual_cue_offline_preset_comparison.md`
- Storage comparison: `02_Architecture/design/representative_visual_cue/storage_candidate_comparison.md`
- Emoji OS comparison (T5): `02_Architecture/design/unicode_emoji_os_comparison.md`
- Related: `01_Plans/adr/ADR-0043-complexity-budget-for-cognitive-load.md`
- Related: `01_Plans/adr/ADR-0044-ui-ux-quality-baseline-and-verification.md`
- Related: `01_Plans/adr/ADR-0049-external-flat-rate-agent-collaboration.md`
- ADR-0047 R-3（非機能境界・複雑性予算）: 外部画像取得・生成という新機能を、ADR-0043の複雑性予算内に収めるための境界判断である。
