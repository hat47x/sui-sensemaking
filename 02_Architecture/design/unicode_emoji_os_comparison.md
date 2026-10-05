# Unicode絵文字と固定画像セットの比較

区分: Internal / Research（DOMAIN-VISUAL-CUE-01 T5事前調査）

Updated: 2026-07-20

目的: Phase 1で採用する代表視覚cueの初期セットについて、Unicode絵文字（OSネイティブフォント）と固定画像（PNG/SVGバンドル）の4観点（OS間表示、アクセシビリティ、ライセンス、配布容量）を比較し、T6（保存候補比較・ADR更新）およびT7（Phase 1実装分割）の入力とする。

本比較は観測可能な範囲の情報に基づく机上調査であり、実機でのOS別スクリーンショット比較およびスクリーンリーダー実測はAC-6（Phase 0 fixture比較）の範囲に属する。

## 1. 比較対象

### 1.1 Unicode絵文字（OSネイティブフォント）

各OSのシステムemojiフォントがレンダリングするUnicode絵文字文字。アプリケーション側では単なる文字（`"📍"`）として扱い、OS/ブラウザがフォントでレンダリングする。

現行プロトタイプの使用セット（`RepresentativeVisualCuePrototypePanel.tsx`）:
`📍 🔎 ⏳ ✍ 🪪 ↗ 💻 △`

### 1.2 固定画像セット（PNG/SVGバンドル）

事前に用意したPNGまたはSVGファイルのセット。アプリケーション側で`<img>`またはインラインSVGとして配布し、OSに依存しない同一の表示を得る。

比較のため、次の2方式を検討対象とする。
- **PNGセット**: 48×48px、カラー、事前圧縮。代表的なアイコンセットの容量とライセンスを参照する。
- **インラインSVGセット**: 単色、CSS `color`継承。軽量でスケーラブル。

## 2. 比較表

| 観点 | Unicode絵文字 | 固定PNGセット | インラインSVGセット |
|---|---|---|---|
| **Windows表示** | Segoe UI Emoji（カラー、フラットデザイン） | 全OS同一 | 全OS同一（ブラウザSVG対応は全OSで標準） |
| **macOS表示** | Apple Color Emoji（光沢・3D風、他OSと異なる印象） | 全OS同一 | 全OS同一 |
| **Linux表示** | Noto Color Emoji または欠缺（distribution依存、表示保証なし） | 全OS同一 | 全OS同一 |
| **表示の一貫性** | **低**: OS間で印象が明確に異なる。macOSの光沢絵文字とWindowsのフラット絵文字は、同じ`📍`でも利用者の受ける印象が変わる。Linuxでは欠缺の可能性あり | **高**: 全OSでピクセル一致 | **高**: 全OSでベクター一致（フォントmetricsの影響を受けない） |
| **スクリーンリーダー** | Unicode名で読み上げられる（例: "round pushpin"）。読み上げ精度はOS/スクリーンリーダーに依存 | `alt`属性で明示的に設定可能。文言の制御が完全 | `aria-label`または`<title>`で明示的に設定可能 |
| **カスタマイズ性** | **不可**: OSフォントに依存。独自の色や形状にできない | **高**: 任意の色・形状を配布可能 | **高**: CSSで色・サイズを制御可能 |
| **ライセンス** | OSフォントのライセンスに従う（間接利用のため再配布不要）。システムフォントの表示はOSの通常利用の範囲内 | アイコンセット作成者のライセンスに従う。OSSライセンス（MIT、CC BY 4.0等）の選択が必要。再配布条件の確認必須 | PNGと同様。インライン化する場合はソースコードへの埋め込みとみなされる場合がある |
| **ライセンスリスク** | **低**: アプリがemoji画像を配布しないため、emojiフォントそのもののライセンスはOS販売元と利用者の関係に帰属する | **中**: 選択するアイコンセットのライセンスを順守する責任がアプリ配布者にある | **低〜中**: 自作SVGならリスクなし。外部セットはPNGと同様 |
| **配布容量** | **0 bytes**: OSフォントに依存するため、アプリの配布サイズに追加なし | **中**: 8種×48px PNG ≒ 約8〜16KB。キャッシュ戦略次第で追加負荷あり | **小**: 8種×シンプルSVG ≒ 約2〜6KB。gzip圧縮でさらに縮小 |
| **キャッシュ** | 不要（OS常駐フォント） | HTTPキャッシュまたはlocalStorageキャッシュ。初回読込時に取得 | JS bundleに包含可能（code split不要）。またはHTTPキャッシュ |
| **オフライン利用** | 常に利用可能（OSフォント） | キャッシュ後は利用可能。初回オフライン時は欠缺 | JS bundle内なら初回から利用可能 |
| **認知負荷/学習** | 利用者は日常的にemojiに触れているが、プラットフォーム間の見た目の差が同一性の認識を妨げる可能性がある | 全OS同一のため、学習したcueがOS間で一貫する | SVGと同様 |
| **文字としての検索性** | テキスト検索（Ctrl+F）でcueを検索不可（emojiは画面上の文字だが、利用者が入力して検索することは困難） | altテキストを適切に設定すればテキスト検索可能 | SVG内のテキストはブラウザ検索の対象外（aria-label検索は支援技術依存） |

