"""Deterministic attention-candidate product logic shared by API and T2 review."""

from __future__ import annotations

import hashlib
import json
from itertools import combinations

from sui_sensemaking_api.llm_input_ir import (
    build_llm_input_ir,
    held_card_ids,
    source_from_document,
)
from sui_sensemaking_api.models import DocumentV1
from sui_sensemaking_api.models_ai import AttentionCandidate


MAX_ATTENTION_FOCUS_PAIRS = 8


def build_attention_ir(
    document: DocumentV1,
    *,
    include_spatial: bool = False,
    allow_unreviewed_text: bool = False,
) -> dict:
    """Build the exact deterministic IR consumed by attention candidates."""
    return build_llm_input_ir(
        source_from_document(document),
        include_coordinates=include_spatial,
        safe_mode=True,
        allow_unreviewed_text=allow_unreviewed_text,
    )


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
    source = {
        "ir_version": ir.get("ir_version"),
        "doc_id": meta.get("doc_id"),
        "doc_version": meta.get("doc_version"),
        "cards": cards,
        "relations": relations,
        "islands": islands,
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


def attention_candidates_from_ir(ir: dict) -> list[AttentionCandidate]:
    """Expose only structurally novel, proposal-only cues from deterministic IR."""
    held = set(held_card_ids(ir))
    islands = [set(island["card_ids"]) for island in ir.get("islands", [])]
    assigned = set().union(*islands) if islands else set()
    co_island_pairs = {
        tuple(sorted(pair))
        for members in islands
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
        if any(members <= island for island in islands):
            continue

        pairs = set(combinations(card_ids, 2))
        not_co_islanded = pairs - co_island_pairs
        if not not_co_islanded:
            continue

        unassigned = bool(members - assigned)
        touched = sum(bool(members & island) for island in islands)
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
    return result
