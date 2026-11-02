"""Merge a projection into an existing DocumentV1 without dropping extra fields.

The projection covers only a subset of DocumentV1. A save that replaces the
document with the projection would delete fields the projection never carries.
This merge keeps unknown document, card, and island fields, and keeps existing
cards and islands that the projection does not mention.
"""

from __future__ import annotations

from typing import Any, Mapping

from sui_sensemaking_api.documentv1_projection import (
    ProjectedDocument,
    ProjectionError,
    to_documentv1_payload,
)


def validate_existing_document(existing: Mapping[str, Any]) -> None:
    """Reject an existing document that DocumentV1 would not accept.

    A merge preserves fields the projection does not carry, so an invalid
    existing document stays invalid after the merge. Validate before merging.
    """
    from pydantic import ValidationError

    from sui_sensemaking_api.models import DocumentV1

    try:
        DocumentV1.model_validate(existing)
    except ValidationError as exc:
        errors = exc.errors()
        message = errors[0].get("msg", "existing document is invalid") if errors else str(exc)
        raise ProjectionError(f"existing document is not a valid DocumentV1: {message}") from exc


def _merge_items(
    projected: list[dict[str, Any]],
    existing: list[Any],
) -> list[dict[str, Any]]:
    existing_by_id = {
        item.get("id"): dict(item)
        for item in existing
        if isinstance(item, Mapping) and item.get("id")
    }
    merged = []
    projected_ids = set()
    for item in projected:
        item_id = item.get("id")
        projected_ids.add(item_id)
        merged.append({**existing_by_id.get(item_id, {}), **item})
    for item in existing:
        if isinstance(item, Mapping) and item.get("id") and item["id"] not in projected_ids:
            merged.append(dict(item))
    return merged


def merge_preserving_existing(
    projected: ProjectedDocument,
    *,
    transform: Mapping[str, Any],
    created_at: str,
    updated_at: str,
    existing: Mapping[str, Any],
) -> dict[str, Any]:
    if existing.get("id") != projected.id:
        raise ValueError("existing document id does not match the projection")

    payload = to_documentv1_payload(
        projected, transform=transform, created_at=created_at, updated_at=updated_at
    )
    merged = dict(existing)
    merged.update(payload)
    if existing.get("createdAt"):
        merged["createdAt"] = existing["createdAt"]
    merged["cards"] = _merge_items(payload["cards"], existing.get("cards", []))
    merged["islands"] = _merge_items(payload["islands"], existing.get("islands", []))
    merged["edges"] = _merge_items(payload["edges"], existing.get("edges", []))
    if payload.get("affiliations") or existing.get("affiliations"):
        merged["affiliations"] = _merge_items(
            payload.get("affiliations", []), existing.get("affiliations", [])
        )
    return merged
