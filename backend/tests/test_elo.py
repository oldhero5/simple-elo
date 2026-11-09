from itertools import permutations

import pytest

from bands import OPERATIONAL, STRATEGIC, TACTICAL, UNBANDED, band_for_rank
from elo import (
    A_WINS,
    B_WINS,
    CANT_JUDGE,
    DRAW,
    apply_outcome,
    calculate_elo,
    get_rating_change_preview,
)


def test_ratings_are_not_rounded():
    a, b = calculate_elo(1016, 984, 1.0)
    assert a != round(a) and b != round(b)


def test_update_is_zero_sum():
    a, b = calculate_elo(1234.5, 987.25, 1.0)
    assert a + b == pytest.approx(1234.5 + 987.25)


def test_cant_judge_changes_nothing_even_between_unequal_officers():
    assert apply_outcome(1200.5, 900.25, CANT_JUDGE) == (1200.5, 900.25)


def test_draw_moves_unequal_ratings_so_it_is_not_a_cant_judge():
    a, b = apply_outcome(1200, 900, DRAW)
    assert a < 1200 and b > 900


def test_preview_shows_zero_change_for_cant_judge():
    preview = get_rating_change_preview(1100, 950)
    assert preview["cant_judge"]["a_change"] == 0
    assert preview["cant_judge"]["b_change"] == 0
    assert preview["a_wins"]["a_change"] > 0


def _bracket(order):
    """A beats B, A beats C, B beats C, applied in the given order."""
    ratings = {"A": 1000.0, "B": 1000.0, "C": 1000.0}
    for x, y in order:
        ratings[x], ratings[y] = apply_outcome(ratings[x], ratings[y], A_WINS)
    return ratings


def test_paper_order_sensitivity_table():
    """Information paper, section 5: the worked three-officer bracket."""
    first = _bracket([("A", "B"), ("A", "C"), ("B", "C")])
    assert (first["A"], first["B"], first["C"]) == pytest.approx(
        (1031.26, 1000.03, 968.70), abs=0.01
    )
    second = _bracket([("B", "C"), ("A", "C"), ("A", "B")])
    assert (second["A"], second["B"], second["C"]) == pytest.approx(
        (1031.30, 999.97, 968.74), abs=0.01
    )
    runs = [_bracket(p) for p in permutations([("A", "B"), ("A", "C"), ("B", "C")])]
    mean = {k: sum(r[k] for r in runs) / 6 for k in "ABC"}
    assert (mean["A"], mean["B"], mean["C"]) == pytest.approx(
        (1031.25, 1000.00, 968.75), abs=0.01
    )


@pytest.mark.parametrize(
    "rank,band",
    [
        ("2LT", TACTICAL),
        ("1LT", TACTICAL),
        ("LT", TACTICAL),
        ("CPT", TACTICAL),
        ("MAJ", OPERATIONAL),
        ("LTC", OPERATIONAL),
        ("COL", STRATEGIC),
        ("BG+", STRATEGIC),
        ("GEN", STRATEGIC),
        ("SSG", UNBANDED),
        (" cpt ", TACTICAL),
    ],
)
def test_rank_maps_to_band(rank, band):
    assert band_for_rank(rank) == band


def test_b_wins_is_mirror_of_a_wins():
    a1, b1 = apply_outcome(1000, 1000, B_WINS)
    assert (a1, b1) == (984, 1016)
