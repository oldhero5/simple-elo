"""Opening a database written by the first release (schema version 1)."""

import json
from datetime import datetime

import duckdb
import pytest
from fastapi.testclient import TestClient
from helpers import finish_round, next_matchup, rate_next, start_round

import elo
import migrations
from main import create_app

# Copied from the first release's backend/database.py.
V1_SCHEMA = [
    """
    CREATE SEQUENCE IF NOT EXISTS personnel_id_seq START 1
    """,
    """
    CREATE TABLE IF NOT EXISTS personnel (
        id INTEGER PRIMARY KEY DEFAULT nextval('personnel_id_seq'),
        name VARCHAR NOT NULL,
        rank VARCHAR NOT NULL,
        initial_elo INTEGER DEFAULT 1000,
        current_elo INTEGER DEFAULT 1000,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        active BOOLEAN DEFAULT TRUE
    )
    """,
    """
    CREATE SEQUENCE IF NOT EXISTS rounds_id_seq START 1
    """,
    """
    CREATE TABLE IF NOT EXISTS rounds (
        id INTEGER PRIMARY KEY DEFAULT nextval('rounds_id_seq'),
        round_name VARCHAR NOT NULL,
        dtg TIMESTAMP NOT NULL,
        status VARCHAR DEFAULT 'active',
        total_matchups INTEGER NOT NULL,
        completed_matchups INTEGER DEFAULT 0,
        personnel_snapshot TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
    """
    CREATE SEQUENCE IF NOT EXISTS matchups_id_seq START 1
    """,
    """
    CREATE TABLE IF NOT EXISTS matchups (
        id INTEGER PRIMARY KEY DEFAULT nextval('matchups_id_seq'),
        round_id INTEGER NOT NULL,
        ratee_a_id INTEGER NOT NULL,
        ratee_b_id INTEGER NOT NULL,
        status VARCHAR DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(round_id, ratee_a_id, ratee_b_id)
    )
    """,
    """
    CREATE SEQUENCE IF NOT EXISTS ratings_id_seq START 1
    """,
    """
    CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY DEFAULT nextval('ratings_id_seq'),
        round_id INTEGER NOT NULL,
        matchup_id INTEGER,
        rater_id INTEGER,
        ratee_a_id INTEGER NOT NULL,
        ratee_b_id INTEGER NOT NULL,
        winner_id INTEGER,
        ratee_a_elo_before INTEGER NOT NULL,
        ratee_b_elo_before INTEGER NOT NULL,
        ratee_a_elo_after INTEGER NOT NULL,
        ratee_b_elo_after INTEGER NOT NULL,
        rated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """,
]

ROUND_1_DTG = datetime(2026, 1, 5, 9, 0)
ORPHAN_DTG = datetime(2026, 1, 12, 9, 0)
ROUND_2_DTG = datetime(2026, 1, 19, 9, 0)


def _write_v1_database(path) -> dict[int, int]:
    """Build a v1 database the way the old app left it, including its bugs.

    Returns everyone's expected current rating by id.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = duckdb.connect(str(path))
    for statement in V1_SCHEMA:
        conn.execute(statement)

    labels: dict[int, tuple[str, str]] = {}
    ratings: dict[int, int] = {}

    def person(name, rank, active=True):
        person_id = conn.execute(
            "INSERT INTO personnel (name, rank, initial_elo, current_elo, created_at, "
            "active) VALUES (?, ?, 1000, 1000, ?, ?) RETURNING id",
            (name, rank, datetime(2026, 1, 1, 8, 0), active),
        ).fetchone()[0]
        labels[person_id] = (name, rank)
        ratings[person_id] = 1000
        return person_id

    def new_round(name, dtg, status, total, completed, people):
        snapshot = json.dumps(
            [
                {
                    "id": i,
                    "name": labels[i][0],
                    "rank": labels[i][1],
                    "current_elo": ratings[i],
                }
                for i in people
            ]
        )
        return conn.execute(
            "INSERT INTO rounds (round_name, dtg, status, total_matchups, "
            "completed_matchups, personnel_snapshot) VALUES (?, ?, ?, ?, ?, ?) "
            "RETURNING id",
            (name, dtg, status, total, completed, snapshot),
        ).fetchone()[0]

    def matchup(round_id, a, b, status="pending"):
        return conn.execute(
            "INSERT INTO matchups (round_id, ratee_a_id, ratee_b_id, status) "
            "VALUES (?, ?, ?, ?) RETURNING id",
            (round_id, a, b, status),
        ).fetchone()[0]

    def rating(round_id, matchup_id, a, b, winner, dtg):
        score = {a: elo.WIN, b: elo.LOSS, None: elo.DRAW}[winner]
        a_after, b_after = elo.apply_result(ratings[a], ratings[b], score)
        # The old app stamped every rating with the round's start time.
        conn.execute(
            "INSERT INTO ratings (round_id, matchup_id, ratee_a_id, ratee_b_id, "
            "winner_id, ratee_a_elo_before, ratee_b_elo_before, ratee_a_elo_after, "
            "ratee_b_elo_after, rated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (round_id, matchup_id, a, b, winner)
            + (ratings[a], ratings[b], a_after, b_after, dtg),
        )
        ratings[a], ratings[b] = a_after, b_after
        for person_id in (a, b):
            conn.execute(
                "UPDATE personnel SET current_elo = ? WHERE id = ?",
                (ratings[person_id], person_id),
            )

    diaz, chen, park = (
        person("Diaz", "CPT"),
        person("Chen", "SPC"),
        person("Park", "SGT"),
    )

    round_1 = new_round(
        "Round 1 - 20260105-090000", ROUND_1_DTG, "completed", 3, 3, [diaz, chen, park]
    )
    for a, b, winner in [(diaz, chen, diaz), (diaz, park, diaz), (chen, park, None)]:
        rating(round_1, matchup(round_1, a, b, "completed"), a, b, winner, ROUND_1_DTG)

    gone = person("Gone", "PFC", active=False)
    # A row left by the null initial_elo bug.
    nil = conn.execute(
        "INSERT INTO personnel (name, rank, initial_elo, current_elo) "
        "VALUES ('Nil', 'PVT', NULL, NULL) RETURNING id"
    ).fetchone()[0]
    ratings[nil] = 1000

    # A second active round left behind by the old POST /api/rounds.
    orphan = new_round("Orphan", ORPHAN_DTG, "active", 1, 0, [diaz, chen])
    matchup(orphan, diaz, chen)

    # In progress, with a drifted counter and pending matchups for Gone.
    round_2 = new_round(
        "Round 2 - 20260119-090000",
        ROUND_2_DTG,
        "active",
        6,
        2,
        [diaz, chen, park, gone],
    )
    rated = matchup(round_2, chen, diaz, "completed")
    for a, b in [(diaz, park), (chen, park), (diaz, gone), (chen, gone), (park, gone)]:
        matchup(round_2, a, b)
    rating(round_2, rated, chen, diaz, chen, ROUND_2_DTG)
    conn.close()
    return ratings


@pytest.fixture
def v1_path(tmp_path):
    return tmp_path / "data" / "elo_ratings.db"


@pytest.fixture
def expected_elo(v1_path):
    return _write_v1_database(v1_path)


def _open(path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(path))
    return TestClient(create_app())


def test_v1_data_survives_and_is_repaired(v1_path, expected_elo, monkeypatch):
    with _open(v1_path, monkeypatch) as client:
        everyone = client.get("/api/personnel", params={"active_only": "false"}).json()
        by_name = {p["name"]: p for p in everyone}
        assert set(by_name) == {"Diaz", "Chen", "Park", "Gone", "Nil"}
        for person in everyone:
            assert person["current_elo"] == expected_elo[person["id"]]
            assert person["created_at"].endswith("Z")
        assert by_name["Nil"]["initial_elo"] == 1000
        assert by_name["Gone"]["active"] is False

        with client.app.state.db.read() as conn:
            assert conn.execute("SELECT version FROM schema_version").fetchall() == [
                (2,)
            ]
            assert conn.execute(
                "SELECT count(*) FROM matchups WHERE position IS NULL OR position <> id"
            ).fetchone() == (0,)

        rounds = {r["id"]: r for r in client.get("/api/rounds").json()}
        assert [r["status"] for r in rounds.values()] == [
            "active",
            "completed",
            "completed",
        ]
        round_1, orphan, round_2 = rounds[1], rounds[2], rounds[3]
        assert round_1["name"] == "Round 1 - 20260105-090000"
        assert round_1["completed_at"] == "2026-01-05T09:00:00.000Z"
        assert orphan["completed_at"] == "2026-01-12T09:00:00.000Z"
        assert round_2["completed_at"] is None
        # The orphan's open matchup and Gone's matchups were cancelled.
        assert (orphan["total_matchups"], orphan["completed_matchups"]) == (0, 0)
        assert (round_2["total_matchups"], round_2["completed_matchups"]) == (3, 1)

        detail = client.get("/api/rounds/1").json()
        assert detail["statistics"]["total_ratings"] == 3
        finals = {s["id"]: s["final_elo"] for s in detail["standings"]}
        assert sum(finals.values()) == 3000
        assert all(s["starting_elo"] == 1000 for s in detail["standings"])

        ratings = client.get("/api/ratings").json()
        assert len(ratings) == 4
        assert ratings[0]["person_a"]["name"] == "Chen"
        assert ratings[0]["rated_at"] == "2026-01-19T09:00:00.000Z"

        stats = client.get("/api/stats").json()
        assert stats["total_ratings"] == 4
        assert stats["current_round"]["id"] == 3
        assert stats["completed_rounds"] == 2

        by_rounds = client.get("/api/elo-progression/by-rounds").json()
        assert {p["round_name"] for p in by_rounds} == {
            "Start",
            "Round 1 - 20260105-090000",
        }


def test_v1_active_round_can_be_finished(v1_path, expected_elo, monkeypatch):
    with _open(v1_path, monkeypatch) as client:
        current = next_matchup(client)
        assert current["status"] == "ready"
        assert current["round"]["id"] == 3
        assert current["progress"]["remaining"] == 2
        names = {current["person_a"]["name"], current["person_b"]["name"]}
        assert "Gone" not in names

        assert rate_next(client)["round_completed"] is False
        last = rate_next(client, "draw")
        assert last["round_completed"] is True
        assert last["rating"]["id"] == 6

        round_2 = client.get("/api/rounds/3").json()
        assert round_2["round"]["status"] == "completed"
        assert round_2["round"]["completed_at"] > round_2["round"]["dtg"]

        # Ids keep counting from the old sequences.
        new_round = start_round(client)
        assert new_round["id"] == 4
        assert new_round["name"] == "Round 4"
        assert new_round["total_matchups"] == 6  # Diaz, Chen, Park and Nil
        response = client.post("/api/personnel", json={"name": "New", "rank": "PV2"})
        assert response.json()["id"] == 6


def test_v1_people_can_be_edited(v1_path, expected_elo, monkeypatch):
    with _open(v1_path, monkeypatch) as client:
        response = client.patch("/api/personnel/1", json={"rank": "MAJ"})
        assert response.status_code == 200
        assert response.json()["rank"] == "MAJ"
        response = client.patch("/api/personnel/4", json={"active": True})
        assert response.status_code == 200
        assert response.json()["active"] is True
        assert client.delete("/api/personnel/2").status_code == 204
        # Chen's open matchup in round 2 was cancelled.
        stats = client.get("/api/stats").json()
        assert stats["current_round"]["progress"]["total"] == 2


def test_migration_runs_once(v1_path, expected_elo, monkeypatch):
    with _open(v1_path, monkeypatch) as client:
        finish_round(client)
        before = client.get("/api/rounds").json()

    def fail(conn, now):
        raise AssertionError("migration ran twice")

    monkeypatch.setitem(migrations._MIGRATIONS, 2, fail)
    with _open(v1_path, monkeypatch) as client:
        assert client.get("/api/rounds").json() == before


def test_fresh_database_matches_migrated_schema(v1_path, tmp_path, monkeypatch):
    _write_v1_database(v1_path)

    def columns(path):
        with _open(path, monkeypatch) as client:
            with client.app.state.db.read() as conn:
                return conn.execute(
                    "SELECT table_name, column_name, data_type "
                    "FROM information_schema.columns ORDER BY ALL"
                ).fetchall()

    assert columns(v1_path) == columns(tmp_path / "fresh" / "elo_ratings.db")
