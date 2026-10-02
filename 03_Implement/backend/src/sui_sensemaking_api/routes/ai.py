import json
import logging
import math
from itertools import combinations
from dataclasses import replace
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sui_sensemaking_api.audit import build_event
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.llm_input_ir import (
    IRGenerationError,
    IRSource,
    SourceCard,
    adjudicated_contradiction,
    build_llm_input_ir,
    derived_island_relations,
    held_card_ids,
    relation_id,
    source_from_document,
)
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tenant_context import TenantContext
from sui_sensemaking_api.llm.provider import (
    LLMRequest,
    ProviderDisabledError,
    ProviderRequestError,
    RegisteredProviderConfig,
    build_audit_fields,
    build_registered_provider,
    generate_with_fallback,
    get_provider,
    registered_provider_available,
    resolve_model_for_task,
)
from sui_sensemaking_api.models_ai import (
    CheckNarrativeRequest,
    CheckNarrativeResponse,
    DetectContradictionRequest,
    DetectContradictionResponse,
    ExternalAgentProposalDecisionRequest,
    ExternalProposalReference,
    ExternalAgentProposalRegistrationRequest,
    ExternalAgentProposalRegistrationResponse,
    ExternalAgentTaskRegistrationRequest,
    ExternalAgentTaskRegistrationResponse,
    GenerateNarrativeRequest,
    GenerateNarrativeResponse,
    OpposingViewpointProposal,
    ProposalDecisionAuditRequest,
    ProposalDecisionAuditResponse,
    ProposalEnvelope,
    ProposeIslandSummaryRequest,
    ProposeOpposingViewpointRequest,
    ProposalStatusItem,
    ProposalStatusResponse,
    ProviderStatusResponse,
    RefineCardTextRequest,
    RefineCardTextResponse,
    SuggestCardGroupsRequest,
    SuggestCardGroupsResponse,
    SuggestAttentionCandidatesRequest,
    SuggestAttentionCandidatesResponse,
    AttentionCandidate,
    SuggestDocumentTitleRequest,
    SuggestDocumentTitleResponse,
    SuggestIslandSummaryRequest,
    SuggestIslandSummaryResponse,
)
from sui_sensemaking_api.models import (
    AIProposalDecisionStateRow,
    AIProposalRow,
    Card,
    MergeSuggestion,
    SuggestLayoutRequest,
    SuggestLayoutResponse,
    SuggestMergesRequest,
    SuggestMergesResponse,
    Transform,
)
from sui_sensemaking_api.proposal_decision_repository import (
    ProposalDecisionConflict,
    ProposalNotRegistered,
    register_ai_proposal,
    register_external_agent_proposal,
    register_external_agent_task,
    hold_external_proposal_for_final_judgement_failure,
    record_proposal_decision as persist_proposal_decision,
    validate_external_proposal_reference,
)
from sui_sensemaking_api.island_summary_ir import (
    build_island_summary_ir_context,
    island_summary_ir_prompt_lines,
)
from sui_sensemaking_api.opposing_viewpoint_ir import (
    OpposingViewpointIRContext,
    build_opposing_viewpoint_ir_context,
    opposing_viewpoint_ir_prompt_lines,
)
from sui_sensemaking_api.merge_suggestion_ir import (
    MergeSuggestionIRContext,
    build_merge_suggestion_ir_context,
)
from sui_sensemaking_api.routes.docs import _authorize_request, get_document_row
from sui_sensemaking_api.tenant_session_precondition import (
    require_tenant_scoped_api_precondition,
)

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger(__name__)


def _external_proposal_audit_fields(
    ref: ExternalProposalReference | None,
) -> dict[str, str]:
    """Return content-free proposal linkage fields for MMR-05 audit events."""
    if ref is None:
        return {}
    return {
        "proposalId": ref.proposalId,
        "sourceBundleHash": ref.sourceBundleHash,
    }


def _audit_llm_trace(
    request: Request,
    tenant: TenantContext,
    doc_id: str,
    task: str,
    llm_response,
    *,
    external_proposal_ref: ExternalProposalReference | None = None,
) -> None:
    """SEC-LLM-AUDIT-01: LLM calls are the most audit-worthy events but only
    reached the local logger. Emit them through the audit dispatcher so
    SUI_AUDIT_TRANSPORT=http configurations receive them. CE2-C5 /
    enterprise_architecture §04.6 fields only -- never prompt or card text."""
    from sui_sensemaking_api.llm.provider import routing_stage_for_task

    metadata = {
        "task": task,
        "routingStage": routing_stage_for_task(task),
        **build_audit_fields(llm_response),
        **_external_proposal_audit_fields(external_proposal_ref),
    }

    logger.info("llm_generate", extra=metadata)

    dispatcher = getattr(request.app.state, "audit_dispatcher", None)
    if dispatcher is not None:
        dispatcher.emit(
            build_event(
                event_type="llm",
                tenant_id=tenant.tenant_id,
                doc_id=doc_id,
                safe_mode=False,  # LLM calls send content regardless of SafeMode (SEC-AI-SAFEMODE-01).
                metadata=metadata,
            )
        )


def _resolve_audit_tenant(request: Request, db: Session) -> TenantContext:
    """SEC-LLM-AUDIT-01: resolve the tenant for audit events without the full
    resource/access control (the LLM routes process payload docs that need not
    be persisted). Mirrors docs.py `_authorize_request`'s tenant resolution."""
    from sui_sensemaking_api.auth_context import resolve_identity_context
    from sui_sensemaking_api.saas_request_context import resolve_trusted_saas_request_session
    from sui_sensemaking_api.tenant_context import SingleTenantContextResolver, TenantContextResolver
    from sui_sensemaking_api.tenant_session_precondition import (
        require_tenant_session_request_precondition,
        tenant_session_precondition_required,
    )

    if tenant_session_precondition_required(request):
        trusted_session = resolve_trusted_saas_request_session(request=request, db=db)
        require_tenant_session_request_precondition(
            request=request,
            current_version=trusted_session.session.tenant_session_version,
        )
        return trusted_session.tenant
    identity = resolve_identity_context(db=db, request=request)
    resolver: TenantContextResolver = getattr(
        request.app.state,
        "tenant_context_resolver",
        SingleTenantContextResolver(),
    )
    return resolver.resolve(
        db=db,
        user_id=identity.user_id,
        claim=identity.verified_tenant_claim,
    )


def _validate_final_judgement_external_proposal(
    ref: ExternalProposalReference | None,
    *,
    doc_id: str,
    request: Request,
    db: Session,
) -> None:
    """Reject an invalid explicit proposal link before provider execution."""
    if ref is None:
        return
    tenant = _resolve_audit_tenant(request, db)
    try:
        validate_external_proposal_reference(
            db,
            tenant=tenant,
            doc_id=doc_id,
            proposal_id=ref.proposalId,
            source_bundle_hash=ref.sourceBundleHash,
        )
    except ProposalNotRegistered as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProposalDecisionConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


_FINAL_JUDGEMENT_SYSTEM_HOLD_FAILURES = frozenset({
    "provider_unavailable",
    "provider_timeout",
})


def _final_judgement_system_hold_failure_code(
    exc: ProviderDisabledError | ProviderRequestError,
) -> str | None:
    if isinstance(exc, ProviderDisabledError):
        return "provider_unavailable"
    if exc.code in _FINAL_JUDGEMENT_SYSTEM_HOLD_FAILURES:
        return exc.code
    return None


def _hold_linked_external_proposal_after_final_judgement_failure(
    ref: ExternalProposalReference | None,
    *,
    doc_id: str,
    request: Request,
    db: Session,
    exc: ProviderDisabledError | ProviderRequestError,
) -> None:
    """Persist proposed->held before returning an availability failure.

    The route has already validated the explicit linkage before provider use.
    This helper re-validates inside the state transition transaction, retries a
    first-state insert race once, and emits a content-free system audit event
    only when this call actually changed proposed -> held.
    """
    failure_code = _final_judgement_system_hold_failure_code(exc)
    if ref is None or failure_code is None:
        return

    tenant = _resolve_audit_tenant(request, db)

    def _persist():
        return hold_external_proposal_for_final_judgement_failure(
            db,
            tenant=tenant,
            doc_id=doc_id,
            proposal_id=ref.proposalId,
            source_bundle_hash=ref.sourceBundleHash,
        )

    try:
        receipt = _persist()
        db.commit()
    except IntegrityError:
        db.rollback()
        try:
            receipt = _persist()
            db.commit()
        except ProposalNotRegistered as retry_exc:
            db.rollback()
            raise HTTPException(status_code=404, detail=str(retry_exc)) from retry_exc
        except (IntegrityError, ProposalDecisionConflict) as retry_exc:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "proposal_system_hold_conflicted",
                    "message": "Proposal state changed while recording final-judgement hold.",
                },
            ) from retry_exc
    except ProposalNotRegistered as hold_exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(hold_exc)) from hold_exc
    except ProposalDecisionConflict as hold_exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(hold_exc)) from hold_exc

    if not receipt.transitioned:
        return

    metadata = build_audit_fields(exc)
    metadata.update(
        {
            "proposalId": ref.proposalId,
            "sourceBundleHash": ref.sourceBundleHash,
            "previousStatus": "proposed",
            "newStatus": "held",
            "transitionSource": "final_judgement_unavailable",
            "routingStage": "final_judgement",
            "failureCode": failure_code,
        }
    )
    logger.warning(
        "proposal_system_held",
        extra={
            "proposalId": ref.proposalId,
            "failureCode": failure_code,
            "traceId": metadata.get("trace_id"),
        },
    )
    dispatcher = getattr(request.app.state, "audit_dispatcher", None)
    if dispatcher is not None:
        dispatcher.emit(
            build_event(
                event_type="proposal",
                tenant_id=tenant.tenant_id,
                doc_id=doc_id,
                safe_mode=False,
                metadata=metadata,
            )
        )



_FINAL_JUDGEMENT_GOVERNANCE_FAILURE_CODES = {
    "model_not_allowed": "policy_rejected",
    "model_not_registered": "provider_unavailable",
    "model_provider_unavailable": "provider_unavailable",
}


def _final_judgement_governance_failure_code(
    exc: HTTPException,
) -> tuple[str, str] | None:
    """Map only the narrow model-governance failures admitted by R3.

    The HTTP response keeps its existing, specific governance code. Proposal
    audit uses the stable externalization reason vocabulary so policy rejection
    and execution unavailability remain distinguishable without treating an
    arbitrary 4xx/5xx as a system hold.
    """
    detail = exc.detail
    governance_code = detail.get("code") if isinstance(detail, dict) else None
    if not isinstance(governance_code, str):
        return None
    failure_code = _FINAL_JUDGEMENT_GOVERNANCE_FAILURE_CODES.get(governance_code)
    if failure_code is None:
        return None
    return failure_code, governance_code


def _hold_linked_external_proposal_after_final_judgement_governance_failure(
    ref: ExternalProposalReference | None,
    *,
    doc_id: str,
    request: Request,
    db: Session,
    exc: HTTPException,
    model_id: str,
) -> None:
    """Record R3 pre-provider governance/routing failure as a system hold.

    State transition remains explicit-link-only. Because provider dispatch has
    not happened yet, audit records the selected model and governance code but
    deliberately does not fabricate provider or trace metadata.
    """
    mapped = _final_judgement_governance_failure_code(exc)
    if ref is None or mapped is None:
        return
    failure_code, governance_code = mapped
    tenant = _resolve_audit_tenant(request, db)

    def _persist():
        return hold_external_proposal_for_final_judgement_failure(
            db,
            tenant=tenant,
            doc_id=doc_id,
            proposal_id=ref.proposalId,
            source_bundle_hash=ref.sourceBundleHash,
        )

    try:
        receipt = _persist()
        db.commit()
    except IntegrityError:
        db.rollback()
        try:
            receipt = _persist()
            db.commit()
        except ProposalNotRegistered as retry_exc:
            db.rollback()
            raise HTTPException(status_code=404, detail=str(retry_exc)) from retry_exc
        except (IntegrityError, ProposalDecisionConflict) as retry_exc:
            db.rollback()
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "proposal_system_hold_conflicted",
                    "message": "Proposal state changed while recording final-judgement hold.",
                },
            ) from retry_exc
    except ProposalNotRegistered as hold_exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(hold_exc)) from hold_exc
    except ProposalDecisionConflict as hold_exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(hold_exc)) from hold_exc

    if not receipt.transitioned:
        return

    metadata = {
        **_external_proposal_audit_fields(ref),
        "previousStatus": "proposed",
        "newStatus": "held",
        "transitionSource": "final_judgement_governance_blocked",
        "routingStage": "final_judgement",
        "failureCode": failure_code,
        "governanceCode": governance_code,
        "requestedModelId": model_id,
    }
    logger.warning(
        "proposal_system_held",
        extra={
            "proposalId": ref.proposalId,
            "failureCode": failure_code,
            "governanceCode": governance_code,
        },
    )
    dispatcher = getattr(request.app.state, "audit_dispatcher", None)
    if dispatcher is not None:
        dispatcher.emit(
            build_event(
                event_type="proposal",
                tenant_id=tenant.tenant_id,
                doc_id=doc_id,
                safe_mode=False,
                metadata=metadata,
            )
        )


