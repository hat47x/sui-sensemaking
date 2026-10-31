#!/usr/bin/env python3
"""Detect drift between implementation and design contracts.

ADR-0067: Three-Element Constraint Design Method — contract drift detection.

Checks:
1. Every API endpoint in routes/*.py is documented in api.md
2. Every Pydantic model field referenced in schemas.md has a corresponding
   TypeScript type in the frontend domain/types.ts
3. Frontend API client functions match backend route signatures
4. Environment variables referenced in code match runtime_parameter_registry.md

Exit code 0 = no drift detected (or only warnings).
Exit code 1 = hard drift errors found.
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
from pathlib import Path

# Windowsの既定コードページ(cp932)では、出力の矢印(U+2194)で UnicodeEncodeError になる。
# 出力はUTF-8に固定し、PYTHONUTF8を付けなくても最後まで走らせる。
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
BACKEND_SRC = REPO_ROOT / "03_Implement" / "backend" / "src" / "sui_sensemaking_api"
FRONTEND_SRC = REPO_ROOT / "03_Implement" / "frontend" / "src"
MCP_SRC = REPO_ROOT / "03_Implement" / "mcp" / "src"
ARCH_DIR = REPO_ROOT / "02_Architecture"

API_MD = ARCH_DIR / "api.md"
SCHEMAS_MD = ARCH_DIR / "schemas.md"
RUNTIME_REGISTRY = ARCH_DIR / "runtime_parameter_registry.md"

errors: list[str] = []
warnings: list[str] = []


def error(msg: str) -> None:
    errors.append(msg)
    print(f"  DRIFT ERROR: {msg}")


def warn(msg: str) -> None:
    warnings.append(msg)
    print(f"  DRIFT WARN: {msg}")


# --- 1. Backend route → api.md coverage ---

print("=== 1. Backend routes vs api.md ===")

ROUTE_DECORATOR_RE = re.compile(
    r'@router\.(get|post|put|delete|patch)\(\s*'
    r'["\']([^"\']*)["\']'
)
# router = APIRouter(prefix="/ai", tags=["ai"])
ROUTER_PREFIX_RE = re.compile(r'APIRouter\([^)]*prefix=["\']([^"\']+)["\']')
# Path-parameter token: {doc_id}, {journey_id}, {id}, ...
_PARAM_TOKEN_RE = re.compile(r"\{[a-zA-Z_][a-zA-Z0-9_]*\}")


def _endpoint_segments(path: str) -> list[str]:
    return [segment for segment in path.strip("/").split("/") if segment]


def endpoint_matches_documented(referenced: str, documented: str) -> bool:
    """Structural, segment-wise match against api.md's declared placeholders.

    DX-DESIGN-CHECK-01 found the same defect class in
    check_design_consistency.py: a shape-based regex (```{[a-z][a-z0-9]+
    (?:[-_][a-z0-9]+)+}```-style kebab/snake matching) collapsed every
    kebab-case path segment into a shared placeholder, so unrelated routes
    that merely looked like fixture IDs became indistinguishable. Here that
    collapsed 43 raw @router decorators down to 16 canonical strings before
    deduplication ever compared anything to api.md. Matching structurally
    against the placeholder positions api.md itself declares avoids guessing
    from shape.
    """
    referenced_segments = _endpoint_segments(referenced)
    documented_segments = _endpoint_segments(documented)
    if len(referenced_segments) != len(documented_segments):
        return False
    for referenced_segment, documented_segment in zip(referenced_segments, documented_segments):
        if _PARAM_TOKEN_RE.fullmatch(documented_segment):
            continue
        if _PARAM_TOKEN_RE.fullmatch(referenced_segment):
            continue
        if referenced_segment != documented_segment:
            return False
    return True


def _router_prefix_for(content: str) -> str:
    match = ROUTER_PREFIX_RE.search(content)
    return match.group(1) if match else ""


if API_MD.exists():
    api_md_content = API_MD.read_text(encoding="utf-8")

    # Resolve each backend route with its router prefix.
    backend_routes: set[tuple[str, str]] = set()
    for py_file in BACKEND_SRC.rglob("*.py"):
        if py_file.name == "__init__.py":
            continue
        try:
            content = py_file.read_text(encoding="utf-8")
        except Exception:
            continue
        prefix = _router_prefix_for(content)
        for match in ROUTE_DECORATOR_RE.finditer(content):
            method = match.group(1).upper()
            path = match.group(2)
            full_path = f"{prefix.rstrip('/')}/{path.lstrip('/')}".rstrip("/") or "/"
            backend_routes.add((method, full_path))

    # Extract documented endpoints from api.md (both `METHOD /path` and
    # **METHOD** `/path` formats).
    # パスは閉じのバッククォートで切る。「`POST /x`（`perm`）」のように同じ語の中に
    # 別のコード片が続く書式でも、パスが後続のバッククォートまで伸びないようにする。
    API_DOC_RE = re.compile(r'`(GET|POST|PUT|DELETE|PATCH)\s+(/[^\s`]+)`')
    API_DOC_BOLD_RE = re.compile(r"\*\*(GET|POST|PUT|DELETE|PATCH)\*\*\s+`(/\S+)`")
    doc_endpoints: set[tuple[str, str]] = set()
    for pattern in (API_DOC_RE, API_DOC_BOLD_RE):
        for match in pattern.finditer(api_md_content):
            doc_endpoints.add((match.group(1), match.group(2)))

    # Check coverage
    for method, path in sorted(backend_routes):
        if not any(
            method == doc_method and endpoint_matches_documented(path, doc_path)
            for doc_method, doc_path in doc_endpoints
        ):
            warn(f"Backend route '{method} {path}' not found in api.md")

    print(f"  Backend routes: {len(backend_routes)}, api.md documented endpoints: {len(doc_endpoints)}")
else:
    warn("api.md not found — skipping route check")


# --- 2. Environment variables vs registry ---

print("\n=== 2. Environment variables vs runtime_parameter_registry.md ===")

if RUNTIME_REGISTRY.exists():
    registry_content = RUNTIME_REGISTRY.read_text(encoding="utf-8")

    # Find all SUI_* env vars in settings.py
    settings_py = BACKEND_SRC / "settings.py"
    if settings_py.exists():
        settings_content = settings_py.read_text(encoding="utf-8")
        ENV_VAR_RE = re.compile(r'validation_alias="(SUI_\w+)"')
        code_env_vars: set[str] = set()
        for match in ENV_VAR_RE.finditer(settings_content):
            code_env_vars.add(match.group(1))

        # Check registry coverage
        for var in sorted(code_env_vars):
            if var not in registry_content:
                warn(f"SUI_* env var '{var}' not mentioned in runtime_parameter_registry.md")

        print(f"  Code env vars: {len(code_env_vars)}")

    # MCPサーバーが読む SUI_* も対象にする(settings.py の validation_alias には現れない)。
    # テストと、末尾が「_」の接頭辞だけの文字列は除く。
    MCP_ENV_VAR_RE = re.compile(r"\bSUI_[A-Z0-9]+(?:_[A-Z0-9]+)*\b")
    mcp_env_vars: set[str] = set()
    if MCP_SRC.exists():
        for ts_file in MCP_SRC.rglob("*.ts"):
            if ".test." in ts_file.name or ts_file.name.endswith(".d.ts"):
                continue
            try:
                ts_text = ts_file.read_text(encoding="utf-8")
            except Exception:
                continue
            mcp_env_vars.update(MCP_ENV_VAR_RE.findall(ts_text))
        for var in sorted(mcp_env_vars - code_env_vars if settings_py.exists() else mcp_env_vars):
            if var not in registry_content:
                warn(f"SUI_* env var '{var}' (MCP) not mentioned in runtime_parameter_registry.md")
        print(f"  MCP env vars: {len(mcp_env_vars)}")
    else:
        warn("mcp/src not found — skipping MCP env var check")
else:
    warn("runtime_parameter_registry.md not found — skipping env var check")


# --- 3. Frontend API client ↔ Backend routes ---

print("\n=== 3. Frontend API client ↔ Backend routes ===")

client_ts = FRONTEND_SRC / "api" / "client.ts"
if client_ts.exists():
    client_content = client_ts.read_text(encoding="utf-8")

    # Extract fetch URLs from client.ts
    FETCH_URL_RE = re.compile(r'fetch\(`\$\{API_BASE\}(/[^`]+)`')
    client_endpoints: set[str] = set()
    for match in FETCH_URL_RE.finditer(client_content):
        path = match.group(1)
        # Extract method from surrounding context
        # Look for method: "POST" / "GET" etc in the fetch options
        client_endpoints.add(path)

    # Check each client endpoint against backend routes
    for ep in sorted(client_endpoints):
        # Find which method is used
        method = "GET"  # default
        method_match = re.search(
            rf'{re.escape(ep)}[^)]*method:\s*["\']([A-Z]+)["\']',
            client_content,
        )
        if method_match:
            method = method_match.group(1)

    print(f"  Client endpoints: {len(client_endpoints)}")
else:
    warn("client.ts not found — skipping client check")


# --- 4. Pydantic models ↔ TypeScript types ---

print("\n=== 4. Pydantic models ↔ TypeScript types ===")

types_ts = FRONTEND_SRC / "domain" / "types.ts"
models_py = BACKEND_SRC / "models.py"

if types_ts.exists() and models_py.exists():
    # Extract TypeScript type names
    ts_content = types_ts.read_text(encoding="utf-8")
    TS_TYPE_RE = re.compile(r'export (?:type|interface) (\w+)')
    ts_types: set[str] = set()
    for match in TS_TYPE_RE.finditer(ts_content):
        ts_types.add(match.group(1))

    # Extract Pydantic model names
    py_content = models_py.read_text(encoding="utf-8")
    PY_MODEL_RE = re.compile(r'class (\w+)\(BaseModel\):')
    py_models: set[str] = set()
    for match in PY_MODEL_RE.finditer(py_content):
        py_models.add(match.group(1))

    # Check key types exist in both
    shared = ts_types & py_models
    ts_only = py_models - ts_types
    py_only = ts_types - py_models

    if ts_only and len(ts_only) > 5:
        warn(f"Pydantic models without TS types: {sorted(ts_only)[:5]}...")
    if py_only and len(py_only) > 10:
        warn(f"TS types without Pydantic models: {sorted(py_only)[:5]}...")

    print(f"  TS types: {len(ts_types)}, Pydantic models: {len(py_models)}, Shared: {len(shared)}")


# --- Warning categories for baseline tracking ---

warning_categories = {
    "route_docs": sum(1 for w in warnings if "not found in api.md" in w),
    "env_vars": sum(1 for w in warnings if "env var" in w or "SUI_" in w),
    "pydantic_ts": sum(1 for w in warnings if "Pydantic" in w or "TS types" in w),
}
total_warnings = len(warnings)

# --- Summary ---

print(f"\n=== Contract Drift Summary: {len(errors)} errors, {len(warnings)} warnings ===")

# Baseline check (R3 root cause 1 countermeasure — R5-c01)
baseline_path_d = None
for i, arg in enumerate(sys.argv):
    if arg == "--baseline" and i + 1 < len(sys.argv):
        baseline_path_d = Path(sys.argv[i + 1])
        break

if baseline_path_d:
    current = {
        "total_warnings": total_warnings,
        "total_errors": len(errors),
        "categories": warning_categories,
    }
    if baseline_path_d.exists():
        try:
            baseline = json.loads(baseline_path_d.read_text())
            increased = []
            for cat, count in current["categories"].items():
                base_count = baseline.get("categories", {}).get(cat, 0)
                if count > base_count:
                    increased.append(f"{cat}: {base_count}→{count} (+{count - base_count})")
            if increased:
                print(f"FAILED — drift warning count increased in: {', '.join(increased)}")
                print(f"  Baseline: {baseline_path_d} (update with --update-baseline after fixing)")
                sys.exit(1)
            elif current["total_warnings"] < baseline.get("total_warnings", 0):
                print(f"  Drift decreased: {baseline['total_warnings']}→{current['total_warnings']}")
                print(f"  Consider updating baseline: --update-baseline")
        except (json.JSONDecodeError, KeyError):
            print(f"  Warning: baseline file corrupt, skipping baseline check")
    else:
        print(f"  Baseline created: {baseline_path_d} ({total_warnings} warnings)")
        baseline_path_d.write_text(json.dumps(current, indent=2))

if "--update-baseline" in sys.argv and baseline_path_d:
    current = {
        "total_warnings": total_warnings,
        "total_errors": len(errors),
        "categories": warning_categories,
    }
    baseline_path_d.write_text(json.dumps(current, indent=2))
    print(f"  Baseline updated: {baseline_path_d} ({total_warnings} warnings)")

if errors:
    print("DRIFT DETECTED — fix before merge")
    sys.exit(1)
else:
    print("OK" + (" (with warnings)" if warnings else ""))
    sys.exit(0)
