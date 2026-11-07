"""The database must still open after the server is killed without a clean stop.

A crash, power loss or a container killed with SIGKILL skips the lifespan
shutdown, so DuckDB never checkpoints and the next start has to replay the
write-ahead log. Each case runs the server code in a child process that exits
without closing the database, then opens the same file again.
"""

import subprocess
import sys
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient
from test_migration import _write_v1_database

from main import create_app

BACKEND = Path(__file__).resolve().parent.parent

_KILLED_SERVER = """
import os, sys
sys.path.insert(0, sys.argv[1])
os.environ["DATABASE_PATH"] = sys.argv[2]
from fastapi.testclient import TestClient
from main import create_app

client = TestClient(create_app())
client.__enter__()  # runs startup (open + migrate) but never the shutdown
for name, rank in (("Quinn", "SGT"), ("Reyes", "SSG")):
    added = client.post("/api/personnel", json={"name": name, "rank": rank})
    assert added.status_code == 201
assert client.post("/api/rounds", params={"force": "true"}).status_code == 201
matchup_id = client.get("/api/matchups/next").json()["matchup"]["id"]
voted = client.post(f"/api/matchups/{matchup_id}/result", json={"winner_id": None})
assert voted.status_code == 201
os._exit(0)
"""


def _run_and_kill(path: Path) -> None:
    subprocess.run(
        [sys.executable, "-c", _KILLED_SERVER, str(BACKEND), str(path)],
        check=True,
        timeout=60,
    )


@pytest.mark.parametrize("start_from", ["fresh", "v1"])
def test_database_opens_after_kill(start_from, tmp_path, monkeypatch):
    path = tmp_path / "elo_ratings.db"
    if start_from == "v1":
        _write_v1_database(path)
    _run_and_kill(path)

    # Plain DuckDB first: this is where a bad write-ahead log fails.
    duckdb.connect(str(path)).close()

    monkeypatch.setenv("DATABASE_PATH", str(path))
    with TestClient(create_app()) as client:
        names = {p["name"] for p in client.get("/api/personnel").json()}
        assert {"Quinn", "Reyes"} <= names
        assert client.get("/api/stats").json()["total_ratings"] >= 1
