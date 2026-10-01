#!/usr/bin/env bash
# sui-sensemaking comprehensive verification script.
# Runs: lint → unit tests → integration tests → doc checks
# Exit code: 0 = all passed, 1 = at least one check failed.
set -uo pipefail
cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'
PASS="${GREEN}PASS${NC}"
FAIL="${RED}FAIL${NC}"
VENV_PYTHON=".venv/bin/python"

failures=0

check() {
  local label="$1"
  shift
  echo -n "[....] $label "
  if "$@" > /tmp/verify_check.log 2>&1; then
    echo -e "\r[$PASS] $label"
  else
    echo -e "\r[$FAIL] $label"
    echo "  --- output (last 5 lines) ---"
    tail -5 /tmp/verify_check.log | sed 's/^/  /'
    echo "  --- end ---"
    failures=$((failures + 1))
    return 1
  fi
}

# DOGFOOD-10 案A: run a self-contained E2E from a SAME-DIRECTORY snapshot so a
# concurrent dogfooding iteration (cron /loop fire) that appends a scenario to
# the original file cannot corrupt a running check. The snapshot lives next to
# the original so each script's `BASH_SOURCE`-derived paths (SCRIPT_DIR /
# ROOT_DIR / examples/*.py) resolve exactly as they do standalone.
run_e2e_snapshot() {
  local script="$1"
  shift
  local dir snapshot
  dir="$(dirname "$script")"
  snapshot="$dir/.e2e_snapshot_$$_$(basename "$script")"
  if ! cp "$script" "$snapshot" 2>/dev/null; then
    return 127
  fi
  bash "$snapshot" "$@"
  local rc=$?
  rm -f "$snapshot"
  return $rc
}

echo "=== sui-sensemaking Comprehensive Verification ==="
echo ""

# ------------------------------------------------------------------
# 1. Python syntax
# ------------------------------------------------------------------
check "Python syntax (all source files)" \
  bash -c "find src/sui_sensemaking_api -name '*.py' | while read f; do $VENV_PYTHON -c 'import py_compile; py_compile.compile(\"'\"\$f\"'\", doraise=True)' 2>/dev/null || exit 1; done"

# ------------------------------------------------------------------
# 2. Ruff lint (core auth files)
# ------------------------------------------------------------------
check "Ruff lint (auth modules)" \
  $VENV_PYTHON -m ruff check \
    src/sui_sensemaking_api/trusted_auth_edge.py \
    src/sui_sensemaking_api/active_tenant_session.py \
    src/sui_sensemaking_api/auth_context.py \
    src/sui_sensemaking_api/tenant_context.py \
    src/sui_sensemaking_api/saas_request_context.py \
    src/sui_sensemaking_api/settings.py \
    src/sui_sensemaking_api/main.py \
    src/sui_sensemaking_api/routes/admin.py

# ------------------------------------------------------------------
# 3. Unit tests (auth core)
# ------------------------------------------------------------------
check "Unit tests (auth core: JWT, JWKS, tenant, session)" \
  $VENV_PYTHON -m pytest tests/test_trusted_auth_edge.py \
    tests/test_jwks_store.py \
    tests/test_claim_tenant_resolver.py \
    tests/test_active_tenant_session_persister.py \
    tests/test_trusted_saas_runtime.py \
    tests/test_verified_tenant_context.py \
    tests/test_tenant_context_resolution.py \
    tests/test_auth_context_resolution.py \
    -q

# ------------------------------------------------------------------
# 4. Integration tests (E2E auth)
# ------------------------------------------------------------------
check "Integration tests (E2E tenant isolation + OAuth login + coordinated)" \
  $VENV_PYTHON -m pytest tests/test_saas_e2e_tenant_isolation.py \
    tests/test_saas_oauth_login_e2e.py \
    tests/test_saml_broker_jwt_coordinated_flow.py \
    -q

# ------------------------------------------------------------------
# 5. Admin API tests
# ------------------------------------------------------------------
check "Admin API tests (IdP registration + policy)" \
  $VENV_PYTHON -m pytest tests/test_admin_identity_provider_registration.py -q

# ------------------------------------------------------------------
# 6. Federation + settings
# ------------------------------------------------------------------
check "Federation + settings + session tests" \
  $VENV_PYTHON -m pytest tests/test_auth_federation_level2.py \
    tests/test_settings_env_prefix_migration.py \
    tests/test_session_context.py \
    tests/test_session_context_routes.py \
    tests/test_tenant_session_precondition.py \
    -q

# ------------------------------------------------------------------
# 7. LLM tests (mock integration)
# ------------------------------------------------------------------
check "LLM integration tests (mock — all 6 AI tasks)" \
  $VENV_PYTHON -m pytest tests/test_llm_provider.py \
    tests/test_llm_settings.py \
    tests/test_ai_prompt.py \
    tests/test_ai_provider_error_contract.py \
    tests/test_ai_provider_status_route.py \
    tests/test_ai_relations_route.py \
    tests/test_llm_integration.py \
    -m "not ollama" -q

