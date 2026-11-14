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
