from __future__ import annotations

import ast
import os
import re
from pathlib import Path

from sui_sensemaking_api.settings import LEGACY_ENV_KEYS, Settings


REPO_ROOT = Path(__file__).resolve().parents[3]
RUNTIME_REGISTRY_DOC = REPO_ROOT / "02_Architecture" / "runtime_parameter_registry.md"
PUBLIC_CONFIGURATION_DOC = REPO_ROOT / "04_Documentation" / "configuration.md"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
RELEASE_DOC = REPO_ROOT / "04_Documentation" / "release.md"
PUBLIC_ENV_CONTRACT_DOCS = [RUNTIME_REGISTRY_DOC, PUBLIC_CONFIGURATION_DOC]
ENV_SCAN_ROOTS = [
    REPO_ROOT / "03_Implement" / "backend",
    REPO_ROOT / "03_Implement" / "frontend" / "src",
    REPO_ROOT / "03_Implement" / "frontend" / "scripts",
    REPO_ROOT / "03_Implement" / "frontend" / "vite.config.ts",
]
IGNORED_SCAN_PARTS = {".venv", "__pycache__", ".pytest_cache", "node_modules", "dist"}
ALLOWED_NON_PROJECT_ENV_KEYS = {"DEV", "PYTHONPATH"}
ENV_KEY_PATTERN = re.compile(r"SUI_[A-Z0-9_]+")
ENV_WILDCARD_PATTERN = re.compile(r"`SUI_[A-Z0-9]+[A-Z0-9_]*\*`")
LEGACY_FRONTEND_ENV_KEYS = {"VITE_API_BASE", "FRONTEND_API_BASE"}


def _unset_related_envs() -> None:
    for key in list(os.environ):
        if key.startswith("SUI_") or key in LEGACY_ENV_KEYS:
            os.environ.pop(key, None)


def _iter_scan_files() -> list[Path]:
    files: list[Path] = []
    for root in ENV_SCAN_ROOTS:
        if root.is_file():
            files.append(root)
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix in {".py", ".sh", ".ts", ".tsx", ".js", ".mjs"}:
                if not any(part in IGNORED_SCAN_PARTS for part in path.parts):
                    files.append(path)
    return files


