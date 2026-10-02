# 代表視覚手掛かりの保存候補比較

区分: Internal / Design decision input（DOMAIN-VISUAL-CUE-01 T6）

Updated: 2026-08-02

目的: T5（emoji比較）の結論を踏まえ、代表視覚手掛かりシステムの4つのデータコンポーネント（採用参照、権利情報、画像本体、サムネイル）の保存方式を比較し、ADR-0060の受理条件「画像保存先、容量上限、削除、import/export、オフライン表示をfixtureで比較する」を充足する。本比較の結論はADR-0060の決定事項として反映する。

T5の結論（`unicode_emoji_os_comparison.md`）:
- Phase 1既定: Unicode絵文字（配布容量ゼロ、OSフォント依存）
- 補完: OS間不一致が確認されたcueだけ個別SVG化

## 1. 比較対象のコンポーネント

| コンポーネント | 内容 | サイズ特性 |
|---|---|---|
| 採用参照 | どの手掛かり（cueId）をどの島に採用したかのマッピング | 小（島ID + cueId + altText、1件あたり約100 bytes） |
| 権利情報 | ライセンス、出典、帰属、ソースURL、作成者、許容用途 | 小（構造化テキスト、1件あたり約200〜500 bytes） |
| 画像本体 | 実際の画像データ（利用者写真、SVG、PNG） | 中〜大（48×48px PNG: 約1〜2KB、写真: 数十〜数百KB） |
| サムネイル | 画像本体の派生縮小版（リスト・一覧表示用） | 小（48×48px固定、約1〜2KB） |

## 2. 保存方式の比較

### 2.1 採用参照 + 権利情報（構造化メタデータ）

| 候補 | オフライン | import/export | SafeMode整合 | 削除 | 容量 | 判断 |
|---|---|---|---|---|---|---|
| `DocumentV1.islands[].representativeCue` に埋め込み | ○ | ○ 自動往復 | ○ フィールド単位でSafeModeポリシー適用可 | △ document全体の書換が必要（ADR-0033の設計範囲内） | 小 | **採用** |
| `DocumentV1` の独立配列 `representativeCues[]` | ○ | ○ 自動往復 | ○ | ○ 独立削除可能 | 小 | 不採用（島との関連付けが冗長になる） |
| DB別テーブル | × サーバー依存 | × 別途API同期が必要 | △ テナント境界整備後に評価 | ○ SQL DELETEで高速 | 小 | 不採用（L2/L3昇格時に再評価） |
| `view.json` viewState | × viewStateのみ | △ viewデータとして往復 | ○ | ○ ビューリセットで消去 | 小 | 不採用（永続データではない） |

**決定: `DocumentV1.islands[].representativeCue` へ埋め込む**

理由は次のとおりです。
- 島単位の1:1関係（1島に1手掛かり）であり、独立配列の正規化は過剰設計
- DocumentV1の既存拡張パターン（`holdState`、`ShelfEntry`等）と整合する
- import/exportの自動往復を継承し、追加のシリアル化コード不要
- 採用しない島はフィールド省略（`undefined`）で表現し、容量増加は最小

### 2.2 画像本体

| 候補 | オフライン | 容量上限 | import/export | SafeMode整合 | 判断 |
|---|---|---|---|---|
| Base64で`DocumentV1` JSONに埋め込み | ○ | △ 写真でJSONが数MBに肥大化。5MiB警告境界を容易に超過 | ○ 自動往復 | ○ | 不採用（JSON肥大化） |
| ファイルシステム/IndexedDBに分離保存 | ○ | ○ 上限を個別設定可能 | △ export時に別途bundling必要 | ○ | **採用（Phase 1）** |
| JS bundle同梱（プリセットのみ） | ○ | ○ 最小 | ○ コードと一緒に配布 | ○ | **採用（プリセットに限定）** |
| 外部URL | × 通信必須 | ○（サーバー側） | × URLの有効期限・非互換リスク | × SafeModeで遮断 | 不採用（経路C/D限定） |

**決定: 供給経路別に分離する**

| 経路 | 画像本体の保存方式 | 容量上限 |
|---|---|---|
| A: 手描き/基本図形 | IndexedDB（localStorage非推奨、容量制限が厳しい）。描画データはJSONシリアル化可能なベクター命令列として格納 | 1件あたり4KB |
| A: 利用者画像 | IndexedDB。元画像から48×48pxへリサイズして保存。元画像は保持しない（一次視覚資料として必要な場合は別途`SourceVisualMaterial`で扱う） | 1件あたり16KB |
| B: Unicode絵文字 | **画像本体なし**。OSフォントに依存し、文字として表示 | 0 bytes |
| B: 同梱プリセットSVG | JS bundle同梱。cueId→SVG文字列の定数マップとして実装 | 8種で約4KB、最大32種で約16KB |
| C/D（外部素材・生成画像） | 本比較の範囲外。経路C/Dの実装時に別途決定（ADR-0060 §8によりT8まで延期） | 未定 |

### 2.3 サムネイル

| 候補 | 生成方法 | 判断 |
|---|---|---|
| 画像本体からリアルタイム描画 | `<img width=48 height=48>` でブラウザに任せる | **採用（既定）** |
| 事前生成してIndexedDBに保存 | 画像本体登録時に48×48へリサイズして別blobとして保存 | 不要（本体が小さいため） |

