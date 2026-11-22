# SUI再構築・知見蒸留計画：旧判断を候補へ戻し、TEIで選び直す

- 状態：**再開方針と将来構想の整理／新SUIの物理設計とリポジトリ構成は未決**
- 整理日：2026-11-22
- 調査時の旧SUI基点：`main` `b5f6295828e7d313d59958215066d03c8a063900`。Issueやコードの状態は再開時に再確認する。
- 将来像：[Document探索](sui_document_exploration_future_vision.md)、[ライフログ・任意属性](sui_lifelog_extensible_information_vision.md)、[個人・組織・社会の連邦型情報空間](sui_federated_knowledge_future_vision.md)、[Git RepositoryとTEI意味モデルの探索](sui_repository_source_exploration_vision.md)
- TEI側の既存計画：[SUI→TEI移行 M0〜M6](https://github.com/hat47x/tei-platform/blob/main/plan/design/SUI_TEI_MIGRATION_TASKS_2026-11.md)
- 既存の進捗・経緯：[ROADMAP](../ROADMAP.md)、[AGENTS.md](../AGENTS.md)

## 1. 開発の前提

旧SUIではTypeScript／ReactとPythonなどの個別コーディングを重ねてきた。今後はTEIによるモデル・DSL・Operator・Generatorを用いた再構築を志向し、**TEIが実用化されるまで、旧方式でのSUIの新機能開発を原則凍結する**。既存情報の読取、保守、重大な不具合修正、既存実証の確認は禁止しない。

凍結期間の主作業は、最新の構想を育てながら、Issue・ADR・設計・PR・コード・テストから有用な考えや失敗例を**選び直すこと**である。古いIssueの消化数や実装行数を進捗指標としない。将来構想がTEI実用化後の再開ロードマップとなる。

## 2. Acceptedを絶対視せず、再構築では候補へ戻す

従来のADRの`Accepted`は、当時の対象・条件の下で採択された**歴史的事実**である。次期SUIの契約や設計の確定を意味しない。既存の正本、CVI、安全設定、同時編集方式、所有・認可方式も、**将来の世界観へ合わせて再検討可能な候補**へ戻す。

ただし、旧SUIのコードを動かす限り、現行の機密保護や権限を「新構想では不要だから」と先に削除することはしない。新設計の選択自由と、旧アプリが現に守っている利用者の期待を分ける。

再審査の判断ラベル：

| 区分 | 意味 |
| --- | --- |
| `adopt` | 新SUIの価値と証拠から改めて採用 |
| `reinterpret` | 元の課題を残し、設計・意味・実現方式を見直す |
| `reject` | 新SUIには不要・不適切と判断 |
| `defer` | TEI能力・実利用・運用形態の確認まで判断を保留 |
| `legacy-only` | 旧SUIの実装・保守にのみ残す |

最初の分類は検討案であり、Ownerの最終判断ではない。旧ADRの状態や履歴を書き換えて過去を消さず、採否と理由をこの再開計画・新構想側に残す。見直す条件と反例を併記する。

## 3. SafeModeの再考：既定の遮蔽よりも適切なアクセス制御

**新SUIではSafeModeの廃止を第一候補として評価する。** 未レビューの本文を一律に隠す独立したSafeMode層が、情報への正当なアクセスを妨げ、複雑性を増している可能性があるためである。

次期設計の第一候補は、**正当に権限を持つ主体が、その権限の範囲でDocument本文を閲覧できる**という単純な原則である。次の四つを混同しない：

1. **閲覧・利用資格**：誰が本文、検索結果、出典、類似候補、AI Context Packを読めるか（現在のAuthZと用途・出力先に基づく）。
2. **レビューの事実**：誰がどのRevision・範囲を確認したか。未レビューでも権限者による私的閲覧を妨げない。
3. **内容の妥当性・承認**：正式に採用・組織承認されたか。閲覧可能というだけで内容が正しいことにはならない。
4. **外部提供・公開**：他者への共有、外部AI送信、公開Webへの配布など、閲覧とは別の行為の権限。

例えば、記録者がAI草稿を私的に読むことは自然であり、未レビューという理由だけで本文が表示されない必要はない。一方、社外公開や別モデルへの送信は別途その行為に対する権限を確認する。レビュー履歴から「吟味の兆候」を分析してもよいが、人による明示的なレビューや承認の代用にはしない。

SafeModeを廃止するために、SafeModeと同じ機能を別名で再実装してはならない。**必要な最小のアクセス制御だけで運用できるか**を実証し、もしレビュー状態を前提にした共有制限が実際に必要なら、個別の公開・配布ルールとして採否を判断する。

見直しに必要な反例：
- 権限者は未レビューの原文を閲覧できるが、権限のない利用者は検索の星・線・件数からも存在を推測できない。
- 同じ人が本文を読めても、別Harnessへ自動送信する資格は得ない。
- AIの編集履歴を観測しても`human_reviewed`や承認者が自動で捏造されない。
- 組織の異動・兼務・権限失効後に検索・索引キャッシュ・派生文書が以前の許可を引きずらない。
- 権限判定が不明な状態では勝手に公開しない。
- 個人ローカルDesktopではOS権限を尊重する。サーバ側の組織共有ではIdP/AuthZと連携する。

現行旧SUIのADR-0041／ADR-0068／ADR-0098のSafeModeやCVIは、旧版の事故を防ぐ**保守上の条件**として引き続き扱う。新SUIでの採用は本節の再評価結果に従う。

## 4. 将来構想から導く製品地図

| 利用体験 | 新SUIで必要な能力の候補 | 既存TEIで確立したとみなさないもの |
| --- | --- | --- |
| どこからでも記録 | Inbox、外部URL、Markdown、Reader/Writer | 無制限の外部Connectorや永続Store |
| 情報の内側へ進む | Document、アウトライン、参照元への復帰、独立Document生成 | 旧DocumentV1と等しい構造・型 |
| 思考を編み直す | Item/Occurrence、Tree、マインドマップ、KJの島・Relation、逆ドリルダウン | 旧KJ実装のCanvas依存UI |
| 時間と意味を重ねる | Timeline、Episode、任意属性、Provenance、AIセッションDocument | 旧Card.metaへの自由属性追加 |
| 類似文書を結ぶ | URL、索引、検索・Constellation、類似・派生・Fork、Reference | 検索スコアを文書の同一性へ自動昇格 |
| リポジトリを巡る | Git Repositoryの粗いリンク→commit／file／TEIモデル要素→キャンバス→改修案 | Git main／TEI Model Revision／Build Artifact／実配備を同一視しない |
| 文書を独立させる | Snapshot／Revisionの束縛、Markdown標準Export、SHO/TEIでOffice/PDF生成 | SUIを全組織共通の承認ワークフロー・Office編集環境にしない |
| 組織や社会へ広げる | 現在のAuthZ、所有と作成、レビュー・承認、公開リンク | 旧SafeMode・旧テナント階層の必須継承 |
| TEIによって育てる | Field、Form、Query、Graph、生成UI、Plugin、外部Host | SUI固有の手書きHostや第二の正本 |

TEIのGo単一バイナリ、`*.tei.md`を中心とした設計、既存Hostへの成果物配置、可搬なMarkdownの方向へ適合させる。ただし、TEIの構成がSUIの利用価値を不必要に制限する場合は、TEI側へ必要な能力を提案する。TEI生成器がまだ実装されていないものを「再開可能」と誤認しない。

## 5. 最初に吸い上げる既存情報群

以下は旧SUIの原典を照合した**初期の候補選定**であり、全Issue・ADRを網羅した審査ではない。

| 領域 | 原典 | 蒸留する問い・反例 | 初期評価 |
| --- | --- | --- | --- |
| KJの価値・Product | [ADR-0089](adr/ADR-0089-product-value-canon.md)、[#3400](https://github.com/hat47x/sui-sensemaking/issues/3400) | 未整理からの意味形成を、ライフログ・外部知識まで広げるか | `reinterpret` |
| 異種データ | [#3401](https://github.com/hat47x/sui-sensemaking/issues/3401) | Source、関係、時間、外部効果を分離する必要があるか | `reinterpret` |
| Rawと元文 | [#3438](https://github.com/hat47x/sui-sensemaking/issues/3438)、[#3441](https://github.com/hat47x/sui-sensemaking/issues/3441) | 同名別Source、同Source別箇所、版・失効、別Reader再読 | `adopt`候補 |
| 意味成果物 | [ADR-0084](adr/ADR-0084-sensemaking-lifecycle-and-authority-boundary.md)〜[ADR-0086](adr/ADR-0086-sensemaking-artifact-identity-provenance-authority-events.md) | Evidence／仮説／判断／レビューと所有・開示が別か | `reinterpret` |
| 判断の経緯 | [ADR-0099](adr/ADR-0099-card-critique-revision-history.md)、[ADR-0100](adr/ADR-0100-structure-decision-history.md) | 旧理由を消さず再訪する。履歴100件上限は必須か | `reinterpret` |
| Outliner・KJ | [複合UI計画](hybrid_outline_canvas_layout_plan.md)、[#3391](https://github.com/hat47x/sui-sensemaking/issues/3391)、[#3430](https://github.com/hat47x/sui-sensemaking/issues/3430)、[#3431](https://github.com/hat47x/sui-sensemaking/issues/3431) | Tree／島／Linkの区別、Markdown投影の限界 | `reinterpret` |
| AI・製品横断 | [ADR-0111](adr/ADR-0111-meaning-preserving-external-cognition-interface.md)、[ADR-0117](adr/ADR-0117-cross-product-handoff-context-envelope.md) | SessionをDocument扱い、送信・保存・意味受理の資格を再設計 | `reinterpret` |
| 所有と認可 | [ADR-0073](adr/ADR-0073-document-ownership-and-lifecycle-model.md)、[ADR-0076](adr/ADR-0076-collaboration-concurrency-model.md)、[#3422](https://github.com/hat47x/sui-sensemaking/issues/3422)、[#3423](https://github.com/hat47x/sui-sensemaking/issues/3423) | 作成者／所有者、許可、競合、unknown Adapter拒否 | `reinterpret` |
| SafeMode・review | [ADR-0041](adr/ADR-0041-core-value-invariants-single-guard.md)、[ADR-0068](adr/ADR-0068-safemode-enforcement-at-api-boundary.md)、[ADR-0098](adr/ADR-0098-human-authored-review-attestation-and-safemode-island-titles.md) | 未レビュー一律非表示は必要か。権限者への全文表示で十分か | **SafeModeは`reject`方向、AuthZを改めて設計** |
| 提出とレビュー | [ADR-0117](adr/ADR-0117-cross-product-handoff-context-envelope.md)、[ADR-0099](adr/ADR-0099-card-critique-revision-history.md)、[ADR-0100](adr/ADR-0100-structure-decision-history.md) | レビューを知的活動として残す。正式承認は外部制度に委ね、提出SnapshotとArtifact byteを同定できるか | `reinterpret` |
| リポジトリ参照 | [TEI移行パケット](https://github.com/hat47x/tei-platform/blob/main/plan/design/SUI_TEI_MIGRATION_IMPLEMENTATION_PACKET_2026-11.md)、[SUI #3401](https://github.com/hat47x/sui-sensemaking/issues/3401)、[TEI #2497](https://github.com/hat47x/tei-platform/issues/2497) | Repository単位→File→モデルIDへ潜る。TEIの読取専用参照と次期SUIのモデル探索を混同しない | `reinterpret` |
| TEIパイロット | [ADR-0116](adr/ADR-0116-tei-sensemaking-reference-source-and-disclosure.md)、[M0〜M6](https://github.com/hat47x/tei-platform/blob/main/plan/design/SUI_TEI_MIGRATION_TASKS_2026-11.md) | read-only Consumerから新SUIの生成能力へ、何を移すか | `reinterpret` |

新構想から生まれたInbox、Episode、World予約、任意Field、Constellation、組織階層、柔らかな文書統合は、旧実装に存在しないからといって候補から外さない。過去の選択だけで未来を制限しない。

## 6. 蒸留工程：過去のADRを写し取るのではなく選び直す

| 段階 | 作業 | 残すもの |
| --- | --- | --- |
| **D0 原典の確認** | Issue・ADR・PR・Source・Testの当時の対象版と、実装・試験の有無を確認 | URL、SHA、主張の根拠上限 |
| **D1 価値の再発見** | 解こうとした問題と利用者の仕事を元の実装方法から分ける | 新しい価値の記述 |
| **D2 世界観から反証** | 時間・意味・まとまり・任意属性・文書独立性・組織に照らして別解を探す | 不要な複雑さ・見逃した案 |
| **D3 再選定** | `adopt`／`reinterpret`／`reject`／`defer`／`legacy-only`に整理 | 採否の理由、覆す条件 |
| **D4 TEI Fit/Gap** | DSL・Operator・Generator・UI・Reader/Writer・Hostとの接続 | TEIの不足能力と再利用できる部分 |
| **D5 独立Expected** | 正例・反例を小さな受入シナリオへ落とす | 再開後に検証する条件 |
| **D6 次期実装の受理** | TEIの実生成と保存・再読・外部接続で評価 | 新SUIとして選び直した採用記録 |

蒸留の優先順：①一次価値とDocument探索、②Raw・保存・原資料への復帰、③Review・AIセッションと認可（SafeMode再評価を含む）、④Tree・KJ・Graph・時間、⑤Inbox・任意属性・Index・組織、⑥TEI生成のFit/Gap。

古いIssueの状態を一斉に書き換えない。新しく採用した考えは将来構想書と本計画へ追記する。過去の当事者の判断や実測が残ることは、**新しい判断に固執する理由ではなく、よりよく問い直すための材料**である。

## 7. リポジトリ構成の二案

| 観点 | **A：現行sui-sensemaking内で作り替える** | **B：新リポジトリ＋旧SUIをレガシーとして維持** |
| --- | --- | --- |
| Git履歴・Issue・PR | 原典と新構想を同じ場所で参照しやすい | 旧RepoのURL・SHAを保ち、新Repoが必要分を参照 |
| 新設計の独立性 | 旧コード・CI・Accepted判断に引きずられやすい | TEI生成元・新規約を最初から組織しやすい |
| 作業効率 | Repo運営は軽いが古い構造の整理が必要 | Repo運営は増えるが新コードを旧実装から分離 |
| 等価性・移行 | 旧実装をその場で比較しやすい | 参照SHAと必要なFixtureのみ持ち込む |
| 将来の撤退 | 旧・新が同居し境界を明示する必要あり | 旧Repoを保存し、選択的に移植・切戻し可能 |

**暫定的にはBを優先候補**とする。これは旧実装と旧ADRの前提を一括継承せず、新構想をTEI生成中心に置きやすいためである。ただし、**今すぐ新Repoを作る・移植するという決定ではない**。まずTEIの最小縦断実証により、生成元の配置、Reader・Writer、開発者体験、Git履歴の扱いを比較する。Aも合理的な代案として残す。

Aの場合は旧コードを一斉移動させず、生成領域を独立させたうえで整理する。Bの場合は旧Repoを原典として保持し、全Issue・全ADR・全コードの一括コピーを避ける。どちらの場合も、原資料の独立性、移行時の権限、旧データの持出し、切戻しを確認する。

## 8. TEI実用化後の再開ゲート

1. **G0 構想と蒸留**：今できる仕事。長期構想と旧資産の再選定を続ける。旧方式での新機能実装を目的化しない。
2. **G1 TEI能力**：`*.tei.md`からモデル、基本UI、Reader/Writer、生成物を作り、別Processで動作する。TEI Studio Desktopのセルフビルドが進んでいる。旧TEIパイロットのread-only成功をSUI再実装の完了と混同しない。
3. **G2 SUI最小体験**：外部Markdown／Harnessの限定SnapshotをInboxへ入れ、Documentを開く。文章から独立Documentへドリルダウンし、元へ戻り、Markdownへ出力できる。AI OFFでも成立。
4. **G3 意味形成**：Itemの複数OccurrenceとKJ島、保留・異論、複数文書の再構成が、TEI生成UIで動く。T2実利用で価値を検証する。Repositoryの粗い参照から一つのTEIモデル要素へ潜り、改修案のDocumentへ戻れることを[RS0–RS3](sui_repository_source_exploration_vision.md)の一部として確認する。
5. **G4 拡張**：任意Field、Episode、Live Collection、検索・Constellation、セッション分析、組織・社会向け公開を、必要な順に採否判断する。TEIへ改修案を渡す経路や正式文書のExport／外部承認参照は[RS4・RS5](sui_repository_source_exploration_vision.md)の限定実証から始め、完成したEditor／Approval HostをSUIに作らない。

**再開を宣言する条件**は、TEIの基本シナリオで「生成→保存→別Reader再読→画面操作→Markdown書出し」が独立して成立し、日常の設計変更を手書きコードで継ぎ足さずに進められること。加えて、次期SUIがどの権限・公開・レビュー契約を採用するかを、既存ADRのStatusから独立に決めること。

TEIの現行M0〜M6は限定的な移行作業であり、新SUIが完成した根拠にはならない。TEI側の担当Issueを無断で書き換えない。

## 9. 結語

SUIの長期構想は、旧SUIを完成させるための追加要件表ではない。**将来のTEI生成版SUIを新たに設計するための出発点**である。

既存のIssue・ADRは優れた知見も古い仮定も混在する。すべてを再評価対象に戻し、現在の世界観に必要なものを選び直す。特にSafeModeは、新しいAuthZとレビュー履歴の区別によって不要となる可能性が高く、廃止方向を中心に比較する。

現行コードと歴史は残し、新しい構想には自由を残す。新SUIを旧方式の制約から切り離しつつ、事実・失敗・反例から学べる再開計画とする。
