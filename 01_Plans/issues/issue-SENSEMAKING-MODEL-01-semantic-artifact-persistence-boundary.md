# Issue: SENSEMAKING-MODEL-01 sensemaking意味成果物の永続境界を設計する

- Type: Feature
- Status: In Progress
- Source Issue: N/A
- Priority: P1
- Owner: Maintainer
- Scope: `00_Prompt/domain.md`, `01_Plans/adr/`, `02_Architecture/`
- Related ADR/Spec: `ADR-0084`, `ADR-0085`, `ADR-0086`, `02_Architecture/sensemaking_semantic_model.md`, `02_Architecture/sensemaking_artifact_contract_v1alpha1.md`
- Norms: `DOM-CORE-01`, `DOM-CORE-03`, `DOM-CORE-04`, `DOM-SM-01..09`, `DOM-AI-04..11`
- Expected verification level: docs-check / contract review

## 三要素整合（ADR-0067）

- **業務設計（Business）**: AIが大きなsensemaking区間を担っても、人間が元Evidence、主要反証、代替案、未解決点へ戻り、理解・異議・承認できる状態を成立させる。
- **データ設計（Data）**: semantic kind、provenance、review、authority、lifecycle、visibilityを直交軸として扱い、現行`DocumentV1`の意味を暗黙変更しない。
- **機能設計（Function）**: 本Issueではruntime機能を実装せず、将来schema / API / Review Surfaceへ降ろせる最小契約と停止線を定義する。

## 課題

- 現在の問題:
  - ADR-0085で意味成果物の概念境界は定まったが、logical artifact identityとexact revision identityの表現が未決。
  - Review、Authority transition、Decisionがどのrevisionを対象とするかを永続化する最小契約が未決。
  - AI Workspaceから人間Review Surfaceへ渡すReview Capsuleの再構築規則が未決。
  - rejected / supersededな主要代替案をどの範囲まで保持するかが未決。
  - 現行`DocumentV1` / `InquiryJourneyV1`との接続方法が未決。
- 利用者または開発への影響:
  - この境界を決めずに型を追加すると、ObservationをHypothesisへ上書きする、AI Reviewを人間承認と混同する、既存Document契約を後付け変更する、といった不可逆なdriftが起こり得る。

## 対応方針

### 実施すること

一つのIssue内で、次の順に設計する。途中成果ごとに派生branchを作らない。

1. **Artifact identity**
   - logical artifact ID
   - exact revision identity
   - semantic kind固定
   - supersedes / derivedFromの関係

2. **Minimal provenance envelope**
   - actor ref
   - Provider / Method ref
   - source / Evidence refs
   - input scope
   - created time
   - redaction / transformation lineage

3. **Review record**
   - reviewer種別
   - exact target revision
   - objections / holds
   - review purpose / result
   - human reviewとAI reviewの非同一性

4. **Authority transition**
   - Working / Candidate / Accepted / Consensusの境界
   - scope / actor-or-policy / time
   - Reviewとpromotionを別eventにする
   - visibility / ACLとの分離

5. **Review Capsule projection**
   - 主要Evidence
   - 主要反証
   - 主要代替案
   - unresolved / held
   - provenance
   - requested authority action
   - canonical sourceへ戻るref

6. **Retention / alternative selection**
   - private chain-of-thoughtを保存対象にしない
   - 微細な全探索trialも保存必須にしない
   - 後続理解へ影響した主要代替案・反証を保持する選定規則

7. **Current model integration**
   - `DocumentV1`
   - `InquiryJourneyV1`
   - WorkingGraph / ConsensusGraph
   - import / export
   - SafeMode
   - retention / GC

### 実施しないこと

- 本Issueだけで`DocumentV1`へfieldを追加しない。
- `version: 2`を先に作らない。
- Card / Edge / Islandを一括migrationしない。
- 全AI内部推論やprivate chain-of-thoughtを保存しない。
- 認知Provider内部scoreをSUIのTruth / Importance / Authorityへ変換しない。
- Review Capsuleを新しいcanonical sourceにしない。

## 進捗（2026-09-18）

同一workstream branch上で、対応方針1〜7の設計基線を一巡した。

- Artifact identity:
  - opaque `artifactId`（logical identity）
  - opaque `revisionId`（exact immutable revision）
  - `contentDigest`（integrity cross-check）
  を分離した。
- Provenance:
  - actor / method / runRef / input artifact refs / source refs / scope / transformation refsを最小envelopeとして定義した。
  - AI provider / model / promptはartifactへ複製せず、runRefから既存run recordへ辿る。
- Review:
  - exact revisionを対象とするappend-only `ReviewRecordV1Alpha1`を定義した。
  - dispositionからAccepted / Consensusを除外した。
- Authority:
  - Working / Candidate / Accepted / Consensusをappend-only transition eventで表現する。
  - `expectedFrom` / `scopeRef`を必須とし、review件数からConsensusを自動導出しない。
