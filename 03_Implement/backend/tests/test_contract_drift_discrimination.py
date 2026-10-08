"""Capability canary for check_contract_drift.py's route/api.md matcher.

Mirrors test_design_consistency_discrimination.py (DX-DESIGN-CHECK-01). This
does not test that the checker reports few warnings -- a checker that finds
nothing would pass such a test. It tests that the checker can still (a) find
every real @router decorator in source and (b) tell distinct endpoints apart
once found.

Two independent defects were found and fixed together here:

- Extraction: ROUTE_DECORATOR_RE required the path string immediately after
  the opening paren, so any multi-line `@router.post(\n    "/x", ...)` call
  was invisible to the checker. 14 of the 15 decorators in routes/ai.py are
  written that way, and the empty-string collection-root path (`@router.get
  ("", ...)`) didn't match either since the capture group required at least
  one character. Together these dropped 43 real decorators to 20 before any
  comparison to api.md happened.
- Matching: the old canonicalization collapsed every kebab/snake path segment
  into a shared placeholder, so sibling endpoints under the same prefix (all
  ten original /ai/* routes, for instance) became indistinguishable and any
  one of them being documented silently cleared warnings for all the others.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPT_PATH = REPO_ROOT / "03_Implement" / "backend" / "scripts" / "check_contract_drift.py"
AI_ROUTES_PATH = REPO_ROOT / "03_Implement" / "backend" / "src" / "sui_sensemaking_api" / "routes" / "ai.py"


_WANTED = (
    "ROUTE_DECORATOR_RE",
    "ROUTER_PREFIX_RE",
    "_PARAM_TOKEN_RE",
    "_endpoint_segments",
    "endpoint_matches_documented",
    "_router_prefix_for",
)


def _load_matcher():
    """Load the pure matching/extraction helpers without running the script body.

    check_contract_drift.py performs its checks at import time and calls
    sys.exit, so it cannot simply be imported. Its relevant definitions are
    selected from the parsed AST by name (immune to reordering, unlike a
    text-slicing approach) and compiled on their own.
    """
    tree = ast.parse(SCRIPT_PATH.read_text(encoding="utf-8"))
    selected: list[ast.stmt] = [ast.Import(names=[ast.alias(name="re", asname=None)])]
    found: set[str] = set()
    for node in tree.body:
        name = None
        if isinstance(node, ast.FunctionDef):
            name = node.name
        elif isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name):
                name = target.id
        if name in _WANTED:
            selected.append(node)
            found.add(name)

    missing = set(_WANTED) - found
    assert not missing, (
        f"check_contract_drift.py no longer defines {sorted(missing)}. If these were "
        "renamed, update _WANTED -- do not delete this test, since it is what keeps the "
        "checker's discriminating power and route extraction from regressing."
    )

    module = ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[]))
    namespace: dict[str, object] = {}
    exec(compile(module, str(SCRIPT_PATH), "exec"), namespace)  # noqa: S102 - our own repo script
    return namespace


_NS = _load_matcher()
ENDPOINT_MATCHES = _NS["endpoint_matches_documented"]
ENDPOINT_SEGMENTS = _NS["_endpoint_segments"]
ROUTE_DECORATOR_RE = _NS["ROUTE_DECORATOR_RE"]
ROUTER_PREFIX_RE = _NS["ROUTER_PREFIX_RE"]
ROUTER_PREFIX_FOR = _NS["_router_prefix_for"]


# Every AI endpoint defined in routes/ai.py as of this fix. These are the
# routes that previously collapsed into a handful of shared placeholders.
AI_ENDPOINTS = [
    "/ai/provider-status",
    "/ai/suggest-layout",
    "/ai/suggest-merges",
    "/ai/suggest-island-summary",
    "/ai/proposals/island-summary",
    "/ai/external-tasks/register",
    "/ai/external-proposals/register",
    "/ai/proposals/audit",
    "/ai/external-proposals/audit",
    "/ai/generate-narrative",
    "/ai/check-narrative",
    "/ai/refine-card-text",
    "/ai/suggest-card-groups",
    "/ai/detect-contradiction",
    "/ai/suggest-document-title",
]


@pytest.mark.parametrize("endpoint", AI_ENDPOINTS)
def test_ai_endpoint_matches_only_itself(endpoint: str) -> None:
    """Each /ai/* endpoint must match itself and no sibling."""
    assert ENDPOINT_MATCHES(endpoint, endpoint)
    for other in AI_ENDPOINTS:
        if other != endpoint:
            assert not ENDPOINT_MATCHES(endpoint, other), (
                f"{endpoint} was treated as equivalent to {other}: the checker can no longer "
                "distinguish sibling AI endpoints, so a real route missing from api.md would "
                "be silently accepted as long as any sibling is documented"
            )


def test_internal_and_external_proposal_audit_stay_distinct() -> None:
    """/ai/proposals/audit and /ai/external-proposals/audit must not look alike.

    These two differ only in a kebab-case prefix on one segment -- exactly the
    shape the old shape-guessing canonicalization collapsed.
    """
    assert not ENDPOINT_MATCHES("/ai/proposals/audit", "/ai/external-proposals/audit")
    assert not ENDPOINT_MATCHES("/ai/external-proposals/audit", "/ai/proposals/audit")


def test_concrete_id_still_matches_a_declared_placeholder() -> None:
    assert ENDPOINT_MATCHES("/docs/e2e-qa-roundtrip", "/docs/{docId}")
    assert ENDPOINT_MATCHES("/docs/{doc_id}", "/docs/{docId}")


def test_different_shapes_do_not_match() -> None:
    assert not ENDPOINT_MATCHES("/docs", "/docs/{docId}")
    assert not ENDPOINT_MATCHES("/docs/{docId}/export-audit", "/docs/{docId}")


def test_route_decorator_regex_extracts_multiline_calls() -> None:
    """Multi-line @router decorators must be extracted, not missed.

    ROUTE_DECORATOR_RE previously required the path string immediately after
    the opening paren and missed the decorators that write the path on the
    following line. The expected count follows the route set in routes/ai.py;
    update it together with api.md when a route is added (the count was 18
    until /ai/suggest-attention-candidates was added in #3172).
    """
    content = AI_ROUTES_PATH.read_text(encoding="utf-8")
    matches = list(ROUTE_DECORATOR_RE.finditer(content))
    assert len(matches) == 19, (
        f"expected 19 @router decorators in routes/ai.py, extracted {len(matches)}: "
        "a multi-line `@router.post(\\n    \"/x\", ...)` call is going undetected again"
    )
    paths = {m.group(2) for m in matches}
    assert "/external-tasks/register" in paths
    assert "/external-proposals/audit" in paths
    assert "/suggest-attention-candidates" in paths


def test_route_decorator_regex_extracts_empty_collection_root_path() -> None:
    """@router.get("", ...) (the collection root under the router's prefix)
    must still be captured -- the path capture group must accept zero chars.
    """
    matches = list(ROUTE_DECORATOR_RE.finditer('@router.get("", response_model=Foo)\n'))
    assert len(matches) == 1
    assert matches[0].group(2) == ""


def test_endpoint_segments_of_empty_path_is_prefix_only() -> None:
    prefix = "/tenant-admin/document-access"
    path = ""
    full_path = f"{prefix.rstrip('/')}/{path.lstrip('/')}".rstrip("/") or "/"
    assert ENDPOINT_SEGMENTS(full_path) == ["tenant-admin", "document-access"]
