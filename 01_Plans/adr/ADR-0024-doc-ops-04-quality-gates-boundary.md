# ADR-0024: DOC-OPS-04 Quality Gates Boundary（docs-check / CI 境界）

- Status: Superseded by ADR-0089（2026-10-01。旧: Accepted）
- Date: 2026-03-09
- Deciders: Project Maintainers
- Scope: root documentation, `01_Plans/`, `02_Architecture/`, `04_Documentation/`, docs-check CI

## Plan

### AC/DoD不足の補完提案

- AC補完-1: docs-check必須対象（必須）/ CI拡張対象（警告）/ 例外承認対象外を同時に判定可能な境界を明示する。
- AC補完-2: ADR-0023の可読性基線（RBL-1〜RBL-5）と矛盾しないことをVerifyで明示する。
- AC補完-3: 例外承認の責務境界はADR-0025へ委譲し、本ADRで固定しない。
- DoD補完-1: Context / Decision / Consequences / Traceabilityの4章で境界が一致している。
- DoD補完-2: Self-Correction上限3回と停止条件を明示している。

### 合意ログ

- 合意-1（取得済）: docs-check境界は必須/警告/例外で明示し、必須と警告を混同しない。
- 合意-2（取得済）: ADR-0023のRBL基線に反する品質ゲート定義は採用しない。
- 合意-3（取得済）: 統合ファイル3点は本Phaseでは更新しない。

## Context

DOC-OPS-04のADR候補Cでは、docs-checkは運用されている一方で、どこまでを「必須（merge blocking）」とし、どこからを「CI拡張の審査対象」とするかの境界が統一されていない。

また、Issue側の暫定整理では次の前提が示されている。

- `01_Plans` のDecision文書（ADR / issue meta）および `project-progress-dashboard.md` 更新はdocs-check必須化候補。
- `04_Documentation/` は対外公開するユーザ/開発者向け文書としてGistリリースされる前提が追加され、公開安全性・単体読解性・再現可能性の最低基準が必要になった。
- link/metadata strictなどのCI拡張はADR-Cで境界判断する。
- 境界が曖昧なままでは、軽微修正に過剰な待機コストが発生するか、逆に回帰検知が弱くなる。

加えて、ADR-0022（DOC-OPS-04情報I/F）準拠の観点では、C（本ADR）は「品質ゲート境界のみ」を扱い、readability本体（B）および変更統治責務（D）へ越境しないことが必須である。

## Decision

本ADRは、DOC-OPS-04における品質ゲートを **Boundary-1（docs-check必須）** と **Boundary-2（CI拡張の段階適用）** に分離し、判定責務を明確化する。

### 1) AC/DoD 不足補完（本ADR内合意）

本ADRでは、Issueで抽出された不足を以下で補完し、ここに合意事項として固定する。

- AC補完-1（判定入力の再現性）:
  - docs-check判定に使用したコマンドをVerifyへ明記する。
- AC補完-2（境界の可判定性）:
  - docs-check必須対象とCI拡張審査対象をファイル種別ベースで明記する。
- AC補完-3（非目標の分離）:
  - readability規約の本文定義と、例外承認の責務分離設計は本ADRで確定しない。

DoD（本ADR完了条件）:

- DoD-1: Context / Decision / Consequencesの3章で同一境界が読み取れる。
- DoD-2: VerifyでI/F準拠・境界明確性・非目標明記を検査できる。
- DoD-3: Self-Correction上限3回と停止条件が記載されている。

### 2) 境界定義

#### Boundary-1: docs-check 必須（merge blocking）

次の更新ではdocs-checkを必須とする。

- `01_Plans/adr/*.md`（ADR本文の更新/新規）
- `01_Plans/issues/*.md`（issue metaを含む運用メモ）
- `01_Plans/project-progress-dashboard.md`
- `04_Documentation/*.md` のうち、Gist等で対外公開するユーザ/開発者向け文書

判定規則は次のとおりです。

- docs-checkがfailの場合はmerge不可（blocking）。
- `04_Documentation/*.md` を公開対象として更新する場合は、docs-checkに加えて `01_Plans/documentation_quality.md` のMandatory（QG-1〜QG-6）を満たさない限りrelease不可（blocking）とする。
- ただし例外承認の制度設計・責務分離そのものはADR-Dの対象であり、本ADRでは確定しない。

#### Boundary-2: CI拡張（段階適用の審査対象）

次は「導入可否を審査する対象」とし、本ADR時点で一律mandatoryにはしない。

