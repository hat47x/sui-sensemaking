# ADR-0085: sensemaking意味成果物と権限状態を直交軸として分離する

- Status: Accepted
- Date: 2026-09-18
- Deciders: Maintainer
- Scope: `00_Prompt/domain.md`, `01_Plans/adr/ADR-0001-value-to-requirements.md`, `02_Architecture/sensemaking_semantic_model.md`, `02_Architecture/schemas.md`
- Related: `ADR-0057`, `ADR-0070`, `ADR-0084`

## Context

ADR-0084により、SUI Sensemakingは、人間主導のKJ法キャンバスだけでなく、AI Workspace内でObservation、Relation、Hypothesis、Structure、Synthesisを複数段階にわたり形成できる長期的なsensemaking基盤として位置づけられた。

次の設計課題は、それらをどのような意味境界で保持するかである。

単純に、

```text
Evidence
  -> Observation
  -> Hypothesis
  -> Structure
  -> Synthesis
  -> Review
  -> Decision
```

という状態遷移として実装すると、重大な混同が起きる。

- ObservationがHypothesisへ「昇格」したとき、元の観察が失われる。
- AIが生成したHypothesisをAcceptedへ変更すると、生成主体と承認主体が一つの状態へ潰れる。
- Review済みであることと、内容がAcceptedであることが混ざる。
- 公開されていることと、権威を持つことが混ざる。
- SynthesisからDecisionへ進んだ結果、採らなかった主要代替案や反証が失われる。
- 現行`DocumentV1`のCard / Edge / Island等を新概念へ直接読み替えると、既存契約の意味を後付けで変更する。

必要なのは、sensemakingの**意味種別**と、review・authority・lifecycle・visibility・provenanceを別々の軸として扱うことである。

## Decision

### D1. 意味種別を成熟度や状態遷移として扱わない

Evidence、Observation、Hypothesis、Structure、Synthesis、Review、Decisionは、それぞれ異なる意味を持つ成果物または記録である。

ObservationがHypothesisへ、HypothesisがSynthesisへ「型変更」される設計を採らない。

新しい意味が生じた場合は、元成果物を残したまま新しい成果物を作り、`derivedFrom` / `groundedBy`等の来歴関係で結ぶ。

```text
Observation o1
   |
   +-- derivedFrom --> Evidence e1
   |
Hypothesis h1
   +-- derivedFrom --> Observation o1
   +-- groundedBy --> Evidence e1

Synthesis s1
   +-- synthesizes --> Hypothesis h1
```

この原則により、後から「何が元資料で、何が認識で、何が解釈だったか」へ戻れる。

### D2. EvidenceをTruthと同一視しない

Evidenceは、sensemakingの根拠として参照される資料・記録・証拠である。

Evidenceであることは、その内容が真であることを意味しない。

```text
Evidence != Fact != Accepted meaning
```

相反するEvidence、誤りを含む一次資料、出典不明の記録も、来歴と不確実性を保持してEvidenceとして参照できる。

AIはEvidenceを生成したように見せるために、存在しない出典・話者・日時・観察事実を補ってはならない。

### D3. Observationは「誰か／何かが何を認識したか」を保持する

ObservationはEvidenceや対象状態から認識された内容であり、観測・抽出・気づきの記録である。

Observationには、少なくとも概念上、

- 認識主体
- 対象または入力範囲
- 参照したEvidence
- 利用したMethod / Provider
- 生成時点
- 不確実性・保留

を後から辿れる必要がある。

Observationは元Evidenceを上書きしない。また、Observationであることから真偽や重要度を推定しない。

### D4. Relation / Hypothesis / Structure / Synthesisを別概念として保持する

- **Relation**: 複数の意味成果物の間に置かれた関係の主張・記述。関係の存在自体も取消し・反証可能である。
- **Hypothesis**: Evidence / Observation / Relation等をもとに形成された解釈。反証、保留、棄却、再採用が可能であり、Factへ暗黙昇格しない。
- **Structure**: 複数成果物を、membership、relation、空間配置、因果、階層等で組み合わせた構造。Island、Graph、Cluster等はStructureの具体的Projectionになり得る。
- **Synthesis**: 複数のHypothesis / Structure / Relation等を統合して表した理解。未解決点・主要反証・代替案を伴ってよい。

Synthesisは「最終結論」を意味しない。AcceptedでないSynthesisも、複数の競合Synthesisも保持できる。

### D5. ReviewとAuthorityを分離する

Reviewは、ある主体が**特定の成果物revisionを読んだ／検査した／異議を示した**という記録である。

Reviewが存在することだけで、その成果物をAcceptedへ昇格させない。

```text
reviewed
  != accepted
  != consensus
  != true
```

人間ReviewとAI Reviewも区別する。

現行`human_reviewed`は引き続き人間操作だけで付与する。将来の一般Reviewモデルでは、`human_reviewed`を満たすReview記録の存在から導出可能にする余地を持つが、本ADRだけで現行runtime契約を変更しない。

### D6. Authority状態を意味種別から独立させる

同じHypothesisやSynthesisでも、authority上の位置づけは異なり得る。

概念上、少なくとも次を区別する。

- **Working**: 作業空間内の成果物。共有・承認上の権威を持たない。
- **Candidate**: Review / adoptionの対象として提示された成果物。
- **Accepted**: 定義されたscopeとauthorityのもとで明示的に採用された成果物。
- **Consensus**: 定義された参加主体・手続きのもとで共有の採用状態となった成果物。

Accepted / ConsensusはTruthの同義語ではない。scope、actor / policy、時点を伴う。