def _assert_model_allowed(
    request: Request,
    db: Session,
    model_id: str,
) -> RegisteredProviderConfig | None:
    """AI-MODEL-GOVERNANCE-01 R3 + AI-MODEL-GOVERNANCE-02: enforce the tenant
    model allowlist AND that the model is an active registered model.

    - A non-empty allowlist is fail-closed: a requested/resolved model outside
      it is rejected with 403 model_not_allowed before any LLM call.
    - Empty allowlist = platform-default: "all active registered models allowed".
      AI-MODEL-GOVERNANCE-02 closes the gap where the platform-default was a
      no-op, letting unregistered / disabled model ids reach the LLM provider.
      An id that is not an active registered model (active provider included)
      is rejected with 403 model_not_registered."""
    from sui_sensemaking_api.model_registry_repository import (
        list_models,
        list_providers,
        tenant_allowlist_effective_model_ids,
    )

    tenant = _resolve_audit_tenant(request, db)
    effective = tenant_allowlist_effective_model_ids(db, tenant_id=tenant.tenant_id)
    if effective is not None and model_id not in effective:
        # R4: a model_not_allowed violation is a governance-relevant event --
        # structured-log it (with the request id already attached by the logging
        # substrate) so an operator can investigate repeated denials per tenant.
        logger.warning(
            "model_not_allowed",
            extra={
                "tenantId": tenant.tenant_id,
                "modelId": model_id,
                "allowedModels": ",".join(sorted(effective)),
            },
        )
        raise HTTPException(
            status_code=403,
            detail={
                "code": "model_not_allowed",
                "message": f"Model '{model_id}' is not in the tenant's allowed model set.",
                "allowedModels": sorted(effective),
            },
        )

    # AI-MODEL-GOVERNANCE-02: the registry is the source of truth for what is
    # callable. Even under platform-default (empty allowlist), a model id that
    # is not an active registered model (active provider included) must fail
    # closed before any LLM call. Distinguishes "tenant-restricted" (above)
    # from "does not exist / disabled" (here) for operator triage.
    active_providers = [row for row in list_providers(db) if row.lifecycle_state == "active"]
    active_provider_ids = {row.id for row in active_providers}
    providers_by_id = {row.id: row for row in active_providers}
    models_by_id = {row.id: row for row in list_models(db)}
    active_registered_ids = {
        row.id
        for row in models_by_id.values()
        if row.lifecycle_state == "active" and row.provider_id in active_provider_ids
    }
    if model_id not in active_registered_ids:
        logger.warning(
            "model_not_registered",
            extra={
                "tenantId": tenant.tenant_id,
                "modelId": model_id,
            },
        )
        raise HTTPException(
            status_code=403,
            detail={
                "code": "model_not_registered",
                "message": f"Model '{model_id}' is not an active registered model.",
            },
        )

    model = models_by_id[model_id]
    provider_row = providers_by_id[model.provider_id]
    config = RegisteredProviderConfig(
        provider_id=provider_row.id,
        provider_kind=provider_row.provider_kind,
        base_url=provider_row.base_url,
        api_key_ref=provider_row.api_key_ref,
        model_id=model.id,
    )
    try:
        build_registered_provider(config)
        return config
    except ProviderRequestError:
        logger.warning(
            "model_provider_unavailable",
            extra={
                "tenantId": tenant.tenant_id,
                "modelId": model_id,
                "providerId": model.provider_id,
                "registeredProviderKind": provider_row.provider_kind,
            },
        )
        raise HTTPException(
            status_code=503,
            detail={
                "code": "model_provider_unavailable",
                "message": "The model's registered provider is not available in this runtime.",
            },
        ) from None


def _reject_unreviewed_text(document, allow_unreviewed_text: bool | None) -> None:
    """SEC-AI-SAFEMODE-01 (ADR-0068 D2=B): reject a document with unreviewed
    card text unless the caller explicitly requests relaxation AND the profile
    permits it. None (unspecified) is fail-closed — the request is rejected."""
    if allow_unreviewed_text is True and settings.allow_unreviewed_ai_text:
        return
    if any(card.textReviewed is not True for card in document.cards):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unreviewed_text_not_allowed",
                "message": "Document contains unreviewed card text, which cannot be sent to the LLM under SafeMode.",
            },
        )


def _reject_unreviewed_cards(cards, allow_unreviewed_text: bool | None) -> None:
    """SEC-AI-SAFEMODE-02: the no-document AI routes take card text directly, so
    the review state travels with the request (`textReviewed`). Reject any card
    whose text is not certified reviewed unless the caller explicitly requests
    relaxation AND the profile permits it. Defaults False (fail-closed), so an
    unspecified `textReviewed` is treated as unreviewed — the request is
    rejected — matching ADR-0068 D3=A (unspecified = SafeMode ON)."""
    if allow_unreviewed_text is True and settings.allow_unreviewed_ai_text:
        return
    if any(getattr(card, "textReviewed", False) is not True for card in cards):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "unreviewed_text_not_allowed",
                "message": "Request contains unreviewed card text, which cannot be sent to the LLM under SafeMode.",
            },
        )


def _raise_llm_http_error(exc: ProviderDisabledError | ProviderRequestError) -> None:
    if isinstance(exc, ProviderDisabledError):
        raise HTTPException(status_code=503, detail=exc.to_contract()) from exc

    status_map = {
        "provider_timeout": 504,
        "provider_validation": 422,
        "provider_unavailable": 503,
    }
    raise HTTPException(
        status_code=status_map.get(exc.code, 503), detail=exc.to_contract()
    ) from exc


def _resolve_reading_order(payload: CheckNarrativeRequest) -> list[str]:
    if payload.basedOnReadingOrder is not None:
        return payload.basedOnReadingOrder
    if payload.doc.readingOrder is not None:
        return payload.doc.readingOrder
    return []


def _validate_check_narrative_input(payload: CheckNarrativeRequest) -> None:
    if payload.narrativeText.strip() == "":
        raise HTTPException(status_code=422, detail="narrativeText must not be empty")

    if payload.basedOnReadingOrder is None:
        return

    known_ids = {card.id for card in payload.doc.cards} | {
        island.id for island in payload.doc.islands
    }
    unknown_ids = [item_id for item_id in payload.basedOnReadingOrder if item_id not in known_ids]
    if unknown_ids:
        raise HTTPException(status_code=422, detail="basedOnReadingOrder included unknown id")


def _build_narrative_check_prompt(payload: CheckNarrativeRequest) -> str:
    cards_by_id = {card.id: card for card in payload.doc.cards}
    islands_by_id = {island.id: island for island in payload.doc.islands}

    reading_order = _resolve_reading_order(payload)
    reading_order_lines: list[str] = []
    for index, item_id in enumerate(reading_order, start=1):
        if item_id in islands_by_id:
            island = islands_by_id[item_id]
            reading_order_lines.append(
                f'- {index}. island id="{island.id}", title={json.dumps(island.title or "")}, cardIds={json.dumps(island.cardIds)}'
            )
        elif item_id in cards_by_id:
            card = cards_by_id[item_id]
            reading_order_lines.append(
                f'- {index}. card id="{card.id}", text={json.dumps(card.text)}'
            )
        else:
            reading_order_lines.append(f'- {index}. unknown id="{item_id}"')

    island_lines: list[str] = []
    for island in payload.doc.islands:
        island_cards = [
            cards_by_id[card_id] for card_id in island.cardIds if card_id in cards_by_id
        ]
        card_texts = [card.text for card in island_cards]
        island_lines.append(
            f'- id="{island.id}", title={json.dumps(island.title or "")}, cardIds={json.dumps(island.cardIds)}, cardTexts={json.dumps(card_texts)}'
        )

    card_lines = [f'- id="{card.id}", text={json.dumps(card.text)}' for card in payload.doc.cards]

    # AI-IR-CHECK-NARRATIVE-RELATIONS-01: the A-side diagram's explicit
    # causal/negate/mutual/equivalence/related edges are route-required
    # meaning for the A/B cross-check -- without them the model cannot tell
    # whether the narrative invents a logical connection (causal, negate, ...)
    # that the diagram never drew (sensemaking_technique.md §6 SUI-SIGN-09). Legacy
    # documents may omit fromKind/toKind; the existing domain contract treats
    # an unspecified endpoint kind as a card, so the prompt resolves that
    # ambiguity here rather than passing it through to the model.
    relation_lines = [
        (
            f'- id="{edge.id}", type="{edge.type}", '
            f'fromKind="{edge.fromKind or "card"}", fromId="{edge.fromId}", '
            f'toKind="{edge.toKind or "card"}", toId="{edge.toId}"'
        )
        for edge in payload.doc.edges
    ]

    return "\n".join(
        [
            "You are performing a best-effort narrative consistency check against a diagram.",
            "Output is advisory only. Never claim certainty or correctness.",
            "Return strict JSON only. No markdown. No text outside JSON.",
            "Identify missing key islands/cards based on reading order.",
            "Identify contradictions such as reading-order mismatch or narrative claims not supported by any card text.",
            "Identify ambiguous transitions, e.g. pronouns like it/they/this/that without a clear referent.",
            # sensemaking_technique.md §5: the A/B cross-check must run in BOTH directions,
            # and the report must carry per-direction counts (報告は件数で).
            "Perform the A/B cross-check in both directions (sensemaking_technique.md §5):",
            '  - direction "b_missing_in_a": narrative claims that have no counterpart in the diagram (either remove the claim or add it to the diagram).',
            '  - direction "a_missing_in_b": diagram islands that the narrative never mentions (ask why they cannot be told).',
            "Use the Relations section as the diagram's relation graph: flag any explicit logical connection "
            "(causal, negate, mutual, equivalence, etc.) the narrative asserts between two elements but the "
            "relation graph never draws, as a b_missing_in_a issue.",
            'Every A/B mismatch issue must set its "direction" to one of the two values.',
            'Report "counts" with the number of issues per direction (0 is a valid value; a 0/0 means the cross-check did not actually run).',
            'If there are no issues at all, return {"issues":[],"counts":{"bMissingInA":0,"aMissingInB":0}}.',
            "Use this exact schema:",
            '{"issues":[{"severity":"info|warn|error","message":string,"references":[{"id":string,"kind":"card|island"}]?,"direction":"b_missing_in_a|a_missing_in_b"?}],"counts":{"bMissingInA":number,"aMissingInB":number}?}',
            "Only include references that exist in the input diagram.",
            "Narrative text:",
            payload.narrativeText,
            "Reading order:",
            *reading_order_lines,
            "Islands:",
            *island_lines,
            "Cards:",
            *card_lines,
            "Relations:",
            *relation_lines,
        ]
    )


def _parse_narrative_check_response(
    raw_text: str, source_doc: CheckNarrativeRequest
) -> CheckNarrativeResponse:
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="LLM response is not valid JSON") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="LLM response must be a JSON object")

    try:
        response = CheckNarrativeResponse.model_validate(parsed)
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail="Invalid narrative check response payload"
        ) from exc

    known_card_ids = {card.id for card in source_doc.doc.cards}
    known_island_ids = {island.id for island in source_doc.doc.islands}

    for issue in response.issues:
        if not issue.references:
            continue
        for reference in issue.references:
            if reference.kind == "card" and reference.id not in known_card_ids:
                raise HTTPException(
                    status_code=422, detail="LLM response included unknown card reference"
                )
            if reference.kind == "island" and reference.id not in known_island_ids:
                raise HTTPException(
                    status_code=422, detail="LLM response included unknown island reference"
                )

    return response


def _build_island_summary_prompt(payload: SuggestIslandSummaryRequest, ir_context=None) -> str:
    cards_by_id = {card.id: card for card in payload.doc.cards}
    island = next((item for item in payload.doc.islands if item.id == payload.islandId), None)
    if island is None:
        raise HTTPException(status_code=422, detail="islandId does not exist")

    member_cards = [cards_by_id[card_id] for card_id in island.cardIds if card_id in cards_by_id]
    if len(member_cards) == 0:
        raise HTTPException(status_code=422, detail="island has no member cards")

    if ir_context is None:
        card_texts_by_id = {card.id: card.text for card in member_cards}
    else:
        member_ids = {card.id for card in member_cards}
        card_texts_by_id = {
            item["id"]: item["text"]
            for item in ir_context.ir.get("cards", [])
            if item["id"] in member_ids
        }
        if set(card_texts_by_id) != member_ids:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "required_card_context_mismatch",
                    "message": "Task-required card context did not fit in the IR projection",
                },
            )
    card_lines = [
        f'- id="{card.id}", text={json.dumps(card_texts_by_id[card.id])}'
        for card in member_cards
    ]

    # 戻し検査 (sensemaking_technique.md §3, 優先3-3): cards that OBJECTED to the previous
    # placard carry critiqueTags not_the_same / feels_off (recorded via the UI's
    # card critique-tag controls). The re-suggestion must address each objection.
    objecting_cards = [
        card
        for card in member_cards
        if card.critiqueTags
        and any(tag in card.critiqueTags for tag in ("not_the_same", "feels_off"))
    ]

    lines = [
        "You write the placard (表札) for this island as a draft island summary.",
        "Use only the direct member cards provided below. Ignore nested islands for this MVP.",
        "Do not add facts beyond the card texts.",
        # ai_sensemaking_execution_procedures.md §3: the summaryText is advocacy for the
        # island (代弁), not a classification name; never a noun-phrase stop.
        "summaryText must be a predicate-bearing advocacy sentence (述語を伴う代弁文), never a classification name (分類名) or noun-phrase stop (名詞止め).",
        # 表札検査: transposition check + return check (sensemaking_technique.md §3).
        "Perform the placard checks before answering:",
        "  1. Transposition: if you placed this placard on a DIFFERENT island, would it still hold? If yes, it is a classification name — fail and rewrite.",
        "  2. Return check: read the placard back to each member card — 'is this what you meant to say?'. If even one card says 'no', rewrite.",
    ]
    if objecting_cards:
        objecting_lines = [f'    - id="{card.id}", text={json.dumps(card.text)}' for card in objecting_cards]
        lines.extend(
            [
                "The following member cards OBJECTED to the previous placard (戻し検査):",
                *objecting_lines,
                "The new placard must address why each objecting card disagrees, or the summary is not a true advocacy for the island.",
            ]
        )
    # DOGFOOD-34 (壁打ち): a free-text human 違和感 extends the return check —
    # the regenerated candidates must ADDRESS the objection, not ignore it.
    if payload.critiqueText:
        lines.extend(
            [
                "The user raised this objection (違和感) to the current placard:",
                f"    {payload.critiqueText}",
                "Regenerate the candidates so each one ADDRESSES this objection. Do not repeat the placard the user objected to.",
            ]
        )
    # ADR-0069: the placard should reflect the island's position in the logical
    # structure — its typed relations to OTHER islands (causal / negation / ...).
    island_relations: list[str] = []
    for edge in payload.doc.edges:
        if edge.fromKind != "island" or edge.toKind != "island":
            continue
        if edge.fromId == island.id:
            island_relations.append(f'this island --{edge.type}--> island "{edge.toId}"')
        elif edge.toId == island.id:
            island_relations.append(f'island "{edge.fromId}" --{edge.type}--> this island')
    lines.extend(
        [
            "If evidence is weak, sparse, or contradictory, include warnings.",
            "Return strict JSON only. No markdown. No extra text.",
            "Use this exact schema:",
            '{"candidates":[{"summaryText":string,"groundingIds":[string,...]},...],"warnings":[string,...]?}',
            "Produce 1-3 distinct placard candidates. Each candidate is a DIFFERENT advocacy (志) for the island, not a paraphrase of the others.",
            "Each candidate's groundingIds must contain 1-10 unique card ids chosen from the input cards.",
            "Prefer the strongest supporting card ids for each candidate.",
            "The first candidate is the primary advocacy and must reflect the island's strongest shared appeal.",
            f'Island id="{island.id}", title={json.dumps(island.title or "")}',
            "Relations to other islands (the placard may reflect them):",
            *(island_relations or ["- (none)"]),
            "Member cards:",
            *card_lines,
        ]
    )
    return "\n".join(lines)


