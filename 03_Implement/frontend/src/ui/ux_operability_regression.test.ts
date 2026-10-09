import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(__dirname, "..", "..", relativePath), "utf8");

describe("UX Operability regression contracts", () => {
  it("recovers trace controls after worker rejection without exposing the error", () => {
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");

    expect(sidePanelSource).toContain("runTraceRequest({");
    expect(sidePanelSource).toContain('"side_panel.trace.failed"');
    expect(sidePanelSource).toContain("onSettled: () => {");
    expect(sidePanelSource).toContain("if (traceAbortRef.current === controller)");
    expect(sidePanelSource).toContain("setIsTraceRunning(false)");
  });

  it("Phase 1: pointer-keyboard-flow-review", () => {
    const cardViewSource = readSource("src/canvas/CardView.tsx");

    expect(cardViewSource).toContain("function canStartDrag");
    expect(cardViewSource).toContain('if (event.pointerType === "mouse")');
    expect(cardViewSource).toContain("event.currentTarget.setPointerCapture(event.pointerId)");
    expect(cardViewSource).toContain("event.currentTarget.releasePointerCapture(event.pointerId)");
    expect(cardViewSource).toContain('event.key === "Enter" || event.key === " "');
  });

  it("Phase 2: keyboard-card-selection", () => {
    const cardViewSource = readSource("src/canvas/CardView.tsx");

    expect(cardViewSource).toContain('role={isEditing ? undefined : "button"}');
    expect(cardViewSource).toContain("aria-pressed={isEditing ? undefined : isSelected}");
    expect(cardViewSource).toContain("const [isFocused, setIsFocused] = useState(false)");
    expect(cardViewSource).toContain("onFocus={handleFocus}");
    expect(cardViewSource).toContain("onBlur={handleBlur}");
    expect(cardViewSource).toContain('data-focus={isFocused ? "card" : undefined}');
    expect(cardViewSource).toContain("tabIndex={isEditing ? -1 : 0}");
    expect(cardViewSource).toContain("onKeyDown={handleKeyDown}");
    expect(cardViewSource).toContain("onSelect(card.id, event.shiftKey)");
  });

  it("UX-SHORTCUT-01: selected-card hold/critique/review shortcuts stay guarded", () => {
    const hotkeysSource = readSource("src/hooks/useHotkeys.ts");
    const appSource = readSource("src/App.tsx");
    const shortcutCheatsheetSource = readSource("src/ui/ShortcutCheatsheet.tsx");

    expect(hotkeysSource).toContain("export function resolveHotkeyAction");
    expect(hotkeysSource).toContain("isEditableTarget(event.target)");
    expect(hotkeysSource).toContain('input.key === "?"');
    expect(hotkeysSource).toContain('kind: "open-shortcut-help"');
    expect(hotkeysSource).toContain('kind: "dismiss-top-layer"');
    expect(hotkeysSource).toContain("input.canDismissTopLayer");
    expect(hotkeysSource).toContain('lowerKey === "h" && input.canToggleSelectedCardHold');
    expect(hotkeysSource).toContain('lowerKey === "u" && input.canToggleSelectedCardCritique');
    expect(hotkeysSource).toContain("&& !input.canReadingPathToggleReviewedOnly");
    expect(appSource).toContain("<ShortcutCheatsheet");
    expect(appSource).toContain("const closeShortcutCheatsheet = useCallback");
    expect(appSource).toContain("setIsShortcutCheatsheetOpen(true)");
    expect(appSource).toContain("aria-pressed={isActive}");
    expect(appSource).toContain('lowerKey === "h"');
    expect(appSource).toContain('lowerKey === "u"');
    expect(appSource).toContain('lowerKey === "r"');
    expect(appSource).toContain("if (isEditableHotkeyTarget(event.target))");
    expect(appSource).toContain("handleCardHoldStateChange(selectedCard.id");
    expect(appSource).toContain("handleCardCritiqueChange(selectedCard.id");
    expect(appSource).toContain("handleCardTextReviewedChange(selectedCard.id");
    expect(appSource).toContain('t("card_view.critique_quick_flag")');
    expect(shortcutCheatsheetSource).toContain('role="dialog"');
    expect(shortcutCheatsheetSource).toContain('aria-modal="true"');
    expect(shortcutCheatsheetSource).toContain('boxSizing: "border-box"');
    expect(shortcutCheatsheetSource).toContain('overflowWrap: "anywhere"');
    expect(shortcutCheatsheetSource).toContain('flexWrap: "wrap"');
    expect(shortcutCheatsheetSource).toContain('t("shortcut_cheatsheet.disabled_while_editing")');

    const viewControlsSource = readSource("src/ui/ViewControlsPanel.tsx");
    expect(viewControlsSource).toContain("aria-pressed={hierarchyLevel === item.id}");
  });

  it("UX-STATE-01: creating an island makes the new island the only primary selection", () => {
    const appSource = readSource("src/App.tsx");

    expect(appSource).toContain("const handleCreateIsland = useCallback");
    expect(appSource).toContain("setSelectedCardIds([]);");
    expect(appSource).toContain("setSelectedIslandId(newIsland.id);");

    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    expect(sidePanelSource).toContain("{hasCardSelection ? (");
  });

  it("UX-VISUAL-01: card state badges sit in a normal-flow meta-row above the body (no first-line overlap)", () => {
    const cardViewSource = readSource("src/canvas/CardView.tsx");

    // The meta-row is a normal-flow band ABOVE the body: badges no longer use
    // position:absolute over the body first line (ADR-0048 D1).
    expect(cardViewSource).toContain('data-card-meta-row=""');
    // claimType tints a 3px left band (color channel).
    expect(cardViewSource).toContain("borderLeft:");
    // Unreviewed marker is a small top-right dot (form channel), preserved.
    expect(cardViewSource).toContain('t("card_view.unreviewed")');
    // AC-3: far-LOD markers keep the needs-attention (unreviewed/critique) tint.
    expect(cardViewSource).toContain("markerNeedsAttention");
  });

  it("UX-VISUAL-01 AC-2: in-canvas legend is default-OFF with Escape/focus-return contract", () => {
    const legendSource = readSource("src/ui/CanvasLegend.tsx");
    expect(legendSource).toContain('data-ui-region="canvas-legend"');
    expect(legendSource).toContain('role="dialog"');
    expect(legendSource).toContain('if (event.key === "Escape")');
    expect(legendSource).toContain('t("legend.group.shortcuts")');
    expect(legendSource).toContain('t("legend.group.protection")');
    expect(legendSource).toContain('t("legend.item.protected")');
    expect(legendSource).toContain('kbd("H")');
    expect(legendSource).toContain('kbd("U")');
    expect(legendSource).toContain('kbd("R")');

    const appSource = readSource("src/App.tsx");
    // Default OFF (CB-1): the legend only renders behind explicit state.
    expect(appSource).toContain("const [isCanvasLegendOpen, setIsCanvasLegendOpen] = useState(false)");

    const viewControlsSource = readSource("src/ui/ViewControlsPanel.tsx");
    expect(viewControlsSource).toContain('data-focus-return-id="legend-trigger"');
    expect(viewControlsSource).toContain('t(showProtectionMarks ? "view_controls.protection.toggle_hide"');
    expect(viewControlsSource).toContain("onToggleProtectionMarks");
  });

  it("UX-VISUAL-02: protection markers can be hidden from View controls", () => {
    const appSource = readSource("src/App.tsx");
    const canvasShellSource = readSource("src/canvas/CanvasShell.tsx");
    const islandViewSource = readSource("src/canvas/IslandView.tsx");

    expect(appSource).toContain("const [showProtectionMarks, setShowProtectionMarks] = useState(true)");
    expect(appSource).toContain("showProtectionMarks={showProtectionMarks}");
    expect(appSource).toContain("showProtectionMarks &&");
    expect(islandViewSource).toContain("isProtected ? (");
  });

  it("UX-VISUAL-02: protection mark is deterministic, non-scoring, and toggleable", () => {
    const cardViewSource = readSource("src/canvas/CardView.tsx");
    expect(cardViewSource).toContain('t("card_view.protected")');

    // Detection is deterministic (lone-wolf gated on islands existing), not AI.
    const canvasShellSource = readSource("src/canvas/CanvasShell.tsx");
    expect(canvasShellSource).toContain("protectedCardIdSet");
    expect(canvasShellSource).toContain("document.islands.length === 0");

    // App owns the toggle; default ON but toggleable OFF (ADR-0048 D3, CB-1 self-report).
    const appSource = readSource("src/App.tsx");
    expect(appSource).toContain("const [showProtectionMarks, setShowProtectionMarks] = useState(true)");
    // Small-island threshold is a named, auditable constant (not a bare magic
    // number) and excludes degenerate 0-card islands.
    expect(appSource).toContain("const SMALL_ISLAND_MAX_MEMBERS = 2");
    expect(appSource).toContain("island.cardIds.length > 0 &&");

    // Card and island marks share one visual signature (dashed border + square
    // dot) so "protection" reads as a single channel, and the legend describes it.
    const islandViewSource = readSource("src/canvas/IslandView.tsx");
    expect(cardViewSource).toContain("1px dashed #94a3b8");
    expect(islandViewSource).toContain("1px dashed #94a3b8");
    const legendSource = readSource("src/ui/CanvasLegend.tsx");
    expect(legendSource).toContain('"legend.item.protected"');
  });

  it("PROV-VIS-01: AI provider status is read-only (no runtime switch UI) and lives in the View panel", () => {
    const viewControlsSource = readSource("src/ui/ViewControlsPanel.tsx");
    expect(viewControlsSource).toContain('"view_controls.ai_provider.title"');
    expect(viewControlsSource).toContain("providerKind");
    expect(viewControlsSource).toContain("lastAiCallOutcome");
    // Governance boundary (ADR-0050 D1): no <select>/onChange for provider,
    // and no fetch/mutation call from this display-only panel.
    expect(viewControlsSource).not.toMatch(/onProviderKindChange|onChangeProviderKind|setProviderKind/);

    const appSource = readSource("src/App.tsx");
    expect(appSource).toContain("const [providerKind, setProviderKind] = useState<ProviderKind | null>(null)");
    expect(appSource).toContain("getProviderStatus()");
  });

  it("UX-CMDK-01: command palette delegates to existing handlers, pins retention commands, and adds no persistent trigger", () => {
    const appSource = readSource("src/App.tsx");

    // AC-5: no permanent UI element opens the palette (CB-1); it is
    // opened only via the global Cmd/Ctrl+K listener.
    expect(appSource).toContain("const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)");
    expect(appSource.match(/data-ui-core-action=/g)).toHaveLength(7);

    // AC-3: defers to the OS/browser default while editing text elsewhere.
    expect(appSource).toContain("isStartPanelVisible || isEditableHotkeyTarget(event.target)");

    // Every registered command calls an EXISTING handler by reference —
    // no new business logic is introduced by the palette itself.
    expect(appSource).toContain("run: handleAddCard");
    expect(appSource).toContain("run: handleCreateIsland");
    expect(appSource).toContain("run: handleUndo");
    expect(appSource).toContain("run: handleRedo");
    expect(appSource).toContain("run: handleResetEmptyCanvasHint");
    expect(appSource).toContain("handleCardHoldStateChange(selectedCard.id,");

    // AC-1: Escape/backdrop cancel restores focus (ADR-0030); execution does not.
    expect(appSource).toContain("commandPaletteReturnFocusRef.current?.focus()");

    const paletteSource = readSource("src/ui/CommandPalette.tsx");
    expect(paletteSource).toContain('role="dialog"');
    expect(paletteSource).toContain("aria-activedescendant");
    // AC-4: retention ("hold") commands are pinned above all other categories.
    expect(paletteSource).toContain('a.category === "hold" ? 0 : 1');
    // No scoring/ranking vocabulary anywhere in the palette (reasserts D1's
    // anti-scoring stance for this new surface).
    expect(paletteSource).not.toMatch(/\bscore\b|\brank\b|\bpercent\b/i);
  });

  it("UX-SHORTCUT-01: retention keys (H/U/R) are selection-scoped, non-destructive, and do not regress existing bindings", () => {
    const appSource = readSource("src/App.tsx");

    // T1 collision audit (recorded here per the issue's own validation plan):
    // existing bindings are untouched. H/U/R are NEW plain-letter bindings;
    // 'r' already exists in useHotkeys.ts but ONLY inside the reading-path
    // feature (gated by onReadingPathToggleReviewedOnly, itself gated by
    // readingNavEnabled) — only the "r" branch here excludes readingNavEnabled
    // so the two "r" bindings are mutually exclusive, never both live.
    expect(appSource).toContain('lowerKey === "h"');
    expect(appSource).toContain('lowerKey === "u"');
    expect(appSource).toContain('lowerKey === "r"');
    expect(appSource).toContain("if (isEditableHotkeyTarget(event.target))");
    expect(appSource).toContain('lowerKey === "r" && !readingNavEnabled');
    // Existing bindings preserved verbatim (AC-5 non-regression).
    expect(appSource).toContain('lowerKey === "z" && !event.shiftKey');
    expect(appSource).toContain('event.key.toLowerCase() !== "k"');
    expect(appSource.match(/data-ui-core-action=/g)).toHaveLength(7);

    const hotkeysSource = readSource("src/hooks/useHotkeys.ts");
    expect(hotkeysSource).toContain('lowerKey === "r" && input.canReadingPathToggleReviewedOnly');

    // U is a SAFE toggle: it only ever adds/removes its own marker text and
    // never overwrites a critique the user authored themselves (一枚一志).
    expect(appSource).toContain("current === marker ? \"\" : current");

    // H/U/R delegate to existing handlers — no new document-mutation logic.
    expect(appSource).toContain("handleCardTextReviewedChange(selectedCard.id, selectedCard.textReviewed !== true)");
  });

  it("UX-SHORTCUT-01 AC-4: shortcut cheatsheet ('?') is default-OFF, OS-aware, and lists only shortcuts that actually exist", () => {
    const appSource = readSource("src/App.tsx");
    expect(appSource).toContain("const [isShortcutCheatsheetOpen, setIsShortcutCheatsheetOpen] = useState(false)");
    expect(appSource).toContain('event.key !== "?"');
    expect(appSource.match(/data-ui-core-action=/g)).toHaveLength(7);

    const cheatsheetSource = readSource("src/ui/ShortcutCheatsheet.tsx");
    expect(cheatsheetSource).toContain('role="dialog"');
    expect(cheatsheetSource).toContain("useMacNotation");
    expect(cheatsheetSource).toContain('t("shortcut_cheatsheet.disabled_while_editing")');
    // Only real, wired shortcuts are listed — nothing from the broader ADR-0048
    // wish-list (E=edit, ⌘D=duplicate, bare G=create island, L=relation line,
    // W=work mode, ⌘F/⌘.) that this codebase has not implemented. (Bare "N" is
    // legitimately listed under the reading-path group, which IS implemented.)
    expect(cheatsheetSource).not.toContain('shortcuts={["E"]}');
    expect(cheatsheetSource).not.toContain('shortcuts={["D"]}');
    expect(cheatsheetSource).not.toContain('shortcuts={["G"]}');
    expect(cheatsheetSource).not.toContain('shortcuts={["L"]}');
    expect(cheatsheetSource).not.toContain('shortcuts={["W"]}');
  });

  it("UX-MENU-01: menu bar consolidates flat header operations into 6 categories without a net increase in always-visible core actions", () => {
    const appSource = readSource("src/App.tsx");
    const menuBarSource = readSource("src/ui/MenuBar.tsx");
    const contextMenuSource = readSource("src/ui/ContextMenu.tsx");
    const recentDocumentsDialogSource = readSource("src/ui/RecentDocumentsDialog.tsx");

    // AC-1: the slim toolbar's 7 core actions are unchanged (the flat
    // low-frequency buttons that used to sit beside them moved into the
    // File/Edit menus instead of being added on top).
    expect(appSource.match(/data-ui-core-action=/g)).toHaveLength(7);

    // The 6 categories are fixed by ADR-0048 D2 Round 6 naming.
    expect(appSource).toContain('t("menu_bar.category.file")');
    expect(appSource).toContain('t("menu_bar.category.edit")');
    expect(appSource).toContain('t("menu_bar.category.card")');
    expect(appSource).toContain('t("menu_bar.category.view")');
    expect(appSource).toContain('t("menu_bar.category.work")');
    expect(appSource).toContain('t("menu_bar.category.share")');

    // Every item delegates to an EXISTING handler — no new business logic.
    expect(appSource).toContain("run: handleNewDocument");
    expect(appSource).toContain("run: handleUndo");
    expect(appSource).toContain("run: handleRedo");
    expect(appSource).toContain("run: handleDuplicateDocument");
    expect(appSource).toContain("run: handleDeleteSelection");
    expect(appSource).toContain("run: handleAddCard");
    expect(appSource).toContain("run: handleCreateIsland");
    expect(appSource).toContain("run: handleApplyBirdsEyePreset");
    expect(appSource).toContain("run: handleResetView");
    expect(appSource).toContain("run: handleToggleViewControls");
    expect(appSource).toContain("run: handleToggleWorkMode");
    expect(appSource).toContain("run: handleToggleSharePanel");
    expect(appSource).toContain("handleCardClaimTypeChange(selectedCard.id, claimType)");

    // Non-goal compliance: commands with no existing handler are NOT
    // invented (relation-line drawing, island dissolve, AI "tidy" layout,
    // minimap, first-time guide, CSV export, select-all all stay absent).
    expect(appSource).not.toContain("card-relation-line");
    expect(appSource).not.toContain("card-dissolve-island");
    expect(appSource).not.toContain("card-tidy-layout");
    expect(appSource).not.toContain("view-minimap");
    expect(appSource).not.toContain("view-first-time-guide");
    expect(appSource).not.toContain("file-export-csv");
    expect(appSource).not.toContain("edit-select-all");

    // Phase 5's toolbar-label anchors keep passing because the labels moved
    // into menu items rather than disappearing (re-asserted here for the
    // menu bar's own contract, independent of Phase 5's toolbar contract).
    // "open" (recent documents) went one step further under ADR-0052 AC-2:
    // it moved out of the File menu's role="menu" entirely into its own
    // dialog, since a <select> is a disallowed direct child of role="menu".
    expect(appSource).toContain('t("app.toolbar.new")');
    expect(recentDocumentsDialogSource).toContain('t("app.toolbar.open")');

    // WAI-ARIA menubar keyboard contract (arrow cycling, Home/End,
    // Escape-close-with-focus-return).
    expect(menuBarSource).toContain('role="menubar"');
    expect(menuBarSource).toContain('role="menu"');
    expect(menuBarSource).toContain('aria-haspopup="menu"');
    expect(menuBarSource).toContain('event.key === "ArrowRight"');
    expect(menuBarSource).toContain('event.key === "ArrowLeft"');
    expect(menuBarSource).toContain('event.key === "ArrowDown"');
    expect(menuBarSource).toContain('event.key === "ArrowUp"');
    expect(menuBarSource).toContain('event.key === "Home"');
    expect(menuBarSource).toContain('event.key === "End"');
    expect(menuBarSource).toContain('event.key === "Escape"');
    expect(menuBarSource).toContain("closeAndReturnFocus");

    // Canvas context menus follow the same keyboard-operable menu contract.
    expect(contextMenuSource).toContain("aria-label={ariaLabel}");
    expect(contextMenuSource).toContain('event.key === "ArrowDown"');
    expect(contextMenuSource).toContain('event.key === "ArrowUp"');
    expect(contextMenuSource).toContain('event.key === "Home"');
    expect(contextMenuSource).toContain('event.key === "End"');
    expect(contextMenuSource).toContain("restorePreviousFocus");
    expect(contextMenuSource).toContain("enabledItems()[0]?.focus()");
    expect(appSource).toContain("returnFocusTo={contextMenuReturnFocusRef.current}");

    // 390px collapse (Round 5 redline): below the fixed matrix's 768px
    // breakpoint, the 6 categories consolidate into a single trigger.
    expect(menuBarSource).toContain("COLLAPSE_WIDTH_PX = 768");
    expect(menuBarSource).toContain('t("menu_bar.collapsed_trigger")');

    // No scoring/ranking vocabulary anywhere in the menu bar (D1's
    // anti-scoring stance applies to every new surface, including this one).
    expect(menuBarSource).not.toMatch(/\bscore\b|\brank\b|\bpercent\b/i);
  });

  it("UX-SCALE-01 (a): minimap is a corner, collapsible, pointer-only navigation aid backed by persisted collapse state", () => {
    const minimapSource = readSource("src/ui/Minimap.tsx");
    const appSource = readSource("src/App.tsx");
    const storageSource = readSource("src/storage/minimap_collapsed.ts");

    // Corner placement + collapsible, per the Round 5 redline.
    expect(minimapSource).toContain('data-ui-region="minimap"');
    expect(minimapSource).toContain("AUTO_COLLAPSE_WIDTH_PX = 640");
    expect(minimapSource).toContain("loadMinimapCollapsed");
    expect(minimapSource).toContain("saveMinimapCollapsed");
    expect(storageSource).toContain("sui-sensemaking/minimap-collapsed");

    // Drag-to-pan delegates to the EXISTING camera-transform request API —
    // no new pan/zoom mutation logic.
    expect(minimapSource).toContain("onPan(nextPanX, nextPanY)");
    expect(appSource).toContain("requestCameraTransform({ panX, panY, zoom: canvasCamera.zoom })");

    // Cards render with the fixed ADR-0048 D1 claim-type colors (no new
    // color tokens invented for this surface).
    expect(minimapSource).toContain("CLAIM_TYPE_DOT_COLOR");
    expect(minimapSource).toContain('fact: "#166534"');

    // No scoring/ranking vocabulary anywhere in the minimap.
    expect(minimapSource).not.toMatch(/\bscore\b|\brank\b|\bpercent\b/i);
  });

  it("UX-SCALE-01 (b): bulk operations bar appears only for 2+ selected cards, pins retention ops leftmost, and applies each op as one history step", () => {
    const barSource = readSource("src/ui/BulkOperationsBar.tsx");
    const appSource = readSource("src/App.tsx");

    expect(barSource).toContain('data-ui-region="bulk-operations-bar"');
    expect(appSource).toContain("selectedCardIds.length >= 2");

    // Retention ops (hold/critique) appear before the type-change/bundle/
    // delete controls in source order, pinning them leftmost (CB-2).
    const holdIndex = barSource.indexOf("onToggleHold");
    const critiqueIndex = barSource.indexOf("onToggleCritique");
    const claimTypeIndex = barSource.indexOf("onChangeClaimType");
    const bundleIndex = barSource.indexOf("onBundleIntoIsland");
    const deleteIndex = barSource.indexOf("onDelete");
    expect(holdIndex).toBeGreaterThan(-1);
    expect(critiqueIndex).toBeGreaterThan(holdIndex);
    expect(claimTypeIndex).toBeGreaterThan(critiqueIndex);
    expect(bundleIndex).toBeGreaterThan(claimTypeIndex);
    expect(deleteIndex).toBeGreaterThan(bundleIndex);

    // aria-live count reuses the existing factual (non-evaluative) copy.
    expect(barSource).toContain('t("side_panel.selection.card_multiple"');
    expect(barSource).toContain('aria-live="polite"');
    expect(barSource).toContain('data-ui-region="bulk-critique-reason"');
    expect(barSource).toContain('t("bulk_ops_bar.add_critique_reason")');
    expect(appSource).toContain("const handleBulkAddCritiqueReason = useCallback");
    expect(appSource).toContain('t("app.history.card.critique_updated")');

    // Bundle-into-island and delete delegate to the EXISTING selection-
    // generic handlers (already one history step each) — no duplicated
    // mutation logic for those two.
    expect(appSource).toContain("onBundleIntoIsland={handleCreateIsland}");
    expect(appSource).toContain("onDelete={handleDeleteSelection}");

    // Bulk hold/critique/type-change each call applyDocumentChange exactly
    // once (a single reduce/map over the whole selection, not a per-card
    // handler loop that would create N history entries).
    expect(appSource).toContain("const handleBulkToggleHold = useCallback(");
    expect(appSource).toContain("const handleBulkToggleCritique = useCallback(");
    expect(appSource).toContain("const handleBulkClaimTypeChange = useCallback(");
    expect(appSource).toContain("selectedCardIds.reduce(");

    // The bulk critique toggle reuses the SAME safe-toggle marker logic as
    // the U key (一枚一志) — never overwrites authored text.
    expect(appSource).toContain('const marker = t("card_view.critique_quick_flag");');

    // No scoring/ranking vocabulary anywhere in the bulk-ops bar.
    expect(barSource).not.toMatch(/\bscore\b|\brank\b|\bpercent\b/i);

    // Design-QA conformance fix (2026-07-09): the count status div must set
    // whiteSpace: nowrap like the buttons beside it. Space-less Japanese
    // count text ("3件のカードを選択中") wraps one character per line if
    // this flex child is the one left without it when the bar is squeezed.
    const statusDivBlock = barSource.slice(barSource.indexOf('role="status"'), barSource.indexOf('role="status"') + 200);
    expect(statusDivBlock).toContain('whiteSpace: "nowrap"');
  });

  it("UX-LABEL-01: retention actions use canonical state, mark, note, and reason vocabulary", () => {
    const en = readSource("src/i18n/locales/en.json");
    const ja = readSource("src/i18n/locales/ja.json");

    expect(en).toContain('"bulk_ops_bar.toggle_hold": "Change hold state"');
    expect(en).toContain('"bulk_ops_bar.toggle_critique": "Change critique mark"');
    expect(en).toContain('"side_panel.context.critique": "Critique note"');
    expect(en).not.toContain("quick-flag");
    expect(en).not.toContain("Toggle feels-off");
    expect(ja).toContain('"bulk_ops_bar.toggle_hold": "保留状態を変更"');
    expect(ja).toContain('"bulk_ops_bar.toggle_critique": "違和感マークを変更"');
    expect(ja).toContain('"side_panel.context.critique": "違和感メモ"');
    expect(ja).not.toContain("クイックフラグ");
  });

  it("UX-SCALE-01 (c): island outlines are orthogonal (grid-occupancy), complexity is a structural count (not a score), and tidy is human-triggered and one undo step", () => {
    const outlineSource = readSource("src/domain/geometry/orthogonal_island_outline.ts");
    const appSource = readSource("src/App.tsx");
    const islandViewSource = readSource("src/canvas/IslandView.tsx");

    // The generator is axis-aligned (grid cell tracing), not a convex hull.
    expect(outlineSource).toContain("export function traceGridBoundary");
    expect(outlineSource).toContain("export function generateOrthogonalIslandOutline");
    expect(outlineSource).toContain("export function computeTidyIslandLayout");
    expect(appSource).not.toContain("computeConvexHull");
    expect(appSource).toContain("generateOrthogonalIslandOutline(memberCards)");

    // Complexity = (vertexCount - 4) / 2, shown only when non-zero (CB-1),
    // and framed explicitly as non-scoring in its own tooltip copy.
    expect(outlineSource).toContain("(points.length - 4) / 2");
    expect(islandViewSource).toContain("outlineComplexity > 0");
    expect(islandViewSource).toContain('t("canvas.island.outline_complexity_badge"');

    // Tidy is human-triggered (context menu + command palette), never
    // automatic, and applies as exactly one document/history step.
    expect(appSource).toContain("const handleTidyIsland = useCallback(");
    expect(appSource).toContain('t("context_menu.tidy_island")');
    expect(appSource).toContain('id: "tidy-island"');
    expect(appSource).toContain("selectedIslandId !== null");

    // No scoring/ranking vocabulary anywhere in the generator or its i18n
    // framing (ADR-0048 D3 anti-scoring applies to this new signal too).
    expect(outlineSource).not.toMatch(/\bscore\b|\brank\b|\bpercent\b/i);
  });

  it("preserves imported perspective presets across both view metadata export paths", () => {
    const appSource = readSource("src/App.tsx");

    expect(appSource).toContain(
      "const [perspectivePresets, setPerspectivePresets] = useState<PerspectivePreset[]>(DEFAULT_PERSPECTIVE_PRESETS)",
    );
    expect(appSource).toContain(
      "setPerspectivePresets(restorePerspectivePresets(metadata.viewState.perspectivePresets))",
    );
    expect(appSource.match(/perspectivePresets,/g)).toHaveLength(5);
  });

  it("QA-MONKEY-32: title editing and AI candidate adoption remain explicit and keyboard-safe", () => {
    const titleEditorSource = readSource("src/ui/DocumentTitleEditor.tsx");

    expect(titleEditorSource).toContain('type="button"');
    expect(titleEditorSource).toContain('t("document_title.edit_aria", { title: displayTitle })');
    expect(titleEditorSource).toContain('aria-labelledby="document-title-candidates-label"');
    expect(titleEditorSource).toContain('role="status"');
    expect(titleEditorSource).toContain('t("document_title.proposal_only_hint")');
    expect(titleEditorSource).toContain('t("document_title.adopt_candidate", { title: candidate })');
    expect(titleEditorSource).toContain("focusTitleDisplay();");
    expect(titleEditorSource).toContain("suggestButtonRef.current?.focus()");
  });

  it("SEC-AI-SAFEMODE-03: title suggestions exclude unreviewed island titles before certification", () => {
    const appSource = readSource("src/App.tsx");

    expect(appSource).toContain(".filter((island) => island.titleReviewed === true)");
    expect(appSource).toContain(".filter((c) => (c as { textReviewed?: boolean }).textReviewed === true)");
  });

  it("OPS-LLM-COST-03: opening View refreshes the operational provider snapshot", () => {
    const appSource = readSource("src/App.tsx");
    const openEffect = appSource.slice(
      appSource.indexOf("if (!isViewControlsOpen)"),
      appSource.indexOf("const headerViewControls"),
    );

    expect(openEffect).toContain("getProviderStatus()");
    expect(openEffect).toContain("setLlmCallCounts(callCounts)");
    expect(openEffect).toContain("setLlmTokenUsage(tokenUsage)");
  });

  it("routes tenant-scoped AI calls through the stale-session cleanup boundary", () => {
    const appSource = readSource("src/App.tsx");
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    const inquiryPanelSource = readSource("src/ui/InquiryJourneyPrototypePanel.tsx");
    const tenantScopedCalls = [
      "suggestLayout",
      "suggestMerges",
      "proposeIslandSummary",
      "recordProposalDecision",
      "summarizeIslandRelation",
      "checkNarrative",
      "generateNarrative",
    ];

    expect(appSource).toContain("const runTenantScopedApiRequest = useCallback(");
    expect(appSource).toContain("tenantSessionGenerationGuardRef.current.invalidate();");
    expect(appSource).toContain("tenantSessionGenerationGuardRef.current.run(task)");
    expect(appSource).toContain('error.code === "tenant_session_changed"');
    expect(appSource).toContain("blockStaleTenantSession();");
    for (const callName of tenantScopedCalls) {
      expect(appSource).toContain(
        `runTenantScopedApiRequest(() => ${callName}(`,
      );
    }
    expect(appSource).toContain(
      "runTenantScopedApiRequest(() => getDocument(",
    );
    expect(appSource).toContain(
      "runTenantScopedApiRequest(() => putDocument(",
    );
    expect(appSource).toContain(
      "runTenantScopedApiRequest(() => postExportAudit(",
    );
    expect(appSource).toContain(
      "runTenantScopedTask(() => diffWorkerClientRef.current!.computeDiff(",
    );
    expect(appSource).toContain(
      "runTenantScopedTask(() => diagnosticsWorkerClientRef.current!.computeDiagnostics(",
    );
    expect(appSource).toContain(
      "runTenantScopedTask(() => bundleRunnerRef.current.run(",
    );
    expect(
      appSource.match(
        /runTenantScopedOptionalTask\(\(\) => selectedFile\.text\(\)\)/g,
      ),
    ).toHaveLength(6);
    expect(appSource).toContain(
      "runTenantScopedOptionalTask(() => readZipFiles(selectedFile))",
    );
    expect(appSource).not.toContain("await selectedFile.text()");
    expect(appSource).not.toContain("await readZipFiles(selectedFile)");
    expect(
      appSource.match(
        /runTenantScopedOptionalTask\(\(\) => exportCanvasToPngBlob\(/g,
      ),
    ).toHaveLength(4);
    expect(appSource).toContain(
      "runTenantScopedOptionalTask(() => readBlobAsDataUrl(pngBlob))",
    );
    expect(appSource).toContain(
      "runTenantScopedOptionalTask(() => buildPatchForExport(",
    );
    expect(
      appSource.match(
        /runTenantScopedOptionalTask\(buildCurrentAgentTaskSheet\)/g,
      ),
    ).toHaveLength(3);
    expect(appSource).not.toContain("await exportCanvasToPngBlob(");
    expect(appSource).not.toContain("await buildPatchForExport(");
    const publicPackLoaderIndex = appSource.indexOf("const loadPublicPack = useCallback(");
    const publicPackViewFetchIndex = appSource.indexOf(
      "() => fetch(`./packs/${targetPack.viewPath}`",
      publicPackLoaderIndex,
    );
    const publicPackCommitIndex = appSource.indexOf(
      "pendingCardDragSnapshotRef.current = null;",
      publicPackLoaderIndex,
    );
    expect(publicPackLoaderIndex).toBeGreaterThanOrEqual(0);
    expect(publicPackViewFetchIndex).toBeGreaterThan(publicPackLoaderIndex);
    expect(publicPackCommitIndex).toBeGreaterThan(publicPackViewFetchIndex);
    expect(appSource).toContain('if (loadedFromPack === "stale")');
    expect(appSource).not.toContain('await fetch("./packs/');
    expect(appSource.match(/runTenantScopedOptionalTask=\{runTenantScopedOptionalTask\}/g)).toHaveLength(2);
    expect(sidePanelSource).toContain(
      "runTenantScopedOptionalTask(() => traceClient.computeTraceAnalytics(",
    );
    expect(sidePanelSource).toContain(
      "runTenantScopedOptionalTask(() => runTraceRequest(",
    );
    expect(inquiryPanelSource).toContain(
      "const outcome = await runTenantScopedOptionalTask(async () => (",
    );
    expect(inquiryPanelSource).not.toContain(
      "importClientRef.current.parse(await file.text()",
    );
    expect(appSource).toContain(
      '(error.status === 503 && error.code === "provider_unavailable")',
    );
  });

  it("UI-QUALITY-A11Y-05: reading order has native keyboard-operable step controls while pointer drag remains available", () => {
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    const readingOrderLayerSource = readSource("src/canvas/ReadingOrderLayer.tsx");
    const appSource = readSource("src/App.tsx");

    expect(sidePanelSource).toMatch(
      /<button[\s\S]{0,300}onMoveReadingOrderItem\(index, -1\);[\s\S]{0,200}disabled=\{index === 0\}/,
    );
    expect(sidePanelSource).toMatch(
      /<button[\s\S]{0,300}onMoveReadingOrderItem\(index, 1\);[\s\S]{0,250}disabled=\{index === readingOrderItems\.length - 1\}/,
    );
    expect(appSource).toContain("const handleMoveReadingOrderItem = useCallback(");
    expect(appSource).toContain('t("app.history.reading_order.reordered")');
    expect(readingOrderLayerSource).toContain("onPointerDown");
    expect(readingOrderLayerSource).toContain("onPointerMove");
    expect(readingOrderLayerSource).toContain("onPointerUp");
  });

  it("DOMAIN-KJ-01: KJ relation vocabulary is additive, unknown types are preserved (never discarded), and derived edges stay type-suppressed", () => {
    const typesSource = readSource("src/domain/types.ts");
    const validateSource = readSource("src/domain/validate.ts");
    const validateDocSource = readSource("src/domain/validate_doc.ts");
    const edgeLayerSource = readSource("src/canvas/EdgeLayer.tsx");
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    const appSource = readSource("src/App.tsx");

    // The known vocabulary is exactly the 5 values fixed by schemas.md §3.3
    // (negate IS the persisted value for 対立 — no separate "opposition").
    expect(typesSource).toContain('["related", "negate", "causal", "mutual", "equivalence"] as const');
    expect(typesSource).not.toContain('"opposition"');
    expect(typesSource).toContain("export function resolveKnownEdgeType");

    // Preservation (schemas.md §3.3.2): the old discard conditions must not
    // reappear in either mode. Lenient keeps any non-empty string type;
    // strict validates "non-empty string", not a closed enum.
    expect(validateSource).not.toContain('item.type !== "related" && item.type !== "negate"');
    expect(validateSource).toContain("item.type.length === 0");
    expect(validateDocSource).not.toContain('value === "related" || value === "negate"');
    expect(validateDocSource).toContain('typeof value === "string" && value.length > 0');

    // Rendering: direction/symbols only for NON-derived edges (derived stay
    // generic per UX-SCALE-01 redline, and their endpoint order is
    // normalized so an arrow could point the wrong way).
    expect(edgeLayerSource).toContain('edge.isDerived ? "related" : resolveKnownEdgeType(edge.type)');
    expect(edgeLayerSource).toContain('data-edge-symbol="arrow-to"');
    expect(edgeLayerSource).toContain('data-edge-symbol="arrow-from"');
    expect(edgeLayerSource).toContain('data-edge-symbol="equivalence"');

    // Type change is a single history step on a PERSISTED edge only, and the
    // default for new edges stays "related" (no forced convergence).
    expect(appSource).toContain("const handleEdgeTypeChange = useCallback(");
    expect(appSource).toContain('useState<KnownEdgeType>("related")');
    expect(sidePanelSource).toContain("selectedPersistedEdgeType");
    expect(sidePanelSource).toContain('t("side_panel.edge_inspector.unknown_type_preserved"');

    // No scoring/ranking vocabulary in the new relation-type surfaces.
    expect(edgeLayerSource).not.toMatch(/\bscore\b|\brank\b|\bpercent\b/i);
  });

  it("DOMAIN-TRACE-01: Card.meta stays fail-closed, selection-scoped, badge default OFF, and share-excluded by default", () => {
    const validateSource = readSource("src/domain/validate.ts");
    const validateDocSource = readSource("src/domain/validate_doc.ts");
    const bundleExportSource = readSource("src/export/bundle_export.ts");
    const sharePanelSource = readSource("src/ui/SharePanel.tsx");
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    const cardViewSource = readSource("src/canvas/CardView.tsx");
    const appSource = readSource("src/App.tsx");

    // Fail-closed meta parsing (schemas.md §15.3): only seq/source survive,
    // unknown keys are dropped in BOTH lenient and strict modes. This is the
    // deliberate inverse of the edge-type preservation rule.
    expect(validateSource).toContain("function parseCardMeta");
    expect(validateDocSource).toContain('hasOnlyKeys(item.meta, ["seq", "source"]');

    // Share boundary (schemas.md §15.4): meta is stripped from shared bundles
    // by default; the opt-in toggle renders regardless of safeMode (it is an
    // independent axis) and defaults to OFF with a one-line warning.
    expect(bundleExportSource).toContain("function resolveShareDocument");
    expect(bundleExportSource).toContain("includeSourceReferences?: boolean");
    expect(sharePanelSource).toContain('data-share-include-source-references=""');
    expect(sharePanelSource).toContain('data-share-source-references-warning=""');
    expect(sharePanelSource).toContain('data-share-preflight-source-references=""');
    expect(appSource).toContain("const [includeSourceReferencesInExport, setIncludeSourceReferencesInExport] = useState(false)");

    // Selection-only display (ADR-0048 D3改訂): trace info lives in the side
    // panel; the canvas badge is opt-in and default OFF.
    expect(sidePanelSource).toContain('data-panel="card-trace-summary"');
    expect(sidePanelSource).toContain('data-panel="card-trace-editor"');
    expect(cardViewSource).toContain('data-card-seq-badge=""');
    expect(appSource).toContain("const [showSeqNumbers, setShowSeqNumbers] = useState(false)");

    // Meta edit is a single history step (undoable) via applyDocumentChange.
    expect(appSource).toContain("const handleCardMetaChange = useCallback(");
    expect(appSource).toContain('t("app.history.card.meta_updated")');

    // No subject metadata (creator/author) sneaks into Card.meta ahead of
    // CARD-META-UI-01 — the meta whitelist stays exactly seq/source.
    // (ownerRef exists legitimately elsewhere: ReviewAttribution.)
    expect(validateSource).not.toMatch(/createdBy|authorId/);
    expect(validateDocSource).not.toMatch(/createdBy|authorId/);
    expect(validateDocSource.match(/hasOnlyKeys\(item\.meta, \["seq", "source"\]/g)).toHaveLength(1);
  });

  it("DOMAIN-EXPR-04: contradiction signal decisions are human-only, reversible, and reuse the CE2 proposal vocabulary (no new AI authority)", () => {
    const contradictionChecksSource = readSource("src/domain/view/contradiction_checks.ts");
    const validateSource = readSource("src/domain/validate.ts");
    const validateDocSource = readSource("src/domain/validate_doc.ts");
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    const appSource = readSource("src/App.tsx");

    // analyzeContradictions() itself never gains a write path for decisions —
    // it only computes signals. The signature helper lives alongside it.
    expect(contradictionChecksSource).toContain("export function signatureKeyForContradictionSignal");
    expect(contradictionChecksSource).not.toMatch(/ContradictionSignalDecision/);

    // Round-trip (both modes) is fail-closed, mirroring mergeSuggestionDecisions.
    expect(validateSource).toContain("function parseContradictionSignalDecisions");
    expect(validateDocSource).toContain("function validateContradictionSignalDecisionEntry");
    expect(validateDocSource).toContain('hasOnlyKeys(item, ["signatureKey", "status", "decidedAt"]');

    // "proposed" (undecided) is the implicit default and is never itself a
    // valid persisted status — CE2-PROPOSAL-IF vocabulary reused, not widened.
    expect(validateDocSource).toContain('value === "accepted" || value === "held" || value === "rejected"');

    // UI: signals always render regardless of decision (no auto-hide on reject),
    // and every write goes through applyDocumentChange as one history step.
    expect(sidePanelSource).toContain("const renderContradictionDecisionControls = (signal: ContradictionSignal)");
    expect(sidePanelSource).toContain('onContradictionSignalDecision(signatureKey, "accepted")');
    expect(sidePanelSource).toContain('onContradictionSignalDecision(signatureKey, "held")');
    expect(sidePanelSource).toContain('onContradictionSignalDecision(signatureKey, "rejected")');
    expect(sidePanelSource).toContain("onContradictionSignalDecision(signatureKey, null)");
    expect(appSource).toContain("const handleContradictionSignalDecision = useCallback(");
    expect(appSource).toContain('t("app.history.contradiction_signal.decided")');

    // No new EvidenceLink is fabricated from an island-level aggregate signal
    // (would misrepresent detector precision as a specific card-pair claim).
    expect(appSource).not.toMatch(/handleContradictionSignalDecision[\s\S]{0,400}upsertEvidenceLink/);
  });

  it("DOMAIN-KA-01: Card.ka (心の声/価値) stays fail-closed, separate from Card.text, off the canvas, and default-OFF in exports", () => {
    const validateSource = readSource("src/domain/validate.ts");
    const validateDocSource = readSource("src/domain/validate_doc.ts");
    const patchApplySource = readSource("src/domain/patch/patch_apply.ts");
    const readingOutlineSource = readSource("src/domain/view/reading_outline.ts");
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    const cardViewSource = readSource("src/canvas/CardView.tsx");
    const appSource = readSource("src/App.tsx");

    // Fail-closed parsing in all 3 round-trip paths (lenient/strict/CE3 patch),
    // mirroring the Card.meta precedent exactly.
    expect(validateSource).toContain("function parseCardKa");
    expect(validateDocSource).toContain('hasOnlyKeys(item.ka, ["voice", "value"]');
    expect(patchApplySource).toContain("value.ka !== undefined");

    // Card.text stays the sole event-of-record; ka is a separate field, never
    // merged into the body (AC: text=出来事の正本 unchanged).
    expect(sidePanelSource).toContain('data-panel="card-ka-editor"');
    expect(sidePanelSource).toContain("onCardKaChange(event.target.value, selectedCard.ka?.value ?? \"\")");

    // No canvas surface for ka (AC-4: no initial-view anchor growth).
    expect(cardViewSource).not.toMatch(/card\.ka\b/);

    // Export section is separate from narrative body and default OFF.
    expect(readingOutlineSource).toContain("function formatKaFields");
    expect(readingOutlineSource).toContain("appendKaFields?: boolean");
    expect(readingOutlineSource).toContain("options.appendKaFields ?? false");
    expect(appSource).toContain("const [outlineAppendKaFields, setOutlineAppendKaFields] = useState(false)");

    // Meta edit is a single history step (undoable) via applyDocumentChange.
    expect(appSource).toContain("const handleCardKaChange = useCallback(");
    expect(appSource).toContain('t("app.history.card.ka_updated")');
  });

  it("UX-SHARE-01: pre-share summary gate discloses counts (never a score), skips when empty, and returns focus on close", () => {
    const sharePanelSource = readSource("src/ui/SharePanel.tsx");

    // Gate intercepts the bundle export action itself.
    expect(sharePanelSource).toContain('data-panel="pre-share-summary-gate"');
    expect(sharePanelSource).toContain('role="alertdialog"');
    expect(sharePanelSource).toContain("setPendingBundleExportOptions(options)");
    expect(sharePanelSource).toContain("onExportBundleZip(pendingBundleExportOptions)");

    // AC-5: zero-count documents skip the gate rather than blocking export.
    expect(sharePanelSource).toContain("unreviewedTotal === 0 && domainExpressionSummary.critiqueTargets === 0 && domainExpressionSummary.contradictionLinks === 0");

    // AC-2 anti-scoring: the gate copy is a location-only count summary, not
    // a readiness score/percentage/evaluative label.
    expect(sharePanelSource).toContain("share.panel.pre_share_gate.summary");
    expect(sharePanelSource).not.toMatch(/pre_share_gate[\s\S]{0,300}(score|readiness|percent|%)/i);

    // AC-4: Escape and Back both return focus to the button that opened it
    // (same focus-return contract as the outer share panel).
    expect(sharePanelSource).toContain("closePreShareGate");
    expect(sharePanelSource).toContain("exportBundleButtonRef.current?.focus()");
    expect(sharePanelSource).toContain("handlePreShareGateKeyDown");

    // Design-QA conformance fix (2026-07-09): safeModeIndicator.label already
    // carries its own "SafeMode:"/"セーフモード:" prefix -- the gate must not
    // wrap it in a second translated label (regressed to "SafeMode: セーフ
    // モード: ON" once, caught by screenshot review).
    expect(sharePanelSource).toContain("{safeModeIndicator.label}</div>");
    expect(sharePanelSource).not.toContain("share.panel.pre_share_gate.safe_mode");
  });

  it("UI-QUALITY-A11Y-02: selection-context announces changes and reads type->hold->review->evidence; source-toggle warning is associated via aria-describedby", () => {
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    const sharePanelSource = readSource("src/ui/SharePanel.tsx");

    // Selection context: aria-live=polite on the region (spec: on selection,
    // the "current selection" heading gets a polite announcement).
    expect(sidePanelSource).toContain('data-panel="selection-context"');
    const selectionContextBlock = sidePanelSource.slice(
      sidePanelSource.indexOf('data-panel="selection-context"'),
      sidePanelSource.indexOf('data-panel="selection-context"') + 400,
    );
    expect(selectionContextBlock).toContain('aria-live="polite"');

    // Read order fixed to 型→保持系→確認→根拠 (claimType -> holdState ->
    // reviewState -> evidence), replacing the prior review->type->evidence->hold order.
    const claimTypeIndex = sidePanelSource.indexOf('t("side_panel.context.claim_type", { value: selectedCard.claimType })');
    const holdBriefIndex = sidePanelSource.indexOf('t("side_panel.context.hold_brief"');
    const reviewStateIndex = sidePanelSource.indexOf('t("side_panel.context.review_state", { value: selectedCardReviewState })');
    const evidenceBriefIndex = sidePanelSource.indexOf('t("side_panel.context.evidence_brief"');
    expect(claimTypeIndex).toBeGreaterThan(0);
    expect(claimTypeIndex).toBeLessThan(holdBriefIndex);
    expect(holdBriefIndex).toBeLessThan(reviewStateIndex);
    expect(reviewStateIndex).toBeLessThan(evidenceBriefIndex);

    // Share preflight: the source-reference toggle's warning is programmatically
    // associated, not just visually adjacent.
    expect(sharePanelSource).toContain("sourceReferencesWarningId");
    expect(sharePanelSource).toContain("aria-describedby={includeSourceReferences ? sourceReferencesWarningId : undefined}");
    expect(sharePanelSource).toContain("id={sourceReferencesWarningId}");
  });

  it("Phase 3: contextual-selection-panel", () => {
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");

    expect(sidePanelSource).toContain('data-ui-region="selection-context"');
    expect(sidePanelSource).toContain('data-panel="selection-context"');
    expect(sidePanelSource).toContain('t("side_panel.context.title")');
    expect(sidePanelSource).toContain('t("side_panel.context.review_state"');
    expect(sidePanelSource).toContain('data-panel-group="advanced"');
    expect(sidePanelSource).toContain('aria-expanded={isAdvancedPanelOpen ? "true" : "false"}');
    expect(sidePanelSource).toContain('onToggle={(event) => {');
  });

  it("Phase 4: panel-dismissal-focus-scope", () => {
    const sharePanelSource = readSource("src/ui/SharePanel.tsx");
    expect(sharePanelSource).toContain('data-focus-return-id="share-panel-trigger"');
    expect(sharePanelSource).toContain('data-panel="share-replay"');
    expect(sharePanelSource).toContain('if (event.key === "Escape")');

    const appSource = readSource("src/App.tsx");
    expect(appSource).toContain('data-focus-return-id="view-controls-trigger"');
    expect(appSource).toContain('data-panel="view"');
    expect(appSource).toContain('if (event.key === "Escape")');
  });

  it("Phase 5: primary-toolbar-task-prioritization", () => {
    const appSource = readSource("src/App.tsx");
    const shellSource = readSource("src/ui/Shell.tsx");
    const recentDocumentsDialogSource = readSource("src/ui/RecentDocumentsDialog.tsx");

    expect(appSource).toContain('data-ui-region="primary-flow"');
    expect(appSource).toContain('data-ui-complexity-tier="core-context"');
    expect(appSource).toContain('data-ui-complexity-tier="core-view"');
    expect(shellSource).toContain('data-ui-complexity-tier="core-share"');
    expect(appSource).toContain('data-ui-complexity-tier="core-toolbar"');
    expect(appSource).toContain('data-ui-complexity-tier="advanced-disclosure"');
    expect(appSource).toContain('data-ui-complexity-tier="advanced-content"');
    expect(appSource.match(/data-ui-core-action=/g)).toHaveLength(7);
    expect(appSource).toContain('t("app.toolbar.new")');
    // "open" (recent documents) moved into its own dialog under ADR-0052
    // AC-2 (a <select> is a disallowed direct child of role="menu").
    expect(recentDocumentsDialogSource).toContain('t("app.toolbar.open")');
    expect(appSource).toContain('t("app.toolbar.undo")');
    expect(appSource).toContain('t("app.toolbar.save")');
  });

  it("Phase 5b: work-mode surface owns advanced narrative and HIL panels", () => {
    const appSource = readSource("src/App.tsx");
    const workModePanelSource = readSource("src/ui/WorkModePanel.tsx");

    expect(appSource).toContain("const advancedWorkModeContent = (");
    expect(appSource).toContain("<WorkModePanel");
    expect(appSource).toContain('data-ui-core-action="work-mode"');
    expect(workModePanelSource).toContain('role="dialog"');
    expect(workModePanelSource).toContain('aria-modal="true"');
    expect(workModePanelSource).toContain("tabIndex={-1}");
    expect(workModePanelSource).toContain("onKeyDown={handlePanelKeyDown}");
    expect(workModePanelSource).toContain("function getFocusableElements");
    expect(workModePanelSource).toContain('event.key !== "Tab"');
    expect(workModePanelSource).toContain("closePanelAndRestoreFocus");

    const sidePanelStart = appSource.indexOf("sidePanel={");
    const sidePanelEnd = appSource.indexOf("selectedIsland={", sidePanelStart);
    const sidePanelCall = appSource.slice(sidePanelStart, sidePanelEnd);
    expect(sidePanelCall).not.toContain("topContent=");
    expect(sidePanelCall).not.toContain("NarrativesPanel");
    expect(sidePanelCall).not.toContain("WorkModeTabs");

    // UX-NAV-02: the 4 original sections plus a new diagnostics tab now live
    // inside a role=tablist WorkModeTabs container instead of being stacked
    // directly. Assert the tab content is still present (moved, not lost).
    const workModeStart = appSource.indexOf("const advancedWorkModeContent = (");
    const workModeEnd = appSource.indexOf("return (", workModeStart);
    const workModeContent = appSource.slice(workModeStart, workModeEnd);
    expect(workModeContent).toContain("<WorkModeTabs");
    expect(workModeContent).toContain("<NarrativesPanel");
    expect(workModeContent).toContain("<MergeSuggestionsPanel");
    expect(workModeContent).toContain("<SuggestionPanel");
    expect(workModeContent).toContain("{structuralDiffPanel}");
    expect(workModeContent).toContain('id: "diagnostics"');

    // design-qa conformance fix (2026-07-09): the empty-state copy shown when
    // Advanced UI is off must not point users back to "the sidebar" -- AC-2
    // moved these panels OUT of the sidebar into this same work-mode surface,
    // so the copy must say they appear here once Advanced UI is enabled.
    const jaLocaleSource = readSource("src/i18n/locales/ja.json");
    const jaContentPendingLine = jaLocaleSource.split("\n").find((line) => line.includes('"work_mode.content_pending"'));
    expect(jaContentPendingLine).not.toContain("サイドバー");
    expect(jaContentPendingLine).toContain("詳細");
  });

  it("EXT-AGENT-01: agent task export lives behind advanced disclosure, gates on scope confirmation, and never emits scoring vocabulary", () => {
    const appSource = readSource("src/App.tsx");
    const panelSource = readSource("src/ui/AgentTaskExportPanel.tsx");
    const exportSource = readSource("src/export/agent_task_export.ts");
    const clientSource = readSource("src/api/client.ts");

    // AC-5 (CB-1 no net increase to initial display): the trigger is CONTENT
    // behind the existing "詳細" disclosure gate, not a new always-visible
    // disclosure entry point -- so it must not carry data-ui-core-action
    // (Phase 5's fixed count of 7 already pins the core-toolbar surface).
    expect(appSource).toContain("<AgentTaskExportPanel");
    const triggerButtonStart = appSource.indexOf("ref={agentTaskExportTriggerRef}");
    const triggerButtonBlock = appSource.slice(Math.max(0, triggerButtonStart - 400), triggerButtonStart);
    expect(triggerButtonBlock).toContain("{isAdvancedUiEnabled ? (");
    expect(appSource.slice(triggerButtonStart, triggerButtonStart + 400)).toContain('data-ui-complexity-tier="advanced-content"');
    expect(appSource.slice(triggerButtonStart, triggerButtonStart + 400)).not.toContain("data-ui-core-action");
    expect(appSource.match(/data-ui-core-action=/g)).toHaveLength(7);

    // AC-2 (previewConfirmed-equivalent gate): export actions are disabled
    // until a scope-confirmed checkbox is checked, and the checkbox itself
    // is disabled without a selection (can't confirm an empty scope).
    expect(panelSource).toContain("const canExport = hasSelection && scopeConfirmed;");
    expect(panelSource).toContain("disabled={!canExport}");
    expect(panelSource).toContain("disabled={!hasSelection}");

    // AC-3 (SafeMode/unreviewed/source-reference defaults): unreviewed and
    // source-reference inclusion are both off by default and independently
    // toggled; unreviewed drafts are forced off whenever SafeMode is on.
    expect(exportSource).toContain("const includeUnreviewedDrafts = !safeMode && (input.options?.includeUnreviewedDrafts ?? false);");
    expect(exportSource).toContain("const includeSourceReferences = input.options?.includeSourceReferences ?? false;");
    expect(panelSource).toContain("{!safeMode ? (");

    // AC-1 (spec §3.3 fixed structure) + §4.2 anti-scoring: the generator's
    // own guardrail text is the only place score/rank/priority vocabulary is
    // allowed to appear (as a prohibition instruction to the agent).
    expect(exportSource).toContain('"## 依頼"');
    expect(exportSource).toContain('"## ガードレール"');
    expect(exportSource).toContain('"## 文脈"');
    expect(exportSource).toContain('"## 応答契約"');
    expect(exportSource).toContain('"## 相関ブロック"');
    const exportSourceWithoutGuardrailConstant = exportSource.replace(
      /export const AGENT_TASK_GUARDRAIL_TEXT =[\s\S]*?;\n/,
      "",
    );
    expect(exportSourceWithoutGuardrailConstant).not.toMatch(/score|rank|confidence|priority|readiness/i);

    // AC-4: export-audit is recorded with exportKind="agent-task" via the
    // existing backend contract (no new endpoint, per spec §8).
    expect(clientSource).toContain("export async function postExportAudit(");
    expect(clientSource).toContain("/docs/${docId}/export-audit");
    expect(appSource).toContain('exportKind: "agent-task"');

    // CARD-META-UI-01 is still Pending (confirmed via research this round) --
    // no submitter/author/last-editor identity field may appear anywhere.
    expect(exportSource).not.toMatch(/submitter|createdBy|lastEditedBy|authorRef|reviewerRef/i);
  });

  it("EXT-AGENT-02: agent response import parses/sanitizes safely, never auto-mutates the document, and adopts are individually undo-able", () => {
    const appSource = readSource("src/App.tsx");
    const panelSource = readSource("src/ui/AgentResponseImportPanel.tsx");
    const importSource = readSource("src/import/agent_response_import.ts");

    // AC-5/CB-1: behind advanced disclosure, not a new core-toolbar action.
    expect(appSource).toContain("<AgentResponseImportPanel");
    const triggerButtonStart = appSource.indexOf("ref={agentResponseImportTriggerRef}");
    const triggerButtonBlock = appSource.slice(Math.max(0, triggerButtonStart - 400), triggerButtonStart);
    expect(triggerButtonBlock).toContain("{isAdvancedUiEnabled ? (");
    expect(appSource.slice(triggerButtonStart, triggerButtonStart + 400)).toContain('data-ui-complexity-tier="advanced-content"');
    expect(appSource.slice(triggerButtonStart, triggerButtonStart + 400)).not.toContain("data-ui-core-action");
    expect(appSource.match(/data-ui-core-action=/g)).toHaveLength(7);

    // AC-6: parsing/reviewing never touches the document -- only a
    // per-proposal adopt does, and each adopt is exactly one
    // applyDocumentChange call (except merge_candidate, which stages into
    // the existing ephemeral mergeSuggestions review surface instead).
    expect(appSource).toContain("const handleParseAgentResponse = useCallback(async () => {");
    const parseBlockEnd = appSource.indexOf("const handleAdoptAgentImportedProposal");
    const parseBlock = appSource.slice(appSource.indexOf("const handleParseAgentResponse"), parseBlockEnd);
    expect(parseBlock).not.toContain("applyDocumentChange(");
    const adoptBlock = appSource.slice(parseBlockEnd, appSource.indexOf("const handleRejectAgentImportedProposal"));
    expect(adoptBlock.indexOf("recordExternalAgentProposalDecision(")).toBeLessThan(adoptBlock.indexOf("applyDocumentChange("));
    expect(adoptBlock).toContain('t("agent_response_import.audit_failed_status_message")');
    expect(appSource.match(/applyDocumentChange\(\{ \.\.\.document, islands: nextIslands \}, t\("app\.history\.agent_response\.island_title_imported"\)\)/g)).toHaveLength(1);
    expect(appSource).toContain('t("app.history.agent_response.narrative_imported")');
    expect(appSource).toContain('t("app.history.agent_response.patch_imported")');

    // §4.2 anti-scoring: forbidden fields are discarded/rejected, never
    // silently kept; strict mode is a hard reject, lenient discards+warns.
    expect(importSource).toContain('const FORBIDDEN_SCORING_FIELDS = ["score", "rank", "confidence", "priority"] as const;');
    expect(importSource).toContain('mode === "strict"');
    expect(importSource).toContain("forbidden_scoring_fields_discarded");

    // Import-sanitize boundary: every proposal string goes through
    // sanitizeMarkdownForDisplay, and the payload is size-capped the same
    // as one ZIP-imported text file (spec §5).
    expect(importSource).toContain('import { sanitizeMarkdownForDisplay } from "./markdown_sanitize";');
    expect(importSource).toContain("ZIP_MAX_TEXT_FILE_BYTES");

    // AC-3: orphaned proposals are kept and flagged, not discarded; a
    // baseDocSignature mismatch on a patch blocks the one-click adopt path
    // (routed to file export for the existing conflict/rediff flow instead).
    expect(appSource).toContain("function computeAgentProposalReviewFlags(");
    expect(appSource).toContain("orphaned: !(cardsExist || islandExists)");
    expect(panelSource).toContain("review.patchSignatureMismatch");
    expect(appSource).toContain("if (!review.patch || review.patchSignatureMismatch) break;");

    // patch.ops whitelist + delete_* warning badge (spec §4.2).
    expect(importSource).toContain("parsePatchOp");
    expect(importSource).toContain("patchHasDeleteOps");

    // AC-5 prompt-injection boundary: proposal text is plain string data
    // rendered as-is, never interpolated into any dynamic-execution path.
    expect(panelSource).not.toMatch(/dangerouslySetInnerHTML|eval\(|new Function\(/);

    // CARD-META-UI-01 is still Pending -- no submitter/author identity
    // field is surfaced from an imported response.
    expect(importSource).not.toMatch(/submitter|createdBy|lastEditedBy|authorRef|reviewerRef/i);
  });

  it("Phase 5c: domain detail filters and guided flow stay behind advanced disclosure", () => {
    const appSource = readSource("src/App.tsx");
    const sidePanelSource = readSource("src/ui/SidePanel.tsx");

    expect(sidePanelSource).toContain('data-panel="domain-detail-filters"');
    expect(sidePanelSource).toContain('data-panel="guided-flow"');
    expect(sidePanelSource).toContain('data-ui-complexity-tier="advanced-content"');
    expect(sidePanelSource).toContain("{isAdvancedUiEnabled ? (");
    expect(appSource).toContain("if (!isAdvancedUiEnabled) {");
    expect(appSource).toContain("setGuidedFlowEnabled(false);");
  });

  it("Phase 6: read-only-review-disables-edit-surfaces", () => {
    const appSource = readSource("src/App.tsx");
    expect(appSource).toContain("disabled={isReadOnly || isLoading || !document || isSuggesting}");
    expect(appSource).toContain("disabled={isReadOnly || isLoading || !document}");
    expect(appSource).toContain("disabled={isReadOnly || isLoading || !document || !canCreateIsland}");
    expect(appSource).toContain(
      "disabled={isReadOnly || isLoading || !document || (selectedCardIds.length === 0 && !selectedIslandId)}",
    );
    expect(appSource).toContain("disabled={isReadOnly || isLoading || !document || isSaving || !isDirty}");

    const sidePanelSource = readSource("src/ui/SidePanel.tsx");
    expect(sidePanelSource).toMatch(/value=\{selectedCard\.claimType \?\? "unknown"\}\s+disabled=\{isReadOnly\}/);
    expect(sidePanelSource).toMatch(/value=\{canonicalHoldState\(selectedCard\.holdState\) \?\? "active"\}\s+disabled=\{isReadOnly\}/);
    expect(sidePanelSource).toMatch(/disabled=\{isReadOnly\}/);
    expect(sidePanelSource).toMatch(/import.*ShelfPanel.*from/);
    expect(sidePanelSource).toMatch(/checked=\{selectedCard\.textReviewed === true\}\s+disabled=\{isReadOnly\}/);
    expect(sidePanelSource).toMatch(/value=\{selectedCard\.critique \?\? ""\}\s+disabled=\{isReadOnly\}/);
  });

  it("Phase 7: empty-canvas-onboarding-stays-operable", () => {
    const appSource = readSource("src/App.tsx");
    const emptyCanvasHintSource = readSource("src/ui/EmptyCanvasHint.tsx");
    const viewControlsPanelSource = readSource("src/ui/ViewControlsPanel.tsx");

    expect(appSource).toContain("loadEmptyCanvasHintCompleted");
    expect(appSource).toContain("cards: []");
    expect(appSource).toContain("const shouldShowEmptyCanvasHint =");
    expect(appSource).toContain("!isStartPanelVisible");
    expect(appSource).toContain("!isReadOnly");
    expect(appSource).toContain("!emptyCanvasHintCompleted");
    expect(appSource).toContain("(document?.cards.length ?? 0) === 0");
    expect(appSource).toContain("<EmptyCanvasHint");
    expect(appSource).toContain("markEmptyCanvasHintCompleted();");
    expect(appSource).toContain("onResetEmptyCanvasHint={handleResetEmptyCanvasHint}");
    expect(emptyCanvasHintSource).toContain('data-ui-region="empty-canvas-hint"');
    expect(emptyCanvasHintSource).toContain('aria-live="polite"');
    expect(emptyCanvasHintSource).not.toContain("autoFocus");
    expect(viewControlsPanelSource).toContain("emptyCanvasHintCompleted");
    expect(viewControlsPanelSource).toContain('t("view_controls.onboarding.reset_empty_canvas")');
  });

  it("shows registry state without enabling AI when the runtime provider is none", () => {
    const appSource = readSource("src/App.tsx");

    expect(appSource).toContain('providerKind !== null && providerKind !== "none"');
    expect(appSource).toContain("|| availableModels !== null");
  });
});
