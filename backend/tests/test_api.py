"""Scoring behaviour through the API, each test on its own database."""

import duckdb
import pytest
from fastapi.testclient import TestClient

import main
from database import Database


JSON = {"Content-Type": "application/json"}


@pytest.fixture
def database(tmp_path, monkeypatch):
    fresh = Database(str(tmp_path / "test.db"))
    monkeypatch.setattr(main, "db", fresh)
    return fresh


@pytest.fixture
def client(database):
    return TestClient(main.app)


def add(client, name, rank="CPT", unit="U1"):
    response = client.post(
        "/api/personnel", json={"name": name, "rank": rank, "unit": unit}
    )
    assert response.status_code == 200
    return response.json()


def add_pool(client, n=6, rank="CPT", units=("U1", "U2")):
    return [
        add(client, f"{rank} {i}", rank, units[i % len(units)]) for i in range(n)
    ]


def start(client, **config):
    config.setdefault("comparisons_per_officer", 3)
    config.setdefault("seed", 1)
    response = client.post("/api/rounds/new", json=config)
    assert response.status_code == 200, response.text
    return response.json()["round"]


def next_pair(client):
    response = client.get("/api/comparison/full")
    assert response.status_code == 200, response.text
    return response.json()


def answer(client, pair, winner=None, cant_judge=False):
    return client.post(
        "/api/rate",
        json={
            "round_id": pair["round_info"]["id"],
            "matchup_id": pair["matchup"]["id"],
            "ratee_a_id": pair["person_a"]["id"],
            "ratee_b_id": pair["person_b"]["id"],
            "winner_id": winner,
            "cant_judge": cant_judge,
        },
    )


def ratings(client):
    people = client.get("/api/personnel").json()
    return {
        p["id"]: (p["current_elo"], p["current_potential"]) for p in people
    }


# Can't judge
def test_cant_judge_records_the_answer_and_moves_no_rating(client):
    add_pool(client)
    start(client)
    # Unequal ratings first, so a draw would have moved them.
    pair = next_pair(client)
    assert answer(client, pair, pair["person_a"]["id"]).status_code == 200
    before = ratings(client)

    pair = next_pair(client)
    response = answer(client, pair, cant_judge=True)
    assert response.status_code == 200
    row = response.json()
    assert row["outcome"] == "cant_judge"
    assert row["winner_id"] is None
    assert row["ratee_a_elo_after"] == row["ratee_a_elo_before"]
    assert row["ratee_b_elo_after"] == row["ratee_b_elo_before"]
    assert ratings(client) == before


def test_cant_judge_is_not_a_draw(client):
    add_pool(client, n=3, units=("U1",))
    start(client, comparisons_per_officer=2)
    # After one decided answer, the next pair is unequal, so a draw must move it.
    pair = next_pair(client)
    answer(client, pair, pair["person_a"]["id"])
    pair = next_pair(client)
    row = answer(client, pair).json()
    assert row["outcome"] == "draw"
    assert row["ratee_a_elo_after"] != row["ratee_a_elo_before"]


def test_cant_judge_closes_the_matchup_so_the_round_can_finish(client):
    add_pool(client, n=4, units=("U1",))
    start(client, comparisons_per_officer=2)
    seen = set()
    for _ in range(4):
        pair = next_pair(client)
        assert pair["matchup"]["id"] not in seen
        seen.add(pair["matchup"]["id"])
        assert answer(client, pair, cant_judge=True).status_code == 200
    assert client.get("/api/comparison/full").status_code == 404
    assert client.get("/api/rounds/completed").json()[0]["completed_matchups"] == 4


def test_cant_judge_with_a_winner_is_rejected(client):
    people = add_pool(client)
    start(client)
    response = answer(client, next_pair(client), people[0]["id"], cant_judge=True)
    assert response.status_code == 422


def test_cant_judge_stays_out_of_counts_replay_and_progression(client, database):
    add_pool(client)
    start(client)
    pair = next_pair(client)
    answer(client, pair, pair["person_a"]["id"])
    pair = next_pair(client)
    answer(client, pair, cant_judge=True)
    pair = next_pair(client)
    answer(client, pair, pair["person_b"]["id"])

    population = client.get("/api/population?band=tactical").json()
    assert population["summary"]["comparisons"] == 2
    assert population["summary"]["cant_judge"] == 1
    assert sum(r["comparisons"] for r in population["leaderboard"]) == 4
    assert client.get("/api/stats").json()["total_ratings"] == 2
    assert client.get("/api/rounds/1/progress").json()["cant_judge"] == 1
    assert len(client.get("/api/elo-progression").json()) == 4
    replay = client.get("/api/replay?band=tactical&shuffles=5").json()
    assert replay["summary"]["comparisons"] == 2
    assert len(client.get("/api/history").json()) == 3


