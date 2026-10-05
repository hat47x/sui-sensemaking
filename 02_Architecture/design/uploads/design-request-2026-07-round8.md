# sui-sensemaking デザイン設計要求（Round 8・マスタ系設定データとSaaS tenant scope）

対象: Claude Designセッションへの貼り付け用プロンプト。今回は、一般利用者の文書入口、文書内の保存範囲が異なる2種のプリセット、通常Workspaceから分離したAdmin管理面に加え、将来SaaS化した場合のtenant scope表示を先行検討してください。

---

## 貼り付け用プロンプト

sui-sensemakingの既存UIを前提に、**マスタ系設定データを安全に設定・維持するための情報設計と画面レッドライン**を提案してください。白紙からの全面刷新ではなく、既存のStartPanel、Fileメニュー、Recent documents dialog、View controls、Patch workspaceを置換・包含して整えます。

### 1. 今回の目的

設定データを1つの汎用「マスタ管理」画面へ集めることが目的ではありません。データごとの正本・保存範囲・利用者・安全境界をUIから誤解なく理解でき、必要な日常操作へ少ない手数で到達できることが目的です。

次の4面を分離してください。

1. **Workspace文書入口**: 一般利用者が認可済み文書を探して開く。
2. **文書内設定**: View/PerspectiveとPatch workspaceのQueryPresetを、使用場所の近くで維持する。
3. **Admin管理面**: strict provisioningと将来の外部エージェント登録を扱う。文書本文を扱わない。
4. **デプロイ設定**: LLM providerやendpointはアプリ内で編集せず、必要なら非秘密の状態だけを読み取り専用表示する。

### 2. 確定済みのデータ境界

以下は設計案で変更しないでください。

- 文書本体はDocumentスナップショットのまま。カード等を汎用マスタとして正規化・編集する画面にしない。
- 文書一覧のサーバー正本は`GET /docs`のメタデータ射影で、項目は`id`、`title`、`updatedAt`のみ。対象は現在の認可主体がread可能な文書だけ。ACLを解決できない場合はfail-closed。
- localの「最近」は非正本キャッシュ。サーバー一覧取得失敗時にキャッシュだけで文書を表示・開かせない。
- Workspace文書一覧ではタイトルを表示してよい。Admin/Audit面ではタイトルを表示しない。
- Admin/Audit面では`id`、`version`、`updatedAt`等の固定メタデータだけを扱い、`payload_json`、カード、narrative、review pack、diff、未レビュー本文を表示・検索しない。
- 削除、アーカイブ、所有者移管は標準機能にしない。文書一覧へdisabled項目としても置かない。
- 一覧からの文書複製は契約未確定のため置かない。タイトル変更は文書を開いた通常の編集・保存文脈で行い、一覧インライン編集は描かない。
- View/Perspectiveと表示プリセットは`view.json.viewState`に属し、文書本体へ埋め込まない。表示設定を書き出すときに含まれるが、サーバーへ自動同期される設定ではない。
- QueryPresetは当面このブラウザ・端末だけに保存する。サーバー同期、共有、バックアップを示唆しない。
- KJ語彙（claimType、関係種別、違和感タグ、holdState）はコードとADRで固定し、ユーザー編集可能な語彙マスタにしない。
- LLM provider・endpointは環境変数が正本。アプリ内編集、秘密値表示、DBマスタ化を行わない。
- ユーザー/アイデンティティは現時点ではstrict provisioningによる登録だけ。ユーザー一覧、無効化、削除、SCIM、ロール編集を描かない。
- 将来のエージェント登録はPlatform operatorだけが行う。文書IDに束縛するが、登録だけで文書書込権限を与えない。tokenは平文保存せず、作成直後に一度だけ表示する。文書ownerによる発行は不可。
- Audit画面は今回作らない。空の画面やdisabledナビゲーションも置かない。

このRoundの成果は設計入力であり、未定義APIや将来機能の実装許可ではありません。

### 2.1 SaaS tenant境界（先行検討・未採択）

現行sui-sensemakingは単一デプロイ／単一テナント相当で、SaaS multi-tenantは未対応です。次は`01_Plans/adr/ADR-0059-saas-tenant-authorization-boundary.md`（Accepted）の設計入力です。ただし、同ADRのImplementation gateを満たした後にのみ実装できます。Claude Designはセキュリティ方式を変更せず、確定済み境界のUI表現を検討してください。