また、visibility / access controlはauthorityとは別である。公開されたCandidateも、非公開のAccepted artifactも存在し得る。

### D7. Lifecycle状態も別軸とする

保留、棄却、置換、archive等は意味種別とは別に扱う。

概念上、

- active
- held
- rejected
- superseded
- archived

等を表現できる余地を持つ。

棄却されたHypothesisや置換されたSynthesisを削除せず、なぜ採られなかったかを後から辿れるようにする。

### D8. DecisionをSynthesisやAcceptanceと同一視しない

Decisionは、sensemaking結果を踏まえて「何を採るか／何をするか」を選択した記録である。

```text
Synthesis != Decision
Accepted meaning != Decision
Decision != Execution
```

同じSynthesisから異なるDecisionが生じてもよい。Decisionを行うauthorityは別途確認可能でなければならない。

現行SUIでAIが人間のDecision Authorityを代行することは許可しない。将来の委任判断はADR-0084 D6に従い、別ADRでauthority modelを定義する。

### D9. Review Capsuleをcanonical artifactではなく再構築可能なProjectionとして扱う

AIが大きな探索区間を担うと、人間が全中間成果を時系列に読むことは現実的でない。

そのため将来のReview Surfaceでは、次を一つのReview Capsuleとして提示できるようにする。

- review対象
- 主要Evidence / Observation
- 採用したHypothesis / Structure / Synthesis
- 強い反証
- 採らなかった主要代替案
- 未解決点 / Hold
- 生成主体・Method / Provider・入力範囲
- 何のauthority actionを要求しているか

Review Capsuleは元成果物への参照から再構築できるProjectionとし、元成果物やReview記録の代替正本にしない。

### D10. traceabilityはprivate chain-of-thought保存を要求しない

SUIが保持するのは、後から検証・再開・異議申立てに必要な**外在化された意味成果物と来歴**である。

AI内部のtoken単位の推論、hidden state、private chain-of-thoughtを保存要件にしない。

必要なのは、

- どの入力を使ったか
- どのProvider / Methodを使ったか
- どの成果物を生成したか
- 主要な根拠・反証・代替案は何か
- どの成果物から派生したか

であり、内部推論全文ではない。

### D11. 現行DocumentV1へ新概念を逆注入しない

現行型との関係は次のように扱う。

| 現行構造 | 将来意味モデルとの関係 |
|---|---|
| `Card` / `claimType` | Evidence / Observation / Hypothesis等の**表現になり得る**が、一対一対応とはみなさない |
| `Edge` | Canvas上の構造Relation。汎用Relation artifactそのものとはみなさない |
| `EvidenceLink` | Card間のsupports / contradicts関係。Evidence entityそのものではない |
| `Island` / `Cluster` | StructureのProjectionになり得る |
| `Narrative` / `RelationSummary` | SynthesisのProjectionになり得る |
| `ReviewAttribution` | 現行の文書単位Review metadata。汎用Review artifactとはみなさない |
| `WorkingGraph` / `ConsensusGraph` | authority / work surfaceであり、意味種別ではない |

本ADRでは`DocumentV1`のfield追加・意味変更・version変更を行わない。

将来、これらを永続型へ落とす場合は、新しいschema / migration / CRUD / support levelを別issue・ADRで設計する。

## Three-Element Verification（ADR-0067）

| 次元 | このADRでの主張 | 他次元への制約 |
|---|---|---|
| **業務設計** | 人間・AIが形成した意味を、元資料、解釈、統合、レビュー、採用、判断へ分解して後から読み直せる | データ: 型変換で元意味を失わない。機能: Review Surfaceは主要根拠・反証・代替案へ戻れる |
| **データ設計** | semantic kind / provenance / review / authority / lifecycleを直交軸として扱い、派生は新artifact + relationで表現する | 業務: AI生成物を人間承認済みに見せない。機能: promotion / reviewはtarget revisionを明示する |
| **機能設計** | AI Workspace内の探索とReview Capsuleによる人間理解を両立する | 業務: 全AI内部推論を読むことを要求しない。データ: Review Capsuleは再構築可能Projectionであり正本化しない |

## Consequences

### Positive

- ObservationからHypothesisへの「epistemic laundering」を防げる。
- AIが多数の中間仮説を扱っても、人間承認済み状態と混ざらない。
- 異種認知Providerの不一致を一つのscoreへ潰さず保持できる。
- Review済み、Accepted、Consensus、Public等の異なる概念を分離できる。
- 人間はAIの全内部探索ではなく、検証に必要な外在化成果へ集中できる。
- 現行`DocumentV1`の互換性を保ったまま将来モデルを設計できる。

### Costs / Open questions

- logical artifact IDとrevision identityの具体形式は未決。
- Relation vocabularyをclosed-worldにする範囲は未決。
- Authority transition eventの永続schemaは未決。
- Review Capsuleの最小必須項目と生成SLOは未決。
- どの中間代替案を「主要」として永続保持するかの選定policyは未決。
- 一般Review modelと現行`human_reviewed` / `ReviewAttribution`の移行は別途設計が必要。
- DocumentV2等へ進む場合はmigration / import / export / SafeMode / retentionを改めて設計する。

## Traceability

- `01_Plans/adr/ADR-0084-sensemaking-lifecycle-and-authority-boundary.md`
- `00_Prompt/domain.md`
- `01_Plans/adr/ADR-0001-value-to-requirements.md`
- `02_Architecture/sensemaking_semantic_model.md`
- `02_Architecture/schemas.md`
