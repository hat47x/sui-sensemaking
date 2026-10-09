import json
import logging
import re
import time
from urllib.parse import quote
from hashlib import sha256
from datetime import datetime, timezone
from threading import Lock
from typing import Literal, cast

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, TypeAdapter, ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from sui_sensemaking_api.access_control import (
    AccessAction,
    AccessDecision,
    AccessRequest,
    AuthContext,
    FailSafeMode,
    apply_tenant_boundary_guard,
    enforce_access,
    resolve_access_decision,
)
from sui_sensemaking_api.audit import build_event
from sui_sensemaking_api.auth_assurance import build_auth_assurance_metadata
from sui_sensemaking_api.auth_context import resolve_identity_context
from sui_sensemaking_api.content_store import ContentBlob
from sui_sensemaking_api.database_content_store import (
    DatabaseAppendOnlyLogContentStore,
    DatabaseDocumentContentStore,
)
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.document_access_resource import (
    DocumentAccessResourceResolver,
    SingleTenantHeaderResourceResolver,
)
from sui_sensemaking_api.document_repository import (
    get_document_row,
    list_merge_decision_logs_by_group as list_merge_log_rows_by_group,
    list_merge_decision_logs_by_snapshot as list_merge_log_rows_by_snapshot,
)
from sui_sensemaking_api.generation_repository import RevisionHeadConflict
from sui_sensemaking_api.guest_admission_repository import GuestAdmissionRepository
from sui_sensemaking_api.guest_request_auth import resolve_guest_request_session
from sui_sensemaking_api.models import (
    Card,
    CandidateListViewModel,
    DocumentListItem,
    DocumentPayload,
    MergeDecisionRecord,
    A1ErrorResponse,
    PolygonHandoffContractVerificationRequest,
    PolygonHandoffContractVerificationResponse,
    SimilarCandidateGroup,
    SimilarCandidateScoreSummary,
)
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.saas_request_context import resolve_trusted_saas_request_session
from sui_sensemaking_api.tenant_context import (
    SingleTenantContextResolver,
    TenantContext,
    TenantContextResolver,
)
from sui_sensemaking_api.tenant_session_precondition import (
    require_tenant_session_request_precondition,
    tenant_session_precondition_required,
)

router = APIRouter(prefix="/docs", tags=["docs"])
document_payload_adapter: TypeAdapter[DocumentPayload] = TypeAdapter(DocumentPayload)
logger = logging.getLogger(__name__)


def _validate_review_attribution_identity(
    *, document: DocumentPayload, identity: AuthContext
) -> None:
    review_attribution = document.reviewAttribution
    if review_attribution is None or review_attribution.reviewState != "human_reviewed":
        return

    if identity.actor_ref is None:
        raise HTTPException(status_code=403, detail="authenticated reviewer identity is required")

    if review_attribution.reviewerRef != identity.actor_ref:
        raise HTTPException(status_code=403, detail="reviewerRef must match authenticated identity")


def _raise_a1_validation_error(*, code: str, contract_id: str, message: str) -> None:
    payload = A1ErrorResponse.model_validate(
        {
            "schemaVersion": "1.0.0",
            "errorEnvelope": {
                "errorCode": code,
                "message": message,
                "contractId": contract_id,
                "retryable": False,
                "occurredAt": datetime.now(timezone.utc).isoformat(),
            },
        }
    )
    raise HTTPException(status_code=422, detail=payload.model_dump(mode="json"))


def _validate_document_payload_with_a1_contract(document_payload: object) -> DocumentPayload:
    try:
        document = document_payload_adapter.validate_python(document_payload)
    except ValidationError as exc:
        errors = exc.errors()
        message = (
            str(errors[0].get("msg", "document payload validation failed")) if errors else str(exc)
        )
        code = "A1_REQUIRED_FIELD_MISSING"
        contract_id = "A1-REDIFF-IF"
        first_error_loc = tuple(errors[0].get("loc", ())) if errors else ()
        first_error_loc_text = ".".join(str(part) for part in first_error_loc)

        if "schemaVersion" in str(message):
            code = "A1_SCHEMA_VERSION_MISMATCH"
            if "critiqueInputs" in str(message) or "critiqueInputs" in first_error_loc:
                contract_id = "A1-CRITIQUE-IF"
            elif "reviewAttribution" in str(message) or "reviewAttribution" in first_error_loc:
                contract_id = "A1-ATTR-IF"
        elif "critiqueInputs" in first_error_loc_text:
            contract_id = "A1-CRITIQUE-IF"
        elif "reviewAttribution" in first_error_loc_text:
            contract_id = "A1-ATTR-IF"
        elif "reproposalDiffs" in first_error_loc_text:
            contract_id = "A1-REDIFF-IF"
        if "reviewAttribution" in first_error_loc and "overridePolicy" in first_error_loc:
            code = "A1_OVERRIDE_POLICY_VIOLATION"
            contract_id = "A1-ATTR-IF"
        elif "critiqueInputs" in first_error_loc and "schemaVersion" in first_error_loc:
            code = "A1_SCHEMA_VERSION_MISMATCH"
            contract_id = "A1-CRITIQUE-IF"
        if "reviewerRef must be opaque" in str(message):
            code = "A1_PII_POLICY_VIOLATION"
            contract_id = "A1-ATTR-IF"
        if "traceKey" in str(message):
            code = "A1_TRACE_KEY_MISSING"
            contract_id = "A1-REDIFF-IF"

        _raise_a1_validation_error(
            code=code,
            contract_id=contract_id,
            message=message,
        )

    if document.critiqueInputs is not None:
        for critique in document.critiqueInputs:
            if critique.schemaVersion != "1.0.0":
                _raise_a1_validation_error(
                    code="A1_SCHEMA_VERSION_MISMATCH",
                    contract_id="A1-CRITIQUE-IF",
                    message="schemaVersion must be 1.0.0 for critique inputs",
                )

    if document.reproposalDiffs is not None:
        for reproposal in document.reproposalDiffs:
            if reproposal.schemaVersion != "1.0.0":
                _raise_a1_validation_error(
                    code="A1_SCHEMA_VERSION_MISMATCH",
                    contract_id="A1-REDIFF-IF",
                    message="schemaVersion must be 1.0.0 for reproposal diffs",
                )
            if not reproposal.traceKey:
                _raise_a1_validation_error(
                    code="A1_TRACE_KEY_MISSING",
                    contract_id="A1-REDIFF-IF",
                    message="traceKey is required by A1-REDIFF-IF",
                )

    if document.reviewAttribution is not None:
        attribution = document.reviewAttribution
        if attribution.schemaVersion != "1.0.0":
            _raise_a1_validation_error(
                code="A1_SCHEMA_VERSION_MISMATCH",
                contract_id="A1-ATTR-IF",
                message="schemaVersion must be 1.0.0 for review attribution",
            )
        if attribution.overridePolicy != "human_dual_control_only":
            _raise_a1_validation_error(
                code="A1_OVERRIDE_POLICY_VIOLATION",
                contract_id="A1-ATTR-IF",
                message="overridePolicy must be human_dual_control_only",
            )
        if attribution.reviewerRef is not None and "@" in attribution.reviewerRef:
            _raise_a1_validation_error(
                code="A1_PII_POLICY_VIOLATION",
                contract_id="A1-ATTR-IF",
                message="reviewerRef must be opaque and must not contain email-like identifiers",
            )

    return document


