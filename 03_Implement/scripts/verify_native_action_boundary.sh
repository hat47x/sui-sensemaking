#!/usr/bin/env bash
# Manual, opt-in verification of TEI #993 / SUI's native Action boundary.
# Does not enable production Action routing, invoke CI, or modify PR status.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
head_sha="$(git rev-parse HEAD)"
expected_sha="${SUI_ACTION_EXPECTED_SHA:-}"

if [[ -n "$expected_sha" && "$head_sha" != "$expected_sha" ]]; then
  printf 'FAIL: checked-out HEAD %s does not match requested %s\n' "$head_sha" "$expected_sha" >&2
  exit 2
fi

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "FAIL: working tree is not clean; exact-head evidence would be ambiguous" >&2
  exit 2
fi

echo "SUI Action manual verification: revision=$head_sha"
echo "This does not exercise a live TEI Go Host or React Canvas."

cd "$root/03_Implement/backend"
echo "== Syntax and critical Action-envelope structural invariants =="
python -m compileall -q src/sui_sensemaking_api/routes/docs.py \
  src/sui_sensemaking_api/card_move_command.py \
  tests/test_docs_roundtrip.py
python - <<'PY'
import ast
from collections import Counter
from pathlib import Path

path = Path("src/sui_sensemaking_api/routes/docs.py")
tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
top = Counter(node.name for node in tree.body if isinstance(
    node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
))
for name in ("_SuiCardMoveActionIntent", "post_sui_card_move_action",
             "_commit_sui_card_move_action", "_native_action_same_origin"):
    assert top[name] == 1, f"{name} must be defined exactly once, got {top[name]}"
envelope = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                and node.name == "_SuiCardMoveActionIntent")
fields = Counter(node.target.id for node in envelope.body if isinstance(node, ast.AnnAssign)
                 and isinstance(node.target, ast.Name))
for name in ("protocolVersion", "applicationID", "resourceID", "actionID",
             "expectedRevision", "payload"):
    assert fields[name] == 1, f"Action envelope field {name} is missing/duplicated"

client = Path("../frontend/src/api/client.ts").read_text(encoding="utf-8")
for signature in ("function isStrongSuiRevision(", "function formatIfMatchHeader(",
                  "export async function getAuthoritativeDocument(",
                  "export async function commitSuiCardMoveAction(",
                  "export async function putDocument("):
    assert client.count(signature) == 1, f"{signature} is missing/duplicated"
print("PASS: Action envelope fields, route definitions, client function signatures")
PY

echo "== Python command, SQLite persistence, middleware and route authorization tests =="
python -m pytest -q \
  tests/test_card_move_command.py \
  tests/test_docs_roundtrip.py \
  tests/test_request_body_safety.py \
  tests/test_tenant_session_precondition.py

cd "$root/03_Implement/frontend"
echo "== TypeScript compile =="
npm run typecheck

echo "== Client transport, Canvas domain parity and port integration =="
npm test -- \
  src/api/client.test.ts \
  src/api/tei_card_move_action.integration.test.ts \
  src/domain/card_drag_commit.test.ts \
  src/domain/confirmed_card_move_state.test.ts

echo "== Node native Action adapter =="
node --experimental-strip-types --test src/api/tei_card_move_action.node-test.mjs

if [[ "${SUI_ACTION_FULL_FRONTEND:-0}" == "1" ]]; then
  echo "== Full frontend unit regression (opt-in) =="
  npm test
  echo "== Frontend release build (opt-in) =="
  npm run build
fi

cd "$root"
if [[ "$(git rev-parse HEAD)" != "$head_sha" ||
      -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "FAIL: HEAD or working tree changed during tests" >&2
  exit 3
fi

echo "PASS: exact-head SUI Action verification finished on $head_sha"
echo "Still required separately: live TEI Host delegation, real session/CSRF, React Undo/dirty and browser E2E."
