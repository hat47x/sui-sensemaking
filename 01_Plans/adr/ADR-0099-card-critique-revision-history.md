# ADR-0099: カードの判断理由を、現在値と改訂履歴に分けて保持する

- Status: Accepted
- Date: 2026-10-20
- Deciders: Maintainer
- Scope: `03_Implement/frontend/src/domain/types.ts`、`03_Implement/frontend/src/domain/critique_history_ops.ts`、`03_Implement/frontend/src/App.tsx`、`03_Implement/frontend/src/ui/SidePanel.tsx`、`03_Implement/frontend/src/domain/inquiry_bundle_safe_mode.ts`、`03_Implement/backend/src/sui_sensemaking_api/models.py`、`02_Architecture/schemas.md`
- Related: `ADR-0026`（HITL反復）、`ADR-0041`（CVI）、`ADR-0051`（一括理由追記）、`ADR-0089`（価値の正本）、`ADR-0090`（候補層）

## 価値への寄与

V3「レビュー」とV4「共有と学習」に寄与する。人が以前どこに違和感を持ち、後から何を材料に判断を変えたかを、保存・再読込をまたいで辿れるようにする。現在の判断を確定させる機能ではなく、判断の変更を「最初から無かったこと」にしないための履歴である。

## Context

島の要約には `summaryHistory` があり、改訂を辿れる。カードの `critique` は現在値だけを保持するため、保存・再読込をまたぐと、以前の違和感や保留理由が失われる。frontendのUndo/Redoは同一session内の可逆性には使えるが、長期的な判断履歴の正本にはならない。

Issue #3175 は、この非対称を解消する最小の縦切りを求めた。対象はカード1枚の `critique` と `critiqueTags` の変更に限定し、島・関係・すべての構造操作を汎用Decision Logへ移行しない。

制約は次のとおりである。

- 現在値を正本とし、履歴と二重の正本を作らない。
- 保存・再読込・exportで意味が変わらない。
- reviewer identityを必須にしない。
- SafeModeと共有範囲を広げない。
- AI提案のrationaleを人の判断へ自動転記しない。
- 履歴の欠落をAI生成文で補完しない。

## Decision

### 1. 現在値は `Card.critique` / `Card.critiqueTags` に残す

履歴は `Card.critiqueHistory?: CritiqueHistoryEntry[]` として追加する。現在値を別の場所へ移さない。したがって、履歴を読まない通常のカード操作・AI入力・共有は従来どおり現在値を使う。

### 2. 変更時だけ、直前の値を履歴へ追加する

人が違和感メモまたは違和感タグを変更したとき、変更前後の値と時刻、変更種別を1件追加する。値が変わらない操作では履歴を追加しない。上限は50件とし、超えた分は古いものから落とす。

履歴の変更種別は `manual` / `import` / `rollback` / `unknown` とする。

- 人がUIから編集した変更は `manual`。
- エージェント応答の採用など、外部から取り込んだ変更は `import`。人が書いた変更と混ぜない。
- 履歴からの復元は `rollback` として新しい履歴を追加する。過去の履歴を書き換えない。

### 3. 復元は現在値を戻し、履歴は消さない

履歴の「この版に戻す」は、その変更直後の `critique` / `critiqueTags` を現在値へ戻し、`rollback` の履歴を追加する。これにより、復元したこと自体も後から辿れる。

### 4. SafeModeの共有境界を広げない

共有・書き出し用の投影では、`critiqueHistory` の本文・タグ・noteを墨消しし、ID・時刻・変更種別だけを残す。履歴は未レビュー本文を含み得るため、現在の `critique` と同じ扱いにする。

### 5. AIで履歴を補完しない

履歴が無い期間や、理由を言語化できなかった時点は、欠落として残す。AIがもっともらしい過去の理由を生成して埋めない。`no_articulable_reason` は現在値としても履歴としても保持できる。

## Consequences

- 判断を変えた後でも、以前の違和感と変更のきっかけを再構築できる。
- 履歴を読まない通常操作の重さは変えない。履歴は折りたたみ表示にし、必要なときだけ開く。
- Documentのoptionalフィールドが1つ増える。既存文書は欠落のまま読める。PydanticモデルとTypeScript型の契約を同期させる。
- 履歴の上限50件は、長期利用で古い判断が落ちることを意味する。全履歴の保持が必要になった場合は、別の保存境界（append-onlyのdecision record等）をADRで決める。
- 島・関係・構造操作の判断履歴は、このADRの対象外として残る。

## Traceability

- Issues: #3175
- Related: `ADR-0026`, `ADR-0041`, `ADR-0051`, `ADR-0089`, `ADR-0090`
- Supersedes: なし
