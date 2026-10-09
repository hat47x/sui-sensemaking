import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from secrets import compare_digest
from uuid import uuid4

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text

from sui_sensemaking_api.access_control import build_access_control_adapter
from sui_sensemaking_api.admin_audit_repository import record_admin_audit_event
from sui_sensemaking_api.control_plane_auth import control_plane_subject
from sui_sensemaking_api.model_registry_seed import seed_registry_from_env
from sui_sensemaking_api.audit import build_audit_dispatcher
from sui_sensemaking_api.db import SessionLocal, init_db
from sui_sensemaking_api.database_content_store import DocumentRevisionDivergence
from sui_sensemaking_api.database_support import database_support_for_url
from sui_sensemaking_api.document_policy_binding import build_document_policy_binding_resolver
from sui_sensemaking_api.guest_auth_state import DatabaseGuestAuthSessionStore
from sui_sensemaking_api.guest_identity_verifier import DatabaseJwtGuestIdentityVerifier
from sui_sensemaking_api.guest_redeem import DatabaseGuestRedeemStateStore
from sui_sensemaking_api.generation_repository import (
    GenerationBlobConflict,
    GenerationBlobUnavailable,
    RevisionHeadConflict,
)
from sui_sensemaking_api.routes.ai import router as ai_router
from sui_sensemaking_api.routes.ai_relations import router as ai_relations_router
from sui_sensemaking_api.routes.admin import router as admin_router
from sui_sensemaking_api.routes.docs import router as docs_router
from sui_sensemaking_api.routes.context import router as context_router
from sui_sensemaking_api.routes.agent_credential_admin import router as agent_credential_admin_router
from sui_sensemaking_api.routes.document_access_admin import (
    router as document_access_admin_router,
)
from sui_sensemaking_api.routes.inquiry_bundles import router as inquiry_bundles_router
from sui_sensemaking_api.routes.guest_session import router as guest_session_router
from sui_sensemaking_api.routes.model_registry import router as model_registry_router
from sui_sensemaking_api.routes.session import router as session_router
from sui_sensemaking_api.observability import (
    INBOUND_TRACE_HEADER,
    REQUEST_ID_HEADER,
    actor_ref_hash_var,
    compute_actor_ref_hash,
    configure_logging,
    new_request_id,
    request_id_var,
    resolve_inbound_request_id,
)
from sui_sensemaking_api.request_body_safety import JsonRequestBodySafetyMiddleware
from sui_sensemaking_api.session_csrf import BffCsrfProtectionMiddleware
from sui_sensemaking_api.settings import settings
from sui_sensemaking_api.oauth_broker_client import ExternalOauthBrokerConfig
from sui_sensemaking_api.saas_auth_state import DatabaseSaasAuthSessionStore, DatabaseSaasAuthStateStore
from sui_sensemaking_api.tenant_capability import build_tenant_capability_resolver
from sui_sensemaking_api.trusted_saas_runtime import (
    TrustedSaasRuntimeComponents,
    TrustedSaasRuntimePolicy,
    initialize_trusted_saas_runtime,
    release_trusted_saas_runtime,
    validate_saas_providers_exist,
    validate_trusted_saas_runtime_preflight,
)


configure_logging(
    level=settings.log_level,
    json_format=settings.log_json,
    app_revision=settings.app_revision,
)

logger = logging.getLogger(__name__)


def _migration_script_heads() -> tuple[str, ...]:
    backend_dir = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    script = ScriptDirectory.from_config(cfg)
    return tuple(script.get_heads())


def _assert_linear_migration_history() -> None:
    heads = _migration_script_heads()
    if len(heads) != 1:
        raise RuntimeError(f"Migration conflict detected; expected single head but got {heads}")


def _trusted_saas_runtime_policy() -> TrustedSaasRuntimePolicy:
    return TrustedSaasRuntimePolicy(
        database_backend=database_support_for_url(settings.database_url).backend,
        allow_jit_provisioning=settings.allow_jit_provisioning,
        access_control_adapter=settings.access_control_adapter,
        access_control_fail_safe_mode=settings.access_control_fail_safe_mode,
        document_policy_binding_resolver=settings.document_policy_binding_resolver,
        tenant_capability_resolver=settings.tenant_capability_resolver,
        # ADR-0063 D9-6: auth-edge settings
        jwt_algorithms=settings.jwt_algorithms,
        tenant_claim_name=settings.tenant_claim_name,
        # SAAS-TENANT-SESSION-BINDING-01 AC-1 (ADR-0074): BFF OAuth broker settings
        saas_oauth_broker_http_authorize_endpoint=settings.saas_oauth_broker_http_authorize_endpoint,
        saas_oauth_broker_http_token_endpoint=settings.saas_oauth_broker_http_token_endpoint,
        saas_oauth_broker_http_redirect_uri=settings.saas_oauth_broker_http_redirect_uri,
        saas_oauth_broker_http_client_id=settings.saas_oauth_broker_http_client_id,
        saas_oauth_broker_http_client_secret=settings.saas_oauth_broker_http_client_secret,
        saas_oauth_broker_http_timeout_seconds=settings.saas_oauth_broker_http_timeout_seconds,
        saas_auth_session_hash_key=settings.saas_auth_session_hash_key,
    )


