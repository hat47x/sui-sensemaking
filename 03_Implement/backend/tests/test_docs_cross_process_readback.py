"""RIR-01/RIR-03: a separate process must re-read the persisted DocumentV1.

This does not exercise a Raw Item Reader, browser restart, a second Canvas, or
an external agent. Keep those claims separate from DocumentV1 persistence.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

# Environment hygiene matches tests/conftest.py even for the standalone child.
os.environ.pop("DATABASE_URL", None)

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from sui_sensemaking_api.db import _normalize_database_url, get_db  # noqa: E402
from sui_sensemaking_api.main import app  # noqa: E402
from sui_sensemaking_api.models import Base  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
READBACK_MARKER = "SUI_R0_READBACK_JSON="


@contextmanager
def _document_client(db_path: Path) -> Iterator[TestClient]:
    # Both parent and child use the actual ASGI document route, but independent
    # SQLAlchemy engines, sessions, and Python processes.
    engine = create_engine(_normalize_database_url(f"sqlite:///{db_path}"))
    session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(bind=engine)

    def _get_db():
        db = session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db
    try:
        with TestClient(app) as client:
            yield client
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def _document(doc_id: str) -> dict:
    return {
        "version": 1,
        "id": doc_id,
        "title": "人が読み直すための三枚のカード",
        "createdAt": "2026-11-13T00:00:00Z",
        "updatedAt": "2026-11-13T00:00:00Z",
        "transform": {"panX": 12, "panY": -6, "zoom": 1},
        "cards": [
            {
                "id": "observation-a",
                "text": "同じ言葉を使っていた。",
                "x": 10,
                "y": 20,
                "meta": {"source": "interview-A line 12"},
            },
            {
                "id": "observation-b",
                "text": "同じ言葉を使っていた。",
                "x": 190,
                "y": 80,
                "meta": {"source": "interview-B line 9"},
            },
            {
                "id": "unresolved",
                "text": "理由はまだ分からない。",
                "x": 340,
                "y": 150,
                "holdState": "held",
            },
        ],
        "edges": [
            {
                "id": "relation-ab",
                "fromId": "observation-a",
                "toId": "observation-b",
                "type": "related",
            }
        ],
        "islands": [
            {
                "id": "island-unresolved",
                "cardIds": ["observation-a", "unresolved"],
                "title": "未確定のまとまり",
            }
        ],
    }


def _read_in_another_process(db_path: Path, doc_id: str) -> dict:
    env = os.environ.copy()
    env.pop("DATABASE_URL", None)
    env["PYTHONPATH"] = str(BACKEND_DIR / "src")
    completed = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--readback", str(db_path), doc_id],
        cwd=BACKEND_DIR,
        env=env,
        text=True,
        capture_output=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, (
        f"separate reader exited {completed.returncode}: {completed.stderr}\n"
        f"{completed.stdout}"
    )
    reports = [
        line.removeprefix(READBACK_MARKER)
        for line in completed.stdout.splitlines()
        if line.startswith(READBACK_MARKER)
    ]
    assert len(reports) == 1, "expected one independent API readback report"
    return json.loads(reports[0])


def test_documentv1_http_save_is_visible_to_fresh_process(tmp_path: Path) -> None:
    """RIR-01: writer TestClient ends before a new process calls GET /docs/id."""
    db_path = tmp_path / "persisted-document.sqlite3"
    doc_id = "rir-01-cross-process"
    requested = _document(doc_id)

    with _document_client(db_path) as writer:
        put = writer.put(f"/docs/{doc_id}", json=requested)
        assert put.status_code == 200, put.text
        expected = put.json()  # actual server normalization, not the sole oracle
        first_etag = put.headers.get("etag")
        assert first_etag
        # Hand-authored semantic expectations, separate from the API output:
        assert [c["id"] for c in expected["cards"]] == [
            "observation-a", "observation-b", "unresolved"
        ]
        assert expected["cards"][0]["meta"]["source"] == "interview-A line 12"
        assert expected["cards"][1]["meta"]["source"] == "interview-B line 9"
        assert expected["cards"][0]["text"] == expected["cards"][1]["text"]
        assert expected["cards"][2]["holdState"] == "held"
        assert expected["edges"][0]["id"] == "relation-ab"
        assert expected["islands"][0]["cardIds"] == ["observation-a", "unresolved"]

    # No in-memory sessions or TestClient are shared with this subprocess.
    readback = _read_in_another_process(db_path, doc_id)
    assert readback["status"] == 200
    assert readback["etag"] == first_etag
    assert readback["body"] == expected

    # RIR-03: equal card text does not collapse two source observations.
    cards = {c["id"]: c for c in readback["body"]["cards"]}
    assert len(cards) == 3
    assert cards["observation-a"]["text"] == cards["observation-b"]["text"]
    assert cards["observation-a"]["meta"]["source"] != cards["observation-b"]["meta"]["source"]

    # A stale writer is rejected; then a *new* reader still observes the original.
    with _document_client(db_path) as stale_writer:
        stale = stale_writer.put(
            f"/docs/{doc_id}",
            json={**requested, "title": "誤った上書き"},
            headers={"If-Match": '"invalid-stale-etag"'},
        )
        assert stale.status_code == 409
    after_conflict = _read_in_another_process(db_path, doc_id)
    assert after_conflict["status"] == 200
    assert after_conflict["etag"] == first_etag
    assert after_conflict["body"] == expected


def test_missing_document_in_fresh_process_is_not_found(tmp_path: Path) -> None:
    """A genuine missing ID is distinct from an unenumerated listing page."""
    db_path = tmp_path / "missing-document.sqlite3"
    with _document_client(db_path):
        pass
    readback = _read_in_another_process(db_path, "not-stored")
    assert readback["status"] == 404
    assert readback["body"]["detail"] == "Document not found"


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "--readback":
        raise SystemExit("usage: test_docs_cross_process_readback.py --readback DB_PATH DOC_ID")
    with _document_client(Path(sys.argv[2])) as separate_client:
        response = separate_client.get(f"/docs/{sys.argv[3]}")
        print(
            READBACK_MARKER
            + json.dumps(
                {
                    "status": response.status_code,
                    "etag": response.headers.get("etag"),
                    "body": response.json(),
                },
                ensure_ascii=False,
                sort_keys=True,
            )
        )