# ------------------------------------------------------------------
# 9. API/MCP verification (non-Web paths)
# ------------------------------------------------------------------
# These curl/tsx-based checks exercise the admin CLI/API and MCP paths an
# operator actually uses. When no backend is reachable on the configured base
# (default :8000), a self-contained backend is started (fresh migrated DB +
# business/admin keys + local mock LLM) so the checks run in CI without a
# manually-started uvicorn. The pre-start is never a failure by itself.
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || echo '/mnt/d/GIT/sui-sensemaking')"
API_BASE="${SUI_VERIFY_API_BASE:-http://127.0.0.1:8000}"
SELF_BACKEND_PID=""
SELF_STUB_PID=""
SELF_DB=""
if ! curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$API_BASE/healthz" 2>/dev/null | grep -q 200; then
  if [ -x "$VENV_PYTHON" ] && [ -f alembic.ini ]; then
    SELF_DB="$(mktemp /tmp/kj_verify_api_XXXX.sqlite3)"
    SELF_API_KEY="biz-verify-api"
    SELF_ADM_KEY="adm-verify-api"
    STUB_PORT=$("$VENV_PYTHON" -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()")
    BK_PORT=$("$VENV_PYTHON" -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()")
    if (cd "$ROOT_DIR/03_Implement/backend" && SUI_DATABASE_URL="sqlite:///$SELF_DB" "$VENV_PYTHON" -m alembic upgrade head >/dev/null 2>&1); then
      "$VENV_PYTHON" "$ROOT_DIR/03_Implement/deploy/tools/mock_local_llm.py" --host 127.0.0.1 --port "$STUB_PORT" >/tmp/kj_verify_stub.log 2>&1 &
      SELF_STUB_PID=$!
      SUI_API_KEY="$SELF_API_KEY" SUI_ADMIN_API_KEY="$SELF_ADM_KEY" \
      SUI_DATABASE_URL="sqlite:///$SELF_DB" \
      SUI_LLM_PROVIDER=local SUI_LOCAL_LLM_BASE_URL="http://127.0.0.1:$STUB_PORT" \
        "$VENV_PYTHON" -m uvicorn sui_sensemaking_api.main:app --port "$BK_PORT" --host 127.0.0.1 >/tmp/kj_verify_backend.log 2>&1 &
      SELF_BACKEND_PID=$!
      API_BASE="http://127.0.0.1:$BK_PORT"
      # The API scripts read SUI_API_KEY / SUI_ADMIN_API_KEY for their
      # X-API-Key / X-Admin-Api-Key headers (keyed-backend path, fixed in 2d26a5eb).
      export SUI_API_KEY="$SELF_API_KEY" SUI_ADMIN_API_KEY="$SELF_ADM_KEY"
      for _ in $(seq 1 40); do curl -s -o /dev/null "$API_BASE/healthz" && break; sleep 0.5; done
      echo "  (self-contained API backend started on $API_BASE — keyed + local mock)"
    else
      SELF_DB=""
    fi
  fi
fi
if curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$API_BASE/healthz" 2>/dev/null | grep -q 200; then
  # DOGFOOD-09: a backend running against a DB that is behind the alembic head
  # yields confusing raw 500s ("no such column: ...") on document/inquiry
  # writes instead of a clear signal. Check migration state before the
  # curl/MCP checks and report it as a precondition skip — never a failure.
  migrated=1
  if [ -x "$VENV_PYTHON" ] && [ -f alembic.ini ]; then
    cur=$("$VENV_PYTHON" -m alembic current 2>/dev/null | grep -oE '^[0-9_]+' | head -1)
    head=$("$VENV_PYTHON" -m alembic heads 2>/dev/null | grep -oE '^[0-9_]+' | head -1)
    # DOGFOOD-09: an empty `alembic current` means the DB has NO alembic_version
    # row (never migrated) — that is also "not migrated" and must skip the API
    # checks instead of running them into raw 500s.
    cur="${cur:-none}"
    head="${head:-none}"
    if [ "$cur" != "$head" ]; then
      echo "  SKIP: API/MCP verification — DB migration state ($cur) != alembic head ($head)."
      echo "        Run 'alembic upgrade head' first (DOGFOOD-09) so the checks exercise a migrated DB."
      migrated=0
    fi
  fi
  if [ "$migrated" -eq 1 ]; then
    check "API read path (verify_api.sh)" \
      bash "$ROOT_DIR/03_Implement/backend/scripts/verify_api.sh" "$API_BASE"
    check "API write path (verify_api_write.sh)" \
      bash "$ROOT_DIR/03_Implement/backend/scripts/verify_api_write.sh" "$API_BASE"
    check "API AI fail-closed path (verify_api_ai.sh)" \
      bash "$ROOT_DIR/03_Implement/backend/scripts/verify_api_ai.sh" "$API_BASE"
    check "API inquiry CAS path (verify_api_inquiry.sh)" \
      bash "$ROOT_DIR/03_Implement/backend/scripts/verify_api_inquiry.sh" "$API_BASE"
    check "API W-type journey path (verify_api_inquiry_journey.sh)" \
      bash "$ROOT_DIR/03_Implement/backend/scripts/verify_api_inquiry_journey.sh" "$API_BASE"
    check "API admin plane path (verify_api_admin.sh)" \
      bash "$ROOT_DIR/03_Implement/backend/scripts/verify_api_admin.sh" "$API_BASE"
    # MCP client path (generative-AI verification). Requires the mcp package's
    # tsx runtime; a missing/empty doc reports not_found (exit 0, valid signal).
    if [ -x "$ROOT_DIR/03_Implement/mcp/node_modules/.bin/tsx" ]; then
      check "MCP client path (verify_mcp.ts)" \
        bash -c "cd '$ROOT_DIR/03_Implement/mcp' && SUI_MCP_API_BASE_URL='$API_BASE' npm run verify -- ${SUI_MCP_VERIFY_DOC:-doc_phase1_canvas} reviewed-only"
      # MCP HTTP transport e2e (remote generative-AI path): mock IdP + real
      # signed JWT + real backend document over streamable HTTP. Uses ephemeral
      # ports so it is safe to run alongside other harness jobs. Defaults to the
      # document created by verify_api_write.sh above.
      check "MCP HTTP transport e2e (dogfood_mcp_http_e2e.mjs)" \
        bash -c "cd '$ROOT_DIR/03_Implement/mcp' && SUI_MCP_API_BASE_URL='$API_BASE' timeout 90 node ./node_modules/.bin/tsx scripts/dogfood_mcp_http_e2e.mjs ${SUI_MCP_VERIFY_DOC:-admin_write_probe}"
    else
      echo "  SKIP: MCP client path — mcp package deps not installed (cd 03_Implement/mcp && npm install)"
    fi
  fi
else
  echo "  SKIP: API/MCP verification — no backend at $API_BASE (start uvicorn sui_sensemaking_api.main:app --port 8000 to enable)"
fi

# Clean up the self-contained backend (if any) started for the API/MCP checks,
# and drop the keys we exported for it — otherwise check 10's E2Es inherit them
# and start keyed backends whose curls send no key (401).
if [ -n "$SELF_BACKEND_PID" ]; then
  kill "$SELF_BACKEND_PID" 2>/dev/null
  unset SUI_API_KEY SUI_ADMIN_API_KEY
fi
if [ -n "$SELF_STUB_PID" ]; then kill "$SELF_STUB_PID" 2>/dev/null; fi
if [ -n "$SELF_DB" ]; then rm -f "$SELF_DB"; fi

# 10. Self-contained business-flow E2Es (standard scenarios 1-12).
# ------------------------------------------------------------------
# These scripts start their OWN backend + mock LLM on a dedicated port (they
# do not reuse the running $API_BASE), so they are safe to run alongside the
# API/MCP checks above. They freeze the dogfooding standard business flows
# (業態×操作) against the deterministic local LLM mock — the CI-enforced
# regression that a plain curl probe cannot give. Requires the venv and free
# ports 8005-8007.
if [ -x "$VENV_PYTHON" ] && [ -f alembic.ini ]; then
  # DOGFOOD-10 案A: run each E2E from a same-dir snapshot so a concurrent
  # iteration appending a scenario cannot corrupt a running check.
  check "Business-flow E2E (scenarios 1-12, mock LLM)" \
    run_e2e_snapshot "$ROOT_DIR/03_Implement/backend/scripts/verify_business_flow_e2e.sh" 8005
  check "Admin CLI/API ops flow E2E (scenario 4)" \
    run_e2e_snapshot "$ROOT_DIR/03_Implement/backend/scripts/verify_admin_ops_flow_e2e.sh" 8006
  check "KJ multi-round collaboration E2E (mock LLM)" \
    run_e2e_snapshot "$ROOT_DIR/03_Implement/backend/scripts/verify_sui_multi_round.sh" 8007
  # MCP read -> CE-4 audit (channel=mcp) -> HTTP sink. Self-contained: starts
  # its own audit sink + migrated backend on free ports; runs verify_mcp.ts.
  # Requires the mcp package's node_modules (npm install) — the script reports
  # an explicit SKIP-style exit 2 when absent, not a hard failure.
  check "MCP CE-4 audit e2e (channel=mcp reaches sink)" \
    "$VENV_PYTHON" "$ROOT_DIR/03_Implement/backend/scripts/verify_mcp_ce4_audit_e2e.py"
  # `kj` CLI -> CE-4 audit (channel=cli) -> HTTP sink. Self-contained, mirrors
  # the MCP audit e2e but drives the CLI's context-query (the admin-scriptable
  # non-Web path, channel=cli). Backend runs keyless (local-dev open mode) —
  # the CLI carries no X-API-Key, which is exactly the deployment this covers.
  check "CLI CE-4 audit e2e (channel=cli reaches sink)" \
    "$VENV_PYTHON" "$ROOT_DIR/03_Implement/backend/scripts/verify_cli_ce4_audit_e2e.py"
else
  echo "  SKIP: business-flow E2Es — backend venv/alembic.ini not found"
fi

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
echo ""
echo "=== Verification Summary ==="
if [ $failures -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
else
  echo -e "${RED}${failures} check(s) failed.${NC}"
  exit 1
fi
