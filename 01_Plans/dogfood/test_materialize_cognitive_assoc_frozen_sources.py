from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from materialize_cognitive_assoc_frozen_sources import (
    materialize,
    safe_relative_path,
)


def git_blob_sha(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()


class FrozenSourceMaterializationTest(unittest.TestCase):
    def make_repo(self, root: Path) -> tuple[Path, bytes, str]:
        repo = root / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "config", "user.email", "test@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(repo), "config", "user.name", "Test"], check=True)
        path = repo / "source.json"
        frozen = b'{"id":"frozen","cards":[]}\n'
        path.write_bytes(frozen)
        subprocess.run(["git", "-C", str(repo), "add", "source.json"], check=True)
        subprocess.run(["git", "-C", str(repo), "commit", "-q", "-m", "freeze source"], check=True)
        return repo, frozen, git_blob_sha(frozen)

    def write_manifest(self, root: Path, blob_sha: str, source_path: str = "source.json") -> Path:
        manifest = {
            "status": "pre_adjudication_frozen",
            "inputContract": {"noModelRunBeforeAdjudication": True},
            "sources": [{"path": source_path, "blobSha": blob_sha}],
        }
        path = root / "manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path

    def test_materializes_historical_blob_when_worktree_path_has_changed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo, frozen, blob_sha = self.make_repo(root)
            (repo / "source.json").write_text('{"id":"current"}\n', encoding="utf-8")
            manifest = self.write_manifest(root, blob_sha)
            output = root / "out"

            written = materialize(manifest, repo, output)

            self.assertEqual(written, [output / "source.json"])
            self.assertEqual((output / "source.json").read_bytes(), frozen)

    def test_missing_blob_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo, _, _ = self.make_repo(root)
            manifest = self.write_manifest(root, "0" * 40)
            with self.assertRaisesRegex(ValueError, "unavailable"):
                materialize(manifest, repo, root / "out")

    def test_manifest_must_keep_semantic_gate_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo, _, blob_sha = self.make_repo(root)
            manifest = self.write_manifest(root, blob_sha)
            value = json.loads(manifest.read_text(encoding="utf-8"))
            value["inputContract"]["noModelRunBeforeAdjudication"] = False
            manifest.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "gate"):
                materialize(manifest, repo, root / "out")

    def test_path_escape_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsafe"):
            safe_relative_path("../outside.json")
        with self.assertRaisesRegex(ValueError, "unsafe"):
            safe_relative_path("/absolute.json")


if __name__ == "__main__":
    unittest.main()
