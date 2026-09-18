# Issue: ARCH-TEI-MIGRATION-01 TEI Reference Adoptionと開発負荷低減の検証

- Type: Process / Architecture / Migration
- Status: Planned — TEI側Reference Adoption準備と同期
- Source Issue: N/A
- Priority: P0（大規模な機能高度化へ進む前の移管ゲート）
- Owner: Maintainer
- Scope: `ROADMAP.md`, `01_Plans/cross-repo/`, 将来のTEI migration reference、代表的なSUI vertical slice
- Related ADR/Spec: `ADR-0084`, `2026-09-18-product-family-positioning.md`
- Norms: Evidence保全 / provenance / SafeMode / proposal-only current boundary / Product ValueとImplementationの分離
- Expected verification level: docs-check + reference comparison + integration/e2e（移管slice着手後）

## 三要素整合

- **業務設計（Business）**: SUIの機能高度化を現行個別実装へ積み上げ続ける前に、TEIをApplication Implementation Layerとして利用することで、同じProduct Valueをより少ない保守負担で継続できるかを確認する。
- **データ設計（Data）**: SUIのEvidence / Observation / Relation / Hypothesis / Structure / Synthesis / Review等の意味正本を、TEIの実装方式へ移管することと混同しない。移管後もSUIのDomain / Product Valueが正本であり、生成物・Projection・Plugin内部状態を第二正本にしない。
- **機能設計（Function）**: SUI固有のUI・Interaction・業務規則を、TEI標準機能、Plugin / Adapter / Capability、native asset / custom implementationのどこへ置くかをReferenceで分類する。

## 課題

- 現在のSUIは、長期間の機能追加により独自frontend、document schema、import/export、worker、AI adapter、安全境界、各種Projectionを個別に維持している。
- 今後、AI Workspace、Review View / Review Capsule、複数認知器、より高度なcollaboration等を現行実装へ直接積み上げると、SUI固有の実装・テスト・文書同期負担がさらに増える可能性がある。
- TEIは、Canonical meaning、Projection、Target、Capability、Plugin、Acceptance Boundary等を共通化することをProduct Valueとしている。SUIを実Applicationとして移管することで、その価値が実際に開発負荷低減へつながるかを検証できる。
- SUI移管は同時に、TEIのPlugin / Adapter / Capability surfaceで不足する実利用要求を発見する最初のReference Adoptionになる。

## 対応方針

### 実施すること

1. **現行SUIの比較基線を固定する**
   - representative domain change
   - representative UI / Projection change
   - representative validation / safety rule change
   - representative external Capability / AI integration change
   を選び、現行実装で必要になる変更箇所・hand-written diff・test更新・文書同期を記録する。

2. **TEI上の最小vertical sliceを構成する**
   最初から全SUIを書き換えず、次のうちProduct Valueを強くPressureする小さいsliceを選ぶ。
   - Card / Island / Relationの保存・再読込
   - Canvas上のProjection / Interaction
   - SafeMode / review / proposal acceptance
   - export / import / provenance
   - 一つのAI / Cognitive Capability接続

3. **同一change challengeを比較する**
   現行SUIとTEI-based sliceへ同じ意味変更を加え、開発負荷を比較する。

4. **TEI gapを4分類する**
   - A: 既存TEI機能で表現可能
   - B: 再利用可能なTEI Plugin / Adapter / Capabilityとして切り出すべき
   - C: SUI固有native asset / custom implementationとして残すべき
   - D: 複数Applicationへ一般化できるTEI Core / Product gap候補

5. **Plugin候補を優先して開拓する**
   Dへ直行せず、Bで吸収できるものはPluginとして実証する。
   初期仮説としては、spatial / graph canvas projection、複雑Interaction、offline bundle / artifact連携等を候補にするが、Reference Evidenceなしに固定しない。

6. **移管判定を行う**
   - Full / broad migration
   - Incremental migration
   - Limited TEI adoption
   - Migration rejected / deferred
   のいずれかをEvidence付きで決める。

### 実施しないこと

- SUI Product ValueやDomainをTEI側へ移して正本を曖昧にすること
- 現行SUIを一度に全面rewriteすること
- SUI固有要求を根拠なくTEI Coreへ追加すること
- TEI利用率や生成コード量を成功指標にすること
- Security / bugfix / compatibility maintenanceまで移管ゲートのために停止すること

## 固定済みの実履歴Baseline

