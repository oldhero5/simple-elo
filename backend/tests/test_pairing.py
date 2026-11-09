from collections import Counter

import numpy as np
import pytest

from pairing import select_pairs


def officers(units=3, per_unit=10, band="tactical"):
    return [
        (u * per_unit + i + 1, band, f"U{u:02d}")
        for u in range(units)
        for i in range(per_unit)
    ]


def degrees(plan):
    return Counter(x for pair in plan.pairs for x in pair)


@pytest.mark.parametrize("budget", [7, 10, 15])
def test_budget_replaces_all_pairs(budget):
    (plan,) = select_pairs(officers(), budget, 0.2, seed=1)
    assert len(plan.pairs) == 30 * budget // 2
    assert len(plan.pairs) < 435


def test_paper_budget_totals_for_thirty_officers():
    totals = [len(select_pairs(officers(), m, 0.2, seed=2)[0].pairs) for m in (7, 15)]
    assert totals == [105, 225]


@pytest.mark.parametrize("seed", range(25))
@pytest.mark.parametrize("budget", [7, 10, 15])
@pytest.mark.parametrize("share", [0.0, 0.1, 0.2, 0.5])
def test_every_officer_gets_the_budget_and_no_pair_repeats(seed, budget, share):
    (plan,) = select_pairs(officers(), budget, share, seed=seed)
    assert set(degrees(plan).values()) == {budget}
    assert len({frozenset(p) for p in plan.pairs}) == len(plan.pairs)
    assert all(a != b for a, b in plan.pairs)


@pytest.mark.parametrize("seed", range(25))
@pytest.mark.parametrize("n", [5, 6, 7, 11, 13, 29])
@pytest.mark.parametrize("budget", [3, 4, 7])
def test_budget_holds_on_uneven_pools(seed, n, budget):
    rng = np.random.default_rng(seed)
    pool = [(i, "tactical", f"U{rng.integers(0, 4)}") for i in range(n)]
    (plan,) = select_pairs(pool, budget, 0.2, seed=seed)
    degree = min(budget, n - 1)
    assert plan.max_comparisons <= degree
    # An odd total leaves exactly one open slot; never more.
    assert plan.min_comparisons >= degree - 1
    assert len(plan.pairs) == n * degree // 2


@pytest.mark.parametrize("share", [0.1, 0.2, 0.5])
def test_cross_unit_share_is_met(share):
    (plan,) = select_pairs(officers(units=5, per_unit=30), 10, share, seed=3)
    assert plan.realised_cross_unit_share == pytest.approx(share, abs=0.005)


@pytest.mark.parametrize("seed", range(40))
def test_zero_share_keeps_pairs_in_unit_and_warns_of_separate_scales(seed):
    (plan,) = select_pairs(officers(units=3, per_unit=12), 7, 0.0, seed=seed)
    assert plan.cross_unit_pairs == 0
    assert plan.unit_groups == 3
    assert any("separate scales" in w for w in plan.warnings)


def test_links_join_units_at_the_recommended_share():
    (plan,) = select_pairs(officers(units=10, per_unit=30), 10, 0.2, seed=5)
    assert plan.unit_groups == 1


def test_small_units_force_share_above_target_and_it_is_reported():
    (plan,) = select_pairs(officers(units=10, per_unit=3), 7, 0.1, seed=6)
    assert plan.realised_cross_unit_share > 0.1
    assert plan.min_comparisons == 7


def test_pairs_never_cross_bands():
    pool = officers(band="tactical") + [
        (100 + o[0], "operational", o[2]) for o in officers()
    ]
    plans = select_pairs(pool, 7, 0.2, seed=7)
    assert [p.band for p in plans] == ["operational", "tactical"]
    for plan in plans:
        ids = {x for pair in plan.pairs for x in pair}
        assert all(x > 100 for x in ids) == (plan.band == "operational")


def test_pool_smaller_than_budget_is_capped_and_warned():
    (plan,) = select_pairs(officers(units=1, per_unit=4), 10, 0.2, seed=8)
    assert len(plan.pairs) == 6
    assert any("capped" in w for w in plan.warnings)
    assert any("under the pool" in w for w in plan.warnings)


def test_lone_officer_gets_no_pairs():
    (plan,) = select_pairs([(1, "strategic", "U1")], 7, 0.2, seed=9)
    assert plan.pairs == []


def test_same_seed_same_plan():
    first = select_pairs(officers(), 7, 0.2, seed=10)[0].pairs
    assert first == select_pairs(officers(), 7, 0.2, seed=10)[0].pairs
    assert first != select_pairs(officers(), 7, 0.2, seed=11)[0].pairs


def test_large_band_finishes_quickly():
    import time

    pool = [(i, "tactical", f"U{i % 20:02d}") for i in range(1400)]
    started = time.perf_counter()
    (plan,) = select_pairs(pool, 10, 0.2, seed=12)
    assert time.perf_counter() - started < 5
    assert plan.min_comparisons == 10
