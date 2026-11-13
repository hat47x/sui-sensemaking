"""Independent R1 reference checks; not tests of the SUI Product Raw API."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

PROBE = Path(__file__).resolve().parents[1] / "experiments" / "r1_raw_source_probe.py"


def _call(root: Path, rel: str, expected: str, start: int, end: int) -> tuple[int, dict]:
    result = subprocess.run(
        [
            sys.executable,
            str(PROBE),
            "--root", str(root),
            "--source", rel,
            "--expected-sha256", expected,
            "--start", str(start),
            "--end", str(end),
        ],
        text=True,
        capture_output=True,
        check=False,
        timeout=15,
    )
    assert result.stderr == "", result.stderr
    return result.returncode, json.loads(result.stdout)


def test_new_process_reads_exact_second_utf8_occurrence(tmp_path: Path) -> None:
    # Independent expected: the second occurrence, not a normalized substring.
    data = b"\xef\xbb\xbf" + "前文\r\n同じ言葉。\n後文\r同じ言葉。".encode()
    source = tmp_path / "interview.txt"
    source.write_bytes(data)
    target = "同じ言葉。".encode()
    start = data.index(target, data.index(target) + len(target))
    result_code, result = _call(
        tmp_path, "interview.txt", hashlib.sha256(data).hexdigest(), start, start + len(target)
    )
    assert result_code == 0
    assert result == {
        "status": "readback-verified",
        "source": {
            "relative_path": "interview.txt",
            "content_sha256": hashlib.sha256(data).hexdigest(),
            "byte_length": len(data),
        },
        "selection": {
            "start_byte": start,
            "end_byte": start + len(target),
            "text": "同じ言葉。",
        },
    }
    # A human may use this candidate for a Card; Product Card/Source binding
    # and UI selection are NOT implemented by this reference.


def test_old_digest_stops_after_raw_content_change(tmp_path: Path) -> None:
    source = tmp_path / "raw.txt"
    first = "何か引っかかる。".encode()
    second = "別の内容になった。".encode()
    source.write_bytes(first)
    digest = hashlib.sha256(first).hexdigest()
    source.write_bytes(second)
    rc, observed = _call(tmp_path, "raw.txt", digest, 0, len(first))
    assert rc == 3
    assert observed == {"status": "stale"}
    # A -> B -> A cannot be detected from a content digest alone.
    source.write_bytes(first)
    rc, observed = _call(tmp_path, "raw.txt", digest, 0, len(first))
    assert rc == 0
    assert observed["status"] == "readback-verified"


def test_same_bytes_different_source_path_not_same_identity(tmp_path: Path) -> None:
    raw = "同じ文書内容".encode()
    (tmp_path / "a.txt").write_bytes(raw)
    (tmp_path / "b.txt").write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    first_rc, first = _call(tmp_path, "a.txt", digest, 0, len(raw))
    second_rc, second = _call(tmp_path, "b.txt", digest, 0, len(raw))
    assert first_rc == second_rc == 0
    assert first["source"]["content_sha256"] == second["source"]["content_sha256"]
    assert first["source"]["relative_path"] != second["source"]["relative_path"]


@pytest.mark.parametrize(
    "path",
    ["../elsewhere.txt", "/absolute.txt", "nested/../../elsewhere.txt", "C:/external.txt"],
)
def test_traversal_and_absolute_paths_fail_closed(tmp_path: Path, path: str) -> None:
    rc, result = _call(tmp_path, path, "0" * 64, 0, 1)
    assert rc == 3
    assert result == {"status": "invalid-request"}


def test_symlink_is_not_a_source_reference(tmp_path: Path) -> None:
    actual = tmp_path / "actual.txt"
    actual.write_bytes(b"a")
    alias = tmp_path / "link.txt"
    try:
        alias.symlink_to(actual)
    except (OSError, NotImplementedError):
        pytest.skip("symlink unavailable in runner")
    rc, result = _call(tmp_path, "link.txt", hashlib.sha256(b"a").hexdigest(), 0, 1)
    assert rc == 3
    assert result == {"status": "invalid-request"}


def test_multibyte_midpoint_and_bad_utf8_are_not_source_spans(tmp_path: Path) -> None:
    valid = "海を読む".encode()
    (tmp_path / "raw.txt").write_bytes(valid)
    rc, result = _call(tmp_path, "raw.txt", hashlib.sha256(valid).hexdigest(), 1, len(valid))
    assert rc == 3
    assert result == {"status": "unqualified"}
    invalid = b"\xff\xfe"
    (tmp_path / "raw.txt").write_bytes(invalid)
    rc, result = _call(tmp_path, "raw.txt", hashlib.sha256(invalid).hexdigest(), 0, len(invalid))
    assert rc == 3
    assert result == {"status": "unqualified"}


def test_missing_source_and_oversize_are_not_verified(tmp_path: Path) -> None:
    rc, result = _call(tmp_path, "missing.txt", "0" * 64, 0, 1)
    assert rc == 3
    assert result == {"status": "unavailable"}
    large = b"a" * ((1024 * 1024) + 1)
    (tmp_path / "large.txt").write_bytes(large)
    rc, result = _call(tmp_path, "large.txt", hashlib.sha256(large).hexdigest(), 0, 1)
    assert rc == 3
    assert result == {"status": "unqualified"}
