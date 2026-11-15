"""R2 F0-S, bounded local-only immutable Raw Snapshot reference.

NOT a Product Source Provider, authorization service, public API, OS sandbox,
multi-node store, or original-File freshness proof. Only a trusted local test
root and synthetic UTF-8 bytes are permitted for the current experiments.
"""

from __future__ import annotations

import os
import re
import stat
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Literal
from uuid import uuid4

MAX_BYTES = 1024 * 1024
_DIGEST_RE = re.compile(r"[0-9a-f]{64}\Z")


class SnapshotReferenceError(RuntimeError):
    """Base error deliberately omits the internal location and Raw contents."""


class SnapshotConflict(SnapshotReferenceError):
    """The same capture identity already holds different Raw bytes."""


class SnapshotUnavailable(SnapshotReferenceError):
    """There is no usable committed snapshot under the given local root."""


class SnapshotIntegrityError(SnapshotReferenceError):
    """The stored bytes do not match the independently supplied digest."""


@dataclass(frozen=True)
class SnapshotWriteObservation:
    capture_ref: str
    byte_size: int
    sha256_digest: str
    outcome: Literal["created", "already-present"]


class LocalImmutableSnapshotReference:
    def __init__(self, root: Path) -> None:
        # Trusted local root supplied by the test. No hostile OS traversal
        # or writable-root protection is claimed.
        self._root = root.resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _target(self, tenant_id: str, capture_id: str) -> Path:
        if (
            not isinstance(tenant_id, str)
            or not isinstance(capture_id, str)
            or not 0 < len(tenant_id) <= 128
            or not 0 < len(capture_id) <= 128
            or not tenant_id.strip()
            or not capture_id.strip()
        ):
            raise SnapshotReferenceError("invalid capture identity")
        tenant_key = sha256(tenant_id.encode("utf-8")).hexdigest()
        capture_key = sha256(capture_id.encode("utf-8")).hexdigest()
        return self._root / tenant_key / f"{capture_key}.raw"

    @staticmethod
    def _validate_bytes(raw: bytes) -> str:
        if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BYTES:
            raise SnapshotReferenceError("unqualified Raw bytes")
        try:
            raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise SnapshotReferenceError("unqualified Raw encoding") from exc
        return sha256(raw).hexdigest()

    @staticmethod
    def _load_exact(path: Path) -> bytes:
        try:
            # No-follow on the final file where supported; the trusted test
            # root is NOT a race-free or cross-principal security boundary.
            fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            with os.fdopen(fd, "rb") as stream:
                before = os.fstat(stream.fileno())
                if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_BYTES:
                    raise SnapshotIntegrityError("invalid stored snapshot")
                raw = stream.read(MAX_BYTES + 1)
                after = os.fstat(stream.fileno())
        except FileNotFoundError as exc:
            raise SnapshotUnavailable("snapshot unavailable") from exc
        except OSError as exc:
            raise SnapshotUnavailable("snapshot unavailable") from exc
        if (
            len(raw) > MAX_BYTES
            or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
            != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
        ):
            raise SnapshotIntegrityError("snapshot read not stable")
        return raw

    @staticmethod
    def _sync_directory(directory: Path) -> None:
        # Linux/Unix reference only; cross-platform durability is NOT shown.
        fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def put_once(
        self, *, tenant_id: str, capture_id: str, raw: bytes
    ) -> SnapshotWriteObservation:
        digest = self._validate_bytes(raw)
        target = self._target(tenant_id, capture_id)
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        pending = target.with_name(f".{target.name}.{uuid4().hex}.pending")
        try:
            # Exclusive temporary write, followed by an atomic hard link:
            # unlike os.replace, link() cannot overwrite an existing target.
            fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(pending, target, follow_symlinks=False)
            except FileExistsError:
                current = self._load_exact(target)
                if current != raw:
                    raise SnapshotConflict("capture already holds other bytes")
                return SnapshotWriteObservation(capture_id, len(raw), digest, "already-present")
            self._sync_directory(target.parent)
            return SnapshotWriteObservation(capture_id, len(raw), digest, "created")
        finally:
            pending.unlink(missing_ok=True)

    def read(
        self, *, tenant_id: str, capture_id: str, expected_sha256: str
    ) -> bytes:
        if not isinstance(expected_sha256, str) or not _DIGEST_RE.fullmatch(
            expected_sha256
        ):
            raise SnapshotReferenceError("invalid expected digest")
        raw = self._load_exact(self._target(tenant_id, capture_id))
        if sha256(raw).hexdigest() != expected_sha256:
            raise SnapshotIntegrityError("snapshot integrity mismatch")
        # UTF-8 identity and selected byte ranges are different contracts.
        self._validate_bytes(raw)
        return raw
