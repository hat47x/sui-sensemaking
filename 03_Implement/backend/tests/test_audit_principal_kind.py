"""監査eventの主体の区分（principalKind）。"""

import pytest
from pydantic import ValidationError

from sui_sensemaking_api.audit import build_event


def _event(**extra):
    return build_event(event_type="view", tenant_id="t", doc_id="d", safe_mode=True, **extra)


def test_principal_kind_is_recorded_when_given_and_absent_otherwise() -> None:
    assert _event(actor_ref="agent:a", principal_kind="agent").principalKind == "agent"
    assert _event(actor_ref="u").principalKind is None


def test_principal_kind_accepts_only_known_kinds() -> None:
    with pytest.raises(ValidationError):
        _event(principal_kind="robot")  # type: ignore[arg-type]
