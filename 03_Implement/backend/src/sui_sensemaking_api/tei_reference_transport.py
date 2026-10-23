"""Local-I/O transport for TEI Reference epistemic artifacts (ADR-0101 Option A).

TEI Reference は現時点では CLI と JSON ファイル群として提供されており、SUI から
呼べる HTTP provider は存在しない。本ADRの決定に従い、SUI バックエンドは同一の
信頼境界内にあるディレクトリから、あらかじめ生成された JSON artifact を
局所 I/O で読むだけに留める。

このモジュールは transport 専用であり、次を行わない。

- semantic contract / representation schema の検証（frontend consumer
  `epistemic_review_model.ts` と `epistemic_projection_adapter.ts` が行う）。
- TEI Assessment を Document / Canonical state への埋め込みとして返すこと。
- artifact の内容の解釈や drift の再計算。

fail-closed の規則:

- ディレクトリが未設定・空なら `unconfigured`。
- artifact 種別が許可リスト外（../ などの越境を含む）なら `unknown-artifact`。
- 読めない・疎通しない JSON・JSON object でない・ディレクトリ外の参照は、
  内容を一切返さず failure reason のみを返す。
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Collection, Literal, Mapping, Union

#: Artifact kinds reachable through the local-I/O transport. The concrete file
#: names follow the TEI Reference CLI outputs and are pinned at wiring time;
#: the read rules and fail-closed reasons below are the stable contract.
TEI_REFERENCE_ARTIFACT_KINDS: frozenset[str] = frozenset(
    {
        "epistemic-assessment",
        "epistemic-context",
        "epistemic-detail",
    }
)


@dataclass(frozen=True)
class TeiReferenceArtifact:
    """A successfully read TEI Reference JSON artifact, verbatim.

    `payload` は TEI Reference が宣言する `contract` / `schema` を含む
    JSON object そのものである。SUI 側での検証は consumer adapter の責務。
    """

    payload: Mapping[str, Any]


@dataclass(frozen=True)
class TeiReferenceReadFailure:
    """A fail-closed read result. Never carries artifact content."""

    reason: Literal[
        "unconfigured",
        "unknown-artifact",
        "invalid-path",
        "not-a-file",
        "invalid-json",
        "not-an-object",
        "binding-registry-missing",
        "binding-registry-invalid",
        "no-binding",
        "ambiguous-binding",
        "unknown-bound-artifact",
    ]


TeiReferenceReadResult = Union[TeiReferenceArtifact, TeiReferenceReadFailure]


def read_tei_reference_artifact(
    artifacts_dir: str | Path | None,
    artifact_kind: str,
    *,
    artifact_kinds: Collection[str] = TEI_REFERENCE_ARTIFACT_KINDS,
) -> TeiReferenceReadResult:
    """Read one TEI Reference JSON artifact from a local directory.

    `artifact_kind` は `{kind}.json` というファイル名に写像される。実際の
    TEI Reference CLI 出力のファイル名が異なる場合は、wiring 側でこの写像を
    差し替える（本モジュールの読み出し規則と fail-closed 規則は不変）。
    """
    if not artifacts_dir:
        return TeiReferenceReadFailure(reason="unconfigured")
    if artifact_kind not in artifact_kinds:
        return TeiReferenceReadFailure(reason="unknown-artifact")

    base = Path(artifacts_dir).resolve()
    path = (base / f"{artifact_kind}.json").resolve()
    if path.parent != base and base not in path.parents:
        return TeiReferenceReadFailure(reason="invalid-path")
    if not path.is_file():
        return TeiReferenceReadFailure(reason="not-a-file")

    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        loaded = json.loads(text)
    except (OSError, ValueError):
        return TeiReferenceReadFailure(reason="invalid-json")
    if not isinstance(loaded, dict) or any(
        not isinstance(key, str) for key in loaded
    ):
        return TeiReferenceReadFailure(reason="not-an-object")

    return TeiReferenceArtifact(payload=loaded)


@dataclass(frozen=True)
class TeiEpistemicBinding:
    """A provisional binding from a tenant/document to a TEI Reference artifact.

    The binding is recorded by the operator in `epistemic-bindings.json` inside
    the configured artifacts directory. It never carries artifact content; the
    artifact itself is read separately through `read_tei_reference_artifact`.
    """

    artifact_kind: str


#: File name of the operator-managed binding registry inside the artifacts dir.
TEI_EPISTEMIC_BINDINGS_FILE = "epistemic-bindings.json"


def read_tei_epistemic_binding(
    artifacts_dir: str | Path | None,
    tenant_id: str,
    doc_id: str,
) -> TeiEpistemicBinding | TeiReferenceReadFailure:
    """Resolve which TEI Reference artifact applies to a (tenant, document) pair.

    ADR-0102 案B: the operator records bindings in `epistemic-bindings.json`
    inside `SUI_TEI_REFERENCE_DIR`. The binding registry is read with the same
    fail-closed rules as artifacts; a missing registry, malformed JSON, no
    matching entry, an ambiguous (duplicate) entry, or an unknown bound artifact
    kind all fail closed without leaking content.
    """
    if not artifacts_dir:
        return TeiReferenceReadFailure(reason="unconfigured")
    if not tenant_id or not doc_id:
        return TeiReferenceReadFailure(reason="no-binding")

    base = Path(artifacts_dir).resolve()
    path = (base / TEI_EPISTEMIC_BINDINGS_FILE).resolve()
    if path.parent != base and base not in path.parents:
        return TeiReferenceReadFailure(reason="invalid-path")
    if not path.is_file():
        return TeiReferenceReadFailure(reason="binding-registry-missing")

    try:
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        loaded = json.loads(text)
    except (OSError, ValueError):
        return TeiReferenceReadFailure(reason="binding-registry-invalid")
    if not isinstance(loaded, dict) or not isinstance(loaded.get("bindings"), list):
        return TeiReferenceReadFailure(reason="binding-registry-invalid")

    matches = [
        entry
        for entry in loaded["bindings"]
        if isinstance(entry, dict)
        and entry.get("tenantId") == tenant_id
        and entry.get("docId") == doc_id
    ]
    if len(matches) == 0:
        return TeiReferenceReadFailure(reason="no-binding")
    if len(matches) > 1:
        return TeiReferenceReadFailure(reason="ambiguous-binding")

    artifact_kind = matches[0].get("artifactKind")
    if artifact_kind not in TEI_REFERENCE_ARTIFACT_KINDS:
        return TeiReferenceReadFailure(reason="unknown-bound-artifact")
    return TeiEpistemicBinding(artifact_kind=artifact_kind)
