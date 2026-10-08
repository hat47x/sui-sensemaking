# Epistemic Review UX Reference — Issue #3184

## 目的

TEI #958 / PR #961のcontext-scoped epistemic Projectionを、SUI Sensemakingが独自Truth modelへコピーせず、低摩擦なreview UIへ変換できるかを実証する。

consumerはsemantic contract `tei.epistemic-projection/v0` とrepresentation schema `tei.reference.epistemic-assessment/v0` を別々に確認する。同じschemaでもcontractが未知なら拒否し、contractが既知でも未対応schemaを自動受理しない。

TypeScriptの型はJSON入力のruntime validationにはならないため、useState、metadataState、targetBinding、contextCompatibility、freshness、Conflict、confirmationState等も明示検査する。未知値をcandidateへ丸めてconfirm可能にせず、contract driftとしてfail closedする。

また、target再特定、coverage、partial Health、reviewer candidateのAuthority stop-lineを表す必須`authorityLimits`が欠けたProjectionも受理しない。

最初のReferenceはReact画面へ直接埋め込まず、`epistemic_review_model.ts`というpure view-modelとして置く。これにより、現在の巨大な`App.tsx`へ早期に状態機械を混入させず、表示状態、許可操作、bulk safety、review queueの意味を先に固定できる。

## 既存primitiveを再利用する

SUIには既に次がある。

- `domain/view/review_events.ts`: review操作の履歴
- `domain/inquiry_handoff_review.ts`: unresolved / handoff / candidate decision
- ReviewerRef / review attribution
- review-pack / selective merge

本Referenceは別のhistory subsystemを作らない。

TEIへconfirmation eventを書き戻す実adapterは後続とし、この段階では`EpistemicReviewIntent`だけを生成する。UI操作と永続化を分離し、既存reviewEventsやTEI sidecarへの接続方式を後から選べるようにする。

intentには、表示時点の `meaningFingerprint`、opaqueな `reviewSubjectFingerprint`、`targetBinding`、`reviewLogSequence` を期待値として持たせる。

`reviewSubjectFingerprint` はreview event自体を除いたepistemic subject（target、statement kind、scope、Evidence、relations等）の同時実行receiptであり、Truthやsemantic identityの証明には使わない。

永続化adapterはこれらを楽観ロックとしてTEIへ渡し、別surfaceで意味編集、scope / classification / Evidence / relation変更、target移動、review event追加が起きていれば古い確認操作を拒否できるようにする。件数とsequenceは同一視しない。

## 表示モデル

利用者へ常時すべてのmetadataを見せない。

表示では「現在作業でどう使えるか」と「人間確認済みか」を別軸にします。ここを一つのbadgeへ潰すと、たとえば確認済みのhypothesisを「未確認」と誤表示できます。

利用状態の主表示:

| 利用状態 | 主表示 | 意味 |
|---|---|---|
| premise | 作業前提 | 現在作業の前提として利用できる |
| candidate-only | 候補 | 前提とは分けて保持する |
| review-required / Conflict | 要確認 | 追加判断が必要 |
| partial / absent metadata | 情報不足 | 見えていないreview / Evidence / relationの可能性を残す |
| ambiguous target | 対象を確認 | annotation対象を一意に決められない |
| detached target | 対象なし | 元対象へ再接続できない |
| blocked | 利用停止 | premise利用しない |

確認状態は別badgeとして `未確認 / 確認済み / 否定済み` を表示できる。ただしmetadataがpartial / absentなら、source Projectionにconfirmedが残っていてもUIでは `確認状態不明` とする。hidden reject / withdraw等を否定できないためである。

rawなsource confirmationは詳細情報として保持できるが、利用者向けの「確認済み」表示へそのまま流さない。

したがってdirect user premiseは「作業前提 + 未確認」、human-confirmed factは「作業前提 + 確認済み」、human-confirmed hypothesisは「候補 + 確認済み」と表現できます。

`reanchored`は通常利用できる場合もあるが、「元位置から移動した」詳細signalを残す。semantic identityの証明として表示しない。

## 1操作とquick key

ReferenceではUI actionとして次を置く。

- `v`: confirm
- `h`: hypothesis
- `x`: reject
- `r`: request review
- 確認済み詳細操作: withdraw confirmation

ただし内部intentは一つへまとめない。

- confirm / reject / withdraw → append-only review event
- mark hypothesis → statement kind変更
- request review → stakeholder / reviewer handoff

これにより、仮説化や確認依頼を誤ってreview eventとして永続化しない。

review-event intentだけはpure adapterでTEIの `tei.epistemic-review-command/v0` / `tei.reference.epistemic-review-command/v0` へ変換できる。commandにはreviewer / event ID / occurredAtと、meaning / subject / target / review-sequenceの楽観ロックreceiptを渡す。

classification-change intentとreview-request intentはこのadapterの入力型にしない。

実際のkeyboard bindingは画面統合時にaccessibility / IME / browser shortcutとの競合を確認して決める。ここではaction semanticsだけをcandidateとして固定する。

## accidental over-approvalを防ぐ

bulk confirmは「確認できるitemだけ処理して残りを無視する」挙動にしない。

selectionに次が一つでも含まれればbulk operation全体を止め、blocked itemを返す。

- partial / absent metadata
- ambiguous / detached target
- Conflict / review-required
- blocked

利用者がselectionを見直してから再実行する。

## metadata loss / access redaction

`metadataState=partial / absent`を`確認済み`として表示しない。

partial metadataでは、権限不足によりhidden reject / Conflict / supersessionが存在する可能性がある。`request-access`や`refresh-source`と、人間による`confirm`を別操作として扱う。

追加権限を取得したこと自体をhuman reviewへ変換しない。

## target recovery

- exact: 通常表示
- reanchored: 通常表示 + 必要時に移動履歴
- ambiguous: `resolve-target`を提示し、一意に決まるまでconfirm禁止
- detached: `resolve-target`または保留 / 廃止導線へ進み、別textへ自動転送しない

target recoveryとcontent reviewは別操作である。

## Project Knowledge Health

`viewMetadataState=partial`なら、source Healthがhealthyでも「project全体がhealthy」と表示しない。

coverage gapは未確認assertionと別のqueue itemにする。「情報はあるが未確認」と「重要領域の状態を把握できていない」を混同しない。

## reviewer candidate

review queueはreviewerCandidatesを表示できるが、必ず`reviewerCandidateIsAuthority=false`として扱う。

推薦結果だけでconfirmしない。

## Canonical containment

このReferenceはpure projectionであり、Document、ConsensusGraph、reviewEventsを変更しない。

```text
TEI Projection
  -> SUI Epistemic UI model
  -> human intent
  -> [future adapter]
  -> existing review history / TEI sidecar
```

UI modelを削除してもSUI Canonical documentの意味は変わらない。

## 未実証

- App.tsx / canvas / mobileへの実表示
- range selectionからassertion / targetへのbinding
- existing reviewEventsとTEI reviewEventsのadapter
- conditional reviewからcontext refinementを編集するUI
- ambiguous target候補選択UI
- detached targetの再接続UI
- stakeholder handoffの実画面
- actual interactionでのreview time / accidental approval率
