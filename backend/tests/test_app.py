from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

import config
import queries
from config import Settings
from main import create_app


def test_database_path_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "a.db"))
    monkeypatch.setenv("DATABASE_URL", str(tmp_path / "b.db"))
    assert Settings.from_env().database_path == tmp_path / "a.db"


def test_database_url_is_the_fallback(monkeypatch, tmp_path):
    monkeypatch.delenv("DATABASE_PATH", raising=False)
    monkeypatch.setenv("DATABASE_URL", str(tmp_path / "b.db"))
    assert Settings.from_env().database_path == tmp_path / "b.db"


def test_default_database_path_is_the_repo_data_dir(monkeypatch):
    monkeypatch.delenv("DATABASE_PATH", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    path = Settings.from_env().database_path
    assert path.is_absolute()
    assert path == Path(config.__file__).resolve().parent.parent / "data" / (
        "elo_ratings.db"
    )


def test_app_creates_the_data_directory(client, db_path):
    assert db_path.exists()


def test_cors_is_off_by_default(client):
    response = client.get("/api/health", headers={"Origin": "http://phone:3000"})
    assert "access-control-allow-origin" not in response.headers


def test_cors_origins_from_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "elo.db"))
    monkeypatch.setenv("CORS_ORIGINS", "http://a.example:3000, http://b.example")
    with TestClient(create_app()) as client:
        allowed = client.get("/api/health", headers={"Origin": "http://b.example"})
        assert allowed.headers["access-control-allow-origin"] == "http://b.example"
        other = client.get("/api/health", headers={"Origin": "http://c.example"})
        assert "access-control-allow-origin" not in other.headers


def test_validation_errors_have_a_readable_detail(client):
    response = client.post("/api/personnel", json={"name": "", "rank": "SPC"})
    assert response.status_code == 422
    body = response.json()
    assert body["detail"].startswith("name: ")
    assert body["errors"][0]["loc"] == ["body", "name"]


def test_unexpected_errors_do_not_leak_details(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "elo.db"))

    def broken(conn):
        raise RuntimeError("secret internals")

    monkeypatch.setattr(queries, "count_active_personnel", broken)
    with TestClient(create_app(), raise_server_exceptions=False) as client:
        response = client.get("/api/matchups/next")
    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}


def test_newer_schema_is_refused(tmp_path):
    path = tmp_path / "elo.db"
    conn = duckdb.connect(str(path))
    conn.execute("CREATE TABLE schema_version (version INTEGER NOT NULL)")
    conn.execute("INSERT INTO schema_version VALUES (99)")
    conn.close()
    with pytest.raises(RuntimeError, match="newer"):
        with TestClient(create_app(Settings(database_path=path))):
            pass


def test_openapi_describes_the_validation_error_body(client):
    spec = client.get("/api/openapi.json").json()
    error = spec["components"]["schemas"]["HTTPValidationError"]
    assert error["properties"]["detail"]["type"] == "string"
    assert "errors" in error["required"]
