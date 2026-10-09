from __future__ import annotations

from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _script_directory() -> ScriptDirectory:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return ScriptDirectory.from_config(cfg)


def test_alembic_has_single_head() -> None:
    script = _script_directory()
    heads = script.get_heads()

    assert heads == ["20261009_0037"], (
        "alembic migration graph must stay linear to avoid stream-merge conflicts: "
        f"unexpected heads={heads}"
    )


def test_auth_identity_migration_is_in_mainline_history() -> None:
    script = _script_directory()

    history_ids = [
        revision.revision for revision in script.walk_revisions(base="base", head="heads")
    ]

    assert "20260303_0002" in history_ids
    assert "20260314_0005" in history_ids
    assert "20260716_0006" in history_ids
    assert "20260717_0007" in history_ids
    assert "20260717_0008" in history_ids
    assert "20260717_0009" in history_ids
    assert "20260717_0010" in history_ids
    assert "20260717_0011" in history_ids
    assert "20260720_0012" in history_ids
    assert "20260906_0033" in history_ids
    assert "20260906_0034" in history_ids
    assert "20260907_0035" in history_ids
    assert "20261009_0036" in history_ids
    assert "20261009_0037" in history_ids
    assert (
        history_ids.index("20261009_0037")
        < history_ids.index("20261009_0036")
        < history_ids.index("20260907_0035")
        < history_ids.index("20260906_0034")
        < history_ids.index("20260906_0033")
        < history_ids.index("20260720_0012")
        < history_ids.index("20260717_0011")
        < history_ids.index("20260717_0010")
        < history_ids.index("20260717_0009")
        < history_ids.index("20260717_0008")
        < history_ids.index("20260717_0007")
        < history_ids.index("20260716_0006")
        < history_ids.index("20260314_0005")
        < history_ids.index("20260303_0002")
        < history_ids.index("20260211_0001")
    )