def _python_env_reads(path: Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    constants: dict[str, str] = {}
    env_names: list[tuple[int, str]] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                constants[target.id] = node.value.value

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            is_getenv = (
                isinstance(func, ast.Attribute)
                and func.attr == "getenv"
                and isinstance(func.value, ast.Name)
                and func.value.id == "os"
            )
            if is_getenv and node.args:
                arg = node.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    env_names.append((node.lineno, arg.value))
                elif isinstance(arg, ast.Name) and arg.id in constants:
                    env_names.append((node.lineno, constants[arg.id]))

        if isinstance(node, ast.Subscript):
            value = node.value
            is_os_environ = (
                isinstance(value, ast.Attribute)
                and value.attr == "environ"
                and isinstance(value.value, ast.Name)
                and value.value.id == "os"
            )
            if is_os_environ and isinstance(node.slice, ast.Constant) and isinstance(node.slice.value, str):
                env_names.append((node.lineno, node.slice.value))

    return env_names


def _text_env_reads(path: Path) -> list[tuple[int, str]]:
    text = path.read_text(encoding="utf-8")
    env_names: list[tuple[int, str]] = []

    for pattern in [
        re.compile(r"(?:process|import\.meta)\.env\.([A-Za-z_][A-Za-z0-9_]*)"),
        re.compile(r"^\s*export\s+([A-Z][A-Z0-9_]*)=", re.MULTILINE),
    ]:
        for match in pattern.finditer(text):
            env_names.append((text[: match.start()].count("\n") + 1, match.group(1)))

    return env_names


def _is_allowed_project_env_name(name: str) -> bool:
    return name.startswith("SUI_") or name in ALLOWED_NON_PROJECT_ENV_KEYS


def _env_keys(text: str) -> set[str]:
    return set(ENV_KEY_PATTERN.findall(text))


def _public_registry_env_keys() -> set[str]:
    text = RUNTIME_REGISTRY_DOC.read_text(encoding="utf-8")
    public_text = text.split("以下は製品ランタイムの公開設定ではなく", maxsplit=1)[0]
    # SUI_MCP_* belongs to the separate read-only MCP process, not the backend
    # runtime that 04_Documentation/configuration.md documents. The registry is
    # the source for both, so exclude the MCP keys from this comparison.
    return {key for key in _env_keys(public_text) if not key.startswith("SUI_MCP_")}


def test_settings_uses_prefixed_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_DATABASE_URL", "sqlite:///./canonical.db")

    loaded = Settings()

    assert loaded.database_url == "sqlite:///./canonical.db"


def test_settings_normalizes_available_runtime_profile(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_RUNTIME_PROFILE", "  ENTERPRISE-PRODUCTION ")
    # ADR-0072 D3=A: this profile refuses to construct without an authentication
    # means. This test is about profile-string normalization, so supply the keys
    # rather than weaken the fail-fast.
    monkeypatch.setenv("SUI_ADMIN_API_KEY", "admin-key")
    monkeypatch.setenv("SUI_API_KEY", "business-key")

    loaded = Settings()

    assert loaded.runtime_profile == "enterprise-production"


def test_settings_accepts_saas_runtime_profile(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # ADR-0063 D9-6: saas-multitenant is no longer unconditionally blocked at
    # Settings init. Startup validation is handled by TrustedSaasRuntimePolicy
    # and the main.py lifespan preflight instead.
    _unset_related_envs()
    monkeypatch.setenv("SUI_RUNTIME_PROFILE", "saas-multitenant")
    # ADR-0072 D3=A: still not *unconditionally* blocked, but it does require a
    # control-plane credential. The business-plane key is not required here --
    # the trusted auth edge authenticates the business plane on this profile.
    monkeypatch.setenv("SUI_ADMIN_API_KEY", "admin-key")

    loaded = Settings()

    assert loaded.runtime_profile == "saas-multitenant"


def test_settings_rejects_unknown_runtime_profile(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_RUNTIME_PROFILE", "shared-production")

    try:
        Settings()
        assert False, "Expected unknown runtime profile to be rejected"
    except ValueError as exc:
        assert "SUI_RUNTIME_PROFILE must be one of" in str(exc)


def test_settings_rejects_legacy_runtime_profile_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("RUNTIME_PROFILE", "evaluation")

    try:
        Settings()
        assert False, "Expected legacy runtime profile key to be rejected"
    except ValueError as exc:
        assert "Legacy env keys are no longer supported" in str(exc)
        assert "RUNTIME_PROFILE" in str(exc)


def test_settings_rejects_legacy_document_policy_binding_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("DOCUMENT_POLICY_BINDING_RESOLVER", "external_http")

    try:
        Settings()
        assert False, "Expected legacy binding resolver key to be rejected"
    except ValueError as exc:
        assert "Legacy env keys are no longer supported" in str(exc)
        assert "DOCUMENT_POLICY_BINDING_RESOLVER" in str(exc)


def test_settings_rejects_legacy_tenant_capability_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("TENANT_CAPABILITY_RESOLVER", "external_http")

    try:
        Settings()
        assert False, "Expected legacy capability resolver key to be rejected"
    except ValueError as exc:
        assert "Legacy env keys are no longer supported" in str(exc)
        assert "TENANT_CAPABILITY_RESOLVER" in str(exc)


def test_backend_ci_uses_canonical_database_test_keys_when_present() -> None:
    if not CI_WORKFLOW.is_file():
        release = RELEASE_DOC.read_text(encoding="utf-8")
        assert "常設CIは現在無効" in release
        return

    workflow = CI_WORKFLOW.read_text(encoding="utf-8")
    assert not re.search(r"^\s+(?:DATABASE_URL|RUN_PG_TESTS):", workflow, re.MULTILINE)
    assert workflow.count("SUI_DATABASE_URL:") == 5
    assert workflow.count("SUI_RUN_PG_TESTS:") == 1


def test_project_env_access_points_use_sui_sensemaking_prefix() -> None:
    violations: list[str] = []

    for path in _iter_scan_files():
        relative_path = path.relative_to(REPO_ROOT)
        env_reads = _python_env_reads(path) if path.suffix == ".py" else _text_env_reads(path)
        for line_number, name in env_reads:
            if not _is_allowed_project_env_name(name):
                violations.append(f"{relative_path}:{line_number}:{name}")

    assert violations == []


def test_public_configuration_doc_lists_exact_public_runtime_keys() -> None:
    configuration_text = PUBLIC_CONFIGURATION_DOC.read_text(encoding="utf-8")

    assert ENV_WILDCARD_PATTERN.findall(configuration_text) == []
    assert _env_keys(configuration_text) == _public_registry_env_keys()


def test_public_env_contract_docs_do_not_advertise_legacy_frontend_keys() -> None:
    violations: list[str] = []

    for path in PUBLIC_ENV_CONTRACT_DOCS:
        text = path.read_text(encoding="utf-8")
        for key in sorted(LEGACY_FRONTEND_ENV_KEYS):
            legacy_key_pattern = re.compile(rf"(?<!SUI_)\b{re.escape(key)}\b")
            if legacy_key_pattern.search(text):
                violations.append(f"{path.relative_to(REPO_ROOT)}:{key}")

    assert violations == []


def test_settings_rejects_legacy_key_only(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./legacy.db")

    try:
        Settings()
        assert False, "Expected legacy-only env to be rejected"
    except ValueError as exc:
        assert "Legacy env keys are no longer supported" in str(exc)
        assert "DATABASE_URL" in str(exc)


def test_settings_rejects_mixed_prefixed_and_legacy_keys(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_DATABASE_URL", "sqlite:///./canonical.db")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./legacy.db")

    try:
        Settings()
        assert False, "Expected mixed env keys to be rejected"
    except ValueError as exc:
        assert "Legacy env keys are no longer supported" in str(exc)
        assert "DATABASE_URL" in str(exc)


def test_settings_normalizes_access_control_auth_mode(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_ACCESS_CONTROL_EXTERNAL_HTTP_AUTH_MODE", "  OIDC ")

    loaded = Settings()

    assert loaded.access_control_external_http_auth_mode == "oidc"


def test_settings_normalizes_access_control_adapter_and_fail_safe(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_ACCESS_CONTROL_ADAPTER", "  MOCK ")
    monkeypatch.setenv("SUI_ACCESS_CONTROL_FAIL_SAFE_MODE", "  DENY ")

    loaded = Settings()

    assert loaded.access_control_adapter == "mock"
    assert loaded.access_control_fail_safe_mode == "deny"


def test_settings_rejects_invalid_access_control_adapter(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_ACCESS_CONTROL_ADAPTER", "custom")

    try:
        Settings()
        assert False, "Expected invalid access-control adapter to be rejected"
    except ValueError as exc:
        assert "SUI_ACCESS_CONTROL_ADAPTER" in str(exc)


def test_settings_rejects_invalid_access_control_fail_safe(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_ACCESS_CONTROL_FAIL_SAFE_MODE", "allow")

    try:
        Settings()
        assert False, "Expected invalid access-control fail-safe mode to be rejected"
    except ValueError as exc:
        assert "SUI_ACCESS_CONTROL_FAIL_SAFE_MODE" in str(exc)


def test_settings_normalizes_reviewer_ref_resolver_adapter(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_REVIEWER_REF_RESOLVER_ADAPTER", "  SSO_SUBJECT ")

    loaded = Settings()

    assert loaded.reviewer_ref_resolver_adapter == "sso_subject"


def test_settings_rejects_non_ce4_equivalence_mode(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_CE4_EQUIVALENCE_MODE", "bundle_hash_only")

    try:
        Settings()
        assert False, "Expected invalid CE4 equivalence mode to be rejected"
    except ValueError as exc:
        assert "SUI_CE4_EQUIVALENCE_MODE" in str(exc)


def test_settings_rejects_disabling_ce4_audit_require_all_events(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_CE4_AUDIT_REQUIRE_ALL_EVENTS", "false")

    try:
        Settings()
        assert False, "Expected CE4 audit fail-closed guard to be rejected"
    except ValueError as exc:
        assert "SUI_CE4_AUDIT_REQUIRE_ALL_EVENTS" in str(exc)


def test_settings_rejects_disabling_ce4_stub_unresolved_contracts(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_CE4_STUB_UNRESOLVED_CONTRACTS", "false")

    try:
        Settings()
        assert False, "Expected unresolved CE4 stub isolation to remain fail-closed"
    except ValueError as exc:
        assert "SUI_CE4_STUB_UNRESOLVED_CONTRACTS" in str(exc)


def test_settings_rejects_legacy_ce4_stub_key(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("CE4_STUB_UNRESOLVED_CONTRACTS", "false")

    try:
        Settings()
        assert False, "Expected legacy CE4 stub key to be rejected"
    except ValueError as exc:
        assert "CE4_STUB_UNRESOLVED_CONTRACTS" in str(exc)


# ---------------------------------------------------------------------------
# ADR-0063: JWT / tenant claim settings validation
# ---------------------------------------------------------------------------


def test_jwt_algorithms_default_is_valid(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    loaded = Settings()
    assert loaded.jwt_algorithms == "RS256,ES256"


def test_jwt_algorithms_rejects_empty(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_JWT_ALGORITHMS", " , , ")
    try:
        Settings()
        assert False, "Expected empty algorithm list to be rejected"
    except ValueError as exc:
        assert "at least one algorithm" in str(exc)


def test_jwt_algorithms_rejects_unknown(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_JWT_ALGORITHMS", "RS256,NONE")
    try:
        Settings()
        assert False, "Expected unknown algorithm to be rejected"
    except ValueError as exc:
        assert "unknown algorithms" in str(exc)
        assert "NONE" in str(exc)


def test_jwt_algorithms_rejects_hmac(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_JWT_ALGORITHMS", "HS256,RS256")
    try:
        Settings()
        assert False, "Expected HMAC algorithm to be rejected"
    except ValueError as exc:
        assert "HMAC" in str(exc)


def test_jwt_algorithms_normalizes_whitespace(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_JWT_ALGORITHMS", " ES256 , RS256 ")
    loaded = Settings()
    assert loaded.jwt_algorithms == "ES256,RS256"


def test_tenant_claim_name_default_is_valid(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    loaded = Settings()
    assert loaded.tenant_claim_name == "tenant_ref"


def test_tenant_claim_name_rejects_empty(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_TENANT_CLAIM_NAME", "   ")
    try:
        Settings()
        assert False, "Expected empty claim name to be rejected"
    except ValueError as exc:
        assert "must not be empty" in str(exc)


def test_tenant_claim_name_rejects_spaces(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_TENANT_CLAIM_NAME", "tenant claim")
    try:
        Settings()
        assert False, "Expected claim name with spaces to be rejected"
    except ValueError as exc:
        assert "must not contain spaces" in str(exc)


def test_tenant_claim_name_rejects_leading_whitespace(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    _unset_related_envs()
    monkeypatch.setenv("SUI_TENANT_CLAIM_NAME", " tenant_ref")
    try:
        Settings()
        assert False, "Expected claim name with leading whitespace to be rejected"
    except ValueError as exc:
        assert "leading/trailing whitespace" in str(exc)
