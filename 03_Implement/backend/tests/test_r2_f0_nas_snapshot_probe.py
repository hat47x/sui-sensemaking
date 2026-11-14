"""R2 F0-S characterization of the *existing* NAS content store.

These tests use public synthetic Raw UTF-8 bytes and a fresh Python process.
They do NOT demonstrate a Product Raw Source API, Host/Source Grant, immutable
Source Snapshot, Card Binding, or Document/Source combined readback.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from sui_sensemaking_api.content_store import ContentBlob
from sui_sensemaking_api.external_content_store import ContentIntegrityError, NasContentStore

BACKEND_DIR = Path(__file__).resolve().parents[1]
_CHILD_SCRIPT = """
import json
import sys
from pathlib import Path
from sui_sensemaking_api.external_content_store import NasContentStore

root, locator, byte_size, digest, start, end = sys.argv[1:]
content = NasContentStore(Path(root)).get(
    locator=locator,
    expected_size=int(byte_size),
    expected_digest=digest,
)
raw = content.text.encode("utf-8")
print(json.dumps({
    "raw_hex": raw.hex(),
    "selection_hex": raw[int(start):int(end)].hex(),
    "size": content.byte_size,
    "digest": content.sha256_digest,
}))
"""


def _read_from_fresh_process(
    root: Path, locator: str, content: ContentBlob, start: int, end: int
) -> dict:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND_DIR / "src")
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            _CHILD_SCRIPT,
            str(root),
            locator,
            str(content.byte_size),
            content.sha256_digest,
            str(start),
            str(end),
        ],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    return json.loads(completed.stdout)


def test_existing_nas_store_preserves_raw_utf8_bytes_in_fresh_process(
    tmp_path: Path,
) -> None:
    # Exactly the original bytes: leading UTF-8 BOM, mixed CRLF/LF/CR,
    # Japanese text and a non-BMP character. No BOM/EOL normalization.
    raw = b"\\xef\\xbb\\xbf" + "前文\\r\\n同じ言葉。🌊\\n後文\\r同じ言葉。🌊".encode("utf-8")
    repeated = "同じ言葉。🌊".encode("utf-8")
    first = raw.index(repeated)
    second = raw.index(repeated, first + len(repeated))
    selection_end = second + len(repeated)
    assert first != second

    # UTF-8-only feasibility: decode without stripping the BOM and re-encode
    # exactly. This is not a general original-byte Source storage contract.
    captured = ContentBlob.from_text(raw.decode("utf-8", errors="strict"))
    assert captured.text.encode("utf-8") == raw
    root = tmp_path / "nas"
    writer = NasContentStore(root)
    first_locator = writer.put(
        tenant_id="tenant-a", content_id="capture-1", content=captured
    )
    second_locator = writer.put(
        tenant_id="tenant-a", content_id="capture-2", content=captured
    )
    assert first_locator != second_locator  # caller-supplied capture identity
    del writer

    actual = _read_from_fresh_process(
        root, second_locator, captured, second, selection_end
    )
    assert bytes.fromhex(actual["raw_hex"]) == raw
    assert bytes.fromhex(actual["selection_hex"]) == repeated
    assert actual["size"] == len(raw)
    assert actual["digest"] == captured.sha256_digest


def test_existing_nas_put_overwrites_a_reused_capture_key(tmp_path: Path) -> None:
    """Characterize a blocker: put() is replaceable, not an immutable capture.

    Update this characterization when a formally approved Source Snapshot
    provider rejects same-key replacement. Do not use the current behavior
    as a Product Snapshot acceptance condition.
    """
    store = NasContentStore(tmp_path / "nas")
    original = ContentBlob.from_text("元の原文。")
    changed = ContentBlob.from_text("書き換えた原文。")
    original_locator = store.put(
        tenant_id="tenant-a", content_id="capture-1", content=original
    )
    changed_locator = store.put(
        tenant_id="tenant-a", content_id="capture-1", content=changed
    )
    assert changed_locator == original_locator

    with pytest.raises(ContentIntegrityError, match="integrity metadata"):
        store.get(
            locator=original_locator,
            expected_size=original.byte_size,
            expected_digest=original.sha256_digest,
        )
    assert store.get(
        locator=changed_locator,
        expected_size=changed.byte_size,
        expected_digest=changed.sha256_digest,
    ) == changed
