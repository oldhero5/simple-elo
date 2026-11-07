from concurrent.futures import ThreadPoolExecutor

import pytest
from helpers import (
    add_people,
    add_person,
    finish_round,
    next_matchup,
    rate,
    rate_next,
    start_round,
)

import elo


def _table_contents(client):
    tables = ["personnel", "rounds", "matchups", "ratings", "schema_version"]
    with client.app.state.db.read() as conn:
        return {
            table: conn.execute(f"SELECT * FROM {table} ORDER BY ALL").fetchall()
            for table in tables
        }


def test_no_active_round_state(client):
    assert next_matchup(client) == {
        "status": "no_active_round",
        "active_personnel": 0,
        "last_completed_round_id": None,
    }
    add_people(client, "A", "B")
    round_ = start_round(client)
    finish_round(client)
    assert next_matchup(client) == {
        "status": "no_active_round",
        "active_personnel": 2,
        "last_completed_round_id": round_["id"],
    }


def test_ready_state(client):
    add_person(client, "A", initial_elo=1200)
    add_person(client, "B", initial_elo=1000)
    round_ = start_round(client)

    body = next_matchup(client)
    assert body["status"] == "ready"
    assert body["round"]["id"] == round_["id"]
    assert body["progress"] == {
        "total": 1,
        "completed": 0,
        "remaining": 1,
        "percent": 0.0,
    }
    assert set(body["matchup"]) == {"id", "position"}
    a, b = body["person_a"], body["person_b"]
    assert {a["name"], b["name"]} == {"A", "B"}

    assert body["expected"]["a"] == pytest.approx(
        elo.expected_score(a["current_elo"], b["current_elo"]), abs=1e-4
    )
    assert body["expected"]["a"] + body["expected"]["b"] == pytest.approx(1)

    deltas = elo.preview(a["current_elo"], b["current_elo"])
    for outcome in ("a_wins", "b_wins", "draw"):
        assert body["preview"][outcome] == {
            "a": deltas[outcome][0],
            "b": deltas[outcome][1],
        }
        assert body["preview"][outcome]["a"] == -body["preview"][outcome]["b"]


