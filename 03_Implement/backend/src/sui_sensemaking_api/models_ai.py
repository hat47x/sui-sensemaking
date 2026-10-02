from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from sui_sensemaking_api.models import DocumentV1, NarrativeCheckCounts


# DATA-CONTRACT-02 (案b): align the API contract with the persistence bound.
# The ai_proposals / decision tables enforce `length(source_bundle_hash) = 64`,
# so a `mock:`-prefixed (69-char) hash passed the request pattern but failed at
# DB flush with a misleading 409. The docs CE4 path keeps its OWN mock: gate
# (runtime policy `ce4_source_bundle_hash_allow_mock`); the proposal path now
# accepts only the 64-char SHA-256 form, matching what can be persisted.
SOURCE_BUNDLE_HASH_PATTERN = r"^[0-9a-f]{64}$"


class TokenUsageCoverage(BaseModel):
    """Content-free completeness counters for provider token usage reports."""

    model_config = ConfigDict(extra="forbid")

    completeCalls: int = Field(default=0, ge=0)
    partialCalls: int = Field(default=0, ge=0)
    missingCalls: int = Field(default=0, ge=0)


class ProviderStatusResponse(BaseModel):
    """PROV-VIS-01 (ADR-0050 D1): read-only echo of the configured LLM
    provider kind. This is NOT a live connectivity check — it reports the
    resolved provider_kind only. "fixture" is a test-only provider selected
    directly in Python tests, never via SUI_LLM_PROVIDER, so it is not a
    reachable runtime value here."""

    model_config = ConfigDict(extra="forbid")

    providerKind: Literal["none", "local", "large-scale", "deepseek"]
    # OPS-LLM-COST-01 (段階2): in-process LLM call counts per provider kind
    # (plus "total"). Referenceable so an operator can see external
    # (large-scale) call volume. Empty until the first LLM call.
    callCounts: dict[str, int] = Field(default_factory=dict)
    # OPS-LLM-COST-01: process-local input/output totals per provider kind
    # (plus "total"). Values come only from provider-reported usage. Missing
    # sides retain the historical numeric 0 contribution; tokenUsageCoverage
    # distinguishes that from a genuine reported zero.
    tokenUsage: dict[str, dict[str, int]] = Field(default_factory=dict)
    tokenUsageCoverage: dict[str, TokenUsageCoverage] = Field(default_factory=dict)
    tokenUsageSource: Literal["provider_reported_only"] = "provider_reported_only"
    tokenUsageAggregationScope: Literal["current_process_by_provider_kind"] = (
        "current_process_by_provider_kind"
    )


class NarrativeIssueReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    kind: Literal["card", "island"]


class NarrativeIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    severity: Literal["info", "warn", "error"]
    message: str = Field(min_length=1)
    references: list[NarrativeIssueReference] | None = None
    # A/B cross-check direction when this issue is an A/B mismatch
    # (sensemaking_technique.md §5). Optional for backward compatibility with older
    # model responses.
    direction: Literal["b_missing_in_a", "a_missing_in_b"] | None = None


class ExternalProposalReference(BaseModel):
    """Explicit identity for a registered external-agent proposal.

    Document identity is deliberately not carried here. Final-judgement routes
    bind this reference to the request document and validate the tuple
    server-side, so proposalId never becomes an implicit document lookup key.
    """

    model_config = ConfigDict(extra="forbid")

    proposalId: str = Field(min_length=1, max_length=128)
    sourceBundleHash: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)


class CheckNarrativeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc: DocumentV1
    narrativeText: str = Field(min_length=1)
    basedOnReadingOrder: list[str] | None = None
    # AI-ROUTE-HELD-LINKAGE-01 R1: optional explicit external proposal identity.
    externalProposalRef: ExternalProposalReference | None = None
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None


class CheckNarrativeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issues: list[NarrativeIssue]
    # A/B cross-check totals per direction (sensemaking_technique.md §5: 報告は件数で).
    counts: NarrativeCheckCounts | None = None


class GenerateNarrativeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc: DocumentV1
    narrativeTitle: str | None = None
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None
    # AI-MODEL-GOVERNANCE-01 (R2): per-operation model override (allowlist-checked).
    model: str | None = Field(default=None, max_length=256)


class GenerateNarrativeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    basedOnReadingOrder: list[str]
    warnings: list[str] | None = None


class SuggestIslandSummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc: DocumentV1
    islandId: str = Field(min_length=1)
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None
    # AI-MODEL-GOVERNANCE-01 (R2): per-operation model override (allowlist-checked).
    model: str | None = Field(default=None, max_length=256)
    # DOGFOOD-34 (壁打ち): user's free-text 違和感 on the current placard.
    # Optional; when present the model regenerates candidates that address it.
    critiqueText: str | None = Field(default=None, max_length=1000)


