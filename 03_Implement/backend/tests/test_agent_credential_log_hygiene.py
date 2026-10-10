"""ADR-0093 解除条件8: トークン平文と鍵素材が、ログとエラー応答に現れないこと。

これまで「ヘッダーを出力する箇所がコード上に無い」ことを読んで確かめただけだった。ここでは
実際に要求を流し、次の四つを機械的に固定する。

1. 全loggerのlog record（message、args、extra、例外の文字列、整形後のJSON・文字列）に、
   生の資格情報・交換後のJWT・鍵付きハッシュ・ハッシュ鍵が現れない。
2. 失敗応答の本文とheaderが、提示された資格情報をそのまま返さない。
3. 監査dispatcherへ渡る event と、その送信失敗warningにも現れない。
4. 実サーバー（uvicorn。最も詳しいTRACE levelも含む）のaccess logにも現れない。

対象は、不透明な資格情報（ADR-0093）、交換後のOAuthトークン（ADR-0094）、Tenant Adminの
登録・一覧・失効の三つ。router単体のappと、実際の `main.app`（要求ID等のmiddleware付き）
の両方で確かめる。試験自身が空振りしないよう、検出器の自己確認と、捕捉が効いていることの
確認も置く。

トークンの平文は、登録応答の本文に一度だけ現れてよい。それ以外の場所には現れてはならない。
"""

from __future__ import annotations

import base64
import json
import logging
import threading
import time
import traceback
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
import jwt
import pytest
import uvicorn
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from sui_sensemaking_api.access_control import AccessDecision, AccessRequest, AuthContext
from sui_sensemaking_api.agent_credential_models import AgentCredentialIndexRow, AgentCredentialRow
from sui_sensemaking_api.agent_credentials import (
    AGENT_BEARER_HEADER,
    AGENT_CREDENTIAL_HEADER,
    AGENT_TOKEN_PREFIX,
    AgentCredentialRepository,
    derive_agent_token_hash,
)
from sui_sensemaking_api.audit import AuditDispatcher
from sui_sensemaking_api.auth_context import ResolvedIdentity
from sui_sensemaking_api.db import get_db
from sui_sensemaking_api.jwks_store import JwksStore
from sui_sensemaking_api.main import app as main_app
from sui_sensemaking_api.models import (
    Base,
    DocumentRow,
    IdentityProviderRow,
    TenantIdentityProviderRow,
    TenantMembershipRow,
    TenantRow,
    UserRow,
)
from sui_sensemaking_api.observability import JsonLogFormatter, RequestIdFilter
from sui_sensemaking_api.routes.ai import router as ai_router
from sui_sensemaking_api.routes.docs import router as docs_router
from sui_sensemaking_api.session_context import CapabilitySnapshot
from sui_sensemaking_api.tenant_context import TenantContext, select_active_tenant_context

TIMESTAMP = "2026-10-09T00:00:00+00:00"
HASH_KEY = b"agent-log-hygiene-test-key-0123456789"
ISSUER = "https://idp.invalid/realm"
AGENT_AUDIENCE = "sui-sensemaking-agents"  # backend 宛て
MCP_AUDIENCE = "https://mcp.invalid/mcp"  # MCP 宛て。agent の経路では受け付けない
KID = "log-hygiene-key"
PROVIDER_ID = "idp-agents"
SUBJECT_A = "agent-client-1"
SUBJECT_B = "agent-client-2"
ORG_A = "org-a"
ORG_B = "org-b"
BASE = "/tenant-admin/agent-credentials"
AUDIT_BODY = {
    "operation": "query",
    "safeMode": True,
    "equivalenceKey": "a" * 64,
    "bundleHash": "b" * 64,
    "command": "context-query",
    "channel": "mcp",
}


# --- 検出器 ----------------------------------------------------------------------------


def _opaque_forms(raw: str, *, key: bytes, label: str) -> dict[str, str]:
    """不透明な資格情報と、そこから派生する断片・鍵付きハッシュ。"""
    forms = {label: raw, f"{label}:keyed-hash": derive_agent_token_hash(raw, key=key)}
    if raw.startswith(AGENT_TOKEN_PREFIX):
        forms[f"{label}:body"] = raw[len(AGENT_TOKEN_PREFIX) :]
        forms[f"{label}:head"] = raw[:16]
    return {name: value for name, value in forms.items() if len(value) >= 6}


def _jwt_forms(raw: str, *, label: str) -> dict[str, str]:
    """JWT全体、`Bearer ` 付き、三つの部分。一部分だけの出力も漏えいとみなす。"""
    if not raw.strip():
        return {}
    forms = {label: raw, f"{label}:as-header": f"Bearer {raw}"}
    parts = raw.split(".")
    if len(parts) == 3:
        forms.update(zip((f"{label}:{part}" for part in ("head", "claims", "sig")), parts))
    return {name: value for name, value in forms.items() if len(value) >= 6}


def _key_forms(key: bytes) -> dict[str, str]:
    """ハッシュ鍵が、文字列・hex・repr・base64のどれで出ても検出する。"""
    return {
        "hash-key:text": key.decode("latin-1"),
        "hash-key:hex": key.hex(),
        "hash-key:repr": repr(key),
        "hash-key:b64": base64.b64encode(key).decode(),
        "hash-key:b64url": base64.urlsafe_b64encode(key).decode(),
    }


def _variants(value: str) -> list[str]:
    """文字コードの扱いで形が変わっても検出するため、ASCII以外は別の表現も加える。

    TestClient は ASCII以外の header をUTF-8で送り、サーバーは latin-1 として読む。実際の
    wire では latin-1 のまま届く。どちらの形でログへ出ても、同じ秘密として扱う。
    """
    forms = [value]
    if not value.isascii():
        forms += [
            value.encode("utf-8").decode("latin-1"),
            ascii(value)[1:-1],
            json.dumps(value)[1:-1],
        ]
    return forms


def build_secrets(
    *,
    opaque: tuple[str, ...] = (),
    jwts: tuple[str, ...] = (),
    plain: tuple[str, ...] = (),
    key: bytes = HASH_KEY,
) -> dict[str, str]:
    secrets: dict[str, str] = dict(_key_forms(key))
    for index, raw in enumerate(dict.fromkeys(opaque)):
        for form, variant in enumerate(_variants(raw)):
            label = f"opaque[{index}]" + (f"~enc{form}" if form else "")
            secrets.update(_opaque_forms(variant, key=key, label=label))
    for index, raw in enumerate(dict.fromkeys(jwts)):
        for form, variant in enumerate(_variants(raw)):
            label = f"jwt[{index}]" + (f"~enc{form}" if form else "")
            secrets.update(_jwt_forms(variant, label=label))
    for index, raw in enumerate(dict.fromkeys(plain)):
        for form, variant in enumerate(_variants(raw)):
            secrets[f"plain[{index}]" + (f"~enc{form}" if form else "")] = variant
    return secrets


