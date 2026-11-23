# SUI将来構想：リポジトリを情報源とする探索とシステム改修

- 状態：**将来構想として採録／TEI再構築後の検証候補。実装済みではない**
- 整理日：2026-11-22
- 上位構想：[Documentを巡り洞察を育てる](sui_document_exploration_future_vision.md)、[個人・組織・社会をつなぐ情報ネットワーク](sui_federated_knowledge_future_vision.md)
- 再開計画：[TEI再構築と旧Issue・ADRの知見蒸留](sui_tei_reconstruction_distillation_plan.md)
- TEI側の既存資料：[SUI→TEI移行実装パケット M1〜M6](https://github.com/hat47x/tei-platform/blob/main/plan/design/SUI_TEI_MIGRATION_IMPLEMENTATION_PACKET_2026-11.md)、[SUI参照のCanonical定義](https://github.com/hat47x/tei-platform/blob/main/reference/sui-reference/README.md)
- 旧SUIの参照原典：[Issue #3401](https://github.com/hat47x/sui-sensemaking/issues/3401)、[ADR-0111](adr/ADR-0111-meaning-preserving-external-cognition-interface.md)、[ADR-0117](adr/ADR-0117-cross-product-handoff-context-envelope.md)

## 1. 核心：情報を移さず、リポジトリごと思考の対象にする

SUIでは、**Gitリポジトリ全体を一件の外部情報源としてリンクする**。利用者は、必要なときだけディレクトリ、ファイル、節、設計要素、変更履歴へ潜り、複数の情報をキャンバス上へ取り出す。最初から全内容を複製・形式変換する必要はない。

リポジトリはDocument一件へ強制変換しない。多数のDocument、設計要素、生成物、履歴を持つ**外部Sourceのまとまり**である。Documentのリンク、ItemのID、Occurrenceの配置、Relationの種類をそれぞれ区別する。さらに上位の「World」は引き続き予約語とし、RepositoryをWorldの確定実装とみなさない。

一般的なGitリポジトリでも、URL、ファイル、Markdown、コミット、Issue、PR、キーワードを検索できるようにする。TEIで構築されたリポジトリでは、宣言された要件・データ・処理・ルール・画面・生成関係などを、**ファイルの文字列以上の意味を持つ対象**として扱える可能性がある。

SUIが担うのは、検索、関係の発見、比較、思考の記録、変更候補の形成である。モデルの正式変更、コード生成、ビルド、デプロイ、業務上の受理はTEIと該当するHost／Ownerの責務に残す。

## 2. 粗い登録から細部へ潜る段階的な参照

| 粒度 | 例 | 初期の扱い |
| --- | --- | --- |
| Repository | Git URLまたは許可されたローカルRoot | 一件のSourceリンク。表示名・概要は任意 |
| Revision / Branch | commit SHA、tag、branch ref | 可動参照と固定参照を区別 |
| Directory / File | 要件群、設計書、`*.tei.md`、コード | 参照と、必要に応じた本文検索 |
| Section / Range | Markdown見出し、行／byte範囲 | 元の同じ位置へ戻れる範囲でAnchorを保持 |
| Model Element | 要件ID、Data、Function、Rule、UI、Query、Node／Relation | TEI Reader等から識別子・意味・依存関係を得られた場合のみ |
| Build / Deployment | 生成物、Build/Evidence、実配備Revision | 設計Revisionとの対応を実際のReceipt／資格で確認 |

最初はRepository単位のリンク登録だけでよい。全ファイルの解析、Embedding、Graph生成は後から要求に応じて行う。軽量な参照は、索引や生成AIが利用不能でも有効である。

GitHub、GitLab等のホスティングサービスをSourceとして扱う場合、公開リポジトリ・非公開リポジトリ・ローカル作業ツリーを区別する。非公開情報は現在の資格で取得できる範囲に限り、検索・タグ候補・Constellationの件数にも閲覧境界を適用する。

## 3. 同じ「リポジトリ」を指しても時点は違う

次の参照を同一視しない。

- **Repository URL**：プロジェクトの入口。現在の内容を固定しない。
- **Branch / Tag**：特定の名前で参照する対象。Branchは移動し、Tagも変更され得る。
- **Commit SHA**：Git上の特定のツリーを再現する手掛かり。外部依存や実行環境までは固定しない。
- **Working Tree**：コミット前の変更、未追跡ファイル、未保存の編集を含み得る。HEADのSHAだけで内容を再現できない。
- **TEI Model Revision**：TEIが意味的に受理・管理するモデル版。GitのSHAと自動的に同じではない。
- **Artifact Revision / Deployment**：生成・ビルドされた内容と、実際に配備されたもの。リポジトリのmainが本番稼働版であるとは限らない。

検索や閲覧では最新のBranchが便利でも、改修案の根拠、AI Context Pack、外部ワークフローへの提出には、取得した時点のRef解決結果、Source状態、Revision、必要な範囲を固定する。

Sourceが削除・権限失効・移動・部分取得・A→B→Aとなった場合には、参照や索引の再資格化を行う。digest一致だけで最新版・意味同一・アクセス権継続を主張しない。取得先が不明なら「未取得／不明」を保持する。

## 4. TEIの意味モデルをConstellationへ投影する

TEIリポジトリでは、`*.tei.md`、TEIのモデル定義、生成器が認識する対象と、その根拠となるSource、関係を段階的に取得できることを目指す。

| TEI側の情報 | SUIの探索上の用途 | 必須の境界 |
| --- | --- | --- |
| 要件・制約 | 改修要求との照合、影響範囲候補 | 自然文の類似を正式要件の同一性にしない |
| Data・項目・関係 | モデル間の参照、Graphやアウトラインへ投影 | ID、向き、多重性、null/不明を保持 |
| Function・Operator・Rule | 処理と業務規則へのドリルダウン | 未接続の宣言を稼働中の処理とみなさない |
| UI／Query／生成先 | 表示・検索・Target側への影響調査 | 生成コードやHostを意味の正本にしない |
| Build・Evidence | 改修後の確認、原因と結果の照合 | Source一致とOwner意味受理を混同しない |
| Issue／ADR／PR／Harness Session | 設計判断の背景や異論の再発見 | 古いAccepted ADRを新SUIの必須制約にしない |

Constellation上では、**TEIに明示されたRelation**、Git由来の履歴や参照、全文・Embeddingから推測された関連候補、人間が付けたRelationを異なる表示で扱う。グラフ距離や近接位置が「変更すれば動く」という保証にはならない。

TEI側での同一性の境界（Model ID、Source位置、Revision）とSUI側のOccurrenceを混同しない。複数のキャンバスに同じ要素を置いても、元モデルを複製したことにはならない。

> **現在地の上限**：2026-11-11付のTEI実装パケットは、SUI構造のread-only参照、限定的なCanonical定義、record／Disclosure投影等を報告するもの。逆向きの「任意TEI Repository → SUIの意味モデル探索」や、稼働システムへの変更反映を実証した資料ではない。ここでは新しいTEI能力を**要件候補**として扱う。

## 5. 改修を考えるときの標準的な利用経路

1. **粗く接続する**：対象RepositoryをInboxへ登録し、Issueや自然文の変更要求にリンクする。取得対象を全ファイルに広げる必要はない。
2. **必要なところへ潜る**：検索語から要件・関連モデル・参照文書を開く。TEIが返せる識別子・関係は明示関係として表示する。
3. **組み替える**：関係しそうなモデル要素をアウトラインやKJキャンバスへ配置し、反例・影響範囲・過去の設計判断を並べる。保留と少数意見も残す。
4. **新しい案を記録する**：選択したSource、コミット、モデル要素、調査時点をContext Packに固定して、独立した改修案Documentを作る。AIによる提案は人間の考えと区別する。
5. **TEI側へ引き渡す**：変更候補、対象版、改修意図、根拠、未確認事項を渡す。SUI内でSourceを編集できるとしても、その操作はTEI／Hostが定める書込契約と権限に従う。
6. **戻って確認する**：TEIの生成、外部コンパイル、テスト、承認された意味、実配備の結果を別々に受け取り、元の改修要求・Sourceへリンクする。未実施は未実施と表示する。

この循環は、SUIで思考した内容がそのまま運用中の業務システムを書き換えることを意味しない。正式なモデル更新と実Effectには、それぞれのOwnerによる資格確認が必要である。

## 6. レビューは思考の活動、承認は組織の制度

SUIは、個人のAIレビュー、自己検討、比較、反証、他者との検討などを、通常の情報活動として記録・検索・関連付けできるようにする。**組織共通の正式な承認ワークフローを、SUIの基本機能にはしない。**

- **Review**：どのSourceや文書のどの版・範囲について、誰／どのHarness・Modelが何を指摘したか。複数のレビューが食い違ってよい。
- **Observed activity**：セッション中の再質問、手動編集、テスト等。深く吟味した可能性は示せても、人間が正式に確認した証明とは限らない。
- **Acknowledgment**：本人が特定内容を確認したという明示記録。レビュー結果や内容の正しさとは別。
- **Formal approval**：組織の規則に従う決裁。SUI内の状態を更新するより、外部の承認対象と承認結果をSourceとして参照できればよい。

正式な提出は**特定版の成果物**を対象にする。リポジトリRefやSUI Document Revisionに加え、実際に出したMarkdown、Office、PDF等のbyte列・生成器情報・提出先・提出時点が必要になり得る。提出後も探索空間で改修を続けられ、提出した版は変わらないことを優先する。

LockはSUIの必須機能にはせず、文書管理・組織制度が必要とする場合にTEIまたは外部DMS側で実現する。ロックによる強制が不要なら、Snapshot、内容識別、版照合で運用する。承認の記録が無い文書は、承認されたとも不承認とも推測しない。

## 7. 外部文書の境界を尊重し、Exportは基本機能として残す

SUIの情報は柔軟につながり、ドリルダウンで発散する。**独立した正式文書としての境界を、SUIのすべてのDocumentへ強要しない。**

- 組織がWord、PDF、Git管理Markdown、既存業務システムを正本としているなら、その文書をリンクし、SUIでは注釈・検討経緯・関連情報を保持する。
- 文書成果物が必要なときは、対象範囲と参照Sourceを選択し、固定したSnapshotから出力する。編集できる元Documentをロックせず、提出した版の再現性を確認する。
- **標準の持出し口はMarkdownと通常のURL**とする。関係・属性・複数Occurrence等を厳密に戻したい場合は構造化Sidecar／JSON等と損失宣言を併用する。
- Word／PDF／Excelなどの完成品の組版・変換はSHO／TEI／外部Toolに委ねられる。SUIがOfficeアプリそのものになる必要はない。
- 作成したファイルが承認済み・正式文書であるかは組織が決める。SUIのExport操作自体は承認ではない。

参照範囲を束ねて書き出す際には、原文URLの相対パス調整、引用可否、未取得のリンク、非公開情報の混入、出力内容のdigest、生成器・Templateの版を必要に応じて検査する。**成功したExportと、相手が受領・保存・承認したことを分ける**。

## 8. 構想から実装へ：TEI実用化後の小さな縦断

| Gate | 最小スライス | 独立に確認したいこと |
| --- | --- | --- |
| **RS0** | 任意の公開Git Repository URLをSUIで一件登録・再読・Markdownで書き出す | 参照先へ戻れる。未取得と内容取得済みを混同しない。AI OFF |
| **RS1** | Repository→特定commit→一つのMarkdown節へ潜る | Branch移動、同文別箇所、非公開／失効、再読時のAnchorを区別 |
| **RS2** | 小さな`*.tei.md`プロジェクトの要件・Data・RuleをTEI Readerから取得し、SUIの別ビューへ表示 | Sourceを編集せず、実ID・明示Relation・未解決を維持。TEIの実Provider実行は別 |
| **RS3** | TEIモデルの2要素と旧Issueをキャンバス上で比較し、改修案Documentを作る | AI候補／人手記録の差、Context Pack固定、元Sourceへの復帰 |
| **RS4** | 変更候補をTEIに渡し、生成ArtifactのReceiptを受け取り関連付ける | 送信・受領・生成・意味受理・配備を混同しない |
| **RS5** | 同一SnapshotからMarkdown成果物をExportし、外部の模擬承認先で特定版にリンクする | 出力byteと生成器版、提出後の元Document更新、外部承認とSUIの分離 |

実行順は[TEI再構築・知見蒸留計画](sui_tei_reconstruction_distillation_plan.md)の再開ゲートに従い、旧TypeScript／Pythonで新規実装を始める口実にしない。RS0・RS1の一部はTEIのモデル生成前にも**設計・Fixture・独立Expected**を作れるが、SUI機能が既に動くとは主張しない。

### 負例を先に残す

1. 同内容の別リポジトリ・別コミット・別出典を、同一文書として自動統合しない。
2. GitのHEADが変わっても、承認の対象にした固定commit／Export Artifactを黙って付け替えない。
3. Dirty Working TreeをHEADで表現したことにしない。
4. TEIが宣言した関係とAIが推測した類似性を、同じ確定Relationへ自動統合しない。
5. Repoのmainと「稼働中」Deploymentを根拠なく同一視しない。
6. 旧ADRの`Accepted`を次期SUIの設計拘束として取り込まない。
7. 読める情報を`reviewed`へ自動昇格せず、レビュー実績から正式承認を捏造しない。
8. 権限のないRepoの星・リンク・候補・件数を検索結果へ混ぜない。別Harnessへ無断送信しない。
9. 索引だけ残ってSource取得が不可能になったとき、閲覧可能な本文として再提示しない。
10. Exportに非公開の関連文書が混入した場合、拒否または明示的に除外した状態で扱う。
11. TEIから取得した読取専用モデル投影を、別の更新可能な正本へ書き換えない。
12. Linked Repoから新Documentを作っても、元Repoのファイルは無断で変更されない。

## 9. 固定対象・問い・Sourceの現在性をつなぐ（2026-11-23追補）

Repositoryのリンクをキャンバス上で開いているとき、利用者が見ている要素と、AIに調査させたい要素は一致するとは限らない。SUIでは表示中の選択を一時的なものとして扱い、別の操作で**「今、何について考えているか」**を固定できるようにする。

例えば、TEIの`Order`モデル、別ブランチの`Order`、過去の改修案を比較する際は、次のような関係を保持する。

| 対象・文脈 | 何を保持するか | 勝手に行わないこと |
| --- | --- | --- |
| 現在の表示 | フォーカス、ビュー、表示中のSource範囲 | そのまま外部AIへ全送信 |
| 固定した対象 | Repository／commit／モデルID／Source Locator／対象の役割 | 表示名や座標だけで別モデルへ付け替える |
| 問い | 比較する理由、主対象・比較対象、未確認事項 | AIが推測した問いを本人の判断に昇格 |
| AI送出時 | 解決済みのSource Revision、取得範囲、送信可能なContext Pack | その後の画面操作で既送出の対象を変更 |
| 提案を適用するとき | 現行のWriter対象、版、現在の権限と受理条件 | Pinned参照を保存・実行Grantとみなす |

この設計は、TEIの[GUI/CUI固定対象・文脈棚構想](https://github.com/hat47x/tei-platform/blob/main/plan/design/GUI_CUI_PINNED_CONTEXT_WORKBENCH_2026-11.md)と共通の問題を解く。ただし、新しい共通Context StoreやHarness Runtimeの導入を決めるものではない。まず既存のURL／Context Pack／Operationに対するFit/Gapを確認する。

### TEIで生成するUIとの接続

SUIの探索用UIでは、同じItemをアウトライン、KJ、表、Constellationで見られることを優先する。TEIのDataとFunctionの間にあるContextを利用すれば、業務用の具体的なフォームや検索画面は、固定した画面型からではなく、対象と操作の意味に沿って生成できる。

ただし、生成されたUIで操作が表示されたことと、書き込み権限があり実行できることは別である。Contextが部分取得のときに全件操作を提案しない、元モデルが更新されたら編集候補を再評価する、といった境界を先に確認する。

最初はTEI Repositoryの一つのData・Function・Ruleを**読める**ことから始める。二つのモデル要素を選んで改修案を作り、その案をTEIの正式なWriterへ渡すのは後の段階とする。TEIでの保存・ビルド・外部Host実行の結果は独立に観測する。

## 10. 将来の採否と停止条件

Repositoryのリンク登録、モデル要素へのドリルダウン、改修案の作成、成果物の参照は同じ道筋で使う。各段階で本当に発想と改修に価値があるかを確認し、単なる索引の規模や解析した要素数を成功指標にしない。

第二のConsumerが現れないうちに、SUI固有のGraphやModel IDをTEI全体のCanonical仕様へ押し込まない。巨大なGit Index Store、独自のAgent Host、汎用承認ワークフロー、Office互換エディタを標準搭載する前提も置かない。

短いRepositoryリンクとMarkdownだけで目的が果たせる場合は、そこで止める。必要性が確かめられたときに限り、TEIのSource Reader／Plugin／Generator、SHOの編集・出力、KONの保存API候補へ広げる。