## 3. OS別emoji表示の具体的な差異（机上）

| Emoji | Unicode名 | Windows（Segoe UI Emoji） | macOS（Apple Color Emoji） | Linux（Noto Color Emoji） | 差異の深刻度 |
|---|---|---|---|---|---|
| 📍 | Round Pushpin | 赤ピン、フラット、シンプル | 赤ピン、光沢・影あり、立体感 | 赤ピン、フラット、Windowsに近い | **低**: 色・基本形状は共通 |
| 🔎 | Magnifying Glass Tilted Right | 黒縁・透明レンズ、フラット | 銀縁・青レンズ、光沢あり | 黒縁・透明レンズ、フラット | **中**: macOSのみ青レンズ |
| ⏳ | Hourglass Not Done | 砂時計（上半分に砂）、茶色 | 砂時計（上半分に砂）、黄色・光沢 | 砂時計（上半分に砂）、茶色 | **低**: 色調差のみ |
| ✍️ | Writing Hand | ペンを持つ手、青ペン | ペンを持つ手、黒ペン・影 | ペンを持つ手（実装依存） | **中**: ペンの色が異なる |
| 🪪 | Identification Card | カード風、フラット | カード風、立体（比較的新しいemoji） | 欠缺の可能性あり（Noto未収録の場合） | **高**: Linuxで表示されない可能性 |
| ↗️ | Up-Right Arrow | 右上矢印、青 | 右上矢印、灰〜黒 | 右上矢印（実装依存） | **低**: 方向は共通 |
| 💻 | Laptop | ノートPC、グレー | ノートPC、シルバー・光沢 | ノートPC、グレー | **低**: 色調差のみ |
| △ | Warning | 黄三角・！、フラット | 黄三角・！、フラット | 黄三角・！（実装依存） | **低**: 警告記号はOS間で比較的安定 |

## 4. アクセシビリティ補足

### 4.1 Unicode絵文字のスクリーンリーダー挙動

- **Windows（NVDA）**: Unicode名を読み上げる。`📍`→"round pushpin"。読み上げ速度・正確さはNVDAのバージョンとemojiデータベースに依存。
- **macOS（VoiceOver）**: Unicode名を読み上げる。`📍`→"round pushpin"。Appleのemojiは高品質な読み上げ名を持つが、新しいemoji（等）はOSバージョン依存。
- **Linux（Orca）**: 読み上げはシステムのemojiデータに依存。欠缺時は無音または"unicode character"。

### 4.2 固定画像のアクセシビリティ

- `alt`属性を明示的に設定するため、スクリーンリーダーへの通知文言を完全に制御できる。
- ただし、`alt`テキストのi18nが別途必要（emojiはUnicode名が国際化されており、各言語のスクリーンリーダーが自動で読み分ける）。
- 配色・コントラストをアプリ側で制御できる（emojiはOSの表示に依存し、WCAG contrast ratioの保証がない）。

