# Release

対象読者: sui-sensemakingのリリース、検証版の共有、公開前確認を担当する人。

目的: 利用者が触れる状態へ変更を出す前に、品質、安全性、文書、受け入れ確認を人間が確かめ、タグと検証記録を対応付けるための最小手順をまとめます。

範囲外: 組織固有の承認システム、配布先ごとの秘密設定、マーケティング告知、container/package registry、自動deploy、署名基盤の新設。

公開区分: リリース/04文書保守者向け管理文書。一般利用者向けGistの本文には原則含めず、公開前確認と安全境界レビューのチェックリストとして使います。

## 現在の前提: GitHub Actionsによる自動リリースは無効

現在、このリポジトリには常設のGitHub Actions release workflowを置いていません。タグをpushしても自動build、GitHub Actions artifact、GitHub Release、container/package registryへの公開は行われず、**自動生成される成果物はありません**。

したがって、この文書の現行手順は「対象commitを手動で検証する」「必要ならローカルでbuildする」「確認済みcommitにタグを付ける」「結果を記録する」までを扱います。継続的な公開配布を始める場合は、公開channel、artifact構成、保持期間、checksum/provenance/SBOM/署名、backend imageのregistry、撤回方法を別IssueまたはADRで決め、automationとこの文書を同じ変更で更新します。

## リリース前チェック

```bash
git status -sb
git diff --check
```

この文書でいうリリースは、正式版だけでなく、検証版や限定共有を含め、利用者が触れる状態へ変更を出すことです。

## 前提知識

リリース担当者は、すべての実装詳細を理解している必要はありません。ただし、次の違いは確認できるようにしておきます。

| 用語 | 意味 |
| --- | --- |
| build | 利用者が実行できる形にfrontendなどを組み立てること |
| test | 期待した動作を機械的に確認すること |
| smoke test | 主要操作だけを短時間で手動確認すること |
| rollback | 問題が出たときに前の状態へ戻すこと |

## リリース判断の流れ

常設CIは現在無効なので、次の確認はタグを打つ**前**に、タグ対象にする予定のcommit SHAへ自分で実行し、結果をリリース記録に残します。

1. 差分の範囲を確認する。
2. 影響するテストを実行する。
3. 手動smoke testで利用者の主要操作を確認する。
4. security、SafeMode、外部サービスとの共有の安全境界が後退していないことを確認する。
5. data handlingの観点でexport、share、ログ、外部サービスとの共有の扱いを確認する。
6. rollback方針を確認する。

frontend:

```bash
cd 03_Implement/frontend
npm ci
npm run typecheck
npm run test
npm run build
```

backend:

```bash
cd 03_Implement/backend
python -m pytest
```

Docker Compose:

```bash
cd 03_Implement/deploy
docker compose up --build -d
curl -fsS http://localhost:8080/api/healthz
```


## タグ作成手順

1. 上記「リリース判断の流れ」を対象commit SHAに対して実行し、必要な確認が成功することを確かめる。説明できない失敗がある場合はタグを作らない。
2. `CHANGELOG.md` の `[Unreleased]` を、タグと同じバージョン番号・当日日付の見出しへ切り出す。
3. タグ名はSemVer形式 `vX.Y.Z` とし、対象は手順1で確認済みのcommit SHAに限る。
4. 一度作成したタグは強制更新（force push / re-tag）しない。誤りがあった場合は新しいバージョン番号で再実行し、誤ったタグはwithdrawnとして記録する。
5. タグをpushする。現在はGitHub Actionsによる後続処理がないため、push成功だけでbuildや配布が完了したとは扱わない。
6. 下記「リリース記録に残す項目」を記録する。

## 成果物の扱い

現在は、タグpushを起点に自動生成・自動保存される成果物はありません。frontendのbuild結果やDocker imageを検証に使う場合も、その実行結果は検証を行った環境にだけ存在します。

第三者へ継続配布するartifactを定義するときは、少なくとも次を決めてから自動化します。

- 何を正式な配布物とするか。
- どこから取得できるか。
- 対象tagとcommit SHAをどう対応付けるか。
- 保持期間と撤回方法。
- checksum、provenance、SBOM、署名をどう扱うか。
- backend imageをregistryへ送るか。

## CHANGELOGとの対応

`CHANGELOG.md` は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) 形式・SemVer準拠です。`[Unreleased]` から版を切る条件は次のとおりです。

- タグを作成する直前に、`[Unreleased]` の内容を `## [X.Y.Z] - YYYY-MM-DD`（タグと同じバージョン番号、当日日付）へ書き換える。
- 新しい空の `[Unreleased]` セクションを見出しだけ残す。
- `[Unreleased]` のままtagをpushしない。版とタグは1:1で対応させる。

## リリース記録に残す項目

- tag（`vX.Y.Z`）
- 対象commit SHA
- 実行したtest / docs check / buildとその結果
- gate decision（`PRODUCT-QA-01` のGo/No-Go判断）
- 手動smoke testの結果
- 共有した成果物がある場合は、その生成方法と取得場所
- 既知の制限
- rollback / withdrawal方針

GitHub Actions workflowを将来再導入した場合は、workflow run、artifact名、取得場所、保持境界も記録対象へ戻します。

## 手動確認

- [ ] アプリが開く。
- [ ] 新規ドキュメントを作成できる。
- [ ] カードを追加・移動できる。
- [ ] 保存して再読み込みしても内容が残る。
- [ ] share/exportに秘密情報や内部作業ログが含まれない。
- [ ] SafeModeの既定動作が緩んでいない。
- [ ] LLM providerが意図した値になっている。
- [ ] 監査ログのHTTP連携や外部アクセス制御を有効にした場合、連携先と失敗時の動作が説明できる。

## 文書確認

- [ ] [installation.md](installation.md) の起動手順が現行実装と合っている。
- [ ] [configuration.md](configuration.md) の環境変数がsettings.pyと矛盾していない。
- [ ] [data_handling.md](data_handling.md) の保存・外部サービスとの共有・共有前確認が現行実装と矛盾していない。
- [ ] [security.md](security.md) の外部サービスとの共有の境界が維持されている。
- [ ] [acceptance_check.md](acceptance_check.md) の確認手順が再現できる。
- [ ] READMEや04文書に内部issue記録や秘密情報が混ざっていない。

## 失敗時の扱い

次のいずれかに当てはまる場合、リリースを止めます。

- build、test、typecheck、docs checkの失敗理由が説明できない。
- SafeMode、share/export、LLM providerの安全境界が後退している。
- 秘密情報、内部URL、生の顧客情報が文書やexportに混ざっている。
- 受け入れ確認の主要操作が再現できない。

止めること自体を異常扱いしません。利用者に影響する不確実性を見つけた状態なので、原因、回避策、再開条件を記録してから次の確認に進みます。誤って作成したタグは強制更新せず、withdrawnとして記録し、新しいバージョン番号で再実行します。

## 関連文書

- [acceptance_check.md](acceptance_check.md)
- [data_handling.md](data_handling.md)
- [operations.md](operations.md)
- [security.md](security.md)
- [installation.md](installation.md)

2026-03-03時点のE2E検証ログは形成履歴としてGit履歴から参照します。現在のリリース判断には、対象commit SHAに対して都度実行した確認結果を使います。