def without_keyed_hashes(secrets: Mapping[str, str]) -> dict[str, str]:
    return {name: value for name, value in secrets.items() if not name.endswith(":keyed-hash")}


_REQUEST_ID_FILTER = RequestIdFilter()
_TEXT_FORMATTER = logging.Formatter(
    "%(asctime)s %(levelname)s %(name)s [%(requestId)s] [actor=%(actorRefHash)s] "
    "[rev=%(appRevision)s] %(message)s"
)


def record_views(record: logging.LogRecord) -> list[str]:
    """一つのlog recordから、操作者が目にし得る全ての文字列表現を取り出す。"""
    _REQUEST_ID_FILTER.filter(record)
    views = [record.getMessage(), repr(record.msg), repr(record.args)]
    # `extra=` で渡された項目は、ここに全て入る。例外のrepr、traceback objectも含む。
    views.extend(f"{name}={value!r}" for name, value in record.__dict__.items())
    if record.exc_info and record.exc_info[1] is not None:
        views.append("".join(traceback.format_exception(*record.exc_info)))
    if record.stack_info:
        views.append(record.stack_info)
    # アプリが実際に使う二つの整形器の出力。
    views.append(JsonLogFormatter().format(record))
    views.append(_TEXT_FORMATTER.format(record))
    return views


class _Recorder(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.NOTSET)  # uvicorn の TRACE (5) も受け取る
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@dataclass
class Logs:
    """全loggerのlog record。caplogの捕捉に加え、propagateしないloggerにも直接つなぐ。"""

    recorder: _Recorder
    caplog: pytest.LogCaptureFixture

    @property
    def records(self) -> list[logging.LogRecord]:
        known = {id(record) for record in self.recorder.records}
        extra = [record for record in self.caplog.records if id(record) not in known]
        return [*self.recorder.records, *extra]

    def leaks(self, secrets: Mapping[str, str]) -> list[str]:
        """漏えいの場所だけを返す。秘密の値そのものは、失敗の出力にも載せない。"""
        found: list[str] = []
        for record in self.records:
            views = record_views(record)
            for name, value in secrets.items():
                if any(value in view for view in views):
                    found.append(
                        f"{name} leaked via logger={record.name} level={record.levelname} "
                        f"at {record.pathname}:{record.lineno}"
                    )
        return found

    def named(self, prefix: str) -> list[logging.LogRecord]:
        return [record for record in self.records if record.name.startswith(prefix)]


@pytest.fixture
def logs(caplog: pytest.LogCaptureFixture) -> Iterator[Logs]:
    """全loggerをDEBUGで捕捉する。

    pytest の caplog は root へ伝播するloggerしか拾えない。このappは uvicorn の三つの
    loggerを propagate=False で構成するので、そこへも直接つなぐ。SQLAlchemyのloggerだけは
    既定のWARNのままにする（文を出す設定は、専用の試験で別に確かめる）。
    """
    caplog.set_level(logging.DEBUG)
    recorder = _Recorder()
    root = logging.getLogger()
    root.addHandler(recorder)
    previous_disable = logging.root.manager.disable
    logging.disable(logging.NOTSET)
    saved: list[tuple[logging.Logger, int, bool]] = []
    attached: list[logging.Logger] = []
    for name, logger in list(logging.root.manager.loggerDict.items()):
        if not isinstance(logger, logging.Logger) or name.split(".")[0] == "sqlalchemy":
            continue
        saved.append((logger, logger.level, logger.disabled))
        logger.disabled = False
        if logger.level > logging.DEBUG:
            logger.setLevel(logging.DEBUG)
        if not logger.propagate:
            logger.addHandler(recorder)
            attached.append(logger)
    handle = Logs(recorder=recorder, caplog=caplog)
    try:
        # 捕捉が効いていることを、毎回、先に確かめる。
        canaries = ["hygiene.canary", "uvicorn.access", "uvicorn.error"]
        for name in canaries:
            logging.getLogger(name).debug("canary")
        assert {record.name for record in recorder.records} >= set(canaries)
        recorder.records.clear()
        yield handle
    finally:
        root.removeHandler(recorder)
        for logger in attached:
            logger.removeHandler(recorder)
        for logger, level, disabled in saved:
            logger.setLevel(level)
            logger.disabled = disabled
        logging.disable(previous_disable)


def assert_hygiene(
    *,
    logs: Logs,
    capsys: pytest.CaptureFixture[str],
    responses: list[httpx.Response],
    secrets: Mapping[str, str],
    transport: RecordingTransport | None = None,
    allow_in_body: tuple[httpx.Response, ...] = (),
) -> None:
    """ログ・標準出力・応答・監査eventの全てで、秘密が出ていないことを確かめる。"""
    assert logs.leaks(secrets) == []
    assert not [r for r in logs.records if r.levelno >= logging.ERROR or r.exc_info]
    out, err = capsys.readouterr()
    for name, value in secrets.items():
        assert value not in out and value not in err, f"{name} written to stdout/stderr"
    for response in responses:
        if response in allow_in_body:
            continue
        surface = [
            response.text,
            *(f"{key}: {value}" for key, value in response.headers.multi_items()),
        ]
        for name, value in secrets.items():
            assert not any(value in text for text in surface), (
                f"{name} echoed by {response.request.method} {response.request.url.path} "
                f"({response.status_code})"
            )
    if transport is not None:
        for event_json in transport.serialized():
            for name, value in secrets.items():
                assert value not in event_json, f"{name} reached an audit event"


# --- 検出器の自己確認 -------------------------------------------------------------------

_PLANTED = "suiag_PLANTED-" + "q" * 32


def _plant_message(log: logging.Logger) -> None:
    log.info(f"presented {_PLANTED}")


def _plant_lazy_arg(log: logging.Logger) -> None:
    log.info("presented %s", _PLANTED)


def _plant_mapping_arg(log: logging.Logger) -> None:
    log.info("presented %(token)s", {"token": _PLANTED})


def _plant_extra(log: logging.Logger) -> None:
    log.info("presented", extra={"credential": _PLANTED})


def _plant_redacted_key_extra(log: logging.Logger) -> None:
    # 整形器は `token` を伏せるが、他のhandlerは生の値を受け取る。生のrecordで検出する。
    log.info("presented", extra={"token": _PLANTED})


def _plant_exception(log: logging.Logger) -> None:
    try:
        raise ValueError(f"bad credential {_PLANTED}")
    except ValueError:
        log.exception("failed")


