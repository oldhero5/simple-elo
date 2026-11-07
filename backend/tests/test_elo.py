import itertools

import pytest

import elo


def test_expected_score_is_half_for_equal_ratings():
    assert elo.expected_score(1000, 1000) == pytest.approx(0.5)


def test_expected_scores_of_both_sides_sum_to_one():
    for a, b in [(1000, 1200), (1500, 900), (2400, 2400), (100, 3000)]:
        assert elo.expected_score(a, b) + elo.expected_score(b, a) == pytest.approx(1)


def test_expected_score_for_a_400_point_gap():
    # 400 points is the scale where the favourite is ten times as likely to win.
    assert elo.expected_score(1400, 1000) == pytest.approx(10 / 11)


def test_rating_delta_between_equals():
    assert elo.rating_delta(1000, 1000, elo.WIN) == 16
    assert elo.rating_delta(1000, 1000, elo.LOSS) == -16
    assert elo.rating_delta(1000, 1000, elo.DRAW) == 0


def test_underdog_gains_more_than_favourite():
    assert elo.rating_delta(1000, 1200, elo.WIN) > elo.rating_delta(1200, 1000, elo.WIN)
    assert elo.rating_delta(1000, 1200, elo.DRAW) > 0


def test_custom_k_factor():
    assert elo.rating_delta(1000, 1000, elo.WIN, k_factor=16) == 8


def test_apply_result_is_zero_sum():
    ratings = range(400, 2401, 37)
    for a, b in itertools.product(ratings, ratings):
        for score in (elo.WIN, elo.DRAW, elo.LOSS):
            new_a, new_b = elo.apply_result(a, b, score)
            assert new_a + new_b == a + b


def test_apply_result_moves_winner_up():
    new_a, new_b = elo.apply_result(1000, 1000, elo.WIN)
    assert (new_a, new_b) == (1016, 984)
    new_a, new_b = elo.apply_result(1000, 1000, elo.LOSS)
    assert (new_a, new_b) == (984, 1016)


def test_preview_returns_zero_sum_deltas_for_every_outcome():
    result = elo.preview(1100, 1000)
    assert set(result) == {"a_wins", "b_wins", "draw"}
    for a_delta, b_delta in result.values():
        assert a_delta == -b_delta
    assert result["a_wins"][0] == elo.rating_delta(1100, 1000, elo.WIN)
    assert result["b_wins"][0] == elo.rating_delta(1100, 1000, elo.LOSS)
    assert result["draw"][0] == elo.rating_delta(1100, 1000, elo.DRAW)
    # The favourite loses points on a draw.
    assert result["draw"][0] < 0


def test_rejects_scores_outside_zero_to_one():
    with pytest.raises(ValueError):
        elo.rating_delta(1000, 1000, 2)
