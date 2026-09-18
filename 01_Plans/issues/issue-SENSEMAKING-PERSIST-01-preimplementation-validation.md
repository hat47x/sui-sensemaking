# Issue: SENSEMAKING-PERSIST-01 semantic artifact永続化の実装前検証

- Type: Feature
- Status: In Progress
- Source Issue: SENSEMAKING-MODEL-01
- Priority: P1
- Owner: Maintainer
- Scope: `01_Plans/adr/ADR-0088-*`, `02_Architecture/sensemaking_*`, persistence fixture / benchmark / migration planning
- Related ADR/Spec: `ADR-0085`, `ADR-0086`, `ADR-0087`, `ADR-0088`
- Norms: `DOM-SM-01..12`, `DOM-AI-04..11`
- Expected verification level: design fixture / portable DB contract / benchmark

## 目的

semantic artifactをruntimeへ実装する前に、ADR-0088の第一候補

> RDB metadata/event + Content Store payload + materialized Information Network

が、SUIのVerified DB family、SafeMode、Review / Authority、exchange、retention要件を満たせるかをEvidence付きで検証する。

本Issueが完了するまでmigrationを開始しない。

## 実施すること

1. **Portable table sketch**
   - artifact identity
   - artifact revision
   - revision parent / input refs
   - Review
   - Authority Scope / transition
   - participant snapshot
   - source assertion
   - import mapping
   - retention pin
   - derived authority cache / relation index

2. **FK / constraint matrix**
   - tenant composite FK
   - exact revision target
   - semantic kind immutability
   - parent same-artifact constraint
   - Review exact target
   - Authority expectedFrom CAS
   - participant snapshot immutability
   - import collision

3. **Representative fixture**
   - Human-led
   - AI Workspace
   - multi-scope Authority
   - source Accepted / Consensus exchange
   - ID collision

4. **Concurrency pseudo-test / executable contract test**
   - stale Authority promotion
   - simultaneous Candidate -> Accepted
   - Review target revision drift
   - scope conflict

5. **Exchange staging test**
   - self-contained closure
   - external dependency
   - source authority de-privilege
   - imported human Review non-elevation
   - SafeMode closure failure

6. **Content Store benchmark**
   - kind payload canonical JSON
   - 100 / 1000 / 10000 artifact
   - inline DB content
   - canvas revision codec再利用可否

7. **Information Network rebuild**
   - canonical records -> network projection
   - projection削除 -> rebuild
   - unknown extension Relation roundtrip
   - multi-scope Authority非圧縮

8. **Retention / GC plan**
   - Review / Authority / Decision / Relation / pin root
   - Working-only microtrial
   - payload blob refcount
   - source assertion / import mapping

## 実施しないこと

- 本Issueの検証前にAlembic migrationを追加しない。
- `DocumentV1`へsemantic artifact fieldを追加しない。
- graph DBをcanonical sourceとして先行導入しない。
- imported source authorityをlocal authorityへ投入しない。
- Review / Authorityを一つのstatus columnへ統合しない。
- private chain-of-thoughtをfixtureへ保存しない。

## 進捗（2026-09-18）

- ADR-0088でphysical persistenceの第一候補をRDB metadata/event + Content Store payload + materialized Information Networkとして採択した。
- `sensemaking_artifact_persistence_candidate.md`でtransaction、index、GC、fixture、materializer候補を整理した。
- `sensemaking_artifact_portable_schema_matrix.md`でlogical record class、composite FK、DB / transaction / validator責務、Authority CAS、Review target drift、import stagingを具体化した。
- まだmigrationは開始していない。
- 次はrepresentative fixtureとportable constraint実証、Content Store / network rebuild benchmarkへ進む。

## 受入条件

- [x] portable logical schemaとFK / constraint matrixが完成している。`02_Architecture/sensemaking_artifact_portable_schema_matrix.md`を正本候補とする。
- [ ] Verified DB familyで表現不能なCore constraintが無いか明示されている。
- [ ] representative fixtureが5系統以上ある。
- [ ] Authority CAS / stale targetの競合ケースが定義されている。
- [ ] exchange importでsource Accepted / Consensus / human Reviewがlocalへ昇格しないことを検証できる。
- [ ] SafeMode後のbundle closureを検証できる。
- [ ] Content Store payload benchmark結果がある。
- [ ] Information Networkをcanonical recordから再構築できる設計と計測結果がある。
- [ ] retention root / GCのfail-closed条件が定義されている。
- [ ] migrationへ進む／進まないGo判断と根拠を記録する。
- [ ] migrationへ進む場合は別implementation Issue / schema ADRを起票する。

## ブランチ運用

設計・fixture・benchmarkまでは、同じpersistence workstream内で進める。検証項目ごとにbranchを増殖させない。

migration実装へ進む場合だけ、検証済みの統合先から実装branchを切り、完了後に元branchへ戻す。

## 停止基準

次が判明したらmigrationへ進まずADR-0088へ戻る。

- portable RDB constraintでAuthority correctnessを守れない
- Content Store境界がpayload revisionを安全に保持できない
- source authority de-privilegeがimportで成立しない
- Information Networkをcanonical sourceにしないとQueryが成立しない
- Review / Authority / provenanceの分離が実装不能