# Scoring integrity
def test_ratings_are_stored_unrounded(client):
    add_pool(client, n=3, units=("U1",))
    start(client, comparisons_per_officer=2)
    for _ in range(3):
        pair = next_pair(client)
        answer(client, pair, pair["person_a"]["id"])
    values = [r[0] for r in ratings(client).values()]
    assert any(v != round(v) for v in values)
    assert sum(values) == pytest.approx(3000)


def test_a_matchup_cannot_be_answered_twice(client):
    add_pool(client)
    start(client)
    pair = next_pair(client)
    assert answer(client, pair, pair["person_a"]["id"]).status_code == 200
    before = ratings(client)
    assert answer(client, pair, pair["person_a"]["id"]).status_code == 400
    assert ratings(client) == before


def test_winner_outside_the_matchup_is_rejected(client):
    add_pool(client)
    outsider = add(client, "Outsider", "MAJ")
    start(client, band="tactical")
    before = ratings(client)
    assert answer(client, next_pair(client), outsider["id"]).status_code == 400
    assert ratings(client) == before


# Tracks
def test_tracks_are_scored_separately(client):
    add_pool(client)
    start(client, track="potential")
    pair = next_pair(client)
    assert pair["track"] == "potential"
    assert "potential" in pair["question"]
    row = answer(client, pair, pair["person_a"]["id"]).json()
    assert row["track"] == "potential"

    people = ratings(client)
    assert all(performance == 1000 for performance, _ in people.values())
    assert people[pair["person_a"]["id"]][1] > 1000


def test_comparison_uses_the_rating_of_the_round_track(client):
    add_pool(client)
    start(client, track="potential")
    pair = next_pair(client)
    answer(client, pair, pair["person_a"]["id"])
    start(client, track="performance", seed=2)
    pair = next_pair(client)
    assert (pair["rating_a"], pair["rating_b"]) == (1000, 1000)


def test_population_cuts_by_track(client):
    add_pool(client)
    start(client, track="potential")
    pair = next_pair(client)
    answer(client, pair, pair["person_a"]["id"])
    url = "/api/population?band=tactical&track="
    assert client.get(url + "potential").json()["summary"]["comparisons"] == 1
    assert client.get(url + "performance").json()["summary"]["comparisons"] == 0


# Bands
def test_band_is_derived_from_rank(client):
    assert add(client, "A", "1LT")["band"] == "tactical"
    assert add(client, "B", "LTC")["band"] == "operational"
    assert add(client, "C", "BG")["band"] == "strategic"
    assert add(client, "D", "SSG")["band"] == "unbanded"


def test_rounds_never_pair_across_bands(client):
    add_pool(client, rank="CPT")
    add_pool(client, rank="MAJ")
    add_pool(client, rank="COL")
    round_ = start(client)
    bands = {b["band"] for b in round_["design"]["bands"]}
    assert bands == {"tactical", "operational", "strategic"}
    while True:
        response = client.get("/api/comparison/full")
        if response.status_code == 404:
            break
        pair = response.json()
        assert pair["person_a"]["band"] == pair["person_b"]["band"]
        answer(client, pair, cant_judge=True)


def test_a_cross_band_answer_is_refused_at_scoring(client, database):
    captain = add(client, "A", "CPT")
    other = add(client, "B", "CPT")
    start(client, comparisons_per_officer=1)
    pair = next_pair(client)
    client.put(f"/api/personnel/{other['id']}", json={"rank": "MAJ"})
    before = ratings(client)
    response = answer(client, pair, captain["id"])
    assert response.status_code == 400
    assert "band" in response.json()["detail"]
    assert ratings(client) == before


def test_pending_cross_band_matchup_is_voided_not_served(client):
    people = add_pool(client, n=4, units=("U1",))
    start(client, comparisons_per_officer=3)
    client.put(f"/api/personnel/{people[0]['id']}", json={"rank": "MAJ"})
    served = 0
    while True:
        response = client.get("/api/comparison/full")
        if response.status_code == 404:
            break
        pair = response.json()
        assert people[0]["id"] not in (pair["person_a"]["id"], pair["person_b"]["id"])
        answer(client, pair, cant_judge=True)
        served += 1
    assert served == 3
    assert client.get("/api/rounds/completed").json()[0]["total_matchups"] == 3


