#!/usr/bin/env python3
"""Dogfood E2E: MCP read is audited through the backend's CE-4 audit trail.

Proves the "generative-AI verifies via MCP" path end-to-end: an MCP-originated
read of a document is reported to the backend's POST /docs/{id}/context-audit
with channel="mcp", and that event reaches the configured HTTP audit sink.

Chain exercised (self-contained, deterministic, no billing):
  audit sink (this script) <- POST <- backend (uvicorn, audit transport=http)
      <- POST /docs/{id}/context-audit (channel=mcp, operation=query)
          <- MCP server (03_Implement/mcp, get_context_projection)
              <- verify_mcp.ts (stdio generative-AI MCP client path)
              <- dogfood_mcp_http_e2e.mjs (OAuth scope + HTTP client path)

Usage:
  .venv/bin/python scripts/verify_mcp_ce4_audit_e2e.py [PORT]

Requires the backend venv (uvicorn/alembic) and the mcp package's node_modules
(npm install already run). Uses free ports for the backend and audit sink.
"""

from __future__ import annotations

import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = os.path.dirname(os.path.dirname(BACKEND_DIR))
MCP_DIR = os.path.join(ROOT_DIR, "03_Implement", "mcp")
VENV_PYTHON = os.path.join(BACKEND_DIR, ".venv", "bin", "python")
BIZ_KEY = "biz-test-key-mcp-audit"
DOC_ID = "mcp-audit-doc"
# SEC-AUDIT-DUP-01 (02_Architecture/api.md, POST /docs/{id}/context-audit): an
# identical logical POST (tenant/doc/operation/equivalenceKey/bundleHash) inside
# this window reaches the audit sink only once, while every HTTP response stays
# "accepted". Each MCP read below is a separate audited read, so it must start
# after the previous read's window has expired. Pinned here to the documented
# default so the expected count does not depend on the environment.
AUDIT_DEDUP_WINDOW_SECONDS = 5.0

PASS = 0
FAIL = 0