def _parse_island_summary_response(
    raw_text: str,
    source_doc: SuggestIslandSummaryRequest,
) -> SuggestIslandSummaryResponse:
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="LLM response is not valid JSON") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="LLM response must be a JSON object")

    try:
        response = SuggestIslandSummaryResponse.model_validate(parsed)
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail="Invalid island summary response payload"
        ) from exc

    target_island = next(
        (item for item in source_doc.doc.islands if item.id == source_doc.islandId), None
    )
    if target_island is None:
        raise HTTPException(status_code=422, detail="islandId does not exist")

    member_card_ids = set(target_island.cardIds)

    # ADR-0077: 接地（representative cards≤10）と凝縮（志）は候補単位で分離。
    # 品質ガード（≤10・重複なし・メンバー限定）は候補ごとに強制する。
    for candidate in response.candidates:
        grounding_ids = candidate.groundingIds

        if len(grounding_ids) > 10:
            raise HTTPException(
                status_code=422, detail="LLM response groundingIds must contain at most 10 ids"
            )
        if len(set(grounding_ids)) != len(grounding_ids):
            raise HTTPException(
                status_code=422, detail="LLM response groundingIds must not contain duplicates"
            )

        for card_id in grounding_ids:
            if card_id not in member_card_ids:
                raise HTTPException(
                    status_code=422, detail="LLM response groundingIds included non-member card id"
                )

    return response


def _narrative_required_card_ids(source: IRSource) -> tuple[str, ...]:
    """Card endpoints that form the narrative's causal/oppositional spine.

    `AI-IR-PROJECTION-01` AC-3 makes card-to-card `causal` and `negate`
    relations route-required meaning for narrative generation.  At scale their
    endpoints must therefore be reserved before the global card cut.  This
    helper mirrors the IR's §2.3 exclusion boundary: island endpoints and
    dangling card references do not become required merely because the source
    edge uses a spine relation type.
    """
    card_ids = {card.id for card in source.cards}
    required: set[str] = set()
    for relation in source.relations:
        if relation.type not in ("causal", "negate"):
            continue
        if relation.from_kind == "island" or relation.to_kind == "island":
            continue
        if relation.from_id not in card_ids or relation.to_id not in card_ids:
            continue
        required.add(relation.from_id)
        required.add(relation.to_id)
    return tuple(sorted(required))


def _narrative_required_relation_ids(source: IRSource) -> tuple[str, ...]:
    """Normalized causal/oppositional relations required by narrative generation."""
    card_ids = {card.id for card in source.cards}
    required: set[str] = set()
    for relation in source.relations:
        if relation.type not in ("causal", "negate"):
            continue
        if relation.from_kind == "island" or relation.to_kind == "island":
            continue
        if relation.from_id not in card_ids or relation.to_id not in card_ids:
            continue
        required.add(relation_id(relation.type, relation.from_id, relation.to_id))
    return tuple(sorted(required))


def _generate_narrative_ir(payload: GenerateNarrativeRequest) -> dict:
    """Build the LLM input IR for `/ai/generate-narrative` (ADR-0069 D4=A).

    Stage 3 of the `AI-IR-PROJECTION-01` rollout (AC-3). `doc` is required by
    this contract, so the IR is always projected from the whole document. What
    it adds is the part the narrative was missing: the typed CARD-TO-CARD
    relations. Before this change the prompt carried the reading order, the
    island-to-island edges and the evidence links -- but never a `causal` or
    `negate` edge between two cards, which is the skeleton a B型 narrative is
    supposed to follow.

    At representative scale, normalized `causal` / `negate` relations and their
    card endpoints are route-required meaning. Reserve the relations before
    `MAX_RELATIONS` selection and their endpoints before `MAX_CARDS` selection so the
    reading order cannot survive while its logical joints silently disappear. If either
    required set itself exceeds its shared IR budget, fail closed rather than sending an
    incomplete spine to the model.

    SafeMode: the caller has ALREADY run `_reject_unreviewed_text`. The
    `allow_unreviewed_text` argument reproduces that helper's own predicate so
    the builder's independent check (llm_input_ir_spec.md §7.1) agrees with it
    rather than contradicting it. Both layers run; neither replaces the other.
    """
    allow_unreviewed = bool(
        payload.allowUnreviewedText is True and settings.allow_unreviewed_ai_text
    )
    source = source_from_document(payload.doc)
    required_spine_ids = _narrative_required_card_ids(source)
    required_spine_relation_ids = _narrative_required_relation_ids(source)
    try:
        # spec §2.2.1: generate-narrative does not request coordinates
        # (ADR-0069 D1=B) -- the narrative's spine is causal/negate, not layout.
        return build_llm_input_ir(
            source,
            include_coordinates=False,
            safe_mode=True,
            allow_unreviewed_text=allow_unreviewed,
            required_card_ids=required_spine_ids,
            required_relation_ids=required_spine_relation_ids,
        )
    except IRGenerationError as exc:
        raise HTTPException(status_code=422, detail=exc.to_contract()) from exc


def _reading_order_slots(payload: GenerateNarrativeRequest) -> dict[str, int]:
    """Map every card onto its 1-based position in the reading order.

    An island entry lends its position to each of its member cards, so a
    relation between two cards can be placed on the narrative's spine even when
    the reading order names islands rather than cards. First match wins, which
    matches the card->island uniqueness rule the IR itself uses (spec §2.2A).
    """
    islands_by_id = {island.id: island for island in payload.doc.islands}
    slots: dict[str, int] = {}
    for index, entry_id in enumerate(payload.doc.readingOrder or [], start=1):
        island = islands_by_id.get(entry_id)
        member_ids = list(island.cardIds) if island is not None else [entry_id]
        for card_id in member_ids:
            slots.setdefault(card_id, index)
    return slots


def _narrative_relation_lines(
    payload: GenerateNarrativeRequest, ir: dict | None
) -> list[str]:
    """The typed logical structure the narrative must follow.

    Card-to-card relations and evidence links are read from the IR (ADR-0069:
    the IR is the input of record). Island-to-island edges are NOT in the IR --
    spec §2.3 rule 6 excludes them on purpose, because a derived island edge is
    Stage 4's `getDerivedIslandEdges()` subject -- so they keep being read off
    the document exactly as they were before this change.
    """
    lines: list[str] = []
    for edge in payload.doc.edges:
        if edge.fromKind == "island" and edge.toKind == "island":
            lines.append(
                f'island "{edge.fromId}" --{edge.type}--> island "{edge.toId}"'
            )

    if ir is None:
        for link in payload.doc.evidenceLinks or []:
            lines.append(
                f'card "{link.fromCardId}" --evidence:{link.type}--> card "{link.toCardId}"'
            )
        return lines

    # AC-3: the five-value relation vocabulary (ADR-0048 D3 / ADR-0069 D2=A)
    # reaches the model as itself. `causal` and `negate` are NOT folded into a
    # generic "related" bucket -- they are the two the narrative reasons with.
    for relation in ir.get("relations", []):
        lines.append(
            f'card "{relation["from"]}" --{relation["type"]}--> card "{relation["to"]}"'
        )
    for link in ir.get("evidence_links", []):
        state = link.get("contradiction_state")
        suffix = f" (contradictionState={state})" if state else ""
        lines.append(
            f'card "{link["from_card_id"]}" --evidence:{link["type"]}--> '
            f'card "{link["to_card_id"]}"{suffix}'
        )
    return lines


def _narrative_spine_lines(
    payload: GenerateNarrativeRequest, ir: dict
) -> list[str]:
    """Place each causal / negation edge on the reading order (AC-3).

    The reading order is the narrative's spine; these are its joints. Saying
    only "c1 --causal--> c2" leaves the model to rediscover where in the
    sequence that pull happens, which is the work the projection exists to do.
    """
    slots = _reading_order_slots(payload)
    lines: list[str] = []
    for relation in ir.get("relations", []):
        if relation["type"] not in ("causal", "negate"):
            continue
        from_slot = slots.get(relation["from"])
        to_slot = slots.get(relation["to"])
        if from_slot is not None and to_slot is not None:
            where = (
                f"within reading-order {from_slot}"
                if from_slot == to_slot
                else f"reading-order {from_slot} -> reading-order {to_slot}"
            )
        elif from_slot is None and to_slot is None:
            where = "outside the reading order"
        else:
            known = from_slot if from_slot is not None else to_slot
            where = f"reading-order {known} <-> outside the reading order"
        lines.append(
            f'- {where}: card "{relation["from"]}" --{relation["type"]}--> '
            f'card "{relation["to"]}"'
        )
    return lines


def _build_generate_narrative_prompt(
    payload: GenerateNarrativeRequest, ir: dict | None = None
) -> str:
    """Render the prompt from the IR (ADR-0069: the IR is the input of record).

    `ir=None` keeps the function callable on its own; the route always passes
    the IR it built. The reading-order lines stay document-derived in both
    cases: the reading order is not a field of the IR (spec §4 is a closed
    schema and defines no `reading_order`), and its line format is a de-facto
    contract with `deploy/tools/mock_local_llm.py`'s prompt parser.
    """
    cards_by_id = {card.id: card for card in payload.doc.cards}
    islands_by_id = {island.id: island for island in payload.doc.islands}
    reading_order = payload.doc.readingOrder or []

    reading_order_lines: list[str] = []
    for index, entry_id in enumerate(reading_order, start=1):
        if entry_id in islands_by_id:
            island = islands_by_id[entry_id]
            island_card_texts = [
                cards_by_id[card_id].text for card_id in island.cardIds if card_id in cards_by_id
            ]
            reading_order_lines.append(
                f'- {index}. island id="{island.id}", title={json.dumps(island.title or "")}, cardIds={json.dumps(island.cardIds)}, cardTexts={json.dumps(island_card_texts)}'
            )
        elif entry_id in cards_by_id:
            card = cards_by_id[entry_id]
            reading_order_lines.append(
                f'- {index}. card id="{card.id}", text={json.dumps(card.text)}'
            )
        else:
            reading_order_lines.append(f'- {index}. unknown id="{entry_id}"')

    instruction_title = (
        payload.narrativeTitle.strip() if payload.narrativeTitle else "Untitled draft narrative"
    )

    # ADR-0069 (D2=A): the narrative's spine is the logical structure — pass the
    # typed relations (edges + evidenceLinks) so the draft uses the causal /
    # contradiction vocabulary instead of inventing it.
    relation_lines = _narrative_relation_lines(payload, ir)
    spine_lines = _narrative_spine_lines(payload, ir) if ir is not None else []

    context_lines: list[str] = []
    if spine_lines:
        context_lines.append(
            "Causal and oppositional structure placed on the reading order "
            "(use these as the narrative's joints; do not invent relations that "
            "are not listed):"
        )
        context_lines.extend(spine_lines)
    if ir is not None and ir.get("truncation", {}).get("truncated"):
        reasons = ",".join(ir["truncation"].get("reason_codes", [])) or "unspecified"
        context_lines.append(
            f"Note: the projection hit its size limit ({reasons}); some cards and "
            "relations of the document are not listed above."
        )

    return "\n".join(
        [
            "You generate a narrative draft from diagram reading order.",
            "This is advisory only. Do not claim facts, truth, or certainty.",
            "Every statement must be phrased as interpretation or possibility based on the diagram.",
            "Use reading order as the narrative spine. Follow the order exactly.",
            "For each reading-order item, describe what it appears to contain and what it might mean.",
            "Explicitly label the output as draft and unreviewed.",
            "Use the typed relations below as the logical skeleton (causal, negation, evidence).",
            "Logical relations:",
            *(relation_lines or ["- (none)"]),
            *context_lines,
            # ai_sensemaking_execution_procedures.md §7: self-perform the A/B照合 and report
            # the mismatches as warnings so the 3+ threshold can be evaluated.
            "Self-perform the A/B cross-check (sensemaking_technique.md §5) and report each mismatch as a warning:",
            "  - 'b_missing_in_a': a statement in the narrative with no counterpart in the diagram.",
            "  - 'a_missing_in_b': a diagram island that the narrative never mentions.",
            "Return strict JSON only. No markdown. No extra keys.",
            "Use this exact schema:",
            '{"text":string,"basedOnReadingOrder":[string,...],"warnings":[string,...]?}',
            "basedOnReadingOrder must include only IDs from the provided reading order and preserve that order.",
            f"Narrative title hint: {json.dumps(instruction_title)}",
            "Reading order:",
            *(reading_order_lines or ["- (empty)"]),
        ]
    )


def _parse_generate_narrative_response(
    raw_text: str, source_doc: GenerateNarrativeRequest
) -> GenerateNarrativeResponse:
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="LLM response is not valid JSON") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="LLM response must be a JSON object")

    try:
        response = GenerateNarrativeResponse.model_validate(parsed)
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail="Invalid generate narrative response payload"
        ) from exc

    if response.text.strip() == "":
        raise HTTPException(status_code=422, detail="Generated narrative text must not be empty")

    reading_order = source_doc.doc.readingOrder or []
    reading_order_set = set(reading_order)
    if any(item_id not in reading_order_set for item_id in response.basedOnReadingOrder):
        raise HTTPException(
            status_code=422, detail="LLM response included unknown reading-order id"
        )

    if response.basedOnReadingOrder != reading_order:
        raise HTTPException(
            status_code=422,
            detail="LLM response basedOnReadingOrder must match source reading order exactly",
        )

    return response


