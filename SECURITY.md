# Security Policy / セキュリティポリシー

## サポート対象バージョン / Supported Versions

現時点では `main` ブランチのみをサポート対象とします。

- `main` に含まれない過去コミット・古いタグについては、修正が提供されない場合があります。

## 脆弱性報告方法 / Reporting a Vulnerability

1. 可能であればGitHub Security Advisories（Private advisory）を利用してください。
2. Private advisoryが使えない場合は、公開前提での詳細開示は避け、
   `security` ラベル付きIssueを最小限の情報で作成してください。
   - 例: 影響範囲の概要、再現可否、連絡可能な方法（GitHub上）

個人メールアドレス等への直接送付は要求しません。まずGitHubの機能を優先してください。

## 報告時に含めてほしい情報 / What to Include

- 影響を受ける機能（例: ZIP import / markdown rendering / dependency update）
- 再現手順（できるだけ最小）
- 期待動作と実際の挙動
- 影響を確認したコミットSHAまたはブランチ名
- ログ、スクリーンショット、PoC（公開可能な範囲）

## 対応方針と開示タイムライン / Disclosure Timeline

- 受領後、メンテナは best effort でトリアージします。
- 修正・緩和策の準備中は、再現詳細の公開を控えてください。
- 修正後は、必要に応じてadvisory / changelog / issueで開示します。
- 厳密なSLAは設けませんが、進捗は可能な限り透明化します。