class _IslandSummaryCandidate(BaseModel):
    """一つの表札候補。接地（代表カード）と凝縮（志）を分離して持つ。

    ADR-0077: 核融合法の凝縮は単発の自動採否ではなく、複数候補の「志」を
    人間が壁打ちで洗練して adopt する。groundingIds（接地・品質ガード）と
    summaryText（凝縮・志）は別概念で、候補ごとに接地が異なり得る。
    """

    model_config = ConfigDict(extra="forbid")

    summaryText: str = Field(min_length=1)
    groundingIds: list[str] = Field(min_length=1, max_length=10)


class SuggestIslandSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidates: list[_IslandSummaryCandidate] = Field(min_length=1, max_length=3)
    warnings: list[str] | None = None


class RelationEdgeText(BaseModel):
    model_config = ConfigDict(extra="forbid")

    edgeId: str = Field(min_length=1)
    type: str = Field(min_length=1)
    from_: str = Field(min_length=1, alias="from")
    to: str = Field(min_length=1)


class RelationCardText(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    text: str = Field(min_length=1)


class SummarizeIslandRelationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc: DocumentV1
    islandAId: str = Field(min_length=1)
    islandBId: str = Field(min_length=1)
    relationType: Literal["related", "negate", "causal", "mutual", "equivalence", "unknown"]
    derived: bool
    groundingCardIds: list[str]
    groundingEdgeIds: list[str]
    edgeTexts: list[RelationEdgeText] | None = None
    cardTexts: list[RelationCardText]
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None


class SummarizeIslandRelationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    groundingCardIds: list[str]
    groundingEdgeIds: list[str]
    warnings: list[str]


class ProposalDiff(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entityType: Literal["island_summary"]
    targetId: str = Field(min_length=1)
    field: Literal["summaryText"]
    before: str | None = None
    after: str = Field(min_length=1)
    groundingIds: list[str] = Field(min_length=1)
    warnings: list[str] | None = None
    # DOGFOOD-34 (Phase 2b): the full placard candidates (1-3) so the UI can
    # offer alternatives. candidates[0] matches after/groundingIds (the primary
    # adopt target). Optional for backward compatibility with older proposals.
    candidates: list[_IslandSummaryCandidate] | None = None


class ProposalEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    proposalId: str = Field(min_length=1)
    type: Literal["island_summary"]
    status: Literal["proposed", "accepted", "rejected", "held"]
    reviewState: Literal["unreviewed"] = "unreviewed"
    sourceBundleHash: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)
    diff: ProposalDiff
    rationale: str = Field(min_length=1)


class ProposeOpposingViewpointRequest(BaseModel):
    """AI-OPPOSE-01 (M4): propose an opposing viewpoint or evidence gap for a
    target card, derived from the doc's contradiction / evidence structure.
    proposal-only -- never auto-applied."""

    model_config = ConfigDict(extra="forbid")

    doc: DocumentV1
    targetCardId: str = Field(min_length=1, max_length=128)
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None
    # AI-MODEL-GOVERNANCE-01 (R2): per-operation model override (allowlist-checked).
    model: str | None = Field(default=None, max_length=256)


class OpposingViewpointProposal(BaseModel):
    """Proposal-only opposing-viewpoint / evidence-gap observation."""

    model_config = ConfigDict(extra="forbid")

    proposalId: str = Field(min_length=1)
    type: Literal["opposing_viewpoint"] = "opposing_viewpoint"
    status: Literal["proposed"] = "proposed"
    reviewState: Literal["unreviewed"] = "unreviewed"
    targetCardId: str = Field(min_length=1)
    opposingText: str = Field(min_length=1)
    evidenceGap: bool
    rationale: str = Field(min_length=1)
    warnings: list[str] = Field(default_factory=list)


class ProposeIslandSummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    doc: DocumentV1
    islandId: str = Field(min_length=1)
    sourceBundleHash: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None
    # AI-MODEL-GOVERNANCE-01 (R2): per-operation model override (allowlist-checked).
    model: str | None = Field(default=None, max_length=256)
    # DOGFOOD-34 (壁打ち): user's free-text 違和感 on the current placard.
    critiqueText: str | None = Field(default=None, max_length=1000)


class ProposalDecisionAuditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    docId: str = Field(min_length=1, max_length=128)
    proposalId: str = Field(min_length=1, max_length=128)
    sourceBundleHash: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)
    idempotencyKey: str = Field(min_length=1, max_length=256)
    decision: Literal["adopt", "reject", "hold"]
    reason: str | None = Field(default=None, max_length=1000)


class ProposalDecisionAuditResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    recorded: Literal[True] = True
    eventId: str = Field(min_length=1)
    proposalId: str = Field(min_length=1)
    status: Literal["accepted", "rejected", "held"]
    reviewState: Literal["unreviewed"] = "unreviewed"
    recordedAt: str = Field(min_length=1)


class ExternalAgentProposalRegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    docId: str = Field(min_length=1, max_length=128)
    taskId: str = Field(min_length=1, max_length=128)
    baseDocSignature: str = Field(min_length=1, max_length=512)
    sourceBundleHash: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)
    queryCanonicalHash: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)
    proposalId: str = Field(min_length=1, max_length=128)
    proposalKind: Literal[
        "island_title",
        "merge_candidate",
        "narrative_draft",
        "opposing_viewpoint",
        "critique",
        "patch",
    ]
    proposalFingerprint: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)
    provenanceLevel: Literal["user_presented_unsigned"]


class ExternalAgentTaskRegistrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    docId: str = Field(min_length=1, max_length=128)
    taskId: str = Field(min_length=1, max_length=128)
    baseDocSignature: str = Field(min_length=1, max_length=512)
    sourceBundleHash: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)
    queryCanonicalHash: str = Field(pattern=SOURCE_BUNDLE_HASH_PATTERN)
    taskKind: Literal[
        "island_titles",
        "merge_candidates",
        "narrative_draft",
        "opposing_viewpoints",
        "critique_suggestions",
        "free_analysis",
    ]
    provenanceLevel: Literal["user_presented_unsigned"]


class ExternalAgentTaskRegistrationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    registered: Literal[True] = True
    taskId: str
    provenanceLevel: Literal["user_presented_unsigned"]


class ExternalAgentProposalRegistrationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    registered: Literal[True] = True
    proposalId: str
    provenanceLevel: Literal["user_presented_unsigned"]


class ExternalAgentProposalDecisionRequest(ProposalDecisionAuditRequest):
    provenanceLevel: Literal["user_presented_unsigned"]


class ProposalStatusItem(BaseModel):
    """One proposal's lifecycle status for a document (read-only)."""

    model_config = ConfigDict(extra="forbid")

    proposalId: str
    proposalKind: str
    origin: Literal["internal", "external_agent"]
    # proposed (no decision yet) | accepted | rejected | held
    status: Literal["proposed", "accepted", "rejected", "held"]
    sourceBundleHash: str
    createdAt: str
    decidedAt: str | None = None


class ProposalStatusResponse(BaseModel):
    """Read-only proposal lifecycle status for a document. Lets a generative-AI
    (via MCP or API) verify that a proposal is still proposal-only or was
    decided by a human -- CE4 traceability without mutating anything."""

    model_config = ConfigDict(extra="forbid")

    docId: str
    proposals: list[ProposalStatusItem]


# ---------------------------------------------------------------------------
# ADR-0064: KJ-method card-level AI operations
# ---------------------------------------------------------------------------


class RefineCardTextRequest(BaseModel):
    """Request to refine/improve the wording of a single KJ-method card."""

    model_config = ConfigDict(extra="forbid")

    cardText: str = Field(min_length=1, max_length=2000)
    context: str | None = Field(default=None, max_length=2000)
    # SEC-AI-SAFEMODE-02: this route has no document context, so the review
    # state travels with the request. textReviewed certifies the caller has
    # human-reviewed the input text; it defaults False (fail-closed) per
    # ADR-0068 D3=A (unspecified = SafeMode ON).
    textReviewed: bool = False
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None
    # AI-MODEL-GOVERNANCE-01 (R2): per-operation model override (allowlist-checked).
    model: str | None = Field(default=None, max_length=256)


class RefineCardTextResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refinedText: str
    reasoning: str | None = None


class SuggestCardGroupsRequest(BaseModel):
    """Request to suggest groupings/islands for a set of KJ-method cards."""

    model_config = ConfigDict(extra="forbid")

    cards: list[_CardRef] = Field(min_length=2, max_length=1000)
    # DOGFOOD-31: real KJ round-1 can produce hundreds of cards (sensemaking_technique.md
    # §1「数百枚は正常」). The previous 100-card cap blocked the first-pass
    # grouping of a 200-card round; align with max_document_cards (10,000).
    # AI-IR-PROJECTION-01 stage 2 (ADR-0069): optional canvas context. When
    # supplied the route builds the LLM input IR (`llm_input_ir_spec.md`) from
    # it, so grouping finally sees the islands the human already confirmed,
    # their `parentIslandId` hierarchy, the relation graph, and each card's
    # `holdState`. Optional on purpose: the flat card-list request shape that
    # shipped before stays valid (AC-11).
    doc: DocumentV1 | None = None
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None
    # AI-MODEL-GOVERNANCE-01 (R2): per-operation model override (allowlist-checked).
    model: str | None = Field(default=None, max_length=256)


