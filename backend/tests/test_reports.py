from helpers import add_people, add_person, finish_round, rate_next, start_round


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_docs_are_served_under_api(client):
    assert client.get("/api/docs").status_code == 200
    spec = client.get("/api/openapi.json").json()
    assert spec["info"]["title"] == "Elo Rater API"
    assert "/api/matchups/{matchup_id}/result" in spec["paths"]
    assert not any("debug" in path for path in spec["paths"])
    assert client.get("/api/debug/matchups").status_code == 404


def test_leaderboard_counts_results(client):
    a, b, c = add_people(client, "A", "B", "C")
    inactive = add_person(client, "Gone")
    client.delete(f"/api/personnel/{inactive['id']}")
    start_round(client)
    rate_next(client, "a")
    rate_next(client, "b")
    rate_next(client, "draw")

    board = client.get("/api/leaderboard").json()
    assert {p["id"] for p in board} == {a["id"], b["id"], c["id"]}
    assert [p["current_elo"] for p in board] == sorted(
        (p["current_elo"] for p in board), reverse=True
    )
    for entry in board:
        assert entry["matches"] == 2
        assert entry["wins"] + entry["losses"] + entry["draws"] == 2
    assert sum(p["wins"] for p in board) == 2
    assert sum(p["losses"] for p in board) == 2
    assert sum(p["draws"] for p in board) == 2

    ratings = client.get("/api/ratings").json()
    for entry in board:
        wins = sum(r["winner_id"] == entry["id"] for r in ratings)
        assert entry["wins"] == wins


def test_leaderboard_includes_people_without_ratings(client):
    add_person(client, "A")
    entry = client.get("/api/leaderboard").json()[0]
    assert (entry["wins"], entry["losses"], entry["draws"], entry["matches"]) == (
        0,
        0,
        0,
        0,
    )


def test_stats_empty(client):
    assert client.get("/api/stats").json() == {
        "total_personnel": 0,
        "total_ratings": 0,
        "avg_elo": 0,
        "highest_elo": 0,
        "lowest_elo": 0,
        "current_round": None,
        "completed_rounds": 0,
    }


def test_stats(client):
    add_person(client, "A", initial_elo=1200)
    add_person(client, "B", initial_elo=1000)
    add_person(client, "C", initial_elo=900)
    round_ = start_round(client)
    rate_next(client)

    stats = client.get("/api/stats").json()
    assert stats["total_personnel"] == 3
    assert stats["total_ratings"] == 1
    assert stats["avg_elo"] == round(3100 / 3, 1)
    people = client.get("/api/personnel").json()
    assert stats["highest_elo"] == max(p["current_elo"] for p in people)
    assert stats["lowest_elo"] == min(p["current_elo"] for p in people)
    assert stats["completed_rounds"] == 0
    current = stats["current_round"]
    assert current["id"] == round_["id"]
    assert current["name"] == "Round 1"
    assert current["progress"] == {
        "total": 3,
        "completed": 1,
        "remaining": 2,
        "percent": 33.3,
    }

    finish_round(client)
    stats = client.get("/api/stats").json()
    assert stats["current_round"] is None
    assert stats["completed_rounds"] == 1
    assert "debug_matchups" not in stats