def _suggest_layout_ir(payload: SuggestLayoutRequest) -> dict:
    """Build the LLM input IR for `/ai/suggest-layout` (ADR-0069 D4=A).

    Stage 4 of the `AI-IR-PROJECTION-01` rollout, and the ONLY endpoint that
    asks for coordinates: spec §2.2.1 lists `POST /ai/suggest-layout` as the one
    "要求" row of the D1=B table, because here the output IS placement, so the
    relative arrangement is genuine input. They arrive normalized per §2.2
    (centroid translated to the origin, plus `radius` / `angle_deg`) -- the raw
    absolute coordinates never enter the IR.

    SafeMode: the caller has ALREADY run `_reject_unreviewed_text`. The
    `allow_unreviewed_text` argument reproduces that helper's own predicate so
    the builder's independent check (llm_input_ir_spec.md §7.1) agrees with it
    rather than contradicting it. Both layers run; neither replaces the other.
    """
    allow_unreviewed = bool(
        payload.allowUnreviewedText is True and settings.allow_unreviewed_ai_text
    )
    try:
        return build_llm_input_ir(
            source_from_document(payload.doc),
            include_coordinates=True,
            safe_mode=True,
            allow_unreviewed_text=allow_unreviewed,
        )
    except IRGenerationError as exc:
        raise HTTPException(status_code=422, detail=exc.to_contract()) from exc


def _layout_placement_lines(ir: dict) -> list[str]:
    """The IR's normalized coordinates (spec §2.2), rendered for the prompt.

    These are structure, not output: the endpoint's response is in the
    document's own absolute space, which is why the `Cards:` section keeps
    carrying raw `x`/`y` unchanged. What the normalization adds is the part the
    absolute values do not state -- which cards sit near each other, and in what
    direction, independent of where the canvas happens to be panned.
    """
    return [
        f'- card "{item["card_id"]}" at (x={item["x"]}, y={item["y"]}), '
        f'radius={item["radius"]}, angle_deg={item["angle_deg"]}'
        for item in ir.get("coordinates", [])
    ]


def _layout_relation_lines(payload: SuggestLayoutRequest, ir: dict) -> list[str]:
    """The typed relations (ADR-0069: "あわせて edges を渡す").

    Card-to-card relations come from the IR, which is the input of record.
    Persisted island-to-island edges are NOT in the IR (spec §2.3 rule 6) and
    are read off the document, exactly as `getDerivedIslandEdges()` leaves them
    alone for being already explicit.
    """
    lines = [
        f'- card "{relation["from"]}" --{relation["type"]}--> card "{relation["to"]}"'
        for relation in ir.get("relations", [])
    ]
    lines.extend(
        f'- island "{edge.fromId}" --{edge.type}--> island "{edge.toId}" (stated)'
        for edge in payload.doc.edges
        if edge.fromKind == "island" and edge.toKind == "island"
    )
    return lines


def _layout_island_relation_lines(ir: dict) -> list[str]:
    """Islands as relation sets rather than only as rectangles.

    `derived_island_relations()` is the Python counterpart of the frontend's
    `getDerivedIslandEdges()`. Without it the prompt described each island by
    its current bounding box alone, so the only thing the model could reason
    about was where the island already is -- never which islands pull on each
    other, which is the thing a layout is supposed to express.
    """
    lines: list[str] = []
    for row in derived_island_relations(ir):
        target = (
            f'island "{row["to_id"]}"'
            if row["to_kind"] == "island"
            else f'lone card "{row["to_id"]}"'
        )
        lines.append(
            f'- island "{row["from_id"]}" --{row["type"]}--> {target} '
            f'(aggregated from {row["aggregate_count"]} card relation(s): '
            f'{", ".join(row["contributing_card_ids"])})'
        )
    return lines


def _build_prompt(payload: SuggestLayoutRequest, ir: dict | None = None) -> str:
    """Render the layout prompt, enriched from the IR when one is supplied.

    `ir=None` keeps the function callable on its own; the route always passes
    the IR it built. What is held unchanged is the LINE PREFIX of the `Cards:`
    and `Islands:` sections (`- id="...", text=` and `- id="...", title=`), not
    the whole line: when an IR is supplied, each island line goes on to append
    `parentIslandId=` / `placardCardId=` / `reviewState=`. The prefix is the
    part that is a de-facto contract with `deploy/tools/mock_local_llm.py`'s
    `_CARD_LINE` parser, and the `Cards:` section must keep listing EVERY
    document card because `_parse_suggestion()` requires the response to cover
    all of them (the IR may truncate, §5).
    """
    cards_by_id = {card.id: card for card in payload.doc.cards}
    card_lines = []
    for card in payload.doc.cards:
        critique_text = f", critique={json.dumps(card.critique)}" if card.critique else ""
        card_lines.append(
            f'- id="{card.id}", text={json.dumps(card.text)}, x={card.x}, y={card.y}{critique_text}'
        )

    islands_by_id = {island["id"]: island for island in (ir or {}).get("islands", [])}
    island_lines = []
    for island in payload.doc.islands:
        island_cards = [
            cards_by_id[card_id] for card_id in island.cardIds if card_id in cards_by_id
        ]
        if island_cards:
            x_values = [card.x for card in island_cards]
            y_values = [card.y for card in island_cards]
            bounds_text = (
                f"bounds=({min(x_values):.2f},{min(y_values):.2f})-({max(x_values):.2f},{max(y_values):.2f}), "
                f"anchor=({sum(x_values) / len(x_values):.2f},{sum(y_values) / len(y_values):.2f})"
            )
        else:
            bounds_text = "bounds=unknown, anchor=unknown"

        title_text = json.dumps(island.title) if island.title else '""'
        critique_text = f", critique={json.dumps(island.critique)}" if island.critique else ""
        # ADR-0069 D3=A: the confirmed hierarchy (parent island, placard, review
        # state) is what makes an island a decided structure rather than a box.
        ir_island = islands_by_id.get(island.id)
        structure_text = ""
        if ir_island is not None:
            structure_text = (
                f', parentIslandId={json.dumps(ir_island["parent_island_id"])}'
                f', placardCardId={json.dumps(ir_island["placard_card_id"])}'
                f', reviewState="{ir_island["review_state"]}"'
            )
        island_lines.append(
            f'- id="{island.id}", title={title_text}, cardIds={json.dumps(island.cardIds)}, '
            f"{bounds_text}{structure_text}{critique_text}"
        )

    instruction = payload.instruction.strip() if payload.instruction else "No extra instruction"

    context_lines: list[str] = []
    if ir is not None:
        placement_lines = _layout_placement_lines(ir)
        relation_lines = _layout_relation_lines(payload, ir)
        island_relation_lines = _layout_island_relation_lines(ir)
        if placement_lines:
            context_lines.append(
                "Relative placement (centroid moved to the origin; structure only, "
                "do NOT return these values -- return coordinates in the same "
                "absolute space as the Cards section above):"
            )
            context_lines.extend(placement_lines)
        context_lines.append("Logical relations (these, not the current positions, say what belongs near what):")
        context_lines.extend(relation_lines or ["- (none)"])
        context_lines.append("Island relations (aggregated from the card relations above):")
        context_lines.extend(island_relation_lines or ["- (none)"])
        if ir.get("truncation", {}).get("truncated"):
            reasons = ",".join(ir["truncation"].get("reason_codes", [])) or "unspecified"
            context_lines.append(
                f"Note: the projection hit its size limit ({reasons}); the relation "
                "and placement sections above do not cover every card listed under "
                "Cards. Still return a position for every card."
            )

    return "\n".join(
        [
            "You are generating a draft layout suggestion.",
            "Return JSON only, no markdown.",
            "Do not force a single correct answer. Suggest one plausible alternative layout.",
            "If a critique says 'too close', increase distance.",
            "If a critique says 'belongs together', place nearer.",
            "Place cards and islands that stand in a logical relation nearer, and keep "
            "the two sides of a 'negate' relation visibly apart.",
            "Preserve all ids and texts. Only propose positions and transform.",
            "Use this exact schema:",
            '{"transform":{"panX":number,"panY":number,"zoom":number},"cards":[{"id":string,"x":number,"y":number}],"notes":string?}',
            f"Instruction: {instruction}",
            (
                f"Current transform: panX={payload.doc.transform.panX}, "
                f"panY={payload.doc.transform.panY}, zoom={payload.doc.transform.zoom}"
            ),
            "Cards:",
            *card_lines,
            "Islands:",
            *island_lines,
            *context_lines,
        ]
    )


def _parse_suggestion(
    raw_text: str, source_doc: SuggestLayoutRequest
) -> tuple[Transform, list[Card], str | None]:
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="LLM response is not valid JSON") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="LLM response must be a JSON object")

    transform_data = parsed.get("transform")
    cards_data = parsed.get("cards")
    notes_data = parsed.get("notes")

    if not isinstance(transform_data, dict):
        raise HTTPException(status_code=422, detail="LLM response missing transform")
    if not isinstance(cards_data, list):
        raise HTTPException(status_code=422, detail="LLM response missing cards")
    if notes_data is not None and not isinstance(notes_data, str):
        raise HTTPException(status_code=422, detail="LLM response notes must be a string")

    try:
        transform = Transform.model_validate(transform_data)
    except Exception as exc:  # pydantic validation error
        raise HTTPException(status_code=422, detail="Invalid transform in LLM response") from exc

    if not all(math.isfinite(value) for value in (transform.panX, transform.panY, transform.zoom)):
        raise HTTPException(status_code=422, detail="Transform values must be finite numbers")

    source_cards_by_id = {card.id: card for card in source_doc.doc.cards}
    if len(cards_data) != len(source_cards_by_id):
        raise HTTPException(
            status_code=422, detail="LLM response must include all cards exactly once"
        )

    suggested_cards_by_id: dict[str, Card] = {}
    for card_item in cards_data:
        if not isinstance(card_item, dict):
            raise HTTPException(status_code=422, detail="Each card suggestion must be an object")

        card_id = card_item.get("id")
        if not isinstance(card_id, str):
            raise HTTPException(status_code=422, detail="Each card suggestion must include id")

        source_card = source_cards_by_id.get(card_id)
        if source_card is None:
            raise HTTPException(status_code=422, detail="LLM response included unknown card id")
        if card_id in suggested_cards_by_id:
            raise HTTPException(status_code=422, detail="LLM response included duplicate card id")

        x = card_item.get("x")
        y = card_item.get("y")
        if (
            isinstance(x, bool)
            or isinstance(y, bool)
            or not isinstance(x, (int, float))
            or not isinstance(y, (int, float))
        ):
            raise HTTPException(status_code=422, detail="Card x/y must be numbers")
        if not math.isfinite(float(x)) or not math.isfinite(float(y)):
            raise HTTPException(status_code=422, detail="Card x/y must be finite numbers")

        suggested_cards_by_id[card_id] = Card(
            id=source_card.id,
            text=source_card.text,
            x=float(x),
            y=float(y),
        )

    suggested_cards = [suggested_cards_by_id[card.id] for card in source_doc.doc.cards]
    return transform, suggested_cards, notes_data


def _eligible_merge_cards(payload: SuggestMergesRequest):
    """Return cards that the AI is allowed to consider for a merge proposal.

    Hold state and an existing mergedIntoCardId are human/data decisions that
    must win over model similarity. The response parser repeats these checks as
    defense in depth in case a provider returns an id it was not shown.
    """
    return [
        card
        for card in payload.doc.cards
        if card.holdState is None and not card.mergedIntoCardId
    ]


def _build_merge_prompt(
    payload: SuggestMergesRequest,
    ir_context: MergeSuggestionIRContext | None = None,
) -> str:
    """意味保存型の統合候補promptを、productionではroute固有入力から描画する。

    ``ir_context=None`` は既存の単体テスト・補助呼出しとの互換経路である。
    production routeは常に ``MergeSuggestionIRContext`` を渡し、候補本文・構造・
    route固有metadataを ``LLMRequest.inputs`` と同じ入力から描画する。
    """
    context_lines: list[str] = []
    if ir_context is None:
        card_lines = [
            f'- id="{card.id}", text={json.dumps(card.text)}'
            for card in _eligible_merge_cards(payload)
        ]
    else:
        ir = ir_context.document_ir
        card_lines = [
            f'- id="{card["id"]}", text={json.dumps(card["text"], ensure_ascii=False)}'
            for card in ir.get("cards", [])
            if card["id"] in ir_context.candidate_card_ids
        ]

        context_lines.extend(
            [
                "Merge-specific candidate context (recorded structure, not permission to merge):",
                *[
                    "- " + json.dumps(item, ensure_ascii=False, sort_keys=True)
                    for item in ir_context.inputs["mergeContext"]["candidateCards"]
                ],
                "sourceRefs are opaque document-local equality markers only. Same ref means the recorded source string was the same; infer no person, URL, authority, truth, or content from the token itself.",
                "islandIds are context only. Different islands do not automatically forbid a merge, and the same island does not automatically permit one.",
                "lineage is recorded context. Never invent canonicalId, repOf, or merge ancestry.",
                "Logical relations between eligible candidates:",
                *(
                    [
                        f'- card "{item["from"]}" --{item["type"]}--> card "{item["to"]}"'
                        for item in ir.get("relations", [])
                    ]
                    or ["- (none)"]
                ),
                "Evidence between eligible candidates:",
                *(
                    [
                        f'- card "{item["from_card_id"]}" --evidence:{item["type"]}--> '
                        f'card "{item["to_card_id"]}"'
                        + (
                            f' (contradictionState={item["contradiction_state"]})'
                            if item.get("contradiction_state")
                            else ""
                        )
                        for item in ir.get("evidence_links", [])
                    ]
                    or ["- (none)"]
                ),
            ]
        )

    instruction = payload.instruction.strip() if payload.instruction else "No extra instruction"

    return "\n".join(
        [
            "You propose KJ-compatible card integrations. This is advisory only.",
            "Use one of two approaches when appropriate and report the selected method for every suggestion:",
            '- 04-step-like consolidation for near-duplicate cards whose material distinctions can all be retained: set mergeMethod="near_duplicate".',
            '- kernel-fusion-style integration when several non-identical cards share a meaning kernel that can be stated without erasing their residual differences: set mergeMethod="kernel_fusion".',
            "Similarity alone is not enough. Sharing a topic or vocabulary is not enough.",
            "Before proposing, perform a Return check against every source card: would each source still recognise the draft as preserving what it says?",
            "Leave minority, lone, contradictory, held, or materially different cards separate.",
            "Do not invent provenance, conditions, certainty, or residual meaning that is not in the source cards.",
            "You must only propose suggestions. Do not apply merges, delete cards, or overwrite source cards.",
            "Return strict JSON only. No markdown. No explanation text outside JSON.",
            "Return at most 10 suggestions.",
            "Use this exact schema:",
            '{"suggestions":[{"groupId":string,"cardIds":[string,...],"mergedTextDraft":string,"mergeMethod":"near_duplicate|kernel_fusion","rationale":string?}]}',
            "Each suggestion must include at least 2 cardIds.",
            "Only use card IDs from the input.",
            f"Instruction: {instruction}",
            "Cards eligible for integration consideration:",
            *(card_lines or ["- (none)"]),
            *context_lines,
        ]
    )


