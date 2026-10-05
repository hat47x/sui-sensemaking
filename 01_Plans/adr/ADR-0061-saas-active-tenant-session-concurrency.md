# ADR-0061: SaaS active tenantを認証セッション単位で直列化する

- Status: Accepted
- Date: 2026-07-19
- Deciders: Project Maintainer
- Scope: `02_Architecture/`, `03_Implement/backend/`, `03_Implement/frontend/`, trusted auth/session adapter

## Context

`ADR-0059` は、backendがactive tenantを再確認して認証セッションへ保存すること、およびfrontendがtenantを切り替えた後に、古いDOM、memory、browser storage、worker、object URLを破棄することを、境界として固定した。現行の準備実装も、このsession persisterとhard replacementを前提にしている。

ただし、同じ認証セッションを複数のタブで使う場合の並行性が、定義されていなかった。タブAがtenant Aの文書を表示している間に、タブBがactive tenantをtenant Bへ変更したとする。このとき、タブAの表示、保持している`docId`、未送信のpayloadはtenant Aのままである。しかし、次のrequestを解決するserver sessionは、tenant Bになりうる。両方のtenantに同じ`docId`が存在し、利用者が両方への書き込みのcapabilityを持つ場合は、tenantの越境という権限の違反ではなくても、古いtenantの内容を新しいtenantへ誤って送る、対象範囲の取り違えが成立する。

BroadcastChannel、storage event、focus時の再読み込みは、利用者体験を改善する。しかし、通知の欠落、バックグラウンドのタブ、bfcache、停止したプロセス、ネットワーク応答の競合を、認可の境界として防ぐことはできない。逆に、active tenantをタブ単位へ変更するには、trusted sessionの形式、requestの束縛、CSRF、logout、capabilityのキャッシュを含む、別のcontext契約が必要になる。

## Decision

### D1: 1つの認証セッションにactive tenantは1つだけとする

- active tenantの変更は、同じ認証セッションを使う全タブへ影響する。異なるtenantを同時に操作したい場合は、別の認証セッション、または将来の明示的なタブ単位の契約を使う。
- tenant switcherの確認には、「このブラウザの他のタブも切り替わります」を文字で表示する。複数のタブの存在を検出できる場合だけ出す、条件付きの注意にはしない。
- frontendは、別のタブで古いtenantの本文を操作し続けられるように見せない。contextの変更を検知した時点で、本文、Adminのmetadata、dialog、未送信のプレビューを非表示にして、再確認の状態へ移す。

### D2: サーバーが発行する`tenantSessionVersion`を、contextの整合の前提条件にする

- trusted auth/session adapterは、認証セッションのactive tenantの状態ごとに、予測できず不透明な`tenantSessionVersion`を発行する。値は1〜128文字の正規のIDとし、active tenantを変更するときに必ず変更する。
- `GET /session/context`は`tenantSessionVersion`を返す。`POST /session/active-tenant`は、現在の値を`expectedTenantSessionVersion`として必須の入力とし、一致した場合だけ切り替えを保存して、新しいversionを返す。同時の切り替えや、古いdialogからの確定は、`tenant_session_changed`で拒否する。
- SaaSプロファイルのtenant単位のAPIは、read、write、list、export、share、import、MCP、webhook、jobの登録を含め、clientが最後に検証したversionを、requestの前提条件として要求する。backendは、trusted sessionからactive tenantと現在のversionを解決した後、resourceを参照する前に、一致を検証する。
- clientが送るversionは、tenantやcapabilityを決める認可の根拠ではない。欠損や不一致の場合に処理を止めるための、expected-contextのガードである。実際のtenant、membership、capabilityは、従来どおり、サーバーの正本から解決する。
- versionを、Document、export、importのpayload、browserの永続設定、URL、監査の本文へ保存しない。監査には、必要な場合も`tenant_session_changed`という結果だけを残し、versionの生の値は記録しない。

### D3: 古いcontextを、read-onlyにも自動の再送にも寄せない

- versionの欠損や不一致の場合は、本文を返さず、変更も適用せず、`409 tenant_session_changed`、または同等の安定したエラーで、安全側に拒否する。他のtenantの資源の存在や、現在のtenant IDは、応答へ反映しない。
- frontendは、古いrequestを新しいcontextで自動的に再送しない。特に、PUT、import、share、export、Adminの更新は、利用者が新しい対象範囲を確認した後にだけ、再実行できる。
- 古いcontextで開始したresponse、workerの結果、object URL、楽観的更新は、versionが変わった後に、DOM、キャッシュ、ダウンロードへコミットしない。
- capability versionは、ポリシーのスナップショットのversionである。active tenant sessionの並行制御には流用しない。

### D4: タブ間の通知と、lifecycleでの再確認を、UX層の補助的な境界にする

- tenantの切り替えに成功した後、frontendは、同一originのBroadcastChannel、または同等の一時的な通知で、「session context changed」だけを伝える。tenant ID、principal ID、タイトル、本文、capability、versionの生の値を、通知のpayloadに含めない。
- 通知を受けたタブは、古い本文を、すぐにブロック状態へ置き換える。進行中のrequestとworkerをabortして、`GET /session/context`からやり直す。通知を送受信すること自体は、認可の判定に使わない。
- `pageshow`の`persisted=true`、長時間の非表示からの復帰、オンラインへの復帰、認証の更新の後は、古い本文を操作できるようにする前に、session contextを再確認する。SaaSのapp shellとsession responseは`no-store`を維持し、bfcacheから戻ったDOMを、信頼できるcontextとして扱わない。
- 通知のAPIが使えない場合でも、サーバー側のversionの前提条件により、安全側に停止できることを必須とする。

