import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { resolveIslandDisplayTitle } from "../i18n/island_title";
import { inspectIslandTitle } from "../domain/island_title_quality";
import { t } from "../i18n/translate";

import { formatTimestamp } from "../domain/format_timestamp";
import { CRITIQUE_TAGS, KNOWN_EDGE_TYPES, resolveKnownEdgeType } from "../domain/types";
import type { EdgeType, KnownEdgeType } from "../domain/types";
import { cardQualityRestoreTarget, currentCardQualityQuestion, type CardQualityAssistState, type CardQualityDecision } from "../domain/card_quality";
import { DomainStateSummary } from "./DomainStateSummary";
import type {
  AvailableModelItem,
  AvailableModelUnavailableReason,
  OpposingViewpointProposal,
} from "../api/client";
import { ModelSelector } from "./ModelSelector";
import { DomainStateFilterBar } from "./DomainStateFilterBar";
import type { DomainStateFilter } from "../domain/domain_state_filter";
import { ShelfPanel } from "./ShelfPanel";
import type { AggregatedEdgeMeta } from "../canvas/CanvasShell";
import {
  buildIslandRelationExplanation,
  formatIslandRelationExplanationMarkdown,
  type IslandRelationEdgeSelection,
} from "../domain/island_relation_explain";
import { canonicalHoldState } from "../domain/hold_state_ops";
import type { Card, ContradictionSignalReviewStatus, CritiqueTag, DocumentV1, EvidenceLink, HoldState, Island, RelationSummary, RepresentativeVisualCue } from "../domain/types";
import { RELATION_SUMMARY_TEXT_MAX_LENGTH } from "../domain/relation_summary_ops";
import type { OutlineQualityReport } from "../domain/view/outline_quality";
import type { Recommendation } from "../domain/view/recommendations";
import type { ContradictionReport, ContradictionSignal } from "../domain/view/contradiction_checks";
import { signatureKeyForContradictionSignal } from "../domain/view/contradiction_checks";
import { shouldLoadLegacyIslandImage } from "../domain/legacy_island_image";
import {
  createRepresentativeVisualCuePreset,
  REPRESENTATIVE_VISUAL_CUE_PRESETS,
} from "../domain/representative_visual_cue_presets";
import { rankDistributionIslands, type DistributionReport } from "../domain/view/distribution_checks";
import type { ClaimType, ClaimTypeMixReport } from "../domain/view/claim_type_checks";
import type { EvidenceGapReport } from "../domain/view/evidence_gap_checks";
import type { BalanceFinding, DialecticBalanceReport } from "../domain/view/dialectic_balance";
import { computeStructureMetrics } from "../domain/view/structural_metrics";
import { downloadTextFile } from "../export/narrative_export";
import { runTraceRequest } from "../utils/trace_request_lifecycle";
import { TraceWorkerClient } from "../worker/trace_client";
import type { TraceAnalytics } from "../worker/trace_analytics";
import type { MergeAuditEntry } from "../domain/view/audit_log";
import { RepresentativeVisualCueMark } from "./RepresentativeVisualCueMark";
import { RepresentativeVisualCueHandDrawnEditor } from "./RepresentativeVisualCueHandDrawnEditor";
import { RepresentativeVisualCueImageEditor } from "./RepresentativeVisualCueImageEditor";

type SummaryGroundingItem = {
  id: string;
  text: string;
  kind: "canonical" | "source";
};

type ReadingOrderItem = {
  id: string;
  label: string;
};

type AggregatedEdgeInspectorItem = {
  id: string;
  label: string;
};

type DiagnosticSeverity = "error" | "warn" | "info";

function diagnosticSeverityLabel(severity: DiagnosticSeverity): string {
  if (severity === "error") return t("side_panel.outline.severity.error");
  if (severity === "warn") return t("side_panel.outline.severity.warn");
  return t("side_panel.outline.severity.info");
}

type SidePanelProps = {
  isReadOnly?: boolean;
  isAdvancedUiEnabled?: boolean;
  runTenantScopedOptionalTask?: <T>(task: () => Promise<T>) => Promise<T | undefined>;
  selectedCard: Card | null;
  sourceCardsForSelectedCanonical: Card[];
  missingSourceCardIdsForSelectedCanonical: string[];
  revealedSourceCardIds: Set<string>;
  selectedIsland: Island | null;
  selectedCardCount: number;
  onCreateRepresentativeCard: () => void;
  onCardCritiqueChange: (value: string) => void;
  /** DOMAIN-TRACE-01: raw seq/source input for the selected card (empty = remove). */
  onCardMetaChange: (rawSeq: string, rawSource: string) => void;
  /** DOMAIN-KA-01: raw voice/value input for the selected card (empty = remove). */
  onCardKaChange: (rawVoice: string, rawValue: string) => void;
  onCardCritiqueTagsChange: (value: string[]) => void;
  onOpenCritiqueWorkflow: () => void;
  onCardClaimTypeChange: (value: ClaimType) => void;
  onCardHoldStateChange: (value: HoldState | "active") => void;
  onRestoreShelvedCard: (cardId: string) => void;
  onCardTextReviewedChange: (value: boolean) => void;
  /** DOMAIN-CARD-QUALITY-01: undefined = assist not open for the selected card. */
  cardQualityAssistState: CardQualityAssistState | undefined;
  onOpenCardQualityAssist: () => void;
  onAnswerCardQualityQuestion: (decision: CardQualityDecision) => void;
  onCloseCardQualityAssist: () => void;
  onOpenCardTextEditor: () => void;
  onCommitCardQualityText: (text: string) => void;
  onRestoreCardQualityText: () => void;
  onAddEvidenceLink: (payload: { toCardId: string; type: EvidenceLink["type"] }) => void;
  onRemoveEvidenceLink: (evidenceLinkId: string) => void;
  onUpdateEvidenceLink: (evidenceLinkId: string, patch: Partial<Pick<EvidenceLink, "contradictionState">>) => void;
  onFocusCardById: (cardId: string) => void;
  onTitleChange: (value: string) => void;
  onParentIslandChange: (value: string | undefined) => void;
  onPlacardCardChange: (value: string | undefined) => void;
  onPlacardCardTextChange: (value: string) => void;
  onTitleReviewedChange: (value: boolean) => void;
  onSummaryTextChange: (value: string) => void;
  onRestoreSummaryHistoryEntry: (historyEntryId: string) => void;
  onShowSummaryHistoryGrounding: (groundingIds: string[]) => void;
  // AI-OPPOSE-01 (M4): proposal-only opposing-viewpoint surface.
  opposingViewpointProposal: OpposingViewpointProposal | null;
  isProposingOpposingViewpoint: boolean;
  onProposeOpposingViewpoint: (cardId: string) => void;
  onDismissOpposingViewpointProposal: () => void;
  onSummaryReviewedChange: (value: boolean) => void;
  onSuggestIslandSummary: (critiqueText?: string) => void;
  // AI-MODEL-GOVERNANCE-01 (R2): per-operation model override for the island
  // summary suggestion ("" = auto / platform default).
  islandSummaryModel: string;
  onIslandSummaryModelChange: (model: string) => void;
  /** Tenant-allowed active models (guarded fetch owned by App); null = loading. */
  availableModels: AvailableModelItem[] | null;
  availableModelsUnavailableReason?: AvailableModelUnavailableReason | null;
  islandSummaryProposal: {
    proposalId: string;
    status: "proposed";
    diff: { after: string; candidates?: { summaryText: string; groundingIds: string[] }[] };
  } | null;
  proposalAuditTrail: string[];
  onAdoptIslandSummaryProposal: (candidateIndex: number, critiqueText?: string) => void;
  onRejectIslandSummaryProposal: () => void;
  onHoldIslandSummaryProposal: () => void;
  isSuggestingIslandSummary: boolean;
  isRecordingIslandSummaryDecision: boolean;
  islandSummarySuggestionWarnings: string[];
  summaryGroundingItems: SummaryGroundingItem[];
  onImageUrlChange: (value: string) => void;
  onImageReviewedChange: (value: boolean) => void;
  onRepresentativeVisualCueChange: (value: RepresentativeVisualCue | undefined) => boolean;
  onIslandCollapsedChange: (value: boolean) => void;
  isSelectedIslandCollapsed: boolean;
  hasIslands: boolean;
  isAnyIslandCollapsed: boolean;
  onCollapseAllIslands: () => void;
  onExpandAllIslands: () => void;
  onIslandCritiqueChange: (value: string) => void;
  onIslandCritiqueTagsChange: (value: string[]) => void;
  onAddSelectedCards: () => void;
  onRemoveSelectedCards: () => void;
  onDeleteIsland: () => void;
  onFocusIsland: () => void;
  onFocusCard: () => void;
  summaryView: boolean;
  abstractMapView: boolean;
  isSelectedIslandTemporarilyRevealed: boolean;
  onToggleSelectedIslandTemporaryReveal: () => void;
  isGridSnapEnabled: boolean;
  onGridSnapToggle: (value: boolean) => void;
  onGenerateIslandPolygon: () => void;
  onIslandShapeKindChange: (kind: "rect" | "polygon") => void;
  isPolygonVertexEditEnabled: boolean;
  onPolygonVertexEditEnabledChange: (value: boolean) => void;
  showCanonicalOnlyEdges: boolean;
  onShowCanonicalOnlyEdgesChange: (value: boolean) => void;
  onSourceCardInspect: (cardId: string) => void;
  onSummaryGroundingCardInspect: (cardId: string) => void;
  onShowAllSummaryGrounding: () => void;
  onClearTemporaryReveal: () => void;
  groundingVisibilityMessage: string | null;
  onShowAllSourcesChange: (value: boolean) => void;
  document: DocumentV1 | null;
  selectedIslandRelationEdge: IslandRelationEdgeSelection | null;
  selectedAggregatedEdge: AggregatedEdgeMeta | null;
  onRevealSelectedEdgeSources: () => void;
  onInspectSelectedEdgeCard: (cardId: string) => void;
  selectedRelationSummary: RelationSummary | null;
  safeMode: boolean;
  isGeneratingRelationSummary: boolean;
  onGenerateRelationSummary: () => void;
  onRelationSummaryCommit: (value: string) => void;
  onRestoreRelationSummaryHistoryEntry: (historyEntryId: string) => void;
  onRelationSummaryReviewedChange: (value: boolean) => void;
  onRelationSummaryGroundingInspect: (cardId: string) => void;
  onAlignLeft: () => void;
  onAlignRight: () => void;
  onAlignTop: () => void;
  onAlignBottom: () => void;
  onDistributeHorizontally: () => void;
  onDistributeVertically: () => void;
  canStartConnect: boolean;
  isPickingEdgeTarget: boolean;
  connectEdgeType: KnownEdgeType;
  onConnectEdgeTypeChange: (value: KnownEdgeType) => void;
  onStartConnect: () => void;
  onCancelConnect: () => void;
  /** DOMAIN-KJ-01: raw type of the selected edge IF it is a persisted document edge (null for derived/aggregate). */
  selectedPersistedEdgeType: EdgeType | null;
  onEdgeTypeChange: (edgeId: string, nextType: KnownEdgeType) => void;
  guidedFlowEnabled: boolean;
  onGuidedFlowEnabledChange: (value: boolean) => void;
  guidedFlowStepId: "review" | "classify" | "evidence" | "contradiction";
  guidedFlowStepIndex: number;
  guidedFlowTotalSteps: number;
  guidedFlowStepTitle: string;
  guidedFlowStepDescription: string;
  guidedFlowStepOptional: boolean;
  guidedFlowTargetIndex: number;
  guidedFlowTargetTotal: number;
  guidedFlowSuggestedActions: string[];
  onGuidedFlowPrevStep: () => void;
  onGuidedFlowNextStep: () => void;
  onGuidedFlowNextTarget: () => void;
  onGuidedFlowOpenRelevantEditor: () => void;
  guidedFlowOpenEditorRequestSeq: number;
  readingNavEnabled: boolean;
  onReadingNavEnabledChange: (value: boolean) => void;
  readingMode: "islands" | "islands+cards";
  onReadingModeChange: (value: "islands" | "islands+cards") => void;
  reviewedOnly: boolean;
  onReadingReviewedOnlyToggle: () => void;
  outlineIncludeCardTexts: boolean;
  onOutlineIncludeCardTextsChange: (value: boolean) => void;
  outlineIncludeRelationSummaries: boolean;
  onOutlineIncludeRelationSummariesChange: (value: boolean) => void;
  outlineIncludeUnreviewed: boolean;
  onOutlineIncludeUnreviewedChange: (value: boolean) => void;
  outlineAppendDiagnostics: boolean;
  onOutlineAppendDiagnosticsChange: (value: boolean) => void;
  outlineAppendRecommendations: boolean;
  /** DOMAIN-KA-01 (schemas.md §17.4): optional, default-OFF outline section listing cards with KA fields set. */
  outlineAppendKaFields: boolean;
  onOutlineAppendKaFieldsChange: (value: boolean) => void;
  onOutlineAppendRecommendationsChange: (value: boolean) => void;
  outlineQualityReport: OutlineQualityReport | null;
  outlineRecommendations: Recommendation[];
  contradictionReport: ContradictionReport | null;
  distributionReport: DistributionReport | null;
  claimTypeMixReport: ClaimTypeMixReport | null;
  evidenceGapReport: EvidenceGapReport | null;
  dialecticBalanceReport: DialecticBalanceReport | null;
  onRunOutlineDiagnostics: () => void;
  /** sensemaking_technique.md §4 (優先3-1): run deterministic void detection and store results. */
  onDetectVoids: () => void;
  isDiagnosticsRunning: boolean;
  onCancelDiagnostics: () => void;
  computeProgressMessage: string | null;
  onFocusOutlineDiagnosticRef: (kind: "island" | "card", id: string) => void;
  onFocusContradictionSignal: (signal: ContradictionSignal) => void;
  /** DOMAIN-EXPR-04 (schemas.md §16): human review decision on a contradiction signal. status=null reverts to undecided. */
  onContradictionSignalDecision: (signatureKey: string, status: ContradictionSignalReviewStatus | null) => void;
  onFocusDistributionIsland: (islandId: string) => void;
  onFocusDialecticBalanceFinding: (finding: BalanceFinding) => void;
  onCopyReadingOutlineMd: () => void;
  onDownloadReadingOutlineMd: () => void;
  onEvidenceTraceError: (message: string) => void;
  readingStep: number;
  readingTotal: number;
  currentReadingLabel: string | null;
  onReadingPrev: () => void;
  onReadingNext: () => void;
  readingOrderItems: ReadingOrderItem[];
  canAddSelectedItemToReadingOrder: boolean;
  onAddSelectedItemToReadingOrder: () => void;
  onMoveReadingOrderItem: (index: number, direction: -1 | 1) => void;
  onRemoveReadingOrderItem: (index: number) => void;
  aggregatedEdgeInspectorItems: AggregatedEdgeInspectorItem[];
  onPromoteAggregatedEdge: (edgeId: string) => void;
  evidenceOverlayEnabled: boolean;
  evidenceOverlayScope: "all" | "selection";
  onEnableEvidenceOverlaySelectionExplore: () => void;
  topContent?: ReactNode;
  importedPackSnapshotUrl?: string | null;
  importedPackDiagnosticsMd?: string | null;
  mergeAuditLog: MergeAuditEntry[];
  providerUnavailableMessage?: string | null;
};

const runWithoutTenantScope = <T,>(task: () => Promise<T>): Promise<T> => task();

