"""Build a non-writing save plan for a projection against an existing DocumentV1.

The plan lists what would be added, removed, or changed. It never saves and it
warns when the existing document carries fields the projection does not cover,
because a save built from the projection alone would drop them.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from sui_sensemaking_api.documentv1_merge import merge_preserving_existing
from sui_sensemaking_api.documentv1_projection import (
    ProjectedDocument,
    ProjectionError,
    to_documentv1_payload,
)

UNPROJECTED_FIELDS = (
    "transform",
    "narratives",
    "readingOrder",
    "relationSummaries",
    "evidenceLinks",
    "critiqueInputs",
    "structureDecisions",
    "voids",
    "shelf",
)


@dataclass(frozen=True)
class SavePlan:
    action: str
    document_id: str
    payload: dict[str, Any]
    cards_added: tuple[str, ...]
    cards_removed: tuple[str, ...]
    cards_changed: tuple[str, ...]
    islands_added: tuple[str, ...]
    islands_removed: tuple[str, ...]
    warnings: tuple[str, ...]
    preserved_cards: tuple[str, ...] = ()
    preserved_islands: tuple[str, ...] = ()


def _card_signature(card: Mapping[str, Any]) -> tuple[Any, ...]:
    return (
        card.get("text"),
        card.get("x"),
        card.get("y"),
        card.get("claimType"),
        card.get("holdState"),
        card.get("textReviewed"),
    )


def plan_save(
    projected: ProjectedDocument,
    *,
    transform: Mapping[str, Any],
    created_at: str,
    updated_at: str,
    existing: Mapping[str, Any] | None = None,
    preserve_existing: bool = False,
) -> SavePlan:
    if existing is not None and preserve_existing:
        payload = merge_preserving_existing(
            projected,
            transform=transform,
            created_at=created_at,
            updated_at=updated_at,
            existing=existing,
        )
    else:
        payload = to_documentv1_payload(
            projected, transform=transform, created_at=created_at, updated_at=updated_at
        )
    if existing is None:
        return SavePlan(
            action="create",
            document_id=projected.id,
            payload=payload,
            cards_added=tuple(card.id for card in projected.cards),
            cards_removed=(),
            cards_changed=(),
            islands_added=tuple(island.id for island in projected.islands),
            islands_removed=(),
            warnings=(),
        )

    if existing.get("id") != projected.id:
        raise ProjectionError("existing document id does not match the projection")

    existing_cards = {
        card.get("id"): card for card in existing.get("cards", []) if isinstance(card, Mapping)
    }
    projected_cards = {card.id: card for card in projected.cards}
    cards_added = tuple(sorted(set(projected_cards) - set(existing_cards)))
    if preserve_existing:
        cards_removed = ()
        preserved_cards = tuple(sorted(set(existing_cards) - set(projected_cards)))
    else:
        cards_removed = tuple(sorted(set(existing_cards) - set(projected_cards)))
        preserved_cards = ()
    payload_cards = {card["id"]: card for card in payload.get("cards", [])}
    cards_changed = tuple(
        sorted(
            card_id
            for card_id in set(projected_cards) & set(existing_cards)
            if _card_signature(existing_cards[card_id])
            != _card_signature(payload_cards.get(card_id, {}))
        )
    )

    existing_islands = {
        island.get("id")
        for island in existing.get("islands", [])
        if isinstance(island, Mapping)
    }
    projected_islands = {island.id for island in projected.islands}
    if preserve_existing:
        islands_removed = ()
        preserved_islands = tuple(sorted(existing_islands - projected_islands))
        warnings = []
    else:
        islands_removed = tuple(sorted(existing_islands - projected_islands))
        preserved_islands = ()
        warnings = [
            f"existing {field} is not projected and would be dropped by this save"
            for field in UNPROJECTED_FIELDS
            if existing.get(field) not in (None, {}, [])
        ]
        if cards_removed:
            warnings.append("cards would be removed: " + ", ".join(cards_removed))
        if islands_removed:
            warnings.append("islands would be removed: " + ", ".join(islands_removed))

    return SavePlan(
        action="update",
        document_id=projected.id,
        payload=payload,
        cards_added=cards_added,
        cards_removed=cards_removed,
        cards_changed=cards_changed,
        islands_added=tuple(sorted(projected_islands - existing_islands)),
        islands_removed=islands_removed,
        warnings=tuple(warnings),
        preserved_cards=preserved_cards,
        preserved_islands=preserved_islands,
    )
