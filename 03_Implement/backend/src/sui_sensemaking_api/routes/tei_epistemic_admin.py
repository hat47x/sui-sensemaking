"""Control-plane surface for locally produced TEI Reference artifacts.

ADR-0101 rejected sending the observed snapshots across an external boundary
and adopted Option A: read the TEI Reference CLI / JSON artifacts through
local I/O inside the trust domain. The artifact content is operator-level
corpus material, so it is served **only on the control plane**

- authorized by `require_control_plane_authorization` (ADR-0072: `X-Admin-Api-Key`
  or a provision capability; the business-plane `X-API-Key` is never enough),
- disabled by default: an unconfigured `SUI_TEI_REFERENCE_DIR` fails closed
  with 503 `tei_reference_unconfigured`,
- never interprets the payload. Contract/schema validation and drift
  recomputation stay in the frontend consumer (`epistemic_review_model.ts`,
  `epistemic_projection_adapter.ts`), and the route returns the artifact
  verbatim with `Cache-Control: no-store`.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response

from sui_sensemaking_api.control_plane_auth import require_control_plane_authorization
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tei_reference_transport import (
    TeiReferenceReadFailure,
    read_tei_reference_artifact,
)

router = APIRouter(prefix="/admin/tei-epistemic", tags=["admin"])

#: `unknown-artifact` and `invalid-path` answer 404 (the requested kind stays
#: unidentified); every other reason is a provider-side failure answered by 503
#: without any artifact content. The body shape stays identical across all
#: failures so the reason remains observable to an operator without leaking
#: content.
_PROVIDER_FAILURE_CODES = {
    "unconfigured": ("tei_reference_unconfigured", 503),
    "not-a-file": ("tei_reference_unavailable", 503),
    "invalid-json": ("tei_reference_unavailable", 503),
    "not-an-object": ("tei_reference_unavailable", 503),
    "invalid-path": ("tei_reference_unavailable", 503),
    "unknown-artifact": ("unknown_tei_artifact", 404),
}


@router.get(
    "/artifacts/{artifact_kind}",
    dependencies=[Depends(require_control_plane_authorization)],
)
def get_tei_reference_artifact(artifact_kind: str, response: Response) -> dict[str, Any]:
    result = read_tei_reference_artifact(settings.tei_reference_dir, artifact_kind)
    if isinstance(result, TeiReferenceReadFailure):
        code, status_code = _PROVIDER_FAILURE_CODES[result.reason]
        raise HTTPException(
            status_code=status_code,
            detail={
                "code": code,
                "message": "TEI reference artifacts are not available.",
            },
        )
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True, "artifact": result.payload}