def _saas_oauth_broker_config() -> ExternalOauthBrokerConfig | None:
    """None when any required field is unset -- handle_callback (oauth_bff.py)
    fails closed with 503 rather than construct a config with missing fields."""
    token_endpoint = settings.saas_oauth_broker_http_token_endpoint
    redirect_uri = settings.saas_oauth_broker_http_redirect_uri
    client_id = settings.saas_oauth_broker_http_client_id
    client_secret = settings.saas_oauth_broker_http_client_secret
    if token_endpoint is None or redirect_uri is None or client_id is None or client_secret is None:
        return None
    return ExternalOauthBrokerConfig(
        token_endpoint=token_endpoint,
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        timeout_seconds=settings.saas_oauth_broker_http_timeout_seconds,
    )


def _saas_auth_session_hash_key_bytes() -> bytes | None:
    raw = settings.saas_auth_session_hash_key
    return bytes.fromhex(raw) if raw else None


def _trusted_saas_runtime_components() -> TrustedSaasRuntimeComponents:
    return TrustedSaasRuntimeComponents(
        access_control_adapter=build_access_control_adapter(
            adapter_name=settings.access_control_adapter
        ),
        tenant_capability_resolver=build_tenant_capability_resolver(),
        document_policy_binding_resolver=build_document_policy_binding_resolver(),
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _assert_linear_migration_history()
    runtime_policy = _trusted_saas_runtime_policy()
    runtime_components = _trusted_saas_runtime_components()
    validate_trusted_saas_runtime_preflight(
        app,
        runtime_profile=settings.runtime_profile,
        runtime_policy=runtime_policy,
        runtime_components=runtime_components,
    )
    init_db()
    # AI-MODEL-GOVERNANCE-01 U4: seed the env-configured provider/model into the
    # registry so an admin CLI/UI can see and manage what env vars configured.
    seed_registry_from_env()
    if settings.runtime_profile == "saas-multitenant":
        _saas_auth_state_store.preflight()
        _saas_auth_session_store.preflight()
        _guest_auth_session_store.preflight()
        _guest_redeem_state_store.preflight()
    # ADR-0063 D9-6: post-DB-init check for active identity providers.
    if settings.runtime_profile == "saas-multitenant":
        validate_saas_providers_exist()
    app.state.runtime_profile = settings.runtime_profile
    app.state.audit_dispatcher = build_audit_dispatcher()
    app.state.access_control_adapter = runtime_components.access_control_adapter
    app.state.access_control_fail_safe_mode = settings.access_control_fail_safe_mode
    app.state.tenant_capability_resolver = runtime_components.tenant_capability_resolver
    initialize_trusted_saas_runtime(
        app,
        runtime_profile=app.state.runtime_profile,
        runtime_policy=runtime_policy,
        runtime_components=runtime_components,
    )
    try:
        yield
    finally:
        release_trusted_saas_runtime(app)


# SEC-HEADERS-01 (option a): the FastAPI interactive docs and the OpenAPI
# schema are a recon surface (every route + payload shape) with no API-key
# protection in the default compose deploy. Keep them for dev/evaluation
# convenience but disable them on production profiles (enterprise-production,
# saas-multitenant) so the surface is not reachable there.
# /docs is owned by the documents API (GET /docs list + /docs/{id}); the
# interactive API UI is served at /api-docs so the two never collide.
_docs_enabled = settings.runtime_profile in {"local-dev", "evaluation"}
app = FastAPI(
    title="sui-sensemaking API",
    lifespan=lifespan,
    docs_url="/api-docs" if _docs_enabled else None,
    redoc_url="/api-redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

_saas_auth_state_store = DatabaseSaasAuthStateStore(SessionLocal)
_saas_auth_session_store = DatabaseSaasAuthSessionStore(SessionLocal)
_guest_auth_session_store = DatabaseGuestAuthSessionStore(SessionLocal)
_guest_redeem_state_store = DatabaseGuestRedeemStateStore(SessionLocal)

# ADR-0063 D9-6: install the trusted SaaS runtime adapter bundle at module
# scope so that initialize_trusted_saas_runtime() can find it during lifespan.
# The bundle is only installed for saas-multitenant; other profiles are unaffected.
if settings.runtime_profile == "saas-multitenant":
    from sui_sensemaking_api.active_tenant_session import (
        DatabaseActiveTenantSessionPersister,
        tenant_session_cookie_is_secure,
    )
    from sui_sensemaking_api.jwks_store import JwksStore
    from sui_sensemaking_api.tenant_context import ClaimBasedTenantContextResolver
    from sui_sensemaking_api.trusted_auth_edge import JwtSaasIdentityContextResolver
    from sui_sensemaking_api.trusted_saas_runtime import (
        TrustedSaasRuntimeAdapters,
        install_trusted_saas_runtime,
    )

    # SAAS-TENANT-SESSION-BINDING-01 AC-1 (ADR-0074): oauth_bff.py's
    # handle_callback and the resolver's cookie-fallback branch must agree on
    # this key -- computed once and shared (ADR-0074 decision 2: keyed hash).
    _saas_auth_session_hash_key = _saas_auth_session_hash_key_bytes()
    app.state.saas_oauth_broker_config = _saas_oauth_broker_config()
    app.state.saas_auth_session_store = _saas_auth_session_store
    app.state.saas_auth_state_store = _saas_auth_state_store
    app.state.saas_auth_session_hash_key = _saas_auth_session_hash_key
    app.state.guest_auth_session_store = _guest_auth_session_store
    app.state.guest_auth_session_hash_key = _saas_auth_session_hash_key
    # ADR-0093: agent資格情報のハッシュは領域分離して同じ鍵を共有する。
    app.state.agent_credential_hash_key = _saas_auth_session_hash_key
    app.state.guest_redeem_state_store = _guest_redeem_state_store
    # Domain separation in guest_redeem.py makes key reuse cryptographically distinct.
    app.state.guest_redeem_state_hash_key = _saas_auth_session_hash_key
    # R2c shares only the hardened provider/JWKS cache with member auth.  Guest
    # verification stops before user provisioning, tenant IdP trust and membership.
    _shared_jwks_store = JwksStore()
    # ADR-0094: agent の交換後トークンも、同じ堅牢化済みのJWKS基盤で検証する。
    app.state.agent_jwks_store = _shared_jwks_store
    app.state.guest_identity_verifier = DatabaseJwtGuestIdentityVerifier(
        session_factory=SessionLocal,
        jwks_store=_shared_jwks_store,
    )

    install_trusted_saas_runtime(
        app,
        TrustedSaasRuntimeAdapters(
            identity_context_resolver=JwtSaasIdentityContextResolver(
                jwks_store=_shared_jwks_store,
                auth_session_store=_saas_auth_session_store,
                auth_session_hash_key=_saas_auth_session_hash_key,
            ),
            tenant_context_resolver=ClaimBasedTenantContextResolver(),
            active_tenant_session_persister=DatabaseActiveTenantSessionPersister(
                store=_saas_auth_state_store,
                secure_cookie=tenant_session_cookie_is_secure(
                    settings.runtime_profile,
                ),
            ),
        ),
    )

app.add_middleware(JsonRequestBodySafetyMiddleware)
app.add_middleware(BffCsrfProtectionMiddleware)


#: Unauthenticated operational endpoints. A probe must work before credentials
#: are configured, and none of these expose tenant data: /healthz is a constant,
#: /readyz reports dependency state plus Alembic revision ids, /version reports
#: the build revision and the bootstrap-mode-equivalent profile name.
_UNAUTHENTICATED_PATHS = frozenset({"/healthz", "/readyz", "/version"})


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    # SEC-ADMIN-PLANE-02 (D-a): the /admin/* control plane is authorized solely
    # by require_control_plane_authorization (X-Admin-Api-Key or a provision
    # capability), never by the business-plane X-API-Key. Skipping /admin/*
    # here is what makes "admin key alone" work when BOTH keys are configured —
    # otherwise the business-key middleware re-couples the control plane to the
    # business plane, the exact separation ADR-0072 established. Every
    # /admin/provision/* route must carry the control-plane dependency.
    # /healthz /readyz /version are liveness/readiness/version probes used by
    # orchestration, so they are unauthenticated (OPS-OBSERV-01).
    if request.url.path in _UNAUTHENTICATED_PATHS or request.url.path.startswith("/admin/"):
        return await call_next(request)

    if settings.api_key:
        provided_key = request.headers.get("x-api-key")
        normalized_key = provided_key.strip() if provided_key is not None else None
        if not normalized_key or not compare_digest(normalized_key, settings.api_key):
            return JSONResponse(status_code=401, content=_error_body("Unauthorized"))

    return await call_next(request)


@app.middleware("http")
async def record_admin_plane_audit(request: Request, call_next):
    # SEC-ADMIN-PLANE-03: record /admin/* operations (allowed AND denied) to
    # the local control-plane audit trail. Registered after add_request_id, so
    # request_id_var is set. Fail-open by contract: a recording failure (DB
    # down, etc.) must never block the operation. Actor identity is the
    # control-plane credential fingerprint -- the static bootstrap credential
    # cannot resolve to a person (D1).
    if not request.url.path.startswith("/admin/"):
        return await call_next(request)
    # Do not record the audit trail's own read endpoint: it would self-pollute
    # the trail with a read event per page (noise, and it mixes into cursors
    # when recorded in the same instant as the writes being paged).
    if request.url.path == "/admin/provision/audit":
        return await call_next(request)

    response = await call_next(request)
    subject = control_plane_subject(request)
    admin_key = request.headers.get("x-admin-api-key")
    actor_source = subject.principal_id if subject is not None else admin_key
    # OPS-OBSERV-01: same computation the general log stream now uses
    # (observability.bind_actor_ref_hash), kept as one shared helper so this
    # table's actorRefHash and a log line's actorRefHash for the same actor
    # can never silently diverge.
    actor_ref_hash = compute_actor_ref_hash(actor_source)
    path = request.url.path
    # Tests override app.state.admin_audit_session_factory with their SQLite
    # sessionmaker so the trail is assertable; production uses the app engine.
    session_factory = getattr(request.app.state, "admin_audit_session_factory", SessionLocal)
    try:
        db = session_factory()
        try:
            record_admin_audit_event(
                db,
                event_id=uuid4().hex,
                route=path,
                operation=path.rsplit("/", 1)[-1] or None,
                target=None,
                result="allowed" if response.status_code < 400 else "denied",
                status_code=response.status_code,
                request_id=request_id_var.get(),
                actor_ref_hash=actor_ref_hash,
                tenant_id=subject.tenant_id if subject is not None else None,
                occurred_at=datetime.now(timezone.utc).isoformat(),
            )
            db.commit()
        finally:
            db.close()
    except Exception:  # fail-open: audit must never block admin operations
        logging.getLogger(__name__).warning(
            "admin audit recording failed; keep fail-open",
            extra={"route": path, "status": response.status_code},
        )
    return response


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


@app.middleware("http")
async def assign_request_id(request: Request, call_next):
    """OPS-OBSERV-01: mint a correlation id for every request.

    Registered last so it runs first (Starlette applies middleware in reverse
    registration order), which means rejections from the body-safety and API-key
    middlewares are correlated too -- those are exactly the failures an operator
    gets asked about.

    An inbound `x-trace-id` is honoured when it is a safe opaque token so that a
    caller-side id survives into our logs; otherwise a server id is minted. The
    id is echoed in the response header and, for the error handlers below, in the
    body: without it the user has nothing to quote and the operator has nothing
    to grep.

    Also resets `actor_ref_hash_var` to `None` for every request, outermost, for
    the same reason a fresh request id is minted here rather than left over from
    whatever ran before: a persistent-context caller (the sync TestClient's
    background loop; conceivably a keep-alive worker) must not let one request's
    resolved actor bleed into the next request's log lines. Whichever
    identity-resolution path fires later in this request (single-tenant header,
    SaaS trusted session, control-plane subject) calls
    `observability.bind_actor_ref_hash` to overwrite this; a request where none
    of them fire stays anonymous.
    """
    inbound = resolve_inbound_request_id(request.headers.get(INBOUND_TRACE_HEADER))
    request_id = inbound or new_request_id()
    token = request_id_var.set(request_id)
    actor_token = actor_ref_hash_var.set(None)
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
        actor_ref_hash_var.reset(actor_token)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response


def _error_body(detail: object) -> dict[str, object]:
    """Attach the correlation id to an error body.

    OPS-OBSERV-01: the user's screen showed only a status and a message, so a
    report could not be joined to a log line. The id is server-minted and opaque,
    carries no user content, and is already in the X-Request-Id response header --
    putting it in the body is what makes it quotable.
    """
    body: dict[str, object] = {"detail": detail}
    request_id = request_id_var.get()
    if request_id:
        body["requestId"] = request_id
    return body


@app.exception_handler(RequestValidationError)
def handle_validation_error(_, exc: RequestValidationError) -> JSONResponse:
    # SEC-VALIDATION-LEAK-01: pydantic v2's error dict includes the rejected raw
    # value under `input` (PII leak) and a non-serializable exception under `ctx`
    # (would break the response). Return only the safe serializable fields —
    # type/loc/msg — matching the routes/docs.py A1ErrorResponse pattern.
    errors = [
        {key: error[key] for key in ("type", "loc", "msg") if key in error}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content=_error_body(errors))


@app.exception_handler(RevisionHeadConflict)
def handle_revision_head_conflict(_, _exc: RevisionHeadConflict) -> JSONResponse:
    return JSONResponse(status_code=409, content=_error_body("Document changed concurrently"))


@app.exception_handler(DocumentRevisionDivergence)
@app.exception_handler(GenerationBlobUnavailable)
@app.exception_handler(GenerationBlobConflict)
def handle_revision_storage_failure(_, _exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content=_error_body("Document revision storage failed integrity verification"),
    )


@app.exception_handler(Exception)
def handle_unhandled(request: Request, exc: Exception) -> JSONResponse:
    # OPS-OBSERV-01: a catch-all 500 that logs the exception (with the request
    # ID) and returns a generic body tagged with the same ID. The request ID is
    # how an operator joins this response to the structured log line.
    import logging

    logging.getLogger(__name__).exception("unhandled error", exc_info=exc)
    return JSONResponse(
        status_code=500,
        content=_error_body("Internal server error"),
    )


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness only: the process is up and serving.

    OPS-OBSERV-01: this deliberately checks nothing, and that is now documented
    rather than implied. It previously returned a constant while every runbook
    presented it as *the* API health check, so a backend that had lost its
    database still answered `{"status": "ok"}` -- and `docker-compose.yml` gated
    the web container on it. Use `/readyz` for dependency state.
    """
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> JSONResponse:
    """Readiness: the database is reachable and its schema is the expected one.

    The schema comparison closes a second gap. `_assert_linear_migration_history`
    runs at startup but inspects only the Alembic *script* directory -- it never
    reads `alembic_version` from the database -- so an application booted against
    a stale schema started cleanly and failed later at query time.

    Reports `not_ready` rather than raising: a readiness probe must answer with a
    status code, and the reason must not echo connection strings or driver text.
    """
    checks: dict[str, str] = {}

    try:
        expected_heads = set(_migration_script_heads())
    except Exception:
        expected_heads = set()
        checks["migrations"] = "unavailable"

    session = SessionLocal()
    try:
        session.execute(text("SELECT 1"))
        checks["database"] = "ok"

        if expected_heads:
            applied = {
                row[0]
                for row in session.execute(text("SELECT version_num FROM alembic_version"))
            }
            if applied == expected_heads:
                checks["schema"] = "ok"
            else:
                # Neither value is secret -- both are Alembic revision ids -- and
                # an operator cannot decide roll-forward vs restore without them.
                checks["schema"] = "mismatch"
                checks["schemaExpected"] = ",".join(sorted(expected_heads))
                checks["schemaApplied"] = ",".join(sorted(applied)) or "none"
    except Exception:
        logger.warning("readiness check failed", extra={"check": "database"})
        checks["database"] = "unreachable"
    finally:
        session.close()

    ready = checks.get("database") == "ok" and checks.get("schema") == "ok"
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ready" if ready else "not_ready", "checks": checks},
    )


@app.get("/version")
def version() -> dict[str, str]:
    """What is actually deployed.

    OPS-OBSERV-01: there was no way to ask a running instance what it was running
    -- no git tags exist, no build metadata is baked into either image, and the
    support diagnostics bundle reported `revision: "unknown"` because
    `SUI_APP_REVISION` was never wired through the frontend build. An
    operator handling a report could not tell which build produced it.
    """
    return {
        "revision": settings.app_revision or "unknown",
        "runtimeProfile": app.state.runtime_profile
        if hasattr(app.state, "runtime_profile")
        else settings.runtime_profile,
    }


app.include_router(docs_router)
app.include_router(admin_router)
app.include_router(ai_router)
app.include_router(ai_relations_router)
app.include_router(context_router)
app.include_router(document_access_admin_router)
app.include_router(agent_credential_admin_router)
app.include_router(inquiry_bundles_router)
app.include_router(model_registry_router)
app.include_router(session_router)
app.include_router(guest_session_router)
