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

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.routes.docs import _authorize_request
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tei_reference_transport import (
    TeiReferenceReadFailure,
    read_bound_tei_reference_artifact,
    read_tei_epistemic_binding,
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


@router.get("/{doc_id}/epistemic/projection")
def get_document_epistemic_projection(
    doc_id: str,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    access_request, decision, tenant = _authorize_request(
        request=request,
        db=db,
        action="read",
        doc_id=doc_id,
        safe_mode=True,
        read_only=True,
    )

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
