#!/usr/bin/env python3
"""Materialize the exact frozen source blobs for COGNITIVE-ASSOC-01.

Benchmark v0 freezes source bytes by Git blob SHA. Source documents may continue
to evolve on main after that freeze, so pre-adjudication reproduction must not
silently substitute the current path contents. This helper reconstructs only
the blob objects named by the frozen manifest into a temporary repository-root
layout for the existing benchmark preparer.

It does not run semantic models and does not change the source manifest.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any

from prepare_cognitive_assoc_benchmark import git_blob_sha


BLOB_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


def load_manifest(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("status") != "pre_adjudication_frozen":
        raise ValueError("manifest must remain pre_adjudication_frozen")
    if value.get("inputContract", {}).get("noModelRunBeforeAdjudication") is not True:
        raise ValueError("semantic baseline gate must remain closed")
    if not value.get("sources"):
        raise ValueError("manifest has no frozen sources")
    return value


def safe_relative_path(raw: str) -> Path:
    value = PurePosixPath(raw)
    if value.is_absolute() or not value.parts or ".." in value.parts:
        raise ValueError(f"unsafe frozen source path: {raw!r}")
    return Path(*value.parts)


def read_git_blob(repo_root: Path, blob_sha: str) -> bytes:
    if not BLOB_SHA_RE.fullmatch(blob_sha):
        raise ValueError(f"invalid Git blob SHA: {blob_sha!r}")
    completed = subprocess.run(
        ["git", "-C", str(repo_root), "cat-file", "blob", blob_sha],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if completed.returncode != 0:
        diagnostic = completed.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"frozen Git blob is unavailable: {blob_sha}: {diagnostic}")
    if git_blob_sha(completed.stdout) != blob_sha:
        raise ValueError(f"Git returned bytes that do not match frozen blob SHA: {blob_sha}")
    return completed.stdout


def materialize(manifest_path: Path, repo_root: Path, output_root: Path) -> list[Path]:
    manifest = load_manifest(manifest_path)
    written: list[Path] = []
    for spec in manifest["sources"]:
        raw_path = spec.get("path")
        blob_sha = spec.get("blobSha")
        if not isinstance(raw_path, str) or not raw_path:
            raise ValueError("frozen source is missing path")
        if not isinstance(blob_sha, str):
            raise ValueError(f"frozen source {raw_path!r} is missing blobSha")
        relative = safe_relative_path(raw_path)
        data = read_git_blob(repo_root, blob_sha)
        target = output_root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        written.append(target)
    return written


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Materialize exact source blobs named by a frozen COGNITIVE-ASSOC manifest."
    )
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output_root", type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    try:
        written = materialize(
            args.manifest.resolve(), args.repo_root.resolve(), args.output_root.resolve()
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"FAIL: {exc}")
        return 1

    for path in written:
        print(f"WROTE_FROZEN_SOURCE: {path}")
    print(f"FROZEN_SOURCE_COUNT: {len(written)}")
    print("SEMANTIC_BASELINE_GATE: CLOSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