def _authorize_request(
    request: Request,
    db: Session,
    *,
    action: AccessAction,
    doc_id: str,
    safe_mode: bool,
    read_only: bool,
) -> tuple[AccessRequest, AccessDecision, TenantContext]:
    guest_session = resolve_guest_request_session(request=request)
    if guest_session is not None:
        # ADR-0080 D3: the guest principal itself conveys zero document
        # visibility. R2a intentionally supports read only; broader guest
        # actions remain closed until separately designed and tested.
        if action != "read":
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "guest_write_not_enabled",
                    "message": "Guest write access is not enabled.",
                },
            )
        guest_repo = GuestAdmissionRepository(db, tenant_id=guest_session.tenant_id)
        if not guest_repo.can_read_document(
            guest_principal_id=guest_session.guest_principal_id,
            doc_id=doc_id,
        ):
            # Preserve resource anti-enumeration: an ungranted existing doc is
            # indistinguishable from a non-existent/cross-tenant doc.
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "guest_document_not_granted",
                    "message": "Document is not available.",
                },
            )
        tenant = TenantContext(
            tenant_id=guest_session.tenant_id,
            membership_id=None,
            resolved_by="guest_session",
        )
        resource_resolver: DocumentAccessResourceResolver = getattr(
            request.app.state,
            "document_access_resource_resolver",
            SingleTenantHeaderResourceResolver(),
        )
        resource = resource_resolver.resolve(
            db=db,
            request=request,
            tenant=tenant,
            action=action,
            doc_id=doc_id,
        )
        access_request = AccessRequest(
            action=action,
            safe_mode=safe_mode,
            read_only=True,
            auth=AuthContext(
                actor_ref=guest_session.guest_principal_id,
                user_id=None,
                provider="guest_session",
                external_uid=guest_session.guest_principal_id,
                trace_id=request.headers.get("x-trace-id"),
            ),
            tenant=tenant,
            resource=resource,
        )
        tenant_boundary = apply_tenant_boundary_guard(access_request, required=True)
        if tenant_boundary is not None:
            enforce_access(tenant_boundary, action=action)
        return (
            access_request,
            AccessDecision(allow=True, read_only=True, reason="guest_document_grant"),
            tenant,
        )

    tenant_scoped_session_required = tenant_session_precondition_required(request)
    if tenant_scoped_session_required:
        trusted_session = resolve_trusted_saas_request_session(
            request=request,
            db=db,
        )
        require_tenant_session_request_precondition(
            request=request,
            current_version=trusted_session.session.tenant_session_version,
        )
        identity = trusted_session.identity
        tenant = trusted_session.tenant
    else:
        identity = resolve_identity_context(db=db, request=request)
        resolver: TenantContextResolver = getattr(
            request.app.state,
            "tenant_context_resolver",
            SingleTenantContextResolver(),
        )
        tenant = resolver.resolve(
            db=db,
            user_id=identity.user_id,
            claim=identity.verified_tenant_claim,
        )
    resource_resolver: DocumentAccessResourceResolver = getattr(
        request.app.state,
        "document_access_resource_resolver",
        SingleTenantHeaderResourceResolver(),
    )
    resource = resource_resolver.resolve(
        db=db,
        request=request,
        tenant=tenant,
        action=action,
        doc_id=doc_id,
    )
    adapter = getattr(request.app.state, "access_control_adapter", None)
    if adapter is None:
        access_request = AccessRequest(
            action=action,
            safe_mode=safe_mode,
            read_only=read_only,
            auth=identity.auth_context,
            tenant=tenant,
            resource=resource,
        )
        tenant_boundary = apply_tenant_boundary_guard(
            access_request,
            required=True,
        )
        if tenant_boundary is not None:
            enforce_access(tenant_boundary, action=action)
        if tenant_scoped_session_required:
            # A tenant-scoped runtime has no PDP to consult, so nothing --
            # reads included -- may be allowed from here. The SaaS startup
            # preflight and the lifespan adapter factory already keep this
            # unreachable while both hold; stating the deny at the enforcement
            # point keeps the guarantee local, like every sibling condition.
            enforce_access(
                AccessDecision(allow=False, reason="adapter_missing"),
                action=action,
            )
        decision = AccessDecision(allow=True)
        return access_request, decision, tenant

    access_request = AccessRequest(
        action=action,
        safe_mode=safe_mode,
        read_only=read_only,
        tenant=tenant,
        auth=AuthContext(
            actor_ref=identity.auth_context.actor_ref,
            user_id=identity.auth_context.user_id,
            provider=identity.auth_context.provider,
            external_uid=identity.auth_context.external_uid,
            # SEC-AUTH-ATTRIB-01 (D-a): authorization attributes must come from a
            # VERIFIED identity, never from client-supplied headers. Neither the
            # single-tenant header identity nor the SaaS JWT identity populates
            # roles/groups yet, so these are empty (fail-closed) — the server
            # does not assert attributes it cannot verify.
            roles=identity.auth_context.roles,
            groups=identity.auth_context.groups,
            trace_id=request.headers.get("x-trace-id"),
            amr=identity.auth_context.amr,
            acr=identity.auth_context.acr,
            aal=identity.auth_context.aal,
            auth_time=identity.auth_context.auth_time,
        ),
        resource=resource,
    )

    fail_safe_mode = getattr(request.app.state, "access_control_fail_safe_mode", "read_only")
    if fail_safe_mode not in {"deny", "read_only"}:
        fail_safe_mode = "read_only"
    typed_fail_safe_mode = cast(FailSafeMode, fail_safe_mode)

    decision = resolve_access_decision(
        adapter=adapter,
        request=access_request,
        fail_safe_mode=typed_fail_safe_mode,
        require_tenant_scope=True,
    )
    enforce_access(decision, action=action)
    return access_request, decision, tenant