class _CardRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=256)
    text: str = Field(min_length=1, max_length=2000)
    # SEC-AI-SAFEMODE-02: no-doc routes take card text directly, so the review
    # state travels with each card. Defaults False (unreviewed, fail-closed) per
    # ADR-0068 D3=A.
    textReviewed: bool = False


class SuggestCardGroupsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    groups: list[_SuggestedGroup]
    # AI-IR-PROJECTION-01 AC-2: request cards withheld from grouping because the
    # human has set them aside (`Card.holdState` in `held` / `pending` /
    # `shelved`, schemas.md §14.1). They are never offered to the model and are
    # stripped from its answer, so a caller would otherwise see them silently
    # vanish -- this field says which ones and why they are missing.
    excludedCardIds: list[str] = []
    # True when the IR hit a §5 limit (`MAX_CARDS` / `MAX_TEXT_CHARS`) and could
    # not carry every requested card. The reported groups then cover only the
    # cards that were projected. Sizing of those limits is AI-IR-PROJECTION-01
    # AC-10, deliberately deferred; surfacing the fact is not.
    truncated: bool = False


class _SuggestedGroup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    cardIds: list[str]
    rationale: str | None = None


class AttentionCandidate(BaseModel):
    """Provider-free cue that redirects attention without changing the document."""

    model_config = ConfigDict(extra="forbid")

    candidateId: str = Field(min_length=1)
    cardIds: list[str] = Field(min_length=2)
    focusPairs: list[tuple[str, str]] = Field(min_length=1)
    basis: Literal["relation", "spatial"]
    cue: Literal["cross_island", "indirect_relation", "unassigned"]


class SuggestAttentionCandidatesRequest(BaseModel):
    """Request deterministic attention cues from the current human-authored structure."""

    model_config = ConfigDict(extra="forbid")

    doc: DocumentV1
    includeSpatial: bool = False
    allowUnreviewedText: bool | None = None


class SuggestAttentionCandidatesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidates: list[AttentionCandidate]
    excludedCardIds: list[str] = Field(default_factory=list)
    truncated: bool = False


class DetectContradictionRequest(BaseModel):
    """Request to detect contradiction between two KJ-method cards."""

    model_config = ConfigDict(extra="forbid")

    cardA: _CardRef
    cardB: _CardRef
    # AI-IR-PROJECTION-01 (ADR-0069): optional canvas context. When supplied the
    # route builds the LLM input IR (`llm_input_ir_spec.md`) from it, so the
    # model finally sees `edges`, `islands`, `evidenceLinks` and
    # `contradictionState` instead of two bare texts. Optional on purpose: the
    # two-card request shape that shipped before stays valid (AC-11).
    doc: DocumentV1 | None = None
    # AI-ROUTE-HELD-LINKAGE-01 R1: linkage requires doc so the server never
    # infers document identity from proposalId.
    externalProposalRef: ExternalProposalReference | None = None
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None


class DetectContradictionResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hasContradiction: bool
    explanation: str | None = None
    # AI-IR-PROJECTION-01 AC-1: true when `doc` already carries a human-decided
    # (`confirmed` / `held`) contradiction between the pair. The endpoint then
    # reports no NEW contradiction -- re-proposing a decision the human already
    # made is exactly what ADR-0069 set out to stop -- and says so here so a
    # caller can tell "nothing found" apart from "already handled".
    alreadyRecorded: bool = False
    existingContradictionState: (
        Literal["unconfirmed", "confirmed", "held", "resolved"] | None
    ) = None


class SuggestDocumentTitleRequest(BaseModel):
    """Request to suggest document titles based on content overview."""

    model_config = ConfigDict(extra="forbid")

    # Island titles and a sample of reviewed card texts to base suggestions on.
    islandTitles: list[str] = Field(min_length=0, max_length=50)
    cardTexts: list[str] = Field(min_length=0, max_length=50)
    currentTitle: str | None = Field(default=None, max_length=500)
    # SEC-AI-SAFEMODE-02: this no-doc route forwards cardTexts to the LLM, so
    # the review state travels with the request. textReviewed certifies the
    # input texts are human-reviewed; defaults False (fail-closed, ADR-0068
    # D3=A).
    textReviewed: bool = False
    # SEC-AI-SAFEMODE-01 (ADR-0068 D1=C/D3=A): optional, fail-closed relaxation.
    allowUnreviewedText: bool | None = None
    # AI-MODEL-GOVERNANCE-01 (R2): per-operation model override (allowlist-checked).
    model: str | None = Field(default=None, max_length=256)


class _DocumentTitleCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=500)


class SuggestDocumentTitleResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    candidates: list[_DocumentTitleCandidate] = Field(min_length=1, max_length=3)