def check(desc: str, expected, actual) -> None:
    global PASS, FAIL
    if actual == expected:
        print(f"  PASS: {desc}")
        PASS += 1
    else:
        print(f"  FAIL: {desc} (expected {expected}, got {actual})")
        FAIL += 1


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class AuditSink:
    """Captures the backend's HTTP audit POSTs in-process for later assertion."""

    def __init__(self, port: int) -> None:
        self.events: list[dict] = []
        self._lock = threading.Lock()

        class _Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if length else b""
                try:
                    with events_lock:
                        _events.append(json.loads(body.decode("utf-8")))
                except (ValueError, UnicodeDecodeError):
                    pass  # not a JSON audit event; ignore
                self.send_response(200)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *_args) -> None:  # keep the console quiet
                return

        # closure bucket + lock shared with the handler above
        _events: list[dict] = self.events
        events_lock: threading.Lock = self._lock

        self._server = http.server.ThreadingHTTPServer(("127.0.0.1", port), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def snapshot(self) -> list[dict]:
        with self._lock:
            return list(self.events)


def _migrate(db_path: str) -> None:
    env = dict(os.environ, SUI_DATABASE_URL=f"sqlite:///{db_path}")
    subprocess.run(
        [VENV_PYTHON, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        check=True,
        capture_output=True,
    )


def _put_document(base_url: str, doc: dict) -> None:
    req = urllib.request.Request(
        f"{base_url}/docs/{doc['id']}",
        data=json.dumps(doc).encode("utf-8"),
        method="PUT",
        headers={
            "Content-Type": "application/json",
            "X-API-Key": BIZ_KEY,
            # Same reviewer identity the CE4 decision uses, so the doc is owned
            # by the reviewer (the decision route requires actor_ref AND write
            # access to the doc).
            "x-forwarded-user": "mcp-audit-reviewer",
            "x-auth-provider": "oidc",
        },
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status != 200:
            raise RuntimeError(f"PUT document failed: HTTP {resp.status}")


def _post_json(base_url: str, path: str, body: dict, extra_headers: dict | None = None) -> int:
    headers = {"Content-Type": "application/json", "X-API-Key": BIZ_KEY}
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(
        f"{base_url}{path}",
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code


def _get_json(base_url: str, path: str) -> tuple[int, dict | None]:
    req = urllib.request.Request(
        f"{base_url}{path}",
        headers={"X-API-Key": BIZ_KEY},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return exc.code, None


def main() -> int:
    if not os.path.isdir(MCP_DIR) or not os.path.exists(os.path.join(MCP_DIR, "node_modules", ".bin", "tsx")):
        print("verify_mcp_ce4_audit_e2e.py: mcp package deps not installed (cd 03_Implement/mcp && npm install)")
        return 2

    sink_port = free_port()
    backend_port = free_port()
    base_url = f"http://127.0.0.1:{backend_port}"
    sink = AuditSink(sink_port)
    sink.start()

    tmp = tempfile.mkdtemp(prefix="kj_mcp_audit_")
    db_path = os.path.join(tmp, "mcp_audit.sqlite3")
    backend_proc: subprocess.Popen | None = None
    try:
        print("=== MCP read -> CE-4 audit (channel=mcp) -> HTTP sink e2e ===")
        _migrate(db_path)

        backend_env = dict(
            os.environ,
            SUI_DATABASE_URL=f"sqlite:///{db_path}",
            SUI_API_KEY=BIZ_KEY,
            SUI_ADMIN_API_KEY="adm-test-key-mcp-audit",
            SUI_AUDIT_EXPORT_ENABLED="1",
            SUI_AUDIT_TRANSPORT="http",
            SUI_AUDIT_HTTP_ENDPOINT=f"http://127.0.0.1:{sink_port}/audit",
            # MCP reads are safeMode=true by default; the audit dispatcher drops
            # safe-mode events unless this is set, so the audit-chain E2E enables
            # it to prove the channel=mcp event is actually delivered.
            SUI_AUDIT_ALLOW_IN_SAFE_MODE="1",
            SUI_AUDIT_DEDUP_WINDOW_SECONDS=str(AUDIT_DEDUP_WINDOW_SECONDS),
            # CE4 proposal decision requires an authenticated reviewer
            # (actor_ref), provided via x-forwarded-user; JIT-provision that
            # reviewer so the doc and the decision share one identity.
            SUI_ALLOW_JIT_PROVISIONING="true",
        )
        backend_proc = subprocess.Popen(
            [VENV_PYTHON, "-m", "uvicorn", "sui_sensemaking_api.main:app", "--port", str(backend_port), "--host", "127.0.0.1"],
            cwd=BACKEND_DIR,
            env=backend_env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        for _ in range(40):
            try:
                with urllib.request.urlopen(f"{base_url}/healthz", timeout=1) as resp:
                    if resp.status == 200:
                        break
            except Exception:
                pass
            time.sleep(0.5)
        check("backend /healthz", 200, _health(base_url))

        doc = {
            "version": 1,
            "id": DOC_ID,
            "title": "MCP audit e2e",
            "createdAt": "2026-08-16T00:00:00Z",
            "updatedAt": "2026-08-16T00:00:00Z",
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": [{"id": "c1", "text": "レビュー済みのカード", "x": 0, "y": 0, "textReviewed": True}],
            "edges": [],
            "islands": [{"id": "i1", "cardIds": ["c1"]}],
            "readingOrder": ["i1"],
        }
        _put_document(base_url, doc)
        check("PUT document (200)", 200, 200)

        # 3b. Register an external-agent proposal on the doc so verify_mcp.ts's
        #     get_proposal_status sees a REAL CE4 proposal (proposal-only), not
        #     an empty list -- the generative-AI MCP verification of the full
        #     proposal lifecycle (proposed -> decided).
        base_sig = f"{DOC_ID}:{doc['updatedAt']}"
        _task = {
            "docId": DOC_ID,
            "taskId": "mcp-audit-task",
            "baseDocSignature": base_sig,
            "sourceBundleHash": "a" * 64,
            "queryCanonicalHash": "b" * 64,
            "taskKind": "critique_suggestions",
            "provenanceLevel": "user_presented_unsigned",
        }
        _proposal = {
            "docId": DOC_ID,
            "taskId": "mcp-audit-task",
            "baseDocSignature": base_sig,
            "sourceBundleHash": "a" * 64,
            "queryCanonicalHash": "b" * 64,
            "proposalId": "mcp-audit-proposal",
            "proposalKind": "critique",
            "proposalFingerprint": "c" * 64,
            "provenanceLevel": "user_presented_unsigned",
        }
        check("external task register (200)", 200, _post_json(base_url, "/ai/external-tasks/register", _task))
        check("external proposal register (200)", 200, _post_json(base_url, "/ai/external-proposals/register", _proposal))

        # 4. Run the generative-AI MCP client path (verify_mcp.ts) against this
        #    backend. It calls get_context_projection -> triggers the CE-4 emit.
        mcp_env = dict(
            os.environ,
            SUI_MCP_API_BASE_URL=base_url,
            SUI_API_KEY=BIZ_KEY,
        )
        if os.name != "nt" and os.path.isdir("/tmp"):
            # WSL may inherit Windows TEMP/TMP paths. tsx uses the selected
            # temp directory for an IPC socket, which is unsupported on drvfs.
            mcp_env["TMPDIR"] = "/tmp"
        node_cli = (
            (os.environ.get("SUI_NODE_BIN") or "").strip()
            or shutil.which("node")
        )
        if node_cli is None:
            print("node is required for MCP HTTP e2e")
            return 2
        try:
            node_version = subprocess.run(
                [node_cli, "--version"],
                capture_output=True,
                text=True,
                timeout=10,
                check=True,
            ).stdout.strip()
            node_major = int(node_version.removeprefix("v").split(".", 1)[0])
        except (OSError, subprocess.SubprocessError, ValueError):
            print(f"unable to validate MCP Node runtime: {node_cli}")
            return 2
        if node_major < 20:
            print(
                "MCP e2e requires Node.js 20+; set SUI_NODE_BIN to a "
                f"compatible same-platform runtime (selected {node_version})"
            )
            return 2
        # Invoke the JS entrypoint through the selected runtime instead of the
        # package .bin shebang. This lets WSL callers select a current Linux
        # runtime without /usr/bin/env falling back to an obsolete PATH entry.
        tsx_cli = os.path.join("node_modules", "tsx", "dist", "cli.mjs")
        proc = subprocess.run(
            [node_cli, tsx_cli, "scripts/verify_mcp.ts", DOC_ID, "reviewed-only"],
            cwd=MCP_DIR,
            env=mcp_env,
            capture_output=True,
            text=True,
            timeout=180,
        )
        check("MCP client (verify_mcp.ts) exit", 0, proc.returncode)
        if proc.returncode != 0:
            print(proc.stdout[-2000:])
            print(proc.stderr[-2000:])

        # Exercise the remote-client transport against the same real backend.
        # The HTTP harness first proves that a valid signed token without the
        # read:context scope is denied, then completes the authorized tool call.
        # Start it only after the previous read's dedup window has expired (see
        # AUDIT_DEDUP_WINDOW_SECONDS); otherwise its identical CE-4 event is
        # collapsed into the stdio read's event by design.
        time.sleep(AUDIT_DEDUP_WINDOW_SECONDS + 1.0)
        http_proc = subprocess.run(
            [node_cli, "scripts/dogfood_mcp_http_e2e.mjs", DOC_ID],
            cwd=MCP_DIR,
            env=mcp_env,
            capture_output=True,
            text=True,
            timeout=180,
        )
        check("MCP HTTP client (scope denial + authorized call) exit", 0, http_proc.returncode)
        if http_proc.returncode != 0:
            print(http_proc.stdout[-2000:])
            print(http_proc.stderr[-2000:])

        # 4b. CE4 decision reflection: verify_mcp.ts's get_proposal_status saw the
        #     proposal as "proposed"; a human decision (adopt) flips it to
        #     "accepted" with decidedAt -- the read-only status API reflects the
        #     lifecycle (proposal-only -> decided).
        check(
            "external proposal decision (adopt 200)",
            200,
            _post_json(
                base_url,
                "/ai/external-proposals/audit",
                {
                    "docId": DOC_ID,
                    "proposalId": "mcp-audit-proposal",
                    "sourceBundleHash": "a" * 64,
                    "idempotencyKey": "mcp-audit-decision",
                    "decision": "adopt",
                    "provenanceLevel": "user_presented_unsigned",
                },
                # The decision route requires an authenticated reviewer
                # (actor_ref); the MCP e2e backend is keyless local-dev, so the
                # reviewer identity travels via the forwarded-user header.
                extra_headers={"x-forwarded-user": "mcp-audit-reviewer", "x-auth-provider": "oidc"},
            ),
        )
        status_code, status_body = _get_json(base_url, f"/ai/proposals/status?docId={DOC_ID}")
        check("GET /ai/proposals/status after decision (200)", 200, status_code)
        _decided = [
            p
            for p in (status_body or {}).get("proposals", [])
            if p.get("proposalId") == "mcp-audit-proposal"
        ]
        check(
            "proposal status reflects human decision (accepted + decidedAt)",
            True,
            len(_decided) == 1 and _decided[0].get("status") == "accepted" and bool(_decided[0].get("decidedAt")),
        )

        # 4c. MCP-side decision reflection: re-run verify_mcp.ts after the human
        #     decision so a generative-AI verifier confirms the CE4 proposal is
        #     now decided (accepted) via the MCP get_proposal_status tool.
        # Same dedup-window separation before the second stdio read.
        time.sleep(AUDIT_DEDUP_WINDOW_SECONDS + 1.0)
        proc2 = subprocess.run(
            [node_cli, tsx_cli, "scripts/verify_mcp.ts", DOC_ID, "reviewed-only"],
            cwd=MCP_DIR,
            env=mcp_env,
            capture_output=True,
            text=True,
            timeout=180,
        )
        check("MCP client re-run after decision (verify_mcp.ts) exit", 0, proc2.returncode)
        check(
            "MCP get_proposal_status reflects decided state (accepted)",
            True,
            "accepted" in (proc2.stdout or "") and "proposals: 1" in (proc2.stdout or ""),
        )
        if proc2.returncode != 0:
            print(proc2.stdout[-2000:])
            print(proc2.stderr[-2000:])

        # 5. Give the async audit queue a moment, then assert the sink saw the
        #    channel=mcp context-audit events for this document. One event per
        #    read session is expected: each verify_mcp.ts run issues two
        #    identical get_context_projection calls (the second is the bundle
        #    determinism check), which the dedup window collapses into one, and
        #    the HTTP client call contributes one. 2 stdio runs + 1 HTTP = 3.
        time.sleep(1.0)
        events = sink.snapshot()
        mcp_events = [
            e for e in events
            if e.get("eventType") == "query"
            and e.get("docId") == DOC_ID
            and isinstance(e.get("metadata"), dict)
            and e["metadata"].get("channel") == "mcp"
        ]
        check("audit sink received stdio x2 + HTTP channel=mcp events", 3, len(mcp_events))
        if mcp_events:
            meta = mcp_events[0]["metadata"]
            check("metadata.operation=query", "query", meta.get("operation"))
            check("metadata.command=context-query", "context-query", meta.get("command"))
            check("metadata.equivalenceKey present (64hex)", 64, len(meta.get("equivalenceKey") or ""))
            check("metadata.bundleHash present (64hex)", 64, len(meta.get("bundleHash") or ""))

        print(f"=== Result: {PASS} passed, {FAIL} failed ===")
        return 0 if FAIL == 0 else 1
    finally:
        if backend_proc is not None:
            backend_proc.terminate()
            try:
                backend_proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                backend_proc.kill()
        sink.stop()
        shutil.rmtree(tmp, ignore_errors=True)


def _health(base_url: str) -> int:
    try:
        with urllib.request.urlopen(f"{base_url}/healthz", timeout=2) as resp:
            return resp.status
    except Exception:
        return 0


if __name__ == "__main__":
    sys.exit(main())