- TenantContextはverified claimまたはtrusted host mappingでbackendが解決する。tenantId自由入力は不可。
- 主体tenantと資源tenantの不一致、tenant不明、membership失効、PDP不達はreadを含めてdenyする。Emptyやread-only fallbackに見せない。
- Workspace、Tenant Admin、Platform Control Planeを分ける。Platform面は文書タイトル・本文を扱わない。
- frontendはrole/group名を解釈せず、backendの`effectiveCapabilities`と理由コードだけで操作を表示する。APIは必ず再認可する。
- recent/QueryPreset等の端末保存はtenant/user別に分離され、tenant切替時に旧tenantのDOM/memory/cacheを破棄する。
- support impersonation、「全tenantの文書を表示」、tenant横断検索は設計しない。

### 3. 既存UIと視覚言語

- キャンバスが主、AIや設定は従。キャンバスを開いた後に文書一覧を常設サイドバーにしない。
- 現在、開始時は左上のStartPanelに「新規」「サンプル」「ファイルから読み込み」「review pack import」とlocal recent selectがある。
- Fileメニューに「Open recent document…」があり、独立dialogを開く。
- View/PerspectiveのカスタムプリセットはView controls内にあり、適用・保存・名前変更・削除がある。
- QueryPresetはPatch workspace内にあり、名称、scope、depth、filtersを保存・実行できるが、device-localであることがUIに出ていない。
- コマンドの恒久住所は、キャンバス直接操作 → スリムツールバー → メニュー → コンテキストメニュー → コマンドパレットの5層。今回の入口は既存StartPanel/Fileメニュー/設定節の置換・包含を基本にし、ツールバーへ純増しない。
- 色はslateを基調とし、amberは保留・違和感の保持系専用。管理警告やtoken注意にamberを使わない。新しい色チャネルを作らない。
- SafeModeは既定ON。provider=`none`でもコア操作は成立する。AI提案はproposal-onlyで自動適用しない。
- 角丸6/8/999、font 12/11/10、spacing 2/4/6/8を既存スケールとして扱う。
- Escapeによる段階閉鎖、dialogを開いたtriggerへのfocus復帰、キーボード到達、ja/en同等性を維持する。

### 4. 設計してほしい画面

#### R8-A. Workspace「ドキュメントを開く」

StartPanelとRecent documents dialogを、サーバー正本の文書一覧へ移行する提案を作ってください。

必須要素は次のとおりです。

- タイトル、更新日時、補助的なID、主操作「開く」。本文抜粋、カード数、サムネイル、スコア、利用頻度順位は不要。
- 更新日時の新しい順を既定にし、取得済みのタイトル/IDの絞り込みを提供。
- active文書は静かな「開いています」表示。通知バッジや件数強調を使わない。
- Loading、Empty、Ready、ACL解決不能/403、Network error、Read-onlyの6状態。
- Empty時は「新規作成」「ファイルから読み込む」へ到達できる。権限エラーをEmptyに見せない。
- 403/Network errorではlocal recentを候補として表示せず、再試行を主にする。
- 文書行に削除、アーカイブ、移管、複製、bulk selectionを置かない。
- 開始パネル内の軽い一覧と、Fileメニューから開く一覧が同じコンポーネント/情報順を共有できる構想。
- 1440px、768px、390pxのレッドライン。390pxではtableを横スクロールさせず、同じ情報順のカード/listへ変形。

設計判断として、開始パネル内に数件を見せて「すべて表示」へ進む案と、最初から一覧dialogへ進む案を比較し、推奨を1つ選んでください。キャンバスの主従関係、認知負荷、キーボード動線を理由にしてください。

#### R8-B. 保存範囲の異なる2種のプリセット

同じ「プリセット」でも保存範囲が異なることを、色だけに頼らず誤解なく示してください。

1. View/Perspective:
   - View controls内。
   - 「表示設定ファイルを書き出すときに含まれます」。サーバー自動同期の表現は使わない。
   - 既定プリセットは固定、カスタムは適用・名前変更・削除。
