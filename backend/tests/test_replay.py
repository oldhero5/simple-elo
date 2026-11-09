import numpy as np
import pytest

from pairing import select_pairs
from replay import replay_in_order, shuffled_replay


def pool(n=30, budget=10, seed=0):
    """One simulated pool, using the simulation's base case (80% accuracy)."""
    rng = np.random.default_rng(seed)
    (plan,) = select_pairs([(i, "tactical", "U1") for i in range(n)], budget, 0, seed)
    pairs = np.array(plan.pairs)
    theta = rng.standard_normal(n)
    p = 1 / (1 + np.exp(-1.64 * (theta[pairs[:, 0]] - theta[pairs[:, 1]])))
    scores = (rng.random(len(pairs)) < p).astype(float)
    return pairs[:, 0], pairs[:, 1], scores, np.full(n, 1000.0)


def test_paper_bracket_recorded_order():
    a, b = np.array([0, 0, 1]), np.array([1, 2, 2])
    out = replay_in_order(a, b, np.ones(3), np.full(3, 1000.0))
    assert out == pytest.approx([1031.26, 1000.03, 968.70], abs=0.01)


def test_paper_bracket_shuffled_mean_approaches_mean_of_six_orders():
    a, b = np.array([0, 0, 1]), np.array([1, 2, 2])
    out = shuffled_replay(
        a, b, np.ones(3), np.ones(3), np.full(3, 1000.0), shuffles=4000, seed=1
    )
    assert out.mean == pytest.approx([1031.25, 1000.00, 968.75], abs=0.01)


def test_replay_never_changes_the_comparison_set_total():
    a, b, s, start = pool()
    out = shuffled_replay(a, b, s, np.ones(len(a)), start, shuffles=20, seed=2)
    assert out.finals.sum(axis=1) == pytest.approx(np.full(20, start.sum()))


def test_spread_matches_paper_at_ten_per_officer():
    """Paper: sd about 4.8 for one order at 10 per officer, 0.5 at 100 shuffles."""
    sds = []
    for seed in range(20):
        a, b, s, start = pool(seed=seed)
        out = shuffled_replay(a, b, s, np.ones(len(a)), start, shuffles=100, seed=seed)
        sds.append(np.mean(out.sd))
    assert np.mean(sds) == pytest.approx(4.8, abs=0.5)
    assert np.mean(sds) / 10 == pytest.approx(0.48, abs=0.05)


def test_same_seed_is_reproducible():
    a, b, s, start = pool()
    q = np.ones(len(a))
    first = shuffled_replay(a, b, s, q, start, shuffles=10, seed=3).finals
    assert np.array_equal(first, shuffled_replay(a, b, s, q, start, 10, 3).finals)
    assert not np.array_equal(first, shuffled_replay(a, b, s, q, start, 10, 4).finals)


def test_quarters_stay_in_sequence():
    # Q1: A beats B many times. Q2: B beats A once. If quarters held their order
    # every shuffle ends the same way, because each quarter has one distinct game.
    a, b = np.array([0, 1]), np.array([1, 0])
    scores, quarters = np.ones(2), np.array([1, 2])
    out = shuffled_replay(a, b, scores, quarters, np.full(2, 1000.0), 50, seed=5)
    assert out.sd == pytest.approx([0, 0])
    assert out.mean == pytest.approx(out.recorded)


def test_shuffling_within_a_quarter_does_move_ratings():
    a, b, s, start = pool()
    out = shuffled_replay(a, b, s, np.ones(len(a)), start, shuffles=50, seed=6)
    assert out.sd.max() > 1


def test_empty_record():
    empty = np.array([], dtype=int)
    out = shuffled_replay(
        empty, empty, np.array([]), empty, np.full(3, 1000.0), shuffles=5, seed=7
    )
    assert out.mean == pytest.approx([1000, 1000, 1000])