def test_submit_result_updates_ratings(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    current = next_matchup(client)
    a, b = current["person_a"], current["person_b"]

    response = client.post(
        f"/api/matchups/{current['matchup']['id']}/result",
        json={"winner_id": a["id"]},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["round_completed"] is False
    rating = body["rating"]
    assert rating["winner_id"] == a["id"]
    assert rating["person_a"] == {"id": a["id"], "name": a["name"], "rank": a["rank"]}
    assert rating["person_b"]["id"] == b["id"]
    assert (rating["a_before"], rating["b_before"]) == (1000, 1000)
    assert (rating["a_after"], rating["b_after"]) == (1016, 984)
    assert rating["rated_at"].endswith("Z")

    people = {p["id"]: p for p in client.get("/api/personnel").json()}
    assert people[a["id"]]["current_elo"] == 1016
    assert people[b["id"]]["current_elo"] == 984
    assert sum(p["current_elo"] for p in people.values()) == 3000


def test_draw(client):
    add_person(client, "A", initial_elo=1200)
    add_person(client, "B", initial_elo=1000)
    start_round(client)
    current = next_matchup(client)
    rating = rate(client, current["matchup"]["id"], None)["rating"]
    assert rating["winner_id"] is None
    assert rating["a_after"] - rating["a_before"] == current["preview"]["draw"]["a"]
    assert rating["b_after"] - rating["b_before"] == current["preview"]["draw"]["b"]


def test_ratings_use_current_elo_at_submit_time(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    first = rate_next(client)["rating"]
    second_matchup = next_matchup(client)
    second = rate_next(client)["rating"]
    people = {
        first["person_a"]["id"]: first["a_after"],
        first["person_b"]["id"]: first["b_after"],
    }
    a_id = second_matchup["person_a"]["id"]
    b_id = second_matchup["person_b"]["id"]
    assert second["a_before"] == people.get(a_id, 1000)
    assert second["b_before"] == people.get(b_id, 1000)


def test_winner_must_be_in_the_matchup(client):
    a, b, c = add_people(client, "A", "B", "C")
    start_round(client)
    current = next_matchup(client)
    outsider = next(
        p["id"]
        for p in (a, b, c)
        if p["id"] not in (current["person_a"]["id"], current["person_b"]["id"])
    )
    url = f"/api/matchups/{current['matchup']['id']}/result"
    for winner_id in (outsider, 9999):
        response = client.post(url, json={"winner_id": winner_id})
        assert response.status_code == 422
        assert "winner_id" in response.json()["detail"]
    assert client.post(url, json={}).status_code == 422
    assert client.post(url, json={"winner_id": "x"}).status_code == 422
    # Nothing was recorded.
    assert client.get("/api/ratings").json() == []
    assert next_matchup(client)["matchup"] == current["matchup"]


def test_double_submit_is_409(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    current = next_matchup(client)
    winner = current["person_a"]["id"]
    rate(client, current["matchup"]["id"], winner)
    response = client.post(
        f"/api/matchups/{current['matchup']['id']}/result", json={"winner_id": winner}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "This matchup was already rated"
    assert len(client.get("/api/ratings").json()) == 1
    stats = client.get("/api/stats").json()
    assert stats["current_round"]["progress"]["completed"] == 1


def test_concurrent_submits_record_one_rating(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    current = next_matchup(client)
    url = f"/api/matchups/{current['matchup']['id']}/result"
    body = {"winner_id": current["person_a"]["id"]}
    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = sorted(
            pool.map(lambda _: client.post(url, json=body).status_code, range(4))
        )
    assert codes == [201, 409, 409, 409]
    assert len(client.get("/api/ratings").json()) == 1


def test_unknown_matchup_is_404(client):
    response = client.post("/api/matchups/999/result", json={"winner_id": None})
    assert response.status_code == 404
    assert response.json()["detail"] == "Matchup not found"
    assert client.post("/api/matchups/999/skip").status_code == 404


def test_round_completes_exactly_on_last_matchup(client):
    add_people(client, "A", "B", "C", "D")
    round_ = start_round(client)
    winners = ["a", "b", "draw", "a", "b", "draw"]
    results = [rate_next(client, winner)["round_completed"] for winner in winners]
    assert results == [False] * 5 + [True]
    detail = client.get(f"/api/rounds/{round_['id']}").json()
    assert detail["round"]["status"] == "completed"
    assert detail["round"]["completed_matchups"] == 6
    assert next_matchup(client)["status"] == "no_active_round"


def test_rating_a_matchup_from_a_closed_round_is_409(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    stale = next_matchup(client)
    start_round(client, force="true")
    response = client.post(
        f"/api/matchups/{stale['matchup']['id']}/result", json={"winner_id": None}
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "This matchup was cancelled"


def test_skip_moves_matchup_to_the_end(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    first = next_matchup(client)
    response = client.post(f"/api/matchups/{first['matchup']['id']}/skip")
    assert response.status_code == 200
    skipped = response.json()["matchup"]
    assert skipped["id"] == first["matchup"]["id"]
    assert skipped["position"] == 4

    second = next_matchup(client)
    assert second["matchup"]["id"] != first["matchup"]["id"]
    # Skipping changes nothing else.
    assert second["progress"] == first["progress"]
    assert client.get("/api/ratings").json() == []

    rate_next(client)
    rate_next(client)
    assert next_matchup(client)["matchup"]["id"] == first["matchup"]["id"]


def test_only_pending_matchups_can_be_skipped(client):
    add_people(client, "A", "B")
    start_round(client)
    current = next_matchup(client)
    rate(client, current["matchup"]["id"], None)
    response = client.post(f"/api/matchups/{current['matchup']['id']}/skip")
    assert response.status_code == 409


def test_deactivating_someone_mid_round_lets_the_round_finish(client):
    add_people(client, "A", "B", "C", "D")
    round_ = start_round(client)
    rate_next(client)

    gone = next_matchup(client)["person_a"]
    client.patch(f"/api/personnel/{gone['id']}", json={"active": False})

    progress = client.get("/api/stats").json()["current_round"]["progress"]
    with client.app.state.db.read() as conn:
        rated_with_gone = conn.execute(
            "SELECT count(*) FROM matchups WHERE round_id = ? AND status = 'completed' "
            "AND ? IN (ratee_a_id, ratee_b_id)",
            (round_["id"], gone["id"]),
        ).fetchone()[0]
    # Their unrated matchups are cancelled and drop out of the total.
    assert progress["total"] == 6 - (3 - rated_with_gone)
    assert progress["completed"] == 1

    seen = set()
    while (current := next_matchup(client))["status"] == "ready":
        seen.update((current["person_a"]["id"], current["person_b"]["id"]))
        rate_next(client)
    assert gone["id"] not in seen
    detail = client.get(f"/api/rounds/{round_['id']}").json()
    assert detail["round"]["status"] == "completed"
    assert detail["progress"]["remaining"] == 0


def test_deactivating_the_last_open_pair_completes_the_round(client):
    add_people(client, "A", "B", "C")
    round_ = start_round(client)
    rate_next(client)
    rate_next(client)
    last = next_matchup(client)
    response = client.delete(f"/api/personnel/{last['person_a']['id']}")
    assert response.status_code == 204
    detail = client.get(f"/api/rounds/{round_['id']}").json()
    assert detail["round"]["status"] == "completed"
    assert detail["round"]["completed_at"] is not None
    assert detail["progress"]["total"] == 2


def test_reactivated_person_waits_for_next_round(client):
    a, b, c = add_people(client, "A", "B", "C")
    round_ = start_round(client)
    client.delete(f"/api/personnel/{a['id']}")
    client.patch(f"/api/personnel/{a['id']}", json={"active": True})
    while (current := next_matchup(client))["status"] == "ready":
        assert a["id"] not in (current["person_a"]["id"], current["person_b"]["id"])
        rate_next(client)
    assert client.get(f"/api/rounds/{round_['id']}").json()["progress"]["total"] == 1
    assert start_round(client)["total_matchups"] == 3


def test_get_endpoints_do_not_write(client):
    add_people(client, "A", "B", "C")
    round_ = start_round(client)
    rate_next(client)
    before = _table_contents(client)

    db = client.app.state.db

    def no_writes():
        raise AssertionError("a GET request opened a write transaction")

    db.transaction = no_writes
    for url in [
        "/api/health",
        "/api/personnel",
        "/api/personnel?active_only=false",
        "/api/personnel/1",
        "/api/leaderboard",
        "/api/stats",
        "/api/rounds",
        f"/api/rounds/{round_['id']}",
        "/api/matchups/next",
        "/api/ratings",
        "/api/elo-progression/by-rounds",
        "/api/elo-progression/by-ratings",
    ]:
        assert client.get(url).status_code == 200, url
    del db.transaction
    assert _table_contents(client) == before
