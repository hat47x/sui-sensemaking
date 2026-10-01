from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
E2E_DOC = ROOT / "03_Implement/frontend/docs/e2e_testing.md"

def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_e2e_doc_has_current_runbook_invariants() -> None:
    """DX-E2E-08: verify the current-facing runbook, not a retired Stream/QA-gate process."""
    text = _read(E2E_DOC)
    for token in (
        "npm run e2e",
        "npm run e2e:mock",
        "npm run test:regression-guards",
        "代表ユーザ操作の回帰レーン",
        "ux_operability_regression.test.ts",
        "標準経路はDocker Compose",
        "R-01",
        "SafeMode",
        "失敗時に残す情報",
        "ADR-0019",
    ):
        assert token in text, f"missing current-runbook invariant: {token}"

    for retired_token in (
        "Plan → Execute → Verify → Proceed",
        "自己修復は最大3回",
        "4回目相当は Stop",
        "Stream E",
        "Stream F",
        "Stream G",
        "--files",
        "直列実装順",
        "Draft群 Open化",
    ):
        assert retired_token not in text, f"retired Stream/self-repair token reappeared: {retired_token}"
