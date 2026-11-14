"""R2 F0-S reference only: local immutable Raw byte capture.

No Product Source API, Host Grant, Card binding, Source history, or E2E.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from experiments.r2_immutable_snapshot_reference import (
    LocalImmutableSnapshotReference,
    SnapshotConflict,
    SnapshotIntegrityError,
    SnapshotReferenceError,
    SnapshotUnavailable,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
_CHILD_READ = """
import json
import sys
from pathlib import Path
from experiments.r2_immutable_snapshot_reference import LocalImmutableSnapshotReference
root, tenant, capture, expected, start, end = sys.argv[1:]
raw = LocalImmutableSnapshotReference(Path(root)).read(
    tenant_id=tenant, capture_id=capture, expected_sha256=expected
)
print(json.dumps({"bytes": raw.hex(), "selected": raw[int(start):int(end)].hex()}))
"""


def _fresh_reader(root: Path, capture_id: str, digest: str, start: int, end: int) -> dict:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND_DIR)
    p = subprocess.run(
        [
            sys.executable, "-c", _CHILD_READ, str(root),
            "tenant-a", capture_id, digest, str(start), str(end),
        ],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


def test_exact_utf8_capture_recovered_from_fresh_process(tmp_path: Path) -> None:
    raw = bytes.fromhex("efbbbf") + "前文\r\n同じ言葉。🌊\n後文\r同じ言葉。🌊".encode("utf-8")
    repeated = "同じ言葉。🌊".encode("utf-8")
    second = raw.index(repeated, raw.index(repeated) + len(repeated))
    root = tmp_path / "nas"
    writer = LocalImmutableSnapshotReference(root)
    result = writer.put_once(tenant_id="tenant-a", capture_id="capture-1", raw=raw)
    assert result.outcome == "created"
    assert result.byte_size == len(raw)
    assert result.sha256_digest == hashlib.sha256(raw).hexdigest()
    del writer

    observed = _fresh_reader(
        root, "capture-1", hashlib.sha256(raw).hexdigest(), second,
        second + len(repeated),
    )
    assert bytes.fromhex(observed["bytes"]) == raw
    assert bytes.fromhex(observed["selected"]) == repeated


def test_retry_is_idempotent_but_same_capture_cannot_change(tmp_path: Path) -> None:
    store = LocalImmutableSnapshotReference(tmp_path / "nas")
    first = "元の原文。".encode("utf-8")
    changed = "別の原文。".encode("utf-8")
    created = store.put_once(tenant_id="tenant-a", capture_id="c1", raw=first)
    repeat = store.put_once(tenant_id="tenant-a", capture_id="c1", raw=first)
    assert created.outcome == "created"
    assert repeat.outcome == "already-present"
    assert repeat.sha256_digest == created.sha256_digest
    with pytest.raises(SnapshotConflict, match="other bytes"):
        store.put_once(tenant_id="tenant-a", capture_id="c1", raw=changed)
    assert store.read(
        tenant_id="tenant-a", capture_id="c1", expected_sha256=created.sha256_digest
    ) == first
    assert not list((tmp_path / "nas").rglob("*.pending"))


def test_same_bytes_in_distinct_captures_are_not_same_identity(tmp_path: Path) -> None:
    store = LocalImmutableSnapshotReference(tmp_path / "nas")
    raw = "一致する内容。".encode("utf-8")
    a = store.put_once(tenant_id="tenant-a", capture_id="a", raw=raw)
    b = store.put_once(tenant_id="tenant-a", capture_id="b", raw=raw)
    assert a.sha256_digest == b.sha256_digest
    assert a.capture_ref != b.capture_ref
    a_target = store._target("tenant-a", "a")
    b_target = store._target("tenant-a", "b")
    assert a_target != b_target
    assert a_target.read_bytes() == b_target.read_bytes() == raw


def test_invalid_or_tampered_capture_fails_closed(tmp_path: Path) -> None:
    store = LocalImmutableSnapshotReference(tmp_path / "nas")
    with pytest.raises(SnapshotReferenceError, match="unqualified"):
        store.put_once(tenant_id="tenant-a", capture_id="bad", raw=b"\xff")
    with pytest.raises(SnapshotReferenceError, match="unqualified"):
        store.put_once(tenant_id="tenant-a", capture_id="large", raw=b"a" * (1024 * 1024 + 1))
    with pytest.raises(SnapshotReferenceError, match="invalid capture identity"):
        store.put_once(tenant_id="", capture_id="x", raw=b"a")
    with pytest.raises(SnapshotUnavailable, match="unavailable"):
        store.read(tenant_id="tenant-a", capture_id="missing", expected_sha256="0" * 64)

    original = b"first"
    result = store.put_once(tenant_id="tenant-a", capture_id="a", raw=original)
    store._target("tenant-a", "a").write_bytes(b"modified")
    with pytest.raises(SnapshotIntegrityError, match="integrity mismatch"):
        store.read(tenant_id="tenant-a", capture_id="a", expected_sha256=result.sha256_digest)


# This concurrency probe is deliberately POSIX/local-only. The trusted test
# directory is not a grant or sandbox, and the result is not a Product SLA.
_CHILD_WRITE = """
import json
import sys
import time
from pathlib import Path
from experiments.r2_immutable_snapshot_reference import (
    LocalImmutableSnapshotReference, SnapshotConflict
)

