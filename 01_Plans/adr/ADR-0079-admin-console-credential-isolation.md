# ADR-0079: 独立管理コンソールを採用する場合のcredential分離設計

- Status: Accepted
- Date: 2026-08-25
- Accepted: 2026-08-26（**D1=A / D2=A / D3=A**。保守者による明示承認。仮承認ではない）
- Deciders: Maintainer
- Scope: `03_Implement/frontend`（将来の管理コンソール、採用する場合）、`03_Implement/backend/src/sui_sensemaking_api/control_plane_auth.py`、`02_Architecture/enterprise_architecture.html`、`THREAT_MODEL.md`

## 採択記録（2026-08-26）

保守者の明示承認によりProposed → Accepted。採択内容は推奨どおり **D1=A / D2=A / D3=A**。管理コンソール自体の構築着手は本ADRとは別判断とし、現時点では見送る（`issue-OPS-ADMIN-UX-01`側に記録）。

## Context

`issue-OPS-ADMIN-UX-01-first-class-admin-console-and-cli.md` は、正式CLI（`sui_sensemaking_api.cli`）へのcontrol-plane command追加をAC-1〜4として完了させた（provider/model登録、tenant allowlist設定、監査照会、業務キー拒否、revision競合409、いずれも実backend E2Eで確認済み）。残るAC-5は次の一文である。

> 管理コンソール採用時は利用者SPAへ管理credentialを保存・配送しない設計がADR化される。

この一文は「コンソールを今作るべきか」ではなく「作る場合にどう作るべきか」を問うている。同issueの第4調査記録（2026-08-17）は、独立管理consoleが備えるべき表示・境界要件を既に列挙している。

- 常時表示する認証モードbadge（「初期設定キー・全体操作」／「権限session・Tenant A」）。
- 監査一覧の範囲表示（全体または現在tenant）と、Stage-Bで他tenantを選べないUI。
- `actorRefHash`を人名のように見せず「照合用fingerprint」と説明する表示。
- tenant/model変更のpreview、revision競合時の再読込と差分再確認。
- 利用者SPAとは別origin・別bundleとし、bootstrap keyをbrowser storageへ保存しない構成。

`ADR-0072`（Accepted）は管理面APIの認可方式（D1=A+Bの二段: bootstrap専用の静的`SUI_ADMIN_API_KEY` + IdP登録後はtrusted auth edgeのJWT・platform-operator capability claim）を既に決定した。しかしADR-0072は**API側の認可**を扱い、**それを呼び出す管理コンソールという新しいフロントエンド資産が、その二段の鍵をどう保持・伝送・破棄するか**は決めていない。この欠落を放置したまま誰かが管理コンソールの実装に着手すると、静的admin bearerがブラウザ資産（bundle、localStorage、sessionStorage、DevToolsで観測可能なメモリ）へ漏れる設計を選びかねない。それは`ADR-0072`が明示的に避けようとした「静的秘密の運用リスク」をUI側で再導入する。

## 決定すべき論点

- **D1**: 管理コンソールという独立フロントエンド資産を、いつ・どの条件で着手可能とするか。
- **D2**: コンソール自身が保持する認証情報の種類とライフサイクル。
- **D3**: コンソールのbundle・origin・capability audienceを利用者SPAからどう分離するか。

## 選択肢

### D1: 着手条件

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A** | 本ADRのD2/D3が採択されるまで着手しない（`ADR-0072`と同型の「採択前に着手しない」ゲート） | 秘密漏えい・plane混在を設計段階で防ぐ | コンソール提供が遅れる。現状はCLIで運用継続 |
| B | 着手を許可し、実装中にD2/D3を並行決定する | 早く始められる | 実装が先行し後戻りしにくい。過去の`ADR-0072`と同種の後追い修正リスクを繰り返す |

### D2: コンソール自身の認証情報

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A** | 初回のみ静的admin bearerを**入力フォームへ一度だけ**入力させ、backendが即座に短命session token（分単位TTL、`ADR-0072`のcapability claim相当）へ交換する。bearer自体はメモリ上でも交換後に破棄し、どのbrowser storageにも書かない。以降のconsole操作は交換済みsession tokenのみを使い、再ログイン時は毎回この交換を繰り返す | 静的秘密がconsole側に永続化されない。IdP未登録のbootstrap状況でも動作する（`ADR-0072` D1=Aと同じ前提） | 毎回ログイン操作が必要（意図的なUX上の摩擦。長時間セッションを持たせない） |
| B | trusted auth edgeのJWT + platform-operator/tenant.provision capability claimのみを受理し、静的admin bearer入力欄自体をconsoleに設けない | 秘密の取り扱いが最小 | IdP未登録のbootstrap時点でconsoleが使えない。`ADR-0072`のD2 SaaS分離（bootstrap専用経路の必要性）と矛盾する |
| C | 静的admin bearerをconsoleのconfig/env経由で長期保持する | 実装が最小 | `ADR-0072`が防いだリスクをUI側で再導入する。棄却 |

