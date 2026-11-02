"""Read a TEI Reference documentv1-projection artifact into typed records.

The artifact is a read-only projection produced by TAI's TEI pilot. This module
validates its envelope and element references, then returns immutable records.
It does not write DocumentV1, run the API, or replace SUI's source of truth.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

PROJECTION_SCHEMA = "tai.reference.tei-documentv1-projection/v0"
KINDS = ("card", "island")
CLAIM_TYPES = ("fact", "claim", "hypothesis", "unknown")
HOLD_STATES = ("held", "pending", "shelved")


class ProjectionError(ValueError):
    """Raised when an artifact cannot be read as a DocumentV1 projection."""


@dataclass(frozen=True)
class ProjectedCard:
    id: str
    text: str
    x: float
    y: float
    claim_type: str | None = None
    hold_state: str | None = None
    text_reviewed: bool | None = None


@dataclass(frozen=True)
class ProjectedIsland:
    id: str
    card_ids: tuple[str, ...]
    title: str | None = None


@dataclass(frozen=True)
class ProjectedEdge:
    id: str
    from_id: str
    to_id: str
    type: str
    from_kind: str
    to_kind: str


@dataclass(frozen=True)
class ProjectedAffiliation:
    id: str
    card_id: str
    island_id: str


@dataclass(frozen=True)
class ProjectedDocument:
    id: str
    title: str | None
    cards: tuple[ProjectedCard, ...]
    islands: tuple[ProjectedIsland, ...]
    edges: tuple[ProjectedEdge, ...]
    affiliations: tuple[ProjectedAffiliation, ...]
    contract_id: str
    contract_version: str
    tei_commit: str


def _text(value: object, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ProjectionError(f"{field} must be a non-empty string")
    return value


def _number(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ProjectionError(f"{field} must be a number")
    return float(value)


def _optional_choice(value: object, field: str, choices: Sequence[str]) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or value not in choices:
        raise ProjectionError(f"{field} must be one of {', '.join(choices)} when present")
    return value


def _optional_bool(value: object, field: str) -> bool | None:
    if value is None:
        return None
    if not isinstance(value, bool):
        raise ProjectionError(f"{field} must be a boolean when present")
    return value


def _optional_text(value: object, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ProjectionError(f"{field} must be a string when present")
    return value


def _as_list(value: object, field: str) -> Sequence[Any]:
    if not isinstance(value, list):
        raise ProjectionError(f"{field} must be an array")
    return value


def from_artifact(payload: Mapping[str, Any]) -> ProjectedDocument:
    if payload.get("schema") != PROJECTION_SCHEMA:
        raise ProjectionError(f"schema must be {PROJECTION_SCHEMA}")

    contract = payload.get("contract")
    if not isinstance(contract, Mapping):
        raise ProjectionError("contract must be an object")
    contract_id = _text(contract.get("id"), "contract.id")
    contract_version = _text(contract.get("version"), "contract.version")

    source = payload.get("source")
    if not isinstance(source, Mapping):
        raise ProjectionError("source must be an object")
    tei_commit = _text(source.get("teiCommit"), "source.teiCommit")

    document = payload.get("document")
    if not isinstance(document, Mapping):
        raise ProjectionError("document must be an object")
    meta = document.get("document")
    if not isinstance(meta, Mapping):
        raise ProjectionError("document.document must be an object")
    document_id = _text(meta.get("id"), "document.document.id")
    title = meta.get("title")
    if title is not None and not isinstance(title, str):
        raise ProjectionError("document.document.title must be a string when present")

    cards = []
    for item in _as_list(document.get("cards"), "document.cards"):
        if not isinstance(item, Mapping):
            raise ProjectionError("each card must be an object")
        cards.append(
            ProjectedCard(
                id=_text(item.get("id"), "card.id"),
                text=_text(item.get("text"), "card.text") if item.get("text") != "" else "",
                x=_number(item.get("x"), "card.x"),
                y=_number(item.get("y"), "card.y"),
                claim_type=_optional_choice(item.get("claimType"), "card.claimType", CLAIM_TYPES),
                hold_state=_optional_choice(item.get("holdState"), "card.holdState", HOLD_STATES),
                text_reviewed=_optional_bool(item.get("textReviewed"), "card.textReviewed"),
            )
        )
    if not cards:
        raise ProjectionError("document.cards must not be empty")

    islands = []
    for item in _as_list(document.get("islands", []), "document.islands"):
        if not isinstance(item, Mapping):
            raise ProjectionError("each island must be an object")
        islands.append(
            ProjectedIsland(
                id=_text(item.get("id"), "island.id"),
                card_ids=tuple(
                    _text(card_id, "island.cardIds[]")
                    for card_id in _as_list(item.get("cardIds"), "island.cardIds")
                ),
                title=_optional_text(item.get("title"), "island.title"),
            )
        )

    edges = []
    for item in _as_list(document.get("edges", []), "document.edges"):
        if not isinstance(item, Mapping):
            raise ProjectionError("each edge must be an object")
        from_kind = _text(item.get("fromKind"), "edge.fromKind")
        to_kind = _text(item.get("toKind"), "edge.toKind")
        if from_kind not in KINDS or to_kind not in KINDS:
            raise ProjectionError("edge kinds must be card or island")
        edges.append(
            ProjectedEdge(
                id=_text(item.get("id"), "edge.id"),
                from_id=_text(item.get("fromId"), "edge.fromId"),
                to_id=_text(item.get("toId"), "edge.toId"),
                type=_text(item.get("type"), "edge.type"),
                from_kind=from_kind,
                to_kind=to_kind,
            )
        )

    affiliations = []
    for item in _as_list(document.get("affiliations", []), "document.affiliations"):
        if not isinstance(item, Mapping):
            raise ProjectionError("each affiliation must be an object")
        affiliations.append(
            ProjectedAffiliation(
                id=_text(item.get("id"), "affiliation.id"),
                card_id=_text(item.get("cardId"), "affiliation.cardId"),
                island_id=_text(item.get("islandId"), "affiliation.islandId"),
            )
        )

    card_ids = {card.id for card in cards}
    island_ids = {island.id for island in islands}
    if len(card_ids) != len(cards):
        raise ProjectionError("card ids must be unique")
    if len(island_ids) != len(islands):
        raise ProjectionError("island ids must be unique")
    for island in islands:
        for card_id in island.card_ids:
            if card_id not in card_ids:
                raise ProjectionError(f"island {island.id} references unknown card {card_id}")
    for edge in edges:
        endpoints = {"card": card_ids, "island": island_ids}
        if edge.from_id not in endpoints[edge.from_kind]:
            raise ProjectionError(f"edge {edge.id} has unknown from {edge.from_id}")
        if edge.to_id not in endpoints[edge.to_kind]:
            raise ProjectionError(f"edge {edge.id} has unknown to {edge.to_id}")
    for affiliation in affiliations:
        if affiliation.card_id not in card_ids:
            raise ProjectionError(f"affiliation {affiliation.id} has unknown card")
        if affiliation.island_id not in island_ids:
            raise ProjectionError(f"affiliation {affiliation.id} has unknown island")

    return ProjectedDocument(
        id=document_id,
        title=title,
        cards=tuple(cards),
        islands=tuple(islands),
        edges=tuple(edges),
        affiliations=tuple(affiliations),
        contract_id=contract_id,
        contract_version=contract_version,
        tei_commit=tei_commit,
    )


def to_documentv1_payload(
    document: ProjectedDocument,
    *,
    transform: Mapping[str, Any],
    created_at: str,
    updated_at: str,
) -> dict[str, Any]:
    """Build a DocumentV1-shaped mapping from a projection.

    The projection does not carry `transform`, `createdAt`, or `updatedAt`, so
    the caller must supply them. This function does not save anything.
    """
    if not isinstance(transform, Mapping) or not transform:
        raise ProjectionError("transform is required")
    if not created_at or not updated_at:
        raise ProjectionError("createdAt and updatedAt are required")

    cards = []
    for card in document.cards:
        item: dict[str, Any] = {"id": card.id, "text": card.text, "x": card.x, "y": card.y}
        if card.claim_type is not None:
            item["claimType"] = card.claim_type
        if card.hold_state is not None:
            item["holdState"] = card.hold_state
        if card.text_reviewed is not None:
            item["textReviewed"] = card.text_reviewed
        cards.append(item)

    islands = []
    for island in document.islands:
        item = {"id": island.id, "cardIds": list(island.card_ids)}
        if island.title is not None:
            item["title"] = island.title
        islands.append(item)

    payload: dict[str, Any] = {
        "schemaVersion": "1.0.0",
        "version": 1,
        "id": document.id,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "transform": dict(transform),
        "cards": cards,
        "edges": [
            {
                "id": edge.id,
                "fromId": edge.from_id,
                "toId": edge.to_id,
                "fromKind": edge.from_kind,
                "toKind": edge.to_kind,
                "type": edge.type,
            }
            for edge in document.edges
        ],
        "islands": islands,
    }
    if document.title is not None:
        payload["title"] = document.title
    if document.affiliations:
        payload["affiliations"] = [
            {"id": item.id, "cardId": item.card_id, "islandId": item.island_id}
            for item in document.affiliations
        ]
    return payload