def _validate_merge_suggestion_semantics(
    suggestions: list[MergeSuggestion], source_doc: SuggestMergesRequest
) -> None:
    """Fail closed when a provider proposes an integration that would erase
    an explicit human/data distinction.

    These are deterministic guards, not model instructions. Island membership,
    equivalence and source differences are intentionally *not* hard vetoes;
    they remain context for the later IR migration (AI-MERGE-SEMANTICS-01).
    """
    cards_by_id = {card.id: card for card in source_doc.doc.cards}
    negate_pairs = {
        frozenset((edge.fromId, edge.toId))
        for edge in source_doc.doc.edges
        if edge.fromKind == "card" and edge.toKind == "card" and edge.type == "negate"
    }
    contradiction_pairs = {
        frozenset((link.fromCardId, link.toCardId))
        for link in (source_doc.doc.evidenceLinks or [])
        if link.type == "contradicts"
    }

    seen_card_ids: set[str] = set()
    for suggestion in suggestions:
        suggestion_ids = set(suggestion.cardIds)
        if seen_card_ids & suggestion_ids:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "merge_candidate_overlap",
                    "message": "A card appeared in more than one merge suggestion",
                },
            )
        seen_card_ids.update(suggestion_ids)

        cards = [cards_by_id[card_id] for card_id in suggestion.cardIds]
        if any(card.holdState is not None for card in cards):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "merge_candidate_held",
                    "message": "A merge suggestion included a held card",
                },
            )
        if any(card.mergedIntoCardId for card in cards):
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "merge_candidate_already_merged",
                    "message": "A merge suggestion included a card already merged into another card",
                },
            )

        claim_types = {card.claimType for card in cards if card.claimType is not None}
        if len(claim_types) > 1:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "merge_candidate_claim_type_conflict",
                    "message": "A merge suggestion crossed distinct claim types",
                },
            )

        for index, left_id in enumerate(suggestion.cardIds):
            for right_id in suggestion.cardIds[index + 1 :]:
                pair = frozenset((left_id, right_id))
                if pair in negate_pairs:
                    raise HTTPException(
                        status_code=422,
                        detail={
                            "code": "merge_candidate_negated",
                            "message": "A merge suggestion crossed an explicit negate relation",
                        },
                    )
                if pair in contradiction_pairs:
                    raise HTTPException(
                        status_code=422,
                        detail={
                            "code": "merge_candidate_contradicted",
                            "message": "A merge suggestion crossed contradictory evidence",
                        },
                    )

def _parse_merge_suggestions(
    raw_text: str,
    source_doc: SuggestMergesRequest,
    *,
    allowed_card_ids: set[str] | frozenset[str] | None = None,
) -> list[MergeSuggestion]:
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="LLM response is not valid JSON") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="LLM response must be a JSON object")

    suggestions_data = parsed.get("suggestions")
    if not isinstance(suggestions_data, list):
        raise HTTPException(status_code=422, detail="LLM response missing suggestions array")
    if len(suggestions_data) > 10:
        raise HTTPException(
            status_code=422, detail="LLM response included more than 10 suggestions"
        )

    known_card_ids = (
        set(allowed_card_ids)
        if allowed_card_ids is not None
        else {card.id for card in source_doc.doc.cards}
    )
    parsed_suggestions: list[MergeSuggestion] = []
    seen_group_ids: set[str] = set()

    for item in suggestions_data:
        if not isinstance(item, dict):
            raise HTTPException(status_code=422, detail="Each merge suggestion must be an object")

        try:
            suggestion = MergeSuggestion.model_validate(item)
        except Exception as exc:
            raise HTTPException(status_code=422, detail="Invalid merge suggestion payload") from exc

        if suggestion.groupId in seen_group_ids:
            raise HTTPException(status_code=422, detail="Duplicate merge suggestion groupId")
        seen_group_ids.add(suggestion.groupId)

        if len(suggestion.cardIds) < 2:
            raise HTTPException(
                status_code=422, detail="Each merge suggestion must include at least 2 cardIds"
            )

        if len(set(suggestion.cardIds)) != len(suggestion.cardIds):
            raise HTTPException(
                status_code=422, detail="Each merge suggestion cardIds must not contain duplicates"
            )

        unknown_ids = [card_id for card_id in suggestion.cardIds if card_id not in known_card_ids]
        if unknown_ids:
            raise HTTPException(status_code=422, detail="LLM response included unknown card id")

        parsed_suggestions.append(suggestion)

    _validate_merge_suggestion_semantics(parsed_suggestions, source_doc)
    return parsed_suggestions


class AvailableModelItem(BaseModel):
    id: str
    displayName: str
    providerId: str
    capabilities: str | None = None


class AvailableModelsResponse(BaseModel):
    models: list[AvailableModelItem]
    unavailableReason: Literal[
        "no_active_models",
        "provider_unavailable",
        "tenant_policy_excludes_all",
        "no_user_selectable_models",
    ] | None = None


def _is_user_selectable_model(capabilities: str | None) -> bool:
    """AI-MODEL-GOVERNANCE-01 MMR-04: a model is user-selectable for the D5
    per-operation selectors only if it serves an intermediate/generate tier.
    final_judgement-only models (check_narrative / detect_contradiction etc.) are
    fixed by admin policy and must NOT be offered for user selection."""
    if not capabilities:
        return True
    lower = capabilities.strip().lower()
    if "intermediate" in lower or "generate" in lower:
        return True
    if "final_judgement" in lower:
        return False
    return True


@router.get(
    "/available-models",
    response_model=AvailableModelsResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def get_available_models(request: Request, db: Session = Depends(get_db)) -> AvailableModelsResponse:
    """AI-MODEL-GOVERNANCE-01 R2: the active registered models this tenant is
    allowed to use (registry active models intersected with the tenant allowlist;
    empty allowlist = platform-default = all active registered models). The UI
    model selector offers exactly this set -- user-selectable (intermediate/
    generate) models only, never final_judgement-only ones (MMR-04) and never
    disabled models or provider secrets."""
    from sui_sensemaking_api.model_registry_repository import (
        list_models,
        list_providers,
        tenant_allowlist_effective_model_ids,
    )

    tenant = _resolve_audit_tenant(request, db)
    active_models = [row for row in list_models(db) if row.lifecycle_state == "active"]
    active_provider_ids = set()
    for row in list_providers(db):
        if row.lifecycle_state != "active":
            continue
        provider_models = [model for model in active_models if model.provider_id == row.id]
        if any(
            registered_provider_available(
                RegisteredProviderConfig(
                    provider_id=row.id,
                    provider_kind=row.provider_kind,
                    base_url=row.base_url,
                    api_key_ref=row.api_key_ref,
                    model_id=model.id,
                )
            )
            for model in provider_models
        ):
            active_provider_ids.add(row.id)
    effective = tenant_allowlist_effective_model_ids(db, tenant_id=tenant.tenant_id)
    runtime_models = [row for row in active_models if row.provider_id in active_provider_ids]
    allowed = runtime_models
    if effective is not None:
        allowed = [row for row in allowed if row.id in effective]
    selectable = [row for row in allowed if _is_user_selectable_model(row.capabilities)]

    unavailable_reason = None
    if not active_models:
        unavailable_reason = "no_active_models"
    elif not runtime_models:
        unavailable_reason = "provider_unavailable"
    elif effective is not None and not allowed:
        unavailable_reason = "tenant_policy_excludes_all"
    elif not selectable:
        unavailable_reason = "no_user_selectable_models"

    return AvailableModelsResponse(
        models=[
            AvailableModelItem(
                id=row.id,
                displayName=row.display_name,
                providerId=row.provider_id,
                capabilities=row.capabilities,
            )
            for row in selectable
        ],
        unavailableReason=unavailable_reason,
    )


@router.get("/provider-status", response_model=ProviderStatusResponse)
def get_provider_status() -> ProviderStatusResponse:
    """PROV-VIS-01 (ADR-0050 D1): read-only echo of the configured provider
    kind for display in the View panel. No connectivity check is performed;
    "last known outcome" is tracked client-side from real AI-call results.
    OPS-LLM-COST-01: also reports process-local call/token observability,
    including whether provider usage metadata was complete, partial, or missing."""
    from sui_sensemaking_api.llm.provider import (
        llm_call_counts,
        llm_token_usage,
        llm_token_usage_coverage,
    )

    return ProviderStatusResponse(
        providerKind=get_provider().provider_kind,
        callCounts=llm_call_counts(),
        tokenUsage=llm_token_usage(),
        tokenUsageCoverage=llm_token_usage_coverage(),
    )


@router.post(
    "/suggest-layout",
    response_model=SuggestLayoutResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def suggest_layout(payload: SuggestLayoutRequest, request: Request, db: Session = Depends(get_db)) -> SuggestLayoutResponse:
    # SEC-AI-SAFEMODE-01 (ADR-0068, Done). Layer 1 -- DO NOT REMOVE. The IR
    # builder below runs its own review-state check as an ADDITIONAL layer
    # (ADR-0069 "ADR-0068 との関係", AGENTS.md §7); it does not replace this one.
    _reject_unreviewed_text(payload.doc, payload.allowUnreviewedText)

    # AI-IR-PROJECTION-01 (stage 4 of the ADR-0069 rollout). The one endpoint
    # that declares `coordinates` required (spec §2.2.1 / D1=B) -- and the first
    # to receive the relations and the confirmed island hierarchy, so an island
    # reaches the model as a set of relations and not only as a rectangle.
    ir = _suggest_layout_ir(payload)

    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="re_layout",
                prompt=_build_prompt(payload, ir),
                inputs=ir,
            )
        )
    except ProviderDisabledError as exc:
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _raise_llm_http_error(exc)

    _audit_llm_trace(request, _resolve_audit_tenant(request, db), payload.doc.id, "re_layout", llm_response)

    transform, cards, notes = _parse_suggestion(llm_response.raw_text, payload)

    suggested_doc = payload.doc.model_copy(
        update={
            "transform": transform,
            "cards": cards,
        }
    )

    return SuggestLayoutResponse(
        suggestionId=str(uuid4()),
        suggestedDoc=suggested_doc,
        notes=notes,
    )


@router.post(
    "/suggest-merges",
    response_model=SuggestMergesResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def suggest_merges(payload: SuggestMergesRequest, request: Request, db: Session = Depends(get_db)) -> SuggestMergesResponse:
    # SEC-AI-SAFEMODE-01/02: route側guardを一次防御として維持する。
    _reject_unreviewed_text(payload.doc, payload.allowUnreviewedText)

    # 候補が1枚以下なら統合という仕事自体が成立しない。providerへ不要な本文を送らない。
    if len(_eligible_merge_cards(payload)) < 2:
        return SuggestMergesResponse(suggestions=[])

    allow_unreviewed = bool(
        payload.allowUnreviewedText is True and settings.allow_unreviewed_ai_text
    )
    try:
        ir_context = build_merge_suggestion_ir_context(
            payload,
            allow_unreviewed_text=allow_unreviewed,
        )
    except IRGenerationError as exc:
        raise HTTPException(status_code=422, detail=exc.to_contract()) from exc

    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="suggest_merges",
                prompt=_build_merge_prompt(payload, ir_context),
                inputs=ir_context.inputs,
            )
        )
    except ProviderDisabledError as exc:
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _raise_llm_http_error(exc)

    _audit_llm_trace(request, _resolve_audit_tenant(request, db), payload.doc.id, "suggest_merges", llm_response)

    suggestions = _parse_merge_suggestions(
        llm_response.raw_text,
        payload,
        allowed_card_ids=ir_context.candidate_card_ids,
    )
    return SuggestMergesResponse(suggestions=suggestions)


@router.post(
    "/suggest-island-summary",
    response_model=SuggestIslandSummaryResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def suggest_island_summary(payload: SuggestIslandSummaryRequest, request: Request, db: Session = Depends(get_db)) -> SuggestIslandSummaryResponse:
    # SEC-AI-SAFEMODE-01/02: 既存のroute側検査を一次防御として維持する。
    _reject_unreviewed_text(payload.doc, payload.allowUnreviewedText)

    # 既存promptを先に構築し、islandId不存在・空島の従来エラー境界を維持する。
    base_prompt = _build_island_summary_prompt(payload)
    allow_unreviewed = bool(
        payload.allowUnreviewedText is True and settings.allow_unreviewed_ai_text
    )
    try:
        ir_context = build_island_summary_ir_context(
            payload, allow_unreviewed_text=allow_unreviewed
        )
    except IRGenerationError as exc:
        raise HTTPException(status_code=422, detail=exc.to_contract()) from exc
    # provider transportはpromptだけを送るため、直接メンバー本文もIRから再描画する。
    # 最初のbuilder呼び出しは従来の島不存在・空島エラー境界を保つvalidation-onlyである。
    base_prompt = _build_island_summary_prompt(payload, ir_context=ir_context)
    prompt = "\n".join(
        [base_prompt, "", *island_summary_ir_prompt_lines(ir_context)]
    )

    model_id = payload.model or resolve_model_for_task("suggest_island_summary")
    provider_config = _assert_model_allowed(request, db, model_id)
    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="suggest_island_summary",
                prompt=prompt,
                inputs=ir_context.ir,
                model=model_id,
                registered_provider=provider_config,
            )
        )
    except ProviderDisabledError as exc:
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _raise_llm_http_error(exc)

    _audit_llm_trace(request, _resolve_audit_tenant(request, db), payload.doc.id, "suggest_island_summary", llm_response)

    return _parse_island_summary_response(llm_response.raw_text, payload)