2. QueryPreset:
   - Patch workspace内。
   - 見出しと保存操作の近くに文字で「この端末のみ」。補足「ブラウザのデータを消すと失われます」。
   - 項目は名称、scope/depth/filterの短い要約、実行、その他メニュー（名前変更・削除）。
   - 同期・共有・backup・cloudを示唆しない。

各々について、Empty、保存前、保存済み、名前変更、削除確認、保存失敗を示してください。QueryPresetの保存失敗では、現在入力中のscope/depth/filterを失わせないでください。

#### R8-C. Admin入口とアクセス登録

通常のWorkspaceから明確に分離したAdmin面の最小IAを設計してください。入口はPlatform operatorだけに見え、キャンバスのスリムツールバーには置きません。

今回詳細設計するのは**アクセス登録フォームだけ**です。

- Adminヘッダーに「管理」と「この画面は文書本文を表示しません」。Workspaceへ戻る導線。
- Admin入口の表示制御はbackend認可の代わりにしない。Platform operator権限を検証できない構成ではAdmin面を提供しない前提を状態説明に含める。
- provider、external UID、display name、任意emailの登録フォーム。
- 送信前説明、送信中の二重実行防止、成功receipt、既存登録との同値/競合エラー、権限不足。
- 成功receiptは「登録」を表し、無効化・削除・ロール付与が完了したように見せない。
- ユーザー一覧、検索、無効化、削除、SCIM、ロール編集は描かない。

Admin全体の将来IAは「アクセス登録」「外部接続」「システム状態」の3区分だけを情報設計図で示して構いません。ただし現在存在しない項目をdisabled navigationとして実画面に並べないでください。Auditは含めないでください。

#### R8-D. 将来のエージェント登録・token一度表示

これは`EXT-CONN-02`の契約実装後に使う先行レッドラインです。現在利用可能な画面には見せません。

- 一覧: registrationId、表示名、docId、状態、作成日時、作成主体。文書タイトルを表示しない。token列は存在させない。
- 登録: 表示名とdocId。文書タイトル検索は使わない。登録は文書書込権限を付与しないという説明。
- 完了: tokenを一度だけ表示、copy、再表示不可の説明、保存済み確認を経て閉じる。
- 失効: 表示名、registrationId、docId、影響を確認。再有効化は描かず、新規登録を案内。
- 状態: Empty、Ready、registering、one-time token、revoking、permission denied、generic error。
- tokenがdialogを閉じた後、一覧、toast、DOM、再読み込み後の画面に残っているように見せない。

#### R8-E. Tenant contextと安全な切替（先行レッドライン）

これは`ADR-0059`のImplementation gate完了後に有効化する画面です。現行画面に実装済みとして混ぜないでください。

- membershipが1件の場合はactive tenantをlabelで示し、switcherを置かない。
- 複数membershipの場合だけ、サーバーが返したtenant候補を選べるswitcherを置く。tenantId自由入力や検索による他tenant発見は不可。
- 未保存変更がある状態での切替は、保存・破棄・取消を示す。確定後、旧tenantの文書・選択・検索・work mode・import preview・recent・QueryPresetを消してから新tenantを読み込む。
- tenant mismatch、membership失効、PDP不達は、文書0件のEmptyと区別したblocked stateにする。旧tenant本文を背景へ残さない。
- 1440pxと390pxで、tenant名が長い場合のtruncateとaccessible nameを示す。

#### R8-F. Tenant AdminとPlatform Control Plane（先行IA）

- Tenant Admin: active tenantのmembership provisioningとagent registration。scope見出しにtenant名とopaque tenant ID。本文・文書タイトルなし。
- Platform Control Plane: tenant lifecycle、IdP接続状態、非秘密のsystem status。全tenantの文書件数・タイトル・本文を表示しない。
- Workspace / Tenant Admin / Platform Control Planeは、色だけでなく名称・パンくず・見出し・accessible nameで区別する。
- role editorは作らず、外部IdP/PDPが正本であることを説明する。backend capability不足時は画面を出さず、UI非表示を認可にしない。
- support impersonation、tenant横断文書検索、隠れた「view as tenant」は描かない。

### 5. 出力形式

次を1つの回答パッケージとして返してください。

