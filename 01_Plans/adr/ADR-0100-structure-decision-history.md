# ADR-0100: 構造の判断理由を、操作の記録と後からの理由づけに分けて残す

- Status: Accepted
- Date: 2026-10-21
- Deciders: Maintainer
- Scope: `03_Implement/frontend/src/domain/structure_decisions.ts`、`03_Implement/frontend/src/App.tsx`、`03_Implement/frontend/src/ui/SidePanel.tsx`、`03_Implement/backend/src/sui_sensemaking_api/models.py`、`02_Architecture/schemas.md`
- Related: `ADR-0041`（CVI）、`ADR-0089`（価値の正本）、`ADR-0099`（判断理由の改訂履歴）

## 価値への寄与

V2「構造化」とV3「レビュー」に寄与する。島を作った理由、カードを島へ入れた・外した理由、保留にした理由を、現在の構造とは別に辿れるようにする。判断をやり直すとき、以前の見立てを「最初から無かったこと」にしないための履歴である。

## Context

カードと島の違和感メモは、現在値と改訂履歴を分けて保持する（ADR-0099）。島の要約にも `summaryHistory` がある。

一方、構造操作の理由は残らない。島を作った直後は理由を説明できても、保存・再読込をまたぐと、なぜそのまとまりにしたのか、なぜそのカードを外したのか、なぜ保留にしたのかを再構築できない。カードの違和感メモは現在の見立てであり、過去の構造操作の理由を置き換えない。

Issue #3239 は、すべてのUI操作を監査ログ化せず、島の作成・カードの追加/除外・保留状態の変更に限定した小さな `StructureDecisionRecord` を求めた。

制約は次のとおりである。

- 現在の構造を正本とし、履歴と二重の正本を作らない。
- 通常の操作を重くしない。理由の入力を操作の必須条件にしない。
- 保存・再読込・exportで意味が変わらない。
- reviewer identityを必須にしない。
- AI提案のrationaleを人の判断理由へ自動転記しない。
- 履歴の欠落をAI生成文で補完しない。
- SafeModeと共有範囲を広げない。

## Decision

### 1. 記録する操作を4つに限定する

`DocumentV1.structureDecisions` に、次の操作だけを記録する。

- `island_create`: 島を作成した。`islandId` と、島を構成した `cardIds` を持つ。
- `cards_added_to_island`: カードを島へ追加した。
- `cards_removed_from_island`: カードを島から除外した。
- `hold_state_changed`: 保留状態を変更した。`fromValue` / `toValue` を持つ。

すべての編集操作、キャンバス移動、表示切替、AI呼び出しは記録しない。これは監査ログではなく、後から構造判断を説明するための最小の履歴である。

### 2. 操作時には事実だけを記録し、理由は後から追記できる

操作の時点で理由の入力を求めない。構造操作は従来どおり1操作で完了し、`structureDecisions` には操作の事実・対象・時刻だけを追加する。

理由は、SidePanelの「構造の判断履歴」から後で追記できる。`rationale` は任意で、空にすれば削除する。これにより、理由を書く余裕がないときも操作を止めず、後から説明を補える。

### 3. 現在の構造が正本である

`islands` と `cards[].holdState` が現在の構造の正本であり、`structureDecisions` はそれを変更しない。履歴から構造を自動復元する機能は、このADRでは作らない。`cardIds` と `islandId` は、元カードへ戻る手掛かりとして保持する。

人が履歴の1件を選び、その `hold_state_changed` が示す保留状態へ戻す操作は許可する。対象はその履歴の `cardIds` だけに限定し、島の作成やカード追加/除外は自動で巻き戻さない。復元は通常のdocument変更としてundoでき、履歴自体は書き換えない。

### 4. 履歴は100件で打ち切る

`structureDecisions` の上限は100件とし、超えた分は古いものから落とす。長期の全履歴保持が必要になった場合は、別の保存境界（append-onlyのdecision store等）をADRで決める。

### 5. SafeModeの共有境界を広げない

共有・書き出し用の投影では、`rationale` を墨消しし、ID・時刻・action・cardIds・fromValue/toValueだけを残す。rationaleは未レビュー本文を含み得るため、現在の `critique` と同じ扱いにする。

### 6. AIで履歴を補完しない

`rationale` が無い操作は、無いまま残す。AIがもっともらしい理由を生成して埋めない。エージェント応答の採用は構造操作の理由として自動記録しない。

## Consequences

- 島を作った理由、カードを追加/除外した理由、保留にした理由を、後から辿れる。
- 通常の構造操作の操作数は増えない。理由は任意で、必要なときだけ書く。
- Documentのoptionalフィールドが1つ増える。既存文書は欠落のまま読める。PydanticモデルとTypeScript型の契約を同期させる。
- 100件上限は、長期利用で古い判断が落ちることを意味する。全履歴の保持は別の保存境界で扱う。
- 履歴からの構造の自動復元は対象外。ただし、保留状態だけは人が履歴から手動で戻せる。元カードへ戻る手掛かりは `cardIds` で残す。
- rationaleの文章品質は評価しない。書かれていないことを欠落として扱う。

## Traceability

- Issues: #3239
- Related: `ADR-0041`, `ADR-0089`, `ADR-0099`
- Supersedes: なし