@router.post(
    "/proposals/island-summary",
    response_model=ProposalEnvelope,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def propose_island_summary(
    payload: ProposeIslandSummaryRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ProposalEnvelope:
    _, _, tenant = _authorize_request(
        request,
        db,
        action="write",
        doc_id=payload.doc.id,
        safe_mode=False,
        read_only=False,
    )
    if get_document_row(db, tenant=tenant, doc_id=payload.doc.id) is None:
        raise HTTPException(status_code=404, detail="Document not found")
    summary_result = suggest_island_summary(
        SuggestIslandSummaryRequest(
            doc=payload.doc,
            islandId=payload.islandId,
            allowUnreviewedText=payload.allowUnreviewedText,
            model=payload.model,
            critiqueText=payload.critiqueText,
        ),
        request,
        db,
    )
    target_island = next(
        (item for item in payload.doc.islands if item.id == payload.islandId), None
    )
    if target_island is None:
        raise HTTPException(status_code=422, detail="islandId does not exist")
    proposal = ProposalEnvelope(
        proposalId=f"proposal-{uuid4()}",
        type="island_summary",
        status="proposed",
        reviewState="unreviewed",
        sourceBundleHash=payload.sourceBundleHash,
        diff={
            "entityType": "island_summary",
            "targetId": payload.islandId,
            "field": "summaryText",
            "before": target_island.summaryText,
            # ADR-0077: primary candidate (candidates[0]) becomes the single
            # adoptable summary. DOGFOOD-34 (Phase 2b): carry the FULL candidate
            # list so the UI can offer alternatives (candidates[0] = after).
            "after": summary_result.candidates[0].summaryText,
            "groundingIds": summary_result.candidates[0].groundingIds,
            "candidates": [c.model_dump() for c in summary_result.candidates],
            "warnings": summary_result.warnings,
        },
        rationale="AI generated proposal only. Human decision is required before any apply.",
    )
    try:
        register_ai_proposal(
            db,
            tenant=tenant,
            doc_id=payload.doc.id,
            proposal_id=proposal.proposalId,
            proposal_kind=proposal.type,
            source_bundle_hash=proposal.sourceBundleHash,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Proposal registration conflicted") from exc
    return proposal


def _build_opposing_viewpoint_prompt(
    payload: ProposeOpposingViewpointRequest,
    ir_context: OpposingViewpointIRContext | None = None,
) -> str:
    """対象カードに接地したproposal-onlyの反対視点promptを組み立てる。

    ``ir_context=None`` は既存の単体テスト・補助呼出しとの互換経路であり、
    production routeは常にroute固有IRを渡す。``Target card:`` の行形式は
    DOGFOOD-17のmock/E2E接地契約なので変更しない。
    """
    target = next((card for card in payload.doc.cards if card.id == payload.targetCardId), None)
    if target is None:
        raise HTTPException(status_code=422, detail="targetCardId does not exist")

    target_text = target.text
    if ir_context is not None:
        target_ir = next(
            (item for item in ir_context.ir.get("cards", []) if item["id"] == target.id),
            None,
        )
        if target_ir is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "required_card_context_mismatch",
                    "message": "Task-required card context did not fit in the IR projection",
                },
            )
        target_text = target_ir["text"]

    lines = [
        "You propose an OPPOSING viewpoint or an evidence-gap note for the target card.",
        "Use only the provided cards, relations, and evidence. Do not add outside facts.",
        "The proposal is a candidate for human review -- it is never applied automatically.",
        "Ground every claim in the target and the recorded context. Distinguish an existing human judgement from a new AI proposal.",
        "If the target's evidence is missing or weak, set evidenceGap=true; recorded contradictory evidence does not by itself decide the target's truth.",
        'Return strict JSON only: {"opposingText": string, "evidenceGap": boolean, "rationale": string, "warnings": [string,...]}',
        f"Target card: {json.dumps({'id': target.id, 'text': target_text})}",
    ]
    if ir_context is not None:
        lines.extend(opposing_viewpoint_ir_prompt_lines(ir_context))
        return "\n".join(lines)

    # 互換経路: IR文脈を明示しない補助呼出しでは従来の全文書入力を維持する。
    card_lines = "\n".join(
        f'  - id="{card.id}", text={json.dumps(card.text)}'
        for card in payload.doc.cards
    )
    evidence_lines = "\n".join(
        f'  - source "{link.fromCardId}" --{link.type}--> target "{link.toCardId}"'
        for link in payload.doc.evidenceLinks or []
    ) or "- (none)"
    lines.extend(["Cards:", card_lines, "Evidence links:", evidence_lines])
    return "\n".join(lines)

@router.post(
    "/proposals/opposing-viewpoint",
    response_model=OpposingViewpointProposal,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def propose_opposing_viewpoint(
    payload: ProposeOpposingViewpointRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> OpposingViewpointProposal:
    """AI-OPPOSE-01 (M4): proposal-only opposing-viewpoint / evidence-gap
    proposal for a target card, derived from the doc's contradiction and
    evidence structure. Never auto-applied (status stays "proposed")."""
    _, _, tenant = _authorize_request(
        request,
        db,
        action="write",
        doc_id=payload.doc.id,
        safe_mode=False,
        read_only=False,
    )
    if get_document_row(db, tenant=tenant, doc_id=payload.doc.id) is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if next((card for card in payload.doc.cards if card.id == payload.targetCardId), None) is None:
        raise HTTPException(status_code=422, detail="targetCardId does not exist")
    # SEC-AI-SAFEMODE-01/02: 既存route guardを一次防御として維持する。
    _reject_unreviewed_text(payload.doc, payload.allowUnreviewedText)
    allow_unreviewed = bool(
        payload.allowUnreviewedText is True and settings.allow_unreviewed_ai_text
    )
    try:
        ir_context = build_opposing_viewpoint_ir_context(
            payload, allow_unreviewed_text=allow_unreviewed
        )
    except IRGenerationError as exc:
        raise HTTPException(status_code=422, detail=exc.to_contract()) from exc
    prompt = _build_opposing_viewpoint_prompt(payload, ir_context)
    model_id = payload.model or resolve_model_for_task("propose_opposing_viewpoint")
    provider_config = _assert_model_allowed(request, db, model_id)

    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="propose_opposing_viewpoint",
                prompt=prompt,
                inputs=ir_context.ir,
                model=model_id,
                registered_provider=provider_config,
            )
        )
    except ProviderDisabledError as exc:
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _raise_llm_http_error(exc)

    try:
        data = json.loads(llm_response.raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="LLM response is not valid JSON") from exc
    proposal = OpposingViewpointProposal(
        proposalId=f"proposal-{uuid4()}",
        targetCardId=payload.targetCardId,
        opposingText=str(data.get("opposingText", data.get("opposing_text", ""))),
        evidenceGap=bool(data.get("evidenceGap", data.get("evidence_gap", False))),
        rationale=str(data.get("rationale", "")),
        warnings=[str(w) for w in (data.get("warnings") or [])],
    )
    if not proposal.opposingText:
        raise HTTPException(status_code=422, detail="LLM response missing opposingText")
    return proposal


def _record_proposal_decision(
    payload: ProposalDecisionAuditRequest | ExternalAgentProposalDecisionRequest,
    request: Request,
    db: Session,
    *,
    expected_origin: str,
) -> ProposalDecisionAuditResponse:
    access_request, _, tenant = _authorize_request(
        request,
        db,
        action="write",
        doc_id=payload.docId,
        safe_mode=False,
        read_only=False,
    )
    if get_document_row(db, tenant=tenant, doc_id=payload.docId) is None:
        raise HTTPException(status_code=404, detail="Document not found")
    reviewer_ref = access_request.auth.actor_ref if access_request.auth is not None else None
    if reviewer_ref is None:
        raise HTTPException(status_code=401, detail="Authenticated reviewer is required")

    def _persist():
        return persist_proposal_decision(
            db,
            tenant=tenant,
            doc_id=payload.docId,
            proposal_id=payload.proposalId,
            source_bundle_hash=payload.sourceBundleHash,
            idempotency_key=payload.idempotencyKey,
            decision=payload.decision,
            reviewer_ref=reviewer_ref,
            reason=payload.reason,
            expected_origin=expected_origin,
        )

    try:
        receipt = _persist()
        db.commit()
    except ProposalNotRegistered as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProposalDecisionConflict as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except IntegrityError:
        db.rollback()
        try:
            receipt = _persist()
            db.commit()
        except ProposalNotRegistered as exc:
            db.rollback()
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except (IntegrityError, ProposalDecisionConflict) as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail="Proposal decision conflicted") from exc
    logger.info(
        "proposal_decision_recorded",
        extra={
            "eventId": receipt.event_id,
            "proposalId": receipt.proposal_id,
            "status": receipt.status,
        },
    )
    return ProposalDecisionAuditResponse(
        recorded=True,
        eventId=receipt.event_id,
        proposalId=receipt.proposal_id,
        status=receipt.status,
        reviewState="unreviewed",
        recordedAt=receipt.recorded_at,
    )