def _plant_chained_cause(log: logging.Logger) -> None:
    try:
        try:
            raise KeyError(_PLANTED)
        except KeyError as error:
            raise RuntimeError("lookup failed") from error
    except RuntimeError:
        log.error("failed", exc_info=True)


@pytest.mark.parametrize(
    "plant",
    [
        _plant_message,
        _plant_lazy_arg,
        _plant_mapping_arg,
        _plant_extra,
        _plant_redacted_key_extra,
        _plant_exception,
        _plant_chained_cause,
    ],
)
@pytest.mark.parametrize("logger_name", ["sui_sensemaking_api.hygiene", "uvicorn.access"])
def test_the_detector_finds_a_credential_wherever_a_log_call_could_put_it(
    logs: Logs, plant: Callable[[logging.Logger], None], logger_name: str
) -> None:
    # uvicorn.access は propagate=False。ここへも届くことが、捕捉の前提。
    assert logging.getLogger("uvicorn.access").propagate is False
    plant(logging.getLogger(logger_name))

    leaks = logs.leaks(build_secrets(opaque=(_PLANTED,)))
    assert leaks and all("opaque[0]" in leak for leak in leaks)
    assert _PLANTED not in " ".join(leaks)


def test_the_detector_ignores_ordinary_records_and_the_hash_key_is_caught_in_every_form(
    logs: Logs,
) -> None:
    log = logging.getLogger("sui_sensemaking_api.hygiene")
    log.info("agent credential registered", extra={"tenantId": "tenant-a", "agentId": "agent-1"})
    assert logs.leaks(build_secrets(opaque=(_PLANTED,))) == []

    for form in (HASH_KEY.decode(), HASH_KEY.hex(), repr(HASH_KEY), base64.b64encode(HASH_KEY)):
        log.info("key %s", form)
    leaked = {leak.split(" ")[0] for leak in logs.leaks(build_secrets())}
    assert leaked == set(_key_forms(HASH_KEY))


# --- 試験環境 ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Signing:
    key: rsa.RSAPrivateKey
    other_key: rsa.RSAPrivateKey
    jwk: dict[str, object]


def _jwk(private_key: rsa.RSAPrivateKey) -> dict[str, object]:
    numbers = private_key.public_key().public_numbers()

    def b64(value: int) -> str:
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return {
        "kty": "RSA",
        "kid": KID,
        "use": "sig",
        "alg": "RS256",
        "n": b64(numbers.n),
        "e": b64(numbers.e),
    }


@pytest.fixture(scope="module")
def signing() -> Signing:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return Signing(key=key, other_key=other, jwk=_jwk(key))


def _pem(private_key: rsa.RSAPrivateKey) -> str:
    return private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()


_DROP = object()


def _claims(**overrides: object) -> dict[str, object]:
    now = int(time.time())
    claims: dict[str, object] = {
        "iss": ISSUER,
        "aud": AGENT_AUDIENCE,
        "sub": SUBJECT_A,
        "iat": now - 60,
        "exp": now + 300,
        "jti": str(uuid4()),
        "azp": "mcp-server",
        # IdP が証明する tenant。SUBJECT_B は tenant-b の agent に結ばれている。
        "tenant_ref": ORG_B if overrides.get("sub", SUBJECT_A) == SUBJECT_B else ORG_A,
    }
    claims.update(overrides)
    return {name: value for name, value in claims.items() if value is not _DROP}


def _sign(
    private_key: rsa.RSAPrivateKey,
    claims: dict[str, object],
    *,
    headers: dict[str, object] | None = None,
) -> str:
    return jwt.encode(
        claims, _pem(private_key), algorithm="RS256", headers={"kid": KID, **(headers or {})}
    )


def _encoded(value: dict[str, object]) -> str:
    raw = json.dumps(value).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _document(doc_id: str, title: str) -> str:
    return json.dumps(
        {
            "version": 1,
            "id": doc_id,
            "title": title,
            "createdAt": TIMESTAMP,
            "updatedAt": TIMESTAMP,
            "transform": {"panX": 0, "panY": 0, "zoom": 1},
            "cards": [
                {"id": "c1", "text": "REVIEWED", "x": 0, "y": 0, "textReviewed": True},
                {"id": "c2", "text": "SECRET", "x": 1, "y": 1, "textReviewed": False},
            ],
            "edges": [],
            "islands": [],
        }
    )


class RecordingTransport:
    """監査の送信先。受け取った event を覚え、`fail` のとき送信に失敗する。"""

    name = "recording"

    def __init__(self) -> None:
        self.events: list[object] = []
        self.fail = False

    def send(self, event: object) -> None:
        self.events.append(event)
        if self.fail:
            raise OSError("audit sink unreachable")

    def serialized(self) -> list[str]:
        return [event.model_dump_json() for event in self.events]  # type: ignore[attr-defined]


def _header_value(value: str) -> str | bytes:
    # ASCII以外はlatin-1のbytesで送る。Starlette側は、同じ文字列として読む。
    return value if value.isascii() else value.encode("latin-1")


def _cred(token: str) -> dict[str, str | bytes]:
    return {AGENT_CREDENTIAL_HEADER: _header_value(token)}


def _bearer(token: str) -> dict[str, str | bytes]:
    return {AGENT_BEARER_HEADER: _header_value(f"Bearer {token}")}


@dataclass
class Seed:
    factory: sessionmaker
    opaque_a: str
    opaque_b: str
    dispose: Callable[[], None]


def _seed_agents(tmp_path: Path) -> Seed:
    engine = create_engine(f"sqlite:///{tmp_path}/hygiene.db")
    factory = sessionmaker(bind=engine, class_=Session, expire_on_commit=False)
    Base.metadata.create_all(engine)
    now = datetime.now(timezone.utc)
    expires = (now + timedelta(days=7)).isoformat()
    with factory() as db:
        for tenant_id in ("tenant-a", "tenant-b"):
            db.add(
                TenantRow(
                    id=tenant_id,
                    display_name=tenant_id,
                    lifecycle_state="active",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                )
            )
        db.add(
            IdentityProviderRow(
                id=PROVIDER_ID,
                issuer=ISSUER,
                audience=AGENT_AUDIENCE,
                lifecycle_state="active",
                protocol="oidc",
                jwks_uri="https://idp.invalid/realm/jwks",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            )
        )
        for tenant_id, ref in (("tenant-a", ORG_A), ("tenant-b", ORG_B)):
            db.add(
                TenantIdentityProviderRow(
                    tenant_id=tenant_id,
                    identity_provider_id=PROVIDER_ID,
                    external_tenant_ref=ref,
                    lifecycle_state="active",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                )
            )
        for tenant_id, doc_id in (
            ("tenant-a", "shared-doc"),
            ("tenant-a", "a-ungranted"),
            ("tenant-b", "shared-doc"),
            ("tenant-b", "b-only"),
        ):
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id=doc_id,
                    version=1,
                    updated_at=TIMESTAMP,
                    payload_json=_document(doc_id, f"{tenant_id}-{doc_id}"),
                    created_by="owner",
                    lifecycle_state="active",
                )
            )
        db.commit()
        tokens: dict[str, str] = {}
        for tenant_id, agent_id, subject in (
            ("tenant-a", "agent-a", SUBJECT_A),
            ("tenant-b", "agent-b", SUBJECT_B),
        ):
            repo = AgentCredentialRepository(db, tenant_id=tenant_id)
            tokens[tenant_id] = repo.register(
                agent_id=agent_id,
                label=agent_id,
                created_by="admin",
                expires_at=expires,
                doc_ids=("shared-doc",),
                hash_key=HASH_KEY,
                now=now,
            )
            repo.bind_oauth_principal(
                agent_id=agent_id,
                identity_provider_id=PROVIDER_ID,
                subject=subject,
                created_by="admin",
                now=now,
            )
        db.commit()
    return Seed(factory, tokens["tenant-a"], tokens["tenant-b"], engine.dispose)