**決定: サムネイルは画像本体からリアルタイム描画する**

理由は次のとおりです。
- Unicode絵文字は本体が存在しない（文字レンダリングで自然に縮小表示される）
- プリセットSVGはベクターのため任意サイズで描画可能
- 利用者画像は48×48へリサイズ済みのため、サムネイルと本体が同一
- 個別のサムネイルblobを管理する複雑性に見合う利益がない

## 3. 容量と削除の境界

### 3.1 容量上限

| 項目 | 上限 | 根拠 |
|---|---|---|
| 採用参照1件 | 約200 bytes（cueId + altText + license metadata） | 構造化テキストのみ |
| プリセットSVGバンドル全体 | 16KB（最大32種） | JS bundleサイズへの影響を最小化 |
| 利用者画像1件 | 16KB（48×48px PNG、リサイズ後） | IndexedDBの容量圧迫を防止 |
| 手描きデータ1件 | 4KB（ベクター命令列） | 複雑な描画でも十分 |
| DocumentV1全体への追加容量 | 採用島1件あたり約200 bytes。100島で約20KB | 許容範囲内 |

### 3.2 削除

| 操作 | 削除範囲 |
|---|---|
| 島から手掛かりを外す | `island.representativeCue` を削除。手描き/利用者画像のIndexedDBエントリを削除。他島が同じ手掛かりを採用中でも削除する（参照カウント管理は複雑性過剰） |
| 島を削除する | 島の削除に伴い上記と同じ処理を実行 |
| 手掛かりを変更する | 旧手掛かりのIndexedDBエントリを削除し、新手掛かりを登録 |

削除後に監査情報は残さない。手掛かりは思考内容ではなく補助表示であり、監査証跡の対象外とする。

実装上は、採用・変更・削除のUndo要件を満たすため、文書履歴（past / present / future）のいずれかが参照しているエントリを即時削除しない。参照が全履歴から外れたときに、同一documentかつ同一browser storage scopeの不要エントリを削除する。SaaS scopeは`deployment + tenantId + principalId`で分離し、別scopeの参照から画像本体を解決しない。この遅延削除は監査保持ではなく、既存の文書Undo期間だけに限定した可逆性境界である。

## 4. import/export 境界

| コンポーネント | export | import |
|---|---|---|
| 採用参照 + 権利情報 | `DocumentV1` の一部として自動往復（JSONフィールドとして出力） | strict validationで未知cueId・不正ライセンス形式を拒否 |
| 手描きデータ | 既定では参照と本体を除外。件数・機微情報警告を伴う一回限りの明示opt-in時だけ、文書参照と完全一致する `representative_visual_cue_assets.json` を出力しintegrity hash対象にする | 文書ID・全参照・参照kind・件数・容量・strict schema・integrity対象を検証後、同一scopeへ単一transactionで再格納。asset fileがなければdanglingな`hand_drawn` cueを除去 |
| 利用者画像 | 原本を保持せず、端末内で切り抜き・減彩した48×48 PNGだけをIndexedDBへ保存する。review packでは手描きと同じく既定除外し、明示opt-in時だけBase64で同じasset fileへ含める | Base64のcanonical形式、PNG signature、IHDR、chunk CRC・終端、48×48、16KB上限、参照kindを再検証してIndexedDBへ格納。asset fileがなければdanglingな`user_image` cueを除去 |
| プリセットSVG | **出力しない**（cueIdだけを出力し、import側が自身のJS bundleから解決） | cueIdが既知プリセットに含まれることを確認 |
| Unicode絵文字 | **出力しない**（cueIdだけを出力。emojiは文字であり配布不要） | cueIdが既知emojiセットに含まれることを確認 |

## 5. 決定サマリー

| # | 項目 | 決定 |
|---|---|---|
| 1 | 採用参照・権利情報の保存先 | `DocumentV1.islands[].representativeCue`（L2: payload内埋め込み） |
| 2 | 画像本体（経路A手描き/利用者画像） | IndexedDB（上限: 手描き4KB、画像16KB） |
| 3 | 画像本体（経路B絵文字） | 保存不要（OSフォントに依存） |
| 4 | 画像本体（経路BプリセットSVG） | JS bundle同梱（上限: 計16KB / 最大32種） |
| 5 | 画像本体（経路C/D） | 未定（T8へ延期） |
| 6 | サムネイル | 画像本体からリアルタイム描画（個別保存しない） |
| 7 | 容量上限（DocumentV1） | 採用島1件約200 bytes、100島で約20KB |
| 8 | 削除方針 | 参照カウントなしの単純削除 |
| 9 | import/export | 採用参照はDocumentV1自動往復。画像データはbundleに含めて往復 |

## 6. 参照

- T5 emoji比較: `02_Architecture/design/unicode_emoji_os_comparison.md`
- ADR-0060（本比較の反映先）: `01_Plans/adr/ADR-0060-representative-visual-cue-source-boundary.md`
- 要件: `00_Prompt/representative_visual_cue_requirements.md`
- 評価計画: `02_Architecture/representative_visual_cue_evaluation.md`
