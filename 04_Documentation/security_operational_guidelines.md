# セキュリティ運用ガイドライン（例）

対象読者: sui-sensemakingの安全設定を確認する管理者、運用担当者、セキュリティ担当者。

目的: SafeMode、AI接続、監査ログ連携、共有やexportの設定を変える前に、最低限確認したい観点を整理します。

範囲外: 組織固有の承認フロー、承認期限、役職名、監査証跡、インシデント対応規程。

公開区分: 運用判断者向け公開候補。公開可能な判断観点に限定し、組織固有の承認者名、期限、内部監査証跡は扱いません。

この文書は、組織共通の規定ではなく、判断を支援するための例です。実際の承認者、記録方法、確認期限、監査項目は、各組織の規程やリスク評価に合わせて決めてください。

## 基本姿勢

- 迷ったら設定を変えずに保留する。
- 外部サービスとの共有が必要な理由を説明できない場合は共有しない。
- SafeModeの緩和は、便利さではなく必要性と復旧可能性で判断する。
- AIの出力は提案として扱い、人間の確認なしに確定状態へ昇格させない。
- API key、token、password、未加工の顧客情報は、ログ、スクリーンショット、exportに含めない。

## 役割の考え方

組織内の正式な肩書と一致していなくても構いません。少なくとも次の3つの責務を混ぜずに扱うことが重要です。

| 責務 | 確認すること |
| --- | --- |
| 安全性を判断する人 | 秘密情報、外部サービスとの共有、SafeMode 緩和のリスク |
| 業務上の必要性を判断する人 | なぜ変更が必要か、利用者にどの影響があるか |
| 設定を実行する人 | 変更内容、戻し方、確認結果 |

同じ人が複数の責務を担う場合でも、記録上は「誰が判断し、誰が実行したか」を分けて残します。


## Runtime profile とセキュリティ判断

設定変更の前に、どのprofileで運用するかを確定します。
profileの詳細は、GitHub上の [runtime_parameter_registry.md](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/runtime_parameter_registry.md) を参照してください。

- `local-dev`: 外部共有を避ける初期検証向け（`SUI_LLM_PROVIDER=none`）。
- `evaluation`: Compose評価向け。外部連携は必要時のみ限定有効化。
- `enterprise-production`: strict運用を前提に、`SUI_ALLOW_JIT_PROVISIONING=false` を標準とする。
- `enterprise-production`: `SUI_ACCESS_CONTROL_FAIL_SAFE_MODE` を `read_only` または `deny` で事前合意し、運用中に暗黙変更しない。

プロファイル未確定のまま `SUI_ALLOW_JIT_PROVISIONING`、`SUI_AUDIT_*`、`SUI_ACCESS_CONTROL_*` を変更しないでください。

## 設定変更前の確認

設定を変える前に、次の4点を短く説明できる状態にします。

| 確認 | 例 |
| --- | --- |
| 何を変えるか | `SUI_LLM_PROVIDER`、audit HTTP endpoint、access control adapter |
| なぜ必要か | 検証、障害調査、組織内 LLM との連携 |
| 何を共有するか | LLM 入力、監査イベント、export ファイル、ログ |
| 戻せるか | 元の環境変数、再起動手順、確認コマンド |

この4点が説明できない場合は、設定変更を保留してください。

## 判断を支援する例

以下は「こう判断すべき」という規定ではなく、確認観点の例です。

### local LLM を使う

確認すること。

- 実際の接続先がlocalまたは組織内の管理されたendpointである。
- 入力に秘密情報や未公開顧客情報を含めない運用になっている。
- 失敗時に `SUI_LLM_PROVIDER=none` へ戻せる。

保留する例は次のとおりです。

- localと呼んでいるが、実際のendpointが外部ネットワークにある。
- 入力の保持期間や二次利用条件が確認できない。

### large-scale LLM を使う

確認すること。

- 明示的にopt-inしている。
- allowlistと実際のhostが一致している。
- 外部サービスとの共有が必要な理由と、共有する情報の範囲が記録されている。

保留する例は次のとおりです。

- allowlistとhostが一致しない。
- 未レビュー情報や秘密情報が共有される可能性が残っている。

### audit HTTP 連携を使う

確認すること。

- 接続先、保持期間、所有者が分かっている。
- payloadに秘密情報を含めない方針がある。
- SafeMode中に連携を許可する場合、その理由を記録している。

保留する例は次のとおりです。

- audit endpointの管理者や保持期間が分からない。
- 障害時のqueue、timeout、再送の扱いが分からない。

## 記録に残す最小項目

- 変更日時
- 対象環境
- 変更した設定
- 判断した人または役割
- 実行した人または役割
- 戻し方
- 確認した結果

組織固有の承認番号、個人情報、秘密情報、内部URLは、公開文書や共有用メモへ含めません。

## 確認コマンド

```bash
curl -fsS http://localhost:8080/api/healthz
docker compose logs api --tail=100
```

API keyを有効にしている場合。

```bash
curl -H "X-API-Key: <key>" http://localhost:8080/api/docs/<doc_id>
```

## 役割を記録するときの考え方

組織内の正式な役職名に関係なく、記録では次の責務を分けます。

- 安全性を判断する責務。
- 業務上の必要性を判断する責務。
- 設定を実行し、結果を記録する責務。

同じ人が複数の責務を担う場合でも、判断と実行が混ざらないように記録します。組織でより厳密な承認期限や承認人数を定める場合は、各組織の規程を優先してください。

## 関連文書

- [security.md](security.md)
- [data_handling.md](data_handling.md)
- [configuration.md](configuration.md)
- [operations.md](operations.md)
- [acceptance_check.md](acceptance_check.md)
- [strict_mode_exception_approval_flow.html](https://github.com/hat47x/sui-sensemaking/blob/main/02_Architecture/strict_mode_exception_approval_flow.html)