_MISSING = object()
_STATE_NAMES = (
    "agent_credential_hash_key",
    "agent_oauth_audience",
    "agent_jwks_store",
    "audit_dispatcher",
    "access_control_adapter",
    "runtime_profile",
)


def _snapshot_state(app: FastAPI, names: tuple[str, ...]) -> dict[str, object]:
    return {name: getattr(app.state, name, _MISSING) for name in names}


def _restore_state(app: FastAPI, snapshot: Mapping[str, object]) -> None:
    for name, value in snapshot.items():
        if value is _MISSING:
            if hasattr(app.state, name):
                delattr(app.state, name)
        else:
            setattr(app.state, name, value)


def _wire_agent_state(app: FastAPI, *, dispatcher: AuditDispatcher | None) -> None:
    app.state.agent_credential_hash_key = HASH_KEY
    app.state.agent_oauth_audience = AGENT_AUDIENCE
    app.state.agent_jwks_store = JwksStore()
    app.state.access_control_adapter = None
    app.state.audit_dispatcher = dispatcher
    app.state.runtime_profile = "local-dev"


def _new_dispatcher(transport: RecordingTransport) -> AuditDispatcher:
    return AuditDispatcher(
        enabled=True,
        allow_in_safe_mode=True,
        transport=transport,
        queue_size=16,
        dedup_window_seconds=0.0,
    )


@dataclass
class Env:
    mode: str
    client: TestClient
    app: FastAPI
    factory: sessionmaker
    signing: Signing
    opaque_a: str
    opaque_b: str
    transport: RecordingTransport

    def make_jwt(self, **overrides: object) -> str:
        return _sign(self.signing.key, _claims(**overrides))

    def secrets(
        self,
        *,
        opaque: tuple[str, ...] = (),
        jwts: tuple[str, ...] = (),
        plain: tuple[str, ...] = (),
    ) -> dict[str, str]:
        return build_secrets(
            opaque=(self.opaque_a, self.opaque_b, *opaque),
            jwts=jwts,
            plain=(SUBJECT_A, SUBJECT_B, *plain),
        )


@pytest.fixture(params=["router", "main"])
def env(request: pytest.FixtureRequest, tmp_path: Path, signing: Signing) -> Iterator[Env]:
    seed = _seed_agents(tmp_path)
    transport = RecordingTransport()

    def _test_db():
        with seed.factory() as db:
            yield db

    snapshot = _snapshot_state(main_app, _STATE_NAMES)
    if request.param == "router":
        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        app.include_router(docs_router)
        app.include_router(ai_router)
    else:
        app = main_app
    app.dependency_overrides[get_db] = _test_db
    try:
        with (
            patch("sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[signing.jwk]),
            TestClient(app) as client,
        ):
            # main の lifespan が既定の値を入れた後で、試験用の値に差し替える。
            _wire_agent_state(app, dispatcher=_new_dispatcher(transport))
            yield Env(
                mode=request.param,
                client=client,
                app=app,
                factory=seed.factory,
                signing=signing,
                opaque_a=seed.opaque_a,
                opaque_b=seed.opaque_b,
                transport=transport,
            )
    finally:
        main_app.dependency_overrides.pop(get_db, None)
        _restore_state(main_app, snapshot)
        seed.dispose()


# --- 不透明な資格情報（ADR-0093）------------------------------------------------------------


def test_successful_opaque_reads_leave_no_credential_in_logs_or_audit(
    env: Env, logs: Logs, capsys: pytest.CaptureFixture[str]
) -> None:
    headers = _cred(env.opaque_a)
    responses = [
        env.client.get("/docs/shared-doc", headers=headers),
        env.client.get("/docs", headers=headers),
        env.client.get("/ai/proposals/status", params={"docId": "shared-doc"}, headers=headers),
        env.client.post("/docs/shared-doc/context-audit", json=AUDIT_BODY, headers=headers),
    ]

    assert [r.status_code for r in responses] == [200, 200, 200, 200]
    assert env.transport.events, "audit events must have been emitted for the reads"
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=responses,
        secrets=env.secrets(),
        transport=env.transport,
    )
    if env.mode == "main":
        # 要求ID等のmiddlewareを通っていること（試験が空振りでないことの確認）。
        assert all(r.headers["x-request-id"] for r in responses)


def _revoke_credential(env: Env) -> None:
    with env.factory() as db:
        AgentCredentialRepository(db, tenant_id="tenant-a").revoke_credential(
            agent_id="agent-a", now=datetime.now(timezone.utc)
        )
        db.commit()


def _expire_credential(env: Env) -> None:
    with env.factory() as db:
        row = db.get(AgentCredentialRow, ("tenant-a", "agent-a"))
        row.expires_at = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        db.commit()


def _bump_credential_version(env: Env) -> None:
    with env.factory() as db:
        index = db.scalars(
            select(AgentCredentialIndexRow).where(AgentCredentialIndexRow.tenant_id == "tenant-a")
        ).one()
        index.credential_version = 2
        db.commit()


def _revoke_grant(env: Env) -> None:
    with env.factory() as db:
        AgentCredentialRepository(db, tenant_id="tenant-a").revoke_document_grant(
            agent_id="agent-a", doc_id="shared-doc", now=datetime.now(timezone.utc)
        )
        db.commit()


@dataclass
class Scenario:
    """失敗する要求。`presented` は提示した値で、応答にもログにも出てはならない。"""

    status: int
    code: str
    presented: tuple[str, ...]
    run: Callable[[Env], list[httpx.Response]]


