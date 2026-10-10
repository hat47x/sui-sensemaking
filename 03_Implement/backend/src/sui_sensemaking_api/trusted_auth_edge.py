"""ADR-0063 D9-3: concrete SaasIdentityContextResolver using JWT bearer tokens.

Deployment auth edge (identity broker / IdP) issues a signed JWT. This module
verifies the token, resolves the subject to a sui-sensemaking user, and returns a
ResolvedIdentity carrying the VerifiedTenantClaim for downstream tenant
resolution.

JWT requirements (ADR-0063 D2/D4):
- Algorithm allowlist comes from SUI_JWT_ALGORITHMS (default RS256,ES256); Settings accepts known RS/ES/PS asymmetric algorithms and rejects HMAC, 'none', and unknown values.
- Token header jku/x5u/embedded key references are never followed.
- kid is resolved from the fetched JWK set only.
- Clock skew tolerance: 60 seconds (fixed, not configurable).
- exp/iss/aud/alg/iat validation is enforced on every call.
- Bearer access-token reuse is governed by expiry; ``jti`` is not treated as a
  one-time request nonce. Sender-constrained replay defence remains a separate
  protocol concern.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import jwt
from fastapi import Request
from sqlalchemy.orm import Session

from sui_sensemaking_api.auth_context import AuthContext, ResolvedIdentity
from sui_sensemaking_api.auth_session_hash import derive_session_key_hash
from sui_sensemaking_api.jwks_store import JwksStore
from sui_sensemaking_api.models import IdentityProviderRow, TenantIdentityProviderRow
from sui_sensemaking_api.saas_auth_state import DatabaseSaasAuthSessionStore
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.tenant_context import VerifiedTenantClaim

logger = logging.getLogger(__name__)
_JWT_CLOCK_SKEW_SECONDS = 60
# ADR-0064: maximum JWKS response size in bytes (128 KiB).
_JWKS_MAX_RESPONSE_BYTES = 128 * 1024
# Allowed JWK key types. HMAC ('oct') is always rejected.
_ALLOWED_JWK_KEY_TYPES = frozenset({"RSA", "EC"})
# ADR-0074 decision 1/3: the BFF-issued opaque session cookie, read only when
# no bearer token is present (AC-1 cookie-fallback branch, ADR-0074 decision 2).
_AUTH_SESSION_COOKIE = "Sui-Sensemaking-Auth-Session"
# SAAS-TENANT-SESSION-BINDING-01 AC-6: generous headroom over the real
# secrets.token_urlsafe(32) length (~43 chars), not a tight format check.
_MAX_AUTH_SESSION_COOKIE_LENGTH = 256


# ---------------------------------------------------------------------------
# Algorithm helpers
# ---------------------------------------------------------------------------


def _jwt_algorithms() -> list[str]:
    """Return the configured JWT algorithm allowlist (comma-separated setting).

    Settings validation guarantees a non-empty, HMAC-free list of known
    asymmetric algorithms. This is defense-in-depth: an empty list passed
    to jwt.decode(algorithms=[]) would silently accept any algorithm,
    including 'none'.
    """
    algorithms = [alg.strip() for alg in settings.jwt_algorithms.split(",") if alg.strip()]
    if not algorithms:
        raise JwtIdentityError(status_code=503, code="configuration_error")
    return algorithms

# Header name carrying the JWT bearer token (ADR-0020 §3-2 jwt_header mode).
_JWT_HEADER = "X-Sui-Sensemaking-Authorization"


def _extract_bearer_token(request: Request) -> str | None:
    """Extract a bearer token from the configured header."""
    raw = request.headers.get(_JWT_HEADER)
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return None
    if value.lower().startswith("bearer "):
        return value[7:].strip()
    return value


@dataclass(frozen=True, slots=True)
class JwtIdentityError(Exception):
    """Identity layer error — opaque to the caller (ADR-0063 D6)."""

    status_code: int
    code: str


@dataclass(frozen=True, slots=True)
class VerifiedOidcToken:
    """Cryptographically verified provider token, before any tenant mapping.

    This is intentionally narrower than ``VerifiedTenantClaim``.  Guest
    admission may consume issuer/subject evidence without inheriting a receiving
    tenant's IdP trust, membership, or provisioning semantics.
    """

    provider: IdentityProviderRow
    claims: dict[str, object]
    subject: str


def _resolve_identity_provider(db: Session, issuer: str, audience: str) -> IdentityProviderRow | None:
    """Look up an active identity provider by issuer + audience."""
    return (
        db.query(IdentityProviderRow)
        .filter(
            IdentityProviderRow.issuer == issuer,
            IdentityProviderRow.audience == audience,
            IdentityProviderRow.lifecycle_state == "active",
            IdentityProviderRow.protocol.in_({"oidc"}),
        )
        .one_or_none()
    )


def _resolve_identity_provider_by_issuer(db: Session, issuer: str) -> IdentityProviderRow:
    """Look up the single active identity provider for an issuer (no audience to
    filter on -- an auth-session row only carries the issuer, per ADR-0074
    decision 3). Zero or more than one match is a deployment-configuration error,
    not a per-request authorization decision, so it fails closed with 503 rather
    than 401.
    """
    providers = (
        db.query(IdentityProviderRow)
        .filter(
            IdentityProviderRow.issuer == issuer,
            IdentityProviderRow.lifecycle_state == "active",
            IdentityProviderRow.protocol.in_({"oidc"}),
        )
        .all()
    )
    if len(providers) != 1:
        logger.info(
            "auth edge: ambiguous provider for auth-session issuer=%s count=%d",
            issuer,
            len(providers),
        )
        raise JwtIdentityError(status_code=503, code="configuration_error")
    return providers[0]


def _resolve_key_by_kid(
    jwks_keys: list[dict[str, object]],
    kid: str | None,
) -> object:
    """Find a JWK by kid and return its cryptography key object.

    ADR-0063 D4: kid is resolved from the fetched JWK set only;
    jku/x5u/embedded key references are never followed.

    If kid is None and the JWKS contains exactly one key, that key is used
    (compatibility with single-key IdPs that omit kid).
    """
    if kid is None:
        if len(jwks_keys) == 1:
            return _key_from_jwk_dict(jwks_keys[0])
        raise JwtIdentityError(status_code=401, code="invalid_token")
    for key_dict in jwks_keys:
        if key_dict.get("kid") == kid:
            return _key_from_jwk_dict(key_dict)
    raise JwtIdentityError(status_code=401, code="invalid_token")


def _key_from_jwk_dict(key_dict: dict[str, object]) -> object:
    """Convert a JWK dict to a cryptography key, rejecting non-RSA/EC types."""
    kty = key_dict.get("kty")
    if not isinstance(kty, str) or kty not in _ALLOWED_JWK_KEY_TYPES:
        raise JwtIdentityError(status_code=401, code="invalid_token")
    pyjwk = jwt.PyJWK.from_dict(key_dict)  # type: ignore[attr-defined]
    return pyjwk.key


def _normalize_audience(raw_aud: object) -> list[str]:
    """Normalize the aud claim to a list of audience strings.

    OIDC allows aud to be a single string or an array. Returns a non-empty
    list of unique audience values.
    """
    if isinstance(raw_aud, str):
        return [raw_aud]
    if isinstance(raw_aud, list):
        result = [str(v) for v in raw_aud if isinstance(v, str)]
        if result:
            return list(dict.fromkeys(result))  # deduplicate preserving order
    return []


def _verify_jwt(
    token: str,
    jwks_keys: list[dict[str, object]],
    issuer: str,
    audience: str,
) -> dict[str, object]:
    """Verify a JWT token against the given JWK set and expected issuer/audience.

    A token whose ``aud`` is an array is accepted only when it contains exactly the
    expected audience. The expected audience is always chosen by the caller, never taken
    from the token.

    Raises JwtIdentityError on any verification failure.
    """
    # ADR-0063 D4: resolve kid from the fetched JWK set only.
    try:
        header_unverified = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise JwtIdentityError(status_code=401, code="invalid_token") from None
    kid = header_unverified.get("kid")

    try:
        signing_key = _resolve_key_by_kid(jwks_keys, kid)
    except JwtIdentityError:
        raise
    except Exception:
        raise JwtIdentityError(status_code=401, code="invalid_token") from None

    try:
        return jwt.decode(
            token,
            key=signing_key,
            algorithms=list(_jwt_algorithms()),
            issuer=issuer,
            audience=audience,
            options={
                "require": ["exp", "iss", "aud", "sub", "iat"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_iss": True,
                "verify_aud": True,
                "verify_iat": True,
                "verify_nbf": True,
            },
            leeway=_JWT_CLOCK_SKEW_SECONDS,
        )
    except jwt.InvalidAudienceError:
        # PyJWT already accepts an ``aud`` array that contains the expected audience, so a
        # failure here means the token was not issued for this audience. Never fall back to
        # the token's own ``aud`` values: that turns the caller's pinned audience into a
        # no-op (a token minted for any audience would verify).
        raise JwtIdentityError(status_code=401, code="invalid_audience") from None
    except jwt.ExpiredSignatureError:
        raise JwtIdentityError(status_code=401, code="token_expired") from None
    except jwt.InvalidIssuerError:
        raise JwtIdentityError(status_code=401, code="invalid_issuer") from None
    except jwt.InvalidSignatureError:
        raise JwtIdentityError(status_code=401, code="invalid_signature") from None
    except jwt.PyJWTError:
        raise JwtIdentityError(status_code=401, code="invalid_token") from None


def _jwks_keys_for_provider(
    *,
    jwks_store: JwksStore,
    provider: IdentityProviderRow,
) -> list[dict[str, object]]:
    """Return cached or freshly fetched keys for a globally configured IdP."""
    if not jwks_store.needs_refresh(provider.id):
        cached = jwks_store.get(provider.id)
        if cached is not None:
            return cached

    if not jwks_store.can_force_refresh(provider.id):
        stale = jwks_store.get(provider.id)
        if stale is not None:
            return stale
        raise JwtIdentityError(status_code=503, code="jwks_unavailable")

    try:
        keys = _fetch_jwks(provider.jwks_uri)
        jwks_store.set(provider.id, keys)
        return keys
    except OSError:
        jwks_store.set_fresh_failure(provider.id)
        stale = jwks_store.get(provider.id)
        if stale is not None:
            return stale
        raise JwtIdentityError(status_code=503, code="jwks_unavailable") from None


def verify_configured_oidc_token(
    *,
    db: Session,
    token: str,
    jwks_store: JwksStore,
) -> VerifiedOidcToken:
    """Verify a configured OIDC token without resolving user or tenant trust.

    ``IdentityProviderRow`` is the global cryptographic provider registry.  This
    function deliberately stops before ``UserIdentityRow``,
    ``TenantIdentityProviderRow``, ``TenantMembershipRow`` and
    ``VerifiedTenantClaim`` so guest admission can reuse the hardened JWT/JWKS
    verifier without becoming a tenant member.
    """
    try:
        claims_unverified: dict[str, object] = jwt.decode(
            token,
            options={"verify_signature": False},
            algorithms=list(_jwt_algorithms()),
        )
    except jwt.PyJWTError:
        raise JwtIdentityError(status_code=401, code="invalid_token") from None

    issuer = claims_unverified.get("iss")
    if not isinstance(issuer, str):
        raise JwtIdentityError(status_code=401, code="invalid_token")
    aud_values = _normalize_audience(claims_unverified.get("aud"))
    if not aud_values:
        raise JwtIdentityError(status_code=401, code="invalid_token")

    provider = None
    matched_audience = ""
    for audience in aud_values:
        provider = _resolve_identity_provider(db, issuer, audience)
        if provider is not None:
            matched_audience = audience
            break
    if provider is None:
        logger.info("auth edge: unknown provider issuer=%s", issuer)
        raise JwtIdentityError(status_code=401, code="unknown_provider")

    verified = _verify_jwt(
        token,
        _jwks_keys_for_provider(jwks_store=jwks_store, provider=provider),
        issuer,
        matched_audience,
    )
    subject = verified.get("sub")
    if not isinstance(subject, str) or not subject:
        raise JwtIdentityError(status_code=401, code="invalid_token")
    return VerifiedOidcToken(provider=provider, claims=verified, subject=subject)


def verify_oidc_token_for_audience(
    *,
    db: Session,
    token: str,
    jwks_store: JwksStore,
    audience: str,
) -> VerifiedOidcToken:
    """Verify a token from a registered issuer, requiring one exact, caller-chosen audience.

    ADR-0094: unlike ``verify_configured_oidc_token`` this does not look for an
    ``identity_providers`` row matching the token's own ``aud``. The issuer is
    resolved to its single active row (the same row member login uses), and the
    audience is pinned by the caller. A token minted for any other audience
    (member login, guest, the MCP resource) therefore cannot pass, and no second
    row for the same issuer is needed (which would make the cookie session
    resolution ambiguous).
    """
    try:
        claims_unverified: dict[str, object] = jwt.decode(
            token,
            options={"verify_signature": False},
            algorithms=list(_jwt_algorithms()),
        )
    except jwt.PyJWTError:
        raise JwtIdentityError(status_code=401, code="invalid_token") from None
    issuer = claims_unverified.get("iss")
    if not isinstance(issuer, str) or not issuer:
        raise JwtIdentityError(status_code=401, code="invalid_token")

    providers = (
        db.query(IdentityProviderRow)
        .filter(
            IdentityProviderRow.issuer == issuer,
            IdentityProviderRow.lifecycle_state == "active",
            IdentityProviderRow.protocol.in_({"oidc"}),
        )
        .all()
    )
    if not providers:
        raise JwtIdentityError(status_code=401, code="unknown_provider")
    if len(providers) != 1:
        # An ambiguous issuer is a deployment-configuration error, not a per-request decision.
        raise JwtIdentityError(status_code=503, code="configuration_error")
    provider = providers[0]

    verified = _verify_jwt(
        token,
        _jwks_keys_for_provider(jwks_store=jwks_store, provider=provider),
        issuer,
        audience,
    )
    subject = verified.get("sub")
    if not isinstance(subject, str) or not subject:
        raise JwtIdentityError(status_code=401, code="invalid_token")
    return VerifiedOidcToken(provider=provider, claims=verified, subject=subject)


def _resolve_subject_to_user_id(db: Session, provider_id: str, subject: str) -> str | None:
    """Map (identity_provider_id, subject) → user_id via user_identities."""
    from sui_sensemaking_api.models import UserIdentityRow

    row = (
        db.query(UserIdentityRow)
        .filter(
            UserIdentityRow.identity_provider_id == provider_id,
            UserIdentityRow.subject == subject,
        )
        .one_or_none()
    )
    return row.user_id if row is not None else None


def _resolve_tenant_claim(
    *,
    db: Session,
    verified_claims: dict[str, object],
    provider: IdentityProviderRow,
    subject: str,
) -> VerifiedTenantClaim:
    """ADR-0063 D8: extract the external tenant ref from verified JWT claims
    and map it to a sui-sensemaking tenant_id via tenant_identity_providers.

    A missing or unmapped tenant claim is denied (401) — the token carries
    insufficient evidence to establish tenant context.
    """
    tenant_claim_name = settings.tenant_claim_name
    external_tenant_ref = verified_claims.get(tenant_claim_name)
    if not isinstance(external_tenant_ref, str) or not external_tenant_ref:
        logger.info(
            "auth edge: missing tenant claim provider=%s",
            provider.id,
        )
        raise JwtIdentityError(status_code=401, code="missing_tenant_claim")

    tenant_provider = (
        db.query(TenantIdentityProviderRow)
        .filter(
            TenantIdentityProviderRow.identity_provider_id == provider.id,
            TenantIdentityProviderRow.external_tenant_ref == external_tenant_ref,
            TenantIdentityProviderRow.lifecycle_state == "active",
        )
        .one_or_none()
    )
    if tenant_provider is None:
        logger.info(
            "auth edge: unknown tenant provider=%s",
            provider.id,
        )
        raise JwtIdentityError(status_code=401, code="unknown_tenant")

    return VerifiedTenantClaim(
        tenant_id=tenant_provider.tenant_id,
        identity_provider_id=provider.id,
        issuer=provider.issuer,
        audience=provider.audience,
        subject=subject,
    )


def resolve_tenant_from_verified_token(
    *, db: Session, verified: VerifiedOidcToken
) -> VerifiedTenantClaim:
    """Map a verified token's tenant claim to a tenant through ``tenant_identity_providers``.

    The claim is a request, not an authority (ADR-0063 D8): it only counts when the
    server-side mapping for this provider names a tenant. ADR-0094 uses this so an
    agent binding is honoured only for the tenant the IdP itself attests.
    """
    return _resolve_tenant_claim(
        db=db,
        verified_claims=verified.claims,
        provider=verified.provider,
        subject=verified.subject,
    )


class JwtSaasIdentityContextResolver:
    """ADR-0063 D9-3: concrete identity resolver for saas-multitenant.

    Verifies a JWT bearer token against the configured identity provider's JWKS,
    resolves the token subject to a sui-sensemaking user, and returns a ResolvedIdentity.
    """

    def __init__(
        self,
        *,
        jwks_store: JwksStore,
        auth_session_store: DatabaseSaasAuthSessionStore | None = None,
        auth_session_hash_key: bytes | None = None,
    ):
        self._jwks = jwks_store
        self._auth_session_store = auth_session_store
        self._auth_session_hash_key = auth_session_hash_key

    def resolve(self, *, db: Session, request: Request) -> ResolvedIdentity:
        """Verify the bearer token and resolve to a sui-sensemaking identity.

        Raises JwtIdentityError (→ 401) when the token is missing, invalid, or
        the subject is not provisioned.
        """
        token = _extract_bearer_token(request)
        if token is None:
            return self._resolve_from_auth_session_cookie(db=db, request=request)

        # Peek at issuer / audience without trusting the signature yet.
        try:
            claims_unverified: dict[str, object] = jwt.decode(
                token,
                options={"verify_signature": False},
                algorithms=list(_jwt_algorithms()),
            )
        except jwt.PyJWTError:
            raise JwtIdentityError(status_code=401, code="invalid_token") from None

        issuer = claims_unverified.get("iss")
        audience_raw = claims_unverified.get("aud")
        if not isinstance(issuer, str):
            raise JwtIdentityError(status_code=401, code="invalid_token")

        # OIDC compliance: aud may be a string or list of strings.
        aud_values = _normalize_audience(audience_raw)
        if not aud_values:
            raise JwtIdentityError(status_code=401, code="invalid_token")

        # Try each audience value against known providers.
        provider = None
        matched_audience = ""
        for aud in aud_values:
            provider = _resolve_identity_provider(db, issuer, aud)
            if provider is not None:
                matched_audience = aud
                break
        if provider is None:
            logger.info(
                "auth edge: unknown provider issuer=%s", issuer,
            )
            raise JwtIdentityError(status_code=401, code="unknown_provider")

        # Fetch JWKS and verify with signature.
        keys = self._fetch_jwks_keys(provider)

        verified = _verify_jwt(token, keys, issuer, matched_audience)

        subject = verified.get("sub")
        if not isinstance(subject, str):
            raise JwtIdentityError(status_code=401, code="invalid_token")

        user_id = _resolve_subject_to_user_id(db, provider.id, subject)
        if user_id is None:
            logger.info(
                "auth edge: identity not provisioned provider=%s",
                provider.id,
            )
            raise JwtIdentityError(status_code=403, code="identity_not_provisioned")

        logger.debug(
            "auth edge: JWT verified provider=%s",
            provider.id,
        )

        # ADR-0063 D7/D8: resolve tenant claim from verified JWT.
        verified_tenant_claim = _resolve_tenant_claim(
            db=db,
            verified_claims=verified,
            provider=provider,
            subject=subject,
        )

        return ResolvedIdentity(
            user_id=user_id,
            reviewer_ref=user_id,
            owner_ref=user_id,
            auth_context=AuthContext(
                actor_ref=user_id,
                user_id=user_id,
                provider=provider.id,
                external_uid=subject,
            ),
            verified_tenant_claim=verified_tenant_claim,
        )

    def _resolve_from_auth_session_cookie(self, *, db: Session, request: Request) -> ResolvedIdentity:
        """AC-1 cookie-fallback branch (ADR-0074 decisions 2/3): no bearer token
        present, try the BFF-issued Sui-Sensemaking-Auth-Session cookie instead.

        The resolved row is re-verified against ClaimBasedTenantContextResolver
        by the caller via the same VerifiedTenantClaim the bearer path builds --
        active_tenant_id here is never itself an authorization decision.
        """
        if self._auth_session_store is None or self._auth_session_hash_key is None:
            logger.info("auth edge: missing bearer token")
            raise JwtIdentityError(status_code=401, code="missing_token")

        raw_session_id = request.cookies.get(_AUTH_SESSION_COOKIE)
        if not raw_session_id:
            logger.info("auth edge: missing bearer token")
            raise JwtIdentityError(status_code=401, code="missing_token")
        if len(raw_session_id) > _MAX_AUTH_SESSION_COOKIE_LENGTH:
            # SAAS-TENANT-SESSION-BINDING-01 AC-6: an oversized presented value
            # fails closed before it is hashed or looked up. A real cookie is
            # secrets.token_urlsafe(32) (~43 chars); this bound is generous
            # headroom, not a tight format check.
            logger.info("auth edge: oversized auth session cookie")
            raise JwtIdentityError(status_code=401, code="session_invalid")

        session_key_hash = derive_session_key_hash(raw_session_id, key=self._auth_session_hash_key)
        resolved_session = self._auth_session_store.resolve_auth_session(session_key_hash=session_key_hash)
        if resolved_session is None:
            logger.info("auth edge: auth-session cookie invalid or expired")
            raise JwtIdentityError(status_code=401, code="session_invalid")
        if resolved_session.active_tenant_id is None:
            # The row's tenant FK was SET NULL (models.py) -- the tenant bound
            # at login no longer exists/is no longer active. Fail closed rather
            # than resolve a claim with no tenant to bind to.
            logger.info("auth edge: auth-session has no active tenant")
            raise JwtIdentityError(status_code=401, code="session_invalid")

        provider = _resolve_identity_provider_by_issuer(db, resolved_session.issuer)

        verified_tenant_claim = VerifiedTenantClaim(
            tenant_id=resolved_session.active_tenant_id,
            identity_provider_id=provider.id,
            issuer=provider.issuer,
            audience=provider.audience,
            subject=resolved_session.subject,
        )

        return ResolvedIdentity(
            user_id=resolved_session.principal_id,
            reviewer_ref=resolved_session.principal_id,
            owner_ref=resolved_session.principal_id,
            auth_context=AuthContext(
                actor_ref=resolved_session.principal_id,
                user_id=resolved_session.principal_id,
                provider=provider.id,
                external_uid=resolved_session.subject,
            ),
            verified_tenant_claim=verified_tenant_claim,
            auth_session_key_hash=session_key_hash,
        )

    def _fetch_jwks_keys(self, provider: IdentityProviderRow) -> list[dict[str, object]]:
        """Return cached or freshly fetched JWKS keys for the provider."""
        if not self._jwks.needs_refresh(provider.id):
            cached = self._jwks.get(provider.id)
            if cached is not None:
                return cached

        # Cooldown guard: if we failed recently and cooldown hasn't elapsed, reuse stale.
        if not self._jwks.can_force_refresh(provider.id):
            stale = self._jwks.get(provider.id)
            if stale is not None:
                return stale
            raise JwtIdentityError(status_code=503, code="jwks_unavailable")

        try:
            keys = _fetch_jwks(provider.jwks_uri)
            self._jwks.set(provider.id, keys)
            return keys
        except OSError:
            self._jwks.set_fresh_failure(provider.id)
            stale = self._jwks.get(provider.id)
            if stale is not None:
                return stale
            raise JwtIdentityError(status_code=503, code="jwks_unavailable") from None


def _fetch_jwks(jwks_uri: str | None) -> list[dict[str, object]]:
    """Fetch and parse a JWKS endpoint.

    ADR-0063 D4: follows the trusted-HTTP convention — no redirects,
    bounded response size, HTTPS required (except loopback), no
    credentials/query/fragment in URL.
    """
    import json
    from urllib.parse import urlparse

    import httpx

    if not jwks_uri:
        raise JwtIdentityError(status_code=503, code="jwks_unavailable")

    # Fetch-time URL validation (defense-in-depth beyond write-time check).
    parsed = urlparse(jwks_uri)
    if parsed.scheme not in ("http", "https"):
        raise JwtIdentityError(status_code=503, code="jwks_unavailable")
    if parsed.scheme == "http" and parsed.hostname not in {
        "localhost", "127.0.0.1", "::1",
    }:
        raise JwtIdentityError(status_code=503, code="jwks_unavailable")

    try:
        response = httpx.get(
            jwks_uri,
            timeout=10.0,
            follow_redirects=False,
        )
        response.raise_for_status()
        # Bound response size to prevent DoS/amplification.
        if len(response.content) > _JWKS_MAX_RESPONSE_BYTES:
            raise JwtIdentityError(status_code=503, code="jwks_unavailable")
        data = json.loads(response.text)
    except (httpx.HTTPError, json.JSONDecodeError, OSError):
        raise JwtIdentityError(status_code=503, code="jwks_unavailable") from None

    if not isinstance(data, dict) or not isinstance(data.get("keys"), list):
        raise JwtIdentityError(status_code=503, code="jwks_unavailable")

    keys: list[dict[str, object]] = data["keys"]
    if not keys:
        raise JwtIdentityError(status_code=503, code="jwks_unavailable")
    return keys
