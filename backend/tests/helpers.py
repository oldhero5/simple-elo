from typing import Any

from fastapi.testclient import TestClient


def add_person(
    client: TestClient, name: str, rank: str = "SPC", **extra: Any
) -> dict[str, Any]:
    response = client.post("/api/personnel", json={"name": name, "rank": rank, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def add_people(client: TestClient, *names: str) -> list[dict[str, Any]]:
    return [add_person(client, name) for name in names]


def start_round(client: TestClient, **params: Any) -> dict[str, Any]:
    response = client.post("/api/rounds", params=params)
    assert response.status_code == 201, response.text
    return response.json()


def next_matchup(client: TestClient) -> dict[str, Any]:
    response = client.get("/api/matchups/next")
    assert response.status_code == 200, response.text
    return response.json()


def rate(client: TestClient, matchup_id: int, winner_id: int | None) -> dict[str, Any]:
    response = client.post(
        f"/api/matchups/{matchup_id}/result", json={"winner_id": winner_id}
    )
    assert response.status_code == 201, response.text
    return response.json()


def rate_next(client: TestClient, winner: str = "a") -> dict[str, Any]:
    """Rate the next matchup: winner is "a", "b" or "draw"."""
    current = next_matchup(client)
    assert current["status"] == "ready"
    winner_id = {
        "a": current["person_a"]["id"],
        "b": current["person_b"]["id"],
        "draw": None,
    }[winner]
    return rate(client, current["matchup"]["id"], winner_id)


def finish_round(client: TestClient, winner: str = "a") -> int:
    """Rate every remaining matchup; returns how many were rated."""
    count = 0
    while next_matchup(client)["status"] == "ready":
        rate_next(client, winner)
        count += 1
    return count