export function SidePanel({
  selectedCard,
  sourceCardsForSelectedCanonical,
  missingSourceCardIdsForSelectedCanonical,
  revealedSourceCardIds,
  selectedIsland,
  selectedCardCount,
  onCreateRepresentativeCard,
  onCardCritiqueChange,
  onCardMetaChange,
  onCardKaChange,
  onCardCritiqueTagsChange,
  onOpenCritiqueWorkflow,
  onCardClaimTypeChange,
  onCardHoldStateChange,
  onRestoreShelvedCard,
  onCardTextReviewedChange,
  cardQualityAssistState,
  onOpenCardQualityAssist,
  onAnswerCardQualityQuestion,
  onCloseCardQualityAssist,
  onOpenCardTextEditor,
  onCommitCardQualityText,
  onRestoreCardQualityText,
  onAddEvidenceLink,
  onRemoveEvidenceLink,
  onUpdateEvidenceLink,
  onFocusCardById,
  onTitleChange,
  onParentIslandChange,
  onPlacardCardChange,
  onPlacardCardTextChange,
  onTitleReviewedChange,
  onSummaryTextChange,
  onRestoreSummaryHistoryEntry,
  onShowSummaryHistoryGrounding,
  opposingViewpointProposal,
  isProposingOpposingViewpoint,
  onProposeOpposingViewpoint,
  onDismissOpposingViewpointProposal,
  onSummaryReviewedChange,
  onSuggestIslandSummary,
  islandSummaryModel,
  onIslandSummaryModelChange,
  availableModels,
  availableModelsUnavailableReason,
  islandSummaryProposal,
  proposalAuditTrail,
  onAdoptIslandSummaryProposal,
  onRejectIslandSummaryProposal,
  onHoldIslandSummaryProposal,
  isSuggestingIslandSummary,
  isRecordingIslandSummaryDecision,
  islandSummarySuggestionWarnings,
  summaryGroundingItems,
  onImageUrlChange,
  onImageReviewedChange,
  onRepresentativeVisualCueChange,
  onIslandCollapsedChange,
  isSelectedIslandCollapsed,
  hasIslands,
  isAnyIslandCollapsed,
  onCollapseAllIslands,
  onExpandAllIslands,
  onIslandCritiqueChange,
  onIslandCritiqueTagsChange,
  onAddSelectedCards,
  onRemoveSelectedCards,
  onDeleteIsland,
  onFocusIsland,
  onFocusCard,
  summaryView,
  abstractMapView,
  isSelectedIslandTemporarilyRevealed,
  onToggleSelectedIslandTemporaryReveal,
  isGridSnapEnabled,
  onGridSnapToggle,
  onGenerateIslandPolygon,
  onIslandShapeKindChange,
  isPolygonVertexEditEnabled,
  onPolygonVertexEditEnabledChange,
  showCanonicalOnlyEdges,
  onShowCanonicalOnlyEdgesChange,
  onSourceCardInspect,
  onSummaryGroundingCardInspect,
  onShowAllSummaryGrounding,
  onClearTemporaryReveal,
  groundingVisibilityMessage,
  onShowAllSourcesChange,
  document,
  selectedIslandRelationEdge,
  selectedAggregatedEdge,
  onRevealSelectedEdgeSources,
  onInspectSelectedEdgeCard,
  selectedRelationSummary,
  safeMode,
  isGeneratingRelationSummary,
  onGenerateRelationSummary,
  onRelationSummaryCommit,
  onRestoreRelationSummaryHistoryEntry,
  onRelationSummaryReviewedChange,
  onRelationSummaryGroundingInspect,
  onAlignLeft,
  onAlignRight,
  onAlignTop,
  onAlignBottom,
  onDistributeHorizontally,
  onDistributeVertically,
  canStartConnect,
  isPickingEdgeTarget,
  connectEdgeType,
  onConnectEdgeTypeChange,
  onStartConnect,
  onCancelConnect,
  selectedPersistedEdgeType,
  onEdgeTypeChange,
  guidedFlowEnabled,
  onGuidedFlowEnabledChange,
  guidedFlowStepId,
  guidedFlowStepIndex,
  guidedFlowTotalSteps,
  guidedFlowStepTitle,
  guidedFlowStepDescription,
  guidedFlowStepOptional,
  guidedFlowTargetIndex,
  guidedFlowTargetTotal,
  guidedFlowSuggestedActions,
  onGuidedFlowPrevStep,
  onGuidedFlowNextStep,
  onGuidedFlowNextTarget,
  onGuidedFlowOpenRelevantEditor,
  guidedFlowOpenEditorRequestSeq,
  readingNavEnabled,
  onReadingNavEnabledChange,
  readingMode,
  onReadingModeChange,
  reviewedOnly,
  onReadingReviewedOnlyToggle,
  outlineIncludeCardTexts,
  onOutlineIncludeCardTextsChange,
  outlineIncludeRelationSummaries,
  onOutlineIncludeRelationSummariesChange,
  outlineIncludeUnreviewed,
  onOutlineIncludeUnreviewedChange,
  outlineAppendDiagnostics,
  onOutlineAppendDiagnosticsChange,
  outlineAppendRecommendations,
  outlineAppendKaFields,
  onOutlineAppendKaFieldsChange,
  onOutlineAppendRecommendationsChange,
  outlineQualityReport,
  outlineRecommendations,
  contradictionReport,
  distributionReport,
  claimTypeMixReport,
  evidenceGapReport,
  dialecticBalanceReport,
  onRunOutlineDiagnostics,
  onDetectVoids,
  isDiagnosticsRunning,
  onCancelDiagnostics,
  computeProgressMessage,
  onFocusOutlineDiagnosticRef,
  onFocusContradictionSignal,
  onContradictionSignalDecision,
  onFocusDistributionIsland,
  onFocusDialecticBalanceFinding,
  onCopyReadingOutlineMd,
  onDownloadReadingOutlineMd,
  onEvidenceTraceError,
  readingStep,
  readingTotal,
  currentReadingLabel,
  onReadingPrev,
  onReadingNext,
  readingOrderItems,
  canAddSelectedItemToReadingOrder,
  onAddSelectedItemToReadingOrder,
  onMoveReadingOrderItem,
  onRemoveReadingOrderItem,
  aggregatedEdgeInspectorItems,
  onPromoteAggregatedEdge,
  evidenceOverlayEnabled,
  evidenceOverlayScope,
  onEnableEvidenceOverlaySelectionExplore,
  topContent,
  importedPackSnapshotUrl,
  importedPackDiagnosticsMd,
  mergeAuditLog,
  providerUnavailableMessage,
  isReadOnly = false,
  isAdvancedUiEnabled = false,
  runTenantScopedOptionalTask = runWithoutTenantScope,
}: SidePanelProps) {
  const [hasImagePreviewError, setHasImagePreviewError] = useState(false);
  const cardQualityAssistTriggerRef = useRef<HTMLButtonElement>(null);
  const [cardQualityTextDraft, setCardQualityTextDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [islandSummaryCritique, setIslandSummaryCritique] = useState("");
  const [selectedIslandSummaryCandidateIndex, setSelectedIslandSummaryCandidateIndex] = useState(0);
  const [expandedSummaryHistoryEntryId, setExpandedSummaryHistoryEntryId] = useState<string | null>(null);
  const [relationSummaryDraft, setRelationSummaryDraft] = useState("");
  const [expandedRelationSummaryHistoryEntryId, setExpandedRelationSummaryHistoryEntryId] = useState<string | null>(null);
  const [expandedMergeAuditEntryId, setExpandedMergeAuditEntryId] = useState<string | null>(null);
  const [isAdvancedPanelOpen, setIsAdvancedPanelOpen] = useState(false);
  const [relationSummaryFeedback, setRelationSummaryFeedback] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<DomainStateFilter>({});
  const [copyExplanationFeedback, setCopyExplanationFeedback] = useState<"idle" | "copied" | "failed">("idle");
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState(false);
  const [pendingEvidenceType, setPendingEvidenceType] = useState<EvidenceLink["type"]>("supports");
  const [evidenceTargetQuery, setEvidenceTargetQuery] = useState("");
  const [pendingEvidenceTargetId, setPendingEvidenceTargetId] = useState<string>("");
  const [contradictionTraceDepthLimit, setContradictionTraceDepthLimit] = useState(1);
  const [contradictionTraceIncludeSupports, setContradictionTraceIncludeSupports] = useState(true);
  const [isTraceRunning, setIsTraceRunning] = useState(false);
  const [traceProgressMessage, setTraceProgressMessage] = useState<string | null>(null);
  const [isAnalyticsRunning, setIsAnalyticsRunning] = useState(false);
  const [traceAnalyticsMode, setTraceAnalyticsMode] = useState<"evidence" | "contradiction" | "both">("both");
  const [traceAnalyticsMd, setTraceAnalyticsMd] = useState<string | null>(null);
  const [traceAnalytics, setTraceAnalytics] = useState<TraceAnalytics | null>(null);
  const traceClientRef = useRef<TraceWorkerClient | null>(null);
  const traceAbortRef = useRef<AbortController | null>(null);
  const analyticsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setCardQualityTextDraft(selectedCard?.text ?? "");
  }, [cardQualityAssistState?.originalText, selectedCard?.id, selectedCard?.text]);

  const traceAnalyticsModeLabel = useMemo(() => {
    if (traceAnalyticsMode === "evidence") return t("side_panel.trace.mode_evidence");
    if (traceAnalyticsMode === "contradiction") return t("side_panel.trace.mode_contradiction");
    return t("side_panel.trace.mode_both");
  }, [traceAnalyticsMode]);

  const formatEvidenceRelationType = (type: string): string => {
    if (type === "supports") return t("side_panel.evidence.supports");
    if (type === "contradicts") return t("side_panel.evidence.contradicts");
    return type;
  };

  const summaryHistoryEntries = useMemo(() => {
    const entries = selectedIsland?.summaryHistory ?? [];
    return [...entries].reverse();
  }, [selectedIsland?.summaryHistory]);

  const relationSummaryHistoryEntries = useMemo(() => {
    const entries = selectedRelationSummary?.history ?? [];
    return [...entries].reverse();
  }, [selectedRelationSummary?.history]);

  const mergeAuditEntries = useMemo(() => {
    return [...mergeAuditLog].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [mergeAuditLog]);

  const copyText = async (value: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  };

  const buildMergeSummaryMarkdown = (entry: MergeAuditEntry): string => {
    const byKind = Object.entries(entry.summary.byKind)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([kind, count]) => `- ${kind}: ${count}`)
      .join("\n");
    return [
      `- ${t("side_panel.merge_history.timestamp")}: ${entry.createdAt}`,
      `- ${t("side_panel.merge_history.source")}: ${entry.source.fileName ?? entry.source.packId ?? t("side_panel.merge_history.unknown_source")}`,
      `- ${t("side_panel.merge_history.source_kind")}: ${entry.source.kind}`,
      `- ${t("side_panel.merge_history.total_items")}: ${entry.summary.totalItems}`,
      `- ${t("side_panel.merge_history.by_kind")}:`,
      byKind || `- ${t("side_panel.none")}`,
      `- ${t("side_panel.merge_history.item_ids")}: ${(entry.details.itemIds?.ids ?? []).join(", ") || t("side_panel.none")}`,
      `- ${t("side_panel.merge_history.card_ids")}: ${(entry.details.entityIds?.cards?.ids ?? []).join(", ") || t("side_panel.none")}`,
      `- ${t("side_panel.merge_history.island_ids")}: ${(entry.details.entityIds?.islands?.ids ?? []).join(", ") || t("side_panel.none")}`,
      `- ${t("side_panel.merge_history.evidence_ids")}: ${(entry.details.entityIds?.evidence?.ids ?? []).join(", ") || t("side_panel.none")}`,
    ].join("\n");
  };

  const renderIdList = (label: string, value?: { ids: string[]; truncatedCount?: number }) => {
    const listed = value?.ids ?? [];
    const truncated = value?.truncatedCount ?? 0;
    return (
      <div>
        {label}: {listed.join(", ") || t("side_panel.none")}
        {truncated > 0 ? ` (${t("side_panel.merge_history.truncated", { count: truncated })})` : ""}
      </div>
    );
  };

  const selectedIslandRelationExplanation = useMemo(() => {
    if (!document || !selectedIslandRelationEdge) {
      return null;
    }

    return buildIslandRelationExplanation(document, selectedIslandRelationEdge, safeMode);
  }, [document, safeMode, selectedIslandRelationEdge]);

  useEffect(() => {
    setHasImagePreviewError(false);
  }, [selectedIsland?.id, selectedIsland?.imageUrl]);

  useEffect(() => {
    if (guidedFlowOpenEditorRequestSeq <= 0) {
      return;
    }

    if (guidedFlowStepId !== "evidence" && guidedFlowStepId !== "contradiction") {
      return;
    }

    if (!selectedCard) {
      return;
    }

    setIsEvidenceModalOpen(true);
  }, [guidedFlowOpenEditorRequestSeq, guidedFlowStepId, selectedCard]);

  useEffect(() => {
    setSummaryDraft(selectedIsland?.summaryText ?? "");
    setExpandedSummaryHistoryEntryId(null);
  }, [selectedIsland?.id, selectedIsland?.summaryText]);

  useEffect(() => {
    setRelationSummaryDraft(selectedRelationSummary?.text ?? "");
    setExpandedRelationSummaryHistoryEntryId(null);
    setRelationSummaryFeedback(null);
  }, [selectedRelationSummary?.sourceSignature, selectedRelationSummary?.text]);

  useEffect(() => {
    setCopyExplanationFeedback("idle");
  }, [selectedIslandRelationEdge?.edgeId]);

  useEffect(() => {
    return () => {
      traceAbortRef.current?.abort();
      analyticsAbortRef.current?.abort();
      traceClientRef.current?.dispose();
    };
  }, []);


  useEffect(() => {
    if (!document || !selectedCard) {
      setTraceAnalytics(null);
      setTraceAnalyticsMd(null);
      return;
    }

    if (!traceClientRef.current) {
      traceClientRef.current = new TraceWorkerClient();
    }

    analyticsAbortRef.current?.abort();
    const controller = new AbortController();
    analyticsAbortRef.current = controller;
    setIsAnalyticsRunning(true);
    const traceClient = traceClientRef.current;
    void runTenantScopedOptionalTask(() => traceClient.computeTraceAnalytics({
      doc: document,
      options: {
        startCardId: selectedCard.id,
        maxHops: 4,
        maxNodes: 80,
        kind: traceAnalyticsMode,
        safeMode,
        includeCycleDetection: true,
      },
    }, {
      signal: controller.signal,
      onProgress: (progress) => setTraceProgressMessage(t("side_panel.trace.analytics_progress", { mode: traceAnalyticsModeLabel, stage: progress.stage, percent: progress.percent })),
    })).then((outcome) => {
      if (outcome === undefined || outcome.status !== "completed") {
        return;
      }
      setTraceAnalytics(outcome.result.analytics);
      setTraceAnalyticsMd(outcome.result.analyticsMd);
    }).catch(() => {
      onEvidenceTraceError(t("side_panel.trace.analytics_failed"));
    }).finally(() => {
      if (analyticsAbortRef.current === controller) {
        analyticsAbortRef.current = null;
      }
      setIsAnalyticsRunning(false);
      setTraceProgressMessage(null);
    });

    return () => {
      controller.abort();
      if (analyticsAbortRef.current === controller) {
        analyticsAbortRef.current = null;
      }
    };
  }, [document, onEvidenceTraceError, runTenantScopedOptionalTask, safeMode, selectedCard, traceAnalyticsMode, traceAnalyticsModeLabel]);

  const hasCardSelection = selectedCardCount > 0;
  const canAlign = selectedCardCount >= 2;
  const hideUnreviewedRelationSummary = safeMode && selectedRelationSummary?.reviewed === false;
  const canDistribute = selectedCardCount >= 3;
  const selectedCardLabel = selectedCardCount === 1
    ? t("side_panel.selection.card_single")
    : t("side_panel.selection.card_multiple", { count: selectedCardCount });
  const selectedIslandTitle = selectedIsland && document
    ? resolveIslandDisplayTitle(selectedIsland, document.islands)
    : "";
  const selectedCardText = selectedCard?.text.trim() || selectedCard?.id || "";
  const cardQualityOriginalText = cardQualityAssistState
    ? cardQualityRestoreTarget(cardQualityAssistState)
    : undefined;
  const selectedCardReviewState = selectedCard?.textReviewed === true ? t("side_panel.reviewed") : t("side_panel.unreviewed");
  const selectedIslandReviewState = selectedIsland?.summaryReviewed === true ? t("side_panel.reviewed") : t("side_panel.unreviewed");

  const visibleRecommendations = outlineRecommendations;

  const outgoingEvidenceLinks = useMemo(() => {
    if (!document || !selectedCard) return [];
    return (document.evidenceLinks ?? []).filter((link) => link.fromCardId === selectedCard.id);
  }, [document, selectedCard]);

  const incomingEvidenceLinks = useMemo(() => {
    if (!document || !selectedCard) return [];
    return (document.evidenceLinks ?? []).filter((link) => link.toCardId === selectedCard.id);
  }, [document, selectedCard]);

  const availableEvidenceTargets = useMemo(() => {
    if (!document || !selectedCard) return [];
    const query = evidenceTargetQuery.trim().toLowerCase();
    return document.cards
      .filter((card) => card.id !== selectedCard.id)
      .filter((card) => (query.length === 0 ? true : card.text.toLowerCase().includes(query) || card.id.toLowerCase().includes(query)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [document, evidenceTargetQuery, selectedCard]);

  const evidenceGapFindingsByCode = useMemo(() => {
    const map: Record<"E001" | "E002" | "E003" | "E004", EvidenceGapReport["findings"]> = { E001: [], E002: [], E003: [], E004: [] };
    if (!evidenceGapReport) return map;
    for (const finding of evidenceGapReport.findings) {
      map[finding.code] = [...map[finding.code], finding];
    }
    return map;
  }, [evidenceGapReport]);

  const selectedCardContradictionsCount = useMemo(() => {
    if (!selectedCard || !document) {
      return 0;
    }

    return (document.evidenceLinks ?? []).filter((link) => link.type === "contradicts" && (link.toCardId === selectedCard.id || link.fromCardId === selectedCard.id)).length;
  }, [document, selectedCard]);

  const computeTraceMarkdown = async (kind: "evidence" | "contradiction") => {
    if (!document || !selectedCard) {
      return null;
    }
    if (!traceClientRef.current) {
      traceClientRef.current = new TraceWorkerClient();
    }
    const traceClient = traceClientRef.current;

    traceAbortRef.current?.abort();
    const controller = new AbortController();
    traceAbortRef.current = controller;
    setIsTraceRunning(true);

    const outcome = await runTenantScopedOptionalTask(() => runTraceRequest({
      execute: () => traceClient.computeTrace({
        doc: document,
        options: {
          kind,
          startCardId: selectedCard.id,
          maxHops: contradictionTraceDepthLimit,
          maxNodes: 80,
          safeMode,
          includeRationale: contradictionTraceIncludeSupports,
        },
      }, {
        signal: controller.signal,
        onProgress: (progress) => setTraceProgressMessage(t("side_panel.trace.progress", {
          kind: kind === "evidence" ? t("side_panel.trace.evidence_trace") : t("side_panel.trace.contradiction_trace"),
          stage: progress.stage,
          percent: progress.percent,
        })),
      }),
      onRejected: () => onEvidenceTraceError(t(
        controller.signal.aborted
          ? "side_panel.trace.cancelled"
          : "side_panel.trace.failed",
      )),
      onSettled: () => {
        if (traceAbortRef.current === controller) {
          traceAbortRef.current = null;
          setIsTraceRunning(false);
          setTraceProgressMessage(null);
        }
      },
    }));
    if (outcome === undefined || outcome === null) {
      return null;
    }

    if (outcome.status === "cancelled") {
      onEvidenceTraceError(t("side_panel.trace.cancelled"));
      return null;
    }
    if (outcome.result.traceMd.startsWith("Error:")) {
      onEvidenceTraceError(outcome.result.traceMd);
      return null;
    }

    return outcome.result.traceMd;
  };

  const handleCopyContradictionTrace = async () => {
    const markdown = await computeTraceMarkdown("contradiction");
    if (!markdown) {
      return;
    }

    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      onEvidenceTraceError(t("side_panel.trace.copy_contradiction_failed"));
    }
  };

  const handleDownloadContradictionTrace = () => {
    void computeTraceMarkdown("contradiction").then((markdown) => {
      if (!markdown) {
        return;
      }
      downloadTextFile("contradiction_trace.md", "text/markdown", markdown);
    });
  };

  const handleCopyEvidenceTrace = async () => {
    const markdown = await computeTraceMarkdown("evidence");
    if (!markdown) {
      return;
    }

    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      onEvidenceTraceError(t("side_panel.trace.copy_evidence_failed"));
    }
  };

  const handleDownloadEvidenceTrace = () => {
    void computeTraceMarkdown("evidence").then((markdown) => {
      if (!markdown) {
        return;
      }
      downloadTextFile("evidence_trace.md", "text/markdown", markdown);
    });
  };

  const handleDownloadTraceAnalytics = () => {
    if (!traceAnalyticsMd || !selectedCard) {
      return;
    }
    downloadTextFile(`trace_analytics_${selectedCard.id}.md`, "text/markdown", traceAnalyticsMd);
  };

  const outlineDiagnosticsCounts = useMemo(() => {
    if (!outlineQualityReport) {
      return { error: 0, warn: 0, info: 0 };
    }

    return outlineQualityReport.findings.reduce((acc, finding) => {
      acc[finding.severity] += 1;
      return acc;
    }, { error: 0, warn: 0, info: 0 });
  }, [outlineQualityReport]);


  const claimTypeLabels: Record<ClaimType, string> = {
    fact: t("side_panel.claim_type.fact"),
    claim: t("side_panel.claim_type.claim"),
    hypothesis: t("side_panel.claim_type.hypothesis"),
    unknown: t("side_panel.claim_type.unknown"),
  };

  const critiqueTagLabels: Record<CritiqueTag, string> = {
    too_close: t("side_panel.critique.tag.too_close"),
    too_far: t("side_panel.critique.tag.too_far"),
    not_the_same: t("side_panel.critique.tag.not_the_same"),
    feels_off: t("side_panel.critique.tag.feels_off"),
    no_articulable_reason: t("side_panel.critique.tag.no_articulable_reason"),
  };
  const legacyCritiqueTagLabels: Record<string, string> = {
    belongs_together: t("side_panel.critique.tag.belongs_together"),
    unrelated: t("side_panel.critique.tag.unrelated"),
    unclear_boundary: t("side_panel.critique.tag.unclear_boundary"),
  };
  const getCritiqueTagLabel = (tag: string): string =>
    critiqueTagLabels[tag as CritiqueTag] ?? legacyCritiqueTagLabels[tag] ?? tag;

  // ADR-0048 D1: claimType=色チャネル。hypothesis=violet。amber は保留/違和感(保持系)に予約し
  // claimType へは使わない（同一チャネルに2意味を載せない）。CardView.CLAIM_TYPE_STYLE と一致させる。
  const claimTypeBadgeColors: Record<ClaimType, { backgroundColor: string; color: string }> = {
    fact: { backgroundColor: "#dcfce7", color: "#166534" },
    claim: { backgroundColor: "#dbeafe", color: "#1d4ed8" },
    hypothesis: { backgroundColor: "#f3e8ff", color: "#6b21a8" },
    unknown: { backgroundColor: "#e2e8f0", color: "#334155" },
  };

  const contradictionSignalsBySeverity = useMemo(() => {
    if (!contradictionReport) {
      return { warn: [] as ContradictionSignal[], info: [] as ContradictionSignal[] };
    }

    return contradictionReport.signals.reduce((acc, signal) => {
      acc[signal.severity].push(signal);
      return acc;
    }, { warn: [] as ContradictionSignal[], info: [] as ContradictionSignal[] });
  }, [contradictionReport]);

  // DOMAIN-EXPR-04 (schemas.md §16.2): current human decision per signal, keyed
  // by the same deterministic signature used to persist it. Absence = undecided.
  const contradictionSignalDecisionByKey = useMemo(() => {
    const map = new Map<string, ContradictionSignalReviewStatus>();
    for (const entry of document?.contradictionSignalDecisions ?? []) {
      map.set(entry.signatureKey, entry.status);
    }
    return map;
  }, [document?.contradictionSignalDecisions]);

  const CONTRADICTION_DECISION_BADGE_STYLE: Record<ContradictionSignalReviewStatus, { backgroundColor: string; color: string }> = {
    accepted: { backgroundColor: "#dcfce7", color: "#166534" },
    held: { backgroundColor: "#fed7aa", color: "#92400e" },
    rejected: { backgroundColor: "#e2e8f0", color: "#475569" },
  };

  // DOMAIN-EXPR-04 (schemas.md §16.4): renders always regardless of decision —
  // a rejected signal stays visible as "reviewed and set aside", not hidden.
  const renderContradictionDecisionControls = (signal: ContradictionSignal) => {
    const signatureKey = signatureKeyForContradictionSignal(signal);
    const status = contradictionSignalDecisionByKey.get(signatureKey) ?? null;
    return (
      <div data-contradiction-decision="" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        {status ? (
          <span style={{ fontSize: 10, fontWeight: 600, borderRadius: 999, padding: "1px 6px", ...CONTRADICTION_DECISION_BADGE_STYLE[status] }}>
            {t(`side_panel.outline.contradiction_decision.status_${status}`)}
          </span>
        ) : null}
        <button
          type="button"
          disabled={status === "accepted"}
          onClick={() => { onContradictionSignalDecision(signatureKey, "accepted"); }}
          style={{ fontSize: 10, cursor: "pointer" }}
        >
          {t("side_panel.outline.contradiction_decision.accept")}
        </button>
        <button
          type="button"
          disabled={status === "held"}
          onClick={() => { onContradictionSignalDecision(signatureKey, "held"); }}
          style={{ fontSize: 10, cursor: "pointer" }}
        >
          {t("side_panel.outline.contradiction_decision.hold")}
        </button>
        <button
          type="button"
          disabled={status === "rejected"}
          onClick={() => { onContradictionSignalDecision(signatureKey, "rejected"); }}
          style={{ fontSize: 10, cursor: "pointer" }}
        >
          {t("side_panel.outline.contradiction_decision.reject")}
        </button>
        {status ? (
          <button
            type="button"
            onClick={() => { onContradictionSignalDecision(signatureKey, null); }}
            style={{ fontSize: 10, cursor: "pointer", color: "#64748b" }}
          >
            {t("side_panel.outline.contradiction_decision.undo")}
          </button>
        ) : null}
      </div>
    );
  };

  const islandDistributionRows = useMemo(() => {
    if (!document) {
      return [] as Array<{ id: string; title: string; cardCount: number; degree: number }>;
    }
    const rankings = rankDistributionIslands(document, document.islands.length);
    const islandById = new Map(document.islands.map((island) => [island.id, island] as const));
    return rankings.loaded.map((row) => {
      const island = islandById.get(row.id);
      return {
        id: row.id,
        title: island ? resolveIslandDisplayTitle(island, document.islands) : row.id,
        cardCount: row.cardCount,
        degree: row.degree,
      };
    });
  }, [document]);

  const loadedIslands = useMemo(() => {
    return [...islandDistributionRows]
      .sort((left, right) => (right.cardCount - left.cardCount) || (right.degree - left.degree) || left.id.localeCompare(right.id))
      .slice(0, 5);
  }, [islandDistributionRows]);

  const isolatedIslands = useMemo(() => {
    return islandDistributionRows
      .filter((island) => island.degree === 0)
      .sort((left, right) => (right.cardCount - left.cardCount) || left.id.localeCompare(right.id))
      .slice(0, 5);
  }, [islandDistributionRows]);

  const parentIslandOptions = useMemo(() => {
    return (document?.islands ?? [])
      .filter((island) => island.id !== selectedIsland?.id)
      .map((island) => ({
        id: island.id,
        label: `${resolveIslandDisplayTitle(island, document?.islands ?? [])} (${island.id})`,
      }));
  }, [document?.islands, selectedIsland?.id]);

  const claimTypeMixSection = claimTypeMixReport ? (
    <details style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 12, cursor: "pointer", color: "#7c3aed" }}>
        {t("side_panel.claim_type.mix_title", { count: claimTypeMixReport.findings.length })}
      </summary>
      <div style={{ fontSize: 11, color: "#334155", marginTop: 6 }}>
        {t("side_panel.claim_type.mix_stats", {
          cards: claimTypeMixReport.stats.totalCards,
          facts: claimTypeMixReport.stats.countsByType.fact,
          claims: claimTypeMixReport.stats.countsByType.claim,
          hypotheses: claimTypeMixReport.stats.countsByType.hypothesis,
          unknown: claimTypeMixReport.stats.countsByType.unknown,
        })}
      </div>
      <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>
        {t("side_panel.claim_type.mix_island_stats", {
          checked: claimTypeMixReport.stats.islandsChecked,
          mixed: claimTypeMixReport.stats.islandsMixedCount,
          hypothesisDominant: claimTypeMixReport.stats.islandsHypothesisDominantCount,
          unknownDominant: claimTypeMixReport.stats.islandsUnknownDominantCount,
        })}
      </div>
      {claimTypeMixReport.findings.length === 0 ? (
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.claim_type.no_findings")}</div>
      ) : (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
          {claimTypeMixReport.findings.map((finding, index) => (
            <li key={`${finding.code}_${index}`} style={{ fontSize: 11, color: "#0f172a" }}>
              <div style={{ fontWeight: 600 }}>[{diagnosticSeverityLabel(finding.severity)}] {finding.code} {finding.title}</div>
              <div>{finding.detail}</div>
              {finding.suggestedAction ? <div style={{ color: "#334155" }}>{t("side_panel.outline.action", { suggestedAction: finding.suggestedAction })}</div> : null}
              {finding.islandIds.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {finding.islandIds.map((islandId) => (
                    <button key={`${finding.code}_${islandId}`} type="button" onClick={() => { onFocusDistributionIsland(islandId); }} style={{ fontSize: 10, cursor: "pointer" }}>
                      {t("side_panel.focus_item", { id: islandId })}
                    </button>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </details>
  ) : null;

  const evidenceGapSection = evidenceGapReport ? (
    <details style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 12, cursor: "pointer", color: "#7c3aed" }}>{t("side_panel.evidence_gap.title", { count: evidenceGapReport.findings.length })}</summary>
      <div style={{ marginTop: 6, fontSize: 11, color: "#334155", display: "grid", gap: 4 }}>
        <div>{t("side_panel.evidence_gap.links", { total: evidenceGapReport.stats.totalLinks, supports: evidenceGapReport.stats.supportsLinks, contradicts: evidenceGapReport.stats.contradictsLinks })}</div>
        <div>{t("side_panel.evidence_gap.hypotheses_no_fact", { count: evidenceGapReport.stats.hypothesesWithNoFactSupport })}</div>
        <div>{t("side_panel.evidence_gap.claims_no_fact", { count: evidenceGapReport.stats.claimsWithNoFactSupport })}</div>
        <div>{t("side_panel.evidence_gap.unused_facts", { count: evidenceGapReport.stats.factsUnusedAsEvidence })}</div>
        <div>{t("side_panel.evidence_gap.contradictions_need_grounding", { count: evidenceGapReport.stats.contradictionsWithoutCounterSupport })}</div>
      </div>
      {(["E001", "E002", "E003", "E004"] as const).map((code) => {
        const findings = evidenceGapFindingsByCode[code] ?? [];
        if (findings.length === 0) return null;
        const titleByCode: Record<string, string> = {
          E001: t("side_panel.evidence_gap.title_e001"),
          E002: t("side_panel.evidence_gap.title_e002"),
          E003: t("side_panel.evidence_gap.title_e003"),
          E004: t("side_panel.evidence_gap.title_e004"),
        };

        return (
          <details key={code} style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 11, cursor: "pointer", color: "#1f2937" }}>{titleByCode[code]} ({findings.length})</summary>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
              {findings.map((finding, index) => (
                <li key={`${code}_${index}`} style={{ fontSize: 11, color: "#0f172a" }}>
                  <div>{finding.detail}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                    {finding.cardIds.map((cardId) => (
                      <button key={`${code}_${index}_${cardId}`} type="button" style={{ fontSize: 10 }} onClick={() => { onFocusCardById(cardId); }}>
                        {t("side_panel.evidence_gap.focus_card", { cardId })}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </details>
  ) : null;

  const distributionSignalsSection = distributionReport ? (
    <details style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 12, cursor: "pointer", color: "#7c3aed" }}>
        {t("side_panel.distribution.title", { count: distributionReport.findings.length })}
      </summary>
      <div style={{ fontSize: 11, color: "#334155", marginTop: 6 }}>
        {t("side_panel.distribution.stats", {
          islands: distributionReport.stats.islandCount,
          cards: distributionReport.stats.cardCount,
          avg: distributionReport.stats.avgCardsPerIsland.toFixed(2),
          median: distributionReport.stats.medianCardsPerIsland.toFixed(2),
          p90: distributionReport.stats.p90CardsPerIsland.toFixed(2),
        })}
      </div>
      {distributionReport.findings.length === 0 ? (
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.distribution.none")}</div>
      ) : (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
          {distributionReport.findings.map((finding, index) => (
            <li key={`${finding.code}_${index}`} style={{ fontSize: 11, color: "#0f172a" }}>
              <div style={{ fontWeight: 600 }}>[{diagnosticSeverityLabel(finding.severity)}] {finding.code} {finding.title}</div>
              <div>{finding.detail}</div>
              {finding.suggestedAction ? <div style={{ color: "#334155" }}>{t("side_panel.outline.action", { suggestedAction: finding.suggestedAction })}</div> : null}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>{t("side_panel.distribution.most_loaded")}</div>
        {loadedIslands.length === 0 ? (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{t("side_panel.distribution.no_islands")}</div>
        ) : (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
            {loadedIslands.map((item) => (
              <li key={`loaded_${item.id}`} style={{ fontSize: 11, color: "#0f172a" }}>
                <div>{t("side_panel.distribution.item_stats", { title: item.title, cards: item.cardCount, degree: item.degree })}</div>
                <button type="button" onClick={() => { onFocusDistributionIsland(item.id); }} style={{ fontSize: 10, cursor: "pointer", marginTop: 2 }}>{t("side_panel.focus")}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>{t("side_panel.distribution.most_isolated")}</div>
        {isolatedIslands.length === 0 ? (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{t("side_panel.distribution.no_isolated")}</div>
        ) : (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
            {isolatedIslands.map((item) => (
              <li key={`isolated_${item.id}`} style={{ fontSize: 11, color: "#0f172a" }}>
                <div>{t("side_panel.distribution.item_stats", { title: item.title, cards: item.cardCount, degree: item.degree })}</div>
                <button type="button" onClick={() => { onFocusDistributionIsland(item.id); }} style={{ fontSize: 10, cursor: "pointer", marginTop: 2 }}>{t("side_panel.focus")}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  ) : null;


  const structuralMetrics = useMemo(() => {
    if (!document) {
      return null;
    }
    return computeStructureMetrics(document);
  }, [document]);

  const metricsSection = structuralMetrics ? (
    <details style={{ marginTop: 8 }} open>
      <summary style={{ fontSize: 12, cursor: "pointer", color: "#7c3aed" }}>{t("side_panel.metrics.title")}</summary>
      <div style={{ marginTop: 6, fontSize: 11, color: "#334155", display: "grid", gap: 4 }}>
        <div>{t("side_panel.metrics.card_count", { value: structuralMetrics.cardCount })}</div>
        <div>{t("side_panel.metrics.island_count", { value: structuralMetrics.islandCount })}</div>
        <div>{t("side_panel.metrics.evidence_link_count", { value: structuralMetrics.evidenceLinkCount })}</div>
        <div>{t("side_panel.metrics.evidence_link_density", { value: structuralMetrics.evidenceLinkDensity.toFixed(4) })}</div>
        <div>{t("side_panel.metrics.isolated_cards", { value: structuralMetrics.isolatedCardCount })}</div>
        <div>{t("side_panel.metrics.isolation_rate", { value: structuralMetrics.isolationRate.toFixed(4) })}</div>
        <div>{t("side_panel.metrics.connected_components", { value: structuralMetrics.connectedComponentCount })}</div>
        <div>{t("side_panel.metrics.largest_component_ratio", { value: structuralMetrics.largestComponentRatio.toFixed(4) })}</div>
        <div>{t("side_panel.metrics.average_degree", { value: structuralMetrics.averageDegree.toFixed(4) })}</div>
        <div>{t("side_panel.metrics.degree_p95", { value: structuralMetrics.degreeP95 })}</div>
        <div>{t("side_panel.metrics.degree_skew_ratio", { value: structuralMetrics.degreeSkewRatio.toFixed(4) })}</div>
        <div>{t("side_panel.metrics.bridge_edges", { value: structuralMetrics.bridgeEdgeCount })}</div>
        {structuralMetrics.contradictionRatio === null ? null : <div>{t("side_panel.metrics.contradiction_ratio", { value: structuralMetrics.contradictionRatio.toFixed(4) })}</div>}
        {structuralMetrics.reviewedCoverage === null ? null : <div>{t("side_panel.metrics.reviewed_coverage", { value: structuralMetrics.reviewedCoverage.toFixed(4) })}</div>}
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#334155" }}>{t("side_panel.metrics.island_size_distribution")}</div>
        {structuralMetrics.islandSizeDistribution.length === 0 ? (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{t("side_panel.none")}</div>
        ) : (
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
            {structuralMetrics.islandSizeDistribution.map((bin) => (
              <li key={`size_${bin.size}`} style={{ fontSize: 11, color: "#0f172a" }}>
                {t("side_panel.metrics.island_size_bin", { size: bin.size, islands: bin.islands })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  ) : null;

  const dialecticBalanceSection = dialecticBalanceReport ? (
    <details style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 12, cursor: "pointer", color: "#7c3aed" }}>{t("side_panel.dialectic.title", { count: dialecticBalanceReport.findings.length })}</summary>
      <div style={{ marginTop: 6, fontSize: 11, color: "#334155", display: "grid", gap: 4 }}>
        <div>{t("side_panel.dialectic.hypotheses", { total: dialecticBalanceReport.stats.hypothesisCount, supported: dialecticBalanceReport.stats.hypothesisWithSupportCount, contradicted: dialecticBalanceReport.stats.hypothesisWithContradictionCount })}</div>
        <div>{t("side_panel.dialectic.claims", { total: dialecticBalanceReport.stats.claimCount, supported: dialecticBalanceReport.stats.claimWithSupportCount, contradicted: dialecticBalanceReport.stats.claimWithContradictionCount })}</div>
        <div>{t("side_panel.dialectic.facts", { count: dialecticBalanceReport.stats.factCount })}</div>
        <div>{t("side_panel.dialectic.links", { supports: dialecticBalanceReport.stats.supportsCount, contradicts: dialecticBalanceReport.stats.contradictsCount })}</div>
      </div>
      {dialecticBalanceReport.findings.length === 0 ? (
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.dialectic.none")}</div>
      ) : (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
          {dialecticBalanceReport.findings.map((finding, index) => (
            <li key={`${finding.code}_${index}`} style={{ fontSize: 11, color: "#0f172a" }}>
              <div style={{ fontWeight: 600 }}>[{diagnosticSeverityLabel(finding.severity)}] {finding.code} {finding.title}</div>
              <div>{finding.detail}</div>
              <div style={{ color: "#334155" }}>{t("side_panel.outline.action", { suggestedAction: finding.suggestedAction })}</div>
              {finding.cardIds && finding.cardIds.length > 0 ? (
                <button
                  type="button"
                  style={{ fontSize: 10, marginTop: 4, cursor: "pointer" }}
                  onClick={() => {
                    onFocusDialecticBalanceFinding(finding);
                  }}
                >
                  {t("side_panel.dialectic.focus_sample")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </details>
  ) : null;


  const handleCopyExplanationClick = async () => {
    if (!selectedIslandRelationExplanation) {
      return;
    }

    try {
      await navigator.clipboard.writeText(formatIslandRelationExplanationMarkdown(selectedIslandRelationExplanation));
      setCopyExplanationFeedback("copied");
    } catch {
      setCopyExplanationFeedback("failed");
    }
  };

  const handleDeleteIslandClick = () => {
    if (!selectedIsland) {
      return;
    }

    const shouldDelete = window.confirm(`Delete island \"${selectedIsland.title ?? selectedIsland.id}\"?`);
    if (!shouldDelete) {
      return;
    }

    onDeleteIsland();
  };

  const handleRemoveSelectedCardsClick = () => {
    if (!selectedIsland || !hasCardSelection) {
      return;
    }

    const shouldRemove = window.confirm(
      `Remove ${selectedCardLabel} from island "${selectedIsland.title ?? selectedIsland.id}"?`
    );
    if (!shouldRemove) {
      return;
    }

    onRemoveSelectedCards();
  };

  const hasSourceCardsForSelectedCanonical = sourceCardsForSelectedCanonical.length > 0;
  const hasMissingSourceCardsForSelectedCanonical = missingSourceCardIdsForSelectedCanonical.length > 0;
  const isShowingAllSources =
    hasSourceCardsForSelectedCanonical &&
    sourceCardsForSelectedCanonical.every((card) => revealedSourceCardIds.has(card.id));

  const toggleCritiqueTag = (currentTags: string[] | undefined, tag: CritiqueTag): string[] => {
    const currentTagSet = new Set(currentTags ?? []);
    if (currentTagSet.has(tag)) {
      currentTagSet.delete(tag);
    } else {
      currentTagSet.add(tag);
    }

    return CRITIQUE_TAGS.filter((candidateTag) => currentTagSet.has(candidateTag));
  };

  return (
    <aside
      data-ui-region="selection-context"
      style={{
        width: 320,
        minWidth: 320,
        borderLeft: "1px solid #e2e8f0",
        backgroundColor: "#ffffff",
        padding: 12,
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      {isReadOnly ? (
        <div data-ui-region="read-only-banner" style={{ fontSize: 12, color: "#9a3412", backgroundColor: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 6, padding: 8, marginBottom: 12 }}>
          {t("read_only.banner.active")}
        </div>
      ) : null}
      <section
        data-panel="selection-context"
        aria-label={t("side_panel.context.title")}
        aria-live="polite"
        tabIndex={-1}
        style={{
          marginBottom: 12,
          padding: 10,
          border: "1px solid #c7d2fe",
          borderRadius: 8,
          backgroundColor: "#eef2ff",
          display: "grid",
          gap: 8,
        }}
      >
        {/* UI-QUALITY-A11Y-02: aria-live=polite on the whole region announces
            selection changes without requiring manual navigation to it. */}
        <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>{t("side_panel.context.title")}</div>
        {selectedIsland ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{t("side_panel.context.island_selected")}</div>
            <div style={{ fontSize: 12, color: "#334155", overflowWrap: "anywhere" }}>
              {t("side_panel.context.target", { value: selectedIslandTitle })}
            </div>
            <div style={{ fontSize: 12, color: "#475569" }}>
              {t("side_panel.context.review_state", { value: selectedIslandReviewState })}
            </div>
            <button
              type="button"
              onClick={onFocusIsland}
              style={{ width: "100%", border: "1px solid #a5b4fc", backgroundColor: "#ffffff", borderRadius: 6, padding: "6px 8px", fontWeight: 600, cursor: "pointer" }}
            >
              {t("side_panel.context.focus_selected_island")}
            </button>
          </>
        ) : selectedCard ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{t("side_panel.context.card_selected")}</div>
            <div style={{ fontSize: 12, color: "#334155", overflowWrap: "anywhere" }}>
              {t("side_panel.context.target", { value: selectedCardText })}
            </div>
            {/* UI-QUALITY-A11Y-02: read/DOM order fixed to 型→保持系→確認→根拠
                (type → hold-state → review → evidence), per the a11y spec's
                selection-context row. Was previously review→type→evidence→hold. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: "#475569", marginBottom: 2 }}>
              {selectedCard?.claimType && selectedCard.claimType !== "unknown" ? (
                <span>{t("side_panel.context.claim_type", { value: selectedCard.claimType })}</span>
              ) : null}
              {selectedCard?.holdState ? (
                <span style={{ color: "#92400e" }}>
                  {t("side_panel.context.hold_brief", { value: t(`side_panel.hold_state.${selectedCard.holdState}`) })}
                </span>
              ) : null}
              <span>{t("side_panel.context.review_state", { value: selectedCardReviewState })}</span>
              {(outgoingEvidenceLinks.length > 0 || incomingEvidenceLinks.length > 0) ? (
                <span style={{ color: "#0369a1" }}>{t("side_panel.context.evidence_brief", { n: outgoingEvidenceLinks.length + incomingEvidenceLinks.length })}</span>
              ) : null}
            </div>
            {selectedCard?.claimType && selectedCard.claimType !== "unknown" ? (
              <div style={{ fontSize: 12, color: "#475569" }}>
                {t("side_panel.context.claim_type", { value: claimTypeLabels[selectedCard.claimType] })}
              </div>
            ) : null}
            {outgoingEvidenceLinks.length > 0 || incomingEvidenceLinks.length > 0 ? (
              <div style={{ fontSize: 12, color: "#475569" }}>
                {t("side_panel.context.evidence_links", { outgoing: outgoingEvidenceLinks.length, incoming: incomingEvidenceLinks.length })}
              </div>
            ) : null}
            {selectedCardContradictionsCount > 0 ? (
              <div style={{ fontSize: 12, color: "#9a3412", fontWeight: 600 }}>
                {t("side_panel.context.contradictions", { count: selectedCardContradictionsCount })}
              </div>
            ) : null}
            {selectedCard?.holdState ? (
              <div style={{ fontSize: 12, color: "#92400e", backgroundColor: "#fef3c7", borderRadius: 4, padding: "2px 6px", display: "inline-block", marginTop: 2 }}>
                {t("side_panel.context.hold_state", { value: t(`side_panel.hold_state.${selectedCard.holdState}`) })}
              </div>
            ) : null}
            {selectedCard?.critique ? (
              <div style={{ fontSize: 12, color: "#b45309", backgroundColor: "#fef3c7", borderRadius: 6, padding: "4px 8px", marginTop: 2 }}>
                {t("side_panel.context.critique")}: {selectedCard.critique.slice(0, 120)}{selectedCard.critique.length > 120 ? "..." : ""}
              </div>
            ) : null}
            {selectedCard?.critiqueTags && selectedCard.critiqueTags.length > 0 ? (
              <div style={{ fontSize: 11, color: "#92400e", display: "flex", gap: 4, flexWrap: "wrap" }}>
                {selectedCard.critiqueTags.map((tag) => (
                  <span key={tag} style={{ backgroundColor: "#fed7aa", borderRadius: 999, padding: "1px 6px" }}>{getCritiqueTagLabel(tag)}</span>
                ))}
              </div>
            ) : null}
            {selectedCard?.meta?.seq !== undefined || selectedCard?.meta?.source ? (
              // DOMAIN-TRACE-01: trace info shows only when set (AC-5).
              <div data-panel="card-trace-summary" style={{ fontSize: 12, color: "#334155", backgroundColor: "#f1f5f9", borderRadius: 6, padding: "4px 8px", marginTop: 2 }}>
                {selectedCard.meta.seq !== undefined ? <span style={{ fontWeight: 700, marginRight: 8 }}>#{selectedCard.meta.seq}</span> : null}
                {selectedCard.meta.source ? (
                  <span>
                    {t("side_panel.context.trace_source")}: {selectedCard.meta.source.slice(0, 160)}
                    {selectedCard.meta.source.length > 160 ? "..." : ""}
                  </span>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={onFocusCard}
              style={{ width: "100%", border: "1px solid #a5b4fc", backgroundColor: "#ffffff", borderRadius: 6, padding: "6px 8px", fontWeight: 600, cursor: "pointer" }}
            >
              {t("side_panel.context.focus_selected_card")}
            </button>
          </>
        ) : hasCardSelection ? (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{selectedCardLabel}</div>
            <div style={{ fontSize: 12, color: "#475569" }}>{t("side_panel.context.multi_card_hint")}</div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.4 }}>{t("side_panel.context.empty_hint")}</div>
        )}
      </section>
      {document?.cards ? (
        <>
          <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#64748b", padding: "2px 0", flexWrap: "wrap" }}>
            <span>{t("side_panel.doc_bar.cards", { n: document.cards.length })}</span>
            <span>{t("side_panel.doc_bar.islands", { n: document.islands?.length ?? 0 })}</span>
            {(document.evidenceLinks?.length ?? 0) > 0 ? (
              <span>{t("side_panel.doc_bar.evidence", { n: document.evidenceLinks?.length ?? 0 })}</span>
            ) : null}
            {(document.critiqueInputs?.length ?? 0) > 0 ? (
              <span>{t("side_panel.doc_bar.critiques", { n: document.critiqueInputs?.length ?? 0 })}</span>
            ) : null}
          </div>
          <DomainStateSummary
            cards={document.cards}
            islandCount={document.islands?.length ?? 0}
            relationCount={(document.edges?.length ?? 0) + (document.relationSummaries?.length ?? 0)}
            safeMode={safeMode}
          />
          {isAdvancedUiEnabled ? (
            <div data-panel="domain-detail-filters" data-ui-complexity-tier="advanced-content">
              <DomainStateFilterBar
                filter={domainFilter}
                onFilterChange={setDomainFilter}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {document?.shelf && document.shelf.length > 0 ? (
        <ShelfPanel
          cards={document.cards}
          shelf={document.shelf}
          isReadOnly={isReadOnly}
          onRestoreCard={onRestoreShelvedCard}
          onFocusCard={(cardId) => onFocusCardById(cardId)}
        />
      ) : null}
      {(document?.critiqueInputs?.length ?? 0) > 0 || (document?.reproposalDiffs?.length ?? 0) > 0 ? (
        <section style={{ fontSize: 11, color: "#92400e", padding: "4px 0", borderBottom: "1px solid #fde68a", marginBottom: 6 }}>
          {t("side_panel.critique_summary", { critiques: document?.critiqueInputs?.length ?? 0, reproposals: document?.reproposalDiffs?.length ?? 0 })}
        </section>
      ) : null}
      {(document?.reproposalDiffs?.length ?? 0) > 0 ? (
        <section style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 8 }}>
            {t("side_panel.reproposal_diffs.latest_title")}
          </div>
          {[...document!.reproposalDiffs!].reverse().slice(0, 3).map((diff) => (
            <div key={diff.proposalId} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                <strong>{t("hil_rs_rediff_preview.proposal")}:</strong> {diff.proposalId}
                {" "}|{" "}
                <strong>{t("hil_rs_rediff_preview.based_on_iteration")}:</strong> {diff.basedOnIteration}
                {" "}|{" "}
                <strong>{t("hil_rs_rediff_preview.diff_operations")}:</strong> {diff.diffOps.length}
              </div>
              {diff.rationale ? (
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>
                  <strong>{t("side_panel.reproposal_diffs.rationale")}:</strong> {diff.rationale.slice(0, 200)}{diff.rationale.length > 200 ? "…" : ""}
                </div>
              ) : null}
              <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 11, color: "#334155" }}>
                {diff.diffOps.map((op) => (
                  <li key={op.opId}>
                    {op.opType} / {op.targetRef}
                    {op.rationale ? <span style={{ color: "#64748b" }}> — {op.rationale.slice(0, 80)}{op.rationale.length > 80 ? "…" : ""}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}
      {topContent}
      {importedPackSnapshotUrl || importedPackDiagnosticsMd ? (
        <section style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0", display: "grid", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{t("side_panel.pack_assets.title")}</div>
          {importedPackSnapshotUrl ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{t("side_panel.pack_assets.snapshot")}</div>
              <img src={importedPackSnapshotUrl} alt={t("side_panel.pack_assets.snapshot_alt")} style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 6 }} />
              <a href={importedPackSnapshotUrl} download="snapshot.png" style={{ fontSize: 12, color: "#1d4ed8" }}>
                {t("side_panel.pack_assets.download_snapshot")}
              </a>
            </div>
          ) : null}
          {importedPackDiagnosticsMd ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{t("side_panel.pack_assets.diagnostics")}</div>
              <pre style={{ margin: 0, maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 11, backgroundColor: "#f8fafc", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}>
                {importedPackDiagnosticsMd}
              </pre>
            </div>
          ) : null}
        </section>
      ) : null}
      {isAdvancedUiEnabled ? (
      <section data-panel="merge-history" style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <details
          data-panel-group="advanced"
          aria-expanded={isAdvancedPanelOpen ? "true" : "false"}
          onToggle={(event) => {
            setIsAdvancedPanelOpen(event.currentTarget.open);
          }}
        >
          <summary style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", cursor: "pointer" }}>
            {t("side_panel.history.with_count", { count: mergeAuditEntries.length })}
          </summary>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {mergeAuditEntries.length === 0 ? (
              <div style={{ fontSize: 12, color: "#64748b" }}>{t("side_panel.merge_history.empty")}</div>
            ) : (
              mergeAuditEntries.map((entry) => {
                const isExpanded = expandedMergeAuditEntryId === entry.id;
                const kindPairs = Object.entries(entry.summary.byKind).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
                const topKinds = kindPairs.slice(0, 3).map(([kind, count]) => `${kind}:${count}`).join(", ");
                const fullKinds = kindPairs.map(([kind, count]) => `${kind}:${count}`).join(", ");
                return (
                  <div key={entry.id} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedMergeAuditEntryId(isExpanded ? null : entry.id);
                      }}
                      style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "grid", gap: 4 }}
                    >
                      <div style={{ fontSize: 11, color: "#64748b" }}>{formatTimestamp(entry.createdAt)}</div>
                      <div style={{ fontSize: 12, color: "#0f172a" }}>{entry.source.fileName ?? entry.source.packId ?? t("side_panel.merge_history.unknown_source")}</div>
                      <div style={{ fontSize: 11, color: "#334155" }}>
                        {t("side_panel.merge_history.items_summary", { count: entry.summary.totalItems, kinds: topKinds || t("side_panel.merge_history.no_kinds") })}
                      </div>
                    </button>
                    {isExpanded ? (
                      <div style={{ marginTop: 8, display: "grid", gap: 6, fontSize: 11, color: "#475569" }}>
                        <div>{t("side_panel.merge_history.source_kind")}: {entry.source.kind}</div>
                        <div>{t("side_panel.merge_history.by_kind")}: {fullKinds || t("side_panel.none")}</div>
                        {renderIdList(t("side_panel.merge_history.item_ids"), entry.details.itemIds)}
                        {renderIdList(t("side_panel.merge_history.card_ids"), entry.details.entityIds?.cards)}
                        {renderIdList(t("side_panel.merge_history.island_ids"), entry.details.entityIds?.islands)}
                        {renderIdList(t("side_panel.merge_history.evidence_ids"), entry.details.entityIds?.evidence)}
                        {entry.summary.warnings && entry.summary.warnings.length > 0 ? (
                          <div>{t("side_panel.merge_history.warnings")}: {entry.summary.warnings.join(", ")}</div>
                        ) : null}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            onClick={async () => {
                              const copied = await copyText(JSON.stringify(entry, null, 2));
                              if (!copied) {
                                onEvidenceTraceError(t("side_panel.merge_history.copy_failed"));
                              }
                            }}
                          >
                            {t("side_panel.merge_history.copy_json")}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const copied = await copyText(buildMergeSummaryMarkdown(entry));
                              if (!copied) {
                                onEvidenceTraceError(t("side_panel.merge_history.copy_failed"));
                              }
                            }}
                          >
                            {t("side_panel.merge_history.copy_md")}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </details>
      </section>
      ) : null}
      {isAdvancedUiEnabled ? (
      <section data-panel="guided-flow" data-ui-complexity-tier="advanced-content" style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{t("side_panel.guided_flow.title")}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={guidedFlowEnabled}
            onChange={(event) => {
              onGuidedFlowEnabledChange(event.target.checked);
            }}
          />
          {t("side_panel.reading_path.enable")}
        </label>
        <div style={{ fontSize: 12, color: "#334155", marginBottom: 4 }}>
          {t("side_panel.guided_flow.step", { step: guidedFlowStepIndex + 1, total: guidedFlowTotalSteps })}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
          {guidedFlowStepTitle}
          {guidedFlowStepOptional ? t("side_panel.guided_flow.optional_suffix") : ""}
        </div>
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{guidedFlowStepDescription}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, marginBottom: 8 }}>
          <button
            type="button"
            onClick={onGuidedFlowPrevStep}
            disabled={!guidedFlowEnabled || guidedFlowStepIndex <= 0}
            style={{ cursor: !guidedFlowEnabled || guidedFlowStepIndex <= 0 ? "not-allowed" : "pointer" }}
          >
            {t("side_panel.guided_flow.prev_step")}
          </button>
          <button
            type="button"
            onClick={onGuidedFlowNextStep}
            disabled={!guidedFlowEnabled || guidedFlowStepIndex >= guidedFlowTotalSteps - 1}
            style={{ cursor: !guidedFlowEnabled || guidedFlowStepIndex >= guidedFlowTotalSteps - 1 ? "not-allowed" : "pointer" }}
          >
            {t("side_panel.guided_flow.next_step")}
          </button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <button
            type="button"
            onClick={onGuidedFlowNextTarget}
            disabled={!guidedFlowEnabled || guidedFlowTargetTotal === 0}
            style={{ cursor: !guidedFlowEnabled || guidedFlowTargetTotal === 0 ? "not-allowed" : "pointer" }}
          >
            {t("side_panel.guided_flow.next_target")}
          </button>
          <button
            type="button"
            onClick={onGuidedFlowOpenRelevantEditor}
            disabled={!guidedFlowEnabled}
            style={{ cursor: guidedFlowEnabled ? "pointer" : "not-allowed" }}
          >
            {t("side_panel.guided_flow.open_relevant_editor")}
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#334155", marginTop: 8 }}>
          {guidedFlowTargetTotal === 0
            ? t("side_panel.guided_flow.no_targets")
            : t("side_panel.guided_flow.target", { target: Math.min(guidedFlowTargetIndex + 1, guidedFlowTargetTotal), total: guidedFlowTargetTotal })}
        </div>
        {guidedFlowSuggestedActions.length > 0 ? (
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11, color: "#334155", display: "grid", gap: 4 }}>
            {guidedFlowSuggestedActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        ) : null}
      </section>
      ) : null}
      {isAdvancedUiEnabled ? (
      <section style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{t("side_panel.aggregated_edges.title")}</div>
        {aggregatedEdgeInspectorItems.length === 0 ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("side_panel.aggregated_edges.none")}</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {aggregatedEdgeInspectorItems.map((item) => (
              <div key={item.id} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>{item.label}</div>
                <button
                  type="button"
                  onClick={() => {
                    onPromoteAggregatedEdge(item.id);
                  }}
                  style={{ width: "100%" }}
                >
                  {t("side_panel.aggregated_edges.promote")}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      ) : null}
      <section style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{t("side_panel.layout.title")}</div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#334155",
            marginBottom: 10,
          }}
        >
          <input
            type="checkbox"
            checked={isGridSnapEnabled}
            onChange={(event) => {
              onGridSnapToggle(event.target.checked);
            }}
          />
          {t("side_panel.canvas.grid_snap", { size: 10 })}
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "#334155",
            marginBottom: 10,
          }}
        >
          <input
            type="checkbox"
            checked={showCanonicalOnlyEdges}
            onChange={(event) => {
              onShowCanonicalOnlyEdgesChange(event.target.checked);
            }}
          />
          {t("side_panel.canvas.show_canonical_only_edges")}
        </label>
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineIncludeCardTexts}
              onChange={(event) => {
                onOutlineIncludeCardTextsChange(event.target.checked);
              }}
            />
            {t("side_panel.reading_path.include_card_texts")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineIncludeRelationSummaries}
              onChange={(event) => {
                onOutlineIncludeRelationSummariesChange(event.target.checked);
              }}
            />
            {t("side_panel.reading_path.include_relation_summaries")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineIncludeUnreviewed}
              disabled={safeMode}
              onChange={(event) => {
                onOutlineIncludeUnreviewedChange(event.target.checked);
              }}
            />
            {t("side_panel.reading_path.include_unreviewed")}
          </label>
          {isAdvancedUiEnabled ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
              <input
                type="checkbox"
                checked={outlineAppendDiagnostics}
                onChange={(event) => {
                  onOutlineAppendDiagnosticsChange(event.target.checked);
                }}
              />
              {t("side_panel.outline.append_diagnostics")}
            </label>
          ) : null}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineAppendRecommendations}
              onChange={(event) => {
                onOutlineAppendRecommendationsChange(event.target.checked);
              }}
            />
            {t("side_panel.outline.append_recommendations")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineAppendKaFields}
              onChange={(event) => {
                onOutlineAppendKaFieldsChange(event.target.checked);
              }}
            />
            {t("side_panel.outline.append_ka_fields")}
          </label>
          {isAdvancedUiEnabled ? (
            <>
              <button type="button" onClick={onRunOutlineDiagnostics} disabled={isDiagnosticsRunning}>{isDiagnosticsRunning ? t("side_panel.action.working") : t("side_panel.outline.run_diagnostics")}</button>
              <button type="button" onClick={onDetectVoids}>{t("side_panel.outline.detect_voids")}</button>
              {isDiagnosticsRunning ? <button type="button" onClick={onCancelDiagnostics}>{t("side_panel.action.cancel")}</button> : null}
              {isDiagnosticsRunning && computeProgressMessage ? <div style={{ fontSize: 12 }}>{computeProgressMessage}</div> : null}
            </>
          ) : null}
          <div style={{ fontSize: 11, color: "#b45309" }}>{t("side_panel.outline.unreviewed_draft_warning")}</div>
          {safeMode ? <div style={{ fontSize: 11, color: "#b45309" }}>{t("side_panel.outline.safe_mode_excluded")}</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" onClick={onCopyReadingOutlineMd}>
              {t("side_panel.outline.copy_md")}
            </button>
            <button type="button" onClick={onDownloadReadingOutlineMd}>
              {t("side_panel.outline.download_md")}
            </button>
          </div>
          {isAdvancedUiEnabled && outlineQualityReport ? (
            <div style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: 8, backgroundColor: "#f8fafc", marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{t("side_panel.outline.quality_report")}</div>
              <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>
                {t("side_panel.outline.findings_summary", { errors: outlineDiagnosticsCounts.error, warnings: outlineDiagnosticsCounts.warn, infos: outlineDiagnosticsCounts.info })}
              </div>
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 12, cursor: "pointer", color: "#1d4ed8" }}>{t("side_panel.outline.show_findings")}</summary>
                {outlineQualityReport.findings.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.outline.no_findings")}</div>
                ) : (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                    {outlineQualityReport.findings.map((finding, index) => (
                      <li key={`${finding.code}_${index}`} style={{ fontSize: 11, color: "#0f172a" }}>
                        <div style={{ fontWeight: 600 }}>[{diagnosticSeverityLabel(finding.severity)}] {finding.code} {finding.title}</div>
                        <div>{finding.detail}</div>
                        {finding.suggestedAction ? <div style={{ color: "#334155" }}>{t("side_panel.outline.action", { suggestedAction: finding.suggestedAction })}</div> : null}
                        {finding.entityRefs && finding.entityRefs.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                            {finding.entityRefs.map((ref) => (
                              <button
                                key={`${finding.code}_${ref.kind}_${ref.id}`}
                                type="button"
                                onClick={() => {
                                  onFocusOutlineDiagnosticRef(ref.kind, ref.id);
                                }}
                                style={{ fontSize: 10, cursor: "pointer" }}
                              >
                                {t("side_panel.outline.focus_ref", { kind: ref.kind, id: ref.id })}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
              {contradictionReport ? (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, cursor: "pointer", color: "#b45309" }}>
                    {t("side_panel.outline.contradiction_signals", { count: contradictionReport.stats.signals })}
                  </summary>
                  {contradictionReport.signals.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.outline.no_contradiction_signals")}</div>
                  ) : (
                    <div style={{ marginTop: 6, display: "grid", gap: 8 }}>
                      {["warn", "info"].map((severity) => {
                        const signals = contradictionSignalsBySeverity[severity as "warn" | "info"];
                        if (signals.length === 0) {
                          return null;
                        }

                        return (
                          <div key={severity}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: severity === "warn" ? "#b45309" : "#334155" }}>
                              {t("side_panel.outline.severity_with_count", { severity: diagnosticSeverityLabel(severity as DiagnosticSeverity), count: signals.length })}
                            </div>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                              {signals.map((signal, index) => (
                                <li key={`${signal.code}_${index}`} style={{ fontSize: 11, color: "#0f172a" }}>
                                  <div style={{ fontWeight: 600 }}>[{signal.code}] {signal.title}</div>
                                  <div>{signal.detail}</div>
                                  {signal.suggestedAction ? <div style={{ color: "#334155" }}>{t("side_panel.outline.action", { suggestedAction: signal.suggestedAction })}</div> : null}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onFocusContradictionSignal(signal);
                                    }}
                                    style={{ fontSize: 10, cursor: "pointer", marginTop: 4 }}
                                  >
                                    {t("side_panel.focus")}
                                  </button>
                                  {renderContradictionDecisionControls(signal)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </details>
              ) : null}
              {distributionSignalsSection}
              {claimTypeMixSection}
              {evidenceGapSection}
              {dialecticBalanceSection}
              {metricsSection}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 12, cursor: "pointer", color: "#1d4ed8" }}>{t("side_panel.outline.suggested_next_steps")}</summary>
                {visibleRecommendations.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.outline.no_recommendations")}</div>
                ) : (
                  <ol style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
                    {visibleRecommendations.map((recommendation) => {
                      const firstTarget = recommendation.targetEntities?.[0];
                      return (
                        <li key={recommendation.id} style={{ fontSize: 11, color: "#0f172a" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                            <span>{recommendation.title}</span>
                          </div>
                          <div>{recommendation.description}</div>
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ cursor: "pointer", color: "#1d4ed8" }}>{t("side_panel.outline.details")}</summary>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                              {recommendation.suggestedActions.map((action) => (
                                <li key={`${recommendation.id}_${action}`}>{action}</li>
                              ))}
                            </ul>
                            {firstTarget ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onFocusOutlineDiagnosticRef(firstTarget.kind, firstTarget.id);
                                }}
                                style={{ fontSize: 10, cursor: "pointer", marginTop: 4 }}
                              >
                                {t("side_panel.outline.focus_first_target")}
                              </button>
                            ) : null}
                          </details>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </details>
            </div>
          ) : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <button type="button" onClick={onAlignLeft} disabled={!canAlign} style={{ cursor: canAlign ? "pointer" : "not-allowed" }}>
            {t("side_panel.layout.align_left")}
          </button>
          <button type="button" onClick={onAlignRight} disabled={!canAlign} style={{ cursor: canAlign ? "pointer" : "not-allowed" }}>
            {t("side_panel.layout.align_right")}
          </button>
          <button type="button" onClick={onAlignTop} disabled={!canAlign} style={{ cursor: canAlign ? "pointer" : "not-allowed" }}>
            {t("side_panel.layout.align_top")}
          </button>
          <button type="button" onClick={onAlignBottom} disabled={!canAlign} style={{ cursor: canAlign ? "pointer" : "not-allowed" }}>
            {t("side_panel.layout.align_bottom")}
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
          <button
            type="button"
            onClick={onDistributeHorizontally}
            disabled={!canDistribute}
            style={{ cursor: canDistribute ? "pointer" : "not-allowed" }}
          >
            {t("side_panel.layout.distribute_horizontally")}
          </button>
          <button
            type="button"
            onClick={onDistributeVertically}
            disabled={!canDistribute}
            style={{ cursor: canDistribute ? "pointer" : "not-allowed" }}
          >
            {t("side_panel.layout.distribute_vertically")}
          </button>
        </div>
        <button
          type="button"
          onClick={onCreateRepresentativeCard}
          disabled={selectedCardCount < 2}
          style={{ cursor: selectedCardCount >= 2 ? "pointer" : "not-allowed" }}
        >
          {t("side_panel.layout.create_representative_card")}
        </button>
      </section>
      <section style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{t("side_panel.connect.title")}</div>
        <label style={{ display: "block", fontSize: 12, color: "#334155", marginBottom: 4 }}>{t("side_panel.connect.edge_type")}</label>
        <select
          aria-label={t("side_panel.connect.edge_type")}
          value={connectEdgeType}
          onChange={(event) => {
            // resolveKnownEdgeType maps anything unexpected back to "related".
            onConnectEdgeTypeChange(resolveKnownEdgeType(event.target.value));
          }}
          disabled={isPickingEdgeTarget}
          style={{ width: "100%", marginBottom: 8 }}
        >
          {KNOWN_EDGE_TYPES.map((edgeType) => (
            <option key={edgeType} value={edgeType}>
              {t(`side_panel.connect.${edgeType}`)}
            </option>
          ))}
        </select>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            type="button"
            onClick={onStartConnect}
            disabled={!canStartConnect || isPickingEdgeTarget}
            style={{ cursor: !canStartConnect || isPickingEdgeTarget ? "not-allowed" : "pointer" }}
          >
            {t("side_panel.connect.connect")}
          </button>
          <button
            type="button"
            onClick={onCancelConnect}
            disabled={!isPickingEdgeTarget}
            style={{ cursor: isPickingEdgeTarget ? "pointer" : "not-allowed" }}
          >
            {t("side_panel.connect.cancel")}
          </button>
        </div>
        {isPickingEdgeTarget ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>{t("side_panel.connect.pick_target_hint")}</div>
        ) : null}
      </section>
      <section style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{t("side_panel.reading_path.title")}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={readingNavEnabled}
            onChange={(event) => {
              onReadingNavEnabledChange(event.target.checked);
            }}
          />
          {t("side_panel.reading_path.enable")}
        </label>
        <label style={{ display: "block", fontSize: 12, color: "#334155", marginBottom: 4 }}>{t("side_panel.reading_path.mode")}</label>
        <select
          aria-label={t("side_panel.reading_path.mode")}
          value={readingMode}
          onChange={(event) => {
            onReadingModeChange(event.target.value === "islands+cards" ? "islands+cards" : "islands");
          }}
          disabled={!readingNavEnabled}
          style={{ width: "100%", marginBottom: 8 }}
        >
          <option value="islands">{t("side_panel.reading_path.mode_islands_only")}</option>
          <option value="islands+cards">{t("side_panel.reading_path.mode_islands_cards")}</option>
        </select>
        <label
          title={t("side_panel.reading_path.reviewed_only_hint")}
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155", marginBottom: 8 }}
        >
          <input
            type="checkbox"
            checked={reviewedOnly}
            disabled={!readingNavEnabled}
            onChange={() => {
              onReadingReviewedOnlyToggle();
            }}
          />
          {t("side_panel.reading_path.reviewed_only")}
        </label>
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineIncludeCardTexts}
              onChange={(event) => {
                onOutlineIncludeCardTextsChange(event.target.checked);
              }}
            />
            {t("side_panel.reading_path.include_card_texts")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineIncludeRelationSummaries}
              onChange={(event) => {
                onOutlineIncludeRelationSummariesChange(event.target.checked);
              }}
            />
            {t("side_panel.reading_path.include_relation_summaries")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineIncludeUnreviewed}
              disabled={safeMode}
              onChange={(event) => {
                onOutlineIncludeUnreviewedChange(event.target.checked);
              }}
            />
            {t("side_panel.reading_path.include_unreviewed")}
          </label>
          {isAdvancedUiEnabled ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
              <input
                type="checkbox"
                checked={outlineAppendDiagnostics}
                onChange={(event) => {
                  onOutlineAppendDiagnosticsChange(event.target.checked);
                }}
              />
              {t("side_panel.outline.append_diagnostics")}
            </label>
          ) : null}
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineAppendRecommendations}
              onChange={(event) => {
                onOutlineAppendRecommendationsChange(event.target.checked);
              }}
            />
            {t("side_panel.outline.append_recommendations")}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
            <input
              type="checkbox"
              checked={outlineAppendKaFields}
              onChange={(event) => {
                onOutlineAppendKaFieldsChange(event.target.checked);
              }}
            />
            {t("side_panel.outline.append_ka_fields")}
          </label>
          {isAdvancedUiEnabled ? (
            <>
              <button type="button" onClick={onRunOutlineDiagnostics} disabled={isDiagnosticsRunning}>{isDiagnosticsRunning ? t("side_panel.action.working") : t("side_panel.outline.run_diagnostics")}</button>
              <button type="button" onClick={onDetectVoids}>{t("side_panel.outline.detect_voids")}</button>
              {isDiagnosticsRunning ? <button type="button" onClick={onCancelDiagnostics}>{t("side_panel.action.cancel")}</button> : null}
              {isDiagnosticsRunning && computeProgressMessage ? <div style={{ fontSize: 12 }}>{computeProgressMessage}</div> : null}
            </>
          ) : null}
          <div style={{ fontSize: 11, color: "#b45309" }}>{t("side_panel.outline.unreviewed_draft_warning")}</div>
          {safeMode ? <div style={{ fontSize: 11, color: "#b45309" }}>{t("side_panel.outline.safe_mode_excluded")}</div> : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" onClick={onCopyReadingOutlineMd}>
              {t("side_panel.outline.copy_md")}
            </button>
            <button type="button" onClick={onDownloadReadingOutlineMd}>
              {t("side_panel.outline.download_md")}
            </button>
          </div>
          {isAdvancedUiEnabled && outlineQualityReport ? (
            <div style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: 8, backgroundColor: "#f8fafc", marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{t("side_panel.outline.quality_report")}</div>
              <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>
                {t("side_panel.outline.findings_summary", { errors: outlineDiagnosticsCounts.error, warnings: outlineDiagnosticsCounts.warn, infos: outlineDiagnosticsCounts.info })}
              </div>
              <details style={{ marginTop: 6 }}>
                <summary style={{ fontSize: 12, cursor: "pointer", color: "#1d4ed8" }}>{t("side_panel.outline.show_findings")}</summary>
                {outlineQualityReport.findings.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.outline.no_findings")}</div>
                ) : (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                    {outlineQualityReport.findings.map((finding, index) => (
                      <li key={`${finding.code}_${index}`} style={{ fontSize: 11, color: "#0f172a" }}>
                        <div style={{ fontWeight: 600 }}>[{diagnosticSeverityLabel(finding.severity)}] {finding.code} {finding.title}</div>
                        <div>{finding.detail}</div>
                        {finding.suggestedAction ? <div style={{ color: "#334155" }}>{t("side_panel.outline.action", { suggestedAction: finding.suggestedAction })}</div> : null}
                        {finding.entityRefs && finding.entityRefs.length > 0 ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                            {finding.entityRefs.map((ref) => (
                              <button
                                key={`${finding.code}_${ref.kind}_${ref.id}`}
                                type="button"
                                onClick={() => {
                                  onFocusOutlineDiagnosticRef(ref.kind, ref.id);
                                }}
                                style={{ fontSize: 10, cursor: "pointer" }}
                              >
                                {t("side_panel.outline.focus_ref", { kind: ref.kind, id: ref.id })}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </details>
              {contradictionReport ? (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ fontSize: 12, cursor: "pointer", color: "#b45309" }}>
                    {t("side_panel.outline.contradiction_signals", { count: contradictionReport.stats.signals })}
                  </summary>
                  {contradictionReport.signals.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.outline.no_contradiction_signals")}</div>
                  ) : (
                    <div style={{ marginTop: 6, display: "grid", gap: 8 }}>
                      {["warn", "info"].map((severity) => {
                        const signals = contradictionSignalsBySeverity[severity as "warn" | "info"];
                        if (signals.length === 0) {
                          return null;
                        }

                        return (
                          <div key={severity}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: severity === "warn" ? "#b45309" : "#334155" }}>
                              {t("side_panel.outline.severity_with_count", { severity: diagnosticSeverityLabel(severity as DiagnosticSeverity), count: signals.length })}
                            </div>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                              {signals.map((signal, index) => (
                                <li key={`${signal.code}_${index}`} style={{ fontSize: 11, color: "#0f172a" }}>
                                  <div style={{ fontWeight: 600 }}>[{signal.code}] {signal.title}</div>
                                  <div>{signal.detail}</div>
                                  {signal.suggestedAction ? <div style={{ color: "#334155" }}>{t("side_panel.outline.action", { suggestedAction: signal.suggestedAction })}</div> : null}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onFocusContradictionSignal(signal);
                                    }}
                                    style={{ fontSize: 10, cursor: "pointer", marginTop: 4 }}
                                  >
                                    {t("side_panel.focus")}
                                  </button>
                                  {renderContradictionDecisionControls(signal)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </details>
              ) : null}
              {distributionSignalsSection}
              {claimTypeMixSection}
              {evidenceGapSection}
              {dialecticBalanceSection}
              {metricsSection}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 12, cursor: "pointer", color: "#1d4ed8" }}>{t("side_panel.outline.suggested_next_steps")}</summary>
                {visibleRecommendations.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>{t("side_panel.outline.no_recommendations")}</div>
                ) : (
                  <ol style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
                    {visibleRecommendations.map((recommendation) => {
                      const firstTarget = recommendation.targetEntities?.[0];
                      return (
                        <li key={recommendation.id} style={{ fontSize: 11, color: "#0f172a" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                            <span>{recommendation.title}</span>
                          </div>
                          <div>{recommendation.description}</div>
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ cursor: "pointer", color: "#1d4ed8" }}>{t("side_panel.outline.details")}</summary>
                            <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                              {recommendation.suggestedActions.map((action) => (
                                <li key={`${recommendation.id}_${action}`}>{action}</li>
                              ))}
                            </ul>
                            {firstTarget ? (
                              <button
                                type="button"
                                onClick={() => {
                                  onFocusOutlineDiagnosticRef(firstTarget.kind, firstTarget.id);
                                }}
                                style={{ fontSize: 10, cursor: "pointer", marginTop: 4 }}
                              >
                                {t("side_panel.outline.focus_first_target")}
                              </button>
                            ) : null}
                          </details>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </details>
            </div>
          ) : null}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            onClick={onReadingPrev}
            disabled={!readingNavEnabled || readingTotal === 0 || readingStep <= 1}
            style={{ cursor: !readingNavEnabled || readingTotal === 0 || readingStep <= 1 ? "not-allowed" : "pointer" }}
          >
            {t("side_panel.reading_path.prev")}
          </button>
          <button
            type="button"
            onClick={onReadingNext}
            disabled={!readingNavEnabled || readingTotal === 0 || readingStep >= readingTotal}
            style={{ cursor: !readingNavEnabled || readingTotal === 0 || readingStep >= readingTotal ? "not-allowed" : "pointer" }}
          >
            {t("side_panel.reading_path.next")}
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#334155", marginBottom: 4 }}>
          {readingTotal === 0
            ? t("side_panel.reading_path.no_items")
            : t("side_panel.guided_flow.step", { step: readingStep, total: readingTotal })}
        </div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{currentReadingLabel ?? t("side_panel.none")}</div>
      </section>
      <section style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{t("side_panel.reading_order.title")}</div>
        {canAddSelectedItemToReadingOrder ? (
          <button
            type="button"
            onClick={onAddSelectedItemToReadingOrder}
            style={{
              width: "100%",
              marginBottom: 8,
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              color: "#0f172a",
              borderRadius: 6,
              padding: "6px 10px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t("side_panel.reading_order.add")}
          </button>
        ) : (
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
            {t("side_panel.reading_order.select_hint")}
          </div>
        )}
        {readingOrderItems.length === 0 ? (
          <div style={{ fontSize: 12, color: "#64748b" }}>{t("side_panel.reading_order.empty")}</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {readingOrderItems.map((item, index) => (
              <div
                key={item.id}
                style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 6, backgroundColor: "#f8fafc" }}
              >
                <div style={{ fontSize: 11, color: "#64748b" }}>{item.id}</div>
                <div style={{ fontSize: 12, color: "#0f172a", marginBottom: 4 }}>{item.label}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => {
                      onMoveReadingOrderItem(index, -1);
                    }}
                    disabled={index === 0}
                    style={{ cursor: index === 0 ? "not-allowed" : "pointer" }}
                  >
                    {t("side_panel.reading_order.up")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onMoveReadingOrderItem(index, 1);
                    }}
                    disabled={index === readingOrderItems.length - 1}
                    style={{ cursor: index === readingOrderItems.length - 1 ? "not-allowed" : "pointer" }}
                  >
                    {t("side_panel.reading_order.down")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRemoveReadingOrderItem(index);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    {t("side_panel.reading_order.remove")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{t("side_panel.island_visibility.title")}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" onClick={onCollapseAllIslands} disabled={!hasIslands} style={{ width: "100%" }}>
            {t("side_panel.reading_path.collapse_all")}
          </button>
          <button type="button" onClick={onExpandAllIslands} disabled={!isAnyIslandCollapsed} style={{ width: "100%" }}>
            {t("side_panel.reading_path.expand_all")}
          </button>
        </div>
      </section>
      {selectedIsland ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#0f172a" }}>{t("side_panel.island_editor.title")}</div>

          <label
            htmlFor="selected-island-id"
            style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}
          >
            ID
          </label>
          <input
            id="selected-island-id"
            type="text"
            readOnly
            value={selectedIsland.id}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 8px",
              boxSizing: "border-box",
              marginBottom: 10,
              backgroundColor: "#f8fafc",
            }}
          />

          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
            {t("side_panel.island_editor.parent")}
          </label>
          <select
            aria-label={t("side_panel.island_editor.parent")}
            value={selectedIsland.parentIslandId ?? ""}
            onChange={(event) => {
              const nextValue = event.target.value.trim();
              onParentIslandChange(nextValue.length > 0 ? nextValue : undefined);
            }}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 8px",
              boxSizing: "border-box",
              marginBottom: 10,
              backgroundColor: "#ffffff",
            }}
          >
            <option value="">{t("side_panel.none")}</option>
            {parentIslandOptions.map((island) => (
              <option key={island.id} value={island.id}>
                {island.label}
              </option>
            ))}
          </select>

          {summaryView || abstractMapView ? (
            <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
              <button type="button" onClick={onToggleSelectedIslandTemporaryReveal} style={{ width: "100%" }}>
                {isSelectedIslandTemporarilyRevealed ? t("side_panel.island_editor.hide_member_cards") : t("side_panel.island_editor.reveal_member_cards")}
              </button>
              <button type="button" onClick={onClearTemporaryReveal} style={{ width: "100%" }}>
                {t("side_panel.island_editor.clear_reveals")}
              </button>
            </div>
          ) : null}

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "#334155",
              marginBottom: 10,
            }}
          >
            <input
              type="checkbox"
              checked={isSelectedIslandCollapsed}
              onChange={(event) => {
                onIslandCollapsedChange(event.target.checked);
              }}
            />
            {t("side_panel.island_editor.collapsed")}
          </label>

          <label
            htmlFor="selected-island-title"
            style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}
          >
            {t("side_panel.island_editor.title_label")}
          </label>
          <input
            id="selected-island-title"
            type="text"
            value={selectedIsland.title ?? ""}
            onChange={(event) => {
              onTitleChange(event.target.value);
            }}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 8px",
              boxSizing: "border-box",
              marginBottom: 10,
            }}
          />
          {(() => {
            // AI-TITLE-01: surface a universal-phrase placard (a title that
            // would fit ANY island) as a proposal-only warning. The rewrite
            // proposal itself is AI-assisted and lives on the suggestion
            // surface; here we only flag the risk, never auto-apply.
            const title = selectedIsland.title?.trim();
            if (!title || !document) return null;
            const memberTexts = selectedIsland.cardIds
              .map((cardId) => document.cards.find((card) => card.id === cardId))
              .filter((card): card is (typeof document.cards)[number] => Boolean(card))
              .map((card) => card.text);
            const inspection = inspectIslandTitle(title, memberTexts);
            if (!inspection.isUniversal) return null;
            return (
              <div
                data-ui-region="universal-title-warning"
                style={{
                  fontSize: 11,
                  color: "#9a3412",
                  backgroundColor: "#fff7ed",
                  border: "1px solid #fed7aa",
                  borderRadius: 6,
                  padding: "6px 8px",
                  marginBottom: 10,
                }}
              >
                {t("side_panel.island_editor.universal_title_warning")}
              </div>
            );
          })()}

          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
            {t("side_panel.island_editor.placard_card")}
          </label>
          <select
            aria-label={t("side_panel.island_editor.placard_card")}
            value={selectedIsland.placardCardId ?? ""}
            onChange={(event) => {
              const nextValue = event.target.value.trim();
              onPlacardCardChange(nextValue.length > 0 ? nextValue : undefined);
            }}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 8px",
              boxSizing: "border-box",
              marginBottom: 8,
              backgroundColor: "#ffffff",
            }}
          >
            <option value="">{t("side_panel.none")}</option>
            {selectedIsland.cardIds.map((cardId) => {
              const card = document?.cards.find((entry) => entry.id === cardId);
              const text = card?.text.trim() ?? "";
              const label = text.length > 0 ? `${text.slice(0, 28)}${text.length > 28 ? "…" : ""} (${cardId})` : cardId;

              return (
                <option key={cardId} value={cardId}>
                  {label}
                </option>
              );
            })}
          </select>
          {selectedIsland.placardCardId ? (
            <input
              type="text"
              value={document?.cards.find((card) => card.id === selectedIsland.placardCardId)?.text ?? ""}
              onChange={(event) => {
                onPlacardCardTextChange(event.target.value);
              }}
              placeholder={t("side_panel.island_editor.placard_card_text")}
              style={{
                width: "100%",
                border: "1px solid #cbd5e1",
                borderRadius: 6,
                padding: "6px 8px",
                boxSizing: "border-box",
                marginBottom: 10,
              }}
            />
          ) : null}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "#334155",
              marginBottom: 10,
            }}
          >
            <input
              type="checkbox"
              checked={selectedIsland.titleReviewed === true}
              onChange={(event) => {
                onTitleReviewedChange(event.target.checked);
              }}
            />
            {t("side_panel.reviewed")}
          </label>

          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
            {t("side_panel.summary.label")}
          </label>
          {isAdvancedUiEnabled ? (
            <>
              <ModelSelector
                label={t("model_selector.label")}
                value={islandSummaryModel}
                onChange={onIslandSummaryModelChange}
                disabled={isSuggestingIslandSummary}
                dataUiRegion="model-selector"
                models={availableModels}
                unavailableReason={availableModelsUnavailableReason}
              />
              <button
                type="button"
                onClick={() => onSuggestIslandSummary()}
                disabled={isSuggestingIslandSummary}
                style={{ width: "100%", marginBottom: 8, cursor: isSuggestingIslandSummary ? "not-allowed" : "pointer" }}
              >
                {isSuggestingIslandSummary ? t("side_panel.summary.suggesting") : t("side_panel.summary.suggest_ai")}
              </button>
            </>
          ) : null}
          {islandSummaryProposal ? (
            <div style={{ border: "1px solid #bfdbfe", borderRadius: 6, backgroundColor: "#eff6ff", padding: 8, marginBottom: 8, display: "grid", gap: 6 }}>
              <div style={{ fontSize: 11, color: "#1e3a8a" }}>
                {t("side_panel.summary.ai_proposal")} <strong>{islandSummaryProposal.proposalId}</strong> ({islandSummaryProposal.status})
              </div>
              <div style={{ fontSize: 12, color: "#1e293b" }}>{t("side_panel.summary.patch_preview")}: {islandSummaryProposal.diff.after}</div>
              {islandSummaryProposal.diff.candidates && islandSummaryProposal.diff.candidates.length > 1 ? (
                <div style={{ fontSize: 12, color: "#334155" }}>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{t("side_panel.summary.candidates")}</div>
                  <div style={{ display: "grid", gap: 4 }}>
                    {islandSummaryProposal.diff.candidates.map((candidate, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setSelectedIslandSummaryCandidateIndex(index)}
                        style={{
                          textAlign: "left",
                          border: index === selectedIslandSummaryCandidateIndex ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                          borderRadius: 6,
                          padding: "4px 8px",
                          backgroundColor: index === selectedIslandSummaryCandidateIndex ? "#dbeafe" : "#ffffff",
                          color: "#0f172a",
                          cursor: "pointer",
                        }}
                      >
                        {candidate.summaryText}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div style={{ display: "grid", gap: 6 }}>
                <input
                  type="text"
                  value={islandSummaryCritique}
                  onChange={(event) => setIslandSummaryCritique(event.target.value)}
                  placeholder={t("side_panel.summary.critique_placeholder")}
                  style={{ width: "100%", padding: "4px 6px", fontSize: 12 }}
                />
                <button
                  type="button"
                  onClick={() => onSuggestIslandSummary(islandSummaryCritique.trim() || undefined)}
                  disabled={isSuggestingIslandSummary}
                  style={{ width: "100%", cursor: isSuggestingIslandSummary ? "not-allowed" : "pointer" }}
                >
                  {t("side_panel.summary.regenerate")}
                </button>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => onAdoptIslandSummaryProposal(selectedIslandSummaryCandidateIndex, islandSummaryCritique.trim() || undefined)} disabled={isRecordingIslandSummaryDecision} style={{ flex: 1 }}>{t("side_panel.summary.adopt")}</button>
                <button type="button" onClick={onHoldIslandSummaryProposal} disabled={isRecordingIslandSummaryDecision} style={{ flex: 1 }}>{t("side_panel.summary.hold")}</button>
                <button type="button" onClick={onRejectIslandSummaryProposal} disabled={isRecordingIslandSummaryDecision} style={{ flex: 1 }}>{t("side_panel.summary.reject")}</button>
              </div>
              {proposalAuditTrail.length > 0 ? (
                <div style={{ fontSize: 11, color: "#334155" }}>{t("side_panel.summary.audit")}: {proposalAuditTrail[proposalAuditTrail.length - 1]}</div>
              ) : null}
            </div>
          ) : null}
          {selectedIsland.summaryReviewed !== true && typeof selectedIsland.summaryText === "string" && selectedIsland.summaryText.length > 0 ? (
            <div
              style={{
                fontSize: 12,
                color: "#7c2d12",
                backgroundColor: "#ffedd5",
                border: "1px solid #fdba74",
                borderRadius: 6,
                padding: "6px 8px",
                marginBottom: 8,
              }}
            >
              {t("side_panel.summary.ai_draft_warning")}
            </div>
          ) : null}
          {summaryGroundingItems.length > 0 ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{t("side_panel.summary.grounding_cards", { count: summaryGroundingItems.length })}</div>
                <button type="button" onClick={onClearTemporaryReveal} style={{ fontSize: 11, padding: "2px 6px" }}>
                  {t("side_panel.summary.clear_reveal")}
                </button>
              </div>
              <button type="button" onClick={onShowAllSummaryGrounding} style={{ width: "100%", marginBottom: 8 }}>
                {t("side_panel.summary.show_all_grounding")}
              </button>
              <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                {summaryGroundingItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSummaryGroundingCardInspect(item.id);
                      }}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        padding: "6px 8px",
                        backgroundColor: "#ffffff",
                        color: "#0f172a",
                        cursor: "pointer",
                        fontSize: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                      }}
                    >
                      <span>{item.text.slice(0, 120)}</span>
                      <span
                        style={{
                          borderRadius: 999,
                          border: "1px solid #cbd5e1",
                          padding: "1px 7px",
                          fontSize: 11,
                          color: "#334155",
                          backgroundColor: "#f8fafc",
                          whiteSpace: "nowrap",
                          textTransform: "lowercase",
                        }}
                      >
                        {item.kind}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {groundingVisibilityMessage ? (
                <div style={{ fontSize: 12, color: "#92400e", marginTop: 8 }}>{groundingVisibilityMessage}</div>
              ) : null}
            </div>
          ) : null}
          {islandSummarySuggestionWarnings.length > 0 ? (
            <div style={{ fontSize: 12, color: "#92400e", marginBottom: 8 }}>
              {t("side_panel.summary.warnings")}: {islandSummarySuggestionWarnings.join(" | ")}
            </div>
          ) : null}
          <textarea
            value={summaryDraft}
            onChange={(event) => {
              setSummaryDraft(event.target.value);
            }}
            onBlur={() => {
              onSummaryTextChange(summaryDraft);
            }}
            placeholder={t("side_panel.summary.placeholder")}
            rows={3}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 8px",
              boxSizing: "border-box",
              marginBottom: 10,
              resize: "vertical",
            }}
          />
          <details style={{ marginBottom: 10 }}>
            <summary style={{ fontSize: 12, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
              {t("side_panel.summary.history_with_count", { count: summaryHistoryEntries.length })}
            </summary>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {summaryHistoryEntries.length === 0 ? (
                <div style={{ fontSize: 12, color: "#64748b" }}>{t("side_panel.summary.no_history")}</div>
              ) : (
                summaryHistoryEntries.map((entry) => {
                  const isExpanded = expandedSummaryHistoryEntryId === entry.id;
                  const preview = (entry.toText ?? "").slice(0, 80);

                  return (
                    <div key={entry.id} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedSummaryHistoryEntryId(isExpanded ? null : entry.id);
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          background: "transparent",
                          padding: 0,
                          cursor: "pointer",
                          display: "grid",
                          gap: 4,
                        }}
                      >
                        <div style={{ fontSize: 11, color: "#64748b" }}>{formatTimestamp(entry.createdAt)}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span
                            style={{
                              borderRadius: 999,
                              border: "1px solid #cbd5e1",
                              padding: "1px 7px",
                              fontSize: 11,
                              color: "#334155",
                              backgroundColor: "#f8fafc",
                              textTransform: "lowercase",
                            }}
                          >
                            {entry.changeKind}
                          </span>
                          <span style={{ fontSize: 12, color: "#0f172a" }}>{preview || t("side_panel.empty")}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#475569" }}>
                          {t("side_panel.summary.reviewed_state", { value: entry.toReviewed === null ? t("side_panel.unchanged") : entry.toReviewed ? t("side_panel.boolean.true") : t("side_panel.boolean.false") })}
                        </div>
                      </button>
                      {isExpanded ? (
                        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                          <div style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.history.from")}</div>
                          <pre style={{ margin: 0, fontSize: 12, backgroundColor: "#f8fafc", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
                            {entry.fromText ?? t("side_panel.empty")}
                          </pre>
                          <div style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.history.to")}</div>
                          <pre style={{ margin: 0, fontSize: 12, backgroundColor: "#f8fafc", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
                            {entry.toText ?? t("side_panel.empty")}
                          </pre>
                          {entry.groundingIds && entry.groundingIds.length > 0 ? (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <div style={{ fontSize: 11, color: "#475569" }}>
                                {t("side_panel.summary.grounding_snapshot", { count: entry.groundingIds.length })}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  onShowSummaryHistoryGrounding(entry.groundingIds ?? []);
                                }}
                                style={{ fontSize: 11, padding: "2px 6px" }}
                              >
                                {t("side_panel.summary.show_grounding")}
                              </button>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              onRestoreSummaryHistoryEntry(entry.id);
                            }}
                            style={{ width: "100%" }}
                          >
                            {t("side_panel.history.restore_version")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </details>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "#334155",
              marginBottom: 10,
            }}
          >
            <input
              type="checkbox"
              checked={selectedIsland.summaryReviewed === true}
              onChange={(event) => {
                onSummaryReviewedChange(event.target.checked);
              }}
            />
            {t("side_panel.reviewed")}
          </label>

          {isAdvancedUiEnabled ? (
            <details
              data-domain-feature="representative-visual-cue"
              style={{
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: 8,
                marginBottom: 10,
                backgroundColor: "#f8fafc",
              }}
            >
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#334155" }}>
                {t("side_panel.visual_cue.title")}
              </summary>
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <div style={{ fontSize: 11, lineHeight: 1.5, color: "#475569" }}>
                  {t("side_panel.visual_cue.description", { title: selectedIslandTitle })}
                </div>
                <div
                  role="group"
                  aria-label={t("side_panel.visual_cue.preset_group")}
                  style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}
                >
                  {REPRESENTATIVE_VISUAL_CUE_PRESETS.map((preset) => {
                    const label = t(preset.labelKey);
                    const isSelected =
                      selectedIsland.representativeCue?.kind === "preset_svg"
                      && selectedIsland.representativeCue.cueId === preset.cueId;
                    const cue = createRepresentativeVisualCuePreset(preset.cueId, label);
                    return (
                      <button
                        key={preset.cueId}
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={t("side_panel.visual_cue.select_preset", { label })}
                        disabled={isReadOnly}
                        onClick={() => {
                          onRepresentativeVisualCueChange(cue);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 0,
                          border: isSelected ? "2px solid #0284c7" : "1px solid #cbd5e1",
                          borderRadius: 6,
                          padding: "8px 10px",
                          backgroundColor: isSelected ? "#e0f2fe" : "#ffffff",
                          color: "#334155",
                          cursor: isReadOnly ? "not-allowed" : "pointer",
                        }}
                      >
                        <RepresentativeVisualCueMark cue={cue} />
                        <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
                      </button>
                    );
                  })}
                </div>
                {document ? (
                  <>
                    <RepresentativeVisualCueHandDrawnEditor
                      documentId={document.id}
                      disabled={isReadOnly === true}
                      onAdopt={onRepresentativeVisualCueChange}
                    />
                    <RepresentativeVisualCueImageEditor
                      documentId={document.id}
                      disabled={isReadOnly === true}
                      onAdopt={onRepresentativeVisualCueChange}
                    />
                  </>
                ) : null}
                {selectedIsland.representativeCue ? (
                  <>
                    <label
                      htmlFor="selected-island-visual-cue-alt-text"
                      style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155" }}
                    >
                      {t("side_panel.visual_cue.alt_text")}
                    </label>
                    <input
                      id="selected-island-visual-cue-alt-text"
                      type="text"
                      value={selectedIsland.representativeCue.altText}
                      maxLength={80}
                      required
                      disabled={isReadOnly}
                      onChange={(event) => {
                        if (event.target.value.trim().length === 0) {
                          return;
                        }
                        onRepresentativeVisualCueChange({
                          ...selectedIsland.representativeCue!,
                          altText: event.target.value,
                        });
                      }}
                      style={{
                        width: "100%",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        padding: "6px 8px",
                        boxSizing: "border-box",
                      }}
                    />
                    <button
                      type="button"
                      disabled={isReadOnly}
                      onClick={() => {
                        onRepresentativeVisualCueChange(undefined);
                      }}
                    >
                      {t("side_panel.visual_cue.remove")}
                    </button>
                  </>
                ) : (
                  <div role="status" style={{ fontSize: 11, color: "#64748b" }}>
                    {t("side_panel.visual_cue.none")}
                  </div>
                )}
              </div>
            </details>
          ) : null}

          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
            {t("side_panel.image_url")}
          </label>
          <input
            type="url"
            value={selectedIsland.imageUrl ?? ""}
            placeholder={t("side_panel.image.url_placeholder")}
            onChange={(event) => {
              onImageUrlChange(event.target.value);
            }}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 8px",
              boxSizing: "border-box",
              marginBottom: 10,
            }}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12,
              color: "#334155",
              marginBottom: 10,
            }}
          >
            <input
              type="checkbox"
              checked={selectedIsland.imageReviewed === true}
              onChange={(event) => {
                onImageReviewedChange(event.target.checked);
              }}
            />
            {t("side_panel.reviewed")}
          </label>

          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
            {t("side_panel.critique.note")}
          </label>
          <textarea
            value={selectedIsland.critique ?? ""}
            onChange={(event) => {
              onIslandCritiqueChange(event.target.value);
            }}
            placeholder={t("side_panel.critique.note_placeholder")}
            rows={4}
            style={{
              width: "100%",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 8px",
              boxSizing: "border-box",
              marginBottom: 10,
              resize: "vertical",
            }}
          />
          <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>{t("side_panel.critique.tags")}</div>
          <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
            {CRITIQUE_TAGS.map((tag) => (
              <label key={tag} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
                <input
                  type="checkbox"
                  checked={(selectedIsland.critiqueTags ?? []).includes(tag)}
                  onChange={() => {
                    onIslandCritiqueTagsChange(toggleCritiqueTag(selectedIsland.critiqueTags, tag));
                  }}
                />
                {critiqueTagLabels[tag]}
              </label>
            ))}
          </div>
          {providerUnavailableMessage ? (
            <div
              role="alert"
              style={{ fontSize: 11, lineHeight: 1.5, color: "#92400e", backgroundColor: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, padding: 8, marginBottom: 10 }}
            >
              {t("side_panel.critique.provider_disabled")}
            </div>
          ) : null}
          <div
            data-domain-flow="critique-reproposal"
            role="note"
            style={{ fontSize: 11, lineHeight: 1.5, color: "#475569", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 10 }}
          >
            {t("side_panel.critique.reproposal_hint")}
          </div>
          <button
            data-domain-action="open-critique-workflow"
            type="button"
            onClick={onOpenCritiqueWorkflow}
            disabled={
              !(selectedIsland.critique?.trim())
              && (selectedIsland.critiqueTags?.length ?? 0) === 0
            }
            style={{ width: "100%", marginBottom: 10 }}
          >
            {t("side_panel.critique.open_reproposal")}
          </button>

          <div
            style={{
              height: 96,
              borderRadius: 6,
              border: "1px solid #e2e8f0",
              overflow: "hidden",
              backgroundColor: "#f8fafc",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#94a3b8",
              fontSize: 12,
              marginBottom: 8,
            }}
          >
            {safeMode && selectedIsland.imageUrl ? (
              <span role="status" style={{ color: "#475569", padding: 8, textAlign: "center" }}>
                {t("side_panel.image.safe_mode_blocked")}
              </span>
            ) : shouldLoadLegacyIslandImage(safeMode, selectedIsland.imageUrl) ? (
              hasImagePreviewError ? (
                <span style={{ color: "#b91c1c" }}>{t("side_panel.image.preview_error")}</span>
              ) : (
                <img
                  src={selectedIsland.imageUrl!}
                  alt={t("side_panel.image.preview_alt")}
                  onError={() => {
                    setHasImagePreviewError(true);
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              )
            ) : (
              t("side_panel.image.no_image")
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {hasCardSelection ? (
              <div style={{ fontSize: 12, color: "#64748b" }}>{t("side_panel.selection", { value: selectedCardLabel })}</div>
            ) : null}
            <button
              type="button"
              onClick={onFocusIsland}
              style={{
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                borderRadius: 6,
                padding: "6px 10px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("side_panel.island_editor.focus")}
            </button>
            {selectedIsland.shapeStale === true ? (
              <div
                style={{
                  border: "1px solid #f59e0b",
                  backgroundColor: "#fffbeb",
                  color: "#92400e",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {t("side_panel.island_editor.shape_stale")}
              </div>
            ) : null}
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, color: "#475569" }}>{t("side_panel.island_editor.shape")}</label>
              <select
                aria-label={t("side_panel.island_editor.shape")}
                value={selectedIsland.shape?.kind === "polygon" ? "polygon" : "rect"}
                disabled={isReadOnly}
                onChange={(event) => {
                  onIslandShapeKindChange(event.target.value === "polygon" ? "polygon" : "rect");
                }}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: "6px 8px",
                  fontSize: 13,
                  backgroundColor: isReadOnly ? "#f8fafc" : "#ffffff",
                  color: "#0f172a",
                }}
              >
                <option value="rect">{t("side_panel.island_editor.shape_rect")}</option>
                <option value="polygon">{t("side_panel.island_editor.shape_polygon")}</option>
              </select>
            </div>
            {selectedIsland.shape?.kind === "polygon" ? (
              <div style={{ display: "grid", gap: 4 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#0f172a" }}>
                  <input
                    type="checkbox"
                    checked={isPolygonVertexEditEnabled}
                    disabled={isReadOnly}
                    onChange={(event) => {
                      onPolygonVertexEditEnabledChange(event.target.checked);
                    }}
                  />
                  {t("side_panel.island_editor.edit_boundary")}
                </label>
                <div style={{ fontSize: 12, color: "#475569" }}>
                  {t("side_panel.island_editor.vertex_help")}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={onGenerateIslandPolygon}
              style={{
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                borderRadius: 6,
                padding: "6px 10px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {selectedIsland.shape?.generatedFrom ? t("side_panel.island_editor.reset_polygon") : t("side_panel.island_editor.regenerate_polygon")}
            </button>
            <button
              type="button"
              onClick={onAddSelectedCards}
              disabled={!hasCardSelection}
              style={{
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                borderRadius: 6,
                padding: "6px 10px",
                fontWeight: 600,
                cursor: hasCardSelection ? "pointer" : "not-allowed",
              }}
            >
              {t("side_panel.island_editor.add_selected_cards", { count: selectedCardCount })}
            </button>
            <button
              type="button"
              onClick={handleRemoveSelectedCardsClick}
              disabled={!hasCardSelection}
              style={{
                border: "1px solid #cbd5e1",
                backgroundColor: "#ffffff",
                color: "#0f172a",
                borderRadius: 6,
                padding: "6px 10px",
                fontWeight: 600,
                cursor: hasCardSelection ? "pointer" : "not-allowed",
              }}
            >
              {t("side_panel.island_editor.remove_selected_cards", { count: selectedCardCount })}
            </button>
            <button
              type="button"
              onClick={handleDeleteIslandClick}
              style={{
                border: "1px solid #fecaca",
                backgroundColor: "#fff1f2",
                color: "#b91c1c",
                borderRadius: 6,
                padding: "6px 10px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {t("side_panel.island_editor.delete")}
            </button>
          </div>
        </>
      ) : selectedAggregatedEdge ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#0f172a" }}>{t("side_panel.edge_inspector.title")}</div>
          <div style={{ fontSize: 12, color: "#334155", marginBottom: 6 }}>
            {t("side_panel.edge_inspector.endpoint", {
              from: selectedAggregatedEdge.fromLabel ?? selectedAggregatedEdge.fromId,
              fromKind: selectedAggregatedEdge.fromKind,
              to: selectedAggregatedEdge.toLabel ?? selectedAggregatedEdge.toId,
              toKind: selectedAggregatedEdge.toKind,
            })}
          </div>
          {selectedPersistedEdgeType !== null && !isReadOnly ? (
            // DOMAIN-KJ-01: persisted edges get an in-place relation-type
            // control (one Cmd/Ctrl+Z-reversible history step per change).
            // An UNKNOWN preserved type shows a preservation notice; picking
            // a known type from the select intentionally overwrites it.
            <div style={{ marginBottom: 8 }}>
              <label style={{ display: "block", fontSize: 12, color: "#334155", marginBottom: 4 }}>
                {t("side_panel.connect.edge_type")}
              </label>
              <select
                data-testid="edge-type-select"
                aria-label={t("side_panel.connect.edge_type")}
                value={resolveKnownEdgeType(selectedPersistedEdgeType)}
                onChange={(event) => {
                  onEdgeTypeChange(selectedAggregatedEdge.id, resolveKnownEdgeType(event.target.value));
                }}
                style={{ width: "100%" }}
              >
                {KNOWN_EDGE_TYPES.map((edgeType) => (
                  <option key={edgeType} value={edgeType}>
                    {t(`side_panel.connect.${edgeType}`)}
                  </option>
                ))}
              </select>
              {(KNOWN_EDGE_TYPES as readonly string[]).includes(selectedPersistedEdgeType) ? null : (
                <div style={{ fontSize: 11, color: "#92400e", marginTop: 4 }}>
                  {t("side_panel.edge_inspector.unknown_type_preserved", { raw: selectedPersistedEdgeType })}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#334155", marginBottom: 8 }}>
              {t("side_panel.edge_inspector.type", {
                type: (KNOWN_EDGE_TYPES as readonly string[]).includes(selectedAggregatedEdge.type)
                  ? t(`side_panel.connect.${selectedAggregatedEdge.type}`)
                  : selectedAggregatedEdge.type,
              })}
            </div>
          )}
          {selectedAggregatedEdge.isDerivedIslandEdge ? (
            <div style={{ fontSize: 12, color: "#334155", marginBottom: 8 }}>
              {t("side_panel.edge_inspector.count", { count: selectedAggregatedEdge.aggregateCount ?? selectedAggregatedEdge.sources.length })}
            </div>
          ) : null}
          <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
            {t("side_panel.edge_inspector.contributing_edges", {
              count: selectedAggregatedEdge.isDerivedIslandEdge
                ? selectedAggregatedEdge.contributingEdgeIds?.length ?? 0
                : selectedAggregatedEdge.sources.length,
            })}
          </div>
          <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
            {(selectedAggregatedEdge.isDerivedIslandEdge
              ? (selectedAggregatedEdge.contributingEdgeIds ?? []).map((edgeId) => ({
                  sourceFromCardId: edgeId,
                  sourceToId: "",
                  sourceToKind: "card" as const,
                }))
              : selectedAggregatedEdge.sources
            )
              .slice(0, 20)
              .map((source, index) => (
                <div key={`${source.sourceFromCardId}-${source.sourceToId}-${index}`} style={{ fontSize: 12, color: "#334155" }}>
                  {selectedAggregatedEdge.isDerivedIslandEdge
                    ? source.sourceFromCardId
                    : `${source.sourceFromCardId} → ${source.sourceToId} (${source.sourceToKind})`}
                </div>
              ))}
            {(selectedAggregatedEdge.isDerivedIslandEdge
              ? (selectedAggregatedEdge.contributingEdgeIds?.length ?? 0)
              : selectedAggregatedEdge.sources.length) > 20 ? (
              <div style={{ fontSize: 12, color: "#64748b" }}>{t("side_panel.edge_inspector.more")}</div>
            ) : null}
          </div>
          {selectedAggregatedEdge.isDerivedIslandEdge && (selectedAggregatedEdge.contributingCardIds?.length ?? 0) > 0 ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>{t("side_panel.edge_inspector.contributing_cards")}</div>
              <div style={{ display: "grid", gap: 4 }}>
                {selectedAggregatedEdge.contributingCardIds?.map((cardId) => (
                  <button
                    key={cardId}
                    type="button"
                    onClick={() => {
                      onInspectSelectedEdgeCard(cardId);
                    }}
                    style={{ textAlign: "left", fontSize: 12 }}
                  >
                    {cardId}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onRevealSelectedEdgeSources}
            style={{
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "6px 10px",
              backgroundColor: "#ffffff",
              color: "#0f172a",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {t("side_panel.edge_inspector.reveal_sources")}
          </button>
          {selectedIslandRelationExplanation ? (
            <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{t("side_panel.edge_inspector.explanation_template")}</div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 12,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: 8,
                  backgroundColor: "#f8fafc",
                  color: "#0f172a",
                }}
              >
                {`${selectedIslandRelationExplanation.title}\n\n${selectedIslandRelationExplanation.body}\n\n${t("side_panel.edge_inspector.grounding_edge_ids")}: ${selectedIslandRelationExplanation.groundingEdgeIds.join(", ") || t("side_panel.none")}\n${t("side_panel.edge_inspector.grounding_card_ids")}: ${selectedIslandRelationExplanation.groundingCardIds.join(", ") || t("side_panel.none")}`}
              </pre>
              <button type="button" onClick={handleCopyExplanationClick} style={{ marginTop: 8, fontSize: 12 }}>
                {t("side_panel.edge_inspector.copy_explanation")}
              </button>
              {copyExplanationFeedback === "copied" ? (
                <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#166534", marginTop: 6 }}>{t("side_panel.copy.copied")}</div>
              ) : null}
              {copyExplanationFeedback === "failed" ? (
                <div role="status" aria-live="polite" style={{ fontSize: 12, color: "#b91c1c", marginTop: 6 }}>{t("side_panel.copy.failed")}</div>
              ) : null}
            </div>
          ) : null}
          <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 12 }}>
            {isAdvancedUiEnabled ? (
              <button type="button" onClick={onGenerateRelationSummary} disabled={isGeneratingRelationSummary}>
                {isGeneratingRelationSummary ? t("side_panel.relation_summary.generating") : t("side_panel.relation_summary.generate_ai")}
              </button>
            ) : null}
            <div style={{ marginTop: 8, fontSize: 12, color: "#7f1d1d" }}>
              {t("side_panel.relation_summary.draft_warning")}
            </div>
            {selectedRelationSummary ? (
              <>
                <textarea
                  value={hideUnreviewedRelationSummary ? t("side_panel.relation_summary.unreviewed_hidden") : relationSummaryDraft}
                  onChange={(event) => {
                    if (hideUnreviewedRelationSummary) {
                      return;
                    }
                    setRelationSummaryDraft(event.target.value);
                  }}
                  onBlur={() => {
                    if (!hideUnreviewedRelationSummary) {
                      onRelationSummaryCommit(relationSummaryDraft);
                    }
                  }}
                  maxLength={RELATION_SUMMARY_TEXT_MAX_LENGTH}
                  readOnly={hideUnreviewedRelationSummary}
                  style={{
                    width: "100%",
                    marginTop: 8,
                    minHeight: 110,
                    boxSizing: "border-box",
                    ...(hideUnreviewedRelationSummary ? { color: "#92400e", backgroundColor: "#fff7ed", borderColor: "#fdba74" } : {}),
                  }}
                />
                <div style={{ marginTop: 4, fontSize: 11, color: "#64748b" }}>
                  {hideUnreviewedRelationSummary ? t("side_panel.relation_summary.safe_mode_hidden") : `${relationSummaryDraft.length}/${RELATION_SUMMARY_TEXT_MAX_LENGTH}`}
                </div>
                <label style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
                  <input
                    type="checkbox"
                    checked={selectedRelationSummary.reviewed}
                    onChange={(event) => {
                      onRelationSummaryReviewedChange(event.target.checked);
                    }}
                  />
                  {t("side_panel.reviewed")}
                </label>
                {relationSummaryFeedback ? <div style={{ marginTop: 6, fontSize: 12, color: "#92400e" }}>{relationSummaryFeedback}</div> : null}
                {selectedRelationSummary.warnings && selectedRelationSummary.warnings.length > 0 ? (
                  <div style={{ marginTop: 8, border: "1px solid #fca5a5", backgroundColor: "#fef2f2", borderRadius: 6, padding: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#991b1b", marginBottom: 6 }}>
                      {t("side_panel.summary.warnings_with_count", { count: selectedRelationSummary.warnings.length })}
                    </div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#7f1d1d" }}>
                      {selectedRelationSummary.warnings.map((warning, index) => (
                        <li key={`${warning}-${index}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "#334155" }}>{t("side_panel.summary.grounding_cards_label")}</div>
                <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                  {selectedRelationSummary.groundingCardIds.map((cardId) => (
                    <button key={cardId} type="button" style={{ textAlign: "left", fontSize: 12 }} onClick={() => onRelationSummaryGroundingInspect(cardId)}>
                      {cardId}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "#334155" }}>{t("side_panel.relation_summary.grounding_edges")}</div>
                <div style={{ marginTop: 4, fontSize: 12, color: "#334155" }}>
                  {selectedRelationSummary.groundingEdgeIds.join(", ") || t("side_panel.none")}
                </div>
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 12, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
                    {t("side_panel.history.with_count", { count: relationSummaryHistoryEntries.length })}
                  </summary>
                  <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                    {relationSummaryHistoryEntries.length === 0 ? (
                      <div style={{ fontSize: 12, color: "#64748b" }}>{t("side_panel.relation_summary.no_history")}</div>
                    ) : (
                      relationSummaryHistoryEntries.map((entry) => {
                        const isExpanded = expandedRelationSummaryHistoryEntryId === entry.id;
                        const preview = (entry.toText ?? "").slice(0, 80);

                        return (
                          <div key={entry.id} style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8 }}>
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedRelationSummaryHistoryEntryId(isExpanded ? null : entry.id);
                              }}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                cursor: "pointer",
                                display: "grid",
                                gap: 4,
                              }}
                            >
                              <div style={{ fontSize: 11, color: "#64748b" }}>{formatTimestamp(entry.createdAt)}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span
                                  style={{
                                    borderRadius: 999,
                                    border: "1px solid #cbd5e1",
                                    padding: "1px 7px",
                                    fontSize: 11,
                                    color: "#334155",
                                    backgroundColor: "#f8fafc",
                                    textTransform: "lowercase",
                                  }}
                                >
                                  {entry.changeKind}
                                </span>
                                <span style={{ fontSize: 12, color: "#0f172a" }}>{preview || t("side_panel.empty")}</span>
                              </div>
                            </button>
                            {isExpanded ? (
                              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                                <div style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.history.from")}</div>
                                <pre style={{ margin: 0, fontSize: 12, backgroundColor: "#f8fafc", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
                                  {entry.fromText ?? t("side_panel.empty")}
                                </pre>
                                <div style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.history.to")}</div>
                                <pre style={{ margin: 0, fontSize: 12, backgroundColor: "#f8fafc", borderRadius: 6, padding: 8, whiteSpace: "pre-wrap" }}>
                                  {entry.toText ?? t("side_panel.empty")}
                                </pre>
                                <div style={{ fontSize: 11, color: "#475569" }}>
                                  {t("side_panel.summary.reviewed_transition", {
                                    from: entry.fromReviewed === null ? "-" : entry.fromReviewed ? t("side_panel.boolean.true") : t("side_panel.boolean.false"),
                                    to: entry.toReviewed === null ? "-" : entry.toReviewed ? t("side_panel.boolean.true") : t("side_panel.boolean.false"),
                                  })}
                                </div>
                                <div style={{ fontSize: 11, color: "#475569" }}>
                                  {t("side_panel.summary.warnings_snapshot", { value: (entry.warningsSnapshot ?? []).join(" | ") || t("side_panel.none") })}
                                </div>
                                <div style={{ fontSize: 11, color: "#475569" }}>
                                  {t("side_panel.summary.grounding_cards_snapshot", { value: (entry.groundingCardIdsSnapshot ?? []).join(", ") || t("side_panel.none") })}
                                </div>
                                <div style={{ fontSize: 11, color: "#475569" }}>
                                  {t("side_panel.summary.grounding_edges_snapshot", { value: (entry.groundingEdgeIdsSnapshot ?? []).join(", ") || t("side_panel.none") })}
                                </div>
                                {entry.note ? <div style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.summary.note", { value: entry.note })}</div> : null}
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!entry.toText || entry.toText.trim().length === 0) {
                                      setRelationSummaryFeedback(t("side_panel.summary.cannot_restore_empty"));
                                      return;
                                    }

                                    setRelationSummaryFeedback(null);
                                    onRestoreRelationSummaryHistoryEntry(entry.id);
                                  }}
                                  style={{ width: "100%" }}
                                >
                                  {t("side_panel.history.restore_version")}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </details>
              </>
            ) : null}
          </div>

        </>
      ) : hasCardSelection ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#0f172a" }}>{t("side_panel.card_inspector.title")}</div>
          {!selectedCard ? (
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>
              {t("side_panel.card_inspector.select_single", { label: selectedCardLabel })}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{selectedCardLabel}</div>
              <button
                type="button"
                onClick={onFocusCard}
                style={{ width: "100%", marginBottom: 10, fontWeight: 600 }}
              >
                {t("side_panel.card_inspector.focus")}
              </button>
              {opposingViewpointProposal && opposingViewpointProposal.targetCardId === selectedCard.id ? (
                <div
                  data-ui-region="opposing-viewpoint-proposal"
                  style={{
                    border: "1px solid #fed7aa",
                    borderRadius: 6,
                    backgroundColor: "#fff7ed",
                    padding: 8,
                    marginBottom: 10,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ fontSize: 11, color: "#9a3412", fontWeight: 700 }}>
                    {opposingViewpointProposal.evidenceGap
                      ? t("side_panel.card_inspector.evidence_gap")
                      : t("side_panel.card_inspector.opposing_viewpoint")}
                  </div>
                  <div style={{ fontSize: 12, color: "#0f172a" }}>{opposingViewpointProposal.opposingText}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{opposingViewpointProposal.rationale}</div>
                  <div style={{ fontSize: 10, color: "#9a3412" }}>
                    {t("side_panel.card_inspector.proposal_only")}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      data-ui-region="hold-opposing-viewpoint"
                      onClick={() => {
                        // AI-OPPOSE-01: connect the evidence-gap proposal to the
                        // card's hold state so the concern is kept and can be
                        // returned to (元の違和感・矛盾に戻れる).
                        onCardHoldStateChange("held");
                        onDismissOpposingViewpointProposal();
                      }}
                      style={{ fontSize: 11 }}
                    >
                      {t("side_panel.card_inspector.hold_for_review")}
                    </button>
                    <button
                      type="button"
                      onClick={onDismissOpposingViewpointProposal}
                      style={{ fontSize: 11 }}
                    >
                      {t("side_panel.card_inspector.dismiss_proposal")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  data-ui-region="propose-opposing-viewpoint"
                  onClick={() => onProposeOpposingViewpoint(selectedCard.id)}
                  disabled={isProposingOpposingViewpoint}
                  style={{ width: "100%", marginBottom: 10, fontWeight: 600 }}
                >
                  {isProposingOpposingViewpoint
                    ? t("side_panel.card_inspector.proposing_opposing")
                    : t("side_panel.card_inspector.propose_opposing")}
                </button>
              )}
              <div style={{ marginBottom: 12 }}>
                <button
                  ref={cardQualityAssistTriggerRef}
                  type="button"
                  data-domain-action="open-card-quality-assist"
                  onClick={onOpenCardQualityAssist}
                  disabled={isReadOnly}
                  style={{ width: "100%", marginBottom: cardQualityAssistState ? 8 : 0 }}
                >
                  {t("side_panel.card_quality.open")}
                </button>
                {cardQualityAssistState ? (
                  <div
                    role="group"
                    aria-label={t("side_panel.card_quality.open")}
                    style={{ border: "1px solid #cbd5e1", borderRadius: 6, backgroundColor: "#f8fafc", padding: 8, display: "grid", gap: 8 }}
                  >
                    {currentCardQualityQuestion(cardQualityAssistState) ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>
                          {t(currentCardQualityQuestion(cardQualityAssistState)!.promptKey)}
                        </div>
                        <div style={{ fontSize: 11, color: "#475569" }}>
                          {t(currentCardQualityQuestion(cardQualityAssistState)!.rationaleKey)}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            data-domain-action="card-quality-decision-apply"
                            onClick={() => onAnswerCardQualityQuestion("apply")}
                            style={{ flex: 1 }}
                          >
                            {t("side_panel.card_quality.decision.apply")}
                          </button>
                          <button
                            type="button"
                            data-domain-action="card-quality-decision-keep-as-is"
                            onClick={() => onAnswerCardQualityQuestion("keep_as_is")}
                            style={{ flex: 1 }}
                          >
                            {t("side_panel.card_quality.decision.keep_as_is")}
                          </button>
                          <button
                            type="button"
                            data-domain-action="card-quality-decision-hold-for-now"
                            onClick={() => onAnswerCardQualityQuestion("hold_for_now")}
                            style={{ flex: 1 }}
                          >
                            {t("side_panel.card_quality.decision.hold_for_now")}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: "#0f172a" }}>{t("side_panel.card_quality.done")}</div>
                    )}
                    {cardQualityOriginalText !== undefined ? (
                      <div
                        data-panel="card-quality-text-comparison"
                        style={{ display: "grid", gap: 6, borderTop: "1px solid #cbd5e1", paddingTop: 8 }}
                      >
                        <div style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>
                          {t("side_panel.card_quality.original_text")}
                        </div>
                        <div
                          data-card-quality-text="before"
                          style={{ padding: 8, border: "1px solid #e2e8f0", borderRadius: 4, backgroundColor: "#fff", fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                        >
                          {cardQualityOriginalText}
                        </div>
                        <label htmlFor="card-quality-revised-text" style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>
                          {t("side_panel.card_quality.revised_text")}
                        </label>
                        <textarea
                          id="card-quality-revised-text"
                          data-card-quality-text="after"
                          value={cardQualityTextDraft}
                          onChange={(event) => setCardQualityTextDraft(event.currentTarget.value)}
                          rows={4}
                          style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit", fontSize: 12 }}
                        />
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {t("side_panel.card_quality.compare_help")}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            data-domain-action="commit-card-quality-text"
                            onClick={() => onCommitCardQualityText(cardQualityTextDraft)}
                            disabled={cardQualityTextDraft.trim().length === 0 || cardQualityTextDraft === selectedCard?.text}
                            style={{ flex: "1 1 120px" }}
                          >
                            {t("side_panel.card_quality.commit_text")}
                          </button>
                          {selectedCard?.text !== cardQualityOriginalText ? (
                            <button
                              type="button"
                              data-domain-action="restore-card-quality-text"
                              onClick={onRestoreCardQualityText}
                              style={{ flex: "1 1 120px" }}
                            >
                              {t("side_panel.card_quality.restore_original")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 6 }}>
                      {!currentCardQualityQuestion(cardQualityAssistState) ? (
                        <button
                          type="button"
                          data-domain-action="edit-card-text-from-quality-assist"
                          onClick={onOpenCardTextEditor}
                          style={{ flex: 1 }}
                        >
                          {t("side_panel.card_quality.edit_text")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        data-domain-action="close-card-quality-assist"
                        onClick={() => {
                          onCloseCardQualityAssist();
                          setTimeout(() => cardQualityAssistTriggerRef.current?.focus(), 0);
                        }}
                        style={{ flex: 1 }}
                      >
                        {t("side_panel.card_quality.close")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <details data-panel="card-record-details" style={{ marginBottom: 12 }}>
                <summary style={{ fontSize: 12, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
                  {t("side_panel.card_inspector.record_details")}
                </summary>
                <dl
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr)",
                    gap: "6px 10px",
                    margin: "8px 0 0",
                    padding: 8,
                    border: "1px solid #e2e8f0",
                    borderRadius: 6,
                    backgroundColor: "#f8fafc",
                    fontSize: 11,
                  }}
                >
                  <dt style={{ color: "#64748b" }}>{t("side_panel.card_inspector.card_id")}</dt>
                  <dd style={{ margin: 0, color: "#0f172a", overflowWrap: "anywhere" }}>{selectedCard.id}</dd>
                  <dt style={{ color: "#64748b" }}>{t("side_panel.card_inspector.record_role")}</dt>
                  <dd style={{ margin: 0, color: "#0f172a" }}>
                    {selectedCard.canonicalId
                      ? t("side_panel.card_inspector.record_role_source")
                      : t("side_panel.card_inspector.record_role_canonical")}
                  </dd>
                  <dt style={{ color: "#64748b" }}>{t("side_panel.card_inspector.document_created_at")}</dt>
                  <dd style={{ margin: 0, color: "#0f172a", overflowWrap: "anywhere" }}>
                    {document?.createdAt
                      ? <time dateTime={document.createdAt}>{formatTimestamp(document.createdAt)}</time>
                      : t("side_panel.card_inspector.not_available")}
                  </dd>
                  <dt style={{ color: "#64748b" }}>{t("side_panel.card_inspector.document_updated_at")}</dt>
                  <dd style={{ margin: 0, color: "#0f172a", overflowWrap: "anywhere" }}>
                    {document?.updatedAt
                      ? <time dateTime={document.updatedAt}>{formatTimestamp(document.updatedAt)}</time>
                      : t("side_panel.card_inspector.not_available")}
                  </dd>
                  <dt style={{ color: "#64748b" }}>{t("side_panel.card_inspector.responsibility_metadata")}</dt>
                  <dd style={{ margin: 0, color: "#475569" }}>{t("side_panel.card_inspector.responsibility_metadata_unavailable")}</dd>
                </dl>
              </details>
              {selectedCard.canonicalId ? (
                <>
                  <label
                    htmlFor="selected-card-canonical-id"
                    style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}
                  >
                    canonicalId
                  </label>
                  <input
                    id="selected-card-canonical-id"
                    type="text"
                    readOnly
                    value={selectedCard.canonicalId}
                    style={{
                      width: "100%",
                      border: "1px solid #cbd5e1",
                      borderRadius: 6,
                      padding: "6px 8px",
                      boxSizing: "border-box",
                      marginBottom: 12,
                      backgroundColor: "#f8fafc",
                      color: "#334155",
                    }}
                  />
                </>
              ) : null}
              {/* F-8: do not gate on selectedCard.canonicalId — a card that was itself
                  merged into another card can still be a representative of its OWN
                  sources from an earlier merge (chained canonicalization). This guard
                  independently re-introduced the bug App.tsx's computation already
                  fixed; hasSourceCardsForSelectedCanonical/hasMissingSourceCardsForSelectedCanonical
                  alone are the correct signal. */}
              {hasSourceCardsForSelectedCanonical || hasMissingSourceCardsForSelectedCanonical ? (
                <div style={{ marginBottom: 12 }}>
                  <details>
                    <summary style={{ fontSize: 12, fontWeight: 600, color: "#334155", cursor: "pointer" }}>
                      {t("side_panel.card_inspector.origins", { count: sourceCardsForSelectedCanonical.length + missingSourceCardIdsForSelectedCanonical.length })}
                    </summary>
                    <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      {sourceCardsForSelectedCanonical.map((sourceCard) => (
                        <button
                          key={sourceCard.id}
                          type="button"
                          onClick={() => {
                            onSourceCardInspect(sourceCard.id);
                          }}
                          style={{
                            textAlign: "left",
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            padding: "6px 8px",
                            backgroundColor: revealedSourceCardIds.has(sourceCard.id) ? "#eff6ff" : "#ffffff",
                            color: "#0f172a",
                            cursor: "pointer",
                            fontSize: 12,
                          }}
                        >
                          {sourceCard.text.slice(0, 80)}
                        </button>
                      ))}

                      {missingSourceCardIdsForSelectedCanonical.map((sourceCardId) => (
                        <div
                          key={sourceCardId}
                          style={{
                            textAlign: "left",
                            border: "1px dashed #fca5a5",
                            borderRadius: 6,
                            padding: "6px 8px",
                            backgroundColor: "#fef2f2",
                            color: "#991b1b",
                            fontSize: 12,
                          }}
                        >
                          {t("side_panel.card_inspector.deleted_source", { id: sourceCardId })}
                        </div>
                      ))}
                    </div>
                  </details>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 12,
                      color: "#334155",
                      marginTop: 8,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isShowingAllSources}
                      onChange={(event) => {
                        onShowAllSourcesChange(event.target.checked);
                      }}
                    />
                    {t("side_panel.card_inspector.show_all_sources")}
                  </label>
                </div>
              ) : null}
              <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{t("side_panel.claim_type.label")}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 999,
                    ...claimTypeBadgeColors[selectedCard.claimType ?? "unknown"],
                  }}
                >
                  {claimTypeLabels[selectedCard.claimType ?? "unknown"]}
                </span>
              </div>
              <select
                aria-label={t("side_panel.claim_type.label")}
                value={selectedCard.claimType ?? "unknown"}
                disabled={isReadOnly}
                onChange={(event) => {
                  onCardClaimTypeChange(event.target.value as ClaimType);
                }}
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: "6px 8px",
                  boxSizing: "border-box",
                  marginBottom: 12,
                  backgroundColor: "#ffffff",
                  color: "#0f172a",
                }}
              >
                <option value="fact">{claimTypeLabels.fact}</option>
                <option value="claim">{claimTypeLabels.claim}</option>
                <option value="hypothesis">{claimTypeLabels.hypothesis}</option>
                <option value="unknown">{claimTypeLabels.unknown}</option>
              </select>

              <label
                htmlFor="selected-card-hold-state"
                style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}
              >
                {t("side_panel.hold_state.label")}
              </label>
              <select
                id="selected-card-hold-state"
                value={canonicalHoldState(selectedCard.holdState) ?? "active"}
                disabled={isReadOnly}
                onChange={(event) => {
                  onCardHoldStateChange(event.target.value as HoldState | "active");
                }}
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: "6px 8px",
                  boxSizing: "border-box",
                  marginBottom: 4,
                  backgroundColor: "#ffffff",
                  color: "#0f172a",
                }}
              >
                <option value="active">{t("side_panel.hold_state.active")}</option>
                <option value="held">{t("side_panel.hold_state.held")}</option>
                <option value="shelved">{t("side_panel.hold_state.shelved")}</option>
              </select>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
                {t("side_panel.hold_state.hint")}
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "#334155",
                  marginBottom: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedCard.textReviewed === true}
                  disabled={isReadOnly}
                  onChange={(event) => {
                    onCardTextReviewedChange(event.target.checked);
                  }}
                />
                {t("side_panel.card_inspector.text_reviewed")}
              </label>

              {/* DOMAIN-TRACE-01: optional serial number + raw-data source
                  reference. Never forced (empty = removed on commit). */}
              <div data-panel="card-trace-editor" style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>{t("side_panel.trace.title")}</div>
                <label style={{ display: "grid", gap: 3, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.trace.seq_label")}</span>
                  <input
                    type="number"
                    value={selectedCard.meta?.seq ?? ""}
                    disabled={isReadOnly}
                    placeholder={t("side_panel.trace.seq_placeholder")}
                    style={{ width: "100%", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 8px", boxSizing: "border-box" }}
                    onChange={(event) => {
                      onCardMetaChange(event.target.value, selectedCard.meta?.source ?? "");
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 3 }}>
                  <span style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.trace.source_label")}</span>
                  <input
                    type="text"
                    value={selectedCard.meta?.source ?? ""}
                    disabled={isReadOnly}
                    placeholder={t("side_panel.trace.source_placeholder")}
                    style={{ width: "100%", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 8px", boxSizing: "border-box" }}
                    onChange={(event) => {
                      onCardMetaChange(selectedCard.meta?.seq !== undefined ? String(selectedCard.meta.seq) : "", event.target.value);
                    }}
                  />
                </label>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{t("side_panel.trace.hint")}</div>
              </div>

              {/* DOMAIN-KA-01: optional KA-method fields (心の声/価値), kept
                  separate from Card.text (出来事の正本). Never forced (empty
                  = removed on commit). Not shown on the canvas (AC-4). */}
              <div data-panel="card-ka-editor" style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>{t("side_panel.ka.title")}</div>
                <label style={{ display: "grid", gap: 3, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.ka.voice_label")}</span>
                  <textarea
                    value={selectedCard.ka?.voice ?? ""}
                    disabled={isReadOnly}
                    placeholder={t("side_panel.ka.voice_placeholder")}
                    rows={2}
                    style={{ width: "100%", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 8px", boxSizing: "border-box", resize: "vertical" }}
                    onChange={(event) => {
                      onCardKaChange(event.target.value, selectedCard.ka?.value ?? "");
                    }}
                  />
                </label>
                <label style={{ display: "grid", gap: 3 }}>
                  <span style={{ fontSize: 11, color: "#475569" }}>{t("side_panel.ka.value_label")}</span>
                  <textarea
                    value={selectedCard.ka?.value ?? ""}
                    disabled={isReadOnly}
                    placeholder={t("side_panel.ka.value_placeholder")}
                    rows={2}
                    style={{ width: "100%", fontSize: 12, border: "1px solid #cbd5e1", borderRadius: 6, padding: "4px 8px", boxSizing: "border-box", resize: "vertical" }}
                    onChange={(event) => {
                      onCardKaChange(selectedCard.ka?.voice ?? "", event.target.value);
                    }}
                  />
                </label>
                <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{t("side_panel.ka.hint")}</div>
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>{t("side_panel.evidence.title")}</div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>{t("side_panel.evidence.outgoing")}</div>
                {outgoingEvidenceLinks.length === 0 ? <div style={{ fontSize: 11, color: "#94a3b8" }}>{t("side_panel.none")}</div> : (
                  <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                    {outgoingEvidenceLinks.map((link) => {
                      const target = document?.cards.find((card) => card.id === link.toCardId);
                      const targetLabel = target ? target.text.slice(0, 60) : link.toCardId;
                      const linkTypeLabel = link.type === "supports" ? t("side_panel.evidence.supports") : t("side_panel.evidence.contradicts");
                      return (
                        <div key={link.id} style={{ fontSize: 11, border: "1px solid #e2e8f0", borderRadius: 6, padding: 6 }}>
                          <div>{t("side_panel.evidence.outgoing_item", { type: linkTypeLabel, target: targetLabel })}</div>
                          {link.type === "contradicts" ? (
                            <label style={{ display: "grid", gap: 3, marginTop: 4 }}>
                              <span style={{ color: "#475569" }}>{t("side_panel.evidence.contradiction_state_label", { target: targetLabel })}</span>
                              <select
                                value={link.contradictionState ?? "unconfirmed"}
                                disabled={isReadOnly}
                                aria-label={t("side_panel.evidence.contradiction_state_label", { target: targetLabel })}
                                style={{ fontSize: 10, width: "100%" }}
                                onChange={(event) => {
                                  onUpdateEvidenceLink(link.id, { contradictionState: event.target.value as EvidenceLink["contradictionState"] });
                                }}
                              >
                                <option value="unconfirmed">{t("side_panel.evidence.state_unconfirmed")}</option>
                                <option value="confirmed">{t("side_panel.evidence.state_confirmed")}</option>
                                <option value="held">{t("side_panel.evidence.state_held")}</option>
                                <option value="resolved">{t("side_panel.evidence.state_resolved")}</option>
                              </select>
                            </label>
                          ) : null}
                          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                            <button type="button" style={{ fontSize: 10 }} onClick={() => { onFocusCardById(link.toCardId); }}>{t("side_panel.focus")}</button>
                            <button type="button" disabled={isReadOnly} style={{ fontSize: 10 }} onClick={() => { onRemoveEvidenceLink(link.id); }}>{t("side_panel.remove")}</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>{t("side_panel.evidence.incoming_readonly")}</div>
                {incomingEvidenceLinks.length === 0 ? <div style={{ fontSize: 11, color: "#94a3b8" }}>{t("side_panel.none")}</div> : (
                  <div style={{ display: "grid", gap: 4 }}>
                    {incomingEvidenceLinks.map((link) => {
                      const source = document?.cards.find((card) => card.id === link.fromCardId);
                      const linkTypeLabel = link.type === "supports" ? t("side_panel.evidence.supports") : t("side_panel.evidence.contradicts");
                      return <div key={link.id} style={{ fontSize: 11 }}>{t("side_panel.evidence.incoming_item", { source: source ? source.text.slice(0, 60) : link.fromCardId, type: linkTypeLabel })}</div>;
                    })}
                  </div>
                )}
                <button type="button" disabled={isReadOnly} style={{ marginTop: 8, width: "100%" }} onClick={() => {
                  setIsEvidenceModalOpen(true);
                  setPendingEvidenceType("supports");
                  setEvidenceTargetQuery("");
                  setPendingEvidenceTargetId("");
                }}>
                  {t("side_panel.evidence.add_link")}
                </button>
                {isEvidenceModalOpen ? (
                  <div style={{ marginTop: 8, border: "1px solid #cbd5e1", borderRadius: 6, padding: 8, display: "grid", gap: 6, backgroundColor: "#f8fafc" }}>
                    <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#334155" }}>
                      <span>{t("side_panel.evidence.type_label")}</span>
                      <select value={pendingEvidenceType} onChange={(event) => { setPendingEvidenceType(event.target.value as EvidenceLink["type"]); }}>
                        <option value="supports">{t("side_panel.evidence.supports")}</option>
                        <option value="contradicts">{t("side_panel.evidence.contradicts")}</option>
                      </select>
                    </label>
                    <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#334155" }}>
                      <span>{t("side_panel.evidence.search_target_label")}</span>
                      <input
                        value={evidenceTargetQuery}
                        onChange={(event) => { setEvidenceTargetQuery(event.target.value); }}
                        placeholder={t("side_panel.evidence.search_target")}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#334155" }}>
                      <span>{t("side_panel.evidence.target_label")}</span>
                      <select value={pendingEvidenceTargetId} onChange={(event) => { setPendingEvidenceTargetId(event.target.value); }}>
                        <option value="">{t("side_panel.evidence.select_target")}</option>
                        {availableEvidenceTargets.map((card) => (
                          <option key={card.id} value={card.id}>{card.text.slice(0, 80)}</option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" disabled={!pendingEvidenceTargetId} onClick={() => {
                        if (!pendingEvidenceTargetId) return;
                        onAddEvidenceLink({ toCardId: pendingEvidenceTargetId, type: pendingEvidenceType });
                        setIsEvidenceModalOpen(false);
                      }}>{t("side_panel.evidence.confirm")}</button>
                      <button type="button" onClick={() => { setIsEvidenceModalOpen(false); }}>{t("side_panel.connect.cancel")}</button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>{t("side_panel.trace.evidence_trace")}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{t("side_panel.trace.evidence_trace")}</div>
                  <button type="button" disabled={!selectedCard || isTraceRunning} onClick={() => { void handleCopyEvidenceTrace(); }}>
                    {isTraceRunning ? t("side_panel.trace.working") : t("side_panel.trace.copy_evidence")}
                  </button>
                  <button type="button" disabled={!selectedCard || isTraceRunning} onClick={handleDownloadEvidenceTrace}>
                    {t("side_panel.trace.download_evidence")}
                  </button>

                  <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 8 }}>{t("side_panel.trace.contradiction_trace")}</div>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#334155" }}>
                    {t("side_panel.trace.depth")}
                    <select
                      value={contradictionTraceDepthLimit}
                      onChange={(event) => {
                        setContradictionTraceDepthLimit(Number(event.target.value));
                      }}
                    >
                      {[1, 2, 3].map((depth) => (
                        <option key={depth} value={depth}>
                          {depth}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
                    <input
                      type="checkbox"
                      checked={contradictionTraceIncludeSupports}
                      onChange={(event) => {
                        setContradictionTraceIncludeSupports(event.target.checked);
                      }}
                    />
                    {t("side_panel.trace.include_fact_supports")}
                  </label>
                  <button type="button" disabled={!selectedCard || isTraceRunning} onClick={() => { void handleCopyContradictionTrace(); }}>
                    {isTraceRunning ? t("side_panel.trace.working") : t("side_panel.trace.copy_contradiction")}
                  </button>
                  <button type="button" disabled={!selectedCard || isTraceRunning} onClick={handleDownloadContradictionTrace}>
                    {t("side_panel.trace.download_contradiction")}
                  </button>
                  {isTraceRunning ? <button type="button" onClick={() => traceAbortRef.current?.abort()}>{t("side_panel.trace.cancel_trace")}</button> : null}
                  {traceProgressMessage ? <div style={{ fontSize: 11, color: "#334155" }}>{traceProgressMessage}</div> : null}

                  <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 8 }}>{t("side_panel.trace.analytics")}</div>
                  <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#334155" }}>
                    {t("side_panel.trace.mode")}
                    <select value={traceAnalyticsMode} onChange={(event) => setTraceAnalyticsMode(event.target.value as "evidence" | "contradiction" | "both") }>
                      <option value="both">{t("side_panel.trace.mode_both")}</option>
                      <option value="evidence">{t("side_panel.trace.mode_evidence")}</option>
                      <option value="contradiction">{t("side_panel.trace.mode_contradiction")}</option>
                    </select>
                  </label>
                  {isAnalyticsRunning ? <div style={{ fontSize: 11, color: "#64748b" }}>{t("side_panel.trace.computing_analytics")}</div> : null}
                  {isAnalyticsRunning ? <button type="button" onClick={() => analyticsAbortRef.current?.abort()}>{t("side_panel.trace.cancel_analytics")}</button> : null}
                  {traceAnalytics ? (
                    <div style={{ fontSize: 11, color: "#334155", display: "grid", gap: 4 }}>
                      <div>{t("side_panel.trace.visited", { cards: traceAnalytics.visitedCardIds.length, links: traceAnalytics.visitedLinkIds.length })}</div>
                      <div>{t("side_panel.trace.evidence_links_doc", { count: traceAnalytics.evidenceLinkCount })}</div>
                      <div>{t("side_panel.trace.isolated_nodes_doc", { count: traceAnalytics.isolatedNodeCount })}</div>
                      <div>{t("side_panel.trace.source_density_doc", { value: traceAnalytics.sourceDensity.toFixed(4) })}</div>
                      <div>{t("side_panel.trace.relation_counts", { value: Object.entries(traceAnalytics.byRelationType).sort((a, b) => a[0].localeCompare(b[0])).map(([type, count]) => `${formatEvidenceRelationType(type)}:${count}`).join(", ") || t("side_panel.none") })}</div>
                      <div>{t("side_panel.trace.depth_histogram", { value: Object.entries(traceAnalytics.depthHistogram).sort((a, b) => Number(a[0]) - Number(b[0])).map(([depth, count]) => `d${depth}:${count}`).join(", ") || t("side_panel.none") })}</div>
                      <div>{t("side_panel.trace.top_hubs", { value: traceAnalytics.topHubs.map((hub) => `${hub.cardId}(${hub.degree})`).join(", ") || t("side_panel.none") })}</div>
                      <div>{t("side_panel.trace.cycle_count", { value: traceAnalytics.cycles ? traceAnalytics.cycles.count : t("side_panel.trace.skipped") })}</div>
                    </div>
                  ) : null}
                  <button type="button" disabled={!traceAnalyticsMd || isAnalyticsRunning} onClick={handleDownloadTraceAnalytics}>
                    {t("side_panel.trace.export_analytics")}
                  </button>

                  {selectedCardContradictionsCount === 0 ? (
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{t("side_panel.trace.no_contradictions")}</div>
                  ) : null}
                </div>
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>{t("side_panel.evidence_overlay.title")}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
                  {t("side_panel.evidence_overlay.status", {
                    state: evidenceOverlayEnabled ? t("side_panel.on") : t("side_panel.off"),
                    scope: evidenceOverlayScope === "selection" ? t("view_controls.evidence.selection") : t("view_controls.evidence.all"),
                  })}
                </div>
                <button
                  type="button"
                  style={{ width: "100%" }}
                  onClick={() => {
                    onEnableEvidenceOverlaySelectionExplore();
                  }}
                >
                  {t("side_panel.evidence_overlay.explore_from_card")}
                </button>
              </div>

              <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                {t("side_panel.critique.note")}
              </label>
              <textarea
                value={selectedCard.critique ?? ""}
                disabled={isReadOnly}
                onChange={(event) => {
                  onCardCritiqueChange(event.target.value);
                }}
                placeholder={t("side_panel.critique.card_note_placeholder")}
                rows={4}
                style={{
                  width: "100%",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: "6px 8px",
                  boxSizing: "border-box",
                  marginBottom: 12,
                  resize: "vertical",
                }}
              />
              <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 6 }}>{t("side_panel.critique.tags")}</div>
              <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                {CRITIQUE_TAGS.map((tag) => (
                  <label key={tag} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155" }}>
                    <input
                      type="checkbox"
                      checked={(selectedCard.critiqueTags ?? []).includes(tag)}
                      disabled={isReadOnly}
                      onChange={() => {
                        onCardCritiqueTagsChange(toggleCritiqueTag(selectedCard.critiqueTags, tag));
                      }}
                    />
                    {critiqueTagLabels[tag]}
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "#b45309", marginBottom: 12 }}>
                {t("side_panel.critique.placard_return_check_hint")}
              </div>
              {providerUnavailableMessage ? (
                <div
                  role="alert"
                  style={{ fontSize: 11, lineHeight: 1.5, color: "#92400e", backgroundColor: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 6, padding: 8, marginBottom: 12 }}
                >
                  {t("side_panel.critique.provider_disabled")}
                </div>
              ) : null}
              <div
                data-domain-flow="critique-reproposal"
                role="note"
                style={{ fontSize: 11, lineHeight: 1.5, color: "#475569", backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, marginBottom: 12 }}
              >
                {t("side_panel.critique.reproposal_hint")}
              </div>
              <button
                data-domain-action="open-critique-workflow"
                type="button"
                onClick={onOpenCritiqueWorkflow}
                disabled={
                  !(selectedCard.critique?.trim())
                  && (selectedCard.critiqueTags?.length ?? 0) === 0
                }
                style={{ width: "100%", marginBottom: 12 }}
              >
                {t("side_panel.critique.open_reproposal")}
              </button>
            </>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>
          {t("side_panel.empty_selection_hint")}
        </div>
      )}
    </aside>
  );
}
