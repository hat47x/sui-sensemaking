# AGENTS.md

sui-sensemaking の生成AI向け入口。体制は **1人の開発者＋生成AI** で、管理文書は最小限にする。進捗の正本はGit履歴。

## ルール

1. 変更は最小差分。既存の利用者変更を取り消さない。
2. 仕様と実装が矛盾したら、下表の正本を確認して直す。
3. リスクに応じたテストを実行し、未実施は明記する。
4. 外部協力者・複数人レビュー・承認フローを完了条件にしない。管理文書（issue台帳、ダッシュボード、ログ）は作らない。TODOは `ROADMAP.md`、判断理由はPR/コミット、長期的な設計判断だけ `01_Plans/adr/` に書く。

## 安全不変条件（緩和しない）

- SafeModeは既定ON。
- AI出力はproposal-onlyで自動適用しない。
- `human_reviewed` は人間だけが設定する。
- `SUI_LLM_PROVIDER=none` でも主要価値が成立する。
- share/exportで未レビュー情報・秘密情報を意図せず共有しない。
- import/zip/markdownは不正入力を安全側で拒否または無害化する。
- 実在の機微資料を外部providerへ送らない。

## 正本

| タスク | 読む文書 |
|---|---|
| 用語・KJ法の概念 | `00_Prompt/domain.md`, `00_Prompt/sensemaking_technique.md` |
| カード品質・AI実行手順 | `00_Prompt/qualitative_card_quality_requirements.md`, `00_Prompt/ai_sensemaking_execution_procedures.md` |
| W型反復・視覚手掛かり | `00_Prompt/w_type_iterative_inquiry_requirements.md`, `00_Prompt/representative_visual_cue_requirements.md` |
| API・スキーマ | `02_Architecture/api.md`, `schemas.md` |
| 環境変数（`SUI_*`） | `02_Architecture/runtime_parameter_registry.md`（設定例と同期） |
| LLM | `02_Architecture/llm_*.md` |
| 全体構成 | `02_Architecture/architecture.html` |
| 脅威・SafeMode | `THREAT_MODEL.md` と対象ポリシー実装 |
| 価値の定義・価値とADRの対応 | `01_Plans/adr/ADR-0089-product-value-canon.md` |
| 長期的な設計判断 | `01_Plans/adr/`（新規ADRは「価値への寄与」を書く） |
| 利用者向け手順 | `04_Documentation/public_index.md` |

## 変更時の追随

- Document契約: `ADR-0058`、`schemas.md`、`api.md`、frontend/backend/MCPの契約と関連テスト。
- `DocumentV1` へoptionalフィールドを足す前に、既存フィールドで表せないか確認し、対応するPydanticモデルと `test_ts_python_contract_drift.py` の対象型へ追加し、SafeMode向けredact/preserve/omitポリシーを判断する。
- UI視覚変更は実ブラウザで確認する。

## 文書形式

- 新規の `02_Architecture/` 設計文書は、必要な場合のみHTML + Mermaid（`file://` 直開き前提のため classic `<script>` のUMD版を使う）。Markdownと二重管理しない。
- `02_Architecture/design/` は Claude Design の出力専用。
