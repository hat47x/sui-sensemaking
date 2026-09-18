# SUI Sensemaking

> **重要: 本プロジェクトは、現在も生成AIを用いた開発中であり、人的レビューは不完全です。**
>
> 実装・文書・安全性・利用手順の検証は完了していません。生成物をそのまま信頼したり、重要な判断に使用したりせず、利用前に人が内容と安全性を確認してください。外部利用者による検証も未実施です（ADR-0042 段階A）。

A sensemaking environment where humans and artificial cognition can develop meaning without forcing premature closure.

**SUI Sensemaking** は、人間とAIが未整理な情報から関係・仮説・構造・統合を形成し、
その意味形成の過程を保持しながら理解を成熟させていくための
**sensemaking（意味探索・意味形成）基盤**です。

現在の中核インターフェースは、親和図法／KJ法に着想を得たキャンバスです。
人間の「違和感」「保留」「未分化な意味」を空間上に置き、
AIの観測・候補・別解と行き来しながら考えを深めます。
一方、SUIの内部表現と将来のAI認知は特定の手法だけに限定せず、
人間主導、協働、委任、監督付き自律まで同じ情報資産上で扱えることを長期的な射程とします。

設計思想は、川喜田二郎の著作（『発想法』1967 ほか）が示した
「断片をボトムアップに統合し、早すぎる収束を避ける」という方法論から
直接の影響を受けています。ただし本プロジェクトは、
川喜田二郎氏および株式会社川喜田研究所から**公認・後援を受けたものではなく**、
登録商標「KJ法」の実装・公式版でもありません。
商標と出典の扱いは [`NOTICE`](NOTICE) を参照してください。

本プロジェクトは、以下のような多目的な探索・思考・整理を想定しています。

- 複雑な問題の初期探索（まだ論点が固まっていない段階）
- 定性情報・主観的記録（体験・違和感・観察）の整理
- チームや個人による思考の可視化・共有
- 研究・企画・設計・政策・プロダクト検討などの前段整理

SUI Sensemaking は、**一つの正解へ早く収束すること自体を目的にはしません。**

> 分からないことを、分からないまま扱い、
> 違和感や反証を失わず、
> 形成された意味を後から辿り、組み替え、再評価できること

を重視します。

現在は、人間がAIの提案を確認して採否を決める運用を基本とします。
ただし長期的には、AIが探索・仮説形成・構造化・統合のより大きな区間を担い、
人間が方向づけ、理解、異議、承認へ比重を移しても、
同じ来歴と情報資産を引き継げるプロダクトを目指します。

---

## ドキュメント導線（人間向け / AI向け）

この README は **人間向けの入口**です。詳細な運用規約やAI向けの読み順は、役割に応じて次を参照してください。

- **AIエージェント向けの入口**: [`AGENTS.md`](AGENTS.md)
- **利用者向け公開入口**: [`04_Documentation/public_index.md`](04_Documentation/public_index.md)（一般利用者に最初に案内する入口）
- **04文書の保守者入口**: [`04_Documentation/README.md`](04_Documentation/README.md)（公開入口ではなく、公開対象/除外対象の管理用）
- **コントリビューション手順**: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **実装ガイド（開発者向け実行方法）**: [`03_Implement/README.md`](03_Implement/README.md)

> 開発レイヤ（`00_Prompt`〜`04_Documentation`）の詳細な説明・Read Order・Project Map は `AGENTS.md` に集約しています。


### 文書公開境界（迷ったとき）

| 区分 | 入口 | 公開配布での扱い |
| --- | --- | --- |
| 一般利用者向け | [`04_Documentation/public_index.md`](04_Documentation/public_index.md) | Gist など外部共有時の先頭に使う |
| 04文書保守者向け | [`04_Documentation/README.md`](04_Documentation/README.md) | 公開対象一覧・除外対象の管理用。Gist本文には含めない |
| 開発者向け | [`CONTRIBUTING.md`](CONTRIBUTING.md), [`03_Implement/README.md`](03_Implement/README.md) | 開発・テスト・実装手順として案内する |
| 内部計画/AI運用向け | `00_Prompt/`, `01_Plans/`, `AGENTS.md` | 公開利用ガイドには混ぜず、必要な根拠として参照する |

公開利用ガイドには、内部 issue、ADR の詳細、AIエージェント作業ログ、未承認仕様、組織固有の秘密設定を混ぜません。

---


## はじめに（人間向けクイックスタート）

### 1) まず把握すること

- このプロジェクトは **探索・意味形成・理解の継続を支えるsensemaking基盤** です。
- 現在の公開機能は **人間のレビューと検証** を前提とし、AI生成物を自動で承認済み状態へ昇格させません。
- 長期的なAI自律性の拡大と、現在のSafeMode・承認境界は分けて扱います。
- セキュリティ・安全設計（safeMode 含む）は機能追加より優先されます。

### 2) 利用者として最初に読む文書

- 導入・セットアップ: [`04_Documentation/installation.md`](04_Documentation/installation.md)
- 最初の価値体験: [`04_Documentation/getting_started.md`](04_Documentation/getting_started.md)
- 設定値と環境変数: [`04_Documentation/configuration.md`](04_Documentation/configuration.md)
- 日常運用: [`04_Documentation/operations.md`](04_Documentation/operations.md)
- セキュリティ運用: [`04_Documentation/security.md`](04_Documentation/security.md)
- 開発コーディング規約: [`02_Architecture/coding_standards.md`](02_Architecture/coding_standards.md)