def _get(env: Env, path: str, headers: Mapping[str, str | bytes]) -> list[httpx.Response]:
    return [env.client.get(path, headers=dict(headers))]


def _junk(value: str) -> Scenario:
    return Scenario(
        401,
        "agent_credential_invalid",
        (value,),
        lambda e: _get(e, "/docs/shared-doc", _cred(value)),
    )


def _after(prepare: Callable[[Env], None], path: str, status: int, code: str) -> Scenario:
    def run(env: Env) -> list[httpx.Response]:
        prepare(env)
        return _get(env, path, _cred(env.opaque_a))

    return Scenario(status, code, (), run)


def _write_attempts(env: Env) -> list[httpx.Response]:
    headers = _cred(env.opaque_a)
    body = json.loads(_document("shared-doc", "changed"))
    return [
        env.client.put("/docs/shared-doc", headers=headers, json=body),
        env.client.post(
            "/docs/shared-doc/export-audit",
            headers=headers,
            json={"safeMode": False, "exportKind": "bundle"},
        ),
        env.client.post("/docs/shared-doc/archive", headers=headers),
        env.client.post("/docs/shared-doc/unarchive", headers=headers),
    ]


def _closed_routes(env: Env) -> list[httpx.Response]:
    headers = _cred(env.opaque_a)
    return [
        env.client.get("/docs/shared-doc/similar-candidate-groups", headers=headers),
        env.client.get("/docs/shared-doc/merge-decision-logs/by-group/g1", headers=headers),
    ]


def _both_headers(env: Env) -> list[httpx.Response]:
    headers = {**_cred(env.opaque_a), **_bearer(env.make_jwt())}
    return [env.client.get("/docs/shared-doc", headers=headers)]


OPAQUE_FAILURES: dict[str, Scenario] = {
    "garbage": _junk("not-an-agent-token"),
    "unknown": _junk("suiag_unknown-token-" + "u" * 24),
    "too-long": _junk("suiag_" + "x" * 300),
    "empty": _junk(""),
    "non-ascii": _junk("suiag_caf\u00e9-\u00ff-" + "z" * 20),
    "revoked": _after(_revoke_credential, "/docs/shared-doc", 401, "agent_credential_invalid"),
    "expired": _after(_expire_credential, "/docs/shared-doc", 401, "agent_credential_invalid"),
    "stale-version": _after(
        _bump_credential_version, "/docs/shared-doc", 401, "agent_credential_invalid"
    ),
    "grant-revoked": _after(_revoke_grant, "/docs/shared-doc", 404, "agent_document_not_granted"),
    "ungranted-doc": _after(lambda e: None, "/docs/a-ungranted", 404, "agent_document_not_granted"),
    "other-tenant-doc": _after(lambda e: None, "/docs/b-only", 404, "agent_document_not_granted"),
    "write-attempts": Scenario(403, "agent_write_not_enabled", (), _write_attempts),
    "closed-routes": Scenario(403, "agent_route_not_enabled", (), _closed_routes),
    "both-headers": Scenario(400, "agent_credential_conflict", (), _both_headers),
}


@pytest.mark.parametrize("name", list(OPAQUE_FAILURES))
def test_failing_opaque_requests_neither_log_nor_echo_the_credential(
    env: Env, logs: Logs, capsys: pytest.CaptureFixture[str], name: str
) -> None:
    scenario = OPAQUE_FAILURES[name]
    responses = scenario.run(env)

    for response in responses:
        assert response.status_code == scenario.status, response.text
        assert response.json()["detail"]["code"] == scenario.code
    jwts = (env.make_jwt(),) if name == "both-headers" else ()
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=responses,
        secrets=env.secrets(opaque=scenario.presented, jwts=jwts),
        transport=env.transport,
    )


# --- 交換後のOAuthトークン（ADR-0094）-----------------------------------------------------


def test_successful_oauth_reads_leave_no_bearer_in_logs_or_audit(
    env: Env, logs: Logs, capsys: pytest.CaptureFixture[str]
) -> None:
    good, other = env.make_jwt(), env.make_jwt(sub=SUBJECT_B)
    mcp_token = env.make_jwt(aud=MCP_AUDIENCE)  # MCP 宛てのトークンが同じ要求に同乗している場合
    # Authorization の MCP 宛てトークンは、agent の経路では読まれない（無視される）。
    decoy = {"Authorization": f"Bearer {mcp_token}"}
    # 利用者の資格情報の系統（X-Sui-Sensemaking-Authorization）と同時に送る要求は、400で閉じる。
    mixed = {**_bearer(good), "X-Sui-Sensemaking-Authorization": mcp_token}
    responses = [
        env.client.get("/docs/shared-doc", headers=_bearer(good)),
        env.client.get("/docs/shared-doc", headers={**_bearer(other), **decoy}),
        env.client.get("/docs", headers=_bearer(good)),
        env.client.get("/docs/a-ungranted", headers=_bearer(good)),
        env.client.get(
            "/ai/proposals/status", params={"docId": "shared-doc"}, headers=_bearer(good)
        ),
        env.client.post("/docs/shared-doc/context-audit", json=AUDIT_BODY, headers=_bearer(good)),
        env.client.get("/docs/shared-doc", headers=mixed),
    ]

    assert [r.status_code for r in responses] == [200, 200, 200, 404, 200, 200, 400]
    assert env.transport.events
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=responses,
        secrets=env.secrets(jwts=(good, other, mcp_token)),
        transport=env.transport,
    )


def _object_kid(signing: Signing) -> str:
    """kid が文字列でない、署名だけは正しいトークン。PyJWTでは作れないので手で組み立てる。"""
    header = _encoded({"alg": "RS256", "typ": "JWT", "kid": {"nested": "object"}})
    signing_input = f"{header}.{_encoded(_claims())}"
    signature = signing.key.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())
    return f"{signing_input}.{base64.urlsafe_b64encode(signature).rstrip(b'=').decode()}"


def _alg_none(_: Signing) -> str:
    return f"{_encoded({'alg': 'none', 'typ': 'JWT', 'kid': KID})}.{_encoded(_claims())}."


def _hs256(_: Signing) -> str:
    return jwt.encode(
        _claims(), "symmetric-secret-0123456789-abcdefghij", algorithm="HS256", headers={"kid": KID}
    )


def _signed(**overrides: object) -> Callable[[Signing], str]:
    return lambda signing: _sign(signing.key, _claims(**overrides))


def _long(signing: Signing) -> str:
    return _sign(signing.key, _claims()) + "A" * 9000