比較基線は `01_Plans/cross-repo/2026-09-18-sui-tei-reference-adoption-baseline.md` を正本とする。

最初の3 challengeは、実際にmerge済みの変更から選ぶ。

| Challenge | Historical PR | Changed files | Changed lines | Pressure |
|---|---:|---:|---:|---|
| A 階層表示＋表札 | #235 | 11 | 338 | meaning / Projection / validation / UI |
| B polygon頂点編集 | #286 | 5 | 219 | specialized spatial Interaction / native boundary |
| C merge accept明示transaction | #2849 | 3 | 465 | proposal / authority / mutation boundary |

補助Evidenceとして、hierarchy concernがexport / import / view metadataまで横断したPR #241（10 files / 260 changed lines）も参照する。

この実履歴を、TEI版で同じchallengeを行う際の比較元とする。単純なLOC削減ではなく、同じ意味変更がいくつの層へ波及したかを読む。

### 初期移管順

1. **Stage 0 — native encapsulation**: 現行`DocumentV1`とCanvasをそのまま利用可能なnative assetとして扱い、TEIへ第二正本を作らない。
2. **Stage 1 — stable semantic mapping**: Card / Island / Relation等の安定部分だけをTEIから検証・参照できる形へmappingする。
3. **Stage 2 — Application shell / Target**: TEI TargetがReference Adoption可能になった段階で、汎用UI shell / validation / review orchestrationをTEIへ寄せる。
4. **Stage 3 — Plugin discovery**: spatial canvas等を第二Applicationでも使える場合にだけPlugin候補へ昇格する。
5. **Stage 4 — advanced sensemaking**: AI Workspace等の大規模高度化は、移管境界が安定した後に本格実装する。

## 開発負荷の比較指標

主指標は人間の主観的な「楽だった」だけにしない。

- hand-written code / config / schemaの差分量
- 一つの意味変更で触れるファイル・層・正本の数
- test fixture / regression testの追加・修正量
- 同じ意味を重複記述する箇所数
- generated / derived artifactの再生成可能性
- validation / conformanceで自動検出できる不整合の割合
- Plugin / native implementationとして残ったSUI固有コード量
- 変更時に必要なmanual synchronization step数
- defect / rollback / migration friction
- 必要に応じて実作業時間も補助記録するが、単独の正本KPIにはしない

特に、**変更増幅率（change amplification）**を重要視する。

```text
一つのProduct上の意味変更
  ↓
何層・何ファイル・何テスト・何文書を同期する必要があるか
```

TEI移管後にこの増幅が継続的に小さくなることを、負荷低減の中心Evidenceとする。

## 受入条件

- [ ] 現行SUIの比較基線と少なくとも3種類のchange challengeが固定されている。
- [ ] TEI-based Reference sliceがSUI Product Valueを壊さず動作する。
- [ ] 同一change challengeについて現行実装とTEI-based実装の比較Evidenceがある。
- [ ] TEI gapがA〜Dへ分類され、Plugin候補とCore gap候補が混同されていない。
- [ ] 少なくとも1つの実利用由来Plugin候補について、再利用可能性を説明できる。
- [ ] 移管を進める／限定する／延期する判断が、開発負荷とProduct ValueのEvidenceから行われている。
- [ ] 大規模なSUI機能高度化を再開するとき、移管方針と実装正本が明確である。

## 責任分界

- 実行責任（R）: SUI側がProduct Value / behavior baselineを定義し、TEI側がApplication / Plugin境界のReferenceを実装・評価する。
- 受入判定（A）: Maintainer
- 契約チェックポイント: SUI Domain / SafeMode / review authority、TEI Canonical / Acceptance / Plugin / Target boundary
- 停止基準: TEI側の未成立RequirementをSUI移管のためだけに既成事実化する必要が出た場合、またはSUIの意味正本が二重化する場合は停止して上位設計へ戻る。

## 検証計画

- 現行SUIの代表変更をbaselineとして保存する。
- TEI Reference Adoption側で同じ変更を再現する。
- 差分量だけでなく、変更箇所の意味的重複、検証可能性、回帰範囲を比較する。
- Plugin候補はSUI専用品として固定せず、第二のApplicationで成立するかを後続TEI ReferenceでPressureする。

## 補足

このIssueは「TEIを使うこと」を成功条件にしない。  
成功条件は、**TEIによる実装へ移管することでSUIの開発・保守負荷が実際に低下し、同時にSUI Product Valueと安全境界が保たれることを反証可能に確認すること**である。