def test_promotion_across_bands_restarts_ratings_and_keeps_the_record(client):
    people = add_pool(client, n=4, units=("U1",))
    start(client, comparisons_per_officer=2)
    target = people[0]["id"]
    while True:
        response = client.get("/api/comparison/full")
        if response.status_code == 404:
            break
        pair = response.json()
        ids = (pair["person_a"]["id"], pair["person_b"]["id"])
        answer(client, pair, target if target in ids else ids[0])
    assert ratings(client)[target][0] > 1000

    promoted = client.put(f"/api/personnel/{target}", json={"rank": "MAJ"}).json()
    assert promoted["band"] == "operational"
    assert (promoted["current_elo"], promoted["current_potential"]) == (1000, 1000)
    tactical = client.get("/api/population?band=tactical").json()
    assert tactical["summary"]["comparisons"] == 4


def test_rank_change_inside_a_band_keeps_the_rating(client):
    people = add_pool(client, n=2, units=("U1",))
    start(client, comparisons_per_officer=1)
    pair = next_pair(client)
    answer(client, pair, people[0]["id"])
    rating = ratings(client)[people[0]["id"]][0]
    updated = client.put(
        f"/api/personnel/{people[0]['id']}", json={"rank": "1LT"}
    ).json()
    assert updated["current_elo"] == rating


def test_all_bands_view_never_ranks_across_bands(client):
    add_pool(client, rank="CPT")
    add_pool(client, rank="MAJ")
    start(client)
    for _ in range(4):
        pair = next_pair(client)
        answer(client, pair, pair["person_a"]["id"])
    view = client.get("/api/population").json()
    assert view["leaderboard"] == []
    assert all(q["mean"] is None for q in view["by_quarter"])
    assert all(u["mean_rating"] is None for u in view["by_unit"])


# Budgeted rounds
def test_round_is_budgeted_not_all_pairs(client):
    add_pool(client, n=30, units=("U1", "U2", "U3"))
    round_ = start(client, comparisons_per_officer=7, cross_unit_share=0.2)
    assert round_["total_matchups"] == 105
    (band,) = round_["design"]["bands"]
    assert band["realised_cross_unit_share"] == pytest.approx(0.2, abs=0.01)
    assert (band["min_comparisons"], band["max_comparisons"]) == (7, 7)


def test_default_round_uses_ten_per_officer_and_twenty_percent(client):
    add_pool(client, n=30, units=("U1", "U2", "U3"))
    round_ = client.post("/api/rounds/new", headers=JSON).json()["round"]
    assert round_["comparisons_per_officer"] == 10
    assert round_["cross_unit_share"] == 0.2
    assert round_["total_matchups"] == 150


def test_round_can_be_limited_to_one_band(client):
    add_pool(client, rank="CPT")
    add_pool(client, rank="MAJ")
    round_ = start(client, band="operational")
    assert [b["band"] for b in round_["design"]["bands"]] == ["operational"]


def test_budget_out_of_range_is_rejected(client):
    add_pool(client)
    assert (
        client.post("/api/rounds/new", json={"comparisons_per_officer": 0}).status_code
        == 422
    )
    response = client.post("/api/rounds/new", json={"cross_unit_share": 2})
    assert response.status_code == 422


def test_new_round_with_too_few_personnel_is_a_clear_error(client):
    add(client, "Alone")
    response = client.post("/api/rounds/new", headers=JSON)
    assert response.status_code == 400


def test_quarter_advances_per_track_and_can_be_set(client):
    add_pool(client)
    assert start(client)["quarter"] == 1
    assert start(client, seed=2)["quarter"] == 2
    assert start(client, track="potential")["quarter"] == 1
    assert start(client, quarter=9, seed=3)["quarter"] == 9


# Units and quarters
def test_record_keeps_the_unit_held_at_the_time_of_comparison(client):
    people = add_pool(client, n=2, units=("U1",))
    start(client, comparisons_per_officer=1, quarter=1)
    pair = next_pair(client)
    answer(client, pair, people[0]["id"])
    client.put(f"/api/personnel/{people[0]['id']}", json={"unit": "U9"})
    url = "/api/population?band=tactical&unit="
    assert client.get(url + "U1").json()["summary"]["comparisons"] == 1
    assert client.get(url + "U9").json()["summary"]["comparisons"] == 0


def test_cross_unit_flag_is_recorded(client):
    add(client, "A", unit="U1")
    add(client, "B", unit="U2")
    start(client, comparisons_per_officer=1, cross_unit_share=1)
    pair = next_pair(client)
    assert pair["cross_unit"] is True
    row = answer(client, pair, pair["person_a"]["id"]).json()
    assert row["cross_unit"] is True
    assert {row["unit_a"], row["unit_b"]} == {"U1", "U2"}


