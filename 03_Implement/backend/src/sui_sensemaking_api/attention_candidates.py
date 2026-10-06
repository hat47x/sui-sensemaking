"""Deterministic attention-candidate product logic shared by API and T2 review."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from itertools import combinations

from sui_sensemaking_api.llm_input_ir import (
    IRGenerationError,
    build_llm_input_ir,
    held_card_ids,
    source_from_document,
)
from sui_sensemaking_api.models import DocumentV1
from sui_sensemaking_api.models_ai import AttentionCandidate


# Bump this identifier whenever the externally observable candidate treatment
# changes (selection, suppression, cue semantics, or focus-pair semantics).
ATTENTION_METHOD_ID = "deterministic-structural-attention-v4"
MAX_ATTENTION_FOCUS_PAIRS = 8
MAX_ATTENTION_CANDIDATES = 4


@dataclass(frozen=True)
class AttentionCandidateResult:
    candidates: list[AttentionCandidate]
    complexity_suppressed: bool = False


def build_attention_ir(
    document: DocumentV1,
    *,
    include_spatial: bool = False,
    allow_unreviewed_text: bool = False,
) -> dict:
    """Build attention IR only when the visual-island projection is lossless."""
    island_ids_by_card: dict[str, list[str]] = {}
    for island in document.islands:
        for card_id in island.cardIds:
            island_ids_by_card.setdefault(card_id, []).append(island.id)

    ambiguous = {
        card_id: island_ids
        for card_id, island_ids in island_ids_by_card.items()
        if len(set(island_ids)) > 1
    }
    if ambiguous:
        raise IRGenerationError(
            "ambiguous_island_membership",
            "Attention candidates refuse a lossy projection when a card is listed "
            "in multiple visual islands.",
        )

    ir = build_llm_input_ir(
        source_from_document(document),
        include_coordinates=include_spatial,
        safe_mode=True,
        allow_unreviewed_text=allow_unreviewed_text,
    )

    card_ids = {card["id"] for card in ir.get("cards", [])}
    island_ids = {island["id"] for island in ir.get("islands", [])}
    affiliations = sorted(
        (
            {
                "id": affiliation.id,
                "card_id": affiliation.cardId,
                "island_id": affiliation.islandId,
            }
            for affiliation in document.affiliations or []
            if affiliation.cardId in card_ids and affiliation.islandId in island_ids
        ),
        key=lambda item: (item["island_id"], item["card_id"], item["id"]),
    )
    if affiliations:
        ir["affiliations"] = affiliations
    return ir


def attention_source_digest(ir: dict) -> str:
    """Fingerprint only the projected structure that determines attention cues."""
    meta = ir.get("meta", {})
    cards = [
        {
            "id": card["id"],
            **({"hold_state": card["hold_state"]} if card.get("hold_state") else {}),
        }
        for card in ir.get("cards", [])
    ]
    relations = [
        {
            "from": relation["from"],
            "to": relation["to"],
            "type": relation["type"],
        }
        for relation in ir.get("relations", [])
        if relation["type"] in {"related", "causal"}
    ]
    islands = [
        {
            "id": island["id"],
            "card_ids": island["card_ids"],
        }
        for island in ir.get("islands", [])
    ]
    affiliations = [
        {
            "card_id": affiliation["card_id"],
            "island_id": affiliation["island_id"],
        }
        for affiliation in ir.get("affiliations", [])
    ]
    source = {
        "ir_version": ir.get("ir_version"),
        "doc_id": meta.get("doc_id"),
        "doc_version": meta.get("doc_version"),
        "cards": cards,
        "relations": relations,
        "islands": islands,
        "affiliations": affiliations,
    }
    if "coordinates" in ir:
        source["coordinates"] = ir["coordinates"]
    canonical = json.dumps(
        source,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def attention_candidate_result_from_ir(ir: dict) -> AttentionCandidateResult:
    """Return the complete actionable set or suppress it without ranking."""
    if ir.get("truncation", {}).get("truncated"):
        return AttentionCandidateResult(candidates=[])

    held = set(held_card_ids(ir))
    groups_by_island = {
        island["id"]: set(island["card_ids"])
        for island in ir.get("islands", [])
    }
    for affiliation in ir.get("affiliations", []):
        groups_by_island.setdefault(affiliation["island_id"], set()).add(
            affiliation["card_id"]
        )
    groups = list(groups_by_island.values())
    assigned = set().union(*groups) if groups else set()
    co_grouped_pairs = {
        tuple(sorted(pair))
        for members in groups
        for pair in combinations(sorted(members), 2)
    }
    direct_relation_pairs = {
        tuple(sorted((relation["from"], relation["to"])))
        for relation in ir.get("relations", [])
        if relation["type"] in {"related", "causal"}
        and relation["from"] != relation["to"]
    }

    result: list[AttentionCandidate] = []
    for cluster in ir.get("cluster_candidates", []):
        card_ids = sorted(str(card_id) for card_id in cluster["card_ids"])
        members = set(card_ids)
        if members & held:
            continue
        if any(members <= group for group in groups):
            continue

        pairs = set(combinations(card_ids, 2))
        not_co_islanded = pairs - co_grouped_pairs
        if not not_co_islanded:
            continue

        unassigned = bool(members - assigned)
        touched = sum(bool(members & group) for group in groups)
        basis = cluster["basis"]
        if basis == "relation":
            focus_pairs = sorted(not_co_islanded - direct_relation_pairs)
            if not focus_pairs:
                continue
            cue = "indirect_relation"
        elif unassigned:
            focus_pairs = sorted(not_co_islanded)
            cue = "unassigned"
        elif touched >= 2:
            focus_pairs = sorted(not_co_islanded)
            cue = "cross_island"
        else:
            continue

        if len(focus_pairs) > MAX_ATTENTION_FOCUS_PAIRS:
            continue

        result.append(
            AttentionCandidate(
                candidateId=str(cluster["cluster_id"]),
                cardIds=card_ids,
                focusPairs=[list(pair) for pair in focus_pairs],
                basis=basis,
                cue=cue,
            )
        )

    if len(result) > MAX_ATTENTION_CANDIDATES:
        return AttentionCandidateResult(
            candidates=[],
            complexity_suppressed=True,
        )
    return AttentionCandidateResult(candidates=result)