@router.post(
    "/external-tasks/register",
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def register_external_task(
    payload: ExternalAgentTaskRegistrationRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ExternalAgentTaskRegistrationResponse:
    _, _, tenant = _authorize_request(
        request,
        db,
        action="write",
        doc_id=payload.docId,
        safe_mode=False,
        read_only=False,
    )
    document = get_document_row(db, tenant=tenant, doc_id=payload.docId)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    persisted_document = json.loads(document.payload_json)
    if payload.baseDocSignature != f"{document.id}:{persisted_document['updatedAt']}":
        raise HTTPException(status_code=409, detail="External task base document is stale")
    try:
        register_external_agent_task(
            db,
            tenant=tenant,
            task_id=payload.taskId,
            doc_id=payload.docId,
            base_doc_signature=payload.baseDocSignature,
            source_bundle_hash=payload.sourceBundleHash,
            query_canonical_hash=payload.queryCanonicalHash,
            task_kind=payload.taskKind,
        )
        db.commit()
    except ProposalDecisionConflict as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="External task registration conflicted"
        ) from exc
    return ExternalAgentTaskRegistrationResponse(
        taskId=payload.taskId,
        provenanceLevel=payload.provenanceLevel,
    )


@router.post(
    "/external-proposals/register",
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def register_external_proposal(
    payload: ExternalAgentProposalRegistrationRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ExternalAgentProposalRegistrationResponse:
    _, _, tenant = _authorize_request(
        request,
        db,
        action="write",
        doc_id=payload.docId,
        safe_mode=False,
        read_only=False,
    )
    document = get_document_row(db, tenant=tenant, doc_id=payload.docId)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    persisted_document = json.loads(document.payload_json)
    expected_base_signature = f"{document.id}:{persisted_document['updatedAt']}"
    if payload.baseDocSignature != expected_base_signature:
        raise HTTPException(status_code=409, detail="External proposal base document is stale")
    try:
        register_external_agent_proposal(
            db,
            tenant=tenant,
            doc_id=payload.docId,
            proposal_id=payload.proposalId,
            proposal_kind=payload.proposalKind,
            source_bundle_hash=payload.sourceBundleHash,
            task_id=payload.taskId,
            base_doc_signature=payload.baseDocSignature,
            query_canonical_hash=payload.queryCanonicalHash,
            proposal_fingerprint=payload.proposalFingerprint,
        )
        db.commit()
    except ProposalDecisionConflict as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="External proposal registration conflicted"
        ) from exc
    return ExternalAgentProposalRegistrationResponse(
        proposalId=payload.proposalId,
        provenanceLevel=payload.provenanceLevel,
    )


@router.post(
    "/proposals/audit",
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def record_proposal_decision(
    payload: ProposalDecisionAuditRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ProposalDecisionAuditResponse:
    return _record_proposal_decision(payload, request, db, expected_origin="internal")


@router.post(
    "/external-proposals/audit",
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def record_external_proposal_decision(
    payload: ExternalAgentProposalDecisionRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> ProposalDecisionAuditResponse:
    return _record_proposal_decision(payload, request, db, expected_origin="external_agent")


@router.get(
    "/proposals/status",
    response_model=ProposalStatusResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def get_proposal_status(
    docId: str,
    request: Request,
    db: Session = Depends(get_db),
) -> ProposalStatusResponse:
    """CE4 read-only proposal lifecycle status for a document.
    Lets a generative-AI (via MCP or API) verify that a proposal is still
    proposal-only or was decided by a human (accepted/rejected/held) --
    traceability without mutating anything. Read-only by contract
    (`action="read"`): no proposal or decision is written here.
    """
    _, _, tenant = _authorize_request(
        request,
        db,
        action="read",
        doc_id=docId,
        safe_mode=False,
        read_only=True,
    )
    proposals = (
        db.query(AIProposalRow)
        .filter_by(tenant_id=tenant.tenant_id, doc_id=docId)
        .order_by(AIProposalRow.created_at.asc(), AIProposalRow.proposal_id.asc())
        .all()
    )
    decisions = {
        row.proposal_id: row
        for row in db.query(AIProposalDecisionStateRow)
        .filter_by(tenant_id=tenant.tenant_id, doc_id=docId)
        .all()
    }
    return ProposalStatusResponse(
        docId=docId,
        proposals=[
            ProposalStatusItem(
                proposalId=row.proposal_id,
                proposalKind=row.proposal_kind,
                origin=row.origin,
                status=decisions[row.proposal_id].status if row.proposal_id in decisions else "proposed",
                sourceBundleHash=row.source_bundle_hash,
                createdAt=row.created_at,
                decidedAt=decisions[row.proposal_id].updated_at if row.proposal_id in decisions else None,
            )
            for row in proposals
        ],
    )


@router.post(
    "/generate-narrative",
    response_model=GenerateNarrativeResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def generate_narrative(payload: GenerateNarrativeRequest, request: Request, db: Session = Depends(get_db)) -> GenerateNarrativeResponse:
    # SEC-AI-SAFEMODE-01 (ADR-0068, Done). Layer 1 -- DO NOT REMOVE. The IR
    # builder below runs its own review-state check as an ADDITIONAL layer
    # (ADR-0069 "ADR-0068 との関係", AGENTS.md §7); it does not replace this one.
    _reject_unreviewed_text(payload.doc, payload.allowUnreviewedText)

    # AI-IR-PROJECTION-01 (stage 3 of the ADR-0069 rollout): this route now goes
    # through the LLM input IR, so the typed card-to-card relations -- causal and
    # negate above all -- reach the model instead of only the reading order.
    ir = _generate_narrative_ir(payload)

    model_id = payload.model or resolve_model_for_task("generate_narrative")
    provider_config = _assert_model_allowed(request, db, model_id)
    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="generate_narrative",
                prompt=_build_generate_narrative_prompt(payload, ir),
                inputs=ir,
                model=model_id,
                registered_provider=provider_config,
            )
        )
    except ProviderDisabledError as exc:
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _raise_llm_http_error(exc)

    _audit_llm_trace(request, _resolve_audit_tenant(request, db), payload.doc.id, "generate_narrative", llm_response)

    return _parse_generate_narrative_response(llm_response.raw_text, payload)


@router.post(
    "/check-narrative",
    response_model=CheckNarrativeResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def check_narrative(payload: CheckNarrativeRequest, request: Request, db: Session = Depends(get_db)) -> CheckNarrativeResponse:
    _validate_check_narrative_input(payload)
    _reject_unreviewed_text(payload.doc, payload.allowUnreviewedText)
    _validate_final_judgement_external_proposal(
        payload.externalProposalRef,
        doc_id=payload.doc.id,
        request=request,
        db=db,
    )

    model_id = resolve_model_for_task("check_narrative")
    try:
        provider_config = _assert_model_allowed(request, db, model_id)
    except HTTPException as exc:
        _hold_linked_external_proposal_after_final_judgement_governance_failure(
            payload.externalProposalRef,
            doc_id=payload.doc.id,
            request=request,
            db=db,
            exc=exc,
            model_id=model_id,
        )
        raise

    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="check_narrative",
                prompt=_build_narrative_check_prompt(payload),
                model=model_id,
                registered_provider=provider_config,
            )
        )
    except ProviderDisabledError as exc:
        _hold_linked_external_proposal_after_final_judgement_failure(
            payload.externalProposalRef,
            doc_id=payload.doc.id,
            request=request,
            db=db,
            exc=exc,
        )
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _hold_linked_external_proposal_after_final_judgement_failure(
            payload.externalProposalRef,
            doc_id=payload.doc.id,
            request=request,
            db=db,
            exc=exc,
        )
        _raise_llm_http_error(exc)

    _audit_llm_trace(
        request,
        _resolve_audit_tenant(request, db),
        payload.doc.id,
        "check_narrative",
        llm_response,
        external_proposal_ref=payload.externalProposalRef,
    )

    return _parse_narrative_check_response(llm_response.raw_text, payload)


# ---------------------------------------------------------------------------
# ADR-0064: KJ-method card-level AI operations
# ---------------------------------------------------------------------------


def _build_refine_card_text_prompt(payload: RefineCardTextRequest) -> str:
    ctx = f"\nContext: {payload.context}" if payload.context else ""
    return (
        f"Refine the wording of this KJ-method card. "
        f"Make it clearer and more concise while preserving the original meaning. "
        # ai_sensemaking_execution_procedures.md §1: 名詞止め禁止 — a card must be a
        # predicate-bearing sentence, never a bare noun-phrase stop.
        f"Output must be a predicate-bearing sentence (動詞で終わる文), never a noun-phrase stop (名詞止め). "
        f'Return JSON: {{"refinedText": "...", "reasoning": "..."}}\n'
        f"Card text: {payload.cardText}{ctx}"
    )


def _parse_refine_card_text_response(raw_text: str) -> RefineCardTextResponse:
    data = json.loads(raw_text)
    return RefineCardTextResponse(
        refinedText=str(data.get("refinedText", data.get("refined_text", ""))),
        reasoning=data.get("reasoning"),
    )


def _suggest_card_groups_ir(payload: SuggestCardGroupsRequest) -> dict:
    """Build the LLM input IR for `/ai/suggest-card-groups` (ADR-0069 D4=A).

    Stage 2 of the `AI-IR-PROJECTION-01` rollout. `payload.doc`, when present,
    is the projection source: the IR then carries the islands the human already
    confirmed (with their `parent_island_id` hierarchy), the relation graph and
    every card's `hold_state`. Without it the IR degrades to the flat card list,
    which is the pre-IR request shape and stays supported (AC-11).

    At representative scale, a requested card carrying `hold_state` is itself
    route-required meaning: it must remain visible so `_card_group_candidates`
    can honor the human's "not now" decision instead of silently losing it to
    the global centrality cut. Only held cards in `payload.cards` are reserved;
    unrelated held cards elsewhere in the document do not consume this route's
    IR budget.

    SafeMode: the caller has ALREADY run `_reject_unreviewed_cards`. The
    `allow_unreviewed_text` argument reproduces that helper's own predicate so
    the builder's independent check (llm_input_ir_spec.md §7.1) agrees with it
    rather than contradicting it. Both layers run; neither replaces the other.
    """
    allow_unreviewed = bool(
        payload.allowUnreviewedText is True and settings.allow_unreviewed_ai_text
    )
    requested = tuple(
        SourceCard(id=card.id, text=card.text, text_reviewed=card.textReviewed)
        for card in payload.cards
    )
    if payload.doc is not None:
        source = source_from_document(payload.doc)
        # The cards to group travel outside `doc` in this contract, so make sure
        # they are projected even when the document does not list them. A card
        # the document DOES list keeps the document's richer entry (that is the
        # one carrying `holdState`).
        known = {card.id for card in source.cards}
        extra = tuple(card for card in requested if card.id not in known)
        if extra:
            source = replace(source, cards=source.cards + extra)
    else:
        source = IRSource(doc_id="", doc_version=1, cards=requested)

    requested_ids = {card.id for card in payload.cards}
    required_hold_ids = tuple(
        card.id
        for card in source.cards
        if card.id in requested_ids and card.hold_state is not None
    )

    try:
        # spec §2.2.1: suggest-card-groups does not request coordinates
        # (ADR-0069 D1=B). Bundling follows the similarity of what cards appeal
        # for, not where they happen to sit on the canvas.
        return build_llm_input_ir(
            source,
            include_coordinates=False,
            safe_mode=True,
            allow_unreviewed_text=allow_unreviewed,
            required_card_ids=required_hold_ids,
        )
    except IRGenerationError as exc:
        raise HTTPException(status_code=422, detail=exc.to_contract()) from exc


def _card_group_candidates(
    payload: SuggestCardGroupsRequest, ir: dict
) -> tuple[list[str], list[str]]:
    """Split the requested cards into (groupable, withheld-because-held).

    AC-2, enforced in code rather than by prompt wording: a card the human has
    set aside (`hold_state`, spec §2.1 rule 8) is not a grouping candidate, and
    an LLM instruction to that effect is a request, not an invariant.

    A card the IR could not carry at all (spec §5 truncation) is not a candidate
    either, and is reported as neither -- it was never offered, so the held set
    stays exactly "withheld by the human's decision".
    """
    projected = {card["id"] for card in ir["cards"]}
    held = set(held_card_ids(ir))
    candidates = [
        card.id for card in payload.cards if card.id in projected and card.id not in held
    ]
    withheld = [card.id for card in payload.cards if card.id in held]
    return candidates, withheld


def _attention_candidates_from_ir(ir: dict) -> list[AttentionCandidate]:
    """Expose only structurally novel, proposal-only cues from deterministic IR.

    This is intentionally stricter than forwarding cluster_candidates. Existing
    island membership is not a discovery. A two-card relation is also already
    visible on the canvas, so relation candidates are surfaced only when the
    connected structure implies at least one indirect pair. Spatial cues are
    opt-in and must cross an island boundary or involve an unassigned card.
    Internal IR scores never cross this product boundary.
    """
    held = set(held_card_ids(ir))
    islands = [set(island["card_ids"]) for island in ir.get("islands", [])]
    assigned = set().union(*islands) if islands else set()
    co_island_pairs = {
        tuple(sorted(pair))
        for members in islands
        for pair in combinations(sorted(members), 2)
    }
    direct_relation_pairs = {
        tuple(sorted((relation["from"], relation["to"])))
        for relation in ir.get("relations", [])
        if relation["type"] in {"related", "causal"}
        and relation["from"] != relation["to"]
    }

    result: list[AttentionCandidate] = []
    for cluster in ir.get("cluster_candidates", []):
        card_ids = sorted(str(card_id) for card_id in cluster["card_ids"])
        members = set(card_ids)
        if members & held:
            continue
        # A subset of one existing island is already represented by the user's
        # current structure and does not deserve scarce attention.
        if any(members <= island for island in islands):
            continue

        pairs = set(combinations(card_ids, 2))
        not_co_islanded = pairs - co_island_pairs
        if not not_co_islanded:
            continue

        unassigned = bool(members - assigned)
        touched = sum(bool(members & island) for island in islands)
        basis = cluster["basis"]
        if basis == "relation":
            indirect = not_co_islanded - direct_relation_pairs
            if not indirect:
                continue
            cue = "indirect_relation"
        elif unassigned:
            cue = "unassigned"
        elif touched >= 2:
            cue = "cross_island"
        else:
            continue

        result.append(
            AttentionCandidate(
                candidateId=str(cluster["cluster_id"]),
                cardIds=card_ids,
                basis=basis,
                cue=cue,
            )
        )
    return result


def _build_suggest_card_groups_prompt(
    payload: SuggestCardGroupsRequest,
    ir: dict | None = None,
    candidate_ids: list[str] | None = None,
) -> str:
    """Render the prompt from the IR (ADR-0069: the IR is the input of record).

    `ir=None` keeps the function callable on its own; the route always passes
    the IR it built.
    """
    header = (
        # ai_sensemaking_execution_procedures.md §2: bundle by the similarity of what the
        # cards are APPEALING for (訴えの類似性), not by classification; first
        # level bundles are 2-3 cards (rarely 4); never force a lone card in.
        "Group these KJ-method cards into islands. "
        "Bundle cards by the similarity of what they are appealing for, not by classification labels. "
        "Each first-level bundle is 2-3 cards (rarely 4). Do not force a card into a bundle it does not belong to. "
        'Return JSON: {"groups": [{"label": "...", "cardIds": ["..."], '
        '"rationale": "..."}]}'
    )
    if ir is None:
        cards = "\n".join(f'  - id="{c.id}", text="{c.text}"' for c in payload.cards)
        return f"{header}\nCards:\n{cards}"

    allowed = set(candidate_ids) if candidate_ids is not None else None
    by_id = {card["id"]: card for card in ir["cards"]}
    listed = [
        card_id
        for card_id in (candidate_ids if candidate_ids is not None else by_id)
        if card_id in by_id
    ]
    # The line format is a contract with the mock adapter's prompt parser
    # (`03_Implement/deploy/tools/mock_local_llm.py`); keep it byte-compatible.
    cards = "\n".join(f'  - id="{cid}", text="{by_id[cid]["text"]}"' for cid in listed)
    lines = [header, f"Cards:\n{cards}"]

    context: list[str] = []

    withheld = [card_id for card_id in held_card_ids(ir) if allowed is None or card_id not in allowed]
    if withheld:
        context.append(
            "Cards the human has set aside (holdState). They are NOT listed above "
            "and must not appear in any group:"
        )
        for card_id in withheld:
            context.append(f'- {card_id} (holdState={by_id[card_id]["hold_state"]})')

    islands = ir.get("islands", [])
    if islands:
        context.append(
            "Islands the human has already confirmed. Do not re-propose an "
            "existing island, and do not move its members without reason:"
        )
        for island in islands:
            title = island["title"] or "(untitled)"
            parent = island["parent_island_id"]
            parent_note = f", parentIslandId={parent}" if parent else ""
            context.append(
                f'- {island["id"]} "{title}" (reviewState={island["review_state"]}'
                f'{parent_note}, members={",".join(island["card_ids"]) or "none"})'
            )

    relations = ir.get("relations", [])
    if relations:
        context.append("Relations recorded on the canvas (ADR-0048 vocabulary):")
        for relation in relations:
            context.append(
                f'- {relation["type"]}: {relation["from"]} -> {relation["to"]}'
            )

    clusters = [
        cluster
        for cluster in ir.get("cluster_candidates", [])
        if allowed is None or set(cluster["card_ids"]) <= allowed
    ]
    if clusters:
        context.append(
            "Structural observation, not a decision (no ranking of card content):"
        )
        for cluster in clusters:
            context.append(
                f'- {cluster["cluster_id"]}: {",".join(cluster["card_ids"])} '
                f'(basis={cluster["basis"]})'
            )

    if context:
        lines.append("")
        lines.extend(context)
    return "\n".join(lines)


def _parse_suggest_card_groups_response(
    raw_text: str,
    *,
    candidate_ids: list[str] | None = None,
    excluded_card_ids: list[str] | None = None,
    truncated: bool = False,
) -> SuggestCardGroupsResponse:
    data = json.loads(raw_text)
    from sui_sensemaking_api.models_ai import _SuggestedGroup

    allowed = set(candidate_ids) if candidate_ids is not None else None
    groups: list[_SuggestedGroup] = []
    for g in data.get("groups", []):
        card_ids = [str(c) for c in g.get("cardIds", g.get("card_ids", []))]
        if allowed is not None:
            # AC-2, second half of the in-code enforcement: whatever the model
            # answered, a card that was not a candidate does not enter a group.
            # Prompt compliance is not an invariant, and a held card slipping
            # back in here would be the human's decision overridden.
            card_ids = [card_id for card_id in card_ids if card_id in allowed]
            if not card_ids:
                continue
        groups.append(
            _SuggestedGroup(
                label=str(g.get("label", "")),
                cardIds=card_ids,
                rationale=g.get("rationale"),
            )
        )

    return SuggestCardGroupsResponse(
        groups=groups,
        excludedCardIds=list(excluded_card_ids or []),
        truncated=truncated,
    )


def _detect_contradiction_ir(payload: DetectContradictionRequest) -> dict:
    """Build the LLM input IR for `/ai/detect-contradiction` (ADR-0069 D4=A).

    `payload.doc`, when present, is the projection source: the IR then carries
    the relation graph, the confirmed island hierarchy and the recorded
    evidence links. Without it the IR degrades to the two cards alone, which is
    the pre-IR request shape and stays supported (AC-11).

    SafeMode: the caller has ALREADY run `_reject_unreviewed_cards`. The
    `allow_unreviewed_text` argument reproduces that helper's own predicate so
    the builder's independent check (llm_input_ir_spec.md §7.1) agrees with it
    rather than contradicting it. Both layers run; neither replaces the other.
    """
    allow_unreviewed = bool(
        payload.allowUnreviewedText is True and settings.allow_unreviewed_ai_text
    )
    if payload.cardA.id == payload.cardB.id:
        # A card cannot contradict itself, and the IR forbids a duplicate card
        # id outright (spec §2.1 rule 5) -- catch it here so the answer is the
        # same whether or not a document was supplied.
        raise HTTPException(
            status_code=422,
            detail={
                "code": "duplicate_card_id",
                "message": "cardA and cardB must reference different cards.",
            },
        )
    if payload.doc is not None:
        source = source_from_document(payload.doc)
        # The two focus cards travel outside `doc` in this contract, so make
        # sure they are projected even when the document does not list them.
        known = {card.id for card in source.cards}
        extra = tuple(
            SourceCard(id=card.id, text=card.text, text_reviewed=card.textReviewed)
            for card in (payload.cardA, payload.cardB)
            if card.id not in known
        )
        if extra:
            source = replace(source, cards=source.cards + extra)
    else:
        source = IRSource(
            doc_id="",
            doc_version=1,
            cards=tuple(
                SourceCard(id=card.id, text=card.text, text_reviewed=card.textReviewed)
                for card in (payload.cardA, payload.cardB)
            ),
        )

    try:
        # spec §2.2.1: detect-contradiction does not request coordinates
        # (ADR-0069 D1=B) -- placement is not evidence of a contradiction.
        return build_llm_input_ir(
            source,
            include_coordinates=False,
            safe_mode=True,
            allow_unreviewed_text=allow_unreviewed,
            required_card_ids=(payload.cardA.id, payload.cardB.id),
        )
    except IRGenerationError as exc:
        raise HTTPException(status_code=422, detail=exc.to_contract()) from exc


def _build_detect_contradiction_prompt(
    payload: DetectContradictionRequest, ir: dict | None = None
) -> str:
    """Render the prompt from the IR (ADR-0069: the IR is the input of record).

    `ir=None` keeps the function callable on its own; the route always passes
    the IR it built.
    """
    header = (
        "Determine if these two KJ-method cards contradict each other. "
        'Return JSON: {"hasContradiction": true|false, "explanation": "..."}\n'
        "A mere difference of opinion is not a contradiction.\n"
    )
    lines = [
        header,
        f"Card A (id={payload.cardA.id}): {payload.cardA.text}",
        f"Card B (id={payload.cardB.id}): {payload.cardB.text}",
    ]
    if ir is None:
        return "\n".join(lines)

    pair = {payload.cardA.id, payload.cardB.id}
    context: list[str] = []

    recorded = [
        link
        for link in ir.get("evidence_links", [])
        if {link["from_card_id"], link["to_card_id"]} & pair
    ]
    if recorded:
        context.append(
            "Evidence links the human has already recorded (do NOT re-propose a "
            "contradiction whose state is confirmed or held):"
        )
        for link in recorded:
            state = link["contradiction_state"] or "n/a"
            context.append(
                f'- {link["type"]} {link["from_card_id"]} -> {link["to_card_id"]}'
                f" (contradictionState={state})"
            )

    relations = [
        relation
        for relation in ir.get("relations", [])
        if {relation["from"], relation["to"]} & pair
    ]
    if relations:
        context.append("Relations recorded on the canvas (ADR-0048 vocabulary):")
        for relation in relations:
            context.append(
                f'- {relation["type"]}: {relation["from"]} -> {relation["to"]}'
            )

    islands = [
        island for island in ir.get("islands", []) if set(island["card_ids"]) & pair
    ]
    if islands:
        context.append("Islands the human has confirmed for these cards:")
        for island in islands:
            title = island["title"] or "(untitled)"
            context.append(
                f'- {island["id"]} "{title}" (reviewState={island["review_state"]}, '
                f'members={",".join(island["card_ids"])})'
            )

    subgraphs = ir.get("graph_summary", {}).get("contradiction_subgraphs", [])
    touching = [item for item in subgraphs if set(item["card_ids"]) & pair]
    if touching:
        context.append("Structural observation (no ranking, no scoring):")
        for item in touching:
            context.append(f'- {item["subgraph_id"]}: {item["summary"]}')

    if context:
        lines.append("")
        lines.extend(context)
    return "\n".join(lines)


def _parse_detect_contradiction_response(raw_text: str) -> DetectContradictionResponse:
    data = json.loads(raw_text)
    return DetectContradictionResponse(
        hasContradiction=bool(data.get("hasContradiction", data.get("has_contradiction", False))),
        explanation=data.get("explanation"),
    )


# ---------------------------------------------------------------------------
# Card-level AI endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/refine-card-text",
    response_model=RefineCardTextResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def refine_card_text(payload: RefineCardTextRequest, request: Request, db: Session = Depends(get_db)) -> RefineCardTextResponse:
    _reject_unreviewed_cards([payload], payload.allowUnreviewedText)
    model_id = payload.model or resolve_model_for_task("refine_card_text")
    provider_config = _assert_model_allowed(request, db, model_id)
    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="refine_card_text",
                prompt=_build_refine_card_text_prompt(payload),
                model=model_id,
                registered_provider=provider_config,
            )
        )
    except ProviderDisabledError as exc:
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _raise_llm_http_error(exc)
    # RefineCardTextRequest has no document context; audit with empty doc_id.
    _audit_llm_trace(request, _resolve_audit_tenant(request, db), "(no-doc)", "refine_card_text", llm_response)
    return _parse_refine_card_text_response(llm_response.raw_text)


@router.post(
    "/suggest-attention-candidates",
    response_model=SuggestAttentionCandidatesResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def suggest_attention_candidates(
    payload: SuggestAttentionCandidatesRequest,
) -> SuggestAttentionCandidatesResponse:
    """Return provider-free attention cues without proposing document mutation."""
    _reject_unreviewed_text(payload.doc, payload.allowUnreviewedText)
    allow_unreviewed = bool(
        payload.allowUnreviewedText is True and settings.allow_unreviewed_ai_text
    )
    try:
        ir = build_llm_input_ir(
            source_from_document(payload.doc),
            include_coordinates=payload.includeSpatial,
            safe_mode=True,
            allow_unreviewed_text=allow_unreviewed,
        )
    except IRGenerationError as exc:
        raise HTTPException(status_code=422, detail=exc.to_contract()) from exc

    return SuggestAttentionCandidatesResponse(
        candidates=_attention_candidates_from_ir(ir),
        excludedCardIds=held_card_ids(ir),
        truncated=bool(ir.get("truncation", {}).get("truncated")),
    )


@router.post(
    "/suggest-card-groups",
    response_model=SuggestCardGroupsResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def suggest_card_groups(payload: SuggestCardGroupsRequest, request: Request, db: Session = Depends(get_db)) -> SuggestCardGroupsResponse:
    # SEC-AI-SAFEMODE-01/02 (ADR-0068, Done). Layer 1 -- DO NOT REMOVE. The IR
    # builder below runs its own review-state check as an ADDITIONAL layer
    # (ADR-0069 "ADR-0068 との関係", AGENTS.md §7); it does not replace this one.
    _reject_unreviewed_cards(payload.cards, payload.allowUnreviewedText)

    # AI-IR-PROJECTION-01 (stage 2 of the ADR-0069 rollout): this route now goes
    # through the LLM input IR instead of stringifying a flat id/text list, so
    # the existing islands, their hierarchy and each card's hold state reach the
    # model -- and the hold state is enforced here, in code.
    ir = _suggest_card_groups_ir(payload)
    candidate_ids, excluded_card_ids = _card_group_candidates(payload, ir)
    truncated = bool(ir.get("truncation", {}).get("truncated"))

    model_id = payload.model or resolve_model_for_task("suggest_card_groups")
    provider_config = _assert_model_allowed(request, db, model_id)

    if len(candidate_ids) < 2:
        # AC-2: nothing left to bundle once the human's held cards are withheld.
        # Answer from the IR; a one-card "group" is not a KJ bundle
        # (ai_sensemaking_execution_procedures.md §2) and the model is not asked.
        return SuggestCardGroupsResponse(
            groups=[], excludedCardIds=excluded_card_ids, truncated=truncated
        )

    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="suggest_card_groups",
                prompt=_build_suggest_card_groups_prompt(payload, ir, candidate_ids),
                inputs=ir,
                model=model_id,
                registered_provider=provider_config,
            )
        )
    except ProviderDisabledError as exc:
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _raise_llm_http_error(exc)
    # Unchanged for the flat card-list request shape ("(no-doc)"); a supplied
    # document is now attributable in the audit trail.
    _audit_llm_trace(
        request,
        _resolve_audit_tenant(request, db),
        payload.doc.id if payload.doc is not None else "(no-doc)",
        "suggest_card_groups",
        llm_response,
    )
    return _parse_suggest_card_groups_response(
        llm_response.raw_text,
        candidate_ids=candidate_ids,
        excluded_card_ids=excluded_card_ids,
        truncated=truncated,
    )


@router.post(
    "/detect-contradiction",
    response_model=DetectContradictionResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def detect_contradiction(payload: DetectContradictionRequest, request: Request, db: Session = Depends(get_db)) -> DetectContradictionResponse:
    # SEC-AI-SAFEMODE-01/02 (ADR-0068, Done). Layer 1 -- DO NOT REMOVE. The IR
    # builder below runs its own review-state check as an ADDITIONAL layer
    # (ADR-0069 "ADR-0068 との関係", AGENTS.md §7); it does not replace this one.
    _reject_unreviewed_cards([payload.cardA, payload.cardB], payload.allowUnreviewedText)

    if payload.externalProposalRef is not None:
        if payload.doc is None:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "external_proposal_document_required",
                    "message": "doc is required when externalProposalRef is supplied.",
                },
            )
        _validate_final_judgement_external_proposal(
            payload.externalProposalRef,
            doc_id=payload.doc.id,
            request=request,
            db=db,
        )

    # AI-IR-PROJECTION-01 (stage 1 of the ADR-0069 rollout): this route now goes
    # through the LLM input IR instead of stringifying two card texts.
    ir = _detect_contradiction_ir(payload)

    # AC-1: a contradiction the human already confirmed or held is a decision,
    # not a finding. Answer from the IR and never ask the model again.
    adjudicated = adjudicated_contradiction(ir, payload.cardA.id, payload.cardB.id)
    if adjudicated is not None:
        state = adjudicated["contradiction_state"]
        return DetectContradictionResponse(
            hasContradiction=False,
            explanation=(
                "A contradiction between these cards is already recorded and "
                f"adjudicated by a human (contradictionState={state}); "
                "it is not re-proposed."
            ),
            alreadyRecorded=True,
            existingContradictionState=state,
        )

    model_id = resolve_model_for_task("detect_contradiction")
    try:
        provider_config = _assert_model_allowed(request, db, model_id)
    except HTTPException as exc:
        _hold_linked_external_proposal_after_final_judgement_governance_failure(
            payload.externalProposalRef,
            doc_id=payload.doc.id if payload.doc is not None else "(no-doc)",
            request=request,
            db=db,
            exc=exc,
            model_id=model_id,
        )
        raise

    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="detect_contradiction",
                prompt=_build_detect_contradiction_prompt(payload, ir),
                inputs=ir,
                model=model_id,
                registered_provider=provider_config,
            )
        )
    except ProviderDisabledError as exc:
        _hold_linked_external_proposal_after_final_judgement_failure(
            payload.externalProposalRef,
            doc_id=payload.doc.id if payload.doc is not None else "(no-doc)",
            request=request,
            db=db,
            exc=exc,
        )
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _hold_linked_external_proposal_after_final_judgement_failure(
            payload.externalProposalRef,
            doc_id=payload.doc.id if payload.doc is not None else "(no-doc)",
            request=request,
            db=db,
            exc=exc,
        )
        _raise_llm_http_error(exc)
    # Unchanged for the two-card request shape ("(no-doc)"); a supplied document
    # is now attributable in the audit trail.
    _audit_llm_trace(
        request,
        _resolve_audit_tenant(request, db),
        payload.doc.id if payload.doc is not None else "(no-doc)",
        "detect_contradiction",
        llm_response,
        external_proposal_ref=payload.externalProposalRef,
    )
    return _parse_detect_contradiction_response(llm_response.raw_text)