def _compute_etag(payload_json: str) -> str:
    return sha256(payload_json.encode("utf-8")).hexdigest()


def _format_etag(etag: str) -> str:
    return f'"{etag}"'


def _normalize_text_for_candidate_key(raw_text: str) -> str:
    return " ".join(raw_text.casefold().split())


def _token_signature(raw_text: str) -> str:
    normalized = _normalize_text_for_candidate_key(raw_text)
    if not normalized:
        return ""
    tokens = sorted({token for token in re.split(r"[^\w]+", normalized) if token})
    return "|".join(tokens)


def _is_candidate_eligible(card: Card) -> bool:
    return card.mergedIntoCardId is None and card.canonicalId is None and not card.sources


def _build_similar_candidate_groups(
    document: DocumentPayload, *, payload_json: str
) -> CandidateListViewModel:
    cards = sorted(
        (card for card in document.cards if _is_candidate_eligible(card)), key=lambda card: card.id
    )
    grouped_by_normalized_text: dict[str, list[Card]] = {}
    grouped_by_token_signature: dict[str, list[Card]] = {}
    for card in cards:
        normalized_text = _normalize_text_for_candidate_key(card.text)
        if normalized_text:
            grouped_by_normalized_text.setdefault(normalized_text, []).append(card)
        signature = _token_signature(card.text)
        if signature:
            grouped_by_token_signature.setdefault(signature, []).append(card)

    groups_by_card_set: dict[tuple[str, ...], SimilarCandidateGroup] = {}

    def register_group(*, reason_code: str, key: str, candidates: list[Card], score: float) -> None:
        if len(candidates) < 2:
            return
        ordered_ids = tuple(card.id for card in sorted(candidates, key=lambda card: card.id))
        existing_group = groups_by_card_set.get(ordered_ids)
        if existing_group is not None:
            if reason_code not in existing_group.reasonCodes:
                existing_group.reasonCodes.append(reason_code)
                existing_group.reasonCodes.sort()
            return

        target_card_id = ordered_ids[0]
        candidate_card_ids = list(ordered_ids[1:])
        encoded_key = re.sub(r"[^a-z0-9_-]+", "-", key.casefold()).strip("-") or "unknown"
        group_id = f"heuristic-{reason_code}-{encoded_key}-{target_card_id}"
        groups_by_card_set[ordered_ids] = SimilarCandidateGroup(
            groupId=group_id,
            targetCardId=target_card_id,
            candidateCardIds=candidate_card_ids,
            scoreSummary=SimilarCandidateScoreSummary(min=score, max=score, avg=score),
            reasonCodes=[reason_code],
            snapshotVersion=_compute_etag(payload_json)[:12],
        )

    for normalized_text, grouped_cards in grouped_by_normalized_text.items():
        register_group(
            reason_code="normalized_text", key=normalized_text, candidates=grouped_cards, score=1.0
        )
    for signature, grouped_cards in grouped_by_token_signature.items():
        register_group(
            reason_code="token_signature", key=signature, candidates=grouped_cards, score=0.75
        )

    ordered_groups = sorted(
        groups_by_card_set.values(),
        key=lambda group: (group.targetCardId, group.candidateCardIds, group.groupId),
    )
    return CandidateListViewModel(
        generatedAt=document.updatedAt,
        groups=ordered_groups,
        totalGroupCount=len(ordered_groups),
    )


def _parse_if_match(if_match: str) -> set[str]:
    values: set[str] = set()
    for raw_part in if_match.split(","):
        part = raw_part.strip()
        if part.startswith("W/"):
            part = part[2:].strip()
        if part.startswith('"') and part.endswith('"') and len(part) >= 2:
            part = part[1:-1]
        if part:
            values.add(part)
    return values


def _resolve_request_tenant(*, request: Request, db: Session) -> TenantContext:
    """Resolve the tenant for a request that has no document id (e.g. a list).
    Mirrors the single-tenant / SaaS branches of _authorize_request without the
    per-document resource/decision parts."""
    return _resolve_request_identity_and_tenant(request=request, db=db)[1]


