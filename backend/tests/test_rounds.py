import itertools
from datetime import datetime

from helpers import add_people, add_person, finish_round, rate_next, start_round


def _matchups(client, round_id):
    with client.app.state.db.read() as conn:
        return conn.execute(
            "SELECT ratee_a_id, ratee_b_id, status, position FROM matchups "
            "WHERE round_id = ? ORDER BY position",
            (round_id,),
        ).fetchall()


def test_needs_two_active_people(client):
    response = client.post("/api/rounds")
    assert response.status_code == 400
    add_person(client, "Diaz")
    assert client.post("/api/rounds").status_code == 400
    assert client.get("/api/rounds").json() == []


def test_create_round_pairs_everyone_once(client):
    people = add_people(client, "A", "B", "C", "D")
    inactive = add_person(client, "E")
    client.delete(f"/api/personnel/{inactive['id']}")

    round_ = start_round(client)
    assert round_["name"] == "Round 1"
    assert round_["status"] == "active"
    assert round_["total_matchups"] == 6
    assert round_["completed_matchups"] == 0
    assert round_["completed_at"] is None
    assert round_["dtg"].endswith("Z")
    assert "personnel_snapshot" not in round_

    rows = _matchups(client, round_["id"])
    pairs = {frozenset((a, b)) for a, b, _, _ in rows}
    ids = [p["id"] for p in people]
    assert pairs == {frozenset(pair) for pair in itertools.combinations(ids, 2)}
    assert all(a != b for a, b, _, _ in rows)
    assert [position for *_, position in rows] == list(range(1, 7))
    assert {status for _, _, status, _ in rows} == {"pending"}


def test_round_body_is_optional_and_name_can_be_set(client):
    add_people(client, "A", "B")
    response = client.post("/api/rounds", json={"name": "  Spring review  "})
    assert response.status_code == 201
    assert response.json()["name"] == "Spring review"


def test_blank_name_falls_back_to_default(client):
    add_people(client, "A", "B")
    response = client.post("/api/rounds", json={"name": "   "})
    assert response.json()["name"] == "Round 1"


def test_second_round_while_active_is_409(client):
    add_people(client, "A", "B", "C")
    first = start_round(client)
    response = client.post("/api/rounds")
    assert response.status_code == 409
    assert "Round 1" in response.json()["detail"]
    assert [r["id"] for r in client.get("/api/rounds").json()] == [first["id"]]


def test_force_closes_the_active_round(client):
    add_people(client, "A", "B", "C")
    first = start_round(client)
    rate_next(client)

    second = start_round(client, force="true")
    assert second["name"] == "Round 2"
    assert second["status"] == "active"

    closed = client.get(f"/api/rounds/{first['id']}").json()
    assert closed["round"]["status"] == "completed"
    assert closed["round"]["completed_at"] is not None
    # Unrated matchups are cancelled and no longer count toward the total.
    assert closed["progress"] == {
        "total": 1,
        "completed": 1,
        "remaining": 0,
        "percent": 100.0,
    }
    statuses = sorted(status for _, _, status, _ in _matchups(client, first["id"]))
    assert statuses == ["cancelled", "cancelled", "completed"]

    active = client.get("/api/rounds", params={"status": "active"}).json()
    assert [r["id"] for r in active] == [second["id"]]


def test_force_does_not_close_anything_when_round_cannot_start(client):
    a, b = add_people(client, "A", "B")
    first = start_round(client)
    client.delete(f"/api/personnel/{a['id']}")
    # Deactivating A cancelled the only matchup, so round 1 finished on its own.
    assert client.get(f"/api/rounds/{first['id']}").json()["round"]["status"] == (
        "completed"
    )
    assert client.post("/api/rounds", params={"force": "true"}).status_code == 400


def test_round_completes_and_records_completed_at(client):
    add_people(client, "A", "B", "C")
    round_ = start_round(client)
    assert finish_round(client) == 3
    detail = client.get(f"/api/rounds/{round_['id']}").json()
    assert detail["round"]["status"] == "completed"
    completed_at = datetime.fromisoformat(detail["round"]["completed_at"])
    assert completed_at >= datetime.fromisoformat(detail["round"]["dtg"])
    assert detail["progress"]["percent"] == 100.0
    assert start_round(client)["name"] == "Round 2"


def test_list_rounds_newest_first_and_filtered(client):
    add_people(client, "A", "B")
    first = start_round(client)
    finish_round(client)
    second = start_round(client)

    assert [r["id"] for r in client.get("/api/rounds").json()] == [
        second["id"],
        first["id"],
    ]
    completed = client.get("/api/rounds", params={"status": "completed"}).json()
    assert [r["id"] for r in completed] == [first["id"]]
    assert client.get("/api/rounds", params={"status": "bogus"}).status_code == 422


def test_round_detail_standings(client):
    a, b, c = add_people(client, "A", "B", "C")
    round_ = start_round(client)
    finish_round(client, winner="a")

    detail = client.get(f"/api/rounds/{round_['id']}").json()
    standings = detail["standings"]
    assert {s["id"] for s in standings} == {a["id"], b["id"], c["id"]}
    assert [s["final_elo"] for s in standings] == sorted(
        (s["final_elo"] for s in standings), reverse=True
    )
    current = {p["id"]: p["current_elo"] for p in client.get("/api/personnel").json()}
    for standing in standings:
        assert standing["starting_elo"] == 1000
        assert standing["final_elo"] == current[standing["id"]]
        assert standing["change"] == standing["final_elo"] - 1000
    assert sum(s["change"] for s in standings) == 0

    stats = detail["statistics"]
    assert stats["total_ratings"] == 3
    assert stats["total_personnel"] == 3
    assert stats["biggest_gain"] == max(s["change"] for s in standings)
    assert stats["biggest_loss"] == min(s["change"] for s in standings)


def test_people_without_ratings_keep_their_starting_value(client):
    add_people(client, "A", "B", "C")
    round_ = start_round(client)
    rate_next(client)
    detail = client.get(f"/api/rounds/{round_['id']}").json()
    unchanged = [s for s in detail["standings"] if s["change"] == 0]
    assert len(unchanged) == 1
    assert unchanged[0]["final_elo"] == unchanged[0]["starting_elo"] == 1000


def test_round_detail_404(client):
    response = client.get("/api/rounds/99")
    assert response.status_code == 404
    assert response.json()["detail"] == "Round not found"


def test_people_added_mid_round_join_the_next_round(client):
    add_people(client, "A", "B")
    first = start_round(client)
    late = add_person(client, "Late")
    assert first["total_matchups"] == 1
    finish_round(client)
    second = start_round(client)
    assert second["total_matchups"] == 3
    ids = {i for a, b, _, _ in _matchups(client, second["id"]) for i in (a, b)}
    assert late["id"] in ids


def test_sides_and_order_are_randomized(client):
    top = add_person(client, "Top", initial_elo=1500)
    add_people(client, "A", "B", "C")
    sides = set()
    first_pairs = set()
    for _ in range(10):
        round_ = start_round(client, force="true")
        rows = _matchups(client, round_["id"])
        sides.update(
            "a" if a == top["id"] else "b" for a, b, _, _ in rows if top["id"] in (a, b)
        )
        first_pairs.add(frozenset(rows[0][:2]))
    # Each check fails by chance with probability below one in a million.
    assert sides == {"a", "b"}
    assert len(first_pairs) > 1