### 3) 開発者として最初に実行すること

```bash
cd 03_Implement/deploy
docker compose up --build
```

標準構成は loopback（`127.0.0.1`）限定の同一ホスト評価用です。別端末や LAN からの利用は既定で届きません（詳細は [`04_Documentation/installation.md`](04_Documentation/installation.md)）。

- 詳細な実行方法（Frontend / Backend 個別起動、環境変数）は [`03_Implement/README.md`](03_Implement/README.md) を参照してください。

### 4) このリポジトリでの相談・報告窓口

- バグ候補・機能案: [`CONTRIBUTING.md`](CONTRIBUTING.md) の現行手順に沿ってDiscussionsで共有し、実行可能な作業は内部issue memoへ整理
- 相談・運用知見の共有: [`DISCUSSIONS.md`](DISCUSSIONS.md)
- 脆弱性報告: [`SECURITY.md`](SECURITY.md)
- 一般的なサポート導線: [`SUPPORT.md`](SUPPORT.md)

---

## 現在の文書体系（人間向け要約）

- **公開向け文書（ルート直下）**: プロジェクト方針・参加方法・公開ルール
- **`01_Plans/`**: 開発計画とフェーズ
- **`02_Architecture/`**: API・スキーマ・構成設計の正本
- **`03_Implement/`**: 実装本体（frontend / backend / deploy）
- **`04_Documentation/`**: 導入・設定・運用ガイド

> AIエージェント向けの詳細な Read Order / Project Map は `AGENTS.md` に集約しています。

---

## SUI Sensemaking が目指さないこと

誤解を避けるため、以下を明示します。

- 単一の正解や合意へ早く収束することを成功条件にしません
- AIの生成物を、来歴や権限境界を飛び越えて人間承認済みの意味として扱いません
- きれいな最終図や生成量そのものをゴールにしません
- 未測定・不確実性・対立・少数意見を都合よく消し去りません
- KJ法キャンバスだけを、将来にわたる唯一のsensemaking手段として固定しません

SUI Sensemaking は、
**人間とAIの役割分担が変化しても、意味が形成された過程と未解決なものを失わずに扱えること**
を目指します。

---

## 言語運用方針（開発者向け）

- **コード（変数名・関数名・ファイル名）**：英語
- **コミットメッセージ・Issue・思考整理**：日本語可
- **README**：日本語（将来、英語版を追加予定）

思考速度とニュアンス保持を最優先します。

---

## Project communication / 公開コミュニケーション

ルートディレクトリ直下の文書は、**開発コミュニティ（利用者・コントリビュータ・運用担当）との対外コミュニケーション**を目的とした公開ドキュメントです。  
生成AIが更新時機を判断できるよう、以下を運用ルールとします。

| 文書 | 位置づけ | 主な更新タイミング |
|---|---|---|
| [README.md](README.md) | プロジェクト概要・開発原則・文書案内の入口 | 方針変更、文書構成変更、初見利用者向け導線変更時 |
| [ROADMAP.md](ROADMAP.md) | 今後の開発方針（短期・中期・長期）を示す公開計画 | リリース計画変更、優先度見直し、非目標更新時 |
| [DISCUSSIONS.md](DISCUSSIONS.md) | GitHub Discussions の運用窓口 | 議論カテゴリや運用ルール変更時 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 貢献フロー・レビュー基準 | 開発フロー・レビュー要件更新時 |
| [SECURITY.md](SECURITY.md) | 脆弱性報告と対応ポリシー | 報告窓口やSLA変更時 |
| [SUPPORT.md](SUPPORT.md) | 問い合わせ・サポート窓口 | 連絡経路や対応範囲変更時 |
| [CHANGELOG.md](CHANGELOG.md) | リリース差分の履歴 | リリース確定時（毎リリース更新） |
| [NOTICE](NOTICE) | 商標・出典・帰属の明示（`LICENSE` が扱わない範囲） | 商標状況の変更時、依拠する出典の追加・変更時、プロダクト名称の決定時 |

### 更新運用（AI/人間共通）

- 実装仕様の詳細は `01_Plans/` `02_Architecture/` `03_Implement/` を優先し、ルート文書はその要約・公開説明として更新する。  
- ルート文書同士で矛盾が出る場合は、同一PR/同一コミットで同時修正する。  
- リリース前には最低限 `README.md` `ROADMAP.md` `CHANGELOG.md` の整合を確認する。

---

## ライセンスと商標

本プロジェクトのソースコードと文書は [MIT License](LICENSE) で提供されます。

**MIT License が許諾するのは著作権であり、商標権は許諾しません。**
「KJ法」は株式会社川喜田研究所の登録商標（登録第4867036号）であり、
本プロジェクトは同社および川喜田二郎氏の関係者から公認・後援を受けていません。

fork・再配布・商用利用を検討する場合は、[`NOTICE`](NOTICE) に記載した
商標・出典・帰属の条件を必ず確認してください。