BEARER_FAILURES: dict[str, Callable[[Signing], str]] = {
    "unbound-subject": _signed(sub="unbound-client"),
    "expired": _signed(exp=int(time.time()) - 3600),
    "mcp-audience": _signed(aud=MCP_AUDIENCE),
    "foreign-issuer": _signed(iss="https://other.invalid/realm"),
    "foreign-signature": lambda s: _sign(s.other_key, _claims()),
    "no-subject": _signed(sub=_DROP),
    "numeric-subject": _signed(sub=12345),
    "no-expiry": _signed(exp=_DROP),
    "not-yet-valid": _signed(nbf=int(time.time()) + 3600),
    "audience-list-without-match": _signed(aud=[MCP_AUDIENCE, "https://x.invalid"]),
    "object-kid": _object_kid,
    "alg-none": _alg_none,
    "hs256": _hs256,
    "garbage": lambda s: "not-a-jwt-" + "g" * 24,
    "dots-only": lambda s: "a.b.c",
    "empty": lambda s: "",
    "oversized": _long,
    "non-ascii": lambda s: "caf\u00e9.\u00ff." + "k" * 24,
}


@pytest.mark.parametrize("name", list(BEARER_FAILURES))
def test_failing_oauth_requests_neither_log_nor_echo_the_bearer(
    env: Env, logs: Logs, capsys: pytest.CaptureFixture[str], name: str
) -> None:
    presented = BEARER_FAILURES[name](env.signing)
    responses = [env.client.get("/docs/shared-doc", headers=_bearer(presented))]

    # 原因の違いは区別せず、500にもならない（未処理の例外は、tracebackをログへ出す）。
    assert responses[0].status_code == 401, responses[0].text
    assert responses[0].json()["detail"]["code"] == "agent_credential_invalid"
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=responses,
        secrets=env.secrets(jwts=(presented,)),
        transport=env.transport,
    )


def test_an_unavailable_key_source_is_logged_without_the_bearer(
    env: Env, logs: Logs, capsys: pytest.CaptureFixture[str]
) -> None:
    env.app.state.agent_jwks_store = JwksStore()
    presented = env.make_jwt()
    with patch("sui_sensemaking_api.trusted_auth_edge._fetch_jwks", side_effect=OSError("down")):
        responses = [env.client.get("/docs/shared-doc", headers=_bearer(presented))]

    assert responses[0].status_code == 503
    assert responses[0].json()["detail"]["code"] == "agent_credential_unavailable"
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=responses,
        secrets=env.secrets(jwts=(presented,)),
    )


def test_oauth_revocation_write_attempts_and_a_conflict_do_not_leak_the_bearer(
    env: Env, logs: Logs, capsys: pytest.CaptureFixture[str]
) -> None:
    presented = env.make_jwt()
    headers = _bearer(presented)
    body = json.loads(_document("shared-doc", "changed"))
    responses = [
        env.client.put("/docs/shared-doc", headers=headers, json=body),
        env.client.post("/docs/shared-doc/archive", headers=headers),
        env.client.get("/docs/shared-doc/similar-candidate-groups", headers=headers),
        env.client.get("/docs/shared-doc", headers={**headers, **_cred(env.opaque_a)}),
    ]
    _revoke_credential(env)
    responses.append(env.client.get("/docs/shared-doc", headers=headers))

    assert [r.status_code for r in responses] == [403, 403, 403, 400, 401]
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=responses,
        secrets=env.secrets(jwts=(presented,)),
        transport=env.transport,
    )


# --- 監査dispatcherと、SQL文のlogging ----------------------------------------------------


def test_audit_send_failures_are_logged_without_the_credential(
    env: Env, logs: Logs, capsys: pytest.CaptureFixture[str]
) -> None:
    env.transport.fail = True
    bearer = env.make_jwt()
    responses = [
        env.client.get("/docs/shared-doc", headers=_cred(env.opaque_a)),
        env.client.get("/docs/shared-doc", headers=_bearer(bearer)),
        env.client.post(
            "/docs/shared-doc/context-audit", json=AUDIT_BODY, headers=_cred(env.opaque_a)
        ),
    ]

    # 監査の失敗は本体処理を止めない（fail-open）。警告は実際に出ている。
    assert [r.status_code for r in responses] == [200, 200, 200]
    warnings = [r for r in logs.named("sui_sensemaking_api.audit") if "fail-open" in r.getMessage()]
    assert warnings and all(r.tenantId == "tenant-a" for r in warnings)  # type: ignore[attr-defined]
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=responses,
        secrets=env.secrets(jwts=(bearer,)),
        transport=env.transport,
    )


def test_with_sql_statement_logging_on_the_raw_credentials_never_reach_the_database_layer(
    env: Env, logs: Logs, capsys: pytest.CaptureFixture[str]
) -> None:
    """SQLAlchemyの文のlogging（既定は無効）を有効にしても、生の資格情報はDBへ届かない。

    文のloggingは束縛変数を出すので、検索キーである鍵付きハッシュは出得る。ここで確かめる
    のは、生の資格情報・JWT・ハッシュ鍵がDB層へ渡らないこと。ハッシュは対象にしない。
    """
    sql_logger = logging.getLogger("sqlalchemy.engine")
    previous = sql_logger.level
    sql_logger.setLevel(logging.DEBUG)
    try:
        bearer = env.make_jwt()
        junk = "suiag_junk-" + "j" * 24
        responses = [
            env.client.get("/docs/shared-doc", headers=_cred(env.opaque_a)),
            env.client.get("/docs/shared-doc", headers=_cred(junk)),
            env.client.get("/docs/shared-doc", headers=_bearer(bearer)),
        ]
    finally:
        sql_logger.setLevel(previous)

    assert [r.status_code for r in responses] == [200, 401, 200]
    statements = logs.named("sqlalchemy.engine")
    assert any("agent_credential_index" in record.getMessage() for record in statements)
    raw = without_keyed_hashes(
        build_secrets(opaque=(env.opaque_a, env.opaque_b, junk), jwts=(bearer,))
    )
    assert_hygiene(logs=logs, capsys=capsys, responses=responses, secrets=raw)


# --- 実サーバーのaccess log ----------------------------------------------------------------


@contextmanager
def _live_server(app: FastAPI) -> Iterator[str]:
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        log_config=None,  # 既存のlogging構成を置き換えない
        log_level="trace",  # 最も詳しいlog。要求のscopeを出すが、headerは伏せられる
        lifespan="off",
        access_log=True,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.01)
    assert server.started, "uvicorn did not start"
    port = server.servers[0].sockets[0].getsockname()[1]
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=15)
        logging.getLogger("uvicorn.asgi").setLevel(logging.NOTSET)


