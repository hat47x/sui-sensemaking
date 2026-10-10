import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

import {
  ApiError,
  checkNarrative,
  generateNarrative,
  getDocument,
  getProviderStatus,
  postExportAudit,
  putDocument,
  recordExternalAgentProposalDecision,
  recordProposalDecision,
  registerExternalAgentProposal,
  registerExternalAgentTask,
  fetchAvailableModels,
  proposeIslandSummary,
  proposeOpposingViewpoint,
  suggestDocumentTitle,
  suggestMerges,
  summarizeIslandRelation,
  suggestLayout,
  type IslandSummaryProposal,
  archiveDocument,
  unarchiveDocument,
  listDocuments,
  type AvailableModelItem,
  type AvailableModelUnavailableReason,
  type DocumentListItem,
  type MergeSuggestion,
  type NarrativeIssue,
  type NarrativeIssueReference,
  type OpposingViewpointProposal,
  type ProviderKind,
} from "./api/client";
import { CanvasShell } from "./canvas/CanvasShell";
import { ContextMenu, type ContextMenuItem } from "./ui/ContextMenu";
import { AppErrorBoundary, clearEvictedDocument, loadEvictedDocument } from "./ui/AppErrorBoundary";
import type { AggregatedEdgeMeta, CameraTransformRequest, CanvasCamera, FocusReference } from "./canvas/CanvasShell";
import { IslandView } from "./canvas/IslandView";
import { getEdgesToRender } from "./domain/edge_aggregate";
import { classifyAiProviderError, type AiProviderErrorKind } from "./domain/ai_provider_error";
import { alignSelectedCards, distributeSelectedCards, snapValueToGrid } from "./domain/layout_ops";
import { commitCardDrag } from "./domain/card_drag_commit";
import type { AlignDirection, DistributeDirection } from "./domain/layout_ops";
import { appendReadingOrderEntry, moveReadingOrderEntry, removeReadingOrderEntry } from "./domain/reading_order_ops";
import {
  addPolygonVertex,
  movePolygonVertex,
  removePolygonVertex,
} from "./domain/geometry/polygon_edit";
import { buildVersionTokenForCardIds, isPolygonShapeStale } from "./domain/geometry/polygon_stale";
import { computeTidyIslandLayout, generateOrthogonalIslandOutline } from "./domain/geometry/orthogonal_island_outline";
import { detectVoidCandidates } from "./domain/void_detection";
import { isTemporaryRevealEligible } from "./domain/visibility";
import { updateIslandSummaryWithHistory } from "./domain/summary_history_ops";
import { createRepresentativeMerge } from "./domain/representative_merge";
import {
  buildRepresentativeVisualCueAssetBundle,
  collectPortableVisualCueImageRefs,
  deleteUnreferencedRepresentativeVisualCueAssets,
  parseRepresentativeVisualCueAssetBundle,
  restoreRepresentativeVisualCueAssetBundle,
  stripPortableVisualCues,
  type RepresentativeVisualCueAssetBundleV1,
} from "./domain/representative_visual_cue_assets";
import { updateCardHoldStateAndShelf, type HoldStateSelection } from "./domain/hold_state_ops";
import { resolveDecisionOriginTrace, resolveRepresentativeOriginTrace } from "./domain/merge_traceability";
import { applyRecordedMergeSuggestionDecision } from "./domain/merge_suggestion_apply";
import { moveCardToIsland } from "./domain/island_edge_aggregate";
import { collectMergeCandidates } from "./domain/merge_candidates";
import {
  appendMergeSuggestionDecision,
  getLatestMergeSuggestionDecisionByGroup,
  type MergeSuggestionDecision,
} from "./domain/merge_suggestion_decisions";
import { isSourceCard, Document, DocumentV1, Island, Narrative, type CardKa, type CardMeta, type ContradictionSignalDecision, type ContradictionSignalReviewStatus, type CritiqueInput, type EvidenceLink, type KnownEdgeType, type Point, type RelationSummary, type ReproposalDiff } from "./domain/types";
import { KNOWN_EDGE_TYPES } from "./domain/types";
import { answerCardQualityQuestion, beginCardQualityRewrite, cardQualityRestoreTarget, openCardQualityAssist, type CardQualityAssistState, type CardQualityDecision } from "./domain/card_quality";
import { validateDocument } from "./import/schema_validation";
import { buildReadingOrderSnippets } from "./domain/snippet";
import { useHotkeys } from "./hooks/useHotkeys";
import { Shell } from "./ui/Shell";
import { SidePanel } from "./ui/SidePanel";
import { RepresentativeVisualCueAssetScopeProvider } from "./ui/RepresentativeVisualCueAssetScope";
import { SuggestionPanel } from "./ui/SuggestionPanel";
import { WorkModeTabs } from "./ui/WorkModeTabs";
import { SearchBar } from "./ui/SearchBar";
import { ViewControlsPanel } from "./ui/ViewControlsPanel";
import { MergeSuggestionsPanel } from "./ui/MergeSuggestionsPanel";
import { NarrativesPanel } from "./ui/NarrativesPanel";
import { WorkModePanel } from "./ui/WorkModePanel";
import { AgentTaskExportPanel } from "./ui/AgentTaskExportPanel";
import { RecentDocumentsDialog } from "./ui/RecentDocumentsDialog";
import { DocumentTitleEditor } from "./ui/DocumentTitleEditor";
import { EmptyCanvasHint } from "./ui/EmptyCanvasHint";
import { CanvasLegend } from "./ui/CanvasLegend";
import { Minimap } from "./ui/Minimap";
import { BulkOperationsBar } from "./ui/BulkOperationsBar";
import { CommandPalette, type PaletteCommand } from "./ui/CommandPalette";
import { ShortcutCheatsheet } from "./ui/ShortcutCheatsheet";
import { MenuBar, type MenuCategoryDef, type MenuRowDef } from "./ui/MenuBar";
import { formatModShortcut } from "./ui/os_shortcut_format";
import type { IslandRelationEdgeSelection } from "./domain/island_relation_explain";
import {
  buildRelationSummarySourceSignature,
  buildSummarizeIslandRelationPayload,
  getRelationSummaryBySourceSignature,
  upsertRelationSummaryWithHistory,
} from "./domain/relation_summary_ops";
import type { SuggestionMoveDiff } from "./canvas/SuggestionDiffLayer";
import { buildLocalReviewerRef, inferReviewerRefSource } from "./storage/current_reviewer";
import {
  assertAppStorageScopeStable,
  createAppBrowserStorage,
} from "./storage/app_browser_storage";
import type { TenantBrowserStorageScope } from "./storage/tenant_scope";
import type { TenantSessionContextV1 } from "./api/session_context";
import { createViewLocalePersistenceScope } from "./storage/view_locale_scope";
import { buildAbstractMapExport, exportAbstractMapHTML, exportAbstractMapMarkdown } from "./export/abstract_map_export";
import { downloadBlobFile, exportCanvasToPngBlob, readBlobAsDataUrl, type PngExportScale } from "./export/canvas_png";
import { exportCanvasToSVG } from "./export/canvas_svg";
import { downloadTextFile } from "./export/narrative_export";
import { buildAgentTaskSheet, type AgentTaskKind } from "./export/agent_task_export";
import {
  buildExternalProposalAuditId,
  fingerprintAgentProposal,
  parseAgentResponse,
  boundResolvedAgentImportedProposalReviews,
  type ImportedProposalReview,
  type AgentResponseImportMode,
  type ParsedAgentProposal,
} from "./import/agent_response_import";
import { recordAgentTaskExport, verifyAgentResponseCorrelation } from "./storage/agent_task_ledger";
import { buildExportViewMetadata, type ExportViewMetadata } from "./export/view_metadata";
import { buildBundleZipBlob, buildExportBundleWithWorkers, downloadBlobAsFile, formatBundleTimestamp, type BundleExportProgressStage } from "./export/bundle_export";
import { computeVisibleBounds, getCardWorldBounds, getIslandWorldBounds } from "./domain/geometry/bounds";
import {
  DEFAULT_LOD_THRESHOLDS,
  getLODLevel,
  isEffectivelyCollapsed,
  type LODLevel,
  type LODThresholds,
} from "./domain/view/lod";
import {
  applyIslandLodZoom,
  enforceMinZoomForBounds,
  fitToBounds,
  FOCUS_LOD_EPSILON,
  popFocusHistory,
  pickPrimaryFocusRef,
  pushFocusHistory,
  type FocusSnapshot,
} from "./domain/view/focus";
import { buildReadingList, clampReadingIndex, type ReadingItem, type ReadingMode } from "./domain/view/reading_path";
import { buildReadingOutlineMd } from "./domain/view/reading_outline";
import { clampMaxDepthToAvailable, maxDepthForHierarchyLevel, resolveHierarchyLevel, type HierarchyLevel } from "./domain/view/hierarchy_level";
import { collectHierarchyHiddenIslandIds, collectHierarchyPlacardHiddenCardIds } from "./domain/view/hierarchy_visibility";
import {
  ALL_DOMAIN_STATE_FILTER_KINDS,
  createEmptyDomainStateFilter,
  isDomainStateFilterActive,
  selectCardIdsByDomainState,
  toggleDomainStateFilter,
  type DomainStateFilterKind,
} from "./domain/view/state_filter";
import type { OutlineQualityReport } from "./domain/view/outline_quality";
import { generateRecommendations } from "./domain/view/recommendations";
import type { ContradictionReport, ContradictionSignal } from "./domain/view/contradiction_checks";
import type { DistributionReport } from "./domain/view/distribution_checks";
import type { ClaimType, ClaimTypeMixReport } from "./domain/view/claim_type_checks";
import type { EvidenceGapReport } from "./domain/view/evidence_gap_checks";
import type { BalanceFinding, DialecticBalanceReport } from "./domain/view/dialectic_balance";
import {
  buildEvidenceAdjacency,
  getEvidenceNeighborhood,
  type EvidenceOverlayMode,
} from "./domain/view/evidence_overlay";
import {
  computePerspectiveRendering,
  DEFAULT_PERSPECTIVE_PRESETS,
  PERSPECTIVE_MODE_VALUES,
  restorePerspectivePresets,
  type PerspectiveMode,
  type PerspectivePreset,
  type PerspectiveState,
} from "./domain/view/perspective";
import { DEFAULT_VIEW_PRESETS, migrateViewPresets, removeViewPreset, renameViewPreset, replaceViewPreset, resolveSummaryAbstractFromPatch, type ViewPatch, type ViewPreset } from "./domain/view/presets";
import { getPresetIdForViewMode, getViewModeForPresetId, type ViewMode } from "./domain/view/view_mode";
import { buildDefaultGuidedFlowSteps, getGuidedFlowStepIndex, type GuidedFlowStepId } from "./domain/view/guided_flow";
import {
  buildIslandVisibilityContractPayload,
  collectCollapsedIslandIds,
  collectInitiallyCollapsedIslandIds,
  getCollapsedHiddenCardIds,
} from "./domain/view/collapse_visibility";
import { setAllIslandsCollapsed, setIslandCollapsed } from "./domain/view/collapse_state";
import { ReviewDiffPanel } from "./ui/ReviewDiffPanel";
import { createHilRsClient } from "./domain/hil_rs_client";
import { HilRsRediffPreview } from "./ui/HilRsRediffPreview";
import { StartPanel } from "./ui/StartPanel";
import type { MergeItem } from "./diff/merge_items";
import { applyMergeTransaction, buildMergeAuditEntry } from "./diff/merge_apply";
import { evaluateMergeSelection } from "./diff/merge_dependencies";
import { type DomainExpressionShareSummary } from "./ui/SharePanel";
import { getSafeModeIndicator } from "./ui/safe_mode_status";
import { applyPatchWithResolutionsDetailed, getPatchOpEntityKey, parsePatchDocument, shouldBlockPatchApplyByLint, type PatchDocument, type PatchResolution } from "./domain/patch/patch_apply";
import { buildPatchForExport } from "./domain/patch/patch_generate";
import { verifyPatchFingerprint } from "./domain/patch/patch_fingerprint";
import type { TrustLabel } from "./domain/patch/patch_types";
import { detectPatchConflicts, type ConflictItem } from "./domain/patch/conflict_detect";
import { buildPatchSummary, formatPatchSummaryMarkdown } from "./domain/patch/patch_summary";
import { appendPatchApplyLog, formatPatchApplyLogEntryMarkdown } from "./domain/patch/patch_apply_log";
import { lintPatchAgainstCurrentDoc, type PatchLintIssue } from "./domain/patch/patch_lint";
import { applyFixesToPatch, proposeFixes, type FixProposal } from "./domain/patch/patch_fix";
import { parseDocumentJson } from "./import/document_import";
import { parseViewJson } from "./import/view_import";
import { appendMergeAuditLog, sanitizeMergeAuditLog, type MergeAuditEntry, type MergeAuditSource } from "./domain/view/audit_log";
import { appendMergeDecisionAuditEvent, createMergeDecisionAuditEvent, type MergeDecisionAuditEvent } from "./domain/merge/decision_audit_events";
import { appendReviewEvent, sanitizeReviewEvents, type ReviewEvent } from "./domain/view/review_events";
import { ZipImportError, detectReviewPackFiles, readZipFiles } from "./import/zip_import";
import { parseIntegrityManifest, verifyIntegrityManifest } from "./security/artifact_integrity";
import { validatePublicPackManifest } from "./import/public_pack_manifest";
import { sanitizeMarkdownForDisplay } from "./import/markdown_sanitize";
import { buildReadOnlyBlockedMessage, resolveReadOnlyFromSearch } from "./domain/policy/read_only";
import { DEFAULT_PACK_VISIBILITY, DEFAULT_VIEW_VISIBILITY, type PublishVisibility } from "./domain/policy/publish_visibility";
import { getActiveLocale, setActiveLocale, subscribeActiveLocaleChange, t } from "./i18n/translate";
import { resolveIslandDisplayTitle } from "./i18n/island_title";
import { resolveViewLocale } from "./i18n/view_locale_resolution";
import { resolvePublicPackIdFromSearch } from "./domain/policy/public_pack";
import { createCancelableTaskRunner } from "./utils/compute_scheduler";
import { createExportId } from "./utils/export_id";
import { DiffWorkerClient } from "./worker/diff_client";
import { DiagnosticsWorkerClient } from "./worker/diagnostics_client";
import type { DiagnosticsProgressStage } from "./worker/diagnostics_protocol";
import type { DiffProgressStage } from "./worker/diff_protocol";
import { cleanupAppRuntimeResources } from "./session/app_runtime_cleanup";
import { resolveAppTenantSession } from "./session/app_tenant_session";
import { requestTenantSessionTransition, type TenantSwitchUnsavedDecision } from "./session/tenant_switch_request";
import {
  installTenantSessionCoherenceBoundary,
  type TenantSessionCoherenceBoundary,
} from "./session/tenant_session_coherence";
import {
  StaleTenantSessionResultError,
  TenantSessionGenerationGuard,
} from "./session/tenant_session_generation";
import { TenantSessionControl } from "./ui/TenantSessionControl";
import { TenantChangeConfirmationDialog } from "./ui/TenantChangeConfirmationDialog";
import {
  TenantSessionBlockedView,
  TenantSessionLoadingView,
} from "./ui/TenantSessionBootstrapGate";
import { LazyPanelBoundary, useMountOnceOpened } from "./ui/LazyPanelBoundary";

// UX-PERF-01: advanced-feature panels not needed for the initial card
// creation/editing workflow are code-split out of the main chunk. Each
// resolves its module on first render via React.lazy; LazyPanelBoundary
// (Suspense + a small retry-on-failure ErrorBoundary, ./ui/LazyPanelBoundary)
// covers the async load at every render site below.
const SharePanel = lazy(() =>
  import("./ui/SharePanel").then((module) => ({ default: module.SharePanel })),
);
const PatchWorkspacePanel = lazy(() =>
  import("./ui/workspace/PatchWorkspacePanel").then((module) => ({ default: module.PatchWorkspacePanel })),
);
const InquiryJourneyPrototypePanel = lazy(() =>
  import("./ui/InquiryJourneyPrototypePanel").then((module) => ({ default: module.InquiryJourneyPrototypePanel })),
);
const RepresentativeVisualCuePrototypePanel = lazy(() =>
  import("./ui/RepresentativeVisualCuePrototypePanel").then((module) => ({ default: module.RepresentativeVisualCuePrototypePanel })),
);
const AgentResponseImportPanel = lazy(() =>
  import("./ui/AgentResponseImportPanel").then((module) => ({ default: module.AgentResponseImportPanel })),
);
const DiagnosticsBundlePanel = lazy(() =>
  import("./ui/DiagnosticsBundlePanel").then((module) => ({ default: module.DiagnosticsBundlePanel })),
);

const DEFAULT_DOCUMENT_ID = "doc_phase1_canvas";
// UX-VISUAL-02 (ADR-0048 D3): an island at or below this member count is a
// "small island" eligible for the protection mark (non-scoring; a bare
// threshold, not a rank).
const SMALL_ISLAND_MAX_MEMBERS = 2;
const PROPOSAL_AUDIT_TRAIL_LIMIT = 50;
const HISTORY_LIMIT = 50;
const GRID_SNAP_SIZE = 10;
const SUGGESTION_MOVE_THRESHOLD = 1;
const CARD_WIDTH = 220;
const CARD_HEIGHT = 80;

const SVG_VISIBLE_BOUNDS_PADDING = 64;
const FALLBACK_EXPORT_VIEWPORT = { width: 1280, height: 720 };

function buildFallbackCanvasCamera(document: DocumentV1): CanvasCamera {
  const viewportWidth = typeof window === "undefined" ? FALLBACK_EXPORT_VIEWPORT.width : Math.max(1, Math.round(window.innerWidth || FALLBACK_EXPORT_VIEWPORT.width));
  const viewportHeight = typeof window === "undefined" ? FALLBACK_EXPORT_VIEWPORT.height : Math.max(1, Math.round(window.innerHeight || FALLBACK_EXPORT_VIEWPORT.height));

  return {
    panX: document.transform.panX,
    panY: document.transform.panY,
    zoom: document.transform.zoom || 1,
    viewportWidth,
    viewportHeight,
  };
}

function getViewModeDisplayLabel(mode: ViewMode): string {
  if (mode === "review") return t("app.view_mode.review");
  if (mode === "summary") return t("app.view_mode.summary");
  return t("app.view_mode.explore");
}

function getEntityKindDisplayLabel(kind: "card" | "island"): string {
  return t(kind === "card" ? "app.entity.card" : "app.entity.island");
}

function describeRecoverableError(error: unknown): string {
  if (error instanceof ApiError) {
    return `HTTP ${error.status}: ${error.message}`;
  }

  if (error instanceof TypeError) {
    return t("app.status.error_detail_network");
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return t("app.status.error_detail_unknown");
}

/**
 * PROV-ERROR-01 (ADR-0050 D2): resolve a localized, code-aware message for an
 * AI-provider failure instead of surfacing the raw backend exception text
 * (e.g. "local request failed: Connection refused") verbatim to the user.
 * Falls back to `fallback` for non-provider errors.
 */
function resolveAiProviderErrorMessage(error: unknown, fallback: string): string {
  switch (classifyAiProviderError(error)) {
    case "disabled":
      return t("ai.provider_error.disabled");
    case "timeout":
      return t("ai.provider_error.timeout");
    case "validation":
      return t("ai.provider_error.validation");
    case "unavailable":
      return t("ai.provider_error.unavailable");
    default:
      return fallback;
  }
}

function formatLoadDocumentFailure(error: unknown): string {
  return t("app.status.load_failed_recovery", {
    detail: describeRecoverableError(error),
  });
}

function formatCreateDocumentFailure(error: unknown): string {
  return t("app.status.create_failed_recovery", {
    detail: describeRecoverableError(error),
  });
}

function formatSaveDocumentFailure(error: unknown): string {
  // ADR-0073 D2=A (第2反復): the server refuses writes to an archived document
  // with 423 Locked (code document_archived) -- fail-closed. Surface a clear,
  // actionable message instead of the raw HTTP/backtrace detail.
  if (error instanceof ApiError && error.status === 423 && error.code === "document_archived") {
    return t("app.status.save_archived_document");
  }
  return t("app.status.save_failed_recovery", {
    detail: describeRecoverableError(error),
  });
}

function getDiagnosticsStageDisplayLabel(stage: DiagnosticsProgressStage): string {
  return t(`app.status.diagnostics.stage.${stage}`);
}

function getDiffStageDisplayLabel(stage: DiffProgressStage): string {
  return t(`app.status.diff.stage.${stage}`);
}

function getBundleExportProgressStageLabel(stage: BundleExportProgressStage): string {
  if (stage === "diagnostics") return t("app.status.bundle.stage.diagnostics");
  if (stage === "evidence_trace") return t("app.status.bundle.stage.evidence_trace");
  if (stage === "contradiction_trace") return t("app.status.bundle.stage.contradiction_trace");
  return t("app.status.bundle.stage.trace_analytics");
}

function getWorkspaceDecisionDisplayLabel(decision: string | undefined): string {
  if (decision === "adopt") return t("patch_workspace.decision.adopt");
  if (decision === "reject") return t("patch_workspace.decision.reject");
  if (decision === "hold") return t("patch_workspace.decision.hold");
  return t("patch_workspace.decision.none");
}

function getWorkspaceScopeDisplayLabel(scope: "all" | "selection" | "island"): string {
  if (scope === "selection") return t("patch_workspace.scope.selection");
  if (scope === "island") return t("patch_workspace.scope.island");
  return t("patch_workspace.scope.all");
}

function isPerspectiveModeValue(value: unknown): value is PerspectiveMode {
  return typeof value === "string" && PERSPECTIVE_MODE_VALUES.includes(value as PerspectiveMode);
}

function clampEvidenceOverlayDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }

  return Math.max(1, Math.min(3, Math.floor(value)));
}


function isEditableHotkeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  return target.isContentEditable;
}

function sanitizePerspectiveState(
  perspective: unknown,
  fallback: PerspectiveState,
): PerspectiveState {
  if (!perspective || typeof perspective !== "object") {
    return fallback;
  }

  const candidate = perspective as Record<string, unknown>;
  const mode = isPerspectiveModeValue(candidate.mode) ? candidate.mode : fallback.mode;
  const strictFilter = typeof candidate.strictFilter === "boolean" ? candidate.strictFilter : fallback.strictFilter;
  const next: PerspectiveState = { mode, strictFilter };

  if (typeof candidate.lodEnabled === "boolean") {
    next.lodEnabled = candidate.lodEnabled;
  }

  const prefs = candidate.evidenceOverlayPrefs;
  if (prefs && typeof prefs === "object") {
    const prefsRecord = prefs as Record<string, unknown>;
    const modeValue = prefsRecord.mode;
    const scopeValue = prefsRecord.scope;
    if (
      (modeValue === "supports" || modeValue === "contradicts" || modeValue === "both")
      && (scopeValue === "all" || scopeValue === "selection")
      && typeof prefsRecord.dimOthers === "boolean"
    ) {
      next.evidenceOverlayPrefs = {
        mode: modeValue,
        scope: scopeValue,
        dimOthers: prefsRecord.dimOthers,
        depth: clampEvidenceOverlayDepth(prefsRecord.depth),
      };
    }
  }

  return next;
}

function sanitizeViewPatch(value: unknown): ViewPatch {
  if (!value || typeof value !== "object") {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const viewPatch: ViewPatch = {};
  if (typeof candidate.summaryView === "boolean") viewPatch.summaryView = candidate.summaryView;
  if (typeof candidate.abstractMapView === "boolean") viewPatch.abstractMapView = candidate.abstractMapView;
  if (typeof candidate.hideSourceCards === "boolean") viewPatch.hideSourceCards = candidate.hideSourceCards;
  if (candidate.hierarchyLevel === "overview" || candidate.hierarchyLevel === "mid" || candidate.hierarchyLevel === "detail") {
    viewPatch.hierarchyLevel = candidate.hierarchyLevel;
  }
  if (candidate.maxDepth === "all" || typeof candidate.maxDepth === "number") viewPatch.maxDepth = candidate.maxDepth;
  if (candidate.focusIslandId === null || typeof candidate.focusIslandId === "string") viewPatch.focusIslandId = candidate.focusIslandId;
  if (typeof candidate.showReadingOrder === "boolean") viewPatch.showReadingOrder = candidate.showReadingOrder;
  if (typeof candidate.readingNavEnabled === "boolean") viewPatch.readingNavEnabled = candidate.readingNavEnabled;
  if (candidate.readingMode === "islands" || candidate.readingMode === "islands+cards") viewPatch.readingMode = candidate.readingMode;
  if (typeof candidate.reviewedOnly === "boolean") viewPatch.reviewedOnly = candidate.reviewedOnly;
  if (Array.isArray(candidate.collapsedIslandIds) && candidate.collapsedIslandIds.every((item) => typeof item === "string")) viewPatch.collapsedIslandIds = [...candidate.collapsedIslandIds];
  if (typeof candidate.safeMode === "boolean") viewPatch.safeMode = candidate.safeMode;
  if (typeof candidate.lodEnabled === "boolean") viewPatch.lodEnabled = candidate.lodEnabled;
  if (isPerspectiveModeValue(candidate.perspectiveMode)) viewPatch.perspectiveMode = candidate.perspectiveMode;
  if (typeof candidate.perspectiveStrictFilter === "boolean") viewPatch.perspectiveStrictFilter = candidate.perspectiveStrictFilter;

  return viewPatch;
}

function sanitizeViewPresets(value: unknown): ViewPreset[] {
  if (!Array.isArray(value)) {
    return migrateViewPresets([]);
  }

  const valid: ViewPreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
      continue;
    }

    valid.push({
      id: candidate.id,
      name: candidate.name,
      viewPatch: sanitizeViewPatch(candidate.viewPatch),
      createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
      updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
    });
  }

  return migrateViewPresets(valid);
}

type DocumentHistory = {
  past: DocumentV1[];
  present: DocumentV1;
  future: DocumentV1[];
};

type MergeSuggestionDraft = MergeSuggestion & {
  editedText: string;
  isEdited: boolean;
  latestDecision?: MergeSuggestionDecision;
  latestDecidedAt?: string;
  latestSelectedCardIds?: string[];
  representativeCardId?: string;
  representativeResolvedBy?: "repOf" | "mergedIntoCardId" | "fallback" | "unresolved";
  representativeSourceCount?: number;
};

type PendingImportedDocument = {
  fileName: string;
  document: DocumentV1;
};

type PendingPatchImport = {
  fileName: string;
  originalPatch: PatchDocument;
  patch: PatchDocument;
};

type PatchPreviewItem = {
  opId: string;
  kind: string;
  entityKey: string;
  checked: boolean;
  canToggle: boolean;
  conflict: boolean;
  lintIssueCount: number;
  lintErrorCount: number;
  lintIssueCodes: string[];
  reason?: string;
  baseSnippet?: string;
  yourSnippet?: string;
  theirSnippet?: string;
  resolution?: PatchResolution;
};


type EdgeEndpointKind = "card" | "island";

type EdgeConnectSource = {
  id: string;
  kind: EdgeEndpointKind;
};

type FocusTarget = {
  focusIslandId?: string;
};

type ViewMaxDepth = number | "all";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapComparisonPayload(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  if ("document" in value) {
    return value.document;
  }

  if ("snapshot" in value && isRecord(value.snapshot) && "document" in value.snapshot) {
    return value.snapshot.document;
  }

  return value;
}

function parseComparisonRelationSummaries(value: unknown): DocumentV1["relationSummaries"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const relationSummaries: NonNullable<DocumentV1["relationSummaries"]> = [];

  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      continue;
    }

    relationSummaries.push({
      id: entry.id,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
      islandAId: typeof entry.islandAId === "string" ? entry.islandAId : "",
      islandBId: typeof entry.islandBId === "string" ? entry.islandBId : "",
      relationType:
        entry.relationType === "unknown" ||
        (typeof entry.relationType === "string" && (KNOWN_EDGE_TYPES as readonly string[]).includes(entry.relationType))
          ? (entry.relationType as RelationSummary["relationType"])
          : "unknown",
      derived: typeof entry.derived === "boolean" ? entry.derived : false,
      text: typeof entry.text === "string" ? entry.text : "",
      reviewed: typeof entry.reviewed === "boolean" ? entry.reviewed : false,
      groundingCardIds:
        Array.isArray(entry.groundingCardIds) && entry.groundingCardIds.every((item) => typeof item === "string")
          ? entry.groundingCardIds
          : [],
      groundingEdgeIds:
        Array.isArray(entry.groundingEdgeIds) && entry.groundingEdgeIds.every((item) => typeof item === "string")
          ? entry.groundingEdgeIds
          : [],
      warnings: Array.isArray(entry.warnings) ? entry.warnings.filter((item): item is string => typeof item === "string") : undefined,
      sourceSignature: typeof entry.sourceSignature === "string" ? entry.sourceSignature : entry.id,
    });
  }

  return relationSummaries;
}

function parseComparisonEvidenceLinks(value: unknown): DocumentV1["evidenceLinks"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const links: NonNullable<DocumentV1["evidenceLinks"]> = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.fromCardId !== "string" || typeof entry.toCardId !== "string") {
      continue;
    }

    if (entry.type !== "supports" && entry.type !== "contradicts") {
      continue;
    }

    links.push({
      id: entry.id,
      type: entry.type,
      fromCardId: entry.fromCardId,
      toCardId: entry.toCardId,
      note: typeof entry.note === "string" ? entry.note : undefined,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : undefined,
      ...(entry.contradictionState === "unconfirmed"
        || entry.contradictionState === "confirmed"
        || entry.contradictionState === "held"
        || entry.contradictionState === "resolved"
        ? { contradictionState: entry.contradictionState }
        : {}),
    });
  }

  return links;
}

function extractComparisonDocument(value: unknown): { ok: true; document: DocumentV1 } | { ok: false; error: string } {
  const payload = unwrapComparisonPayload(value);
  const validated = validateDocument(payload);
  if (!validated.ok) {
    const message = validated.errors.map((error) => `[${error.code}] ${error.path}: ${error.message}`).join("\n");
    return { ok: false, error: message };
  }

  if (!isRecord(payload)) {
    return { ok: true, document: validated.value };
  }

  const islandPatchById = new Map<string, { summaryText?: string; summaryReviewed?: boolean }>();
  if (Array.isArray(payload.islands)) {
    for (const island of payload.islands) {
      if (!isRecord(island) || typeof island.id !== "string") {
        continue;
      }

      const patch: { summaryText?: string; summaryReviewed?: boolean } = {};
      if (typeof island.summaryText === "string") {
        patch.summaryText = island.summaryText;
      }
      if (typeof island.summaryReviewed === "boolean") {
        patch.summaryReviewed = island.summaryReviewed;
      }
      islandPatchById.set(island.id, patch);
    }
  }

  return {
    ok: true,
    document: {
    ...validated.value,
    islands: validated.value.islands.map((island) => ({
      ...island,
      ...(islandPatchById.get(island.id) ?? {}),
    })),
    readingOrder:
      Array.isArray(payload.readingOrder) && payload.readingOrder.every((entryId) => typeof entryId === "string")
        ? payload.readingOrder
        : validated.value.readingOrder ?? [],
    relationSummaries: parseComparisonRelationSummaries(payload.relationSummaries),
    evidenceLinks: parseComparisonEvidenceLinks(payload.evidenceLinks),
  },
  };
}



function clipSnippet(value: string | undefined, maxLength = 80): string {
  const text = (value ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}…`;
}

function buildDomainExpressionShareSummary(document: DocumentV1 | null): DomainExpressionShareSummary {
  if (!document) {
    return {
      unreviewedCards: 0,
      unreviewedIslands: 0,
      holdCards: 0,
      critiqueTargets: 0,
      evidenceLinks: 0,
      contradictionLinks: 0,
      evidenceGapCards: 0,
    };
  }

  const evidenceLinks = document.evidenceLinks ?? [];
  const linkedCardIds = new Set<string>();
  for (const link of evidenceLinks) {
    linkedCardIds.add(link.fromCardId);
    linkedCardIds.add(link.toCardId);
  }

  const unreviewedCards = document.cards.filter((card) => card.textReviewed !== true).length;
  const unreviewedIslands = document.islands.filter((island) => island.summaryText && island.summaryReviewed !== true).length;
  const holdCards = document.cards.filter((card) => (card.claimType ?? "unknown") === "unknown").length;
  const critiqueTargets = document.cards.filter((card) => Boolean(card.critique?.trim()) || (card.critiqueTags ?? []).length > 0).length
    + document.islands.filter((island) => Boolean(island.critique?.trim()) || (island.critiqueTags ?? []).length > 0).length
    + (document.critiqueInputs ?? []).length;
  const evidenceGapCards = document.cards.filter((card) => {
    const claimType = card.claimType ?? "unknown";
    return (claimType === "claim" || claimType === "hypothesis") && !linkedCardIds.has(card.id);
  }).length;

  return {
    unreviewedCards,
    unreviewedIslands,
    holdCards,
    critiqueTargets,
    evidenceLinks: evidenceLinks.length,
    contradictionLinks: evidenceLinks.filter((link) => link.type === "contradicts").length,
    evidenceGapCards,
  };
}

function formatPatchEntitySnippet(value: unknown, safeMode: boolean): string {
  if (safeMode) {
    return "[REDACTED]";
  }
  if (!value || typeof value !== "object") {
    return "(none)";
  }

  if ("text" in value && "x" in value && "y" in value) {
    const card = value as { text?: string; x?: number; y?: number };
    return `text:${clipSnippet(card.text)} @(${String(card.x ?? "?")}, ${String(card.y ?? "?")})`;
  }

  if ("cardIds" in value && ("title" in value || "summaryText" in value)) {
    const island = value as { title?: string; summaryText?: string; cardIds?: string[] };
    return `title:${clipSnippet(island.title)} / summary:${clipSnippet(island.summaryText)} / members:${island.cardIds?.length ?? 0}`;
  }

  if ("fromId" in value && "toId" in value && "type" in value) {
    const edge = value as { fromId?: string; toId?: string; type?: string };
    return `${edge.fromId ?? "?"} -> ${edge.toId ?? "?"} (${edge.type ?? "?"})`;
  }

  if ("sourceSignature" in value && "text" in value && "reviewed" in value) {
    const summary = value as { text?: string; reviewed?: boolean; sourceSignature?: string };
    return `${summary.sourceSignature ?? "?"} / ${clipSnippet(summary.text)} / reviewed:${String(summary.reviewed)}`;
  }

  return clipSnippet(JSON.stringify(value));
}

function buildPatchPreviewItems(
  patch: PatchDocument,
  selectedOpIdSet: Set<string>,
  conflictByOpId: Map<string, ConflictItem>,
  resolutions: Record<string, PatchResolution>,
  lintIssuesByOpId: Map<string, PatchLintIssue[]>,
  safeMode: boolean
): PatchPreviewItem[] {
  return patch.ops.map((op) => {
    const conflict = conflictByOpId.get(op.id);
    const lintIssues = lintIssuesByOpId.get(op.id) ?? [];

    return {
      opId: op.id,
      kind: op.kind,
      entityKey: getPatchOpEntityKey(op),
      checked: selectedOpIdSet.has(op.id),
      canToggle: !conflict,
      conflict: Boolean(conflict),
      lintIssueCount: lintIssues.length,
      lintErrorCount: lintIssues.filter((item) => item.severity === "error").length,
      lintIssueCodes: lintIssues.map((item) => item.code),
      reason: conflict?.reason,
      baseSnippet: conflict ? formatPatchEntitySnippet(conflict.baseValue, safeMode) : undefined,
      yourSnippet: conflict ? formatPatchEntitySnippet(conflict.yourValue, safeMode) : undefined,
      theirSnippet: conflict ? formatPatchEntitySnippet(conflict.theirValue, safeMode) : undefined,
      resolution: conflict ? resolutions[op.id] : undefined,
    };
  });
}

function createDefaultDocument(docId: string): DocumentV1 {
  const now = new Date().toISOString();

  return {
    version: 1,
    id: docId,
    title: "Phase 1 Canvas Sample",
    createdAt: now,
    updatedAt: now,
    transform: {
      panX: 0,
      panY: 0,
      zoom: 1,
    },
    cards: [
      {
        id: "card_1",
        text: "インタビュー後、メモがチャットの奥に流れて、見つけ直すのに時間がかかった。",
        x: 80,
        y: 60,
      },
      {
        id: "card_2",
        text: "結論は残っているのに、どの発言を根拠にしたのか後から分からなくなった。",
        x: 380,
        y: 180,
      },
      {
        id: "card_3",
        text: "一人だけ違う意見だったので、そのまま議事録から落ちた。",
        x: 220,
        y: 360,
      },
    ],
    edges: [],
    islands: [],
    readingOrder: [],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

function createNewDocument(docId: string): DocumentV1 {
  const now = new Date().toISOString();

  return {
    version: 1,
    id: docId,
    title: "Untitled",
    createdAt: now,
    updatedAt: now,
    transform: {
      panX: 0,
      panY: 0,
      zoom: 1,
    },
    cards: [],
    edges: [],
    islands: [],
    narratives: [],
    evidenceLinks: [],
    mergeSuggestionDecisions: [],
  };
}

function duplicateDocumentWithNewId(sourceDocument: DocumentV1): DocumentV1 {
  const now = new Date().toISOString();

  return {
    ...cloneDocument(sourceDocument),
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeDocument(document: Document): DocumentV1 {
  return {
    ...document,
    readingOrder: document.readingOrder ?? [],
    narratives: document.narratives ?? [],
    evidenceLinks: document.evidenceLinks ?? [],
    mergeSuggestionDecisions: document.mergeSuggestionDecisions ?? [],
  };
}

function withUpdatedTimestamp(document: DocumentV1): DocumentV1 {
  return {
    ...document,
    updatedAt: new Date().toISOString(),
  };
}

function cloneDocument(document: DocumentV1): DocumentV1 {
  return structuredClone(document);
}

function markSuggestedFieldsUnreviewed(document: DocumentV1, baseDocument: DocumentV1): DocumentV1 {
  const baseCardsById = new Map(baseDocument.cards.map((card) => [card.id, card]));
  const baseIslandsById = new Map(baseDocument.islands.map((island) => [island.id, island]));

  return {
    ...document,
    cards: document.cards.map((card) => ({
      ...card,
      textReviewed:
        !baseCardsById.has(card.id) || baseCardsById.get(card.id)?.text !== card.text
          ? false
          : baseCardsById.get(card.id)?.textReviewed,
    })),
    islands: document.islands.map((island) => ({
      ...island,
      titleReviewed:
        !baseIslandsById.has(island.id) || baseIslandsById.get(island.id)?.title !== island.title
          ? false
          : baseIslandsById.get(island.id)?.titleReviewed,
      imageReviewed:
        !baseIslandsById.has(island.id) || baseIslandsById.get(island.id)?.imageUrl !== island.imageUrl
          ? false
          : baseIslandsById.get(island.id)?.imageReviewed,
      summaryReviewed:
        !baseIslandsById.has(island.id) || baseIslandsById.get(island.id)?.summaryText !== island.summaryText
          ? false
          : baseIslandsById.get(island.id)?.summaryReviewed,
    })),
  };
}

function pushHistorySnapshot(history: DocumentHistory, nextDocument: DocumentV1): DocumentHistory {
  const nextPast = [...history.past, cloneDocument(history.present)];
  const trimmedPast = nextPast.length > HISTORY_LIMIT ? nextPast.slice(nextPast.length - HISTORY_LIMIT) : nextPast;

  return {
    past: trimmedPast,
    present: cloneDocument(nextDocument),
    future: [],
  };
}

function createIslandFromSelection(selectedCardIds: string[]): Island {
  return {
    id: crypto.randomUUID(),
    cardIds: selectedCardIds,
    collapsed: false,
    title: "",
  };
}

// EXT-AGENT-02 (spec §4.4): a proposal whose targetRef no longer resolves in
// the current document (it moved on since the response's baseDocSignature)
// is kept and shown flagged rather than silently dropped ("孤立提案" -- no
// existing code precedent for this concept, per this round's research; see
// the issue's completion record). narrative_draft has no target to resolve,
// so it is never orphaned; patch uses a signature-mismatch flag instead,
// since staleness there is about the WHOLE patch, not a single targetRef.
function computeAgentProposalReviewFlags(
  proposal: ParsedAgentProposal,
  doc: DocumentV1
): { orphaned: boolean; patchSignatureMismatch?: boolean } {
  if (proposal.kind === "narrative_draft") {
    return { orphaned: false };
  }
  if (proposal.kind === "patch") {
    const currentSignature = `${doc.id}:${doc.updatedAt}`;
    const mismatch = Boolean(proposal.patch?.baseDocSignature && proposal.patch.baseDocSignature !== currentSignature);
    return { orphaned: false, patchSignatureMismatch: mismatch };
  }

  const cardIds = proposal.targetRef.cardIds ?? [];
  const islandId = proposal.targetRef.islandId;
  const cardsExist = cardIds.length > 0 && cardIds.every((id) => doc.cards.some((card) => card.id === id));
  const islandExists = islandId ? doc.islands.some((island) => island.id === islandId) : false;

  if (proposal.kind === "island_title") {
    return { orphaned: !islandExists };
  }
  return { orphaned: !(cardsExist || islandExists) };
}



// UX-SCALE-01 (c) (ADR-0048 D2, Round 5 redline): auto-fit now generates an
// orthogonal (grid-occupancy) outline rather than a padded convex hull, so
// the shape has no diagonal edges and its vertex count is a meaningful
// complexity signal. Manual polygon editing (PolygonEditLayer) is untouched
// and can still produce a non-orthogonal shape if the user drags a vertex.
function buildIslandPolygonFromCards(document: DocumentV1, island: Island): Point[] {
  const memberCards = document.cards.filter((card) => island.cardIds.includes(card.id));
  return generateOrthogonalIslandOutline(memberCards)?.points ?? [];
}

function areIdSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) {
    return false;
  }

  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }

  return true;
}

function getIslandDepth(island: Island, islandsById: Map<string, Island>): number {
  let depth = 0;
  let cursor = island;
  const visited = new Set<string>([island.id]);

  while (cursor.parentIslandId) {
    const parent = islandsById.get(cursor.parentIslandId);
    if (!parent || visited.has(parent.id)) {
      break;
    }

    depth += 1;
    cursor = parent;
    visited.add(parent.id);
  }

  return depth;
}

function getIslandDepthMap(islands: Island[]): Map<string, number> {
  const islandsById = new Map(islands.map((island) => [island.id, island]));
  return new Map(islands.map((island) => [island.id, getIslandDepth(island, islandsById)]));
}

function getCardMinDepthMap(document: DocumentV1, islandDepthById: Map<string, number>): Map<string, number> {
  const cardDepthById = new Map<string, number>();

  for (const island of document.islands) {
    const islandDepth = islandDepthById.get(island.id) ?? 0;
    for (const cardId of island.cardIds) {
      const currentDepth = cardDepthById.get(cardId);
      if (currentDepth === undefined || islandDepth < currentDepth) {
        cardDepthById.set(cardId, islandDepth);
      }
    }
  }

  for (const card of document.cards) {
    if (cardDepthById.has(card.id)) {
      continue;
    }

    // Lone-wolf cards (not contained in any island) are treated as depth=0.
    cardDepthById.set(card.id, 0);
  }

  return cardDepthById;
}

function collectFocusedIslandIds(islands: Island[], focusIslandId: string): Set<string> {
  const islandsByParentId = new Map<string, Island[]>();

  for (const island of islands) {
    if (!island.parentIslandId) {
      continue;
    }

    const children = islandsByParentId.get(island.parentIslandId) ?? [];
    children.push(island);
    islandsByParentId.set(island.parentIslandId, children);
  }

  const focusedIslandIds = new Set<string>();
  const stack = [focusIslandId];

  while (stack.length > 0) {
    const islandId = stack.pop();
    if (!islandId || focusedIslandIds.has(islandId)) {
      continue;
    }

    focusedIslandIds.add(islandId);

    const children = islandsByParentId.get(islandId) ?? [];
    for (const child of children) {
      stack.push(child.id);
    }
  }

  return focusedIslandIds;
}

function applyFocusScope(document: DocumentV1, focusTarget: FocusTarget): DocumentV1 {
  if (!focusTarget.focusIslandId) {
    return document;
  }

  const hasFocusIsland = document.islands.some((island) => island.id === focusTarget.focusIslandId);
  if (!hasFocusIsland) {
    return document;
  }

  const focusedIslandIds = collectFocusedIslandIds(document.islands, focusTarget.focusIslandId);
  const focusedIslands = document.islands.filter((island) => focusedIslandIds.has(island.id));
  const focusedCardIdSet = new Set<string>();

  for (const island of focusedIslands) {
    for (const cardId of island.cardIds) {
      focusedCardIdSet.add(cardId);
    }
  }

  return {
    ...document,
    cards: document.cards.filter((card) => focusedCardIdSet.has(card.id)),
    edges: document.edges.filter(
      (edge) => focusedCardIdSet.has(edge.fromId) && focusedCardIdSet.has(edge.toId)
    ),
    islands: focusedIslands,
    readingOrder: (document.readingOrder ?? []).filter(
      (entryId) => focusedCardIdSet.has(entryId) || focusedIslandIds.has(entryId)
    ),
  };
}

type TenantSwitchUiState =
  | Readonly<{ status: "idle" }>
  | Readonly<{
    status: "confirming";
    requestedTenantId: string;
    requestedTenantDisplayName: string;
  }>
  | Readonly<{ status: "switching" }>
  | Readonly<{ status: "blocked" }>;

export type AppProps = Readonly<{
  storageScope?: TenantBrowserStorageScope;
  tenantSessionContext?: TenantSessionContextV1;
}>;

export default function App({ storageScope, tenantSessionContext }: AppProps = {}) {
  const appStorage = useMemo(
    () => createAppBrowserStorage(storageScope),
    [storageScope?.deployment, storageScope?.principalId, storageScope?.tenantId],
  );
  const verifiedTenantSession = useMemo(
    () => resolveAppTenantSession({
      sessionContext: tenantSessionContext,
      storageScope: appStorage.scope,
    }),
    [appStorage.scope, tenantSessionContext],
  );
  const initialStorageScopeIdentityRef = useRef(appStorage.scopeIdentity);
  assertAppStorageScopeStable(
    initialStorageScopeIdentityRef.current,
    appStorage.scopeIdentity,
  );

  const [history, setHistory] = useState<DocumentHistory | null>(null);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  // DOMAIN-CARD-QUALITY-01: session-only self-check state, keyed by card id.
  // Never persisted to the document (§6: quality notes are derived, not truth).
  const [cardQualityAssistByCardId, setCardQualityAssistByCardId] = useState<Record<string, CardQualityAssistState>>({});
  const [openCardQualityAssistCardId, setOpenCardQualityAssistCardId] = useState<string | null>(null);
  const [isAdvancedUiEnabled, setIsAdvancedUiEnabled] = useState<boolean>(
    appStorage.loadAdvancedUiEnabled,
  );
  const [isWorkModeOpen, setIsWorkModeOpen] = useState(false);
  const workModeTriggerRef = useRef<HTMLButtonElement>(null);
  const [isAgentTaskExportOpen, setIsAgentTaskExportOpen] = useState(false);
  const agentTaskExportTriggerRef = useRef<HTMLButtonElement>(null);
  const [isDiagnosticsBundleOpen, setIsDiagnosticsBundleOpen] = useState(false);
  const diagnosticsBundleTriggerRef = useRef<HTMLButtonElement>(null);
  const hasOpenedDiagnosticsBundlePanel = useMountOnceOpened(isDiagnosticsBundleOpen);
  const [isRecentDocumentsDialogOpen, setIsRecentDocumentsDialogOpen] = useState(false);
  const recentDocumentsDialogTriggerRef = useRef<HTMLElement | null>(null);
  // 第2反復: the tenant's full canvas list (GET /docs), fetched when the
  // recent-documents dialog opens so the "canvas list" is not limited to
  // recently-opened ids.
  const [canvasDocuments, setCanvasDocuments] = useState<DocumentListItem[] | null>(null);
  const [isCanvasListLoading, setIsCanvasListLoading] = useState(false);
  const [myDocumentsOnly, setMyDocumentsOnly] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  // ADR-0073 D2=A (第2反復): the active document is archived, so the editor
  // is review-only. Derived from the canvas list (GET /docs lifecycle_state)
  // when opening; the server 423 backstop remains the source of truth.
  const [isActiveDocumentArchived, setIsActiveDocumentArchived] = useState(false);
  const [agentTaskKind, setAgentTaskKind] = useState<AgentTaskKind>("island_titles");
  const [agentTaskDesiredCount, setAgentTaskDesiredCount] = useState(3);
  const [agentTaskIncludeUnreviewedDrafts, setAgentTaskIncludeUnreviewedDrafts] = useState(false);
  const [agentTaskIncludeSourceReferences, setAgentTaskIncludeSourceReferences] = useState(false);
  const [agentTaskScopeConfirmed, setAgentTaskScopeConfirmed] = useState(false);
  const [isAgentResponseImportOpen, setIsAgentResponseImportOpen] = useState(false);
  const agentResponseImportTriggerRef = useRef<HTMLButtonElement>(null);
  const hasOpenedAgentResponseImportPanel = useMountOnceOpened(isAgentResponseImportOpen);
  const [agentResponsePastedText, setAgentResponsePastedText] = useState("");
  const [agentResponseImportMode, setAgentResponseImportMode] = useState<AgentResponseImportMode>("lenient");
  const [agentResponseParseErrors, setAgentResponseParseErrors] = useState<string[]>([]);
  const [agentResponseParseWarnings, setAgentResponseParseWarnings] = useState<string[]>([]);
  const [agentImportedProposalReviews, setAgentImportedProposalReviews] = useState<ImportedProposalReview[]>([]);
  const [critiqueWorkflowFocusRequest, setCritiqueWorkflowFocusRequest] = useState(0);
  const [contextMenu, setContextMenu] = useState<
    | {
        x: number;
        y: number;
        target:
          | { kind: "card"; cardId: string }
          | { kind: "island"; islandId: string }
          | { kind: "background"; worldX: number; worldY: number };
      }
    | null
  >(null);
  const contextMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const [selectedIslandId, setSelectedIslandId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isReloadingDocument, setIsReloadingDocument] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [tenantSwitchUiState, setTenantSwitchUiState] = useState<TenantSwitchUiState>({
    status: "idle",
  });
  const [docEtag, setDocEtag] = useState<string | null>(null);
  const [hasSaveConflict, setHasSaveConflict] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  // Status toasts are transient: clearing them keeps the bottom-right corner from
  // covering the bulk-action bar and minimap long after the news is stale.
  useEffect(() => {
    if (statusMessage === "") {
      return undefined;
    }
    const timer = window.setTimeout(() => setStatusMessage(""), 10_000);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);
  const locationSearch = window.location.search;
  const isReadOnly = useMemo(
    () => resolveReadOnlyFromSearch(locationSearch) || isActiveDocumentArchived,
    [locationSearch, isActiveDocumentArchived],
  );
  const [activeDocumentId, setActiveDocumentId] = useState(DEFAULT_DOCUMENT_ID);
  const [recentDocumentIds, setRecentDocumentIds] = useState<string[]>(
    appStorage.loadRecentDocumentIds,
  );
  const [selectedRecentDocumentId, setSelectedRecentDocumentId] = useState("");
  const [suggestionInstruction, setSuggestionInstruction] = useState("");
  const [suggestedDocument, setSuggestedDocument] = useState<DocumentV1 | null>(null);
  const [suggestionId, setSuggestionId] = useState<string | null>(null);
  const [suggestionIteration, setSuggestionIteration] = useState(1);
  const [suggestionNotes, setSuggestionNotes] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [resuggestAttemptCount, setResuggestAttemptCount] = useState(0);
  const resuggestAttemptLimit = 3;
  const [resuggestStopperEnabled, setResuggestStopperEnabled] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isSuggestionPreviewEnabled, setIsSuggestionPreviewEnabled] = useState(true);
  const [isAnnotateOverlayEnabled, setIsAnnotateOverlayEnabled] = useState(false);
  const [providerUnavailableMessage, setProviderUnavailableMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [hideNonMatches, setHideNonMatches] = useState(false);
  const [domainStateFilter, setDomainStateFilter] = useState(() => createEmptyDomainStateFilter());
  const [hideNonStateMatches, setHideNonStateMatches] = useState(false);
  const [hideSourceCards, setHideSourceCards] = useState(true);
  const [hideMergedOriginals, setHideMergedOriginals] = useState(false);
  const [summaryView, setSummaryView] = useState(false);
  const [abstractMapView, setAbstractMapView] = useState(false);
  const [lodEnabled, setLodEnabled] = useState(false);
  const [lodThresholds, setLodThresholds] = useState<LODThresholds>(DEFAULT_LOD_THRESHOLDS);
  const [lodLevelOverride, setLodLevelOverride] = useState<LODLevel | null>(null);
  const [lodShowLoneWolvesWhenFar, setLodShowLoneWolvesWhenFar] = useState(true);
  const [safeMode, setSafeMode] = useState(true);
  const [emptyCanvasHintCompleted, setEmptyCanvasHintCompleted] = useState(
    appStorage.loadEmptyCanvasHintCompleted,
  );
  // UX-VISUAL-01 AC-2: in-canvas state legend. Default OFF (CB-1); session-local.
  const [isCanvasLegendOpen, setIsCanvasLegendOpen] = useState(false);
  // UX-VISUAL-02: protection marks for lone-wolf cards / small islands.
  // Default ON but subtle (ADR-0048 D3 「淡く強調」); toggleable OFF in the View panel.
  const [showProtectionMarks, setShowProtectionMarks] = useState(true);
  // DOMAIN-TRACE-01 AC-3 (CB-1): the canvas seq badge is DEFAULT OFF.
  const [showSeqNumbers, setShowSeqNumbers] = useState(false);
  // PROV-VIS-01 (ADR-0050 D1): read-only provider visibility. providerKind is
  // fetched from the backend config echo at startup and whenever the View
  // panel opens; lastAiCallOutcome is tracked client-side from the actual
  // result of the most recent AI call.
  const [providerKind, setProviderKind] = useState<ProviderKind | null>(null);
  // OPS-LLM-COST-02: in-process LLM call counts (per provider kind + total),
  // surfaced read-only in the View panel next to the provider kind.
  const [llmCallCounts, setLlmCallCounts] = useState<Record<string, number>>({});
  const [llmTokenUsage, setLlmTokenUsage] = useState<Record<string, { input: number; output: number }>>({});
  const [lastAiCallOutcome, setLastAiCallOutcome] = useState<"ok" | AiProviderErrorKind | null>(null);
  // UX-CMDK-01 (ADR-0048 D2, layer 5): command palette. Default OFF, opened
  // only via Cmd/Ctrl+K; no persistent trigger element (CB-1, AC-5).
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const commandPaletteReturnFocusRef = useRef<HTMLElement | null>(null);
  // UX-SHORTCUT-01 AC-4 (ADR-0048 D2): shortcut cheatsheet. Default OFF,
  // opened only via "?"; no persistent trigger element (CB-1, AC-5).
  const [isShortcutCheatsheetOpen, setIsShortcutCheatsheetOpen] = useState(false);
  const shortcutCheatsheetReturnFocusRef = useRef<HTMLElement | null>(null);
  const [viewVisibility, setViewVisibility] = useState<PublishVisibility>(
    () => appStorage.loadViewVisibilityForDocument(DEFAULT_DOCUMENT_ID).viewVisibility
  );
  const [packVisibility, setPackVisibility] = useState<PublishVisibility>(
    () => appStorage.loadViewVisibilityForDocument(DEFAULT_DOCUMENT_ID).packVisibility
  );
  const [showLabelBounds, setShowLabelBounds] = useState(false);
  const [includeUnreviewedDraftsInExport, setIncludeUnreviewedDraftsInExport] = useState(false);
  // DOMAIN-TRACE-01 (schemas.md §15.4): share exports drop Card.meta unless opted in.
  const [includeSourceReferencesInExport, setIncludeSourceReferencesInExport] = useState(false);
  const [revealedSourceCardIds, setRevealedSourceCardIds] = useState<Set<string>>(new Set());
  const [showCanonicalOnlyEdges, setShowCanonicalOnlyEdges] = useState(false);
  const [showReadingOrder, setShowReadingOrder] = useState(false);
  const [isReadingOrderEditMode, setIsReadingOrderEditMode] = useState(false);
  const [readingNavEnabled, setReadingNavEnabled] = useState(false);
  const [readingIndex, setReadingIndex] = useState(0);
  const [readingMode, setReadingMode] = useState<ReadingMode>("islands");
  const [reviewedOnly, setReviewedOnly] = useState(false);
  const [outlineIncludeCardTexts, setOutlineIncludeCardTexts] = useState(false);
  const [outlineIncludeRelationSummaries, setOutlineIncludeRelationSummaries] = useState(true);
  const [outlineIncludeUnreviewed, setOutlineIncludeUnreviewed] = useState(false);
  const [outlineAppendDiagnostics, setOutlineAppendDiagnostics] = useState(false);
  const [outlineAppendRecommendations, setOutlineAppendRecommendations] = useState(false);
  // DOMAIN-KA-01 (schemas.md §17.4): optional, default-OFF outline section.
  const [outlineAppendKaFields, setOutlineAppendKaFields] = useState(false);
  const [outlineQualityReport, setOutlineQualityReport] = useState<OutlineQualityReport | null>(null);
  const [contradictionReport, setContradictionReport] = useState<ContradictionReport | null>(null);
  const [distributionReport, setDistributionReport] = useState<DistributionReport | null>(null);
  const [claimTypeMixReport, setClaimTypeMixReport] = useState<ClaimTypeMixReport | null>(null);
  const [evidenceGapReport, setEvidenceGapReport] = useState<EvidenceGapReport | null>(null);
  const [dialecticBalanceReport, setDialecticBalanceReport] = useState<DialecticBalanceReport | null>(null);
  const [highlightEdgeIds, setHighlightEdgeIds] = useState<string[]>([]);
  const [evidenceOverlayEnabled, setEvidenceOverlayEnabled] = useState(false);
  const [evidenceOverlayMode, setEvidenceOverlayMode] = useState<EvidenceOverlayMode>("supports");
  const [evidenceOverlayDepth, setEvidenceOverlayDepth] = useState(1);
  const [evidenceOverlayScope, setEvidenceOverlayScope] = useState<"all" | "selection">("selection");
  const [evidenceOverlayDimOthers, setEvidenceOverlayDimOthers] = useState(true);
  const [perspectiveMode, setPerspectiveMode] = useState<PerspectiveMode>("default");
  const [perspectiveStrictFilter, setPerspectiveStrictFilter] = useState(false);
  const [perspectivePresets, setPerspectivePresets] = useState<PerspectivePreset[]>(DEFAULT_PERSPECTIVE_PRESETS);
  const [viewPresets, setViewPresets] = useState<ViewPreset[]>(DEFAULT_VIEW_PRESETS);
  const [activePresetId, setActivePresetId] = useState<string | null>("default-explore");
  const [viewMode, setViewMode] = useState<ViewMode>("explore");
  const [guidedFlowEnabled, setGuidedFlowEnabled] = useState(false);
  const [guidedFlowStepId, setGuidedFlowStepId] = useState<GuidedFlowStepId>("review");
  const [guidedFlowTargetIndex, setGuidedFlowTargetIndex] = useState(0);
  const [guidedFlowOpenEditorRequestSeq, setGuidedFlowOpenEditorRequestSeq] = useState(0);

  useEffect(() => {
    if (!isAdvancedUiEnabled) {
      setGuidedFlowEnabled(false);
      setIsDiagnosticsBundleOpen(false);
    }
  }, [isAdvancedUiEnabled]);

  const [pngExportScale, setPngExportScale] = useState<PngExportScale>(1);
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget>({});
  const [focusWorldPoint, setFocusWorldPoint] = useState<{ x: number; y: number } | null>(null);
  const [focusRequestSeq, setFocusRequestSeq] = useState(0);
  const [focusHistory, setFocusHistory] = useState<FocusSnapshot[]>([]);
  const [flashReference, setFlashReference] = useState<FocusReference | null>(null);
  const [flashRequestSeq, setFlashRequestSeq] = useState(0);
  const [narrativeText, setNarrativeText] = useState("");
  const [narrativeIssues, setNarrativeIssues] = useState<NarrativeIssue[]>([]);
  const [narrativeCheckError, setNarrativeCheckError] = useState<string | null>(null);
  const [isCheckingNarrative, setIsCheckingNarrative] = useState(false);
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);
  const [narrativeGenerationError, setNarrativeGenerationError] = useState<string | null>(null);
  const [peekIslandId, setPeekIslandId] = useState<string | undefined>(undefined);
  const [summaryRevealIslandIds, setSummaryRevealIslandIds] = useState<Set<string>>(new Set());
  const [collapsedIslandIds, setCollapsedIslandIds] = useState<Set<string>>(new Set());
  const [temporaryRevealCardIds, setTemporaryRevealCardIds] = useState<Set<string>>(new Set());
  const [groundingVisibilityMessage, setGroundingVisibilityMessage] = useState<string | null>(null);
  const [isGridSnapEnabled, setIsGridSnapEnabled] = useState(false);
  const [isPolygonVertexEditEnabled, setIsPolygonVertexEditEnabled] = useState(false);
  const [mergeSuggestionInstruction, setMergeSuggestionInstruction] = useState("");
  const [mergeSuggestions, setMergeSuggestions] = useState<MergeSuggestionDraft[]>([]);
  const [mergeDecisionAuditEvents, setMergeDecisionAuditEvents] = useState<MergeDecisionAuditEvent[]>([]);
  const [mergeSuggestionError, setMergeSuggestionError] = useState<string | null>(null);
  const [isSuggestingMerges, setIsSuggestingMerges] = useState(false);
  const [isSuggestingIslandSummary, setIsSuggestingIslandSummary] = useState(false);
  const [isRecordingIslandSummaryDecision, setIsRecordingIslandSummaryDecision] = useState(false);
  const [islandSummarySuggestionWarningsByIslandId, setIslandSummarySuggestionWarningsByIslandId] = useState<Record<string, string[]>>({});
  const [islandSummaryProposal, setIslandSummaryProposal] = useState<IslandSummaryProposal | null>(null);
  // AI-MODEL-GOVERNANCE-01 (R2): per-operation model override for the island
  // summary suggestion. "" = auto (platform default); the selector offers the
  // tenant's allowed active models.
  const [islandSummaryModel, setIslandSummaryModel] = useState<string>("");
  // Tenant-allowed active models for the selector (guarded fetch, owned here).
  const [availableModels, setAvailableModels] = useState<AvailableModelItem[] | null>(null);
  const [availableModelsUnavailableReason, setAvailableModelsUnavailableReason] =
    useState<AvailableModelUnavailableReason | null>(null);
  // AI-MODEL-GOVERNANCE-01 (R2): per-operation model override for document-title
  // generation ("" = auto / platform default).
  const [documentTitleModel, setDocumentTitleModel] = useState<string>("");
  // AI-MODEL-GOVERNANCE-01 (R2): per-operation model override for narrative
  // generation ("" = auto / platform default).
  const [narrativeModel, setNarrativeModel] = useState<string>("");
  // AI-OPPOSE-01 (M4): proposal-only opposing-viewpoint observation for the
  // selected card; never auto-applied.
  const [opposingViewpointProposal, setOpposingViewpointProposal] = useState<OpposingViewpointProposal | null>(null);
  const [isProposingOpposingViewpoint, setIsProposingOpposingViewpoint] = useState(false);
  const [proposalAuditTrail, setProposalAuditTrail] = useState<string[]>([]);
  const [isPickingEdgeTarget, setIsPickingEdgeTarget] = useState(false);
  const [connectEdgeType, setConnectEdgeType] = useState<KnownEdgeType>("related");
  const [maxDepth, setMaxDepth] = useState<ViewMaxDepth>("all");
  const [hierarchyLevel, setHierarchyLevel] = useState<HierarchyLevel>("detail");
  const [isViewControlsOpen, setIsViewControlsOpen] = useState(false);
  const [isSharePanelOpen, setIsSharePanelOpen] = useState(false);
  const [isStartPanelVisible, setIsStartPanelVisible] = useState(true);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [visibleAggregatedEdges, setVisibleAggregatedEdges] = useState<AggregatedEdgeMeta[]>([]);
  const [isGeneratingRelationSummary, setIsGeneratingRelationSummary] = useState(false);
  const [comparisonDocument, setComparisonDocument] = useState<DocumentV1 | null>(null);
  const [comparisonFileName, setComparisonFileName] = useState<string | null>(null);
  const [reviewDiffBaseSnapshot, setReviewDiffBaseSnapshot] = useState<DocumentV1 | null>(null);
  const [selectedMergeItemIdSet, setSelectedMergeItemIdSet] = useState<Set<string>>(new Set());
  const [autoIncludeMergePrerequisites, setAutoIncludeMergePrerequisites] = useState(true);
  const [lastMergeSnapshot, setLastMergeSnapshot] = useState<DocumentV1 | null>(null);
  const [mergeWarningConfirmationKey, setMergeWarningConfirmationKey] = useState<string | null>(null);
  const [mergeAuditLog, setMergeAuditLog] = useState<MergeAuditEntry[]>([]);
  const [reviewEvents, setReviewEvents] = useState<ReviewEvent[]>([]);
  const [currentReviewerRef, setCurrentReviewerRef] = useState<string>(
    appStorage.initializeCurrentReviewerRef,
  );
  const [mergeSourceInfo, setMergeSourceInfo] = useState<MergeAuditSource>({ kind: "unknown" });
  const [pendingImportedDocument, setPendingImportedDocument] = useState<PendingImportedDocument | null>(null);
  const [importDocumentError, setImportDocumentError] = useState<string | null>(null);
  const [packImportError, setPackImportError] = useState<string | null>(null);
  const [importedPackSummary, setImportedPackSummary] = useState<{ fileName: string; cardCount: number; islandCount: number; perspectiveMode: string; visibility: PublishVisibility; warningCount: number } | null>(null);
  const [importedPackSnapshotUrl, setImportedPackSnapshotUrl] = useState<string | null>(null);
  const [importedPackDiagnosticsMd, setImportedPackDiagnosticsMd] = useState<string | null>(null);
  const [pendingPatchImport, setPendingPatchImport] = useState<PendingPatchImport | null>(null);
  const [patchImportError, setPatchImportError] = useState<string | null>(null);
  const [patchBaselineDoc, setPatchBaselineDoc] = useState<DocumentV1 | null>(null);
  const [patchBaselineFileName, setPatchBaselineFileName] = useState<string | null>(null);
  const [patchSelectedOpIdSet, setPatchSelectedOpIdSet] = useState<Set<string>>(new Set());
  const [patchResolutionsByOpId, setPatchResolutionsByOpId] = useState<Record<string, PatchResolution>>({});
  const [patchTrustLabel, setPatchTrustLabel] = useState<TrustLabel>("unknown");
  const [patchFingerprintStatus, setPatchFingerprintStatus] = useState<{ status: string; expected?: string; actual?: string } | null>(null);
  const [patchExportAuthor, setPatchExportAuthor] = useState("");
  const [patchExportAuthorNote, setPatchExportAuthorNote] = useState("");
  const [selectedFixProposalIdSet, setSelectedFixProposalIdSet] = useState<Set<string>>(new Set());
  const [isDiagnosticsRunning, setIsDiagnosticsRunning] = useState(false);
  const [isBundleExportRunning, setIsBundleExportRunning] = useState(false);
  const [isDiffComputing, setIsDiffComputing] = useState(false);
  const [computeProgressMessage, setComputeProgressMessage] = useState<string | null>(null);
  const [computeProgressPercent, setComputeProgressPercent] = useState(0);
  const [isDiffFallbackMode, setIsDiffFallbackMode] = useState(false);

  const [canvasCamera, setCanvasCamera] = useState<CanvasCamera | null>(null);
  const [cameraTransformRequest, setCameraTransformRequest] = useState<CameraTransformRequest | null>(null);
  const collapsedStateDocIdRef = useRef<string | null>(null);
  const importedCollapsedStateRef = useRef<{ docId: string; islandIds: Set<string> } | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const diagnosticsAbortRef = useRef<AbortController | null>(null);
  const bundleRunnerRef = useRef(createCancelableTaskRunner());
  const bundleAbortRef = useRef<AbortController | null>(null);
  const diffWorkerClientRef = useRef<DiffWorkerClient | null>(null);
  const diagnosticsWorkerClientRef = useRef<DiagnosticsWorkerClient | null>(null);
  const diffAbortRef = useRef<AbortController | null>(null);
  const tenantSwitchAbortRef = useRef<AbortController | null>(null);
  const tenantSessionCoherenceRef = useRef<TenantSessionCoherenceBoundary | null>(null);
  const tenantSessionGenerationGuardRef = useRef(new TenantSessionGenerationGuard());
  const tenantControlRef = useRef<HTMLSelectElement | null>(null);
  const viewLocalePersistenceScopeRef = useRef(createViewLocalePersistenceScope({ docId: "", viewMode: "explore", allowPersistence: true }));

  const cleanupRuntimeResources = useCallback(() => {
    tenantSessionGenerationGuardRef.current.invalidate();
    cleanupAppRuntimeResources({
      abortControllers: [
        tenantSwitchAbortRef.current,
        diffAbortRef.current,
        diagnosticsAbortRef.current,
        bundleAbortRef.current,
      ],
      cancelableTasks: [bundleRunnerRef.current],
      disposableWorkers: [
        diffWorkerClientRef.current,
        diagnosticsWorkerClientRef.current,
      ],
    });
  }, []);

  const blockStaleTenantSession = useCallback(() => {
    if (!verifiedTenantSession) {
      return false;
    }
    cleanupRuntimeResources();
    setTenantSwitchUiState({ status: "blocked" });
    return true;
  }, [cleanupRuntimeResources, verifiedTenantSession]);

  const runTenantScopedTask = useCallback(<T,>(
    task: () => Promise<T>,
  ): Promise<T> => tenantSessionGenerationGuardRef.current.run(task), []);

  const runTenantScopedOptionalTask = useCallback(async <T,>(
    task: () => Promise<T>,
  ): Promise<T | undefined> => {
    try {
      return await runTenantScopedTask(task);
    } catch (error) {
      if (error instanceof StaleTenantSessionResultError) {
        return undefined;
      }
      throw error;
    }
  }, [runTenantScopedTask]);

  const runTenantScopedApiRequest = useCallback(async <T,>(
    request: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await runTenantScopedTask(request);
    } catch (error) {
      if (
        error instanceof ApiError
        && error.code === "tenant_session_changed"
      ) {
        blockStaleTenantSession();
      }
      if (
        error instanceof ApiError
        && ["model_not_allowed", "model_not_registered", "model_provider_unavailable"].includes(error.code ?? "")
      ) {
        // An administrator may change provider/model lifecycle or a tenant
        // allowlist while this page is open. The rejected mutation is already
        // fail-closed server-side; refresh the advisory selector immediately
        // so the user does not keep retrying a stale model choice.
        try {
          const result = await runTenantScopedTask(() => fetchAvailableModels({
            tenantSessionContext: verifiedTenantSession,
          }));
          setAvailableModels(result.models);
          setAvailableModelsUnavailableReason(result.unavailableReason ?? null);
        } catch (refreshError) {
          if (!(refreshError instanceof StaleTenantSessionResultError)) {
            setAvailableModels([]);
            setAvailableModelsUnavailableReason(null);
          }
        }
      }
      throw error;
    }
  }, [blockStaleTenantSession, runTenantScopedTask, verifiedTenantSession]);

  useEffect(() => {
    return cleanupRuntimeResources;
  }, [cleanupRuntimeResources]);

  useEffect(() => {
    if (!verifiedTenantSession) {
      return undefined;
    }
    const boundary = installTenantSessionCoherenceBoundary({
      onInvalidate: blockStaleTenantSession,
    });
    tenantSessionCoherenceRef.current = boundary;
    return () => {
      boundary.dispose();
      if (tenantSessionCoherenceRef.current === boundary) {
        tenantSessionCoherenceRef.current = null;
      }
    };
  }, [blockStaleTenantSession, verifiedTenantSession]);

  useEffect(() => {
    return () => {
      if (importedPackSnapshotUrl) {
        URL.revokeObjectURL(importedPackSnapshotUrl);
      }
    };
  }, [importedPackSnapshotUrl]);

  useEffect(() => {
    // SAAS-TENANT-UX-01: intentionally outside the tenant session generation
    // guard. providerKind is a process-wide config echo (backend settings.py
    // has no tenant-scoped provider configuration, and none is planned), not
    // a tenant resource, so there is no stale-generation response to guard
    // against here the way there is for tenant-scoped document/AI calls.
    // PROV-VIS-01: fetch the configured provider kind once. This is a static
    // config echo (no connectivity check); failures are silently ignored so
    // the badge simply stays unknown rather than surfacing a spurious error.
    let cancelled = false;
    void getProviderStatus()
      .then(({ providerKind: kind, callCounts, tokenUsage }) => {
        if (!cancelled) {
          setProviderKind(kind);
          setLlmCallCounts(callCounts);
          setLlmTokenUsage(tokenUsage);
        }
      })
      .catch(() => {
        // Leave providerKind as null (unknown); this is display-only.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const document = history?.present ?? null;
  const documentRef = useRef(document);
  documentRef.current = document;
  const currentReviewerRefSource = inferReviewerRefSource(currentReviewerRef);

  // UI-RESILIENCE-01: restore a document preserved by the error boundary
  // (the app has no autosave; a render crash otherwise loses unsaved work).
  const [pendingRecovery, setPendingRecovery] = useState<unknown | null>(() =>
    loadEvictedDocument(appStorage.scope),
  );

  const applyRecoveredDocument = useCallback(
    (restoredDoc: unknown) => {
      const restored = normalizeDocument(restoredDoc as Document);
      setHistory({
        past: [],
        present: cloneDocument(restored),
        future: [],
      });
      setActiveDocumentId(restored.id);
      setSelectedCardIds([]);
      setSelectedIslandId(null);
      setIsDirty(true);
      setStatusMessage(t("app.status.document_recovered"));
      setPendingRecovery(null);
      clearEvictedDocument(appStorage.scope);
    },
    [normalizeDocument, cloneDocument, t, appStorage.scope],
  );

  const handleDismissRecovery = useCallback(() => {
    setPendingRecovery(null);
    clearEvictedDocument(appStorage.scope);
  }, [appStorage.scope]);
  const outlineRecommendations = useMemo(() => {
    if (!document || !outlineQualityReport) {
      return [];
    }

    return generateRecommendations(outlineQualityReport, document, { readingMode, reviewedOnly });
  }, [document, outlineQualityReport, readingMode, reviewedOnly]);
  const generatedNarratives = useMemo(() => document?.narratives ?? [], [document]);
  const isPreviewingSuggestion = Boolean(suggestedDocument) && isSuggestionPreviewEnabled;
  const visibleDocument = isPreviewingSuggestion && suggestedDocument ? suggestedDocument : document;
  const [mergeItems, setMergeItems] = useState<MergeItem[]>([]);

  useEffect(() => {
    if (!diffWorkerClientRef.current) {
      diffWorkerClientRef.current = new DiffWorkerClient();
    }
    if (!diagnosticsWorkerClientRef.current) {
      diagnosticsWorkerClientRef.current = new DiagnosticsWorkerClient();
    }

    return () => {
      diffWorkerClientRef.current?.dispose();
      diagnosticsWorkerClientRef.current?.dispose();
    };
  }, [abstractMapView, summaryView]);

  useEffect(() => {
    if (!comparisonDocument || !reviewDiffBaseSnapshot) {
      setMergeItems([]);
      setIsDiffComputing(false);
      setComputeProgressPercent(0);
      setIsDiffFallbackMode(false);
      return;
    }

    setIsDiffComputing(true);
    setIsDiffFallbackMode(false);
    const controller = new AbortController();
    diffAbortRef.current = controller;

    if (!diffWorkerClientRef.current) {
      diffWorkerClientRef.current = new DiffWorkerClient();
    }

    void runTenantScopedTask(() => diffWorkerClientRef.current!.computeDiff(
      {
        baseDoc: reviewDiffBaseSnapshot,
        baseView: { readingOrder: reviewDiffBaseSnapshot.readingOrder },
        incomingDoc: comparisonDocument,
        incomingView: { readingOrder: comparisonDocument.readingOrder },
        options: { maxNodes: 5000, maxMs: 2000 },
      },
      {
        signal: controller.signal,
        onProgress: (progress) => {
          setComputeProgressPercent(progress.percent);
          setComputeProgressMessage(t("app.status.diff.progress", {
            stage: getDiffStageDisplayLabel(progress.stage),
            percent: progress.percent,
          }));
        },
      },
    )).then((outcome) => {
      if (controller.signal.aborted || outcome?.status === "cancelled") {
        setStatusMessage(t("app.status.diff.cancelled"));
        return;
      }

      if (!outcome || outcome.status !== "completed") {
        return;
      }

      setIsDiffFallbackMode(outcome.usedFallback);
      const next = [...outcome.result.documentDiff, ...outcome.result.viewDiff];
      setMergeItems(next);
    }).catch((error: unknown) => {
      if (!(error instanceof StaleTenantSessionResultError)) {
        throw error;
      }
    }).finally(() => {
      setIsDiffComputing(false);
      setComputeProgressMessage(null);
      setComputeProgressPercent(0);
    });

    return () => {
      controller.abort();
      if (diffAbortRef.current === controller) {
        diffAbortRef.current = null;
      }
    };
  }, [comparisonDocument, reviewDiffBaseSnapshot, runTenantScopedTask]);
  const mergeEvaluation = useMemo(() => {
    if (!document || !comparisonDocument || !reviewDiffBaseSnapshot) {
      return { evaluations: [], selectedIdsWithPrerequisites: new Set<string>() };
    }

    return evaluateMergeSelection(reviewDiffBaseSnapshot, document, comparisonDocument, reviewDiffBaseSnapshot, mergeItems, selectedMergeItemIdSet, autoIncludeMergePrerequisites);
  }, [autoIncludeMergePrerequisites, comparisonDocument, document, mergeItems, reviewDiffBaseSnapshot, selectedMergeItemIdSet]);
  const patchConflictReport = useMemo(() => {
    if (!document || !pendingPatchImport || !patchBaselineDoc) {
      return null;
    }

    return detectPatchConflicts(patchBaselineDoc, document, pendingPatchImport.patch);
  }, [document, patchBaselineDoc, pendingPatchImport]);
  const patchConflictByOpId = useMemo(() => {
    return new Map((patchConflictReport?.conflicts ?? []).map((item) => [item.opId, item]));
  }, [patchConflictReport]);
  const patchLintResult = useMemo(() => {
    if (!document || !pendingPatchImport) {
      return null;
    }

    return lintPatchAgainstCurrentDoc(document, pendingPatchImport.patch);
  }, [document, pendingPatchImport]);
  const patchFixProposals = useMemo(() => {
    if (!document || !pendingPatchImport || !patchLintResult) {
      return [] as FixProposal[];
    }

    return proposeFixes(document, pendingPatchImport.patch, patchLintResult);
  }, [document, patchLintResult, pendingPatchImport]);

  const patchLintIssuesByOpId = useMemo(() => {
    const next = new Map<string, PatchLintIssue[]>();
    for (const issue of patchLintResult?.issues ?? []) {
      if (!issue.opId) {
        continue;
      }

      const existing = next.get(issue.opId) ?? [];
      next.set(issue.opId, [...existing, issue]);
    }

    return next;
  }, [patchLintResult]);
  const patchPreviewItems = useMemo(() => {
    if (!pendingPatchImport) {
      return [] as PatchPreviewItem[];
    }

    return buildPatchPreviewItems(pendingPatchImport.patch, patchSelectedOpIdSet, patchConflictByOpId, patchResolutionsByOpId, patchLintIssuesByOpId, safeMode);
  }, [patchConflictByOpId, patchLintIssuesByOpId, patchResolutionsByOpId, patchSelectedOpIdSet, pendingPatchImport, safeMode]);
  const patchConflictWarning = useMemo(() => {
    if (!pendingPatchImport) {
      return null;
    }

    if (!patchBaselineDoc) {
      return "No baseline loaded. Conflict detection is disabled (H4 behavior).";
    }

    if (!patchConflictReport || patchConflictReport.conflicts.length === 0) {
      return null;
    }

    return `${patchConflictReport.conflicts.length} conflict(s) detected. Default resolution is Skip. Choose resolution to apply.`;
  }, [patchBaselineDoc, patchConflictReport, pendingPatchImport]);
  const patchBaselineSignatureMatch = useMemo(() => {
    if (!document || !patchBaselineDoc) {
      return undefined;
    }

    return patchBaselineDoc.id === document.id;
  }, [document, patchBaselineDoc]);
  const patchSummary = useMemo(() => {
    if (!pendingPatchImport) {
      return null;
    }

    return buildPatchSummary(pendingPatchImport.patch, patchConflictReport ?? undefined, patchBaselineSignatureMatch, safeMode);
  }, [patchBaselineSignatureMatch, patchConflictReport, pendingPatchImport, safeMode]);
  useEffect(() => {
    setSelectedFixProposalIdSet((previousSet) => {
      const nextIds = new Set(patchFixProposals.map((proposal) => proposal.fixId));
      return new Set([...previousSet].filter((id) => nextIds.has(id)));
    });
  }, [patchFixProposals]);

  useEffect(() => {
    setSelectedMergeItemIdSet((previousSet) => {
      const nextIds = new Set(mergeItems.map((item) => item.id));
      return new Set([...previousSet].filter((id) => nextIds.has(id)));
    });
  }, [mergeItems]);


  const hasPatchSelection = patchSelectedOpIdSet.size > 0;
  const canApplyPatch = Boolean(document && pendingPatchImport && hasPatchSelection) && !shouldBlockPatchApplyByLint(patchLintResult);
  const focusedVisibleDocument = useMemo(() => {
    if (!visibleDocument) {
      return visibleDocument;
    }

    return applyFocusScope(visibleDocument, focusTarget);
  }, [focusTarget, visibleDocument]);

  useEffect(() => {
    setFocusHistory([]);
  }, [document?.id]);

  const temporaryRevealIslandIds = useMemo(() => {
    if (!document || temporaryRevealCardIds.size === 0) {
      return new Set<string>();
    }

    const revealedIslandIds = new Set<string>();
    for (const island of document.islands) {
      if (island.cardIds.some((cardId) => temporaryRevealCardIds.has(cardId))) {
        revealedIslandIds.add(island.id);
      }
    }

    return revealedIslandIds;
  }, [document, temporaryRevealCardIds]);
  const mergedRevealCardIds = useMemo(
    () => new Set([...revealedSourceCardIds, ...temporaryRevealCardIds]),
    [revealedSourceCardIds, temporaryRevealCardIds]
  );
  const suggestionMoveDiffs = useMemo(() => {
    if (!document || !suggestedDocument || !isPreviewingSuggestion) {
      return [] as SuggestionMoveDiff[];
    }

    const scopedBaseDocument = applyFocusScope(document, focusTarget);
    const scopedSuggestedDocument = applyFocusScope(suggestedDocument, focusTarget);
    const scopedBaseCardIds = new Set(scopedBaseDocument.cards.map((card) => card.id));

    const baseCardsById = new Map(scopedBaseDocument.cards.map((card) => [card.id, card]));

    return scopedSuggestedDocument.cards
      .filter((card) => scopedBaseCardIds.has(card.id))
      .map((card) => {
        const baseCard = baseCardsById.get(card.id);
        if (!baseCard) {
          return null;
        }

        const deltaX = card.x - baseCard.x;
        const deltaY = card.y - baseCard.y;

        if (Math.hypot(deltaX, deltaY) <= SUGGESTION_MOVE_THRESHOLD) {
          return null;
        }

        return {
          cardId: card.id,
          fromX: baseCard.x,
          fromY: baseCard.y,
          toX: card.x,
          toY: card.y,
        } satisfies SuggestionMoveDiff;
      })
      .filter((diff): diff is SuggestionMoveDiff => diff !== null);
  }, [document, focusTarget, isPreviewingSuggestion, suggestedDocument]);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const matchedCardIds = useMemo(() => {
    if (!focusedVisibleDocument || normalizedSearchQuery.length === 0) {
      return [] as string[];
    }

    return focusedVisibleDocument.cards
      .filter((card) => card.text.toLowerCase().includes(normalizedSearchQuery))
      .map((card) => card.id);
  }, [focusedVisibleDocument, normalizedSearchQuery]);
  const matchedCardIdSet = useMemo(() => new Set(matchedCardIds), [matchedCardIds]);
  const domainStateFilterActive = isDomainStateFilterActive(domainStateFilter);
  const domainStateMatchedIdSet = useMemo(() => {
    if (!focusedVisibleDocument || !domainStateFilterActive) {
      return null;
    }
    return selectCardIdsByDomainState(focusedVisibleDocument, domainStateFilter);
  }, [focusedVisibleDocument, domainStateFilter, domainStateFilterActive]);
  const domainStateMatchCount = domainStateMatchedIdSet?.size ?? 0;
  const activeMatchIndex = matchedCardIds.length > 0 ? ((currentMatchIndex % matchedCardIds.length) + matchedCardIds.length) % matchedCardIds.length : 0;
  const activeMatchedCardId = matchedCardIds.length > 0 ? matchedCardIds[activeMatchIndex] : null;
  const collapseLodLevel = useMemo(() => {
    if (!lodEnabled) {
      return null;
    }

    const zoom = canvasCamera?.zoom ?? 1;
    return getLODLevel(zoom, { lodThresholds, lodLevelOverride }).level;
  }, [canvasCamera?.zoom, lodEnabled, lodLevelOverride, lodThresholds]);
  const collapsedIslandIdSet = useMemo(() => {
    if (!focusedVisibleDocument) {
      return new Set<string>();
    }

    return collectCollapsedIslandIds(focusedVisibleDocument.islands, collapsedIslandIds);
  }, [collapsedIslandIds, focusedVisibleDocument]);
  const effectiveCollapsedIslandIdSet = useMemo(() => {
    if (!focusedVisibleDocument) {
      return new Set<string>();
    }

    const collapsedIds = summaryView
      ? new Set(focusedVisibleDocument.islands.map((island) => island.id))
      : new Set(
          focusedVisibleDocument.islands
            .filter((island) => isEffectivelyCollapsed(collapsedIslandIdSet.has(island.id), lodEnabled, collapseLodLevel))
            .map((island) => island.id)
        );

    for (const islandId of temporaryRevealIslandIds) {
      collapsedIds.delete(islandId);
    }
    for (const islandId of summaryRevealIslandIds) {
      collapsedIds.delete(islandId);
    }

    if (peekIslandId) {
      collapsedIds.delete(peekIslandId);
    }

    return collapsedIds;
  }, [collapseLodLevel, collapsedIslandIdSet, focusedVisibleDocument, lodEnabled, peekIslandId, summaryRevealIslandIds, summaryView, temporaryRevealIslandIds]);
  const islandDepthById = useMemo(() => {
    if (!visibleDocument) {
      return new Map<string, number>();
    }

    return getIslandDepthMap(visibleDocument.islands);
  }, [visibleDocument]);
  const cardMinDepthById = useMemo(() => {
    if (!visibleDocument) {
      return new Map<string, number>();
    }

    return getCardMinDepthMap(visibleDocument, islandDepthById);
  }, [visibleDocument, islandDepthById]);
  const depthHiddenIslandIdSet = useMemo(() => {
    if (!focusedVisibleDocument || maxDepth === "all") {
      return new Set<string>();
    }

    return collectHierarchyHiddenIslandIds(focusedVisibleDocument.islands, islandDepthById, maxDepth);
  }, [focusedVisibleDocument, islandDepthById, maxDepth]);
  const selectedPerspectiveCardId = selectedCardIds.length === 1 ? selectedCardIds[0] : null;
  const perspectiveRendering = useMemo(() => {
    if (!focusedVisibleDocument) {
      return null;
    }

    return computePerspectiveRendering(
      focusedVisibleDocument,
      {
        perspectiveMode,
        perspectiveStrictFilter,
      },
      {
        selectedCardId: selectedPerspectiveCardId,
      },
    );
  }, [focusedVisibleDocument, perspectiveMode, perspectiveStrictFilter, selectedPerspectiveCardId]);
  const hiddenCardIdSet = useMemo(() => {
    const collapsedHiddenCardIds = new Set<string>();
    const depthHiddenCardIds = new Set<string>();
    const summaryHiddenCardIds = new Set<string>();
    const searchHiddenCardIds = new Set<string>();
    const mergedHiddenCardIds = new Set<string>();
    const shelvedCardIds = new Set<string>();

    if (focusedVisibleDocument) {
      // 1) collapseで隠れるカード
      const collapsedHidden = getCollapsedHiddenCardIds(focusedVisibleDocument, effectiveCollapsedIslandIdSet);
      for (const cardId of collapsedHidden) {
        collapsedHiddenCardIds.add(cardId);
      }

      if (summaryView && !focusTarget.focusIslandId) {
        for (const island of focusedVisibleDocument.islands) {
          const canRevealMembers =
            summaryRevealIslandIds.has(island.id) || temporaryRevealIslandIds.has(island.id) || peekIslandId === island.id;
          if (canRevealMembers) {
            continue;
          }

          for (const cardId of island.cardIds) {
            summaryHiddenCardIds.add(cardId);
          }
        }
      }

      if (abstractMapView) {
        for (const island of focusedVisibleDocument.islands) {
          const canRevealMembers =
            summaryRevealIslandIds.has(island.id) || temporaryRevealIslandIds.has(island.id) || peekIslandId === island.id;
          if (canRevealMembers) {
            continue;
          }

          for (const cardId of island.cardIds) {
            summaryHiddenCardIds.add(cardId);
          }
        }
      }

      // 2) depth制限で隠れるカード
      if (maxDepth !== "all") {
        for (const card of focusedVisibleDocument.cards) {
          if ((cardMinDepthById.get(card.id) ?? 0) > maxDepth) {
            depthHiddenCardIds.add(card.id);
          }
        }
      }
    }

    // 3) 検索非一致を隠す
    if (hideNonMatches && normalizedSearchQuery.length > 0 && focusedVisibleDocument) {
      for (const card of focusedVisibleDocument.cards) {
        if (!matchedCardIdSet.has(card.id)) {
          searchHiddenCardIds.add(card.id);
        }
      }
    }

    // 3b) ドメイン状態フィルタ（未レビュー/根拠なし/違和感）の非該当を隠す（DOMAIN-EXPR-01）
    if (hideNonStateMatches && domainStateMatchedIdSet && focusedVisibleDocument) {
      for (const card of focusedVisibleDocument.cards) {
        if (!domainStateMatchedIdSet.has(card.id)) {
          searchHiddenCardIds.add(card.id);
        }
      }
    }

    // 4) peek中の島のカードは collapse 隠しから除外
    if (peekIslandId && focusedVisibleDocument) {
      const peekIsland = focusedVisibleDocument.islands.find((island) => island.id === peekIslandId);
      if (peekIsland) {
        for (const cardId of peekIsland.cardIds) {
          collapsedHiddenCardIds.delete(cardId);
        }
      }
    }

    if (hideMergedOriginals && focusedVisibleDocument) {
      for (const card of focusedVisibleDocument.cards) {
        if (typeof card.mergedIntoCardId === "string" && card.mergedIntoCardId.length > 0) {
          mergedHiddenCardIds.add(card.id);
        }
      }
    }

    for (const entry of focusedVisibleDocument?.shelf ?? []) {
      shelvedCardIds.add(entry.cardId);
    }

    // merge
    const hiddenCardIds = new Set<string>(collapsedHiddenCardIds);
    for (const cardId of depthHiddenCardIds) hiddenCardIds.add(cardId);
    for (const cardId of summaryHiddenCardIds) hiddenCardIds.add(cardId);
    for (const cardId of searchHiddenCardIds) hiddenCardIds.add(cardId);
    for (const cardId of mergedHiddenCardIds) hiddenCardIds.add(cardId);
    for (const cardId of shelvedCardIds) hiddenCardIds.add(cardId);
    for (const cardId of temporaryRevealCardIds) {
      if (!depthHiddenCardIds.has(cardId) && !shelvedCardIds.has(cardId)) {
        hiddenCardIds.delete(cardId);
      }
    }

    return hiddenCardIds;
  }, [
    cardMinDepthById,
    effectiveCollapsedIslandIdSet,
    focusTarget.focusIslandId,
    focusedVisibleDocument,
    hideNonMatches,
    hideNonStateMatches,
    domainStateMatchedIdSet,
    hideMergedOriginals,
    matchedCardIdSet,
    maxDepth,
    normalizedSearchQuery,
    peekIslandId,
    summaryRevealIslandIds,
    summaryView,
    abstractMapView,
    temporaryRevealCardIds,
    temporaryRevealIslandIds,
  ]);

  const hierarchyHiddenCardIdSet = useMemo(() => {
    if (!focusedVisibleDocument || hierarchyLevel !== "overview") {
      return new Set<string>();
    }

    return collectHierarchyPlacardHiddenCardIds(focusedVisibleDocument, hierarchyLevel);
  }, [focusedVisibleDocument, hierarchyLevel]);

  const perspectiveHiddenCardIdSet = useMemo(() => {
    if (!focusedVisibleDocument || !perspectiveRendering?.visibleCardIds) {
      return new Set<string>();
    }

    return new Set(
      focusedVisibleDocument.cards
        .map((card) => card.id)
        .filter((cardId) => !perspectiveRendering.visibleCardIds?.has(cardId))
        .sort((left, right) => left.localeCompare(right)),
    );
  }, [focusedVisibleDocument, perspectiveRendering]);

  const effectiveHiddenCardIdSet = useMemo(() => {
    if (perspectiveHiddenCardIdSet.size === 0 && hierarchyHiddenCardIdSet.size === 0) {
      return hiddenCardIdSet;
    }

    return new Set([...hiddenCardIdSet, ...perspectiveHiddenCardIdSet, ...hierarchyHiddenCardIdSet]);
  }, [hiddenCardIdSet, perspectiveHiddenCardIdSet, hierarchyHiddenCardIdSet]);

  const visibleCardIdSet = useMemo(() => {
    if (!focusedVisibleDocument) {
      return new Set<string>();
    }

    return new Set(
      focusedVisibleDocument.cards
        .map((card) => card.id)
        .filter((cardId) => !effectiveHiddenCardIdSet.has(cardId))
    );
  }, [effectiveHiddenCardIdSet, focusedVisibleDocument]);

  const canUndo = (history?.past.length ?? 0) > 0;
  const canRedo = (history?.future.length ?? 0) > 0;
  const pendingCardDragSnapshotRef = useRef<DocumentV1 | null>(null);
  const loadDocumentGenerationRef = useRef(0);
  const lastDraggedCardIdRef = useRef<string | null>(null);
  const suppressNextTransformPersistRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const compareImportInputRef = useRef<HTMLInputElement | null>(null);
  const reviewPackInputRef = useRef<HTMLInputElement | null>(null);
  const cardsById = useMemo(() => new Map((document?.cards ?? []).map((card) => [card.id, card])), [document]);
  const latestMergeDecisionAuditByGroup = useMemo(() => {
    const latest = new Map<string, MergeDecisionAuditEvent>();
    for (const event of mergeDecisionAuditEvents) {
      const current = latest.get(event.groupId);
      if (!current || current.decidedAt <= event.decidedAt) {
        latest.set(event.groupId, event);
      }
    }
    return latest;
  }, [mergeDecisionAuditEvents]);

  const handleExportMergeDecisionAuditEvents = useCallback(() => {
    if (mergeDecisionAuditEvents.length === 0) {
      setStatusMessage(t("merge_suggestions.status.no_audit_events_to_export"));
      return;
    }

    const lines = mergeDecisionAuditEvents.map((event) => JSON.stringify(event));
    downloadTextFile("merge-decision-audit-events.jsonl", "application/x-ndjson", `${lines.join("\n")}\n`);
    setStatusMessage(t("merge_suggestions.status.exported_audit_events", { count: mergeDecisionAuditEvents.length }));
  }, [mergeDecisionAuditEvents]);
  const selectedAggregatedEdge = useMemo(() => {
    if (!selectedEdgeId) {
      return null;
    }

    return visibleAggregatedEdges.find((edge) => edge.id === selectedEdgeId) ?? null;
  }, [selectedEdgeId, visibleAggregatedEdges]);

  const selectedIslandRelationEdge = useMemo<IslandRelationEdgeSelection | null>(() => {
    if (!selectedAggregatedEdge || selectedAggregatedEdge.fromKind !== "island" || selectedAggregatedEdge.toKind !== "island") {
      return null;
    }

    if (selectedAggregatedEdge.isDerivedIslandEdge) {
      return {
        edgeId: selectedAggregatedEdge.id,
        fromIslandId: selectedAggregatedEdge.fromId,
        toIslandId: selectedAggregatedEdge.toId,
        type: selectedAggregatedEdge.type,
        isDerived: true,
        contributingEdgeIds: selectedAggregatedEdge.contributingEdgeIds ?? [],
        contributingCardIds: selectedAggregatedEdge.contributingCardIds ?? [],
      };
    }

    const sourceEdgeId = selectedAggregatedEdge.sources[0]?.sourceEdgeId ?? selectedAggregatedEdge.id;

    return {
      edgeId: sourceEdgeId,
      fromIslandId: selectedAggregatedEdge.fromId,
      toIslandId: selectedAggregatedEdge.toId,
      type: selectedAggregatedEdge.type,
      isDerived: false,
    };
  }, [selectedAggregatedEdge]);


  const selectedRelationSummary = useMemo<RelationSummary | null>(() => {
    if (!document || !selectedIslandRelationEdge) {
      return null;
    }

    const sourceSignature = buildRelationSummarySourceSignature(selectedIslandRelationEdge);
    return getRelationSummaryBySourceSignature(document, sourceSignature);
  }, [document, selectedIslandRelationEdge]);

  const rememberRecentDocumentId = useCallback((docId: string) => {
    setRecentDocumentIds(appStorage.pushRecentDocumentId(docId));
  }, [appStorage]);

  // AI-MODEL-GOVERNANCE-01 (R2): load the tenant's allowed active models for
  // the model selector. The fetch goes through the guarded tenant-session
  // wrapper so a stale session cannot leak the listing. Advisory: on failure
  // the selector collapses (backend default applies).
  useEffect(() => {
    let cancelled = false;
    void runTenantScopedApiRequest(() => fetchAvailableModels({ tenantSessionContext: verifiedTenantSession }))
      .then((result) => {
        if (!cancelled) {
          setAvailableModels(result.models);
          setAvailableModelsUnavailableReason(result.unavailableReason ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableModels([]);
          setAvailableModelsUnavailableReason(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runTenantScopedApiRequest, verifiedTenantSession]);

  // 第2反復: fetch the full canvas list when the recent-documents dialog opens.
  // "my documents" filters by the current principal's created_by.
  useEffect(() => {
    if (!isRecentDocumentsDialogOpen) return;
    let cancelled = false;
    setIsCanvasListLoading(true);
    const createdBy = myDocumentsOnly ? (storageScope?.principalId ?? undefined) : undefined;
    void runTenantScopedApiRequest(() => listDocuments({ tenantSessionContext: verifiedTenantSession }, createdBy))
      .then((documents) => {
        if (cancelled) return;
        setCanvasDocuments(documents);
      })
      .catch(() => {
        if (cancelled) return;
        setCanvasDocuments(null);
      })
      .finally(() => {
        if (!cancelled) setIsCanvasListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isRecentDocumentsDialogOpen, myDocumentsOnly, runTenantScopedApiRequest, storageScope?.principalId, verifiedTenantSession]);

  // 第2反復: archive / unarchive the selected document, then refresh the list.
  const applyLifecycleTransition = useCallback(async (docId: string, action: "archive" | "unarchive") => {
    if (isArchiving) return;
    setIsArchiving(true);
    try {
      const call = action === "archive"
        ? runTenantScopedApiRequest(() => archiveDocument(docId, { tenantSessionContext: verifiedTenantSession }))
        : runTenantScopedApiRequest(() => unarchiveDocument(docId, { tenantSessionContext: verifiedTenantSession }));
      await call;
      setCanvasDocuments(null); // force refetch on the next open
      // Reflect the lifecycle change on the currently-open document without
      // waiting for a refetch (archive -> review-only now, unarchive -> editable).
      if (docId === activeDocumentId) {
        setIsActiveDocumentArchived(action === "archive");
      }
    } catch {
      setStatusMessage(t("app.status.lifecycle_transition_failed"));
    } finally {
      setIsArchiving(false);
    }
  }, [activeDocumentId, archiveDocument, isArchiving, runTenantScopedApiRequest, t, unarchiveDocument, verifiedTenantSession]);

  const handleArchiveDocument = useCallback((docId: string) => {
    void applyLifecycleTransition(docId, "archive");
  }, [applyLifecycleTransition]);

  const handleUnarchiveDocument = useCallback((docId: string) => {
    void applyLifecycleTransition(docId, "unarchive");
  }, [applyLifecycleTransition]);

  const applyResolvedLocaleForView = useCallback((args: {
    docId: string;
    viewMode: ViewMode;
    metadataLocale?: string | null;
    persistedLocale?: string | null;
  }) => {
    const resolved = resolveViewLocale({
      search: locationSearch,
      isReadOnly,
      metadataLocale: args.metadataLocale,
      persistedLocale: args.persistedLocale,
    });

    viewLocalePersistenceScopeRef.current.updateScope({
      docId: args.docId,
      viewMode: args.viewMode,
      allowPersistence: resolved.shouldPersist,
    });
    setActiveLocale(resolved.locale);
  }, [isReadOnly, locationSearch]);

  // FB-RM-UX-01: loadPublicPack and loadDocument must not re-run on
  // isReadOnly/locationSearch changes (they feed a mount-only effect), but
  // they call the latest applyResolvedLocaleForView. Keep the latest callback
  // in a ref so the closure stays fresh without widening their deps. Without
  // this, opening an archived document (isReadOnly flip) re-ran the mount
  // effect and reloaded the default document mid-session.
  const applyResolvedLocaleForViewRef = useRef(applyResolvedLocaleForView);
  applyResolvedLocaleForViewRef.current = applyResolvedLocaleForView;

  const loadDocument = useCallback(
    async (
      docId: string,
      options?: { allowCreateOnNotFound?: boolean; isReload?: boolean; isArchived?: boolean },
    ): Promise<boolean> => {
      const allowCreateOnNotFound = options?.allowCreateOnNotFound ?? false;
      const isReload = options?.isReload ?? false;
      // ADR-0073 D2=A: an archived document opens in review-only mode. The
      // caller (canvas list) knows lifecycle_state; other open paths default
      // to editable and the server 423 backstop guards any miss.
      setIsActiveDocumentArchived(options?.isArchived ?? false);
      loadDocumentGenerationRef.current += 1;
      const generation = loadDocumentGenerationRef.current;
      const isStale = () => loadDocumentGenerationRef.current !== generation;
      if (isReload) {
        setIsReloadingDocument(true);
      }
      setIsLoading(true);
      setStatusMessage(t(isReload ? "app.status.document_reloading" : "app.status.document_loading"));

      try {
        const loaded = await runTenantScopedApiRequest(() => getDocument(docId, {
          tenantSessionContext: verifiedTenantSession,
        }));
        if (isStale()) {
          return false;
        }
        const loadedDocument = normalizeDocument(loaded.document);

        setHistory({
          past: [],
          present: cloneDocument(loadedDocument),
          future: [],
        });
        setActiveDocumentId(loadedDocument.id);
        const loadedViewMode = appStorage.loadViewModeForDocument(loadedDocument.id) ?? "explore";
        setViewMode(loadedViewMode);
        applyResolvedLocaleForViewRef.current({
          docId: loadedDocument.id,
          viewMode: loadedViewMode,
          persistedLocale: appStorage.loadViewLocaleForDocumentView(loadedDocument.id, loadedViewMode),
        });
        rememberRecentDocumentId(loadedDocument.id);
        setSelectedRecentDocumentId(loadedDocument.id);
        setDocEtag(loaded.etag ?? null);
        setSelectedCardIds([]);
        setSelectedIslandId(null);
        setIsDirty(false);
        setHasSaveConflict(false);
        setSuggestedDocument(null);
        setSuggestionId(null);
        setSuggestionNotes(null);
        setSuggestionError(null);
        setMergeAuditLog([]);
      setReviewEvents([]);
        setMergeSourceInfo({ kind: "unknown" });
        const persistedVisibility = appStorage.loadViewVisibilityForDocument(loadedDocument.id);
        setViewVisibility(persistedVisibility.viewVisibility);
        setPackVisibility(persistedVisibility.packVisibility);
        pendingCardDragSnapshotRef.current = null;
        setStatusMessage(t("app.status.document_loaded"));
        return true;
      } catch (error) {
        if (allowCreateOnNotFound && error instanceof ApiError && error.status === 404) {
          const defaultDocument = createDefaultDocument(docId);

          try {
            const saved = await runTenantScopedApiRequest(() => putDocument(
              docId,
              defaultDocument,
              undefined,
              { tenantSessionContext: verifiedTenantSession },
            ));
            if (isStale()) {
              return false;
            }
            const savedDocument = normalizeDocument(saved.document);

            setHistory({
              past: [],
              present: cloneDocument(savedDocument),
              future: [],
            });
            setActiveDocumentId(savedDocument.id);
            const loadedViewMode = appStorage.loadViewModeForDocument(savedDocument.id) ?? "explore";
            setViewMode(loadedViewMode);
            applyResolvedLocaleForViewRef.current({
              docId: savedDocument.id,
              viewMode: loadedViewMode,
              persistedLocale: appStorage.loadViewLocaleForDocumentView(savedDocument.id, loadedViewMode),
            });
            rememberRecentDocumentId(savedDocument.id);
            setSelectedRecentDocumentId(savedDocument.id);
            setDocEtag(saved.etag ?? null);
            setSelectedCardIds([]);
            setSelectedIslandId(null);
            setIsDirty(false);
            setHasSaveConflict(false);
            setSuggestedDocument(null);
            setSuggestionId(null);
            setSuggestionNotes(null);
            setSuggestionError(null);
            setMergeAuditLog([]);
      setReviewEvents([]);
            setMergeSourceInfo({ kind: "unknown" });
            const persistedVisibility = appStorage.loadViewVisibilityForDocument(savedDocument.id);
            setViewVisibility(persistedVisibility.viewVisibility);
            setPackVisibility(persistedVisibility.packVisibility);
            pendingCardDragSnapshotRef.current = null;
            setStatusMessage(t("app.status.document_created"));
            return true;
          } catch (saveError) {
            if (
              saveError instanceof ApiError
              && saveError.code === "tenant_session_changed"
            ) {
              return false;
            }
            setStatusMessage(formatCreateDocumentFailure(saveError));
            return false;
          }
        } else {
          if (
            error instanceof ApiError
            && error.code === "tenant_session_changed"
          ) {
            return false;
          }
          if (error instanceof ApiError && error.status === 404) {
            setStatusMessage(t("app.status.document_not_found_recovery", { docId }));
          } else if (error instanceof ApiError && error.status === 422) {
            // DOGFOOD-02: a stored doc that fails the A1 contract (e.g. an
            // older version) is a known state, not a server failure. Guide
            // the user to a recovery path (built-in sample / another doc)
            // instead of the generic load-failed message.
            setStatusMessage(t("app.status.document_stale_version_recovery", { docId }));
          } else {
            setStatusMessage(formatLoadDocumentFailure(error));
          }
          return false;
        }
      } finally {
        if (!isStale()) {
          setIsLoading(false);
          if (isReload) {
            setIsReloadingDocument(false);
          }
        }
      }
    },
    [
      // FB-RM-UX-01: keep loadDocument identity stable across isReadOnly /
      // locationSearch changes (applyResolvedLocaleForView depends on both) so
      // the mount-only effect it feeds does not re-run and reload the default
      // document mid-session. The latest callback is read via the ref above.
      appStorage,
      rememberRecentDocumentId,
      runTenantScopedApiRequest,
      verifiedTenantSession,
    ]
  );

  const applyDocumentChange = useCallback(
    (
      nextDocument: DocumentV1,
      nextStatusMessage?: string,
      options?: {
        preserveSuggestionPreview?: boolean;
        preserveMergeSuggestions?: boolean;
      }
    ): boolean => {
      if (isReadOnly) {
        setStatusMessage(buildReadOnlyBlockedMessage(nextStatusMessage));
        return false;
      }

      pendingCardDragSnapshotRef.current = null;

      setHistory((previousHistory) => {
        if (!previousHistory) {
          return previousHistory;
        }

        return pushHistorySnapshot(previousHistory, nextDocument);
      });
      setIsDirty(true);
      if (!options?.preserveSuggestionPreview) {
        setSuggestedDocument(null);
        setSuggestionId(null);
        setSuggestionNotes(null);
        setSuggestionError(null);
        setIsAnnotateOverlayEnabled(false);
      }
      if (!options?.preserveMergeSuggestions) {
        setMergeSuggestions([]);
      }
      setMergeSuggestionError(null);
      setHasSaveConflict(false);
      if (nextStatusMessage) {
        setStatusMessage(nextStatusMessage);
      }

      return true;
    },
    [isReadOnly]
  );

  const handleUpdateDocumentTitle = useCallback(
    (newTitle: string) => {
      if (!document) return;
      const updated: DocumentV1 = { ...document, title: newTitle };
      applyDocumentChange(updated, undefined, { preserveSuggestionPreview: true });
    },
    [document, applyDocumentChange],
  );

  const handleSuggestDocumentTitle = useCallback(
    async (islandTitles: string[], cardTexts: string[], currentTitle: string | undefined) => {
      try {
        return await runTenantScopedApiRequest(() => suggestDocumentTitle(islandTitles, cardTexts, currentTitle, documentTitleModel, document?.cards, {
          tenantSessionContext: verifiedTenantSession,
        }));
      } catch (error) {
        if (
          error instanceof ApiError
          && ["model_not_allowed", "model_not_registered", "model_provider_unavailable"].includes(error.code ?? "")
        ) {
          throw new Error(t("ai.model_policy_changed"));
        }
        const fallback = error instanceof ApiError ? error.message : t("app.status.error_detail_unknown");
        throw new Error(resolveAiProviderErrorMessage(error, fallback));
      }
    },
    [document, documentTitleModel, runTenantScopedApiRequest, verifiedTenantSession],
  );

  const islandTitlesForSuggestion = useMemo(
    () =>
      (document?.islands ?? [])
        // SEC-AI-SAFEMODE-03: title suggestion certifies its payload as
        // human-reviewed at the API boundary, so unreviewed island titles
        // must be excluded just like unreviewed card text below.
        .filter((island) => island.titleReviewed === true)
        .map((island) => island.title)
        .filter((title): title is string => !!title),
    [document],
  );

  const cardTextsForSuggestion = useMemo(
    () =>
      (document?.cards ?? [])
        // SEC-AI-SAFEMODE-01: only reviewed card text may inform the title
        // suggestion (previously !== false also kept unreviewed/undefined).
        .filter((c) => (c as { textReviewed?: boolean }).textReviewed === true)
        .slice(0, 30)
        .map((c) => c.text),
    [document],
  );


  useEffect(() => {
    if (matchedCardIds.length === 0) {
      if (currentMatchIndex !== 0) {
        setCurrentMatchIndex(0);
      }
      return;
    }

    if (currentMatchIndex >= matchedCardIds.length) {
      setCurrentMatchIndex(0);
    }
  }, [currentMatchIndex, matchedCardIds]);

  const requestCanvasFocus = useCallback((cardId: string) => {
    setFocusCardId(cardId);
    setFocusRequestSeq((previousSeq) => previousSeq + 1);
  }, [abstractMapView, summaryView]);

  const requestCameraTransform = useCallback((nextTransform: { panX: number; panY: number; zoom: number }) => {
    suppressNextTransformPersistRef.current = true;
    setCameraTransformRequest((previousRequest) => ({
      panX: nextTransform.panX,
      panY: nextTransform.panY,
      zoom: nextTransform.zoom,
      requestSeq: (previousRequest?.requestSeq ?? 0) + 1,
    }));
  }, [abstractMapView, summaryView]);

  const pushCurrentFocusSnapshot = useCallback(() => {
    if (!canvasCamera) {
      return;
    }

    const currentSnapshot: FocusSnapshot = {
      camera: {
        panX: canvasCamera.panX,
        panY: canvasCamera.panY,
        zoom: canvasCamera.zoom,
      },
      viewState: {
        focusIslandId: focusTarget.focusIslandId,
        maxDepth,
      },
    };

    setFocusHistory((previousHistory) => pushFocusHistory(previousHistory, currentSnapshot));
  }, [canvasCamera, focusTarget.focusIslandId, maxDepth]);

  const handleSearchNext = useCallback(() => {
    if (matchedCardIds.length === 0) {
      return;
    }

    const nextIndex = (activeMatchIndex + 1) % matchedCardIds.length;
    const nextCardId = matchedCardIds[nextIndex];
    setCurrentMatchIndex(nextIndex);
    requestCanvasFocus(nextCardId);
  }, [activeMatchIndex, matchedCardIds, requestCanvasFocus]);

  const handleSearchPrev = useCallback(() => {
    if (matchedCardIds.length === 0) {
      return;
    }

    const prevIndex = (activeMatchIndex - 1 + matchedCardIds.length) % matchedCardIds.length;
    const prevCardId = matchedCardIds[prevIndex];
    setCurrentMatchIndex(prevIndex);
    requestCanvasFocus(prevCardId);
  }, [activeMatchIndex, matchedCardIds, requestCanvasFocus]);

  const handleTransformChange = useCallback(
    (nextTransform: DocumentV1["transform"]) => {
      const currentDocument = documentRef.current;
      if (!currentDocument || isPreviewingSuggestion) {
        return;
      }

      if (suppressNextTransformPersistRef.current) {
        suppressNextTransformPersistRef.current = false;
        return;
      }

      const current = currentDocument.transform;
      if (
        current.panX === nextTransform.panX &&
        current.panY === nextTransform.panY &&
        current.zoom === nextTransform.zoom
      ) {
        return;
      }

      setIsDirty(true);
      setHistory((previousHistory) => {
        if (!previousHistory) {
          return previousHistory;
        }

        return {
          ...previousHistory,
          present: {
            ...previousHistory.present,
            transform: nextTransform,
          },
        };
      });
    },
    [isPreviewingSuggestion]
  );

  const handleCardMove = useCallback(
    (cardId: string, deltaWorldX: number, deltaWorldY: number) => {
      if (!document || isReadOnly || isPreviewingSuggestion || (deltaWorldX === 0 && deltaWorldY === 0)) {
        return;
      }

      const nextCards = document.cards.map((card) => {
        if (card.id !== cardId) {
          return card;
        }

        const nextX = card.x + deltaWorldX;
        const nextY = card.y + deltaWorldY;

        return {
          ...card,
          x: isGridSnapEnabled ? snapValueToGrid(nextX, { gridSize: GRID_SNAP_SIZE }) : nextX,
          y: isGridSnapEnabled ? snapValueToGrid(nextY, { gridSize: GRID_SNAP_SIZE }) : nextY,
        };
      });

      const didMove = nextCards.some((card, index) => card !== document.cards[index]);
      if (!didMove) {
        return;
      }

      if (!pendingCardDragSnapshotRef.current) {
        pendingCardDragSnapshotRef.current = cloneDocument(document);
      }
      lastDraggedCardIdRef.current = cardId;

      setIsDirty(true);
      setHistory((previousHistory) => {
        if (!previousHistory) {
          return previousHistory;
        }

        return {
          ...previousHistory,
          present: {
            ...previousHistory.present,
            cards: nextCards,
          },
        };
      });
    },
    [document, isGridSnapEnabled, isReadOnly, isPreviewingSuggestion]
  );

  // Native drag bridge: CardView owns the transient preview. The application
  // applies the final movement once, retaining the island-join and Undo rules.
  // This remains SUI's local DocumentV1 edit; TEI runtime dispatch is separate.
  const handleCardMoveCommit = useCallback(
    (cardId: string, deltaWorldX: number, deltaWorldY: number) => {
      if (!document || isReadOnly || isPreviewingSuggestion) {
        return;
      }
      const nextDocument = commitCardDrag(document, {
        cardId,
        deltaWorldX,
        deltaWorldY,
        snapGridSize: isGridSnapEnabled ? GRID_SNAP_SIZE : undefined,
        cardWidth: CARD_WIDTH,
        cardHeight: CARD_HEIGHT,
      });
      if (nextDocument === document) {
        return;
      }
      applyDocumentChange(nextDocument, t("app.status.edit.moved_card"), {
        preserveSuggestionPreview: true,
        preserveMergeSuggestions: true,
      });
    },
    [document, isReadOnly, isPreviewingSuggestion, isGridSnapEnabled, applyDocumentChange]
  );

  const applyLayoutOperation = useCallback(
    (operationName: string, operation: (cards: DocumentV1["cards"]) => DocumentV1["cards"]) => {
      if (!document || isPreviewingSuggestion) {
        return;
      }

      const nextCards = operation(document.cards);
      if (nextCards === document.cards) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
        },
        operationName
      );
    },
    [applyDocumentChange, document, isPreviewingSuggestion]
  );

  const handleAlign = useCallback(
    (direction: AlignDirection) => {
      const statusKey = {
        left: "app.status.edit.aligned_left",
        right: "app.status.edit.aligned_right",
        top: "app.status.edit.aligned_top",
        bottom: "app.status.edit.aligned_bottom",
      }[direction];
      applyLayoutOperation(t(statusKey), (cards) => alignSelectedCards(cards, selectedCardIds, direction, {}));
    },
    [applyLayoutOperation, selectedCardIds]
  );

  const handleDistribute = useCallback(
    (direction: DistributeDirection) => {
      const status = t(direction === "horizontal" ? "app.status.edit.distributed_horizontally" : "app.status.edit.distributed_vertically");
      applyLayoutOperation(status, (cards) => distributeSelectedCards(cards, selectedCardIds, direction, {}));
    },
    [applyLayoutOperation, selectedCardIds]
  );


  useEffect(() => {
    const commitCardDragSnapshot = () => {
      const dragSnapshot = pendingCardDragSnapshotRef.current;
      pendingCardDragSnapshotRef.current = null;
      const draggedCardId = lastDraggedCardIdRef.current;
      lastDraggedCardIdRef.current = null;

      if (!dragSnapshot) {
        return;
      }

      // Commit the move as a SINGLE undo step. If the dropped card's center now
      // lands inside an island it is not yet a member of, fold that membership
      // change into the same commit so one undo reverts both the move and the
      // join. The membership computation is wrapped in try/catch so any geometry
      // error falls back to a plain move and can never break card dragging.
      setHistory((previousHistory) => {
        if (!previousHistory) {
          return previousHistory;
        }

        let present = previousHistory.present;

        if (draggedCardId && !isReadOnly) {
          try {
            const draggedCard = present.cards.find((card) => card.id === draggedCardId);
            if (draggedCard) {
              const centerX = draggedCard.x + CARD_WIDTH / 2;
              const centerY = draggedCard.y + CARD_HEIGHT / 2;
              const localCardsById = new Map(
                present.cards.map((card): [string, typeof card] => [card.id, card])
              );
              const targetIsland = present.islands.find((island) => {
                if (island.cardIds.includes(draggedCardId)) {
                  return false;
                }
                const bounds = getIslandWorldBounds(island, localCardsById);
                if (!bounds) {
                  return false;
                }
                return (
                  centerX >= bounds.x &&
                  centerX <= bounds.x + bounds.w &&
                  centerY >= bounds.y &&
                  centerY <= bounds.y + bounds.h
                );
              });
              if (targetIsland) {
                // R2(a): moveCardToIsland() removes draggedCardId from any island it
                // already belonged to — leaving it behind would let the same card belong
                // to two islands at once, which getIslandsForCard() treats as valid
                // (card→island is one-to-many there) while most other call sites assume
                // single membership.
                present = {
                  ...present,
                  islands: moveCardToIsland(present.islands, draggedCardId, targetIsland.id),
                };
              }
            }
          } catch {
            present = previousHistory.present;
          }
        }

        const nextPast = [...previousHistory.past, dragSnapshot];
        const trimmedPast =
          nextPast.length > HISTORY_LIMIT ? nextPast.slice(nextPast.length - HISTORY_LIMIT) : nextPast;

        return {
          past: trimmedPast,
          present: cloneDocument(present),
          future: [],
        };
      });
      setStatusMessage(t("app.status.edit.moved_card"));
    };

    window.addEventListener("pointerup", commitCardDragSnapshot);
    window.addEventListener("pointercancel", commitCardDragSnapshot);

    return () => {
      window.removeEventListener("pointerup", commitCardDragSnapshot);
      window.removeEventListener("pointercancel", commitCardDragSnapshot);
    };
  }, [abstractMapView, summaryView, isReadOnly]);

  const handleSave = async (): Promise<boolean> => {
    if (!document || isSaving || !isDirty) {
      return false;
    }

    setIsSaving(true);
    setStatusMessage(t("app.status.saving"));

    try {
      const saved = await runTenantScopedApiRequest(() => putDocument(
        document.id,
        withUpdatedTimestamp(document),
        docEtag ?? undefined,
        { tenantSessionContext: verifiedTenantSession },
      ));
      const savedDocument = normalizeDocument(saved.document);
      pendingCardDragSnapshotRef.current = null;
      setHistory({
        past: [],
        present: cloneDocument(savedDocument),
        future: [],
      });
      setActiveDocumentId(savedDocument.id);
      rememberRecentDocumentId(savedDocument.id);
      setSelectedRecentDocumentId(savedDocument.id);
      setDocEtag(saved.etag ?? null);
      setIsDirty(false);
      setHasSaveConflict(false);
      setStatusMessage(t("app.status.saved"));
      return true;
    } catch (error) {
      if (
        error instanceof ApiError
        && error.code === "tenant_session_changed"
      ) {
        return false;
      }
      if (error instanceof ApiError && error.status === 409) {
        setHasSaveConflict(true);
        setStatusMessage(t("app.status.save_conflict"));
        return false;
      }

      setStatusMessage(formatSaveDocumentFailure(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const focusTenantControl = () => {
    window.setTimeout(() => tenantControlRef.current?.focus(), 0);
  };

  const performTenantSwitch = async (
    requestedTenantId: string,
    unsavedDecision?: Exclude<TenantSwitchUnsavedDecision, "cancel">,
  ) => {
    if (!verifiedTenantSession || !appStorage.scope) {
      setTenantSwitchUiState({ status: "blocked" });
      return;
    }

    const controller = new AbortController();
    tenantSwitchAbortRef.current?.abort();
    tenantSwitchAbortRef.current = controller;
    setTenantSwitchUiState({ status: "switching" });

    try {
      const result = await requestTenantSessionTransition({
        currentSessionContext: verifiedTenantSession,
        requestedTenantId,
        deployment: appStorage.scope.deployment,
        previousScope: appStorage.scope,
        clearPreviousScope: appStorage.clearScope,
        cleanupSteps: [
          cleanupRuntimeResources,
          () => {
            if (importedPackSnapshotUrl) {
              URL.revokeObjectURL(importedPackSnapshotUrl);
            }
          },
          () => {
            if (highlightTimeoutRef.current !== null) {
              window.clearTimeout(highlightTimeoutRef.current);
              highlightTimeoutRef.current = null;
            }
          },
        ],
        hasUnsavedChanges: isDirty,
        requestUnsavedDecision: unsavedDecision
          ? async () => unsavedDecision
          : undefined,
        saveUnsavedChanges: unsavedDecision === "save"
          ? handleSave
          : undefined,
        notifySessionChanged: () => {
          tenantSessionCoherenceRef.current?.publishSessionChanged();
        },
        signal: controller.signal,
      });

      if (
        result.status === "cancelled"
        || result.status === "save-failed"
        || result.status === "unchanged"
      ) {
        setTenantSwitchUiState({ status: "idle" });
        focusTenantControl();
      }
    } catch (error) {
      if (
        controller.signal.aborted
        || (
          error
          && typeof error === "object"
          && "name" in error
          && error.name === "AbortError"
        )
      ) {
        return;
      }
      setTenantSwitchUiState({ status: "blocked" });
    } finally {
      if (tenantSwitchAbortRef.current === controller) {
        tenantSwitchAbortRef.current = null;
      }
    }
  };

  const handleTenantChangeRequest = (requestedTenantId: string) => {
    if (!verifiedTenantSession || tenantSwitchUiState.status !== "idle") {
      return;
    }
    const requestedTenant = verifiedTenantSession.availableTenants.find(
      (tenant) => tenant.id === requestedTenantId,
    );
    if (
      !requestedTenant
      || requestedTenant.id === verifiedTenantSession.activeTenant.id
    ) {
      return;
    }
    if (isDirty) {
      setTenantSwitchUiState({
        status: "confirming",
        requestedTenantId: requestedTenant.id,
        requestedTenantDisplayName: requestedTenant.displayName,
      });
      return;
    }
    void performTenantSwitch(requestedTenant.id);
  };

  const handleTenantSwitchDecision = (decision: TenantSwitchUnsavedDecision) => {
    if (tenantSwitchUiState.status !== "confirming") {
      return;
    }
    if (decision === "cancel") {
      setTenantSwitchUiState({ status: "idle" });
      focusTenantControl();
      return;
    }
    void performTenantSwitch(tenantSwitchUiState.requestedTenantId, decision);
  };

  const handleNewDocument = useCallback(() => {
    const newDocId = crypto.randomUUID();
    const newDocument = createNewDocument(newDocId);

    pendingCardDragSnapshotRef.current = null;
    setHistory({
      past: [],
      present: cloneDocument(newDocument),
      future: [],
    });
    setActiveDocumentId(newDocId);
    setSelectedRecentDocumentId("");
    setDocEtag(null);
    setSelectedCardIds([]);
    setSelectedIslandId(null);
    setIsDirty(true);
    setHasSaveConflict(false);
    setSuggestedDocument(null);
    setSuggestionId(null);
    setSuggestionNotes(null);
    setSuggestionError(null);
    setStatusMessage(t("app.status.created_document"));
  }, [abstractMapView, summaryView]);

  const handleDuplicateDocument = useCallback(() => {
    if (!document) {
      return;
    }

    const duplicated = duplicateDocumentWithNewId(document);

    pendingCardDragSnapshotRef.current = null;
    setHistory({
      past: [],
      present: cloneDocument(duplicated),
      future: [],
    });
    setActiveDocumentId(duplicated.id);
    setSelectedRecentDocumentId("");
    setDocEtag(null);
    setSelectedCardIds([]);
    setSelectedIslandId(null);
    setIsDirty(true);
    setHasSaveConflict(false);
    setSuggestedDocument(null);
    setSuggestionId(null);
    setSuggestionNotes(null);
    setSuggestionError(null);
    setStatusMessage(t("app.status.duplicated_document"));
  }, [document]);

  const handleOpenRecent = useCallback(() => {
    // A public pack or built-in sample can share its id with a saved document
    // (docEtag is null until the server copy is loaded), so only skip the reload
    // when the active document already came from the server.
    if (!selectedRecentDocumentId || (selectedRecentDocumentId === activeDocumentId && docEtag !== null)) {
      return;
    }
    // ADR-0073 D2=A: an archived canvas opens review-only. The canvas list is
    // the only surface that knows lifecycle_state, so it drives the flag.
    const selectedDoc = canvasDocuments?.find((doc) => doc.id === selectedRecentDocumentId);
    void loadDocument(selectedRecentDocumentId, { isArchived: selectedDoc?.lifecycle_state === "archived" });
  }, [activeDocumentId, canvasDocuments, docEtag, loadDocument, selectedRecentDocumentId]);

  const handleProposeOpposingViewpoint = useCallback(async (cardId: string) => {
    if (!document || isProposingOpposingViewpoint) return;
    if (aiBlockedByUnreviewed()) return;
    setIsProposingOpposingViewpoint(true);
    try {
      const proposal = await runTenantScopedApiRequest(() => proposeOpposingViewpoint(
        document,
        cardId,
        undefined,
        { tenantSessionContext: verifiedTenantSession },
      ));
      setOpposingViewpointProposal(proposal);
      setStatusMessage(t("app.status.opposing_viewpoint.ready"));
    } catch (error) {
      const fallback = error instanceof ApiError ? error.message : t("app.status.error_detail_unknown");
      setStatusMessage(t("app.status.opposing_viewpoint.failed", { detail: resolveAiProviderErrorMessage(error, fallback) }));
    } finally {
      setIsProposingOpposingViewpoint(false);
    }
  }, [document, isProposingOpposingViewpoint, runTenantScopedApiRequest, verifiedTenantSession]);

  const handleSuggestIslandSummary = useCallback(async (critiqueText?: string) => {
    if (!document || !selectedIslandId || isSuggestingIslandSummary) {
      return;
    }
    if (aiBlockedByUnreviewed()) {
      return;
    }

    const targetIsland = document.islands.find((island) => island.id === selectedIslandId);
    if (!targetIsland) {
      return;
    }

    setIsSuggestingIslandSummary(true);
    setStatusMessage(t("app.status.island_summary.requesting"));

    try {
      const proposal = await runTenantScopedApiRequest(() => proposeIslandSummary(
        document,
        targetIsland.id,
        `${document.id}:${document.updatedAt}`,
        islandSummaryModel,
        { tenantSessionContext: verifiedTenantSession },
        critiqueText,
      ));
      setIslandSummaryProposal(proposal);
      setStatusMessage(t("app.status.island_summary.ready_unreviewed"));
      setLastAiCallOutcome("ok");
    } catch (error) {
      const fallback = error instanceof ApiError ? error.message : t("app.status.error_detail_unknown");
      const detail = resolveAiProviderErrorMessage(error, fallback);
      setStatusMessage(t("app.status.island_summary.failed", { detail }));
      setLastAiCallOutcome(classifyAiProviderError(error));
    } finally {
      setIsSuggestingIslandSummary(false);
    }
  }, [
    document,
    islandSummaryModel,
    isSuggestingIslandSummary,
    runTenantScopedApiRequest,
    selectedIslandId,
    verifiedTenantSession,
  ]);

  const handleAdoptIslandSummaryProposal = useCallback(async (candidateIndex: number, critiqueText?: string) => {
    if (!document || !selectedIslandId || !islandSummaryProposal || isRecordingIslandSummaryDecision) {
      return;
    }
    // DOGFOOD-34 (Phase 2b): adopt the user-selected candidate; fall back to
    // the primary (diff.after) when the candidate is missing (older proposal).
    const selectedCandidate = islandSummaryProposal.diff.candidates?.[candidateIndex];
    const summaryText = selectedCandidate?.summaryText ?? islandSummaryProposal.diff.after;
    const groundingIds = selectedCandidate?.groundingIds ?? islandSummaryProposal.diff.groundingIds;
    let nextDocument = updateIslandSummaryWithHistory(
      document,
      selectedIslandId,
      {
        summaryText,
        summaryReviewed: false,
        summaryGrounding: groundingIds,
      },
      { changeKind: "ai" }
    );
    // DOGFOOD-35: persist the 壁打ち (wall-hitting) trail — the human critique
    // and the re-proposal diff — so the adopted summary stays explainable and
    // reversible (ADR-0040 DOMAIN-EXPR-03). Critique is user-authored (not
    // unreviewed card text), so this does not relax SafeMode.
    const trimmedCritique = critiqueText?.trim();
    if (trimmedCritique) {
      const iteration = (document.critiqueInputs?.length ?? 0) + 1;
      const critique: CritiqueInput = {
        schemaVersion: "1.0.0",
        critiqueId: crypto.randomUUID(),
        targetRef: `island:${selectedIslandId}`,
        critiqueType: "feels_off",
        createdAt: new Date().toISOString(),
        iteration,
        comment: trimmedCritique,
      };
      const reproposal: ReproposalDiff = {
        schemaVersion: "1.0.0",
        proposalId: islandSummaryProposal.proposalId,
        basedOnIteration: iteration,
        diffOps: [
          {
            opId: crypto.randomUUID(),
            opType: "relabel",
            targetRef: `island:${selectedIslandId}`,
            before: islandSummaryProposal.diff.before != null ? { summaryText: islandSummaryProposal.diff.before } : null,
            after: { summaryText },
          },
        ],
        traceKey: `${islandSummaryProposal.proposalId}:${critique.critiqueId}`,
        rationale: trimmedCritique,
      };
      nextDocument = {
        ...nextDocument,
        critiqueInputs: [...(nextDocument.critiqueInputs ?? []), critique],
        reproposalDiffs: [...(nextDocument.reproposalDiffs ?? []), reproposal],
      };
    }
    setIsRecordingIslandSummaryDecision(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      await runTenantScopedApiRequest(() => recordProposalDecision(
        {
          docId: document.id,
          proposalId: islandSummaryProposal.proposalId,
          sourceBundleHash: islandSummaryProposal.sourceBundleHash,
          idempotencyKey,
          decision: "adopt",
        },
        { tenantSessionContext: verifiedTenantSession },
      ));
      applyDocumentChange(nextDocument, t("app.status.island_summary.adopted_unreviewed"));
      setIslandSummarySuggestionWarningsByIslandId((previousWarnings) => ({
        ...previousWarnings,
        [selectedIslandId]: islandSummaryProposal.diff.warnings ?? [],
      }));
      setProposalAuditTrail((current) => {
        const next = [...current, `${new Date().toISOString()} adopted ${islandSummaryProposal.proposalId}`];
        return next.length > PROPOSAL_AUDIT_TRAIL_LIMIT ? next.slice(next.length - PROPOSAL_AUDIT_TRAIL_LIMIT) : next;
      });
      setIslandSummaryProposal(null);
    } finally {
      setIsRecordingIslandSummaryDecision(false);
    }
  }, [
    applyDocumentChange,
    document,
    islandSummaryProposal,
    isRecordingIslandSummaryDecision,
    runTenantScopedApiRequest,
    selectedIslandId,
    verifiedTenantSession,
  ]);

  const handleRejectIslandSummaryProposal = useCallback(async () => {
    if (!document || !islandSummaryProposal || isRecordingIslandSummaryDecision) {
      return;
    }
    setIsRecordingIslandSummaryDecision(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      await runTenantScopedApiRequest(() => recordProposalDecision(
        {
          docId: document.id,
          proposalId: islandSummaryProposal.proposalId,
          sourceBundleHash: islandSummaryProposal.sourceBundleHash,
          idempotencyKey,
          decision: "reject",
        },
        { tenantSessionContext: verifiedTenantSession },
      ));
      setProposalAuditTrail((current) => {
        const next = [...current, `${new Date().toISOString()} rejected ${islandSummaryProposal.proposalId}`];
        return next.length > PROPOSAL_AUDIT_TRAIL_LIMIT ? next.slice(next.length - PROPOSAL_AUDIT_TRAIL_LIMIT) : next;
      });
      setIslandSummaryProposal(null);
      setStatusMessage(t("app.status.island_summary.rejected"));
    } finally {
      setIsRecordingIslandSummaryDecision(false);
    }
  }, [
    islandSummaryProposal,
    isRecordingIslandSummaryDecision,
    document,
    runTenantScopedApiRequest,
    verifiedTenantSession,
  ]);

  const handleHoldIslandSummaryProposal = useCallback(async () => {
    if (!document || !islandSummaryProposal || isRecordingIslandSummaryDecision) {
      return;
    }
    setIsRecordingIslandSummaryDecision(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      await runTenantScopedApiRequest(() => recordProposalDecision(
        {
          docId: document.id,
          proposalId: islandSummaryProposal.proposalId,
          sourceBundleHash: islandSummaryProposal.sourceBundleHash,
          idempotencyKey,
          decision: "hold",
        },
        { tenantSessionContext: verifiedTenantSession },
      ));
      setProposalAuditTrail((current) => {
        const next = [...current, `${new Date().toISOString()} held ${islandSummaryProposal.proposalId}`];
        return next.length > PROPOSAL_AUDIT_TRAIL_LIMIT ? next.slice(next.length - PROPOSAL_AUDIT_TRAIL_LIMIT) : next;
      });
      setStatusMessage(t("app.status.island_summary.held"));
    } finally {
      setIsRecordingIslandSummaryDecision(false);
    }
  }, [
    islandSummaryProposal,
    isRecordingIslandSummaryDecision,
    document,
    runTenantScopedApiRequest,
    verifiedTenantSession,
  ]);

  // SEC-AI-SAFEMODE-01 (ADR-0068 D2=B): the backend rejects unreviewed card
  // text with 422. Proactively block the AI suggestion here (before the call)
  // and tell the user to review first, so the SPA does not depend on surfacing
  // the raw 422.
  const aiBlockedByUnreviewed = useCallback((): boolean => {
    const unreviewed = (document?.cards ?? []).filter((card) => card.textReviewed !== true).length;
    if (unreviewed > 0) {
      setStatusMessage(t("app.status.ai_requires_review", { count: unreviewed }));
      return true;
    }
    return false;
  }, [document, setStatusMessage, t]);

  const handleSuggestLayout = useCallback(async (mode: "suggest" | "resuggest" = "suggest") => {
    if (!document || isSuggesting) {
      return;
    }
    if (aiBlockedByUnreviewed()) {
      return;
    }
    if (mode === "resuggest" && resuggestStopperEnabled) {
      setStatusMessage(t("suggestion.panel.status.stopper_active_retry_limit"));
      return;
    }

    setIsSuggesting(true);
    setSuggestionError(null);
    setStatusMessage(t("suggestion.panel.status.requesting_draft"));

    try {
      const result = await runTenantScopedApiRequest(() => suggestLayout(
        document,
        suggestionInstruction.trim() || undefined,
        { tenantSessionContext: verifiedTenantSession },
      ));
      setSuggestionIteration((previous) => previous + 1);
      setSuggestionId(result.suggestionId);
      setSuggestedDocument(markSuggestedFieldsUnreviewed(cloneDocument(result.suggestedDoc), document));
      setSuggestionNotes(result.notes ?? null);
      setSuggestionError(null);
      setIsSuggestionPreviewEnabled(true);
      setIsAnnotateOverlayEnabled(false);
      if (mode === "suggest") {
        setResuggestAttemptCount(0);
        setResuggestStopperEnabled(false);
      }
      setStatusMessage(t("suggestion.panel.status.draft_ready"));
      setLastAiCallOutcome("ok");
    } catch (error) {
      const fallback = error instanceof Error ? error.message : t("suggestion.panel.status.failed_to_get_suggestion");
      const message = resolveAiProviderErrorMessage(error, fallback);
      setSuggestionError(message);
      setStatusMessage(message);
      setSuggestedDocument(null);
      setSuggestionId(null);
      setSuggestionNotes(null);
      const providerErrorKind = classifyAiProviderError(error);
      setLastAiCallOutcome(providerErrorKind);
      if (providerErrorKind === "disabled") {
        setProviderUnavailableMessage(message);
      }
      if (mode === "resuggest") {
        setResuggestAttemptCount((previous) => {
          const next = previous + 1;
          if (next >= resuggestAttemptLimit) {
            setResuggestStopperEnabled(true);
          }
          return next;
        });
      }
    } finally {
      setIsSuggesting(false);
    }
  }, [
    document,
    isSuggesting,
    resuggestStopperEnabled,
    runTenantScopedApiRequest,
    suggestionInstruction,
    verifiedTenantSession,
  ]);

  const handleDiscardSuggestion = useCallback(() => {
    setSuggestedDocument(null);
    setSuggestionId(null);
    setSuggestionNotes(null);
    setSuggestionError(null);
    setSuggestionIteration(1);
    setResuggestAttemptCount(0);
    setResuggestStopperEnabled(false);
    setIsSuggestionPreviewEnabled(true);
    setIsAnnotateOverlayEnabled(false);
    setStatusMessage(t("suggestion.panel.status.discarded_draft"));
  }, [abstractMapView, summaryView]);

  const handleSuggestMerges = useCallback(async () => {
    if (!document || isSuggestingMerges) {
      return;
    }
    if (aiBlockedByUnreviewed()) {
      return;
    }

    setIsSuggestingMerges(true);
    setMergeSuggestionError(null);
    setStatusMessage(t("merge_suggestions.status.collecting"));

    try {
      const remoteInstruction = mergeSuggestionInstruction.trim() || undefined;
      const localFallback = () => ({ suggestions: collectMergeCandidates(document) });

      let result: { suggestions: MergeSuggestion[] };
      try {
        result = await runTenantScopedApiRequest(() => suggestMerges(
          document,
          remoteInstruction,
          { tenantSessionContext: verifiedTenantSession },
        ));
      } catch (error) {
        const isApiUnavailable =
          error instanceof ApiError
          && (
            error.status === 404
            || error.status === 405
            || error.status === 501
            || (error.status === 503 && error.code === "provider_unavailable")
          );
        const isNetworkUnavailable = error instanceof TypeError;

        if (!isApiUnavailable && !isNetworkUnavailable) {
          throw error;
        }

        result = localFallback();
      }

      const latestDecisionByGroup = getLatestMergeSuggestionDecisionByGroup(document.mergeSuggestionDecisions);
      setMergeSuggestions(
        result.suggestions.map((suggestion) => {
          const latestDecision = latestDecisionByGroup.get(suggestion.groupId);
          const representativeTrace = resolveDecisionOriginTrace(document, suggestion.cardIds);
          return {
            ...suggestion,
            editedText: latestDecision?.editedText ?? suggestion.mergedTextDraft,
            isEdited: (latestDecision?.editedText ?? suggestion.mergedTextDraft) !== suggestion.mergedTextDraft,
            latestDecision: latestDecision?.decision,
            latestDecidedAt: latestDecision?.decidedAt,
            latestSelectedCardIds:
              latestDecision?.decision === "partial" ? latestDecision.selectedCardIds : undefined,
            representativeCardId: representativeTrace.representativeCardId || undefined,
            representativeResolvedBy: representativeTrace.representativeResolvedBy,
            representativeSourceCount:
              representativeTrace.sourceCardIds.length + representativeTrace.missingSourceCardIds.length,
          };
        })
      );
      setMergeSuggestionError(null);
      setStatusMessage(
        result.suggestions.length > 0
          ? t("merge_suggestions.status.ready", { count: result.suggestions.length })
          : t("merge_suggestions.status.none_found")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : t("merge_suggestions.status.failed");
      setMergeSuggestionError(message);
      setMergeSuggestions([]);
      setStatusMessage(message);
    } finally {
      setIsSuggestingMerges(false);
    }
  }, [
    document,
    isSuggestingMerges,
    mergeSuggestionInstruction,
    runTenantScopedApiRequest,
    verifiedTenantSession,
  ]);

  const handleMergeSuggestionTextChange = useCallback((groupId: string, value: string) => {
    setMergeSuggestions((previousSuggestions) =>
      previousSuggestions.map((suggestion) =>
        suggestion.groupId === groupId
          ? {
              ...suggestion,
              editedText: value,
              isEdited: value !== suggestion.mergedTextDraft,
            }
          : suggestion
      )
    );
  }, []);

  const handleRecordMergeSuggestionDecision = useCallback(
    (groupId: string, decision: MergeSuggestionDecision, options: { isTrusted: boolean; decisionReason?: string; selectedCardIds?: string[] }) => {
      if (!document) {
        return;
      }

      if (!options.isTrusted) {
        setMergeSuggestionError(t("app.status.merge_suggestion.trusted_interaction_required"));
        return;
      }

      const suggestion = mergeSuggestions.find((item) => item.groupId === groupId);
      if (!suggestion) {
        return;
      }

      const availableCardCount = document.cards.filter((card) => suggestion.cardIds.includes(card.id)).length;
      if (availableCardCount < 2) {
        setMergeSuggestionError(t("app.status.merge_suggestion.no_longer_applicable"));
        return;
      }

      const nextDocument = appendMergeSuggestionDecision(document, {
        groupId: suggestion.groupId,
        decision,
        cardIds: suggestion.cardIds,
        selectedCardIds: options.selectedCardIds,
        mergedTextDraft: suggestion.mergedTextDraft,
        editedText: suggestion.editedText,
        mergeMethod: suggestion.mergeMethod,
        rationale: suggestion.rationale,
        decisionReason: options.decisionReason,
      });
      const decisionLabel = t({
        accept: "merge_suggestions.decision.accepted",
        partial: "merge_suggestions.decision.partially_accepted",
        reject: "merge_suggestions.decision.rejected",
        defer: "merge_suggestions.decision.deferred",
      }[decision]);
      applyDocumentChange(
        nextDocument,
        t("app.history.merge_suggestion.decision_recorded", { decision: decisionLabel }),
        { preserveMergeSuggestions: true },
      );

      const decidedAt = nextDocument.mergeSuggestionDecisions?.at(-1)?.decidedAt ?? new Date().toISOString();
      const decisionId = nextDocument.mergeSuggestionDecisions?.at(-1)?.decisionId ?? crypto.randomUUID();
      const auditEvent = createMergeDecisionAuditEvent({
        eventId: decisionId,
        groupId: suggestion.groupId,
        decision,
        decidedAt,
        cardIds: suggestion.cardIds,
        selectedCardIds: options.selectedCardIds,
        snapshotVersion: "CTR-2B-02-DECISION-LOG-V1",
        decisionReason: options.decisionReason,
      });
      setMergeDecisionAuditEvents((current) => appendMergeDecisionAuditEvent(current, auditEvent));
      // applyDocumentChange() clears merge suggestion previews as part of a
      // normal Document mutation. A recorded human decision must nevertheless
      // keep the currently reviewed candidates visible so that the separate
      // explicit apply step remains available. Rebuild from this callback's
      // captured suggestion set instead of mapping the just-cleared state.
      setMergeSuggestions(
        mergeSuggestions.map((item) =>
          item.groupId === groupId
            ? {
                ...item,
                latestDecision: decision,
                latestDecidedAt: decidedAt,
                latestSelectedCardIds: decision === "partial" ? options.selectedCardIds : undefined,
              }
            : item
        )
      );
      setMergeSuggestionError(null);
      setStatusMessage(t("app.status.merge_suggestion.decision_recorded", { decision: decisionLabel }));
    },
    [applyDocumentChange, document, mergeSuggestions]
  );


  const handleApplyRecordedMergeSuggestion = useCallback(
    (groupId: string, options: { isTrusted: boolean }) => {
      if (!document) {
        return;
      }
      if (!options.isTrusted) {
        setMergeSuggestionError(t("app.status.merge_suggestion.trusted_interaction_required"));
        return;
      }

      const latestDecision = getLatestMergeSuggestionDecisionByGroup(
        document.mergeSuggestionDecisions,
      ).get(groupId);
      if (!latestDecision) {
        setMergeSuggestionError(t("app.status.merge_suggestion.apply_failed", { code: "decision_not_recorded" }));
        return;
      }

      const result = applyRecordedMergeSuggestionDecision(document, latestDecision);
      if (!result.ok) {
        setMergeSuggestionError(t("app.status.merge_suggestion.apply_failed", { code: result.code }));
        return;
      }

      const changed = applyDocumentChange(
        result.document,
        t("app.history.merge_suggestion_applied"),
        { preserveSuggestionPreview: true, preserveMergeSuggestions: true },
      );
      if (!changed) {
        return;
      }

      // The explicit apply is another Document mutation, so
      // applyDocumentChange() clears the preview state here as well. Keep the
      // reviewed candidate visible and replace only its lineage snapshot with
      // the representative that was actually created.
      setMergeSuggestions(
        mergeSuggestions.map((suggestion) =>
          suggestion.groupId === groupId
            ? {
                ...suggestion,
                representativeCardId: result.representativeCardId,
                representativeResolvedBy: "repOf",
                representativeSourceCount: result.sourceCardIds.length,
              }
            : suggestion,
        ),
      );
      setMergeSuggestionError(null);
    },
    [applyDocumentChange, document, mergeSuggestions],
  );

  const handleExport = useCallback(() => {
    if (!document) {
      return;
    }

    const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = window.document.createElement("a");

    downloadLink.href = objectUrl;
    downloadLink.download = `sui-sensemaking-doc-${document.id}.json`;
    window.document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();

    URL.revokeObjectURL(objectUrl);
    setStatusMessage(t("app.status.export.document_json"));
  }, [document]);

  const handleImportFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      event.target.value = "";

      if (!selectedFile) {
        return;
      }

      setIsSharePanelOpen(true);

      const rawText = await runTenantScopedOptionalTask(() => selectedFile.text());
      if (rawText === undefined) {
        return;
      }
      const parseResult = parseDocumentJson(rawText);
      if (!parseResult.ok) {
        setPendingImportedDocument(null);
        setImportDocumentError(parseResult.error);
        setStatusMessage(t("app.status.import.document_load_failed"));
        return;
      }

      setPendingImportedDocument({
        fileName: selectedFile.name,
        document: parseResult.document,
      });
      setImportDocumentError(null);
      setStatusMessage(t(isReadOnly ? "app.status.import.document_validated_read_only" : "app.status.import.document_validated"));
    },
    [isReadOnly, runTenantScopedOptionalTask]
  );

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, [abstractMapView, summaryView]);

  const handleLoadComparisonDocumentClick = useCallback(() => {
    compareImportInputRef.current?.click();
  }, [abstractMapView, summaryView]);

  const handleComparisonFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    event.target.value = "";

    if (!selectedFile) {
      return;
    }

    try {
      const rawText = await runTenantScopedOptionalTask(() => selectedFile.text());
      if (rawText === undefined) {
        return;
      }
      const parsedJson: unknown = JSON.parse(rawText);
      const parsedDocument = extractComparisonDocument(parsedJson);

      if (!parsedDocument.ok) {
        setStatusMessage(t("app.status.comparison.invalid_document", { detail: parsedDocument.error }));
        return;
      }

      setComparisonDocument(parsedDocument.document);
      setComparisonFileName(selectedFile.name);
      setMergeSourceInfo({
        kind: selectedFile.name.toLowerCase().endsWith(".zip") ? "zip" : "unknown",
        fileName: selectedFile.name,
        packId: parsedDocument.document.id || undefined,
      });
      setReviewDiffBaseSnapshot(document ? cloneDocument(document) : null);
      setSelectedMergeItemIdSet(new Set());
      setLastMergeSnapshot(null);
      setMergeWarningConfirmationKey(null);
      setStatusMessage(t("app.status.comparison.loaded_view_only"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        setStatusMessage(t("app.status.comparison.invalid_json"));
        return;
      }

      setStatusMessage(t("app.status.comparison.load_failed", {
        detail: error instanceof Error ? error.message : t("app.status.error_detail_unknown"),
      }));
    }
  }, [document, runTenantScopedOptionalTask]);


  const handleApplySelectedMergeItems = useCallback(() => {
    if (!document || !comparisonDocument || !reviewDiffBaseSnapshot) {
      setStatusMessage(t("app.status.comparison.load_first"));
      return;
    }

    const selectedItems = mergeItems.filter((item) => mergeEvaluation.selectedIdsWithPrerequisites.has(item.id));
    if (selectedItems.length === 0) {
      setStatusMessage(t("app.status.comparison.no_merge_item_selected"));
      return;
    }

    const hasBlocker = mergeEvaluation.evaluations.some((entry) => mergeEvaluation.selectedIdsWithPrerequisites.has(entry.item.id) && entry.status !== "ok");
    if (hasBlocker) {
      setStatusMessage(t("app.status.comparison.resolve_blockers"));
      return;
    }

    const mergeSelectionKey = selectedItems.map((item) => item.id).sort().join("|");
    const applyResult = applyMergeTransaction(document, reviewDiffBaseSnapshot, reviewDiffBaseSnapshot, comparisonDocument, selectedItems, {
      allowWarnings: mergeWarningConfirmationKey === mergeSelectionKey,
    });
    if (!applyResult.ok) {
      const requiresExplicitConfirm = applyResult.errors.some((error) => error.code === "M105");
      if (requiresExplicitConfirm) {
        setMergeWarningConfirmationKey(mergeSelectionKey);
      }
      setStatusMessage(applyResult.errors.map((error) => `[${error.code}] ${error.message}`).join("\n"));
      return;
    }

    setMergeWarningConfirmationKey(null);
    const auditEntry = buildMergeAuditEntry(selectedItems, mergeSourceInfo);
    setMergeAuditLog((current) => appendMergeAuditLog(current, auditEntry));
    setLastMergeSnapshot(cloneDocument(document));
    applyDocumentChange(applyResult.document, t("app.status.comparison.merge_applied"));
  }, [applyDocumentChange, comparisonDocument, document, mergeEvaluation.evaluations, mergeEvaluation.selectedIdsWithPrerequisites, mergeItems, mergeSourceInfo, mergeWarningConfirmationKey, reviewDiffBaseSnapshot]);

  const handleUndoLastMerge = useCallback(() => {
    if (!lastMergeSnapshot) {
      setStatusMessage(t("app.status.comparison.no_merge_to_revert"));
      return;
    }

    applyDocumentChange(cloneDocument(lastMergeSnapshot), t("app.status.comparison.merge_reverted"));
    setLastMergeSnapshot(null);
    setMergeWarningConfirmationKey(null);
  }, [applyDocumentChange, lastMergeSnapshot]);

  const applyImportedViewMetadata = useCallback((metadata: ExportViewMetadata, targetDocument: DocumentV1, viewMode: ViewMode, statusPrefix: string) => {
    const hasFocusIsland =
      metadata.viewState.focusIslandId === null
        ? false
        : targetDocument.islands.some((island) => island.id === metadata.viewState.focusIslandId);

    setSummaryView(metadata.viewState.summaryView || metadata.viewState.abstractMapView);
    setAbstractMapView(metadata.viewState.abstractMapView);
    setHideSourceCards(metadata.viewState.hideSourceCards);
    setHierarchyLevel(metadata.viewState.hierarchyLevel ?? resolveHierarchyLevel(metadata.viewState.maxDepth));
    setMaxDepth(metadata.viewState.maxDepth);
    setShowReadingOrder(metadata.viewState.showReadingOrder);
    setReadingNavEnabled(metadata.viewState.readingNavEnabled ?? false);
    setReadingMode(metadata.viewState.readingMode ?? "islands");
    setReviewedOnly(metadata.viewState.reviewedOnly ?? false);
    const importedCollapsedIslandIds = new Set(
      (metadata.viewState.collapsedIslandIds ?? []).filter((islandId) =>
        targetDocument.islands.some((island) => island.id === islandId)
      )
    );
    importedCollapsedStateRef.current = {
      docId: targetDocument.id,
      islandIds: importedCollapsedIslandIds,
    };
    setCollapsedIslandIds(importedCollapsedIslandIds);
    setReadingIndex(metadata.viewState.readingIndex ?? 0);
    setSafeMode(metadata.viewState.safeMode ?? true);
    setViewVisibility(metadata.visibility);
    setLodEnabled(metadata.viewState.lodEnabled ?? false);
    setLodThresholds(metadata.viewState.lodThresholds ?? DEFAULT_LOD_THRESHOLDS);
    setLodLevelOverride(metadata.viewState.lodLevelOverride ?? null);
    setLodShowLoneWolvesWhenFar(metadata.viewState.lodShowLoneWolvesWhenFar ?? true);
    setEvidenceOverlayEnabled(metadata.viewState.evidenceOverlayEnabled ?? false);
    setEvidenceOverlayMode(metadata.viewState.evidenceOverlayMode ?? "supports");
    setEvidenceOverlayDepth(clampEvidenceOverlayDepth(metadata.viewState.evidenceOverlayDepth ?? 1));
    setEvidenceOverlayScope(metadata.viewState.evidenceOverlayScope ?? "selection");
    setEvidenceOverlayDimOthers(metadata.viewState.evidenceOverlayDimOthers ?? true);
    const fallbackPerspective: PerspectiveState = {
      mode: metadata.viewState.perspectiveMode ?? "default",
      strictFilter: metadata.viewState.perspectiveStrictFilter ?? false,
    };
    const importedPerspective = sanitizePerspectiveState(metadata.viewState.perspective, fallbackPerspective);
    setPerspectiveMode(importedPerspective.mode);
    setPerspectiveStrictFilter(importedPerspective.strictFilter);
    if (importedPerspective.lodEnabled !== undefined) {
      setLodEnabled(importedPerspective.lodEnabled);
    }
    if (importedPerspective.evidenceOverlayPrefs) {
      setEvidenceOverlayMode(importedPerspective.evidenceOverlayPrefs.mode);
      setEvidenceOverlayDepth(clampEvidenceOverlayDepth(importedPerspective.evidenceOverlayPrefs.depth));
      setEvidenceOverlayScope(importedPerspective.evidenceOverlayPrefs.scope);
      setEvidenceOverlayDimOthers(importedPerspective.evidenceOverlayPrefs.dimOthers);
    }
    setPerspectivePresets(restorePerspectivePresets(metadata.viewState.perspectivePresets));
    setViewPresets(sanitizeViewPresets(metadata.viewState.presets));
    setActivePresetId(typeof metadata.viewState.activePresetId === "string" ? metadata.viewState.activePresetId : null);
    setMergeAuditLog(sanitizeMergeAuditLog(metadata.mergeAuditLog));
    setReviewEvents(sanitizeReviewEvents(metadata.reviewEvents));
    setIncludeUnreviewedDraftsInExport(false);
    setIsReadingOrderEditMode(false);
    setRevealedSourceCardIds(new Set());
    setFocusCardId(null);
    setFocusWorldPoint(null);
    suppressNextTransformPersistRef.current = true;
    setCameraTransformRequest((previousRequest) => ({
      panX: metadata.camera.panX,
      panY: metadata.camera.panY,
      zoom: metadata.camera.zoom,
      requestSeq: (previousRequest?.requestSeq ?? 0) + 1,
    }));

    applyResolvedLocaleForViewRef.current({
      docId: targetDocument.id,
      viewMode,
      metadataLocale: metadata.viewState.locale,
      persistedLocale: appStorage.loadViewLocaleForDocumentView(targetDocument.id, viewMode),
    });

    if (metadata.viewState.focusIslandId && !hasFocusIsland) {
      setFocusTarget({});
      setStatusMessage(t("app.status.import.view_loaded_focus_missing", { statusPrefix, visibility: metadata.visibility, islandId: metadata.viewState.focusIslandId }));
      return;
    }

    setFocusTarget(metadata.viewState.focusIslandId ? { focusIslandId: metadata.viewState.focusIslandId } : {});
    setStatusMessage(t("app.status.import.view_loaded", { statusPrefix, visibility: metadata.visibility }));
    // FB-RM-UX-01: applyResolvedLocaleForView depends on isReadOnly/locationSearch.
    // Read it via the ref so this callback (and loadPublicPack, which depends on
    // it) keeps a stable identity and the mount-only effect does not re-run.
  }, [appStorage]);

  const loadPublicPack = useCallback(async (
    requestedPackId: string | null,
  ): Promise<"loaded" | "not-found" | "stale"> => {
    const manifestResponse = await runTenantScopedOptionalTask(
      () => fetch("./packs/index.json", { cache: "no-store" }),
    );
    if (manifestResponse === undefined) {
      return "stale";
    }
    if (!manifestResponse.ok) {
      return "not-found";
    }

    let manifestPayload: unknown;
    try {
      const manifestText = await runTenantScopedOptionalTask(() => manifestResponse.text());
      if (manifestText === undefined) {
        return "stale";
      }
      manifestPayload = JSON.parse(manifestText) as unknown;
    } catch {
      throw new Error(t("app.status.public_pack.invalid_index_json"));
    }
    const manifestValidation = validatePublicPackManifest(manifestPayload);
    if (!manifestValidation.ok) {
      const detail = manifestValidation.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
      throw new Error(t("app.status.public_pack.invalid_index", { detail }));
    }
    const manifest = manifestValidation.manifest;
    const packs = manifest.packs;
    const targetPack = packs.find((pack) => pack.id === (requestedPackId ?? manifest.defaultPackId ?? "")) ?? null;
    if (!targetPack) {
      throw new Error(t("app.status.public_pack.not_found", {
        packId: requestedPackId ?? manifest.defaultPackId ?? t("app.status.public_pack.default_id"),
      }));
    }

    const documentResponse = await runTenantScopedOptionalTask(
      () => fetch(`./packs/${targetPack.documentPath}`, { cache: "no-store" }),
    );
    if (documentResponse === undefined) {
      return "stale";
    }
    if (!documentResponse.ok) {
      throw new Error(t("app.status.public_pack.document_fetch_failed", { path: targetPack.documentPath }));
    }
    const documentText = await runTenantScopedOptionalTask(() => documentResponse.text());
    if (documentText === undefined) {
      return "stale";
    }
    const documentParseResult = parseDocumentJson(documentText);
    if (!documentParseResult.ok) {
      throw new Error(t("app.status.public_pack.document_invalid", { detail: documentParseResult.error }));
    }

    let importedViewMetadata: ExportViewMetadata | null = null;
    if (targetPack.viewPath) {
      const viewResponse = await runTenantScopedOptionalTask(
        () => fetch(`./packs/${targetPack.viewPath}`, { cache: "no-store" }),
      );
      if (viewResponse === undefined) {
        return "stale";
      }
      if (!viewResponse.ok) {
        throw new Error(t("app.status.public_pack.view_fetch_failed", { path: targetPack.viewPath }));
      }
      const viewText = await runTenantScopedOptionalTask(() => viewResponse.text());
      if (viewText === undefined) {
        return "stale";
      }
      const viewParseResult = parseViewJson(viewText);
      if (!viewParseResult.ok) {
        throw new Error(t("app.status.public_pack.view_invalid", { detail: viewParseResult.error }));
      }
      importedViewMetadata = viewParseResult.metadata;
    }

    pendingCardDragSnapshotRef.current = null;
    setHistory({
      past: [],
      present: cloneDocument(documentParseResult.document),
      future: [],
    });
    setActiveDocumentId(documentParseResult.document.id);
    const importedViewMode = appStorage.loadViewModeForDocument(documentParseResult.document.id) ?? "explore";
    setViewMode(importedViewMode);
    applyResolvedLocaleForViewRef.current({
      docId: documentParseResult.document.id,
      viewMode: importedViewMode,
      persistedLocale: appStorage.loadViewLocaleForDocumentView(documentParseResult.document.id, importedViewMode),
    });
    setSelectedRecentDocumentId("");
    setDocEtag(null);
    setSelectedCardIds([]);
    setSelectedIslandId(null);
    setSelectedEdgeId(null);
    setIsPickingEdgeTarget(false);
    setFocusCardId(null);
    setFocusTarget({});
    setFocusWorldPoint(null);
    setPeekIslandId(undefined);
    setFlashReference(null);
    setTemporaryRevealCardIds(new Set());
    setSummaryRevealIslandIds(new Set());
    setRevealedSourceCardIds(new Set());
    setComparisonDocument(null);
    setComparisonFileName(null);
    setGroundingVisibilityMessage(null);
    setIsDirty(false);
    setHasSaveConflict(false);
    setSuggestedDocument(null);
    setSuggestionId(null);
    setSuggestionNotes(null);
    setSuggestionError(null);
    setPendingImportedDocument(null);
    setImportDocumentError(null);
    setPackImportError(null);
    setMergeSourceInfo({ kind: "zip", fileName: targetPack.id, packId: targetPack.id });
    setImportedPackSummary(null);
    setImportedPackDiagnosticsMd(null);
    setImportedPackSnapshotUrl(null);

    setPackVisibility(targetPack.visibility);

    if (importedViewMetadata) {
      applyImportedViewMetadata(importedViewMetadata, documentParseResult.document, importedViewMode, t("app.status.public_pack.loaded_prefix"));
    }

    setSafeMode(true);
    if (!targetPack.viewPath) {
      const persistedVisibility = appStorage.loadViewVisibilityForDocument(documentParseResult.document.id);
      setViewVisibility(persistedVisibility.viewVisibility);
    }
    setStatusMessage(t("app.status.public_pack.loaded", { packId: targetPack.id, visibility: targetPack.visibility }));
    return "loaded";
  }, [appStorage, applyImportedViewMetadata, runTenantScopedOptionalTask]);

  const openBuiltInSample = useCallback(() => {
    const builtInSample = createDefaultDocument(DEFAULT_DOCUMENT_ID);
    const sampleViewMode = appStorage.loadViewModeForDocument(builtInSample.id) ?? "explore";

    pendingCardDragSnapshotRef.current = null;
    setHistory({
      past: [],
      present: cloneDocument(builtInSample),
      future: [],
    });
    setActiveDocumentId(builtInSample.id);
    setViewMode(sampleViewMode);
    applyResolvedLocaleForViewRef.current({
      docId: builtInSample.id,
      viewMode: sampleViewMode,
      persistedLocale: appStorage.loadViewLocaleForDocumentView(builtInSample.id, sampleViewMode),
    });
    setSelectedRecentDocumentId("");
    setDocEtag(null);
    setSelectedCardIds([]);
    setSelectedIslandId(null);
    setSelectedEdgeId(null);
    setIsPickingEdgeTarget(false);
    setFocusCardId(null);
    setFocusTarget({});
    setFocusWorldPoint(null);
    setPeekIslandId(undefined);
    setFlashReference(null);
    setTemporaryRevealCardIds(new Set());
    setSummaryRevealIslandIds(new Set());
    setRevealedSourceCardIds(new Set());
    setComparisonDocument(null);
    setComparisonFileName(null);
    setGroundingVisibilityMessage(null);
    setIsDirty(false);
    setHasSaveConflict(false);
    setSuggestedDocument(null);
    setSuggestionId(null);
    setSuggestionNotes(null);
    setSuggestionError(null);
    setPendingImportedDocument(null);
    setImportDocumentError(null);
    setPackImportError(null);
    setMergeSourceInfo({ kind: "unknown" });
    setImportedPackSummary(null);
    setImportedPackDiagnosticsMd(null);
    setImportedPackSnapshotUrl(null);
    setMergeAuditLog([]);
    setReviewEvents([]);
    setSafeMode(true);
    const persistedVisibility = appStorage.loadViewVisibilityForDocument(builtInSample.id);
    setViewVisibility(persistedVisibility.viewVisibility);
    setPackVisibility(persistedVisibility.packVisibility);
    setStatusMessage(t("app.status.start.built_in_sample_opened"));
  }, [appStorage, applyResolvedLocaleForView]);

  const handleOpenSampleDocument = useCallback(async () => {
    setIsStartPanelVisible(false);
    setIsLoading(true);
    setStatusMessage(t("app.status.start.opening_sample"));

    try {
      const loadedFromPack = await loadPublicPack(null);
      if (loadedFromPack === "stale") {
        return;
      }
      if (loadedFromPack === "not-found") {
        const loadedFromApi = await loadDocument(DEFAULT_DOCUMENT_ID, { allowCreateOnNotFound: true });
        if (!loadedFromApi) {
          openBuiltInSample();
        }
      }
    } catch {
      openBuiltInSample();
    } finally {
      setIsLoading(false);
      window.requestAnimationFrame(() => {
        window.document.querySelector<HTMLElement>("[data-card-id]")?.focus({ preventScroll: true });
      });
    }
  }, [loadDocument, loadPublicPack, openBuiltInSample]);

  const handleStartCreateNewDocument = useCallback(() => {
    setIsStartPanelVisible(false);
    handleNewDocument();
  }, [handleNewDocument]);

  const handleStartLoadDocumentFile = useCallback(() => {
    setIsStartPanelVisible(false);
    setIsSharePanelOpen(true);
    importInputRef.current?.click();
  }, []);

  const handleStartImportReviewPack = useCallback(() => {
    setIsStartPanelVisible(false);
    setIsSharePanelOpen(true);
    reviewPackInputRef.current?.click();
  }, []);

  const handleStartOpenRecent = useCallback(() => {
    setIsStartPanelVisible(false);
    handleOpenRecent();
  }, [handleOpenRecent]);

  useEffect(() => {
    let isCancelled = false;

    const loadForMount = async () => {
      if (isCancelled) {
        return;
      }

      const requestedPackId = resolvePublicPackIdFromSearch(window.location.search);

      try {
        const loadedFromPack = await loadPublicPack(requestedPackId);
        if (loadedFromPack === "stale") {
          return;
        }
        if (loadedFromPack === "loaded") {
          setIsLoading(false);
          return;
        }
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : t("app.status.public_pack.load_failed"));
        if (requestedPackId) {
          setIsLoading(false);
          return;
        }
      }

      await loadDocument(DEFAULT_DOCUMENT_ID, { allowCreateOnNotFound: true });
    };

    void loadForMount();

    return () => {
      isCancelled = true;
    };
  }, [loadDocument, loadPublicPack]);

  const handleLoadViewMetadataFile = useCallback(
    async (selectedFile: File) => {
      if (!document) {
        setStatusMessage(t("app.status.import.view_metadata_document_required"));
        return;
      }

      const rawText = await runTenantScopedOptionalTask(() => selectedFile.text());
      if (rawText === undefined) {
        return;
      }
      const parseResult = parseViewJson(rawText);
      if (!parseResult.ok) {
        setStatusMessage(t("app.status.import.view_metadata_load_failed", { detail: parseResult.error }));
        return;
      }

      applyImportedViewMetadata(parseResult.metadata, document, viewMode, t("app.status.import.view_metadata_loaded_prefix"));
    },
    [applyImportedViewMetadata, document, runTenantScopedOptionalTask, viewMode]
  );

  const handleLoadDocumentFile = useCallback(async (selectedFile: File) => {
    const rawText = await runTenantScopedOptionalTask(() => selectedFile.text());
    if (rawText === undefined) {
      return;
    }
    const parseResult = parseDocumentJson(rawText);
    if (!parseResult.ok) {
      setPendingImportedDocument(null);
      setImportDocumentError(parseResult.error);
      setStatusMessage(t("app.status.import.document_load_failed"));
      return;
    }

    setPendingImportedDocument({
      fileName: selectedFile.name,
      document: parseResult.document,
    });
    setImportDocumentError(null);
    setStatusMessage(t(isReadOnly ? "app.status.import.document_validated_read_only" : "app.status.import.document_validated"));
  }, [isReadOnly, runTenantScopedOptionalTask]);

  const handleInvalidReviewPackFileType = useCallback(() => {
    setPackImportError(t("app.status.import.review_pack_zip_required"));
    setStatusMessage(t("app.status.import.review_pack_zip_required"));
  }, [abstractMapView, summaryView]);

  const handleImportReviewPackFile = useCallback(async (selectedFile: File) => {
    setPackImportError(null);
    if (!selectedFile.name.toLowerCase().endsWith(".zip")) {
      setPackImportError(t("app.status.import.review_pack_zip_required"));
      setStatusMessage(t("app.status.import.review_pack_zip_required"));
      return;
    }

    try {
      const zipImportResult = await runTenantScopedOptionalTask(() => readZipFiles(selectedFile));
      if (zipImportResult === undefined) {
        return;
      }
      const entries = zipImportResult.entries;
      const paths = detectReviewPackFiles(entries);
      if (!paths.documentPath) {
        const message = t("app.status.import.review_pack_document_missing");
        setPackImportError(message);
        setStatusMessage(message);
        return;
      }
      if (!paths.viewPath) {
        const message = t("app.status.import.review_pack_view_missing");
        setPackImportError(message);
        setStatusMessage(message);
        return;
      }

      const documentRaw = entries.get(paths.documentPath);
      const viewRaw = entries.get(paths.viewPath);
      if (typeof documentRaw !== "string") {
        const message = t("app.status.import.review_pack_document_text_required");
        setPackImportError(message);
        setStatusMessage(message);
        return;
      }
      if (typeof viewRaw !== "string") {
        const message = t("app.status.import.review_pack_view_text_required");
        setPackImportError(message);
        setStatusMessage(message);
        return;
      }

      const parsedDocument = parseDocumentJson(documentRaw);
      if (!parsedDocument.ok) {
        const message = t("app.status.import.review_pack_document_invalid");
        setPackImportError(message);
        setStatusMessage(message);
        return;
      }

      const parsedView = parseViewJson(viewRaw);
      if (!parsedView.ok) {
        const message = t("app.status.import.review_pack_view_invalid");
        setPackImportError(message);
        setStatusMessage(message);
        return;
      }

      if (paths.integrityPath) {
        const integrityRaw = entries.get(paths.integrityPath);
        if (typeof integrityRaw !== "string") {
          const message = t("app.status.import.review_pack_integrity_text_required");
          setPackImportError(message);
          setStatusMessage(message);
          return;
        }
        let parsedIntegrityJson: unknown;
        try {
          parsedIntegrityJson = JSON.parse(integrityRaw);
        } catch {
          const message = t("app.status.import.review_pack_integrity_json_invalid");
          setPackImportError(message);
          setStatusMessage(message);
          return;
        }
        const parsedIntegrity = parseIntegrityManifest(parsedIntegrityJson);
        if (!parsedIntegrity.ok) {
          const message = t("app.status.import.review_pack_integrity_manifest_invalid");
          setPackImportError(message);
          setStatusMessage(message);
          return;
        }
        if (
          paths.visualCueAssetsPath
          && !parsedIntegrity.manifest.files.some((file) => file.path === paths.visualCueAssetsPath)
        ) {
          const message = t("app.status.import.review_pack_visual_cue_assets_integrity_missing");
          setPackImportError(message);
          setStatusMessage(message);
          return;
        }
        const verification = await runTenantScopedOptionalTask(
          () => verifyIntegrityManifest(parsedIntegrity.manifest, entries),
        );
        if (verification === undefined) {
          return;
        }
        if (!verification.ok) {
          const message = t("app.status.import.review_pack_integrity_verification_failed");
          setPackImportError(message);
          setStatusMessage(message);
          return;
        }
      }

      let importedDocument = parsedDocument.document;
      let visualCueAssetBundle: RepresentativeVisualCueAssetBundleV1 | null = null;
      let omittedPortableVisualCueCount = 0;
      if (paths.visualCueAssetsPath) {
        const visualCueAssetsRaw = entries.get(paths.visualCueAssetsPath);
        if (typeof visualCueAssetsRaw !== "string") {
          const message = t("app.status.import.review_pack_visual_cue_assets_text_required");
          setPackImportError(message);
          setStatusMessage(message);
          return;
        }
        try {
          visualCueAssetBundle = parseRepresentativeVisualCueAssetBundle(
            JSON.parse(visualCueAssetsRaw) as unknown,
            importedDocument,
          );
        } catch {
          const message = t("app.status.import.review_pack_visual_cue_assets_invalid");
          setPackImportError(message);
          setStatusMessage(message);
          return;
        }
      } else {
        omittedPortableVisualCueCount = collectPortableVisualCueImageRefs(importedDocument).length;
        importedDocument = stripPortableVisualCues(importedDocument);
      }

      if (visualCueAssetBundle) {
        try {
          const restoredCount = await runTenantScopedOptionalTask(() =>
            restoreRepresentativeVisualCueAssetBundle(
              importedDocument,
              visualCueAssetBundle,
              appStorage.scope,
            ),
          );
          if (restoredCount === undefined) {
            return;
          }
        } catch {
          const message = t("app.status.import.review_pack_visual_cue_assets_restore_failed");
          setPackImportError(message);
          setStatusMessage(message);
          return;
        }
      }

      const previousSnapshotUrl = importedPackSnapshotUrl;
      let nextSnapshotUrl: string | null = null;
      if (paths.snapshotPath) {
        const snapshotRaw = entries.get(paths.snapshotPath);
        if (snapshotRaw instanceof Uint8Array) {
          nextSnapshotUrl = URL.createObjectURL(new Blob([new Uint8Array(snapshotRaw)], { type: "image/png" }));
        }
      }

      const diagnosticsRaw = paths.diagnosticsPath ? entries.get(paths.diagnosticsPath) : undefined;
      const diagnosticsText = typeof diagnosticsRaw === "string" ? sanitizeMarkdownForDisplay(diagnosticsRaw) : null;

      pendingCardDragSnapshotRef.current = null;
      setHistory({
        past: [],
        present: cloneDocument(importedDocument),
        future: [],
      });
      setActiveDocumentId(importedDocument.id);
      const importedViewMode = appStorage.loadViewModeForDocument(importedDocument.id) ?? "explore";
      setViewMode(importedViewMode);
      setSelectedRecentDocumentId("");
      setDocEtag(null);
      setSelectedCardIds([]);
      setSelectedIslandId(null);
      setSelectedEdgeId(null);
      setIsPickingEdgeTarget(false);
      setFocusCardId(null);
      setFocusTarget({});
      setFocusWorldPoint(null);
      setPeekIslandId(undefined);
      setFlashReference(null);
      setTemporaryRevealCardIds(new Set());
      setSummaryRevealIslandIds(new Set());
      setRevealedSourceCardIds(new Set());
      setComparisonDocument(null);
      setComparisonFileName(null);
      setMergeSourceInfo({ kind: "unknown" });
      setGroundingVisibilityMessage(null);
      setIsDirty(true);
      setHasSaveConflict(false);
      setSuggestedDocument(null);
      setSuggestionId(null);
      setSuggestionNotes(null);
      setSuggestionError(null);
      setPendingImportedDocument(null);
      setImportDocumentError(null);
      setPackImportError(null);
      setMergeSourceInfo({ kind: "zip", fileName: selectedFile.name, packId: selectedFile.name.replace(/\.zip$/i, "") });
      setPackVisibility(DEFAULT_PACK_VISIBILITY);
      setImportedPackSummary({
        fileName: selectedFile.name,
        cardCount: importedDocument.cards.length,
        islandCount: importedDocument.islands.length,
        perspectiveMode: parsedView.metadata.viewState.perspectiveMode ?? "default",
        visibility: parsedView.metadata.visibility,
        warningCount:
          zipImportResult.skippedUnsupportedCount
          + paths.ignoredFileCount
          + omittedPortableVisualCueCount,
      });
      setImportedPackDiagnosticsMd(diagnosticsText);
      setImportedPackSnapshotUrl(nextSnapshotUrl);
      if (previousSnapshotUrl) {
        URL.revokeObjectURL(previousSnapshotUrl);
      }
      applyImportedViewMetadata(
        parsedView.metadata,
        importedDocument,
        importedViewMode,
        t("app.status.import.review_pack_imported_prefix"),
      );
      setSafeMode(true);
    } catch (error) {
      if (error instanceof ZipImportError) {
        const message = t(`app.status.import.review_pack_zip_error_${error.code.toLowerCase()}`);
        setPackImportError(message);
        setStatusMessage(message);
      } else {
        const message = t("app.status.import.review_pack_unsupported");
        setPackImportError(message);
        setStatusMessage(message);
      }
    }
  }, [appStorage, applyImportedViewMetadata, importedPackSnapshotUrl, runTenantScopedOptionalTask]);

  const handleReviewPackFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      event.target.value = "";

      if (!selectedFile) {
        return;
      }

      void handleImportReviewPackFile(selectedFile);
    },
    [handleImportReviewPackFile]
  );

  const handleLoadPatchFile = useCallback(async (selectedFile: File) => {
    try {
      const rawText = await runTenantScopedOptionalTask(() => selectedFile.text());
      if (rawText === undefined) {
        return;
      }
      const parsedJson: unknown = JSON.parse(rawText);
      const parsedPatch = parsePatchDocument(parsedJson);

      if (!parsedPatch) {
        setPendingPatchImport(null);
        setPatchFingerprintStatus(null);
        setPatchTrustLabel("unknown");
        setPatchImportError(t("app.status.patch.validation_failed", { detail: t("app.status.patch.invalid_schema") }));
        setStatusMessage(t("app.status.patch.load_failed"));
        return;
      }

      const fingerprintVerification = await runTenantScopedOptionalTask(
        () => verifyPatchFingerprint(parsedPatch),
      );
      if (fingerprintVerification === undefined) {
        return;
      }
      if (!parsedPatch.patchFingerprint) {
        setPatchFingerprintStatus({ status: t("app.status.patch.fingerprint_missing") });
        setPatchTrustLabel("unknown");
      } else if (fingerprintVerification.ok) {
        setPatchFingerprintStatus({
          status: t("app.status.patch.fingerprint_ok"),
          expected: fingerprintVerification.expected,
          actual: fingerprintVerification.actual,
        });
        setPatchTrustLabel("unknown");
      } else {
        setPatchFingerprintStatus({
          status: t("app.status.patch.fingerprint_mismatch"),
          expected: fingerprintVerification.expected,
          actual: fingerprintVerification.actual,
        });
        setPatchTrustLabel("untrusted");
      }

      setPendingPatchImport({
        fileName: selectedFile.name,
        originalPatch: parsedPatch,
        patch: parsedPatch,
      });
      setPatchSelectedOpIdSet(new Set(parsedPatch.ops.map((op) => op.id)));
      const nextResolutions: Record<string, PatchResolution> = {};
      for (const op of parsedPatch.ops) {
        nextResolutions[op.id] = "skip";
      }
      setPatchResolutionsByOpId(nextResolutions);
      setPatchImportError(null);
      setSelectedFixProposalIdSet(new Set());
      setStatusMessage(t("app.status.patch.loaded"));
    } catch (error) {
      setPendingPatchImport(null);
      setPatchFingerprintStatus(null);
      setPatchTrustLabel("unknown");
      if (error instanceof SyntaxError) {
        setPatchImportError(t("app.status.patch.validation_failed", { detail: t("app.status.patch.invalid_json") }));
      } else {
        const message = error instanceof Error ? error.message : t("app.status.error_detail_unknown");
        setPatchImportError(t("app.status.patch.validation_failed", { detail: message }));
      }
      setStatusMessage(t("app.status.patch.load_failed"));
    }
  }, [abstractMapView, runTenantScopedOptionalTask, summaryView]);

  const handleLoadPatchBaselineFile = useCallback(async (selectedFile: File) => {
    const rawText = await runTenantScopedOptionalTask(() => selectedFile.text());
    if (rawText === undefined) {
      return;
    }
    const parseResult = parseDocumentJson(rawText);
    if (!parseResult.ok) {
      setPatchBaselineDoc(null);
      setPatchBaselineFileName(null);
      setStatusMessage(t("app.status.patch.baseline_load_failed"));
      return;
    }

    setPatchBaselineDoc(parseResult.document);
    setPatchBaselineFileName(selectedFile.name);
    setStatusMessage(t("app.status.patch.baseline_loaded"));
  }, [abstractMapView, runTenantScopedOptionalTask, summaryView]);

  const handleFixProposalCheckedChange = useCallback((fixId: string, checked: boolean) => {
    setSelectedFixProposalIdSet((previousSet) => {
      const next = new Set(previousSet);
      if (checked) {
        next.add(fixId);
      } else {
        next.delete(fixId);
      }
      return next;
    });
  }, [abstractMapView, summaryView]);

  const handleApplySelectedPatchFixes = useCallback(() => {
    if (!pendingPatchImport || selectedFixProposalIdSet.size === 0) {
      setStatusMessage(t("app.status.patch.no_fix_selected"));
      return;
    }

    const nextPatch = applyFixesToPatch(pendingPatchImport.patch, [...selectedFixProposalIdSet], patchFixProposals);
    setPendingPatchImport({
      ...pendingPatchImport,
      patch: nextPatch,
    });

    setPatchSelectedOpIdSet((previousSet) => {
      const nextOpIds = new Set(nextPatch.ops.map((op) => op.id));
      return new Set([...previousSet].filter((opId) => nextOpIds.has(opId)));
    });

    setPatchResolutionsByOpId((previousMap) => {
      const nextMap: Record<string, PatchResolution> = {};
      for (const op of nextPatch.ops) {
        nextMap[op.id] = previousMap[op.id] ?? "skip";
      }
      return nextMap;
    });

    setStatusMessage(t("app.status.patch.updated_rerun_lint"));
  }, [patchFixProposals, pendingPatchImport, selectedFixProposalIdSet]);

  const handleExportPatchFile = useCallback(async () => {
    if (!pendingPatchImport) {
      setStatusMessage(t("app.status.patch.none_loaded"));
      return;
    }

    const exportedPatch = await runTenantScopedOptionalTask(() => buildPatchForExport(pendingPatchImport.patch, {
      author: patchExportAuthor,
      authorNote: patchExportAuthorNote,
      sourceApp: "sui-sensemaking",
    }));
    if (exportedPatch === undefined) {
      return;
    }

    const sanitizedFileStem = pendingPatchImport.fileName.replace(/\.json$/i, "").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
    downloadTextFile(`${sanitizedFileStem || "patch"}.export.json`, "application/json", `${JSON.stringify(exportedPatch, null, 2)}\n`);
    setStatusMessage(t("app.status.patch.exported_fingerprint"));
  }, [patchExportAuthor, patchExportAuthorNote, pendingPatchImport, runTenantScopedOptionalTask]);

  const handleResetPatchToOriginal = useCallback(() => {
    if (!pendingPatchImport) {
      return;
    }

    const originalPatch = pendingPatchImport.originalPatch;
    setPendingPatchImport({
      ...pendingPatchImport,
      patch: originalPatch,
    });
    setPatchSelectedOpIdSet(new Set(originalPatch.ops.map((op) => op.id)));

    const nextResolutions: Record<string, PatchResolution> = {};
    for (const op of originalPatch.ops) {
      nextResolutions[op.id] = "skip";
    }
    setPatchResolutionsByOpId(nextResolutions);
    setStatusMessage(t("app.status.patch.reset"));
  }, [pendingPatchImport]);

  const handleApplyPatch = useCallback(() => {
    if (!document || !pendingPatchImport) {
      setStatusMessage(t("app.status.patch.none_loaded"));
      return;
    }

    if (shouldBlockPatchApplyByLint(patchLintResult)) {
      setStatusMessage(t("app.status.patch.resolve_lint"));
      return;
    }

    const applyResult = applyPatchWithResolutionsDetailed(
      document,
      pendingPatchImport.patch,
      patchResolutionsByOpId,
      patchBaselineDoc ?? undefined,
      patchSelectedOpIdSet
    );

    const nextDocument = appendPatchApplyLog(applyResult.document, pendingPatchImport.patch, {
      ...applyResult.meta,
      patchTitle: pendingPatchImport.fileName,
      baseDocSignature: patchBaselineDoc ? `${patchBaselineDoc.id}:${patchBaselineDoc.updatedAt}` : undefined,
    });

    applyDocumentChange(nextDocument, t("app.status.patch.applied"));
  }, [applyDocumentChange, document, patchBaselineDoc, patchLintResult, patchResolutionsByOpId, patchSelectedOpIdSet, pendingPatchImport]);


  const handleCopyPatchApplyLogEntry = useCallback(async (entryId: string) => {
    const entry = document?.patchApplyLog?.find((item) => item.id === entryId);
    if (!entry) {
      setStatusMessage(t("app.status.patch.apply_log_not_found"));
      return;
    }

    try {
      await navigator.clipboard.writeText(formatPatchApplyLogEntryMarkdown(entry));
      setStatusMessage(t("app.status.patch.apply_log_copied"));
    } catch {
      setStatusMessage(t("app.status.patch.apply_log_copy_failed"));
    }
  }, [document]);

  const handleCopyPatchSummary = useCallback(async () => {
    if (!patchSummary) {
      setStatusMessage(t("app.status.patch.summary_none"));
      return;
    }

    try {
      await navigator.clipboard.writeText(formatPatchSummaryMarkdown(patchSummary));
      setStatusMessage(t("app.status.patch.summary_copied"));
    } catch {
      setStatusMessage(t("app.status.patch.summary_copy_failed"));
    }
  }, [patchSummary]);

  const handleReplaceCurrentDocument = useCallback(() => {
    if (!pendingImportedDocument) {
      setStatusMessage(t("app.status.import.no_validated_document"));
      return;
    }

    pendingCardDragSnapshotRef.current = null;
    setHistory({
      past: [],
      present: cloneDocument(pendingImportedDocument.document),
      future: [],
    });
    setActiveDocumentId(pendingImportedDocument.document.id);
    setSelectedRecentDocumentId("");
    setDocEtag(null);
    setSelectedCardIds([]);
    setSelectedIslandId(null);
    setSelectedEdgeId(null);
    setIsPickingEdgeTarget(false);
    setFocusCardId(null);
    setFocusTarget({});
    setFocusWorldPoint(null);
    setPeekIslandId(undefined);
    setFlashReference(null);
    setTemporaryRevealCardIds(new Set());
    setSummaryRevealIslandIds(new Set());
    setRevealedSourceCardIds(new Set());
    setComparisonDocument(null);
    setComparisonFileName(null);
    setGroundingVisibilityMessage(null);
    setIsDirty(!isReadOnly);
    setHasSaveConflict(false);
    setSuggestedDocument(null);
    setSuggestionId(null);
    setSuggestionNotes(null);
    setSuggestionError(null);
    setPendingImportedDocument(null);
    setImportDocumentError(null);
    setStatusMessage(t(isReadOnly ? "app.status.import.document_opened_read_only" : "app.status.import.document_replaced"));
  }, [isReadOnly, pendingImportedDocument]);

  const handleEdgeSelect = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedCardIds([]);
    setSelectedIslandId(null);
  }, [abstractMapView, summaryView]);

  // DOMAIN-KJ-01: change a persisted edge's relation type in place (one
  // history step, Cmd/Ctrl+Z reversible). Only persisted edges are eligible —
  // derived/aggregated edges have no document row to mutate.
  const handleEdgeTypeChange = useCallback(
    (edgeId: string, nextType: KnownEdgeType) => {
      if (!document) {
        return;
      }

      const nextEdges = document.edges.map((edge) => {
        if (edge.id !== edgeId || edge.type === nextType) {
          return edge;
        }
        return { ...edge, type: nextType };
      });

      const hasChanges = nextEdges.some((edge, index) => edge !== document.edges[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        { ...document, edges: nextEdges },
        t("app.history.edge.type_updated", { value: t(`side_panel.connect.${nextType}`) })
      );
    },
    [applyDocumentChange, document]
  );

  const handleCardSelect = useCallback((cardId: string, isShiftPressed: boolean) => {
    if (isPickingEdgeTarget) {
      if (!document) {
        return;
      }

      const source =
        selectedIslandId && selectedCardIds.length === 0
          ? { id: selectedIslandId, kind: "island" as const }
          : !selectedIslandId && selectedCardIds.length === 1
            ? { id: selectedCardIds[0], kind: "card" as const }
            : null;

      if (!source || (source.id === cardId && source.kind === "card")) {
        return;
      }

      const edgeWithKinds = {
        id: crypto.randomUUID(),
        fromId: source.id,
        toId: cardId,
        fromKind: source.kind,
        toKind: "card",
        type: connectEdgeType,
      } as DocumentV1["edges"][number];

      applyDocumentChange(
        {
          ...document,
          edges: [...document.edges, edgeWithKinds],
        },
        t("app.status.edit.connected", {
          source: getEntityKindDisplayLabel(source.kind),
          target: getEntityKindDisplayLabel("card"),
        })
      );
      setIsPickingEdgeTarget(false);
      return;
    }

    if (isPreviewingSuggestion && !isAnnotateOverlayEnabled) {
      return;
    }

    if (document && isReadingOrderEditMode && isShiftPressed) {
      const nextReadingOrder = appendReadingOrderEntry(document.readingOrder ?? [], cardId, visibleCardIdSet);
      if (nextReadingOrder !== (document.readingOrder ?? [])) {
        applyDocumentChange(
          {
            ...document,
            readingOrder: nextReadingOrder,
          },
          t("app.history.reading_order.card_added")
        );
        return;
      }
    }

    setSelectedCardIds((previousSelectedCardIds) => {
      if (isShiftPressed) {
        const isAlreadySelected = previousSelectedCardIds.includes(cardId);
        if (isAlreadySelected) {
          return previousSelectedCardIds.filter((selectedCardId) => selectedCardId !== cardId);
        }

        return [...previousSelectedCardIds, cardId];
      }

      if (previousSelectedCardIds.length === 1 && previousSelectedCardIds[0] === cardId) {
        return previousSelectedCardIds;
      }

      return [cardId];
    });
    if (isPreviewingSuggestion && isAnnotateOverlayEnabled) {
      setSelectedIslandId(null);
    }
    setSelectedEdgeId(null);
  }, [
    applyDocumentChange,
    connectEdgeType,
    document,
    isAnnotateOverlayEnabled,
    isPickingEdgeTarget,
    isPreviewingSuggestion,
    isReadingOrderEditMode,
    selectedCardIds,
    selectedIslandId,
    visibleCardIdSet,
  ]);

  const handleCanvasBackgroundClick = useCallback(() => {
    if (isPickingEdgeTarget) {
      return;
    }

    setSelectedCardIds((previousSelectedCardIds) => {
      if (previousSelectedCardIds.length === 0) {
        return previousSelectedCardIds;
      }

      return [];
    });
    setSelectedIslandId(null);
    setSelectedEdgeId(null);
  }, [isPickingEdgeTarget]);

  const handleClearSelection = useCallback(() => {
    if (isPickingEdgeTarget) {
      setIsPickingEdgeTarget(false);
      setStatusMessage(t("app.status.edit.connect_cancelled"));
      return;
    }

    const activeElement = window.document.activeElement;
    const shouldRestoreSelectionContextFocus =
      activeElement instanceof HTMLElement &&
      activeElement.closest('[data-panel="selection-context"]') !== null;

    setSelectedCardIds((previousSelectedCardIds) => {
      if (previousSelectedCardIds.length === 0) {
        return previousSelectedCardIds;
      }

      return [];
    });
    setSelectedIslandId(null);
    setSelectedEdgeId(null);
    if (shouldRestoreSelectionContextFocus) {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (window.document.activeElement !== window.document.body) {
            return;
          }
          const selectionContext = window.document.querySelector<HTMLElement>('[data-panel="selection-context"]');
          selectionContext?.focus({ preventScroll: true });
        });
      });
    }
  }, [isPickingEdgeTarget]);

  const handleMarqueeSelect = useCallback((cardIds: string[], isShiftPressed: boolean) => {
    if (isPickingEdgeTarget) {
      return;
    }

    setSelectedCardIds((previousSelectedCardIds) => {
      const uniqueCardIds = Array.from(new Set(cardIds));

      if (isShiftPressed) {
        return Array.from(new Set([...previousSelectedCardIds, ...uniqueCardIds]));
      }

      if (
        previousSelectedCardIds.length === uniqueCardIds.length &&
        previousSelectedCardIds.every((id, index) => id === uniqueCardIds[index])
      ) {
        return previousSelectedCardIds;
      }

      return uniqueCardIds;
    });
    setSelectedEdgeId(null);
  }, [isPickingEdgeTarget]);

  const canCreateIsland = selectedCardIds.length > 0;
  const edgeConnectSource = useMemo<EdgeConnectSource | null>(() => {
    if (selectedIslandId && selectedCardIds.length === 0) {
      return { id: selectedIslandId, kind: "island" };
    }

    if (!selectedIslandId && selectedCardIds.length === 1) {
      return { id: selectedCardIds[0], kind: "card" };
    }

    return null;
  }, [selectedCardIds, selectedIslandId]);
  const canStartConnect = edgeConnectSource !== null;

  const handleStartConnect = useCallback(() => {
    if (!edgeConnectSource) {
      return;
    }

    setIsPickingEdgeTarget(true);
    setStatusMessage(t("app.status.edit.select_connect_target"));
  }, [edgeConnectSource]);

  const handleCancelConnect = useCallback(() => {
    if (!isPickingEdgeTarget) {
      return;
    }

    setIsPickingEdgeTarget(false);
    setStatusMessage(t("app.status.edit.connect_cancelled"));
  }, [isPickingEdgeTarget]);

  const handleConnectToTarget = useCallback(
    (target: EdgeConnectSource) => {
      if (!document || !isPickingEdgeTarget || !edgeConnectSource) {
        return;
      }

      if (edgeConnectSource.id === target.id && edgeConnectSource.kind === target.kind) {
        return;
      }

      const edgeWithKinds = {
        id: crypto.randomUUID(),
        fromId: edgeConnectSource.id,
        toId: target.id,
        fromKind: edgeConnectSource.kind,
        toKind: target.kind,
        type: connectEdgeType,
      } as DocumentV1["edges"][number];

      applyDocumentChange(
        {
          ...document,
          edges: [...document.edges, edgeWithKinds],
        },
        t("app.status.edit.connected", {
          source: getEntityKindDisplayLabel(edgeConnectSource.kind),
          target: getEntityKindDisplayLabel(target.kind),
        })
      );
      setIsPickingEdgeTarget(false);
    },
    [applyDocumentChange, connectEdgeType, document, isPickingEdgeTarget, selectedCardIds, selectedIslandId]
  );

  const markEmptyCanvasHintCompleted = useCallback(() => {
    appStorage.saveEmptyCanvasHintCompleted(true);
    setEmptyCanvasHintCompleted(true);
  }, [appStorage]);

  const handleResetEmptyCanvasHint = useCallback(() => {
    appStorage.saveEmptyCanvasHintCompleted(false);
    setEmptyCanvasHintCompleted(false);
    setStatusMessage(t("app.status.empty_canvas_hint_reset"));
  }, [appStorage]);

  const handleCloseCanvasLegend = useCallback(() => {
    // ADR-0030 contract: closing returns focus to the originating trigger.
    // Focus synchronously BEFORE unmounting the legend so the browser never
    // drops focus to <body> when the legend's close button disappears.
    // NOTE: `document` in this scope is the kj document state; use window.document.
    window.document
      .querySelector<HTMLElement>('[data-focus-return-id="legend-trigger"]')
      ?.focus();
    setIsCanvasLegendOpen(false);
  }, []);

  const closeCommandPalette = useCallback(() => {
    // UX-CMDK-01 AC-1 (ADR-0030 contract): Escape/backdrop cancel restores
    // focus to whatever had focus before the palette opened. Mirrors
    // handleCloseCanvasLegend's synchronous-focus-before-unmount pattern.
    commandPaletteReturnFocusRef.current?.focus();
    commandPaletteReturnFocusRef.current = null;
    setIsCommandPaletteOpen(false);
  }, []);

  const closeShortcutCheatsheet = useCallback(() => {
    // UX-SHORTCUT-01 AC-4 (ADR-0030 contract): same synchronous-focus-before-
    // unmount pattern as closeCommandPalette / handleCloseCanvasLegend.
    shortcutCheatsheetReturnFocusRef.current?.focus();
    shortcutCheatsheetReturnFocusRef.current = null;
    setIsShortcutCheatsheetOpen(false);
  }, []);

  const createCardAtPosition = useCallback(
    (x: number, y: number) => {
      if (!document) {
        return;
      }

      const newCardId = crypto.randomUUID();
      const newCard = { id: newCardId, text: "新しいカード", x, y };
      const isFirstCard = document.cards.length === 0;

      const applied = applyDocumentChange(
        {
          ...document,
          cards: [...document.cards, newCard],
        },
        t("app.status.edit.added_card")
      );

      if (applied) {
        if (isFirstCard) {
          markEmptyCanvasHintCompleted();
        }
        setSelectedIslandId(null);
        setSelectedEdgeId(null);
        setSelectedCardIds([newCardId]);
        setEditingCardId(newCardId);
      }
    },
    [applyDocumentChange, document, markEmptyCanvasHintCompleted]
  );

  const handleAddCard = useCallback(() => {
    if (!document) {
      return;
    }

    const anchorCard =
      (selectedCardIds.length > 0
        ? document.cards.find((card) => card.id === selectedCardIds[0])
        : document.cards[document.cards.length - 1]) ?? null;
    createCardAtPosition(anchorCard ? anchorCard.x + 40 : 120, anchorCard ? anchorCard.y + 40 : 120);
  }, [createCardAtPosition, document, selectedCardIds]);

  const handleAddCardAtPoint = useCallback(
    (worldX: number, worldY: number) => {
      createCardAtPosition(worldX - CARD_WIDTH / 2, worldY - CARD_HEIGHT / 2);
    },
    [createCardAtPosition]
  );

  const handleEditCard = useCallback((cardId: string) => {
    setSelectedIslandId(null);
    setSelectedEdgeId(null);
    setSelectedCardIds([cardId]);
    setEditingCardId(cardId);
  }, []);

  const handleConnectFromCard = useCallback((cardId: string) => {
    setSelectedIslandId(null);
    setSelectedEdgeId(null);
    setSelectedCardIds([cardId]);
    setIsPickingEdgeTarget(true);
    setStatusMessage(t("app.status.edit.select_connect_target"));
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCardContextMenu = useCallback(
    (cardId: string, clientX: number, clientY: number, trigger: HTMLElement) => {
      contextMenuReturnFocusRef.current = trigger;
      setSelectedCardIds((previous) => (previous.includes(cardId) ? previous : [cardId]));
      setContextMenu({ x: clientX, y: clientY, target: { kind: "card", cardId } });
    },
    []
  );

  const handleBackgroundContextMenu = useCallback(
    (clientX: number, clientY: number, worldX: number, worldY: number) => {
      contextMenuReturnFocusRef.current =
        globalThis.document.activeElement instanceof HTMLElement ? globalThis.document.activeElement : null;
      if (document) {
        const localCardsById = new Map(document.cards.map((card): [string, typeof card] => [card.id, card]));
        const hitIsland = document.islands.find((island) => {
          const bounds = getIslandWorldBounds(island, localCardsById);
          if (!bounds) {
            return false;
          }
          return (
            worldX >= bounds.x &&
            worldX <= bounds.x + bounds.w &&
            worldY >= bounds.y &&
            worldY <= bounds.y + bounds.h
          );
        });
        if (hitIsland) {
          setContextMenu({ x: clientX, y: clientY, target: { kind: "island", islandId: hitIsland.id } });
          return;
        }
      }
      setContextMenu({ x: clientX, y: clientY, target: { kind: "background", worldX, worldY } });
    },
    [document]
  );

  const handleAddSelectedCardsToIslandById = useCallback(
    (islandId: string) => {
      if (!document || selectedCardIds.length === 0) {
        return;
      }
      const island = document.islands.find((candidate) => candidate.id === islandId);
      if (!island) {
        return;
      }
      const mergedCardIds = Array.from(new Set([...island.cardIds, ...selectedCardIds]));
      if (mergedCardIds.length === island.cardIds.length) {
        return;
      }
      applyDocumentChange(
        {
          ...document,
          islands: document.islands.map((candidate) =>
            candidate.id === islandId ? { ...candidate, cardIds: mergedCardIds } : candidate
          ),
        },
        t("app.history.island.selected_cards_added")
      );
    },
    [applyDocumentChange, document, selectedCardIds, t]
  );

  const handleDeleteIslandById = useCallback(
    (islandId: string) => {
      if (!document) {
        return;
      }
      const nextIslands = document.islands.filter((candidate) => candidate.id !== islandId);
      if (nextIslands.length === document.islands.length) {
        return;
      }
      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
          readingOrder: (document.readingOrder ?? []).filter((entryId) => entryId !== islandId),
        },
        t("app.history.island.deleted")
      );
      setSelectedIslandId((previous) => (previous === islandId ? null : previous));
    },
    [applyDocumentChange, document, t]
  );

  const handleToggleAdvancedUi = useCallback(() => {
    setIsAdvancedUiEnabled((previous) => {
      const next = !previous;
      appStorage.saveAdvancedUiEnabled(next);
      return next;
    });
  }, [appStorage]);

  const handleOpenCritiqueWorkflow = useCallback(() => {
    setIsAdvancedUiEnabled(true);
    setIsWorkModeOpen(true);
    appStorage.saveAdvancedUiEnabled(true);
    setCritiqueWorkflowFocusRequest((current) => current + 1);
  }, [appStorage]);

  const handleCommitCardText = useCallback(
    (cardId: string, text: string) => {
      setEditingCardId(null);
      if (!document) {
        return;
      }

      const targetCard = document.cards.find((card) => card.id === cardId);
      if (!targetCard) {
        return;
      }

      const nextText = text.trim();
      if (nextText.length === 0 || nextText === targetCard.text) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          cards: document.cards.map((card) =>
            card.id === cardId ? { ...card, text: nextText } : card
          ),
        },
        t("app.status.edit.edited_card_text")
      );
    },
    [applyDocumentChange, document]
  );

  const handleCancelEditCard = useCallback(() => {
    setEditingCardId(null);
  }, []);

  const handleCreateIsland = useCallback(() => {
    if (!document || selectedCardIds.length === 0) {
      return;
    }

    const uniqueSelectedCardIds = Array.from(new Set(selectedCardIds));

    const newIsland = createIslandFromSelection(uniqueSelectedCardIds);

    applyDocumentChange({
      ...document,
      islands: [...document.islands, newIsland],
    });
    // Creating an island changes the primary target. Keeping the source-card
    // selection would leave the header/bulk bar and inspector describing
    // different targets at the same time.
    setSelectedCardIds([]);
    setSelectedIslandId(newIsland.id);
    setStatusMessage(t("app.status.edit.created_island", { count: selectedCardIds.length }));
  }, [applyDocumentChange, document, selectedCardIds]);

  const handleCreateRepresentativeCard = useCallback(() => {
    if (!document || selectedCardIds.length < 2) {
      return;
    }

    const selectedCards = document.cards.filter((card) => selectedCardIds.includes(card.id));
    const representativeText = window.prompt(t("app.prompt.representative_card_text"), selectedCards[0]?.text ?? "");
    if (representativeText === null) {
      return;
    }

    const shouldRewire = window.confirm(
      t("app.confirm.rewire_representative_card")
    );

    const mergeResult = createRepresentativeMerge(document, selectedCardIds, representativeText, {
      rewireMembershipAndEdges: shouldRewire,
    });

    if (!mergeResult) {
      setStatusMessage(t("app.status.edit.representative_card_text_required"));
      return;
    }

    applyDocumentChange(mergeResult.nextDocument, t("app.status.edit.created_representative_card"));
    setSelectedIslandId(null);
    setSelectedEdgeId(null);
    setSelectedCardIds([mergeResult.representativeCardId]);
    setStatusMessage(t(
      shouldRewire
        ? "app.status.edit.created_representative_card_rewired"
        : "app.status.edit.created_representative_card_from_originals",
      { count: mergeResult.mergedCardCount },
    ));
  }, [applyDocumentChange, document, selectedCardIds]);

  const handleIslandTitleChange = useCallback(
    (islandId: string, rawTitle: string) => {
      if (!document) {
        return;
      }

      const nextTitle = rawTitle.length > 0 ? rawTitle : undefined;
      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        if ((island.title ?? undefined) === nextTitle) {
          return island;
        }

        return {
          ...island,
          title: nextTitle,
          titleReviewed: true,
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t("app.history.island.title_updated")
      );
    },
    [applyDocumentChange, document]
  );


  const handleIslandParentChange = useCallback(
    (islandId: string, parentIslandId: string | undefined) => {
      if (!document) {
        return;
      }

      const islandsById = new Map(document.islands.map((island) => [island.id, island]));
      if (parentIslandId) {
        if (parentIslandId === islandId || !islandsById.has(parentIslandId)) {
          return;
        }

        const visited = new Set<string>([islandId]);
        let cursor = islandsById.get(parentIslandId);
        while (cursor?.parentIslandId) {
          if (visited.has(cursor.id)) {
            return;
          }
          visited.add(cursor.id);
          if (cursor.parentIslandId === islandId) {
            return;
          }
          cursor = islandsById.get(cursor.parentIslandId);
        }
      }

      const nextIslands = document.islands.map((island) =>
        island.id === islandId
          ? {
              ...island,
              parentIslandId,
            }
          : island
      );

      applyDocumentChange({ ...document, islands: nextIslands }, t("app.history.island.hierarchy_updated"));
    },
    [applyDocumentChange, document]
  );

  const handleIslandPlacardCardChange = useCallback(
    (islandId: string, placardCardId: string | undefined) => {
      if (!document) {
        return;
      }

      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        if (placardCardId && !island.cardIds.includes(placardCardId)) {
          return island;
        }

        if ((island.placardCardId ?? undefined) === (placardCardId ?? undefined)) {
          return island;
        }

        // titleReviewed staleness fix: swapping the placard card changes what text is
        // effectively displayed as the island's title (表札), so a review recorded
        // against the prior configuration no longer describes what's shown. Only
        // handleIslandTitleChange (a direct title edit, self-attested) may set
        // titleReviewed back to true.
        return {
          ...island,
          placardCardId,
          titleReviewed: false,
        };
      });

      applyDocumentChange({ ...document, islands: nextIslands }, t("app.history.island.placard_updated"));
    },
    [applyDocumentChange, document]
  );

  const handleIslandSummaryTextChange = useCallback(
    (islandId: string, rawSummaryText: string) => {
      if (!document) {
        return;
      }

      const nextSummaryText = rawSummaryText.length > 0 ? rawSummaryText : undefined;
      const nextDocument = updateIslandSummaryWithHistory(
        document,
        islandId,
        {
          summaryText: nextSummaryText,
          summaryReviewed: true,
        },
        {
          changeKind: "manual",
        }
      );

      if (nextDocument === document) {
        return;
      }

      applyDocumentChange(nextDocument, t("app.history.island.summary_updated"));
    },
    [applyDocumentChange, document]
  );

  const handleIslandImageUrlChange = useCallback(
    (islandId: string, rawImageUrl: string) => {
      if (!document) {
        return;
      }

      const nextImageUrl = rawImageUrl.length > 0 ? rawImageUrl : undefined;
      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        if ((island.imageUrl ?? undefined) === nextImageUrl) {
          return island;
        }

        return {
          ...island,
          imageUrl: nextImageUrl,
          imageReviewed: false,
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t("app.history.island.image_url_updated")
      );
    },
    [applyDocumentChange, document]
  );

  const handleIslandRepresentativeVisualCueChange = useCallback(
    (islandId: string, representativeCue: Island["representativeCue"]): boolean => {
      if (!document) {
        return false;
      }

      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        const currentCue = island.representativeCue;
        if (
          currentCue?.kind === representativeCue?.kind
          && currentCue?.cueId === representativeCue?.cueId
          && currentCue?.altText === representativeCue?.altText
          && currentCue?.imageRef === representativeCue?.imageRef
        ) {
          return island;
        }

        return {
          ...island,
          representativeCue,
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return false;
      }

      return applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t(representativeCue ? "app.history.island.visual_cue_updated" : "app.history.island.visual_cue_removed"),
      );
    },
    [applyDocumentChange, document],
  );

  useEffect(() => {
    if (!history) {
      return;
    }
    const documents = [...history.past, history.present, ...history.future];
    const retainedImageRefs = new Set(
      documents.flatMap((candidate) =>
        candidate.islands.flatMap((island) => {
          const cue = island.representativeCue;
          return (cue?.kind === "hand_drawn" || cue?.kind === "user_image") && cue.imageRef
            ? [cue.imageRef]
            : [];
        }),
      ),
    );
    void deleteUnreferencedRepresentativeVisualCueAssets(
      history.present.id,
      retainedImageRefs,
      appStorage.scope,
    ).catch(() => {
      // Best-effort garbage collection only. Read/write remains fail-closed at
      // the asset operation boundary; a cleanup retry occurs on the next
      // document-history change.
    });
  }, [
    appStorage.scope?.deployment,
    appStorage.scope?.principalId,
    appStorage.scope?.tenantId,
    history,
  ]);

  const handleCardCritiqueChange = useCallback(
    (cardId: string, rawCritique: string) => {
      if (!document) {
        return;
      }

      const nextCritique = rawCritique.length > 0 ? rawCritique : undefined;
      const nextCards = document.cards.map((card) => {
        if (card.id !== cardId) {
          return card;
        }

        if ((card.critique ?? undefined) === nextCritique) {
          return card;
        }

        return {
          ...card,
          critique: nextCritique,
        };
      });

      const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
        },
        t("app.history.card.critique_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  // DOMAIN-TRACE-01 (schemas.md §15): one history step per change (⌘Z
  // reversible). The meta object is dropped entirely when both fields are
  // cleared so an unset card stays byte-identical to the pre-feature shape.
  const handleCardMetaChange = useCallback(
    (cardId: string, rawSeq: string, rawSource: string) => {
      if (!document) {
        return;
      }

      const parsedSeq = rawSeq.trim().length > 0 ? Number(rawSeq) : undefined;
      const seq = parsedSeq !== undefined && Number.isFinite(parsedSeq) ? parsedSeq : undefined;
      const source = rawSource.trim().length > 0 ? rawSource : undefined;
      const nextMeta: CardMeta | undefined =
        seq === undefined && source === undefined
          ? undefined
          : { ...(seq !== undefined ? { seq } : {}), ...(source !== undefined ? { source } : {}) };

      const nextCards = document.cards.map((card) => {
        if (card.id !== cardId) {
          return card;
        }

        const currentSeq = card.meta?.seq;
        const currentSource = card.meta?.source;
        if (currentSeq === nextMeta?.seq && currentSource === nextMeta?.source) {
          return card;
        }

        if (nextMeta === undefined) {
          const { meta: _removed, ...rest } = card;
          return rest;
        }

        return { ...card, meta: nextMeta };
      });

      const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
        },
        t("app.history.card.meta_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleCardKaChange = useCallback(
    (cardId: string, rawVoice: string, rawValue: string) => {
      if (!document) {
        return;
      }

      const voice = rawVoice.trim().length > 0 ? rawVoice : undefined;
      const value = rawValue.trim().length > 0 ? rawValue : undefined;
      const nextKa: CardKa | undefined =
        voice === undefined && value === undefined
          ? undefined
          : { ...(voice !== undefined ? { voice } : {}), ...(value !== undefined ? { value } : {}) };

      const nextCards = document.cards.map((card) => {
        if (card.id !== cardId) {
          return card;
        }

        const currentVoice = card.ka?.voice;
        const currentValue = card.ka?.value;
        if (currentVoice === nextKa?.voice && currentValue === nextKa?.value) {
          return card;
        }

        if (nextKa === undefined) {
          const { ka: _removed, ...rest } = card;
          return rest;
        }

        return { ...card, ka: nextKa };
      });

      const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
        },
        t("app.history.card.ka_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleCardClaimTypeChange = useCallback(
    (cardId: string, nextClaimType: ClaimType) => {
      if (!document) {
        return;
      }

      const nextCards = document.cards.map((card) => {
        if (card.id !== cardId) {
          return card;
        }

        const currentClaimType = card.claimType ?? "unknown";
        if (currentClaimType === nextClaimType) {
          return card;
        }

        return {
          ...card,
          claimType: nextClaimType,
        };
      });

      const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
        },
        t("app.history.card.claim_type_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleCardHoldStateChange = useCallback(
    (cardId: string, selection: HoldStateSelection) => {
      if (!document) {
        return;
      }

      const nextDocument = updateCardHoldStateAndShelf(document, cardId, selection, new Date().toISOString());
      if (nextDocument === document) {
        return;
      }

      applyDocumentChange(
        nextDocument,
        t("app.history.card.hold_state_updated", { value: selection }),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  // UX-SCALE-01 (b): bulk variants of the H/U/type-change single-card
  // handlers above, each applying to the whole selection as exactly ONE
  // document/history step (never a per-card loop of applyDocumentChange).
  const handleBulkToggleHold = useCallback(() => {
    if (!document || selectedCardIds.length < 2) {
      return;
    }

    const selectedCardIdSet = new Set(selectedCardIds);
    const selectedCardList = document.cards.filter((card) => selectedCardIdSet.has(card.id));
    // Mirrors a "select-all checkbox": all-held -> release all; anything
    // else (mixed or none held) -> hold all. Matches the single-card H-key
    // rule (held -> active, else -> held) when there is exactly one state.
    const allHeld = selectedCardList.length > 0 && selectedCardList.every((card) => card.holdState === "held");
    const targetSelection: HoldStateSelection = allHeld ? "active" : "held";
    const timestamp = new Date().toISOString();
    const nextDocument = selectedCardIds.reduce(
      (doc, cardId) => updateCardHoldStateAndShelf(doc, cardId, targetSelection, timestamp),
      document
    );
    if (nextDocument === document) {
      return;
    }

    applyDocumentChange(
      nextDocument,
      t("app.history.card.hold_state_updated", { value: targetSelection }),
      { preserveSuggestionPreview: true }
    );
  }, [applyDocumentChange, document, selectedCardIds]);

  const handleBulkToggleCritique = useCallback(() => {
    if (!document || selectedCardIds.length < 2) {
      return;
    }

    const selectedCardIdSet = new Set(selectedCardIds);
    // Same safe, non-destructive per-card toggle as the U key (一枚一志):
    // empty -> marker, marker -> empty, authored text -> untouched.
    const marker = t("card_view.critique_quick_flag");
    const nextCards = document.cards.map((card) => {
      if (!selectedCardIdSet.has(card.id)) {
        return card;
      }

      const current = card.critique?.trim() ?? "";
      const next = current.length === 0 ? marker : current === marker ? "" : current;
      const nextCritique = next.length > 0 ? next : undefined;
      if ((card.critique ?? undefined) === nextCritique) {
        return card;
      }

      return { ...card, critique: nextCritique };
    });

    const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
    if (!hasChanges) {
      return;
    }

    applyDocumentChange(
      { ...document, cards: nextCards },
      t("app.history.card.critique_updated"),
      { preserveSuggestionPreview: true }
    );
  }, [applyDocumentChange, document, selectedCardIds]);

  const handleBulkAddCritiqueReason = useCallback(
    (rawReason: string) => {
      if (!document || selectedCardIds.length < 2) {
        return;
      }

      const reason = rawReason.trim();
      if (!reason) {
        return;
      }

      const selectedCardIdSet = new Set(selectedCardIds);
      const nextCards = document.cards.map((card) => {
        if (!selectedCardIdSet.has(card.id)) {
          return card;
        }

        const current = card.critique?.trim() ?? "";
        const nextCritique = current.length > 0 ? `${current}\n\n${reason}` : reason;
        return { ...card, critique: nextCritique };
      });

      applyDocumentChange(
        { ...document, cards: nextCards },
        t("app.history.card.critique_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document, selectedCardIds]
  );

  const handleBulkClaimTypeChange = useCallback(
    (nextClaimType: ClaimType) => {
      if (!document || selectedCardIds.length < 2) {
        return;
      }

      const selectedCardIdSet = new Set(selectedCardIds);
      const nextCards = document.cards.map((card) => {
        if (!selectedCardIdSet.has(card.id)) {
          return card;
        }

        const currentClaimType = card.claimType ?? "unknown";
        if (currentClaimType === nextClaimType) {
          return card;
        }

        return { ...card, claimType: nextClaimType };
      });

      const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        { ...document, cards: nextCards },
        t("app.history.card.claim_type_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document, selectedCardIds]
  );

  const handleRestoreShelvedCard = useCallback(
    (cardId: string) => {
      if (!document) {
        return;
      }

      const nextDocument = updateCardHoldStateAndShelf(document, cardId, "active", new Date().toISOString());
      if (nextDocument === document) {
        return;
      }

      applyDocumentChange(
        nextDocument,
        t("app.history.card.shelf_restored"),
        { preserveSuggestionPreview: true }
      );
      setSelectedCardIds([cardId]);
    },
    [applyDocumentChange, document]
  );

  const handleCardTextReviewedChange = useCallback(
    (cardId: string, reviewed: boolean) => {
      if (!document) {
        return;
      }

      const nextCards = document.cards.map((card) => {
        if (card.id !== cardId) {
          return card;
        }

        if ((card.textReviewed ?? false) === reviewed) {
          return card;
        }

        return {
          ...card,
          textReviewed: reviewed,
        };
      });

      const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
        },
        t(reviewed ? "app.history.card.marked_reviewed" : "app.history.card.marked_unreviewed"),
        { preserveSuggestionPreview: true }
      );
      setReviewEvents((previous) => appendReviewEvent(previous, {
        target: { kind: "card", id: cardId },
        reviewed,
        reviewerRef: currentReviewerRef,
        contextLabel: "card.text",
      }));
    },
    [applyDocumentChange, currentReviewerRef, document, setReviewEvents]
  );

  const handleAddEvidenceLink = useCallback(
    (fromCardId: string, payload: { toCardId: string; type: "supports" | "contradicts" }) => {
      if (!document || fromCardId === payload.toCardId) {
        return;
      }

      const hasDuplicate = (document.evidenceLinks ?? []).some((link) =>
        link.fromCardId === fromCardId && link.toCardId === payload.toCardId && link.type === payload.type
      );
      if (hasDuplicate) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          evidenceLinks: [
            ...(document.evidenceLinks ?? []),
            {
              id: crypto.randomUUID(),
              type: payload.type,
              fromCardId,
              toCardId: payload.toCardId,
              createdAt: new Date().toISOString(),
            },
          ],
        },
        t("app.history.evidence_link.added"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleRemoveEvidenceLink = useCallback(
    (evidenceLinkId: string) => {
      if (!document) {
        return;
      }

      const nextEvidenceLinks = (document.evidenceLinks ?? []).filter((link) => link.id !== evidenceLinkId);
      if (nextEvidenceLinks.length === (document.evidenceLinks ?? []).length) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          evidenceLinks: nextEvidenceLinks,
        },
        t("app.history.evidence_link.removed"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleUpdateEvidenceLink = useCallback(
    (evidenceLinkId: string, patch: Partial<Pick<EvidenceLink, "contradictionState">>) => {
      if (!document) {
        return;
      }

      const nextEvidenceLinks = (document.evidenceLinks ?? []).map((link) => {
        if (link.id !== evidenceLinkId) {
          return link;
        }
        return { ...link, ...patch };
      });

      applyDocumentChange(
        {
          ...document,
          evidenceLinks: nextEvidenceLinks,
        },
        t("app.history.evidence_link.updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleContradictionSignalDecision = useCallback(
    (signatureKey: string, status: ContradictionSignalReviewStatus | null) => {
      if (!document) {
        return;
      }

      const existingDecisions = document.contradictionSignalDecisions ?? [];
      const withoutThisSignal = existingDecisions.filter((entry) => entry.signatureKey !== signatureKey);

      // null = revert to undecided ("proposed" is never persisted — DOMAIN-EXPR-04, schemas.md §16.2).
      const nextDecisions: ContradictionSignalDecision[] = status === null
        ? withoutThisSignal
        : [...withoutThisSignal, { signatureKey, status, decidedAt: new Date().toISOString() }];

      const { contradictionSignalDecisions: _removed, ...documentWithoutDecisions } = document;
      const nextDocument = nextDecisions.length > 0
        ? { ...document, contradictionSignalDecisions: nextDecisions }
        : documentWithoutDecisions;

      applyDocumentChange(
        nextDocument,
        t("app.history.contradiction_signal.decided"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleCardCritiqueTagsChange = useCallback(
    (cardId: string, nextTags: string[]) => {
      if (!document) {
        return;
      }

      const normalizedNextTags = nextTags.length > 0 ? [...nextTags] : undefined;
      const nextCards = document.cards.map((card) => {
        if (card.id !== cardId) {
          return card;
        }

        const currentTags = card.critiqueTags ?? [];
        const tagsChanged =
          currentTags.length !== nextTags.length || currentTags.some((tag, index) => tag !== nextTags[index]);
        if (!tagsChanged) {
          return card;
        }

        return {
          ...card,
          critiqueTags: normalizedNextTags,
        };
      });

      const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
        },
        t("app.history.card.critique_tags_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleIslandCritiqueChange = useCallback(
    (islandId: string, rawCritique: string) => {
      if (!document) {
        return;
      }

      const nextCritique = rawCritique.length > 0 ? rawCritique : undefined;
      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        if ((island.critique ?? undefined) === nextCritique) {
          return island;
        }

        return {
          ...island,
          critique: nextCritique,
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t("app.history.island.critique_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );


  const handleIslandCritiqueTagsChange = useCallback(
    (islandId: string, nextTags: string[]) => {
      if (!document) {
        return;
      }

      const normalizedNextTags = nextTags.length > 0 ? [...nextTags] : undefined;
      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        const currentTags = island.critiqueTags ?? [];
        const tagsChanged =
          currentTags.length !== nextTags.length || currentTags.some((tag, index) => tag !== nextTags[index]);
        if (!tagsChanged) {
          return island;
        }

        return {
          ...island,
          critiqueTags: normalizedNextTags,
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t("app.history.island.critique_tags_updated"),
        { preserveSuggestionPreview: true }
      );
    },
    [applyDocumentChange, document]
  );

  const handleIslandTitleReviewedChange = useCallback(
    (islandId: string, reviewed: boolean) => {
      if (!document) {
        return;
      }

      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        if ((island.titleReviewed ?? false) === reviewed) {
          return island;
        }

        return {
          ...island,
          titleReviewed: reviewed,
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t(reviewed ? "app.history.island.title_marked_reviewed" : "app.history.island.title_marked_unreviewed")
      );
      setReviewEvents((previous) => appendReviewEvent(previous, {
        target: { kind: "island", id: islandId },
        reviewed,
        reviewerRef: currentReviewerRef,
        contextLabel: "island.title",
      }));
    },
    [applyDocumentChange, currentReviewerRef, document, setReviewEvents]
  );

  const handleRestoreIslandSummaryVersion = useCallback(
    (islandId: string, historyEntryId: string) => {
      if (!document) {
        return;
      }

      const island = document.islands.find((item) => item.id === islandId);
      const historyEntry = island?.summaryHistory?.find((entry) => entry.id === historyEntryId);
      if (!island || !historyEntry) {
        return;
      }

      const restoredSummaryText = historyEntry.toText ?? undefined;
      const nextDocument = updateIslandSummaryWithHistory(
        document,
        islandId,
        {
          summaryText: restoredSummaryText,
          summaryReviewed: historyEntry.toReviewed ?? false,
        },
        {
          changeKind: "manual",
          note: `rollback:${historyEntry.id}`,
          forceHistoryEntry: true,
        }
      );

      if (nextDocument === document) {
        return;
      }

      applyDocumentChange(nextDocument, t("app.history.island.summary_version_restored"));
    },
    [applyDocumentChange, document]
  );

  const handleIslandSummaryReviewedChange = useCallback(
    (islandId: string, reviewed: boolean) => {
      if (!document) {
        return;
      }

      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        if ((island.summaryReviewed ?? false) === reviewed) {
          return island;
        }

        return {
          ...island,
          summaryReviewed: reviewed,
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t(reviewed ? "app.history.island.summary_marked_reviewed" : "app.history.island.summary_marked_unreviewed")
      );
      setReviewEvents((previous) => appendReviewEvent(previous, {
        target: { kind: "summary", id: islandId },
        reviewed,
        reviewerRef: currentReviewerRef,
        contextLabel: "island.summary",
      }));
    },
    [applyDocumentChange, currentReviewerRef, document, setReviewEvents]
  );

  const handleIslandImageReviewedChange = useCallback(
    (islandId: string, reviewed: boolean) => {
      if (!document) {
        return;
      }

      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        if ((island.imageReviewed ?? false) === reviewed) {
          return island;
        }

        return {
          ...island,
          imageReviewed: reviewed,
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t(reviewed ? "app.history.island.image_marked_reviewed" : "app.history.island.image_marked_unreviewed")
      );
      setReviewEvents((previous) => appendReviewEvent(previous, {
        target: { kind: "island", id: islandId },
        reviewed,
        reviewerRef: currentReviewerRef,
        contextLabel: "island.image",
      }));
    },
    [applyDocumentChange, currentReviewerRef, document, setReviewEvents]
  );

  const handleGenerateIslandPolygon = useCallback(
    (islandId: string) => {
      if (!document) {
        return;
      }

      const targetIsland = document.islands.find((island) => island.id === islandId);
      if (!targetIsland) {
        return;
      }

      const polygonPoints = buildIslandPolygonFromCards(document, targetIsland);
      const generatedFrom = {
        cardIds: [...targetIsland.cardIds],
        versionToken: buildVersionTokenForCardIds(document.cards, targetIsland.cardIds, CARD_WIDTH, CARD_HEIGHT),
      };
      const nextShape =
        polygonPoints.length < 3
          ? {
              kind: "rect" as const,
              generatedFrom,
            }
          : {
              kind: "polygon" as const,
              points: polygonPoints,
              generatedFrom,
            };

      const currentShape = targetIsland.shape;
      const generatedFromUnchanged =
        (currentShape?.generatedFrom?.versionToken ?? null) === generatedFrom.versionToken &&
        ((currentShape?.generatedFrom?.cardIds?.length ?? 0) === generatedFrom.cardIds.length &&
          generatedFrom.cardIds.every((cardId, index) => currentShape?.generatedFrom?.cardIds?.[index] === cardId));
      const shapeUnchanged =
        currentShape?.kind === nextShape.kind &&
        (nextShape.kind === "rect" ||
          ((currentShape?.kind === "polygon" ? currentShape.points.length : 0) === nextShape.points.length &&
            nextShape.points.every((point, index) => {
              const currentPoint = currentShape?.kind === "polygon" ? currentShape.points[index] : undefined;
              return currentPoint ? currentPoint.x === point.x && currentPoint.y === point.y : false;
            }))) &&
        generatedFromUnchanged;

      if (shapeUnchanged) {
        setStatusMessage(
          t(nextShape.kind === "rect"
            ? "app.status.polygon.fallback_rect"
            : "app.status.polygon.already_current")
        );
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: document.islands.map((island) =>
            island.id === islandId
              ? {
                  ...island,
                  shape: nextShape,
                }
              : island
          ),
        },
        t(nextShape.kind === "rect" ? "app.status.polygon.fallback_rect" : "app.status.polygon.generated")
      );

      setStatusMessage(
        t(nextShape.kind === "rect" ? "app.status.polygon.fallback_rect" : "app.status.polygon.generated")
      );
    },
    [applyDocumentChange, document]
  );

  // UX-SCALE-01 (c) (ADR-0048 D2, Round 5 redline): human-triggered only
  // (never run automatically), repositions every member card into a dense
  // grid and regenerates the outline from the new positions — both as ONE
  // document change, so a single Ctrl+Z reverses the whole tidy.
  const handleTidyIsland = useCallback(
    (islandId: string) => {
      if (!document) {
        return;
      }

      const targetIsland = document.islands.find((island) => island.id === islandId);
      if (!targetIsland) {
        return;
      }

      const memberCards = document.cards.filter((card) => targetIsland.cardIds.includes(card.id));
      if (memberCards.length === 0) {
        return;
      }

      const tidyPositionById = new Map(computeTidyIslandLayout(memberCards).map((position) => [position.id, position]));
      const nextCards = document.cards.map((card) => {
        const tidyPosition = tidyPositionById.get(card.id);
        if (!tidyPosition || (card.x === tidyPosition.x && card.y === tidyPosition.y)) {
          return card;
        }
        return { ...card, x: tidyPosition.x, y: tidyPosition.y };
      });

      const hasChanges = nextCards.some((card, index) => card !== document.cards[index]);
      if (!hasChanges) {
        setStatusMessage(t("app.status.island_tidy.already_dense"));
        return;
      }

      const tidiedMemberCards = nextCards.filter((card) => targetIsland.cardIds.includes(card.id));
      const polygonPoints = generateOrthogonalIslandOutline(tidiedMemberCards)?.points ?? [];
      const nextShape =
        polygonPoints.length < 3
          ? { kind: "rect" as const }
          : {
              kind: "polygon" as const,
              points: polygonPoints,
              generatedFrom: {
                cardIds: [...targetIsland.cardIds],
                versionToken: buildVersionTokenForCardIds(nextCards, targetIsland.cardIds, CARD_WIDTH, CARD_HEIGHT),
              },
            };

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
          islands: document.islands.map((island) => (island.id === islandId ? { ...island, shape: nextShape } : island)),
        },
        t("app.status.island_tidy.applied")
      );
    },
    [applyDocumentChange, document]
  );

  const handleIslandShapeKindChange = useCallback(
    (islandId: string, kind: "rect" | "polygon") => {
      if (!document) {
        return;
      }

      const targetIsland = document.islands.find((island) => island.id === islandId);
      if (!targetIsland) {
        return;
      }

      const currentKind = targetIsland.shape?.kind ?? (targetIsland.geometry?.type === "polygon" ? "polygon" : "rect");
      if (currentKind === kind) {
        return;
      }

      if (kind === "polygon") {
        handleGenerateIslandPolygon(islandId);
        return;
      }

      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId) {
          return island;
        }

        return {
          ...island,
          shape: {
            kind: "rect" as const,
            generatedFrom: island.shape?.generatedFrom,
          },
          geometry: { type: "rect" as const },
        };
      });

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t("app.status.polygon.switched_to_rect")
      );
      setStatusMessage(t("app.status.polygon.switched_to_rect"));
    },
    [applyDocumentChange, document, handleGenerateIslandPolygon]
  );

  const handlePolygonVertexDragStart = useCallback((_islandId: string, _vertexIndex: number) => {
    setStatusMessage(t("app.status.polygon.drag_started"));
  }, []);

  const handlePolygonVertexDragMove = useCallback(
    (islandId: string, vertexIndex: number, point: Point) => {
      if (!document) {
        return;
      }

      const island = document.islands.find((candidate) => candidate.id === islandId);
      if (!island || island.shape?.kind !== "polygon") {
        return;
      }

      const nextPolygon = movePolygonVertex(island.shape.points, vertexIndex, point);
      if (!nextPolygon.ok && nextPolygon.error === "self_intersection") {
        setStatusMessage(t("app.status.polygon.self_intersection"));
      }
    },
    [document]
  );

  const handlePolygonVertexDragCommit = useCallback(
    (islandId: string, vertexIndex: number, point: Point) => {
      if (!document) {
        return;
      }

      let statusMessage: string | null = null;
      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId || island.shape?.kind !== "polygon") {
          return island;
        }

        const nextPolygon = movePolygonVertex(island.shape.points, vertexIndex, point);
        if (!nextPolygon.ok) {
          if (nextPolygon.error === "self_intersection") {
            statusMessage = t("app.status.polygon.self_intersection");
          }
          return island;
        }

        const currentPoint = island.shape.points[vertexIndex];
        const nextPoint = nextPolygon.points[vertexIndex];
        if (currentPoint && currentPoint.x === nextPoint.x && currentPoint.y === nextPoint.y) {
          return island;
        }

        return {
          ...island,
          shape: {
            ...island.shape,
            points: nextPolygon.points,
          },
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        if (statusMessage) {
          setStatusMessage(statusMessage);
        }
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t("app.status.polygon.vertex_moved")
      );
    },
    [applyDocumentChange, document]
  );

  const handlePolygonVertexDragCancel = useCallback((_islandId: string, _vertexIndex: number) => {
    setStatusMessage(t("app.status.polygon.drag_cancelled"));
  }, []);

  const handlePolygonVertexAdd = useCallback(
    (islandId: string, segmentStartIndex: number, point: Point) => {
      if (!document) {
        return;
      }

      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId || island.shape?.kind !== "polygon") {
          return island;
        }

        const nextPolygon = addPolygonVertex(island.shape.points, segmentStartIndex, point);
        if (!nextPolygon.ok) {
          if (nextPolygon.error === "self_intersection") {
            setStatusMessage(t("app.status.polygon.self_intersection"));
          }
          return island;
        }

        return {
          ...island,
          shape: {
            ...island.shape,
            points: nextPolygon.points,
          },
        };
      });

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t("app.status.polygon.vertex_added")
      );
    },
    [applyDocumentChange, document]
  );

  const handlePolygonVertexRemove = useCallback(
    (islandId: string, vertexIndex: number) => {
      if (!document) {
        return;
      }

      let statusMessage: string | null = null;
      const nextIslands = document.islands.map((island) => {
        if (island.id !== islandId || island.shape?.kind !== "polygon") {
          return island;
        }

        const nextPolygon = removePolygonVertex(island.shape.points, vertexIndex);
        if (!nextPolygon.ok) {
          if (nextPolygon.error === "min_vertex_count") {
            statusMessage = t("app.status.polygon.minimum_vertices");
          } else if (nextPolygon.error === "self_intersection") {
            statusMessage = t("app.status.polygon.self_intersection");
          }
          return island;
        }

        return {
          ...island,
          shape: {
            ...island.shape,
            points: nextPolygon.points,
          },
        };
      });

      if (statusMessage) {
        setStatusMessage(statusMessage);
        return;
      }

      const hasChanges = nextIslands.some((island, index) => island !== document.islands[index]);
      if (!hasChanges) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          islands: nextIslands,
        },
        t("app.status.polygon.vertex_removed")
      );
    },
    [applyDocumentChange, document]
  );

  const handleIslandCollapsedChange = useCallback(
    (islandId: string, collapsed: boolean) => {
      if (!document) {
        return;
      }

      const nextCollapsedIslandIds = new Set(collapsedIslandIds);
      if (collapsed) {
        nextCollapsedIslandIds.add(islandId);
      } else {
        nextCollapsedIslandIds.delete(islandId);
      }

      const visibilityContract = buildIslandVisibilityContractPayload(document, nextCollapsedIslandIds, islandId);
      if (!visibilityContract.ok) {
        setStatusMessage(t("app.status.edit.island_collapse_failed", { detail: visibilityContract.error }));
        return;
      }

      const alreadyCollapsed = collapsedIslandIds.has(islandId);
      setCollapsedIslandIds(nextCollapsedIslandIds);

      const { changed, nextDocument, rejectedReason } = setIslandCollapsed(document, islandId, collapsed);
      if (!changed) {
        if (rejectedReason === "island-not-found") {
          setStatusMessage(t("app.status.edit.island_not_found"));
          return;
        }

        if (alreadyCollapsed !== collapsed) {
          setStatusMessage(t(collapsed ? "app.status.edit.collapsed_island" : "app.status.edit.expanded_island"));
        }
        return;
      }

      applyDocumentChange(nextDocument, t(collapsed ? "app.status.edit.collapsed_island" : "app.status.edit.expanded_island"));
    },
    [applyDocumentChange, collapsedIslandIds, document]
  );

  const handleCollapseAllIslands = useCallback(() => {
    if (!document) {
      return;
    }

    const islandIds = document.islands.map((island) => island.id);
    setCollapsedIslandIds(new Set(islandIds));

    const { changed, nextDocument } = setAllIslandsCollapsed(document, true);
    if (!changed) {
      setStatusMessage(t("app.status.edit.collapsed_all_islands"));
      return;
    }

    applyDocumentChange(nextDocument, t("app.status.edit.collapsed_all_islands"));
  }, [applyDocumentChange, document]);

  const handleExpandAllIslands = useCallback(() => {
    if (!document) {
      return;
    }

    setCollapsedIslandIds(new Set());

    const { changed, nextDocument } = setAllIslandsCollapsed(document, false);
    if (!changed) {
      setStatusMessage(t("app.status.edit.expanded_all_islands"));
      return;
    }

    applyDocumentChange(nextDocument, t("app.status.edit.expanded_all_islands"));
  }, [applyDocumentChange, document]);

  useEffect(() => {
    if (!document) {
      collapsedStateDocIdRef.current = null;
      importedCollapsedStateRef.current = null;
      setCollapsedIslandIds(new Set());
      return;
    }

    const isDocumentChanged = collapsedStateDocIdRef.current !== document.id;
    collapsedStateDocIdRef.current = document.id;

    setCollapsedIslandIds((previous) => {
      const validIslandIds = new Set(document.islands.map((island) => island.id));

      if (isDocumentChanged) {
        const imported = importedCollapsedStateRef.current;
        if (imported?.docId === document.id) {
          importedCollapsedStateRef.current = null;
          const seededImported = new Set<string>();
          for (const islandId of imported.islandIds) {
            if (validIslandIds.has(islandId)) {
              seededImported.add(islandId);
            }
          }

          return seededImported;
        }

        const fallbackCollapsedIds = collectInitiallyCollapsedIslandIds(document.islands);
        const seeded = new Set<string>();
        for (const islandId of fallbackCollapsedIds) {
          if (validIslandIds.has(islandId)) {
            seeded.add(islandId);
          }
        }

        return seeded;
      }

      const next = new Set<string>();
      for (const islandId of previous) {
        if (validIslandIds.has(islandId)) {
          next.add(islandId);
        }
      }

      return areIdSetsEqual(previous, next) ? previous : next;
    });
  }, [document]);

  useEffect(() => {
    if (!peekIslandId || !focusedVisibleDocument) {
      return;
    }

    const hasPeekTarget = focusedVisibleDocument.islands.some((island) => island.id === peekIslandId);
    if (!hasPeekTarget) {
      setPeekIslandId(undefined);
    }
  }, [focusedVisibleDocument, peekIslandId]);

  useEffect(() => {
    if (!peekIslandId) {
      return;
    }

    const clearPeek = () => {
      setPeekIslandId(undefined);
    };

    window.addEventListener("mouseup", clearPeek);
    return () => {
      window.removeEventListener("mouseup", clearPeek);
    };
  }, [peekIslandId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const usesShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "g";
      if (!usesShortcut || !canCreateIsland || isEditableHotkeyTarget(event.target)) {
        return;
      }

      event.preventDefault();
      handleCreateIsland();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canCreateIsland, handleCreateIsland]);

  const handleUndo = useCallback(() => {
    // Belt-and-suspenders: the Undo button and menu item are already disabled
    // via isReadOnly, and history.past should be empty in a readOnly session
    // since every mutation path is gated upstream. This checks isReadOnly
    // here too so a future caller (e.g. a new keyboard shortcut or command)
    // can't reach this mutation without independently re-deriving that gate,
    // matching the pattern applyDocumentChange already uses for every other
    // document mutation.
    if (isReadOnly) {
      return;
    }
    pendingCardDragSnapshotRef.current = null;

    setHistory((previousHistory) => {
      if (!previousHistory || previousHistory.past.length === 0) {
        return previousHistory;
      }

      const previousDocument = previousHistory.past[previousHistory.past.length - 1];
      return {
        past: previousHistory.past.slice(0, -1),
        present: cloneDocument(previousDocument),
        future: [cloneDocument(previousHistory.present), ...previousHistory.future],
      };
    });
    setIsDirty(true);
    setStatusMessage(t("app.status.edit.undo"));
  }, [abstractMapView, isReadOnly, summaryView]);

  const handleRedo = useCallback(() => {
    // See handleUndo above: same belt-and-suspenders isReadOnly check.
    if (isReadOnly) {
      return;
    }
    pendingCardDragSnapshotRef.current = null;

    setHistory((previousHistory) => {
      if (!previousHistory || previousHistory.future.length === 0) {
        return previousHistory;
      }

      const [nextDocument, ...remainingFuture] = previousHistory.future;
      const nextPast = [...previousHistory.past, cloneDocument(previousHistory.present)];
      const trimmedPast =
        nextPast.length > HISTORY_LIMIT ? nextPast.slice(nextPast.length - HISTORY_LIMIT) : nextPast;

      return {
        past: trimmedPast,
        present: cloneDocument(nextDocument),
        future: remainingFuture,
      };
    });
    setIsDirty(true);
    setStatusMessage(t("app.status.edit.redo"));
  }, [abstractMapView, isReadOnly, summaryView]);

  const discardLatestDocumentChange = useCallback((): boolean => {
    if (!canUndo) return false;
    pendingCardDragSnapshotRef.current = null;
    setHistory((previousHistory) => {
      if (!previousHistory || previousHistory.past.length === 0) return previousHistory;
      const previousDocument = previousHistory.past[previousHistory.past.length - 1];
      return {
        past: previousHistory.past.slice(0, -1),
        present: cloneDocument(previousDocument),
        future: [],
      };
    });
    setIsDirty(true);
    return true;
  }, [canUndo]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      if (!isModifierPressed || isEditableHotkeyTarget(event.target)) {
        return;
      }

      const lowerKey = event.key.toLowerCase();

      const wantsUndo = lowerKey === "z" && !event.shiftKey;
      if (wantsUndo && canUndo) {
        event.preventDefault();
        handleUndo();
        return;
      }

      const wantsRedo = lowerKey === "y" || (lowerKey === "z" && event.shiftKey);
      if (wantsRedo && canRedo) {
        event.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [canRedo, canUndo, handleRedo, handleUndo]);

  useEffect(() => {
    // UX-CMDK-01 (ADR-0048 D2): Cmd/Ctrl+K opens the command palette; pressing
    // it again while open closes it (same as Escape). AC-3: while editing text
    // elsewhere in the app, defer to the OS/browser default instead of opening.
    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifierPressed = event.metaKey || event.ctrlKey;
      if (!isModifierPressed || event.key.toLowerCase() !== "k") {
        return;
      }

      if (isCommandPaletteOpen) {
        event.preventDefault();
        closeCommandPalette();
        return;
      }

      if (isStartPanelVisible || isEditableHotkeyTarget(event.target)) {
        return;
      }

      event.preventDefault();
      commandPaletteReturnFocusRef.current =
        window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
      setIsCommandPaletteOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeCommandPalette, isCommandPaletteOpen, isStartPanelVisible]);

  useEffect(() => {
    // UX-SHORTCUT-01 AC-4 (ADR-0048 D2): "?" opens the shortcut cheatsheet;
    // pressing it again while open closes it (same as Escape). Deferred to
    // OS/browser default while editing text (AC-2's guard, reused).
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key !== "?") {
        return;
      }

      if (isShortcutCheatsheetOpen) {
        event.preventDefault();
        closeShortcutCheatsheet();
        return;
      }

      if (isStartPanelVisible || isEditableHotkeyTarget(event.target)) {
        return;
      }

      event.preventDefault();
      shortcutCheatsheetReturnFocusRef.current =
        window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
      setIsShortcutCheatsheetOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeShortcutCheatsheet, isShortcutCheatsheetOpen, isStartPanelVisible]);

  const uniqueIslands = useMemo(() => {
    const normalizedIslands = (focusedVisibleDocument?.islands ?? []).map((island) => ({
      ...island,
      collapsed: island.collapsed === true,
      cardIds: Array.from(new Set(island.cardIds)),
    }));
    const islandsById = new Map(normalizedIslands.map((island) => [island.id, island]));

    return normalizedIslands
      .map((island, index) => ({
        island,
        index,
        depth: getIslandDepth(island, islandsById),
      }))
      .sort((left, right) => {
        if (left.depth !== right.depth) {
          return left.depth - right.depth;
        }

        return left.index - right.index;
      })
      .map((entry) => entry.island);
  }, [focusedVisibleDocument?.islands]);

  const maxAvailableDepth = useMemo(() => {
    if (islandDepthById.size === 0) {
      return 0;
    }

    return Math.max(...islandDepthById.values());
  }, [islandDepthById]);

  useEffect(() => {
    // QA-MONKEY-13: clamping logic lives in clampMaxDepthToAvailable() so it
    // has a direct unit-test regression guard -- see hierarchy_level.test.ts
    // for why maxAvailableDepth === 0 must never clamp an explicit "mid"
    // choice down to "overview" via the sync effect below.
    const clamped = clampMaxDepthToAvailable(maxDepth, maxAvailableDepth);
    if (clamped !== maxDepth) {
      setMaxDepth(clamped);
    }
  }, [maxAvailableDepth, maxDepth]);

  useEffect(() => {
    setHierarchyLevel(resolveHierarchyLevel(maxDepth));
  }, [maxDepth]);

  const visibleIslands = useMemo(() => {
    return uniqueIslands.filter((island) => {
      if (depthHiddenIslandIdSet.has(island.id)) {
        return false;
      }

      return !island.parentIslandId || !effectiveCollapsedIslandIdSet.has(island.parentIslandId);
    });
  }, [depthHiddenIslandIdSet, effectiveCollapsedIslandIdSet, uniqueIslands]);

  const visibleIslandIdSet = useMemo(() => new Set(visibleIslands.map((island) => island.id)), [visibleIslands]);

  useEffect(() => {
    if (uniqueIslands.length === 0) {
      setSelectedIslandId(null);
      return;
    }

    if (selectedIslandId && !uniqueIslands.some((island) => island.id === selectedIslandId)) {
      setSelectedIslandId(null);
    }
  }, [selectedIslandId, uniqueIslands]);

  useEffect(() => {
    if (!selectedIslandId) {
      return;
    }

    if (!visibleIslandIdSet.has(selectedIslandId)) {
      setSelectedIslandId(null);
    }
  }, [selectedIslandId, visibleIslandIdSet]);

  useEffect(() => {
    if (!focusTarget.focusIslandId) {
      return;
    }

    if (!visibleIslandIdSet.has(focusTarget.focusIslandId)) {
      setFocusTarget({});
      setFocusWorldPoint(null);
    }
  }, [focusTarget.focusIslandId, visibleIslandIdSet]);

  useEffect(() => {
    setFocusTarget({});
    setFocusWorldPoint(null);
  }, [document?.id]);

  useEffect(() => {
    setRevealedSourceCardIds(new Set());
  }, [document?.id]);

  useEffect(() => {
    if (!summaryView) {
      setSummaryRevealIslandIds(new Set());
      return;
    }

    if (!focusedVisibleDocument) {
      return;
    }

    const visibleIslands = new Set(focusedVisibleDocument.islands.map((island) => island.id));
    setSummaryRevealIslandIds((previousIds) => {
      const nextIds = new Set(Array.from(previousIds).filter((islandId) => visibleIslands.has(islandId)));
      const isUnchanged =
        nextIds.size === previousIds.size &&
        Array.from(nextIds).every((islandId) => previousIds.has(islandId));
      if (isUnchanged) {
        return previousIds;
      }
      return nextIds;
    });
  }, [abstractMapView, focusedVisibleDocument, summaryView]);

  const selectedIsland = useMemo(() => {
    if (!document || !selectedIslandId) {
      return null;
    }

    return document.islands.find((island) => island.id === selectedIslandId) ?? null;
  }, [document, selectedIslandId]);

  useEffect(() => {
    if (selectedIsland?.shape?.kind === "polygon") {
      return;
    }

    setIsPolygonVertexEditEnabled(false);
  }, [selectedIsland]);

  const stalePolygonIslandIdSet = useMemo(() => {
    if (!document) {
      return new Set<string>();
    }

    return new Set(
      document.islands
        .filter((island) => isPolygonShapeStale(island, document.cards, CARD_WIDTH, CARD_HEIGHT))
        .map((island) => island.id)
    );
  }, [document]);

  const selectedCard = useMemo(() => {
    if (!document || selectedCardIds.length !== 1) {
      return null;
    }

    return document.cards.find((card) => card.id === selectedCardIds[0]) ?? null;
  }, [document?.cards, selectedCardIds]);

  const handleOpenCardQualityAssist = useCallback(() => {
    if (!selectedCard) {
      return;
    }

    setCardQualityAssistByCardId((previous) => ({
      ...previous,
      [selectedCard.id]: openCardQualityAssist(selectedCard, previous[selectedCard.id]),
    }));
    setOpenCardQualityAssistCardId(selectedCard.id);
  }, [selectedCard]);

  const handleAnswerCardQualityQuestion = useCallback(
    (decision: CardQualityDecision) => {
      if (!openCardQualityAssistCardId) {
        return;
      }

      setCardQualityAssistByCardId((previous) => {
        const current = previous[openCardQualityAssistCardId];
        if (!current) {
          return previous;
        }

        const nextState = decision === "apply" && selectedCard?.id === openCardQualityAssistCardId
          ? beginCardQualityRewrite(current, selectedCard.text)
          : current;

        return {
          ...previous,
          [openCardQualityAssistCardId]: answerCardQualityQuestion(nextState, decision),
        };
      });
    },
    [openCardQualityAssistCardId, selectedCard]
  );

  const handleCloseCardQualityAssist = useCallback(() => {
    setOpenCardQualityAssistCardId(null);
  }, []);

  const handleOpenCardTextEditor = useCallback(() => {
    if (!selectedCard) {
      return;
    }

    setEditingCardId(selectedCard.id);
  }, [selectedCard]);

  const handleRestoreCardQualityText = useCallback(() => {
    if (!selectedCard) {
      return;
    }

    const assistState = cardQualityAssistByCardId[selectedCard.id];
    const originalText = assistState ? cardQualityRestoreTarget(assistState) : undefined;
    if (originalText === undefined) {
      return;
    }

    handleCommitCardText(selectedCard.id, originalText);
  }, [cardQualityAssistByCardId, handleCommitCardText, selectedCard]);

  useEffect(() => {
    // UX-SHORTCUT-01 (ADR-0048 D2): retention-system shortcuts (H=hold,
    // U=critique, R=reviewed) are modifier-less single keys so the core
    // "preserve ambiguity" operations sit closer than confirming ones (CB-2).
    // Reuses the existing isEditableHotkeyTarget guard (shared with Cmd+1/2/3
    // and Cmd/Ctrl+K) so typing is never interrupted. Only the "r" branch is
    // additionally gated on !readingNavEnabled, to avoid colliding with
    // useHotkeys.ts's own plain "r" (reading-order reviewedOnly filter) —
    // the two "r" bindings are never active at once. H/U have no such
    // collision and must stay reachable while reading-nav mode is on.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (isEditableHotkeyTarget(event.target)) {
        return;
      }

      if (!selectedCard) {
        return;
      }

      const lowerKey = event.key.toLowerCase();

      if (lowerKey === "h") {
        event.preventDefault();
        handleCardHoldStateChange(selectedCard.id, selectedCard.holdState === "held" ? "active" : "held");
        return;
      }

      if (lowerKey === "u") {
        event.preventDefault();
        // Safe toggle: only ever creates/removes the quick-flag marker this
        // key itself wrote. If the user has authored their own critique text,
        // U is a no-op rather than risking destroying their words (one-枚一志).
        const marker = t("card_view.critique_quick_flag");
        const current = selectedCard.critique?.trim() ?? "";
        const next = current.length === 0 ? marker : current === marker ? "" : current;
        handleCardCritiqueChange(selectedCard.id, next);
        return;
      }

      if (lowerKey === "r" && !readingNavEnabled) {
        event.preventDefault();
        handleCardTextReviewedChange(selectedCard.id, selectedCard.textReviewed !== true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleCardCritiqueChange, handleCardHoldStateChange, handleCardTextReviewedChange, readingNavEnabled, selectedCard]);

  const evidenceAdjacency = useMemo(() => {
    if (!focusedVisibleDocument) {
      return buildEvidenceAdjacency({ evidenceLinks: [] });
    }

    return buildEvidenceAdjacency(focusedVisibleDocument);
  }, [focusedVisibleDocument]);

  const effectiveEvidenceOverlayEnabled = perspectiveRendering?.overlay.evidenceEnabled ? true : evidenceOverlayEnabled;
  const effectiveEvidenceOverlayMode = perspectiveRendering?.overlay.mode ?? evidenceOverlayMode;
  const effectiveEvidenceOverlayScope = perspectiveRendering?.overlay.scope ?? evidenceOverlayScope;

  const evidenceOverlayEdgesFilteredByMode = useMemo(() => {
    if (!focusedVisibleDocument) {
      return [];
    }

    return [...(focusedVisibleDocument.evidenceLinks ?? [])]
      .filter((link) => effectiveEvidenceOverlayMode === "both" || link.type === effectiveEvidenceOverlayMode)
      .sort((left, right) => left.id.localeCompare(right.id));
  }, [effectiveEvidenceOverlayMode, focusedVisibleDocument]);

  const evidenceNeighborhood = useMemo(() => {
    if (!selectedCard) {
      return null;
    }

    return getEvidenceNeighborhood(selectedCard.id, evidenceAdjacency, effectiveEvidenceOverlayMode, evidenceOverlayDepth);
  }, [selectedCard, evidenceAdjacency, effectiveEvidenceOverlayMode, evidenceOverlayDepth]);

  const evidenceOverlayEdgeIds = useMemo(() => {
    if (effectiveEvidenceOverlayScope === "all") {
      return new Set(evidenceOverlayEdgesFilteredByMode.map((edge) => edge.id));
    }

    if (!evidenceNeighborhood) {
      return new Set<string>();
    }

    return evidenceNeighborhood.edges;
  }, [effectiveEvidenceOverlayScope, evidenceNeighborhood, evidenceOverlayEdgesFilteredByMode]);

  const evidenceOverlayEdges = useMemo(() => {
    if (!effectiveEvidenceOverlayEnabled) {
      return [];
    }

    return evidenceOverlayEdgesFilteredByMode.filter((edge) => evidenceOverlayEdgeIds.has(edge.id));
  }, [effectiveEvidenceOverlayEnabled, evidenceOverlayEdgeIds, evidenceOverlayEdgesFilteredByMode]);

  const evidenceOverlayDimCardIds = useMemo(() => {
    if (!effectiveEvidenceOverlayEnabled || !evidenceOverlayDimOthers || !focusedVisibleDocument) {
      return new Set<string>();
    }

    if (effectiveEvidenceOverlayScope === "selection" && !evidenceNeighborhood) {
      return new Set<string>();
    }

    const participatingIds = new Set<string>();
    if (effectiveEvidenceOverlayScope === "selection" && evidenceNeighborhood) {
      for (const cardId of evidenceNeighborhood.nodes) {
        participatingIds.add(cardId);
      }
    } else {
      for (const edge of evidenceOverlayEdges) {
        participatingIds.add(edge.fromCardId);
        participatingIds.add(edge.toCardId);
      }
    }

    return new Set(
      focusedVisibleDocument.cards
        .map((card) => card.id)
        .filter((cardId) => !participatingIds.has(cardId))
        .sort((left, right) => left.localeCompare(right)),
    );
  }, [
    evidenceNeighborhood,
    evidenceOverlayDimOthers,
    evidenceOverlayEdges,
    effectiveEvidenceOverlayEnabled,
    effectiveEvidenceOverlayScope,
    focusedVisibleDocument,
  ]);

  const evidenceOverlayLodLevel = useMemo(() => {
    if (!lodEnabled) {
      return null;
    }

    return getLODLevel(canvasCamera?.zoom ?? 1, { lodThresholds, lodLevelOverride }).level;
  }, [canvasCamera?.zoom, lodEnabled, lodLevelOverride, lodThresholds]);

  const evidenceOverlayHint = useMemo(() => {
    if (!effectiveEvidenceOverlayEnabled) {
      return null;
    }

    if (evidenceOverlayLodLevel === "far") {
      return "Zoom in to view evidence overlay";
    }

    if (effectiveEvidenceOverlayScope === "selection" && !selectedCard) {
      return t("app.perspective_hint.select_card_for_evidence");
    }

    return null;
  }, [effectiveEvidenceOverlayEnabled, evidenceOverlayLodLevel, effectiveEvidenceOverlayScope, selectedCard]);

  const shouldRenderEvidenceOverlay = effectiveEvidenceOverlayEnabled && evidenceOverlayLodLevel !== "far";

  const perspectiveHint = useMemo(() => {
    if (!perspectiveRendering || perspectiveMode === "default") {
      return null;
    }

    if (evidenceOverlayLodLevel === "far") {
      return t("app.perspective_hint.zoom_in");
    }

    if (perspectiveRendering.notes.length === 0) {
      return null;
    }

    if (perspectiveMode === "review") {
      return t("app.perspective_hint.review");
    }

    if (
      (perspectiveMode === "evidence" || perspectiveMode === "contradiction")
      && perspectiveRendering.notes[0] === "Select a card to explore neighborhood."
    ) {
      return t("app.perspective_hint.select_card_for_neighborhood");
    }

    return perspectiveRendering.notes[0];
  }, [evidenceOverlayLodLevel, perspectiveMode, perspectiveRendering]);

  // F-8: don't gate on selectedCard.canonicalId. A card that was itself merged into
  // another card (canonicalId set) can still be a representative of its OWN sources from
  // an earlier merge (chained canonicalization) — resolveRepresentativeOriginTrace already
  // returns an empty trace for genuine leaf source cards, so it alone is the correct signal.
  const representativeOriginTraceForSelectedCard = useMemo(() => {
    if (!document || !selectedCard) {
      return {
        representativeCardId: selectedCard?.id ?? "",
        sourceCardIds: [] as string[],
        missingSourceCardIds: [] as string[],
      };
    }

    return resolveRepresentativeOriginTrace(document, selectedCard.id);
  }, [document, selectedCard]);

  const sourceCardsForSelectedCanonical = useMemo(() => {
    if (!document || !selectedCard) {
      return [] as DocumentV1["cards"];
    }

    const cardsById = new Map(document.cards.map((card) => [card.id, card]));
    return representativeOriginTraceForSelectedCard.sourceCardIds
      .map((sourceId) => cardsById.get(sourceId))
      .filter((card): card is DocumentV1["cards"][number] => card !== undefined);
  }, [document, representativeOriginTraceForSelectedCard.sourceCardIds, selectedCard]);

  const missingSourceCardIdsForSelectedCanonical = representativeOriginTraceForSelectedCard.missingSourceCardIds;

  const summaryGroundingItems = useMemo<Array<{ id: string; text: string; kind: "canonical" | "source" }>>(() => {
    if (!selectedIsland || !selectedIsland.summaryGrounding || selectedIsland.summaryGrounding.length === 0) {
      return [] as Array<{ id: string; text: string; kind: "canonical" | "source" }>;
    }

    return selectedIsland.summaryGrounding
      .map((groundingCardId) => cardsById.get(groundingCardId))
      .filter((card): card is DocumentV1["cards"][number] => card !== undefined)
      .map((card) => ({
        id: card.id,
        text: card.text,
        kind: isSourceCard(card) ? "source" : "canonical",
      }));
  }, [cardsById, selectedIsland]);

  const handleSourceCardInspect = useCallback((sourceCardId: string) => {
    requestCanvasFocus(sourceCardId);
    setRevealedSourceCardIds((previousIds) => {
      if (previousIds.has(sourceCardId)) {
        return previousIds;
      }

      const nextIds = new Set(previousIds);
      nextIds.add(sourceCardId);
      return nextIds;
    });
  }, [requestCanvasFocus]);

  useEffect(() => {
    setTemporaryRevealCardIds(new Set());
  }, [document?.id]);

  useEffect(() => {
    if (!groundingVisibilityMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setGroundingVisibilityMessage(null);
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [groundingVisibilityMessage]);

  const revealCardsTemporarily = useCallback((cardIds: string[]) => {
    if (cardIds.length === 0) {
      return;
    }

    setTemporaryRevealCardIds((previousIds) => {
      const nextIds = new Set(previousIds);
      for (const cardId of cardIds) {
        nextIds.add(cardId);
      }
      if (nextIds.size === previousIds.size) {
        return previousIds;
      }
      return nextIds;
    });
  }, [abstractMapView, summaryView]);

  const clearTemporaryReveal = useCallback(() => {
    setTemporaryRevealCardIds((previousIds) => (previousIds.size === 0 ? previousIds : new Set()));
  }, [abstractMapView, summaryView]);

  const handleSummaryGroundingCardInspect = useCallback((cardId: string) => {
    if (!document) {
      return;
    }

    const hasTargetCard = document.cards.some((card) => card.id === cardId);
    if (!hasTargetCard) {
      setStatusMessage(t("app.status.focus.item_not_found", {
        kind: getEntityKindDisplayLabel("card"),
        id: cardId,
      }));
      return;
    }

    const isInFocusScope = focusedVisibleDocument?.cards.some((card) => card.id === cardId) ?? false;
    const isWithinDepth = maxDepth === "all" || (cardMinDepthById.get(cardId) ?? 0) <= maxDepth;
    if (!isTemporaryRevealEligible({ isInFocusScope, isWithinDepth })) {
      setGroundingVisibilityMessage(t("app.status.focus.grounding_card_hidden"));
      return;
    }

    requestCanvasFocus(cardId);
    revealCardsTemporarily([cardId]);
  }, [cardMinDepthById, document, focusedVisibleDocument?.cards, maxDepth, requestCanvasFocus, revealCardsTemporarily]);

  const handleShowAllSummaryGrounding = useCallback(() => {
    if (!selectedIsland?.summaryGrounding || selectedIsland.summaryGrounding.length === 0) {
      return;
    }

    revealCardsTemporarily(selectedIsland.summaryGrounding);
    const firstEligibleCardId = selectedIsland.summaryGrounding.find((cardId) => {
      const isInFocusScope = focusedVisibleDocument?.cards.some((card) => card.id === cardId) ?? false;
      const isWithinDepth = maxDepth === "all" || (cardMinDepthById.get(cardId) ?? 0) <= maxDepth;
      return isTemporaryRevealEligible({ isInFocusScope, isWithinDepth });
    });

    if (firstEligibleCardId) {
      requestCanvasFocus(firstEligibleCardId);
    }
  }, [cardMinDepthById, focusedVisibleDocument?.cards, maxDepth, requestCanvasFocus, revealCardsTemporarily, selectedIsland]);

  const handleRevealSelectedEdgeSources = useCallback(() => {
    if (!selectedAggregatedEdge) {
      return;
    }

    if (selectedAggregatedEdge.isDerivedIslandEdge) {
      revealCardsTemporarily(selectedAggregatedEdge.contributingCardIds ?? []);
      return;
    }

    const sourceCardIds = new Set<string>();
    for (const source of selectedAggregatedEdge.sources) {
      sourceCardIds.add(source.sourceFromCardId);
      if (source.sourceToKind === "card") {
        sourceCardIds.add(source.sourceToId);
      }
    }

    setRevealedSourceCardIds(sourceCardIds);
  }, [revealCardsTemporarily, selectedAggregatedEdge]);

  const handleInspectSelectedEdgeCard = useCallback((cardId: string) => {
    handleSummaryGroundingCardInspect(cardId);
  }, [handleSummaryGroundingCardInspect]);

  const handleGenerateRelationSummary = useCallback(async () => {
    if (!document || !selectedIslandRelationEdge || isGeneratingRelationSummary) {
      return;
    }

    setIsGeneratingRelationSummary(true);
    setStatusMessage(t("app.status.relation_summary.requesting"));

    try {
      const payload = buildSummarizeIslandRelationPayload(document, selectedIslandRelationEdge);
      const result = await runTenantScopedApiRequest(() => summarizeIslandRelation(
        payload,
        { tenantSessionContext: verifiedTenantSession },
      ));
      const sourceSignature = buildRelationSummarySourceSignature(selectedIslandRelationEdge);
      const nextDocument = upsertRelationSummaryWithHistory(document, {
        sourceSignature,
        islandAId: selectedIslandRelationEdge.fromIslandId,
        islandBId: selectedIslandRelationEdge.toIslandId,
        relationType: selectedIslandRelationEdge.type,
        derived: selectedIslandRelationEdge.isDerived,
        newText: result.text,
        newWarnings: result.warnings,
        newGroundingCardIds: result.groundingCardIds,
        newGroundingEdgeIds: result.groundingEdgeIds,
        changeKind: "ai",
      });

      applyDocumentChange(nextDocument, t("app.status.relation_summary.generated_unreviewed"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : t("app.status.error_detail_unknown");
      setStatusMessage(t("app.status.relation_summary.failed", { detail }));
    } finally {
      setIsGeneratingRelationSummary(false);
    }
  }, [
    applyDocumentChange,
    document,
    isGeneratingRelationSummary,
    runTenantScopedApiRequest,
    selectedIslandRelationEdge,
    verifiedTenantSession,
  ]);

  const handleRelationSummaryCommit = useCallback(
    (value: string) => {
      if (!document || !selectedRelationSummary) {
        return;
      }

      const nextDocument = upsertRelationSummaryWithHistory(document, {
        sourceSignature: selectedRelationSummary.sourceSignature,
        islandAId: selectedRelationSummary.islandAId,
        islandBId: selectedRelationSummary.islandBId,
        relationType: selectedRelationSummary.relationType,
        derived: selectedRelationSummary.derived,
        newText: value,
        newWarnings: selectedRelationSummary.warnings,
        newGroundingCardIds: selectedRelationSummary.groundingCardIds,
        newGroundingEdgeIds: selectedRelationSummary.groundingEdgeIds,
        changeKind: "manual",
      });
      if (nextDocument === document) {
        return;
      }

      applyDocumentChange(nextDocument, t("app.status.relation_summary.updated"));
    },
    [applyDocumentChange, document, selectedRelationSummary]
  );

  const handleRelationSummaryReviewedChange = useCallback(
    (reviewed: boolean) => {
      if (!document || !selectedRelationSummary) {
        return;
      }

      const nextDocument = upsertRelationSummaryWithHistory(document, {
        sourceSignature: selectedRelationSummary.sourceSignature,
        islandAId: selectedRelationSummary.islandAId,
        islandBId: selectedRelationSummary.islandBId,
        relationType: selectedRelationSummary.relationType,
        derived: selectedRelationSummary.derived,
        newText: selectedRelationSummary.text,
        newWarnings: selectedRelationSummary.warnings,
        newGroundingCardIds: selectedRelationSummary.groundingCardIds,
        newGroundingEdgeIds: selectedRelationSummary.groundingEdgeIds,
        changeKind: "manual",
        newReviewed: reviewed,
      });
      if (nextDocument === document) {
        return;
      }

      applyDocumentChange(
        nextDocument,
        t(reviewed ? "app.status.relation_summary.marked_reviewed" : "app.status.relation_summary.marked_unreviewed"),
      );
      setReviewEvents((previous) => appendReviewEvent(previous, {
        target: { kind: "summary", id: selectedRelationSummary.id },
        reviewed,
        reviewerRef: currentReviewerRef,
        contextLabel: "relation.summary",
      }));
    },
    [applyDocumentChange, currentReviewerRef, document, selectedRelationSummary, setReviewEvents]
  );

  const handleRestoreRelationSummaryHistoryEntry = useCallback(
    (historyEntryId: string) => {
      if (!document || !selectedRelationSummary) {
        return;
      }

      const entry = selectedRelationSummary.history?.find((item) => item.id === historyEntryId);
      if (!entry || !entry.toText || entry.toText.trim().length === 0) {
        setStatusMessage(t("app.status.relation_summary.restore_empty_blocked"));
        return;
      }

      const nextDocument = upsertRelationSummaryWithHistory(document, {
        sourceSignature: selectedRelationSummary.sourceSignature,
        islandAId: selectedRelationSummary.islandAId,
        islandBId: selectedRelationSummary.islandBId,
        relationType: selectedRelationSummary.relationType,
        derived: selectedRelationSummary.derived,
        newText: entry.toText,
        newWarnings: entry.warningsSnapshot ?? selectedRelationSummary.warnings,
        newGroundingCardIds: entry.groundingCardIdsSnapshot ?? selectedRelationSummary.groundingCardIds,
        newGroundingEdgeIds: entry.groundingEdgeIdsSnapshot ?? selectedRelationSummary.groundingEdgeIds,
        changeKind: "rollback",
        note: `restore:${entry.id}`,
        newReviewed: entry.toReviewed ?? selectedRelationSummary.reviewed,
      });
      if (nextDocument === document) {
        return;
      }

      applyDocumentChange(nextDocument, t("app.status.relation_summary.restored"));
    },
    [applyDocumentChange, document, selectedRelationSummary]
  );

  const handleRelationSummaryGroundingInspect = useCallback(
    (cardId: string) => {
      handleSummaryGroundingCardInspect(cardId);
    },
    [handleSummaryGroundingCardInspect]
  );

  /**
   * Manual test steps:
   * 1) Enable summary view and hide source cards, then click one grounding item.
   * 2) Confirm the card is focused/revealed without creating dirty state or undo entries.
   * 3) Apply focus/depth so the grounding card is out of scope and click again.
   * 4) Confirm the "hidden by Focus/Depth" message appears and view controls remain unchanged.
   * 5) Click "Show all grounding on canvas", then "Clear reveal", and verify reveal is session-only after reload.
   */

  const handleShowAllSourcesChange = useCallback((value: boolean) => {
    if (!value) {
      setRevealedSourceCardIds(new Set());
      return;
    }

    setRevealedSourceCardIds(new Set(sourceCardsForSelectedCanonical.map((card) => card.id)));
  }, [sourceCardsForSelectedCanonical]);

  useEffect(() => {
    if (!selectedCard || (sourceCardsForSelectedCanonical.length === 0 && missingSourceCardIdsForSelectedCanonical.length === 0)) {
      setRevealedSourceCardIds(new Set());
      return;
    }

    const allowedSourceIdSet = new Set(sourceCardsForSelectedCanonical.map((card) => card.id));
    setRevealedSourceCardIds((previousIds) => {
      const nextIds = new Set(Array.from(previousIds).filter((cardId) => allowedSourceIdSet.has(cardId)));
      if (nextIds.size === previousIds.size) {
        return previousIds;
      }
      return nextIds;
    });
  }, [missingSourceCardIdsForSelectedCanonical.length, selectedCard, sourceCardsForSelectedCanonical]);

  const handleIslandSelect = useCallback((islandId: string, isShiftPressed: boolean) => {
    if (isPickingEdgeTarget) {
      handleConnectToTarget({ id: islandId, kind: "island" });
      return;
    }

    if (isPreviewingSuggestion && !isAnnotateOverlayEnabled) {
      return;
    }

    if (document && isReadingOrderEditMode && isShiftPressed && visibleIslandIdSet.has(islandId)) {
      const nextReadingOrder = appendReadingOrderEntry(document.readingOrder ?? [], islandId, visibleIslandIdSet);
      if (nextReadingOrder !== (document.readingOrder ?? [])) {
        applyDocumentChange(
          {
            ...document,
            readingOrder: nextReadingOrder,
          },
          t("app.history.reading_order.island_added")
        );
        return;
      }
    }

    setSelectedIslandId(islandId);
    if (isPreviewingSuggestion && isAnnotateOverlayEnabled) {
      setSelectedCardIds([]);
    }
    setSelectedEdgeId(null);
  }, [
    applyDocumentChange,
    document,
    handleConnectToTarget,
    isAnnotateOverlayEnabled,
    isPickingEdgeTarget,
    isPreviewingSuggestion,
    isReadingOrderEditMode,
    visibleIslandIdSet,
  ]);

  useEffect(() => {
    if (selectedEdgeId && !visibleAggregatedEdges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [selectedEdgeId, visibleAggregatedEdges]);

  const focusIslandById = useCallback(
    (islandId: string) => {
      if (!document || !canvasCamera) {
        return;
      }

      const island = document.islands.find((item) => item.id === islandId);
      if (!island) {
        setStatusMessage(t("app.status.focus.item_not_found", {
          kind: getEntityKindDisplayLabel("island"),
          id: islandId,
        }));
        return;
      }

      const cardsById = new Map(document.cards.map((card) => [card.id, card]));
      const islandBounds = getIslandWorldBounds(island, cardsById);
      if (!islandBounds) {
        setStatusMessage(t("app.status.focus.item_bounds_unavailable", {
          kind: getEntityKindDisplayLabel("island"),
          id: islandId,
        }));
        return;
      }

      pushCurrentFocusSnapshot();

      const viewport = {
        width: canvasCamera.viewportWidth,
        height: canvasCamera.viewportHeight,
      };
      const fitCamera = fitToBounds(islandBounds, viewport, 48);
      const lodAdjustedCamera = applyIslandLodZoom(fitCamera, lodEnabled, lodThresholds, 4);
      const nextCamera =
        lodEnabled && lodAdjustedCamera.zoom > fitCamera.zoom
          ? enforceMinZoomForBounds(islandBounds, viewport, lodThresholds.close + FOCUS_LOD_EPSILON, 48, { min: 0.2, max: 4 })
          : fitCamera;

      setFocusCardId(null);
      setFocusWorldPoint(null);
      setFocusTarget({ focusIslandId: islandId });
      requestCameraTransform(nextCamera);
    },
    [canvasCamera, document, lodEnabled, lodThresholds, pushCurrentFocusSnapshot, requestCameraTransform]
  );

  const handleIslandPeekStart = useCallback((islandId: string) => {
    setPeekIslandId(islandId);
  }, []);

  const handleIslandPeekEnd = useCallback(() => {
    setPeekIslandId(undefined);
  }, []);

  const focusCardById = useCallback(
    (cardId: string) => {
      if (!document || !canvasCamera) {
        return;
      }

      const card = document.cards.find((item) => item.id === cardId);
      if (!card) {
        setStatusMessage(t("app.status.focus.item_not_found", {
          kind: getEntityKindDisplayLabel("card"),
          id: cardId,
        }));
        return;
      }

      pushCurrentFocusSnapshot();
      const cardBounds = getCardWorldBounds(card);
      const fitCamera = fitToBounds(
        cardBounds,
        {
          width: canvasCamera.viewportWidth,
          height: canvasCamera.viewportHeight,
        },
        120
      );
      const nextCamera = lodEnabled
        ? enforceMinZoomForBounds(
            cardBounds,
            {
              width: canvasCamera.viewportWidth,
              height: canvasCamera.viewportHeight,
            },
            lodThresholds.close + FOCUS_LOD_EPSILON,
            120,
            { min: 0.2, max: 4 },
          )
        : fitCamera;

      setFocusTarget({});
      setFocusCardId(null);
      setFocusWorldPoint(null);
      requestCameraTransform(nextCamera);
    },
    [canvasCamera, document, lodEnabled, lodThresholds, pushCurrentFocusSnapshot, requestCameraTransform]
  );

  const handleFocusIsland = useCallback(() => {
    if (!selectedIsland) {
      return;
    }

    focusIslandById(selectedIsland.id);
  }, [focusIslandById, selectedIsland]);

  const handleClearFocus = useCallback(() => {
    setFocusTarget({});
    setFocusWorldPoint(null);
    setFocusCardId(null);
  }, [abstractMapView, summaryView]);

  const handleToggleIslandFocus = useCallback(
    (islandId: string) => {
      if (!document) {
        return;
      }

      if (focusTarget.focusIslandId === islandId) {
        setFocusTarget({});
        setFocusWorldPoint(null);
        setFocusCardId(null);
        return;
      }

      focusIslandById(islandId);
    },
    [document, focusIslandById, focusTarget.focusIslandId]
  );

  const handleFocusBack = useCallback(() => {
    const { nextHistory, snapshot } = popFocusHistory(focusHistory);
    if (!snapshot) {
      return;
    }

    setFocusHistory(nextHistory);
    setFocusTarget(snapshot.viewState?.focusIslandId ? { focusIslandId: snapshot.viewState.focusIslandId } : {});
    setMaxDepth(snapshot.viewState?.maxDepth ?? "all");
    setFocusCardId(null);
    setFocusWorldPoint(null);
    requestCameraTransform(snapshot.camera);
  }, [focusHistory, requestCameraTransform]);


  const applyViewPreset = useCallback(
    (nextState: {
      maxDepth: ViewMaxDepth;
      hideSourceCards: boolean;
      showReadingOrder: boolean;
      clearRevealedSources?: boolean;
    }) => {
      setFocusTarget({});
      setFocusWorldPoint(null);
      setFocusCardId(null);
      setMaxDepth(nextState.maxDepth);
      setHideSourceCards(nextState.hideSourceCards);
      setShowReadingOrder(nextState.showReadingOrder);
      setIsReadingOrderEditMode(false);
      if (nextState.clearRevealedSources) {
        setRevealedSourceCardIds(new Set());
      }
    },
    []
  );

  const handleApplyBirdsEyePreset = useCallback(() => {
    applyViewPreset({
      maxDepth: 0,
      hideSourceCards: true,
      showReadingOrder: false,
      clearRevealedSources: true,
    });
  }, [applyViewPreset]);

  const handleApplyMidPreset = useCallback(() => {
    applyViewPreset({
      maxDepth: 1,
      hideSourceCards: true,
      showReadingOrder: false,
      clearRevealedSources: true,
    });
  }, [applyViewPreset]);

  const handleApplyDetailPreset = useCallback(() => {
    applyViewPreset({ maxDepth: "all", hideSourceCards: false, showReadingOrder: true });
  }, [applyViewPreset]);

  const handleHierarchyLevelChange = useCallback((level: HierarchyLevel) => {
    setHierarchyLevel(level);
    setMaxDepth(maxDepthForHierarchyLevel(level));
  }, []);

  const handleResetView = useCallback(() => {
    applyViewPreset({
      maxDepth: "all",
      hideSourceCards: true,
      showReadingOrder: false,
      clearRevealedSources: true,
    });
  }, [applyViewPreset]);

  const focusItem = useCallback((kind: "card" | "island", id: string) => {
    if (!document) {
      return;
    }

    if (kind === "card") {
      const targetCard = document.cards.find((card) => card.id === id);
      if (!targetCard) {
        setStatusMessage(t("app.status.focus.item_not_found", {
          kind: getEntityKindDisplayLabel(kind),
          id,
        }));
        return;
      }

      const isHiddenBySourceControl = hideSourceCards && isSourceCard(targetCard) && !revealedSourceCardIds.has(id);
      if (!focusedVisibleDocument?.cards.some((card) => card.id === id) || hiddenCardIdSet.has(id) || isHiddenBySourceControl) {
        setStatusMessage(t("app.status.focus.item_hidden", {
          kind: getEntityKindDisplayLabel(kind),
        }));
        return;
      }
    }

    if (kind === "island") {
      const hasIsland = document.islands.some((island) => island.id === id);
      if (!hasIsland) {
        setStatusMessage(t("app.status.focus.item_not_found", {
          kind: getEntityKindDisplayLabel(kind),
          id,
        }));
        return;
      }

      if (!visibleIslandIdSet.has(id)) {
        setStatusMessage(t("app.status.focus.item_hidden", {
          kind: getEntityKindDisplayLabel(kind),
        }));
        return;
      }
    }

    if (kind === "card") {
      focusCardById(id);
    } else {
      focusIslandById(id);
    }

    setFlashReference({ kind, id });
    setFlashRequestSeq((previousSeq) => previousSeq + 1);
  }, [
    document,
    focusCardById,
    focusIslandById,
    focusedVisibleDocument?.cards,
    hiddenCardIdSet,
    hideSourceCards,
    revealedSourceCardIds,
    visibleIslandIdSet,
  ]);

  const handleNarrativeReferenceFocus = useCallback(
    (reference: NarrativeIssueReference) => {
      focusItem(reference.kind, reference.id);
    },
    [focusItem]
  );

  const handleCheckNarrativeConsistency = useCallback(
    async (selectedNarrativeId: string | null) => {
      if (!document || narrativeText.trim().length === 0) {
        return;
      }
      if (aiBlockedByUnreviewed()) {
        return;
      }

      setIsCheckingNarrative(true);
      setNarrativeCheckError(null);
      try {
        const result = await runTenantScopedApiRequest(() => checkNarrative(
          document,
          narrativeText,
          document.readingOrder,
          { tenantSessionContext: verifiedTenantSession },
        ));
        setNarrativeIssues(result.issues);
        setLastAiCallOutcome("ok");

        if (!selectedNarrativeId) {
          return;
        }

        const selectedNarrative = (document.narratives ?? []).find((entry) => entry.id === selectedNarrativeId);
        if (!selectedNarrative) {
          return;
        }

        const nextCheck = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          kind: "consistency" as const,
          issues: result.issues,
          // A/B cross-check totals (sensemaking_technique.md §5 優先3). Undefined when the
          // provider did not return them; a 0/0 is a valid, reportable value.
          ...("counts" in result && result.counts ? { counts: result.counts } : {}),
        };

        const nextNarratives = (document.narratives ?? []).map((entry) =>
          entry.id === selectedNarrativeId
            ? {
                ...entry,
                text: narrativeText,
                checks: [...(entry.checks ?? []), nextCheck],
              }
            : entry
        );

        applyDocumentChange(
          withUpdatedTimestamp({
            ...document,
            narratives: nextNarratives,
          }),
          t("app.status.narrative.consistency_check_recorded")
        );
      } catch (error) {
        const fallback = error instanceof ApiError ? error.message : t("app.status.narrative.consistency_check_failed");
        const message = resolveAiProviderErrorMessage(error, fallback);
        setNarrativeCheckError(message);
        setNarrativeIssues([]);
        setLastAiCallOutcome(classifyAiProviderError(error));
      } finally {
        setIsCheckingNarrative(false);
      }
    },
    [
      applyDocumentChange,
      document,
      narrativeText,
      runTenantScopedApiRequest,
      verifiedTenantSession,
    ]
  );

  const handleGenerateNarrativeFromReadingOrder = useCallback(async () => {
    if (!document) {
      return;
    }
    if (aiBlockedByUnreviewed()) {
      return;
    }

    setIsGeneratingNarrative(true);
    setNarrativeGenerationError(null);
    try {
      const draftIndex = generatedNarratives.length + 1;
      const result = await runTenantScopedApiRequest(() => generateNarrative(
        document,
        `Draft ${draftIndex}`,
        narrativeModel,
        { tenantSessionContext: verifiedTenantSession },
      ));
      const nextNarrative: Narrative = {
        id: crypto.randomUUID(),
        title: `Generated Draft ${draftIndex}`,
        text: result.text,
        createdAt: new Date().toISOString(),
        basedOnReadingOrder: result.basedOnReadingOrder,
        reviewed: false,
      };
      applyDocumentChange(
        withUpdatedTimestamp({
          ...document,
          narratives: [...(document.narratives ?? []), nextNarrative],
        }),
        t("app.status.narrative.draft_generated")
      );
      setNarrativeText(result.text);
      setNarrativeIssues([]);
      if (result.warnings && result.warnings.length > 0) {
        setNarrativeGenerationError(result.warnings.join(" "));
      }
      setLastAiCallOutcome("ok");
    } catch (error) {
      const fallback = error instanceof ApiError ? error.message : t("app.status.narrative.generation_failed");
      const message = resolveAiProviderErrorMessage(error, fallback);
      setNarrativeGenerationError(message);
      setLastAiCallOutcome(classifyAiProviderError(error));
    } finally {
      setIsGeneratingNarrative(false);
    }
  }, [
    applyDocumentChange,
    document,
    generatedNarratives.length,
    narrativeModel,
    runTenantScopedApiRequest,
    verifiedTenantSession,
  ]);


  const readingOrderSnippets = useMemo(() => {
    if (!document) {
      return {};
    }

    return buildReadingOrderSnippets(document);
  }, [document]);

  const readingList = useMemo(() => {
    if (!document || !readingNavEnabled) {
      return [] as ReadingItem[];
    }

    return buildReadingList(document, { readingMode, reviewedOnly });
  }, [document, readingMode, readingNavEnabled, reviewedOnly]);

  useEffect(() => {
    if (!readingNavEnabled) {
      return;
    }

    setReadingIndex((previousIndex) => clampReadingIndex(previousIndex, readingList.length));
  }, [readingList.length, readingNavEnabled]);

  const guidedFlowSteps = useMemo(() => buildDefaultGuidedFlowSteps(evidenceGapReport), [evidenceGapReport]);
  const guidedFlowStepIndex = getGuidedFlowStepIndex(guidedFlowSteps, guidedFlowStepId);
  const currentGuidedFlowStep = guidedFlowSteps[guidedFlowStepIndex] ?? guidedFlowSteps[0];
  const guidedFlowTargets = useMemo(() => {
    if (!document || !currentGuidedFlowStep) {
      return [] as string[];
    }

    return currentGuidedFlowStep.targetSelector(document, {
      guidedFlowEnabled,
      guidedFlowStepId,
      guidedFlowTargetIndex,
    });
  }, [currentGuidedFlowStep, document, guidedFlowEnabled, guidedFlowStepId, guidedFlowTargetIndex]);

  useEffect(() => {
    setGuidedFlowTargetIndex((previousIndex) => {
      if (guidedFlowTargets.length === 0) {
        return 0;
      }

      return Math.min(previousIndex, guidedFlowTargets.length - 1);
    });
  }, [guidedFlowTargets]);

  const focusGuidedFlowTarget = useCallback((targetId: string) => {
    if (!document) {
      return;
    }

    const targetIsland = document.islands.find((island) => island.id === targetId);
    if (targetIsland) {
      setSelectedIslandId(targetIsland.id);
      setSelectedCardIds([]);
      focusItem("island", targetIsland.id);
      return;
    }

    const targetCard = document.cards.find((card) => card.id === targetId);
    if (targetCard) {
      setSelectedIslandId(null);
      setSelectedCardIds([targetCard.id]);
      focusItem("card", targetCard.id);
    }
  }, [document, focusItem]);

  const handleGuidedFlowStepChange = useCallback((direction: -1 | 1) => {
    const nextIndex = Math.max(0, Math.min(guidedFlowSteps.length - 1, guidedFlowStepIndex + direction));
    const nextStep = guidedFlowSteps[nextIndex];
    if (!nextStep) {
      return;
    }

    setGuidedFlowStepId(nextStep.id);
    setGuidedFlowTargetIndex(0);
    setPerspectiveMode(nextStep.perspectiveMode);
  }, [guidedFlowStepIndex, guidedFlowSteps]);

  const handleGuidedFlowNextTarget = useCallback(() => {
    if (guidedFlowTargets.length === 0) {
      setStatusMessage(t("side_panel.guided_flow.no_targets"));
      return;
    }

    const nextIndex = guidedFlowTargetIndex % guidedFlowTargets.length;
    const nextTargetId = guidedFlowTargets[nextIndex];
    if (!nextTargetId) {
      return;
    }

    focusGuidedFlowTarget(nextTargetId);
    setGuidedFlowTargetIndex(nextIndex + 1);

    if (readingNavEnabled) {
      const readingTargetIndex = readingList.findIndex((item) => item.id === nextTargetId);
      if (readingTargetIndex >= 0) {
        setReadingIndex(readingTargetIndex);
      }
    }
  }, [focusGuidedFlowTarget, guidedFlowTargetIndex, guidedFlowTargets, readingList, readingNavEnabled]);

  const handleGuidedFlowOpenRelevantEditor = useCallback(() => {
    if (currentGuidedFlowStep?.id === "classify") {
      setStatusMessage(t("app.status.guided_flow.use_claim_type"));
      return;
    }

    if (currentGuidedFlowStep?.id === "evidence") {
      if (selectedCardIds.length === 0 && guidedFlowTargets.length > 0) {
        const firstCardId = guidedFlowTargets.find((targetId) => document?.cards.some((card) => card.id === targetId));
        if (firstCardId) {
          setSelectedIslandId(null);
          setSelectedCardIds([firstCardId]);
          focusItem("card", firstCardId);
        }
      }
      setGuidedFlowOpenEditorRequestSeq((previousSeq) => previousSeq + 1);
      return;
    }

    if (currentGuidedFlowStep?.id === "review") {
      setStatusMessage(t("app.status.guided_flow.use_review_fields"));
      return;
    }

    setStatusMessage(t("app.status.guided_flow.use_contradiction_links"));
    setGuidedFlowOpenEditorRequestSeq((previousSeq) => previousSeq + 1);
  }, [currentGuidedFlowStep?.id, document?.cards, focusItem, guidedFlowTargets, selectedCardIds.length]);

  const currentReadingItem = readingList[clampReadingIndex(readingIndex, readingList.length)] ?? null;

  useEffect(() => {
    setSearchQuery("");
    setHideNonMatches(false);
    setDomainStateFilter(createEmptyDomainStateFilter());
    setHideNonStateMatches(false);
    setCurrentMatchIndex(0);
  }, [activeDocumentId]);

  useEffect(() => {
    if (!safeMode) {
      return;
    }

    setOutlineIncludeUnreviewed(false);
    setIncludeUnreviewedDraftsInExport(false);
  }, [safeMode]);

  const handleSetReadingNavEnabled = useCallback((enabled: boolean) => {
    setReadingNavEnabled(enabled);
    if (!enabled) {
      return;
    }

    setReadingIndex((previousIndex) => clampReadingIndex(previousIndex, readingList.length));
  }, [readingList.length]);

  const handleSetReadingMode = useCallback((nextMode: ReadingMode) => {
    setReadingMode(nextMode);
    setReadingIndex(0);
  }, [abstractMapView, summaryView]);

  const handleToggleReviewedOnly = useCallback(() => {
    setReviewedOnly((current) => !current);
    setReadingIndex(0);
  }, [abstractMapView, summaryView]);

  const focusReadingItemAtIndex = useCallback((nextIndex: number) => {
    if (!readingNavEnabled || readingList.length === 0) {
      return;
    }

    const clampedIndex = clampReadingIndex(nextIndex, readingList.length);
    const nextItem = readingList[clampedIndex];
    if (!nextItem) {
      return;
    }

    setReadingIndex(clampedIndex);
    focusItem(nextItem.kind, nextItem.id);
  }, [focusItem, readingList, readingNavEnabled]);

  const handleReadingPrev = useCallback(() => {
    focusReadingItemAtIndex(readingIndex - 1);
  }, [focusReadingItemAtIndex, readingIndex]);

  const handleReadingNext = useCallback(() => {
    focusReadingItemAtIndex(readingIndex + 1);
  }, [focusReadingItemAtIndex, readingIndex]);

  const currentLod = useMemo(() => {
    if (!lodEnabled) {
      return null;
    }

    const zoom = canvasCamera?.zoom ?? 1;
    return getLODLevel(zoom, { lodThresholds, lodLevelOverride });
  }, [canvasCamera?.zoom, lodEnabled, lodLevelOverride, lodThresholds]);

  const handleRunOutlineDiagnostics = useCallback(() => {
    if (!document) {
      setStatusMessage(t("app.status.diagnostics.no_document"));
      return;
    }
    if (!diagnosticsWorkerClientRef.current) {
      diagnosticsWorkerClientRef.current = new DiagnosticsWorkerClient();
    }

    diagnosticsAbortRef.current?.abort();
    const controller = new AbortController();
    diagnosticsAbortRef.current = controller;
    setIsDiagnosticsRunning(true);
    void runTenantScopedTask(() => diagnosticsWorkerClientRef.current!.computeDiagnostics({
      doc: document,
      view: { readingMode, reviewedOnly, collapsedIslandIds: [...collapsedIslandIds].sort() },
      options: { safeMode: true, deterministicNowIso: document.updatedAt || document.createdAt },
    }, {
      signal: controller.signal,
      onProgress: (progress) => {
        setComputeProgressMessage(t("app.status.diagnostics.progress", {
          stage: getDiagnosticsStageDisplayLabel(progress.stage),
          percent: progress.percent,
        }));
      },
    })).then((outcome) => {
      if (outcome.status === "cancelled") {
        setStatusMessage(t("app.status.diagnostics.cancelled"));
        return;
      }
      const { outlineReport, contradictionReport, distributionReport, dialecticBalanceReport } = outcome.result.diagnosticsData;
      setOutlineQualityReport(outlineReport);
      setContradictionReport(contradictionReport);
      setDistributionReport(distributionReport);
      setClaimTypeMixReport(null);
      setEvidenceGapReport(null);
      setDialecticBalanceReport(dialecticBalanceReport);

      const errorCount = outlineReport.findings.filter((finding) => finding.severity === "error").length;
      const warnCount = outlineReport.findings.filter((finding) => finding.severity === "warn").length;
      setStatusMessage(t("app.status.diagnostics.complete", {
        errors: errorCount,
        warnings: warnCount,
        contradictions: contradictionReport.stats.signals,
        distributions: distributionReport.findings.length,
        balances: dialecticBalanceReport.findings.length,
      }));
    }).catch((error: unknown) => {
      if (!(error instanceof StaleTenantSessionResultError)) {
        throw error;
      }
    }).finally(() => {
      if (diagnosticsAbortRef.current === controller) {
        diagnosticsAbortRef.current = null;
        setIsDiagnosticsRunning(false);
        setComputeProgressMessage(null);
      }
    });
  }, [collapsedIslandIds, document, readingMode, reviewedOnly, runTenantScopedTask]);

  const handleDetectVoids = useCallback(() => {
    if (!document) {
      setStatusMessage(t("app.status.diagnostics.no_document"));
      return;
    }
    const result = detectVoidCandidates(document, { nowIso: new Date().toISOString() });
    applyDocumentChange(
      withUpdatedTimestamp({ ...document, voids: result.voids }),
      t("app.status.voids.detected", { count: result.voids.length }),
    );
    // Zero-void is itself a signal (sensemaking_technique.md §4/§6): 探索が足りない.
    if (result.warning) {
      setStatusMessage(result.warning);
    }
  }, [document, applyDocumentChange, t]);

  useEffect(() => {
    setOutlineQualityReport(null);
    setContradictionReport(null);
    setDistributionReport(null);
    setClaimTypeMixReport(null);
    setEvidenceGapReport(null);
    setDialecticBalanceReport(null);
    setHighlightEdgeIds([]);
  }, [document?.id, readingMode, reviewedOnly]);

  const handleFocusDialecticBalanceFinding = useCallback((finding: BalanceFinding) => {
    const sampleCardIds = [...(finding.cardIds ?? [])].sort().slice(0, 3);
    if (sampleCardIds.length === 0) {
      return;
    }

    focusCardById(sampleCardIds[0]);
    if (sampleCardIds.length > 1) {
      setSelectedCardIds(sampleCardIds);
    }
  }, [focusCardById]);

  const handleFocusContradictionSignal = useCallback((signal: ContradictionSignal) => {
    const primaryFocusRef = pickPrimaryFocusRef(
      signal.entityRefs
        .filter((entityRef): entityRef is { kind: "island" | "card"; idOrSignature: string } =>
          entityRef.kind === "island" || entityRef.kind === "card"
        )
    );
    if (primaryFocusRef) {
      focusItem(primaryFocusRef.kind, primaryFocusRef.idOrSignature);
    }

    const edgeIds = signal.entityRefs
      .filter((entityRef) => entityRef.kind === "edge")
      .map((entityRef) => entityRef.idOrSignature);
    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
      highlightTimeoutRef.current = null;
    }

    if (edgeIds.length === 0) {
      setHighlightEdgeIds([]);
      return;
    }

    setHighlightEdgeIds(edgeIds);
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightEdgeIds([]);
      highlightTimeoutRef.current = null;
    }, 3000);
  }, [focusItem]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, [abstractMapView, summaryView]);

  const buildReadingOutline = useCallback((): string | null => {
    if (!document) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return null;
    }

    return buildReadingOutlineMd(
      document,
      {
        readingNavEnabled,
        readingIndex,
        readingMode,
        reviewedOnly,
        safeMode,
        lod: currentLod?.level ?? null,
      },
      {
        context: "share",
        includeCardTexts: outlineIncludeCardTexts,
        includeRelationSummaries: outlineIncludeRelationSummaries,
        includeUnreviewedSummaries: outlineIncludeUnreviewed,
        appendDiagnostics: outlineAppendDiagnostics,
        diagnosticsReport: outlineQualityReport,
        appendRecommendations: outlineAppendRecommendations,
        recommendations: outlineRecommendations,
        appendKaFields: outlineAppendKaFields,
      },
    );
  }, [
    document,
    outlineAppendDiagnostics,
    outlineAppendKaFields,
    outlineAppendRecommendations,
    outlineIncludeCardTexts,
    outlineIncludeRelationSummaries,
    outlineIncludeUnreviewed,
    outlineQualityReport,
    outlineRecommendations,
    readingIndex,
    readingMode,
    readingNavEnabled,
    reviewedOnly,
    collapsedIslandIds,
    safeMode,
    currentLod?.level,
  ]);

  const handleCopyReadingOutlineMd = useCallback(async () => {
    const outline = buildReadingOutline();
    if (!outline) {
      return;
    }

    try {
      const safeText = outline;
      await navigator.clipboard.writeText(safeText);
      setStatusMessage(t("app.status.outline.copied"));
    } catch {
      setStatusMessage(t("app.status.outline.copy_failed"));
    }
  }, [buildReadingOutline]);

  const handleDownloadReadingOutlineMd = useCallback(() => {
    const outline = buildReadingOutline();
    if (!outline) {
      return;
    }

    downloadTextFile("outline.md", "text/markdown", outline);
    setStatusMessage(t("app.status.outline.downloaded"));
  }, [buildReadingOutline]);

  const handleReadingDisable = useCallback(() => {
    setReadingNavEnabled(false);
  }, [abstractMapView, summaryView]);

  const loneWolfCardIdSet = useMemo(() => {
    if (!focusedVisibleDocument || (!summaryView && !abstractMapView)) {
      return new Set<string>();
    }

    const islandMemberIds = new Set<string>();
    for (const island of focusedVisibleDocument.islands) {
      for (const cardId of island.cardIds) {
        islandMemberIds.add(cardId);
      }
    }

    return new Set(
      focusedVisibleDocument.cards
        .map((card) => card.id)
        .filter((cardId) => !islandMemberIds.has(cardId))
    );
  }, [abstractMapView, focusedVisibleDocument, summaryView]);

  const islandViews = useMemo(() => {
    if (!focusedVisibleDocument) {
      return null;
    }

  return visibleIslands.map((island, index) => (
      <IslandView
        key={island.id}
        island={island}
        displayTitle={resolveIslandDisplayTitle(island, document?.islands ?? focusedVisibleDocument.islands)}
        cards={focusedVisibleDocument.cards}
        isSelected={selectedIslandId === island.id}
        isShapeStale={stalePolygonIslandIdSet.has(island.id)}
        isPeeking={peekIslandId === island.id}
        summaryView={summaryView || abstractMapView || currentLod?.level === "mid" || currentLod?.level === "far"}
        abstractMapView={abstractMapView || currentLod?.level === "far"}
        showSummary={
          currentLod?.level === "mid"
            ? summaryView || island.summaryReviewed !== false
            : summaryView || abstractMapView || currentLod?.level === "far"
        }
        isCollapsedForView={(summaryView || abstractMapView) ? effectiveCollapsedIslandIdSet.has(island.id) : collapsedIslandIdSet.has(island.id)}
        safeMode={safeMode}
        zIndex={index}
        onSelect={handleIslandSelect}
        onToggleCollapsed={handleIslandCollapsedChange}
        onTitleDoubleClick={handleToggleIslandFocus}
        onFocusIsland={focusIslandById}
        onPeekStart={handleIslandPeekStart}
        onPeekEnd={handleIslandPeekEnd}
        isPickingEdgeTarget={isPickingEdgeTarget}
        // UX-VISUAL-02 (ADR-0048 D3): a small island (<= SMALL_ISLAND_MAX_MEMBERS,
        // and non-empty) is a protected minority. Unlike the card-side lone-wolf
        // set, this needs no "clustering has begun" gate: an island's mere
        // existence already means clustering has begun, so it is inherently
        // self-gated. The lower bound excludes degenerate 0-card islands
        // (which IslandView does not render anyway).
        isProtected={
          showProtectionMarks &&
          island.cardIds.length > 0 &&
          island.cardIds.length <= SMALL_ISLAND_MAX_MEMBERS
        }
      />
    ));
  }, [
    focusedVisibleDocument,
    document?.islands,
    handleIslandCollapsedChange,
    handleIslandSelect,
    isPickingEdgeTarget,
    peekIslandId,
    selectedIslandId,
    stalePolygonIslandIdSet,
    summaryView,
    abstractMapView,
    collapsedIslandIdSet,
    effectiveCollapsedIslandIdSet,
    visibleIslands,
    handleToggleIslandFocus,
    focusIslandById,
    safeMode,
    currentLod,
    showProtectionMarks,
  ]);

  const readingOrderItems = useMemo(() => {
    if (!document) {
      return [] as Array<{ id: string; label: string }>;
    }

    return (document.readingOrder ?? []).map((entryId) => {
      const island = document.islands.find((item) => item.id === entryId);
      if (island) {
        return { id: entryId, label: resolveIslandDisplayTitle(island, document.islands) };
      }

      const card = document.cards.find((item) => item.id === entryId);
      if (card) {
        const snippet = card.text.trim().slice(0, 40);
        return { id: entryId, label: snippet.length > 0 ? snippet : `Card ${card.id}` };
      }

      return { id: entryId, label: "(missing)" };
    });
  }, [document]);

  const aggregatedEdgeInspectorItems = useMemo(() => {
    if (!document || !hideSourceCards) {
      return [] as { id: string; label: string }[];
    }

    const allRenderEdges = getEdgesToRender(document, true);
    const resolveIslandLabel = (islandId: string): string => {
      const island = document.islands.find((item) => item.id === islandId);
      return island ? resolveIslandDisplayTitle(island, document.islands) : islandId;
    };

    return allRenderEdges
      .filter((edge) => edge.isDerived)
      .map((edge) => {
        const fromLabel =
          edge.fromKind === "island"
            ? resolveIslandLabel(edge.fromId)
            : (cardsById.get(edge.fromId)?.text ?? edge.fromId);
        const toLabel =
          edge.toKind === "island" ? resolveIslandLabel(edge.toId) : (cardsById.get(edge.toId)?.text ?? edge.toId);

        return {
          id: edge.id,
          label: `${fromLabel} → ${toLabel} (${edge.type})`,
        };
      });
  }, [cardsById, document, hideSourceCards]);

  const handlePromoteAggregatedEdge = useCallback(
    (aggregateEdgeId: string) => {
      if (!document) {
        return;
      }

      const aggregatedEdge = getEdgesToRender(document, true).find(
        (edge) => edge.id === aggregateEdgeId && edge.isDerived
      );
      if (!aggregatedEdge) {
        setStatusMessage(t("app.status.aggregated_edge.not_found"));
        return;
      }

      const promotedMessage = t("app.status.aggregated_edge.promoted");
      applyDocumentChange(
        {
          ...document,
          edges: [
            ...document.edges,
            {
              id: crypto.randomUUID(),
              fromId: aggregatedEdge.fromId,
              toId: aggregatedEdge.toId,
              fromKind: aggregatedEdge.fromKind,
              toKind: aggregatedEdge.toKind,
              type: aggregatedEdge.type,
            },
          ],
        },
        promotedMessage
      );
      setStatusMessage(promotedMessage);
    },
    [applyDocumentChange, document]
  );

  const handleAddSelectedItemToReadingOrder = useCallback(() => {
    if (!document) {
      return;
    }

    const targetId = selectedIsland?.id ?? selectedCard?.id;
    if (!targetId) {
      return;
    }

    const visibleEntryIdSet = new Set<string>([...visibleCardIdSet, ...visibleIslandIdSet]);
    const nextReadingOrder = appendReadingOrderEntry(document.readingOrder ?? [], targetId, visibleEntryIdSet);
    if (nextReadingOrder === (document.readingOrder ?? [])) {
      return;
    }

    applyDocumentChange(
      {
        ...document,
        readingOrder: nextReadingOrder,
      },
      t("app.history.reading_order.item_added")
    );
  }, [applyDocumentChange, document, selectedCard?.id, selectedIsland?.id, visibleCardIdSet, visibleIslandIdSet]);

  const handleMoveReadingOrderItem = useCallback(
    (index: number, direction: -1 | 1) => {
      if (!document) {
        return;
      }

      const readingOrder = [...(document.readingOrder ?? [])];
      const nextIndex = index + direction;
      if (index < 0 || index >= readingOrder.length || nextIndex < 0 || nextIndex >= readingOrder.length) {
        return;
      }

      const [entry] = readingOrder.splice(index, 1);
      readingOrder.splice(nextIndex, 0, entry);

      applyDocumentChange(
        {
          ...document,
          readingOrder,
        },
        t("app.history.reading_order.reordered")
      );
    },
    [applyDocumentChange, document]
  );

  const handleRemoveReadingOrderItem = useCallback(
    (index: number) => {
      if (!document) {
        return;
      }

      const entryId = (document.readingOrder ?? [])[index];
      if (!entryId) {
        return;
      }

      const nextReadingOrder = removeReadingOrderEntry(document.readingOrder ?? [], entryId);
      if (nextReadingOrder === (document.readingOrder ?? [])) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          readingOrder: nextReadingOrder,
        },
        t("app.history.reading_order.item_removed")
      );
    },
    [applyDocumentChange, document]
  );


  const handleRemoveReadingOrderEntry = useCallback(
    (entryId: string) => {
      if (!document) {
        return;
      }

      const nextReadingOrder = removeReadingOrderEntry(document.readingOrder ?? [], entryId);
      if (nextReadingOrder === (document.readingOrder ?? [])) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          readingOrder: nextReadingOrder,
        },
        t("app.history.reading_order.item_removed")
      );
    },
    [applyDocumentChange, document]
  );

  const handleReorderReadingOrderEntry = useCallback(
    (entryId: string, targetEntryId: string, position: "before" | "after") => {
      if (!document) {
        return;
      }

      const nextReadingOrder = moveReadingOrderEntry(document.readingOrder ?? [], entryId, targetEntryId, position);
      if (nextReadingOrder === (document.readingOrder ?? [])) {
        return;
      }

      applyDocumentChange(
        {
          ...document,
          readingOrder: nextReadingOrder,
        },
        t("app.history.reading_order.reordered")
      );
    },
    [applyDocumentChange, document]
  );

  const handleAddSelectedCardsToIsland = useCallback(() => {
    if (!document || !selectedIsland || selectedCardIds.length === 0) {
      return;
    }

    const mergedCardIds = Array.from(new Set([...selectedIsland.cardIds, ...selectedCardIds]));
    if (
      mergedCardIds.length === selectedIsland.cardIds.length &&
      mergedCardIds.every((cardId, index) => cardId === selectedIsland.cardIds[index])
    ) {
      return;
    }

    applyDocumentChange(
      {
        ...document,
        islands: document.islands.map((island) =>
          island.id === selectedIsland.id ? { ...island, cardIds: mergedCardIds } : island
        ),
      },
      t("app.history.island.selected_cards_added")
    );
  }, [applyDocumentChange, document, selectedCardIds, selectedIsland]);

  const handleRemoveSelectedCardsFromIsland = useCallback(() => {
    if (!document || !selectedIsland || selectedCardIds.length === 0) {
      return;
    }

    const selectedCardIdSet = new Set(selectedCardIds);
    const nextCardIds = selectedIsland.cardIds.filter((cardId) => !selectedCardIdSet.has(cardId));

    if (nextCardIds.length === selectedIsland.cardIds.length) {
      return;
    }

    applyDocumentChange(
      {
        ...document,
        islands: document.islands.map((island) =>
          island.id === selectedIsland.id ? { ...island, cardIds: nextCardIds } : island
        ),
      },
      t("app.history.island.selected_cards_removed")
    );
  }, [applyDocumentChange, document, selectedCardIds, selectedIsland]);

  const handleDeleteSelectedIsland = useCallback(() => {
    if (!document || !selectedIsland) {
      return;
    }

    const nextIslands = document.islands.filter((island) => island.id !== selectedIsland.id);
    applyDocumentChange(
      {
        ...document,
        islands: nextIslands,
        readingOrder: (document.readingOrder ?? []).filter((id) => id !== selectedIsland.id),
      },
      t("app.history.island.deleted")
    );
    setSelectedIslandId(null);
  }, [applyDocumentChange, document, selectedIsland]);

  const domainStateFilterLabels: Record<DomainStateFilterKind, string> = {
    unreviewed: t("state_filter.unreviewed"),
    no_evidence: t("state_filter.no_evidence"),
    has_critique: t("state_filter.has_critique"),
  };

  const headerCenter = (
    <div data-ui-complexity-tier="core-context" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <DocumentTitleEditor
        documentTitle={document?.title}
        islandTitles={islandTitlesForSuggestion}
        cardTexts={cardTextsForSuggestion}
        onTitleChange={handleUpdateDocumentTitle}
        isReadOnly={isReadOnly}
        onSuggestTitle={handleSuggestDocumentTitle}
        providerEnabled={
          providerKind !== null
          && providerKind !== "none"
          && availableModels !== null
          && availableModels.length > 0
        }
        modelSelectionVisible={
          // Model choice is an AI feature: keep it behind the Advanced toggle so a
          // first-time user on the default (no-AI) setup is not shown an "unavailable
          // model" warning they cannot act on.
          isAdvancedUiEnabled
          && ((providerKind !== null && providerKind !== "none")
          || availableModels !== null)
        }
        documentTitleModel={documentTitleModel}
        onDocumentTitleModelChange={setDocumentTitleModel}
        availableModels={availableModels}
        availableModelsUnavailableReason={availableModelsUnavailableReason}
      />
      <SearchBar
        query={searchQuery}
        totalMatches={matchedCardIds.length}
        currentMatchIndex={activeMatchIndex}
        hideNonMatches={hideNonMatches}
        onQueryChange={(nextQuery) => {
          setSearchQuery(nextQuery);
          setCurrentMatchIndex(0);
        }}
        onPrev={handleSearchPrev}
        onNext={handleSearchNext}
        onHideNonMatchesChange={setHideNonMatches}
      />
      <div
        data-ui-region="domain-state-filter"
        role="group"
        aria-label={t("state_filter.label")}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11, color: "#475569" }}
      >
        <span style={{ fontWeight: 600 }}>{t("state_filter.label")}</span>
        {ALL_DOMAIN_STATE_FILTER_KINDS.map((kind) => {
          const isActive = domainStateFilter.active.has(kind);
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={isActive}
              data-state-filter={kind}
              onClick={() => { setDomainStateFilter((current) => toggleDomainStateFilter(current, kind)); }}
              style={{
                fontSize: 10,
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
                border: isActive ? "1px solid #6366f1" : "1px solid #cbd5e1",
                backgroundColor: isActive ? "#eef2ff" : "#ffffff",
                color: isActive ? "#3730a3" : "#475569",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              {domainStateFilterLabels[kind]}
            </button>
          );
        })}
        {domainStateFilterActive ? (
          <>
            <span data-testid="domain-state-filter-count">{t("state_filter.match_count", { count: domainStateMatchCount })}</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={hideNonStateMatches}
                onChange={(event) => { setHideNonStateMatches(event.target.checked); }}
              />
              {t("state_filter.hide_non_matches")}
            </label>
          </>
        ) : null}
      </div>
    </div>
  );

  const handleDeleteSelection = useCallback(() => {
    if (!document || isPreviewingSuggestion) {
      return;
    }

    if (selectedCardIds.length > 0) {
      const selectedCardIdSet = new Set(selectedCardIds);
      const activeCardId =
        window.document.activeElement instanceof HTMLElement
          ? window.document.activeElement.dataset.cardId
          : undefined;
      const activeCardIndex = activeCardId
        ? document.cards.findIndex((card) => card.id === activeCardId)
        : -1;
      const nextCards = document.cards.filter((card) => !selectedCardIdSet.has(card.id));
      const fallbackFocusCardId =
        activeCardId && selectedCardIdSet.has(activeCardId) && nextCards.length > 0
          ? nextCards[Math.min(Math.max(activeCardIndex, 0), nextCards.length - 1)]?.id
          : undefined;

      if (nextCards.length === document.cards.length) {
        return;
      }

      const nextEdges = document.edges.filter(
        (edge) => !selectedCardIdSet.has(edge.fromId) && !selectedCardIdSet.has(edge.toId)
      );
      const nextIslands = document.islands
        .map((island) => ({
          ...island,
          cardIds: island.cardIds.filter((cardId) => !selectedCardIdSet.has(cardId)),
        }))
        .filter((island) => island.cardIds.length > 0);

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
          edges: nextEdges,
          islands: nextIslands,
          evidenceLinks: (document.evidenceLinks ?? []).filter((link) => !selectedCardIdSet.has(link.fromCardId) && !selectedCardIdSet.has(link.toCardId)),
          readingOrder: (document.readingOrder ?? []).filter((entryId) => {
            if (selectedCardIdSet.has(entryId)) {
              return false;
            }

            return nextCards.some((card) => card.id === entryId) || nextIslands.some((island) => island.id === entryId);
          }),
        },
        "Deleted selected cards"
      );
      setSelectedCardIds([]);
      setSelectedIslandId((previousSelectedIslandId) =>
        previousSelectedIslandId && nextIslands.some((island) => island.id === previousSelectedIslandId)
          ? previousSelectedIslandId
          : null
      );
      if (fallbackFocusCardId) {
        window.requestAnimationFrame(() => {
          const fallbackCard = Array.from(
            window.document.querySelectorAll<HTMLElement>("[data-card-id]")
          ).find((element) => element.dataset.cardId === fallbackFocusCardId);
          fallbackCard?.focus({ preventScroll: true });
        });
      }
      return;
    }

    if (!selectedIslandId) {
      return;
    }

    const nextIslands = document.islands.filter((island) => island.id !== selectedIslandId);
    if (nextIslands.length === document.islands.length) {
      return;
    }

    applyDocumentChange(
      {
        ...document,
        islands: nextIslands,
        readingOrder: (document.readingOrder ?? []).filter((id) => id !== selectedIslandId),
      },
      "Deleted selected island"
    );
    setSelectedIslandId(null);
  }, [applyDocumentChange, document, isPreviewingSuggestion, selectedCardIds, selectedIslandId]);

  const handleNudgeSelection = useCallback(
    (dx: number, dy: number) => {
      if (!document || isPreviewingSuggestion || selectedCardIds.length === 0) {
        return;
      }

      const selectedCardIdSet = new Set(selectedCardIds);
      const nextCards = document.cards.map((card) =>
        selectedCardIdSet.has(card.id)
          ? {
              ...card,
              x: card.x + dx,
              y: card.y + dy,
            }
          : card
      );

      applyDocumentChange(
        {
          ...document,
          cards: nextCards,
        },
        "Nudged selected cards"
      );
    },
    [applyDocumentChange, document, isPreviewingSuggestion, selectedCardIds]
  );

  useHotkeys({
    onClearSelection: handleClearSelection,
    onDeleteSelection: handleDeleteSelection,
    onNudge: handleNudgeSelection,
    onReadingPathNext: readingNavEnabled ? handleReadingNext : undefined,
    onReadingPathPrev: readingNavEnabled ? handleReadingPrev : undefined,
    onReadingPathToggleReviewedOnly: readingNavEnabled ? handleToggleReviewedOnly : undefined,
    onReadingPathDisable: readingNavEnabled ? handleReadingDisable : undefined,
  });

  // Shared by the flat trigger button and the "作業"/"共有" menu items
  // (UX-MENU-01) so both call the exact same toggle.
  const handleToggleWorkMode = useCallback(() => {
    setIsWorkModeOpen((prev) => !prev);
  }, []);

  // EXT-AGENT-01: any change that could change what would be exported
  // requires re-confirming scope, mirroring CE1's previewConfirmed contract
  // (a change to the query invalidates a prior confirmation).
  const handleToggleAgentTaskExport = useCallback(() => {
    setIsAgentTaskExportOpen((prev) => !prev);
  }, []);
  const handleAgentTaskKindChange = useCallback((value: AgentTaskKind) => {
    setAgentTaskKind(value);
    setAgentTaskScopeConfirmed(false);
  }, []);
  const handleAgentTaskIncludeUnreviewedDraftsChange = useCallback((value: boolean) => {
    setAgentTaskIncludeUnreviewedDrafts(value);
    setAgentTaskScopeConfirmed(false);
  }, []);
  const handleAgentTaskIncludeSourceReferencesChange = useCallback((value: boolean) => {
    setAgentTaskIncludeSourceReferences(value);
    setAgentTaskScopeConfirmed(false);
  }, []);

  const buildCurrentAgentTaskSheet = useCallback(async () => {
    if (!document) return null;
    return buildAgentTaskSheet({
      doc: document,
      taskKind: agentTaskKind,
      selectedCardIds,
      selectedIslandIds: selectedIslandId ? [selectedIslandId] : [],
      safeMode,
      taskId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      options: {
        includeUnreviewedDrafts: agentTaskIncludeUnreviewedDrafts,
        includeSourceReferences: agentTaskIncludeSourceReferences,
        desiredCount: agentTaskDesiredCount,
      },
    });
  }, [
    document,
    agentTaskKind,
    selectedCardIds,
    selectedIslandId,
    safeMode,
    agentTaskIncludeUnreviewedDrafts,
    agentTaskIncludeSourceReferences,
    agentTaskDesiredCount,
  ]);

  // exportId identifies one export action (SEC-AUDIT-DUP-01). Each handler below
  // creates its own id, so separate copy / .md / task.json exports of the same
  // kind are each recorded instead of being merged by the backend dedup window.
  const reportAgentTaskExportAudit = useCallback((exportId: string) => {
    if (!document) return;
    void runTenantScopedApiRequest(() => postExportAudit(
      document.id,
      { safeMode, exportKind: "agent-task", exportId },
      { tenantSessionContext: verifiedTenantSession },
    )).catch(() => {
      // The local export already completed and there is nothing to roll back,
      // so the export is not reported as failed. But a refused (for example
      // safeMode=true, api.md 8.3) or unreachable audit call means no record
      // was saved; say so instead of dropping it silently. This runs after the
      // download/copy status message, so it replaces that message.
      setStatusMessage(t("agent_task_export.audit_not_recorded"));
    });
  }, [document, runTenantScopedApiRequest, safeMode, verifiedTenantSession]);

  const registerAgentTask = useCallback(async (output: Awaited<ReturnType<typeof buildAgentTaskSheet>>) => {
    await runTenantScopedApiRequest(() => registerExternalAgentTask({
      docId: output.correlation.docId,
      taskId: output.correlation.taskId,
      baseDocSignature: output.correlation.baseDocSignature,
      sourceBundleHash: output.correlation.bundleHash,
      queryCanonicalHash: output.correlation.queryCanonicalHash,
      taskKind: output.correlation.taskKind,
      provenanceLevel: "user_presented_unsigned",
    }, { tenantSessionContext: verifiedTenantSession }));
  }, [runTenantScopedApiRequest, verifiedTenantSession]);

  const handleCopyAgentTaskSheet = useCallback(async () => {
    const exportId = createExportId();
    const output = await runTenantScopedOptionalTask(buildCurrentAgentTaskSheet);
    if (!output) return;
    try {
      await registerAgentTask(output);
    } catch {
      setStatusMessage(t("agent_task_export.registration_failed"));
      return;
    }
    try {
      await navigator.clipboard.writeText(output.taskSheetMd);
      recordAgentTaskExport(output.correlation, appStorage.scope);
      setStatusMessage(t("agent_task_export.copied"));
      reportAgentTaskExportAudit(exportId);
    } catch {
      setStatusMessage(t("agent_task_export.copy_failed"));
    }
  }, [appStorage.scope, buildCurrentAgentTaskSheet, registerAgentTask, reportAgentTaskExportAudit, runTenantScopedOptionalTask]);

  const handleDownloadAgentTaskSheet = useCallback(async () => {
    const exportId = createExportId();
    const output = await runTenantScopedOptionalTask(buildCurrentAgentTaskSheet);
    if (!output) return;
    try {
      await registerAgentTask(output);
    } catch {
      setStatusMessage(t("agent_task_export.registration_failed"));
      return;
    }
    downloadTextFile("task-sheet.md", "text/markdown", output.taskSheetMd);
    recordAgentTaskExport(output.correlation, appStorage.scope);
    setStatusMessage(t("agent_task_export.downloaded_md"));
    reportAgentTaskExportAudit(exportId);
  }, [appStorage.scope, buildCurrentAgentTaskSheet, registerAgentTask, reportAgentTaskExportAudit, runTenantScopedOptionalTask]);

  const handleDownloadAgentTaskJson = useCallback(async () => {
    const exportId = createExportId();
    const output = await runTenantScopedOptionalTask(buildCurrentAgentTaskSheet);
    if (!output) return;
    try {
      await registerAgentTask(output);
    } catch {
      setStatusMessage(t("agent_task_export.registration_failed"));
      return;
    }
    downloadTextFile("task.json", "application/json", output.taskJson);
    recordAgentTaskExport(output.correlation, appStorage.scope);
    setStatusMessage(t("agent_task_export.downloaded_json"));
    reportAgentTaskExportAudit(exportId);
  }, [appStorage.scope, buildCurrentAgentTaskSheet, registerAgentTask, reportAgentTaskExportAudit, runTenantScopedOptionalTask]);

  // EXT-AGENT-02: parsing/reviewing a pasted response never touches the
  // document (AC-6); only a per-proposal "Import" click does, one
  // applyDocumentChange each, so Cmd+Z reverts a single imported item.
  // External responses use their own task/proposal registration endpoints.
  // They retain unsigned user-presented provenance and must never be routed
  // through CE1 context-audit or the internal CE2 decision endpoint.
  const handleToggleAgentResponseImport = useCallback(() => {
    setIsAgentResponseImportOpen((prev) => !prev);
  }, []);

  const handleParseAgentResponse = useCallback(async () => {
    if (!document) return;
    const result = parseAgentResponse(agentResponsePastedText, agentResponseImportMode);
    if (!result.ok) {
      setAgentResponseParseErrors(result.errors);
      setAgentResponseParseWarnings([]);
      return;
    }
    setAgentResponseParseErrors([]);
    const verification = verifyAgentResponseCorrelation(
      result.response.taskId,
      result.response.correlation,
      document,
      appStorage.scope,
    );
    if (!verification.ok) {
      setAgentResponseParseErrors([verification.error]);
      setAgentResponseParseWarnings(result.warnings);
      return;
    }
    const warnings = verification.provenance === "unverified-legacy"
      ? [...result.warnings, verification.warning]
      : result.warnings;
    setAgentResponseParseWarnings(warnings);

    const existingIds = new Set(agentImportedProposalReviews.map((review) => review.reviewKey));
    if (result.response.proposals.length > 0 && result.response.proposals.every((proposal) => existingIds.has(`${result.response.taskId}:${proposal.proposalId}`))) {
      setStatusMessage(t("agent_response_import.duplicate_status_message"));
      return;
    }

    const proposals = result.response.proposals.filter(
      (proposal) => !existingIds.has(`${result.response.taskId}:${proposal.proposalId}`),
    );
    let registrations: Array<{ proposal: ParsedAgentProposal; auditProposalId?: string }>;
    try {
      registrations = await Promise.all(proposals.map(async (proposal) => {
        if (!result.response.correlation) return { proposal };
        const auditProposalId = await buildExternalProposalAuditId(result.response.taskId, proposal.proposalId);
        const proposalFingerprint = await fingerprintAgentProposal(proposal);
        await runTenantScopedApiRequest(() => registerExternalAgentProposal({
          docId: document.id,
          taskId: result.response.taskId,
          baseDocSignature: result.response.correlation!.baseDocSignature,
          sourceBundleHash: result.response.correlation!.bundleHash,
          queryCanonicalHash: result.response.correlation!.queryCanonicalHash,
          proposalId: auditProposalId,
          proposalKind: proposal.kind,
          proposalFingerprint,
          provenanceLevel: "user_presented_unsigned",
        }, { tenantSessionContext: verifiedTenantSession }));
        return { proposal, auditProposalId };
      }));
    } catch {
      setAgentResponseParseErrors(["payload.proposal_audit_registration_failed"]);
      return;
    }
    const newReviews: ImportedProposalReview[] = registrations.map(({ proposal, auditProposalId }) => ({
      ...proposal,
      reviewKey: `${result.response.taskId}:${proposal.proposalId}`,
      taskId: result.response.taskId,
      auditProposalId,
      sourceBundleHash: result.response.correlation?.bundleHash,
      provenance: verification.provenance,
      status: "pending" as const,
      ...computeAgentProposalReviewFlags(proposal, document),
    }));
    // FB-RM-UX-02: bound the review list — pending reviews are never dropped;
    // only the most recent resolved (adopted/rejected) entries are retained.
    setAgentImportedProposalReviews((previous) =>
      boundResolvedAgentImportedProposalReviews([...previous, ...newReviews]),
    );
  }, [appStorage.scope, document, agentResponsePastedText, agentResponseImportMode, agentImportedProposalReviews, runTenantScopedApiRequest, verifiedTenantSession]);

  const handleAdoptAgentImportedProposal = useCallback(
    async (reviewKey: string) => {
      if (!document) return;
      const review = agentImportedProposalReviews.find((item) => item.reviewKey === reviewKey);
      if (!review || review.status !== "pending" || review.orphaned) return;
      if (!review.auditProposalId || !review.sourceBundleHash) {
        setStatusMessage(t("agent_response_import.audit_required_status_message"));
        return;
      }
      try {
        await runTenantScopedApiRequest(() => recordExternalAgentProposalDecision({
          docId: document.id,
          proposalId: review.auditProposalId!,
          sourceBundleHash: review.sourceBundleHash!,
          idempotencyKey: `${review.auditProposalId}:adopt`,
          decision: "adopt",
          provenanceLevel: "user_presented_unsigned",
        }, { tenantSessionContext: verifiedTenantSession }));
      } catch {
        setStatusMessage(t("agent_response_import.audit_failed_status_message"));
        return;
      }

      let adopted = false;
      switch (review.kind) {
        case "island_title": {
          const islandId = review.targetRef.islandId;
          const title = review.content.title;
          if (!islandId || !title) break;
          const nextIslands = document.islands.map((island) =>
            island.id === islandId ? { ...island, title, titleReviewed: false } : island
          );
          applyDocumentChange({ ...document, islands: nextIslands }, t("app.history.agent_response.island_title_imported"));
          adopted = true;
          break;
        }
        case "critique":
        case "opposing_viewpoint": {
          const text = review.content.text;
          if (!text) break;
          const cardId = review.targetRef.cardIds?.[0];
          const islandId = review.targetRef.islandId;
          if (cardId) {
            const nextCards = document.cards.map((card) => (card.id === cardId ? { ...card, critique: text } : card));
            applyDocumentChange({ ...document, cards: nextCards }, t("app.history.agent_response.critique_imported"));
            adopted = true;
          } else if (islandId) {
            const nextIslands = document.islands.map((island) => (island.id === islandId ? { ...island, critique: text } : island));
            applyDocumentChange({ ...document, islands: nextIslands }, t("app.history.agent_response.critique_imported"));
            adopted = true;
          }
          break;
        }
        case "narrative_draft": {
          const text = review.content.text ?? review.content.mergedText;
          if (!text) break;
          const nextNarrative: Narrative = {
            id: crypto.randomUUID(),
            title: review.content.title ?? "Imported Draft",
            text,
            createdAt: new Date().toISOString(),
            reviewed: false,
          };
          applyDocumentChange(
            { ...document, narratives: [...(document.narratives ?? []), nextNarrative] },
            t("app.history.agent_response.narrative_imported")
          );
          adopted = true;
          break;
        }
        case "merge_candidate": {
          const cardIds = review.targetRef.cardIds ?? [];
          const mergedText = review.content.mergedText ?? review.content.text;
          const mergeMethod = review.content.mergeMethod;
          if (cardIds.length < 2 || !mergedText || !mergeMethod) break;
          const [targetCardId, ...candidateCardIds] = cardIds;
          setMergeSuggestions((previous) => [
            ...previous,
            {
              groupId: `agent-response-${review.proposalId}`,
              mergeMethod,
              targetCardId,
              candidateCardIds,
              scoreSummary: { min: 0, max: 0, avg: 0 },
              reasonCodes: [`agent-response:${review.proposalId}`],
              snapshotVersion: `agent-response.v1:${review.proposalId}`,
              cardIds,
              mergedTextDraft: mergedText,
              rationale: review.rationale,
              editedText: mergedText,
              isEdited: false,
            },
          ]);
          adopted = true;
          break;
        }
        case "patch": {
          if (!review.patch || review.patchSignatureMismatch) break;
          const lintResult = lintPatchAgainstCurrentDoc(document, review.patch);
          if (shouldBlockPatchApplyByLint(lintResult)) break;
          const { document: nextDoc, meta } = applyPatchWithResolutionsDetailed(document, review.patch, {});
          const loggedDoc = appendPatchApplyLog(nextDoc, review.patch, {
            ...meta,
            patchTitle: `agent-response:${review.proposalId}`,
            baseDocSignature: `${document.id}:${document.updatedAt}`,
          });
          applyDocumentChange(loggedDoc, t("app.history.agent_response.patch_imported"));
          adopted = true;
          break;
        }
      }

      if (!adopted) {
        return;
      }

      setAgentImportedProposalReviews((previous) =>
        previous.map((item) => (item.reviewKey === reviewKey ? { ...item, status: "adopted" as const } : item))
      );
      setStatusMessage(t("agent_response_import.adopted_status_message"));
    },
    [
      document,
      agentImportedProposalReviews,
      applyDocumentChange,
      runTenantScopedApiRequest,
      verifiedTenantSession,
    ]
  );

  const handleRejectAgentImportedProposal = useCallback(async (reviewKey: string) => {
    const review = agentImportedProposalReviews.find((item) => item.reviewKey === reviewKey);
    if (!document || !review || review.status !== "pending") return;
    if (!review.auditProposalId || !review.sourceBundleHash) {
      setStatusMessage(t("agent_response_import.audit_required_status_message"));
      return;
    }
    try {
      await runTenantScopedApiRequest(() => recordExternalAgentProposalDecision({
        docId: document.id,
        proposalId: review.auditProposalId!,
        sourceBundleHash: review.sourceBundleHash!,
        idempotencyKey: `${review.auditProposalId}:reject`,
        decision: "reject",
        provenanceLevel: "user_presented_unsigned",
      }, { tenantSessionContext: verifiedTenantSession }));
    } catch {
      setStatusMessage(t("agent_response_import.audit_failed_status_message"));
      return;
    }
    setAgentImportedProposalReviews((previous) =>
      previous.map((item) => (item.reviewKey === reviewKey ? { ...item, status: "rejected" as const } : item))
    );
    setStatusMessage(t("agent_response_import.rejected_status_message"));
  }, [agentImportedProposalReviews, document, runTenantScopedApiRequest, verifiedTenantSession]);

  const handleExportAgentImportedProposalPatchFile = useCallback(
    (reviewKey: string) => {
      const review = agentImportedProposalReviews.find((item) => item.reviewKey === reviewKey);
      if (!review?.patch) return;
      downloadTextFile(`agent-patch-${review.proposalId}.json`, "application/json", JSON.stringify(review.patch, null, 2));
      setStatusMessage(t("agent_response_import.exported_patch_file_status_message"));
    },
    [agentImportedProposalReviews]
  );
  const handleToggleSharePanel = useCallback(() => {
    setIsSharePanelOpen((previousOpen) => {
      const nextOpen = !previousOpen;
      if (nextOpen) {
        setIsViewControlsOpen(false);
      }
      return nextOpen;
    });
  }, []);

  const headerRight = (
    <div
      data-ui-complexity-tier="core-toolbar"
      style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", rowGap: 6, whiteSpace: "nowrap", maxWidth: "100%" }}
    >
      {verifiedTenantSession ? (
        <TenantSessionControl
          sessionContext={verifiedTenantSession}
          isChanging={tenantSwitchUiState.status === "switching"}
          selectRef={tenantControlRef}
          onRequestTenantChange={handleTenantChangeRequest}
        />
      ) : null}
      <button
        type="button"
        onClick={handleUndo}
        disabled={isReadOnly || isLoading || !document || !canUndo}
        data-ui-core-action="undo"
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 500,
          cursor: isReadOnly || isLoading || !document || !canUndo ? "not-allowed" : "pointer",
        }}
      >
        {t("app.toolbar.undo")}
      </button>
      <button
        type="button"
        onClick={handleRedo}
        disabled={isReadOnly || isLoading || !document || !canRedo}
        data-ui-core-action="redo"
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 500,
          cursor: isReadOnly || isLoading || !document || !canRedo ? "not-allowed" : "pointer",
        }}
      >
        {t("app.toolbar.redo")}
      </button>
      <button
        data-ui-complexity-tier="advanced-disclosure"
        type="button"
        onClick={handleToggleAdvancedUi}
        aria-pressed={isAdvancedUiEnabled}
        title={t("app.toolbar.advanced_ui_hint")}
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: isAdvancedUiEnabled ? "#e0e7ff" : "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("app.toolbar.advanced_ui")}
      </button>
      <button
        ref={workModeTriggerRef}
        data-ui-complexity-tier="advanced-disclosure"
        data-ui-core-action="work-mode"
        type="button"
        onClick={handleToggleWorkMode}
        aria-pressed={isWorkModeOpen}
        title={t("work_mode.title")}
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: isWorkModeOpen ? "#e0e7ff" : "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("work_mode.title")}
      </button>
      {isAdvancedUiEnabled ? (
        <button
          data-ui-complexity-tier="advanced-content"
          type="button"
          onClick={() => {
            void handleSuggestLayout();
          }}
          disabled={isReadOnly || isLoading || !document || isSuggesting}
          style={{
            border: "1px solid #cbd5e1",
            backgroundColor: "#ffffff",
            color: "#0f172a",
            borderRadius: 6,
            padding: "6px 12px",
            fontWeight: 600,
            cursor: isReadOnly || isLoading || !document || isSuggesting ? "not-allowed" : "pointer",
          }}
        >
          {isSuggesting ? t("suggestion.panel.suggesting") : t("suggestion.panel.suggest_layout")}
        </button>
      ) : null}
      {isAdvancedUiEnabled ? (
        <button
          ref={agentTaskExportTriggerRef}
          data-ui-complexity-tier="advanced-content"
          type="button"
          onClick={handleToggleAgentTaskExport}
          aria-pressed={isAgentTaskExportOpen}
          title={t("agent_task_export.title")}
          style={{
            border: "1px solid #cbd5e1",
            backgroundColor: isAgentTaskExportOpen ? "#e0e7ff" : "#ffffff",
            color: "#0f172a",
            borderRadius: 6,
            padding: "6px 12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("agent_task_export.title")}
        </button>
      ) : null}
      {isAdvancedUiEnabled ? (
        <button
          ref={agentResponseImportTriggerRef}
          data-ui-complexity-tier="advanced-content"
          type="button"
          onClick={handleToggleAgentResponseImport}
          aria-pressed={isAgentResponseImportOpen}
          title={t("agent_response_import.title")}
          style={{
            border: "1px solid #cbd5e1",
            backgroundColor: isAgentResponseImportOpen ? "#e0e7ff" : "#ffffff",
            color: "#0f172a",
            borderRadius: 6,
            padding: "6px 12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("agent_response_import.title")}
        </button>
      ) : null}
      {isAdvancedUiEnabled ? (
        <button
          ref={diagnosticsBundleTriggerRef}
          data-ui-complexity-tier="advanced-content"
          type="button"
          onClick={() => setIsDiagnosticsBundleOpen((current) => !current)}
          aria-pressed={isDiagnosticsBundleOpen}
          title={t("diagnostics_bundle.title")}
          style={{
            border: "1px solid #cbd5e1",
            backgroundColor: isDiagnosticsBundleOpen ? "#e0e7ff" : "#ffffff",
            color: "#0f172a",
            borderRadius: 6,
            padding: "6px 12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {t("diagnostics_bundle.title")}
        </button>
      ) : null}
      <button
        data-ui-core-action="create-card"
        type="button"
        onClick={handleAddCard}
        disabled={isReadOnly || isLoading || !document}
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 600,
          cursor: isReadOnly || isLoading || !document ? "not-allowed" : "pointer",
        }}
      >
        {t("app.toolbar.new_card")}
      </button>
      <button
        data-ui-core-action="create-island"
        type="button"
        onClick={handleCreateIsland}
        disabled={isReadOnly || isLoading || !document || !canCreateIsland}
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 600,
          cursor: isReadOnly || isLoading || !document || !canCreateIsland ? "not-allowed" : "pointer",
        }}
      >
        {t("app.toolbar.create_island")}
      </button>
      <button
        data-ui-core-action="delete-selection"
        type="button"
        onClick={handleDeleteSelection}
        disabled={isReadOnly || isLoading || !document || (selectedCardIds.length === 0 && !selectedIslandId)}
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 600,
          cursor:
            isReadOnly || isLoading || !document || (selectedCardIds.length === 0 && !selectedIslandId)
              ? "not-allowed"
              : "pointer",
        }}
      >
        {t("app.toolbar.delete_selection")}
      </button>
      <button
        data-ui-core-action="save"
        type="button"
        onClick={() => {
          void handleSave();
        }}
        disabled={isReadOnly || isLoading || !document || isSaving || !isDirty}
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: isSaving ? "#f8fafc" : "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "6px 12px",
          fontWeight: 600,
          cursor: isReadOnly || isLoading || !document || isSaving || !isDirty ? "not-allowed" : "pointer",
        }}
      >
        {isSaving ? t("app.status.saving") : t("app.toolbar.save")}
      </button>
    </div>
  );

  const getVisibleBoundsExportArea = useCallback(() => {
    if (!focusedVisibleDocument || !canvasCamera) {
      return null;
    }

    const visibleBounds = computeVisibleBounds(focusedVisibleDocument, {
      visibleIslandIds: visibleIslandIdSet,
      hiddenCardIds: hiddenCardIdSet,
      hideSourceCards: hideSourceCards || summaryView || abstractMapView,
      summaryView,
      abstractMapView,
    });

    if (!visibleBounds) {
      return null;
    }

    return {
      x: visibleBounds.x - SVG_VISIBLE_BOUNDS_PADDING,
      y: visibleBounds.y - SVG_VISIBLE_BOUNDS_PADDING,
      w: visibleBounds.w + SVG_VISIBLE_BOUNDS_PADDING * 2,
      h: visibleBounds.h + SVG_VISIBLE_BOUNDS_PADDING * 2,
    };
  }, [abstractMapView, canvasCamera, focusedVisibleDocument, hiddenCardIdSet, hideSourceCards, summaryView, visibleIslandIdSet]);

  // UX-SCALE-01: the same visibility filtering as getVisibleBoundsExportArea,
  // reused so the minimap's dots/outlines match what's actually on screen.
  const minimapCards = useMemo(() => {
    if (!focusedVisibleDocument) {
      return [];
    }
    const hideSource = hideSourceCards || summaryView || abstractMapView;
    return focusedVisibleDocument.cards.filter((card) => {
      if (hiddenCardIdSet.has(card.id)) {
        return false;
      }
      if (hideSource && isSourceCard(card)) {
        return false;
      }
      return true;
    });
  }, [focusedVisibleDocument, hiddenCardIdSet, hideSourceCards, summaryView, abstractMapView]);

  const minimapIslands = useMemo(() => {
    if (!focusedVisibleDocument) {
      return [];
    }
    return focusedVisibleDocument.islands.filter((island) => visibleIslandIdSet.has(island.id));
  }, [focusedVisibleDocument, visibleIslandIdSet]);

  const handleMinimapPan = useCallback(
    (panX: number, panY: number) => {
      if (!canvasCamera) {
        return;
      }
      requestCameraTransform({ panX, panY, zoom: canvasCamera.zoom });
    },
    [canvasCamera, requestCameraTransform]
  );

  const getViewMetadataFilename = useCallback((mode: "viewport" | "bounds", generatedAt: string) => {
    const date = generatedAt.slice(0, 10);
    return `sui-sensemaking-${date}-${mode}.view.json`;
  }, [abstractMapView, summaryView]);

  const downloadViewMetadata = useCallback(
    (mode: "viewport" | "bounds", bounds?: { x: number; y: number; w: number; h: number }, padding?: number) => {
      if (!document || !canvasCamera) {
        return;
      }

      const generatedAt = new Date().toISOString();
      const metadata = buildExportViewMetadata({
        doc: document,
        visibility: viewVisibility,
        camera: canvasCamera,
        viewState: {
          summaryView,
          abstractMapView,
          hideSourceCards,
          hierarchyLevel,
          maxDepth,
          focusIslandId: focusTarget.focusIslandId ?? null,
          showReadingOrder,
          editReadingOrder: isReadingOrderEditMode,
          readingNavEnabled,
          readingIndex,
          readingMode,
          reviewedOnly,
          collapsedIslandIds: [...collapsedIslandIds].sort(),
          safeMode: safeMode ?? true,
          lodEnabled,
          lodThresholds,
          lodLevelOverride,
          lodShowLoneWolvesWhenFar,
          resolvedLodLevel: currentLod?.level,
          evidenceOverlayEnabled,
          evidenceOverlayMode,
          evidenceOverlayDepth,
          evidenceOverlayScope,
          evidenceOverlayDimOthers,
          perspectiveMode,
          perspectiveStrictFilter,
          perspectivePresets,
          locale: getActiveLocale(),
          presets: viewPresets,
          activePresetId: activePresetId ?? undefined,
        },
        exportMode: mode,
        bounds,
        padding,
        generatedAt,
        mergeAuditLog,
        reviewEvents,
        reviewRedactionMode: "none",
      });

      downloadTextFile(getViewMetadataFilename(mode, generatedAt), "application/json", `${JSON.stringify(metadata, null, 2)}\n`);
    },
    [
      mergeAuditLog,
      abstractMapView,
      canvasCamera,
      document,
      focusTarget.focusIslandId,
      getViewMetadataFilename,
      hideSourceCards,
      hierarchyLevel,
      isReadingOrderEditMode,
      readingNavEnabled,
      readingIndex,
      readingMode,
      reviewedOnly,
      collapsedIslandIds,
      maxDepth,
      showReadingOrder,
      summaryView,
      safeMode,
      viewVisibility,
      lodEnabled,
      lodThresholds,
      lodLevelOverride,
      lodShowLoneWolvesWhenFar,
      perspectiveMode,
      perspectiveStrictFilter,
      perspectivePresets,
      viewPresets,
      activePresetId,
      reviewEvents,
      currentLod,
      evidenceOverlayEnabled,
      evidenceOverlayMode,
      evidenceOverlayDepth,
      evidenceOverlayScope,
      evidenceOverlayDimOthers,
      ]
  );

  const handleExportBundleZip = useCallback(async (options: {
    includeOutline: boolean;
    includeDiagnostics: boolean;
    includeSelectedCardTraces: boolean;
    includeVisualCueAssets: boolean;
    exportGranularity: "overview" | "detail";
  }) => {
    if (!document) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }
    if (isBundleExportRunning) {
      return;
    }

    let unsubscribeBundleProgress: (() => void) | null = null;
    let capturedBundleController: AbortController | null = null;
    try {
      setIsBundleExportRunning(true);
      const exportTimestamp = formatBundleTimestamp(new Date());
      const rootFolderPath = `sui-sensemaking-export-${exportTimestamp}`;
      const deterministicNowIso = document.updatedAt || document.createdAt;
      const exportCamera = canvasCamera ?? buildFallbackCanvasCamera(document);
      const viewMetadata = buildExportViewMetadata({
        doc: document,
        visibility: viewVisibility,
        camera: exportCamera,
        viewState: {
          summaryView,
          abstractMapView,
          hideSourceCards,
          hierarchyLevel,
          maxDepth,
          focusIslandId: focusTarget.focusIslandId ?? null,
          showReadingOrder,
          editReadingOrder: isReadingOrderEditMode,
          readingNavEnabled,
          readingIndex,
          readingMode,
          reviewedOnly,
          collapsedIslandIds: [...collapsedIslandIds].sort(),
          safeMode: safeMode ?? true,
          lodEnabled,
          lodThresholds,
          lodLevelOverride,
          lodShowLoneWolvesWhenFar,
          resolvedLodLevel: currentLod?.level,
          evidenceOverlayEnabled,
          evidenceOverlayMode,
          evidenceOverlayDepth,
          evidenceOverlayScope,
          evidenceOverlayDimOthers,
          perspectiveMode,
          perspectiveStrictFilter,
          perspectivePresets,
          locale: getActiveLocale(),
          presets: viewPresets,
          activePresetId: activePresetId ?? undefined,
        },
        exportMode: "viewport",
        generatedAt: deterministicNowIso,
        mergeAuditLog,
        reviewEvents,
        reviewRedactionMode: "strip-identities",
      });

      const controller = new AbortController();
      capturedBundleController = controller;
      bundleAbortRef.current = controller;
      unsubscribeBundleProgress = bundleRunnerRef.current.onProgress((progress) => setComputeProgressMessage(progress.message));
      const outcome = await runTenantScopedTask(() => bundleRunnerRef.current.run(async (ctx) => {
        ctx.reportProgress({ message: t("app.status.bundle.progress.building"), completed: 1, total: 3 });
        await ctx.yieldToMainThread();
        const visualCueAssetBundle = options.includeVisualCueAssets
          ? await buildRepresentativeVisualCueAssetBundle(document, appStorage.scope)
          : undefined;
        const files = await buildExportBundleWithWorkers(document, viewMetadata, {
          rootFolderPath,
          safeMode: safeMode ?? true,
          includeOutline: options.includeOutline,
          includeDiagnostics: options.includeDiagnostics,
          includeSelectedCardTraces: options.includeSelectedCardTraces,
          selectedCardId: selectedCard?.id ?? null,
          exportGranularity: options.exportGranularity,
          deterministicNowIso,
          readingMode,
          reviewedOnly,
          readingState: {
            readingNavEnabled,
            readingIndex,
            readingMode,
            reviewedOnly,
            safeMode: safeMode ?? true,
            lod: currentLod?.level ?? null,
            generatedAt: deterministicNowIso,
          },
          outlineOptions: {
            includeCardTexts: outlineIncludeCardTexts,
            includeRelationSummaries: outlineIncludeRelationSummaries,
            includeUnreviewedSummaries: safeMode ? false : outlineIncludeUnreviewed,
            appendDiagnostics: outlineAppendDiagnostics,
            diagnosticsReport: outlineQualityReport,
            appendRecommendations: outlineAppendRecommendations,
            recommendations: outlineRecommendations,
            appendKaFields: outlineAppendKaFields,
          },
          outlineQualityReport,
          contradictionReport,
          distributionReport,
          dialecticBalanceReport,
          viewVisibility,
          packVisibility,
          includeSourceReferences: includeSourceReferencesInExport,
          includeVisualCueAssets: options.includeVisualCueAssets,
          visualCueAssetBundle,
        }, {
          signal: controller.signal,
          onProgress: (stage) => ctx.reportProgress({
            message: t("app.status.bundle.progress.stage", { stage: getBundleExportProgressStageLabel(stage) }),
            completed: 2,
            total: 3,
          }),
        });
        if (controller.signal.aborted || ctx.isCancelled()) {
          return null;
        }
        ctx.reportProgress({ message: t("app.status.bundle.progress.zipping"), completed: 3, total: 3 });
        await ctx.yieldToMainThread();
        const zipBlob = await buildBundleZipBlob(files, {
          signal: controller.signal,
          onProgress: (percent) => ctx.reportProgress({
            message: t("app.status.bundle.progress.zipping_percent", { percent }),
            completed: 3,
            total: 3,
          }),
        });
        return { files, zipBlob };
      }));
      unsubscribeBundleProgress();
      unsubscribeBundleProgress = null;
      if (outcome.status === "cancelled" || outcome.result === null) {
        setStatusMessage(t("app.status.bundle.cancelled"));
        return;
      }
      const { files, zipBlob } = outcome.result;
      downloadBlobAsFile(`${rootFolderPath}.zip`, zipBlob);
      setStatusMessage(t("app.status.bundle.exported", { count: files.length }));

    } catch (error) {
      if (error instanceof StaleTenantSessionResultError) {
        return;
      }
      const message = error instanceof Error ? error.message : t("app.status.bundle.failed_unknown");
      if (message.toLowerCase().includes("cancelled")) {
        setStatusMessage(t("app.status.bundle.cancelled"));
      } else {
        setStatusMessage(t("app.status.bundle.failed", { detail: message }));
      }
    } finally {
      unsubscribeBundleProgress?.();
      if (bundleAbortRef.current === capturedBundleController) {
        bundleAbortRef.current = null;
        setIsBundleExportRunning(false);
        setComputeProgressMessage(null);
      }
    }
  }, [
    abstractMapView,
    appStorage,
    canvasCamera,
    contradictionReport,
    currentLod?.level,
    dialecticBalanceReport,
    distributionReport,
    document,
    evidenceOverlayDepth,
    evidenceOverlayEnabled,
    evidenceOverlayDimOthers,
    evidenceOverlayMode,
    evidenceOverlayScope,
    focusTarget.focusIslandId,
    hideSourceCards,
    hierarchyLevel,
    isBundleExportRunning,
    isReadingOrderEditMode,
    lodEnabled,
    lodLevelOverride,
    lodShowLoneWolvesWhenFar,
    lodThresholds,
    maxDepth,
    outlineAppendDiagnostics,
    outlineAppendKaFields,
    outlineAppendRecommendations,
    outlineIncludeCardTexts,
    outlineIncludeRelationSummaries,
    outlineIncludeUnreviewed,
    outlineQualityReport,
    outlineRecommendations,
    perspectiveMode,
    perspectivePresets,
    packVisibility,
    viewPresets,
          activePresetId,
    perspectiveStrictFilter,
    readingIndex,
    readingMode,
    readingNavEnabled,
    reviewEvents,
    reviewedOnly,
    runTenantScopedTask,
    safeMode,
    mergeAuditLog,
    selectedCard?.id,
    showReadingOrder,
    summaryView,
    viewVisibility,
    includeSourceReferencesInExport,
  ]);

  const handleExportAbstractMapMarkdownWithPng = useCallback(async () => {
    if (!document || !focusedVisibleDocument || !canvasCamera) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const area = getVisibleBoundsExportArea();
    if (!area) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    try {
      const pngBlob = await runTenantScopedOptionalTask(() => exportCanvasToPngBlob({
        doc: focusedVisibleDocument,
        viewState: {
          visibleIslandIds: visibleIslandIdSet,
          hiddenCardIds: hiddenCardIdSet,
          hideSourceCards: hideSourceCards || summaryView || abstractMapView,
          summaryView,
          abstractMapView,
        },
        camera: canvasCamera,
        area,
        safeMode,
        scale: 2,
      }));
      if (pngBlob === undefined) {
        return;
      }

      const model = buildAbstractMapExport(document, {
        visibleIslandIds: visibleIslandIdSet,
        abstractMapView,
        includeUnreviewedDrafts: !safeMode && includeUnreviewedDraftsInExport,
        safeMode,
      });

      const snapshotFilename = "snapshot.png";
      downloadBlobFile(snapshotFilename, pngBlob);
      downloadTextFile("report.md", "text/markdown", exportAbstractMapMarkdown(model, { snapshotFilename }));
      downloadViewMetadata("bounds", area, SVG_VISIBLE_BOUNDS_PADDING);
      setStatusMessage(t("app.status.export.abstract_md"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("app.status.export.report_failed_unknown");
      setStatusMessage(t("app.status.export.report_failed", { detail: message }));
    }
  }, [
    abstractMapView,
    canvasCamera,
    document,
    focusedVisibleDocument,
    getVisibleBoundsExportArea,
    downloadViewMetadata,
    hiddenCardIdSet,
    hideSourceCards,
    summaryView,
    visibleIslandIdSet,
    safeMode,
    includeUnreviewedDraftsInExport,
    runTenantScopedOptionalTask,
  ]);

  const handleExportAbstractMapHtmlWithPng = useCallback(async () => {
    if (!document || !focusedVisibleDocument || !canvasCamera) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const area = getVisibleBoundsExportArea();
    if (!area) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    try {
      const pngBlob = await runTenantScopedOptionalTask(() => exportCanvasToPngBlob({
        doc: focusedVisibleDocument,
        viewState: {
          visibleIslandIds: visibleIslandIdSet,
          hiddenCardIds: hiddenCardIdSet,
          hideSourceCards: hideSourceCards || summaryView || abstractMapView,
          summaryView,
          abstractMapView,
        },
        camera: canvasCamera,
        area,
        safeMode,
        scale: 2,
      }));
      if (pngBlob === undefined) {
        return;
      }

      const model = buildAbstractMapExport(document, {
        visibleIslandIds: visibleIslandIdSet,
        abstractMapView,
        includeUnreviewedDrafts: !safeMode && includeUnreviewedDraftsInExport,
        safeMode,
      });

      const snapshotDataUrl = await runTenantScopedOptionalTask(() => readBlobAsDataUrl(pngBlob));
      if (snapshotDataUrl === undefined) {
        return;
      }
      downloadTextFile("report.html", "text/html", exportAbstractMapHTML(model, { snapshotDataUrl }));
      downloadViewMetadata("bounds", area, SVG_VISIBLE_BOUNDS_PADDING);
      setStatusMessage(t("app.status.export.abstract_html"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("app.status.export.report_failed_unknown");
      setStatusMessage(t("app.status.export.report_failed", { detail: message }));
    }
  }, [
    abstractMapView,
    canvasCamera,
    document,
    focusedVisibleDocument,
    getVisibleBoundsExportArea,
    downloadViewMetadata,
    hiddenCardIdSet,
    hideSourceCards,
    summaryView,
    visibleIslandIdSet,
    safeMode,
    includeUnreviewedDraftsInExport,
    runTenantScopedOptionalTask,
  ]);

  const getSvgExportFilename = useCallback((mode: "viewport" | "visible-bounds") => {
    const date = new Date().toISOString().slice(0, 10);
    return `sui-sensemaking-${date}-${mode}.svg`;
  }, [abstractMapView, summaryView]);

  const getPngExportFilename = useCallback(
    (mode: "viewport" | "visible-bounds", scale: PngExportScale) => {
      const date = new Date().toISOString().slice(0, 10);
      const scaleSuffix = scale === 2 ? "@2x" : "";
      return `sui-sensemaking-${date}-${mode}${scaleSuffix}.png`;
    },
    []
  );

  const handleExportSvgViewport = useCallback(() => {
    if (!document || !focusedVisibleDocument || !canvasCamera) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const area = {
      x: (-canvasCamera.panX) / canvasCamera.zoom,
      y: (-canvasCamera.panY) / canvasCamera.zoom,
      w: canvasCamera.viewportWidth / canvasCamera.zoom,
      h: canvasCamera.viewportHeight / canvasCamera.zoom,
    };

    if (area.w <= 0 || area.h <= 0) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const svg = exportCanvasToSVG({
      doc: focusedVisibleDocument,
      viewState: {
        visibleIslandIds: visibleIslandIdSet,
        hiddenCardIds: hiddenCardIdSet,
        hideSourceCards: hideSourceCards || summaryView || abstractMapView,
        summaryView,
        abstractMapView,
      },
      camera: canvasCamera,
      area,
      safeMode,
    });

    downloadTextFile(getSvgExportFilename("viewport"), "image/svg+xml", svg);
    downloadViewMetadata("viewport", area);
    setStatusMessage(t("app.status.export.svg_viewport"));
  }, [
    abstractMapView,
    canvasCamera,
    document,
    focusedVisibleDocument,
    getSvgExportFilename,
    downloadViewMetadata,
    hiddenCardIdSet,
    hideSourceCards,
    summaryView,
    visibleIslandIdSet,
    safeMode,
    includeUnreviewedDraftsInExport,
  ]);

  const handleExportSvgVisibleBounds = useCallback(() => {
    if (!document || !focusedVisibleDocument || !canvasCamera) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const visibleBounds = computeVisibleBounds(focusedVisibleDocument, {
      visibleIslandIds: visibleIslandIdSet,
      hiddenCardIds: hiddenCardIdSet,
      hideSourceCards: hideSourceCards || summaryView || abstractMapView,
      summaryView,
      abstractMapView,
    });

    if (!visibleBounds) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const area = {
      x: visibleBounds.x - SVG_VISIBLE_BOUNDS_PADDING,
      y: visibleBounds.y - SVG_VISIBLE_BOUNDS_PADDING,
      w: visibleBounds.w + SVG_VISIBLE_BOUNDS_PADDING * 2,
      h: visibleBounds.h + SVG_VISIBLE_BOUNDS_PADDING * 2,
    };

    const svg = exportCanvasToSVG({
      doc: focusedVisibleDocument,
      viewState: {
        visibleIslandIds: visibleIslandIdSet,
        hiddenCardIds: hiddenCardIdSet,
        hideSourceCards: hideSourceCards || summaryView || abstractMapView,
        summaryView,
        abstractMapView,
      },
      camera: canvasCamera,
      area,
      safeMode,
    });

    downloadTextFile(getSvgExportFilename("visible-bounds"), "image/svg+xml", svg);
    downloadViewMetadata("bounds", area, SVG_VISIBLE_BOUNDS_PADDING);
    setStatusMessage(t("app.status.export.svg_visible_bounds"));
  }, [
    abstractMapView,
    canvasCamera,
    document,
    focusedVisibleDocument,
    getSvgExportFilename,
    downloadViewMetadata,
    hiddenCardIdSet,
    hideSourceCards,
    summaryView,
    visibleIslandIdSet,
    safeMode,
    includeUnreviewedDraftsInExport,
  ]);

  const handleExportPngViewport = useCallback(async () => {
    if (!document || !focusedVisibleDocument || !canvasCamera) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const area = {
      x: (-canvasCamera.panX) / canvasCamera.zoom,
      y: (-canvasCamera.panY) / canvasCamera.zoom,
      w: canvasCamera.viewportWidth / canvasCamera.zoom,
      h: canvasCamera.viewportHeight / canvasCamera.zoom,
    };

    if (area.w <= 0 || area.h <= 0) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }


    try {
      const pngBlob = await runTenantScopedOptionalTask(() => exportCanvasToPngBlob({
        doc: focusedVisibleDocument,
        viewState: {
          visibleIslandIds: visibleIslandIdSet,
          hiddenCardIds: hiddenCardIdSet,
          hideSourceCards: hideSourceCards || summaryView || abstractMapView,
          summaryView,
          abstractMapView,
        },
        camera: canvasCamera,
        area,
        safeMode,
        scale: pngExportScale,
      }));
      if (pngBlob === undefined) {
        return;
      }
      downloadBlobFile(getPngExportFilename("viewport", pngExportScale), pngBlob);
      downloadViewMetadata("viewport", area);
      setStatusMessage(t("app.status.export.png_viewport", { scale: pngExportScale }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("app.status.export.png_failed_unknown");
      setStatusMessage(t("app.status.export.png_failed", { detail: message }));
    }
  }, [
    abstractMapView,
    canvasCamera,
    document,
    focusedVisibleDocument,
    getPngExportFilename,
    downloadViewMetadata,
    hiddenCardIdSet,
    hideSourceCards,
    pngExportScale,
    summaryView,
    visibleIslandIdSet,
    safeMode,
    includeUnreviewedDraftsInExport,
    runTenantScopedOptionalTask,
  ]);

  const handleExportPngVisibleBounds = useCallback(async () => {
    if (!document || !focusedVisibleDocument || !canvasCamera) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const visibleBounds = computeVisibleBounds(focusedVisibleDocument, {
      visibleIslandIds: visibleIslandIdSet,
      hiddenCardIds: hiddenCardIdSet,
      hideSourceCards: hideSourceCards || summaryView || abstractMapView,
      summaryView,
      abstractMapView,
    });

    if (!visibleBounds) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const area = {
      x: visibleBounds.x - SVG_VISIBLE_BOUNDS_PADDING,
      y: visibleBounds.y - SVG_VISIBLE_BOUNDS_PADDING,
      w: visibleBounds.w + SVG_VISIBLE_BOUNDS_PADDING * 2,
      h: visibleBounds.h + SVG_VISIBLE_BOUNDS_PADDING * 2,
    };


    try {
      const pngBlob = await runTenantScopedOptionalTask(() => exportCanvasToPngBlob({
        doc: focusedVisibleDocument,
        viewState: {
          visibleIslandIds: visibleIslandIdSet,
          hiddenCardIds: hiddenCardIdSet,
          hideSourceCards: hideSourceCards || summaryView || abstractMapView,
          summaryView,
          abstractMapView,
        },
        camera: canvasCamera,
        area,
        safeMode,
        scale: pngExportScale,
      }));
      if (pngBlob === undefined) {
        return;
      }
      downloadBlobFile(getPngExportFilename("visible-bounds", pngExportScale), pngBlob);
      downloadViewMetadata("bounds", area, SVG_VISIBLE_BOUNDS_PADDING);
      setStatusMessage(t("app.status.export.png_visible_bounds", { scale: pngExportScale }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("app.status.export.png_failed_unknown");
      setStatusMessage(t("app.status.export.png_failed", { detail: message }));
    }
  }, [
    abstractMapView,
    canvasCamera,
    document,
    focusedVisibleDocument,
    getPngExportFilename,
    downloadViewMetadata,
    hiddenCardIdSet,
    hideSourceCards,
    pngExportScale,
    summaryView,
    visibleIslandIdSet,
    safeMode,
    includeUnreviewedDraftsInExport,
    runTenantScopedOptionalTask,
  ]);

  const handleExportViewMetadataViewport = useCallback(() => {
    if (!canvasCamera) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    const area = {
      x: (-canvasCamera.panX) / canvasCamera.zoom,
      y: (-canvasCamera.panY) / canvasCamera.zoom,
      w: canvasCamera.viewportWidth / canvasCamera.zoom,
      h: canvasCamera.viewportHeight / canvasCamera.zoom,
    };

    if (area.w <= 0 || area.h <= 0) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    downloadViewMetadata("viewport", area);
    setStatusMessage(t("app.status.export.view_viewport"));
  }, [canvasCamera, downloadViewMetadata]);

  const handleExportViewMetadataVisibleBounds = useCallback(() => {
    const area = getVisibleBoundsExportArea();
    if (!area) {
      setStatusMessage(t("app.status.bundle.nothing_to_export"));
      return;
    }

    downloadViewMetadata("bounds", area, SVG_VISIBLE_BOUNDS_PADDING);
    setStatusMessage(t("app.status.export.view_visible_bounds"));
  }, [downloadViewMetadata, getVisibleBoundsExportArea]);

  const handleSafeModeChange = useCallback((nextValue: boolean) => {
    if (!nextValue) {
      const confirmed = window.confirm(t("app.confirm.safe_mode_off"));
      if (!confirmed) {
        return;
      }
    }

    setSafeMode(nextValue);
    if (nextValue) {
      setIncludeUnreviewedDraftsInExport(false);
    }
  }, [abstractMapView, summaryView]);

  const captureCurrentViewPatch = useCallback((): ViewPatch => ({
    hierarchyLevel,
    summaryView,
    abstractMapView,
    hideSourceCards,
    maxDepth,
    focusIslandId: focusTarget.focusIslandId ?? null,
    showReadingOrder,
    readingNavEnabled,
    readingMode,
    reviewedOnly,
    collapsedIslandIds: [...collapsedIslandIds].sort(),
    safeMode,
    lodEnabled,
    perspectiveMode,
    perspectiveStrictFilter,
  }), [
    abstractMapView,
    collapsedIslandIds,
    focusTarget.focusIslandId,
    hideSourceCards,
    hierarchyLevel,
    lodEnabled,
    maxDepth,
    perspectiveMode,
    perspectiveStrictFilter,
    readingMode,
    readingNavEnabled,
    reviewedOnly,
    safeMode,
    showReadingOrder,
    summaryView,
  ]);

  const applyViewPatch = useCallback((viewPatch: ViewPatch) => {
    const nextVisibility = resolveSummaryAbstractFromPatch({ summaryView, abstractMapView }, viewPatch);
    setSummaryView(nextVisibility.summaryView);
    setAbstractMapView(nextVisibility.abstractMapView);

    if (viewPatch.hideSourceCards !== undefined) setHideSourceCards(viewPatch.hideSourceCards);
    if (viewPatch.hierarchyLevel !== undefined) handleHierarchyLevelChange(viewPatch.hierarchyLevel);
    if (viewPatch.maxDepth !== undefined) setMaxDepth(viewPatch.maxDepth);
    if (viewPatch.focusIslandId !== undefined) setFocusTarget(viewPatch.focusIslandId ? { focusIslandId: viewPatch.focusIslandId } : {});
    if (viewPatch.showReadingOrder !== undefined) setShowReadingOrder(viewPatch.showReadingOrder);
    if (viewPatch.readingNavEnabled !== undefined) setReadingNavEnabled(viewPatch.readingNavEnabled);
    if (viewPatch.readingMode !== undefined) setReadingMode(viewPatch.readingMode);
    if (viewPatch.reviewedOnly !== undefined) setReviewedOnly(viewPatch.reviewedOnly);
    if (viewPatch.collapsedIslandIds !== undefined) setCollapsedIslandIds(new Set(viewPatch.collapsedIslandIds));
    if (viewPatch.safeMode !== undefined) {
      setSafeMode(viewPatch.safeMode);
      if (viewPatch.safeMode) {
        setIncludeUnreviewedDraftsInExport(false);
      }
    }
    if (viewPatch.lodEnabled !== undefined) setLodEnabled(viewPatch.lodEnabled);
    if (viewPatch.perspectiveMode !== undefined) setPerspectiveMode(viewPatch.perspectiveMode);
    if (viewPatch.perspectiveStrictFilter !== undefined) setPerspectiveStrictFilter(viewPatch.perspectiveStrictFilter);
  }, [abstractMapView, handleHierarchyLevelChange, summaryView]);

  const handleApplyViewMode = useCallback((mode: ViewMode, options?: { announce?: boolean }) => {
    const presetId = getPresetIdForViewMode(mode);
    const preset = viewPresets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    applyViewPatch(preset.viewPatch);
    const currentLocale = getActiveLocale();
    if (!isReadOnly) {
      appStorage.saveViewLocaleForDocumentView(activeDocumentId, viewMode, currentLocale);
    }
    setViewMode(mode);
    applyResolvedLocaleForView({
      docId: activeDocumentId,
      viewMode: mode,
      persistedLocale: appStorage.loadViewLocaleForDocumentView(activeDocumentId, mode),
    });
    setActivePresetId(preset.id);
    if (preset.id === "default-review") {
      setSafeMode(true);
      setIncludeUnreviewedDraftsInExport(false);
    }
    if (options?.announce ?? true) {
      setStatusMessage(t("app.status.applied_mode", { mode: getViewModeDisplayLabel(mode) }));
    }
  }, [activeDocumentId, appStorage, applyResolvedLocaleForView, applyViewPatch, isReadOnly, viewMode, viewPresets]);

  const handleSaveViewPreset = useCallback(() => {
    const name = window.prompt(t("view_controls.perspective.prompt_name"), t("view_controls.perspective.prompt_default_name"))?.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const nextPreset: ViewPreset = {
      id: `preset-${Date.now().toString(36)}`,
      name,
      viewPatch: captureCurrentViewPatch(),
      createdAt: now,
      updatedAt: now,
    };
    setViewPresets((previous) => migrateViewPresets(replaceViewPreset(previous, nextPreset)));
    setActivePresetId(nextPreset.id);
    setStatusMessage(t("app.status.saved_preset", { name }));
  }, [captureCurrentViewPatch]);

  const handleApplyViewPreset = useCallback((presetId: string) => {
    const preset = viewPresets.find((item) => item.id === presetId);
    if (!preset) return;
    applyViewPatch(preset.viewPatch);
    setActivePresetId(preset.id);
    const mode = getViewModeForPresetId(preset.id);
    if (mode) {
      setViewMode(mode);
    }
    if (preset.id === "default-review") {
      setSafeMode(true);
      setIncludeUnreviewedDraftsInExport(false);
    }
    setStatusMessage(t("app.status.applied_preset", { name: preset.name }));
  }, [applyViewPatch, viewPresets]);

  const handleRenameViewPreset = useCallback((presetId: string) => {
    const target = viewPresets.find((preset) => preset.id === presetId);
    if (!target) return;
    const nextName = window.prompt(t("view_controls.perspective.prompt_rename"), target.name)?.trim();
    if (!nextName) return;
    setViewPresets((previous) => renameViewPreset(previous, presetId, nextName, new Date().toISOString()));
    setStatusMessage(t("app.status.renamed_preset", { name: nextName }));
  }, [viewPresets]);

  const handleDeleteViewPreset = useCallback((presetId: string) => {
    const target = viewPresets.find((preset) => preset.id === presetId);
    if (!target) return;
    if (presetId.startsWith("default-")) {
      setStatusMessage(t("app.status.default_preset_cannot_delete", { name: target.name }));
      return;
    }
    if (!window.confirm(t("view_controls.perspective.confirm_delete", { name: target.name }))) return;
    setViewPresets((previous) => removeViewPreset(previous, presetId));
    setActivePresetId((current) => (current === presetId ? null : current));
    setStatusMessage(t("app.status.deleted_preset", { name: target.name }));
  }, [viewPresets]);

  useEffect(() => {
    handleApplyViewMode(viewMode, { announce: false });
  }, [handleApplyViewMode, viewMode]);

  useEffect(() => {
    appStorage.saveViewModeForDocument(activeDocumentId, viewMode);
  }, [activeDocumentId, appStorage, viewMode]);

  useEffect(() => {
    viewLocalePersistenceScopeRef.current.updateScope({ docId: activeDocumentId, viewMode, allowPersistence: !isReadOnly });
  }, [activeDocumentId, isReadOnly, viewMode]);

  useEffect(() => {
    if (!activeDocumentId) {
      return;
    }

    appStorage.saveViewVisibilityForDocument(activeDocumentId, {
      viewVisibility,
      packVisibility,
    });
  }, [activeDocumentId, appStorage, packVisibility, viewVisibility]);

  useEffect(() => {
    const unsubscribe = subscribeActiveLocaleChange((locale) => {
      const scope = viewLocalePersistenceScopeRef.current.getScope();
      if (!scope.allowPersistence) {
        return;
      }

      appStorage.saveViewLocaleForDocumentView(scope.docId, scope.viewMode, locale);
    });

    return unsubscribe;
  }, [appStorage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableHotkeyTarget(event.target)) {
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        handleApplyViewMode("explore");
        return;
      }

      if (event.key === "2") {
        event.preventDefault();
        handleApplyViewMode("review");
        return;
      }

      if (event.key === "3") {
        event.preventDefault();
        handleApplyViewMode("summary");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleApplyViewMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableHotkeyTarget(event.target)) {
        return;
      }

      if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) {
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        handleHierarchyLevelChange("overview");
        return;
      }

      if (event.key === "2") {
        event.preventDefault();
        handleHierarchyLevelChange("mid");
        return;
      }

      if (event.key === "3") {
        event.preventDefault();
        handleHierarchyLevelChange("detail");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleHierarchyLevelChange]);

  const safeModeIndicator = getSafeModeIndicator(safeMode);
  const viewControlsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewControlsPanelRef = useRef<HTMLDivElement | null>(null);

  // Shared by the flat trigger button and the "表示" menu item (UX-MENU-01)
  // so both call the exact same toggle — no duplicated open/close logic.
  const handleToggleViewControls = useCallback(() => {
    setIsSharePanelOpen(false);
    setIsViewControlsOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (!isViewControlsOpen) {
      return;
    }

    // OPS-LLM-COST-03: counters are in-process operational state, not static
    // configuration. Refresh when the user opens this read-only surface so a
    // call made after startup is not misleadingly shown as zero until reload.
    void getProviderStatus()
      .then(({ providerKind: kind, callCounts, tokenUsage }) => {
        setProviderKind(kind);
        setLlmCallCounts(callCounts);
        setLlmTokenUsage(tokenUsage);
      })
      .catch(() => {
        // Keep the last known display-only snapshot on a refresh failure.
      });

    const frame = window.requestAnimationFrame(() => {
      viewControlsPanelRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isViewControlsOpen]);

  const headerViewControls = (
    <div
      data-ui-complexity-tier="core-view"
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap", whiteSpace: "nowrap" }}
    >
      <button
        type="button"
        onClick={() => {
          setIsViewControlsOpen(false);
          setIsSharePanelOpen(true);
        }}
        title={safeModeIndicator.detail}
        style={{
          border: safeModeIndicator.tone === "safe" ? "1px solid #86efac" : "1px solid #fdba74",
          backgroundColor: safeModeIndicator.tone === "safe" ? "#f0fdf4" : "#fff7ed",
          color: safeModeIndicator.tone === "safe" ? "#166534" : "#9a3412",
          borderRadius: 999,
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {safeModeIndicator.label}
      </button>
      <div style={{ display: "inline-flex", border: "1px solid #cbd5e1", borderRadius: 6, overflow: "hidden", backgroundColor: "#ffffff" }}>
        {(["explore", "review", "summary"] as const).map((mode) => {
          const isActive = viewMode === mode;
          const shortcutLabel = mode === "explore" ? "⌘/Ctrl+1" : mode === "review" ? "⌘/Ctrl+2" : "⌘/Ctrl+3";
          return (
            <button
              key={mode}
              type="button"
              onClick={() => {
                handleApplyViewMode(mode);
              }}
              title={`${getViewModeDisplayLabel(mode)} (${shortcutLabel})`}
              aria-pressed={isActive}
              style={{
                border: "none",
                borderRight: mode === "summary" ? "none" : "1px solid #cbd5e1",
                backgroundColor: isActive ? "#e0e7ff" : "#ffffff",
                color: isActive ? "#1d4ed8" : "#0f172a",
                padding: "4px 10px",
                fontSize: 12,
                fontWeight: isActive ? 700 : 600,
                cursor: "pointer",
              }}
            >
              {getViewModeDisplayLabel(mode)}
            </button>
          );
        })}
      </div>
      <button
        ref={viewControlsTriggerRef}
        data-focus-return-id="view-controls-trigger"
        type="button"
        onClick={handleToggleViewControls}
        style={{
          border: "1px solid #cbd5e1",
          backgroundColor: "#ffffff",
          color: "#0f172a",
          borderRadius: 6,
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t("view_controls.trigger")}
      </button>
      {isViewControlsOpen ? (
        <div
          ref={viewControlsPanelRef}
          data-panel="view"
          role="dialog"
          aria-label={t("view_controls.trigger")}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setIsViewControlsOpen(false);
              window.requestAnimationFrame(() => {
                viewControlsTriggerRef.current?.focus();
              });
            }
          }}
          style={{
            position: "fixed",
            top: "var(--sui-sensemaking-header-panel-top, 72px)",
            left: 16,
            zIndex: 50,
            maxHeight: "calc(100vh - var(--sui-sensemaking-header-panel-top, 72px) - 16px)",
            overflowY: "auto",
          }}
        >
          <ViewControlsPanel
            focusIslandId={focusTarget.focusIslandId}
            onClearFocus={handleClearFocus}
            onApplyBirdsEyePreset={handleApplyBirdsEyePreset}
            onApplyMidPreset={handleApplyMidPreset}
            onApplyDetailPreset={handleApplyDetailPreset}
            hierarchyLevel={hierarchyLevel}
            onHierarchyLevelChange={handleHierarchyLevelChange}
            onResetView={handleResetView}
            maxDepth={maxDepth}
            maxAvailableDepth={maxAvailableDepth}
            onMaxDepthChange={setMaxDepth}
            hideSourceCards={hideSourceCards}
            onHideSourceCardsChange={setHideSourceCards}
            hideMergedOriginals={hideMergedOriginals}
            onHideMergedOriginalsChange={setHideMergedOriginals}
            summaryView={summaryView}
            onSummaryViewChange={setSummaryView}
            abstractMapView={abstractMapView}
            onAbstractMapViewChange={(nextValue) => {
              setAbstractMapView(nextValue);
              if (nextValue) {
                setSummaryView(true);
              }
            }}
            showReadingOrder={showReadingOrder}
            onShowReadingOrderChange={(nextValue) => {
              setShowReadingOrder(nextValue);
              if (!nextValue) {
                setIsReadingOrderEditMode(false);
              }
            }}
            isReadingOrderEditMode={isReadingOrderEditMode}
            onReadingOrderEditModeChange={setIsReadingOrderEditMode}
            onExportAbstractMapMarkdownWithPng={() => {
              void handleExportAbstractMapMarkdownWithPng();
            }}
            onExportAbstractMapHtmlWithPng={() => {
              void handleExportAbstractMapHtmlWithPng();
            }}
            onExportSvgViewport={handleExportSvgViewport}
            onExportSvgVisibleBounds={handleExportSvgVisibleBounds}
            pngExportScale={pngExportScale}
            onPngExportScaleChange={setPngExportScale}
            onExportPngViewport={() => {
              void handleExportPngViewport();
            }}
            onExportPngVisibleBounds={() => {
              void handleExportPngVisibleBounds();
            }}
            onLoadViewMetadataFile={(file) => {
              void handleLoadViewMetadataFile(file);
            }}
            safeMode={safeMode}
            onSafeModeChange={handleSafeModeChange}
            emptyCanvasHintCompleted={emptyCanvasHintCompleted}
            onResetEmptyCanvasHint={handleResetEmptyCanvasHint}
            isCanvasLegendOpen={isCanvasLegendOpen}
            onToggleCanvasLegend={() => setIsCanvasLegendOpen((previous) => !previous)}
            showProtectionMarks={showProtectionMarks}
            onToggleProtectionMarks={() => setShowProtectionMarks((previous) => !previous)}
            showSeqNumbers={showSeqNumbers}
            onShowSeqNumbersChange={setShowSeqNumbers}
            providerKind={providerKind}
            llmCallCounts={llmCallCounts}
            llmTokenUsage={llmTokenUsage}
            lastAiCallOutcome={lastAiCallOutcome}
            lodEnabled={lodEnabled}
            onLodEnabledChange={setLodEnabled}
            lodThresholds={lodThresholds}
            onLodThresholdsChange={setLodThresholds}
            currentLodLevel={currentLod?.level ?? null}
            lodShowLoneWolvesWhenFar={lodShowLoneWolvesWhenFar}
            onLodShowLoneWolvesWhenFarChange={setLodShowLoneWolvesWhenFar}
            showLabelBounds={showLabelBounds}
            onShowLabelBoundsChange={setShowLabelBounds}
            evidenceOverlayEnabled={evidenceOverlayEnabled}
            onEvidenceOverlayEnabledChange={setEvidenceOverlayEnabled}
            evidenceOverlayMode={evidenceOverlayMode}
            onEvidenceOverlayModeChange={setEvidenceOverlayMode}
            evidenceOverlayDepth={evidenceOverlayDepth}
            onEvidenceOverlayDepthChange={(value) => {
              setEvidenceOverlayDepth(Math.max(1, Math.min(3, Math.floor(value))));
            }}
            evidenceOverlayScope={evidenceOverlayScope}
            onEvidenceOverlayScopeChange={setEvidenceOverlayScope}
            evidenceOverlayDimOthers={evidenceOverlayDimOthers}
            onEvidenceOverlayDimOthersChange={setEvidenceOverlayDimOthers}
            perspectiveMode={perspectiveMode}
            onPerspectiveModeChange={setPerspectiveMode}
            perspectiveStrictFilter={perspectiveStrictFilter}
            onPerspectiveStrictFilterChange={setPerspectiveStrictFilter}
            viewPresets={viewPresets}
            activePresetId={activePresetId}
            onSaveViewPreset={handleSaveViewPreset}
            onApplyViewPreset={handleApplyViewPreset}
            onRenameViewPreset={handleRenameViewPreset}
            onDeleteViewPreset={handleDeleteViewPreset}
            perspectiveHint={perspectiveHint}
          />
        </div>
      ) : null}
    </div>
  );

  const controllerAbortDiff = () => {
    const controller = diffAbortRef.current;
    if (controller) {
      controller.abort();
    }
  };

  const structuralDiffPanel = (
    <ReviewDiffPanel
      comparisonFileName={comparisonFileName}
      comparisonDocument={comparisonDocument}
      mergeItems={mergeItems}
      evaluations={mergeEvaluation.evaluations}
      selectedItemIds={selectedMergeItemIdSet}
      autoIncludePrerequisites={autoIncludeMergePrerequisites}
      onLoadComparisonDocument={handleLoadComparisonDocumentClick}
      onToggleAutoIncludePrerequisites={setAutoIncludeMergePrerequisites}
      onItemCheckedChange={(itemId, checked) => {
        setSelectedMergeItemIdSet((previous) => {
          const next = new Set(previous);
          if (checked) {
            next.add(itemId);
          } else {
            next.delete(itemId);
          }
          return next;
        });
      }}
      onGroupCheckedChange={(group, checked) => {
        setSelectedMergeItemIdSet((previous) => {
          const next = new Set(previous);
          for (const item of mergeItems) {
            if (!item.kind.startsWith(`${group}.`)) {
              continue;
            }
            if (checked) {
              next.add(item.id);
            } else {
              next.delete(item.id);
            }
          }
          return next;
        });
      }}
      onApplySelected={handleApplySelectedMergeItems}
      onUndoLastMerge={handleUndoLastMerge}
      canApply={Boolean(document && comparisonDocument && mergeEvaluation.selectedIdsWithPrerequisites.size > 0 && !mergeEvaluation.evaluations.some((entry) => mergeEvaluation.selectedIdsWithPrerequisites.has(entry.item.id) && entry.status !== "ok"))}
      isComputingDiff={isDiffComputing}
      onCancelDiff={() => controllerAbortDiff()}
      computeProgressMessage={computeProgressMessage}
      computeProgressPercent={computeProgressPercent}
      isFallbackMode={isDiffFallbackMode}
    />
  );

  const hilRsStubClient = useMemo(() => createHilRsClient(), []);

  const hilRsCritiqueInputs = useMemo(() => {
    if (!document) {
      return [];
    }

    return hilRsStubClient.collectCritiqueInputs({
      document,
      iteration: suggestionIteration,
      createdAt: new Date().toISOString(),
    });
  }, [document, hilRsStubClient, suggestionIteration]);

  const hilRsRediffPreviewPayload = useMemo(() => {
    if (!document || !suggestedDocument || !suggestionId) {
      return null;
    }

    return hilRsStubClient.previewRediff({
      currentDocument: document,
      suggestedDocument,
      suggestionId,
      iteration: suggestionIteration,
      critiqueInputs: hilRsCritiqueInputs,
    });
  }, [document, hilRsCritiqueInputs, hilRsStubClient, suggestedDocument, suggestionId, suggestionIteration]);

  const domainExpressionShareSummary = useMemo(() => buildDomainExpressionShareSummary(document), [document]);

  const headerShareControls = (
    <LazyPanelBoundary>
    <SharePanel
      isOpen={isSharePanelOpen}
      isAdvancedUiEnabled={isAdvancedUiEnabled}
      onToggleOpen={handleToggleSharePanel}
      hasDocument={Boolean(document)}
      isLoading={isLoading}
      isReadOnly={isReadOnly}
      onExportSvgViewport={handleExportSvgViewport}
      onExportSvgVisibleBounds={handleExportSvgVisibleBounds}
      pngExportScale={pngExportScale}
      onPngExportScaleChange={setPngExportScale}
      onExportPngViewport={() => {
        void handleExportPngViewport();
      }}
      onExportPngVisibleBounds={() => {
        void handleExportPngVisibleBounds();
      }}
      onExportAbstractMapMarkdownWithPng={() => {
        void handleExportAbstractMapMarkdownWithPng();
      }}
      onExportAbstractMapHtmlWithPng={() => {
        void handleExportAbstractMapHtmlWithPng();
      }}
      safeMode={safeMode}
      viewVisibility={viewVisibility}
      packVisibility={packVisibility}
      onViewVisibilityChange={setViewVisibility}
      onPackVisibilityChange={setPackVisibility}
      onSafeModeChange={handleSafeModeChange}
      includeUnreviewedDrafts={includeUnreviewedDraftsInExport}
      onIncludeUnreviewedDraftsChange={setIncludeUnreviewedDraftsInExport}
      includeSourceReferences={includeSourceReferencesInExport}
      onIncludeSourceReferencesChange={setIncludeSourceReferencesInExport}
      currentReviewerRef={currentReviewerRef}
      currentReviewerRefSource={currentReviewerRefSource}
      onCurrentReviewerRefChange={(value) => {
        const next = appStorage.saveCurrentReviewerRef(value);
        setCurrentReviewerRef(next);
      }}
      onResetCurrentReviewerRef={() => {
        const next = appStorage.saveCurrentReviewerRef(buildLocalReviewerRef());
        setCurrentReviewerRef(next);
      }}
      onExportViewViewport={handleExportViewMetadataViewport}
      onExportViewVisibleBounds={handleExportViewMetadataVisibleBounds}
      portableVisualCueCount={document ? collectPortableVisualCueImageRefs(document).length : 0}
      onExportBundleZip={(options) => {
        void handleExportBundleZip(options);
      }}
      isBundleExportRunning={isBundleExportRunning}
      onCancelBundleExport={() => { bundleRunnerRef.current.cancel(); bundleAbortRef.current?.abort(); }}
      computeProgressMessage={computeProgressMessage}
      canIncludeTraces={Boolean(selectedCard)}
      domainExpressionSummary={domainExpressionShareSummary}
      onLoadViewMetadataFile={(file) => {
        void handleLoadViewMetadataFile(file);
      }}
      onLoadDocumentFile={(file) => {
        void handleLoadDocumentFile(file);
      }}
      onImportReviewPackFile={(file) => {
        void handleImportReviewPackFile(file);
      }}
      onInvalidReviewPackFileType={handleInvalidReviewPackFileType}
      packImportError={packImportError}
      importedPackSummary={importedPackSummary}
      pendingImportedDocumentSummary={
        pendingImportedDocument
          ? {
              fileName: pendingImportedDocument.fileName,
              cardCount: pendingImportedDocument.document.cards.length,
              islandCount: pendingImportedDocument.document.islands.length,
              edgeCount: pendingImportedDocument.document.edges.length,
            }
          : null
      }
      importDocumentError={importDocumentError}
      onReplaceCurrentDocument={handleReplaceCurrentDocument}
      onLoadPatchFile={(file) => {
        void handleLoadPatchFile(file);
      }}
      onLoadPatchBaselineFile={(file) => {
        void handleLoadPatchBaselineFile(file);
      }}
      onExportPatchFile={() => {
        void handleExportPatchFile();
      }}
      patchExportAuthor={patchExportAuthor}
      patchExportAuthorNote={patchExportAuthorNote}
      onPatchExportAuthorChange={setPatchExportAuthor}
      onPatchExportAuthorNoteChange={setPatchExportAuthorNote}
      patchTrustLabel={patchTrustLabel}
      onPatchTrustLabelChange={setPatchTrustLabel}
      patchFingerprintStatus={patchFingerprintStatus}
      patchFileName={pendingPatchImport?.fileName ?? null}
      patchImportError={patchImportError}
      patchConflictWarning={patchConflictWarning}
      patchSummary={patchSummary}
      onCopyPatchSummary={() => {
        void handleCopyPatchSummary();
      }}
      patchPreviewItems={patchPreviewItems}
      onPatchItemCheckedChange={(opId, checked) => {
        setPatchSelectedOpIdSet((previous) => {
          const next = new Set(previous);
          if (checked) {
            next.add(opId);
          } else {
            next.delete(opId);
          }
          return next;
        });
      }}
      onConflictResolutionChange={(opId, resolution) => {
        setPatchResolutionsByOpId((previous) => ({
          ...previous,
          [opId]: resolution,
        }));
      }}
      onApplyPatch={handleApplyPatch}
      canApplyPatch={canApplyPatch}
      hasPatchSelection={hasPatchSelection}
      patchLintIssues={patchLintResult?.issues ?? []}
      fixProposals={patchFixProposals}
      selectedFixProposalIds={selectedFixProposalIdSet}
      onFixProposalCheckedChange={handleFixProposalCheckedChange}
      onApplySelectedFixes={handleApplySelectedPatchFixes}
      onResetPatchToOriginal={handleResetPatchToOriginal}
      patchBaselineFileName={patchBaselineFileName}
      patchApplyLogEntries={document?.patchApplyLog ?? []}
      onCopyPatchApplyLogEntry={(entryId) => {
        void handleCopyPatchApplyLogEntry(entryId);
      }}
      structuralDiffSection={structuralDiffPanel}
    />
    </LazyPanelBoundary>
  );

  // UX-MENU-01 (ADR-0048 D2, collapse-layer 3): every item below delegates to
  // an EXISTING handler already used elsewhere in this file (toolbar button,
  // ViewControlsPanel/SharePanel prop, or hotkey). No new business logic is
  // introduced here. Items with no real handler today (relation-line drawing,
  // island dissolve, "tidy" layout, minimap, first-time guide, CSV export,
  // select-all) are intentionally omitted per the issue's non-goal of adding
  // no new commands; ViewControlsPanel/SharePanel's own deeper controls
  // (legend toggle, visibility scope, review-pack export options) stay inside
  // those panels — duplicating them here would need a second, independent
  // focus-return anchor and risk regressing AC-5's existing contracts.
  const claimTypeMenuRows: MenuRowDef[] = (["fact", "claim", "hypothesis", "unknown"] as ClaimType[]).map((claimType) => ({
    kind: "item",
    item: {
      id: `card-claim-type-${claimType}`,
      label: t(`side_panel.claim_type.${claimType}`),
      disabled: !selectedCard,
      checked: selectedCard ? selectedCard.claimType === claimType || (!selectedCard.claimType && claimType === "unknown") : false,
      run: () => {
        if (selectedCard) {
          handleCardClaimTypeChange(selectedCard.id, claimType);
        }
      },
    },
  }));

  const menuCategories: MenuCategoryDef[] = [
    {
      id: "file",
      label: t("menu_bar.category.file"),
      rows: [
        {
          kind: "item",
          item: { id: "file-new", label: t("app.toolbar.new"), disabled: isReadOnly || isLoading || isSaving, run: handleNewDocument },
        },
        {
          kind: "item",
          item: {
            id: "file-open-recent",
            label: t("menu_bar.file.open_recent"),
            disabled: isLoading,
            run: () => {
              // MenuBar already focuses the "File" top-level button before
              // calling run() (see MenuBar.tsx's runRow) -- capture it here
              // as this dialog's return-focus target rather than plumbing a
              // new ref out of MenuBar for a single caller.
              recentDocumentsDialogTriggerRef.current = window.document.activeElement as HTMLElement | null;
              setIsRecentDocumentsDialogOpen(true);
            },
          },
        },
        {
          kind: "item",
          item: {
            id: "file-save",
            label: t("app.toolbar.save"),
            disabled: isReadOnly || isLoading || !document || isSaving || !isDirty,
            run: () => {
              void handleSave();
            },
          },
        },
        { kind: "header", label: t("menu_bar.group.export") },
        {
          kind: "item",
          item: {
            id: "file-export-legacy",
            label: t("app.toolbar.export_doc_json_legacy_short"),
            disabled: isReadOnly || isLoading || !document,
            run: handleExport,
          },
        },
        {
          kind: "item",
          item: { id: "file-export-svg-viewport", label: t("view_controls.export_legacy.svg_viewport"), run: handleExportSvgViewport },
        },
        {
          kind: "item",
          item: { id: "file-export-svg-visible", label: t("view_controls.export_legacy.svg_visible"), run: handleExportSvgVisibleBounds },
        },
        {
          kind: "item",
          item: {
            id: "file-export-abstract-md",
            label: t("view_controls.export_legacy.abstract_map_md"),
            run: () => {
              void handleExportAbstractMapMarkdownWithPng();
            },
          },
        },
        {
          kind: "item",
          item: {
            id: "file-export-abstract-html",
            label: t("view_controls.export_legacy.abstract_map_html"),
            run: () => {
              void handleExportAbstractMapHtmlWithPng();
            },
          },
        },
        { kind: "header", label: t("menu_bar.group.import") },
        {
          kind: "item",
          item: {
            id: "file-import-legacy",
            label: t("app.toolbar.import_doc_json_legacy_short"),
            disabled: isReadOnly || isLoading,
            run: handleImportClick,
          },
        },
      ],
    },
    {
      id: "edit",
      label: t("menu_bar.category.edit"),
      rows: [
        {
          kind: "item",
          item: {
            id: "edit-undo",
            label: t("app.toolbar.undo"),
            shortcutHint: formatModShortcut("Z"),
            disabled: isReadOnly || isLoading || !document || !canUndo,
            run: handleUndo,
          },
        },
        {
          kind: "item",
          item: {
            id: "edit-redo",
            label: t("app.toolbar.redo"),
            shortcutHint: formatModShortcut("Y"),
            disabled: isReadOnly || isLoading || !document || !canRedo,
            run: handleRedo,
          },
        },
        {
          kind: "item",
          item: {
            id: "edit-duplicate",
            label: t("app.toolbar.duplicate"),
            disabled: isReadOnly || isLoading || isSaving || !document,
            run: handleDuplicateDocument,
          },
        },
        {
          kind: "item",
          item: {
            id: "edit-delete-selection",
            label: t("app.toolbar.delete_selection"),
            shortcutHint: "Delete",
            disabled: isReadOnly || isLoading || !document || (selectedCardIds.length === 0 && !selectedIslandId),
            run: handleDeleteSelection,
          },
        },
      ],
    },
    {
      id: "card",
      label: t("menu_bar.category.card"),
      rows: [
        {
          kind: "item",
          item: {
            id: "card-new",
            label: t("app.toolbar.new_card"),
            disabled: isReadOnly || isLoading || !document,
            run: handleAddCard,
          },
        },
        {
          kind: "item",
          item: {
            id: "card-create-island",
            label: t("app.toolbar.create_island"),
            disabled: isReadOnly || isLoading || !document || !canCreateIsland,
            run: handleCreateIsland,
          },
        },
        { kind: "header", label: t("menu_bar.group.claim_type") },
        ...claimTypeMenuRows,
      ],
    },
    {
      id: "view",
      label: t("menu_bar.category.view"),
      rows: [
        {
          kind: "item",
          item: { id: "view-open-panel", label: t("menu_bar.view.open_panel"), run: handleToggleViewControls },
        },
        {
          kind: "item",
          item: { id: "view-birds-eye", label: t("menu_bar.view.fit_to_view"), run: handleApplyBirdsEyePreset },
        },
        { kind: "item", item: { id: "view-reset-zoom", label: t("menu_bar.view.reset_zoom"), run: handleResetView } },
        {
          kind: "item",
          item: {
            id: "view-reading-order",
            label: t("view_controls.reading_order.show"),
            checked: showReadingOrder,
            run: () => {
              const next = !showReadingOrder;
              setShowReadingOrder(next);
              if (!next) {
                setIsReadingOrderEditMode(false);
              }
            },
          },
        },
        { kind: "header", label: t("menu_bar.group.help") },
        {
          kind: "item",
          item: {
            id: "view-shortcut-cheatsheet",
            label: t("shortcut_cheatsheet.title"),
            shortcutHint: "?",
            run: () => {
              shortcutCheatsheetReturnFocusRef.current =
                window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
              setIsShortcutCheatsheetOpen(true);
            },
          },
        },
      ],
    },
    {
      id: "work",
      label: t("menu_bar.category.work"),
      rows: [
        { kind: "item", item: { id: "work-open-panel", label: t("work_mode.title"), run: handleToggleWorkMode } },
      ],
    },
    {
      id: "share",
      label: t("menu_bar.category.share"),
      rows: [
        {
          kind: "item",
          item: { id: "share-open-panel", label: t("share.panel.trigger"), run: handleToggleSharePanel },
        },
        {
          kind: "item",
          item: {
            id: "share-safe-mode",
            label: t("view_controls.safety.safe_mode"),
            checked: safeMode,
            run: () => handleSafeModeChange(!safeMode),
          },
        },
      ],
    },
  ];

  const workModeTabDescriptionStyle = { fontSize: 11, color: "#475569", marginBottom: 8 } as const;

  const advancedWorkModeContent = (
    <WorkModeTabs
      tabs={[
        {
          id: "diff",
          label: t("work_mode.tab.diff"),
          content: (
            <>
              <div style={workModeTabDescriptionStyle}>{t("hil_rs_workflow.diff.description")}</div>
              <HilRsRediffPreview payload={hilRsRediffPreviewPayload} />
              {structuralDiffPanel}
            </>
          ),
        },
        {
          id: "merge",
          label: t("work_mode.tab.merge"),
          content: (
            <>
              <div style={workModeTabDescriptionStyle}>{t("hil_rs_workflow.candidate.description")}</div>
              <MergeSuggestionsPanel
                isReadOnly={isReadOnly}
                instruction={mergeSuggestionInstruction}
                onInstructionChange={setMergeSuggestionInstruction}
                onSuggest={() => {
                  void handleSuggestMerges();
                }}
                isSuggesting={isSuggestingMerges}
                errorMessage={mergeSuggestionError}
                suggestions={mergeSuggestions}
                cardsById={cardsById}
                onMergedTextChange={handleMergeSuggestionTextChange}
                onDecide={handleRecordMergeSuggestionDecision}
                onApplyAccepted={handleApplyRecordedMergeSuggestion}
                latestAuditEventByGroup={latestMergeDecisionAuditByGroup}
                auditEvents={mergeDecisionAuditEvents}
                onExportAuditEvents={handleExportMergeDecisionAuditEvents}
              />
              <LazyPanelBoundary>
              <PatchWorkspacePanel
                isReadOnly={isReadOnly}
                storageScope={appStorage.scope}
                candidates={mergeSuggestions.map((suggestion) => ({
                  id: suggestion.groupId,
                  label: t("patch_workspace.candidate_label", {
                    id: suggestion.groupId,
                    count: suggestion.cardIds.length,
                  }),
                  note: suggestion.rationale,
                  preview: {
                    sourceSnippets: suggestion.cardIds.map((cardId) => cardsById.get(cardId)?.text ?? `[missing:${cardId}]`),
                    draftText: suggestion.mergedTextDraft,
                    editedText: suggestion.editedText,
                  },
                }))}
                onDecisionCommitted={({ candidateId, decision, previousDecision }) => {
                  setStatusMessage(t("patch_workspace.status.decision", {
                    candidateId,
                    previousDecision: getWorkspaceDecisionDisplayLabel(previousDecision),
                    decision: getWorkspaceDecisionDisplayLabel(decision),
                  }));
                }}
                onDecisionRolledBack={({ restoredCandidateIds }) => {
                  setStatusMessage(t("patch_workspace.status.rollback_restored", { ids: restoredCandidateIds.join(", ") }));
                }}
                onPresetSaved={(preset) => {
                  setStatusMessage(t("patch_workspace.status.preset_saved", { name: preset.name }));
                }}
                onPresetExecuted={({ scope, depth, filters }) => {
                  setStatusMessage(t("patch_workspace.status.preset_executed", {
                    scope: getWorkspaceScopeDisplayLabel(scope),
                    depth,
                    filters: filters.length > 0 ? filters.join(", ") : t("patch_workspace.no_filters"),
                  }));
                }}
              />
              </LazyPanelBoundary>
            </>
          ),
        },
        {
          id: "suggestion",
          label: t("work_mode.tab.suggestion"),
          content: (
            // data-domain-workflow: cross-navigation focus target for
            // SidePanel's "Review reproposal" link (handleOpenCritiqueWorkflow
            // below) -- tabIndex=-1 only, no separate aria-labelledby: the
            // enclosing tabpanel already provides this content's accessible
            // name via its own aria-labelledby (work-mode-tab-suggestion).
            <div data-domain-workflow="critique-reproposal" tabIndex={-1}>
              <div style={workModeTabDescriptionStyle}>{t("hil_rs_workflow.critique.description")}</div>
              <SuggestionPanel
                isReadOnly={isReadOnly}
                instruction={suggestionInstruction}
                onInstructionChange={setSuggestionInstruction}
                onSuggest={() => {
                  void handleSuggestLayout("suggest");
                }}
                onResuggest={() => {
                  void handleSuggestLayout("resuggest");
                }}
                onStopResuggest={() => {
                  setResuggestStopperEnabled(true);
                  setStatusMessage(t("suggestion.panel.status.stopper_enabled_manually"));
                }}
                onDiscard={handleDiscardSuggestion}
                hasSuggestion={Boolean(suggestedDocument && suggestionId)}
                isPreviewEnabled={isSuggestionPreviewEnabled}
                onPreviewToggle={setIsSuggestionPreviewEnabled}
                isAnnotateOverlayEnabled={isAnnotateOverlayEnabled}
                onAnnotateOverlayToggle={setIsAnnotateOverlayEnabled}
                isSuggesting={isSuggesting}
                errorMessage={suggestionError}
                notes={suggestionNotes}
                resuggestAttemptCount={resuggestAttemptCount}
                resuggestAttemptLimit={resuggestAttemptLimit}
              />
            </div>
          ),
        },
        {
          id: "inquiry",
          label: t("work_mode.tab.inquiry"),
          content: (
            <LazyPanelBoundary>
            <InquiryJourneyPrototypePanel
              document={document}
              onRestoreDocument={(snapshotDocument) => applyDocumentChange(snapshotDocument)}
              onDiscardRestoredDocument={discardLatestDocumentChange}
              runTenantScopedOptionalTask={runTenantScopedOptionalTask}
              runTenantScopedApiRequest={runTenantScopedApiRequest}
              verifiedTenantSession={verifiedTenantSession}
            />
            </LazyPanelBoundary>
          ),
        },
        {
          id: "visual-cue",
          label: t("work_mode.tab.visual_cue"),
          content: <LazyPanelBoundary><RepresentativeVisualCuePrototypePanel /></LazyPanelBoundary>,
        },
        {
          id: "diagnostics",
          label: t("work_mode.tab.diagnostics"),
          content: (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={workModeTabDescriptionStyle}>{t("work_mode.tab.diagnostics_description")}</div>
              <div style={{ display: "grid", gap: 6, fontSize: 12, color: "#334155" }}>
                <div>
                  {t("share.panel.preflight.domain_summary_review", {
                    cards: domainExpressionShareSummary.unreviewedCards,
                    islands: domainExpressionShareSummary.unreviewedIslands,
                  })}
                </div>
                <div>
                  {t("share.panel.preflight.domain_summary_hold", { count: domainExpressionShareSummary.holdCards })}
                </div>
                <div>
                  {t("share.panel.preflight.domain_summary_critique", { count: domainExpressionShareSummary.critiqueTargets })}
                </div>
                <div>
                  {t("share.panel.preflight.domain_summary_evidence", {
                    links: domainExpressionShareSummary.evidenceLinks,
                    contradictions: domainExpressionShareSummary.contradictionLinks,
                    gaps: domainExpressionShareSummary.evidenceGapCards,
                  })}
                </div>
              </div>
            </div>
          ),
        },
        {
          id: "narrative",
          label: t("work_mode.tab.narrative"),
          content: (
            <NarrativesPanel
              narrativeText={narrativeText}
              onNarrativeTextChange={setNarrativeText}
              onCheckConsistency={(selectedNarrativeId) => {
                void handleCheckNarrativeConsistency(selectedNarrativeId);
              }}
              onGenerateFromReadingOrder={() => {
                void handleGenerateNarrativeFromReadingOrder();
              }}
              narrativeModel={narrativeModel}
              onNarrativeModelChange={setNarrativeModel}
              availableModels={availableModels}
              availableModelsUnavailableReason={availableModelsUnavailableReason}
              isChecking={isCheckingNarrative}
              isGenerating={isGeneratingNarrative}
              errorMessage={narrativeCheckError}
              generationErrorMessage={narrativeGenerationError}
              issues={narrativeIssues}
              generatedNarratives={generatedNarratives}
              onReferenceClick={handleNarrativeReferenceFocus}
              onFocusItem={focusItem}
              readingOrderSnippets={readingOrderSnippets}
              document={document}
              hideSourceCards={hideSourceCards}
              safeMode={safeMode}
            />
          ),
        },
      ]}
      activateRequest={{
        tabId: "suggestion",
        nonce: critiqueWorkflowFocusRequest,
        focusSelector: '[data-domain-workflow="critique-reproposal"]',
      }}
    />
  );

  // UX-CMDK-01 (ADR-0048 D2): command registry. Every entry delegates to an
  // existing handler — no new business logic. Disabled commands (per their
  // existing enabled condition) are omitted rather than shown greyed out.
  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const canEditDocument = !isReadOnly && !isLoading && Boolean(document);
    const commands: Array<PaletteCommand & { enabled: boolean }> = [
      {
        id: "new-card",
        category: "create",
        label: t("app.toolbar.new_card"),
        enabled: canEditDocument,
        run: handleAddCard,
      },
      {
        id: "create-island",
        category: "create",
        label: t("app.toolbar.create_island"),
        shortcutHint: formatModShortcut("G"),
        enabled: canEditDocument && selectedCardIds.length > 0,
        run: handleCreateIsland,
      },
      {
        id: "tidy-island",
        category: "create",
        label: t("context_menu.tidy_island"),
        enabled: canEditDocument && selectedIslandId !== null,
        run: () => {
          if (selectedIslandId) {
            handleTidyIsland(selectedIslandId);
          }
        },
      },
      {
        id: "toggle-hold",
        category: "hold",
        label: t("command_palette.command.toggle_hold"),
        enabled: canEditDocument && selectedCard !== null,
        run: () => {
          if (!selectedCard) {
            return;
          }
          handleCardHoldStateChange(selectedCard.id, selectedCard.holdState === "held" ? "active" : "held");
        },
      },
      {
        id: "open-work-mode",
        category: "nav",
        label: t("work_mode.title"),
        enabled: true,
        run: () => setIsWorkModeOpen((previous) => !previous),
      },
      {
        id: "open-share",
        category: "nav",
        label: t("share.panel.trigger"),
        enabled: true,
        run: () => setIsSharePanelOpen((previous) => !previous),
      },
      {
        id: "open-view",
        category: "nav",
        label: t("view_controls.trigger"),
        enabled: true,
        run: () => setIsViewControlsOpen((previous) => !previous),
      },
      {
        id: "toggle-legend",
        category: "nav",
        label: t("command_palette.command.toggle_legend"),
        enabled: true,
        run: () => {
          if (isCanvasLegendOpen) {
            handleCloseCanvasLegend();
          } else {
            setIsCanvasLegendOpen(true);
          }
        },
      },
      {
        id: "undo",
        category: "history",
        label: t("app.toolbar.undo"),
        shortcutHint: formatModShortcut("Z"),
        enabled: canUndo,
        run: handleUndo,
      },
      {
        id: "redo",
        category: "history",
        label: t("app.toolbar.redo"),
        shortcutHint: formatModShortcut("Y"),
        enabled: canRedo,
        run: handleRedo,
      },
      {
        id: "save",
        category: "safety",
        label: t("app.toolbar.save"),
        enabled: canEditDocument && !isSaving && isDirty,
        run: () => {
          void handleSave();
        },
      },
      {
        id: "reset-empty-hint",
        category: "safety",
        label: t("view_controls.onboarding.reset_empty_canvas"),
        enabled: emptyCanvasHintCompleted,
        run: handleResetEmptyCanvasHint,
      },
    ];

    return commands.filter((command) => command.enabled);
  }, [
    canRedo,
    canUndo,
    document,
    emptyCanvasHintCompleted,
    handleAddCard,
    handleCardHoldStateChange,
    handleCloseCanvasLegend,
    handleCreateIsland,
    handleRedo,
    handleResetEmptyCanvasHint,
    handleTidyIsland,
    handleUndo,
    isCanvasLegendOpen,
    isDirty,
    isLoading,
    isReadOnly,
    isSaving,
    selectedCard,
    selectedCardIds,
    selectedIslandId,
  ]);

  const handleRunPaletteCommand = useCallback((command: PaletteCommand) => {
    // Execution path (AC-1): unlike Escape/backdrop cancel, do NOT force focus
    // back to the pre-open trigger — some commands (e.g. New card) move focus
    // to their own result (the new card's edit textarea) and that must win.
    commandPaletteReturnFocusRef.current = null;
    setIsCommandPaletteOpen(false);
    command.run();
  }, []);

  const shouldShowEmptyCanvasHint =
    !isStartPanelVisible &&
    !isReadOnly &&
    !isLoading &&
    !emptyCanvasHintCompleted &&
    Boolean(document) &&
    (document?.cards.length ?? 0) === 0;

  if (tenantSwitchUiState.status === "switching") {
    return <TenantSessionLoadingView />;
  }
  if (tenantSwitchUiState.status === "blocked") {
    return (
      <TenantSessionBlockedView
        reason="session_unavailable"
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <AppErrorBoundary
      getRecoverySnapshot={() => history?.present ?? null}
      onRecover={applyRecoveredDocument}
      storageScope={appStorage.scope}
    >
    {pendingRecovery != null ? (
      <div
        role="status"
        style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 2000, padding: "8px 16px", background: "#fff8e1", borderBottom: "1px solid #e0c060", display: "flex", gap: "12px", alignItems: "center", justifyContent: "center" }}
      >
        <span>{t("app.error_boundary.message")}</span>
        <button onClick={() => applyRecoveredDocument(pendingRecovery)}>{t("app.error_boundary.recover")}</button>
        <button onClick={handleDismissRecovery}>{t("app.error_boundary.reload")}</button>
      </div>
    ) : null}
    <RepresentativeVisualCueAssetScopeProvider scope={appStorage.scope}>
    <Shell
      title={t("app.title")}
      subtitle={t("app.subtitle.document", {
        documentId: activeDocumentId,
        readOnlySuffix: isReadOnly ? t("app.subtitle.read_only_suffix") : "",
      })}
      headerViewControls={headerViewControls}
      headerShareControls={headerShareControls}
      headerCenter={headerCenter}
      headerRight={headerRight}
      menuBar={<MenuBar categories={menuCategories} />}
      hasUnsavedChanges={isDirty}
      saveConflictMessage={
        hasSaveConflict
          ? t("app.status.save_conflict")
          : undefined
      }
      onReloadAfterConflict={() => {
        void loadDocument(activeDocumentId, { isReload: true });
      }}
      onExportAfterConflict={handleExport}
      isReloadingAfterConflict={isReloadingDocument}
      sidePanel={
        <SidePanel
          isReadOnly={isReadOnly}
          isAdvancedUiEnabled={isAdvancedUiEnabled}
          runTenantScopedOptionalTask={runTenantScopedOptionalTask}
          selectedCard={selectedCard}
          sourceCardsForSelectedCanonical={sourceCardsForSelectedCanonical}
          missingSourceCardIdsForSelectedCanonical={missingSourceCardIdsForSelectedCanonical}
          revealedSourceCardIds={revealedSourceCardIds}
          importedPackSnapshotUrl={importedPackSnapshotUrl}
          importedPackDiagnosticsMd={importedPackDiagnosticsMd}
          selectedIsland={selectedIsland ? { ...selectedIsland, shapeStale: stalePolygonIslandIdSet.has(selectedIsland.id) } : null}
          selectedCardCount={selectedCardIds.length}
          onCreateRepresentativeCard={handleCreateRepresentativeCard}
          onCardCritiqueChange={(value) => {
            if (!selectedCard) {
              return;
            }

            handleCardCritiqueChange(selectedCard.id, value);
          }}
          onCardMetaChange={(rawSeq, rawSource) => {
            if (!selectedCard) {
              return;
            }

            handleCardMetaChange(selectedCard.id, rawSeq, rawSource);
          }}
          onCardKaChange={(rawVoice, rawValue) => {
            if (!selectedCard) {
              return;
            }

            handleCardKaChange(selectedCard.id, rawVoice, rawValue);
          }}
          onCardCritiqueTagsChange={(value) => {
            if (!selectedCard) {
              return;
            }

            handleCardCritiqueTagsChange(selectedCard.id, value);
          }}
          onOpenCritiqueWorkflow={handleOpenCritiqueWorkflow}
          onCardClaimTypeChange={(value) => {
            if (!selectedCard) {
              return;
            }

            handleCardClaimTypeChange(selectedCard.id, value);
          }}
          onCardHoldStateChange={(value) => {
            if (!selectedCard) {
              return;
            }

            handleCardHoldStateChange(selectedCard.id, value);
          }}
          onRestoreShelvedCard={handleRestoreShelvedCard}
          onCardTextReviewedChange={(value) => {
            if (!selectedCard) {
              return;
            }

            handleCardTextReviewedChange(selectedCard.id, value);
          }}
          cardQualityAssistState={
            selectedCard && openCardQualityAssistCardId === selectedCard.id
              ? cardQualityAssistByCardId[selectedCard.id]
              : undefined
          }
          onOpenCardQualityAssist={handleOpenCardQualityAssist}
          onAnswerCardQualityQuestion={handleAnswerCardQualityQuestion}
          onCloseCardQualityAssist={handleCloseCardQualityAssist}
          onOpenCardTextEditor={handleOpenCardTextEditor}
          onCommitCardQualityText={(text) => {
            if (selectedCard) {
              handleCommitCardText(selectedCard.id, text);
            }
          }}
          onRestoreCardQualityText={handleRestoreCardQualityText}
          onAddEvidenceLink={(payload) => {
            if (!selectedCard) {
              return;
            }

            handleAddEvidenceLink(selectedCard.id, payload);
          }}
          onRemoveEvidenceLink={handleRemoveEvidenceLink}
          onUpdateEvidenceLink={handleUpdateEvidenceLink}
          onFocusCardById={focusCardById}
          onTitleChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandTitleChange(selectedIsland.id, value);
          }}
          onParentIslandChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandParentChange(selectedIsland.id, value);
          }}
          onPlacardCardChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandPlacardCardChange(selectedIsland.id, value);
          }}
          onPlacardCardTextChange={(value) => {
            if (!selectedIsland?.placardCardId || !document) {
              return;
            }

            const nextCards = document.cards.map((card) =>
              card.id === selectedIsland.placardCardId
                ? {
                    ...card,
                    text: value,
                    textReviewed: true,
                  }
                : card
            );

            applyDocumentChange({ ...document, cards: nextCards }, t("app.history.island.placard_card_updated"));
          }}
          onTitleReviewedChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandTitleReviewedChange(selectedIsland.id, value);
          }}
          onSummaryTextChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandSummaryTextChange(selectedIsland.id, value);
          }}
          onRestoreSummaryHistoryEntry={(historyEntryId) => {
            if (!selectedIsland) {
              return;
            }

            handleRestoreIslandSummaryVersion(selectedIsland.id, historyEntryId);
          }}
          onShowSummaryHistoryGrounding={(groundingIds) => {
            revealCardsTemporarily(groundingIds);
          }}
          onSummaryReviewedChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandSummaryReviewedChange(selectedIsland.id, value);
          }}
          onSuggestIslandSummary={(critiqueText) => {
            void handleSuggestIslandSummary(critiqueText);
          }}
          islandSummaryModel={islandSummaryModel}
          onIslandSummaryModelChange={setIslandSummaryModel}
          availableModels={availableModels}
          availableModelsUnavailableReason={availableModelsUnavailableReason}
          opposingViewpointProposal={opposingViewpointProposal}
          isProposingOpposingViewpoint={isProposingOpposingViewpoint}
          onProposeOpposingViewpoint={handleProposeOpposingViewpoint}
          onDismissOpposingViewpointProposal={() => setOpposingViewpointProposal(null)}
          islandSummaryProposal={islandSummaryProposal}
          proposalAuditTrail={proposalAuditTrail}
          onAdoptIslandSummaryProposal={(candidateIndex, critiqueText) => {
            void handleAdoptIslandSummaryProposal(candidateIndex, critiqueText);
          }}
          onRejectIslandSummaryProposal={() => {
            void handleRejectIslandSummaryProposal();
          }}
          onHoldIslandSummaryProposal={() => {
            void handleHoldIslandSummaryProposal();
          }}
          isRecordingIslandSummaryDecision={isRecordingIslandSummaryDecision}
          isSuggestingIslandSummary={isSuggestingIslandSummary}
          islandSummarySuggestionWarnings={selectedIsland ? islandSummarySuggestionWarningsByIslandId[selectedIsland.id] ?? [] : []}
          summaryGroundingItems={summaryGroundingItems}
          onImageUrlChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandImageUrlChange(selectedIsland.id, value);
          }}
          onImageReviewedChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandImageReviewedChange(selectedIsland.id, value);
          }}
          onRepresentativeVisualCueChange={(value) => {
            if (!selectedIsland) {
              return false;
            }

            return handleIslandRepresentativeVisualCueChange(selectedIsland.id, value);
          }}
          onIslandCollapsedChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandCollapsedChange(selectedIsland.id, value);
          }}
          isSelectedIslandCollapsed={selectedIsland ? collapsedIslandIds.has(selectedIsland.id) : false}
          hasIslands={(document?.islands.length ?? 0) > 0}
          isAnyIslandCollapsed={collapsedIslandIds.size > 0}
          onCollapseAllIslands={handleCollapseAllIslands}
          onExpandAllIslands={handleExpandAllIslands}
          onIslandCritiqueChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandCritiqueChange(selectedIsland.id, value);
          }}
          onIslandCritiqueTagsChange={(value) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandCritiqueTagsChange(selectedIsland.id, value);
          }}
          onAddSelectedCards={handleAddSelectedCardsToIsland}
          onRemoveSelectedCards={handleRemoveSelectedCardsFromIsland}
          onDeleteIsland={handleDeleteSelectedIsland}
          onFocusIsland={handleFocusIsland}
          onFocusCard={() => {
            if (!selectedCard) {
              return;
            }

            focusCardById(selectedCard.id);
          }}
          summaryView={summaryView}
          abstractMapView={abstractMapView}
          isSelectedIslandTemporarilyRevealed={selectedIsland ? summaryRevealIslandIds.has(selectedIsland.id) : false}
          onToggleSelectedIslandTemporaryReveal={() => {
            if (!selectedIsland) {
              return;
            }

            setSummaryRevealIslandIds((previousIds) => {
              const nextIds = new Set(previousIds);
              if (nextIds.has(selectedIsland.id)) {
                nextIds.delete(selectedIsland.id);
              } else {
                nextIds.add(selectedIsland.id);
              }
              return nextIds;
            });
          }}
          isGridSnapEnabled={isGridSnapEnabled}
          onGridSnapToggle={setIsGridSnapEnabled}
          isPolygonVertexEditEnabled={isPolygonVertexEditEnabled}
          onPolygonVertexEditEnabledChange={setIsPolygonVertexEditEnabled}
          onGenerateIslandPolygon={() => {
            if (!selectedIsland) {
              return;
            }

            handleGenerateIslandPolygon(selectedIsland.id);
          }}
          onIslandShapeKindChange={(kind) => {
            if (!selectedIsland) {
              return;
            }

            handleIslandShapeKindChange(selectedIsland.id, kind);
          }}
          showCanonicalOnlyEdges={showCanonicalOnlyEdges}
          onShowCanonicalOnlyEdgesChange={setShowCanonicalOnlyEdges}
          onSourceCardInspect={handleSourceCardInspect}
          onSummaryGroundingCardInspect={handleSummaryGroundingCardInspect}
          onShowAllSummaryGrounding={handleShowAllSummaryGrounding}
          onClearTemporaryReveal={clearTemporaryReveal}
          groundingVisibilityMessage={groundingVisibilityMessage}
          onShowAllSourcesChange={handleShowAllSourcesChange}
          document={document}
          selectedIslandRelationEdge={selectedIslandRelationEdge}
          selectedAggregatedEdge={selectedAggregatedEdge}
          selectedPersistedEdgeType={
            selectedAggregatedEdge ? document?.edges.find((edge) => edge.id === selectedAggregatedEdge.id)?.type ?? null : null
          }
          onEdgeTypeChange={handleEdgeTypeChange}
          onRevealSelectedEdgeSources={handleRevealSelectedEdgeSources}
          onInspectSelectedEdgeCard={handleInspectSelectedEdgeCard}
          selectedRelationSummary={selectedRelationSummary}
          safeMode={safeMode}
          isGeneratingRelationSummary={isGeneratingRelationSummary}
          onGenerateRelationSummary={() => {
            void handleGenerateRelationSummary();
          }}
          onRelationSummaryCommit={handleRelationSummaryCommit}
          onRestoreRelationSummaryHistoryEntry={handleRestoreRelationSummaryHistoryEntry}
          onRelationSummaryReviewedChange={handleRelationSummaryReviewedChange}
          onRelationSummaryGroundingInspect={handleRelationSummaryGroundingInspect}
          onAlignLeft={() => {
            handleAlign("left");
          }}
          onAlignRight={() => {
            handleAlign("right");
          }}
          onAlignTop={() => {
            handleAlign("top");
          }}
          onAlignBottom={() => {
            handleAlign("bottom");
          }}
          onDistributeHorizontally={() => {
            handleDistribute("horizontal");
          }}
          onDistributeVertically={() => {
            handleDistribute("vertical");
          }}
          canStartConnect={canStartConnect}
          isPickingEdgeTarget={isPickingEdgeTarget}
          connectEdgeType={connectEdgeType}
          onConnectEdgeTypeChange={setConnectEdgeType}
          onStartConnect={handleStartConnect}
          onCancelConnect={handleCancelConnect}
          guidedFlowEnabled={guidedFlowEnabled}
          onGuidedFlowEnabledChange={(enabled) => {
            setGuidedFlowEnabled(enabled);
            if (!enabled) {
              return;
            }

            const step = guidedFlowSteps[guidedFlowStepIndex] ?? guidedFlowSteps[0];
            if (step) {
              setPerspectiveMode(step.perspectiveMode);
              setGuidedFlowStepId(step.id);
              setGuidedFlowTargetIndex(0);
            }
          }}
          guidedFlowStepId={currentGuidedFlowStep?.id ?? "review"}
          guidedFlowStepIndex={guidedFlowStepIndex}
          guidedFlowTotalSteps={guidedFlowSteps.length}
          guidedFlowStepTitle={currentGuidedFlowStep?.title ?? ""}
          guidedFlowStepDescription={currentGuidedFlowStep?.description ?? ""}
          guidedFlowStepOptional={currentGuidedFlowStep?.optional ?? false}
          guidedFlowTargetIndex={guidedFlowTargetIndex}
          guidedFlowTargetTotal={guidedFlowTargets.length}
          guidedFlowSuggestedActions={currentGuidedFlowStep?.suggestedActions ?? []}
          onGuidedFlowPrevStep={() => {
            handleGuidedFlowStepChange(-1);
          }}
          onGuidedFlowNextStep={() => {
            handleGuidedFlowStepChange(1);
          }}
          onGuidedFlowNextTarget={handleGuidedFlowNextTarget}
          onGuidedFlowOpenRelevantEditor={handleGuidedFlowOpenRelevantEditor}
          guidedFlowOpenEditorRequestSeq={guidedFlowOpenEditorRequestSeq}
          readingNavEnabled={readingNavEnabled}
          onReadingNavEnabledChange={handleSetReadingNavEnabled}
          readingMode={readingMode}
          onReadingModeChange={handleSetReadingMode}
          reviewedOnly={reviewedOnly}
          onReadingReviewedOnlyToggle={handleToggleReviewedOnly}
          outlineIncludeCardTexts={outlineIncludeCardTexts}
          onOutlineIncludeCardTextsChange={setOutlineIncludeCardTexts}
          outlineIncludeRelationSummaries={outlineIncludeRelationSummaries}
          onOutlineIncludeRelationSummariesChange={setOutlineIncludeRelationSummaries}
          outlineIncludeUnreviewed={outlineIncludeUnreviewed}
          onOutlineIncludeUnreviewedChange={setOutlineIncludeUnreviewed}
          outlineAppendDiagnostics={outlineAppendDiagnostics}
          onOutlineAppendDiagnosticsChange={setOutlineAppendDiagnostics}
          outlineAppendRecommendations={outlineAppendRecommendations}
          onOutlineAppendRecommendationsChange={setOutlineAppendRecommendations}
          outlineAppendKaFields={outlineAppendKaFields}
          onOutlineAppendKaFieldsChange={setOutlineAppendKaFields}
          outlineQualityReport={outlineQualityReport}
          outlineRecommendations={outlineRecommendations}
          contradictionReport={contradictionReport}
          distributionReport={distributionReport}
          claimTypeMixReport={claimTypeMixReport}
          evidenceGapReport={evidenceGapReport}
          dialecticBalanceReport={dialecticBalanceReport}
          onRunOutlineDiagnostics={handleRunOutlineDiagnostics}
          onDetectVoids={handleDetectVoids}
          isDiagnosticsRunning={isDiagnosticsRunning}
          onCancelDiagnostics={() => diagnosticsAbortRef.current?.abort()}
          computeProgressMessage={computeProgressMessage}
          onFocusOutlineDiagnosticRef={focusItem}
          onFocusContradictionSignal={handleFocusContradictionSignal}
          onContradictionSignalDecision={handleContradictionSignalDecision}
          onFocusDistributionIsland={focusIslandById}
          onFocusDialecticBalanceFinding={handleFocusDialecticBalanceFinding}
          onCopyReadingOutlineMd={() => {
            void handleCopyReadingOutlineMd();
          }}
          onDownloadReadingOutlineMd={handleDownloadReadingOutlineMd}
          onEvidenceTraceError={setStatusMessage}
          readingStep={readingList.length === 0 ? 0 : clampReadingIndex(readingIndex, readingList.length) + 1}
          readingTotal={readingList.length}
          currentReadingLabel={currentReadingItem?.label ?? null}
          onReadingPrev={handleReadingPrev}
          onReadingNext={handleReadingNext}
          readingOrderItems={readingOrderItems}
          canAddSelectedItemToReadingOrder={Boolean(selectedIsland || selectedCard)}
          onAddSelectedItemToReadingOrder={handleAddSelectedItemToReadingOrder}
          onMoveReadingOrderItem={handleMoveReadingOrderItem}
          onRemoveReadingOrderItem={handleRemoveReadingOrderItem}
          aggregatedEdgeInspectorItems={aggregatedEdgeInspectorItems}
          onPromoteAggregatedEdge={handlePromoteAggregatedEdge}
          evidenceOverlayEnabled={evidenceOverlayEnabled}
          evidenceOverlayScope={evidenceOverlayScope}
          mergeAuditLog={mergeAuditLog}
          providerUnavailableMessage={providerUnavailableMessage}
          onEnableEvidenceOverlaySelectionExplore={() => {
            if (!selectedCard) {
              return;
            }
            setEvidenceOverlayEnabled(true);
            setEvidenceOverlayScope("selection");
          }}
        />
      }
    >
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          void handleImportFileChange(event);
        }}
        style={{ display: "none" }}
      />
      <input
        ref={compareImportInputRef}
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          void handleComparisonFileChange(event);
        }}
        style={{ display: "none" }}
      />
      <input
        ref={reviewPackInputRef}
        type="file"
        accept=".zip,application/zip"
        onChange={handleReviewPackFileChange}
        style={{ display: "none" }}
      />
      {isStartPanelVisible ? (
        <StartPanel
          currentDocumentId={activeDocumentId}
          canReopenCurrent={docEtag === null}
          isDirty={isDirty}
          isLoading={isLoading}
          isReadOnly={isReadOnly}
          isSaving={isSaving}
          recentDocumentIds={recentDocumentIds}
          safeMode={safeMode}
          selectedRecentDocumentId={selectedRecentDocumentId}
          onClose={() => setIsStartPanelVisible(false)}
          onCreateNew={handleStartCreateNewDocument}
          onImportReviewPack={handleStartImportReviewPack}
          onLoadDocumentFile={handleStartLoadDocumentFile}
          onOpenRecent={handleStartOpenRecent}
          onOpenSample={() => {
            void handleOpenSampleDocument();
          }}
          onSelectedRecentDocumentChange={setSelectedRecentDocumentId}
        />
      ) : null}
      {isLoading || !focusedVisibleDocument ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#334155",
          }}
        >
          {t("app.loading_canvas")}
        </div>
      ) : (
        <>
          <div data-ui-region="primary-flow" style={{ position: "relative", height: "100%", minHeight: 0 }}>
          <CanvasShell
            document={focusedVisibleDocument}
            onCardMove={handleCardMove}
            onCardMoveCommit={handleCardMoveCommit}
            onTransformChange={handleTransformChange}
            onCameraChange={setCanvasCamera}
            cameraTransformRequest={cameraTransformRequest}
            selectedCardIds={selectedCardIds}
            onCardSelect={handleCardSelect}
            onCanvasBackgroundClick={handleCanvasBackgroundClick}
            onMarqueeSelect={handleMarqueeSelect}
            searchQuery={normalizedSearchQuery}
            matchedCardIds={matchedCardIdSet}
            activeMatchedCardId={activeMatchedCardId}
            hiddenCardIds={effectiveHiddenCardIdSet}
            hideSourceCards={hideSourceCards || summaryView || abstractMapView}
            deemphasizedCardIds={new Set([...(summaryView || abstractMapView ? loneWolfCardIdSet : new Set<string>()), ...(perspectiveRendering?.dimCardIds ?? new Set<string>())])}
            viewState={{
              hideSourceCards: hideSourceCards || summaryView || abstractMapView,
              showCanonicalOnlyEdges,
              showReadingOrder,
              showLabelBounds,
              highlightEdgeIds,
              evidenceOverlayEdges: shouldRenderEvidenceOverlay ? evidenceOverlayEdges : [],
              evidenceOverlayDimCardIds: shouldRenderEvidenceOverlay ? evidenceOverlayDimCardIds : new Set<string>(),
              evidenceOverlayHint,
              highlightCardIds: perspectiveRendering?.highlightCardIds,
              perspectiveHint,
            }}
            revealCardIds={mergedRevealCardIds}
            showCanonicalOnlyEdges={showCanonicalOnlyEdges}
            summaryView={summaryView}
            abstractMapView={abstractMapView}
            lodEnabled={lodEnabled}
            lodThresholds={lodThresholds}
            lodLevelOverride={lodLevelOverride}
            lodShowLoneWolvesWhenFar={lodShowLoneWolvesWhenFar}
            showProtectionMarks={showProtectionMarks}
            showSeqNumbers={showSeqNumbers}
            effectiveCollapsedIslandIds={effectiveCollapsedIslandIdSet}
            showDerivedIslandEdges={summaryView || abstractMapView || effectiveCollapsedIslandIdSet.size > 0 || currentLod?.level === "far"}
            focusCardId={focusCardId}
            focusWorldPoint={focusWorldPoint}
            focusRequestSeq={focusRequestSeq}
            flashReference={flashReference}
            flashRequestSeq={flashRequestSeq}
            isPickingEdgeTarget={isPickingEdgeTarget}
            editingCardId={editingCardId}
            onBeginEditCard={setEditingCardId}
            onCommitEditCard={handleCommitCardText}
            onCancelEditCard={handleCancelEditCard}
            onCardContextMenu={handleCardContextMenu}
            onBackgroundContextMenu={handleBackgroundContextMenu}
            suggestionMoveDiffs={suggestionMoveDiffs}
            selectedEdgeId={selectedEdgeId}
            onEdgeSelect={handleEdgeSelect}
            onAggregatedEdgesChange={setVisibleAggregatedEdges}
            showReadingOrder={showReadingOrder}
            readingOrderEditMode={!isReadOnly && isReadingOrderEditMode}
            onReadingOrderRemove={handleRemoveReadingOrderEntry}
            onReadingOrderReorder={handleReorderReadingOrderEntry}
            visibleIslandIds={visibleIslandIdSet}
            polygonVertexEditIslandId={
              !isReadOnly && isPolygonVertexEditEnabled && selectedIsland?.shape?.kind === "polygon" ? selectedIsland.id : null
            }
            onPolygonVertexDragStart={handlePolygonVertexDragStart}
            onPolygonVertexDragMove={handlePolygonVertexDragMove}
            onPolygonVertexDragCommit={handlePolygonVertexDragCommit}
            onPolygonVertexDragCancel={handlePolygonVertexDragCancel}
            onPolygonVertexAdd={handlePolygonVertexAdd}
            onPolygonVertexRemove={handlePolygonVertexRemove}
          >
            {islandViews}
          </CanvasShell>
          {shouldShowEmptyCanvasHint ? (
            <EmptyCanvasHint
              onCreateCard={handleAddCard}
              onOpenSample={() => {
                void handleOpenSampleDocument();
              }}
            />
          ) : null}
          {isCanvasLegendOpen ? <CanvasLegend onClose={handleCloseCanvasLegend} /> : null}
          <Minimap
            cards={minimapCards}
            islands={minimapIslands}
            camera={canvasCamera}
            storageScope={appStorage.scope}
            onPan={handleMinimapPan}
          />
          {selectedCardIds.length >= 2 ? (
            <BulkOperationsBar
              count={selectedCardIds.length}
              onToggleHold={handleBulkToggleHold}
              onToggleCritique={handleBulkToggleCritique}
              onAddCritiqueReason={handleBulkAddCritiqueReason}
              onChangeClaimType={handleBulkClaimTypeChange}
              onBundleIntoIsland={handleCreateIsland}
              onDelete={handleDeleteSelection}
            />
          ) : null}
          </div>
        </>
      )}
      <div
        data-testid="status-message"
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          maxWidth: "min(560px, calc(100vw - 32px))",
          backgroundColor: "rgba(15, 23, 42, 0.85)",
          color: "#f8fafc",
          padding: "6px 10px",
          borderRadius: 6,
          fontSize: 12,
          lineHeight: 1.4,
          overflowWrap: "break-word",
          whiteSpace: "pre-wrap",
          // Keep the live region mounted so announcements work, but do not paint an
          // empty dark pill over the canvas while there is nothing to say.
          opacity: statusMessage === "" ? 0 : 1,
          pointerEvents: "none",
          transition: "opacity 0.15s",
        }}
      >
        {statusMessage}
      </div>
      {contextMenu
        ? (() => {
            const target = contextMenu.target;
            let items: ContextMenuItem[];
            if (target.kind === "background") {
              items = [
                {
                  kind: "action",
                  label: t("context_menu.new_card_here"),
                  onSelect: () => handleAddCardAtPoint(target.worldX, target.worldY),
                },
                { kind: "separator" },
                {
                  kind: "action",
                  label: t("context_menu.clear_selection"),
                  onSelect: handleClearSelection,
                  disabled: selectedCardIds.length === 0 && !selectedIslandId && !selectedEdgeId,
                },
              ];
            } else if (target.kind === "island") {
              items = [
                {
                  kind: "action",
                  label: t("context_menu.edit_island"),
                  onSelect: () => {
                    setSelectedCardIds([]);
                    setSelectedEdgeId(null);
                    setSelectedIslandId(target.islandId);
                  },
                },
                {
                  kind: "action",
                  label: t("context_menu.resize_island"),
                  onSelect: () => {
                    setSelectedCardIds([]);
                    setSelectedEdgeId(null);
                    setSelectedIslandId(target.islandId);
                    handleIslandShapeKindChange(target.islandId, "polygon");
                    setIsPolygonVertexEditEnabled(true);
                  },
                  disabled: isReadOnly,
                },
                {
                  kind: "action",
                  label: t("context_menu.add_cards_to_island"),
                  onSelect: () => handleAddSelectedCardsToIslandById(target.islandId),
                  disabled: isReadOnly || selectedCardIds.length === 0,
                },
                {
                  kind: "action",
                  label: t("context_menu.tidy_island"),
                  onSelect: () => handleTidyIsland(target.islandId),
                  disabled: isReadOnly,
                },
                { kind: "separator" },
                {
                  kind: "action",
                  label: t("context_menu.delete_island"),
                  onSelect: () => handleDeleteIslandById(target.islandId),
                  disabled: isReadOnly,
                },
              ];
            } else {
              items = [
                {
                  kind: "action",
                  label: t("context_menu.edit_card"),
                  onSelect: () => handleEditCard(target.cardId),
                },
                {
                  kind: "action",
                  label: t("context_menu.connect"),
                  onSelect: () => handleConnectFromCard(target.cardId),
                },
                {
                  kind: "action",
                  label: t("app.toolbar.create_island"),
                  onSelect: handleCreateIsland,
                  disabled: selectedCardIds.length === 0,
                },
                { kind: "separator" },
                {
                  kind: "action",
                  label: t("app.toolbar.delete_selection"),
                  onSelect: handleDeleteSelection,
                },
              ];
            }
            return (
              <ContextMenu
                x={contextMenu.x}
                y={contextMenu.y}
                items={items}
                ariaLabel={t("context_menu.label")}
                returnFocusTo={contextMenuReturnFocusRef.current}
                onClose={closeContextMenu}
              />
            );
          })()
        : null}
    </Shell>
    <WorkModePanel
      isOpen={isWorkModeOpen}
      onClose={() => setIsWorkModeOpen(false)}
      triggerRef={workModeTriggerRef}
    >
      {isAdvancedUiEnabled ? advancedWorkModeContent : (
        <div style={{ fontSize: 13, color: "#64748b", padding: 16 }}>
          {t("work_mode.content_pending")}
        </div>
      )}
    </WorkModePanel>
    <AgentTaskExportPanel
      isOpen={isAgentTaskExportOpen}
      onClose={() => setIsAgentTaskExportOpen(false)}
      triggerRef={agentTaskExportTriggerRef}
      safeMode={safeMode}
      selectedCardCount={selectedCardIds.length}
      selectedIslandCount={selectedIslandId ? 1 : 0}
      taskKind={agentTaskKind}
      onTaskKindChange={handleAgentTaskKindChange}
      desiredCount={agentTaskDesiredCount}
      onDesiredCountChange={setAgentTaskDesiredCount}
      includeUnreviewedDrafts={agentTaskIncludeUnreviewedDrafts}
      onIncludeUnreviewedDraftsChange={handleAgentTaskIncludeUnreviewedDraftsChange}
      includeSourceReferences={agentTaskIncludeSourceReferences}
      onIncludeSourceReferencesChange={handleAgentTaskIncludeSourceReferencesChange}
      scopeConfirmed={agentTaskScopeConfirmed}
      onScopeConfirmedChange={setAgentTaskScopeConfirmed}
      onCopyMarkdown={() => {
        void handleCopyAgentTaskSheet();
      }}
      onDownloadMarkdown={() => {
        void handleDownloadAgentTaskSheet();
      }}
      onDownloadTaskJson={() => {
        void handleDownloadAgentTaskJson();
      }}
    />
    {hasOpenedAgentResponseImportPanel ? (
    <LazyPanelBoundary>
    <AgentResponseImportPanel
      isOpen={isAgentResponseImportOpen}
      onClose={() => setIsAgentResponseImportOpen(false)}
      triggerRef={agentResponseImportTriggerRef}
      pastedText={agentResponsePastedText}
      onPastedTextChange={setAgentResponsePastedText}
      mode={agentResponseImportMode}
      onModeChange={setAgentResponseImportMode}
      onParse={handleParseAgentResponse}
      parseErrors={agentResponseParseErrors}
      parseWarnings={agentResponseParseWarnings}
      reviews={agentImportedProposalReviews}
      onAdopt={handleAdoptAgentImportedProposal}
      onReject={handleRejectAgentImportedProposal}
      onExportPatchFile={handleExportAgentImportedProposalPatchFile}
    />
    </LazyPanelBoundary>
    ) : null}
    {hasOpenedDiagnosticsBundlePanel ? (
    <LazyPanelBoundary>
    <DiagnosticsBundlePanel
      isOpen={isDiagnosticsBundleOpen}
      onClose={() => setIsDiagnosticsBundleOpen(false)}
      triggerRef={diagnosticsBundleTriggerRef}
      safeMode={safeMode}
      providerType={providerKind ?? "unknown"}
      documentSummary={
        document
          ? {
              version: document.version,
              updatedAt: document.updatedAt,
              cardCount: document.cards.length,
              islandCount: document.islands.length,
              edgeCount: document.edges.length,
            }
          : null
      }
    />
    </LazyPanelBoundary>
    ) : null}
    <RecentDocumentsDialog
      isOpen={isRecentDocumentsDialogOpen}
      onClose={() => setIsRecentDocumentsDialogOpen(false)}
      triggerRef={recentDocumentsDialogTriggerRef}
      recentDocumentIds={recentDocumentIds}
      selectedRecentDocumentId={selectedRecentDocumentId}
      onSelectedRecentDocumentChange={setSelectedRecentDocumentId}
      onOpenRecent={handleOpenRecent}
      isLoading={isLoading}
      activeDocumentId={activeDocumentId}
      canReopenCurrent={docEtag === null}
      documents={canvasDocuments}
      isCanvasListLoading={isCanvasListLoading}
      myDocumentsOnly={myDocumentsOnly}
      onMyDocumentsOnlyChange={setMyDocumentsOnly}
      isArchiving={isArchiving}
      onArchiveDocument={handleArchiveDocument}
      onUnarchiveDocument={handleUnarchiveDocument}
    />
    {isCommandPaletteOpen ? (
      <CommandPalette
        commands={paletteCommands}
        onClose={closeCommandPalette}
        onRunCommand={handleRunPaletteCommand}
      />
    ) : null}
    {isShortcutCheatsheetOpen ? <ShortcutCheatsheet onClose={closeShortcutCheatsheet} /> : null}
    {tenantSwitchUiState.status === "confirming" ? (
      <TenantChangeConfirmationDialog
        requestedTenantDisplayName={tenantSwitchUiState.requestedTenantDisplayName}
        onDecision={handleTenantSwitchDecision}
      />
    ) : null}
    </RepresentativeVisualCueAssetScopeProvider>
    </AppErrorBoundary>
  );
}
