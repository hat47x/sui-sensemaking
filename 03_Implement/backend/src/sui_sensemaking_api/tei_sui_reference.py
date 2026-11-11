"""Typed read-only references from a TEI DocumentV1 projection artifact.

This module is the SUI-owned reader for the narrow migration path requested in
SUI #3401 (I0) and TEI #2497: TEI may *reference* a permitted subset of SUI
data, but it must not receive DocumentV1 as a second source of truth and must
not treat a readable Card as a TEI Accepted Meaning.

The input is the existing TEI Reference artifact
``tai.reference.tei-documentv1-projection/v0`` read through
``tei_reference_transport`` (ADR-0101 Option A). The output is a typed,
immutable reference envelope. It intentionally does not carry card text,
island titles, document titles, narratives, or review attribution: those are
content, and exposing them on the tenant plane is still an Owner decision
(SUI #3369). The reference carries stable SUI identities, relation shape,
review state, canvas positions, revision fingerprints, and explicit losses.

Fail-closed rules:

- a payload that is not the pinned projection schema is rejected;
- private / restricted entities are omitted from the reference, without IDs
  or counts, and only their entity kinds are reported;
- unreviewed text is withheld while the entity reference is kept, so
  "unreviewed" is distinguishable from "absent";
- Tree, canvas transform, narratives, and review attribution are reported as
  unsupported or partial rather than reconstructed.

No function in this module writes DocumentV1, saves a document, or changes a
review state.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Literal, Mapping

from sui_sensemaking_api.documentv1_projection import (
    ProjectedDocument,
    ProjectionError,
    from_artifact,
)

REFERENCE_SCHEMA = "tai.reference.sui-document-reference/v0"
PROJECTION_SCHEMA = "tai.reference.tei-documentv1-projection/v0"
REFERENCE_AUTHORITY = "sui-document"
ACCEPTED_MEANING = False

ReviewState = Literal["reviewed", "unreviewed", "unknown"]
SourceStatus = Literal["active", "revoked", "expired", "unknown"]
ChangeState = Literal[
    "initial",
    "unchanged",
    "content-changed",
    "source-revision-changed",
    "source-revision-and-content-changed",
]
CompletenessState = Literal["complete", "partial", "unknown"]


class SuiReferenceError(ValueError):
    """Raised when an artifact cannot be read as a typed SUI reference."""


class SuiReferenceSourceUnavailable(SuiReferenceError):
    """Raised when the artifact's source was revoked or expired.

    The caller must not fall back to the cached reference: the reference is
    fail-closed and carries no entity identities.
    """

    def __init__(self, status: str) -> None:
        super().__init__(f"source is {status}")
        self.status = status


class SuiReferenceDisclosureRestricted(SuiReferenceError):
    """Raised when the document itself is outside the permitted disclosure.

    Entity-level restrictions are omitted per entity; a document-level
    restriction is stricter and returns nothing at all, so that even kinds or
    counts do not leak.
    """


@dataclass(frozen=True)
class EntityRef:
    kind: str
    id: str

    def as_json(self) -> dict[str, str]:
        return {"kind": self.kind, "id": self.id}


@dataclass(frozen=True)
class CardReference:
    ref: EntityRef
    claim_type: str | None
    hold_state: str | None
    text_review: ReviewState
    content_status: Literal["not-carried", "withheld-unreviewed"]
    x: float
    y: float
    memberships: tuple[dict[str, Any], ...]

    def as_json(self) -> dict[str, Any]:
        return {
            "ref": self.ref.as_json(),
            "claimType": self.claim_type,
            "holdState": self.hold_state,
            "review": {"text": self.text_review},
            "content": {"status": self.content_status},
            "canvas": {"x": self.x, "y": self.y, "coordinateSource": "artifact"},
            "memberships": list(self.memberships),
        }


@dataclass(frozen=True)
class IslandReference:
    ref: EntityRef
    title_review: ReviewState
    containment_card_refs: tuple[EntityRef, ...]
    parent_island_ref: EntityRef | None
    membership_count: int | None

    def as_json(self) -> dict[str, Any]:
        return {
            "ref": self.ref.as_json(),
            "review": {"title": self.title_review},
            "containmentCardRefs": [item.as_json() for item in self.containment_card_refs],
            "parentIslandRef": (
                self.parent_island_ref.as_json() if self.parent_island_ref else None
            ),
            "affiliationRefCount": self.membership_count,
        }


@dataclass(frozen=True)
class RelationReference:
    ref: EntityRef
    relation_kind: Literal["directed", "affiliation", "containment"]
    from_ref: EntityRef
    to_ref: EntityRef
    relation_type: str | None
    #: For directed relations, the parallel-edge group this occurrence belongs
    #: to. `index` is 1-based and `count` is the number of occurrences with the
    #: same from/to/type. A consumer that groups by endpoints must not collapse
    #: occurrences that share a group.
    parallel_group: str | None = None
    parallel_index: int = 1
    parallel_count: int = 1

    def as_json(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "ref": self.ref.as_json(),
            "relationKind": self.relation_kind,
            "fromRef": self.from_ref.as_json(),
            "toRef": self.to_ref.as_json(),
            "relationType": self.relation_type,
        }
        if self.relation_kind == "directed":
            body["parallel"] = {
                "groupRef": self.parallel_group,
                "index": self.parallel_index,
                "count": self.parallel_count,
            }
        return body


@dataclass(frozen=True)
class RevisionObservation:
    source_revision: str | None
    document_digest: str
    revision_status: Literal["observed", "unknown"]
    change: ChangeState
    previous_digest: str | None
    previous_source_revision: str | None
    previous_reference_invalidated: bool

    def as_json(self) -> dict[str, Any]:
        return {
            "sourceRevision": self.source_revision,
            "documentDigest": self.document_digest,
            "revisionStatus": self.revision_status,
            "change": self.change,
            "previousDigest": self.previous_digest,
            "previousSourceRevision": self.previous_source_revision,
            "previousReferenceInvalidated": self.previous_reference_invalidated,
        }


@dataclass(frozen=True)
class SuiDocumentReference:
    document_ref: EntityRef
    source: dict[str, Any]
    cards: tuple[CardReference, ...]
    islands: tuple[IslandReference, ...]
    relations: tuple[RelationReference, ...]
    revision: RevisionObservation
    completeness: dict[str, Any]
    disclosure: dict[str, Any]
    losses: tuple[dict[str, str], ...]

    def as_json(self) -> dict[str, Any]:
        return {
            "schema": REFERENCE_SCHEMA,
            "authority": REFERENCE_AUTHORITY,
            "acceptedMeaning": ACCEPTED_MEANING,
            "semanticStatus": "reference-only",
            "document": {"ref": self.document_ref.as_json(), **self.source},
            "revision": self.revision.as_json(),
            "cards": [item.as_json() for item in self.cards],
            "islands": [item.as_json() for item in self.islands],
            "relations": [item.as_json() for item in self.relations],
            "completeness": self.completeness,
            "disclosure": self.disclosure,
            "losses": list(self.losses),
        }


def _canonical_digest(document: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        document,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _review_flag(value: object) -> ReviewState:
    if value is True:
        return "reviewed"
    if value is False:
        return "unreviewed"
    return "unknown"


def _is_restricted(raw: Mapping[str, Any]) -> bool:
    for key in ("visibility", "disclosure", "access", "scope"):
        value = raw.get(key)
        if isinstance(value, str) and value.lower() in {
            "private",
            "restricted",
            "secret",
            "internal-only",
        }:
            return True
        if isinstance(value, Mapping):
            nested = value.get("scope") if key == "disclosure" else value.get("visibility")
            if isinstance(nested, str) and nested.lower() in {
                "private",
                "restricted",
                "secret",
                "internal-only",
            }:
                return True
    return raw.get("private") is True or raw.get("restricted") is True


def _source_status(source: Mapping[str, Any]) -> SourceStatus:
    """Read the source lifecycle state declared by the artifact.

    `unknown` means the artifact says nothing, so freshness cannot be
    established. It is not treated as `active`.
    """
    value = source.get("status")
    if value == "active":
        return "active"
    if value == "revoked":
        return "revoked"
    if value == "expired":
        return "expired"
    return "unknown"


def _parallel_group_ref(
    from_kind: str, from_id: str, to_kind: str, to_id: str, relation_type: str
) -> str:
    return f"directed:{from_kind}:{from_id}:{relation_type}:{to_kind}:{to_id}"


def _source_revision(source: Mapping[str, Any]) -> str | None:
    for key in ("documentRevision", "revision", "documentETag", "etag"):
        value = _string_or_none(source.get(key))
        if value is not None:
            return value
    return None


def _completeness(source: Mapping[str, Any], document: Mapping[str, Any]) -> str | None:
    for container in (source, document):
        value = container.get("completeness")
        if isinstance(value, str) and value in {"complete", "partial"}:
            return value
    return None


def _change(
    *,
    previous_digest: str | None,
    current_digest: str,
    previous_source_revision: str | None,
    current_source_revision: str | None,
) -> ChangeState:
    if previous_digest is None:
        return "initial"
    content_changed = previous_digest != current_digest
    revision_changed = (
        previous_source_revision is not None
        and current_source_revision is not None
        and previous_source_revision != current_source_revision
    )
    if content_changed and revision_changed:
        return "source-revision-and-content-changed"
    if content_changed:
        return "content-changed"
    if revision_changed:
        return "source-revision-changed"
    return "unchanged"


def _edge_id_is_unique(document: ProjectedDocument) -> bool:
    ids = [edge.id for edge in document.edges]
    return len(ids) == len(set(ids))


def build_sui_reference(
    payload: Mapping[str, Any],
    *,
    previous_digest: str | None = None,
    previous_source_revision: str | None = None,
) -> SuiDocumentReference:
    """Build a typed reference from one projection artifact.

    ``previous_digest`` and ``previous_source_revision`` make a re-reference
    explicit: the result says whether content, source revision, or both
    changed, and whether the prior reference is invalidated. Passing neither
    is the first reference (``change=initial``).
    """
    if payload.get("schema") != PROJECTION_SCHEMA:
        raise SuiReferenceError(f"schema must be {PROJECTION_SCHEMA}")
    if previous_digest is not None and not isinstance(previous_digest, str):
        raise SuiReferenceError("previous_digest must be a string when present")
    if previous_source_revision is not None and not isinstance(
        previous_source_revision, str
    ):
        raise SuiReferenceError("previous_source_revision must be a string when present")

    try:
        document = from_artifact(payload)
    except ProjectionError as error:
        raise SuiReferenceError(str(error)) from error
    if not _edge_id_is_unique(document):
        raise SuiReferenceError("edge ids must be unique")

    raw_document = payload.get("document")
    if not isinstance(raw_document, Mapping):
        raise SuiReferenceError("document must be an object")
    raw_cards = {
        item.get("id"): item
        for item in raw_document.get("cards", [])
        if isinstance(item, Mapping) and isinstance(item.get("id"), str)
    }
    raw_islands = {
        item.get("id"): item
        for item in raw_document.get("islands", [])
        if isinstance(item, Mapping) and isinstance(item.get("id"), str)
    }
    source = payload.get("source")
    if not isinstance(source, Mapping):
        raise SuiReferenceError("source must be an object")

    source_status = _source_status(source)
    if source_status == "revoked":
        raise SuiReferenceSourceUnavailable("revoked")
    if source_status == "expired":
        raise SuiReferenceSourceUnavailable("expired")

    declared_disclosure = payload.get("disclosure")
    raw_document_meta = raw_document.get("document")
    document_restricted = _is_restricted(raw_document) or (
        isinstance(raw_document_meta, Mapping) and _is_restricted(raw_document_meta)
    )
    if document_restricted or _is_restricted({"disclosure": declared_disclosure}):
        # A document-level restriction is stricter than entity-level omission:
        # return nothing, so that kinds and counts do not leak either.
        raise SuiReferenceDisclosureRestricted(
            "the document is outside the permitted disclosure"
        )

    restricted_kinds: set[str] = set()
    visible_card_ids: set[str] = set()
    visible_island_ids: set[str] = set()

    card_references: list[CardReference] = []
    for card in document.cards:
        raw = raw_cards.get(card.id, {})
        if _is_restricted(raw):
            restricted_kinds.add("card")
            continue
        visible_card_ids.add(card.id)
        text_review = _review_flag(card.text_reviewed)
        card_references.append(
            CardReference(
                ref=EntityRef("sui.card", card.id),
                claim_type=card.claim_type,
                hold_state=card.hold_state,
                text_review=text_review,
                content_status=(
                    "not-carried" if text_review == "reviewed" else "withheld-unreviewed"
                ),
                x=card.x,
                y=card.y,
                memberships=(),
            )
        )

    island_references: list[IslandReference] = []
    for island in document.islands:
        raw = raw_islands.get(island.id, {})
        if _is_restricted(raw):
            restricted_kinds.add("island")
            continue
        visible_island_ids.add(island.id)
        containment = tuple(
            EntityRef("sui.card", card_id)
            for card_id in island.card_ids
            if card_id in visible_card_ids
        )
        title_review = _review_flag(raw.get("titleReviewed"))
        parent = _string_or_none(raw.get("parentIslandId"))
        parent_ref = EntityRef("sui.island", parent) if parent else None
        island_references.append(
            IslandReference(
                ref=EntityRef("sui.island", island.id),
                title_review=title_review,
                containment_card_refs=containment,
                parent_island_ref=parent_ref,
                membership_count=None,
            )
        )

    relations: list[RelationReference] = []
    membership_by_card: dict[str, list[dict[str, Any]]] = {}
    affiliation_count_by_island: dict[str, int] = {}

    for island in document.islands:
        if island.id not in visible_island_ids:
            continue
        for card_id in island.card_ids:
            if card_id not in visible_card_ids:
                continue
            relation = RelationReference(
                ref=EntityRef("sui.containment", f"{island.id}:{card_id}"),
                relation_kind="containment",
                from_ref=EntityRef("sui.island", island.id),
                to_ref=EntityRef("sui.card", card_id),
                relation_type="contains",
            )
            relations.append(relation)
            membership_by_card.setdefault(card_id, []).append(
                {
                    "kind": "containment",
                    "islandRef": EntityRef("sui.island", island.id).as_json(),
                }
            )

    for affiliation in document.affiliations:
        if (
            affiliation.card_id not in visible_card_ids
            or affiliation.island_id not in visible_island_ids
        ):
            continue
        relation = RelationReference(
            ref=EntityRef("sui.affiliation", affiliation.id),
            relation_kind="affiliation",
            from_ref=EntityRef("sui.card", affiliation.card_id),
            to_ref=EntityRef("sui.island", affiliation.island_id),
            relation_type="affiliated-with",
        )
        relations.append(relation)
        membership_by_card.setdefault(affiliation.card_id, []).append(
            {
                "kind": "affiliation",
                "islandRef": EntityRef("sui.island", affiliation.island_id).as_json(),
            }
        )
        affiliation_count_by_island[affiliation.island_id] = (
            affiliation_count_by_island.get(affiliation.island_id, 0) + 1
        )

    parallel_counts: dict[tuple[str, str, str, str, str], int] = {}
    parallel_seen: dict[tuple[str, str, str, str, str], int] = {}
    for edge in document.edges:
        if edge.from_id not in (
            visible_card_ids if edge.from_kind == "card" else visible_island_ids
        ):
            continue
        if edge.to_id not in (
            visible_card_ids if edge.to_kind == "card" else visible_island_ids
        ):
            continue
        key = (edge.from_kind, edge.from_id, edge.to_kind, edge.to_id, edge.type)
        parallel_counts[key] = parallel_counts.get(key, 0) + 1

    for edge in document.edges:
        if edge.from_id not in (
            visible_card_ids if edge.from_kind == "card" else visible_island_ids
        ):
            continue
        if edge.to_id not in (
            visible_card_ids if edge.to_kind == "card" else visible_island_ids
        ):
            continue
        key = (edge.from_kind, edge.from_id, edge.to_kind, edge.to_id, edge.type)
        parallel_seen[key] = parallel_seen.get(key, 0) + 1
        relations.append(
            RelationReference(
                ref=EntityRef("sui.edge", edge.id),
                relation_kind="directed",
                from_ref=EntityRef(f"sui.{edge.from_kind}", edge.from_id),
                to_ref=EntityRef(f"sui.{edge.to_kind}", edge.to_id),
                relation_type=edge.type,
                parallel_group=_parallel_group_ref(
                    edge.from_kind, edge.from_id, edge.to_kind, edge.to_id, edge.type
                ),
                parallel_index=parallel_seen[key],
                parallel_count=parallel_counts[key],
            )
        )

    cards_with_memberships = tuple(
        CardReference(
            ref=card.ref,
            claim_type=card.claim_type,
            hold_state=card.hold_state,
            text_review=card.text_review,
            content_status=card.content_status,
            x=card.x,
            y=card.y,
            memberships=tuple(membership_by_card.get(card.ref.id, ())),
        )
        for card in card_references
    )

    islands_with_memberships = tuple(
        IslandReference(
            ref=island.ref,
            title_review=island.title_review,
            containment_card_refs=island.containment_card_refs,
            parent_island_ref=island.parent_island_ref,
            membership_count=affiliation_count_by_island.get(island.ref.id, 0),
        )
        for island in island_references
    )

    current_digest = _canonical_digest(raw_document)
    current_revision = _source_revision(source)
    change = _change(
        previous_digest=previous_digest,
        current_digest=current_digest,
        previous_source_revision=previous_source_revision,
        current_source_revision=current_revision,
    )
    invalidated = change in {
        "content-changed",
        "source-revision-changed",
        "source-revision-and-content-changed",
    }

    declared_completeness = _completeness(source, raw_document)
    reasons: list[str] = []
    if declared_completeness == "partial":
        reasons.append("artifact-declares-partial")
    if restricted_kinds:
        reasons.append("private-entities-omitted")
    if any(
        island.parent_island_ref is not None
        and island.parent_island_ref.id not in visible_island_ids
        for island in islands_with_memberships
    ):
        reasons.append("parent-island-not-available")
    if len(cards_with_memberships) < len(document.cards):
        reasons.append("some-cards-not-referenceable")
    completeness_status: CompletenessState
    if declared_completeness == "complete" and not reasons:
        completeness_status = "complete"
    elif declared_completeness == "partial" or reasons:
        completeness_status = "partial"
    else:
        completeness_status = "unknown"

    losses: list[dict[str, str]] = [
        {
            "feature": "tree-forest",
            "status": "unsupported",
            "detail": (
                "DocumentV1 projection v0 carries no Tree/Forest. Island "
                "containment and parentIslandId are not a Tree hierarchy."
            ),
        },
        {
            "feature": "canvas-transform",
            "status": "partial",
            "detail": (
                "Card x/y are preserved; document transform, z-order, zoom, "
                "and gesture history are not carried."
            ),
        },
        {
            "feature": "island-geometry",
            "status": "partial",
            "detail": "Containment and parent link are carried; polygon/rect geometry is not.",
        },
        {
            "feature": "review-attribution",
            "status": "unsupported",
            "detail": (
                "Projection v0 carries textReviewed/titleReviewed flags only; "
                "reviewerRef, reviewedAt, and document reviewAttribution are not carried."
            ),
        },
        {
            "feature": "narratives-and-summaries",
            "status": "unsupported",
            "detail": "Narrative, relation summary, island summary, and critique text are not carried.",
        },
        {
            "feature": "relation-rationale",
            "status": "unsupported",
            "detail": "Edge identity, direction, and type are carried; rationale and evidence are not.",
        },
        {
            "feature": "document-title",
            "status": "unsupported",
            "detail": "The document title is content and is not carried in this reference.",
        },
    ]
    if current_revision is None:
        losses.append(
            {
                "feature": "source-revision",
                "status": "unresolved",
                "detail": (
                    "The artifact has no SUI source revision. documentDigest is a "
                    "content fingerprint, not a SUI revision."
                ),
            }
        )
    if source_status == "unknown":
        losses.append(
            {
                "feature": "source-status",
                "status": "unresolved",
                "detail": (
                    "The artifact declares no source lifecycle state. Freshness is "
                    "not established; this is not a claim that the source is active."
                ),
            }
        )

    disclosure = {
        "mode": "references-only",
        "textIncluded": False,
        "unreviewedContent": "withheld",
        "privateEntities": "omitted",
        "restrictedKinds": sorted(restricted_kinds),
        "hasRestrictedContent": bool(restricted_kinds),
    }

    return SuiDocumentReference(
        document_ref=EntityRef("sui.document", document.id),
        source={
            "projectionSchema": PROJECTION_SCHEMA,
            "projectionContractId": document.contract_id,
            "projectionContractVersion": document.contract_version,
            "teiCommit": document.tei_commit,
            "referenceOf": "SUI DocumentV1",
            "status": source_status,
        },
        cards=cards_with_memberships,
        islands=islands_with_memberships,
        relations=tuple(relations),
        revision=RevisionObservation(
            source_revision=current_revision,
            document_digest=current_digest,
            revision_status="observed" if current_revision else "unknown",
            change=change,
            previous_digest=previous_digest,
            previous_source_revision=previous_source_revision,
            previous_reference_invalidated=invalidated,
        ),
        completeness={"status": completeness_status, "reasons": reasons},
        disclosure=disclosure,
        losses=tuple(losses),
    )


def reference_to_json(reference: SuiDocumentReference) -> dict[str, Any]:
    """Serialize a reference without adding any content fields."""
    return reference.as_json()


def reference_digest(reference: SuiDocumentReference) -> str:
    """Digest the typed reference itself, for a consumer-side receipt."""
    encoded = json.dumps(
        reference.as_json(), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