- link check strict
- metadata strict
- prose lint / style lint / glossary driftのような文体・用語自動検証
- その他docs-check以外の文書品質自動検証

判定規則は次のとおりです。

- CI拡張のpass/failは観測・記録対象に留める。
- mandatoryへの昇格判断は、運用実績を踏まえて後続判断とする。

### 2.1) 2026-07-15 amendment: docs-contract適用matrix

`DX-DOC-02`のclean baseline確立に伴い、機械的に真偽を決められる内部契約検査をBoundary-1へ追加する。従来Boundary-2に置いた`link check strict`のうち、**コード記法と外部URLを除外した相対参照先の存在確認**だけを`DC-LNK-001`として昇格する。外部URL到達性、prose/style lint、用語や意味的重複のヒューリスティック判定はBoundary-2に残す。

| Rule ID | 判定契約 |
| --- | --- |
| `DC-ACT-001` | Active issueをfilesystemから発見し、正規Status、必須meta、参照先、重複Backlog、triageとの集合一致を検査する。 |
| `DC-LNK-001` | コードフェンス/コードスパンと外部URLを除外し、Markdown相対参照先が存在することを検査する。 |
| `DC-CUR-001` | current-only文書へStream/rerun/checkpoint等の実行履歴見出しが再混入していないことを検査する。 |
| `DC-ARC-001` | architecture current 4文書の責務SSOT、Contract ID/型、API/schema key、支援表の固定契約を検査する。 |
| `DC-HIS-001` | `02_Architecture/history/`のInformative metadata、current anchor、currentからの逆リンクを検査し、current契約比較から除外する。 |
| `DC-PUB-001` | 公開対象への内部管理情報再混入、公開境界、provenance必須項目を検査する。 |
| `DC-RTE-001` | README→CONTRIBUTING→triage→memo/template/validatorと、公開入口→利用者手順の導線を検査する。 |
| `DC-SAF-001` | SafeMode、share/export、proposal-only、human review、provider=`none`の正本へ有効な導線があることを検査する。 |
| `DC-FMT-001` | 変更文書に空白エラーや競合markerがないことを検査する。 |

| 対象 | Boundary-1 rule |
| --- | --- |
| root docs (`README.md`, `CONTRIBUTING.md`, `AGENTS.md`) | `DC-RTE-001`, `DC-SAF-001`, `DC-LNK-001`, `DC-FMT-001` |
| `01_Plans/adr/`, `01_Plans/issues/`, current運用入口 | `DC-ACT-001`, `DC-CUR-001`, `DC-LNK-001`, `DC-FMT-001`（非該当ruleは対象外） |
| `02_Architecture/` current (`02_Architecture/architecture.html`, `api.md`, `schemas.md`, `02_Architecture/data_model_operations_overview.html`) | `DC-ARC-001`, `DC-CUR-001`, `DC-LNK-001`, `DC-FMT-001` |
| `02_Architecture/history/` | `DC-HIS-001`, `DC-LNK-001`, `DC-FMT-001` |
| `04_Documentation/` current/public | `DC-PUB-001`, `DC-RTE-001`, `DC-SAF-001`, `DC-LNK-001`, `DC-FMT-001` |

各ruleのmerge blocking有効化条件は、(1) 純関数または同等の決定論的実装、(2) ruleごとの正常/負例fixture、(3) 現行repositoryのclean pass、(4) ローカルとCIが同じ単一entrypointを実行、(5) 失敗時にrule ID・対象ファイル・修正先を表示、の5点とする。条件を満たさないruleはCIを偽陽性で止めず、観測または未実装として明示する。SafeMode等の不変条件を検査対象から外す例外は設けない。

### 3) 非目標（越境禁止）

- Readability基準本文（読者前提・文体・可読性スコア閾値）の規約化。
- 変更統治責務（誰が承認し、誰が例外を発行するか）の確定。
- 統合ファイル3点の更新ポリシー変更。

## Three-Element Verification（ADR-0067 遡及適用）

