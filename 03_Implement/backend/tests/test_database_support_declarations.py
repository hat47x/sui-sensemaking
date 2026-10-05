from __future__ import annotations

import re
from pathlib import Path

from sui_sensemaking_api.database_support import (
    registered_database_support,
    verified_database_backends,
)
from sqlalchemy.engine import make_url


REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "03_Implement" / "backend"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
RELEASE_DOC = REPO_ROOT / "04_Documentation" / "release.md"


def _optional_ci_workflow_text() -> str | None:
    if CI_WORKFLOW.is_file():
        return CI_WORKFLOW.read_text(encoding="utf-8")
    release = RELEASE_DOC.read_text(encoding="utf-8")
    assert "常設CIは現在無効" in release
    return None


def test_verified_backend_message_order_comes_from_registry() -> None:
    registered = registered_database_support()

    assert verified_database_backends() == tuple(
        support.backend for support in registered if support.is_verified
    )


def test_every_external_verified_backend_declares_driver_and_real_db_marker() -> None:
    supports = registered_database_support()

    for support in supports:
        if support.backend == "sqlite":
            assert support.optional_dependency is None
            assert support.test_marker is None
            continue
        assert support.optional_dependency is not None, support.backend
        assert support.test_marker is not None, support.backend
        assert support.ci_image is not None, support.backend


def test_every_backend_declares_a_consistent_verified_driver_contract() -> None:
    for support in registered_database_support():
        assert support.sync_drivername in support.accepted_drivernames
        assert len(set(support.accepted_drivernames)) == len(support.accepted_drivernames)
        for drivername in support.accepted_drivernames:
            assert make_url(f"{drivername}://").get_backend_name() == support.backend


def test_every_verified_backend_declares_an_executable_recovery_test() -> None:
    for support in registered_database_support():
        if not support.is_verified:
            continue
        recovery_path = BACKEND_ROOT / support.recovery_test
        assert recovery_path.is_file(), support.backend
        source = recovery_path.read_text(encoding="utf-8")
        assert "restore" in source.lower(), support.backend
        if support.test_marker is not None:
            assert f"@pytest.mark.{support.test_marker}" in source, support.backend


def test_driver_extras_markers_tests_and_optional_ci_stay_synchronized() -> None:
    pyproject = (BACKEND_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    workflow = _optional_ci_workflow_text()
    test_sources = "\n".join(
        path.read_text(encoding="utf-8")
        for path in (BACKEND_ROOT / "tests").glob("test_*.py")
    )
    dependencies = {
        support.optional_dependency
        for support in registered_database_support()
        if support.optional_dependency is not None
    }
    markers = {
        support.test_marker
        for support in registered_database_support()
        if support.test_marker is not None
    }

    for dependency in dependencies:
        assert re.search(rf"(?m)^{re.escape(dependency)}\s*=\s*\[", pyproject)
        if workflow is not None:
            assert re.search(
                rf'pip install -e "\.\[[^\]]*\b{re.escape(dependency)}\b',
                workflow,
            )
    for marker in markers:
        assert f'"{marker}: tests that require ' in pyproject
        assert f"@pytest.mark.{marker}" in test_sources
        if workflow is not None:
            assert re.search(
                rf"pytest -m ['\"]?{re.escape(marker)}(?:['\"]|\s|$)",
                workflow,
            )


def test_canonical_support_matrix_lists_every_registered_backend_once() -> None:
    matrix = (REPO_ROOT / "02_Architecture" / "database_portability.md").read_text(
        encoding="utf-8"
    )

    for support in registered_database_support():
        rows = re.findall(
            rf"(?m)^\|\s*{re.escape(support.verification_target)}\s*\|\s*"
            rf"{re.escape(support.backend)}\s*\|\s*"
            rf"{re.escape(support.family)}\s*\|\s*{support.support_level.title()}\s*\|",
            matrix,
        )
        assert len(rows) == 1, support.backend


def test_every_external_verified_backend_ci_image_contract_is_unambiguous() -> None:
    workflow = _optional_ci_workflow_text()
    images = [
        support.ci_image
        for support in registered_database_support()
        if support.ci_image is not None
    ]
    assert len(images) == len(set(images))

    if workflow is not None:
        for support in registered_database_support():
            if support.ci_image is not None:
                assert workflow.count(support.ci_image) == 1, support.backend
