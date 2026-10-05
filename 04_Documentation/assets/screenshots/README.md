# Screenshots

このディレクトリには、利用者向け文書に掲載する画面例を置きます。

## 撮影・検証provenance

公開画像を更新するときは、画像だけでなく次の記録を同じ変更に含めます。

- 対象revision（commit SHA。未commitのUI変更から撮らない）
- 撮影日
- fixtureまたはサンプル文書
- locale、viewport、LLM provider、SafeMode
- 生成スクリプトと実行コマンド
- browser / Playwright version
- 成功・失敗した撮影状態

### 現行の検証済みセット

共通条件: source revision `6757d855c3ef6c0f7b444020e18f5ecd62fa4ec9`、撮影日2026-08-02、locale `ja`、`SUI_LLM_PROVIDER=none`、秘密情報なし、Playwright 1.58.2、Playwright管理Chromium 145.0.7632.6。

| Capture ID | 対象 | fixture | viewport | 生成スクリプト | 検証結果 |
| --- | --- | --- | --- | --- | --- |
| `release-ui-20260802` | `start-document-entry.png`, `app-canvas-overview.png`, `selection-context-card.png`, `share-export-safe-mode.png`, `mobile-toolbar-smoke-390.png` | `doc_phase1_canvas`の決定論的release sample | 1440×900、390×720 | `capture_release_screenshots.mjs` | 5/5生成成功 |
| `product-value-ui-20260802` | `product-value-*.png` 6件 | first meaningful map、ambiguity、review packの決定論的fixture | 1440×900 | `capture_product_value_screenshots.mjs` | 6/6生成成功 |
| `ui-catalog-20260802` | `ui-*.png` 12件 | `buildCatalogDocument()` / `doc_phase1_canvas` | 1440×900、768×900、960×900 | `capture_ui_catalog.mjs` | 12/12生成成功。島選択をキーボード操作し、選択状態の表示を待つようにして再実行 |

標準コマンドは次のとおりです。

```powershell
cd 03_Implement/frontend
node .\scripts\capture_release_screenshots.mjs
node .\scripts\capture_product_value_screenshots.mjs
node .\scripts\capture_ui_catalog.mjs
```

2026-08-02は `SUI_SCREENSHOT_BROWSER_PATH` を指定せず、Playwright管理Chromiumで撮影した。23件すべてを目視し、秘密情報・API key・顧客データがないこと、日本語ラベルとSafeMode / 未レビュー / readOnlyの境界が意図どおりであること、390pxを含む対象viewportで主要操作が見切れないことを確認した。初回確認で `ui-selection-context-island.png` が島未選択の状態を撮っていたため、capture scriptへ状態確認を追加してから最終セットを再生成した。

### stale判定と公開Go条件

次のいずれかが変わった画像セットはstaleとする。

- 参照するUIラベル、レイアウト、表示状態、fixture、locale、viewport。
- SafeMode、未レビュー、readOnly、共有前確認の表示。
- 対応するcapture scriptまたは画像の生成条件。
- 文書が説明する状態と画像で確認できる状態。

staleな画像は「現行」として公開しない。対象セットを再生成し、全撮影状態が成功し、画像の秘密情報・表示ラベル・SafeMode境界を目視確認し、provenance行を更新した時点で公開Goへ戻す。再撮影できない場合は画像を外すか、対象revisionと未確認状態を利用者向け本文に明示する。

### 記録テンプレート

```text
Capture ID:
Source revision:
Captured at:
Files:
Fixture:
Locale / viewport / provider / SafeMode:
Script / command:
Browser / Playwright:
Result:
Manual review:
Stale triggers checked:
```

撮影条件は次のとおりです。

- サンプル文書: `doc_phase1_canvas`は次のとおりです。
- UI locale: `ja`
- API: `http://127.0.0.1:8000`
- frontend: `http://127.0.0.1:4173/?locale=ja`
- LLM provider: `SUI_LLM_PROVIDER=none`
- 秘密情報、API key、組織固有の承認履歴、顧客データは含めない

ファイルは次のとおりです。

| ファイル | 内容 |
| --- | --- |
| `start-document-entry.png` | 起動直後の「作業を開始」パネル |
| `app-canvas-overview.png` | 起動直後のキャンバス、ヘッダー、右側パネル |
| `selection-context-card.png` | カード選択後、右側パネルの先頭に現在の選択とレビュー状態が表示される状態 |
| `share-export-safe-mode.png` | 「共有と再現」パネルの SafeMode と export/share 前チェック |
| `view-controls-safe-mode.png` | `View` パネルの表示設定と SafeMode |
| `diagnostics-quality-report.png` | diagnostics 実行後の品質レポート |
| `mobile-toolbar-smoke-390.png` | 390px viewport のヘッダーと主要操作 |

## Regeneration

Use the frontend screenshot capture script when the visible UI changes:

```powershell
cd 03_Implement/frontend
node .\scripts\capture_release_screenshots.mjs
```

The script starts a temporary Vite server when port 4173 is free, uses deterministic sample data, hides the transient status message for stable public images, captures the public-documentation screenshots, and stops the server when it started it.

Optional environment variables:

- `SUI_SCREENSHOT_OUTPUT_DIR`: output directory. Defaults to `04_Documentation/assets/screenshots`.
- `SUI_SCREENSHOT_BASE_URL`: target URL. Defaults to `http://127.0.0.1:4173/?locale=ja`.
- `SUI_SCREENSHOT_HOST`: Vite host. Defaults to `127.0.0.1`.
- `SUI_SCREENSHOT_PORT`: Vite port. Defaults to `4173`.
- `SUI_SCREENSHOT_BROWSER_PATH`: Playwright管理browserを使えない場合のChromium/Chrome実行ファイル。未指定時はPlaywrightの既定browserを使う。

## Product Value Evidence Screenshots

The following screenshots are generated from deterministic Product Value fixtures and are intended for public documentation or release-evidence review. They show representative states only; they do not by themselves approve Product Value gates or final release shipment.

| File | Purpose |
| --- | --- |
| `product-value-first-island.png` | PV01: first meaningful grouping after opening a sample, selecting two cards, and creating an island. |
| `product-value-first-island-share-preflight.png` | PV01: the first island carried into Share & Reproduce with SafeMode and remaining review signals visible. |
| `product-value-ambiguity-state.png` | PV02: an unresolved/ambiguous claim selected in a grouped context, with review state visible in the side panel. |
| `product-value-ambiguity-share-preflight.png` | PV02: Share & Reproduce preflight showing unresolved signals and SafeMode exclusion of unreviewed drafts. |
| `product-value-review-pack-trace.png` | PV03: the Share & Reproduce panel with selected-card traces included at detail granularity. |
| `product-value-review-pack-readonly.png` | PV03: a review-pack fixture inspected in read-only mode with review state and disabled edit actions visible. |

Regenerate these screenshots when Product Value fixtures, Japanese UI labels, canvas layout, or Share & Reproduce controls change:

```powershell
cd 03_Implement/frontend
node .\scripts\capture_product_value_screenshots.mjs
```

The script starts a temporary Vite server when `SUI_SCREENSHOT_PORT` is free, loads the app with `?locale=ja`, injects deterministic fixture data through Playwright routes, captures the six PNG files above, and stops the server when it started it.

## UI element catalog screenshots

These images form a comprehensive catalog of current UI elements for the user-facing reference (`04_Documentation/ui_catalog.md`) and for design-review handoff. Deterministic fixture, `ja` locale, `SUI_LLM_PROVIDER=none`, no secrets.

| File | Content |
| --- | --- |
| `ui-header-toolbar.png` | ヘッダー/主要ツールバー（ファイル・編集・新規カード・島を作成・削除・保存・詳細トグル・表示モード・検索・SafeMode） |
| `ui-card-domain-badges.png` | カードの claimType（事実/主張/仮説/unknown）・保留状態・違和感・未レビューのバッジ表示 |
| `ui-selection-context-holdstate.png` | カード選択時の選択コンテキスト（レビュー状態・判断保留・違和感） |
| `ui-selection-context-island.png` | 島選択時の選択コンテキスト |
| `ui-advanced-work-mode-panels.png` | 「詳細」ON + `作業モード` で開く独立した作業モード面（ナラティブ・HIL・差分等） |
| `ui-view-controls.png` | 「表示」パネル（表示モード・視点プリセット・SafeMode） |
| `ui-card-context-menu.png` | カード右クリックのコンテキストメニュー（編集/関係線でつなぐ/島を作成/削除） |
| `ui-card-inline-edit.png` | カードのダブルクリックによる本文インライン編集 |
| `ui-share-preflight.png` | 「共有と再現」パネルの共有前確認 |
| `ui-read-only-mode.png` | 読み取り専用モード |
| `ui-responsive-768.png` | 768px 幅でのレイアウト |
| `ui-responsive-960.png` | 960px 幅でのレイアウト |

Regenerate when the visible UI changes:

```powershell
cd 03_Implement/frontend
node .\scripts\capture_ui_catalog.mjs
```

WSL/Nix環境などローカルにPlaywrightのブラウザ依存が無い場合は、Playwright公式Dockerイメージ（プロジェクトの `@playwright/test` と同一バージョン）内で実行できます。

```bash
docker run --rm --ipc=host \
  -v "$PWD/03_Implement/frontend:/app" \
  -v "$PWD/04_Documentation/assets/screenshots:/out" \
  -w /app -e SUI_SCREENSHOT_OUTPUT_DIR=/out \
  mcr.microsoft.com/playwright:v1.58.2-jammy \
  bash -lc "node ./scripts/capture_ui_catalog.mjs"
```