def _resolve_request_identity_and_tenant(
    *, request: Request, db: Session
) -> tuple[str | None, TenantContext]:
    """Like _resolve_request_tenant, but also returns the caller's user_id.

    SEC-DOC-BOUND-06: the list endpoint needs the caller's identity to apply
    the visibility filter (§11.2 of post-mvp-business-scope-design-program.html)
    without a per-document PDP round-trip.
    """
    tenant_scoped_session_required = tenant_session_precondition_required(request)
    if tenant_scoped_session_required:
        trusted_session = resolve_trusted_saas_request_session(request=request, db=db)
        require_tenant_session_request_precondition(
            request=request,
            current_version=trusted_session.session.tenant_session_version,
        )
        return trusted_session.identity.user_id, trusted_session.tenant
    identity = resolve_identity_context(db=db, request=request)
    resolver: TenantContextResolver = getattr(
        request.app.state,
        "tenant_context_resolver",
        SingleTenantContextResolver(),
    )
    tenant = resolver.resolve(
        db=db,
        user_id=identity.user_id,
        claim=identity.verified_tenant_claim,
    )
    return identity.user_id, tenant


@router.get("", response_model=list[DocumentListItem])
def list_documents(
    request: Request,
    response: Response,
    created_by: str | None = Query(default=None, max_length=512, alias="createdBy"),
    cursor: str | None = Query(default=None, max_length=1024),
    limit: int = Query(default=500, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[DocumentListItem]:
    """第2反復: list the tenant's document metadata (canvas list foundation).

    Row metadata only — never card content (the per-document read path is the
    SafeMode-scoped GET /docs/{doc_id}). Payload-independent and tenant-scoped.
    `createdBy` filters to one creator ("my documents").

    SEC-DOC-BOUND-06: `Restricted` documents (and documents with no access
    metadata row at all -- absence defaults to Restricted, mirroring
    ServerOwnedDocumentResourceResolver) are excluded unless the caller
    created them -- but only when a real (non-noop) access_control_adapter
    is configured. The default adapter (no adapter configured at all, or the
    "noop" name) always allows GET/PUT /docs/{doc_id} regardless of
    visibility -- apply_tenant_boundary_guard is the sole gate in that mode.
    Filtering the list by visibility there would make the list *more*
    restrictive than the single-document read path it is a foundation for,
    not more correct. This is a local, conservative filter on the
    already-stored `visibility` column -- it does not consult the external
    PDP, so it is not a substitute for precise per-grantee authorization.
    `Public`/`Unlisted`/`Org` need no further check: `Org`'s meaning
    ("visible within the tenant") is already satisfied by the tenant
    scoping below.

    SEC-DOC-BOUND-05: keyset pagination. `limit` (1..500, default 500) bounds
    the response; when more rows follow, `X-Next-Cursor` carries the opaque
    `"{updated_at}:{id}"` cursor for the next page. The response stays a bare
    array, so existing clients are unaffected.
    """
    requesting_user_id, tenant = _resolve_request_identity_and_tenant(request=request, db=db)
    adapter = getattr(request.app.state, "access_control_adapter", None)
    adapter_is_real = adapter is not None and getattr(adapter, "name", None) != "noop"
    items, has_more = DatabaseDocumentContentStore(db).list_documents(
        tenant=tenant,
        created_by=created_by,
        cursor=cursor,
        limit=limit,
        requesting_user_id=requesting_user_id if adapter_is_real else None,
        apply_visibility_filter=adapter_is_real,
    )
    if has_more and items:
        # SEC-DOC-BOUND-05: updated_at is ISO (contains colons), so URL-encode
        # it; the repository decodes it. The id half stays raw.
        response.headers["X-Next-Cursor"] = f"{quote(items[-1].updated_at)}:{items[-1].id}"
    return items


def _transition_lifecycle(request: Request, db: Session, doc_id: str, state: Literal["active", "archived"]) -> Response:
    # SEC-DOC-BOUND-06: archive/unarchive is a write-equivalent operation (it
    # locks/unlocks PUT via the ADR-0073 D2=A 423 gate) and must pass the same
    # capability check PUT does. It must not rely on tenant match alone.
    _, _, tenant = _authorize_request(
        request,
        db,
        action="write",
        doc_id=doc_id,
        safe_mode=False,
        read_only=False,
    )
    changed = DatabaseDocumentContentStore(db).set_lifecycle_state(tenant=tenant, doc_id=doc_id, state=state)
    if not changed:
        raise HTTPException(status_code=404, detail="Document not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{doc_id}/archive", status_code=status.HTTP_204_NO_CONTENT)
def archive_document(
    doc_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    """ADR-0073 D2=A: mark the document archived (canvas list management)."""
    return _transition_lifecycle(request, db, doc_id, "archived")


@router.post("/{doc_id}/unarchive", status_code=status.HTTP_204_NO_CONTENT)
def unarchive_document(
    doc_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    """ADR-0073 D2=A: return the document to active."""
    return _transition_lifecycle(request, db, doc_id, "active")


@router.get("/{doc_id}", response_model=DocumentPayload)
def get_document(
    doc_id: str,
    response: Response,
    request: Request,
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> DocumentPayload:
    access_request, decision, tenant = _authorize_request(
        request,
        db,
        action="read",
        doc_id=doc_id,
        safe_mode=True,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )

    stored_document = DatabaseDocumentContentStore(db).load(tenant=tenant, doc_id=doc_id)
    if stored_document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    doc_row = stored_document.row
    response.headers["ETag"] = _format_etag(_compute_etag(doc_row.payload_json))
    payload = json.loads(stored_document.content.text)

    dispatcher = getattr(request.app.state, "audit_dispatcher", None)
    if dispatcher is not None:
        dispatcher.emit(
            build_event(
                event_type="view",
                tenant_id=tenant.tenant_id,
                doc_id=doc_id,
                safe_mode=True,
                actor_ref=request.headers.get("x-actor-ref"),
                metadata={
                    "route": f"/docs/{doc_id}",
                    "method": "GET",
                    "action": access_request.action,
                    "decision_allow": decision.allow,
                    "decision_read_only": decision.read_only,
                    "decision_reason": decision.reason,
                    "visibility": access_request.resource.visibility,
                    "policyRefPresent": access_request.resource.policy_ref is not None,
                    "adapterName": getattr(
                        getattr(request.app.state, "access_control_adapter", None), "name", "none"
                    ),
                    "traceId": access_request.auth.trace_id,
                    **build_auth_assurance_metadata(access_request.auth),
                },
            )
        )

    # DOGFOOD-02: read path must enforce the A1 contract the same way PUT
    # does. A stored doc with version != 1 otherwise fails raw pydantic
    # validation as a 500; here it becomes a structured 422
    # (A1_SCHEMA_VERSION_MISMATCH) with no stack-trace leak.
    return _validate_document_payload_with_a1_contract(payload)


def _document_precondition_error(*, status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


def _require_saas_document_precondition(
    *,
    if_match: str | None,
    if_none_match: str | None,
    document_exists: bool,
) -> None:
    if if_match is not None and if_none_match is not None:
        raise _document_precondition_error(
            status_code=400,
            code="document_precondition_conflict",
            message="If-Match and If-None-Match are mutually exclusive.",
        )
    if if_none_match is not None:
        if if_none_match.strip() != "*":
            raise _document_precondition_error(
                status_code=400,
                code="document_precondition_invalid",
                message="If-None-Match must be '*' for create.",
            )
        if document_exists:
            raise _document_precondition_error(
                status_code=409,
                code="document_already_exists",
                message="Document already exists.",
            )
        return
    if if_match is None:
        raise _document_precondition_error(
            status_code=428,
            code="document_precondition_required",
            message="If-Match (update) or If-None-Match: * (create) is required.",
        )
    if "*" in _parse_if_match(if_match):
        raise _document_precondition_error(
            status_code=428,
            code="document_precondition_required",
            message="A wildcard If-Match cannot bypass the revision check.",
        )


@router.put("/{doc_id}", response_model=DocumentPayload)
def put_document(
    doc_id: str,
    response: Response,
    request: Request,
    document_payload: object = Body(...),
    if_match: str | None = Header(default=None, alias="If-Match"),
    if_none_match: str | None = Header(default=None, alias="If-None-Match"),
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> DocumentPayload:
    document = _validate_document_payload_with_a1_contract(document_payload)
    access_request, _, tenant = _authorize_request(
        request,
        db,
        action="write",
        doc_id=doc_id,
        safe_mode=True,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )

    if document.id != doc_id:
        raise HTTPException(status_code=400, detail="Path doc_id and document.id must match")

    _validate_review_attribution_identity(document=document, identity=access_request.auth)

    # SEC-DOC-BOUND-01: bound card count (secondary to the byte ceiling below).
    # Generous default; realistic KJ canvases are tens to low hundreds of cards.
    if len(document.cards) > settings.max_document_cards:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "document_too_many_cards",
                "message": f"Document exceeds the card count limit of {settings.max_document_cards}.",
            },
        )

    payload_json = document.model_dump_json()
    if len(payload_json.encode("utf-8")) > settings.max_document_bytes:
        raise HTTPException(
            status_code=413,
            detail={
                "code": "document_too_large",
                "message": f"Document exceeds the storage size limit of {settings.max_document_bytes} bytes.",
            },
        )
    doc_row = get_document_row(
        db,
        tenant=tenant,
        doc_id=doc_id,
    )

    # ADR-0073 D2=A enforcement (第2反復): an archived document is read-only.
    # Fail-closed regardless of ETag -- archive is a lifecycle gate, so the
    # document content must not be mutable until unarchived. Audit/derived
    # writes (context-audit, merge-decision-logs, ...) stay allowed: they do
    # not mutate the document payload and archived docs remain reviewable.
    if doc_row is not None and doc_row.lifecycle_state == "archived":
        raise HTTPException(
            status_code=423,
            detail={
                "code": "document_archived",
                "message": "Document is archived and cannot be modified.",
            },
        )

    if tenant_session_precondition_required(request):
        # ADR-0092: the shared SaaS profile never overwrites silently. An update
        # carries a concrete If-Match revision; a create carries If-None-Match: *.
        # The single-tenant profiles keep the documented last-write-wins path.
        _require_saas_document_precondition(
            if_match=if_match,
            if_none_match=if_none_match,
            document_exists=doc_row is not None,
        )

    if if_match is not None:
        if doc_row is None:
            raise HTTPException(status_code=409, detail="ETag mismatch")

        current_etag = _compute_etag(doc_row.payload_json)
        expected_etags = _parse_if_match(if_match)
        if "*" not in expected_etags and current_etag not in expected_etags:
            raise HTTPException(status_code=409, detail="ETag mismatch")

    try:
        # ADR-0073 D1=C: the creator is recorded on creation as an immutable
        # fact (never overwritten on update). NULL when no identity is present
        # (D3=A: migrated docs stay "unknown").
        DatabaseDocumentContentStore(db).save(
            tenant=tenant,
            doc_id=doc_id,
            version=document.version,
            updated_at=document.updatedAt.isoformat(),
            content=ContentBlob.from_text(payload_json),
            created_by=access_request.auth.user_id,
        )
        db.commit()
    except (IntegrityError, RevisionHeadConflict) as error:
        db.rollback()
        raise HTTPException(status_code=409, detail="Document changed concurrently") from error
    response.headers["ETag"] = _format_etag(_compute_etag(payload_json))
    return document


class ExportAuditPayload(BaseModel):
    safeMode: bool = True
    exportKind: str = "bundle"
    # 書き出し1回ごとの識別子（クライアント生成）。同じ exportId の再送だけを重複とみなす。
    # 省略時（古いクライアント）は重複抑止をせず、記録を落とさない。
    exportId: str | None = Field(
        default=None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    )


class ContextAuditPayload(BaseModel):
    operation: Literal["query", "bundle", "proposal", "apply"]
    safeMode: bool = True
    equivalenceKey: str = Field(pattern=r"^[0-9a-f]{64}$")
    bundleHash: str = Field(pattern=r"^[0-9a-f]{64}$")
    sourceBundleHash: str | None = Field(
        default=None, pattern=r"^(?:[0-9a-f]{64}|mock:[0-9a-f]{64})$"
    )
    queryHash: str | None = None
    dryRun: bool = True
    sideEffect: Literal["none"] = "none"
    rejectReasonCode: (
        Literal[
            "none",
            "missing_event",
            "equivalence_mismatch",
            "dry_run_side_effect",
            "safemode_regression",
        ]
        | None
    ) = None
    command: str
    channel: Literal["api", "cli", "gui", "mcp"] = "api"
    schemaVersion: Literal["ce4.audit.v1"] = "ce4.audit.v1"


_CE4_OPERATION_TO_COMMANDS: dict[str, set[str]] = {
    "query": {"context-query"},
    "bundle": {"context-bundle"},
    "proposal": {"proposal-diff"},
    "apply": {"apply --dry-run"},
}
_CE4_REQUIRED_EVENT_SET = frozenset({"query", "bundle", "proposal", "apply"})


def _ce4_validation_error(code: str, message: str) -> HTTPException:
    return HTTPException(status_code=422, detail={"code": code, "message": message})


class _Ce4AuditTrackerState(BaseModel):
    seen_operations: set[str] = Field(default_factory=set)
    proposal_source_bundle_hash: str | None = None
    # DX-BACKEND-CE4-01: last event timestamp so the tracker can evict stale
    # entries instead of growing for the process lifetime.
    last_touched: float = Field(default_factory=time.time)


_ce4_audit_event_tracker: dict[tuple[str, str, str, str], _Ce4AuditTrackerState] = {}
_ce4_audit_tracker_lock = Lock()
# DX-BACKEND-CE4-01 (option a adopted): a CE4 sequence (query -> bundle ->
# proposal -> apply) completes within a single work session, so a 24h TTL is
# far longer than any legitimate in-flight sequence. The LRU cap bounds memory
# even under sustained load. Both are generous enough not to false-trigger the
# `missing_event` completeness check for real workflows.
_CE4_TRACKER_TTL_SECONDS = 24 * 60 * 60
_CE4_TRACKER_MAX_ENTRIES = 10_000
_ce4_eviction_counter = 0


def reset_ce4_audit_event_tracker() -> None:
    with _ce4_audit_tracker_lock:
        _ce4_audit_event_tracker.clear()


def _evict_stale_ce4_tracker_entries(now: float) -> None:
    stale = [
        key
        for key, state in _ce4_audit_event_tracker.items()
        if now - state.last_touched > _CE4_TRACKER_TTL_SECONDS
    ]
    for key in stale:
        del _ce4_audit_event_tracker[key]
    while len(_ce4_audit_event_tracker) > _CE4_TRACKER_MAX_ENTRIES:
        oldest_key = min(_ce4_audit_event_tracker, key=lambda k: _ce4_audit_event_tracker[k].last_touched)
        del _ce4_audit_event_tracker[oldest_key]


def _record_ce4_event_and_validate_completeness(
    *,
    tenant_id: str,
    doc_id: str,
    equivalence_key: str,
    bundle_hash: str,
    operation: str,
    source_bundle_hash: str | None,
) -> None:
    global _ce4_eviction_counter
    with _ce4_audit_tracker_lock:
        tracker_key = (tenant_id, doc_id, equivalence_key, bundle_hash)
        state = _ce4_audit_event_tracker.setdefault(tracker_key, _Ce4AuditTrackerState())
        # DX-BACKEND-CE4-01: bounded eviction, amortized over every 256 events
        # so the O(n) sweep does not run on the hot path.
        if _ce4_eviction_counter % 256 == 0:
            _evict_stale_ce4_tracker_entries(time.time())
        _ce4_eviction_counter += 1
        state.last_touched = time.time()
        state.seen_operations.add(operation)
        if operation == "proposal":
            state.proposal_source_bundle_hash = source_bundle_hash
        if operation == "apply" and state.proposal_source_bundle_hash is not None:
            if state.proposal_source_bundle_hash != source_bundle_hash:
                logger.warning(
                    "CE4 audit equivalence mismatch detected",
                    extra={
                        "equivalence_key": equivalence_key,
                        "bundle_hash": bundle_hash,
                        "expected_source_bundle_hash": state.proposal_source_bundle_hash,
                        "provided_source_bundle_hash": source_bundle_hash,
                    },
                )
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "equivalence_mismatch",
                        "message": "sourceBundleHash must match the prior proposal event for the same equivalenceKey and bundleHash",
                    },
                )
        if operation != "apply":
            return
        missing = sorted(_CE4_REQUIRED_EVENT_SET - state.seen_operations)
    if missing:
        logger.warning(
            "CE4 audit event set incomplete for apply operation",
            extra={
                "equivalence_key": equivalence_key,
                "bundle_hash": bundle_hash,
                "missing_events": missing,
            },
        )
        raise HTTPException(
            status_code=409,
            detail={
                "code": "missing_event",
                "message": "CE4 audit event set is incomplete for apply operation",
                "missingEvents": missing,
            },
        )


@router.post("/{doc_id}/context-audit")
def post_context_audit(
    doc_id: str,
    payload: ContextAuditPayload,
    request: Request,
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    access_request, decision, tenant = _authorize_request(
        request,
        db,
        action="read",
        doc_id=doc_id,
        safe_mode=payload.safeMode,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )

    if payload.queryHash is not None and payload.queryHash != payload.equivalenceKey:
        raise _ce4_validation_error(
            "query_hash_mismatch", "queryHash must equal equivalenceKey for CE4 equivalence checks"
        )
    if payload.operation in {"proposal", "apply"} and payload.sourceBundleHash is None:
        raise _ce4_validation_error(
            "missing_source_bundle_hash",
            "sourceBundleHash is required for proposal/apply operations",
        )
    if payload.operation == "apply" and not payload.dryRun:
        raise _ce4_validation_error(
            "apply_requires_dry_run", "CE4 apply operation requires dryRun=true"
        )
    if (
        settings.ce4_dry_run_enforce_no_side_effect
        and payload.dryRun
        and payload.sideEffect != "none"
    ):
        raise _ce4_validation_error(
            "dry_run_side_effect_mismatch", "dryRun=true requires sideEffect=none"
        )
    if (
        payload.sourceBundleHash is not None
        and payload.sourceBundleHash.startswith("mock:")
        and not settings.ce4_source_bundle_hash_allow_mock
    ):
        raise _ce4_validation_error(
            "mock_source_bundle_hash_disabled",
            "mock sourceBundleHash is disabled by CE4 runtime policy",
        )
    if payload.command not in _CE4_OPERATION_TO_COMMANDS[payload.operation]:
        raise _ce4_validation_error(
            "operation_command_mismatch",
            f"command '{payload.command}' is invalid for operation '{payload.operation}'",
        )
    if settings.ce4_audit_require_all_events:
        _record_ce4_event_and_validate_completeness(
            tenant_id=tenant.tenant_id,
            doc_id=doc_id,
            equivalence_key=payload.equivalenceKey,
            bundle_hash=payload.bundleHash,
            operation=payload.operation,
            source_bundle_hash=payload.sourceBundleHash,
        )

    dispatcher = getattr(request.app.state, "audit_dispatcher", None)
    if dispatcher is not None:
        dispatcher.emit(
            build_event(
                event_type=payload.operation,
                tenant_id=tenant.tenant_id,
                doc_id=doc_id,
                safe_mode=payload.safeMode,
                actor_ref=request.headers.get("x-actor-ref"),
                metadata={
                    "route": f"/docs/{doc_id}/context-audit",
                    "method": "POST",
                    "action": access_request.action,
                    "decision_allow": decision.allow,
                    "decision_read_only": decision.read_only,
                    "decision_reason": decision.reason,
                    "visibility": access_request.resource.visibility,
                    "policyRefPresent": access_request.resource.policy_ref is not None,
                    "adapterName": getattr(
                        getattr(request.app.state, "access_control_adapter", None), "name", "none"
                    ),
                    "traceId": access_request.auth.trace_id,
                    "operation": payload.operation,
                    "equivalenceKey": payload.equivalenceKey,
                    "bundleHash": payload.bundleHash,
                    "sourceBundleHash": payload.sourceBundleHash,
                    "queryHash": payload.queryHash,
                    "dryRun": payload.dryRun,
                    "sideEffect": payload.sideEffect,
                    "rejectReasonCode": payload.rejectReasonCode,
                    "command": payload.command,
                    "channel": payload.channel,
                    "schemaVersion": payload.schemaVersion,
                    **build_auth_assurance_metadata(access_request.auth),
                },
            ),
            # SEC-AUDIT-DUP-01: the logical identity of the operation, so a
            # client retry of the identical CE4 event is not double-counted at
            # the external audit sink within the dedup window.
            dedup_key=(
                "context-audit",
                tenant.tenant_id,
                doc_id,
                payload.operation,
                payload.equivalenceKey,
                payload.bundleHash,
            ),
        )

    return {"status": "accepted"}


@router.post("/{doc_id}/export-audit")
def post_export_audit(
    doc_id: str,
    payload: ExportAuditPayload,
    request: Request,
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    access_request, decision, tenant = _authorize_request(
        request,
        db,
        action="export",
        doc_id=doc_id,
        safe_mode=payload.safeMode,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )
    dispatcher = getattr(request.app.state, "audit_dispatcher", None)
    if dispatcher is not None:
        dispatcher.emit(
            build_event(
                event_type="export",
                tenant_id=tenant.tenant_id,
                doc_id=doc_id,
                safe_mode=payload.safeMode,
                actor_ref=request.headers.get("x-actor-ref"),
                metadata={
                    "route": f"/docs/{doc_id}/export-audit",
                    "method": "POST",
                    "exportKind": payload.exportKind,
                    "action": access_request.action,
                    "decision_allow": decision.allow,
                    "decision_read_only": decision.read_only,
                    "decision_reason": decision.reason,
                    "visibility": access_request.resource.visibility,
                    "policyRefPresent": access_request.resource.policy_ref is not None,
                    "adapterName": getattr(
                        getattr(request.app.state, "access_control_adapter", None), "name", "none"
                    ),
                    "traceId": access_request.auth.trace_id,
                    **build_auth_assurance_metadata(access_request.auth),
                },
            ),
            # SEC-AUDIT-DUP-01: only a repeat of the same exportId (a retry of one
            # export) is suppressed within the dedup window. Each export carries
            # its own exportId, so distinct exports of the same kind are all
            # recorded. Without exportId (older clients) no dedup is applied, so
            # a record is not dropped for lack of an identity.
            dedup_key=(
                (
                    "export-audit",
                    tenant.tenant_id,
                    doc_id,
                    payload.exportKind,
                    payload.exportId,
                )
                if payload.exportId is not None
                else None
            ),
        )

    return {"status": "accepted"}


class MergeDecisionLogAppendPayload(BaseModel):
    record: MergeDecisionRecord


@router.post("/{doc_id}/merge-decision-logs", response_model=MergeDecisionRecord, status_code=201)
def append_merge_decision_log(
    doc_id: str,
    payload: MergeDecisionLogAppendPayload,
    request: Request,
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> MergeDecisionRecord:
    _, _, tenant = _authorize_request(
        request,
        db,
        action="write",
        doc_id=doc_id,
        safe_mode=True,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )

    if (
        get_document_row(
            db,
            tenant=tenant,
            doc_id=doc_id,
        )
        is None
    ):
        raise HTTPException(status_code=404, detail="Document not found")

    record = payload.record
    DatabaseAppendOnlyLogContentStore(db).append(
        tenant=tenant,
        doc_id=doc_id,
        decision_id=record.decisionId,
        group_id=record.groupId,
        snapshot_version=record.snapshotVersion,
        decided_at=record.decidedAt.isoformat(),
        content=ContentBlob.from_text(record.model_dump_json()),
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Merge decision already exists") from exc

    return record


@router.get(
    "/{doc_id}/merge-decision-logs/by-group/{group_id}", response_model=list[MergeDecisionRecord]
)
def list_merge_decision_logs_by_group(
    doc_id: str,
    group_id: str,
    request: Request,
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> list[MergeDecisionRecord]:
    _, _, tenant = _authorize_request(
        request,
        db,
        action="read",
        doc_id=doc_id,
        safe_mode=True,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )

    if (
        get_document_row(
            db,
            tenant=tenant,
            doc_id=doc_id,
        )
        is None
    ):
        raise HTTPException(status_code=404, detail="Document not found")

    rows = list_merge_log_rows_by_group(
        db,
        tenant=tenant,
        doc_id=doc_id,
        group_id=group_id,
    )
    return [MergeDecisionRecord.model_validate(json.loads(row.payload_json)) for row in rows]


@router.get(
    "/{doc_id}/merge-decision-logs/restore/{snapshot_version}",
    response_model=list[MergeDecisionRecord],
)
def restore_merge_decision_logs(
    doc_id: str,
    snapshot_version: str,
    request: Request,
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> list[MergeDecisionRecord]:
    _, _, tenant = _authorize_request(
        request,
        db,
        action="read",
        doc_id=doc_id,
        safe_mode=True,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )

    if (
        get_document_row(
            db,
            tenant=tenant,
            doc_id=doc_id,
        )
        is None
    ):
        raise HTTPException(status_code=404, detail="Document not found")

    rows = list_merge_log_rows_by_snapshot(
        db,
        tenant=tenant,
        doc_id=doc_id,
        snapshot_version=snapshot_version,
    )
    return [MergeDecisionRecord.model_validate(json.loads(row.payload_json)) for row in rows]


@router.get("/{doc_id}/similar-candidate-groups", response_model=CandidateListViewModel)
def get_similar_candidate_groups(
    doc_id: str,
    request: Request,
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> CandidateListViewModel:
    _, _, tenant = _authorize_request(
        request,
        db,
        action="read",
        doc_id=doc_id,
        safe_mode=True,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )

    doc_row = get_document_row(
        db,
        tenant=tenant,
        doc_id=doc_id,
    )
    if doc_row is None:
        raise HTTPException(status_code=404, detail="Document not found")

    document = document_payload_adapter.validate_python(json.loads(doc_row.payload_json))
    return _build_similar_candidate_groups(document, payload_json=doc_row.payload_json)


@router.post(
    "/{doc_id}/polygon-handoff/verify-contract",
    response_model=PolygonHandoffContractVerificationResponse,
)
def verify_polygon_handoff_contract(
    doc_id: str,
    payload: PolygonHandoffContractVerificationRequest,
    request: Request,
    x_read_only: str | None = Header(default=None, alias="X-Read-Only"),
    db: Session = Depends(get_db),
) -> PolygonHandoffContractVerificationResponse:
    _, _, tenant = _authorize_request(
        request,
        db,
        action="read",
        doc_id=doc_id,
        safe_mode=True,
        read_only=(x_read_only == "1" or (x_read_only or "").lower() == "true"),
    )

    if (
        get_document_row(
            db,
            tenant=tenant,
            doc_id=doc_id,
        )
        is None
    ):
        raise HTTPException(status_code=404, detail="Document not found")

    failure_reasons, status = _evaluate_polygon_handoff_rollback(payload)

    verification_key = sha256(
        f"{payload.input.inputHash}:{payload.expectedOutput.outputPolygonHash}".encode("utf-8")
    ).hexdigest()

    return PolygonHandoffContractVerificationResponse(
        status=status,
        rollbackRequired=bool(failure_reasons),
        failureReasons=failure_reasons,
        verificationKey=verification_key,
    )


def _evaluate_polygon_handoff_rollback(
    payload: PolygonHandoffContractVerificationRequest,
) -> tuple[list[str], Literal["ok", "rollback_required"]]:
    expected_output = payload.expectedOutput
    failure_reasons: list[str] = []
    if expected_output.paddingViolationCount > 0:
        failure_reasons.append("paddingViolationCount>0")

    tie_break_order_changed = expected_output.tieBreakOrderChanged
    if expected_output.tieBreakOrder is not None:
        tie_break_order_changed = (
            tuple(expected_output.tieBreakOrder) != payload.input.deterministicTieBreakOrder
        )

    if tie_break_order_changed:
        failure_reasons.append("tieBreakOrderChanged=true")
    if failure_reasons:
        return failure_reasons, "rollback_required"
    return failure_reasons, "ok"
