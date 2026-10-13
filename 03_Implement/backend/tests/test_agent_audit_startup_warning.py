"""agent を有効にしているのに監査が外部へ出ない構成を、起動時に警告する条件（ADR-0093）。"""

from types import SimpleNamespace

import pytest

from sui_sensemaking_api.agent_credentials import agent_audit_is_not_exported


def _config(**overrides: object) -> SimpleNamespace:
    base = {
        "agent_credential_hash_key": None,
        "agent_oauth_audience": None,
        "audit_export_enabled": False,
        "audit_allow_in_safe_mode": False,
    }
    return SimpleNamespace(**{**base, **overrides})


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({}, False),  # agent を使わないなら警告しない
        ({"agent_credential_hash_key": "k"}, True),
        ({"agent_oauth_audience": "aud"}, True),
        ({"agent_credential_hash_key": "k", "audit_export_enabled": True}, True),
        ({"agent_credential_hash_key": "k", "audit_allow_in_safe_mode": True}, True),
        (
            {
                "agent_credential_hash_key": "k",
                "audit_export_enabled": True,
                "audit_allow_in_safe_mode": True,
            },
            False,
        ),
    ],
)
def test_warns_only_when_agent_is_enabled_and_audit_is_not_fully_exported(overrides, expected):
    assert agent_audit_is_not_exported(_config(**overrides)) is expected