1. **推奨IA**: Workspace / 文書内設定 / Admin / デプロイ設定の責務図。各設定の「どこに保存されるか」を併記。
2. **画面レッドライン**: R8-A〜F。1440pxを基本に、A/B/Eは390pxでの変形も示す。E/Fはfuture SaaSとして現行面と区別する。
3. **操作フロー**: 文書を開く、2種プリセットの維持、アクセス登録、エージェント登録→一度表示token→失効、未保存変更を伴うtenant切替。
4. **状態表**: Loading / Empty / Error / Permission / Read-only / Successと、表示する主操作。
5. **既存→提案の置換表**: StartPanel local recent、Recent dialog、View controls、Patch workspaceの各要素がどう変わるか。初期表示に何が増減するか。
6. **a11y/focus仕様**: role、accessible name、初期focus、Tab順、Escape、focus復帰、live region、390pxでの読み順。
7. **レッドライン**: 色・余白・タイポ・行高・truncate/折返し・メニュー開閉・token表示/閉鎖の禁止事項。
8. **自己照合**: 下記の採否を○/△/×と理由つきで回答。

可能なら既存の`.dc.html`成果物と同じ方式で、R8-A〜Fを切り替えられる操作可能なプロトタイプを1点作ってください。実装コードやAPIを発明するのではなく、状態fixtureで画面遷移を再現してください。R8-E/Fには「future SaaS / ADR pending」を成果物注記として付け、製品UIのバッジにはしないでください。

### 6. 自己照合項目

- 一般利用者の文書入口とAdminが混ざっていない。
- Admin/agent面にタイトル・本文・カード・narrative・diffがない。
- local recentが認可失敗時のfallbackになっていない。
- QueryPresetが同期済み・共有済みに見えない。
- View/PerspectiveとQueryPresetの保存範囲を文字で区別できる。
- 削除・archive・移管・一覧複製・ユーザー無効化等、未許可操作を描いていない。
- tokenが一度表示後に残らない。
- 新規操作をツールバーへ純増していない。
- amberを管理警告へ流用していない。
- SafeMode、provider=`none`、proposal-only、反スコアリングを弱めていない。
- キーボード、Escape、focus復帰、ja/en、390pxが成立する。
- active tenantが名称・見出し・accessible nameで分かり、色だけに依存しない。
- tenant mismatch/PDP不達をEmptyやread-onlyとして表示していない。
- Tenant AdminとPlatform Control Planeが分離され、tenant横断本文・タイトル・impersonationがない。
- frontendがrole名を解釈して権限を決める案になっていない。

### 7. fixture例

Workspaceだけでは、次の架空タイトルを使って構いません。

- `doc-7f2a` / 地域ヒアリングの整理 / 2026-07-16T09:30:00+09:00
- `doc-a104` / 新サービスの利用観察 / 2026-07-15T17:10:00+09:00
- `doc-c821` / ふりかえりの未整理メモ / 2026-07-12T11:45:00+09:00

Adminとエージェント登録ではタイトルへ解決せず、`doc-7f2a`等のIDだけを使ってください。tokenは`kjat_demo_once_••••••••`のような無効な架空値にしてください。

SaaS先行画面では`tenant-acme-research` / `地域調査チーム`と`tenant-beta-lab` / `新規事業ラボ`を使って構いません。両tenantに同じ`doc-shared-id`が存在するfixtureとし、片方の情報がもう片方へ表示されない状態を示してください。

---

## プロジェクト側の受領条件

- 回答は`02_Architecture/design/master-data-settings-ui-ux-concept.md`とAccepted ADRへ照合する。
- 未定義のAPI、ユーザーライフサイクル、Audit閲覧、デプロイ設定編集が提案に含まれた場合、その部分は採用しない。
- 採用後も、Workspace文書一覧は`api.md` / `schemas.md`の契約先行、エージェント登録は`EXT-CONN-02`の段階ゲートを満たすまで実装しない。
- R8-E/Fは`ADR-0059`のImplementation gate、TenantContext、tenant従属DB制約、DB側tenant guard、capability API、deny-only profile、越境negative testが揃うまで有効化しない。
- 実装ラウンドでは同一fixture・ja/en・1440/768/390pxでスクリーンショットを再生成し、`design-qa-checklist.md`で照合する。
