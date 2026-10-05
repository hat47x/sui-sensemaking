## 依頼

文脈に含まれるカード群から、島（まとまり）のタイトル候補を3件程度、提案してください。対象範囲: カード1枚。

## ガードレール

「あなたの出力は提案であり確定しません／点数・順位・％・優先度の数値を付けないでください／曖昧・対立・未確定はそのまま保持して提示してください／出典のない断定をしないでください／応答は§4のJSONのみで返してください（前後の説明文は不要）」

## 文脈

（セーフモード: 本文は非表示です）

カード: 1枚（レビュー済み1・未レビュー0）
- [claim] [REDACTED]:h2dfe140a

## 応答契約

以下のJSON Schemaの形式で応答してください。

```json
{
  "schemaVersion": "agent-response.v1",
  "taskId": "uuid (依頼のエコーバック・必須)",
  "respondedAt": "ISO8601 (任意)",
  "agent": "string (例: copilot-studio:<agent名> / m365-copilot。自由記述)",
  "proposals": [
    {
      "proposalId": "string (応答内一意)",
      "kind": "island_title | merge_candidate | narrative_draft | opposing_viewpoint | critique | patch",
      "targetRef": {
        "islandId": "string?",
        "cardIds": [
          "string"
        ]
      },
      "content": {
        "title": "string?",
        "text": "string?",
        "mergedText": "string?"
      },
      "rationale": "string (必須・なぜそう考えたか)",
      "patch": "PatchV1? (kind=patch のときのみ。baseDocSignature は依頼と一致必須)"
    }
  ]
}
```

最小記入例は次のとおりです。

```json
{
  "schemaVersion": "agent-response.v1",
  "taskId": "<correlation.taskId をそのまま記入>",
  "proposals": [
    {
      "proposalId": "p1",
      "kind": "critique",
      "targetRef": {
        "cardIds": [
          "<card-id>"
        ]
      },
      "content": {
        "text": "..."
      },
      "rationale": "..."
    }
  ]
}
```

## 相関ブロック

以下のJSONを、応答にそのままecho-backしてください（taskIdは必ず一致させてください）。

```json
{
  "schemaVersion": "agent-task.v1",
  "taskId": "906ca794-26cf-4b8f-8b58-31ffb8f950de",
  "createdAt": "2026-07-11T13:54:40.287Z",
  "docId": "doc_agent_design_review_fixture",
  "baseDocSignature": "doc_agent_design_review_fixture:2026-07-11T00:00:00.000Z",
  "bundleHash": "283d9594da615cdec03fd568a231b865520b383958e14ac01126986a63763796",
  "queryCanonicalHash": "934c0c986ffc159f1b33274703981bc5345ff599e13bf3eb2de63dd696752964",
  "taskKind": "island_titles",
  "locale": "ja"
}
```