### D3: bundle・origin・capability分離

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A** | 利用者SPAとは別のViteビルド出力（別bundle、別デプロイ先origin）とする。共有可能なUIプリミティブはpackageとして切り出す | `enterprise_architecture.html` §06のplane分離要求と直接整合。利用者SPAのbundleに管理コードを混ぜない | デプロイ構成が増える（新しい静的ホスティング先が必要） |
| B | 同一SPA内に`/admin-console`ルートを設け、code-splitting（`React.lazy`）で分離するだけに留める | デプロイが単純 | 同一originのため、SPAの脆弱性（XSS等）がconsoleの認証情報にも到達し得る。`enterprise_architecture.html`のplane分離要求を弱める |

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | 管理者はcurl/自作scriptに依存しており（CLIはAC-1〜4で解決済み）、UIとしての確認・差分表示を持つコンソールは運用品質の向上であって現時点でCLIが担えない業務journeyの欠如ではない（CHK-B1: 「あったほうがいい」の域を出ない）。したがってD1=Aとし、着手条件（D2/D3の採択）を先に固定する | データ: 着手前提としてD2の秘密ライフサイクルを固定する。機能: 着手前提としてD3のplane分離を固定する |
| **データ設計** | 静的admin bearerは`ADR-0072`のD1=Aで意図的に「bootstrap専用の最小権限経路」と位置づけられた。この性質を保つには、admin bearerの正本はbackendのみが持ち、consoleは交換後の短命tokenだけを扱うデータ境界が必要（D2=A） | 業務: 毎回ログインというUX摩擦を、bootstrap操作の頻度が低いことと合わせて許容する。機能: 交換APIは既存`ADR-0072`のcapability claim発行経路を再利用し、新しい永続trustを作らない |
| **機能設計** | コンソールのbundle/originを利用者SPAから分離すること（D3=A）で、`enterprise_architecture.html` §06のWorkspace Data Plane／Tenant Admin／Platform Control Plane分離要求をフロントエンド資産の単位でも維持する | 業務: Platform operatorに文書readを暗黙付与しないという既存不変条件を、コンソインのbundle分離によっても補強する。データ: 別originであることが、XSS等でSPA側から管理session tokenへ到達する経路を構造的に遮断する |

## 推奨（保守者の判断を拘束しない）

**D1=A、D2=A、D3=A** を推奨する。

理由: `ADR-0072`がAPI側で確立した「静的bearerはbootstrap専用の最小権限経路、通常運用はcapability claim」という二段構成を、コンソールという新しいフロントエンド資産でも一貫させることが目的である。D2=Aは、静的bearerをconsole側のどのbrowser storageにも書かず、backendへの一度限りの交換だけに使うことで、`ADR-0072`が防いだ「静的秘密の運用リスク」をUIで再導入しない。D3=Aは既存の`enterprise_architecture.html` plane分離要求をフロントエンド資産の単位まで拡張する。D1=Aは、これらが未決のまま実装が先行することを防ぐ。

D2=Bは理論上より安全に見えるが、`ADR-0072`が「D2=Aの実装は2段に分ける」として明示的に残したbootstrap要件（IdP未登録状態でも管理操作が可能でなければならない）とコンソールでも整合させる必要があり、単独では成立しない。

## Non-goals

- 管理コンソールの画面設計そのもの（ワイヤーフレーム、操作フロー）は本ADRの対象外。第4調査記録の要件を満たすUI設計は別途行う。
- Tenant Admin向けdocument-access管理面（`issue-SAAS-TENANT-01`のR8-G）のUI設計は対象外。
- `ADR-0072`が既に決定した管理API自体の認可方式の再決定は行わない。

## Traceability

- Implementation: `01_Plans/issues/done/issue-OPS-ADMIN-UX-01-first-class-admin-console-and-cli.md`（AC-5。Done）
- Related: `01_Plans/adr/ADR-0072-control-plane-authorization-separation.md`（D1=A+Bの二段。本ADRが前提とする）
- Related: `01_Plans/adr/ADR-0067-three-element-constraint-design-method.md`
- Related: `02_Architecture/enterprise_architecture.html` §06（plane分離要求）
- Related: `01_Plans/issues/done/issue-SEC-ADMIN-PLANE-04-stage-b-audit-tenant-boundary.md`（Stage-B監査のtenant境界。第4調査記録の一部）
