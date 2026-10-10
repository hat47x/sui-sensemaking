"""SUI-owned native Card move command for a future TEI Action store binding.

Pure domain transformation only. No route, authority, CAS, persistence, or
session handling lives here; the calling Action adapter must provide those.
The geometry intentionally follows frontend/src/domain/card_drag_commit.ts
and geometry/bounds.ts. Parity tests are required before enabling an endpoint.
"""
from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite

from sui_sensemaking_api.models import Card, DocumentV1, Island


_CARD_WIDTH = 220.0
_CARD_HEIGHT = 80.0
_ISLAND_PADDING = 24.0


class InvalidCardMove(ValueError):
    """The command cannot be applied to this document without ambiguity."""


def _island_bounds(
    island: Island, cards: dict[str, Card]
) -> tuple[float, float, float, float] | None:
    # Browser geometry favors explicit polygon bounds over card-derived bounds.
    polygon = None
    if island.geometry is not None and island.geometry.type == "polygon":
        polygon = island.geometry.points
    if (not polygon or len(polygon) < 3) and island.shape is not None and island.shape.kind == "polygon":
        polygon = island.shape.points

    if polygon and len(polygon) >= 3:
        xx = [point.x for point in polygon]
        yy = [point.y for point in polygon]
        if not all(isfinite(v) for v in xx + yy):
            raise InvalidCardMove("nonfinite island polygon")
        xmin, xmax = min(xx), max(xx)
        ymin, ymax = min(yy), max(yy)
        return xmin, ymin, max(1.0, xmax - xmin), max(1.0, ymax - ymin)

    members = [cards[card_id] for card_id in island.cardIds if card_id in cards]
    if not members:
        return None
    if not all(isfinite(c.x) and isfinite(c.y) for c in members):
        raise InvalidCardMove("nonfinite island member coordinates")
    xmin, ymin = min(c.x for c in members), min(c.y for c in members)
    xmax = max(c.x + _CARD_WIDTH for c in members)
    ymax = max(c.y + _CARD_HEIGHT for c in members)
    return (
        xmin - _ISLAND_PADDING, ymin - _ISLAND_PADDING,
        max(1.0, xmax - xmin + _ISLAND_PADDING * 2),
        max(1.0, ymax - ymin + _ISLAND_PADDING * 2),
    )


def apply_card_move(
    document: DocumentV1, *, card_id: str, x: float, y: float
) -> DocumentV1:
    """Return an immutable-style copy; callers must atomically check CAS and save.

    The incoming x/y are final world coordinates (grid snap is owned by SUI UI).
    A destination island is selected using the same first-matching bounding
    rectangle rule as the native SUI Canvas, *not* polygon point-in-region.
    """
    if not isinstance(card_id, str) or not card_id or not isfinite(x) or not isfinite(y):
        raise InvalidCardMove("invalid move input")
    matches = [c for c in document.cards if c.id == card_id]
    if len(matches) != 1:
        raise InvalidCardMove("card identity missing or ambiguous")
    card = matches[0]
    if not all(isfinite(v) for v in (card.x, card.y)):
        raise InvalidCardMove("invalid original coordinates")
    if card.x == x and card.y == y:
        raise InvalidCardMove("no-op move must not advance revision")
    if len({i.id for i in document.islands}) != len(document.islands):
        raise InvalidCardMove("ambiguous island identity")
    if len({c.id for c in document.cards}) != len(document.cards):
        raise InvalidCardMove("ambiguous card identity")

    next_document = document.model_copy(deep=True)
    moved_card = next(c for c in next_document.cards if c.id == card_id)
    moved_card.x, moved_card.y = x, y
    cards_by_id = {c.id: c for c in next_document.cards}

    target = None
    for island in next_document.islands:
        if card_id in island.cardIds:
            continue
        bounds = _island_bounds(island, cards_by_id)
        if bounds is None:
            continue
        bx, by, bw, bh = bounds
        cx, cy = x + _CARD_WIDTH / 2, y + _CARD_HEIGHT / 2
        if bx <= cx <= bx + bw and by <= cy <= by + bh:
            target = island.id
            break

    if target is not None:
        for island in next_document.islands:
            if island.id == target:
                if card_id not in island.cardIds:
                    island.cardIds.append(card_id)
            elif card_id in island.cardIds:
                island.cardIds = [item for item in island.cardIds if item != card_id]

    # A new containment can collide with a non-containment affiliation. The
    # frontend currently retains affiliations; reject rather than silently
    # deleting provenance or persisting an invalid DocumentV1.
    occupied = {(item, island.id) for island in next_document.islands for item in island.cardIds}
    if next_document.affiliations and any(
        (aff.cardId, aff.islandId) in occupied for aff in next_document.affiliations
    ):
        raise InvalidCardMove("affiliation collides with containment")
    next_document.updatedAt = datetime.now(timezone.utc)
    # model_copy bypasses Pydantic validators. Revalidate the entire resource
    # before any persistence adapter sees it.
    return DocumentV1.model_validate(next_document.model_dump(mode="python"))