root, capture_id, raw_hex, gate, ready = sys.argv[1:]
Path(ready).write_text("ready", encoding="ascii")
deadline = time.monotonic() + 15
while not Path(gate).exists():
    if time.monotonic() > deadline:
        sys.exit(4)
    time.sleep(0.002)
raw = bytes.fromhex(raw_hex)
try:
    result = LocalImmutableSnapshotReference(Path(root)).put_once(
        tenant_id="tenant-a", capture_id=capture_id, raw=raw,
    )
    print(json.dumps({"status": result.outcome, "digest": result.sha256_digest}))
except SnapshotConflict:
    print(json.dumps({"status": "conflict"}))
"""


def _two_process_writes(
    tmp_path: Path, first: bytes, second: bytes
) -> tuple[list[dict], Path]:
    root = tmp_path / "nas"
    gate = tmp_path / "release"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND_DIR)
    processes = []
    try:
        for index, raw in enumerate((first, second)):
            ready = tmp_path / f"ready-{index}"
            process = subprocess.Popen(
                [
                    sys.executable, "-c", _CHILD_WRITE,
                    str(root), "same-capture", raw.hex(), str(gate), str(ready),
                ],
                cwd=BACKEND_DIR,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            processes.append(process)

        import time

        deadline = time.monotonic() + 15
        while not all((tmp_path / f"ready-{i}").exists() for i in range(2)):
            if time.monotonic() > deadline:
                pytest.fail("writers did not reach the concurrency gate")
            time.sleep(0.005)
        gate.write_bytes(b"go")
        observations = []
        for process in processes:
            out, err = process.communicate(timeout=25)
            assert process.returncode == 0, err
            observations.append(json.loads(out))
        return observations, root
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=5)


@pytest.mark.skipif(os.name != "posix", reason="POSIX hard-link reference")
@pytest.mark.parametrize("same_bytes", [True, False])
def test_concurrent_independent_processes_cannot_replace_capture(
    tmp_path: Path, same_bytes: bool,
) -> None:
    first = "原文A。".encode("utf-8")
    second = first if same_bytes else "原文B。".encode("utf-8")
    observations, root = _two_process_writes(tmp_path, first, second)
    observed_statuses = sorted(result["status"] for result in observations)
    if same_bytes:
        assert observed_statuses == ["already-present", "created"]
    else:
        assert observed_statuses == ["conflict", "created"]
    store = LocalImmutableSnapshotReference(root)
    final = store._target("tenant-a", "same-capture").read_bytes()
    assert final in {first, second}
    assert not list(root.rglob("*.pending"))


@pytest.mark.skipif(os.name != "posix", reason="POSIX hard-link reference")
def test_uncommitted_pending_is_not_a_readable_snapshot(tmp_path: Path) -> None:
    store = LocalImmutableSnapshotReference(tmp_path / "nas")
    target = store._target("tenant-a", "capture-1")
    target.parent.mkdir(parents=True, exist_ok=True)
    stale_pending = target.with_name(f".{target.name}.interrupted.pending")
    stale_pending.write_bytes("未完了。".encode("utf-8"))

    with pytest.raises(SnapshotUnavailable, match="unavailable"):
        store.read(
            tenant_id="tenant-a",
            capture_id="capture-1",
            expected_sha256=hashlib.sha256(stale_pending.read_bytes()).hexdigest(),
        )

    raw = "確定した取込。".encode("utf-8")
    result = store.put_once(tenant_id="tenant-a", capture_id="capture-1", raw=raw)
    assert result.outcome == "created"
    assert store.read(
        tenant_id="tenant-a", capture_id="capture-1",
        expected_sha256=result.sha256_digest,
    ) == raw
    # No recovery/GC is claimed: a stale pending object remains for
    # deliberate host-managed cleanup after an interrupted write.
    assert stale_pending.exists()
