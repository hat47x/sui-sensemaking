"""R1 reference: read an explicitly selected local raw file and a UTF-8 byte span.

Not a SUI Product API, source store, authorization service, or Handoff contract.
The caller must supply an already-authorized local root and exact expected digest.
This bounded read is only a functional probe; it does not enforce host policy or
prove the absence of filesystem races, external effects, or A->B->A revisions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
from pathlib import Path, PurePosixPath

MAX_SOURCE_BYTES = 1024 * 1024
_DIGEST = re.compile(r"[0-9a-f]{64}\Z")


class ProbeError(Exception):
    """A scoped, non-disclosing negative observation from the reference."""

    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


def _resolve_local_file(root: Path, relative_path: str) -> tuple[Path, str]:
    """Reject obvious traversal/symlinks; not an OS sandbox or security grant."""
    if not relative_path or "\\" in relative_path:
        raise ProbeError("invalid-request")
    rel = PurePosixPath(relative_path)
    if rel.is_absolute() or not rel.parts or ".." in rel.parts or ":" in rel.parts[0]:
        raise ProbeError("invalid-request")
    if root.is_symlink():
        raise ProbeError("invalid-request")
    try:
        fixed_root = root.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ProbeError("unavailable") from exc
    if not fixed_root.is_dir():
        raise ProbeError("invalid-request")
    candidate = fixed_root
    for part in rel.parts:
        candidate = candidate / part
        if candidate.is_symlink():
            raise ProbeError("invalid-request")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(fixed_root)
    except FileNotFoundError as exc:
        raise ProbeError("unavailable") from exc
    except (OSError, RuntimeError, ValueError) as exc:
        raise ProbeError("invalid-request") from exc
    if not resolved.is_file():
        raise ProbeError("invalid-request")
    return resolved, rel.as_posix()


def inspect_span(
    *, root: Path, relative_path: str, expected_sha256: str, start: int, end: int
) -> dict[str, object]:
    """Verify actual read bytes and a half-open UTF-8 byte slice, without writes."""
    if not _DIGEST.fullmatch(expected_sha256) or start < 0 or end <= start:
        raise ProbeError("invalid-request")
    source, display_path = _resolve_local_file(root, relative_path)
    try:
        # O_NOFOLLOW guards the final leaf where supported. Parent components
        # are screened above, but this is NOT a race-free OS sandbox.
        fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(fd, "rb") as stream:
            first = os.fstat(stream.fileno())
            if not stat.S_ISREG(first.st_mode) or first.st_size > MAX_SOURCE_BYTES:
                raise ProbeError("unqualified")
            raw = stream.read(MAX_SOURCE_BYTES + 1)
            last = os.fstat(stream.fileno())
        now = source.stat()
    except ProbeError:
        raise
    except FileNotFoundError as exc:
        raise ProbeError("unavailable") from exc
    except OSError as exc:
        raise ProbeError("unavailable") from exc
    if len(raw) > MAX_SOURCE_BYTES or (
        (first.st_dev, first.st_ino, first.st_size, first.st_mtime_ns)
        != (last.st_dev, last.st_ino, last.st_size, last.st_mtime_ns)
        or (last.st_dev, last.st_ino, last.st_size, last.st_mtime_ns)
        != (now.st_dev, now.st_ino, now.st_size, now.st_mtime_ns)
    ):
        raise ProbeError("unqualified")
    actual_digest = hashlib.sha256(raw).hexdigest()
    if actual_digest != expected_sha256:
        raise ProbeError("stale")
    if end > len(raw):
        raise ProbeError("invalid-request")
    try:
        # Validate the entire file. Never normalize BOM, EOL or Unicode.
        raw.decode("utf-8", errors="strict")
        selected = raw[start:end].decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ProbeError("unqualified") from exc
    return {
        "status": "readback-verified",
        "source": {
            "relative_path": display_path,
            "content_sha256": actual_digest,
            "byte_length": len(raw),
        },
        "selection": {"start_byte": start, "end_byte": end, "text": selected},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Local-only R1 raw byte-span reference probe")
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    args = parser.parse_args()
    try:
        result = inspect_span(
            root=args.root,
            relative_path=args.source,
            expected_sha256=args.expected_sha256,
            start=args.start,
            end=args.end,
        )
    except ProbeError as exc:
        # No private locator, digest or source text in negative diagnostics.
        print(json.dumps({"status": exc.status}, ensure_ascii=False))
        return 3
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