def test_time_filter_cuts_the_record(client):
    people = add_pool(client, n=2, units=("U1",))
    for quarter in (1, 2, 3):
        start(client, comparisons_per_officer=1, quarter=quarter, seed=quarter)
        answer(client, next_pair(client), people[0]["id"])
    url = "/api/population?band=tactical"
    assert client.get(url).json()["summary"]["comparisons"] == 3
    window = client.get(url + "&quarter_from=2&quarter_to=2").json()
    assert window["summary"]["comparisons"] == 1
    assert [q["quarter"] for q in window["by_quarter"]] == [2]
    assert window["leaderboard"][0]["change"] != 0
    early = client.get(url + "&quarter_to=1").json()["leaderboard"][0]
    late = client.get(url + "&quarter_to=3").json()["leaderboard"][0]
    assert late["rating"] > early["rating"]


def test_filters_list_what_exists(client):
    add_pool(client, n=2, units=("U1", "U2"))
    start(client, comparisons_per_officer=1, quarter=4)
    answer(client, next_pair(client), cant_judge=True)
    filters = client.get("/api/filters").json()
    assert filters["bands"] == [{"band": "tactical", "officers": 2}]
    assert "U2" in filters["units"]
    assert filters["quarters"] == [4]


def test_empty_database_views_do_not_fail(client):
    assert client.get("/api/filters").json()["quarters"] == []
    view = client.get("/api/population").json()
    assert view["summary"]["comparisons"] == 0
    replay = client.get("/api/replay?band=tactical").json()
    assert replay["officers"] == []
    assert client.get("/api/meta").json()["synthetic"] is False


# Replay
def test_replay_recorded_rating_matches_the_live_rating(client):
    people = add_pool(client, n=6)
    start(client, comparisons_per_officer=3)
    while True:
        response = client.get("/api/comparison/full")
        if response.status_code == 404:
            break
        pair = response.json()
        answer(client, pair, pair["person_a"]["id"])
    view = client.get("/api/replay?band=tactical&shuffles=20&seed=4").json()
    live = ratings(client)
    assert len(view["officers"]) == len(people)
    for officer in view["officers"]:
        assert officer["recorded"] == pytest.approx(live[officer["id"]][0])
        assert officer["min"] <= officer["mean"] <= officer["max"]


def test_replay_unit_filter_lists_fewer_officers_on_the_same_record(client):
    add_pool(client, n=6)
    start(client, comparisons_per_officer=3)
    for _ in range(5):
        pair = next_pair(client)
        answer(client, pair, pair["person_a"]["id"])
    url = "/api/replay?band=tactical&shuffles=10"
    full = client.get(url).json()
    cut = client.get(url + "&unit=U1").json()
    assert cut["summary"] == full["summary"]
    assert {o["unit"] for o in cut["officers"]} == {"U1"}
    means = {o["id"]: o["mean"] for o in full["officers"]}
    assert all(means[o["id"]] == o["mean"] for o in cut["officers"])


def test_replay_needs_a_band(client):
    assert client.get("/api/replay").status_code == 422


