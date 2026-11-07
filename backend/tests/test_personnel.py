from datetime import datetime, timezone

import pytest
from helpers import add_people, add_person


def test_create_person_defaults(client):
    response = client.post("/api/personnel", json={"name": "Diaz", "rank": "CPT"})
    assert response.status_code == 201
    person = response.json()
    assert person["name"] == "Diaz"
    assert person["rank"] == "CPT"
    assert person["initial_elo"] == 1000
    assert person["current_elo"] == 1000
    assert person["active"] is True
    assert person["created_at"].endswith("Z")
    created = datetime.fromisoformat(person["created_at"])
    assert abs((datetime.now(timezone.utc) - created).total_seconds()) < 60


def test_create_person_strips_whitespace_and_takes_initial_elo(client):
    person = add_person(client, "  Chen  ", rank=" SPC ", initial_elo=1200)
    assert (person["name"], person["rank"]) == ("Chen", "SPC")
    assert person["initial_elo"] == person["current_elo"] == 1200


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "rank": "SPC"},
        {"name": "   ", "rank": "SPC"},
        {"name": "x" * 81, "rank": "SPC"},
        {"name": "Ok", "rank": ""},
        {"name": "Ok", "rank": "x" * 13},
        {"name": "Ok"},
        {"rank": "SPC"},
        {"name": "Ok", "rank": "SPC", "initial_elo": None},
        {"name": "Ok", "rank": "SPC", "initial_elo": 99},
        {"name": "Ok", "rank": "SPC", "initial_elo": 3001},
        {"name": "Ok", "rank": "SPC", "initial_elo": 1000.5},
    ],
)
def test_create_person_validation(client, body):
    response = client.post("/api/personnel", json=body)
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)
    # Nothing was written.
    assert client.get("/api/personnel?active_only=false").json() == []


def test_name_and_elo_limits_are_inclusive(client):
    add_person(client, "x" * 80, rank="y" * 12, initial_elo=100)
    add_person(client, "Other", initial_elo=3000)


def test_duplicate_active_person_is_409(client):
    add_person(client, "Diaz", rank="CPT")
    response = client.post("/api/personnel", json={"name": "diaz ", "rank": "cpt"})
    assert response.status_code == 409
    assert "Diaz" in response.json()["detail"]
    # Same name with another rank is a different person.
    add_person(client, "Diaz", rank="SGT")


def test_duplicate_of_inactive_person_is_allowed(client):
    person = add_person(client, "Diaz", rank="CPT")
    assert client.delete(f"/api/personnel/{person['id']}").status_code == 204
    add_person(client, "Diaz", rank="CPT")


def test_get_person_and_404(client):
    person = add_person(client, "Diaz")
    assert client.get(f"/api/personnel/{person['id']}").json() == person
    response = client.get("/api/personnel/999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Person not found"


def test_list_sorted_by_rating_then_name(client):
    add_person(client, "Bravo", initial_elo=1000)
    add_person(client, "alpha", initial_elo=1000)
    add_person(client, "Charlie", initial_elo=1100)
    names = [p["name"] for p in client.get("/api/personnel").json()]
    assert names == ["Charlie", "alpha", "Bravo"]


def test_edit_name_and_rank(client):
    person = add_person(client, "Diaz", rank="1LT")
    response = client.patch(
        f"/api/personnel/{person['id']}", json={"name": " Diaz-Ortiz ", "rank": "CPT"}
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    assert (updated["name"], updated["rank"]) == ("Diaz-Ortiz", "CPT")
    assert updated["current_elo"] == person["current_elo"]
    assert client.get(f"/api/personnel/{person['id']}").json() == updated


def test_edit_validation(client):
    person = add_person(client, "Diaz")
    for body in ({"name": ""}, {"name": "  "}, {"rank": "x" * 13}):
        response = client.patch(f"/api/personnel/{person['id']}", json=body)
        assert response.status_code == 422
    assert client.get(f"/api/personnel/{person['id']}").json() == person


def test_empty_patch_changes_nothing(client):
    person = add_person(client, "Diaz")
    response = client.patch(f"/api/personnel/{person['id']}", json={})
    assert response.status_code == 200
    assert response.json() == person


def test_rename_into_duplicate_is_409(client):
    add_person(client, "Diaz", rank="CPT")
    other = add_person(client, "Chen", rank="CPT")
    response = client.patch(f"/api/personnel/{other['id']}", json={"name": "DIAZ"})
    assert response.status_code == 409
    assert client.get(f"/api/personnel/{other['id']}").json()["name"] == "Chen"


def test_changing_case_of_own_name_is_allowed(client):
    person = add_person(client, "diaz")
    response = client.patch(f"/api/personnel/{person['id']}", json={"name": "Diaz"})
    assert response.status_code == 200
    assert response.json()["name"] == "Diaz"


def test_deactivate_and_reactivate(client):
    person, other = add_people(client, "Diaz", "Chen")
    response = client.patch(f"/api/personnel/{person['id']}", json={"active": False})
    assert response.status_code == 200
    assert response.json()["active"] is False

    active = client.get("/api/personnel").json()
    assert [p["id"] for p in active] == [other["id"]]
    everyone = client.get("/api/personnel", params={"active_only": "false"}).json()
    assert {p["id"] for p in everyone} == {person["id"], other["id"]}
    assert client.get(f"/api/personnel/{person['id']}").json()["active"] is False

    response = client.patch(f"/api/personnel/{person['id']}", json={"active": True})
    assert response.status_code == 200
    assert response.json()["active"] is True
    assert len(client.get("/api/personnel").json()) == 2


def test_reactivating_into_a_duplicate_is_409(client):
    old = add_person(client, "Diaz", rank="CPT")
    client.delete(f"/api/personnel/{old['id']}")
    add_person(client, "Diaz", rank="CPT")
    response = client.patch(f"/api/personnel/{old['id']}", json={"active": True})
    assert response.status_code == 409
    assert client.get(f"/api/personnel/{old['id']}").json()["active"] is False


def test_delete_is_a_soft_delete(client):
    person = add_person(client, "Diaz")
    response = client.delete(f"/api/personnel/{person['id']}")
    assert response.status_code == 204
    assert response.content == b""
    assert client.get(f"/api/personnel/{person['id']}").json()["active"] is False
    # Deleting again is harmless.
    assert client.delete(f"/api/personnel/{person['id']}").status_code == 204


def test_edit_and_delete_unknown_person_is_404(client):
    assert client.patch("/api/personnel/42", json={"name": "X"}).status_code == 404
    assert client.delete("/api/personnel/42").status_code == 404