def test_the_live_server_access_log_never_contains_request_headers(
    tmp_path: Path, signing: Signing, logs: Logs
) -> None:
    seed = _seed_agents(tmp_path)
    transport = RecordingTransport()

    def _test_db():
        with seed.factory() as db:
            yield db

    snapshot = _snapshot_state(main_app, _STATE_NAMES)
    main_app.dependency_overrides[get_db] = _test_db
    bearer = _sign(signing.key, _claims())
    junk = "suiag_junk-" + "j" * 24
    junk_non_ascii = "suiag_caf\u00e9-\u00ff-" + "n" * 20
    try:
        _wire_agent_state(main_app, dispatcher=_new_dispatcher(transport))
        with (
            patch("sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[signing.jwk]),
            _live_server(main_app) as base_url,
        ):
            # 環境のproxy設定を使わず、loopbackへ直接つなぐ。
            with httpx.Client(base_url=base_url, trust_env=False, timeout=10) as client:
                responses = [
                    client.get("/docs/shared-doc", headers=_cred(seed.opaque_a)),
                    client.get("/docs/shared-doc", headers=_cred(junk)),
                    client.get("/docs/shared-doc", headers=_bearer(bearer)),
                    client.get("/docs/shared-doc", headers={**_bearer(bearer), **_cred(junk)}),
                    client.get("/docs/shared-doc", headers=_cred(junk_non_ascii)),
                ]
            deadline = time.monotonic() + 5
            while (
                len(logs.named("uvicorn.access")) < len(responses) and time.monotonic() < deadline
            ):
                time.sleep(0.02)
    finally:
        main_app.dependency_overrides.pop(get_db, None)
        _restore_state(main_app, snapshot)
        seed.dispose()

    assert [r.status_code for r in responses] == [200, 401, 200, 400, 401]
    access = logs.named("uvicorn.access")
    assert len(access) == len(responses)
    assert all("/docs/shared-doc" in record.getMessage() for record in access)
    assert any(record.levelno < logging.DEBUG for record in logs.records), "no TRACE records"
    assert all(r.headers["x-request-id"] for r in responses)
    secrets = build_secrets(
        opaque=(seed.opaque_a, seed.opaque_b, junk, junk_non_ascii), jwts=(bearer,)
    )
    assert logs.leaks(secrets) == []
    for response in responses:
        for value in secrets.values():
            assert value not in response.text


# --- Tenant Admin（登録・一覧・失効）------------------------------------------------------


@dataclass
class StaticIdentityResolver:
    def resolve(self, *, db: Session, request: Request) -> ResolvedIdentity:  # noqa: ARG002
        return ResolvedIdentity(
            user_id="admin-1",
            reviewer_ref="user:admin-1",
            owner_ref="user:admin-1",
            auth_context=AuthContext(actor_ref="user:admin-1", user_id="admin-1", trace_id=None),
        )


@dataclass
class MutableTenantResolver:
    tenant_id: str = "tenant-a"

    def resolve(self, *, db: Session, user_id: str | None, claim: object = None) -> TenantContext:  # noqa: ARG002
        return select_active_tenant_context(
            db=db, user_id=user_id or "", tenant_id=self.tenant_id, resolved_by="verified_claim"
        )


@dataclass
class MutableCapabilityResolver:
    capabilities: tuple[str, ...] = ("agent.register", "agent.revoke")

    def resolve(
        self, *, db: Session, principal_id: str, tenant: TenantContext
    ) -> CapabilitySnapshot:  # noqa: ARG002
        return CapabilitySnapshot(effective_capabilities=self.capabilities, capability_version="v1")


class _ReadAllowedAdapter:
    """登録者の文書読み取り判定を通す（この試験は、資格情報の記録だけを見る）。"""

    name = "test-read-allowed"

    def authorize(self, request: AccessRequest) -> AccessDecision:  # noqa: ARG002
        return AccessDecision(allow=True)


class StaticTenantSessionPersister:
    def current_version(self, **_: object) -> str:
        return "session-v1"

    def persist(self, **_: object) -> str:
        return "session-v2"


_ADMIN_STATE_NAMES = (
    "saas_identity_context_resolver",
    "tenant_context_resolver",
    "tenant_capability_resolver",
    "active_tenant_session_persister",
    "agent_credential_hash_key",
    "agent_oauth_audience",
    "agent_jwks_store",
    "access_control_adapter",
    "audit_dispatcher",
    "runtime_profile",
)


@dataclass
class AdminEnv:
    client: TestClient
    factory: sessionmaker
    tenants: MutableTenantResolver
    capabilities: MutableCapabilityResolver
    transport: RecordingTransport


def _admin_body(**overrides: object) -> dict[str, object]:
    return {
        "agentId": "agent-1",
        "label": "Claude collaborator",
        "expiresAt": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "docIds": ["shared-doc", "a-second"],
        **overrides,
    }


@pytest.fixture
def admin(tmp_path: Path, signing: Signing) -> Iterator[AdminEnv]:
    engine = create_engine(f"sqlite:///{tmp_path / 'hygiene-admin.sqlite3'}")
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)
    with factory() as db:
        db.add(
            UserRow(
                id="admin-1",
                display_name="Admin",
                email="admin@example.invalid",
                lifecycle_state="active",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            )
        )
        for tenant_id in ("tenant-a", "tenant-b"):
            db.add(
                TenantRow(
                    id=tenant_id,
                    display_name=tenant_id,
                    lifecycle_state="active",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                )
            )
            db.add(
                TenantMembershipRow(
                    tenant_id=tenant_id,
                    user_id="admin-1",
                    lifecycle_state="active",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                )
            )
        db.add(
            IdentityProviderRow(
                id=PROVIDER_ID,
                issuer=ISSUER,
                audience=AGENT_AUDIENCE,
                lifecycle_state="active",
                protocol="oidc",
                jwks_uri="https://idp.invalid/realm/jwks",
                created_at=TIMESTAMP,
                updated_at=TIMESTAMP,
            )
        )
        for tenant_id, ref in (("tenant-a", ORG_A), ("tenant-b", ORG_B)):
            db.add(
                TenantIdentityProviderRow(
                    tenant_id=tenant_id,
                    identity_provider_id=PROVIDER_ID,
                    external_tenant_ref=ref,
                    lifecycle_state="active",
                    created_at=TIMESTAMP,
                    updated_at=TIMESTAMP,
                )
            )
        for tenant_id, doc_id in (
            ("tenant-a", "shared-doc"),
            ("tenant-a", "a-second"),
            ("tenant-b", "shared-doc"),
        ):
            db.add(
                DocumentRow(
                    tenant_id=tenant_id,
                    id=doc_id,
                    version=1,
                    updated_at=TIMESTAMP,
                    payload_json=_document(doc_id, f"{tenant_id}-{doc_id}"),
                    created_by="owner",
                    lifecycle_state="active",
                )
            )
        db.commit()

    def _test_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    transport = RecordingTransport()
    tenants, capabilities = MutableTenantResolver(), MutableCapabilityResolver()
    snapshot = _snapshot_state(main_app, _ADMIN_STATE_NAMES)
    main_app.dependency_overrides[get_db] = _test_db
    try:
        with (
            patch("sui_sensemaking_api.trusted_auth_edge._fetch_jwks", return_value=[signing.jwk]),
            TestClient(main_app) as client,
        ):
            _wire_agent_state(main_app, dispatcher=_new_dispatcher(transport))
            main_app.state.runtime_profile = "saas-multitenant"
            main_app.state.access_control_adapter = _ReadAllowedAdapter()
            main_app.state.saas_identity_context_resolver = StaticIdentityResolver()
            main_app.state.tenant_context_resolver = tenants
            main_app.state.tenant_capability_resolver = capabilities
            main_app.state.active_tenant_session_persister = StaticTenantSessionPersister()
            client.headers["Sui-Sensemaking-Tenant-Session-Version"] = "session-v1"
            yield AdminEnv(client, factory, tenants, capabilities, transport)
    finally:
        main_app.dependency_overrides.pop(get_db, None)
        _restore_state(main_app, snapshot)
        engine.dispose()


