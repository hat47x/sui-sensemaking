"""Tenant-plane surface for TEI epistemic projection (ADR-0102 案B, adopted).

ADR-0102 decided to expose TEI epistemic projection on the tenant business
plane through per-document bindings recorded by the operator. This route
implements that decision with the smallest reversible surface:

- authorization reuses `_authorize_request`: tenant session, guest session,
  access-control adapter, policy binding, anti-enumeration. Agent credentials
  are not in `_AGENT_ALLOWED_ROUTES`, so they get
  `403 agent_route_not_enabled`.
- the binding registry and the artifact are read through the fail-closed local
  I/O transport (ADR-0101 Option A). No artifact content is ever returned on
  a failure.
- the artifact is read from the bound pair's own directory
  (`tenants/<tenantId>/<docId>/`), never from the operator-level corpus files,
  so one tenant cannot receive an artifact produced for another.
- read-only: no write to confirmation / use state / `human_reviewed`.
- read path only; audit is left to the existing document view audit (not
  duplicated here).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.routes.docs import _authorize_request
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tei_reference_transport import (
    TeiReferenceReadFailure,
    read_bound_tei_reference_artifact,
    read_tei_epistemic_binding,
)
from sui_sensemaking_api.tei_sui_reference import (
    REFERENCE_SCHEMA,
    SuiReferenceDisclosureRestricted,
    SuiReferenceError,
    SuiReferenceSourceUnavailable,
    build_sui_reference,
)

router = APIRouter(prefix="/docs", tags=["docs"])


def _failure_code(reason: str) -> tuple[str, int]:
    if reason == "unconfigured":
        return "tei_reference_unconfigured", 503
    if reason in {"binding-registry-missing", "binding-registry-invalid"}:
        return "tei_reference_unavailable", 503
    if reason in {"no-binding", "ambiguous-binding", "unknown-bound-artifact"}:
        return "epistemic_binding_not_found", 404
    if reason == "unknown-artifact":
        return "unknown_tei_artifact", 404
    return "tei_reference_unavailable", 503


def _authorize_tenant_document(request: Request, db: Session, doc_id: str):
    access_request, decision, tenant = _authorize_request(
        request=request,
        db=db,
        action="read",
        doc_id=doc_id,
        safe_mode=True,
        read_only=True,
    )
    if access_request.auth.provider == "agent_credential":
        # #3296 / ADR-0093追記: keep these routes closed to agent credentials even
        # if a future change to _AGENT_ALLOWED_ROUTES would otherwise reach the
        # binding lookup. The response must not reveal whether a binding exists.
        raise HTTPException(
            status_code=403,
            detail={
                "code": "agent_route_not_enabled",
                "message": "This route is not available to agent credentials.",
            },
        )
    return tenant


@router.get("/{doc_id}/epistemic/projection")
def get_document_epistemic_projection(
    doc_id: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    tenant = _authorize_tenant_document(request, db, doc_id)

    binding = read_tei_epistemic_binding(
        settings.tei_reference_dir, tenant.tenant_id, doc_id
    )
    if isinstance(binding, TeiReferenceReadFailure):
        code, status_code = _failure_code(binding.reason)
        raise HTTPException(
            status_code=status_code,
            detail={"code": code, "message": "TEI epistemic projection is not available."},
        )

    artifact = read_bound_tei_reference_artifact(
        settings.tei_reference_dir, tenant.tenant_id, doc_id, binding.artifact_kind
    )
    if isinstance(artifact, TeiReferenceReadFailure):
        code, status_code = _failure_code(artifact.reason)
        raise HTTPException(
            status_code=status_code,
            detail={"code": code, "message": "TEI epistemic projection is not available."},
        )

    response.headers["Cache-Control"] = "no-store"
    return {"ok": True, "artifact": artifact.payload}


@router.get("/{doc_id}/tei/sui-reference")
def get_document_sui_reference(
    doc_id: str,
    request: Request,
    response: Response,
    previous_digest: str | None = Query(default=None, min_length=1, max_length=256),
    previous_source_revision: str | None = Query(
        default=None, min_length=1, max_length=256
    ),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """Read a permitted subset of SUI data as typed TEI references.

    The route reuses the same tenant authorization and ADR-0101/0102 local-I/O
    binding as the epistemic projection. It does not return the artifact
    verbatim: the reference envelope carries identities, relation shape,
    review flags, canvas positions, revision fingerprints, and explicit
    losses, but no card/island/document text. A Card reference is therefore
    not a TEI Accepted Meaning.
    """
    tenant = _authorize_tenant_document(request, db, doc_id)

    binding = read_tei_epistemic_binding(
        settings.tei_reference_dir, tenant.tenant_id, doc_id
    )
    if isinstance(binding, TeiReferenceReadFailure):
        code, status_code = _failure_code(binding.reason)
        raise HTTPException(
            status_code=status_code,
            detail={"code": code, "message": "SUI TEI reference is not available."},
        )
    if binding.artifact_kind != "documentv1-projection":
        # Do not reveal which artifact kind is bound: a binding to an
        # epistemic artifact is not a SUI data reference.
        raise HTTPException(
            status_code=404,
            detail={
                "code": "sui_reference_binding_not_found",
                "message": "No SUI reference binding is available for this document.",
            },
        )

    artifact = read_bound_tei_reference_artifact(
        settings.tei_reference_dir,
        tenant.tenant_id,
        doc_id,
        binding.artifact_kind,
    )
    if isinstance(artifact, TeiReferenceReadFailure):
        code, status_code = _failure_code(artifact.reason)
        raise HTTPException(
            status_code=status_code,
            detail={"code": code, "message": "SUI TEI reference is not available."},
        )

    try:
        reference = build_sui_reference(
            artifact.payload,
            previous_digest=previous_digest,
            previous_source_revision=previous_source_revision,
        )
    except SuiReferenceSourceUnavailable as error:
        # The source was revoked or expired. Do not serve a cached reference and
        # do not reveal entity identities.
        code = (
            "sui_reference_source_revoked"
            if error.status == "revoked"
            else "sui_reference_source_expired"
        )
        raise HTTPException(
            status_code=409,
            detail={
                "code": code,
                "message": "The SUI source of this reference is unavailable.",
            },
        )
    except SuiReferenceDisclosureRestricted:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "sui_reference_disclosure_restricted",
                "message": "This reference is outside the permitted disclosure scope.",
            },
        )
    except SuiReferenceError:
        # The artifact was readable JSON but not a SUI reference source. Do
        # not return partial content or the parser message.
        raise HTTPException(
            status_code=503,
            detail={
                "code": "sui_reference_unavailable",
                "message": "SUI TEI reference is not available.",
            },
        )

    response.headers["Cache-Control"] = "no-store"
    response.headers["ETag"] = f'"{reference.revision.document_digest}"'
    response.headers["X-Sui-Reference-Schema"] = REFERENCE_SCHEMA
    return {"ok": True, "reference": reference.as_json()}
