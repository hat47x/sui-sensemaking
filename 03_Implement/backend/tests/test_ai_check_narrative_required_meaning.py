import json

from sui_sensemaking_api.models import Card, DocumentV1, Edge, Island, Transform
from sui_sensemaking_api.models_ai import CheckNarrativeRequest
from sui_sensemaking_api.routes.ai import _build_narrative_check_prompt


def _payload() -> CheckNarrativeRequest:
    doc = DocumentV1(
        version=1,
        id="doc-check-relations",
        title="A/B relation check",
        createdAt="2026-09-04T00:00:00Z",
        updatedAt="2026-09-04T00:00:00Z",
        transform=Transform(panX=0, panY=0, zoom=1),
        cards=[
            Card(id="c1", text="需要が増えた", x=0, y=0, textReviewed=True),
            Card(id="c2", text="待ち時間が伸びた", x=20, y=0, textReviewed=True),
            Card(id="c3", text="別経路では待ち時間が縮んだ", x=40, y=0, textReviewed=True),
        ],
        edges=[
            # Legacy documents may omit endpoint kinds. Existing domain
            # compatibility treats those endpoints as cards.
            Edge(id="e-legacy", fromId="c1", toId="c2", type="causal"),
            Edge(
                id="e-islands",
                fromId="i1",
                toId="i2",
                fromKind="island",
                toKind="island",
                type="negate",
            ),
            Edge(
                id="e-mixed",
                fromId="c3",
                toId="i1",
                fromKind="card",
                toKind="island",
                type="related",
            ),
        ],
        islands=[
            Island(id="i1", cardIds=["c1", "c2"], title="需要と待ち時間"),
            Island(id="i2", cardIds=["c3"], title="別経路"),
        ],
        readingOrder=["i1", "i2"],
    )
    return CheckNarrativeRequest(
        doc=doc,
        narrativeText="需要が増え、そのため待ち時間が伸びた。一方、別経路では短くなった。",
        basedOnReadingOrder=["i1", "i2"],
    )


def test_check_narrative_prompt_preserves_full_diagram_relation_graph() -> None:
    prompt = _build_narrative_check_prompt(_payload())

    assert "Relations:" in prompt
    assert (
        '- id="e-legacy", type="causal", fromKind="card", fromId="c1", '
        'toKind="card", toId="c2"'
    ) in prompt
    assert (
        '- id="e-islands", type="negate", fromKind="island", fromId="i1", '
        'toKind="island", toId="i2"'
    ) in prompt
    assert (
        '- id="e-mixed", type="related", fromKind="card", fromId="c3", '
        'toKind="island", toId="i1"'
    ) in prompt


def test_check_narrative_prompt_tells_ab_check_to_use_relations_without_losing_existing_coverage() -> None:
    prompt = _build_narrative_check_prompt(_payload())

    assert "explicit logical connection" in prompt
    assert "relation graph" in prompt
    assert 'direction "b_missing_in_a"' in prompt

    # Existing whole-diagram coverage remains present; adding relations is not
    # permission to shrink the card/island/read-order inputs yet.
    # Card/island text is embedded as raw Unicode (ensure_ascii=False) so the
    # model reads the words, not \\uXXXX escapes; see _prompt_text.
    assert '1. island id="i1"' in prompt
    assert '2. island id="i2"' in prompt
    assert f'id="c1", text={json.dumps("需要が増えた", ensure_ascii=False)}' in prompt
    assert f'id="c2", text={json.dumps("待ち時間が伸びた", ensure_ascii=False)}' in prompt
    assert f'id="c3", text={json.dumps("別経路では待ち時間が縮んだ", ensure_ascii=False)}' in prompt
    assert f'id="i1", title={json.dumps("需要と待ち時間", ensure_ascii=False)}' in prompt
    assert f'id="i2", title={json.dumps("別経路", ensure_ascii=False)}' in prompt


def test_check_narrative_prompt_writes_japanese_text_without_unicode_escapes() -> None:
    prompt = _build_narrative_check_prompt(_payload())

    assert "需要が増えた" in prompt
    assert "需要と待ち時間" in prompt
    assert "\\u" not in prompt