def test_admin_register_list_and_revoke_show_the_token_once_and_never_log_it(
    admin: AdminEnv, logs: Logs, capsys: pytest.CaptureFixture[str], signing: Signing
) -> None:
    client = admin.client
    created = client.post(BASE, json=_admin_body())
    token = created.json()["credential"]
    principal = {"identityProviderId": PROVIDER_ID, "subject": SUBJECT_A}
    bearer = _sign(signing.key, _claims())
    responses = [
        client.get(BASE),
        client.get("/docs/shared-doc", headers=_cred(token)),
        client.get("/docs/a-second", headers=_cred(token)),
        client.post(f"{BASE}/agent-1/oauth-bindings", json=principal),
        client.get("/docs/shared-doc", headers=_bearer(bearer)),
        client.get(BASE),
        client.delete(f"{BASE}/agent-1/documents/a-second"),
        client.post(f"{BASE}/agent-1/oauth-bindings/remove", json=principal),
        client.post(f"{BASE}/agent-1/revoke"),
        client.post(f"{BASE}/agent-1/revoke"),
        client.get("/docs/shared-doc", headers=_cred(token)),
        client.get(BASE),
    ]

    # トークンは登録応答の本文にだけ、一度だけ現れる。
    assert created.status_code == 201 and created.headers["cache-control"] == "no-store"
    assert created.text.count(token) == 1
    assert [r.status_code for r in responses] == [
        200,  # 一覧
        200,  # 資格情報で読む
        200,
        201,  # OAuth主体を結ぶ
        200,  # 交換後のトークンで読む
        200,
        204,  # 文書の付与を失効
        204,  # OAuth主体を外す
        204,  # 資格情報を失効
        204,  # 失効の冪等
        401,  # 失効後は読めない
        200,
    ]
    # 運用上の記録は残っている（捕捉が空振りでないことの確認）。
    messages = [
        r.getMessage() for r in logs.named("sui_sensemaking_api.routes.agent_credential_admin")
    ]
    assert "agent credential registered" in messages and "agent credential revoked" in messages
    secrets = build_secrets(opaque=(token,), jwts=(bearer,))
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=[created, *responses],
        secrets=secrets,
        transport=admin.transport,
        allow_in_body=(created,),
    )
    # OAuth主体の `sub` は管理者の応答には出てよいが、ログには出さない（security.md）。
    assert logs.leaks({"oauth-subject": SUBJECT_A}) == []
    # 登録応答でも、返してよいのはトークンだけ。鍵付きハッシュとハッシュ鍵は返さない。
    for name, value in secrets.items():
        if name.endswith(":keyed-hash") or name.startswith("hash-key"):
            assert value not in created.text, name


def test_admin_error_paths_do_not_echo_credentials(
    admin: AdminEnv, logs: Logs, capsys: pytest.CaptureFixture[str]
) -> None:
    client = admin.client
    created = client.post(BASE, json=_admin_body())
    token = created.json()["credential"]
    responses = [
        client.post(BASE, json=_admin_body(label="duplicate")),  # 409
        client.post(BASE, json=_admin_body(agentId="agent-2", expiresAt="2099-01-01T00:00:00")),
        client.post(BASE, json=_admin_body(agentId="agent-3", docIds=["b-only"])),  # 404
        client.post(BASE, json=_admin_body(agentId="bad id/with space")),  # 422
        client.post(
            f"{BASE}/agent-1/oauth-bindings",
            json={"identityProviderId": "no-such", "subject": SUBJECT_A},
        ),
        client.post(f"{BASE}/nobody/revoke"),
    ]
    admin.capabilities.capabilities = ("document.read",)
    responses += [client.post(BASE, json=_admin_body(agentId="agent-4")), client.get(BASE)]
    admin.capabilities.capabilities = ("agent.register", "agent.revoke")
    client.app.state.agent_credential_hash_key = None
    responses.append(client.post(BASE, json=_admin_body(agentId="agent-5")))  # 503

    assert [r.status_code for r in responses] == [409, 422, 404, 422, 404, 404, 403, 403, 503]
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=responses,
        secrets=build_secrets(opaque=(token,)),
        transport=admin.transport,
    )
    assert logs.leaks({"oauth-subject": SUBJECT_A}) == []


def test_agent_credentials_sent_to_admin_routes_are_ignored_and_never_logged(
    admin: AdminEnv, logs: Logs, capsys: pytest.CaptureFixture[str], signing: Signing
) -> None:
    client = admin.client
    token = client.post(BASE, json=_admin_body()).json()["credential"]
    bearer = _sign(signing.key, _claims())
    headers = {**_cred(token), **_bearer(bearer)}
    responses = [
        client.get(BASE, headers=headers),
        client.post(BASE, json=_admin_body(agentId="agent-2"), headers=headers),
    ]
    # 信頼できる利用者の基盤が無いとき、管理 API は agent の資格情報では開かない。
    client.app.state.saas_identity_context_resolver = None
    closed = [
        client.get(BASE, headers=headers),
        client.post(f"{BASE}/agent-1/revoke", headers=headers),
    ]

    assert [r.status_code for r in responses] == [200, 201]
    assert [r.status_code for r in closed] == [503, 503]
    second_token = responses[1].json()["credential"]
    assert_hygiene(
        logs=logs,
        capsys=capsys,
        responses=[*responses[:1], *closed],
        secrets=build_secrets(opaque=(token, second_token), jwts=(bearer,)),
        transport=admin.transport,
    )
