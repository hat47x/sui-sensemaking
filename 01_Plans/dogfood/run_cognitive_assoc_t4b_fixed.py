#!/usr/bin/env python3
"""One-shot fixed T4b runner for COGNITIVE-ASSOC-01.

This orchestrator does not define new scoring semantics. It wires together the
already-frozen benchmark source, AI-proxy adjudication, A/C/E probe harness, and
the pinned E provider so an external CPU host can execute the exact T4b unit
without hand-assembling paths.

The run is research-only:
- no product-facing rank or composite score is produced;
- no automatic semantic authority is created;
- no production adoption is authorized.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


RECEIPT_SCHEMA = "sui.cognitive-assoc-t4b-fixed-run-receipt/v1"
BENCHMARK_ID = "cognitive-assoc-benchmark-v0"
EXPECTED_MODEL_REF = (
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2@"
    "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
)

DOGFOOD_REL = Path("01_Plans/dogfood")
MANIFEST_REL = DOGFOOD_REL / "cognitive-assoc-benchmark-v0-source-manifest.json"
GENERATION_EVIDENCE_REL = (
    DOGFOOD_REL
    / "cognitive-assoc-benchmark-v0-pre-adjudication"
    / "generation-evidence.json"
)
SELECTED_REL = (
    DOGFOOD_REL
    / "cognitive-assoc-benchmark-v0-pre-adjudication"
    / "selected-review-set.json"
)
ADJUDICATED_REL = (
    DOGFOOD_REL
    / "cognitive-assoc-benchmark-v0-ai-adjudication"
    / "adjudicated.json"
)
ADJUDICATION_EVIDENCE_REL = (
    DOGFOOD_REL
    / "cognitive-assoc-benchmark-v0-ai-adjudication"
    / "evidence.json"
)
MATERIALIZE_REL = DOGFOOD_REL / "materialize_cognitive_assoc_frozen_sources.py"
PREPARE_REL = DOGFOOD_REL / "prepare_cognitive_assoc_benchmark.py"
EVALUATE_REL = DOGFOOD_REL / "evaluate_cognitive_assoc_baselines.py"
PROVIDER_REL = DOGFOOD_REL / "run_cognitive_assoc_e_provider.py"
PROVIDER_TEST_REL = DOGFOOD_REL / "test_run_cognitive_assoc_e_provider.py"


class FixedT4bError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def run_checked(
    argv: list[str],
    *,
    cwd: Path,
    capture: bool = True,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        argv,
        cwd=cwd,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        diagnostic = (completed.stderr or completed.stdout or "").strip()
        raise FixedT4bError(
            f"command failed ({completed.returncode}): {' '.join(argv)}"
            + (f": {diagnostic}" if diagnostic else "")
        )
    return completed


def git_output(repo_root: Path, *args: str) -> str:
    return run_checked(
        ["git", "-C", str(repo_root), *args],
        cwd=repo_root,
    ).stdout.strip()


def require_clean_checkout(
    repo_root: Path,
    expected_source_git_sha: str | None,
) -> str:
    source_sha = git_output(repo_root, "rev-parse", "HEAD")
    if expected_source_git_sha and source_sha != expected_source_git_sha:
        raise FixedT4bError(
            f"source Git SHA drift: expected {expected_source_git_sha}, got {source_sha}"
        )
    dirty = git_output(repo_root, "status", "--porcelain", "--untracked-files=no")
    if dirty:
        raise FixedT4bError("tracked working tree changes are not allowed for fixed T4b")
    return source_sha


def require_frozen_blobs(repo_root: Path, manifest: dict[str, Any]) -> None:
    if manifest.get("id") != BENCHMARK_ID:
        raise FixedT4bError("unexpected benchmark id")
    if manifest.get("status") != "pre_adjudication_frozen":
        raise FixedT4bError("benchmark source manifest is not frozen")
    for source in manifest.get("sources", []):
        blob_sha = source.get("blobSha")
        if not isinstance(blob_sha, str) or len(blob_sha) != 40:
            raise FixedT4bError("frozen source blob SHA is invalid")
        completed = subprocess.run(
            ["git", "-C", str(repo_root), "cat-file", "-e", f"{blob_sha}^{{blob}}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if completed.returncode != 0:
            raise FixedT4bError(
                "frozen Git blob is unavailable; use a checkout with the frozen "
                f"objects present: {blob_sha}"
            )


def require_python_runtime() -> dict[str, str]:
    probe = (
        "import json, sentence_transformers, torch, transformers;"
        "print(json.dumps({"
        "'sentenceTransformers': sentence_transformers.__version__,"
        "'torch': torch.__version__,"
        "'transformers': transformers.__version__"
        "}))"
    )
    try:
        completed = run_checked(
            [sys.executable, "-c", probe],
            cwd=Path.cwd(),
        )
    except FixedT4bError as exc:
        raise FixedT4bError(
            "baseline E requires sentence-transformers/torch/transformers "
            "before the fixed run"
        ) from exc
    versions = json.loads(completed.stdout)
    return {
        "python": platform.python_version(),
        "platform": platform.platform(),
        **versions,
    }


def build_probe_command(
    repo_root: Path,
    *,
    baseline: str,
    model_input: Path,
    output: Path,
    encoder_timeout: float,
) -> list[str]:
    command = [
        sys.executable,
        str(repo_root / EVALUATE_REL),
        "probe",
        "--baseline",
        baseline,
        "--manifest",
        str(repo_root / MANIFEST_REL),
        "--selected-review-set",
        str(repo_root / SELECTED_REL),
        "--model-input",
        str(model_input),
        "--adjudicated",
        str(repo_root / ADJUDICATED_REL),
        "--adjudication-evidence",
        str(repo_root / ADJUDICATION_EVIDENCE_REL),
        "--output",
        str(output),
    ]
    if baseline == "E":
        command.extend(
            [
                "--encoder-command",
                f"{sys.executable} {repo_root / PROVIDER_REL}",
                "--encoder-timeout",
                str(encoder_timeout),
            ]
        )
    return command


def verify_model_input(repo_root: Path, model_input: Path) -> str:
    evidence = load_json(repo_root / GENERATION_EVIDENCE_REL)
    expected = evidence.get("sha256", {}).get("ephemeralModelInput")
    observed = sha256_file(model_input)
    if observed != expected:
        raise FixedT4bError(
            f"model-input SHA-256 drift: expected {expected}, got {observed}"
        )
    return observed


def artifact_entry(path: Path) -> dict[str, str]:
    return {"file": path.name, "sha256": sha256_file(path)}


def run_fixed_t4b(
    repo_root: Path,
    output_dir: Path,
    *,
    expected_source_git_sha: str | None,
    encoder_timeout: float,
) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    output_dir = output_dir.resolve()
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FixedT4bError("output directory must be absent or empty")
    output_dir.mkdir(parents=True, exist_ok=True)

    source_sha = require_clean_checkout(repo_root, expected_source_git_sha)
    manifest = load_json(repo_root / MANIFEST_REL)
    require_frozen_blobs(repo_root, manifest)
    runtime = require_python_runtime()

    provider_test = run_checked(
        [
            sys.executable,
            "-m",
            "unittest",
            "-v",
            PROVIDER_TEST_REL.name,
        ],
        cwd=repo_root / DOGFOOD_REL,
    )

    with tempfile.TemporaryDirectory(prefix="sui-cognitive-assoc-t4b-") as td:
        temp_root = Path(td)
        frozen_root = temp_root / "frozen"
        prepared = temp_root / "prepared"

        run_checked(
            [
                sys.executable,
                str(repo_root / MATERIALIZE_REL),
                str(repo_root / MANIFEST_REL),
                str(frozen_root),
                "--repo-root",
                str(repo_root),
            ],
            cwd=repo_root,
        )
        run_checked(
            [
                sys.executable,
                str(repo_root / PREPARE_REL),
                str(repo_root / MANIFEST_REL),
                str(prepared),
                "--repo-root",
                str(frozen_root),
            ],
            cwd=repo_root,
        )
        model_input = prepared / "model-input.jsonl"
        model_input_sha = verify_model_input(repo_root, model_input)

        probes: list[Path] = []
        for baseline in ("A", "C", "E"):
            probe_path = output_dir / f"probe-{baseline}.json"
            run_checked(
                build_probe_command(
                    repo_root,
                    baseline=baseline,
                    model_input=model_input,
                    output=probe_path,
                    encoder_timeout=encoder_timeout,
                ),
                cwd=repo_root,
            )
            probe = load_json(probe_path)
            if probe.get("baseline", {}).get("id") != baseline:
                raise FixedT4bError(f"probe baseline identity drift: {baseline}")
            if baseline == "E" and probe.get("baseline", {}).get("model") != EXPECTED_MODEL_REF:
                raise FixedT4bError("baseline E model identity drift")
            probes.append(probe_path)

        summary_path = output_dir / "summary-ACE.json"
        run_checked(
            [
                sys.executable,
                str(repo_root / EVALUATE_REL),
                "summarize",
                *(str(path) for path in probes),
                "--output",
                str(summary_path),
            ],
            cwd=repo_root,
        )

    receipt = {
        "schema": RECEIPT_SCHEMA,
        "status": "complete",
        "benchmarkId": BENCHMARK_ID,
        "sourceGitSha": source_sha,
        "referenceAuthority": "user_authorized_ai_proxy",
        "modelInputSha256": model_input_sha,
        "providerContractTests": {
            "executed": True,
            "stdout": provider_test.stdout.strip(),
            "stderr": provider_test.stderr.strip(),
        },
        "environment": runtime,
        "artifacts": {
            "probeA": artifact_entry(output_dir / "probe-A.json"),
            "probeC": artifact_entry(output_dir / "probe-C.json"),
            "probeE": artifact_entry(output_dir / "probe-E.json"),
            "summaryACE": artifact_entry(output_dir / "summary-ACE.json"),
        },
        "scope": {
            "repositoryPythonHarnessExecuted": True,
            "fixedModelCpuExecuted": True,
            "winnerSelected": False,
            "singleCompositeScoreProduced": False,
            "humanUsabilityObserved": False,
            "productionAdoptionAuthorized": False,
            "automaticSemanticAuthorityAuthorized": False,
        },
    }
    receipt_path = output_dir / "execution-receipt.json"
    receipt_path.write_text(
        json.dumps(receipt, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return receipt


def preflight(
    repo_root: Path,
    *,
    expected_source_git_sha: str | None,
) -> dict[str, Any]:
    repo_root = repo_root.resolve()
    source_sha = require_clean_checkout(repo_root, expected_source_git_sha)
    manifest = load_json(repo_root / MANIFEST_REL)
    require_frozen_blobs(repo_root, manifest)
    runtime = require_python_runtime()
    return {
        "schema": "sui.cognitive-assoc-t4b-fixed-preflight/v1",
        "status": "ready",
        "benchmarkId": BENCHMARK_ID,
        "sourceGitSha": source_sha,
        "frozenSourceCount": len(manifest.get("sources", [])),
        "expectedModelRef": EXPECTED_MODEL_REF,
        "environment": runtime,
        "claims": {
            "modelLoaded": False,
            "inferenceExecuted": False,
            "productionAdoptionAuthorized": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the fixed COGNITIVE-ASSOC-01 T4b A/C/E unit.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    preflight_parser = subparsers.add_parser("preflight")
    preflight_parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    preflight_parser.add_argument("--expected-source-git-sha")

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    run_parser.add_argument("--output-dir", type=Path, required=True)
    run_parser.add_argument("--expected-source-git-sha")
    run_parser.add_argument("--encoder-timeout", type=float, default=600.0)

    args = parser.parse_args()
    try:
        if args.command == "preflight":
            result = preflight(
                args.repo_root,
                expected_source_git_sha=args.expected_source_git_sha,
            )
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0

        result = run_fixed_t4b(
            args.repo_root,
            args.output_dir,
            expected_source_git_sha=args.expected_source_git_sha,
            encoder_timeout=args.encoder_timeout,
        )
        print(f"WROTE_T4B_RECEIPT: {args.output_dir.resolve() / 'execution-receipt.json'}")
        print(f"SOURCE_GIT_SHA: {result['sourceGitSha']}")
        print("WINNER_SELECTED: false")
        print("PRODUCTION_ADOPTION_AUTHORIZED: false")
        return 0
    except (
        OSError,
        ValueError,
        json.JSONDecodeError,
        subprocess.TimeoutExpired,
    ) as exc:
        print(f"FAIL: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
