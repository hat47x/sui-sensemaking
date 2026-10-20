# Changelog

このファイルは sui-sensemaking の変更履歴を記録します。

フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) を参考にし、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/)（SemVer）に従います。

`[Unreleased]` から版を切る手順（タグ・日付との対応）は [`04_Documentation/release.md`](04_Documentation/release.md#changelog-との対応) を参照してください。

## [Unreleased]

### Added
- 判断理由の履歴: カードと島の違和感メモに、現在値と分離した改訂履歴と復元を追加（ADR-0099）。
- 構造の判断履歴: 島の作成・カードの追加/除外・保留状態の変更を記録し、後から任意の理由を追記できる。保留状態の変更履歴からは、その状態へ手動で戻せる（ADR-0100）。
- フロントエンドとバックエンドの単体・契約・代表e2eをPRで実行するCIを追加。
- 手動オーサリング: 新規カード追加・本文のインライン編集（ダブルクリック）・削除ボタン。LLM を使わずに「書く・並べる・束ねる・つなぐ」が完結。
- キャンバスの右クリック・コンテキストメニュー（背景／カード／島）と、ヘッダーの「ファイル」「編集」ドロップダウンメニュー。
- 「詳細（Advanced）」トグル: AI・高度機能を既定で非表示にし、初回MVPの画面を簡素化。
- 島UX: カードを島の領域へドラッグして追加、島の右クリックから「サイズ変更／形状編集」（ポリゴン頂点編集）。
- GPU 非搭載でも AI 連携の動作イメージを確認できるモック `/generate` アダプタ（`03_Implement/deploy/tools/mock_local_llm.py`）。

### Changed
- 環境変数契約を `SUI_*` 専用へ統一し、旧キー（`DATABASE_URL` 等）の受理を停止。
- 初回MVP向けに AI 系UI（レイアウト提案・統合候補・ナラティブ・島/関係サマリ）を「詳細」トグル配下へ集約。
- Docker スタックの初回起動を堅牢化（fastapi のバージョン上限を image でも固定、`SUI_DATABASE_URL` 既定を `POSTGRES_*` から導出、api ヘルスチェック追加、dev プロキシを IPv4 へ）。

### Fixed
- strict mode例外Runbook（AUTH-OPS-03）のQ1〜Q10を確定し、停止条件/復旧条件の文書整合を修正。
- DB URL の async→sync 正規化でパスワードが `***` にマスクされ、Docker 起動時に Postgres 認証失敗する不具合を修正（`render_as_string(hide_password=False)`）。
- 受け入れ確認・導入手順の整合を修正し、Postgres 認証失敗・`docker.sock` 権限・API キーと同梱SPA の関係などのトラブルシュートを追記。

## [0.1.0] - 2026-02-12

### Added
- リリース運用の最小ドキュメントを追加（`CHANGELOG.md`, `04_Documentation/release.md`）。