@router.post(
    "/suggest-document-title",
    response_model=SuggestDocumentTitleResponse,
    dependencies=[Depends(require_tenant_scoped_api_precondition)],
)
def suggest_document_title(payload: SuggestDocumentTitleRequest, request: Request, db: Session = Depends(get_db)) -> SuggestDocumentTitleResponse:
    _reject_unreviewed_cards([payload], payload.allowUnreviewedText)
    model_id = payload.model or resolve_model_for_task("suggest_document_title")
    provider_config = _assert_model_allowed(request, db, model_id)
    try:
        llm_response = generate_with_fallback(
            LLMRequest(
                task="suggest_document_title",
                prompt=_build_suggest_document_title_prompt(payload),
                temperature=0.4,
                max_tokens=300,
                model=model_id,
                registered_provider=provider_config,
            )
        )
    except ProviderDisabledError as exc:
        _raise_llm_http_error(exc)
    except ProviderRequestError as exc:
        _raise_llm_http_error(exc)
    # SuggestDocumentTitleRequest has no document context; audit with empty doc_id.
    _audit_llm_trace(request, _resolve_audit_tenant(request, db), "(no-doc)", "suggest_document_title", llm_response)
    return _parse_suggest_document_title_response(llm_response.raw_text)


def _build_suggest_document_title_prompt(payload: SuggestDocumentTitleRequest) -> str:
    islands = (
        "\n".join(f"  - {t}" for t in payload.islandTitles[:20])
        if payload.islandTitles
        else "(none)"
    )
    cards = "\n".join(f"  - {t}" for t in payload.cardTexts[:30]) if payload.cardTexts else "(none)"
    current = f'\nCurrent title: "{payload.currentTitle}"' if payload.currentTitle else ""
    return (
        f"Suggest 1-3 short document titles (each max 80 chars, in Japanese) that "
        f"capture the overall theme of this KJ-method canvas. "
        f"The document contains these island labels and card texts. "
        f"Do NOT rank or score the candidates — present them as equal alternatives.{current}\n"
        f"Island labels:\n{islands}\n"
        f"Sample card texts:\n{cards}\n"
        f'Return JSON: {{"candidates": [{{"title": "..."}}]}}'
    )


def _parse_suggest_document_title_response(raw_text: str) -> SuggestDocumentTitleResponse:
    data = json.loads(raw_text)
    from sui_sensemaking_api.models_ai import _DocumentTitleCandidate

    candidates_raw = data.get("candidates", [])
    if not isinstance(candidates_raw, list) or len(candidates_raw) == 0:
        raise ValueError("suggest_document_title response had no candidates")
    candidates = [
        _DocumentTitleCandidate(title=str(c.get("title", ""))[:500]) for c in candidates_raw[:3]
    ]
    if not candidates:
        raise ValueError("suggest_document_title response had empty candidates")
    return SuggestDocumentTitleResponse(candidates=candidates)