### D5: capabilityの失効とtenantのlifecycleの変更も、同じblocked UXへまとめる

- membershipの停止、tenantの停止、capability resolverへの不達、PDPへの不達、session versionの不一致は、空の状態に見せかけない。既存のデータを背景に残さないブロック状態とし、再試行、再認証、Workspaceへ戻るのうち、安全に実行できる導線だけを示す。
- 生のエラー、tenant ID、principal ID、policyRef、role/group、tokenを、エラーの表示へ反映しない。
- 再確認の後で同じtenantへ戻った場合でも、古い未送信のmutationを、自動で復元も送信もしない。端末ローカルの入力を復元できるかどうかは、データの種別ごとに明示する。tenantに束縛されたプレビューは破棄する。

## Implementation gate

共有SaaSプロファイルを有効にする前に、`ADR-0059`のgateに加えて、次を満たす。

1. trusted auth/session adapterが、active tenantと`tenantSessionVersion`を、原子的に解決して更新できる。
2. session contextとactive tenantのAPIが、versionの閉じた検証、条件付きの更新、no-storeを実装する。
3. すべてのtenant単位の公開APIと、非同期処理の開始点が、versionの前提条件を、resourceを参照する前に検証する。未対応のrouteがある間は、SaaSプロファイルの起動を拒否する。
4. tenant AとBに同じ`docId`を用意し、2タブでの同時操作、同時のtenant切り替え、古いGET/PUT/export/import/Adminの更新、遅れて届いたresponse、workerの完了、bfcacheからの復帰について、ネガティブマトリクスを固定する。
5. タブ間の通知が欠落または無効でも、サーバーのガードが拒否することを確認する。通知に成功したときは、古いDOMとフォーカスがブロック状態へ移ることを、1440/390px、ja/enで検証する。

## Alternatives considered

1. **active tenantをタブ単位にする**: 複数のtenantを並行して利用しやすい。しかし、タブに束縛したtoken、requestの束縛、CSRF、logout、refresh、リンクを開く動作について、新しい契約が必要になり、現行のsession persisterと整合しない。将来の別のADRなしには採用しない。
2. **BroadcastChannelだけで同期する**: 通知の欠落や、停止中のタブを防げない。クライアントの通知を、安全の境界にしてしまうため、不採用。
3. **`capabilityVersion`を並行制御に流用する**: tenantを切り替えても必ずしも変わらない。ポリシーのlifecycleとsessionのlifecycleを混同するため、不採用。
4. **tenantごとにhostを分け、switcherを廃止する**: 強い分離になりうる。しかし、複数のmembershipを持つ利用と、現行のRound 8の構想を変更することになる。trusted host mappingを採用するデプロイの選択肢としては残すが、共通の契約にはしない。
5. **古いrequestを新しいtenantへ自動的に再送する**: 古い対象範囲のpayloadを、新しい対象範囲へ適用してしまいうるため、不採用。

## Consequences

- 別のタブでtenantを切り替えると、他のタブも再確認が必要になる。異なるtenantを、同じsessionで並行して編集することはできない。
- active tenantの切り替えと、全tenant単位のAPIへ、versionのガードを追加する実装コストが発生する。
- クライアントの通知やUIの後始末が失敗しても、サーバーが、古いrequestとresponseを閉じる。二重の境界になる。
- Claude Designのtenant切り替えのレッドラインには、他のタブへの影響、対象範囲の失効、bfcacheと復帰、古い保存の拒否という状態が必要になる。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 1つの認証セッションにactive tenantは1つだけ。切り替えは全タブへ波及し、異なるtenantの同時操作は、別のセッション、または将来のタブ単位の契約で対応する | 切り替えの確認UIは、「このブラウザの他のタブも切り替わります」を常に表示する。contextの変更を検知したときに、本文、Adminのmetadata、dialog、未送信のプレビューを非表示にして、再確認の状態へ移す |
| **データ設計** | trusted auth/session adapterが、active tenantの状態ごとに不透明な`tenantSessionVersion`を発行し、切り替え時に必ず変更する。versionは、Document、export、browserの永続設定、URL、監査の本文へ保存しない | versionは認可の根拠ではなく、expected-contextのガードである。実際のtenant、membership、capabilityは、サーバーの正本から解決する。監査には`tenant_session_changed`という結果だけを残し、versionの生の値は記録しない |
| **機能設計** | `GET /session/context`はversionを返し、`POST /session/active-tenant`は`expectedTenantSessionVersion`を必須の入力として、一致したときだけ切り替えを保存する。全tenant単位のAPIは、resourceを参照する前にversionの一致を検証し、欠損や不一致は`409`で安全側に拒否する | 古いrequestを、新しいcontextで自動的に再送しない。PUT、import、share、export、Adminの更新は、利用者が新しい対象範囲を確認した後にだけ、再実行できる。古いcontextのresponse、workerの結果、object URLはコミットしない |

## Non-goals

- タブ単位のtenant session、複数のtenantの同時編集、サポートによるなりすましを導入しない。
- `tenantSessionVersion`を、認証token、tenantの選択子、権限の移送値として使用しない。
- single-tenantプロファイルのオフラインとlocal-firstの動作へ、versionのガードを強制しない。

## Traceability

- Parent boundary: `01_Plans/adr/ADR-0059-saas-tenant-authorization-boundary.md`
- Implementation: `01_Plans/issues/done/issue-SAAS-TENANT-01-tenant-context-and-storage-foundation.md`
- API target: `02_Architecture/api.md` §10
- UI input: `02_Architecture/design/master-data-settings-ui-ux-concept.md`, `02_Architecture/design/design-request-2026-07-round8.md`
- Threat model: `THREAT_MODEL.md`
