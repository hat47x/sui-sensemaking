"""R4 (functional-dependency-integrity-2026-08-06.html §08): generative TS<->Python
field-set drift detection for DocumentV1's directly-nested types.

This is deliberately NOT a hand-maintained golden snapshot of field names — per the
grounding document's reversibility lens, a snapshot test trains contributors to
blind-accept diffs, the exact failure mode this test exists to catch. Instead it
extracts the field set from each side's actual, currently-live source of truth
(the TypeScript type body via a small brace-depth-aware scanner; the Pydantic model
via model_fields, which already walks inheritance) and diffs them every run.

A field present in TS but absent from the matching Pydantic model is silently DROPPED
by every server round-trip (Pydantic's default extra="ignore", unless the model sets
extra="forbid" -- which raises instead of dropping, a different but also-real failure
mode this test does not need to distinguish). That was F-1 (Island.representativeCue)
and, until this change, a second live instance on MergeSuggestionDecision.

KNOWN_GAPS is an explicit, per-type allowlist of already-tracked drift this test does
not fail on. Every entry must cite the tracking artifact. The list should shrink, not
grow -- a new entry here is a decision to defer a fix, not a place to silence a finding.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from sui_sensemaking_api import models
from sui_sensemaking_api.routes.inquiry_bundles import MAX_INQUIRY_BUNDLE_PAYLOAD_BYTES

REPO_ROOT = Path(__file__).resolve().parents[3]
TYPES_TS_PATH = REPO_ROOT / "03_Implement" / "frontend" / "src" / "domain" / "types.ts"
INQUIRY_BUNDLE_IO_TS_PATH = (
    REPO_ROOT / "03_Implement" / "frontend" / "src" / "domain" / "inquiry_bundle_io.ts"
)
VALIDATE_DOC_TS_PATH = REPO_ROOT / "03_Implement" / "frontend" / "src" / "domain" / "validate_doc.ts"
MODELS_PY_PATH = REPO_ROOT / "03_Implement" / "backend" / "src" / "sui_sensemaking_api" / "models.py"

# TS type name -> Pydantic model class in sui_sensemaking_api.models. Names diverge in one case
# (MergeSuggestionDecisionEntry / MergeSuggestionDecision) -- that mismatch is itself
# tracked, not hidden, by keeping the mapping explicit here rather than assuming parity.
TYPE_MAP: dict[str, str] = {
    "Card": "Card",
    "Edge": "Edge",
    "Island": "Island",
    "RepresentativeVisualCue": "RepresentativeVisualCue",
    "Affiliation": "Affiliation",
    "EvidenceLink": "EvidenceLink",
    "Narrative": "Narrative",
    "NarrativeCheck": "NarrativeCheck",
    "NarrativeCheckIssue": "NarrativeCheckIssue",
    "NarrativeCheckCounts": "NarrativeCheckCounts",
    "VoidEntry": "VoidEntry",
    "RelationSummary": "RelationSummary",
    "RelationSummaryHistoryEntry": "RelationSummaryHistoryEntry",
    "PatchApplyLogEntry": "PatchApplyLogEntry",
    "ReviewAttribution": "ReviewAttribution",
    "DeterministicTieBreak": "DeterministicTieBreak",
    "ReproposalDiff": "ReproposalDiff",
    "ReproposalDiffOp": "ReproposalDiffOp",
    "MergeSuggestionDecisionEntry": "MergeSuggestionDecision",
    "DocumentV1": "DocumentV1",
}

# type name -> {field names TS has that Python is known and intentionally not to have yet}.
KNOWN_TS_ONLY_GAPS: dict[str, set[str]] = {
    # F-1 (Island.representativeCue) is closed: the Python model declares it
    # (DOMAIN-VISUAL-CUE-01, schemas.md §19). Each new entry must cite its tracking artifact.
}

# type name -> {field names Python has that TS is known and intentionally not to have}.
KNOWN_PY_ONLY_GAPS: dict[str, set[str]] = {}

FIELD_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:")


def test_inquiry_bundle_absolute_byte_limit_matches_frontend_contract() -> None:
    source = INQUIRY_BUNDLE_IO_TS_PATH.read_text(encoding="utf-8")
    match = re.search(
        r"INQUIRY_BUNDLE_MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024",
        source,
    )
    assert match is not None, "could not resolve frontend inquiry bundle absolute limit"
    assert MAX_INQUIRY_BUNDLE_PAYLOAD_BYTES == int(match.group(1)) * 1024 * 1024


# DOMAIN-CARD-TEXT-01 (f54af7ac): content-field length limits shared by backend
# models.py and frontend validate_doc.ts. validate_doc.ts carries the comment
# "Keep in sync with the *_MAX_LENGTH constants there"; this test locks that
# convention against one-sided drift. Backend-only (MERGE_DRAFT_MAX_LENGTH,
# RELATION_SUMMARY_TEXT_MAX_LENGTH) and frontend-only (CRITIQUE_MAX_LENGTH,
# DOCUMENT_TITLE_MAX_LENGTH) constants are intentionally not compared.
SHARED_CONTENT_LIMIT_CONSTANTS = [
    "DOCUMENT_TITLE_MAX_LENGTH",
    "CARD_TEXT_MAX_LENGTH",
    "CRITIQUE_MAX_LENGTH",
    "ISLAND_TITLE_MAX_LENGTH",
    "ISLAND_SUMMARY_MAX_LENGTH",
    "NARRATIVE_TITLE_MAX_LENGTH",
    "NARRATIVE_TEXT_MAX_LENGTH",
    "EVIDENCE_NOTE_MAX_LENGTH",
]


def test_content_field_max_length_constants_match_frontend_contract() -> None:
    ts_source = VALIDATE_DOC_TS_PATH.read_text(encoding="utf-8")
    py_source = MODELS_PY_PATH.read_text(encoding="utf-8")

    def _extract(source: str, name: str) -> int:
        match = re.search(rf"{re.escape(name)}\s*=\s*(\d+)", source)
        assert match is not None, f"could not find {name} in source"
        return int(match.group(1))

    mismatches = []
    for name in SHARED_CONTENT_LIMIT_CONSTANTS:
        ts_value = _extract(ts_source, name)
        py_value = _extract(py_source, name)
        if ts_value != py_value:
            mismatches.append(f"  {name}: frontend={ts_value}, backend={py_value}")
    assert not mismatches, "content-field length limits drifted between frontend and backend:\n" + "\n".join(mismatches)


def _extract_ts_type_fields(source: str, type_name: str) -> set[str]:
    """Return the top-level field names of `export type <type_name> = { ... };`.

    Brace-depth tracking skips nested inline object/union literals so only fields
    declared directly on this type are captured, not fields of a nested type literal.
    Comment lines and blank lines are ignored. Raises if the type isn't found, so a
    typo in TYPE_MAP fails loudly instead of silently comparing against an empty set.
    """
    header_match = re.search(rf"export type {re.escape(type_name)}\s*=\s*{{", source)
    if header_match is None:
        raise AssertionError(f"could not find 'export type {type_name} = {{' in types.ts")

    depth = 1
    cursor = header_match.end()
    fields: set[str] = set()
    line_start = cursor

    while depth > 0:
        char = source[cursor]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        elif char == "\n":
            if depth == 1:
                line = source[line_start:cursor]
                stripped = line.strip()
                if stripped and not stripped.startswith(("//", "/*", "*")):
                    field_match = FIELD_LINE_RE.match(line)
                    if field_match:
                        fields.add(field_match.group(1))
            line_start = cursor + 1
        cursor += 1
        if cursor >= len(source):
            raise AssertionError(f"unterminated type body for {type_name} (unbalanced braces)")

    return fields


def _extract_all_ts_fields() -> dict[str, set[str]]:
    source = TYPES_TS_PATH.read_text(encoding="utf-8")
    return {type_name: _extract_ts_type_fields(source, type_name) for type_name in TYPE_MAP}


def _python_model_fields(class_name: str) -> set[str]:
    model_class = getattr(models, class_name)
    return set(model_class.model_fields.keys())


TS_FIELDS_BY_TYPE = _extract_all_ts_fields()


@pytest.mark.parametrize("ts_type_name", sorted(TYPE_MAP))
def test_no_undocumented_ts_python_field_drift(ts_type_name: str) -> None:
    python_class_name = TYPE_MAP[ts_type_name]
    ts_fields = TS_FIELDS_BY_TYPE[ts_type_name]
    py_fields = _python_model_fields(python_class_name)

    assert ts_fields, f"extracted zero fields for TS type {ts_type_name} -- extractor likely broken"
    assert py_fields, f"extracted zero fields for Python model {python_class_name} -- import likely broken"

    known_ts_only = KNOWN_TS_ONLY_GAPS.get(ts_type_name, set())
    known_py_only = KNOWN_PY_ONLY_GAPS.get(ts_type_name, set())

    undocumented_ts_only = (ts_fields - py_fields) - known_ts_only
    undocumented_py_only = (py_fields - ts_fields) - known_py_only

    assert not undocumented_ts_only, (
        f"{ts_type_name}: TS has field(s) {sorted(undocumented_ts_only)} that "
        f"{python_class_name} (Python) does not declare. Every server round-trip "
        f"silently drops these (or rejects the document, if the model sets "
        f"extra='forbid') -- this is the F-1 pattern. Add the field(s) to "
        f"{python_class_name}, or if the gap is deliberate and already tracked, add it "
        f"to KNOWN_TS_ONLY_GAPS in this file with a citation."
    )
    assert not undocumented_py_only, (
        f"{ts_type_name}: {python_class_name} (Python) has field(s) "
        f"{sorted(undocumented_py_only)} that TS does not declare. TS can never send "
        f"these, so they are either dead weight or the TS type is now the one missing "
        f"a field. Reconcile the two, or add the gap to KNOWN_PY_ONLY_GAPS with a "
        f"citation if it is deliberate."
    )


def test_known_gaps_are_still_accurate() -> None:
    """Every KNOWN_*_GAPS entry must still name a real drift and a real field on both
    sides, so a stale allowlist entry (drift that was fixed without updating this file)
    is caught rather than silently masking a *different* future regression on the same
    field name.
    """
    for ts_type_name, gap_fields in KNOWN_TS_ONLY_GAPS.items():
        python_class_name = TYPE_MAP[ts_type_name]
        ts_fields = TS_FIELDS_BY_TYPE[ts_type_name]
        py_fields = _python_model_fields(python_class_name)
        for field in gap_fields:
            assert field in ts_fields, (
                f"KNOWN_TS_ONLY_GAPS[{ts_type_name!r}] names {field!r}, which is no "
                f"longer a TS field -- remove this stale allowlist entry"
            )
            assert field not in py_fields, (
                f"KNOWN_TS_ONLY_GAPS[{ts_type_name!r}] names {field!r}, but "
                f"{python_class_name} now declares it too -- the gap is fixed, remove "
                f"this allowlist entry"
            )
