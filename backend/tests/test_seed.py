"""Checks the demo loader against the simulation's own published outputs."""

import csv
import os
from pathlib import Path

import pytest

import main
import seed_demo
from database import Database
from population import get_population, get_replay

SOURCE = Path(os.getenv("ELO_SIM_DIR", seed_demo.DEFAULT_SOURCE))

pytestmark = pytest.mark.skipif(
    not (SOURCE / "E_comparisons.csv").exists(),
    reason="simulation files are local and not in the repo",
)


@pytest.fixture(scope="module")
def seeded(tmp_path_factory):
    path = tmp_path_factory.mktemp("seed") / "demo.db"
    before = os.environ.get("DATABASE_URL")
    report = seed_demo.seed(SOURCE, path, reset=False)
    os.environ["DATABASE_URL"] = before
    return Database(str(path)), report


def test_counts_match_the_simulation(seeded):
    _, report = seeded
    assert report["officers"] == 3000
    assert report["performance_comparisons"] == 108000


def test_record_reproduces_simulation_ratings_at_every_quarter(seeded):
    _, report = seeded
    assert report["max_drift_from_simulation"] < 1e-6


def test_dataset_is_labelled_synthetic(seeded):
    database, _ = seeded
    meta = database.get_meta()
    assert meta["synthetic"] is True
    assert "SYNTHETIC" in meta["label"]
    assert any("generated" in note for note in meta["notes"])
    assert all(p.synthetic for p in database.get_all_personnel(limit=50))
    assert get_population(database)["synthetic"] is True


def test_band_sizes_match_the_simulation(seeded):
    database, _ = seeded
    bands = {b["band"]: b["officers"] for b in get_population(database)["by_band"]}
    assert bands == {"tactical": 1400, "operational": 1100, "strategic": 500}


def test_planted_unit_is_found_by_the_cross_unit_cut(seeded):
    database, _ = seeded
    with open(SOURCE / "E_unit_crossunit_winrate.csv", newline="") as handle:
        expected = {r["unit"]: float(r["change"]) for r in csv.DictReader(handle)}
    rows = get_population(database)["by_unit"]
    for row in rows:
        assert row["cross_win_rate_change"] == pytest.approx(expected[row["unit"]])
    best = max(rows, key=lambda r: r["cross_win_rate_change"])
    assert best["unit"] == "U07"


def test_cross_unit_share_matches_the_simulation(seeded):
    database, _ = seeded
    share = get_population(database)["summary"]["cross_unit_share"]
    assert share == pytest.approx(0.113, abs=0.001)


def test_replay_recorded_ratings_match_personnel(seeded):
    database, _ = seeded
    view = get_replay(database, "performance", "strategic", shuffles=5, limit=10)
    live = {p.id: p.current_elo for p in database.get_all_personnel(band="strategic")}
    for officer in view["officers"]:
        assert officer["recorded"] == pytest.approx(live[officer["id"]])


def test_a_live_round_runs_on_top_of_the_demo_data(seeded, monkeypatch):
    database, _ = seeded
    monkeypatch.setattr(main, "db", database)
    from models import RoundConfig

    round_ = database.start_new_round(
        RoundConfig(band="strategic", comparisons_per_officer=7, seed=1)
    )
    assert round_.quarter == 13
    assert round_.total_matchups == 500 * 7 // 2
    pair = database.get_round_based_comparison_pair()
    row = database.create_round_rating(
        round_.id, pair["matchup"].id, None, cant_judge=True
    )
    assert row.ratee_a_elo_after == row.ratee_a_elo_before
    assert row.id == 108000 + report_potential(database) + 1


def report_potential(database):
    with database.get_connection() as conn:
        return conn.execute(
            "SELECT count(*) FROM ratings WHERE track = 'potential'"
        ).fetchone()[0]


def test_seed_refuses_to_overwrite_without_reset(tmp_path):
    existing = tmp_path / "demo.db"
    existing.write_text("not empty")
    with pytest.raises(SystemExit):
        seed_demo.seed(SOURCE, existing, reset=False)
    assert existing.read_text() == "not empty"