### 4.3 キーボード操作・フォーカス

- Unicode絵文字: 通常のテキスト文字としてTab順に入らず、フォーカス管理の追加実装不要。
- 固定画像: `<img>`または`<button>`での実装により、フォーカス・Tab順を明示的に設計する必要がある。

## 5. 推奨

### 現時点での推奨: Unicode絵文字をPhase 1の既定とし、SVG/PNGを補完として段階的に追加

理由は次のとおりです。

1. **配布容量ゼロ**: 初期実装に追加の配布負荷がない。8種類のPNG（約12KB）は小さいが、cueが増えるほど容量が線形に増加する。一方、emojiはOSフォントに依存するため、cueを100種に増やしても配布容量は増えない。

2. **実装の単純さ**: 単なる文字列として扱え、`<img>`要素・キャッシュ戦略・altテキストi18nの追加実装が不要。現行プロトタイプのコードは既にこの方式で動作している。

3. **段階的な改善経路**: OS間の表示不一致が実使用で問題になった場合だけ、該当emojiを固定SVG/PNGへ置き換えればよい。全emojiを一括で画像化する必要はない。

4. **T7（Phase 1実装分割）との整合**: T7は「手描き/基本図形、利用者画像切り抜き、絵文字/プリセットの小さなPRへ分割」を求めている。絵文字方式を既定とすることで、pr-1（emojiのみ）→ pr-2（不一致emojiをSVG化）→ pr-3（利用者画像）の順に分割できる。

### 注意事項と対応

| 問題 | 対応 |
|---|---|
| Linuxでのemoji欠缺 | `font-family`でNoto Color Emojiを指定し、欠缺時はCSS `@font-face` fallbackでシンプルなテキスト記号（`●▲■`等）にdegradeする |
| macOS/Windows間の見た目の差 | 色ではなく**位置・形状・方向**で意味を伝えるcueを優先採用する。「赤ピンと青ピン」に意味差を持たせない |
| 新しいemoji（🪪等）の未対応環境 | 採用emojiはUnicode 13.0以前の広く普及したものに限定し、新しすぎるemojiはT6（保存候補比較）で別途判断する |
| スクリーンリーダーの読み上げ精度 | `aria-label`を併用し、cueの意図する意味を明示する。例: `<span aria-label="位置情報">📍</span>` |

## 6. 次の一手（T6への入力）

1. 現行8種のemojiをUnicode 13.0以前の普及emojiに絞り、（Unicode 14.0、2021年）を差し替え候補としてリストする。
2. 「位置・形状・方向で意味を伝える」原則に従い、全8種がOS間で同一方向・同一基本形状を持つことを実機スクリーンショットで確認する（AC-6の範囲）。
3. SVGセットの並行準備は行わず、emoji欠缺が実機検証で確認されたcueだけをT7で個別にSVG化する。
4. ライセンス問題（emojiフォントの再配布）は発生しないため、ライセンス面でのT6判断は「emoji方式に追加ライセンス不要」で確定とする。

## 7. 参照

- [Unicode Emoji List v15.1](https://unicode.org/emoji/charts/full-emoji-list.html)
- [Noto Color Emoji](https://fonts.google.com/noto/specimen/Noto+Color+Emoji) — Linuxデフォルト候補
- [Segoe UI Emoji](https://learn.microsoft.com/en-us/typography/font-list/segoe-ui-emoji) — Windows 11
- [Apple Color Emoji](https://developer.apple.com/fonts/) — macOS / iOS
- `03_Implement/frontend/src/ui/RepresentativeVisualCuePrototypePanel.tsx` — 現行emoji使用コード
- `01_Plans/adr/ADR-0060-representative-visual-cue-source-boundary.md` — 供給経路と保存境界（Accepted）
- `01_Plans/issues/issue-DOMAIN-VISUAL-CUE-01-representative-visual-cues.md` — T5・T6・T7
