"""Internal R2 Source Snapshot read path; no public route or accepted schema.

A trusted Host must supply a server-owned Source capture metadata resolver and
Source-specific policy binding resolver. This module cannot authenticate the
origin of those injected resolvers; absent/invalid inputs therefore deny.
Neither Document's policy metadata nor an opaque Raw digest proves a Grant.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Protocol

from fastapi import Request
from sqlalchemy.orm import Session

from sui_sensemaking_api.access_control import (
    AccessControlAdapter,
    AccessRequest,
    AccessResource,
    ExternalPolicyAccessControlAdapter,
    resolve_access_decision,
)
from sui_sensemaking_api.database_content_store import DatabaseDocumentContentStore
from sui_sensemaking_api.document_access_resource import ServerOwnedDocumentResourceResolver
from sui_sensemaking_api.models import CanvasRevisionHeadRow, CanvasRevisionRow
from sui_sensemaking_api.source_member_context import (
    SourceMemberContext,
    resolve_source_member_context,
)
from sui_sensemaking_api.tenant_context import TenantContext

_DIGEST_RE = re.compile(r"[0-9a-f]{64}\Z")
_CAPTURE_MAX_LENGTH = 128
_POLICY_KEY_MAX_LENGTH = 128
_POLICY_REF_MAX_LENGTH = 2048


class SourceSnapshotReadUnavailable(RuntimeError):
    """A deliberately non-disclosing Source read failure."""


@dataclass(frozen=True, slots=True)
class SourceSnapshotReadAuthority:
    """Candidate internal lookup result, NOT a deployed DB or API schema.

    The record binds one capture occurrence to Raw bytes and a Source-only
    policy binding. The raw policy reference is resolved at read time.
    """

    tenant_id: str
    capture_id: str
    byte_size: int
    sha256_digest: str
    policy_binding_id: str
    policy_version: str


@dataclass(frozen=True, slots=True)
class RawSelectionContentCheckpoint:
    """Candidate content-only checkpoint matching the frontend R2 Reference.

    This is NOT an accepted Card field, Source identity, grant, or revision.
    The caller's byte range is untrusted until checked against a newly
    authorized Raw read.
    """

    raw_sha256: str
    selected_sha256: str
    start_byte: int
    end_byte: int


@dataclass(frozen=True, slots=True)
class SourceSelectionObservation:
    """Selected bytes from one authorized read, NOT historical continuity."""

    start_byte: int
    end_byte: int
    selected_text: str


class SourceSnapshotAuthorityResolver(Protocol):
    """Trusted Host lookup; client headers cannot supply these fields."""

    def resolve(
        self, *, tenant: TenantContext, capture_id: str
    ) -> SourceSnapshotReadAuthority | None: ...


class SourceSnapshotPolicyResolver(Protocol):
    """Resolve a Source policy; Document policy binding is not sufficient."""

    def resolve(
        self, *, tenant: TenantContext, capture_id: str,
        binding_id: str, policy_version: str,
    ) -> str | None: ...


class SourceRawReader(Protocol):
    def read(
        self, *, tenant_id: str, capture_id: str, expected_sha256: str
    ) -> bytes: ...


def _canonical(value: object, limit: int) -> bool:
    return (
        isinstance(value, str)
        and 0 < len(value) <= limit
        and value.strip() == value
        and all(character.isprintable() for character in value)
    )


def _qualified_authority(
    authority: object, *, tenant: TenantContext, capture_id: str
) -> bool:
    return (
        isinstance(authority, SourceSnapshotReadAuthority)
        and authority.tenant_id == tenant.tenant_id
        and authority.capture_id == capture_id
        and _canonical(authority.policy_binding_id, _POLICY_KEY_MAX_LENGTH)
        and _canonical(authority.policy_version, _POLICY_KEY_MAX_LENGTH)
        and type(authority.byte_size) is int
        and authority.byte_size > 0
        and isinstance(authority.sha256_digest, str)
        and _DIGEST_RE.fullmatch(authority.sha256_digest) is not None
    )


@dataclass(frozen=True, slots=True)
class _SourceReadReceipt:
    """One authorization result, not an Owner acceptance or Source version."""

    authority: SourceSnapshotReadAuthority
    policy_ref: str


def _require_current_source_read(
    *,
    member: SourceMemberContext,
    capture_id: str,
    authority_resolver: SourceSnapshotAuthorityResolver,
    source_policy_resolver: SourceSnapshotPolicyResolver,
    policy_adapter: AccessControlAdapter,
) -> _SourceReadReceipt:
    """Resolve the CURRENT source binding and ask its own PDP for read."""
    if not _canonical(capture_id, _CAPTURE_MAX_LENGTH):
        raise SourceSnapshotReadUnavailable("source unavailable")
    # Name-only matching permits a mock to impersonate an HTTP PDP. Until a
    # trusted pluggable policy-provider contract is admitted, require the exact
    # production HTTP adapter rather than a name-matched substitute/subclass.
    if type(policy_adapter) is not ExternalPolicyAccessControlAdapter:  # noqa: E721
        raise SourceSnapshotReadUnavailable("source unavailable")

    try:
        authority = authority_resolver.resolve(
            tenant=member.tenant, capture_id=capture_id,
        )
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None
    if not _qualified_authority(
        authority, tenant=member.tenant, capture_id=capture_id,
    ):
        raise SourceSnapshotReadUnavailable("source unavailable")

    try:
        policy_ref = source_policy_resolver.resolve(
            tenant=member.tenant,
            capture_id=capture_id,
            binding_id=authority.policy_binding_id,
            policy_version=authority.policy_version,
        )
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None
    if not _canonical(policy_ref, _POLICY_REF_MAX_LENGTH):
        raise SourceSnapshotReadUnavailable("source unavailable")

    decision = resolve_access_decision(
        adapter=policy_adapter,
        request=AccessRequest(
            action="read",
            auth=member.principal,
            tenant=member.tenant,
            resource=AccessResource(
                doc_id=capture_id,  # Existing policy transport field name.
                kind="source_snapshot",
                tenant_id=member.tenant.tenant_id,
                visibility="Restricted",
                policy_ref=policy_ref,
            ),
        ),
        fail_safe_mode="deny",
        require_tenant_scope=True,
    )
    if not decision.allow:
        raise SourceSnapshotReadUnavailable("source unavailable")

    return _SourceReadReceipt(authority=authority, policy_ref=policy_ref)


def _read_source_snapshot_with_member(
    *,
    member: SourceMemberContext,
    capture_id: str,
    authority_resolver: SourceSnapshotAuthorityResolver,
    source_policy_resolver: SourceSnapshotPolicyResolver,
    policy_adapter: AccessControlAdapter,
    raw_reader: SourceRawReader,
    revalidate_after_raw: bool = False,
) -> bytes:
    """Authorize Source before Raw; optionally recheck for pinned Card output.

    Rechecking is NOT a transactionally atomic grant, an Origin revision
    guarantee, or a substitute for server-owned authority provenance.
    """
    verified = _require_current_source_read(
        member=member,
        capture_id=capture_id,
        authority_resolver=authority_resolver,
        source_policy_resolver=source_policy_resolver,
        policy_adapter=policy_adapter,
    )
    try:
        raw = raw_reader.read(
            tenant_id=member.tenant.tenant_id,
            capture_id=capture_id,
            expected_sha256=verified.authority.sha256_digest,
        )
        if (
            not isinstance(raw, bytes)
            or len(raw) != verified.authority.byte_size
            or sha256(raw).hexdigest() != verified.authority.sha256_digest
        ):
            raise SourceSnapshotReadUnavailable("source unavailable")
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None
    if revalidate_after_raw:
        # Reading Raw may overlap with Source revocation, policy rotation or
        # authority re-binding. A second HTTP allow alone is insufficient:
        # the complete Source authority and resolved policy reference must
        # also remain unchanged, even if Raw bytes/digest are identical.
        current = _require_current_source_read(
            member=member,
            capture_id=capture_id,
            authority_resolver=authority_resolver,
            source_policy_resolver=source_policy_resolver,
            policy_adapter=policy_adapter,
        )
        if current != verified:
            raise SourceSnapshotReadUnavailable("source unavailable")
    return raw


def read_source_snapshot_for_member(
    *,
    request: Request,
    db: Session,
    capture_id: str,
    authority_resolver: SourceSnapshotAuthorityResolver,
    source_policy_resolver: SourceSnapshotPolicyResolver,
    policy_adapter: AccessControlAdapter,
    raw_reader: SourceRawReader,
) -> bytes:
    """Authenticate this request before any Source authority or Raw lookup."""
    member = resolve_source_member_context(request=request, db=db)
    return _read_source_snapshot_with_member(
        member=member,
        capture_id=capture_id,
        authority_resolver=authority_resolver,
        source_policy_resolver=source_policy_resolver,
        policy_adapter=policy_adapter,
        raw_reader=raw_reader,
    )


def read_source_selection_for_member(
    *,
    request: Request,
    db: Session,
    capture_id: str,
    checkpoint: RawSelectionContentCheckpoint,
    authority_resolver: SourceSnapshotAuthorityResolver,
    source_policy_resolver: SourceSnapshotPolicyResolver,
    policy_adapter: AccessControlAdapter,
    raw_reader: SourceRawReader,
) -> SourceSelectionObservation:
    """Re-read and authorize the whole Raw before accepting an exact byte span.

    The content checkpoint only constrains what bytes were selected; it cannot
    revalidate original Root/Revision/Grant history or authorize disclosure to
    another consumer. A future Product return must add those independent gates.
    """
    raw = read_source_snapshot_for_member(
        request=request,
        db=db,
        capture_id=capture_id,
        authority_resolver=authority_resolver,
        source_policy_resolver=source_policy_resolver,
        policy_adapter=policy_adapter,
        raw_reader=raw_reader,
    )

    return _observe_raw_selection(raw=raw, checkpoint=checkpoint)


def _observe_raw_selection(
    *, raw: bytes, checkpoint: RawSelectionContentCheckpoint,
) -> SourceSelectionObservation:
    """Check the exact byte span without shifting duplicate text positions."""
    if (
        not isinstance(checkpoint, RawSelectionContentCheckpoint)
        or not isinstance(checkpoint.raw_sha256, str)
        or _DIGEST_RE.fullmatch(checkpoint.raw_sha256) is None
        or not isinstance(checkpoint.selected_sha256, str)
        or _DIGEST_RE.fullmatch(checkpoint.selected_sha256) is None
        or type(checkpoint.start_byte) is not int
        or type(checkpoint.end_byte) is not int
        or checkpoint.start_byte < (3 if raw.startswith(b"\xef\xbb\xbf") else 0)
        or checkpoint.end_byte <= checkpoint.start_byte
        or checkpoint.end_byte > len(raw)
        or sha256(raw).hexdigest() != checkpoint.raw_sha256
    ):
        raise SourceSnapshotReadUnavailable("source unavailable")

    start = checkpoint.start_byte
    end = checkpoint.end_byte
    selected = raw[start:end]
    if sha256(selected).hexdigest() != checkpoint.selected_sha256:
        raise SourceSnapshotReadUnavailable("source unavailable")

    try:
        # Byte indexes must be at Unicode scalar boundaries. The raw slice
        # itself being decodable is insufficient: an offset inside a multi-byte
        # scalar could otherwise pass if both ends lie inside different runs.
        raw[:start].decode("utf-8", errors="strict")
        text = selected.decode("utf-8", errors="strict")
        raw[end:].decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        raise SourceSnapshotReadUnavailable("source unavailable") from None

    return SourceSelectionObservation(
        start_byte=start, end_byte=end, selected_text=text,
    )



@dataclass(frozen=True, slots=True)
class AuthorizedCardSourceSelection:
    """Candidate Host-owned selection row, NOT an accepted Product schema.

    The resolver must authorize CURRENT Document read/projection, resolve the
    saved Card by stable identity and the Document head at save time, and
    return this row from server-owned storage. Selection bytes alone are
    not a grant, a CAS receipt, or a proof of historic occurrence.
    """

    tenant_id: str
    document_id: str
    card_id: str
    capture_id: str
    # A saved Card selection is tied to one Document revision, not merely
    # identical bytes. All three fields must come from trusted Host storage.
    document_version: int
    document_head_version: int
    document_revision_id: str
    checkpoint: RawSelectionContentCheckpoint


class AuthorizedCardSourceSelectionResolver(Protocol):
    """Server-provided Document auth + saved selection lookup, not user input."""

    def resolve_authorized(
        self, *, member: SourceMemberContext, document_id: str, card_id: str,
    ) -> AuthorizedCardSourceSelection | None: ...


def _require_current_document_read(
    *,
    request: Request,
    db: Session,
    member: SourceMemberContext,
    document_id: str,
    document_resource_resolver: ServerOwnedDocumentResourceResolver,
    policy_adapter: AccessControlAdapter,
) -> None:
    """Use CURRENT Document policy for a Source-bearing Card projection."""
    # The saved Card resolver cannot be the only proof of Document read.
    # Resolve the actual Document metadata from the Host database and run a
    # separate CURRENT Document PDP decision. "read_only" fallback for ordinary
    # Document endpoints must not disclose a pinned Source selection.
    if (
        type(policy_adapter) is not ExternalPolicyAccessControlAdapter  # noqa: E721
        or type(document_resource_resolver) is not ServerOwnedDocumentResourceResolver  # noqa: E721
    ):
        raise SourceSnapshotReadUnavailable("source unavailable")
    try:
        doc_resource = document_resource_resolver.resolve(
            db=db, request=request, tenant=member.tenant,
            action="read", doc_id=document_id,
        )
        if (
            doc_resource.kind != "document"
            or doc_resource.doc_id != document_id
            or doc_resource.tenant_id != member.tenant.tenant_id
            # Explicit policy binding is required for this internal Source
            # projection, including if ordinary Document GET is public.
            or not _canonical(doc_resource.policy_ref, _POLICY_REF_MAX_LENGTH)
        ):
            raise SourceSnapshotReadUnavailable("source unavailable")
        doc_decision = resolve_access_decision(
            adapter=policy_adapter,
            request=AccessRequest(
                action="read", auth=member.principal,
                tenant=member.tenant, resource=doc_resource,
            ),
            fail_safe_mode="deny",
            require_tenant_scope=True,
        )
        if not doc_decision.allow:
            raise SourceSnapshotReadUnavailable("source unavailable")
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None



def _require_current_document_revision(
    *,
    db: Session,
    member: SourceMemberContext,
    document_id: str,
    saved: AuthorizedCardSourceSelection,
) -> None:
    """Fail if Document version/head/revision ownership no longer matches."""
    # This is the CURRENT revision of the actual Document, not a value
    # supplied by the Card resolver. Verify the generation projection against
    # the revision blob, and reject A→B→A or old-client writes even when the
    # final bytes and selection digest match again.
    try:
        stored = DatabaseDocumentContentStore(db).load(
            tenant=member.tenant, doc_id=document_id,
        )
        head = db.get(
            CanvasRevisionHeadRow,
            (member.tenant.tenant_id, document_id, "main"),
        )
        revision = (
            None
            if head is None
            else db.get(
                CanvasRevisionRow,
                (member.tenant.tenant_id, head.revision_id),
            )
        )
        if (
            stored is None
            or head is None
            or revision is None
            # The Revision head's FK only binds tenant+revision; it is not
            # sufficient to prove that the Revision belongs to this Document.
            or revision.doc_id != document_id
            or stored.row.version != saved.document_version
            or head.head_version != saved.document_head_version
            or head.revision_id != saved.document_revision_id
        ):
            raise SourceSnapshotReadUnavailable("source unavailable")
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None



def read_pinned_card_source_selection_for_member(
    *,
    request: Request,
    db: Session,
    document_id: str,
    card_id: str,
    selection_resolver: AuthorizedCardSourceSelectionResolver,
    document_resource_resolver: ServerOwnedDocumentResourceResolver,
    authority_resolver: SourceSnapshotAuthorityResolver,
    source_policy_resolver: SourceSnapshotPolicyResolver,
    policy_adapter: AccessControlAdapter,
    raw_reader: SourceRawReader,
) -> SourceSelectionObservation:
    """Observe the saved Card's exact span; clients cannot substitute offsets.

    The server-owned Document resource resolver and current PDP decision
    run BEFORE any Card selection lookup. This is an additional gate, not a
    substitute for the resolver's projection and saved-Revision obligations.
    The saved row must also match the current server-owned Document version,
    revision head version, and immutable revision ID, using a verified
    generation projection. No Document read-only fallback is allowed.
    The same Member Context is used throughout the request, and clients
    cannot supply replacement offsets or revision identifiers.
    """
    if not _canonical(document_id, _CAPTURE_MAX_LENGTH) or not _canonical(
        card_id, _CAPTURE_MAX_LENGTH
    ):
        raise SourceSnapshotReadUnavailable("source unavailable")
    member = resolve_source_member_context(request=request, db=db)

    _require_current_document_read(
        request=request, db=db, member=member, document_id=document_id,
        document_resource_resolver=document_resource_resolver,
        policy_adapter=policy_adapter,
    )

    try:
        saved = selection_resolver.resolve_authorized(
            member=member, document_id=document_id, card_id=card_id,
        )
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None

    if (
        not isinstance(saved, AuthorizedCardSourceSelection)
        or saved.tenant_id != member.tenant.tenant_id
        or saved.document_id != document_id
        or saved.card_id != card_id
        or not _canonical(saved.capture_id, _CAPTURE_MAX_LENGTH)
        or type(saved.document_version) is not int  # noqa: E721
        or saved.document_version < 1
        or type(saved.document_head_version) is not int  # noqa: E721
        or saved.document_head_version < 1
        or not _canonical(saved.document_revision_id, _CAPTURE_MAX_LENGTH)
        or not isinstance(saved.checkpoint, RawSelectionContentCheckpoint)
    ):
        raise SourceSnapshotReadUnavailable("source unavailable")

    _require_current_document_revision(
        db=db, member=member, document_id=document_id, saved=saved,
    )

    raw = _read_source_snapshot_with_member(
        member=member,
        capture_id=saved.capture_id,
        authority_resolver=authority_resolver,
        source_policy_resolver=source_policy_resolver,
        policy_adapter=policy_adapter,
        raw_reader=raw_reader,
        revalidate_after_raw=True,
    )
    observed = _observe_raw_selection(raw=raw, checkpoint=saved.checkpoint)

    # Raw read/PDP lookup may be slow. Recheck the Document decision,
    # selection receipt and revision immediately before returning the text.
    # A read-only Session is required: expiring the identity map makes the
    # second check query current DB state instead of replaying cached rows.
    # This narrows (but cannot eliminate) concurrent-revocation races.
    try:
        db.expire_all()
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None
    _require_current_document_read(
        request=request, db=db, member=member, document_id=document_id,
        document_resource_resolver=document_resource_resolver,
        policy_adapter=policy_adapter,
    )
    try:
        current_saved = selection_resolver.resolve_authorized(
            member=member, document_id=document_id, card_id=card_id,
        )
    except Exception:
        raise SourceSnapshotReadUnavailable("source unavailable") from None
    if current_saved != saved:
        raise SourceSnapshotReadUnavailable("source unavailable")
    _require_current_document_revision(
        db=db, member=member, document_id=document_id, saved=saved,
    )
    return observed