# Migration
OLD_SCHEMA = """
CREATE SEQUENCE personnel_id_seq START 1;
CREATE TABLE personnel (
    id INTEGER PRIMARY KEY DEFAULT nextval('personnel_id_seq'),
    name VARCHAR NOT NULL, rank VARCHAR NOT NULL,
    initial_elo INTEGER DEFAULT 1000, current_elo INTEGER DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, active BOOLEAN DEFAULT TRUE);
CREATE SEQUENCE rounds_id_seq START 1;
CREATE TABLE rounds (
    id INTEGER PRIMARY KEY DEFAULT nextval('rounds_id_seq'),
    round_name VARCHAR NOT NULL, dtg TIMESTAMP NOT NULL,
    status VARCHAR DEFAULT 'active', total_matchups INTEGER NOT NULL,
    completed_matchups INTEGER DEFAULT 0, personnel_snapshot TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE SEQUENCE matchups_id_seq START 1;
CREATE TABLE matchups (
    id INTEGER PRIMARY KEY DEFAULT nextval('matchups_id_seq'),
    round_id INTEGER NOT NULL, ratee_a_id INTEGER NOT NULL,
    ratee_b_id INTEGER NOT NULL, status VARCHAR DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(round_id, ratee_a_id, ratee_b_id));
CREATE SEQUENCE ratings_id_seq START 1;
CREATE TABLE ratings (
    id INTEGER PRIMARY KEY DEFAULT nextval('ratings_id_seq'),
    round_id INTEGER NOT NULL, matchup_id INTEGER, rater_id INTEGER,
    ratee_a_id INTEGER NOT NULL, ratee_b_id INTEGER NOT NULL, winner_id INTEGER,
    ratee_a_elo_before INTEGER NOT NULL, ratee_b_elo_before INTEGER NOT NULL,
    ratee_a_elo_after INTEGER NOT NULL, ratee_b_elo_after INTEGER NOT NULL,
    rated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
INSERT INTO personnel (name, rank, current_elo) VALUES
    ('Old A', 'CPT', 1016), ('Old B', 'CPT', 984), ('Old C', 'SSG', 1000);
INSERT INTO rounds (round_name, dtg, status, total_matchups, personnel_snapshot)
    VALUES ('Old', now(), 'completed', 2, '[]');
INSERT INTO ratings (round_id, ratee_a_id, ratee_b_id, winner_id,
    ratee_a_elo_before, ratee_b_elo_before, ratee_a_elo_after, ratee_b_elo_after)
    VALUES (1, 1, 2, 1, 1000, 1000, 1016, 984), (1, 1, 2, NULL, 1016, 984, 1016, 984);
"""


def test_existing_database_is_migrated_in_place(tmp_path, monkeypatch):
    path = str(tmp_path / "old.db")
    with duckdb.connect(path) as conn:
        conn.execute(OLD_SCHEMA)

    migrated = Database(path)
    Database(path)  # running it twice changes nothing
    monkeypatch.setattr(main, "db", migrated)
    client = TestClient(main.app)

    people = {p["name"]: p for p in client.get("/api/personnel").json()}
    assert people["Old A"]["band"] == "tactical"
    assert people["Old C"]["band"] == "unbanded"
    assert people["Old A"]["unit"] == "UNASSIGNED"
    assert people["Old A"]["current_potential"] == 1000
    rows = {r["id"]: r for r in client.get("/api/history").json()}
    assert rows[1]["outcome"] == "a_wins"
    assert rows[2]["outcome"] == "draw"
    assert rows[1]["track"] == "performance"
    assert rows[1]["band"] == "tactical"

    round_ = start(client, comparisons_per_officer=1)
    assert round_["track"] == "performance"
    pair = next_pair(client)
    assert answer(client, pair, pair["person_a"]["id"]).status_code == 200


# Request hardening
def test_unknown_host_is_refused(client):
    for host, status in (("evil.example", 400), ("127.0.0.1:8000", 200)):
        assert client.get("/api/meta", headers={"Host": host}).status_code == status


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Content-Type": "text/plain"},
        {"Content-Type": "application/x-www-form-urlencoded"},
    ],
)
def test_writes_must_be_json(client, headers):
    body = '{"name": "X", "rank": "CPT"}'
    response = client.post("/api/personnel", content=body, headers=headers)
    assert response.status_code == 415
    assert client.post("/api/rounds/start-first", headers=headers).status_code == 415
    assert client.get("/api/personnel").json() == []


def test_json_with_charset_is_accepted(client):
    response = client.post(
        "/api/personnel",
        content='{"name": "X", "rank": "CPT"}',
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "url",
    [
        "/api/history?limit=-1",
        "/api/history?limit=0",
        "/api/history?limit=501",
        "/api/personnel?limit=5001",
        "/api/population?quarter_to=401",
        "/api/replay?band=tactical&through_quarter=401",
    ],
)
def test_out_of_range_queries_are_422(client, url):
    assert client.get(url).status_code == 422


@pytest.mark.parametrize("initial_elo", [-1, 5001, 99999999999])
def test_out_of_range_initial_elo_is_422(client, initial_elo):
    response = client.post(
        "/api/personnel", json={"name": "X", "rank": "CPT", "initial_elo": initial_elo}
    )
    assert response.status_code == 422


def test_round_quarter_has_an_upper_bound(client):
    add_pool(client)
    response = client.post("/api/rounds/new", json={"quarter": 401})
    assert response.status_code == 422


def test_database_errors_are_not_echoed(client, monkeypatch):
    def broken(_):
        raise RuntimeError("Conversion Error: secret INT32 detail")

    monkeypatch.setattr(main.db, "create_personnel", broken)
    response = client.post("/api/personnel", json={"name": "X", "rank": "CPT"})
    assert response.status_code == 500
    assert "INT32" not in response.text