- Review Capsule:
  - Structural CapsuleとNarrative Explanationを分離し、Narrativeを正本にしない。
- Retention:
  - Candidate化、Review対象、Decision basis、主要alternative、contradiction、pin等を保護入力とし、到達不能なWorking-only microtrialはGC可能とした。
- Current model integration:
  - `DocumentV1`、canvas revision DAG、`RoundSnapshotV1`、`ReviewAttribution`、AI generation run、WorkingGraph / ConsensusGraphとのreference bridgeを定義した。
  - `DocumentV1`は変更しない。

残る主な未決事項は、kind-specific payload schema、Relation vocabulary最終境界、Authority Scope / Consensus participant schema、physical persistence、artifact import/export、Review Capsule UI、promotion gate実測である。

## 受入条件

- [x] semantic kindとreview / authority / lifecycle / visibilityの直交関係を、実装者が一意に読める。
- [x] logical identityとexact revision identityの最小契約案がある。
- [x] provenance envelopeの必須／任意境界が定義される。
- [x] ReviewとAuthority transitionが別契約として定義される。
- [x] Human ReviewとAI Reviewを同一状態へ畳み込めない。
- [x] Review Capsuleから主要Evidence・反証・代替案・未解決点へ戻れる。
- [x] private chain-of-thought非保存と主要代替案保持を両立する規則がある。
- [x] `DocumentV1`は本Issueでは変更しないと明示した。変更が必要になった場合は別schema ADRへ分岐する。
- [x] `InquiryJourneyV1` / `RoundSnapshotV1`は探究ラウンド・不変Document成果、semantic artifactは意味成果物revisionとしてreference bridgeで接続すると整理した。
- [x] 現行SafeMode / proposal-only / `human_reviewed`境界を弱めない。
- [x] 関連文書の検証結果を記録した。GitHub connector上ではPR headに紐づくworkflow run / commit statusが存在せず、repository-local `01_Plans/docs_check.py` はローカルcheckoutを必要とするため未実行。代わりにmainとの差分が文書8ファイルのみであること、`DocumentV1` / runtime / API変更がないこと、ADR-0070 / ReviewAttribution / InquiryJourney / associative cognition provider contractとの意味衝突がないことをGitHub上で照合した。

## 責任分界（REQ-DEF-02）

- 実行責任（R）: Maintainer / development AI
- 受入判定（A）: Maintainer
- 契約チェックポイント: `DocumentV1`, `InquiryJourneyV1`, `ReviewAttribution`, WorkingGraph / ConsensusGraph, SafeMode, import / export
- 停止基準: 既存`DocumentV1`の意味変更、human review自動昇格、Consensus direct writeが必要になった時点で本Issue内の実装へ進まず、別ADRを起票する。

## AIレーン宣言（GENAI-GOV-01）

- Lane: C（提案型生成）を中心とする。将来D相当の直接Agent連携へ進む場合は別ADR。
- データ境界: 本Issueでは契約設計のみ。外部Provider送信や新規永続化は行わない。
- SafeMode/監査/人間レビュー境界: 既定ON / proposal-only / `human_reviewed`人手昇格を維持する。

## 検証計画

- 実行する確認:
  - ADR-0084 / ADR-0085 / domain / schemas / InquiryJourneyとの用語衝突監査
  - 現行`DocumentV1`に暗黙field追加がないことの差分確認
  - Working / Candidate / Accepted / ConsensusとReviewの非同一性レビュー
  - provider contractのcandidate / provenance境界との整合確認
- 期待結果:
  - 実装へ進む前に、意味境界・authority・revision・provenanceを一つの設計線で説明できる。
  - schema変更の必要性がEvidenceなしに既成事実化されない。

## 検証結果（2026-09-18）

- PR headに関連するGitHub Actions workflow run: なし
- commit status: なし
- repository-local `01_Plans/docs_check.py`: GitHub connector環境にはローカルcheckout / shell実行経路がないため未実行
- GitHub差分確認:
  - 変更は文書8ファイルのみ
  - `DocumentV1` field / version変更なし
  - API / DB / runtime変更なし
  - current SafeMode / proposal-only / `human_reviewed`変更なし
- 契約照合:
  - ADR-0070のcanvas revision identity / digest分離と整合
  - `schemas_review_attribution.md`の現行document review契約を上書きしない
  - `InquiryJourneyV1` / `RoundSnapshotV1`をsemantic artifactへ暗黙変換しない
  - `associative_cognition_provider_contract.md`のProvider内部値をTruth / confidenceへ昇格しない原則と整合

## 補足

このIssueは、細かなschema案ごとにbranchやIssueを分けるためのものではない。意味境界が一つのレビュー可能な単位になるまで同じworkstreamで進め、schema変更が必要と確定した時点だけ別ADR / implementation Issueへ分岐する。