| 次元 | このADRでの主張 | 他次元への制約 |
|------|----------------|---------------|
| **業務設計** | docs-checkは運用されているが、どこまでを必須（merge blocking）としどこからをCI拡張の審査対象とするかの境界が統一されていない。境界が曖昧だと軽微修正に過剰な待機コストが発生するか回帰検知が弱くなる | 機能: 品質ゲートをBoundary-1（docs-check必須）とBoundary-2（CI拡張の段階適用）に分離。データ: docs-check必須対象とCI拡張審査対象をファイル種別ベースで明記 |
| **データ設計** | `04_Documentation/`は対外公開Gistとしてリリースされる前提で、公開安全性・単体読解性・再現可能性の最低基準が必要。`01_Plans`のDecision文書とdashboard更新はdocs-check必須化候補 | 業務: 公開事故（情報漏えい・単体読解不能・手順不備）を減らす。機能: docs-check判定に使用したコマンドをVerifyへ明記し判定入力の再現性を確保 |
| **機能設計** | readability規約の本文定義と例外承認の責務分離設計は本ADRで確定しない（ADR-0023/0025へ委譲）。AC/DoD不足を補完し合意事項として固定 | 業務: 軽微修正への過剰コストを抑制しつつ最低限の回帰防止を実現。データ: B（readability）/D（governance）との責務衝突を避けADR間の比較可能性を維持 |

## Consequences

### 期待される効果

- docs-checkのmerge blocking境界が先に固定され、最低限の回帰防止が可能になる。
- `04_Documentation/` を公開Gistとして扱う場合の最低品質基準が固定され、公開事故（情報漏えい・単体読解不能・手順不備）を減らせる。
- CI拡張を段階適用とすることで、軽微修正への過剰コストを抑制できる。
- B（readability）/D（governance）との責務衝突を避け、ADR間の比較可能性を維持できる。

### 想定される制約

- CI拡張がmandatoryでない期間は、一部の品質論点がレビュー依存で残る。
- 境界妥当性の再評価を定期的に行わないと、暫定運用が長期化する。

## Execute

- 必須（Mandatory）/警告（Warning）/例外（Exception Boundary）をBoundary-1/2/3として分離した。
- ADR-0023のRBL基線を前提に、`04_Documentation/` 向け公開品質基準は別紙 `01_Plans/documentation_quality.md` のMandatory（QG-1〜QG-6）へ切り出した。
- 統合ファイル3点を更新せず、ADR-0024単体で境界を確定した。

## Verify

I/F準拠・境界明確性・非目標明記を確認するため、以下を検査する。

1. I/F準拠:
   - Context / Decision / Consequencesの3章が存在し、境界記述が整合していること。
2. 境界明確性は次のとおりです。
   - Boundary-1（docs-check mandatory）とBoundary-2（CI拡張審査対象）が分離されていること。
3. 非目標明記は次のとおりです。
   - readability本体 / 変更統治責務が本ADRの非目標に記載されていること。
4. 公開文書境界は次のとおりです。
   - `04_Documentation/*.md` を公開対象にした場合、`01_Plans/documentation_quality.md` のMandatory参照が存在すること。
5. docs-contract amendment:
   - root/01/02-current/02-history/04-publicの適用matrix、`DC-*` rule ID、blocking有効化条件が存在すること。
   - `DC-LNK-001`は内部相対参照先の存在確認に限定され、外部URL到達性と文体lintがBoundary-2に残ること。

Self-Correction（最大3回）:

- 1回目: 見出し・用語整合の修正
- 2回目: 境界定義（Boundary-1/2）の曖昧語修正
- 3回目: 非目標の越境表現除去

停止条件（Fail-safe）:

- Self-Correctionが3回を超過。
- ADR-0022のI/F語彙変更兆候を検知。
- 範囲外干渉（統合ファイル3点や他ADR編集）が必要と判明。

判定: **Self-Correction 0回で充足**（停止条件非該当）。

## Proceed

- 状態: **完了（ADR-0024 Accepted）**
- 未解決点（ADR-0025へ委譲）:
  1. 例外承認の責務分離と承認フロー。
- 次Phase開始条件（ADR-0025）:
  1. 本ADRのBoundary-1/2/3定義を変更しない。
  2. 変更統治ADRで品質ゲート境界へ越境しない。
- 変更影響は次のとおりです。
  - 以後のDOC-OPS-04文書変更は「必須/警告/例外」の3分類で説明責務を持つ。

## Traceability

- Related: `01_Plans/adr/ADR-0022-doc-ops-04-documentation-information-interface.md`
- Related: `01_Plans/issues/done/issue-DOC-OPS-04-documentation-visibility-readability-governance.md`（ADR候補C節）
- Derived-from: DOC-OPS-04 ADR候補C（Documentation Quality Gates）
- Amended-by: `DX-DOC-02` T1（2026-07-15 docs-contract適用matrix / rule ID / 段階有効化条件）