def test_ratings_newest_first_with_names(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    first = rate_next(client)["rating"]
    second = rate_next(client)["rating"]

    ratings = client.get("/api/ratings").json()
    assert [r["id"] for r in ratings] == [second["id"], first["id"]]
    assert ratings[0] == second
    assert set(ratings[0]["person_a"]) == {"id", "name", "rank"}
    assert ratings[0]["rated_at"] >= ratings[1]["rated_at"]

    assert len(client.get("/api/ratings", params={"limit": 1}).json()) == 1
    for bad in (0, 201, -1):
        assert client.get("/api/ratings", params={"limit": bad}).status_code == 422


def test_ratings_show_current_names(client):
    a, _ = add_people(client, "A", "B")
    start_round(client)
    rate_next(client)
    client.patch(f"/api/personnel/{a['id']}", json={"name": "Renamed"})
    rating = client.get("/api/ratings").json()[0]
    names = {rating["person_a"]["name"], rating["person_b"]["name"]}
    assert names == {"Renamed", "B"}


def test_progression_by_rounds_includes_late_joiners(client):
    a, b, c = add_people(client, "A", "B", "C")
    first = start_round(client)
    finish_round(client)
    after_first = {
        p["id"]: p["current_elo"] for p in client.get("/api/personnel").json()
    }

    late = add_person(client, "Late", initial_elo=1100)
    second = start_round(client)
    finish_round(client)
    final = {p["id"]: p["current_elo"] for p in client.get("/api/personnel").json()}

    points = client.get("/api/elo-progression/by-rounds").json()
    by_key = {(p["personnel_id"], p["round_number"]): p for p in points}

    for person in (a, b, c):
        start = by_key[(person["id"], 0)]
        assert start["round_name"] == "Start"
        assert start["elo_score"] == 1000
        assert by_key[(person["id"], 1)]["elo_score"] == after_first[person["id"]]
        assert by_key[(person["id"], 1)]["round_name"] == first["name"]
        assert by_key[(person["id"], 2)]["elo_score"] == final[person["id"]]
        assert by_key[(person["id"], 2)]["round_name"] == second["name"]

    # The late joiner starts at their value when they joined and has no round 1.
    assert by_key[(late["id"], 0)]["elo_score"] == 1100
    assert (late["id"], 1) not in by_key
    assert by_key[(late["id"], 2)]["elo_score"] == final[late["id"]]
    assert by_key[(late["id"], 2)]["name"] == "Late"
    assert len(points) == 3 * 3 + 2


def test_progression_by_rounds_only_uses_completed_rounds(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    rate_next(client)
    assert client.get("/api/elo-progression/by-rounds").json() == []
    # A round closed early with ratings still counts; one with none does not.
    start_round(client, force="true")
    start_round(client, force="true")
    points = client.get("/api/elo-progression/by-rounds").json()
    assert {p["round_number"] for p in points} == {0, 1}
    assert {p["round_name"] for p in points} == {"Start", "Round 1"}


def test_progression_by_ratings(client):
    add_people(client, "A", "B", "C")
    start_round(client)
    ratings = []
    while client.get("/api/matchups/next").json()["status"] == "ready":
        ratings.append(rate_next(client)["rating"])

    late = add_person(client, "Late")
    start_round(client)
    while client.get("/api/matchups/next").json()["status"] == "ready":
        ratings.append(rate_next(client)["rating"])

    points = client.get("/api/elo-progression/by-ratings").json()
    assert len(points) == 2 * len(ratings)
    assert [p["rating_id"] for p in points] == sorted(p["rating_id"] for p in points)
    for index, rating in enumerate(ratings, start=1):
        pair = [p for p in points if p["rating_id"] == rating["id"]]
        assert {p["sequence"] for p in pair} == {index}
        scores = {p["personnel_id"]: p["elo_score"] for p in pair}
        assert scores == {
            rating["person_a"]["id"]: rating["a_after"],
            rating["person_b"]["id"]: rating["b_after"],
        }
        assert all(p["rated_at"] == rating["rated_at"] for p in pair)
    assert any(p["personnel_id"] == late["id"] for p in points)


def test_progression_hides_inactive_people(client):
    a, b, c = add_people(client, "A", "B", "C")
    start_round(client)
    finish_round(client)
    client.delete(f"/api/personnel/{a['id']}")
    for url in ("/api/elo-progression/by-rounds", "/api/elo-progression/by-ratings"):
        points = client.get(url).json()
        assert points
        assert a["id"] not in {p["personnel_id"] for p in points}
