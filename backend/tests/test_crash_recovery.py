"""The database must still open after the server is killed without a clean stop.

A crash, power loss or a process killed with SIGKILL never closes DuckDB, so
nothing is checkpointed and the next start has to replay the write-ahead log.
Each case runs the server code in a child process that holds a connection open
(as a concurrent request would), writes through the API, then exits without
closing anything. The parent then opens the same file again.
"""

import subprocess
import sys
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient
from test_api import OLD_SCHEMA

import main
from database import Database

BACKEND = Path(__file__).resolve().parent.parent

_KILLED_SERVER = """
import os, sys
sys.path.insert(0, sys.argv[1])
os.environ["DATABASE_URL"] = sys.argv[2]
import duckdb

# Open before anything migrates: a request still in flight at the kill keeps
# DuckDB from checkpointing when the migration's own connection closes.
held = duckdb.connect(sys.argv[2])
from fastapi.testclient import TestClient
import main
client = TestClient(main.app)
for name in ("Quinn", "Reyes", "Soto", "Tate"):
    added = client.post("/api/personnel", json={"name": name, "rank": "CPT"})
    assert added.status_code == 200, added.text
sys.path.insert(0, os.path.join(sys.argv[1], "tests"))
from test_api import answer, next_pair, start
start(client, comparisons_per_officer=1)
pair = next_pair(client)
voted = answer(client, pair, pair["person_a"]["id"])
assert voted.status_code == 200, voted.text
os._exit(0)
"""


def _run_and_kill(path: Path) -> None:
    subprocess.run(
        [sys.executable, "-c", _KILLED_SERVER, str(BACKEND), str(path)],
        check=True,
        timeout=60,
    )


@pytest.mark.parametrize("start_from", ["fresh", "old_schema"])
def test_database_opens_after_kill(start_from, tmp_path, monkeypatch):
    path = tmp_path / "elo_ratings.db"
    if start_from == "old_schema":
        with duckdb.connect(str(path)) as conn:
            conn.execute(OLD_SCHEMA)
    _run_and_kill(path)

    # Plain DuckDB first: this is where a bad write-ahead log fails.
    duckdb.connect(str(path)).close()

    monkeypatch.setattr(main, "db", Database(str(path)))
    client = TestClient(main.app)
    names = {p["name"] for p in client.get("/api/personnel").json()}
    assert {"Quinn", "Reyes", "Soto", "Tate"} <= names
    assert len(client.get("/api/history").json()) >= 1
